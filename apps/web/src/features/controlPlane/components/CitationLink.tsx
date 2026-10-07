/**
 * CitationLink — Inline source text with optional clickable URL.
 *
 * When `url` is provided, renders the source text as a terracotta-colored
 * link with an external-link icon. When absent, renders plain text.
 *
 * Usage:
 *   <CitationLink source="Reuters" url="https://reuters.com/..." />
 *   <CitationLink source="Shopify FY2025 10-K" />
 */

import { memo } from "react";
import { ExternalLink } from "lucide-react";

interface CitationLinkProps {
  /** Source label text (e.g., "Reuters", "SEC Filing") */
  source: string;
  /** Optional URL to make the source clickable */
  url?: string;
  /** Additional CSS classes for the container */
  className?: string;
}

export const CitationLink = memo(function CitationLink({
  source,
  url,
  className = "",
}: CitationLinkProps) {
  if (!url) {
    return <span className={className}>{source}</span>;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1 text-[#d97757] transition-colors hover:text-[#f2b49f] ${className}`}
    >
      {source}
      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
    </a>
  );
});
