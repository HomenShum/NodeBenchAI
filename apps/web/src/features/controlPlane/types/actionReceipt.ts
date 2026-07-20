/**
 * ActionReceipt - tamper-evident record of what an agent saw, decided, and did.
 *
 * Every hash proves the artifact has not changed since capture.
 * It does not prove the artifact's claims are true.
 */

export type ProvenanceTier = "verified_public" | "heuristic_inferred" | "unavailable_simulated";
export type CaptureMethod = "direct_fetch" | "uploaded_file" | "manual_fixture" | "derived_from_source";

export type PolicyAction = "allowed" | "denied" | "escalated";
export type ApprovalState = "not_required" | "pending" | "approved" | "denied";
export type ReceiptDirection = "inbound" | "decision" | "draft" | "approval" | "outbound" | "error";
export type ViolationSeverity = "warning" | "block" | "audit_only";

export interface ActionReceipt {
  receiptId: string;
  agentId: string;
  timestamp: string;
  sessionKey?: string;
  channelId?: string;
  direction?: ReceiptDirection;
  action: {
    toolName: string;
    params: Record<string, unknown>;
    summary: string;
  };
  policyRef: {
    policyId: string;
    ruleName: string;
    action: PolicyAction;
  };
  evidenceRefs: string[];
  result: {
    success: boolean;
    outputHash?: string;
    summary: string;
  };
  reversible: {
    canUndo: boolean;
    undoInstructions?: string;
  };
  approval?: {
    state: ApprovalState;
    requestedAt?: string;
    reviewedAt?: string;
    reviewedBy?: string;
    reviewNotes?: string;
  };
  openclaw?: {
    sessionId?: string;
    executionId?: string;
    deployment?: string;
  };
  violations: ActionViolation[];
}

export interface ActionViolation {
  ruleId: string;
  ruleName: string;
  severity: ViolationSeverity;
  description: string;
  resolution?: string;
}

export interface ReceiptFeedItem {
  receipt: ActionReceipt;
  expanded: boolean;
  sessionGroup?: string;
}
