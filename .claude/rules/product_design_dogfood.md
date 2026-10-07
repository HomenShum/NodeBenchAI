---
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/**/*.css"
  - "evals/e2e/**/*.ts"
  - "scripts/ui/**/*.mjs"
related_: [analyst_diagnostic, dogfood_verification, reexamine_design_reduction, completion_traceability]
---

# Product Design Dogfood (Jony Ive Review)

Ship quality is proven in the running UI, not in a diff.

This rule is the bridge between:
- **Design reduction** (earned complexity, kill jargon), and
- **Dogfooding** (actually using every surface end-to-end).

## Definition of done (UI-visible)

When you claim a UI change is “done”, it must be verifiable **inside the app UI**:
1. **Dogfood route exists**: `/dogfood` loads.
2. **Evidence is viewable**: `/dogfood` shows a gallery or clear “missing artifacts” instructions.
3. **Screenshots are current**: after dogfooding, publish the screenshot manifest so the UI can render it (`npm run dogfood:publish` or `npm run dogfood:full:local`).

## Dogfood protocol (route-by-route)

For every route/screen touched (and adjacent screens with shared layout):
- **First-impression clarity**: can a new user explain what to do in 5 seconds?
- **Hierarchy**: one primary action; secondary actions are visually quiet.
- **Typography**: headings are not shouting; body text is readable; no gray-on-black mush.
- **Spacing**: consistent rhythm; avoid random padding/margins; align baselines.
- **States**: empty/loading/error states look intentional (not a blank white card).
- **Interactions**: focus rings, keyboard navigation, hover/press states, scroll containment.

## Mandatory mindset

Follow `analyst_diagnostic`:
- Diagnose the **root cause** (render path, data ownership, stored vs computed).
- Fix the cause so the bug becomes **impossible**, not merely hidden.
