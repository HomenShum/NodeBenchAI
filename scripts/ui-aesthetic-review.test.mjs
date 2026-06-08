import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildFailureSummary,
  classifyAestheticReviewFailure,
  classifyArtifactKind,
  findRecentLocalArtifacts,
  summarizeArtifacts,
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

describe("artifact-only evidence helpers", () => {
  it("classifies common screenshot and video extensions", () => {
    expect(classifyArtifactKind("demo.png")).toBe("image");
    expect(classifyArtifactKind("clip.webm")).toBe("video");
    expect(classifyArtifactKind("notes.txt")).toBe("file");
  });

  it("summarizes local artifact metadata for report-only runs", () => {
    const tempDir = resolve(".tmp/test-ui-aesthetic-review-artifacts");
    mkdirSync(tempDir, { recursive: true });
    const imagePath = resolve(tempDir, "mobile-after.png");
    const videoPath = resolve(tempDir, "mobile-demo.webm");
    writeFileSync(imagePath, "png-bytes");
    writeFileSync(videoPath, "webm-bytes");

    try {
      const summary = summarizeArtifacts([imagePath, videoPath]);
      expect(summary).toHaveLength(2);
      expect(summary[0]).toMatchObject({
        path: imagePath,
        kind: "image",
        bytes: 9,
      });
      expect(summary[1]).toMatchObject({
        path: videoPath,
        kind: "video",
        bytes: 10,
      });
      expect(summary[0].modifiedAt).toMatch(/T/);
      expect(summary[1].modifiedAt).toMatch(/T/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("finds the most recent local visual artifacts deterministically", () => {
    const tempDir = resolve(".tmp/test-ui-aesthetic-review-fallback");
    mkdirSync(tempDir, { recursive: true });
    const oldest = resolve(tempDir, "oldest.png");
    const middle = resolve(tempDir, "middle.webm");
    const newest = resolve(tempDir, "newest.jpg");
    writeFileSync(oldest, "one");
    writeFileSync(middle, "two");
    writeFileSync(newest, "three");
    utimesSync(oldest, new Date("2026-06-08T01:00:00.000Z"), new Date("2026-06-08T01:00:00.000Z"));
    utimesSync(middle, new Date("2026-06-08T02:00:00.000Z"), new Date("2026-06-08T02:00:00.000Z"));
    utimesSync(newest, new Date("2026-06-08T03:00:00.000Z"), new Date("2026-06-08T03:00:00.000Z"));

    try {
      const results = findRecentLocalArtifacts({ artifactsDir: tempDir, limit: 2 });
      expect(results).toEqual([newest, middle]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
