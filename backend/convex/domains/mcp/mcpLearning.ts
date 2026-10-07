/**
 * MCP Adaptive Learning System
 * Automatically learns tool usage patterns and generates dynamic user guidance
 */

import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { api } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";

/**
 * Sample queries to use for automatic tool learning
 */
const getToolLearningQueries = (toolName: string): string[] => {
  const baseQueries = [
    "show me an example of how to use this tool",
    "help me understand what this tool can do",
    "demonstrate this tool with a simple example"
  ];

  // Tool-specific learning queries
  const specificQueries: Record<string, string[]> = {
    tavily_search: [
      "search for recent AI news",
      "find information about React development",
      "look up JavaScript tutorials",
      "search for TypeScript best practices"
    ],
    tavily_map: [
      "map the structure of docs.convex.dev",
      "discover pages on github.com/microsoft/vscode", 
      "explore the URL structure of a documentation site",
      "find all pages on a company website"
    ],
    tavily_extract: [
      "extract content from https://example.com/blog/article",
      "get the full text from a documentation page",
      "read and extract content from a specific URL",
      "pull content from a news article"
    ],
    tavily_crawl: [
      "crawl pages from docs.react.dev",
      "explore multiple pages on a website",
      "gather content from recent blog posts",
      "scan through documentation sections"
    ]
  };

  return [...baseQueries, ...(specificQueries[toolName] || [])];
};

/**
 * Automatically learn a tool by executing sample queries
 */
export const learnTool = internalAction({
  args: {
    toolId: v.id("mcpTools"),
    serverId: v.id("mcpServers"),
    toolName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { toolId, serverId, toolName }) => {
    console.log(`[Learning] Starting adaptive learning for tool: ${toolName}`);
    
    const queries = getToolLearningQueries(toolName);
    let successCount = 0;
    let totalAttempts = 0;

    for (const query of queries) {
      totalAttempts++;
      
      try {
        console.log(`[Learning] Attempting: "${query}"`);
        const startTime = Date.now();
        
        // Legacy function - aiAgents module doesn't exist
        // MCP learning not implemented in new Convex Agent system
        // const result = await ctx.runAction(api.aiAgents.executeToolWithNaturalLanguage, {
        //   serverId,
        //   toolName,
        //   naturalLanguageQuery: query,
        //   model: "openai",
        //   isLearning: true,
        // });
        const result: any = { success: false, error: "MCP learning not implemented" };
        
        const executionTime = Date.now() - startTime;
        const success = result.success && result.result?.convertedParameters;
        
        if (success) {
          successCount++;
          console.log(`[Learning] ✅ Success: ${JSON.stringify(result.result?.convertedParameters)}`);
        } else {
          console.log(`[Learning] ❌ Failed: ${result.error || 'Unknown error'}`);
        }

        // Store the learning result
        await ctx.runMutation(internal.domains.mcp.mcpLearning.storeLearningResult, {
          toolId,
          serverId,
          naturalLanguageQuery: query,
          convertedParameters: result.result?.convertedParameters || {},
          executionSuccess: success,
          executionResult: success ? result.result?.mcpResponse : null,
          errorMessage: result.error || undefined,
          learningType: "auto_discovery",
          qualityScore: success ? (executionTime < 5000 ? 0.9 : 0.7) : 0.1, // Simple quality scoring
          timingMs: executionTime,
        });

        // Add delay between attempts to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`[Learning] Error learning query "${query}":`, error);
        
        // Store the failed attempt
        await ctx.runMutation(internal.domains.mcp.mcpLearning.storeLearningResult, {
          toolId,
          serverId,
          naturalLanguageQuery: query,
          convertedParameters: {},
          executionSuccess: false,
          executionResult: null,
          errorMessage: error instanceof Error ? error.message : String(error),
          learningType: "auto_discovery",
          qualityScore: 0.0,
          timingMs: 0,
        });
      }
    }

    console.log(`[Learning] Completed learning for ${toolName}: ${successCount}/${totalAttempts} successful`);
    
    // Generate guidance examples based on successful learning
    if (successCount > 0) {
      await ctx.runAction(internal.domains.mcp.mcpLearning.generateGuidanceExamples, {
        toolId,
        serverId,
      });
    }
  },
});

/**
 * Store a learning result in the database
 */
