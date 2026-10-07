/**
 * Email Service - Comprehensive email management via Gmail API
 *
 * Features:
 * - Fetch email threads with full conversation history
 * - Mark emails as read/unread
 * - Send emails via Gmail API
 * - Manage labels
 * - Sync state management
 * - Thread-level operations
 */

import { action, internalAction, internalMutation, internalQuery, mutation, query } from "../../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "../../../_generated/api";
import { Doc, Id } from "../../../_generated/dataModel";
import { refreshAccessTokenIfNeeded } from "../gmail";

// ------------------------------------------------------------------
// Gmail API Constants
// ------------------------------------------------------------------
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Required OAuth scopes for full email management
const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
].join(" ");

// ------------------------------------------------------------------
// Internal Helpers
// ------------------------------------------------------------------

/**
 * Get Google account with refreshed access token
 */
async function getAccountWithToken(ctx: any): Promise<{
  accessToken: string;
  email?: string;
  userId: Id<"users">;
} | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;

  const account = await ctx.runQuery(internal.domains.integrations.gmail.getAccount, {});
  if (!account) return null;

  const accessToken = await refreshAccessTokenIfNeeded(ctx, account);
  return { accessToken, email: account.email, userId };
}

/**
 * Parse email headers to extract common fields
 */
function parseHeaders(headers: Array<{ name: string; value: string }>): {
  subject?: string;
  from?: string;
  fromName?: string;
  to?: string[];
  cc?: string[];
  date?: string;
  messageId?: string;
  inReplyTo?: string;
} {
  const find = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;

  const from = find("From");
  let fromName: string | undefined;
  if (from) {
    const match = from.match(/^(.+?)\s*<[^>]+>$/);
    if (match) {
      fromName = match[1].replace(/^["']|["']$/g, "").trim();
    }
  }

  const parseAddresses = (value: string | undefined): string[] => {
    if (!value) return [];
    return value.split(",").map(addr => addr.trim()).filter(Boolean);
  };

  return {
    subject: find("Subject"),
    from,
    fromName,
    to: parseAddresses(find("To")),
    cc: parseAddresses(find("Cc")),
    date: find("Date"),
    messageId: find("Message-ID"),
    inReplyTo: find("In-Reply-To"),
  };
}

/**
 * Decode base64url encoded content
 */
function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

/**
 * Extract body content from message payload
 */
function extractBody(payload: any): { plain?: string; html?: string } {
  const result: { plain?: string; html?: string } = {};

  const walk = (part: any) => {
    if (!part) return;

    const mimeType = part.mimeType || "";
    const data = part.body?.data;

    if (mimeType === "text/plain" && data && !result.plain) {
      result.plain = decodeBase64Url(data);
    } else if (mimeType === "text/html" && data && !result.html) {
      result.html = decodeBase64Url(data);
    }

    if (Array.isArray(part.parts)) {
      part.parts.forEach(walk);
    }
  };

  walk(payload);
  return result;
}

/**
 * Extract attachments from message payload
 */
function extractAttachments(payload: any): Array<{
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}> {
  const attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    attachmentId: string;
  }> = [];

  const walk = (part: any) => {
    if (!part) return;

    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType || "application/octet-stream",
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId,
      });
    }

    if (Array.isArray(part.parts)) {
      part.parts.forEach(walk);
    }
  };

  walk(payload);
  return attachments;
}

// ------------------------------------------------------------------
// Thread Operations
// ------------------------------------------------------------------

/**
 * Fetch a list of email threads from Gmail
 */
