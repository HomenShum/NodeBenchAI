import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

export const NODEKIT_RUN_EVENT_CONTRACT_VERSION =
  "nodekit.run-event/v1" as const;
export const NODEKIT_SAFE_EVENT_PAYLOAD_VERSION =
  "nodekit.safe-event-payload/v1" as const;
export const NODEKIT_RUN_GENESIS_HASH = `sha256:${"0".repeat(64)}` as const;
export const NODEKIT_RUN_MAX_EVENTS = 256;
export const NODEKIT_RUN_MAX_REDACTED_SOURCE_BYTES = 32 * 1024;
export const NODEKIT_RUN_MAX_STORED_PAYLOAD_BYTES = 2 * 1024;
export const NODEKIT_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const NODEKIT_RUN_EVENT_TYPES = [
  "run.started",
  "span.started",
  "span.completed",
  "step.recorded",
  "decision.recorded",
  "verification.recorded",
  "evidence.attached",
  "approval.requested",
  "node.started",
  "edge.consumed",
  "artifact.produced",
  "node.completed",
  "node.failed",
  "barrier.opened",
  "barrier.blocked",
  "run.completed",
  "run.failed",
] as const;

export type NodeKitRunEventType = (typeof NODEKIT_RUN_EVENT_TYPES)[number];

export type NodeKitSafeEventPayload = Readonly<{
  projectionVersion: typeof NODEKIT_SAFE_EVENT_PAYLOAD_VERSION;
  sourceDigest: string;
  sourceBytes: number;
  fields: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type NodeKitRunEvent = Readonly<{
  contractVersion: typeof NODEKIT_RUN_EVENT_CONTRACT_VERSION;
  runId: string;
  sequence: number;
  eventType: NodeKitRunEventType;
  recordedAt: number;
  payload: NodeKitSafeEventPayload;
  previousHash: string;
  contentHash: string;
}>;

export class NodeKitRunContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "NodeKitRunContractError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new NodeKitRunContractError(code, message);
}

const SENSITIVE_KEY_PATTERN =
  /(?:authorization|cookie|credential|password|passphrase|secret|token|api.?key|private.?key|client.?secret)/i;

const SAFE_FIELDS_BY_EVENT: Readonly<
  Record<NodeKitRunEventType, readonly string[]>
> = {
  "run.started": [
    "workflowName",
    "origin",
    "groupId",
    "model",
    "goalId",
    "sessionType",
    "sessionStartedAt",
    "workspaceId",
    "sessionId",
    "workspaceArtifactRef",
    "workspaceArtifactDigest",
    "sessionArtifactRef",
    "sessionArtifactDigest",
    "checkpointArtifactRef",
    "checkpointArtifactDigest",
    "nativeSessionReferenceHash",
  ],
  "span.started": [
    "spanId",
    "parentSpanId",
    "spanSequence",
    "depth",
    "spanType",
  ],
  "span.completed": ["spanId", "spanSequence", "status", "durationMs"],
  "step.recorded": [
    "spanId",
    "parentSpanId",
    "spanSequence",
    "stage",
    "type",
    "tool",
    "durationMs",
  ],
  "decision.recorded": ["decisionType", "confidence"],
  "verification.recorded": ["status"],
  "evidence.attached": [],
  "approval.requested": ["approvalId", "toolName", "riskLevel"],
  "node.started": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "nodeKind",
    "frontierHash",
    "reviewContextRef",
  ],
  "edge.consumed": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "edgeId",
    "bindingId",
    "bindingHash",
    "artifactId",
    "artifactSchemaVersion",
    "artifactContentHash",
    "authorityKind",
  ],
  "artifact.produced": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "artifactId",
    "artifactSchemaVersion",
    "artifactContentHash",
    "authorityKind",
  ],
  "node.completed": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "status",
    "reviewContextRef",
    "reviewSeparation",
    "protectedEvaluator",
  ],
  "node.failed": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "status",
    "reasonCode",
  ],
  "barrier.opened": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "frontierHash",
    "status",
  ],
  "barrier.blocked": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "frontierHash",
    "status",
    "reasonCode",
    "blockingEdgeCount",
  ],
  "run.completed": [
    "status",
    "totalDurationMs",
    "crossCheckStatus",
    "dogfoodRunId",
  ],
  "run.failed": [
    "status",
    "totalDurationMs",
    "crossCheckStatus",
    "dogfoodRunId",
  ],
};

