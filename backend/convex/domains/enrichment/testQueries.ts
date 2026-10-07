/**
 * Test Queries for Enrichment Pipeline
 */
import { query } from "../../_generated/server";

/**
 * Get all enrichment jobs for debugging.
 */
export const getAllJobs = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("enrichmentJobs").collect();
  },
});

/**
 * Get all funding events for debugging.
 */
export const getAllFundingEvents = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("fundingEvents").collect();
  },
});
