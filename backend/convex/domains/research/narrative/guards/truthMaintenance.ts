/**
 * Truth-Maintenance System
 *
 * Manages "current truth" vs "disputed" states for contested facts.
 * Enforces display rules when contradictions exist.
 *
 * Key principles:
 * - Contested facts MUST show dispute context
 * - Superseded facts show newer version
 * - Retracted facts are hidden by default
 *
 * Industry standard patterns:
 * - JTMS (Justification-based Truth Maintenance System)
 * - Newspaper correction policies (NYT, WaPo)
 * - Wikipedia dispute resolution
 *
 * @module domains/narrative/guards/truthMaintenance
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  internalAction,
} from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id, Doc } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type TruthStatus =
  | "canonical"    // Accepted as current truth
  | "contested"    // Active dispute, show with warning
  | "superseded"   // Replaced by newer fact
  | "retracted";   // Explicitly retracted

export interface TruthStateRecord {
  factId: Id<"temporalFacts">;
  threadId: Id<"narrativeThreads">;
  status: TruthStatus;
  showInDefault: boolean;
  requiresContext: boolean;
  contextNote?: string;
  activeDisputeIds: Id<"narrativeDisputeChains">[];
  resolutionNote?: string;
}

export interface TruthResolution {
  status: TruthStatus;
  showInDefault: boolean;
  requiresContext: boolean;
  contextNote?: string;
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRUTH STATE QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get truth state for a fact.
 */
