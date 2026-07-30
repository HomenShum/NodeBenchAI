#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const EXPORT_SCHEMA = "nodekit.run-export/v1";
const EVENT_SCHEMA = "nodekit.run-event/v1";
const SAFE_PAYLOAD_SCHEMA = "nodekit.safe-event-payload/v1";
const OUTPUT_SCHEMA = "nodebench.activegraph.nodekit-replay-output.v1";
const ACTIVEGRAPH_VERSION = "1.10.0";
const ACTIVEGRAPH_RELEASE_TAG = "v1.10.0";
const ACTIVEGRAPH_RELEASE_COMMIT = "148e12c2969f18fa12a1a3c2e75f3affd9aa0616";
const ACTIVEGRAPH_ANNOTATED_TAG_OBJECT =
  "3fbcd8fc56a45ae68622d4e2b18a6d5844180527";
const ACTIVEGRAPH_INSPECTED_REF = "8aedb1866cf5dce056af97529152ffd6f468a1ed";
const IMAGE_ATTESTATION_SCHEMA = "nodebench.activegraph-image-attestation/v1";
const BUILD_INPUTS_MANIFEST_SCHEMA = "nodebench.activegraph-build-inputs/v1";
const IMAGE_LABELS = Object.freeze({
  buildInputsHash: "ai.nodebench.activegraph.build-inputs-sha256",
  nodebenchCandidateCommit: "ai.nodebench.candidate-commit",
  upstreamHash: "ai.nodebench.activegraph.upstream-sha256",
});
const GENESIS_HASH = `sha256:${"0".repeat(64)}`;
const MAX_EVENTS = 256;
const MAX_REDACTED_SOURCE_BYTES = 32 * 1024;
const MAX_STORED_PAYLOAD_BYTES = 2 * 1024;
const MAX_EXPORT_BYTES = 1024 * 1024;
const MAX_REPORT_BYTES = 64 * 1024;
const MAX_SQLITE_BYTES = 64 * 1024 * 1024;
const CHILD_TIMEOUT_MS = 120_000;
const CHILD_MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_BUILD_INPUT_FILE_BYTES = 1024 * 1024;
const MAX_BUILD_INPUT_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_ATTESTATION_BYTES = 32 * 1024;
const INSPECT_TIMEOUT_MS = 15_000;
const INSPECT_MAX_BUFFER_BYTES = 64 * 1024;
const EVENT_TYPES = new Set([
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
]);
const TERMINAL_TYPES = new Set(["run.completed", "run.failed"]);
const SAFE_FIELDS_BY_EVENT = {
  "run.started": new Set([
    "workflowName",
    "origin",
    "groupId",
    "model",
    "goalId",
    "sessionType",
    "sessionStartedAt",
    "identityRef",
    "workspaceId",
    "agentId",
    "nativeSessionId",
    "nativeSessionGeneration",
    "peerId",
    "identitySnapshotHash",
  ]),
  "span.started": new Set([
    "spanId",
    "parentSpanId",
    "spanSequence",
    "depth",
    "spanType",
  ]),
  "span.completed": new Set(["spanId", "spanSequence", "status", "durationMs"]),
  "step.recorded": new Set([
    "spanId",
    "parentSpanId",
    "spanSequence",
    "stage",
    "type",
    "tool",
    "durationMs",
  ]),
  "decision.recorded": new Set(["decisionType", "confidence"]),
  "verification.recorded": new Set(["status"]),
  "evidence.attached": new Set(),
  "approval.requested": new Set(["approvalId", "toolName", "riskLevel"]),
  "node.started": new Set([
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
  ]),
  "edge.consumed": new Set([
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
  ]),
  "artifact.produced": new Set([
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
  ]),
  "node.completed": new Set([
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
  ]),
  "node.failed": new Set([
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "status",
    "reasonCode",
  ]),
  "barrier.opened": new Set([
    "graphId",
    "graphHash",
    "caseId",
    "stageId",
    "caseContentHash",
    "nodeId",
    "nodeRunId",
    "frontierHash",
    "status",
  ]),
  "barrier.blocked": new Set([
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
  ]),
  "run.completed": new Set([
    "status",
    "totalDurationMs",
    "crossCheckStatus",
    "dogfoodRunId",
  ]),
  "run.failed": new Set([
    "status",
    "totalDurationMs",
    "crossCheckStatus",
    "dogfoodRunId",
  ]),
};
const REQUIRED_FIELDS_BY_EVENT = {
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
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..", "..");

class NodeKitExportBoundaryError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "NodeKitExportBoundaryError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new NodeKitExportBoundaryError(code, message);
}

