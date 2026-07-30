import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { appendNodeKitRunEvent } from "../operations/taskManager/nodeKitRunEvents";
import {
  NODEKIT_NATIVE_SESSION_REFERENCE_VERSION,
  buildNodeKitNativeSessionReference,
} from "../operations/taskManager/nodeKitRuntimeIdentity";

const oracleSourceRefValidator = v.object({
  label: v.string(),
  href: v.optional(v.string()),
  note: v.optional(v.string()),
  kind: v.optional(v.string()),
});

const nativeSessionReferenceInputValidator = v.object({
  workspaceId: v.string(),
  sessionId: v.string(),
  workspaceArtifactRef: v.string(),
  workspaceArtifactDigest: v.string(),
  sessionArtifactRef: v.string(),
  sessionArtifactDigest: v.string(),
  checkpointArtifactRef: v.string(),
  checkpointArtifactDigest: v.string(),
});

const nativeSessionReferenceValidator = v.object({
  schemaVersion: v.literal(NODEKIT_NATIVE_SESSION_REFERENCE_VERSION),
  workspaceId: v.string(),
  sessionId: v.string(),
  workspaceArtifactRef: v.string(),
  workspaceArtifactDigest: v.string(),
  sessionArtifactRef: v.string(),
  sessionArtifactDigest: v.string(),
  checkpointArtifactRef: v.string(),
  checkpointArtifactDigest: v.string(),
  referenceHash: v.string(),
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
    nativeSessionReference: v.optional(nativeSessionReferenceInputValidator),
    metadata: v.optional(v.any()),
  },
  returns: v.object({
    sessionId: v.id("agentTaskSessions"),
    traceId: v.id("agentTaskTraces"),
    publicTraceId: v.string(),
    status: v.string(),
    nativeSessionReference: v.optional(nativeSessionReferenceValidator),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const nativeSessionReference =
      args.nativeSessionReference === undefined
        ? undefined
        : await buildNodeKitNativeSessionReference(args.nativeSessionReference);
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
      nativeSessionReference,
      metadata: {
        executionTraceOrigin: "mcp",
        ...(args.metadata && typeof args.metadata === "object"
          ? (args.metadata as Record<string, unknown>)
          : {}),
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
      nativeSessionReference,
      status: "running",
      startedAt: now,
      metadata: {
        executionTraceOrigin: "mcp",
        ...(args.metadata && typeof args.metadata === "object"
          ? (args.metadata as Record<string, unknown>)
          : {}),
      },
    });

    await appendNodeKitRunEvent(ctx, {
      sessionId,
      traceId,
      userId: args.userId as Id<"users">,
      runId: publicTraceId,
      eventType: "run.started",
      recordedAt: now,
      payload: {
        workflowName: args.workflowName,
        origin: "mcp",
        sessionType: args.type ?? "agent",
        sessionStartedAt: now,
        ...(nativeSessionReference === undefined
          ? {}
          : {
              workspaceId: nativeSessionReference.workspaceId,
              sessionId: nativeSessionReference.sessionId,
              workspaceArtifactRef: nativeSessionReference.workspaceArtifactRef,
              workspaceArtifactDigest:
                nativeSessionReference.workspaceArtifactDigest,
              sessionArtifactRef: nativeSessionReference.sessionArtifactRef,
              sessionArtifactDigest:
                nativeSessionReference.sessionArtifactDigest,
              checkpointArtifactRef:
                nativeSessionReference.checkpointArtifactRef,
              checkpointArtifactDigest:
                nativeSessionReference.checkpointArtifactDigest,
              nativeSessionReferenceHash: nativeSessionReference.referenceHash,
            }),
        ...(args.goalId === undefined ? {} : { goalId: args.goalId }),
      },
      allowLegacySkip: false,
    });

    return {
      sessionId,
      traceId,
      publicTraceId,
      status: "running",
      nativeSessionReference,
    };
  },
});

const executionGraphEventTypeValidator = v.union(
  v.literal("node.started"),
  v.literal("edge.consumed"),
  v.literal("artifact.produced"),
  v.literal("node.completed"),
  v.literal("node.failed"),
  v.literal("barrier.opened"),
  v.literal("barrier.blocked"),
);

export const recordExecutionGraphEvent = internalMutation({
  args: {
    userId: v.string(),
    traceId: v.id("agentTaskTraces"),
    eventType: executionGraphEventTypeValidator,
    graphId: v.string(),
    graphHash: v.string(),
    caseId: v.string(),
    stageId: v.string(),
    caseContentHash: v.string(),
    nodeId: v.string(),
    nodeRunId: v.string(),
    nodeKind: v.optional(v.string()),
    frontierHash: v.optional(v.string()),
    edgeId: v.optional(v.string()),
    bindingId: v.optional(v.string()),
    bindingHash: v.optional(v.string()),
    artifactId: v.optional(v.string()),
    artifactSchemaVersion: v.optional(v.string()),
    artifactContentHash: v.optional(v.string()),
    authorityKind: v.optional(v.string()),
    status: v.optional(v.string()),
    reasonCode: v.optional(v.string()),
    blockingEdgeCount: v.optional(v.number()),
    reviewContextRef: v.optional(v.string()),
    reviewSeparation: v.optional(v.string()),
    protectedEvaluator: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const trace = await ctx.db.get(args.traceId);
    if (!trace) throw new Error("Execution trace not found.");
    const session = await ctx.db.get(trace.sessionId);
    if (!session || String(session.userId) !== args.userId) {
      throw new Error("Execution trace is not owned by the service user.");
    }
    if (trace.status !== "running") {
      throw new Error(`Execution trace is already ${trace.status}.`);
    }

    const {
      userId: _userId,
      traceId: _traceId,
      eventType,
      ...candidate
    } = args;
    const payload = Object.fromEntries(
      Object.entries(candidate).filter(([, value]) => value !== undefined),
    );
    const event = await appendNodeKitRunEvent(ctx, {
      sessionId: session._id,
      traceId: trace._id,
      userId: session.userId as Id<"users">,
      runId: trace.traceId,
      eventType,
      recordedAt: Date.now(),
      payload,
      allowLegacySkip: false,
    });
    if (!event) throw new Error("Graph event was not stored.");
    return event.contentHash;
  },
});
