# Vercel AI Elements integration

Append-only lane for the vendored primitive layer, shared adapters, design
governance, and integration-wide contracts. Newest entries first.

## 2026-07-14 — Add the identity-preserving Convex parts adapter

Added `convexToUIParts` as the shared parser for UIMessage parts. It retains
source part identity, separates generic parts from domain passthrough, and does
not take ownership of persistent text streams.

**PR / canonical main commit**: #521 / `30688119`.
**Evidence state**: source merged; adapter test evidence belongs to the exact tested revision.
**Touches**: [`../components/fast-agent-panel.md`](../components/fast-agent-panel.md).

## 2026-07-14 — Prevent code-token cache collisions

Changed the code-block token cache key to include the complete source so equal-
length snippets with the same prefix and suffix cannot display each other's
cached middle content.

**PR / canonical main commit**: #517 / `988a3f56`.
**Evidence state**: source merged; later evidence states not recorded here.
**Touches**: [`../components/fast-agent-panel.md`](../components/fast-agent-panel.md).

## 2026-07-14 — Establish the AI Elements primitive and governance layer

Vendored the themed AI Elements and isolated shadcn base primitives, added the
thin consumer layer, migrated six leaves, and created the design manifest,
56-file migration matrix, and visual-proof protocol.

**PR / canonical main commit**: #516 / `c83a41c8`.
**Evidence state**: source merged; no dated visual-proof folder is claimed by this entry.
**Touches**: [`../components/fast-agent-panel.md`](../components/fast-agent-panel.md), [`../build/vite.md`](../build/vite.md).
