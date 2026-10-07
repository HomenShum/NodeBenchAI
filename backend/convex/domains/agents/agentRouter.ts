/**
 * Agent Routing Layer
 * 
 * Selects the appropriate agent based on:
 * - Query complexity (simple vs complex)
 * - User preferences (arbitrage mode)
 * - Feature flags
 */
"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api } from "../../_generated/api";

// Import modular agents
import { orchestrate as coordinatorOrchestrate } from "./coordinator/agent";
import { query as dataAccessQuery } from "./dataAccess/agent";
import { research as arbitrageResearch } from "./arbitrage/agent";
import { DEFAULT_MODEL, normalizeModelInput } from "./mcp_tools/models";

// Query complexity indicators
const SIMPLE_QUERY_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|bye|goodbye)/i,
  /^what('s| is) (today|the date|time)/i,
  /^(show|list|get) my (calendar|events|tasks|todos)/i,
];

const ARBITRAGE_QUERY_PATTERNS = [
  /research/i,
  /investigate/i,
  /compare.*sources/i,
  /verify/i,
  /contradict/i,
  /what('s| has) changed/i,
  /delta/i,
  /since last/i,
  /receipts/i,
  /evidence/i,
];

const COMPLEX_QUERY_PATTERNS = [
  /analyze/i,
  /build.*dossier/i,
  /deep dive/i,
  /sec.*filing/i,
  /10-k|10-q|8-k/i,
  /funding.*round/i,
  /valuation/i,
  /newsletter/i,
];

export type AgentMode = "simple" | "arbitrage" | "deep";

/**
 * Classify query to determine routing
 */
function classifyQuery(prompt: string): AgentMode {
  // Check for arbitrage patterns first
  if (ARBITRAGE_QUERY_PATTERNS.some(p => p.test(prompt))) {
    return "arbitrage";
  }
  
  // Check for complex patterns
  if (COMPLEX_QUERY_PATTERNS.some(p => p.test(prompt))) {
    return "deep";
  }
  
  // Check for simple patterns
  if (SIMPLE_QUERY_PATTERNS.some(p => p.test(prompt))) {
    return "simple";
  }
  
  // Default to simple for short queries, deep for longer
  return prompt.length < 50 ? "simple" : "deep";
}

/**
 * Smart Router - Routes to appropriate agent based on query and preferences
 */
export const route = action({
  args: {
    prompt: v.string(),
    model: v.optional(v.string()),
    forceMode: v.optional(v.string()), // Override automatic routing
    arbitrageEnabled: v.optional(v.boolean()), // User preference
  },
  handler: async (ctx, args): Promise<{
    response: string;
    mode: AgentMode;
    model: string;
  }> => {
    const modelName = normalizeModelInput(args.model || DEFAULT_MODEL);
    
    // Determine mode
    let mode: AgentMode;
    if (args.forceMode) {
      mode = args.forceMode as AgentMode;
    } else if (args.arbitrageEnabled) {
      // If arbitrage mode is enabled, check if query fits
      mode = ARBITRAGE_QUERY_PATTERNS.some(p => p.test(args.prompt)) 
        ? "arbitrage" 
        : classifyQuery(args.prompt);
    } else {
      mode = classifyQuery(args.prompt);
    }

    console.log(`[AgentRouter] Mode: ${mode}, Model: ${modelName}`);
    console.log(`[AgentRouter] Prompt: ${args.prompt.substring(0, 80)}...`);

    let response: string;

    try {
      switch (mode) {
        case "simple":
          // Use modular coordinator for simple queries
          response = await ctx.runAction(api.domains.agents.coordinator.agent.orchestrate, {
            prompt: args.prompt,
            model: modelName,
          });
          break;

        case "arbitrage":
          // Use arbitrage agent for receipts-first research
          response = await ctx.runAction(api.domains.agents.arbitrage.agent.research, {
            prompt: args.prompt,
            model: modelName,
          });
          break;

        case "deep":
        default:
          // For deep mode, use the coordinator which can delegate
          // In production, this would call the full Deep Agent 2.0 coordinator
          response = await ctx.runAction(api.domains.agents.coordinator.agent.orchestrate, {
            prompt: args.prompt,
            model: modelName,
          });
          break;
      }

      return {
        response,
        mode,
        model: modelName,
      };
    } catch (error: any) {
      console.error(`[AgentRouter] Error in ${mode} mode:`, error);
      return {
        response: `Error: ${error.message}`,
        mode,
        model: modelName,
      };
    }
  },
});

/**
 * Get routing recommendation without executing
 */
export const classifyIntent = action({
  args: {
    prompt: v.string(),
    arbitrageEnabled: v.optional(v.boolean()),
  },
  returns: v.object({
    recommendedMode: v.string(),
    confidence: v.number(),
    reasoning: v.string(),
  }),
  handler: async (ctx, args) => {
    const mode = classifyQuery(args.prompt);
    
    let confidence = 0.7;
    let reasoning = "";

    if (SIMPLE_QUERY_PATTERNS.some(p => p.test(args.prompt))) {
      confidence = 0.95;
      reasoning = "Matches simple query pattern (greeting, basic data access)";
    } else if (ARBITRAGE_QUERY_PATTERNS.some(p => p.test(args.prompt))) {
      confidence = 0.9;
      reasoning = "Contains arbitrage keywords (research, verify, compare sources)";
    } else if (COMPLEX_QUERY_PATTERNS.some(p => p.test(args.prompt))) {
      confidence = 0.85;
      reasoning = "Contains complex research keywords (analyze, dossier, SEC filings)";
    } else {
      reasoning = `Defaulting based on query length (${args.prompt.length} chars)`;
    }

    // Boost arbitrage if user has it enabled
    if (args.arbitrageEnabled && mode !== "arbitrage") {
      reasoning += ". User has arbitrage mode enabled - may prefer receipts-first approach.";
    }

    return {
      recommendedMode: mode,
      confidence,
      reasoning,
    };
  },
});
