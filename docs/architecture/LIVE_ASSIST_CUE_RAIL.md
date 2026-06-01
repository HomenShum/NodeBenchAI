# Live Assist Cue Rail — Backend (Step 10)

> Status: shipped follow-up to PR #416 (Live Assist + Meeting Modes).
> Backend that powers the cue rail the #416 prototype deferred to a stub.
> Model verified against platform.claude.com on 2026-06-01.

## What it is

The **Live Assist cue rail** is a real-time conversation co-pilot for someone
attending a live scratchnode.live event (conference, panel, meeting). While the
rail is open it polls every 30s and surfaces **1–3 sharp cues** — a pointed
question to ask, a fact to raise, a follow-up tied to *your own* private notes —
derived from the last 30–60s of public chat plus the caller's own notes.

It is the "ambient intelligence / packet-aware whisper" idea (see
`memory/nodebench_subconscious.md`) made concrete for the live-event surface:
**agency over anxiety** — every tick hands the attendee something they can *do*
right now, never just something to watch.

## Why it matters

| Lens | Why the cue rail earns its place |
|---|---|
| **Product vision** | NodeBench is the *operating-memory + entity-context layer for agent-native work*. The cue rail is that memory **acting in real time** — context in, sharp next-move out, in the live moment where it's most valuable. |
| **Distribution** | Cues are the "output is the distribution" pattern: a well-timed cue in a packed room is the most screenshot-/show-someone-worthy moment scratchnode produces. |
| **Trust** | Privacy is a release-blocker: a cue must **never** reference another attendee's private notes. The design makes that structurally impossible, not merely conventional. |
| **Latest dev direction** | It extends the live-event **/ask agent lane** (`events:askAgent`) rather than forking a parallel system, and runs **Gemini 3.5 Flash** (with `thinkingLevel` control) — fast + cheap, the right model tier for a per-user 30s loop. |

## Architecture

```
                          scratchnode.live  /e/<slug>   (live event room)
        ┌───────────────────────────────────────────────────────────────────┐
        │  PUBLIC CHAT  (everyone)          PRIVATE NOTES  (only you)         │
        │  ┌───────────────────────┐        ┌───────────────────────────┐    │
        │  │ "p95 or average?"     │        │ "Acquire Orbital Labs Q3" │    │
        │  │ "tail latency..."     │        │ (bodyHtml never leaves DB)│    │
        │  └───────────┬───────────┘        └─────────────┬─────────────┘    │
        └──────────────┼──────────────────────────────────┼──────────────────┘
                       │  every 30s, while rail is OPEN    │
                       ▼                                   ▼
        public/proto/home-v5.html  ──  _resolveLiveCueSource(since)
                       │   prefers ACTION → falls back to MUTATION → demo stub
                       ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │  users:generateLiveCuesLLM   (Convex ACTION — max quality)         │
        │                                                                    │
        │   ctx.runMutation( _prepareLiveCueContext )  ◄── shared GATE ──┐   │
        │        • presence check (must be a member)                    │   │
        │        • 25s rate-limit  (claim-then-work, atomic)            │   │
        │        • read recent chat  (bounded ≤100)                     │   │
        │        • read OWN notes    (by_owner_event — exact-match) ────┘   │
        │                  │  {messages, ownNoteTitles, eventName}          │
        │                  ▼                                                 │
        │        Gemini 3.5 Flash  (gemini-3.5-flash)                        │
        │          thinkingLevel=low · temp 0.4 · <UNTRUSTED> chat            │
        │          responseSchema JSON → parse/validate/cap                  │
        │                  │ ok                         │ any failure        │
        │                  ▼                            ▼                    │
        │        source:"llm"          ───────►  deterministic fallback      │
        │                                         source:"fallback"          │
        └──────────────────────────────────────────────────────────────────┘
                       ▲ shares the SAME gate (one source of truth)
        ┌──────────────┴───────────────────────────────────────────────────┐
        │  users:generateLiveCues      (Convex MUTATION — deterministic)     │
        │   keyword→template over the chat corpus · free · instant · floor   │
        └────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
        { topic, cues[1–3], context[chips], status, source }
                       │
                       ▼   rendered into the rail (desktop) / sheet (mobile)
        ┌───────────────────────────┐
        │  Suggested cue            │   "Ask whether p95 or average —
        │  [Save] [Ask privately]   │    tail latency matters more for SLAs"
        └───────────────────────────┘
```

