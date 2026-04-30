# Oracle Bootstrap for Claude Code

Canonical source: `docs/agents/bootstrap/claude-code.md`

Before any code change, read `ORACLE_VISION.md`, `ORACLE_STATE.md`, and `ORACLE_LOOP.md`. Then pick a small slice, implement it, verify it, dogfood it, and update state.

Oracle work must stay harness-first:

- preserve the original idea as a source artifact
- track source references, success criteria, cross-check status, and drift
- prefer measured evidence over self-review
- say what could still be wrong
- keep the control tower builder-facing

Do not replace the current NodeBench harness with a second agent platform.
