# FastAgentPanel

Append-only lane for behavior-preserving AI Elements adoption inside
`src/features/agents/components/FastAgentPanel/`. Newest entries first.

## 2026-07-15 — Keep only runtime-backed chat controls

The pending candidate removes the scripted guest transcript, projected queue and streaming metrics, local-only preference and feedback controls, unsupported attachment and mention affordances, duplicate actions, the unreachable nested command palette and telemetry view, no-op entity-selection controls, synthetic receipt fallbacks, an unreferenced bearer-stream component and HTTP route, and the unrendered parallel timeline and kanban path. Canonical authenticated and anonymous streaming, stop and recovery, owned thread deletion, structured sources and tool cards, approvals, exports, and backend-supplied model and token provenance remain. Generated code can be copied or exported but cannot execute with the signed-in app's origin authority. Document, memory, plan, and fused-search cards fail closed unless successful structured tool output supplies their state and provenance; assistant prose, malformed results, running tools, and errors cannot mint a success card. Reader-position-aware auto-scroll follows the actual streaming message list without pulling a reader away from earlier content, and every shortcut or skip link focuses whichever real composer is mounted. Retrieved sources remain visible as consulted evidence, but the server no longer injects source tokens into unrelated prose or promotes an unbound URL into a claim citation. TRACE and receipt reads are owner-scoped, both direct and tool-driven document creation verify exact thread ownership before reading or linking content, MCP document/folder/spreadsheet reads and writes verify exact object ownership, receipt hashes bind the exact output payload, receipt persistence is required for trust-labeled completion, and every TRACE row distinguishes deterministic code from AI-model output or uses the neutral `Recorded` label; unavailable data renders as loading, empty, or not measured instead of as a fixture.

**PR / canonical main commit**: `PENDING #NNN MAIN SHA / FINAL QA`.

**Evidence state**:
- Source: pending; this worktree candidate is not merged to `main`.
- Checks: not recorded for a canonical `main` SHA.
- Visual proof: not recorded in source; local-only candidate artifacts are not release evidence.
- Preview: not recorded.
- Production live: not recorded.

**Author**: Homen Shum + Codex.
**Touches**: [`../pages/agents.md`](../pages/agents.md), [`../pages/exact-cockpit.md`](../pages/exact-cockpit.md), and [`../integrations/pipeline-runtime.md`](../integrations/pipeline-runtime.md).

## 2026-07-14 — Remove ungrounded chat chrome

The unopened panel now keeps the composer and four real starter actions as its primary surface. Empty tabs, duplicate command rails, decorative progress/minimap UI, placebo Focus/Tone controls, and text-inferred confidence/citation/media projections are removed while canonical streaming, approvals, structured sources, tool/domain cards, model/token provenance, Markdown, and exports remain.

**PR / canonical main commit**: #533 / `655d1556`.

**Evidence state**:
- Source: merged to `main`.
- Checks: the local FastAgent, streaming, typecheck, design, and build gates passed; required PR Typecheck, Runtime smoke, Build, and Tier B checks passed; main CI run `29393842917` passed.
- Visual proof: private local responsive/theme captures were independently reviewed. Sanitized preview and production DOM sweeps confirmed the removed empty/heuristic chrome stays absent and the canonical prompt, model, swarm, status, and trace controls remain reachable.
- Preview: exact-head `549e5895` deployment `5452564772` reached READY; Tier B run `29393537476` passed.
- Production live: deployment `dpl_CjV1PkzsMKK9c3Le3p1jcWpWJW9K` reached READY; both production Post-Deploy Verify runs, `post-deploy:verify`, and the nine-test live smoke passed. The plain-prompt repair opened one canonical panel with one user message and no swarm or duplicate dispatch; the anonymous quota gate returned the honest sign-in response before model execution.

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
