// convex/domains/knowledge/entityContexts.ts
// Entity context storage for caching company/person research results
// Extended with GAM (General Agentic Memory) support

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "../../_generated/dataModel";
import {
  evaluateMemoryQuality,
  isFactHighConfidence,
  type MemoryQualityFlags,
  type QualityTier
} from "../../lib/memoryQuality";
import {
  buildCanonicalKey,
  type EntityType
} from "../../lib/entityResolution";
import {
  validateFactBatch,
  findConflicts,
  generateFactId,
  type StructuredFact
} from "../../lib/factValidation";
import { MEMORY_LIMITS, QUALITY_THRESHOLDS } from "../../lib/memoryLimits";

/**
 * Store or update entity research context
 */
export const storeEntityContext = mutation({
  args: {
    entityName: v.string(),
    entityType: v.union(v.literal("company"), v.literal("person")),
    linkupData: v.optional(v.any()),
    summary: v.string(),
    keyFacts: v.array(v.string()),
    sources: v.array(v.object({
      name: v.string(),
      url: v.string(),
      snippet: v.optional(v.string()),
    })),
    crmFields: v.optional(v.any()),
    // Banker-grade enrichment fields
    funding: v.optional(v.any()),
    people: v.optional(v.any()),
    productPipeline: v.optional(v.any()),
    recentNewsItems: v.optional(v.any()),
    contactPoints: v.optional(v.any()),
    freshness: v.optional(v.any()),
    personaHooks: v.optional(v.any()),
    spreadsheetId: v.optional(v.id("documents")),
    rowIndex: v.optional(v.number()),
    // Optional for anonymous users - they can still research entities
    researchedBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const canonicalKey = buildCanonicalKey(args.entityType, args.entityName);

    // Check if entity context already exists
    const existing = await ctx.db
      .query("entityContexts")
      .withIndex("by_entity", (q) =>
        q.eq("entityName", args.entityName).eq("entityType", args.entityType)
      )
      .first() as Doc<"entityContexts"> | null;

    if (existing) {
      // Update existing context
      await ctx.db.patch(existing._id, {
        linkupData: args.linkupData,
        summary: args.summary,
        keyFacts: args.keyFacts,
        sources: args.sources,
        crmFields: args.crmFields,
        // Banker-grade enrichment fields
        funding: args.funding,
        people: args.people,
        productPipeline: args.productPipeline,
        recentNewsItems: args.recentNewsItems,
        contactPoints: args.contactPoints,
        freshness: args.freshness,
        personaHooks: args.personaHooks,
        spreadsheetId: args.spreadsheetId,
        rowIndex: args.rowIndex,
        canonicalKey,
        researchedAt: now,
        researchedBy: args.researchedBy,
        lastAccessedAt: now,
        version: existing.version + 1,
        isStale: false,
      });

      await ctx.scheduler.runAfter(
        0,
        internal.domains.deepTrace.integrations.syncEntityContextToDeepTrace,
        { entityContextId: existing._id },
      );

      console.log(`[entityContexts] Updated context for ${args.entityType}: ${args.entityName}`);
      return existing._id;
    } else {
      // Create new context
      const id = await ctx.db.insert("entityContexts", {
        entityName: args.entityName,
        entityType: args.entityType,
        linkupData: args.linkupData,
        summary: args.summary,
        keyFacts: args.keyFacts,
        sources: args.sources,
        crmFields: args.crmFields,
        // Banker-grade enrichment fields
        funding: args.funding,
        people: args.people,
        productPipeline: args.productPipeline,
        recentNewsItems: args.recentNewsItems,
        contactPoints: args.contactPoints,
        freshness: args.freshness,
        personaHooks: args.personaHooks,
        spreadsheetId: args.spreadsheetId,
        rowIndex: args.rowIndex,
        canonicalKey,
        researchedAt: now,
        researchedBy: args.researchedBy,
        lastAccessedAt: now,
        accessCount: 0,
        version: 1,
        isStale: false,
      });

      await ctx.scheduler.runAfter(
        0,
        internal.domains.deepTrace.integrations.syncEntityContextToDeepTrace,
        { entityContextId: id },
      );

      console.log(`[entityContexts] Created context for ${args.entityType}: ${args.entityName}`);
      return id;
    }
  },
});

/**
 * Get entity research context by name and type
 */
