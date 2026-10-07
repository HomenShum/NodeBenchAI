import { describe, expect, it } from "vitest";

import { api, internal } from "../../_generated/api";
import schema from "../../schema";

const DIR_SEGMENTS = ["domains", "agents"];
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
  Object.entries(import.meta.glob("../../**/*.{ts,js}")).map(
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

const traceApi = (api as any).domains.agents.traceAuditLog;
const traceInternal = (internal as any).domains.agents.traceAuditLog;

function auditEntry(executionId: string, seq: number, userId?: any) {
  return {
    executionId,
    userId,
    executionType: "chat" as const,
    seq,
    timestamp: 1_700_000_000_000 + seq,
    choiceType: seq === 1 ? ("finalize" as const) : ("gather_info" as const),
    toolName: seq === 1 ? "traceFinalize" : "search",
    provenance: seq === 1 ? ("ai_model" as const) : ("deterministic_code" as const),
    toolParams: { privateQuery: `owner-step-${seq}` },
    metadata: {
      durationMs: 10,
      success: true,
      originalRequest: `private request ${seq}`,
    },
    description: `owner step ${seq}`,
    createdAt: 1_700_000_000_000 + seq,
  };
}

describe.skipIf(!convexTestAvailable)("TRACE audit ownership", () => {
  it("fails closed and isolates identical execution ids by authenticated owner", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const ownerA = await ctx.db.insert("users", { email: "trace-a@example.com" });
      const ownerB = await ctx.db.insert("users", { email: "trace-b@example.com" });
      await ctx.db.insert("traceAuditEntries", auditEntry("shared-execution", 0, ownerA));
      await ctx.db.insert("traceAuditEntries", auditEntry("shared-execution", 1, ownerA));
      await ctx.db.insert("traceAuditEntries", auditEntry("shared-execution", 7, ownerB));
      await ctx.db.insert("traceAuditEntries", auditEntry("shared-execution", 9));
      return { ownerA, ownerB };
    });

    expect(await t.query(traceApi.getAuditLog, { executionId: "shared-execution" })).toEqual([]);
    expect(await t.query(traceApi.getAuditSummary, { executionId: "shared-execution" }))
      .toMatchObject({ totalSteps: 0, toolsUsed: [] });

    const ownerA = t.withIdentity({ subject: String(seeded.ownerA) });
    const ownerB = t.withIdentity({ subject: String(seeded.ownerB) });
    const rowsA = await ownerA.query(traceApi.getAuditLog, { executionId: "shared-execution" });
    const rowsB = await ownerB.query(traceApi.getAuditLog, { executionId: "shared-execution" });

    expect(rowsA.map((row: any) => row.seq)).toEqual([0, 1]);
    expect(rowsA.map((row: any) => row.provenance)).toEqual(["deterministic_code", "ai_model"]);
    expect(rowsA.every((row: any) => row.userId === seeded.ownerA)).toBe(true);
    expect(rowsB.map((row: any) => row.seq)).toEqual([7]);
    expect(await ownerA.query(traceApi.getAuditSummary, { executionId: "shared-execution" }))
      .toMatchObject({ totalSteps: 2, hasFinalized: true });
    expect(await ownerB.query(traceApi.getAuditSummary, { executionId: "shared-execution" }))
      .toMatchObject({ totalSteps: 1, hasFinalized: false });
    expect(await ownerA.query(traceApi.getAuditLog, { executionId: "missing" })).toEqual([]);

    await expect(ownerA.query(traceApi.getAuditLog, {
      executionId: "shared-execution",
      userId: seeded.ownerB,
    })).rejects.toThrow();

    expect(await t.query(traceInternal.getAuditSummaryInternal, {
      executionId: "shared-execution",
      userId: seeded.ownerA,
    })).toMatchObject({ totalSteps: 2 });
  });
});
