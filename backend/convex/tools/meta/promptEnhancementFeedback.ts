/**
 * Prompt Enhancement Feedback Loop
 *
 * Tracks when dynamic instructions succeeded or failed to trigger tool calls.
 * This creates a learning loop that improves instruction quality over time.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";

/**
 * Records when a tool was expected but not called
 * (Used to strengthen instructions for that tool in future)
 */
export const recordToolCallFailure = internalMutation({
  args: {
    userMessage: v.string(),
    expectedTools: v.array(v.string()),
    actualToolsCalled: v.array(v.string()),
    generatedInstructions: v.optional(v.string()),
    model: v.string(),
    threadId: v.string(),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    const missedTools = args.expectedTools.filter(
      tool => !args.actualToolsCalled.includes(tool)
    );

    if (missedTools.length === 0) return; // All expected tools were called - success!

    // Store failure for learning
    await ctx.db.insert("promptEnhancementFeedback", {
      userMessage: args.userMessage,
      expectedTools: args.expectedTools,
      actualToolsCalled: args.actualToolsCalled,
      missedTools,
      generatedInstructions: args.generatedInstructions,
      model: args.model,
      threadId: args.threadId,
      messageId: args.messageId,
      createdAt: Date.now(),
    });

    console.log(`[PromptFeedback] Recorded failure: expected ${missedTools.join(", ")} but agent called ${args.actualToolsCalled.join(", ") || "nothing"}`);
  },
});

/**
 * Records successful tool call (for positive reinforcement)
 */
export const recordToolCallSuccess = internalMutation({
  args: {
    userMessage: v.string(),
    expectedTools: v.array(v.string()),
    actualToolsCalled: v.array(v.string()),
    generatedInstructions: v.optional(v.string()),
    model: v.string(),
    threadId: v.string(),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("promptEnhancementFeedback", {
      userMessage: args.userMessage,
      expectedTools: args.expectedTools,
      actualToolsCalled: args.actualToolsCalled,
      missedTools: [], // No missed tools - success!
      generatedInstructions: args.generatedInstructions,
      model: args.model,
      threadId: args.threadId,
      messageId: args.messageId,
      wasSuccess: true,
      createdAt: Date.now(),
    });
  },
});

/**
 * Get recent failures for a specific tool
 * (Used by prompt enhancer to strengthen instructions)
 */
export const getRecentFailuresForTool = internalQuery({
  args: {
    toolName: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    userMessage: v.string(),
    actualBehavior: v.string(),
    generatedInstructions: v.optional(v.string()),
    model: v.string(),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;

    const failures = await ctx.db
      .query("promptEnhancementFeedback")
      .filter(q =>
        q.and(
          q.neq(q.field("missedTools"), []),
          q.or(
            ...args.toolName.split(',').map(tool =>
              q.eq(q.field("expectedTools"), tool.trim())
            )
          )
        )
      )
      .order("desc")
      .take(limit);

    return failures.map(f => ({
      userMessage: f.userMessage,
      actualBehavior: f.actualToolsCalled.length
        ? `called ${f.actualToolsCalled.join(", ")} instead`
        : "provided explanation without calling tools",
      generatedInstructions: f.generatedInstructions,
      model: f.model,
      createdAt: f.createdAt,
    }));
  },
});

/**
 * Get success rate for a specific tool
 */
