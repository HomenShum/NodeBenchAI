/**
 * Task Tracker Tool - 2025 Deep Agents Pattern (durable)
 *
 * This implements the "Feature List" pattern but persists state to Convex
 * so cold starts do not wipe progress.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import type { ToolCtx } from "@convex-dev/agent";
import { internal } from "../../../../_generated/api";

export const TaskStatus = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  BLOCKED: "blocked",
  FAILED: "failed",
} as const;

export type TaskStatusType = typeof TaskStatus[keyof typeof TaskStatus];

export interface TrackedTask {
  id: string;
  name: string;
  description: string;
  status: TaskStatusType;
  testCriteria: string;
  blockedBy: string[];
  completedAt: number | null;
  notes: string[];
}

export interface TaskTrackerState {
  sessionId: string;
  tasks: TrackedTask[];
  progressLog: Array<{
    timestamp: number;
    taskId: string;
    action: string;
    details: string;
  }>;
  createdAt: number;
  updatedAt: number;
}

// Best-effort in-memory cache (never a source of truth).
let currentState: TaskTrackerState | null = null;

function getStorageKey(ctx: any, sessionId?: string): string | null {
  const threadId = typeof ctx?.threadId === "string" ? ctx.threadId : undefined;
  if (threadId) return `taskTracker:thread:${threadId}`;
  if (sessionId) return `taskTracker:session:${sessionId}`;
  return null;
}

async function loadState(ctx: any, sessionId?: string): Promise<TaskTrackerState | null> {
  const key = getStorageKey(ctx, sessionId);
  if (!key) return currentState;
  try {
    const entry = await ctx.runQuery(internal.domains.mcp.mcpMemory.readMemory, { key });
    if (!entry?.content) return currentState;
    const parsed = JSON.parse(entry.content);
    if (parsed && typeof parsed === "object") {
      currentState = parsed as TaskTrackerState;
      return currentState;
    }
  } catch {
    // ignore
  }
  return currentState;
}

async function saveState(ctx: any, state: TaskTrackerState): Promise<void> {
  currentState = state;
  const key = getStorageKey(ctx, state.sessionId);
  if (!key) return;
  try {
    await ctx.runMutation(internal.domains.mcp.mcpMemory.writeMemory, {
      entry: {
        key,
        content: JSON.stringify(state),
        metadata: {
          type: "task_tracker",
          threadId: typeof ctx?.threadId === "string" ? ctx.threadId : undefined,
          sessionId: state.sessionId,
          updatedAt: state.updatedAt,
        },
      },
    });
  } catch (e) {
    console.warn("[taskTrackerTool] Failed to persist state", e);
  }
}

export const initTaskTracker = createTool({
  description: `Initialize the task tracker with a list of tasks to complete.

This tool persists state to Convex (via MCP memory) so cold starts do not wipe progress.`,

  args: z.object({
    sessionId: z.string().describe("Session ID from context initializer"),
    tasks: z.array(z.object({
      name: z.string(),
      description: z.string(),
      testCriteria: z.string(),
      blockedBy: z.array(z.string()).optional(),
    })),
  }),

  handler: async (ctx: ToolCtx, args): Promise<TaskTrackerState> => {
    const now = Date.now();

    const tasks: TrackedTask[] = args.tasks.map((t, idx) => ({
      id: `task_${idx + 1}`,
      name: t.name,
      description: t.description,
      status: TaskStatus.NOT_STARTED,
      testCriteria: t.testCriteria,
      blockedBy: t.blockedBy ?? [],
      completedAt: null,
      notes: [],
    }));

    const state: TaskTrackerState = {
      sessionId: args.sessionId,
      tasks,
      progressLog: [{
        timestamp: now,
        taskId: "system",
        action: "initialized",
        details: `Created ${tasks.length} tasks`,
      }],
      createdAt: now,
      updatedAt: now,
    };

    await saveState(ctx as any, state);
    return state;
  },
});

export const updateTaskStatus = createTool({
  description: `Update the status of a task.

IMPORTANT: Before marking a task as "completed", verify it meets the testCriteria.
This prevents the "premature victory" failure mode.`,

  args: z.object({
    taskId: z.string().describe("The task ID to update"),
    status: z.enum(["not_started", "in_progress", "completed", "blocked", "failed"]),
    notes: z.string().optional().describe("Optional notes about the status change"),
    testCriteriaVerified: z.boolean().optional().describe("Set true when marking completed to confirm criteria met"),
  }),

  handler: async (ctx: ToolCtx, args): Promise<{ success: boolean; message: string; state: TaskTrackerState | null }> => {
    const state = await loadState(ctx as any);
    if (!state) {
      return { success: false, message: "Task tracker not initialized. Call initTaskTracker first.", state: null };
    }

    const task = state.tasks.find((t) => t.id === args.taskId);
    if (!task) {
      return { success: false, message: `Task ${args.taskId} not found`, state };
    }

    if (args.status === "completed" && !args.testCriteriaVerified) {
      return {
        success: false,
        message: `Cannot mark task as completed without verifying testCriteria: "${task.testCriteria}"`,
        state,
      };
    }

    const now = Date.now();
    task.status = args.status;
    if (args.status === "completed") task.completedAt = now;
    if (args.notes) task.notes.push(args.notes);

    state.progressLog.push({
      timestamp: now,
      taskId: args.taskId,
      action: `status_changed_to_${args.status}`,
      details: args.notes ?? "",
    });
    state.updatedAt = now;

    await saveState(ctx as any, state);
    return { success: true, message: `Task ${args.taskId} updated to ${args.status}`, state };
  },
});

export const getTaskSummary = createTool({
  description: `Get a summary of all tasks and their current status.`,
  args: z.object({}),

  handler: async (ctx: ToolCtx): Promise<{
    initialized: boolean;
    summary: {
      total: number;
      notStarted: number;
      inProgress: number;
      completed: number;
      blocked: number;
      failed: number;
      completionPercentage: number;
    } | null;
    nextTask: TrackedTask | null;
    blockedTasks: TrackedTask[];
  }> => {
    const state = await loadState(ctx as any);
    if (!state) return { initialized: false, summary: null, nextTask: null, blockedTasks: [] };

    const tasks = state.tasks;
    const summary = {
      total: tasks.length,
      notStarted: tasks.filter((t) => t.status === "not_started").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      completed: tasks.filter((t) => t.status === "completed").length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      completionPercentage: Math.round((tasks.filter((t) => t.status === "completed").length / tasks.length) * 100),
    };

    const nextTask =
      tasks.find(
        (t) =>
          t.status === "not_started" &&
          t.blockedBy.every((blockerId) => tasks.find((bt) => bt.id === blockerId)?.status === "completed"),
      ) ?? null;

    const blockedTasks = tasks.filter((t) => t.status === "blocked");
    return { initialized: true, summary, nextTask, blockedTasks };
  },
});

