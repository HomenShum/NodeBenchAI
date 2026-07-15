/**
 * publicShares — anonymous read-only share links for diligence resources.
 *
 * Contract:
 *   - Owner calls `mintPublicShare({ resourceType: "entity", resourceSlug, label? })`
 *     → returns { token }. They copy https://app/share/{token} and send it.
 *   - Visitor hits /share/{token} → client calls `getPublicShareContext`
 *     with no auth → returns either the resource descriptor or an honest
 *     status (`expired` | `revoked` | `not_found`).
 *   - Visitor then calls `getPublicEntityProjections({ token })` to read
 *     the payload — the token itself is the bearer credential.
 *
 * Role (agentic_reliability.md):
 *   - BOUND: listMine caps at 100; public reads cap projection rows at 20.
 *   - HONEST_STATUS: `not_found` / `expired` / `revoked` are all distinct
 *     so the UI can render different empty states. We never silently 200.
 *   - DETERMINISTIC: token is the dedupe key via by_token index.
 *   - SSRF: not applicable (no URL from user input).
 *   - user_privacy.md: the mint step requires auth (owner identity), and
 *     the owner sets expiresAt explicitly; we never auto-mint.
 *
 * Token: 32 bytes → 43-char URL-safe base64. Cryptographically random via
 * Web Crypto API available in Convex's V8 runtime.
 */

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "../../_generated/server";

const MAX_SHARES_PER_OWNER_PAGE = 100;
const MAX_PUBLIC_PROJECTIONS = 20;
const TOKEN_BYTES = 32;

const RESOURCE_TYPE_VALIDATOR = v.union(
  v.literal("entity"),
  // future: v.literal("memo"), v.literal("founder_profile"), v.literal("market_thesis"),
);

function generateToken(): string {
  const buf = new Uint8Array(TOKEN_BYTES);
  // Convex V8 supplies Web Crypto.
  crypto.getRandomValues(buf);
  // URL-safe base64 without padding (RFC 4648 §5).
  let bin = "";
  for (const byte of buf) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function requireOwnerKeys(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
}): Promise<{ ownerKey: string; legacyOwnerKey: string }> {
  const userId = await getAuthUserId(
    ctx as unknown as Parameters<typeof getAuthUserId>[0],
  );
  if (!userId) throw new Error("not authenticated");
  const legacyOwnerKey = String(userId);
  return {
    ownerKey: `user:${legacyOwnerKey}`,
    legacyOwnerKey,
  };
}

/* ==========================================================================
 * mintPublicShare — create a bearer token for a resource the caller owns.
 * ========================================================================== */
export const mintPublicShare = mutation({
  args: {
    resourceType: RESOURCE_TYPE_VALIDATOR,
    resourceSlug: v.string(),
    /** Optional human-set label to help the owner identify this share later. */
    label: v.optional(v.string()),
    /**
     * Optional expiry — ms since epoch. We recommend 7-30 days for investor
     * shares so tokens don't leak forever.
     */
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { ownerKey } = await requireOwnerKeys(ctx);

    if (args.resourceSlug.trim().length === 0) {
      throw new Error("mintPublicShare: resourceSlug required");
    }
    if (args.expiresAt !== undefined && args.expiresAt <= Date.now()) {
      throw new Error("mintPublicShare: expiresAt must be in the future");
    }

    // Public bearer shares are owner-only. Workspace members use the scoped
    // workspace-share flow and cannot mint a public token for someone else's
    // entity.
    if (args.resourceType === "entity") {
      const entity = await ctx.db
        .query("productEntities")
        .withIndex("by_owner_slug", (q) =>
          q.eq("ownerKey", ownerKey).eq("slug", args.resourceSlug),
        )
        .first();
      if (!entity) throw new Error("mintPublicShare: entity not found");
    }

    // Retry-on-collision up to 3 times — the token space is 2^256 so
    // collision is astronomical, but the loop costs nothing.
    let token = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = generateToken();
      const existing = await ctx.db
        .query("publicShares")
        .withIndex("by_token", (q) => q.eq("token", candidate))
        .first();
      if (!existing) {
        token = candidate;
        break;
      }
    }
    if (!token)
      throw new Error("mintPublicShare: unable to allocate unique token");

    const trimmedLabel =
      typeof args.label === "string" && args.label.trim().length > 0
        ? args.label.trim().slice(0, 120)
        : undefined;

    const id = await ctx.db.insert("publicShares", {
      token,
      resourceType: args.resourceType,
      resourceSlug: args.resourceSlug,
      ownerKey,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
      viewCount: 0,
      label: trimmedLabel,
    });
    return { id, token };
  },
});

/* ==========================================================================
 * revokePublicShare — soft delete; token immediately stops working.
 * ========================================================================== */
export const revokePublicShare = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { ownerKey, legacyOwnerKey } = await requireOwnerKeys(ctx);
    const row = await ctx.db
      .query("publicShares")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row) throw new Error("revokePublicShare: token not found");
    if (row.ownerKey !== ownerKey && row.ownerKey !== legacyOwnerKey) {
      throw new Error("revokePublicShare: not the share owner");
    }
    await ctx.db.patch(row._id, { revokedAt: Date.now() });
    return { status: "revoked" as const };
  },
});

