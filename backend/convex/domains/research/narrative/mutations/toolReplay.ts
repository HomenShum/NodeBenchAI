import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../../_generated/server";

/**
 * Tool record/replay substrate for audit-grade reproducibility.
 *
 * Stores immutable tool call inputs/outputs keyed by (parentWorkflowId, toolName, inputHash).
 * Uses `checkpoints` as the backing table to avoid new schema surface area.
 *
 * IMPORTANT: Records are append-only. If a record already exists for the key, we do not overwrite it.
 */

function makeCheckpointId(parentWorkflowId: string, toolName: string, inputHash: string): string {
  return `drane_tool_${parentWorkflowId}_${toolName}_${inputHash}`;
}

function makeToolWorkflowId(parentWorkflowId: string): string {
  return `drane_tools_${parentWorkflowId}`;
}

export const saveToolRecord = internalMutation({
  args: {
    parentWorkflowId: v.string(),
    toolName: v.string(),
    inputHash: v.string(),
    input: v.any(),
    output: v.any(),
    recordedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = args.recordedAt ?? Date.now();
    const checkpointId = makeCheckpointId(args.parentWorkflowId, args.toolName, args.inputHash);

    const existing = await ctx.db
      .query("checkpoints")
      .withIndex("by_checkpoint_id", (q) => q.eq("checkpointId", checkpointId))
      .first();
    if (existing) return null;

    await ctx.db.insert("checkpoints", {
      workflowId: makeToolWorkflowId(args.parentWorkflowId),
      checkpointId,
      checkpointNumber: 1,
      parentCheckpointId: undefined,
      workflowType: "drane_tool_record",
      workflowName: "DRANE Tool Record",
      userId: undefined,
      sessionId: undefined,
      currentStep: "complete",
      status: "completed",
      progress: 100,
      state: {
        kind: "drane_tool_record",
        version: 1,
        parentWorkflowId: args.parentWorkflowId,
        toolName: args.toolName,
        inputHash: args.inputHash,
        input: args.input,
        output: args.output,
        recordedAt: now,
      },
      createdAt: now,
      error: undefined,
      estimatedTimeRemaining: undefined,
      nextScheduledAction: undefined,
    });

    return null;
  },
});

export const getToolRecord = internalQuery({
  args: {
    parentWorkflowId: v.string(),
    toolName: v.string(),
    inputHash: v.string(),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const checkpointId = makeCheckpointId(args.parentWorkflowId, args.toolName, args.inputHash);
    const record = await ctx.db
      .query("checkpoints")
      .withIndex("by_checkpoint_id", (q) => q.eq("checkpointId", checkpointId))
      .first();
    if (!record) return null;
    const state = record.state as any;
    if (!state || state.kind !== "drane_tool_record") return null;
    if (state.parentWorkflowId !== args.parentWorkflowId) return null;
    if (state.toolName !== args.toolName) return null;
    if (state.inputHash !== args.inputHash) return null;
    return state.output ?? null;
  },
});