export const storeLearningResult = internalMutation({
  args: {
    toolId: v.id("mcpTools"),
    serverId: v.id("mcpServers"),
    naturalLanguageQuery: v.string(),
    convertedParameters: v.any(),
    executionSuccess: v.boolean(),
    executionResult: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    learningType: v.union(v.literal("auto_discovery"), v.literal("user_interaction"), v.literal("manual_training")),
    qualityScore: v.optional(v.number()),
    timingMs: v.optional(v.number()),
  },
  returns: v.id("mcpToolLearning"),
  handler: async (ctx, args) => {
    const now = Date.now();
    
    return await ctx.db.insert("mcpToolLearning", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Generate curated guidance examples from learning data
 */
export const generateGuidanceExamples = internalAction({
  args: {
    toolId: v.id("mcpTools"),
    serverId: v.id("mcpServers"),
  },
  returns: v.null(),
  handler: async (ctx, { toolId, serverId }) => {
    console.log(`[Learning] Generating guidance examples for tool ${toolId}`);
    
    // Get successful learning results
    const learningData = await ctx.runQuery(internal.domains.mcp.mcpLearning.getSuccessfulLearningData, {
      toolId,
    });

    if (learningData.length === 0) {
      console.log(`[Learning] No successful learning data found for tool ${toolId}`);
      return;
    }

    // Curate the best examples
    const examples = learningData
      .filter((data: any) => data.qualityScore && data.qualityScore > 0.5)
      .sort((a: any, b: any) => (b.qualityScore || 0) - (a.qualityScore || 0))
      .slice(0, 5) // Take top 5 examples
      .map((data: any) => ({
        query: data.naturalLanguageQuery,
        parameters: data.convertedParameters,
        description: generateExampleDescription(data.naturalLanguageQuery, data.convertedParameters),
        successRate: data.qualityScore,
      }));

    if (examples.length === 0) {
      console.log(`[Learning] No high-quality examples found for tool ${toolId}`);
      return;
    }

    // Deactivate old guidance examples
    await ctx.runMutation(internal.domains.mcp.mcpLearning.deactivateOldGuidanceExamples, {
      toolId,
    });

    // Store new guidance examples
    const now = Date.now();
    await ctx.runMutation(internal.domains.mcp.mcpLearning.storeGuidanceExamples, {
      toolId,
      serverId,
      examples,
      generatedAt: now,
      lastUpdated: now,
      version: 1,
      isActive: true,
    });

    console.log(`[Learning] Generated ${examples.length} guidance examples for tool ${toolId}`);
  },
});

/**
 * Generate a human-readable description for an example
 */
function generateExampleDescription(query: string, parameters: any): string {
  const paramString = Object.entries(parameters)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");
  
  return `"${query}" converts to parameters: ${paramString}`;
}

/**
 * Get successful learning data for a specific tool (internal query for curation)
 */
export const getSuccessfulLearningData = internalQuery({
  args: {
    toolId: v.id("mcpTools"),
  },
  handler: async (ctx, { toolId }) => {
    return await ctx.db
      .query("mcpToolLearning")
      .withIndex("by_tool", (q: any) => q.eq("toolId", toolId))
      .filter((q: any) => q.eq(q.field("executionSuccess"), true))
      .collect();
  },
});

/**
 * Get learning data for a specific tool (used for generating guidance examples)
 */
export const getToolLearningData = query({
  args: {
    toolId: v.id("mcpTools"),
  },
  returns: v.array(v.any()),
  handler: async (ctx, { toolId }): Promise<any[]> => {
    return await ctx.runQuery(internal.domains.mcp.mcpLearning.getSuccessfulLearningData, {
      toolId,
    });
  },
});

/**
 * Deactivate old guidance examples
 */
export const deactivateOldGuidanceExamples = internalMutation({
  args: {
    toolId: v.id("mcpTools"),
  },
  returns: v.null(),
  handler: async (ctx, { toolId }) => {
    const oldExamples = await ctx.db
      .query("mcpGuidanceExamples")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    for (const example of oldExamples) {
      await ctx.db.patch(example._id, { isActive: false });
    }
  },
});

/**
 * Store guidance examples
 */
export const storeGuidanceExamples = internalMutation({
  args: {
    toolId: v.id("mcpTools"),
    serverId: v.id("mcpServers"),
    examples: v.array(v.object({
      query: v.string(),
      parameters: v.any(),
      description: v.string(),
      successRate: v.optional(v.number()),
    })),
    generatedAt: v.number(),
    lastUpdated: v.number(),
    version: v.number(),
    isActive: v.boolean(),
  },
  returns: v.id("mcpGuidanceExamples"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("mcpGuidanceExamples", args);
  },
});

/**
 * Get guidance examples for a tool
 */
export const getGuidanceExamples = query({
  args: {
    toolId: v.id("mcpTools"),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, { toolId }) => {
    return await ctx.db
      .query("mcpGuidanceExamples")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();
  },
});

/**
 * Learn from user interaction with a tool
 */
export const learnFromUserInteraction = internalAction({
  args: {
    toolId: v.id("mcpTools"),
    serverId: v.id("mcpServers"),
    naturalLanguageQuery: v.string(),
    convertedParameters: v.any(),
    executionSuccess: v.boolean(),
    executionResult: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    timingMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Store the user interaction as learning data
    await ctx.runMutation(internal.domains.mcp.mcpLearning.storeLearningResult, {
      ...args,
      learningType: "user_interaction",
      qualityScore: args.executionSuccess ? 0.8 : 0.2, // User interactions get good quality scores
    });

    // If this was a successful interaction, potentially update guidance examples
    if (args.executionSuccess) {
      console.log(`[Learning] Learning from successful user interaction: "${args.naturalLanguageQuery}"`);
      
      // Store the learning result - completed above
      console.log(`[Learning] User interaction learned for tool ${args.toolId}`);
      
      // Trigger guidance update periodically
      console.log(`[Learning] Successful interaction recorded. Consider running guidance curation manually if needed.`);
      
      // Optionally trigger guidance curation (disabled for now to avoid recursion)
      // await ctx.runAction(internal.domains.mcp.mcpLearning.curateGuidanceExamples, {
      //   toolId: args.toolId,
      // });
    }
  },
});
