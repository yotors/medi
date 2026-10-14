---
title: 'Clinical amendments and corrected-result review'
type: 'feature'
created: '2026-10-14'
status: 'done'
route: 'dispatch'
baseline_commit: '60f555d841d3d7f02bebfb87a3b1adfcd903055d'
review_loop_iteration: 1
context:
  - '/home/habtetsega/Desktop/mpx/product-studio/AGENTS.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/PRODUCT.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/DESIGN.md'
  - '/home/habtetsega/Desktop/mpx/product-studio/.agents/skills/impeccable/reference/craft-floor.md'
---

<frozen-after-approval reason="User authorized continuing all remaining engineering work; separate sequential slices retain that scope.">

## Intent

**Problem:** Saved clinical notes and released results cannot be corrected safely, and a correction after closure has no visible follow-up.
**Approach:** Append attributable corrections without changing originals; explicitly assign and acknowledge corrected-result review, visible even after closure. This is synthetic engineering functionality awaiting clinical validation.

## Boundaries & Constraints

**Always:** Preserve original visit JSON/revision for overlay writes, immutable historical author/text/time/reason, hospital isolation, current permissions, exact retry, concurrency integrity. Retain light/teal established staff UI. Clinician/admin amend notes; lab/admin correct results; clinician/admin review or take over with reason. Explicit active clinician/admin reviewer selection. Original records remain distinguishable from latest corrections. Original review remains separately required when applicable.
**Never:** Reopen closed visits, silently overwrite historical text, infer clinical decisions, claim clinical sign-off, implement dosing or critical-value thresholds, modify secrets or sibling apps.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Amend note | Existing active/closed note, text, reason, expected version | Original retained; ordered amendment history with author/time | Missing reason or target rejected |
| Correct result | Released/reviewed result, text, reason, eligible owner | Fresh review obligation, active or closed visit | Other statuses and foreign/disabled owners rejected |
| Review | Assigned eligible reviewer or attributable takeover, exact latest correction | Acknowledgement records reviewer/time; later correction requires new review | Old version conflicts; no inherited acknowledgement |
| Closure | Outstanding correction | Active visit cannot close; already-closed visit stays closed with visible follow-up | Transactional conflict |
| Retry/race | Same key and actor/payload; conflicting or concurrent write | One append/receipt; stale version rejected; close/correction serialized | Reused different payload/actor conflicts |
| Access/failure | Wrong hospital/role/revoked actor; audit/DB failure | No narratives leak, no partial state; bounded timeout | Scoped404,403,401,503 as appropriate |

</frozen-after-approval>

## Code Map

- `server/outpatient.ts`: hospital-first locks, projection/summary, commands and close gate. Batch overlay counts for queues; add explicit outstanding-corrections filter covering closed visits.
- `shared/outpatient.ts`, `src/domain.ts`: existing visit DTO; preserve domain immutable originals and legacy transitions. Original note/order authors live in audit subject metadata where available; do not invent missing attribution.
- `server/migrations/002_outpatient.sql`, `003_outpatient_integrity.sql`: closed JSON/result guards and one audit event per visit revision; overlay audit must be separate.
- `server/billing.ts`: reusable currentActor-after-lock, normalized UUID, strict schema, timeout and immutable receipt patterns.
- `src/staff/VisitPanel.tsx`, `VisitWorkspace.tsx`, `api.ts`: role sections, preserved drafts/pending guards, keyboard and retry flows. Clinical controls must work independently of active-only can().
- `server/db.ts`, `server/app.ts`, `deploy/migrate.mjs`: migration008, route registration and explicit grants.
- `server/outpatient.test.ts`, `tests/outpatient.spec.ts`: isolated synthetic DB and browser fixtures.
- `tooling/database.mjs`: automatic all-table restore checks; `tooling/release-verify.mjs`: explicit persistent fixture list.

## Tasks & Acceptance

