import { v } from "convex/values";

import type { Doc } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";
import { mutation, query } from "../../../_generated/server";
import { requireAuthenticatedProductIdentity } from "../../product/helpers";
import { digestCanonical } from "./hash";
import {
  AUTONOMY_LIMITS,
  AUTONOMY_AGENT_ID,
  AUTONOMY_AGENT_LABEL,
  AUTONOMY_RUNTIME,
  AUTONOMY_CAPABILITY_ENVELOPE,
  AUTONOMY_OPERATION,
  AUTONOMY_RESTRICTED_OPERATIONS,
  AutonomyPolicyError,
  assertValidGrantRequest,
  effectiveGrantStatus,
  type AutonomyGrantStatus,
} from "./policy";
import {
  AUTONOMY_POLICY_VERSION,
  autonomyGrantModeValidator,
} from "./schema";

type ReadCtx = Pick<QueryCtx, "db">;

function boundedText(
  value: string,
  field: string,
  maxLength: number,
): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AutonomyPolicyError(
      `${field}_invalid`,
      `${field} must contain 1-${maxLength} characters.`,
    );
  }
  return normalized;
}

function optionalBoundedText(
  value: string | undefined,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return boundedText(value, field, maxLength);
}

export async function findOwnedGrantByPublicId(
  ctx: ReadCtx,
  ownerKey: string,
  grantId: string,
): Promise<Doc<"autonomyGrants"> | null> {
  const row = await ctx.db
    .query("autonomyGrants")
    .withIndex("by_grant_id", (q) => q.eq("grantId", grantId))
    .unique();
  return row?.ownerKey === ownerKey ? row : null;
}

async function requireOwnedGrant(
  ctx: MutationCtx,
  grantId: string,
): Promise<{ grant: Doc<"autonomyGrants">; ownerKey: string }> {
  const identity = await requireAuthenticatedProductIdentity(ctx);
  const grant = await findOwnedGrantByPublicId(ctx, identity.ownerKey, grantId);
  if (!grant) {
    throw new AutonomyPolicyError("grant_not_found", "Authority grant not found.");
  }
  return { grant, ownerKey: identity.ownerKey };
}

