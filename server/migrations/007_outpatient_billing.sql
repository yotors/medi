-- Existing visits retain their historical demonstration JSON unchanged.
CREATE TABLE billing_counters (
  hospital_id uuid PRIMARY KEY REFERENCES hospitals(id),
  next_invoice bigint NOT NULL DEFAULT 1 CHECK(next_invoice > 0),
  next_receipt bigint NOT NULL DEFAULT 1 CHECK(next_receipt > 0)
);
CREATE TABLE billing_invoices (
  id uuid PRIMARY KEY, hospital_id uuid NOT NULL REFERENCES hospitals(id), visit_id uuid NOT NULL,
  number text NOT NULL, total_minor integer NOT NULL CHECK(total_minor BETWEEN 0 AND 999999999),
  line_count integer NOT NULL CHECK(line_count BETWEEN 1 AND 20), currency text NOT NULL DEFAULT 'ETB' CHECK(currency='ETB'),
  actor_id uuid NOT NULL, actor_name text NOT NULL, issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(hospital_id,id), UNIQUE(hospital_id,number),
  FOREIGN KEY(hospital_id,visit_id) REFERENCES outpatient_visits(hospital_id,id),
  FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE billing_lines (
  id uuid PRIMARY KEY, hospital_id uuid NOT NULL, invoice_id uuid NOT NULL,
  position integer NOT NULL CHECK(position BETWEEN 1 AND 20), service_id uuid NOT NULL, service_revision integer NOT NULL,
  code text NOT NULL, name text NOT NULL, quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100),
  unit_price_minor integer NOT NULL CHECK(unit_price_minor BETWEEN 0 AND 999999999),
  total_minor integer NOT NULL CHECK(total_minor BETWEEN 0 AND 999999999),
  CHECK(total_minor::bigint=quantity::bigint*unit_price_minor),
  UNIQUE(hospital_id,invoice_id,position), UNIQUE(hospital_id,invoice_id,service_id),
  FOREIGN KEY(hospital_id,invoice_id) REFERENCES billing_invoices(hospital_id,id),
  FOREIGN KEY(hospital_id,service_id,service_revision) REFERENCES hospital_service_versions(hospital_id,service_id,revision)
);
CREATE TABLE billing_payments (
  id uuid PRIMARY KEY, hospital_id uuid NOT NULL, invoice_id uuid NOT NULL,
  amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 999999999),
  method text NOT NULL CHECK(method IN ('cash','manual_transfer')),
  reference text NOT NULL CHECK(length(reference)<=200 AND (method='cash' OR length(btrim(reference))>0)),
  actor_id uuid NOT NULL, actor_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(hospital_id,id), UNIQUE(hospital_id,invoice_id,id),
  FOREIGN KEY(hospital_id,invoice_id) REFERENCES billing_invoices(hospital_id,id),
  FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE billing_receipts (
  id uuid PRIMARY KEY, hospital_id uuid NOT NULL, payment_id uuid NOT NULL, number text NOT NULL,
  UNIQUE(hospital_id,id), UNIQUE(hospital_id,number), UNIQUE(hospital_id,payment_id),
  FOREIGN KEY(hospital_id,payment_id) REFERENCES billing_payments(hospital_id,id)
);
CREATE TABLE billing_events (
  id uuid PRIMARY KEY, hospital_id uuid NOT NULL, invoice_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision>0), action text NOT NULL CHECK(action IN ('invoice.issue','payment.record','invoice.void')),
  actor_id uuid NOT NULL, actor_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  payment_id uuid, reason text,
  CHECK((action='payment.record')=(payment_id IS NOT NULL)),
  CHECK((action='invoice.void' AND reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 200) OR (action<>'invoice.void' AND reason IS NULL)),
  CHECK((action='invoice.issue')=(revision=1)),
  UNIQUE(hospital_id,invoice_id,revision), UNIQUE(hospital_id,payment_id),
  FOREIGN KEY(hospital_id,invoice_id) REFERENCES billing_invoices(hospital_id,id),
  FOREIGN KEY(hospital_id,invoice_id,payment_id) REFERENCES billing_payments(hospital_id,invoice_id,id),
  FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE UNIQUE INDEX billing_one_void ON billing_events(hospital_id,invoice_id) WHERE action='invoice.void';
