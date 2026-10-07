/**
 * Tests for diligenceProjectionWriter — the orchestrator write path helper.
 *
 * Scenario: An orchestrator just finished a block's structuring pass and
 *           needs to emit a projection. The writer validates the payload,
 *           calls the Convex mutation, and returns a status the caller can
 *           triage.
 *
 * Invariants under test:
 *   - validateEmitArgs rejects every invariant violation with a clear error
 *   - emitDiligenceProjection returns shaped results for created/updated/stale
 *   - emitDiligenceProjectionBatch isolates partial failures (one bad row
 *     does not throw away the successful rows)
 *   - DETERMINISTIC: same input always produces the same mutation call
 */

import { describe, it, expect, vi } from "vitest";
import {
  emitDiligenceProjection,
  emitDiligenceProjectionBatch,
  emitDiligenceProjectionInstrumented,
  emitDiligenceProjectionBatchInstrumented,
  validateEmitArgs,
  type EmitProjectionArgs,
  type InstrumentedRunTelemetry,
  type UpsertProjectionMutation,
} from "./diligenceProjectionWriter";
import { judgeDiligenceRun } from "./diligenceJudge";

function baseArgs(overrides: Partial<EmitProjectionArgs> = {}): EmitProjectionArgs {
  return {
    entitySlug: "acme-ai",
    blockType: "founder",
    scratchpadRunId: "run_001",
    version: 1,
    overallTier: "verified",
    headerText: "Founders",
    ...overrides,
  };
}

describe("validateEmitArgs", () => {
  it("accepts a well-formed payload", () => {
    expect(() => validateEmitArgs(baseArgs())).not.toThrow();
  });

  it("rejects empty entitySlug", () => {
    expect(() => validateEmitArgs(baseArgs({ entitySlug: "" }))).toThrow(/entitySlug/);
  });

  it("rejects whitespace-only entitySlug", () => {
    expect(() => validateEmitArgs(baseArgs({ entitySlug: "  " }))).toThrow(/entitySlug/);
  });

  it("rejects unknown blockType", () => {
    expect(() =>
      validateEmitArgs(baseArgs({ blockType: "unknown" as never })),
    ).toThrow(/invalid blockType/);
  });

  it("accepts every canonical blockType", () => {
    const types: EmitProjectionArgs["blockType"][] = [
      "projection",
      "founder",
      "product",
      "funding",
      "news",
      "hiring",
      "patent",
      "publicOpinion",
      "competitor",
      "regulatory",
      "financial",
    ];
    for (const blockType of types) {
      expect(() => validateEmitArgs(baseArgs({ blockType }))).not.toThrow();
    }
  });

  it("rejects empty scratchpadRunId", () => {
    expect(() =>
      validateEmitArgs(baseArgs({ scratchpadRunId: "" })),
    ).toThrow(/scratchpadRunId/);
  });

  it("rejects negative or non-numeric version", () => {
    expect(() => validateEmitArgs(baseArgs({ version: -1 }))).toThrow(/version/);
    expect(() =>
      validateEmitArgs(baseArgs({ version: Number.NaN })),
    ).toThrow(/version/);
  });

  it("rejects unknown overallTier", () => {
    expect(() =>
      validateEmitArgs(baseArgs({ overallTier: "fake" as never })),
    ).toThrow(/overallTier/);
  });

  it("rejects empty headerText", () => {
    expect(() =>
      validateEmitArgs(baseArgs({ headerText: "" })),
    ).toThrow(/headerText/);
  });
});

describe("emitDiligenceProjection", () => {
  it("calls the mutation and maps 'created' into a shaped result", async () => {
    const mutation = vi.fn().mockResolvedValue({ status: "created" });
    const result = await emitDiligenceProjection(mutation as UpsertProjectionMutation, baseArgs());
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "created",
      entitySlug: "acme-ai",
      blockType: "founder",
      version: 1,
    });
  });

  it("maps 'updated' through identically", async () => {
    const mutation = vi.fn().mockResolvedValue({ status: "updated" });
    const result = await emitDiligenceProjection(
      mutation as UpsertProjectionMutation,
      baseArgs({ version: 7 }),
    );
    expect(result).toEqual({
      status: "updated",
      entitySlug: "acme-ai",
      blockType: "founder",
      version: 7,
    });
  });

  it("maps 'stale' with the server's currentVersion (HONEST_STATUS)", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValue({ status: "stale", currentVersion: 12 });
    const result = await emitDiligenceProjection(
      mutation as UpsertProjectionMutation,
      baseArgs({ version: 5 }),
    );
    expect(result).toEqual({
      status: "stale",
      entitySlug: "acme-ai",
      blockType: "founder",
      currentVersion: 12,
    });
  });

  it("throws a descriptive error when validation fails before the mutation", async () => {
    const mutation = vi.fn();
    await expect(
      emitDiligenceProjection(
        mutation as UpsertProjectionMutation,
        baseArgs({ entitySlug: "" }),
      ),
    ).rejects.toThrow(/entitySlug/);
    // Mutation must NOT have been called — BOUND rule + no wasted RPC
    expect(mutation).not.toHaveBeenCalled();
  });

  it("forwards optional fields transparently", async () => {
    const mutation = vi.fn().mockResolvedValue({ status: "created" });
    await emitDiligenceProjection(mutation as UpsertProjectionMutation, {
      ...baseArgs(),
      bodyProse: "Jane Doe is CEO.",
      payload: [{ name: "Jane Doe", role: "CEO" }],
      sourceSectionId: "section-founders",
    });
    expect(mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyProse: "Jane Doe is CEO.",
        payload: [{ name: "Jane Doe", role: "CEO" }],
        sourceSectionId: "section-founders",
      }),
    );
  });
});

