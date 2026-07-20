# Goal: NodeBench handoff view for a completed ScratchNode event

When a user signs in after an event (e.g. AI Infra Summit), NodeBench should show one event they
can open and immediately understand what was captured **publicly vs privately**.

- **status:** proposed
- **surface:** nodebench
- **owner/agent:** (unassigned — founder to approve)

## Scope
- **Files/surfaces allowed:** the NodeBench event-handoff view + its data read path
- **Files/surfaces forbidden:** CRM export; full graph view; any new top-level surface; auth/session
- **User flow being improved:** open NodeBench after the event (the bottom of the core loop)
- **Product invariant that must NOT break:** public vs private separation is visually unambiguous; private notes are owner-only

## Must show
1. the public event artifact (wiki/FAQ),
2. the user's private notes,
3. linked people / companies / topics,
4. saved `/ask` answers,
5. a Daily Brief delta.

## Definition of done
- [ ] A user can open ONE event and understand public-vs-private capture at a glance (screenshot)
- [ ] `tsc` + targeted tests green; no Convex schema change without the migration gate
- [ ] Docs updated; known gaps listed

## Constraints
- Do NOT build CRM export yet. Do NOT build the full graph view. Keep it to one openable event.
- This keeps NodeBench from exploding into every possible feature.

## Notes
- Fan-out: NodeBench-UX · Frontend-Impl · Backend/Convex (read-only derivation first) · Privacy/Safety · QA · Docs.
- next goal: 002 — Daily Brief deltas
