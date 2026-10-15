---
title: Compact workspace controls and consistent section navigation
type: bugfix
created: 2026-10-15
status: done
route: dispatch
review_loop_iteration: 0
baseline_commit: bc7c901010c8ef19097228eb4968ed1372bda579
context: [AGENTS.md, PRODUCT.md, DESIGN.md]
---

<frozen-after-approval reason="founder-directed correction to approved workspace UX">

## Intent

**Problem:** The sidebar covers text, the profile and preference triggers consume too much header space, and several workspaces still use action-looking buttons to switch sections.

**Approach:** Keep the sidebar fixed while scrolling, as the founder explicitly requested, but reserve its actual space and prevent overlap at every viewport/header height. Use compact icon-only profile, appearance and language triggers with accessible names and hover/focus labels. Apply the department navigation convention consistently to other workspace sections.

## Boundaries & Constraints

**Always:** Preserve calm existing themes, English/Amharic, expandable language architecture, role/tenant permissions, current authentication gates, pending-operation locks, draft confirmations, exact retries and native modified-link gestures. Fixed desktop sidebar has an internal scroll region when necessary; mobile navigation is usable without obscuring page content. Profile name is available inside its menu; trigger is a normal compact icon target (40–44px), with no long visible username/chevron. Preference icons remain separately discoverable with localized accessible names and hover/focus hints. Existing menu contents and keyboard behavior remain. The founder authorized implementation and continuing delivery in the existing UX pass; this spec records their explicit correction, not a new product decision.

**Never:** Change backend or credentials, discard founder-owned .vscode, remove sidebar persistence, add cloud deployment, weaken CSP, hide important actions exclusively behind hover, or change actual save/submit/retry buttons into links. No unrelated visual redesign.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Fixed shell | Desktop, tall header, long Amharic labels, scrolling | Sidebar stays available, scrolls internally if needed; its bounds never intersect content or footer text | Long content wraps within its column |
| Compact controls | Anonymous/authenticated, keyboard/touch | Compact named icons; hover/focus label, existing menu opens and Escape returns focus; staff name inside profile menu | No functionality depends on hovering |
| Section navigation | Care, hospital management, configuration catalog | Styled current-section links with real URLs; reload/new tab and Back/Forward select correct permitted section | Invalid/unauthorized section uses safe allowed default |
| Protected navigation | Dirty draft or pending command | Same protections as existing department navigation; cancel keeps original URL and values; pending remains locked | No duplicate writes or stale-response identity leak |
| Visit detail | Role-projected record sections | Accessible tabs for local record views, clear active state; actions remain buttons | Existing clinical pending guards remain |
| Mobile | 390px and narrow desktop breakpoint | Header controls stay compact, navigation and page text never overlap or overflow | All destinations remain reachable |

</frozen-after-approval>

## Code Map

- `src/staff/StaffApp.tsx`: shell header/main/nav and guarded route/history owner; department section URL is precedent. Navigation currently nested inside main; keep semantic main and skip link functional.
- `src/staff/staff.css:456`: absolute sidebar top140 and main margin250 cause overlap under variable headers; replace brittle positioning with measured/reserved fixed layout. Sidebar must remain fixed on desktop.
- `src/components/PreferenceMenu.tsx`, `src/appearance/tokens.css`: shared Radix triggers currently render label plus chevron; add compact variant without losing accessible names or portal print hiding.
- `src/staff/AccountMenu.tsx`: name currently trigger label; move visible identity into menu; icon-only trigger. `src/i18n/index.tsx`, `src/appearance/AppearanceControl.tsx`: same compact triggers public/staff.
- `src/staff/CareWorkspace.tsx:933`: care section buttons with depart/reset guards. `src/staff/HospitalWorkspace.tsx:216`: hospital section buttons and switchTab dirty/pending logic. `src/staff/HospitalConfiguration.tsx:668`: catalog section buttons. Reuse `src/staff/navigation.ts` plain-link detection and existing guarded parent history rather than competing unguarded listeners.
- `src/staff/VisitPanel.tsx:304`: local record-section buttons; implement actual tab semantics rather than pretending these are independent workflow routes.
- `tests/navigation.spec.ts`, `tests/localization.spec.ts`, `tests/configuration.spec.ts`, `tests/care.spec.ts`, `tests/hospital.spec.ts`: inspect actual filenames and existing synthetic fixtures; migrate affected selector semantics as needed. Preserve secret masking.

## Tasks & Acceptance

- [x] Shell TSX/CSS: fixed sidebar with reserved width, correct header offset, internal scrolling, content/footer containment and responsive fallback.
- [x] Shared menu/profile/preferences: compact icon targets, tooltip/title on hover/focus, accessible names and visible profile identity inside menu.
- [x] Care/hospital/catalog: actual section links, deep URLs, guarded history and native new-tab behavior with consistent active styling; retain department behavior.
- [x] Visit detail: accessible section tabs and consistent understated navigation styling.
- [x] Relevant browser tests: cover all matrix rows; update changed selectors. Capture desktop/mobile EN/AM once, fix defects in one batch then at most one confirmation. Preserve fixtures and existing release checks.

