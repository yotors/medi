---
title: Decision-focused operational analytics
type: feature
created: 2026-10-15
status: done
route: dispatch
review_loop_iteration: 0
baseline_commit: 5fa038fdfcbdcb6e79fab861222ed59fd35c88d5
context: [AGENTS.md, PRODUCT.md, DESIGN.md, docs/architecture.md]
---

<frozen-after-approval reason="founder-approved analytics and reference-led workspace scope">

## Intent

**Problem:** Operational reports contain trustworthy tables/totals but make patterns difficult to scan. The founder wants thoughtful chart selection before recording the English-narrated release video, explicitly rejecting a generic collection of bar graphs.

**Approach:** Redesign the shared workspace shell and home dashboard to the supplied SelamCare reference’s level of hierarchy, compactness and mobile usability; carry consistent headings/controls/tables across existing pages. Add purpose-specific visual analysis to existing role-projected reports, alongside exact tables. Answer four questions: how recorded visit activity changes; when visits are opened; how recorded collections divide by payment method; which displayed products have stock eligibility/expiry exceptions. Finish analytics before capturing the release video.

## Boundaries & Constraints

**Always:** Real hospital-scoped aggregate queries, current role projections, existing authorized-section map, audited report access, Africa/Addis_Ababa boundaries, maximum366-day range, existing ten-second report budget and abort/stale identity protections. Charts inherit selected range and generated-at context. Distinguish selected-period activity from current stock/work. EN/AM and all appearance themes, mobile, keyboard, print and reduced-motion support. Exact financial amounts remain string/BigInt minor units; accessible tables and labels carry exact values. Synthetic records only for tests/demo.

**Never:** Invent trend history from totals, add fake production data, claim visit openings equal physical arrivals, imply opened/closed counts are one patient cohort, add clinical-outcome or waiting-time claims, forecasts, unmeasured targets, comparisons without source data, mix stock units/products into one total, or expose unauthorized finance/inventory data. No new cloud service or automatic publishing of the video.

## I/O & Edge-Case Matrix

| Scenario | Input/state | Expected behavior | Error handling |
| --- | --- | --- | --- |
| Visit trend | Authorized operations range | Zero-based daily opened/closed lines, independent timestamps, no smoothing implying intermediate values; one-day range uses clear point/count treatment | Missing series compatibility shows honest unavailable state, not fabricated history |
| Opening pattern | Authorized operations range | Weekday/hour heatmap of recorded openings; cells explicitly total counts in selected range, local timezone, date-range exposure caveat; no staffing or arrival claim | Short/empty ranges state their limitation; future/unobserved periods not presented as observed zero activity |
| Collections mix | Authorized finance | Payment-method donut only when nonzero, cash/manual transfer exact ETB labels; gross recorded collections clearly distinguished from net/refunds | Zero has explicit empty state; very large amounts retain exact values and safely bounded ratio math |
| Stock exceptions | Authorized inventory page | Product-by-status matrix for available/quarantined/expired/expiry-today/inactive quantities, units on each row; priority styling highlights exceptions and indicates current snapshot/page scope | No summing different units; empty page/zero stock explicit; preserve inventory pagination |
| Access/failure | Role change,401/403,timeout,changed dates | Only permitted aggregates/tables; clear invalidated report, bounded retry, no stale private chart | No successful report/audit on failed transaction |
| Accessible use | Keyboard/touch,EN/AM,dark,print | Human-readable chart descriptions, exact table alternatives, no color-only distinction, contained mobile charts and legible print | No required hover-only information |

</frozen-after-approval>

## Code Map

- `shared/reports.ts`: DTO/schema and role map. Add operations series; keep existing endpoint/projections.
- `server/reports.ts`, `server/report-budget.ts`: scoped transaction, clock, bounds, audit and ten-second budget. Read indexes before adding grouped date-bounded SQL.
- `src/staff/StaffApp.tsx`, `src/staff/WorkspaceHome.tsx`, `src/staff/staff.css`, `src/styles.css`: inspect actual home filename, shared shell, fixed rail, navigation and common primitives. Mobile navigation must become collapsible with focus/Escape and draft guards.
- `src/staff/OperationalReports.tsx`: range form, generation/abort guards, exact tables. Add lazy charts with independent load-error fallback.
- `src/staff/reports.css`, semantic appearance tokens: preserve theme and responsive layout.
- `src/i18n/en/reports.json`, `src/i18n/am/reports.json`: localized chart copy using existing formatting helpers.
- `server/reports.test.ts`, `tests/reports.spec.ts`: extend existing role/tenant/timezone/money/budget/pagination fixtures and reconciliation tests.

## Tasks & Acceptance

