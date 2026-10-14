---
title: Finish portable production installation and recovery
status: in-progress
baseline_commit: deaad870638655e5b8a313ce3319e27e072777f9
context:
 - AGENTS.md
 - _bmad-output/implementation-artifacts/spec-product-completion.md
 - compose.production.yaml
 - deploy/Caddyfile.production
 - deploy/secrets-init.mjs
 - server/secrets.ts
 - deploy/migrate.mjs
 - tooling/release-process.mjs
 - tooling/release-archive.mjs
 - docs/production-operations.md
---

Deliver actual portable production operator tooling, not only local-rehearsal
Compose. Own production Compose/config, secrets initializer/server secret-file
loading, deploy/migrate, dedicated production CLI/backup/tests and deployment
runbook. Root owns existing release tooling/gates, app, manifest/grants, cleanup
and CI. No nested agents/commits/push. Do not edit the frozen historical SQL.

1. Correct/validate draft compose.production.yaml/Caddy config (collector-storage
   still erroneously references MEDI_RELEASE_TAG), keep real pinned images, no
   private service host ports, HTTPS domain/TLS contact, exact APP_ORIGIN, nonroot
   read-only API, mandatory MFA and bounded logs/telemetry. File-based credentials
   use separate API/owner/database volumes, so API never sees owner secrets.
   Validate initializer source mode/symlinks/size/shape, directory ownership,
   atomic outputs and nonzero failures without secret diagnostics.
2. Provide production operator CLI to prepare a private installation directory
   from strict configuration (immutable API/web image identities, domain/TLS,
   approved webhook destination, backup destination, named ownership inputs),
   generate separate secrets only for fresh install without overwrite, copy
   required configs, validate effective Compose, start/status/restart safely,
   provision named hospital admin and privately issue MFA enrollment using owner
   image. No plaintext secrets in args/logs/Git. New installation must not create
   demonstration patients/accounts. No destructive down --volumes/automatic upgrade.
   Explicit maintenance/migration operation has rehearsed backup/replacement
   instructions. No real paid host/domain/external deployment is authorized now.
3. Real production backup/recovery cannot depend on release-verification.json
   synthetic login fixtures. Stream consistent pg_dump into authenticated encryption
   with independently held 32-byte key; private atomic archive publication, versioned
   authenticated header with actual image/schema identifiers, bounded parsing.
   Never write unencrypted dump to public paths. Authenticate before restoration.
   Recover-check restores only a fresh isolated private generated target, uses
   recorded images, applies explicit grants, validates schema/key readiness and
   restored integrity, cleans its owned target and fails on cleanup failure.
   Preserve original pre-MFA source archives/keys/images and source data always.
   Backup and runtime MFA keys have independent custody, no fabricated RTO.
4. Supply systemd/service/timer or equivalent operator schedule with private paths,
   encrypted backup publication to a separately mounted/offsite destination,
   failure alert and deliberate retention avoiding deletion of sole valid backup.
   Remote credential/destination setup remains operator input, never invented.
   Human alerts use configured protected webhook; tests use only local synthetic
   receiver, no messages to real people. Show exact setup and failure recovery.
5. Run one real isolated installation rehearsal with current images, private
   services/file-secrets, fresh empty hospital bootstrap/MFA, strict TLS headers,
   restart persistence, new core module write/read under RLS, scheduled encrypted
   backup and authenticated replacement restore; tampered archive/wrong key and
   occupied-target/config refusal tests. Cover immutable image validation, unsafe
   input paths/modes and rollback/publication cleanup. Record actual evidence.
   Coordinate Docker network creation/removal with root; root holds browser work
   until your drill ends. Don't run capacity while compiling/full tests.

Run focused checks only; no repeated broad release/browser rebuilds. Expose package
scripts and CI step instructions to root instead of editing those files. Write an
operator-ready runbook in docs/deployment.md (replace stale instructions), with
exact remaining external inputs and no blanket legal/clinical readiness claims.
Be concise in progress/handoff and remain available for concrete fixes.
