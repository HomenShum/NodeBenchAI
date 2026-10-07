/**
 * Test Script for LLM Email Draft Generator
 *
 * This script demonstrates the LLM-powered draft generation capabilities
 * with various models and email scenarios.
 *
 * Usage:
 * npx convex run domains:proactive:actions:testDraftGenerator:testWithFreeModel
 * npx convex run domains:proactive:actions:testDraftGenerator:testWithQualityModel
 * npx convex run domains:proactive:actions:testDraftGenerator:compareModels
 */

import { internalAction } from "../../../_generated/server";
import { v } from "convex/values";

/**
 * Test draft generation with FREE model (qwen3-coder-free)
 */
export const testWithFreeModel = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: Email Draft Generation with qwen3-coder-free (FREE $0.00/draft)");
    console.log("=".repeat(80));

    const mockEmail = {
      metadata: {
        subject: "Q1 Project Roadmap Update",
      },
      textContent: `Hi,

Can you provide an update on the Q1 roadmap? We need to review the timeline with stakeholders next week.

Also, are you available for a quick call on Friday to discuss the deliverables?

Thanks,
John Smith`,
    };

    const mockConfig = {
      subject: "Q1 Project Roadmap Update",
      senderName: "John Smith",
      senderEmail: "john@company.com",
      threadId: "thread_123",
    };

    try {
      const { generateObject } = await import("ai");
      const { openrouter } = await import("@openrouter/ai-sdk-provider");
      const { z } = await import("zod");

      const model = openrouter("qwen/qwen3-coder:free");
      const startTime = Date.now();

      const prompt = `You are helping draft a professional email response.

ORIGINAL EMAIL:
From: ${mockConfig.senderName} <${mockConfig.senderEmail}>
Subject: ${mockConfig.subject}

${mockEmail.textContent}

YOUR TASK:
Write a professional, contextual email response that:
1. Acknowledges the sender's email appropriately
2. Addresses any questions or action items mentioned
3. Maintains a professional but friendly tone
4. Is concise and clear
5. Ends with an appropriate sign-off

IMPORTANT:
- Do NOT include a signature block (name, title, contact info) - just end with "Best regards" or similar
- If the email contains specific questions, acknowledge them (you can suggest placeholders for detailed answers)
- If it's a meeting request, suggest times or ask for their availability
- If it's a follow-up, acknowledge you're working on it
- Keep the response focused and actionable

Generate a complete email draft that can be sent as-is or lightly edited.`;

      const schema = z.object({
        subject: z.string().describe('Reply subject line (start with "Re: " if replying)'),
        body: z.string().describe("The complete email body text"),
        reasoning: z.string().optional().describe("Brief explanation of the response approach"),
      });

      const result = await generateObject({
        model,
        schema,
        prompt,
      });

      const duration = Date.now() - startTime;
      const draft = result.object as any;

      console.log("\n✅ DRAFT GENERATED SUCCESSFULLY");
      console.log(`⏱️  Generation Time: ${(duration / 1000).toFixed(2)}s`);
      console.log(`📝 Model: qwen3-coder-free (FREE)`);
      console.log(`💰 Cost: $0.00 per draft`);
      console.log("\n" + "-".repeat(80));
      console.log("SUBJECT:", draft.subject);
      console.log("-".repeat(80));
      console.log("BODY:");
      console.log(draft.body);
      console.log("-".repeat(80));
      console.log("REASONING:", draft.reasoning);
      console.log("=".repeat(80));

      return {
        success: true,
        model: "qwen3-coder-free",
        duration,
        draft,
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

/**
 * Test draft generation with QUALITY model (claude-sonnet-4.6)
 */
export const testWithQualityModel = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: Email Draft Generation with QUALITY Model (claude-sonnet-4.6)");
    console.log("=".repeat(80));

    const mockEmail = {
      metadata: {
        subject: "Urgent: Production Issue Needs Immediate Attention",
      },
      textContent: `Hi,

We're experiencing a critical issue in production that's affecting 30% of our users.

The API is returning 500 errors intermittently. Our monitoring shows it started at 2:15 PM EST.

Can you investigate ASAP and provide an ETA for the fix? Our customers are being impacted.

This is urgent - please prioritize.

Thanks,
Sarah Johnson
VP Engineering`,
    };

    const mockConfig = {
      subject: "Urgent: Production Issue Needs Immediate Attention",
      senderName: "Sarah Johnson",
      senderEmail: "sarah@company.com",
      threadId: "thread_456",
    };

    try {
      const { generateObject } = await import("ai");
      const { getLanguageModelSafe } = await import(
        "../../agents/mcp_tools/models/modelResolver"
      );

      const model = getLanguageModelSafe("claude-sonnet-4.6");
      const startTime = Date.now();

      const prompt = `You are helping draft a professional email response.

ORIGINAL EMAIL:
From: ${mockConfig.senderName} <${mockConfig.senderEmail}>
Subject: ${mockConfig.subject}

${mockEmail.textContent}

YOUR TASK:
Write a professional, contextual email response that:
1. Acknowledges the sender's email appropriately
2. Addresses any questions or action items mentioned
3. Maintains a professional but friendly tone
4. Is concise and clear
5. Ends with an appropriate sign-off

IMPORTANT:
- Do NOT include a signature block (name, title, contact info) - just end with "Best regards" or similar
- If the email contains specific questions, acknowledge them (you can suggest placeholders for detailed answers)
- If it's a meeting request, suggest times or ask for their availability
- If it's a follow-up, acknowledge you're working on it
- Keep the response focused and actionable

Generate a complete email draft that can be sent as-is or lightly edited.`;

      const result = await generateObject({
        model,
        schema: {
          type: "object",
          properties: {
            subject: {
              type: "string",
              description: 'Reply subject line (start with "Re: " if replying)',
            },
            body: {
              type: "string",
              description: "The complete email body text",
            },
            reasoning: {
              type: "string",
              description: "Brief explanation of the response approach",
            },
          },
          required: ["subject", "body"],
        } as any,
        prompt,
      });

      const duration = Date.now() - startTime;
      const draft = result.object as any;

      console.log("\n✅ DRAFT GENERATED SUCCESSFULLY");
      console.log(`⏱️  Generation Time: ${(duration / 1000).toFixed(2)}s`);
console.log(`📝 Model: claude-sonnet-4.6 (QUALITY)`);
      console.log(`💰 Estimated Cost: ~$0.01`);
      console.log("\n" + "-".repeat(80));
      console.log("SUBJECT:", draft.subject);
      console.log("-".repeat(80));
      console.log("BODY:");
      console.log(draft.body);
      console.log("-".repeat(80));
      console.log("REASONING:", draft.reasoning);
      console.log("=".repeat(80));

      return {
        success: true,
        model: "claude-sonnet-4.6",
        duration,
        draft,
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

/**
 * Compare draft generation across multiple models
 */
export const compareModels = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("=".repeat(80));
    console.log("TEST: Model Comparison for Email Draft Generation");
    console.log("=".repeat(80));

    const mockEmail = {
      metadata: {
        subject: "Meeting Follow-Up: Partnership Discussion",
      },
      textContent: `Hi,

Thanks for taking the time to meet with me yesterday. I really enjoyed our discussion about the potential partnership between our companies.

As we discussed, I think there's a great opportunity for collaboration on the Q2 product launch. I'd love to move forward with the next steps we outlined:

1. Draft proposal by end of week
2. Review with your team next Monday
3. Finalize terms by month end

Let me know if this timeline still works for you, or if you need any adjustments.

Looking forward to working together!

Best,
Michael Chen
Director of Partnerships`,
    };

    const mockConfig = {
      subject: "Meeting Follow-Up: Partnership Discussion",
      senderName: "Michael Chen",
      senderEmail: "michael@company.com",
      threadId: "thread_789",
    };

    const modelsToTest = [
      { name: "qwen3-coder-free", tier: "FREE", cost: "$0.00" },
      { name: "gemini-3-flash-preview", tier: "BUDGET", cost: "~$0.003" },
      { name: "claude-sonnet-4.6", tier: "QUALITY", cost: "~$0.01" },
    ];

    const results: Array<{
      model: string;
      tier: string;
      success: boolean;
      duration?: number;
      cost?: string;
      draftLength?: number;
      error?: string;
    }> = [];

    for (const modelInfo of modelsToTest) {
      console.log(`\n${"─".repeat(80)}`);
      console.log(`Testing model: ${modelInfo.name} (${modelInfo.tier})`);
      console.log("─".repeat(80));

      try {
        const { generateObject } = await import("ai");
        const { z } = await import("zod");

        // Use official OpenRouter provider for FREE models, otherwise use model resolver
        let model;
        if (modelInfo.name === "qwen3-coder-free") {
          const { openrouter } = await import("@openrouter/ai-sdk-provider");
          model = openrouter("qwen/qwen3-coder:free");
        } else {
          const { getLanguageModelSafe } = await import(
            "../../agents/mcp_tools/models/modelResolver"
          );
          model = getLanguageModelSafe(modelInfo.name);
        }

        const startTime = Date.now();

        const prompt = `You are helping draft a professional email response.

ORIGINAL EMAIL:
From: ${mockConfig.senderName} <${mockConfig.senderEmail}>
Subject: ${mockConfig.subject}

${mockEmail.textContent}

YOUR TASK:
Write a professional, contextual email response that acknowledges the meeting, confirms the timeline, and maintains a collaborative tone.`;

        const schema = z.object({
          subject: z.string().describe("Reply subject line"),
          body: z.string().describe("The complete email body text"),
        });

        const result = await generateObject({
          model,
          schema,
          prompt,
        });

        const duration = Date.now() - startTime;
        const draft = result.object as any;

        console.log(`✅ Success | ⏱️  ${(duration / 1000).toFixed(2)}s | 💰 ${modelInfo.cost}`);
        console.log(`Subject: ${draft.subject}`);
        console.log(`Body: ${draft.body.substring(0, 100)}...`);

        results.push({
          model: modelInfo.name,
          tier: modelInfo.tier,
          success: true,
          duration,
          cost: modelInfo.cost,
          draftLength: draft.body.length,
        });
      } catch (error: any) {
        console.error(`❌ Failed: ${error.message}`);
        results.push({
          model: modelInfo.name,
          tier: modelInfo.tier,
          success: false,
          error: error.message,
        });
      }
    }

    console.log("\n" + "=".repeat(80));
    console.log("COMPARISON SUMMARY");
    console.log("=".repeat(80));
    console.table(results);

    return {
      success: true,
      results,
    };
  },
});
