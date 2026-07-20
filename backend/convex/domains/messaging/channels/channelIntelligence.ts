/**
 * Channel Intelligence - Smart Channel Selection & Optimization
 * Deep Agents 3.0 - AI-driven channel routing based on content, user, and timing
 *
 * Features:
 * - Content-type to channel mapping
 * - User preference learning
 * - Time-of-day optimization
 * - Engagement-based routing
 * - Channel capacity management
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { PUBLISHING_CONFIG, ENGAGEMENT_CONFIG } from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export type Channel = "ntfy" | "email" | "slack" | "sms" | "ui";

export interface ChannelCapability {
  channel: Channel;
  supportsRichText: boolean;
  supportsImages: boolean;
  supportsLinks: boolean;
  maxLength: number;
  latencyMs: number;
  costPerMessage: number;
  interruptLevel: "high" | "medium" | "low";
}

export interface ChannelScore {
  channel: Channel;
  score: number;
  reasons: string[];
}

export interface ChannelRecommendation {
  primary: Channel;
  fallback: Channel[];
  scores: ChannelScore[];
  reasoning: string;
}

export interface ContentAnalysis {
  urgency: "breaking" | "high" | "normal" | "low";
  complexity: "simple" | "moderate" | "complex";
  actionRequired: boolean;
  sensitivityLevel: "public" | "internal" | "confidential";
  contentType: "alert" | "digest" | "report" | "notification" | "update";
}

/* ================================================================== */
/* CHANNEL CAPABILITIES                                                */
/* ================================================================== */

const CHANNEL_CAPABILITIES: Record<Channel, ChannelCapability> = {
  ntfy: {
    channel: "ntfy",
    supportsRichText: false,
    supportsImages: false,
    supportsLinks: true,
    maxLength: 4096,
    latencyMs: 100,
    costPerMessage: 0,
    interruptLevel: "high",
  },
  email: {
    channel: "email",
    supportsRichText: true,
    supportsImages: true,
    supportsLinks: true,
    maxLength: 100000,
    latencyMs: 2000,
    costPerMessage: 0.001,
    interruptLevel: "low",
  },
  slack: {
    channel: "slack",
    supportsRichText: true,
    supportsImages: true,
    supportsLinks: true,
    maxLength: 40000,
    latencyMs: 500,
    costPerMessage: 0,
    interruptLevel: "medium",
  },
  sms: {
    channel: "sms",
    supportsRichText: false,
    supportsImages: false,
    supportsLinks: true,
    maxLength: 1600,
    latencyMs: 1000,
    costPerMessage: 0.01,
    interruptLevel: "high",
  },
  ui: {
    channel: "ui",
    supportsRichText: true,
    supportsImages: true,
    supportsLinks: true,
    maxLength: 1000000,
    latencyMs: 50,
    costPerMessage: 0,
    interruptLevel: "low",
  },
};

/* ================================================================== */
/* CONTENT ANALYSIS                                                    */
/* ================================================================== */

/**
 * Analyze content to determine routing characteristics
 */
function analyzeContent(content: string, metadata?: Record<string, unknown>): ContentAnalysis {
  const contentLower = content.toLowerCase();

  // Determine urgency
  let urgency: ContentAnalysis["urgency"] = "normal";
  if (/breaking|urgent|critical|immediate|alert/i.test(contentLower)) {
    urgency = "breaking";
  } else if (/important|significant|major/i.test(contentLower)) {
    urgency = "high";
  } else if (/fyi|update|minor/i.test(contentLower)) {
    urgency = "low";
  }

  // Determine complexity based on length and structure
  let complexity: ContentAnalysis["complexity"] = "moderate";
  if (content.length < 200) {
    complexity = "simple";
  } else if (content.length > 2000 || /\n.*\n.*\n/g.test(content)) {
    complexity = "complex";
  }

  // Check for action items
  const actionRequired = /action required|please|should|must|need to|deadline/i.test(contentLower);

  // Determine sensitivity
  let sensitivityLevel: ContentAnalysis["sensitivityLevel"] = "public";
  if (/confidential|private|internal only|do not share/i.test(contentLower)) {
    sensitivityLevel = "confidential";
  } else if (/internal|team only/i.test(contentLower)) {
    sensitivityLevel = "internal";
  }

  // Determine content type
  let contentType: ContentAnalysis["contentType"] = "notification";
  if (/alert|warning|critical/i.test(contentLower)) {
    contentType = "alert";
  } else if (/digest|summary|daily|weekly/i.test(contentLower)) {
    contentType = "digest";
  } else if (/report|analysis|findings/i.test(contentLower)) {
    contentType = "report";
  } else if (/update|news|announcement/i.test(contentLower)) {
    contentType = "update";
  }

  return { urgency, complexity, actionRequired, sensitivityLevel, contentType };
}

