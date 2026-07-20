/**
 * Historian Agent - Historical Context Retrieval
 *
 * The second agent in the Newsroom pipeline. Responsible for:
 * 1. Retrieving relevant claims from Knowledge Graphs
 * 2. Fetching existing narrative threads for entities
 * 3. Getting entity contexts with historical data
 * 4. Building temporal context for narrative analysis
 *
 * @module domains/narrative/newsroom/agents/historianAgent
 */

import type { ActionCtx } from "../../../../../_generated/server";
import { internal, api } from "../../../../../_generated/api";
import type { Id, Doc } from "../../../../../_generated/dataModel";
import type {
  NewsroomState,
  HistoricalClaim,
  ExistingThread,
  SearchLogEntry,
} from "../state";

/**
 * Configuration for Historian Agent
 */
export interface HistorianConfig {
  /** Maximum claims per entity */
  maxClaimsPerEntity?: number;
  /** Maximum threads to retrieve */
  maxThreads?: number;
  /** Look back window in days */
  lookbackDays?: number;
  /** Include entity contexts */
  includeEntityContexts?: boolean;
}

const DEFAULT_CONFIG: Required<HistorianConfig> = {
  maxClaimsPerEntity: 20,
  maxThreads: 10,
  lookbackDays: 90,
  includeEntityContexts: true,
};

/**
 * Parse entity key to extract type and identifier
 */
function parseEntityKey(entityKey: string): { type: string; identifier: string } {
  const [type, ...rest] = entityKey.split(":");
  const rawType = (type || "entity").toLowerCase();
  const normalizedType =
    rawType === "company" ||
    rawType === "person" ||
    rawType === "org" ||
    rawType === "organization" ||
    rawType === "entity"
      ? "entity"
      : rawType === "topic" || rawType === "theme" || rawType === "tag"
        ? "theme"
        : rawType === "artifact" || rawType === "model" || rawType === "product"
          ? "artifact"
          : rawType;
  return {
    type: normalizedType,
    identifier: rest.join(":") || entityKey,
  };
}

/**
 * Convert database claim to HistoricalClaim format
 */
function toHistoricalClaim(claim: Doc<"graphClaims">): HistoricalClaim {
  return {
    claimId: claim._id as string,
    claimText: claim.claimText,
    subject: claim.subject,
    predicate: claim.predicate,
    object: claim.object,
    timestamp: new Date(claim.extractedAt || claim.createdAt).toISOString(),
    sourceDocIds: claim.sourceDocIds || [],
  };
}

/**
 * Convert database thread to ExistingThread format
 */
function toExistingThread(thread: Doc<"narrativeThreads">): ExistingThread {
  return {
    threadId: thread._id as string,
    name: thread.name,
    thesis: thread.thesis,
    latestEventAt: thread.latestEventAt,
    currentPhase: thread.currentPhase,
  };
}

/**
 * Historian Agent: Retrieve historical context from Knowledge Graph
 *
 * @param ctx - Convex action context
 * @param state - Current newsroom state
 * @param config - Historian configuration
 * @returns Updated state with historical context
 */
