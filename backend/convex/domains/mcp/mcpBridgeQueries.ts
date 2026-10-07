import { internalQuery, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";

// ─── Daily Brief ──────────────────────────────────────────────────────────────

export const getDailyBrief = internalQuery({
  args: {
    dateString: v.optional(v.string()),
    persona: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const today = args.dateString ?? new Date().toISOString().slice(0, 10);
    const persona = args.persona ?? "GENERAL";

    const cached = await ctx.db
      .query("digestCache")
      .withIndex("by_date_persona", (q) =>
        q.eq("dateString", today).eq("persona", persona)
      )
      .first() as Doc<"digestCache"> | null;

    if (!cached) {
      return { found: false, dateString: today, persona };
    }

    const digest = cached.digest;
    return {
      found: true,
      dateString: today,
      persona,
      narrativeThesis: digest.narrativeThesis,
      leadStory: digest.leadStory ?? null,
      signals: digest.signals ?? [],
      actionItems: digest.actionItems ?? [],
      entitySpotlight: digest.entitySpotlight ?? [],
      fundingRounds: digest.fundingRounds ?? [],
      storyCount: digest.storyCount,
      topSources: digest.topSources,
      topCategories: digest.topCategories,
    };
  },
});

// ─── Funding Search ───────────────────────────────────────────────────────────

export const searchFunding = internalQuery({
  args: {
    query: v.optional(v.string()),
    roundType: v.optional(v.string()),
    limit: v.optional(v.number()),
    daysBack: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 50);
    const daysBack = args.daysBack ?? 30;
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

    let events: Doc<"fundingEvents">[];

    if (args.query) {
      // Use search index
      events = await ctx.db
        .query("fundingEvents")
        .withSearchIndex("search_company", (q) =>
          q.search("companyName", args.query as string)
        )
        .take(limit) as Doc<"fundingEvents">[];
    } else if (args.roundType) {
      events = await ctx.db
        .query("fundingEvents")
        .withIndex("by_roundType_announcedAt", (q) =>
          q.eq("roundType", args.roundType as any)
        )
        .order("desc")
        .take(limit) as Doc<"fundingEvents">[];
    } else {
      // Recent events
      events = await ctx.db
        .query("fundingEvents")
        .withIndex("by_announcedAt")
        .order("desc")
        .filter((q) => q.gte(q.field("announcedAt"), cutoff))
        .take(limit) as Doc<"fundingEvents">[];
    }

    return events.map((e) => ({
      id: e._id,
      companyName: e.companyName,
      roundType: e.roundType,
      amountRaw: e.amountRaw,
      amountUsd: e.amountUsd ?? null,
      announcedAt: e.announcedAt,
      leadInvestors: e.leadInvestors,
      sector: e.sector ?? null,
      location: e.location ?? null,
      confidence: e.confidence,
      verificationStatus: e.verificationStatus,
      description: e.description ?? null,
    }));
  },
});

// ─── Research Queue ───────────────────────────────────────────────────────────

export const getResearchQueue = internalQuery({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 50);
    const status = args.status ?? "queued";

    const tasks = await ctx.db
      .query("researchTasks")
      .withIndex("by_status_priority", (q) =>
        q.eq("status", status as any)
      )
      .order("desc")
      .take(limit) as Doc<"researchTasks">[];

    return tasks.map((t) => ({
      id: t._id,
      entityId: t.entityId,
      entityName: t.entityName ?? null,
      entityType: t.entityType ?? null,
      personas: t.personas,
      priority: t.priority,
      status: t.status,
      qualityScore: t.qualityScore ?? null,
      triggeredBy: t.triggeredBy ?? null,
      createdAt: t.createdAt,
      startedAt: t.startedAt ?? null,
      completedAt: t.completedAt ?? null,
    }));
  },
});

// ─── Publish to Content Queue ─────────────────────────────────────────────────

export const publishToQueue = internalMutation({
  args: {
    content: v.string(),
    postType: v.string(),
    persona: v.optional(v.string()),
    target: v.optional(v.string()),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Simple content hash (same algorithm as linkedinContentQueue)
    let hash = 0;
    for (let i = 0; i < args.content.length; i++) {
      const char = args.content.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    const contentHash = `mcp_${Math.abs(hash).toString(36)}`;

    const now = Date.now();
    const target = (args.target === "organization" ? "organization" : "personal") as "personal" | "organization";
    const persona = args.persona ?? "GENERAL";

    // Check for duplicate
    const existing = await ctx.db
      .query("linkedinContentQueue")
      .withIndex("by_content_hash", (q) => q.eq("contentHash", contentHash))
      .first();

    if (existing) {
      return { queued: false, reason: "duplicate_in_queue", duplicateId: existing._id };
    }

    const queueId = await ctx.db.insert("linkedinContentQueue", {
      content: args.content,
      contentHash,
      postType: args.postType,
      persona,
      target,
      priority: args.priority ?? 50,
      status: "pending",
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });

    return { queued: true, queueId };
  },
});
