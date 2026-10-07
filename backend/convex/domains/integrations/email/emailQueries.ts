/**
 * Email Queries - Public API for frontend UI
 */

import { v } from "convex/values";
import { query, action } from "../../../_generated/server";
import { Doc } from "../../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

// ------------------------------------------------------------------
// Email Dashboard Stats
// ------------------------------------------------------------------

/**
 * Get email inbox statistics for the dashboard
 */
export const getEmailStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        totalThreads: 0,
        unreadCount: 0,
        actionRequiredCount: 0,
        categories: [],
        lastSyncedAt: null,
      };
    }

    // Get sync state
    const syncState = await ctx.db
      .query("emailSyncState")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"emailSyncState"> | null;

    // Get thread stats
    const threads = await ctx.db
      .query("emailThreads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect() as Doc<"emailThreads">[];

    const unreadCount = threads.reduce((sum: number, t: Doc<"emailThreads">) => sum + (t.unreadCount || 0), 0);
    const actionRequiredCount = threads.filter((t: Doc<"emailThreads">) => t.aiActionRequired).length;

    // Group by category
    const categoryMap = new Map<string, number>();
    for (const thread of threads) {
      const cat = thread.aiCategory || "Uncategorized";
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    }

    const categories = Array.from(categoryMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return {
      totalThreads: threads.length,
      unreadCount,
      actionRequiredCount,
      categories,
      lastSyncedAt: syncState?.lastIncrementalSyncAt || syncState?.lastFullSyncAt || null,
      syncStatus: syncState?.syncStatus || "idle",
    };
  },
});

/**
 * Get email threads for inbox view
 */
export const getInboxThreads = query({
  args: {
    filter: v.optional(
      v.union(v.literal("unread"), v.literal("starred"), v.literal("action_required"))
    ),
    category: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    let threads = await ctx.db
      .query("emailThreads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit || 50) as Doc<"emailThreads">[];

    // Apply filters based on filter type
    if (args.filter === "unread") {
      threads = threads.filter((t: Doc<"emailThreads">) => (t.unreadCount || 0) > 0);
    } else if (args.filter === "starred") {
      threads = threads.filter((t: Doc<"emailThreads">) => t.isStarred);
    } else if (args.filter === "action_required") {
      threads = threads.filter((t: Doc<"emailThreads">) => t.aiActionRequired);
    }

    // Apply category filter
    if (args.category) {
      threads = threads.filter((t: Doc<"emailThreads">) => t.aiCategory === args.category);
    }

    return threads.map((t: Doc<"emailThreads">) => ({
      _id: t._id,
      subject: t.subject,
      snippet: t.snippet,
      latestFrom: t.participants?.[0] || "Unknown",
      messageCount: t.messageCount,
      isRead: (t.unreadCount || 0) === 0,
      isStarred: t.isStarred || false,
      hasAttachments: t.hasAttachments,
      aiCategory: t.aiCategory,
      aiPriority: t.aiPriority,
      aiSummary: t.aiSummary,
      aiActionRequired: t.aiActionRequired,
      aiActionSuggestion: t.aiActionSuggestion,
      lastMessageAt: t.lastMessageAt,
    }));
  },
});

/**
 * Get a single thread with messages
 */
export const getThreadDetail = query({
  args: {
    threadId: v.id("emailThreads"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const thread = await ctx.db.get(args.threadId) as Doc<"emailThreads"> | null;
    if (!thread || thread.userId !== userId) return null;

    const messages = await ctx.db
      .query("emailMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect() as Doc<"emailMessages">[];

    return {
      _id: thread._id,
      subject: thread.subject,
      isStarred: thread.isStarred || false,
      aiCategory: thread.aiCategory,
      aiPriority: thread.aiPriority,
      aiSummary: thread.aiSummary,
      aiActionRequired: thread.aiActionRequired,
      aiActionSuggestion: thread.aiActionSuggestion,
      messages: messages.map((m: Doc<"emailMessages">) => ({
        _id: m._id,
        from: m.from,
        to: m.to,
        cc: m.cc,
        date: m.internalDate,
        bodyHtml: m.bodyHtml,
        bodyText: m.bodyPlain,
        hasAttachments: m.hasAttachments,
        attachments: m.attachments,
      })),
    };
  },
});

// ------------------------------------------------------------------
// Daily Reports
// ------------------------------------------------------------------

/**
 * Get the latest daily email report
 */
export const getLatestDailyReport = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const report = await ctx.db
      .query("emailDailyReports")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .first() as Doc<"emailDailyReports"> | null;

    if (!report) return null;

    return {
      _id: report._id,
      date: report.date,
      executiveSummary: report.executiveSummary,
      totalReceived: report.totalReceived,
      totalUnread: report.totalUnread,
      totalSent: report.totalSent,
      actionItemsCount: report.totalActionRequired,
      groupedEmails: report.groupings,
      actionItems: report.suggestedActions,
      deliveredVia: report.deliveredVia,
      generatedAt: report.createdAt,
    };
  },
});

/**
 * Get daily reports for a date range
 */
export const getDailyReports = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const reports = await ctx.db
      .query("emailDailyReports")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit || 7) as Doc<"emailDailyReports">[];

    return reports.map((r: Doc<"emailDailyReports">) => ({
      _id: r._id,
      date: r.date,
      totalReceived: r.totalReceived,
      totalSent: r.totalSent,
      totalUnread: r.totalUnread,
      totalActionRequired: r.totalActionRequired,
      executiveSummary: r.executiveSummary,
      keyHighlights: r.keyHighlights,
      deliveredVia: r.deliveredVia,
      deliveredAt: r.deliveredAt,
    }));
  },
});

/**
 * Get a specific daily report with full details
 */
export const getDailyReportDetail = query({
  args: {
    reportId: v.id("emailDailyReports"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const report = await ctx.db.get(args.reportId) as Doc<"emailDailyReports"> | null;
    if (!report || report.userId !== userId) return null;

    return {
      _id: report._id,
      date: report.date,
      executiveSummary: report.executiveSummary,
      totalReceived: report.totalReceived,
      totalUnread: report.totalUnread,
      totalSent: report.totalSent,
      actionItemsCount: report.totalActionRequired,
      groupedEmails: report.groupings,
      actionItems: report.suggestedActions,
      deliveredVia: report.deliveredVia,
      generatedAt: report.createdAt,
    };
  },
});

// ------------------------------------------------------------------
// Urgent Emails
// ------------------------------------------------------------------

/**
 * Get emails that need immediate attention
 */
export const getUrgentEmails = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const threads = await ctx.db
      .query("emailThreads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) =>
        q.or(
          q.eq(q.field("aiPriority"), "urgent"),
          q.eq(q.field("aiActionRequired"), true)
        )
      )
      .order("desc")
      .take(10) as Doc<"emailThreads">[];

    return threads.filter((t: Doc<"emailThreads">) => (t.unreadCount || 0) > 0).map((t: Doc<"emailThreads">) => ({
      _id: t._id,
      subject: t.subject,
      from: t.participants?.[0] || "Unknown",
      priority: t.aiPriority,
      actionRequired: t.aiActionRequired,
      actionSuggestion: t.aiActionSuggestion,
      lastMessageAt: t.lastMessageAt,
    }));
  },
});