const REQUIRED_FIELDS_BY_EVENT: Partial<
  Record<NodeKitRunEventType, readonly string[]>
> = {
  "run.started": ["workflowName", "sessionType", "sessionStartedAt"],
  "span.started": ["spanId"],
  "span.completed": ["spanId"],
  "node.started": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
  ],
  "edge.consumed": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "edgeId",
    "bindingId",
    "bindingHash",
    "artifactId",
    "artifactSchemaVersion",
    "artifactContentHash",
    "authorityKind",
  ],
  "artifact.produced": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "artifactId",
    "artifactSchemaVersion",
    "artifactContentHash",
    "authorityKind",
  ],
  "node.completed": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "status",
  ],
  "node.failed": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "status",
  ],
  "barrier.opened": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "frontierHash",
  ],
  "barrier.blocked": [
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "frontierHash",
  ],
  "run.completed": ["status"],
  "run.failed": ["status"],
};

function assertTerminalPayloadStatus(
  eventType: NodeKitRunEventType,
  fields: Readonly<Record<string, unknown>>,
  label: string,
): void {
  const expectedStatus =
    eventType === "run.completed"
      ? "completed"
      : eventType === "run.failed"
        ? "error"
        : undefined;
  if (expectedStatus !== undefined && fields.status !== expectedStatus) {
    fail(
      "terminal_status_mismatch",
      `${label} requires status ${expectedStatus}.`,
    );
  }
}

const GRAPH_EVENT_TYPES = new Set<NodeKitRunEventType>([
  "node.started",
  "edge.consumed",
  "artifact.produced",
  "node.completed",
  "node.failed",
  "barrier.opened",
  "barrier.blocked",
]);

function assertRawSha256(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    fail("graph_hash_invalid", `${field} must be a lowercase SHA-256 digest.`);
  }
}

function assertGraphPayloadFields(
  eventType: NodeKitRunEventType,
  fields: Readonly<Record<string, unknown>>,
  label: string,
): void {
  if (eventType === "run.started") {
    const referenceFields = [
      "workspaceId",
      "sessionId",
      "workspaceArtifactRef",
      "workspaceArtifactDigest",
      "sessionArtifactRef",
      "sessionArtifactDigest",
      "checkpointArtifactRef",
      "checkpointArtifactDigest",
      "nativeSessionReferenceHash",
    ] as const;
    const presentCount = referenceFields.filter(
      (field) => field in fields,
    ).length;
    if (presentCount !== 0 && presentCount !== referenceFields.length) {
      fail(
        "native_session_reference_incomplete",
        `${label} must bind the complete native session artifact reference.`,
      );
    }
    if (presentCount === referenceFields.length) {
      for (const field of [
        "workspaceArtifactDigest",
        "sessionArtifactDigest",
        "checkpointArtifactDigest",
      ] as const) {
        assertRawSha256(fields[field], `${label}.${field}`);
      }
      assertHash(
        String(fields.nativeSessionReferenceHash),
        `${label}.nativeSessionReferenceHash`,
      );
    }
    return;
  }
  if (!GRAPH_EVENT_TYPES.has(eventType)) return;

  if (
    typeof fields.graphId !== "string" ||
    !/^execution-graph:sha256:[a-f0-9]{64}$/.test(fields.graphId)
  ) {
    fail(
      "graph_id_invalid",
      `${label}.graphId is not a NodeKit execution graph ID.`,
    );
  }
  assertRawSha256(fields.graphHash, `${label}.graphHash`);
  assertRawSha256(fields.caseContentHash, `${label}.caseContentHash`);
  if ("frontierHash" in fields) {
    assertRawSha256(fields.frontierHash, `${label}.frontierHash`);
  }
  if ("bindingHash" in fields) {
    assertRawSha256(fields.bindingHash, `${label}.bindingHash`);
  }
  if ("artifactContentHash" in fields) {
    assertRawSha256(fields.artifactContentHash, `${label}.artifactContentHash`);
  }
  if (
    "bindingId" in fields &&
    (typeof fields.bindingId !== "string" ||
      !/^execution-edge-binding:sha256:[a-f0-9]{64}$/.test(fields.bindingId))
  ) {
    fail(
      "edge_binding_id_invalid",
      `${label}.bindingId is not a NodeKit execution edge binding ID.`,
    );
  }
  if (
    "authorityKind" in fields &&
    ![
      "agent-produced",
      "deterministic",
      "human-attested",
      "nodeproof-verified",
    ].includes(String(fields.authorityKind))
  ) {
    fail("authority_kind_invalid", `${label}.authorityKind is unsupported.`);
  }
  if (
    eventType === "node.started" &&
    "nodeKind" in fields &&
    !["task", "review", "barrier"].includes(String(fields.nodeKind))
  ) {
    fail("node_kind_invalid", `${label}.nodeKind is unsupported.`);
  }
  if (eventType === "node.completed" && fields.status !== "completed") {
    fail("graph_status_mismatch", `${label} requires status completed.`);
  }
  if (
    eventType === "node.failed" &&
    !["failed", "error"].includes(String(fields.status))
  ) {
    fail("graph_status_mismatch", `${label} requires a failure status.`);
  }
  if (
    eventType === "barrier.opened" &&
    "status" in fields &&
    fields.status !== "opened"
  ) {
    fail("graph_status_mismatch", `${label} requires status opened.`);
  }
  if (
    eventType === "barrier.blocked" &&
    "status" in fields &&
    fields.status !== "blocked"
  ) {
    fail("graph_status_mismatch", `${label} requires status blocked.`);
  }
  if (
    "reviewSeparation" in fields &&
    ![
      "same-context",
      "fresh-context",
      "independent-model",
      "independent-human",
    ].includes(String(fields.reviewSeparation))
  ) {
    fail(
      "review_separation_invalid",
      `${label}.reviewSeparation is unsupported.`,
    );
  }
}

