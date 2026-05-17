# Expandable Graph Notebook — Architecture

The critical missing feature: Ideaflow-style expandable mention nodes with
backlink cross-linking, web-grounded agent expansion, and lazy infinite
traversal.  Every mention is a live graph node.  Click to drill.  Agent
enriches with Linkup search.  Backlinks cross-reference bidirectionally.

## Prior art

- **Ideaflow** — `MentionNode` + `parseOutlineAndPersist` + `AiSearchSidebar.runEnrichment`
  (codebase analysis in `D:\VSCode Projects\Ideaflow\latest-main-mew\mew`)
- **Anthropic** — "Building Effective Agents" (2024), orchestrator-workers
- **Roam Research** — bidirectional backlinks as first-class graph primitives
- **Notion** — `@mention` inline references with hover previews
- **Obsidian** — local graph view, backlinks panel, transclusion

---

## 1. What Exists (reuse, don't rebuild)

| Component | Table / File | Shape |
|-----------|-------------|-------|
| Entity graph | `entityProfiles` | canonicalName, entityType, wikidataId, aliases |
| Entity mentions | `entityMentions` | entityId → sourceType + sourceId + mentionType |
| Knowledge graph | `knowledgeGraphs` | sourceType, sourceId, clusterId |
| SPO triples | `graphClaims` | subject, predicate, object, claimText, sourceDocIds |
| Claim edges | `graphEdges` | fromClaimId → toClaimId, edgeType (supports/contradicts/etc.) |
| Claim evidence | `claimEvidence` | claimId → artifactEntityId, sourceSnippet, confidence |
| Source registry | `sourceRegistry` | domain, category, isPinned, isActive |
| Document nodes | `nodes` | documentId, parentId, type, text, json |
| Document relations | `relations` | from, to, relationTypeId |
| Relation types | `relationTypes` | name, icon |
| Deep diligence | `deepDiligence.ts` | 6-branch Linkup+Gemini search, `searchWithFallback()` |
| Tiptap/BlockNote | `UnifiedEditor.tsx` | Full editor with 15+ extensions, Convex sync |
| Agent swarms | `agentSwarms` + `swarmAgentTasks` | Parallel agent coordination |

**Key insight**: Linkup search is ALREADY wired in `deepDiligence.ts` line 560:
```
fetch("https://api.linkup.so/v1/search", {
  headers: { Authorization: `Bearer ${linkupKey}` },
  body: JSON.stringify({ q: query, depth: "standard", outputType: "searchResults" })
})
```

---

## 2. What's Missing (build these)

### 2.1 New Convex Tables

