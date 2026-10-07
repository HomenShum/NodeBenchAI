/**
 * NotebookTopStatusRow — always-visible compressed status band at the
 * top of the entity page. Replaces the old collapsible "Run diligence
 * · last run 9h ago" single-pill affordance with a four-chip row that
 * answers the four runtime questions at a glance:
 *
 *   [verdict]   latest judgment tier      (emerald / sky / amber / rose)
 *   [drift]     rolling verified-rate     (fires only when below floor)
 *   [run]       active run state + progress
 *   [queue]     scheduled retries + DLQ count
 *
 * Silent-when-idle rule: if every chip has nothing to say, the whole
 * row returns null. You never see a four-chip band reading "all fine"
 * on a brand-new entity — that's the opposite of the "notebook is the
 * product" principle.
 *
 * Integration: mounted at the top of `LiveDiligenceSection`. Clicking
 * any chip expands the section to reveal the full detail panels; the
 * chip remains highlighted so you know which detail opened.
 *
 * Data sources (all reactive Convex queries — same ones each detail
 * panel reads, so the numbers stay consistent):
 *   - verdict: domains.product.diligenceJudge.listForEntity
 *   - drift:   same + computeDriftState()
 *   - run:     useRunGraph() (extendedThinkingRuns + checkpoints)
 *   - queue:   pipelineReliability.listRetriesForEntity + rollupDeadLetters
 */

import { memo, useMemo } from "react";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Clock3,
  HelpCircle,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useConvexApi } from "@/lib/convexApi";
import { computeDriftState } from "@/features/entities/components/notebook/DiligenceDriftBanner";
import { useRunGraph } from "@/features/agents/hooks/useRunGraph";
import { cn } from "@/lib/utils";

type ChipTone = "emerald" | "sky" | "amber" | "rose" | "muted";

interface StatusChip {
  key: string;
  tone: ChipTone;
  icon: LucideIcon;
  label: string;
  value: string;
  title: string;
}

const TONE_STYLE: Record<ChipTone, string> = {
  emerald: "text-emerald-300 bg-emerald-500/10 border-emerald-400/20",
  sky: "text-sky-300 bg-sky-500/10 border-sky-400/20",
  amber: "text-amber-300 bg-amber-500/10 border-amber-400/20",
  rose: "text-rose-300 bg-rose-500/10 border-rose-400/20",
  muted: "text-content-muted bg-white/[0.03] border-white/[0.06]",
};

