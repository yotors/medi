# Version 1 installation inputs

These parameterized inputs describe dedicated installations, not automatic provisioning.
Replace placeholder image references with reviewed published digests and tie them to
Git, schema 15 and config version 1. Supply secret file paths privately; never put
secret values into this bundle. External ingress remains disabled. The local
rehearsal CA and local Compose credentials are not production TLS or credentials.

Hosted: one dedicated installation per hospital; browsers -> approved public HTTPS
gateway -> private API -> private PostgreSQL. Monitoring stays private.
Hospital-local: browser clients on the hospital network -> hospital HTTPS gateway ->
private API/database. Power, equipment, secure support access and backup connectivity
need an operator. Neither template promises offline synchronization. Shared SaaS
hosting remains unapproved.

Run `npm run install:preflight -- /private/install.json` after collecting evidence.
The input evidence is an operator attestation, not a substitute for live checks.
