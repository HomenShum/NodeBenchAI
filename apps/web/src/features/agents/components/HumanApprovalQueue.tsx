/**
 * HumanApprovalQueue.tsx
 *
 * Displays pending human-in-the-loop approval requests.
 * Allows users to approve/reject agent requests with context preview.
 */

import React, { memo, useState, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import {
  AlertCircle,
  CheckCircle,
  XCircle,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Bot,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

// ============================================================================
// Types
// ============================================================================

interface HumanRequest {
  _id: Id<"humanRequests">;
  userId: Id<"users">;
  threadId: string;
  messageId: string;
  toolCallId: string;
  question: string;
  context?: string;
  options?: string[];
  status: "pending" | "answered" | "cancelled";
  response?: string;
  respondedAt?: number;
  _creationTime: number;
}

interface HumanApprovalQueueProps {
  className?: string;
  compact?: boolean;
  maxItems?: number;
}

// ============================================================================
// Request Card Component
// ============================================================================

const RequestCard = memo(function RequestCard({
  request,
  onRespond,
  onCancel,
  isProcessing,
  errorMessage,
}: {
  request: HumanRequest;
  onRespond: (requestId: Id<"humanRequests">, response: string) => Promise<boolean>;
  onCancel: (requestId: Id<"humanRequests">) => Promise<boolean>;
  isProcessing: boolean;
  errorMessage?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [customResponse, setCustomResponse] = useState("");

  const timeAgo = formatTimeAgo(request._creationTime);

  const handleOptionClick = useCallback(async (option: string) => {
    await onRespond(request._id, option);
  }, [request._id, onRespond]);

  const handleCustomSubmit = useCallback(async () => {
    const response = customResponse.trim();
    if (response) {
      const accepted = await onRespond(request._id, response);
      if (accepted) {
        // Keep the user's text recoverable until the backend confirms success.
        // The pending subscription will normally remove the card immediately.
        // Clearing here also covers delayed subscription updates.
        setCustomResponse("");
      }
    }
  }, [request._id, customResponse, onRespond]);

  return (
    <div
      className={cn(
        "bg-surface rounded-lg border border-edge",
        "transition-all duration-200 hover:shadow"
      )}
    >
      {/* Header */}
      <div className="p-3 border-b border-edge">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <div className="w-7 h-7 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-content line-clamp-2">
                {request.question}
              </p>
              <div className="flex items-center gap-2 mt-1 text-xs text-content-muted">
                <Clock className="w-3 h-3" />
                <span>{timeAgo}</span>
              </div>
            </div>
          </div>

          {request.context && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 rounded hover:bg-surface-hover transition-colors"
              aria-label={isExpanded ? "Hide context" : "Show context"}
            >
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-content-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-content-muted" />
              )}
            </button>
          )}
        </div>

        {/* Expanded Context */}
        {isExpanded && request.context && (
          <div className="mt-3 p-2 bg-surface-secondary rounded-lg text-xs text-content-secondary">
            <div className="flex items-center gap-1.5 mb-1 text-xs text-content-muted font-medium">
              <Bot className="w-3 h-3" />
              Context
            </div>
            <p className="whitespace-pre-wrap">{request.context}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-3">
        {isProcessing ? (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-content-muted">
            <Loader2 className="w-4 h-4 motion-safe:animate-spin" />
            <span>Processing...</span>
          </div>
        ) : request.options && request.options.length > 0 ? (
          <div className="space-y-2">
            {/* Suggested Options */}
            <div className="flex flex-wrap gap-2">
              {request.options.map((option, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => void handleOptionClick(option)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium",
                    "border border-edge",
                    "hover:bg-indigo-500/10 hover:border-indigo-500/30",
                    "transition-colors"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>

            {/* Custom Response */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customResponse}
                onChange={(e) => setCustomResponse(e.target.value)}
                placeholder="Or type a custom response..."
                aria-label="Custom response"
                className={cn(
                  "flex-1 px-2.5 py-1.5 rounded-lg text-xs",
                  "bg-surface-secondary border border-edge",
                  "text-content placeholder:text-content-muted",
                  "focus:outline-none focus:ring-1 focus:ring-ring"
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleCustomSubmit();
                  }
                }}
              />
              <button
                type="button"
                onClick={() => void handleCustomSubmit()}
                disabled={!customResponse.trim()}
                aria-label="Submit response"
                className={cn(
                  "p-1.5 rounded-lg",
                  "bg-[var(--accent-primary)] text-white",
                  "hover:opacity-90 transition-opacity",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => void onCancel(request._id)}
                aria-label="Cancel request"
                className={cn(
                  "p-1.5 rounded-lg",
                  "border border-edge",
                  "hover:bg-red-500/10 hover:border-red-500/30",
                  "transition-colors"
                )}
              >
                <XCircle className="w-3.5 h-3.5 text-red-500" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          /* Free-form response */
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={customResponse}
              onChange={(e) => setCustomResponse(e.target.value)}
              placeholder="Type your response..."
              aria-label="Your response"
              className={cn(
                "flex-1 px-2.5 py-1.5 rounded-lg text-xs",
                "bg-surface-secondary border border-edge",
                "text-content placeholder:text-content-muted",
                "focus:outline-none focus:ring-1 focus:ring-ring"
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleCustomSubmit();
                }
              }}
            />
            <button
              type="button"
              onClick={() => void handleCustomSubmit()}
              disabled={!customResponse.trim()}
              aria-label="Submit response"
              className={cn(
                "p-1.5 rounded-lg",
                "bg-[var(--accent-primary)] text-white",
                "hover:opacity-90 transition-opacity",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void onCancel(request._id)}
              aria-label="Cancel request"
              className={cn(
                "p-1.5 rounded-lg",
                "border border-edge",
                "hover:bg-red-500/10 hover:border-red-500/30",
                "transition-colors"
              )}
            >
              <XCircle className="w-3.5 h-3.5 text-red-500" aria-hidden="true" />
            </button>
          </div>
        )}
        {errorMessage ? (
          <p
            className="mt-2 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-2 text-xs text-red-700 dark:text-red-300"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
});

// ============================================================================
// Helper Functions
// ============================================================================

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ============================================================================
// Main Component
// ============================================================================

export const HumanApprovalQueue = memo(function HumanApprovalQueue({
  className,
  compact = false,
  maxItems = 10,
}: HumanApprovalQueueProps) {
  const [processingIds, setProcessingIds] = useState<Set<Id<"humanRequests">>>(new Set());
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});

  // Fetch pending requests
  const pendingRequests = useQuery(api.domains.agents.humanInTheLoop.getAllPendingRequests) as HumanRequest[] | undefined;

  // Mutations
  const respondToRequest = useMutation(api.domains.agents.humanInTheLoop.respondToRequest);
  const cancelRequest = useMutation(api.domains.agents.humanInTheLoop.cancelRequest);

  const handleRespond = useCallback(async (requestId: Id<"humanRequests">, response: string) => {
    setProcessingIds((prev) => new Set(prev).add(requestId));
    setRequestErrors((prev) => {
      const next = { ...prev };
      delete next[String(requestId)];
      return next;
    });
    try {
      await respondToRequest({ requestId, response });
      return true;
    } catch {
      console.error("Failed to respond to request");
      setRequestErrors((prev) => ({
        ...prev,
        [String(requestId)]: "The response was not saved. This request is still pending; try again.",
      }));
      return false;
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  }, [respondToRequest]);

  const handleCancel = useCallback(async (requestId: Id<"humanRequests">) => {
    setProcessingIds((prev) => new Set(prev).add(requestId));
    setRequestErrors((prev) => {
      const next = { ...prev };
      delete next[String(requestId)];
      return next;
    });
    try {
      await cancelRequest({ requestId });
      return true;
    } catch {
      console.error("Failed to cancel request");
      setRequestErrors((prev) => ({
        ...prev,
        [String(requestId)]: "The request was not cancelled. It is still pending; try again.",
      }));
      return false;
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    }
  }, [cancelRequest]);

  // Loading state
  if (pendingRequests === undefined) {
    return (
      <div className={cn("p-4 text-center text-xs text-content-muted", className)}>
        <Loader2 className="w-4 h-4 motion-safe:animate-spin mx-auto mb-2" />
        Loading requests...
      </div>
    );
  }

  // Nothing is actionable, so the hub stays quiet.
  if (pendingRequests.length === 0) {
    return null;
  }

  const displayRequests = pendingRequests.slice(0, maxItems);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      {!compact && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-sm font-semibold text-content">
              Pending Approvals
            </h3>
            <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 border border-amber-500/20">
              {pendingRequests.length}
            </span>
          </div>
        </div>
      )}

      {/* Request Cards */}
      <div className="space-y-2">
        {displayRequests.map((request) => (
          <RequestCard
            key={request._id}
            request={request}
            onRespond={handleRespond}
            onCancel={handleCancel}
            isProcessing={processingIds.has(request._id)}
            errorMessage={requestErrors[String(request._id)]}
          />
        ))}
      </div>

      {/* Show more indicator */}
      {pendingRequests.length > maxItems && (
        <div className="text-center text-xs text-content-muted">
          +{pendingRequests.length - maxItems} more pending
        </div>
      )}
    </div>
  );
});

export default HumanApprovalQueue;
