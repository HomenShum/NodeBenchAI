# DeepTrace Claude Code Eval Pack

This folder contains the bounded offline artifacts for DeepTrace autoresearch evaluation.

An engineer deciding whether to adopt an agent change needs observed results. A proposer can currently supply better-looking numbers without changing or running the agent. Those numbers are **unverified proposal diagnostics**, including the canary's proxy metrics; they cannot establish improvement or replace the accepted baseline. Independent candidate/baseline measurement remains unfinished.

## Core artifacts

- `claude-baseline.prompt.md`
- `claude-nodebench.prompt.md`
- `canary-benchmark-spec.json`
- `scorecard-schema.json`
- `optimizerRunner.ts`

## Offline optimizer CLI

Package scripts:

- `npm run deeptrace:autoresearch:baseline -- --metrics <metrics.json> [--out <baseline.json>]`
- `npm run deeptrace:autoresearch:optimize -- --baseline <baseline.json> --proposer <module.ts> [--config <config.json>]`
- `npm run deeptrace:autoresearch:replay -- <sessionId>`
- `npm run deeptrace:autoresearch:paired-bench -- --simulate [--outDir <relative/output/dir>]`

`baseline` expects a JSON document shaped as either:

- `{ "throughputMetrics": { ... }, "qualityMetrics": { ... } }`, or
- `{ "throughput": { ... }, "quality": { ... } }`

`optimize` requires a repo-local proposer module that exports `default`, `propose`, or `proposeCandidate` with the optimizer contract from `optimizerRunner.ts`.

Supplied baseline snapshots are labeled `evidenceStatus: "unverified"`. The evaluator validates finite, domain-valid metrics and returns `proposal-only` for valid proposals, or `discarded` when an allowlist/compile/test check fails. Every new candidate result has `evidenceStatus: "unverified"` and `releaseEligible: false`, even if arithmetic guards pass or the caller claims `measured: true`. Compile/test fields are `null` when skipped; only executed successful checks are `true`. A passing code check does not verify the proposed quality or throughput numbers.

Each proposer invocation receives an isolated copy of the original accepted baseline. Sessions retain that baseline and leave `promotedCandidateId` null. Replay shows historical `promoted` verdicts as recorded, unverified legacy claims, with zero verified promotions; original logs are not rewritten.

Run logs are written to `scripts/eval-harness/deeptrace/run-logs/` and baseline snapshots to `scripts/eval-harness/deeptrace/baseline-snapshots/`.

The paired runner requires explicit `--simulate`; without it, the command fails before writing artifacts. It writes per-case artifacts and a paired summary to `scripts/eval-harness/deeptrace/paired-results/<suiteId>/`. It hashes the two prompt templates but does not execute them. Results, traces, metadata, reports and console output identify synthetic fixture diagnostics and no release eligibility. Summary arithmetic and threshold results live under `simulationDiagnostics`; threshold passes are not release guards.

Architecture positioning:

- this runner exercises the local paired artifact and scorecard format with deterministic fixtures
- it does not measure prompt execution, agent quality, human effort, latency or uplift
- real baseline/candidate execution and live multi-model `model_monitor` evaluation remain future work
- any future live telemetry wiring should source actual model / token / latency metadata from `convex/domains/ai/models/modelRouter.ts`

## Evidence boundary regression proof

`evidenceTruth.test.ts` exercises the actual NodeBench proposer, shared evaluator, session acceptance logic, baseline import, legacy replay and native paired CLI. Scenarios cover favorable and forged predictions, malformed metrics, failed/skipped checks, 128 sustained proposals, concurrent sessions with retained mutable references, default CLI refusal and every standalone simulation artifact. Tests isolate worktree/compile/test subprocess I/O and redirect session-log writes to private temporary storage; they do not execute a full optimizer worktree lifecycle or any provider. `optimizerScoring.test.ts` remains arithmetic coverage, not measured improvement evidence.

## Runtime research-cell boundary

The runtime research cell remains bounded to re-analysis of existing DeepTrace state. It does not acquire new external evidence. Use `researchCell=true` for threshold-driven activation and `forceResearchCell=true` only for explicit operator-forced runs.
