import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";

/**
 * Migrate evaluation scenarios from JSON pack to database
 */
export const migrateScenarios = mutation({
  args: {
    scenarios: v.array(
      v.object({
        scenarioId: v.string(),
        name: v.string(),
        query: v.string(),
        expectedPersona: v.string(),
        expectedEntityId: v.string(),
        allowedPersonas: v.optional(v.array(v.string())),
        domain: v.optional(v.string()),
        requirements: v.optional(
          v.object({
            minToolCalls: v.optional(v.number()),
            maxToolCalls: v.optional(v.number()),
            maxCostUsd: v.optional(v.number()),
            maxClarifyingQuestions: v.optional(v.number()),
            requireVerificationStep: v.optional(v.boolean()),
            requireProviderUsage: v.optional(v.boolean()),
            requireTools: v.optional(v.array(v.string())),
          })
        ),
        version: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;

    for (const scenario of args.scenarios) {
      // Check if scenario already exists
      const existing = await ctx.db
        .query("evaluation_scenarios")
        .withIndex("by_scenario_id", (q) => q.eq("scenarioId", scenario.scenarioId))
        .first() as Doc<"evaluation_scenarios"> | null;

      if (existing) {
        // Update existing scenario
        await ctx.db.patch(existing._id, {
          name: scenario.name,
          query: scenario.query,
          expectedPersona: scenario.expectedPersona,
          expectedEntityId: scenario.expectedEntityId,
          allowedPersonas: scenario.allowedPersonas,
          domain: scenario.domain,
          requirements: scenario.requirements,
          version: scenario.version,
        });
        updated++;
      } else {
        // Insert new scenario
        await ctx.db.insert("evaluation_scenarios", {
          scenarioId: scenario.scenarioId,
          name: scenario.name,
          query: scenario.query,
          expectedPersona: scenario.expectedPersona,
          expectedEntityId: scenario.expectedEntityId,
          allowedPersonas: scenario.allowedPersonas,
          domain: scenario.domain,
          requirements: scenario.requirements,
          createdAt: now,
          version: scenario.version,
        });
        inserted++;
      }
    }

    return { ok: true, inserted, updated, total: args.scenarios.length };
  },
});

/**
 * Get all evaluation scenarios
 */
export const getScenarios = query({
  args: {
    domain: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db.query("evaluation_scenarios");

    if (args.domain) {
      query = query.withIndex("by_domain", (q) => q.eq("domain", args.domain));
    }

    const scenarios = await query.collect();

    if (args.limit && args.limit > 0) {
      return scenarios.slice(0, args.limit);
    }

    return scenarios;
  },
});

/**
 * Get scenario by ID
 */
export const getScenarioById = query({
  args: { scenarioId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("evaluation_scenarios")
      .withIndex("by_scenario_id", (q) => q.eq("scenarioId", args.scenarioId))
      .first();
  },
});

/**
 * Count scenarios
 */
export const countScenarios = query({
  args: { domain: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let query = ctx.db.query("evaluation_scenarios");

    if (args.domain) {
      query = query.withIndex("by_domain", (q) => q.eq("domain", args.domain));
    }

    const scenarios = await query.collect();
    return scenarios.length;
  },
});
