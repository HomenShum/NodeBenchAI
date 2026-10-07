# Changelog

All notable changes to NodeBench AI are documented in this file.

For in-app release notes, see Research Hub > Changelog.

---

## Unreleased (July 15, 2026)

### First-class agent workspace

- Replaced the redesigned Chat route's stacked status banners with one runtime-grounded run contract: objective, read scope, review-only write boundary, verification state, and review handoff.
- Reworked the right inspector into Run and Evidence views, removing inferred background-agent claims, fabricated trace durations, and decorative progress bars.
- Removed toast-only Export and Track actions plus the simulated client-side batch runner; live batch telemetry remains read-only and Convex-backed.
- Unified phone and desktop Chat on the same real run tree, preserved the five canonical destinations, and fixed initial scroll, hidden inspector-row, composer reachability, and mobile navigation overflow.

---

## v0.4.1 (February 2, 2026)

Document system enhancements: MCP gateway document tools, batch operations, full-text content search, Markdown export, document duplication, and version comparison.

### MCP Gateway: Document Tools (18 new tools)

- **Document CRUD**: createDocument, createDocumentWithContent, getDocument, updateDocument, archiveDocument, restoreDocument, searchDocuments, listDocuments
- **Folder management**: createFolder, listFolders, getFolderWithDocuments, addDocumentToFolder, removeDocumentFromFolder
- **Spreadsheet operations**: createSpreadsheet, listSpreadsheets, getSpreadsheetRange, applySpreadsheetOperations
- **File listing**: listFiles with type filtering

### Document Backend Features

- **Batch operations**: `bulkArchive`, `bulkRestore`, `bulkToggleFavorite`, `bulkMoveToFolder`, `bulkDelete` mutations replace per-doc loops with single Convex calls
- **Content search**: New `search_content` index on documents table enables full-text search across document content (not just titles); `searchDocumentsFull` query deduplicates title + content matches
- **Markdown export**: `exportToMarkdown` query serializes ProseMirror/BlockNote JSON to GitHub-flavored Markdown (headings, lists, checklists, code blocks, tables, inline formatting)
- **Document duplication**: `duplicateDocument` mutation clones content, icon, and document type; resets visibility and favorites
- **Version comparison**: `compareVersions` query returns two snapshot contents for client-side diffing

### UI Integration

- Bulk archive and favorite now use single batch mutations instead of Promise.all loops
- `handleDuplicateDocument` callback wired to duplicate mutation

---

## v0.4.0 (February 1, 2026)

Major release: DRANE narrative engine, entity linking, verification pipeline, Ralph-style bug loop with vault persistence, LinkedIn archive lifecycle tooling, UI polish layer, and comprehensive operational self-maintenance.

### DRANE: Deep Research Agentic Narrative Engine

- **Newsroom agent pipeline**: Scout > Historian > Analyst > Publisher (4-agent LangGraph orchestration) with CommentHarvester for social listening
- **Temporal knowledge graph**: Narrative threads, events, posts, disputes, and correlations tracked across entities over time
- **Golden sets and QA framework**: Deterministic QA lane with `qaFramework:runFullSuite` CI gate and per-run validation via `qaFramework:validateWorkflowRun`
- **Guards and safety**: Claim classifier, trust scoring, content rights enforcement, quarantine, self-citation guard, abuse resistance
- **Adapters**: Brief, feed, and LinkedIn data translated into narrative events
- **Did You Know**: LLM-judged fact generation from URLs with `publishedAtIso` enforcement and tone presets

### Entity Linking and Deduplication

- **Wikidata-based entity resolution**: LLM-powered entity linking with caching in `entityProfiles` table
- **LLM judge**: Disambiguation and validation of entity matches
- **Mention tracking**: Cross-content entity occurrence tracking and promotion

### Verification Pipeline

- **Multi-source fact-checking**: Verdicts from VERIFIED (Tier1) through CONTRADICTED, OUTDATED, INSUFFICIENT
- **Contradiction detection**: Cross-reference conflicts surfaced across narrative events
- **Ground truth and public source registries**: Authoritative fact baselines for calibration
- **Audit trail**: Full decision logging for every verification step
- **Integration adapters**: LinkedIn, artifact, feed, and narrative verification hooks

### Bug Loop (Ralph-Style Back Pressure)

- **Client error capture**: `src/main.tsx` reports `window.error` and `unhandledrejection` to `bugLoop:reportClientError` with local rate limit
- **Deduped bug cards**: Deterministic signature with transparent `signatureDerivation` (messageHead, stackHead, route, section)
- **Occurrence artifacts**: Each error occurrence stored as a `sourceArtifacts` row with SHA-256 content dedup, linked from `occurrenceArtifacts[]` on the card (capped at 25 per card)
- **Ralph investigation**: LLM-generated triage plan (summary, likelyCauses, reproSteps, filesToInspect, testsToAdd) attached as investigation artifact
- **Human-in-the-loop columns**: inbox > ralph_investigate > human_approve > ralph_fix > human_review > done / wont_fix
- **Vault export**: `npm run bugloop:export:vault` exports bug cards + occurrence artifacts + investigation artifacts to `vault/master/notes/` as markdown with frontmatter

