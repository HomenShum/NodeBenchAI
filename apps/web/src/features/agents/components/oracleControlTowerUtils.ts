import type { OracleCrossCheckStatus } from "./TaskManager/types";

export function getCrossCheckPresentation(status?: OracleCrossCheckStatus) {
  if (status === "aligned") {
    return {
      label: "Aligned",
      questLabel: "Quest synced",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (status === "drifting") {
    return {
      label: "Drifting",
      questLabel: "Debuff detected",
      className: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (status === "violated") {
    return {
      label: "Violated",
      questLabel: "Boss fight",
      className: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
    };
  }
  return {
    label: "Untracked",
    questLabel: "Needs telemetry",
    className: "border-edge bg-surface-secondary/50 text-content-muted",
  };
}

export function getDogfoodPresentation(verdict?: "missing" | "watch" | "fail" | "pass" | null) {
  if (verdict === "pass") {
    return {
      label: "Review clear",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (verdict === "watch") {
    return {
      label: "Review watch",
      className: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (verdict === "fail") {
    return {
      label: "Review blocked",
      className: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
    };
  }
  return {
    label: "No review evidence",
    className: "border-edge bg-surface-secondary/50 text-content-muted",
  };
}

export function getInstitutionalVerdictPresentation(
  verdict?: "unmeasured" | "institutional_memory_aligned" | "watch" | "institutional_hallucination_risk" | null,
) {
  if (!verdict || verdict === "unmeasured") {
    return {
      label: "Not measured",
      className: "border-edge bg-surface-secondary/50 text-content-muted",
    };
  }
  if (verdict === "institutional_memory_aligned") {
    return {
      label: "Institutional memory aligned",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (verdict === "institutional_hallucination_risk") {
    return {
      label: "Institutional hallucination risk",
      className: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
    };
  }
  return {
    label: "Watch the loop",
    className: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  };
}

export function formatUsd(value?: number) {
  if (!value) return "$0.00";
  return `$${value.toFixed(2)}`;
}

export function formatCompactNumber(value?: number) {
  if (!value) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

export function formatRelativeTime(timestamp?: number) {
  if (!timestamp) return "Never";
  const diff = Math.max(Date.now() - timestamp, 0);
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function formatDurationCompact(value?: number | null) {
  if (!value || !Number.isFinite(value) || value <= 0) return "n/a";
  if (value < 1000) return `${Math.round(value)}ms`;

  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1)}s`;
  }

  const totalMinutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (totalMinutes < 60) {
    if (remainingSeconds === 0) return `${totalMinutes}m`;
    return `${totalMinutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatGoalReference(goalId?: string | null) {
  if (!goalId) return null;
  const suffix = goalId.length > 6 ? goalId.slice(-6) : goalId;
  return `Goal ref ${suffix}`;
}
