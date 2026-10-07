/**
 * ntfy Push Notification Integration
 * 
 * Replaces SMS with push notifications via ntfy.sh
 * All original SMS features preserved: opt-out, opt-in, logging, cost tracking
 * 
 * ntfy.sh is a simple HTTP-based pub-sub notification service
 * Docs: https://docs.ntfy.sh/publish/
 */

import { internal } from "../../_generated/api";
import { action, internalAction, internalMutation, query } from "../../_generated/server";
import { v } from "convex/values";
import type { Id, Doc } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

// ------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------

const NTFY_BASE_URL = process.env.NTFY_BASE_URL || "https://ntfy.sh";
const NTFY_DEFAULT_TOPIC = process.env.NTFY_DEFAULT_TOPIC || "nodebench";

// Cost tracking (ntfy is free, but we track for comparison)
const NTFY_COSTS = {
  PER_MESSAGE_CENTS: 0, // Free!
};

// ------------------------------------------------------------------
// Helper Functions
// ------------------------------------------------------------------

/**
 * Calculate message segments (for comparison with SMS)
 */
function calculateSegments(message: string): number {
  const length = message.length;
  if (length <= 160) return 1;
  return Math.ceil(length / 153);
}

/**
 * Estimate cost for a notification in cents (always 0 for ntfy)
 */
function estimateCostCents(_segments: number): number {
  return NTFY_COSTS.PER_MESSAGE_CENTS;
}

/**
 * Check if ntfy is configured
 */
export const hasNtfyCreds = Boolean(NTFY_BASE_URL);

// ------------------------------------------------------------------
// Core ntfy Client
// ------------------------------------------------------------------

type NtfyResponse = {
  id?: string;
  time?: number;
  event?: string;
};

/**
 * Send a push notification via ntfy
 */
