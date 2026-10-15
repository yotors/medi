---
title: Consistent workspace appearance and department navigation
type: feature
created: 2026-10-15
status: done
route: dispatch
review_loop_iteration: 0
baseline_commit: e3b5e1fcf94ee8f7939943a589a66b815fa80d9e
context: [PRODUCT.md, DESIGN.md, AGENTS.md]
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Department navigation resembles command buttons, loading collapses the table, language options retain browser styling, and the homepage offers sign-in to signed-in staff.

**Approach:** Deliver the requested UX pass together: real section navigation, stable reads, custom preference menus, complete themes and session-aware public entry.

## Boundaries & Constraints

**Always:** Account/security navigation belongs in a top-right profile menu with a profile icon and staff name, not the hospital-workflow sidebar. Password, MFA and sign-out use this menu; no invented photo or profile-edit backend. Preserve hospital/role authority, dirty/pending guards, exact retries, clinical facts and EN/AM support. Founder chose light/dark plus color themes: offer Light, Dark and Device modes with Teal, Blue and Violet accents. Default remains light/teal. Preferences preserve drafts and identity; status colors retain meaning.

**Never:** Change business rules/migrations, persist patient/session data in preferences, weaken CSP, disguise stale data, remove consequential save/retry/approval controls, or add decorative transition animation. No paid deployment. Preserve founder-owned `.vscode/`.

## I/O & Edge-Case Matrix

| Scenario | Expected behavior | Failure handling |
| --- | --- | --- |
| Appearance | Mode/accent update all surfaces; refresh retains preference; Device follows OS | Invalid/blocked storage falls back safely |
| Language | Autonyms, selected check, keyboard navigation, Escape/outside dismissal and focus return | Failed chunk preserves current language/draft |
| Department links/history | Authorized `?section=` survives refresh; current section is a no-op | Cancel preserves URL/draft; pending write blocks; invalid section uses role default |
| Department reads | Same-section rows remain visibly updating; category switch reserves layout without wrong-category rows | Cancel superseded reads; explicit stale/retry state; clear private data on auth loss |
| Profile menu | Staff identity/icon trigger; account/security links and sign-out in one menu, removed from workflow sidebar | Authentication gates hide protected settings; dirty/pending guards apply to links and sign-out |
| Homepage CTA | Unknown: Open workspace; anonymous: Sign in; complete: Dashboard; MFA/password gates: Continue sign-in | Failed session read stays neutral; no clinical/report requests |

</frozen-after-approval>

## Code Map

- `DepartmentWorkspace.tsx:501/626/799/971`: list replacement causes flicker; navigation clears current-category state; category has no URL. Reuse role categories and existing guards.
- `StaffApp.tsx`, `navigation.ts`: parent owns history index and popstate restoration; section links must share that ownership.
- `src/i18n/index.tsx`, `languages.ts`: reuse catalog loaders, language registry and failure handling.
- Base/public and nine staff stylesheets:177 literal-color lines need semantic tokens.
- `ProductHome.tsx`, `/api/auth/session`, `hospital-staff-session`: authoritative CTA with focus/logout synchronization.
- `index.html`, `deploy/Caddyfile*`: self-hosted scripts allowed, inline scripts prohibited.

## Tasks & Acceptance

**Execution:**
- [x] `src/staff/AccountMenu.tsx`, `StaffApp.tsx`, shared menus/CSS, browser helpers and release verifier: move account navigation/sign-out to a standard header profile menu; retain true links, gated visibility and pending/dirty guards; update independent role-menu and logout assertions.
- [x] `src/appearance/*`, `public/appearance-init.js`, `index.html`, `src/main.tsx`: validated local preference, CSP-compatible early theme application and live Device changes without remount.
- [x] `src/styles.css`, public/staff CSS: semantic canvas/surface/text/control/border/accent/status tokens across forms, tables, navigation, disabled/error states and menus. Keep QR black/white and print readable.
- [x] `src/components/*`, i18n control, package/lock: shared styled language/appearance menus with an accessible maintained primitive, exact pins, selected/focus states and mobile positioning. Appearance groups mode/accent; language uses registry autonyms.
- [x] Department workspace/CSS and parent routing: compact true section links, guarded query/history transitions, stable loading and response cancellation. Hide redundant single-action selector; keep explicit submission and meaningful actions.
- [x] `ProductHome.tsx`, `src/public/*`: bounded authoritative session check for all entry CTAs; neutral unknown/error state; synchronize logout/focus without storing identity or polling clinical APIs.
- [x] EN/AM catalogs and test helpers: translate new copy; update menu/link interactions without weakening existing assertions.
- [x] Browser specs, `docs/ui-navigation.md`, `DESIGN.md`: verify and document themes, menus, routing and entry behavior.

