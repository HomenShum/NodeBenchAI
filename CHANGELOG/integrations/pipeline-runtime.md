# Pipeline Runtime

Append-only lane for pipeline launch, activity, streaming, evaluation, schedule,
and secret-gated MCP bridge ownership contracts. Newest entries first.

## 2026-10-07 — Verify the standalone worker's clean build inputs

A developer starting the standalone worker needs the committed dependency
inputs and actual compiled startup, rather than a frontend build. This local
packaging candidate restores the root lock, shares supported Node 22/npm 11.5.2
and the public peer policy, removes the missing patch-script copy, promotes
the existing dotenv range to runtime dependencies and excludes credential
files from cloud context. The worker entrypoint, routes and all 233 declared
version ranges remain unchanged.

**PR / canonical main commit**: `PENDING MAIN SHA / FINAL QA`.

**Evidence state**:
- Source at local-proof capture: local worktree candidate on baseline `e2e82cafe7619e5ea986cb883601f2bca1c4b073`; not committed, published or merged. All six packaging/helper source files match the independently reviewed candidate; only this lane and the existing runbook record observed outcomes.
- Checks: current-manifest npm 11.5.2 lock generation and `npm ci --dry-run` pass. The first Docker attempt could not reach the Linux engine; after recovery, the actual unchanged clean-source build exits 1 because `package-lock.json` and `scripts/patch-crons-exports.mjs` are absent at `COPY`. The repaired native Linux/amd64 image builds and runs the compiled worker with Node v22.22.2/npm 11.5.2. Local proof `NODEBENCH-PIPELINE-CLEAN-BUILD-01` passes: actual Docker network `none`, empty mounts/host-port bindings, only seven expected public environment-variable names, HTTP200 root/MCP/Pipeline health, 573 registered tools, Linkup/Gemini configuration false, 12 concurrent plus 20 repeated empty-query HTTP400s, malformed JSON HTTP400 and zero sessions. These 33 rejections completed in 94 ms, a burst/repeated observation. A separate 60,005 ms paced stability observation in the same image retained healthy responses and zero sessions across 61 invalid HTTP400 requests and 13 recovery snapshots; it does not certify a production SLA or long-term memory behavior. Both owned worker containers were stopped normally.
- Security limit: install audit reports 29 production vulnerabilities (7 low, 11 moderate, 11 high) and 57 full-build vulnerabilities (7 low, 21 moderate, 27 high, 2 critical). Separate audit-only proof `PIPELINE-LOCK-AUDIT-01` used the same image/lock and public npm registry on Docker network `bridge`, ran no worker and exited 1 with the same 29 production findings (zero critical). No dependency update or security pass is claimed; no baseline installed graph existed for a vulnerability comparison. This registry diagnostic is separate from the worker containers' network isolation.
- Visual proof: not applicable; no UI change.
- Preview: not recorded; no deployment.
- Production live: not verified; no worker URL, provider-backed golden result or all-green certificate.

**Author**: Homen Shum + Codex.
**Runbook**: [`Clean container prerequisite`](../../docs/runbooks/PIPELINE_QUALITY_BENCHMARK.md#verify-the-clean-container-prerequisite).

## 2026-07-16 - Ground chat follow-ups in bounded receipt context

The pending candidate extends redesign chat runs with optional, sanitized conversation
turns and a parent receipt hash. The live action includes this transcript as context while
requiring factual claims to be re-grounded, and public hash receipts redact the private
continuation fields. See [`../pages/redesign-chat.md`](../pages/redesign-chat.md).

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
