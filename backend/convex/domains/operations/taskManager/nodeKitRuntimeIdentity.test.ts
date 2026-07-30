import { describe, expect, it } from "vitest";

import {
  buildNodeKitNativeIdentityRef,
  buildNodeKitNativeSessionIdentity,
  compareNodeKitNativeSessionIdentity,
  validateNodeKitNativeSessionIdentityInput,
} from "./nodeKitRuntimeIdentity";

const baseIdentity = {
  identityRef: "nodebench:agent-identity:agent_doc_123",
  agentId: "codex.desktop",
  workspaceId: "workspace:nodebench",
  nativeSessionId: "session:desktop:2026-07-29",
  nativeSessionGeneration: 4,
  peerId: "peer:runner:codex",
} as const;

describe("NodeKit native agent session identity", () => {
  it("derives a stable opaque reference from storage-engine-specific IDs", async () => {
    const first = await buildNodeKitNativeIdentityRef(
      "mock;agentIdentities:opaque/storage-id",
    );
    const second = await buildNodeKitNativeIdentityRef(
      "mock;agentIdentities:opaque/storage-id",
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^nodebench:agent-identity:[a-f0-9]{64}$/);
    expect(first).not.toContain("mock");
  });

  it("binds a persistent agent, workspace, peer, and session generation into one deterministic snapshot", async () => {
    const first = await buildNodeKitNativeSessionIdentity(baseIdentity);
    const reordered = await buildNodeKitNativeSessionIdentity({
      peerId: baseIdentity.peerId,
      nativeSessionGeneration: baseIdentity.nativeSessionGeneration,
      nativeSessionId: baseIdentity.nativeSessionId,
      workspaceId: baseIdentity.workspaceId,
      agentId: baseIdentity.agentId,
      identityRef: baseIdentity.identityRef,
    });

    expect(first).toEqual(reordered);
    expect(first.schemaVersion).toBe(
      "nodekit.native-agent-session-identity/v1",
    );
    expect(first.snapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("classifies a reconnect without rotating the native session identity", async () => {
    const previous = await buildNodeKitNativeSessionIdentity(baseIdentity);
    const next = await buildNodeKitNativeSessionIdentity(baseIdentity);

    expect(compareNodeKitNativeSessionIdentity(previous, next)).toBe(
      "reconnect",
    );
  });

  it("accepts a higher generation as an explicit restart or rotation", async () => {
    const previous = await buildNodeKitNativeSessionIdentity(baseIdentity);
    const next = await buildNodeKitNativeSessionIdentity({
      ...baseIdentity,
      nativeSessionId: "session:desktop:2026-07-30",
      nativeSessionGeneration: 5,
    });

    expect(compareNodeKitNativeSessionIdentity(previous, next)).toBe("rotate");
  });

  it.each([
    {
      label: "empty agent",
      input: { ...baseIdentity, agentId: "" },
      code: "native_identity_field_invalid",
    },
    {
      label: "unsafe session identifier",
      input: { ...baseIdentity, nativeSessionId: "session with spaces" },
      code: "native_identity_field_invalid",
    },
    {
      label: "fractional generation",
      input: { ...baseIdentity, nativeSessionGeneration: 4.5 },
      code: "native_session_generation_invalid",
    },
  ])("rejects $label before persistence", ({ input, code }) => {
    expect(() => validateNodeKitNativeSessionIdentityInput(input)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it.each([
    {
      label: "stale generation",
      next: { ...baseIdentity, nativeSessionGeneration: 3 },
      code: "native_session_stale",
    },
    {
      label: "same generation with a different session",
      next: { ...baseIdentity, nativeSessionId: "session:spoofed" },
      code: "native_session_collision",
    },
    {
      label: "same session with a different peer",
      next: { ...baseIdentity, peerId: "peer:runner:unknown" },
      code: "native_peer_mismatch",
    },
    {
      label: "cross-workspace replay",
      next: { ...baseIdentity, workspaceId: "workspace:other" },
      code: "native_identity_scope_mismatch",
    },
  ])("rejects $label", async ({ next, code }) => {
    const previous = await buildNodeKitNativeSessionIdentity(baseIdentity);
    const candidate = await buildNodeKitNativeSessionIdentity(next);

    expect(() =>
      compareNodeKitNativeSessionIdentity(previous, candidate),
    ).toThrowError(
      expect.objectContaining({ code }),
    );
  });
});