**Acceptance Criteria:**
- Given supported themes/languages, when using public, login, MFA, registration, departments, inventory and reports, then text remains legible, focus visible and mobile layout contained.
- Given delayed/reordered reads, when refreshing or changing section, then layout stays stable, stale rows cannot authorize writes and wrong-category data never appears current.
- Given dirty/pending work, when using links/history, then cancellation/blocking preserves URL, inputs and exact retry payload.
- Given signed-in staff returning to the homepage, when validation completes, then all entry CTAs lead to Dashboard while authentication gates remain authoritative.

## Implementation Notes

Founder requested this combined pass and light/dark plus accents. Investigation complete; no irreversible changes. Founder approved this spec on2026-10-15 by replying go. Implementation executes this existing workflow handoff, without starting another BMad workflow; root handles review and previously authorized GitHub delivery. Preserve private release fixtures, original images/archives/keyring and credentials; never print secrets. Use bounded targeted checks, then root owns HTTPS rebuild.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
| --- | --- | --- |
| Blind 1: retained rows/page caption | medium | DepartmentWorkspace renders retained list with requested page immediately; patch loaded-page caption. |
| Blind 2: paging while loading | medium | Pagination lacks loading guard and uses retained totals; patch disable while reading. |
| Blind 3: discard stale draft | medium | Discard shares loading/stale write guards although it clears only local state; patch retain pending lock only. |
| Blind 4: history loading | medium | History effect retains events with no read status; patch explicit loading/error state and pagination guards. |
| Blind 5: print during stale reads | medium | Print button is unconditional while record/history reads can fail or remain pending; patch disable until both current. |
| Blind 6: section focus | medium | Parent heading focus effect omits departmentSection; patch include section dependency. |
| Blind 7: language pending | low | Busy blocks selection silently while trigger remains enabled; patch pass disabled to existing menu prop. |
| Blind 8: radio group names | medium | Menu labels are siblings without group association; patch localized aria-labels. |
| Blind 9: storage clear | low | Storage handler filters out null key from clear(); patch direct filter correction. |
| Blind 10: visibility revalidation | low | Public CTA listens to focus/channel only; patch visible document event using existing load and cleanup. |
| Edge 1: storage clear | low | Same verified null-key filter as Blind 9; group shared root cause, patch once. |
| Verification 1: retained-row assertion | medium | Preverified gap: delayed refresh checks busy/save only; patch known populated row visibility assertion. |
| Root 1: print portal | medium | Portaled preference-menu lives outside hidden triggers; print CSS hides triggers only; patch hide portal content. |
| Root 3: packaged Amharic font | medium | Actual HTTPS language-switch check emits font-src/data violation; built CSS embeds a 3427-character data font. Direct Vite assetsInlineLimit: 0 correction serves assets under existing self policy; patch. |
| Root 2: mobile profile placement | medium | Mobile staff-header column puts profile after preferences/link; viewed screenshot confirms fourth row; patch grid brand/profile first row and containment. |

All survivors are direct corrections within the approved UI behavior; no public surface or speculative state guards. No deferred entries. Each routes to patch; Blind 9/Edge 1 share one defect.

Root packaged follow-up: the stricter new recorder exposed a pre-existing Zod capability probe (`Function('')`, caught internally) in the staff bundle. The actual event source was the deployed StaffApp asset, not menu styles. Local installed Zod documents the supported global `jitless` setting and checks it before probing; browser initialization now sets it before lazy staff loading. Verdict medium, route patch: direct supported configuration, unchanged validation semantics and CSP.

## Design Notes

