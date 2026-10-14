-- Clinical overlays never rewrite the original visit, including closed visits.
CREATE TABLE clinical_amendments (
  id uuid PRIMARY KEY, hospital_id uuid NOT NULL, visit_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('note','result')), subject_id uuid NOT NULL,
  body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 4000),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
  UNIQUE(hospital_id,visit_id,kind,subject_id,id),
  FOREIGN KEY(hospital_id,visit_id) REFERENCES outpatient_visits(hospital_id,id)
);
CREATE TABLE clinical_events (
  id uuid PRIMARY KEY, hospital_id uuid NOT NULL, visit_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('note','result')), subject_id uuid NOT NULL,
  amendment_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
  action text NOT NULL CHECK(action IN ('note.amend','result.correct','result.review','result.takeover')),
  actor_id uuid NOT NULL, actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  owner_id uuid, owner_name text, reason text,
  CHECK((kind='note')=(action='note.amend')),
  CHECK((action IN ('note.amend','result.correct'))=(id=amendment_id)),
  CHECK((action IN ('result.correct','result.takeover') AND owner_id IS NOT NULL AND owner_name IS NOT NULL)
    OR (action NOT IN ('result.correct','result.takeover') AND owner_id IS NULL AND owner_name IS NULL)),
  CHECK((action='result.takeover' AND reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 500 AND owner_id=actor_id)
    OR (action<>'result.takeover' AND reason IS NULL)),
  UNIQUE(hospital_id,visit_id,kind,subject_id,version),
  FOREIGN KEY(hospital_id,visit_id,kind,subject_id,amendment_id) REFERENCES clinical_amendments(hospital_id,visit_id,kind,subject_id,id),
  FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id),
  FOREIGN KEY(hospital_id,owner_id) REFERENCES staff_users(hospital_id,id)
);
CREATE TABLE clinical_requests (
  hospital_id uuid NOT NULL REFERENCES hospitals(id), idempotency_key uuid NOT NULL,
  actor_id uuid NOT NULL, visit_id uuid NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY(hospital_id,idempotency_key),
  FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id),
  FOREIGN KEY(hospital_id,visit_id) REFERENCES outpatient_visits(hospital_id,id)
);
CREATE FUNCTION protect_clinical_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Clinical correction history is immutable'; END;
$$;
CREATE TRIGGER immutable_clinical_amendment BEFORE UPDATE OR DELETE ON clinical_amendments FOR EACH ROW EXECUTE FUNCTION protect_clinical_history();
CREATE TRIGGER immutable_clinical_event BEFORE UPDATE OR DELETE ON clinical_events FOR EACH ROW EXECUTE FUNCTION protect_clinical_history();
CREATE TRIGGER immutable_clinical_request BEFORE UPDATE OR DELETE ON clinical_requests FOR EACH ROW EXECUTE FUNCTION protect_clinical_history();
CREATE INDEX clinical_visit_events ON clinical_events(hospital_id,visit_id,kind,subject_id,version);
CREATE INDEX clinical_amendment_events ON clinical_events(hospital_id,amendment_id,version);
