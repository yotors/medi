# Development

Use Node 24/Docker and the checked-in lockfile. `db:local` creates private local
credentials only when absent; migrations preserve accounts and records.
The README starts API and Vite separately. Synthetic MFA is explicit/development
only and unavailable to support accounts; production uses independent enrollment.

TypeScript is strict; server domain imports belong in `shared`, never browser
implementation. Prettier standardizes source formatting. Historical SQL is excluded
so reviewed byte hashes never change. Never commit private configs, backups/keys,
patient screenshots or browser traces.

Run focused checks while editing and integrated gates before delivery. Tests cover
real authorization, concurrency/replay, rollback/audit and desktop/mobile workflows.
Repeat broader checks only for new failures or changes. Keep Docker network drills
and capacity measurements separate from browser setup/compilation.

Ignored `.agents`, `.codex`, `_bmad`, `.venv`, caches and reports are workstation
tools, excluded from the runtime. Doctor, browser/accessibility/security runners,
Codex configuration and `dev-codex` are developer tools; production commands are
separate. Preserve founder editor settings and independently held recovery material.

Browser setup on supported Linux: `npx --no-install playwright install --with-deps
chromium`. Security images are pinned in `tooling/images.json`; ignored reports
under `artifacts` must be reviewed before sharing.
