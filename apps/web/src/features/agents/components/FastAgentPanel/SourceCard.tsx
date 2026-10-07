// src/components/FastAgentPanel/SourceCard.tsx
// Unified source card component for displaying documents, articles, and other sources

import React, { useState } from 'react';
import { ExternalLink, FileText, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Source } from '@/components/ai-elements/sources';
import type { SECDocument } from './MediaGallery';

export interface BaseSource {
  title: string;
  url: string;
  domain?: string;
  description?: string;
  favicon?: string;
  previewImage?: string;
  pageIndex?: number;
}

interface SourceCardProps {
  source: BaseSource | SECDocument;
  className?: string;
}

/**
 * Helper to determine if source is an SEC document
 */
function isSECDocument(source: BaseSource | SECDocument): source is SECDocument {
  return 'formType' in source && 'accessionNumber' in source;
}

/**
 * Helper to extract domain from URL
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return '';
  }
}

/**
 * SourceCard - Displays a single source with preview, title, and metadata
 * Supports both generic sources and SEC documents
 *
 * Reimplemented on the Vercel AI Elements `Source` primitive (which renders the
 * anchor) with rich preview metadata supplied as custom children. These cards
 * represent consulted sources; claim-bound citation UI is rendered separately
 * from resolved inline citation tokens.
 */
export function SourceCard({ source, className }: SourceCardProps) {
  const isSEC = isSECDocument(source);

  // Extract metadata
  const title = source.title;
  const url = isSEC ? source.documentUrl : source.url;
  const domain = isSEC ? 'sec.gov' : (source.domain || extractDomain(url));
  const description = isSEC
    ? `${source.formType} • Filed ${source.filingDate}`
    : source.description;
  const previewImage = isSEC ? undefined : source.previewImage;
  const favicon = isSEC ? undefined : source.favicon;

  return (
    <Source
      href={url}
      rel="noopener noreferrer"
      className={cn(
        "group block rounded-lg border border-edge hover:shadow-md hover:border-primary/20",
        "transition-all duration-200 bg-surface overflow-hidden scroll-mt-4",
        className
      )}
    >
      <div className="flex gap-3 p-3">
        {/* Preview image or icon */}
        <div className="flex-shrink-0">
          {previewImage ? (
            <img
              src={previewImage}
              alt=""
              className="w-16 h-16 rounded object-cover bg-surface-hover"
              width={64}
              height={64}
              loading="lazy"
            />
          ) : (
            <div className={cn(
              "w-16 h-16 rounded flex items-center justify-center",
              isSEC ? "bg-blue-50" : "bg-surface-secondary"
            )}>
              {isSEC ? (
                <FileText className="h-8 w-8 text-blue-600" />
              ) : (
                <Globe className="h-8 w-8 text-content-muted" />
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3 className="text-sm font-medium text-content line-clamp-2 mb-1 group-hover:text-blue-600 transition-colors">
            {title}
          </h3>

          {/* Domain/Source */}
          <div className="flex items-center gap-2 mb-1">
            {favicon && (
              <img
                src={favicon}
                alt=""
                className="w-3 h-3"
                width={12}
                height={12}
                loading="lazy"
              />
            )}
            <span className="text-xs text-content-secondary font-medium">
              {domain}
            </span>
            {isSEC && (
              <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
                SEC Filing
              </span>
            )}
            {!isSEC && source.pageIndex != null && (
              <span className="text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded font-medium">
                p. {source.pageIndex}
              </span>
            )}
          </div>

          {/* Description */}
          {description && (
            <p className="text-xs text-content-secondary line-clamp-2">
              {description}
            </p>
          )}
        </div>

        {/* External link indicator */}
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <ExternalLink className="h-4 w-4 text-content-muted" />
        </div>
      </div>
    </Source>
  );
}

/**
 * SourceGrid - Grid layout for multiple sources
 */
interface SourceGridProps {
  sources: (BaseSource | SECDocument)[];
  title?: string;
}

export function SourceGrid({ sources, title = "Consulted sources" }: SourceGridProps) {
  const [showAll, setShowAll] = useState(false);
  const INITIAL_DISPLAY_COUNT = 6;

  if (sources.length === 0) return null;

  const displayedSources = showAll ? sources : sources.slice(0, INITIAL_DISPLAY_COUNT);
  const hasMore = sources.length > INITIAL_DISPLAY_COUNT;

  return (
    <div className="mb-4">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px flex-1 bg-[var(--border-color)]"></div>
        <h3 className="text-sm font-semibold text-content flex items-center gap-2">
          <FileText className="h-4 w-4 text-content-secondary" />
          {title}
          <span className="text-xs font-normal text-content-secondary">
            ({showAll ? sources.length : Math.min(sources.length, INITIAL_DISPLAY_COUNT)}{hasMore && !showAll ? `/${sources.length}` : ''})
          </span>
        </h3>
        <div className="h-px flex-1 bg-[var(--border-color)]"></div>
      </div>

      {/* Grid layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {displayedSources.map((source, idx) => (
          <SourceCard
            key={idx}
            source={source}
          />
        ))}
      </div>

      {/* Show More/Less button */}
      {hasMore && (
        <div className="flex justify-center mt-3">
          <button
            onClick={() => setShowAll(!showAll)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-content bg-surface border border-edge rounded-lg hover:bg-surface-hover hover:border-edge transition-colors"
          >
            {showAll ? (
              <>
                <ChevronUp className="h-4 w-4" />
                Show Less
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                Show {sources.length - INITIAL_DISPLAY_COUNT} More
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Helper to convert SECDocument to BaseSource format
 */
export function secDocumentToSource(doc: SECDocument): BaseSource {
  return {
    title: doc.title,
    url: doc.documentUrl,
    domain: 'sec.gov',
    description: `${doc.formType} • Filed ${doc.filingDate}`,
  };
}
