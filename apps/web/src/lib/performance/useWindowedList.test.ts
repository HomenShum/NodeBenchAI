import { describe, expect, it } from "vitest";

import { getWindowedItems } from "./useWindowedList";

describe("getWindowedItems", () => {
  it("returns a stable first window and remaining count", () => {
    const result = getWindowedItems([1, 2, 3, 4, 5], 3);
    expect(result.visibleItems).toEqual([1, 2, 3]);
    expect(result.remainingCount).toBe(2);
    expect(result.hasMore).toBe(true);
  });

  it("clamps the requested size to the list length", () => {
    const result = getWindowedItems(["a", "b"], 10);
    expect(result.visibleItems).toEqual(["a", "b"]);
    expect(result.remainingCount).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});
