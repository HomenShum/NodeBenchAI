# Agent Governance — protected rails for the self-directed loop

> **The coding agent may self-direct research, visual comparison, patch planning, implementation,
> and PR creation. Merges to `main` are automated only through protected PRs, required checks,
> visual artifacts, and risk-class gates.**

This is the contract that makes the loop *agent-governed* rather than *agent-unbounded*. It pairs
with [`HARD_GATES.md`](HARD_GATES.md) (zones) and [`AGENT_LOOP.md`](AGENT_LOOP.md) (the loop itself).

## What the agent MAY self-direct
```
research → screenshots/video → visual comparison → closed Goal Card → patch (branch)
→ QA (tests + Playwright + visual) → PR (with before/after assets + DoD)
→ enable auto-merge IF risk class allows → delete merged branch → update docs/changelog
```

## What the agent MAY NOT silently self-direct
```
production deploys                        bypassing CI
destructive database changes              bypassing branch protection
private/public permission changes         admin merges without review rules
```
For these, the agent drafts a patch + opens a PR labelled HIGH risk; **a human approves the merge.**

## Risk classes → merge policy

| Class | Examples | Auto-merge? | Required before merge |
|---|---|---|---|
| **LOW** | docs, README, screenshots, copy, CSS-only polish, prototype/demo fixtures | ✅ agent enables `--auto --squash` | CI green · no protected-file change · PR body complete |
| **MEDIUM** | ScratchNode/NodeBench UI flow, non-auth frontend logic, Playwright-visible behavior, demo orchestration | ✅ auto-merge after checks, **human may cancel** | CI green · Playwright green · before/after screenshots · public/private QA green · (optional 1 approval) |
| **HIGH** | auth, permissions, public/private rules, schema/migrations, agent tool policy, cache visibility, billing/rate-limits, deploy config, secrets, prod data deletion, **branch-protection / ruleset changes** | ❌ never autonomous | human approval · security checklist · manual review · staging first |

## Mapping to THIS repo's real infrastructure (not the generic example)

This repo is **npm + Vercel + Convex** (no pnpm). CI, CODEOWNERS, and the PR template **already exist** —
the agent references them, never overwrites them.

- **Required status checks on `main`:** `Typecheck` · `Runtime smoke` · `Build` · `Tier B vs preview URL`.
- **Relevant existing workflows** (`.github/workflows/`): `ci.yml`, `convex-deploy.yml`, `tier-b-preview.yml`,
  `post-deploy-verify.yml`, `dogfood-qa-gate.yml`, `delta-dogfood-gate.yml`, `pr-style.yml` (Conventional-Commits
  + branch-name), `vercel-preflight.yml`, `pr-demo-video.yml`.
- **Privacy-invariant check** = `tests/e2e/scratchnode-live-route-honesty.spec.ts` (+ `home-v5-output-contract`).
- **CODEOWNERS** + **PR template** already present in `.github/`.
- **Merge command the agent uses:** `gh pr merge <N> --auto --squash --delete-branch`. **Never** `--admin`,
  never `git push origin main`, never `--no-verify`.

## ⚠️ Honest governance gaps (proposed as HIGH-risk Goal Cards, NOT auto-fixed)

These were found by inspecting live branch protection. Because changing branch protection is itself a
HIGH-risk no-autonomy zone, they are **proposed for founder approval** — see
`goals/runtime/003-governance-hardening.md`:

1. **`enforce_admins` is currently `false`** → an `--admin` merge *can* bypass required checks today.
   The "no `--admin` merge" rail is a convention, not yet enforced. Proposal: enable `enforce_admins`.
2. **Privacy-invariant + visual-regression are not *required* checks** — `scratchnode-live-route-honesty`
   and the dogfood/visual gate run but don't block merge. Proposal: add them to required checks.
3. **Restricted-file rules** (`.env*`, secrets, high-risk migrations) and **CODEOWNERS review** for
   `convex/schema.ts`, auth paths, runtime, evals — verify/extend coverage.

## The governance sentence (operating rule, restated)
Human sets the *why* + boundary and approves HIGH-risk merges. Agent self-directs the *how* inside a
closed Goal Card. CI + evals + visual artifacts + GitHub rulesets decide what reaches `main`.

## Operational lessons (from real loop runs — append-only)

### 2026-06-03 — Open PRs go DIRTY while the loop keeps shipping; land or rebase within a day
**What happened.** While the daily small-loop shipped ~10 changes to `public/proto/home-v5.html`,
two reviewable PRs left open against it — #469 (host public-write verification) and the type-scale
work (#499) — both went `DIRTY`/`CONFLICTING`. Squash-merges rewrote the base they branched from,
so each intervening ship widened the gap. #469 could not be cleanly rebased and had to be **rebuilt
fresh on current `main` as #500**; the type-scale work had to be re-landed via a clean cherry-pick.
Recovery cost more than the original change.

**Rule.** A PR that touches a hot file (`home-v5.html`, `convex/events.ts`, the honesty spec, the
ScratchNode e2e specs) must be **landed or rebased within one working day**. If it is human-gated and
can't land same-day, rebase it onto `main` daily (`git fetch && git merge origin/main` → re-run the
oracle `home-v5-output-contract` + `scratchnode-live-route-honesty`) until it does — or **close it and
re-cut from `main`** when the gate clears. Never let a reviewable PR sit behind multiple loop ships;
the rebase cost grows superlinearly with each squash-merge.

**Mechanic (≥2 PRs on the same hot file).** **Serialize.** `strict: true` branch protection makes the
"behind main" ping-pong explicit: land one, then immediately `git merge origin/main` into the next,
re-verify the oracle, push, let it merge. Update the loser the moment the winner lands — do not leave
both armed-but-behind. (Both #499 and #500 went `BEHIND` the instant #496 merged; each needed a same-pass
`merge origin/main` + oracle re-run + push to clear it.)
