# ARCHITECTURE — the boundaries that actually constrain you

`docs/START_HERE.md` walks one request through the code. This page states the
rules that walk implies, so you can predict where a change belongs before you
open a file.

## The one-sentence version

A user's question becomes a **durable server-owned run**; the browser never
receives the answer as a reply, it subscribes to the run and re-renders as rows
land.

## Boundary 1 — the trust boundary is a single Convex mutation

Everything above `startChat` (`backend/convex/domains/redesign/chatRuns.ts:1457`)
is browser state that a user can edit with dev tools: the prompt, the tier, the
pinned claims, the conversation history it replays back. Everything below it is
server-owned.

Three things are therefore only true below that line, and must never be moved
above it:

1. **Identity.** `requirePaidChatUserId` (line 159) rejects unauthenticated and
   anonymous callers. The frontend also checks, but that check is a courtesy so
   the user sees a reason; it is not the gate.
2. **Bounds.** The prompt is truncated to `MAX_PROMPT_CHARS` (4,000) and
   rejected under 3 characters. Conversation context is sanitised. These are
   cost controls as much as correctness controls.
3. **Idempotency.** A repeated `clientRequestId` returns the original `runId`.
   Without this, a double-click or a retried network request buys a second
   paid model call.

The argument validators in the mutation's `args` block are the domain types for
this path. Convex rejects a malformed call before your handler runs, so there is
deliberately no second validation layer underneath. Do not add one.

## Boundary 2 — mutations are short, actions are slow, and they cannot swap roles

Convex enforces this and it is the reason the code is shaped the way it is:

- A **mutation** is a transaction. It may read and write the database. It may
  not call the network. It must finish fast.
- An **action** may call the network. It may **not** touch the database
  directly — it calls mutations and queries through `ctx.runMutation` /
  `ctx.runQuery`.
- A **query** is a live subscription. Every browser subscribed to it re-renders
  when its result changes.

So the chat flow has no choice but to be: mutation inserts the run and schedules
work → action does the slow work and writes progress through mutations → queries
push it to the browser. If you find yourself wanting to "just return the answer
from `startChat`", the platform will stop you, and it is right to.

## Boundary 3 — progress is state, not a message

There is **no SSE endpoint and no WebSocket route in this application's code** on
the product path. Confirm it yourself: `grep -rn "text/event-stream" apps/web/src`
returns nothing for the chat surface.

Instead, `runStreamingChat` writes one row per stage into
`redesignChatStreamEvents` with a monotonically increasing `idx`, and the browser
subscribes with `useQuery(streamEventsForRun)`. The consequences a new engineer
must internalise:

- **A reload does not lose an answer.** The rows are still there;
  `getLatestOwnedRun` re-attaches.
- **If a stage does not `appendEvent`, the user cannot see it.** Adding a
  computation to the orchestrator is not enough — it has to become a row.
- **Ordering is explicit.** `idx` is computed by reading the current maximum and
  adding one. This is a read-then-write inside a single Convex mutation, which
  is transactional, so concurrent appends cannot collide.

## Boundary 4 — there is exactly one tool on this path, and it is not ours

The canonical chat path calls Gemini with `tools: [{ google_search: {} }]` and
nothing else. There is no tool registry, no dispatcher, no function-calling loop
in `chatRuns.ts`. The rows the UI labels "tool calls" are stage records the
orchestrator writes about itself.

Multi-tool agent runtimes do exist in this repository —
`apps/web/src/features/agents/` for the panel UI, `backend/convex/domains/agents/`
for orchestration, `packages/convex-mcp-nodebench` (36 MCP tools) and
`packages/mcp-local` for the published MCP servers. **None of them is reachable
from `/redesign/chat`.** Confusing the two is the single most likely way to waste
a day here.

## Boundary 5 — one surface, many intents

`/redesign` and every legacy path collapse to `/redesign/chat`.
`apps/web/src/features/redesign/lib/oneSurfaceRouting.ts` owns that mapping and
`oneSurfaceRouting.test.ts` pins it. Reports, Inbox and Me are `?intent=` states
of the same conversation, not routes.

Practical rule: **adding a product area does not mean adding a route.** If you
add one, you have created a second place a user can be, and the shell will
immediately redirect them away from it.

## Boundary 6 — evidence is verified after the answer, not before it

`validateRunSources` (line 2464) is scheduled *after* the packet is sealed. It
re-fetches each cited URL behind an SSRF check (`isUrlSafe`, line 2384) and
asserts the quoted text is a literal substring of the fetched page, then patches
verification flags onto the evidence rows. The user sees the answer immediately
and sees the verification marks arrive a moment later, through the same
subscription.

This is a deliberate ordering trade: latency for the user, honesty for the
claim. A citation that cannot be re-found is marked, not deleted.

## What is *not* architecture here

Things that look structural but are conventions you can change:

- The 70 folders under `backend/convex/domains/` are a flat namespace, not
  layers. Nothing enforces what may import what.
- `apps/web/src/features/*` is likewise flat. Cross-feature imports happen.
- There is no dependency-direction lint. See CONCERNS.md for the measured
  consequence (1,196 import cycles).
