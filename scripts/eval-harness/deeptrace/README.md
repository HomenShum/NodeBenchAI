# DeepTrace Claude Code Eval Pack

This folder contains the bounded offline artifacts for DeepTrace autoresearch evaluation.

An engineer deciding whether to adopt an agent change needs observed results. Proposer-supplied numbers remain **unverified proposal diagnostics** and cannot replace the accepted baseline. The canary now independently compares actual production policy on fixed synthetic stored state. It measures routing and evidence retention, not agent research quality; the broader agent baseline/candidate loop remains unfinished.

## Measured production-policy comparison

An analyst can lose a distinct citation when its label and URL collide in a delimiter-based duplicate key. The policy comparison runs the actual baseline and candidate trigger, planner, ranking and merge functions against the same fixed cases, then grades their returned outputs in the parent process. Stored branch results are synthetic inputs; no query, tool or model is executed.

Use native Node 22.18+ (the repository selects Node 22), an independently chosen baseline policy snapshot, and the reviewed candidate file:

```sh
node scripts/eval-harness/deeptrace/canary-benchmark.ts \
  --baseline-policy /path/to/approved/researchCellPolicy.ts \
  --candidate-policy backend/convex/domains/deepTrace/researchCellPolicy.ts \
  --out /path/to/new-policy-comparison.json
```

The baseline snapshot must be selected by the evaluator/operator, not certified by the candidate. For the initial extraction, the pre-repair snapshot consists of the original production defaults, types, pure functions and helpers, byte-preserved apart from line-ending normalization. It is an extracted source snapshot, not a separately verified Git commit or Convex action run. Keep that provenance with the report. Later comparisons can use reviewed versions of `researchCellPolicy.ts` directly.

Each version runs in a fresh native process from captured source bytes. The policy's complete runtime dependency graph is one module: additional runtime imports fail explicitly, with no host fallback. The worker receives inputs only; expectations and grading stay in the parent. Reports bind the source, evaluator, worker, fixtures and Node version, and include inputs, raw observations, case checks, failures and changes. Output uses exclusive creation and never replaces an earlier receipt. There is no baseline adoption or Git mutation.

Eleven scenarios cover healthy and threshold states, low confidence, missing dimensions, sparse sources, explicit operator review, duplicate and delimiter-bearing citations, missing URLs, 128 archived references and 128 repeated reviews. `policy-improved` requires all candidate checks to pass, no lost baseline check and at least one newly passing check. `equivalent` means the same check outcomes, not semantic equivalence outside these cases. Lost passes yield `regressed`; other incomplete results yield `inconclusive`. CLI failure, remaining failed checks or inconclusive results exit nonzero. Execution errors are reported as errors, never successful measurements.

Every report keeps `releaseEligible: false`, `agentExecuted: false`, `modelExecuted: false` and `acceptedBaselineChanged: false`. Worker elapsed time includes process startup and is diagnostic only. These cases do not measure factual accuracy, user effort, live latency, provider quality or general agent improvement. The worker executes reviewed local code; it is not a security sandbox for hostile JavaScript. Source/request/output sizes, process time and concurrent admission are bounded. No provider secrets or inherited loader configuration are passed to workers.

`benchmark-proposer.ts` now fails before editing files and directs callers to this comparison. Its former candidate-to-host copy, fallback, duplicate scorer and conversion into broad quality/throughput metrics were removed. Other proposers remain subject to the optimizer's proposal-only boundary below.

`policyBenchmark.test.ts` uses actual child processes for causal repair/regression, forged candidate authority, source mutation, missing/importing/oversized sources, throwing/malformed/overflowing output, timeout recovery and concurrent isolation. Existing research-policy tests import the same pure module used by the production action. CI's explicit smoke-test list does not currently include these focused tests; record their execution separately from application CI.

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
- real agent baseline/candidate execution and live multi-model `model_monitor` evaluation remain future work; the separate policy comparison above is narrower
- any future live telemetry wiring should source actual model / token / latency metadata from `convex/domains/ai/models/modelRouter.ts`

## Evidence boundary regression proof

`evidenceTruth.test.ts` exercises the actual NodeBench proposer, shared evaluator, session acceptance logic, baseline import, legacy replay and native paired CLI. Scenarios cover favorable and forged predictions, malformed metrics, failed/skipped checks, 128 sustained proposals, concurrent sessions with retained mutable references, default CLI refusal and every standalone simulation artifact. Tests isolate worktree/compile/test subprocess I/O and redirect session-log writes to private temporary storage; they do not execute a full optimizer worktree lifecycle or any provider. `optimizerScoring.test.ts` remains arithmetic coverage, not measured improvement evidence.

## Runtime research-cell boundary

The runtime research cell remains bounded to re-analysis of existing DeepTrace state. It does not acquire new external evidence. Use `researchCell=true` for threshold-driven activation and `forceResearchCell=true` only for explicit operator-forced runs.
