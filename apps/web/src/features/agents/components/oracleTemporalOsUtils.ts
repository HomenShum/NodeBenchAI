export type OracleTemporalPhaseStatus = "completed" | "in_progress" | "pending";

export function getTemporalPhasePresentation(status: OracleTemporalPhaseStatus) {
  if (status === "completed") {
    return {
      label: "Completed",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (status === "in_progress") {
    return {
      label: "In progress",
      className: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  return {
    label: "Pending",
    className: "border-edge bg-surface-secondary/50 text-content-muted",
  };
}

export function summarizeTemporalCounts(counts: {
  observations: number;
  signals: number;
  causalChains: number;
  zeroDrafts: number;
  proofPacks: number;
}) {
  const implementedSlices = [
    counts.observations > 0 && counts.signals > 0,
    counts.causalChains > 0,
    counts.zeroDrafts > 0,
    counts.proofPacks > 0,
  ].filter(Boolean).length;

  return `${implementedSlices}/4 phases activated`;
}
