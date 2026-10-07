"use node";

/**
 * Test action to directly verify Anthropic API connectivity
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

/**
 * Test direct Anthropic API call
 */
export const testAnthropicDirect = action({
  args: {
    prompt: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    text?: string;
    error?: string;
    model: string;
  }> => {
    const prompt = args.prompt || "Say 'HELLO WORLD' and nothing else.";
    const model = args.model || "claude-haiku-4-5";

    console.log(`[testAnthropicDirect] Testing model: ${model}`);
    console.log(`[testAnthropicDirect] Prompt: ${prompt}`);

    try {
      const result = await generateText({
        model: anthropic(model),
        prompt,
        maxOutputTokens: 100,
      });

      console.log(`[testAnthropicDirect] Success! Text: ${result.text}`);
      return {
        success: true,
        text: result.text,
        model,
      };
    } catch (error: any) {
      console.error(`[testAnthropicDirect] Error:`, error);
      return {
        success: false,
        error: error.message || String(error),
        model,
      };
    }
  },
});