function formatRelative(ts: number): string {
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

export interface NotebookTopStatusRowProps {
  entitySlug: string;
  /** Whether the parent section is expanded. Drives the chevron + aria. */
  expanded: boolean;
  /** Called when the user toggles the whole row. */
  onToggle: () => void;
  className?: string;
}

export const NotebookTopStatusRow = memo(function NotebookTopStatusRow({
  entitySlug,
  expanded,
  onToggle,
  className,
}: NotebookTopStatusRowProps) {
  const api = useConvexApi();

  // 1) Verdict stream (also feeds drift computation below)
  const verdicts = useQuery(
    api?.domains?.product?.diligenceJudge?.listForEntity ?? ("skip" as any),
    api?.domains?.product?.diligenceJudge?.listForEntity
      ? { entitySlug, limit: 20 }
      : "skip",
  ) as
    | ReadonlyArray<{
        verdict: "verified" | "provisionally_verified" | "needs_review" | "failed";
        createdAt: number;
        scratchpadRunId?: string;
      }>
    | undefined;

  // 2) Pipeline retries + DLQ rollup
  const retries = useQuery(
    api?.domains?.product?.pipelineReliability?.listRetriesForEntity ?? ("skip" as any),
    api?.domains?.product?.pipelineReliability?.listRetriesForEntity
      ? { entitySlug, limit: 10 }
      : "skip",
  ) as ReadonlyArray<{ status: string }> | undefined;

  const dlqRollup = useQuery(
    api?.domains?.product?.pipelineReliability?.rollupDeadLetters ?? ("skip" as any),
    api?.domains?.product?.pipelineReliability?.rollupDeadLetters ? {} : "skip",
  ) as { open: number } | undefined;

  // 3) Run graph (shared with AgentFlowRail)
  const runGraph = useRunGraph(entitySlug);

  const chips = useMemo<StatusChip[]>(() => {
    const out: StatusChip[] = [];

    // Verdict chip — latest row from the verdicts stream
    if (verdicts && verdicts.length > 0) {
      const latest = verdicts[0];
      const tone: ChipTone =
        latest.verdict === "verified"
          ? "emerald"
          : latest.verdict === "provisionally_verified"
            ? "sky"
            : latest.verdict === "needs_review"
              ? "amber"
              : "rose";
      const icon: LucideIcon =
        latest.verdict === "verified"
          ? CheckCircle2
          : latest.verdict === "provisionally_verified"
            ? CheckCircle2
            : latest.verdict === "needs_review"
              ? HelpCircle
              : CircleSlash;
      const valueLabel =
        latest.verdict === "verified"
          ? "verified"
          : latest.verdict === "provisionally_verified"
            ? "provisional"
            : latest.verdict === "needs_review"
              ? "needs review"
              : "failed";
      out.push({
        key: "verdict",
        tone,
        icon,
        label: "Verdict",
        value: `${valueLabel} · ${formatRelative(latest.createdAt)}`,
        title: `Latest verdict: ${latest.verdict} (${formatRelative(latest.createdAt)} ago)`,
      });
    }

    // Drift chip — only visible when warn (emerald "all good" would be
    // the opposite of silent-when-idle)
    if (verdicts && verdicts.length >= 5) {
      const state = computeDriftState(
        verdicts.map((v) => ({
          verdict: v.verdict,
          scratchpadRunId: v.scratchpadRunId ?? "",
          createdAt: v.createdAt,
        })),
        { windowSize: 20, verifiedRateFloor: 0.6, minRunsForAlert: 5 },
      );
      if (state.kind === "warn") {
        out.push({
          key: "drift",
          tone: "amber",
          icon: AlertTriangle,
          label: "Drift",
          value: `${Math.round(state.verifiedRate * 100)}% verified`,
          title: `Drift warning: verified rate ${Math.round(state.verifiedRate * 100)}% across last ${state.total} runs (${state.failedCount} failed, ${state.needsReviewCount} needs review)`,
        });
      }
    }

    // Run chip — when a run is active, show progress
    if (runGraph.isActive && runGraph.nodes.length > 0) {
      const total = runGraph.nodes.length;
      const done = runGraph.nodes.filter((n) => n.status === "completed").length;
      out.push({
        key: "run",
        tone: "sky",
        icon: Loader2,
        label: "Run",
        value: `${done}/${total} · running`,
        title: `Live run in progress — ${done} of ${total} checkpoints complete`,
      });
    } else if (runGraph.lastRunAt) {
      // Quiet variant — show last run time only when no active run
      out.push({
        key: "run",
        tone: "muted",
        icon: Clock3,
        label: "Last run",
        value: formatRelative(runGraph.lastRunAt),
        title: `Last run completed ${formatRelative(runGraph.lastRunAt)} ago`,
      });
    }

    // Queue chip — scheduled retries + open DLQ entries
    const scheduledCount = (retries ?? []).filter((r) => r.status === "scheduled").length;
    const dlqCount = dlqRollup?.open ?? 0;
    if (scheduledCount > 0 || dlqCount > 0) {
      const tone: ChipTone = dlqCount > 0 ? "rose" : "amber";
      const icon: LucideIcon = dlqCount > 0 ? ShieldAlert : Clock3;
      const parts: string[] = [];
      if (scheduledCount > 0) parts.push(`${scheduledCount} retry${scheduledCount === 1 ? "" : "s"}`);
      if (dlqCount > 0) parts.push(`${dlqCount} dlq`);
      out.push({
        key: "queue",
        tone,
        icon,
        label: "Queue",
        value: parts.join(" · "),
        title: `Pipeline reliability: ${parts.join(", ")}`,
      });
    }

    return out;
  }, [verdicts, retries, dlqRollup, runGraph]);

  // Silent-when-idle: nothing to say → render nothing
  if (chips.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "nb-top-status-row flex items-center gap-2 overflow-x-auto rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs",
        className,
      )}
      role="group"
      aria-label="Notebook runtime status"
      data-testid="notebook-top-status-row"
    >
      <Activity className="h-3.5 w-3.5 shrink-0 text-content-muted" aria-hidden="true" />
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.18em] text-content-muted">
        Runtime
      </span>
      <div className="flex items-center gap-1.5">
        {chips.map((chip) => {
          const Icon = chip.icon;
          return (
            <span
              key={chip.key}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                TONE_STYLE[chip.tone],
              )}
              title={chip.title}
              data-chip-kind={chip.key}
            >
              <Icon
                className={cn(
                  "h-3 w-3",
                  chip.key === "run" && chip.tone === "sky" ? "animate-spin" : "",
                )}
                aria-hidden="true"
              />
              <span className="text-content-muted">{chip.label}</span>
              <span>{chip.value}</span>
            </span>
          );
        })}
      </div>
      <div className="ml-auto flex shrink-0 items-center">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-content-muted transition hover:bg-white/[0.04] hover:text-content"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse runtime details" : "Expand runtime details"}
        >
          <span>{expanded ? "Hide" : "Details"}</span>
          {expanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      </div>
    </div>
  );
});

NotebookTopStatusRow.displayName = "NotebookTopStatusRow";
