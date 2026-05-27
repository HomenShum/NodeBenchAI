# ScratchNode Live <-> NodeBench AI Boundary

Last updated: 2026-05-27

## Locked Product Sentence

ScratchNode Live is the public event room. NodeBench AI is the private intelligence workspace behind it.

## Public vs Private Surfaces

```text
scratchnode.live
= public event room
= guest-first, no-account
= one room, one feed, one notebook
= public chat, public /ask, public wiki

nodebenchai.com
= private/user workspace
= notebooks, artifacts, reports, daily brief, private memory
= event continuation after ScratchNode proves value

NodeBench Runtime
= shared backend, Convex truth, agent orchestration, search, graph, traces, cost control
```

Keep ScratchNode v5 simple. Put v4 depth in NodeBench.

## Current Prototype Roles

```text
public/proto/home-v5.html
= ScratchNode Live product target
= live Convex-backed event-room dogfood surface
= public room, public feed, public /ask, public wiki, private-note entrypoint

public/proto/home-v4.html
= NodeBench AI workspace design target
= authenticated workspace depth reference
= notebooks, artifacts, private memory, graphs, daily brief, trace-rich agent work
```

Do not wire `home-v4.html` as the public ScratchNode event room. Use it as the UI kit packet for porting NodeBench workspace depth into production React surfaces. Until that port is complete, `home-v4.html` should remain honest about being a prototype and should not claim live backend parity.

## URL Contract

ScratchNode public event URLs:

```text
https://scratchnode.live/
https://scratchnode.live/e/:eventSlug
https://scratchnode.live/join/:roomCode
https://scratchnode.live/e/:eventSlug/wiki
https://scratchnode.live/e/:eventSlug/archive
https://scratchnode.live/me/events
https://scratchnode.live/me/notes
https://scratchnode.live/host
https://scratchnode.live/sign-in
```

NodeBench private continuation URLs:

```text
https://nodebenchai.com/events/:eventSlug/private?source=scratchnode&room=:roomCode&return=:scratchnodeEventUrl
https://nodebenchai.com/sign-in?return=:nodebenchPrivateEventUrl&intent=save-private-notes
```

ScratchNode sign-in owns event participation state. NodeBench sign-in is only
for the explicit "Open in NodeBench" private-workspace continuation.

Current implementation in `public/proto/home-v5.html` exposes:

```text
EVENT_URL
buildNodeBenchEventPrivateUrl()
buildNodeBenchSignInUrl()
openNodeBenchPrivateHandoff()
```

The release test must fail if any active share or handoff URL regresses to `scratchnode.com`.

## Composer Contract

The ScratchNode composer has exactly three branches:

```text
parseComposerIntent(raw)
  -> getRoomContext()
  -> getIdentity()
  -> if private: save private note only
  -> if public /ask: send public ask and agent answer
  -> else: send public chat
```

Private notes must return before public feed insertion. Normal chat must never invoke the agent.

## Private Annotation Rule

Lock this as the product and data rule:

```text
Private notes are never public messages.
They may appear as private overlays anchored to public chat, visible only to the note owner.
```

Implementation shape:

```text
Public chat row
  -> liveEventMessages row visible to everyone

Private note
  -> userNotes row owned by ownerKey
  -> optional anchorType/anchorId/anchorLabel/anchorPreview
  -> rendered as an owner-only marker beside the public row
```

Allowed:

```text
Private note marker visible only to owner
Private note opens the owner notebook
Private note can be exported by owner
Private note can become a separate public FAQ suggestion only after explicit owner action
```

Never allowed:

```text
Private note inserted into liveEventMessages
Private note compacted into liveEventWikiVersions
Private note used by public /ask
Private note cached in a public answer cache
Private note visible to host by default
```

## ScratchNode Account Layer

ScratchNode should support lightweight signed-in state without becoming the
full NodeBench workspace.

```text
Anonymous visitor
  -> view public room/wiki/archive

Guest session
  -> join event, chat, limited /ask, private notes owned by guest session

Signed-in ScratchNode user
  -> my joined events
  -> my hosted events
  -> my private notes
  -> my saved /ask answers
  -> my published event wikis
```

Host controls live on ScratchNode because they are event operations:

```text
create event
set room code
moderate chat
review FAQ suggestions
manage sources
publish wiki
export event analytics
```

NodeBench remains the deeper continuation surface:

```text
turn event notes into report notebooks
run deep company/person research
merge event deltas into Daily Brief
export CRM/follow-up workflows
inspect full trace DAG and graph context
```

## Data Boundary

Public data may become FAQ/wiki:

```text
liveEventMessages
liveEventAnswers
liveEventSources
liveEventWikiVersions
```

Private data may become the user's NodeBench notebook:

```text
userNotes
future authenticated notebooks/notebookBlocks
```

Never allow `userNotes` into public `/ask`, FAQ promotion, wiki compaction, public cache, or public trace.

## Runtime Rule

Convex remains durable source of truth. Redis and Typesense are projections only after measured need:

```text
Convex: truth, permissions, event records, notes, sources, wiki, traces
Redis: hot room state, active run state, semantic answer cache
Typesense: search-as-you-type, @mention autocomplete, human-facing search
Linkup: external discovery only when event corpus misses or freshness requires it
pi-ai / NodeBench runtime: orchestration and governed tools, not raw database access
```

## Trace Contract

ScratchNode shows a compact public trace:

```text
context selected
cache hit or miss
sources reused
Linkup skipped or used
private notes excluded
```

NodeBench may show the full trace DAG with tool calls, artifacts, graph updates, and notebook patches.

## Minimum QA Gates

```text
SN-LIVE-001 scratchnode.live/e/:slug loads without login
SN-LIVE-002 guest joins with room code
SN-LIVE-003 normal chat does not invoke agent
SN-LIVE-004 /ask invokes agent
SN-LIVE-005 agent answer is nested under parent ask
SN-LIVE-006 answer trace shows no private notes used
SN-LIVE-007 private note does not appear in public feed
SN-LIVE-008 private note appears in private notebook
SN-LIVE-009 attendee sees Suggest for FAQ
SN-LIVE-010 host sees Promote to FAQ
SN-LIVE-011 host can publish wiki
SN-LIVE-012 published wiki excludes private notes
SN-LIVE-013 share URL uses scratchnode.live
SN-LIVE-014 guest can sign in and preserve notes
SN-LIVE-015 NodeBench workspace handoff URL carries event + private-note continuation context
```