export const fetchThreads = action({
  args: {
    maxResults: v.optional(v.number()),
    query: v.optional(v.string()),           // Gmail search query
    labelIds: v.optional(v.array(v.string())),
    pageToken: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    threads: v.optional(v.array(v.object({
      id: v.string(),
      snippet: v.optional(v.string()),
      historyId: v.optional(v.string()),
    }))),
    nextPageToken: v.optional(v.string()),
    resultSizeEstimate: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const auth = await getAccountWithToken(ctx);
    if (!auth) {
      return { success: false, error: "Not authenticated or no Google account connected" };
    }

    try {
      const url = new URL(`${GMAIL_API_BASE}/threads`);
      url.searchParams.set("maxResults", String(args.maxResults ?? 20));

      if (args.query) url.searchParams.set("q", args.query);
      if (args.pageToken) url.searchParams.set("pageToken", args.pageToken);
      if (args.labelIds) {
        args.labelIds.forEach((id: string) => url.searchParams.append("labelIds", id));
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Gmail API error: ${response.status} ${text}` };
      }

      const data = await response.json();
      return {
        success: true,
        threads: data.threads || [],
        nextPageToken: data.nextPageToken,
        resultSizeEstimate: data.resultSizeEstimate,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
});

/**
 * Fetch a single thread with all messages
 */
export const fetchThread = action({
  args: {
    threadId: v.string(),
    format: v.optional(v.union(
      v.literal("minimal"),
      v.literal("metadata"),
      v.literal("full")
    )),
  },
  returns: v.object({
    success: v.boolean(),
    thread: v.optional(v.any()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const auth = await getAccountWithToken(ctx);
    if (!auth) {
      return { success: false, error: "Not authenticated or no Google account connected" };
    }

    try {
      const url = new URL(`${GMAIL_API_BASE}/threads/${args.threadId}`);
      url.searchParams.set("format", args.format || "full");

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Gmail API error: ${response.status} ${text}` };
      }

      const thread = await response.json();

      // Parse messages
      const messages = (thread.messages || []).map((msg: any) => {
        const headers = parseHeaders(msg.payload?.headers || []);
        const body = extractBody(msg.payload);
        const attachments = extractAttachments(msg.payload);

        return {
          id: msg.id,
          threadId: msg.threadId,
          labelIds: msg.labelIds || [],
          snippet: msg.snippet,
          internalDate: Number(msg.internalDate),
          ...headers,
          bodyPlain: body.plain,
          bodyHtml: body.html,
          attachments,
          isRead: !(msg.labelIds || []).includes("UNREAD"),
          isStarred: (msg.labelIds || []).includes("STARRED"),
        };
      });

      return {
        success: true,
        thread: {
          id: thread.id,
          historyId: thread.historyId,
          messages,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
});

// ------------------------------------------------------------------
// Email Status Management
// ------------------------------------------------------------------

/**
 * Mark a message as read
 */
export const markAsRead = action({
  args: {
    messageId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const auth = await getAccountWithToken(ctx);
    if (!auth) {
      return { success: false, error: "Not authenticated" };
    }

    try {
      const url = `${GMAIL_API_BASE}/messages/${args.messageId}/modify`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          removeLabelIds: ["UNREAD"],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Gmail API error: ${response.status} ${text}` };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
});

/**
 * Mark a message as unread
 */
export const markAsUnread = action({
  args: {
    messageId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const auth = await getAccountWithToken(ctx);
    if (!auth) {
      return { success: false, error: "Not authenticated" };
    }

    try {
      const url = `${GMAIL_API_BASE}/messages/${args.messageId}/modify`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          addLabelIds: ["UNREAD"],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Gmail API error: ${response.status} ${text}` };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
});

/**
 * Archive a message (remove from INBOX)
 */
export const archiveMessage = action({
  args: {
    messageId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const auth = await getAccountWithToken(ctx);
    if (!auth) {
      return { success: false, error: "Not authenticated" };
    }

    try {
      const url = `${GMAIL_API_BASE}/messages/${args.messageId}/modify`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          removeLabelIds: ["INBOX"],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Gmail API error: ${response.status} ${text}` };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
});

/**
 * Star a message
 */
export const starMessage = action({
  args: {
    messageId: v.string(),
    starred: v.boolean(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const auth = await getAccountWithToken(ctx);
    if (!auth) {
      return { success: false, error: "Not authenticated" };
    }

    try {
      const url = `${GMAIL_API_BASE}/messages/${args.messageId}/modify`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          [args.starred ? "addLabelIds" : "removeLabelIds"]: ["STARRED"],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Gmail API error: ${response.status} ${text}` };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
});

/**
 * Move message to trash
 */
export const trashMessage = action({
  args: {
    messageId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const auth = await getAccountWithToken(ctx);
    if (!auth) {
      return { success: false, error: "Not authenticated" };
    }

    try {
      const url = `${GMAIL_API_BASE}/messages/${args.messageId}/trash`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Gmail API error: ${response.status} ${text}` };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
});

// ------------------------------------------------------------------
// Label Management
// ------------------------------------------------------------------

/**
 * List all labels
 */
export const listLabels = action({
  args: {},
  returns: v.object({
    success: v.boolean(),
    labels: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      type: v.string(),
      messagesTotal: v.optional(v.number()),
      messagesUnread: v.optional(v.number()),
    }))),
    error: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const auth = await getAccountWithToken(ctx);
    if (!auth) {
      return { success: false, error: "Not authenticated" };
    }

    try {
      const url = `${GMAIL_API_BASE}/labels`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Gmail API error: ${response.status} ${text}` };
      }

      const data = await response.json();
      return {
        success: true,
        labels: (data.labels || []).map((label: any) => ({
          id: label.id,
          name: label.name,
          type: label.type,
          messagesTotal: label.messagesTotal,
          messagesUnread: label.messagesUnread,
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
});

/**
 * Apply labels to a message
 */
export const applyLabels = action({
  args: {
    messageId: v.string(),
    addLabelIds: v.optional(v.array(v.string())),
    removeLabelIds: v.optional(v.array(v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const auth = await getAccountWithToken(ctx);
    if (!auth) {
      return { success: false, error: "Not authenticated" };
    }

    try {
      const url = `${GMAIL_API_BASE}/messages/${args.messageId}/modify`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          addLabelIds: args.addLabelIds || [],
          removeLabelIds: args.removeLabelIds || [],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Gmail API error: ${response.status} ${text}` };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
});

/**
 * Create a new label
 */
export const createLabel = action({
  args: {
    name: v.string(),
    labelListVisibility: v.optional(v.union(
      v.literal("labelShow"),
      v.literal("labelShowIfUnread"),
      v.literal("labelHide")
    )),
    messageListVisibility: v.optional(v.union(
      v.literal("show"),
      v.literal("hide")
    )),
  },
  returns: v.object({
    success: v.boolean(),
    label: v.optional(v.object({
      id: v.string(),
      name: v.string(),
    })),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const auth = await getAccountWithToken(ctx);
    if (!auth) {
      return { success: false, error: "Not authenticated" };
    }

    try {
      const url = `${GMAIL_API_BASE}/labels`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: args.name,
          labelListVisibility: args.labelListVisibility || "labelShow",
          messageListVisibility: args.messageListVisibility || "show",
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Gmail API error: ${response.status} ${text}` };
      }

      const label = await response.json();
      return {
        success: true,
        label: {
          id: label.id,
          name: label.name,
        },
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
});

// ------------------------------------------------------------------
// Send Email
// ------------------------------------------------------------------

/**
 * Send an email via Gmail API
 */
export const sendEmailViaGmail = action({
  args: {
    to: v.string(),
    subject: v.string(),
    body: v.string(),
    isHtml: v.optional(v.boolean()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    replyToMessageId: v.optional(v.string()),    // For replies
    threadId: v.optional(v.string()),             // To keep in same thread
  },
  returns: v.object({
    success: v.boolean(),
    messageId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const auth = await getAccountWithToken(ctx);
    if (!auth) {
      return { success: false, error: "Not authenticated" };
    }

    try {
      // Build MIME message
      const boundary = `boundary_${Date.now()}`;
      const contentType = args.isHtml ? "text/html" : "text/plain";

      let headers = [
        `To: ${args.to}`,
        `Subject: ${args.subject}`,
        `Content-Type: ${contentType}; charset=utf-8`,
      ];

      if (args.cc && args.cc.length > 0) {
        headers.push(`Cc: ${args.cc.join(", ")}`);
      }
      if (args.bcc && args.bcc.length > 0) {
        headers.push(`Bcc: ${args.bcc.join(", ")}`);
      }
      if (args.replyToMessageId) {
        headers.push(`In-Reply-To: ${args.replyToMessageId}`);
        headers.push(`References: ${args.replyToMessageId}`);
      }

      const message = [...headers, "", args.body].join("\r\n");

      // Encode to base64url
      const encodedMessage = Buffer.from(message)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const url = `${GMAIL_API_BASE}/messages/send`;
      const payload: any = { raw: encodedMessage };

      if (args.threadId) {
        payload.threadId = args.threadId;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Gmail API error: ${response.status} ${text}` };
      }

      const result = await response.json();
      return {
        success: true,
        messageId: result.id,
        threadId: result.threadId,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
});

// ------------------------------------------------------------------
// Sync Operations
// ------------------------------------------------------------------

/**
 * Full email sync - fetches threads and stores them in database
 */
export const syncEmails = internalAction({
  args: {
    userId: v.id("users"),
    maxThreads: v.optional(v.number()),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log(`[emailService.syncEmails] Starting sync for user ${args.userId}...`);

    // Get or create sync state
    let syncState = await ctx.runQuery(internal.domains.integrations.email.emailService.getSyncState, {
      userId: args.userId,
    });

    // Update sync status
    await ctx.runMutation(internal.domains.integrations.email.emailService.updateSyncState, {
      userId: args.userId,
      syncStatus: "syncing",
    });

    try {
      // Fetch threads from Gmail
      const threadsResult = await ctx.runAction(api.domains.integrations.email.emailService.fetchThreads, {
        maxResults: args.maxThreads ?? 50,
        query: args.query ?? "in:inbox",
      });

      if (!threadsResult.success || !threadsResult.threads) {
        throw new Error(threadsResult.error || "Failed to fetch threads");
      }

      console.log(`[emailService.syncEmails] Found ${threadsResult.threads.length} threads`);

      let synced = 0;
      for (const thread of threadsResult.threads) {
        try {
          // Fetch full thread details
          const threadResult = await ctx.runAction(api.domains.integrations.email.emailService.fetchThread, {
            threadId: thread.id,
            format: "full",
          });

          if (!threadResult.success || !threadResult.thread) {
            console.warn(`[emailService.syncEmails] Failed to fetch thread ${thread.id}`);
            continue;
          }

          // Store thread and messages
          await ctx.runMutation(internal.domains.integrations.email.emailService.upsertThread, {
            userId: args.userId,
            thread: threadResult.thread,
          });

          synced++;
        } catch (err) {
          console.warn(`[emailService.syncEmails] Error syncing thread ${thread.id}:`, err);
        }
      }

      // Update sync state
      await ctx.runMutation(internal.domains.integrations.email.emailService.updateSyncState, {
        userId: args.userId,
        syncStatus: "idle",
        lastIncrementalSyncAt: Date.now(),
        totalThreadsSynced: (syncState?.totalThreadsSynced ?? 0) + synced,
      });

      console.log(`[emailService.syncEmails] Synced ${synced} threads`);
      return { success: true, threadsSynced: synced };
    } catch (err: any) {
      await ctx.runMutation(internal.domains.integrations.email.emailService.updateSyncState, {
        userId: args.userId,
        syncStatus: "error",
        lastError: err.message,
      });
      throw err;
    }
  },
});

// ------------------------------------------------------------------
// Database Operations
// ------------------------------------------------------------------

/**
 * Get sync state for a user
 */
export const getSyncState = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emailSyncState")
      .withIndex("by_user", (q: any) => q.eq("userId", args.userId))
      .first() as Doc<"emailSyncState"> | null;
  },
});

/**
 * Update sync state
 */
export const updateSyncState = internalMutation({
  args: {
    userId: v.id("users"),
    lastHistoryId: v.optional(v.string()),
    lastFullSyncAt: v.optional(v.number()),
    lastIncrementalSyncAt: v.optional(v.number()),
    syncStatus: v.optional(v.union(
      v.literal("idle"),
      v.literal("syncing"),
      v.literal("error")
    )),
    lastError: v.optional(v.string()),
    totalThreadsSynced: v.optional(v.number()),
    totalMessagesSynced: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("emailSyncState")
      .withIndex("by_user", (q: any) => q.eq("userId", args.userId))
      .first() as Doc<"emailSyncState"> | null;

    const now = Date.now();
    const updates = {
      ...(args.lastHistoryId !== undefined && { lastHistoryId: args.lastHistoryId }),
      ...(args.lastFullSyncAt !== undefined && { lastFullSyncAt: args.lastFullSyncAt }),
      ...(args.lastIncrementalSyncAt !== undefined && { lastIncrementalSyncAt: args.lastIncrementalSyncAt }),
      ...(args.syncStatus !== undefined && { syncStatus: args.syncStatus }),
      ...(args.lastError !== undefined && { lastError: args.lastError }),
      ...(args.totalThreadsSynced !== undefined && { totalThreadsSynced: args.totalThreadsSynced }),
      ...(args.totalMessagesSynced !== undefined && { totalMessagesSynced: args.totalMessagesSynced }),
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, updates);
    } else {
      await ctx.db.insert("emailSyncState", {
        userId: args.userId,
        syncStatus: args.syncStatus || "idle",
        totalThreadsSynced: args.totalThreadsSynced ?? 0,
        totalMessagesSynced: args.totalMessagesSynced ?? 0,
        createdAt: now,
        ...updates,
        updatedAt: now,
      });
    }

    return null;
  },
});

/**
 * Upsert email thread and messages
 */
export const upsertThread = internalMutation({
  args: {
    userId: v.id("users"),
    thread: v.any(),
  },
  returns: v.id("emailThreads"),
  handler: async (ctx, args) => {
    const { userId, thread } = args;
    const now = Date.now();

    const messages = thread.messages || [];
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];

    // Extract participants
    const participants = new Set<string>();
    for (const msg of messages) {
      if (msg.from) participants.add(msg.from);
      (msg.to || []).forEach((addr: string) => participants.add(addr));
    }

    // Check for existing thread
    const existingThread = await ctx.db
      .query("emailThreads")
      .withIndex("by_gmail_thread", (q: any) => q.eq("userId", userId).eq("gmailThreadId", thread.id))
      .first() as Doc<"emailThreads"> | null;

    // Calculate unread count
    const unreadCount = messages.filter((m: any) => !m.isRead).length;
    const hasAttachments = messages.some((m: any) => (m.attachments || []).length > 0);

    const threadData = {
      userId,
      gmailThreadId: thread.id,
      subject: firstMessage?.subject || "(No Subject)",
      snippet: lastMessage?.snippet,
      participants: Array.from(participants),
      messageCount: messages.length,
      unreadCount,
      hasAttachments,
      labelIds: [],
      status: "inbox" as const,
      isStarred: messages.some((m: any) => m.isStarred),
      isImportant: false,
      lastMessageAt: lastMessage?.internalDate || now,
      firstMessageAt: firstMessage?.internalDate || now,
      lastSyncedAt: now,
      updatedAt: now,
    };

    let threadId: Id<"emailThreads">;
    if (existingThread) {
      await ctx.db.patch(existingThread._id, threadData);
      threadId = existingThread._id;
    } else {
      threadId = await ctx.db.insert("emailThreads", {
        ...threadData,
        createdAt: now,
      });
    }

    // Upsert messages
    for (const msg of messages) {
      const existingMsg = await ctx.db
        .query("emailMessages")
        .withIndex("by_gmail_message", (q: any) => q.eq("userId", userId).eq("gmailMessageId", msg.id))
        .first() as Doc<"emailMessages"> | null;

      const msgData = {
        userId,
        threadId,
        gmailMessageId: msg.id,
        from: msg.from || "",
        fromName: msg.fromName,
        to: msg.to || [],
        cc: msg.cc,
        subject: msg.subject || "",
        snippet: msg.snippet,
        bodyPlain: msg.bodyPlain,
        bodyHtml: msg.bodyHtml,
        hasAttachments: (msg.attachments || []).length > 0,
        attachments: msg.attachments,
        isRead: msg.isRead,
        isStarred: msg.isStarred,
        internalDate: msg.internalDate,
        receivedAt: now,
        updatedAt: now,
      };

      if (existingMsg) {
        await ctx.db.patch(existingMsg._id, msgData);
      } else {
        await ctx.db.insert("emailMessages", {
          ...msgData,
          createdAt: now,
        });
      }
    }

    return threadId;
  },
});

// ------------------------------------------------------------------
// Query Operations
// ------------------------------------------------------------------

/**
 * Get email threads for the current user
 */
export const getThreads = query({
  args: {
    status: v.optional(v.union(
      v.literal("inbox"),
      v.literal("archived"),
      v.literal("trash"),
      v.literal("spam")
    )),
    limit: v.optional(v.number()),
    category: v.optional(v.string()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    let query = ctx.db.query("emailThreads");

    if (args.status) {
      query = query.withIndex("by_user_status", (q: any) =>
        q.eq("userId", userId).eq("status", args.status!)
      );
    } else {
      query = query.withIndex("by_user", (q: any) => q.eq("userId", userId));
    }

    const threads = await query
      .order("desc")
      .take(args.limit ?? 50) as Doc<"emailThreads">[];

    return threads;
  },
});

/**
 * Get a single thread with all messages
 */
export const getThreadWithMessages = query({
  args: {
    threadId: v.id("emailThreads"),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const thread = await ctx.db.get(args.threadId) as Doc<"emailThreads"> | null;
    if (!thread || thread.userId !== userId) return null;

    const messages = await ctx.db
      .query("emailMessages")
      .withIndex("by_thread", (q: any) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect() as Doc<"emailMessages">[];

    return {
      ...thread,
      messages,
    };
  },
});

/**
 * Get email statistics
 */
export const getEmailStats = query({
  args: {},
  returns: v.object({
    totalThreads: v.number(),
    unreadCount: v.number(),
    inboxCount: v.number(),
    archivedCount: v.number(),
    categories: v.array(v.object({
      name: v.string(),
      count: v.number(),
    })),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        totalThreads: 0,
        unreadCount: 0,
        inboxCount: 0,
        archivedCount: 0,
        categories: [],
      };
    }

    const threads = await ctx.db
      .query("emailThreads")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .collect() as Doc<"emailThreads">[];

    const unreadCount = threads.reduce((sum: number, t) => sum + (t.unreadCount || 0), 0);
    const inboxCount = threads.filter((t) => t.status === "inbox").length;
    const archivedCount = threads.filter((t) => t.status === "archived").length;

    // Group by AI category
    const categoryMap = new Map<string, number>();
    for (const thread of threads) {
      const cat = (thread as any).aiCategory || "Uncategorized";
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    }

    const categories = Array.from(categoryMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalThreads: threads.length,
      unreadCount,
      inboxCount,
      archivedCount,
      categories,
    };
  },
});
