/**
 * Admin Audit Logging
 *
 * Tracks all administrative actions for compliance and debugging.
 * Records who did what, when, and why with before/after state.
 *
 * Created: 2026-01-22 (P0 - Critical for compliance)
 */

import { v } from "convex/values";
import { mutation, query, internalMutation } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../../_generated/dataModel";

/**
 * Utility to safely get user ID from auth context
 */
async function getSafeUserId(ctx: any): Promise<Id<"users"> | null> {
  try {
    const rawUserId = await getAuthUserId(ctx);
    if (!rawUserId) return null;

    // Handle malformed user IDs with pipe characters
    let userId: Id<"users">;
    if (typeof rawUserId === "string" && rawUserId.includes("|")) {
      const userIdPart = rawUserId.split("|")[0];
      if (!userIdPart || userIdPart.length < 10) return null;
      userId = userIdPart as Id<"users">;
    } else {
      userId = rawUserId as Id<"users">;
    }

    // Verify user exists
    const user = await ctx.db.get(userId);
    if (!user) return null;

    return userId;
  } catch {
    return null;
  }
}

/**
 * Log an admin action
 *
 * @param action - The action type (e.g., "delete_google_account", "update_user_role")
 * @param actionCategory - Category of the action (user_management, config_change, etc.)
 * @param resourceType - The type of resource affected (e.g., "googleAccounts", "users")
 * @param resourceId - The ID of the affected resource
 * @param before - State before the action (for updates/deletes)
 * @param after - State after the action (for updates/creates)
 * @param reason - Why the action was performed
 * @param ticket - Related ticket/issue number
 */
export const logAdminAction = mutation({
  args: {
    action: v.string(),
    actionCategory: v.union(
      v.literal("user_management"),
      v.literal("config_change"),
      v.literal("data_correction"),
      v.literal("permission_change"),
      v.literal("deletion"),
      v.literal("access_grant"),
      v.literal("security_event")
    ),
    resourceType: v.string(),
    resourceId: v.optional(v.string()),
    before: v.optional(v.any()),
    after: v.any(),
    reason: v.optional(v.string()),
    ticket: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const adminUserId = await getSafeUserId(ctx);
    if (!adminUserId) {
      throw new Error("Not authenticated");
    }

    const auditId = await ctx.db.insert("adminAuditLog", {
      action: args.action,
      actionCategory: args.actionCategory,
      actor: adminUserId,
      actorRole: undefined, // Could be fetched from user profile
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      before: args.before,
      after: args.after,
      reason: args.reason,
      ticket: args.ticket,
      ipAddress: undefined, // Not available in Convex context
      userAgent: undefined, // Not available in Convex context
      metadata: args.metadata,
      timestamp: Date.now(),
    });

    console.log(
      `[AdminAudit] User ${adminUserId} performed ${args.action} on ${args.resourceType}${
        args.resourceId ? ` (${args.resourceId})` : ""
      }`
    );

    return { success: true, auditId };
  },
});

/**
 * Internal mutation for logging admin actions from internal contexts
 * (where auth context may not be available)
 */
export const logAdminActionInternal = internalMutation({
  args: {
    action: v.string(),
    actionCategory: v.union(
      v.literal("user_management"),
      v.literal("config_change"),
      v.literal("data_correction"),
      v.literal("permission_change"),
      v.literal("deletion"),
      v.literal("access_grant"),
      v.literal("security_event")
    ),
    actor: v.id("users"),
    resourceType: v.string(),
    resourceId: v.optional(v.string()),
    before: v.optional(v.any()),
    after: v.any(),
    reason: v.optional(v.string()),
    ticket: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const auditId = await ctx.db.insert("adminAuditLog", {
      action: args.action,
      actionCategory: args.actionCategory,
      actor: args.actor,
      actorRole: undefined,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      before: args.before,
      after: args.after,
      reason: args.reason,
      ticket: args.ticket,
      ipAddress: undefined,
      userAgent: undefined,
      metadata: args.metadata,
      timestamp: Date.now(),
    });

    console.log(
      `[AdminAudit] ${args.actor} performed ${args.action} on ${args.resourceType}`
    );

    return { success: true, auditId };
  },
});

/**
 * Get audit log entries with filters
 */
