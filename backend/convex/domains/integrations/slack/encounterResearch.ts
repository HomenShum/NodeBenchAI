"use node";

/**
 * Encounter Research
 *
 * Triggers fast-pass and deep-dive research for encounter entities.
 * Uses existing entityContexts cache and research infrastructure.
 *
 * @module integrations/slack/encounterResearch
 */

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// FAST-PASS RESEARCH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trigger fast-pass research for encounter entities.
 * Uses cached research + single quick search.
 */
export const triggerFastPassResearch = internalAction({
  args: {
    encounterId: v.id("userEvents"),
    entities: v.array(v.object({
      name: v.string(),
      type: v.union(v.literal("person"), v.literal("company")),
      existingEntityId: v.optional(v.id("entityContexts")),
    })),
  },
  returns: v.object({
    results: v.array(v.object({
      name: v.string(),
      type: v.string(),
      source: v.string(),
      summary: v.optional(v.string()),
      keyFacts: v.optional(v.array(v.string())),
    })),
    completedCount: v.number(),
    cachedCount: v.number(),
  }),
  handler: async (ctx, args) => {
    console.log(`[EncounterResearch] Fast-pass research for ${args.entities.length} entities`);

    const results: Array<{
      name: string;
      type: string;
      source: string;
      summary?: string;
      keyFacts?: string[];
    }> = [];

    let cachedCount = 0;

    for (const entity of args.entities) {
      try {
        if (entity.existingEntityId) {
          // Use cached research
          const cached = await ctx.runQuery(
            internal.domains.integrations.slack.encounterResearchQueries.getEntityResearchCache,
            { entityId: entity.existingEntityId }
          );

          if (cached && !isStale(cached.updatedAt)) {
            results.push({
              name: entity.name,
              type: entity.type,
              source: "cache",
              summary: cached.summary,
              keyFacts: cached.keyFacts?.slice(0, 3),
            });
            cachedCount++;
            continue;
          }
        }

        // Quick search for new/stale entities
        const searchResult = await performQuickSearch(ctx, entity.name, entity.type);

        results.push({
          name: entity.name,
          type: entity.type,
          source: "fast_pass",
          summary: searchResult.summary,
          keyFacts: searchResult.keyFacts,
        });
      } catch (error) {
        console.error(`[EncounterResearch] Error researching ${entity.name}:`, error);
        results.push({
          name: entity.name,
          type: entity.type,
          source: "error",
          summary: "Research failed - will retry later",
        });
      }
    }

    // Update encounter research status
    await ctx.runMutation(
      internal.domains.integrations.slack.encounterMutations.updateEncounterResearchStatus,
      {
        encounterId: args.encounterId,
        researchStatus: "fast_pass",
      }
    );

    console.log(`[EncounterResearch] Fast-pass complete: ${results.length} results, ${cachedCount} cached`);

    return {
      results,
      completedCount: results.length,
      cachedCount,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DEEP-DIVE RESEARCH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trigger deep-dive research for an entity.
 * Queues a full research job.
 */
export const triggerDeepDiveResearch = internalAction({
  args: {
    encounterId: v.id("userEvents"),
    entityName: v.string(),
    entityType: v.union(v.literal("person"), v.literal("company")),
    userId: v.id("users"),
  },
  returns: v.object({
    queued: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    console.log(`[EncounterResearch] Deep-dive research for ${args.entityName} (${args.entityType})`);

    try {
      // Check if we have research job infrastructure
      // For now, create a research task in userEvents
      const now = Date.now();

      await ctx.runMutation(
        internal.domains.integrations.slack.encounterResearchQueries.createResearchTask,
        {
          userId: args.userId,
          entityName: args.entityName,
          entityType: args.entityType,
          encounterId: args.encounterId,
        }
      );

      // Update encounter status
      await ctx.runMutation(
        internal.domains.integrations.slack.encounterMutations.updateEncounterResearchStatus,
        {
          encounterId: args.encounterId,
          researchStatus: "deep_dive",
        }
      );

      return {
        queued: true,
        message: `Deep research queued for ${args.entityName}`,
      };
    } catch (error) {
      console.error(`[EncounterResearch] Error queueing deep-dive:`, error);
      return {
        queued: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// Note: Query and mutation functions are in encounterResearchQueries.ts
// due to Convex "use node" restriction (only actions allowed in Node.js files)

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if cached data is stale (older than 30 days).
 */
function isStale(updatedAt?: number): boolean {
  if (!updatedAt) return true;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return Date.now() - updatedAt > thirtyDaysMs;
}

/**
 * Perform a quick search for an entity.
 * Uses a simple search to get basic info.
 */
async function performQuickSearch(
  ctx: any,
  name: string,
  type: "person" | "company"
): Promise<{ summary?: string; keyFacts?: string[] }> {
  // Try to use existing search infrastructure
  // For now, return a placeholder
  console.log(`[EncounterResearch] Quick search for ${type}: ${name}`);

  // TODO: Integrate with actual search tools (Linkup, Brave, etc.)
  // This is a placeholder that should be replaced with actual search

  const searchQuery = type === "person"
    ? `${name} professional background`
    : `${name} company overview`;

  // Return placeholder for now
  return {
    summary: `Quick lookup for ${name} - full search integration coming soon`,
    keyFacts: [
      `Entity type: ${type}`,
      `Search pending...`,
    ],
  };
}