### LinkedIn Archive Lifecycle

- **Archive-level idempotency**: `logLinkedInPost` dedupes by dateString + persona + postType + metadata.part + content
- **Pre-post idempotency**: Workflows skip posting if archive row exists for dateString + persona + postType
- **Archive audit**: `linkedinArchiveAudit:runArchiveAudit` reports duplicates, reused URNs, and content anomalies
- **Cleanup tools**: Duplicate removal, URN reuse cleanup, orphan row deletion (all with dry-run)
- **Legacy edits**: "Unknown" > "Undisclosed" text fixes, demo URL replacement
- **Test row purge**: Strict-rule deletion of persona=TEST rows and hard test signals

### Self Maintenance (Nightly Autonomous)

- **Invariant audits**: LinkedIn archive, Did You Know integrity, Daily Brief propagation, bug loop substrate
- **Bug loop checks**: All cards have occurrenceArtifacts, signatureDerivation, and investigation artifacts where expected
- **Boolean-gated reports**: `passed` flag with optional LLM explanation, persisted to `checkpoints` table
- **Cron**: `runNightlySelfMaintenanceCron` scheduled daily

### UI Polish

- **Skeleton loaders**: FeedCardSkeleton, DigestSkeleton, DealCardSkeleton, BriefingSkeleton, CostDashboardSkeleton, IndustryUpdatesSkeleton, ViewSkeleton
- **Design system primitives**: Button, Card, Toast, SidebarButton, EmptyState components
- **FastAgentPanel**: Thread tab bar, swarm quick actions, animation polish, input bar improvements
- **Research views**: Cinematic Home, Entity Profile, Morning Digest, For You Feed, Sticky Dashboard updates
- **Sidebar**: CleanSidebar and SidebarGlobalNav redesign
- **Routing**: `useMainLayoutRouting` hook updates
- **Narrative UI**: NarrativeRoadmap (ThreadLane, EventMarker, SentimentBar, CorrelationLine), NarrativeCard, NarrativeFeed (PostCard, ReplyThread, EvidenceDrawer)
- **Social UI**: LinkedInPostCard and LinkedInPostArchiveView with dedup toggle

### Backend Improvements

- **Schema**: Major expansion with tables for narrative threads, events, posts, disputes, entity profiles, verification claims, and more
- **Crons**: Extended with narrative, self-maintenance, and privacy enforcement schedules
- **Model resolver**: Autonomous model fallback chain updates
- **Privacy enforcement**: Expanded retention and enforcement policies
- **SLO collector**: Extended metrics collection
- **MCP security**: Additional security checks
- **Knowledge graph**: Updates to entity relationship tracking
- **Executive brief**: Did You Know integration with URL override and tone presets
- **For You feed**: Expanded feed generation pipeline
- **Entity extraction tools**: Structured entity output for ethical founder/executive research
- **Image research tools**: Reverse image search and OCR

### MCP Server Deployment (Render)

- **render.yaml**: Blueprint defining 4 MCP web services (core-agent, openbb, research, gateway)
- **Core agent Dockerfile**: Node.js 20 + tsx for TypeScript MCP server
- **Gateway MCP server**: New `nodebench-mcp-gateway` service proxying 33 Convex tools across 4 domains (research, narrative, verification, knowledge) to external agents
  - Research: getForYouFeed, getEntityInsights, getDealFlow, getTrendingRepos, getLatestDashboard, getLatestPublicDossier, getFastestGrowingRepos, getSignalTimeseries
  - Narrative: getPublicThreads, searchThreads, getThreadsByEntity, getThreadsWithEvents, getThreadPosts, getOpenDisputes, getContradictoryPosts, runNewsroomPipeline
  - Verification: getVerificationSummary, getVerificationsForFact, getFactById, getCalibrationStats, getSloMetricsSummary, getArtifactsWithHealth
  - Knowledge: searchEntityContexts, getEntityContext, listEntityContexts, getKnowledgeGraph, getKnowledgeGraphClaims, getSourceRegistry
- **JSON-RPC 2.0 protocol**: `initialize`, `tools/list`, `tools/call` methods
- **Health checks**: `/health` endpoint on all services
- **Auth**: Optional bearer token via `MCP_HTTP_TOKEN` / `x-mcp-token` header
- **External agent support**: Claude Desktop, Cursor, and custom MCP clients can connect to deployed URLs

### Scripts and Tooling

- **Vault**: `npm run vault:init`, `npm run vault:health`, `npm run vault:merge` for Obsidian + Git file vault
- **Bug loop export**: `npm run bugloop:export:vault` for external filesystem context preservation
- **Golden sets**: DRANE audit golden set generation and reporting
- **Test scripts**: Image research tools, verification E2E, OpenRouter provider tests

### Documentation

- **AGENTS.md**: Complete agent workflow guide with operational runbooks, Render deployment docs, verification coverage map, and 10 Claude Code power-user tips
- **UI_POLISH_ROADMAP.md**: Phased UI improvement plan benchmarked against Linear, Notion, Perplexity, Arc
- **.github/pull_request_template.md**: PR audit checklist with newsroom/DRANE validation steps

---

## v0.3.6 (January 20, 2026)

See README.md for v0.3.6 and earlier release notes.