```typescript
// convex/schema.ts — additions

// ── Expansion Runs ──────────────────────────────────────────────────
// Tracks each mention expansion: who clicked, what was searched, what was found.
// Pattern: async_reliability — 202 + runId, idempotency, bounded retries.
expansionRuns: defineTable({
  // Identity
  runId: v.string(),                    // sha256(entityId + userId + timestamp)
  userId: v.string(),
  
  // Target
  targetEntityId: v.id("entityProfiles"),
  targetBlockId: v.optional(v.string()),  // Block where expansion was triggered
  targetDocumentId: v.optional(v.id("documents")),
  
  // Execution
  status: v.union(
    v.literal("queued"),
    v.literal("searching"),           // Linkup search in progress
    v.literal("extracting"),          // Gemini extraction in progress
    v.literal("persisting"),          // Writing graph nodes
    v.literal("completed"),
    v.literal("partial"),             // Some branches succeeded
    v.literal("failed"),
  ),
  
  // Results
  claimsCreated: v.number(),           // SPO triples added
  edgesCreated: v.number(),            // Graph edges added
  sourcesFound: v.number(),            // Web sources discovered
  
  // Budget
  searchQueries: v.number(),           // Linkup calls made
  maxSearchQueries: v.number(),        // Budget cap (default: 5)
  wallClockMs: v.optional(v.number()), // Total execution time
  
  // Error handling
  errorMessage: v.optional(v.string()),
  retryCount: v.number(),
  
  // Timestamps
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index("by_entity", ["targetEntityId"])
  .index("by_user", ["userId", "createdAt"])
  .index("by_status", ["status"])
  .index("by_runId", ["runId"]),

// ── Backlinks ───────────────────────────────────────────────────────
// Bidirectional cross-references between entities/blocks/documents.
// Created automatically when a mention is inserted or when an agent
// discovers a relationship during expansion.
backlinks: defineTable({
  // Source (who references)
  sourceType: v.union(
    v.literal("block"),               // A paragraph/heading mentioning an entity
    v.literal("claim"),               // A knowledge graph claim
    v.literal("document"),            // A document-level reference
    v.literal("signal"),              // A daily brief signal
    v.literal("action"),              // An action item referencing an entity
  ),
  sourceId: v.string(),               // ID of the referencing object
  sourceDocumentId: v.optional(v.string()),
  sourceContext: v.optional(v.string()),  // Surrounding text snippet (≤200 chars)
  
  // Target (who is referenced)
  targetEntityId: v.id("entityProfiles"),
  
  // Metadata
  backlinkType: v.union(
    v.literal("mention"),             // @mention in editor
    v.literal("citation"),            // Source citation
    v.literal("relatedTo"),           // Semantic relationship
    v.literal("causes"),              // Causal relationship
    v.literal("contradicts"),         // Contradicting claim
    v.literal("supports"),            // Supporting evidence
    v.literal("derived"),             // Agent-discovered link
  ),
  confidence: v.optional(v.number()),  // 0-1, only for derived links
  
  // Provenance
  createdBy: v.union(
    v.literal("user"),                // Manual mention insertion
    v.literal("agent"),               // Agent expansion discovered this
    v.literal("system"),              // Automatic extraction
  ),
  agentRunId: v.optional(v.string()), // Which expansion created this
  
  createdAt: v.number(),
})
  .index("by_target", ["targetEntityId", "backlinkType"])
  .index("by_source", ["sourceType", "sourceId"])
  .index("by_document", ["sourceDocumentId"])
  .index("by_agent_run", ["agentRunId"]),

// ── Expansion Snapshots ─────────────────────────────────────────────
// Cached expanded content for each entity. Prevents re-expansion
// and enables instant preview on hover.
expansionSnapshots: defineTable({
  entityId: v.id("entityProfiles"),
  
  // Cached content (refreshed on each expansion)
  summary: v.string(),                 // 2-3 sentence entity summary
  keyFacts: v.array(v.string()),       // Top 5 bullet facts
  recentClaims: v.array(v.object({
    claimText: v.string(),
    predicate: v.string(),
    confidence: v.boolean(),           // isHighConfidence from graphClaims
    sourceUrl: v.optional(v.string()),
  })),
  backlinkCount: v.number(),           // How many things reference this entity
  lastExpanded: v.number(),            // Timestamp of last expansion
  
  // Staleness detection
  version: v.number(),                 // Increments on each expansion
  staleAfterMs: v.number(),            // Default: 24 hours
})
  .index("by_entity", ["entityId"]),
```

### 2.2 Expansion Flow

```
User clicks [⊕ Expand] on mention chip
         │
         ▼
┌─────────────────────────┐
│  Client: startExpansion  │  Creates expansionRuns row (status: "queued")
│  mutation (< 50ms)       │  Returns runId to client
└──────────┬──────────────┘
           │ ctx.scheduler.runAfter(0, ...)
           ▼
┌─────────────────────────┐
│  expandEntity action     │  Convex action (can call external APIs)
│                          │
│  1. Check idempotency    │  sha256(entityId + userId) → reject if active run
│  2. Linkup search        │  3-5 queries, "standard" depth
│  3. Gemini extraction    │  Parse search results → SPO triples
│  4. Deduplicate          │  Match against existing graphClaims
│  5. Persist graph patch  │  New claims + edges + backlinks (mutation)
│  6. Update snapshot      │  Cached summary for instant hover preview
│  7. Status → completed   │
└──────────┬──────────────┘
           │ Convex reactivity pushes to client
           ▼
┌─────────────────────────┐
│  UI: mention node        │  Expands inline showing:
│  re-renders              │  • Summary + key facts
│                          │  • New claims with source links
│                          │  • Backlinks ("Referenced by 3 other notes")
│                          │  • [⊕ Expand deeper] for next level
└─────────────────────────┘
```

