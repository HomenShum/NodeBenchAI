/**
 * Resend Email Integration
 */

import { action, internalAction } from "../../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../../_generated/api";
import type { EmailDigest } from "../../../src/features/research/components/EmailDigestPreview";

/**
 * Send email via Resend API
 */
export const sendEmail = action({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // Single source of truth for Resend API key
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("[sendEmail] RESEND_API_KEY not configured");

      // Track failed email
      await ctx.runMutation(api.domains.analytics.analytics.trackEmailSent, {
        email: args.to,
        userId: args.userId,
        subject: args.subject,
        success: false,
      });

      throw new Error("Email service not configured");
    }

    // Single source of truth for from-address
    const fromAddress = process.env.EMAIL_FROM || "NodeBench AI <research@nodebench.ai>";

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [args.to],
          subject: args.subject,
          html: args.html,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[sendEmail] Resend API error:", response.status, errorText);
        
        // Track failed email
        await ctx.runMutation(api.domains.analytics.analytics.trackEmailSent, {
          email: args.to,
          userId: args.userId,
          subject: args.subject,
          success: false,
        });
        
        throw new Error(`Failed to send email: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      console.log("[sendEmail] Email sent successfully:", data);
      
      // Track successful email
      await ctx.runMutation(api.domains.analytics.analytics.trackEmailSent, {
        email: args.to,
        userId: args.userId,
        subject: args.subject,
        success: true,
      });
      
      return {
        success: true,
        emailId: data.id,
      };
    } catch (error: any) {
      console.error("[sendEmail] Error:", error);

      // Track failed email
      await ctx.runMutation(api.domains.analytics.analytics.trackEmailSent, {
        email: args.to,
        userId: args.userId,
        subject: args.subject,
        success: false,
      });

      throw error;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DAILY DIGEST EMAIL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate HTML for daily digest email
 */
function generateDigestEmailHtml(digest: EmailDigest, userName?: string): string {
  const dateFormatted = new Date(digest.date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const topicsHtml = digest.topics.map(topic => {
    const sentimentColor = topic.sentiment === "positive" ? "#10b981"
      : topic.sentiment === "negative" ? "#ef4444"
      : "#6b7280";
    return `
      <span style="display: inline-block; padding: 4px 12px; margin: 4px; background: #f1f5f9; border-radius: 16px; font-size: 13px; color: #334155;">
        <span style="color: ${sentimentColor}; font-weight: 600;">${topic.hashtag}</span>
        <span style="color: #94a3b8; margin-left: 4px;">(${topic.itemCount})</span>
      </span>
    `;
  }).join("");

  const itemsHtml = digest.items.slice(0, 8).map(item => {
    const typeIcon = item.type === "news" ? "📰"
      : item.type === "alert" ? "🚨"
      : item.type === "analysis" ? "💡"
      : "📊";
    return `
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #f1f5f9;">
          <div style="font-size: 14px; color: #1e293b; font-weight: 500; margin-bottom: 4px;">
            ${typeIcon} ${item.title}
          </div>
          <div style="font-size: 13px; color: #64748b; line-height: 1.5;">
            ${item.summary}
          </div>
          ${item.url ? `<a href="${item.url}" style="font-size: 12px; color: #2563eb; text-decoration: none;">Read more →</a>` : ""}
        </td>
      </tr>
    `;
  }).join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Digest - ${dateFormatted}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="padding: 32px; background: linear-gradient(135deg, #1e293b 0%, #334155 100%); border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 600;">📰 Daily Digest</h1>
              <p style="margin: 8px 0 0; color: #94a3b8; font-size: 14px;">${dateFormatted}</p>
              ${userName ? `<p style="margin: 4px 0 0; color: #cbd5e1; font-size: 13px;">Hello, ${userName}</p>` : ""}
            </td>
          </tr>

          <!-- Metrics -->
          ${digest.metrics ? `
          <tr>
            <td style="padding: 24px 32px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding: 8px;">
                    <div style="font-size: 24px; font-weight: 700; color: #1e293b;">${digest.metrics.totalItems}</div>
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Items</div>
                  </td>
                  <td align="center" style="padding: 8px;">
                    <div style="font-size: 24px; font-weight: 700; color: #ef4444;">${digest.metrics.newAlerts}</div>
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Alerts</div>
                  </td>
                  <td align="center" style="padding: 8px;">
                    <div style="font-size: 24px; font-weight: 700; color: #10b981;">${digest.metrics.topMovers}</div>
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Movers</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ""}

          <!-- Executive Summary -->
          <tr>
            <td style="padding: 24px 32px;">
              <h2 style="margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #1e293b;">Executive Summary</h2>
              <p style="margin: 0; font-size: 14px; color: #475569; line-height: 1.6;">${digest.executiveSummary}</p>
            </td>
          </tr>

          <!-- Topics -->
          <tr>
            <td style="padding: 0 32px 24px;">
              <h2 style="margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #1e293b;">Your Topics</h2>
              <div>${topicsHtml}</div>
            </td>
          </tr>

          <!-- Items -->
          <tr>
            <td style="padding: 0 32px 24px;">
              <h2 style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: #1e293b;">Today's Highlights</h2>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${itemsHtml}
              </table>
              ${digest.items.length > 8 ? `
              <p style="margin: 16px 0 0; font-size: 13px; color: #64748b; text-align: center;">
                +${digest.items.length - 8} more items in your dashboard
              </p>
              ` : ""}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background: #f8fafc; border-radius: 0 0 12px 12px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8; text-align: center;">
                Powered by <strong>NodeBench AI</strong> •
                <a href="https://nodebench.ai" style="color: #2563eb; text-decoration: none;">View Dashboard</a> •
                <a href="https://nodebench.ai/settings" style="color: #2563eb; text-decoration: none;">Manage Preferences</a>
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

/**
 * Send daily digest email to a user
 */
export const sendDailyDigest = action({
  args: {
    to: v.string(),
    digest: v.any(), // EmailDigest type
    userName: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<{ success: boolean; emailId?: string; error?: string }> => {
    const digest = args.digest as EmailDigest;

    // Generate HTML
    const html = generateDigestEmailHtml(digest, args.userName);

    // Format date for subject
    const dateFormatted = new Date(digest.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    const subject = `📰 Your Daily Digest - ${dateFormatted} (${digest.items.length} items)`;

    // Use the existing sendEmail action
    const result: { success: boolean; emailId?: string; error?: string } = await ctx.runAction(api.domains.integrations.resend.sendEmail, {
      to: args.to,
      subject,
      html,
      userId: args.userId,
    });

    console.log("[sendDailyDigest] Sent digest to", args.to, result);

    return result;
  },
});