function normalizeCanonicalValue(
  input: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean"
  ) {
    return input;
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      fail("non_finite_number", "Canonical JSON numbers must be finite.");
    }
    return input;
  }
  if (typeof input !== "object") {
    fail(
      "non_json_value",
      `Canonical JSON cannot encode values of type ${typeof input}.`,
    );
  }
  if (seen.has(input)) {
    fail("cyclic_value", "Canonical JSON values must be acyclic.");
  }
  seen.add(input);
  if (Array.isArray(input)) {
    const result = input.map((value) => normalizeCanonicalValue(value, seen));
    seen.delete(input);
    return result;
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("non_plain_object", "Canonical JSON objects must be plain objects.");
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(input as Record<string, unknown>).sort()) {
    if ((input as Record<string, unknown>)[key] === undefined) continue;
    result[key] = normalizeCanonicalValue(
      (input as Record<string, unknown>)[key],
      seen,
    );
  }
  seen.delete(input);
  return result;
}

export function canonicalNodeKitJson(value: unknown): string {
  return JSON.stringify(normalizeCanonicalValue(value));
}

export async function sha256CanonicalNodeKitValue(
  value: unknown,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalNodeKitJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function redactSensitiveNodeKitValue(
  input: unknown,
  key: string | undefined,
  seen = new WeakSet<object>(),
): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean" ||
    typeof input === "number"
  ) {
    return normalizeCanonicalValue(input);
  }
  if (typeof input !== "object") {
    return normalizeCanonicalValue(input);
  }
  if (seen.has(input)) {
    fail("cyclic_value", "Event payloads must be acyclic.");
  }
  seen.add(input);
  if (Array.isArray(input)) {
    const result = input.map((value) =>
      redactSensitiveNodeKitValue(value, undefined, seen),
    );
    seen.delete(input);
    return result;
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("non_plain_object", "Event payloads must be plain JSON objects.");
  }
  const result: Record<string, unknown> = {};
  for (const childKey of Object.keys(input as Record<string, unknown>).sort()) {
    const child = (input as Record<string, unknown>)[childKey];
    if (child === undefined) continue;
    result[childKey] = redactSensitiveNodeKitValue(child, childKey, seen);
  }
  seen.delete(input);
  return result;
}

function safeScalar(
  value: unknown,
  field: string,
): string | number | boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 256) {
      fail(
        "payload_field_too_large",
        `Safe event field ${field} exceeds 256 characters.`,
      );
    }
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

