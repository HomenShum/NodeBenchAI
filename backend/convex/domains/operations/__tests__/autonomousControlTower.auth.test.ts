/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import { api, internal } from "../../../_generated/api";
import schema from "../../../schema";

const DIR_SEGMENTS = ["domains", "operations", "__tests__"];
function rerootGlobKey(key: string): string {
  const parts = key.replace(/^\.\//, "").split("/");
  const base = [...DIR_SEGMENTS];
  while (parts[0] === "..") {
    parts.shift();
    base.pop();
  }
  return [...base, ...parts].join("/");
}

const convexModules = Object.fromEntries(
  Object.entries(import.meta.glob("../../../**/*.{ts,js}")).map(
    ([key, loader]) => [rerootGlobKey(key), loader],
  ),
);

let convexTest: any;
let convexTestAvailable = false;
try {
  const mod = await import(/* @vite-ignore */ "convex-test");
  convexTest = mod.convexTest;
  convexTestAvailable = typeof convexTest === "function";
} catch {
  convexTestAvailable = false;
}

const operationsApi = (api as any).domains.operations.autonomousControlTower;
const agentHubApi = (api as any).domains.agents.agentHubQueries;
const operationsInternal = (internal as any).domains.operations.autonomousControlTower;

async function seedAccessFixtures(t: any) {
  return await t.run(async (ctx: any) => {
    const owner = await ctx.db.insert("users", { email: "owner@example.com" });
    const admin = await ctx.db.insert("users", { email: "admin@example.com" });
    const viewer = await ctx.db.insert("users", { email: "viewer@example.com" });
    const member = await ctx.db.insert("users", { email: "member@example.com" });

    for (const [userId, email, role] of [
      [owner, "owner@example.com", "owner"],
      [admin, "admin@example.com", "admin"],
      [viewer, "viewer@example.com", "viewer"],
    ] as const) {
      await ctx.db.insert("adminUsers", {
        userId,
        email,
        role,
        permissions: [],
        createdAt: Date.now(),
      });
    }

    return { owner, admin, viewer, member };
  });
}

describe.skipIf(!convexTestAvailable)("autonomous operations authorization", () => {
  it("fails closed for anonymous and ordinary members on global reads", async () => {
    const t = convexTest(schema, convexModules);
    const { member } = await seedAccessFixtures(t);

    await expect(
      t.query(agentHubApi.getAutonomousCronStatus, {}),
    ).rejects.toThrow(/not authenticated/i);
    await expect(
      t.query(operationsApi.getAutonomousControlTowerSnapshot, {}),
    ).rejects.toThrow(/not authenticated/i);

    const memberSession = t.withIdentity({ subject: String(member) });
    await expect(
      memberSession.query(agentHubApi.getAutonomousCronStatus, {}),
    ).rejects.toThrow(/operator-only/i);
    await expect(
      memberSession.query(operationsApi.getAutonomousControlTowerSnapshot, {}),
    ).rejects.toThrow(/operator-only/i);
  });

  it("allows viewers to read measured health while keeping writes owner/admin-only", async () => {
    const t = convexTest(schema, convexModules);
    const { owner, admin, viewer } = await seedAccessFixtures(t);
    const viewerSession = t.withIdentity({ subject: String(viewer) });

    const rows = await viewerSession.query(agentHubApi.getAutonomousCronStatus, {});
    expect(rows).toHaveLength(8);
    expect(rows.every((row: any) => row.status === "unknown" && row.isStale)).toBe(true);
    const snapshot = await viewerSession.query(
      operationsApi.getAutonomousControlTowerSnapshot,
      {},
    );
    expect(snapshot.health.overall).toBe("unknown");

    await expect(
      viewerSession.action(operationsApi.runAutonomousMaintenanceNow, {}),
    ).rejects.toThrow(/owner or admin/i);

    await expect(
      t.query(operationsInternal.assertAutonomousMaintenanceAccess, { userId: viewer }),
    ).rejects.toThrow(/owner or admin/i);
    await expect(
      t.query(operationsInternal.assertAutonomousMaintenanceAccess, { userId: owner }),
    ).resolves.toEqual({ role: "owner" });
    await expect(
      t.query(operationsInternal.assertAutonomousMaintenanceAccess, { userId: admin }),
    ).resolves.toEqual({ role: "admin" });
  });

  it("does not synthesize guest agent runtime rows", async () => {
    const t = convexTest(schema, convexModules);
    expect(await t.query(agentHubApi.getAllAgentStatuses, {})).toEqual([]);
  });
});
