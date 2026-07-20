/**
 * Scout Agent - News Discovery and Ingestion
 *
 * The first agent in the Newsroom pipeline. Responsible for:
 * 1. Searching for this week's news related to target entities
 * 2. Converting results to NewsItem format
 * 3. Logging all searches for audit trail
 * 4. Pulling from existing content pipelines (briefs, LinkedIn, feed)
 *
 * Uses SearchOrchestrator for parallel multi-source retrieval.
 * Integrates with content adapters for unified narrative events.
 *
 * @module domains/narrative/newsroom/agents/scoutAgent
 */

import type { ActionCtx } from "../../../../../_generated/server";
import { internal } from "../../../../../_generated/api";
import { SearchOrchestrator } from "../../../../search/fusion/orchestrator";
import type { SearchResult } from "../../../../search/fusion/types";
import type { NewsroomState, NewsItem, SearchLogEntry } from "../state";
import { fnv1a32Hex } from "../../../../../../shared/citations/webSourceCitations";
import {
  processAllContent,
  type NarrativeEventInput,
  type AdapterInput,
  type BriefFeature,
  type LinkedInFundingPost,
  type FeedRankedCandidate,
} from "../../adapters";

/**
 * Configuration for Scout Agent
 */
export interface ScoutConfig {
  /** Maximum news items per entity */
  maxItemsPerEntity?: number;
  /** Search mode: fast, balanced, or comprehensive */
  searchMode?: "fast" | "balanced" | "comprehensive";
  /** Recency filter in days */
  recencyDays?: number;
  /** Enable web sources (vs just internal) */
  enableWebSources?: boolean;
  /** Enable pulling from existing content pipelines */
  enablePipelineIntegration?: boolean;
  /** Minimum priority for brief features */
  briefMinPriority?: number;
  /** Minimum phoenix score for feed items */
  feedMinPhoenixScore?: number;
  /**
   * Deterministic input for evaluation/regression tests.
   * If provided (non-empty), Scout will skip external search and return these items.
   */
  injectedNewsItems?: NewsItem[];
  /**
   * Record/replay mode for external tools.
   * - live: call tools normally
   * - record: call tools and persist immutable recordings keyed by workflowId
   * - replay: use persisted recordings, no external calls
   */
  toolReplayMode?: "live" | "record" | "replay";
  /** Recording set identifier; defaults to `state.workflowId` when not provided. */
  toolReplayId?: string;
}

const DEFAULT_CONFIG: Required<ScoutConfig> = {
  maxItemsPerEntity: 15,
  searchMode: "balanced",
  recencyDays: 7,
  enableWebSources: true,
  enablePipelineIntegration: true,
  briefMinPriority: 5,
  feedMinPhoenixScore: 60,
  injectedNewsItems: [],
  toolReplayMode: "live",
  toolReplayId: "",
};

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v) => {
    if (!v || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[Circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = obj[k];
    return out;
  });
}

/**
 * Build search queries for an entity
 */
function buildEntityQueries(
  entityKey: string,
  focusTopics?: string[]
): string[] {
  // Parse entity key format: "type:identifier"
  // Examples: "company:TSLA", "person:Elon Musk", "topic:AI"
  const [type, identifier] = entityKey.split(":");
  const cleanIdentifier = identifier?.replace(/_/g, " ") || entityKey;

  const queries: string[] = [];

  // Base query
  queries.push(`${cleanIdentifier} news`);

  // Type-specific queries
  switch (type?.toLowerCase()) {
    case "company":
      queries.push(`${cleanIdentifier} stock news`);
      queries.push(`${cleanIdentifier} earnings announcement`);
      queries.push(`${cleanIdentifier} product launch`);
      break;
    case "person":
      queries.push(`${cleanIdentifier} interview`);
      queries.push(`${cleanIdentifier} statement`);
      break;
    case "topic":
      queries.push(`${cleanIdentifier} latest developments`);
      queries.push(`${cleanIdentifier} breaking news`);
      break;
  }

  // Focus topic queries
  if (focusTopics && focusTopics.length > 0) {
    for (const topic of focusTopics.slice(0, 2)) {
      queries.push(`${cleanIdentifier} ${topic}`);
    }
  }

  return queries;
}

