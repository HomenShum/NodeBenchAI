/**
 * Truth State Manager
 *
 * Manages "current truth" vs "disputed" semantics for contested facts.
 * Answers: "When a contradiction exists, what is shown to users by default?"
 *
 * TRUTH STATES:
 * - canonical: Accepted as current truth, shown by default
 * - contested: Active dispute, shown with warning/context
 * - superseded: Replaced by newer fact, not shown by default
 * - retracted: Explicitly retracted, hidden or shown with retraction notice
 *
 * DISPLAY RULES:
 * - Canonical facts shown without qualification
 * - Contested facts MUST show dispute context
 * - Superseded facts only shown in "history" views
 * - Retracted facts show retraction notice
 *
 * @module domains/narrative/truth/truthStateManager
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import type { Id, Doc } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type TruthStatus = "canonical" | "contested" | "superseded" | "retracted";

export interface TruthStateTransition {
  from: TruthStatus;
  to: TruthStatus;
  triggeredBy: "dispute_opened" | "dispute_resolved" | "fact_superseded" | "manual_retraction" | "admin_override";
  timestamp: number;
  actor: string;
  note?: string;
}

export interface DisplayDecision {
  factId: Id<"temporalFacts">;
  shouldShow: boolean;
  status: TruthStatus;
  requiresContext: boolean;
  contextNote?: string;
  warnings: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize truth state for a new fact (defaults to canonical)
 */
