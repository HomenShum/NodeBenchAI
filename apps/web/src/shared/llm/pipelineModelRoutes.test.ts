import { describe, expect, it } from "vitest";

import {
  DEFAULT_PIPELINE_MODEL_SELECTION,
  PIPELINE_MODEL_AUTO_FREE,
  PIPELINE_MODEL_OPTIONS,
  getPipelineModelOption,
  getPipelineModelRuntimeId,
} from "./pipelineModelRoutes";

describe("pipeline model routes", () => {
  it("defaults Reports to the auto balanced route", () => {
    const option = getPipelineModelOption(DEFAULT_PIPELINE_MODEL_SELECTION);

    expect(option).toMatchObject({
      label: "Auto balanced",
      resolvedModelId: "kimi-k2.6",
      isRoute: true,
    });
  });

  it("exposes an explicit free route backed by the approved free pool", () => {
    const option = getPipelineModelOption(PIPELINE_MODEL_AUTO_FREE);

    expect(option).toMatchObject({
      label: "Auto free",
      provider: "openrouter",
      // Was laguna-s-2.1-free: that lane expires on OpenRouter 2026-10-31, so auto-free
      // resolves to FREE_LANE_MODEL (SPEC-v9 A.2.10 PR 1; NodeVideo's measured pick).
      resolvedModelId: "nemotron-3-super-free",
      isFree: true,
    });
    expect(getPipelineModelRuntimeId(PIPELINE_MODEL_AUTO_FREE)).toBe("nemotron-3-super-free");
  });

  it("keeps direct models and route models in one selector bank", () => {
    expect(PIPELINE_MODEL_OPTIONS.map((option) => option.value)).toContain("gpt-5.4-mini");
    expect(getPipelineModelOption("claude-haiku-4.5").shortLabel).toBe("Claude Haiku 4.5");
  });
});
