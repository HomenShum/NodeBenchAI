# Canonical prompts

Copy-paste these into Claude Code. The daily/weekly ones are mirrored by the scheduled crons
(`nodebench-self-improvement-loop`, `nodebench-weekly-self-review`) — keep them in sync.

---

## Daily small-loop (run when overwhelmed)

```
/goal Find the smallest useful next step.

Context: ScratchNode Live is the public room; NodeBench AI is the private workspace.
We are shipping the shortest real loop. Review current state and propose EXACTLY ONE next task that:
- improves the core loop (join → chat → /ask → answer → private note → FAQ → wiki → open NodeBench),
- can be completed today,
- has a visible demo outcome,
- does NOT add a new surface.

Output: 1) task  2) why it matters  3) files likely affected  4) definition of done  5) what NOT to touch.
Write it as a Goal Card in goals/<surface>/NNN-slug.md (status: proposed). Only tiny pre-validated,
CI-gated detector fixes may auto-ship (≤3/day); everything substantive waits for founder approval.
Respect goals/HARD_GATES.md.
```

## Weekly self-review (large ambiguous review → fan out)

```
/goal Weekly architecture and product self-review. (You may use a workflow for the fan-out.)

Review ScratchNode, NodeBench, docs, evals, and the demo oracle (home-v5-output-contract = run_demo_full).
You are NOT allowed to add features by default. Find:
1) broken invariants, 2) duplicated surfaces, 3) prototype-only code leaking into prod,
4) missing tests, 5) confusing UI states, 6) runtime cost risks, 7) docs drift.

Output to goals/reviews/<date>-weekly.md: top 10 issues, recommended cuts, the 3 highest-leverage
Goal Cards (write each to goals/<surface>/NNN-slug.md, status: proposed), files affected, tests to add.
Do NOT implement. If the demo oracle is red, flag P0 at the top.
```

## Design critic (constraint-bounded, no new features)

```
/goal Critique [ScratchNode v5 | NodeBench workspace] against the core loop.

Core loop: Join → Chat → /ask → Answer → Private note → FAQ → Wiki → open NodeBench.
Do NOT propose new features. Find where the UI makes this loop unclear. Rank issues by:
1) first-time user confusion, 2) privacy risk, 3) interaction friction, 4) visual noise, 5) mobile.
Output only: issue · why it matters · smallest fix · test case.
```
