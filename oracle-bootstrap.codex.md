# Oracle Bootstrap for Codex

Canonical source: `docs/agents/bootstrap/codex.md`

Read `ORACLE_VISION.md`, `ORACLE_STATE.md`, and `ORACLE_LOOP.md` before planning. Work in small slices only. Do not jump straight to a broad implementation.

For every Oracle-related task:

- restate the smallest viable slice
- implement it
- verify it
- prove the key invariant with measured evidence, not self-praise
- dogfood it
- compare it against the shared Oracle docs
- update state

Never treat the first draft as done. The harness matters more than a fast one-shot answer, and self-review is not enough when correctness or performance is at stake.
