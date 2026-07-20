/**
 * Trigger for founder seed data.
 *
 * Usage: npx convex run domains/founder/seedTrigger:seed
 */

import { mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const result = await ctx.scheduler.runAfter(
      0,
      internal.domains.founder.seed.seedFounderData,
    );
    return { scheduled: true, jobId: result };
  },
});
