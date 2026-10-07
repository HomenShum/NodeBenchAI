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

**PR / canonical main commit**: `PENDING #NNN MAIN SHA / FINAL QA`.

**Evidence state**:
- Source: pending publication; the workflow, this lane, and its index link are the only intended changes. The health script, backend, schedule, budgets, dependency installation and alert behavior are unchanged.
- Checks: baseline/new shell comparison passed in 36 independent inert Bash fixture scenarios: success, degradation and fatal failure retained statuses 0/1/2, one invocation and byte-identical runner/artifact output. The old successful-then-unconfigured sequence invoked twice, masked the save failure and recorded zero stdout bytes in the fixture receipt. These fixtures did not execute repository code or call a backend/provider. Baseline main `bfff5cafc6bb638c6128fe1e05a236b6055886a4`, run `37688963642`, job `113023939956` logged 60 appends, zero errors, p95 230 ms and successful pagination, followed by a second invocation's missing-configuration fatal error. The uploaded baseline artifact contents were not inspected. Candidate automatic CI and the next natural scheduled run are pending; no manual workflow dispatch or provider call was performed for this change.
- Visual proof: not recorded; no product UI changed.
- Preview: not recorded.
- Production live: not recorded; a source merge or green generic CI does not prove the scheduled receipt or production health.

**Author**: Homen Shum + Codex.
**Touches**: [changelog index](../README.md), [hourly workflow](../../.github/workflows/notebook-hourly.yml).
**Historical context**: [Notebook hardening changelog, row 20](../../docs/changelog/notebook-hardening-changelog.md) records the original hourly monitoring setup. That historical entry is preserved.
