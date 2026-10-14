# Medi

Hospital management web application: React/TypeScript browser client, Fastify API
and PostgreSQL. One authenticated workspace at `/`; `/staff` remains an alias.

## Workspaces

Patient identity/history and corrections, appointments/triage/referrals;
wards/beds/admission/transfer/discharge, nursing and medication outcomes;
laboratory catalogs/specimens/results/critical review; pharmacy stock/purchasing/
returns; invoices/payments/credits/refunds/cashier shifts; staff/facilities/settings,
governed record requests/exports, retention holds and expiring support access.

Hospital authorization, database tenant policies, production MFA, post-lock
revocation checks, transactional audit/retry receipts and immutable histories
protect the workflows. See [coverage](docs/product-roadmap.md),
[architecture](docs/architecture.md) and [verification](docs/readiness.md).

## Development

Node24 and Docker; use fictional records. Existing accounts are preserved.

```sh
npm ci --ignore-scripts
npm run db:local
npm run db:migrate
STAFF_MFA_POLICY=synthetic npm run dev:api
# Another terminal:
npm run dev
```

Open http://127.0.0.1:5173. New accounts use explicit `setup:staff` provisioning;
never commit credentials. See [development](docs/development.md) and
[staff MFA](docs/staff-mfa.md).

## Production

[Deployment runbook](docs/deployment.md): immutable images, real HTTPS/private
services, separate file secrets, named admin/MFA bootstrap, monitoring,
scheduled encrypted backups and isolated recovery. Supply the hospital domain,
operator, protected alert destination and independent backup storage.

```sh
npm run production:install -- prepare /private/install.json /srv/medi
npm run production:install -- validate /srv/medi
npm run production:install -- start /srv/medi
```

Follow the runbook for bootstrap, backup keys and timer activation. The local
`release:local` command is an owned internal-CA rehearsal with fictional fixtures.

## Source and checks

`src/staff`: browser; `server`: API/migrations; `shared`: schemas/types/domain;
`tests`: browser journeys; `deploy`: runtime configs; `tooling`: operator/check
commands. Research/specifications are retained in `_bmad-output` as delivery history.
Ignored agent tools, caches, reports and private `.local` are excluded from runtime.
[Cleanup decisions](docs/repository-cleanup.md) explain removed/retained files.

```sh
npm run format:check
npm run typecheck
npm run typecheck:server
npm test
npm run test:server
npm run test:staff
npm run test:production
npm run security:source
npm run security:dependencies
```

[CI](https://github.com/yotors/medi/actions) checks application/security and genuine
installation/upgrade/recovery. The deploying organization establishes clinical
procedures, customer/legal terms, infrastructure credentials and operator duties.
