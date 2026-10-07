import { describe, expect, it } from "vitest";
import { DOGFOOD_SUITE } from "@/features/controlPlane/components/dogfoodSuite";
import { TASTE_BENCH_SCENARIOS } from "./tasteBenchScenario";

describe("TasteBench scenario catalog", () => {
  it("is the fixed AI-app subset of the canonical dogfood catalog", () => {
    const canonicalAiAppIds = DOGFOOD_SUITE.filter(
      (scenario) => scenario.surface === "ai_app",
    ).map((scenario) => scenario.id);
    expect(TASTE_BENCH_SCENARIOS.map((scenario) => scenario.id)).toEqual(
      canonicalAiAppIds,
    );
  });
});
