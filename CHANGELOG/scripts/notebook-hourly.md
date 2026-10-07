# Notebook hourly health

Append-only lane for the scheduled notebook health check and its operator receipts.
Newest entries first.

## 2026-10-07 — Preserve the original hourly check receipt

An operator deciding whether the notebook is degraded needs the saved evidence to
come from the check that actually ran. The old save step invoked the check again
without its configured environment and swallowed that invocation's failure. Run
the configured check once, capture its stdout and stderr in
`.tmp/notebook-hourly-health.log`, and upload that same output even after a failed
check. Explicit Bash pipefail keeps a failed check from becoming a successful
logging pipeline; the capture is a log, not a guaranteed JSON document.

**PR / canonical source commit**: [#640](https://github.com/HomenShum/NodeBenchAI/pull/640), `f4ef6b0534ab3615fb56d76611b91335cc8f762f`.

**Evidence state**:
- Source: merged normally; the workflow, this lane, and its index link were the three changes. The health script, backend, schedule, budgets, dependency installation and alert behavior are unchanged.
- Checks: 36 independent inert Bash fixture scenarios retained success/degraded/fatal statuses 0/1/2, one invocation and byte-identical runner/artifact output. The old sequence invoked twice, masked its save failure and recorded zero stdout bytes. These fixtures did not execute repository code or call a backend/provider. Exact-source PR CI and actual merged-main [CI run 37693859923](https://github.com/HomenShum/NodeBenchAI/actions/runs/37693859923) passed typechecks, 20 workflow cases, 406 runtime tests across 28 files, 37 Chromium launch cases and the configured build. Tier B used its configured workflow-only skip; it provided no browser proof.
- Scheduled receipt: baseline [run 37688963642](https://github.com/HomenShum/NodeBenchAI/actions/runs/37688963642) on `bfff5cafc6bb638c6128fe1e05a236b6055886a4` reported 60 appends, zero errors, p95 230 ms and successful pagination, followed by a second invocation's missing-configuration failure. Its downloaded artifact was empty. Repaired natural [run 37695618625](https://github.com/HomenShum/NodeBenchAI/actions/runs/37695618625) on the canonical source commit passed with one configured invocation, 60 appends, zero errors, p95 124 ms, successful pagination and no degradation. Its downloaded 263-byte [log artifact](https://github.com/HomenShum/NodeBenchAI/actions/runs/37695618625/artifacts/11515267951) exactly matched the original check's recorded output; SHA256 `F6D6424F01B04A2C98021EC3881C8EBB0DBA0B9ACEB581ED9E91260D355CBD76`. The two latency observations are unmatched scheduled runs, not a measured speed improvement. No manual dispatch was used.
- Visual proof: not recorded; no product UI changed.
- Preview: not recorded.
- Production health: the existing scheduled check and its artifact were observed; no product deployment or broader reliability claim follows. Failed/degraded exit handling was exercised only in inert fixtures, not by inducing a production outage.

**Remaining failures**: Pipeline CI stops at its configured health target's 65,536-byte response cap, before golden queries. Two main Dependabot updates fail with `dependency_file_not_supported`: supported lockfiles or pinned version requirements are missing, so the updater cannot determine installed versions ([KaTeX](https://github.com/HomenShum/NodeBenchAI/actions/runs/37693876709), [OpenClaw Vitest](https://github.com/HomenShum/NodeBenchAI/actions/runs/37693876203)). The scheduled installer used its existing missing-lockfile fallback and emitted Node 20 engine/deprecation warnings; checkout cleanup retained a `.gitmodules` warning. These separate gaps are not closed by this receipt repair.

**Author**: Homen Shum + Codex.
**Touches**: [changelog index](../README.md), [hourly workflow](../../.github/workflows/notebook-hourly.yml).
**Historical context**: [Notebook hardening changelog, row 20](../../docs/changelog/notebook-hardening-changelog.md) records the original hourly monitoring setup. That historical entry is preserved.
