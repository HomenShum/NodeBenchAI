"use node";

/**
 * Evaluation Harness for Agent Testing
 *
 * This module provides the infrastructure to run agent queries against
 * ground truth and collect evaluation results.
 */

import { action, internalAction } from "../../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../../_generated/api";
import {
  TEST_QUERIES,
  GROUND_TRUTH_ENTITIES,
  type TestQuery,
  type Persona,
} from "./groundTruth";
import {
  evaluateResponse,
  summarizeResults,
  type EvaluationResult,
  type EvaluationSummary,
} from "./booleanEvaluator";

// ═══════════════════════════════════════════════════════════════════════════
// HARNESS CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Minimum passing threshold (percentage of queries that must pass)
 */
export const PASSING_THRESHOLD = 0.75; // 75% pass rate required

/**
 * Per-persona minimum thresholds
 */
export const PERSONA_THRESHOLDS: Record<Persona, number> = {
  JPM_STARTUP_BANKER: 0.8, // Stricter for banker
  EARLY_STAGE_VC: 0.75,
  CTO_TECH_LEAD: 0.8,
  FOUNDER_STRATEGY: 0.7,
  ACADEMIC_RD: 0.8,
  ENTERPRISE_EXEC: 0.75,
  ECOSYSTEM_PARTNER: 0.7,
  QUANT_ANALYST: 0.75,
  PRODUCT_DESIGNER: 0.6,
  SALES_ENGINEER: 0.7,
};

// ═══════════════════════════════════════════════════════════════════════════
// MOCK RESPONSE GENERATOR (for offline testing)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a mock response for testing the evaluation framework itself.
 * This simulates what the agent might return.
 */
function generateMockResponse(query: TestQuery): string {
  const entity = GROUND_TRUTH_ENTITIES.find(e => e.entityId === query.targetEntityId);
  if (!entity) return "Entity not found.";

  // Base response template
  let response = `# ${entity.canonicalName} - ${query.targetPersona} Evaluation\n\n`;

  // Add summary
  response += `## Summary\n`;
  response += `${entity.canonicalName} is a ${entity.entityType.replace("_", " ")}`;
  if (entity.hqLocation) response += ` headquartered in ${entity.hqLocation}`;
  response += `.\n\n`;

  // Add funding if applicable
  if (entity.funding) {
    response += `## Funding\n`;
    response += `- **Stage:** ${entity.funding.stage}\n`;
    if (entity.funding.lastRound) {
      const lr = entity.funding.lastRound;
      const currency = lr.amount.currency === "EUR" ? "€" : "$";
      response += `- **Last Round:** ${lr.roundType} - ${currency}${lr.amount.amount}${lr.amount.unit} (${lr.announcedDate})\n`;
      if (lr.coLeads?.length) {
        response += `- **Lead Investors:** ${lr.coLeads.join(", ")}\n`;
      }
    }
    response += `\n`;
  }

  // Add people
  if (entity.founders?.length || entity.ceo) {
    response += `## People\n`;
    if (entity.founders?.length) {
      response += `- **Founders:** ${entity.founders.join(", ")}\n`;
    }
    if (entity.ceo) {
      response += `- **CEO:** ${entity.ceo}\n`;
    }
    response += `\n`;
  }

  // Add sectors
  if (entity.sectors?.length) {
    response += `## Sectors\n`;
    response += entity.sectors.map(s => `- ${s}`).join("\n") + "\n\n";
  }

  // Add product pipeline
  if (entity.leadPrograms?.length || entity.platform) {
    response += `## Product Pipeline\n`;
    if (entity.platform) response += `- **Platform:** ${entity.platform}\n`;
    if (entity.leadPrograms?.length) {
      response += `- **Lead Programs:** ${entity.leadPrograms.join(", ")}\n`;
    }
    response += `\n`;
  }

  // Add freshness assessment
  response += `## Freshness Assessment\n`;
  if (entity.withinBankerWindow) {
    response += `- News age: ${entity.freshnessAgeDays ?? "N/A"} days\n`;
    response += `- Within banker window: ✓ Yes\n`;
  } else {
    response += `- News age: ${entity.freshnessAgeDays ?? "N/A"} days\n`;
    response += `- Within banker window: ✗ No (stale, no recent news)\n`;
    if (query.expectedOutcome === "FAIL") {
      response += `- **Status:** NOT READY - Entity is too stale for ${query.targetPersona}\n`;
    }
  }
  response += `\n`;

  // Add persona evaluation
  response += `## ${query.targetPersona} Evaluation\n`;
  if (query.expectedOutcome === "PASS") {
    response += `**Status:** ✓ READY\n\n`;
    response += `This entity meets the requirements for ${query.targetPersona}:\n`;
    response += query.requiredFactsInResponse.slice(0, 3).map(f => `- ${f}`).join("\n") + "\n\n";
    response += `**Recommendation:** Suitable for outreach. Contact available at ${entity.primaryContact || "company website"}.\n`;
  } else {
    response += `**Status:** ✗ NOT READY / FAIL\n\n`;
    response += `This entity does not meet requirements:\n`;
    if (!entity.withinBankerWindow) {
      response += `- Not fresh enough (stale news)\n`;
    }
    if (entity.entityType === "oss_project") {
      response += `- Not a company (open source project)\n`;
    }
    if (entity.entityType === "research_signal") {
      response += `- Not a company (research signal)\n`;
    }
    response += `\n**Recommendation:** Not suitable for this persona's use case.\n`;
  }

  // Add source citation
  response += `\n## Sources\n`;
  response += `According to search results and available data.\n`;
  response += `{{fact:${query.targetEntityId.toLowerCase()}:evaluation}}\n`;

  return response;
}

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run a single query evaluation using mock responses (for framework testing)
 */
