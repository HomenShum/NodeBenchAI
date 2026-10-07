import { describe, expect, test } from "vitest";

import { buildAttentionItems, summarizeColumnCounts } from "../autonomousControlTower";

describe("autonomousControlTower", () => {
  test("summarizeColumnCounts groups cards by workflow column", () => {
    const summary = summarizeColumnCounts([
      { meta: { column: "inbox" } },
      { meta: { column: "inbox" } },
      { meta: { column: "human_review" } },
      { meta: {} },
    ]);

    expect(summary.total).toBe(4);
    expect(summary.byColumn.inbox).toBe(2);
    expect(summary.byColumn.human_review).toBe(1);
    expect(summary.byColumn.unknown).toBe(1);
  });

  test("buildAttentionItems prioritizes alerts and maintenance failures", () => {
    const items = buildAttentionItems({
      activeAlerts: [
        { component: "database", status: "unhealthy", issues: ["Database latency too high"] },
      ],
      maintenanceErrors: ["Did You Know gate failed"],
      maintenanceWarnings: ["Intent telemetry fallback rate is above 85%"],
      hotspotInboxCount: 2,
      hotspotHumanReviewCount: 1,
      bugHumanApproveCount: 3,
    });

    expect(items[0]).toMatchObject({
      severity: "critical",
      title: "database is unhealthy",
    });
    expect(items.some((item) => item.detail.includes("Did You Know gate failed"))).toBe(true);
    expect(items.some((item) => item.detail.includes("2 hotspot cards"))).toBe(true);
  });
});
