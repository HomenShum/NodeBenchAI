/**
 * TraceAuditPanel - TRACE (Tool-Routed Architecture for Controlled Execution) UI
 *
 * Renders recorded execution steps with provenance supplied by the runtime.
 */

import React, { useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import {
  Shield,
  Brain,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Search,
  Wrench,
  FileOutput,
  Flag,
  RefreshCw,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface TraceAuditPanelProps {
  executionId: string;
  className?: string;
}

interface AuditEntry {
  _id: string;
  seq: number;
  timestamp: number;
  choiceType: "gather_info" | "execute_data_op" | "execute_output" | "finalize";
  toolName: string;
  provenance?: "deterministic_code" | "ai_model";
  toolParams?: any;
  metadata: {
    rowCount?: number;
    columnCount?: number;
    uniqueValues?: any;
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
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function getChoiceIcon(choiceType: AuditEntry["choiceType"]) {
  switch (choiceType) {
    case "gather_info":
      return <Search className="w-3.5 h-3.5 text-violet-500 dark:text-violet-400" />;
    case "execute_data_op":
      return <Wrench className="w-3.5 h-3.5 text-content-secondary" />;
    case "execute_output":
      return <FileOutput className="w-3.5 h-3.5 text-content-secondary" />;
    case "finalize":
      return <Flag className="w-3.5 h-3.5 text-content-secondary" />;
  }
}

function getChoiceLabel(choiceType: AuditEntry["choiceType"]): string {
  switch (choiceType) {
    case "gather_info":
      return "Gather";
    case "execute_data_op":
      return "Processing";
    case "execute_output":
      return "Output";
    case "finalize":
      return "Finalize";
  }
}

function getChoiceBadgeColor(choiceType: AuditEntry["choiceType"]): string {
  switch (choiceType) {
    case "gather_info":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    case "execute_data_op":
      return "bg-surface-hover text-content-secondary dark:bg-surface-secondary dark:text-content-muted";
    case "execute_output":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400";
    case "finalize":
      return "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function TraceAuditPanel({ executionId, className }: TraceAuditPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showDetails, setShowDetails] = useState<Set<number>>(new Set());
  const { isAuthenticated, isLoading } = useConvexAuth();
  const auditArgs = !isLoading && isAuthenticated ? { executionId } : ("skip" as const);

  // Fetch audit log and summary from Convex
  const auditEntries = useQuery(api.domains.agents.traceAuditLog.getAuditLog, auditArgs);
  const auditSummary = useQuery(api.domains.agents.traceAuditLog.getAuditSummary, auditArgs);

  if (!auditEntries || auditEntries.length === 0) {
    return null;
  }

  const toggleDetail = (seq: number) => {
    setShowDetails((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) {
        next.delete(seq);
      } else {
        next.add(seq);
      }
      return next;
    });
  };

  const selfCorrections = auditEntries.filter(
    (e: any) => e.metadata.correctionApplied
  );

  return (
    <div className={cn("space-y-2", className)}>
      {/* ── Section 1: Audit Log ── */}
      <div className="border border-edge rounded-lg bg-surface-secondary">
        {/* Header */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-secondary transition-colors rounded-t-lg"
          aria-label={isExpanded ? "Collapse execution trace" : "Expand execution trace"}
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-content-muted" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-content-muted" />
            )}
            <Shield className="w-3.5 h-3.5 text-green-500" />
            <span className="text-xs font-medium text-content">
              Execution Trace
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface text-content-muted font-medium border border-edge">
              AUDIT LOG
            </span>
          </div>

          {/* Quick Stats */}
          <div className="flex items-center gap-2.5 text-xs text-content-muted">
            {auditSummary && (
              <>
                <span>{auditSummary.totalSteps} steps</span>
                <span className="text-content-muted">·</span>
                <span>{formatDuration(auditSummary.totalDurationMs)}</span>
                {auditSummary.selfCorrections > 0 && (
                  <>
                    <span className="text-content-muted">·</span>
                    <span className="flex items-center gap-0.5">
                      <RefreshCw className="w-3 h-3" />
                      {auditSummary.selfCorrections}
                    </span>
                  </>
                )}
                {auditSummary.failures > 0 && (
                  <span className="flex items-center gap-0.5 text-red-500 dark:text-red-400">
                    <XCircle className="w-3 h-3" />
                    {auditSummary.failures}
                  </span>
                )}
                {auditSummary.hasFinalized && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                )}
              </>
            )}
          </div>
        </button>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="border-t border-edge">
            {/* Provenance Banner */}
            <div className="px-3 py-1.5 bg-surface text-xs text-content-muted flex items-center gap-2 border-b border-edge">
              <Info className="w-3 h-3 flex-shrink-0" />
              <span>
                Recorded execution steps. Each row labels code and AI-model work from stored runtime provenance.
              </span>
            </div>

            {/* Entry List */}
            <div className="max-h-80 overflow-y-auto divide-y divide-[var(--border-color)]">
              {auditEntries.map((entry: any) => (
                <div key={entry._id}>
                  {/* Entry Row */}
                  <button
                    type="button"
                    onClick={() => toggleDetail(entry.seq)}
                    className="w-full flex items-start gap-2 px-3 py-2 text-xs text-left hover:bg-surface-secondary transition-colors"
                    aria-label={`Step ${entry.seq + 1}: ${entry.toolName}`}
                  >
                    {/* Sequence Number */}
                    <span className="text-content-muted font-mono w-4 flex-shrink-0 text-right tabular-nums">
                      {entry.seq + 1}.
                    </span>

                    {/* Choice Icon */}
                    <span className="flex-shrink-0 mt-0.5">
                      {getChoiceIcon(entry.choiceType)}
                    </span>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-xs font-medium leading-none",
                            getChoiceBadgeColor(entry.choiceType)
                          )}
                        >
                          {getChoiceLabel(entry.choiceType)}
                        </span>
                        <span className="text-content font-medium truncate text-xs">
                          {entry.toolName}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
                            entry.provenance === "ai_model"
                              ? "bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400"
                              : entry.provenance === "deterministic_code"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                                : "bg-surface text-content-muted border border-edge",
                          )}
                        >
                          {entry.provenance === "ai_model" ? <Brain className="h-2.5 w-2.5" /> : null}
                          {entry.provenance === "ai_model"
                            ? "AI model"
                            : entry.provenance === "deterministic_code"
                              ? "Code"
                              : "Recorded"}
                        </span>
                        {entry.metadata.correctionApplied && (
                          <span className="inline-flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400">
                            <RefreshCw className="w-2.5 h-2.5" />
                            corrected
                          </span>
                        )}
                        {!entry.metadata.success && (
                          <XCircle className="w-3 h-3 text-red-500 dark:text-red-400" />
                        )}
                      </div>
                      <div className="text-content-muted mt-0.5 line-clamp-2 text-xs leading-relaxed">
                        {entry.description}
                      </div>
                    </div>

                    {/* Duration */}
                    <span className="text-content-muted font-mono text-xs flex-shrink-0 tabular-nums">
                      {formatDuration(entry.metadata.durationMs)}
                    </span>

                    {/* Expand indicator */}
                    {showDetails.has(entry.seq) ? (
                      <ChevronDown className="w-3 h-3 text-content-muted flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-content-muted flex-shrink-0" />
                    )}
                  </button>

                  {/* Expanded Details */}
                  {showDetails.has(entry.seq) && (
                    <div className="px-3 py-2 bg-surface border-t border-edge text-xs space-y-2">
                      <div className="flex items-center gap-3 text-content-muted text-xs">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTime(entry.timestamp)}
                        </span>
                        {entry.metadata.rowCount !== undefined && (
                          <span>Rows: {entry.metadata.rowCount}</span>
                        )}
                        {entry.metadata.charCount !== undefined && (
                          <span>Chars: {entry.metadata.charCount.toLocaleString()}</span>
                        )}
                        {entry.metadata.wordCount !== undefined && (
                          <span>Words: {entry.metadata.wordCount.toLocaleString()}</span>
                        )}
                      </div>

                      {/* Key Topics */}
                      {entry.metadata.keyTopics &&
                        entry.metadata.keyTopics.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="text-content-muted text-xs">
                              Topics:
                            </span>
                            {entry.metadata.keyTopics.map((topic: string, i: number) => (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 rounded-full bg-surface-secondary text-content-secondary text-xs border border-edge"
                              >
                                {topic}
                              </span>
                            ))}
                          </div>
                        )}

                      {/* Self-Correction Details */}
                      {entry.metadata.correctionApplied && (
                        <div className="p-2 bg-surface-secondary rounded-md border border-edge">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-content mb-1">
                            <RefreshCw className="w-3 h-3 text-amber-500 dark:text-amber-400" />
                            Self-Correction Applied
                          </div>
                          {entry.metadata.intendedState && (
                            <div className="text-xs text-content-muted">
                              <span className="font-medium text-content-secondary">Expected:</span>{" "}
                              {entry.metadata.intendedState}
                            </div>
                          )}
                          {entry.metadata.actualState && (
                            <div className="text-xs text-content-muted">
                              <span className="font-medium text-content-secondary">Actual:</span>{" "}
                              {entry.metadata.actualState}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Completion Traceability */}
                      {entry.choiceType === "finalize" && entry.metadata.originalRequest && (
                        <div className="p-2 bg-indigo-50 dark:bg-indigo-900/10 rounded-md border border-indigo-200 dark:border-indigo-900/20">
                          <div className="text-xs font-medium text-indigo-700 dark:text-indigo-400 mb-1">
                            Original Request
                          </div>
                          <div className="text-xs text-content-secondary line-clamp-3">
                            {entry.metadata.originalRequest}
                          </div>
                          {entry.metadata.deliverySummary && (
                            <div className="text-xs text-content-muted mt-1 pt-1 border-t border-indigo-100 dark:border-indigo-900/20">
                              Delivered: {entry.metadata.deliverySummary}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Error */}
                      {entry.metadata.errorMessage && (
                        <div className="p-2 bg-red-50 dark:bg-red-900/10 rounded-md border border-red-200 dark:border-red-900/20 text-red-700 dark:text-red-400 text-xs">
                          {entry.metadata.errorMessage}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Summary Footer */}
            {auditSummary && (
              <div className="border-t border-edge px-3 py-2 flex items-center justify-between text-xs text-content-muted">
                <div className="flex items-center gap-3">
                  <span>
                    <span className="font-medium text-content-secondary">
                      {auditSummary.gatherInfoSteps}
                    </span>{" "}
                    gather
                  </span>
                  <span>
                    <span className="font-medium text-content-secondary">
                      {auditSummary.dataOpSteps}
                    </span>{" "}
                    processing steps
                  </span>
                  <span>
                    <span className="font-medium text-content-secondary">
                      {auditSummary.outputSteps}
                    </span>{" "}
                    outputs
                  </span>
                </div>
                <span className="truncate ml-3">
                  {auditSummary.toolsUsed.slice(0, 3).join(", ")}
                  {auditSummary.toolsUsed.length > 3 && ` +${auditSummary.toolsUsed.length - 3}`}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Self-Corrections Summary (if any) ── */}
      {selfCorrections.length > 0 && (
        <div className="border border-edge rounded-lg bg-surface-secondary p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <RefreshCw className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
            <span className="text-xs font-medium text-content">
              Self-Corrections ({selfCorrections.length})
            </span>
          </div>
          <div className="space-y-1">
            {selfCorrections.map((entry: any) => (
              <div
                key={entry._id}
                className="text-xs text-content-muted flex items-start gap-2"
              >
                <AlertTriangle className="w-3 h-3 text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <span>{entry.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
