/**
 * DeepAgentProgress - Visual progress indicator for Deep Agent document edits
 * 
 * Features:
 * - Shows per-thread edit statistics (pending, applied, failed)
 * - Displays the current edit being processed
 * - Allows per-thread cancellation
 * - Shows visual indicators for pending edits with operation type badges
 * - Color-coded by thread for multi-agent scenarios
 */

import React, { useMemo } from "react";
import type { PendingEdit, ThreadEditStats } from "../../hooks/usePendingEdits";
import type { Id } from "../../../../../convex/_generated/dataModel";

// Thread colors for multi-agent scenarios (up to 6 distinct colors)
// Tailwind class equivalents: bg-blue-500/10, bg-emerald-500/10, etc.
// Using Tailwind classNames instead of inline rgba for bg; border/text stay as tokens for inline style consumption.
const THREAD_COLORS = [
  { bgClass: "bg-blue-500/10", border: "#3b82f6", text: "#3b82f6" },    // Blue
  { bgClass: "bg-emerald-500/10", border: "#10b981", text: "#10b981" }, // Green
  { bgClass: "bg-purple-500/10", border: "#a855f7", text: "#a855f7" }, // Purple
  { bgClass: "bg-orange-500/10", border: "#f97316", text: "#f97316" }, // Orange
  { bgClass: "bg-pink-500/10", border: "#ec4899", text: "#ec4899" },   // Pink
  { bgClass: "bg-teal-500/10", border: "#14b8a6", text: "#14b8a6" },   // Teal
];

function getThreadColor(threadId: string, allThreadIds: string[]) {
  const index = allThreadIds.indexOf(threadId);
  return THREAD_COLORS[index % THREAD_COLORS.length];
}

/** Get operation type label */
function getOperationType(edit: PendingEdit): "INSERT" | "DELETE" | "REPLACE" {
  if (!edit.operation.search) return "INSERT";
  if (!edit.operation.replace) return "DELETE";
  return "REPLACE";
}

/** Get operation badge color */
function getOperationColor(type: "INSERT" | "DELETE" | "REPLACE") {
  switch (type) {
    case "INSERT":
      return { bg: "#10b981", text: "white" };
    case "DELETE":
      return { bg: "#ef4444", text: "white" };
    case "REPLACE":
      return { bg: "#3b82f6", text: "white" };
  }
}

interface DeepAgentProgressProps {
  /** All pending edits for the document */
  pendingEdits: PendingEdit[];
  /** Whether currently processing an edit */
  isProcessing: boolean;
  /** The current edit being processed */
  currentEdit: PendingEdit | null;
  /** Statistics grouped by thread */
  editsByThread: Map<string, ThreadEditStats>;
  /** Callback to retry a failed edit */
  onRetryEdit: (editId: Id<"pendingDocumentEdits">) => Promise<void>;
  /** Callback to cancel edits for a specific thread */
  onCancelThread: (threadId: string) => Promise<void>;
  /** Callback to cancel all edits */
  onCancelAll: () => Promise<void>;
  /** Whether the panel is minimized */
  minimized?: boolean;
  /** Callback to toggle minimized state */
  onToggleMinimized?: () => void;
}

