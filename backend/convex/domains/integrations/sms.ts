import { Twilio, messageValidator } from "@convex-dev/twilio";
import { components, internal } from "../../_generated/api";
import { action, internalAction, internalMutation, internalQuery, query } from "../../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

// ------------------------------------------------------------------
// SMS COST CONSTANTS (A2P 10DLC pricing as of December 2024)
// ------------------------------------------------------------------
export const SMS_COSTS = {
  // Per-segment costs (in cents)
  OUTBOUND_PER_SEGMENT_CENTS: 0.79,    // Twilio outbound SMS
  A2P_CARRIER_FEE_CENTS: 0.30,         // A2P 10DLC carrier fees (average)
  INBOUND_PER_SEGMENT_CENTS: 0.79,     // Twilio inbound SMS

  // Monthly recurring costs
  CAMPAIGN_MONTHLY_FEE_MIN: 150,       // $1.50 min (in cents)
  CAMPAIGN_MONTHLY_FEE_MAX: 1000,      // $10.00 max (in cents)

  // One-time costs
  VETTING_FEE_CENTS: 1500,             // $15 one-time vetting fee

  // Total estimated per-message cost
  get TOTAL_PER_SEGMENT_CENTS() {
    return this.OUTBOUND_PER_SEGMENT_CENTS + this.A2P_CARRIER_FEE_CENTS;
  }
};

/**
 * Calculate SMS segments based on message length
 * GSM-7: 160 chars per segment (or 153 for multi-part)
 * UCS-2: 70 chars per segment (or 67 for multi-part)
 */
function calculateSegments(body: string): number {
  // Check if message contains non-GSM characters (emojis, unicode)
  const gsm7Chars = /^[\x20-\x7E\xA0\xA1\xA3-\xA5\xA7\xBF\xC4-\xC6\xC9\xD1\xD6\xD8\xDC\xDF-\xE6\xE8-\xF1\xF2\xF6\xF8\xFC\u0394\u03A6\u0393\u039B\u03A9\u03A0\u03A8\u03A3\u0398\u039E\r\n]*$/;
  const isGsm7 = gsm7Chars.test(body);

  const length = body.length;
  if (isGsm7) {
    // GSM-7 encoding
    if (length <= 160) return 1;
    return Math.ceil(length / 153);
  } else {
    // UCS-2 encoding (unicode/emoji)
    if (length <= 70) return 1;
    return Math.ceil(length / 67);
  }
}

/**
 * Estimate cost for an SMS in cents
 */
function estimateCostCents(segments: number): number {
  return Math.round(segments * SMS_COSTS.TOTAL_PER_SEGMENT_CENTS * 100) / 100;
}

// ------------------------------------------------------------------
// Twilio component client (mocked if credentials are missing)
// ------------------------------------------------------------------
export const hasTwilioCreds = Boolean(
  process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER,
);

type TwilioLike = {
  sendMessage: (
    ctx: any,
    args: { to: string; body: string },
  ) => Promise<{ sid?: string; status?: string }>;
};

// Full Twilio component instance (for route registration and full features)
export const twilioComponent = hasTwilioCreds
  ? new Twilio((components as any).twilio, { defaultFrom: process.env.TWILIO_PHONE_NUMBER! })
  : null;

// Set up incoming message callback for the Twilio component
// This handles STOP/HELP/START keywords and logs conversational messages
if (twilioComponent) {
  twilioComponent.incomingMessageCallback = internal.domains.integrations.sms.handleIncomingTwilioMessage;
}

export const twilio: TwilioLike = twilioComponent ?? {
      async sendMessage(_ctx, _args) {
        // Mocked response for builds/tests without Twilio credentials
        return { sid: "mock_sid", status: "mocked" };
      },
    };