/**
 * Score a channel for given content
 */
function scoreChannel(
  channel: Channel,
  analysis: ContentAnalysis,
  userPreferences?: Record<Channel, number>,
  timeOfDay?: number
): ChannelScore {
  const capability = CHANNEL_CAPABILITIES[channel];
  let score = 50; // Base score
  const reasons: string[] = [];

  // Urgency matching
  if (analysis.urgency === "breaking" || analysis.urgency === "high") {
    if (capability.interruptLevel === "high") {
      score += 25;
      reasons.push("High interrupt level matches urgency");
    } else if (capability.interruptLevel === "low") {
      score -= 15;
      reasons.push("Low interrupt level mismatches urgency");
    }
  } else {
    if (capability.interruptLevel === "high") {
      score -= 10;
      reasons.push("High interrupt for non-urgent content");
    }
  }

  // Complexity matching
  if (analysis.complexity === "complex") {
    if (capability.supportsRichText && capability.maxLength > 5000) {
      score += 20;
      reasons.push("Supports complex content formatting");
    } else {
      score -= 20;
      reasons.push("Limited formatting for complex content");
    }
  } else if (analysis.complexity === "simple") {
    if (capability.latencyMs < 500) {
      score += 10;
      reasons.push("Fast delivery for simple content");
    }
  }

  // Content type matching
  switch (analysis.contentType) {
    case "alert":
      if (channel === "ntfy" || channel === "sms") score += 15;
      break;
    case "digest":
      if (channel === "email" || channel === "ui") score += 15;
      break;
    case "report":
      if (channel === "email" || channel === "ui") score += 20;
      if (channel === "sms") score -= 30;
      break;
  }

  // Time of day considerations (hour 0-23)
  if (timeOfDay !== undefined) {
    const isWorkHours = timeOfDay >= 9 && timeOfDay <= 17;
    const isNightHours = timeOfDay >= 22 || timeOfDay <= 6;

    if (isNightHours && capability.interruptLevel === "high") {
      score -= 20;
      reasons.push("Reducing interruptions during night hours");
    }

    if (!isWorkHours && channel === "slack") {
      score -= 10;
      reasons.push("Slack less effective outside work hours");
    }
  }

  // User preferences
  if (userPreferences && userPreferences[channel] !== undefined) {
    const prefScore = (userPreferences[channel] - 0.5) * 40; // -20 to +20
    score += prefScore;
    if (prefScore > 0) {
      reasons.push("User preference boost");
    } else if (prefScore < 0) {
      reasons.push("User preference penalty");
    }
  }

  // Cost consideration for non-critical content
  if (analysis.urgency === "low" && capability.costPerMessage > 0) {
    score -= 10;
    reasons.push("Cost consideration for low-priority content");
  }

  return { channel, score: Math.max(0, Math.min(100, score)), reasons };
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get user channel preferences
 */
export const getUserChannelPreferences = internalQuery({
  args: { userId: v.optional(v.string()) },
  handler: async (ctx, { userId }): Promise<Record<Channel, number>> => {
    // Default preferences if no user specified
    const defaults: Record<Channel, number> = {
      ntfy: 0.7,
      email: 0.6,
      slack: 0.5,
      sms: 0.3,
      ui: 0.8,
    };

    if (!userId) return defaults;

    // TODO: Fetch from user preferences table when implemented
    return defaults;
  },
});

/**
 * Get channel delivery stats
 */
export const getChannelStats = internalQuery({
  args: { channel: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, { channel, days = 7 }): Promise<{
    sent: number;
    delivered: number;
    failed: number;
    avgLatencyMs: number;
  }> => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    const jobs = await ctx.db
      .query("deliveryJobs")
      .withIndex("by_channel", (q) => q.eq("channel", channel))
      .filter((q) => q.gte(q.field("createdAt"), cutoff))
      .collect();

    const delivered = jobs.filter((j) => j.status === "delivered");
    const avgLatency =
      delivered.length > 0
        ? delivered.reduce((sum, j) => sum + (j.deliveredAt! - j.createdAt), 0) / delivered.length
        : 0;

    return {
      sent: jobs.length,
      delivered: delivered.length,
      failed: jobs.filter((j) => j.status === "failed").length,
      avgLatencyMs: Math.round(avgLatency),
    };
  },
});

