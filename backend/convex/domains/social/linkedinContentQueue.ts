/**
 * LinkedIn Content Queue - Central backlog for ALL content before posting
 *
 * Pipeline: enqueue → judge → schedule → post → archive
 * Deduplication: content hash + archive check
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "../../_generated/server";

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fast non-cryptographic hash (cyrb53) for content deduplication.
 * No Node.js crypto needed — runs in Convex runtime.
 */
function hashContent(content: string): string {
  const s = content.trim().toLowerCase();
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Calculate priority based on source and post type.
 * Higher = posts first.
 */
function calculatePriority(source: string, postType: string, persona?: string): number {
  if (source === "manual") return 95;

  // Founder personal posts — high priority but below manual
  if (persona === "FOUNDER") return 85;

  if (source === "fresh") {
    if (postType === "daily_digest") return 80;
    if (postType === "funding_tracker") return 75;
    if (postType === "funding_brief") return 70;
    return 65;
  }

  // backfill
  if (postType.includes("funding")) return 55;
  if (postType.includes("research")) return 50;
  if (postType.includes("fda")) return 48;
  return 45;
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add content to the queue with 3-layer deduplication.
 */
export const enqueueContent = internalMutation({
  args: {
    content: v.string(),
    postType: v.string(),
    persona: v.string(),
    target: v.union(v.literal("personal"), v.literal("organization")),
    source: v.union(v.literal("backfill"), v.literal("fresh"), v.literal("manual")),
    priority: v.optional(v.number()),
    sourcePostId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const contentHash = hashContent(args.content);
    const now = Date.now();

    // Layer 1: Check queue for duplicate content hash
    const existingInQueue = await ctx.db
      .query("linkedinContentQueue")
      .withIndex("by_content_hash", (q) => q.eq("contentHash", contentHash))
      .first();

    if (existingInQueue) {
      return {
        queued: false as const,
        reason: "duplicate_in_queue" as const,
        duplicateId: existingInQueue._id,
      };
    }

    // Layer 2: Check archive — skip if already posted to org page
    const archivePosts = await ctx.db
      .query("linkedinPostArchive")
      .withIndex("by_target_postedAt", (q) => q.eq("target", "organization"))
      .order("desc")
      .take(500);

    const alreadyOnOrg = archivePosts.find(
      (p) => hashContent(p.content) === contentHash,
    );

    if (alreadyOnOrg) {
      return {
        queued: false as const,
        reason: "already_posted_to_org" as const,
        duplicateId: alreadyOnOrg._id,
      };
    }

    const priority = args.priority ?? calculatePriority(args.source, args.postType, args.persona);

    const queueId = await ctx.db.insert("linkedinContentQueue", {
      content: args.content,
      contentHash,
      postType: args.postType,
      persona: args.persona,
      target: args.target,
      priority,
      status: "pending",
      source: args.source,
      sourcePostId: args.sourcePostId,
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
    });

    return { queued: true as const, queueId };
  },
});

/**
 * Update queue item status and optional fields.
 */
export const updateQueueStatus = internalMutation({
  args: {
    queueId: v.id("linkedinContentQueue"),
    status: v.union(
      v.literal("pending"),
      v.literal("judging"),
      v.literal("approved"),
      v.literal("needs_rewrite"),
      v.literal("rejected"),
      v.literal("scheduled"),
      v.literal("posted"),
      v.literal("failed"),
    ),
    scheduledSlot: v.optional(v.string()),
    scheduledFor: v.optional(v.number()),
    postedPostId: v.optional(v.string()),
    postedPostUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.queueId);
    if (!item) throw new Error(`Queue item not found: ${args.queueId}`);

    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.scheduledSlot !== undefined) updates.scheduledSlot = args.scheduledSlot;
    if (args.scheduledFor !== undefined) updates.scheduledFor = args.scheduledFor;
    if (args.postedPostId !== undefined) updates.postedPostId = args.postedPostId;
    if (args.postedPostUrl !== undefined) updates.postedPostUrl = args.postedPostUrl;
    if (args.status === "posted") updates.postedAt = Date.now();

    await ctx.db.patch(args.queueId, updates);
  },
});

/**
 * Store engagement gate result on a queue item.
 */
export const storeEngagementGateResult = internalMutation({
  args: {
    queueId: v.id("linkedinContentQueue"),
    passed: v.boolean(),
    failures: v.array(v.string()),
    softWarnings: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.queueId, {
      engagementGateResult: {
        passed: args.passed,
        failures: args.failures,
        softWarnings: args.softWarnings,
      },
      updatedAt: Date.now(),
    });
  },
});

