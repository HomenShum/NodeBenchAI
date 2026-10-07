/**
 * LessonsPanel — operator UI for inspecting the agentLessons table.
 *
 * A-PR-B.7 of the Autonomous Continuation System.
 * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
 *
 * Surface the captured-lessons audit trail to the operator so they can:
 *   - See exactly what the agent has learned in this thread
 *   - Pin lessons that should always inject (bypass the K cap, no expiry)
 *   - Deprecate lessons that are no longer relevant (kept in audit, but
 *     never injected again)
 *
 * Pure presentation — accepts a `lessons` array and `onPin` /
 * `onDeprecate` callbacks. Wiring into the actual ``listAllLessonsForThread``
 * query and the ``pinLesson`` / ``deprecateLesson`` mutations from A-PR-B.6
 * lives in the parent (a follow-up wiring PR).
 *
 * Visual structure:
 *   - Header with thread label + lesson count
 *   - Type filter chips (All / Semantic / Spiral / Infrastructure / Budget)
 *   - Grouped list (semantic > spiral > infrastructure > budget)
 *   - Per-lesson: type badge, content preview, pin/deprecate actions,
 *     captured-at timestamp, deprecated/expired affordance
 *   - Empty state with helpful copy when no lessons exist for the thread
 */

import { useMemo, useState } from "react";
import {
  Pin,
  PinOff,
  EyeOff,
  AlertTriangle,
  Activity,
  Repeat,
  Zap,
  DollarSign,
  Clock,
} from "lucide-react";

import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════

export type LessonType = "semantic" | "spiral" | "infrastructure" | "budget";

/**
 * Public lesson shape consumed by the panel. Matches the validator in
 * ``getRelevantLessons.ts`` so ``listAllLessonsForThread`` results can be
 * passed through directly. Kept structural rather than imported so the
 * panel does not couple to the Convex generated types in this file.
 */
export interface LessonsPanelLesson {
  _id: string;
  threadId: string;
  turnId: number;
  type: LessonType;
  toolName?: string | null;
  mistakePattern?: string | null;
  correctPattern?: string | null;
  artifactType?: string | null;
  fromModel?: string | null;
  toModel?: string | null;
  failedWith?: number | string | null;
  succeeded?: boolean | null;
  count?: number | null;
  taskCategory?: string | null;
  estimatedTokensRemaining?: number | null;
  capturedAt: number;
  expiresAfterTurns?: number | null;
  pinned: boolean;
  deprecated: boolean;
  userNote?: string | null;
}

export type LessonFilter = "all" | LessonType;

export interface LessonsPanelProps {
  /** All lessons for the active thread, regardless of deprecated/expired. */
  lessons: readonly LessonsPanelLesson[];
  /** Pin / unpin handler. Receives the lesson `_id` and the desired state. */
  onPin: (lessonId: string, pinned: boolean) => void | Promise<void>;
  /** Deprecate handler. Receives the lesson `_id`. */
  onDeprecate: (lessonId: string) => void | Promise<void>;
  /** Optional thread-name label for the header. */
  threadLabel?: string;
  /** Optional className passthrough for layout integration. */
  className?: string;
}

// ════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════

const TYPE_ORDER: readonly LessonType[] = [
  "semantic",
  "spiral",
  "infrastructure",
  "budget",
];

const TYPE_META: Record<
  LessonType,
  { label: string; icon: typeof Activity; tone: string }
> = {
  semantic: {
    label: "Semantic",
    icon: AlertTriangle,
    tone: "text-rose-700 bg-rose-50 dark:text-rose-200 dark:bg-rose-500/[0.08]",
  },
  spiral: {
    label: "Spiral",
    icon: Repeat,
    tone: "text-purple-700 bg-purple-50 dark:text-purple-200 dark:bg-purple-500/[0.08]",
  },
  infrastructure: {
    label: "Infra",
    icon: Zap,
    tone: "text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-500/[0.08]",
  },
  budget: {
    label: "Budget",
    icon: DollarSign,
    tone: "text-amber-700 bg-amber-50 dark:text-amber-200 dark:bg-amber-500/[0.08]",
  },
};

const FILTER_OPTIONS: ReadonlyArray<{ key: LessonFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "semantic", label: "Semantic" },
  { key: "spiral", label: "Spiral" },
  { key: "infrastructure", label: "Infra" },
  { key: "budget", label: "Budget" },
];