- [x] Define typed daily series and weekday/hour opening counts with documented timestamp semantics and bounded response size.
- [x] Extend scoped report SQL under existing budget/audit. Verify daily sum reconciles existing opened/closed totals and heatmap sum reconciles openings.
- [x] Refine report hierarchy and compact shell/mobile navigation around the founder’s reference; keep fixed desktop navigation and existing guards.
- [x] Implement line/point, heatmap, collection composition and stock-exception matrix using reusable accessible components; choose/pin an appropriate maintained chart dependency after checking its installed-version docs. 
- [x] Preserve exact tables and add useful descriptions, legends, zero/single-day/future-range handling, keyboard/touch interaction and readable print.
- [x] Verify tenant/role/timezone boundaries, zeros, big money, multiple stock units/pages, unavailable chunk, request failure and stale result clearing; EN/AM desktop/mobile/theme checks in one bounded visual batch plus at most one correction/confirmation.
- [x] Update navigation/readiness documentation and assess the analytics issue after implementation/checks; keep its unimplemented broader scope open. Then resume the separate English-narrated video project with actual completed analytics and fictional fixtures.


Acceptance: Given permitted report data, when a user selects a range, then chart values reconcile exact tables and every chart answers its stated question. Given a restricted role, when requesting/rendering a report, then excluded aggregates are absent from both response and UI. Given an empty/one-day range or large financial amount, then no misleading axes, NaN, precision loss or invented trend appears. Given a visualization load failure, then exact report tables remain usable.

## Implementation Notes

Founder approved on2026-10-15 with “ok go head”, including the shared-shell/dashboard direction and optional v0-like plugin. No direct v0 plugin was found; MagicPath design/prototyping plugin was suggested as optional and is not required for implementation. Continue locally without waiting for plugin connection. This is the existing workflow’s approved handoff; do not start a new BMad workflow. Impeccable context already ran in the root session; preserve confirmed reference-led direction, read craft-floor before UI edits, use bounded visual verification, and avoid another design questionnaire. Root owns independent reviews, HTTPS rebuild and previously authorized push.

Scope clarification from approved conversation: improve the shared workspace shell and home dashboard as the first complete visual slice; apply consistent page-heading/control/table primitives across existing surfaces while preserving workflow layouts and behavior. Home dashboard must use actual role-authorized report data and expose current work/meaningful existing destinations; no copied reference placeholders. Keep expensive report reads explicit/range-based on Reports, or bounded one-per-dashboard-entry if needed, never polling. After complete analytics, root resumes the separately authorized English-narrated release video; implementation agent does not own video rendering. Existing local dev API/Vite sessions may be reused; do not kill unrelated processes or alter private HTTPS credentials.


No irreversible data change is planned. Existing report history lacks daily bins, so trends require backend aggregation rather than client inference. Preserve founder-owned .vscode, live-showcase credentials/data and private keyring/archives. Remotion official skills are installed; video scaffold and successful English neural voice sample are separate at `../../../medi-release-video/`. Video is deliberately deferred, not cancelled.

## Spec Change Log

## Review Triage Log

All three independent reviews returned before triage. Findings are logged individually before duplicate grouping.

| ID | Source | Severity / disposition | Evidence and route |
|---|---|---|---|
| B1 | blind | medium / patch | Daily table renders future bins numerically although line suppresses them. Match cutoff and explain unobserved values. |
| B2 | blind | low / patch | Exposure helper hardcodes UTC+03 while API uses historical IANA timezone. Use report timezone without changing accepted dates. |
| B3 | blind | low / patch | Integer ratio truncation can hide tiny positive share. Exact labels survive; disclose chart precision, keep truthful geometry. |
| B4 | blind | low / patch | Per-cell exposure only sr-only. Make occurrence detail available to sighted keyboard/touch users. |
| B5 | blind | low / patch | Shared chart-failure copy promises tables absent on home. Context-independent fallback with Reports destination already present. |
| B6 | blind | low / patch | Unavailable copy says totals below; home totals above. Remove positional claim. |
| B7 | blind | medium / patch | Window Escape handler ignores defaultPrevented. Respect nested controls and avoid unrelated focus capture. |
| B8 | blind | low / patch | Queue is independently fetched without its capture time. Add accurately labelled client load timestamp. |
| B9 | blind | low / patch | Zero available stock has no exception styling. Explicit unavailable label and existing exception marker. |
| B10 | blind | low / patch | Axis and tooltip raw date strings bypass locale formatters. Localized Gregorian date labels. |
| E1 | edge | medium / patch, duplicate B1 | Future daily table zeros; fix same root once. |
| V1 | verification | medium / patch | No dashboard date-boundary assertion; controlled-clock request/visible-period test. |
| V2 | verification | medium / patch | No rendered opening-cell value/unobserved assertions; deterministic fixture test. |

Issue2 remains open: approved slice does not include its broader comparison-period, department-filter and laboratory-turnaround scope. Completion here means this approved slice and release video, not that entire roadmap issue.

## Design Notes

Founder supplied https://med-ethiopia-seven.vercel.app/ as a visual benchmark on2026-10-15. Root inspected its rendered desktop1440px and mobile390px views. Adopt its coherent hierarchy, restrained typography, consistent spacing, compact utilities, deliberate chart proportions and readable table/status styling. The reference is a direction for craft, not a source of product facts or demonstrated backend behavior. Preserve Medi identity, roles, localization and truthful data semantics. Address mobile navigation that currently consumes the first screen before report content: use a keyboard-accessible collapsible navigation treatment, retaining fixed desktop navigation and draft/pending guards. Show actual report content prominently; don't recreate an unrelated generic dashboard or copy unverified metric/backup claims. Existing golden screenshots are evidence of what needs improvement, not the target design standard.


