---
title: 'Encrypted packaged-release backup and isolated recovery'
type: 'feature'
created: '2026-10-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '9d7d0514babc8a18680b3afdc077a32f172cd277'
context:
  - '/home/habtetsega/Desktop/mpx/product-studio/AGENTS.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/docs/deployment.md'
---

<frozen-after-approval reason="User authorized completing production-readiness engineering and local Docker verification.">

## Intent

**Problem:** Existing backups apply only to the development database; the packaged installation lacks an encrypted, verifiable recovery path.

**Approach:** Produce a private authenticated encrypted archive of a consistent release snapshot and necessary configuration. Restore it only into a separate disposable installation, compare schema/data/privileges and exercise read-only application access. The source release is never overwritten.

## Boundaries & Constraints

**Always:** Fixed source project identity medi-release-local, dedicated product_studio_release database, existing private config validation. Use an external private 32-byte key file separate from archives; local key generation is explicit, no replacing keys. Authenticate all archive metadata and ciphertext before pg_restore or config consumption. Bound file lengths, metadata and timeouts. Keep secrets, patient rows, dumps and decrypted metadata out of console/errors/CI artifacts. Exclusive private temporary files and cleanup on failure. Record release image IDs/schema versions/time and snapshot inventory inside encryption. Consistent exported PostgreSQL snapshot for dump and comparison. Restore to a generated isolated project with no source volumes, no public ports and the same dedicated DB name. Cleanup only resources created by this invocation. Never delete original archives/keys/source storage automatically.

**Never:** Broaden the dev backup helper's database scope; treat encryption as offsite replication, key custody or an approved recovery objective; use mutable image tags as exact release evidence; describe current-version restore as an older-version upgrade; execute archived arbitrary commands/paths; allow in-place restore.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Backup | Healthy owned release, private valid key | Atomic encrypted archive, matching snapshot metadata and config, no plaintext accepted archive | Failed dump/exporter/encryption leaves no accepted partial archive |
| Recovery | Valid archive/key and required local images | Separate isolated database restored, inventories/grants compared, API health/auth/read checked, aggregate timing reported | Mismatch fails; source untouched |
| Authentication | Wrong key, tampered/truncated header/metadata/ciphertext/tag | Rejected before restore/config execution | Generic error; no decrypted content logged |
| Paths | Symlink, public key/config directory, unexpected archive path/format/size | Fail closed | No source or target mutation |
| Resources | Missing image, interrupted Docker command, timeout | No false success; clean created resources and private temps | Cleanup failure reported with safe resource ID |
| Writes during backup | Concurrent legitimate source writes | Dump and expected inventory use one snapshot | No comparison to a later inconsistent source state |

</frozen-after-approval>

## Code Map

- `tooling/release-local.mjs`: validates .local/release.env and exact source compose project; reuse/refactor guards without printing parsed config.
- `tooling/database.mjs`: exported snapshot plus table/schema inventory; preserve development guard. Extract common inventory function if it simplifies exact reuse.
- `compose.release.yaml`: private data network and release services; static separate recovery compose must not attach source volumes or source ports.
- `deploy/migrate.mjs`: restricted runtime role and explicit grants; recovery retains same DB name. Must not apply newer migrations while comparing original backup; verify original runtime permissions first.
- `tooling/release-verify.mjs`: synthetic private fixture plus account/session and record digest patterns; recovery must not run its source-mutating/outage workflow against source.
- Built API image already contains pg. A privileged one-off migrate container can hold exported snapshot while parent runs pg_dump within database service; no source DB port needed.

## Tasks & Acceptance

