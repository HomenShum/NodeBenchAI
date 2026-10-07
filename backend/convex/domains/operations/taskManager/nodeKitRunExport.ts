import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import type { Id } from "../../../_generated/dataModel";
import {
  internalQuery,
  query,
  type QueryCtx,
} from "../../../_generated/server";
import {
  NODEKIT_RUN_EVENT_CONTRACT_VERSION,
  NODEKIT_RUN_MAX_EVENTS,
  NodeKitRunContractError,
  canonicalNodeKitJson,
  deepFreezeNodeKitValue,
  sha256CanonicalNodeKitValue,
  verifyNodeKitRunEventChain,
  type NodeKitRunEvent,
  type NodeKitSafeEventPayload,
} from "./nodeKitRunEvents";
import {
  buildNodeKitNativeSessionReference,
  type NodeKitNativeSessionReference,
} from "./nodeKitRuntimeIdentity";

export const NODEKIT_RUN_EXPORT_SCHEMA_VERSION =
  "nodekit.run-export/v1" as const;

class ConvexError<T extends Record<string, unknown>> extends Error {
  readonly data: T;

  constructor(data: T) {
    super(String(data.message ?? JSON.stringify(data)));
    this.name = "ConvexError";
    this.data = data;
    (this as Record<PropertyKey, unknown>)[Symbol.for("ConvexError")] = true;
  }
}

type SessionExport = Readonly<{
  id: string;
  typeAtRunStart: string;
  startedAt: number;
  nativeSessionReference?: NodeKitNativeSessionReference;
}>;

type TraceExport = Readonly<{
  id: string;
  runId: string;
  workflowName: string;
  status: "completed" | "error";
  startedAt: number;
  endedAt: number;
}>;

export type CanonicalNodeKitRunExport = Readonly<{
  schemaVersion: typeof NODEKIT_RUN_EXPORT_SCHEMA_VERSION;
  runId: string;
  session: SessionExport;
  trace: TraceExport;
  events: readonly NodeKitRunEvent[];
  completeness: Readonly<{
    eventChainComplete: true;
    spanLifecycleComplete: true;
    contractVersion: typeof NODEKIT_RUN_EVENT_CONTRACT_VERSION;
    eventCount: number;
    firstSequence: 0;
    lastSequence: number;
    terminalEventType: "run.completed" | "run.failed";
  }>;
  hashes: Readonly<{
    algorithm: "sha256";
    chainHead: string;
    exportHash: string;
  }>;
}>;

function fail(code: string, message: string): never {
  throw new NodeKitRunContractError(code, message);
}

function assertObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("shape_invalid", `${label} must be an object.`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  if (
    actual.length !== canonicalExpected.length ||
    actual.some((key, index) => key !== canonicalExpected[index])
  ) {
    fail(
      "shape_invalid",
      `${label} keys must be exactly ${canonicalExpected.join(", ")}.`,
    );
  }
}

function assertString(
  value: unknown,
  label: string,
  options: { nonEmpty?: boolean; maxLength?: number } = {},
): asserts value is string {
  if (
    typeof value !== "string" ||
    (options.nonEmpty && value.trim().length === 0) ||
    (options.maxLength !== undefined && value.length > options.maxLength)
  ) {
    fail("shape_invalid", `${label} must be a valid string.`);
  }
}

function assertTimestamp(
  value: unknown,
  label: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail("shape_invalid", `${label} must be a non-negative safe integer.`);
  }
}

function assertSessionExport(
  value: Record<string, unknown>,
): asserts value is Record<string, unknown> & SessionExport {
  assertExactKeys(
    value,
    [
      "id",
      "typeAtRunStart",
      "startedAt",
      ...("nativeSessionReference" in value ? ["nativeSessionReference"] : []),
    ],
    "session",
  );
  assertString(value.id, "session.id", { nonEmpty: true });
  assertString(value.typeAtRunStart, "session.typeAtRunStart", {
    nonEmpty: true,
    maxLength: 256,
  });
  assertTimestamp(value.startedAt, "session.startedAt");
  if ("nativeSessionReference" in value) {
    assertObject(
      value.nativeSessionReference,
      "session.nativeSessionReference",
    );
  }
}

