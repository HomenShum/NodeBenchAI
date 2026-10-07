/**
 * Test glm-4.7-flash with different access methods
 */

import { internalAction } from "../../_generated/server";
import { generateText } from "ai";
import { getLanguageModelSafe } from "./mcp_tools/models";

export const testGlmWithFullResponse = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: Accessing glm-4.7-flash Full Response Structure");
    console.log("=".repeat(80));

    try {
      const model = getLanguageModelSafe("glm-4.7-flash");

      const result = await generateText({
        model,
        prompt: "Say 'Hello World' and nothing else.",
        maxOutputTokens: 100,
      });

      console.log("\n📊 Full Response Structure:");
      console.log("-".repeat(80));
      console.log(`text: "${result.text}"`);
      console.log(`finishReason: ${result.finishReason}`);
      console.log(`usage: ${JSON.stringify(result.usage, null, 2)}`);

      // Check for reasoning-specific fields
      const fullResult = result as any;
      console.log(`\nAvailable keys: ${Object.keys(fullResult).join(", ")}`);

      if (fullResult.steps) {
        console.log(`\n📝 Steps field found (${fullResult.steps.length} steps):`);
        fullResult.steps.forEach((step: any, i: number) => {
          console.log(`  Step ${i + 1}: ${JSON.stringify(step).slice(0, 200)}`);
        });
      }

      if (fullResult.resolvedOutput) {
        console.log(`\n💡 Resolved Output field found:`);
        console.log(`  Type: ${typeof fullResult.resolvedOutput}`);
        console.log(`  Value: ${JSON.stringify(fullResult.resolvedOutput).slice(0, 200)}`);
      }

      // Try to access response field (common in reasoning models)
      if (fullResult.response) {
        console.log(`\n✅ Response field found!`);
        console.log(`  Content: "${fullResult.response}"`);
      }

      // Check rawResponse if available
      if (fullResult.rawResponse) {
        console.log(`\n🔍 Raw Response:`);
        console.log(`  ${JSON.stringify(fullResult.rawResponse).slice(0, 300)}...`);
      }

      console.log("\n" + "=".repeat(80));
      console.log("💡 DIAGNOSIS:");
      console.log("=".repeat(80));

      if (result.text.length === 0 && (result.usage.outputTokens ?? 0) > 0) {
        console.log("❌ ISSUE CONFIRMED: Model generates tokens but text is empty");
        console.log("   This indicates glm-4.7-flash uses a non-standard response format");
        console.log("   Likely a reasoning model (like deepseek-r1) with different structure");
        console.log("");
        console.log("🔧 RECOMMENDED FIX:");
        console.log("   Switch to qwen3-coder-free ($0.00) or deepseek-v3.2 ($0.25/M)");
        console.log("   Both models work correctly with standard AI SDK interface");
      }

      return {
        success: true,
        textEmpty: result.text.length === 0,
        tokensGenerated: (result.usage.outputTokens ?? 0) > 0,
        availableKeys: Object.keys(fullResult),
        hasSteps: !!fullResult.steps,
        hasResolvedOutput: !!fullResult.resolvedOutput,
      };
    } catch (error: any) {
      console.error("❌ TEST FAILED:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

export const compareReasoningVsStandard = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("COMPARISON: Reasoning vs Standard Models");
    console.log("=".repeat(80));

    const models = [
      { name: "glm-4.7-flash", type: "reasoning?", cost: "$0.07/M" },
      { name: "deepseek-r1-free", type: "reasoning", cost: "$0.00" },
      { name: "qwen3-coder-free", type: "standard", cost: "$0.00" },
      { name: "deepseek-v3.2", type: "standard", cost: "$0.25/M" },
    ];

    const results: Array<{
      model: string;
      type: string;
      cost: string;
      working: boolean;
      textLength?: number;
      outputTokens?: number;
      duration?: number;
      hasSteps?: boolean;
      hasResolvedOutput?: boolean;
      error?: any;
    }> = [];

    for (const modelInfo of models) {
      console.log(`\n${"─".repeat(80)}`);
      console.log(`Testing: ${modelInfo.name} (${modelInfo.type})`);
      console.log("─".repeat(80));

      try {
        const model = getLanguageModelSafe(modelInfo.name);
        const startTime = Date.now();

        const result = await generateText({
          model,
          prompt: "Say exactly: Hello World",
          maxOutputTokens: 100,
        });

        const duration = Date.now() - startTime;
        const fullResult = result as any;

        console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
        console.log(`Text: "${result.text}"`);
        console.log(`Text length: ${result.text.length} chars`);
        console.log(`Output tokens: ${result.usage.outputTokens}`);
        console.log(`Finish reason: ${result.finishReason}`);
        console.log(`Response structure: ${Object.keys(fullResult).join(", ")}`);

        const isWorking = result.text.length > 0;
        console.log(`Status: ${isWorking ? "✅ WORKING" : "❌ EMPTY"}`);

        results.push({
          model: modelInfo.name,
          type: modelInfo.type,
          cost: modelInfo.cost,
          working: isWorking,
          textLength: result.text.length,
          outputTokens: result.usage.outputTokens,
          duration,
          hasSteps: !!fullResult.steps,
          hasResolvedOutput: !!fullResult.resolvedOutput,
        });
      } catch (error: any) {
        console.log(`❌ ERROR: ${error.message}`);
        results.push({
          model: modelInfo.name,
          type: modelInfo.type,
          cost: modelInfo.cost,
          working: false,
          error: error.message,
        });
      }
    }

    console.log("\n" + "=".repeat(80));
    console.log("📊 SUMMARY");
    console.log("=".repeat(80));

    console.log("\n✅ Working Models:");
    results
      .filter((r) => r.working)
      .forEach((r) => {
        console.log(`   ${r.model} (${r.type}, ${r.cost})`);
        console.log(`      ${r.textLength} chars, ${(r.duration! / 1000).toFixed(2)}s`);
      });

    console.log("\n❌ Non-Working Models:");
    results
      .filter((r) => !r.working)
      .forEach((r) => {
        console.log(`   ${r.model} (${r.type}, ${r.cost})`);
        if (r.outputTokens && r.outputTokens > 0) {
          console.log(`      Generates ${r.outputTokens} tokens but text is empty`);
          console.log(`      ${r.hasSteps ? "Has steps field" : ""} ${r.hasResolvedOutput ? "Has resolvedOutput field" : ""}`);
        }
      });

    console.log("\n💡 RECOMMENDATION:");
    const freeWorking = results.filter((r) => r.working && r.cost === "$0.00");
    if (freeWorking.length > 0) {
      console.log(`   PRIMARY: ${freeWorking[0].model} (FREE, proven reliable)`);
    }
    const cheapWorking = results.filter((r) => r.working && r.cost !== "$0.00");
    if (cheapWorking.length > 0) {
      console.log(`   FALLBACK: ${cheapWorking[0].model} (${cheapWorking[0].cost})`);
    }

    return {
      success: true,
      results,
      workingModels: results.filter((r) => r.working).map((r) => r.model),
    };
  },
});