**Execution:**
- [x] `tooling/release-backup.mjs`, shared helper — implement backup/key init/recovery command entry points with validated private paths and sanitized errors. Node standard AES-256-GCM with fresh random nonce and authenticated version header is acceptable; streaming dump, bounded metadata, full tag verification before use.
- [x] `tooling/release-recovery.mjs`, `compose.recovery.yaml` — generate isolated target, restore authenticated snapshot/config, compare tables/counts/digests/schema/constraints/triggers/functions/sequences/runtime grants, then read-only API health/login/tenant check using synthetic fixture when present. No original session mutation.
- [x] `tooling/release-backup.test.mjs` — matrix tests including authentication-before-side-effect, no overwrite, private-file/symlink failures, failed subprocess cleanup and sensitive diagnostics exclusion.
- [x] `package.json`, `.github/workflows/tooling.yml` — commands and real encrypted recovery CI after packaged verifier; retain private artifacts exclusions.
- [x] `docs/deployment.md`, `docs/security-evidence.md`, `docs/production-readiness-plan.md` — exact key/archive/recovery procedure, tested limits, offsite/keycustody/RPO/RTO ownership still open.

**Acceptance Criteria:**
- Given a saved release fixture, when backing up during concurrent harmless source writes and restoring, then snapshot records/schema/grants match and the source configuration/database/volumes remain available unchanged by recovery tooling.
- Given any invalid archive/key, when recovering, then no database restore command starts and no credential or clinical content appears in output.
- Given a valid completed drill, when checking resulting evidence, then it includes source image identities, schema versions, verified record counts and observed duration, without asserting a production recovery SLA.

## Implementation Notes

The archive may contain sensitive configuration and synthetic verification credentials, but never the encryption key. Local generated key is rehearsal-only; independent custody/offsite destinations remain operator decisions. Pin documented format/limits. Prefer manageable streaming code over unbounded in-memory dump JSON. Official references: PostgreSQL16 pg_dump/exported snapshots; Node crypto AEAD final authentication requirement.

### Implementation constraints from snapshot investigation

Use the existing built migrate image to hold an exported repeatable-read snapshot through an explicit bounded stdin ready/commit/abort protocol while host tooling streams pg_dump from the database service. EOF or timeout rolls back; sanitize child stderr. Reject unexpected application schemas rather than silently backing up only public. Row fingerprints must be incremental/cursor-based, with deterministic serialization/order, rather than unbounded string_agg.

Archive format: authenticated fixed magic/version and fresh nonce; encrypted bounded manifest length plus manifest JSON plus raw custom dump; final authentication tag. Stream encryption/decryption with backpressure. Fsync an exclusive private partial file, then publish atomically without replacing an existing archive only after successful pg_dump and encryption finalization. Recovery authenticates the entire file into private scratch before parsing manifest or creating containers. Fixed recovery commands only; never execute archived paths/commands. Explicit archive/disk/process limits and generic diagnostics.

Manifest captures actual running image IDs (not merely configured mutable tags), DB versions, private config, optional verification fixture, and inventory. Validate exact source service/project/image identity. The target creates owner/runtime roles before restoring ownership/ACLs; database-level CONNECT/PUBLIC restrictions must be reproduced separately because schema dump omits them. Compare grants/role attributes and object ownership as well as definitions/data. Verify baseline before authentication creates sessions and before any newer migrations. If sequences are added, verify their state correctly or explicitly refuse unsupported sequence state. Pin/reference backup images locally so ordinary tag replacement does not silently remove the only known recovery artifact; do not prune images.

Recovery must work without the original source project running: use authenticated archive configuration and recorded image IDs, not live source reads. Missing recorded images fails clearly; restoring on another host needs those verified artifacts supplied separately. Synthetic app sign-in/tenant verification may mutate only target session/fixture state after exact baseline comparison. Cleanup must run on errors/signals and report safe target IDs if Docker cleanup fails. The encryption key never enters manifest, output, argv or CI artifacts.

Retain one successful encrypted archive and its image references privately as the genuine pre-MFA baseline for the next migration upgrade rehearsal. No need to stop the source during normal backup; explicitly verify recovery can run without querying the source by a guarded source-stop/restart drill after backup. Restore original source availability even if the drill fails. Root owns final independent reviews, source scan and commit; implementation owns focused tests and real local Docker verification.

