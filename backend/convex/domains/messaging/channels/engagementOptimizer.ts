/**
 * Engagement Optimizer - User Engagement Learning & Optimization
 * Deep Agents 3.0 - Learns from user behavior to optimize content delivery
 *
 * Features:
 * - Engagement event tracking
 * - User preference learning
 * - Content relevance scoring
 * - Delivery frequency optimization
 * - A/B testing support
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, query } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { ENGAGEMENT_CONFIG } from "../../../config/autonomousConfig";
import type { Doc, Id } from "../../../_generated/dataModel";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface EngagementMetrics {
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  dismissRate: number;
  responseTime: number | null;
}

export interface UserEngagementProfile {
  userId: string;
  preferredChannels: string[];
  preferredTimes: number[];
  topicInterests: Record<string, number>;
  engagementScore: number;
  lastActive: number;
}

export interface ContentPerformance {
  contentId: string;
  contentType: string;
  metrics: EngagementMetrics;
  bestChannel: string;
  bestTimeSlot: number;
}

export interface FrequencyRecommendation {
  channel: string;
  currentFrequency: number;
  recommendedFrequency: number;
  reasoning: string;
}

/* ================================================================== */
/* QUERIES                                                             */
/* ================================================================== */

/**
 * Get engagement events for analysis
 */
export const getEngagementEvents = internalQuery({
  args: {
    userId: v.optional(v.string()),
    channel: v.optional(v.string()),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { userId, channel, since, limit = 1000 }): Promise<Doc<"engagementEvents">[]> => {
    let query = ctx.db.query("engagementEvents");

    if (channel) {
      query = query.withIndex("by_channel", (q) => q.eq("channel", channel));
    }

    let results = await query.order("desc").take(limit);

    // Filter by user if specified
    if (userId) {
      results = results.filter((e) => e.userId === userId);
    }

    // Filter by time if specified
    if (since) {
      results = results.filter((e) => e.timestamp >= since);
    }

    return results;
  },
});

/**
 * Get engagement metrics for a channel
 */
export const getChannelEngagementMetrics = internalQuery({
  args: {
    channel: v.string(),
    days: v.optional(v.number()),
  },
  handler: async (ctx, { channel, days = 7 }): Promise<EngagementMetrics> => {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const events = await ctx.db
      .query("engagementEvents")
      .withIndex("by_channel", (q) => q.eq("channel", channel))
      .filter((q) => q.gte(q.field("timestamp"), since))
      .collect();

    const delivered = events.filter((e) => e.eventType === "delivered").length;
    const opened = events.filter((e) => e.eventType === "opened").length;
    const clicked = events.filter((e) => e.eventType === "clicked").length;
    const dismissed = events.filter((e) => e.eventType === "dismissed").length;

    // Calculate response times for opened events
    const openedEvents = events.filter((e) => e.eventType === "opened" && e.responseTimeMs);
    const avgResponseTime =
      openedEvents.length > 0
        ? openedEvents.reduce((sum, e) => sum + (e.responseTimeMs || 0), 0) / openedEvents.length
        : null;

    return {
      deliveryRate: delivered > 0 ? 1.0 : 0,
      openRate: delivered > 0 ? opened / delivered : 0,
      clickRate: opened > 0 ? clicked / opened : 0,
      dismissRate: delivered > 0 ? dismissed / delivered : 0,
      responseTime: avgResponseTime,
    };
  },
});

/**
 * Get user engagement profile
 */