export const initializeTruthState = internalMutation({
  args: {
    factId: v.id("temporalFacts"),
    threadId: v.id("narrativeThreads"),
    initialStatus: v.optional(v.string()),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if state already exists
    const existing = await ctx.db
      .query("truthState")
      .withIndex("by_fact", q => q.eq("factId", args.factId))
      .first();

    if (existing) {
      return existing._id;
    }

    const status = (args.initialStatus as TruthStatus) || "canonical";

    return await ctx.db.insert("truthState", {
      factId: args.factId,
      threadId: args.threadId,
      status,
      showInDefault: status === "canonical",
      requiresContext: status === "contested",
      activeDisputeIds: [],
      lastStateChange: Date.now(),
      stateChangedBy: args.actor,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STATE TRANSITIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mark a fact as contested when a dispute is opened
 */
export const markAsContested = internalMutation({
  args: {
    factId: v.id("temporalFacts"),
    disputeId: v.id("narrativeDisputeChains"),
    contextNote: v.string(),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("truthState")
      .withIndex("by_fact", q => q.eq("factId", args.factId))
      .first();

    if (!state) {
      throw new Error(`No truth state found for fact ${args.factId}`);
    }

    // Add dispute to active list
    const activeDisputeIds = [...(state.activeDisputeIds || [])];
    if (!activeDisputeIds.includes(args.disputeId)) {
      activeDisputeIds.push(args.disputeId);
    }

    await ctx.db.patch(state._id, {
      status: "contested",
      showInDefault: true,  // Still show, but with context
      requiresContext: true,
      contextNote: args.contextNote,
      activeDisputeIds,
      lastStateChange: Date.now(),
      stateChangedBy: args.actor,
    });

    return state._id;
  },
});

/**
 * Resolve a dispute - restore to canonical or keep contested
 */
export const resolveDispute = internalMutation({
  args: {
    factId: v.id("temporalFacts"),
    disputeId: v.id("narrativeDisputeChains"),
    resolution: v.union(
      v.literal("original_upheld"),     // Original fact confirmed
      v.literal("challenge_upheld"),    // Challenge was correct
      v.literal("merged"),              // Both had merit, merged
      v.literal("withdrawn")            // Dispute withdrawn
    ),
    resolutionNote: v.string(),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("truthState")
      .withIndex("by_fact", q => q.eq("factId", args.factId))
      .first();

    if (!state) {
      throw new Error(`No truth state found for fact ${args.factId}`);
    }

    // Remove dispute from active list
    const activeDisputeIds = (state.activeDisputeIds || []).filter(
      id => id !== args.disputeId
    );

    // Determine new status based on remaining disputes and resolution
    let newStatus: TruthStatus = "canonical";
    let showInDefault = true;
    let requiresContext = false;

    if (activeDisputeIds.length > 0) {
      // Still has other active disputes
      newStatus = "contested";
      requiresContext = true;
    } else if (args.resolution === "challenge_upheld") {
      // Challenge won - this fact is superseded
      newStatus = "superseded";
      showInDefault = false;
    }

    await ctx.db.patch(state._id, {
      status: newStatus,
      showInDefault,
      requiresContext,
      contextNote: requiresContext ? state.contextNote : undefined,
      activeDisputeIds,
      resolutionNote: args.resolutionNote,
      lastStateChange: Date.now(),
      stateChangedBy: args.actor,
    });

    return { newStatus, activeDisputeIds };
  },
});

/**
 * Mark a fact as superseded by a newer fact
 */
export const markAsSuperseded = internalMutation({
  args: {
    factId: v.id("temporalFacts"),
    supersedingFactId: v.id("temporalFacts"),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("truthState")
      .withIndex("by_fact", q => q.eq("factId", args.factId))
      .first();

    if (!state) {
      throw new Error(`No truth state found for fact ${args.factId}`);
    }

    await ctx.db.patch(state._id, {
      status: "superseded",
      showInDefault: false,
      requiresContext: false,
      resolutionNote: `Superseded by ${args.supersedingFactId}`,
      lastStateChange: Date.now(),
      stateChangedBy: args.actor,
    });

    return state._id;
  },
});

/**
 * Retract a fact (explicit retraction)
 */
export const retractFact = internalMutation({
  args: {
    factId: v.id("temporalFacts"),
    retractionReason: v.string(),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("truthState")
      .withIndex("by_fact", q => q.eq("factId", args.factId))
      .first();

    if (!state) {
      throw new Error(`No truth state found for fact ${args.factId}`);
    }

    await ctx.db.patch(state._id, {
      status: "retracted",
      showInDefault: false,
      requiresContext: true,
      contextNote: `RETRACTED: ${args.retractionReason}`,
      resolutionNote: args.retractionReason,
      lastStateChange: Date.now(),
      stateChangedBy: args.actor,
    });

    return state._id;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DISPLAY DECISIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get display decision for a fact
 */
export const getDisplayDecision = internalQuery({
  args: {
    factId: v.id("temporalFacts"),
    viewMode: v.optional(v.union(
      v.literal("default"),           // Normal view
      v.literal("full_history"),      // Show everything including superseded
      v.literal("contested_only")     // Only show contested
    )),
  },
  handler: async (ctx, args): Promise<DisplayDecision> => {
    const viewMode = args.viewMode || "default";

    const state = await ctx.db
      .query("truthState")
      .withIndex("by_fact", q => q.eq("factId", args.factId))
      .first();

    const warnings: string[] = [];

    // No state = treat as canonical
    if (!state) {
      return {
        factId: args.factId,
        shouldShow: true,
        status: "canonical",
        requiresContext: false,
        warnings: [],
      };
    }

    // Determine if should show based on view mode and status
    let shouldShow = false;

    if (viewMode === "full_history") {
      shouldShow = true;
    } else if (viewMode === "contested_only") {
      shouldShow = state.status === "contested";
    } else {
      // Default view
      shouldShow = state.showInDefault;
    }

    // Add warnings
    if (state.status === "contested") {
      warnings.push(`This fact is disputed (${state.activeDisputeIds.length} active dispute(s))`);
    } else if (state.status === "superseded") {
      warnings.push("This fact has been superseded by newer information");
    } else if (state.status === "retracted") {
      warnings.push("This fact has been retracted");
    }

    return {
      factId: args.factId,
      shouldShow,
      status: state.status as TruthStatus,
      requiresContext: state.requiresContext,
      contextNote: state.contextNote,
      warnings,
    };
  },
});

/**
 * Get display decisions for multiple facts
 */
export const getDisplayDecisions = internalQuery({
  args: {
    factIds: v.array(v.id("temporalFacts")),
    viewMode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const decisions: DisplayDecision[] = [];

    for (const factId of args.factIds) {
      const state = await ctx.db
        .query("truthState")
        .withIndex("by_fact", q => q.eq("factId", factId))
        .first();

      const viewMode = args.viewMode || "default";
      const warnings: string[] = [];

      if (!state) {
        decisions.push({
          factId,
          shouldShow: true,
          status: "canonical",
          requiresContext: false,
          warnings: [],
        });
        continue;
      }

      let shouldShow = false;
      if (viewMode === "full_history") {
        shouldShow = true;
      } else if (viewMode === "contested_only") {
        shouldShow = state.status === "contested";
      } else {
        shouldShow = state.showInDefault;
      }

      if (state.status === "contested") {
        warnings.push(`Disputed (${state.activeDisputeIds.length} dispute(s))`);
      } else if (state.status === "superseded") {
        warnings.push("Superseded");
      } else if (state.status === "retracted") {
        warnings.push("Retracted");
      }

      decisions.push({
        factId,
        shouldShow,
        status: state.status as TruthStatus,
        requiresContext: state.requiresContext,
        contextNote: state.contextNote,
        warnings,
      });
    }

    return decisions;
  },
});

/**
 * Get all contested facts for a thread
 */
export const getContestedFactsForThread = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("truthState")
      .withIndex("by_contested", q => q.eq("status", "contested").eq("threadId", args.threadId))
      .collect();
  },
});

/**
 * Get truth state summary for a thread
 */
export const getThreadTruthSummary = internalQuery({
  args: {
    threadId: v.id("narrativeThreads"),
  },
  handler: async (ctx, args) => {
    const allStates = await ctx.db
      .query("truthState")
      .withIndex("by_thread", q => q.eq("threadId", args.threadId))
      .collect();

    const summary = {
      total: allStates.length,
      canonical: 0,
      contested: 0,
      superseded: 0,
      retracted: 0,
      activeDisputes: 0,
    };

    for (const state of allStates) {
      summary[state.status as keyof typeof summary]++;
      summary.activeDisputes += state.activeDisputeIds.length;
    }

    return summary;
  },
});
