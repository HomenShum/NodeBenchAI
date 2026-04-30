# Oracle Bootstrap for Cursor

Canonical source: `docs/agents/bootstrap/cursor.md`

Use `ORACLE_VISION.md`, `ORACLE_STATE.md`, and `ORACLE_LOOP.md` as the mandatory source of truth. Keep the work small, testable, and tied back to the original implementation idea.

For every Oracle-related task:

- restate the smallest viable slice
- implement it
- verify it
- run the verification floor from `ORACLE_LOOP.md`
- record what changed in `ORACLE_STATE.md`
- call out measured evidence and remaining risk

Do not ship a one-shot dashboard or detached agent platform. Extend the existing NodeBench harness.
