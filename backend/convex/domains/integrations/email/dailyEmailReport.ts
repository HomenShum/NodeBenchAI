/**
 * Daily Email Report Generator
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Generates end-of-day email reports with:
 * - Nested groupings by category
 * - Status per email (unread, read, replied, action_needed)
 * - Executive summary
 * - Suggested actions
 *
 * Delivery channels:
 * - Email inbox (via Resend)
 * - ntfy push notification
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, action } from "../../../_generated/server";
import { api, internal } from "../../../_generated/api";
import type { Id, Doc } from "../../../_generated/dataModel";
import { z } from "zod";

// Import email agent for grouping
import type { EmailGrouping } from "../../agents/emailAgent";

// Import model resolver
import {
  getLanguageModelSafe,
  normalizeModelInput,
  type ApprovedModel
} from "../../agents/mcp_tools/models";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface DailyEmailReportData {
  date: string;                              // YYYY-MM-DD
  totalReceived: number;
  totalSent: number;
  totalUnread: number;
  totalActionRequired: number;
  groupings: EmailGrouping[];
  executiveSummary?: string;
  keyHighlights?: string[];
  suggestedActions?: Array<{
    action: string;
    threadId?: string;
    priority: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// REPORT GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate the daily email report
 */
export const generateDailyReport = internalAction({
  args: {
    userId: v.id("users"),
    date: v.optional(v.string()),        // YYYY-MM-DD format, defaults to today
    model: v.optional(v.string()),       // Model for summary generation
  },
  handler: async (ctx, args): Promise<DailyEmailReportData> => {
    const dateStr = args.date || new Date().toISOString().split("T")[0];
    console.log(`[dailyEmailReport.generateDailyReport] Generating report for ${dateStr}...`);

    // 1. Get groupings from email agent
    const groupings = await ctx.runAction(internal.domains.agents.emailAgent.groupEmailsForReport, {
      userId: args.userId,
      date: dateStr,
      model: args.model,
    });

    // 2. Calculate statistics
    let totalReceived = 0;
    let totalUnread = 0;
    let totalActionRequired = 0;

    for (const group of groupings) {
      totalReceived += group.count;
      for (const thread of group.threads) {
        if (thread.status === "unread") totalUnread++;
        if (thread.status === "action_needed") totalActionRequired++;
      }
    }

    // 3. Get sent emails count (from emailEvents table)
    const sentCount = await ctx.runQuery(internal.domains.integrations.email.dailyEmailReport.getSentEmailsCount, {
      userId: args.userId,
      date: dateStr,
    });

    // 4. Generate executive summary using FREE model by default
    const modelId = (args.model || "qwen3-coder-free") as ApprovedModel;
    const languageModel = getLanguageModelSafe(normalizeModelInput(modelId));

    let executiveSummary: string | undefined;
    let keyHighlights: string[] | undefined;
    let suggestedActions: Array<{ action: string; threadId?: string; priority: string }> | undefined;

    if (groupings.length > 0) {
      try {
        const summaryPrompt = buildSummaryPrompt(groupings, {
          totalReceived,
          totalUnread,
          totalActionRequired,
          totalSent: sentCount,
        });

        const { generateText } = await import("ai");
        const aiResult = await generateText({
          model: languageModel,
          prompt: summaryPrompt,
        });

        const text = aiResult.text || "";
        try {
          const parsed = JSON.parse(text);
          executiveSummary = parsed.executiveSummary;
          keyHighlights = parsed.keyHighlights;
          suggestedActions = parsed.suggestedActions;
        } catch {
          // Use raw text as summary if JSON parsing fails
          executiveSummary = text.slice(0, 500);
        }
      } catch (err) {
        console.error("[dailyEmailReport.generateDailyReport] Summary generation failed:", err);
      }
    }

    const reportData: DailyEmailReportData = {
      date: dateStr,
      totalReceived,
      totalSent: sentCount,
      totalUnread,
      totalActionRequired,
      groupings,
      executiveSummary,
      keyHighlights,
      suggestedActions,
    };

    // 5. Store the report
    await ctx.runMutation(internal.domains.integrations.email.dailyEmailReport.storeReport, {
      userId: args.userId,
      report: reportData,
    });

    console.log(`[dailyEmailReport.generateDailyReport] Report generated: ${totalReceived} received, ${totalUnread} unread, ${totalActionRequired} action required`);

    return reportData;
  },
});

