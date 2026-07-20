/**
 * Internal, owner-bound task-tree storage used by due-diligence orchestrators.
 *
 * This module intentionally has no public queries, mutations, or actions. The
 * former public parallel-task UI and general orchestrator had no runtime
 * consumers. Trusted due-diligence actions pass the job owner explicitly, and
 * every write revalidates the complete owner -> tree -> task chain.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

const OWNERSHIP_ERROR = "Task tree not found or unauthorized";
const MAX_AGENT_THREAD_ID_LENGTH = 500;
const MAX_QUERY_LENGTH = 4_000;
const MAX_BRANCHES = 16;
const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 4_000;
const MAX_AGENT_NAME_LENGTH = 160;
const MAX_PHASE_LENGTH = 500;
const MAX_RESULT_LENGTH = 2_000_000;
const MAX_RESULT_SUMMARY_LENGTH = 4_000;
const MAX_ERROR_MESSAGE_LENGTH = 4_000;

type TreeStatus =
  | "decomposing"
  | "executing"
  | "verifying"
  | "cross_checking"
  | "merging"
  | "completed"
  | "failed";

type TaskStatus =
  | "pending"
  | "running"
  | "awaiting_children"
  | "verifying"
  | "completed"
  | "pruned"
  | "failed"
  | "backtracked";

function sameId(left: unknown, right: unknown): boolean {
  return String(left) === String(right);
}

async function requireExistingOwner(ctx: any, userId: Id<"users">): Promise<void> {
  const owner = await ctx.db.get(userId);
  if (!owner) throw new Error(OWNERSHIP_ERROR);
}

async function requireOwnedTree(
  ctx: any,
  treeId: Id<"parallelTaskTrees">,
  userId: Id<"users">,
): Promise<Doc<"parallelTaskTrees">> {
  const tree = await ctx.db.get(treeId) as Doc<"parallelTaskTrees"> | null;
  if (!tree || !sameId(tree.userId, userId)) throw new Error(OWNERSHIP_ERROR);
  return tree;
}

async function requireOwnedTask(
  ctx: any,
  taskId: string,
  userId: Id<"users">,
): Promise<{ task: Doc<"parallelTaskNodes">; tree: Doc<"parallelTaskTrees"> }> {
  const task = await ctx.db
    .query("parallelTaskNodes")
    .withIndex("by_taskId", (q: any) => q.eq("taskId", taskId))
    .first() as Doc<"parallelTaskNodes"> | null;
  if (!task) throw new Error(OWNERSHIP_ERROR);
  const tree = await requireOwnedTree(ctx, task.treeId, userId);
  return { task, tree };
}

async function requireOwnedTaskInTree(
  ctx: any,
  treeId: Id<"parallelTaskTrees">,
  taskId: string,
  userId: Id<"users">,
): Promise<{ task: Doc<"parallelTaskNodes">; tree: Doc<"parallelTaskTrees"> }> {
  const owned = await requireOwnedTask(ctx, taskId, userId);
  if (!sameId(owned.task.treeId, treeId)) throw new Error(OWNERSHIP_ERROR);
  return owned;
}

function requiredBoundedString(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must contain 1-${maxLength} characters`);
  }
  return normalized;
}

function optionalBoundedString(
  value: string | undefined,
  field: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredBoundedString(value, field, maxLength);
}

async function createTaskTreeForOwner(
  ctx: any,
  args: {
    userId: Id<"users">;
    agentThreadId: string;
    query: string;
  },
) {
  await requireExistingOwner(ctx, args.userId);
  const agentThreadId = requiredBoundedString(
    args.agentThreadId,
    "agentThreadId",
    MAX_AGENT_THREAD_ID_LENGTH,
  );
  const query = requiredBoundedString(args.query, "query", MAX_QUERY_LENGTH);
  const now = Date.now();
  const treeId = await ctx.db.insert("parallelTaskTrees", {
    userId: args.userId,
    agentThreadId,
    query,
    status: "decomposing",
    phase: "Preparing due-diligence branches",
    phaseProgress: 0,
    totalBranches: 0,
    activeBranches: 0,
    completedBranches: 0,
    prunedBranches: 0,
    createdAt: now,
    updatedAt: now,
  });

  const rootTaskId = crypto.randomUUID();
  await ctx.db.insert("parallelTaskNodes", {
    treeId,
    taskId: rootTaskId,
    title: "Due diligence",
    description: query,
    taskType: "root",
    status: "running",
    depth: 0,
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(treeId, { rootTaskId });
  await ctx.db.insert("parallelTaskEvents", {
    treeId,
    taskId: rootTaskId,
    seq: 0,
    eventType: "started",
    message: "Due-diligence task tree started",
    createdAt: now,
  });
  return { treeId, rootTaskId };
}

async function updateTreeStatusForOwner(
  ctx: any,
  args: {
    userId: Id<"users">;
    treeId: Id<"parallelTaskTrees">;
    status: TreeStatus;
    phase?: string;
    phaseProgress?: number;
  },
) {
  const tree = await requireOwnedTree(ctx, args.treeId, args.userId);
  if (
    args.phaseProgress !== undefined &&
    (!Number.isFinite(args.phaseProgress) || args.phaseProgress < 0 || args.phaseProgress > 100)
  ) {
    throw new Error("phaseProgress must be between 0 and 100");
  }
  const phase = optionalBoundedString(args.phase, "phase", MAX_PHASE_LENGTH);
  const now = Date.now();
  const updates: Partial<Doc<"parallelTaskTrees">> = {
    status: args.status,
    updatedAt: now,
  };
  if (phase !== undefined) updates.phase = phase;
  if (args.phaseProgress !== undefined) updates.phaseProgress = args.phaseProgress;
  if (args.status === "completed" || args.status === "failed") {
    updates.completedAt = now;
    updates.elapsedMs = now - tree.createdAt;
  }
  await ctx.db.patch(args.treeId, updates);
}

async function createBranchTasksForOwner(
  ctx: any,
  args: {
    userId: Id<"users">;
    treeId: Id<"parallelTaskTrees">;
    parentTaskId: string;
    branches: Array<{
      title: string;
      description?: string;
      agentName?: string;
    }>;
  },
) {
  if (args.branches.length === 0 || args.branches.length > MAX_BRANCHES) {
    throw new Error(`branches must contain 1-${MAX_BRANCHES} items`);
  }
  const branches = args.branches.map((branch, index) => ({
    title: requiredBoundedString(branch.title, `branches[${index}].title`, MAX_TITLE_LENGTH),
    description: optionalBoundedString(
      branch.description,
      `branches[${index}].description`,
      MAX_DESCRIPTION_LENGTH,
    ),
    agentName: optionalBoundedString(
      branch.agentName,
      `branches[${index}].agentName`,
      MAX_AGENT_NAME_LENGTH,
    ),
  }));
  const { task: parent, tree } = await requireOwnedTaskInTree(
    ctx,
    args.treeId,
    args.parentTaskId,
    args.userId,
  );
  const now = Date.now();
  const taskIds: string[] = [];
  const depth = parent.depth + 1;

  for (let index = 0; index < branches.length; index += 1) {
    const branch = branches[index];
    const taskId = crypto.randomUUID();
    await ctx.db.insert("parallelTaskNodes", {
      treeId: args.treeId,
      taskId,
      parentTaskId: args.parentTaskId,
      title: branch.title,
      description: branch.description,
      taskType: "branch",
      status: "pending",
      branchIndex: index,
      siblingCount: branches.length,
      depth,
      agentName: branch.agentName,
      canBacktrack: true,
      createdAt: now,
      updatedAt: now,
    });
    taskIds.push(taskId);
    await ctx.db.insert("parallelTaskEvents", {
      treeId: args.treeId,
      taskId,
      seq: 0,
      eventType: "started",
      message: `Branch ${index + 1}/${branches.length}: ${branch.title}`,
      createdAt: now,
    });
  }

  await ctx.db.patch(args.treeId, {
    totalBranches: (tree.totalBranches ?? 0) + branches.length,
    updatedAt: now,
  });
  await ctx.db.patch(parent._id, {
    status: "awaiting_children",
    updatedAt: now,
  });
  return taskIds;
}

type TaskStatusUpdate = {
  userId: Id<"users">;
  taskId: string;
  status: TaskStatus;
  result?: string;
  resultSummary?: string;
  confidence?: number;
  errorMessage?: string;
};

async function updateTaskStatusForOwner(ctx: any, args: TaskStatusUpdate) {
  const { task, tree } = await requireOwnedTask(ctx, args.taskId, args.userId);
  const result = optionalBoundedString(args.result, "result", MAX_RESULT_LENGTH);
  const resultSummary = optionalBoundedString(
    args.resultSummary,
    "resultSummary",
    MAX_RESULT_SUMMARY_LENGTH,
  );
  const errorMessage = optionalBoundedString(
    args.errorMessage,
    "errorMessage",
    MAX_ERROR_MESSAGE_LENGTH,
  );
  if (
    args.confidence !== undefined
    && (!Number.isFinite(args.confidence) || args.confidence < 0 || args.confidence > 1)
  ) {
    throw new Error("confidence must be a finite number between 0 and 1");
  }
  const now = Date.now();
  const updates: Partial<Doc<"parallelTaskNodes">> = {
    status: args.status,
    updatedAt: now,
  };
  if (result !== undefined) updates.result = result;
  if (resultSummary !== undefined) updates.resultSummary = resultSummary;
  if (args.confidence !== undefined) updates.confidence = args.confidence;
  if (errorMessage !== undefined) updates.errorMessage = errorMessage;
  if (args.status === "running" && !task.startedAt) updates.startedAt = now;
  if (["completed", "pruned", "failed", "backtracked"].includes(args.status)) {
    updates.completedAt = now;
    if (task.startedAt) updates.elapsedMs = now - task.startedAt;
  }
  await ctx.db.patch(task._id, updates);

  if (task.taskType === "branch" && task.status !== args.status) {
    const wasActive = task.status === "running" || task.status === "verifying";
    const isActive = args.status === "running" || args.status === "verifying";
    const treeUpdates: Partial<Doc<"parallelTaskTrees">> = {
      updatedAt: now,
      activeBranches: Math.max(
        0,
        (tree.activeBranches ?? 0) + Number(isActive) - Number(wasActive),
      ),
      completedBranches: Math.max(
        0,
        (tree.completedBranches ?? 0)
          + Number(args.status === "completed")
          - Number(task.status === "completed"),
      ),
      prunedBranches: Math.max(
        0,
        (tree.prunedBranches ?? 0)
          + Number(args.status === "pruned")
          - Number(task.status === "pruned"),
      ),
    };
    await ctx.db.patch(task.treeId, treeUpdates);
  }

  const latestEvent = await ctx.db
    .query("parallelTaskEvents")
    .withIndex("by_tree_task", (q: any) =>
      q.eq("treeId", task.treeId).eq("taskId", args.taskId)
    )
    .order("desc")
    .first() as Doc<"parallelTaskEvents"> | null;

  await ctx.db.insert("parallelTaskEvents", {
    treeId: task.treeId,
    taskId: args.taskId,
    seq: (latestEvent?.seq ?? -1) + 1,
    eventType: args.status === "completed" ? "completed"
      : args.status === "pruned" ? "pruned"
      : args.status === "failed" ? "failed"
      : args.status === "backtracked" ? "backtracked"
      : "progress",
    message: `Task ${args.status}: ${task.title}`,
    data: result ? { resultPreview: result.slice(0, 200) } : undefined,
    createdAt: now,
  });
}

export const createTaskTreeInternal = internalMutation({
  args: {
    userId: v.id("users"),
    agentThreadId: v.string(),
    query: v.string(),
  },
  handler: async (ctx, args) => await createTaskTreeForOwner(ctx, args),
});

export const internalUpdateTreeStatus = internalMutation({
  args: {
    userId: v.id("users"),
    treeId: v.id("parallelTaskTrees"),
    status: v.union(
      v.literal("decomposing"),
      v.literal("executing"),
      v.literal("verifying"),
      v.literal("cross_checking"),
      v.literal("merging"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    phase: v.optional(v.string()),
    phaseProgress: v.optional(v.number()),
  },
  handler: async (ctx, args) => await updateTreeStatusForOwner(ctx, args),
});

export const createBranchTasksInternal = internalMutation({
  args: {
    userId: v.id("users"),
    treeId: v.id("parallelTaskTrees"),
    parentTaskId: v.string(),
    branches: v.array(v.object({
      title: v.string(),
      description: v.optional(v.string()),
      agentName: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => await createBranchTasksForOwner(ctx, args),
});

export const updateTaskStatusInternal = internalMutation({
  args: {
    userId: v.id("users"),
    taskId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("awaiting_children"),
      v.literal("verifying"),
      v.literal("completed"),
      v.literal("pruned"),
      v.literal("failed"),
      v.literal("backtracked"),
    ),
    result: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
    confidence: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => await updateTaskStatusForOwner(ctx, args),
});
