---
title: Bilingual public showcase and hospital workspace experience
type: feature
created: 2026-10-14
status: done
route: dispatch
review_loop_iteration: 0
baseline_commit: dffdce7664618b5194f0a4874ea1569455b578ad
context: [PRODUCT.md, DESIGN.md, AGENTS.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The verified hospital workflows are difficult to discover behind a flat row of panel-switching buttons. There is no public product homepage, role dashboard, full Amharic interface or scannable MFA enrollment.

**Approach:** Preserve the React/TypeScript/Fastify/PostgreSQL architecture and calm teal identity. Deliver a polished public homepage, a responsive routed staff workspace with a useful home dashboard, English/Amharic interface localization and private, locally generated MFA QR codes. The user explicitly chose both a public homepage and staff dashboard.

## Boundaries & Constraints

**Always:** Keep hospital/role authorization, mandatory MFA, dirty-draft confirmation, mutation locks, expiry and cross-tab cleanup. Use truthful product copy and fictional showcase records. Persist only the language preference in browser storage. Translate interface copy and presentation labels throughout all existing workspaces. Keep hospital calendar settings independent from UI language. Retain manual MFA setup and recovery. User approved extensible localization: use stable semantic translation keys, namespaces, interpolation/plural rules, a language registry and shared number/date/currency formatters; adding a language should add catalogs/registry metadata rather than language-specific component branches. Enforce catalog parity and safe English fallback. Choose established React i18n tooling, bundle resources and never send patient content to a translation service.

**Never:** Fabricate customer logos, certifications, live payments or operational statistics. Translate patient-entered names/notes, catalog content or stored protocol enums. Expose protected records before authentication. Send MFA secrets to external QR generators. Reset current accounts. Introduce a framework rewrite, SQL migration, paid deployment or payment implementation in this pass. Preserve founder .vscode settings and original backups.

## I/O & Edge-Case Matrix

| Scenario | State | Expected behavior | Error handling |
| --- | --- | --- | --- |
| Entry | Anonymous visitor at / | Bilingual product homepage with staff sign-in CTA | No protected requests or fictional claims |
| Direct link | /staff/patients or another workspace | Restore session, complete MFA/password gates, then show authorized destination | Unknown/forbidden routes show clear recovery navigation |
| Departure | Dirty form or pending mutation | Same protection for links, nested navigation and browser Back/Forward | Cancel preserves draft and URL; pending writes block departure |
| Language | Toggle English/Amharic while editing | Labels update without discarding inputs or changing hospital settings | Invalid/unavailable preference falls back to English |
| MFA setup | Valid in-memory enrollment secret | Scannable local QR and manual key; same existing protocol | Expiry/account changes remove QR and key together |

</frozen-after-approval>

## Code Map

- `src/main.tsx`: currently renders StaffApp for every URL; add public/staff entry routing and language provider.
- `src/staff/StaffApp.tsx`: state-only navigation; reuse navigateAccount, mayDiscardVisit, beforeunload, session generation and auth gates.
- `src/staff/staff.css`, `src/styles.css`: existing teal tokens, responsive controls and focus states.
- `src/staff/MfaChallenge.tsx`: enrollment secret lifecycle, private capture wrapper, recovery and expiry handling.
- `src/staff/api.ts`: stable ApiError codes; map known failures to translated safe copy.
- `shared/care.ts`, `shared/reports.ts`, `DepartmentWorkspace.tsx`: existing role and category visibility; preserve server authority.
- `shared/hospital-format.ts`, `src/staff/date.ts`: record date locale/calendar, distinct from UI language.
- `src/staff/*.tsx`: 29 files contain English labels, prompts, dynamic field definitions or enum displays.
- `tests/*.spec.ts`: existing button-based navigation selectors and directory-after-login assumptions need coordinated updates.

## Tasks & Acceptance

**Execution:**
- [x] `src/i18n/*`, `src/main.tsx`, `package.json`: add bundled English/Amharic catalogs, React localization provider and local Ethiopic font; no external translation service.
- [x] `src/public/ProductHome.tsx`, `src/public/product-home.css`: truthful product story, actual product preview, workflow tour and staff-entry links; responsive bilingual composition in the established identity.
- [x] `src/staff/navigation.ts`, `StaffApp.tsx`, `staff.css`: grouped desktop sidebar, mobile navigation, breadcrumb/current-page state, true links and guarded URL transitions.
- [x] `src/staff/WorkspaceHome.tsx`: role-specific starting tasks and authorized live lists; distinguish current queues from period reports and avoid report-polling audit noise or totals inferred from partial pages.
- [x] `src/staff/*.tsx`, `src/i18n/*`: translate all existing controls, help, status labels, confirmations, accessible names and safe error messages; use interpolation and label maps, not DOM text replacement.
- [x] `src/staff/MfaChallenge.tsx`, `package.json`: generate an encoded otpauth URI using existing identity/secret and render QR locally; match SHA1/six digits/30 seconds, quiet zone and private capture masking.
- [x] `tests/navigation.spec.ts`, `tests/localization.spec.ts`, MFA/browser suites: verify routing, authorization, drafts, language changes and QR enrollment; update existing navigation selectors without weakening assertions.
- [x] `docs/ui-navigation.md`, `PRODUCT.md`, `DESIGN.md`: document roles, page map, language behavior and visual changes. Create a GitHub backlog issue for Ethiopian payment integration with provider selection, signed callbacks, idempotency, reconciliation, refunds and sandbox acceptance; claim no live integration.

**Acceptance Criteria:**
- Given each staff role, when signed in, then its home and navigation expose only authorized destinations and explain the current role without impersonation.
- Given a permitted deep link, when refreshed or reached with Back/Forward, then the same page is restored after authentication and dirty-state checks.
- Given English or Amharic, when using public, login, MFA and existing operational flows, then interface and accessibility labels match that language and patient content remains unchanged.
- Given MFA enrollment, when the QR is decoded and scanned, then it matches the existing authenticator protocol and completes enrollment; expiry and private-artifact checks protect it.
- Given desktop/mobile layouts, when tested with keyboard, axe and long Amharic content, then controls remain accessible and no page-level horizontal overflow occurs.

## Implementation Notes

User approved implementation on2026-10-14, with extensible future-language architecture. Root orchestrates the already-running BMad workflow; the implementation handoff executes this spec directly, without recursively starting another BMad build. Root handles final workflow review and authorized remote delivery after local implementation. Existing GitHub issue task is authorized by the approved scope. No paid deployment is authorized.
Baseline: dffdce7664618b5194f0a4874ea1569455b578ad. Existing untracked .vscode is founder-owned.
Public homepage and dashboard selected by the user; no unresolved product-purpose question.

## Spec Change Log

2026-10-15: Review corrections implemented for raw configuration routes, approved registration discard, complete pagination/picker messages, scoped statuses/fallbacks, Addis grant expiry, exact source presentation metadata, distinct refund/reversal kinds, independent role expectations, extensible plural/residue checks and exact dependency pins. Added focused regressions and CI-gate invocation; status remains in-review for root verification.

## Review Triage Log


| Finding | Verdict | Verified evidence and route |
| --- | --- | --- |
| Blind1 patient pagination | fixed (medium) | Literal patient/patients is rendered in StaffApp1097; fixed with plural/interpolated status. |
| Blind2 configuration nouns | fixed (medium) | HospitalConfiguration354/374/555 render literal department/service branches; fixed with complete messages. |
| Blind3 correction empty state | fixed (medium) | ClinicalCorrections370 renders English amendments/corrections; fixed with whole states. |
| Blind4 history active state | fixed (medium) | InventoryHistory204 emits literal active/inactive; fixed with scoped presentation label. |
| Blind5 unknown investigation | fixed (low) | VisitPanel189 has visible English fallback; direct translated fallback patch. |
| Blind6 grant expiry | fixed (medium) | StaffAdministration389 uses browser-default time/locale; fixed with shared Addis UI formatter. |
| Blind7 source amounts/dates | fixed (medium) | Structured source values carry money strings and truncated UTC time; fixed with raw minor values/ISO timestamps and client formatting. |
| Blind8 cash adjustment kind | fixed (medium) | Cash source union deliberately uses refund allocation discriminator for reversals too, losing authoritative finance kind in new label; fixed with separate presentation field. |
| Blind9 source residue gate | fixed (medium) | Static checker only validates t/uiMessage keys; demonstrated JSX/conditional residues pass; fixed with scoped rendered-literal checks and regressions. |
| Blind10 queue destination | false | Link explicitly says Outpatient visits and queue help explicitly promises the full filtered workspace, not individual visit opening; action behaves as named. No new patient-ID URL surface added. |
| Edge1 discarded registration | fixed (medium) | goTo hides form without clearForm and Register button reopens existing state; fixed with clear only after approved departure, preserve no-op/cancel drafts. |
| Edge2 reversal/refund | fixed (medium) | Same verified cause as Blind8; one shared patch. |
| Edge3 count translation | fixed (medium) | Same verified cause as Blind1; one shared patch. |
| Verification1 noncash picker coverage | fixed (medium) | Filed regression gap accepted: existing translated cash test does not verify specimen label; fixed with lab language-switch/selection assertion. |
| Verification2 localized API paths | fixed (high) | HospitalConfiguration109/165/221 uses presentationLabel(kind) for protocol path; server only registers stable English identifiers. Fixed with raw kind and actual Amharic configuration regression. |
| Verification3 old nav selector | fixed (medium) | configuration.spec42 still uses button for true-link navigation; fixed with selector while preserving assertions. |
| Root1 picker sentence fragments | fixed (medium) | DepartmentPicker assembles Find/label/choices and other sentences from fragments; fixed with complete interpolated messages for reorderable future languages. |
| Root2 future plural/identical words | fixed (medium) | Checker requires identical English plural-key sets for every language and rejects valid shared Latin-language words. Fixed with locale plural-category validation and script-aware residue rules plus French/Arabic/Japanese fixtures. |
| Root3 dependency consistency | fixed (low) | New caret ranges differ from existing exact pins; direct package/lock correction only. |
| Root4 role-nav test oracle | fixed (medium) | navigation.spec imports destinations to construct expected menu, mirroring the implementation and masking future permission regression. Fixed with independent explicit per-role route expectations. |

## Design Notes

Preserve the approved light/teal workspace. Public pages explain the product; staff pages prioritize real work. Use a coherent sidebar and conventional form/table navigation rather than adding decorative pages. Dashboard starts with actual role tasks, not invented metric cards. Full interface localization is new functionality; existing Amharic date formatting is not presented as completed translation. Fluent Amharic clinical terminology review remains distinct from technical translation coverage.

## Verification

Run format/type/build and translation-key parity checks, targeted route/localization/QR tests and existing changed-flow regressions. Inspect desktop/mobile screenshots in both languages in one batched pass and one confirmation at most. Mask all QR/key/recovery artifacts. Run dependency audit and exact revision CI before claiming the changed release verified. Rebuild and verify the local HTTPS package so its interface matches the development app. No public-cloud deployment in this pass.

Authorized payment backlog issue created: https://github.com/yotors/medi/issues/1 . Connected GitHub app lacked repository search access; existing repository Git authentication completed creation safely.


Review-fix verification (2026-10-15): the selected real department-source server test passed, including real refund/reversal events, distinct authoritative presentation kinds, unchanged allocation IDs/legacy labels and exact minor values. The bounded browser batch passed 20 cases across desktop/mobile (all eight independent role menus, registration cancel/current-route preservation and approved discard, plus the existing lab handoff with Amharic status/interface text, unchanged patient/catalog content and selected identifier). Its two configuration cases exposed missing conditional add-message keys; these were corrected, and static key validation now checks conditional translation calls with a regression. The existing `test:localization` CI gate now runs checker fixtures and the two choice-label unit tests before catalog/source validation; it passed with 3,096 values. Source counts/static checks do not replace runtime or fluent semantic review. Final configuration-only browser result is recorded below; root owns format/type/build, HTTPS packaging and full exact-revision CI.

Final configuration-only retry: mobile passed in 6.8 seconds against final code and test, exercising real Amharic catalog read/history/conflict/revision reload/write. Desktop timed out because its already-loaded test reloaded before the asynchronous language selection persisted. Added an explicit `html.lang=am` wait before reload; mobile loaded and passed this corrected test. No third browser run was attempted under the bounded verification instruction. Root must confirm final desktop behavior during its full verification, or run `npm run test:staff -- tests/configuration.spec.ts --project=desktop --grep 'Amharic catalog'`. All owned command sessions ended; the browser-owned API lifecycle is not a persistent development-server handoff.

Root verification (2026-10-15): format, server typecheck, frontend typecheck/build and the expanded localization gate passed. Corrected Amharic configuration history/conflict/revision/write flow passed independently on desktop and mobile. The isolated production installation and encrypted replacement recovery passed; HTTPS release verification passed against preserved original fixtures. A desktop keyboard regression exposed focus moving on session-expiry object updates: heading focus now runs before interaction only on navigation, registration state and identity/authentication transitions. A focused regression verifies session activity preserves input focus. Earlier transient development-catalog loading failure was cleared by restarting the owned stale Vite process; final verification uses fresh servers. Final CI evidence follows after remote execution.

Final focused keyboard/navigation/outpatient batch: all 6 cases passed on fresh desktop/mobile servers (2.3 minutes), including protected API projections and draft/focus preservation. Full CI remains the remote delivery gate, not implied by this focused result.

Exact CI run38638476529: source-security and packaged local-release jobs passed; application job completed 202 staff browser cases with 20 failures from ten scenarios repeated across viewports. Triage found stale substring/name/route and raw-error-copy test expectations, plus missing localized transition and inventory conflict messages. Corrected tests retain the same retry, draft, cross-tab logout, domain-status and authorization assertions. Added explicit INVENTORY_STATUS_UNCHANGED domain code and English/Amharic messages; unknown API prose remains hidden. Clinical correction article names now use complete semantic templates. Targeted correction batch passed18/20, with the remaining article-name pair corrected and separately reverified below. No passing CI claim is made for bb82320.

Final clinical correction acknowledgement regression passed on desktop and mobile (2/2,54 seconds), with original records, review state, accessibility and API assertions intact. Expanded locale gate passed3,104 values.

Founder requested delivery without waiting for long-running final CI. Source revision6bc9548 is complete and locally verified; exact full remote CI remains pending and must not be reported as passed. Prior run38638476529 passed security and packaged release; affected browser scenarios were corrected and passed focused desktop/mobile checks. Current HTTPS package and development API/web routes returned200 at final check. Payment integration remains backlog issue1.
