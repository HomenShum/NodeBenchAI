---
id: scratchnode-event-log-followups
title: ScratchNode event log follow-ups
status: queued
surface: scratchnode.live
priority: P1
mode: safe-local-development
---

# Goal: ScratchNode event log follow-ups

Make ScratchNode's self-directed loop deepen the product as an open-source event log assistant:
timeline, public chat, private notes, manual location spots, people/company tags, photos, `/ask`,
host FAQ promotion, published wiki, export, and NodeBench private follow-up.

## Product Framing

ScratchNode is the memory layer for live events, not an invite, ticketing, or RSVP tool.

```text
Luma / Eventbrite / Partiful = invite, RSVP, ticket, event page
ScratchNode = live event memory layer
NodeBench = private research and workspace after the event
```

## Event Log Primitive

Treat every user-visible workflow as an event-log moment and projection.

```text
Event Log
-> Timeline
-> Public chat
-> Private notes
-> Manual location spots
-> People and companies
-> Photos and voice notes
-> Questions and agent answers
-> Sources
-> Wiki
-> Export and NodeBench handoff
```

## Safe Follow-Up Slices

Choose one narrow, locally verifiable slice per loop:

- Add a route test proving a public event-log moment appears in the timeline or wiki without leaking private notes.
- Add a route test proving a private note can be anchored to a chat, person/company, or manual location spot without entering public chat, public `/ask`, cache, or wiki.
- Add a detector or fixture for manual location spots such as Booth 12, Lobby, Panel Room A, Investor Lounge, or Afterparty.
- Add a NodeBench handoff check that private follow-ups, people, companies, topics, and event wiki links remain separated by visibility.
- Add export evidence for public event log JSON and owner-only private note projection.
- Improve wording or docs so the public repo says "open-source event log assistant" and "memory layer for live events" without claiming production readiness.

## Definition of Done

- [ ] One safe slice is implemented, tested, and committed.
- [ ] Public/private visibility remains explicit in UI, data fixtures, traces, and tests.
- [ ] Normal chat, notes, tags, photos, check-ins, replies, and host announcements stay no-LLM by default.
- [ ] `/ask`, wiki compaction, entity extraction, and follow-up generation stay explicit agent actions.
- [ ] `npm run scratchnode:launch:goal` passes after the slice.

## Constraints

- Do not build real GPS/geofencing before manual location spots.
- Do not build a full graph view before cards/lists work.
- Do not replace Luma, Eventbrite, Partiful, Slack, or Discord.
- Do not add NodeBench as a ScratchNode top-level tab.
- Do not weaken the private-note, host-role, or public-cache boundary.