// ════════════════════════════════════════════════════════════════════════
// FORMATTERS
// ════════════════════════════════════════════════════════════════════════

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

function describeLesson(lesson: LessonsPanelLesson): {
  primary: string;
  secondary?: string;
} {
  switch (lesson.type) {
    case "semantic": {
      return {
        primary: lesson.mistakePattern ?? "(no mistake recorded)",
        secondary: lesson.correctPattern
          ? `Do instead: ${lesson.correctPattern}`
          : undefined,
      };
    }
    case "spiral": {
      const tool = lesson.toolName ? ` (\`${lesson.toolName}\`)` : "";
      return {
        primary: `${lesson.mistakePattern ?? "Loop detected"}${tool}`,
        secondary: lesson.correctPattern
          ? `Break by: ${lesson.correctPattern}`
          : undefined,
      };
    }
    case "infrastructure": {
      const status =
        typeof lesson.failedWith === "number"
          ? `HTTP ${lesson.failedWith}`
          : lesson.failedWith ?? "error";
      const outcome = lesson.succeeded ? "succeeded" : "failed";
      const count =
        typeof lesson.count === "number" && lesson.count > 1
          ? ` ×${lesson.count}`
          : "";
      return {
        primary: `${lesson.fromModel ?? "?"} → ${lesson.toModel ?? "?"} after ${status}; fallback ${outcome}${count}`,
      };
    }
    case "budget": {
      const cat = lesson.taskCategory ?? "(unknown task)";
      const tokens = lesson.estimatedTokensRemaining ?? 0;
      return {
        primary: `${cat} hit budget cap with ~${tokens.toLocaleString()} tokens estimated remaining`,
      };
    }
    default:
      return { primary: "(unknown lesson type)" };
  }
}

// ════════════════════════════════════════════════════════════════════════
// COMPONENT
// ════════════════════════════════════════════════════════════════════════