async function sendNtfyNotification(args: {
  topic: string;
  message: string;
  title?: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  click?: string;
  markdown?: boolean;
  attach?: string; // URL to attach (image)
  filename?: string;
  actions?: Array<{
    action: string;
    label: string;
    url: string;
  }>;
}): Promise<NtfyResponse> {
  const baseUrl = NTFY_BASE_URL.replace(/\/$/, "");
  const url = baseUrl;

  const payload: any = {
    topic: args.topic,
    message: args.message,
    markdown: args.markdown ?? true, // Enable markdown by default for rich formatting
  };

  if (args.title) payload.title = args.title;
  if (args.priority) payload.priority = args.priority;
  if (args.tags) payload.tags = args.tags;
  if (args.click) payload.click = args.click;
  if (args.attach) payload.attach = args.attach;
  if (args.filename) payload.filename = args.filename;
  if (args.actions) payload.actions = args.actions;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`ntfy request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as NtfyResponse;
}

// ------------------------------------------------------------------
// Internal mutation to log a notification with cost tracking
// ------------------------------------------------------------------
export const logNotification = internalMutation({
  args: {
    topic: v.string(),
    body: v.string(),
    status: v.string(),
    messageId: v.optional(v.string()),
    eventType: v.optional(v.string()), // "meeting_created" | "meeting_reminder" | "morning_digest"
    eventId: v.optional(v.id("events")),
    userId: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const segments = calculateSegments(args.body);
    const estimatedCost = estimateCostCents(segments);
    const now = Date.now();

    // Insert detailed notification log (reusing smsLogs table for compatibility)
    await ctx.db.insert("smsLogs", {
      to: args.topic, // Store topic in 'to' field
      body: args.body,
      status: args.status,
      createdAt: now,
      userId: args.userId,
      messageSid: args.messageId,
      eventType: args.eventType,
      eventId: args.eventId,
      segments,
      estimatedCostCents: estimatedCost,
    });

    return null;
  },
});

// ------------------------------------------------------------------
// Internal action to send a notification and log it
// ------------------------------------------------------------------
export const sendNotification = action({
  args: {
    topic: v.optional(v.string()),
    body: v.string(),
    title: v.optional(v.string()),
    priority: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4), v.literal(5))),
    tags: v.optional(v.array(v.string())),
    click: v.optional(v.string()),
    markdown: v.optional(v.boolean()),
    attach: v.optional(v.string()),
    filename: v.optional(v.string()),
    actions: v.optional(v.array(v.object({
      action: v.string(),
      label: v.string(),
      url: v.string(),
    }))),
    userId: v.optional(v.id("users")),
    eventType: v.optional(v.string()),
    eventId: v.optional(v.id("events")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const topic = args.topic || NTFY_DEFAULT_TOPIC;
    
    const response = await sendNtfyNotification({
      topic,
      message: args.body,
      title: args.title,
      priority: args.priority,
      tags: args.tags,
      click: args.click,
      markdown: args.markdown,
      attach: args.attach,
      filename: args.filename,
      actions: args.actions,
    });

    await ctx.runMutation(internal.domains.integrations.ntfy.logNotification, {
      topic,
      body: args.body,
      status: response.event || "sent",
      messageId: response.id,
      userId: args.userId,
      eventType: args.eventType,
      eventId: args.eventId,
    });

    return null;
  },
});

// ------------------------------------------------------------------
// Test notification action
// ------------------------------------------------------------------
export const testNtfyNotification = action({
  args: {
    topic: v.optional(v.string()),
    message: v.string(),
    title: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    response: v.any(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const topic = args.topic || NTFY_DEFAULT_TOPIC;
      console.log(`[ntfy.testNtfyNotification] Sending test notification to topic: ${topic}...`);
      console.log(`[ntfy.testNtfyNotification] Using ntfy URL: ${NTFY_BASE_URL}`);

      const response = await sendNtfyNotification({
        topic,
        message: args.message,
        title: args.title || "NodeBench Test",
        priority: 3,
        tags: ["test", "white_check_mark"],
      });

      console.log(`[ntfy.testNtfyNotification] ntfy response:`, JSON.stringify(response));

      return {
        success: true,
        response,
      };
    } catch (err: any) {
      console.error(`[ntfy.testNtfyNotification] Error:`, err);
      return {
        success: false,
        response: null,
        error: err?.message || String(err),
      };
    }
  },
});

// ------------------------------------------------------------------
// Meeting Created Notification
// ------------------------------------------------------------------
export const sendMeetingCreatedNotification = action({
  args: {
    userId: v.id("users"),
    eventId: v.id("events"),
    eventTitle: v.string(),
    eventStartTime: v.number(),
  },
  returns: v.object({
    sent: v.boolean(),
    status: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get user preferences
    const prefs = await ctx.runQuery(internal.domains.auth.userPreferences.getByUserId, {
      userId: args.userId,
    });

    if (!prefs || !prefs.smsNotificationsEnabled) {
      console.log(`[ntfy] Notifications disabled for user ${args.userId}`);
      return { sent: false };
    }

    // Get user's ntfy topic (stored in phoneNumber field for compatibility)
    if (!prefs.phoneNumber) {
      console.log(`[ntfy] No topic configured for user ${args.userId}`);
      return { sent: false };
    }

    // Format the notification
    const startTime = new Date(args.eventStartTime);
    const timeStr = startTime.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    const dateStr = startTime.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    const body = `📅 New meeting: ${args.eventTitle}\n⏰ ${dateStr} at ${timeStr}`;

    // Send the notification
    const response = await sendNtfyNotification({
      topic: prefs.phoneNumber, // Using phoneNumber field to store topic
      message: body,
      title: "Meeting Created",
      priority: 4,
      tags: ["calendar", "bell"],
    });

    // Log the notification
    await ctx.runMutation(internal.domains.integrations.ntfy.logNotification, {
      topic: prefs.phoneNumber,
      body,
      status: response.event || "sent",
      eventType: "meeting_created",
      eventId: args.eventId,
      userId: args.userId,
    });

    console.log(`[ntfy] Meeting created notification sent to topic ${prefs.phoneNumber}`);
    return { sent: true, status: response.event };
  },
});

// ------------------------------------------------------------------
// Meeting Reminder Notification
// ------------------------------------------------------------------
export const sendMeetingReminderNotification = action({
  args: {
    userId: v.id("users"),
    eventId: v.id("events"),
    eventTitle: v.string(),
    eventStartTime: v.number(),
    minutesUntil: v.number(),
  },
  returns: v.object({
    sent: v.boolean(),
    status: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get user preferences
    const prefs = await ctx.runQuery(internal.domains.auth.userPreferences.getByUserId, {
      userId: args.userId,
    });

    if (!prefs || !prefs.smsNotificationsEnabled) {
      console.log(`[ntfy] Notifications disabled for user ${args.userId}`);
      return { sent: false };
    }

    if (!prefs.phoneNumber) {
      console.log(`[ntfy] No topic configured for user ${args.userId}`);
      return { sent: false };
    }

    // Format the notification
    const body = `⏰ Reminder: "${args.eventTitle}" starts in ${args.minutesUntil} minutes`;

    // Send the notification
    const response = await sendNtfyNotification({
      topic: prefs.phoneNumber,
      message: body,
      title: "Meeting Reminder",
      priority: 5, // High priority for reminders
      tags: ["alarm_clock", "warning"],
    });

    // Log the notification
    await ctx.runMutation(internal.domains.integrations.ntfy.logNotification, {
      topic: prefs.phoneNumber,
      body,
      status: response.event || "sent",
      eventType: "meeting_reminder",
      eventId: args.eventId,
      userId: args.userId,
    });

    console.log(`[ntfy] Meeting reminder sent to topic ${prefs.phoneNumber}`);
    return { sent: true, status: response.event };
  },
});

// ------------------------------------------------------------------
// Morning Digest Notification
// ------------------------------------------------------------------
export const sendMorningDigestNotification = action({
  args: {
    userId: v.id("users"),
    meetings: v.array(
      v.object({
        title: v.string(),
        startTime: v.number(),
      })
    ),
  },
  returns: v.object({
    sent: v.boolean(),
    status: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get user preferences
    const prefs = await ctx.runQuery(internal.domains.auth.userPreferences.getByUserId, {
      userId: args.userId,
    });

    if (!prefs || !prefs.smsNotificationsEnabled) {
      console.log(`[ntfy] Notifications disabled for user ${args.userId}`);
      return { sent: false };
    }

    if (!prefs.phoneNumber) {
      console.log(`[ntfy] No topic configured for user ${args.userId}`);
      return { sent: false };
    }

    // Format the message
    let body = `☀️ Good morning! You have ${args.meetings.length} meeting${args.meetings.length !== 1 ? "s" : ""} today:\n\n`;

    for (const meeting of args.meetings.slice(0, 5)) {
      const time = new Date(meeting.startTime).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      body += `• ${time}: ${meeting.title}\n`;
    }

    if (args.meetings.length > 5) {
      body += `\n...and ${args.meetings.length - 5} more`;
    }

    // Send the notification
    const response = await sendNtfyNotification({
      topic: prefs.phoneNumber,
      message: body,
      title: "Morning Digest",
      priority: 3,
      tags: ["sunny", "calendar"],
    });

    // Log the notification
    await ctx.runMutation(internal.domains.integrations.ntfy.logNotification, {
      topic: prefs.phoneNumber,
      body,
      status: response.event || "sent",
      eventType: "morning_digest",
      userId: args.userId,
    });

    console.log(`[ntfy] Morning digest sent to topic ${prefs.phoneNumber}`);
    return { sent: true, status: response.event };
  },
});

// ------------------------------------------------------------------
// Opt-out handler (disable notifications for a topic)
// ------------------------------------------------------------------
export const handleNotificationOptOut = internalMutation({
  args: {
    topic: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find user by topic (stored in phoneNumber field)
    const allPrefs = await ctx.db.query("userPreferences").collect() as Doc<"userPreferences">[];

    for (const prefs of allPrefs) {
      if (prefs.phoneNumber === args.topic) {
        await ctx.db.patch(prefs._id, {
          smsNotificationsEnabled: false,
        });
        console.log(`[ntfy] Opt-out: Disabled notifications for user ${prefs.userId}`);
      }
    }

    // Log the opt-out
    await ctx.db.insert("smsLogs", {
      to: args.topic,
      body: "[OPT-OUT RECEIVED]",
      status: "opt_out",
      createdAt: Date.now(),
    });

    return null;
  },
});

// ------------------------------------------------------------------
// Opt-in handler (enable notifications for a topic)
// ------------------------------------------------------------------
export const handleNotificationOptIn = internalMutation({
  args: {
    topic: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find user by topic (stored in phoneNumber field)
    const allPrefs = await ctx.db.query("userPreferences").collect() as Doc<"userPreferences">[];

    for (const prefs of allPrefs) {
      if (prefs.phoneNumber === args.topic) {
        await ctx.db.patch(prefs._id, {
          smsNotificationsEnabled: true,
        });
        console.log(`[ntfy] Opt-in: Enabled notifications for user ${prefs.userId}`);
      }
    }

    // Log the opt-in
    await ctx.db.insert("smsLogs", {
      to: args.topic,
      body: "[OPT-IN RECEIVED]",
      status: "opt_in",
      createdAt: Date.now(),
    });

    return null;
  },
});


// ------------------------------------------------------------------
// Scheduled Notification (for scheduler-based alerts)
// ------------------------------------------------------------------
export const sendScheduledNotification = internalAction({
  args: {
    title: v.string(),
    body: v.string(),
    priority: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4), v.literal(5))),
    tags: v.optional(v.array(v.string())),
    topic: v.optional(v.string()),
    click: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const topic = args.topic || NTFY_DEFAULT_TOPIC;

    try {
      const response = await sendNtfyNotification({
        topic,
        message: args.body,
        title: args.title,
        priority: args.priority ?? 3,
        tags: args.tags,
        click: args.click,
      });

      // Log the scheduled notification
      await ctx.runMutation(internal.domains.integrations.ntfy.logNotification, {
        topic,
        body: args.body,
        status: response.event || "sent",
        messageId: response.id,
        eventType: "scheduled_notification",
      });

      console.log(`[ntfy.sendScheduledNotification] Scheduled notification sent to ${topic}`);
      return { success: true, response };
    } catch (err: any) {
      console.error(`[ntfy.sendScheduledNotification] Error:`, err);
      return { success: false, error: err?.message || String(err) };
    }
  },
});

// ------------------------------------------------------------------
// Query: Get notification logs
// ------------------------------------------------------------------
export const getNotificationLogs = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 50;
    const logs = await ctx.db
      .query("smsLogs")
      .filter((q) => q.eq(q.field("userId"), userId))
      .order("desc")
      .take(limit) as Doc<"smsLogs">[];

    return logs;
  },
});

// ------------------------------------------------------------------
// Query: Get notification stats
// ------------------------------------------------------------------
export const getNotificationStats = query({
  args: {},
  returns: v.object({
    totalSent: v.number(),
    totalCost: v.number(),
    last24Hours: v.number(),
    last7Days: v.number(),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        totalSent: 0,
        totalCost: 0,
        last24Hours: 0,
        last7Days: 0,
      };
    }

    const allLogs = await ctx.db
      .query("smsLogs")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect() as Doc<"smsLogs">[];

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const totalSent = allLogs.length;
    const totalCost = allLogs.reduce((sum: number, log: Doc<"smsLogs">) => sum + (log.estimatedCostCents || 0), 0);
    const last24Hours = allLogs.filter((log: Doc<"smsLogs">) => log.createdAt >= oneDayAgo).length;
    const last7Days = allLogs.filter((log: Doc<"smsLogs">) => log.createdAt >= sevenDaysAgo).length;

    return {
      totalSent,
      totalCost,
      last24Hours,
      last7Days,
    };
  },
});

// ------------------------------------------------------------------
// Query: Get notification logs for the default topic
// ------------------------------------------------------------------
export const getTopicNotificationLogs = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const logs = await ctx.db
      .query("smsLogs")
      .filter((q) => q.eq(q.field("to"), NTFY_DEFAULT_TOPIC))
      .order("desc")
      .take(limit) as Doc<"smsLogs">[];

    return logs;
  },
});

// ------------------------------------------------------------------
// Query: Get notification stats for the default topic
// ------------------------------------------------------------------
export const getTopicNotificationStats = query({
  args: {},
  returns: v.object({
    totalSent: v.number(),
    totalCost: v.number(),
    last24Hours: v.number(),
    last7Days: v.number(),
  }),
  handler: async (ctx) => {
    const allLogs = await ctx.db
      .query("smsLogs")
      .filter((q) => q.eq(q.field("to"), NTFY_DEFAULT_TOPIC))
      .collect() as Doc<"smsLogs">[];

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const totalSent = allLogs.length;
    const totalCost = allLogs.reduce((sum: number, log: Doc<"smsLogs">) => sum + (log.estimatedCostCents || 0), 0);
    const last24Hours = allLogs.filter((log: Doc<"smsLogs">) => log.createdAt >= oneDayAgo).length;
    const last7Days = allLogs.filter((log: Doc<"smsLogs">) => log.createdAt >= sevenDaysAgo).length;

    return {
      totalSent,
      totalCost,
      last24Hours,
      last7Days,
    };
  },
});

// ------------------------------------------------------------------
// Enhanced Actionable Notification (with quick-reply buttons)
// ------------------------------------------------------------------

/**
 * ntfy action types:
 * - "view": Open URL in browser
 * - "http": POST/PUT to URL
 * - "broadcast": Send Android broadcast intent
 */
export type NtfyActionType = "view" | "http" | "broadcast";

export const sendActionableNotification = action({
  args: {
    topic: v.optional(v.string()),
    title: v.string(),
    body: v.string(),
    priority: v.optional(v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4), v.literal(5))),
    tags: v.optional(v.array(v.string())),
    click: v.optional(v.string()),
    actions: v.array(v.object({
      action: v.string(),  // "view", "http", or "broadcast"
      label: v.string(),   // Button text
      url: v.string(),     // URL to open or POST to
      method: v.optional(v.string()),  // For http: "POST", "PUT", etc.
      headers: v.optional(v.any()),    // For http: custom headers
      body: v.optional(v.string()),    // For http: request body
      clear: v.optional(v.boolean()),  // Dismiss notification after action
    })),
    userId: v.optional(v.id("users")),
    eventType: v.optional(v.string()),
  },
  returns: v.object({
    sent: v.boolean(),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const topic = args.topic || NTFY_DEFAULT_TOPIC;

    try {
      const response = await sendNtfyNotification({
        topic,
        message: args.body,
        title: args.title,
        priority: args.priority,
        tags: args.tags,
        click: args.click,
        actions: args.actions.map((a: { action: string; label: string; url: string; method?: string; headers?: any; body?: string; clear?: boolean }) => ({
          action: a.action,
          label: a.label,
          url: a.url,
          ...(a.method && { method: a.method }),
          ...(a.headers && { headers: a.headers }),
          ...(a.body && { body: a.body }),
          ...(a.clear && { clear: a.clear }),
        })),
      });

      // Log the notification
      await ctx.runMutation(internal.domains.integrations.ntfy.logNotification, {
        topic,
        body: args.body,
        status: response.event || "sent",
        messageId: response.id,
        eventType: args.eventType || "actionable_notification",
        userId: args.userId,
      });

      console.log(`[ntfy] Actionable notification sent to ${topic}`);
      return { sent: true, messageId: response.id };
    } catch (err: any) {
      console.error(`[ntfy] sendActionableNotification error:`, err);
      return { sent: false, error: err?.message || String(err) };
    }
  },
});

// ------------------------------------------------------------------
// Digest with Action Buttons
// ------------------------------------------------------------------

/**
 * Send a digest notification with "Tell me more" buttons.
 * Each button opens a deep link to the web app or triggers a webhook.
 */
export const sendDigestWithActions = action({
  args: {
    topic: v.optional(v.string()),
    title: v.string(),
    items: v.array(v.object({
      headline: v.string(),
      summary: v.string(),
      actionUrl: v.optional(v.string()),
      actionLabel: v.optional(v.string()),
    })),
    userId: v.optional(v.id("users")),
    appBaseUrl: v.optional(v.string()),
  },
  returns: v.object({
    sent: v.boolean(),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const topic = args.topic || NTFY_DEFAULT_TOPIC;
    const baseUrl = args.appBaseUrl || "https://nodebench.ai";

    // Build markdown body
    let body = "";
    for (let i = 0; i < args.items.length && i < 5; i++) {
      const item = args.items[i];
      body += `**${i + 1}. ${item.headline}**\n${item.summary}\n\n`;
    }

    if (args.items.length > 5) {
      body += `_...and ${args.items.length - 5} more_\n`;
    }

    // Build action buttons (max 3 for ntfy)
    const actions = args.items.slice(0, 3).map((item: { title: string; url?: string }, i: number) => ({
      action: "view" as const,
      label: (item as any).actionLabel || `More on #${i + 1}`,
      url: (item as any).actionUrl || `${baseUrl}/digest`,
    }));

    try {
      const response = await sendNtfyNotification({
        topic,
        message: body,
        title: args.title,
        priority: 3,
        tags: ["newspaper", "star"],
        click: `${baseUrl}/digest`,
        actions,
        markdown: true,
      });

      // Log the notification
      await ctx.runMutation(internal.domains.integrations.ntfy.logNotification, {
        topic,
        body,
        status: response.event || "sent",
        messageId: response.id,
        eventType: "digest_with_actions",
        userId: args.userId,
      });

      console.log(`[ntfy] Digest with actions sent to ${topic}`);
      return { sent: true, messageId: response.id };
    } catch (err: any) {
      console.error(`[ntfy] sendDigestWithActions error:`, err);
      return { sent: false, error: err?.message || String(err) };
    }
  },
});