// ------------------------------------------------------------------
// Incoming message callback handler (called by Twilio component)
// Processes STOP, HELP, START keywords and logs messages
// ------------------------------------------------------------------
export const handleIncomingTwilioMessage = internalMutation({
  args: {
    message: messageValidator,
  },
  handler: async (ctx, { message }) => {
    const body = (message.body || "").trim();
    const from = message.from || "";
    const normalizedBody = body.toUpperCase();

    // Define keyword sets
    const STOP_KEYWORDS = ["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
    const START_KEYWORDS = ["START", "YES", "UNSTOP", "SUBSCRIBE"];
    const HELP_KEYWORDS = ["HELP", "INFO"];

    console.log(`[sms.handleIncomingTwilioMessage] From: ${from}, Body: "${body}"`);

    if (STOP_KEYWORDS.includes(normalizedBody)) {
      // User wants to opt-out - find and update user by phone number
      const user = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("phone"), from))
        .first() as Doc<"users"> | null;

      if (user) {
        // Check if user has SMS preferences in userPreferences table
        const prefs = await ctx.db
          .query("userPreferences")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .first() as Doc<"userPreferences"> | null;

        if (prefs) {
          await ctx.db.patch(prefs._id, { smsNotificationsEnabled: false });
          console.log(`[sms] Opt-out processed for user ${user._id}`);
        }
      }
    } else if (START_KEYWORDS.includes(normalizedBody)) {
      // User wants to opt back in
      const user = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("phone"), from))
        .first() as Doc<"users"> | null;

      if (user) {
        const prefs = await ctx.db
          .query("userPreferences")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .first() as Doc<"userPreferences"> | null;

        if (prefs) {
          await ctx.db.patch(prefs._id, { smsNotificationsEnabled: true });
          console.log(`[sms] Opt-in processed for user ${user._id}`);
        }
      }
    }
    // For HELP and other messages, the component handles the response
    // Conversational messages are automatically logged by the component
  },
});

// ------------------------------------------------------------------
// Internal mutation to log an SMS with cost tracking
// ------------------------------------------------------------------
export const logSms = internalMutation({
  args: {
    to: v.string(),
    body: v.string(),
    status: v.string(),
    messageSid: v.optional(v.string()),
    eventType: v.optional(v.string()), // "meeting_created" | "meeting_reminder" | "morning_digest"
    eventId: v.optional(v.id("events")),
    userId: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const segments = calculateSegments(args.body);
    const estimatedCost = estimateCostCents(segments);
    const now = Date.now();

    // Insert detailed SMS log
    await ctx.db.insert("smsLogs", {
      to: args.to,
      body: args.body,
      status: args.status,
      createdAt: now,
      userId: args.userId,
      messageSid: args.messageSid,
      eventType: args.eventType,
      eventId: args.eventId,
      segments,
      estimatedCostCents: estimatedCost,
    });

    // Update daily aggregates if userId is provided
    if (args.userId) {
      const dateStr = new Date(now).toISOString().split("T")[0];
      const isSuccess = args.status === "sent" || args.status === "delivered";

      // Find or create daily aggregate
      const existing = await ctx.db
        .query("smsUsageDaily")
        .withIndex("by_user_date", (q) => q.eq("userId", args.userId).eq("date", dateStr))
        .first() as Doc<"smsUsageDaily"> | null;

      if (existing) {
        await ctx.db.patch(existing._id, {
          totalMessages: existing.totalMessages + 1,
          successfulMessages: existing.successfulMessages + (isSuccess ? 1 : 0),
          failedMessages: existing.failedMessages + (isSuccess ? 0 : 1),
          totalSegments: existing.totalSegments + segments,
          estimatedCostCents: existing.estimatedCostCents + estimatedCost,
          meetingCreatedCount: (existing.meetingCreatedCount || 0) + (args.eventType === "meeting_created" ? 1 : 0),
          meetingReminderCount: (existing.meetingReminderCount || 0) + (args.eventType === "meeting_reminder" ? 1 : 0),
          morningDigestCount: (existing.morningDigestCount || 0) + (args.eventType === "morning_digest" ? 1 : 0),
        });
      } else {
        await ctx.db.insert("smsUsageDaily", {
          userId: args.userId,
          date: dateStr,
          totalMessages: 1,
          successfulMessages: isSuccess ? 1 : 0,
          failedMessages: isSuccess ? 0 : 1,
          totalSegments: segments,
          estimatedCostCents: estimatedCost,
          meetingCreatedCount: args.eventType === "meeting_created" ? 1 : 0,
          meetingReminderCount: args.eventType === "meeting_reminder" ? 1 : 0,
          morningDigestCount: args.eventType === "morning_digest" ? 1 : 0,
        });
      }
    }

    return null;
  },
});

