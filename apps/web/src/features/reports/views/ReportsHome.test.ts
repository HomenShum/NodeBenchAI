import { describe, expect, it } from "vitest";

import { buildReportGroups, filterReportCards, getFreshness } from "./ReportsHome";

describe("buildReportGroups", () => {
  const cards = [
    {
      slug: "dirk-xu",
      name: "Dirk Xu",
      summary: "Founder profile",
      entityType: "person",
      latestRevision: 1,
      reportCount: 1,
      updatedAt: Date.now(),
      updatedLabel: "1m ago",
    },
    {
      slug: "cliffside-ventures",
      name: "Cliffside Ventures",
      summary: "Firm brief",
      entityType: "company",
      latestRevision: 1,
      reportCount: 1,
      updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      updatedLabel: "2d ago",
    },
  ];

  it("groups entity cards by meta domain", () => {
    const groups = buildReportGroups(cards, "entityType");
    expect(groups.map((group) => group.label)).toEqual(["People", "Companies"]);
    expect(groups[0]?.cards[0]?.slug).toBe("dirk-xu");
    expect(groups[1]?.cards[0]?.slug).toBe("cliffside-ventures");
  });

  it("groups entity cards by relative date buckets", () => {
    const groups = buildReportGroups(cards, "updatedAt");
    expect(groups.map((group) => group.label)).toEqual(["Today", "This week"]);
  });

  it("groups entity cards by origin layer", () => {
    const groups = buildReportGroups(
      [
        { ...cards[0], origin: "user" as const },
        { ...cards[1], origin: "system" as const },
      ],
      "origin",
    );
    expect(groups.map((group) => group.label)).toEqual(["Your workspace", "System intelligence"]);
  });
});

describe("filterReportCards", () => {
  const cards = [
    {
      slug: "dirk-xu",
      name: "Dirk Xu",
      summary: "Founder profile",
      entityType: "person",
      latestRevision: 1,
      reportCount: 1,
      updatedAt: Date.now(),
      updatedLabel: "1m ago",
    },
    {
      slug: "cliffside-ventures",
      name: "Cliffside Ventures",
      summary: "Firm brief",
      entityType: "company",
      latestRevision: 1,
      reportCount: 1,
      updatedAt: Date.now(),
      updatedLabel: "1m ago",
    },
    {
      slug: "growth-role",
      name: "Growth role",
      summary: "Job brief",
      entityType: "job",
      latestRevision: 1,
      reportCount: 1,
      updatedAt: Date.now(),
      updatedLabel: "1m ago",
    },
  ];

  it("leaves the all tab unfiltered so the all badge can reflect the true total", () => {
    expect(filterReportCards(cards, "all").map((card) => card.slug)).toEqual([
      "dirk-xu",
      "cliffside-ventures",
      "growth-role",
    ]);
  });

  it("filters the visible list for a specific tab without changing the underlying total set", () => {
    expect(filterReportCards(cards, "people").map((card) => card.slug)).toEqual(["dirk-xu"]);
    expect(filterReportCards(cards, "companies").map((card) => card.slug)).toEqual([
      "cliffside-ventures",
    ]);
  });
});

// Scenario:  Returning operator scans the Reports grid and needs each card to signal at a glance
//            whether its underlying data is fresh, still recent, stale, or unknown. The pill color
//            downstream drives an at-a-glance trust decision, so the tiering boundaries must be exact.
// User:      Returning operator (power user pattern) — has 20+ saved reports, scans for attention triage
// Scale:     Up to ~1k reports per viewport filter — O(n) pass twice (fresh/stale counts), must stay pure
// Duration:  Single render — but the same card may be re-evaluated across re-renders, so deterministic clock is required
// Failure modes that MUST be covered: missing timestamp, 0 timestamp, future timestamp, exact 24h boundary, exact 7d boundary
describe("getFreshness", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const WEEK = 7 * DAY;
  const NOW = 1_700_000_000_000; // fixed reference so boundary math is stable across clocks

  it("treats a missing timestamp as unknown (not fresh, so stale count is honest)", () => {
    expect(getFreshness(undefined, NOW)).toBe("unknown");
  });

  it("treats 0 as unknown (falsy guard — avoids mis-tiering seeded-but-not-yet-updated rows)", () => {
    expect(getFreshness(0, NOW)).toBe("unknown");
  });

  it("marks updates within the last 24h as fresh (today)", () => {
    expect(getFreshness(NOW - 1, NOW)).toBe("fresh");
    expect(getFreshness(NOW - 23 * HOUR, NOW)).toBe("fresh");
  });

  it("downgrades at exactly the 24h boundary from fresh to recent", () => {
    // At ageMs >= 24h we must stop claiming "updated today" — this is the subtitle's honesty contract
    expect(getFreshness(NOW - DAY, NOW)).toBe("recent");
  });

  it("marks 2d–6d old as recent (this week, not stale)", () => {
    expect(getFreshness(NOW - 2 * DAY, NOW)).toBe("recent");
    expect(getFreshness(NOW - (WEEK - HOUR), NOW)).toBe("recent");
  });

  it("downgrades at exactly the 7d boundary from recent to stale", () => {
    // At ageMs >= 7d the amber "stale" pill must appear — agents and operators both depend on this signal
    expect(getFreshness(NOW - WEEK, NOW)).toBe("stale");
  });

  it("marks anything older than 7d as stale", () => {
    expect(getFreshness(NOW - 30 * DAY, NOW)).toBe("stale");
    expect(getFreshness(NOW - 365 * DAY, NOW)).toBe("stale");
  });

  it("treats a future timestamp as fresh rather than reporting negative age", () => {
    // Clock skew between client and server is real — never render "stale" for a future-dated row
    expect(getFreshness(NOW + HOUR, NOW)).toBe("fresh");
  });
});
