import { describe, expect, it } from "vitest";

import { computeGoldenMetrics } from "./goldenMetrics";

describe("computeGoldenMetrics", () => {
  it("exposes the three golden metrics by exact name with correct values", () => {
    // Synthetic inputs: 20 model calls with 1 failure -> 0.05 error rate,
    // swarm_evolution completionRate 0.8, worker-reported p99 of 1234ms.
    const modelCalls = [
      ...Array.from({ length: 19 }, () => ({ success: true })),
      { success: false },
    ];

    const metrics = computeGoldenMetrics({
      modelCalls,
      completionRate: 0.8,
      p99LatencyMs: 1234,
    });

    expect(Object.keys(metrics).sort()).toEqual([
      "p99-latency-ms",
      "task-completion-rate",
      "tool-call-error-rate",
    ]);
    expect(metrics["task-completion-rate"]).toBe(0.8);
    expect(metrics["tool-call-error-rate"]).toBe(0.05);
    expect(metrics["p99-latency-ms"]).toBe(1234);
  });

  it("degrades honestly when sources are empty or unavailable", () => {
    const metrics = computeGoldenMetrics({
      modelCalls: [],
      completionRate: null,
      p99LatencyMs: null, // convex runtime cannot see the worker's p99
    });

    expect(metrics["tool-call-error-rate"]).toBe(0); // matches getRoutingStats empty-window behavior
    expect(metrics["task-completion-rate"]).toBeNull();
    expect(metrics["p99-latency-ms"]).toBeNull();
  });
});
