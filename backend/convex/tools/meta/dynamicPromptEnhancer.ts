/**
 * Dynamic Prompt Enhancer - Meta-Cognitive Tool Instruction Generator
 *
 * Instead of hardcoded tool instructions, this uses a fast LLM to:
 * 1. Analyze user intent
 * 2. Detect which tools are relevant
 * 3. Generate context-specific instructions for those tools
 *
 * Benefits:
 * - No prompt bloat with instructions for tools that won't be used
 * - Adapts to new tools automatically via tool discovery
 * - Can strengthen instructions based on past failures
 * - Model-specific instruction styles (smaller models get more explicit guidance)
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { generateText } from "ai";
import { getLanguageModelSafe } from "../../domains/agents/mcp_tools/models";

/**
 * Analyzes user message and generates dynamic tool-calling instructions
 *
 * Enhanced version with:
 * 1. Progressive disclosure tool discovery (Claude MCP pattern)
 * 2. Codebase context injection (Augment Code pattern)
 * 3. Model-adaptive instruction generation
 * 4. Learning from past failures
 */
export const enhancePromptWithToolInstructions = internalAction({
  args: {
    userMessage: v.string(),
    targetModel: v.string(),

    // Progressive disclosure: Use tool registry instead of hardcoded list
    useToolDiscovery: v.optional(v.boolean()), // Default: true if no availableTools provided
    toolCategory: v.optional(v.string()), // Filter tools by category

    // Legacy: Direct tool list (skips progressive disclosure)
    availableTools: v.optional(v.array(v.object({
      name: v.string(),
      description: v.string(),
      category: v.optional(v.string()),
    }))),

    // Context enhancement
    userId: v.optional(v.id("users")),
    projectId: v.optional(v.string()),

    conversationHistory: v.optional(v.array(v.object({
      role: v.string(),
      content: v.string(),
    }))),

    // Learning signals
    recentFailures: v.optional(v.array(v.object({
      expectedTool: v.string(),
      actualBehavior: v.string(),
    }))),
  },
  returns: v.object({
    enhancedInstructions: v.string(),
    detectedIntent: v.string(),
    relevantTools: v.array(v.string()),
    confidence: v.number(),
    metadata: v.optional(v.object({
      usedProgressiveDisclosure: v.boolean(),
      usedCodebaseContext: v.boolean(),
      tokenSavings: v.optional(v.string()),
    })),
  }),
  handler: async (ctx, args) => {
    const metaModel = getLanguageModelSafe("claude-haiku-4.5");
    let metadata = {
      usedProgressiveDisclosure: false,
      usedCodebaseContext: false,
      tokenSavings: undefined as string | undefined,
    };

    // PHASE 1: Progressive Disclosure Tool Discovery
    let toolContext = "";
    let discoveredTools: Array<{ name: string; description: string; category: string }> = [];

    if (args.availableTools) {
      // Legacy path: Use provided tools directly
      toolContext = `Available tools:\n${args.availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}`;
      discoveredTools = args.availableTools.map(t => ({
        name: t.name,
        description: t.description,
        category: t.category || "general",
      }));
    } else if (args.useToolDiscovery !== false) {
      // Progressive disclosure path
      try {
        const discovery = await ctx.runAction(
          internal.tools.meta.toolDiscovery.discoverRelevantTools,
          {
            userMessage: args.userMessage,
            category: args.toolCategory,
            maxTools: 5,
            conversationHistory: args.conversationHistory,
          }
        );

        if (discovery.relevantTools.length > 0) {
          toolContext = `Relevant tools (discovered via progressive disclosure):\n${discovery.relevantTools.map(t =>
            `- ${t.name} (${t.category}): ${t.description}\n  Relevance: ${t.reasonForSelection} (score: ${(t.relevanceScore * 100).toFixed(0)}%)`
          ).join('\n\n')}`;

          discoveredTools = discovery.relevantTools;
          metadata.usedProgressiveDisclosure = true;
          metadata.tokenSavings = discovery.tokensUsed.totalSavings;

          console.log(`[enhancePrompt] Progressive disclosure: ${discovery.relevantTools.length} tools discovered, ${discovery.tokensUsed.totalSavings} savings`);
        }
      } catch (error) {
        console.warn("[enhancePrompt] Progressive disclosure failed, continuing without tools:", error);
      }
    }

    // PHASE 2: Codebase Context Enhancement
    let codebaseContext = "";
    let relevantConventions: Array<{ pattern: string; relevance: string }> = [];

    if (args.userId) {
      try {
        const contextEnhancement = await ctx.runAction(
          internal.tools.meta.contextEnhancementActions.enhanceWithCodebaseContext,
          {
            userMessage: args.userMessage,
            userId: args.userId,
            projectId: args.projectId,
          }
        );

        if (contextEnhancement.hasContext) {
          codebaseContext = contextEnhancement.contextSummary;
          metadata.usedCodebaseContext = true;

          // Detect which conventions are relevant
          if (contextEnhancement.recentPatterns.length > 0) {
            const conventions = await ctx.runAction(
              internal.tools.meta.contextEnhancementActions.detectRelevantConventions,
              {
                userMessage: args.userMessage,
                availablePatterns: contextEnhancement.recentPatterns,
                techStack: contextEnhancement.techStack,
              }
            );
            relevantConventions = conventions.relevantPatterns;
          }

          console.log(`[enhancePrompt] Codebase context injected: ${contextEnhancement.techStack.join(", ")}`);
        }
      } catch (error) {
        console.warn("[enhancePrompt] Context enhancement failed, continuing without context:", error);
      }
    }

    // PHASE 3: Build failure context
    const failureContext = args.recentFailures?.length
      ? `\nRecent failures (strengthen instructions for these):\n${args.recentFailures.map(f =>
          `- Expected ${f.expectedTool}, but agent ${f.actualBehavior}`
        ).join('\n')}`
      : "";

    const conversationContext = args.conversationHistory?.length
      ? `\nRecent conversation:\n${args.conversationHistory.slice(-3).map(m =>
          `${m.role}: ${m.content}`
        ).join('\n')}`
      : "";

    // PHASE 4: Build conventions context
    const conventionsContext = relevantConventions.length > 0
      ? `\nRelevant Project Conventions:\n${relevantConventions.map(c =>
          `- ${c.pattern}\n  Why relevant: ${c.relevance}`
        ).join('\n')}`
      : "";

    // PHASE 5: Generate enhanced instructions
    const metaPrompt = `You are a prompt engineering expert. Analyze this user request and generate SPECIFIC, ACTIONABLE tool-calling instructions.

User message: "${args.userMessage}"

${codebaseContext}

${toolContext}
${conversationContext}
${failureContext}
${conventionsContext}

Target model: ${args.targetModel}
Model characteristics:
- If "nano" or "free" in name: Needs VERY explicit, step-by-step instructions with examples
- If "mini" in name: Needs clear instructions with examples
- If "sonnet" or "opus": Can follow general guidelines
- If "haiku": Balance between explicit and concise

Your task:
1. Detect the user's primary intent
2. Identify which 1-3 tools are most relevant (from the discovered tools above)
3. Generate SPECIFIC instructions that:
   - Tell the agent WHEN to call each tool
   - Provide concrete examples using the user's actual request
   - Emphasize immediate execution (no clarifying questions first)
   - Reference project conventions when relevant
   - Are tailored to the target model's capability level

Format as JSON:
{
  "detectedIntent": "intent_category",
  "relevantTools": ["tool1", "tool2"],
  "confidence": 0.95,
  "instructions": "# SPECIFIC TOOL USAGE FOR THIS REQUEST\n\n[Your instructions]\n\nExample:\nUser: [actual user message]\nAgent: [immediately calls tool] [response]\n\nWRONG:\nAgent: [asks questions before calling tool] ❌"
}

Make instructions CONCRETE and reference the actual context provided above.`;

    try {
      const result = await generateText({
        model: metaModel,
        prompt: metaPrompt,
        temperature: 0.3,
        maxRetries: 2,
      });

      const parsed = JSON.parse(result.text.trim());

      return {
        enhancedInstructions: parsed.instructions,
        detectedIntent: parsed.detectedIntent,
        relevantTools: parsed.relevantTools || discoveredTools.map(t => t.name),
        confidence: parsed.confidence || 0.5,
        metadata,
      };
    } catch (error) {
      console.error("[dynamicPromptEnhancer] Failed to generate instructions:", error);

      return {
        enhancedInstructions: "Use available tools when appropriate. Execute tools immediately without asking clarifying questions first.",
        detectedIntent: "unknown",
        relevantTools: [],
        confidence: 0.0,
        metadata,
      };
    }
  },
});

