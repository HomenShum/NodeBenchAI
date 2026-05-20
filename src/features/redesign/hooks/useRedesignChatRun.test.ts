import { describe, expect, it } from "vitest";
import { isPaidChatEligibleUser, normalizeRouterTierForChatRun } from "./useRedesignChatRun";

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

describe("isPaidChatEligibleUser", () => {
  it("requires an email-backed account for live research", () => {
    expect(isPaidChatEligibleUser(null)).toBe(false);
    expect(isPaidChatEligibleUser({})).toBe(false);
    expect(isPaidChatEligibleUser({ email: "" })).toBe(false);
    expect(isPaidChatEligibleUser({ email: "founder@example.com" })).toBe(true);
  });
});
