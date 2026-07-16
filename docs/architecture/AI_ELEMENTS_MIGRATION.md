# AI Elements Migration

Scaffolding NodeBench's AI-chat UI onto [Vercel AI Elements](https://elements.ai-sdk.dev/)
primitives so we maintain thin wrappers instead of ~80 hand-rolled components.

_Last updated: 2026-07-14. Canonical source: `origin/main` through PR #527
(`28d704b2`)._

## Why

The FastAgentPanel carries ~56 custom AI-surface components (message bubbles,
streaming, input, reasoning, tool calls, sources, loaders, code blocks). AI Elements
ships these as owned, upgradeable source built on shadcn/ui — so "our components" become
thin adapters over canonical primitives, not full custom implementations to self-maintain.

## Scaffold status — MERGED

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
- The scaffold landed on `origin/main` in PR #516 (`c83a41c8`). Verification
  claims for later revisions belong to the exact revision that was tested; a
  historical green command is not reused as proof for current main.

## Consumer layer — MERGED

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

## Design governance (design dir + UI contract dir)

Modeled on NodeRoom (`src/design/designSystem.ts` + `docs/design/ui-contract/`):

- **Design dir — [`src/design/designSystem.ts`](../../src/design/designSystem.ts)**:
  the machine-readable AI-surface design system. Canonical tokens (terracotta
  `#d97757`, glass hairline, JetBrains Mono), the `compose-don't-surrender` +
  honesty principles, and a per-primitive `must/avoid` + adoption manifest
  (`getNodeBenchAiDesignManifest()`). `auditAiSurfaceDesign()` reuses the
  existing `src/design-governance/` linter (does NOT re-implement rules).
  Tested by `src/design/designSystem.test.ts` (`npm run test:design`, 11 scenario tests).
- **UI contract dir — [`docs/design/UI_CONTRACT.md`](../design/UI_CONTRACT.md) +
  [`docs/design/ui-contract/`](../design/ui-contract/)**: the visual-authority
  order, DNA tokens, migration rule (Presentation/Adapter/Tiny-fix), the AI
  Elements adoption table, and the dated before/after proof protocol
  (`ui-contract/README.md` + `manifest.schema.json`).
- **Enforcement** stays `npm run lint:design` (`src/design-governance/`). The
  manifest describes; the linter enforces. Note: the `.mjs` linter has drifted
  extra inlined patterns vs. `defaultSpec.ts` — the audit here uses the canonical
  `defaultSpec.ts`; reconciling the two is a tracked follow-up.

## Current delivery status — 11/26 complete, migration ongoing

The runbook scoreboard is **11/26 component decisions complete**. It does not
close the broader 56-file component migration.

| Milestone | Canonical main source | State |
|---|---|---|
| TypingIndicator, ThoughtBubble, QuickCommandChips, LazySyntaxHighlighter, AgentHierarchy, SourceCard | PR #516 · `c83a41c8` | migrated/wrapped |
| Full-source code-token cache identity | PR #517 · `988a3f56` | compatibility fix |
| `convexToUIParts` shared adapter | PR #521 · `30688119` | merged adapter |
| CollapsibleAgentProgress | PR #523 · `a4fe5ee3` | wrapped source; **not a live-render claim** |
| ToolCallTransparency | PR #524 · `64203ded` | migrated |
| UIMessageBubble | PR #525 · `165ecec2` | wrapped |
| InputBar + explicit send-contract seam | PR #526 · `3cc7cd06` | wrapped |
| LiveEventCard + shared live-event derivation | PR #527 · `28d704b2` | migrated |

The scoreboard counts 11 completed component decisions in the matrix. The
shared adapter is required foundation but is tracked separately from the
numerator. Its denominator is the original 26 candidate rows: 8 `migrate`, 17
`wrap`, and the transitional HumanRequestCard `wrap→likely keep` review. The
other 30 rows are explicit `keep_custom`. HumanRequestCard remains operationally
keep-custom unless a future contract review preserves every HITL semantic.

