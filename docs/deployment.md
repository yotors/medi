# Portable production installation

This tooling prepares an installation; live hosting, DNS, data location, hospital
acceptance and named incident ownership remain operator decisions. No paid host,
external domain registration or real patient deployment was performed.

Use Linux, Docker Engine with Compose v2, Node 24, a named operator with controlled
Docker access, a dedicated host, and reviewed immutable API/web image identities.
Docker access grants host administration; restrict that operator account. Keep the
repository tooling at `/opt/medi` and pin its reviewed revision. Image digests must
be registry `name@sha256:…` references or already loaded full `sha256:…` image IDs;
tags are refused. Load/pull the exact reviewed images before starting.

The verified application images are already loaded on this workstation as
`medi-local-api:local` and `medi-local-web:local`. Read their full IDs with
`docker image inspect --format '{{.Id}}' IMAGE`; compare them with the
installation evidence before using them in configuration. Transfer these images
with `docker image save --output /secure/medi-app-images.tar medi-local-api:local
medi-local-web:local`, record `sha256sum` of that private file, and verify it on
the destination before `docker image load --input /secure/medi-app-images.tar`.
The installer uses the immutable IDs, rather than the transfer tags. The pinned
PostgreSQL/monitoring images in Compose must also be available on the host.

To build a new application revision, run `npm ci --ignore-scripts`, then
`docker build --target api --tag medi-api:build .` and
`docker build --target web --tag medi-web:build .` from that reviewed checkout.
A new build produces new identities and needs release verification; it does not
inherit the recorded evidence of another image. No database credentials are
required merely to build the images.

Create a private installation parent and independently mounted encrypted/offsite
backup destination. Supply a chmod600 JSON configuration outside Git:

```json
{
  "project": "medi-prod-hospital",
  "apiImage": "registry.example.org/medi/api@sha256:REPLACE_WITH_64_HEX",
  "webImage": "registry.example.org/medi/web@sha256:REPLACE_WITH_64_HEX",
  "domain": "hospital.example.org",
  "tlsEmail": "named.operator@example.org",
  "webhook": "https://approved-alert-service.example.org/protected-destination",
  "backupDirectory": "/mnt/medi-offsite",
  "hospitalCode": "named-hospital",
  "hospitalName": "Named hospital",
  "username": "named.admin",
  "operator": "named-operator"
}
```

Replace every example with approved inputs. The HTTPS webhook is a protected
credential: keep configuration private, do not put it in command arguments or Git.
The offsite mount and remote credentials must be configured by its custodian;
these tools never invent a remote account, destination or credential. Configuration
rejects extra fields, mutable images, unsafe names, symlinks and public modes.

```sh
umask 077
mkdir -m 700 /var/lib/medi-install-parent /var/lib/medi-backup-custody
chmod 700 /mnt/medi-offsite
node /opt/medi/tooling/production-install.mjs prepare /secure/install-config.json /var/lib/medi-install-parent/hospital
node /opt/medi/tooling/production-install.mjs validate /var/lib/medi-install-parent/hospital
node /opt/medi/tooling/production-install.mjs start /var/lib/medi-install-parent/hospital
node /opt/medi/tooling/production-install.mjs bootstrap /var/lib/medi-install-parent/hospital /secure/admin-enrollment.json
node /opt/medi/tooling/production-install.mjs status /var/lib/medi-install-parent/hospital
```

`prepare` creates credentials only in a fresh directory and removes its own partial
installation on failure. It does not overwrite an existing directory, occupied Docker project or bootstrap
an existing hospital. No patients or demonstration accounts are created. Hand the
private bootstrap password and expiring enrollment grant to the named admin through
a separately approved private channel. The admin signs in, uses the grant to enroll
an authenticator, and records recovery codes privately. Delete the transfer artifact
after verified handoff; use the established MFA operator recovery ceremony if the
grant expires. Check MFA readiness before opening access.

Only the gateway publishes ports80/443. Configure DNS to the host and firewall;
Caddy obtains TLS with the supplied contact. APP_ORIGIN exactly matches the HTTPS
domain. Database, collector, API and monitoring ports remain private. Runtime API
uses nonroot/read-only settings and sees only runtime/MFA credentials; migration
and admin provisioning use a separate owner secret volume. Database credentials
use a third volume. API, collector and monitoring logs/storage are bounded; SQL
statement/error parameter logging is discarded. Mandatory MFA cannot be replaced
by synthetic policy in production.

Use `restart INSTALLATION` for service restart with volumes preserved. There is no
production `down --volumes` operation and no automatic upgrade. Keep independently
held backup and MFA key custody: `/private/secrets.json` contains the runtime MFA
keyring; the backup encryption key is a separate randomly generated 32-byte file.
The encrypted archive also holds the keyring needed to restore enrolled factors;
protect backup-key custody accordingly. Preserve historical archives, their keys,
and pinned image references, including pre-MFA archives, without rewriting them.

