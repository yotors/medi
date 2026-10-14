---
title: Finish and verify hospital governance
status: in-progress
baseline_commit: deaad870638655e5b8a313ce3319e27e072777f9
context:
 - AGENTS.md
 - PRODUCT.md
 - DESIGN.md
 - _bmad-output/implementation-artifacts/spec-product-completion.md
 - shared/hospital.ts
 - server/hospital.ts
 - src/staff/HospitalWorkspace.tsx
 - server/auth.ts
 - server/migrations/018_hospital_governance.sql
---

Finish the implemented draft hospital governance as working, tested workflows.
Own shared/hospital.ts, server/hospital.ts, HospitalWorkspace.tsx, hospital tests,
and any dedicated formatting helper. Root owns StaffApp integration, manifest,
grants, installer and whole-tree formatting/CI. No nested agents/commits/pushes.

1. Governed organization export must include all relevant clinical, departmental,
   financial, stock, configuration and identity-link histories. Export only explicit
   approved tables/fields; never credentials, factors, sessions, grants or login
   buckets. Composite-key tables need valid stable pagination (current ORDER BY id
   fails care_identity_links). Paginate/bound output and audit exports atomically.
   Don't promise a multi-request live export is a point-in-time recovery snapshot.
2. Approved patient record exports include original identity and linked aliases,
   encounters, clinical amendments/review history, care/nursing/medication history,
   relevant laboratory/financial/stock history, without unrelated records. Keep
   bounded chunks/pagination for large histories; no silently truncated result.
   Fulfilled requests remain repeatable for authorized download; approving/denying
   requires pending expected revision and verified authority/purpose.
3. Finish settings/facility/holds/support forms with meaningful labels and records,
   clear reasons, stale/uncertain save recovery, pending/draft departure protection,
   role-appropriate rendering, input bounds and no raw UUID entry as normal flow.
   Settings locale/calendar must visibly affect formatted records; dates entered
   in Gregorian Addis time must never silently change chronology. Add a safe
   appearance endpoint accessible to authenticated staff returning only display
   settings, with current-actor check. Root integrates appearance provider if needed.
   New format helper must actually be used, not another unused file.
4. Named auditor support grants are approved by hospital admin for <=4h, require
   normal MFA and end every existing session upon grant/revoke. Check expiry and
   revocation in readSession/currentActor (already drafted). Test denied/expired
   and post-lock revoked authority; no shared vendor bypass. Existing account
   reset policy preserves support restrictions; never grant a support account
   clinical-write/admin permissions via staff update.
5. Write server/hospital.test.ts against isolated local schemas using real sessions:
   end-to-end settings/facility/privacy request/hold/export/support normal cases,
   roles/foreign tenant, stale/hash-changed retry, audit rollback, expired/revoked
   support and post-lock race. Test actual restricted-role RLS with unset/own/foreign
   tenant context and cleanup only owned fixture roles/schema. RLS may exclude auth
   bootstrap; never make ordinary application role a schema/table owner or BYPASSRLS.
6. Add representative tests/hospital.spec.ts to validate actual forms, downloaded
   scoped data, keyboard/axe and desktop/mobile captures. Root runs combined browser
   checks once after Docker builds. Run focused API/type checks once, rerun only
   affected failures. No change to frozen016/017; SQL018 was pinned before tested,
   so coordinate necessary SQL changes/hashes with root rather than editing silently.

Send concise handoff with defects fixed, test evidence and integration instructions.
User explicitly asks complete production app and token efficiency. No broad repeat
reviews, fake customer approval, external contact or stopping at API-only code.
