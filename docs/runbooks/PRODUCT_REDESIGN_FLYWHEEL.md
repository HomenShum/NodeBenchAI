# Product Redesign Flywheel

Use this loop when a page feels busy, dashboard-like, or too speculative for the target audience.

## Reference Pattern

- Things: make "today" a short priority list across the whole system, not another dashboard.
- Superhuman: split noisy streams so the essential messages get focus first.
- Linear: keep objects command-driven and composable instead of turning every workflow into a separate dashboard.
- ChatGPT Pulse: deliver a finite daily set of personalized cards, let users curate what is useful, and avoid infinite feed behavior.
- Fierce Biotech: vertical intelligence works when editorial judgment filters a noisy market into a daily read the audience already values.
- YC Launches: discovery surfaces are useful when they let the reader scan fresh entities quickly and decide what is worth opening.
- Claude frontend-design skill: pick a clear aesthetic direction and execute it with precision. For NodeBench, the direction is editorial intelligence with restrained decision queues.

## Product Rule

Every surface should answer one question before it shows detail:

```text
What is the next useful decision here?
```

Then it can reveal the supporting layer:

```text
Home      -> decision queue, then brief sections
Reports   -> report review queue, then searchable library
Chat      -> active run, tools, sources, then composer
Inbox     -> triage queue, preview, approval actions
Me        -> editable memory and policy controls
Workspace -> next decision, then brief/cards/notebook/sources/chat/map
```

## Editing Rule

Do not restyle a page wholesale unless the existing information architecture is actively blocking the next decision. Prefer precise additions:

- ranked queue before dense search or details
- one next-best-action card before secondary controls
- fewer claims about "why it matters" unless backed by user context or source evidence
- explicit provenance when the data is public, cached, personalized, or live
- no silent fixture fallback in production paths

## Verification Loop

1. Inspect live product and code together.
2. Name the page-level decision the user needs to make.
3. Add or adjust the smallest UI element that makes that decision obvious.
4. Run targeted unit tests for the transformed data.
5. Run typecheck, build, and browser screenshots for changed surfaces.
6. Compare before and after: first viewport, no overlap, no fake production data, no unsupported predictive copy.
7. Update the release QA matrix when a row moves from design gap to verified behavior.

## Current Implementation

The shared primitive is `ProductDecisionQueue`. It is live-data backed and used by:

- Home: ranks pulse changes, evidence reviews, forecast ledger checks, report handles, and source rows.
- Reports: ranks report review state, follow-ups, and source depth above the searchable library.
- Workspace: shows a compact next-decision strip for follow-ups, source verification, or saving.

Inbox already follows the queue model. Chat and Me are control surfaces and should only change when the next decision is unclear.