/* ==========================================================================
 * listMyShares — owner dashboard.
 * ========================================================================== */
export const listMyShares = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { ownerKey, legacyOwnerKey } = await requireOwnerKeys(ctx);
    const limit = Math.max(
      1,
      Math.min(
        args.limit ?? MAX_SHARES_PER_OWNER_PAGE,
        MAX_SHARES_PER_OWNER_PAGE,
      ),
    );
    const [currentRows, legacyRows] = await Promise.all([
      ctx.db
        .query("publicShares")
        .withIndex("by_owner", (q) => q.eq("ownerKey", ownerKey))
        .order("desc")
        .take(limit),
      ctx.db
        .query("publicShares")
        .withIndex("by_owner", (q) => q.eq("ownerKey", legacyOwnerKey))
        .order("desc")
        .take(limit),
    ]);
    return [...currentRows, ...legacyRows]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);
  },
});

/* ==========================================================================
 * getPublicShareContext — PUBLIC (no auth). Entry point for /share/{token}.
 * HONEST_STATUS: four distinct outcomes so the UI renders cleanly.
 * ========================================================================== */
export const getPublicShareContext = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("publicShares")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row) return { status: "not_found" as const };
    if (row.revokedAt !== undefined) {
      return { status: "revoked" as const };
    }
    if (row.expiresAt !== undefined && row.expiresAt < Date.now()) {
      return { status: "expired" as const };
    }
    // Minimal descriptor — we do NOT return ownerKey, lastViewedAt, etc.
    return {
      status: "active" as const,
      resourceType: row.resourceType,
      resourceSlug: row.resourceSlug,
      label: row.label,
      createdAt: row.createdAt,
    };
  },
});

/* ==========================================================================
 * getPublicEntityProjections — PUBLIC projection read scoped to a valid token.
 * Returns the same shape as diligenceProjections.listForEntity but bypasses
 * owner-scoped checks because the bearer token IS the auth.
 * ========================================================================== */
export const getPublicEntityProjections = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Re-validate the token on every read — tokens can be revoked between
    // context fetch and projection fetch.
    const row = await ctx.db
      .query("publicShares")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (
      !row ||
      row.revokedAt !== undefined ||
      (row.expiresAt !== undefined && row.expiresAt < Date.now())
    ) {
      return { status: "inactive" as const, projections: [] };
    }
    if (row.resourceType !== "entity") {
      return { status: "unsupported_type" as const, projections: [] };
    }

    const cap = Math.max(1, Math.min(args.limit ?? 10, MAX_PUBLIC_PROJECTIONS));
    const entity = await ctx.db
      .query("productEntities")
      .withIndex("by_owner_slug", (q) =>
        q.eq("ownerKey", row.ownerKey).eq("slug", row.resourceSlug),
      )
      .first();
    if (!entity) {
      return { status: "inactive" as const, projections: [] };
    }

    const projectionRows = await ctx.db
      .query("diligenceProjections")
      .withIndex("by_owner_entity_updated", (q) =>
        q.eq("ownerKey", row.ownerKey).eq("entityId", entity._id),
      )
      .order("desc")
      .take(MAX_PUBLIC_PROJECTIONS);
    const projections = projectionRows
      .filter(
        (projection) =>
          (projection.producerAssurance === "internal_structuring_v1" ||
            projection.producerAssurance === "internal_canonical_v1") &&
          projection.entitySlug === row.resourceSlug,
      )
      .slice(0, cap)
      .map((projection) => ({
        entitySlug: projection.entitySlug,
        blockType: projection.blockType,
        scratchpadRunId: projection.scratchpadRunId,
        version: projection.version,
        overallTier: projection.overallTier,
        headerText: projection.headerText,
        bodyProse: projection.bodyProse,
        sourceRefIds: projection.sourceRefIds,
        sourceCount: projection.sourceCount,
        sourceLabel: projection.sourceLabel,
        sourceTokens: projection.sourceTokens,
        payload: projection.payload,
        sourceSectionId: projection.sourceSectionId,
        updatedAt: projection.updatedAt,
      }));

    return {
      status: "active" as const,
      resourceSlug: row.resourceSlug,
      label: row.label,
      projections,
    };
  },
});

/* ==========================================================================
 * recordPublicView — public mutation that bumps viewCount + lastViewedAt.
 * Called once per /share/{token} page load. Not throttled at the DB layer
 * because total viewCount is a nice-to-have, not a billing trigger.
 * ========================================================================== */
export const recordPublicView = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("publicShares")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (
      !row ||
      row.revokedAt !== undefined ||
      (row.expiresAt !== undefined && row.expiresAt < Date.now())
    ) {
      return { status: "inactive" as const };
    }
    await ctx.db.patch(row._id, {
      viewCount: row.viewCount + 1,
      lastViewedAt: Date.now(),
    });
    return { status: "recorded" as const };
  },
});