// ------------------------------------------------------------------
// Internal action to send an SMS and schedule log write
// ------------------------------------------------------------------
export const sendSms = action({
  args: {
    to: v.string(),
    body: v.string(),
    userId: v.optional(v.id("users")),
    eventType: v.optional(v.string()),
    eventId: v.optional(v.id("events")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const response = await twilio.sendMessage(ctx, { to: args.to, body: args.body });
    await ctx.runMutation(internal.domains.integrations.sms.logSms, {
      to: args.to,
      body: args.body,
      status: response.status ?? "unknown",
      messageSid: response.sid,
      userId: args.userId,
      eventType: args.eventType,
      eventId: args.eventId,
    });
    return null;
  },
});

// ------------------------------------------------------------------
// Debug action: Test Twilio SMS and return full response
// ------------------------------------------------------------------
export const testTwilioSms = internalAction({
  args: {
    to: v.string(),
    body: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    response: v.any(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      console.log(`[sms.testTwilioSms] Sending test SMS to ${args.to}...`);
      console.log(`[sms.testTwilioSms] Using Twilio phone: ${process.env.TWILIO_PHONE_NUMBER}`);
      console.log(`[sms.testTwilioSms] Account SID: ${process.env.TWILIO_ACCOUNT_SID?.substring(0, 10)}...`);

      const response = await twilio.sendMessage(ctx, args);
      console.log(`[sms.testTwilioSms] Twilio response:`, JSON.stringify(response));

      return {
        success: true,
        response,
      };
    } catch (err: any) {
      console.error(`[sms.testTwilioSms] Error:`, err);
      return {
        success: false,
        response: null,
        error: err?.message || String(err),
      };
    }
  },
});

// ------------------------------------------------------------------
// Debug action: Check message status by SID using Twilio REST API directly
// ------------------------------------------------------------------
export const checkMessageStatus = internalAction({
  args: {
    messageSid: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const authToken = process.env.TWILIO_AUTH_TOKEN!;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${args.messageSid}.json`;

    // Use btoa for base64 encoding (works in Convex runtime)
    const credentials = btoa(`${accountSid}:${authToken}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    });

    const data = await response.json();
    console.log(`[sms.checkMessageStatus] Message ${args.messageSid} status:`, JSON.stringify(data));

    return {
      sid: data.sid,
      status: data.status,
      errorCode: data.error_code,
      errorMessage: data.error_message,
      to: data.to,
      from: data.from,
      dateSent: data.date_sent,
      dateUpdated: data.date_updated,
    };
  },
});

// ------------------------------------------------------------------
// Get user's SMS preferences (internal query)
// ------------------------------------------------------------------
export const getUserSmsPrefs = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first() as Doc<"userPreferences"> | null;

    if (!prefs) {
      return null;
    }

    // Only return if SMS is enabled and phone number is set
    if (!prefs.smsNotificationsEnabled || !prefs.phoneNumber) {
      return null;
    }

    return {
      phoneNumber: prefs.phoneNumber,
      smsMeetingCreated: prefs.smsMeetingCreated ?? false,
      smsMeetingReminder: prefs.smsMeetingReminder ?? false,
      smsMorningDigest: prefs.smsMorningDigest ?? false,
      smsReminderMinutes: prefs.smsReminderMinutes ?? 15,
    };
  },
});

// ------------------------------------------------------------------
// Send meeting created notification
// ------------------------------------------------------------------
export const sendMeetingCreatedSms = internalAction({
  args: {
    userId: v.id("users"),
    eventId: v.id("events"),
    title: v.string(),
    startTime: v.number(),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get user's SMS preferences
    const prefs: any = await ctx.runQuery(internal.domains.integrations.sms.getUserSmsPrefs, {
      userId: args.userId,
    });

    if (!prefs || !prefs.smsMeetingCreated) {
      console.log("[sms] Meeting created notification skipped - SMS not enabled or meeting created notifications disabled");
      return { sent: false, reason: "sms_disabled" };
    }

    // Format the message
    const date = new Date(args.startTime);
    const timeStr = date.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });

    let body = `📅 New meeting added: "${args.title}" on ${timeStr}`;
    if (args.location) {
      body += ` at ${args.location}`;
    }

    // Send the SMS
    const status = await twilio.sendMessage(ctx, {
      to: prefs.phoneNumber,
      body,
    });

    // Log the SMS
    await ctx.runMutation(internal.domains.integrations.sms.logSms, {
      to: prefs.phoneNumber,
      body,
      status: status.status ?? "unknown",
      eventType: "meeting_created",
      eventId: args.eventId,
      userId: args.userId,
    });

    console.log(`[sms] Meeting created notification sent to ${prefs.phoneNumber}`);
    return { sent: true, status: status.status };
  },
});

