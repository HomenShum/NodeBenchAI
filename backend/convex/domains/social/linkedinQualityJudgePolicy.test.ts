import { describe, expect, it, vi } from "vitest";

import {
  LINKEDIN_QUALITY_JUDGE_MODEL_ALIASES,
  LinkedInQualityJudgeModelsExhaustedError,
  parseLinkedInQualityJudgeResponse,
  runLinkedInQualityJudgeWithFallback,
  shouldContinueLinkedInJudgeBatch,
} from "./linkedinQualityJudgePolicy";

describe("LinkedIn quality judge policy", () => {
  it("uses the reviewed current free model before the explicit free fallback", () => {
    expect(LINKEDIN_QUALITY_JUDGE_MODEL_ALIASES).toEqual([
      "laguna-s-2.1-free",
      "laguna-xs-2.1-free",
    ]);
  });

  it("strictly parses a valid judge envelope", () => {
    expect(
      parseLinkedInQualityJudgeResponse(
        'prefix {"hookQuality":true,"opinionDepth":false,"questionAuthenticity":true,"reasoning":"Specific and useful.","verdict":"needs_rewrite"} suffix',
      ),
    ).toEqual({
      hookQuality: true,
      opinionDepth: false,
      questionAuthenticity: true,
      reasoning: "Specific and useful.",
      verdict: "needs_rewrite",
    });
  });

  it("fails closed instead of coercing malformed boolean fields", () => {
    expect(() =>
      parseLinkedInQualityJudgeResponse(
        '{"hookQuality":"true","opinionDepth":true,"questionAuthenticity":true,"reasoning":"Looks good.","verdict":"approve"}',
      ),
    ).toThrow("hookQuality must be boolean");
  });

  it("fails closed when an approval conflicts with the boolean criteria", () => {
    expect(() =>
      parseLinkedInQualityJudgeResponse(
        '{"hookQuality":true,"opinionDepth":false,"questionAuthenticity":true,"reasoning":"Not all criteria pass.","verdict":"approve"}',
      ),
    ).toThrow("verdict approve conflicts with criteria");
  });

  it("falls back once and reports the model that actually succeeded", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("primary unavailable"))
      .mockResolvedValueOnce("approved");

    await expect(runLinkedInQualityJudgeWithFallback(attempt)).resolves.toEqual({
      modelAlias: "laguna-xs-2.1-free",
      value: "approved",
      failures: [
        { modelAlias: "laguna-s-2.1-free", reason: "primary unavailable" },
      ],
    });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("fails closed with every attempted model recorded", async () => {
    const attempt = vi.fn().mockRejectedValue(new Error("unavailable"));

    await expect(runLinkedInQualityJudgeWithFallback(attempt)).rejects.toMatchObject({
      name: LinkedInQualityJudgeModelsExhaustedError.name,
      failures: [
        { modelAlias: "laguna-s-2.1-free", reason: "unavailable" },
        { modelAlias: "laguna-xs-2.1-free", reason: "unavailable" },
      ],
    });
  });

  it("stops a batch when the oldest pending item cannot be judged", () => {
    expect(shouldContinueLinkedInJudgeBatch({ success: true })).toBe(true);
    expect(shouldContinueLinkedInJudgeBatch({ success: false })).toBe(false);
  });
});
