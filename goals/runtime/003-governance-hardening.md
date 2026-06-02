# Goal: Harden branch protection so the rails are ENFORCED, not just convention

The agent-governance rails (GOVERNANCE.md) say "no `--admin` merge, no bypassing CI, privacy + visual
checks must gate." Live inspection of `main` branch protection shows these are **not yet enforced**.
Close the gaps. **HIGH RISK — branch-protection change is a no-autonomy zone; founder applies via the
GitHub API/UI. The agent only drafts + verifies; it must NOT flip these settings itself.**

- **status:** proposed (awaiting founder action)
- **surface:** runtime / governance
- **severity / risk class:** HIGH (no autonomous merge; founder-applied)

## Findings (from live `gh api .../branches/main/protection`)
1. **`enforce_admins: false`** → an `--admin` merge currently bypasses required checks. The "no `--admin`" rail is unenforced.
2. **Required checks = `Typecheck, Runtime smoke, Build, Tier B vs preview URL`** — but **privacy-invariant** (`scratchnode-live-route-honesty`) and **visual-regression** (`dogfood-qa-gate`) are NOT required, so a private-note leak or visual regression can merge.
3. CODEOWNERS exists — verify it covers `convex/schema.ts`, auth paths, `packages/runtime/**`, evals, and the ScratchNode privacy paths.

## Proposed changes (founder applies)
- Enable `enforce_admins` on `main`.
- Add to required checks: the privacy-invariant e2e job + the visual/dogfood gate job (confirm their exact check names first).
- Add restricted-file rules / ruleset: `.env*`, secrets, high-risk migration scripts.
- Confirm CODEOWNERS review is required for: `convex/schema.ts`, `auth/**`, `packages/runtime/**`, `packages/evals/**`, ScratchNode privacy paths.

## Definition of done
- [ ] `gh api repos/.../branches/main/protection/enforce_admins` returns `true`.
- [ ] Required-checks list includes the privacy-invariant + visual gates (verified via the API).
- [ ] A test PR that touches `convex/schema.ts` requests CODEOWNERS review.
- [ ] GOVERNANCE.md "honest gaps" section updated to reflect the closed gaps.

## Constraints
- The AGENT must NOT change branch protection, rulesets, or CODEOWNERS autonomously (HARD_GATES.md).
- Verify each change against the live API after the founder applies it; don't claim "enforced" without the API confirming.
- Do not weaken any existing required check.
