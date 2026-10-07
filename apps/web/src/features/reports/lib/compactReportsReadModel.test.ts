import { describe, expect, it } from "vitest";

import { buildCompactReportsReadModel } from "./compactReportsReadModel";

describe("buildCompactReportsReadModel", () => {
  it("keeps loading honest instead of substituting starter reports", () => {
    const model = buildCompactReportsReadModel({
      liveReports: undefined,
      filter: "all",
      visibleCount: 2,
    });
    expect(model.sourceKind).toBe("loading");
    expect(model.visibleReports).toEqual([]);
    expect(model.hiddenCount).toBe(0);
  });

  it("returns an honest empty state when the runtime has no reports", () => {
    const model = buildCompactReportsReadModel({
      liveReports: [],
      filter: "all",
      visibleCount: 2,
    });
    expect(model.sourceKind).toBe("empty");
    expect(model.sourceLabel).toBe("no saved reports");
    expect(model.visibleReports).toEqual([]);
  });

  it("prefers saved runtime reports and applies filters before windowing", () => {
    const model = buildCompactReportsReadModel({
      liveReports: [
        { id: "live-a", state: "verified" },
        { id: "live-b", state: "watching" },
      ],
      filter: "verified",
      visibleCount: 8,
    });
    expect(model.sourceKind).toBe("live_convex");
    expect(model.sourceLabel).toBe("saved reports");
    expect(model.visibleReports.map((report) => report.id)).toEqual(["live-a"]);
  });
});
