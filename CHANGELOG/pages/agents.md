# Agents Hub

Append-only lane for the `/agents` hub, its primary command path, topic list, and responsive hub navigation. Newest entries first.

## 2026-07-15 — Focus the Agents hub on work the user can control

The pending candidate keeps the composer, explicit `/spawn` path, running swarms, approvals, runtime topic rows, and trace links as the primary controls. It removes signed-out exposure of private task history, hardcoded agent or savings metrics, response-shape confidence labels, and client-callable fixture seeds; defers operator tooling behind an advanced disclosure; distinguishes loading and unmeasured state from zero; and reports stale health as unknown rather than healthy. Task sessions, traces, spans, decisions, verifications, evidence, approvals, swarm records, and swarm tasks require authenticated ownership, while raw orchestrator writes and secret-gated service calls use internal owner-checked contracts. The unreachable parallel timeline, kanban, hook, and public orchestrator are gone; due diligence keeps only four bounded, owner-chain-checked internal task mutations. Unused public due-diligence, investor, demo, and evaluation functions were internalized or deleted, and retained job, branch, memo, and executor error writes revalidate exact ownership. Verifier outages remain unavailable instead of being converted into a passing score. Server-confirmed viewers, admins, and owners may read operator health; only admins and owners may run maintenance.

**PR / canonical main commit**: #541 / `15eb9a0a`; strict session rollout #542 / `16d3ceeb`; live-verifier alignment #543 / `56d8413a`.

**Evidence state**:
- Source: merged to `main` through CI-gated squash PRs #541, #542, and #543.
- Checks: required Typecheck, Runtime smoke, Build, and Tier B checks passed on all three PRs; source CI `29474652151`, strict-rollout CI `29475282082`, and verifier CI `29475698322`.
- Visual proof: private responsive/theme artifacts remain outside git; the production exact/mobile/product/one-flow matrix passed all 17 assertions, with one blank mobile navigation transient passing on immediate isolated rerun.
- Preview: #541 exact-head preview `nodebench-2otgtyneq-hshum2018-gmailcoms-projects.vercel.app` passed Tier B run `29474652192`; #542 preview `nodebench-iwmpxngv3-hshum2018-gmailcoms-projects.vercel.app` passed `29475281999`.
- Production live: Vercel main deploy verification run `29475582335` and Convex deploy `29475582657` passed for strict SHA `16d3ceeb`; canonical `https://www.nodebenchai.com` passed the runtime-grounded production matrix and automated Post-Deploy Verify run `29476029941`.

**Author**: Homen Shum + Codex.
**Touches**: [`../components/fast-agent-panel.md`](../components/fast-agent-panel.md), [`exact-cockpit.md`](exact-cockpit.md), and [`../integrations/pipeline-runtime.md`](../integrations/pipeline-runtime.md).

## 2026-07-14 — Make the Agents hub action-first

Ordinary prompts now open the canonical FastAgent chat while `/spawn` remains the explicit swarm path. The hub shows recorded topic fields instead of fabricated narrative metrics, defers suggestions, removes dead controls, and uses a reachable native selector for the mobile hub rail.

**PR / canonical main commit**: #533 / `655d1556`.

**Evidence state**:
- Source: merged to `main`.
- Checks: Typecheck, Runtime smoke, Build, and the PR-associated Tier B preview gate passed; main CI run `29393842917` also passed.
- Visual proof: private local responsive/theme captures were independently reviewed. Sanitized preview and production DOM sweeps confirmed the removed copy and controls stay absent, desktop tabs collapse into one mobile chooser, and the six-row topic region is 689 CSS px at 375x812 with no horizontal overflow.
- Preview: exact-head `549e5895` deployment `5452564772` reached READY; Tier B run `29393537476` passed.
- Production live: deployment `dpl_CjV1PkzsMKK9c3Le3p1jcWpWJW9K` reached READY on `www.nodebenchai.com`; production Post-Deploy Verify runs `29393958512` and `29394068684`, `post-deploy:verify`, and the nine-test live smoke passed. One plain prompt opened the canonical AI Chat Panel with one user message, one quota-gated assistant response, no swarm indicator, and no duplicate send; the anonymous quota gate prevented an exact model-token assertion.

**Author**: Homen Shum + Codex.
**Touches**: [`../components/fast-agent-panel.md`](../components/fast-agent-panel.md).
