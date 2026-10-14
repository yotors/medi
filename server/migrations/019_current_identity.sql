ALTER TABLE staff_users ADD CONSTRAINT support_auditor_only CHECK(NOT support_account OR role='auditor');
-- Invoker privileges and the underlying tenant policies apply to every caller.
-- Corrected display values do not overwrite the original registration facts.
CREATE VIEW patient_directory WITH(security_invoker=true) AS
 SELECT p.id,p.hospital_id,p.record_number,
 COALESCE(c.data->>'name',p.name) AS name,
 lower(regexp_replace(normalize(COALESCE(c.data->>'name',p.name),NFKC),'\s+',' ','g')) AS normalized_name,
 p.age,COALESCE(c.data->>'contact',p.contact) AS contact,p.created_at,
 c.data->>'dateOfBirth' AS date_of_birth,l.canonical_id,canonical.record_number AS canonical_record_number
 FROM patients p LEFT JOIN care_records c ON c.hospital_id=p.hospital_id AND c.patient_id=p.id AND c.kind='profile'
 LEFT JOIN care_identity_links l ON l.hospital_id=p.hospital_id AND l.duplicate_id=p.id
 LEFT JOIN patients canonical ON canonical.hospital_id=l.hospital_id AND canonical.id=l.canonical_id;
