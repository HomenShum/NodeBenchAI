/**
 * Gmail Draft Actions
 * Integrates with Gmail API to create and manage email drafts
 *
 * Features:
 * - Create drafts in Gmail
 * - Reply to existing threads
 * - Update draft content
 * - Delete drafts
 * - Send drafts
 *
 * Requires:
 * - Gmail API access
 * - OAuth tokens in emailAccounts table
 */

import { internalAction, internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
import { Id } from "../../../_generated/dataModel";

/**
 * Create a draft in Gmail
 */
export const createGmailDraft = internalAction({
  args: {
    userId: v.id("users"),
    to: v.string(),
    subject: v.string(),
    body: v.string(),
    threadId: v.optional(v.string()), // Gmail thread ID for replies
    inReplyTo: v.optional(v.string()), // Message-ID header for threading
  },
  handler: async (ctx, args) => {
    try {
      // Get user's Gmail account
      const emailAccount = await ctx.runQuery(async (ctx) => {
        return await ctx.db
          .query("emailAccounts")
          .filter((q: any) =>
            q.and(
              q.eq(q.field("userId"), args.userId),
              q.eq(q.field("provider"), "gmail")
            )
          )
          .first();
      });

      if (!emailAccount || !emailAccount.accessToken) {
        throw new Error("Gmail account not connected or token missing");
      }

      console.log(`[GmailDraftActions] Creating draft to ${args.to}`);

      // Create draft via Gmail API
      const draftId = await callGmailAPI(
        emailAccount.accessToken,
        "createDraft",
        {
          to: args.to,
          subject: args.subject,
          body: args.body,
          threadId: args.threadId,
          inReplyTo: args.inReplyTo,
        }
      );

      // Store draft reference
      await ctx.runMutation(async (ctx) => {
        await ctx.db.insert("proactiveActions", {
          opportunityId: undefined as any, // Will be linked later
          actionType: "draft",
          mode: "draft",
          status: "completed",
          deliveryChannel: "gmail",
          deliveryMetadata: {
            gmailDraftId: draftId,
            to: args.to,
            subject: args.subject,
            threadId: args.threadId,
          },
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
      });

      console.log(`[GmailDraftActions] Created draft ${draftId}`);

      return {
        success: true,
        draftId,
      };
    } catch (error: any) {
      console.error(`[GmailDraftActions] Error creating draft:`, error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  },
});

/**
 * Update an existing Gmail draft
 */
export const updateGmailDraft = internalAction({
  args: {
    userId: v.id("users"),
    draftId: v.string(),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const emailAccount = await ctx.runQuery(async (ctx) => {
        return await ctx.db
          .query("emailAccounts")
          .filter((q: any) =>
            q.and(
              q.eq(q.field("userId"), args.userId),
              q.eq(q.field("provider"), "gmail")
            )
          )
          .first();
      });

      if (!emailAccount || !emailAccount.accessToken) {
        throw new Error("Gmail account not connected");
      }

      await callGmailAPI(emailAccount.accessToken, "updateDraft", {
        draftId: args.draftId,
        subject: args.subject,
        body: args.body,
      });

      return { success: true };
    } catch (error: any) {
      console.error(`[GmailDraftActions] Error updating draft:`, error.message);
      return { success: false, error: error.message };
    }
  },
});

/**
 * Send a Gmail draft
 */
export const sendGmailDraft = internalAction({
  args: {
    userId: v.id("users"),
    draftId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const emailAccount = await ctx.runQuery(async (ctx) => {
        return await ctx.db
          .query("emailAccounts")
          .filter((q: any) =>
            q.and(
              q.eq(q.field("userId"), args.userId),
              q.eq(q.field("provider"), "gmail")
            )
          )
          .first();
      });

      if (!emailAccount || !emailAccount.accessToken) {
        throw new Error("Gmail account not connected");
      }

      console.log(`[GmailDraftActions] Sending draft ${args.draftId}`);

      const messageId = await callGmailAPI(
        emailAccount.accessToken,
        "sendDraft",
        { draftId: args.draftId }
      );

      console.log(`[GmailDraftActions] Sent message ${messageId}`);

      return {
        success: true,
        messageId,
      };
    } catch (error: any) {
      console.error(`[GmailDraftActions] Error sending draft:`, error.message);
      return { success: false, error: error.message };
    }
  },
});

/**
 * Delete a Gmail draft
 */
export const deleteGmailDraft = internalAction({
  args: {
    userId: v.id("users"),
    draftId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const emailAccount = await ctx.runQuery(async (ctx) => {
        return await ctx.db
          .query("emailAccounts")
          .filter((q: any) =>
            q.and(
              q.eq(q.field("userId"), args.userId),
              q.eq(q.field("provider"), "gmail")
            )
          )
          .first();
      });

      if (!emailAccount || !emailAccount.accessToken) {
        throw new Error("Gmail account not connected");
      }

      await callGmailAPI(emailAccount.accessToken, "deleteDraft", {
        draftId: args.draftId,
      });

      return { success: true };
    } catch (error: any) {
      console.error(`[GmailDraftActions] Error deleting draft:`, error.message);
      return { success: false, error: error.message };
    }
  },
});

/**
 * Call Gmail API
 * This is a placeholder - in production, use actual Gmail API
 */
async function callGmailAPI(
  accessToken: string,
  action: string,
  params: any
): Promise<string> {
  // TODO: Implement actual Gmail API calls
  // Example implementation:
  //
  // const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${accessToken}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     message: {
  //       raw: base64EncodeEmail({
  //         to: params.to,
  //         subject: params.subject,
  //         body: params.body,
  //         threadId: params.threadId,
  //         inReplyTo: params.inReplyTo,
  //       }),
  //     },
  //   }),
  // });
  //
  // const data = await response.json();
  // return data.id;

  console.log(`[GmailAPI] Mock ${action} call:`, params);

  switch (action) {
    case "createDraft":
      return `draft_${Date.now()}`;
    case "sendDraft":
      return `msg_${Date.now()}`;
    default:
      return `result_${Date.now()}`;
  }
}

/**
 * Encode email as RFC 2822 format and base64
 */
function base64EncodeEmail(email: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
}): string {
  // Build RFC 2822 email
  let emailStr = `To: ${email.to}\n`;
  emailStr += `Subject: ${email.subject}\n`;

  if (email.inReplyTo) {
    emailStr += `In-Reply-To: ${email.inReplyTo}\n`;
    emailStr += `References: ${email.inReplyTo}\n`;
  }

  emailStr += `Content-Type: text/plain; charset="UTF-8"\n`;
  emailStr += `\n${email.body}`;

  // Base64 encode (URL-safe)
  const base64 = Buffer.from(emailStr)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return base64;
}

/**
 * Get draft details from Gmail
 */
export const getGmailDraft = internalAction({
  args: {
    userId: v.id("users"),
    draftId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const emailAccount = await ctx.runQuery(async (ctx) => {
        return await ctx.db
          .query("emailAccounts")
          .filter((q: any) =>
            q.and(
              q.eq(q.field("userId"), args.userId),
              q.eq(q.field("provider"), "gmail")
            )
          )
          .first();
      });

      if (!emailAccount || !emailAccount.accessToken) {
        throw new Error("Gmail account not connected");
      }

      // TODO: Implement actual Gmail API call to get draft
      // const response = await fetch(
      //   `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${args.draftId}`,
      //   {
      //     headers: {
      //       Authorization: `Bearer ${emailAccount.accessToken}`,
      //     },
      //   }
      // );

      console.log(
        `[GmailDraftActions] Would fetch draft ${args.draftId} from Gmail API`
      );

      return {
        success: true,
        draft: {
          id: args.draftId,
          message: {
            id: "msg_mock",
            threadId: "thread_mock",
            subject: "Mock Subject",
            snippet: "Mock draft content...",
          },
        },
      };
    } catch (error: any) {
      console.error(`[GmailDraftActions] Error getting draft:`, error.message);
      return { success: false, error: error.message };
    }
  },
});

/**
 * List all drafts for a user
 */
export const listGmailDrafts = internalAction({
  args: {
    userId: v.id("users"),
    maxResults: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    try {
      const emailAccount = await ctx.runQuery(async (ctx) => {
        return await ctx.db
          .query("emailAccounts")
          .filter((q: any) =>
            q.and(
              q.eq(q.field("userId"), args.userId),
              q.eq(q.field("provider"), "gmail")
            )
          )
          .first();
      });

      if (!emailAccount || !emailAccount.accessToken) {
        throw new Error("Gmail account not connected");
      }

      // TODO: Implement actual Gmail API call to list drafts
      console.log(`[GmailDraftActions] Would list drafts from Gmail API`);

      return {
        success: true,
        drafts: [],
      };
    } catch (error: any) {
      console.error(`[GmailDraftActions] Error listing drafts:`, error.message);
      return { success: false, error: error.message };
    }
  },
});
