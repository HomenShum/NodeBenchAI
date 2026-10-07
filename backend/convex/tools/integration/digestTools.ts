/**
 * Digest Generation Tools
 *
 * Tools for generating personalized daily email digests
 * with AI-2027.com-style formatting and FierceBiotech-style density.
 *
 * @module tools/integration/digestTools
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api, internal } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// DIGEST GENERATION TOOL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a personalized daily digest based on user's tracked topics
 */
export const generateDailyDigest = createTool({
  description: `Generate a personalized daily digest for a user based on their tracked topics.

This tool:
1. Fetches the user's tracked hashtags/topics
2. Searches for recent news and updates for each topic
3. Synthesizes an executive summary
4. Formats content for email delivery

Returns a structured digest ready for email or preview.`,

  args: z.object({
    userId: z.string().describe("User ID to generate digest for"),
    date: z.string().optional().describe("Date for the digest (ISO format, defaults to today)"),
    maxItemsPerTopic: z.number().default(3).describe("Maximum items per topic"),
    includeAnalysis: z.boolean().default(true).describe("Include AI analysis/synthesis"),
  }),

  handler: async (ctx, args): Promise<string> => {
    console.log(`[generateDailyDigest] Generating for user: ${args.userId}`);

    const digestDate = args.date || new Date().toISOString().split("T")[0];

    try {
      // 1. Get user's tracked topics (hashtags) from recent dossiers
      const recentHashtags = await ctx.runQuery(
        api.domains.search.hashtagDossiers.getRecentHashtags,
        { limit: 10 }
      );

      // Extract hashtag strings from the dossier results
      const userTopics = recentHashtags.map((h: { hashtag: string }) => h.hashtag);

      if (!userTopics || userTopics.length === 0) {
        return JSON.stringify({
          kind: "digest_error",
          version: 1,
          payload: {
            error: "No tracked topics found",
            message: "User has no tracked hashtags. Add topics using #hashtag syntax.",
          },
        });
      }

      // 2. Search for content for each topic
      const topicResults: Array<{
        hashtag: string;
        items: Array<{
          id: string;
          title: string;
          summary: string;
          source: string;
          url?: string;
          publishedAt: string;
          type: "news" | "analysis" | "alert" | "update";
        }>;
        sentiment?: "positive" | "neutral" | "negative";
      }> = [];

      for (const hashtag of userTopics.slice(0, 10)) {
        try {
          const searchPayload = await ctx.runAction(
            api.domains.search.fusion.actions.quickSearch,
            {
              query: hashtag.replace("#", ""),
              maxResults: args.maxItemsPerTopic,
            }
          );

          const results = searchPayload.payload.results || [];
          topicResults.push({
            hashtag: hashtag,
            items: results.map((r: any, i: number) => ({
              id: `${hashtag}-${i}`,
              title: r.title,
              summary: r.snippet || "",
              source: r.source || "web",
              url: r.url,
              publishedAt: r.publishedAt || new Date().toISOString(),
              type: "news" as const,
            })),
            sentiment: "neutral",
          });
        } catch (err) {
          console.warn(`[generateDailyDigest] Failed to search for ${hashtag}:`, err);
        }
      }

      // 3. Flatten all items and deduplicate
      const allItems = topicResults.flatMap((t) =>
        t.items.map((item) => ({ ...item, topics: [t.hashtag] }))
      );

      // 4. Generate executive summary
      const topHeadlines = allItems.slice(0, 3).map((i) => i.title).join("; ");
      const executiveSummary = args.includeAnalysis
        ? `Today's digest covers ${allItems.length} items across ${topicResults.length} topics. Key headlines: ${topHeadlines}`
        : `${allItems.length} items across ${topicResults.length} topics.`;

      // 5. Build digest payload
      const digest = {
        kind: "daily_digest",
        version: 1,
        payload: {
          id: `digest-${args.userId}-${digestDate}`,
          date: digestDate,
          topics: topicResults.map((t) => ({
            hashtag: t.hashtag,
            itemCount: t.items.length,
            topHeadline: t.items[0]?.title,
            sentiment: t.sentiment,
          })),
          items: allItems,
          executiveSummary,
          metrics: {
            totalItems: allItems.length,
            newAlerts: allItems.filter((i) => i.type === "alert").length,
            topMovers: Math.min(3, allItems.length),
          },
          status: "draft",
        },
      };

      return JSON.stringify(digest);
    } catch (error) {
      console.error("[generateDailyDigest] Error:", error);
      return JSON.stringify({
        kind: "digest_error",
        version: 1,
        payload: {
          error: "Generation failed",
          message: String(error),
        },
      });
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DIGEST EMAIL FORMATTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format a digest as HTML email content
 */
export const formatDigestEmail = createTool({
  description: `Format a daily digest as HTML email content.

Takes a digest payload and formats it as a professional HTML email
with FierceBiotech-style information density and AI-2027.com-style polish.`,

  args: z.object({
    digestJson: z.string().describe("JSON string of the digest payload"),
    userEmail: z.string().describe("User's email address"),
    userName: z.string().optional().describe("User's display name"),
  }),

  handler: async (_ctx, args): Promise<string> => {
    try {
      const digestData = JSON.parse(args.digestJson);
      const digest = digestData.payload;
      const userName = args.userName || "there";

      // Build HTML email
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Digest - ${digest.date}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background: white;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px;">📰 Your Daily Digest</h1>
      <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0 0; font-size: 14px;">
        ${new Date(digest.date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
      </p>
    </div>

    <!-- Executive Summary -->
    <div style="padding: 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
      <p style="margin: 0; color: #475569; font-size: 15px; line-height: 1.6;">
        Hi ${userName}! ${digest.executiveSummary}
      </p>
    </div>

    <!-- Topics -->
    <div style="padding: 24px; border-bottom: 1px solid #e2e8f0;">
      <h2 style="margin: 0 0 16px 0; font-size: 16px; color: #1e293b;">Your Topics</h2>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        ${digest.topics.map((t: any) => `
          <span style="display: inline-block; padding: 4px 12px; background: #e2e8f0; border-radius: 16px; font-size: 13px; color: #475569;">
            ${t.hashtag} (${t.itemCount})
          </span>
        `).join("")}
      </div>
    </div>

    <!-- Items -->
    <div style="padding: 24px;">
      <h2 style="margin: 0 0 16px 0; font-size: 16px; color: #1e293b;">Today's Headlines</h2>
      ${digest.items.slice(0, 10).map((item: any) => `
        <div style="margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #f1f5f9;">
          <h3 style="margin: 0 0 4px 0; font-size: 15px; color: #1e293b;">
            ${item.url ? `<a href="${item.url}" style="color: #2563eb; text-decoration: none;">${item.title}</a>` : item.title}
          </h3>
          <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b; line-height: 1.5;">
            ${item.summary.slice(0, 150)}${item.summary.length > 150 ? "..." : ""}
          </p>
          <span style="font-size: 11px; color: #94a3b8;">${item.source} • ${new Date(item.publishedAt).toLocaleDateString()}</span>
        </div>
      `).join("")}
    </div>

    <!-- Footer -->
    <div style="padding: 24px; background: #f8fafc; text-align: center; border-top: 1px solid #e2e8f0;">
      <p style="margin: 0; font-size: 12px; color: #94a3b8;">
        Powered by NodeBench AI • <a href="https://nodebench.ai" style="color: #2563eb;">Manage preferences</a>
      </p>
    </div>
  </div>
</body>
</html>`;

      return JSON.stringify({
        kind: "digest_email",
        version: 1,
        payload: {
          to: args.userEmail,
          subject: `📰 Your Daily Digest - ${new Date(digest.date).toLocaleDateString()}`,
          html,
          digestId: digest.id,
        },
      });
    } catch (error) {
      console.error("[formatDigestEmail] Error:", error);
      return JSON.stringify({
        kind: "digest_error",
        version: 1,
        payload: { error: "Formatting failed", message: String(error) },
      });
    }
  },
});

// Export all digest tools
export const digestTools = {
  generateDailyDigest,
  formatDigestEmail,
};

