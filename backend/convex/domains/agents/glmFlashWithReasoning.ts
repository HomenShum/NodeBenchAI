/**
 * GLM 4.7 Flash with Reasoning Extraction
 *
 * Based on Vercel AI SDK documentation for reasoning models:
 * - https://ai-sdk.dev/docs/reference/ai-sdk-core/extract-reasoning-middleware
 * - https://ai-sdk.dev/cookbook/guides/r1
 *
 * GLM 4.7 Flash is a reasoning model that returns thinking steps separately.
 * We use extractReasoningMiddleware to extract and expose the reasoning.
 */

import { internalAction } from "../../_generated/server";
import { generateText, wrapLanguageModel, extractReasoningMiddleware } from "ai";
import { getLanguageModelSafe } from "./mcp_tools/models";

/**
 * Test glm-4.7-flash with reasoning extraction middleware
 * Try different XML tag names that GLM might use
 */
export const testGlmWithReasoningExtraction = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: glm-4.7-flash with Reasoning Extraction Middleware");
    console.log("=".repeat(80));

    const tagsToTry = [
      "think",      // Used by DeepSeek R1 via Fireworks/Groq
      "thinking",   // Common alternative
      "reasoning",  // Another common tag
      "thought",    // Alternative
    ];

    const results: Array<{
      tagName: string;
      working: boolean | string;
      textLength?: number;
      hasReasoning?: any;
      duration?: number;
      error?: any;
    }> = [];

    for (const tagName of tagsToTry) {
      console.log(`\n${"─".repeat(80)}`);
      console.log(`Testing with tag: <${tagName}>`);
      console.log("─".repeat(80));

      try {
        const baseModel = getLanguageModelSafe("glm-4.7-flash") as any;

        // Wrap model with reasoning extraction middleware
        const enhancedModel = wrapLanguageModel({
          model: baseModel as any,
          middleware: extractReasoningMiddleware({
            tagName,
            separator: "\n",
          }),
        });

        const startTime = Date.now();

        const result = await generateText({
          model: enhancedModel,
          prompt: "Say exactly: Hello World",
        });

        const duration = Date.now() - startTime;

        // Check both text and reasoningText properties
        const hasText = result.text && result.text.length > 0;
        const hasReasoning = (result as any).reasoningText && (result as any).reasoningText.length > 0;

        console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
        console.log(`Text: "${result.text}" (${result.text.length} chars)`);
        console.log(`Reasoning: ${hasReasoning ? `"${(result as any).reasoningText.slice(0, 100)}..."` : "none"}`);
        console.log(`Status: ${hasText ? "✅ WORKING" : "❌ EMPTY TEXT"}`);

        results.push({
          tagName,
          working: hasText,
          textLength: result.text.length,
          hasReasoning,
          duration,
        });

        if (hasText) {
          console.log(`\n✅ SUCCESS with tag <${tagName}>!`);
          break; // Found working tag
        }
      } catch (error: any) {
        console.log(`❌ ERROR: ${error.message}`);
        results.push({
          tagName,
          working: false,
          error: error.message,
        });
      }
    }

    console.log("\n" + "=".repeat(80));
    console.log("📊 SUMMARY");
    console.log("=".repeat(80));

    const workingTags = results.filter((r) => r.working);
    if (workingTags.length > 0) {
      console.log(`\n✅ Working tag: <${workingTags[0].tagName}>`);
      console.log(`   Text length: ${workingTags[0].textLength} chars`);
      console.log(`   Has reasoning: ${workingTags[0].hasReasoning ? "Yes" : "No"}`);
      console.log(`   Duration: ${(workingTags[0].duration! / 1000).toFixed(2)}s`);
    } else {
      console.log("\n❌ No working XML tags found");
      console.log("   GLM 4.7 Flash may use a different format or not expose reasoning via XML");
    }

    return {
      success: true,
      results,
      workingTag: workingTags[0]?.tagName,
    };
  },
});

/**
 * Test glm-4.7-flash with startWithReasoning option
 * Some models (like Together.ai) start responses with reasoning but omit the opening tag
 */