/**
 * Simplified version for fast intent detection only
 * (useful when you just need to know which tools to expect)
 */
export const detectIntentAndTools = internalAction({
  args: {
    userMessage: v.string(),
    availableTools: v.array(v.object({
      name: v.string(),
      description: v.string(),
    })),
  },
  returns: v.object({
    intent: v.string(),
    expectedTools: v.array(v.string()),
    confidence: v.number(),
  }),
  handler: async (ctx, args) => {
    const metaModel = getLanguageModelSafe("gemini-3-flash-preview"); // Use fastest model

    const toolList = args.availableTools
      .map(t => `- ${t.name}: ${t.description}`)
      .join('\n');

    const prompt = `Analyze this user request and predict which tools should be called.

User: "${args.userMessage}"

Available tools:
${toolList}

Respond with JSON:
{
  "intent": "category (e.g., dcf_valuation, research, document_query)",
  "expectedTools": ["tool1", "tool2"],
  "confidence": 0.95
}`;

    try {
      const result = await generateText({
        model: metaModel,
        prompt,
        temperature: 0.2,
        maxRetries: 2,
      });

      const parsed = JSON.parse(result.text.trim());
      return {
        intent: parsed.intent || "unknown",
        expectedTools: parsed.expectedTools || [],
        confidence: parsed.confidence || 0.5,
      };
    } catch (error) {
      console.error("[detectIntentAndTools] Failed:", error);
      return {
        intent: "unknown",
        expectedTools: [],
        confidence: 0.0,
      };
    }
  },
});

