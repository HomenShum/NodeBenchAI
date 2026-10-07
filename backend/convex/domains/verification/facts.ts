// convex/domains/verification/facts.ts
// Queries and mutations for fact claims ({{fact:...}} anchors)
// Facts store the exact claim text for LLM-as-a-judge verification

import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

// ═══════════════════════════════════════════════════════════════════════════
// AUTH HELPER
// ═══════════════════════════════════════════════════════════════════════════

async function getSafeUserId(ctx: any): Promise<string | null> {
  const rawUserId = await getAuthUserId(ctx);
  if (!rawUserId) return null;
  
  if (typeof rawUserId === 'string' && rawUserId.includes('|')) {
    return rawUserId.split('|')[0] || null;
  }
  return rawUserId;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all facts for a run
 */
export const getFactsByRun = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) return [];
    
    return await ctx.db
      .query("facts")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

/**
 * Get facts for a specific section
 */
export const getFactsBySection = query({
  args: { 
    runId: v.string(),
    sectionKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) return [];
    
    return await ctx.db
      .query("facts")
      .withIndex("by_run_section", (q) => 
        q.eq("runId", args.runId).eq("sectionKey", args.sectionKey)
      )
      .collect();
  },
});

/**
 * Get a single fact by ID
 */
export const getFactById = query({
  args: {
    runId: v.string(),
    factId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("facts")
      .withIndex("by_run_fact", (q) =>
        q.eq("runId", args.runId).eq("factId", args.factId)
      )
      .first() as Doc<"facts"> | null;
  },
});

/**
 * Internal query for verification (no auth check)
 */
export const internalGetFactsForVerification = internalQuery({
  args: {
    runId: v.string(),
    sectionKeys: v.optional(v.array(v.string())),
    factIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    let facts;
    
    if (args.factIds && args.factIds.length > 0) {
      // Get specific facts
      facts = await Promise.all(
        args.factIds.map((factId: string) =>
          ctx.db
            .query("facts")
            .withIndex("by_run_fact", (q) => q.eq("runId", args.runId).eq("factId", factId))
            .first() as Promise<Doc<"facts"> | null>
        )
      );
      return facts.filter((f): f is Doc<"facts"> => f !== null);
    }

    if (args.sectionKeys && args.sectionKeys.length > 0) {
      // Get facts from specific sections
      const factLists = await Promise.all(
        args.sectionKeys.map((sectionKey: string) =>
          ctx.db
            .query("facts")
            .withIndex("by_run_section", (q) =>
              q.eq("runId", args.runId).eq("sectionKey", sectionKey)
            )
            .collect() as Promise<Doc<"facts">[]>
        )
      );
      return factLists.flat();
    }
    
    // Get all facts for run
    return await ctx.db
      .query("facts")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register a fact claim (called when agent writes {{fact:...}})
 */
export const registerFact = mutation({
  args: {
    runId: v.string(),
    factId: v.string(),
    sectionKey: v.string(),
    claimText: v.string(),
    artifactIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    
    // Check if fact already exists
    const existing = await ctx.db
      .query("facts")
      .withIndex("by_run_fact", (q) =>
        q.eq("runId", args.runId).eq("factId", args.factId)
      )
      .first() as Doc<"facts"> | null;

    if (existing) {
      // Update claim text and artifacts
      await ctx.db.patch(existing._id, {
        claimText: args.claimText,
        artifactIds: args.artifactIds || existing.artifactIds,
      });
      return { action: "updated", id: existing._id };
    }

    // Insert new fact
    const id = await ctx.db.insert("facts", {
      runId: args.runId,
      factId: args.factId,
      sectionKey: args.sectionKey,
      claimText: args.claimText,
      artifactIds: args.artifactIds || [],
      createdAt: Date.now(),
    });

    return { action: "created", id };
  },
});

/**
 * Internal mutation for registering facts (from actions)
 */
export const internalRegisterFact = internalMutation({
  args: {
    runId: v.string(),
    factId: v.string(),
    sectionKey: v.string(),
    claimText: v.string(),
    artifactIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    // Check if fact already exists
    const existing = await ctx.db
      .query("facts")
      .withIndex("by_run_fact", (q) =>
        q.eq("runId", args.runId).eq("factId", args.factId)
      )
      .first() as Doc<"facts"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        claimText: args.claimText,
        artifactIds: args.artifactIds || existing.artifactIds,
      });
      return { action: "updated", id: existing._id };
    }
    
    const id = await ctx.db.insert("facts", {
      runId: args.runId,
      factId: args.factId,
      sectionKey: args.sectionKey,
      claimText: args.claimText,
      artifactIds: args.artifactIds || [],
      createdAt: Date.now(),
    });
    
    return { action: "created", id };
  },
});

/**
 * Link artifacts to a fact
 */
export const linkArtifactsToFact = mutation({
  args: {
    runId: v.string(),
    factId: v.string(),
    artifactIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) throw new Error("Unauthorized");

    const fact = await ctx.db
      .query("facts")
      .withIndex("by_run_fact", (q) =>
        q.eq("runId", args.runId).eq("factId", args.factId)
      )
      .first() as Doc<"facts"> | null;

    if (!fact) {
      return { action: "skipped", reason: "fact not found" };
    }

    // Merge artifact IDs (dedupe)
    const merged = [...new Set([...fact.artifactIds, ...args.artifactIds])];
    await ctx.db.patch(fact._id, { artifactIds: merged });

    return { action: "linked", id: fact._id };
  },
});
