/**
 * Industry Updates Panel
 *
 * Displays recent updates from Anthropic, OpenAI, Google DeepMind, LangChain, and Vercel AI SDK.
 * Shows actionable insights and implementation suggestions.
 */

import React, { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { toast } from "sonner";
import {
  TrendingUp,
  ExternalLink,
  Lightbulb,
  Code,
  CheckCircle,
  Clock3,
  Filter,
} from "lucide-react";
import { ViewSkeleton } from "../../../components/skeletons";
import { PageHeroHeader } from "../../../shared/ui/PageHeroHeader";

const providers = ["anthropic", "openai", "google", "langchain", "vercel", "xai"];

const providerLabels: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google DeepMind",
  langchain: "LangChain",
  vercel: "Vercel AI SDK",
  xai: "xAI",
};

export function IndustryUpdatesPanel() {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const suggestions = useQuery(api.domains.monitoring.industryUpdates.getImplementationSuggestions);

  // Hooks must be called before any conditional returns
  const filteredSuggestions = useMemo(() => {
    if (!suggestions) return [];
    return selectedProvider
      ? suggestions.topSuggestions.filter((s: any) => s.provider === providerLabels[selectedProvider])
      : suggestions.topSuggestions;
  }, [selectedProvider, suggestions]);

  if (!suggestions) {
    return <ViewSkeleton variant="industry-updates" />;
  }

  return (
    <div className="nb-page-shell">
      <div className="nb-page-inner">
        <div className="nb-page-frame space-y-6">
          <PageHeroHeader
        icon={<TrendingUp className="w-5 h-5" />}
        title="Industry News"
        subtitle="What's new from AI leaders - refreshed daily"
        date={suggestions.totalNew > 0 ? (
          <div className="flex items-center gap-2 px-4 py-2 bg-surface-secondary rounded-lg">
            <div className="w-2 h-2 bg-green-500 rounded-full motion-safe:animate-pulse" />
            <span className="text-sm font-medium text-content">
              {suggestions.totalNew} new {suggestions.totalNew === 1 ? 'update' : 'updates'}
            </span>
          </div>
        ) : undefined}
      />

          {/* Provider Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-content-secondary" />
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSelectedProvider(null)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${
                  selectedProvider === null
                    ? "bg-[var(--accent-primary)] text-white border-transparent font-semibold shadow-sm ring-2 ring-[var(--accent-primary)]/30"
                    : "bg-surface-secondary text-content-secondary border-edge hover:text-content hover:bg-surface"
                }`}
              >
                All
              </button>
              {providers.map((provider) => (
                <button
                  key={provider}
                  onClick={() => setSelectedProvider(provider)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors border ${
                    selectedProvider === provider
                      ? "bg-[var(--accent-primary)] text-white border-transparent"
                      : "bg-surface-secondary text-content-secondary border-edge hover:text-content hover:bg-surface"
                  }`}
                >
                  {providerLabels[provider]}
                  {suggestions.byProvider[providerLabels[provider]] && (
                    <span className="ml-1.5 px-1.5 py-0.5 bg-[var(--accent-primary)] text-white rounded text-xs">
                      {suggestions.byProvider[providerLabels[provider]].length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Updates List */}
          {filteredSuggestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-edge bg-surface-secondary">
                <Clock3 className="h-8 w-8 text-content-secondary" />
              </div>
              {selectedProvider ? (
                <>
                  <p className="text-base font-semibold text-content mb-2">No updates for this provider</p>
                  <p className="text-sm text-content-secondary max-w-sm">Select a different provider or clear the filter to see all industry news.</p>
                </>
              ) : (
                <>
                  <p className="text-base font-semibold text-content mb-2">Industry news arrives daily</p>
                  <p className="text-sm text-content-secondary max-w-xs">Updates from major AI providers are collected automatically. Select a provider above to filter, or check back tomorrow.</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSuggestions.map((update: any) => (
                <UpdateCard key={update.id} update={update} />
              ))}
            </div>
          )}

          {/* Summary Stats */}
          {suggestions.totalNew > 0 && (
            <div className="nb-surface-card mt-8 p-4">
              <h3 className="type-section-title text-content mb-3">
                Summary by Provider
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {providers.map((provider) => {
                  const count = suggestions.byProvider[providerLabels[provider]]?.length || 0;
                  return (
                    <div key={provider} className="text-center">
                      <div className="text-2xl font-bold text-content">
                        {count}
                      </div>
                      <div className="text-xs text-content-secondary mt-1">
                        {providerLabels[provider]}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper component for update cards
interface UpdateCardProps {
  update: {
    id: string;
    provider: string;
    title: string;
    summary: string;
    relevance: number;
    actionableInsights: string[];
    implementationSuggestions: string[];
    url: string;
    scannedAt: number;
    status?: "new" | "reviewed" | "implemented";
  };
}

const UpdateCard = React.memo(function UpdateCard({ update }: UpdateCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const markAsReviewed = useMutation(api.domains.monitoring.industryUpdates.markAsReviewed);
  const markAsImplemented = useMutation(api.domains.monitoring.industryUpdates.markAsImplemented);

  const handleMarkReviewed = async () => {
    setIsUpdating(true);
    try {
      await markAsReviewed({ findingId: update.id as any });
      toast.success("Marked as reviewed");
    } catch (error) {
      console.error("Failed to mark as reviewed:", error);
      toast.error("Failed to update status");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleMarkImplemented = async () => {
    setIsUpdating(true);
    try {
      await markAsImplemented({ findingId: update.id as any });
      toast.success("Marked as implemented");
    } catch (error) {
      console.error("Failed to mark as implemented:", error);
      toast.error("Failed to update status");
    } finally {
      setIsUpdating(false);
    }
  };

  const relevanceColor =
    update.relevance >= 80 ? "text-green-500" :
    update.relevance >= 60 ? "text-yellow-500" :
    "text-content-secondary";

  const relevanceLabel =
    update.relevance >= 80 ? "High" :
    update.relevance >= 60 ? "Medium" :
    "Low";

  return (
    <div className="nb-surface-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 bg-[var(--accent-primary)] text-white text-xs font-medium rounded">
              {update.provider}
            </span>
            <div className={`flex items-center gap-1 ${relevanceColor}`}>
              <div className="w-2 h-2 rounded-full bg-current" />
              <span className="text-xs font-medium">{relevanceLabel} Relevance</span>
            </div>
            {update.status && update.status !== "new" && (
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                update.status === "implemented"
                  ? "bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]"
                  : "bg-green-100 text-green-700"
              }`}>
                {update.status === "implemented" ? "Implemented" : "Reviewed"}
              </span>
            )}
            <span className="text-xs text-content-muted">
              {new Date(update.scannedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
          <h3 className="text-lg font-semibold text-content mb-2">
            {update.title}
          </h3>
          <p className="text-sm text-content-secondary leading-relaxed">
            {update.summary}
          </p>
        </div>
        <a
          href={update.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] hover:bg-[var(--accent-primary-bg)] rounded-md transition-colors"
        >
          View Source
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Actionable Insights */}
      {update.actionableInsights.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-sm font-semibold text-content hover:text-[var(--accent-primary)] transition-colors"
          >
            <Lightbulb className="w-4 h-4" />
            Key Insights ({update.actionableInsights.length})
            <span className="ml-1">{expanded ? "▼" : "▶"}</span>
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1.5 ml-6">
              {update.actionableInsights.map((insight: string, idx: number) => (
                <li key={idx} className="text-sm text-content-secondary list-disc">
                  {insight}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Implementation Suggestions */}
      {expanded && update.implementationSuggestions.length > 0 && (
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-content mb-2">
            <Code className="w-4 h-4" />
            Implementation Suggestions
          </div>
          <ul className="space-y-1.5 ml-6">
            {update.implementationSuggestions.map((suggestion: string, idx: number) => (
              <li key={idx} className="text-sm text-content-secondary list-disc">
                {suggestion}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      {expanded && (
        <div className="flex items-center gap-2 pt-2 border-t border-edge">
          <button
            type="button"
            onClick={handleMarkReviewed}
            disabled={isUpdating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle className="w-4 h-4" />
            {isUpdating ? "Updating..." : "Mark as Reviewed"}
          </button>
          <button
            type="button"
            onClick={handleMarkImplemented}
            disabled={isUpdating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-[var(--accent-primary)] text-white rounded-md hover:bg-[var(--accent-primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Code className="w-4 h-4" />
            {isUpdating ? "Updating..." : "Mark as Implemented"}
          </button>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => prevProps.update.id === nextProps.update.id && prevProps.update.status === nextProps.update.status);

export default IndustryUpdatesPanel;
