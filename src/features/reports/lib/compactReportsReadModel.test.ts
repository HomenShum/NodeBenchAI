import { describe, expect, it } from "vitest";

import { buildCompactReportsReadModel } from "./compactReportsReadModel";

describe("buildCompactReportsReadModel", () => {
  const fallback = [
    { id: "a", state: "verified" },
    { id: "b", state: "needs review" },
    { id: "c", state: "verified" },
  ];

  it("uses starter data only when live reports are absent", () => {
    const model = buildCompactReportsReadModel({
      liveReports: null,
      fallbackReports: fallback,
      filter: "all",
      visibleCount: 2,
    });
    expect(model.sourceKind).toBe("starter");
    expect(model.visibleReports.map((report) => report.id)).toEqual(["a", "b"]);
    expect(model.hiddenCount).toBe(1);
  });

  it("prefers live reports and applies filters before windowing", () => {
    const model = buildCompactReportsReadModel({
      liveReports: [
        { id: "live-a", state: "verified" },
        { id: "live-b", state: "watching" },
      ],
      fallbackReports: fallback,
      filter: "verified",
      visibleCount: 8,
    });
    expect(model.sourceKind).toBe("live_convex");
    expect(model.visibleReports.map((report) => report.id)).toEqual(["live-a"]);
  });
});
