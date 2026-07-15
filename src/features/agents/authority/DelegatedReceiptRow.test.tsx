import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DelegatedReceiptRow } from "./DelegatedReceiptRow";

const receipt = {
  receiptId: "receipt_abc123",
  event: "commit" as const,
  approvalMode: "delegated" as const,
  agentLabel: "NodeBench Notebook Coordinator",
  afterRevision: 24,
  validationChecks: [{ passed: true }, { passed: true }, { passed: false }],
  canUndoAtCommit: true,
  canUndoNow: true,
  undoUnavailableReason: null,
  createdAt: 1,
};

describe("DelegatedReceiptRow", () => {
  it("renders only supplied server receipt evidence", () => {
    render(<DelegatedReceiptRow receipt={receipt} />);

    expect(screen.getByText(/Delegated commit/)).toHaveTextContent(
      "NodeBench Notebook Coordinator",
    );
    expect(screen.getByText(/Delegated commit/)).toHaveTextContent(
      "2 checks passed",
    );
    expect(screen.getByText(/Delegated commit/)).toHaveTextContent("v24");
    expect(screen.getByText("receipt_abc123")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("offers guarded undo only when a live handler is supplied", () => {
    const onUndo = vi.fn();
    render(<DelegatedReceiptRow receipt={receipt} onUndo={onUndo} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("never offers undo for an undo receipt", () => {
    render(
      <DelegatedReceiptRow
        receipt={{ ...receipt, event: "undo", approvalMode: "explicit" }}
        onUndo={vi.fn()}
      />,
    );

    expect(screen.getByText(/Undo recorded/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("explains when a newer edit makes undo stale", () => {
    render(
      <DelegatedReceiptRow
        receipt={{
          ...receipt,
          canUndoNow: false,
          undoUnavailableReason: "undo_revision_is_current",
        }}
        onUndo={vi.fn()}
      />,
    );

    expect(screen.getByText("Unavailable after a newer edit")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("explains why a completed multi-block accept cannot use target-only undo", () => {
    render(
      <DelegatedReceiptRow
        receipt={{
          ...receipt,
          canUndoNow: false,
          undoUnavailableReason: "remainder_completed_requires_composite_undo",
        }}
        onUndo={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Undo unavailable after the full accepted snapshot was added"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});
