// src/components/artifacts/EvidenceChips.tsx
// Inline evidence chips [1][2][3] that link to source artifacts
// Renders at {{fact:*}} anchor locations in markdown

import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { useArtifactStore } from "../../hooks/useArtifactStore";
import type { ArtifactCard } from "../../shared/artifacts";

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TYPES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

interface EvidenceChipsProps {
  /** Fact ID from {{fact:xxx}} anchor */
  factId: string;

  /** Called when a chip is clicked */
  onChipClick?: (artifact: ArtifactCard, index: number) => void;

  /** Compact mode (smaller chips) */
  compact?: boolean;
}

interface EvidenceChipGroupProps {
  /** Section ID to scope numbering */
  sectionId?: string;

  /** All fact IDs in this section (for consistent numbering) */
  factIds: string[];

  /** Evidence links map: factId -> artifactIds */
  evidenceLinks: Record<string, string[]>;

  /** Called when a chip is clicked */
  onChipClick?: (artifact: ArtifactCard, factId: string, index: number) => void;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SINGLE EVIDENCE CHIP
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function EvidenceChip({
  index,
  artifact,
  onClick,
  disabled = false,
}: {
  index: number;
  artifact?: ArtifactCard;
  onClick?: () => void;
  disabled?: boolean;
}) {
  if (disabled || !artifact) {
    return (
      <span
        className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-xs font-medium bg-surface-secondary text-content-muted rounded cursor-not-allowed"
        title="Source loading..."
      >
        [{index}]
      </span>
    );
  }

  <button
    onClick={onClick}
    className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 text-xs font-semibold bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)] hover:text-white rounded border border-[var(--accent-primary)]/20 transition-all cursor-pointer active:scale-95"
    title={artifact.title || artifact.canonicalUrl}
  >
    {index}
  </button>
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EVIDENCE CHIPS (for a single fact anchor)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Render evidence chips for a single fact anchor.
 * Uses evidence links from the store to find artifact IDs.
 */
export function EvidenceChips({ factId, onChipClick, compact }: EvidenceChipsProps) {
  const { state } = useArtifactStore();
  const { byId, evidenceLinks } = state;

  const artifactIds = evidenceLinks[factId] ?? [];

  if (artifactIds.length === 0) {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-0.5 ml-0.5">
      {artifactIds.map((artifactId: string, idx: number) => {
        const artifact = byId[artifactId];
        return (
          <EvidenceChip
            key={artifactId}
            index={idx + 1}
            artifact={artifact}
            onClick={() => {
              if (artifact && onChipClick) {
                onChipClick(artifact, idx);
              } else if (artifact) {
                // Default: open URL in new tab
                window.open(artifact.canonicalUrl, "_blank");
              }
            }}
            disabled={!artifact}
          />
        );
      })}
    </span>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EVIDENCE CHIP GROUP (for consistent numbering across section)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * Manages consistent numbering across all evidence in a section.
 * Useful when you want [1][2] in one paragraph and [3][4] in another
 * to reference a shared source list.
 */
export function EvidenceChipGroup({
  sectionId,
  factIds,
  evidenceLinks,
  onChipClick,
}: EvidenceChipGroupProps) {
  const { state } = useArtifactStore();
  const { byId } = state;

  // Build global index mapping for consistent numbering
  const { artifactToIndex, allArtifactIds } = useMemo(() => {
    const seen = new Set<string>();
    const allIds: string[] = [];

    for (const factId of factIds) {
      const ids = evidenceLinks[factId] ?? [];
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          allIds.push(id);
        }
      }
    }

    const mapping: Record<string, number> = {};
    allIds.forEach((id, idx) => {
      mapping[id] = idx + 1;
    });

    return { artifactToIndex: mapping, allArtifactIds: allIds };
  }, [factIds, evidenceLinks]);

  // Render chips for each fact
  return (
    <>
      {factIds.map(factId => {
        const artifactIds = evidenceLinks[factId] ?? [];
        if (artifactIds.length === 0) return null;

        return (
          <span key={factId} className="inline-flex items-center gap-0.5 ml-0.5">
            {artifactIds.map(artifactId => {
              const artifact = byId[artifactId];
              const globalIndex = artifactToIndex[artifactId] ?? 0;

              return (
                <EvidenceChip
                  key={artifactId}
                  index={globalIndex}
                  artifact={artifact}
                  onClick={() => {
                    if (artifact && onChipClick) {
                      onChipClick(artifact, factId, globalIndex);
                    } else if (artifact) {
                      window.open(artifact.canonicalUrl, "_blank");
                    }
                  }}
                  disabled={!artifact}
                />
              );
            })}
          </span>
        );
      })}
    </>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SOURCE FOOTER (shows all sources for a section)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

interface SourceFooterProps {
  sectionId: string;
  evidenceLinks: Record<string, string[]>;
  onSourceClick?: (artifact: ArtifactCard) => void;
}

/**
 * Render a compact source footer showing all referenced sources.
 * Useful for newsletter-style citation lists.
 */
export function SourceFooter({ sectionId, evidenceLinks, onSourceClick }: SourceFooterProps) {
  const { state } = useArtifactStore();
  const { byId } = state;

  // Collect unique artifacts across all facts
  const uniqueArtifacts = useMemo(() => {
    const seen = new Set<string>();
    const artifacts: Array<{ artifact: ArtifactCard; index: number }> = [];

    for (const artifactIds of Object.values(evidenceLinks)) {
      for (const id of artifactIds) {
        if (!seen.has(id) && byId[id]) {
          seen.add(id);
          artifacts.push({ artifact: byId[id], index: artifacts.length + 1 });
        }
      }
    }

    return artifacts;
  }, [evidenceLinks, byId]);

  if (uniqueArtifacts.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 pt-3 border-t border-edge">
      <p className="text-xs font-semibold text-content-secondary tracking-wide mb-2">
        Sources
      </p>
      <ol className="text-xs text-content-secondary space-y-1 list-none pl-0">
        {uniqueArtifacts.map(({ artifact, index }) => (
          <li key={artifact.id} className="flex items-start gap-2">
            <span className="font-mono text-content-muted shrink-0">[{index}]</span>
            <a
              href={artifact.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                if (onSourceClick) {
                  e.preventDefault();
                  onSourceClick(artifact);
                }
              }}
              className="text-[var(--accent-primary)] hover:opacity-80 hover:underline truncate flex items-center gap-1 font-medium transition-opacity"
            >
              {artifact.title || artifact.host}
              <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default EvidenceChips;

