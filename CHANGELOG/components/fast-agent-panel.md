# FastAgentPanel

Append-only lane for behavior-preserving AI Elements adoption inside
`src/features/agents/components/FastAgentPanel/`. Newest entries first.

## 2026-07-14 — Remove ungrounded chat chrome

The unopened panel now keeps the composer and four real starter actions as its primary surface. Empty tabs, duplicate command rails, decorative progress/minimap UI, placebo Focus/Tone controls, and text-inferred confidence/citation/media projections are removed while canonical streaming, approvals, structured sources, tool/domain cards, model/token provenance, Markdown, and exports remain.

**PR / canonical main commit**: `PENDING #TBD MAIN SHA / FINAL QA`.

**Evidence state**:
- Source: pending.
- Checks: local current-tree FastAgent, streaming, typecheck, design, and build gates passed; required PR checks pending.
- Visual proof: private local responsive/theme captures independently reviewed; public-safe preview captures pending.
- Preview: pending.
- Production live: pending.

**Author**: Homen Shum + Codex.
**Touches**: [`../pages/agents.md`](../pages/agents.md).

## 2026-07-14 — Migrate LiveEventCard onto the shared tool shell

LiveEventCard now composes the tool/task vocabulary, while live-event derivation
is shared with FastAgentPanel and the panel header is isolated behind its own
component contract. This records source merge, not visual-proof-complete or a
direct production DOM claim.

**PR / canonical main commit**: #527 / `28d704b2`.
**Evidence state**: source merged; later evidence states not recorded here.
**Touches**: [`../integrations/ai-elements.md`](../integrations/ai-elements.md).

## 2026-07-14 — Wrap the live composer without changing send semantics

InputBar now composes the `prompt-input` shell while the explicit send-contract
seam preserves send, stop, spawn, voice, attachment, model, and enhancement
behavior. This entry records source state only; visual and production proof are
tracked separately.

**PR / canonical main commit**: #526 / `3cc7cd06`.
**Evidence state**: source merged; later evidence states not recorded here.
**Touches**: [`../integrations/ai-elements.md`](../integrations/ai-elements.md).

## 2026-07-14 — Wrap the live message bubble around generic parts

UIMessageBubble now uses the message/reasoning/tool/source vocabulary while the
identity-preserving adapter routes domain cards through the existing custom
renderers and leaves live Convex hooks authoritative.

**PR / canonical main commit**: #525 / `165ecec2`.
**Evidence state**: source merged; later evidence states not recorded here.
**Touches**: [`../integrations/ai-elements.md`](../integrations/ai-elements.md).

## 2026-07-14 — Migrate tool-call transparency

ToolCallTransparency maps running, success, and error states onto the AI
Elements tool shell without changing the existing arguments/results disclosure.

**PR / canonical main commit**: #524 / `64203ded`.
**Evidence state**: source merged; later evidence states not recorded here.
**Touches**: [`../integrations/ai-elements.md`](../integrations/ai-elements.md).

## 2026-07-14 — Wrap the agent-progress disclosure

CollapsibleAgentProgress composes task, reasoning, and tool primitives while
preserving its exported ToolUIPart contract. This is a source-migration record,
not a claim that the component rendered on a live production path.

**PR / canonical main commit**: #523 / `a4fe5ee3`.
**Evidence state**: source merged; live-render evidence not claimed.
**Touches**: [`../integrations/ai-elements.md`](../integrations/ai-elements.md).

## 2026-07-14 — Adopt primitives in six low-risk leaves

TypingIndicator, ThoughtBubble, QuickCommandChips, LazySyntaxHighlighter,
AgentHierarchy, and SourceCard moved onto the themed primitive layer with their
public component contracts retained.

**PR / canonical main commit**: #516 / `c83a41c8`.
**Evidence state**: source merged; later evidence states not recorded here.
**Touches**: [`../integrations/ai-elements.md`](../integrations/ai-elements.md), [`../build/vite.md`](../build/vite.md).
