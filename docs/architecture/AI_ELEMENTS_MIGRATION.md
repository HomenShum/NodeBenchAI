# AI Elements Migration

Scaffolding NodeBench's AI-chat UI onto [Vercel AI Elements](https://elements.ai-sdk.dev/)
primitives so we maintain thin wrappers instead of ~80 hand-rolled components.

_Last updated: 2026-07-13_

## Why

The FastAgentPanel carries ~56 custom AI-surface components (message bubbles,
streaming, input, reasoning, tool calls, sources, loaders, code blocks). AI Elements
ships these as owned, upgradeable source built on shadcn/ui — so "our components" become
thin adapters over canonical primitives, not full custom implementations to self-maintain.

## Scaffold status — DONE (verified)

- **24 AI Elements primitives** installed at `src/components/ai-elements/`:
  message, conversation, prompt-input, reasoning, chain-of-thought, sources,
  inline-citation, suggestion, task, tool, context, checkpoint, code-block, artifact,
  web-preview, image, open-in-chat, shimmer, confirmation, model-selector, plan, queue,
  attachments, snippet.
- **20 shadcn base primitives** installed at `src/components/ai-ui/` (isolated alias).
  - The shadcn `ui` alias in `components.json` was pointed at `@/components/ai-ui` so the
    generated base primitives (`button.tsx`, `card.tsx`, …) **do not collide** with the
    repo's custom PascalCase `src/components/ui/Button.tsx` on Windows' case-insensitive FS.
- **Deps added by the CLI:** streamdown, shiki, motion, `@streamdown/{cjk,code,math,mermaid}`,
  use-stick-to-bottom, class-variance-authority, tokenlens, nanoid, several `@radix-ui/*`.
- **Theme bridge is free** — `src/index.css` already maps the shadcn tokens to the DNA:
  `--primary: 18 62% 60%` is terracotta (`#d97757`), `--ring`/`--accent-foreground` too,
  `--background`/`--card`/`--muted`/`--border` are the warm neutrals with a `.dark` block.
  Every primitive (`bg-primary`, `text-muted-foreground`, `border`, `ring`) renders on-brand
  automatically. Only optional later polish: glass treatment on `bg-card`.
- **`tsc --noEmit` clean** across the whole project after the scaffold.

## Consumer layer — SHIPPED (verified `tsc` green)

`src/features/agents/components/ai/` — our thin components built on the primitives,
consuming the app's real `UIMessage` shape directly:

| File | What it is |
|---|---|
| `AiMessage.tsx` | Renders one `UIMessage` via Message/Reasoning/Tool/Sources. Handles the STANDARD AI SDK parts; delegates NodeBench `data-*` parts via a `renderCustomPart` hook so domain renderers stay put. |
| `AiConversation.tsx` | `Conversation` (stick-to-bottom) mapping `UIMessage[]` → `AiMessage`. |
| `AiPromptInput.tsx` | Thin `PromptInput` wrapper; `onSend(text, files)` plugs into an existing Convex `sendMessage`. |
| `AiConversation.stories.tsx` | Storybook proof: text+markdown+code, reasoning, tool call, sources, streaming, empty, prompt input. |

**Honesty-contract invariant:** no primitive drives a stream. The Convex hooks
(`useUIMessages(stream:true)`, `useSmoothText`, `useStream`) stay; primitives become the
presentation layer fed by hook output. A migration that replaces a live part with a fixture
violates the ScratchNode honesty contract and the `message-live-data` test invariant.

## Migration matrix (from the mapping workflow — 56 files)

**8 migrate / 18 wrap / 30 keep_custom.** The message-render vertical (live path) and the
input composer carry all the high-risk Convex seams; everything domain-shaped (entity
pickers, verification reports, media galleries, memory cards) stays custom.

### message-render

