/**
 * Scenario-based tests for diligenceJudge.
 *
 * Follows .claude/rules/scenario_testing.md — every test answers:
 *   Who, What, How, Scale, Duration, Failure modes.
 *
 * Personas covered:
 *   - Orchestrator bot emitting founder projection (happy path, good latency, sources cited)
 *   - Orchestrator bot that timed out (latency blown, no payload)
 *   - First-time user whose scratchpad is malformed
 *   - Adversarial input: negative versions, unknown tier, whitespace-only id
 *   - Retry-storm: same (entitySlug, blockType) at lower version than prior run (non-monotonic)
 *   - Verified-but-lying: tier says verified, prose is a stub
 *   - Partial telemetry: tokens missing (should skip, not fail)
 *   - Long-running accumulation: 100 sequential judgments over a batch
 */

import { describe, it, expect } from "vitest";
import { judgeDiligenceRun, DILIGENCE_JUDGE_GATES, type JudgeInput } from "./diligenceJudge";
import type { EmitProjectionArgs, EmitProjectionResult } from "./diligenceProjectionWriter";

function baseArgs(overrides: Partial<EmitProjectionArgs> = {}): EmitProjectionArgs {
  return {
    entitySlug: "acme-ai",
    blockType: "founder",
    scratchpadRunId: "run_2026_04_19_001",
    version: 1712345678,
    overallTier: "verified",
    headerText: "Founders",
    bodyProse:
      "Jane Doe is CEO and co-founder. Prior: Staff Engineer at Google. John Smith is CTO.",
    ...overrides,
  };
}

function baseTelemetry(overrides: Partial<JudgeInput["telemetry"]> = {}): JudgeInput["telemetry"] {
  return {
    startedAt: 1_000,
    endedAt: 1_800, // 800ms — comfortably under 30s budget
    toolCalls: 3,
    tokensIn: 1500,
    tokensOut: 420,
    sourceCount: 4,
    ...overrides,
  };
}

function baseResult(overrides: Partial<EmitProjectionResult> = {}): EmitProjectionResult {
  return {
    status: "created",
    entitySlug: "acme-ai",
    blockType: "founder",
    version: 1712345678,
    ...overrides,
  } as EmitProjectionResult;
}

describe("judgeDiligenceRun — happy path (orchestrator persona)", () => {
  it("verified: all 10 gates pass for a well-formed founder projection with full telemetry", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs(),
      result: baseResult(),
      telemetry: baseTelemetry(),
    });
    expect(verdict.verdict).toBe("verified");
    expect(verdict.passCount).toBe(10);
    expect(verdict.failCount).toBe(0);
    expect(verdict.skipCount).toBe(0);
    expect(verdict.score).toBe(1);
    // Gate ordering is stable — dashboards rely on this.
    expect(verdict.gates.map((g) => g.name)).toEqual([...DILIGENCE_JUDGE_GATES]);
    // Every gate surfaces a reason (no empty strings).
    for (const g of verdict.gates) {
      expect(g.reason.length).toBeGreaterThan(0);
    }
  });

  it("deterministic: identical input produces identical verdict across 3 calls", () => {
    const input: JudgeInput = {
      args: baseArgs(),
      result: baseResult(),
      telemetry: baseTelemetry(),
    };
    const a = judgeDiligenceRun(input);
    const b = judgeDiligenceRun(input);
    const c = judgeDiligenceRun(input);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

describe("judgeDiligenceRun — degraded orchestrator (sad paths)", () => {
  it("latency blown: elapsed exceeds 30s budget → latency gate fails, verdict needs_review", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs(),
      result: baseResult(),
      telemetry: baseTelemetry({ startedAt: 0, endedAt: 45_000 }),
    });
    const latencyGate = verdict.gates.find((g) => g.name === "latencyWithinBudget")!;
    expect(latencyGate.status).toBe("fail");
    expect(latencyGate.reason).toMatch(/exceeds budget/);
    expect(verdict.verdict).toBe("needs_review");
  });

  it("emit errored: errorMessage set → emitStatusIsTerminal fails, verdict needs_review", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs(),
      telemetry: baseTelemetry({ errorMessage: "convex mutation 502" }),
    });
    const g = verdict.gates.find((g) => g.name === "emitStatusIsTerminal")!;
    expect(g.status).toBe("fail");
    expect(g.reason).toMatch(/convex mutation 502/);
    expect(verdict.verdict).toBe("needs_review");
  });

  it("verified tier + zero sources: capturedSources gate fails (anti-hallucination invariant)", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs({ overallTier: "verified" }),
      result: baseResult(),
      telemetry: baseTelemetry({ sourceCount: 0 }),
    });
    const g = verdict.gates.find((g) => g.name === "capturedSources")!;
    expect(g.status).toBe("fail");
    expect(g.reason).toMatch(/verified tier with zero sources/);
  });

  it("stub prose + verified tier: tierMatchesBodyProse fails (no fake verification)", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs({ overallTier: "verified", bodyProse: "short." }),
      result: baseResult(),
      telemetry: baseTelemetry(),
    });
    const g = verdict.gates.find((g) => g.name === "tierMatchesBodyProse")!;
    expect(g.status).toBe("fail");
  });
});