function assertTraceExport(
  value: Record<string, unknown>,
): asserts value is Record<string, unknown> & TraceExport {
  assertExactKeys(
    value,
    ["id", "runId", "workflowName", "status", "startedAt", "endedAt"],
    "trace",
  );
  assertString(value.id, "trace.id", { nonEmpty: true });
  assertString(value.runId, "trace.runId", {
    nonEmpty: true,
    maxLength: 256,
  });
  assertString(value.workflowName, "trace.workflowName", { nonEmpty: true });
  if (value.status !== "completed" && value.status !== "error") {
    fail("run_not_terminal", "trace.status must be completed or error.");
  }
  assertTimestamp(value.startedAt, "trace.startedAt");
  assertTimestamp(value.endedAt, "trace.endedAt");
  if (value.endedAt < value.startedAt) {
    fail("shape_invalid", "trace.endedAt cannot precede startedAt.");
  }
}

function exportHashBody(
  exportDoc: Omit<CanonicalNodeKitRunExport, "hashes"> & {
    hashes: Omit<CanonicalNodeKitRunExport["hashes"], "exportHash">;
  },
) {
  return exportDoc;
}

function requiredStartField(
  startEvent: NodeKitRunEvent,
  field: string,
): string | number {
  const value = startEvent.payload.fields[field];
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "string" && value.trim().length === 0)
  ) {
    fail(
      "start_snapshot_missing",
      `run.started is missing the event-bound ${field} snapshot.`,
    );
  }
  return value;
}

