# Agents Hub

Append-only lane for the `/agents` hub, its primary command path, topic list, and responsive hub navigation. Newest entries first.

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
