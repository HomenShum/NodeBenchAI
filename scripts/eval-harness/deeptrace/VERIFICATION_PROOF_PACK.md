# DeepTrace Autoresearch Verification Proof Pack

## 2026-10-14 qualification — historical assertions are not measured improvement

An engineer using the March report to choose an agent change could mistake generated metrics for observed improvement. The original report below is preserved as history, but its promotion, measurement, prompt-execution and uplift claims are not verified evidence. The paired runner constructs fixture outputs and hashes prompts; it does not execute those prompts. Existing proposer metrics, including canary proxies, do not independently certify candidate quality or throughput.

The current evaluator therefore marks proposals unverified and ineligible, reports skipped compile/test checks as `null`, and keeps each session's original baseline unchanged. Replay labels historical promotions as recorded, unverified assertions without rewriting their raw logs. The paired command now requires `--simulate` and labels every exported artifact as simulation with no release eligibility. The historical commands below describe the old run; use the current README for invocation.

Focused local regression proof: the new 11 scenario tests failed against the old implementation, then passed alongside 20 existing scoring tests after the repair. A private Node-environment Vitest 4.1.11 configuration and existing external runtime were used because this checkout has no installed dependencies. Scoped TypeScript 5.9.3 checking also passed. The tests execute actual proposer/evaluator/session logic and the native paired CLI, while isolating worktree and code-check subprocess I/O and redirecting logs to private storage. These checks do not establish a full application pass, a real optimizer lifecycle, provider execution, live deployment or measured improvement. Independent measurement remains unfinished.

## Historical report (2026-03-18; qualified above)

Date: 2026-03-18

## Outcome

The DeepTrace offline optimizer, deterministic canary harness, and paired prompt benchmark runner are operational on this Windows host.

Verified in this proof pass:

- deterministic canary benchmark CLI runs and persists results
- baseline snapshot capture from measured metrics works
- optimizer replay works from package scripts
- simulated optimizer proposer can produce a real promotion
- measured benchmark proposer runs end-to-end in worktrees
- paired prompt benchmark CLI runs `claude-baseline.prompt.md` versus `claude-nodebench.prompt.md` and emits repo-local scorecard artifacts

## Commands executed

1. `npx.cmd tsx scripts/eval-harness/deeptrace/canary-benchmark.ts`
2. `npm.cmd run deeptrace:autoresearch:baseline -- --metrics scripts\\eval-harness\\deeptrace\\canary-results\\latest-metrics.json --out scripts\\eval-harness\\deeptrace\\baseline-snapshots\\canary-baseline.remeasured.json`
3. `npm.cmd run deeptrace:autoresearch:optimize -- --baseline scripts\\eval-harness\\deeptrace\\baseline-snapshots\\canary-baseline.remeasured.json --proposer scripts\\eval-harness\\deeptrace\\nodebench-proposer.ts`
4. `npm.cmd run deeptrace:autoresearch:replay -- opt-5c965554`
5. `npm.cmd run deeptrace:autoresearch:optimize -- --baseline scripts\\eval-harness\\deeptrace\\baseline-snapshots\\canary-baseline.remeasured.json --proposer scripts\\eval-harness\\deeptrace\\benchmark-proposer.ts --config scripts\\eval-harness\\deeptrace\\optimizer-config-15.json`
6. `npm.cmd run deeptrace:autoresearch:replay -- opt-9de7ef12`
7. `npx.cmd tsc --noEmit`
8. `npm.cmd run deeptrace:autoresearch:paired-bench`

## Key artifacts

- Canary suite result: `scripts/eval-harness/deeptrace/canary-results/canary-1773814352204.json`
- Latest measured metrics: `scripts/eval-harness/deeptrace/canary-results/latest-metrics.json`
- Measured baseline snapshot: `scripts/eval-harness/deeptrace/baseline-snapshots/canary-baseline.remeasured.json`
- Successful simulated promotion log: `scripts/eval-harness/deeptrace/run-logs/opt-5c965554.json`
- Measured worktree benchmark log: `scripts/eval-harness/deeptrace/run-logs/opt-9de7ef12.json`
- Paired benchmark summary: `scripts/eval-harness/deeptrace/paired-results/paired-1773815410138/paired-summary.json`
- Paired benchmark report: `scripts/eval-harness/deeptrace/paired-results/paired-1773815410138/paired-summary.md`

## Verified results

### 1. Deterministic canary suite

- Suite ID: `canary-1773814352204`
- Fixtures: 5
- Result: CLI completed successfully and wrote both suite JSON and baseline-compatible metrics JSON

Measured aggregate metrics:

- taskCompletionRate: `0.6`
- timeToFirstDraftMs: `0.0866`
- humanEditDistance: `33`
- wallClockMs: `0.0866`
- toolCallCount: `6`
- evidenceLinkage: `1.0`
- receiptCompleteness: `0.9333`

### 2. Baseline capture

- Baseline ID: `baseline-401d5942-1773814353502`
- Commit: `401d5942a56f4b1d98a401a0f368e489002b9b93`
- Result: baseline snapshot persisted successfully from measured canary metrics

### 3. Simulated optimizer promotion proof

- Session ID: `opt-5c965554`
- Result: `research-cell-balanced-v1` promoted successfully
- Candidate summary: 1 promoted, 9 discarded

What this proves:

- package-script optimize path works on Windows via `npm.cmd`
- metrics-only proposals no longer fail on unnecessary compile/test gating
- scoring, promotion, run-log persistence, and replay all work end-to-end

### 4. Measured benchmark proposer proof

- Session ID: `opt-9de7ef12`
- Result: all 15 candidates executed and were discarded
- Failure mode: every candidate measured the same outcome, producing `canaryRelativeUplift ~ 0` and failing the quality guard / promotion threshold

What this proves:

- worktree creation, proposal loading, measured benchmark execution, log persistence, and replay all function
- the remaining gap is not CLI operability; it is candidate effectiveness or benchmark sensitivity

### 5. Paired prompt benchmark proof

- Suite ID: `paired-1773815410138`
- Cases: `5`
- Baseline score: `0.5417`
- DeepTrace score: `0.9824`
- Relative uplift: `0.8134` (`81.34%`)
- DeepTrace evidence linkage: `1.0`
- DeepTrace receipt completeness: `1.0`
- DeepTrace false-confidence rate: `0.032`
- Release guards: all passed

What this proves:

- the repo now has a first-class paired benchmark runner for `claude-baseline.prompt.md` vs `claude-nodebench.prompt.md`
- the runner hashes prompt templates, records the benchmark metadata contract, and writes per-case baseline/deeptrace artifacts plus a suite summary
- the benchmark contract described in `docs/architecture/benchmarks/DEEPTRACE_CLAUDE_CODE_BASELINE_AND_UPLIFT.md` is now executable end-to-end from a package script

## Interpretation

The offline optimizer loop is now operationally proven in three forms:

1. **Simulated proof path**: promotion/discard mechanics are proven.
2. **Measured proof path**: real benchmark execution in worktrees is proven.
3. **Paired prompt proof path**: baseline-vs-NodeBench prompt comparison is proven and artifactized.

The paired benchmark gap is closed. The remaining non-blocking observation is narrower:

- the measured proposer currently produces zero observed uplift across the deterministic canary suite, so future work should focus on candidate effectiveness or benchmark sensitivity rather than runner operability

## Single most important next step

Use the new paired benchmark runner as the default proof harness when changing the baseline or NodeBench prompt contracts, then compare future candidate changes against `paired-1773815410138` as the initial repo-local reference point.
