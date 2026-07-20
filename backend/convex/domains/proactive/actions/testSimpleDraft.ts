/**
 * Minimal test for LLM draft generation
 * Testing exact same pattern as llmEnrichment.ts
 */

import { internalAction } from "../../../_generated/server";

export const testSimple = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=== Starting Simple Draft Test ===");

    try {
      const { generateObject } = await import("ai");
      const { z } = await import("zod");
      const { getLanguageModelSafe } = await import(
        "../../agents/mcp_tools/models/modelResolver"
      );

      const model = getLanguageModelSafe("gemini-3-flash-preview");

      console.log("Model obtained successfully");

      const prompt = "Generate a simple email reply to: 'Can you send me the report?' Be professional and brief.";

      const schema = z.object({
        subject: z.string().describe("Email subject"),
        body: z.string().describe("Email body"),
      });

      console.log("About to call generateObject...");

      const result = await generateObject({
        model,
        schema,
        prompt,
      });

      console.log("generateObject completed!");

      const draft = result.object as any;

      console.log("✅ SUCCESS!");
      console.log("Subject:", draft.subject);
      console.log("Body:", draft.body);

      return {
        success: true,
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
