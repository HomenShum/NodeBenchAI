import { memo, useMemo } from "react";
import { useQuery } from "convex/react";
import { CheckCircle2, Clock3, ShieldAlert } from "lucide-react";
import { api } from "@convex/_generated/api";
import { cn } from "@/lib/utils";
import { formatApprovalQueueTime, toActionReceipt } from "../lib/receiptPresentation";

interface ReceiptApprovalQueueProps {
  className?: string;
  compact?: boolean;
  maxItems?: number;
}

export const ReceiptApprovalQueue = memo(function ReceiptApprovalQueue({
  className,
  compact = false,
  maxItems = 5,
}: ReceiptApprovalQueueProps) {
  const pending = useQuery(api.domains.agents.receipts.actionReceipts.listPendingApprovals, {
    limit: maxItems,
  });

  const receipts = useMemo(
    () => (pending ?? []).map((row) => toActionReceipt(row as Record<string, unknown>)),
    [pending],
  );

  if (pending === undefined) {
    return (
      <div className={cn("rounded-xl border border-edge bg-surface-secondary/40 p-5 text-center", className)}>
        <p className="text-sm font-medium text-content">Loading approval queue…</p>
      </div>
    );
  }

  if (!receipts.length) {
    return (
      <div className={cn("rounded-xl border border-edge bg-surface-secondary/40 p-5 text-center", className)}>
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
        </div>
        <p className="text-sm font-medium text-content">Approval queue is clear</p>
        <p className="mt-1 text-xs text-content-muted">No receipt-backed actions are waiting for a decision.</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {!compact && (
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-content">OpenClaw approvals</h3>
          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
            {receipts.length} pending
          </span>
        </div>
      )}

      <p className="text-xs text-content-muted">
        Execution remains held. Resume and decision controls are unavailable until a runtime consumer can enforce them.
      </p>

      {receipts.map((receipt) => {
        return (
          <div key={receipt.receiptId} className="rounded-xl border border-edge bg-surface-secondary/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                    Pending
                  </span>
                  {receipt.channelId && (
                    <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-indigo-300">
                      {receipt.channelId}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium text-content">{receipt.action.summary}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-content-muted">
                  <span>{receipt.agentId}</span>
                  {receipt.sessionKey && <code className="font-mono text-[11px]">{receipt.sessionKey}</code>}
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-3 w-3" />
                    {formatApprovalQueueTime(receipt.approval?.requestedAt ?? receipt.timestamp)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-content-muted">{receipt.result.summary}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

export default ReceiptApprovalQueue;
