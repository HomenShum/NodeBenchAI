import { History, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";

export type AuthorityReceiptSummary = {
  receiptId: string;
  event: "commit" | "undo";
  approvalMode: "explicit" | "delegated";
  agentLabel?: string;
  afterRevision: number;
  validationChecks: Array<{ passed: boolean }>;
  canUndoAtCommit: boolean;
  canUndoNow: boolean;
  undoUnavailableReason: string | null;
  createdAt: number;
};

function describeUndoUnavailable(reason: string | null): string {
  switch (reason) {
    case "undo_not_already_applied":
      return "Already undone";
    case "undo_revision_is_current":
    case "undo_content_is_current":
    case "undo_source_refs_are_current":
      return "Unavailable after a newer edit";
    case "undo_block_not_found":
      return "Original block is unavailable";
    case "undo_block_is_live":
      return "Original block was deleted";
    case "undo_block_is_editable":
      return "Block is no longer editable";
    case "remainder_completed_requires_composite_undo":
      return "Undo unavailable after the full accepted snapshot was added";
    default:
      return "Undo is unavailable for this receipt";
  }
}

export function DelegatedReceiptRow({
  receipt,
  onUndo,
  undoPending = false,
  className,
}: {
  receipt: AuthorityReceiptSummary;
  onUndo?: () => void;
  undoPending?: boolean;
  className?: string;
}) {
  const passedChecks = receipt.validationChecks.filter(
    (check) => check.passed,
  ).length;
  const canRequestUndo =
    receipt.event === "commit" && receipt.canUndoNow && Boolean(onUndo);
  const undoUnavailable =
    receipt.event === "commit" && !receipt.canUndoNow
      ? describeUndoUnavailable(receipt.undoUnavailableReason)
      : null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-surface-secondary px-3 py-2 text-[11px]",
        className,
      )}
      data-testid="authority-receipt"
    >
      <div className="flex min-w-0 items-start gap-2">
        <History
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="font-semibold text-content">
            {receipt.event === "undo"
              ? "Undo recorded"
              : receipt.approvalMode === "delegated"
                ? "Delegated commit"
                : "Owner-approved commit"}
            {" · "}
            {receipt.agentLabel ?? "NodeBench Notebook Coordinator"}
            {" · "}
            {passedChecks} checks passed
            {" · "}v{receipt.afterRevision}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-content-muted">
            {receipt.receiptId}
          </p>
          {undoUnavailable ? (
            <p className="mt-0.5 text-[10px] text-content-muted">
              {undoUnavailable}
            </p>
          ) : null}
        </div>
      </div>

      {canRequestUndo ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={undoPending}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-edge px-2 text-[11px] font-medium text-content-muted transition-colors hover:bg-surface-hover hover:text-content disabled:cursor-not-allowed disabled:opacity-50"
          title="Undo only succeeds if this receipt is still the current block version."
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {undoPending ? "Undoing…" : "Undo"}
        </button>
      ) : null}
    </div>
  );
}
