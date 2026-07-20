/**
 * FusedSearchResults - Display multi-source search results with facets and attribution
 *
 * Features:
 * - Per-source facet filters (toggle sources on/off)
 * - Source attribution badges with icons
 * - Partial failure warnings with expandable details
 * - Ranked consulted-result presentation
 * - Accessible keyboard navigation and screen reader support
 *
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * STREAMING BEHAVIOR DOCUMENTATION
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 *
 * Current Implementation:
 * - This component receives COMPLETE tool results, not streaming partial results
 * - The fusionSearch action returns a single FusionSearchPayload after all sources complete
 * - Per-source "pending" state is NOT currently implemented at the streaming level
 *
 * Source Status Indicators:
 * - "completed": Source returned results (shown in facet with count > 0)
 * - "failed": Source returned an error (shown in PartialFailureWarning)
 * - "disabled": Source not queried based on mode (not in sourcesQueried)
 * - "pending": NOT IMPLEMENTED - would require streaming partial payloads
 *
 * Future Streaming Support:
 * To implement true streaming with pending indicators, the backend would need to:
 * 1. Emit incremental FusionSearchPayload updates as each source completes
 * 2. Include SourceStreamingStatus[] in the payload (see types.ts)
 * 3. UI would update progressively as partial results arrive
 *
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * RENDER PRECEDENCE
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 *
 * This component is rendered INSTEAD OF the default ToolStep for fusion search tools.
 * See FastAgentPanel.UIMessageBubble.tsx for render precedence logic:
 *
 * 1. Check if tool is fusion search (isFusionSearchTool)
 * 2. If yes AND tool-result: render FusedSearchResults
 * 3. If yes AND tool-call: skip rendering (no spinner shown)
 * 4. If no: render default ToolStep
 *
 * This ensures:
 * - Only ONE representation per tool (no duplicate ToolStep + FusedSearchResults)
 * - Clean UI with results only shown after completion
 *
 * @module FastAgentPanel/FusedSearchResults
 */

