"use node";

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

// Internal: refresh US holidays for this and next year (Node runtime)
export const refreshUSCron = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = new Date();
    const years = [now.getFullYear(), now.getFullYear() + 1];
    await refreshCountryYears(ctx, "US", years);
    return null;
  },
});

// Helper to fetch and write multiple years
async function refreshCountryYears(
  ctx: any,
  country: string,
  years: number[]
) {
  for (const year of years) {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(
        "Holiday fetch failed",
        country,
        year,
        res.status,
        await res.text()
      );
      continue;
    }
    const data = (await res.json()) as Array<any>;
    const items = data.map((d) => {
      // d.date is YYYY-MM-DD (local date). Interpret as 00:00:00Z for canonical day key.
      const dateKey: string = d.date;
      const dateMs = Date.parse(`${dateKey}T00:00:00Z`);
      return {
        name: d.localName || d.name,
        dateKey,
        dateMs,
        types: Array.isArray(d.types) ? d.types : undefined,
        raw: d,
      };
    });
    await ctx.runMutation(internal.domains.calendar.holidays.replaceCountryYear, {
      country,
      year,
      items,
    });
  }
}
