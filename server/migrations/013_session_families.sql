-- Preserve one device session lineage across MFA elevation and logout races.
ALTER TABLE staff_sessions ADD COLUMN family_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE INDEX staff_sessions_family ON staff_sessions(user_id,family_id);
ALTER TABLE staff_sessions ADD COLUMN logout_only boolean NOT NULL DEFAULT false;
