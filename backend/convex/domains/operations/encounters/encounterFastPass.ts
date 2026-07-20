/**
 * encounterFastPass.ts - Fast enrichment from cached entity contexts
 *
 * Provides <10 second enrichment by searching existing entityContexts
 * cache. No external API calls - purely internal data lookup.
 */

"use node";

import { v } from "convex/values";
import { internalAction, action } from "../../../_generated/server";
import { api, internal } from "../../../_generated/api";
import { Id } from "../../../_generated/dataModel";
import type { EntitySummary, FastPassResults, SuggestedFollowUp } from "./types";

// ============================================================================
// Public Actions
// ============================================================================

/**
 * Trigger fast pass enrichment for an encounter (manual trigger)
 */
export const triggerFastPass = action({
  args: {
    encounterId: v.id("encounterEvents"),
  },
  handler: async (ctx, args) => {
    // Get the encounter
    const encounter = await ctx.runQuery(
      api.domains.encounters.encounterQueries.getEncounter,
      { encounterId: args.encounterId }
    );

    if (!encounter) {
      throw new Error("Encounter not found");
    }

    // Update status to queued
    await ctx.runMutation(
      api.domains.encounters.encounterMutations.updateWithFastPassResults,
      {
        encounterId: args.encounterId,
        fastPassResults: {
          entitySummaries: [],
          generatedAt: Date.now(),
          elapsedMs: 0,
        },
      }
    );

    // Schedule the fast pass
    await ctx.scheduler.runAfter(0, internal.domains.encounters.encounterFastPass.runFastPass, {
      encounterId: args.encounterId,
    });

    return { queued: true };
  },
});

// ============================================================================
// Internal Actions
// ============================================================================

/**
 * Run fast pass enrichment (internal)
 * Target: <10 seconds
 */
