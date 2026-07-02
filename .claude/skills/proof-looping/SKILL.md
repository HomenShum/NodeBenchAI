---
name: proof-looping
description: >
  Turn "my app + an agent that demos" into "benchmarked, browser-verified, evidence-backed,
  prod-proven, and looping." Use when a (solo) founder wants to prove an AI agent works IN their
  real app — across all its UI surfaces — without cheating. Triggers: "set up proofloop",
  "proof-loop my app", "benchmark my agent's UI", "prove my agent works in prod", "run proofloop".
  The user's coding agent (Claude Code / Codex / Cursor) drives; the user steers by comment.
---

# proof-looping — "Make no mistake, but for real this time"

No "done" without proof — and the proof is scored by an **independent judge**, never a deterministic
heuristic alone. (In the reference run, a deterministic check false-PASSED an auth-gated task **twice**,
fooled by the app's own demo/template content; only an independent visual judge + a content-match to
the task caught it. Preventing that exact lie is why this skill exists.)

Covers six keywords: **agent harness · benchmark · UI · prod agent · loop engineering · agentic RL.**

## The loop (8 phases)

1. **Set up proofloop** — drop `surface-bench.mjs` (UI breadth) + `proofloop-run.ts` (harness depth),
   add `proofloop:ui` / `proofloop:engine` npm scripts, an `AGENTS.md` completion gate, and a CI job.
   Enforcement lives in CI/branch-protection, NOT in the agent's good intentions.
2. **Ingest codebase + agent harness** — map the REAL runtime: the loop
   (classify → plan → tool → execute → synthesize), the **model seam** (how tool/model calls are
   injected — e.g. a `callTool("call_llm")` callback), routes, and any existing eval infra. Ground in
   real files (read them); never assert a file/flag you didn't open.
3. **Intake UI + its mental model** — enumerate every surface (router paths + the agent-readable
   screen registry, e.g. `data-screen-id`), the *user's job* on each, and the interactive affordances
   (composer input, submit, completion signal). One dominant job per surface.
4. **Research design references** — pull the top web-design exemplars for the app's category; turn
   them into the **visual-judge rubric** (first-pixel-is-action, one job per screen, no overflow,
   visible loading/empty/error, screenshot-worthy output).
5. **Research benchmark** — find the benchmark matching the **deliverable shape**, not the hype:
   spreadsheet edits → SpreadsheetBench; coding repair → SWE-bench; tool-use → BankerToolBench;
   **research-with-sources → GAIA / FRAMES / SimpleQA or the app's own persona/tri-search evals.**
   Picking a benchmark for the wrong shape is the most common waste.
6. **Pick benchmark** — choose it, then write the **task set + per-task acceptance criteria**
   (a concrete `expect` per surface/task — a blanket "page has >200 chars" rule will mis-grade a
   graceful 404 and pass a blank demo). Keep a held-out split; no answer-keys.
7. **Set up LOCAL env with benchmark tasks** — run the app locally so YOU control auth, seed data,
   and model. This is deliberate: **prod auth is often OAuth = a real wall**, and benchmarking prod
   pollutes it. Local lets every task run repeatably, browser-verified, with a seeded/test session and
   the model you choose (point the harness's model seam at your target model for parity).
8. **Run it · ship it · prod-proof it · loop it** —
   `proofloop:ui` drives every surface in a real browser (screenshot + video + console + deterministic
   UI-contract checks + visual judge + interactive submit→result task);
   `proofloop:engine` runs the real harness on your model and exports an `(s,a,o,r)` trace.
   **Gate:** a surface counts only if `render PASS && task PASS && visual ≥ 1`. Promote every failure
   to a regression check. Loop until the gate is green; the traces become agentic-RL reward data.

## Non-negotiables (the honesty floor)

- **PROVE-BEFORE-CLAIM.** Before saying done/passed/works/fixed/blocked/absent/"root cause is", name the
  artifact that proves it and check THAT, not a proxy (an affordance, keyword, rendered shell, or a
  hypothesis from priors). Anything that "looks done" needs an independent confirm. A gate isn't real
  until the autonomous path is tried. The observed failure classes + the gate are in
  [`docs/PROOFLOOP-FAILURE-SIGNALS.md`](../../../docs/PROOFLOOP-FAILURE-SIGNALS.md) — read it; these are
  the false-positives the loop exists to catch.
- **Independent judge > deterministic heuristic.** Always pair the deterministic floor with an
  independent (visual / fresh-context) judge, and require the result to actually address **this** task
  (content match), not "an affordance appeared." Deterministic-only ships lies.
- **Live-DOM, no fake "shipped."** Never claim deployed/works without a rendered-DOM signal + evidence
  (screenshot/video/trace). Build-green and exit-0 are not proof.
- **Honest status.** A server-gated or failed task is a FAIL with its reason — never a coerced pass.
- **Agentic-RL by default.** Every run exports `state → action → observation → reward → next_state`
  so the loop's own traces become reward-ready data.

## Engine (reuse, don't reinvent)

- `surface-bench.mjs` — breadth: live-browser over every UI surface; per-surface screenshot + video +
  console + deterministic UI-contract checks + Gemini visual judge + one interactive task.
- `proofloop-run.ts` — depth: the real agent harness end-to-end on your chosen model via its `callTool`
  seam; exports the `(s,a,o,r)` trace.
- Evidence → `.proofloop-ui/<ts>/` and `.proofloop-run/<ts>/`. Gate via `AGENTS.md` + CI.

See `docs/PROOFLOOPING.md` for the runnable reference + the honest first-run findings.

## Portability

This skill is repo-agnostic: copy `.claude/skills/proof-looping/` + the two engine scripts into any
repo. Phase 2 (ingest) re-grounds it in that repo's real harness, so the loop is filled from the
codebase — not templated.
