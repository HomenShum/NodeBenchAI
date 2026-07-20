import { memo } from "react";
import { Activity, GitBranch, Radar } from "lucide-react";
import { AgentFlowRail } from "@/features/agents/primitives/AgentFlowRail";
import { useRunGraph } from "@/features/agents/hooks/useRunGraph";
import { cn } from "@/lib/utils";

type Props = {
  entitySlug: string;
  runStatus?: string | null;
  checkpointCount?: number;
  updatedAt?: number;
  latestBlockType?: string | null;
  className?: string;
};

function formatRelative(timestamp: number): string {
  const ageMs = Math.max(0, Date.now() - timestamp);
  if (ageMs < 60_000) return "just now";
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function statusLabel(status?: string | null): string {
  switch (status) {
    case "streaming":
      return "Running";
    case "structuring":
      return "Structuring";
    case "merged":
      return "Merged";
    case "failed":
      return "Needs review";
    default:
      return "Idle";
  }
}

function NotebookRunMapPanelBase({
  entitySlug,
  runStatus,
  checkpointCount,
  updatedAt,
  latestBlockType,
  className,
}: Props) {
  const runGraph = useRunGraph(entitySlug);

  const graphHeight = Math.max(
    220,
    Math.min(340, 36 + Math.ceil(Math.max(runGraph.nodes.length, 1) / 2) * 88),
  );

  return (
    <section
      className={cn(
        "rounded-[20px] border border-white/[0.08] bg-[#0f1217] px-4 py-4 text-white shadow-[0_16px_40px_rgba(0,0,0,0.2)]",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Radar className="h-3.5 w-3.5 text-white/42" />
        <div className="text-sm font-semibold text-white/92">
          Run map
        </div>
      </div>
      <p className="mt-1 text-[11px] text-white/46">
        {runGraph.hasRun
          ? runGraph.isActive
            ? "The current diligence run is still shaping the notebook."
            : "Last run topology for this entity."
          : "Start live diligence to watch checkpoints, handoffs, and section updates land here."}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-white/78">
          <Activity className="h-3 w-3" />
          {runGraph.hasRun && runGraph.isActive ? "Live now" : statusLabel(runStatus)}
        </span>
        {typeof checkpointCount === "number" && checkpointCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-white/68">
            <GitBranch className="h-3 w-3" />
            {checkpointCount} checkpoint{checkpointCount === 1 ? "" : "s"}
          </span>
        ) : null}
        {latestBlockType ? (
          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-white/68">
            latest {latestBlockType}
          </span>
        ) : null}
        {updatedAt ? (
          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-white/52">
            updated {formatRelative(updatedAt)}
          </span>
        ) : null}
      </div>

      {runGraph.runHeadline ? (
        <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-[11px] text-white/62">
          {runGraph.runHeadline}
        </div>
      ) : null}

      {runGraph.hasRun ? (
        <AgentFlowRail
          nodes={runGraph.nodes}
          edges={runGraph.edges}
          height={graphHeight}
          className="mt-4"
        />
      ) : (
        <div className="mt-4 rounded-[18px] border border-dashed border-white/[0.08] bg-[#0c0f14] px-4 py-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/[0.08] bg-[#171717] px-3 py-3 text-white/80">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">
                Run
              </div>
              <div className="mt-1 text-sm font-medium">Queued for launch</div>
              <div className="mt-1 text-[11px] text-white/45">
                Waiting for your first diligence run.
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-[#171717] px-3 py-3 text-white/80">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">
                Output
              </div>
              <div className="mt-1 text-sm font-medium">No checkpoints yet</div>
              <div className="mt-1 text-[11px] text-white/45">
                The run graph will grow here as checkpoints land.
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export const NotebookRunMapPanel = memo(NotebookRunMapPanelBase);
NotebookRunMapPanel.displayName = "NotebookRunMapPanel";

export default NotebookRunMapPanel;
