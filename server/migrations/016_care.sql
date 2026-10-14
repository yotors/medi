CREATE TABLE care_records (
 id uuid PRIMARY KEY, hospital_id uuid NOT NULL REFERENCES hospitals(id),
 kind text NOT NULL CHECK(kind IN ('profile','appointment','triage','ward','bed','admission','nursing','medication','administration','referral')),
 patient_id uuid, parent_id uuid, responsible_id uuid, encounter_id uuid,
 revision integer NOT NULL CHECK(revision>0), data jsonb NOT NULL,
 actor_id uuid NOT NULL, actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(hospital_id,id),
 FOREIGN KEY(hospital_id,patient_id) REFERENCES patients(hospital_id,id),
 FOREIGN KEY(hospital_id,parent_id) REFERENCES care_records(hospital_id,id),
 FOREIGN KEY(hospital_id,responsible_id) REFERENCES staff_users(hospital_id,id),
 FOREIGN KEY(hospital_id,encounter_id) REFERENCES outpatient_visits(hospital_id,id),
 FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id),
 CHECK ((kind IN ('ward','bed')) = (patient_id IS NULL))
);
CREATE UNIQUE INDEX care_profile_patient ON care_records(hospital_id,patient_id) WHERE kind='profile';
CREATE UNIQUE INDEX care_active_admission_patient ON care_records(hospital_id,patient_id) WHERE kind='admission' AND data->>'status'='active';
CREATE UNIQUE INDEX care_active_admission_bed ON care_records(hospital_id,parent_id) WHERE kind='admission' AND data->>'status'='active';
CREATE UNIQUE INDEX care_medication_outcome ON care_records(hospital_id,parent_id) WHERE kind='administration';
CREATE INDEX care_directory ON care_records(hospital_id,kind,updated_at DESC,id);
CREATE INDEX care_patient ON care_records(hospital_id,patient_id,kind);
CREATE TABLE care_events (
 id uuid PRIMARY KEY, hospital_id uuid NOT NULL REFERENCES hospitals(id), record_id uuid NOT NULL,
 revision integer NOT NULL, actor_id uuid NOT NULL, actor_name text NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000), data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(hospital_id,record_id,revision),
 FOREIGN KEY(hospital_id,record_id) REFERENCES care_records(hospital_id,id),
 FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE care_requests (
 hospital_id uuid NOT NULL REFERENCES hospitals(id), idempotency_key uuid NOT NULL, actor_id uuid NOT NULL,
 payload_hash text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(hospital_id,idempotency_key),
 FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE care_identity_links (
 hospital_id uuid NOT NULL REFERENCES hospitals(id), duplicate_id uuid NOT NULL, canonical_id uuid NOT NULL,
 actor_id uuid NOT NULL, actor_name text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(hospital_id,duplicate_id), CHECK(duplicate_id<>canonical_id),
 FOREIGN KEY(hospital_id,duplicate_id) REFERENCES patients(hospital_id,id),
 FOREIGN KEY(hospital_id,canonical_id) REFERENCES patients(hospital_id,id),
 FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE FUNCTION protect_care_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Care history is immutable'; END; $$;
CREATE TRIGGER immutable_care_event BEFORE UPDATE OR DELETE ON care_events FOR EACH ROW EXECUTE FUNCTION protect_care_history();
CREATE TRIGGER immutable_care_request BEFORE UPDATE OR DELETE ON care_requests FOR EACH ROW EXECUTE FUNCTION protect_care_history();
CREATE TRIGGER immutable_care_link BEFORE UPDATE OR DELETE ON care_identity_links FOR EACH ROW EXECUTE FUNCTION protect_care_history();
ALTER TABLE staff_users DROP CONSTRAINT staff_users_role_check;
ALTER TABLE staff_users ADD CONSTRAINT staff_users_role_check CHECK(role IN ('admin','receptionist','auditor','clinician','lab','pharmacist','cashier','nurse'));
ALTER TABLE staff_administration_events DROP CONSTRAINT staff_administration_events_role_check;
ALTER TABLE staff_administration_events ADD CONSTRAINT staff_administration_events_role_check CHECK(role IN ('admin','receptionist','auditor','clinician','lab','pharmacist','cashier','nurse'));
