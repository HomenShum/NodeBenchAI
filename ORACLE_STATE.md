# Oracle State

Canonical source: `docs/architecture/oracle/STATE.md`

This root copy is the handoff-friendly state tracker that agents and tests can read from the repo root without re-deriving Oracle status.

## Current Milestone

- Name: Harness-first prompt pack and control tower
- Status: in_progress
- Goal: ship the shared Oracle docs, typed cross-check fields, builder-facing control tower, and session detail surfacing.

## Completed

- `ORACLE_VISION.md` is builder-first and repo-native.
- Task sessions and traces support Oracle cross-check fields.
- The agent hub includes an Oracle control tower panel.
- Task cards and task detail surfaces show drift and source context.
- Targeted Oracle tests, TypeScript, and production build have passed in prior loops.

## Active Quest

- Keep the shared Oracle contract resolvable from the workspace root.
- Close remaining verification and dogfood gaps without inventing a second harness.

## Open Defects

- Existing sessions may not have Oracle metadata yet, so UI paths must handle untracked runs cleanly.
- Cost fields remain optional until every producer writes them consistently.
- Dogfood linkage still depends on builders attaching the latest run to the active session.

## Update Rules

When a loop completes:

1. Record what changed.
2. Record what still fails or drifts.
3. Record the next recommended action.
4. Keep entries short and operational.