### 2.3 Mention Node in Tiptap

Extend the existing BlockNote/Tiptap editor with an expandable mention:

```typescript
// src/features/editor/extensions/ExpandableMention.ts

/**
 * Custom Tiptap node that renders as an inline mention chip
 * but can expand to show entity intelligence inline.
 *
 * States:
 *   collapsed: "@Anthropic" chip (default)
 *   loading:   "@Anthropic ◑" chip with spinner
 *   expanded:  "@Anthropic" chip + inline expansion panel below
 *
 * Attrs stored in Tiptap JSON:
 *   id: entityProfiles._id
 *   label: display text
 *   entityType: "person" | "company" | "topic" | etc.
 *   expanded: boolean (UI state, not persisted)
 */
```

### 2.4 Backlink Panel

When viewing any entity (via mention expansion or entity page):

```
┌─────────────────────────────────────────┐
│  Anthropic                    [⊕ Expand]│
│  AI safety company, founded 2021        │
│                                         │
│  ── Key Facts ──────────────────────────│
│  • $4B Series E at $60B valuation       │
│  • Claude 4.7 Opus released May 2026    │
│  • 1,200+ employees                     │
│                                         │
│  ── Referenced By (12) ─────────────────│
│  📄 Daily Brief — "AI infrastructure…" │
│  📄 Meeting notes — "vendor review…"    │
│  📊 Report: Anthropic Q2 Diligence      │
│  💬 Thread: "Should we migrate to…"     │
│  ···show 8 more                         │
│                                         │
│  ── Related Entities ───────────────────│
│  → Google (investor)                    │
│  → OpenAI (competitor)                  │
│  → Dario Amodei (CEO)                   │
│  ···show more                           │
│                                         │
│  ── Sources (5) ────────────────────────│
│  [1] sec.gov/edgar/... (verified)       │
│  [2] reuters.com/... (tier 2)           │
│  [3] techcrunch.com/... (tier 2)        │
└─────────────────────────────────────────┘
```

---

## 3. Expansion Agent Tools

The expansion agent gets 5 bounded tools:

```typescript
const EXPANSION_TOOLS = [
  {
    name: "linkup_search",
    description: "Search the web via Linkup for entity intelligence",
    // Budget: max 5 calls per expansion run
    // Uses existing searchWithFallback() from deepDiligence.ts
  },
  {
    name: "read_entity_graph",
    description: "Read existing claims and edges for an entity",
    // Reads: graphClaims where subject matches entity
    // BOUND_READ: max 100 claims returned
  },
  {
    name: "read_backlinks",
    description: "Read what references this entity across the notebook",
    // Reads: backlinks where targetEntityId matches
    // BOUND_READ: max 50 backlinks returned
  },
  {
    name: "propose_graph_patch",
    description: "Propose new claims, edges, and backlinks to add",
    // Agent NEVER writes directly — proposes a structured patch
    // Patch is validated by Convex mutation before applying
  },
  {
    name: "resolve_entity",
    description: "Look up or create an entity in the graph",
    // Uses existing resolveEntity() from deepDiligence.ts
    // Deduplicates by canonicalName + aliases
  },
];
```

### 3.1 Graph Patch Contract

The agent proposes changes; a Convex mutation validates and applies:

```typescript
interface GraphPatch {
  targetEntityId: string;
  
  // New SPO triples to add
  newClaims: Array<{
    subject: string;
    predicate: string;
    object: string;
    claimText: string;
    sourceUrls: string[];
    sourceSnippets: string[];
    isHighConfidence: boolean;
  }>;
  
  // New edges between claims
  newEdges: Array<{
    fromClaimSubject: string;  // Matched to existing/new claim
    toClaimSubject: string;
    edgeType: "supports" | "contradicts" | "mentions" | "causes" |
              "relatedTo" | "partOf" | "precedes";
  }>;
  
  // New backlinks discovered
  newBacklinks: Array<{
    sourceType: "claim" | "document" | "signal";
    sourceId: string;
    backlinkType: "relatedTo" | "causes" | "supports" | "derived";
    confidence: number;
  }>;
  
  // Entity snapshot update
  snapshotUpdate: {
    summary: string;
    keyFacts: string[];
  };
}
```

