import { v } from "convex/values";
import { internalQuery } from "../../../_generated/server";

/**
 * Collect all new discoveries within a time window.
 * Mirrors generateDigestWithFactChecks's data collection but scoped to any window.
 */
export const collectDelta = internalQuery({
  args: {
    windowStartAt: v.number(),
    windowEndAt: v.number(),
  },
  handler: async (ctx, { windowStartAt, windowEndAt }) => {
    // 1. Feed items published in the window
    const feedItems = await ctx.db
      .query("feedItems")
      .withIndex("by_published")
      .filter((q) =>
        q.and(
          q.gte(q.field("publishedAt"), windowStartAt),
          q.lte(q.field("publishedAt"), windowEndAt)
        )
      )
      .take(100);

    // 2. Signals created in the window
    const signals = await ctx.db
      .query("signals")
      .filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), windowStartAt),
          q.lte(q.field("_creationTime"), windowEndAt)
        )
      )
      .take(100);

    // 3. Narrative events in the window
    const narrativeEvents = await ctx.db
      .query("narrativeEvents")
      .filter((q) =>
        q.and(
          q.gte(q.field("occurredAt"), windowStartAt),
          q.lte(q.field("occurredAt"), windowEndAt)
        )
      )
      .take(50);

    // 4. Completed research tasks in the window
    const researchTasks = await ctx.db
      .query("researchTasks")
      .withIndex("by_status_priority")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "completed"),
          q.gte(q.field("_creationTime"), windowStartAt),
          q.lte(q.field("_creationTime"), windowEndAt)
        )
      )
      .take(20);

    return {
      feedItems: feedItems.map((f) => ({
        title: f.title,
        summary: f.summary ?? "",
        category: f.category,
        score: f.score,
        url: f.url ?? "",
        source: f.source ?? "",
      })),
      signals: signals.map((s) => ({
        content: (s as any).content ?? (s as any).title ?? "",
        source: (s as any).source ?? "",
        kind: (s as any).kind ?? "signal",
      })),
      narrativeEvents: narrativeEvents.map((e) => ({
        headline: e.headline,
        summary: e.summary ?? "",
        significance: e.significance,
      })),
      researchTasks: researchTasks.map((t) => ({
        entityType: t.entityType,
        status: t.status,
        qualityScore: t.qualityScore ?? 0,
      })),
      counts: {
        feedItems: feedItems.length,
        signals: signals.length,
        narrativeEvents: narrativeEvents.length,
        researchTasks: researchTasks.length,
      },
    };
  },
});