describe("emitDiligenceProjectionBatch", () => {
  it("fans out over N projections in parallel and returns per-item results", async () => {
    const mutation = vi.fn().mockResolvedValue({ status: "created" });
    const batch = [
      baseArgs({ blockType: "founder", scratchpadRunId: "r1" }),
      baseArgs({ blockType: "product", scratchpadRunId: "r1" }),
      baseArgs({ blockType: "funding", scratchpadRunId: "r1" }),
    ];
    const outcomes = await emitDiligenceProjectionBatch(
      mutation as UpsertProjectionMutation,
      batch,
    );
    expect(outcomes.length).toBe(3);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(mutation).toHaveBeenCalledTimes(3);
  });

  it("partial failure is isolated (reexamine_resilience invariant)", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce({ status: "created" })
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce({ status: "updated" });
    const batch = [
      baseArgs({ scratchpadRunId: "r1" }),
      baseArgs({ scratchpadRunId: "r2" }),
      baseArgs({ scratchpadRunId: "r3" }),
    ];
    const outcomes = await emitDiligenceProjectionBatch(
      mutation as UpsertProjectionMutation,
      batch,
    );
    expect(outcomes.length).toBe(3);
    expect(outcomes[0].ok).toBe(true);
    expect(outcomes[1].ok).toBe(false);
    expect(outcomes[2].ok).toBe(true);
    if (!outcomes[1].ok) {
      expect(outcomes[1].error.message).toBe("network blip");
      expect(outcomes[1].args.scratchpadRunId).toBe("r2");
    }
  });

  it("validation failures also isolate at the batch level (never throw)", async () => {
    const mutation = vi.fn().mockResolvedValue({ status: "created" });
    const batch: EmitProjectionArgs[] = [
      baseArgs({ scratchpadRunId: "r1" }),
      baseArgs({ scratchpadRunId: "", version: 1 }), // invalid
      baseArgs({ scratchpadRunId: "r3" }),
    ];
    const outcomes = await emitDiligenceProjectionBatch(
      mutation as UpsertProjectionMutation,
      batch,
    );
    expect(outcomes[0].ok).toBe(true);
    expect(outcomes[1].ok).toBe(false);
    expect(outcomes[2].ok).toBe(true);
    // Mutation was only called twice (the invalid row short-circuited before RPC)
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it("DETERMINISTIC: identical input produces identical mutation calls", async () => {
    const mutation = vi.fn().mockResolvedValue({ status: "created" });
    const args = baseArgs({ version: 42, headerText: "Founders x2" });
    await emitDiligenceProjection(mutation as UpsertProjectionMutation, args);
    await emitDiligenceProjection(mutation as UpsertProjectionMutation, args);
    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation.mock.calls[0][0]).toEqual(mutation.mock.calls[1][0]);
  });
});

/* ============================================================================
 * Instrumented write path — telemetry capture + judge hook
 *
 * Scenario: orchestrator emits a projection AND wants the emit bracketed by
 *           wall-clock so the judge can score latency. The instrumented
 *           emitter must:
 *             - always return an outcome envelope (never throw)
 *             - capture startedAt/endedAt via the injected clock (deterministic
 *               in tests)
 *             - merge seedTelemetry (token counts, source counts the caller
 *               already knows) with the bracketed timings
 *             - fire onTelemetry once per emit, success or failure, but never
 *               let a telemetry error propagate
 *             - feed cleanly into judgeDiligenceRun (contract integration)
 * ========================================================================== */

