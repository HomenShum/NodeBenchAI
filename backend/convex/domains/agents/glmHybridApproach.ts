/**
 * Hybrid Approach: GLM 4.7 Flash + Devstral
 *
 * Uses OpenRouter native reasoning API to get glm-4.7-flash reasoning,
 * then uses qwen3-coder-free to process/extract the final answer.
 *
 * Cost: $0.07/M (glm) + $0.00 (devstral) = $0.07/M total
 * vs claude-sonnet-4: $3.00/M (98% savings)
 *
 * Best of both worlds:
 * - glm provides deep reasoning ($0.07/M)
 * - devstral extracts/summarizes for FREE
 */

import { internalAction } from "../../_generated/server";

/**
 * Test glm-4.7-flash with raw OpenRouter API + reasoning parameter
 */
export const testGlmRawReasoning = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: GLM 4.7 Flash with Native OpenRouter Reasoning API");
    console.log("=".repeat(80));

    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY not found");
      }

      console.log("\n📝 Calling OpenRouter API with reasoning: { enabled: true }...");
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
              "content": "How many r's are in the word 'strawberry'? Think step by step.",
            },
          ],
          "reasoning": { "enabled": true },
          "max_tokens": 500,
        }),
      });

      const duration = Date.now() - startTime;
      const result = await response.json();

      console.log(`\nDuration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`Status: ${response.status}`);

      if (!response.ok) {
        console.error(`❌ API Error: ${JSON.stringify(result, null, 2)}`);
        return {
          success: false,
          error: result.error || "Unknown error",
          status: response.status,
        };
      }

      const message = result.choices?.[0]?.message;
      const content = message?.content || "";
      const reasoningDetails = message?.reasoning_details;

      console.log(`\n📊 Response:`);
      console.log(`   Content: "${content}" (${content.length} chars)`);
      console.log(`   Usage: ${JSON.stringify(result.usage)}`);
      console.log(`   Reasoning tokens: ${result.usage?.reasoning_tokens || "N/A"}`);

      console.log("\n🔍 Reasoning Details:");
      if (reasoningDetails) {
        console.log(`   ✅ Found reasoning_details!`);
        if (Array.isArray(reasoningDetails)) {
          console.log(`   Array length: ${reasoningDetails.length}`);
          reasoningDetails.forEach((step: any, i: number) => {
            console.log(`   Step ${i + 1}:`);
            console.log(`      ${JSON.stringify(step).slice(0, 200)}...`);
          });
        } else {
          console.log(`   Type: ${typeof reasoningDetails}`);
          console.log(`   ${JSON.stringify(reasoningDetails).slice(0, 500)}...`);
        }
      } else {
        console.log(`   ❌ No reasoning_details in response`);
        console.log(`   Available keys: ${Object.keys(message || {}).join(", ")}`);
      }

      const isWorking = content.length > 0;
      console.log(`\n${isWorking ? "✅ SUCCESS" : "❌ EMPTY"}: ${isWorking ? "Model returned content!" : "No content"}`);

      return {
        success: true,
        working: isWorking,
        contentLength: content.length,
        hasReasoningDetails: !!reasoningDetails,
        reasoningSteps: Array.isArray(reasoningDetails) ? reasoningDetails.length : 0,
        duration,
        content,
        reasoningTokens: result.usage?.reasoning_tokens,
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
 * Hybrid approach: Use glm for reasoning + devstral to extract answer
 *
 * This combines:
 * 1. glm-4.7-flash ($0.07/M) for deep reasoning
 * 2. qwen3-coder-free ($0.00) to extract/summarize the answer
 *
 * Total cost: $0.07/M (98% savings vs claude-sonnet-4 $3.00/M)
 */
export const testHybridGlmDevstral = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("HYBRID APPROACH: GLM 4.7 Flash Reasoning + Devstral Processing");
    console.log("=".repeat(80));

    try {
      // Step 1: Get reasoning from glm-4.7-flash
      console.log("\n1️⃣  Getting reasoning from glm-4.7-flash...");
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY not found");
      }

      const glmStart = Date.now();
      const glmResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
              "content": "Analyze the key competitive advantages of Tesla in the EV market. Think deeply about technology, brand, and market position.",
            },
          ],
          "reasoning": { "enabled": true },
          "max_tokens": 1000,
        }),
      });

      const glmDuration = Date.now() - glmStart;
      const glmResult = await glmResponse.json();

      if (!glmResponse.ok) {
        console.error(`❌ GLM API Error: ${JSON.stringify(glmResult)}`);
        return {
          success: false,
          error: glmResult.error || "GLM API failed",
        };
      }

      const glmMessage = glmResult.choices?.[0]?.message;
      const glmContent = glmMessage?.content || "";
      const reasoningDetails = glmMessage?.reasoning_details;

      console.log(`   Duration: ${(glmDuration / 1000).toFixed(2)}s`);
      console.log(`   Content length: ${glmContent.length} chars`);
      console.log(`   Reasoning tokens: ${glmResult.usage?.reasoning_tokens || "N/A"}`);
      console.log(`   Has reasoning_details: ${!!reasoningDetails}`);

      // If glm returned empty, stop here
      if (!glmContent || glmContent.length === 0) {
        console.log("\n❌ GLM returned empty content - cannot proceed");
        return {
          success: false,
          error: "GLM returned empty content",
          glmDuration,
        };
      }

      // Step 2: Use devstral to extract structured answer
      console.log("\n2️⃣  Using qwen3-coder-free to extract structured answer...");
      const { generateObject } = await import("ai");
      const { openrouter } = await import("@openrouter/ai-sdk-provider");
      const { z } = await import("zod");

      const devstralModel = openrouter("qwen/qwen3-coder:free");
      const devstralStart = Date.now();

      const schema = z.object({
        keyPoints: z.array(z.string()).describe("List of 3-5 key competitive advantages"),
        summary: z.string().describe("One paragraph summary of Tesla's competitive position"),
        reasoning: z.string().optional().describe("Brief explanation of the analysis"),
      });

      const devstralResult = await generateObject({
        model: devstralModel,
        schema,
        prompt: `Extract and structure the key insights from this analysis:

${glmContent}

Provide a clear, structured summary with key competitive advantages listed.`,
      });

      const devstralDuration = Date.now() - devstralStart;
      const structured = devstralResult.object;

      console.log(`   Duration: ${(devstralDuration / 1000).toFixed(2)}s`);
      console.log(`   Cost: $0.00 (FREE)`);

      // Results
      const totalDuration = glmDuration + devstralDuration;
      const glmCost = (glmResult.usage?.total_tokens || 0) * 0.00000007; // $0.07/M
      const devstralCost = 0; // FREE
      const totalCost = glmCost + devstralCost;

      console.log("\n" + "=".repeat(80));
      console.log("📊 HYBRID RESULTS");
      console.log("=".repeat(80));

      console.log(`\n⏱️  Performance:`);
      console.log(`   GLM reasoning: ${(glmDuration / 1000).toFixed(2)}s`);
      console.log(`   Devstral extraction: ${(devstralDuration / 1000).toFixed(2)}s`);
      console.log(`   Total: ${(totalDuration / 1000).toFixed(2)}s`);

      console.log(`\n💰 Cost:`);
      console.log(`   GLM: $${glmCost.toFixed(6)}`);
      console.log(`   Devstral: $0.00 (FREE)`);
      console.log(`   Total: $${totalCost.toFixed(6)}`);
      console.log(`   vs claude-sonnet-4: 98% savings`);

      console.log(`\n📝 Structured Output:`);
      console.log(`   Key Points (${structured.keyPoints.length}):`);
      structured.keyPoints.forEach((point, i) => {
        console.log(`      ${i + 1}. ${point}`);
      });
      console.log(`\n   Summary:`);
      console.log(`      ${structured.summary}`);

      console.log("\n✅ HYBRID APPROACH WORKING!");
      console.log("   GLM provides deep reasoning at $0.07/M");
      console.log("   Devstral structures it for FREE");
      console.log("   Total: 98% cost savings vs claude-sonnet-4");

      return {
        success: true,
        glmDuration,
        devstralDuration,
        totalDuration,
        glmCost,
        devstralCost,
        totalCost,
        glmContentLength: glmContent.length,
        hasReasoning: !!reasoningDetails,
        reasoningTokens: glmResult.usage?.reasoning_tokens,
        structured,
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
 * Apply hybrid approach to parallel task decomposition
 * Use case: Complex task decomposition benefits from reasoning
 */
export const demonstrateHybridForDecomposition = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("DEMO: Hybrid GLM+Devstral for Task Decomposition");
    console.log("=".repeat(80));

    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY not found");
      }

      const task = "Build a real-time financial dashboard with live market data, user portfolios, and AI-powered insights";

      // Step 1: GLM reasoning
      console.log("\n1️⃣  GLM deep analysis...");
      const glmStart = Date.now();

      const glmResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
              "content": `Break down this complex software project into parallel execution branches:

${task}

Think deeply about:
1. Which components can be built in parallel
2. Dependencies between branches
3. Critical path and optimal sequencing
4. Risk areas requiring extra attention`,
            },
          ],
          "reasoning": { "enabled": true },
          "max_tokens": 1500,
        }),
      });

      const glmDuration = Date.now() - glmStart;
      const glmResult = await glmResponse.json();

      if (!glmResponse.ok || !glmResult.choices?.[0]?.message?.content) {
        console.log("❌ GLM failed - falling back to devstral only");
        // Fallback: Use devstral directly
        const { generateText } = await import("ai");
        const { openrouter } = await import("@openrouter/ai-sdk-provider");
        const model = openrouter("qwen/qwen3-coder:free");

        const result = await generateText({
          model,
          prompt: `Break down this task into 3-5 parallel execution branches:\n\n${task}`,
        });

        return {
          success: true,
          fallback: true,
          branches: result.text,
        };
      }

      const glmAnalysis = glmResult.choices[0].message.content;

      // Step 2: Devstral structuring
      console.log("\n2️⃣  Devstral structuring...");
      const { generateObject } = await import("ai");
      const { openrouter } = await import("@openrouter/ai-sdk-provider");
      const { z } = await import("zod");

      const devstralModel = openrouter("qwen/qwen3-coder:free");
      const devstralStart = Date.now();

      const schema = z.object({
        branches: z.array(z.object({
          name: z.string(),
          description: z.string(),
          estimatedComplexity: z.enum(["low", "medium", "high"]),
          canStartImmediately: z.boolean(),
          dependsOn: z.array(z.string()).optional(),
        })),
        criticalPath: z.string(),
        risks: z.array(z.string()),
      });

      const devstralResult = await generateObject({
        model: devstralModel,
        schema,
        prompt: `Extract structured task decomposition from this analysis:\n\n${glmAnalysis}`,
      });

      const devstralDuration = Date.now() - devstralStart;
      const decomposition = devstralResult.object;

      console.log("\n✅ SUCCESS - Hybrid decomposition complete!");
      console.log(`\nBranches (${decomposition.branches.length}):`);
      decomposition.branches.forEach((branch, i) => {
        console.log(`   ${i + 1}. ${branch.name} (${branch.estimatedComplexity})`);
        console.log(`      ${branch.description}`);
        console.log(`      Start now: ${branch.canStartImmediately ? "Yes" : "No"}`);
      });

      console.log(`\nCritical Path: ${decomposition.criticalPath}`);
      console.log(`Risks: ${decomposition.risks.join(", ")}`);

      console.log(`\n⏱️  GLM: ${(glmDuration / 1000).toFixed(2)}s | Devstral: ${(devstralDuration / 1000).toFixed(2)}s`);
      console.log(`💰 Cost: $0.07/M (98% savings vs claude-sonnet-4)`);

      return {
        success: true,
        glmDuration,
        devstralDuration,
        decomposition,
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
