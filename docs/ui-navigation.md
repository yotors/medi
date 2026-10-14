# Public and staff navigation

`/` is a public, bilingual product showcase. It makes no protected API requests.
The preview uses fictional patient records and describes existing capabilities;
cash and manual transfers are recorded outcomes, not a live payment integration.

`/staff` is the authenticated role dashboard. A direct link is retained through
session restoration, mandatory MFA, recovery-code acknowledgement and required
password replacement. Unknown and forbidden pages offer a return to the dashboard.

| Route | Who can see it |
| --- | --- |
| `/staff`, `/staff/patients`, `/staff/visits` | All staff roles |
| `/staff/care` | Roles authorized by shared care permissions |
| `/staff/departments` | Administrator, clinician, laboratory, pharmacist, cashier, auditor |
| `/staff/configuration` | All roles; administrators edit, other roles read the service catalog |
| `/staff/inventory` | Administrator, pharmacist, auditor |
| `/staff/reports` | Administrator, auditor, clinician, nurse, pharmacist, cashier; sections remain role scoped |
| `/staff/hospital` | Administrator, auditor |
| `/staff/staff` | Administrator |
| `/staff/mfa`, `/staff/password` | All roles |

The desktop sidebar groups patient work, hospital operations and personal account
security. On smaller screens the same true links become grouped, wrapping mobile
navigation. A current-page marker and breadcrumb show location. The server remains
the authorization authority; hiding links never grants access.

The dashboard offers authorized tasks and one current outpatient list request.
It does not poll reports or infer totals from a partial page. Period reports remain
explicitly requested and audited in their own workspace.

Internal links and browser Back/Forward share draft and pending-write guards.
Cancelling a departure preserves the URL and input state. A pending mutation blocks
departure. Full-page departure retains the existing beforeunload protection.

## Languages and formatting

English and Amharic catalogs are bundled locally with i18next/react-i18next.
Language preference is the only application data persisted in browser storage
(`medi.language`). Invalid preferences fall back to English. The registry defines
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
