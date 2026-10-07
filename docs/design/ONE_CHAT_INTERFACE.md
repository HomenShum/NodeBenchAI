# One Chat Interface — the singular chat surface

Decision (founder, 2026-07-18): the flagship answer is **chat-shaped**. Prose
leads; structure collapses into the message; the two parallel chat stacks
(ChatSurface hand-rolled internals vs FastAgentPanel's AI-Elements vocabulary)
converge on ONE message anatomy. "The memo is the product" is overruled — the
memo's *content guarantees* survive, its *document costume* does not.

## Target anatomy (assistant turn)

```
<Message from="assistant">                    // ai-elements/message
  <MessageContent>
    1. Receipt line — one compact mono line: tier · N sources · latency · cost
    2. PROSE LEADS — shortAnswer + whyItMatters as one flowing body.
       Citations stay interactive (renderInlineWithCites hover→evidence
       binding is a differentiator, not memo furniture).
       Compact shapes unchanged: title/bullets render as prose lines;
       json/table keep the .rd-answer-structured mono block.
    3. Inline notes (only when non-empty): risks as a quiet callout;
       nextAction as one action sentence with its buttons beside it.
    4. Collapsed by default, in this order (ember tick on each trigger):
       <Reasoning>  — research stages (run-thread) + "how we got this answer"
       <Tool>       — one per tool call; ChatToolCall content re-housed
       <Sources>    — evidence rows with verification badges + [N] binding
  </MessageContent>
  <MessageActions>  — follow-ups · promote claim · export · share hash · probe
</Message>
```

User turns → `<Message from="user">`. Thinking state keeps the ember thread,
housed in the same Message frame.

## The one-component rule

`ChatAssistantMessage` (new, `src/features/redesign/components/`) is the ONLY
place assistant anatomy exists. ChatSurface AND ReproducibleChatPage render it
— the two renderers structurally cannot drift. FastAgentPanel adopts it in
Phase B; its duplicate bubble internals retire in Phase C (expand–contract,
never a same-PR flip).

## What must survive, verbatim in behavior

- Citation hover ↔ evidence-row binding; probe-without-source; pin claims
- Evidence verification states (verified / cached_reference / provider_grounded
  / fetch_blocked / unsupported) with badges
- Receipt disclosure (provider · model · tokens · cost · latency) + share hash
- Compact response shapes incl. structured mono block (json/table)
- Honesty gates are BACKEND (answerPacket L3 contract) — untouched by this work
- Reduced-motion flattening of every ember element

## Phases

- **A — COMPLETE (PR #583)**: ChatAssistantMessage + ChatSurface +
  ReproducibleChatPage on the new anatomy; guards rewritten to the new markup.
- **B — COMPLETE (PR #584)**: FastAgentPanel consumes ChatAssistantMessage for
  overlapping completed turns behind an opt-in prop; honest adapter
  (describeCanonicalAnswerFit / buildCanonicalAnswerProps) never fabricates
  verification, trace, durations, costs, or router tiers.
- **C — COMPLETE (this PR)**: adoption is the DEFAULT — the opt-in
  `preferCanonicalAnswer` prop and the compact-sidebar bypass are deleted; the
  fit gate alone routes every panel turn. Routing-predicate mirrors collapsed
  into `adapters/convexToUIParts.ts`. Delete + read-aloud ported into the
  canonical toolbar (stroke SVGs). Reasoning trigger count made honest (no
  "0 steps"; count omitted when the section has no step rows).

### Markdown-prose decision (Phase C, recorded)

Markdown-rich completed panel turns (fences / headings / tables / lists /
links) now ADOPT with `proseFormat="markdown"` on ChatAssistantMessage — a
strictly additive prop, default `"plain"`, so flagship/receipt callers are
unchanged. Markdown prose renders through the shared ai-elements streamdown
renderer (`src/components/ai-elements/streamdown-renderer.tsx`, consumed via
`MessageResponse`, never edited) and carries NO [N] cite interactivity: panel
markdown never had bound cites, and the adapter still refuses bare-[N] turns
outright. Still refused (legacy anatomy retained for them): streaming/live
turns, agent hierarchy, fusion/memory/media/domain parts,
`{{cite:}}`/`{{entity:}}`/`@@entity:` token answers, gallery markers, think
tags, and user turns.

### Phase C removal ledger

Deleted because the gate makes them dead:
- `preferCanonicalAnswer` prop + its production call-site opt-in (no callers;
  the gate routes unconditionally).
- The `compact` bypass inside the adoption memo (gate alone routes; the
  compact sidebar renders the canonical anatomy for overlapping turns).
- The bubble's private `getNormalizedToolName` / `isFusionSearchTool` /
  `isMemoryPlanningToolName` mirrors and the adapter's private copies — ONE
  shared implementation now lives in `adapters/convexToUIParts.ts`.

Deliberately KEPT: the bubble's compositional renderers (text via
ReactMarkdown, ToolStep accordions, AISources, ThinkingAccordion, smart
actions, action bar). Each remains reachable for refused shapes — e.g. a
completed turn whose prose carries a bare `[N]` or `{{cite:}}` token renders
the full legacy anatomy including its tool steps and sources — so none of
them satisfies the unreachability bar for deletion.

## Definition of done (Phase A)

Prose-led message with primitives collapsed; every guarantee above verified;
`tsc` 0, redesign suite green, surface contracts green, before/after photo
pairs in `docs/design/ui-contract/YYYYMMDD-one-chat/`.