// ------------------------------------------------------------------
// Send meeting reminder notification (before meeting starts)
// ------------------------------------------------------------------
export const sendMeetingReminderSms = internalAction({
  args: {
    userId: v.id("users"),
    eventId: v.id("events"),
    title: v.string(),
    startTime: v.number(),
    location: v.optional(v.string()),
    minutesBefore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get user's SMS preferences
    const prefs: any = await ctx.runQuery(internal.domains.integrations.sms.getUserSmsPrefs, {
      userId: args.userId,
    });

    if (!prefs || !prefs.smsMeetingReminder) {
      console.log("[sms] Meeting reminder skipped - SMS not enabled or meeting reminders disabled");
      return { sent: false, reason: "sms_disabled" };
    }

    // Format the message
    const minutesBefore = args.minutesBefore ?? prefs.smsReminderMinutes ?? 15;
    const date = new Date(args.startTime);
    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

    let body = `⏰ Reminder: "${args.title}" starts in ${minutesBefore} minutes at ${timeStr}`;
    if (args.location) {
      body += ` - ${args.location}`;
    }

    // Send the SMS
    const status = await twilio.sendMessage(ctx, {
      to: prefs.phoneNumber,
      body,
    });

    // Log the SMS
    await ctx.runMutation(internal.domains.integrations.sms.logSms, {
      to: prefs.phoneNumber,
      body,
      status: status.status ?? "unknown",
      eventType: "meeting_reminder",
      eventId: args.eventId,
      userId: args.userId,
    });

    console.log(`[sms] Meeting reminder sent to ${prefs.phoneNumber}`);
    return { sent: true, status: status.status };
  },
});

// ------------------------------------------------------------------
// Send morning digest SMS with today's meetings
// ------------------------------------------------------------------
export const sendMorningDigestSms = internalAction({
  args: {
    userId: v.id("users"),
    meetings: v.array(v.object({
      title: v.string(),
      startTime: v.number(),
      endTime: v.optional(v.number()),
      location: v.optional(v.string()),
    })),
    dateString: v.string(),
  },
  handler: async (ctx, args) => {
    // Get user's SMS preferences
    const prefs: any = await ctx.runQuery(internal.domains.integrations.sms.getUserSmsPrefs, {
      userId: args.userId,
    });

    if (!prefs || !prefs.smsMorningDigest) {
      console.log("[sms] Morning digest SMS skipped - SMS not enabled or morning digest disabled");
      return { sent: false, reason: "sms_disabled" };
    }

    if (args.meetings.length === 0) {
      console.log("[sms] Morning digest SMS skipped - no meetings today");
      return { sent: false, reason: "no_meetings" };
    }

    // Format the message
    let body = `☀️ Good morning! You have ${args.meetings.length} meeting${args.meetings.length !== 1 ? "s" : ""} today:\n\n`;

    for (const meeting of args.meetings.slice(0, 5)) { // Limit to 5 meetings to keep SMS short
      const time = new Date(meeting.startTime).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      body += `• ${time}: ${meeting.title}\n`;
    }

    if (args.meetings.length > 5) {
      body += `\n...and ${args.meetings.length - 5} more`;
    }

    // Send the SMS
    const status = await twilio.sendMessage(ctx, {
      to: prefs.phoneNumber,
      body,
    });

    // Log the SMS
    await ctx.runMutation(internal.domains.integrations.sms.logSms, {
      to: prefs.phoneNumber,
      body,
      status: status.status ?? "unknown",
      eventType: "morning_digest",
      userId: args.userId,
    });

    console.log(`[sms] Morning digest sent to ${prefs.phoneNumber}`);
    return { sent: true, status: status.status };
  },
});

