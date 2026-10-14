CREATE TABLE department_records(id uuid PRIMARY KEY,hospital_id uuid NOT NULL REFERENCES hospitals(id),kind text NOT NULL CHECK(kind IN ('catalog','specimen','supplier','purchase','return','shift','finance')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),data jsonb NOT NULL,UNIQUE(hospital_id,id));
CREATE INDEX department_records_kind ON department_records(hospital_id,kind,id);
CREATE TABLE department_events(id uuid PRIMARY KEY,hospital_id uuid NOT NULL,entity_id uuid NOT NULL,action text NOT NULL,actor_id uuid NOT NULL,actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),snapshot jsonb NOT NULL,UNIQUE(hospital_id,id),FOREIGN KEY(hospital_id,entity_id) REFERENCES department_records(hospital_id,id),FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id));
CREATE INDEX department_events_history ON department_events(hospital_id,entity_id,created_at DESC,id);
CREATE TABLE department_requests(hospital_id uuid NOT NULL REFERENCES hospitals(id),idempotency_key uuid NOT NULL,actor_id uuid NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(hospital_id,idempotency_key),FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id));
CREATE TABLE department_finance(id uuid PRIMARY KEY,hospital_id uuid NOT NULL,invoice_id uuid NOT NULL,payment_id uuid,kind text NOT NULL CHECK(kind IN ('credit','discount','refund','reversal')),amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 999999999),reason text NOT NULL,actor_id uuid NOT NULL,actor_name text NOT NULL,authority_id uuid NOT NULL,method text,reference text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(hospital_id,id),FOREIGN KEY(hospital_id,invoice_id) REFERENCES billing_invoices(hospital_id,id),FOREIGN KEY(hospital_id,invoice_id,payment_id) REFERENCES billing_payments(hospital_id,invoice_id,id),FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id),FOREIGN KEY(hospital_id,authority_id) REFERENCES staff_users(hospital_id,id));
CREATE INDEX department_finance_invoice ON department_finance(hospital_id,invoice_id);
CREATE TABLE department_allocations(hospital_id uuid NOT NULL,shift_id uuid NOT NULL,payment_id uuid,refund_id uuid,amount_minor integer NOT NULL, CHECK((payment_id IS NULL)<>(refund_id IS NULL)),FOREIGN KEY(hospital_id,shift_id) REFERENCES department_records(hospital_id,id),FOREIGN KEY(hospital_id,payment_id) REFERENCES billing_payments(hospital_id,id),FOREIGN KEY(hospital_id,refund_id) REFERENCES department_finance(hospital_id,id));
CREATE UNIQUE INDEX department_allocate_payment ON department_allocations(hospital_id,payment_id);
CREATE UNIQUE INDEX department_allocate_refund ON department_allocations(hospital_id,refund_id);
CREATE TABLE department_links(hospital_id uuid NOT NULL,record_id uuid NOT NULL,visit_id uuid,product_id uuid,batch_id uuid,dispense_id uuid,supplier_id uuid,clinician_id uuid,FOREIGN KEY(hospital_id,record_id) REFERENCES department_records(hospital_id,id),FOREIGN KEY(hospital_id,visit_id) REFERENCES outpatient_visits(hospital_id,id),FOREIGN KEY(hospital_id,product_id) REFERENCES inventory_products(hospital_id,id),FOREIGN KEY(hospital_id,batch_id) REFERENCES inventory_batches(hospital_id,id),FOREIGN KEY(hospital_id,dispense_id) REFERENCES inventory_events(hospital_id,id),FOREIGN KEY(hospital_id,supplier_id) REFERENCES department_records(hospital_id,id),FOREIGN KEY(hospital_id,clinician_id) REFERENCES staff_users(hospital_id,id));
CREATE TRIGGER immutable_department_event BEFORE UPDATE OR DELETE ON department_events FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
CREATE TRIGGER immutable_department_request BEFORE UPDATE OR DELETE ON department_requests FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
CREATE TRIGGER immutable_department_finance BEFORE UPDATE OR DELETE ON department_finance FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
CREATE TRIGGER immutable_department_allocation BEFORE UPDATE OR DELETE ON department_allocations FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
CREATE TRIGGER immutable_department_link BEFORE UPDATE OR DELETE ON department_links FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();

CREATE OR REPLACE FUNCTION validate_billing_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF event_count<>last_revision OR event_count=0 OR paid-coalesce((SELECT sum(amount_minor) FROM department_finance WHERE hospital_id=inv.hospital_id AND invoice_id=target AND kind IN ('refund','reversal')),0)>inv.total_minor OR (voided AND paid>0) THEN RAISE EXCEPTION 'Invalid invoice history'; END IF;
  IF EXISTS(SELECT 1 FROM billing_payments p WHERE p.hospital_id=inv.hospital_id AND p.invoice_id=target AND
    (NOT EXISTS(SELECT 1 FROM billing_events e WHERE e.hospital_id=p.hospital_id AND e.payment_id=p.id) OR
     NOT EXISTS(SELECT 1 FROM billing_receipts r WHERE r.hospital_id=p.hospital_id AND r.payment_id=p.id))) THEN RAISE EXCEPTION 'Payment requires event and receipt'; END IF;
  IF (SELECT coalesce(sum(i.total_minor),0) FROM billing_invoices i WHERE i.hospital_id=inv.hospital_id AND i.visit_id=inv.visit_id AND NOT EXISTS(SELECT 1 FROM billing_events e WHERE e.hospital_id=i.hospital_id AND e.invoice_id=i.id AND e.action='invoice.void'))>999999999 THEN RAISE EXCEPTION 'Visit invoice total exceeds limit'; END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION validate_department_finance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE charge bigint;collected bigint;credited bigint;refunded bigint;payment_total bigint;payment_refunded bigint;
BEGIN
 SELECT total_minor INTO charge FROM billing_invoices WHERE hospital_id=NEW.hospital_id AND id=NEW.invoice_id;
 SELECT coalesce(sum(amount_minor),0) INTO collected FROM billing_payments WHERE hospital_id=NEW.hospital_id AND invoice_id=NEW.invoice_id;
 SELECT coalesce(sum(amount_minor) FILTER(WHERE kind IN ('credit','discount')),0),coalesce(sum(amount_minor) FILTER(WHERE kind IN ('refund','reversal')),0) INTO credited,refunded FROM department_finance WHERE hospital_id=NEW.hospital_id AND invoice_id=NEW.invoice_id;
 IF credited>charge OR refunded>collected THEN RAISE EXCEPTION 'Invalid department financial balance'; END IF;
 IF NEW.payment_id IS NOT NULL THEN
 SELECT amount_minor INTO payment_total FROM billing_payments WHERE hospital_id=NEW.hospital_id AND id=NEW.payment_id;
 SELECT sum(amount_minor) INTO payment_refunded FROM department_finance WHERE hospital_id=NEW.hospital_id AND payment_id=NEW.payment_id;
 IF payment_refunded>payment_total THEN RAISE EXCEPTION 'Refund exceeds payment'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM department_events WHERE hospital_id=NEW.hospital_id AND entity_id=NEW.id) THEN RAISE EXCEPTION 'Financial adjustment requires audit'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER department_finance_integrity AFTER INSERT ON department_finance DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_department_finance();
CREATE FUNCTION protect_department_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.hospital_id<>OLD.hospital_id OR NEW.kind<>OLD.kind OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Invalid department record revision'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER department_record_revision BEFORE UPDATE OR DELETE ON department_records FOR EACH ROW EXECUTE FUNCTION protect_department_record();