## Spec Change Log

Iteration 1: independent reviews found backup-side admission, cancellation/publication, snapshot completeness and negative verification gaps. Add the requirements in the triage resolutions; preserve existing verified crypto format, fixed Compose boundaries, snapshot baseline and scoped concurrent/source-offline drill. Working changes remain in place for focused correction rather than destructive reversion.

Implementation uses atomic hard-link publication after fsync to prevent replacement of an existing archive. This preserves the atomic-publication invariant more directly than an overwriting rename; encrypted temporary file is then removed.

## Review Triage Log

All three fresh layers returned before triage. The diff includes this spec, limiting content-level blindness. Each finding is recorded before grouping.

| Finding | Verdict and evidence | Resolution |
| --- | --- | --- |
| Blind1 backup manifest | medium: backup publishes without calling recovery validator; malformed private fixture or disallowed table name can produce a success archive rejected on recovery. | Validate generated manifest before dump/publication; round-trip rejection tests |
| Blind2 pipeline deadline | medium: crypto pipelines have no AbortSignal/deadline; Docker child timers do not bound standalone authentication or remaining file streaming. | Bounded cancellation on both archive pipelines with failure cleanup tests |
| Blind3 interruption publication | medium: process signal state only stops children; encryption can continue after producer completes and publish. | Shared interruption signal/check before atomic publication, test late interruption |
| Blind4 UTF-8 chunks | medium: independent chunk.toString can corrupt split multibyte schema definitions. | Streaming UTF-8 decode and split-character test |
| Blind5 database role settings | medium: pg_roles.rolconfig excludes pg_db_role_setting; dump does not restore role-in-database settings. | Refuse unsupported role/database settings or inventory and restore explicitly |
| Blind6 schema object coverage | medium for custom collations and non-view rewrite rules: neither refused nor inventoried. Standalone composites are already refused because pg_class relkind c is outside r/i/v. | Refuse uncovered objects; retain existing composite refusal |
| Blind7 post-publication fsync | medium: directory fsync failure leaves final pathname while command reports generic failure, making durability/outcome ambiguous. | Remove only invocation-owned publication on failure or explicit safe state; fault test |
| Blind8 ancestor trust | medium: non-sticky group/other-writable ancestor can substitute immediate private directory despite leaf checks. | Validate ancestor ownership/writability with safe system-temp exception; never change permissions on unrelated paths |
| Blind9 late failure cleanup | medium: startup and signal tests do not cover role/restore/inventory/API/cleanup failure outcomes. | Extend fake-Docker stage failures and cleanup failure safe IDs |
| Edge1 manifest | medium: same missing backup-side validation as Blind1. | Same correction |
| Edge2 deadlines | medium: same missing pipeline cancellation as Blind2. | Same correction |
| Edge3 sequences claim | false: explicit Implementation constraints allow refusal of unsupported sequences; source currently has none, and relkind filter refuses them. | Keep refusal; no scope expansion |
| Verification1 inventory mismatch | medium: deleting equality check would preserve current positive drill/test passes. | Authenticated altered expected row digest and grant negative recovery checks; require failure and cleanup |

Accepted groups: archive admission/publication/cancellation; snapshot text/schema coverage; ancestor trust; failure-path verification. They amend non-frozen implementation details without changing frozen intent. Re-derive affected code while preserving working authenticated format, exported snapshot, source identity, generated isolated projects, scoped concurrent drill and verified source recovery. No accepted finding deferred.

## Verification

Run dedicated Node tests, type/build if shared code affected, source/dependency scan, real packaged encrypted backup/recovery in isolated Docker and failure drills. Inspect complete diff and independent reviews. Full CI also verifies preexisting release installation/persistence and development restore.


### Local implementation evidence (2026-10-14)

