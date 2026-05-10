# Typesense Integration Plan

> **Status**: scoping doc only. No code in this PR. Implementation deferred to
> the 5-PR sequence in §6 once the open questions in §8 are resolved.

> **Scope**: introduce Typesense as the read/search index sitting in front of
> Convex (the source of truth) for the 5 product surfaces that today use
> Convex `withSearchIndex` queries plus the agent's natural-language entity
> retrieval. **No replacement of any existing canonical store.**

> **Author**: scoped from a verbatim user spec on 2026-05-10. Spec captured
> verbatim in §0 below.

---

## §0 — User spec (captured verbatim, abbreviated)

```
Convex = source of truth
Typesense = fast read/search index
pi-ai agent = reasoning + tool calling
NodeBench UI = reports, cards, notebook, graph, export
```

7 collections: `nb_entities`, `nb_reports`, `nb_notebook_blocks`, `nb_claims`,
`nb_sources`, `nb_captures`, `nb_threads`. Add `nb_edges` later.

7 human UI surfaces: Cmd-K palette, Reports compact browser, Entity autocomplete
in Chat, Notebook block search, Relationship shelves, Event corpus explorer,
Similar entity discovery.

4 agent tools: `search_memory`, `lookup_entity`, `search_report_context`,
`suggest_related`.

5 PRs in order: (1) Index contracts + sync queue, (2) Search API
(federated `multi_search`), (3) Human UX (Cmd-K + Reports + autocomplete +
notebook + event corpus), (4) Agent tools, (5) QA + eval.

Security: scoped search keys with embedded `filter_by` for multi-tenant; access
fields on every doc (`accessibleUserIds`, `accessibleTeamIds`,
`accessibleOrgIds`, `visibility`).

Sync model: `Convex mutation → enqueue index event → index worker → upsert
Typesense → write index status`. Idempotent jobs with
`objectType, objectId, version, op, checksum`.

---

## §1 — What already exists in NodeBench for search

### 1.1 The search route (HTTP entry point)

**`server/routes/search.ts`** (4360 lines, single file, 50+ branches)
- POST `/search`. Body: `{ query, lens?, daysBack? }`. Returns `ResultPacket`.
- Routes queries to MCP tool calls based on hand-rolled classification at
  `server/routes/search.ts:1153-2370` (founder weekly reset, important change,
  pre-delegation, company_search, competitor, multi_entity, fallback dump).
- Built-in 4-layer grounding pipeline (per `.claude/rules/grounded_eval.md`):
  retrieval confidence → claim grounding filter → grounded judge → citation
  chain.
- This route is **the front door** for Search Canvas. It does NOT today index
  anything in Typesense. **Typesense will live alongside this route**, not
  replace it. `search.ts` stays as the orchestration + LLM-pipeline layer;
  Typesense replaces the per-Convex-table `withSearchIndex` calls that today
  back the entity / report / notebook lookups inside the branches.

### 1.2 MCP tool for entity discovery

**`packages/mcp-local/src/tools/entityLookupTools.ts`** (~155 lines)
- Exposes one tool: `entity_lookup(name, depth)`.
- **Today does WEB lookups** (Gemini grounding → Wikipedia fallback). No DB
  index involved.
- Returns: `{ name, type, summary, facts, signals, sources, confidence,
  nextTools }`.
- **Typesense will give this tool a "memory-first" path**: hit
  `nb_entities` first, fall back to web only when no canonical match.

### 1.3 Progressive Discovery (tool registry, not entity)

**`packages/mcp-local/src/tools/progressiveDiscoveryTools.ts`** (~644 lines)
- 14-strategy hybrid search **over the 350-tool registry, not over user data**.
- Already has neural embedding RRF, TF-IDF, fuzzy, regex, prefix, semantic
  expansion, transitive co-occurrence.
- **No overlap** with the Typesense plan. This is the in-process tool
  recommender. Leave untouched.

### 1.4 Convex-side existing search (today's "search")

`Grep withSearchIndex convex/` returns **27 call sites across 16 files**. The
ones that matter for the Typesense plan:

| File | Index | Purpose | Replace with Typesense? |
|---|---|---|---|
| `convex/domains/documents/search.ts:61` | `documents.search_title` | InstantSearchBar landing page dossier search | **Yes — `nb_reports`** |
| `convex/domains/documents/documents.ts:730,1187,1206,1216` | `documents.search_title`, `documents.search_content` | Document list/sidebar search | **Yes — `nb_notebook_blocks` (`pageType=document`)** |
| `convex/domains/documents/artifacts/evidenceSearch.ts:36-69` | `artifactChunks.search_text` | Per-artifact chunk search | **Yes — `nb_sources` (`chunkVersion=1`)** |
| `convex/domains/knowledge/entityContexts.ts:316` | `entityContexts.search_entity` | Entity-by-name lookup | **Yes — `nb_entities`** |
| `convex/domains/knowledge/nodes.ts:33` | `nodes.search_text` | ProseMirror block content search | **Yes — `nb_notebook_blocks`** |
| `convex/domains/research/narrative/queries/threads.ts:220` | `narrativeThreads.search_name` | Narrative thread search | **Yes — `nb_threads`** |
| `convex/domains/research/narrative/queries/events.ts:171` | `narrativeEvents.search_headline` | Event headline search | **Yes — `nb_captures` or `nb_events` (open Q)** |
| `convex/domains/operations/encounters/encounterQueries.ts:152` | `encounterEvents.search_encounter` | Pulse-style raw encounter search | **Yes — `nb_captures`** |
| `convex/tools/meta/hybridSearchQueries.ts:195,205` | `toolRegistry.search_description`, `toolRegistry.search_keywords` | Tool registry search | **No** — covered by progressive discovery, separate concern |
| `convex/tools/meta/skillDiscoveryQueries.ts:159,169` | `skills.search_description`, `skills.search_keywords` | Skill catalog search | **No** — same as above |
| `convex/domains/enrichment/{fundingQueries,fundingMutations,entityPromotion,entityLinkingQueries}.ts` | `*.search_*` | Internal enrichment lookups | **Maybe** — wait until §8 Q3 is answered |
| `convex/domains/research/narrative/queries/threads.ts`, `threads.ts`, … | `chatThreadsStream.search_name` (where present) | Thread list search | **Yes — `nb_threads`** |

**Conclusion**: Typesense should **replace** the `withSearchIndex` reads on
the user-facing data tables (12 of 27 call sites). The internal-tooling
indexes (`toolRegistry`, `skills`, `mcpServers.search_description`) stay
on Convex — they're small (<1k rows) and the existing index works.

### 1.5 The Cmd-K command palette

**`src/layouts/chrome/CommandPalette.tsx`** (top of file)
- Static command list: navigation (5 entries: home/chat/reports/inbox/me),
  create-document, create-task, settings.
- Optional `additionalActions` injected by host (cockpit mode switches).
- **Recent docs** pulled from `api.domains.documents.documents.getSidebar`
  (NOT a Convex search — just a paginated list).
- **No fuzzy search over user data.** Today the palette is "navigation only".

**`src/hooks/useCommandPalette.ts`** — Cmd+K / Ctrl+K toggle hook. Pure UI.

**`src/layouts/chrome/commandPaletteUtils.ts`** — buyer-priority ranking, no
search.

**Conclusion**: Cmd-K today is a **navigation menu**, not a search palette.
The Typesense work is what turns it into a real search palette. **Big win**
— the user-spec'd "Cmd-K palette" surface is essentially a greenfield
addition, not a refactor.

### 1.6 Reports compact browser

`grep -rnE "ReportsBrowser|ReportCompact|reports.*compact" src/` returns
nothing concrete; the surface is implied by `productReports` (1058 LOC of
schema) and is browsed today via a list query at
`convex/domains/product/reports.ts` (verified by `productReports` import
graph). No fuzzy search or facet filter exists today. **Greenfield UX**.

### 1.7 Entity autocomplete in Chat

**`src/features/entities/components/notebook/MentionPicker.tsx`** —
- Driven by `api.domains.product.blocks.searchEntitiesForMention`.
- Backend: **`convex/domains/product/blocks.ts:1958`** — does an in-memory
  `take(200)` + `name.includes(needle)` substring scan per `ownerKey`.
- Returns up to 10 matches. **No fuzzy, no typo tolerance, no facets.**
- Rate: `take(200)` is a hard cap per ownerKey. Power users with 200+
  entities get truncation.

