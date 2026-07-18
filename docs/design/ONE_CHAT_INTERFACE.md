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

- **A (now)**: ChatAssistantMessage + ChatSurface + ReproducibleChatPage on the
  new anatomy. Guards rewritten to the new markup (ChatResponseShape.guard,
  AgentWorkspaceHonesty.guard substrings). Contracts + 92-test suite green.
  Evidence pairs via `?qaState=answer`.
- **B**: FastAgentPanel consumes ChatAssistantMessage for overlapping turns.
- **C**: retire duplicate FastAgentPanel bubble internals + this doc records
  the removal.

## Definition of done (Phase A)

Prose-led message with primitives collapsed; every guarantee above verified;
`tsc` 0, redesign suite green, surface contracts green, before/after photo
pairs in `docs/design/ui-contract/YYYYMMDD-one-chat/`.