export const evaluateSingleQueryMock = action({
  args: {
    queryId: v.string(),
  },
  handler: async (ctx, args): Promise<EvaluationResult> => {
    const query = TEST_QUERIES.find(q => q.id === args.queryId);
    if (!query) {
      throw new Error(`Query not found: ${args.queryId}`);
    }

    const mockResponse = generateMockResponse(query);
    return evaluateResponse(query, mockResponse);
  },
});

/**
 * Run all query evaluations using mock responses
 */
export const evaluateAllQueriesMock = action({
  args: {},
  handler: async (ctx): Promise<{
    results: EvaluationResult[];
    summary: EvaluationSummary;
    isPassing: boolean;
    recommendations: string[];
  }> => {
    const results: EvaluationResult[] = [];

    for (const query of TEST_QUERIES) {
      const mockResponse = generateMockResponse(query);
      const result = evaluateResponse(query, mockResponse);
      results.push(result);
    }

    const summary = summarizeResults(results);
    const isPassing = summary.passRate >= PASSING_THRESHOLD;

    // Generate recommendations
    const recommendations: string[] = [];
    if (!isPassing) {
      recommendations.push(`Pass rate ${(summary.passRate * 100).toFixed(1)}% is below threshold of ${PASSING_THRESHOLD * 100}%`);
    }

    // Check per-persona thresholds
    for (const [persona, stats] of Object.entries(summary.byPersona)) {
      const threshold = PERSONA_THRESHOLDS[persona as Persona];
      if (stats.rate < threshold) {
        recommendations.push(
          `${persona}: ${(stats.rate * 100).toFixed(1)}% pass rate is below ${threshold * 100}% threshold`
        );
      }
    }

    // Add common failure recommendations
    if (summary.commonFailures.length > 0) {
      recommendations.push(`Common issues to fix: ${summary.commonFailures.slice(0, 3).join(", ")}`);
    }

    return {
      results,
      summary,
      isPassing,
      recommendations,
    };
  },
});

/**
 * Run a single query against the actual agent
 */
