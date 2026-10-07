/**
 * Consent Mutations
 * Handle user consent for proactive features
 */

import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";

/**
 * Grant consent for proactive features
 */
export const grantConsent = mutation({
  args: {
    consentType: v.literal("proactive_features"),
    version: v.string(), // Terms version (e.g., "1.0")
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
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

    // Check if consent already exists
    const existingConsent = await ctx.db
      .query("userConsents")
      .withIndex("by_user_type", (q) =>
        q.eq("userId", user._id).eq("consentType", args.consentType)
      )
      .first();

    const wasGranted = existingConsent?.granted || false;

    if (existingConsent) {
      // Update existing consent
      await ctx.db.patch(existingConsent._id, {
        granted: true,
        grantedAt: Date.now(),
        revokedAt: undefined,
        version: args.version,
        ipAddress: args.ipAddress,
        userAgent: args.userAgent,
      });

      // Log persona change
      await ctx.runMutation(internal.domains.operations.personaChangeTracking.logPersonaChangeInternal, {
        personaId: user._id,
        personaType: "budget",
        fieldChanged: "proactiveConsent",
        previousValue: { granted: wasGranted, version: existingConsent.version },
        newValue: { granted: true, version: args.version },
        changeType: "update",
        actor: user._id,
        actorType: "user",
        reason: "User granted proactive features consent",
        metadata: { consentType: args.consentType, ipAddress: args.ipAddress },
      }).catch((err) => {
        console.warn('[grantConsent] Failed to log persona change:', err);
      });

      return {
        success: true,
        consentId: existingConsent._id,
        action: "updated",
      };
    } else {
      // Create new consent record
      const consentId = await ctx.db.insert("userConsents", {
        userId: user._id,
        consentType: args.consentType,
        granted: true,
        grantedAt: Date.now(),
        version: args.version,
        ipAddress: args.ipAddress,
        userAgent: args.userAgent,
      });

      // Log persona change
      await ctx.runMutation(internal.domains.operations.personaChangeTracking.logPersonaChangeInternal, {
        personaId: user._id,
        personaType: "budget",
        fieldChanged: "proactiveConsent",
        previousValue: null,
        newValue: { granted: true, version: args.version },
        changeType: "create",
        actor: user._id,
        actorType: "user",
        reason: "User granted proactive features consent",
        metadata: { consentType: args.consentType, ipAddress: args.ipAddress },
      }).catch((err) => {
        console.warn('[grantConsent] Failed to log persona change:', err);
      });

      return {
        success: true,
        consentId,
        action: "created",
      };
    }
  },
});

/**
 * Revoke consent for proactive features
 */
export const revokeConsent = mutation({
  args: {
    consentType: v.literal("proactive_features"),
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

    // Find consent record
    const consent = await ctx.db
      .query("userConsents")
      .withIndex("by_user_type", (q) =>
        q.eq("userId", user._id).eq("consentType", args.consentType)
      )
      .first();

    if (!consent) {
      throw new Error("Consent record not found");
    }

    // Capture state before revocation
    const beforeState = {
      granted: consent.granted,
      version: consent.version,
      grantedAt: consent.grantedAt,
    };

    // Revoke consent
    await ctx.db.patch(consent._id, {
      granted: false,
      revokedAt: Date.now(),
    });

    // Disable all proactive settings
    const settings = await ctx.db
      .query("userProactiveSettings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    let disabledDetectorsCount = 0;

    if (settings) {
      disabledDetectorsCount = settings.enabledDetectors?.length || 0;
      await ctx.db.patch(settings._id, {
        enabledDetectors: [],
        updatedAt: Date.now(),
      });
    }

    // Disable all custom detectors
    const customDetectors = await ctx.db
      .query("customDetectors")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    for (const detector of customDetectors) {
      await ctx.db.patch(detector._id, {
        status: "paused",
        updatedAt: Date.now(),
      });
    }

    // Log persona change
    await ctx.runMutation(internal.domains.operations.personaChangeTracking.logPersonaChangeInternal, {
      personaId: user._id,
      personaType: "budget",
      fieldChanged: "proactiveConsent",
      previousValue: beforeState,
      newValue: { granted: false, revokedAt: Date.now() },
      changeType: "update",
      actor: user._id,
      actorType: "user",
      reason: "User revoked proactive features consent",
      metadata: {
        consentType: args.consentType,
        disabledDetectorsCount,
        disabledCustomDetectorsCount: customDetectors.length,
      },
    }).catch((err) => {
      console.warn('[revokeConsent] Failed to log persona change:', err);
    });

    return {
      success: true,
      message: "Consent revoked. All proactive features have been disabled.",
    };
  },
});

/**
 * Check if user has granted consent
 */
export const checkConsent = mutation({
  args: {
    consentType: v.literal("proactive_features"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { hasConsent: false };
    }

    const user = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("email"), identity.email))
      .first();

    if (!user) {
      return { hasConsent: false };
    }

    const consent = await ctx.db
      .query("userConsents")
      .withIndex("by_user_type", (q) =>
        q.eq("userId", user._id).eq("consentType", args.consentType)
      )
      .first();

    if (!consent || !consent.granted) {
      return { hasConsent: false };
    }

    return {
      hasConsent: true,
      grantedAt: consent.grantedAt,
      version: consent.version,
    };
  },
});