/**
 * Convert SearchResult to NewsItem
 */
function toNewsItem(result: SearchResult): NewsItem {
  return {
    headline: result.title,
    url: result.url || "",
    publishedAt: result.publishedAt || new Date().toISOString(),
    snippet: result.snippet,
    source: result.metadata?.sourceName as string || result.source || "unknown",
    relevanceScore: result.score,
  };
}

/**
 * Calculate date range for search
 */
function getDateRange(recencyDays: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - recencyDays);

  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

/**
 * Deduplicate news items by URL
 */
function deduplicateNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const unique: NewsItem[] = [];

  for (const item of items) {
    // Normalize URL for comparison
    const key = item.url.toLowerCase().replace(/\/$/, "");
    if (!seen.has(key) && key.length > 0) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique;
}

/**
 * Convert NarrativeEventInput from adapters to NewsItem format
 */
function eventInputToNewsItem(event: NarrativeEventInput): NewsItem {
  return {
    headline: event.headline,
    url: event.sourceUrls[0] || "",
    publishedAt: new Date(event.occurredAt).toISOString(),
    snippet: event.summary,
    source: event.sourceNames[0] || event.sourceType,
    relevanceScore: event.agentConfidence,
  };
}

/**
 * Pull content from existing pipelines and convert to NewsItem format.
 * Queries:
 * - dailyBriefMemories for recent brief features
 * - linkedinFundingPosts for recent funding announcements
 * - researchItems for high-scoring feed candidates
 */
async function pullFromExistingPipelines(
  ctx: ActionCtx,
  entityKeys: string[],
  config: Required<ScoutConfig>
): Promise<{ newsItems: NewsItem[]; adapterEvents: NarrativeEventInput[] }> {
  try {
    // Fetch data from existing pipelines in parallel
    const [briefFeatures, fundingPosts, feedCandidates] = await Promise.all([
      ctx.runQuery(
        internal.domains.narrative.adapters.pipelineQueries.getRecentBriefFeatures,
        {
          lookbackDays: config.recencyDays,
          minPriority: config.briefMinPriority,
        }
      ) as Promise<BriefFeature[]>,
      ctx.runQuery(
        internal.domains.narrative.adapters.pipelineQueries.getRecentFundingPosts,
        {
          lookbackDays: config.recencyDays,
        }
      ) as Promise<LinkedInFundingPost[]>,
      ctx.runQuery(
        internal.domains.narrative.adapters.pipelineQueries.getRecentFeedCandidates,
        {
          lookbackDays: config.recencyDays,
          minPhoenixScore: config.feedMinPhoenixScore,
        }
      ) as Promise<FeedRankedCandidate[]>,
    ]);

    console.log(`[ScoutAgent] Pipeline fetch: ${briefFeatures.length} brief features, ${fundingPosts.length} funding posts, ${feedCandidates.length} feed candidates`);

    // Filter by entity keys if provided
    const filteredBriefFeatures = filterByEntityKeys(briefFeatures, entityKeys, "brief");
    const filteredFundingPosts = filterByEntityKeys(fundingPosts, entityKeys, "funding");
    const filteredFeedCandidates = filterByEntityKeys(feedCandidates, entityKeys, "feed");

    const adapterInput: AdapterInput = {
      briefFeatures: filteredBriefFeatures,
      fundingPosts: filteredFundingPosts,
      feedCandidates: filteredFeedCandidates,
    };

    // Process through adapters
    const { events, stats } = processAllContent(adapterInput, {
      briefMinPriority: config.briefMinPriority,
      feedMinPhoenixScore: config.feedMinPhoenixScore,
    });

    console.log(`[ScoutAgent] Pipeline events: ${stats.briefEventsCreated} brief, ${stats.fundingEventsCreated} funding, ${stats.feedEventsCreated} feed`);

    // Convert events to NewsItems
    const newsItems = events.map(eventInputToNewsItem);

    return { newsItems, adapterEvents: events };
  } catch (error) {
    console.error(`[ScoutAgent] Pipeline integration error:`, error);
    // Return empty results on error - don't fail the whole scout
    return { newsItems: [], adapterEvents: [] };
  }
}

/**
 * Filter pipeline items by entity keys.
 * Returns all items if no entity keys specified.
 */
