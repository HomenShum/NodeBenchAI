import React, { useMemo } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Loader2,
  XCircle,
} from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { TaskSession, TaskSessionStatus } from "./TaskManager/types";
import { cn } from "@/lib/utils";

export interface TopicCanvasEntry {
  id: string;
  title: string;
  description?: string;
  status: TaskSessionStatus;
  statusLabel: string;
  statusClassName: string;
  contextLabel?: string;
  resourceLabels: string[];
  traceHref: string;
  typeLabel: string;
  startedAtLabel: string;
}

function getStatusMeta(status: TaskSessionStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "completed":
      return {
        label: "Complete",
        className:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      };
    case "running":
      return {
        label: "In progress",
        className:
          "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
      };
    case "failed":
      return {
        label: "Needs review",
        className:
          "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
      };
    case "cancelled":
      return {
        label: "Stopped",
        className:
          "border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
      };
    default:
      return {
        label: "Queued",
        className:
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
  }
}

function buildContextLabel(session: TaskSession): string | undefined {
  const criterion = session.successCriteria?.[0]?.trim();
  if (criterion) return criterion;
  if (session.goalId?.trim()) return session.goalId.trim();
  if (session.visionSnapshot?.trim()) return session.visionSnapshot.trim();
  return undefined;
}

function buildResourceLabels(session: TaskSession): string[] {
  const labels: string[] = [];

  for (const source of session.sourceRefs ?? []) {
    if (source.label?.trim()) labels.push(source.label.trim());
  }

  for (const tool of session.toolsUsed ?? []) {
    if (tool?.trim()) labels.push(tool.trim());
  }

  if ((session.agentsInvolved?.length ?? 0) > 0) {
    labels.push(
      `${session.agentsInvolved!.length} agent${session.agentsInvolved!.length === 1 ? "" : "s"}`,
    );
  }

  return [...new Set(labels)].slice(0, 4);
}

function formatTypeLabel(type: TaskSession["type"]): string {
  switch (type) {
    case "agent":
      return "Agent";
    case "swarm":
      return "Swarm";
    case "cron":
      return "Cron";
    case "scheduled":
      return "Scheduled";
    default:
      return "Manual";
  }
}

function formatStartedAt(startedAt: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(startedAt));
}

export function buildTopicCanvasEntries(
  sessions: TaskSession[],
): TopicCanvasEntry[] {
  return [...sessions]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 6)
    .map((session) => {
      const statusMeta = getStatusMeta(session.status);

      return {
        id: String(session._id),
        title: session.title,
        description: session.description?.trim() || undefined,
        status: session.status,
        statusLabel: statusMeta.label,
        statusClassName: statusMeta.className,
        contextLabel: buildContextLabel(session),
        resourceLabels: buildResourceLabels(session),
        traceHref: `/execution-trace?session=${encodeURIComponent(String(session._id))}`,
        typeLabel: formatTypeLabel(session.type),
        startedAtLabel: formatStartedAt(session.startedAt),
      };
    });
}

function getStatusIcon(status: TaskSessionStatus) {
  switch (status) {
    case "completed":
      return CheckCircle2;
    case "running":
      return Loader2;
    case "failed":
      return XCircle;
    default:
      return Clock3;
  }
}

export function TopicCanvasPanel() {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const userSessionsData = useQuery(
    api.domains.taskManager.queries.getUserTaskSessions,
    isAuthenticated ? { limit: 6 } : "skip",
  );

  const sessions = useMemo(
    () => (userSessionsData?.sessions ?? []) as TaskSession[],
    [userSessionsData?.sessions],
  );
  const entries = useMemo(() => buildTopicCanvasEntries(sessions), [sessions]);

  if (isAuthLoading || !isAuthenticated) {
    return null;
  }

  return (
    <section className="nb-surface-card overflow-hidden">
      <div className="border-b border-edge px-4 py-3">
        <h2 className="type-section-title text-content">Recent work</h2>
      </div>

      {userSessionsData === undefined ? (
        <p className="px-4 py-5 text-sm text-content-muted" role="status">
          Loading recent work...
        </p>
      ) : entries.length === 0 ? (
        <p className="px-4 py-5 text-sm text-content-muted">
          No recent work. Start a request above.
        </p>
      ) : (
        <div className="divide-y divide-edge">
          {entries.map((entry) => {
            const StatusIcon = getStatusIcon(entry.status);
            return (
              <article key={entry.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="truncate text-sm font-semibold text-content">
                        {entry.title}
                      </h3>
                      <span className="text-xs text-content-muted">
                        {entry.typeLabel} · {entry.startedAtLabel}
                      </span>
                    </div>
                    {entry.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-content-secondary">
                        {entry.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium",
                        entry.statusClassName,
                      )}
                    >
                      <StatusIcon
                        className={cn(
                          "h-3 w-3",
                          entry.status === "running" &&
                            "motion-safe:animate-spin",
                        )}
                        aria-hidden="true"
                      />
                      {entry.statusLabel}
                    </span>
                    <a
                      href={entry.traceHref}
                      className="inline-flex items-center gap-1 text-xs font-medium text-content-secondary transition hover:text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Open trace
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </div>
                </div>

                {entry.contextLabel || entry.resourceLabels.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-content-muted">
                    {entry.contextLabel ? (
                      <span className="max-w-full truncate">
                        Context: {entry.contextLabel}
                      </span>
                    ) : null}
                    {entry.resourceLabels.map((label) => (
                      <span
                        key={`${entry.id}-${label}`}
                        className="rounded-full border border-edge px-2 py-0.5"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default TopicCanvasPanel;
