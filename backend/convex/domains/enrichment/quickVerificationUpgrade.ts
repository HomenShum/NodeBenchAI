/**
 * Quick Verification Status Upgrade
 *
 * Upgrades verification status based on source count:
 * - 1 source: single-source
 * - 2 sources: multi-source
 * - 3+ sources: verified
 *
 * This provides instant improvement without expensive API calls.
 */

import { internalAction, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";

export const upgradeVerificationStatus = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[upgradeVerification] Starting...");

    const events = await ctx.runQuery(internal.domains.enrichment.fundingQueries.getRecentFundingEvents, {
      lookbackHours: 720,
      limit: 100,
    });

    console.log(`[upgradeVerification] Found ${events.length} events`);

    const stats = {
      singleSource: 0,
      multiSource: 0,
      verified: 0,
      unverified: 0,
      upgraded: 0,
    };

    for (const event of events) {
      const sourceCount = event.sourceUrls?.length || 0;
      let newStatus: string;

      if (sourceCount === 0) {
        newStatus = "unverified";
      } else if (sourceCount === 1) {
        newStatus = "single-source";
      } else if (sourceCount === 2) {
        newStatus = "multi-source";
      } else {
        newStatus = "verified"; // 3+ sources
      }

      // Count current status
      if (event.verificationStatus === "single-source") stats.singleSource++;
      else if (event.verificationStatus === "multi-source") stats.multiSource++;
      else if (event.verificationStatus === "verified") stats.verified++;
      else stats.unverified++;

      // Upgrade if needed
      if (newStatus !== event.verificationStatus) {
        console.log(`  ✅ Upgrading ${event.companyName}: ${event.verificationStatus} → ${newStatus} (${sourceCount} sources)`);

        try {
          await ctx.runMutation(internal.domains.enrichment.quickVerificationUpgrade.updateVerificationStatus, {
            fundingEventId: event.id as any,
            status: newStatus,
          });
          stats.upgraded++;
        } catch (e: any) {
          console.log(`  ❌ Failed: ${e.message}`);
        }
      }
    }

    console.log("[upgradeVerification] Complete!");
    console.log(`  Before:`);
    console.log(`    Single-source: ${stats.singleSource}`);
    console.log(`    Multi-source: ${stats.multiSource}`);
    console.log(`    Verified: ${stats.verified}`);
    console.log(`    Unverified: ${stats.unverified}`);
    console.log(`  Upgraded: ${stats.upgraded} events`);

    return {
      success: true,
      stats,
      upgraded: stats.upgraded,
    };
  },
});

export const updateVerificationStatus = internalMutation({
  args: {
    fundingEventId: v.id("fundingEvents"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.fundingEventId, {
      verificationStatus: args.status as any,
      updatedAt: Date.now(),
    });
  },
});
