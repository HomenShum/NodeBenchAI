# Self-Directed Development OS — ScratchNode + NodeBench

The operating system for how agents improve this product. Founder-authored; this file is the
contract every autonomous run obeys.

## The one uncomfortable rule

The lesson from the "build it in a day" demos is **not** "let the agent do everything forever."
It is: **give the agent a closed goal, a reviewable definition of done, focused subagents,
hard gates, and a batch feedback loop.** A self-directed agent *amplifies the prompt* —
clear goal → useful progress; vague goal → expensive confusion; no evals → a polished wrong thing.

```
✅ Do use                      ❌ Do not use
- goal-driven autonomy         - unbounded "never stop" production agents
- subagent fan-out             - blind autonomous deploys
- batched bug queues           - raw DB mutations
- playtest / dogfood loops     - no-test vibe coding
- critic / skeptic review      - new top-level surfaces by default
- explicit definition of done  - breaking the public/private boundary
```

## The meta-system: two products + one shared runtime

```
ScratchNode Live   = public live room   (room code, chat, /ask, private notes, public wiki)
NodeBench AI       = private workspace  (notebooks, artifacts, daily brief, memory, reports, traces)
NodeBench Runtime  = shared engine      (Convex, pi-ai, Linkup, Typesense, Redis/cache, evals, traces)
```

The loop improves all three — **not with one giant prompt**, but as a sequence of bounded goals.

## The operating rule

> **Human sets the *why* and the *boundary*. Agent explores the *how*. Tests decide whether it
> worked. Docs preserve the learning.**

| Human owns | Agent owns | Tests/evals decide |
|---|---|---|
| product direction, user pain, privacy rules, what to cut, what "done" means | implementation options, code patches, QA scripts, docs drafts, eval generation | privacy boundary, /ask behavior, trace honesty, source support, cost, UI flow |

Your job is to become the best **goal setter and evaluator** for this product — not the fastest coder.

## The flywheel (every cycle)

```
Goal → Spec → Subagents → Critic → Patch → Demo → Evals → Docs → Next Goal
```

1. **Observe** — what did users do, where did they hesitate, what broke?
2. **Classify** — product / UX / backend / privacy / cost / eval issue.
3. **Generate goals** — turn issues into bounded Goal Cards (`goals/<surface>/NNN-slug.md`).
4. **Fan out** — focused subagents (one narrow job each — see roles below).
5. **Synthesize** — one critic removes bad ideas and *reduces scope*.
6. **Patch** — the smallest working change.
7. **Verify** — Playwright, evals, trace checks, screenshot/video, manual dogfood.
8. **Promote** — update docs/demo, queue the next goal.

## Cadence (how it actually runs)

| Driver | When | What it does | Auto-ships? |
|---|---|---|---|
| **Daily small-loop** (`nodebench-self-improvement-loop` cron, 09:17) | daily | cheap scan; proposes ONE bounded next step as a Goal Card | only tiny pre-validated CI-gated detector fixes (≤3/day) |
| **Weekly self-review** (`nodebench-weekly-self-review` cron, Mon 09:25) | weekly | broad fan-out review; top-10 issues + recommended cuts + 3 Goal Cards | no — proposes only |
| **Founder-initiated goal** | any time | you pick a Goal Card → agent fans out → critic → patch → verify → ship | CI-gated PR |

Substantive work is **never** auto-shipped — it becomes a Goal Card the founder approves.
The deterministic substrate is `scripts/improvement-loop/`; the agent manual is
[`.claude/rules/self_improvement_loop.md`](../.claude/rules/self_improvement_loop.md).

## Subagent roles (one narrow job each — never generic)

The strongest pattern from the source analysis: **one subagent per focused unit, wide leeway inside it.**

| Role | Job |
|---|---|
| Product Scope Critic | does this help the core loop or derail it? what to cut? |
| ScratchNode UX | live room, composer, feed, /ask, private note, wiki flow |
| NodeBench UX | notebook, library, chat, daily brief, traces, artifacts |
| Frontend Impl | React/CSS/components |
| Backend/Convex | schema, mutations, permissions, data model |
| Agent Runtime | pi-ai tools, context router, Linkup, semantic cache |
| Privacy/Safety | public/private boundary, host roles, risk/attack tests |
| Cost/Performance | cache reuse, search avoidance, latency, rate limits |
| QA | Playwright, demo scripts, mobile, accessibility |
| Docs/Repo | README, docs, positioning, prototype-vs-production notes |

## The core loop everything serves

```
guest joins ScratchNode → chats publicly → uses /ask → gets a sourced shared answer
→ saves a private note → host promotes FAQ → wiki publishes
→ user opens NodeBench → private notes + event artifact are ready
```

Every improvement must make that loop **clearer, safer, faster, or cheaper.**

## The regression oracle

`run_demo_full` (the `tests/e2e/home-v5-output-contract.spec.ts` 13-phase demo) is the public
"does the product still make sense?" check. **If a patch breaks the demo, it is not an improvement.**

## Hard gates

Some zones are propose-only — agents draft patches, a **human approves**. See
[`HARD_GATES.md`](HARD_GATES.md). Never auto-ship: prod deploy, destructive migrations, auth,
billing, public/private permission rules, data deletion, legal/privacy copy, wiki publish,
host/mod privileges, secrets.

## Directory map

```
goals/
  README.md          ← this file (the OS)
  _TEMPLATE.md       ← Goal Card template
  HARD_GATES.md      ← no-autonomy zones + operating rule
  prompts/           ← weekly-self-review, daily-small-loop, design-critic
  reviews/           ← dated weekly self-review outputs
  scratchnode/       ← ScratchNode Goal Cards (NNN-slug.md)
  nodebench/         ← NodeBench Goal Cards
  runtime/           ← shared-runtime Goal Cards (stricter gates)
```

Prior art: this OS distills the public "ultracode/dynamic-workflows" demos (Anthropic dynamic
workflows; the one-day MOBA build) into a *bounded* practice. See
[`docs/architecture/SELF_IMPROVEMENT_LOOP.md`](../docs/architecture/SELF_IMPROVEMENT_LOOP.md).
