/**
 * Arbitrage Agent
 * 
 * Receipts-first research agent with contradiction detection,
 * source quality ranking, delta tracking, and health checks.
 * 
 * Based on ARBITRAGE_AGENT_IMPLEMENTATION_PLAN.md
 */
"use node";

import { v } from "convex/values";
import { action } from "../../../_generated/server";
import { generateText, stepCountIs } from "ai";

import { getArbitrageSystemPrompt, contradictionSchema, sourceQualitySchema } from "./config";
import {
  executeContradictionDetection,
  executeSourceQualityRanking,
  executeDeltaDetection,
  executeSourceHealthCheck,
  contradictionDetectionToolDefinition,
  sourceQualityRankingToolDefinition,
  deltaDetectionToolDefinition,
  sourceHealthCheckToolDefinition,
} from "./tools";

// Import data access tools for memory queries
import { executeListEvents } from "../dataAccess/tools/calendarTools";
import { executeListTasks } from "../dataAccess/tools/taskTools";
import { listEventsSchema, listTasksSchema, type ListEventsInput, type ListTasksInput } from "../dataAccess/config";

// Import centralized model resolver (2025 consolidated - 7 models only)
import { getLanguageModelSafe, DEFAULT_MODEL } from "../mcp_tools/models";

/**
 * Arbitrage Agent - Research with verification
 */
export const research = action({
  args: {
    prompt: v.string(),
    model: v.optional(v.string()),
    canonicalKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const modelName = args.model || DEFAULT_MODEL;
    console.log(`[ArbitrageAgent] Model: ${modelName}`);
    console.log(`[ArbitrageAgent] Prompt: ${args.prompt.substring(0, 100)}...`);

    try {
      const result = await generateText({
        model: getLanguageModelSafe(modelName),
        maxRetries: 3,
        stopWhen: stepCountIs(12), // More steps for multi-tool research
        tools: {
          // Data access tools
          listEvents: {
            description: "List calendar events for scheduling context",
            inputSchema: listEventsSchema,
            execute: async (input: ListEventsInput) => executeListEvents(ctx, input),
          },
          listTasks: {
            description: "List tasks for context",
            inputSchema: listTasksSchema,
            execute: async (input: ListTasksInput) => executeListTasks(ctx, input),
          },

          // Arbitrage tools
          detectContradictions: {
            ...contradictionDetectionToolDefinition,
            execute: async (input: any) => {
              const result = await executeContradictionDetection(ctx, input);
              return JSON.stringify(result);
            },
          },
          rankSourceQuality: {
            ...sourceQualityRankingToolDefinition,
            execute: async (input: any) => {
              const result = await executeSourceQualityRanking(ctx, input);
              return JSON.stringify(result);
            },
          },
          detectDeltas: {
            ...deltaDetectionToolDefinition,
            execute: async (input: any) => {
              const result = await executeDeltaDetection(ctx, input);
              return JSON.stringify(result);
            },
          },
          checkSourceHealth: {
            ...sourceHealthCheckToolDefinition,
            execute: async (input: any) => {
              const result = await executeSourceHealthCheck(ctx, input);
              return JSON.stringify(result);
            },
          },
        },
        system: getArbitrageSystemPrompt(),
        prompt: args.prompt,
      });

      console.log(`[ArbitrageAgent] Steps: ${result.steps?.length || 0}`);
      console.log(`[ArbitrageAgent] Tool calls: ${result.toolCalls?.length || 0}`);

      return result.text || "No response generated.";
    } catch (error: any) {
      console.error(`[ArbitrageAgent] Error:`, error);
      return `Error: ${error.message}`;
    }
  },
});

/**
 * Standalone contradiction analysis
 */
export const analyzeContradictions = action({
  args: {
    facts: v.array(v.object({
      claim: v.string(),
      source: v.string(),
      sourceType: v.string(),
      timestamp: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args): Promise<string> => {
    console.log(`[ArbitrageAgent.analyzeContradictions] ${args.facts.length} facts`);
    const result = await executeContradictionDetection(ctx, args);
    return JSON.stringify(result, null, 2);
  },
});

/**
 * Standalone source quality ranking
 */
export const rankSources = action({
  args: {
    sources: v.array(v.object({
      url: v.string(),
      name: v.string(),
      type: v.string(),
      timestamp: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args): Promise<string> => {
    console.log(`[ArbitrageAgent.rankSources] ${args.sources.length} sources`);
    const result = await executeSourceQualityRanking(ctx, args);
    return JSON.stringify(result, null, 2);
  },
});

/**
 * Standalone delta detection
 */
export const detectDeltas = action({
  args: {
    canonicalKey: v.string(),
    currentFacts: v.array(v.object({
      subject: v.string(),
      predicate: v.string(),
      object: v.string(),
      confidence: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args): Promise<string> => {
    console.log(`[ArbitrageAgent.detectDeltas] ${args.canonicalKey}`);
    const result = await executeDeltaDetection(ctx, args);
    return JSON.stringify(result, null, 2);
  },
});

/**
 * Standalone source health check
 */
export const checkHealth = action({
  args: {
    urls: v.array(v.string()),
    previousHashes: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<string> => {
    console.log(`[ArbitrageAgent.checkHealth] ${args.urls.length} URLs`);
    const result = await executeSourceHealthCheck(ctx, args);
    return JSON.stringify(result, null, 2);
  },
});
