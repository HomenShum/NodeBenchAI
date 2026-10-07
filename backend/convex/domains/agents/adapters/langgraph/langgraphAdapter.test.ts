import { describe, expect, it } from "vitest";
import { createTemporalForecastGraphAdapter } from "./langgraphAdapter";

describe("createTemporalForecastGraphAdapter", () => {
  it("executes the temporal graph nodes and returns a founder episode span", async () => {
    const adapter = createTemporalForecastGraphAdapter({ name: "temporal-gate-test" });

    const result = await adapter.execute({
      query: "Decide whether this remediation trend is ready for OpenClaw.",
      options: {
        temporalForecast: {
          streamKey: "workflow:remediation_velocity",
          values: [10, 11, 12, 13, 14, 15, 16, 17],
          modelUsed: "timesfm",
          forecasts: [
            { predicted: 18, lower: 17.5, upper: 18.5 },
            { predicted: 19, lower: 18.3, upper: 19.7 },
          ],
          delegateEligible: true,
        },
      },
    });

    expect(result.status).toBe("success");
    expect(result.result.decision.recommendedAction).toBe("delegate");
    expect(result.result.openclawDirective.shouldDelegate).toBe(true);
    expect(result.result.founderEpisodeSpan.type).toBe("forecast_gate");
    expect(result.result.nodeTrace.map((entry) => entry.node)).toEqual([
      "load_founder_state",
      "load_packet_lineage",
      "load_time_series",
      "forecast_with_tsfm",
      "classify_forecast_gate",
      "decide_next_action",
      "write_founder_episode_span",
      "emit_packet_update_or_handoff",
    ]);
  });

  it("does not delegate when the temporal forecast input is missing", async () => {
    const adapter = createTemporalForecastGraphAdapter({ name: "temporal-gate-test" });

    const result = await adapter.execute({
      query: "Run a temporal gate.",
    });

    expect(result.status).toBe("error");
    expect(result.result.openclawDirective.shouldDelegate).toBe(false);
    expect(result.result.decision.trendDirection).toBe("insufficient_data");
  });
});