function filterByEntityKeys<T>(
  items: T[],
  entityKeys: string[],
  type: "brief" | "funding" | "feed"
): T[] {
  if (entityKeys.length === 0) return items;

  // Extract entity identifiers from keys (e.g., "company:TSLA" -> "tsla")
  const entityIdentifiers = entityKeys.map((key) => {
    const [, identifier] = key.split(":");
    return (identifier || key).toLowerCase().replace(/_/g, " ");
  });

  return items.filter((item) => {
    const searchText = getSearchText(item, type).toLowerCase();
    return entityIdentifiers.some((identifier) => searchText.includes(identifier));
  });
}

/**
 * Get searchable text from a pipeline item for entity matching.
 */
function getSearchText(item: unknown, type: "brief" | "funding" | "feed"): string {
  switch (type) {
    case "brief": {
      const brief = item as BriefFeature;
      return `${brief.name} ${brief.testCriteria} ${brief.notes || ""}`;
    }
    case "funding": {
      const funding = item as LinkedInFundingPost;
      return `${funding.companyName} ${funding.sector || ""} ${funding.sectorCategory || ""}`;
    }
    case "feed": {
      const feed = item as FeedRankedCandidate;
      return `${feed.title || ""} ${feed.snippet || ""} ${feed.relevanceReason || ""}`;
    }
    default:
      return "";
  }
}

/**
 * Scout Agent: Discover and ingest news for target entities
 *
 * @param ctx - Convex action context
 * @param state - Current newsroom state
 * @param config - Scout configuration
 * @returns Updated state with discovered news
 */
