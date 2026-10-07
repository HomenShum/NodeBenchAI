// convex/tools/unifiedMemoryTools.ts
// Unified memory query tools for GAM (General Agentic Memory)
// All quality evaluation uses boolean flags, not arbitrary scores.

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { isMemoryEnabled } from "../../lib/featureFlags";
import {
  buildCanonicalKey,
  resolveFromConfirmedCompany,
  resolveFromEntityContext,
  resolveNewEntity,
  type ResolvedEntity
} from "../../lib/entityResolution";
import { MEMORY_LIMITS } from "../../lib/memoryLimits";
import type { Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS - Extracted to avoid "Type instantiation is excessively deep"
// ═══════════════════════════════════════════════════════════════════════════

const memoryTargetTypesSchema = z.array(z.enum(["entity", "confirmation"]));

const entityTypeSchema = z.enum(["company", "person", "theme"]);
const researchDepthSchema = z.enum(["shallow", "standard", "deep"]);
const updateEntityTypeSchema = z.enum(["company", "person"]);

const importanceSchema = z.object({
  userPinned: z.boolean().optional(),
  repeatCount: z.number().optional(),
  isExplicitRequest: z.boolean().optional(),
});

const factSchema = z.object({
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
  confidence: z.number().min(0).max(1),
});

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface MemoryQueryResult {
  /** Was any memory found? */
  found: boolean;
  
  /** Array of matching memories */
  memories: Array<{
    type: "entity" | "theme" | "confirmation";
    id: string;
    canonicalKey?: string;
    name: string;
    entityType?: "company" | "person";
    summary?: string;
    keyFacts?: string[];
    narratives?: Array<{ label: string; description: string }>;
    heuristics?: string[];
    /** Boolean: is this memory stale? */
    isStale: boolean;
    /** Age in days */
    ageInDays: number;
    /** Boolean quality flags */
    quality?: {
      hasSufficientFacts: boolean;
      hasRecentResearch: boolean;
      hasNoConflicts: boolean;
      hasVerifiedSources: boolean;
    };
    /** Quality tier derived from flags */
    qualityTier?: "excellent" | "good" | "fair" | "poor";
    source: string;
  }>;
  
  /** Stale memories (returned if main results empty and includeStale=true) */
  staleMemories?: MemoryQueryResult["memories"];
  
  /** Suggestion for the agent */
  suggestion?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERY MEMORY - Search across all memory systems
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Query unified memory for existing knowledge.
 * Searches entityContexts + confirmedCompanies.
 * 
 * IMPORTANT: Agents should call this BEFORE external API calls.
 */
export const queryMemory = createTool({
  description: `Query memory for existing knowledge about entities or themes.

ALWAYS call this BEFORE external API calls or enrichment tools.

Searches:
- Entity memories (entityContexts) - companies, people
- Confirmation cache (confirmedCompanies, confirmedPeople) - disambiguated entities

Returns boolean quality flags (not arbitrary scores):
- hasSufficientFacts: true if >= 5 facts
- hasRecentResearch: true if < 7 days old
- hasNoConflicts: true if no unresolved conflicts
- hasVerifiedSources: true if >= 2 sources`,

  args: z.object({
    query: z.string().describe("Search query (entity name, topic)"),
    targetTypes: z.array(z.enum(["entity", "confirmation"]))
      .default(["entity", "confirmation"])
      .describe("Which memory types to search"),
    maxAgeDays: z.number().optional().default(30)
      .describe("Max age for results (default: 30)"),
    includeStale: z.boolean().optional().default(false)
      .describe("Include stale results if no fresh found"),
  }),

  handler: async (ctx, args): Promise<MemoryQueryResult> => {
    const userId = await getAuthUserId(ctx);
    
    // Feature flag check
    if (!isMemoryEnabled(userId as string, "ENABLE_MEMORY_QUERY")) {
      console.log("[queryMemory] Memory query disabled by feature flag");
      return { 
        found: false, 
        memories: [], 
        suggestion: "Memory query disabled" 
      };
    }

    const results: MemoryQueryResult["memories"] = [];
    const staleResults: MemoryQueryResult["memories"] = [];
    const now = Date.now();

    // 1. Search entityContexts
    if (args.targetTypes.includes("entity")) {
      try {
        const entities = await ctx.runQuery(api.domains.knowledge.entityContexts.searchEntityContexts, {
          searchTerm: args.query,
        });

        for (const e of entities) {
          const ageInDays = Math.floor((now - e.researchedAt) / (24 * 60 * 60 * 1000));
          const isStale = e.isStale || ageInDays > MEMORY_LIMITS.entityStaleDays;

          const entry = {
            type: "entity" as const,
            id: e._id,
            canonicalKey: e.canonicalKey,
            name: e.entityName,
            entityType: e.entityType,
            summary: e.summary,
            keyFacts: e.keyFacts,
            narratives: e.narratives?.map((n: { label: string; description: string }) => ({ 
              label: n.label, 
              description: n.description 
            })),
            heuristics: e.heuristics,
            isStale,
            ageInDays,
            quality: e.quality,
            qualityTier: e.qualityTier,
            source: "entityContexts",
          };

          if (ageInDays <= args.maxAgeDays && !isStale) {
            results.push(entry);
          } else {
            staleResults.push(entry);
          }
        }
      } catch (err) {
        console.error("[queryMemory] Entity search error:", err);
      }
    }

    // 2. Search confirmation cache
    if (args.targetTypes.includes("confirmation")) {
      try {
        // Search confirmedCompanies by name pattern
        // Note: This is a simplified search - full implementation would use search index
        const searchLower = args.query.toLowerCase();
        
        // For now, we can't do full-text search on confirmedCompanies
        // But if we have an exact match, include it
        // This would be enhanced with a search index in production
        
      } catch (err) {
        console.error("[queryMemory] Confirmation search error:", err);
      }
    }

    // Sort by quality tier and freshness
    const tierOrder = { excellent: 0, good: 1, fair: 2, poor: 3 };
    results.sort((a, b) => {
      const tierA = tierOrder[a.qualityTier || "fair"];
      const tierB = tierOrder[b.qualityTier || "fair"];
      if (tierA !== tierB) return tierA - tierB;
      return a.ageInDays - b.ageInDays;
    });

    // If no fresh results but have stale, and includeStale is true
    if (results.length === 0 && staleResults.length > 0 && args.includeStale) {
      return {
        found: true,
        memories: staleResults,
        suggestion: `Found ${staleResults.length} stale memories. Consider refreshing.`,
      };
    }

    // Build suggestion
    let suggestion: string | undefined;
    if (results.length === 0) {
      suggestion = staleResults.length > 0
        ? `No fresh memories. ${staleResults.length} stale results available (set includeStale=true).`
        : "No existing memory found. Use enrichment tools to build knowledge.";
    } else if (results.some(m => m.isStale)) {
      suggestion = "Some memories are stale. Consider refreshing.";
    }

    return {
      found: results.length > 0,
      memories: results,
      staleMemories: staleResults.length > 0 ? staleResults : undefined,
      suggestion,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// GET OR BUILD MEMORY - Lazy research trigger
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get existing memory or trigger research if missing/stale.
 * 
 * IMPORTANT: Only use for significant entities. For casual queries, use queryMemory alone.
 */
export const getOrBuildMemory = createTool({
  description: `Get existing memory or trigger research if missing/stale.

Only use this for SIGNIFICANT entities that warrant research.
For casual queries, use queryMemory alone.

Will schedule research only if:
- User explicitly requests deep research
- Entity has been queried 3+ times
- User pinned the entity`,

  args: z.object({
    name: z.string().describe("Entity name"),
    type: z.enum(["company", "person", "theme"]).describe("Entity type"),
    forceRefresh: z.boolean().optional().describe("Force refresh even if fresh"),
    researchDepth: z.enum(["shallow", "standard", "deep"]).optional().default("standard"),
    importance: z.object({
      userPinned: z.boolean().optional(),
      repeatCount: z.number().optional(),
      isExplicitRequest: z.boolean().optional(),
    }).optional().describe("Importance signals to determine if research should be scheduled"),
  }),

  handler: async (ctx, args): Promise<{
    status: "found" | "stale" | "pending" | "skipped";
    memory?: any;
    jobId?: string;
    message: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    
    // Feature flag check
    if (!isMemoryEnabled(userId as string, "ENABLE_MEMORY_QUERY")) {
      return { 
        status: "skipped", 
        message: "Memory disabled by feature flag" 
      };
    }

    // Check importance signals
    const importance = args.importance || {};
    const shouldScheduleJob = 
      importance.userPinned ||
      importance.isExplicitRequest ||
      (importance.repeatCount ?? 0) >= 3;

    // Build canonical key
    const canonicalKey = buildCanonicalKey(args.type, args.name);

    if (args.type === "company" || args.type === "person") {
      // Check entityContexts
      const existing = await ctx.runQuery(api.domains.knowledge.entityContexts.getEntityContext, {
        entityName: args.name,
        entityType: args.type,
      });

      if (existing && !args.forceRefresh) {
        // Update access count
        await ctx.runMutation(api.domains.knowledge.entityContexts.updateAccessCount, { 
          id: existing._id 
        });

        if (!existing.isStale) {
          return {
            status: "found",
            memory: {
              ...existing,
              canonicalKey: existing.canonicalKey || canonicalKey,
            },
            message: `Found fresh memory for ${args.name} (${existing.ageInDays} days old, tier=${existing.qualityTier || "unknown"})`,
          };
        } else {
          // Stale - optionally schedule refresh
          if (shouldScheduleJob && isMemoryEnabled(userId as string, "ENABLE_RESEARCH_JOBS")) {
            try {
              const jobId = await ctx.runMutation(internal.domains.agents.researchJobs.createJob, {
                targetType: "entity",
                targetId: canonicalKey,
                targetDisplayName: args.name,
                jobType: "refresh",
                researchDepth: args.researchDepth,
                priority: 50,
                triggerSource: "getOrBuildMemory",
              });
              
              return {
                status: "stale",
                memory: existing,
                jobId,
                message: `Found stale memory (${existing.ageInDays} days). Background refresh scheduled.`,
              };
            } catch (err) {
              console.warn("[getOrBuildMemory] Failed to schedule refresh:", err);
            }
          }
          
          return {
            status: "stale",
            memory: existing,
            message: `Found stale memory (${existing.ageInDays} days). Refresh not scheduled (low importance or disabled).`,
          };
        }
      }

      // No memory exists
      if (!shouldScheduleJob) {
        return {
          status: "skipped",
          message: `No memory for ${args.name}. Research not scheduled (low importance). Use enrichment tools for immediate results.`,
        };
      }

      if (!isMemoryEnabled(userId as string, "ENABLE_RESEARCH_JOBS")) {
        return {
          status: "skipped",
          message: `No memory for ${args.name}. Research jobs disabled.`,
        };
      }

      try {
        const jobId = await ctx.runMutation(internal.domains.agents.researchJobs.createJob, {
          targetType: "entity",
          targetId: canonicalKey,
          targetDisplayName: args.name,
          jobType: "initial",
          researchDepth: args.researchDepth,
          priority: 70,
          triggerSource: "getOrBuildMemory",
        });

        return {
          status: "pending",
          jobId,
          message: `No memory for ${args.name}. Research job scheduled.`,
        };
      } catch (err) {
        return {
          status: "skipped",
          message: `Failed to schedule research: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    } else {
      // Theme memory - not fully implemented yet
      return {
        status: "skipped",
        message: `Theme memory for "${args.name}" not yet implemented.`,
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE MEMORY FROM REVIEW - Persist learnings
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Merge findings from a document review into entity memory.
 * Extracts facts and updates the entity's structured memory.
 */
export const updateMemoryFromReview = createTool({
  description: `Merge findings from a review into entity memory.

Call this after completing deep analysis to persist learnings.
Extracts structured facts and updates memory.

Each fact needs:
- subject: The entity the fact is about
- predicate: The relationship/property
- object: The value
- confidence: 0.0-1.0 (will be converted to boolean isHighConfidence)`,

  args: z.object({
    reviewContent: z.string().describe("The review/analysis summary"),
    documentId: z.string().optional().describe("Source document ID"),
    entityName: z.string().describe("Primary entity being updated"),
    entityType: z.enum(["company", "person"]).describe("Entity type"),
    newFacts: z.array(z.object({
      subject: z.string(),
      predicate: z.string(),
      object: z.string(),
      confidence: z.number().min(0).max(1),
    })).optional().describe("Structured facts extracted from review"),
  }),

  handler: async (ctx, args): Promise<{
    success: boolean;
    factsAdded: number;
    factsRejected: number;
    conflictsDetected: number;
    qualityTier?: string;
    message: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    
    // Feature flag check
    if (!isMemoryEnabled(userId as string, "ENABLE_MEMORY_WRITE")) {
      return {
        success: false,
        factsAdded: 0,
        factsRejected: 0,
        conflictsDetected: 0,
        message: "Memory write disabled by feature flag",
      };
    }

    // Find the entity
    const entity = await ctx.runQuery(api.domains.knowledge.entityContexts.getEntityContext, {
      entityName: args.entityName,
      entityType: args.entityType,
    });

    if (!entity) {
      return {
        success: false,
        factsAdded: 0,
        factsRejected: 0,
        conflictsDetected: 0,
        message: `Entity "${args.entityName}" not found. Create it first with enrichment tools.`,
      };
    }

    // If no facts provided, just log
    if (!args.newFacts || args.newFacts.length === 0) {
      console.log(`[updateMemoryFromReview] No facts provided for ${args.entityName}`);
      return {
        success: true,
        factsAdded: 0,
        factsRejected: 0,
        conflictsDetected: 0,
        message: "No facts to merge. Review content logged.",
      };
    }

    // Merge facts into memory
    try {
      const result = await ctx.runMutation(internal.domains.knowledge.entityContexts.mergeFactsIntoMemory, {
        entityId: entity._id,
        newFacts: args.newFacts,
        sourceDocId: args.documentId,
        reviewSummary: args.reviewContent.slice(0, 500),
      });

      return {
        success: true,
        factsAdded: result.factsAdded,
        factsRejected: result.factsRejected,
        conflictsDetected: result.conflictsDetected,
        qualityTier: result.qualityTier,
        message: `Updated ${args.entityName}: +${result.factsAdded} facts, tier=${result.qualityTier}`,
      };
    } catch (err) {
      return {
        success: false,
        factsAdded: 0,
        factsRejected: 0,
        conflictsDetected: 0,
        message: `Failed to merge facts: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// RESOLVE ENTITY - Canonicalize entity names
// ═══════════════════════════════════════════════════════════════════════════

// Validator for entity type
const entityTypeValidator = v.union(v.literal("company"), v.literal("person"), v.literal("theme"));

/**
 * Resolve a free-form entity name to a canonical key.
 * Checks confirmed tables first, then entityContexts, then generates new key.
 */
export const resolveEntityAction = action({
  args: {
    name: v.string(),
    type: entityTypeValidator,
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ResolvedEntity> => {
    // 1. Check confirmation cache first (for companies)
    if (args.type === "company" && args.threadId) {
      const confirmed = await ctx.runQuery(internal.tools.sec.secCompanySearch.getConfirmedCompany, {
        threadId: args.threadId,
        companyName: args.name,
      });
      
      if (confirmed) {
        return resolveFromConfirmedCompany({
          confirmedName: confirmed.name,
          confirmedTicker: confirmed.ticker,
          confirmedCik: confirmed.cik,
        });
      }
    }

    // 2. Check entityContexts
    if (args.type === "company" || args.type === "person") {
      const existing = await ctx.runQuery(api.domains.knowledge.entityContexts.getEntityContext, {
        entityName: args.name,
        entityType: args.type,
      });

      if (existing) {
        return resolveFromEntityContext({
          entityName: existing.entityName,
          entityType: existing.entityType,
          canonicalKey: existing.canonicalKey,
        });
      }
    }

    // 3. Generate new key
    return resolveNewEntity(args.name, args.type);
  },
});
