---
title: Medi PRD — implementation context and options
status: draft
created: 2026-10-13
updated: 2026-10-13
---

# Implementation context

The repository is `/home/habtetsega/Desktop/mpx/product-studio`; the GitHub repository is [yotors/medi](https://github.com/yotors/medi). “Medi” is the repository/product working name; commercial naming remains open. The repository folder name does not make the hospital product a generic setup tool.

The current web application uses React, TypeScript, Vite and Radix-based UI components with a Fastify server and PostgreSQL. The original browser-only demonstration at `/` is separate from the authenticated `/staff` application. No data migration between them is implied. Current server-side sessions, hospital scope, write transactions, audit and role-projected responses are reusable development foundations; their presence does not complete identity administration, clinical validation, financial operation, or production hardening.

A dedicated local PostgreSQL 16 Docker service is already provisioned. The container and application health were checked on 2026-10-13. The founder does not need to create a hosted database to continue development. Credentials stay in ignored local files. Supabase Docker was offered as an option, not required; adopting Supabase would need an explicit migration design for existing schema, session ownership, policies, and migration guards. This PRD does not request that switch or a second database.

See [deployment.md](../../../../docs/deployment.md) for the current environment, deployment comparisons and the events that trigger founder decisions. See [product-roadmap.md](../../../../docs/product-roadmap.md) for the delivery sequence. Database providers, authentication vendors, hosting regions, infrastructure sizes, and paid subscriptions are not selected by this PRD.

# Deployment alternatives retained for decision

| Option | Operational implications to validate |
| --- | --- |
| Hosted web service | Shared product operations and centralized upgrades; facility connectivity and acceptable data/support/backup locations must be established. Hosting can still use dedicated resources where justified. |
| Hospital-local server | Browser access over the hospital network can continue without public internet if local dependencies, power and network remain available; requires on-site ownership, backups, remote support boundaries and repeatable updates. |
| Hybrid with synchronization | Adds conflict resolution, identity, replicated data governance, outage reconciliation and upgrade coordination. No offline synchronization is implemented; require demonstrated need before accepting this complexity. |

A subscription business model does not determine the physical deployment. A backup is not a second active system or a guarantee of live failover. Current prototype Docker composition is a development environment, not an installation package for customer operations.

# Downstream design work

Architecture must retain organization ownership across records, jobs, files, exports and telemetry; specify staff/support privilege changes and migrations; and expose the cost and recovery implications of the selected operating model. UX must extend the confirmed light/teal style with dense but readable clinical and financial workflows, identity cues, state changes, and keyboard/accessibility behavior. Clinical templates, emergency exceptions, amendments, critical-result escalation, pharmacy quantities and fiscal documents require qualified review before implementation is treated as production-ready.

The whole-product PRD intentionally separates these decisions from the source's student schema and from the existing synthetic code. None is approved solely because a demonstration can execute a similar screen sequence.
