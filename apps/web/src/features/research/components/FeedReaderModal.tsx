import React, { useMemo, useState } from "react";
import { X, ExternalLink, Calendar, Tag, Sparkles, MessageSquare, Copy } from "lucide-react";
import { useFastAgent } from "@/features/agents/context/FastAgentContext";
import { useReaderContent } from "@/features/research/hooks/useReaderContent";
import RepoStatsPanel from "./RepoStatsPanel";
import PaperDetailsCard from "./PaperDetailsCard";
import ModelComparisonTable from "./ModelComparisonTable";
import StackImpactPanel from "./StackImpactPanel";
import CostCrossoverCalculator from "./CostCrossoverCalculator";
import SignalTimeseriesPanel from "./SignalTimeseriesPanel";
import RepoSignalPanel from "./RepoSignalPanel";
import StrategyMetricsPanel from "./StrategyMetricsPanel";
import { DialogOverlay } from "@/shared/components/DialogOverlay";

export interface ReaderItem {
  id?: string;
  type?: string;
  title: string;
  subtitle?: string;
  timestamp?: string;
  tags?: string[];
  url?: string;
  source?: string;
  metrics?: Array<{ label: string; value: string; trend?: "up" | "down" }>;
  raw?: Record<string, unknown> | null;
}

interface FeedReaderModalProps {
  item: ReaderItem | null;
  onClose: () => void;
  techStack?: string[];
}