export async function projectNodeKitRunEventPayload(
  eventType: NodeKitRunEventType,
  sourcePayload: unknown,
): Promise<NodeKitSafeEventPayload> {
  const redacted = redactSensitiveNodeKitValue(sourcePayload, undefined);
  const redactedJson = canonicalNodeKitJson(redacted);
  const sourceBytes = new TextEncoder().encode(redactedJson).byteLength;
  if (sourceBytes > NODEKIT_RUN_MAX_REDACTED_SOURCE_BYTES) {
    fail(
      "payload_too_large",
      `Redacted event payload exceeds ${NODEKIT_RUN_MAX_REDACTED_SOURCE_BYTES} bytes.`,
    );
  }

  const fields: Record<string, string | number | boolean | null> = {};
  if (
    sourcePayload &&
    typeof sourcePayload === "object" &&
    !Array.isArray(sourcePayload)
  ) {
    const record = sourcePayload as Record<string, unknown>;
    for (const field of SAFE_FIELDS_BY_EVENT[eventType]) {
      const value = safeScalar(record[field], field);
      if (value !== undefined) fields[field] = value;
    }
  }
  for (const required of REQUIRED_FIELDS_BY_EVENT[eventType] ?? []) {
    if (!(required in fields)) {
      fail(
        "payload_field_missing",
        `${eventType} requires the safe field ${required}.`,
      );
    }
  }
  assertTerminalPayloadStatus(eventType, fields, eventType);
  assertGraphPayloadFields(eventType, fields, eventType);

  const projection: NodeKitSafeEventPayload = {
    projectionVersion: NODEKIT_SAFE_EVENT_PAYLOAD_VERSION,
    sourceDigest: await sha256CanonicalNodeKitValue(redacted),
    sourceBytes,
    fields,
  };
  const storedBytes = new TextEncoder().encode(
    canonicalNodeKitJson(projection),
  ).byteLength;
  if (storedBytes > NODEKIT_RUN_MAX_STORED_PAYLOAD_BYTES) {
    fail(
      "projected_payload_too_large",
      `Projected event payload exceeds ${NODEKIT_RUN_MAX_STORED_PAYLOAD_BYTES} bytes.`,
    );
  }
  return deepFreezeNodeKitValue(projection);
}

export function deepFreezeNodeKitValue<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeNodeKitValue(child);
  }
  return Object.freeze(value);
}

function assertHash(value: string, field: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) {
    fail("hash_invalid", `${field} must be a lowercase sha256: digest.`);
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

function assertSafeEventPayload(
  value: unknown,
  eventType: NodeKitRunEventType,
  index: number,
): asserts value is NodeKitSafeEventPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("payload_shape_invalid", `Event ${index} payload must be an object.`);
  }
  const payload = value as Record<string, unknown>;
  assertExactKeys(
    payload,
    ["projectionVersion", "sourceDigest", "sourceBytes", "fields"],
    `Event ${index} payload`,
  );
  if (payload.projectionVersion !== NODEKIT_SAFE_EVENT_PAYLOAD_VERSION) {
    fail(
      "payload_version_mismatch",
      `Event ${index} has an unsupported safe-payload version.`,
    );
  }
  assertHash(
    String(payload.sourceDigest),
    `events[${index}].payload.sourceDigest`,
  );
  if (
    !Number.isSafeInteger(payload.sourceBytes) ||
    (payload.sourceBytes as number) < 0 ||
    (payload.sourceBytes as number) > NODEKIT_RUN_MAX_REDACTED_SOURCE_BYTES
  ) {
    fail(
      "payload_size_invalid",
      `Event ${index} sourceBytes exceeds the contract bound.`,
    );
  }
  if (
    !payload.fields ||
    typeof payload.fields !== "object" ||
    Array.isArray(payload.fields)
  ) {
    fail(
      "payload_shape_invalid",
      `Event ${index} payload.fields must be an object.`,
    );
  }
  const fields = payload.fields as Record<string, unknown>;
  const allowed = new Set(SAFE_FIELDS_BY_EVENT[eventType]);
  for (const [field, fieldValue] of Object.entries(fields)) {
    if (!allowed.has(field)) {
      fail(
        "payload_field_invalid",
        `Event ${index} contains unsupported safe field ${field}.`,
      );
    }
    if (
      fieldValue !== null &&
      typeof fieldValue !== "string" &&
      typeof fieldValue !== "number" &&
      typeof fieldValue !== "boolean"
    ) {
      fail(
        "payload_field_invalid",
        `Event ${index} safe field ${field} must be scalar.`,
      );
    }
    if (
      (typeof fieldValue === "string" && fieldValue.length > 256) ||
      (typeof fieldValue === "number" && !Number.isFinite(fieldValue))
    ) {
      fail(
        "payload_field_invalid",
        `Event ${index} safe field ${field} exceeds its bound.`,
      );
    }
  }
  for (const required of REQUIRED_FIELDS_BY_EVENT[eventType] ?? []) {
    if (!(required in fields)) {
      fail(
        "payload_field_missing",
        `Event ${index} requires safe field ${required}.`,
      );
    }
  }
  assertTerminalPayloadStatus(eventType, fields, `Event ${index}`);
  assertGraphPayloadFields(eventType, fields, `Event ${index}`);
  if (
    new TextEncoder().encode(canonicalNodeKitJson(payload)).byteLength >
    NODEKIT_RUN_MAX_STORED_PAYLOAD_BYTES
  ) {
    fail(
      "projected_payload_too_large",
      `Event ${index} payload exceeds the stored-size bound.`,
    );
  }
}

