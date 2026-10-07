/**
 * Proactive System Mutations
 * Core mutations for creating custom detectors, updating settings, etc.
 */

import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";

/**
 * Create a custom detector (Premium feature)
 */
export const createCustomDetector = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    triggerType: v.union(
      v.literal("event"),
      v.literal("schedule"),
      v.literal("threshold")
    ),
    eventTrigger: v.optional(
      v.object({
        eventType: v.string(),
        keywords: v.optional(v.array(v.string())),
        entityFilter: v.optional(
          v.object({
            entityType: v.string(),
            scope: v.union(
              v.literal("watchlist"),
              v.literal("all"),
              v.literal("specific_ids")
            ),
            entityIds: v.optional(v.array(v.string())),
          })
        ),
        sourcesFilter: v.optional(v.array(v.string())),
      })
    ),
    scheduleTrigger: v.optional(
      v.object({
        cronExpression: v.string(),
        timezone: v.string(),
      })
    ),
    thresholdTrigger: v.optional(
      v.object({
        metric: v.string(),
        operator: v.union(v.literal("gt"), v.literal("lt"), v.literal("eq")),
        value: v.number(),
        checkInterval: v.string(),
      })
    ),
    conditions: v.optional(
      v.array(
        v.object({
          field: v.string(),
          operator: v.string(),
          value: v.any(),
        })
      )
    ),
    actions: v.array(
      v.object({
        actionType: v.string(),
        config: v.any(),
        template: v.optional(v.string()),
      })
    ),
    rateLimit: v.optional(
      v.object({
        maxPerDay: v.optional(v.number()),
        maxPerWeek: v.optional(v.number()),
        deduplicateWindow: v.optional(v.number()),
      })
    ),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    respectQuietHours: v.boolean(),
    deduplicate: v.boolean(),
    status: v.union(v.literal("draft"), v.literal("active")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // TODO: Check if user has paid subscription
    // For now, allow all users to create custom detectors

    // Generate detector ID
    const detectorId = `custom_${user._id}_${Date.now()}`;

    // Create detector
    const id = await ctx.db.insert("customDetectors", {
      userId: user._id,
      detectorId,
      name: args.name,
      description: args.description,
      icon: args.icon,
      triggerType: args.triggerType,
      eventTrigger: args.eventTrigger,
      scheduleTrigger: args.scheduleTrigger,
      thresholdTrigger: args.thresholdTrigger,
      conditions: args.conditions,
      actions: args.actions,
      rateLimit: args.rateLimit,
      priority: args.priority,
      respectQuietHours: args.respectQuietHours,
      deduplicate: args.deduplicate,
      status: args.status,
      triggerCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Log persona change
    await ctx.runMutation(internal.domains.operations.personaChangeTracking.logPersonaChangeInternal, {
      personaId: user._id,
      personaType: "hook",
      fieldChanged: "customDetector",
      previousValue: null,
      newValue: {
        detectorId,
        name: args.name,
        triggerType: args.triggerType,
        status: args.status,
        priority: args.priority,
      },
      changeType: "create",
      actor: user._id,
      actorType: "user",
      reason: `Created custom detector: ${args.name}`,
      metadata: {
        detectorId,
        triggerType: args.triggerType,
        actionsCount: args.actions.length,
      },
    }).catch((err) => {
      console.warn('[createCustomDetector] Failed to log persona change:', err);
    });

    return detectorId;
  },
});

/**
 * Update a custom detector
 */
export const updateCustomDetector = mutation({
  args: {
    detectorId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    triggerType: v.optional(
      v.union(
        v.literal("event"),
        v.literal("schedule"),
        v.literal("threshold")
      )
    ),
    eventTrigger: v.optional(v.any()),
    scheduleTrigger: v.optional(v.any()),
    thresholdTrigger: v.optional(v.any()),
    conditions: v.optional(v.any()),
    actions: v.optional(v.any()),
    rateLimit: v.optional(v.any()),
    priority: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high"))
    ),
    respectQuietHours: v.optional(v.boolean()),
    deduplicate: v.optional(v.boolean()),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("active"),
        v.literal("paused"),
        v.literal("error")
      )
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // Find detector
    const detector = await ctx.db
      .query("customDetectors")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("detectorId"), args.detectorId))
      .first();

    if (!detector) {
      throw new Error("Detector not found");
    }

    // Capture before state
    const beforeState = {
      name: detector.name,
      triggerType: detector.triggerType,
      status: detector.status,
      priority: detector.priority,
    };

    // Update detector
    const updates: any = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.icon !== undefined) updates.icon = args.icon;
    if (args.triggerType !== undefined) updates.triggerType = args.triggerType;
    if (args.eventTrigger !== undefined) updates.eventTrigger = args.eventTrigger;
    if (args.scheduleTrigger !== undefined) updates.scheduleTrigger = args.scheduleTrigger;
    if (args.thresholdTrigger !== undefined) updates.thresholdTrigger = args.thresholdTrigger;
    if (args.conditions !== undefined) updates.conditions = args.conditions;
    if (args.actions !== undefined) updates.actions = args.actions;
    if (args.rateLimit !== undefined) updates.rateLimit = args.rateLimit;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.respectQuietHours !== undefined) updates.respectQuietHours = args.respectQuietHours;
    if (args.deduplicate !== undefined) updates.deduplicate = args.deduplicate;
    if (args.status !== undefined) updates.status = args.status;

    await ctx.db.patch(detector._id, updates);

    // Log persona change
    await ctx.runMutation(internal.domains.operations.personaChangeTracking.logPersonaChangeInternal, {
      personaId: user._id,
      personaType: "hook",
      fieldChanged: "customDetector",
      previousValue: beforeState,
      newValue: updates,
      changeType: "update",
      actor: user._id,
      actorType: "user",
      reason: `Updated custom detector: ${detector.name}`,
      metadata: {
        detectorId: args.detectorId,
        changedFields: Object.keys(updates).filter(k => k !== 'updatedAt'),
      },
    }).catch((err) => {
      console.warn('[updateCustomDetector] Failed to log persona change:', err);
    });

    return { success: true };
  },
});

