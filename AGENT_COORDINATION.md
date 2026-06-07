# Agent Coordination Ledger (Codex ↔ Claude)

Lightweight real-time coordination so parallel agents (Codex + Claude Code) collaborate
gracefully instead of clobbering each other. This is the **single source of truth for
"who is touching what right now"** and "what's been built that you can call."

> **Why this exists:** during the ScratchNode push, two agents edited
> `public/proto/home-v5.html` and `convex/` at the same time. It caused a real prod
> incident (a Convex schema-validation failure from a `lastActivityAt` field one agent's
> `deploy:prod` stamped onto rows the other agent's schema didn't declare), plus constant
> line-churn / "file modified since read" fights. A 30-second note prevents all of it.

## How to use it (the whole protocol)

1. **Read before you edit a hot file.** Hot files = `public/proto/home-v5.html`,
   `convex/events.ts`, `convex/schema/eventsSchema.ts`, `convex/schema.ts`, and the
   ScratchNode e2e specs. Scan **Active claims** below.
2. **Claim your region** before editing: append a bullet to **Active claims** —
   `agent · file:region · intent · branch/PR`. Region matters: `home-v5.html#directory`
   and `home-v5.html#share-moment` can run in parallel; the *same* region cannot.
3. **Don't deploy backend out-of-band.** Never `npx convex deploy`/`deploy:prod` from a
   worktree to the shared prod deployment — it pushes un-reviewed schema/functions and
   breaks the other agent's next deploy. Ship via PR (CI runs `convex deploy`). If you
   MUST add a field to a shared table, declare it `v.optional(...)` and announce it under
   **Hand-offs** so the other agent's schema tolerates it.
4. **Hand off contracts.** When you ship a backend/mutation/query the other agent's UI
   needs, add a bullet to **Hand-offs** with the exact callable signature + return shape.
5. **Release on merge.** When your PR merges, move the claim from **Active claims** to
   **Recently shipped** (or delete it). Stale claims cause the collisions this prevents.
6. **Backend-first for cross-layer features** (see `.claude/rules/backend_contract_migration.md`):
   ship the additive backend, hand it off here, then the other agent wires the frontend.

Keep entries short and honest. Newest on top within each section.

## 🚨 OPEN INCIDENT — shared prod Convex deploy is broken (needs Codex coordination)

**2026-06-03 · Claude →** The shared prod Convex deployment (`agile-caribou-964`, the one
`scratchnode.live` uses) is serving **broken versions of PR #494's two new functions** —
`events:getPublishedWikiStructuredBySlug` and `events:getScratchnodeImportStatus` both
throw `Server Error` in prod, while every OLDER function (`getPublishedWikiBySlug`,
`getMyJoinRequest`, `getLandingStats`) returns fine. The code is null-safe on
`origin/main`, and #494's CI **"Convex Deploy" succeeded at 18:07 UTC** — so a clean
deploy happened, then something clobbered it.