/**
 * Get all channel capabilities
 */
export const getChannelCapabilities = internalQuery({
  args: {},
  handler: async (): Promise<Record<Channel, ChannelCapability>> => {
    return CHANNEL_CAPABILITIES;
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Record channel engagement event
 */
export const recordChannelEngagement = internalMutation({
  args: {
    channel: v.string(),
    messageId: v.string(),
    eventType: v.union(
      v.literal("delivered"),
      v.literal("opened"),
      v.literal("clicked"),
      v.literal("dismissed")
    ),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"engagementEvents">> => {
    return await ctx.db.insert("engagementEvents", {
      channel: args.channel as Channel,
      messageId: args.messageId,
      eventType: args.eventType,
      userId: args.userId,
      timestamp: Date.now(),
    });
  },
});

/**
 * Update user channel preference based on engagement
 */
export const updateChannelPreference = internalMutation({
  args: {
    userId: v.string(),
    channel: v.string(),
    delta: v.number(),
  },
  handler: async (ctx, { userId, channel, delta }): Promise<void> => {
    // TODO: Implement user preferences table update
    console.log(`[ChannelIntelligence] Updating ${userId} preference for ${channel}: ${delta > 0 ? "+" : ""}${delta}`);
  },
});

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Recommend optimal channel(s) for content
 */
export const recommendChannel = internalAction({
  args: {
    content: v.string(),
    metadata: v.optional(v.any()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { content, metadata, userId }): Promise<ChannelRecommendation> => {
    // Analyze content
    const analysis = analyzeContent(content, metadata);

    // Get user preferences
    const preferences = await ctx.runQuery(
      internal.domains.channels.channelIntelligence.getUserChannelPreferences,
      { userId }
    );

    // Get current hour for time-based optimization
    const currentHour = new Date().getUTCHours();

    // Score all channels
    const scores: ChannelScore[] = [];
    for (const channel of Object.keys(CHANNEL_CAPABILITIES) as Channel[]) {
      scores.push(scoreChannel(channel, analysis, preferences, currentHour));
    }

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    // Build recommendation
    const primary = scores[0].channel;
    const fallback = scores.slice(1, 3).map((s) => s.channel);

    const reasoning = `Content: ${analysis.contentType} (${analysis.urgency} urgency, ${analysis.complexity} complexity). ` +
      `Primary channel ${primary} scored ${scores[0].score}/100. ` +
      `Key factors: ${scores[0].reasons.slice(0, 2).join(", ")}.`;

    console.log(`[ChannelIntelligence] Recommendation: ${primary} (${scores[0].score}/100)`);

    return { primary, fallback, scores, reasoning };
  },
});

/**
 * Get optimal delivery time for a channel
 */
export const getOptimalDeliveryTime = internalAction({
  args: {
    channel: v.string(),
    urgency: v.string(),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, { channel, urgency, timezone = "UTC" }): Promise<{
    immediate: boolean;
    suggestedTime?: number;
    reasoning: string;
  }> => {
    // Breaking/high urgency = immediate delivery
    if (urgency === "breaking" || urgency === "high") {
      return {
        immediate: true,
        reasoning: "High urgency content requires immediate delivery",
      };
    }

    // For ntfy/sms, prefer work hours for non-urgent content
    if (channel === "ntfy" || channel === "sms") {
      const now = new Date();
      const hour = now.getUTCHours();

      // If outside 9-17 UTC, delay to 9 AM
      if (hour < 9 || hour > 17) {
        const nextMorning = new Date(now);
        nextMorning.setUTCHours(9, 0, 0, 0);
        if (hour > 17) {
          nextMorning.setUTCDate(nextMorning.getUTCDate() + 1);
        }

        return {
          immediate: false,
          suggestedTime: nextMorning.getTime(),
          reasoning: "Delaying non-urgent push notification to work hours",
        };
      }
    }

    // For email digests, batch to morning delivery
    if (channel === "email" && urgency === "low") {
      const now = new Date();
      const hour = now.getUTCHours();

      if (hour < 8) {
        const morning = new Date(now);
        morning.setUTCHours(8, 0, 0, 0);
        return {
          immediate: false,
          suggestedTime: morning.getTime(),
          reasoning: "Batching low-priority email for morning delivery",
        };
      }
    }

    return {
      immediate: true,
      reasoning: "Normal delivery timing",
    };
  },
});

/**
 * Learn from engagement patterns
 */
export const learnFromEngagement = internalAction({
  args: {
    userId: v.optional(v.string()),
    lookbackDays: v.optional(v.number()),
  },
  handler: async (ctx, { userId, lookbackDays = 30 }): Promise<{
    insights: string[];
    recommendations: Record<Channel, { score: number; trend: "up" | "down" | "stable" }>;
  }> => {
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const insights: string[] = [];
    const recommendations: Record<Channel, { score: number; trend: "up" | "down" | "stable" }> = {
      ntfy: { score: 0.5, trend: "stable" },
      email: { score: 0.5, trend: "stable" },
      slack: { score: 0.5, trend: "stable" },
      sms: { score: 0.5, trend: "stable" },
      ui: { score: 0.5, trend: "stable" },
    };

    // Get engagement events
    const events = await ctx.runQuery(
      internal.domains.channels.engagementOptimizer.getEngagementEvents,
      { userId, since: cutoff }
    );

    // Analyze by channel
    for (const channel of Object.keys(recommendations) as Channel[]) {
      const channelEvents = events.filter((e: Doc<"engagementEvents">) => e.channel === channel);
      if (channelEvents.length === 0) continue;

      const opened = channelEvents.filter((e: Doc<"engagementEvents">) => e.eventType === "opened").length;
      const clicked = channelEvents.filter((e: Doc<"engagementEvents">) => e.eventType === "clicked").length;
      const dismissed = channelEvents.filter((e: Doc<"engagementEvents">) => e.eventType === "dismissed").length;
      const total = channelEvents.length;

      // Calculate engagement score
      const engagementRate = (opened + clicked * 2) / Math.max(total, 1);
      const dismissRate = dismissed / Math.max(total, 1);

      recommendations[channel].score = Math.min(1, Math.max(0, engagementRate - dismissRate * 0.5));

      // Determine trend (compare first half vs second half of period)
      const midpoint = cutoff + (Date.now() - cutoff) / 2;
      const firstHalf = channelEvents.filter((e: Doc<"engagementEvents">) => e.timestamp < midpoint);
      const secondHalf = channelEvents.filter((e: Doc<"engagementEvents">) => e.timestamp >= midpoint);

      if (firstHalf.length > 0 && secondHalf.length > 0) {
        const firstRate = firstHalf.filter((e: Doc<"engagementEvents">) => e.eventType === "clicked").length / firstHalf.length;
        const secondRate = secondHalf.filter((e: Doc<"engagementEvents">) => e.eventType === "clicked").length / secondHalf.length;

        if (secondRate > firstRate + 0.1) {
          recommendations[channel].trend = "up";
        } else if (secondRate < firstRate - 0.1) {
          recommendations[channel].trend = "down";
        }
      }

      // Generate insights
      if (dismissRate > 0.5) {
        insights.push(`High dismiss rate on ${channel} (${(dismissRate * 100).toFixed(0)}%) - consider reducing frequency`);
      }
      if (engagementRate > 0.7) {
        insights.push(`Strong engagement on ${channel} (${(engagementRate * 100).toFixed(0)}%) - good channel choice`);
      }
    }

    return { insights, recommendations };
  },
});