export function DeepAgentProgress({
  pendingEdits,
  isProcessing,
  currentEdit,
  editsByThread,
  onRetryEdit,
  onCancelThread,
  onCancelAll,
  minimized = false,
  onToggleMinimized,
}: DeepAgentProgressProps) {
  // Get all thread IDs for color assignment
  const allThreadIds = useMemo(
    () => Array.from(editsByThread.keys()),
    [editsByThread]
  );

  // Count totals
  const totals = useMemo(() => {
    let pending = 0, applied = 0, failed = 0, stale = 0;
    editsByThread.forEach((stats) => {
      pending += stats.pending;
      applied += stats.applied;
      failed += stats.failed;
      stale += stats.stale;
    });
    return { pending, applied, failed, stale, total: pending + applied + failed + stale };
  }, [editsByThread]);

  // Don't show if no edits
  if (totals.total === 0) return null;

  // Minimized view
  if (minimized) {
    return (
      <div
        onClick={onToggleMinimized}
        className="bg-violet-500/10 border border-violet-500/30 rounded-lg cursor-pointer"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          fontSize: "13px",
        }}
      >
        <span style={{ fontSize: "16px" }}>✏️</span>
        <span style={{ color: "#8b5cf6", fontWeight: 500 }}>
          {isProcessing ? "Editing..." : `${totals.pending} pending`}
        </span>
        {totals.failed > 0 && (
          <span style={{ color: "#ef4444", fontWeight: 500 }}>
            {totals.failed} failed
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: "var(--background-secondary, #1e1e2e)",
        border: "1px solid var(--border-color, #333)",
        borderRadius: "12px",
        padding: "12px",
        maxWidth: "360px",
        boxShadow: "0 4px 12px hsl(0 0% 0% / 0.15)",
        fontSize: "13px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>✏️</span>
          <span style={{ fontWeight: 600, color: "var(--text-primary, #fff)" }}>
            Deep Agent Edits
          </span>
          {isProcessing && (
            <span
              style={{
                animation: "pulse 1.5s infinite",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#8b5cf6",
              }}
            />
          )}
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          {onToggleMinimized && (
            <button
              onClick={onToggleMinimized}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                color: "var(--text-secondary, #888)",
              }}
              title="Minimize"
            >
              ─
            </button>
          )}
          <button
            onClick={onCancelAll}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              color: "#ef4444",
            }}
            title="Cancel All"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Overall Progress */}
      <div
        className="bg-white/5 rounded-lg"
        style={{
          display: "flex",
          gap: "12px",
          marginBottom: "12px",
          padding: "8px",
        }}
      >
        <StatBadge label="Pending" count={totals.pending} color="#f59e0b" />
        <StatBadge label="Applied" count={totals.applied} color="#10b981" />
        <StatBadge label="Failed" count={totals.failed} color="#ef4444" />
        {totals.stale > 0 && (
          <StatBadge label="Stale" count={totals.stale} color="#6b7280" />
        )}
      </div>

      {/* Current Edit */}
      {currentEdit && (
        <CurrentEditCard edit={currentEdit} threadColor={getThreadColor(currentEdit.agentThreadId, allThreadIds)} />
      )}

      {/* Per-Thread Progress */}
      {allThreadIds.length > 1 && (
        <div style={{ marginTop: "12px" }}>
          <div
            style={{
              fontSize: "11px",
              color: "var(--text-secondary, #888)",
              marginBottom: "8px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            By Agent Thread
          </div>
          {allThreadIds.map((threadId) => {
            const stats = editsByThread.get(threadId)!;
            const color = getThreadColor(threadId, allThreadIds);
            return (
              <ThreadProgressRow
                key={threadId}
                stats={stats}
                color={color}
                onCancel={() => onCancelThread(threadId)}
              />
            );
          })}
        </div>
      )}

      {/* Failed Edits */}
      {totals.failed > 0 && (
        <FailedEditsSection
          edits={pendingEdits.filter((e) => e.status === "failed")}
          allThreadIds={allThreadIds}
          onRetry={onRetryEdit}
        />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}

function StatBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color, fontWeight: 600, fontSize: "16px" }}>{count}</div>
      <div style={{ color: "var(--text-secondary, #888)", fontSize: "10px" }}>{label}</div>
    </div>
  );
}