Visual choice follows the question, not a target chart count. Daily lines show change; a heatmap shows timing concentration; a donut encodes one composition with a clear denominator; a product/status matrix highlights exceptions without mixing units. Existing scalar totals remain scalar. No 3D, gauges or decorative sparklines. Recharts official API/accessibility documentation was checked as a candidate; exact dependency/version choice remains implementation work.

## Verification

Types, format, locale, meaningful API/helper tests and affected browser checks. Independently review the diff, inspect EN/AM desktop/mobile once, then rebuild/verify HTTPS. Push authorized repository and report GitHub CI pending without waiting. Resume video only after this feature passes checks.

### Implementation evidence (2026-10-15)

- Typed daily and sparse ISO weekday/hour bins use independent opening/closure timestamps, tenant scope, the existing hospital snapshot lock, audit transaction and cumulative budget. No migrations or production fixtures were added.
- Recharts3.9.2 is pinned and lazy-loaded behind chart boundaries. Official Line/Pie/accessibility APIs were checked. The existing exact current-stock table is the exception matrix, avoiding a duplicate25-row table.
- API report suite:21/21passed, including366-day bounds, reconciliation, role/tenant projection, concurrency, audit rollback, budget and disconnect cleanup. Normal `npm test` includes the new financial-ratio/exposure helpers:13tests across3files passed. Types, server types, full format check and EN/AM localization checks passed; Vite production build passed.
- Fresh-API report browser cases passed across the base suite and targeted correction confirmations. Mobile overflow was isolated to absolutely positioned accessibility labels escaping the heatmap scroll container; a containing block fixes it. All22existing mobile navigation cases passed. The new disclosure test passed after switching its synthetic role to avoid the shared administrator login-attempt budget.
- One bounded EN/AM desktop/mobile visual batch and correction confirmation cover Light/Teal, Dark/Blue and Dark/Violet, axe, mobile containment, exact money/stock, chart-chunk fallback and print/reduced-motion. Final captures: `artifacts/reports-ui/{desktop,mobile}-{home,report}-{en-light-teal,en-dark-blue,am-dark-violet}.png`; print PDFs are beside them.
- Root retains independent reviews, packaged HTTPS verification, authorized issue closure/push and the separate narrated release video. No video was published or rendered by this implementation task.


## Root implementation audit

Runtime source frozen. API21/21, shared/helper13/13, client/server types, format,
localization and production build pass. First reused-API browser batch had47passes
before stopping for stale backend DTO; fresh API confirms all report scenarios.
Targeted mobile27-case confirmation had26passes and one login-budget fixture
failure before UI; corrected receptionist fixture passes the isolated disclosure
case. Desktop2-case final matrix, pharmacist home2cases and final mobile heatmap
header1case all pass. Existing other browser suites had navigation helpers adapted
but were not broadly rerun. Root read changed API, shared shapes, home, shell,
chart/boundary/arithmetic components and relevant verification code. Matrix rows
have passing API/helper/browser evidence, including366bins, tenant/role scopes,
future exposure, zero/large amounts, chunk failure, mobile/bilingual/themes/print.

Visual review used actual reference, desktop home/report and mobile home/report.
Reviewer requested only heatmap header separation and current DESIGN layout prose.
Same reviewer scored both fixes resolved, no correction regressions observed,
ship at that two-fix scope. No decorative rewrite or further palette loop.
Delivery followups (after source review): root HTTPS rebuild/verify, issue2scope assessment (kept open),
commit/push with CIpending, then independently authorized narrated video capture.

### Review correction verification

All13individual findings above addressed in one correction batch (B1/E1 share one fix). Root reviewed the corrections: future daily cutoffs, IANA historical exposure cache, independent bounded ratios with precision disclosure, visible occurrence details, context-independent fallbacks, prevented Escape events/focus scope, queue client receipt time, zero-availability status and localized Gregorian chart dates. No broader product surface was added. Targeted browsers12/12reports/home +1/1mobile Escape and helper5/5passed; browsers terminal before root build.

Root final build/client types, server types, unit16/16, localization2/2 plus catalog3206values, full formatting and diff checks passed. Earlier API21/21 and production dependency audit0vulnerabilities remain applicable (no API/dependency edits in correction batch). Full unrelated browser suites were not rerun locally; CI will run without waiting. Issue2 remains open for broader unimplemented scope.

### Delivery

Packaged HTTPS rebuild succeeded with preserved private configuration, database volumes and authentication factors. Release gate passed after adapting its Reports navigation selector to the newly shared dashboard link and asserting the stable current-stock region instead of the renamed heading. This was verifier maintenance; no runtime correction was needed. Gate covers restricted roles, clinical correction persistence, staff/configuration, billing replay and ledgers, inventory, audited reports, real MFA browser sign-in/refresh/preferences/security/sign-out with no runtime errors. New source is served at https://localhost:8443. Broader issue2 remains open. Separate real-app fictional-data video capture and English narration are complete; final MP4 export resumed after feature checks.
