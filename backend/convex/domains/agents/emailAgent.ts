/**
 * Email Agent - AI-powered email categorization and analysis
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Features:
 * - Intelligent email categorization (Work, Personal, Finance, etc.)
 * - Priority assignment (urgent, high, normal, low)
 * - Thread summarization
 * - Action item detection
 * - Smart grouping for daily reports
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, action } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import type { Id, Doc } from "../../_generated/dataModel";
import { z } from "zod";

// Import the language model resolver
import {
  getLanguageModelSafe,
  normalizeModelInput,
  type ApprovedModel
} from "./mcp_tools/models";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES & SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Email categorization result
 */
export type EmailCategory =
  | "work"
  | "personal"
  | "finance"
  | "shopping"
  | "travel"
  | "social"
  | "newsletters"
  | "promotions"
  | "updates"
  | "support"
  | "legal"
  | "health"
  | "other";

export type EmailPriority = "urgent" | "high" | "normal" | "low";

/**
 * Email analysis result from agent
 */
export interface EmailAnalysis {
  category: EmailCategory;
  subCategory?: string;
  priority: EmailPriority;
  summary: string;
  actionRequired: boolean;
  actionSuggestion?: string;
  keyPoints: string[];
  sentiment: "positive" | "neutral" | "negative";
  confidence: number;
}

/**
 * Email grouping for daily reports
 */
export interface EmailGrouping {
  category: string;
  count: number;
  threads: Array<{
    threadId: string;
    subject: string;
    from: string;
    status: "unread" | "read" | "replied" | "action_needed";
    priority?: EmailPriority;
    summary?: string;
    lastMessageAt: number;
  }>;
  subCategories?: Array<{
    name: string;
    count: number;
    threads: Array<{
      threadId: string;
      subject: string;
      from: string;
      status: string;
    }>;
  }>;
}

// Zod schemas for structured output
const EmailAnalysisSchema = z.object({
  category: z.enum([
    "work", "personal", "finance", "shopping", "travel",
    "social", "newsletters", "promotions", "updates",
    "support", "legal", "health", "other"
  ]),
  subCategory: z.string().optional(),
  priority: z.enum(["urgent", "high", "normal", "low"]),
  summary: z.string().min(10).max(500),
  actionRequired: z.boolean(),
  actionSuggestion: z.string().optional(),
  keyPoints: z.array(z.string()).min(1).max(5),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  confidence: z.number().min(0).max(1),
});

const EmailGroupingsSchema = z.array(z.object({
  category: z.string(),
  count: z.number(),
  threads: z.array(z.object({
    threadId: z.string(),
    subject: z.string(),
    from: z.string(),
    status: z.enum(["unread", "read", "replied", "action_needed"]),
    priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
    summary: z.string().optional(),
    lastMessageAt: z.number(),
  })),
  subCategories: z.array(z.object({
    name: z.string(),
    count: z.number(),
    threads: z.array(z.object({
      threadId: z.string(),
      subject: z.string(),
      from: z.string(),
      status: z.string(),
    })),
  })).optional(),
}));

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL CATEGORIZATION PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const CATEGORIZATION_PROMPT = `You are an expert email analyst. Analyze the following email and provide structured categorization.

EMAIL:
Subject: {subject}
From: {from}
Date: {date}
Body:
{body}

Analyze this email and provide:
1. Category (work, personal, finance, shopping, travel, social, newsletters, promotions, updates, support, legal, health, other)
2. Sub-category if applicable (e.g., "meetings" under work, "bills" under finance)
3. Priority (urgent, high, normal, low)
4. A brief summary (1-2 sentences)
5. Whether action is required
6. Suggested action if applicable
7. Key points (up to 5)
8. Overall sentiment
9. Confidence in your analysis (0-1)

Consider:
- Urgency indicators: deadlines, "ASAP", "urgent", time-sensitive language
- Action indicators: questions, requests, tasks, invitations requiring RSVP
- Financial indicators: invoices, receipts, account statements
- Work indicators: project names, meeting requests, colleagues

Respond with valid JSON matching the schema.`;