/**
 * Store LLM judge result and auto-transition status.
 */
export const storeLLMJudgeResult = internalMutation({
  args: {
    queueId: v.id("linkedinContentQueue"),
    model: v.string(),
    verdict: v.union(v.literal("approve"), v.literal("needs_rewrite"), v.literal("reject")),
    hookQuality: v.boolean(),
    opinionDepth: v.boolean(),
    questionAuthenticity: v.boolean(),
    reasoning: v.string(),
  },
  handler: async (ctx, args) => {
    const newStatus =
      args.verdict === "approve" ? "approved" :
      args.verdict === "reject" ? "rejected" : "needs_rewrite";

    await ctx.db.patch(args.queueId, {
      llmJudgeResult: {
        model: args.model,
        verdict: args.verdict,
        hookQuality: args.hookQuality,
        opinionDepth: args.opinionDepth,
        questionAuthenticity: args.questionAuthenticity,
        reasoning: args.reasoning,
        judgedAt: Date.now(),
      },
      status: newStatus,
      updatedAt: Date.now(),
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get next pending item for judging (oldest first).
 */
export const getNextPendingForJudge = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("linkedinContentQueue")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc")
      .first();
  },
});

/**
 * Get highest-priority approved item for scheduling.
 */
export const getNextApprovedForScheduling = internalQuery({
  args: {
    target: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("linkedinContentQueue")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(50);

    const filtered = args.target
      ? items.filter((item) => item.target === args.target)
      : items;

    // Sort by priority descending
    filtered.sort((a, b) => b.priority - a.priority);
    return filtered[0] ?? null;
  },
});

/**
 * Get scheduled items that are due now.
 */
export const getScheduledDueNow = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const scheduled = await ctx.db
      .query("linkedinContentQueue")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .collect();

    return scheduled
      .filter((item) => item.scheduledFor && item.scheduledFor <= now)
      .sort((a, b) => b.priority - a.priority);
  },
});

/**
 * Check if a slot+time is already taken.
 */
export const isSlotTaken = internalQuery({
  args: {
    scheduledSlot: v.string(),
    scheduledFor: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("linkedinContentQueue")
      .withIndex("by_scheduled_slot", (q) =>
        q.eq("scheduledSlot", args.scheduledSlot).eq("scheduledFor", args.scheduledFor),
      )
      .first();

    return !!existing;
  },
});

/**
 * Queue stats — counts by status, source, target.
 */
export const getQueueStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("linkedinContentQueue").collect();

    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byTarget: Record<string, number> = {};

    for (const item of all) {
      byStatus[item.status] = (byStatus[item.status] || 0) + 1;
      bySource[item.source] = (bySource[item.source] || 0) + 1;
      byTarget[item.target] = (byTarget[item.target] || 0) + 1;
    }

    return {
      total: all.length,
      byStatus,
      bySource,
      byTarget,
    };
  },
});

/**
 * List queue items with optional status filter.
 */
export const listQueueItems = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;

    if (args.status) {
      return await ctx.db
        .query("linkedinContentQueue")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("linkedinContentQueue")
      .order("desc")
      .take(limit);
  },
});

/**
 * Get items that need rewriting (failed pre-post verification).
 */
export const getNeedsRewriteItems = internalQuery({
  args: { persona: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;
    const items = await ctx.db
      .query("linkedinContentQueue")
      .withIndex("by_status", (q) => q.eq("status", "needs_rewrite"))
      .order("desc")
      .take(limit);

    if (args.persona) {
      return items.filter((i) => i.persona === args.persona);
    }
    return items;
  },
});

/**
 * Check if a post with a given postType has already been generated for a date.
 * Used for idempotency — prevents generating the same post type twice in one day.
 */
export const hasPostTypeForDate = internalQuery({
  args: { postType: v.string(), dateString: v.string() },
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query("linkedinContentQueue")
      .order("desc")
      .take(200);
    return recent.some(
      (item) =>
        item.postType === args.postType &&
        item.metadata?.digestDate === args.dateString,
    );
  },
});

/**
 * List scheduled queue items for pre-post verification variety check.
 */
export const listScheduledForVerification = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 20;
    return await ctx.db
      .query("linkedinContentQueue")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .order("desc")
      .take(limit);
  },
});