export function LessonsPanel({
  lessons,
  onPin,
  onDeprecate,
  threadLabel,
  className,
}: LessonsPanelProps) {
  const [filter, setFilter] = useState<LessonFilter>("all");
  const [showDeprecated, setShowDeprecated] = useState(false);

  const filtered = useMemo(() => {
    return lessons.filter((l) => {
      if (!showDeprecated && l.deprecated) return false;
      if (filter !== "all" && l.type !== filter) return false;
      return true;
    });
  }, [lessons, filter, showDeprecated]);

  const grouped = useMemo(() => {
    const map = new Map<LessonType, LessonsPanelLesson[]>();
    for (const t of TYPE_ORDER) map.set(t, []);
    for (const lesson of filtered) {
      const list = map.get(lesson.type);
      if (list) list.push(lesson);
    }
    // Pinned first, then newest first within each type.
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.capturedAt - a.capturedAt;
      });
    }
    return map;
  }, [filtered]);

  const counts = useMemo(() => {
    const out: Record<LessonFilter, number> = {
      all: 0,
      semantic: 0,
      spiral: 0,
      infrastructure: 0,
      budget: 0,
    };
    for (const l of lessons) {
      if (l.deprecated && !showDeprecated) continue;
      out.all += 1;
      out[l.type] += 1;
    }
    return out;
  }, [lessons, showDeprecated]);

  const totalShown = filtered.length;

  return (
    <div
      data-testid="lessons-panel"
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.2)] dark:border-white/[0.08] dark:bg-white/[0.04]",
        className,
      )}
    >
      {/* ─── Header ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Captured lessons
        </h3>
        {threadLabel ? (
          <span className="rounded-md bg-slate-100/80 px-1.5 py-0.5 text-[11px] font-mono text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
            {threadLabel}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          {totalShown} shown · {lessons.length} total
        </span>
      </div>

      {/* ─── Filter chips ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            aria-pressed={filter === opt.key}
            onClick={() => setFilter(opt.key)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
              filter === opt.key
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.1]",
            )}
          >
            {opt.label}
            <span className="text-[10px] opacity-70">{counts[opt.key]}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowDeprecated((s) => !s)}
          aria-pressed={showDeprecated}
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
            showDeprecated
              ? "bg-amber-200 text-amber-900 dark:bg-amber-500/[0.2] dark:text-amber-100"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.1]",
          )}
        >
          <EyeOff className="h-3 w-3" aria-hidden />
          {showDeprecated ? "Hiding none" : "Hide deprecated"}
        </button>
      </div>

      {/* ─── Body ─────────────────────────────────────────────────── */}
      {totalShown === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="flex flex-col gap-3">
          {TYPE_ORDER.map((type) => {
            const list = grouped.get(type) ?? [];
            if (list.length === 0) return null;
            const meta = TYPE_META[type];
            const Icon = meta.icon;
            return (
              <section key={type} aria-label={`${meta.label} lessons`}>
                <header className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {meta.label}
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    ({list.length})
                  </span>
                </header>
                <ul className="flex flex-col gap-1.5">
                  {list.map((lesson) => (
                    <LessonRow
                      key={lesson._id}
                      lesson={lesson}
                      onPin={onPin}
                      onDeprecate={onDeprecate}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════════

function LessonRow({
  lesson,
  onPin,
  onDeprecate,
}: {
  lesson: LessonsPanelLesson;
  onPin: LessonsPanelProps["onPin"];
  onDeprecate: LessonsPanelProps["onDeprecate"];
}) {
  const description = describeLesson(lesson);
  const meta = TYPE_META[lesson.type];

  return (
    <li
      className={cn(
        "group flex flex-col gap-1 rounded-lg border border-slate-200/60 px-2.5 py-1.5 text-sm transition-colors",
        lesson.deprecated
          ? "border-dashed bg-slate-50/60 text-slate-400 dark:border-white/[0.04] dark:bg-white/[0.02] dark:text-slate-500"
          : "bg-white/70 text-slate-700 hover:bg-white dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-200 dark:hover:bg-white/[0.05]",
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        {/* Type badge + pin marker */}
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
            meta.tone,
          )}
        >
          {meta.label}
        </span>
        {lesson.pinned ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-500/[0.1] dark:text-blue-200">
            <Pin className="h-3 w-3" aria-hidden />
            pinned
          </span>
        ) : null}
        {lesson.deprecated ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
            deprecated
          </span>
        ) : null}

        {/* Content */}
        <div className="min-w-0 flex-1 text-xs leading-relaxed">
          <p className={cn(lesson.deprecated && "line-through")}>{description.primary}</p>
          {description.secondary ? (
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {description.secondary}
            </p>
          ) : null}
          {lesson.userNote ? (
            <p className="mt-0.5 text-[11px] italic text-slate-500 dark:text-slate-400">
              user note: "{lesson.userNote}"
            </p>
          ) : null}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => void onPin(lesson._id, !lesson.pinned)}
            aria-label={lesson.pinned ? "Unpin lesson" : "Pin lesson"}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-700 dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-blue-200"
          >
            {lesson.pinned ? (
              <PinOff className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Pin className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
          {!lesson.deprecated ? (
            <button
              type="button"
              onClick={() => void onDeprecate(lesson._id)}
              aria-label="Deprecate lesson"
              className="rounded-md p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-700 dark:text-slate-400 dark:hover:bg-rose-500/[0.1] dark:hover:text-rose-200"
            >
              <EyeOff className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      <footer className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
        <Clock className="h-3 w-3" aria-hidden />
        <span>{formatRelativeTime(lesson.capturedAt)}</span>
        <span>· turn {lesson.turnId}</span>
        {typeof lesson.count === "number" && lesson.count > 1 ? (
          <span>· seen ×{lesson.count}</span>
        ) : null}
      </footer>
    </li>
  );
}

function EmptyState({ filter }: { filter: LessonFilter }) {
  const label =
    filter === "all" ? "No lessons captured yet" : `No ${filter} lessons`;
  const detail =
    filter === "all"
      ? "Lessons accumulate after rollbacks, model failovers, spirals, and budget caps. They auto-inject into the next agent turn so the agent literally cannot repeat the same mistake."
      : "Switch filter to All to see other lesson types in this thread.";
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-slate-200/70 bg-slate-50/50 px-4 py-6 text-center dark:border-white/[0.06] dark:bg-white/[0.02]">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </p>
      <p className="max-w-sm text-xs text-slate-500 dark:text-slate-400">
        {detail}
      </p>
    </div>
  );
}
