# Database and deployment plan

Updated: 2026-10-13. This records the current development environment and the
decisions needed before deployment. It does not describe an existing production
installation.

## What is set up now

Medi is a responsive browser application. Locally, Vite serves the UI at
`http://127.0.0.1:5173/staff` and proxies `/api` to Fastify on loopback port 3100.
The API connects to PostgreSQL 16 in the dedicated Docker Compose project
`hospital-product-studio`, on loopback port 15432. The browser has no database
credentials and does not connect directly to PostgreSQL.

The named volume `hospital-product-studio_hospital-dev-data` persists database
files across ordinary container restarts. Ignored `.env` and `.local/` files hold
local credentials and backup artifacts. Migrations 001–003 create the current
staff, patient and outpatient data model. Hospital isolation is enforced by the
application and relational constraints; production database privileges and
defense in depth remain unfinished.

On 2026-10-13, `docker compose ps` reported the database healthy and
`GET http://127.0.0.1:5173/api/health` returned `{"status":"ok"}`. The completed
[application CI run](https://github.com/yotors/medi/actions/runs/38390211322)
includes server/browser tests and a disposable-database restore check. This
evidence applies to the development implementation, not a production deployment.

No database account, cloud subscription or hosting purchase is needed from the
founder now. Continue using synthetic records while building the product.

## PostgreSQL and the Supabase option

Keep the existing PostgreSQL Docker environment for current work. The user's
offer to use local Supabase is an available option, not a requirement to replace
a working database. Supabase supports both a local CLI/Docker environment and a
self-hosted Docker stack; the latter includes services beyond PostgreSQL. See
the official [local development guide](https://supabase.com/docs/guides/local-development)
and [self-hosting guide](https://supabase.com/docs/guides/self-hosting/docker),
checked 2026-10-13.

Revisit this choice if requirements justify adopting its Auth, Storage or other
services. That would require an explicit architecture/migration decision:
current authentication belongs to the Medi API, and its migration runner allows
only dedicated database names and refuses unrelated existing schemas. Pointing
`DATABASE_URL` at a Supabase project alone is not a supported migration. Review
identity mapping, row access, service credentials, file authorization and backup
coverage before adopting any new service. No Supabase/cloud project has been
created, and no database replacement has been performed.

## When the founder needs to act

| Trigger | What will be prepared first | Founder input needed then |
| --- | --- | --- |
| Current local development | Working app, migrations, synthetic fixtures, tests and local restore checks | None for infrastructure |
| Ready to share a private staging demonstration | Deployable release artifact, configuration list, hosting options/cost estimate, HTTPS and access plan, test/rollback procedure | Hosting budget/account and desired URL or domain, after reviewing the concrete plan |
| Selecting the first hospital pilot | Department coverage, connectivity/power questionnaire, data-flow inventory, rollout/recovery plan and acceptance scenarios | Pilot counterpart, hosted versus hospital-local choice, responsible operators, approved data location and service commitments |
| Before the first real patient record | Validated workflows, security evidence, backup/restore and incident drills, training and migration rehearsal | Hospital acceptance and appropriate clinical/legal/operational review; production credentials supplied through a private secret mechanism |
| Adding an external integration | A specific integration contract, data fields, failure behavior and synthetic test plan | Relevant provider account/access, agreements and costs only when the integration is in scope |

The agent should raise these decisions when their trigger is reached, before
spending money, exposing a service or moving patient data. Do not ask the founder
to buy hosting merely to continue local feature development. Do not request
secrets in chat or commit them to the public repository.

## Deployment work still required

The current `compose.yaml` runs a development database only. It is not a
hospital installation bundle. The API binds to loopback; the UI uses a Vite
development server. Setting `NODE_ENV=production` alone does not deploy Medi.

Before staging, build and verify a repeatable web/API deployment with HTTPS,
separate environment secrets, health checks, bounded shutdown, migrations as a
controlled release step, and an upgrade/rollback procedure. Verify secure-cookie
and same-origin behavior behind the chosen proxy. Separate runtime database
permissions from schema migration privileges. Publish only the intended web
entry point; database/admin ports must not become public accidentally.

Before a live pilot, complete scoped authentication/authorization review,
redacted monitoring and tested alerts, encrypted offsite backup/restore,
retention/access controls, incident ownership and measured recovery objectives.
Existing local backup commands are intentionally limited to the dedicated local
database; they are not a production backup service. See
[release evidence](readiness.md).

The earlier [deployment comparison](../_bmad-output/planning-artifacts/briefs/brief-product-studio-2026-10-12/addendum.md)
compares hosted, hospital-local and hybrid operation. Its legal observations need
current local specialist confirmation before selecting a live-data location.
Deployment and hospital tenancy are separate decisions: either operating model
still needs explicit customer boundaries and controlled vendor support.

## Local operations

Run these from the repository root:

```sh
npm run db:local          # Create config only if absent; start/wait for local DB
npm run db:migrate        # Apply pending migrations to the dedicated database
npm run dev:api           # API; keep running
# In another terminal:
npm run dev              # Browser app; keep running
```

Existing installations retain their accounts. For a new checkout, follow
[staff provisioning](staff-workspace.md#run-locally); passwords are not in Git.

```sh
npm run db:backup         # Private local logical backup
npm run db:restore-check  # New backup, restore to disposable DB, compare schema/data
docker compose stop      # Stop the database while preserving its named volume
```

Do not remove the named volume to restart the app. Local restoration tests do
not replace an independently stored production backup or a downtime procedure.
