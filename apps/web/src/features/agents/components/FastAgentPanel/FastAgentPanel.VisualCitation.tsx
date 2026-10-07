/**
 * FastAgentPanel.VisualCitation.tsx
 * Enhanced visual citation system with glowing border highlights
 * 
 * Features:
 * - Footnote-style superscript citations [1], [2], [3]
 * - Glowing border highlight on referenced documents when hovering
 * - Smooth scroll to source on click
 * - Document linking with visual feedback
 */

import React, { useState, useCallback, createContext, useContext } from 'react';
import { cn } from '@/lib/utils';

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT: Citation Highlight State
// ═══════════════════════════════════════════════════════════════════════════

interface CitationHighlightContextValue {
  highlightedCitationId: string | null;
  setHighlightedCitationId: (id: string | null) => void;
}

const CitationHighlightContext = createContext<CitationHighlightContextValue>({
  highlightedCitationId: null,
  setHighlightedCitationId: () => {},
});

export function CitationHighlightProvider({ children }: { children: React.ReactNode }) {
  const [highlightedCitationId, setHighlightedCitationId] = useState<string | null>(null);
  
  return (
    <CitationHighlightContext.Provider value={{ highlightedCitationId, setHighlightedCitationId }}>
      {children}
    </CitationHighlightContext.Provider>
  );
}

