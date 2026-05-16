# Human-Agent Graph Interface

Date: 2026-05-15
Status: Graph Context Bridge v1 implemented

## Goal

NodeBench graphs are not decoration. They are the shared context interface between humans and agents.

The next implementation goal is:

```text
When a human selects a graph node, NodeBench should produce the same durable context packet an agent would want before doing work.
```

Done means:

- The human sees why the node matters, what evidence supports it, and what action is safe next.
- The agent sees a bounded packet with root node, first-ring context, source refs, claim refs, token estimate, and allowed actions.
- The right rail explains the runtime path: memory first, graph context packet, source verification, notebook/export writes only after approval when needed.
- The graph stays bounded. Search and graph expansion should prioritize the nodes that matter instead of rendering every possible edge.

## Questions This Answers

These were the product questions driving the implementation:

- How do human graph needs differ from agent graph needs?
- How do we keep graphs useful when the corpus grows from dozens of nodes to thousands or tens of thousands?
- How does the graph tie back to Convex, Typesense, search, agent tool calls, skills, and runtime context?
- Are we doing unnecessary work by hand-building graph UI instead of using a graph vendor?
- How do we focus attention on nodes that actually matter instead of showing messy graph hairballs?
- How do correlations, causations, reports, artifacts, sources, and entities fit into one navigable model?

## Product Principle

Humans and agents both need context, but at different resolution.

Humans prefer:

- A small visible graph.
- Strong labels and readable hierarchy.
- Full report/notebook jumps.
- Facets, search, and visual shelves.
- Clear next actions.

Agents prefer:

- Bounded root neighborhoods.
- Typed handles.
- Source and claim references.
- Hybrid retrieval: keyword, BM25, semantic, graph links, and recent runtime traces.
- Explicit approval gates and allowed actions.

The UI should therefore show fewer nodes than the agent can inspect.

## Promotion Classes

Every candidate graph item should fall into one of four classes:

```text
visible      shown in the graph immediately
shelf        shown as a ranked row/card/list near the graph
searchable   available through Cmd-K, Typesense, or filtered graph search
on_demand    hidden until the agent or user expands a specific relationship
```

This is the main answer to scale. NodeBench should not render 10,000 nodes at once. It should render the working set and keep the rest queryable.

## Graph Context Bridge Packet

`src/features/redesign/lib/graphContextBridge.ts` defines the v1 packet.

It produces:

- `contextRef`
- `rootUri`
- `title`
- `promotionClass`
- `attentionScore`
- `humanRank`
- `agentRank`
- `visibleNodes`
- `packedNodes`
- `edges`
- `sourceRefs`
- `claimRefs`
- `estimatedTokens`
- `approvalRequired`
- `allowedActions`
- `blockedActions`
- `whySelected`
- `humanSummary`
- `agentSummary`

The packet is intentionally conservative. It is a bridge object for UI and runtime traces, not a new source of truth.

## Runtime Connection

The runtime trace now includes graph context as a first-class step.

Expected high-level path:

```text
User asks or selects a graph node
  -> search_memory
  -> resolve_report_graph_context
  -> search_report_context
  -> verify_sources
  -> suggest_related
  -> patch_notebook or create_followup only when safe
```

`convex/domains/redesign/chatRuns.ts` includes:

- `graph_context_packet` as a context candidate.
- `resolve_report_graph_context` as a low-risk, zero-cost tool decision.
- `resolve bounded report graph context` as a success criterion.

Fallback client traces in `useRedesignChatRun.ts` expose the same graph-context lane so the UI does not imply the runtime forgot graph context when no live run is available.

## UI Surfaces

### Reports Graph

`ReportsSurface.tsx` now shows an Agent context packet in the graph peek card after a node is selected.

The packet explains:

- why the item entered context,
- how many graph nodes were packed,
- how many source and claim refs are attached,
- estimated token footprint,
- whether review is required before notebook/export writes.

### Right Rail

`RightInspector.tsx` now treats selected artifacts as graph packets, not just passive previews.

The Graph tab shows:

- patch-ready vs review-gated state,
- agent summary,
- human rank,
- agent rank,
- packed node count.

### Chat Rail

`ChatSurface.tsx` now shows graph context in agent progress and run details:

- Resolve graph context packet.
- Graph context bridge.
- Graph context agent.
- Cost/cache line includes graph node count when context exists.

This makes the chat page explain how the agent used memory and graph context before live search or paid work.

### Prototype Reports Rail

`HomeV2PrototypeSurface.tsx` now exposes the same packet in the reports prototype rail so the static parity surface matches the runtime story.

## Scaling Boundary

For thousands or tens of thousands of graph objects, the right implementation direction is:

```text
Convex = source of truth and permissions
Typesense = snappy text/vector/facet retrieval
Graph query layer = bounded typed neighborhoods
Frontend graph = working set only
Agent packet = larger but still token-bounded context
```

Frontend graph rules:

- Do not draw every node.
- Start with root plus strongest first-ring relationships.
- Cluster low-priority items.
- Show hidden counts.
- Let search/facets promote hidden items into the working set.
- Prefer shelves and tables for bulk review.
- Use graph layout only when relationships matter visually.

## Vendor And Maintainability Decision

For v1, keep the custom graph because it is already integrated with:

- report cards,
- artifact previews,
- Convex live artifacts,
- notebook actions,
- prototype parity surfaces,
- agent runtime traces.

Do not over-invest in a bespoke graph engine. Reassess when any of these become true:

- visible graph exceeds a few hundred nodes routinely,
- layout work dominates product work,
- edge filtering becomes hard to reason about,
- collaboration or whiteboard interactions become core,
- performance cannot stay smooth with bounded views.

At that point, evaluate a dedicated graph/canvas library, but keep the context packet contract. The packet is more important than the renderer.

## Verification

Current v1 checks:

- Unit test: compact packet from report/detail.
- Unit test: approval gate on sparse or review-heavy packets.
- Unit test: server-bounded neighborhood metadata appears in rationale.
- Browser: Reports graph selection produces `data-active-context-ref` and visible packet.
- Browser: Chat rail shows graph context progress, run detail, and graph context agent.
- Build and TypeScript checks pass.

## Next Boundary

The next implementation should connect this packet to actual backend retrieval:

```text
resolve_report_graph_context(args)
  -> load report / artifact from Convex
  -> fetch bounded graph neighborhood
  -> attach source refs and claim refs
  -> return GraphContextBridgePacket-compatible data
  -> persist in agent run trace
```

After that, Typesense can promote hidden graph nodes into the packet through search, rather than relying only on the current selected live artifact.
