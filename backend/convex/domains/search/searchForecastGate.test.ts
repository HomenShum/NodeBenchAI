import { describe, expect, it } from "vitest";

import { buildSearchForecastGate } from "./searchForecastGate";

describe("buildSearchForecastGate", () => {
  it("does not model one-off entity searches", () => {
    const gate = buildSearchForecastGate({
      recentSessions: [],
      entityName: "Databricks",
      lens: "founder",
      currentConfidence: 82,
      currentSessionId: "current",
    });

    expect(gate.trendDirection).toBe("insufficient_data");
    expect(gate.recommendedAction).toBe("observe");
    expect(gate.valuesCount).toBe(1);
    expect(gate.modelUsed).toBe("insufficient_data");
  });

  it("uses repeated entity and lens confidence history for packet routing", () => {
    const gate = buildSearchForecastGate({
      recentSessions: [
        { _id: "a", lens: "founder", completedAt: 1, result: { entityName: "Databricks", confidence: 92 } },
        { _id: "b", lens: "founder", completedAt: 2, result: { entityName: "Databricks", confidence: 85 } },
        { _id: "c", lens: "banker", completedAt: 3, result: { entityName: "Databricks", confidence: 99 } },
        { _id: "d", lens: "founder", completedAt: 4, result: { entityName: "Snowflake", confidence: 50 } },
      ],
      entityName: "Databricks",
      lens: "founder",
      currentConfidence: 74,
      currentSessionId: "current",
      packetId: "packet-1",
    });

    expect(gate.streamKey).toBe("search_confidence:founder:databricks");
    expect(gate.valuesCount).toBe(3);
    expect(gate.modelUsed).toBe("search_session_confidence_stream");
    expect(gate.evidenceRefs).toContain("packet:packet-1");
  });
});
