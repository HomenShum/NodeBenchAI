import React, { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { GitPullRequest, CheckCircle, Clock, XCircle, ExternalLink, Lightbulb, RefreshCw, ArrowRight } from "lucide-react";
import { PageHeroHeader } from "../../../shared/ui/PageHeroHeader";

const SUGGESTION_LOAD_TIMEOUT_MS = 15000;

export function PRSuggestions() {
  const navigate = useNavigate();
  const suggestions = useQuery(api.domains.monitoring.industryUpdatesEnhanced.getPRSuggestions, {
    status: undefined,
    limit: 20,
  });
  const [showLoadingTimeout, setShowLoadingTimeout] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = () => {
    setIsRefreshing(true);
    window.setTimeout(() => window.location.reload(), 400);
  };

  useEffect(() => {
    if (suggestions !== undefined) {
      setShowLoadingTimeout(false);
      return;
    }
    const timer = window.setTimeout(() => setShowLoadingTimeout(true), SUGGESTION_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [suggestions]);

  if (suggestions === undefined && !showLoadingTimeout) {
    return (
      <div className="nb-page-shell">
        <div className="nb-page-inner">
          <div className="nb-page-frame">
            <div className="nb-surface-card p-6 space-y-4" aria-busy="true" aria-live="polite">
              <div className="h-7 w-56 rounded-md bg-surface-secondary animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-24 rounded-lg bg-surface-secondary animate-pulse" />
                ))}
              </div>
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-20 rounded-lg bg-surface-secondary animate-pulse" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (suggestions === undefined && showLoadingTimeout) {
    return (
      <div className="nb-page-shell">
        <div className="nb-page-inner">
          <div className="nb-page-frame">
            <div className="nb-surface-card px-6 py-12 text-center">
              <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-edge bg-surface-secondary">
                <RefreshCw className="h-5 w-5 text-content-muted" />
              </div>
              <p className="text-sm font-semibold text-content">Suggestions are taking longer than expected</p>
              <p className="mt-1 text-xs text-content-secondary max-w-md mx-auto">
                The monitoring service is still loading. You can retry now or jump to Industry News and return once updates complete.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className="btn-outline-sm inline-flex items-center gap-1.5"
                  disabled={isRefreshing}
                  onClick={handleRefresh}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "motion-safe:animate-spin" : ""}`} />
                  {isRefreshing ? "Refreshing..." : "Retry"}
                </button>
                <button
                  type="button"
                  className="btn-primary-sm inline-flex items-center gap-1.5"
                  onClick={() => navigate("/industry")}
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  Open Industry News
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pendingSuggestions = suggestions.filter((s: any) => s.status === "pending");
  const approvedSuggestions = suggestions.filter((s: any) => s.status === "approved");
  const implementedSuggestions = suggestions.filter((s: any) => s.status === "implemented");

  return (
    <div className="nb-page-shell">
      <div className="nb-page-inner">
        <div className="nb-page-frame space-y-6 pb-28 sm:pb-20">
          <PageHeroHeader
            icon={<GitPullRequest className="w-5 h-5" />}
            title="Pull Request Suggestions"
            subtitle="Automated pull request suggestions based on industry updates"
          />

          {suggestions.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                icon={<Clock className="w-5 h-5 text-yellow-500" />}
                label="Pending"
                value={pendingSuggestions.length}
                color="yellow"
              />
              <StatCard
                icon={<CheckCircle className="w-5 h-5 text-green-500" />}
                label="Approved"
                value={approvedSuggestions.length}
                color="green"
              />
              <StatCard
                icon={<CheckCircle className="w-5 h-5 text-blue-500" />}
                label="Implemented"
                value={implementedSuggestions.length}
                color="blue"
              />
            </div>
          )}

          {suggestions.length === 0 ? (
            <div className="flex min-h-[calc(100vh-17rem)] flex-col items-center justify-center px-4 py-12 pb-[calc(env(safe-area-inset-bottom,0px)+8.5rem)] text-center sm:min-h-[50vh] sm:pb-16">
              <div className="w-16 h-16 rounded-full bg-surface-secondary flex items-center justify-center mb-4 border border-edge">
                <Lightbulb className="w-8 h-8 text-primary" />
              </div>
              <p className="text-base font-semibold text-content mb-2">No suggestions yet</p>
              <p className="text-sm text-content-secondary max-w-[280px] sm:max-w-sm mb-4">
                Suggestions appear after Industry News collects and prioritizes new signals.
                Scans run automatically on a schedule, so new suggestions may take a minute to appear.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className="btn-primary-sm inline-flex items-center gap-1.5 min-h-10 px-4"
                  onClick={() => navigate("/industry")}
                >
                  <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" />
                  Open Industry News
                </button>
                <button
                  type="button"
                  className="btn-outline-sm inline-flex items-center gap-1.5 min-h-10 px-4"
                  disabled={isRefreshing}
                  onClick={handleRefresh}
                >
                  <RefreshCw className={`w-3.5 h-3.5 flex-shrink-0 ${isRefreshing ? "motion-safe:animate-spin" : ""}`} />
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {suggestions.map((suggestion: any) => (
                <PRCard key={suggestion._id} suggestion={suggestion} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "yellow" | "green" | "blue";
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  const bgColor = {
    yellow: "bg-yellow-500/10",
    green: "bg-green-500/10",
    blue: "bg-blue-500/10",
  }[color];

  return (
    <div className={`${bgColor} rounded-lg border border-edge p-4`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-content-secondary">{label}</span>
      </div>
      <div className="text-2xl font-bold text-content">{value}</div>
    </div>
  );
}

interface PRCardProps {
  suggestion: any;
}

function PRCard({ suggestion }: PRCardProps) {
  const getStatusBadge = (status: string) => {
    const configs = {
      pending: {
        icon: <Clock className="w-4 h-4" />,
        color: "bg-yellow-500/20 text-yellow-600",
        label: "Pending Review",
      },
      approved: {
        icon: <CheckCircle className="w-4 h-4" />,
        color: "bg-green-500/20 text-green-600",
        label: "Approved",
      },
      implemented: {
        icon: <CheckCircle className="w-4 h-4" />,
        color: "bg-blue-500/20 text-blue-600",
        label: "Implemented",
      },
      rejected: {
        icon: <XCircle className="w-4 h-4" />,
        color: "bg-red-500/20 text-red-600",
        label: "Rejected",
      },
    };

    const config = configs[status as keyof typeof configs] || configs.pending;

    return (
      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${config.color}`}>
        {config.icon}
        {config.label}
      </div>
    );
  };

  return (
    <div className="nb-surface-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-content mb-1">
            {suggestion.title}
          </h3>
          <p className="text-sm text-content-secondary">
            {suggestion.description}
          </p>
        </div>
        {getStatusBadge(suggestion.status)}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-content">Key Changes:</h4>
        <ul className="space-y-1.5">
          {suggestion.changes.map((change: string, idx: number) => (
            <li key={idx} className="flex items-start gap-2 text-sm text-content-secondary">
              <span aria-hidden className="text-indigo-600 dark:text-indigo-400 mt-1">•</span>
              <span>{change}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-content">Testing Checklist:</h4>
        <ul className="space-y-1.5">
          {suggestion.testing.map((test: string, idx: number) => (
            <li key={idx} className="flex items-start gap-2 text-sm text-content-secondary">
              <CheckCircle className="w-4 h-4 text-content-muted mt-0.5" />
              <span>{test}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="pt-4 border-t border-edge flex items-center justify-between text-xs text-content-muted">
        <span>
          Created {new Date(suggestion.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </span>
        {suggestion.updateId && (
          <a
            href={`#industry-updates/${suggestion.updateId}`}
            className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            View source update
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}