function readBoundedRegularFile(
  path,
  { label, maxBytes, missingCode, invalidCode, tooLargeCode },
) {
  let descriptor;
  try {
    const linkStats = lstatSync(path);
    if (!linkStats.isFile() || linkStats.isSymbolicLink()) {
      fail(invalidCode, `${label} must be a regular file, not a symlink.`);
    }
    descriptor = openSync(path, "r");
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size < 1) {
      fail(invalidCode, `${label} must be a non-empty regular file.`);
    }
    if (stats.size > maxBytes) {
      fail(tooLargeCode, `${label} exceeds the ${maxBytes}-byte bound.`);
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > maxBytes) {
      fail(tooLargeCode, `${label} exceeds the ${maxBytes}-byte bound.`);
    }
    if (bytesRead < 1) {
      fail(invalidCode, `${label} must be a non-empty regular file.`);
    }
    return Buffer.from(buffer.subarray(0, bytesRead));
  } catch (error) {
    if (error instanceof NodeKitExportBoundaryError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    fail(missingCode, `Unable to read ${label}: ${detail}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function normalizeCanonicalValue(input, seen = new WeakSet()) {
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
  const result = {};
  for (const key of Object.keys(input).sort()) {
    result[key] = normalizeCanonicalValue(input[key], seen);
  }
  seen.delete(input);
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(normalizeCanonicalValue(value));
}

function canonicalHash(value) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function listActiveGraphSourceFiles(sourceRoot, directory = sourceRoot) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name.endsWith(".pyc")) continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      fail(
        "build_input_invalid",
        `ActiveGraph build input cannot be a symbolic link: ${path}`,
      );
    }
    if (entry.isDirectory()) {
      files.push(...listActiveGraphSourceFiles(sourceRoot, path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      fail(
        "build_input_invalid",
        `ActiveGraph build input must be a regular file: ${path}`,
      );
    }
  }
  return files;
}

function activeGraphBuildInputPaths(activeGraphRoot) {
  const fixed = [
    ".dockerignore",
    "Dockerfile",
    "requirements.in",
    "UPSTREAM.json",
  ].map((name) => resolve(activeGraphRoot, name));
  return [
    ...fixed,
    ...listActiveGraphSourceFiles(resolve(activeGraphRoot, "src")),
  ].sort((left, right) =>
    relative(activeGraphRoot, left).localeCompare(
      relative(activeGraphRoot, right),
    ),
  );
}

export function computeActiveGraphBuildInputsHash(
  activeGraphRoot = resolve(REPO_ROOT, "evals", "activegraph"),
) {
  let totalBytes = 0;
  const files = activeGraphBuildInputPaths(activeGraphRoot).map((path) => {
    const bytes = readBoundedRegularFile(path, {
      label: `ActiveGraph build input ${path}`,
      maxBytes: MAX_BUILD_INPUT_FILE_BYTES,
      missingCode: "build_input_missing",
      invalidCode: "build_input_invalid",
      tooLargeCode: "build_input_too_large",
    });
    totalBytes += bytes.length;
    if (totalBytes > MAX_BUILD_INPUT_TOTAL_BYTES) {
      fail(
        "build_inputs_too_large",
        `ActiveGraph build inputs exceed ${MAX_BUILD_INPUT_TOTAL_BYTES} bytes.`,
      );
    }
    return {
      path: relative(activeGraphRoot, path).replaceAll("\\", "/"),
      bytes: bytes.length,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    };
  });
  return canonicalHash({
    schemaVersion: BUILD_INPUTS_MANIFEST_SCHEMA,
    files,
  });
}

function readActiveGraphUpstream(
  activeGraphRoot = resolve(REPO_ROOT, "evals", "activegraph"),
) {
  const path = resolve(activeGraphRoot, "UPSTREAM.json");
  let value;
  try {
    value = JSON.parse(
      readBoundedRegularFile(path, {
        label: "UPSTREAM.json",
        maxBytes: MAX_BUILD_INPUT_FILE_BYTES,
        missingCode: "upstream_record_invalid",
        invalidCode: "upstream_record_invalid",
        tooLargeCode: "upstream_record_invalid",
      }).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof NodeKitExportBoundaryError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    fail("upstream_record_invalid", `Unable to read UPSTREAM.json: ${detail}`);
  }
  assertObject(value, "UPSTREAM.json");
  const upstream = {
    package: value.package,
    version: value.pinned_version,
    releaseTag: value.release_tag,
    releaseCommit: value.release_commit,
    annotatedTagObject: value.annotated_tag_object,
    inspectedRef: value.inspected_ref,
  };
  const expected = {
    package: "activegraph",
    version: ACTIVEGRAPH_VERSION,
    releaseTag: ACTIVEGRAPH_RELEASE_TAG,
    releaseCommit: ACTIVEGRAPH_RELEASE_COMMIT,
    annotatedTagObject: ACTIVEGRAPH_ANNOTATED_TAG_OBJECT,
    inspectedRef: ACTIVEGRAPH_INSPECTED_REF,
  };
  if (canonicalJson(upstream) !== canonicalJson(expected)) {
    fail(
      "upstream_record_mismatch",
      "UPSTREAM.json does not match the audited ActiveGraph release and refs.",
    );
  }
  return Object.freeze(upstream);
}

export function readNodeBenchCandidateCommit({
  repoRoot = REPO_ROOT,
  spawnSyncImpl = spawnSync,
} = {}) {
  const child = spawnSyncImpl("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    timeout: INSPECT_TIMEOUT_MS,
    maxBuffer: INSPECT_MAX_BUFFER_BYTES,
  });
  if (child.error || child.status !== 0) {
    fail(
      "candidate_commit_unavailable",
      String(child.error?.message || child.stderr || "git rev-parse failed"),
    );
  }
  const commit = String(child.stdout || "").trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    fail(
      "candidate_commit_invalid",
      "NodeBench candidate commit must be a full Git SHA-1.",
    );
  }
  return commit;
}

export function createActiveGraphBuildMetadata({
  nodebenchCandidateCommit,
  activeGraphRoot = resolve(REPO_ROOT, "evals", "activegraph"),
}) {
  if (!/^[a-f0-9]{40}$/.test(nodebenchCandidateCommit)) {
    fail(
      "candidate_commit_invalid",
      "NodeBench candidate commit must be a full Git SHA-1.",
    );
  }
  const upstream = readActiveGraphUpstream(activeGraphRoot);
  return Object.freeze({
    buildInputsHash: computeActiveGraphBuildInputsHash(activeGraphRoot),
    nodebenchCandidateCommit,
    upstream,
    upstreamHash: canonicalHash(upstream),
  });
}

export function createActiveGraphImageAttestation({
  sandboxImage,
  nodebenchCandidateCommit,
  activeGraphRoot = resolve(REPO_ROOT, "evals", "activegraph"),
}) {
  assertImmutableSandboxImage(sandboxImage);
  const metadata = createActiveGraphBuildMetadata({
    nodebenchCandidateCommit,
    activeGraphRoot,
  });
  const body = {
    schemaVersion: IMAGE_ATTESTATION_SCHEMA,
    image: sandboxImage,
    ...metadata,
  };
  return Object.freeze({
    ...body,
    attestationHash: canonicalHash(body),
  });
}

export function imageLabelsForActiveGraphAttestation(attestation) {
  return Object.freeze({
    [IMAGE_LABELS.buildInputsHash]: attestation.buildInputsHash,
    [IMAGE_LABELS.nodebenchCandidateCommit]:
      attestation.nodebenchCandidateCommit,
    [IMAGE_LABELS.upstreamHash]: attestation.upstreamHash,
  });
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    fail("shape_invalid", `${label} has unexpected or missing keys.`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("shape_invalid", `${label} must be an object.`);
  }
}

function assertHash(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    fail("hash_invalid", `${label} must be a lowercase sha256: digest.`);
  }
}

function assertString(value, label, { nonEmpty = false, maxLength } = {}) {
  if (
    typeof value !== "string" ||
    (nonEmpty && value.trim().length === 0) ||
    (maxLength !== undefined && value.length > maxLength)
  ) {
    fail("shape_invalid", `${label} must be a valid string.`);
  }
}

function assertTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("shape_invalid", `${label} must be a non-negative safe integer.`);
  }
}

function assertSafeEventPayload(payload, eventType, label) {
  assertObject(payload, label);
  exactKeys(
    payload,
    ["projectionVersion", "sourceDigest", "sourceBytes", "fields"],
    label,
  );
  if (payload.projectionVersion !== SAFE_PAYLOAD_SCHEMA) {
    fail("payload_version_mismatch", `${label} version is unsupported.`);
  }
  assertHash(payload.sourceDigest, `${label}.sourceDigest`);
  if (
    !Number.isSafeInteger(payload.sourceBytes) ||
    payload.sourceBytes < 0 ||
    payload.sourceBytes > MAX_REDACTED_SOURCE_BYTES
  ) {
    fail("payload_size_invalid", `${label}.sourceBytes exceeds its bound.`);
  }
  assertObject(payload.fields, `${label}.fields`);
  const allowed = SAFE_FIELDS_BY_EVENT[eventType];
  for (const [field, value] of Object.entries(payload.fields)) {
    if (!allowed.has(field)) {
      fail("payload_field_invalid", `${label}.${field} is not allowed.`);
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      fail("payload_field_invalid", `${label}.${field} must be scalar.`);
    }
    if (
      (typeof value === "string" && value.length > 256) ||
      (typeof value === "number" && !Number.isFinite(value))
    ) {
      fail("payload_field_invalid", `${label}.${field} exceeds its bound.`);
    }
  }
  for (const required of REQUIRED_FIELDS_BY_EVENT[eventType] ?? []) {
    if (!(required in payload.fields)) {
      fail(
        "payload_field_missing",
        `${label} requires safe field ${required}.`,
      );
    }
  }
  const expectedTerminalStatus =
    eventType === "run.completed"
      ? "completed"
      : eventType === "run.failed"
        ? "error"
        : undefined;
  if (
    expectedTerminalStatus !== undefined &&
    payload.fields.status !== expectedTerminalStatus
  ) {
    fail(
      "terminal_status_mismatch",
      `${label} requires status ${expectedTerminalStatus}.`,
    );
  }
  if (eventType === "run.started") {
    const identityFields = [
      "identityRef",
      "workspaceId",
      "agentId",
      "nativeSessionId",
      "nativeSessionGeneration",
      "identitySnapshotHash",
    ];
    const present = identityFields.filter((field) => field in payload.fields);
    if (present.length !== 0 && present.length !== identityFields.length) {
      fail(
        "native_identity_incomplete",
        `${label} must bind the complete native identity snapshot.`,
      );
    }
    if (present.length === identityFields.length) {
      assertHash(
        payload.fields.identitySnapshotHash,
        `${label}.identitySnapshotHash`,
      );
      if (
        !Number.isSafeInteger(payload.fields.nativeSessionGeneration) ||
        payload.fields.nativeSessionGeneration < 0
      ) {
        fail(
          "native_session_generation_invalid",
          `${label}.nativeSessionGeneration is invalid.`,
        );
      }
    }
  }
  if (
    eventType === "node.started" ||
    eventType === "edge.consumed" ||
    eventType === "artifact.produced" ||
    eventType === "node.completed" ||
    eventType === "node.failed" ||
    eventType === "barrier.opened" ||
    eventType === "barrier.blocked"
  ) {
    if (
      typeof payload.fields.graphId !== "string" ||
      !/^execution-graph:sha256:[a-f0-9]{64}$/.test(payload.fields.graphId)
    ) {
      fail("graph_id_invalid", `${label}.graphId is invalid.`);
    }
    for (const field of [
      "graphHash",
      "caseContentHash",
      "frontierHash",
      "bindingHash",
      "artifactContentHash",
    ]) {
      if (
        field in payload.fields &&
        (typeof payload.fields[field] !== "string" ||
          !/^[a-f0-9]{64}$/.test(payload.fields[field]))
      ) {
        fail("graph_hash_invalid", `${label}.${field} is invalid.`);
      }
    }
    if (
      "bindingId" in payload.fields &&
      (typeof payload.fields.bindingId !== "string" ||
        !/^execution-edge-binding:sha256:[a-f0-9]{64}$/.test(
          payload.fields.bindingId,
        ))
    ) {
      fail("edge_binding_id_invalid", `${label}.bindingId is invalid.`);
    }
  }
  if (
    Buffer.byteLength(canonicalJson(payload), "utf8") > MAX_STORED_PAYLOAD_BYTES
  ) {
    fail("projected_payload_too_large", `${label} exceeds its stored bound.`);
  }
}

function eventHashBody(event) {
  return {
    contractVersion: event.contractVersion,
    runId: event.runId,
    sequence: event.sequence,
    eventType: event.eventType,
    recordedAt: event.recordedAt,
    payload: event.payload,
    previousHash: event.previousHash,
  };
}

export function assertCanonicalNodeKitRunExport(value) {
  assertObject(value, "NodeKit export");
  exactKeys(
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
    "NodeKit export",
  );
  if (value.schemaVersion !== EXPORT_SCHEMA) {
    fail("export_schema_mismatch", "Unsupported NodeKit export schema.");
  }
  if (
    typeof value.runId !== "string" ||
    value.runId.trim().length === 0 ||
    value.runId.length > 256
  ) {
    fail("run_id_invalid", "runId is required.");
  }
  assertObject(value.session, "session");
  assertObject(value.trace, "trace");
  assertObject(value.completeness, "completeness");
  assertObject(value.hashes, "hashes");
  exactKeys(
    value.session,
    [
      "id",
      "typeAtRunStart",
      "startedAt",
      ...("nativeIdentity" in value.session ? ["nativeIdentity"] : []),
    ],
    "session",
  );
  exactKeys(
    value.trace,
    ["id", "runId", "workflowName", "status", "startedAt", "endedAt"],
    "trace",
  );
  exactKeys(
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
  exactKeys(value.hashes, ["algorithm", "chainHead", "exportHash"], "hashes");
  assertString(value.session.id, "session.id", { nonEmpty: true });
  assertString(value.session.typeAtRunStart, "session.typeAtRunStart", {
    nonEmpty: true,
    maxLength: 256,
  });
  assertTimestamp(value.session.startedAt, "session.startedAt");
  if ("nativeIdentity" in value.session) {
    assertObject(value.session.nativeIdentity, "session.nativeIdentity");
    exactKeys(
      value.session.nativeIdentity,
      [
        "schemaVersion",
        "identityRef",
        "agentId",
        "workspaceId",
        "nativeSessionId",
        "nativeSessionGeneration",
        ...("peerId" in value.session.nativeIdentity ? ["peerId"] : []),
        "snapshotHash",
      ],
      "session.nativeIdentity",
    );
  }
  assertString(value.trace.id, "trace.id", { nonEmpty: true });
  assertString(value.trace.runId, "trace.runId", {
    nonEmpty: true,
    maxLength: 256,
  });
  assertString(value.trace.workflowName, "trace.workflowName", {
    nonEmpty: true,
  });
  if (value.trace.status !== "completed" && value.trace.status !== "error") {
    fail("run_not_terminal", "trace.status must be completed or error.");
  }
  assertTimestamp(value.trace.startedAt, "trace.startedAt");
  assertTimestamp(value.trace.endedAt, "trace.endedAt");
  if (value.trace.endedAt < value.trace.startedAt) {
    fail("shape_invalid", "trace.endedAt cannot precede startedAt.");
  }
  if (!Array.isArray(value.events) || value.events.length < 2) {
    fail("terminal_event_missing", "Export has no complete event chain.");
  }
  if (value.events.length > MAX_EVENTS) {
    fail(
      "event_limit_exceeded",
      `Export exceeds the ${MAX_EVENTS}-event bound.`,
    );
  }
  if (value.trace.runId !== value.runId) {
    fail("run_id_mismatch", "Trace and export run IDs differ.");
  }

  let previousHash = GENESIS_HASH;
  let terminalIndex = -1;
  const openSpans = new Set();
  const completedSpans = new Set();
  const openNodes = new Map();
  const closedNodeRuns = new Set();
  let graphScope;
  for (let index = 0; index < value.events.length; index += 1) {
    const event = value.events[index];
    assertObject(event, `events[${index}]`);
    exactKeys(
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
      `events[${index}]`,
    );
    if (event.contractVersion !== EVENT_SCHEMA) {
      fail("contract_version_mismatch", `events[${index}] contract mismatch.`);
    }
    if (event.runId !== value.runId) {
      fail("run_id_mismatch", `events[${index}] run ID mismatch.`);
    }
    if (event.sequence !== index) {
      fail(
        "sequence_not_contiguous",
        `Expected sequence ${index}, received ${event.sequence}.`,
      );
    }
    if (!EVENT_TYPES.has(event.eventType)) {
      fail("event_type_invalid", `events[${index}] type is unsupported.`);
    }
    assertSafeEventPayload(
      event.payload,
      event.eventType,
      `events[${index}].payload`,
    );
    if (!Number.isSafeInteger(event.recordedAt) || event.recordedAt < 0) {
      fail("recorded_at_invalid", `events[${index}] timestamp is invalid.`);
    }
    if (index > 0 && event.recordedAt < value.events[index - 1].recordedAt) {
      fail(
        "recorded_at_not_monotonic",
        `events[${index}] was recorded before its predecessor.`,
      );
    }
    assertHash(event.previousHash, `events[${index}].previousHash`);
    assertHash(event.contentHash, `events[${index}].contentHash`);
    if (event.previousHash !== previousHash) {
      fail(
        "previous_hash_mismatch",
        `events[${index}] does not point to the preceding event.`,
      );
    }
    const expectedHash = canonicalHash(eventHashBody(event));
    if (event.contentHash !== expectedHash) {
      fail(
        "content_hash_mismatch",
        `events[${index}] content does not match its hash.`,
      );
    }
    if (TERMINAL_TYPES.has(event.eventType)) {
      if (terminalIndex !== -1) {
        fail("terminal_event_not_last", "Export has multiple terminal events.");
      }
      terminalIndex = index;
    }
    if (event.eventType === "span.started") {
      const spanId = event.payload.fields.spanId;
      if (
        typeof spanId !== "string" ||
        !spanId ||
        openSpans.has(spanId) ||
        completedSpans.has(spanId)
      ) {
        fail("span_duplicate_start", `Invalid start for span ${spanId}.`);
      }
      openSpans.add(spanId);
    }
    if (event.eventType === "span.completed") {
      const spanId = event.payload.fields.spanId;
      if (typeof spanId !== "string" || !openSpans.has(spanId)) {
        fail(
          "span_completion_without_start",
          `Invalid completion for span ${spanId}.`,
        );
      }
      openSpans.delete(spanId);
      completedSpans.add(spanId);
    }
    if (
      event.eventType === "node.started" ||
      event.eventType === "edge.consumed" ||
      event.eventType === "artifact.produced" ||
      event.eventType === "node.completed" ||
      event.eventType === "node.failed" ||
      event.eventType === "barrier.opened" ||
      event.eventType === "barrier.blocked"
    ) {
      const fields = event.payload.fields;
      const currentScope = [
        fields.graphId,
        fields.graphHash,
        fields.caseId,
        fields.stageId,
        fields.caseContentHash,
      ].join("|");
      graphScope ??= currentScope;
      if (currentScope !== graphScope) {
        fail(
          "graph_scope_mismatch",
          "One export cannot mix execution graphs, cases, or stages.",
        );
      }
      const nodeRunId = fields.nodeRunId;
      const nodeId = fields.nodeId;
      if (event.eventType === "node.started") {
        if (openNodes.has(nodeRunId) || closedNodeRuns.has(nodeRunId)) {
          fail("graph_node_duplicate_start", `Invalid start for ${nodeRunId}.`);
        }
        openNodes.set(nodeRunId, nodeId);
      } else {
        if (openNodes.get(nodeRunId) !== nodeId) {
          fail(
            "graph_node_not_running",
            `${event.eventType} is not bound to ${nodeRunId}.`,
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
    }
    previousHash = event.contentHash;
  }
  if (value.events[0].eventType !== "run.started") {
    fail("start_event_missing", "Sequence 0 must be run.started.");
  }
  if (value.events[0].previousHash !== GENESIS_HASH) {
    fail(
      "previous_hash_mismatch",
      "run.started must point to the genesis hash.",
    );
  }
  if (terminalIndex === -1) {
    fail("terminal_event_missing", "Export has no terminal event.");
  }
  if (terminalIndex !== value.events.length - 1) {
    fail("terminal_event_not_last", "The terminal event must be last.");
  }
  if (openSpans.size > 0) {
    fail(
      "span_lifecycle_incomplete",
      `Terminal run retains ${openSpans.size} open span(s).`,
    );
  }
  if (openNodes.size > 0) {
    fail(
      "graph_node_lifecycle_incomplete",
      `Terminal run retains ${openNodes.size} open graph node(s).`,
    );
  }

  const terminalEventType = value.events[terminalIndex].eventType;
  const expectedTraceStatus =
    terminalEventType === "run.completed" ? "completed" : "error";
  if (value.trace.status !== expectedTraceStatus) {
    fail(
      "terminal_status_mismatch",
      `Trace status ${value.trace.status} does not match ${terminalEventType}.`,
    );
  }
  const startFields = value.events[0].payload.fields;
  if (
    value.trace.workflowName !== startFields.workflowName ||
    value.trace.startedAt !== value.events[0].recordedAt ||
    value.trace.endedAt !== value.events[terminalIndex].recordedAt ||
    value.session.typeAtRunStart !== startFields.sessionType ||
    value.session.startedAt !== startFields.sessionStartedAt ||
    value.session.startedAt > value.trace.startedAt
  ) {
    fail(
      "event_snapshot_mismatch",
      "Session or trace metadata differs from immutable event snapshots.",
    );
  }
  if (
    startFields.identityRef === undefined &&
    "nativeIdentity" in value.session
  ) {
    fail(
      "native_identity_snapshot_mismatch",
      "Session identity is absent from run.started.",
    );
  }
  if (startFields.identityRef !== undefined) {
    const expectedIdentityBody = {
      schemaVersion: "nodekit.native-agent-session-identity/v1",
      identityRef: startFields.identityRef,
      agentId: startFields.agentId,
      workspaceId: startFields.workspaceId,
      nativeSessionId: startFields.nativeSessionId,
      nativeSessionGeneration: startFields.nativeSessionGeneration,
      ...(startFields.peerId === undefined
        ? {}
        : { peerId: startFields.peerId }),
    };
    const expectedIdentity = {
      ...expectedIdentityBody,
      snapshotHash: canonicalHash(expectedIdentityBody),
    };
    if (
      !("nativeIdentity" in value.session) ||
      canonicalJson(value.session.nativeIdentity) !==
        canonicalJson(expectedIdentity) ||
      startFields.identitySnapshotHash !== expectedIdentity.snapshotHash
    ) {
      fail(
        "native_identity_snapshot_mismatch",
        "Session identity differs from immutable run.started fields.",
      );
    }
  }
  if (
    value.completeness.eventChainComplete !== true ||
    value.completeness.spanLifecycleComplete !== true ||
    value.completeness.contractVersion !== EVENT_SCHEMA ||
    value.completeness.eventCount !== value.events.length ||
    value.completeness.firstSequence !== 0 ||
    value.completeness.lastSequence !== value.events.length - 1 ||
    value.completeness.terminalEventType !== terminalEventType
  ) {
    fail(
      "completeness_mismatch",
      "Completeness receipt does not match the event chain.",
    );
  }
  if (
    value.hashes.algorithm !== "sha256" ||
    value.hashes.chainHead !== previousHash
  ) {
    fail("chain_head_mismatch", "Export chain head does not match its events.");
  }
  assertHash(value.hashes.exportHash, "hashes.exportHash");
  const expectedExportHash = canonicalHash({
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
    fail("export_hash_mismatch", "Export content does not match exportHash.");
  }
  return value;
}

export function buildOfflineCanaryEnvironment(sourceEnvironment = process.env) {
  const allowed = [
    "PATH",
    "Path",
    "PATHEXT",
    "COMSPEC",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
  ];
  const environment = {};
  for (const key of allowed) {
    if (sourceEnvironment[key] !== undefined) {
      environment[key] = sourceEnvironment[key];
    }
  }
  return {
    ...environment,
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
    NODEBENCH_ACTIVEGRAPH_MODE: "offline-observer",
  };
}

function assertChildReport(report, exportDoc, imageAttestation) {
  assertObject(report, "ActiveGraph report");
  exactKeys(
    report,
    [
      "schema_version",
      "activegraph",
      "isolation",
      "mode",
      "run_id",
      "input_export_sha256",
      "event_count",
      "nodekit_chain_head",
      "replayed_events_sha256",
      "persisted_reload_parity",
      "verdict",
      "limitations",
    ],
    "ActiveGraph report",
  );
  assertObject(report.activegraph, "ActiveGraph report.activegraph");
  assertObject(report.isolation, "ActiveGraph report.isolation");
  exactKeys(
    report.activegraph,
    ["version", "release_commit", "annotated_tag_object", "inspected_ref"],
    "ActiveGraph report.activegraph",
  );
  exactKeys(
    report.isolation,
    [
      "runtime",
      "image",
      "network",
      "rootFilesystem",
      "writableMount",
      "buildInputsHash",
      "nodebenchCandidateCommit",
      "upstreamHash",
      "imageAttestationHash",
    ],
    "ActiveGraph report.isolation",
  );
  if (report.schema_version !== OUTPUT_SCHEMA) {
    fail("report_schema_mismatch", "ActiveGraph report schema mismatch.");
  }
  if (
    report.activegraph.version !== ACTIVEGRAPH_VERSION ||
    report.activegraph.release_commit !== ACTIVEGRAPH_RELEASE_COMMIT ||
    report.activegraph.annotated_tag_object !==
      ACTIVEGRAPH_ANNOTATED_TAG_OBJECT ||
    report.activegraph.inspected_ref !== ACTIVEGRAPH_INSPECTED_REF ||
    report.isolation.runtime !== "docker" ||
    report.isolation.image !== imageAttestation.image ||
    report.isolation.network !== "none" ||
    report.isolation.rootFilesystem !== "read-only" ||
    report.isolation.writableMount !== "/evidence" ||
    report.isolation.buildInputsHash !== imageAttestation.buildInputsHash ||
    report.isolation.nodebenchCandidateCommit !==
      imageAttestation.nodebenchCandidateCommit ||
    report.isolation.upstreamHash !== imageAttestation.upstreamHash ||
    report.isolation.imageAttestationHash !==
      imageAttestation.attestationHash ||
    report.mode !== "offline-observer" ||
    !Array.isArray(report.limitations) ||
    report.limitations.length < 1 ||
    report.limitations.some(
      (limitation) => typeof limitation !== "string" || !limitation,
    ) ||
    report.verdict !== "pass" ||
    report.run_id !== exportDoc.runId ||
    report.input_export_sha256 !== exportDoc.hashes.exportHash ||
    report.event_count !== exportDoc.events.length ||
    report.nodekit_chain_head !== exportDoc.hashes.chainHead ||
    report.replayed_events_sha256 !== canonicalHash(exportDoc.events) ||
    report.persisted_reload_parity !== true
  ) {
    fail(
      "canary_report_failed",
      "ActiveGraph report did not prove exact persisted reload parity.",
    );
  }
}

function assertImmutableSandboxImage(image) {
  if (
    typeof image !== "string" ||
    !/^(?:[a-z0-9._/-]+@)?sha256:[a-f0-9]{64}$/.test(image)
  ) {
    fail(
      "sandbox_image_required",
      "sandboxImage must be an immutable Docker image ID or digest.",
    );
  }
}

function assertCommittedActiveGraphBuildInputs({
  repoRoot = REPO_ROOT,
  spawnSyncImpl = spawnSync,
}) {
  const child = spawnSyncImpl(
    "git",
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      "evals/activegraph/.dockerignore",
      "evals/activegraph/Dockerfile",
      "evals/activegraph/requirements.in",
      "evals/activegraph/UPSTREAM.json",
      "evals/activegraph/src",
      "evals/activegraph/schemas/nodekit-run-export.v1.schema.json",
      "evals/activegraph/schemas/nodekit-replay-output.v1.schema.json",
      "evals/activegraph/schemas/image-attestation.v1.schema.json",
      "scripts/nodekit/runActiveGraphCanary.mjs",
      "backend/convex/schema.ts",
      "backend/convex/domains/operations/taskManager/nodeKitRunEvents.ts",
      "backend/convex/domains/operations/taskManager/nodeKitRunExport.ts",
      "backend/convex/domains/operations/taskManager/nodeKitRunRetention.ts",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      shell: false,
      timeout: INSPECT_TIMEOUT_MS,
      maxBuffer: INSPECT_MAX_BUFFER_BYTES,
    },
  );
  if (child.error || child.status !== 0) {
    fail(
      "build_input_status_failed",
      String(child.error?.message || child.stderr || "git status failed"),
    );
  }
  if (String(child.stdout || "").trim()) {
    fail(
      "build_inputs_not_committed",
      "The ActiveGraph image and NodeKit boundary inputs must be committed before attestation or replay.",
    );
  }
}

function readImageAttestation(path) {
  if (typeof path !== "string" || !path.trim()) {
    fail(
      "image_attestation_required",
      "An ActiveGraph image attestation file is required.",
    );
  }
  const resolvedPath = resolve(path);
  let value;
  try {
    value = JSON.parse(
      readBoundedRegularFile(resolvedPath, {
        label: "image attestation",
        maxBytes: MAX_IMAGE_ATTESTATION_BYTES,
        missingCode: "image_attestation_invalid",
        invalidCode: "image_attestation_invalid",
        tooLargeCode: "image_attestation_invalid",
      }).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof NodeKitExportBoundaryError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    fail(
      "image_attestation_invalid",
      `Unable to read image attestation: ${detail}`,
    );
  }
  return { resolvedPath, value };
}

function assertImageAttestationShape(value) {
  assertObject(value, "Image attestation");
  exactKeys(
    value,
    [
      "schemaVersion",
      "image",
      "buildInputsHash",
      "nodebenchCandidateCommit",
      "upstream",
      "upstreamHash",
      "attestationHash",
    ],
    "Image attestation",
  );
  if (value.schemaVersion !== IMAGE_ATTESTATION_SCHEMA) {
    fail(
      "image_attestation_schema_mismatch",
      "Unsupported ActiveGraph image attestation schema.",
    );
  }
  assertImmutableSandboxImage(value.image);
  assertHash(value.buildInputsHash, "Image attestation.buildInputsHash");
  assertHash(value.upstreamHash, "Image attestation.upstreamHash");
  assertHash(value.attestationHash, "Image attestation.attestationHash");
  if (!/^[a-f0-9]{40}$/.test(value.nodebenchCandidateCommit)) {
    fail(
      "candidate_commit_invalid",
      "Image attestation candidate commit must be a full Git SHA-1.",
    );
  }
  assertObject(value.upstream, "Image attestation.upstream");
  exactKeys(
    value.upstream,
    [
      "package",
      "version",
      "releaseTag",
      "releaseCommit",
      "annotatedTagObject",
      "inspectedRef",
    ],
    "Image attestation.upstream",
  );
}

function assertActiveGraphImageAttestation({
  imageAttestationPath,
  sandboxExecutable,
  sandboxImage,
  spawnSyncImpl,
  sourceEnvironment,
  activeGraphRoot = resolve(REPO_ROOT, "evals", "activegraph"),
  nodebenchCandidateCommit,
}) {
  const { resolvedPath, value } = readImageAttestation(imageAttestationPath);
  assertImageAttestationShape(value);
  if (value.image !== sandboxImage) {
    fail(
      "image_attestation_mismatch",
      "Attested image digest does not match sandboxImage.",
    );
  }
  const expected = createActiveGraphImageAttestation({
    sandboxImage,
    nodebenchCandidateCommit,
    activeGraphRoot,
  });
  if (value.buildInputsHash !== expected.buildInputsHash) {
    fail(
      "image_source_mismatch",
      "Attested image was not built from the current canonical inputs.",
    );
  }
  if (value.nodebenchCandidateCommit !== expected.nodebenchCandidateCommit) {
    fail(
      "candidate_commit_mismatch",
      "Attested image belongs to another NodeBench candidate commit.",
    );
  }
  if (
    value.upstreamHash !== expected.upstreamHash ||
    canonicalJson(value.upstream) !== canonicalJson(expected.upstream)
  ) {
    fail(
      "upstream_attestation_mismatch",
      "Attested ActiveGraph upstream refs do not match the audited record.",
    );
  }
  if (value.attestationHash !== expected.attestationHash) {
    fail(
      "image_attestation_hash_mismatch",
      "Image attestation content does not match attestationHash.",
    );
  }

  const inspected = spawnSyncImpl(
    sandboxExecutable,
    ["image", "inspect", "--format", "{{json .Config.Labels}}", sandboxImage],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      shell: false,
      env: buildOfflineCanaryEnvironment(sourceEnvironment),
      timeout: INSPECT_TIMEOUT_MS,
      maxBuffer: INSPECT_MAX_BUFFER_BYTES,
    },
  );
  if (inspected.error || inspected.status !== 0) {
    fail(
      "image_attestation_inspect_failed",
      String(
        inspected.error?.message ||
          inspected.stderr ||
          "Docker image inspect failed",
      ),
    );
  }
  let labels;
  try {
    labels = JSON.parse(String(inspected.stdout || ""));
  } catch {
    fail(
      "image_attestation_inspect_failed",
      "Docker image labels were not valid JSON.",
    );
  }
  assertObject(labels, "Docker image labels");
  const expectedLabels = imageLabelsForActiveGraphAttestation(expected);
  for (const [label, expectedValue] of Object.entries(expectedLabels)) {
    if (labels[label] !== expectedValue) {
      fail(
        "image_label_mismatch",
        `Docker image label ${label} does not match its attestation.`,
      );
    }
  }
  return Object.freeze({ ...expected, path: resolvedPath });
}

function assertRegularNonemptyFile(path, label, maxBytes) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    fail("artifact_missing", `${label} was not produced.`);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1) {
    fail("artifact_invalid", `${label} must be a non-empty regular file.`);
  }
  if (stats.size > maxBytes) {
    fail(
      "artifact_too_large",
      `${label} exceeds the ${maxBytes}-byte artifact bound.`,
    );
  }
}

function readSqliteHeader(path) {
  const header = Buffer.alloc(16);
  let descriptor;
  try {
    descriptor = openSync(path, "r");
    const bytesRead = readSync(descriptor, header, 0, header.length, 0);
    if (bytesRead !== header.length) {
      fail(
        "sqlite_artifact_invalid",
        "ActiveGraph SQLite header is truncated.",
      );
    }
    return header.toString("binary");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertExactCanaryArtifacts({
  runDirectory,
  sourcePath,
  sourceBytes,
  stagedExportPath,
  stagedBytes,
  reportPath,
  dbPath,
}) {
  const expectedNames = [
    "activegraph.sqlite3",
    "nodekit-run-export.json",
    "report.json",
  ];
  const actualNames = readdirSync(runDirectory).sort();
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    fail(
      "artifact_set_invalid",
      "Canary output must contain exactly the export copy, SQLite DB, and report.",
    );
  }
  assertRegularNonemptyFile(
    stagedExportPath,
    "Staged export",
    MAX_EXPORT_BYTES,
  );
  assertRegularNonemptyFile(reportPath, "Replay report", MAX_REPORT_BYTES);
  assertRegularNonemptyFile(
    dbPath,
    "ActiveGraph SQLite database",
    MAX_SQLITE_BYTES,
  );
  const currentSourceBytes = readBoundedRegularFile(sourcePath, {
    label: "source export",
    maxBytes: MAX_EXPORT_BYTES,
    missingCode: "source_mutated",
    invalidCode: "source_mutated",
    tooLargeCode: "source_mutated",
  });
  if (!currentSourceBytes.equals(sourceBytes)) {
    fail(
      "source_mutated",
      "The source export changed during canary execution.",
    );
  }
  const currentStagedBytes = readBoundedRegularFile(stagedExportPath, {
    label: "staged export",
    maxBytes: MAX_EXPORT_BYTES,
    missingCode: "staged_export_mutated",
    invalidCode: "staged_export_mutated",
    tooLargeCode: "staged_export_mutated",
  });
  if (!currentStagedBytes.equals(stagedBytes)) {
    fail(
      "staged_export_mutated",
      "The disposable export changed during canary execution.",
    );
  }
  const sqliteHeader = readSqliteHeader(dbPath);
  if (sqliteHeader !== "SQLite format 3\u0000") {
    fail(
      "sqlite_artifact_invalid",
      "ActiveGraph output is not a SQLite 3 database.",
    );
  }
}

export async function runActiveGraphCanaryFromExport({
  exportPath,
  evidenceRoot = resolve(REPO_ROOT, ".tmp", "activegraph-canary", "nodekit"),
  runDirectoryName = randomUUID(),
  sandboxExecutable = "docker",
  sandboxImage,
  imageAttestationPath,
  spawnSyncImpl = spawnSync,
  sourceEnvironment = process.env,
  _testOnlyAllowDirtyBuildInputs = false,
}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runDirectoryName)) {
    fail("run_directory_invalid", "runDirectoryName is not a safe leaf name.");
  }
  const resolvedExportPath = resolve(exportPath);
  let sourceBytes;
  let exportDoc;
  try {
    sourceBytes = readBoundedRegularFile(resolvedExportPath, {
      label: "source export",
      maxBytes: MAX_EXPORT_BYTES,
      missingCode: "export_read_failed",
      invalidCode: "export_read_failed",
      tooLargeCode: "export_too_large",
    });
    exportDoc = JSON.parse(sourceBytes.toString("utf8"));
  } catch (error) {
    if (error instanceof NodeKitExportBoundaryError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    fail("export_read_failed", `Unable to read export: ${detail}`);
  }
  assertCanonicalNodeKitRunExport(exportDoc);
  assertImmutableSandboxImage(sandboxImage);
  const nodebenchCandidateCommit = readNodeBenchCandidateCommit();
  if (!_testOnlyAllowDirtyBuildInputs) {
    assertCommittedActiveGraphBuildInputs({});
  }
  const imageAttestation = assertActiveGraphImageAttestation({
    imageAttestationPath,
    sandboxExecutable,
    sandboxImage,
    spawnSyncImpl,
    sourceEnvironment,
    nodebenchCandidateCommit,
  });

  const resolvedEvidenceRoot = resolve(evidenceRoot);
  const runDirectory = resolve(resolvedEvidenceRoot, runDirectoryName);
  const relativeRun = relative(resolvedEvidenceRoot, runDirectory);
  if (
    !relativeRun ||
    isAbsolute(relativeRun) ||
    relativeRun === ".." ||
    relativeRun.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    fail("run_directory_invalid", "Evidence directory escaped its root.");
  }
  if (runDirectory.includes(",")) {
    fail(
      "evidence_path_invalid",
      "Docker bind-mount paths cannot contain commas.",
    );
  }
  const stagedExportPath = resolve(runDirectory, "nodekit-run-export.json");
  if (stagedExportPath === resolvedExportPath) {
    fail("source_copy_required", "The canary must consume a disposable copy.");
  }
  const stagedBytes = Buffer.from(`${canonicalJson(exportDoc)}\n`, "utf8");
  if (stagedBytes.length > MAX_EXPORT_BYTES) {
    fail(
      "export_too_large",
      `Canonical export exceeds the ${MAX_EXPORT_BYTES}-byte input bound.`,
    );
  }

  mkdirSync(resolvedEvidenceRoot, { recursive: true });
  try {
    mkdirSync(runDirectory, { recursive: false });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(
      "evidence_directory_exists",
      `Evidence directory already exists: ${detail}`,
    );
  }
  writeFileSync(stagedExportPath, stagedBytes, {
    encoding: "utf8",
    flag: "wx",
  });
  const reportPath = resolve(runDirectory, "report.json");
  const dbPath = resolve(runDirectory, "activegraph.sqlite3");
  const userArgs =
    typeof process.getuid === "function" && typeof process.getgid === "function"
      ? ["--user", `${process.getuid()}:${process.getgid()}`]
      : [];
  const args = [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    "64",
    "--memory",
    "512m",
    "--cpus",
    "1",
    ...userArgs,
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--mount",
    `type=bind,src=${runDirectory},dst=/evidence`,
    "--env",
    "NODEBENCH_ACTIVEGRAPH_MODE=offline-observer",
    "--env",
    "PYTHONDONTWRITEBYTECODE=1",
    "--env",
    `NODEBENCH_ACTIVEGRAPH_SANDBOX_IMAGE=${sandboxImage}`,
    "--env",
    `NODEBENCH_ACTIVEGRAPH_BUILD_INPUTS_SHA256=${imageAttestation.buildInputsHash}`,
    "--env",
    `NODEBENCH_CANDIDATE_COMMIT=${imageAttestation.nodebenchCandidateCommit}`,
    "--env",
    `NODEBENCH_ACTIVEGRAPH_UPSTREAM_SHA256=${imageAttestation.upstreamHash}`,
    "--env",
    `NODEBENCH_ACTIVEGRAPH_IMAGE_ATTESTATION_SHA256=${imageAttestation.attestationHash}`,
    sandboxImage,
    "python",
    "-I",
    "-m",
    "nodebench_activegraph_canary.nodekit_replay_cli",
    "--input",
    "/evidence/nodekit-run-export.json",
    "--output",
    "/evidence/report.json",
    "--db",
    "/evidence/activegraph.sqlite3",
  ];
  const child = spawnSyncImpl(sandboxExecutable, args, {
    cwd: runDirectory,
    encoding: "utf8",
    shell: false,
    env: buildOfflineCanaryEnvironment(sourceEnvironment),
    timeout: CHILD_TIMEOUT_MS,
    maxBuffer: CHILD_MAX_BUFFER_BYTES,
  });
  if (child.error) {
    if (child.error.code === "ETIMEDOUT") {
      fail(
        "canary_timeout",
        `ActiveGraph canary exceeded its ${CHILD_TIMEOUT_MS}ms runtime budget.`,
      );
    }
    fail("canary_spawn_failed", child.error.message);
  }
  if (child.status !== 0) {
    fail(
      "canary_process_failed",
      `ActiveGraph canary exited with code ${String(child.status)}: ${String(
        child.stderr || child.stdout || "",
      ).trim()}`,
    );
  }
  assertExactCanaryArtifacts({
    runDirectory,
    sourcePath: resolvedExportPath,
    sourceBytes,
    stagedExportPath,
    stagedBytes,
    reportPath,
    dbPath,
  });

  let report;
  try {
    report = JSON.parse(
      readBoundedRegularFile(reportPath, {
        label: "ActiveGraph report",
        maxBytes: MAX_REPORT_BYTES,
        missingCode: "report_read_failed",
        invalidCode: "report_read_failed",
        tooLargeCode: "artifact_too_large",
      }).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof NodeKitExportBoundaryError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    fail("report_read_failed", `Unable to read ActiveGraph report: ${detail}`);
  }
  assertChildReport(report, exportDoc, imageAttestation);
  return Object.freeze({
    runDirectory,
    stagedExportPath,
    reportPath,
    dbPath,
    sandboxImage,
    imageAttestation,
    report: Object.freeze(report),
  });
}

function parseCliArgs(argv) {
  const result = {};
  const allowed = new Set([
    "input",
    "evidence-root",
    "sandbox-image",
    "image-attestation",
    "docker",
    "run-name",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("cli_args_invalid", "CLI arguments must be --key value pairs.");
    }
    const name = key.slice(2);
    if (!allowed.has(name) || name in result) {
      fail("cli_args_invalid", `Unknown or duplicate CLI argument: --${name}.`);
    }
    result[name] = value;
  }
  for (const required of [
    "input",
    "evidence-root",
    "sandbox-image",
    "image-attestation",
  ]) {
    if (!result[required])
      fail("cli_args_invalid", `--${required} is required.`);
  }
  return result;
}

function parseAttestationCliArgs(argv) {
  const result = {};
  const allowed = new Set(["attestation-output", "sandbox-image"]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("cli_args_invalid", "CLI arguments must be --key value pairs.");
    }
    const name = key.slice(2);
    if (!allowed.has(name) || name in result) {
      fail("cli_args_invalid", `Unknown or duplicate CLI argument: --${name}.`);
    }
    result[name] = value;
  }
  for (const required of allowed) {
    if (!result[required]) {
      fail("cli_args_invalid", `--${required} is required.`);
    }
  }
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const cliArguments = process.argv.slice(2);
  try {
    if (
      cliArguments.length === 1 &&
      cliArguments[0] === "--print-build-metadata"
    ) {
      assertCommittedActiveGraphBuildInputs({});
      const metadata = createActiveGraphBuildMetadata({
        nodebenchCandidateCommit: readNodeBenchCandidateCommit(),
      });
      process.stdout.write(`${JSON.stringify(metadata)}\n`);
    } else if (cliArguments.includes("--attestation-output")) {
      const args = parseAttestationCliArgs(cliArguments);
      assertCommittedActiveGraphBuildInputs({});
      const attestation = createActiveGraphImageAttestation({
        sandboxImage: args["sandbox-image"],
        nodebenchCandidateCommit: readNodeBenchCandidateCommit(),
      });
      const outputPath = resolve(args["attestation-output"]);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${canonicalJson(attestation)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      process.stdout.write(
        `${JSON.stringify({ outputPath, attestationHash: attestation.attestationHash })}\n`,
      );
    } else {
      const args = parseCliArgs(cliArguments);
      runActiveGraphCanaryFromExport({
        exportPath: args.input,
        evidenceRoot: args["evidence-root"],
        runDirectoryName: args["run-name"],
        sandboxImage: args["sandbox-image"],
        imageAttestationPath: args["image-attestation"],
        sandboxExecutable: args.docker,
      })
        .then((result) => {
          process.stdout.write(`${JSON.stringify(result)}\n`);
        })
        .catch((error) => {
          process.stderr.write(
            `${error instanceof Error ? error.message : error}\n`,
          );
          process.exitCode = 1;
        });
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
