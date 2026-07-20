import { describe, expect, it } from "vitest";
import { classifyForecastGate } from "./forecastGatePolicy";

describe("classifyForecastGate", () => {
  it("returns insufficient_data for short streams", () => {
    const decision = classifyForecastGate({
      streamKey: "company:confidence",
      values: [0.7, 0.72],
      modelUsed: "timesfm",
    });

    expect(decision.trendDirection).toBe("insufficient_data");
    expect(decision.recommendedAction).toBe("observe");
    expect(decision.modelUsed).toBe("insufficient_data");
  });

  it("refreshes packets for declining trajectories", () => {
    const decision = classifyForecastGate({
      streamKey: "packet:confidence",
      values: [90, 86, 82, 78, 74],
      modelUsed: "timesfm",
      forecasts: [
        { predicted: 70, lower: 68, upper: 72 },
        { predicted: 66, lower: 63, upper: 69 },
      ],
    });

    expect(decision.trendDirection).toBe("declining");
    expect(decision.recommendedAction).toBe("refresh_packet");
  });

  it("escalates when the latest observation falls outside the expected interval", () => {
    const decision = classifyForecastGate({
      streamKey: "watchlist:signal",
      values: [10, 11, 12, 13, 40],
      modelUsed: "timesfm",
      forecasts: [{ predicted: 14, lower: 12, upper: 16 }],
    });

    expect(decision.latestOutsideInterval).toBe(true);
    expect(decision.recommendedAction).toBe("escalate");
  });

  it("suppresses redundant diligence for stable streams with enough history", () => {
    const decision = classifyForecastGate({
      streamKey: "diligence:score",
      values: [10, 10.1, 9.9, 10, 10.05, 9.95, 10, 10.02],
      modelUsed: "timesfm",
      forecasts: [
        { predicted: 10, lower: 9.8, upper: 10.2 },
        { predicted: 10.01, lower: 9.78, upper: 10.24 },
      ],
    });

    expect(decision.trendDirection).toBe("stable");
    expect(decision.recommendedAction).toBe("suppress");
  });

  it("permits delegation for improving streams with enough history and bounded context", () => {
    const decision = classifyForecastGate({
      streamKey: "workflow:remediation_velocity",
      values: [10, 11, 12, 13, 14, 15, 16, 17],
      modelUsed: "timesfm",
      forecasts: [
        { predicted: 18, lower: 17.5, upper: 18.5 },
        { predicted: 19, lower: 18.3, upper: 19.7 },
      ],
      delegateEligible: true,
    });

    expect(decision.trendDirection).toBe("improving");
    expect(decision.recommendedAction).toBe("delegate");
  });
});
