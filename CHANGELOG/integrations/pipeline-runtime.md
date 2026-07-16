# Pipeline Runtime

Append-only lane for pipeline launch, activity, streaming, evaluation, schedule,
and secret-gated MCP bridge ownership contracts. Newest entries first.

## 2026-07-15 — Derive pipeline ownership on the server

The pending candidate removes browser-selected `ownerKey` authority from public pipeline launch, history, detail, bundle, stream, scorecard, and schedule APIs. Cost-bearing single and composed launches and all schedule controls now require an authenticated server identity. Guest history, detail, bundle, stream, and evaluation reads require an anonymous-session possession credential; schedule changes verify row ownership, public responses omit owner keys, and cron or secret-gated MCP work uses explicit internal service contracts. Legacy anonymous schedules do not execute.

Durable per-owner admission allows four launch units per ten minutes and thirty per day; composed runs consume two units and scheduled launches consume quota. Specs, titles, and model IDs are bounded to 4,000, 120, and 160 characters, and each owner may keep at most twenty schedules. The scorecard reports recorded `verifiedShare` instead of fabricated verdict accuracy or Brier calibration, costs are labeled as estimates, streamed-output controls appear only for an active or recorded stream, and schedule copy distinguishes hourly polling, next-run time, and a run that actually started.

Force-fresh launches now mint a unique logical attempt before the durable workflow starts. Workflow retries retain that attempt and an execution-generation fence, while each recurring schedule occurrence derives its attempt from the schedule id plus the exact due `nextRunAt`. Overlapping sweeps dedupe the same occurrence and compare-and-set advancement prevents cadence skips. A terminal retry clears stale completion, error, token, output, step, stream, and generated-document state before incrementing its generation; stale generations and overlapping workflows cannot mutate the active row.

Research bundles and Workspace documents now distinguish `sourcesConsulted` from `citationsUsed`. Only in-range `[N]` markers that actually appear in the synthesis bind a citation. Zero-source, unbound-source, non-canonical, or out-of-range citation states deterministically prevent a `verified` verdict and land on `needs_review`, regardless of a model's requested tier.

**PR / canonical main commit**: `PENDING #NNN MAIN SHA / FINAL QA`.

**Evidence state**:
- Source: pending; this worktree candidate is not merged to `main`.
- Checks: not recorded for a canonical `main` SHA.
- Visual proof: not recorded.
- Preview: not recorded.
- Production live: not recorded.

**Author**: Homen Shum + Codex.
**Touches**: [`../pages/exact-cockpit.md`](../pages/exact-cockpit.md), [`../pages/agents.md`](../pages/agents.md), and [`../components/fast-agent-panel.md`](../components/fast-agent-panel.md).
