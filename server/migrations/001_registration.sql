CREATE TABLE hospitals (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]{1,60}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  next_record_number bigint NOT NULL DEFAULT 1
);
CREATE TABLE staff_users (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  username text NOT NULL CHECK (length(username) BETWEEN 1 AND 100),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  role text NOT NULL CHECK (role IN ('admin', 'receptionist', 'auditor')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (hospital_id, username),
  UNIQUE (hospital_id, id)
);
CREATE TABLE staff_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES staff_users(id),
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_sessions_expiry ON staff_sessions(expires_at);
CREATE TABLE login_buckets (
  bucket_hash text PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX login_buckets_expiry ON login_buckets(expires_at);
CREATE TABLE patients (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  record_number text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  normalized_name text NOT NULL,
  age integer CHECK (age BETWEEN 0 AND 120),
  contact text NOT NULL DEFAULT '' CHECK (length(contact) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, record_number),
  UNIQUE (hospital_id, id)
);
CREATE INDEX patients_directory ON patients(hospital_id, created_at DESC, id DESC);
CREATE INDEX patients_duplicate_name ON patients(hospital_id, normalized_name);
CREATE TABLE registration_requests (
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  idempotency_key uuid NOT NULL,
  payload_hash text NOT NULL,
  patient_id uuid NOT NULL,
  PRIMARY KEY (hospital_id, idempotency_key),
  FOREIGN KEY (hospital_id, patient_id) REFERENCES patients(hospital_id, id)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  hospital_id uuid NOT NULL REFERENCES hospitals(id),
  actor_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  action text NOT NULL CHECK (action = 'patient.registered'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (hospital_id, actor_id) REFERENCES staff_users(hospital_id, id),
  FOREIGN KEY (hospital_id, patient_id) REFERENCES patients(hospital_id, id)
);
