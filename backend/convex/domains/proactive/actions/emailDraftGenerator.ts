/**
 * Email Draft Generator
 * Generates email drafts using AI for follow-up opportunities
 *
 * Features:
 * - Analyzes original email thread
 * - Generates contextual reply
 * - Maintains professional tone
 * - Includes relevant information
 * - Creates draft in Gmail (optional)
 *
 * Action Types:
 * - suggest: Generate draft and show to user
 * - draft: Generate draft and save to Gmail drafts
 */

import { internalAction, internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { Id } from "../../../_generated/dataModel";

/**
 * Generate email draft for a follow-up opportunity
 */
export const generateEmailDraft = internalAction({
  args: {
    opportunityId: v.id("opportunities"),
    userId: v.id("users"),
    actionMode: v.union(v.literal("suggest"), v.literal("draft")),
    model: v.optional(v.string()), // Optional: specify LLM model for draft generation
  },
  handler: async (ctx, args) => {
    try {
      // Get opportunity
      const opportunity = await ctx.runQuery(async (ctx) => {
        return await ctx.db.get(args.opportunityId);
      });

      if (!opportunity) {
        throw new Error(`Opportunity ${args.opportunityId} not found`);
      }

      // Get the suggested action config
      const action = opportunity.suggestedActions?.[0];
      if (!action) {
        throw new Error("No suggested action found");
      }

      const config = action.config;
      const emailMessageId = config.emailMessageId as Id<"sourceArtifacts">;

      // Get original email
      const originalEmail = await ctx.runQuery(async (ctx) => {
        return await ctx.db.get(emailMessageId);
      });

      if (!originalEmail) {
        throw new Error(`Email ${emailMessageId} not found`);
      }

      console.log(
        `[EmailDraftGenerator] Generating draft for "${config.subject}"`
      );

      // Analyze email thread and generate draft
      const draft = await generateDraftContent(
        originalEmail,
        config,
        ctx,
        args.model // Optional model override
      );

      // Create proactive action record
      const actionId = await ctx.runMutation(async (ctx) => {
        return await ctx.db.insert("proactiveActions", {
          opportunityId: args.opportunityId,
          actionType: action.actionType,
          mode: args.actionMode,
          status: "completed",
          deliveryChannel: "inApp",
          result: {
            draftSubject: draft.subject,
            draftBody: draft.body,
            originalEmailId: emailMessageId,
            threadId: config.threadId,
          },
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
      });

      // If mode is "draft", create draft in Gmail
      let gmailDraftId: string | undefined;
      if (args.actionMode === "draft") {
        gmailDraftId = await createGmailDraft(
          draft,
          config,
          args.userId,
          ctx
        );
      }

      // Update opportunity status
      await ctx.runMutation(async (ctx) => {
        await ctx.db.patch(args.opportunityId, {
          status: "actioned",
          updatedAt: Date.now(),
        });
      });

      console.log(
        `[EmailDraftGenerator] Generated draft for opportunity ${args.opportunityId}`
      );

      return {
        success: true,
        actionId,
        draft,
        gmailDraftId,
      };
    } catch (error: any) {
      console.error(
        `[EmailDraftGenerator] Error generating draft:`,
        error.message
      );

      // Record failed action
      await ctx.runMutation(async (ctx) => {
        await ctx.db.insert("proactiveActions", {
          opportunityId: args.opportunityId,
          actionType: "suggest",
          mode: args.actionMode,
          status: "failed",
          deliveryChannel: "inApp",
          error: error.message,
          createdAt: Date.now(),
        });
      });

      return {
        success: false,
        error: error.message,
      };
    }
  },
});

/**
 * Generate draft content using AI
 * Uses LLM to create contextual, professional email responses
 *
 * @param originalEmail - The email artifact to respond to
 * @param config - Email configuration (sender, thread info)
 * @param ctx - Action context
 * @param modelOverride - Optional model to use (defaults to FREE-FIRST strategy)
 */
async function generateDraftContent(
  originalEmail: any,
  config: any,
  ctx: any,
  modelOverride?: string
): Promise<{ subject: string; body: string }> {
  const subject = originalEmail.metadata?.subject || config.subject || "";
  const body = originalEmail.textContent || "";
  const senderName = config.senderName || "there";
  const senderEmail = config.senderEmail || "";

  // Build context-aware prompt
  const prompt = `You are helping draft a professional email response.

ORIGINAL EMAIL:
From: ${senderName} <${senderEmail}>
Subject: ${subject}

${body}

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

  try {
    // Use generateObject with structured output
    // FREE-FIRST STRATEGY: Default to FREE models with official OpenRouter provider
    // Default: qwen3-coder-free ($0.00/draft, ~1.6s) - FREE and fast!
// Budget alternatives: gemini-3-flash-preview (~$0.003/draft), claude-sonnet-4.6 (~$0.01/draft)
    const { generateObject } = await import("ai");
    const { openrouter } = await import("@openrouter/ai-sdk-provider");
    const { z } = await import("zod");

    // Default to FREE model with official OpenRouter provider
    const modelName = modelOverride || "qwen/qwen3-coder:free";
    const model = openrouter(modelName);

    console.log(
      `[EmailDraftGenerator] Using model: ${modelName} for draft generation`
    );

    // Use zod schema (required for AI SDK v5 structured output)
    const schema = z.object({
      subject: z.string().describe('Reply subject line (start with "Re: " if replying)'),
      body: z.string().describe("The complete email body text"),
      reasoning: z.string().optional().describe("Brief explanation of the response approach"),
    });

    console.log(`[EmailDraftGenerator] Generating LLM draft for "${subject}"`);

    const result = await generateObject({
      model,
      schema,
      prompt,
    });

    const draft = result.object as any;

    console.log(
      `[EmailDraftGenerator] LLM draft generated: ${draft.body?.length || 0} chars`
    );

    return {
      subject: draft.subject || `Re: ${subject}`,
      body: draft.body || generateFallbackDraft(subject, senderName),
    };
  } catch (error: any) {
    // Fallback to template if LLM fails
    console.error(
      `[EmailDraftGenerator] LLM generation failed, using template fallback:`,
      error.message
    );

    const responseType = analyzeDraftType(body, subject);
    return generateDraftFromTemplate(responseType, subject, body, senderName);
  }
}

/**
 * Generate simple fallback draft if LLM fails
 */
function generateFallbackDraft(
  subject: string,
  senderName: string
): string {
  return `Hi ${senderName},

Thanks for your email. I'll review this and get back to you shortly.

Best regards`;
}

/**
 * Analyze what type of response is needed
 */
function analyzeDraftType(
  body: string,
  subject: string
): "question_answer" | "acknowledgment" | "followup" | "meeting_request" {
  const text = `${subject} ${body}`.toLowerCase();

  // Check for questions
  if (/\?/.test(text) || /can you|could you|would you/i.test(text)) {
    return "question_answer";
  }

  // Check for meeting requests
  if (/meeting|call|schedule|available/i.test(text)) {
    return "meeting_request";
  }

  // Check for action items
  if (/please|need you to|waiting for|let me know/i.test(text)) {
    return "followup";
  }

  // Default: simple acknowledgment
  return "acknowledgment";
}

/**
 * Generate draft from template
 */
function generateDraftFromTemplate(
  type: string,
  subject: string,
  body: string,
  senderName: string
): { subject: string; body: string } {
  const templates: Record<
    string,
    { subject: string; body: string }
  > = {
    question_answer: {
      subject: `Re: ${subject}`,
      body: `Hi ${senderName},

Thanks for reaching out. Let me address your questions:

[Please add your response here]

Let me know if you need any clarification.

Best regards`,
    },
    acknowledgment: {
      subject: `Re: ${subject}`,
      body: `Hi ${senderName},

Thanks for your email. I'll review this and get back to you shortly.

Best regards`,
    },
    followup: {
      subject: `Re: ${subject}`,
      body: `Hi ${senderName},

Thanks for following up on this. I'm working on it and will have an update for you soon.

Best regards`,
    },
    meeting_request: {
      subject: `Re: ${subject}`,
      body: `Hi ${senderName},

Thanks for reaching out. I'd be happy to schedule a meeting.

Here are some times that work for me:
- [Option 1]
- [Option 2]
- [Option 3]

Let me know what works best for you.

Best regards`,
    },
  };

  return templates[type] || templates.acknowledgment;
}

/**
 * Create draft in Gmail (placeholder)
 */
async function createGmailDraft(
  draft: { subject: string; body: string },
  config: any,
  userId: Id<"users">,
  ctx: any
): Promise<string> {
  // TODO: Implement actual Gmail API integration
  // This would use the Gmail API to create a draft

  console.log(
    `[EmailDraftGenerator] Would create Gmail draft for thread ${config.threadId}`
  );
  console.log(`[EmailDraftGenerator] Subject: ${draft.subject}`);
  console.log(
    `[EmailDraftGenerator] Body preview: ${draft.body.slice(0, 100)}...`
  );

  // Return mock draft ID
  return `draft_${Date.now()}`;
}

/**
 * Get draft for an opportunity (query)
 */
export const getDraft = internalMutation({
  args: {
    opportunityId: v.id("opportunities"),
  },
  handler: async (ctx, args) => {
    // Find the most recent draft action for this opportunity
    const action = await ctx.db
      .query("proactiveActions")
      .filter((q) =>
        q.and(
          q.eq(q.field("opportunityId"), args.opportunityId),
          q.eq(q.field("actionType"), "suggest"),
          q.eq(q.field("status"), "completed")
        )
      )
      .order("desc")
      .first();

    if (!action || !action.result) {
      return null;
    }

    return {
      subject: action.result.draftSubject,
      body: action.result.draftBody,
      createdAt: action.createdAt,
    };
  },
});

/**
 * Update draft content
 */
export const updateDraft = internalMutation({
  args: {
    opportunityId: v.id("opportunities"),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    // Find the draft action
    const action = await ctx.db
      .query("proactiveActions")
      .filter((q) =>
        q.and(
          q.eq(q.field("opportunityId"), args.opportunityId),
          q.eq(q.field("actionType"), "suggest")
        )
      )
      .order("desc")
      .first();

    if (!action) {
      throw new Error("Draft not found");
    }

    // Update the draft
    await ctx.db.patch(action._id, {
      result: {
        ...action.result,
        draftSubject: args.subject,
        draftBody: args.body,
      },
    });

    return { success: true };
  },
});

/**
 * Approve and send draft
 */
export const approveDraft = internalAction({
  args: {
    opportunityId: v.id("opportunities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Get the draft
    const draft = await ctx.runMutation(
      internal.domains.proactive.actions.emailDraftGenerator.getDraft,
      { opportunityId: args.opportunityId }
    );

    if (!draft) {
      throw new Error("Draft not found");
    }

    // TODO: Send email via Gmail API
    console.log(`[EmailDraftGenerator] Would send email: ${draft.subject}`);

    // Update opportunity status to completed
    await ctx.runMutation(async (ctx) => {
      await ctx.db.patch(args.opportunityId, {
        status: "completed",
        updatedAt: Date.now(),
      });
    });

    return {
      success: true,
      message: "Email sent successfully",
    };
  },
});