describe("emitDiligenceProjectionInstrumented — telemetry capture", () => {
  it("success path: captures startedAt/endedAt from injected clock, merges seed telemetry", async () => {
    const mutation = vi.fn().mockResolvedValue({ status: "created" });
    let tick = 0;
    const now = vi.fn(() => {
      tick += 1;
      return tick * 100; // first call 100, second 200
    });
    const onTelemetry = vi.fn();
    const outcome = await emitDiligenceProjectionInstrumented(
      mutation as UpsertProjectionMutation,
      baseArgs(),
      {
        now,
        seedTelemetry: { toolCalls: 3, tokensIn: 1500, tokensOut: 420, sourceCount: 4 },
        onTelemetry,
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.telemetry).toEqual({
      toolCalls: 3,
      tokensIn: 1500,
      tokensOut: 420,
      sourceCount: 4,
      startedAt: 100,
      endedAt: 200,
    });
    expect(onTelemetry).toHaveBeenCalledTimes(1);
    expect(onTelemetry).toHaveBeenCalledWith(outcome.telemetry, expect.objectContaining({ entitySlug: "acme-ai" }));
  });

  it("failure path: mutation throws → outcome.ok=false + errorMessage captured in telemetry", async () => {
    const mutation = vi.fn().mockRejectedValue(new Error("convex 502"));
    const onTelemetry = vi.fn();
    const outcome = await emitDiligenceProjectionInstrumented(
      mutation as UpsertProjectionMutation,
      baseArgs(),
      { now: () => 500, onTelemetry },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.telemetry.errorMessage).toBe("convex 502");
    expect(outcome.telemetry.startedAt).toBe(500);
    expect(outcome.telemetry.endedAt).toBe(500);
    expect(onTelemetry).toHaveBeenCalledTimes(1);
    // The telemetry handed to onTelemetry is the SAME envelope returned.
    const handed = onTelemetry.mock.calls[0][0] as InstrumentedRunTelemetry;
    expect(handed.errorMessage).toBe("convex 502");
  });

  it("validation failure: still surfaces as outcome.ok=false, mutation not called", async () => {
    const mutation = vi.fn();
    const outcome = await emitDiligenceProjectionInstrumented(
      mutation as UpsertProjectionMutation,
      baseArgs({ entitySlug: "" }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.message).toMatch(/entitySlug/);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("onTelemetry error is swallowed (BOUND: telemetry failure must not break write path)", async () => {
    const mutation = vi.fn().mockResolvedValue({ status: "created" });
    const onTelemetry = vi.fn().mockRejectedValue(new Error("sqlite readonly"));
    const outcome = await emitDiligenceProjectionInstrumented(
      mutation as UpsertProjectionMutation,
      baseArgs(),
      { onTelemetry },
    );
    // Write path success despite telemetry failure.
    expect(outcome.ok).toBe(true);
    expect(onTelemetry).toHaveBeenCalledTimes(1);
  });

  it("contract integration: instrumented telemetry is directly feedable to judgeDiligenceRun", async () => {
    const mutation = vi.fn().mockResolvedValue({ status: "created" });
    let tick = 0;
    const now = () => {
      tick += 1;
      return tick === 1 ? 1000 : 1500;
    };
    const outcome = await emitDiligenceProjectionInstrumented(
      mutation as UpsertProjectionMutation,
      baseArgs({
        bodyProse:
          "Jane Doe is CEO. John Smith is CTO. Prior art: both ex-Google Brain staff engineers.",
      }),
      {
        now,
        seedTelemetry: { toolCalls: 2, tokensIn: 1200, tokensOut: 300, sourceCount: 3 },
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    const verdict = judgeDiligenceRun({
      args: baseArgs({
        bodyProse:
          "Jane Doe is CEO. John Smith is CTO. Prior art: both ex-Google Brain staff engineers.",
      }),
      result: outcome.result,
      telemetry: outcome.telemetry,
    });
    expect(verdict.verdict).toBe("verified");
    expect(verdict.failCount).toBe(0);
  });
});

describe("emitDiligenceProjectionBatchInstrumented — resilience at scale", () => {
  it("burst: 20 parallel emits, one bad row, telemetry fires for every row including failures", async () => {
    const mutation = vi.fn().mockImplementation(async (args: { scratchpadRunId: string }) => {
      if (args.scratchpadRunId === "r_bad") throw new Error("network blip");
      return { status: "created" } as const;
    });
    const telemetrySeen: InstrumentedRunTelemetry[] = [];
    const batch: EmitProjectionArgs[] = Array.from({ length: 20 }, (_, i) =>
      baseArgs({ scratchpadRunId: i === 10 ? "r_bad" : `r_${i}` }),
    );
    const outcomes = await emitDiligenceProjectionBatchInstrumented(
      mutation as UpsertProjectionMutation,
      batch,
      {
        seedTelemetry: { toolCalls: 1, tokensIn: 100, tokensOut: 50, sourceCount: 1 },
        onTelemetry: (t) => {
          telemetrySeen.push(t);
        },
      },
    );
    expect(outcomes.length).toBe(20);
    expect(outcomes.filter((o) => o.ok).length).toBe(19);
    expect(outcomes.filter((o) => !o.ok).length).toBe(1);
    // Telemetry fired once per row — success AND failure.
    expect(telemetrySeen.length).toBe(20);
    expect(telemetrySeen.filter((t) => t.errorMessage).length).toBe(1);
  });
});