// ------------------------------------------------------------------
// Breaking Alert with Priority
// ------------------------------------------------------------------

/**
 * Send a high-priority breaking alert.
 * Used for urgent funding news, critical updates, etc.
 */
export const sendBreakingAlert = action({
  args: {
    topic: v.optional(v.string()),
    title: v.string(),
    body: v.string(),
    sourceUrl: v.optional(v.string()),
    entityName: v.optional(v.string()),
    alertType: v.optional(v.union(
      v.literal("funding"),
      v.literal("acquisition"),
      v.literal("ipo"),
      v.literal("breaking_news"),
      v.literal("system_alert")
    )),
    userId: v.optional(v.id("users")),
  },
  returns: v.object({
    sent: v.boolean(),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const topic = args.topic || NTFY_DEFAULT_TOPIC;

    // Select emoji/tag based on alert type
    const tagMap: Record<string, string[]> = {
      funding: ["moneybag", "chart_with_upwards_trend"],
      acquisition: ["handshake", "building"],
      ipo: ["rocket", "stock_chart"],
      breaking_news: ["rotating_light", "newspaper"],
      system_alert: ["warning", "gear"],
    };

    const tags = tagMap[args.alertType || "breaking_news"] || ["bell"];

    // Build actions
    const actions: any[] = [];
    if (args.sourceUrl) {
      actions.push({
        action: "view" as const,
        label: "View Source",
        url: args.sourceUrl,
      });
    }
    if (args.entityName) {
      actions.push({
        action: "view" as const,
        label: `Research ${args.entityName}`,
        url: `https://nodebench.ai/search?q=${encodeURIComponent(args.entityName)}`,
      });
    }

    try {
      const response = await sendNtfyNotification({
        topic,
        message: args.body,
        title: `🚨 ${args.title}`,
        priority: 5, // Max priority for breaking alerts
        tags,
        click: args.sourceUrl,
        actions: actions.length > 0 ? actions : undefined,
        markdown: true,
      });

      // Log the notification
      await ctx.runMutation(internal.domains.integrations.ntfy.logNotification, {
        topic,
        body: args.body,
        status: response.event || "sent",
        messageId: response.id,
        eventType: `breaking_${args.alertType || "alert"}`,
        userId: args.userId,
      });

      console.log(`[ntfy] Breaking alert sent to ${topic}: ${args.title}`);
      return { sent: true, messageId: response.id };
    } catch (err: any) {
      console.error(`[ntfy] sendBreakingAlert error:`, err);
      return { sent: false, error: err?.message || String(err) };
    }
  },
});
