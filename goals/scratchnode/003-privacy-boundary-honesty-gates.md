# Goal: Make the public/private safety contract testable (boundary honesty gates)

`SCRATCHNODE_NODEBENCH_BOUNDARY.md` defines gates SN-LIVE-006..-012, but the honesty spec only
covers config/join/send/staleness/host-CRUD — **none assert the actual data boundary** (private
notes never leak into the public feed, the agent trace, or the published wiki). Add the missing
scenario tests so a regression that leaks a private note is caught by CI, not by users.

- **status:** proposed
- **surface:** scratchnode
- **severity:** P1 (the core safety contract is currently unverified by CI)
- **auto-safe:** tests-only, no product code change → eligible for the loop's auto-safe path once approved.

## Scope
- **Allowed:** `tests/e2e/scratchnode-live-route-honesty.spec.ts` (add `describe`/`test` blocks; extend the Convex mock in `fulfillScratchNodePage` to record `notes:*` + `events:suggestAnswerForFaq` calls and expose a queryable userNotes / liveEventMessages split)
- **Forbidden:** `public/proto/home-v5.html` (no product change — assert CURRENT behavior; a failing gate becomes its own fix card); `convex/**`; any new surface
- **Core-loop flow:** `public chat → /ask → sourced answer → private note → FAQ suggestion → public wiki`
- **Invariant that must NOT break:** tests assert on mocked Convex **state** (which mutation/query, what args) — not merely visible UI text (text can be honest while the write leaks). Each test names its gate id inline.

## Definition of done
- [ ] 6 named cases: SN-LIVE-006 (answer `.ans-how` trace has no private-note text), -007 (private send recorded as a private note, NOT in `events:sendMessage`/`liveEventMessages` mock), -008 (private send present in userNotes/notebook mock), -009 (attendee sees "Suggest for FAQ"), -010 (host sees "Promote to FAQ"), -012 (published-wiki body excludes private-note text).
- [ ] Each test maps to a boundary-doc line via comment; run output lists all six gate names.
- [ ] `tsc --noEmit` clean; suite green — OR a legitimate gate failure is reported as a found bug (feeds a new fix card), not silenced.

## Constraints
- Tests-only; no product behavior change in this card. No new surface/route.
- Scenario-based per project rule: set identity, exercise the real composer/answer path, inspect data boundaries — no shallow text-only checks.