/**
 * Build prompt for executive summary generation
 */
function buildSummaryPrompt(
  groupings: EmailGrouping[],
  stats: { totalReceived: number; totalUnread: number; totalActionRequired: number; totalSent: number }
): string {
  const groupingSummary = groupings.map(g => {
    const actionNeeded = g.threads.filter(t => t.status === "action_needed").length;
    const urgent = g.threads.filter(t => t.priority === "urgent").length;
    return `- ${g.category}: ${g.count} emails (${actionNeeded} need action, ${urgent} urgent)`;
  }).join("\n");

  return `You are an executive assistant summarizing today's email activity.

STATISTICS:
- Total received: ${stats.totalReceived}
- Total sent: ${stats.totalSent}
- Unread: ${stats.totalUnread}
- Requiring action: ${stats.totalActionRequired}

EMAIL GROUPINGS:
${groupingSummary}

TOP THREADS NEEDING ATTENTION:
${groupings.flatMap(g =>
  g.threads.filter(t => t.status === "action_needed" || t.priority === "urgent")
    .slice(0, 3)
    .map(t => `- [${t.priority || "normal"}] ${t.subject} from ${t.from}`)
).slice(0, 10).join("\n")}

Generate a JSON response with:
{
  "executiveSummary": "A 2-3 sentence summary of email activity and priorities",
  "keyHighlights": ["Up to 5 key highlights or patterns"],
  "suggestedActions": [
    {"action": "What to do", "threadId": "optional thread ID", "priority": "high/medium/low"}
  ]
}`;
}

/**
 * Get sent emails count for a date
 */
export const getSentEmailsCount = internalQuery({
  args: {
    userId: v.id("users"),
    date: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const startOfDay = new Date(args.date + "T00:00:00Z").getTime();
    const endOfDay = new Date(args.date + "T23:59:59Z").getTime();

    const sentEmails = await ctx.db
      .query("emailsSent")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.gte(q.field("sentAt"), startOfDay),
          q.lte(q.field("sentAt"), endOfDay),
          q.eq(q.field("success"), true)
        )
      )
      .collect() as Doc<"emailsSent">[];

    return sentEmails.length;
  },
});

/**
 * Store the daily report
 */
