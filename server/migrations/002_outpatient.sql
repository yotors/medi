ALTER TABLE staff_users DROP CONSTRAINT staff_users_role_check;
ALTER TABLE staff_users ADD CONSTRAINT staff_users_role_check
  CHECK (role IN ('admin','receptionist','auditor','clinician','lab','pharmacist','cashier'));

CREATE TABLE outpatient_visits (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  patient_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('active','closed')),
  opened_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  UNIQUE (hospital_id,id),
  FOREIGN KEY (hospital_id,patient_id) REFERENCES patients(hospital_id,id),
  CHECK (data->>'id' = id::text AND data->>'patientId' = patient_id::text AND data->>'status' = status)
);
CREATE UNIQUE INDEX outpatient_one_active_visit ON outpatient_visits(hospital_id,patient_id) WHERE status='active';
CREATE INDEX outpatient_queue ON outpatient_visits(hospital_id,status,opened_at DESC,id DESC);

CREATE TABLE outpatient_requests (
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  idempotency_key uuid NOT NULL,
  payload_hash text NOT NULL,
  visit_id uuid NOT NULL,
  PRIMARY KEY (hospital_id,idempotency_key),
  FOREIGN KEY (hospital_id,visit_id) REFERENCES outpatient_visits(hospital_id,id)
);

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (
  action IN ('patient.registered','visit.checkIn','visit.note','visit.order','visit.advanceOrder','visit.prescribe','visit.fulfill','visit.settle','visit.close')
);
ALTER TABLE audit_events ADD COLUMN visit_id uuid;
ALTER TABLE audit_events ADD COLUMN visit_revision integer;
ALTER TABLE audit_events ADD COLUMN detail text;
ALTER TABLE audit_events ADD FOREIGN KEY (hospital_id,visit_id) REFERENCES outpatient_visits(hospital_id,id);
ALTER TABLE audit_events ADD UNIQUE (hospital_id,visit_id,visit_revision);
ALTER TABLE audit_events ADD CHECK (
  (action='patient.registered' AND visit_id IS NULL AND visit_revision IS NULL)
  OR (action<>'patient.registered' AND visit_id IS NOT NULL AND visit_revision > 0 AND detail IS NOT NULL)
);

-- Defense in depth: even an accidental future writer cannot rewrite closed
-- visits or a released result. The application remains responsible for commands.
CREATE FUNCTION protect_outpatient_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='closed' THEN
    RAISE EXCEPTION 'Closed visits are immutable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(OLD.data->'orders') old_order
    WHERE old_order->>'status' IN ('released','reviewed') AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.data->'orders') new_order
      WHERE new_order->>'id'=old_order->>'id'
        AND new_order->>'result'=old_order->>'result'
        AND new_order->>'test'=old_order->>'test'
        AND (new_order->>'status'=old_order->>'status'
          OR (old_order->>'status'='released' AND new_order->>'status'='reviewed'))
    )
  ) THEN RAISE EXCEPTION 'Released results are immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER outpatient_history_guard BEFORE UPDATE ON outpatient_visits
FOR EACH ROW EXECUTE FUNCTION protect_outpatient_history();
