import { describe, expect, it, vi } from "vitest";

import { emitWithReceipt, hashTraceResultOutput } from "./emitWithReceipt";

const auditArgs = {
  executionId: "trace-1",
  executionType: "chat" as const,
  seq: 1,
  choiceType: "finalize" as const,
  toolName: "deliver",
  provenance: "deterministic_code" as const,
  metadata: { durationMs: 12, success: true },
  description: "Delivered the recorded output",
  resultOutput: { body: "actual output", sources: ["source-1"] },
};

describe("TRACE receipt binding", () => {
  it("hashes canonical output independently of object key order", async () => {
    const left = await hashTraceResultOutput({ b: 2, a: { y: 2, x: 1 } });
    const right = await hashTraceResultOutput({ a: { x: 1, y: 2 }, b: 2 });

    expect(left).toBe(right);
    expect(left).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects a trust-labeled step when receipt persistence fails", async () => {
    const ctx = {
      runMutation: vi.fn().mockResolvedValue("audit-1"),
      runAction: vi.fn().mockRejectedValue(new Error("receipt unavailable")),
    };

    await expect(
      emitWithReceipt(ctx as never, auditArgs, {
        agentId: "trace-agent",
        userId: "user-1" as never,
      }),
    ).rejects.toThrow("receipt unavailable");

    expect(ctx.runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resultOutputHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    );
  });
});