export async function buildCanonicalNodeKitRunExport(input: {
  sessionId: string;
  traceId: string;
  events: readonly NodeKitRunEvent[];
}): Promise<CanonicalNodeKitRunExport> {
  assertString(input.sessionId, "sessionId", { nonEmpty: true });
  assertString(input.traceId, "traceId", { nonEmpty: true });
  const expectedRunId = input.events[0]?.runId;
  assertString(expectedRunId, "events[0].runId", {
    nonEmpty: true,
    maxLength: 256,
  });
  const chain = await verifyNodeKitRunEventChain(input.events, expectedRunId);
  const startEvent = input.events[0];
  const terminalEvent = input.events[input.events.length - 1];
  const workflowName = requiredStartField(startEvent, "workflowName");
  const sessionType = requiredStartField(startEvent, "sessionType");
  const sessionStartedAt = requiredStartField(startEvent, "sessionStartedAt");
  if (
    typeof workflowName !== "string" ||
    typeof sessionType !== "string" ||
    !Number.isSafeInteger(sessionStartedAt) ||
    (sessionStartedAt as number) < 0
  ) {
    fail(
      "start_snapshot_invalid",
      "run.started has an invalid event-bound session/trace snapshot.",
    );
  }
  const workspaceId = startEvent.payload.fields.workspaceId;
  const nativeSessionReference =
    workspaceId === undefined
      ? undefined
      : await buildNodeKitNativeSessionReference({
          workspaceId: String(workspaceId),
          sessionId: String(startEvent.payload.fields.sessionId),
          workspaceArtifactRef: String(
            startEvent.payload.fields.workspaceArtifactRef,
          ),
          workspaceArtifactDigest: String(
            startEvent.payload.fields.workspaceArtifactDigest,
          ),
          sessionArtifactRef: String(
            startEvent.payload.fields.sessionArtifactRef,
          ),
          sessionArtifactDigest: String(
            startEvent.payload.fields.sessionArtifactDigest,
          ),
          checkpointArtifactRef: String(
            startEvent.payload.fields.checkpointArtifactRef,
          ),
          checkpointArtifactDigest: String(
            startEvent.payload.fields.checkpointArtifactDigest,
          ),
        });
  if (
    nativeSessionReference !== undefined &&
    nativeSessionReference.referenceHash !==
      startEvent.payload.fields.nativeSessionReferenceHash
  ) {
    fail(
      "native_session_reference_hash_mismatch",
      "run.started native session fields do not match nativeSessionReferenceHash.",
    );
  }
  const session: SessionExport = {
    id: input.sessionId,
    typeAtRunStart: sessionType,
    startedAt: sessionStartedAt as number,
    ...(nativeSessionReference === undefined ? {} : { nativeSessionReference }),
  };
  const trace: TraceExport = {
    id: input.traceId,
    runId: expectedRunId,
    workflowName,
    status: chain.terminalEventType === "run.completed" ? "completed" : "error",
    startedAt: startEvent.recordedAt,
    endedAt: terminalEvent.recordedAt,
  };
  assertSessionExport(session);
  assertTraceExport(trace);
  if (session.startedAt > trace.startedAt) {
    fail(
      "start_snapshot_invalid",
      "Session start cannot follow the run.started event.",
    );
  }
  const withoutExportHash = {
    schemaVersion: NODEKIT_RUN_EXPORT_SCHEMA_VERSION,
    runId: trace.runId,
    session,
    trace,
    events: input.events,
    completeness: {
      eventChainComplete: true as const,
      spanLifecycleComplete: true as const,
      contractVersion: NODEKIT_RUN_EVENT_CONTRACT_VERSION,
      eventCount: chain.eventCount,
      firstSequence: 0 as const,
      lastSequence: chain.eventCount - 1,
      terminalEventType: chain.terminalEventType,
    },
    hashes: {
      algorithm: "sha256" as const,
      chainHead: chain.chainHead,
    },
  };
  const result: CanonicalNodeKitRunExport = {
    ...withoutExportHash,
    hashes: {
      ...withoutExportHash.hashes,
      exportHash: await sha256CanonicalNodeKitValue(
        exportHashBody(withoutExportHash),
      ),
    },
  };
  return deepFreezeNodeKitValue(result);
}