export const storeReport = internalMutation({
  args: {
    userId: v.id("users"),
    report: v.any(),
  },
  returns: v.id("emailDailyReports"),
  handler: async (ctx, args) => {
    const { userId, report } = args;
    const now = Date.now();

    // Check for existing report
    const existing = await ctx.db
      .query("emailDailyReports")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("date", report.date))
      .first() as Doc<"emailDailyReports"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        totalReceived: report.totalReceived,
        totalSent: report.totalSent,
        totalUnread: report.totalUnread,
        totalActionRequired: report.totalActionRequired,
        groupings: report.groupings,
        executiveSummary: report.executiveSummary,
        keyHighlights: report.keyHighlights,
        suggestedActions: report.suggestedActions,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("emailDailyReports", {
      userId,
      date: report.date,
      totalReceived: report.totalReceived,
      totalSent: report.totalSent,
      totalUnread: report.totalUnread,
      totalActionRequired: report.totalActionRequired,
      groupings: report.groupings,
      executiveSummary: report.executiveSummary,
      keyHighlights: report.keyHighlights,
      suggestedActions: report.suggestedActions,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// REPORT DELIVERY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send the daily report via email and/or ntfy
 */
export const deliverDailyReport = internalAction({
  args: {
    userId: v.id("users"),
    reportId: v.id("emailDailyReports"),
    channels: v.array(v.union(v.literal("email"), v.literal("ntfy"))),
    recipientEmail: v.optional(v.string()),
    ntfyTopic: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get the report
    const report = await ctx.runQuery(internal.domains.integrations.email.dailyEmailReport.getReport, {
      reportId: args.reportId,
    });

    if (!report) {
      throw new Error("Report not found");
    }

    const deliveredVia: string[] = [];

    // Send via email
    if (args.channels.includes("email") && args.recipientEmail) {
      try {
        const html = generateReportEmailHtml(report);
        await ctx.runAction(api.domains.integrations.resend.sendEmail, {
          to: args.recipientEmail,
          subject: `📧 Daily Email Report - ${report.date} (${report.totalReceived} emails)`,
          html,
          userId: args.userId,
        });
        deliveredVia.push("email");
        console.log(`[dailyEmailReport.deliverDailyReport] Sent email to ${args.recipientEmail}`);
      } catch (err) {
        console.error("[dailyEmailReport.deliverDailyReport] Email delivery failed:", err);
      }
    }

    // Send via ntfy
    if (args.channels.includes("ntfy")) {
      try {
        const ntfyBody = generateNtfyReport(report);
        await ctx.runAction(api.domains.integrations.ntfy.sendNotification, {
          topic: args.ntfyTopic,
          title: `📧 Daily Email Report - ${report.date}`,
          body: ntfyBody,
          priority: report.totalActionRequired > 0 ? 4 : 3,
          tags: ["email", "clipboard"],
          markdown: true,
          userId: args.userId,
          eventType: "daily_email_report",
        });
        deliveredVia.push("ntfy");
        console.log(`[dailyEmailReport.deliverDailyReport] Sent ntfy notification`);
      } catch (err) {
        console.error("[dailyEmailReport.deliverDailyReport] Ntfy delivery failed:", err);
      }
    }

    // Update delivery status
    await ctx.runMutation(internal.domains.integrations.email.dailyEmailReport.updateDeliveryStatus, {
      reportId: args.reportId,
      deliveredVia,
    });

    return { deliveredVia };
  },
});

/**
 * Get a report by ID
 */
export const getReport = internalQuery({
  args: {
    reportId: v.id("emailDailyReports"),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.reportId) as Doc<"emailDailyReports"> | null;
  },
});

/**
 * Update delivery status
 */
export const updateDeliveryStatus = internalMutation({
  args: {
    reportId: v.id("emailDailyReports"),
    deliveredVia: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reportId, {
      deliveredVia: args.deliveredVia,
      deliveredAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HTML EMAIL TEMPLATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate HTML email for the daily report
 */
function generateReportEmailHtml(report: any): string {
  const dateFormatted = new Date(report.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Build groupings HTML with nested structure
  const groupingsHtml = report.groupings.map((group: any) => {
    const statusCounts = {
      unread: group.threads.filter((t: any) => t.status === "unread").length,
      action_needed: group.threads.filter((t: any) => t.status === "action_needed").length,
    };

    const threadsList = group.threads.slice(0, 5).map((thread: any) => {
      const statusIcon = thread.status === "unread" ? "📬"
        : thread.status === "action_needed" ? "⚠️"
        : thread.status === "replied" ? "✅"
        : "📭";
      const priorityBadge = thread.priority === "urgent" ? '<span style="background:#ef4444;color:white;padding:2px 6px;border-radius:4px;font-size:11px;">URGENT</span>'
        : thread.priority === "high" ? '<span style="background:#f97316;color:white;padding:2px 6px;border-radius:4px;font-size:11px;">HIGH</span>'
        : "";

      return `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span>${statusIcon}</span>
              <div style="flex:1;">
                <div style="font-size:14px;color:#1e293b;font-weight:500;">${thread.subject}</div>
                <div style="font-size:12px;color:#64748b;">${thread.from}</div>
              </div>
              ${priorityBadge}
            </div>
            ${thread.summary ? `<div style="font-size:12px;color:#94a3b8;margin-top:4px;">${thread.summary}</div>` : ""}
          </td>
        </tr>
      `;
    }).join("");

    const moreCount = group.threads.length - 5;
    const moreHtml = moreCount > 0 ? `<tr><td style="padding:8px 0;font-size:12px;color:#94a3b8;">+${moreCount} more emails</td></tr>` : "";

    // Sub-categories (nested list)
    const subCategoriesHtml = (group.subCategories || []).map((sub: any) => `
      <div style="margin-left:16px;margin-top:8px;">
        <div style="font-size:13px;color:#475569;font-weight:500;">${sub.name} (${sub.count})</div>
        <ul style="margin:4px 0;padding-left:16px;">
          ${sub.threads.slice(0, 3).map((t: any) => `
            <li style="font-size:12px;color:#64748b;margin:2px 0;">${t.subject}</li>
          `).join("")}
        </ul>
      </div>
    `).join("");

    return `
      <div style="margin-bottom:24px;">
        <h3 style="margin:0 0 12px;font-size:16px;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">
          ${group.category}
          <span style="font-weight:normal;color:#64748b;font-size:14px;margin-left:8px;">
            ${group.count} emails
            ${statusCounts.unread > 0 ? `<span style="color:#2563eb;">(${statusCounts.unread} unread)</span>` : ""}
            ${statusCounts.action_needed > 0 ? `<span style="color:#ef4444;">(${statusCounts.action_needed} need action)</span>` : ""}
          </span>
        </h3>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          ${threadsList}
          ${moreHtml}
        </table>
        ${subCategoriesHtml}
      </div>
    `;
  }).join("");

  // Suggested actions
  const actionsHtml = (report.suggestedActions || []).slice(0, 5).map((action: any) => `
    <li style="margin:8px 0;">
      <span style="color:#1e293b;">${action.action}</span>
      ${action.priority === "high" ? '<span style="background:#f97316;color:white;padding:2px 6px;border-radius:4px;font-size:11px;margin-left:8px;">High Priority</span>' : ""}
    </li>
  `).join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Email Report - ${dateFormatted}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="padding:32px;background:linear-gradient(135deg,#1e293b 0%,#334155 100%);border-radius:12px 12px 0 0;">
              <h1 style="margin:0;color:white;font-size:24px;font-weight:600;">📧 Daily Email Report</h1>
              <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">${dateFormatted}</p>
            </td>
          </tr>

          <!-- Stats -->
          <tr>
            <td style="padding:24px 32px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:8px;">
                    <div style="font-size:28px;font-weight:700;color:#1e293b;">${report.totalReceived}</div>
                    <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Received</div>
                  </td>
                  <td align="center" style="padding:8px;">
                    <div style="font-size:28px;font-weight:700;color:#2563eb;">${report.totalUnread}</div>
                    <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Unread</div>
                  </td>
                  <td align="center" style="padding:8px;">
                    <div style="font-size:28px;font-weight:700;color:#ef4444;">${report.totalActionRequired}</div>
                    <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Need Action</div>
                  </td>
                  <td align="center" style="padding:8px;">
                    <div style="font-size:28px;font-weight:700;color:#10b981;">${report.totalSent}</div>
                    <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Sent</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Executive Summary -->
          ${report.executiveSummary ? `
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
              <h2 style="margin:0 0 12px;font-size:16px;font-weight:600;color:#1e293b;">Executive Summary</h2>
              <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">${report.executiveSummary}</p>
            </td>
          </tr>
          ` : ""}

          <!-- Key Highlights -->
          ${report.keyHighlights?.length > 0 ? `
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
              <h2 style="margin:0 0 12px;font-size:16px;font-weight:600;color:#1e293b;">Key Highlights</h2>
              <ul style="margin:0;padding-left:20px;">
                ${report.keyHighlights.map((h: string) => `<li style="font-size:14px;color:#475569;margin:4px 0;">${h}</li>`).join("")}
              </ul>
            </td>
          </tr>
          ` : ""}

          <!-- Suggested Actions -->
          ${actionsHtml ? `
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
              <h2 style="margin:0 0 12px;font-size:16px;font-weight:600;color:#1e293b;">Suggested Actions</h2>
              <ul style="margin:0;padding-left:20px;">
                ${actionsHtml}
              </ul>
            </td>
          </tr>
          ` : ""}

          <!-- Email Groupings -->
          <tr>
            <td style="padding:24px 32px;">
              <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#1e293b;">Email Breakdown</h2>
              ${groupingsHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;background:#f8fafc;border-radius:0 0 12px 12px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
                Powered by <strong>NodeBench AI</strong> •
                <a href="https://nodebench.ai" style="color:#2563eb;text-decoration:none;">View Dashboard</a> •
                <a href="https://nodebench.ai/settings" style="color:#2563eb;text-decoration:none;">Manage Preferences</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// NTFY NOTIFICATION FORMAT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate ntfy notification body for the daily report
 */
function generateNtfyReport(report: any): string {
  let body = `**📊 Summary**\n`;
  body += `Received: ${report.totalReceived} | Unread: ${report.totalUnread} | Need Action: ${report.totalActionRequired}\n\n`;

  if (report.executiveSummary) {
    body += `**💡 Insight**\n${report.executiveSummary}\n\n`;
  }

  // Categories
  body += `**📁 Categories**\n`;
  for (const group of report.groupings.slice(0, 5)) {
    const actionCount = group.threads.filter((t: any) => t.status === "action_needed").length;
    const urgentCount = group.threads.filter((t: any) => t.priority === "urgent").length;
    let line = `• ${group.category}: ${group.count}`;
    if (actionCount > 0) line += ` (⚠️ ${actionCount} need action)`;
    if (urgentCount > 0) line += ` (🔴 ${urgentCount} urgent)`;
    body += line + "\n";
  }

  // Top urgent items
  const urgentItems = report.groupings
    .flatMap((g: any) => g.threads.filter((t: any) => t.priority === "urgent" || t.status === "action_needed"))
    .slice(0, 3);

  if (urgentItems.length > 0) {
    body += `\n**⚠️ Needs Attention**\n`;
    for (const item of urgentItems) {
      body += `• ${item.subject}\n  From: ${item.from}\n`;
    }
  }

  // Suggested actions
  if (report.suggestedActions?.length > 0) {
    body += `\n**🎯 Actions**\n`;
    for (const action of report.suggestedActions.slice(0, 3)) {
      body += `• ${action.action}\n`;
    }
  }

  return body;
}

// ═══════════════════════════════════════════════════════════════════════════
// CRON JOB ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Daily report cron job - runs at end of day
 * Processes all users with email integration enabled
 */
export const runDailyEmailReportCron = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[dailyEmailReport.runDailyEmailReportCron] Starting daily email report generation...");

    // Get all users with Gmail connected
    const usersWithGmail = await ctx.runQuery(internal.domains.integrations.email.dailyEmailReport.getUsersWithGmail, {});

    console.log(`[dailyEmailReport.runDailyEmailReportCron] Found ${usersWithGmail.length} users with Gmail connected`);

    const today = new Date().toISOString().split("T")[0];
    let processed = 0;
    let errors = 0;

    for (const userAccount of usersWithGmail) {
      try {
        // Generate report
        const report = await ctx.runAction(internal.domains.integrations.email.dailyEmailReport.generateDailyReport, {
          userId: userAccount.userId,
          date: today,
        });

        // Get user preferences for delivery
        const prefs = await ctx.runQuery(internal.domains.auth.userPreferences.getByUserId, {
          userId: userAccount.userId,
        });

        // Determine delivery channels
        const channels: ("email" | "ntfy")[] = [];
        if (userAccount.email) channels.push("email");
        if (prefs?.smsNotificationsEnabled && prefs?.phoneNumber) channels.push("ntfy");

        if (channels.length > 0) {
          // Get the stored report ID
          const storedReport = await ctx.runQuery(internal.domains.integrations.email.dailyEmailReport.getReportByDate, {
            userId: userAccount.userId,
            date: today,
          });

          if (storedReport) {
            await ctx.runAction(internal.domains.integrations.email.dailyEmailReport.deliverDailyReport, {
              userId: userAccount.userId,
              reportId: storedReport._id,
              channels,
              recipientEmail: userAccount.email,
              ntfyTopic: prefs?.phoneNumber,
            });
          }
        }

        processed++;
      } catch (err) {
        console.error(`[dailyEmailReport.runDailyEmailReportCron] Error processing user ${userAccount.userId}:`, err);
        errors++;
      }
    }

    console.log(`[dailyEmailReport.runDailyEmailReportCron] Completed: ${processed} processed, ${errors} errors`);
    return { processed, errors };
  },
});

/**
 * Get all users with Gmail connected
 */
export const getUsersWithGmail = internalQuery({
  args: {},
  returns: v.array(v.object({
    userId: v.id("users"),
    email: v.optional(v.string()),
  })),
  handler: async (ctx) => {
    const accounts = await ctx.db
      .query("googleAccounts")
      .collect() as Doc<"googleAccounts">[];

    return accounts.map((a: Doc<"googleAccounts">) => ({
      userId: a.userId,
      email: a.email,
    }));
  },
});

/**
 * Get report by date
 */
export const getReportByDate = internalQuery({
  args: {
    userId: v.id("users"),
    date: v.string(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emailDailyReports")
      .withIndex("by_user_date", (q) => q.eq("userId", args.userId).eq("date", args.date))
      .first() as Doc<"emailDailyReports"> | null;
  },
});
