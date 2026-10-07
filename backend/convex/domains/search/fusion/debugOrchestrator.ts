"use node";
/**
 * Debug Orchestrator - Test the full orchestrator pipeline
 */

import { action } from "../../../_generated/server";
import { v } from "convex/values";
import { SearchOrchestrator } from "./orchestrator";

export const testOrchestrator = action({
  args: {
    query: v.string(),
    source: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    console.log(`[debugOrchestrator] Testing orchestrator with source: ${args.source}`);

    const orchestrator = new SearchOrchestrator(ctx);

    const response = await orchestrator.search({
      query: args.query,
      mode: "fast",
      sources: [args.source as any],
      maxTotal: 5,
    });

    return {
      resultCount: response.results.length,
      sourcesQueried: response.sourcesQueried,
      errors: response.errors,
      timing: response.timing,
      firstResult: response.results[0]?.title,
    };
  },
});
