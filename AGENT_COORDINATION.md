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

- _(none right now — `home-v5.html#directory` released; shipped, see Recently shipped.)_

## Hand-offs (built + ready for the other agent to call)

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

## Recent decisions / contracts

- `liveEvents.joinPolicy` is `open | request` (invite / capacity / room-norms = future).
- `liveEvents` tolerated optional fields (from cross-agent deploys): `lastActivityAt`,
  `publicDiscoverable`. Keep them `v.optional` — don't remove.
- The apex landing must stay honestly `data-sn-live = null` (never "live") until a host
  actually enters a room. The live counter + share moment both honor this.

## Recently shipped (this ScratchNode session)

- **Claude** — directory viral slice (`home-v5.html#directory`): flyer cards + "● N inside" presence cue + policy-aware action (open → "Join now"; request → "Request to join" `<button>` wired to `events:requestJoinEvent`, watching `getMyJoinRequest` for approval, on the **same `sn_session_id`** so approval carries through the `joinEvent` door gate). 18/18 chromium honesty suite; desktop + mobile verified. (This consumes the Codex 8c3a0cc9 "Request to join" label hand-off.)
- **#481 Claude** — post-create viral *share moment* (home-v5.html landing): invite card + QR + copy + Text/Email + "Enter your room →".
- **#480 Claude** — door-policy *backend* (`convex/events.ts` + `eventsSchema.ts`): request table, gate, request/approve/deny, advisory LLM bouncer. 6/6 scenario tests.
- **#477 Claude** — schema-drift hotfix: tolerate `lastActivityAt` so Convex deploy passed.
- **#476 Claude** — synthesized landing (live counter + Create-first), cherry-picking Codex's index-backed "active now" + chrome-leak fix.
- **8c3a0cc9 Codex** — public room discovery (directory + `joinPolicy` field + `listPublicRooms` + the "Request to join" label, not yet wired).