Retain calm identity. Separate section navigation from commands. Use [Radix menu semantics](https://www.radix-ui.com/primitives/docs/components/dropdown-menu). Theme operational surfaces; retain branding.

## Verification

Run format/types/build/locale/audit gates. Extend existing browser tests for menus, preferences, CTAs, deep links, guarded history and delayed reads. Cover desktop/mobile, EN/AM and themes; mask MFA secrets and check QR/packaged CSP. Batch visual review once, one correction/confirmation maximum; detector once. Rebuild HTTPS and push; report CI pending without waiting, per founder preference.


## Implementation evidence — 2026-10-15 final handoff

Implemented: CSP-compatible early appearance application; validated mode/accent
storage and live Device handling; semantic public/staff/status palettes; shared
Radix 2.1.25 nonmodal menus with localized named popup regions; localized copy;
parent-owned guarded section history and query serialization; abortable department
list/history reads; persistent worklist/status space; stale submission blocking;
bounded public session-only entry checks with focus/session-broadcast revalidation;
navigation/design documentation. Founder-owned `.vscode/` is untouched.

Gates: `npm run build`, `npm run format:check`, `npm run test:localization`
(3,130 catalog values), `git diff --check` passed. Exact Radix install audited
396 packages with zero vulnerabilities. Build retains a >500 kB chunk advisory.
Final build after the bounded semantics/copy correction passed at 11:09 +0300.

| Matrix row | Actual browser evidence |
| --- | --- |
| Appearance | All nine mode/accent combinations pass axe on public desktop/mobile. Preference refresh, invalid and blocked storage, in-memory changes, live Device dark/light, selected check, keyboard movement/Escape/focus return, outside dismissal and computed print palette/screen restoration pass both. |
| Language | Existing bilingual public/login/error/draft/clinical selections pass desktop/mobile. Corrected failed-chunk case passes both and preserves EN + patient draft. Final open EN/AM language and appearance menus pass axe on both devices. |
| Department links/history | Deep link, refresh, current-section no-op, cancelled departure, accepted section history, main-navigation reentry, invalid-section fallback and delayed refreshing table pass desktop/mobile. Exact pending payload/key retries and blocked link/history pass both. |
| Department reads | Retained updating region, stale-save blocking and superseded category separation pass desktop/mobile. Department read401 now passes desktop/mobile clearing of private rows, draft and authenticated profile identity. |
| Profile menu | Header icon/name and single sign-out; no sidebar account group; independent settings hrefs for eight roles; keyboard/EN-AM/axe/mobile containment; native modified links; cancelled drafts; pending disabled actions; MFA/password-gated visibility all pass desktop/mobile. |
| Homepage CTA | Session-only public request scope passes both. Final CTA case passes neutral failed read, anonymous Sign in, complete Dashboard, MFA/password Continue sign-in, focus revalidation and logout broadcast on desktop/mobile. |
| Operational themes | Final Dark/Blue login and Dark/Violet EN/AM registration with preserved draft, departments, inventory and reports pass axe and viewport containment on both devices. |

Bounded browser history: initial existing batch 42/44 passed; its two failed-chunk
failures came from an incorrect helper wait and passed after correction. New
acceptance batch passed section/read/failure-language cases on both devices and
found branded-rail contrast plus test-interaction problems. One correction batch
fixed rail contrast, print specificity, section serialization, dead native-select
styles and test interaction semantics. Its confirmation passed 6/12 and exposed
open-menu semantics and anonymous copy defects. Root triaged a bounded functional
correction: nonmodal primitive root, localized named popup region, and approved
EN/AM anonymous labels; no assertions were weakened and no axe exclusions added.

Final affected command: `npx playwright test --config=playwright.staff.config.ts
tests/localization.spec.ts --grep 'appearance menus|public entry labels|dark operational'`.
Result: **6/6 passed in 1.6 minutes**, covering desktop and mobile. Source was
frozen and built before the run; no separate capture/polish loop was started.

Fresh captures from that final run, all after the 11:09 +0300 build:

- `.impeccable/review/appearance-{Dark,Light,Device}-{Teal,Blue,Violet}-{desktop,mobile}.png`
- `.impeccable/review/menu-{appearance,language}-{desktop,mobile}-{en,am}.png`
- `.impeccable/review/theme-{login,registration,departments,inventory,reports}-{desktop,mobile}.png`

Earlier current-session light EN/AM captures remain in `public-{device}-{language}.png`
and `staff-{device}-{language}.png`. The prior batched visual inspection confirmed
menu containment and corrected header contrast; final tests refresh these captures
and validate all listed axe/layout states. Captures contain fictional fixtures;
no MFA secrets were captured by this change. Root owns formal review, source
detector, packaged CSP/MFA/QR checks, HTTPS rebuild and GitHub delivery. These release
checks remain pending; the browser pass does not establish clinical readiness.

Founder steering during implementation: explicitly requested the conventional header profile/account menu instead of the sidebar account section. Frozen intent/matrix amended only to incorporate this direct instruction. Remaining appearance, department and session-entry work stays approved; no new approval checkpoint. Department auth-loss clearing is now browser-verified on both devices; root owns packaged CSP/MFA checks before handover.


## Header profile navigation follow-up — 2026-10-15

The explicit founder steering is implemented in `src/staff/AccountMenu.tsx` and
the staff header. Shared nonmodal menu composition provides a profile icon/name
trigger, localized named region, true password/MFA anchors and one sign-out item.
The sidebar contains work/management groups only. Settings remain hidden during
MFA, recovery-code acknowledgement and required-password gates. Pending writes
disable settings/sign-out while leaving the trigger inspectable. Existing parent
draft, history, sign-out and exact-retry guards remain authoritative.

Updated shared browser helpers and every old logout/account selector, including
independent role-route expectations, clinical/billing/inventory/outpatient pending
assertions, MFA browser tests and the packaged release verifier. No assertions or
axe rules were weakened. Existing lost sign-out retry remains intact. Documentation
in `DESIGN.md` and `docs/ui-navigation.md` describes the header account pattern.

Before browser checks: build, format, localization (3,130 values) and whitespace
gates passed. Runtime source was frozen throughout the targeted browser batch.

Targeted command: `npx playwright test --config=playwright.staff.config.ts
tests/navigation.spec.ts tests/departments.spec.ts tests/staff.spec.ts
tests/outpatient.spec.ts tests/administration.spec.ts --grep 'home exposes authorized
destinations|profile menu|department unauthorized refresh|pending department writes|
lost registration response|lost check-in and note responses|same staff and password surfaces'`.
Result: 30/32 passed (4.9 minutes). The two profile modified-link tests used a
page-popup event while native Ctrl-click correctly opened context pages. Only that
test event listener was corrected to the existing context-page pattern.

Final bounded command: `npx playwright test --config=playwright.staff.config.ts
tests/navigation.spec.ts --grep 'profile menu owns account links'`.
Result: **2/2 passed (42.6 seconds)**. Together the targeted cases pass all 32
desktop/mobile scenarios: eight independent role navigation/menu expectations,
profile location/keyboard/EN-AM/axe/mobile containment/native links, dirty account
navigation/sign-out cancellation, gated settings, pending disabled sign-out/settings,
registration/visit/department exact-retry guards, same-password-surface no-op, and
department read401 clearing of private rows/draft/profile identity.

The single batched visual inspection used `.impeccable/review/profile-{desktop,mobile}-{en,am}.png`.
It confirmed header-right placement, sidebar account removal, readable menu and
mobile containment. Final two-case run refreshed those same captures with unchanged
runtime source; no additional palette or polish pass was run. No remaining
implementation-test failures are known. Root still owns formal review, packaged
CSP/MFA checks, HTTPS rebuild and GitHub delivery; broader legacy logout/MFA flows
were migrated but were not all rerun in this bounded client pass.

Root matrix audit: all four existing MFA browser journeys passed with Dark/Violet browser preference on desktop/mobile (2.1 minutes), including in-memory QR decoding/enrollment, recovery/expiry and interrupted maintenance. Capture masking/trace-off configuration retained. Root extended the strict HTTPS release verifier to exercise actual signed-in homepage Dashboard entry, custom theme/language menus and CSP violations; packaged execution remains pending.


## Final root verification

All three independent reviews completed before triage; each finding is logged above.
All requested direct corrections are implemented; no findings deferred. The 14
focused desktop/mobile review scenarios pass, including retained populated rows,
read/history/print guards, exact retries/401 clearing, profile same-row placement,
preference semantics and visible-tab session revalidation. Two transient dev-server
bootstrap failures passed unchanged on fresh servers. Root viewed the refreshed
mobile Amharic profile capture once to confirm the first-row placement.

Final client/server type checks, formatting, localization (3134 values), whitespace,
production dependency audit (zero vulnerabilities), Docker build and packaged HTTPS
verification pass. Four real Dark/Violet MFA browser scenarios also pass. Final
packaged verification exercises real sign-in, Dashboard entry, Dark/Blue selection,
Amharic/English changes, profile MFA/sign-out and asserts zero CSP violations. It
also passes the existing persisted synthetic record, authorization, idempotency,
report, inventory, recovery-guard and readiness checks. The strict CSP is unchanged;
fonts are served as origin assets and browser Zod uses supported jitless mode.

Private data, keyring, backups and founder-owned .vscode remain untouched. No cloud
deployment or live-hospital acceptance is claimed. GitHub CI starts on push and is
pending at handoff; founder explicitly requested delivery without waiting.
