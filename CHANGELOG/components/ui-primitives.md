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

**PR / canonical main commit**: #559 / `cd46714c`.

**Evidence state**:
- Source: merged to `main` through CI-gated squash PR #559.
- Checks: local TypeScript, 31 final migration-focused tests, 297 broader regression tests, design-system tests, design lint, and post-repair production build passed; required PR Typecheck, Runtime smoke, Build, Tier B, Visual QA, Vercel preflight, ScratchNode, post-deploy, and pipeline-quality checks passed on head `716817ff` (CI `29544548019`, Tier B `29544547997`, Visual QA `29544548037`).
- Visual proof: private desktop reports/menu and 390x844 mobile chat captures at `.qa/evidence/2026-07-16-radix-migration/` show zero horizontal overflow and collision-safe controls.
- Preview: exact-head deployment `nodebench-q3fb7mu8a-hshum2018-gmailcoms-projects.vercel.app` reached Ready and passed Tier B.
- Production live: Vercel deployment `dpl_6cCv7ia2JLipxBm5DSfoWGoJ1SyD` reached Ready for merged SHA `cd46714c` and owns the canonical `www.nodebenchai.com` aliases; its reports route rendered five Radix rail filters, five main filters, six working menu items, zero overflow, and zero console errors.

**Author**: Homen Shum + Codex.
**Touches**: [`../pages/redesign-chat.md`](../pages/redesign-chat.md), [`fast-agent-panel.md`](fast-agent-panel.md).
