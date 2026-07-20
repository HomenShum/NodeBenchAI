import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionReceiptFeed } from "./ActionReceiptFeed";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

describe("ActionReceiptFeed", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useQueryMock.mockReturnValue([]);
    useMutationMock.mockReturnValue(vi.fn());
  });

  it("shows an honest empty state instead of demo receipts", () => {
    render(<ActionReceiptFeed />);

    expect(screen.getByText(/no action receipts have been recorded yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/demo mode/i)).not.toBeInTheDocument();
    expect(screen.getByText(/showing 0 recorded receipts/i)).toBeInTheDocument();
  });

  it("renders only receipt data returned by the runtime", () => {
    useQueryMock.mockReturnValue([
        {
          receiptId: "sha256:runtime-receipt",
          agentId: "runtime-agent",
          createdAt: Date.now(),
          toolName: "search_sources",
          actionSummary: "Searched founder evidence",
          policyId: "policy-runtime",
          policyRuleName: "Runtime policy",
          policyAction: "allowed",
          evidenceRefs: [],
          resultSuccess: true,
          resultSummary: "Returned grounded sources",
          canUndo: false,
          violations: [],
        },
      ]);

    render(<ActionReceiptFeed />);

    fireEvent.click(screen.getByRole("button", { name: /searched founder evidence/i }));

    expect(screen.getByText(/no rollback available\./i)).toBeInTheDocument();
    expect(screen.getAllByText(/returned grounded sources/i)).not.toHaveLength(0);
    expect(screen.queryByText(/golden action-receipt dataset/i)).not.toBeInTheDocument();
  });
});
