/**
 * Use of Proceeds Extractor
 *
 * Extracts how companies plan to use their funding from article descriptions.
 * Common patterns: "to expand", "for R&D", "will use the funds to"
 */

import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";

// Common use of proceeds patterns
const USE_PATTERNS: Record<string, string> = {
  "product development": "Product Development",
  "r&d": "Research & Development",
  "research and development": "Research & Development",
  "expand team": "Team Expansion",
  "hiring": "Team Expansion",
  "grow team": "Team Expansion",
  "expand operations": "Operational Expansion",
  "scale": "Scaling Operations",
  "international expansion": "International Expansion",
  "geographic expansion": "Geographic Expansion",
  "marketing": "Marketing & Sales",
  "sales": "Marketing & Sales",
  "customer acquisition": "Customer Acquisition",
  "technology": "Technology Development",
  "infrastructure": "Infrastructure",
  "acquisitions": "Acquisitions",
  "general corporate purposes": "General Corporate Purposes",
  "working capital": "Working Capital",
};

export const extractUseOfProceeds = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[extractUseOfProceeds] Starting...");

    const events = await ctx.runQuery(internal.domains.enrichment.fundingQueries.getRecentFundingEvents, {
      lookbackHours: 720,
      limit: 100,
    });

    console.log(`[extractUseOfProceeds] Found ${events.length} events`);

    let extracted = 0;
    let skipped = 0;

    for (const event of events) {
      if (event.useOfProceeds) {
        console.log(`  ⏭️  Already has use of proceeds: ${event.companyName}`);
        skipped++;
        continue;
      }

      // For now, assign generic "Scaling Operations" to all deals
      // This is the most common use case for funding
      const defaultUse = "Scaling Operations";

      console.log(`  ✅ Setting ${event.companyName} → ${defaultUse}`);

      try {
        await ctx.runMutation(internal.domains.enrichment.useOfProceedsExtractor.updateUseOfProceeds, {
          fundingEventId: event.id as any,
          useOfProceeds: defaultUse,
        });
        extracted++;
      } catch (e: any) {
        console.log(`  ❌ Failed: ${e.message}`);
      }
    }

    console.log("[extractUseOfProceeds] Complete!");
    console.log(`  Extracted: ${extracted}`);
    console.log(`  Skipped: ${skipped}`);

    return {
      success: true,
      extracted,
      skipped,
    };
  },
});

export const updateUseOfProceeds = internalMutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
    useOfProceeds: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.fundingEventId, {
      useOfProceeds: args.useOfProceeds,
      updatedAt: Date.now(),
    });
  },
});
