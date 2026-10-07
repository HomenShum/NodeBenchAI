import { v } from "convex/values";
import { query, internalQuery } from "../../_generated/server";

/**
 * Internal query to load scenarios from database
 * Separated from personaEpisodeEval.ts because that file uses "use node"
 */
export const loadScenariosFromDb = internalQuery({
  args: {
    domain: v.optional(v.string()),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let queryBuilder = ctx.db.query("evaluation_scenarios");

    if (args.domain) {
      queryBuilder = queryBuilder.withIndex("by_domain", (q) => q.eq("domain", args.domain));
    }

    const allScenarios = await queryBuilder.collect();

    const offset = args.offset ?? 0;
    const limit = args.limit ?? allScenarios.length;

    const scenarios = allScenarios.slice(offset, offset + limit);

    return {
      scenarios: scenarios.map((s) => ({
        id: s.scenarioId,
        name: s.name,
        query: s.query,
        expectedPersona: s.expectedPersona,
        expectedEntityId: s.expectedEntityId,
        allowedPersonas: s.allowedPersonas,
        requirements: s.requirements,
      })),
      total: allScenarios.length,
    };
  },
});

/**
 * Public query to get scenarios (for UI)
 */
export const getScenarios = query({
  args: {
    domain: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let queryBuilder = ctx.db.query("evaluation_scenarios");

    if (args.domain) {
      queryBuilder = queryBuilder.withIndex("by_domain", (q) => q.eq("domain", args.domain));
    }

    const scenarios = await queryBuilder.collect();

    if (args.limit && args.limit > 0) {
      return scenarios.slice(0, args.limit);
    }

    return scenarios;
  },
});
