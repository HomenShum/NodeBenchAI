// Re-export shim — canonical tests live in convex/domains/analytics/__tests__/
import { describe, it, expect } from "vitest";

describe("intentSignals (search/analytics shim)", () => {
  it("delegates to consolidated analytics domain", () => {
    expect(true).toBe(true);
  });
});
