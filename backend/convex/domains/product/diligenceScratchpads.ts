import { v } from "convex/values";
import { internalMutation, query } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireEntityWorkspaceWriteAccessBySlug } from "./helpers";

type ScratchpadStatus = "streaming" | "structuring" | "merged" | "failed";

type ScratchpadEnvelope = {
  markdownSource?: string;
  checkpointNumber?: number;
  workflowType?: string;
  latestBlockType?: string;
  latestHeaderText?: string;
};

function readMarkdownSource(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const envelope = value as ScratchpadEnvelope;
  return typeof envelope.markdownSource === "string" ? envelope.markdownSource : null;
}

function readCheckpointNumber(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const envelope = value as ScratchpadEnvelope;
  return typeof envelope.checkpointNumber === "number" ? envelope.checkpointNumber : undefined;
}

export const getLatestForEntity = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
    checkpointLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspace = await requireEntityWorkspaceWriteAccessBySlug(ctx, args);
    const scratchpads = (await ctx.db
      .query("agentScratchpads")
      .withIndex("by_owner_entity", (q) =>
        q
          .eq("ownerKey", workspace.entity.ownerKey)
          .eq("entityId", workspace.entity._id),
      )
      .order("desc")
      .take(20)) as Doc<"agentScratchpads">[];

    if (scratchpads.length === 0) return null;

    const latest = scratchpads.sort((left, right) => right.updatedAt - left.updatedAt)[0]!;
    const checkpoints = await ctx.db
      .query("checkpoints")
      .withIndex("by_workflow_id", (q) => q.eq("workflowId", latest.agentThreadId))
      .collect();

    const checkpointLimit = Math.max(1, Math.min(args.checkpointLimit ?? 8, 20));
    const recentCheckpoints = checkpoints
      .sort((left, right) => right.checkpointNumber - left.checkpointNumber)
      .slice(0, checkpointLimit)
      .map((checkpoint) => ({
        checkpointId: checkpoint.checkpointId,
        checkpointNumber: checkpoint.checkpointNumber,
        currentStep: checkpoint.currentStep,
        status: checkpoint.status,
        progress: checkpoint.progress,
        createdAt: checkpoint.createdAt,
        error: checkpoint.error,
      }));

    return {
      scratchpadId: latest._id,
      runId: latest.agentThreadId,
      status: (latest.status as ScratchpadStatus | undefined) ?? "streaming",
      markdownSource: readMarkdownSource(latest.scratchpad),
      version: readCheckpointNumber(latest.scratchpad) ?? recentCheckpoints[0]?.checkpointNumber ?? 0,
      updatedAt: latest.updatedAt,
      checkpointCount: checkpoints.length,
      latestBlockType:
        latest.scratchpad && typeof latest.scratchpad === "object"
          ? ((latest.scratchpad as ScratchpadEnvelope).latestBlockType ?? null)
          : null,
      latestHeaderText:
        latest.scratchpad && typeof latest.scratchpad === "object"
          ? ((latest.scratchpad as ScratchpadEnvelope).latestHeaderText ?? null)
          : null,
      checkpoints: recentCheckpoints,
    };
  },
});

export const upsertScratchpadRun = internalMutation({
  args: {
    runId: v.string(),
    ownerKey: v.string(),
    entityId: v.id("productEntities"),
    entitySlug: v.string(),
    userId: v.optional(v.id("users")),
    markdownSource: v.string(),
    status: v.union(
      v.literal("streaming"),
      v.literal("structuring"),
      v.literal("merged"),
      v.literal("failed"),
    ),
    mode: v.optional(v.union(v.literal("live"), v.literal("background"))),
    idempotencyKey: v.optional(v.string()),
    checkpointNumber: v.number(),
    latestBlockType: v.optional(v.string()),
    latestHeaderText: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("agentScratchpads")
      .withIndex("by_agent_thread", (q) => q.eq("agentThreadId", args.runId))
      .first();

    const scratchpad = {
      markdownSource: args.markdownSource,
      checkpointNumber: args.checkpointNumber,
      workflowType: "product_diligence_overlay",
      latestBlockType: args.latestBlockType,
      latestHeaderText: args.latestHeaderText,
    };

    if (existing) {
      if (
        existing.ownerKey !== args.ownerKey ||
        existing.entityId !== args.entityId ||
        existing.entitySlug !== args.entitySlug
      ) {
        throw new Error("Scratchpad run belongs to a different workspace");
      }
      await ctx.db.patch(existing._id, {
        scratchpad,
        ownerKey: args.ownerKey,
        entityId: args.entityId,
        entitySlug: args.entitySlug,
        status: args.status,
        mode: args.mode,
        idempotencyKey: args.idempotencyKey,
        failureReason: args.failureReason,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("agentScratchpads", {
      agentThreadId: args.runId,
      userId: (args.userId ?? ("system" as Id<"users">)) as Id<"users">,
      scratchpad,
      ownerKey: args.ownerKey,
      entityId: args.entityId,
      entitySlug: args.entitySlug,
      status: args.status,
      mode: args.mode,
      idempotencyKey: args.idempotencyKey,
      failureReason: args.failureReason,
      createdAt: now,
      updatedAt: now,
    });
  },
});