**Execution:**
- [x] `shared/clinical.ts`, `server/clinical.ts`, migration008 -- add strict overlay read/write/reviewer APIs and append-only amendments, review/takeover events and request receipts. Composite tenant FKs, immutable triggers; actor snapshots. Latest version and assigned owner computed from history. Any clinician/admin can explicitly take over with required reason before review; disabled owners remain visible.
- [x] `server/outpatient.ts`, `shared/outpatient.ts` -- integrate role-safe clinical DTOs/counts, outstanding review filter, and close gate. Notes visible only admin/clinician, corrected results admin/clinician/lab; metadata-only history for auditor. Preserve existing sections and original review controls.
- [x] `src/staff/ClinicalCorrections.tsx`, visit panels/workspace/styles -- inline amendment/correction/review history and forms, original/current distinction, owner select, dedicated queue filter including closed. Preserve drafts on stale/uncertain saves; retry identical requests; guards and session reset.
- [x] `server/app.ts`, `server/db.ts`, `deploy/migrate.mjs`, test configs -- integrate migration/routes/grants/test registration.
- [x] `server/clinical.test.ts`, `tests/clinical.spec.ts` -- cover matrix, closed originals byte-identical, role/tenant projections, owner takeover, stale review, correction-close concurrency, post-lock revocation, uppercase retry, audit rollback and immutable guards. Browser desktop/mobile workflow, keyboard/axe, error and lost response/drafts.
- [x] Documentation -- update clinical capabilities and remaining validation in staff-workspace/roadmap/readiness, with accurate scope.

**Acceptance Criteria:**
- Latest unresolved corrected result remains discoverable after closure and owner deactivation, and can be reassigned and reviewed without altering original record.
- No unrelated permission gains, demo regression, phantom visit revisions, or partially committed corrections.
- Runtime can append new history and cannot rewrite/delete it; existing local release/restore harness remains compatible.

## Implementation Notes

Implementation handoff owns clinical slice and integration/tests/docs, except root will extend `tooling/release-verify.mjs` and execute release/restore/security checks after implementation. Follow existing UI composition; no new visual identity or repeated user approval. Impeccable context already attempted this session and unavailable; PRODUCT/DESIGN fallback in use. Root performs fresh finish/documenter handoffs. Complete API/browser tests and report screenshot paths; do not commit or push.

## Spec Change Log

- Review pass1: clarify bounded history/current-state reads, distinguish original/current text and identity, disambiguate reviewer selection, invalidate stale success notices, prioritize current corrections and expose assigned work. Preserve immutable original JSON, subject versions, hospital locking, retries and existing passing scenarios. These refine already-authorized correction integrity and discoverability; no intent change. Incremental re-derivation preserves verified implementation rather than deleting working cross-layer code.

## Review Triage Log

| Finding | Verdict and evidence | Resolution |
| --- | --- | --- |
| Blind1 original note ambiguity | high: original note has no amended marker above distant correction section; outdated text can appear current | Label superseded originals and link latest correction |
| Blind2 mutable original attribution | medium: originalAuthor joins current display name without stable ID; rename changes apparent attribution | Stable actor identity plus explicitly current-account name; do not invent historical snapshot |
| Blind3 duplicate reviewer names | high: display names are nonunique and select options expose only names | Include username and role; duplicate-name test |
| Blind4 stale success notice | medium: success state persists after visit prop refresh reveals a newer correction | Bind notice to returned subject/version and invalidate on newer history |
| Blind5 unbounded history | medium: complete events/bodies fetched on every read/write under hospital lock | Bounded current projection and paginated immutable history |
| Blind6 direct SQL malformed ledger | low: application validates targets and inserts amendment/event atomically; requires erroneous future/direct writer, not current endpoint | Reject additional deferred trigger complexity for this hypothetical path |
| Blind7 empty eligible reviewers | low: empty successful select has no explanation | Explicit empty-state recovery copy |
| Blind8 correction queue ordering/ownership | medium: queue ordered by visit opening can bury newly corrected old encounters; ownership undiscoverable without opening | Sort correction queue by latest correction, add assigned-to-me filter and role-safe owner metadata |
| Blind9 browser handoff | medium: new browser suite uses admin only, leaving actual lab/clinician controls unverified | Add separate lab/clinician browser sessions and deny inappropriate controls |
| Blind10 authority cases | medium: only inactive-after-lock tested; role/reset/expiry/replay branches need explicit regression evidence | Parameterized post-lock and replay authority tests |
| Edge1 unbounded history | medium: same complete-history path confirmed | Same bounded-history resolution as Blind5 |
| Verification1 embedded projections | high: populated dedicated endpoint tested, ordinary visit projection not tested for all roles | Add populated seven-role embedded response assertions |
| Verification2 reviewer eligibility | medium: inactive/reset assignment rejection absent despite title; owner availability reset branch untested | Add inactive/reset/changed-role assignment, choice, existing-owner tests |


