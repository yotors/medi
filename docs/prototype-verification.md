# Outpatient prototype verification — 2026-10-13

Scope: local synthetic-data frontend in this separate repository. No production
service, live patient data, hospital validation or remote CI run is included.

## Results

| Command/check | Result | Evidence |
| --- | --- | --- |
| `npm test` | 14 tests passed across 3 files | `src/domain.test.ts`, `src/domain.scenarios.test.ts`, `src/storage.test.ts` |
| `npm run build` | TypeScript check and Vite build passed | `dist/` local build; build includes `tsc --noEmit` |
| `npm run test:app` | 12 tests passed: 6 each desktop/mobile, 59.8 seconds | `tests/app.spec.ts`, `tests/review.spec.ts`; `artifacts/app-report/` |
| `npm run audit:ui -- http://127.0.0.1:5173` | Desktop/mobile each: zero axe violations and zero runtime errors | `artifacts/ui-1791884275567/` |
| Dialog viewport capture | Desktop 800×720; mobile 412×839, both anchored at viewport origin as expected; close button focused | `artifacts/ui-1791883779992/desktop-visit.png`, `mobile-visit.png` |
| `npm run security:source` | 49 rules across 55 targets; zero findings | `artifacts/semgrep/results.json`; inspected scanned targets include application source |
| `npm run security:dependencies` | Exit 0; zero reported vulnerabilities, secrets or misconfigurations in returned results | `artifacts/trivy/results.json`; npm lockfile and Python requirements detected |
| `npm audit --json` | Zero reported advisories, including development dependencies | `artifacts/npm-audit.json` |

Browser startup and local-server networking needed execution outside the default
sandbox; approved execution passed. The local development server binds loopback.
The Trivy run omits development dependencies by default, so the npm audit provides
that additional dependency coverage. Static scans are limited by their rules,
selected targets and advisory database; they do not establish secure operation.
Source scan target lists were checked because this repository has no first commit.

## Behavior verified

Keyboard registration without email, duplicate protection, one active visit per
patient, consultation notes, diagnostic lifecycle and result review, prescription
fulfillment, integer-ETB settlement, closure blockers, closed read-only history and
reload persistence. Department lists remove completed work and open the relevant
tab. Focus returns to the workspace when its original row has disappeared.

Failure checks cover invalid order transitions, repeated settlement, cancelled
paid versus unpaid charges, corrupted stored state, quota/write failure with
unchanged data and retained draft, single retry, stale tabs, deliberate reset and
long names. Visit drafts survive dialog dismissal within the current page session;
they are not persisted across reload. Reset clears registration and visit drafts.

The visual review accepted the final mobile patient-name action affordance for
prototype review. The initial contrast findings and note-border treatment were
corrected. A detector ran once; no repeated design search was performed. Final
captures addressed review findings and verified dialog viewport bounds; full-page
screenshots of fixed overlays were replaced by viewport captures.

All code/test findings and their dispositions are recorded in the
[implementation specification](../_bmad-output/implementation-artifacts/spec-outpatient-prototype.md).
The final design is in [DESIGN.md](../DESIGN.md); a local Impeccable component
sidecar is available at `.impeccable/design.json`.

## Boundaries and next evidence

This prototype has no server database, authentication, role permissions, hospital
isolation, signed records, real payments, backup restoration or production hosting.
No clinical advice or automated treatment recommendations are provided. Manual
screen-reader testing, staff workflow validation, production security assessment,
capacity testing and operational recovery evidence remain outstanding.

The existing GitHub workflow contains application and tooling checks, but has not
run remotely. No branch protection, commit, remote or deployment is configured.
The connected GitHub identity is yotors; repository creation is unavailable through
the current connector. An empty private repository URL is pending from the user.

Detailed production gaps: [prototype boundaries](prototype-boundaries.md) and
[readiness checklist](readiness.md). Earlier tooling fixture results remain in
[setup verification](setup-verification.md); they are not counted as app tests.
