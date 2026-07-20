/**
 * ExtendedRunPanel — Live Diligence surface.
 *
 * Owner-facing UI for launching and watching multi-checkpoint extended-
 * thinking runs. Subscribes to `listRunsForEntity` + `listCheckpointsForRun`
 * so new checkpoint rows stream in as the orchestrator writes them
 * (Convex reactivity = the streaming mechanism).
 *
 * Three modes:
 *   - No runs yet: launcher form (goal input, totalCheckpoints slider)
 *   - Active run: live checkpoint feed with status pill, findings,
 *     cancel button, token usage
 *   - Completed run: final brief summary + "Start new run" CTA
 *
 * Design posture:
 *   - BOUND: caps visible checkpoints at MAX_CHECKPOINTS+5 so a rogue run
 *     doesn't inflate the DOM
 *   - HONEST_STATUS: every run/checkpoint status maps to a distinct
 *     visible pill (running ≠ failed ≠ parse_error)
 *   - Progressive disclosure: findings collapse per checkpoint, reasoning
 *     hidden behind a details toggle
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

type RunRow = {
  _id: Id<"extendedThinkingRuns">;
  entitySlug: string;
  goal: string;
  status: string;
  currentCheckpoint: number;
  totalCheckpoints: number;
  thinkingBudgetTokens: number;
  thinkingTokensUsed: number;
  modelName: string;
  startedAt: number;
  lastActivityAt: number;
  completedAt?: number;
  errorMessage?: string;
  researchComplete?: boolean;
};

type CheckpointRow = {
  _id: Id<"extendedThinkingCheckpoints">;
  index: number;
  status: string;
  headline?: string;
  findingsJson?: string;
  nextFocus?: string;
  reasoning?: string;
  researchComplete?: boolean;
  focus?: string;
  latencyMs: number;
  thinkingTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
  judgedAt: number;
};

export type ExtendedRunPanelProps = {
  entitySlug: string;
  canEdit: boolean;
  className?: string;
  showLauncherWhenIdle?: boolean;
};

const STATUS_PILL: Record<string, { label: string; className: string }> = {
  queued: { label: "Queued", className: "border-white/[0.1] bg-white/[0.02] text-white/70" },
  running: { label: "Running", className: "border-sky-500/40 bg-sky-500/10 text-sky-200" },
  waiting_checkpoint: {
    label: "Between checkpoints",
    className: "border-sky-500/20 bg-sky-500/5 text-sky-200/80",
  },
  completed: {
    label: "Completed",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  },
  failed: { label: "Failed", className: "border-rose-500/40 bg-rose-500/10 text-rose-200" },
  canceled: {
    label: "Canceled",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  },
  scored: {
    label: "Scored",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  },
  parse_error: {
    label: "Parse error",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  },
  request_failed: {
    label: "Request failed",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  },
};

function pill(status: string) {
  return STATUS_PILL[status] ?? { label: status, className: "border-white/[0.1] bg-white/[0.02] text-white/70" };
}

function formatRelative(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function parseFindings(json?: string): ReadonlyArray<{ text: string; sourceRefId?: string }> {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v)) {
      return v.filter(
        (f) => f && typeof f === "object" && typeof f.text === "string",
      );
    }
  } catch {
    // ignore
  }
  return [];
}

function Launcher({
  entitySlug,
  defaultGoal,
}: {
  entitySlug: string;
  defaultGoal: string;
}) {
  const request = useMutation(
    api.domains.product.extendedThinking.requestExtendedRun,
  );
  const [goal, setGoal] = useState(defaultGoal);
  const [totalCheckpoints, setTotalCheckpoints] = useState(8);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleStart() {
    setErr(null);
    setBusy(true);
    try {
      await request({
        entitySlug,
        goal: goal.trim(),
        totalCheckpoints,
      });
      setBusy(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.18em] text-white/50">
          Research goal
        </span>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          className="w-full rounded border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d97757]"
          placeholder="e.g. Build a diligence brief including founders, product, funding, and market thesis."
        />
      </label>
      <label className="flex items-center gap-3">
        <span className="text-[11px] uppercase tracking-[0.18em] text-white/50">
          Checkpoints
        </span>
        <input
          type="range"
          min={1}
          max={36}
          value={totalCheckpoints}
          onChange={(e) => setTotalCheckpoints(Number(e.target.value))}
          className="flex-1 accent-[#d97757]"
        />
        <span className="font-mono text-sm text-white/80">{totalCheckpoints}</span>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleStart}
          disabled={busy || goal.trim().length === 0}
          className="inline-flex items-center rounded-md border border-[#d97757]/40 bg-[#d97757]/15 px-3 py-1.5 text-sm text-[#d97757] hover:border-[#d97757]/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d97757] disabled:opacity-50"
        >
          {busy ? "Starting…" : "Start Live Diligence"}
        </button>
        <span className="text-[11px] text-white/40">
          ~{totalCheckpoints * 2}–{totalCheckpoints * 5} min · extended thinking
        </span>
      </div>
      {err ? (
        <p className="text-xs text-rose-200" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}

function CheckpointCard({ cp }: { cp: CheckpointRow }) {
  const p = pill(cp.status);
  const findings = parseFindings(cp.findingsJson);
  return (
    <li className="rounded-md border border-white/[0.05] bg-white/[0.015] p-3">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] text-white/50">
          #{cp.index}
        </span>
        <span
          className={
            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] " +
            p.className
          }
        >
          {p.label}
        </span>
        <span className="flex-1 truncate text-sm text-white/90">
          {cp.headline ?? cp.errorMessage ?? "(no headline)"}
        </span>
        <span className="font-mono text-[10px] text-white/40">
          {cp.latencyMs}ms
          {typeof cp.thinkingTokens === "number"
            ? ` · ${cp.thinkingTokens}tok think`
            : ""}
        </span>
      </div>
      {cp.focus ? (
        <p className="mt-1 text-[11px] text-white/50">
          Focus: {cp.focus}
        </p>
      ) : null}
      {findings.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {findings.map((f, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-xs text-white/75"
            >
              <span className="mt-0.5 text-white/40">·</span>
              <span className="flex-1">{f.text}</span>
              {f.sourceRefId ? (
                <span className="shrink-0 font-mono text-[10px] text-white/40">
                  {f.sourceRefId}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {cp.reasoning ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] uppercase tracking-[0.12em] text-white/40 hover:text-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d97757]">
            Reasoning
          </summary>
          <p className="mt-1 text-xs text-white/60">{cp.reasoning}</p>
        </details>
      ) : null}
      {cp.nextFocus ? (
        <p className="mt-1 text-[11px] text-sky-200/80">
          → Next: {cp.nextFocus}
        </p>
      ) : null}
      {cp.status !== "scored" && cp.errorMessage ? (
        <p className="mt-1 text-[11px] text-rose-200/80">
          {cp.errorMessage}
        </p>
      ) : null}
    </li>
  );
}

function ActiveRun({
  run,
  className,
}: {
  run: RunRow;
  className?: string;
}) {
  const checkpoints = useQuery(
    api.domains.product.extendedThinking.listCheckpointsForRun,
    { runId: run._id },
  ) as ReadonlyArray<CheckpointRow> | undefined;
  const cancelRun = useMutation(
    api.domains.product.extendedThinking.cancelExtendedRun,
  );
  const [canceling, setCanceling] = useState(false);

  const sorted = useMemo(() => {
    if (!checkpoints) return [];
    return [...checkpoints].sort((a, b) => b.index - a.index);
  }, [checkpoints]);

  const p = pill(run.status);
  const inFlight = run.status === "running" || run.status === "waiting_checkpoint" || run.status === "queued";

  async function handleCancel() {
    setCanceling(true);
    try {
      await cancelRun({ runId: run._id });
    } catch {
      // ignore — status query will reflect outcome
    }
    setCanceling(false);
  }

  return (
    <div className={"space-y-3 " + (className ?? "")}>
      <header className="flex flex-wrap items-baseline gap-2">
        <span
          className={
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium " +
            p.className
          }
        >
          {p.label}
        </span>
        <span className="text-xs text-white/60">
          Checkpoint {run.currentCheckpoint}/{run.totalCheckpoints}
        </span>
        <span className="font-mono text-[11px] text-white/40">
          {run.thinkingTokensUsed.toLocaleString()}/
          {run.thinkingBudgetTokens.toLocaleString()} think-tok
        </span>
        <span className="text-[11px] text-white/40">
          started {formatRelative(run.startedAt)}
        </span>
        {inFlight ? (
          <button
            type="button"
            onClick={handleCancel}
            disabled={canceling}
            className="ml-auto inline-flex items-center rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200 hover:border-rose-500/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d97757] disabled:opacity-50"
          >
            {canceling ? "Canceling…" : "Cancel run"}
          </button>
        ) : null}
      </header>

      <p className="rounded border border-white/[0.05] bg-white/[0.015] px-3 py-2 text-xs text-white/70">
        <span className="font-medium text-white/80">Goal:</span> {run.goal}
      </p>

      {run.errorMessage ? (
        <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" role="alert">
          {run.errorMessage}
        </p>
      ) : null}

      {checkpoints === undefined ? (
        <div className="h-6 w-full rounded bg-white/[0.04] motion-safe:animate-pulse" />
      ) : sorted.length === 0 ? (
        <p className="text-[11px] text-white/50">
          Waiting for first checkpoint…
        </p>
      ) : (
        <ol className="space-y-2" aria-live="polite">
          {sorted.map((cp) => (
            <CheckpointCard key={cp._id} cp={cp} />
          ))}
        </ol>
      )}
    </div>
  );
}

export function ExtendedRunPanel({
  entitySlug,
  canEdit,
  className,
  showLauncherWhenIdle = false,
}: ExtendedRunPanelProps) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const runs = useQuery(
    api.domains.product.extendedThinking.listRunsForEntity,
    { entitySlug, limit: 5 },
  ) as ReadonlyArray<RunRow> | undefined;

  if (runs === undefined) return null; // loading silently

  const latest = runs[0];
  const active = latest && (latest.status === "running" || latest.status === "waiting_checkpoint" || latest.status === "queued");

  if (!canEdit && !latest) return null;

  // Ship-gate rubric §1 + §6: idle state should be a single compact
  // affordance, not a full control panel. Full launcher only when user
  // signals intent by clicking "Run diligence" or a past run is active.
  const idle = !latest && !active;

  if (idle && canEdit && !launcherOpen && !showLauncherWhenIdle) {
    return (
      <div
        className={"flex items-center gap-2 text-[12px] text-white/50 " + (className ?? "")}
        role="region"
        aria-label="Live diligence (idle)"
      >
        <span className="uppercase tracking-[0.18em] text-[10px] text-white/35">
          Live diligence
        </span>
        <span className="text-white/20">·</span>
        <button
          type="button"
          onClick={() => setLauncherOpen(true)}
          className="rounded-md px-2 py-0.5 text-[11px] text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white/95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        >
          Run diligence →
        </button>
      </div>
    );
  }

  return (
    <section
      className={
        "rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 " +
        (className ?? "")
      }
      role="region"
      aria-label="Live diligence"
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-white/60">
          Live diligence
        </h2>
        {latest ? (
          <span className="font-mono text-[11px] text-white/40">
            {runs.length} run{runs.length === 1 ? "" : "s"}
          </span>
        ) : idle && canEdit && !showLauncherWhenIdle ? (
          <button
            type="button"
            onClick={() => setLauncherOpen(false)}
            className="text-[11px] text-white/40 transition-colors hover:text-white/70"
            aria-label="Close launcher"
          >
            ✕
          </button>
        ) : null}
      </header>

      {latest ? (
        <ActiveRun run={latest} />
      ) : canEdit ? (
        <Launcher
          entitySlug={entitySlug}
          defaultGoal={`Build a diligence brief for ${entitySlug}, covering founders, product, funding, market thesis, and recent material changes.`}
        />
      ) : null}

      {latest && !active && canEdit ? (
        <div className="mt-4 border-t border-white/[0.05] pt-3">
          <Launcher
            entitySlug={entitySlug}
            defaultGoal={`Re-run diligence for ${entitySlug} with fresh findings.`}
          />
        </div>
      ) : null}
    </section>
  );
}
