ALTER TABLE staff_users ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE staff_users ADD COLUMN password_change_required boolean NOT NULL DEFAULT false;
CREATE TABLE staff_administration_events (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  actor_id uuid NOT NULL,
  account_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('staff.created', 'staff.updated', 'staff.reset', 'password.changed')),
  revision integer NOT NULL CHECK (revision > 0),
  role text NOT NULL CHECK (role IN ('admin','receptionist','auditor','clinician','lab','pharmacist','cashier')),
  active boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (hospital_id, actor_id) REFERENCES staff_users(hospital_id, id),
  FOREIGN KEY (hospital_id, account_id) REFERENCES staff_users(hospital_id, id),
  UNIQUE (hospital_id, account_id, revision)
);
CREATE INDEX staff_administration_history ON staff_administration_events(hospital_id, account_id, created_at DESC);
CREATE TABLE staff_administration_requests (
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  idempotency_key uuid NOT NULL,
  actor_id uuid NOT NULL,
  payload_hash text NOT NULL,
  account_id uuid NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (hospital_id, idempotency_key),
  FOREIGN KEY (hospital_id, actor_id) REFERENCES staff_users(hospital_id, id),
  FOREIGN KEY (hospital_id, account_id) REFERENCES staff_users(hospital_id, id)
);
