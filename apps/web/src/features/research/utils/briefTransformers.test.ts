import { describe, it, expect } from "vitest";

import { buildResearchStreamViewModel } from "@/features/research/utils/briefTransformers";
import type { ExecutiveBriefRecord } from "@/features/research/types/dailyBriefSchema";

describe("buildResearchStreamViewModel", () => {
  it("builds exactly 3 scrolly sections with progressive chart indices", () => {
    const record: ExecutiveBriefRecord = {
      status: "valid",
      brief: {
        meta: {
          date: "2025-12-13",
          headline: "The Morning Dossier — Test",
          summary: "A test summary for today's briefing.",
          confidence: 62,
        },
        actI: {
          title: "Act I — Setup: Coverage & Freshness",
          synthesis: "Coverage is broad and fresh across key sources.",
          topSources: [
            { source: "TechCrunch", count: 60 },
            { source: "GitHub", count: 20 },
          ],
          totalItems: 120,
          sourcesCount: 2,
          latestItemAt: "2025-12-13T22:00:00.000Z",
        },
        actII: {
          title: "Act II — Signals",
          synthesis: "Signals cluster around a small set of high-impact stories.",
          signals: [
            {
              id: "sig-1",
              headline: "Cloudflare outage impacts edge workloads",
              synthesis: "Downtime exposed dependency risks for edge-heavy systems.",
              evidence: [
                {
                  id: "ev-1",
                  source: "YCombinator",
                  title: "Cloudflare outage on December 5, 2025",
                  url: "https://example.com/cloudflare-outage",
                  publishedAt: "2025-12-13T10:00:00.000Z",
                  relevance: "Confirms the outage and captures the most-cited details.",
                },
              ],
            },
          ],
        },
        actIII: {
          title: "Act III — Actions",
          synthesis: "Convert signals into decisions and follow-ups.",
          actions: [
            {
              id: "act-1",
              label: "Assess blast radius",
              status: "proposed",
              content: "Map the dependency graph and identify critical choke points.",
              linkedSignalIds: ["sig-1"],
              priority: 1,
            },
            {
              id: "act-2",
              label: "Analyze trending repos",
              status: "insufficient_data",
              content: "Not enough validated output is available yet. Rerun this deep dive with additional context.",
              linkedSignalIds: ["sig-1"],
              priority: 2,
            },
          ],
        },
        dashboard: {
          sourceBreakdown: { TechCrunch: 60, GitHub: 20, YCombinator: 40 },
          trendingTags: ["AI", "Infra"],
        },
      },
      evidence: [
        {
          id: "ev-1",
          runId: "run-1",
          rank: 1,
          source: "YCombinator",
          title: "Cloudflare outage on December 5, 2025",
          url: "https://example.com/cloudflare-outage",
          sourceDomain: "example.com",
          publishedAt: "2025-12-13T10:00:00.000Z",
          relevance: "Confirms the outage and captures the most-cited details.",
        },
      ],
      provenance: {
        retrievalRuns: [
          {
            runId: "run-1",
            tool: "feed.getRecent",
            query: "{\"from\":\"2025-12-13T00:00:00.000Z\"}",
            executedAt: "2025-12-13T23:59:59.000Z",
            topK: 1,
            datasetHash: "deadbeefdeadbeef",
          },
        ],
      },
      errors: [],
    };

    const history = [
      { dateString: "2025-12-10", generatedAt: 1, version: 1, sourceSummary: { totalItems: 90 } },
      { dateString: "2025-12-11", generatedAt: 2, version: 1, sourceSummary: { totalItems: 100 } },
      { dateString: "2025-12-12", generatedAt: 3, version: 1, sourceSummary: { totalItems: 110 } },
      { dateString: "2025-12-13", generatedAt: 4, version: 1, sourceSummary: { totalItems: 120 } },
    ];

    const sections = buildResearchStreamViewModel({ record, history });
    expect(sections.map((s) => s.id)).toEqual(["act-1-setup", "act-2-signal", "act-3-move"]);

    const act1 = sections[0].dashboard_update!;
    const act2 = sections[1].dashboard_update!;
    const act3 = sections[2].dashboard_update!;

    // Act III suppresses "insufficient_data" / "skipped" actions (no visible failures).
    expect(sections[2].content.actions?.map((a) => a.id)).toEqual(["act-1"]);

    expect(act1.charts.trendLine.visibleEndIndex).toBe(2);
    expect(act2.charts.trendLine.visibleEndIndex).toBe(3);
    expect(act3.charts.trendLine.visibleEndIndex).toBe(5);
    expect(act2.charts.trendLine.focusIndex).toBe(3);
    expect(act1.charts.trendLine.presentIndex).toBe(3);
    expect(act2.charts.trendLine.presentIndex).toBe(3);
    expect(act3.charts.trendLine.presentIndex).toBe(3);

    // Series should be identical across acts; only indices differ.
    expect(act1.charts.trendLine.series).toEqual(act2.charts.trendLine.series);
    expect(act2.charts.trendLine.series).toEqual(act3.charts.trendLine.series);

    // "Today" point should carry linked evidence IDs in tooltip for evidence binding.
    const todayPoint = act2.charts.trendLine.series[0].data[3];
    expect(todayPoint.tooltip?.linkedEvidenceIds).toEqual(["ev-1"]);
  });

  it("fails closed when record is invalid or missing evidence", () => {
    const invalid: ExecutiveBriefRecord = {
      status: "invalid",
      brief: {
        meta: { date: "2025-12-13", headline: "x", summary: "x" },
        actI: { title: "x", synthesis: "x", topSources: [], totalItems: 1, sourcesCount: 1 },
        actII: { title: "x", synthesis: "x", signals: [] },
        actIII: { title: "x", synthesis: "x", actions: [] },
      },
      evidence: [],
      provenance: { retrievalRuns: [] },
      errors: ["Missing evidence"],
    };

    expect(buildResearchStreamViewModel({ record: invalid, history: [] })).toEqual([]);
  });
});
