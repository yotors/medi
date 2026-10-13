# Product Studio

This workspace is for a reusable hospital management product, initially serving
small private hospitals and medical centers in Ethiopia. The user explicitly
emphasized a real commercial product on 2026-10-13: completion of an outpatient
slice is not completion of the hospital product. Maintain the full product
roadmap and clearly distinguish implementation from clinical/production readiness.
Local Docker database work is authorized; Supabase is optional, not mandated.
The existing PostgreSQL Docker setup remains in use. Tell the user when an
actual deployment decision needs hosting, budget, a domain or production services;
prepare the concrete plan first and do not require cloud setup for local work.
See docs/product-roadmap.md and docs/deployment.md.
Production deployment, clinical backend design, budget, clinical scope, and capacity
targets remain undecided. The separate `/staff` outpatient workspace uses Fastify and
PostgreSQL with sessions, hospital-scoped access, role-projected visit sections,
transactional registration and durable outpatient commands.
See docs/staff-workspace.md; use fictional data only. The local synthetic outpatient prototype uses
React/TypeScript/Vite with Radix Dialog; see docs/prototype.md. The user
wants a comparison of hosted, hospital-local, and hybrid deployment. Existing
sibling projects are separate products; do not import their secrets or change
their code as part of this project.

The current discovery draft is
`_bmad-output/planning-artifacts/briefs/brief-product-studio-2026-10-12/brief.md`;
its `addendum.md` records deployment options and sources. Public workflow research
and candidate requirements are in
`_bmad-output/planning-artifacts/research/domain-ethiopian-hospital-workflows-and-require-2026-10-12/`.
That research is complete, but its requirements are proposals, not validated
clinical or purchasing requirements. The founder has no hospital contacts; use
the evidence to prepare synthetic walkthroughs before recruiting reviewers. Treat proposals as
unapproved until confirmed. Use synthetic patient data during development.
Resolve Ethiopian data-location and healthcare obligations before selecting
production services or handling live patient data.

## Working process

- Use the installed BMad v6 workflows as the primary delivery process. Start
  with the local `bmad-help` skill when workflow selection is unclear. Do not
  layer another planning framework on top.
- Establish the audience, problem, core user journey, MVP boundaries, and success
  measures before selecting a stack. Record assumptions and unresolved decisions.
- Use Context7 for documentation matching actual dependency versions; fall back
  to official documentation when unavailable. Use OpenAI Docs for OpenAI features.
- For UI work, use the installed Impeccable skill. Present 2–3 visual directions
  for the initial product, establish design tokens, then implement the chosen
  direction. Review real desktop/mobile screenshots and loading, empty, error,
  keyboard, and reduced-motion states.
- The user welcomes UI component libraries. Choose one appropriate to the
  selected framework, check accessibility and maintenance, and customize its
  tokens and composition for the product instead of rebuilding basic controls.
- Deliver small vertical slices with explicit acceptance criteria. Verify
  behavior and failure paths; report commands, results, and remaining limitations.
- Respect existing user changes. Never commit credentials or print environment
  secrets. Use `.env.example` for names and safe placeholders only.

## Verification and release

- `npm run doctor` checks installed tooling. `npm run test:tooling` verifies the
  browser and accessibility harness on a fixture, not the eventual product.
- `npm run audit:ui -- http://127.0.0.1:PORT/path` captures desktop/mobile
  screenshots, accessibility findings, and runtime errors for a running page.
- Use `npm run security:source` and `npm run security:dependencies` for static
  checks; `BASE_URL=... npm run security:web` for an owned test deployment.
- `BASE_URL=... npm run test:load` is only a small load harness smoke check.
  Define workload, dataset, environment, cost budget, and thresholds before
  capacity tests. Never describe unmeasured capacity as verified.
- Assess applicable OWASP ASVS 5.0 Level 2 controls with requirement-to-evidence
  links. Include cross-user authorization, admin permissions, idempotency,
  concurrency, auditability, and backup restoration where applicable.
- Once application code exists, add its lint, type, unit/integration, browser,
  accessibility, and security gates to CI. CI includes prototype and staff application checks plus tooling/security scans.
  GitHub Actions runs in yotors/medi; CI does not establish production readiness.
- Before launch, instrument relevant traces, metrics, and logs with redaction;
  choose an OpenTelemetry backend and validate alerts, rollback, and restore.
- Branch protection, production deployment, and realistic capacity validation
  remain unconfigured. Local logical backup restoration is tested in a disposable
  database; production disaster recovery remains to be designed.

See `README.md` for commands and `docs/readiness.md` for outstanding decisions.