## Verification

- `npm run typecheck` and `npm run typecheck:server` -- pass.
- `node --env-file-if-exists=.env --import tsx --test server/clinical.test.ts` -- 13/13 pass. Full API regression launched; root owns completion evidence.
- `npm run test:staff -- tests/clinical.spec.ts` -- 8/10 initially passed; two failures were a duplicate-text test selector, fixed by scoping to the status badge. Focused desktop/mobile rerun 2/2 passed, covering all ten cases. Six screenshots at `artifacts/clinical-ui/{desktop,mobile}-{pending,reviewed,draft}.png`; automated axe and horizontal overflow checks pass.
- `npm run build` -- built client passes; root runs release, restore and security after integration.
- Existing billing/outpatient browser expectations updated only for the closed-visit notice: originals remain immutable while append-only corrections remain available.
- API development process restarted with migration008; session93920 serves current routes. No commit or push performed by implementer.

- Root built HTTPS release and extended verifier pass: closed-original preservation, correction review, stable retries, restricted clinical grants and persisted fixture digests. Root typechecks/unit16 pass.
- Review harness limitation: new agent threads unavailable; three layers reuse existing threads, including implementation thread for verification-gap. Independent blind/edge layers use investigators from other slices.

- Full API regression95/96: sole failure was old migration-array expectation; root updates versions1–8 and reruns migration case. No business assertion weakened.

### Review pass1 patch evidence

- Latest-state reads now use indexed lateral lookups for one current amendment/review/owner per subject; writes read only their target subject. `/clinical/history` returns explicit25-event pages, with narratives omitted for auditors. Current state is independent of history page.
- Original text is marked amended/corrected and links focus to its latest entry. Original attribution exposes stable actor ID/username and labels display names as current; reviewer options include username and role.
- Saved notices are tied to subject/version and cleared by newer state; empty reviewer choices explain activation/password requirements and refresh. Correction queues sort by correction time and support assigned-to-me with clinical-only owner/time metadata.
- Focused clinical API19/19 pass, including53-amendment pagination, seven embedded role projections, reviewer eligibility/rename, queue ownership, and post-lock role/reset/expiry write/read/replay checks synchronized to the exact blocker PID.
- Focused clinical browser18/18 pass across desktop/mobile, including actual lab-to-clinician sessions,27-event paging, focus links, stale notices and empty/duplicate reviewer options. Screenshot evidence additionally includes `{desktop,mobile}-original-amendment.png` and `{desktop,mobile}-clinician-handoff.png`.
- Frontend/server typechecks and diff whitespace check pass. Root owns broader regression, final release/restore/security and fresh visual disposition.

- Follow-up review: Blind1–5,7–10 and Edge1 resolved. Added one medium copy regression (assigned-to-me empty message implied hospital-wide emptiness); corrected and focused browser assertion passes. Verification1–2 addressed by populated role matrix and eligibility cases. No accepted finding deferred.
- Post-review clinical API19/19; outpatient regression15/15 (including additive migration replay); clinical browser18/18 plus final assigned-empty2/2; both typechecks pass. Source Semgrep130targets,0findings with clinical backend/shared/both components confirmed scanned. Final reviewed-code HTTPS rebuild and release verifier pass, including prior-run digest comparison; local restore27tables matches schema/counts/digests.
- Impeccable detector recovered using project-local ignored cache; three typography advisories17/16/13px match incumbent styles. Documenter: no system changes; preexisting sparse type ramp/sidecar wording reported, not repaired. Finish reviewer requested screenshot-only recapture to remove offscreen fixed skip-link artifact; recapture completed: eight focused desktop/mobile tests pass and all ten clean captures inspected. Finish reviewer disposition ship, no material fixes; established typography, original/current distinction, review responsibility, draft recovery and mobile composition accepted.