export async function runHistorianAgent(
  ctx: ActionCtx,
  state: NewsroomState,
  config: HistorianConfig = {}
): Promise<NewsroomState> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  console.log(`[HistorianAgent] Retrieving historical context for ${state.targetEntityKeys.length} entities`);
  console.log(`[HistorianAgent] Lookback: ${cfg.lookbackDays} days, Max claims: ${cfg.maxClaimsPerEntity}`);

  const allClaims: HistoricalClaim[] = [];
  const existingThreads: ExistingThread[] = [];
  const searchLogs: SearchLogEntry[] = [];
  const errors: string[] = [];
  let deterministicIdSeq = 0;

  // Calculate lookback timestamp.
  // In deterministic mode, anchor the lookback window to the workflow's deterministic clock.
  const baseNowMs = state.deterministicNowMs ?? Date.now();
  const lookbackDate = new Date(baseNowMs);
  lookbackDate.setDate(lookbackDate.getDate() - cfg.lookbackDays);
  const lookbackTimestamp = lookbackDate.getTime();

  // Process each entity key
  for (const entityKey of state.targetEntityKeys) {
    const { type, identifier } = parseEntityKey(entityKey);
    console.log(`[HistorianAgent] Processing entity: ${entityKey}`);

    try {
      // 1. Get knowledge graph for this entity
      const graph = await ctx.runQuery(
        api.domains.knowledge.knowledgeGraph.getGraphBySource,
        {
          sourceType: type as "entity" | "theme" | "artifact" | "session",
          sourceId: identifier,
        }
      );

      if (graph) {
        // Get claims from the graph
        const claims = await ctx.runQuery(
          api.domains.knowledge.knowledgeGraph.getGraphClaims,
          { graphId: graph._id }
        );

        // Filter by recency and convert to HistoricalClaim
        const recentClaims = claims
          .filter((c: Doc<"graphClaims">) => {
            const claimTime = c.extractedAt || c.createdAt;
            return claimTime >= lookbackTimestamp;
          })
          .slice(0, cfg.maxClaimsPerEntity)
          .map(toHistoricalClaim);

        allClaims.push(...recentClaims);

        // Log the KG query
        searchLogs.push({
          query: `Knowledge graph claims for ${entityKey}`,
          searchType: "historical",
          resultCount: recentClaims.length,
          resultUrls: [],
          resultSnippets: recentClaims.slice(0, 3).map((c) => c.claimText),
        });

        console.log(`[HistorianAgent] Found ${recentClaims.length} claims for ${entityKey}`);
      } else {
        console.log(`[HistorianAgent] No knowledge graph found for ${entityKey}`);
      }

      // 2. Get existing narrative threads for this entity
      const threads = await ctx.runQuery(
        api.domains.narrative.queries.threads.getThreadsByEntity,
        { entityKey }
      );

      if (threads && threads.length > 0) {
        const recentThreads = threads
          .filter((t: Doc<"narrativeThreads">) => t.latestEventAt >= lookbackTimestamp)
          .slice(0, cfg.maxThreads)
          .map(toExistingThread);

        existingThreads.push(...recentThreads);

        // Log the thread query
        searchLogs.push({
          query: `Narrative threads for ${entityKey}`,
          searchType: "entity_context",
          resultCount: recentThreads.length,
          resultUrls: [],
          resultSnippets: recentThreads.map((t) => `${t.name}: ${t.thesis.slice(0, 100)}`),
        });

        console.log(`[HistorianAgent] Found ${recentThreads.length} threads for ${entityKey}`);
      }

      // 3. Get entity context if enabled
      if (cfg.includeEntityContexts) {
        const entityContext = await ctx.runQuery(
          api.domains.knowledge.entityContexts.getEntityContext,
          {
            entityName: identifier.replace(/_/g, " "),
            entityType: type === "company" ? "company" : "person",
          }
        );

        if (entityContext) {
          // Extract structured facts as claims if available
          const structuredFacts = entityContext.structuredFacts || [];
          const factClaims: HistoricalClaim[] = structuredFacts
            .filter((f: any) => !f.isOutdated)
            .slice(0, 10)
            .map((f: any) => ({
              claimId: f.id || `fact_${baseNowMs}_${deterministicIdSeq++}`,
              claimText: `${f.subject} ${f.predicate}: ${f.object}`,
              subject: f.subject,
              predicate: f.predicate,
              object: f.object,
              timestamp: f.timestamp || new Date(baseNowMs).toISOString(),
              sourceDocIds: f.sourceIds || [],
            }));

          allClaims.push(...factClaims);

          // Add narratives from entity context
          const narratives = entityContext.narratives || [];
          for (const narrative of narratives.slice(0, 3)) {
            allClaims.push({
              claimId: `narrative_${entityKey}_${baseNowMs}_${deterministicIdSeq++}`,
              claimText: `${narrative.label}: ${narrative.description}`,
              subject: identifier,
              predicate: "has_narrative",
              object: narrative.label,
              timestamp: narrative.lastUpdated || new Date(baseNowMs).toISOString(),
              sourceDocIds: narrative.supportingFactIds || [],
            });
          }

          // Log entity context retrieval
          searchLogs.push({
            query: `Entity context for ${entityKey}`,
            searchType: "entity_context",
            resultCount: factClaims.length + narratives.length,
            resultUrls: [],
            resultSnippets: [entityContext.summary?.slice(0, 200) || ""],
          });

          console.log(`[HistorianAgent] Added ${factClaims.length} facts from entity context`);
        }
      }
    } catch (error) {
      const errorMsg = `Failed to retrieve history for ${entityKey}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[HistorianAgent] ${errorMsg}`);
      errors.push(errorMsg);
    }
  }

  // Deduplicate claims by claimId
  const uniqueClaims = Array.from(
    new Map(allClaims.map((c) => [c.claimId, c])).values()
  );

  // Deduplicate threads by threadId
  const uniqueThreads = Array.from(
    new Map(existingThreads.map((t) => [t.threadId, t])).values()
  );

  // Sort claims by timestamp (newest first)
  uniqueClaims.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Sort threads by latest activity
  uniqueThreads.sort((a, b) => b.latestEventAt - a.latestEventAt);

  console.log(`[HistorianAgent] Retrieved ${uniqueClaims.length} unique claims, ${uniqueThreads.length} threads`);
  console.log(`[HistorianAgent] Logged ${searchLogs.length} context retrievals`);

  // Return updated state
  return {
    ...state,
    historicalContext: uniqueClaims,
    existingThreads: uniqueThreads,
    searchLogs: [...state.searchLogs, ...searchLogs],
    errors: [...state.errors, ...errors],
    currentStep: "analyst", // Advance to next step
  };
}

/**
 * Historian Agent tool definition for use in LangGraph
 */
export const historianAgentTool = {
  name: "retrieve_history",
  description: "Retrieve historical context from knowledge graphs and entity memory",
  parameters: {
    entityKeys: {
      type: "array",
      items: { type: "string" },
      description: "Entity keys to retrieve history for",
    },
    lookbackDays: {
      type: "number",
      description: "How far back to look for historical data",
    },
  },
};