Acceptance: Given a signed-in user, when scrolling a desktop page or using a long translated header, then the sidebar remains fixed without covering content. Given any compact control, when focused or activated, then its purpose and menu remain accessible. Given a section link, when opened directly or navigated through history, then selection and guarded drafts match its URL. Given visit-detail tabs, when using arrows/keyboard, then selected tab and associated panel stay synchronized.

## Implementation Notes

Small reversible UI changes only; no intent gaps or irreversible data operations. Founder specifically corrected the earlier proposed nonfixed sidebar: retain fixed scrolling behavior. Preserve existing local HTTPS fixtures/keyring/archives. Root owns final packaged rebuild and previously authorized push; CI pending at handoff, do not wait.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
| --- | --- | --- |
| Blind 1: history section memory | medium | Accepted popstate sets workspaceSection but not rememberedSections; leaving/reentering restores stale B instead of displayed A. Direct patch update accepted history memory. |
| Blind 2: stale section heading focus | false | Verified all three h1 values: Patient care, Hospital management and Hospital configuration/Service catalog depend on workspace/role, not selected section. No previous section heading can be focused at this location. Reject. |
| Blind 3: initial hardcoded section | medium | Care starts profile, hospital Facilities and catalog services before URL-sync passive effect; config read effect can request default list. Direct patch validated lazy initial state from section. |
| Blind 4: differing draft guards unverified | medium | New guard paths for care/config are distinct children; hospital is only dirty-history case. Direct patch care/config draft and unresolved-command checks. |
| Blind 5: native care/catalog links unverified | low | Their handlers have own reset bodies; only hospital native-click checks exist. Direct patch combine native-open and original draft assertions in focused child navigation coverage. |
| Blind 6: restricted care default unverified | medium | care normalization uses allowed kinds but new test uses admin only. Direct patch restricted role unauthorized URL normalization check. |
| Blind 7: obsolete zero-sections assertion | medium | Outpatient no-sections branch still queries navigation, while new component has tablist; assertion is vacuous. Direct patch updated role query. |
| Blind 8: tab-key edge verification | low | ArrowLeft/End/wrapping and disabled key paths are real new branches; current journey exercises Right/Home only. Direct patch bounded additions to existing journey/guard test. |
| Edge 1: MFA replace loses section | medium | goTo replace serializes remembered destination but updates state only for push; child can normalize stale section to default. Direct patch synchronize non-pop transitions, preserve accepted URL on pop. |
| Verification 1: dirty care section guard | medium | Preverified gap: no dirty care click/history test protects changed local reset. Group with Blind 4 care coverage; patch. |

All surviving findings are direct corrections/tests of demonstrated paths, with no new public surface or speculative state. Patch routes only; no deferred work. Blind 4 and Verification 1 share the missing care guard verification; history memory and MFA replace remain separate defects even if fixed in the same function.

## Verification

Run client/server types, format, localization and production build. Run bounded affected desktop/mobile browser scenarios including geometry under scroll, menu accessibility and dirty/pending/history paths. One screenshot batch and at most one correction/confirmation, no repeated theme matrix or full browser suite. Rebuild existing HTTPS deployment and run packaged verifier once final source is stable. Use independent workflow review before commit, preserve private logs, never print credentials.


Implementation verification: client/server types, formatting and 3134 catalog values pass. Focused fixed-sidebar/profile/hospital-history six-case batch passes desktop/mobile; final six-case confirmation passes after sole mobile icon-row/tooltip correction. Care/catalog deep/default/history and actual visit keyboard journey pass desktop. Source frozen for review. Original data/keyring/archives retained; root owns HTTPS rebuild.


## Final verification and delivery

All three independent reviews returned before triage. Each finding is logged; the
one disproven heading claim was rejected, all remaining direct corrections and
verification gaps are fixed, and nothing is deferred. Root read the source diff and
confirmed the sole mobile correction in desktop/mobile Amharic captures.

Final review regressions pass: history memory and intercepted synthetic MFA return,
care/catalog draft cancellation and native links, unresolved command/history locks,
restricted pharmacist default, and visit keyboard edges/disabled tabs. The multi-role
handoff test exceeded its first40-second limit; it passed unchanged in isolation
with a90-second bound (27.6 seconds test). Earlier six-case desktop/mobile geometry,
profile accessibility and section-history confirmation passed. No new screenshot
or palette loop followed review fixes.

Client/server types, formatting, localization (3134 catalog values), whitespace and
production build passed. The final Docker HTTPS build and release verifier passed,
including existing data/readiness/recovery guards, auth/CSRF/permissions, persisted
synthetic workflow/retry checks, reports/inventory, actual profile sign-out/MFA,
custom preferences and zero recorded CSP violations. The corrected app is served
at https://localhost:8443/staff. Existing private fixtures, credentials, keyring,
archives and founder-owned .vscode are preserved. GitHub CI starts on push and is
pending at handoff; no passing CI result or live-hospital approval is assumed.