### 3.2 Patch Validation (Convex Mutation)

```typescript
// convex/domains/graph/applyGraphPatch.ts

/**
 * Validates and applies a graph patch proposed by the expansion agent.
 *
 * Invariants:
 *   BOUND — max 50 claims, 100 edges, 50 backlinks per patch
 *   HONEST_STATUS — returns actual counts, not claimed counts
 *   DETERMINISTIC — deduplicate by (subject, predicate, object) triple
 *   SSRF — sourceUrls validated before storing
 */
```

---

## 4. Lazy Infinite Expansion

The graph grows indefinitely over time, but every query is bounded:

| Bound | Limit | Why |
|-------|-------|-----|
| Depth per click | 1 level | User clicks to go deeper |
| Claims per expansion | 50 | Prevent single expansion from flooding graph |
| Edges per expansion | 100 | Reasonable relationship density |
| Backlinks returned | 50 | UI pagination for more |
| Search queries per run | 5 | Linkup API budget |
| Sources per run | 10 | Reasonable evidence set |
| Wall clock per run | 60s | Convex action timeout |
| Entity dedup | canonicalName + aliases | Prevent duplicate entities |
| Claim dedup | (subject, predicate, object) triple | Prevent duplicate facts |

Each expansion adds more graph facts.  User can expand again from any
new mention or backlink.  The graph is unbounded over time, but every
single query/action has explicit budgets.

---

## 5. Integration with Home Daily Brief

The Home surface becomes the **primary expansion surface**:

| Home Section | Graph Integration |
|---|---|
| BLUF signals | Each entity mentioned becomes an expandable mention |
| Report carousel cards | Each card is a mini entity node — click to expand |
| Change cards | Entity name in header is expandable |
| Competing explanations | Entities referenced in explanations are expandable |
| Watch events | Event entities are expandable |
| Actions table | Linked entities are expandable |
| Briefing agent | Agent can call `expand_entity` as a tool |

### 5.1 Signal → Mention Extraction

During brief generation (6 AM cron), extract entity mentions from signals:

```typescript
// In dailyMorningBrief.ts, after signal extraction:
for (const signal of signals) {
  const entities = await resolveEntitiesInText(signal.title + " " + signal.summary);
  for (const entity of entities) {
    await ctx.runMutation(api.domains.graph.createBacklink, {
      sourceType: "signal",
      sourceId: signal._id,
      targetEntityId: entity._id,
      backlinkType: "mention",
      createdBy: "system",
    });
  }
}
```

---

## 6. State Machines

### 6.1 Expansion Run Lifecycle

```
┌─────────┐  startExpansion()  ┌────────────┐
│  (none)  │──────────────────▶│  queued     │
└─────────┘                    └─────┬──────┘
                                     │ scheduler fires
                                     ▼
                               ┌────────────┐
                               │  searching  │ Linkup API calls
                               └─────┬──────┘
                                     │ results received
                                     ▼
                               ┌────────────┐
                               │ extracting  │ Gemini parses → SPO triples
                               └─────┬──────┘
                                     │ extraction complete
                                     ▼
                               ┌────────────┐
                               │ persisting  │ Graph patch applied
                               └─────┬──────┘
                              ╱      │
                 some fail   ╱       │ all succeed
                            ╱        │
                     ┌─────────┐  ┌──────────┐
                     │ partial  │  │completed │
                     └─────────┘  └──────────┘
```

### 6.2 Mention Chip States

```
┌────────────┐  click [⊕]   ┌────────────┐
│  collapsed  │─────────────▶│  loading    │
│  @Entity    │              │  @Entity ◑  │
└──────┬─────┘              └─────┬──────┘
       │                          │ expansion complete
       │                          ▼
       │                    ┌────────────┐
       │                    │  expanded   │
       │                    │  @Entity    │
       │                    │  + panel    │
       │  click collapse    └─────┬──────┘
       │◀─────────────────────────┘
```