| Custom file | Purpose | Decision | Target primitive | Wiring seam to preserve | Risk |
|---|---|---|---|---|---|
| MessageBubble | Legacy single bubble: avatar, markdown/code, cursor, actions, reasoning | migrate | `message` + `reasoning` | `useSmoothText`; `streamId` → StreamingMessage; LiveThinking/MemoryPreview stay custom | med |
| **UIMessageBubble** (140KB) | THE live UIMessage bubble: parts → text/reasoning/tool/sources + domain cards | wrap | `message`+`reasoning`+`tool`+`sources`; keep selection/arbitrage/media/GoalCard | `useUIMessages(stream:true)`; `useSmoothText` gated on status; `useMessageHandlers()`; on{Company,Person,Event,News,Doc,Regen,Delete,Edit,Feedback}; StreamingStatus | **high** |
| MessageStream | Legacy scroll container + follow-up chips | migrate | `conversation` + `suggestion` | live-token append; onSendFollowUp. *(dead)* | med |
| UIMessageStream | UIMessage[] container: coordinator→child grouping, dedup | wrap | `conversation` shell; keep grouping/dedup | reconcile `useSmartAutoScroll` with StickToBottom. *(dead — live uses VirtualizedMessageList)* | med |
| StreamingMessage | persistent-text-streaming body + cursor | wrap | `message` (MessageResponse); keep hook | **CRITICAL:** `useStream(getStreamBody, .convex.site URL, isDriven, streamId)` — feed hook output to MessageResponse, never a static string | med |
| VirtualizedMessageList | IntersectionObserver windowing | keep_custom | — | THE live perf wrapper; replacing regresses 50+ msg threads | low |
| TypingIndicator | 3-dot loader + status | migrate | `shimmer` | none (only consumer is dead UIMessageStream) | low |
| StreamingStatus | 4-phase telemetry card | keep_custom | — | LIVE in UIMessageBubble; preserve `summarizeStreamingPhases()` | low |
| CitationLink | "See Task" intra-trace anchor | keep_custom | — | onClick(taskId). *(no live consumer)* | low |
| VisualCitation | InlineCitation superscript + arbitrage badges | keep_custom | — | LIVE: shared CitationHighlightProvider across bubble + ArbitrageReportCard | med |

### input

| Custom file | Purpose | Decision | Target primitive | Wiring seam to preserve | Risk |
|---|---|---|---|---|---|
| **InputBar** | Composer: autoresize, send/stop, attachments, model, slash/@mentions/spawn, voice, drag-drop | wrap | `prompt-input` + `context` + `model-selector` | **MUST preserve** `useAction(enhancePrompt)` + onSend/onStop/onSpawn/onVoiceIntent; PromptInput.onSubmit must delegate, not swallow. Slash/mentions/voice/drag-drop stay custom | **high** |
| FileUpload | Upload→ask flow | wrap | `attachments` + input-group | `useAction(uploadFile)`, `useMutation(submitFileQuestion)` | med |
| MediaRecorder | getUserMedia lifecycle | keep_custom | — | preserve track.stop() cleanup | low |
| PromptEnhancer | enhancePrompt preview + diff | keep_custom | — | keep InlineEnhancer signature (InputBar imports it) | med |
| QuickCommandChips | Surface-aware command chips | migrate | `suggestion` | preserve `cmd.navigate` branch inside onClick adapter | low |
| SwarmQuickActions | 4 swarm preset cards | keep_custom | — | onSpawn(query, agents) | low |

### reasoning

| Custom file | Purpose | Decision | Target primitive | Wiring seam to preserve | Risk |
|---|---|---|---|---|---|
| LiveThinking | Latest-activity pill | wrap | `shimmer` + `chain-of-thought` | LIVE: MessageBubble; preserve `hasLiveData` contract + streaming.test invariant | med |
| ThoughtBubble | Single thought + spinner | migrate | `reasoning` | none — DEAD export | low |
| Scratchpad | Agent-state viewer | keep_custom | — | `useQuery(getScratchpad)` if revived (dead) | low |
| CollapsibleAgentProgress | Collapsible answer/process shell | wrap | `task`/`chain-of-thought` + `reasoning` + `tool` | `toolParts: ToolUIPart[]` feed (dead export) | med |
| streamingPhases.ts | 4-phase inference logic | keep_custom | — | consumed by StreamingStatus | low |

