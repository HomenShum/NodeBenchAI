// src/components/artifacts/SourcesLibrary.tsx
// Global sources library view - shows all artifacts in footer
// Pinned artifacts first, grouped by provider/kind

import { useMemo, useState } from "react";
import {
  ExternalLink,
  Play,
  FileText,
  Image as ImageIcon,
  User,
  Building2,
  Globe,
  Pin,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Library,
  Filter,
} from "lucide-react";
import type { ArtifactCard, ArtifactKind, ArtifactProvider } from "../../shared/artifacts";
import { useAllArtifacts, useUnassignedArtifacts } from "../../hooks/useArtifactStore";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface SourcesLibraryProps {
  /** Show only unassigned artifacts (default: false - show all) */
  unassignedOnly?: boolean;

  /** Maximum items to show initially (default: 12) */
  initialVisible?: number;

  /** Collapse by default */
  defaultCollapsed?: boolean;

  /** Title override */
  title?: string;
}

type GroupBy = "provider" | "kind" | "none";

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function getKindIcon(kind: ArtifactKind) {
  switch (kind) {
    case "video": return <Play className="w-4 h-4" />;
    case "image": return <ImageIcon className="w-4 h-4" />;
    case "sec": return <FileText className="w-4 h-4" />;
    case "person": return <User className="w-4 h-4" />;
    case "company": return <Building2 className="w-4 h-4" />;
    case "document": return <FileText className="w-4 h-4" />;
    default: return <Globe className="w-4 h-4" />;
  }
}

function getProviderColor(provider: ArtifactProvider | undefined): string {
  switch (provider) {
    case "youtube": return "bg-slate-50/50 dark:bg-slate-500/5 text-slate-600 dark:text-slate-400 border-slate-100 dark:border-slate-900/30";
    case "sec": return "bg-slate-50/50 dark:bg-slate-500/5 text-slate-600 dark:text-slate-400 border-slate-100 dark:border-slate-900/30";
    case "twitter": return "bg-slate-50/50 dark:bg-slate-500/5 text-slate-600 dark:text-slate-400 border-slate-100 dark:border-slate-900/30";
    case "linkedin": return "bg-slate-50/50 dark:bg-slate-500/5 text-slate-600 dark:text-slate-400 border-slate-100 dark:border-slate-900/30";
    case "crunchbase": return "bg-slate-50/50 dark:bg-slate-500/5 text-slate-600 dark:text-slate-400 border-slate-100 dark:border-slate-900/30";
    case "github": return "bg-surface-secondary text-content border-edge";
    case "news": return "bg-slate-50/50 dark:bg-slate-500/5 text-slate-600 dark:text-slate-400 border-slate-100 dark:border-slate-900/30";
    case "arxiv": return "bg-slate-50/50 dark:bg-slate-500/5 text-slate-600 dark:text-slate-400 border-slate-100 dark:border-slate-900/30";
    default: return "bg-surface-secondary text-content-secondary border-edge";
  }
}

function getProviderLabel(provider: ArtifactProvider | undefined): string {
  switch (provider) {
    case "youtube": return "YouTube";
    case "sec": return "SEC EDGAR";
    case "twitter": return "Twitter/X";
    case "linkedin": return "LinkedIn";
    case "crunchbase": return "Crunchbase";
    case "pitchbook": return "PitchBook";
    case "github": return "GitHub";
    case "arxiv": return "arXiv";
    case "wikipedia": return "Wikipedia";
    case "news": return "News";
    case "reddit": return "Reddit";
    case "web": return "Web";
    case "local": return "Local";
    default: return "Other";
  }
}