// ------------------------------------------------------------------
// Get users with SMS enabled for morning digest (internal query)
// ------------------------------------------------------------------
export const getUsersWithSmsEnabled = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Get all user preferences with SMS enabled
    const allPrefs = await ctx.db.query("userPreferences").collect() as Doc<"userPreferences">[];

    const usersWithSms: Array<{
      userId: Id<"users">;
      phoneNumber: string;
      smsMorningDigest: boolean;
      smsMeetingReminder: boolean;
      smsReminderMinutes: number;
    }> = [];

    for (const prefs of allPrefs) {
      if (prefs.smsNotificationsEnabled && prefs.phoneNumber) {
        usersWithSms.push({
          userId: prefs.userId,
          phoneNumber: prefs.phoneNumber,
          smsMorningDigest: prefs.smsMorningDigest ?? false,
          smsMeetingReminder: prefs.smsMeetingReminder ?? false,
          smsReminderMinutes: prefs.smsReminderMinutes ?? 15,
        });
      }
    }

    return usersWithSms;
  },
});

// ------------------------------------------------------------------
// Get upcoming meetings that need reminders (internal query)
// ------------------------------------------------------------------
export const getUpcomingMeetingsForReminders = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Look ahead 30 minutes max
    const maxLookAhead = 30 * 60 * 1000;
    const endWindow = now + maxLookAhead;

    // Get all user preferences with SMS meeting reminders enabled
    const allPrefs = await ctx.db.query("userPreferences").collect() as Doc<"userPreferences">[];
    const usersWithReminders = allPrefs.filter(
      (p: Doc<"userPreferences">) => p.smsNotificationsEnabled && p.phoneNumber && p.smsMeetingReminder
    );

    if (usersWithReminders.length === 0) {
      return [];
    }

    const results: Array<{
      userId: Id<"users">;
      phoneNumber: string;
      eventId: Id<"events">;
      title: string;
      startTime: number;
      location?: string;
      reminderMinutes: number;
    }> = [];

    for (const prefs of usersWithReminders) {
      const reminderMinutes = prefs.smsReminderMinutes ?? 15;
      const reminderWindow = reminderMinutes * 60 * 1000;

      // Find events starting within the reminder window
      // Event should start between (now + reminderMinutes - 5min) and (now + reminderMinutes + 5min)
      // This gives a 10-minute window to catch the reminder
      const targetTime = now + reminderWindow;
      const windowStart = targetTime - 5 * 60 * 1000;
      const windowEnd = targetTime + 5 * 60 * 1000;

      const events = await ctx.db
        .query("events")
        .withIndex("by_user_start", (q) =>
          q.eq("userId", prefs.userId).gte("startTime", windowStart).lte("startTime", windowEnd)
        )
        .collect() as Doc<"events">[];

      for (const event of events) {
        // Skip cancelled events
        if (event.status === "cancelled") continue;

        // Check if we already sent a reminder for this event (using smsLogs)
        // We'll use a simple approach: check if there's a recent SMS log for this event
        // This is a simplified check - in production you might want a dedicated table

        results.push({
          userId: prefs.userId,
          phoneNumber: prefs.phoneNumber!, // Already filtered for non-null above
          eventId: event._id,
          title: event.title,
          startTime: event.startTime,
          location: event.location,
          reminderMinutes,
        });
      }
    }

    return results;
  },
});

// ------------------------------------------------------------------
// Cron job to send meeting reminders (runs every 5 minutes)
// ------------------------------------------------------------------
export const sendMeetingRemindersCron = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[sms] Running meeting reminders cron...");

    // Get upcoming meetings that need reminders
    const upcomingMeetings: any[] = await ctx.runQuery(
      internal.domains.integrations.sms.getUpcomingMeetingsForReminders,
      {}
    );

    if (upcomingMeetings.length === 0) {
      console.log("[sms] No upcoming meetings need reminders");
      return { sent: 0 };
    }

    console.log(`[sms] Found ${upcomingMeetings.length} meetings needing reminders`);

    let sent = 0;
    for (const meeting of upcomingMeetings) {
      try {
        const result: any = await ctx.runAction(
          internal.domains.integrations.sms.sendMeetingReminderSms,
          {
            userId: meeting.userId,
            eventId: meeting.eventId,
            title: meeting.title,
            startTime: meeting.startTime,
            location: meeting.location,
            minutesBefore: meeting.reminderMinutes,
          }
        );
        if (result.sent) {
          sent++;
        }
      } catch (err) {
        console.warn(`[sms] Failed to send reminder for event ${meeting.eventId}:`, err);
      }
    }

    console.log(`[sms] Sent ${sent} meeting reminders`);
    return { sent };
  },
});

