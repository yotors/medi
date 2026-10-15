# Public and staff navigation

`/` is a public, bilingual product showcase. It requests only session authority for its entry links.
The preview uses fictional patient records and describes existing capabilities;
cash and manual transfers are recorded outcomes, not a live payment integration.

`/staff` is the authenticated role dashboard. A direct link is retained through
session restoration, mandatory MFA, recovery-code acknowledgement and required
password replacement. Unknown and forbidden pages offer a return to the dashboard.

| Route                                        | Who can see it                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/staff`, `/staff/patients`, `/staff/visits` | All staff roles                                                                            |
| `/staff/care`                                | Roles authorized by shared care permissions                                                |
| `/staff/departments`                         | Administrator, clinician, laboratory, pharmacist, cashier, auditor                         |
| `/staff/configuration`                       | All roles; administrators edit, other roles read the service catalog                       |
| `/staff/inventory`                           | Administrator, pharmacist, auditor                                                         |
| `/staff/reports`                             | Administrator, auditor, clinician, nurse, pharmacist, cashier; sections remain role scoped |
| `/staff/hospital`                            | Administrator, auditor                                                                     |
| `/staff/staff`                               | Administrator                                                                              |
| `/staff/mfa`, `/staff/password`              | All roles                                                                                  |

The fixed desktop sidebar groups patient work and hospital operations; account
security remains in the header profile menu. Below 900px, a labelled disclosure
button reveals the same grouped true links. Escape closes it and returns focus
to the button; collapsed links leave the keyboard order. A current-page marker and breadcrumb show location. The server remains
the authorization authority; hiding links never grants access.

The dashboard offers authorized tasks, one current outpatient list request and,
for report-authorized roles, one audited report covering the last seven Addis
calendar days per dashboard entry. It does not poll or infer totals from a
partial page. Current work and stock are labelled snapshots; the generated time
and period are visible. Reports retain explicit range selection and audited reads.

Internal links and browser Back/Forward share draft and pending-write guards.
Cancelling a departure preserves the URL and input state. A pending mutation blocks
departure. Full-page departure retains the existing beforeunload protection.

## Languages and formatting

English and Amharic catalogs are bundled locally with i18next/react-i18next.
Language and appearance preferences are the only application data persisted in browser storage
(`medi.language` and `medi.appearance`). Invalid preferences fall back to English. The registry defines
language, locale and direction metadata, and updates document language/direction.
No translation service receives patient content. Patient names, notes, product
names and catalog content remain as entered. Stored protocol enum values do not
change; explicit label maps provide their translated presentation.

Catalogs use semantic keys and namespaces in `src/i18n/en` and `src/i18n/am`.
Dynamic sentences use interpolation; counts can use i18next plural suffixes.
`resources.ts` exposes generated namespace/key types. To add a language, add the
matching namespace catalogs and a catalog module loader in the language registry.
Catalogs load from local application chunks, once per selected language; English
is loaded for fallback. Switching awaits the selected catalog and keeps the current
interface and drafts if the download fails. Components do
not branch on language. Run `npm run test:localization` to verify namespaces,
keys, interpolation tokens, and untranslated English placeholders. Browser tests
cover preference fallback, login/errors, accessibility and draft preservation.
Fluent Amharic clinical terminology review remains a separate acceptance activity.

Shared UI number/currency/date formatters use registry locales. UI date formatting
defaults to Africa/Addis_Ababa. Record dates continue to use the hospital's configured
locale/calendar independently; date input values remain Gregorian.

MFA QR generation is entirely local. The otpauth label uniquely identifies the
hospital code and staff user ID; issuer is the hospital name. SHA1, six digits,
30 seconds and a four-module quiet zone match the existing authenticator protocol.
QR and manual key share one private capture wrapper and the existing in-memory
secret lifetime, expiry and account/session cleanup. Manual entry and recovery
remain available. The browser MFA suite decodes the rendered QR in memory before
confirming enrollment. Secrets are never written to QR image files or logs.

Localization checks validate semantic key parity and interpolation. Plural messages require the categories returned by `Intl.PluralRules(locale)` rather than English suffix parity: French may require `many`, Arabic requires six categories, and Japanese uses `other`. Latin-script languages can legitimately share English cognates; unchanged English prose is rejected for other writing scripts. These are residue signals, not proof of translation quality. Each added language requires fluent semantic review of terminology, interpolation, plural meaning and context.

The static rendered-literal gate currently covers the public homepage and the reviewed StaffApp, HospitalConfiguration, ClinicalCorrections, InventoryHistory, VisitPanel, StaffAdministration and DepartmentPicker components. It checks JSX text, rendered conditional/logical string branches and visible accessibility attributes. Exact exclusions document the Medi brand, technical identifiers and fictional preview names in the checker. Protocol props, translated call arguments and entered record content are outside the literal gate. Dynamic runtime strings, composed content and other components still require browser and semantic review; this is deliberately not a complete runtime-coverage claim. Checker regressions: `node --test tooling/check-localization.test.mjs`.

## Appearance and section navigation

Language and appearance use shared Radix dropdown menus: arrow keys and typeahead
move between choices, selected choices carry a check, and Escape/outside dismissal
returns focus to the trigger. Menus use viewport collision handling on mobile.
Appearance groups Light, Dark and Device modes separately from Teal, Blue and
Violet accents. Default is Light/Teal. Validated `medi.appearance` preferences
contain only mode/accent; blocked or malformed storage safely uses defaults.
An external same-origin script applies the theme before React starts without an
inline-script CSP exception. Device mode follows live OS changes without remounting
workspaces. Status colors remain semantic; printed records and MFA QR remain readable.

Department links use `/staff/departments?section=…` with role-authorized sections.
Invalid sections normalize to the role default. Parent routing owns history indices
for both section and workspace links. Current-section clicks are a no-op; dirty
and pending guards cover Back/Forward as well as ordinary clicks. Refresh keeps
current-section rows with an updating indicator; switching sections clears the old
rows and reserves the worklist area. Superseded reads abort. Failed reads explicitly
mark retained rows stale and prevent submission until a successful refresh.

All public entry links share a bounded `/api/auth/session` check. Unknown or failed
reads say Open workspace, anonymous sessions say Sign in, complete sessions say
Dashboard, and password/MFA gates say Continue sign-in. Focus and session broadcasts
revalidate this label; no identity is stored and no clinical/report APIs are polled.

## Header account menu

Authenticated staff use the top-right profile icon menu for Change password,
Authenticator security and Sign out. The workflow sidebar contains patient work
and hospital operations only. Account items remain true links with guarded ordinary
navigation and native modified-click/new-tab behavior. Pending writes disable
settings and sign-out while keeping the profile trigger available for inspection;
cancelled draft departures preserve the current URL and inputs. MFA, recovery-code
acknowledgement and required-password gates expose sign-out alone until completed.
The menu uses the shared nonmodal primitive, named popup region, keyboard focus
handling and mobile collision bounds. No profile photo or editing backend is added.


## Compact controls and fixed navigation

Profile, Appearance and Language use compact icons with localized accessible names
and hover/focus labels. The profile menu contains the staff identity and existing
account actions. The desktop sidebar remains fixed and scrolls internally; header
height is measured and its width is reserved in both content and footer. Narrow
screens use in-flow navigation so it cannot cover workspace text.

Care workflows, hospital management and the configuration catalog use section
links with `?section=...`, matching department operations. Ordinary navigation and
Back/Forward retain draft/pending guards; modified clicks open actual section URLs.
Visit record sections use keyboard-operated tabs rather than workflow links.
