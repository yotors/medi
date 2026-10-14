-- Fixed enums and 24 rotating hourly slots bound cardinality to 504 rows.
-- No submitted identifiers, actor guesses, addresses, or proof material.
CREATE TABLE mfa_rejection_buckets (
 operation text NOT NULL CHECK (operation IN ('verify','start','recover','confirm','regenerate','replace','grant')),
 outcome text NOT NULL CHECK (outcome IN ('denied','limited','unavailable')),
 slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 23),
 bucket_hour bigint NOT NULL,
 attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 1000000),
 PRIMARY KEY(operation,outcome,slot)
);