export const createGrant = mutation({
  args: {
    creationKey: v.string(),
    mode: autonomyGrantModeValidator,
    entityId: v.optional(v.id("productEntities")),
    runId: v.optional(v.id("agentScratchpads")),
    blockIds: v.optional(v.array(v.id("productBlocks"))),
    maxOperations: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const now = Date.now();
    const creationKey = boundedText(
      args.creationKey,
      "creation_key",
      AUTONOMY_LIMITS.maxKeyLength,
    );
    const agentId = AUTONOMY_AGENT_ID;
    const agentLabel = AUTONOMY_AGENT_LABEL;
    const runtime = AUTONOMY_RUNTIME;
    const runId = args.runId;
    const blockIds = args.blockIds ? [...new Set(args.blockIds)] : undefined;

    // Duplicate block IDs are rejected, not silently normalized.
    if (blockIds && blockIds.length !== args.blockIds?.length) {
      throw new AutonomyPolicyError(
        "block_scope_invalid",
        "Block allowlist must not contain duplicates.",
      );
    }

    assertValidGrantRequest({
      mode: args.mode,
      entityId: args.entityId ? String(args.entityId) : undefined,
      runId: runId ? String(runId) : undefined,
      blockIds: blockIds?.map(String),
      agentId,
      agentLabel,
      runtime,
      maxOperations: args.maxOperations,
      expiresAt: args.expiresAt,
      now,
    });

    const policyBody = {
      policyVersion: AUTONOMY_POLICY_VERSION,
      ownerKey: identity.ownerKey,
      operation: AUTONOMY_OPERATION,
      mode: args.mode,
      entityId: args.entityId ? String(args.entityId) : null,
      runId: runId ? String(runId) : null,
      runBinding:
        args.mode === "workspace"
          ? "not_applicable"
          : "bound",
      blockIds: blockIds?.map(String).sort() ?? null,
      agentId,
      maxOperations: args.maxOperations,
      expiresAt: args.expiresAt,
      restrictedOperations: AUTONOMY_RESTRICTED_OPERATIONS,
      capabilityEnvelope: AUTONOMY_CAPABILITY_ENVELOPE,
    };
    const [policyDigest, scopeDigest, grantIdDigest] = await Promise.all([
      digestCanonical(policyBody),
      digestCanonical({
        mode: args.mode,
        entityId: args.entityId ? String(args.entityId) : null,
        runId: runId ? String(runId) : null,
        runBinding:
          args.mode === "workspace"
            ? "not_applicable"
            : "bound",
        blockIds: blockIds?.map(String).sort() ?? null,
        operation: AUTONOMY_OPERATION,
      }),
      digestCanonical({
        ownerKey: identity.ownerKey,
        creationKey,
        policyVersion: AUTONOMY_POLICY_VERSION,
      }),
    ]);

    if (args.entityId) {
      const entity = await ctx.db.get(args.entityId);
      if (!entity || entity.ownerKey !== identity.ownerKey) {
        throw new AutonomyPolicyError(
          "entity_not_found",
          "Authority can only be granted for an owned notebook entity.",
        );
      }
    }
    if (runId) {
      const [scratchpad, entity] = await Promise.all([
        ctx.db.get(runId),
        args.entityId ? ctx.db.get(args.entityId) : Promise.resolve(null),
      ]);
      if (!scratchpad || scratchpad.ownerKey !== identity.ownerKey) {
        throw new AutonomyPolicyError(
          "scratchpad_run_not_found",
          "A supplied runId must identify the authenticated owner's scratchpad run.",
        );
      }
      if (
        entity &&
        (scratchpad.entitySlug !== entity.slug ||
          scratchpad.entityId !== entity._id)
      ) {
        throw new AutonomyPolicyError(
          "scratchpad_entity_mismatch",
          "The scratchpad run does not belong to the grant entity.",
        );
      }
    }
    if (blockIds) {
      const scopedBlocks = await Promise.all(blockIds.map((blockId) => ctx.db.get(blockId)));
      const invalidBlock = scopedBlocks.find(
        (block) =>
          !block ||
          block.ownerKey !== identity.ownerKey ||
          (args.entityId !== undefined && block.entityId !== args.entityId) ||
          block.deletedAt !== undefined,
      );
      if (invalidBlock !== undefined || scopedBlocks.some((block) => !block)) {
        throw new AutonomyPolicyError(
          "block_scope_invalid",
          "Every allowed block must be live and owned within the grant entity.",
        );
      }
    }

    const existingByKey = await ctx.db
      .query("autonomyGrants")
      .withIndex("by_owner_creation_key", (q) =>
        q.eq("ownerKey", identity.ownerKey).eq("creationKey", creationKey),
      )
      .unique();
    if (existingByKey) {
      if (existingByKey.policyDigest !== policyDigest) {
        throw new AutonomyPolicyError(
          "grant_idempotency_conflict",
          "creationKey was already used for a different authority request.",
        );
      }
      return {
        grantId: existingByKey.grantId,
        status: effectiveGrantStatus(existingByKey, now),
        idempotent: true,
      };
    }

    // Keep a single unambiguous authority grant for an agent/entity pair.
    const scopedRows = await ctx.db
      .query("autonomyGrants")
      .withIndex("by_owner_created", (q) => q.eq("ownerKey", identity.ownerKey))
      .order("desc")
      .take(100);
    const conflict = scopedRows.find(
      (row) =>
        row.agentId === agentId &&
        (effectiveGrantStatus(row, now) === "active" ||
          effectiveGrantStatus(row, now) === "paused"),
    );
    if (conflict) {
      throw new AutonomyPolicyError(
        "active_grant_exists",
        `Pause/revoke or reuse the existing grant ${conflict.grantId}.`,
      );
    }

    const grantId = `grant_${grantIdDigest.slice("sha256:".length)}`;
    const runBindingDigest = runId
      ? await digestCanonical({
          grantId,
          ownerKey: identity.ownerKey,
          runId: String(runId),
          boundAt: now,
        })
      : undefined;
    await ctx.db.insert("autonomyGrants", {
      ownerKey: identity.ownerKey,
      userId: identity.rawUserId,
      grantId,
      creationKey,
      mode: args.mode,
      operation: AUTONOMY_OPERATION,
      entityId: args.entityId,
      runId,
      runBinding:
        args.mode === "workspace"
          ? "not_applicable"
          : "bound",
      runBoundAt: runId ? now : undefined,
      runBindingDigest,
      blockIds,
      agentId,
      agentIdentityAssurance: "server_fixed",
      agentLabel,
      runtime,
      capabilityEnvelope: AUTONOMY_CAPABILITY_ENVELOPE,
      restrictedOperations: [...AUTONOMY_RESTRICTED_OPERATIONS],
      maxOperations: args.maxOperations,
      usedOperations: 0,
      expiresAt: args.expiresAt,
      status: "active",
      policyVersion: AUTONOMY_POLICY_VERSION,
      policyDigest,
      scopeDigest,
      createdAt: now,
      updatedAt: now,
    });

    return { grantId, status: "active" as const, idempotent: false };
  },
});