function CurrentEditCard({ edit, threadColor }: { edit: PendingEdit; threadColor: { bgClass: string; border: string; text: string } }) {
  const opType = getOperationType(edit);
  const opColor = getOperationColor(opType);

  return (
    <div
      className={threadColor.bgClass}
      style={{
        padding: "10px",
        border: `1px solid ${threadColor.border}`,
        borderRadius: "8px",
        marginBottom: "8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <span
          style={{
            animation: "pulse 1s infinite",
            fontSize: "12px",
          }}
        >
          ⚡
        </span>
        <span style={{ fontWeight: 500, color: "var(--text-primary, #fff)" }}>
          Applying Edit
        </span>
        <span
          style={{
            fontSize: "10px",
            padding: "2px 6px",
            borderRadius: "4px",
            backgroundColor: opColor.bg,
            color: opColor.text,
            fontWeight: 600,
          }}
        >
          {opType}
        </span>
      </div>
      <div
        style={{
          fontSize: "12px",
          color: "var(--text-secondary, #888)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: threadColor.text }}>Anchor:</span>{" "}
        {edit.operation.anchor.substring(0, 40)}
        {edit.operation.anchor.length > 40 ? "..." : ""}
      </div>
      {edit.operation.sectionHint && (
        <div
          style={{
            fontSize: "11px",
            color: "var(--text-tertiary, #666)",
            marginTop: "4px",
          }}
        >
          📍 {edit.operation.sectionHint}
        </div>
      )}
    </div>
  );
}

function ThreadProgressRow({
  stats,
  color,
  onCancel,
}: {
  stats: ThreadEditStats;
  color: { bgClass: string; border: string; text: string };
  onCancel: () => void;
}) {
  return (
    <div
      className={color.bgClass}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 8px",
        marginBottom: "4px",
        borderRadius: "6px",
        borderLeft: `3px solid ${color.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: color.border,
          }}
        />
        <span
          style={{
            fontSize: "11px",
            color: "var(--text-secondary, #888)",
            maxWidth: "120px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {stats.threadId.substring(0, 12)}...
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "11px", color: "#f59e0b" }}>{stats.pending}⏳</span>
        <span style={{ fontSize: "11px", color: "#10b981" }}>{stats.applied}✓</span>
        {stats.failed > 0 && (
          <span style={{ fontSize: "11px", color: "#ef4444" }}>{stats.failed}✕</span>
        )}
        {stats.pending > 0 && (
          <button
            onClick={onCancel}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#ef4444",
              fontSize: "11px",
              padding: "2px 4px",
            }}
            title="Cancel thread edits"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function FailedEditsSection({
  edits,
  allThreadIds,
  onRetry,
}: {
  edits: PendingEdit[];
  allThreadIds: string[];
  onRetry: (editId: Id<"pendingDocumentEdits">) => Promise<void>;
}) {
  return (
    <div style={{ marginTop: "12px" }}>
      <div
        style={{
          fontSize: "11px",
          color: "#ef4444",
          marginBottom: "8px",
          fontWeight: 500,
        }}
      >
        ⚠️ Failed Edits
      </div>
      {edits.slice(0, 3).map((edit) => {
        const color = getThreadColor(edit.agentThreadId, allThreadIds);
        return (
          <div
            key={edit._id}
            className="bg-red-500/10"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 8px",
              marginBottom: "4px",
              borderRadius: "6px",
              borderLeft: `3px solid ${color.border}`,
            }}
          >
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--text-primary, #fff)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {edit.operation.anchor.substring(0, 30)}...
              </div>
              {edit.errorMessage && (
                <div
                  style={{
                    fontSize: "10px",
                    color: "#ef4444",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {edit.errorMessage.substring(0, 50)}
                </div>
              )}
            </div>
            <button
              onClick={() => onRetry(edit._id)}
              className="bg-blue-500/20 border border-blue-500 text-blue-500"
              style={{
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "10px",
                padding: "4px 8px",
                marginLeft: "8px",
              }}
            >
              Retry
            </button>
          </div>
        );
      })}
      {edits.length > 3 && (
        <div style={{ fontSize: "11px", color: "var(--text-secondary, #888)", textAlign: "center" }}>
          +{edits.length - 3} more failed edits
        </div>
      )}
    </div>
  );
}

export default DeepAgentProgress;

