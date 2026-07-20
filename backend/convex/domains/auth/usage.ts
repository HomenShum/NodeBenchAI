import { query, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

async function getEffectiveLimit(ctx: any): Promise<number> {
  try {
    const sub = await ctx.runQuery(api.domains.billing.billing.getSubscription, {});
    return sub.status === "active" ? 50 : 5;
  } catch {
    return 5;
  }
}

export const getDailyUsagePublic = query({
  args: { provider: v.string() },
  returns: v.object({ count: v.number(), limit: v.number(), date: v.string() }),
  handler: async (ctx, { provider }) => {
    const userId = await getAuthUserId(ctx);
    const date = todayISO();
    if (!userId) return { count: 0, limit: 5, date };

    const usage = await ctx.db
      .query("dailyUsage")
      .withIndex("by_user_provider_date", (q) =>
        q.eq("userId", userId).eq("provider", provider).eq("date", date)
      )
      .first() as Doc<"dailyUsage"> | null;

    const limit = await getEffectiveLimit(ctx);
    return { count: usage?.count ?? 0, limit, date };
  },
});

export const getUsageSeries = query({
  args: { provider: v.string(), days: v.number() },
  returns: v.array(
    v.object({
      date: v.string(),
      count: v.number(),
      limit: v.number(),
    })
  ),
  handler: async (ctx, { provider, days }) => {
    const userId = await getAuthUserId(ctx);
    const results: Array<{ date: string; count: number; limit: number }> = [];
    const end = new Date();
    const effLimit = await getEffectiveLimit(ctx);

    for (let i = 0; i < Math.max(1, Math.min(31, days)); i++) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      const date = d.toISOString().split("T")[0];

      if (!userId) {
        results.push({ date, count: 0, limit: 5 });
        continue;
      }

      const usage = await ctx.db
        .query("dailyUsage")
        .withIndex("by_user_provider_date", (q) =>
          q.eq("userId", userId).eq("provider", provider).eq("date", date)
        )
        .first() as Doc<"dailyUsage"> | null;

      results.push({ date, count: usage?.count ?? 0, limit: effLimit });
    }

    // Return in ascending date order
    return results.reverse();
  },
});

export const incrementDailyUsage = internalMutation({
  args: { provider: v.string(), amount: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { provider, amount }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const date = todayISO();
    const limit = await getEffectiveLimit(ctx);
    const existing = await ctx.db
      .query("dailyUsage")
      .withIndex("by_user_provider_date", (q) =>
        q.eq("userId", userId).eq("provider", provider).eq("date", date)
      )
      .first() as Doc<"dailyUsage"> | null;

    const inc = Math.max(1, Math.floor(amount ?? 1));
    const now = Date.now();

    if (existing) {
      const current = existing.count ?? 0;
      await ctx.db.patch(existing._id, { count: current + inc, updatedAt: now, limit });
    } else {
      await ctx.db.insert("dailyUsage", {
        userId,
        provider,
        date,
        count: inc,
        limit,
        updatedAt: now,
      });
    }
    return null;
  },
});
