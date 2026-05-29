/**
 * Tri-search — the third retrieval leg for the NodeBench grounding harness.
 *
 * NodeBench already runs lexical (hybrid: keyword/fuzzy/n-gram/prefix/bigram)
 * + dense (TF-IDF cosine + Agent-as-a-Graph wRRF). What the grounding/answer
 * path lacked was a precision leg: retrieved web/Linkup/entity sources were
 * ordered by ORIGIN (Linkup -> web -> cache), not by measured relevance. This
 * module adds the standard "retrieve -> fuse -> rerank" precision stage:
 *   1. Reciprocal Rank Fusion (RRF) over N ranked candidate lists.
 *   2. A Gemini Flash-Lite cross-encoder-style relevance rerank of the top-N.
 *
 * Pattern: tri-search (sparse + dense + rerank), fused with RRF.
 * Prior art:
 *   - Reciprocal Rank Fusion — Cormack, Clarke, Buttcher (SIGIR 2009), k=60.
 *     https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf
 *   - Anthropic "Contextual Retrieval" — hybrid retrieval + rerank.
 *     https://www.anthropic.com/news/contextual-retrieval
 *   - Windsurf "Riptide" — embeddings candidate gen -> LLM reranker.
 * See: docs/architecture/TRI_SEARCH.md (to be written)
 *
 * Reliability (.claude/rules/agentic_reliability.md):
 *   TIMEOUT       — AbortSignal.timeout on the rerank call; falls back on abort.
 *   BOUND         — candidate list capped at MAX_RERANK_CANDIDATES.
 *   HONEST_STATUS — rerank failure returns the fused order with status="fallback";
 *                   never fabricates a ranking.
 *   DETERMINISTIC — temperature 0; out-of-range/duplicate indices sanitized;
 *                   omitted candidates appended in fused order (stable completeness).
 *   BOUND_READ    — snippet/title truncated before they enter the prompt.
 */

export interface TriCandidate {
  /** Stable identity for dedup across legs — prefer the URL, else a label. */
  id: string;
  title?: string;
  snippet?: string;
  url?: string;
  /** Which retrieval leg produced this candidate: "linkup" | "web" | "entity" | ... */
  source: string;
}

export type FusedCandidate = TriCandidate & { fusedScore: number; fusedRank: number };

export type RerankStatus = "ok" | "skipped" | "fallback";

export interface RerankResult {
  ranked: TriCandidate[];
  rerankStatus: RerankStatus;
  detail: string;
  durationMs: number;
}

export const RRF_K = 60;
export const MAX_RERANK_CANDIDATES = 12;
// NOTE: must be a real model id the key can reach (verified via GET /v1beta/models).
// "gemini-2.5-flash-lite-preview" 404s — the correct stable id is "gemini-2.5-flash-lite".
const RERANK_MODEL = process.env.TRI_SEARCH_RERANK_MODEL || "gemini-2.5-flash-lite";
const RERANK_TIMEOUT_MS = Number(process.env.TRI_SEARCH_RERANK_TIMEOUT_MS) || 6000;
const MAX_TITLE = 120;
const MAX_SNIPPET = 280;

/**
 * Reciprocal Rank Fusion. Each input list is a ranked array (best first).
 * Returns deduped candidates sorted by fused score desc, with a stable
 * `fusedRank`. Rank-based, so heterogeneous leg scores need no normalization.
 */
export function rrfFuse(lists: TriCandidate[][], k = RRF_K): FusedCandidate[] {
  const byId = new Map<string, TriCandidate & { fusedScore: number }>();
  for (const list of lists) {
    list.forEach((cand, idx) => {
      if (!cand || !cand.id) return;
      const contrib = 1 / (k + idx + 1); // idx is 0-based -> rank is idx+1
      const existing = byId.get(cand.id);
      if (existing) {
        existing.fusedScore += contrib;
        existing.title = existing.title || cand.title;
        existing.snippet = existing.snippet || cand.snippet;
        existing.url = existing.url || cand.url;
      } else {
        byId.set(cand.id, { ...cand, fusedScore: contrib });
      }
    });
  }
  return Array.from(byId.values())
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .map((c, i) => ({ ...c, fusedRank: i }));
}

function fusedTopN(candidates: TriCandidate[], topN: number): TriCandidate[] {
  return candidates.slice(0, topN); // input is already in fused order
}

/**
 * Gemini Flash-Lite cross-encoder-style rerank. Reorders `candidates` by
 * relevance to `query`. HONEST fallback: any missing key / non-2xx / timeout /
 * unparseable response returns the input (fused) order with status reflecting why.
 */
