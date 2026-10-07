# Walkthrough citations

## 2026-10-07 — Check source citations before dependency installation

A developer or coding agent following an onboarding citation could reach a different function while the old range check still passed. Require a tour pattern, check START_HERE citations against their stated source text, and run the existing direct command before installation in CI. Agent instructions now point new readers to START_HERE; browser test guidance names its required Convex deployment.

**PR / canonical main commit**: [#614](https://github.com/HomenShum/NodeBenchAI/pull/614) / `0121a91410643a7d079d81c46e13d5bcc8ca92dc`.

**Evidence state**:
- Source: merged via PR #614; no application runtime changes.
- Checks: PR head `ae7ce6f7a550e3a2f5618039796c668fbd057d42`, CI run [37602892860](https://github.com/HomenShum/NodeBenchAI/actions/runs/37602892860). `node scripts/validate-tours.mjs` checked all 37 citations in job 112731811564; Typecheck, Runtime smoke, Build and launch gates passed on that head. August test counts are historical; no current full-suite or matched mutation result is asserted.
- Visual proof: not applicable to this documentation and CLI guard change.
- Preview: not recorded.
- Production live: not recorded.

**Author**: Homen Shum + Codex.
