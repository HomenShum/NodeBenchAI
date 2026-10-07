import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCockpitPath } from "@/lib/registry/viewRegistry";
import {
  buildEntityPrepChatPath,
  buildEntityRefreshChatPath,
  buildEntityReopenChatPath,
  getNotebookDriftSummary,
  getSectionSources,
  getSourceSupportingSections,
  isLiveNotebookInRolloutCohort,
  isLiveNotebookEnabled,
  normalizeLiveNotebookRolloutPercent,
  stableLiveNotebookBucket,
} from "./EntityPage";

describe("EntityPage route helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds a deterministic reopen path from the saved report query and lens", () => {
    expect(
      buildEntityReopenChatPath(
        { query: "What does Ramp do and why does it matter?", lens: "founder" },
        { slug: "ramp", name: "Ramp" },
      ),
    ).toBe(
      buildCockpitPath({
        surfaceId: "workspace",
        entity: "ramp",
        extra: {
          q: "What does Ramp do and why does it matter?",
          lens: "founder",
        },
      }),
    );
  });

  it("prefers the refresh contract returned from Reports when routing back into Chat", () => {
    expect(
      buildEntityRefreshChatPath(
        {
          reportId: "report_123",
          entitySlug: "ramp",
          lens: "investor",
          refreshPrompt: "Update Ramp and show me what changed from the saved report.",
        },
        {
          _id: "fallback_report",
          query: "Fallback query",
          lens: "founder",
        },
        { slug: "ramp", name: "Ramp" },
      ),
    ).toBe(
      buildCockpitPath({
        surfaceId: "workspace",
        entity: "ramp",
        extra: {
          q: "Update Ramp and show me what changed from the saved report.",
          lens: "investor",
          report: "report_123",
        },
      }),
    );
  });

  it("builds a prep-brief path for the current entity", () => {
    expect(
      buildEntityPrepChatPath(
        { query: "What changed at Ramp?", lens: "investor" },
        { slug: "ramp", name: "Ramp" },
      ),
    ).toBe(
      buildCockpitPath({
        surfaceId: "workspace",
        entity: "ramp",
        extra: {
          q: "Ramp prep brief. Include the most important facts, likely questions, likely objections or risks, and the opening I should use.",
          lens: "investor",
        },
      }),
    );
  });

  it("falls back to a generated refresh prompt when the refresh result is sparse", () => {
    expect(
      buildEntityRefreshChatPath(
        null,
        {
          _id: "report_456",
          query: "What changed at Ramp?",
          lens: "founder",
        },
        { slug: "ramp", name: "Ramp" },
      ),
    ).toBe(
      buildCockpitPath({
        surfaceId: "workspace",
        entity: "ramp",
        extra: {
          q: "Update Ramp and show me what changed from the saved report.",
          lens: "founder",
          report: "report_456",
        },
      }),
    );
  });

  it("resolves section sources by id or label and preserves their full order", () => {
    expect(
      getSectionSources(
        {
          id: "signals",
          title: "Signals",
          body: "Important signals.",
          sourceRefIds: ["src_1", "The Information"],
        },
        [
          { id: "src_1", label: "Crunchbase", href: "https://www.crunchbase.com" },
          { id: "src_2", label: "The Information", href: "https://www.theinformation.com" },
          { id: "src_3", label: "TechCrunch", href: "https://techcrunch.com" },
        ],
      ).map((source) => source.label),
    ).toEqual(["Crunchbase", "The Information"]);
  });

  it("lists every saved section supported by a given source", () => {
    expect(
      getSourceSupportingSections(
        { id: "src_2", label: "The Information", href: "https://www.theinformation.com" },
        [
          {
            id: "signals",
            title: "Signals",
            body: "Important signals.",
            sourceRefIds: ["src_2"],
          },
          {
            id: "why-it-matters",
            title: "Why it matters",
            body: "Why this matters.",
            sourceRefIds: ["The Information"],
          },
          {
            id: "next-step",
            title: "What to do next",
            body: "Call the founder.",
            sourceRefIds: ["src_9"],
          },
        ],
      ),
    ).toEqual(["Signals", "Why it matters"]);
  });

  it("reports when live notebook edits are newer than the saved report", () => {
    expect(
      getNotebookDriftSummary(
        {
          blockCount: 4,
          userEditedCount: 2,
          latestUpdatedAt: 300,
          latestUserEditAt: 300,
        },
        {
          _id: "report_1",
          title: "Ramp",
          type: "company",
          summary: "summary",
          query: "query",
          lens: "founder",
          sections: [],
          sources: [],
          diffs: [],
          isLatest: true,
          createdAt: 100,
          updatedAt: 200,
        },
      ),
    ).toEqual({
      updatedAt: 300,
      message: "2 live notebook edits are newer than the saved report. Classic may lag behind Live ✨.",
    });
  });
  it("does not report drift when only agent notebook blocks are newer than the saved report", () => {
    expect(
      getNotebookDriftSummary(
        {
          blockCount: 4,
          userEditedCount: 0,
          latestUpdatedAt: 300,
          latestUserEditAt: undefined,
        },
        {
          _id: "report_1",
          title: "Ramp",
          type: "company",
          summary: "summary",
          query: "query",
          lens: "founder",
          sections: [],
          sources: [],
          diffs: [],
          isLatest: true,
          createdAt: 100,
          updatedAt: 200,
        },
      ),
    ).toBeNull();
  });

  it("normalizes rollout percentages into a stable 0-100 range", () => {
    expect(normalizeLiveNotebookRolloutPercent(undefined)).toBe(100);
    expect(normalizeLiveNotebookRolloutPercent("250")).toBe(100);
    expect(normalizeLiveNotebookRolloutPercent("-5")).toBe(0);
    expect(normalizeLiveNotebookRolloutPercent("35")).toBe(35);
  });

  it("uses a deterministic rollout bucket per seed", () => {
    expect(stableLiveNotebookBucket("session-a:ramp")).toBe(stableLiveNotebookBucket("session-a:ramp"));
    expect(stableLiveNotebookBucket("session-a:ramp")).not.toBe(stableLiveNotebookBucket("session-b:ramp"));
  });

  it("supports staged rollout by session and entity slug", () => {
    expect(
      isLiveNotebookInRolloutCohort(
        normalizeLiveNotebookRolloutPercent("50"),
        "session-a",
        "ramp",
      ),
    ).toBe(stableLiveNotebookBucket("session-a:ramp") < 50);
  });

  it("lets the local disable override beat rollout eligibility", () => {
    vi.stubEnv("VITE_NOTEBOOK_LIVE_ROLLOUT_PERCENT", "100");
    window.localStorage.setItem("nodebench.liveNotebookDisabled", "1");
    expect(isLiveNotebookEnabled("ramp")).toBe(false);
  });
});
