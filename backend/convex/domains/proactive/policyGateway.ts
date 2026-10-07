/**
 * Policy Gateway
 * Central decision point for opportunity delivery
 *
 * Responsibilities:
 * - Risk assessment and approval flow
 * - Tier enforcement (free vs paid limits)
 * - Quiet hours enforcement
 * - Rate limiting and deduplication
 * - Confidence threshold filtering
 * - Usage tracking and quota management
 *
 * Decision flow:
 * 1. Check if user has reached quota
 * 2. Check risk level → require approval if high
 * 3. Check quiet hours
 * 4. Check confidence threshold
 * 5. Check rate limits
 * 6. Approve or reject
 */

import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { Id } from "../../_generated/dataModel";

export interface PolicyDecision {
  approved: boolean;
  reason?: string;
  requiresApproval?: boolean; // High-risk actions need user approval
  actionMode: "suggest" | "draft" | "execute";
  deliveryChannels: Array<"inApp" | "slack" | "email">;
  priority: "low" | "medium" | "high";
}

/**
 * Evaluate opportunity against policies
 */
export const evaluateOpportunity = internalMutation({
  args: {
    opportunityId: v.id("opportunities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<PolicyDecision> => {
    // Get opportunity
    const opportunity = await ctx.db.get(args.opportunityId);
    if (!opportunity) {
      return {
        approved: false,
        reason: "Opportunity not found",
        actionMode: "suggest",
        deliveryChannels: [],
        priority: "low",
      };
    }

    // Get user settings
    const settings = await ctx.db
      .query("userProactiveSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (!settings) {
      return {
        approved: false,
        reason: "User has no proactive settings",
        actionMode: "suggest",
        deliveryChannels: [],
        priority: "low",
      };
    }

    // Get user subscription (for tier enforcement)
    const subscription = await ctx.db
      .query("proactiveSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const tier = subscription?.tier || "free";

    // 1. Check quota (free tier: 50/month, paid: unlimited)
    if (tier === "free") {
      const currentMonth = new Date().toISOString().slice(0, 7); // "2026-01"
      const usage = await ctx.db
        .query("usageTracking")
        .withIndex("by_user_month", (q) =>
          q.eq("userId", args.userId).eq("month", currentMonth)
        )
        .first();

      if (usage && usage.proactiveNotifications >= 50) {
        return {
          approved: false,
          reason: "Monthly quota exceeded (50 notifications/month for free tier)",
          actionMode: "suggest",
          deliveryChannels: [],
          priority: "low",
        };
      }
    }

    // 2. Check confidence threshold
    const confidence = opportunity.impactEstimate?.confidenceLevel || 0;
    if (confidence < settings.minimumConfidence) {
      return {
        approved: false,
        reason: `Confidence ${(confidence * 100).toFixed(0)}% below threshold ${(
          settings.minimumConfidence * 100
        ).toFixed(0)}%`,
        actionMode: "suggest",
        deliveryChannels: [],
        priority: "low",
      };
    }

    // 3. Check quiet hours
    const now = new Date();
    const currentHour = now.getHours();
    const quietStart = settings.quietHoursStart;
    const quietEnd = settings.quietHoursEnd;

    if (quietStart !== undefined && quietEnd !== undefined) {
      const isQuietHours =
        quietStart < quietEnd
          ? currentHour >= quietStart && currentHour < quietEnd
          : currentHour >= quietStart || currentHour < quietEnd;

      if (isQuietHours) {
        return {
          approved: false,
          reason: "Quiet hours active",
          actionMode: "suggest",
          deliveryChannels: [],
          priority: "low",
        };
      }
    }

    // 4. Determine action mode based on risk level
    let actionMode: "suggest" | "draft" | "execute" = "suggest";
    let requiresApproval = false;

    switch (opportunity.riskLevel) {
      case "low":
        actionMode = "draft"; // Low risk can auto-draft
        break;
      case "medium":
        actionMode = "draft";
        requiresApproval = true; // Medium risk needs approval before execution
        break;
      case "high":
        actionMode = "suggest"; // High risk only suggests
        requiresApproval = true;
        break;
    }

    // 5. Determine delivery channels
    const deliveryChannels: Array<"inApp" | "slack" | "email"> = [];
    if (settings.notificationChannels.inApp) {
      deliveryChannels.push("inApp");
    }
    if (settings.notificationChannels.slack) {
      deliveryChannels.push("slack");
    }
    if (settings.notificationChannels.email) {
      deliveryChannels.push("email");
    }

    // Default to in-app if no channels enabled
    if (deliveryChannels.length === 0) {
      deliveryChannels.push("inApp");
    }

    // 6. Determine priority
    const priority =
      opportunity.riskLevel === "high"
        ? "high"
        : confidence > 0.8
        ? "high"
        : "medium";

    // 7. Check rate limits (detector-specific)
    // TODO: Implement rate limiting per detector

    // 8. Update opportunity status
    await ctx.db.patch(args.opportunityId, {
      status: requiresApproval ? "evaluating" : "approved",
      updatedAt: Date.now(),
    });

    // 9. Track usage
    await trackUsage(ctx, args.userId);

    return {
      approved: true,
      requiresApproval,
      actionMode,
      deliveryChannels,
      priority,
    };
  },
});

/**
 * Track usage for quota management
 */
async function trackUsage(ctx: any, userId: Id<"users">) {
  const currentMonth = new Date().toISOString().slice(0, 7); // "2026-01"

  const existing = await ctx.db
    .query("usageTracking")
    .withIndex("by_user_month", (q) =>
      q.eq("userId", userId).eq("month", currentMonth)
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      proactiveNotifications: existing.proactiveNotifications + 1,
    });
  } else {
    await ctx.db.insert("usageTracking", {
      userId,
      month: currentMonth,
      proactiveNotifications: 1,
      customDetectorsUsed: 0,
      apiCallsMade: 0,
      lastResetAt: Date.now(),
    });
  }
}

/**
 * Batch evaluate multiple opportunities
 */
export const batchEvaluateOpportunities = internalMutation({
  args: {
    opportunityIds: v.array(v.id("opportunities")),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const decisions: Array<{
      opportunityId: Id<"opportunities">;
      decision: PolicyDecision;
    }> = [];

    for (const oppId of args.opportunityIds) {
      const decision = await evaluateOpportunity(ctx, {
        opportunityId: oppId,
        userId: args.userId,
      });
      decisions.push({ opportunityId: oppId, decision });
    }

    return decisions;
  },
});

/**
 * Check if user has exceeded quota
 */
export const checkQuota = internalMutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("proactiveSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const tier = subscription?.tier || "free";

    if (tier !== "free") {
      return {
        hasQuota: true,
        tier,
        used: 0,
        limit: -1, // Unlimited
      };
    }

    // Check free tier quota (50/month)
    const currentMonth = new Date().toISOString().slice(0, 7);
    const usage = await ctx.db
      .query("usageTracking")
      .withIndex("by_user_month", (q) =>
        q.eq("userId", args.userId).eq("month", currentMonth)
      )
      .first();

    const used = usage?.proactiveNotifications || 0;
    const limit = 50;

    return {
      hasQuota: used < limit,
      tier,
      used,
      limit,
      remaining: limit - used,
    };
  },
});
