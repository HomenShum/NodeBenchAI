# Pipeline Runtime

Append-only lane for pipeline launch, activity, streaming, evaluation, schedule,
and secret-gated MCP bridge ownership contracts. Newest entries first.

## 2026-07-15 — Derive pipeline ownership on the server

The pending candidate removes browser-selected `ownerKey` authority from public pipeline launch, history, detail, bundle, stream, scorecard, and schedule APIs. Cost-bearing single and composed launches and all schedule controls now require an authenticated server identity. Guest history, detail, bundle, stream, and evaluation reads require an anonymous-session possession credential; schedule changes verify row ownership, public responses omit owner keys, and cron or secret-gated MCP work uses explicit internal service contracts. Legacy anonymous schedules do not execute.

Durable per-owner admission allows four launch units per ten minutes and thirty per day; composed runs consume two units and scheduled launches consume quota. Specs, titles, and model IDs are bounded to 4,000, 120, and 160 characters, and each owner may keep at most twenty schedules. The scorecard reports recorded `verifiedShare` instead of fabricated verdict accuracy or Brier calibration, costs are labeled as estimates, streamed-output controls appear only for an active or recorded stream, and schedule copy distinguishes hourly polling, next-run time, and a run that actually started.

Force-fresh launches now mint a unique logical attempt before the durable workflow starts. Workflow retries retain that attempt and an execution-generation fence, while each recurring schedule occurrence derives its attempt from the schedule id plus the exact due `nextRunAt`. Overlapping sweeps dedupe the same occurrence and compare-and-set advancement prevents cadence skips. A terminal retry clears stale completion, error, token, output, step, stream, and generated-document state before incrementing its generation; stale generations and overlapping workflows cannot mutate the active row.

Research bundles and Workspace documents now distinguish `sourcesConsulted` from `citationsUsed`. Only in-range `[N]` markers that actually appear in the synthesis bind a citation. Zero-source, unbound-source, non-canonical, or out-of-range citation states deterministically prevent a `verified` verdict and land on `needs_review`, regardless of a model's requested tier.

**PR / canonical main commit**: #541 / `15eb9a0a`; strict session rollout #542 / `16d3ceeb`; live-verifier alignment #543 / `56d8413a`.

**Evidence state**:
- Source: merged to `main` through CI-gated squash PRs #541, #542, and #543.
- Checks: required Typecheck, Runtime smoke, Build, and Tier B checks passed on all three PRs; source CI `29474652151`, strict-rollout CI `29475282082`, and verifier CI `29475698322`.
- Visual proof: private responsive/theme artifacts remain outside git; the production exact/mobile/product/one-flow matrix passed all 17 assertions, with one blank mobile navigation transient passing on immediate isolated rerun.
- Preview: #541 exact-head preview `nodebench-2otgtyneq-hshum2018-gmailcoms-projects.vercel.app` passed Tier B run `29474652192`; #542 preview `nodebench-iwmpxngv3-hshum2018-gmailcoms-projects.vercel.app` passed `29475281999`.
- Production live: Vercel main deploy verification run `29475582335` and Convex deploy `29475582657` passed for strict SHA `16d3ceeb`; canonical `https://www.nodebenchai.com` passed the runtime-grounded production matrix and automated Post-Deploy Verify run `29476029941`.

**Author**: Homen Shum + Codex.
**Touches**: [`../pages/exact-cockpit.md`](../pages/exact-cockpit.md), [`../pages/agents.md`](../pages/agents.md), and [`../components/fast-agent-panel.md`](../components/fast-agent-panel.md).