function assertEventShape(
  value: unknown,
  expectedRunId: string,
  index: number,
): asserts value is NodeKitRunEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("event_invalid", `Event ${index} must be an object.`);
  }
  const event = value as Record<string, unknown>;
  assertExactKeys(
    event,
    [
      "contractVersion",
      "runId",
      "sequence",
      "eventType",
      "recordedAt",
      "payload",
      "previousHash",
      "contentHash",
    ],
    `Event ${index}`,
  );
  if (event.contractVersion !== NODEKIT_RUN_EVENT_CONTRACT_VERSION) {
    fail(
      "contract_version_mismatch",
      `Event ${index} has an unsupported contract.`,
    );
  }
  if (event.runId !== expectedRunId) {
    fail("run_id_mismatch", `Event ${index} belongs to another run.`);
  }
  if (!Number.isSafeInteger(event.sequence) || (event.sequence as number) < 0) {
    fail("sequence_invalid", `Event ${index} has an invalid sequence.`);
  }
  if (
    !NODEKIT_RUN_EVENT_TYPES.includes(event.eventType as NodeKitRunEventType)
  ) {
    fail("event_type_invalid", `Event ${index} has an unsupported type.`);
  }
  if (
    !Number.isSafeInteger(event.recordedAt) ||
    (event.recordedAt as number) < 0
  ) {
    fail("recorded_at_invalid", `Event ${index} has an invalid timestamp.`);
  }
  assertHash(String(event.previousHash), `events[${index}].previousHash`);
  assertHash(String(event.contentHash), `events[${index}].contentHash`);
  assertSafeEventPayload(
    event.payload,
    event.eventType as NodeKitRunEventType,
    index,
  );
}

function eventHashBody(
  event: Omit<NodeKitRunEvent, "contentHash">,
): Omit<NodeKitRunEvent, "contentHash"> {
  return {
    contractVersion: NODEKIT_RUN_EVENT_CONTRACT_VERSION,
    runId: event.runId,
    sequence: event.sequence,
    eventType: event.eventType,
    recordedAt: event.recordedAt,
    payload: event.payload,
    previousHash: event.previousHash,
  };
}

export async function buildNodeKitRunEvent(input: {
  runId: string;
  sequence: number;
  eventType: NodeKitRunEventType;
  recordedAt: number;
  payload: unknown;
  previousHash: string;
}): Promise<NodeKitRunEvent> {
  if (!input.runId.trim() || input.runId.length > 256) {
    fail("run_id_invalid", "runId must contain 1-256 characters.");
  }
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    fail("sequence_invalid", "sequence must be a non-negative safe integer.");
  }
  if (!NODEKIT_RUN_EVENT_TYPES.includes(input.eventType)) {
    fail("event_type_invalid", `Unsupported event type: ${input.eventType}`);
  }
  if (!Number.isSafeInteger(input.recordedAt) || input.recordedAt < 0) {
    fail(
      "recorded_at_invalid",
      "recordedAt must be a non-negative safe integer.",
    );
  }
  assertHash(input.previousHash, "previousHash");
  const projectedPayload = await projectNodeKitRunEventPayload(
    input.eventType,
    input.payload,
  );

  const body = eventHashBody({
    contractVersion: NODEKIT_RUN_EVENT_CONTRACT_VERSION,
    runId: input.runId,
    sequence: input.sequence,
    eventType: input.eventType,
    recordedAt: input.recordedAt,
    payload: projectedPayload,
    previousHash: input.previousHash,
  });
  const event: NodeKitRunEvent = {
    ...body,
    contentHash: await sha256CanonicalNodeKitValue(body),
  };
  return deepFreezeNodeKitValue(event);
}