### tools-tasks

| Custom file | Purpose | Decision | Target primitive | Wiring seam to preserve | Risk |
|---|---|---|---|---|---|
| ToolCallTransparency | MCP tool-call timeline | migrate | `tool` | status map running/success/error → input-available/output-available/output-error | med |
| ToolResultPopover | Modal result/args/error tabs | wrap | `code-block` + Dialog/Tabs | on{Entity}Select callbacks bridge tool output → mutation | med |
| **StepTimeline** | Delegation/tool/result timeline | wrap | `task`(+`tool`) shell | preserve `toolPartsToTimelineSteps(ToolUIPart[])` ingestion + popover callbacks | **high** |
| ParallelTaskTimeline | Convex parallel verification tree | keep_custom | — | `useQuery(getTaskTree)` live sub | high |
| DecisionTreeKanban | "Pruning Garden" pipeline | keep_custom | — | receives graph prop; preserve onNodeClick | low |
| AgentTasksTab | Live orchestration task list | wrap | `task` list + `context` | `useQuery(listAgentTasksByThread)` live sub | med |
| AgentHierarchy | Sub-agent list + elapsed | wrap | `task` list shell | preserve startedAt/completedAt timing | low |
| SwarmLanesView | Parallel swarm lanes grid | keep_custom | — | TWO live hooks: `useSwarmByThread` + `useLaneEvents` | med |

### sources-media

| Custom file | Purpose | Decision | Target primitive | Wiring seam to preserve | Risk |
|---|---|---|---|---|---|
| SourceCard | Source preview cards + grid | wrap | `sources` + `inline-citation` | presentational; rich extras stay in wrapper | low |
| FusedSearchResults | Multi-source fusion + facets | keep_custom | — | render-precedence UIMessageBubble L2332; preserve isFusionSearchTool gating | med |
| ResourceLinkCard | MCP resource_link + retrieval | keep_custom | — | **CRITICAL:** `useAction(retrieveArtifact)` budget-clamped | med |
| RichMediaSection | Media split composer | keep_custom | — | fed by extractMediaFromText() | low |
| MediaGallery | YouTube/SEC lightbox | keep_custom | — | canonical types imported by 5+ files | med |
| VideoCard | YouTube preview cards | keep_custom | — | fed by ExtractedMedia.youtubeVideos | low |
| FileViewer | PDF/HTML/txt + sandboxed iframe | wrap | `web-preview` | **SECURITY:** per-fileType sandbox differs — override WebPreviewBody per type | med |
| MermaidDiagram | Mermaid + zoom/download + XSS hardening | keep_custom | — | **CRITICAL:** onRetryRequest re-invokes agent; strict securityLevel+SVG sanitize is load-bearing | med |
| LazySyntaxHighlighter | Lazy Prism wrapper | migrate | `code-block` (Shiki) | none — drops ~130KB; keep Canvas/RunCode buttons | low |

### cards-misc

| Custom file | Purpose | Decision | Target primitive | Wiring seam to preserve | Risk |
|---|---|---|---|---|---|
| GoalCard | Goal header + task board | wrap | `plan`(+`task`) shell | tasks[]+isStreaming from parent live state | med |
| HumanRequestCard | HITL question + options + submit | wrap→likely keep | `confirmation` (PARTIAL) | **CRITICAL:** respondToRequest/cancelRequest/recordHumanDecision; confirmation has no textarea/multi-option — keep_custom defensible | **high** |
| ExportMenu | Export MD/JSON/Text | keep_custom | — | pure client-side | low |
| TokenUsageBadge | Token in/out + USD | wrap | `context` | MISMATCH: Context needs maxTokens; keep local MODEL_PRICING | med |
| ThreadList | History sidebar | keep_custom | — | live thread queries; preserve onSelect/Delete/Pin/LoadMore | med |
| Memory | Episodic memory preview | keep_custom | — | `useQuery(getEpisodicByRunId)` 'skip'-gated | low |
| MemoryPreview | Entity memory-quality card | keep_custom | — | `useAction(getMemoryPreview)` | med |
| MemoryPill | Inline system-event pill | keep_custom | — | props-driven | low |
| ProfileCard | Person/entity profile card | keep_custom | — | citationNumber ties to inline citations | low |
| Settings | Settings modal | keep_custom | — | many live seams; embedded ModelSelector could adopt `model-selector` | **high** |

