/**
 * Reasoning Tool - Hybrid GLM + Devstral Approach
 *
 * Provides deep reasoning capabilities at ultra-low cost:
 * - GLM 4.7 Flash ($0.07/M) for reasoning with native OpenRouter API
 * - qwen3-coder-free ($0.00) for structuring output
 *
 * Total cost: $0.07/M (98% savings vs claude-sonnet-4 $3.00/M)
 *
 * Use this for:
 * - Complex analysis requiring step-by-step thinking
 * - Task decomposition
 * - Strategic planning
 * - Problem solving with reasoning transparency
 */

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";

/**
 * Reasoning request parameters
 */
export const reasoningRequestSchema = {
  prompt: v.string(), // The question/task requiring reasoning
  systemPrompt: v.optional(v.string()), // Optional system context
  maxTokens: v.optional(v.number()), // Default: 1000
  extractStructured: v.optional(v.boolean()), // Whether to structure output with devstral (default: true)
  returnRaw: v.optional(v.boolean()), // Return raw GLM response without structuring (default: false)
};

/**
 * Reasoning response
 */
export interface ReasoningResponse {
  success: boolean;
  content: string; // Main response content
  reasoning?: string; // Reasoning steps (if available)
  reasoningTokens?: number; // Tokens used for reasoning
  outputTokens?: number; // Tokens used for output (separate from reasoning)
  totalTokens?: number; // Total tokens used
  thinkingSteps?: string[]; // Array of thinking steps for disclosure
  structured?: any; // Structured output if requested
  structuredResponse?: string; // Convenience field for structured content
  response?: string; // Convenience field for raw content
  duration: number; // Total duration in ms
  cost: number; // Estimated cost in USD
  error?: string;
}

/**
 * Get reasoning from GLM 4.7 Flash using native OpenRouter reasoning parameter
 *
 * This uses OpenRouter's native reasoning API which properly supports glm-4.7-flash
 */
