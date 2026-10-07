/**
 * Structured Tool Output Contract
 *
 * Tools should return structured objects instead of strings with embedded HTML comments.
 * This enables:
 * 1. Direct data access without regex parsing
 * 2. Type-safe data consumption in the frontend
 * 3. Smaller token usage (LLM only sees summary, not full data)
 * 4. Better observability and debugging
 */

import { z } from "zod";

// ============================================================================
// Base Output Schema
// ============================================================================

/**
 * All structured tool outputs must have:
 * - kind: A discriminator for the output type
 * - version: Schema version for backwards compatibility
 * - summary: Human-readable summary for the LLM
 * - data: Structured data for the UI
 */
export const BaseStructuredOutput = z.object({
  kind: z.string(),
  version: z.number().default(1),
  summary: z.string().describe("Human-readable summary for the LLM"),
});

// ============================================================================
// YouTube Search Output
// ============================================================================

export const YouTubeVideoSchema = z.object({
  title: z.string(),
  channel: z.string(),
  description: z.string(),
  url: z.string(),
  videoId: z.string(),
  thumbnail: z.string().optional(),
});

export const YouTubeSearchOutput = BaseStructuredOutput.extend({
  kind: z.literal("youtube_search_results"),
  data: z.object({
    videos: z.array(YouTubeVideoSchema),
    query: z.string(),
    totalResults: z.number(),
  }),
});

export type YouTubeSearchOutputType = z.infer<typeof YouTubeSearchOutput>;

// ============================================================================
// SEC Filing Output
// ============================================================================

export const SECDocumentSchema = z.object({
  title: z.string(),
  formType: z.string(),
  filingDate: z.string(),
  accessionNumber: z.string(),
  documentUrl: z.string(),
  viewerUrl: z.string().optional(),
  ticker: z.string().optional(),
  companyName: z.string().optional(),
});

export const SECFilingSearchOutput = BaseStructuredOutput.extend({
  kind: z.literal("sec_filing_results"),
  data: z.object({
    documents: z.array(SECDocumentSchema),
    query: z.string(),
    totalResults: z.number(),
  }),
});

export type SECFilingSearchOutputType = z.infer<typeof SECFilingSearchOutput>;

// ============================================================================
// Selection Prompts (Company, Person, Event, News)
// ============================================================================

export const CompanyOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  ticker: z.string().optional(),
  description: z.string().optional(),
  sector: z.string().optional(),
  market_cap: z.string().optional(),
});

export const CompanySelectionOutput = BaseStructuredOutput.extend({
  kind: z.literal("company_selection"),
  data: z.object({
    prompt: z.string(),
    companies: z.array(CompanyOptionSchema),
  }),
});

export const PersonOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string().optional(),
  company: z.string().optional(),
  linkedinUrl: z.string().optional(),
});

export const PeopleSelectionOutput = BaseStructuredOutput.extend({
  kind: z.literal("people_selection"),
  data: z.object({
    prompt: z.string(),
    people: z.array(PersonOptionSchema),
  }),
});

export const EventOptionSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
});

export const EventSelectionOutput = BaseStructuredOutput.extend({
  kind: z.literal("event_selection"),
  data: z.object({
    prompt: z.string(),
    events: z.array(EventOptionSchema),
  }),
});

export const NewsArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string().optional(),
  url: z.string().optional(),
  publishedAt: z.string().optional(),
  snippet: z.string().optional(),
});

export const NewsSelectionOutput = BaseStructuredOutput.extend({
  kind: z.literal("news_selection"),
  data: z.object({
    prompt: z.string(),
    articles: z.array(NewsArticleSchema),
  }),
});

// ============================================================================
// Fusion Search Output (already structured, included for completeness)
// ============================================================================

export const FusionSearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().optional(),
  snippet: z.string().optional(),
  source: z.string(),
  score: z.number().optional(),
  metadata: z.record(z.any()).optional(),
});

export const FusionSearchOutput = BaseStructuredOutput.extend({
  kind: z.literal("fusion_search_results"),
  data: z.object({
    results: z.array(FusionSearchResultSchema),
    sourcesQueried: z.array(z.string()),
    errors: z.array(z.object({ source: z.string(), error: z.string() })).optional(),
    timing: z.record(z.number()).optional(),
    totalTimeMs: z.number().optional(),
  }),
});

// ============================================================================
// Linkup Web Search Output
// ============================================================================

export const WebSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  domain: z.string(),
  description: z.string().optional(),
  publishedAt: z.string().optional(),
});

export const ImageResultSchema = z.object({
  url: z.string(),
  alt: z.string(),
  thumbnail: z.string().optional(),
});

export const VideoResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  thumbnail: z.string().optional(),
});

export const AudioResultSchema = z.object({
  url: z.string(),
  title: z.string(),
});

export const LinkupSearchOutput = BaseStructuredOutput.extend({
  kind: z.literal("linkup_search_results"),
  data: z.object({
    query: z.string(),
    sources: z.array(WebSourceSchema).optional(),
    images: z.array(ImageResultSchema).optional(),
    videos: z.array(VideoResultSchema).optional(),
    audios: z.array(AudioResultSchema).optional(),
    citationKey: z.array(z.object({
      marker: z.string(),
      title: z.string(),
      domain: z.string(),
    })).optional(),
  }),
});

