/**
 * Deep Debug Test for glm-4.7-flash Empty Response Issue
 */

import { internalAction } from "../../_generated/server";
import { generateText } from "ai";
import { getLanguageModelSafe } from "./mcp_tools/models";

export const debugGlmFlash = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("DEEP DEBUG: glm-4.7-flash Empty Response Investigation");
    console.log("=".repeat(80));

    try {
      console.log("\n📋 Test 1: Simple prompt with glm-4.7-flash");
      console.log("-".repeat(80));

      const model = getLanguageModelSafe("glm-4.7-flash");
      const startTime = Date.now();

      const result = await generateText({
        model,
        prompt: "Say 'Hello World' and nothing else.",
        maxOutputTokens: 100,
      });

      const duration = Date.now() - startTime;

      console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`Response text: "${result.text}"`);
      console.log(`Response length: ${result.text.length} chars`);
      console.log(`Finish reason: ${result.finishReason}`);
      console.log(`Token usage: ${JSON.stringify(result.usage)}`);

      // Check full result object
      console.log(`\nFull result keys: ${Object.keys(result).join(", ")}`);

      if (result.text.length === 0) {
        console.log("\n❌ CONFIRMED: Empty response from glm-4.7-flash");
        console.log("Possible causes:");
        console.log("1. Model rate limiting on OpenRouter");
        console.log("2. Model not properly initialized");
        console.log("3. Response format incompatibility");
        console.log("4. Model availability issue");
      } else {
        console.log("\n✅ Model working! Response received.");
      }

      console.log("\n" + "=".repeat(80));
      console.log("📋 Test 2: Comparing with qwen3-coder-free (known working)");
      console.log("-".repeat(80));

      const workingModel = getLanguageModelSafe("qwen3-coder-free");
      const startTime2 = Date.now();

      const result2 = await generateText({
        model: workingModel,
        prompt: "Say 'Hello World' and nothing else.",
        maxOutputTokens: 100,
      });

      const duration2 = Date.now() - startTime2;

      console.log(`Duration: ${(duration2 / 1000).toFixed(2)}s`);
      console.log(`Response text: "${result2.text}"`);
      console.log(`Response length: ${result2.text.length} chars`);
      console.log(`Finish reason: ${result2.finishReason}`);

      console.log("\n" + "=".repeat(80));
      console.log("📊 COMPARISON SUMMARY");
      console.log("=".repeat(80));
      console.log(`glm-4.7-flash:     ${result.text.length} chars in ${(duration / 1000).toFixed(2)}s`);
      console.log(`qwen3-coder-free:   ${result2.text.length} chars in ${(duration2 / 1000).toFixed(2)}s`);

      if (result.text.length === 0 && result2.text.length > 0) {
        console.log("\n⚠️ DIAGNOSIS: glm-4.7-flash has a specific issue");
        console.log("RECOMMENDATION: Use qwen3-coder-free or deepseek-v3.2 instead");
      }

      return {
        success: true,
        glmWorking: result.text.length > 0,
        glmResponseLength: result.text.length,
        glmDuration: duration,
        devstralWorking: result2.text.length > 0,
        devstralResponseLength: result2.text.length,
        devstralDuration: duration2,
      };
    } catch (error: any) {
      console.error("❌ TEST FAILED:", error.message);
      console.error("Stack:", error.stack);
      return {
        success: false,
        error: error.message,
        stack: error.stack,
      };
    }
  },
});

