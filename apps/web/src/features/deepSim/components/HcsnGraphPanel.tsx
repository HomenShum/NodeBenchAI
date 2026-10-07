import { GitBranch, Layers3, Link2, Orbit, Radar, Target, Telescope } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HcsnEdge, HcsnGraph, HcsnNode, HcsnNodeLevel, HcsnNodeStatus } from "../types";
import { confidenceCategory } from "../types";

const LEVEL_ORDER: HcsnNodeLevel[] = [
  "evidence",
  "observation",
  "signal",
  "causal_chain",
  "trajectory",
  "intervention",
  "outcome_loop",
];

const LEVEL_LABELS: Record<HcsnNodeLevel, string> = {
  evidence: "Evidence",
  observation: "Observations",
  signal: "Signals",
  causal_chain: "Causal Chains",
  trajectory: "Trajectories",
  intervention: "Interventions",
  outcome_loop: "Outcome Loops",
};

const LEVEL_ICONS: Record<HcsnNodeLevel, typeof Telescope> = {
  evidence: Telescope,
  observation: Radar,
  signal: Orbit,
  causal_chain: GitBranch,
  trajectory: Layers3,
  intervention: Target,
  outcome_loop: Link2,
};

function confidenceBadgeClasses(confidence: number): string {
  switch (confidenceCategory(confidence)) {
    case "high":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "medium":
      return "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200";
    case "low":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200";
    case "very_low":
      return "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-200";
  }
}

function statusBadgeClasses(status: HcsnNodeStatus): string {
  switch (status) {
    case "grounded":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "inferred":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200";
    case "projected":
      return "border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-200";
    case "needs_review":
      return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-200";
  }
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function HcsnNodeCard({
  node,
  emphasis,
}: {
  node: HcsnNode;
  emphasis?: "driver" | "intervention" | "risk";
}) {
  const emphasisLabel =
    emphasis === "driver" ? "Top driver" : emphasis === "intervention" ? "Top intervention" : emphasis === "risk" ? "Top risk" : null;

  return (
    <article
      className={cn(
        "rounded-2xl border bg-background/50 p-3",
        emphasis === "driver" && "border-cyan-500/30 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]",
        emphasis === "intervention" && "border-emerald-500/30 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]",
        emphasis === "risk" && "border-amber-500/30 shadow-[0_0_0_1px_rgba(245,158,11,0.08)]",
        !emphasis && "border-edge",
      )}
      data-agent-hcsn-node={node.id}
      data-agent-level={node.level}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-content">{node.label}</h4>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            confidenceBadgeClasses(node.confidence),
          )}
        >
          {formatPercent(node.confidence)}
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-content-secondary">{node.summary}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", statusBadgeClasses(node.status))}>
          {node.status.replace(/_/g, " ")}
        </span>
        {emphasisLabel ? (
          <span className="rounded-full border border-edge bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-content-muted">
            {emphasisLabel}
          </span>
        ) : null}
      </div>

      {node.sourceRefs.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {node.sourceRefs.slice(0, 3).map((ref) => (
            <span
              key={ref}
              className="rounded border border-edge bg-surface px-1.5 py-0.5 text-[10px] text-content-muted"
            >
              {ref}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function HcsnEdgeRow({
  edge,
  fromLabel,
  toLabel,
}: {
  edge: HcsnEdge;
  fromLabel: string;
  toLabel: string;
}) {
  return (
    <li className="rounded-xl border border-edge bg-background/50 px-3 py-3" data-agent-hcsn-edge={edge.id}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
        <span className="font-medium text-content">{fromLabel}</span>
        <span className="rounded-full border border-edge bg-surface px-2 py-0.5 uppercase tracking-wide">
          {edge.relationship.replace(/_/g, " ")}
        </span>
        <span className="font-medium text-content">{toLabel}</span>
        <span className={cn("rounded-full border px-2 py-0.5 font-semibold", confidenceBadgeClasses(edge.confidence))}>
          {formatPercent(edge.confidence)}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-content-secondary">{edge.explanation}</p>
    </li>
  );
}

export function HcsnGraphPanel({ graph }: { graph: HcsnGraph }) {
  const groupedNodes = LEVEL_ORDER.map((level) => ({
    level,
    label: LEVEL_LABELS[level],
    Icon: LEVEL_ICONS[level],
    nodes: graph.nodes.filter((node) => node.level === level),
  })).filter((group) => group.nodes.length > 0);

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  return (
    <section
      className="rounded-3xl border border-edge bg-surface p-4 md:p-5"
      aria-labelledby="hcsn-heading"
      data-agent-surface="hcsn-graph"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <div
            id="hcsn-heading"
            className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-content-muted"
          >
            <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
            HCSN
          </div>
          <h3 className="mt-2 text-lg font-semibold text-content md:text-xl">{graph.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-content-secondary">
            {graph.thesis}
          </p>
        </div>
        <div className="grid min-w-[220px] gap-2 sm:grid-cols-3">
          {[
            ["Top driver", nodeById.get(graph.topDriverNodeId)],
            ["Top intervention", nodeById.get(graph.topInterventionNodeId)],
            ["Top risk", graph.topRiskNodeId ? nodeById.get(graph.topRiskNodeId) : undefined],
          ].map((entry) => {
            const [label, node] = entry as [string, HcsnNode | undefined];
            return node ? (
              <div key={label} className="rounded-2xl border border-edge bg-background/50 px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-content-muted">{label}</div>
                <div className="mt-1 text-sm font-medium text-content">{node.label}</div>
              </div>
            ) : null;
          })}
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-4">
        {groupedNodes.map(({ level, label, Icon, nodes }) => (
          <div
            key={level}
            className="rounded-2xl border border-edge bg-surface-secondary/40 p-3"
            data-agent-hcsn-level={level}
          >
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-content-muted">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </div>
            <div className="mt-3 space-y-3">
              {nodes.map((node) => (
                <HcsnNodeCard
                  key={node.id}
                  node={node}
                  emphasis={
                    node.id === graph.topDriverNodeId
                      ? "driver"
                      : node.id === graph.topInterventionNodeId
                        ? "intervention"
                        : node.id === graph.topRiskNodeId
                          ? "risk"
                          : undefined
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-content-muted">
          <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
          Causal Links
        </div>
        <ul className="mt-3 grid gap-2 lg:grid-cols-2">
          {graph.edges.map((edge) => (
            <HcsnEdgeRow
              key={edge.id}
              edge={edge}
              fromLabel={nodeById.get(edge.from)?.label ?? edge.from}
              toLabel={nodeById.get(edge.to)?.label ?? edge.to}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

export default HcsnGraphPanel;