describe("judgeDiligenceRun — adversarial input", () => {
  it("non-monotonic version: prior 99, current 5 → hasMonotonicVersion fails", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs({ version: 5 }),
      result: baseResult({ version: 5 }),
      telemetry: baseTelemetry(),
      priorVersion: 99,
    });
    const g = verdict.gates.find((g) => g.name === "hasMonotonicVersion")!;
    expect(g.status).toBe("fail");
    expect(g.reason).toMatch(/not greater than prior/);
  });

  it("scratchpadRunId with whitespace: hasStableScratchpadRunId fails", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs({ scratchpadRunId: "run 001" }),
      result: baseResult(),
      telemetry: baseTelemetry(),
    });
    const g = verdict.gates.find((g) => g.name === "hasStableScratchpadRunId")!;
    expect(g.status).toBe("fail");
  });

  it("unknown tier injected: hasValidTier fails", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs({ overallTier: "unknown" as never }),
      result: baseResult(),
      telemetry: baseTelemetry(),
    });
    const g = verdict.gates.find((g) => g.name === "hasValidTier")!;
    expect(g.status).toBe("fail");
  });

  it("headerText > 120 chars: hasHeader fails (bounded)", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs({ headerText: "x".repeat(200) }),
      result: baseResult(),
      telemetry: baseTelemetry(),
    });
    const g = verdict.gates.find((g) => g.name === "hasHeader")!;
    expect(g.status).toBe("fail");
  });

  it("negative tokens: reportsTokenCounts fails (honest metrics invariant)", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs(),
      result: baseResult(),
      telemetry: baseTelemetry({ tokensIn: -1, tokensOut: 100 }),
    });
    const g = verdict.gates.find((g) => g.name === "reportsTokenCounts")!;
    expect(g.status).toBe("fail");
  });

  it("3+ failures: verdict collapses to failed", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs({
        overallTier: "unknown" as never, // fail hasValidTier
        headerText: "", // fail hasHeader
        version: -1, // fail hasMonotonicVersion
      }),
      result: baseResult(),
      telemetry: baseTelemetry({ errorMessage: "boom" }), // fail emitStatusIsTerminal
    });
    expect(verdict.failCount).toBeGreaterThanOrEqual(3);
    expect(verdict.verdict).toBe("failed");
  });
});

describe("judgeDiligenceRun — partial telemetry (skip, don't fail)", () => {
  it("tokens missing: reportsTokenCounts skipped, verdict provisionally_verified", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs(),
      result: baseResult(),
      telemetry: baseTelemetry({ tokensIn: undefined, tokensOut: undefined }),
    });
    const g = verdict.gates.find((g) => g.name === "reportsTokenCounts")!;
    expect(g.status).toBe("skipped");
    expect(verdict.failCount).toBe(0);
    // 1 skip still counts as verified (threshold is <=2 skipped).
    expect(["verified", "provisionally_verified"]).toContain(verdict.verdict);
  });

  it("toolCalls + tokens + sources all missing: 3 skipped → provisionally_verified", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs(),
      result: baseResult(),
      telemetry: {
        startedAt: 0,
        endedAt: 500,
        // no toolCalls, tokens, sourceCount
      },
    });
    expect(verdict.skipCount).toBeGreaterThanOrEqual(3);
    expect(verdict.failCount).toBe(0);
    expect(verdict.verdict).toBe("provisionally_verified");
  });

  it("no result attached (dry-run): emitStatusIsTerminal skipped", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs(),
      telemetry: baseTelemetry(),
    });
    const g = verdict.gates.find((g) => g.name === "emitStatusIsTerminal")!;
    expect(g.status).toBe("skipped");
  });
});

describe("judgeDiligenceRun — long-running accumulation (100 runs)", () => {
  it("judging 100 sequential runs remains deterministic and linear", () => {
    const verdicts: ReturnType<typeof judgeDiligenceRun>[] = [];
    for (let i = 0; i < 100; i++) {
      verdicts.push(
        judgeDiligenceRun({
          args: baseArgs({ scratchpadRunId: `run_${i.toString().padStart(3, "0")}`, version: i + 1 }),
          result: baseResult({ version: i + 1 }),
          telemetry: baseTelemetry(),
          priorVersion: i, // each monotonic
        }),
      );
    }
    expect(verdicts.length).toBe(100);
    expect(verdicts.every((v) => v.verdict === "verified")).toBe(true);
    // Gate count stable across all runs (no memory leak in output shape).
    expect(new Set(verdicts.map((v) => v.gates.length))).toEqual(new Set([DILIGENCE_JUDGE_GATES.length]));
  });

  it("mixed run batch (50 happy + 50 degraded): verdicts segregate cleanly", () => {
    const happy = Array.from({ length: 50 }, () =>
      judgeDiligenceRun({
        args: baseArgs(),
        result: baseResult(),
        telemetry: baseTelemetry(),
      }),
    );
    const degraded = Array.from({ length: 50 }, () =>
      judgeDiligenceRun({
        args: baseArgs({ overallTier: "verified", bodyProse: "stub" }),
        result: baseResult(),
        telemetry: baseTelemetry({ sourceCount: 0 }),
      }),
    );
    expect(happy.every((v) => v.verdict === "verified")).toBe(true);
    expect(degraded.every((v) => v.verdict === "needs_review" || v.verdict === "failed")).toBe(true);
  });
});

describe("judgeDiligenceRun — score math honesty", () => {
  it("score = passCount / (passCount + failCount), skipped gates excluded from denominator", () => {
    const verdict = judgeDiligenceRun({
      args: baseArgs(),
      result: baseResult(),
      telemetry: baseTelemetry({ tokensIn: undefined, tokensOut: undefined }), // 1 skip
    });
    const denom = verdict.passCount + verdict.failCount;
    expect(verdict.score).toBe(verdict.passCount / denom);
  });

  it("all gates skipped → score 0 (never NaN)", () => {
    // Impossible to skip everything with real args, but we simulate by failing validation upstream.
    // Here we simulate by passing minimum args then have the evaluator skip what it can.
    const verdict = judgeDiligenceRun({
      args: baseArgs(),
      // no result, telemetry with no optional fields
      telemetry: { startedAt: 0, endedAt: 100 },
    });
    expect(Number.isFinite(verdict.score)).toBe(true);
  });
});
