# UI primitives

Append-only lane for the shared shadcn/Radix interaction layer and migrations
away from handwritten generic control infrastructure. Newest entries first.

## 2026-07-16 — Standardize generic interactions on shadcn/Radix

Dialogs, sheets, popovers, hover cards, menus, command palettes, tabs, toggle
groups, switches, checkboxes, accordions, and toast delivery now compose shared
shadcn/Radix wrappers across the primary chat, reports, documents, research,
entity, strategy, onboarding, settings, and calendar surfaces. Retired focus-trap,
bottom-sheet, keyboard-navigation, portal-positioning, and duplicate toast
infrastructure was removed; native browser form controls, route navigation,
editor decorations, and product-specific virtualized menus remain intentionally
outside the generic primitive layer.
The production-data browser pass also repaired a missing report-menu import and
made both report rails key repeated display names by their runtime artifact ID.

**PR / canonical main commit**: PENDING #559 MAIN SHA / FINAL QA.

**Evidence state**:
- Source: pending CI-gated merge.
- Checks: local TypeScript, 31 final migration-focused tests, 297 broader regression tests, design-system tests, design lint, and the post-repair production build passed; exact PR checks pending.
- Visual proof: local desktop reports/menu and mobile chat captures at `.qa/evidence/2026-07-16-radix-migration/` show zero horizontal overflow and collision-safe controls; exact preview proof pending.
- Preview: pending exact-head Vercel preview.
- Production live: pending merge, deployment, and exact-revision verification.

**Author**: Homen Shum + Codex.
**Touches**: [`../pages/redesign-chat.md`](../pages/redesign-chat.md), [`fast-agent-panel.md`](fast-agent-panel.md).