export const getReasoning = internalAction({
  args: reasoningRequestSchema,
  handler: async (ctx, args): Promise<ReasoningResponse> => {
    const startTime = Date.now();

    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY not configured");
      }

      const maxTokens = args.maxTokens || 1000;
      const extractStructured = args.extractStructured !== false; // Default true
      const returnRaw = args.returnRaw || false;

      // Build messages array
      const messages: Array<{ role: string; content: string }> = [];
      if (args.systemPrompt) {
        messages.push({ role: "system", content: args.systemPrompt });
      }
      messages.push({ role: "user", content: args.prompt });

      // Call GLM with native reasoning parameter
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "z-ai/glm-4.7-flash",
          messages,
          reasoning: { enabled: true }, // Native OpenRouter reasoning
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenRouter API error: ${JSON.stringify(error)}`);
      }

      const result = await response.json();
      const message = result.choices?.[0]?.message;
      const content = message?.content || "";
      const reasoningDetails = message?.reasoning_details;

      if (!content) {
        throw new Error("GLM returned empty content");
      }

      const glmDuration = Date.now() - startTime;
      const reasoningTokens = result.usage?.reasoning_tokens || 0;
      const totalTokens = result.usage?.total_tokens || 0;
      const outputTokens = totalTokens - reasoningTokens;
      const glmCost = totalTokens * 0.00000007; // $0.07/M tokens

      // Extract thinking steps from reasoningDetails for disclosure
      const thinkingSteps: string[] = [];
      if (reasoningDetails && typeof reasoningDetails === 'object') {
        // Try to extract steps from common reasoning_details formats
        if ('steps' in reasoningDetails && Array.isArray(reasoningDetails.steps)) {
          thinkingSteps.push(...reasoningDetails.steps.map((s: any) => typeof s === 'string' ? s : JSON.stringify(s)));
        } else if ('thoughts' in reasoningDetails && Array.isArray(reasoningDetails.thoughts)) {
          thinkingSteps.push(...reasoningDetails.thoughts.map((t: any) => typeof t === 'string' ? t : JSON.stringify(t)));
        }
      }

      // If returnRaw, return GLM response directly
      if (returnRaw || !extractStructured) {
        return {
          success: true,
          content,
          response: content, // Convenience field
          reasoning: reasoningDetails ? JSON.stringify(reasoningDetails) : undefined,
          reasoningTokens,
          outputTokens,
          totalTokens,
          thinkingSteps,
          duration: glmDuration,
          cost: glmCost,
        };
      }

      // Use Devstral to structure the output (FREE)
      const { generateObject } = await import("ai");
      const { openrouter } = await import("@openrouter/ai-sdk-provider");
      const { z } = await import("zod");

      const devstralModel = openrouter("qwen/qwen3-coder:free");

      // Auto-detect structure based on content
      const schema = z.object({
        mainPoints: z.array(z.string()).describe("Key points or findings"),
        summary: z.string().describe("Concise summary"),
        conclusion: z.string().optional().describe("Final conclusion or recommendation"),
        reasoning: z.string().optional().describe("Reasoning process explanation"),
      });

      const devstralResult = await generateObject({
        model: devstralModel,
        schema,
        prompt: `Extract and structure the key insights from this reasoning:

${content}

Provide a clear, structured summary.`,
      });

      const totalDuration = Date.now() - startTime;
      const structured = devstralResult.object;
      const structuredContent = structured.summary || content;

      return {
        success: true,
        content,
        response: content, // Convenience field
        structuredResponse: structuredContent, // Convenience field for structured content
        reasoning: reasoningDetails ? JSON.stringify(reasoningDetails) : undefined,
        reasoningTokens,
        outputTokens,
        totalTokens,
        thinkingSteps,
        structured,
        duration: totalDuration,
        cost: glmCost, // Devstral is FREE
      };
    } catch (error: any) {
      return {
        success: false,
        content: "",
        duration: Date.now() - startTime,
        cost: 0,
        error: error.message,
      };
    }
  },
});

/**
 * Reasoning tool for complex task decomposition
 *
 * Breaks down complex tasks into parallel execution branches
 */
export const decomposeTask = internalAction({
  args: {
    task: v.string(),
    context: v.optional(v.string()),
    numBranches: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const numBranches = args.numBranches || 5;

    const prompt = `Break down this complex task into ${numBranches} parallel execution branches:

TASK: ${args.task}
${args.context ? `\nCONTEXT: ${args.context}` : ""}

Think deeply about:
1. Which components can be built in parallel
2. Dependencies between branches
3. Critical path and optimal sequencing
4. Risk areas requiring extra attention
5. Estimated complexity for each branch

Provide a detailed decomposition with reasoning for each decision.`;

    const reasoning = await getReasoning(ctx, {
      prompt,
      systemPrompt: "You are an expert software architect specializing in parallel task decomposition.",
      maxTokens: 1500,
      extractStructured: false, // We'll structure it ourselves
    });

    if (!reasoning.success) {
      return {
        success: false,
        error: reasoning.error,
      };
    }

    // Structure with custom schema for task decomposition
    const { generateObject } = await import("ai");
    const { openrouter } = await import("@openrouter/ai-sdk-provider");
    const { z } = await import("zod");

    const devstralModel = openrouter("qwen/qwen3-coder:free");

    const schema = z.object({
      branches: z.array(z.object({
        name: z.string().describe("Branch name"),
        description: z.string().describe("What this branch does"),
        estimatedComplexity: z.enum(["low", "medium", "high"]),
        canStartImmediately: z.boolean(),
        dependsOn: z.array(z.string()).optional().describe("Names of branches this depends on"),
        keyRisks: z.array(z.string()).optional(),
      })),
      criticalPath: z.string().describe("The critical path through the branches"),
      overallStrategy: z.string().describe("High-level execution strategy"),
    });

    const structured = await generateObject({
      model: devstralModel,
      schema,
      prompt: `Extract structured task decomposition from this analysis:\n\n${reasoning.content}`,
    });

    return {
      success: true,
      decomposition: structured.object,
      rawReasoning: reasoning.content,
      reasoningTokens: reasoning.reasoningTokens,
      duration: reasoning.duration,
      cost: reasoning.cost,
    };
  },
});

/**
 * Reasoning tool for strategic analysis
 *
 * Analyzes complex situations with deep reasoning
 */
export const analyzeStrategically = internalAction({
  args: {
    topic: v.string(),
    context: v.optional(v.string()),
    focusAreas: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const focusStr = args.focusAreas ? `\n\nFocus on: ${args.focusAreas.join(", ")}` : "";

    const prompt = `Analyze this topic strategically with deep reasoning:

TOPIC: ${args.topic}
${args.context ? `\nCONTEXT: ${args.context}` : ""}${focusStr}

Think step-by-step about:
1. Key factors and considerations
2. Strengths, weaknesses, opportunities, threats
3. Strategic options and trade-offs
4. Risks and mitigation strategies
5. Recommended approach with reasoning

Provide thorough analysis with clear reasoning for each conclusion.`;

    const reasoning = await getReasoning(ctx, {
      prompt,
      systemPrompt: "You are a strategic analyst providing deep, well-reasoned insights.",
      maxTokens: 1500,
      extractStructured: false,
    });

    if (!reasoning.success) {
      return {
        success: false,
        error: reasoning.error,
      };
    }

    // Structure the analysis
    const { generateObject } = await import("ai");
    const { openrouter } = await import("@openrouter/ai-sdk-provider");
    const { z } = await import("zod");

    const devstralModel = openrouter("qwen/qwen3-coder:free");

    const schema = z.object({
      keyFactors: z.array(z.string()).describe("Key factors identified"),
      strengths: z.array(z.string()),
      weaknesses: z.array(z.string()),
      opportunities: z.array(z.string()),
      threats: z.array(z.string()),
      strategicOptions: z.array(z.object({
        option: z.string(),
        pros: z.array(z.string()),
        cons: z.array(z.string()),
      })),
      recommendation: z.string().describe("Strategic recommendation"),
      reasoning: z.string().describe("Reasoning behind recommendation"),
    });

    const structured = await generateObject({
      model: devstralModel,
      schema,
      prompt: `Extract structured strategic analysis from this reasoning:\n\n${reasoning.content}`,
    });

    return {
      success: true,
      analysis: structured.object,
      rawReasoning: reasoning.content,
      reasoningTokens: reasoning.reasoningTokens,
      duration: reasoning.duration,
      cost: reasoning.cost,
    };
  },
});

/**
 * Test the reasoning tool
 */
export const testReasoningTool = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: Reasoning Tool (GLM + Devstral Hybrid)");
    console.log("=".repeat(80));

    // Test 1: Basic reasoning
    console.log("\n1️⃣  Test: Basic Reasoning");
    const basicTest = await getReasoning(ctx, {
      prompt: "How many r's are in the word 'strawberry'? Think step by step.",
      maxTokens: 500,
    });

    console.log(`   Success: ${basicTest.success}`);
    console.log(`   Content: "${basicTest.content.slice(0, 100)}..."`);
    console.log(`   Reasoning tokens: ${basicTest.reasoningTokens}`);
    console.log(`   Duration: ${(basicTest.duration / 1000).toFixed(2)}s`);
    console.log(`   Cost: $${basicTest.cost.toFixed(6)}`);

    // Test 2: Task decomposition
    console.log("\n2️⃣  Test: Task Decomposition");
    const decompTest = await decomposeTask(ctx, {
      task: "Build a real-time financial dashboard with live market data, user portfolios, and AI-powered insights",
      numBranches: 4,
    });

    console.log(`   Success: ${decompTest.success}`);
    if (decompTest.success) {
      console.log(`   Branches: ${decompTest.decomposition?.branches.length}`);
      decompTest.decomposition?.branches.forEach((b: any, i: number) => {
        console.log(`      ${i + 1}. ${b.name} (${b.estimatedComplexity})`);
      });
      console.log(`   Duration: ${(decompTest.duration! / 1000).toFixed(2)}s`);
      console.log(`   Cost: $${decompTest.cost?.toFixed(6)}`);
    }

    // Test 3: Strategic analysis
    console.log("\n3️⃣  Test: Strategic Analysis");
    const analysisTest = await analyzeStrategically(ctx, {
      topic: "Tesla's competitive position in the EV market",
      focusAreas: ["technology", "brand", "market share", "profitability"],
    });

    console.log(`   Success: ${analysisTest.success}`);
    if (analysisTest.success) {
      console.log(`   Key factors: ${analysisTest.analysis?.keyFactors.length}`);
      console.log(`   Strategic options: ${analysisTest.analysis?.strategicOptions.length}`);
      console.log(`   Recommendation: "${analysisTest.analysis?.recommendation.slice(0, 80)}..."`);
      console.log(`   Duration: ${(analysisTest.duration! / 1000).toFixed(2)}s`);
      console.log(`   Cost: $${analysisTest.cost?.toFixed(6)}`);
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ Reasoning Tool Tests Complete");
    console.log("=".repeat(80));

    return {
      success: true,
      tests: {
        basic: basicTest.success,
        decomposition: decompTest.success,
        analysis: analysisTest.success,
      },
    };
  },
});