// ------------------------------------------------------------------
// SMS Usage Analytics Queries
// ------------------------------------------------------------------

/**
 * Get SMS usage stats for the current user
 */
export const getSmsUsageStats = query({
  args: {
    days: v.optional(v.number()), // Default 30 days
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const daysBack = args.days ?? 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startDateStr = startDate.toISOString().split("T")[0];

    // Get daily aggregates
    const dailyStats = await ctx.db
      .query("smsUsageDaily")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.gte(q.field("date"), startDateStr))
      .collect() as Doc<"smsUsageDaily">[];

    // Aggregate totals
    const totals = dailyStats.reduce(
      (acc, day: Doc<"smsUsageDaily">) => ({
        totalMessages: acc.totalMessages + day.totalMessages,
        successfulMessages: acc.successfulMessages + day.successfulMessages,
        failedMessages: acc.failedMessages + day.failedMessages,
        totalSegments: acc.totalSegments + day.totalSegments,
        estimatedCostCents: acc.estimatedCostCents + day.estimatedCostCents,
        meetingCreatedCount: acc.meetingCreatedCount + (day.meetingCreatedCount || 0),
        meetingReminderCount: acc.meetingReminderCount + (day.meetingReminderCount || 0),
        morningDigestCount: acc.morningDigestCount + (day.morningDigestCount || 0),
      }),
      {
        totalMessages: 0,
        successfulMessages: 0,
        failedMessages: 0,
        totalSegments: 0,
        estimatedCostCents: 0,
        meetingCreatedCount: 0,
        meetingReminderCount: 0,
        morningDigestCount: 0,
      }
    );

    return {
      period: { days: daysBack, startDate: startDateStr },
      totals: {
        ...totals,
        estimatedCostDollars: (totals.estimatedCostCents / 100).toFixed(2),
        successRate: totals.totalMessages > 0
          ? ((totals.successfulMessages / totals.totalMessages) * 100).toFixed(1) + "%"
          : "N/A",
      },
      dailyBreakdown: dailyStats.map((day: Doc<"smsUsageDaily">) => ({
        date: day.date,
        messages: day.totalMessages,
        segments: day.totalSegments,
        costCents: day.estimatedCostCents,
      })),
      // Pricing reference
      pricing: {
        perSegmentCents: SMS_COSTS.TOTAL_PER_SEGMENT_CENTS,
        monthlyFeeCentsRange: `${SMS_COSTS.CAMPAIGN_MONTHLY_FEE_MIN}-${SMS_COSTS.CAMPAIGN_MONTHLY_FEE_MAX}`,
      },
    };
  },
});

/**
 * Get recent SMS logs for the current user
 */
export const getRecentSmsLogs = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 20;

    const logs = await ctx.db
      .query("smsLogs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit) as Doc<"smsLogs">[];

    return logs.map((log: Doc<"smsLogs">) => ({
      id: log._id,
      to: log.to,
      body: log.body.length > 50 ? log.body.substring(0, 50) + "..." : log.body,
      status: log.status,
      eventType: log.eventType,
      segments: log.segments,
      estimatedCostCents: log.estimatedCostCents,
      createdAt: log.createdAt,
    }));
  },
});

/**
 * Get SMS cost breakdown for pricing display
 */
export const getSmsCostBreakdown = query({
  args: {},
  handler: async () => {
    return {
      perMessage: {
        twilioOutbound: SMS_COSTS.OUTBOUND_PER_SEGMENT_CENTS,
        a2pCarrierFee: SMS_COSTS.A2P_CARRIER_FEE_CENTS,
        totalPerSegment: SMS_COSTS.TOTAL_PER_SEGMENT_CENTS,
      },
      monthly: {
        campaignFeeMin: SMS_COSTS.CAMPAIGN_MONTHLY_FEE_MIN / 100,
        campaignFeeMax: SMS_COSTS.CAMPAIGN_MONTHLY_FEE_MAX / 100,
      },
      oneTime: {
        vettingFee: SMS_COSTS.VETTING_FEE_CENTS / 100,
      },
      examples: {
        singleSms: SMS_COSTS.TOTAL_PER_SEGMENT_CENTS,
        longSms2Segments: SMS_COSTS.TOTAL_PER_SEGMENT_CENTS * 2,
        monthlyAt50Sms: (SMS_COSTS.TOTAL_PER_SEGMENT_CENTS * 50) + SMS_COSTS.CAMPAIGN_MONTHLY_FEE_MIN / 100,
        monthlyAt200Sms: (SMS_COSTS.TOTAL_PER_SEGMENT_CENTS * 200) + SMS_COSTS.CAMPAIGN_MONTHLY_FEE_MIN / 100,
      },
    };
  },
});

