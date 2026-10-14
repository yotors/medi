ALTER TABLE staff_users ADD COLUMN support_account boolean NOT NULL DEFAULT false;
CREATE TABLE hospital_profiles (
 hospital_id uuid PRIMARY KEY REFERENCES hospitals(id), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(settings)='object')
);
CREATE TABLE hospital_facilities (
 id uuid PRIMARY KEY, hospital_id uuid NOT NULL REFERENCES hospitals(id), code text NOT NULL,
 name text NOT NULL, address text NOT NULL, active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), UNIQUE(hospital_id,id), UNIQUE(hospital_id,code)
);
CREATE TABLE hospital_record_requests (
 id uuid PRIMARY KEY, hospital_id uuid NOT NULL REFERENCES hospitals(id), patient_id uuid NOT NULL,
 requester text NOT NULL, purpose text NOT NULL, identity_verification text NOT NULL,
 status text NOT NULL CHECK(status IN('pending','approved','denied','fulfilled')), revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(hospital_id,id), FOREIGN KEY(hospital_id,patient_id) REFERENCES patients(hospital_id,id)
);
CREATE TABLE hospital_record_holds (
 id uuid PRIMARY KEY, hospital_id uuid NOT NULL REFERENCES hospitals(id), patient_id uuid NOT NULL,
 reason text NOT NULL, active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1,
 UNIQUE(hospital_id,id), FOREIGN KEY(hospital_id,patient_id) REFERENCES patients(hospital_id,id)
);
CREATE TABLE hospital_support_grants (
 hospital_id uuid NOT NULL REFERENCES hospitals(id), user_id uuid PRIMARY KEY,
 approved_by uuid NOT NULL, purpose text NOT NULL, expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false,
 FOREIGN KEY(hospital_id,user_id) REFERENCES staff_users(hospital_id,id),
 FOREIGN KEY(hospital_id,approved_by) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE hospital_governance_events (
 id uuid PRIMARY KEY, hospital_id uuid NOT NULL REFERENCES hospitals(id), actor_id uuid NOT NULL,
 action text NOT NULL, entity_id uuid, reason text NOT NULL, snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE hospital_governance_requests (
 hospital_id uuid NOT NULL REFERENCES hospitals(id), idempotency_key uuid NOT NULL,
 actor_id uuid NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL,
 PRIMARY KEY(hospital_id,idempotency_key), FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE INDEX hospital_governance_history ON hospital_governance_events(hospital_id,created_at DESC,id);
CREATE INDEX hospital_record_request_directory ON hospital_record_requests(hospital_id,status,created_at DESC,id);
-- Auth bootstrap is narrowly scoped before a tenant transaction exists. Never put
-- an identity resolver or the shared bounded rejection aggregates behind this GUC.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT t.tablename FROM pg_tables t JOIN information_schema.columns c
  ON c.table_schema=t.schemaname AND c.table_name=t.tablename
  WHERE t.schemaname=current_schema() AND c.column_name='hospital_id'
  AND t.tablename NOT IN('staff_users','staff_factors','staff_mfa_grants','staff_mfa_pending',
   'staff_recovery_codes','identity_security_events','hospital_support_grants')
 LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',item.tablename);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (hospital_id::text = current_setting(''medi.hospital_id'',true)) WITH CHECK (hospital_id::text = current_setting(''medi.hospital_id'',true))',item.tablename);
 END LOOP;
END $$;
