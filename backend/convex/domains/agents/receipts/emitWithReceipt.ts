/**
 * emitWithReceipt.ts — Helper that wraps appendAuditEntry + emitReceipt.
 *
 * Trusted helper for emitting the internal TRACE audit entry and receipt.
 * Emits both a TRACE audit entry AND a required action receipt.
 *
 * The receipt provides the tamper-evident, content-addressed counterpart
 * to the operational audit log. Together they form the trust layer.
 *
 * Usage in orchestrators:
 *   import { emitWithReceipt } from "./receipts/emitWithReceipt";
 *   await emitWithReceipt(ctx, auditArgs, { agentId: "scout-01" });
 */

import type { ActionCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

/** Minimal receipt context — only what the orchestrator knows beyond the audit entry. */
interface ReceiptContext {
  /** Agent identifier (e.g. "research-scout-01") */
  agentId: string;
  /** Owner whose receipt feed must expose this TRACE action. */
  userId: Id<"users">;
  /** Convex agentRuns ID if available */
  agentRunId?: string;
  /** Policy that authorized this action. Defaults to "pol_trace_default". */
  policyId?: string;
  /** Human-readable policy rule name. */
  policyRuleName?: string;
  /** "allowed" | "denied" | "escalated" — defaults to "allowed" */
  policyAction?: string;
  /** Evidence artifact IDs this action references */
  evidenceRefs?: string[];
  /** Whether this action can be undone */
  canUndo?: boolean;
  /** How to reverse this action */
  undoInstructions?: string;
}

/**
 * Emit both a TRACE audit entry and an action receipt.
 *
 * The audit entry goes to traceAuditEntries (operational log).
 * The receipt goes to actionReceipts (tamper-evident trust log).
 *
 * A trust-labeled TRACE step is not complete unless both writes succeed.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export async function hashTraceResultOutput(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function emitWithReceipt(
  ctx: ActionCtx,
  auditArgs: {
    executionId: string;
    executionType: "swarm" | "tree" | "chat" | "forecast_refresh" | "linkedin_post";
    seq: number;
    choiceType: "gather_info" | "execute_data_op" | "execute_output" | "finalize";
    toolName: string;
    provenance: "deterministic_code" | "ai_model";
    toolParams?: Record<string, unknown>;
    metadata: {
      rowCount?: number;
      columnCount?: number;
      uniqueValues?: unknown;
      charCount?: number;
      wordCount?: number;
      keyTopics?: string[];
      errorMessage?: string;
      durationMs: number;
      success: boolean;
      intendedState?: string;
      actualState?: string;
      correctionApplied?: boolean;
      originalRequest?: string;
      deliverySummary?: string;
    };
    description: string;
    /** Exact output/evidence payload attested by resultOutputHash. */
    resultOutput: unknown;
  },
  receiptCtx: ReceiptContext,
): Promise<void> {
  // Start both writes together, but reject if either one fails.
  const { resultOutput, ...traceAuditArgs } = auditArgs;
  const resultOutputHash = await hashTraceResultOutput(resultOutput);

  const auditPromise = ctx.runMutation(
    internal.domains.agents.traceAuditLog.appendAuditEntry,
    { ...traceAuditArgs, userId: receiptCtx.userId },
  );

  const receiptPromise = ctx.runAction(
    internal.domains.agents.receipts.actionReceipts.emitReceipt,
    {
      agentId: receiptCtx.agentId,
      agentRunId: receiptCtx.agentRunId as never,
      userId: receiptCtx.userId,
      toolName: auditArgs.toolName,
      params: auditArgs.toolParams,
      actionSummary: auditArgs.description,
      policyId: receiptCtx.policyId ?? "pol_trace_default",
      policyRuleName: receiptCtx.policyRuleName ?? "TRACE orchestrator default",
      policyAction: receiptCtx.policyAction ?? "allowed",
      evidenceRefs: receiptCtx.evidenceRefs ?? [],
      resultSuccess: auditArgs.metadata.success,
      resultSummary: auditArgs.metadata.success
        ? `${auditArgs.toolName} completed in ${auditArgs.metadata.durationMs}ms`
        : `${auditArgs.toolName} failed: ${auditArgs.metadata.errorMessage ?? "unknown error"}`,
      resultOutputHash,
      canUndo: receiptCtx.canUndo ?? false,
      undoInstructions: receiptCtx.undoInstructions,
      violations: auditArgs.metadata.success
        ? []
        : [
            {
              ruleId: "rule_execution_failure",
              ruleName: "Tool Execution Failure",
              severity: "warning",
              description: auditArgs.metadata.errorMessage ?? "Tool execution did not succeed",
            },
          ],
    },
  );

  // A trust-labeled step is not complete unless both records persist.
  await Promise.all([auditPromise, receiptPromise]);
}