function getKindLabel(kind: ArtifactKind): string {
  switch (kind) {
    case "video": return "Videos";
    case "image": return "Images";
    case "sec": return "SEC Filings";
    case "person": return "People";
    case "company": return "Companies";
    case "document": return "Documents";
    case "file": return "Files";
    case "url": return "Web Sources";
    default: return "Other";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE ITEM COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface SourceItemProps {
  artifact: ArtifactCard;
}

function SourceItem({ artifact }: SourceItemProps) {
  const { flags, title, host, kind, provider, snippet, canonicalUrl, thumbnail } = artifact;

  return (
    <a
      href={canonicalUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`
        flex items-start gap-3 p-3 rounded-lg border transition-all duration-200
       
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
        ${getProviderColor(provider)}
      `}
    >
      {/* Thumbnail or Icon */}
      <div className="flex-shrink-0 w-12 h-12 rounded bg-surface-secondary flex items-center justify-center overflow-hidden">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="opacity-60">{getKindIcon(kind)}</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-medium text-sm line-clamp-1 break-words">
            {title}
          </h4>
          <div className="flex items-center gap-1 flex-shrink-0">
            {flags.isPinned && <Pin className="w-3.5 h-3.5 text-slate-500" />}
            {flags.isCited && <CheckCircle2 className="w-3.5 h-3.5 text-[var(--accent-primary)]" />}
          </div>
        </div>

        {snippet && (
          <p className="text-xs opacity-70 line-clamp-1 mt-0.5 break-words overflow-hidden">
            {snippet}
          </p>
        )}

        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs font-medium opacity-80">
            {getProviderLabel(provider)}
          </span>
          {host && (
            <>
              <span className="text-xs opacity-50">•</span>
              <span className="text-xs opacity-60 truncate max-w-[150px]">
                {host}
              </span>
            </>
          )}
          <ExternalLink className="w-3 h-3 opacity-40 ml-auto" />
        </div>
      </div>
    </a>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SOURCES LIBRARY COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function SourcesLibrary({
  unassignedOnly = false,
  initialVisible = 12,
  defaultCollapsed = false,
  title = "Sources Library",
}: SourcesLibraryProps) {
  const allArtifacts = useAllArtifacts();
  const unassignedArtifacts = useUnassignedArtifacts();

  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [showAll, setShowAll] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("provider");

  // Choose artifacts based on mode
  const artifacts = unassignedOnly ? unassignedArtifacts : allArtifacts;

  // Sort: pinned first, then cited, then by discoveredAt
  const sortedArtifacts = useMemo(() => {
    return [...artifacts].sort((a, b) => {
      if (a.flags.isPinned && !b.flags.isPinned) return -1;
      if (!a.flags.isPinned && b.flags.isPinned) return 1;
      if (a.flags.isCited && !b.flags.isCited) return -1;
      if (!a.flags.isCited && b.flags.isCited) return 1;
      return b.discoveredAt - a.discoveredAt;
    });
  }, [artifacts]);

  // Group artifacts
  const groupedArtifacts = useMemo(() => {
    if (groupBy === "none") {
      return { all: sortedArtifacts };
    }

    const groups: Record<string, ArtifactCard[]> = {};
    for (const artifact of sortedArtifacts) {
      const key = groupBy === "provider"
        ? (artifact.provider || "web")
        : artifact.kind;
      if (!groups[key]) groups[key] = [];
      groups[key].push(artifact);
    }

    // Sort groups by size (largest first)
    const sortedEntries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    return Object.fromEntries(sortedEntries);
  }, [sortedArtifacts, groupBy]);

  // Visible artifacts
  const visibleCount = showAll ? sortedArtifacts.length : initialVisible;

  if (artifacts.length === 0) {
    return null;
  }

  return (
    <div className="mt-12 border-t-2 border-edge pt-8">
      {/* Header */}
      <div
        className="flex items-center justify-between mb-4 cursor-pointer"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-surface-secondary rounded-lg">
            <Library className="w-5 h-5 text-content-secondary" />
          </div>
          <div>
            <h3 className="font-bold text-content">{title}</h3>
            <p className="text-xs text-content-secondary">
              {artifacts.length} source{artifacts.length !== 1 ? 's' : ''} discovered
              {artifacts.filter(a => a.flags.isPinned).length > 0 && (
                <span className="ml-2 text-[var(--accent-primary)]">
                  • {artifacts.filter(a => a.flags.isPinned).length} pinned
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Group By Toggle */}
          {!isCollapsed && (
            <div className="flex items-center gap-1 text-xs">
              <Filter className="w-3.5 h-3.5 text-content-muted" />
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                onClick={(e) => e.stopPropagation()}
                aria-label="Group sources by"
                className="bg-surface-secondary border-none rounded px-2 py-1 text-xs text-content-secondary focus:ring-1 focus:ring-ring"
              >
                <option value="provider">By Provider</option>
                <option value="kind">By Type</option>
                <option value="none">No Grouping</option>
              </select>
            </div>
          )}

          <button type="button" className="p-1 hover:bg-surface-hover rounded" aria-label={isCollapsed ? "Expand sources" : "Collapse sources"} aria-expanded={isCollapsed ? "false" : "true"}>
            {isCollapsed ? (
              <ChevronDown className="w-5 h-5 text-content-muted" />
            ) : (
              <ChevronUp className="w-5 h-5 text-content-muted" />
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="space-y-6">
          {groupBy === "none" ? (
            // Flat list
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sortedArtifacts.slice(0, visibleCount).map(artifact => (
                <SourceItem key={artifact.id} artifact={artifact} />
              ))}
            </div>
          ) : (
            // Grouped list
            Object.entries(groupedArtifacts).map(([group, items]) => {
              const label = groupBy === "provider"
                ? getProviderLabel(group as ArtifactProvider)
                : getKindLabel(group as ArtifactKind);

              return (
                <div key={group}>
                  <h4 className="text-xs font-semibold text-content-secondary mb-2 flex items-center gap-2">
                    {groupBy === "kind" && getKindIcon(group as ArtifactKind)}
                    {label}
                    <span className="text-content-muted">({items.length})</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {items.slice(0, showAll ? items.length : 4).map(artifact => (
                      <SourceItem key={artifact.id} artifact={artifact} />
                    ))}
                  </div>
                  {!showAll && items.length > 4 && (
                    <button
                      type="button"
                      onClick={() => setShowAll(true)}
                      className="mt-2 text-xs text-[var(--accent-primary)] hover:opacity-80 font-medium"
                    >
                      +{items.length - 4} more
                    </button>
                  )}
                </div>
              );
            })
          )}

          {/* Show All / Collapse */}
          {sortedArtifacts.length > initialVisible && (
            <div className="text-center pt-4">
              <button
                type="button"
                onClick={() => setShowAll(!showAll)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-surface-secondary hover:bg-surface-secondary dark:hover:bg-white/[0.1] rounded-lg text-sm font-medium text-content-secondary transition-colors"
              >
                {showAll ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    Show Less
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    Show All {sortedArtifacts.length} Sources
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SourcesLibrary;
