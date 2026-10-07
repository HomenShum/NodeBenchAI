import type { ActionReceipt } from "../types/actionReceipt";

export function toActionReceipt(row: Record<string, unknown>): ActionReceipt {
  return {
    receiptId: row.receiptId as string,
    agentId: row.agentId as string,
    timestamp: new Date(row.createdAt as number).toISOString(),
    sessionKey: row.sessionKey as string | undefined,
    channelId: row.channelId as string | undefined,
    direction: row.direction as ActionReceipt["direction"],
    action: {
      toolName: row.toolName as string,
      params: (row.params ?? {}) as Record<string, unknown>,
      summary: row.actionSummary as string,
    },
    policyRef: {
      policyId: row.policyId as string,
      ruleName: row.policyRuleName as string,
      action: row.policyAction as ActionReceipt["policyRef"]["action"],
    },
    evidenceRefs: (row.evidenceRefs ?? []) as string[],
    result: {
      success: row.resultSuccess as boolean,
      outputHash: row.resultOutputHash as string | undefined,
      summary: row.resultSummary as string,
    },
    reversible: {
      canUndo: row.canUndo as boolean,
      undoInstructions: row.undoInstructions as string | undefined,
    },
    approval: {
      state:
        (row.approvalState as NonNullable<ActionReceipt["approval"]>["state"] | undefined) ??
        "not_required",
      requestedAt:
        typeof row.approvalRequestedAt === "number"
          ? new Date(row.approvalRequestedAt as number).toISOString()
          : undefined,
      reviewedAt:
        typeof row.approvalReviewedAt === "number"
          ? new Date(row.approvalReviewedAt as number).toISOString()
          : undefined,
      reviewedBy: row.approvalReviewedBy as string | undefined,
      reviewNotes: row.approvalReviewNotes as string | undefined,
    },
    openclaw: {
      sessionId: row.openclawSessionId as string | undefined,
      executionId: row.openclawExecutionId as string | undefined,
      deployment: row.deployment as string | undefined,
    },
    violations: (row.violations ?? []) as ActionReceipt["violations"],
  };
}

export function formatApprovalQueueTime(timestampIso?: string) {
  if (!timestampIso) return "Queued now";
  const diff = Date.now() - new Date(timestampIso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Queued now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
