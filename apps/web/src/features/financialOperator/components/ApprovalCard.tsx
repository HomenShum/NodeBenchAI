import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ApprovalRequestPayload, StepStatus } from "../types";

interface Props {
  runId: Id<"financialOperatorRuns">;
  stepId: Id<"financialOperatorSteps">;
  status: StepStatus;
  data: ApprovalRequestPayload;
  selectedOptionId?: ApprovalRequestPayload["options"][number]["id"];
}

const PRIMARY_VARIANTS: Array<ApprovalRequestPayload["options"][number]["id"]> = [
  "approve",
];

export function ApprovalCard({ runId, stepId, status, data, selectedOptionId }: Props) {
  const recordDecision = useAction(
    api.domains.financialOperator.orchestrator.recordApprovalDecision,
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isLocked = status === "approved" || status === "rejected" || status === "complete";

  async function handleClick(
    optionId: ApprovalRequestPayload["options"][number]["id"],
  ) {
    if (isLocked) return;
    setPendingId(optionId);
    setError(null);
    try {
      await recordDecision({ runId, stepId, optionId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record decision");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-content">{data.question}</p>
      {data.context && (
        <p className="text-[13px] text-content-secondary">{data.context}</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {data.options.map((opt) => {
          const isPrimary = PRIMARY_VARIANTS.includes(opt.id);
          const isSelected = selectedOptionId === opt.id;
          const isPending = pendingId === opt.id;
          const consequence = data.consequences?.[opt.id];
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleClick(opt.id)}
              disabled={isLocked || pendingId !== null}
              aria-pressed={isSelected}
              className={`group rounded border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                isPrimary
                  ? "border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10 hover:bg-[var(--accent-primary)]/15 text-[#f5d0b8]"
                  : "border-edge bg-surface/50 hover:bg-surface-hover text-content"
              } ${isSelected ? "ring-2 ring-[var(--accent-primary)]/40" : ""}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{opt.label}</span>
                {isPending && (
                  <span className="text-[10px] uppercase tracking-[0.18em] text-content-muted">
                    submitting…
                  </span>
                )}
                {isSelected && !isPending && (
                  <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent-primary)]">
                    chosen
                  </span>
                )}
              </div>
              {opt.description && (
                <div className="mt-1 text-[12px] text-content-secondary">
                  {opt.description}
                </div>
              )}
              {consequence && (
                <div className="mt-1 text-[11px] text-content-muted">
                  → {consequence}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[13px] text-red-200">
          {error}
        </p>
      )}
      {isLocked && (
        <p className="text-[12px] text-content-muted">
          Decision recorded — this step is locked.
        </p>
      )}
    </div>
  );
}
