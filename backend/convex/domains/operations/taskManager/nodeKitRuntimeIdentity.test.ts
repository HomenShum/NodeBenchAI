import { describe, expect, it } from "vitest";

import {
  buildNodeKitNativeSessionReference,
  validateNodeKitNativeSessionReferenceInput,
} from "./nodeKitRuntimeIdentity";

const hash = (character: string) => character.repeat(64);
const reference = {
  workspaceId: `workspace:sha256:${hash("a")}`,
  sessionId: `session:sha256:${hash("b")}`,
  workspaceArtifactRef: `native-workspace:sha256:${hash("c")}`,
  workspaceArtifactDigest: hash("c"),
  sessionArtifactRef: `native-agent-session:sha256:${hash("d")}`,
  sessionArtifactDigest: hash("d"),
  checkpointArtifactRef: `native-session-checkpoint:sha256:${hash("e")}`,
  checkpointArtifactDigest: hash("e"),
} as const;

describe("NodeKit native session artifact reference", () => {
  it("builds one deterministic refs-and-digests-only projection", async () => {
    const first = await buildNodeKitNativeSessionReference(reference);
    const reordered = await buildNodeKitNativeSessionReference({
      checkpointArtifactDigest: reference.checkpointArtifactDigest,
      sessionArtifactDigest: reference.sessionArtifactDigest,
      workspaceArtifactDigest: reference.workspaceArtifactDigest,
      checkpointArtifactRef: reference.checkpointArtifactRef,
      sessionArtifactRef: reference.sessionArtifactRef,
      workspaceArtifactRef: reference.workspaceArtifactRef,
      sessionId: reference.sessionId,
      workspaceId: reference.workspaceId,
    });

    expect(first).toEqual(reordered);
    expect(first.schemaVersion).toBe("nodekit.native-session-reference/v1");
    expect(first.referenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toMatch(
      /owner|provider|credential|generation|host|resumable|status|cursor/i,
    );
  });

  it.each([
    ["raw workspace label", { workspaceId: "workspace:nodebench" }],
    ["raw session label", { sessionId: "session:provider-raw" }],
    ["malformed artifact ref", { checkpointArtifactRef: "checkpoint:raw" }],
    ["malformed digest", { sessionArtifactDigest: "not-a-hash" }],
  ])("rejects %s before persistence", (_label, override) => {
    expect(() =>
      validateNodeKitNativeSessionReferenceInput({
        ...reference,
        ...override,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "native_session_reference_invalid" }),
    );
  });

  it("does not expose legacy combined-identity lifecycle functions", async () => {
    const module = await import("./nodeKitRuntimeIdentity");
    expect(Object.keys(module).sort()).toEqual([
      "NODEKIT_NATIVE_SESSION_REFERENCE_VERSION",
      "NodeKitRuntimeIdentityError",
      "buildNodeKitNativeSessionReference",
      "validateNodeKitNativeSessionReferenceInput",
    ]);
  });
});
