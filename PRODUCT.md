# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
React/TypeScript/Vite browser client, Fastify/TypeScript API and PostgreSQL.
One authenticated application at `/`, with `/staff` as an alias. Published Docker
images support dedicated hosted or hospital-local installations. Developer agent
skills are local tools and are excluded from the product runtime.

## Users
Small private hospitals and medical centers in Ethiopia. Proposed first users: receptionists, nurses/clinicians, diagnostic staff, pharmacists and cashiers. Actual staff have not validated the workflow.

## Product Purpose
Medi manages registration, longitudinal care, scheduling, inpatient/nursing work,
laboratory, pharmacy, finances and hospital administration for independent
hospitals. Preserve patient identity, unfinished tasks, authorship and chronology.
See docs/product-roadmap.md for implemented coverage and explicit integration limits.

## Operating Context
Published Ethiopian workflow research and a supplied student design inform candidate requirements. Diagnostic return loops, pending departmental work and interruptions matter. Use fictional patient records only during development.

## Capabilities and Constraints
Authenticated staff workspaces persist in PostgreSQL with hospital-scoped
transactions, tenant policies, role permissions, MFA and attributable histories.
Cash/manual transfers are recorded facts; no live payment-provider integration or
automated diagnosis, dose calculation or treatment recommendation is supplied.
English interface; English/Amharic record dates and Gregorian/Ethiopian display
calendars. Date-entry controls remain explicitly Gregorian with Addis time.
Use synthetic records for development. Actual deployment, contractual terms and
hospital clinical/operational acceptance belong to the deploying organization.

## Evidence on Hand
_bmad-output/planning-artifacts/research/domain-ethiopian-hospital-workflows-and-require-2026-10-12/ contains research,24 proposed requirements and the student-design assessment.

## Product Principles
- Keep unfinished handoffs visible.
- Preserve authorship and chronology.
- Distinguish patient, encounter, order and payment.
- Make current capability and exceptional states explicit.

## Accessibility & Inclusion
Keyboard-operable controls, readable contrast, responsive desktop/mobile layouts, reduced-motion support. No patient email account required for registration.