function eventField(
  event: NodeKitRunEvent,
  field: string,
): string | number | boolean | null | undefined {
  return event.payload.fields[field];
}

function assertNodeKitSpanLifecycle(
  events: readonly NodeKitRunEvent[],
  requireClosed: boolean,
): ReadonlySet<string> {
  const openSpans = new Set<string>();
  const completedSpans = new Set<string>();
  for (const event of events) {
    if (event.eventType === "span.started") {
      const spanId = eventField(event, "spanId");
      if (typeof spanId !== "string" || !spanId) {
        fail("span_id_missing", "span.started requires a non-empty spanId.");
      }
      if (openSpans.has(spanId) || completedSpans.has(spanId)) {
        fail("span_duplicate_start", `Span ${spanId} was started twice.`);
      }
      openSpans.add(spanId);
    }
    if (event.eventType === "span.completed") {
      const spanId = eventField(event, "spanId");
      if (typeof spanId !== "string" || !spanId) {
        fail("span_id_missing", "span.completed requires a non-empty spanId.");
      }
      if (!openSpans.has(spanId)) {
        fail(
          "span_completion_without_start",
          `Span ${spanId} completed without an open start event.`,
        );
      }
      openSpans.delete(spanId);
      completedSpans.add(spanId);
    }
  }
  if (requireClosed && openSpans.size > 0) {
    fail(
      "span_lifecycle_incomplete",
      `Terminal runs cannot retain ${openSpans.size} open span(s).`,
    );
  }
  return openSpans;
}

function assertNodeKitGraphLifecycle(
  events: readonly NodeKitRunEvent[],
  requireClosed: boolean,
): ReadonlySet<string> {
  const openNodes = new Map<string, string>();
  const closedNodeRuns = new Set<string>();
  let graphScope:
    | {
        graphId: string;
        graphHash: string;
        caseId: string;
        stageId: string;
        caseContentHash: string;
      }
    | undefined;

  for (const event of events) {
    if (!GRAPH_EVENT_TYPES.has(event.eventType)) continue;
    const currentScope = {
      graphId: String(eventField(event, "graphId")),
      graphHash: String(eventField(event, "graphHash")),
      caseId: String(eventField(event, "caseId")),
      stageId: String(eventField(event, "stageId")),
      caseContentHash: String(eventField(event, "caseContentHash")),
    };
    if (graphScope === undefined) {
      graphScope = currentScope;
    } else if (
      Object.keys(graphScope).some(
        (key) =>
          graphScope?.[key as keyof typeof graphScope] !==
          currentScope[key as keyof typeof currentScope],
      )
    ) {
      fail(
        "graph_scope_mismatch",
        "One run-event chain cannot mix execution graphs, cases, or stages.",
      );
    }

    const nodeId = String(eventField(event, "nodeId"));
    const nodeRunId = String(eventField(event, "nodeRunId"));
    if (event.eventType === "node.started") {
      if (openNodes.has(nodeRunId) || closedNodeRuns.has(nodeRunId)) {
        fail(
          "graph_node_duplicate_start",
          `Node run ${nodeRunId} was started twice.`,
        );
      }
      openNodes.set(nodeRunId, nodeId);
      continue;
    }
    if (openNodes.get(nodeRunId) !== nodeId) {
      fail(
        "graph_node_not_running",
        `${event.eventType} is not bound to the currently running node ${nodeRunId}.`,
      );
    }
    if (
      event.eventType === "node.completed" ||
      event.eventType === "node.failed"
    ) {
      openNodes.delete(nodeRunId);
      closedNodeRuns.add(nodeRunId);
    }
  }

  if (requireClosed && openNodes.size > 0) {
    fail(
      "graph_node_lifecycle_incomplete",
      `Terminal runs cannot retain ${openNodes.size} open graph node(s).`,
    );
  }
  return new Set(openNodes.keys());
}