/**
 * Delete a custom detector
 */
export const deleteCustomDetector = mutation({
  args: {
    detectorId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // Find detector
    const detector = await ctx.db
      .query("customDetectors")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("detectorId"), args.detectorId))
      .first();

    if (!detector) {
      throw new Error("Detector not found");
    }

    // Capture state before deletion
    const beforeState = {
      detectorId: detector.detectorId,
      name: detector.name,
      triggerType: detector.triggerType,
      status: detector.status,
      priority: detector.priority,
      triggerCount: detector.triggerCount,
    };

    await ctx.db.delete(detector._id);

    // Log persona change
    await ctx.runMutation(internal.domains.operations.personaChangeTracking.logPersonaChangeInternal, {
      personaId: user._id,
      personaType: "hook",
      fieldChanged: "customDetector",
      previousValue: beforeState,
      newValue: { deleted: true },
      changeType: "delete",
      actor: user._id,
      actorType: "user",
      reason: `Deleted custom detector: ${detector.name}`,
      metadata: {
        detectorId: args.detectorId,
        triggerCount: detector.triggerCount,
      },
    }).catch((err) => {
      console.warn('[deleteCustomDetector] Failed to log persona change:', err);
    });

    return { success: true };
  },
});

/**
 * Test a custom detector against historical events
 */
export const testCustomDetector = mutation({
  args: v.any(), // Same structure as createCustomDetector
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // Get last 7 days of events
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const events = await ctx.db
      .query("proactiveEvents")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", sevenDaysAgo))
      .collect();

    // TODO: Implement actual detector matching logic
    // For now, return mock results

    const matchCount = Math.floor(Math.random() * 10);
    const sampleMatches = events.slice(0, matchCount).map((event) => ({
      eventId: event.eventId,
      timestamp: event.timestamp,
      eventType: event.eventType,
      summary: event.summary || "Event summary",
      matched: true,
    }));

    return {
      matchCount,
      sampleMatches,
      periodDays: 7,
      totalEventsScanned: events.length,
    };
  },
});

/**
 * Update user proactive settings
 */
export const updateProactiveSettings = mutation({
  args: {
    enabledDetectors: v.optional(v.array(v.string())),
    quietHoursStart: v.optional(v.number()),
    quietHoursEnd: v.optional(v.number()),
    timezone: v.optional(v.string()),
    notificationChannels: v.optional(
      v.object({
        inApp: v.boolean(),
        slack: v.boolean(),
        email: v.boolean(),
      })
    ),
    minimumConfidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // Find or create settings
    const existingSettings = await ctx.db
      .query("userProactiveSettings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    // Capture before state for tracking
    const beforeState = existingSettings ? {
      enabledDetectors: existingSettings.enabledDetectors,
      quietHoursStart: existingSettings.quietHoursStart,
      quietHoursEnd: existingSettings.quietHoursEnd,
      timezone: existingSettings.timezone,
      notificationChannels: existingSettings.notificationChannels,
      minimumConfidence: existingSettings.minimumConfidence,
    } : null;

    const updates: any = {
      userId: user._id,
      updatedAt: Date.now(),
    };

    if (args.enabledDetectors !== undefined) updates.enabledDetectors = args.enabledDetectors;
    if (args.quietHoursStart !== undefined) updates.quietHoursStart = args.quietHoursStart;
    if (args.quietHoursEnd !== undefined) updates.quietHoursEnd = args.quietHoursEnd;
    if (args.timezone !== undefined) updates.timezone = args.timezone;
    if (args.notificationChannels !== undefined) updates.notificationChannels = args.notificationChannels;
    if (args.minimumConfidence !== undefined) updates.minimumConfidence = args.minimumConfidence;

    if (existingSettings) {
      await ctx.db.patch(existingSettings._id, updates);
    } else {
      await ctx.db.insert("userProactiveSettings", {
        ...updates,
        enabledDetectors: args.enabledDetectors || [],
        quietHoursStart: args.quietHoursStart,
        quietHoursEnd: args.quietHoursEnd,
        timezone: args.timezone || "America/Los_Angeles",
        notificationChannels: args.notificationChannels || {
          inApp: true,
          slack: false,
          email: false,
        },
        minimumConfidence: args.minimumConfidence || 0.7,
        createdAt: Date.now(),
      });
    }

    // Log persona change
    await ctx.runMutation(internal.domains.operations.personaChangeTracking.logPersonaChangeInternal, {
      personaId: user._id,
      personaType: "setting",
      fieldChanged: "proactiveSettings",
      previousValue: beforeState,
      newValue: args,
      changeType: existingSettings ? "update" : "create",
      actor: user._id,
      actorType: "user",
      reason: "User updated proactive detection settings",
      metadata: {
        source: "proactive_settings_ui",
        changedFields: Object.keys(args),
        detectorsCount: args.enabledDetectors?.length,
      },
    }).catch((err) => {
      console.warn('[updateProactiveSettings] Failed to log persona change:', err);
    });

    return { success: true };
  },
});
