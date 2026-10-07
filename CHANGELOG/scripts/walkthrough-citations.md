# Walkthrough citations

## 2026-10-07 — Separate historical scores from current readiness

A developer or coding agent deciding whether to hand off NodeBench should be able to distinguish recorded April scores from checks on the revision they are using. The README now labels those scores as historical and links the reviewed main CI, blocked Pipeline preflight and committed full-stack summary; it no longer claims latency is the only remaining work.

**PR / canonical main commit**: [#636](https://github.com/HomenShum/NodeBenchAI/pull/636) / `ef159cce60b9fc6616de3fa455e238df1d62b129`.

**Evidence state**:
- Source: merged via PR #636; only `README.md` and this existing changelog lane changed. Runtime, workflows, gates and dependencies are preserved.
- Checks: existing automatic [PR CI 37660501393](https://github.com/HomenShum/NodeBenchAI/actions/runs/37660501393) on head `c431d01e5b981b88155e7fea50a2f3f242a9bfc5` and [main CI 37662046791](https://github.com/HomenShum/NodeBenchAI/actions/runs/37662046791) on canonical `ef159cce60b9fc6616de3fa455e238df1d62b129` passed: 37 source citations, app/Convex typechecks, 20 workflow-contract scenarios, 406 Vitest tests in 28 files, 37 Chromium launch cases and Build. The tested PR tree matches the canonical source tree. No local checks, manual CI rerun, new full-stack quality evaluation, or matched architecture comparison ran.
- Baseline limits: main `80853f0c418fc77e9621f27be22840d9fca48d56` [CI 37604577354](https://github.com/HomenShum/NodeBenchAI/actions/runs/37604577354) reported its scoped gates passing. [Pipeline job 112738741012](https://github.com/HomenShum/NodeBenchAI/actions/runs/37605136749/job/112738741012) passed 11 runner scenarios, then blocked before evaluating golden queries because the response exceeded 65536 bytes. The [committed full-stack summary](../../docs/architecture/benchmarks/full-stack-eval-latest.md) is dated April 23, records skipped phases and remains `demo_candidate`. These observations do not establish current full application readiness.
- Current Pipeline gates: on the same canonical commit, automatically triggered [job 112933155208](https://github.com/HomenShum/NodeBenchAI/actions/runs/37662427949/job/112933155208) and [job 112934209245](https://github.com/HomenShum/NodeBenchAI/actions/runs/37662741838/job/112934209245) each passed 11 runner-contract scenarios, then failed health preflight with `Response exceeds 65536 byte limit`. Both explicitly evaluated zero golden queries. The scoped CI pass does not make all checks green.
- Visual proof: not recorded; no visual or responsive grade asserted.
- Preview: [Tier B 37660501405](https://github.com/HomenShum/NodeBenchAI/actions/runs/37660501405) passed by the existing documentation-only applicability skip: `preview_status=not_resolved`, no preview URL, no Tier B browser regression. The PR head's Vercel success status was an ignored-build cancellation; no new preview is asserted.
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
