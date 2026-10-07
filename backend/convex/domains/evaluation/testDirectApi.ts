"use node";

/**
 * Direct API Test Actions
 *
 * Tests the AI SDK providers directly (without @convex-dev/agent)
 * to isolate whether the issue is in the SDK or the Agent component.
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { generateText, streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

type Provider = "openai" | "anthropic" | "google";

interface TestResult {
  model: string;
  provider: Provider;
  sdkId: string;
  method: "generateText" | "streamText";
  success: boolean;
  text?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
}

function getModel(provider: Provider, sdkId: string) {
  switch (provider) {
    case "openai":
      return openai(sdkId);
    case "anthropic":
      return anthropic(sdkId);
    case "google": {
      const apiKey =
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        process.env.GOOGLE_AI_API_KEY ||
        process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "Google API key is missing. Set GOOGLE_GENERATIVE_AI_API_KEY, GOOGLE_AI_API_KEY, or GEMINI_API_KEY.",
        );
      }
      return createGoogleGenerativeAI({ apiKey })(sdkId);
    }
  }
}

/**
 * Test generateText directly (no Agent SDK)
 */
export const testGenerateText = action({
  args: {
    model: v.string(),
    prompt: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<TestResult> => {
    const prompt = args.prompt || "Say exactly: HELLO FROM DIRECT API";

    // Use shared modelMap
    const spec = modelMap[args.model];
    if (!spec) {
      return {
        model: args.model,
        provider: "openai",
        sdkId: "unknown",
        method: "generateText",
        success: false,
        error: `Unknown model: ${args.model}`,
        latencyMs: 0,
      };
    }

    const start = Date.now();

    try {
      console.log(`[testGenerateText] Testing ${args.model} (${spec.sdkId}) via ${spec.provider}`);

      const result = await generateText({
        model: getModel(spec.provider, spec.sdkId),
        prompt,
        maxOutputTokens: 100,
      });

      const latencyMs = Date.now() - start;
      const usage = result.usage as any;

      console.log(`[testGenerateText] ✅ ${args.model}: "${result.text}" (${latencyMs}ms)`);
      console.log(`[testGenerateText] Tokens: in=${usage?.promptTokens ?? usage?.inputTokens ?? 0}, out=${usage?.completionTokens ?? usage?.outputTokens ?? 0}`);

      return {
        model: args.model,
        provider: spec.provider,
        sdkId: spec.sdkId,
        method: "generateText",
        success: true,
        text: result.text,
        inputTokens: usage?.promptTokens ?? usage?.inputTokens,
        outputTokens: usage?.completionTokens ?? usage?.outputTokens,
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - start;
      console.error(`[testGenerateText] ❌ ${args.model}: ${error.message}`);
      console.error(`[testGenerateText] Full error:`, error);

      return {
        model: args.model,
        provider: spec.provider,
        sdkId: spec.sdkId,
        method: "generateText",
        success: false,
        error: error.message,
        latencyMs,
      };
    }
  },
});

/**
 * Test streamText directly (no Agent SDK)
 */
export const testStreamText = action({
  args: {
    model: v.string(),
    prompt: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<TestResult> => {
    const prompt = args.prompt || "Say exactly: STREAMING FROM DIRECT API";

    // Use shared modelMap
    const spec = modelMap[args.model];
    if (!spec) {
      return {
        model: args.model,
        provider: "openai",
        sdkId: "unknown",
        method: "streamText",
        success: false,
        error: `Unknown model: ${args.model}`,
        latencyMs: 0,
      };
    }

    const start = Date.now();

    try {
      console.log(`[testStreamText] Testing ${args.model} (${spec.sdkId}) via ${spec.provider}`);

      const result = await streamText({
        model: getModel(spec.provider, spec.sdkId),
        prompt,
        maxOutputTokens: 100,
      });

      let fullText = "";
      for await (const delta of result.textStream) {
        fullText += delta;
      }

      const latencyMs = Date.now() - start;
      const usage = (await result.usage) as any;

      console.log(`[testStreamText] ✅ ${args.model}: "${fullText}" (${latencyMs}ms)`);
      console.log(`[testStreamText] Tokens: in=${usage?.promptTokens ?? usage?.inputTokens ?? 0}, out=${usage?.completionTokens ?? usage?.outputTokens ?? 0}`);

      return {
        model: args.model,
        provider: spec.provider,
        sdkId: spec.sdkId,
        method: "streamText",
        success: true,
        text: fullText,
        inputTokens: usage?.promptTokens ?? usage?.inputTokens,
        outputTokens: usage?.completionTokens ?? usage?.outputTokens,
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - start;
      console.error(`[testStreamText] ❌ ${args.model}: ${error.message}`);
      console.error(`[testStreamText] Full error:`, error);

      return {
        model: args.model,
        provider: spec.provider,
        sdkId: spec.sdkId,
        method: "streamText",
        success: false,
        error: error.message,
        latencyMs,
      };
    }
  },
});

// Internal implementations for testAllModels
const modelMap: Record<string, { provider: Provider; sdkId: string }> = {
  "gpt-5.4": { provider: "openai", sdkId: "gpt-5.4" },
  "gpt-5.4-mini": { provider: "openai", sdkId: "gpt-5.4-mini" },
  "claude-haiku-4.5": { provider: "anthropic", sdkId: "claude-haiku-4-5" },
  "claude-sonnet-4.6": { provider: "anthropic", sdkId: "claude-sonnet-4-6" },
  "claude-opus-4.7": { provider: "anthropic", sdkId: "claude-opus-4-7" },
  "gemini-3-flash-preview": { provider: "google", sdkId: "gemini-3-flash-preview" },
  "gemini-3.1-pro-preview": { provider: "google", sdkId: "gemini-3.1-pro-preview" },
};

async function testGenerateTextInternal(model: string): Promise<TestResult> {
  const spec = modelMap[model];
  if (!spec) {
    return {
      model,
      provider: "openai",
      sdkId: "unknown",
      method: "generateText",
      success: false,
      error: `Unknown model: ${model}`,
      latencyMs: 0,
    };
  }

  const start = Date.now();
  try {
    const result = await generateText({
      model: getModel(spec.provider, spec.sdkId),
      prompt: "Say exactly: HELLO FROM DIRECT API",
      maxOutputTokens: 100,
    });
    const latencyMs = Date.now() - start;
    const usage = result.usage as any;

    return {
      model,
      provider: spec.provider,
      sdkId: spec.sdkId,
      method: "generateText",
      success: true,
      text: result.text,
      inputTokens: usage?.promptTokens ?? usage?.inputTokens,
      outputTokens: usage?.completionTokens ?? usage?.outputTokens,
      latencyMs,
    };
  } catch (error: any) {
    return {
      model,
      provider: spec.provider,
      sdkId: spec.sdkId,
      method: "generateText",
      success: false,
      error: error.message,
      latencyMs: Date.now() - start,
    };
  }
}

async function testStreamTextInternal(model: string): Promise<TestResult> {
  const spec = modelMap[model];
  if (!spec) {
    return {
      model,
      provider: "openai",
      sdkId: "unknown",
      method: "streamText",
      success: false,
      error: `Unknown model: ${model}`,
      latencyMs: 0,
    };
  }

  const start = Date.now();
  try {
    const result = await streamText({
      model: getModel(spec.provider, spec.sdkId),
      prompt: "Say exactly: STREAMING FROM DIRECT API",
      maxOutputTokens: 100,
    });

    let fullText = "";
    for await (const delta of result.textStream) {
      fullText += delta;
    }

    const latencyMs = Date.now() - start;
    const usage = (await result.usage) as any;

    return {
      model,
      provider: spec.provider,
      sdkId: spec.sdkId,
      method: "streamText",
      success: true,
      text: fullText,
      inputTokens: usage?.promptTokens ?? usage?.inputTokens,
      outputTokens: usage?.completionTokens ?? usage?.outputTokens,
      latencyMs,
    };
  } catch (error: any) {
    return {
      model,
      provider: spec.provider,
      sdkId: spec.sdkId,
      method: "streamText",
      success: false,
      error: error.message,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * Test a raw SDK model ID (for discovering valid model names)
 */
export const testRawSdkId = action({
  args: {
    provider: v.union(v.literal("openai"), v.literal("anthropic"), v.literal("google")),
    sdkId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<TestResult> => {
    const start = Date.now();

    try {
      console.log(`[testRawSdkId] Testing ${args.sdkId} via ${args.provider}`);

      const result = await generateText({
        model: getModel(args.provider, args.sdkId),
        prompt: "Say exactly: OK",
        maxOutputTokens: 20,
      });

      const latencyMs = Date.now() - start;
      const usage = result.usage as any;

      console.log(`[testRawSdkId] ✅ ${args.sdkId}: "${result.text}" (${latencyMs}ms)`);

      return {
        model: args.sdkId,
        provider: args.provider,
        sdkId: args.sdkId,
        method: "generateText",
        success: true,
        text: result.text,
        inputTokens: usage?.promptTokens ?? usage?.inputTokens,
        outputTokens: usage?.completionTokens ?? usage?.outputTokens,
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - start;
      console.error(`[testRawSdkId] ❌ ${args.sdkId}: ${error.message}`);

      return {
        model: args.sdkId,
        provider: args.provider,
        sdkId: args.sdkId,
        method: "generateText",
        success: false,
        error: error.message,
        latencyMs,
      };
    }
  },
});

/**
 * Test all models at once
 */
export const testAllModels = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<{
    generateResults: TestResult[];
    streamResults: TestResult[];
    summary: { passed: number; failed: number; total: number };
  }> => {
    const models = [
      "gpt-5.4",
        "claude-haiku-4.5",
      "gemini-3-flash-preview",
    ];

    const generateResults: TestResult[] = [];
    const streamResults: TestResult[] = [];

    for (const model of models) {
      // Test generateText
      const genResult = await testGenerateTextInternal(model);
      generateResults.push(genResult);

      // Small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 500));

      // Test streamText
      const streamResult = await testStreamTextInternal(model);
      streamResults.push(streamResult);

      // Small delay between models
      await new Promise((r) => setTimeout(r, 500));
    }

    const allResults = [...generateResults, ...streamResults];
    const passed = allResults.filter((r) => r.success).length;

    return {
      generateResults,
      streamResults,
      summary: {
        passed,
        failed: allResults.length - passed,
        total: allResults.length,
      },
    };
  },
});
