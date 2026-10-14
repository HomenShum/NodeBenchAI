# DeepTrace evidence truth

Append-only changes to how the offline DeepTrace tools distinguish predictions from observed results.

## 2026-10-14 — Keep unverified proposals from advancing the accepted baseline

An engineer comparing agent changes previously received a `promoted` result from the first simulated NodeBench proposal even though no candidate file changed and no compile/test check ran. Its diagnostic throughput score was 0.9142852452029799; the session could adopt those supplied numbers as its next baseline. The paired CLI also printed a fixture-derived 81.34% uplift and passed release guards without executing either prompt.

The shared evaluator now returns unverified, ineligible proposal diagnostics, validates metric domains before scoring, and distinguishes skipped checks (`null`) from executed passes/failures. Sessions isolate their baseline from callback mutation and never adopt proposed metrics. Historical replay qualifies recorded promotions without modifying raw logs. The paired CLI requires `--simulate`; all JSON, Markdown, traces, metadata and console outputs identify simulation, and arithmetic threshold passes remain under `simulationDiagnostics`. The diagnostic numbers are preserved. Independent measured improvement is still unfinished.

**PR / canonical main commit**: `PENDING PR / MAIN SHA / FINAL QA`.

**Evidence state**:

- Source: bounded seven-file patch prepared on base `8b4846baa9adedd5107b8eae1acd46805a8f272d`; independent exact-diff review pending.
- Checks: focused Vitest 4.1.11 run against the old implementation: 20 existing tests passed, all 11 new scenarios failed (exit 1). After repair: 31/31 passed (exit 0). Private focused TypeScript 5.9.3 check passed (exit 0). Both used the existing NodeAgent runtime and private configs; no dependency installation or full NodeBench suite was performed.
- Scenario proof: actual first proposer/evaluator; 128 sustained proposals; concurrent baseline isolation; forged measurement claims; malformed/nonfinite and arithmetic-invalid metrics; failed/skipped code checks; legacy replay; default paired CLI exit 1 without artifacts; explicit simulation exit 0 with all 37 artifacts qualified. Worktree/code-check subprocess I/O was isolated, session-log writes redirected privately, and native paired CLI execution was real.
- Visual proof: not applicable to this CLI/evidence-only change.
- Preview: not recorded.
- Production live: not recorded.

**Compatibility**: new candidates no longer report promotions; skipped check fields can be null; paired execution now requires `--simulate`, and paired summary consumers must use `simulationDiagnostics` instead of treating fixture thresholds as release guards. Historical raw artifacts remain unchanged.

**Author**: Homen Shum + Codex.
