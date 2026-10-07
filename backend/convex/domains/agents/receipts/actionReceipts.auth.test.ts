/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import { api, internal } from "../../../_generated/api";
import schema from "../../../schema";

const DIR_SEGMENTS = ["domains", "agents", "receipts"];
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

const receiptsApi = (api as any).domains.agents.receipts.actionReceipts;
const traceApi = (api as any).domains.agents.traceAuditLog;
const NOW = 1_700_000_000_000;

function receiptFields(receiptId: string, userId?: any) {
  return {
    receiptId,
    agentId: "runtime-agent",
    userId,
    toolName: "send_message",
    actionSummary: `Action ${receiptId}`,
    policyId: "policy-owner-scope",
    policyRuleName: "Owner-scoped receipts",
    policyAction: "escalated",
    evidenceRefs: [],
    resultSuccess: false,
    resultSummary: "Held for approval",
    canUndo: false,
    approvalState: "pending",
    approvalRequestedAt: NOW,
    violations: [],
    createdAt: NOW,
  };
}

describe.skipIf(!convexTestAvailable)("action receipt ownership", () => {
  it("fails closed for anonymous callers and returns only the authenticated owner's rows", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const ownerA = await ctx.db.insert("users", { email: "owner-a@example.com" });
      const ownerB = await ctx.db.insert("users", { email: "owner-b@example.com" });
      await ctx.db.insert("actionReceipts", receiptFields("receipt-a", ownerA));
      await ctx.db.insert("actionReceipts", receiptFields("receipt-b", ownerB));
      await ctx.db.insert("actionReceipts", receiptFields("legacy-ownerless"));
      return { ownerA, ownerB };
    });

    expect(await t.query(receiptsApi.list, { limit: 20 })).toEqual([]);
    expect(await t.query(receiptsApi.listPendingApprovals, { limit: 20 })).toEqual([]);

    const ownerA = t.withIdentity({ subject: String(seeded.ownerA) });
    const rows = await ownerA.query(receiptsApi.list, { limit: 20 });
    const pending = await ownerA.query(receiptsApi.listPendingApprovals, { limit: 20 });

    expect(rows.map((row: any) => row.receiptId)).toEqual(["receipt-a"]);
    expect(pending.map((row: any) => row.receiptId)).toEqual(["receipt-a"]);
    expect(await ownerA.query(receiptsApi.getByReceiptId, { receiptId: "receipt-b" })).toBeNull();
    expect(await ownerA.query(receiptsApi.getByReceiptId, { receiptId: "legacy-ownerless" })).toBeNull();
  });

  it("allows only the owner to resolve a receipt and records the authenticated reviewer", async () => {
    const t = convexTest(schema, convexModules);
    const seeded = await t.run(async (ctx: any) => {
      const ownerA = await ctx.db.insert("users", { email: "owner-a@example.com" });
      const ownerB = await ctx.db.insert("users", { email: "owner-b@example.com" });
      await ctx.db.insert("actionReceipts", receiptFields("receipt-a", ownerA));
      return { ownerA, ownerB };
    });

    await expect(
      t.mutation(receiptsApi.resolveApproval, {
        receiptId: "receipt-a",
        decision: "approved",
      }),
    ).rejects.toThrow(/not authenticated/i);

    const ownerB = t.withIdentity({ subject: String(seeded.ownerB) });
    expect(
      await ownerB.mutation(receiptsApi.resolveApproval, {
        receiptId: "receipt-a",
        decision: "approved",
      }),
    ).toBe(false);

    const ownerA = t.withIdentity({ subject: String(seeded.ownerA) });
    expect(
      await ownerA.mutation(receiptsApi.resolveApproval, {
        receiptId: "receipt-a",
        decision: "approved",
      }),
    ).toBe(true);

    const stored = await t.run(async (ctx: any) =>
      ctx.db
        .query("actionReceipts")
        .withIndex("by_receiptId", (q: any) => q.eq("receiptId", "receipt-a"))
        .unique(),
    );
    expect(stored.approvalState).toBe("approved");
    expect(stored.approvalReviewedBy).toBe(String(seeded.ownerA));
    expect(stored.policyAction).toBe("escalated");
    expect(stored.resultSuccess).toBe(false);
    expect(stored.resultSummary).toBe("Held for approval");

    expect(
      await ownerA.mutation(receiptsApi.resolveApproval, {
        receiptId: "receipt-a",
        decision: "denied",
      }),
    ).toBe(false);
    const afterReplay = await t.run(async (ctx: any) =>
      ctx.db
        .query("actionReceipts")
        .withIndex("by_receiptId", (q: any) => q.eq("receiptId", "receipt-a"))
        .unique(),
    );
    expect(afterReplay.approvalState).toBe("approved");
  });

  it("rejects authenticated clients that attempt to forge trusted receipts", async () => {
    const t = convexTest(schema, convexModules);
    const ownerId = await t.run(async (ctx: any) =>
      ctx.db.insert("users", { email: "forger@example.com" }),
    );
    const owner = t.withIdentity({ subject: String(ownerId) });

    await expect(owner.mutation(receiptsApi.logReceipt, {
      ...receiptFields("forged-receipt", ownerId),
      policyAction: "allowed",
      resultSuccess: true,
      resultSummary: "Fabricated success",
    })).rejects.toThrow(/function|not found/i);
    expect(await t.run(async (ctx: any) =>
      ctx.db.query("actionReceipts").collect(),
    )).toEqual([]);
  });

  it("keeps the content hash valid when an escalated receipt enters the approval queue", async () => {
    const t = convexTest(schema, convexModules);
    const ownerId = await t.run(async (ctx: any) =>
      ctx.db.insert("users", { email: "receipt-owner@example.com" }),
    );
    const storedId = await t.action(
      (internal as any).domains.agents.receipts.actionReceipts.emitReceipt,
      {
        actionSummary: "Hold an outbound write for review",
        agentId: "runtime-agent",
        approvalState: "not_required",
        canUndo: false,
        evidenceRefs: [],
        policyAction: "escalated",
        policyId: "policy-approval-required",
        policyRuleName: "Approval required",
        params: { destination: "finance-ledger", amount: 3 },
        resultSuccess: false,
        resultSummary: "Awaiting review",
        toolName: "external_write",
        userId: ownerId,
        violations: [],
      },
    );
    const stored = await t.run(async (ctx: any) => ctx.db.get(storedId));
    const owner = t.withIdentity({ subject: String(ownerId) });

    expect(await owner.query(receiptsApi.verifyReceiptHash, {
      receiptId: stored.receiptId,
    })).toMatchObject({ valid: true });
    expect(await owner.mutation(receiptsApi.requestApproval, {
      receiptId: stored.receiptId,
      reviewNotes: "Founder review required",
    })).toBe(true);
    expect(await owner.query(receiptsApi.verifyReceiptHash, {
      receiptId: stored.receiptId,
    })).toMatchObject({ valid: true });

    const queued = await t.run(async (ctx: any) => ctx.db.get(storedId));
    expect(queued.policyAction).toBe("escalated");
    expect(queued.approvalState).toBe("pending");

    await t.run(async (ctx: any) => {
      await ctx.db.patch(storedId, {
        params: { destination: "different-ledger", amount: 3 },
      });
    });
    expect(await owner.query(receiptsApi.verifyReceiptHash, {
      receiptId: stored.receiptId,
    })).toMatchObject({ valid: false });
  });

  it("exposes genuine TRACE receipts to the owner that launched the run", async () => {
    const t = convexTest(schema, convexModules);
    const ownerId = await t.run(async (ctx: any) =>
      ctx.db.insert("users", { email: "trace-owner@example.com" }),
    );

    await t.action(
      (internal as any).domains.agents.traceOrchestrator.executeTraceFinalization,
      {
        agentResults: [
          {
            agentName: "research-agent",
            role: "Research",
            result: "Grounded runtime evidence ".repeat(8),
          },
        ],
        executionId: "trace-owner-visible-1",
        executionType: "chat",
        generateAnalysis: false,
        query: "Summarize the grounded runtime evidence",
        userId: ownerId,
      },
    );

    const owner = t.withIdentity({ subject: String(ownerId) });
    const visible = await owner.query(receiptsApi.list, { limit: 20 });
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((receipt: any) => receipt.userId === ownerId)).toBe(true);
    expect(visible.some((receipt: any) => receipt.toolName === "traceFinalize")).toBe(true);
    const traceRows = await owner.query(traceApi.getAuditLog, {
      executionId: "trace-owner-visible-1",
    });
    expect(traceRows.length).toBeGreaterThan(0);
    expect(traceRows.every((entry: any) => entry.userId === ownerId)).toBe(true);
    expect(await t.query(traceApi.getAuditLog, {
      executionId: "trace-owner-visible-1",
    })).toEqual([]);
  }, 30_000);
});
