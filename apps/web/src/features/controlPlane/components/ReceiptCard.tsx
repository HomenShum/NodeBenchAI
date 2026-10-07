/**
 * ReceiptCard - shared receipt display components used by the receipts and delegation views.
 */

import { memo } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  Hash,
  Link2,
  Radio,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Undo2,
  Workflow,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionReceipt, ApprovalState, PolicyAction, ViolationSeverity } from "../types/actionReceipt";

export const POLICY_STYLES: Record<PolicyAction, { icon: typeof ShieldCheck; label: string; className: string }> = {
  allowed: {
    icon: ShieldCheck,
    label: "Allowed",
    className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-500",
  },
  escalated: {
    icon: ShieldAlert,
    label: "Needs approval",
    className: "border-amber-500/20 bg-amber-500/10 text-amber-500",
  },
  denied: {
    icon: ShieldX,
    label: "Denied",
    className: "border-red-500/20 bg-red-500/10 text-red-500",
  },
};

export const SEVERITY_STYLES: Record<ViolationSeverity, { className: string; icon: typeof AlertTriangle }> = {
  warning: { className: "bg-amber-500/10 text-amber-400", icon: AlertTriangle },
  block: { className: "bg-red-500/10 text-red-400", icon: XCircle },
  audit_only: { className: "bg-surface-secondary/50 text-content-muted", icon: Eye },
};

const APPROVAL_STYLES: Record<ApprovalState, string> = {
  not_required: "border-edge bg-surface-secondary/50 text-content-muted",
  pending: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  approved: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  denied: "border-red-500/20 bg-red-500/10 text-red-400",
};

export const PolicyBadge = memo(function PolicyBadge({ action }: { action: PolicyAction }) {
  const style = POLICY_STYLES[action];
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", style.className)}>
      <Icon className="h-3 w-3" />
      {style.label}
    </span>
  );
});

export const ViolationCard = memo(function ViolationCard({
  violation,
}: {
  violation: ActionReceipt["violations"][number];
}) {
  const style = SEVERITY_STYLES[violation.severity];
  const Icon = style.icon;
  return (
    <div className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-xs", style.className)}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{violation.ruleName}</div>
        <div className="mt-0.5 text-inherit/80">{violation.description}</div>
        {violation.resolution && <div className="mt-1 italic text-inherit/60">Resolution: {violation.resolution}</div>}
      </div>
    </div>
  );
});

export interface ReceiptRollbackState {
  isUndoing?: boolean;
  rolledBackAt?: string;
  rollbackRef?: string;
  modeLabel?: string;
}

