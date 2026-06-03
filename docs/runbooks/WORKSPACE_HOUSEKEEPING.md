# Workspace Housekeeping

Use this runbook when local agent history, generated output, or tool upload scope starts obscuring launch work.

## Goals

- Keep Augment upload candidates below the 250000 file limit.
- Preserve product source, backend source, dirty worktrees, locked worktrees, required worktrees, and external worktrees.
- Map/reduce local history into `safe`, `caution`, and `keep` buckets.
- Automatically clean only generated paths classified as `safe`.
- Keep reports in `.tmp` ignored by Git and Augment.

## Commands

```powershell
npm run repo:housekeeping:check
```

Component commands:

```powershell
npm run repo:augment:check
npm run repo:history:map
npm run repo:housekeeping
npm run repo:housekeeping:verify
```

Optional bounded diagnostic:

```powershell
npm run repo:history:clean-safe
```

Use this only after reviewing the reducer report:

```powershell
npm run repo:history:prune-clean-worktrees
```

If cleanup runs, inspect `actions.removedSafe` and `actions.prunedWorktrees` in `.tmp/workspace-housekeeping-loop.json`. Normal unattended housekeeping should leave `actions.prunedWorktrees` empty.

`repo:housekeeping:verify` writes `.tmp/workspace-housekeeping-verification.json` for heartbeat and CI-style consumers. It is ignored like the other `.tmp` reports.

## Bucket Policy

`safe` is generated output only. It can include non-report children of `.tmp`, Playwright reports, test results, and generated eval harness result children.

`caution` is a clean registered local worktree inside cleanup roots. It is report-only unless an operator explicitly chooses `repo:history:prune-clean-worktrees`.

`keep` includes the primary worktree, product/runtime source, required prod-parity worktrees, dirty registered worktrees, locked worktrees, missing or invalid registered worktrees that require Git metadata inspection, and anything outside cleanup roots.

External registered worktrees are report-only and are never modified by the cleanup loop.

## Normal Loop

1. Run `npm run repo:housekeeping:check`.
2. If the gate fails, run component commands to isolate: `repo:augment:check`, `repo:housekeeping`, and `repo:housekeeping:verify`.
3. Inspect `.tmp/workspace-housekeeping-verification.json`.
4. Inspect `.tmp/workspace-housekeeping-loop.json` if the verifier reports WARN or FAIL.
5. Confirm `augmentScope.passed=true`.
6. Confirm `augmentScope.criticalIgnoreProbesPassed=true`.
7. Confirm `finalHistory.safe.entries=0`.
8. Report any `caution` entries with path and reason.
9. Confirm `protectedPathsClean=true`.
10. Confirm housekeeping did not introduce product source drift.

The verifier fails on staged diff hygiene errors, broken upload scope, broken critical ignore coverage, included untracked files, nonzero final safe entries, protected-path drift, unignored `.tmp` reports, or normal-loop worktree pruning.
