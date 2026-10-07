/**
 * Search Fusion Types
 * 
 * Unified types for multi-source search fusion.
 * All search sources must conform to these interfaces.
 * 
 * @module search/fusion/types
 */

import type { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH SOURCE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Available search sources */
export type SearchSource =
  | "linkup"          // External web search via LinkUp API (pay per use)
  | "brave"           // Brave Search API (2,000 free/month)
  | "serper"          // Serper Google SERP (2,500 free/month)
  | "tavily"          // Tavily AI-native search (1,000 free/month)
  | "exa"             // Exa AI neural search (2,000 one-time)
  | "sec"             // SEC EDGAR filings
  | "rag"             // Internal RAG (vector + keyword)
  | "documents"       // Direct document search
  | "news"            // News articles
  | "youtube"         // YouTube videos
  | "arxiv"           // Academic papers
  | "fda"             // FDA OpenFDA device/drug data
  | "finra"           // FINRA BrokerCheck / funding portals
  | "uspto"           // USPTO PatentsView
  | "state_registry"; // State Secretary of State registries

/** Search mode determines which sources to query and how */
export type SearchMode = 
  | "fast"          // Single best source, no fusion
  | "balanced"      // 2-3 sources, RRF fusion
  | "comprehensive"; // All sources, LLM reranking

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED SEARCH RESULT
// ═══════════════════════════════════════════════════════════════════════════

/** Unified search result from any source */
export interface SearchResult {
  /** Unique identifier for this result */
  id: string;
  
  /** Source that produced this result */
  source: SearchSource;
  
  /** Result title */
  title: string;
  
  /** Result snippet/summary */
  snippet: string;
  
  /** Full URL (for external sources) */
  url?: string;
  
  /** Document ID (for internal sources) */
  documentId?: Id<"documents">;
  
  /** Relevance score (0-1, normalized) */
  score: number;
  
  /** Original rank from source (1-based) */
  originalRank: number;
  
  /** Fused rank after RRF (1-based) */
  fusedRank?: number;
  
  /** Content type */
  contentType: "text" | "pdf" | "video" | "image" | "filing" | "news" | "patent" | "organization";
  
  /** Publication/creation date */
  publishedAt?: string;
  
  /** Author or organization */
  author?: string;
  
  /** Additional metadata from source */
  metadata?: Record<string, unknown>;
  
  /** Highlight snippets for display */
  highlights?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH REQUEST/RESPONSE
// ═══════════════════════════════════════════════════════════════════════════

/** Search request configuration */
export interface SearchRequest {
  /** Search query */
  query: string;
  
  /** Search mode */
  mode: SearchMode;
  
  /** Specific sources to query (optional, defaults based on mode) */
  sources?: SearchSource[];
  
  /** Maximum results per source */
  maxPerSource?: number;
  
  /** Maximum total results after fusion */
  maxTotal?: number;
  
  /** Enable LLM reranking */
  enableReranking?: boolean;
  
  /** Filter by content type */
  contentTypes?: SearchResult["contentType"][];
  
  /** Filter by date range */
  dateRange?: {
    start?: string;
    end?: string;
  };
  
  /** User ID for personalization */
  userId?: Id<"users">;

  /** Allow paid external providers such as Linkup. Defaults to false. */
  allowPaidSearch?: boolean;
}

/** Search response with results and metadata */
export interface SearchResponse {
  /** Fused and ranked results */
  results: SearchResult[];
  
  /** Total results before fusion */
  totalBeforeFusion: number;
  
  /** Search mode used */
  mode: SearchMode;
  
  /** Sources queried */
  sourcesQueried: SearchSource[];
  
  /** Per-source timing (ms) */
  timing: Record<SearchSource, number>;
  
  /** Total execution time (ms) */
  totalTimeMs: number;
  
  /** Whether LLM reranking was applied */
  reranked: boolean;
  
  /** Any errors from sources */
  errors?: Array<{
    source: SearchSource;
    error: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE ADAPTER INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

/** Interface that all search source adapters must implement */
export interface SearchSourceAdapter {
  /** Source identifier */
  source: SearchSource;
  
  /** Execute search and return normalized results */
  search(query: string, options: SearchAdapterOptions): Promise<SearchResult[]>;
  
  /** Check if source is available (API key configured, etc.) */
  isAvailable(): boolean;
}

/** Options passed to source adapters */
export interface SearchAdapterOptions {
  maxResults: number;
  contentTypes?: SearchResult["contentType"][];
  dateRange?: SearchRequest["dateRange"];
  userId?: Id<"users">;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERSIONED TOOL OUTPUT CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Current version of the FusionSearchPayload schema.
 * Increment when making breaking changes to payload structure.
 */
export const FUSION_SEARCH_PAYLOAD_VERSION = 1 as const;

/**
 * Discriminated wrapper for fusion search tool outputs.
 * This contract is shared between:
 * - Producer: fusionSearch/quickSearch actions (backend)
 * - Consumer: parseFusionSearchOutput (UI)
 *
 * @version 1 - Initial versioned contract
 */
export interface FusionSearchPayload {
  /** Discriminator for type identification */
  kind: "fusion_search_results";
  /** Schema version for forward compatibility */
  version: typeof FUSION_SEARCH_PAYLOAD_VERSION;
  /** The actual search response */
  payload: SearchResponse;
  /** Timestamp of payload generation (ISO 8601) */
  generatedAt: string;
}

/**
 * Per-source streaming status for UI state management.
 * Used to distinguish between: pending, completed, failed, disabled.
 */
export interface SourceStreamingStatus {
  source: SearchSource;
  status: "pending" | "completed" | "failed" | "disabled";
  latencyMs?: number;
  error?: string;
  resultCount?: number;
}

/**
 * Streaming-aware search response with per-source status.
 * Extends SearchResponse with real-time status tracking.
 */
export interface StreamingSearchResponse extends SearchResponse {
  /** Whether all sources have completed */
  isComplete: boolean;
  /** Per-source streaming status */
  sourceStatus: SourceStreamingStatus[];
}

/**
 * Type guard to validate FusionSearchPayload structure at runtime.
 * Returns detailed error message on failure.
 */
export function validateFusionSearchPayload(
  data: unknown
): { valid: true; payload: FusionSearchPayload } | { valid: false; error: string } {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "Payload must be a non-null object" };
  }

  const obj = data as Record<string, unknown>;

  // Check discriminator
  if (obj.kind !== "fusion_search_results") {
    return {
      valid: false,
      error: `Invalid discriminator: expected 'fusion_search_results', got '${obj.kind}'`
    };
  }

  // Check version
  if (typeof obj.version !== "number" || obj.version < 1) {
    return {
      valid: false,
      error: `Invalid version: expected number >= 1, got '${obj.version}'`
    };
  }

  // Version compatibility check
  if (obj.version > FUSION_SEARCH_PAYLOAD_VERSION) {
    return {
      valid: false,
      error: `Unsupported version: payload is v${obj.version}, consumer supports up to v${FUSION_SEARCH_PAYLOAD_VERSION}`
    };
  }

  // Check payload structure
  if (!obj.payload || typeof obj.payload !== "object") {
    return { valid: false, error: "Missing or invalid 'payload' field" };
  }

  const payload = obj.payload as Record<string, unknown>;

  // Validate required SearchResponse fields
  if (!Array.isArray(payload.results)) {
    return { valid: false, error: "payload.results must be an array" };
  }

  if (typeof payload.mode !== "string") {
    return { valid: false, error: "payload.mode must be a string" };
  }

  if (!Array.isArray(payload.sourcesQueried)) {
    return { valid: false, error: "payload.sourcesQueried must be an array" };
  }

  // Validate each result has required fields
  for (let i = 0; i < payload.results.length; i++) {
    const result = payload.results[i] as Record<string, unknown>;
    if (!result.id || typeof result.id !== "string") {
      return { valid: false, error: `payload.results[${i}].id must be a string` };
    }
    if (!result.source || typeof result.source !== "string") {
      return { valid: false, error: `payload.results[${i}].source must be a string` };
    }
    if (!result.title || typeof result.title !== "string") {
      return { valid: false, error: `payload.results[${i}].title must be a string` };
    }
  }

  return { valid: true, payload: data as FusionSearchPayload };
}

/**
 * Create a versioned FusionSearchPayload from a SearchResponse.
 * Use this in actions to wrap responses before returning.
 */
export function wrapSearchResponse(response: SearchResponse): FusionSearchPayload {
  return {
    kind: "fusion_search_results",
    version: FUSION_SEARCH_PAYLOAD_VERSION,
    payload: response,
    generatedAt: new Date().toISOString(),
  };
}
