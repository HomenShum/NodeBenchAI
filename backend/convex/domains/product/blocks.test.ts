import { describe, expect, it } from "vitest";

import { liveRowsOnly } from "./blocks";

describe("liveRowsOnly", () => {
  it("removes deleted rows while preserving the original order", () => {
    const rows = [
      { id: "live-1" },
      { id: "deleted-1", deletedAt: 1 },
      { id: "live-2" },
      { id: "deleted-2", deletedAt: 2 },
      { id: "live-3" },
    ];

    expect(liveRowsOnly(rows).map((row) => row.id)).toEqual(["live-1", "live-2", "live-3"]);
  });

  it("treats null deletedAt as a live row", () => {
    const rows = [{ id: "live-1", deletedAt: null }, { id: "deleted-1", deletedAt: 3 }];

    expect(liveRowsOnly(rows).map((row) => row.id)).toEqual(["live-1"]);
  });
});
