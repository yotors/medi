-- Existing sessions never inherit factor completion.
DELETE FROM staff_sessions;
ALTER TABLE staff_users ADD COLUMN factor_generation integer NOT NULL DEFAULT 0;
ALTER TABLE staff_sessions ADD COLUMN auth_state text NOT NULL DEFAULT 'enrollment' CHECK (auth_state IN ('enrollment','challenge','recovery_enrollment','complete'));
ALTER TABLE staff_sessions ADD COLUMN factor_generation integer NOT NULL DEFAULT 0;
ALTER TABLE staff_sessions ADD COLUMN idle_expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '30 minutes');
ALTER TABLE staff_sessions ADD COLUMN restricted_expires_at timestamptz;
CREATE TABLE staff_factors (
 hospital_id uuid NOT NULL, user_id uuid PRIMARY KEY, envelope jsonb NOT NULL,
 last_counter bigint NOT NULL DEFAULT -1,
 FOREIGN KEY (hospital_id,user_id) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE staff_mfa_grants (
 hospital_id uuid NOT NULL, user_id uuid PRIMARY KEY, grant_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 FOREIGN KEY (hospital_id,user_id) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE staff_mfa_pending (
 hospital_id uuid NOT NULL, user_id uuid PRIMARY KEY, session_hash text NOT NULL REFERENCES staff_sessions(token_hash) ON DELETE CASCADE,
 envelope jsonb NOT NULL, expires_at timestamptz NOT NULL,
 FOREIGN KEY (hospital_id,user_id) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE staff_recovery_codes (
 hospital_id uuid NOT NULL, user_id uuid NOT NULL, code_hash text NOT NULL,
 PRIMARY KEY (hospital_id,user_id,code_hash),
 FOREIGN KEY (hospital_id,user_id) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE identity_security_events (
 id uuid PRIMARY KEY, hospital_id uuid NOT NULL, user_id uuid NOT NULL,
 actor_id uuid, operator_reference text,
 event text NOT NULL CHECK (event IN ('grant.issued','factor.reset','factor.enrolled','factor.verified','factor.recovered','codes.regenerated','factor.replaced','keys.rotated')),
 reason text CHECK (reason IN ('initial_enrollment','lost_all_factors','compromised_factor')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (hospital_id,user_id) REFERENCES staff_users(hospital_id,id),
 FOREIGN KEY (hospital_id,actor_id) REFERENCES staff_users(hospital_id,id),
 CHECK ((actor_id IS NOT NULL) <> (operator_reference IS NOT NULL))
);
CREATE INDEX staff_mfa_pending_expiry ON staff_mfa_pending(expires_at);
