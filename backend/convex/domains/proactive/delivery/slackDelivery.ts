/**
 * Slack Delivery Channel
 * Delivers proactive opportunities to users via Slack
 *
 * Features:
 * - Formats opportunities as rich Slack messages
 * - Sends to user's Slack DM
 * - Includes action buttons for feedback
 * - Handles Slack API errors and retries
 * - Tracks delivery status
 *
 * Message Format:
 * - Header with opportunity type and priority
 * - Brief description with "why now"
 * - Evidence snippets (if available)
 * - Action buttons (View, Dismiss, Feedback)
 */

import { internalMutation, internalAction } from "../../../_generated/server";
import { v } from "convex/values";
import { Id } from "../../../_generated/dataModel";

/**
 * Format opportunity as Slack message blocks
 */
function formatSlackMessage(opportunity: any, userId: string): any {
  const blocks: any[] = [];

  // Header with emoji and priority
  const emoji = getEmojiForType(opportunity.type);
  const priority = opportunity.metadata?.priority || "medium";
  const priorityEmoji = priority === "high" ? "🔴" : priority === "medium" ? "🟡" : "🟢";

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `${emoji} ${getDisplayName(opportunity.type)}`,
      emoji: true,
    },
  });

  // Why now (trigger reason)
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${opportunity.trigger.whyNow}*`,
    },
  });

  // Priority indicator
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `${priorityEmoji} Priority: ${priority} | Confidence: ${Math.round(
          (opportunity.impactEstimate?.confidenceLevel || 0) * 100
        )}%`,
      },
    ],
  });

  // Evidence (if available)
  if (opportunity.evidencePointers && opportunity.evidencePointers.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Related Context:*\n${opportunity.evidencePointers
          .slice(0, 3)
          .map((e: any, i: number) => `${i + 1}. ${e.excerpt?.slice(0, 100)}...`)
          .join("\n")}`,
      },
    });
  }

  // Suggested actions
  if (opportunity.suggestedActions && opportunity.suggestedActions.length > 0) {
    const action = opportunity.suggestedActions[0];
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Suggested Action:*\n${action.description}`,
      },
    });
  }

  blocks.push({ type: "divider" });

  // Action buttons
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "📖 View Details",
          emoji: true,
        },
        style: "primary",
        value: opportunity.opportunityId,
        action_id: "view_opportunity",
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "👍 Useful",
          emoji: true,
        },
        style: "primary",
        value: `${opportunity.opportunityId}:useful`,
        action_id: "feedback_useful",
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "👎 Not Useful",
          emoji: true,
        },
        value: `${opportunity.opportunityId}:not_useful`,
        action_id: "feedback_not_useful",
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "✕ Dismiss",
          emoji: true,
        },
        value: opportunity.opportunityId,
        action_id: "dismiss_opportunity",
      },
    ],
  });

  return {
    blocks,
    text: `${getDisplayName(opportunity.type)}: ${opportunity.trigger.whyNow}`, // Fallback text
  };
}

/**
 * Get emoji for opportunity type
 */
function getEmojiForType(type: string): string {
  const emojiMap: Record<string, string> = {
    meeting_prep: "📅",
    follow_up: "🔔",
    daily_brief: "📰",
    risk_alert: "⚠️",
    email_draft: "✉️",
    crm_update: "📊",
  };
  return emojiMap[type] || "💡";
}

/**
 * Get display name for opportunity type
 */
function getDisplayName(type: string): string {
  const nameMap: Record<string, string> = {
    meeting_prep: "Meeting Prep Pack",
    follow_up: "Follow-Up Reminder",
    daily_brief: "Daily Brief",
    risk_alert: "Risk Alert",
    email_draft: "Email Draft Ready",
    crm_update: "CRM Update",
  };
  return nameMap[type] || type;
}

/**
 * Send opportunity to Slack
 */
export const sendToSlack = internalAction({
  args: {
    opportunityId: v.id("opportunities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    try {
      // Get opportunity
      const opportunity = await ctx.runQuery(
        async (ctx) => await ctx.db.get(args.opportunityId)
      );

      if (!opportunity) {
        throw new Error(`Opportunity ${args.opportunityId} not found`);
      }

      // Get user's Slack account
      const slackAccount = await ctx.runQuery(async (ctx) =>
        ctx.db
          .query("slackAccounts")
          .filter((q: any) => q.eq(q.field("userId"), args.userId))
          .first()
      );

      if (!slackAccount) {
        console.log(`[SlackDelivery] User ${args.userId} has no Slack account connected`);
        return {
          success: false,
          error: "No Slack account connected",
        };
      }

      // Format message
      const message = formatSlackMessage(opportunity, args.userId.toString());

      // Send to Slack via Slack API
      // TODO: Replace with actual Slack API call
      const slackResponse = await sendSlackMessage(
        slackAccount.accessToken,
        slackAccount.userId, // Slack user ID
        message
      );

      // Create proactive action record
      await ctx.runMutation(async (ctx) => {
        await ctx.db.insert("proactiveActions", {
          opportunityId: args.opportunityId,
          actionType: "suggest",
          mode: "suggest",
          status: "completed",
          deliveryChannel: "slack",
          deliveryMetadata: {
            slackChannel: slackAccount.userId,
            slackTs: slackResponse.ts,
            slackMessageId: slackResponse.ts,
          },
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
      });

      console.log(
        `[SlackDelivery] Sent opportunity ${args.opportunityId} to Slack user ${slackAccount.userId}`
      );

      return {
        success: true,
        slackTs: slackResponse.ts,
      };
    } catch (error: any) {
      console.error(`[SlackDelivery] Error sending to Slack:`, error.message);

      // Record failed action
      await ctx.runMutation(async (ctx) => {
        await ctx.db.insert("proactiveActions", {
          opportunityId: args.opportunityId,
          actionType: "suggest",
          mode: "suggest",
          status: "failed",
          deliveryChannel: "slack",
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
 * Send message to Slack
 * This is a placeholder - in production, use the Slack API
 */
async function sendSlackMessage(
  accessToken: string,
  userId: string,
  message: any
): Promise<{ ts: string; ok: boolean }> {
  // TODO: Implement actual Slack API call
  // const response = await fetch('https://slack.com/api/chat.postMessage', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${accessToken}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     channel: userId,
  //     ...message,
  //   }),
  // });

  // For now, return mock response
  console.log(`[SlackDelivery] Mock sending message to Slack user ${userId}`);
  console.log(`[SlackDelivery] Message blocks:`, JSON.stringify(message.blocks, null, 2));

  return {
    ok: true,
    ts: `${Date.now()}`,
  };
}

/**
 * Batch send opportunities to Slack
 */
export const batchSendToSlack = internalAction({
  args: {
    opportunityIds: v.array(v.id("opportunities")),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const results: Array<{ opportunityId: string; success: boolean; [key: string]: any }> = [];

    for (const opportunityId of args.opportunityIds) {
      const result = await sendToSlack(ctx, { opportunityId, userId: args.userId });
      results.push({ opportunityId, ...result });
    }

    return {
      success: true,
      sent: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  },
});

/**
 * Handle Slack button interaction
 */
export const handleSlackFeedback = internalMutation({
  args: {
    opportunityId: v.id("opportunities"),
    userId: v.id("users"),
    feedbackType: v.union(v.literal("useful"), v.literal("not_useful")),
    slackTs: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Create feedback record
    await ctx.db.insert("proactiveFeedbackLabels", {
      opportunityId: args.opportunityId,
      userId: args.userId,
      feedbackType: args.feedbackType,
      source: "slack",
      contextSnapshot: {
        slackTs: args.slackTs,
      },
      createdAt: Date.now(),
    });

    // Update opportunity status
    await ctx.db.patch(args.opportunityId, {
      status: "completed",
      updatedAt: Date.now(),
    });

    console.log(
      `[SlackDelivery] Recorded ${args.feedbackType} feedback for opportunity ${args.opportunityId}`
    );

    return { success: true };
  },
});

/**
 * Handle Slack dismiss action
 */
export const handleSlackDismiss = internalMutation({
  args: {
    opportunityId: v.id("opportunities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Update opportunity status
    await ctx.db.patch(args.opportunityId, {
      status: "dismissed",
      updatedAt: Date.now(),
    });

    console.log(`[SlackDelivery] Dismissed opportunity ${args.opportunityId}`);

    return { success: true };
  },
});