const GROUPING_PROMPT = `You are an email organization expert. Given the following list of emails, group them intelligently for a daily report.

EMAILS:
{emails}

Create logical groupings with:
1. Main categories (Work, Personal, Finance, etc.)
2. Sub-categories where helpful (e.g., Work → Meetings, Projects, Updates)
3. Within each group, order by priority/importance
4. Mark threads that need action

For each thread include:
- threadId (from input)
- subject
- from (sender)
- status (unread/read/replied/action_needed)
- priority (if categorized)
- brief summary
- lastMessageAt timestamp

Create nested groupings where it makes sense (e.g., Work contains Meetings contains individual meeting threads).

Respond with valid JSON array of groupings.`;

// ═══════════════════════════════════════════════════════════════════════════
// AGENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyze a single email and return categorization
 */
export const analyzeEmail = internalAction({
  args: {
    subject: v.string(),
    from: v.string(),
    date: v.optional(v.string()),
    bodyPlain: v.optional(v.string()),
    bodySnippet: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<EmailAnalysis> => {
    const startTime = Date.now();

    // Use FREE model by default for autonomous email processing
    const modelId = (args.model || "qwen3-coder-free") as ApprovedModel;
    const languageModel = getLanguageModelSafe(normalizeModelInput(modelId));

    // Build prompt
    const body = args.bodyPlain?.slice(0, 2000) || args.bodySnippet || "(no content)";
    const prompt = CATEGORIZATION_PROMPT
      .replace("{subject}", args.subject)
      .replace("{from}", args.from)
      .replace("{date}", args.date || "Unknown")
      .replace("{body}", body);

    try {
      const { generateObject } = await import("ai");

      const aiResult = await generateObject({
        model: languageModel,
        schema: EmailAnalysisSchema,
        prompt,
      });

      const analysis = aiResult.object;

      console.log(`[emailAgent.analyzeEmail] Analyzed email "${args.subject}" -> ${analysis.category} (${analysis.priority}) in ${Date.now() - startTime}ms`);

      return analysis;
    } catch (err: any) {
      console.error("[emailAgent.analyzeEmail] Error:", err);

      // Return default analysis on error
      return {
        category: "other",
        priority: "normal",
        summary: args.bodySnippet?.slice(0, 100) || "Unable to analyze",
        actionRequired: false,
        keyPoints: ["Email could not be automatically analyzed"],
        sentiment: "neutral",
        confidence: 0.3,
      };
    }
  },
});

/**
 * Batch analyze multiple emails for efficiency
 */
export const batchAnalyzeEmails = internalAction({
  args: {
    emails: v.array(v.object({
      id: v.string(),
      subject: v.string(),
      from: v.string(),
      date: v.optional(v.string()),
      bodySnippet: v.optional(v.string()),
    })),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Array<{ id: string; analysis: EmailAnalysis }>> => {
    const results: Array<{ id: string; analysis: EmailAnalysis }> = [];

    // Process in parallel batches of 5
    const batchSize = 5;
    for (let i = 0; i < args.emails.length; i += batchSize) {
      const batch = args.emails.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (email: { id: string; subject: string; from: string; date?: string; bodySnippet?: string }) => {
          const analysis = await ctx.runAction(internal.domains.agents.emailAgent.analyzeEmail, {
            subject: email.subject,
            from: email.from,
            date: email.date,
            bodySnippet: email.bodySnippet,
            model: args.model,
          });
          return { id: email.id, analysis };
        })
      );

      results.push(...batchResults);
    }

    return results;
  },
});

/**
 * Group emails into categories for daily report
 */
