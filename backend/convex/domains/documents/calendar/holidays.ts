import { v } from "convex/values";
import { internalMutation, query } from "../../../_generated/server";

// Public: list holidays in a date range for a country
export const listHolidaysInRange = query({
  args: {
    country: v.string(),
    start: v.number(),
    end: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id("holidays"),
      country: v.string(),
      name: v.string(),
      dateMs: v.number(),
      dateKey: v.string(),
      year: v.number(),
    })
  ),
  handler: async (ctx, { country, start, end }) => {
    // Efficient range using index start bound, then break when beyond end.
    const q = ctx.db
      .query("holidays")
      .withIndex("by_country_date", (q) => q.eq("country", country).gte("dateMs", start))
      .order("asc");

    const out: Array<{ _id: any; country: string; name: string; dateMs: number; dateKey: string; year: number }> = [];
    for await (const h of q) {
      if (h.dateMs > end) break;
      out.push({
        _id: h._id,
        country: h.country,
        name: h.name,
        dateMs: h.dateMs,
        dateKey: h.dateKey,
        year: h.year,
      });
    }
    return out;
  },
});

// Internal: replace all holidays for a country/year with provided list (idempotent per year)
export const replaceCountryYear = internalMutation({
  args: {
    country: v.string(),
    year: v.number(),
    items: v.array(
      v.object({
        name: v.string(),
        dateKey: v.string(),
        dateMs: v.number(),
        types: v.optional(v.array(v.string())),
        raw: v.optional(v.any()),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, { country, year, items }) => {
    // Delete existing rows for country/year, then insert replacements
    const existing = await ctx.db
      .query("holidays")
      .withIndex("by_country_year", (q) => q.eq("country", country).eq("year", year))
      .collect();

    for (const doc of existing) {
      await ctx.db.delete(doc._id);
    }

    const now = Date.now();
    for (const item of items) {
      await ctx.db.insert("holidays", {
        country,
        name: item.name,
        dateMs: item.dateMs,
        dateKey: item.dateKey,
        types: item.types,
        year,
        raw: item.raw,
        updatedAt: now,
      });
    }

    return null;
  },
});
