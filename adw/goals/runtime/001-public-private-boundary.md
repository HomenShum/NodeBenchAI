# Goal: Enforce + test the public/private write boundary

Every ScratchNode composer send must route to exactly one branch — and the boundary must be
covered by tests, not just intent. Runtime goals are **stricter** than design goals: no
"never stop" clause, human approves the merge (see HARD_GATES.md — this touches permission rules).

- **status:** proposed
- **surface:** runtime
- **owner/agent:** (unassigned — founder approval REQUIRED; this is a hard-gate zone)

## Scope
- **Files/surfaces allowed:** the composer send dispatch + its tests (`scratchnode-live-route-honesty.spec.ts`, `home-v5-output-contract.spec.ts`)
- **Files/surfaces forbidden:** anything outside the send/route path; UI redesign
- **User flow being improved:** chat / `/ask` / private-note routing (the trust spine of the core loop)
- **Product invariant that must NOT break:** the three release-blocker invariants below

## The contract (must hold)
The composer must route to exactly one of:
1. **public chat**, 2. **public `/ask`**, 3. **private note**.
- Private notes must **never** create `eventMessages` rows.
- Public `/ask` must **never** include private notes.
- Public traces must state **"No private notes used."**

## Definition of done
- [ ] Unit test per branch + an integration test + a Playwright public/private check, all green
- [ ] `tsc` green; no destructive migration
- [ ] Trace honesty asserted (output matches the L1/L2/L3 schema; trace matches actual calls)
- [ ] Human-approved PR (hard-gate zone) — not auto-shipped

## Constraints
- HARD GATE: permission/boundary rules → propose a patch + tests, human approves the merge.
- Prefer extending the existing honesty-contract tests over building a parallel harness.

## Notes
- Fan-out: Agent-Runtime · Privacy/Safety · QA. Critic reduces scope to the boundary only.
- next goal: 002 — semantic cache (avoid external search when wiki/cache can answer)