### domain-cards

| Custom file | Purpose | Decision | Target primitive | Wiring seam to preserve | Risk |
|---|---|---|---|---|---|
| CompanySelectionCard | SEC/CIK company picker | keep_custom | — | onSelect→handleCompanySelect→sendStreamingMessage | low |
| NewsSelectionCard | News picker | keep_custom | — | onSelect→handleNewsSelect | low |
| PeopleSelectionCard | Person picker | keep_custom | — | onSelect→handlePersonSelect | low |
| EventSelectionCard | Event picker | keep_custom | — | onSelect→handleEventSelect | low |
| DocumentActionCard | Created/updated doc card | wrap | `artifact` | onDocumentSelect + `nodebench:openDocument` event; Artifact is a div not button | med |
| EditProgressCard | Per-edit status + retry/cancel | wrap | `task` shell | **CRITICAL:** `usePendingEdits(documentId)` live sub; retry/cancel mutations | med |
| ArbitrageReportCard | Verification report | keep_custom | — | data parsed from tool-result; depends on StatusBadge from VisualCitation | low |
| LiveEventCard | Single live agent-event card | migrate | `tool` + task connector | ORPHANED (FAP inlines its own); feed from liveEvents useMemo, never fixtures | med |

## Sequenced implementation plan (value-per-risk)

- **Phase 0 — Shared adapter + de-risk on dead code (low risk).** Build `convexToUIParts`
  once; prove primitives on orphaned files first (ThoughtBubble→reasoning, TypingIndicator→shimmer,
  CollapsibleAgentProgress, MessageStream/UIMessageStream) — they can't break live flows.
- **Phase 1 — Message-render leaf renderers (med).** LazySyntaxHighlighter→code-block (−130KB);
  StreamingMessage→MessageResponse (keep `useStream`); MessageBubble→message+reasoning.
- **Phase 2 — Live UIMessageBubble wrap (HIGH — crown jewel).** Wrap generic sub-parts only;
  domain cards render unchanged inside `MessageContent`. Guard with `MessageBubble.streaming.test`.
- **Phase 3 — Input composer (HIGH).** InputBar→prompt-input (delegate onSubmit→onSend);
  FileUpload→attachments; QuickCommandChips→suggestion.
- **Phase 4 — Reasoning + tools/tasks shells (mixed).** LiveThinking, ToolCallTransparency,
  StepTimeline, AgentTasksTab/AgentHierarchy, ToolResultPopover.
- **Phase 5 — Cards + domain wraps (low-med, opportunistic).** SourceCard, FileViewer (security!),
  TokenUsageBadge, GoalCard, DocumentActionCard, EditProgressCard. Re-evaluate HumanRequestCard
  (likely keep_custom).

## Shared adapter (build once)

`src/features/agents/components/FastAgentPanel/adapters/convexToUIParts.ts` — funnel all
message-render migrations through one parts-parser so "is this a tool-result part?" isn't
re-derived four times (UIMessageBubble, StepTimeline, streamingPhases, FusedSearchResults):

```
convexToUIParts(message: UIMessage): {
  from, text, reasoning, toolParts: ToolUIPart[], sources,
  domainParts: { selection?, arbitrage?, media?, goalCard?, fusedSearch?, documentAction?, editProgress? },
  status, isStreaming,
}
```

`domainParts` is a **pass-through, not a transform** — it routes domain parts to keep_custom
components, never flattens them into a primitive. That boundary is what keeps the honesty
contract intact. Do NOT make the adapter emit persistent-text-streaming bodies — that path
(`useStream`) is a live subscription; StreamingMessage keeps its own hook and plugs into the
same `MessageResponse` target.