export const ReceiptCard = memo(function ReceiptCard({
  receipt,
  isExpanded,
  onToggle,
  onUndo,
  rollbackState,
}: {
  receipt: ActionReceipt;
  isExpanded: boolean;
  onToggle: () => void;
  onUndo?: (receipt: ActionReceipt) => void;
  rollbackState?: ReceiptRollbackState;
}) {
  const hasViolations = receipt.violations.length > 0;
  const policyStyle = POLICY_STYLES[receipt.policyRef.action];
  const approvalState = receipt.approval?.state ?? "not_required";
  const rolledBackAt = rollbackState?.rolledBackAt;
  const canExecuteUndo = receipt.reversible.canUndo && Boolean(onUndo) && !rolledBackAt;
  const time = new Date(receipt.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      className={cn(
        "rounded-xl border transition-all duration-200",
        hasViolations
          ? receipt.policyRef.action === "denied"
            ? "border-red-500/20 bg-red-500/[0.03]"
            : "border-amber-500/20 bg-amber-500/[0.03]"
          : "border-edge bg-surface-secondary/50",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-label={`${receipt.action.summary} - ${receipt.policyRef.action}${hasViolations ? `, ${receipt.violations.length} violation(s)` : ""}`}
        className="group flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div className={cn("h-2 w-2 shrink-0 rounded-full", policyStyle.className.split(" ")[2])} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="truncate font-medium text-content">{receipt.action.summary}</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-content-muted">
            <span className="inline-flex items-center gap-1">
              <Bot className="h-3 w-3" />
              {receipt.agentId}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {time}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <PolicyBadge action={receipt.policyRef.action} />
          {rolledBackAt && (
            <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
              Rolled back
            </span>
          )}
          {approvalState !== "not_required" && (
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", APPROVAL_STYLES[approvalState])}>
              {approvalState}
            </span>
          )}
          {hasViolations && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-400"
              aria-label={`${receipt.violations.length} violation${receipt.violations.length !== 1 ? "s" : ""}`}
            >
              {receipt.violations.length}
            </span>
          )}
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-content-muted" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-content-muted" aria-hidden="true" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-3 border-t border-edge/50 px-4 pb-4 pt-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="mb-1 font-medium text-content-muted">Tool</div>
              <code className="rounded bg-surface-secondary px-1.5 py-0.5 font-mono text-[11px] text-content-secondary">
                {receipt.action.toolName}
              </code>
            </div>
            <div>
              <div className="mb-1 font-medium text-content-muted">Policy Rule</div>
              <span className="text-content-secondary">{receipt.policyRef.ruleName}</span>
            </div>
          </div>

          {(receipt.channelId || receipt.sessionKey || receipt.direction) && (
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
              {receipt.channelId && (
                <div>
                  <div className="mb-1 font-medium text-content-muted">Channel</div>
                  <span className="inline-flex items-center gap-1 text-content-secondary">
                    <Radio className="h-3 w-3" />
                    {receipt.channelId}
                  </span>
                </div>
              )}
              {receipt.direction && (
                <div>
                  <div className="mb-1 font-medium text-content-muted">Direction</div>
                  <span className="inline-flex items-center gap-1 text-content-secondary">
                    <Workflow className="h-3 w-3" />
                    {receipt.direction}
                  </span>
                </div>
              )}
              {receipt.sessionKey && (
                <div className="min-w-0">
                  <div className="mb-1 font-medium text-content-muted">Session</div>
                  <code className="block truncate font-mono text-[11px] text-content-secondary">{receipt.sessionKey}</code>
                </div>
              )}
            </div>
          )}

          <div className="text-xs">
            <div className="mb-1 font-medium text-content-muted">Result</div>
            <div className={cn("text-sm", receipt.result.success ? "text-content-secondary" : "text-amber-400")}>
              {receipt.result.summary}
            </div>
          </div>

          {receipt.evidenceRefs.length > 0 && (
            <div className="text-xs">
              <div className="mb-1 font-medium text-content-muted">Evidence References</div>
              <div className="flex flex-wrap gap-1.5">
                {receipt.evidenceRefs.map((ref) => (
                  <span
                    key={ref}
                    className="inline-flex items-center gap-1 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 font-mono text-[11px] text-indigo-400"
                  >
                    <Link2 className="h-2.5 w-2.5" />
                    {ref}
                  </span>
                ))}
              </div>
            </div>
          )}

          {receipt.result.outputHash && (
            <div className="text-xs">
              <div className="mb-1 font-medium text-content-muted">Output Hash</div>
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-content-muted">
                <Hash className="h-3 w-3" />
                {receipt.result.outputHash}
              </span>
            </div>
          )}

          {hasViolations && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-content-muted">Violations</div>
              {receipt.violations.map((violation) => (
                <ViolationCard key={violation.ruleId} violation={violation} />
              ))}
            </div>
          )}

          {receipt.approval && receipt.approval.state !== "not_required" && (
            <div className="rounded-lg border border-edge/60 bg-black/10 p-3 text-xs">
              <div className="font-medium text-content-muted">Approval lifecycle</div>
              <div className="mt-1 text-content-secondary">
                State: <span className="font-medium">{receipt.approval.state}</span>
              </div>
              {receipt.approval.requestedAt && (
                <div className="mt-1 text-content-muted">
                  Requested {new Date(receipt.approval.requestedAt).toLocaleString()}
                </div>
              )}
              {receipt.approval.reviewedBy && (
                <div className="mt-1 text-content-muted">
                  Reviewed by {receipt.approval.reviewedBy}
                  {receipt.approval.reviewedAt ? ` on ${new Date(receipt.approval.reviewedAt).toLocaleString()}` : ""}
                </div>
              )}
              {receipt.approval.reviewNotes && <div className="mt-2 text-content-secondary">{receipt.approval.reviewNotes}</div>}
            </div>
          )}

          <div className="rounded-lg border border-edge/60 bg-black/10 p-3 text-xs">
            <div className="font-medium text-content-muted">Rollback</div>
            {!receipt.reversible.canUndo ? (
              <div className="mt-1 text-content-muted">
                <span className="font-medium text-content-secondary">No rollback available.</span> This receipt is a
                read-only observation or a blocked attempt, so there is no state change to reverse.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="mt-1 text-content-secondary">
                  {rolledBackAt
                    ? `${rollbackState?.modeLabel ?? "Rollback"} completed ${new Date(rolledBackAt).toLocaleString()}.`
                    : receipt.reversible.undoInstructions ?? "Rollback instructions are available for this action."}
                </div>
                {rollbackState?.rollbackRef && (
                  <div className="font-mono text-[11px] text-content-muted">rollback_ref: {rollbackState.rollbackRef}</div>
                )}
                {!rolledBackAt && (
                  <button
                    type="button"
                    disabled={!canExecuteUndo || rollbackState?.isUndoing}
                    className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-surface-hover px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={(event) => {
                      event.stopPropagation();
                      onUndo?.(receipt);
                    }}
                  >
                    <Undo2 className="h-3 w-3" />
                    {rollbackState?.isUndoing ? "Undoing…" : "Undo action"}
                  </button>
                )}
                {!canExecuteUndo && !rolledBackAt && !rollbackState?.isUndoing && (
                  <div className="text-content-muted">
                    Rollback is available for this receipt, but no live rollback handler is connected yet.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-edge/30 pt-2 font-mono text-[10px] text-content-muted">
            Receipt: {receipt.receiptId}
          </div>
        </div>
      )}
    </div>
  );
});
