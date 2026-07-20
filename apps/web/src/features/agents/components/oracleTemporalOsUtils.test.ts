import { describe, expect, it } from "vitest";
import {
  getTemporalPhasePresentation,
  summarizeTemporalCounts,
} from "./oracleTemporalOsUtils";

describe("oracleTemporalOsUtils", () => {
  it("maps temporal phase states to stable labels", () => {
    expect(getTemporalPhasePresentation("completed").label).toBe("Completed");
    expect(getTemporalPhasePresentation("in_progress").label).toBe("In progress");
    expect(getTemporalPhasePresentation("pending").label).toBe("Pending");
  });

  it("summarizes activated phases from substrate counts", () => {
    expect(
      summarizeTemporalCounts({
        observations: 0,
        signals: 0,
        causalChains: 0,
        zeroDrafts: 0,
        proofPacks: 0,
      }),
    ).toBe("0/4 phases activated");

    expect(
      summarizeTemporalCounts({
        observations: 4,
        signals: 2,
        causalChains: 1,
        zeroDrafts: 0,
        proofPacks: 0,
      }),
    ).toBe("2/4 phases activated");
  });
});
