import { describe, expect, it } from "vitest";

import {
  buildFailureSummary,
  classifyAestheticReviewFailure,
} from "./ui-aesthetic-review.mjs";

describe("classifyAestheticReviewFailure", () => {
  it("classifies sandboxed outbound navigation as network access denied", () => {
    const error = new Error("ScratchNode recorder failed with exit code 1");
    error.stderr = "RECORD_FAILED: page.goto: net::ERR_NETWORK_ACCESS_DENIED at https://scratchnode.live/e/ai-infra-summit-2026";
    error.label = "ScratchNode recorder";
    error.exitCode = 1;

    expect(classifyAestheticReviewFailure(error)).toEqual({
      code: "network_access_denied",
      stage: "record",
      detail: "Sandbox denied outbound navigation while loading the public ScratchNode room.",
    });
  });

  it("classifies missing Gemini configuration explicitly", () => {
    const error = new Error("GEMINI_API_KEY not found in env or .env.local; use --judge skip for capture-only smoke.");

    expect(classifyAestheticReviewFailure(error)).toEqual({
      code: "missing_gemini_key",
      stage: "judge-config",
      detail: "Gemini judging was required, but no GEMINI_API_KEY was available.",
    });
  });
});

describe("buildFailureSummary", () => {
  it("preserves report metadata and adds structured failure evidence", () => {
    const baseSummary = {
      passed: true,
      url: "https://scratchnode.live/e/ai-infra-summit-2026",
      outDir: ".tmp/scratchnode-aesthetic-review",
      reportPath: ".tmp/scratchnode-aesthetic-review/aesthetic-review-summary.json",
      surface: "mobile",
      judgeMode: "skip",
      model: null,
      videos: [],
      record: null,
      judges: [],
    };
    const error = new Error("ScratchNode recorder failed with exit code 1");
    error.stderr = "RECORD_FAILED: page.goto: net::ERR_NETWORK_ACCESS_DENIED at https://scratchnode.live/e/ai-infra-summit-2026";
    error.stdout = "";
    error.label = "ScratchNode recorder";
    error.exitCode = 1;

    expect(buildFailureSummary(baseSummary, error)).toEqual({
      ...baseSummary,
      passed: false,
      videos: [],
      record: null,
      judges: [],
      failure: {
        code: "network_access_denied",
        stage: "record",
        detail: "Sandbox denied outbound navigation while loading the public ScratchNode room.",
        label: "ScratchNode recorder",
        exitCode: 1,
        message: "ScratchNode recorder failed with exit code 1",
      },
      stderr: "RECORD_FAILED: page.goto: net::ERR_NETWORK_ACCESS_DENIED at https://scratchnode.live/e/ai-infra-summit-2026",
      stdout: null,
    });
  });
});