// ------------------------------------------------------------------
// Handle SMS Opt-Out (STOP keyword)
// ------------------------------------------------------------------
export const handleSmsOptOut = internalMutation({
  args: {
    phoneNumber: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find user by phone number and disable SMS
    const allPrefs = await ctx.db.query("userPreferences").collect() as Doc<"userPreferences">[];

    for (const prefs of allPrefs) {
      if (prefs.phoneNumber === args.phoneNumber) {
        await ctx.db.patch(prefs._id, {
          smsNotificationsEnabled: false,
        });
        console.log(`[sms] Opt-out: Disabled SMS for user ${prefs.userId}`);
      }
    }

    // Log the opt-out
    await ctx.db.insert("smsLogs", {
      to: args.phoneNumber,
      body: "[OPT-OUT RECEIVED]",
      status: "opt_out",
      createdAt: Date.now(),
    });

    return null;
  },
});

// ------------------------------------------------------------------
// Handle SMS Opt-In (START keyword)
// ------------------------------------------------------------------
export const handleSmsOptIn = internalMutation({
  args: {
    phoneNumber: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find user by phone number and enable SMS
    const allPrefs = await ctx.db.query("userPreferences").collect() as Doc<"userPreferences">[];

    for (const prefs of allPrefs) {
      if (prefs.phoneNumber === args.phoneNumber) {
        await ctx.db.patch(prefs._id, {
          smsNotificationsEnabled: true,
        });
        console.log(`[sms] Opt-in: Enabled SMS for user ${prefs.userId}`);
      }
    }

    // Log the opt-in
    await ctx.db.insert("smsLogs", {
      to: args.phoneNumber,
      body: "[OPT-IN RECEIVED]",
      status: "opt_in",
      createdAt: Date.now(),
    });

    return null;
  },
});

// ------------------------------------------------------------------
// Log incoming SMS message
// ------------------------------------------------------------------
export const logIncomingSms = internalMutation({
  args: {
    from: v.string(),
    to: v.string(),
    body: v.string(),
    messageSid: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find user by phone number
    const allPrefs = await ctx.db.query("userPreferences").collect() as Doc<"userPreferences">[];
    let userId: Id<"users"> | undefined;

    for (const prefs of allPrefs) {
      if (prefs.phoneNumber === args.from) {
        userId = prefs.userId;
        break;
      }
    }

    await ctx.db.insert("smsLogs", {
      to: args.to, // Our Twilio number
      body: `[INCOMING] ${args.body}`,
      status: "received",
      createdAt: Date.now(),
      userId,
      messageSid: args.messageSid,
      eventType: "incoming",
    });

    console.log(`[sms] Logged incoming SMS from ${args.from}: "${args.body.substring(0, 50)}..."`);
    return null;
  },
});

// ------------------------------------------------------------------
// Update SMS delivery status
// ------------------------------------------------------------------
export const updateSmsStatus = internalMutation({
  args: {
    messageSid: v.string(),
    status: v.string(),
    errorCode: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Find the SMS log by messageSid and update status
    const logs = await ctx.db
      .query("smsLogs")
      .filter((q) => q.eq(q.field("messageSid"), args.messageSid))
      .collect() as Doc<"smsLogs">[];

    if (logs.length > 0) {
      const log = logs[0] as Doc<"smsLogs">;
      await ctx.db.patch(log._id, {
        status: args.status,
        // Could add errorCode field to schema if needed
      });
      console.log(`[sms] Updated status for ${args.messageSid}: ${args.status}`);
    }

    return null;
  },
});