export const getUserEngagementProfile = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<UserEngagementProfile | null> => {
    const events = await ctx.db
      .query("engagementEvents")
      .filter((q) => q.eq(q.field("userId"), userId))
      .order("desc")
      .take(500);

    if (events.length === 0) {
      return null;
    }

    // Analyze channel preferences
    const channelCounts: Record<string, { total: number; clicked: number }> = {};
    const hourCounts: Record<number, number> = {};
    const topicScores: Record<string, number> = {};

    for (const event of events) {
      // Channel analysis
      if (!channelCounts[event.channel]) {
        channelCounts[event.channel] = { total: 0, clicked: 0 };
      }
      channelCounts[event.channel].total++;
      if (event.eventType === "clicked") {
        channelCounts[event.channel].clicked++;
      }

      // Time analysis
      const hour = new Date(event.timestamp).getUTCHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;

      // Topic analysis (if available)
      if (event.metadata?.topic) {
        const topic = event.metadata.topic as string;
        topicScores[topic] = (topicScores[topic] || 0) + (event.eventType === "clicked" ? 2 : 1);
      }
    }

    // Determine preferred channels (by click rate)
    const preferredChannels = Object.entries(channelCounts)
      .map(([channel, data]) => ({
        channel,
        rate: data.total > 0 ? data.clicked / data.total : 0,
      }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 3)
      .map((c) => c.channel);

    // Determine preferred times (top 3 hours)
    const preferredTimes = Object.entries(hourCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([hour]) => parseInt(hour));

    // Normalize topic scores
    const maxTopicScore = Math.max(...Object.values(topicScores), 1);
    const normalizedTopics: Record<string, number> = {};
    for (const [topic, score] of Object.entries(topicScores)) {
      normalizedTopics[topic] = score / maxTopicScore;
    }

    // Calculate overall engagement score
    const totalEvents = events.length;
    const clickEvents = events.filter((e) => e.eventType === "clicked").length;
    const dismissEvents = events.filter((e) => e.eventType === "dismissed").length;
    const engagementScore = (clickEvents * 2 - dismissEvents) / Math.max(totalEvents, 1);

    return {
      userId,
      preferredChannels,
      preferredTimes,
      topicInterests: normalizedTopics,
      engagementScore: Math.max(0, Math.min(1, 0.5 + engagementScore)),
      lastActive: events[0].timestamp,
    };
  },
});

/**
 * Get top performing content
 */
export const getTopPerformingContent = internalQuery({
  args: { limit: v.optional(v.number()), days: v.optional(v.number()) },
  handler: async (ctx, { limit = 10, days = 30 }): Promise<ContentPerformance[]> => {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const events = await ctx.db
      .query("engagementEvents")
      .filter((q) => q.gte(q.field("timestamp"), since))
      .collect();

    // Group by messageId
    const contentMetrics: Record<string, {
      clicks: number;
      opens: number;
      dismisses: number;
      delivered: number;
      channels: Record<string, number>;
      hours: Record<number, number>;
      contentType?: string;
    }> = {};

    for (const event of events) {
      if (!contentMetrics[event.messageId]) {
        contentMetrics[event.messageId] = {
          clicks: 0,
          opens: 0,
          dismisses: 0,
          delivered: 0,
          channels: {},
          hours: {},
          contentType: event.metadata?.contentType as string | undefined,
        };
      }

      const m = contentMetrics[event.messageId];
      switch (event.eventType) {
        case "delivered":
          m.delivered++;
          break;
        case "opened":
          m.opens++;
          break;
        case "clicked":
          m.clicks++;
          m.channels[event.channel] = (m.channels[event.channel] || 0) + 1;
          const hour = new Date(event.timestamp).getUTCHours();
          m.hours[hour] = (m.hours[hour] || 0) + 1;
          break;
        case "dismissed":
          m.dismisses++;
          break;
      }
    }

    // Calculate performance and sort
    const performances: ContentPerformance[] = Object.entries(contentMetrics)
      .map(([contentId, m]) => {
        const bestChannel = Object.entries(m.channels)
          .sort(([, a], [, b]) => b - a)[0]?.[0] || "unknown";
        const bestTimeSlot = Object.entries(m.hours)
          .sort(([, a], [, b]) => b - a)[0]?.[0] || "12";

        return {
          contentId,
          contentType: m.contentType || "unknown",
          metrics: {
            deliveryRate: 1.0,
            openRate: m.delivered > 0 ? m.opens / m.delivered : 0,
            clickRate: m.opens > 0 ? m.clicks / m.opens : 0,
            dismissRate: m.delivered > 0 ? m.dismisses / m.delivered : 0,
            responseTime: null,
          },
          bestChannel,
          bestTimeSlot: parseInt(bestTimeSlot),
        };
      })
      .sort((a, b) => b.metrics.clickRate - a.metrics.clickRate)
      .slice(0, limit);

    return performances;
  },
});

/**
 * Public query for engagement dashboard
 */