export async function runScoutAgent(
  ctx: ActionCtx,
  state: NewsroomState,
  config: ScoutConfig = {}
): Promise<NewsroomState> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Deterministic test mode: bypass external search entirely.
  if (cfg.injectedNewsItems && cfg.injectedNewsItems.length > 0) {
    console.log(`[ScoutAgent] Using injected news items: ${cfg.injectedNewsItems.length}`);
    const injected = deduplicateNews(cfg.injectedNewsItems);
    const fixtureMaterial = injected
      .map((n) => `${n.headline}|${n.url}|${n.publishedAt}`)
      .sort()
      .join("\n");
    const fixtureId = `fx_${fnv1a32Hex(fixtureMaterial)}`;
    const searchLogs: SearchLogEntry[] = [
      {
        query: "INJECTED_NEWS_ITEMS",
        searchType: "web_news",
        resultCount: injected.length,
        resultUrls: injected.map((n) => n.url).filter(Boolean).slice(0, 10),
        resultSnippets: injected.map((n) => n.headline).slice(0, 5),
      },
    ];
    return {
      ...state,
      fixtureId,
      weeklyNews: injected,
      searchLogs: [...state.searchLogs, ...searchLogs],
      currentStep: "historian",
    };
  }

  const orchestrator = new SearchOrchestrator(ctx);

  console.log(`[ScoutAgent] Starting news discovery for ${state.targetEntityKeys.length} entities`);
  console.log(`[ScoutAgent] Week: ${state.weekNumber}, Mode: ${cfg.searchMode}`);

  const allNews: NewsItem[] = [];
  const searchLogs: SearchLogEntry[] = [];
  const errors: string[] = [];

  // Calculate date range for this week's news
  const dateRange = getDateRange(cfg.recencyDays);

  // Process each entity
  for (const entityKey of state.targetEntityKeys) {
    console.log(`[ScoutAgent] Processing entity: ${entityKey}`);

    // Build queries for this entity
    const queries = buildEntityQueries(entityKey, state.focusTopics);

    for (const query of queries) {
      try {
        // Execute search
        const sources = cfg.enableWebSources
          ? (["brave", "serper", "tavily", "news", "linkup"] as const)
          : (["rag", "documents"] as const);
        const toolInput = {
          query,
          mode: cfg.searchMode,
          sources: [...sources],
          maxPerSource: 8,
          maxTotal: cfg.maxItemsPerEntity,
          contentTypes: ["news", "text"],
          dateRange,
          userId: state.userId,
        };
        const toolName = "searchOrchestrator.search";
        const parentWorkflowId = cfg.toolReplayId ?? state.workflowId;
        const inputHash = fnv1a32Hex(stableStringify(toolInput));

        let response: any;
        if (cfg.toolReplayMode === "replay" && parentWorkflowId) {
          const recorded = await ctx.runQuery(
            internal.domains.narrative.mutations.toolReplay.getToolRecord,
            { parentWorkflowId, toolName, inputHash }
          );
          if (!recorded) {
            throw new Error(
              `[ScoutAgent] Replay record missing for ${toolName} (${inputHash})`
            );
          }
          response = recorded;
        } else {
          response = await orchestrator.search(toolInput as any);
          if (cfg.toolReplayMode === "record" && parentWorkflowId) {
            await ctx.runMutation(internal.domains.narrative.mutations.toolReplay.saveToolRecord, {
              parentWorkflowId,
              toolName,
              inputHash,
              input: toolInput,
              output: response,
            });
          }
        }

        // Log the search
        searchLogs.push({
          query,
          searchType: "web_news",
          resultCount: response.results.length,
          resultUrls: response.results
            .filter((r) => r.url)
            .map((r) => r.url!)
            .slice(0, 10),
          resultSnippets: response.results
            .map((r) => r.snippet)
            .slice(0, 5),
        });

        // Convert to NewsItem format
        const newsItems = response.results
          .filter((r) => r.url) // Only include items with URLs
          .map(toNewsItem);

        allNews.push(...newsItems);

        console.log(`[ScoutAgent] Query "${query}" returned ${newsItems.length} items`);

        // Check for any search errors
        if (response.errors && response.errors.length > 0) {
          for (const err of response.errors) {
            errors.push(`${err.source}: ${err.error}`);
          }
        }
      } catch (error) {
        const errorMsg = `Failed to search "${query}": ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[ScoutAgent] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }
  }

  // Pull from existing content pipelines if enabled
  let adapterEvents: NarrativeEventInput[] = [];

  if (cfg.enablePipelineIntegration) {
    console.log(`[ScoutAgent] Pulling from existing content pipelines...`);
    const pipelineResult = await pullFromExistingPipelines(ctx, state.targetEntityKeys, cfg);
    allNews.push(...pipelineResult.newsItems);
    adapterEvents = pipelineResult.adapterEvents;

    // Log pipeline search
    if (pipelineResult.newsItems.length > 0) {
      searchLogs.push({
        query: `Pipeline integration: ${state.targetEntityKeys.join(", ")}`,
        searchType: "historical",
        resultCount: pipelineResult.newsItems.length,
        resultUrls: pipelineResult.newsItems.map((n) => n.url).filter(Boolean).slice(0, 10),
        resultSnippets: pipelineResult.newsItems.map((n) => n.snippet).slice(0, 5),
      });
    }
  }

  // Deduplicate and sort by relevance
  const uniqueNews = deduplicateNews(allNews);
  uniqueNews.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Take top items across all entities
  const topNews = uniqueNews.slice(0, cfg.maxItemsPerEntity * state.targetEntityKeys.length);

  console.log(`[ScoutAgent] Discovery complete: ${topNews.length} unique items from ${allNews.length} total`);
  console.log(`[ScoutAgent] Adapter events: ${adapterEvents.length} pre-processed events`);
  console.log(`[ScoutAgent] Logged ${searchLogs.length} searches`);

  // Return updated state
  return {
    ...state,
    weeklyNews: topNews,
    searchLogs: [...state.searchLogs, ...searchLogs],
    errors: [...state.errors, ...errors],
    currentStep: "historian", // Advance to next step
    // Include adapter events for downstream processing
    adapterEvents,
  } as NewsroomState;
}

/**
 * Scout Agent tool definition for use in LangGraph
 */
export const scoutAgentTool = {
  name: "scout_news",
  description: "Discover and ingest this week's news for target entities",
  parameters: {
    entityKeys: {
      type: "array",
      items: { type: "string" },
      description: "Entity keys to search for (e.g., 'company:TSLA')",
    },
    focusTopics: {
      type: "array",
      items: { type: "string" },
      description: "Optional focus topics to prioritize",
    },
    maxItemsPerEntity: {
      type: "number",
      description: "Maximum news items per entity",
    },
  },
};
