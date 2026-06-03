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

## Active claims (who is editing what RIGHT NOW)

- _(Released: Codex packaged `codex/scratchnode-public-wiki-loop` for PR review; no active edit lock remains.)_

- **Codex · `home-v5.html#wiki-share`, `convex/events.ts#wiki-public-read`, `vercel.json#scratchnode-wiki-route`, `tests/e2e/scratchnode-live-route-honesty.spec.ts#wiki-route` · build published-only public wiki payoff + honest answer share · branch `codex/scratchnode-public-wiki-loop`.**

## Hand-offs (built + ready for the other agent to call)

- **2026-06-03 - Codex -> Claude/Codex next builder** - Public wiki payoff ready on
  branch `codex/scratchnode-public-wiki-loop`:
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

- **2026-06-03 · Codex → Claude/Codex next builder** — Viral journey audit after #483:
  - **Not end-to-end yet.** Entry/create, landing big number, post-create share moment,
    public directory, open-room join, and request-card plumbing are live on
    `scratchnode.live`. The back half is still incomplete.
  - **Highest-leverage next slice:** public post-event wiki payoff. Build a public
    route only for host-published wiki versions, with private notes excluded. Current
    `scratchnode.live/e/:slug/wiki` still rewrites to the SPA shell; docs still mark
    SEO wiki + OG + sitemap as future work.
  - **Fast honesty fix:** answer-card `Share` buttons currently toast "Link copied"
    without copying or generating a URL. Either copy a real event/answer deep link or
    change the UI text until the route exists.
  - **NodeBench bridge gap:** ScratchNode builds
    `nodebenchai.com/sign-in?return=/events/:slug/private?...`, but live NodeBench has
    no matching `/sign-in` or `/events/:slug/private` consumer. Existing real route is
    `/scratchnode-events`; `/events/:eventId` is a corpus placeholder. Do not claim
    ScratchNode to NodeBench continuation is live until the returned context renders in
    NodeBench with the event, public wiki artifact, and private-note continuation.
  - **Bouncer self-serve gap:** backend supports `joinPolicy: "request"` and the
    directory can request approval, but the landing create form still hardcodes
    `joinPolicy: "open"`. Add a host-facing create/control toggle before calling this
    request-room flow self-serve.

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

- **Codex** - manual location spot anchor proof (`tests/e2e/scratchnode-live-route-honesty.spec.ts#manual-location-spots` + `scripts/scratchnode/scanLaunch.mjs#event-log-evidence`): route test proves a private note anchored from a public Booth 12 location moment preserves context, stays out of public chat and public `/ask`, and renders only the owner-visible marker; launch scanner now requires the proof before passing.

- **Codex** - visibility-safe NodeBench handoff proof (`tests/e2e/scratchnode-live-route-honesty.spec.ts#nodebench-handoff` + `scripts/scratchnode/scanLaunch.mjs#event-log-evidence`): route test proves private follow-up text, tags, note ids, anchor ids/previews, public anchor text, and session ids stay out of fallback/tokenized handoff URLs; launch scanner now requires the proof before passing.

- **Claude** — public `/wiki/<slug>` reader (`home-v5.html#wiki-reader`, PR #487) + `getPublishedWikiBySlug` (PR #486): the post-event wiki now has a real public address — a no-account reader with the published recap + a reverse-viral "Create your own room" CTA. `pageMode='wiki'` hides the room shell; honest empty/error states; `data-sn-live` never set. Also de-lied the `/ask` answer Share button + added a real one to the live renderer (PR #485). 3 wiki e2e + 6 backend scenarios + 20 honesty suite green.
- **KNOWN GAP (do not re-add blindly):** the **NodeBench bridge is BROKEN** — `nodebenchai.com/events/<slug>/wiki` and `.../private` 404 (the `src/App.tsx` `/events` route regex `^/events/([^/]+)/?$` rejects trailing segments; no surface reads `source=scratchnode`/`room`/`continuation`/`publicArtifact`; no Convex importer). The pre-existing `openNodeBenchPrivateHandoff` CTAs (home-v5.html ~3452, ~4689) dead-end too. **Next:** add the real receiving route `/events/:slug/wiki` in `src/App.tsx` (render the wiki via the public `getPublishedWikiBySlug`) + then wire the "Continue in NodeBench" CTA. Ship route-first so the CTA can't 404.
- **Claude** — directory viral slice (`home-v5.html#directory`): flyer cards + "● N inside" presence cue + policy-aware action (open → "Join now"; request → "Request to join" `<button>` wired to `events:requestJoinEvent`, watching `getMyJoinRequest` for approval, on the **same `sn_session_id`** so approval carries through the `joinEvent` door gate). 18/18 chromium honesty suite; desktop + mobile verified. (This consumes the Codex 8c3a0cc9 "Request to join" label hand-off.)
- **#481 Claude** — post-create viral *share moment* (home-v5.html landing): invite card + QR + copy + Text/Email + "Enter your room →".
- **#480 Claude** — door-policy *backend* (`convex/events.ts` + `eventsSchema.ts`): request table, gate, request/approve/deny, advisory LLM bouncer. 6/6 scenario tests.
- **#477 Claude** — schema-drift hotfix: tolerate `lastActivityAt` so Convex deploy passed.
- **#476 Claude** — synthesized landing (live counter + Create-first), cherry-picking Codex's index-backed "active now" + chrome-leak fix.
- **8c3a0cc9 Codex** — public room discovery (directory + `joinPolicy` field + `listPublicRooms` + the "Request to join" label, not yet wired).