**Shiki build guard:** LazySyntaxHighlighter made Shiki reachable. The PR #516
Vite change leaves `@shikijs/*` out of `manualChunks`, routes grammar/theme
chunks to `assets/shiki/`, and excludes that directory from service-worker
precache. Curating Shiki to a language allowlist remains blocked by the package's
export map. Do not infer current bundle sizes from the historical migration run;
measure the exact build being released.

## Migration matrix (from the mapping workflow — 56 files)

**Original 56 rows: 8 migrate / 17 wrap / 30 keep_custom / 1 transitional
`wrap→likely keep` review (HumanRequestCard).** The program denominator of 26
counts that transitional row with the migration candidates. Operationally,
HumanRequestCard stays inside the keep-custom boundary unless a future contract
review proves full parity. This is a planning matrix, not a completion claim.
Completed units are listed above; all other rows remain ongoing until their
exact source and verification evidence land.

### message-render

| Custom file | Purpose | Decision | Target primitive | Wiring seam to preserve | Risk |
|---|---|---|---|---|---|
| MessageBubble | Legacy single bubble: avatar, markdown/code, cursor, actions, reasoning | removed | — | Zero runtime consumers; canonical rendering is UIMessageBubble | none |
| **UIMessageBubble** (140KB) | THE live UIMessage bubble: parts → text/reasoning/tool/sources + domain cards | wrap | `message`+`reasoning`+`tool`+`sources`; keep selection/arbitrage/media/GoalCard | `useUIMessages(stream:true)`; `useSmoothText` gated on status; `useMessageHandlers()`; on{Company,Person,Event,News,Doc,Regen,Delete,Edit,Feedback}; StreamingStatus | **high** |
| MessageStream | Legacy scroll container + follow-up chips | removed | — | Zero runtime consumers | none |
| UIMessageStream | UIMessage[] container: coordinator→child grouping, dedup | removed | — | Zero runtime consumers; live uses VirtualizedMessageList | none |
| StreamingMessage | Legacy persistent-text-streaming renderer and HTTP driver | removed | — | Zero runtime consumers; bearer stream reads and `/api/chat-stream` were removed with it | none |
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
| ParallelTaskTimeline | Unreachable parallel-task projection | removed | — | Zero runtime consumers; public task-tree controls were removed | none |
| DecisionTreeKanban | Unreachable "Pruning Garden" projection | removed | — | Zero runtime consumers | none |
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

## Sequenced implementation plan

- **Completed foundation:** scaffold + six leaves (#516), shared adapter (#521),
  CollapsibleAgentProgress (#523), ToolCallTransparency (#524), UIMessageBubble
  (#525), InputBar (#526), and LiveEventCard (#527).
- **Next message/input leaves:** FileUpload and LiveThinking. MessageBubble,
  MessageStream, UIMessageStream, and StreamingMessage were removed after
  reachability checks proved they had no runtime consumers.
- **Then tool/task shells:** ToolResultPopover, StepTimeline, and AgentTasksTab.
  Preserve live queries, timeline ingestion, and entity callbacks.
- **Then bounded cards:** FileViewer, TokenUsageBadge, GoalCard,
  DocumentActionCard, and EditProgressCard. FileViewer sandbox policy and edit
  mutations are security/behavior seams, not presentation details.
- **Keep custom:** HumanRequestCard and every domain/proof surface named in the
  keep-custom matrix. Revisit only with an explicit product-contract review.

Each slice is source-complete only after its tests pass. Visual-proof-complete,
preview-verified, and production-live-verified remain separate later states.

## Shared adapter (merged in #521)

`src/features/agents/components/FastAgentPanel/adapters/convexToUIParts.ts`
funnels message-render migrations through one parts parser so part identity is
not re-derived independently in every renderer:

```
convexToUIParts(message: UIMessage): {
  from, text, reasoning, toolParts: ToolUIPart[], sources,
  domainParts: { selection?, arbitrage?, media?, goalCard?, fusedSearch?, documentAction?, editProgress? },
  status, isStreaming,
}
```

`domainParts` is a **pass-through, not a transform**. It routes domain parts to
keep-custom components and never flattens them into a primitive. The adapter
must not emit legacy persistent-text-streaming bodies. The unreferenced
StreamingMessage client, bearer-ID reads, and `/api/chat-stream` driver were
removed; canonical FastAgent output is the owner-scoped UIMessage path.
