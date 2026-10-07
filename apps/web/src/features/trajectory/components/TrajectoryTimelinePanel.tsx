import { AlertTriangle, BadgeCheck, CalendarClock, GitBranchPlus, Waves } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrajectoryTimelineItem } from "../types";

function iconForKind(kind: TrajectoryTimelineItem["kind"]) {
  switch (kind) {
    case "span":
      return Waves;
    case "verdict":
      return BadgeCheck;
    case "feedback":
      return CalendarClock;
    case "intervention":
      return GitBranchPlus;
    case "benchmark":
      return AlertTriangle;
    default:
      return Waves;
  }
}

function toneForStatus(status: string) {
  if (status === "pass" || status === "completed" || status === "validated" || status === "approved" || status === "improved") {
    return "border-emerald-500/20 bg-emerald-500/8 text-emerald-700 dark:text-emerald-200";
  }
  if (status === "watch" || status === "running" || status === "pending" || status === "draft") {
    return "border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-200";
  }
  return "border-rose-500/20 bg-rose-500/8 text-rose-700 dark:text-rose-200";
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatScore(score?: number) {
  if (typeof score !== "number") return null;
  return `${Math.round(score * 100)}%`;
}

export function TrajectoryTimelinePanel({
  items,
  emptyLabel = "No trajectory timeline entries yet.",
}: {
  items?: TrajectoryTimelineItem[] | null;
  emptyLabel?: string;
}) {
  return (
    <section className="rounded-2xl border border-edge bg-surface p-4" aria-label="Trajectory Timeline" data-agent-surface="trajectory-timeline">
      <div className="flex items-center gap-2 text-sm font-semibold text-content">
        <CalendarClock className="h-4 w-4 text-accent" aria-hidden="true" />
        Trajectory Timeline
      </div>
      <div className="mt-4 space-y-3">
        {!items?.length ? (
          <div className="rounded-xl border border-dashed border-edge bg-background/40 p-4 text-sm text-content-secondary">
            {emptyLabel}
          </div>
        ) : (
          items.map((item) => {
            const Icon = iconForKind(item.kind);
            const score = formatScore(item.score);
            return (
              <div key={item.id} className="rounded-xl border border-edge bg-background/40 p-3" data-agent-item={item.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-content-muted" aria-hidden="true" />
                      <div className="text-sm font-medium text-content">{item.title}</div>
                      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", toneForStatus(item.status))} aria-label={`Status: ${item.status}`}>
                        {item.status}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-content-secondary">{item.summary}</div>
                  </div>
                  <div className="text-right text-xs text-content-muted">
                    <div>{formatTime(item.occurredAt)}</div>
                    {score ? <div className="mt-1 text-content">{score}</div> : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export default TrajectoryTimelinePanel;
