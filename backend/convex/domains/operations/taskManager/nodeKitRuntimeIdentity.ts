import {
  deepFreezeNodeKitValue,
  sha256CanonicalNodeKitValue,
} from "./nodeKitRunEvents";

export const NODEKIT_NATIVE_SESSION_REFERENCE_VERSION =
  "nodekit.native-session-reference/v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const WORKSPACE_ID = /^workspace:sha256:[a-f0-9]{64}$/;
const SESSION_ID = /^session:sha256:[a-f0-9]{64}$/;
const WORKSPACE_REF = /^native-workspace:sha256:[a-f0-9]{64}$/;
const SESSION_REF = /^native-agent-session:sha256:[a-f0-9]{64}$/;
const CHECKPOINT_REF = /^native-session-checkpoint:sha256:[a-f0-9]{64}$/;

export type NodeKitNativeSessionReferenceInput = Readonly<{
  workspaceId: string;
  sessionId: string;
  workspaceArtifactRef: string;
  workspaceArtifactDigest: string;
  sessionArtifactRef: string;
  sessionArtifactDigest: string;
  checkpointArtifactRef: string;
  checkpointArtifactDigest: string;
}>;

export type NodeKitNativeSessionReference = NodeKitNativeSessionReferenceInput &
  Readonly<{
    schemaVersion: typeof NODEKIT_NATIVE_SESSION_REFERENCE_VERSION;
    referenceHash: string;
  }>;

export class NodeKitRuntimeIdentityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "NodeKitRuntimeIdentityError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new NodeKitRuntimeIdentityError(code, message);
}

function assertValue(value: string, field: string, pattern: RegExp): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    !pattern.test(value)
  ) {
    fail(
      "native_session_reference_invalid",
      `${field} is not a canonical bounded NodeKit reference.`,
    );
  }
}

export function validateNodeKitNativeSessionReferenceInput(
  input: NodeKitNativeSessionReferenceInput,
): void {
  assertValue(input.workspaceId, "workspaceId", WORKSPACE_ID);
  assertValue(input.sessionId, "sessionId", SESSION_ID);
  assertValue(
    input.workspaceArtifactRef,
    "workspaceArtifactRef",
    WORKSPACE_REF,
  );
  assertValue(input.workspaceArtifactDigest, "workspaceArtifactDigest", SHA256);
  assertValue(input.sessionArtifactRef, "sessionArtifactRef", SESSION_REF);
  assertValue(input.sessionArtifactDigest, "sessionArtifactDigest", SHA256);
  assertValue(
    input.checkpointArtifactRef,
    "checkpointArtifactRef",
    CHECKPOINT_REF,
  );
  assertValue(
    input.checkpointArtifactDigest,
    "checkpointArtifactDigest",
    SHA256,
  );
}

export async function buildNodeKitNativeSessionReference(
  input: NodeKitNativeSessionReferenceInput,
): Promise<NodeKitNativeSessionReference> {
  validateNodeKitNativeSessionReferenceInput(input);
  const body = {
    schemaVersion: NODEKIT_NATIVE_SESSION_REFERENCE_VERSION,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    workspaceArtifactRef: input.workspaceArtifactRef,
    workspaceArtifactDigest: input.workspaceArtifactDigest,
    sessionArtifactRef: input.sessionArtifactRef,
    sessionArtifactDigest: input.sessionArtifactDigest,
    checkpointArtifactRef: input.checkpointArtifactRef,
    checkpointArtifactDigest: input.checkpointArtifactDigest,
  } as const;
  return deepFreezeNodeKitValue({
    ...body,
    referenceHash: await sha256CanonicalNodeKitValue(body),
  });
}