/**
 * Tool-specific instruction templates
 * (Used as fallback or for rapid prototyping)
 */
export const TOOL_INSTRUCTION_TEMPLATES = {
  createDCFSpreadsheet: {
    detect: (msg: string) =>
      /\b(dcf|valuation|value|model|financial analysis|fair value)\b/i.test(msg) &&
      /\b(build|create|generate|make|calculate)\b/i.test(msg),

    generateInstructions: (ticker?: string, scenario?: string) => `
# DCF TOOL - IMMEDIATE EXECUTION REQUIRED

CRITICAL: User wants a DCF model. Execute createDCFSpreadsheet IMMEDIATELY.

**Correct behavior:**
1. Call createDCFSpreadsheet(ticker="${ticker || '[EXTRACT_FROM_MESSAGE]'}", scenario="${scenario || 'base'}")
2. THEN present the spreadsheet link
3. THEN optionally explain methodology

**Example:**
User: "Build a DCF for ${ticker || 'NVDA'}"
Agent: [calls createDCFSpreadsheet immediately] "I've created a DCF model: [link]"

**WRONG (do NOT do this):**
Agent: "I can help! First, let me ask: do you want FCFF or FCFE?" ❌
Agent: "What forecast horizon would you like?" ❌

Rule: EXECUTE FIRST, EXPLAIN AFTER.
`,
  },

  // Add more tool-specific templates as needed
  searchSecFilings: {
    detect: (msg: string) =>
      /\b(10-k|10-q|sec|edgar|filing|s-1|8-k)\b/i.test(msg),

    generateInstructions: (ticker?: string) => `
# SEC FILING TOOL - IMMEDIATE EXECUTION

User needs SEC filings. Call searchSecFilings immediately.

Correct: [calls searchSecFilings(ticker="${ticker || '[DETECT]'}")] then present results
Wrong: "Would you like 10-K or 10-Q?" ❌ (just get both)
`,
  },
};
