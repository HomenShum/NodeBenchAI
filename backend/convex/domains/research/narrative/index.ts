/**
 * Narrative Domain - Deep Research Agentic Narrative Engine (DRANE)
 *
 * This domain provides:
 * 1. Temporal Knowledge Graph - narrativeThreads, narrativeEvents, narrativeSentiment
 * 2. Social Substrate - narrativePosts, narrativeDisputeChains ("Internal X/Reddit")
 * 3. Newsroom Agent Pipeline - Scout → Historian → Analyst → Publisher
 * 4. Timeline-Based Store - narrativeSearchLog
 * 5. Citation-Rich Output - All events/posts linked to sources
 *
 * @module domains/narrative
 */

// Re-export state types
export * from "./newsroom/state";

// Re-export agent types and functions (for programmatic use)
export * from "./newsroom/agents";

// Note: Workflow actions are accessible via:
// - api.domains.narrative.newsroom.workflow.runNewsroomPipeline (public)
// - internal.domains.narrative.newsroom.workflow.runPipeline (internal)

// Note: Queries are accessible via:
// - api.domains.narrative.queries.threads.*
// - api.domains.narrative.queries.events.*
// - api.domains.narrative.queries.posts.*
// - api.domains.narrative.queries.disputes.*

// Note: Mutations are accessible via:
// - api.domains.narrative.mutations.threads.*
// - api.domains.narrative.mutations.events.*
// - api.domains.narrative.mutations.posts.*
// - api.domains.narrative.mutations.disputes.*
// - api.domains.narrative.mutations.searchLog.*
