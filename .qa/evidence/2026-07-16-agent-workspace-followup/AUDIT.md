# Agent Workspace Follow-up Sweep — Evidence Audit

Date: 2026-07-16
Branch: `feat/agent-workspace-followup`
Base: `origin/main` at `e69bceede3ae87ad7a132a99c5534c4180f1fbd6`
Mode: sandbox implementation, production read-only verification after merge

## Outcome

The production Chat surface now presents one primary workspace instead of a prototype three-column shell. It contains no seeded conversation, hard-coded thread rail, eager execution inspector, inferred freshness, fixture working notes, or global next-action strip.

The transcript uses the repo's shared AI Elements `Conversation`, `ConversationContent`, and `ConversationScrollButton` primitives. The transcript and composer are explicit grid rows, so the composer no longer overlays or clips the mobile conversation. Runtime execution/proof UI appears only after a real user prompt, run, or answer exists.

## Before / after

| Concern | Before | After |
| --- | --- | --- |
| Production Chat rails | Prototype left thread rail plus eager right context rail | No left rail; right inspector deferred until real intent/runtime data |
| Empty thread | Seeded prototype conversation and resume affordance | Honest empty state with at most three runtime starter actions |
| Composer geometry | Sticky overlay with hard-coded transcript clearance | Dedicated non-overlapping grid row with safe-area padding |
| Runtime facts | Hash-derived freshness, fixture working notes, synthetic answer/tool/follow-up projections | Only live turn, run, artifact, tool, source, and notebook data |
| Action hierarchy | Header, scope, next actions, rail, and composer competing at idle | Composer/empty state are primary; compact expandable read/write/check contract |
| Implementation | Manual scroll listeners and unseen counters | Shared AI Elements stick-to-bottom mechanics |
| Code surface | Prototype/runtime mixture | Net removal of 474 lines before the scoped stylesheet; chat fixture/prototype logic removed |

The final idle DOM contains 106 visible elements in the 1512×900 audit viewport. The earlier broad clutter baseline was partially blocked by a protected-selector mismatch, so no unsupported before/after element-count percentage is claimed here.

## Verification

- TypeScript: PASS (`npx tsc --noEmit --pretty false`)
- Targeted Vitest: PASS, 70 suites; 254 passed, 19 skipped, 0 failed
- Workspace honesty guard: PASS, 4/4
- FastAgent regression corpus: PASS, including skip-link focus and focus-visible attachment recovery
- Production build: PASS (`npm run build`)
- Design linter: PASS release threshold, 0 high-severity findings; 7,702 existing repo-wide medium/low advisories remain baseline debt
- Pixel gate: PASS at 1512×900 and 390×844, light and dark
- Pixel machine checks: UTF-8, 0 mojibake, 0 console errors, 0 horizontal overflow, required honesty labels present
- Browser geometry: transcript and composer bounding boxes meet without overlap; workspace fills the desktop content pane
- Prettify audit: advisory 9/16; the single WCAG warning was the global top-nav search placeholder and was corrected from `--rd-ink-faint` to `--rd-ink-mute` before release

## Evidence

- `baseline/clutter-audit.json` — partial baseline; protected-selector mismatch documented
- `local/prettify/prettify-audit.json` — visual rubric measurement
- `local/pixels/desktop-light.png`
- `local/pixels/desktop-dark.png`
- `local/pixels/mobile-light.png`
- `local/pixels/mobile-dark.png`
- `FUNCTION_LEDGER.md` — control/function classification

## Release policy

## Release verification

- Pull request: [#547](https://github.com/HomenShum/NodeBenchAI/pull/547)
- Merge: PASS, CI-gated squash auto-merge at `94da3fd622e2016a0da31b0d588bcba58158cdec`
- Required checks: PASS, including Typecheck, Runtime smoke, Build, ScratchNode launch gates, Tier B vs preview URL, Visual QA Gate, Vercel preflight, and pipeline quality benchmark
- Production deployment: PASS, GitHub/Vercel deployment `5471970787` for the exact merge SHA; status `success`
- Post-deploy verification: PASS twice for the exact merge SHA, including final deployment-status run `29492201341`
- Production URL: `https://www.nodebenchai.com/redesign/chat?qa=94da3fd6`
- Serving entry asset: `/assets/index-Cdci2Hpt.js` at final fetch; the same-SHA rollout was first observed as `/assets/index-DQnCQ_nM.js`, both changed from pre-merge `/assets/index-Bu0VO9ll.js`
- Hydrated desktop DOM: PASS at 1440x996; heading and runtime-backed starter actions rendered; no fake thread rail, Add/attachment control, idle inspector, fake metrics, horizontal overflow, or console warning/error
- Hydrated compact DOM: PASS at browser minimum 500x844; no clipped interactive controls, composer overflow, fake rail, Add/attachment control, or idle inspector
- Production was verified read-only. No prompt was submitted and no out-of-band Convex deployment occurred.

## Policy note

No out-of-band Convex deployment is performed. The branch must ship through a normal pull request with CI-gated squash auto-merge, never `--admin`. Production is only considered verified after the merged `main` commit is observed and the live `/redesign/chat` DOM/bundle is fetched.
