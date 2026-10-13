-- CHECK accepts NULL, so require the complete identity predicate to be true.
-- Keep the original constraints and all existing data in place.
ALTER TABLE outpatient_visits ADD CONSTRAINT outpatient_identity_required CHECK (
  (data->>'id' = id::text AND data->>'patientId' = patient_id::text AND data->>'status' = status) IS TRUE
);
ALTER TABLE audit_events ADD CONSTRAINT outpatient_audit_revision_required CHECK (
  action='patient.registered' OR visit_revision IS NOT NULL
);

-- Old events retain NULL metadata. New server events identify their exact
-- subject and transition without copying notes, results or instructions.
ALTER TABLE audit_events ADD COLUMN subject_type text;
ALTER TABLE audit_events ADD COLUMN subject_id uuid;
ALTER TABLE audit_events ADD COLUMN transition_from text;
ALTER TABLE audit_events ADD COLUMN transition_to text;
ALTER TABLE audit_events ADD CONSTRAINT outpatient_audit_subject_complete CHECK (
  (subject_type IS NULL AND subject_id IS NULL AND transition_from IS NULL AND transition_to IS NULL)
  OR (subject_type IS NOT NULL AND subject_type IN ('visit','note','investigation','prescription','payment')
    AND subject_id IS NOT NULL AND transition_to IS NOT NULL)
);
