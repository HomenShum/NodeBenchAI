/**
 * WebMCP Origin Manager — Convex CRUD for approved WebMCP origins.
 *
 * Manages the allowlist of WebMCP-enabled sites that NodeBench can connect to.
 * Origin approval → tool discovery → tool inventory cache → invocation audit.
 */

import { v } from "convex/values";
import { query, mutation, internalMutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * List all approved WebMCP origins (used by settings panel + bridge tools).
 */
export const listApprovedOrigins = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("webmcpOrigins")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .order("desc")
      .collect();
  },
});

/**
 * Get all tool inventory entries for a specific origin.
 */
export const getOriginTools = query({
  args: { originId: v.id("webmcpOrigins") },
  handler: async (ctx, { originId }) => {
    return ctx.db
      .query("webmcpToolInventory")
      .withIndex("by_origin", (q) => q.eq("originId", originId))
      .collect();
  },
});

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Approve a new WebMCP origin (creates with "approved" status).
 */
export const approveOrigin = mutation({
  args: {
    origin: v.string(),
    label: v.string(),
    userId: v.optional(v.string()),
    allowedToolPatterns: v.optional(v.array(v.string())),
    blockedToolPatterns: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { origin, label, userId, allowedToolPatterns, blockedToolPatterns }) => {
    // Check if origin already exists
    const existing = await ctx.db
      .query("webmcpOrigins")
      .withIndex("by_origin", (q) => q.eq("origin", origin))
      .first();

    if (existing) {
      // Re-approve if revoked, otherwise return existing
      if (existing.status === "revoked") {
        await ctx.db.patch(existing._id, {
          status: "approved",
          approvedBy: userId,
          approvedAt: Date.now(),
          revokedAt: undefined,
          label,
          allowedToolPatterns,
          blockedToolPatterns,
        });
        return { _id: existing._id, reactivated: true };
      }
      return { _id: existing._id, alreadyApproved: true };
    }

    const id = await ctx.db.insert("webmcpOrigins", {
      origin,
      label,
      status: "approved",
      approvedBy: userId,
      approvedAt: Date.now(),
      allowedToolPatterns,
      blockedToolPatterns,
      createdAt: Date.now(),
    });

    return { _id: id };
  },
});

/**
 * Revoke an approved origin (soft delete — sets status to "revoked").
 */
export const revokeOrigin = mutation({
  args: {
    originId: v.id("webmcpOrigins"),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, { originId }) => {
    const origin = await ctx.db.get(originId);
    if (!origin) throw new Error(`Origin ${originId} not found`);

    await ctx.db.patch(originId, {
      status: "revoked",
      revokedAt: Date.now(),
    });

    return { revoked: true, origin: origin.origin };
  },
});

// ── Internal Mutations (called by gateway, not exposed to client) ────────────

/**
 * Update tool inventory cache after a scan/connect operation.
 * Upserts: inserts new tools, updates existing ones, removes stale ones.
 */
export const updateOriginToolCache = internalMutation({
  args: {
    originId: v.id("webmcpOrigins"),
    tools: v.array(
      v.object({
        toolName: v.string(),
        description: v.string(),
        inputSchema: v.optional(v.any()),
        annotations: v.optional(v.any()),
        riskTier: v.string(),
      })
    ),
  },
  handler: async (ctx, { originId, tools }) => {
    // Get existing tools for this origin
    const existing = await ctx.db
      .query("webmcpToolInventory")
      .withIndex("by_origin", (q) => q.eq("originId", originId))
      .collect();

    const existingByName = new Map(existing.map((t) => [t.toolName, t]));
    const now = Date.now();

    // Upsert new/updated tools
    for (const tool of tools) {
      const ex = existingByName.get(tool.toolName);
      if (ex) {
        await ctx.db.patch(ex._id, {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          riskTier: tool.riskTier,
          discoveredAt: now,
        });
        existingByName.delete(tool.toolName);
      } else {
        await ctx.db.insert("webmcpToolInventory", {
          originId,
          toolName: tool.toolName,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          allowed: true,
          riskTier: tool.riskTier,
          discoveredAt: now,
        });
      }
    }

    // Remove stale tools no longer discovered
    for (const [, stale] of existingByName) {
      await ctx.db.delete(stale._id);
    }

    // Update origin metadata
    await ctx.db.patch(originId, {
      lastDiscoveredAt: now,
      discoveredToolCount: tools.length,
    });

    return { upserted: tools.length, removed: existingByName.size };
  },
});
