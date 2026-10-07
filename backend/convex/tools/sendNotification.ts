// convex/tools/sendNotification.ts
// Push notification tool for Agent component with ntfy integration
//
// Replaces SMS with free push notifications via ntfy.sh
// Every notification is logged to smsLogs table for compatibility

"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../_generated/api";

/**
 * ntfy Push Notification Tool
 * 
 * Sends push notifications to users via ntfy.sh topics
 * Free alternative to SMS with same logging and tracking
 */
export const sendNotification = createTool({
  description: `Send a push notification to a user via ntfy.sh.

This is a free alternative to SMS that sends notifications to the user's phone or desktop.
Users subscribe to their personal topic to receive notifications.

Use this for:
- Meeting reminders and alerts
- Important updates and notifications
- Time-sensitive information
- Morning digests and summaries

The notification will be delivered instantly to all devices subscribed to the user's topic.`,

  args: z.object({
    topic: z
      .string()
      .optional()
      .describe("The ntfy topic to send to. Defaults to 'nodebench' if not specified. Users can subscribe to their personal topic."),
    body: z
      .string()
      .min(1)
      .max(4096)
      .describe("The notification message body. Keep it concise and actionable. Max 4096 characters."),
    title: z
      .string()
      .optional()
      .describe("Optional notification title. Appears as the notification header."),
    priority: z
      .enum(["1", "2", "3", "4", "5"])
      .optional()
      .describe("Notification priority: 1=min, 2=low, 3=default, 4=high, 5=urgent. Defaults to 3."),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional emoji tags for the notification (e.g., ['warning', 'fire', 'bell']). See ntfy.sh docs for available emojis."),
  }),

  handler: async (ctx, args): Promise<string> => {
    const topic = args.topic || "nodebench";

    // Validate message length
    if (args.body.length > 4096) {
      return `❌ Message too long: ${args.body.length} characters. Maximum is 4096 characters.`;
    }

    try {
      // Get userId from context if available
      const userId = (ctx as any).evaluationUserId ?? null;

      // Convert priority string to number
      const priority = args.priority ? parseInt(args.priority) as 1 | 2 | 3 | 4 | 5 : undefined;

      // Send notification via ntfy
      await ctx.runAction(api.domains.integrations.ntfy.sendNotification, {
        topic,
        body: args.body,
        title: args.title,
        priority,
        tags: args.tags,
        userId: userId,
        eventType: "agent_message",
      });

      // Calculate message stats
      const charCount = args.body.length;

      return `✅ Push notification sent successfully!

📱 Topic: ${topic}
${args.title ? `📌 Title: ${args.title}\n` : ""}📝 Message: "${args.body.slice(0, 50)}${args.body.length > 50 ? '...' : ''}"
📊 Length: ${charCount} characters
${args.priority ? `⚡ Priority: ${args.priority}/5\n` : ""}${args.tags ? `🏷️ Tags: ${args.tags.join(', ')}\n` : ""}
💰 Cost: FREE (ntfy.sh is free!)

The notification has been delivered to all devices subscribed to topic "${topic}".

To receive notifications, users should:
1. Install ntfy app (iOS/Android) or visit ntfy.sh
2. Subscribe to topic: ${topic}
3. Enable notifications in their device settings`;

    } catch (error: any) {
      console.error("[sendNotification] Error:", error);
      
      return `❌ Failed to send notification: ${error.message || "Unknown error"}. Please try again or contact support.`;
    }
  },
});