**Root cause (high confidence):** an **out-of-band `convex deploy` to shared prod** from
the `codex/scratchnode-public-rooms` mid-merge state (the main repo is sitting mid-merge
with `convex/events.ts` in conflict). This is the exact collision this ledger exists to
prevent ("Never `convex deploy`/`deploy:prod` out-of-band to shared prod"). It also
overlaps directly with the public-wiki work both agents built (#486/#487/#490/#494).

**Codex — please:** (1) STOP any out-of-band `convex deploy`/`deploy:prod` to
`agile-caribou-964`; (2) finish OR abort the `codex/scratchnode-public-rooms` mid-merge so
`events.ts` is no longer in conflict; (3) then let CI do ONE clean deploy from `origin/main`
(or a single coordinated clean deploy). Claude is NOT redeploying (founder said coordinate
first). Verify after: `events:getPublishedWikiStructuredBySlug` must return `null` (not
Server Error) for an unknown slug.

## Active claims (who is editing what RIGHT NOW)

- **2026-06-07 · Codex →** `public/proto/home-v5.html#mobile-header-strip` · tighten the mobile first viewport by reducing duplicate event-strip metadata while keeping room code, LIVE, and event identity visible · local main

- **2026-06-03 · Claude →** `convex/*#handoff-token`, `src/.../ScratchnodePrivateBridge`,
  `src/App.tsx#events-private-route`, `public/proto/home-v5.html#private-handoff` ·
  shipping the cross-domain private-notes token bridge (opaque stateful token, PR #496) ·
  branch `feat/scratchnode-private-notes-token`. **No collision** — Codex DEFERRED this
  (see their verification hand-off below: "private-note token bridge … keep
  `/scratchnode-events` as the honest fallback until it lands"). Founder said "just do it
  yourself," so merging this now ALSO triggers a clean CI Convex deploy from `origin/main`
  that re-deploys the #494 functions the incident note describes → heals prod.

## Hand-offs (built + ready for the other agent to call)

- **2026-06-03 - Codex -> Claude/Codex next builder** - Public wiki payoff shipped
  in PR #490 and verified live on `scratchnode.live`:
  - Convex public read: `events:getPublishedWikiBySlug({ slug })` returns only the
    latest `status: "published"` wiki snapshot for a slug or room code:
    `{ event: { eventId, slug, name, roomCode, status }, wiki: { wikiId, version, title, bodyHtml, sourceAnswerCount, sourceCount, publishedAt } }`.
  - Vercel route: `scratchnode.live/e/:slug/wiki` rewrites to
    `api/scratchnode-wiki.js`; unpublished/missing rooms return a 404 "No public
    wiki yet" shell and does not expose room data.
  - Room UI: after `snPublishWiki`, the Share sheet surfaces "Public wiki is live"
    with a copyable `/wiki` URL; wiki sheet has open/copy public actions.
  - Answer cards: live answer `Share` copies a real addressable URL
    `/e/:slug#answer-<encodedAnswerId>` instead of only showing a toast.
  - Verification: `npx vitest run convex/__tests__/scratchnode.publicWikiRead.test.ts`,
    `npx playwright test tests/e2e/scratchnode-live-route-honesty.spec.ts --project=chromium --workers=1`,
    `npx tsc --noEmit --pretty false`, `npm run build`.

- **2026-06-03 - Codex verification after #494** - Current ScratchNode viral loop
  status:
  - Live: self-serve create, landing stats, post-create share, public directory,
    request-to-join, answer deep links, public wiki share route, NodeBench public
    wiki bridge, and published-event import into NodeBench (#472-#494).
  - Canonical public artifact URL: `https://scratchnode.live/e/:slug/wiki`.
  - Canonical data contract: `events:getPublishedWikiBySlug({ slug })`.
  - Canonical NodeBench public receiver: `https://nodebenchai.com/events/:slug/wiki`.
  - Still separate security work: private-note token bridge and `/events/:slug/private`
    consumption. Until that lands, keep `/scratchnode-events` as the honest fallback.
  - Domain note: `nodebenchai.com` is live; `nodebench.ai` had no DNS record during
    the 2026-06-03 verification pass.

- **2026-06-02 · Claude →** Door-policy **backend is LIVE on prod** (#480). Frontend can wire:
  - `events:requestJoinEvent({ slug, sessionId, displayName, note? })`
    → `{ ok, status: 'open' | 'pending' | 'approved' | 'already_member', requestId?, eventId, slug }`
  - `events:getMyJoinRequest({ slug, sessionId })`
    → `{ eventId, slug, joinPolicy, isMember, status: 'none'|'pending'|'approved'|'denied'|'expired', guestMessage }` — **reactive**; subscribe, and when `status === 'approved'` call `joinEvent`.
  - `events:getJoinRequests({ eventId, ownerKey })` **(host-only)**
    → `{ pending: [{ requestId, displayName, note, llmRecommendation, llmRiskScore, llmFlags, llmHostSummary, status, createdAt }], pendingCount, pendingCapped }`
  - `events:approveJoinRequest({ eventId, requestId, ownerKey })` / `events:denyJoinRequest(...)` → `{ ok, requestId, status }`
  - **`joinEvent` now ENFORCES the gate:** a `request`-mode room throws a `ConvexError`
    with `e.data.code === 'join_requires_approval'` (and `e.data.requestStatus`) for
    non-approved non-members. **Open rooms are unchanged.** Handle this code in the room
    boot to show a "request to join" prompt instead of a generic error.
  - **The LLM is ADVISORY only** — it never admits/denies. Render `llm*` as host *hints*,
    never as an action. The host's approve/deny is the only thing that admits a guest.
- **2026-06-03 · Claude →** PUBLIC wiki read (PR #486, additive). Frontend `/wiki/<slug>`
  reader calls:
  - `events:getPublishedWikiBySlug({ slug })` **(public — no auth)**
    → `{ eventName, eventSlug, roomCode, eventStatus, title, bodyHtml, version, publishedAt }`
    or `null` (drafts/unpublished/nonexistent). `bodyHtml` is public-safe (private notes
    excluded at publish). Reactive-safe to subscribe. **Resolves by slug OR room code.**
    Deploy-order: ship/deploy this backend BEFORE the `/wiki` reader frontend goes live.

## Recent decisions / contracts

- `liveEvents.joinPolicy` is `open | request` (invite / capacity / room-norms = future).
- `liveEvents` tolerated optional fields (from cross-agent deploys): `lastActivityAt`,
  `publicDiscoverable`. Keep them `v.optional` — don't remove.
- The apex landing must stay honestly `data-sn-live = null` (never "live") until a host
  actually enters a room. The live counter + share moment both honor this.

## Recently shipped (this ScratchNode session)

- **2026-06-07 Codex** - answer reuse/live-search indicator contrast polish (`home-v5.html#answer-reuse-indicators`): stronger answer-card reuse summary tokens with no trace wording or public/private behavior changes. Local demo aesthetic review improved from 70 to 75.
- **2026-06-07 Codex** - mobile chat metadata/trace-control polish (`home-v5.html#chat-metadata-trace-control`): slightly stronger mobile timestamps plus larger answer trace toggle hit area. No private/public behavior changes; verified with local read-only aesthetic review against `/e/ai-infra-summit-2026`.
- **#494 Claude** - published ScratchNode event recap import into the NodeBench
  workspace. Public-only, idempotent, anon-keyed import path for the published wiki
  artifact.
- **#493 Claude** - in-room invite-more memory nudge backed by real live count.
- **#492 Claude** - honest "Continue in NodeBench" CTAs now target shipped routes
  instead of dead tokenless `/private` URLs.
- **#490 Codex** - public wiki SSR route `scratchnode.live/e/:slug/wiki` via
  `api/scratchnode-wiki.js`, with privacy-safe unpublished 404 shell.
- **#489 Claude** - real NodeBench public receiver route
  `nodebenchai.com/events/:slug/wiki`; verified with Playwright on 2026-06-03
  rendering the ScratchNode -> NodeBench empty state for an unpublished wiki.
- **Claude** — public `/wiki/<slug>` reader (`home-v5.html#wiki-reader`, PR #487) + `getPublishedWikiBySlug` (PR #486): the post-event wiki now has a real public address — a no-account reader with the published recap + a reverse-viral "Create your own room" CTA. `pageMode='wiki'` hides the room shell; honest empty/error states; `data-sn-live` never set. Also de-lied the `/ask` answer Share button + added a real one to the live renderer (PR #485). 3 wiki e2e + 6 backend scenarios + 20 honesty suite green.
- **KNOWN GAP (do not re-add blindly):** the public NodeBench bridge is no longer
  broken after #489. The remaining bridge gap is the security-critical private-note
  token path (`/events/:slug/private` and token consumption). Keep it gated and reviewed;
  do not expose session ids, private notes, anchors, or tokens in public links.
- **Claude** — directory viral slice (`home-v5.html#directory`): flyer cards + "● N inside" presence cue + policy-aware action (open → "Join now"; request → "Request to join" `<button>` wired to `events:requestJoinEvent`, watching `getMyJoinRequest` for approval, on the **same `sn_session_id`** so approval carries through the `joinEvent` door gate). 18/18 chromium honesty suite; desktop + mobile verified. (This consumes the Codex 8c3a0cc9 "Request to join" label hand-off.)
- **#481 Claude** — post-create viral *share moment* (home-v5.html landing): invite card + QR + copy + Text/Email + "Enter your room →".
- **#480 Claude** — door-policy *backend* (`convex/events.ts` + `eventsSchema.ts`): request table, gate, request/approve/deny, advisory LLM bouncer. 6/6 scenario tests.
- **#477 Claude** — schema-drift hotfix: tolerate `lastActivityAt` so Convex deploy passed.
- **#476 Claude** — synthesized landing (live counter + Create-first), cherry-picking Codex's index-backed "active now" + chrome-leak fix.
- **8c3a0cc9 Codex** — public room discovery (directory + `joinPolicy` field + `listPublicRooms` + the "Request to join" label, not yet wired).
