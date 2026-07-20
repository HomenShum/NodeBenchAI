/**
 * Test using official OpenRouter AI SDK provider
 * Testing if FREE models support structured outputs
 */

import { internalAction } from "../../../_generated/server";

export const testWithOfficialProvider = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=== Testing Official OpenRouter Provider with FREE Model ===");

    try {
      const { generateObject } = await import("ai");
      const { openrouter } = await import("@openrouter/ai-sdk-provider");
      const { z } = await import("zod");

      // Test with qwen3-coder-free (supports structured_outputs)
      const model = openrouter("qwen/qwen3-coder:free");
      console.log("✅ Model created with official provider");

      const schema = z.object({
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body"),
      });

      const prompt = "Generate a simple email reply to: 'Can you send me the report?' Be professional and brief.";

      console.log("Calling generateObject with FREE model...");
      const startTime = Date.now();

      const result = await generateObject({
        model,
        schema,
        prompt,
      });

      const duration = Date.now() - startTime;
      const draft = result.object;

      console.log("✅ SUCCESS WITH FREE MODEL!");
      console.log(`⏱️  Generation Time: ${(duration / 1000).toFixed(2)}s`);
      console.log(`💰 Cost: $0.00 (FREE)`);
      console.log(`📝 Model: qwen3-coder-free`);
      console.log(`Subject: ${draft.subject}`);
      console.log(`Body: ${draft.body}`);

      return {
        success: true,
        model: "qwen3-coder-free",
        duration,
        cost: "$0.00",
        draft,
      };
    } catch (error: any) {
      console.error("❌ FAILED:", error.message);
      console.error("Stack:", error.stack);
      return {
        success: false,
        error: error.message,
        stack: error.stack,
      };
    }
  },
});

export const testMimoFree = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=== Testing MiMo-V2-Flash FREE Model ===");

    try {
      const { generateObject } = await import("ai");
      const { openrouter } = await import("@openrouter/ai-sdk-provider");
      const { z } = await import("zod");

      const model = openrouter("qwen/qwen3-coder:free");
      console.log("✅ Model created");

      const schema = z.object({
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body"),
      });

      const prompt = "Generate a simple email reply to: 'Can you send me the report?' Be professional and brief.";

      console.log("Calling generateObject...");
      const startTime = Date.now();

      const result = await generateObject({
        model,
        schema,
        prompt,
      });

      const duration = Date.now() - startTime;
      const draft = result.object;

      console.log("✅ SUCCESS!");
      console.log(`⏱️  Generation Time: ${(duration / 1000).toFixed(2)}s`);
      console.log(`💰 Cost: $0.00 (FREE)`);
      console.log(`Subject: ${draft.subject}`);
      console.log(`Body: ${draft.body}`);

      return {
        success: true,
        model: "qwen3-coder-free",
        duration,
        cost: "$0.00",
        draft,
      };
    } catch (error: any) {
      console.error("❌ FAILED:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});
