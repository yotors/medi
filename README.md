# Medi

A separate development workspace for a hospital management product serving
small private hospitals and medical centers in Ethiopia. The initial
[product brief](./_bmad-output/planning-artifacts/briefs/brief-product-studio-2026-10-12/brief.md)
and [deployment comparison](./_bmad-output/planning-artifacts/briefs/brief-product-studio-2026-10-12/addendum.md)
are discovery drafts. A local synthetic-data outpatient walkthrough implements
registration, check-in, consultation, diagnostics, pharmacy handoffs, billing and
visit closure. There is no production deployment.

This is the first implemented milestone of the full commercial product, not a
finished hospital system. See the [product roadmap](docs/product-roadmap.md) for
implemented versus missing capabilities and [database/deployment plan](docs/deployment.md)
for the existing local setup and when hosting decisions will need founder input.
The [whole-product requirements draft](./_bmad-output/planning-artifacts/prd/prd-medi-2026-10-13/prd.md)
records proposed requirements and the clinical/commercial decisions still open.

## Staff outpatient workspace

The `/staff` workspace has staff sign-in, hospital-scoped registration/search,
visit check-in, consultation, laboratory results, pharmacy handoffs, demonstration
settlement and closed visit history, persisted in PostgreSQL. It is local synthetic development, not ready
for live hospital records. Follow [staff-workspace.md](docs/staff-workspace.md)
for database startup, migration, account provisioning and the two server commands.
On this workstation it is available at `http://127.0.0.1:5173/staff`.

Use Node22.12 or newer. The original outpatient walkthrough remains at `/`, with
its own browser-only data. The two workspaces do not exchange patient records.

## Run the outpatient prototype

```sh
npm ci --ignore-scripts
npm run dev
# Open http://127.0.0.1:5173
```

Use fictional details only. Records are stored in this browser profile. This browser-only walkthrough
has no accounts, production authorization, clinical decision support, real
payments or server database. Demo settings includes an explicit reset. Invalid
saved data requires deliberate recovery; conflicting tabs must reload.

```sh
npm run typecheck
npm test
npm run build
npm run test:app
npm run audit:ui -- http://127.0.0.1:5173
```

Browser tests need the Chromium installation described below. `npm run preview`
serves the production build locally. See [prototype.md](docs/prototype.md) for a
walkthrough, implementation decisions, verification and limitations, and
[prototype-boundaries.md](docs/prototype-boundaries.md) for production gaps.

## Repository layout