export function useCitationHighlight() {
  return useContext(CitationHighlightContext);
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT: InlineCitation
// ═══════════════════════════════════════════════════════════════════════════

interface InlineCitationProps {
  number: number;
  sourceId: string;
  sourceTitle?: string;
  pageIndex?: number;
  onScrollToSource?: (sourceId: string) => void;
  className?: string;
}

/**
 * InlineCitation - Superscript citation marker [1] that highlights source on hover
 */
export function InlineCitation({
  number,
  sourceId,
  sourceTitle,
  pageIndex,
  onScrollToSource,
  className,
}: InlineCitationProps) {
  const { setHighlightedCitationId } = useCitationHighlight();

  const handleMouseEnter = useCallback(() => {
    setHighlightedCitationId(sourceId);
  }, [sourceId, setHighlightedCitationId]);

  const handleMouseLeave = useCallback(() => {
    setHighlightedCitationId(null);
  }, [setHighlightedCitationId]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onScrollToSource?.(sourceId);
    
    // Scroll to source element
    const sourceElement = document.getElementById(`source-${number}`);
    if (sourceElement) {
      sourceElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add temporary highlight
      sourceElement.classList.add('citation-flash');
      setTimeout(() => sourceElement.classList.remove('citation-flash'), 1500);
    }
  }, [number, sourceId, onScrollToSource]);

  return (
    <sup
      className={cn(
        "inline-flex items-center justify-center",
        "min-w-[1.25rem] h-4 px-1 mx-0.5",
        "text-xs font-semibold",
        "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
        "rounded-full cursor-pointer",
        "transition-all duration-200",
        "hover:bg-blue-200 dark:hover:bg-blue-800/60",
        "hover:shadow-sm hover:shadow-blue-300/50",
        className
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      title={`${sourceTitle || `Source ${number}`}${pageIndex != null ? ` (p. ${pageIndex})` : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Citation ${number}${sourceTitle ? `: ${sourceTitle}` : ''}${pageIndex != null ? ` page ${pageIndex}` : ''}`}
    >
      {number}{pageIndex != null && <span className="text-[8px] ml-0.5 opacity-75">p{pageIndex}</span>}
    </sup>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT: HighlightableSource
// ═══════════════════════════════════════════════════════════════════════════

interface HighlightableSourceProps {
  sourceId: string;
  citationNumber?: number;
  children: React.ReactNode;
  className?: string;
}

/**
 * HighlightableSource - Wrapper that adds glowing border when citation is hovered
 */
export function HighlightableSource({
  sourceId,
  citationNumber,
  children,
  className,
}: HighlightableSourceProps) {
  const { highlightedCitationId } = useCitationHighlight();
  const isHighlighted = highlightedCitationId === sourceId;

  return (
    <div
      id={citationNumber ? `source-${citationNumber}` : undefined}
      className={cn(
        "relative transition-all duration-300 rounded-lg",
        isHighlighted && [
          "ring-2 ring-violet-500 ring-offset-2",
          "shadow-lg shadow-violet-500/25",
          "scale-[1.02]",
          "z-10",
        ],
        className
      )}
    >
      {/* Glow effect overlay */}
      {isHighlighted && (
        <div className="absolute inset-0 rounded-lg bg-violet-500/5 pointer-events-none motion-safe:animate-pulse" />
      )}
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ARBITRAGE CITATION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Arbitrage verification status types
 */
export type ArbitrageStatus = 'verified' | 'partial' | 'unverified' | 'contradicted';

/**
 * Status badge configuration
 */
const STATUS_CONFIG: Record<ArbitrageStatus, {
  label: string;
  icon: string;
  bgClass: string;
  textClass: string;
  description: string;
}> = {
  verified: {
    label: 'Verified',
    icon: '✓',
    bgClass: 'bg-indigo-100 dark:bg-gray-900/40',
    textClass: 'text-content-secondary dark:text-indigo-300',
    description: 'Confirmed by primary source',
  },
  partial: {
    label: 'Partial',
    icon: '◐',
    bgClass: 'bg-amber-100 dark:bg-amber-900/40',
    textClass: 'text-amber-700 dark:text-amber-300',
    description: 'Partially confirmed, some details unverified',
  },
  unverified: {
    label: 'Unverified',
    icon: '?',
    bgClass: 'bg-surface-hover dark:bg-gray-800/40',
    textClass: 'text-content-secondary dark:text-content-secondary',
    description: 'No primary source confirmation',
  },
  contradicted: {
    label: 'Contradicted',
    icon: '✗',
    bgClass: 'bg-red-100 dark:bg-red-900/40',
    textClass: 'text-red-700 dark:text-red-300',
    description: 'Sources disagree on this claim',
  },
};

interface ArbitrageCitationProps {
  number: number;
  sourceId: string;
  status: ArbitrageStatus;
  sourceTitle?: string;
  onScrollToSource?: (sourceId: string) => void;
  className?: string;
}

/**
 * ArbitrageCitation - Citation with verification status badge
 */
export function ArbitrageCitation({
  number,
  sourceId,
  status,
  sourceTitle,
  onScrollToSource,
  className,
}: ArbitrageCitationProps) {
  const { setHighlightedCitationId } = useCitationHighlight();
  const config = STATUS_CONFIG[status];

  const handleMouseEnter = useCallback(() => {
    setHighlightedCitationId(sourceId);
  }, [sourceId, setHighlightedCitationId]);

  const handleMouseLeave = useCallback(() => {
    setHighlightedCitationId(null);
  }, [setHighlightedCitationId]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onScrollToSource?.(sourceId);

    const sourceElement = document.getElementById(`source-${number}`);
    if (sourceElement) {
      sourceElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      sourceElement.classList.add('citation-flash');
      setTimeout(() => sourceElement.classList.remove('citation-flash'), 1500);
    }
  }, [number, sourceId, onScrollToSource]);

  return (
    <sup
      className={cn(
        "inline-flex items-center gap-0.5",
        "h-4 px-1.5 mx-0.5",
        "text-xs font-semibold",
        config.bgClass,
        config.textClass,
        "rounded-full cursor-pointer",
        "transition-all duration-200",
        "hover:shadow-sm",
        className
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      title={`${config.description}${sourceTitle ? ` - ${sourceTitle}` : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Citation ${number} (${config.label})${sourceTitle ? `: ${sourceTitle}` : ''}`}
    >
      <span className="text-[8px]">{config.icon}</span>
      <span>{number}</span>
    </sup>
  );
}

/**
 * Parse arbitrage citation format: {{arbitrage:section:slug:status}}
 * Returns null if not a valid arbitrage citation
 */
export function parseArbitrageCitation(text: string): {
  section: string;
  slug: string;
  status: ArbitrageStatus;
} | null {
  const match = text.match(/\{\{arbitrage:([^:]+):([^:]+):([^}]+)\}\}/);
  if (!match) return null;

  const [, section, slug, statusStr] = match;
  const status = statusStr as ArbitrageStatus;

  if (!['verified', 'partial', 'unverified', 'contradicted'].includes(status)) {
    return null;
  }

  return { section, slug, status };
}

/**
 * Parse legacy citation format: {{fact:section:slug}}
 * Returns null if not a valid legacy citation
 */
export function parseLegacyCitation(text: string): {
  section: string;
  slug: string;
} | null {
  const match = text.match(/\{\{fact:([^:]+):([^}]+)\}\}/);
  if (!match) return null;

  const [, section, slug] = match;
  return { section, slug };
}

/**
 * StatusBadge - Standalone status indicator for use in reports
 */
export function StatusBadge({
  status,
  showLabel = true,
  size = 'sm',
}: {
  status: ArbitrageStatus;
  showLabel?: boolean;
  size?: 'xs' | 'sm' | 'md';
}) {
  const config = STATUS_CONFIG[status];

  const sizeClasses = {
    xs: 'text-xs px-1 py-0',
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-xs px-2 py-1',
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full font-medium",
        config.bgClass,
        config.textClass,
        sizeClasses[size]
      )}
      title={config.description}
    >
      <span>{config.icon}</span>
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}

export default InlineCitation;
