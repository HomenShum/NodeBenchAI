import { describe, expect, it } from "vitest";

import type { DailyBriefPayload } from "../types/dailyBriefSchema";
import {
  resolveBriefItemCount,
  resolveBriefLatestTimestamp,
  shouldSuppressBrief,
} from "./useBriefData";

function buildBrief(overrides: Partial<DailyBriefPayload> = {}): DailyBriefPayload {
  return {
    meta: {
      date: "2026-04-21",
      headline: "Fresh brief",
      summary: "Summary",
      ...overrides.meta,
    },
    quality: {
      coverage: {
        itemsScanned: 6,
        sourcesCount: 3,
        ...overrides.quality?.coverage,
      },
      freshness: {
        medianAgeHours: 2,
        windowLabel: "24h",
        newestAt: "2026-04-21T16:00:00.000Z",
        ...overrides.quality?.freshness,
      },
      confidence: {
        score: 80,
        hasDisagreement: false,
        level: "high",
        ...overrides.quality?.confidence,
      },
      ...overrides.quality,
    },
    actI: {
      title: "Act I",
      synthesis: "Coverage",
      topSources: [],
      totalItems: 6,
      sourcesCount: 3,
      latestItemAt: "2026-04-21T16:00:00.000Z",
      ...overrides.actI,
    },
    actII: {
      title: "Act II",
      synthesis: "Signals",
      signals: [],
      ...overrides.actII,
    },
    actIII: {
      title: "Act III",
      synthesis: "Actions",
      actions: [],
      ...overrides.actIII,
    },
    dashboard: overrides.dashboard,
    provenance: overrides.provenance,
    didYouKnow: overrides.didYouKnow,
  };
}

describe("useBriefData helpers", () => {
  it("prefers the freshest explicit timestamp when available", () => {
    const brief = buildBrief();
    expect(resolveBriefLatestTimestamp(brief)).toBe("2026-04-21T16:00:00.000Z");
  });

  it("falls back to the meta date when no freshness timestamp exists", () => {
    const brief = buildBrief({
      actI: {
        title: "Act I",
        synthesis: "Coverage",
        topSources: [],
        totalItems: 6,
        sourcesCount: 3,
        latestItemAt: undefined,
      },
      quality: {
        coverage: { itemsScanned: 6, sourcesCount: 3 },
        freshness: { medianAgeHours: 2, windowLabel: "24h", newestAt: undefined },
        confidence: { score: 80, hasDisagreement: false, level: "high" },
      },
    });

    expect(resolveBriefLatestTimestamp(brief)).toBe("2026-04-21T23:59:59.000Z");
  });

  it("suppresses briefs that are too sparse", () => {
    const brief = buildBrief({
      actI: { title: "Act I", synthesis: "Coverage", topSources: [], totalItems: 2, sourcesCount: 1 },
      quality: {
        coverage: { itemsScanned: 2, sourcesCount: 1 },
        freshness: { medianAgeHours: 2, windowLabel: "24h", newestAt: "2026-04-21T16:00:00.000Z" },
        confidence: { score: 80, hasDisagreement: false, level: "high" },
      },
    });

    expect(resolveBriefItemCount(brief)).toBe(2);
    expect(shouldSuppressBrief(brief, Date.parse("2026-04-21T20:00:00.000Z"))).toBe(true);
  });

  it("suppresses briefs that are older than the freshness budget", () => {
    const brief = buildBrief({
      actI: {
        title: "Act I",
        synthesis: "Coverage",
        topSources: [],
        totalItems: 6,
        sourcesCount: 3,
        latestItemAt: "2026-04-20T00:00:00.000Z",
      },
      quality: {
        coverage: { itemsScanned: 6, sourcesCount: 3 },
        freshness: { medianAgeHours: 30, windowLabel: "48h", newestAt: "2026-04-20T00:00:00.000Z" },
        confidence: { score: 80, hasDisagreement: false, level: "high" },
      },
    });

    expect(shouldSuppressBrief(brief, Date.parse("2026-04-21T20:00:00.000Z"))).toBe(true);
  });

  it("keeps fresh briefs with enough coverage", () => {
    const brief = buildBrief();
    expect(shouldSuppressBrief(brief, Date.parse("2026-04-21T20:00:00.000Z"))).toBe(false);
  });
});