export const getEngagementDashboard = query({
  args: {},
  handler: async (ctx): Promise<{
    totalEvents: number;
    byChannel: Record<string, EngagementMetrics>;
    topContent: ContentPerformance[];
    recentTrend: "up" | "down" | "stable";
  }> => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;

    const recentEvents = await ctx.db
      .query("engagementEvents")
      .filter((q) => q.gte(q.field("timestamp"), sevenDaysAgo))
      .collect();

    const previousEvents = await ctx.db
      .query("engagementEvents")
      .filter((q) =>
        q.and(
          q.gte(q.field("timestamp"), fourteenDaysAgo),
          q.lt(q.field("timestamp"), sevenDaysAgo)
        )
      )
      .collect();

    // Calculate by channel
    const byChannel: Record<string, EngagementMetrics> = {};
    const channels = [...new Set(recentEvents.map((e) => e.channel))];

    for (const channel of channels) {
      const channelEvents = recentEvents.filter((e) => e.channel === channel);
      const delivered = channelEvents.filter((e) => e.eventType === "delivered").length;
      const opened = channelEvents.filter((e) => e.eventType === "opened").length;
      const clicked = channelEvents.filter((e) => e.eventType === "clicked").length;
      const dismissed = channelEvents.filter((e) => e.eventType === "dismissed").length;

      byChannel[channel] = {
        deliveryRate: delivered > 0 ? 1.0 : 0,
        openRate: delivered > 0 ? opened / delivered : 0,
        clickRate: opened > 0 ? clicked / opened : 0,
        dismissRate: delivered > 0 ? dismissed / delivered : 0,
        responseTime: null,
      };
    }

    // Determine trend
    const recentClicks = recentEvents.filter((e) => e.eventType === "clicked").length;
    const previousClicks = previousEvents.filter((e) => e.eventType === "clicked").length;

    let recentTrend: "up" | "down" | "stable" = "stable";
    if (recentClicks > previousClicks * 1.1) {
      recentTrend = "up";
    } else if (recentClicks < previousClicks * 0.9) {
      recentTrend = "down";
    }

    return {
      totalEvents: recentEvents.length,
      byChannel,
      topContent: [], // Simplified for public query
      recentTrend,
    };
  },
});

/* ================================================================== */
/* MUTATIONS                                                           */
/* ================================================================== */

/**
 * Record engagement event with full metadata
 */
export const recordEngagementEvent = internalMutation({
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
    responseTimeMs: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"engagementEvents">> => {
    return await ctx.db.insert("engagementEvents", {
      channel: args.channel,
      messageId: args.messageId,
      eventType: args.eventType,
      userId: args.userId,
      responseTimeMs: args.responseTimeMs,
      metadata: args.metadata,
      timestamp: Date.now(),
    });
  },
});

/**
 * Batch record engagement events
 */
export const batchRecordEngagement = internalMutation({
  args: {
    events: v.array(
      v.object({
        channel: v.string(),
        messageId: v.string(),
        eventType: v.string(),
        userId: v.optional(v.string()),
        timestamp: v.number(),
      })
    ),
  },
  handler: async (ctx, { events }): Promise<number> => {
    let recorded = 0;

    for (const event of events) {
      await ctx.db.insert("engagementEvents", {
        channel: event.channel,
        messageId: event.messageId,
        eventType: event.eventType as "delivered" | "opened" | "clicked" | "dismissed",
        userId: event.userId,
        timestamp: event.timestamp,
      });
      recorded++;
    }

    return recorded;
  },
});

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Analyze and recommend delivery frequency
 */
export const analyzeDeliveryFrequency = internalAction({
  args: {
    channel: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { channel, userId }): Promise<FrequencyRecommendation> => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const events = await ctx.runQuery(
      internal.domains.channels.engagementOptimizer.getEngagementEvents,
      { channel, userId, since: thirtyDaysAgo }
    );

    // Calculate current frequency (messages per day)
    const deliveredEvents = events.filter((e: Doc<"engagementEvents">) => e.eventType === "delivered");
    const currentFrequency = deliveredEvents.length / 30;

    // Calculate engagement metrics
    const dismissRate = events.filter((e: Doc<"engagementEvents">) => e.eventType === "dismissed").length / Math.max(events.length, 1);
    const clickRate = events.filter((e: Doc<"engagementEvents">) => e.eventType === "clicked").length / Math.max(events.length, 1);

    // Determine recommended frequency
    let recommendedFrequency = currentFrequency;
    let reasoning = "Current frequency is optimal";

    if (dismissRate > ENGAGEMENT_CONFIG.dismissThreshold) {
      recommendedFrequency = Math.max(0.5, currentFrequency * 0.7);
      reasoning = `High dismiss rate (${(dismissRate * 100).toFixed(0)}%) suggests reducing frequency`;
    } else if (clickRate > 0.5 && dismissRate < 0.1) {
      recommendedFrequency = Math.min(currentFrequency * 1.2, ENGAGEMENT_CONFIG.maxDailyMessages);
      reasoning = `Strong engagement (${(clickRate * 100).toFixed(0)}% click rate) supports increased frequency`;
    } else if (deliveredEvents.length < 10) {
      reasoning = "Insufficient data for reliable recommendation";
    }

    return {
      channel,
      currentFrequency,
      recommendedFrequency,
      reasoning,
    };
  },
});