export const FeedReaderModal: React.FC<FeedReaderModalProps> = ({ item, onClose, techStack = [] }) => {
  const { openWithContext } = useFastAgent();
  const readerState = useReaderContent(item?.url, item?.title);
  const [deepDiveTab, setDeepDiveTab] = useState<"summary" | "data" | "timeline">("summary");

  const readerData = readerState.status === "ready" ? readerState.data : null;
  const safeTitle = item?.title ?? "";
  const safeSubtitle = item?.subtitle ?? "";
  const safeTags = item?.tags ?? [];
  const safeTimestamp = item?.timestamp ?? "";
  const safeMetrics = item?.metrics ?? [];
  const safeUrl = item?.url ?? "";
  const safeSource = item?.source ?? "";
  const readerExcerpt = readerData?.excerpt || safeSubtitle || "No preview available for this item.";
  const readerContent = readerData?.content || readerExcerpt;
  const sourceMatrix = readerData?.sourceMatrix ?? [];
  const sourceMatrixItems = sourceMatrix.slice(0, 6);
  const showLoading = readerState.status === "loading";
  const showError = readerState.status === "error";
  const errorMessage = readerState.status === "error" ? readerState.error : null;
  const tags = safeTags;
  const timestamp = safeTimestamp;
  const metrics = safeMetrics;

  const normalizedText = `${safeTitle} ${safeSubtitle} ${tags.join(" ")}`.toLowerCase();
  const itemType = item?.type ?? "";
  const isGitHub = safeUrl.includes("github.com") || safeSource.toLowerCase() === "github" || tags.some((tag) => tag.toLowerCase() === "github");
  const isArxiv = safeUrl.includes("arxiv.org") || safeSource.toLowerCase().includes("arxiv") || tags.some((tag) => tag.toLowerCase() === "arxiv");
  const isResearch = isArxiv || /study|paper|journal|research|neuroscience|clinical|trial/.test(normalizedText) || safeSource.toLowerCase().includes("nature");
  const isSecurity = /cve|vulnerability|security|breach|exploit|outage|vpn|proxy|geo-?block|ban|walled garden|mquickjs|quickjs/.test(normalizedText);
  const isCost = /cost|pricing|token|inference|budget|compute|crossover|decoupling|on-?prem|cloud/.test(normalizedText);
  const isModelRelease = /model|release|launch|gemini|claude|gpt|llama/.test(normalizedText);
  const isStrategy = /pivot|strategy|augmentation|agentforce|salesforce|churn|retention/.test(normalizedText);
  const showCostCrossover = isCost || isModelRelease;
  const showRepoScout = isGitHub || itemType === "repo" || /agentic|ecosystem|moat|open source|repo|github|salesforce/.test(normalizedText);

  const modelKey = useMemo(() => {
    const lower = normalizedText;
    if (lower.includes("gemini")) return "gemini";
    if (lower.includes("claude")) return "claude";
    if (lower.includes("gpt") || lower.includes("openai")) return "gpt";
    if (lower.includes("llama")) return "llama";
    const fallback = safeTitle.split(" ").find((word) => word.length > 3) || safeTitle || "model";
    return fallback;
  }, [safeTitle, normalizedText]);

  const signalKeyword = useMemo(() => {
    const cveMatch = `${safeTitle} ${safeSubtitle}`.match(/CVE-\d{4}-\d{4,7}/i);
    if (cveMatch?.[0]) return cveMatch[0].toUpperCase();

    const repoMatch = safeTitle.match(/([\w.-]+\/([\w.-]+))/);
    if (repoMatch?.[2]) return repoMatch[2];

    const tagStop = new Set([
      "ai",
      "ml",
      "research",
      "tech",
      "news",
      "trending",
      "startup",
      "startups",
      "funding",
      "series",
      "seed",
    ]);
    const preferredTag = tags.find((tag) => {
      const t = tag.toLowerCase();
      return t.length > 3 && !tagStop.has(t);
    });
    if (preferredTag) return preferredTag;

    const stop = new Set(["the", "and", "with", "from", "into", "over", "new", "launch", "release", "announces", "announced"]);
    const words = safeTitle
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z0-9-]/gi, ""))
      .filter(Boolean);
    const candidate = words.find((word) => word.length > 3 && !stop.has(word.toLowerCase()));
    return candidate || safeTitle.split(" ")[0] || "signal";
  }, [safeSubtitle, safeTitle, tags]);

  const rawPayload = useMemo(() => {
    const payload = {
      item: item?.raw ?? item ?? null,
      reader: readerData ?? null,
    };
    return JSON.stringify(payload, null, 2).slice(0, 6000);
  }, [item, readerData]);

  if (!item) return null;

  const handleAskAgent = () => {
    openWithContext({
      initialMessage: `Analyze this article: "${item.title}".\n\nContent Context: ${item.subtitle ?? ""}`,
      contextWebUrls: item.url ? [item.url] : undefined,
      contextTitle: item.title,
    });
  };

  const copyLink = () => {
    if (item.url && navigator?.clipboard) {
      void navigator.clipboard.writeText(item.url);
    }
  };

  return (
    <DialogOverlay
      isOpen={Boolean(item)}
      onClose={onClose}
      ariaLabel={safeTitle ? `Read ${safeTitle}` : "Feed reader"}
      positionClassName="z-[100] p-4 sm:p-6"
      backdropClassName="z-[100] bg-black/30"
      contentClassName="w-full max-w-6xl"
    >
      <div
        className="relative w-full max-w-6xl h-[90vh] bg-surface rounded-lg shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 ring-1 ring-white/10 pointer-events-auto"
        aria-labelledby="feed-reader-modal-title"
      >
        <div className="px-8 py-5 border-b border-edge flex items-center justify-between bg-surface z-10">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-2.5 py-1 bg-surface-secondary border border-edge rounded-md">
              {item.source === "GitHub" ? <div className="w-2 h-2 bg-black rounded-full" /> : <div className="w-2 h-2 bg-orange-500 rounded-full" />}
              <span className="text-xs font-bold text-content">{item.source || "News"}</span>
            </div>
            <span className="text-[color:var(--border-color)]">|</span>
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-content-secondary hover:text-blue-600 flex items-center gap-1.5 transition-colors"
              >
                View Original <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <span className="text-xs text-content-secondary hidden lg:inline">Click anywhere to dismiss (Esc)</span>
          </div>

          <div className="flex items-center gap-2">
            {item.url && (
              <button
                className="p-2 text-content-secondary hover:text-content hover:bg-surface-secondary rounded-full transition-colors"
                title="Copy Link"
                onClick={copyLink}
              >
                <Copy className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} className="p-2 text-content-secondary hover:text-red-500 hover:bg-red-50 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-surface">
          <div className="max-w-6xl mx-auto px-6 lg:px-8 py-10">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-10">
              <div>
                <div className="flex items-center gap-4 text-sm text-content-secondary mb-6 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" /> {timestamp}
                  </span>
                  {tags.length > 0 && (
                    <>
                      <span className="text-[color:var(--border-color)]">|</span>
                      <div className="flex gap-2 flex-wrap">
                        {tags.map((tag) => (
                          <span key={tag} className="flex items-center gap-1 text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-xs">
                            <Tag className="w-3 h-3" /> {tag.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <h1 id="feed-reader-modal-title" className="text-2xl md:text-3xl font-bold text-content leading-tight mb-8">{item.title}</h1>

                <div className="prose prose-lg prose-gray max-w-none leading-relaxed text-content">
                  <p className="text-xl leading-relaxed text-content font-sans mb-8 border-l-4 border-blue-500 pl-6 italic">
                    {readerExcerpt}
                  </p>

                  {showLoading && (
                    <div className="p-4 bg-surface-secondary rounded-lg border border-dashed border-edge text-center">
                      <p className="text-sm text-content-secondary">Loading full article content...</p>
                    </div>
                  )}

                  {showError && (
                    <div className="p-4 bg-red-50 rounded-lg border border-red-200 text-center">
                      <p className="text-sm text-red-600">{errorMessage}</p>
                    </div>
                  )}

                  {readerState.status === "ready" && (
                    <div className="space-y-5">
                      <p>{readerContent}</p>
                      {readerData?.isTruncated && item.url && (
                        <div className="text-xs text-content-secondary">
                          Full text trimmed for size.{" "}
                          <button
                            onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
                            className="text-blue-600 hover:text-blue-700 font-medium"
                          >
                            Open original
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {readerState.status === "ready" && (
                    <div className="mt-10 pt-6 border-t border-edge">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-xs font-semibold text-content-secondary">Source Matrix</span>
                        <span className="text-xs text-content-secondary">{sourceMatrix.length} sources</span>
                      </div>
                      {sourceMatrixItems.length > 0 ? (
                        <div className="space-y-3">
                          {sourceMatrixItems.map((source, idx) => (
                            <a
                              key={`${source.url}-${idx}`}
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block rounded-lg border border-edge bg-surface-secondary px-4 py-3 hover:border-blue-200 hover:bg-surface transition-colors"
                            >
                              <div className="text-sm font-semibold text-content">{source.title}</div>
                              <div className="text-xs text-content-secondary mt-1">{source.domain || "Source"}</div>
                              {source.snippet && (
                                <div className="text-xs text-content-secondary mt-2 line-clamp-2">{source.snippet}</div>
                              )}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-content-secondary">No additional sources available.</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-4">
                {signalKeyword && <SignalTimeseriesPanel keyword={signalKeyword} />}
                {showRepoScout && <RepoSignalPanel title={item.title} summary={item.subtitle} url={item.url} />}
                {isGitHub && item.url && <RepoStatsPanel repoUrl={item.url} />}
                {isResearch && item.url && <PaperDetailsCard url={item.url} title={item.title} />}
                {isModelRelease && <ModelComparisonTable modelKey={modelKey} context={item.title} />}
                {isSecurity && (
                  <StackImpactPanel
                    title={item.title}
                    summary={item.subtitle}
                    url={item.url}
                    techStack={techStack}
                  />
                )}
                {isStrategy && <StrategyMetricsPanel title={item.title} summary={item.subtitle} url={item.url} />}
                {showCostCrossover && <CostCrossoverCalculator />}

                <div className="rounded-lg border border-edge bg-surface p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-content-muted">Deep dive</div>
                      <div className="text-sm font-semibold text-content">Raw data + timeline</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-content-muted">
                      {(["summary", "data", "timeline"] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setDeepDiveTab(tab)}
                          className={`px-2 py-1 border ${deepDiveTab === tab
                            ? "border-gray-900 text-content"
                            : "border-edge text-content-muted hover:text-content"
                            }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>
                  </div>

                  {deepDiveTab === "summary" && (
                    <div className="space-y-3 text-xs text-content-secondary">
                      <div className="flex flex-wrap gap-2">
                        {tags.length > 0 ? (
                          tags.map((tag) => (
                            <span key={`tag-${tag}`} className="px-2 py-0.5 border border-edge dark:border-white/10 bg-surface-secondary dark:text-gray-300">
                              {tag.replace(/_/g, ' ')}
                            </span>
                          ))
                        ) : (
                          <span className="text-content-muted">No tags.</span>
                        )}
                      </div>
                      {metrics.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs text-content-muted">Metrics</div>
                          <div className="grid grid-cols-2 gap-2">
                            {metrics.slice(0, 4).map((metric) => (
                              <div key={metric.label} className="rounded-md border border-edge bg-surface-secondary p-2">
                                <div className="text-xs text-content-muted">{metric.label}</div>
                                <div className="text-sm font-semibold text-content">{metric.value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-md border border-edge bg-surface-secondary p-2">
                          <div className="text-xs text-content-muted">Source</div>
                          <div className="text-sm font-semibold text-content">{item.source || "n/a"}</div>
                        </div>
                        <div className="rounded-md border border-edge bg-surface-secondary p-2">
                          <div className="text-xs text-content-muted">Timestamp</div>
                          <div className="text-sm font-semibold text-content">{timestamp || "n/a"}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {deepDiveTab === "data" && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-xs text-content-secondary">
                        <div className="rounded-md border border-edge bg-surface-secondary p-2">
                          <div className=" text-content-muted">Content bytes</div>
                          <div className="text-sm font-semibold text-content">{readerData?.contentBytes ?? "n/a"}</div>
                        </div>
                        <div className="rounded-md border border-edge bg-surface-secondary p-2">
                          <div className=" text-content-muted">Sources</div>
                          <div className="text-sm font-semibold text-content">{sourceMatrix.length}</div>
                        </div>
                      </div>
                      {sourceMatrixItems.length > 0 && (
                        <div className="max-h-40 overflow-auto border border-edge rounded-md">
                          <table className="w-full text-xs text-left">
                            <thead className="sticky top-0 bg-surface-secondary text-content-muted uppercase tracking-wider">
                              <tr>
                                <th className="px-2 py-1">Source</th>
                                <th className="px-2 py-1">Domain</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sourceMatrixItems.map((source, idx) => (
                                <tr key={`${source.url}-${idx}`} className="border-t border-edge">
                                  <td className="px-2 py-1 text-content-secondary">{source.title}</td>
                                  <td className="px-2 py-1 text-content-secondary">{source.domain || "n/a"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <pre className="text-xs text-content-secondary bg-surface-secondary border border-edge rounded-md p-3 overflow-auto max-h-64">
                        {rawPayload}
                      </pre>
                    </div>
                  )}

                  {deepDiveTab === "timeline" && (
                    <div className="space-y-3 text-xs text-content-secondary">
                      <div className="text-xs text-content-muted">Source matrix</div>
                      {sourceMatrixItems.length > 0 ? (
                        <div className="space-y-2">
                          {sourceMatrixItems.map((source, idx) => (
                            <button
                              key={`${source.url}-${idx}`}
                              type="button"
                              onClick={() => {
                                if (source.url) window.open(source.url, "_blank", "noopener,noreferrer");
                              }}
                              className="w-full text-left rounded-md border border-edge bg-surface px-3 py-2 hover:border-content transition-colors"
                            >
                              <div className="text-xs font-semibold text-content">{source.title}</div>
                              <div className="text-xs text-content-muted">{source.domain || "Source"}</div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="text-content-muted">No source matrix entries.</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-edge bg-surface-secondary/80 px-8 py-4">
          <div className="max-w-6xl mx-auto flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-600 to-blue-600 flex items-center justify-center shadow-lg">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
              <div className="text-xs font-semibold text-content-secondary mb-1 ml-1">AI ANALYST</div>
              <div className="flex gap-2 flex-col sm:flex-row">
                <button
                  onClick={handleAskAgent}
                  className="flex-1 flex items-center justify-between px-4 py-2.5 bg-surface border border-edge hover:border-purple-300 hover:text-purple-700 rounded-lg text-sm text-content transition-all text-left group"
                >
                  <span>Summarize key risks...</span>
                  <MessageSquare className="w-4 h-4 text-[color:var(--border-color)] group-hover:text-purple-400" />
                </button>
                <button
                  onClick={handleAskAgent}
                  className="flex-1 flex items-center justify-between px-4 py-2.5 bg-surface border border-edge hover:border-blue-300 hover:text-blue-700 rounded-lg text-sm text-content transition-all text-left group"
                >
                  <span>Compare with competitors...</span>
                  <MessageSquare className="w-4 h-4 text-[color:var(--border-color)] group-hover:text-blue-400" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DialogOverlay>
  );
};

export default FeedReaderModal;
