import { describe, expect, it } from "vitest";
import { normalizeRouterTierForChatRun } from "./useRedesignChatRun";

describe("normalizeRouterTierForChatRun", () => {
  it("maps UI-only tiers to Convex chat run tiers", () => {
    expect(normalizeRouterTierForChatRun("answer")).toBe("fast");
    expect(normalizeRouterTierForChatRun("compare")).toBe("deep");
  });

  it("keeps backend-compatible tiers unchanged", () => {
    expect(normalizeRouterTierForChatRun("auto")).toBe("auto");
    expect(normalizeRouterTierForChatRun("deep")).toBe("deep");
  });
});