export const getEntityContext = query({
  args: {
    entityName: v.string(),
    entityType: v.union(v.literal("company"), v.literal("person")),
  },
  handler: async (ctx, args) => {
    const context = await ctx.db
      .query("entityContexts")
      .withIndex("by_entity", (q) =>
        q.eq("entityName", args.entityName).eq("entityType", args.entityType)
      )
      .first() as Doc<"entityContexts"> | null;

    if (!context) {
      return null;
    }

    // Check if stale (> 7 days)
    const age = Date.now() - context.researchedAt;
    const isStale = age > 7 * 24 * 60 * 60 * 1000;

    return {
      ...context,
      isStale,
      ageInDays: Math.floor(age / (1000 * 60 * 60 * 24)),
    };
  },
});

/**
 * Get entity context by ID (internal use)
 * Used for enriching funding events with entity data
 */
export const getEntityContextById = internalQuery({
  args: {
    entityId: v.id("entityContexts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.entityId) as Doc<"entityContexts"> | null;
  },
});

/**
 * Get entity context by name only - tries company first, then person
 * Used by EntityProfilePage when type is unknown
 */
export const getEntityContextByName = query({
  args: {
    entityName: v.string(),
  },
  handler: async (ctx, args) => {
    // Try company first (most common)
    let context = await ctx.db
      .query("entityContexts")
      .withIndex("by_entity", (q) =>
        q.eq("entityName", args.entityName).eq("entityType", "company")
      )
      .first() as Doc<"entityContexts"> | null;

    // Fall back to person
    if (!context) {
      context = await ctx.db
        .query("entityContexts")
        .withIndex("by_entity", (q) =>
          q.eq("entityName", args.entityName).eq("entityType", "person")
        )
        .first() as Doc<"entityContexts"> | null;
    }

    if (!context) {
      return null;
    }

    // Check if stale (> 7 days)
    const age = Date.now() - context.researchedAt;
    const isStale = age > 7 * 24 * 60 * 60 * 1000;

    return {
      ...context,
      isStale,
      ageInDays: Math.floor(age / (1000 * 60 * 60 * 24)),
      // Include type for UI rendering
      type: context.entityType,
    };
  },
});

/**
 * Update access count when entity context is used
 */
export const updateAccessCount = mutation({
  args: {
    id: v.id("entityContexts"),
  },
  handler: async (ctx, args) => {
    const context = await ctx.db.get(args.id) as Doc<"entityContexts"> | null;
    if (!context) {
      throw new Error("Entity context not found");
    }

    await ctx.db.patch(args.id, {
      lastAccessedAt: Date.now(),
      accessCount: context.accessCount + 1,
    });

    console.log(`[entityContexts] Cache hit for ${context.entityType}: ${context.entityName} (count: ${context.accessCount + 1})`);
  },
});

/**
 * List all entity contexts for a user
 */
export const listEntityContexts = query({
  args: {
    entityType: v.optional(v.union(v.literal("company"), v.literal("person"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    
    const results = await ctx.db
      .query("entityContexts")
      .withIndex("by_user", (q) => q.eq("researchedBy", userId))
      .collect() as Doc<"entityContexts">[];

    // Filter by entity type if specified
    const filtered = args.entityType
      ? results.filter((r: Doc<"entityContexts">) => r.entityType === args.entityType)
      : results;

    // Sort by most recently accessed
    const sorted = filtered.sort((a: Doc<"entityContexts">, b: Doc<"entityContexts">) => b.lastAccessedAt - a.lastAccessedAt);

    // Limit results
    const limited = args.limit ? sorted.slice(0, args.limit) : sorted;

    // Add age and stale flag
    return limited.map((context: Doc<"entityContexts">) => {
      const age = Date.now() - context.researchedAt;
      const isStale = age > 7 * 24 * 60 * 60 * 1000;

      return {
        ...context,
        isStale,
        ageInDays: Math.floor(age / (1000 * 60 * 60 * 24)),
      };
    });
  },
});

/**
 * Search entity contexts by name
 */
export const searchEntityContexts = query({
  args: {
    searchTerm: v.string(),
    entityType: v.optional(v.union(v.literal("company"), v.literal("person"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    
    const results = await ctx.db
      .query("entityContexts")
      .withSearchIndex("search_entity", (q) =>
        q.search("entityName", args.searchTerm)
          .eq("researchedBy", userId)
      )
      .collect() as Doc<"entityContexts">[];

    // Filter by entity type if specified
    const filtered = args.entityType
      ? results.filter((r: Doc<"entityContexts">) => r.entityType === args.entityType)
      : results;

    // Add age and stale flag
    return filtered.map((context: Doc<"entityContexts">) => {
      const age = Date.now() - context.researchedAt;
      const isStale = age > 7 * 24 * 60 * 60 * 1000;

      return {
        ...context,
        isStale,
        ageInDays: Math.floor(age / (1000 * 60 * 60 * 24)),
      };
    });
  },
});

/**
 * Delete entity context
 */
export const deleteEntityContext = mutation({
  args: {
    id: v.id("entityContexts"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const context = await ctx.db.get(args.id) as Doc<"entityContexts"> | null;
    if (!context) {
      throw new Error("Entity context not found");
    }

    // Only allow deletion if user owns the context
    if (context.researchedBy !== userId) {
      throw new Error("Not authorized to delete this context");
    }

    await ctx.db.delete(args.id);
    console.log(`[entityContexts] Deleted context for ${context.entityType}: ${context.entityName}`);
  },
});

/**
 * Mark stale contexts (> 7 days old)
 * Internal mutation so it can be called from cron jobs.
 */
export const markStaleContexts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sevenDaysAgo = now - MEMORY_LIMITS.entityStaleDays * 24 * 60 * 60 * 1000;

    const contexts = await ctx.db.query("entityContexts").collect() as Doc<"entityContexts">[];

    let markedCount = 0;
    for (const context of contexts) {
      if (context.researchedAt < sevenDaysAgo && !context.isStale) {
        await ctx.db.patch(context._id, {
          isStale: true,
          quality: context.quality ? {
            ...context.quality,
            hasRecentResearch: false,
          } : undefined,
        });
        markedCount++;
      }
    }

    console.log(`[entityContexts] Marked ${markedCount} contexts as stale`);
    return { markedCount };
  },
});

/**
 * Get entity context statistics
 */
export const getEntityContextStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    
    const contexts = await ctx.db
      .query("entityContexts")
      .withIndex("by_user", (q) => q.eq("researchedBy", userId))
      .collect() as Doc<"entityContexts">[];

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const stats = {
      total: contexts.length,
      companies: contexts.filter((c: Doc<"entityContexts">) => c.entityType === "company").length,
      people: contexts.filter((c: Doc<"entityContexts">) => c.entityType === "person").length,
      fresh: contexts.filter((c: Doc<"entityContexts">) => c.researchedAt >= sevenDaysAgo).length,
      stale: contexts.filter((c: Doc<"entityContexts">) => c.researchedAt < sevenDaysAgo).length,
      totalCacheHits: contexts.reduce((sum: number, c: Doc<"entityContexts">) => sum + c.accessCount, 0),
      mostAccessed: contexts.sort((a: Doc<"entityContexts">, b: Doc<"entityContexts">) => b.accessCount - a.accessCount).slice(0, 5),
    };

    return stats;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// GAM: STRUCTURED MEMORY MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Internal query to list all entity contexts for GC/migration.
 */
export const listAllForGC = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("entityContexts").collect() as Doc<"entityContexts">[];
  },
});

/**
 * Internal mutation to patch entity for migration.
 */
export const patchForMigration = internalMutation({
  args: {
    id: v.id("entityContexts"),
    updates: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});

/**
 * Internal mutation to mark an entity as stale.
 */
export const markStale = internalMutation({
  args: {
    id: v.id("entityContexts"),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.id) as Doc<"entityContexts"> | null;
    if (!entity) return;

    await ctx.db.patch(args.id, {
      isStale: true,
      quality: entity.quality ? {
        ...entity.quality,
        hasRecentResearch: false,
      } : undefined,
    });
  },
});

/**
 * Internal mutation to archive (soft delete) an entity.
 */
export const archive = internalMutation({
  args: {
    id: v.id("entityContexts"),
  },
  handler: async (ctx, args) => {
    // For now, just delete. Could move to archive table in future.
    await ctx.db.delete(args.id);
    console.log(`[entityContexts] Archived entity ${args.id}`);
  },
});

/**
 * Internal mutation to trim oversized fact arrays.
 */
export const trimFacts = internalMutation({
  args: {
    id: v.id("entityContexts"),
    maxFacts: v.number(),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.id) as Doc<"entityContexts"> | null;
    if (!entity || !entity.structuredFacts) return;

    // Keep most recent facts (by timestamp), prioritize high confidence
    const sorted = [...entity.structuredFacts].sort((a: StructuredFact, b: StructuredFact) => {
      // High confidence first
      if (a.isHighConfidence !== b.isHighConfidence) {
        return a.isHighConfidence ? -1 : 1;
      }
      // Then by timestamp (newer first)
      return b.timestamp.localeCompare(a.timestamp);
    });

    const trimmed = sorted.slice(0, args.maxFacts);

    await ctx.db.patch(args.id, {
      structuredFacts: trimmed,
      factCount: trimmed.length,
      version: entity.version + 1,
    });

    console.log(`[entityContexts] Trimmed ${entity.entityName} from ${entity.structuredFacts.length} to ${trimmed.length} facts`);
  },
});

/**
 * Merge new facts from a review into existing entity memory.
 * Uses boolean validation - facts either pass or fail.
 */
export const mergeFactsIntoMemory = internalMutation({
  args: {
    entityId: v.id("entityContexts"),
    newFacts: v.array(v.object({
      subject: v.string(),
      predicate: v.string(),
      object: v.string(),
      confidence: v.number(),
    })),
    sourceDocId: v.optional(v.string()),
    reviewSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId) as Doc<"entityContexts"> | null;
    if (!entity) throw new Error("Entity not found");

    const now = new Date().toISOString();
    const existingFacts: StructuredFact[] = entity.structuredFacts || [];
    const existingConflicts = entity.conflicts || [];
    
    // Validate facts using boolean logic
    const { validFacts, rejectedFacts, validationSummary } = validateFactBatch(
      args.newFacts,
      entity.entityName
    );
    
    if (rejectedFacts.length > 0) {
      console.warn(`[mergeFactsIntoMemory] Rejected ${rejectedFacts.length} facts for ${entity.entityName}:`,
        rejectedFacts.map(f => f.reason)
      );
    }
    
    // Check for conflicts with existing facts
    const newConflicts: typeof existingConflicts = [];
    for (const newFact of validFacts) {
      const conflicts = findConflicts(newFact, existingFacts);
      
      for (const conflicting of conflicts) {
        newConflicts.push({
          factIds: [conflicting.id, generateFactId()],
          description: `Conflicting values for ${newFact.subject}.${newFact.predicate}: "${conflicting.object}" vs "${newFact.object}"`,
          status: "unresolved" as const,
          detectedAt: now,
        });
        
        // If new fact is high confidence and old is not, mark old as outdated
        const newIsHigh = isFactHighConfidence(newFact.confidence);
        if (newIsHigh && !conflicting.isHighConfidence) {
          conflicting.isOutdated = true;
        }
      }
    }
    
    // Convert validated facts to structured format
    const structuredNewFacts: StructuredFact[] = validFacts.map((f) => ({
      id: generateFactId(),
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      isHighConfidence: isFactHighConfidence(f.confidence),
      sourceIds: args.sourceDocId ? [args.sourceDocId] : [],
      timestamp: now,
    }));
    
    // Merge facts
    const mergedFacts = [...existingFacts, ...structuredNewFacts];
    const allConflicts = [...existingConflicts, ...newConflicts];
    
    // Trim if over limit
    const trimmedFacts = mergedFacts.length > MEMORY_LIMITS.maxStructuredFactsPerEntity
      ? mergedFacts.slice(-MEMORY_LIMITS.maxStructuredFactsPerEntity)
      : mergedFacts;
    
    // Also update keyFacts (string array)
    const newKeyFacts = [
      ...entity.keyFacts,
      ...validFacts.map(f => `${f.subject} ${f.predicate}: ${f.object}`),
    ].slice(-MEMORY_LIMITS.maxKeyFactsPerEntity);
    
    // Evaluate quality using boolean flags
    const activeFacts = trimmedFacts.filter(f => !f.isOutdated);
    const daysSinceResearch = (Date.now() - entity.researchedAt) / (1000 * 60 * 60 * 24);
    
    const qualityResult = evaluateMemoryQuality({
      factCount: activeFacts.length,
      daysSinceResearch,
      unresolvedConflictCount: allConflicts.filter(c => c.status === "unresolved").length,
      sourceCount: entity.sources.length,
      factConfidences: activeFacts.map(f => f.isHighConfidence),
      narrativeCount: entity.narratives?.length ?? 0,
      heuristicCount: entity.heuristics?.length ?? 0,
    });
    
    // Update entity
    await ctx.db.patch(args.entityId, {
      structuredFacts: trimmedFacts,
      conflicts: allConflicts,
      keyFacts: newKeyFacts,
      quality: qualityResult.flags,
      qualityTier: qualityResult.tier,
      factCount: activeFacts.length,
      version: entity.version + 1,
      lastAccessedAt: Date.now(),
      linkedDocIds: args.sourceDocId 
        ? [...(entity.linkedDocIds || []), args.sourceDocId].slice(-MEMORY_LIMITS.maxLinkedDocsPerEntity)
        : entity.linkedDocIds,
    });
    
    console.log(`[mergeFactsIntoMemory] Updated ${entity.entityName}: +${validFacts.length} facts (${rejectedFacts.length} rejected), ${newConflicts.length} new conflicts, tier=${qualityResult.tier}`);
    
    return {
      factsAdded: validFacts.length,
      factsRejected: rejectedFacts.length,
      conflictsDetected: newConflicts.length,
      qualityTier: qualityResult.tier,
    };
  },
});

