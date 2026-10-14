ALTER TABLE identity_security_events DROP CONSTRAINT identity_security_events_event_check;
ALTER TABLE identity_security_events ADD CONSTRAINT identity_security_events_event_check CHECK (event IN ('grant.issued','factor.reset','factor.enrolled','factor.verified','factor.recovered','codes.regenerated','factor.replaced','keys.rotated','password.accepted','authentication.completed','session.logout'));
ALTER TABLE mfa_rejection_buckets DROP CONSTRAINT mfa_rejection_buckets_operation_check;
ALTER TABLE mfa_rejection_buckets ADD CONSTRAINT mfa_rejection_buckets_operation_check CHECK (operation IN ('verify','start','recover','confirm','regenerate','replace','grant','login','request'));
-- 9 operations x 3 outcomes x 24 rotating hours = at most 648 rows.
