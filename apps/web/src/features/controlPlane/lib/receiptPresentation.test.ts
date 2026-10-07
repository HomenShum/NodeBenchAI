import { describe, expect, it } from "vitest";
import { formatApprovalQueueTime, toActionReceipt } from "./receiptPresentation";

describe("receiptPresentation", () => {
  it("maps a Convex receipt row into the frontend shape", () => {
    const mapped = toActionReceipt({
      receiptId: "sha256:test",
      agentId: "openclaw-agent",
      createdAt: Date.UTC(2026, 2, 10, 9, 22, 15),
      sessionKey: "agent:main:signal:user:+14155550123",
      channelId: "signal",
      direction: "draft",
      toolName: "send_message",
      params: { text: "hello" },
      actionSummary: "Drafted external reply",
      policyId: "pol_external_comms",
      policyRuleName: "Escalate external communications",
      policyAction: "escalated",
      evidenceRefs: ["ev_signal_thread_001"],
      resultSuccess: false,
      resultSummary: "Held for approval",
      resultOutputHash: "msg_123",
      canUndo: true,
      undoInstructions: "Cancel draft",
      approvalState: "pending",
      approvalRequestedAt: Date.UTC(2026, 2, 10, 9, 22, 15),
      openclawSessionId: "sess_123",
      openclawExecutionId: "exec_123",
      deployment: "openclaw-cloud",
      violations: [],
    });

    expect(mapped.channelId).toBe("signal");
    expect(mapped.direction).toBe("draft");
    expect(mapped.approval?.state).toBe("pending");
    expect(mapped.openclaw?.deployment).toBe("openclaw-cloud");
    expect(mapped.result.outputHash).toBe("msg_123");
  });

  it("formats queue timing for recent items", () => {
    const timestamp = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatApprovalQueueTime(timestamp)).toBe("5m ago");
  });
});
