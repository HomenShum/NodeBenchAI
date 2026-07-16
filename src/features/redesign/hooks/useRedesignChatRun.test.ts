import { describe, expect, it } from "vitest";
import {
  buildPartialChatAnswer,
  isPaidChatEligibleUser,
  normalizeRouterTierForChatRun,
  resolveRuntimeArtifacts,
} from "./useRedesignChatRun";

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

describe("runtime projection honesty", () => {
  it("does not synthesize context candidates or tool decisions when events omit them", () => {
    expect(resolveRuntimeArtifacts({
      contextCandidates: [],
      toolDecisions: [],
      claimChecks: [],
    })).toEqual({
      contextCandidates: [],
      toolDecisions: [],
      claimChecks: [],
    });
  });

  it("omits paid-call telemetry unless the runtime emitted it", () => {
    const withoutMetrics = buildPartialChatAnswer({
      sections: {},
      groundingChunks: [],
      toolCalls: [],
    });
    expect(withoutMetrics).not.toHaveProperty("paidCalls");
    expect(withoutMetrics).not.toHaveProperty("fromMemory");

    const withMetrics = buildPartialChatAnswer({
      sections: {},
      groundingChunks: [],
      toolCalls: [],
      metrics: { paidCalls: 2 },
    });
    expect(withMetrics.paidCalls).toBe(2);
  });
});
