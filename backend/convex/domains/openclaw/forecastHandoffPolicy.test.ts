import { describe, expect, it } from "vitest";
import type { ForecastGateDecision } from "../temporal/forecastGatePolicy";
import { buildForecastAwareOpenClawHandoff } from "./forecastHandoffPolicy";

function gate(recommendedAction: ForecastGateDecision["recommendedAction"]): ForecastGateDecision {
  return {
    streamKey: "packet:confidence",
    valuesCount: 8,
    modelUsed: "timesfm",
    trendDirection: recommendedAction === "delegate" ? "improving" : "declining",
    latestOutsideInterval: recommendedAction === "escalate",
    confidenceBandWidth: 0.1,
    recommendedAction,
    explanation: `Gate says ${recommendedAction}`,
    evidenceRefs: ["packet:latest"],
  };
}

describe("buildForecastAwareOpenClawHandoff", () => {
  it("allows bounded OpenClaw handoff only for delegate gates", () => {
    const handoff = buildForecastAwareOpenClawHandoff({
      forecastGate: gate("delegate"),
      activePacketId: "packet_123",
      packetLineageId: "lineage_123",
      successCriteria: ["return a browser verification summary"],
    });

    expect(handoff.shouldExecute).toBe(true);
    expect(handoff.executionDirective).toBe("delegate_now");
    expect(handoff.requiresApproval).toBe(true);
    expect(handoff.packet.activePacketId).toBe("packet_123");
    expect(handoff.packet.forecastGate.recommendedAction).toBe("delegate");
  });

  it("blocks OpenClaw when the packet must be refreshed first", () => {
    const handoff = buildForecastAwareOpenClawHandoff({
      forecastGate: gate("refresh_packet"),
      activePacketId: "packet_stale",
    });

    expect(handoff.shouldExecute).toBe(false);
    expect(handoff.executionDirective).toBe("hold_for_packet_refresh");
    expect(handoff.reason).toContain("packet refresh");
  });

  it("requires review before OpenClaw execution for anomaly escalation", () => {
    const handoff = buildForecastAwareOpenClawHandoff({
      forecastGate: gate("escalate"),
    });

    expect(handoff.shouldExecute).toBe(false);
    expect(handoff.requiresApproval).toBe(true);
    expect(handoff.executionDirective).toBe("hold_for_important_change_review");
  });
});
