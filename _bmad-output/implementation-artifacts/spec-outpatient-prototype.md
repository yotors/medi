---
title: Outpatient workflow prototype
status: done
route: dispatch
date: 2026-10-13
baseline_commit: UNBORN_HEAD
context:
  - PRODUCT.md
  - DESIGN.md
---

# Outpatient workflow prototype

<frozen-after-approval>
## Intent
Build a working, locally persisted synthetic-data outpatient workflow for the founder to evaluate. User authorized starting implementation using existing research and the student reference. This is a first slice toward the hospital product; it does not claim production readiness or implementation of all24 candidate requirements. Existing setup files are uncommitted from earlier authorized work and must be preserved. No commits, external deployments or live patient data.

## Decisions and invariants
React/TypeScript/Vite; Radix Dialog for focus-safe patient-detail and confirmation overlays; Lucide icons; locally bundled fonts. Client-only demo with explicit banner, synthetic starting records, validated browser persistence and reset confirmation. No sign-in facade, insecure demo endpoint or simulated claim of hospital isolation. No automated diagnosis/prescribing. Form copy instructs fictional data. No patient email required. Optional contact/age; stable IDs and intentional duplicate-name warning. One patient can have many historical visits but only one active demo visit.

Demo workspaces: patient flow, directory, diagnostics, pharmacy, billing and activity. All navigation and visible controls work. A selected visit connects clinical notes, diagnostic order states, prescription fulfillment, invoice and chronology. Test lifecycle: requested→collected→released→reviewed, plus cancel before release. Clinical draft notes and released results preserve chronology through events; this prototype does not implement legally sufficient audit or signed records. Charge consultation at check-in; add a charge per unique diagnostic order. Cancelled requests reverse their unpaid demo charge and cannot be retried as active orders accidentally. Payments use integer minor ETB and block duplicate settlement of a paid balance. No card details, external processors, insurance or real receipts.

Visit closure requires a saved note, reviewed/cancelled investigations, fulfilled/cancelled prescriptions and zero balance. Referral, emergency workflows, admission, stock, real authorization and result amendments are deferred. Close blocks expose reasons. Closed encounters cannot be edited. Every mutation occurs through typed domain commands and updates event history. Persistence failures are visible; corrupt saved data requires an explicit reset, never silent replacement. Use a session tab lock or conflict detection so stale tabs cannot silently overwrite newer work.

## I/O & Edge-Case Matrix
| Scenario | Input/state | Expected behavior | Recovery |
| --- | --- | --- | --- |
| No email | New fictional patient without email/contact | Created and check-in possible | Validate required name only; bound optional age |
| Duplicate active visit | Check in same patient twice | One active visit | Open existing visit |
| Order transitions | Release before collection or review before release | Rejected; state unchanged | Explain required preceding step |
| Payment retry | Repeat settlement command | No duplicate payment | Already-paid feedback |
| Close pending work | Note missing or unresolved work or balance | Remains open | List blockers |
| Reload | Valid persisted state | Same records and payments | Versioned schema |
| Corrupt storage | Invalid stored state | Explicit recovery screen | Confirm reset to fictional seed |
| Stale tab | Revision changed | Block stale mutation | Reload latest records |
</frozen-after-approval>

## Code Map
Existing `package.json` contains tooling dependencies; preserve scripts. Existing `playwright.config.mjs` tests tooling only; use a separate application config. `tooling/audit-ui.mjs` captures desktop/mobile and axe. Research lives in `_bmad-output/planning-artifacts/research/domain-ethiopian-hospital-workflows-and-require-2026-10-12/`. No app exists.

## Tasks & Acceptance
- [x] `src/domain.ts`, `src/seed.ts`, `src/storage.ts` — typed model, transitions, validation, persistent demo data.
- [x] `src/App.tsx`, `src/components/*`, `src/styles.css`, `src/main.tsx` — responsive, keyboard-friendly app and all workflow actions.
- [x] `index.html`, `vite.config.ts`, `tsconfig.json`, `package.json` — runnable dev/build/typecheck commands preserving tooling.
- [x] `src/domain.test.ts`, `src/storage.test.ts`, `tests/app.spec.ts`, `playwright.app.config.ts` — transition, persistence, browser and accessibility checks.
- [x] `README.md`, `docs/prototype.md`, `DESIGN.md` — commands, decisions, limitations and verified evidence.
- [x] `.github/workflows/tooling.yml` — include app build/typecheck/unit/browser gates while preserving existing checks.

