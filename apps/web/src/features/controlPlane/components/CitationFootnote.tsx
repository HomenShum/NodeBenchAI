/**
 * CitationFootnote — Inline superscript citation [1] with hover tooltip.
 *
 * Renders a small terracotta-colored superscript number. On hover/click,
 * shows a glass-card tooltip with source title, clickable URL, and snippet.
 *
 * Usage:
 *   <CitationFootnote index={0} source={sourceRefs[0]} />
 *
 * The `index` is the display number (0-based sourceIdx from the packet),
 * rendered as [index + 1] for human-friendly 1-based numbering.
 */

import { memo, useCallback, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { ResultSourceRef } from "./searchTypes";

interface CitationFootnoteProps {
  /** 0-based index into sourceRefs (displayed as index+1) */
  index: number;
  /** The resolved source reference */
  source: ResultSourceRef | undefined;
  /** Verification status from evidence spans */
  verification?: "verified" | "partial" | "unverified" | "contradicted";
  /** Which claim this source supports */
  claimText?: string;
}

export const CitationFootnote = memo(function CitationFootnote({
  index,
  source,
  verification,
  claimText,
}: CitationFootnoteProps) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    timeoutRef.current = setTimeout(() => setOpen(false), 200);
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  if (!source) return null;

  const displayNum = index + 1;
  const domain = source.domain ?? extractDomain(source.href);

  return (
    <span
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center justify-center rounded px-[3px] text-[10px] font-bold leading-none text-[#d97757] transition-colors hover:bg-[#d97757]/10 hover:text-[#f2b49f] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d97757]/40"
        style={{ verticalAlign: "super", fontSize: "0.65em" }}
        aria-label={`Source ${displayNum}: ${source.title ?? source.label}`}
      >
        [{displayNum}]
      </button>

      {open && (
        <span
          role="tooltip"
          onMouseEnter={show}
          onMouseLeave={hide}
          className="absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-1 duration-150"
        >
          <span className="block rounded-lg border border-white/[0.12] bg-[#1a1918] p-3 shadow-xl">
            {/* Title row */}
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-content leading-tight">
                  {source.title ?? source.label}
                </span>
                {domain && (
                  <span className="mt-0.5 block text-[10px] text-content-muted">
                    {domain}
                  </span>
                )}
              </span>
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#d97757]/15 text-[10px] font-bold text-[#d97757]">
                {displayNum}
              </span>
            </span>

            {/* Verification + claim */}
            {(verification || claimText) && (
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                {verification && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                    verification === "verified" ? "bg-emerald-500/10 text-emerald-400" :
                    verification === "partial" ? "bg-amber-500/10 text-amber-400" :
                    verification === "contradicted" ? "bg-rose-500/10 text-rose-400" :
                    "bg-white/[0.04] text-content-muted"
                  }`}>
                    {verification}
                  </span>
                )}
                {claimText && (
                  <span className="text-[9px] text-content-muted/70 line-clamp-1">{claimText}</span>
                )}
              </span>
            )}

            {/* Snippet */}
            {source.excerpt && (
              <span className="mt-2 block text-[11px] leading-relaxed text-content-muted line-clamp-3">
                {source.excerpt}
              </span>
            )}

            {/* Link */}
            {source.href && (
              <a
                href={source.href}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="mt-2 inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-[#d97757] transition-colors hover:bg-white/[0.06] hover:text-[#f2b49f]"
              >
                <ExternalLink className="h-2.5 w-2.5" />
                Open source
              </a>
            )}
          </span>
        </span>
      )}
    </span>
  );
});

/* ─── Helper ───────────────────────────────────────────────────────────────── */

function extractDomain(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
