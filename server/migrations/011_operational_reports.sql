CREATE TABLE report_access_events (
  id uuid PRIMARY KEY, hospital_id uuid NOT NULL REFERENCES hospitals(id), actor_id uuid NOT NULL,
  actor_name text NOT NULL, actor_role text NOT NULL CHECK(actor_role IN ('admin','auditor','clinician','cashier','pharmacist')),
  report_kind text NOT NULL CHECK(report_kind='operational'), date_from date NOT NULL, date_to date NOT NULL,
  generated_at timestamptz NOT NULL, authorized_sections text[] NOT NULL,
  inventory_page integer NOT NULL CHECK(inventory_page BETWEEN 1 AND 10000), page_size integer NOT NULL CHECK(page_size=25),
  product_row_count integer NOT NULL CHECK(product_row_count BETWEEN 0 AND 25),
  CHECK(date_to>=date_from AND date_to-date_from<366),
  CHECK(authorized_sections = CASE actor_role WHEN 'admin' THEN ARRAY['operations','finance','inventory'] WHEN 'auditor' THEN ARRAY['operations','finance','inventory'] WHEN 'clinician' THEN ARRAY['operations'] WHEN 'cashier' THEN ARRAY['finance'] ELSE ARRAY['inventory'] END),
  FOREIGN KEY(hospital_id,actor_id) REFERENCES staff_users(hospital_id,id)
);
CREATE FUNCTION protect_report_access_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Report access history is immutable'; END; $$;
CREATE TRIGGER immutable_report_access BEFORE UPDATE OR DELETE ON report_access_events FOR EACH ROW EXECUTE FUNCTION protect_report_access_history();
CREATE INDEX report_access_hospital_time ON report_access_events(hospital_id,generated_at,id);
