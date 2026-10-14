# Repository cleanup

Removed the abandoned unauthenticated browser-storage App, seed/storage,
prototype-only Dialog/VisitDetail, redundant storage/browser suites/config and
three obsolete prototype documents. `/` and `/staff` now use one authenticated app.
Server-used domain rules/tests moved to `shared/visit-domain`; they were retained.
The unused Radix dependency and 115 unused global CSS selectors were removed.
The header now uses Medi/Workspace home; ordinary forms no longer carry prototype
labels. Prettier standardizes source without rewriting immutable SQL. README
now describes the product.

Source directories have explicit responsibilities. Compose files intentionally
separate development DB, release rehearsal, isolated recovery and production
boundaries. Migration/backup/recovery/verification modules serve distinct duties.
Historical research/specifications/evidence remain traceable; removed prototype
source is available in Git history.

Ignored agent tools/caches/reports are local development artifacts and never ship
in runtime images. Original archives/keys are intentionally retained. Founder
`.vscode` settings were not removed or overwritten.