**Typesense replacement**: `nb_entities.q=<prefix>&filter_by=accessibleUserIds:=user_X` with `prefix:true` and
fuzzy `num_typos=2`. Strict win on relevance, scale, and typos.

### 1.8 Notebook block search

**`src/features/entities/components/notebook/`** — uses `productBlocks` table.
Today there is NO block-level search; users scroll the entity workspace.
Convex `productBlocks` does have a `by_entity_position` index but **no
`searchIndex`** at all on the block table itself. Pure greenfield.

### 1.9 Relationship shelves

`productEntityRelations` (45-line table) is read directly by
`convex/domains/product/entities.ts` at lines 656, 853, 1641 via the
`by_owner_pair` index. Works for direct lookup but no search/discovery on
"find all entities that have role X". **Typesense `nb_edges` (deferred per
spec) would unlock this; the human UX shelf reads from those rows by
filter.**

### 1.10 Event corpus explorer

`productEventWorkspaces`, `productEventWorkspaceEntities`,
`productEventWorkspaceClaims`, `productEventCaptures` — see schema in §2. No
search exists today. The serving model is documented at
`docs/architecture/EVENT_INTELLIGENCE_SERVING_MODEL.md`. **Pure greenfield.**

### 1.11 Similar entity discovery

Today implemented as a Convex action that calls into the embedding tables
(`embeddings` at `convex/schema.ts:576` and `vectorIndex("by_embedding")`
across `linkedinFundingPosts`, `narrativeEvents`, `skills`, `toolRegistry`).
**Vector search via Convex's own vector index, NOT a separate service.**
Typesense's hybrid (BM25 + vector) would be a strict superset, but cost
benefit needs to be measured against the existing path.

---

## §2 — Schema mapping (Convex tables → Typesense collections)

The user spec calls for 7 collections. Here's the precise Convex source for
each, the field-by-field projection, and the access controls.

### 2.1 `nb_entities` — canonical entity records

**Source Convex tables**:
- **Primary**: `productEntities` — per-owner entity (auth-gated). 17 fields.
  Defined at `convex/domains/product/schema.ts:817`.
- **Cross-cut**: `intelligenceEntities` (canonical Wikidata-style cross-tenant
  entity, defined at `convex/domains/intelligence/schema.ts:18`).
- **Aliases**: `entityAliases` (`convex/domains/intelligence/schema.ts:64`).
- **Public registry**: `publicResearchEntities`
  (`convex/schema.ts:7061`) — cross-user, public-only canonical.

**Field projection** (one Typesense doc per `productEntities` row,
denormalize from `intelligenceEntities` + `entityAliases` when linked):

| Typesense field | Type | Convex source | Notes |
|---|---|---|---|
| `id` | string | `productEntities._id` | Convex doc ID |
| `slug` | string | `productEntities.slug` | URL-safe canonical key |
| `ownerKey` | string | `productEntities.ownerKey` | `user:<id>` or `anon:<sid>` |
| `accessibleUserIds` | string[] | derived (see §4) | always at least `[ownerKey]` |
| `accessibleTeamIds` | string[] | derived from `productEntityWorkspaceMembers` | |
| `accessibleOrgIds` | string[] | reserved (currently always `[]`) | for future tenant model |
| `visibility` | string (enum) | `private` / `workspace` / `public` | derived: see §4 |
| `name` | string | `productEntities.name` | full-text, weight 4 |
| `aliases` | string[] | `entityAliases.alias` (joined) | full-text, weight 3 |
| `entityType` | string (facet) | `productEntities.entityType` | `company` / `person` / `fund` / `product` |
| `summary` | string | `productEntities.summary` | full-text, weight 2 |
| `savedBecause` | string | `productEntities.savedBecause` | full-text, weight 1 |
| `sector` | string (facet) | `intelligenceEntities.sector` | nullable |
| `companyStage` | string (facet) | derived from latest `productReports.routing` | nullable |
| `freshnessBucket` | string (facet) | derived: `<24h` / `<7d` / `<30d` / older | from `latestReportUpdatedAt` |
| `latestRevision` | int32 | `productEntities.latestRevision` | sort tiebreaker |
| `reportCount` | int32 | `productEntities.reportCount` | sort + facet bucket |
| `watching` | bool (facet) | derived from `productNudgeSubscriptions` | |
| `hasFollowUp` | bool (facet) | derived from `productEventWorkspaceFollowUps` | |
| `embedding` | float[384] | OpenAI `text-embedding-3-small` of `name + summary` | for hybrid |
| `createdAt` | int64 | `productEntities.createdAt` | sort by recency |
| `updatedAt` | int64 | `productEntities.updatedAt` | sort by recency |

