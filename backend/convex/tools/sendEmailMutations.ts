// convex/tools/sendEmailMutations.ts
// Internal mutations for email event logging

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Log an email event to the emailEvents table
 * Called by sendEmail tool after each send attempt
 */
export const logEmailEvent = internalMutation({
  args: {
    to: v.string(),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.string(),
    bodyPreview: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("bounced"),
    ),
    messageId: v.optional(v.string()),
    providerResponse: v.optional(v.any()),
    errorMessage: v.optional(v.string()),
    threadId: v.optional(v.string()),
    runId: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // Try to get userId from context if not provided
    // Note: In tool context, we may not have direct access to userId
    // The caller should provide it if available

    const now = Date.now();

    // For now, we'll create a placeholder if no userId provided
    // In production, the tool should be called with user context
    const eventData: any = {
      to: args.to,
      subject: args.subject,
      bodyPreview: args.bodyPreview,
      status: args.status,
      createdAt: now,
    };

    // Add optional fields only if present
    if (args.cc) eventData.cc = args.cc;
    if (args.bcc) eventData.bcc = args.bcc;
    if (args.messageId) eventData.messageId = args.messageId;
    if (args.providerResponse) eventData.providerResponse = args.providerResponse;
    if (args.errorMessage) eventData.errorMessage = args.errorMessage;
    if (args.threadId) eventData.threadId = args.threadId;
    if (args.runId) eventData.runId = args.runId;
    if (args.status === "sent") eventData.sentAt = now;

    // We need a userId for the table - if not provided, we need to handle this
    // In the actual agent context, userId should be available
    if (args.userId) {
      eventData.userId = args.userId;
      await ctx.db.insert("emailEvents", eventData);
      console.log("[logEmailEvent] Email event logged", {
        to: args.to,
        status: args.status,
        messageId: args.messageId
      });
    } else {
      // Log warning but don't fail - event will be logged to console only
      console.warn("[logEmailEvent] No userId provided - email event logged to console only", {
        to: args.to,
        subject: args.subject,
        status: args.status,
        messageId: args.messageId,
      });
    }
  },
});

/**
 * Update email event status (e.g., when webhook confirms delivery)
 */
export const updateEmailStatus = internalMutation({
  args: {
    messageId: v.string(),
    status: v.union(
      v.literal("delivered"),
      v.literal("bounced"),
      v.literal("failed"),
    ),
    providerResponse: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Find the email event by messageId
    const events = await ctx.db
      .query("emailEvents")
      .filter(q => q.eq(q.field("messageId"), args.messageId))
      .collect();

    if (events.length === 0) {
      console.warn("[updateEmailStatus] No email event found for messageId:", args.messageId);
      return;
    }

    // Update the most recent matching event
    const event = events[events.length - 1];
    await ctx.db.patch(event._id, {
      status: args.status,
      providerResponse: args.providerResponse || event.providerResponse,
    });

    console.log("[updateEmailStatus] Email status updated", {
      messageId: args.messageId,
      status: args.status,
    });
  },
});