/**
 * Upgrade entity to deep memory with narratives and heuristics.
 */
export const upgradeToDeepMemory = internalMutation({
  args: {
    entityId: v.id("entityContexts"),
    narratives: v.array(v.object({
      label: v.string(),
      description: v.string(),
      supportingFactIds: v.array(v.string()),
      isWellSupported: v.boolean(),
    })),
    heuristics: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId) as Doc<"entityContexts"> | null;
    if (!entity) throw new Error("Entity not found");

    const now = new Date().toISOString();

    // Trim to limits
    const trimmedNarratives = args.narratives
      .slice(0, MEMORY_LIMITS.maxNarrativesPerEntity)
      .map((n: { label: string; description: string; supportingFactIds: string[]; isWellSupported: boolean }) => ({ ...n, lastUpdated: now }));

    const trimmedHeuristics = args.heuristics
      .slice(0, MEMORY_LIMITS.maxHeuristicsPerEntity);

    // Re-evaluate quality with new data
    const daysSinceResearch = (Date.now() - entity.researchedAt) / (1000 * 60 * 60 * 24);
    const activeFacts = (entity.structuredFacts || []).filter((f: StructuredFact) => !f.isOutdated);

    const qualityResult = evaluateMemoryQuality({
      factCount: activeFacts.length,
      daysSinceResearch,
      unresolvedConflictCount: (entity.conflicts || []).filter((c: { status: string }) => c.status === "unresolved").length,
      sourceCount: entity.sources.length,
      factConfidences: activeFacts.map((f: StructuredFact) => f.isHighConfidence),
      narrativeCount: trimmedNarratives.length,
      heuristicCount: trimmedHeuristics.length,
    });

    await ctx.db.patch(args.entityId, {
      narratives: trimmedNarratives,
      heuristics: trimmedHeuristics,
      researchDepth: "deep",
      quality: qualityResult.flags,
      qualityTier: qualityResult.tier,
      version: entity.version + 1,
      lastAccessedAt: Date.now(),
    });
    
    console.log(`[upgradeToDeepMemory] ${entity.entityName} upgraded to deep memory: ${trimmedNarratives.length} narratives, ${trimmedHeuristics.length} heuristics, tier=${qualityResult.tier}`);
  },
});

