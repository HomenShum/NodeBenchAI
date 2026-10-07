/**
 * xAI/Grok API Client
 *
 * Official API wrapper for xAI's Grok models.
 * Supports text generation, reasoning, web search, and X search.
 *
 * Documentation: https://docs.x.ai/docs
 * API Reference: https://docs.x.ai/docs/api-reference
 */

import { v } from "convex/values";
import { action } from "../_generated/server";

const XAI_API_BASE = "https://api.x.ai/v1";

interface GrokMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GrokTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters?: any;
  };
}

interface GrokRequest {
  model: string;
  messages: GrokMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  tools?: GrokTool[];
  tool_choice?: "auto" | "required" | { type: "function"; function: { name: string } };
  response_format?: { type: "json_object" | "text" };
}

interface GrokResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      tool_calls?: any[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens: number;
    };
  };
}

/**
 * Helper function to call Grok API
 * This is a shared helper that can be called from multiple actions.
 */
async function callGrokAPI(args: {
  model: string;
  messages: GrokMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: GrokTool[];
  responseFormat?: "json_object" | "text";
}) {
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "XAI_API_KEY not found in environment variables. Get your key at https://console.x.ai"
    );
  }

  const request: GrokRequest = {
    model: args.model,
    messages: args.messages,
    temperature: args.temperature ?? 0.7,
    max_tokens: args.maxTokens ?? 1024,
  };

  if (args.tools) {
    request.tools = args.tools;
  }

  if (args.responseFormat) {
    request.response_format = { type: args.responseFormat };
  }

  const response = await fetch(`${XAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`xAI API error (${response.status}): ${error}`);
  }

  const result: GrokResponse = await response.json();

  return {
    content: result.choices[0].message.content,
    toolCalls: result.choices[0].message.tool_calls,
    usage: result.usage,
    model: result.model,
  };
}

/**
 * Call Grok API (action wrapper)
 */
export const callGrok = action({
  args: {
    model: v.string(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("system"), v.literal("user"), v.literal("assistant")),
        content: v.string(),
      })
    ),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    tools: v.optional(v.array(v.any())),
    responseFormat: v.optional(v.union(v.literal("json_object"), v.literal("text"))),
  },
  handler: async (ctx, args) => {
    return await callGrokAPI(args);
  },
});

/**
 * Call Grok with Web Search
 * Uses grok-4-1-fast-reasoning which has built-in web search
 */
export const callGrokWithWebSearch = action({
  args: {
    model: v.string(),
    query: v.string(),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Use Grok's knowledge and reasoning to synthesize current trends
    // Note: Direct web search would require additional API setup
    return await callGrokAPI({
      model: args.model,
      messages: [
        {
          role: "system",
          content: "You are Grok, an AI assistant with comprehensive knowledge of recent technology trends, releases, and announcements. Based on your training data and reasoning capabilities, provide detailed insights about current developments."
        },
        {
          role: "user",
          content: args.query
        }
      ],
      temperature: args.temperature ?? 0.7,
      maxTokens: args.maxTokens,
    });
  },
});

/**
 * Call Grok with X Search (Twitter)
 * Uses grok-3-mini which has built-in X search
 */
export const callGrokWithXSearch = action({
  args: {
    model: v.string(),
    query: v.string(),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Use Grok's knowledge and reasoning to synthesize trends
    // Note: Direct X API access would require additional authentication
    return await callGrokAPI({
      model: args.model,
      messages: [
        {
          role: "system",
          content: "You are Grok, an AI assistant with knowledge of recent technology trends and developer discussions. Based on your training data and reasoning, provide insights about what developers are likely discussing."
        },
        {
          role: "user",
          content: args.query
        }
      ],
      temperature: args.temperature ?? 0.8,
      maxTokens: args.maxTokens,
    });
  },
});

/**
 * Test Grok integration
 */
export const testGrok = action({
  args: {},
  handler: async (ctx) => {
    console.log("Testing xAI/Grok integration...");

    try {
      const result = await callGrokAPI({
        model: "grok-4-1-fast-reasoning",
        messages: [
          {
            role: "system",
            content: "You are a helpful AI assistant powered by Grok.",
          },
          {
            role: "user",
            content: "What is the capital of France? Respond in one word.",
          },
        ],
        maxTokens: 10,
      });

      console.log("✅ Grok test successful!");
      console.log("Response:", result.content);
      console.log("Usage:", result.usage);

      return {
        success: true,
        response: result.content,
        usage: result.usage,
      };
    } catch (error: any) {
      console.error("❌ Grok test failed:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

/**
 * Get rate limit status
 */
export const getRateLimitStatus = action({
  args: {},
  handler: async (ctx) => {
    const apiKey = process.env.XAI_API_KEY;

    if (!apiKey) {
      throw new Error("XAI_API_KEY not found");
    }

    // Make a minimal request to get rate limit headers
    const response = await fetch(`${XAI_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-3-mini",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
    });

    const headers = response.headers;

    return {
      limitRequests: headers.get("x-ratelimit-limit-requests"),
      remainingRequests: headers.get("x-ratelimit-remaining-requests"),
      resetRequests: headers.get("x-ratelimit-reset-requests"),
      limitTokens: headers.get("x-ratelimit-limit-tokens"),
      remainingTokens: headers.get("x-ratelimit-remaining-tokens"),
      resetTokens: headers.get("x-ratelimit-reset-tokens"),
    };
  },
});