export async function assertNodeKitRunExport(
  value: unknown,
): Promise<CanonicalNodeKitRunExport> {
  assertObject(value, "NodeKit run export");
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "runId",
      "session",
      "trace",
      "events",
      "completeness",
      "hashes",
    ],
    "NodeKit run export",
  );
  if (value.schemaVersion !== NODEKIT_RUN_EXPORT_SCHEMA_VERSION) {
    fail("export_schema_mismatch", "Unsupported NodeKit run export schema.");
  }
  if (typeof value.runId !== "string" || !value.runId.trim()) {
    fail("run_id_invalid", "runId is required.");
  }
  assertObject(value.session, "session");
  assertObject(value.trace, "trace");
  assertObject(value.completeness, "completeness");
  assertObject(value.hashes, "hashes");
  assertSessionExport(value.session);
  assertTraceExport(value.trace);
  assertExactKeys(
    value.completeness,
    [
      "eventChainComplete",
      "spanLifecycleComplete",
      "contractVersion",
      "eventCount",
      "firstSequence",
      "lastSequence",
      "terminalEventType",
    ],
    "completeness",
  );
  assertExactKeys(
    value.hashes,
    ["algorithm", "chainHead", "exportHash"],
    "hashes",
  );
  if (!Array.isArray(value.events)) {
    fail("events_invalid", "events must be an array.");
  }
  if (value.trace.runId !== value.runId) {
    fail("run_id_mismatch", "Trace and export run IDs differ.");
  }
  const chain = await verifyNodeKitRunEventChain(
    value.events as NodeKitRunEvent[],
    value.runId,
  );
  const expectedTraceStatus =
    chain.terminalEventType === "run.completed" ? "completed" : "error";
  if (value.trace.status !== expectedTraceStatus) {
    fail(
      "terminal_status_mismatch",
      `Trace status ${value.trace.status} does not match ${chain.terminalEventType}.`,
    );
  }
  const startEvent = (value.events as NodeKitRunEvent[])[0];
  const terminalEvent = (value.events as NodeKitRunEvent[])[
    value.events.length - 1
  ];
  const workflowName = requiredStartField(startEvent, "workflowName");
  const sessionType = requiredStartField(startEvent, "sessionType");
  const sessionStartedAt = requiredStartField(startEvent, "sessionStartedAt");
  if (
    value.trace.workflowName !== workflowName ||
    value.trace.startedAt !== startEvent.recordedAt ||
    value.trace.endedAt !== terminalEvent.recordedAt ||
    value.session.typeAtRunStart !== sessionType ||
    value.session.startedAt !== sessionStartedAt ||
    value.session.startedAt > value.trace.startedAt
  ) {
    fail(
      "event_snapshot_mismatch",
      "Session or trace metadata differs from the immutable event snapshots.",
    );
  }
  const startWorkspaceId = startEvent.payload.fields.workspaceId;
  if (
    startWorkspaceId === undefined &&
    "nativeSessionReference" in value.session
  ) {
    fail(
      "native_session_reference_mismatch",
      "The export session cannot add a native session reference absent from run.started.",
    );
  }
  if (startWorkspaceId !== undefined) {
    const expectedReference = await buildNodeKitNativeSessionReference({
      workspaceId: String(startWorkspaceId),
      sessionId: String(startEvent.payload.fields.sessionId),
      workspaceArtifactRef: String(
        startEvent.payload.fields.workspaceArtifactRef,
      ),
      workspaceArtifactDigest: String(
        startEvent.payload.fields.workspaceArtifactDigest,
      ),
      sessionArtifactRef: String(startEvent.payload.fields.sessionArtifactRef),
      sessionArtifactDigest: String(
        startEvent.payload.fields.sessionArtifactDigest,
      ),
      checkpointArtifactRef: String(
        startEvent.payload.fields.checkpointArtifactRef,
      ),
      checkpointArtifactDigest: String(
        startEvent.payload.fields.checkpointArtifactDigest,
      ),
    });
    if (
      !("nativeSessionReference" in value.session) ||
      canonicalNodeKitJson(value.session.nativeSessionReference) !==
        canonicalNodeKitJson(expectedReference)
    ) {
      fail(
        "native_session_reference_mismatch",
        "The export session reference differs from run.started.",
      );
    }
  }
  if (
    value.completeness.eventChainComplete !== true ||
    value.completeness.spanLifecycleComplete !== true ||
    value.completeness.contractVersion !== NODEKIT_RUN_EVENT_CONTRACT_VERSION ||
    value.completeness.eventCount !== chain.eventCount ||
    value.completeness.firstSequence !== 0 ||
    value.completeness.lastSequence !== chain.eventCount - 1 ||
    value.completeness.terminalEventType !== chain.terminalEventType
  ) {
    fail(
      "completeness_mismatch",
      "Completeness receipt does not match the verified event chain.",
    );
  }
  if (
    value.hashes.algorithm !== "sha256" ||
    value.hashes.chainHead !== chain.chainHead
  ) {
    fail("chain_head_mismatch", "Export chain head does not match its events.");
  }

  const expectedExportHash = await sha256CanonicalNodeKitValue({
    schemaVersion: value.schemaVersion,
    runId: value.runId,
    session: value.session,
    trace: value.trace,
    events: value.events,
    completeness: value.completeness,
    hashes: {
      algorithm: value.hashes.algorithm,
      chainHead: value.hashes.chainHead,
    },
  });
  if (value.hashes.exportHash !== expectedExportHash) {
    fail(
      "export_hash_mismatch",
      "Run export content does not match exportHash.",
    );
  }
  return deepFreezeNodeKitValue(value as CanonicalNodeKitRunExport);
}

