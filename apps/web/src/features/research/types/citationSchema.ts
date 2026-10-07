/**
 * Citation & Provenance Schema
 *
 * AI-2027.com-inspired citation system with bidirectional linking.
 * Citations appear as footnote markers [1], [2] in narrative text
 * and link to a footnotes section with back-references.
 */

import type { Evidence } from "./dailyBriefSchema";

// ═══════════════════════════════════════════════════════════════════════════
// CITATION TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type CitationType =
  | "source"      // Primary source citation (news, paper, etc.)
  | "data"        // Data/statistic citation
  | "quote"       // Direct quote citation
  | "analysis"    // AI analysis/synthesis citation
  | "internal";   // Internal dossier/document reference

export interface Citation {
  /** Unique citation ID (e.g., "cite-1", "cite-aws-blog") */
  id: string;
  /** Display number for footnote marker (1, 2, 3...) */
  number: number;
  /** Type of citation for visual styling */
  type: CitationType;
  /** Short label for inline display */
  label: string;
  /** Full citation text for footnotes section */
  fullText: string;
  /** URL to source (if external) */
  url?: string;
  /** Internal document ID (if internal reference) */
  documentId?: string;
  /** Evidence object if linked to evidence */
  evidence?: Evidence;
  /** ISO timestamp of when cited content was accessed */
  accessedAt?: string;
  /** Author/source name */
  author?: string;
  /** Publication date */
  publishedAt?: string;
  /** 1-based page number for PDF/document citations */
  pageIndex?: number;
  /** Section/paragraph IDs where this citation appears (for back-links) */
  occurrences: CitationOccurrence[];
}

export interface CitationOccurrence {
  /** Unique occurrence ID */
  id: string;
  /** Section ID (e.g., "actII", "actIII") */
  sectionId: string;
  /** Paragraph index within section */
  paragraphIndex: number;
  /** Character offset within paragraph */
  charOffset?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CITATION LIBRARY - Collection of all citations in a document
// ═══════════════════════════════════════════════════════════════════════════

export interface CitationLibrary {
  /** All citations indexed by ID */
  citations: Record<string, Citation>;
  /** Ordered list of citation IDs (for footnote numbering) */
  order: string[];
  /** Last updated timestamp */
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CITATION SYNTAX HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Citation syntax in narrative text:
 * - `{{cite:id}}` - Simple citation marker
 * - `{{cite:id|label}}` - Citation with custom inline label
 * - `{{cite:id|label|type:quote}}` - Citation with type override
 * - `{{cite:id|label|type:document|page:3}}` - Citation with page reference
 *
 * Examples:
 * - "AWS announced new pricing{{cite:aws-blog-001}}"
 * - "The {{cite:arxiv-paper|reliability gap|type:data}} remains critical"
 * - "Found on {{cite:doc_cv|Homen Shum CV|type:document|page:3}} page 3"
 */
export const CITATION_REGEX = /\{\{cite:([^|}]+)(?:\|([^|}]+))?(?:\|type:([^|}]+))?(?:\|page:(\d+))?\}\}/g;

/**
 * Parse citation tokens from text
 */
export interface ParsedCitation {
  id: string;
  label?: string;
  type?: CitationType;
  pageIndex?: number;
  fullMatch: string;
  startIndex: number;
  endIndex: number;
}

export function parseCitations(text: string): ParsedCitation[] {
  const citations: ParsedCitation[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(CITATION_REGEX.source, "g");

  while ((match = regex.exec(text)) !== null) {
    citations.push({
      id: match[1],
      label: match[2],
      type: match[3] as CitationType | undefined,
      pageIndex: match[4] ? parseInt(match[4], 10) : undefined,
      fullMatch: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return citations;
}

/**
 * Create a new citation library
 */
export function createCitationLibrary(): CitationLibrary {
  return {
    citations: {},
    order: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Add a citation to the library
 */
export function addCitation(
  library: CitationLibrary,
  citation: Omit<Citation, "number" | "occurrences">,
): CitationLibrary {
  const number = library.order.length + 1;
  const newCitation: Citation = {
    ...citation,
    number,
    occurrences: [],
  };

  return {
    citations: { ...library.citations, [citation.id]: newCitation },
    order: [...library.order, citation.id],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get citation by ID
 */
export function getCitation(library: CitationLibrary, id: string): Citation | undefined {
  return library.citations[id];
}

/**
 * Get all citations in order
 */
export function getOrderedCitations(library: CitationLibrary): Citation[] {
  return library.order.map((id) => library.citations[id]).filter(Boolean);
}