export async function verifyNodeKitRunEventPrefix(
  inputEvents: readonly NodeKitRunEvent[],
  expectedRunId: string,
): Promise<{
  eventCount: number;
  chainHead: string;
  terminalEventType: "run.completed" | "run.failed" | null;
  openSpanIds: readonly string[];
  openNodeRunIds: readonly string[];
}> {
  if (!Array.isArray(inputEvents) || inputEvents.length === 0) {
    fail("start_event_missing", "A run prefix requires run.started.");
  }
  if (inputEvents.length > NODEKIT_RUN_MAX_EVENTS) {
    fail(
      "event_limit_exceeded",
      `A run may contain at most ${NODEKIT_RUN_MAX_EVENTS} events.`,
    );
  }
  inputEvents.forEach((event, index) =>
    assertEventShape(event, expectedRunId, index),
  );
  for (let index = 0; index < inputEvents.length; index += 1) {
    if (inputEvents[index].sequence !== index) {
      fail(
        "sequence_not_contiguous",
        `Expected sequence ${index}, received ${inputEvents[index].sequence}.`,
      );
    }
  }
  if (inputEvents[0].eventType !== "run.started") {
    fail("start_event_missing", "Sequence 0 must be run.started.");
  }
  if (inputEvents[0].previousHash !== NODEKIT_RUN_GENESIS_HASH) {
    fail(
      "previous_hash_mismatch",
      "run.started must point to the NodeKit genesis hash.",
    );
  }
  const terminalIndexes = inputEvents.flatMap((event, index) =>
    event.eventType === "run.completed" || event.eventType === "run.failed"
      ? [index]
      : [],
  );
  if (
    terminalIndexes.length > 1 ||
    (terminalIndexes.length === 1 &&
      terminalIndexes[0] !== inputEvents.length - 1)
  ) {
    fail(
      "terminal_event_not_last",
      "Exactly one terminal event must be the final event.",
    );
  }

  for (let index = 0; index < inputEvents.length; index += 1) {
    const event = inputEvents[index];
    if (index > 0 && event.recordedAt < inputEvents[index - 1].recordedAt) {
      fail(
        "recorded_at_not_monotonic",
        `Event ${index} was recorded before its predecessor.`,
      );
    }
    const expectedPrevious =
      index === 0
        ? NODEKIT_RUN_GENESIS_HASH
        : inputEvents[index - 1].contentHash;
    if (event.previousHash !== expectedPrevious) {
      fail(
        "previous_hash_mismatch",
        `Event ${index} does not point to the preceding content hash.`,
      );
    }
    const expectedHash = await sha256CanonicalNodeKitValue(
      eventHashBody(event),
    );
    if (event.contentHash !== expectedHash) {
      fail(
        "content_hash_mismatch",
        `Event ${index} content does not match its hash.`,
      );
    }
  }
  const terminalEventType =
    terminalIndexes.length === 1
      ? (inputEvents[inputEvents.length - 1].eventType as
          | "run.completed"
          | "run.failed")
      : null;
  const openSpans = assertNodeKitSpanLifecycle(
    inputEvents,
    terminalEventType !== null,
  );
  const openNodeRuns = assertNodeKitGraphLifecycle(
    inputEvents,
    terminalEventType !== null,
  );

  const last = inputEvents[inputEvents.length - 1];
  return {
    eventCount: inputEvents.length,
    chainHead: last.contentHash,
    terminalEventType,
    openSpanIds: [...openSpans].sort(),
    openNodeRunIds: [...openNodeRuns].sort(),
  };
}

export async function verifyNodeKitRunEventChain(
  inputEvents: readonly NodeKitRunEvent[],
  expectedRunId: string,
): Promise<{
  eventCount: number;
  chainHead: string;
  terminalEventType: "run.completed" | "run.failed";
}> {
  if (!Array.isArray(inputEvents) || inputEvents.length < 2) {
    fail(
      "terminal_event_missing",
      "A complete run requires at least run.started and a terminal event.",
    );
  }
  const prefix = await verifyNodeKitRunEventPrefix(inputEvents, expectedRunId);
  if (prefix.terminalEventType === null) {
    fail("terminal_event_missing", "The run has no terminal event.");
  }
  return {
    eventCount: prefix.eventCount,
    chainHead: prefix.chainHead,
    terminalEventType: prefix.terminalEventType,
  };
}

type NodeKitEventMutationCtx = Pick<MutationCtx, "db">;