export const getAuditLog = query({
  args: {
    action: v.optional(v.string()),
    actionCategory: v.optional(v.union(
      v.literal("user_management"),
      v.literal("config_change"),
      v.literal("data_correction"),
      v.literal("permission_change"),
      v.literal("deletion"),
      v.literal("access_grant"),
      v.literal("security_event")
    )),
    resourceType: v.optional(v.string()),
    actor: v.optional(v.id("users")),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    let logs = await ctx.db.query("adminAuditLog").order("desc").take(limit * 5); // Over-fetch for filtering

    // Filter by action
    if (args.action) {
      logs = logs.filter((log) => log.action === args.action);
    }

    // Filter by action category
    if (args.actionCategory) {
      logs = logs.filter((log) => log.actionCategory === args.actionCategory);
    }

    // Filter by resource type
    if (args.resourceType) {
      logs = logs.filter((log) => log.resourceType === args.resourceType);
    }

    // Filter by actor
    if (args.actor) {
      logs = logs.filter((log) => log.actor === args.actor);
    }

    // Filter by date range
    if (args.startDate || args.endDate) {
      logs = logs.filter((log) => {
        if (args.startDate && log.timestamp < args.startDate) return false;
        if (args.endDate && log.timestamp > args.endDate) return false;
        return true;
      });
    }

    // Limit results
    logs = logs.slice(0, limit);

    // Enrich with user information
    const enrichedLogs = await Promise.all(
      logs.map(async (log) => {
        const user = await ctx.db.get(log.actor);
        const actorInfo = user ? {
          name: user.name,
          email: user.email,
        } : { name: "Unknown", email: null };

        return {
          ...log,
          actorInfo,
        };
      })
    );

    return enrichedLogs;
  },
});

/**
 * Get audit statistics
 */
export const getAuditStats = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let logs = await ctx.db.query("adminAuditLog").collect();

    // Filter by date range
    if (args.startDate || args.endDate) {
      logs = logs.filter((log) => {
        if (args.startDate && log.timestamp < args.startDate) return false;
        if (args.endDate && log.timestamp > args.endDate) return false;
        return true;
      });
    }

    // Count by action type
    const actionCounts = new Map<string, number>();
    for (const log of logs) {
      const count = actionCounts.get(log.action) || 0;
      actionCounts.set(log.action, count + 1);
    }

    // Count by resource type
    const resourceCounts = new Map<string, number>();
    for (const log of logs) {
      const count = resourceCounts.get(log.resourceType) || 0;
      resourceCounts.set(log.resourceType, count + 1);
    }

    // Count by actor
    const actorCounts = new Map<string, number>();
    for (const log of logs) {
      const actor = log.actor.toString();
      const count = actorCounts.get(actor) || 0;
      actorCounts.set(actor, count + 1);
    }

    // Count by action category
    const categoryCounts = new Map<string, number>();
    for (const log of logs) {
      const count = categoryCounts.get(log.actionCategory) || 0;
      categoryCounts.set(log.actionCategory, count + 1);
    }

    const topActions = Array.from(actionCounts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topResources = Array.from(resourceCounts.entries())
      .map(([resourceType, count]) => ({ resourceType, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topActors = Array.from(actorCounts.entries())
      .map(([actor, count]) => ({ actor, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topCategories = Array.from(categoryCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    return {
      total: logs.length,
      topActions,
      topResources,
      topActors,
      topCategories,
      dateRange: {
        start: args.startDate || (logs.length > 0 ? logs[logs.length - 1].timestamp : null),
        end: args.endDate || (logs.length > 0 ? logs[0].timestamp : null),
      },
    };
  },
});

/**
 * Get audit log for a specific resource
 */
export const getResourceAuditHistory = query({
  args: {
    resourceType: v.string(),
    resourceId: v.string(),
  },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("adminAuditLog")
      .filter((q) =>
        q.and(
          q.eq(q.field("resourceType"), args.resourceType),
          q.eq(q.field("resourceId"), args.resourceId)
        )
      )
      .order("desc")
      .collect();

    // Enrich with user information
    const enrichedLogs = await Promise.all(
      logs.map(async (log) => {
        const user = await ctx.db.get(log.actor);
        const actorInfo = user ? {
          name: user.name,
          email: user.email,
        } : { name: "Unknown", email: null };

        return {
          ...log,
          actorInfo,
        };
      })
    );

    return enrichedLogs;
  },
});