```sh
node /opt/medi/tooling/production-backup.mjs key-init /var/lib/medi-backup-custody/backup.key
node /opt/medi/tooling/production-backup.mjs backup /var/lib/medi-install-parent/hospital /var/lib/medi-backup-custody/backup.key /mnt/medi-offsite/first.medibak
node /opt/medi/tooling/production-backup.mjs recover-check /var/lib/medi-backup-custody/backup.key /mnt/medi-offsite/first.medibak
```

Backup holds a PostgreSQL repeatable-read snapshot and streams custom `pg_dump`
directly into AES256GCM authenticated encryption. Publication is private, atomic,
non-overwriting and occurs only after dump success. The version3 encrypted header
records actual running image IDs, PostgreSQL version, migration versions, schema
inventory, record hashes and recovery credentials. No release verification fixture
or synthetic login is required. Retain the exact recorded images in an independently
protected registry/export; local image references are pinned as backup tags.

`recover-check` authenticates the entire bounded archive before interpreting its
metadata or starting a target. Archives are bounded to 1 GiB and encrypted metadata
to 4 MiB; plan a reviewed limit change before a hospital exceeds these bounds. Decrypted temporary material stays in an owned 0700
scratch directory adjacent to the private archive. It generates an isolated target,
refuses existing containers/volumes/networks, restores with a single transaction,
applies explicit runtime grants, compares all restored table hashes/migration
versions and checks API schema/MFA health. It deletes only its owned generated
target and fails if cleanup fails. Source data, credentials, archives and images
are preserved. Recovery checks measure engineering success, not an agreed RTO.

For scheduling, install the templates in `deploy/systemd`, changing **all** paths,
operator/group and `RequiresMountsFor`/`ReadWritePaths` to your actual mount and
installation. `ExecStart` must use the reviewed repository revision, the actual
installation directory and independent key path. Mount credentials remain in the
operator's protected mount configuration.

```sh
sudo install -m 644 /opt/medi/deploy/systemd/medi-backup.service /etc/systemd/system/
sudo install -m 644 /opt/medi/deploy/systemd/medi-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start medi-backup.service
sudo journalctl -u medi-backup.service
sudo systemctl enable --now medi-backup.timer
sudo systemctl list-timers medi-backup.timer
```

The schedule refuses an unmounted destination, publishes only encrypted archives,
and sends a generic failure event to the configured protected webhook. Test alert
routing with your approved local synthetic receiver first, then deliberately verify
human delivery as a separate operator action. A failed notification is separately
reported in the journal. On failure, inspect service status, disk/mount availability,
key permissions, image availability and source readiness; repair and rerun the
service, then authenticate a recovery check. Existing backups are retained.

Retention is deliberate and manual: maintain at least two independently verified
archives across separately held destinations and perform a fresh recovery check
before retiring any older archive. Never delete the sole verified copy. Record
custodian approval, retention period and deletion inventory; no automated deletion
is installed. Measure restore elapsed time on actual replacement hardware before
agreeing any recovery commitment.

For maintenance, stop admissions/clinical writes, take and recover-check a fresh
backup, retain old image IDs and keys, and document the cutover window. Update the
private installation configuration to explicitly reviewed immutable images and run
`validate`, then `maintenance-migrate INSTALLATION`. That command stops API, runs
migration through the owner image and starts the restricted API. If migration fails,
the API remains stopped for operator inspection. Never downgrade a migrated database.
For replacement, authenticate the archive first on isolated hardware using
`recover-check`, provision a fresh dedicated installation from retained images and
credentials, repeat integrity/MFA checks, then deliberately switch DNS/traffic.
The current command intentionally offers verification only; production traffic
cutover and permanent replacement destination remain operator-controlled actions.

Remaining inputs: host/equipment and budget, actual domain/DNS/TLS contact, approved
data location and healthcare obligations, hospital acceptance, named admin/operator
and incident escalation, protected human webhook, independently mounted/offsite
storage and remote credentials, independent backup/MFA custody, retention approval,
replacement hardware and measured restore commitment. Engineering rehearsal does
not grant blanket legal or clinical readiness.

## Local rehearsal evidence,2026-10-14

The single final image build and isolated installation passed in 89s on schema 1–19
with 58 table hashes verified after replacement restore. The fresh database had no
hospitals, patients or staff before explicit named admin bootstrap. Real mandatory
MFA enrollment, tenant-scoped supplier write/read with a foreign supplier excluded,
TLS security headers and restart persistence passed. Wrong keys, tampered archives,
occupied directories and occupied Docker projects were refused. The generated
installation/recovery targets were cleaned. Five actual networkless container
checks refused public-mode, oversized, malformed, symlink and nonregular secret
sources without private diagnostics. Four focused tests passed, including failure
alert delivery to a local synthetic receiver and preservation of the sole prior
archive when the destination is unmounted.

The scheduler function published the encrypted archive with a synthetic mounted
path; real systemd activation and independently mounted offsite custody require
operator setup. No real webhook was contacted. Exact actual Docker image identities
and bounded evidence are in [production-installation-evidence.json](production-installation-evidence.json).
