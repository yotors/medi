CREATE TABLE inventory_products (
  id uuid PRIMARY KEY,hospital_id uuid NOT NULL REFERENCES hospitals(id),
  code text NOT NULL,name text NOT NULL,unit text NOT NULL,active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  UNIQUE(hospital_id,id),UNIQUE(hospital_id,code)
);
CREATE TABLE inventory_batches (
  id uuid PRIMARY KEY,hospital_id uuid NOT NULL,product_id uuid NOT NULL,lot text NOT NULL,expiry date NOT NULL,
  quarantined boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  UNIQUE(hospital_id,id),UNIQUE(hospital_id,product_id,lot),
  FOREIGN KEY(hospital_id,product_id) REFERENCES inventory_products(hospital_id,id)
);
CREATE TABLE inventory_authorizations (
  id uuid PRIMARY KEY,hospital_id uuid NOT NULL,visit_id uuid NOT NULL,prescription_id uuid NOT NULL,product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),actor_id uuid NOT NULL,actor_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(hospital_id,id),UNIQUE(hospital_id,visit_id,prescription_id),
  FOREIGN KEY(hospital_id,visit_id) REFERENCES outpatient_visits(hospital_id,id),
  FOREIGN KEY(hospital_id,product_id) REFERENCES inventory_products(hospital_id,id),
  FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE inventory_events (
  id uuid PRIMARY KEY,hospital_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('product.create','product.status','batch.create','batch.status','stock.receive','stock.adjust','authorize','dispense','cancel')),
  product_id uuid NOT NULL,batch_id uuid,visit_id uuid,prescription_id uuid,actor_id uuid NOT NULL,actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),snapshot jsonb NOT NULL,
  UNIQUE(hospital_id,id),
  FOREIGN KEY(hospital_id,product_id) REFERENCES inventory_products(hospital_id,id),
  FOREIGN KEY(hospital_id,batch_id) REFERENCES inventory_batches(hospital_id,id),
  FOREIGN KEY(hospital_id,visit_id) REFERENCES outpatient_visits(hospital_id,id),
  FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY,hospital_id uuid NOT NULL,batch_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('stock.receive','stock.adjust','dispense')),
  quantity integer NOT NULL CHECK(quantity BETWEEN -1000000 AND 1000000 AND quantity<>0),
  CHECK((kind='stock.receive' AND quantity>0) OR kind='stock.adjust' OR (kind='dispense' AND quantity<0)),
  UNIQUE(hospital_id,id),
  FOREIGN KEY(hospital_id,batch_id) REFERENCES inventory_batches(hospital_id,id),
  FOREIGN KEY(hospital_id,id) REFERENCES inventory_events(hospital_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE inventory_dispenses (
  id uuid PRIMARY KEY,hospital_id uuid NOT NULL,authorization_id uuid NOT NULL,movement_id uuid,
  kind text NOT NULL CHECK(kind IN ('dispense','cancel')),quantity integer NOT NULL CHECK(quantity BETWEEN 0 AND 1000000),
  visit_revision integer NOT NULL CHECK(visit_revision>0),
  CHECK((kind='dispense' AND movement_id=id AND quantity>0) OR (kind='cancel' AND movement_id IS NULL AND quantity=0)),
  FOREIGN KEY(hospital_id,authorization_id) REFERENCES inventory_authorizations(hospital_id,id),
  FOREIGN KEY(hospital_id,movement_id) REFERENCES inventory_movements(hospital_id,id),
  FOREIGN KEY(hospital_id,id) REFERENCES inventory_events(hospital_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX inventory_one_cancel ON inventory_dispenses(hospital_id,authorization_id) WHERE kind='cancel';
CREATE TABLE inventory_requests (
  hospital_id uuid NOT NULL REFERENCES hospitals(id),idempotency_key uuid NOT NULL,actor_id uuid NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,
  PRIMARY KEY(hospital_id,idempotency_key),FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE FUNCTION protect_inventory_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Inventory history is immutable'; END; $$;
CREATE TRIGGER immutable_inventory_authorization BEFORE UPDATE OR DELETE ON inventory_authorizations FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
CREATE TRIGGER immutable_inventory_event BEFORE UPDATE OR DELETE ON inventory_events FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
CREATE TRIGGER immutable_inventory_movement BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
CREATE TRIGGER immutable_inventory_dispense BEFORE UPDATE OR DELETE ON inventory_dispenses FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
CREATE TRIGGER immutable_inventory_request BEFORE UPDATE OR DELETE ON inventory_requests FOR EACH ROW EXECUTE FUNCTION protect_inventory_history();
CREATE FUNCTION protect_inventory_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(OLD)-'revision'-'active'-'quarantined') IS DISTINCT FROM (to_jsonb(NEW)-'revision'-'active'-'quarantined') THEN
    RAISE EXCEPTION 'Inventory identity is immutable';
  END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Inventory revision must advance once'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER inventory_product_identity BEFORE UPDATE OR DELETE ON inventory_products FOR EACH ROW EXECUTE FUNCTION protect_inventory_identity();
CREATE TRIGGER inventory_batch_identity BEFORE UPDATE OR DELETE ON inventory_batches FOR EACH ROW EXECUTE FUNCTION protect_inventory_identity();
CREATE FUNCTION validate_inventory_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE balance bigint;
BEGIN
  SELECT coalesce(sum(quantity),0) INTO balance FROM inventory_movements WHERE hospital_id=NEW.hospital_id AND batch_id=NEW.batch_id;
  IF balance<0 OR balance>1000000000 THEN RAISE EXCEPTION 'Invalid stock balance'; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_events e WHERE e.hospital_id=NEW.hospital_id AND e.id=NEW.id AND e.batch_id=NEW.batch_id AND e.action=NEW.kind) THEN RAISE EXCEPTION 'Stock movement needs matching audit'; END IF;
  IF NEW.kind='dispense' AND NOT EXISTS(SELECT 1 FROM inventory_dispenses d JOIN inventory_authorizations a ON a.hospital_id=d.hospital_id AND a.id=d.authorization_id JOIN inventory_batches b ON b.hospital_id=a.hospital_id AND b.product_id=a.product_id WHERE d.hospital_id=NEW.hospital_id AND d.id=NEW.id AND d.quantity=-NEW.quantity AND b.id=NEW.batch_id) THEN RAISE EXCEPTION 'Dispense movement needs matching authorized supply'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER inventory_movement_integrity AFTER INSERT ON inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_inventory_movement();
CREATE FUNCTION validate_inventory_dispense() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE auth inventory_authorizations%ROWTYPE; supplied bigint;
BEGIN
  SELECT * INTO auth FROM inventory_authorizations WHERE hospital_id=NEW.hospital_id AND id=NEW.authorization_id;
  SELECT coalesce(sum(quantity),0) INTO supplied FROM inventory_dispenses WHERE hospital_id=NEW.hospital_id AND authorization_id=NEW.authorization_id;
  IF supplied>auth.quantity THEN RAISE EXCEPTION 'Dispense exceeds authorization'; END IF;
  IF NOT EXISTS(SELECT 1 FROM audit_events WHERE hospital_id=NEW.hospital_id AND visit_id=auth.visit_id AND visit_revision=NEW.visit_revision AND subject_id=auth.prescription_id AND action IN ('visit.dispense','visit.inventoryCancel')) THEN RAISE EXCEPTION 'Supply requires matching visit audit'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER inventory_dispense_integrity AFTER INSERT ON inventory_dispenses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_inventory_dispense();
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK(action IN ('patient.registered','visit.checkIn','visit.note','visit.order','visit.advanceOrder','visit.prescribe','visit.fulfill','visit.settle','visit.close','visit.authorize','visit.dispense','visit.inventoryCancel'));
CREATE INDEX inventory_batch_product ON inventory_batches(hospital_id,product_id,expiry,id);
CREATE INDEX inventory_batch_movements ON inventory_movements(hospital_id,batch_id);
CREATE INDEX inventory_authorization_supply ON inventory_dispenses(hospital_id,authorization_id);
CREATE INDEX inventory_event_history ON inventory_events(hospital_id,created_at DESC,id DESC);
