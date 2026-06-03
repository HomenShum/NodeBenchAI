# `convex/events.ts`

Append-only lane for the ScratchNode live-event backend (rooms, membership, door
policy, /ask answers, and the published wiki). Newest entries on top.

## 2026-06-03 — Public wiki read: `getPublishedWikiBySlug` (the shareable artifact)
Added the PUBLIC, no-account query behind the shareable wiki at
`scratchnode.live/wiki/<slug>` — the viral payoff of "the room remembers
everything." Anyone with the link reads the published event wiki without joining
or authenticating.

`getPublishedWikiBySlug({ slug })`:
- Resolves by slug **or** room code (reuses `resolveEventBySlugOrRoomCode`, the same
  resolver the room uses), so any shareable identifier works.
- Returns ONLY the latest **published** version — drafts and unpublished events
  return `null` (HONEST: never a fabricated/empty wiki).
- Returns only public-safe fields: `{ eventName, eventSlug, roomCode, eventStatus,
  title, bodyHtml, version, publishedAt }` — never the host `ownerKey` or internal
  `sourceIds` / `sourceAnswerIds`.
- Privacy: `bodyHtml` is already public-safe — `buildWikiHtml` (publishWiki) builds
  it from public sources + promoted /ask answers only; private notes are excluded
  at publish time, so there is nothing private to leak at read time.
- Bounded: single-row `by_event_status` index scan.

Covered by 6 convex-test scenarios in `convex/__tests__/scratchnode.publicWiki.test.ts`
(friend opens shared link → reads it; resolves by room code; serves the latest of
several versions; unpublished → null; draft never served; nonexistent slug → null;
and asserts the host ownerKey + internal ids are never returned). 6/6 green.

Additive backend only — the `/wiki/<slug>` reader UI that consumes this ships
separately (backend-first per `backend_contract_migration`).

**Commit**: `this commit`. **Author**: Homen Shum + Claude.
