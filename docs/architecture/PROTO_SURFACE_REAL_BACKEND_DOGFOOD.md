# Proto Surface Real Backend Dogfood

Last updated: 2026-05-28

This note removes the recurring confusion between the two prototype surfaces.

## Route Ownership

| Surface | Route | Backend status | Test expectation |
| --- | --- | --- | --- |
| ScratchNode v5 landing | `https://scratchnode.live/`, `/index.html` | Landing-only shell. It must not auto-run demos and must not bootstrap Convex. | Must prove stale demo URLs like `?demo=1#demo` still render landing-only state. |
| ScratchNode v5 event room | `https://scratchnode.live/e/:slug` | Live Convex-backed event room. Phases 1-5 are wired, and `/ask` now uses the provider-ready `events:askAgent` action with deterministic fallback. | Must prove data moves browser -> Convex -> second browser or rendered answer/wiki/note. |
| ScratchNode v5 demo | `https://scratchnode.live/demo_ver{N}` | Scripted story-teller route only. No live Convex join. | Must prove `runDemoFull()` autoplays only on this owned route family. |
| NodeBench v4 | `https://www.nodebenchai.com/proto/home-v4.html` | Static spec proof for notebook, artifacts, chat, mentions, backlinks, wide mode. | Must prove every interaction works, and must explicitly assert no live Convex runtime marker exists. |

## Live Dogfood Command

Run the production dogfood only intentionally because it writes QA rows to the public demo event.

```powershell
npm run dogfood:proto-live-backend
```

Override targets when needed:

```powershell
$env:SCRATCHNODE_APEX_URL="https://scratchnode.live/"
$env:SCRATCHNODE_EVENT_URL="https://scratchnode.live/e/ai-infra-summit-2026"
$env:NODEBENCH_V4_URL="https://www.nodebenchai.com/proto/home-v4.html"
npm run dogfood:proto-live-backend
```

The raw Playwright file is:

```text
tests/e2e/proto-live-backend-dogfood.spec.ts
```

## Covered v5 Backend Scenarios

The dogfood covers these live boundaries:

1. Apex `scratchnode.live/` serves the `home-v5` landing shell only: no demo autoplay, no `data-sn-live`, and stale `?demo=1#demo` values are ignored.
2. `/e/ai-infra-summit-2026` serves the live Convex-backed event room.
3. Two anonymous browser contexts join the same event.
4. Public chat from browser A appears in browser B through `events:sendMessage` and `events:getMessages`.
5. `/ask` creates a sourced answer through `events:askAgent`, falling back to `events:composeAnswer` only when Convex actions are unavailable.
6. The rendered answer exposes:
   - source reuse
   - provider or deterministic-fallback trace
   - answer quality gate score
   - model/cost metadata when the provider path runs
   - `no private notes`
   - `data-answer-id`
7. FAQ suggestion changes answer state through `events:suggestAnswerForFaq`.
8. Host claim is attempted through `events:claimHost`.
9. If the shared demo room is claimable, the run also promotes the answer and publishes the wiki through:
   - `events:promoteAnswerToFaq`
   - `events:publishWiki`
   - `events:getPublishedWiki`
10. If the room is already claimed, the run verifies the expected host gate instead of pretending publish happened.
11. Private composer mode creates a Convex-backed note through `notes:createNote`.
12. Pin and delete use `notes:togglePin` and `notes:deleteNote`.
13. Private note text is asserted absent from:
   - public event feed
   - second anonymous browser

## Covered v4 Prototype Scenarios

The dogfood covers these static interactions:

1. `switchMode("notebook")`
2. `switchMode("artifacts")`
3. artifact card rendering
4. `switchMode("chat")`
5. chat mock response pipeline
6. mention context update through `openMentionById`
7. backlink drawer through `openBacklinks`
8. inline expansion through `toggleRefExpand`
9. wide mode toggle

It also asserts:

```text
document.body.dataset.snLive is absent
window._sn_live is absent
no Convex live runtime script is present
```

That is intentional. `home-v4` is the comprehensive design/spec surface. `home-v5` is the live backend product surface.

## Artifacts

Screenshots from the run are written to:

```text
.tmp/proto-live-backend-dogfood/
```

These files are not committed. They are operator evidence for the current dogfood loop.

## Remaining Boundary

The shared production demo event can only have one host owner. If a previous live dogfood or user has already claimed the room, a later run must verify the host gate and skip promote/publish writes. A future improvement is a host-authenticated seed route for isolated dogfood rooms, but that should not be added as an unauthenticated public mutation.

## Apex Routing Note

`home-v5.html` now treats `scratchnode.live/` and `scratchnode.live/index.html` as landing-only routes. Live Convex boot is owned by explicit `/e/:slug` event routes. Scripted demo autoplay is owned only by `/demo_ver{N}` routes, so old `?demo=1` or `#demo` URLs cannot turn the public landing page or event room into a demo run.
