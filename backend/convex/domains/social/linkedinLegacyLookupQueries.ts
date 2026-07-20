import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";

export const getFundingEventsNearDate = internalQuery({
  args: {
    dateString: v.string(), // YYYY-MM-DD
    daysBefore: v.optional(v.number()),
    daysAfter: v.optional(v.number()),
    roundType: v.optional(v.string()),
    minConfidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dayStart = Date.parse(`${args.dateString}T00:00:00Z`);
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const daysBefore = Math.min(Math.max(args.daysBefore ?? 2, 0), 30);
    const daysAfter = Math.min(Math.max(args.daysAfter ?? 2, 0), 30);
    const from = dayStart - daysBefore * 24 * 60 * 60 * 1000;
    const to = dayEnd + daysAfter * 24 * 60 * 60 * 1000;

    const raw = await ctx.db
      .query("fundingEvents")
      .withIndex("by_announcedAt", (q) => q.gte("announcedAt", from).lte("announcedAt", to))
      .collect();

    const roundType = typeof args.roundType === "string" ? args.roundType : null;
    const minConfidence = typeof args.minConfidence === "number" ? args.minConfidence : 0;

    return raw
      .filter((e) => (roundType ? (e as any).roundType === roundType : true))
      .filter((e) => (typeof (e as any).confidence === "number" ? (e as any).confidence >= minConfidence : true))
      .map((e) => ({
        id: e._id,
        companyName: (e as any).companyName,
        roundType: (e as any).roundType,
        amountUsd: (e as any).amountUsd,
        amountRaw: (e as any).amountRaw,
        announcedAt: (e as any).announcedAt,
        confidence: (e as any).confidence,
        verificationStatus: (e as any).verificationStatus,
        sourceUrls: (e as any).sourceUrls,
        sourceNames: (e as any).sourceNames,
      }));
  },
});

export const getFdaCacheByReference = internalQuery({
  args: {
    referenceNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("investorPlaybookFdaCache")
      .withIndex("by_reference", (q) => q.eq("referenceNumber", args.referenceNumber))
      .first();
    return row ?? null;
  },
});

