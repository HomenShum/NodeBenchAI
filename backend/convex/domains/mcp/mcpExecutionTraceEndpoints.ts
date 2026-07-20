import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

const oracleSourceRefValidator = v.object({
  label: v.string(),
  href: v.optional(v.string()),
  note: v.optional(v.string()),
  kind: v.optional(v.string()),
});

function generateTraceId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "trace_";
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export const mcpStartExecutionRun = internalMutation({
  args: {
    userId: v.string(),
    title: v.string(),
    workflowName: v.string(),
    description: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("cron"),
        v.literal("scheduled"),
        v.literal("agent"),
        v.literal("swarm"),
      ),
    ),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private"))),
    goalId: v.optional(v.string()),
    visionSnapshot: v.optional(v.string()),
    successCriteria: v.optional(v.array(v.string())),
    sourceRefs: v.optional(v.array(oracleSourceRefValidator)),
    metadata: v.optional(v.any()),
  },
  returns: v.object({
    sessionId: v.id("agentTaskSessions"),
    traceId: v.id("agentTaskTraces"),
    publicTraceId: v.string(),
    status: v.string(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const sessionId = await ctx.db.insert("agentTaskSessions", {
      title: args.title,
      description: args.description,
      type: args.type ?? "agent",
      visibility: args.visibility ?? "private",
      userId: args.userId as Id<"users">,
      status: "running",
      startedAt: now,
      goalId: args.goalId,
      visionSnapshot: args.visionSnapshot,
      successCriteria: args.successCriteria,
      sourceRefs: args.sourceRefs,
      metadata: {
        executionTraceOrigin: "mcp",
        ...(args.metadata && typeof args.metadata === "object" ? (args.metadata as Record<string, unknown>) : {}),
      },
    });

    const publicTraceId = generateTraceId();
    const traceId = await ctx.db.insert("agentTaskTraces", {
      sessionId,
      traceId: publicTraceId,
      workflowName: args.workflowName,
      goalId: args.goalId,
      visionSnapshot: args.visionSnapshot,
      successCriteria: args.successCriteria,
      sourceRefs: args.sourceRefs,
      status: "running",
      startedAt: now,
      metadata: {
        executionTraceOrigin: "mcp",
        ...(args.metadata && typeof args.metadata === "object" ? (args.metadata as Record<string, unknown>) : {}),
      },
    });

    return {
      sessionId,
      traceId,
      publicTraceId,
      status: "running",
    };
  },
});
