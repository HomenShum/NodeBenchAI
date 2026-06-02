# `scripts/improvement-loop/` — Self-Improvement Loop

Append-only lane for NodeBench's continuous self-driving improvement loop.

## 2026-06-01 — Bootstrap: scanner + ledger + operating rule
Created the loop substrate (`scan.mjs` deterministic opportunity detectors + scoring, `run-cycle.mjs` orchestrator, durable `ledger.json`), the agent operating manual (`.claude/rules/self_improvement_loop.md`), and the design doc (`docs/architecture/SELF_IMPROVEMENT_LOOP.md`). Unifies existing dogfood/eval loops; ships only through CI-gated PRs; honesty contract human-gated. Cycle C001 ran clean after rejecting 6 false-positive candidates and hardening 2 detectors. Convex ledger graduation queued (unverified-locally → not shipped).

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-02 — Cycle C002: expand detectors + ship first real fixes
Added 3 detectors (button-without-type w/ form-context safety gating, target=_blank missing rel=noopener, img missing alt) and CSS/HTML comment-masking so example markup in comments is not flagged. The cycle found 1 false positive (rejected -> hardened) and 3 real button fixes (shipped). Demonstrates the loop converging: post-fix scan is clean.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-02 — Cycle C003: anchor-as-button a11y detector + fix
Added detectAnchorButtons (flags <a onclick> with no href/role). Found + fixed 3 real instances (openWiki, startTour, snPublishWiki) by adding role="button" tabindex="0" + a global Enter/Space keydown delegate. Mid-cycle I caught a self-introduced bug (inline onkeydown single-quotes broke a JS innerHTML string) and corrected it before shipping — the validate-before-ship discipline in action. Post-fix scan clean.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-02 — Cycle C004: unlabeled-input a11y detector + fix
Added detectUnlabeledInputs (aware of <label for>). Found 11 aria-less inputs, validated to 2 genuinely unlabeled (9 had labels), fixed both with aria-label. Notably REJECTED expanding to home-v2/v3/v4 (superseded dead prototypes, 380+ hits) as theater — the loop ships value, not churn. Post-fix scan clean.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.
