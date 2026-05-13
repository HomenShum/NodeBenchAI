# Prod-Parity UI Kit Workflow

This workflow prevents future agents from confusing stale local branches with the current product.

## Core Rule

Design packet is reference. Production-parity branch is source of truth.

Git source of truth:

```text
origin/main
```

Start from a clean worktree based on `origin/main`.

In this desktop session, the clean prod-parity worktree is:

```text
D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\nodebench-ai\.worktrees\prod-parity-runtime
```

Do not implement from `hotfix/workspace-routing-export` or old parity/design worktrees.

## Agent Start Checklist

1. Confirm current branch and worktree:

```powershell
git status --short --branch
git rev-parse --abbrev-ref HEAD
```

2. Inspect the new UI kit packet:
- identify target screens
- extract screenshots or HTML references
- note layout, spacing, navigation, interaction, and copy deltas

3. Inspect current prod-parity app:
- use the local server or production URL
- capture screenshots for the same screens
- identify only the differences from the new UI kit

4. Classify changes:
- visual/layout only
- route/navigation behavior
- runtime/API/data wiring
- docs/tests only

5. Implement only the required delta. Do not pull code from stale branches unless a specific file is intentionally cherry-picked and reviewed.

## Locked Product Shape

Main web app nav:

```text
Home - Reports - Chat - Inbox - Me
```

Workspace:

```text
nodebench.workspace
Brief - Cards - Notebook - Sources - Chat - Map
```

Workspace is a separate deployed surface, not a sixth tab in the main web app.

## Runtime Safety Rules

- Preserve live Convex-backed flows.
- Do not replace runtime code with fixtures or starter data.
- Demo/sample seed data must be explicit and local/demo-only.
- Normal users should see product-level search status, not provider names.
- Keep private captures private by default.
- Do not merge unrelated old worktrees or generated screenshot/test artifacts.

## Verification Gate

Run from a clean worktree based on `origin/main`:

```powershell
npx tsc --noEmit --pretty false
npx tsc -p convex --noEmit --pretty false
npm run build
```

Run targeted Vitest suites for touched surfaces.

For browser verification:
- open the changed route locally
- confirm no `Convex backend not configured` warning
- capture screenshots for changed views
- compare against the new UI kit packet and current production/prod-parity screenshots
- record any intentional mismatch in the PR notes

## Commit Discipline

Use small scoped commits:

```text
feat(web): align reports cards with latest UI kit
fix(routes): keep report notebook in web detail surface
feat(runtime): restore prod-parity backend event loop
```

Never mix old UI salvage, backend runtime changes, generated screenshots, and test artifacts in one commit.

## Handoff Prompt

Use this when starting a new agent thread:

```text
Start from a clean worktree based on origin/main.

In the current desktop session, use:
D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\nodebench-ai\.worktrees\prod-parity-runtime

Do not use hotfix/workspace-routing-export or old parity/design worktrees as implementation sources.

Inspect the newly provided UI kit packet, compare it against the current prod-parity app, list visual/runtime deltas, implement only the needed delta, and verify with screenshots plus typecheck/build/tests.
```

## Goal-Mode Autopilot

For long UI parity or release-readiness loops, use `docs/runbooks/GOAL_MODE_RELEASE_AUTOPILOT.md`.

The `/goal` prompt is the stop condition, not the implementation plan. It should name the exact views, workflows, checks, browser evidence, QA matrix updates, and residual-risk reporting required before an agent can call the task done.
