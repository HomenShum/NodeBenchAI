/**
 * Delete duplicate Unknown Company entries
 * Run once to clean up old entries that have been fixed
 */

import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

export const deleteDuplicateUnknownCompanies = internalMutation({
  args: {},
  handler: async (ctx) => {
    const duplicateIds = [
      "ns7xypt5wekwmxy09r3cs9qmpd7znf8p" as any, // Unknown Company ($9M) - Nexxa AI duplicate
      "ns7jrqp2rcst6643fnmxd47qn57zncht" as any, // Unknown Company ($12B) - OpenEvidence duplicate
    ];

    const deleted: string[] = [];

    for (const id of duplicateIds) {
      const event = await ctx.db.get(id);
      if (event) {
        console.log(`[deleteDuplicates] Deleting: ${event.companyName}`);
        await ctx.db.delete(id);
        deleted.push(event.companyName);
      }
    }

    return {
      success: true,
      deleted,
      count: deleted.length,
    };
  },
});