CREATE TABLE billing_requests (
  hospital_id uuid NOT NULL REFERENCES hospitals(id), idempotency_key uuid NOT NULL, actor_id uuid NOT NULL,
  visit_id uuid NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY(hospital_id,idempotency_key),
  FOREIGN KEY(hospital_id,visit_id) REFERENCES outpatient_visits(hospital_id,id),
  FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE FUNCTION protect_billing_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Billing history is immutable'; END;
$$;
CREATE TRIGGER immutable_billing_invoice BEFORE UPDATE OR DELETE ON billing_invoices FOR EACH ROW EXECUTE FUNCTION protect_billing_history();
CREATE TRIGGER immutable_billing_line BEFORE UPDATE OR DELETE ON billing_lines FOR EACH ROW EXECUTE FUNCTION protect_billing_history();
CREATE TRIGGER immutable_billing_payment BEFORE UPDATE OR DELETE ON billing_payments FOR EACH ROW EXECUTE FUNCTION protect_billing_history();
CREATE TRIGGER immutable_billing_receipt BEFORE UPDATE OR DELETE ON billing_receipts FOR EACH ROW EXECUTE FUNCTION protect_billing_history();
CREATE TRIGGER immutable_billing_event BEFORE UPDATE OR DELETE ON billing_events FOR EACH ROW EXECUTE FUNCTION protect_billing_history();
CREATE TRIGGER immutable_billing_request BEFORE UPDATE OR DELETE ON billing_requests FOR EACH ROW EXECUTE FUNCTION protect_billing_history();
CREATE FUNCTION protect_visit_financial_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.data->>'financialMode') IS DISTINCT FROM (NEW.data->>'financialMode') THEN
    RAISE EXCEPTION 'Visit financial mode is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER outpatient_financial_mode_guard BEFORE UPDATE ON outpatient_visits FOR EACH ROW EXECUTE FUNCTION protect_visit_financial_mode();
-- Deferred checks permit an atomic invoice/lines/event insert, never an incomplete ledger.
CREATE FUNCTION validate_billing_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv billing_invoices%ROWTYPE; target uuid; line_total bigint; line_count bigint; paid bigint; event_count bigint; last_revision integer; voided boolean;
BEGIN
  IF TG_TABLE_NAME='billing_invoices' THEN target := NEW.id; ELSE target := NEW.invoice_id; END IF;
  SELECT * INTO inv FROM billing_invoices WHERE hospital_id=NEW.hospital_id AND id=target;
  IF NOT EXISTS(SELECT 1 FROM outpatient_visits WHERE hospital_id=inv.hospital_id AND id=inv.visit_id AND data->>'financialMode'='catalog') THEN
    RAISE EXCEPTION 'Only catalog visits accept invoices';
  END IF;
  SELECT count(*),coalesce(sum(total_minor),0) INTO line_count,line_total FROM billing_lines WHERE hospital_id=inv.hospital_id AND invoice_id=target;
  IF line_count<>inv.line_count OR line_total<>inv.total_minor THEN RAISE EXCEPTION 'Invoice line total mismatch'; END IF;
  SELECT coalesce(sum(amount_minor),0) INTO paid FROM billing_payments WHERE hospital_id=inv.hospital_id AND invoice_id=target;
  SELECT count(*),max(revision),coalesce(bool_or(action='invoice.void'),false) INTO event_count,last_revision,voided FROM billing_events WHERE hospital_id=inv.hospital_id AND invoice_id=target;
  IF event_count<>last_revision OR event_count=0 OR paid>inv.total_minor OR (voided AND paid>0) THEN RAISE EXCEPTION 'Invalid invoice history'; END IF;
  IF EXISTS(SELECT 1 FROM billing_payments p WHERE p.hospital_id=inv.hospital_id AND p.invoice_id=target AND
    (NOT EXISTS(SELECT 1 FROM billing_events e WHERE e.hospital_id=p.hospital_id AND e.payment_id=p.id) OR
     NOT EXISTS(SELECT 1 FROM billing_receipts r WHERE r.hospital_id=p.hospital_id AND r.payment_id=p.id))) THEN RAISE EXCEPTION 'Payment requires event and receipt'; END IF;
  IF (SELECT coalesce(sum(i.total_minor),0) FROM billing_invoices i WHERE i.hospital_id=inv.hospital_id AND i.visit_id=inv.visit_id AND NOT EXISTS(SELECT 1 FROM billing_events e WHERE e.hospital_id=i.hospital_id AND e.invoice_id=i.id AND e.action='invoice.void'))>999999999 THEN RAISE EXCEPTION 'Visit invoice total exceeds limit'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER billing_invoice_integrity AFTER INSERT ON billing_invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_billing_invoice();
CREATE CONSTRAINT TRIGGER billing_line_integrity AFTER INSERT ON billing_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_billing_invoice();
CREATE CONSTRAINT TRIGGER billing_payment_integrity AFTER INSERT ON billing_payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_billing_invoice();
CREATE CONSTRAINT TRIGGER billing_event_integrity AFTER INSERT ON billing_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_billing_invoice();
CREATE INDEX billing_visit_invoices ON billing_invoices(hospital_id,visit_id,issued_at DESC,id DESC);
CREATE INDEX billing_invoice_events ON billing_events(hospital_id,invoice_id,revision DESC);
CREATE INDEX billing_invoice_payments ON billing_payments(hospital_id,invoice_id);
