import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { appendNodeKitRunEvent } from "../operations/taskManager/nodeKitRunEvents";
import {
  NODEKIT_NATIVE_AGENT_SESSION_IDENTITY_VERSION,
  buildNodeKitNativeIdentityRef,
  buildNodeKitNativeSessionIdentity,
  compareNodeKitNativeSessionIdentity,
  type NodeKitNativeSessionIdentity,
  type NodeKitNativeSessionIdentityInput,
  validateNodeKitNativeSessionIdentityInput,
} from "../operations/taskManager/nodeKitRuntimeIdentity";

const oracleSourceRefValidator = v.object({
  label: v.string(),
  href: v.optional(v.string()),
  note: v.optional(v.string()),
  kind: v.optional(v.string()),
});

const nativeIdentityInputValidator = v.object({
  agentId: v.string(),
  workspaceId: v.string(),
  nativeSessionId: v.string(),
  nativeSessionGeneration: v.number(),
  peerId: v.optional(v.string()),
});

const nativeIdentitySnapshotValidator = v.object({
  schemaVersion: v.literal(NODEKIT_NATIVE_AGENT_SESSION_IDENTITY_VERSION),
  identityRef: v.string(),
  agentId: v.string(),
  workspaceId: v.string(),
  nativeSessionId: v.string(),
  nativeSessionGeneration: v.number(),
  peerId: v.optional(v.string()),
  snapshotHash: v.string(),
});

async function resolveNativeIdentity(
  ctx: MutationCtx,
  userId: Id<"users">,
  input: NodeKitNativeSessionIdentityInput,
): Promise<{
  snapshot: NodeKitNativeSessionIdentity;
  continuity: "created" | "reconnect" | "rotate";
}> {
  validateNodeKitNativeSessionIdentityInput(input);
  const existing = await ctx.db
    .query("agentIdentities")
    .withIndex("by_owner_workspace_agent", (q) =>
      q
        .eq("ownerUserId", userId)
        .eq("workspaceId", input.workspaceId)
        .eq("agentId", input.agentId),
    )
    .first();
  const now = Date.now();
  const identityId =
    existing?._id ??
    (await ctx.db.insert("agentIdentities", {
      agentId: input.agentId,
      ownerUserId: userId,
      workspaceId: input.workspaceId,
      identityContractVersion: NODEKIT_NATIVE_AGENT_SESSION_IDENTITY_VERSION,
      name: input.agentId,
      persona: "Native NodeKit execution agent",
      allowedTools: [],
      allowedChannels: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    }));
  if (existing && existing.status !== "active") {
    throw new Error(`Native agent identity is ${existing.status}.`);
  }

  const identityRef = await buildNodeKitNativeIdentityRef(String(identityId));
  const snapshot = await buildNodeKitNativeSessionIdentity({
    identityRef,
    ...input,
  });
  let continuity: "created" | "reconnect" | "rotate" = "created";
  if (existing) {
    if (
      existing.identityContractVersion !==
        NODEKIT_NATIVE_AGENT_SESSION_IDENTITY_VERSION ||
      existing.nativeSessionId === undefined ||
      existing.nativeSessionGeneration === undefined
    ) {
      throw new Error(
        "Native agent identity has incomplete persisted session state.",
      );
    }
    const previous = await buildNodeKitNativeSessionIdentity({
      identityRef,
      agentId: existing.agentId,
      workspaceId: existing.workspaceId ?? "",
      nativeSessionId: existing.nativeSessionId,
      nativeSessionGeneration: existing.nativeSessionGeneration,
      peerId: existing.nativePeerId,
    });
    continuity = compareNodeKitNativeSessionIdentity(previous, snapshot);
  }

  await ctx.db.patch(identityId, {
    identityContractVersion: NODEKIT_NATIVE_AGENT_SESSION_IDENTITY_VERSION,
    nativeSessionId: snapshot.nativeSessionId,
    nativeSessionGeneration: snapshot.nativeSessionGeneration,
    nativePeerId: snapshot.peerId,
    nativeIdentitySnapshotHash: snapshot.snapshotHash,
    lastSeenAt: now,
    updatedAt: now,
  });
  return { snapshot, continuity };
}

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
    nativeIdentity: v.optional(nativeIdentityInputValidator),
    metadata: v.optional(v.any()),
  },
  returns: v.object({
    sessionId: v.id("agentTaskSessions"),
    traceId: v.id("agentTaskTraces"),
    publicTraceId: v.string(),
    status: v.string(),
    nativeIdentity: v.optional(nativeIdentitySnapshotValidator),
    nativeIdentityContinuity: v.optional(
      v.union(
        v.literal("created"),
        v.literal("reconnect"),
        v.literal("rotate"),
      ),
    ),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const resolvedIdentity =
      args.nativeIdentity === undefined
        ? undefined
        : await resolveNativeIdentity(
            ctx,
            args.userId as Id<"users">,
            args.nativeIdentity,
          );
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
      nativeIdentity: resolvedIdentity?.snapshot,
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
      nativeIdentity: resolvedIdentity?.snapshot,
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
        ...(resolvedIdentity === undefined
          ? {}
          : {
              identityRef: resolvedIdentity.snapshot.identityRef,
              workspaceId: resolvedIdentity.snapshot.workspaceId,
              agentId: resolvedIdentity.snapshot.agentId,
              nativeSessionId: resolvedIdentity.snapshot.nativeSessionId,
              nativeSessionGeneration:
                resolvedIdentity.snapshot.nativeSessionGeneration,
              ...(resolvedIdentity.snapshot.peerId === undefined
                ? {}
                : { peerId: resolvedIdentity.snapshot.peerId }),
              identitySnapshotHash: resolvedIdentity.snapshot.snapshotHash,
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
      nativeIdentity: resolvedIdentity?.snapshot,
      nativeIdentityContinuity: resolvedIdentity?.continuity,
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
