---
name: Hospital workspace
description: Calm outpatient workspace with clear patient lists
colors:
  primary: '#12695d'
  primary-hover: '#0b574c'
  background: '#f4f7f7'
  surface: '#ffffff'
  ink: '#162d32'
  muted: '#52686d'
  pale-teal: '#e6f2ee'
  rail: '#102f32'
  border: '#dce5e4'
  warning: '#875b0d'
  warning-background: '#fff4db'
  error: '#a43636'
  error-background: '#ffeded'
typography:
  heading:
    fontFamily: 'Manrope Variable, sans-serif'
    fontSize: '32px'
    fontWeight: 750
    lineHeight: 1.25
    letterSpacing: '-1px'
  title:
    fontFamily: 'Manrope Variable, sans-serif'
    fontSize: '18px'
    fontWeight: 750
    lineHeight: 1.4
  body:
    fontFamily: 'DM Sans Variable, sans-serif'
    fontSize: '15px'
    lineHeight: 1.5
  ethiopic:
    fontFamily: 'Noto Sans Ethiopic, sans-serif'
    fontSize: '15px'
    lineHeight: 1.5
rounded:
  input: '7px'
  control: '8px'
  panel: '12px'
  dialog: '14px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
  xl: '32px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.surface}'
    rounded: '{rounded.control}'
    padding: '9px 14px'
  button-primary-hover:
    backgroundColor: '{colors.primary-hover}'
  button-default:
    backgroundColor: '{colors.surface}'
    textColor: '#244d48'
    rounded: '{rounded.control}'
    padding: '9px 14px'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.input}'
    padding: '10px 12px'
  panel:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.panel}'
---

# Design System: Hospital workspace

## Overview

**Creative North Star: "Calm workspace"**

The user selected a light background, teal accents and clear patient lists on
2026-10-13. This document refreshes the provisional design from the implemented
CSS; it preserves that direction. The interface supports reception and outpatient
work on shared workstations. Working title only; final branding remains undecided.

**Key Characteristics:**

- Readable patient lists and explicit workflow actions.
- Restrained teal navigation and paper-white surfaces.
- Text-labelled status and computed operational summaries.

The provisional civic-signage concept seed informed spacing and hierarchy. Its
remote challenger catalogue was unavailable. The user's explicit preference takes
precedence. The original seed is retained locally in `artifacts/design-seed.md`.

## Colors

Teal identifies primary actions and underlined patient controls. Ink carries
headings; muted text supports metadata. Amber marks pending work and red marks
errors. Status always includes a text label. The frontmatter carries exact values.

## Typography

Locally bundled Manrope heads sections; DM Sans carries interface and body text.
Routed workspace headings are 30px and section titles are
17px; the dialog title is 25px (23px on mobile). Dates and amounts use tabular
numerals. Long user-entered values wrap rather than widen the page.

## Layout

The routed workspace uses a fixed 250px desktop navigation rail with grouped,
icon-labelled links. Its compact neutral utility header has a 68px minimum height;
the rail begins below the measured header and environment notice and remains
scrollable independently. Identity and breadcrumbs sit above the page heading.
The home dashboard separates a current-work strip, an authorized activity/stock
snapshot, useful destinations and the current outpatient queue. It reads once on
entry; reports retain explicit selected-range controls and exact tables.

At 900px and below, the rail becomes an initially collapsed, labelled disclosure.
The same true links remain available when opened; Escape closes it and returns
focus to its button. Desktop navigation stays fixed. Mobile content uses 16px
side space, stacked dashboard sections and labelled, contained table/chart
scroll regions. Collapsing navigation preserves drafts, and links retain the
existing pending-write and draft guards. Sign-in remains bounded to 530px.
Registration and outpatient visits use inline workspaces, with visit summary,
completion blockers and role-specific section controls above the forms.
Retries and revision conflicts retain explicit recovery messages.

## Elevation & Depth

Borders and pale surfaces separate work areas. Modal overlays dim the underlying
workspace, with a 2px backdrop blur. Dialogs use `0 20px 80px #102f3229` shadow.
Primary button hover changes background over 150ms; reduced motion disables
transitions and animations.

## Shapes

Controls use 8px corners, fields 7px and panels 12px. Desktop drawer corners are
16px on the left; the mobile drawer has square corners. Notes use a uniform
border. Rounded status labels retain visible text.

## Components

Radix Dialog supplies modal semantics, focus containment and Escape dismissal.
Focus returns to the triggering action or the workspace when completion removes
that row. A 3px teal outline with 3px offset identifies keyboard focus. Department
lists open the relevant visit tab. Draft fields remain in session when dismissed;
saving disables editing until persistence completes. Failed saves preserve drafts.

Clear empty/filter states, validation messages and recovery actions explain what
can happen next. The fictional-data banner remains visible; reset requires
confirmation. Operational summaries derive from actual demo state.

## Do's and Don'ts

- Do keep actions labelled and patient names visibly actionable.
- Do preserve Light/Teal defaults and clear patient lists while supporting chosen Dark/Device modes and Blue/Violet accents.
- Do show pending work and recovery instructions in plain language.
- Keep a public showcase at `/` and authenticated workspaces under `/staff`; financial entries record cash/manual transfer outcomes.
- Don't use decorative charts, fictional avatars or color-only statuses.

## Bilingual surfaces

The English and Amharic language control appears on public and staff surfaces.
Noto Sans Ethiopic is bundled locally alongside Manrope and DM Sans; Ethiopic
headings use natural tracking and generous line height. Long labels wrap in mobile
navigation and forms. Language changes preserve inputs and never alter the
hospital calendar. MFA enrollment renders a local scannable QR with its manual
key inside the same private capture region.

The public story uses a fluid 36–62px display heading, 32px workflow heading,
22–23px preview and workflow titles, and 12–14px table/metadata text. These extend
the existing workspace hierarchy for a public reading surface; the palette and
workspace form sizes remain consistent with the approved identity.

## Workspace appearance and navigation

Operational surfaces use semantic canvas, surface, ink, muted, border, accent and
status tokens from `src/appearance/tokens.css`. Light/Teal remains the default;
Dark and Device modes and Blue/Violet accents cover public, authentication and
staff surfaces. Status amber/red keep their meanings independently of accent.
MFA QR remains black on white; print uses a readable light palette. Preferences
change CSS attributes without remounting forms or changing session identity.

Radix Dropdown Menu supplies language and grouped mode/accent menu semantics,
selected indicators, arrow/typeahead navigation, dismissal and focus return.
Department sections are compact links with underlined current location, separated
from consequential commands. Same-section reads retain visibly updating rows;
category changes reserve list space and never present the preceding category.

Account/security actions live in a conventional top-right header profile menu with
a consistent profile icon and the current staff name. Password and authenticator
settings use true links; sign-out is a single explicit menu action. The hospital
workflow sidebar contains only work/management navigation. Gated sessions expose
sign-out alone. Pending writes disable menu actions without disabling the trigger;
the existing dirty-draft confirmations still own navigation and sign-out decisions.