export const getToolSuccessRate = internalQuery({
  args: {
    toolName: v.string(),
    timeWindowMs: v.optional(v.number()), // Default: last 7 days
  },
  returns: v.object({
    successCount: v.number(),
    failureCount: v.number(),
    successRate: v.number(),
    modelBreakdown: v.array(v.object({
      model: v.string(),
      successes: v.number(),
      failures: v.number(),
      rate: v.number(),
    })),
  }),
  handler: async (ctx, args) => {
    const windowMs = args.timeWindowMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
    const cutoff = Date.now() - windowMs;

    const allFeedback = await ctx.db
      .query("promptEnhancementFeedback")
      .filter(q =>
        q.and(
          q.gte(q.field("createdAt"), cutoff),
          q.or(
            ...args.toolName.split(',').map(tool =>
              q.eq(q.field("expectedTools"), tool.trim())
            )
          )
        )
      )
      .collect();

    const successes = allFeedback.filter(f => f.missedTools.length === 0);
    const failures = allFeedback.filter(f => f.missedTools.length > 0);

    // Breakdown by model
    const modelStats = new Map<string, { successes: number; failures: number }>();
    for (const item of allFeedback) {
      if (!modelStats.has(item.model)) {
        modelStats.set(item.model, { successes: 0, failures: 0 });
      }
      const stats = modelStats.get(item.model)!;
      if (item.missedTools.length === 0) {
        stats.successes++;
      } else {
        stats.failures++;
      }
    }

    const modelBreakdown = Array.from(modelStats.entries()).map(([model, stats]) => ({
      model,
      successes: stats.successes,
      failures: stats.failures,
      rate: stats.successes / (stats.successes + stats.failures),
    }));

    return {
      successCount: successes.length,
      failureCount: failures.length,
      successRate: allFeedback.length > 0
        ? successes.length / allFeedback.length
        : 0,
      modelBreakdown,
    };
  },
});

/**
 * Get aggregated insights for improving instructions
 */
export const getInstructionImprovementSuggestions = internalQuery({
  args: {
    toolName: v.string(),
  },
  returns: v.object({
    commonFailurePatterns: v.array(v.string()),
    suggestedImprovements: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get recent failures
    const failures = await ctx.db
      .query("promptEnhancementFeedback")
      .filter(q =>
        q.and(
          q.neq(q.field("missedTools"), []),
          q.or(
            ...args.toolName.split(',').map(tool =>
              q.eq(q.field("expectedTools"), tool.trim())
            )
          )
        )
      )
      .order("desc")
      .take(50);

    if (failures.length === 0) {
      return {
        commonFailurePatterns: [],
        suggestedImprovements: ["No failures detected - current instructions are working well!"],
      };
    }

    // Analyze patterns
    const patterns: string[] = [];
    const improvements: string[] = [];

    // Pattern 1: Agent asks clarifying questions
    const askingQuestions = failures.filter(f =>
      f.userMessage.toLowerCase().includes("build") ||
      f.userMessage.toLowerCase().includes("create")
    );
    if (askingQuestions.length > failures.length * 0.3) {
      patterns.push("Agent frequently asks clarifying questions instead of executing tool");
      improvements.push("Add explicit instruction: 'IMMEDIATELY call the tool - do NOT ask questions first'");
      improvements.push("Provide concrete example showing immediate tool execution");
    }

    // Pattern 2: Agent provides explanations
    const providingExplanations = failures.filter(f =>
      f.actualToolsCalled.length === 0
    );
    if (providingExplanations.length > failures.length * 0.5) {
      patterns.push("Agent provides explanations without calling tools");
      improvements.push("Emphasize: 'Execute tool FIRST, explain AFTER'");
      improvements.push("Add counter-example showing what NOT to do");
    }

    // Pattern 3: Model-specific issues
    const modelFailures = new Map<string, number>();
    failures.forEach(f => {
      modelFailures.set(f.model, (modelFailures.get(f.model) || 0) + 1);
    });
    const worstModel = Array.from(modelFailures.entries())
      .sort((a, b) => b[1] - a[1])[0];
    if (worstModel && worstModel[1] > failures.length * 0.6) {
      patterns.push(`Model ${worstModel[0]} has particularly low success rate`);
      improvements.push(`For ${worstModel[0]}: Use more explicit, step-by-step instructions with multiple examples`);
    }

    return {
      commonFailurePatterns: patterns,
      suggestedImprovements: improvements,
    };
  },
});
