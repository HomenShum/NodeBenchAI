# Self-Improvement Loop

A continuous, self-driving improvement flywheel for ScratchNode (expanding to NodeBench
surfaces). The loop keeps finding, scoring, shipping, and recording improvements — forever —
without shipping anything unverified.

## Prior art (what this UNIFIES, not replaces)

- NodeBench `.claude/rules/flywheel_continuous.md`, `self_building_loop.md`, `eval_flywheel.md`,
  `autoresearch_loop.md` — the conceptual loop.
- Existing executable loops it orchestrates rather than duplicating:
  - `npm run dogfood:loop:auto` (`scripts/ui/runDogfoodGeminiQa.mjs`) — Gemini-vision QA loop.
  - `npm run dogfood:proto-live-backend` (`tests/e2e/proto-live-backend-dogfood.spec.ts`) — live-backend ScratchNode dogfood.
  - `scripts/scratchnode-multi-user-dogfood.mjs`, `tests/e2e/scratchnode-live-route-honesty.spec.ts`,
    `tests/e2e/home-v5-output-contract.spec.ts`.
- Anthropic "Building Effective Agents" — orchestrator + deterministic substrate + agent brain.

## The cycle

```
OBSERVE → SCORE → SELECT → (SAFETY gate) → IMPLEMENT → VERIFY → SHIP → RECORD → LOOP
```

| Phase | Owner | What |
|---|---|---|
| OBSERVE | substrate | `scan.mjs` finds concrete, evidenced opportunities (code/a11y/content/motion). Optionally runs e2e + live dogfood. |
| SCORE | substrate | `score = impact(1-5) × confidence(0-1) ÷ effort(1-5)`. Deterministic — no LLM vibes. |
| SELECT | substrate | Top auto-safe opportunity within the per-cycle effort budget. |
| SAFETY gate | substrate | Anything touching the honesty contract / data deletion / irreversibility → `safety:'human'`, score forced to 0, **never auto-shipped** (queued). |
| IMPLEMENT | agent brain | The agent writes the fix on a fresh branch. |
| VERIFY | agent brain | `tsc` + targeted tests + e2e + (UI) Playwright dogfood + reduced-motion + mobile. Must be green. |
| SHIP | agent brain | PR + `gh pr merge --auto --squash` — required CI checks gate every deploy. Post-merge: live-DOM verify. |
| RECORD | substrate | One row per cycle → git ledger (`ledger.json`) always; live Convex `improvementLoopCycles` when graduated. |
| LOOP | scheduler | A recurring agent routine fires the next cycle on cadence. |

## Components

| File | Role |
|---|---|
| `scripts/improvement-loop/scan.mjs` | OBSERVE+SCORE. Deterministic detectors, evidenced backlog → `backlog.latest.json`. |
| `scripts/improvement-loop/run-cycle.mjs` | SELECT+RECORD orchestrator. Writes `ledger.json`; optional `--push-convex`. |
| `scripts/improvement-loop/ledger.json` | Durable, git-tracked, append-only cycle history (reversible audit trail). |
| `.claude/rules/self_improvement_loop.md` | The agent brain's operating manual (IMPLEMENT→VERIFY→SHIP). |
| (queued) Convex `improvementLoopCycles` + `improvementLoop.ts` | Live-backend ledger for in-product observability. |

## Safety invariants (why "autonomous forever" is safe)

1. **Nothing ships unverified** — every change goes through a PR whose required CI checks
   (Typecheck, Runtime smoke, Build) must pass before `--auto` merges it.
2. **Honesty contract is human-gated** — `scan.mjs` records `safetyZones`; any opportunity touching
   the live send/render path, `seenIds` dedup, or no-mock-on-fail guarantees is queued for human
   sign-off, never auto-shipped.
3. **Every change is reversible** — git PR; revert is one command.
4. **No theater** — detectors are deterministic and evidenced; the agent validates candidates and
   REJECTS false positives rather than shipping a bogus fix (see cycle C001).
5. **Kill criteria** — 3 consecutive no-ship cycles → strategy shift (expand detectors/surfaces);
   any red verification → revert + record, never ship; per-cycle effort budget cap.

## Persistence & "live backend"

- The loop **operates against the live production app** — it dogfoods `scratchnode.live`, runs the
  real e2e against the shipped surface, and ships through the real CI → Vercel/Convex pipeline.
- Cycle state is recorded to a **durable git JSON ledger** now, and graduates to a **live Convex
  table** (`improvementLoopCycles`) for in-product observability. The Convex code is written and
  ready (`scripts/improvement-loop/convex-improvementLoop.ts.pending`); it ships once `convex codegen`
  validates in a clean environment (a local worktree dep-resolution error blocked validation at
  bootstrap — this is itself queued opportunity OPP/roadmap item #1, demonstrating the loop fixing
  itself only when verified).

## Continuation ("forever")

A recurring agent routine (scheduled cron) fires a cycle on cadence. Each fire follows
`.claude/rules/self_improvement_loop.md`. To run one cycle manually:

```bash
node scripts/improvement-loop/run-cycle.mjs --effort-budget 3
```

## Roadmap (the loop's own backlog)

1. **Graduate ledger to live Convex** (`improvementLoopCycles`) once codegen validates. (code ready)
2. **Expand detectors** — broken internal links, contrast ratios, focus-visible coverage,
   bundle-size deltas, console errors from live dogfood, e2e flake detection.
3. **Expand surfaces** — beyond ScratchNode to the redesign cockpit + landing.
4. **Wire live signals** — feed `dogfood:loop:auto` Gemini scores + `proto-live-backend` console
   errors into the backlog as scored opportunities.
