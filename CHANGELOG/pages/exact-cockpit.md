# Exact Cockpit

Append-only lane for the deployed five-surface web cockpit: `Home`, `Reports`,
`Chat`, `Inbox`, and `Me`. Workspace remains a separate deployed surface.
Newest entries first.

## 2026-07-15 — Replace cockpit fixtures with runtime truth

The pending candidate removes named report, inbox, identity, plan, usage, vanity-metric, mobile-answer, and developer-terminal fixtures from reachable product paths. Authenticated Home users start the real background workflow; guests receive a sign-in gate that preserves the typed or scenario query through the return URL. Reports renders stored owner-scoped reports and pipeline activity, Chat uses one runtime-backed implementation across desktop and mobile, Inbox mutates live owned nudges with visible failure handling, and Me labels missing account data honestly; loading, empty, and not-found states no longer fall through to sample companies or canned results. Desktop and mobile Inbox and Me now reuse the same runtime-backed component trees, deleting the duplicate unreachable queue/profile renders and their hard-coded plan, usage, connector, local-draft, and toast-only controls. The cockpit Chat header now contains only a truthful title and its real search action instead of unwired thread/share/model controls, connection copy and color agree across offline/loading/degraded/authenticated/guest states, and Command Palette search/document actions target the canonical composer and document event. Approval responses and cancellations expose backend failures beside the affected request and preserve typed text for retry instead of failing silently.

**PR / canonical main commit**: #541 / `15eb9a0a`; strict session rollout #542 / `16d3ceeb`; live-verifier alignment #543 / `56d8413a`.

**Evidence state**:
- Source: merged to `main` through CI-gated squash PRs #541, #542, and #543.
- Checks: required Typecheck, Runtime smoke, Build, and Tier B checks passed on all three PRs; source CI `29474652151`, strict-rollout CI `29475282082`, and verifier CI `29475698322`.
- Visual proof: private responsive/theme artifacts remain outside git; the production exact/mobile/product/one-flow matrix passed all 17 assertions, with one blank mobile navigation transient passing on immediate isolated rerun.
- Preview: #541 exact-head preview `nodebench-2otgtyneq-hshum2018-gmailcoms-projects.vercel.app` passed Tier B run `29474652192`; #542 preview `nodebench-iwmpxngv3-hshum2018-gmailcoms-projects.vercel.app` passed `29475281999`.
- Production live: Vercel main deploy verification run `29475582335` and Convex deploy `29475582657` passed for strict SHA `16d3ceeb`; canonical `https://www.nodebenchai.com` passed the runtime-grounded production matrix and automated Post-Deploy Verify run `29476029941`.

**Author**: Homen Shum + Codex.
**Touches**: [`agents.md`](agents.md), [`../components/fast-agent-panel.md`](../components/fast-agent-panel.md), and [`../integrations/pipeline-runtime.md`](../integrations/pipeline-runtime.md).
