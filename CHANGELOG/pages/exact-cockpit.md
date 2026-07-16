# Exact Cockpit

Append-only lane for the deployed five-surface web cockpit: `Home`, `Reports`,
`Chat`, `Inbox`, and `Me`. Workspace remains a separate deployed surface.
Newest entries first.

## 2026-07-15 — Replace cockpit fixtures with runtime truth

The pending candidate removes named report, inbox, identity, plan, usage, vanity-metric, mobile-answer, and developer-terminal fixtures from reachable product paths. Authenticated Home users start the real background workflow; guests receive a sign-in gate that preserves the typed or scenario query through the return URL. Reports renders stored owner-scoped reports and pipeline activity, Chat uses one runtime-backed implementation across desktop and mobile, Inbox mutates live owned nudges with visible failure handling, and Me labels missing account data honestly; loading, empty, and not-found states no longer fall through to sample companies or canned results. Desktop and mobile Inbox and Me now reuse the same runtime-backed component trees, deleting the duplicate unreachable queue/profile renders and their hard-coded plan, usage, connector, local-draft, and toast-only controls. The cockpit Chat header now contains only a truthful title and its real search action instead of unwired thread/share/model controls, connection copy and color agree across offline/loading/degraded/authenticated/guest states, and Command Palette search/document actions target the canonical composer and document event. Approval responses and cancellations expose backend failures beside the affected request and preserve typed text for retry instead of failing silently.

**PR / canonical main commit**: `PENDING #NNN MAIN SHA / FINAL QA`.

**Evidence state**:
- Source: pending; this worktree candidate is not merged to `main`.
- Checks: not recorded for a canonical `main` SHA.
- Visual proof: not recorded in source; local-only candidate artifacts are not release evidence.
- Preview: not recorded.
- Production live: not recorded.

**Author**: Homen Shum + Codex.
**Touches**: [`agents.md`](agents.md), [`../components/fast-agent-panel.md`](../components/fast-agent-panel.md), and [`../integrations/pipeline-runtime.md`](../integrations/pipeline-runtime.md).
