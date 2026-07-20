/**
 * MCP Token-Based Authorization
 *
 * Implements scoped API token authentication for MCP server:
 * - Token generation with configurable scopes
 * - Scope-based permission checking
 * - Rate limiting (per-minute and per-day)
 * - Access logging and audit trail
 * - Token revocation and expiration
 *
 * Scopes:
 * - read:artifacts - Read source artifacts
 * - read:evaluations - Read evaluation results
 * - read:groundtruth - Read ground truth data
 * - write:evaluations - Create/update evaluations
 * - write:corrections - Submit HITL corrections
 * - admin:groundtruth - Manage ground truth versions
 */

import { internalQuery, internalMutation, mutation, query, action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";

/**
 * Available scopes for MCP API tokens
 */
export const VALID_SCOPES = [
  "read:artifacts",
  "read:evaluations",
  "read:groundtruth",
  "write:evaluations",
  "write:corrections",
  "admin:groundtruth",
] as const;

export type MCPScope = typeof VALID_SCOPES[number];

/**
 * Generate a new MCP API token
 */
export const generateToken = mutation({
  args: {
    name: v.string(),
    userId: v.id("users"),
    scopes: v.array(v.string()),
    rateLimitPerMinute: v.optional(v.number()),
    rateLimitPerDay: v.optional(v.number()),
    expiresInDays: v.optional(v.number()),
  },
  returns: v.object({
    token: v.string(),
    tokenId: v.id("mcpApiTokens"),
  }),
  handler: async (ctx, args) => {
    // Validate scopes
    for (const scope of args.scopes) {
      if (!VALID_SCOPES.includes(scope as MCPScope)) {
        throw new Error(`Invalid scope: ${scope}`);
      }
    }

    // Generate random token
    const token = `mcp_${generateRandomToken()}`;
    const tokenHash = await hashToken(token);

    // Calculate expiration
    const expiresAt = args.expiresInDays
      ? Date.now() + args.expiresInDays * 24 * 60 * 60 * 1000
      : undefined;

    // Create token record
    const tokenId = await ctx.db.insert("mcpApiTokens", {
      tokenHash,
      name: args.name,
      userId: args.userId,
      scopes: args.scopes,
      rateLimitPerMinute: args.rateLimitPerMinute || 60,
      rateLimitPerDay: args.rateLimitPerDay || 10000,
      expiresAt,
      lastUsedAt: undefined,
      isRevoked: false,
      createdAt: Date.now(),
    });

    // Return token (only shown once!)
    return {
      token,
      tokenId,
    };
  },
});

/**
 * Validate a token and check scope
 */
export const validateToken = internalQuery({
  args: {
    tokenHash: v.string(),
    requiredScope: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      tokenId: v.id("mcpApiTokens"),
      userId: v.id("users"),
      scopes: v.array(v.string()),
      isValid: v.boolean(),
      reason: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    // Find token by hash
    const token = await ctx.db
      .query("mcpApiTokens")
      .withIndex("by_token_hash", q => q.eq("tokenHash", args.tokenHash))
      .first();

    if (!token) {
      return null;
    }

    // Check if revoked
    if (token.isRevoked) {
      return {
        tokenId: token._id,
        userId: token.userId,
        scopes: token.scopes,
        isValid: false,
        reason: "Token has been revoked",
      };
    }

    // Check expiration
    if (token.expiresAt && Date.now() > token.expiresAt) {
      return {
        tokenId: token._id,
        userId: token.userId,
        scopes: token.scopes,
        isValid: false,
        reason: "Token has expired",
      };
    }

    // Check scope if required
    if (args.requiredScope && !token.scopes.includes(args.requiredScope)) {
      return {
        tokenId: token._id,
        userId: token.userId,
        scopes: token.scopes,
        isValid: false,
        reason: `Missing required scope: ${args.requiredScope}`,
      };
    }

    return {
      tokenId: token._id,
      userId: token.userId,
      scopes: token.scopes,
      isValid: true,
    };
  },
});

/**
 * Check rate limit for a token
 */
export const checkRateLimit = internalQuery({
  args: {
    tokenId: v.id("mcpApiTokens"),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    retryAfterMs: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const token = await ctx.db.get(args.tokenId);
    if (!token) {
      return { allowed: false, reason: "Token not found" };
    }

    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    // Count requests in last minute
    const recentRequests = await ctx.db
      .query("mcpAccessLog")
      .withIndex("by_token", q =>
        q.eq("tokenId", args.tokenId).gte("createdAt", oneMinuteAgo)
      )
      .collect();

    if (recentRequests.length >= token.rateLimitPerMinute) {
      const oldestRequest = recentRequests[0];
      const retryAfterMs = oldestRequest.createdAt + 60 * 1000 - now;
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${token.rateLimitPerMinute} requests per minute`,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    // Count requests in last day
    const dailyRequests = await ctx.db
      .query("mcpAccessLog")
      .withIndex("by_token", q =>
        q.eq("tokenId", args.tokenId).gte("createdAt", oneDayAgo)
      )
      .collect();

    if (dailyRequests.length >= token.rateLimitPerDay) {
      const oldestRequest = dailyRequests[0];
      const retryAfterMs = oldestRequest.createdAt + 24 * 60 * 60 * 1000 - now;
      return {
        allowed: false,
        reason: `Daily limit exceeded: ${token.rateLimitPerDay} requests per day`,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    return { allowed: true };
  },
});

/**
 * Log API access
 */
export const logAccess = internalMutation({
  args: {
    tokenId: v.id("mcpApiTokens"),
    userId: v.id("users"),
    method: v.string(),
    resource: v.string(),
    scope: v.string(),
    statusCode: v.number(),
    latencyMs: v.number(),
  },
  returns: v.id("mcpAccessLog"),
  handler: async (ctx, args) => {
    // Update token last used
    await ctx.db.patch(args.tokenId, {
      lastUsedAt: Date.now(),
    });

    // Log access
    const logId = await ctx.db.insert("mcpAccessLog", {
      tokenId: args.tokenId,
      userId: args.userId,
      method: args.method,
      resource: args.resource,
      scope: args.scope,
      statusCode: args.statusCode,
      latencyMs: args.latencyMs,
      createdAt: Date.now(),
    });

    return logId;
  },
});

/**
 * Revoke a token
 */
export const revokeToken = mutation({
  args: {
    tokenId: v.id("mcpApiTokens"),
    userId: v.id("users"), // Must be token owner or admin
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const token = await ctx.db.get(args.tokenId);
    if (!token) {
      throw new Error("Token not found");
    }

    // Check ownership (simplified - in production would check admin status)
    if (token.userId !== args.userId) {
      throw new Error("Unauthorized: You can only revoke your own tokens");
    }

    await ctx.db.patch(args.tokenId, {
      isRevoked: true,
    });

    return { success: true };
  },
});

/**
 * List tokens for a user
 */
export const listTokens = query({
  args: {
    userId: v.id("users"),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const tokens = await ctx.db
      .query("mcpApiTokens")
      .withIndex("by_user", q => q.eq("userId", args.userId).eq("isRevoked", false))
      .collect();

    // Don't return token hashes
    return tokens.map(t => ({
      _id: t._id,
      name: t.name,
      scopes: t.scopes,
      rateLimitPerMinute: t.rateLimitPerMinute,
      rateLimitPerDay: t.rateLimitPerDay,
      expiresAt: t.expiresAt,
      lastUsedAt: t.lastUsedAt,
      createdAt: t.createdAt,
    }));
  },
});

/**
 * Get access logs for a token
 */
export const getAccessLogs = query({
  args: {
    tokenId: v.id("mcpApiTokens"),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("mcpAccessLog")
      .withIndex("by_token", q => q.eq("tokenId", args.tokenId))
      .order("desc");

    if (args.limit) {
      query = query.take(args.limit) as any;
    } else {
      query = query.take(100) as any;
    }

    return await query.collect();
  },
});

/**
 * Get access logs for a user
 */
export const getUserAccessLogs = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("mcpAccessLog")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .order("desc");

    if (args.limit) {
      query = query.take(args.limit) as any;
    } else {
      query = query.take(100) as any;
    }

    return await query.collect();
  },
});

/**
 * Authorization middleware for HTTP endpoints
 */
export async function requireMCPAuth(
  ctx: any,
  authHeader: string | null,
  requiredScope?: MCPScope
): Promise<
  | { success: true; tokenId: any; userId: any; scopes: string[] }
  | { success: false; error: string; statusCode: number }
> {
  // Extract token from Bearer header
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      success: false,
      error: "Missing or invalid Authorization header",
      statusCode: 401,
    };
  }

  const token = authHeader.substring(7);
  const tokenHash = await hashToken(token);

  // Validate token
  const validation = await ctx.runQuery(internal.domains.mcp.mcpAuth.validateToken, {
    tokenHash,
    requiredScope,
  });

  if (!validation) {
    return {
      success: false,
      error: "Invalid token",
      statusCode: 401,
    };
  }

  if (!validation.isValid) {
    return {
      success: false,
      error: validation.reason || "Token validation failed",
      statusCode: 403,
    };
  }

  // Check rate limit
  const rateLimit = await ctx.runQuery(internal.domains.mcp.mcpAuth.checkRateLimit, {
    tokenId: validation.tokenId,
  });

  if (!rateLimit.allowed) {
    return {
      success: false,
      error: rateLimit.reason || "Rate limit exceeded",
      statusCode: 429,
    };
  }

  return {
    success: true,
    tokenId: validation.tokenId,
    userId: validation.userId,
    scopes: validation.scopes,
  };
}

/**
 * Helper: Hash token for storage
 * Uses Web Crypto API (available in Convex V8 runtime)
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Helper: Generate random token
 * Uses Web Crypto API (available in Convex V8 runtime)
 */
function generateRandomToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}
