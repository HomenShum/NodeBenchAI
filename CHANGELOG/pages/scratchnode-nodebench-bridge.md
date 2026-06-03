# ScratchNode → NodeBench bridge

Append-only lane for the conversion bridge from the disposable ScratchNode live-event
room into the NodeBench app. Newest entries on top.

## 2026-06-03 — Cross-domain PRIVATE-notes bridge: opaque stateful handoff token
The last broken leg of the transition. A guest's private notes are owner-keyed by
their `sn_session_id`, which is origin-partitioned — nodebenchai.com can't read it —
and the notes layer has no auth check, so that session id IS the credential. Shipping
it across the origin boundary would leak a permanent credential into the URL/referer/
logs (the roadmap's #1 risk). This builds the real handoff with an **opaque stateful
token** (founder-chosen).

- **`convex/eventHandoff.ts`** — `mintEventHandoffToken({ slug, sessionId })`
  membership-gates the caller (`liveEventMembers` by_event_session), then snapshots
  THAT member's private notes for THIS event into a token row and returns ONLY a CSPRNG
  opaque token. **The raw session id is never stored** — a full table dump yields no
  credential and no cross-event access, just that event's notes, briefly.
  `consumeEventHandoffToken({ token })` is fail-closed on every check (unknown/expired/
  used-up/scope) and returns only the read-only snapshot. New `liveEventHandoffTokens`
  table: event-scoped, short TTL (10 min), few-use, `boundSessionHash = SHA-256` (one-way).
- **`/events/:slug/private`** route (`src/App.tsx`, above the single-segment matcher) →
  `ScratchnodePrivateBridge` consumes the `?token=`, renders the notes read-only
  (DOMPurify-sanitized) with honest invalid/expired/empty states + a "sign in to keep
  these" CTA, and **never displays or logs the token**.
- **`public/proto/home-v5.html`** — `openNodeBenchPrivateHandoff` now MINTS a token via
  the live client and navigates to `/events/<slug>/private?token=…` (only the opaque
  token travels). Honest fallback to the shipped `/scratchnode-events` surface if minting
  fails (no client / not a member / error) — never a 404, never a forged link. Completes
  the interim retarget from the earlier honesty fix.

Covered by 8 ADVERSARIAL convex-test scenarios (`scratchnode.handoffToken.test.ts`:
non-member can't mint, token never stores/exposes the session id, expired/used-up/forged
all fail closed, cross-event isolation, idempotent reuse) + 5 component tests
(`ScratchnodePrivateBridge.test.tsx`: valid→notes, expired→honest, missing token, empty,
sanitization, token-never-rendered) + an in-page QA check (`SN-LIVE-015b`: only an opaque
token reaches the real route, no session id). 13/13 new + full tsc + build clean.

**Deploy:** HELD until the open Convex-deploy incident (see `AGENT_COORDINATION.md`) is
resolved — it adds functions to the shared deployment Codex's out-of-band deploy is
currently clobbering.

**Commit**: `this commit`. **Author**: Homen Shum + Claude.

## 2026-06-03 — Slice 1: import a published event recap into the WORKSPACE

Lets a visitor import a published ScratchNode event wiki as ONE editable
NodeBench product document under a FRESH NodeBench-origin anonymous product
identity. On later sign-in the EXISTING bootstrap merge path
(`convex/domains/product/bootstrap.ts` → `claimAnonymousProductWorkspace`)
re-owns it from `anon:<sessionId>` to `user:<id>` — no bespoke merge code.

**Backend**

- `convex/events.ts` — added `getPublishedWikiStructuredBySlug({ slug })` plus the
  shared reader `loadStructuredPublishedWiki(ctx, slug)`. Returns the SAME
  published snapshot as `getPublishedWikiBySlug`, but STRUCTURED
  (`{ eventId, slug, eventName, roomCode, wikiVersion, answers:[{question,body}],
  sources:[{title,uri,excerpt}] }`) so the importer builds editable blocks with
  no HTML round-trip. PUBLISHED-only; private notes are excluded at publish time,
  so there is nothing private to read here. BOUND: answers ≤ 20, sources ≤ 20.
- `convex/domains/product/scratchnodeImport.ts` (new):
  - `importPublishedWiki({ slug, anonymousSessionId })` — resolves the anon (or
    signed-in) product identity, reads the published structured wiki, and
    materializes ONE `entity_memory` product document (title `"<eventName> —
    recap"`, body = Q&A + sources blocks) plus the canonical event entity
    (`entityType: "event"`, owner-private). Reuses the existing
    `productDocuments`/`productDocumentBlocks`/`productDocumentSnapshots`
    primitives — no parallel doc system.
  - Idempotent: stable entity slug `scratchnode-event-<hash(eventId)>` maps every
    re-import of the same event to the same document; a per-import key
    `hash(eventId|wikiVersion|ownerKey)` makes a re-import of the SAME published
    version a no-op (`alreadyImported:true`), and a NEWER published version writes
    a fresh revision/snapshot on the same document (no duplicate).
  - `getScratchnodeImportStatus({ slug, anonymousSessionId })` — read-only state
    (`published` / `imported` / `upToDate` / `entitySlug`) for an honest UI.
  - Returns `{ ok, documentId, entitySlug, created, alreadyImported }`. Honest
    no-op (`ok:false, reason:"no_published_wiki"`) on draft / unpublished /
    unknown slug — never a fabricated empty recap.
  - No fuzzy company/person extraction (avoids fabricated entities) — deferred.

**Frontend**

- `src/features/redesign/surfaces/ScratchnodeEventsSurface.tsx` — each event row
  gains an "Import this recap into NodeBench" action via the new
  `ImportRecapButton`. It only renders when a PUBLISHED wiki actually exists
  (gated on `getScratchnodeImportStatus.published`), imports under the FRESH
  NodeBench product anon identity (`getAnonymousProductSessionId`, NOT the
  cross-domain `sn_session_id`), shows real importing/done/error states, and
  links to the created recap at `/entity/<entitySlug>`. The existing "Open in
  ScratchNode" CTA is untouched. `(api as any)` mirrors the surface's existing
  codegen-independent call style.

**Reliability (agentic_reliability 8-point)**: BOUND (all reads ≤ 25), HONEST_STATUS
(no fake success; throws on entity-create failure), BOUND_READ (dangling ids
skipped, text sliced to caps), DETERMINISTIC (FNV-1a hash, stable block ids /
entity slug / import key). No external fetch, so SSRF/TIMEOUT are N/A.

**Privacy**: PUBLIC-DATA-ONLY. The importer reads only the published wiki snapshot
via `loadStructuredPublishedWiki`; it never reads or writes `userNotes` /
`liveEventNoteAnchors`, and never writes under another user's owner key.

Covered by 11 convex-test scenarios in
`convex/domains/product/scratchnodeImport.test.ts`: happy import (editable doc +
event entity), re-import idempotency (no dup), re-publish → new revision,
unpublished / draft / unknown → honest no-op, a PRIVACY test proving a private
note marker never reaches the imported document, plus status-query and
structured-read coverage. 11/11 green; `tsc --noEmit` clean.

**Commit**: `this commit`. **Author**: Homen Shum + Claude (agent build).

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