/**
 * Get personalized content score
 */
export const scoreContentForUser = internalAction({
  args: {
    userId: v.string(),
    contentType: v.string(),
    topics: v.array(v.string()),
  },
  handler: async (ctx, { userId, contentType, topics }): Promise<{
    relevanceScore: number;
    factors: string[];
  }> => {
    const profile = await ctx.runQuery(
      internal.domains.channels.engagementOptimizer.getUserEngagementProfile,
      { userId }
    );

    if (!profile) {
      return {
        relevanceScore: 0.5,
        factors: ["No user profile available, using default score"],
      };
    }

    let score = 0.5;
    const factors: string[] = [];

    // Topic interest matching
    let topicMatch = 0;
    for (const topic of topics) {
      if (profile.topicInterests[topic]) {
        topicMatch = Math.max(topicMatch, profile.topicInterests[topic]);
      }
    }
    if (topicMatch > 0.5) {
      score += 0.2;
      factors.push(`High topic interest (${(topicMatch * 100).toFixed(0)}%)`);
    } else if (topicMatch > 0) {
      score += 0.1;
      factors.push(`Some topic interest (${(topicMatch * 100).toFixed(0)}%)`);
    }

    // User engagement level
    if (profile.engagementScore > 0.7) {
      score += 0.1;
      factors.push("Active user");
    } else if (profile.engagementScore < 0.3) {
      score -= 0.1;
      factors.push("Low engagement user");
    }

    // Recent activity
    const daysSinceActive = (Date.now() - profile.lastActive) / (24 * 60 * 60 * 1000);
    if (daysSinceActive > 7) {
      score -= 0.1;
      factors.push(`Inactive for ${Math.round(daysSinceActive)} days`);
    }

    return {
      relevanceScore: Math.max(0, Math.min(1, score)),
      factors,
    };
  },
});

/**
 * Generate engagement report
 */
export const generateEngagementReport = internalAction({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days = 7 }): Promise<{
    summary: string;
    metrics: Record<string, EngagementMetrics>;
    recommendations: string[];
    topPerformers: string[];
  }> => {
    const channels = ["ntfy", "email", "slack", "sms", "ui"];
    const metrics: Record<string, EngagementMetrics> = {};
    const recommendations: string[] = [];

    for (const channel of channels) {
      metrics[channel] = await ctx.runQuery(
        internal.domains.channels.engagementOptimizer.getChannelEngagementMetrics,
        { channel, days }
      );

      // Generate recommendations based on metrics
      if (metrics[channel].dismissRate > 0.3) {
        recommendations.push(`Reduce ${channel} frequency - ${(metrics[channel].dismissRate * 100).toFixed(0)}% dismiss rate`);
      }
      if (metrics[channel].openRate < 0.2 && metrics[channel].deliveryRate > 0) {
        recommendations.push(`Improve ${channel} subject lines - only ${(metrics[channel].openRate * 100).toFixed(0)}% open rate`);
      }
      if (metrics[channel].clickRate > 0.5) {
        recommendations.push(`${channel} performing well - consider increasing volume`);
      }
    }

    // Get top performers
    const topContent = await ctx.runQuery(
      internal.domains.channels.engagementOptimizer.getTopPerformingContent,
      { limit: 5, days }
    );
    const topPerformers = topContent.map(
      (c: ContentPerformance) => `${c.contentId}: ${(c.metrics.clickRate * 100).toFixed(0)}% click rate via ${c.bestChannel}`
    );

    // Generate summary
    const totalDelivered = Object.values(metrics).reduce(
      (sum, m) => sum + (m.deliveryRate > 0 ? 1 : 0),
      0
    );
    const avgOpenRate = Object.values(metrics).reduce((sum, m) => sum + m.openRate, 0) / channels.length;
    const avgClickRate = Object.values(metrics).reduce((sum, m) => sum + m.clickRate, 0) / channels.length;

    const summary = `${days}-day engagement report: ${totalDelivered} channels active, ${(avgOpenRate * 100).toFixed(0)}% avg open rate, ${(avgClickRate * 100).toFixed(0)}% avg click rate`;

    console.log(`[EngagementOptimizer] ${summary}`);

    return { summary, metrics, recommendations, topPerformers };
  },
});