This folder is the source repository for [yotors/medi](https://github.com/yotors/medi).

- `src/`: original walkthrough, authenticated staff UI, domain rules and unit tests.
- `server/`: staff API, authentication, PostgreSQL migrations and integration tests.
- `shared/`: request validation, role permissions and shared API types.
- `tests/`: browser workflow tests and the existing tooling fixture.
- `docs/`: product boundaries, verification evidence and deployment decisions.
- `_bmad-output/`: research, brief and implementation specification.
- `.github/workflows/`: GitHub Actions application and security checks.
- `tooling/`: browser, accessibility and security check runners.

The staff API is a separate local process backed by PostgreSQL. Production hosting,
clinical validation and operating procedures remain undecided. Local backup and
restoration checks are available; production recovery remains to be designed. The original
outpatient walkthrough still uses browser storage.

## Start working

Open this folder as the Codex/VS Code workspace and start a new task so the
project skills and MCP configuration are discovered. Alternatively, launch:

```sh
./dev-codex
```

On the original workstation, this repository is trusted in Codex with explicit user approval. The CLI
confirmed that Context7, Playwright, and OpenAI Docs are discovered and enabled
from `.codex/config.toml`. Start a new task in this folder to load those tools;
they do not become tools inside an already-running conversation. Direct
Context7 and Playwright MCP handshakes were verified separately.

Describe the intended users, the problem, and the main task the product should
help them complete. BMad then guides the brief, requirements, architecture, and
implementation. Invoke `$bmad-help` for orientation or `$impeccable` for UI work.
UI component libraries are welcome; select one with the application framework
and customize its design tokens, layout, and interactions.

## Installed foundation

| Capability | Setup |
| --- | --- |
| Delivery workflow | BMad Method 6.12.2, core + BMM, 29 local Codex skills |
| UI design | Impeccable skill pinned to commit `919dbeba520df760a157fe635be62faae88d58da` |
| Library research | Context7 4.3.0 local MCP; requests need network access |
| OpenAI research | Official OpenAI Docs HTTP MCP configured |
| Browser control | Playwright MCP 0.0.83 with isolated headless Chromium |
| Browser/accessibility verification | Playwright Test 1.64.0, axe 4.13.0; desktop + mobile |
| Security tools | Semgrep, Trivy, ZAP container commands, images pinned by digest |
| Load testing | k6 container and a small smoke workload |
| Python workflow runtime | Project-local uv 0.13.0 |
| CI | GitHub Actions tooling, dependency audit, Semgrep and Trivy checks on pushes and pull requests |

Versions are locked in `package-lock.json`, `tooling/requirements.txt`, and
`tooling/images.json`. Container digests target Linux amd64, this machine's
platform. Review and update them deliberately. The Semgrep `p/ci` rules and Trivy
vulnerability database refresh remotely; save report dates with evidence.

BMad's parser is overridden to `csv-parse@7.0.3` to address
[GHSA-8cw4-87c7-c6xx](https://github.com/advisories/GHSA-8cw4-87c7-c6xx).
Its installed catalogs parse successfully with that override. Recheck the override
when upgrading BMad. The package now includes the React application and development tools.

## Verification commands

```sh
npm run doctor
npm run test:tooling
npm audit --audit-level=moderate

# With the product running locally:
npm run audit:ui -- http://127.0.0.1:3000/
npm run security:source
npm run security:dependencies
BASE_URL=http://127.0.0.1:3000/ npm run security:web
BASE_URL=http://127.0.0.1:3000/ npm run test:load
```

Reports go under `artifacts/` and are excluded from Git. Review them before sharing:
screenshots, traces, scanner output, and console messages can contain test data.
Security commands preserve failure exit codes. Trivy gates HIGH/CRITICAL findings;
ZAP baseline warnings also return nonzero. Semgrep sends metrics off and scans
with the community engine. These tools still require application-specific tests.

ZAP currently performs an unauthenticated passive baseline scan. Add authenticated
contexts and targeted security tests once roles and routes exist. Use only owned
local/staging targets. k6 defaults to one virtual user for ten seconds with example
thresholds; this validates the harness and makes no product capacity claim.
The container runner uses Linux host networking for local targets.

The UI audit covers one public URL at desktop/mobile sizes. It does not replace
journey tests, keyboard review, screen-reader assessment, or authenticated checks.
The four fixture tests verify browser interaction and positive/negative axe
behavior; they provide no application coverage.

## Reproduce the tool installation

```sh
npm ci --ignore-scripts
python3 -m venv .venv
.venv/bin/python -m pip install -r tooling/requirements.txt
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" npx --no-install playwright install chromium
```

On supported Linux CI runners, use Playwright's `install --with-deps chromium`.
This workstation used the Ubuntu fallback browser build successfully. Codex's
execution sandbox blocked Chromium startup; its approved external execution
passed the checks. Docker also requires access to the local daemon.

Agent skills and generated workstation configuration are local development tools and are excluded from Git. To install BMad after cloning:

```sh
PATH="$PWD/.venv/bin:$PATH" npx --no-install bmad-method install \
  --directory "$PWD" --modules bmm --tools codex --no-shims --yes
```

Impeccable's executable launcher is `.agents/skills/impeccable/scripts/impeccable`.
Set `IMPECCABLE_HOME="$PWD/.cache/impeccable"` when invoking it outside Codex.
It downloads its pinned engine and verifies the release checksum when needed.

Generate workstation settings with `python3 tooling/configure-codex.py` when needed. The local `.codex/config.toml` contains absolute workstation paths and is excluded from Git. If the
folder moves, preserve any customizations and regenerate using
`python3 tooling/configure-codex.py` after moving the old configuration aside.
The generator refuses to overwrite an existing file. Model choice, account
settings, and approval policies are inherited from the existing Codex environment.

## Before release

See [readiness.md](docs/readiness.md). Application unit, type, build, browser and
accessibility checks are configured alongside the preserved tooling and security gates. Required branch protection remains unconfigured. Choose and instrument an OpenTelemetry backend with real services;
no observability stack or production infrastructure has been invented here.

Official references: [BMad installation](https://docs.bmad-method.org/start/install-bmad/),
[Impeccable](https://github.com/pbakaus/impeccable),
[Codex MCP configuration](https://developers.openai.com/codex/mcp),
[Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing),
[ZAP baseline](https://www.zaproxy.org/docs/docker/baseline-scan/),
[k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/).