**Estimated row count**: 1k–50k per power user, ~2k median (extrapolated from
the `take(200)` cap that's been hit per the substring-scan code path).
**Total at v1 scale**: ~500k docs across all owners.

**Default sort**: `_text_match:desc, updatedAt:desc, latestRevision:desc`.

---

### 2.2 `nb_reports` — saved/published reports

**Source Convex table**: `productReports`
(`convex/domains/product/schema.ts:1044`) — 60 fields, the heaviest table in
the product layer.

| Typesense field | Type | Convex source | Notes |
|---|---|---|---|
| `id` | string | `productReports._id` | |
| `ownerKey` | string | `productReports.ownerKey` | |
| `accessibleUserIds` | string[] | derived (see §4) | |
| `accessibleTeamIds` | string[] | derived from `productEntityWorkspaceMembers` (via entity link) | |
| `visibility` | string (facet) | `productReports.visibility` | `private` / `workspace` / `public` |
| `title` | string | `productReports.title` | full-text, weight 4 |
| `summary` | string | `productReports.summary` | full-text, weight 3 |
| `query` | string | `productReports.query` | full-text, weight 2 (the original ask) |
| `reportType` | string (facet) | `productReports.type` | facet 1 |
| `lens` | string (facet) | `productReports.lens` | facet 2 (founder/investor/banker/ceo/legal/student) |
| `status` | string (facet) | `productReports.status` | facet 3: `draft`/`saved`/`published`/`archived` |
| `verificationStatus` | string (facet) | derived from `productReports.qualityGateSummary.verdict` | facet 4 |
| `entitySlug` | string (facet) | `productReports.entitySlug` | links to `nb_entities.slug` |
| `entityName` | string | denormalized from `productEntities.name` | full-text, weight 2 |
| `primaryEntity` | string | `productReports.primaryEntity` | full-text |
| `pinned` | bool (facet) | `productReports.pinned` | |
| `revision` | int32 | `productReports.revision` | |
| `notebookHtml` | string | `productReports.notebookHtml` | full-text, weight 1 (large body) |
| `sectionsText` | string | flattened text from `productReports.sections` | full-text, weight 1.5 |
| `sourceCount` | int32 | derived | facet bucket |
| `freshnessBucket` | string (facet) | derived from `lastRefreshAt` | |
| `embedding` | float[384] | embed `title + summary` | for hybrid |
| `createdAt` | int64 | `productReports.createdAt` | |
| `updatedAt` | int64 | `productReports.updatedAt` | sort default |

**Estimated row count**: 100–500 per power user, ~30 median. **Total at v1**:
~50k docs.

**Search use cases**: Reports compact browser (§1.6), Cmd-K palette
(§1.5 — "search reports"), agent tool `search_report_context` (§6 PR4).

---

### 2.3 `nb_notebook_blocks` — granular notebook blocks

**Source Convex tables**:
- **Primary**: `productBlocks` (`convex/domains/product/schema.ts:1469`) —
  per-owner per-entity block (up to ~thousands per entity).
- **Secondary**: `productNotebookPages` for page metadata title.
- **Document fallback**: `documents.content` (legacy ProseMirror blob) and
  `nodes.text` (newer GraphNode rows) for non-product surfaces.

| Typesense field | Type | Convex source | Notes |
|---|---|---|---|
| `id` | string | `productBlocks._id` | |
| `ownerKey` | string | `productBlocks.ownerKey` | |
| `accessibleUserIds` | string[] | derived (see §4) | |
| `accessibleTeamIds` | string[] | derived | |
| `visibility` | string (facet) | derived from `productBlocks.isPublic` + entity workspace shares | |
| `entityId` | string | `productBlocks.entityId` | links to `nb_entities.id` |
| `entitySlug` | string (facet) | denormalized | facet for "blocks in this entity" |
| `kind` | string (facet) | `productBlocks.kind` | block type enum |
| `authorKind` | string (facet) | `productBlocks.authorKind` | `human` / `agent` |
| `text` | string | flattened from `productBlocks.content` chips (concatenated) | full-text, weight 4 |
| `parentBlockId` | string | `productBlocks.parentBlockId` | for thread reconstruction |
| `positionInt` | int32 | `productBlocks.positionInt` | sort within entity |
| `positionFrac` | string | `productBlocks.positionFrac` | sort tiebreak |
| `sourceSessionId` | string | `productBlocks.sourceSessionId` | links to thread |
| `sourceRefIds` | string[] | `productBlocks.sourceRefIds` | links to `nb_sources` |
| `revision` | int32 | `productBlocks.revision` | |
| `createdAt` | int64 | `productBlocks.createdAt` | |
| `updatedAt` | int64 | `productBlocks.updatedAt` | |
| `embedding` | float[384] | embed `text` | for "find similar block" |

**Estimated row count**: ~50–500 blocks per entity × 2k entities per power
user = 100k–1M per user, ~100k median. **Total at v1**: ~10M docs. **This
is the heaviest collection** by row count and storage. Body text can be 1KB
average (1KB × 10M = 10GB raw text).

**Sync hot path**: `productBlocks` is the most-mutated table in the product
layer (every agent decoration accept, every user keystroke-on-blur). The
sync queue MUST debounce per `productBlocks._id` (e.g., 5s rolling window)
or Typesense will get clobbered.

---

### 2.4 `nb_claims` — verified/extracted claims

**Source Convex table**: `productClaims`
(`convex/domains/product/schema.ts:749`) — claim-text + verification metadata.
**Secondary**: `claims` table at `convex/schema.ts:15534` (intelligence-graph
claims with subject/predicate/object).

| Typesense field | Type | Convex source | Notes |
|---|---|---|---|
| `id` | string | `productClaims._id` | |
| `ownerKey` | string | `productClaims.ownerKey` | |
| `accessibleUserIds` | string[] | derived | |
| `visibility` | string (facet) | derived | |
| `claimText` | string | `productClaims.claimText` | full-text, weight 4 |
| `claimType` | string (facet) | `productClaims.claimType` | |
| `verificationStatus` | string (facet) | derived from `supportStrength + freshnessStatus + contradictionFlag + publishable` | derived enum: `verified` / `corroborated` / `single-source` / `contradicted` / `unverified` |
| `freshnessStatus` | string (facet) | `productClaims.freshnessStatus` | |
| `entitySlug` | string (facet) | derived via `productClaims.entityId → productEntities.slug` | |
| `reportId` | string | `productClaims.reportId` | links to `nb_reports` |
| `slotKey` | string (facet) | `productClaims.slotKey` | |
| `sectionId` | string (facet) | `productClaims.sectionId` | |
| `sourceRefIds` | string[] | `productClaims.sourceRefIds` | links to `nb_sources` |
| `publishable` | bool (facet) | `productClaims.publishable` | |
| `contradictionFlag` | bool (facet) | `productClaims.contradictionFlag` | |
| `embedding` | float[384] | embed `claimText` | dedup + similarity |
| `createdAt` | int64 | `productClaims.createdAt` | |
| `updatedAt` | int64 | `productClaims.updatedAt` | |

**Estimated row count**: 5–20 claims per report × 100 reports per user × 5k
users = 10M-ish at scale; ~200k for v1 single-tenant power users.

---

### 2.5 `nb_sources` — source artifacts (URLs, files, transcripts)

**Source Convex tables**:
- **Primary metadata**: `sourceArtifacts` (`convex/schema.ts:865`) —
  per-fetch URL/file metadata.
- **Body chunks**: `artifactChunks` (`convex/schema.ts:893`) — addressable
  text spans (already has `searchIndex search_text`).
- **Cross-reference**: `productEvidenceItems` for product-layer evidence
  ledger.

| Typesense field | Type | Convex source | Notes |
|---|---|---|---|
| `id` | string | `artifactChunks.chunkKey` (deterministic, dedup-safe) | NOT `_id` because chunks are versioned |
| `artifactId` | string | `artifactChunks.artifactId` | |
| `ownerKey` | string | derived via `agentRuns.userId → ownerKey` | nullable for system-fetched public URLs |
| `accessibleUserIds` | string[] | derived (see §4) | empty list = public URL |
| `visibility` | string (facet) | derived: `public` for crawled URLs, `private` for uploaded files | |
| `sourceType` | string (facet) | `sourceArtifacts.sourceType` | `url_fetch`/`api_response`/`file_upload`/`extracted_text`/`video_transcript` |
| `title` | string | `sourceArtifacts.title` | full-text, weight 3 |
| `sourceUrl` | string | `sourceArtifacts.sourceUrl` | full-text on hostname, weight 1 |
| `text` | string | `artifactChunks.text` | full-text, weight 4 — main body |
| `headingPath` | string[] | `artifactChunks.headingPath` | full-text, weight 2 |
| `pageIndex` | int32 | `artifactChunks.pageIndex` | for citation rendering |
| `mimeType` | string (facet) | `sourceArtifacts.mimeType` | |
| `fetchedAt` | int64 | `sourceArtifacts.fetchedAt` | sort + freshness facet |
| `freshnessBucket` | string (facet) | derived from `fetchedAt` | |
| `embedding` | float[384] | embed `text` | already produced for some chunks via the embeddings table |
| `chunkVersion` | int32 | `artifactChunks.chunkVersion` | filter: only show v1 by default |

**Estimated row count**: 5–50 chunks per artifact × 1k artifacts per user × 5k
users = 25M chunks at scale; ~500k for v1.

**Already indexed by Convex**: `artifactChunks.searchIndex("search_text")`
exists. Typesense replaces this — Convex search index can be dropped after
cutover.

---

### 2.6 `nb_captures` — quick captures + event captures

**Source Convex tables**:
- `quickCaptures` (`convex/schema.ts:1672`) — per-user notes/voice/screenshots.
- `productEventCaptures` (`convex/domains/product/schema.ts:1230`) —
  per-event-workspace captures.
- `realtimeVoiceCaptures` (`convex/schema.ts:3152`) — voice transcription
  captures.
- `encounterEvents` (`convex/schema.ts:9653`) — pulse-style raw encounter
  text (already has `search_encounter` index — replace).

| Typesense field | Type | Source | Notes |
|---|---|---|---|
| `id` | string | source `_id` | |
| `captureSource` | string (facet) | derived: `quick`/`event`/`voice`/`encounter` | |
| `ownerKey` | string | row's owner (varies by source) | |
| `accessibleUserIds` | string[] | derived | |
| `visibility` | string (facet) | derived (event captures use `productEventVisibility`) | |
| `kind` | string (facet) | `quickCaptures.type` (`note`/`task`/`voice`/`screenshot`) or `productEventCaptures.kind` | |
| `text` | string | `content` / `rawText` / `transcript` | full-text, weight 4 |
| `title` | string | `quickCaptures.title` | full-text, weight 3 |
| `transcription` | string | `quickCaptures.transcription` | full-text, weight 4 |
| `eventId` | string (facet) | `productEventCaptures.eventId` | nullable; non-null for event captures |
| `workspaceId` | string (facet) | `productEventCaptures.workspaceId` | nullable |
| `extractedEntityKeys` | string[] | `productEventCaptures.extractedEntityKeys` | filter: "captures mentioning Acme" |
| `extractedClaimKeys` | string[] | `productEventCaptures.extractedClaimKeys` | |
| `confidence` | float | `productEventCaptures.confidence` | sort tiebreak |
| `tags` | string[] | `quickCaptures.tags` | facet |
| `processed` | bool (facet) | `quickCaptures.processed` | |
| `embedding` | float[384] | embed `text + title + transcription` | |
| `createdAt` | int64 | source `createdAt` | sort default |

**Estimated row count**: 50–500 captures per active user per month, ~50k
total for v1.

**Open Q (§8 Q4)**: Should `narrativeEvents` (the editorial event corpus)
also live in `nb_captures`, or be a separate `nb_events` collection?
Recommendation: separate `nb_events` later — different access model
(editorial = mostly public, captures = mostly private).

---

### 2.7 `nb_threads` — chat / agent threads

**Source Convex tables**:
- **Primary**: `agentThreads` (`convex/schema.ts:15358`) — canonical
  unified thread metadata.
- **Body**: `agentMessages` (`convex/schema.ts:15390`) — per-turn messages
  (NOT directly indexed — too noisy; index thread-level summary instead).
- **Legacy**: `chatThreadsStream` (`convex/schema.ts:1321`) and
  `chatMessagesStream` — to be dual-written during migration per the schema
  comment.

| Typesense field | Type | Source | Notes |
|---|---|---|---|
| `id` | string | `agentThreads.threadId` (UUID; stable across dual-write) | |
| `ownerKey` | string | `agentThreads.ownerKey` | |
| `accessibleUserIds` | string[] | derived | |
| `visibility` | string (facet) | derived (threads are private by default) | |
| `title` | string | `agentThreads.title` | full-text, weight 4 |
| `surfaceOrigin` | string (facet) | `agentThreads.surfaceOrigin` | `inline`/`drawer`/`chat` |
| `entitySlug` | string (facet) | `agentThreads.entitySlug` | links to `nb_entities` |
| `lastMessageText` | string | last assistant message body (capped 2KB) | full-text, weight 3 |
| `firstUserText` | string | first user message body (capped 1KB) | full-text, weight 3 (preserves the original ask) |
| `messageCount` | int32 | `agentThreads.messageCount` | facet bucket |
| `status` | string (facet) | `agentThreads.status` | `active`/`archived`/`deleted` |
| `lastMessageAt` | int64 | `agentThreads.lastMessageAt` | sort default |
| `createdAt` | int64 | `agentThreads.createdAt` | |

**Estimated row count**: ~5k threads per power user, ~250k for v1.

**Sync note**: Don't reindex on every message append — only on
thread title change OR every 30s when active. The `lastMessageText` field
gets stale by design; refresh on a per-thread idle timer.

---

### 2.8 Deferred: `nb_edges` — relationship graph

Per spec, **deferred to v1.1**. Source: `productEntityRelations` (12 fields)
plus `edges` table (intelligence graph, 11 fields). Schema mapping omitted
here — design it once `nb_entities` is stable.

---

### 2.9 Schema summary

| Collection | Source tables | Est. v1 rows | Heaviest field | Avg doc size |
|---|---|---|---|---|
| `nb_entities` | productEntities + intelligenceEntities + entityAliases | 500k | summary | 0.5KB |
| `nb_reports` | productReports | 50k | notebookHtml | 8KB |
| `nb_notebook_blocks` | productBlocks + nodes | 10M | text | 0.5KB |
| `nb_claims` | productClaims | 200k | claimText | 0.3KB |
| `nb_sources` | sourceArtifacts + artifactChunks | 500k | text | 1KB |
| `nb_captures` | quickCaptures + productEventCaptures + encounterEvents + realtimeVoiceCaptures | 50k | text | 0.8KB |
| `nb_threads` | agentThreads + chatThreadsStream | 250k | lastMessageText | 1.5KB |

Total v1 raw text: ~12 GB. With 384-dim embeddings (1.5KB each), ~30 GB
vectors. Total v1 Typesense storage: **~50 GB** (raw text + embeddings +
inverted index overhead at ~30%).

---

## §3 — Sync strategy

### 3.1 Required write hooks

The `productBlocks` and `productEntities` tables are mutated from many call
sites (search returned 30+ for `productEntities`, 100+ for `productBlocks`).
**Don't try to wrap every mutation.** Instead:

**Layer 1 — Convex internal mutation `enqueueIndexEvent`**:
- New table `indexEvents` (defined below).
- One internal mutation: `internal.search.indexQueue.enqueue({ objectType,
  objectId, op, version })`.
- Called from a SHIM around the source-of-truth mutations. To avoid touching
  100+ call sites: introduce a single `afterUpsert` helper per table family
  in `convex/domains/product/{entities,blocks,reports,claims}.ts` + the
  corresponding intelligence + capture domains. Each helper does:
  `await ctx.db.patch(...)` then `await
  ctx.runMutation(internal.search.indexQueue.enqueue, { ... })`.

**Layer 2 — Schema additions** (new table — not in any existing PR):

```text
indexEvents: defineTable({
  objectType: v.string(),         // "nb_entities" | "nb_reports" | ...
  objectId: v.string(),           // Convex doc ID
  op: v.union(v.literal("upsert"), v.literal("delete")),
  version: v.number(),            // monotonic counter from source row
  checksum: v.string(),           // sha256(stableStringify(projection))
  enqueuedAt: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("processing"),
    v.literal("done"),
    v.literal("failed"),
  ),
  attempts: v.number(),
  lastError: v.optional(v.string()),
  processedAt: v.optional(v.number()),
})
  .index("by_status_enqueued", ["status", "enqueuedAt"])
  .index("by_object", ["objectType", "objectId"])
  .index("by_processed", ["status", "processedAt"]);
```

The `(objectType, objectId)` index lets the worker dedup multiple pending
events for the same row (debounce: keep only the most recent `version`).

### 3.2 Index event queue location

**Recommendation**: in-Convex (`indexEvents` table above), NOT external
queue (Redis / SQS). Reasons:

1. Convex provides built-in `ctx.scheduler.runAfter` (300+ existing call
   sites in this repo per the grep above) — durable, retried, cron-safe.
2. Idempotency comes for free via the `(objectType, objectId, version)` key
   plus `checksum` dedup.
3. No new dep, no new credential rotation, no new failure mode.
4. Per-row debounce trivially expressed as "look up most recent
   `pending` event for `(objectType, objectId)` and drop older ones in the
   worker".

### 3.3 Worker

**Recommendation**: a Convex `internalAction` scheduled by a cron, NOT
external service. Pattern matches the existing `convex/crons.ts` cron at
line 22 (`pi-ai pipeline scheduler`, `internal.domains.pipelines.pipelineSchedule.runDuePipelineSchedules`,
swept every 60min, BOUND 50/sweep).

```text
File: convex/domains/search/typesenseSync.ts (NEW)

Cron:  every 60s sweep up to BOUND=200 pending events
       grouped by (objectType, objectId), pick max(version).
       Per group: build projection, compare checksum to last-indexed,
       skip if same; else POST to Typesense.

Failure path: increment attempts; if attempts > 5, mark "failed",
              fingerprint the error, write to pipelineDeadLetters
              (existing table at convex/schema.ts:15163 — reuse the
              schema, group by errorClass). Per .claude/rules/async_reliability.md §4.
```

**HONEST_STATUS**: worker writes status="failed" with `lastError` populated;
never silent 2xx. Per `.claude/rules/agentic_reliability.md`.

**TIMEOUT**: Each Typesense POST has a 5s `AbortController`. Failed POSTs do
NOT block the worker — they go back into the queue with `attempts++`.

**Backpressure**: if `pending` count exceeds 10k, the cron also alerts via
the existing `alertHistory` table and cuts the Typesense rate to 50/sweep
to avoid runaway billing.

### 3.4 Idempotency

The `(objectType, objectId, version)` triple is the natural primary key.
`checksum = sha256(stableStringify(projection))` lets the worker skip
no-op updates (e.g., a Convex patch that only touched `lastViewedAt` —
`updatedAt` bumps but the projection is identical). Per
`.claude/rules/agentic_reliability.md` `DETERMINISTIC` invariant: use
`stableStringify` with sorted keys, NOT `JSON.stringify`.

The worker:
1. Acquire row (`status="pending" → "processing"` via
   `withIndex("by_status_enqueued")`).
2. Compute `projection = buildProjection(objectType, objectId)`.
3. Compute `newChecksum = sha256(stableStringify(projection))`.
4. Look up Typesense doc (or last-indexed checksum stored in a sidecar
   `indexedChecksums` table to avoid the GET).
5. If `newChecksum === oldChecksum`: write `status="done"` and return.
6. Else: POST to Typesense, then write `status="done", processedAt`.
7. On failure: `attempts++`, `status="pending"`, requeue.

### 3.5 Initial backfill

**Pattern**: paginated read of each Convex source table, enqueue events
in batches of 500. Background runs over hours.

```text
File: convex/domains/search/typesenseBackfill.ts (NEW)

internalAction backfillCollection({ collection, cursor }):
  rows = ctx.db.query(<table>).withIndex("by_<owner|created>")
                              .paginate({ cursor, numItems: 500 })
  for row in rows:
    await ctx.runMutation(internal.search.indexQueue.enqueue, { ... })
  if !rows.isDone:
    await ctx.scheduler.runAfter(2000, ..., { collection, cursor: rows.continueCursor })

CLI shim: npm script "search:backfill -- --collection nb_entities" calls
          the action via convex run.
```

**Effort**: backfilling all 7 collections at v1 scale (~12M rows total)
takes ~4 hours at 500 rows/2s.

### 3.6 Delete / unshare propagation — explicit list

**Mutations that MUST trigger reindex**:

| Mutation file | Triggers reindex of |
|---|---|
| `convex/domains/product/entities.ts` (deleteEntity, archiveEntity) | `nb_entities` (delete), `nb_reports` (re-derive accessibleUserIds), `nb_notebook_blocks` (delete cascade), `nb_claims` (delete cascade) |
| `convex/domains/product/blocks.ts` (deleteBlock, softDeleteBlock) | `nb_notebook_blocks` (delete) |
| `convex/domains/product/reports.ts` (deleteReport, archiveReport) | `nb_reports` (delete + cascade to claims) |
| `convex/domains/product/sharing.ts` or wherever `productWorkspaceShares` is mutated | `nb_entities`, `nb_reports`, `nb_notebook_blocks`, `nb_claims` for the entity (re-derive `accessibleUserIds + accessibleTeamIds`) |
| `convex/domains/product/{members,invites}.ts` — accept/revoke `productEntityWorkspaceMembers` | same as above |
| `convex/schema.ts` `publicShares` mutations | re-derive `visibility` and `accessibleUserIds=[]` for public docs of the resource |
| `convex/domains/product/blocks.ts` (search line ~789, 793 — `productEntityRelations` writes) | `nb_entities` (denormalize relation count for facet) |
| `convex/domains/agents/agentActions.ts` etc. — when an agent edits a block | `nb_notebook_blocks` (debounced) |

**HONEST_STATUS rule**: `unshare` is the highest-leverage destructive
operation. The PR4 (auth) test plan must include: revoke a workspace member,
verify within 60s the search results no longer return the entity to that
member.

---

## §4 — Auth + multi-tenant security

### 4.1 NodeBench's existing auth model

Per `convex/domains/product/helpers.ts:484-518`:

```text
Authenticated user → ownerKey = "user:<userId>"
Anonymous session  → ownerKey = "anon:<sessionId>"
No identity        → ownerKey = null (read-only access to publicShares)
```

A user gets read access to a `productEntities` row when ANY of:
1. `entity.ownerKey === identity.ownerKey` (owner)
2. There is an active `productEntityWorkspaceMembers(entityId, userId, !revokedAt)` row (member)
3. There is an active `productWorkspaceShares(entityId, !revokedAt, !expired)` row AND the request carries the matching `shareToken` (link share)
4. There is an active `publicShares(resourceType="entity", resourceSlug=entity.slug)` (public anonymous share)

Cases 1–4 each have to project to either `accessibleUserIds[]` or to a
catch-all `visibility="public"` flag.

### 4.2 Recommended: backend proxy, NOT scoped keys (for v1)

The user spec mentions both options. Tradeoffs:

| Approach | Pros | Cons | Fit for NodeBench |
|---|---|---|---|
| **Scoped keys with embedded `filter_by`** | Browser hits Typesense directly, no Convex roundtrip; scales to many concurrent users without Convex bandwidth | Keys baked at session start; revocation needs key rotation; share-token / link-share auth is awkward to express in `filter_by` | **Bad for v1** because share tokens (case 3 above) are bearer tokens that change per request, not per session |
| **Backend proxy** (`/v1/search` Convex HTTP action) | Convex action resolves `accessibleUserIds` per-request from auth + share token + anonymous session; clean revocation; existing `resolveProductIdentitySafely` works as-is | Extra latency hop (~30ms Convex roundtrip + Typesense roundtrip = ~80ms total); bandwidth hits Convex | **Good for v1** |

**Recommendation**: backend proxy at `convex/http.ts` wiring a new HTTP
action `internal.search.gateway.search`. The action:

1. Calls `resolveProductIdentitySafely(ctx, anonymousSessionId)` to get
   `ownerKey`.
2. Computes `accessibleUserIds = [ownerKey, ...teamMemberOwnerKeys]` from
   the existing membership tables.
3. If `shareToken` present: validate via existing
   `getActivePublicEntityShareByToken` and add the share's `ownerKey` to
   `accessibleUserIds`.
4. Builds Typesense `multi_search` body with `filter_by:
   accessibleUserIds:=[<keys>] || visibility:=public`.
5. POSTs to Typesense, returns response unchanged (let the UI parse).

This is the same pattern as `server/routes/search.ts` (`ConvexHttpClient`
proxying to MCP tools) — proven, observable, debuggable. The latency cost
is acceptable for v1 (search isn't hot enough to matter; <100 RPS at v1).

**v1.1 escalation**: introduce scoped keys for read-only embedding-search
endpoints (similar entity discovery, autocomplete) where the
`accessibleUserIds[]` doesn't change mid-session. Keep backend proxy for
all writes + share-token reads.

### 4.3 The `accessibleUserIds[]` derivation algorithm

For each indexed object:

```text
function deriveAccess(obj):
  result = {
    accessibleUserIds: [obj.ownerKey],
    accessibleTeamIds: [],
    accessibleOrgIds: [],
    visibility: "private"
  }

  // Workspace members (case 2)
  if obj is {entity, report, block, claim}:
    entityId = obj.entityId or (obj is entity ? obj._id : null)
    if entityId:
      members = db.query("productEntityWorkspaceMembers")
                  .withIndex("by_owner_entity_user",
                             q => q.eq("ownerKey", obj.ownerKey)
                                   .eq("entityId", entityId))
                  .filter(m => !m.revokedAt)
      for m in members:
        result.accessibleUserIds.push(`user:${m.userId}`)

  // Public shares (case 4)
  publicShares = db.query("publicShares")
                   .withIndex("by_resource",
                              q => q.eq("resourceType", "entity")
                                    .eq("resourceSlug", obj.entitySlug))
                   .filter(s => !s.revokedAt && (!s.expiresAt || s.expiresAt > now))
  if publicShares.any():
    result.visibility = "public"
    result.accessibleUserIds = []  // public means anyone

  // Workspace-level visibility (productReports.visibility = "workspace")
  if obj.visibility == "workspace":
    result.visibility = "workspace"
    // accessibleUserIds stays [owner + members]

  return result
```

**Link shares (case 3)** are NOT pre-computed into the index — they're
honored at query time by the proxy. The proxy adds the share's ownerKey to
the `filter_by` if the request carries a valid token.

### 4.4 Privacy invariants to enforce in QA

Per the existing `canonicalSources` warning at `convex/schema.ts:1381`:
"**user queries, scratchpad, or auth-gated content MUST NEVER be written
here**". Apply the same rule to Typesense:

1. `productChatEvents`, `productChatSessions` — NEVER indexed (raw chat tool
   I/O can leak prompts).
2. `realtimeAuditEvents` — NEVER indexed (PII).
3. `voiceSessions`, `voiceCostLedger` — NEVER indexed.
4. `agentScratchpads` — NEVER indexed (per `.claude/rules/scratchpad_first.md`,
   raw scratchpad is durable but private).
5. `mcpAccessLog`, `apiUsage`, `userBehaviorEvents` — NEVER indexed.

QA matrix (§7) enforces this with a denylist test: assert that no field
from these tables ever appears in any Typesense response.

---

## §5 — Hosting + cost

### 5.1 Self-hosted vs Typesense Cloud

**Recommendation**: **Typesense Cloud** for v1, self-host evaluation in v1.1
once the load profile is known.

| Dimension | Cloud | Self-hosted (Fly.io / Render) |
|---|---|---|
| Time to first query | 5min | 1 day (snapshot/restore + monitoring + alerting) |
| Failure mode | Vendor SLA | We own it |
| Cost @ v1 (50GB) | ~$200/mo (3-node Cloud HA cluster, "1 GB RAM × 3" tier with 100GB SSD = $99/mo + bandwidth) | ~$50/mo (3 × Fly.io 1GB instances) but +30hr/mo of ops for snapshots, version upgrades, monitoring |
| Cost @ v1.1 (200GB) | ~$600/mo | ~$150/mo |
| Embedding storage | Same | Same |

The break-even is ~250GB. Below that, the ops time saved by Cloud is worth
$150/mo to a 1-engineer team. The escape hatch is real: **Typesense data
is just Raft snapshots — exporting and self-hosting later is a 1-day
migration**.

### 5.2 Estimated index size from §2.9

50GB (raw) → ~80GB (with inverted index + RAM resident tokens). At v1.1
(5x growth) → ~400GB. **This is when self-host becomes a forcing function**.

### 5.3 Hardware (if self-hosted in v1.1)

- 3 nodes, 8GB RAM, 200GB SSD, Raft consensus.
- $80/mo on Hetzner CX31 ($24/mo each) or $150/mo on Fly.io performance-2x.

### 5.4 Embedding model

Typesense Cloud bundles `e5-small-v2` (384-dim) for $0/$query (it's
inference-time, included). Self-hosted needs a sidecar or use of OpenAI
`text-embedding-3-small` ($0.02 / 1M tokens — negligible at v1 scale).

---

## §6 — Refined PR plan

### Reconciliation overrides from §1

The user spec says "PR1 = index contracts + sync queue". §1.5 reveals the
Cmd-K palette today is **navigation only**, with no fuzzy search at all. This
means **PR3 includes a real new component** (search bar in palette + result
rendering), not a refactor of an existing one. Bumping PR3 from M → L.

§1.7 reveals MentionPicker today does a substring scan — replacing it with
Typesense **removes** the `take(200)` truncation. Easy win in PR3.

§1.4 reveals `convex/domains/documents/{search,documents}.ts` already use
`withSearchIndex` for landing page search. **PR3 must update those callers**
to use the federated `multi_search` endpoint OR keep them on Convex during
transition (recommended: A/B switch via feature flag for one week before
removing the Convex fallback). Adds 1d to PR3.

§3.1 reveals there are NOT clean afterUpsert helpers per table family today —
the index queue enqueue must be added by introducing those helpers. Bumps
PR1 from M → L.

### PR1 — Index contracts + sync queue (size: **L**)

**Goal**: Schema + queue + worker live, but no UI consumer yet. `npm run
search:backfill` works.

**Files to add**:
- `convex/domains/search/typesenseSchema.ts` — TypeScript types for the 7
  collection schemas + Typesense API client wrapper.
- `convex/domains/search/typesenseClient.ts` — thin fetch wrapper with
  AbortController, BOUND_READ (10MB cap on response), HONEST_STATUS (no
  fake 2xx).
- `convex/domains/search/projections/{nbEntities,nbReports,nbBlocks,nbClaims,nbSources,nbCaptures,nbThreads}.ts` —
  one builder per collection mapping the Convex doc → Typesense projection.
  Pure functions, deterministic (per `.claude/rules/agentic_reliability.md`
  `DETERMINISTIC`).
- `convex/domains/search/indexQueue.ts` — `enqueue` internal mutation +
  `claimNext` + `markDone` + `markFailed` mutations.
- `convex/domains/search/typesenseSync.ts` — the cron action.
- `convex/domains/search/typesenseBackfill.ts` — paginated backfill action.
- `convex/domains/product/{entities,blocks,reports,claims}.ts` — add
  `afterUpsert` shim that calls `internal.search.indexQueue.enqueue`. Wrap
  every existing `db.insert` and `db.patch` site in the file. (~30
  call-site edits across 4 files; mechanical.)
- `scripts/typesense/setup-collections.mjs` — admin script to create the 7
  collections with the right schema on a fresh Typesense cluster.

**Files to modify**:
- `convex/schema.ts` — add the `indexEvents` and `indexedChecksums` tables.
- `convex/crons.ts` — add the typesense-sync cron alongside line 22.
- `package.json` — add `typesense` npm package, add `search:backfill` and
  `search:setup` scripts.
- `.env.example` — `TYPESENSE_URL`, `TYPESENSE_ADMIN_API_KEY`.

**Test fixtures**:
- `convex/domains/search/typesenseSync.test.ts` — scenario tests per
  `.claude/rules/scenario_testing.md`:
  1. Single-user, single mutation → enqueue → worker → Typesense upsert.
  2. Burst: 100 mutations on same entity in 5s → debounced to 1 upsert.
  3. Sustained: 1000 mutations across 50 entities over 5min → no queue
     backlog, no duplicates.
  4. Adversarial: Typesense returns 503 → `attempts++`, eventually
     deadletter.
  5. Idempotency: same `(objectType, objectId, version)` enqueued twice →
     processed once.
  6. Long-running: 24h memory accumulation in worker — assert no leak.

**Acceptance**:
- `convex/schema.ts` typecheck passes.
- All scenario tests pass.
- `npm run search:setup && npm run search:backfill -- --collection nb_entities`
  populates Typesense with all existing entities for one test owner.
- DLQ visible at `/admin/dlq` (existing surface per
  `.claude/rules/async_reliability.md` §4).

### PR2 — Search API (federated `multi_search`) (size: **M**)

**Goal**: One HTTP endpoint that returns federated results across all 7
collections, scoped to the caller's identity.

**Files to add**:
- `convex/domains/search/gateway.ts` — Convex HTTP action `POST /search/v1`
  that:
  1. Resolves `ProductIdentity` via `resolveProductIdentitySafely`.
  2. Computes `accessibleUserIds[]` per §4.3.
  3. Builds Typesense `multi_search` body with per-collection
     `filter_by`, `query_by`, `query_by_weights`, `facet_by`,
     `vector_query` for hybrid.
  4. POSTs to Typesense.
  5. Returns response (no transformation — UI handles parse).
- `convex/http.ts` — register the route.
- `packages/mcp-client/src/searchClient.ts` — typed client SDK so external
  consumers and tests can call the endpoint.

**Files to modify**:
- None (this PR is purely additive).

**Test fixtures**:
- `convex/domains/search/gateway.test.ts` — scenario tests:
  1. **Privacy**: User A indexes 10 entities, User B searches → 0 results.
  2. **Workspace share**: User A invites User B as workspace member → User
     B sees User A's entity within 60s.
  3. **Revoke**: User A revokes B's membership → User B no longer sees
     entity within 60s.
  4. **Public share**: User A creates `publicShares` token for entity →
     anonymous request with token sees entity; without token does not.
  5. **Concurrent**: 10 search requests/sec for 60s, P95 latency < 200ms.
  6. **Adversarial**: SQL-injection-style strings in `q` → no error, no
     results leaked from other tenants.

**Acceptance**:
- All scenario tests pass.
- Latency P50 < 80ms, P95 < 200ms (proxy + Typesense roundtrip).

### PR3 — Human UX (Cmd-K + Reports + autocomplete + notebook + event corpus) (size: **L**)

**Goal**: 5 UI surfaces consume the new API. Existing Convex `withSearchIndex`
queries on those surfaces are removed (or kept as feature-flagged fallback).

**Files to add**:
- `src/features/search/components/CommandPaletteSearch.tsx` — replace the
  static command list inside CommandPalette with a real search input that
  hits `/search/v1` with all 7 collections.
- `src/features/search/components/ReportsBrowser.tsx` — Reports compact
  browser: filter/sort by lens, type, verificationStatus, freshness.
- `src/features/search/components/EntityAutocomplete.tsx` — replace the
  innards of `MentionPicker.tsx` (keep the same prop contract, swap the
  data source from `searchEntitiesForMention` to `/search/v1`).
- `src/features/search/components/NotebookBlockSearch.tsx` — for entity
  workspace, "search blocks in this entity" sidebar.
- `src/features/search/components/EventCorpusExplorer.tsx` — read
  `nb_captures` filtered by `eventId`.
- `src/features/search/hooks/useFederatedSearch.ts` — React hook that wraps
  the SDK, debounces, and renders loading/empty/error states (per
  `.claude/rules/reexamine_resilience.md`).

**Files to modify**:
- `src/layouts/chrome/CommandPalette.tsx` — wire in
  `CommandPaletteSearch`. Keep static commands as a "Quick actions"
  section above the search results. Cmd-K → Enter on empty input still
  navigates to home (current behavior).
- `src/features/entities/components/notebook/MentionPicker.tsx` — replace
  data source.
- `convex/domains/documents/search.ts` (the `instantSearch` query at line
  61) — feature-flag dual-write, then remove after 1 week of clean A/B.
- `convex/domains/knowledge/entityContexts.ts:316`, `nodes.ts:33`,
  `tags.ts:228` — same dual-write pattern.

**Test fixtures**:
- `tests/e2e/cmdk-search.spec.ts` — Playwright: type "an" → see Anthropic
  entity in <300ms.
- `tests/e2e/reports-browser.spec.ts` — filter by `lens=banker` →
  only banker-lens reports shown.
- `tests/e2e/mention-autocomplete.spec.ts` — type `@acm` in notebook → see
  Acme AI suggestion in <100ms.

**Acceptance**:
- All 5 surfaces load and search correctly with live Typesense data.
- Per `.claude/rules/live_dom_verification.md`: `npm run live-smoke`
  passes; raw HTML on `/?surface=ask` includes Cmd-K trigger; Playwright
  hydration test confirms search input renders.
- A11y per `.claude/rules/reexamine_a11y.md`: results list is
  keyboard-navigable (Up/Down/Enter), focus-visible on active row.

### PR4 — Agent tools (size: **M**)

**Goal**: 4 new MCP tools that route through `/search/v1` when the agent
needs memory.

**Files to add**:
- `packages/mcp-local/src/tools/searchMemoryTools.ts` — implements:
  - `search_memory(q, collections?, limit?)` — federated search across all
    7 collections, returns top-k with collection labels.
  - `lookup_entity(name, includeRelated?)` — wraps `nb_entities` search +
    optionally pulls `productEntityRelations` for the top hit. Modifies
    existing `entityLookupTools.ts` to call this first, falling back to
    web only if memory miss.
  - `search_report_context(reportId, q, k=5)` — searches `nb_claims` and
    `nb_notebook_blocks` filtered by `reportId`/`entitySlug`.
  - `suggest_related(entityId, limit=5)` — `nb_entities` vector search
    on entity's embedding minus the entity itself.

**Files to modify**:
- `packages/mcp-local/src/tools/entityLookupTools.ts` — call
  `search_memory` first. Keep web fallback for memory misses.
- `packages/mcp-local/src/tools/toolRegistry.ts` — register the 4 new
  tools with proper category, tags, `nextTools`, `relatedTools`.
- `packages/mcp-local/src/tools/toolsetRegistry.ts` — add to `default`
  preset and a new `memory_search` toolset.
- `server/routes/search.ts` — for the `company_search` branch, call
  `search_memory` early in the pipeline so the agent can answer "what
  did I save about Acme last week?" without a web hop.

**Test fixtures**:
- `packages/mcp-local/test/searchMemoryTools.test.ts` — scenario tests:
  1. Memory hit: pre-seed 1 entity, agent asks "tell me about Acme",
     `lookup_entity` returns from `nb_entities`.
  2. Memory miss: agent asks for unknown company → falls back to web.
  3. `search_report_context` scoped to `reportId`: cross-report leakage
     test.
  4. `suggest_related` similarity ordering: pre-seed 5 fintech companies,
     verify top-3 are all fintech.

**Acceptance**:
- 4 new tools pass eval harness at
  `packages/mcp-local/src/benchmarks/searchQualityEval.ts`.
- `npx tsc --noEmit --pretty false` clean.
- `npx vitest run packages/mcp-local/test/searchMemoryTools.test.ts` passes.

### PR5 — QA + eval (size: **M**)

**Goal**: Operational confidence. Before this PR ships, do not flip the
production traffic.

**Files to add**:
- `scripts/eval/typesenseRelevanceEval.ts` — golden-query benchmark (the
  20 queries from §7.4) tracked over time.
- `scripts/eval/typesensePrivacyEval.ts` — adversarial cross-tenant tests
  (§7.5) run as a CI gate.
- `scripts/eval/typesenseLatencyEval.ts` — load test (1 / 10 / 100
  concurrent), captures P50/P95/P99.
- `tests/e2e/typesense-revoke-propagation.spec.ts` — UI test for share
  revocation propagation (§3.6 priority test).
- `convex/domains/search/typesenseHealthMonitor.ts` — Convex query that
  exposes `pending` queue depth, last-success timestamp, deadletter
  count. Wired to existing `/admin/health` page.

**Files to modify**:
- `.github/workflows/ci.yml` — gate PR merges on
  `typesensePrivacyEval` (must pass — privacy is non-negotiable).

**Acceptance**:
- 20-query golden eval baseline established. Subsequent PRs fail CI if
  relevance regresses >5%.
- Privacy eval: 0 cross-tenant leaks across 100 adversarial queries.
- Health monitor: queue depth ≤ 100 sustained, P95 sync lag < 5s.

---

## §7 — QA matrix

The user spec referenced 6 QA subagents. Concretized here using NodeBench's
actual data shapes.

### 7.1 Schema/index subagent

Verifies the projection builders match the Typesense schemas.

| Check | Expected |
|---|---|
| Every doc has `accessibleUserIds[]` non-null | yes |
| Every doc has `visibility ∈ {private, workspace, public}` | yes |
| Facets present per spec | `entityType, reportType, verificationStatus, sourceType, visibility, freshnessBucket, eventId, companyStage, priority, watching, hasFollowUp` |
| Vector fields populated when source has embedding | nullable but present in schema |
| Field types match builders | typecheck |
| `nb_blocks.text` not exceeding 50KB raw | enforced in projection |

### 7.2 Human browsing subagent — 10 most-likely Cmd-K queries

Pulled from observed search.ts classification examples + LinkedIn pipeline
testing context:

1. `acme` → autocomplete pre-saved entity "Acme AI"
2. `apoll` → typo-tolerant match for "Apollo Health"
3. `weekly reset` → triggers founder weekly reset workflow command
4. `series b` → faceted filter: reports with `companyStage=series_b`
5. `banker memo` → faceted filter: reports with `lens=banker`
6. `q1 2026` → `nb_captures` with date in title
7. `competitors of openai` → `nb_entities` related shelf via vector
   similarity to "openai"
8. `usptos patent` → `nb_claims` claim text match for patent claims
9. `monday` → `nb_threads` recent threads on Monday
10. `tlde signed` → typo + adversarial — should return 0 not error

### 7.3 Agent retrieval subagent — which existing tools should now use Typesense first?

Mapped to today's tool surface:

| Existing tool | New behavior |
|---|---|
| `entity_lookup` (`packages/mcp-local/src/tools/entityLookupTools.ts`) | Call `search_memory` first; web only on miss |
| `founder_local_synthesize` (called from search.ts) | Pre-call `search_memory` to seed context bundle from indexed memory instead of in-memory `productEntities.take(200)` |
| `run_recon` (called from search.ts company_search branch) | Skip web call when `search_memory` for the entity has freshness < 24h |
| `discover_tools` (`progressiveDiscoveryTools.ts`) | **No change** — covers tool registry, separate concern |
| MentionPicker's `searchEntitiesForMention` query | Removed; UI hits `/search/v1?collection=nb_entities&q=<prefix>&limit=10` |

### 7.4 Relevance subagent — 20 golden queries

Picked from real NodeBench entity/report names referenced in MEMORY.md
+ test fixtures (anonymized; the real names live in `convex/seed/` and the
linkedin pipeline tests):

| # | Query | Expected top result | Rationale |
|---|---|---|---|
| 1 | `anthropic` | `nb_entities`: Anthropic | exact match |
| 2 | `nodebench` | `nb_entities`: NodeBench | own-company case |
| 3 | `weekly reset for acme` | `nb_threads`: most recent weekly reset thread for Acme | NL query |
| 4 | `fintech series a` | top facet: `reportType=teardown lens=investor` | facet implicit |
| 5 | `pulse 2026-04` | `nb_captures`: April pulse capture | date facet |
| 6 | `acme founders` | `nb_claims` mentioning Acme founders | claim match |
| 7 | `openai vs anthropic` | both entities ranked by relevance | multi-entity |
| 8 | `cafecorner` | `nb_entities` via alias if mapped | alias resolution |
| 9 | `linkedin post template` | `nb_notebook_blocks` matching template content | block search |
| 10 | `who is jensen huang` | `nb_entities`: Jensen Huang person | type=person |
| 11 | `mcp protocol` | `nb_entities`: topic | type=topic |
| 12 | `last week's report on shopify` | `nb_reports` for entitySlug=shopify, freshness < 7d | date-aware |
| 13 | `funding round` | facet `reportType=funding_brief` | facet |
| 14 | `verified claims about apollo health` | `nb_claims` filtered `verificationStatus=verified, entitySlug=apollo-health` | combined |
| 15 | `convex` | `nb_entities` and `nb_sources` (URLs) | cross-collection |
| 16 | (typo) `anthrofic` | `nb_entities`: Anthropic | typo tolerance |
| 17 | (long) `what does the agentic reliability rule say` | `nb_sources` matching the rule file | full-text on long body |
| 18 | (empty) `` | empty results, no error | edge case |
| 19 | (special chars) `c++ vs rust` | `nb_entities` if either present | special-char tokenization |
| 20 | (cross-tenant probe) `<other-user-entity>` | 0 results when called as user A | privacy gate |

### 7.5 Privacy subagent — access patterns that must NOT leak through Typesense

| Pattern | Test |
|---|---|
| Other user's `productEntities.summary` | Search as User A for entity owned by User B → 0 results |
| Other user's `productBlocks.text` (notebook bodies) | Block search across owner boundary → 0 results |
| Revoked workspace member can no longer search | Member added → searches return entity. Member revoked → searches return 0 within 60s |
| Expired `publicShares` token | Anonymous search with expired token → 0 results |
| Anonymous user cannot search authenticated user's entities by guessing slug | Anonymous request with `q=<other-user-slug>` → 0 results |
| Raw chat content from `productChatEvents` cannot leak | Assert no chat-content text ever appears in any Typesense response |
| Voice transcripts (`voiceSessions`) cannot leak | Same |
| Agent scratchpad text cannot leak | Same |
| Search result snippets do not include redacted PII | Test against fixture with email + SSN-like patterns |

### 7.6 Performance subagent — latency targets

| Operation | Target | Current Convex baseline |
|---|---|---|
| Cmd-K palette search (3-char prefix) | P50 < 100ms, P95 < 200ms | ~80ms (Convex withSearchIndex single table) — Typesense will be SLOWER for prefix match because of proxy hop |
| Mention autocomplete (3-char prefix) | P50 < 80ms, P95 < 150ms | ~60ms (in-memory take(200) substring scan) — Typesense will be SLOWER but **correct** |
| Federated `/search/v1` (all 7 collections) | P50 < 150ms, P95 < 300ms | N/A (didn't exist) |
| Backfill throughput | 500 docs / 2s = 15k docs/min | N/A |
| Sync lag (mutation → search visibility) | P95 < 5s, P99 < 30s | N/A |
| Worker queue depth at steady state | < 100 pending | N/A |

**Critical**: Cmd-K and mention autocomplete will get **slower** in absolute
terms (proxy hop). The win is **correctness** (typos, faceting, scale beyond
200 entities). Communicate this in the PR description so reviewers don't
flag the latency regression.

---

## §8 — Open questions for the user

### Q1 — Self-host vs Cloud preference?

§5 recommends Cloud for v1. **The cost difference is ~$150/mo. Confirm
that's acceptable before procurement.** If self-host preferred, add ~5d
to PR1 (snapshots, monitoring, alerting).

### Q2 — Budget bound?

What's the monthly Typesense Cloud budget cap? At v1.1 (5x growth),
projected cost is $600/mo. If the cap is < $300/mo, we need to either
self-host earlier or shrink the indexed corpus (e.g., do NOT index
`nb_notebook_blocks` body text, only the title — 100x smaller).

### Q3 — Should `pi-ai agent` be a specific existing agent or new?

The user spec says `pi-ai agent = reasoning + tool calling`. NodeBench has:
- The **fastAgent** (`convex/domains/agents/fastAgentChat.ts`) — primary
  chat surface.
- The **coordinatorAgent** (`convex/domains/agents/core/coordinatorAgent.ts`)
  — multi-tool orchestration.
- The **deepResearch orchestrator**
  (`convex/domains/agents/dueDiligence/deepResearch/deepResearchOrchestrator.ts`).

PR4 wires the 4 search tools into the MCP registry. **Which agent loadout
should they appear in?** Options: `default` preset (every agent gets them),
new `memory_search` toolset (opt-in), or extend each existing per-domain
preset. Default recommendation: `default` preset + `memory_search` toolset
for agents that want only the search tools.

### Q4 — `narrativeEvents` (editorial event corpus) vs `nb_captures`

The schema reveals two parallel "event" tables:
- `productEventCaptures` (per-user event captures, private)
- `narrativeEvents` (editorial event corpus, mostly public)

Spec lumps both into `nb_captures`. Recommendation: split. **`nb_captures`
= private captures, `nb_events` = editorial corpus, separate access model.**
Confirm.

### Q5 — Does NodeBench have an existing index queue this could plug into?

§3.2 recommends a new `indexEvents` table. There is **no existing generic
work queue** in this repo. There are domain-specific queues
(`scheduledPipelineRuns`, `enrichmentJobs`, `artifactPersistJobs`,
`pipelineDeadLetters`). **Confirm** that adding a 5th queue is acceptable,
or that we should generalize one of these (e.g., extend `enrichmentJobs`
with a `kind: "search_index"`).

### Q6 — `nb_edges` deferral

Spec says "add later". Confirm: ship v1 without `nb_edges`. Relationship
shelves in PR3 (§1.9) will read directly from
`productEntityRelations` (not Typesense) for v1.

### Q7 — Typesense as source of truth for any new field?

The plan strictly treats Typesense as a derived index. **Confirm** that no
new field (e.g., per-user search history, per-query click logs) should be
written ONLY to Typesense. If the answer is "yes some fields", we need a
secondary path back into Convex for those fields.

---

## §9 — Glossary

- **`ownerKey`**: NodeBench's tenant key. `user:<id>` or `anon:<sid>`.
  Defined at `convex/domains/product/helpers.ts:484`.
- **Federated `multi_search`**: Typesense feature that lets one HTTP call
  query N collections in parallel, returns results bucketed by collection.
- **`afterUpsert` shim**: a wrapper around Convex `db.insert/db.patch` that
  also enqueues an index event. Pattern, not a library — to be added per
  table family in PR1.
- **DLQ**: dead-letter queue. The `pipelineDeadLetters` table at
  `convex/schema.ts:15163` is the existing substrate; reuse for index
  worker failures.
- **Backend proxy** (vs scoped keys): the chosen auth model. Typesense
  requests go through a Convex HTTP action that resolves identity per
  request and adds the right `filter_by`.

---

## §10 — File reference index (for fast jumping)

- `server/routes/search.ts:1-2370` — current /search HTTP entry
- `convex/domains/product/helpers.ts:484-518` — ownerKey derivation +
  `resolveProductIdentitySafely`
- `convex/domains/product/schema.ts:817` — productEntities
- `convex/domains/product/schema.ts:1044` — productReports
- `convex/domains/product/schema.ts:1469` — productBlocks
- `convex/domains/product/schema.ts:749` — productClaims
- `convex/domains/product/schema.ts:1230` — productEventCaptures
- `convex/schema.ts:1672` — quickCaptures
- `convex/schema.ts:865-919` — sourceArtifacts + artifactChunks
- `convex/schema.ts:15358-15432` — agentThreads + agentMessages
- `convex/schema.ts:15143-15161` — publicShares
- `convex/schema.ts:15163` — pipelineDeadLetters (reuse for §3 worker DLQ)
- `convex/domains/intelligence/schema.ts:18-89` — intelligenceEntities +
  entityAliases
- `convex/domains/product/blocks.ts:1958` — searchEntitiesForMention
  (current MentionPicker backend)
- `src/layouts/chrome/CommandPalette.tsx:1-200` — current Cmd-K palette
- `src/features/entities/components/notebook/MentionPicker.tsx` — current
  MentionPicker UI
- `convex/crons.ts:11-22` — pattern for adding the typesense-sync cron
- `.claude/rules/agentic_reliability.md` — 8-point checklist (BOUND,
  HONEST_STATUS, TIMEOUT, SSRF, BOUND_READ, ERROR_BOUNDARY, DETERMINISTIC)
- `.claude/rules/async_reliability.md` — DLQ + idempotency contract
- `.claude/rules/scratchpad_first.md` — privacy invariant (scratchpad
  never indexed)
- `.claude/rules/grounded_eval.md` — current 4-layer grounding (relevant
  to PR5 eval design)
- `docs/architecture/EVENT_INTELLIGENCE_SERVING_MODEL.md` — event corpus
  serving model (relevant to `nb_captures` design)

---

*End of plan. Awaiting answers to §8 before kicking off PR1.*
