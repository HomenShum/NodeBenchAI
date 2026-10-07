// src/components/artifacts/MediaRail.tsx
// Per-section artifact rail with cards for different artifact types
// Renders inline with dossier content

import { useMemo } from "react";
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
} from "lucide-react";
import type { ArtifactCard, ArtifactKind, ArtifactProvider } from "../../shared/artifacts";
import { useSectionArtifacts, useArtifactStore } from "../../hooks/useArtifactStore";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface MediaRailProps {
  /** Section ID to show artifacts for */
  sectionId: string;

  /** Additional artifacts to display (e.g., unassigned) */
  additionalArtifacts?: ArtifactCard[];

  /** Maximum artifacts to show (default: 8) */
  maxVisible?: number;

  /** Compact mode (smaller cards) */
  compact?: boolean;

  /** Called when artifact is clicked */
  onArtifactClick?: (artifact: ArtifactCard) => void;
}

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
    case "youtube": return "text-content-secondary";
    case "sec": return "text-content-secondary";
    case "twitter": return "text-content-secondary";
    case "linkedin": return "text-content-secondary";
    case "crunchbase": return "text-content-secondary";
    case "github": return "text-content";
    case "news": return "text-content-secondary";
    default: return "text-content-secondary";
  }
}

function getProviderLabel(provider: ArtifactProvider | undefined): string {
  switch (provider) {
    case "youtube": return "YouTube";
    case "sec": return "SEC";
    case "twitter": return "Twitter";
    case "linkedin": return "LinkedIn";
    case "crunchbase": return "Crunchbase";
    case "pitchbook": return "PitchBook";
    case "github": return "GitHub";
    case "arxiv": return "arXiv";
    case "wikipedia": return "Wikipedia";
    case "news": return "News";
    case "reddit": return "Reddit";
    default: return "Web";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACT CARD COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface ArtifactCardItemProps {
  artifact: ArtifactCard;
  compact?: boolean;
  onClick?: (artifact: ArtifactCard) => void;
}

function ArtifactCardItem({ artifact, compact, onClick }: ArtifactCardItemProps) {
  const { flags, thumbnail, title, host, kind, provider, snippet, canonicalUrl } = artifact;

  const cardClasses = `
    group relative flex flex-col bg-surface border border-edge rounded-lg
    overflow-hidden cursor-pointer transition-all duration-200
    hover:border-[var(--accent-primary)]/30
    focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1
    ${compact ? 'w-40' : 'w-52'}
  `;

  const innerContent = (
    <>
      {/* Thumbnail or Placeholder */}
      <div className={`relative bg-surface-secondary ${compact ? 'h-24' : 'h-32'}`}>
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className={`${getProviderColor(provider)}`}>
              {getKindIcon(kind)}
            </div>
          </div>
        )}

        {/* Kind Badge */}
        <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 backdrop-blur-sm rounded text-white text-xs font-medium tracking-wide">
          {kind}
        </div>

        {/* Video Play Overlay */}
        {kind === "video" && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-secondary group-hover:bg-black/30 transition-colors">
            <div className="w-10 h-10 rounded-full bg-surface/90 flex items-center justify-center">
              <Play className="w-5 h-5 text-content dark:text-content ml-0.5" />
            </div>
          </div>
        )}

        {/* Quality Badges */}
        <div className="absolute top-2 right-2 flex gap-1">
          {flags.isPinned && (
            <div className="w-5 h-5 rounded-full bg-slate-800 dark:bg-slate-200 flex items-center justify-center">
              <Pin className="w-3 h-3 text-white dark:text-slate-800" />
            </div>
          )}
          {flags.isCited && (
            <div className="w-5 h-5 rounded-full bg-[var(--accent-primary)] flex items-center justify-center">
              <CheckCircle2 className="w-3 h-3 text-white" />
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 ${compact ? 'p-2' : 'p-3'}`}>
        <h4 className={`font-medium text-content line-clamp-2 break-words ${compact ? 'text-xs' : 'text-sm'}`}>
          {title}
        </h4>

        {!compact && snippet && (
          <p className="mt-1 text-xs text-content-secondary line-clamp-2 break-words overflow-hidden">
            {snippet}
          </p>
        )}

        {/* Footer */}
        <div className="mt-2 flex items-center justify-between">
          <span className={`text-xs font-medium ${getProviderColor(provider)}`}>
            {getProviderLabel(provider)}
          </span>
          {host && (
            <span className="text-xs text-content-muted truncate max-w-[80px]">
              {host}
            </span>
          )}
        </div>
      </div>

      {/* External Link Icon */}
      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <ExternalLink className="w-3.5 h-3.5 text-content-muted" />
      </div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={() => onClick(artifact)} className={cardClasses}>
        {innerContent}
      </button>
    );
  }

  return (
    <a
      href={canonicalUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cardClasses}
    >
      {innerContent}
    </a>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA RAIL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function MediaRail({
  sectionId,
  additionalArtifacts = [],
  maxVisible = 8,
  compact = false,
  onArtifactClick,
}: MediaRailProps) {
  // Get artifacts for this section from store
  const sectionArtifacts = useSectionArtifacts(sectionId);

  // Combine section artifacts with additional
  const allArtifacts = useMemo(() => {
    const combined = [...sectionArtifacts, ...additionalArtifacts];
    // Dedupe by ID
    const seen = new Set<string>();
    return combined.filter(a => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }, [sectionArtifacts, additionalArtifacts]);

  // Sort: pinned first, then cited, then by discoveredAt
  const sortedArtifacts = useMemo(() => {
    return [...allArtifacts]
      .sort((a, b) => {
        // Pinned first
        if (a.flags.isPinned && !b.flags.isPinned) return -1;
        if (!a.flags.isPinned && b.flags.isPinned) return 1;
        // Then cited
        if (a.flags.isCited && !b.flags.isCited) return -1;
        if (!a.flags.isCited && b.flags.isCited) return 1;
        // Then by discovery time (newest first)
        return b.discoveredAt - a.discoveredAt;
      })
      .slice(0, maxVisible);
  }, [allArtifacts, maxVisible]);

  if (sortedArtifacts.length === 0) {
    return null;
  }

  return (
    <div className="my-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px flex-1 bg-surface-secondary"></div>
        <span className="text-xs font-semibold text-content-secondary">
          Sources & Media ({sortedArtifacts.length})
        </span>
        <div className="h-px flex-1 bg-surface-secondary"></div>
      </div>

      {/* Horizontal Scroll Rail */}
      <div className="relative">
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
          {sortedArtifacts.map(artifact => (
            <ArtifactCardItem
              key={artifact.id}
              artifact={artifact}
              compact={compact}
              onClick={onArtifactClick}
            />
          ))}
        </div>

        {/* Fade edges */}
        <div className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white pointer-events-none"></div>
      </div>

      {/* Show More Link */}
      {allArtifacts.length > maxVisible && (
        <div className="mt-2 text-center">
          <button type="button" className="text-xs text-[var(--accent-primary)] hover:opacity-80 font-medium">
            +{allArtifacts.length - maxVisible} more sources
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// INLINE MEDIA RAIL (Simpler version for tight spaces)
// ═══════════════════════════════════════════════════════════════════════════

interface InlineMediaRailProps {
  artifacts: ArtifactCard[];
  maxVisible?: number;
}

export function InlineMediaRail({ artifacts, maxVisible = 4 }: InlineMediaRailProps) {
  const visible = artifacts.slice(0, maxVisible);
  const remaining = artifacts.length - maxVisible;

  if (visible.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap mt-2">
      {visible.map(artifact => (
        <a
          key={artifact.id}
          href={artifact.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2 py-1 bg-surface-secondary hover:bg-surface-secondary dark:hover:bg-white/[0.1] rounded text-xs text-content-secondary transition-colors"
        >
          <span className={getProviderColor(artifact.provider)}>
            {getKindIcon(artifact.kind)}
          </span>
          <span className="max-w-[120px] truncate">{artifact.title}</span>
          <ExternalLink className="w-3 h-3 text-content-muted" />
        </a>
      ))}
      {remaining > 0 && (
        <span className="text-xs text-content-secondary">+{remaining} more</span>
      )}
    </div>
  );
}

export default MediaRail;
