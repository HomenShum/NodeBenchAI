# ScratchNode → NodeBench bridge

Append-only lane for the conversion bridge from the disposable ScratchNode live-event
room into the NodeBench app. Newest entries on top.

## 2026-06-03 — Make the bridge REAL: a `/events/:slug/wiki` receiving route
The bridge was broken end-to-end. ScratchNode sent users to
`nodebenchai.com/events/<slug>/wiki`, but the `/events` matcher in `src/App.tsx`
(`^/events/([^/]+)/?$`) **rejects trailing segments**, so the handoff **404'd** and
fell through to the generic cockpit. No surface read the `source=scratchnode` / `room`
params; the flashy "Now in NodeBench" overlay was hidden demo theater. That's why the
ScratchNode wiki reader shipped *without* a "Continue in NodeBench" CTA — pointing at a
404 would violate HONEST_STATUS.

This builds the real receiving surface:
- **`ScratchnodeWikiBridge`** (`src/features/events/views/ScratchnodeWikiBridge.tsx`) —
  reads the slug (+ optional `source`/`room` query params), loads the PUBLIC, no-account
  `events:getPublishedWikiBySlug`, and renders the published recap **inside the NodeBench
  shell** with a conversion frame ("Keep this in NodeBench" → `Explore NodeBench`, plus
  "View the public wiki" / "Open in ScratchNode" paths back). No cross-domain session is
  needed — the slug is in the URL and the query is public.
- **Route wired in `src/App.tsx`** — `/events/:slug/wiki` is matched **above** the
  single-segment `/events/:eventId` route so the trailing `/wiki` is captured first (the
  exact bug that 404'd before).
- **Honesty + security** — unpublished / unknown slug → a real empty state (never a
  fabricated recap); loading → a real loading state. `bodyHtml` is server-public-safe
  (private notes excluded at publish) **and** DOMPurify-sanitized before render (defense
  in depth against XSS in the main app).

Covered by `ScratchnodeWikiBridge.test.tsx` (4 cases: published render + NodeBench CTA +
reverse paths; unpublished → honest empty; loading; and a sanitization case asserting a
`<script>` + `onerror` handler in `bodyHtml` never reach the DOM). 4/4 green; full-project
tsc clean.

Route-first: this ships before the ScratchNode wiki reader's "Continue in NodeBench" CTA
is re-added, so the CTA can never dead-end. Deeper event→workspace *data carryover*
(messages/entities/follow-ups into a NodeBench workspace) remains a follow-up.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.
