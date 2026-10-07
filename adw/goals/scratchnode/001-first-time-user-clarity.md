# Goal: ScratchNode Live first-time user clarity in <10s

Improve ScratchNode Live so that a first-time guest who lands on `scratchnode.live/e/<event>` with
no context understands, in under 10 seconds: (1) what event they're in, (2) how to chat, (3) how to
ask the agent, (4) whether they're public or private, (5) where the answer goes afterward.

- **status:** proposed
- **surface:** scratchnode
- **owner/agent:** (unassigned — founder to approve)

## Scope
- **Files/surfaces allowed:** `public/proto/home-v5.html` (composer `#ci`, feed, `.ans` answer cards, event-strip, private-mode badge, `/ask` helpline, landing)
- **Files/surfaces forbidden:** any new top-level surface; any sidebar; the live send/render path + `seenIds` dedup; backend/Convex
- **User flow being improved:** join → first chat / first `/ask` (the top of the core loop)
- **Product invariant that must NOT break:** private notes never enter the public feed; public `/ask` never includes private notes; normal chat never invokes the agent

## Definition of done
- [ ] Browser-reviewable: 5-second comprehension test passes for a cold user (screenshot)
- [ ] `tsc`/inline-scripts parse + e2e `home-v5-output-contract` + `scratchnode-live-route-honesty` green
- [ ] Playwright desktop + mobile 375px (no overflow) + reduced-motion captured
- [ ] CHANGELOG/pages/proto-home-v5 entry; known gaps listed

## Constraints
- No new surface, no sidebar. Don't break private-note behavior (private send must resolve before any public feed insert).
- Clarity via copy + hierarchy, not new chrome.

## Notes
- Fan-out: ScratchNode-UX (copy/hierarchy) · Frontend-Impl (composer/feed patch) · Privacy/Safety (private-mode return-before-public-insert) · QA (5-click flow) · Docs.
- known gaps: TBD by review
- next goal: 002 — private-note anchors clarity