export const evaluateSingleQueryLive = action({
  args: {
    queryId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<EvaluationResult> => {
    const query = TEST_QUERIES.find(q => q.id === args.queryId);
    if (!query) {
      throw new Error(`Query not found: ${args.queryId}`);
    }

    // Call the actual agent
    // This uses the fast agent chat API to get a real response
    const response = await ctx.runAction(api.domains.agents.fastAgentChat.sendMessage, {
      userId: args.userId,
      message: query.query,
    });

    // Extract the text response from the agent
    let responseText = "";
    if (response.messages && response.messages.length > 0) {
      const lastMessage = response.messages[response.messages.length - 1];
      if (lastMessage.role === "assistant") {
        responseText = lastMessage.content || "";
      }
    }

    if (!responseText) {
      responseText = "No response received from agent.";
    }

    return evaluateResponse(query, responseText);
  },
});

/**
 * Run batch evaluation against the actual agent
 */
export const evaluateBatchLive = action({
  args: {
    userId: v.id("users"),
    queryIds: v.optional(v.array(v.string())),
    persona: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    results: EvaluationResult[];
    summary: EvaluationSummary;
    isPassing: boolean;
    recommendations: string[];
  }> => {
    let queries = TEST_QUERIES;

    // Filter by query IDs
    if (args.queryIds?.length) {
      queries = queries.filter(q => args.queryIds!.includes(q.id));
    }

    // Filter by persona
    if (args.persona) {
      queries = queries.filter(q => q.targetPersona === args.persona);
    }

    // Apply limit
    if (args.limit) {
      queries = queries.slice(0, args.limit);
    }

    const results: EvaluationResult[] = [];

    for (const query of queries) {
      try {
        console.log(`[Eval] Running query: ${query.id}`);

        // Call the actual agent
        const response = await ctx.runAction(api.domains.agents.fastAgentChat.sendMessage, {
          userId: args.userId,
          message: query.query,
        });

        // Extract response text
        let responseText = "";
        if (response.messages && response.messages.length > 0) {
          const lastMessage = response.messages[response.messages.length - 1];
          if (lastMessage.role === "assistant") {
            responseText = lastMessage.content || "";
          }
        }

        if (!responseText) {
          responseText = "No response received from agent.";
        }

        const result = evaluateResponse(query, responseText);
        results.push(result);

        console.log(`[Eval] ${query.id}: ${result.overallPass ? "PASS" : "FAIL"}`);
      } catch (error: any) {
        console.error(`[Eval] Error on ${query.id}:`, error.message);
        // Create a failure result
        results.push({
          queryId: query.id,
          query: query.query,
          targetEntityId: query.targetEntityId,
          targetPersona: query.targetPersona,
          expectedOutcome: query.expectedOutcome,
          actualOutcome: "FAIL",
          factors: {
            containsRequiredFacts: false,
            noForbiddenFacts: true,
            correctEntityType: false,
            correctLocation: false,
            correctFundingStage: false,
            correctFundingAmount: false,
            correctInvestors: false,
            acknowledgesFreshness: false,
            freshnessWithinPersonaWindow: false,
            mentionsFounders: false,
            mentionsCEO: false,
            citesPrimarySources: false,
            noFabricatedURLs: true,
            noFabricatedMetrics: true,
            meetsPersonaRequirements: false,
            correctOutcome: false,
            isCoherent: false,
            isActionable: false,
            noHallucinations: true,
          },
          passedFactors: 3,
          totalFactors: 19,
          overallPass: false,
          failureReasons: [`Agent error: ${error.message}`],
          response: `Error: ${error.message}`,
          evaluatedAt: new Date().toISOString(),
        });
      }
    }

    const summary = summarizeResults(results);
    const isPassing = summary.passRate >= PASSING_THRESHOLD;

    // Generate recommendations
    const recommendations: string[] = [];
    if (!isPassing) {
      recommendations.push(`Pass rate ${(summary.passRate * 100).toFixed(1)}% is below threshold of ${PASSING_THRESHOLD * 100}%`);
    }

    for (const [persona, stats] of Object.entries(summary.byPersona)) {
      const threshold = PERSONA_THRESHOLDS[persona as Persona];
      if (stats.rate < threshold) {
        recommendations.push(
          `${persona}: ${(stats.rate * 100).toFixed(1)}% needs improvement (target: ${threshold * 100}%)`
        );
      }
    }

    if (summary.commonFailures.length > 0) {
      recommendations.push(`Fix common issues: ${summary.commonFailures.slice(0, 3).join(", ")}`);
    }

    return {
      results,
      summary,
      isPassing,
      recommendations,
    };
  },
});

/**
 * Get evaluation test queries for display
 */
export const getTestQueries = action({
  args: {
    persona: v.optional(v.string()),
    entityId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<TestQuery[]> => {
    let queries = TEST_QUERIES;

    if (args.persona) {
      queries = queries.filter(q => q.targetPersona === args.persona);
    }

    if (args.entityId) {
      queries = queries.filter(q => q.targetEntityId === args.entityId);
    }

    return queries;
  },
});

/**
 * Get ground truth entities for display
 */
export const getGroundTruthEntities = action({
  args: {
    entityType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let entities = GROUND_TRUTH_ENTITIES;

    if (args.entityType) {
      entities = entities.filter(e => e.entityType === args.entityType);
    }

    return entities.map(e => ({
      entityId: e.entityId,
      canonicalName: e.canonicalName,
      entityType: e.entityType,
      hqLocation: e.hqLocation,
      fundingStage: e.funding?.stage,
      withinBankerWindow: e.withinBankerWindow,
      expectedPassPersonas: e.expectedPassPersonas,
      expectedFailPersonas: e.expectedFailPersonas,
    }));
  },
});
