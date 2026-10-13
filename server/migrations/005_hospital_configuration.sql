CREATE TABLE hospital_departments (
  id uuid PRIMARY KEY, hospital_id uuid NOT NULL REFERENCES hospitals(id),
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_-]{1,31}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE(hospital_id,id), UNIQUE(hospital_id,code)
);
CREATE TABLE hospital_services (
  id uuid PRIMARY KEY, hospital_id uuid NOT NULL REFERENCES hospitals(id),
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_-]{1,31}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE(hospital_id,id), UNIQUE(hospital_id,code)
);
CREATE TABLE hospital_service_versions (
  hospital_id uuid NOT NULL, service_id uuid NOT NULL, revision integer NOT NULL CHECK (revision > 0),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120), active boolean NOT NULL,
  department_id uuid NOT NULL, department_code text NOT NULL, department_name text NOT NULL,
  price_minor integer NOT NULL CHECK (price_minor BETWEEN 0 AND 999999999),
  currency text NOT NULL DEFAULT 'ETB' CHECK (currency = 'ETB'),
  actor_id uuid NOT NULL, actor_name text NOT NULL, effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(hospital_id,service_id,revision),
  FOREIGN KEY(hospital_id,service_id) REFERENCES hospital_services(hospital_id,id),
  FOREIGN KEY(hospital_id,department_id) REFERENCES hospital_departments(hospital_id,id),
  FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
ALTER TABLE hospital_services ADD CONSTRAINT service_current_version FOREIGN KEY(hospital_id,id,revision)
  REFERENCES hospital_service_versions(hospital_id,service_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE hospital_configuration_events (
  id uuid PRIMARY KEY, hospital_id uuid NOT NULL REFERENCES hospitals(id), actor_id uuid NOT NULL, actor_name text NOT NULL,
  department_id uuid, service_id uuid, revision integer NOT NULL CHECK(revision > 0),
  action text NOT NULL CHECK(action IN ('department.create','department.update','service.create','service.update')),
  snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((department_id IS NULL) <> (service_id IS NULL)),
  FOREIGN KEY(hospital_id,department_id) REFERENCES hospital_departments(hospital_id,id),
  FOREIGN KEY(hospital_id,service_id) REFERENCES hospital_services(hospital_id,id),
  FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id),
  UNIQUE(hospital_id,department_id,revision), UNIQUE(hospital_id,service_id,revision)
);
CREATE TABLE hospital_configuration_requests (
  hospital_id uuid NOT NULL REFERENCES hospitals(id), idempotency_key uuid NOT NULL, actor_id uuid NOT NULL,
  payload_hash text NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY(hospital_id,idempotency_key),
  FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE FUNCTION protect_configuration_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Configuration history is immutable'; END;
$$;
CREATE TRIGGER immutable_service_version BEFORE UPDATE OR DELETE ON hospital_service_versions FOR EACH ROW EXECUTE FUNCTION protect_configuration_history();
CREATE TRIGGER immutable_configuration_event BEFORE UPDATE OR DELETE ON hospital_configuration_events FOR EACH ROW EXECUTE FUNCTION protect_configuration_history();
CREATE TRIGGER immutable_configuration_request BEFORE UPDATE OR DELETE ON hospital_configuration_requests FOR EACH ROW EXECUTE FUNCTION protect_configuration_history();
CREATE INDEX configuration_department_search ON hospital_departments(hospital_id,code);
CREATE INDEX configuration_service_search ON hospital_services(hospital_id,code);