- Seven named focused tests pass with subprocess execution enabled: authenticated
  roundtrip/no overwrite; wrong-key/header/nonce/ciphertext/tag/truncation rejection;
  private/symlink/key guards; failed producer/completion cleanup; CLI authentication
  and strict manifest rejection before Docker with valid positive control; subprocess
  diagnostic suppression; partial target startup failure removes only generated
  target resources and authenticated scratch.
- Real encrypted baseline recovery: 35 tables, 1,240 rows, migrations 1–11,
  complete inventory equality, health/sign-in/own-patient read and foreign-patient
  denial, observed isolated recovery duration 26 seconds.
- Full drill: 66 committed changes to the scoped synthetic hospital during backup;
  recovery while source services stopped; 35 tables / 1,240 rows verified, observed
  recovery 27 seconds; original source configuration/container identities retained
  and source healthy after restart. The scoped hospital name was restored.
- Private genuine pre-MFA baseline retained at
  `.local/release-backups/pre-mfa-drill.medi`; private key separately at
  `.local/recovery.key`. Local image references suffix
  `c0ecb9774d145a794b09b333` retained. No archive/key is a CI artifact.
- PostgreSQL constraint inventory uses native pretty deparsing to canonicalize
  redundant parentheses that pg_dump/pg_restore otherwise changes. Sequences,
  unsupported relation kinds, custom domains/enums/ranges, policies, default ACLs,
  large objects and unexpected schemas fail closed.
- Root retains ownership of independent review, source/dependency scans, full CI,
  documentation integration and commit. Timings are observations, not recovery SLA.


### Follow-up review triage

Both follow-up layers returned before triage. Edge found one SQL pattern defect; verification confirmed the mismatch test now fails when equality is removed, and found one backup admission test gap.

| Finding | Verdict/evidence | Resolution |
| --- | --- | --- |
| Edge followup schema prefix | medium: SQL LIKE pg_% treats underscore as a wildcard; a permitted user schema pgx is excluded from the unexpected-schema check but absent from public inventory. | Patch to literal pg_ prefix, verify unsupported pgx refused |
| Verification followup backup entry | medium: calling validateManifest directly does not exercise the new backup CLI admission site; removing its invocation leaves tests green. | Fake-Docker backup CLI invalid inventory must fail before dump/publication with no accepted or partial archive |

Both corrections are bounded patches to existing guards and their direct verification. Existing accepted fixes and passing recovery evidence are preserved.

### Final correction evidence — 2026-10-14

All 19 named archive/CLI tests passed in one final run (11.2 seconds), with zero skips. Tests execute actual backup admission, authenticated recovery failure stages, interruption, publication rollback and cleanup. The two follow-up findings are corrected: schema checks use the literal `pg_` prefix, and malformed inventory/fixture tests invoke the backup CLI and prove no dump or archive publication. An isolated restored database accepted the baseline snapshot and refused an added `pgx` schema.

The corrected real drill observed 70 committed synthetic updates during backup, recovered 35 tables / 1,240 rows with migrations 1–11 in 20 seconds while the source was stopped, then restored the source's original configuration/container identities and healthy service. Separate authenticated row-digest and runtime-grant mismatches were rejected, and their isolated resources/plaintext were removed. These timings are observations, not an SLA.

The final retained pre-MFA baseline is `.local/release-backups/pre-mfa-final.medi`, with its independently stored local rehearsal key `.local/recovery.key` and pinned image reference suffix `6e87f22730907761e0ddd405`. They remain private and untracked. Earlier rehearsal archives are retained; none replaces the final baseline. Recovery prints success only after target cleanup succeeds. Root inspected the complete implementation and correction diffs. No accepted finding is deferred. Final security scans and CI evidence follow below.

Final source scan: 160 tracked targets, zero findings. Dependency/secret/misconfiguration scan passed its configured HIGH/CRITICAL gate; it excludes development dependencies (npm audit remains a separate CI gate). Full remote CI is pending the delivery commit; no production acceptance is inferred.
