/**
 * MCP Gateway API Key Management — Convex mutations & queries
 *
 * Stores API key hashes (never raw keys) with userId, permissions,
 * rate limits, and revocation state.
 *
 * Used by the WebSocket MCP gateway (server/mcpGateway.ts) to validate
 * incoming connections and manage key lifecycle.
 */

import { v } from "convex/values";
import { mutation, query, internalQuery, internalMutation } from "../../_generated/server";

// ═══════════════════════════════════════════════════════════════════════════
// createApiKey — store a new key hash (called after server-side generation)
// ═══════════════════════════════════════════════════════════════════════════

export const createApiKey = mutation({
  args: {
    keyHash: v.string(),
    keyHashPrefix: v.string(), // first 12 chars of hash for fast lookup
    userId: v.string(),
    label: v.optional(v.string()), // human-friendly name
    permissions: v.array(v.string()),
    rateLimits: v.object({
      perMinute: v.number(),
      perDay: v.number(),
    }),
  },
  returns: v.id("mcpApiKeys"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("mcpApiKeys", {
      keyHash: args.keyHash,
      keyHashPrefix: args.keyHashPrefix,
      userId: args.userId,
      label: args.label ?? "default",
      permissions: args.permissions,
      rateLimits: args.rateLimits,
      createdAt: now,
      lastUsedAt: now,
      revokedAt: undefined,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// validateApiKey — lookup by hash prefix, return full record
// ═══════════════════════════════════════════════════════════════════════════

export const validateApiKey = internalQuery({
  args: {
    keyHashPrefix: v.string(),
  },
  returns: v.union(
    v.object({
      keyHash: v.string(),
      keyHashPrefix: v.string(),
      userId: v.string(),
      label: v.string(),
      permissions: v.array(v.string()),
      rateLimits: v.object({
        perMinute: v.number(),
        perDay: v.number(),
      }),
      createdAt: v.number(),
      lastUsedAt: v.number(),
      revokedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("mcpApiKeys")
      .withIndex("by_hash_prefix", (q) => q.eq("keyHashPrefix", args.keyHashPrefix))
      .first();

    if (!record) return null;

    return {
      keyHash: record.keyHash,
      keyHashPrefix: record.keyHashPrefix,
      userId: record.userId,
      label: record.label,
      permissions: record.permissions,
      rateLimits: record.rateLimits,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      revokedAt: record.revokedAt,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// touchApiKey — update lastUsedAt on successful auth
// ═══════════════════════════════════════════════════════════════════════════

export const touchApiKey = internalMutation({
  args: {
    keyHashPrefix: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("mcpApiKeys")
      .withIndex("by_hash_prefix", (q) => q.eq("keyHashPrefix", args.keyHashPrefix))
      .first();

    if (record) {
      await ctx.db.patch(record._id, { lastUsedAt: Date.now() });
    }
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// revokeApiKey — soft-delete by setting revokedAt timestamp
// ═══════════════════════════════════════════════════════════════════════════

export const revokeApiKey = mutation({
  args: {
    keyId: v.id("mcpApiKeys"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.keyId);
    if (!record) throw new Error("API key not found");
    if (record.revokedAt) throw new Error("API key already revoked");

    await ctx.db.patch(args.keyId, { revokedAt: Date.now() });
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// listApiKeys — list all keys for a user (for key management UI)
// ═══════════════════════════════════════════════════════════════════════════

export const listApiKeys = query({
  args: {
    userId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("mcpApiKeys"),
      keyHashPrefix: v.string(),
      label: v.string(),
      permissions: v.array(v.string()),
      rateLimits: v.object({
        perMinute: v.number(),
        perDay: v.number(),
      }),
      createdAt: v.number(),
      lastUsedAt: v.number(),
      revokedAt: v.optional(v.number()),
      isActive: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const keys = await ctx.db
      .query("mcpApiKeys")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return keys.map((k) => ({
      _id: k._id,
      keyHashPrefix: k.keyHashPrefix,
      label: k.label,
      permissions: k.permissions,
      rateLimits: k.rateLimits,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      isActive: k.revokedAt === undefined,
    }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// logGatewaySession — record session telemetry for analytics
// ═══════════════════════════════════════════════════════════════════════════

export const logGatewaySession = internalMutation({
  args: {
    sessionId: v.string(),
    userId: v.string(),
    connectedAt: v.number(),
    disconnectedAt: v.number(),
    durationMs: v.number(),
    toolCallCount: v.number(),
    totalToolLatencyMs: v.number(),
    errorCount: v.number(),
    disconnectReason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("mcpGatewaySessions", {
      sessionId: args.sessionId,
      userId: args.userId,
      connectedAt: args.connectedAt,
      disconnectedAt: args.disconnectedAt,
      durationMs: args.durationMs,
      toolCallCount: args.toolCallCount,
      totalToolLatencyMs: args.totalToolLatencyMs,
      errorCount: args.errorCount,
      disconnectReason: args.disconnectReason,
    });
    return null;
  },
});
