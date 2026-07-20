"use client";

/**
 * ActionCard Component
 *
 * Renders a single action/deep-dive from Act III of the Daily Brief.
 * Per north-star spec:
 * - Recommended move (imperative title)
 * - Why now (1-2 sentences)
 * - Deliverable (explicit artifact)
 * - Expected outcome (measurable)
 * - Risks / dependencies (short)
 * - Evidence refs
 * - "Run deep dive" button only if content available
 */

import React, { useState } from "react";
import {
  ChevronDown, ChevronUp, CheckCircle2, Clock3, Lightbulb, MinusCircle,
  Target, AlertTriangle, FileText, TrendingUp, LinkIcon, Zap
} from "lucide-react";
import type { Action, ActionStatus } from "../types/dailyBriefSchema";

const STATUS_META: Record<
  ActionStatus,
  { label: string; className: string; icon: React.ReactNode }
> = {
  proposed: {
    label: "Proposed",
    className: "bg-indigo-50 text-indigo-700 border-indigo-200",
    icon: <Lightbulb className="w-3.5 h-3.5" />,
  },
  in_progress: {
    label: "In progress",
    className: "bg-amber-50 text-amber-800 border-amber-200",
    icon: <Clock3 className="w-3.5 h-3.5" />,
  },
  completed: {
    label: "Completed",
    className: "bg-indigo-50 text-content-secondary border-indigo-200",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  insufficient_data: {
    label: "Needs data",
    className: "bg-surface-secondary text-content-secondary border-edge",
    icon: <MinusCircle className="w-3.5 h-3.5" />,
  },
  skipped: {
    label: "Skipped",
    className: "bg-surface-secondary text-content-secondary border-edge",
    icon: <MinusCircle className="w-3.5 h-3.5" />,
  },
};

interface ActionCardProps {
  action: Action;
  index: number;
  defaultExpanded?: boolean;
  /** Callback when "Run deep dive" is clicked */
  onRunDeepDive?: (action: Action) => void;
}

export function ActionCard({
  action,
  index,
  defaultExpanded = index === 0,
  onRunDeepDive
}: ActionCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const status = STATUS_META[action.status] ?? STATUS_META.proposed;
  const linkedSignals = Array.isArray(action.linkedSignalIds) ? action.linkedSignalIds.length : 0;
  const linkedEvidence = Array.isArray(action.linkedEvidenceIds) ? action.linkedEvidenceIds.length : 0;

  // Only show deep dive button if action has content and is actionable
  const canRunDeepDive = action.hasDeepDive ||
    (action.status === "proposed" && action.content && action.content.length > 50);

  return (
    <div className="group relative bg-surface border border-edge rounded-lg overflow-hidden hover:shadow-md hover:border-primary/20 transition-all duration-200">
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-slate-900 to-slate-400" />

      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full text-left pl-5 pr-4 py-4 flex items-start gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded"
      >
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-surface-secondary text-content-secondary flex items-center justify-center text-xs font-bold mt-0.5">
          {index + 1}
        </div>

        <div className="flex-1 min-w-0">
          {/* Recommended Move (imperative title) */}
          <h3 className="text-base font-semibold text-content leading-snug group-hover:text-content">
            {action.label}
          </h3>

          {/* Meta Row */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium border rounded-full ${status.className}`}
              title={status.label}
            >
              {status.icon}
              {status.label}
            </span>

            {/* Deliverable badge */}
            {action.deliverable && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-surface-secondary text-content-secondary border border-edge rounded-full">
                <FileText className="w-2.5 h-2.5" />
                {action.deliverable}
              </span>
            )}

            {linkedSignals > 0 && (
              <span className="text-xs text-content-secondary bg-surface-secondary px-2 py-0.5 rounded-full border border-edge">
                Links to {linkedSignals} signal{linkedSignals !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        <div className="flex-shrink-0 text-content-secondary group-hover:text-content-secondary transition-colors mt-0.5">
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>

      {isExpanded && (
        <div className="px-5 pb-5 space-y-4">
          {/* Why Now */}
          {action.whyNow && (
            <div className="flex items-start gap-2 text-sm">
              <Clock3 className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-medium text-content-secondary">Why now: </span>
                <span className="text-content-secondary">{action.whyNow}</span>
              </div>
            </div>
          )}

          {/* Expected Outcome */}
          {action.expectedOutcome && (
            <div className="flex items-start gap-2 text-sm">
              <Target className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-medium text-content-secondary">Expected outcome: </span>
                <span className="text-content-secondary">{action.expectedOutcome}</span>
              </div>
            </div>
          )}

          {/* Risks / Dependencies */}
          {action.risks && (
            <div className="flex items-start gap-2 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800">{action.risks}</div>
            </div>
          )}

          {/* Content / Deep Dive */}
          <div className="prose prose-sm prose-slate max-w-none">
            <p className="text-content leading-relaxed">
              {action.resultMarkdown?.trim() || action.content}
            </p>
          </div>

          {/* Evidence Refs */}
          {linkedEvidence > 0 && (
            <div className="flex items-center gap-2 text-xs text-content-secondary">
              <LinkIcon className="w-3 h-3" />
              <span>Backed by {linkedEvidence} evidence source{linkedEvidence !== 1 ? "s" : ""}</span>
            </div>
          )}

          {/* Run Deep Dive Button */}
          {canRunDeepDive && onRunDeepDive && (
            <button
              type="button"
              onClick={() => onRunDeepDive(action)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
            >
              <Zap className="w-4 h-4" />
              Run deep dive
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface ActionListProps {
  actions: Action[];
  className?: string;
}

export function ActionList({ actions, className = "" }: ActionListProps) {
  if (!actions || actions.length === 0) return null;
  return (
    <div className={`space-y-4 ${className}`}>
      {actions.map((action, idx) => (
        <ActionCard key={action.id || `${idx}`} action={action} index={idx} />
      ))}
    </div>
  );
}

export default ActionCard;

