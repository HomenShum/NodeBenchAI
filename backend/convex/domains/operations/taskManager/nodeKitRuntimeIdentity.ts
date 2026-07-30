import {
  deepFreezeNodeKitValue,
  sha256CanonicalNodeKitValue,
} from "./nodeKitRunEvents";

export const NODEKIT_NATIVE_AGENT_SESSION_IDENTITY_VERSION =
  "nodekit.native-agent-session-identity/v1" as const;

export type NodeKitNativeSessionIdentity = Readonly<{
  schemaVersion: typeof NODEKIT_NATIVE_AGENT_SESSION_IDENTITY_VERSION;
  identityRef: string;
  agentId: string;
  workspaceId: string;
  nativeSessionId: string;
  nativeSessionGeneration: number;
  peerId?: string;
  snapshotHash: string;
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

function assertBoundedId(value: string, field: string, maxLength = 256): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
  ) {
    fail(
      "native_identity_field_invalid",
      `${field} must be a non-empty bounded identifier.`,
    );
  }
}

export type NodeKitNativeSessionIdentityInput = Readonly<{
  agentId: string;
  workspaceId: string;
  nativeSessionId: string;
  nativeSessionGeneration: number;
  peerId?: string;
}>;

export function validateNodeKitNativeSessionIdentityInput(
  input: NodeKitNativeSessionIdentityInput,
): void {
  assertBoundedId(input.agentId, "agentId", 128);
  assertBoundedId(input.workspaceId, "workspaceId");
  assertBoundedId(input.nativeSessionId, "nativeSessionId");
  if (input.peerId !== undefined) assertBoundedId(input.peerId, "peerId");
  if (
    !Number.isSafeInteger(input.nativeSessionGeneration) ||
    input.nativeSessionGeneration < 0
  ) {
    fail(
      "native_session_generation_invalid",
      "nativeSessionGeneration must be a non-negative safe integer.",
    );
  }
}

export async function buildNodeKitNativeIdentityRef(
  storageIdentityId: string,
): Promise<string> {
  if (
    typeof storageIdentityId !== "string" ||
    storageIdentityId.length === 0 ||
    storageIdentityId.length > 512
  ) {
    fail(
      "native_identity_storage_id_invalid",
      "The storage identity ID must be non-empty and bounded.",
    );
  }
  const digest = await sha256CanonicalNodeKitValue({ storageIdentityId });
  return `nodebench:agent-identity:${digest.slice("sha256:".length)}`;
}

export async function buildNodeKitNativeSessionIdentity(
  input: NodeKitNativeSessionIdentityInput & { identityRef: string },
): Promise<NodeKitNativeSessionIdentity> {
  assertBoundedId(input.identityRef, "identityRef");
  validateNodeKitNativeSessionIdentityInput(input);

  const body = {
    schemaVersion: NODEKIT_NATIVE_AGENT_SESSION_IDENTITY_VERSION,
    identityRef: input.identityRef,
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    nativeSessionId: input.nativeSessionId,
    nativeSessionGeneration: input.nativeSessionGeneration,
    ...(input.peerId === undefined ? {} : { peerId: input.peerId }),
  } as const;

  return deepFreezeNodeKitValue({
    ...body,
    snapshotHash: await sha256CanonicalNodeKitValue(body),
  });
}

export function compareNodeKitNativeSessionIdentity(
  previous: NodeKitNativeSessionIdentity,
  next: NodeKitNativeSessionIdentity,
): "reconnect" | "rotate" {
  if (
    previous.identityRef !== next.identityRef ||
    previous.agentId !== next.agentId ||
    previous.workspaceId !== next.workspaceId
  ) {
    fail(
      "native_identity_scope_mismatch",
      "A native session cannot cross an agent or workspace identity boundary.",
    );
  }
  if (next.nativeSessionGeneration < previous.nativeSessionGeneration) {
    fail(
      "native_session_stale",
      "The native session generation is older than the persisted identity state.",
    );
  }
  if (
    next.nativeSessionGeneration === previous.nativeSessionGeneration &&
    next.nativeSessionId !== previous.nativeSessionId
  ) {
    fail(
      "native_session_collision",
      "One native session generation cannot identify two different sessions.",
    );
  }
  if (
    next.nativeSessionGeneration === previous.nativeSessionGeneration &&
    previous.peerId !== undefined &&
    next.peerId !== previous.peerId
  ) {
    fail(
      "native_peer_mismatch",
      "A reconnect cannot replace the peer bound to the active native session.",
    );
  }
  return next.nativeSessionGeneration === previous.nativeSessionGeneration
    ? "reconnect"
    : "rotate";
}