---

## 7. Reliability Invariants

Per `.claude/rules/agentic_reliability.md`:

| Check | Applied to | Implementation |
|-------|-----------|----------------|
| **BOUND** | Claims per patch | Max 50, reject overflow |
| **BOUND** | Backlinks per query | Max 50, paginated |
| **HONEST_STATUS** | Expansion run status | Never "completed" if any branch failed → "partial" |
| **HONEST_SCORES** | Claim confidence | `isHighConfidence` from evidence, never hardcoded true |
| **TIMEOUT** | Expansion action | 60s AbortController, per-search 10s timeout |
| **SSRF** | Source URLs from Linkup | Validate before storing (no internal IPs) |
| **BOUND_READ** | Linkup response body | 512KB cap per response |
| **ERROR_BOUNDARY** | Mention expansion UI | Error boundary per mention panel |
| **DETERMINISTIC** | Claim dedup | (subject, predicate, object) triple hash |

---

## 8. File Inventory

| File | Purpose | Status |
|------|---------|--------|
| `docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md` | This document | ✅ |
| `convex/domains/graph/expandEntity.ts` | Expansion action (Linkup + Gemini + persist) | ✅ Created |
| `convex/domains/graph/applyGraphPatch.ts` | Validate + apply graph patch mutation | ✅ Created |
| `convex/domains/graph/backlinkQueries.ts` | Backlink lookup queries | ✅ Created |
| `convex/domains/graph/expansionQueries.ts` | Expansion run status queries | ✅ Created |
| `convex/domains/graph/index.ts` | Barrel exports for graph domain | ✅ Created |
| `src/features/editor/extensions/ExpandableMention.ts` | Tiptap mention extension | ⬜ Create |
| `src/features/graph/components/MentionExpansionPanel.tsx` | Inline expansion panel | ⬜ Create |
| `src/features/graph/components/BacklinkList.tsx` | Backlink cross-reference list | ⬜ Create |
| `src/features/graph/hooks/useEntityExpansion.ts` | Expansion trigger + status hook | ⬜ Create |
| `src/features/graph/hooks/useBacklinks.ts` | Backlink query hook | ⬜ Create |
| `convex/domains/search/deepDiligence.ts` | Existing — `searchWithFallback()` reused | ✅ Exists |
| `src/features/editor/components/UnifiedEditor.tsx` | Existing — register new extension | ✅ Exists |

---

## 9. Migration Plan

### Phase 1: Schema + Backend (Week 1) ✅ DONE
1. ✅ Added `expansionRuns`, `backlinks`, `expansionSnapshots` tables to schema
2. ✅ Created `expandEntity` action (Linkup + Gemini, idempotency, bounded)
3. ✅ Created `applyGraphPatch` mutation with SSRF + dedup + bound validation
4. ✅ Created `backlinkQueries` with 6 indexed lookups + backlink summary
5. ✅ Created `expansionQueries` with status subscriptions + active run tracking
6. ✅ 29 scenario-based tests (SSRF, dedup, bounds, state machine, backlink taxonomy)
7. ⬜ Wire expansion runs to entity mentions during brief generation

### Phase 2: Tiptap Extension (Week 2)
6. Create `ExpandableMention` Tiptap node type
7. Register in UnifiedEditor extension list
8. Build `MentionExpansionPanel` React component
9. Build `BacklinkList` component
10. Wire `useEntityExpansion` hook to Convex subscriptions

### Phase 3: Home Integration (Week 3)
11. Add expandable mentions to BLUF signal text
12. Add expansion CTA to report carousel cards
13. Wire briefing agent `expand_entity` tool
14. Add entity hover preview using `expansionSnapshots`

### Phase 4: Cross-Linking + Polish (Week 4)
15. Auto-extract entity mentions from new documents (background job)
16. Backlink count badges on entity mentions
17. Graph visualization (mini force-directed view)
18. Keyboard shortcuts for expansion (Enter on focused mention)
