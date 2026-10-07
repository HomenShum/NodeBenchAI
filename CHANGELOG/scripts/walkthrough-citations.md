# Walkthrough citations

## 2026-10-07 — Separate historical scores from current readiness

A developer or coding agent deciding whether to hand off NodeBench should be able to distinguish recorded April scores from checks on the revision they are using. The README now labels those scores as historical and links the reviewed main CI, blocked Pipeline preflight and committed full-stack summary; it no longer claims latency is the only remaining work.

**PR / canonical main commit**: `PENDING #NNN MAIN SHA / FINAL QA`.

**Evidence state**:
- Source: pending documentation-only candidate for `README.md`; no runtime or gate changes.
- Checks: no new local checks, manual CI rerun or full-stack evaluation. Read-only review of main `80853f0c418fc77e9621f27be22840d9fca48d56`: [CI 37604577354](https://github.com/HomenShum/NodeBenchAI/actions/runs/37604577354) reports Typecheck, Runtime smoke, ScratchNode launch gates and Build passing; [Pipeline job 112738741012](https://github.com/HomenShum/NodeBenchAI/actions/runs/37605136749/job/112738741012) passes 11 runner scenarios, then blocks before evaluating golden queries because the response exceeds 65536 bytes. The [committed full-stack summary](../../docs/architecture/benchmarks/full-stack-eval-latest.md) is dated April 23, records skipped phases and remains `demo_candidate`.
- Visual proof: not recorded; no visual or responsive grade asserted.
- Preview: not recorded.
- Production live: not recorded; no new production verification asserted.

**Author**: Homen Shum + Codex.

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