export const testGlmWithStructuredOutput = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: glm-4.7-flash with Structured Output (generateObject)");
    console.log("=".repeat(80));

    try {
      const { generateObject } = await import("ai");
      const { z } = await import("zod");

      console.log("\nTesting glm-4.7-flash with generateObject...");

      const model = getLanguageModelSafe("glm-4.7-flash");
      const startTime = Date.now();

      const schema = z.object({
        greeting: z.string().describe("A simple greeting"),
      });

      const result = await generateObject({
        model,
        schema,
        prompt: "Generate a greeting that says 'Hello World'",
      });

      const duration = Date.now() - startTime;

      console.log(`\nDuration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`Response: ${JSON.stringify(result.object)}`);
      console.log(`Greeting: "${result.object.greeting}"`);

      if (!result.object.greeting || result.object.greeting.length === 0) {
        console.log("\n❌ CONFIRMED: glm-4.7-flash returns empty with structured output");
      } else {
        console.log("\n✅ glm-4.7-flash works with structured output!");
      }

      return {
        success: true,
        hasResponse: !!result.object.greeting && result.object.greeting.length > 0,
        response: result.object,
        duration,
      };
    } catch (error: any) {
      console.error("❌ TEST FAILED:", error.message);
      console.error("Stack:", error.stack);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

export const testAlternativeModels = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: Alternative Ultra-Cheap Models");
    console.log("=".repeat(80));

    const modelsToTest = [
      { name: "qwen3-coder-free", cost: "$0.00", description: "FREE model (proven)" },
      { name: "glm-4.7-flash", cost: "$0.07/M", description: "Ultra-cheap OpenRouter" },
      { name: "qwen3-235b", cost: "$0.18/M", description: "Cheap alternative" },
      { name: "deepseek-v3.2", cost: "$0.25/M", description: "Budget quality" },
    ];

    const results: Array<{
      model: string;
      cost: string;
      working: boolean;
      duration?: number;
      responseLength?: number;
      error?: any;
    }> = [];

    for (const modelInfo of modelsToTest) {
      console.log(`\n${"─".repeat(80)}`);
      console.log(`Testing: ${modelInfo.name} (${modelInfo.cost})`);
      console.log("─".repeat(80));

      try {
        const model = getLanguageModelSafe(modelInfo.name);
        const startTime = Date.now();

        const result = await generateText({
          model,
          prompt: "List 3 benefits of solar energy in one sentence.",
          maxOutputTokens: 100,
        });

        const duration = Date.now() - startTime;

        const working = result.text.length > 0;
        const status = working ? "✅" : "❌";

        console.log(`${status} ${working ? "WORKING" : "EMPTY RESPONSE"}`);
        console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
        console.log(`Response length: ${result.text.length} chars`);
        if (working) {
          console.log(`Preview: ${result.text.slice(0, 80)}...`);
        }

        results.push({
          model: modelInfo.name,
          cost: modelInfo.cost,
          working,
          duration,
          responseLength: result.text.length,
        });
      } catch (error: any) {
        console.log(`❌ ERROR: ${error.message}`);
        results.push({
          model: modelInfo.name,
          cost: modelInfo.cost,
          working: false,
          error: error.message,
        });
      }
    }

    console.log("\n" + "=".repeat(80));
    console.log("📊 SUMMARY: Working Models");
    console.log("=".repeat(80));

    const workingModels = results.filter((r) => r.working);
    workingModels.forEach((r) => {
      console.log(`✅ ${r.model} (${r.cost}) - ${(r.duration! / 1000).toFixed(2)}s, ${r.responseLength} chars`);
    });

    const brokenModels = results.filter((r) => !r.working);
    if (brokenModels.length > 0) {
      console.log("\n❌ Non-Working Models:");
      brokenModels.forEach((r) => {
        console.log(`   ${r.model} (${r.cost}) - ${r.error || "Empty response"}`);
      });
    }

    console.log("\n💡 RECOMMENDATION:");
    if (workingModels.length > 0) {
      const cheapest = workingModels[0];
      console.log(`Use ${cheapest.model} (${cheapest.cost}) as primary model`);
      if (workingModels.length > 1) {
        console.log(`Fallback: ${workingModels[1].model} (${workingModels[1].cost})`);
      }
    }

    return {
      success: true,
      results,
      workingCount: workingModels.length,
      recommendation: workingModels[0]?.model,
    };
  },
});
