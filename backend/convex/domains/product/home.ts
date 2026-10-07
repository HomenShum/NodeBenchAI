import { internalAction, internalQuery, query } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { resolveProductReadOwnerKeys } from "./helpers";

const EMPTY_HOME_SNAPSHOT = {
  evidenceCards: [],
  recentReports: [],
  publicCards: [],
};

const PULSE_MAX_ITEMS = 5;
const PULSE_MIN_ITEMS = 3;
const PULSE_STALE_MS = 18 * 60 * 60 * 1000;

function buildPulsePreview(memory: any) {
  if (!memory) return null;
  const brief = memory.context?.executiveBrief ?? memory.context?.executiveBriefRecord?.brief ?? null;
  const signals = Array.isArray(brief?.actII?.signals) ? brief.actII.signals : [];
  const items = signals
    .filter((signal: any) => typeof signal?.headline === "string" && signal.headline.trim())
    .slice(0, PULSE_MAX_ITEMS)
    .map((signal: any, index: number) => ({
      id: signal.id ?? `pulse-item-${index + 1}`,
      title: String(signal.headline).trim(),
      summary: typeof signal?.synthesis === "string" ? signal.synthesis.trim() : "",
      sourceCount: Array.isArray(signal?.evidence) ? signal.evidence.length : 0,
    }));
  const updatedAt = memory.updatedAt ?? memory.generatedAt ?? Date.now();
  const freshnessState =
    Date.now() - updatedAt > PULSE_STALE_MS || items.length < PULSE_MIN_ITEMS
      ? "stale"
      : "fresh";
  return {
    id: `pulse-${String(memory._id)}`,
    sourceThreadId: `pulse-${String(memory._id)}`,
    title: brief?.meta?.headline ?? "Daily Pulse",
    summary:
      brief?.meta?.summary ??
      "Today's strongest signals, edited into a short daily return hook.",
    itemCount: items.length,
    items,
    updatedAt,
    freshnessState,
    prompt:
      items.length > 0
        ? `Open today's daily pulse for ${memory.dateString} and walk me through these signals: ${items.map((item: any) => item.title).join("; ")}.`
        : `Open today's daily pulse for ${memory.dateString} and summarize the strongest signals.`,
  };
}

export const getHomeSnapshot = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    let publicCards: any[] = [];
    try {
      publicCards = await ctx.db
        .query("productPublicCards")
        .withIndex("by_visibility_rank", (q) => q.eq("visibility", "public"))
        .order("asc")
        .take(6);
    } catch (error) {
      console.error("[product] getHomeSnapshot publicCards failed", error);
    }

    if (ownerKeys.length === 0) {
      return {
        evidenceCards: EMPTY_HOME_SNAPSHOT.evidenceCards,
        recentReports: EMPTY_HOME_SNAPSHOT.recentReports,
        publicCards,
      };
    }

    try {
      const [evidenceGroups, reportGroups] = await Promise.all([
        Promise.all(
          ownerKeys.map((ownerKey) =>
            ctx.db
              .query("productEvidenceItems")
              .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
              .order("desc")
              .take(6),
          ),
        ),
        Promise.all(
          ownerKeys.map((ownerKey) =>
            ctx.db
              .query("productReports")
              .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
              .order("desc")
              .take(3),
          ),
        ),
      ]);

      const evidenceCards = evidenceGroups
        .flat()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .reduce<Array<(typeof evidenceGroups)[number][number]>>((acc, evidence) => {
          if (acc.some((existing) => existing._id === evidence._id)) return acc;
          acc.push(evidence);
          return acc;
        }, [])
        .slice(0, 6);

      const recentReports = reportGroups
        .flat()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .reduce<Array<(typeof reportGroups)[number][number]>>((acc, report) => {
          if (acc.some((existing) => existing._id === report._id)) return acc;
          acc.push(report);
          return acc;
        }, [])
        .slice(0, 3);

      return {
        evidenceCards,
        recentReports,
        publicCards,
      };
    } catch (error) {
      console.error("[product] getHomeSnapshot owner data failed", {
        ownerKeys,
        error,
      });
      return {
        evidenceCards: EMPTY_HOME_SNAPSHOT.evidenceCards,
        recentReports: EMPTY_HOME_SNAPSHOT.recentReports,
        publicCards,
      };
    }
  },
});

export const getPulsePreviewInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const latestMemory = await ctx.db
      .query("dailyBriefMemories")
      .withIndex("by_generated_at")
      .order("desc")
      .first();
    return buildPulsePreview(latestMemory);
  },
});

export const getPulsePreview = query({
  args: {},
  handler: async (ctx) => {
    const latestMemory = await ctx.db
      .query("dailyBriefMemories")
      .withIndex("by_generated_at")
      .order("desc")
      .first();
    return buildPulsePreview(latestMemory);
  },
});

export const refreshDailyPulsePreview = internalAction({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(internal.domains.product.home.getPulsePreviewInternal, {});
  },
});
