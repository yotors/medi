---
name: Hospital workspace
description: Calm outpatient workspace with clear patient lists
colors:
  primary: "#12695d"
  primary-hover: "#0b574c"
  background: "#f4f7f7"
  surface: "#ffffff"
  ink: "#162d32"
  muted: "#52686d"
  pale-teal: "#e6f2ee"
  rail: "#102f32"
  border: "#dce5e4"
  warning: "#875b0d"
  warning-background: "#fff4db"
  error: "#a43636"
  error-background: "#ffeded"
typography:
  heading:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "32px"
    fontWeight: 750
    lineHeight: 1.25
    letterSpacing: "-1px"
  title:
    fontFamily: "Manrope Variable, sans-serif"
    fontSize: "18px"
    fontWeight: 750
    lineHeight: 1.4
  body:
    fontFamily: "DM Sans Variable, sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
rounded:
  input: "7px"
  control: "8px"
  panel: "12px"
  dialog: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "#244d48"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
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
The desktop heading is 32px, becoming 29px on small screens. Section titles are
18px; the dialog title is 25px (23px on mobile). Dates and amounts use tabular
numerals. Long user-entered values wrap rather than widen the page.

## Layout

A 232px fixed desktop navigation rail sits beside a 72px header. The main area
contains the page action, computed summary strip, filters and patient worklist.
A right-hand guidance panel disappears below 1250px. The rail narrows at 900px;
below 650px navigation wraps into two rows and the main area uses 16px side space.
Tables scroll within labelled regions. Patient-name buttons remain accessible
without scrolling to the trailing Open action. The visit drawer is at most 800px
wide and fills the mobile viewport. Registration is a dedicated inline workspace. The separate authenticated `/staff`
route reuses this palette and typography with a full-width header, a 530px sign-in
area and a 1200px directory area. It uses inline registration and bounded
horizontal table scrolling on mobile.

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
- Do preserve the light background, teal accents and clear patient lists.
- Do show pending work and recovery instructions in plain language.
- Don't imply that the local prototype authenticates users or processes real payments.
- Don't use decorative charts, fictional avatars or color-only statuses.
