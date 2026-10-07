/**
 * Notification Tools - Push notification tools for coordinator agent
 *
 * Enables the agent to send real-time alerts to users via ntfy.
 */

"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api, internal } from "../../_generated/api";

/**
 * Send a push notification via ntfy
 *
 * This tool allows the coordinator agent to alert users about important
 * discoveries, breaking news, or task completions.
 */
export const sendNotification = createTool({
  description: `Send a push notification via ntfy to alert the user about important information.

Use this tool when:
- You discover breaking news that warrants immediate attention (major funding, security issue, acquisition)
- A research result reveals something critical that the user should know immediately
- The user explicitly asks to be notified about something
- You complete a long-running task and want to alert the user

DO NOT use for:
- Routine information that can wait for the daily digest
- Low-importance updates that aren't time-sensitive
- Information the user is actively viewing in the conversation
- Every single research result - be selective!

URGENCY GUIDELINES:
- critical: Security vulnerabilities, major acquisitions, breaking regulatory news
- high: Significant funding rounds ($50M+), important product launches
- medium: Notable news, task completions
- low: FYI updates, background task results

The user will receive a push notification on their phone/device.`,

  args: z.object({
    title: z.string().max(50).describe("Notification title (max 50 chars, be concise)"),
    body: z.string().max(500).describe("Notification body with key details (max 500 chars, be self-contained)"),
    urgency: z.enum(["critical", "high", "medium", "low"]).describe("Urgency level - critical/high sends immediately, medium/low may be batched"),
    tags: z.array(z.string()).optional().describe("Emoji tags for the notification (e.g., 'money', 'warning', 'fire', 'rocket')"),
    clickUrl: z.string().optional().describe("Optional URL to open when notification is clicked"),
    relatedEntity: z.string().optional().describe("Optional entity name this notification is about (for tracking)"),
  }),

  handler: async (ctx, args): Promise<{ sent: boolean; message: string }> => {
    const priority = args.urgency === "critical" ? 5 : args.urgency === "high" ? 4 : args.urgency === "medium" ? 3 : 2;

    try {
      await ctx.runAction(api.domains.integrations.ntfy.sendNotification, {
        title: args.title.slice(0, 50),
        body: args.body.slice(0, 500),
        priority: priority as 1 | 2 | 3 | 4 | 5,
        tags: args.tags || ["bell"],
        click: args.clickUrl,
        eventType: "agent_alert",
      });

      console.log(`[sendNotification] Alert sent: "${args.title}" (urgency=${args.urgency})`);

      return {
        sent: true,
        message: `Notification sent with ${args.urgency} priority. User will see: "${args.title}"`,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[sendNotification] Failed to send:`, error);
      return {
        sent: false,
        message: `Failed to send notification: ${errorMessage}`,
      };
    }
  },
});

/**
 * Schedule a notification for later
 *
 * Useful for reminders or delayed alerts.
 */
export const scheduleNotification = createTool({
  description: `Schedule a push notification to be sent at a specific time.

Use this for:
- Meeting reminders ("Remind me 15 minutes before the meeting")
- Task deadlines ("Alert me if I haven't finished by 5pm")
- Timed follow-ups ("Notify me tomorrow to check on this")

Note: The notification will be sent at the scheduled time regardless of whether the user is online.`,

  args: z.object({
    title: z.string().max(50).describe("Notification title"),
    body: z.string().max(500).describe("Notification body"),
    scheduledFor: z.string().describe("ISO 8601 timestamp when to send (e.g., '2025-01-06T09:00:00Z')"),
    urgency: z.enum(["critical", "high", "medium", "low"]).default("medium"),
    tags: z.array(z.string()).optional(),
  }),

  handler: async (ctx, args): Promise<{ scheduled: boolean; scheduledFor: string; message: string }> => {
    try {
      const scheduledTime = new Date(args.scheduledFor).getTime();
      const now = Date.now();
      const delayMs = Math.max(0, scheduledTime - now);

      if (delayMs < 0) {
        return {
          scheduled: false,
          scheduledFor: args.scheduledFor,
          message: "Cannot schedule notification in the past",
        };
      }

      // Use Convex scheduler to send at the specified time
      await ctx.scheduler.runAfter(delayMs, internal.domains.integrations.ntfy.sendScheduledNotification, {
        title: args.title,
        body: args.body,
        priority: args.urgency === "critical" ? 5 : args.urgency === "high" ? 4 : 3,
        tags: args.tags || ["clock"],
      });

      const formattedTime = new Date(scheduledTime).toLocaleString();

      return {
        scheduled: true,
        scheduledFor: args.scheduledFor,
        message: `Notification scheduled for ${formattedTime}`,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        scheduled: false,
        scheduledFor: args.scheduledFor,
        message: `Failed to schedule: ${errorMessage}`,
      };
    }
  },
});

/**
 * Check notification preferences
 *
 * Check if a user has notifications enabled before sending.
 */
export const checkNotificationPrefs = createTool({
  description: `Check if a user has push notifications enabled and what their preferences are.

Use this before sending non-critical notifications to respect user preferences.`,

  args: z.object({
    userId: z.string().optional().describe("User ID to check, defaults to current user"),
  }),

  handler: async (ctx, args): Promise<{
    enabled: boolean;
    topic: string | null;
    preferences: {
      morningDigest: boolean;
      breakingAlerts: boolean;
      taskReminders: boolean;
    };
  }> => {
    try {
      // Get user's notification preferences
      // Note: This assumes the context has userId or we can derive it
      const prefs = await ctx.runQuery(internal.domains.user.userNotificationPrefs.getPrefs as any, {
        userId: args.userId,
      });

      return {
        enabled: prefs?.notificationsEnabled ?? false,
        topic: prefs?.phoneNumber ?? null, // ntfy topic stored in phoneNumber field
        preferences: {
          morningDigest: prefs?.morningDigest ?? true,
          breakingAlerts: prefs?.breakingAlerts ?? true,
          taskReminders: prefs?.taskReminders ?? true,
        },
      };
    } catch (error: unknown) {
      // If we can't check, assume enabled
      return {
        enabled: true,
        topic: null,
        preferences: {
          morningDigest: true,
          breakingAlerts: true,
          taskReminders: true,
        },
      };
    }
  },
});
