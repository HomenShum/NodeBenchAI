"use node";

/**
 * Native SDK Evaluation Runner
 * 
 * This evaluation runner uses the native OpenAI SDK directly (bypassing both
 * Convex Agent and Vercel AI SDK) to get better visibility into tool calling
 * behavior and compare results with the Vercel AI SDK implementation.
 * 
 * Benefits:
 * - Direct access to tool calls (no abstraction layer)
 * - Better error messages and debugging
 * - Easier to understand what's actually happening
 * - Can compare behavior with Vercel AI SDK
 */

import { action } from "../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

// Import test cases
import { productionTestCases, type ProductionTestCase } from "./productionTestCases";

/**
 * Run a single test case using native OpenAI SDK
 */
async function runTestCaseNative(
  openai: OpenAI,
  testCase: ProductionTestCase
): Promise<{
  success: boolean;
  toolsCalled: string[];
  response: string;
  latencyMs: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    console.log(`[runTestCaseNative] Running test: ${testCase.id}`);
    console.log(`[runTestCaseNative] Query: ${testCase.userQuery}`);

    // Define tools for OpenAI function calling
    // For now, we'll use a minimal set of tools to test the pattern
    const tools: ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "linkupSearch",
          description: "Search the web for information using LinkUp API. Returns articles, news, and web content with URLs and snippets.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query"
              },
              depth: {
                type: "string",
                enum: ["standard", "deep"],
                description: "Search depth: standard (fast) or deep (comprehensive)"
              }
            },
            required: ["query"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "delegateToMediaAgent",
          description: "Delegate to Media Agent for web research, YouTube search, and media gathering",
          parameters: {
            type: "object",
            properties: {
              task: {
                type: "string",
                description: "The research task to delegate"
              }
            },
            required: ["task"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "searchTodaysFunding",
          description: "Search for recent funding announcements and investment news",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Company or sector to search for"
              }
            },
            required: ["query"]
          }
        }
      }
    ];

    // Make the API call with function calling
    const response = await openai.chat.completions.create({
      model: "gpt-5.4",
      messages: [
        {
          role: "system",
          content: "You are a helpful research assistant. Use the available tools to answer user queries."
        },
        {
          role: "user",
          content: testCase.userQuery
        }
      ],
      tools,
      tool_choice: "auto",
    });

    const latencyMs = Date.now() - startTime;

    // Extract tool calls
    const toolsCalled: string[] = [];
    const firstChoice = response.choices[0];

    if (firstChoice?.message?.tool_calls) {
      for (const toolCall of firstChoice.message.tool_calls) {
        // Type guard to check if this is a function tool call
        if (toolCall.type === 'function' && toolCall.function) {
          const toolName = toolCall.function.name;
          if (!toolsCalled.includes(toolName)) {
            toolsCalled.push(toolName);
            console.log(`[runTestCaseNative] ✅ Tool called: ${toolName}`);
          }
        }
      }
    }

    const responseText = firstChoice?.message?.content || "No response generated";

    console.log(`[runTestCaseNative] Test completed in ${latencyMs}ms`);
    console.log(`[runTestCaseNative] Tools called: ${toolsCalled.join(", ")}`);
    console.log(`[runTestCaseNative] Response: ${responseText.substring(0, 200)}`);

    return {
      success: true,
      toolsCalled,
      response: responseText,
      latencyMs,
    };

  } catch (error) {
    const latencyMs = Date.now() - startTime;
    console.error(`[runTestCaseNative] Error:`, error);
    
    return {
      success: false,
      toolsCalled: [],
      response: "",
      latencyMs,
      error: (error as Error).message,
    };
  }
}

/**
 * Run evaluation batch using native OpenAI SDK
 */
export const runBatchNative = action({
  args: {
    testCaseIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    console.log("[runBatchNative] Starting native SDK evaluation");

    // Get OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not found in environment");
    }

    const openai = new OpenAI({ apiKey });

    // Filter test cases if specific IDs provided
    const testCases = args.testCaseIds
      ? productionTestCases.filter(tc => args.testCaseIds!.includes(tc.id))
      : productionTestCases;

    console.log(`[runBatchNative] Running ${testCases.length} test cases`);

    // Run all test cases
    const results: any[] = [];
    for (const testCase of testCases) {
      const result = await runTestCaseNative(openai, testCase);
      results.push({
        testCaseId: testCase.id,
        ...result,
      });
    }

    console.log("[runBatchNative] Evaluation complete");
    console.log(`[runBatchNative] Results: ${JSON.stringify(results, null, 2)}`);

    return {
      success: true,
      totalTests: results.length,
      results,
    };
  },
});
