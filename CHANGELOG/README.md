# Changelog Lanes

This directory contains append-only per-surface changelog lanes. Each lane records user-visible changes for one page, component, server module, integration, script, or data surface so the next maintainer can understand a surface without reading the full git history.

## Lanes

### Pages and prototypes

- [`pages/proto-home-v5.md`](pages/proto-home-v5.md) — ScratchNode live-event prototype at `public/proto/home-v5.html`.
- [`pages/convex-events.md`](pages/convex-events.md) — ScratchNode live-event backend surface.
- [`pages/linkedin-daily-brief.md`](pages/linkedin-daily-brief.md) — LinkedIn daily-brief pipeline.
- [`pages/scratchnode-nodebench-bridge.md`](pages/scratchnode-nodebench-bridge.md) — ScratchNode-to-NodeBench bridge.

### Components

- [`components/fast-agent-panel.md`](components/fast-agent-panel.md) — FastAgentPanel AI Elements cutovers and preserved behavior seams.

### Integrations

- [`integrations/ai-elements.md`](integrations/ai-elements.md) — Vercel AI Elements scaffold, adapter, and governance integration.

### Build and bundling

- [`build/vite.md`](build/vite.md) — Vite/PWA chunking rules that affect runtime delivery.

### Scripts and operating systems

- [`scripts/improvement-loop.md`](scripts/improvement-loop.md) — self-improvement loop tooling.
- [`goals.md`](goals.md) — goal-driven development operating system.

## Format

Use the template in [`TEMPLATE.md`](TEMPLATE.md). Prepend new entries at the top
of the relevant lane. Cross-link every affected lane for a multi-surface change.
Use the canonical squash SHA from `origin/main`; if it does not exist yet, use
the template's explicit pending marker and replace it before the final release
commit. Source, checks, visual proof, preview, and production-live state are
separate claims.