async function requireOwnerId(ctx: unknown): Promise<Id<"users">> {
  const raw = await getAuthUserId(ctx as never);
  if (!raw) fail("not_authenticated", "Authentication is required.");
  const normalized =
    typeof raw === "string" && raw.includes("|") ? raw.split("|")[0] : raw;
  if (!normalized) fail("not_authenticated", "Authentication is required.");
  return normalized as Id<"users">;
}

function throwConvexBoundaryError(error: unknown): never {
  if (error instanceof NodeKitRunContractError) {
    throw new ConvexError({
      code: error.code,
      message: error.message.slice(error.message.indexOf(":") + 1).trim(),
    });
  }
  throw error;
}

async function exportNodeKitRunForOwner(
  ctx: Pick<QueryCtx, "db">,
  traceId: Id<"agentTaskTraces">,
  ownerId: Id<"users">,
): Promise<CanonicalNodeKitRunExport> {
  const trace = await ctx.db.get(traceId);
  if (!trace) fail("trace_not_found", "Trace not found or unauthorized.");
  const session = await ctx.db.get(trace.sessionId);
  if (!session || session.userId !== ownerId) {
    fail("trace_not_found", "Trace not found or unauthorized.");
  }
  if (trace.status === "running") {
    fail("run_not_terminal", "A running trace cannot be exported.");
  }
  const storedEvents = await ctx.db
    .query("nodeKitRunEvents")
    .withIndex("by_trace_sequence", (q) => q.eq("traceId", traceId))
    .order("asc")
    .take(NODEKIT_RUN_MAX_EVENTS + 1);
  if (storedEvents.length === 0) {
    fail(
      "run_history_unavailable",
      "Canonical run history is unavailable because it is legacy, expired, or deleted.",
    );
  }
  if (storedEvents.length > NODEKIT_RUN_MAX_EVENTS) {
    fail(
      "event_limit_exceeded",
      `Run exceeds the ${NODEKIT_RUN_MAX_EVENTS}-event export bound.`,
    );
  }
  if (
    storedEvents.some(
      (event) =>
        event.userId !== ownerId ||
        event.sessionId !== session._id ||
        event.runId !== trace.traceId,
    )
  ) {
    fail(
      "event_ownership_mismatch",
      "Stored event ownership does not match the trace.",
    );
  }

  const exportDoc = await buildCanonicalNodeKitRunExport({
    sessionId: String(session._id),
    traceId: String(trace._id),
    events: storedEvents.map((event) => ({
      contractVersion: event.contractVersion,
      runId: event.runId,
      sequence: event.sequence,
      eventType: event.eventType,
      recordedAt: event.recordedAt,
      payload: event.payload as NodeKitSafeEventPayload,
      previousHash: event.previousHash,
      contentHash: event.contentHash,
    })),
  });
  if (trace.status !== exportDoc.trace.status) {
    fail(
      "trace_state_mismatch",
      "Stored trace status differs from the terminal event snapshot.",
    );
  }
  return exportDoc;
}

export const exportNodeKitRun = query({
  args: {
    traceId: v.id("agentTaskTraces"),
  },
  handler: async (ctx, args) => {
    try {
      const ownerId = await requireOwnerId(ctx);
      return await exportNodeKitRunForOwner(ctx, args.traceId, ownerId);
    } catch (error) {
      throwConvexBoundaryError(error);
    }
  },
});

// Secret-gated callers receive their owner from the MCP dispatcher. The public
// API never accepts a caller-controlled owner identifier.
export const mcpExportNodeKitRun = internalQuery({
  args: {
    userId: v.string(),
    traceId: v.id("agentTaskTraces"),
  },
  handler: async (ctx, args) => {
    try {
      return await exportNodeKitRunForOwner(
        ctx,
        args.traceId,
        args.userId as Id<"users">,
      );
    } catch (error) {
      throwConvexBoundaryError(error);
    }
  },
});