export const runFastPass = internalAction({
  args: {
    encounterId: v.id("encounterEvents"),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // 1. Get the encounter
    const encounter = await ctx.runQuery(
      internal.domains.encounters.encounterQueries.getByDDJobId,
      { ddJobId: "" }  // We need a different query - let me use a direct fetch
    );

    // Get encounter directly
    const encounterDoc = await ctx.runQuery(
      api.domains.encounters.encounterQueries.getEncounter,
      { encounterId: args.encounterId }
    );

    if (!encounterDoc) {
      console.error("[FastPass] Encounter not found:", args.encounterId);
      return { success: false, error: "Encounter not found" };
    }

    // 2. Collect all entity names to look up
    const entityNames: string[] = [];

    // Add company names
    for (const company of encounterDoc.companies) {
      entityNames.push(company.name);
    }

    // Add participant company names
    for (const participant of encounterDoc.participants) {
      if (participant.company) {
        entityNames.push(participant.company);
      }
    }

    // 3. Look up each entity in entityContexts cache
    const entitySummaries: EntitySummary[] = [];

    for (const entityName of entityNames) {
      try {
        const entityContext = await ctx.runQuery(
          api.domains.knowledge.entityContexts.getByName,
          { entityName }
        );

        if (entityContext) {
          entitySummaries.push(buildEntitySummary(entityName, entityContext));
        } else {
          // Try fuzzy search
          const searchResults = await ctx.runQuery(
            api.domains.knowledge.entityContexts.searchByName,
            { query: entityName, limit: 1 }
          );

          if (searchResults && searchResults.length > 0) {
            entitySummaries.push(
              buildEntitySummary(searchResults[0].name, searchResults[0])
            );
          } else {
            // No data found - add placeholder
            entitySummaries.push({
              entityName,
              summary: "No cached data available. Request deep dive for full research.",
              keyFacts: [],
            });
          }
        }
      } catch (error) {
        console.error(`[FastPass] Error looking up ${entityName}:`, error);
        entitySummaries.push({
          entityName,
          summary: "Error retrieving data.",
          keyFacts: [],
        });
      }
    }

    const elapsedMs = Date.now() - startTime;

    // 4. Generate suggested follow-ups
    const suggestedFollowUps = generateFollowUps(encounterDoc, entitySummaries);

    // 5. Update the encounter with results
    const fastPassResults: FastPassResults = {
      entitySummaries,
      generatedAt: Date.now(),
      elapsedMs,
    };

    try {
      await ctx.runMutation(
        internal.domains.encounters.encounterMutations.updateResearchStatus,
        {
          encounterId: args.encounterId,
          status: "fast_pass_complete",
        }
      );

      // Use the internal mutation from encounterMutations
      await ctx.runMutation(
        internal.domains.encounters.encounterMutations.saveFastPassResults,
        {
          encounterId: args.encounterId,
          fastPassResults,
          suggestedNextAction: suggestedFollowUps[0]?.description,
        }
      );
    } catch (error) {
      console.error("[FastPass] Error saving results:", error);
    }

    return {
      success: true,
      entitySummaries,
      suggestedFollowUps,
      elapsedMs,
    };
  },
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build entity summary from entityContext
 */
function buildEntitySummary(entityName: string, entityContext: any): EntitySummary {
  const summary: EntitySummary = {
    entityName,
    summary: "",
    keyFacts: [],
  };

  // Build summary sentence
  const parts: string[] = [];

  if (entityContext.description) {
    parts.push(entityContext.description.slice(0, 150));
  }

  if (entityContext.sectors?.length > 0) {
    summary.sector = entityContext.sectors[0];
  }

  if (entityContext.fundingStage) {
    summary.fundingStage = entityContext.fundingStage;
    parts.push(`Funding stage: ${entityContext.fundingStage}`);
  }

  if (entityContext.totalRaised) {
    summary.lastFundingAmount = formatAmount(entityContext.totalRaised);
    parts.push(`Total raised: ${summary.lastFundingAmount}`);
  }

  summary.summary = parts.length > 0
    ? parts.join(". ")
    : `${entityName} - no detailed data available.`;

  // Extract key facts
  const keyFacts: string[] = [];

  if (entityContext.hqLocation) {
    keyFacts.push(`HQ: ${entityContext.hqLocation}`);
  }

  if (entityContext.foundedYear) {
    keyFacts.push(`Founded: ${entityContext.foundedYear}`);
  }

  if (entityContext.employeeCount) {
    keyFacts.push(`Employees: ${formatNumber(entityContext.employeeCount)}`);
  }

  if (entityContext.keyPeople?.length > 0) {
    const firstPerson = entityContext.keyPeople[0];
    keyFacts.push(`Key person: ${firstPerson.name} (${firstPerson.role || "Leadership"})`);
  }

  if (entityContext.sectors?.length > 0) {
    keyFacts.push(`Sectors: ${entityContext.sectors.slice(0, 3).join(", ")}`);
  }

  if (entityContext.latestRound) {
    keyFacts.push(`Latest round: ${entityContext.latestRound.type} - ${formatAmount(entityContext.latestRound.amount)}`);
  }

  summary.keyFacts = keyFacts.slice(0, 5);

  return summary;
}

/**
 * Generate follow-up suggestions based on encounter and enrichment
 */
function generateFollowUps(
  encounter: any,
  entitySummaries: EntitySummary[]
): SuggestedFollowUp[] {
  const followUps: SuggestedFollowUp[] = [];

  // Check if any company has funding info
  const hasFoundedCompany = entitySummaries.some(
    (e) => e.fundingStage || e.lastFundingAmount
  );

  // Check if we have thin data
  const hasThinData = entitySummaries.some(
    (e) => e.keyFacts.length === 0 || e.summary.includes("no detailed data")
  );

  // Suggest deep research if thin data
  if (hasThinData) {
    followUps.push({
      action: "deep_research",
      description: "Request full due diligence - limited data in cache",
      priority: "high",
    });
  }

  // Suggest LinkedIn connect if participants found
  if (encounter.participants?.length > 0) {
    followUps.push({
      action: "connect_on_linkedin",
      description: `Connect with ${encounter.participants[0].name} on LinkedIn`,
      priority: "medium",
    });
  }

  // Suggest follow-up email
  if (encounter.companies?.length > 0) {
    followUps.push({
      action: "send_intro_email",
      description: `Send follow-up email to ${encounter.companies[0].name}`,
      priority: "medium",
      deadline: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    });
  }

  // Suggest scheduling meeting if startup
  if (hasFoundedCompany) {
    followUps.push({
      action: "schedule_meeting",
      description: "Schedule follow-up meeting to discuss further",
      priority: "medium",
      deadline: Date.now() + 7 * 24 * 60 * 60 * 1000, // 1 week
    });
  }

  return followUps.slice(0, 3);
}

/**
 * Format currency amount
 */
function formatAmount(amount: number | string | undefined): string {
  if (!amount) return "Unknown";

  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return String(amount);

  if (num >= 1_000_000_000) {
    return `$${(num / 1_000_000_000).toFixed(1)}B`;
  }
  if (num >= 1_000_000) {
    return `$${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `$${(num / 1_000).toFixed(0)}K`;
  }
  return `$${num}`;
}

/**
 * Format number with commas
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}
