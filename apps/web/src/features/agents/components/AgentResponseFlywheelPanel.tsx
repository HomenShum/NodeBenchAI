import React from "react";
import { AlertTriangle, CheckCircle2, GitBranch, Link2, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "./oracleControlTowerUtils";

interface AgentResponseFlywheelSnapshot {
  summary: {
    totalReviews: number;
    passCount: number;
    watchCount: number;
    failCount: number;
    passRate: number;
    averageOverallScore: number;
    weakestDimension: null | {
      key: string;
      label: string;
      averageScore: number;
    };
    strongestDimension: null | {
      key: string;
      label: string;
      averageScore: number;
    };
    hottestQuestionCategory: null | {
      key: string;
      label: string;
      count: number;
    };
    latestReviewedAt: number | null;
  };
  dimensions: Array<{
    key: string;
    label: string;
    averageScore: number;
    status: "strong" | "watch" | "weak";
  }>;
  categories: Array<{
    key: string;
    label: string;
    count: number;
    outputVariables: string[];
  }>;
  recentFindings: Array<{
    reviewKey: string;
    messageId: string;
    promptSummary: string;
    status: "pass" | "watch" | "fail";
    overallScore: number;
    matchedCategoryKeys: string[];
    weaknesses: string[];
    recommendations: string[];
    reviewedAt: number;
  }>;
}

export function AgentResponseFlywheelPanel({
  snapshot,
}: {
  snapshot: AgentResponseFlywheelSnapshot | null | undefined;
}) {
  if (!snapshot) {
    return null;
  }

  const weakestTone =
    snapshot.summary.weakestDimension?.averageScore !== undefined &&
    snapshot.summary.weakestDimension.averageScore < 0.58
      ? "text-red-400"
      : "text-amber-400";

  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-content">Agent response flywheel</div>
          <div className="mt-1 text-xs text-content-muted">
            Deterministic review of real assistant replies, routed through the question lanes the system is supposed to answer.
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-content-muted">Pass rate</div>
          <div className="text-lg font-semibold text-content">{Math.round(snapshot.summary.passRate * 100)}%</div>
        </div>
      </div>

      {snapshot.summary.totalReviews === 0 ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-content-secondary">
          <RefreshCcw className="h-4 w-4 text-content-muted" />
          No reviewed agent responses yet. New completed replies will start populating this lane.
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-edge bg-background/40 p-3">
              <div className="type-label">Coverage</div>
              <div className="mt-2 text-2xl font-semibold text-content">{snapshot.summary.totalReviews}</div>
              <div className="mt-1 text-xs text-content-secondary">
                {snapshot.summary.passCount} pass, {snapshot.summary.watchCount} watch, {snapshot.summary.failCount} fail
              </div>
            </div>
            <div className="rounded-lg border border-edge bg-background/40 p-3">
              <div className="type-label">Weakest lane</div>
              <div className={cn("mt-2 text-sm font-semibold", weakestTone)}>
                {snapshot.summary.weakestDimension?.label ?? "Not enough data"}
              </div>
              <div className="mt-1 text-xs text-content-secondary">
                {snapshot.summary.weakestDimension
                  ? `${Math.round(snapshot.summary.weakestDimension.averageScore * 100)}% average`
                  : "No recent reviews"}
              </div>
            </div>
            <div className="rounded-lg border border-edge bg-background/40 p-3">
              <div className="type-label">Hottest question lane</div>
              <div className="mt-2 text-sm font-semibold text-content">
                {snapshot.summary.hottestQuestionCategory?.label ?? "Not enough data"}
              </div>
              <div className="mt-1 text-xs text-content-secondary">
                {snapshot.summary.hottestQuestionCategory
                  ? `${snapshot.summary.hottestQuestionCategory.count} recent replies`
                  : "No routed categories yet"}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-edge bg-background/40 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-content">
                <GitBranch className="h-4 w-4 text-blue-400" />
                Dimension health
              </div>
              <div className="mt-3 space-y-2">
                {snapshot.dimensions.slice(0, 4).map((dimension) => (
                  <div key={dimension.key} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-content-secondary">{dimension.label}</span>
                    <span
                      className={cn(
                        "font-semibold",
                        dimension.status === "strong"
                          ? "text-emerald-400"
                          : dimension.status === "watch"
                            ? "text-amber-400"
                            : "text-red-400",
                      )}
                    >
                      {Math.round(dimension.averageScore * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-edge bg-background/40 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-content">
                <Link2 className="h-4 w-4 text-violet-400" />
                Routed question lanes
              </div>
              <div className="mt-3 space-y-2">
                {snapshot.categories
                  .filter((category) => category.count > 0)
                  .slice(0, 4)
                  .map((category) => (
                    <div key={category.key} className="rounded-md border border-edge bg-surface px-2 py-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-content">{category.label}</span>
                        <span className="text-content-muted">{category.count}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-content-muted">
                        {category.outputVariables.slice(0, 3).join(", ")}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-sm font-medium text-content">Recent findings</div>
            <div className="mt-3 space-y-2">
              {snapshot.recentFindings.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-content-secondary">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  No recent findings yet.
                </div>
              ) : (
                snapshot.recentFindings.slice(0, 3).map((finding) => (
                  <div key={finding.reviewKey} className="rounded-lg border border-edge bg-background/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-content">{finding.promptSummary || "Assistant response review"}</div>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          finding.status === "pass"
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                            : finding.status === "watch"
                              ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                              : "border-red-500/20 bg-red-500/10 text-red-300",
                        )}
                      >
                        {finding.status} {Math.round(finding.overallScore * 100)}%
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-content-muted">
                      Reviewed {formatRelativeTime(finding.reviewedAt)}
                    </div>
                    {finding.weaknesses.length > 0 ? (
                      <div className="mt-2 flex items-start gap-2 text-xs text-content-secondary">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                        <span>{finding.weaknesses[0]}</span>
                      </div>
                    ) : null}
                    {finding.recommendations.length > 0 ? (
                      <div className="mt-2 text-xs text-content-secondary">
                        Next fix: {finding.recommendations[0]}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