export const groupEmailsForReport = internalAction({
  args: {
    userId: v.id("users"),
    date: v.optional(v.string()), // YYYY-MM-DD format
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<EmailGrouping[]> => {
    const startTime = Date.now();
    const dateStr = args.date || new Date().toISOString().split("T")[0];

    // Fetch today's email threads
    const threads = await ctx.runQuery(internal.domains.agents.emailAgent.getThreadsForDate, {
      userId: args.userId,
      date: dateStr,
    });

    if (!threads || threads.length === 0) {
      console.log(`[emailAgent.groupEmailsForReport] No emails found for ${dateStr}`);
      return [];
    }

    console.log(`[emailAgent.groupEmailsForReport] Grouping ${threads.length} threads...`);

    // Use FREE model by default for autonomous email processing
    const modelId = (args.model || "qwen3-coder-free") as ApprovedModel;
    const languageModel = getLanguageModelSafe(normalizeModelInput(modelId));

    // Format emails for prompt
    interface ThreadData {
      _id: string;
      subject: string;
      participants?: string[];
      snippet?: string;
      unreadCount?: number;
      lastMessageAt: number;
      aiCategory?: string;
      aiPriority?: string;
    }

    const emailsList = threads.map((t: ThreadData) => ({
      threadId: t._id,
      subject: t.subject,
      from: t.participants?.[0] || "Unknown",
      snippet: t.snippet || "",
      unreadCount: t.unreadCount || 0,
      lastMessageAt: t.lastMessageAt,
      aiCategory: t.aiCategory,
      aiPriority: t.aiPriority,
    }));

    const prompt = GROUPING_PROMPT.replace("{emails}", JSON.stringify(emailsList, null, 2));

    try {
      const { generateObject } = await import("ai");

      const aiResult = await generateObject({
        model: languageModel,
        schema: EmailGroupingsSchema,
        prompt,
      });

      const groupings = aiResult.object;

      console.log(`[emailAgent.groupEmailsForReport] Created ${groupings.length} groups in ${Date.now() - startTime}ms`);

      return groupings;
    } catch (err: any) {
      console.error("[emailAgent.groupEmailsForReport] Error:", err);

      // Fallback: simple grouping by existing categories
      return createFallbackGroupings(threads);
    }
  },
});

/**
 * Create fallback groupings when AI fails
 */
function createFallbackGroupings(threads: any[]): EmailGrouping[] {
  const categoryMap = new Map<string, any[]>();

  for (const thread of threads) {
    const category = thread.aiCategory || "Uncategorized";
    if (!categoryMap.has(category)) {
      categoryMap.set(category, []);
    }
    categoryMap.get(category)!.push(thread);
  }

  return Array.from(categoryMap.entries()).map(([category, categoryThreads]) => ({
    category,
    count: categoryThreads.length,
    threads: categoryThreads.map(t => ({
      threadId: t._id,
      subject: t.subject,
      from: t.participants?.[0] || "Unknown",
      status: t.unreadCount > 0 ? "unread" as const : "read" as const,
      priority: t.aiPriority,
      summary: t.aiSummary,
      lastMessageAt: t.lastMessageAt,
    })),
  }));
}

/**
 * Update email thread with AI analysis
 */
export const updateThreadWithAnalysis = internalMutation({
  args: {
    threadId: v.id("emailThreads"),
    analysis: v.object({
      category: v.string(),
      subCategory: v.optional(v.string()),
      priority: v.union(
        v.literal("urgent"),
        v.literal("high"),
        v.literal("normal"),
        v.literal("low")
      ),
      summary: v.string(),
      actionRequired: v.boolean(),
      actionSuggestion: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, {
      aiCategory: args.analysis.category,
      aiPriority: args.analysis.priority,
      aiSummary: args.analysis.summary,
      aiActionRequired: args.analysis.actionRequired,
      aiActionSuggestion: args.analysis.actionSuggestion,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Get threads for a specific date
 */
export const getThreadsForDate = internalQuery({
  args: {
    userId: v.id("users"),
    date: v.string(), // YYYY-MM-DD format
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // Parse date to get start/end timestamps
    const startOfDay = new Date(args.date + "T00:00:00Z").getTime();
    const endOfDay = new Date(args.date + "T23:59:59Z").getTime();

    const threads = await ctx.db
      .query("emailThreads")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .filter(q =>
        q.and(
          q.gte(q.field("lastMessageAt"), startOfDay),
          q.lte(q.field("lastMessageAt"), endOfDay)
        )
      )
      .collect();

    return threads;
  },
});

/**
 * Get uncategorized threads that need analysis
 */
export const getUncategorizedThreads = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const threads = await ctx.db
      .query("emailThreads")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .filter(q => q.eq(q.field("aiCategory"), undefined))
      .take(args.limit ?? 50);

    return threads;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PROCESSING PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process new emails: fetch, analyze, and categorize
 */
export const processNewEmails = internalAction({
  args: {
    userId: v.id("users"),
    maxEmails: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    console.log(`[emailAgent.processNewEmails] Starting for user ${args.userId}...`);

    // 1. Sync new emails from Gmail
    const syncResult = await ctx.runAction(internal.domains.integrations.email.emailService.syncEmails, {
      userId: args.userId,
      maxThreads: args.maxEmails ?? 30,
      query: "is:unread OR newer_than:1d",
    });

    console.log(`[emailAgent.processNewEmails] Synced ${syncResult.threadsSynced} threads`);

    // 2. Get uncategorized threads
    const uncategorized = await ctx.runQuery(internal.domains.agents.emailAgent.getUncategorizedThreads, {
      userId: args.userId,
      limit: 20,
    });

    if (uncategorized.length === 0) {
      console.log("[emailAgent.processNewEmails] No uncategorized threads to process");
      return { synced: syncResult.threadsSynced, analyzed: 0 };
    }

    console.log(`[emailAgent.processNewEmails] Analyzing ${uncategorized.length} threads...`);

    // 3. Analyze each thread
    let analyzed = 0;
    for (const thread of uncategorized) {
      try {
        // Get first message for analysis
        const messages = await ctx.runQuery(internal.domains.agents.emailAgent.getThreadMessages, {
          threadId: thread._id,
        });

        const firstMsg = messages[0];
        if (!firstMsg) continue;

        // Analyze the email
        const analysis = await ctx.runAction(internal.domains.agents.emailAgent.analyzeEmail, {
          subject: thread.subject,
          from: firstMsg.from || thread.participants?.[0] || "Unknown",
          date: firstMsg.internalDate ? new Date(firstMsg.internalDate).toISOString() : undefined,
          bodyPlain: firstMsg.bodyPlain,
          bodySnippet: firstMsg.snippet || thread.snippet,
        });

        // Update thread with analysis
        await ctx.runMutation(internal.domains.agents.emailAgent.updateThreadWithAnalysis, {
          threadId: thread._id,
          analysis: {
            category: analysis.category,
            subCategory: analysis.subCategory,
            priority: analysis.priority,
            summary: analysis.summary,
            actionRequired: analysis.actionRequired,
            actionSuggestion: analysis.actionSuggestion,
          },
        });

        analyzed++;
      } catch (err) {
        console.error(`[emailAgent.processNewEmails] Error analyzing thread ${thread._id}:`, err);
      }
    }

    console.log(`[emailAgent.processNewEmails] Analyzed ${analyzed} threads`);
    return { synced: syncResult.threadsSynced, analyzed };
  },
});

/**
 * Get messages for a thread
 */
export const getThreadMessages = internalQuery({
  args: {
    threadId: v.id("emailThreads"),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emailMessages")
      .withIndex("by_thread", q => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PRIORITY DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect urgent emails that need immediate attention
 */
export const detectUrgentEmails = internalAction({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<Array<{
    threadId: Id<"emailThreads">;
    subject: string;
    from: string;
    reason: string;
  }>> => {
    // Get all unread threads
    const unreadThreads = await ctx.runQuery(internal.domains.agents.emailAgent.getUnreadThreads, {
      userId: args.userId,
    });

    const urgentEmails: Array<{
      threadId: Id<"emailThreads">;
      subject: string;
      from: string;
      reason: string;
    }> = [];

    // Filter for urgent based on AI priority or keywords
    for (const thread of unreadThreads) {
      let reason: string | null = null;

      // Check AI priority
      if (thread.aiPriority === "urgent") {
        reason = "AI detected as urgent";
      }
      // Check keywords in subject
      else if (/\b(urgent|asap|emergency|critical|deadline|immediately)\b/i.test(thread.subject)) {
        reason = "Urgent keywords in subject";
      }
      // Check for action required
      else if (thread.aiActionRequired) {
        reason = "Action required";
      }

      if (reason) {
        urgentEmails.push({
          threadId: thread._id,
          subject: thread.subject,
          from: thread.participants?.[0] || "Unknown",
          reason,
        });
      }
    }

    return urgentEmails;
  },
});

/**
 * Get unread threads for a user
 */
export const getUnreadThreads = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emailThreads")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .filter(q => q.gt(q.field("unreadCount"), 0))
      .collect();
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CRON JOB ENTRY POINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cron job: Process new emails for all users with Gmail connected
 */
export const processNewEmailsCron = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[emailAgent.processNewEmailsCron] Starting email processing cron...");

    // Get all users with Gmail connected
    const usersWithGmail = await ctx.runQuery(internal.domains.integrations.email.dailyEmailReport.getUsersWithGmail, {});

    let processed = 0;
    let errors = 0;

    for (const userAccount of usersWithGmail) {
      try {
        const result = await ctx.runAction(internal.domains.agents.emailAgent.processNewEmails, {
          userId: userAccount.userId,
          maxEmails: 30,
        });

        console.log(`[emailAgent.processNewEmailsCron] User ${userAccount.userId}: synced ${result.synced}, analyzed ${result.analyzed}`);
        processed++;
      } catch (err) {
        console.error(`[emailAgent.processNewEmailsCron] Error processing user ${userAccount.userId}:`, err);
        errors++;
      }
    }

    console.log(`[emailAgent.processNewEmailsCron] Completed: ${processed} users processed, ${errors} errors`);
    return { processed, errors };
  },
});

/**
 * Cron job: Detect urgent emails and send alerts
 */
export const urgentEmailAlertsCron = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[emailAgent.urgentEmailAlertsCron] Checking for urgent emails...");

    // Get all users with Gmail connected
    const usersWithGmail = await ctx.runQuery(internal.domains.integrations.email.dailyEmailReport.getUsersWithGmail, {});

    let alertsSent = 0;

    for (const userAccount of usersWithGmail) {
      try {
        // Detect urgent emails for this user
        const urgentEmails = await ctx.runAction(internal.domains.agents.emailAgent.detectUrgentEmails, {
          userId: userAccount.userId,
        });

        if (urgentEmails.length === 0) continue;

        // Get user preferences for notifications
        const prefs = await ctx.runQuery(internal.domains.auth.userPreferences.getByUserId, {
          userId: userAccount.userId,
        });

        if (!prefs?.smsNotificationsEnabled || !prefs?.phoneNumber) continue;

        // Send ntfy alert for urgent emails
        const body = urgentEmails.map((e: { subject: string; from: string; reason: string }, i: number) =>
          `**${i + 1}. ${e.subject}**\nFrom: ${e.from}\nReason: ${e.reason}`
        ).join("\n\n");

        await ctx.runAction(api.domains.integrations.ntfy.sendNotification, {
          topic: prefs.phoneNumber,
          title: `🚨 ${urgentEmails.length} Urgent Email${urgentEmails.length > 1 ? "s" : ""} Need Attention`,
          body,
          priority: 5,
          tags: ["email", "warning"],
          markdown: true,
          userId: userAccount.userId,
          eventType: "urgent_email_alert",
        });

        alertsSent += urgentEmails.length;
        console.log(`[emailAgent.urgentEmailAlertsCron] Sent alert for ${urgentEmails.length} urgent emails to user ${userAccount.userId}`);
      } catch (err) {
        console.error(`[emailAgent.urgentEmailAlertsCron] Error for user ${userAccount.userId}:`, err);
      }
    }

    console.log(`[emailAgent.urgentEmailAlertsCron] Completed: ${alertsSent} alerts sent`);
    return { alertsSent };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC TEST ACTION FOR CLI TESTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Public action to test email analysis (for CLI testing)
 * Usage: npx convex run domains/agents/emailAgent:testEmailAnalysis '{...}'
 */
export const testEmailAnalysis = action({
  args: {
    subject: v.string(),
    from: v.string(),
    bodySnippet: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log(`[testEmailAnalysis] Testing with subject: "${args.subject}"`);

    const analysis = await ctx.runAction(internal.domains.agents.emailAgent.analyzeEmail, {
      subject: args.subject,
      from: args.from,
      bodySnippet: args.bodySnippet,
      model: args.model || "qwen3-coder-free",
    });

    return {
      success: true,
      model: args.model || "qwen3-coder-free",
      analysis,
    };
  },
});