export const getTruthState = internalQuery({
  args: {
    factId: v.id("temporalFacts"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("truthState"),
      factId: v.id("temporalFacts"),
      threadId: v.id("narrativeThreads"),
      status: v.union(
        v.literal("canonical"),
        v.literal("contested"),
        v.literal("superseded"),
        v.literal("retracted")
      ),
      showInDefault: v.boolean(),
      requiresContext: v.boolean(),
      contextNote: v.optional(v.string()),
      activeDisputeIds: v.array(v.id("narrativeDisputeChains")),
      resolutionNote: v.optional(v.string()),
      lastStateChange: v.number(),
      stateChangedBy: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("truthState")
      .withIndex("by_fact", (q) => q.eq("factId", args.factId))
      .first();
  },
});

/**
 * Get all contested facts for a thread.
 */
export const getContestedFacts = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  returns: v.array(
    v.object({
      _id: v.id("truthState"),
      factId: v.id("temporalFacts"),
      status: v.string(),
      activeDisputeCount: v.number(),
      contextNote: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const contested = await ctx.db
      .query("truthState")
      .withIndex("by_contested", (q) =>
        q.eq("status", "contested").eq("threadId", args.threadId)
      )
      .collect();

    return contested.map((t) => ({
      _id: t._id,
      factId: t.factId,
      status: t.status,
      activeDisputeCount: t.activeDisputeIds.length,
      contextNote: t.contextNote,
    }));
  },
});

/**
 * Get display-eligible facts for a thread.
 * Filters out facts that shouldn't be shown in default view.
 */
export const getDisplayableFacts = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
    includeContested: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      factId: v.id("temporalFacts"),
      status: v.string(),
      requiresContext: v.boolean(),
      contextNote: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    const includeContested = args.includeContested ?? true;

    const truthStates = await ctx.db
      .query("truthState")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();

    return truthStates
      .filter((t) => {
        if (!t.showInDefault) return false;
        if (!includeContested && t.status === "contested") return false;
        return true;
      })
      .map((t) => ({
        factId: t.factId,
        status: t.status,
        requiresContext: t.requiresContext,
        contextNote: t.contextNote,
      }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TRUTH STATE MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize truth state for a new fact.
 */
export const initializeTruthState = internalMutation({
  args: {
    factId: v.id("temporalFacts"),
    threadId: v.id("narrativeThreads"),
    initialStatus: v.optional(
      v.union(
        v.literal("canonical"),
        v.literal("contested"),
        v.literal("superseded"),
        v.literal("retracted")
      )
    ),
    createdBy: v.string(),
  },
  returns: v.id("truthState"),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if truth state already exists
    const existing = await ctx.db
      .query("truthState")
      .withIndex("by_fact", (q) => q.eq("factId", args.factId))
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("truthState", {
      factId: args.factId,
      threadId: args.threadId,
      status: args.initialStatus || "canonical",
      showInDefault: true,
      requiresContext: false,
      activeDisputeIds: [],
      lastStateChange: now,
      stateChangedBy: args.createdBy,
    });
  },
});

/**
 * Mark a fact as contested (dispute raised).
 */
export const markAsContested = internalMutation({
  args: {
    factId: v.id("temporalFacts"),
    disputeId: v.id("narrativeDisputeChains"),
    contextNote: v.string(),
    changedBy: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const truthState = await ctx.db
      .query("truthState")
      .withIndex("by_fact", (q) => q.eq("factId", args.factId))
      .first();

    if (!truthState) {
      console.error(`[TruthMaintenance] No truth state found for fact ${args.factId}`);
      return false;
    }

    const now = Date.now();

    // Add dispute to active list
    const newDisputeIds = truthState.activeDisputeIds.includes(args.disputeId)
      ? truthState.activeDisputeIds
      : [...truthState.activeDisputeIds, args.disputeId];

    await ctx.db.patch(truthState._id, {
      status: "contested",
      showInDefault: true, // Still show, but with context
      requiresContext: true,
      contextNote: args.contextNote,
      activeDisputeIds: newDisputeIds,
      lastStateChange: now,
      stateChangedBy: args.changedBy,
    });

    console.log(`[TruthMaintenance] Fact ${args.factId} marked as contested`);
    return true;
  },
});

/**
 * Resolve a contested fact.
 */
export const resolveContestation = internalMutation({
  args: {
    factId: v.id("temporalFacts"),
    disputeId: v.id("narrativeDisputeChains"),
    resolution: v.union(
      v.literal("upheld"),        // Original fact stands
      v.literal("superseded"),    // New fact replaces
      v.literal("retracted")      // Fact withdrawn
    ),
    resolutionNote: v.string(),
    resolvedBy: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const truthState = await ctx.db
      .query("truthState")
      .withIndex("by_fact", (q) => q.eq("factId", args.factId))
      .first();

    if (!truthState) {
      return false;
    }

    const now = Date.now();

    // Remove this dispute from active list
    const remainingDisputes = truthState.activeDisputeIds.filter(
      (id) => id !== args.disputeId
    );

    // Determine new status based on resolution and remaining disputes
    let newStatus: TruthStatus = "canonical";  // Default
    let showInDefault = true;
    let requiresContext = false;

    switch (args.resolution) {
      case "upheld":
        // Original fact stands
        newStatus = remainingDisputes.length > 0 ? "contested" : "canonical";
        showInDefault = true;
        requiresContext = remainingDisputes.length > 0;
        break;

      case "superseded":
        newStatus = "superseded";
        showInDefault = false; // Hide in favor of new fact
        requiresContext = false;
        break;

      case "retracted":
        newStatus = "retracted";
        showInDefault = false;
        requiresContext = false;
        break;
    }

    await ctx.db.patch(truthState._id, {
      status: newStatus,
      showInDefault,
      requiresContext,
      activeDisputeIds: remainingDisputes,
      resolutionNote: args.resolutionNote,
      lastStateChange: now,
      stateChangedBy: args.resolvedBy,
    });

    console.log(
      `[TruthMaintenance] Fact ${args.factId} resolved as ${args.resolution}`
    );
    return true;
  },
});

/**
 * Supersede a fact with a newer version.
 */
export const supersedeFact = internalMutation({
  args: {
    oldFactId: v.id("temporalFacts"),
    newFactId: v.id("temporalFacts"),
    supersessionNote: v.string(),
    changedBy: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const oldTruthState = await ctx.db
      .query("truthState")
      .withIndex("by_fact", (q) => q.eq("factId", args.oldFactId))
      .first();

    if (!oldTruthState) {
      return false;
    }

    const now = Date.now();

    // Mark old fact as superseded
    await ctx.db.patch(oldTruthState._id, {
      status: "superseded",
      showInDefault: false,
      requiresContext: false,
      resolutionNote: args.supersessionNote,
      lastStateChange: now,
      stateChangedBy: args.changedBy,
    });

    // Initialize truth state for new fact
    await ctx.runMutation(
      internal.domains.narrative.guards.truthMaintenance.initializeTruthState,
      {
        factId: args.newFactId,
        threadId: oldTruthState.threadId,
        initialStatus: "canonical",
        createdBy: args.changedBy,
      }
    );

    console.log(
      `[TruthMaintenance] Fact ${args.oldFactId} superseded by ${args.newFactId}`
    );
    return true;
  },
});

/**
 * Retract a fact (explicit withdrawal).
 */
export const retractFact = internalMutation({
  args: {
    factId: v.id("temporalFacts"),
    retractionNote: v.string(),
    retractedBy: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const truthState = await ctx.db
      .query("truthState")
      .withIndex("by_fact", (q) => q.eq("factId", args.factId))
      .first();

    if (!truthState) {
      return false;
    }

    const now = Date.now();

    await ctx.db.patch(truthState._id, {
      status: "retracted",
      showInDefault: false,
      requiresContext: false,
      resolutionNote: args.retractionNote,
      lastStateChange: now,
      stateChangedBy: args.retractedBy,
    });

    console.log(`[TruthMaintenance] Fact ${args.factId} retracted`);
    return true;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DISPLAY RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve what to display for a fact.
 * Returns display instructions based on truth state.
 */
export const resolveFactDisplay = internalQuery({
  args: {
    factId: v.id("temporalFacts"),
  },
  returns: v.object({
    shouldDisplay: v.boolean(),
    displayStatus: v.string(),
    requiresWarning: v.boolean(),
    warningText: v.optional(v.string()),
    supersededById: v.optional(v.id("temporalFacts")),
    disputeCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const truthState = await ctx.db
      .query("truthState")
      .withIndex("by_fact", (q) => q.eq("factId", args.factId))
      .first();

    if (!truthState) {
      // No truth state = assume canonical
      return {
        shouldDisplay: true,
        displayStatus: "canonical",
        requiresWarning: false,
        disputeCount: 0,
      };
    }

    switch (truthState.status) {
      case "canonical":
        return {
          shouldDisplay: true,
          displayStatus: "canonical",
          requiresWarning: false,
          disputeCount: 0,
        };

      case "contested":
        return {
          shouldDisplay: true,
          displayStatus: "contested",
          requiresWarning: true,
          warningText:
            truthState.contextNote ||
            `This fact is disputed (${truthState.activeDisputeIds.length} active dispute${truthState.activeDisputeIds.length > 1 ? "s" : ""})`,
          disputeCount: truthState.activeDisputeIds.length,
        };

      case "superseded":
        // Find the superseding fact
        const fact = await ctx.db.get(args.factId);
        const supersededById = fact?.supersededBy as Id<"temporalFacts"> | undefined;

        return {
          shouldDisplay: false,
          displayStatus: "superseded",
          requiresWarning: false,
          warningText: truthState.resolutionNote,
          supersededById,
          disputeCount: 0,
        };

      case "retracted":
        return {
          shouldDisplay: false,
          displayStatus: "retracted",
          requiresWarning: false,
          warningText: truthState.resolutionNote,
          disputeCount: 0,
        };

      default:
        return {
          shouldDisplay: true,
          displayStatus: "unknown",
          requiresWarning: true,
          warningText: "Unknown truth status",
          disputeCount: 0,
        };
    }
  },
});

/**
 * Get truth summary for a thread.
 */
export const getThreadTruthSummary = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  returns: v.object({
    totalFacts: v.number(),
    canonical: v.number(),
    contested: v.number(),
    superseded: v.number(),
    retracted: v.number(),
    activeDisputes: v.number(),
  }),
  handler: async (ctx, args) => {
    const truthStates = await ctx.db
      .query("truthState")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();

    const summary = {
      totalFacts: truthStates.length,
      canonical: 0,
      contested: 0,
      superseded: 0,
      retracted: 0,
      activeDisputes: 0,
    };

    for (const ts of truthStates) {
      switch (ts.status) {
        case "canonical":
          summary.canonical++;
          break;
        case "contested":
          summary.contested++;
          summary.activeDisputes += ts.activeDisputeIds.length;
          break;
        case "superseded":
          summary.superseded++;
          break;
        case "retracted":
          summary.retracted++;
          break;
      }
    }

    return summary;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize truth states for all facts in a thread that don't have one.
 */
export const initializeThreadTruthStates = internalMutation({
  args: {
    threadId: v.id("narrativeThreads"),
    createdBy: v.string(),
  },
  returns: v.object({
    initialized: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    let initialized = 0;
    let skipped = 0;

    // Get all facts for thread
    const facts = await ctx.db
      .query("temporalFacts")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();

    for (const fact of facts) {
      // Check if truth state exists
      const existing = await ctx.db
        .query("truthState")
        .withIndex("by_fact", (q) => q.eq("factId", fact._id))
        .first();

      if (existing) {
        skipped++;
        continue;
      }

      // Create truth state
      await ctx.db.insert("truthState", {
        factId: fact._id,
        threadId: args.threadId,
        status: "canonical",
        showInDefault: true,
        requiresContext: false,
        activeDisputeIds: [],
        lastStateChange: now,
        stateChangedBy: args.createdBy,
      });

      initialized++;
    }

    return { initialized, skipped };
  },
});
