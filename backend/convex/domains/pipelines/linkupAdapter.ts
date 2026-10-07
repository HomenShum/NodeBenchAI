/**
 * Linkup Search Adapter
 *
 * Thin HTTP wrapper around `https://api.linkup.so/v1/search` for use
 * inside pipelines. Distinct from `convex/tools/media/linkupSearch.ts`
 * which exposes Linkup as a Convex Agent `createTool` (heavyweight ToolCtx).
 *
 * Honors agentic_reliability invariants:
 *   - TIMEOUT  — AbortController + 30s default budget
 *   - SSRF     — Linkup endpoint is constant; no user-controlled URLs
 *   - BOUND    — maxResults capped at 10; snippets clipped at 600 chars
 *   - HONEST_STATUS — throws typed error on non-2xx; never silently empty
 *
 * Returns null when LINKUP_API_KEY is absent so callers can degrade
 * gracefully (research pipeline falls back to internal-knowledge synth).
 */

"use node";

const LINKUP_ENDPOINT = "https://api.linkup.so/v1/search";

export interface LinkupSnippet {
  url: string;
  title: string;
  snippet: string;
  publishedAtIso?: string;
}

export interface LinkupSearchInput {
  query: string;
  /** "standard" (~€0.005) or "deep" (~€0.05). Default "standard". */
  depth?: "standard" | "deep";
  /** ISO YYYY-MM-DD lower bound on result publish date. */
  fromDate?: string;
  /** ISO YYYY-MM-DD upper bound on result publish date. */
  toDate?: string;
  /** Cap on returned text snippets. Linkup's API decides default; we clamp ≤ 10. */
  maxResults?: number;
  /** Wall-clock budget. Default 30000 ms. */
  timeoutMs?: number;
}

export interface LinkupSearchResult {
  query: string;
  snippets: LinkupSnippet[];
  /** True when Linkup wasn't called (no API key); caller should fall back. */
  fallback: boolean;
  errorMessage?: string;
}

function clip(input: string | undefined, max: number): string {
  if (!input) return "";
  return input.length > max ? input.slice(0, max - 1) + "…" : input;
}

/**
 * Run a single Linkup search. Returns the search snippets in shape
 * suitable for LLM prompt injection. Returns `{ fallback: true }` when
 * `LINKUP_API_KEY` isn't set so callers can gracefully degrade.
 */
export async function runLinkupSearch(input: LinkupSearchInput): Promise<LinkupSearchResult> {
  const apiKey = process.env.LINKUP_API_KEY;
  if (!apiKey) {
    return {
      query: input.query,
      snippets: [],
      fallback: true,
      errorMessage: "LINKUP_API_KEY not set",
    };
  }
  const maxResults = Math.min(input.maxResults ?? 5, 10);
  const timeoutMs = input.timeoutMs ?? 30_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("linkup_timeout")), timeoutMs);

  try {
    const body = {
      q: input.query,
      depth: input.depth ?? "standard",
      outputType: "searchResults",
      includeImages: false,
      maxResults,
      fromDate: input.fromDate,
      toDate: input.toDate,
    };

    const response = await fetch(LINKUP_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `linkup_http_${response.status}: ${errText.slice(0, 280)}`,
      );
    }

    const json = (await response.json()) as {
      results?: Array<{
        type?: string;
        url?: string;
        name?: string;
        content?: string;
        publishedAt?: string;
      }>;
    };
    const results = Array.isArray(json.results) ? json.results : [];
    const snippets: LinkupSnippet[] = results
      .filter((r) => r?.type === "text" && typeof r.url === "string")
      .slice(0, maxResults)
      .map((r) => ({
        url: r.url!,
        title: clip(r.name ?? r.url, 160),
        snippet: clip(r.content, 600),
        publishedAtIso: r.publishedAt,
      }));

    return {
      query: input.query,
      snippets,
      fallback: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Format a list of snippets for LLM prompt injection.
 *
 * Each snippet is numbered so the model can cite via [N] markers; the
 * caller passes back the same numbering when collecting citations.
 */
export function formatSnippetsForPrompt(
  snippets: Array<{ url: string; title: string; snippet: string }>,
): string {
  if (snippets.length === 0) return "(no sources retrieved)";
  return snippets
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\n    URL: ${s.url}\n    ${s.snippet.replace(/\n/g, " ")}`,
    )
    .join("\n\n");
}