export async function appendNodeKitRunEvent(
  ctx: NodeKitEventMutationCtx,
  args: {
    sessionId: Id<"agentTaskSessions">;
    traceId: Id<"agentTaskTraces">;
    userId: Id<"users">;
    runId: string;
    eventType: NodeKitRunEventType;
    recordedAt: number;
    payload: unknown;
    allowLegacySkip?: boolean;
  },
): Promise<NodeKitRunEvent | null> {
  const latest = await ctx.db
    .query("nodeKitRunEvents")
    .withIndex("by_trace_sequence", (q) => q.eq("traceId", args.traceId))
    .order("desc")
    .first();

  if (!latest && args.eventType !== "run.started") {
    if (args.allowLegacySkip ?? true) return null;
    fail("start_event_missing", "Cannot append before run.started.");
  }
  if (latest && args.eventType === "run.started") {
    fail("start_event_duplicate", "run.started already exists.");
  }
  if (
    latest &&
    (latest.eventType === "run.completed" || latest.eventType === "run.failed")
  ) {
    fail("run_already_terminal", "Cannot append after a terminal event.");
  }
  if (latest && latest.runId !== args.runId) {
    fail("run_id_mismatch", "Stored events belong to another run.");
  }
  if (latest && args.recordedAt < latest.recordedAt) {
    fail(
      "recorded_at_not_monotonic",
      "recordedAt cannot precede the latest stored event.",
    );
  }
  if (
    latest &&
    (latest.sessionId !== args.sessionId || latest.userId !== args.userId)
  ) {
    fail(
      "event_ownership_mismatch",
      "Stored event ownership does not match the append request.",
    );
  }
  const nextSequence = latest ? latest.sequence + 1 : 0;
  if (nextSequence >= NODEKIT_RUN_MAX_EVENTS) {
    fail(
      "event_limit_exceeded",
      `A run may contain at most ${NODEKIT_RUN_MAX_EVENTS} events.`,
    );
  }
  if (
    nextSequence === NODEKIT_RUN_MAX_EVENTS - 1 &&
    args.eventType !== "run.completed" &&
    args.eventType !== "run.failed"
  ) {
    fail(
      "terminal_slot_required",
      "The final bounded event slot is reserved for a terminal event.",
    );
  }

  const event = await buildNodeKitRunEvent({
    runId: args.runId,
    sequence: nextSequence,
    eventType: args.eventType,
    recordedAt: args.recordedAt,
    payload: args.payload,
    previousHash: latest?.contentHash ?? NODEKIT_RUN_GENESIS_HASH,
  });
  const storedEvents = await ctx.db
    .query("nodeKitRunEvents")
    .withIndex("by_trace_sequence", (q) => q.eq("traceId", args.traceId))
    .order("asc")
    .take(NODEKIT_RUN_MAX_EVENTS + 1);
  if (storedEvents.length > NODEKIT_RUN_MAX_EVENTS) {
    fail(
      "event_limit_exceeded",
      `A run may contain at most ${NODEKIT_RUN_MAX_EVENTS} events.`,
    );
  }
  const candidateChain = [
    ...storedEvents.map((stored) => ({
      contractVersion: stored.contractVersion,
      runId: stored.runId,
      sequence: stored.sequence,
      eventType: stored.eventType,
      recordedAt: stored.recordedAt,
      payload: stored.payload as NodeKitSafeEventPayload,
      previousHash: stored.previousHash,
      contentHash: stored.contentHash,
    })),
    event,
  ];
  const prefix = await verifyNodeKitRunEventPrefix(candidateChain, args.runId);
  if (prefix.terminalEventType === null) {
    const remainingSlots = NODEKIT_RUN_MAX_EVENTS - prefix.eventCount;
    const requiredSlots =
      prefix.openSpanIds.length + prefix.openNodeRunIds.length + 1;
    if (remainingSlots < requiredSlots) {
      fail(
        "event_capacity_reserved",
        `The remaining ${remainingSlots} event slot(s) cannot close ${prefix.openSpanIds.length} open span(s), ${prefix.openNodeRunIds.length} open graph node(s), and terminate the run.`,
      );
    }
  }
  const storedEvent = {
    sessionId: args.sessionId,
    traceId: args.traceId,
    userId: args.userId,
    ...event,
    ...(prefix.terminalEventType === null
      ? {}
      : { retentionExpiresAt: Date.now() + NODEKIT_RUN_RETENTION_MS }),
  };
  await ctx.db.insert("nodeKitRunEvents", storedEvent);
  return event;
}