export async function rerankWithGemini(
  query: string,
  candidates: Array<TriCandidate & { fusedRank?: number }>,
  opts: { topN?: number; timeoutMs?: number; apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<RerankResult> {
  const startedAt = Date.now();
  const topN = opts.topN ?? 5;
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  const doFetch = opts.fetchImpl ?? fetch;
  const bounded = candidates.slice(0, MAX_RERANK_CANDIDATES);

  if (!apiKey) {
    return { ranked: fusedTopN(bounded, topN), rerankStatus: "skipped", detail: "GEMINI_API_KEY not set; fused order kept.", durationMs: Date.now() - startedAt };
  }
  if (bounded.length <= 1) {
    return { ranked: fusedTopN(bounded, topN), rerankStatus: "skipped", detail: "<=1 candidate; nothing to rerank.", durationMs: Date.now() - startedAt };
  }

  const numbered = bounded
    .map((c, i) => `[${i}] ${(c.title || c.url || "untitled").slice(0, MAX_TITLE)} - ${(c.snippet || "").slice(0, MAX_SNIPPET)}`)
    .join("\n");
  const prompt = [
    "You are a search reranker. Given a QUERY and NUMBERED candidate sources,",
    "order the candidate indices from MOST to LEAST relevant for answering the query.",
    "Judge by topical relevance and specificity to the query, not by their given order.",
    `Return ONLY a JSON array of integers (no prose), e.g. [3,0,1]. Include at most the top ${topN}.`,
    "",
    `QUERY: ${query}`,
    "",
    "CANDIDATES:",
    numbered,
  ].join("\n");

  try {
    const resp = await doFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${RERANK_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 96 },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? RERANK_TIMEOUT_MS),
      },
    );
    if (!resp.ok) {
      return { ranked: fusedTopN(bounded, topN), rerankStatus: "fallback", detail: `rerank HTTP ${resp.status}; fused order kept.`, durationMs: Date.now() - startedAt };
    }
    const data: any = await resp.json();
    const text: string = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => p?.text ?? "")
      .join("");
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) {
      return { ranked: fusedTopN(bounded, topN), rerankStatus: "fallback", detail: "no JSON array in rerank response; fused order kept.", durationMs: Date.now() - startedAt };
    }
    let order: unknown;
    try { order = JSON.parse(match[0]); } catch {
      return { ranked: fusedTopN(bounded, topN), rerankStatus: "fallback", detail: "rerank response not valid JSON; fused order kept.", durationMs: Date.now() - startedAt };
    }
    if (!Array.isArray(order)) {
      return { ranked: fusedTopN(bounded, topN), rerankStatus: "fallback", detail: "rerank response not an array; fused order kept.", durationMs: Date.now() - startedAt };
    }
    const seen = new Set<number>();
    const ranked: TriCandidate[] = [];
    for (const raw of order) {
      const idx = Number(raw);
      if (Number.isInteger(idx) && idx >= 0 && idx < bounded.length && !seen.has(idx)) {
        seen.add(idx);
        ranked.push(bounded[idx]);
      }
    }
    // Append any candidate the reranker omitted, in fused order — deterministic completeness.
    bounded.forEach((c, i) => { if (!seen.has(i)) ranked.push(c); });
    return { ranked: ranked.slice(0, topN), rerankStatus: "ok", detail: `reranked ${bounded.length} candidates -> top ${Math.min(topN, ranked.length)}.`, durationMs: Date.now() - startedAt };
  } catch (err: any) {
    const aborted = err?.name === "TimeoutError" || err?.name === "AbortError";
    return {
      ranked: fusedTopN(bounded, topN),
      rerankStatus: "fallback",
      detail: aborted
        ? `rerank timed out after ${opts.timeoutMs ?? RERANK_TIMEOUT_MS}ms; fused order kept.`
        : `rerank failed: ${err?.message || String(err)}; fused order kept.`,
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Convenience: fuse N retrieval legs with RRF, then rerank the top-N.
 * Returns the ranked candidates plus a trace-ready summary (emit one trace
 * step per leg upstream, then a "rerank" step with these fields).
 */
export async function triSearch(
  query: string,
  legs: TriCandidate[][],
  opts: { topN?: number; timeoutMs?: number; apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ ranked: TriCandidate[]; fusedCount: number; rerankStatus: RerankStatus; detail: string; durationMs: number }> {
  const fused = rrfFuse(legs);
  const r = await rerankWithGemini(query, fused, opts);
  return { ranked: r.ranked, fusedCount: fused.length, rerankStatus: r.rerankStatus, detail: r.detail, durationMs: r.durationMs };
}