export const getGrant = query({
  args: { grantId: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const grant = await findOwnedGrantByPublicId(ctx, identity.ownerKey, args.grantId);
    if (!grant) return null;
    return { ...grant, effectiveStatus: effectiveGrantStatus(grant, Date.now()) };
  },
});

export const listGrants = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 25), 1), 100);
    const now = Date.now();
    const rows = await ctx.db
      .query("autonomyGrants")
      .withIndex("by_owner_created", (q) => q.eq("ownerKey", identity.ownerKey))
      .order("desc")
      .take(limit);
    return rows.map((row) => ({
      ...row,
      effectiveStatus: effectiveGrantStatus(row, now),
    }));
  },
});

export const getAuthorityState = query({
  args: {
    entityId: v.optional(v.id("productEntities")),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuthenticatedProductIdentity(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("autonomyGrants")
      .withIndex("by_owner_created", (q) => q.eq("ownerKey", identity.ownerKey))
      .order("desc")
      .take(100);
    const applicableRows = rows.filter((row) => {
      if (row.agentId !== AUTONOMY_AGENT_ID) return false;
      if (args.entityId !== undefined && row.entityId !== undefined && row.entityId !== args.entityId) {
        return false;
      }
      return true;
    });
    const grant = applicableRows.find((row) => {
      const status = effectiveGrantStatus(row, now);
      return status === "active" || status === "paused";
    });

    if (!grant) {
      const latestGrant = applicableRows[0];
      const latestEffectiveStatus = latestGrant
        ? effectiveGrantStatus(latestGrant, now)
        : null;
      return {
        mode: "review" as const,
        grant: null,
        lastGrant: latestGrant
          ? { ...latestGrant, effectiveStatus: latestEffectiveStatus }
          : null,
        autonomyEndedReason: latestEffectiveStatus,
        allowedOperation: AUTONOMY_OPERATION,
        restrictedOperations: [...AUTONOMY_RESTRICTED_OPERATIONS],
        capabilityEnvelope: AUTONOMY_CAPABILITY_ENVELOPE,
      };
    }

    return {
      mode: grant.mode,
      grant: { ...grant, effectiveStatus: effectiveGrantStatus(grant, now) },
      lastGrant: null,
      autonomyEndedReason: null,
      allowedOperation: AUTONOMY_OPERATION,
      restrictedOperations: [...AUTONOMY_RESTRICTED_OPERATIONS],
      capabilityEnvelope: grant.capabilityEnvelope,
    };
  },
});

async function transitionGrant(
  ctx: MutationCtx,
  grantId: string,
  transition: "pause" | "resume" | "revoke",
  reason?: string,
): Promise<{ ok: boolean; status: AutonomyGrantStatus }> {
  const { grant } = await requireOwnedGrant(ctx, grantId);
  const now = Date.now();
  const effectiveStatus = effectiveGrantStatus(grant, now);

  if (effectiveStatus === "expired" || effectiveStatus === "consumed") {
    if (grant.status !== effectiveStatus) {
      await ctx.db.patch(grant._id, { status: effectiveStatus, updatedAt: now });
    }
    return { ok: false, status: effectiveStatus };
  }

  if (transition === "pause") {
    if (effectiveStatus === "revoked") return { ok: false, status: "revoked" };
    if (effectiveStatus === "paused") return { ok: true, status: "paused" };
    await ctx.db.patch(grant._id, {
      status: "paused",
      pausedAt: now,
      updatedAt: now,
    });
    return { ok: true, status: "paused" };
  }

  if (transition === "resume") {
    if (effectiveStatus === "revoked") return { ok: false, status: "revoked" };
    if (effectiveStatus === "active") return { ok: true, status: "active" };
    await ctx.db.patch(grant._id, {
      status: "active",
      resumedAt: now,
      updatedAt: now,
    });
    return { ok: true, status: "active" };
  }

  if (effectiveStatus === "revoked") return { ok: true, status: "revoked" };
  const revokeReason = optionalBoundedText(
    reason,
    "revoke_reason",
    AUTONOMY_LIMITS.maxReasonLength,
  );
  await ctx.db.patch(grant._id, {
    status: "revoked",
    revokedAt: now,
    revokeReason,
    updatedAt: now,
  });
  return { ok: true, status: "revoked" };
}

export const pauseGrant = mutation({
  args: { grantId: v.string() },
  handler: async (ctx, args) => transitionGrant(ctx, args.grantId, "pause"),
});

export const resumeGrant = mutation({
  args: { grantId: v.string() },
  handler: async (ctx, args) => transitionGrant(ctx, args.grantId, "resume"),
});

export const revokeGrant = mutation({
  args: { grantId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) =>
    transitionGrant(ctx, args.grantId, "revoke", args.reason),
});
