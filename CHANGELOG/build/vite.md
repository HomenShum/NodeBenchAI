# Vite and PWA bundling

Append-only lane for Vite/Rolldown chunking and service-worker precache rules.
Newest entries first.

## 2026-07-14 — Preserve Shiki's lazy grammar splitting

Removed `@shikijs/*` from the shared editor manual chunk, routed emitted
grammar/theme chunks under `assets/shiki/`, and excluded that directory from
PWA precache. The rule preserves lazy language loading and avoids collapsing
the grammar set into an oversized eager/precache asset.

**PR / canonical main commit**: #516 / `c83a41c8`.
**Evidence state**: source merged. Build and chunk-size claims must be measured on the exact candidate revision.
**Touches**: [`../integrations/ai-elements.md`](../integrations/ai-elements.md), [`../components/fast-agent-panel.md`](../components/fast-agent-panel.md).