export const testGlmStartWithReasoning = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: glm-4.7-flash with startWithReasoning Option");
    console.log("=".repeat(80));

    try {
      const baseModel = getLanguageModelSafe("glm-4.7-flash") as any;

      const enhancedModel = wrapLanguageModel({
        model: baseModel as any,
        middleware: extractReasoningMiddleware({
          tagName: "think",
          startWithReasoning: true, // Assume response starts with reasoning
          separator: "\n",
        }),
      });

      const startTime = Date.now();

      const result = await generateText({
        model: enhancedModel,
        prompt: "Say exactly: Hello World",
      });

      const duration = Date.now() - startTime;
      const fullResult = result as any;

      console.log(`\nDuration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`Text: "${result.text}" (${result.text.length} chars)`);
      console.log(`Reasoning text: ${fullResult.reasoningText ? `${fullResult.reasoningText.length} chars` : "none"}`);

      if (result.text.length > 0) {
        console.log("\n✅ SUCCESS with startWithReasoning option!");
        console.log(`   Final text: "${result.text}"`);
        if (fullResult.reasoningText) {
          console.log(`   Reasoning preview: "${fullResult.reasoningText.slice(0, 100)}..."`);
        }
      } else {
        console.log("\n❌ Still empty with startWithReasoning option");
      }

      return {
        success: true,
        working: result.text.length > 0,
        textLength: result.text.length,
        hasReasoning: !!fullResult.reasoningText,
        duration,
      };
    } catch (error: any) {
      console.error("❌ ERROR:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

/**
 * Check if GLM natively exposes reasoning (like DeepSeek Direct does)
 */
export const testGlmNativeReasoning = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: glm-4.7-flash Native Reasoning Support");
    console.log("=".repeat(80));

    try {
      const model = getLanguageModelSafe("glm-4.7-flash");
      const startTime = Date.now();

      const result = await generateText({
        model,
        prompt: "Say exactly: Hello World",
      });

      const duration = Date.now() - startTime;
      const fullResult = result as any;

      console.log(`\nDuration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`Text: "${result.text}" (${result.text.length} chars)`);

      // Check for reasoning-related properties
      const reasoningProps = [
        "reasoning",
        "reasoningText",
        "steps",
        "resolvedOutput",
        "thinkingContent",
        "internalReasoning",
      ];

      console.log("\n🔍 Checking for reasoning properties:");
      let foundReasoning = false;
      for (const prop of reasoningProps) {
        if (fullResult[prop]) {
          console.log(`   ✅ Found: ${prop}`);
          console.log(`      Type: ${typeof fullResult[prop]}`);
          console.log(`      Value: ${JSON.stringify(fullResult[prop]).slice(0, 200)}...`);
          foundReasoning = true;
        }
      }

      if (!foundReasoning) {
        console.log("   ❌ No reasoning properties found");
        console.log(`   Available keys: ${Object.keys(fullResult).join(", ")}`);
      }

      // Check if steps contain the actual response
      if (fullResult.steps && Array.isArray(fullResult.steps)) {
        console.log(`\n📝 Steps array found with ${fullResult.steps.length} items`);
        fullResult.steps.forEach((step: any, i: number) => {
          console.log(`   Step ${i + 1}: ${JSON.stringify(step).slice(0, 150)}...`);
        });
      }

      return {
        success: true,
        textEmpty: result.text.length === 0,
        foundReasoningProps: foundReasoning,
        availableKeys: Object.keys(fullResult),
        stepsCount: fullResult.steps?.length || 0,
      };
    } catch (error: any) {
      console.error("❌ ERROR:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

/**
 * Test glm-4.7-flash with OpenRouter native reasoning parameter
 * Based on: https://openrouter.ai/z-ai/glm-4.7-flash/api
 */
export const testGlmWithNativeReasoningParam = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: glm-4.7-flash with OpenRouter Native Reasoning Parameter");
    console.log("=".repeat(80));

    try {
      const { openrouter } = await import("@openrouter/ai-sdk-provider");
      const { generateText } = await import("ai");

      // Use official OpenRouter provider with reasoning enabled
      const model = openrouter("z-ai/glm-4.7-flash", {
        // Try to pass reasoning parameter
        reasoning: { enabled: true },
      } as any);

      console.log("\n📝 Testing with reasoning: { enabled: true } parameter...");
      const startTime = Date.now();

      const result = await generateText({
        model,
        prompt: "How many r's are in the word 'strawberry'?",
        maxOutputTokens: 500,
      });

      const duration = Date.now() - startTime;
      const fullResult = result as any;

      console.log(`\nDuration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`Text: "${result.text}" (${result.text.length} chars)`);
      console.log(`Finish reason: ${result.finishReason}`);
      console.log(`Output tokens: ${result.usage.outputTokens}`);

      // Check for reasoning_details in response
      console.log("\n🔍 Checking for reasoning_details:");
      if (fullResult.reasoning_details) {
        console.log(`   ✅ Found reasoning_details!`);
        console.log(`   Type: ${typeof fullResult.reasoning_details}`);
        console.log(`   Content: ${JSON.stringify(fullResult.reasoning_details).slice(0, 200)}...`);
      } else {
        console.log(`   ❌ No reasoning_details found`);
      }

      // Check all available keys
      console.log(`\n📋 Available keys: ${Object.keys(fullResult).join(", ")}`);

      const isWorking = result.text.length > 0;
      console.log(`\n${isWorking ? "✅" : "❌"} Status: ${isWorking ? "WORKING" : "EMPTY"}`);

      return {
        success: true,
        working: isWorking,
        textLength: result.text.length,
        hasReasoningDetails: !!fullResult.reasoning_details,
        duration,
        text: result.text,
      };
    } catch (error: any) {
      console.error("❌ ERROR:", error.message);
      console.error("Stack:", error.stack);
      return {
        success: false,
        error: error.message,
        stack: error.stack,
      };
    }
  },
});

/**
 * Test glm-4.7-flash with raw fetch to OpenRouter API
 * Direct API call following OpenRouter documentation exactly
 */
export const testGlmWithRawFetch = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: glm-4.7-flash with Raw Fetch (Direct API)");
    console.log("=".repeat(80));

    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY not found");
      }

      console.log("\n📝 Making direct API call with reasoning: { enabled: true }...");
      const startTime = Date.now();

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          "model": "z-ai/glm-4.7-flash",
          "messages": [
            {
              "role": "user",
              "content": "How many r's are in the word 'strawberry'?",
            },
          ],
          "reasoning": { "enabled": true },
          "max_tokens": 500,
        }),
      });

      const duration = Date.now() - startTime;
      const result = await response.json();

      console.log(`\nDuration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`Response status: ${response.status}`);

      if (!response.ok) {
        console.error(`❌ API Error: ${JSON.stringify(result)}`);
        return {
          success: false,
          error: result.error || "Unknown error",
          status: response.status,
        };
      }

      const message = result.choices?.[0]?.message;
      const content = message?.content || "";
      const reasoningDetails = message?.reasoning_details;

      console.log(`\nContent: "${content}" (${content.length} chars)`);
      console.log(`Usage: ${JSON.stringify(result.usage)}`);

      console.log("\n🔍 Checking for reasoning_details:");
      if (reasoningDetails) {
        console.log(`   ✅ Found reasoning_details!`);
        console.log(`   Type: ${typeof reasoningDetails}`);
        if (Array.isArray(reasoningDetails)) {
          console.log(`   Array length: ${reasoningDetails.length}`);
          reasoningDetails.forEach((step: any, i: number) => {
            console.log(`   Step ${i + 1}: ${JSON.stringify(step).slice(0, 150)}...`);
          });
        } else {
          console.log(`   Content: ${JSON.stringify(reasoningDetails).slice(0, 300)}...`);
        }
      } else {
        console.log(`   ❌ No reasoning_details found`);
      }

      const isWorking = content.length > 0;
      console.log(`\n${isWorking ? "✅" : "❌"} Status: ${isWorking ? "WORKING" : "EMPTY"}`);

      if (isWorking) {
        console.log("\n🎉 SUCCESS! glm-4.7-flash works with native reasoning parameter!");
        console.log(`   Content: "${content}"`);
        if (reasoningDetails) {
          console.log(`   Reasoning: Available (${Array.isArray(reasoningDetails) ? reasoningDetails.length + " steps" : "present"})`);
        }
      }

      return {
        success: true,
        working: isWorking,
        contentLength: content.length,
        hasReasoningDetails: !!reasoningDetails,
        reasoningSteps: Array.isArray(reasoningDetails) ? reasoningDetails.length : 0,
        duration,
        content,
        fullResponse: result,
      };
    } catch (error: any) {
      console.error("❌ ERROR:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

/**
 * Comprehensive test combining all approaches
 */
export const testAllGlmApproaches = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("COMPREHENSIVE TEST: All GLM 4.7 Flash Approaches");
    console.log("=".repeat(80));

    console.log("\n1️⃣  Testing XML tag extraction...");
    const xmlTest = await testGlmWithReasoningExtraction(ctx, {});

    console.log("\n2️⃣  Testing startWithReasoning option...");
    const startTest = await testGlmStartWithReasoning(ctx, {});

    console.log("\n3️⃣  Testing native reasoning support...");
    const nativeTest = await testGlmNativeReasoning(ctx, {});

    console.log("\n4️⃣  Testing OpenRouter native reasoning parameter...");
    const nativeParamTest = await testGlmWithNativeReasoningParam(ctx, {});

    console.log("\n5️⃣  Testing raw fetch with reasoning parameter...");
    const rawFetchTest = await testGlmWithRawFetch(ctx, {});

    console.log("\n" + "=".repeat(80));
    console.log("🎯 FINAL VERDICT");
    console.log("=".repeat(80));

    if (rawFetchTest.working) {
      console.log(`\n✅ SOLUTION FOUND: Use OpenRouter native reasoning parameter!`);
      console.log("   Implementation:");
      console.log(`   const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {`);
      console.log(`     method: "POST",`);
      console.log(`     headers: { "Authorization": "Bearer " + OPENROUTER_API_KEY },`);
      console.log(`     body: JSON.stringify({`);
      console.log(`       model: "z-ai/glm-4.7-flash",`);
      console.log(`       messages: [...],`);
      console.log(`       reasoning: { enabled: true },`);
      console.log(`     }),`);
      console.log(`   });`);
      console.log(`\n   Cost: $0.07/M (98% savings vs claude-sonnet-4)`);
      console.log(`   Duration: ${(rawFetchTest.duration! / 1000).toFixed(2)}s`);
      console.log(`   Reasoning: ${rawFetchTest.reasoningSteps} steps available`);
    } else if (nativeParamTest.working) {
      console.log(`\n✅ SOLUTION FOUND: Use OpenRouter provider with reasoning parameter`);
    } else if (xmlTest.workingTag) {
      console.log(`\n✅ SOLUTION FOUND: Use extractReasoningMiddleware with <${xmlTest.workingTag}> tag`);
      console.log("   Implementation:");
      console.log(`   const enhancedModel = wrapLanguageModel({`);
      console.log(`     model: getLanguageModelSafe("glm-4.7-flash"),`);
      console.log(`     middleware: extractReasoningMiddleware({ tagName: "${xmlTest.workingTag}" }),`);
      console.log(`   });`);
    } else if (startTest.working) {
      console.log("\n✅ SOLUTION FOUND: Use startWithReasoning option");
      console.log("   (Response starts with reasoning but omits opening tag)");
    } else if (nativeTest.foundReasoningProps) {
      console.log("\n⚠️  PARTIAL SUCCESS: Reasoning found but text still empty");
      console.log("   May need custom extraction from steps/reasoning property");
    } else {
      console.log("\n❌ NO SOLUTION FOUND");
      console.log("   GLM 4.7 Flash doesn't expose reasoning in a compatible format");
      console.log("   RECOMMENDATION: Continue using qwen3-coder-free ($0.00, proven reliable)");
    }

    return {
      success: true,
      xmlWorking: !!xmlTest.workingTag,
      startWorking: startTest.working,
      nativeReasoning: nativeTest.foundReasoningProps,
      nativeParamWorking: nativeParamTest.working,
      rawFetchWorking: rawFetchTest.working,
      recommendation: rawFetchTest.working
        ? "Use OpenRouter native reasoning parameter with direct API"
        : nativeParamTest.working
        ? "Use OpenRouter provider with reasoning parameter"
        : xmlTest.workingTag
        ? `Use extractReasoningMiddleware with tag "${xmlTest.workingTag}"`
        : startTest.working
        ? "Use startWithReasoning option"
        : "Use qwen3-coder-free instead",
    };
  },
});
