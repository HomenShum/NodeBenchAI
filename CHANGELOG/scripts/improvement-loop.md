# `scripts/improvement-loop/` — Self-Improvement Loop

Append-only lane for NodeBench's continuous self-driving improvement loop.

## 2026-06-01 — Bootstrap: scanner + ledger + operating rule
Created the loop substrate (`scan.mjs` deterministic opportunity detectors + scoring, `run-cycle.mjs` orchestrator, durable `ledger.json`), the agent operating manual (`.claude/rules/self_improvement_loop.md`), and the design doc (`docs/architecture/SELF_IMPROVEMENT_LOOP.md`). Unifies existing dogfood/eval loops; ships only through CI-gated PRs; honesty contract human-gated. Cycle C001 ran clean after rejecting 6 false-positive candidates and hardening 2 detectors. Convex ledger graduation queued (unverified-locally → not shipped).

**Commit**: `this commit`. **Author**: Homen Shum + Claude.