Acceptance:
- Given a fresh demo, when a patient is registered and checked in, then the directory and active queue show the same identity without requiring email.
- Given an active visit, when staff complete consultation, test, review and settlement, then closure succeeds and persists on reload with ordered activity.
- Given desktop/mobile widths, when navigating and completing forms by keyboard, then visible controls work, dialogs manage focus, text fits and axe reports no violations in tested states.
- Given filters with no matches, when reset, then the worklist returns without losing data.

## Implementation Notes
2026-10-13: User explicitly delegated building. Proceed with reversible local implementation rather than repeating approval gates from skills. User explicitly selected the calm workspace: light background, teal accents and clear patient lists. Branch main has no commits and consists of prior session scaffold; no staging or reset permitted.

## Spec Change Log

- 2026-10-13: Extended existing `tooling.yml` instead of adding `quality.yml`;
  preserved tooling/security gates. Added scenario and review regression suites.
- Final design extracts implemented tokens into DESIGN.md and the local
  `.impeccable/design.json` sidecar. The earlier seed is retained as an artifact.
- Local repository remains unborn and unstaged. No commit, push or deployment.
  GitHub connector identifies yotors but exposes no repository-creation action;
  user was asked to provide an empty private repository URL.


## Review Triage Log

Three independent code/test reviews and one bounded screenshot review were
completed under BMad/Impeccable. Two code reviewers were fresh contexts; the third
and visual reviewer reused idle research agents with an explicitly scoped task.
No review is represented as a security audit or clinical validation.

| Finding | Disposition and evidence |
| --- | --- |
| Focus target disappears when settlement/fulfillment removes row (two reviewers) | Fixed: return to workspace; desktop/mobile regression. |
| Long activity name overflows mobile | Fixed: wrapping; 100-character-name regression. |
| No browser coverage of quota failure and retry | Added injected save failure: unchanged records/storage, retained draft, exactly one successful retry. |
| Department membership only checked through headings | Added before/after membership and contextual tab checks. |
| Missing paid-order cancellation coverage | Added paid charge/payment retention and zero-balance test. |
| Department closed filters cannot return records | Removed impossible filters from pending-work lists. |
| Dismissal loses unsaved visit drafts | Retain drafts per visit for page session; block closure with unfinished drafts. Reload limitation documented. |
| Editing during pending save can lose text | Disable draft fields during persistence. |
| Optional contact is collected but hidden | Show directory and visit detail contact. |
| Cancelling test is irreversible within visit | Explicit confirmation explains no reorder and demo charge/refund behavior. No clinical retry workflow claimed. |
| Reset leaves registration draft | Clear name, age, contact, duplicate confirmation and visit drafts; browser regression. |
| Department visit opens wrong tab | Open Diagnostics/Pharmacy/Billing/History from corresponding workspaces. |
| Corrupt cancelled unpaid charge accepted | Schema rejects unreversed charge; storage regression. |
| Initial text contrast and decorative note border | Darkened footer, removed redundant small label, uniform note border; final axe zero. |
| Mobile patient action not visually apparent | Teal underlined names; reviewer verified final capture and accepted for prototype review. |


## Verification
`npm run typecheck`, `npm test`, `npm run build`, `npm run test:app`, `npm run audit:ui -- http://127.0.0.1:5173`, source/dependency scans. Inspect desktop/mobile screenshots in at most two visual rounds; address failures before reporting.

2026-10-13 final: 14 unit tests, 12 browser cases, TypeScript/build pass; desktop/mobile axe and runtime errors zero; source/dependency checks pass. See [dated verification](../../docs/prototype-verification.md) for scope and artifacts. All review findings triaged above; no required local prototype work remains. Production delivery and remote setup remain separate.