export type LinkupSearchOutputType = z.infer<typeof LinkupSearchOutput>;

// ============================================================================
// Union of all structured outputs
// ============================================================================

export const StructuredToolOutput = z.discriminatedUnion("kind", [
  YouTubeSearchOutput,
  SECFilingSearchOutput,
  CompanySelectionOutput,
  PeopleSelectionOutput,
  EventSelectionOutput,
  NewsSelectionOutput,
  FusionSearchOutput,
  LinkupSearchOutput,
]);

export type StructuredToolOutputType = z.infer<typeof StructuredToolOutput>;

// ============================================================================
// Helper to create structured output
// ============================================================================

/**
 * Creates a structured tool output with the proper format.
 * Use this in tool handlers to return structured data.
 *
 * @example
 * ```ts
 * return createStructuredOutput({
 *   kind: "youtube_search_results",
 *   summary: `Found ${videos.length} videos for "${query}"`,
 *   data: { videos, query, totalResults: videos.length },
 * });
 * ```
 */
export function createStructuredOutput<T extends StructuredToolOutputType>(
  output: Omit<T, "version"> & { version?: number }
): T {
  return {
    version: 1,
    ...output,
  } as T;
}

/**
 * Type guard to check if output is a structured tool output
 */
export function isStructuredOutput(output: unknown): output is StructuredToolOutputType {
  if (!output || typeof output !== "object") return false;
  const obj = output as Record<string, unknown>;
  return (
    typeof obj.kind === "string" &&
    typeof obj.version === "number" &&
    typeof obj.summary === "string" &&
    obj.data !== undefined
  );
}

/**
 * Extract structured data from tool output (handles both legacy and new formats)
 */
export function parseToolOutput(output: unknown): StructuredToolOutputType | null {
  // If already structured, validate and return
  if (isStructuredOutput(output)) {
    const result = StructuredToolOutput.safeParse(output);
    if (result.success) return result.data;
  }

  // Legacy: Try to parse embedded HTML comments (fallback)
  if (typeof output === "string") {
    // Try each pattern
    const patterns: Record<string, string> = {
      YOUTUBE_GALLERY: "youtube_search_results",
      SEC_GALLERY: "sec_filing_results",
      COMPANY_SELECTION: "company_selection",
      PEOPLE_SELECTION: "people_selection",
      EVENT_SELECTION: "event_selection",
      NEWS_SELECTION: "news_selection",
      FUSION_SEARCH: "fusion_search_results",
    };

    for (const [marker, kind] of Object.entries(patterns)) {
      const match = output.match(new RegExp(`<!-- ${marker}_DATA\\n([\\s\\S]*?)\\n-->`));
      if (match) {
        try {
          const data = JSON.parse(match[1]);
          // Convert legacy format to structured format
          return convertLegacyToStructured(kind, data);
        } catch {
          continue;
        }
      }
    }
  }

  return null;
}

function convertLegacyToStructured(kind: string, data: unknown): StructuredToolOutputType | null {
  switch (kind) {
    case "youtube_search_results":
      if (Array.isArray(data)) {
        return createStructuredOutput({
          kind: "youtube_search_results",
          summary: `Found ${data.length} videos`,
          data: { videos: data, query: "", totalResults: data.length },
        });
      }
      break;
    case "sec_filing_results":
      if (Array.isArray(data)) {
        return createStructuredOutput({
          kind: "sec_filing_results",
          summary: `Found ${data.length} SEC filings`,
          data: { documents: data, query: "", totalResults: data.length },
        });
      }
      break;
    case "company_selection":
      if (data && typeof data === "object" && "companies" in data) {
        const d = data as { prompt?: string; companies: unknown[] };
        return createStructuredOutput({
          kind: "company_selection",
          summary: d.prompt || "Select a company",
          data: { prompt: d.prompt || "", companies: d.companies as any },
        });
      }
      break;
    case "people_selection":
      if (data && typeof data === "object" && "people" in data) {
        const d = data as { prompt?: string; people: unknown[] };
        return createStructuredOutput({
          kind: "people_selection",
          summary: d.prompt || "Select a person",
          data: { prompt: d.prompt || "", people: d.people as any },
        });
      }
      break;
    case "event_selection":
      if (data && typeof data === "object" && "events" in data) {
        const d = data as { prompt?: string; events: unknown[] };
        return createStructuredOutput({
          kind: "event_selection",
          summary: d.prompt || "Select an event",
          data: { prompt: d.prompt || "", events: d.events as any },
        });
      }
      break;
    case "news_selection":
      if (data && typeof data === "object" && "articles" in data) {
        const d = data as { prompt?: string; articles: unknown[] };
        return createStructuredOutput({
          kind: "news_selection",
          summary: d.prompt || "Select an article",
          data: { prompt: d.prompt || "", articles: d.articles as any },
        });
      }
      break;
  }
  return null;
}
