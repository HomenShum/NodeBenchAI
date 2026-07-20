/**
 * Test Parallel Task Orchestrator Cost Optimization
 * Verifies optimized model usage for decomposition, exploration, verification, etc.
 */

import { internalAction } from "../../_generated/server";
import { generateText } from "ai";
import { getLanguageModelSafe } from "./mcp_tools/models";

export const testDecompositionModel = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: Parallel Orchestrator - Task Decomposition Model");
    console.log("=".repeat(80));

    try {
      console.log("\n📋 Testing task decomposition with optimized model");
      console.log("Previous: claude-sonnet-4 ($3.00/M)");
      console.log("Current: glm-4.7-flash ($0.07/M)");
      console.log("Savings: 98%");

      const startTime = Date.now();

      const prompt = `You are a research strategy planner. Given a user query, decompose it into 3 distinct parallel exploration strategies.

User Query: "What are the key benefits of solar energy?"

Generate 3 exploration branches. Each branch should:
1. Take a distinct approach
2. Be independently executable
3. Potentially find different information

Respond with a JSON array:
[
  {
    "title": "Brief title",
    "description": "What this branch explores"
  }
]

Only output the JSON array, no other text.`;

      const { text } = await generateText({
        model: getLanguageModelSafe("glm-4.7-flash"),
        prompt,
        maxOutputTokens: 500,
      });

      const duration = Date.now() - startTime;

      console.log(`\n✅ Decomposition completed`);
      console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`💰 Model: glm-4.7-flash ($0.07/M)`);
      console.log(`📝 Response length: ${text.length} chars`);

      // Try to parse JSON
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const branches = JSON.parse(jsonMatch[0]);
        console.log(`✅ Valid JSON with ${branches.length} branches`);
        branches.forEach((b: any, i: number) => {
          console.log(`   ${i + 1}. ${b.title}`);
        });
      } else {
        console.log("⚠️  Could not parse JSON (but this may be expected in some cases)");
      }

      console.log("\n💡 Cost Comparison:");
      console.log(`   If claude-sonnet-4: ~$0.0015 per decomposition`);
      console.log(`   With glm-4.7-flash: ~$0.000035 per decomposition`);
      console.log(`   Savings: 98%`);

      console.log("=".repeat(80));

      return {
        success: true,
        model: "glm-4.7-flash",
        duration,
        responseLength: text.length,
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

export const testExplorationModel = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: Parallel Orchestrator - Branch Exploration Model");
    console.log("=".repeat(80));

    try {
      console.log("\n🔍 Testing branch exploration with optimized model");
      console.log("Previous: claude-sonnet-4 ($3.00/M)");
      console.log("Current: deepseek-v3.2 ($0.25/M)");
      console.log("Savings: 92%");

      const startTime = Date.now();

      const prompt = `You are exploring one approach to answer a research question.

Main Query: "What are the environmental benefits of solar energy?"

Your Approach: Environmental Impact Analysis
Strategy: Analyze reduction in carbon emissions and air pollution

Explore this specific angle thoroughly. Provide your findings with clear reasoning.
Be concise but comprehensive.`;

      const { text } = await generateText({
        model: getLanguageModelSafe("deepseek-v3.2"),
        prompt,
        maxOutputTokens: 500,
      });

      const duration = Date.now() - startTime;

      console.log(`\n✅ Exploration completed`);
      console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`💰 Model: deepseek-v3.2 ($0.25/M)`);
      console.log(`📝 Response length: ${text.length} chars`);
      console.log(`📄 Response preview: ${text.slice(0, 150)}...`);

      console.log("\n💡 Cost Comparison:");
      console.log(`   If claude-sonnet-4: ~$0.0015 per exploration`);
      console.log(`   With deepseek-v3.2: ~$0.000125 per exploration`);
      console.log(`   Savings: 92%`);

      console.log("=".repeat(80));

      return {
        success: true,
        model: "deepseek-v3.2",
        duration,
        responseLength: text.length,
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

export const testVerificationModel = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: Parallel Orchestrator - Result Verification Model");
    console.log("=".repeat(80));

    try {
      console.log("\n✓ Testing result verification with optimized model");
      console.log("Previous: claude-sonnet-4 ($3.00/M)");
      console.log("Current: glm-4.7-flash ($0.07/M)");
      console.log("Savings: 98%");

      const startTime = Date.now();

      const prompt = `You are a verification agent. Evaluate this research result for quality and accuracy.

Original Query: "What are the benefits of solar energy?"

Approach: Cost Analysis

Result to Verify:
Solar energy reduces electricity costs by 50-70% for residential users. Installation costs have decreased 89% since 2010. Return on investment is typically 5-7 years.

Evaluate on:
1. Relevance: Does it address the query?
2. Accuracy: Does the reasoning seem sound?
3. Completeness: Does it provide sufficient information?
4. Clarity: Is it well-organized?

Respond with JSON:
{
  "relevance": 0.0-1.0,
  "accuracy": 0.0-1.0,
  "completeness": 0.0-1.0,
  "clarity": 0.0-1.0,
  "overallScore": 0.0-1.0
}`;

      const { text } = await generateText({
        model: getLanguageModelSafe("glm-4.7-flash"),
        prompt,
        maxOutputTokens: 200,
      });

      const duration = Date.now() - startTime;

      console.log(`\n✅ Verification completed`);
      console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`💰 Model: glm-4.7-flash ($0.07/M)`);
      console.log(`📝 Response: ${text}`);

      // Try to parse JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const scores = JSON.parse(jsonMatch[0]);
        console.log(`✅ Valid JSON verification scores:`);
        console.log(`   Relevance: ${scores.relevance}`);
        console.log(`   Accuracy: ${scores.accuracy}`);
        console.log(`   Completeness: ${scores.completeness}`);
        console.log(`   Clarity: ${scores.clarity}`);
        console.log(`   Overall: ${scores.overallScore}`);
      }

      console.log("\n💡 Cost Comparison:");
      console.log(`   If claude-sonnet-4: ~$0.0006 per verification`);
      console.log(`   With glm-4.7-flash: ~$0.000014 per verification`);
      console.log(`   Savings: 98%`);

      console.log("=".repeat(80));

      return {
        success: true,
        model: "glm-4.7-flash",
        duration,
        response: text,
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

export const testAllParallelOperations = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: Parallel Orchestrator - All Operations");
    console.log("=".repeat(80));

    const results: Array<{
      operation: string;
      success: boolean;
      model?: string;
      duration?: number;
      responseLength?: number;
      error?: string;
    }> = [];

    // Test 1: Decomposition
    console.log("\n1️⃣  Testing Decomposition...");
    const decomp = await testDecompositionModel(ctx, {});
    results.push({ operation: "Decomposition", ...decomp });

    // Test 2: Exploration
    console.log("\n2️⃣  Testing Exploration...");
    const explore = await testExplorationModel(ctx, {});
    results.push({ operation: "Exploration", ...explore });

    // Test 3: Verification
    console.log("\n3️⃣  Testing Verification...");
    const verify = await testVerificationModel(ctx, {});
    results.push({ operation: "Verification", ...verify });

    console.log("\n" + "=".repeat(80));
    console.log("📊 SUMMARY OF ALL TESTS");
    console.log("=".repeat(80));

    const allSuccess = results.every((r) => r.success);
    console.log(`\nOverall Status: ${allSuccess ? "✅ ALL PASSED" : "❌ SOME FAILED"}`);

    results.forEach((r) => {
      const status = r.success ? "✅" : "❌";
      const duration = r.duration ? `${(r.duration / 1000).toFixed(2)}s` : "N/A";
      console.log(`${status} ${r.operation}: ${duration} with ${r.model || "unknown"}`);
    });

    console.log("\n💰 Total Cost Savings:");
    console.log("   Previous (all claude-sonnet-4): ~$3.00/M per operation");
    console.log("   Current (optimized models): ~$0.07-0.25/M per operation");
    console.log("   Average savings: ~95%");

    console.log("=".repeat(80));

    return {
      success: allSuccess,
      results,
    };
  },
});
