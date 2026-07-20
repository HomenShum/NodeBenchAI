/**
 * ActionReceiptFeed - chronological feed of agent actions with policy references,
 * evidence links, warning flags, and undo controls.
 */

import { memo, useMemo, useState } from "react";
import { Filter, Shield, ShieldAlert } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { cn } from "@/lib/utils";
import { ReceiptApprovalQueue } from "../components/ReceiptApprovalQueue";
import { ReceiptCard } from "../components/ReceiptCard";
import { toActionReceipt } from "../lib/receiptPresentation";

type FilterMode = "all" | "allowed" | "needs-approval" | "denied" | "reversible";
export const ActionReceiptFeed = memo(function ActionReceiptFeed() {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterMode>("all");

  const convexReceipts = useQuery(api.domains.agents.receipts.actionReceipts.list, { limit: 100 });
  const receipts = useMemo(
    () => (convexReceipts ?? []).map((row: any) => toActionReceipt(row as Record<string, unknown>)),
    [convexReceipts],
  );

  const filteredReceipts = useMemo(() => {
    if (filter === "all") return receipts;
    if (filter === "reversible") {
      return receipts.filter((receipt: any) => receipt.reversible.canUndo);
    }
    if (filter === "needs-approval") {
      return receipts.filter((receipt: any) => receipt.approval?.state === "pending");
    }
    return receipts.filter((receipt: any) => receipt.policyRef.action === filter);
  }, [filter, receipts]);

  const stats = useMemo(() => {
    const allowed = receipts.filter((receipt: any) => receipt.policyRef.action === "allowed").length;
    const denied = receipts.filter((receipt: any) => receipt.policyRef.action === "denied").length;
    const pending = receipts.filter((receipt: any) => receipt.approval?.state === "pending").length;
    const reversible = receipts.filter((receipt: any) => receipt.reversible.canUndo).length;
    return { allowed, denied, pending, reversible, total: receipts.length };
  }, [receipts]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filterButtons: { mode: FilterMode; label: string; count: number }[] = [
    { mode: "all", label: "All", count: stats.total },
    { mode: "needs-approval", label: "Needs approval", count: stats.pending },
    { mode: "denied", label: "Denied", count: stats.denied },
    { mode: "reversible", label: "Reversible", count: stats.reversible },
    { mode: "allowed", label: "Allowed", count: stats.allowed },
  ];

  if (convexReceipts === undefined) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 view-atmosphere-receipts">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[var(--accent-primary)]" />
            <h1 className="text-xl font-semibold tracking-tight text-content">Action Receipts</h1>
          </div>
          <p className="text-sm text-content-muted">Loading your recorded agent actions…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 view-atmosphere-receipts stagger [&>*]:animate-[fade-slide-in_0.5s_var(--ease-out-expo)_both]">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[var(--accent-primary)]" />
          <h1 className="text-xl font-semibold tracking-tight text-content">Action Receipts</h1>
        </div>
        <p className="text-sm text-content-muted">
          Tamper-evident records of what agents saw, did, and were allowed to do. Review denied actions,
          approval-gated steps, and reversible changes without leaving the feed. Execution fields are hashed;
          reviewer decisions remain an explicit mutable workflow.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Total", value: stats.total, color: "text-content" },
          { label: "Needs approval", value: stats.pending, color: "text-amber-400" },
          { label: "Reversible", value: stats.reversible, color: "text-[var(--accent-primary)]" },
          { label: "Denied", value: stats.denied, color: "text-red-400" },
          { label: "Allowed", value: stats.allowed, color: "text-emerald-400" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-edge bg-surface-secondary/50 px-3 py-2 text-center">
            <div className={cn("text-lg font-semibold", stat.color)}>{stat.value}</div>
            <div className="text-[11px] font-medium text-content-muted">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2" role="group" aria-label="Filter receipts by policy status">
        <Filter className="h-3.5 w-3.5 text-content-muted" aria-hidden="true" />
        <div className="flex gap-1">
          {filterButtons.map((button) => (
            <button
              key={button.mode}
              type="button"
              onClick={() => setFilter(button.mode)}
              aria-pressed={filter === button.mode}
              aria-label={`${button.label}: ${button.count} receipts`}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filter === button.mode
                  ? "border border-primary/20 bg-primary/10 text-primary"
                  : "text-content-muted hover:bg-surface-hover hover:text-content-secondary",
              )}
            >
              {button.label} ({button.count})
            </button>
          ))}
        </div>
      </div>

      <section className="space-y-3" aria-labelledby="receipt-approvals-heading">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-400" />
          <h2 id="receipt-approvals-heading" className="text-sm font-medium text-content-secondary">
            Approval queue
          </h2>
        </div>
        <p className="text-xs text-content-muted">
          Review held actions here. Execution remains held; resume and decision controls stay unavailable until the runtime can enforce them.
        </p>
        <ReceiptApprovalQueue compact />
      </section>

      <div className="space-y-2">
        {filteredReceipts.map((receipt: any) => (
          <ReceiptCard
            key={receipt.receiptId}
            receipt={receipt}
            isExpanded={expandedIds.has(receipt.receiptId)}
            onToggle={() => toggleExpand(receipt.receiptId)}
          />
        ))}
        {filteredReceipts.length === 0 && (
          <div className="py-12 text-center text-sm text-content-muted">
            {receipts.length === 0
              ? "No action receipts have been recorded yet."
              : "No receipts match this trust filter."}
          </div>
        )}
      </div>

      <div className="border-t border-edge/30 pt-4 text-center text-[11px] text-content-muted">
        Showing {receipts.length} recorded {receipts.length === 1 ? "receipt" : "receipts"}.
      </div>
    </div>
  );
});

export default ActionReceiptFeed;
