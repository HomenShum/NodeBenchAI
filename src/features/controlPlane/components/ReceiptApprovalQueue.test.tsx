import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptApprovalQueue } from "./ReceiptApprovalQueue";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

describe("ReceiptApprovalQueue", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
  });

  it("shows an honest clear state when no approvals are returned", () => {
    useQueryMock.mockReturnValue([]);
    useMutationMock.mockReturnValue(vi.fn());

    render(<ReceiptApprovalQueue />);

    expect(screen.getByText(/approval queue is clear/i)).toBeInTheDocument();
    expect(screen.queryByText(/demo mode/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record approval/i })).not.toBeInTheDocument();
  });

  it("keeps pending receipts read-only while no resume consumer exists", () => {
    useQueryMock.mockReturnValue([
      {
        receiptId: "sha256:test",
        agentId: "openclaw-agent",
        createdAt: Date.now(),
        toolName: "send_message",
        actionSummary: "Drafted external reply",
        policyId: "pol_external_comms",
        policyRuleName: "Escalate external communications",
        policyAction: "escalated",
        evidenceRefs: [],
        resultSuccess: false,
        resultSummary: "Held for approval",
        canUndo: true,
        approvalState: "pending",
        violations: [],
      },
    ]);
    useMutationMock.mockReturnValue(vi.fn());

    render(<ReceiptApprovalQueue />);
    expect(screen.getByText(/execution remains held/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approv/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /den/i })).not.toBeInTheDocument();
    expect(useMutationMock).not.toHaveBeenCalled();
  });
});
