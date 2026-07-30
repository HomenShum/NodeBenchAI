import { describe, expect, it } from "vitest";

import { legacyNativeIdentityPatch } from "./nodeKitNativeIdentityMigration";

describe("legacy native identity retirement", () => {
  it.each(["agentTaskSessions", "agentTaskTraces"] as const)(
    "removes the combined snapshot from %s without touching canonical refs",
    (table) => {
      const patch = legacyNativeIdentityPatch(table, {
        nativeIdentity: { nativeSessionGeneration: 4 },
        nativeSessionReference: { workspaceId: "canonical" },
      });
      expect(patch).toEqual({ nativeIdentity: undefined });
      expect(patch).not.toHaveProperty("nativeSessionReference");
    },
  );

  it("removes every native lifecycle field from persistent agent profiles", () => {
    expect(
      legacyNativeIdentityPatch("agentIdentities", {
        identityContractVersion: "legacy",
        nativeSessionId: "raw-provider-id",
        nativeSessionGeneration: 4,
        nativePeerId: "host-bound-peer",
        nativeIdentitySnapshotHash: "legacy-hash",
      }),
    ).toEqual({
      identityContractVersion: undefined,
      nativeSessionId: undefined,
      nativeSessionGeneration: undefined,
      nativePeerId: undefined,
      nativeIdentitySnapshotHash: undefined,
    });
  });

  it("is idempotent for already retired rows", () => {
    expect(legacyNativeIdentityPatch("agentTaskSessions", {})).toBeNull();
    expect(legacyNativeIdentityPatch("agentTaskTraces", {})).toBeNull();
    expect(legacyNativeIdentityPatch("agentIdentities", {})).toBeNull();
  });
});
