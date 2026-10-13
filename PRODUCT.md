# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
Implementation delegated by the user's instruction to start building. Prototype choice: React, TypeScript and Vite; Radix primitives for accessible dialogs. A separate staff outpatient workspace uses Fastify/TypeScript and PostgreSQL, with server-enforced hospital boundaries, staff sessions and transactional visits. Production hosting and clinically validated workflows remain undecided. This choice is reversible and is not a production architecture approval.

## Users
Small private hospitals and medical centers in Ethiopia. Proposed first users: receptionists, nurses/clinicians, diagnostic staff, pharmacists and cashiers. Actual staff have not validated the workflow.

## Product Purpose
Build a commercial hospital management product for independent hospitals, with
shared product code and controlled hospital configuration. The first implemented
milestone coordinates an outpatient visit across registration, clinical work,
diagnostics and payment. Hospital administration, complete departmental
operations and production delivery remain part of the wider product work;
see docs/product-roadmap.md. Do not equate this initial slice with the completed
product.

## Operating Context
Published Ethiopian workflow research and a supplied student design inform candidate requirements. Diagnostic return loops, pending departmental work and interruptions matter. Use fictional patient records only during development.

## Capabilities and Constraints
The `/` route is a browser-persisted demonstration of the outpatient journey. The separate `/staff` route provides authenticated, hospital-scoped registration, visit check-in, consultation, investigations, prescriptions, demonstration settlement and closed history in PostgreSQL. No live patient data, authenticated clinical use, real payment processing or production deployment. Its role and hospital-boundary checks do not establish production-wide tenant security. No diagnostic recommendations. Product name, hosting, local languages and commercial terms remain open.

## Evidence on Hand
_bmad-output/planning-artifacts/research/domain-ethiopian-hospital-workflows-and-require-2026-10-12/ contains research,24 proposed requirements and the student-design assessment.

## Product Principles
- Keep unfinished handoffs visible.
- Preserve authorship and chronology.
- Distinguish patient, encounter, order and payment.
- Make demo limitations explicit.

## Accessibility & Inclusion
Keyboard-operable controls, readable contrast, responsive desktop/mobile layouts, reduced-motion support. No patient email account required for registration.