/**
 * Set canonical key for an entity (for migration or disambiguation).
 */
export const setCanonicalKey = internalMutation({
  args: {
    entityId: v.id("entityContexts"),
    canonicalKey: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.entityId, {
      canonicalKey: args.canonicalKey,
    });
  },
});

/**
 * Get entity by canonical key.
 */
export const getByCanonicalKey = query({
  args: {
    canonicalKey: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("entityContexts")
      .withIndex("by_canonicalKey", q => q.eq("canonicalKey", args.canonicalKey))
      .first() as Doc<"entityContexts"> | null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Link a knowledge graph to an entity context (internal)
 */
export const linkKnowledgeGraph = internalMutation({
  args: {
    entityContextId: v.id("entityContexts"),
    knowledgeGraphId: v.id("knowledgeGraphs"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.entityContextId, {
      knowledgeGraphId: args.knowledgeGraphId,
    });
  },
});

/**
 * Update cluster assignment for an entity (internal)
 */
export const updateClusterAssignment = internalMutation({
  args: {
    entityContextId: v.id("entityContexts"),
    clusterId: v.optional(v.string()),
    isOddOneOut: v.boolean(),
    isInClusterSupport: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.entityContextId, {
      clusterId: args.clusterId,
      isOddOneOut: args.isOddOneOut,
      isInClusterSupport: args.isInClusterSupport,
    });
  },
});

/**
 * Get entities by cluster ID
 */
export const getEntitiesByCluster = query({
  args: {
    clusterId: v.string(),
  },
  handler: async (ctx, args) => {
    // Note: Would need an index on clusterId for efficient querying
    // For now, we'll filter in-memory
    const entities = await ctx.db.query("entityContexts").collect() as Doc<"entityContexts">[];
    return entities.filter((e: Doc<"entityContexts">) => e.clusterId === args.clusterId);
  },
});

/**
 * Get all odd-one-out entities for a user
 */
export const getOddOneOutEntities = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const entities = await ctx.db
      .query("entityContexts")
      .withIndex("by_user", q => q.eq("researchedBy", args.userId))
      .collect() as Doc<"entityContexts">[];

    return entities.filter((e: Doc<"entityContexts">) => e.isOddOneOut === true);
  },
});
