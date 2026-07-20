/**
 * Email Webhook Handler
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Handles incoming email notifications via Gmail Push Notifications (Pub/Sub).
 *
 * Setup:
 * 1. Create a Google Cloud Pub/Sub topic
 * 2. Set up a subscription that pushes to this webhook
 * 3. Call `startGmailWatch` to register the watch
 *
 * When emails arrive:
 * - Gmail sends push notification to Pub/Sub
 * - Pub/Sub forwards to this webhook
 * - We fetch new messages and trigger processing
 */

import { httpAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import type { Doc, Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * HTTP handler for Gmail push notifications
 *
 * Endpoint: POST /api/gmail/push
 *
 * Gmail sends notifications in this format:
 * {
 *   "message": {
 *     "data": "base64-encoded JSON: { emailAddress, historyId }",
 *     "messageId": "unique message ID",
 *     "publishTime": "RFC 3339 timestamp"
 *   },
 *   "subscription": "projects/PROJECT/subscriptions/SUBSCRIPTION"
 * }
 */
export const gmailPushHandler = httpAction(async (ctx, request) => {
  console.log("[emailWebhook] Received Gmail push notification");

  try {
    const body = await request.json();

    // Validate request structure
    if (!body.message?.data) {
      console.warn("[emailWebhook] Invalid request: missing message.data");
      return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400 });
    }

    // Decode the base64 data
    const decodedData = Buffer.from(body.message.data, "base64").toString("utf-8");
    const notification = JSON.parse(decodedData);

    console.log(`[emailWebhook] Notification for: ${notification.emailAddress}, historyId: ${notification.historyId}`);

    // Find the user by email
    const userAccount = await ctx.runQuery(internal.domains.integrations.email.emailWebhook.getUserByEmail, {
      email: notification.emailAddress,
    });

    if (!userAccount) {
      console.warn(`[emailWebhook] No user found for email: ${notification.emailAddress}`);
      return new Response(JSON.stringify({ ok: true, message: "User not found" }), { status: 200 });
    }

    // Queue processing for this user
    await ctx.runMutation(internal.domains.integrations.email.emailWebhook.queueEmailProcessing, {
      userId: userAccount.userId,
      historyId: notification.historyId,
      triggerSource: "gmail_push",
    });

    // Schedule immediate processing
    await ctx.scheduler.runAfter(0, internal.domains.agents.emailAgent.processNewEmails, {
      userId: userAccount.userId,
      maxEmails: 20,
    });

    console.log(`[emailWebhook] Queued processing for user ${userAccount.userId}`);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[emailWebhook] Error processing notification:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find user by Gmail email address
 */
export const getUserByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.null(), v.object({
    userId: v.id("users"),
    email: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("googleAccounts")
      .filter(q => q.eq(q.field("email"), args.email))
      .first() as Doc<"googleAccounts"> | null;

    if (!account) return null;

    return {
      userId: account.userId,
      email: account.email,
    };
  },
});

/**
 * Queue email processing job
 */
export const queueEmailProcessing = internalMutation({
  args: {
    userId: v.id("users"),
    historyId: v.string(),
    triggerSource: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Add to processing queue (dedupe by userId within recent window)
    const recentJobs = await ctx.db
      .query("emailProcessingQueue")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .filter(q =>
        q.and(
          q.eq(q.field("status"), "pending"),
          q.gt(q.field("createdAt"), Date.now() - 5 * 60 * 1000) // 5 minute window
        )
      )
      .first() as Doc<"emailProcessingQueue"> | null;

    if (recentJobs) {
      console.log(`[emailWebhook] Skipping duplicate job for user ${args.userId}`);
      return null;
    }

    await ctx.db.insert("emailProcessingQueue", {
      userId: args.userId,
      gmailMessageId: `push_${args.historyId}`,
      gmailThreadId: "",
      status: "pending",
      processType: "full_analysis",
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// GMAIL WATCH MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start Gmail watch for push notifications
 *
 * This registers a watch on the user's Gmail inbox that sends
 * push notifications when new emails arrive.
 *
 * Requires:
 * - GMAIL_PUBSUB_TOPIC: Google Cloud Pub/Sub topic name
 * - Gmail API scope: https://www.googleapis.com/auth/gmail.readonly
 */
export const startGmailWatch = internalAction({
  args: {
    userId: v.id("users"),
    pubsubTopic: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

    // Get user's Gmail credentials
    const account = await ctx.runQuery(internal.domains.integrations.gmail.getAccount, {});
    if (!account) {
      throw new Error("No Gmail account connected");
    }

    // Use provided topic or environment variable
    const topic = args.pubsubTopic || process.env.GMAIL_PUBSUB_TOPIC;
    if (!topic) {
      throw new Error("No Pub/Sub topic configured. Set GMAIL_PUBSUB_TOPIC environment variable.");
    }

    // Get fresh access token
    const { refreshAccessTokenIfNeeded } = await import("../gmail");
    const accessToken = await refreshAccessTokenIfNeeded(ctx, account);

    // Register watch
    const response = await fetch(`${GMAIL_API_BASE}/watch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topicName: topic,
        labelIds: ["INBOX"],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to start Gmail watch: ${response.status} ${text}`);
    }

    const watchData = await response.json();
    console.log(`[emailWebhook.startGmailWatch] Watch registered: historyId=${watchData.historyId}, expiration=${watchData.expiration}`);

    // Store watch expiration
    await ctx.runMutation(internal.domains.integrations.email.emailWebhook.updateWatchExpiration, {
      userId: args.userId,
      historyId: watchData.historyId,
      expiration: watchData.expiration,
    });

    return {
      success: true,
      historyId: watchData.historyId,
      expiration: watchData.expiration,
    };
  },
});

/**
 * Stop Gmail watch
 */
export const stopGmailWatch = internalAction({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx) => {
    const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

    const account = await ctx.runQuery(internal.domains.integrations.gmail.getAccount, {});
    if (!account) {
      return { success: true, message: "No Gmail account connected" };
    }

    const { refreshAccessTokenIfNeeded } = await import("../gmail");
    const accessToken = await refreshAccessTokenIfNeeded(ctx, account);

    const response = await fetch(`${GMAIL_API_BASE}/stop`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.warn(`[emailWebhook.stopGmailWatch] Failed: ${response.status} ${text}`);
    }

    return { success: true };
  },
});

/**
 * Update watch expiration in database
 */
export const updateWatchExpiration = internalMutation({
  args: {
    userId: v.id("users"),
    historyId: v.string(),
    expiration: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Update sync state with watch info
    const syncState = await ctx.db
      .query("emailSyncState")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .first() as Doc<"emailSyncState"> | null;

    const expirationMs = parseInt(args.expiration);

    if (syncState) {
      await ctx.db.patch(syncState._id, {
        lastHistoryId: args.historyId,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("emailSyncState", {
        userId: args.userId,
        lastHistoryId: args.historyId,
        syncStatus: "idle",
        totalThreadsSynced: 0,
        totalMessagesSynced: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// WATCH RENEWAL CRON
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Renew Gmail watches before they expire
 * Gmail watches expire after ~7 days, so we renew daily
 */
export const renewGmailWatchesCron = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[emailWebhook.renewGmailWatchesCron] Renewing Gmail watches...");

    // Get all users with Gmail connected
    const accounts = await ctx.runQuery(internal.domains.integrations.email.dailyEmailReport.getUsersWithGmail, {});

    let renewed = 0;
    let errors = 0;

    for (const account of accounts) {
      try {
        await ctx.runAction(internal.domains.integrations.email.emailWebhook.startGmailWatch, {
          userId: account.userId,
        });
        renewed++;
      } catch (err) {
        console.error(`[emailWebhook.renewGmailWatchesCron] Error for user ${account.userId}:`, err);
        errors++;
      }
    }

    console.log(`[emailWebhook.renewGmailWatchesCron] Completed: ${renewed} renewed, ${errors} errors`);
    return { renewed, errors };
  },
});