## The two paths (one gate)

Both deployed via re-export from `convex/users.ts` (the client-contract anchor):

- **`users:generateLiveCues`** — mutation. Deterministic keyword→template.
  Free, instant, no external dependency. The reliable floor.
- **`users:generateLiveCuesLLM`** — action. Gemini 3.5 Flash. On *any* LLM
  failure it falls back to the deterministic generator **internally**, so the
  client makes exactly one network call and always gets cues.

Both run the same `gateAndReadContext` helper, so presence / rate-limit /
privacy invariants live in exactly one place.

## Invariants

- **Privacy (release-blocker):** own notes are read by the `by_owner_event`
  index with `ownerKey === sessionId` — Convex indexes are exact-match, so
  another user's notes are *structurally* unreachable. Only note **titles**
  enter the prompt; `bodyHtml` never leaves the server. A two-way scenario test
  (`scratchnodeLiveCues.test.ts`) proves A never sees B's note and vice-versa.
- **Honest source (HONEST_SCORES):** `source` reports `llm` / `fallback` /
  `deterministic` / `skipped` truthfully — a post-error fallback is never
  dressed up as `llm`.
- **Bounded (BOUND / BOUND_READ):** chat ≤100 rows, notes ≤30, transcript
  ≤6 000 chars, cues hard-capped at 3, response capped by `max_tokens`.
- **Rate-limited:** 25s per (sessionId, eventId), claimed atomically at gate
  time so overlapping slow LLM ticks serialize.
- **Prompt-injection bounded:** public chat is wrapped in
  `<UNTRUSTED_PUBLIC_CHAT>` and the model is told to treat it as data. Worst
  case of a successful injection is one bad tick — there is no other user's
  private data in context to leak, and cues are never persisted.

## Model: Gemini 3.5 Flash + `thinkingLevel`

Verified against ai.google.dev (2026-06-01):

- **`gemini-3.5-flash`** — Google's GA flash model (1M context, 65k max output).
  Fast + low-cost, which is the right trade for a **per-user 30s loop** vs a
  flagship reasoning model that's slower + pricier per tick.
- Structured output via `generationConfig.responseMimeType: "application/json"`
  + `responseSchema` (uppercase type names in REST). Auth: `x-goog-api-key`.
  Gemini **supports `temperature`** (we use 0.4) — unlike Opus 4.7/4.8.
- Reasoning depth is the **`thinkingLevel`** enum (`thinkingConfig`;
  `minimal | low | medium | high`, raw `thinking_budget` deprecated). Cues run
  at **`low`** (Google's "faster, cheaper, still strong quality" tier). Env
  overrides: `SCRATCHNODE_CUE_MODEL`, `SCRATCHNODE_CUE_EFFORT` (the thinking
  level), kill-switch `SCRATCHNODE_CUE_LLM_DISABLED=1` (forces deterministic).

> History: this path originally shipped on Claude Opus 4.8 (#448); switched to
> Gemini 3.5 Flash for the user-facing rail to cut per-tick latency + cost.

## Prior art

- Pattern: orchestrator action + internal-mutation context-prep — mirrors
  `convex/events.ts:askAgent` (the live-event /ask agent) and Anthropic's
  "Building Effective Agents". We use an internal *mutation* (not query) for
  prep so the rate-limit slot is claimed atomically with the read.
- Privacy/owner-scoping mirrors `convex/notes.ts` (`by_owner_*` indexes).

## Files

| File | Role |
|---|---|
| `convex/scratchnodeLiveCues.ts` | Both paths + shared gate + Gemini call |
| `convex/users.ts` | Re-exports → `users:generateLiveCues[LLM]` deployed paths |
| `convex/schema/eventsSchema.ts` | `lastCueGenAt` (additive) for the rate limit |
| `public/proto/home-v5.html` | `_resolveLiveCueSource` — action→mutation→stub |
| `convex/__tests__/scratchnodeLiveCues.test.ts` | 8 scenario tests |