import React, { useState, useMemo } from 'react';
import {
  Globe, FileText, Youtube, BookOpen, Newspaper, Database, Building2,
  AlertTriangle, Filter, X, ExternalLink, Clock, ChevronDown, ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TYPES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export const SEARCH_SOURCES = [
  "linkup", "brave", "serper", "tavily", "exa", "sec", "rag",
  "documents", "news", "youtube", "arxiv", "fda", "finra", "uspto",
  "state_registry",
] as const;

export type SearchSource = typeof SEARCH_SOURCES[number];

export function isSearchSource(value: unknown): value is SearchSource {
  return typeof value === "string" && (SEARCH_SOURCES as readonly string[]).includes(value);
}

export interface FusedResult {
  id: string;
  source: SearchSource;
  title: string;
  snippet: string;
  url?: string;
  score: number;
  originalRank: number;
  fusedRank?: number;
  contentType: "text" | "pdf" | "video" | "image" | "filing" | "news" | "patent" | "organization";
  publishedAt?: string;
  author?: string;
  metadata?: Record<string, unknown>;
}

export interface SourceError {
  source: SearchSource;
  error: string;
}

export interface FusedSearchResultsProps {
  results: FusedResult[];
  sourcesQueried: SearchSource[];
  errors?: SourceError[];
  timing?: Record<SearchSource, number>;
  totalTimeMs?: number;
  className?: string;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SOURCE CONFIGURATION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const SOURCE_CONFIG: Record<SearchSource, { icon: React.ElementType; label: string; color: string }> = {
  linkup: { icon: Globe, label: "Web", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" },
  brave: { icon: Globe, label: "Brave", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" },
  serper: { icon: Globe, label: "Google", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" },
  tavily: { icon: Globe, label: "Tavily", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" },
  exa: { icon: Globe, label: "Exa", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" },
  sec: { icon: Building2, label: "SEC", color: "bg-surface-secondary text-content-secondary border-edge" },
  rag: { icon: Database, label: "Internal", color: "bg-surface-secondary text-content-secondary border-edge" },
  documents: { icon: FileText, label: "Docs", color: "bg-green-100 text-green-700 border-green-200" },
  news: { icon: Newspaper, label: "News", color: "bg-red-100 text-red-700 border-red-200" },
  youtube: { icon: Youtube, label: "YouTube", color: "bg-rose-100 text-rose-700 border-rose-200" },
  arxiv: { icon: BookOpen, label: "arXiv", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" },
  fda: { icon: Database, label: "FDA", color: "bg-surface-secondary text-content-secondary border-edge" },
  finra: { icon: Building2, label: "FINRA", color: "bg-surface-secondary text-content-secondary border-edge" },
  uspto: { icon: FileText, label: "USPTO", color: "bg-surface-secondary text-content-secondary border-edge" },
  state_registry: { icon: Building2, label: "State registry", color: "bg-surface-secondary text-content-secondary border-edge" },
};

function safeResultHref(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SUB-COMPONENTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/** Source badge with icon - accessible toggle button */
function SourceBadge({ source, count, active, onClick }: {
  source: SearchSource; count: number; active: boolean; onClick: () => void
}) {
  const config = SOURCE_CONFIG[source];
  const Icon = config.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={(e) => {
        // Support keyboard navigation with Enter and Space
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-pressed={active}
      aria-label={`Filter by ${config.label} source (${count} result${count !== 1 ? 's' : ''})`}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
        active ? config.color : "bg-surface-hover text-content-muted border-edge opacity-50"
      )}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{config.label}</span>
      <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-surface/50 text-xs" aria-label={`${count} results`}>{count}</span>
    </button>
  );
}

/** Partial failure warning banner - accessible alert */
function PartialFailureWarning({ errors }: { errors: SourceError[] }) {
  const [expanded, setExpanded] = useState(false);
  if (errors.length === 0) return null;

  return (
    <div
      className="mb-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20"
      role="alert"
      aria-live="polite"
    >
      {/*
        eslint-disable-next-line jsx-a11y/aria-proptypes
        aria-expanded accepts boolean in React, converted to "true"/"false" string at runtime.
        This is valid per WAI-ARIA 1.2 spec and React's DOM attribute handling.
      */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 text-left focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded"
        aria-expanded={expanded}
        aria-controls="source-error-details"
      >
        <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium text-rose-600">
          {errors.length} source{errors.length > 1 ? 's' : ''} unavailable
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 ml-auto text-rose-600" aria-hidden="true" /> : <ChevronDown className="w-4 h-4 ml-auto text-rose-600" aria-hidden="true" />}
      </button>
      {expanded && (
        <ul id="source-error-details" className="mt-2 space-y-1 text-xs text-rose-600">
          {errors.map((e, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="font-medium">{SOURCE_CONFIG[e.source]?.label || e.source}:</span>
              <span className="truncate">{e.error}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Single result card with source attribution - accessible link card */
function ResultCard({ result }: { result: FusedResult }) {
  const config = SOURCE_CONFIG[result.source];
  const Icon = config.icon;
  const href = safeResultHref(result.url);

  // Build accessible label
  const ariaLabel = `${config.label} result: ${result.title}${result.fusedRank ? `, ranked #${result.fusedRank}` : ''}`;

  const content = (
    <>
      <div className="flex items-start gap-3">
        {/* Source icon */}
        <div className={cn("flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center", config.color.split(' ')[0])} aria-hidden="true">
          <Icon className="w-4 h-4" />
        </div>
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-content truncate group-hover:text-indigo-700 dark:text-indigo-300">{result.title}</h4>
          </div>
          <p className="text-xs text-content-secondary line-clamp-2">{result.snippet}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-content-muted">
            <span className={cn("px-1.5 py-0.5 rounded", config.color)}>{config.label}</span>
            {result.publishedAt && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" aria-hidden="true" />
                <span aria-label={`Published ${result.publishedAt}`}>{result.publishedAt}</span>
              </span>
            )}
            {result.fusedRank !== undefined && <span aria-label={`Fusion rank ${result.fusedRank}`}>Rank #{result.fusedRank}</span>}
          </div>
        </div>
        {href && <ExternalLink className="w-4 h-4 text-content-muted group-hover:text-content-secondary flex-shrink-0" aria-hidden="true" />}
      </div>
    </>
  );

  return href ? (
    <a
      href={href}
      target={href.startsWith('/') ? undefined : "_blank"}
      rel={href.startsWith('/') ? undefined : "noopener noreferrer"}
      aria-label={ariaLabel}
      className="group block p-3 rounded-lg border border-edge hover:shadow-md hover:border-primary/20 transition-all bg-surface focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
    >
      {content}
    </a>
  ) : (
    <div
      aria-label={ariaLabel}
      className="group block p-3 rounded-lg border border-edge bg-surface"
      role="group"
    >
      {content}
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN COMPONENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * FusedSearchResults - Main component for displaying multi-source search results
 */
export function FusedSearchResults({
  results,
  sourcesQueried,
  errors = [],
  timing,
  totalTimeMs,
  className,
}: FusedSearchResultsProps) {
  // Props originate at a runtime boundary despite their static types. Unknown
  // sources are omitted rather than indexing an absent presentation config.
  const safeSources = useMemo(
    () => [...new Set(sourcesQueried.filter(isSearchSource))],
    [sourcesQueried],
  );
  const safeResults = useMemo(
    () => results.filter((result) =>
      isSearchSource(result?.source) &&
      typeof result.id === 'string' && result.id.trim().length > 0 &&
      typeof result.title === 'string' && result.title.trim().length > 0
    ),
    [results],
  );
  const safeErrors = useMemo(
    () => errors.filter((error) =>
      isSearchSource(error?.source) &&
      typeof error.error === 'string' && error.error.trim().length > 0
    ),
    [errors],
  );

  // Track which sources are active (for filtering)
  const [activeSources, setActiveSources] = useState<Set<SearchSource>>(new Set(safeSources));
  const [showAll, setShowAll] = useState(false);
  const INITIAL_COUNT = 10;

  // Count results per source
  const sourceCounts = useMemo(() => {
    const counts: Record<SearchSource, number> = {} as any;
    for (const r of safeResults) {
      counts[r.source] = (counts[r.source] || 0) + 1;
    }
    return counts;
  }, [safeResults]);

  // Filter results by active sources
  const filteredResults = useMemo(() => {
    return safeResults.filter(r => activeSources.has(r.source));
  }, [safeResults, activeSources]);

  const displayedResults = showAll ? filteredResults : filteredResults.slice(0, INITIAL_COUNT);
  const hasMore = filteredResults.length > INITIAL_COUNT;

  // Toggle source filter
  const toggleSource = (source: SearchSource) => {
    setActiveSources(prev => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  };

  // Reset filters
  const resetFilters = () => setActiveSources(new Set(safeSources));

  if (safeResults.length === 0 && safeErrors.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Partial failure warning */}
      <PartialFailureWarning errors={safeErrors} />

      {/* Header with timing */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-content-secondary" />
          <span className="text-sm font-medium text-content">
            {filteredResults.length} result{filteredResults.length !== 1 ? 's' : ''}
          </span>
          {activeSources.size < safeSources.length && (
            <button type="button" onClick={resetFilters} className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 hover:underline flex items-center gap-1">
              <X className="w-3 h-3" /> Reset filters
            </button>
          )}
        </div>
        {totalTimeMs && (
          <span className="text-xs text-content-muted flex items-center gap-1">
            <Clock className="w-3 h-3" /> {(totalTimeMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* Source facets - accessible filter group */}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Filter results by source"
      >
        {safeSources.map(source => (
          <SourceBadge
            key={source}
            source={source}
            count={sourceCounts[source] || 0}
            active={activeSources.has(source)}
            onClick={() => toggleSource(source)}
          />
        ))}
      </div>

      {/* Results list - accessible list */}
      <div
        className="space-y-2"
        role="list"
        aria-label="Search results"
      >
        {displayedResults.map((result, idx) => (
          <div key={`${result.id}-${idx}`} role="listitem">
            <ResultCard
              result={result}
            />
          </div>
        ))}
      </div>

      {/*
        Show more button - accessible
        eslint-disable-next-line jsx-a11y/aria-proptypes
        aria-expanded boolean is valid in React, per WAI-ARIA 1.2
      */}
      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="w-full py-2 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 font-medium flex items-center justify-center gap-1 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded"
          aria-expanded={showAll}
          aria-label={showAll ? "Show fewer results" : `Show ${filteredResults.length - INITIAL_COUNT} more results`}
        >
          {showAll ? (
            <><ChevronUp className="w-4 h-4" aria-hidden="true" /> Show less</>
          ) : (
            <><ChevronDown className="w-4 h-4" aria-hidden="true" /> Show {filteredResults.length - INITIAL_COUNT} more</>
          )}
        </button>
      )}
    </div>
  );
}
