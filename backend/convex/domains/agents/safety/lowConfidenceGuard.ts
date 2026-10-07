/**
 * Low-Confidence Guard
 *
 * Wraps the retrieval stage for fast mode. Classifies retrieval confidence
 * from snippet count + freshness + grounding signals. When `low`, returns
 * an "insufficient data" card payload instead of allowing the LLM to
 * fabricate specifics.
 *
 * Rule: .claude/rules/grounded_eval.md Layer 1 (retrieval confidence threshold)
 * Rule: .claude/rules/agentic_reliability.md HONEST_STATUS, HONEST_SCORES
 */

export type RetrievalConfidence = "high" | "medium" | "low";

export interface SourceSnippet {
  url: string;
  title: string;
  snippet: string;
  fetchedAt?: number;
  sourceClass?: "news" | "regulatory" | "careers" | "profile" | "other";
}

export interface RetrievalState {
  snippets: SourceSnippet[];
  scratchpadHit: boolean;
  artifactBlockHit: boolean;
  eslHit: boolean;
  queriedAt: number;
}

const MIN_SNIPPETS_FOR_HIGH = 3;
const MIN_SNIPPETS_FOR_MEDIUM = 1;
const NEWS_FRESHNESS_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function classifyRetrievalConfidence(state: RetrievalState): RetrievalConfidence {
  // Artifact hit is the strongest signal — user already accepted content
  if (state.artifactBlockHit) return "high";

  // ESL hit is near-strong — deterministic public fact already extracted
  if (state.eslHit && state.snippets.length >= MIN_SNIPPETS_FOR_MEDIUM) return "high";

  // Snippet-count driven classification
  const fresh = state.snippets.filter((s) => isFreshForClass(s, state.queriedAt));

  if (fresh.length >= MIN_SNIPPETS_FOR_HIGH) return "high";
  if (fresh.length >= MIN_SNIPPETS_FOR_MEDIUM) return "medium";
  return "low";
}

function isFreshForClass(snippet: SourceSnippet, now: number): boolean {
  if (!snippet.fetchedAt) return true; // trust if caller didn't timestamp
  const ageMs = now - snippet.fetchedAt;
  if (snippet.sourceClass === "news") return ageMs <= NEWS_FRESHNESS_MS;
  return true;
}

export interface LowConfidenceCard {
  kind: "low_confidence";
  title: string;
  body: string;
  ctaLabel: string;
  ctaAction: "escalate_to_slow" | "retry_with_different_entity" | "clarify";
  snippetCount: number;
  reason: string;
}

/**
 * Produce the card payload when retrieval confidence is insufficient for a
 * fast-mode answer. The runtime SHOULD return this instead of calling the
 * LLM on empty context.
 */
export function buildLowConfidenceCard(
  query: string,
  state: RetrievalState,
): LowConfidenceCard {
  const fresh = state.snippets.filter((s) => isFreshForClass(s, state.queriedAt));
  const snippetCount = fresh.length;

  if (snippetCount === 0) {
    return {
      kind: "low_confidence",
      title: "No reliable sources found",
      body: `I could not find fresh, citable sources for "${query}". Running a deeper research pass may surface more context, but I will not guess specifics without sources.`,
      ctaLabel: "Run deep research",
      ctaAction: "escalate_to_slow",
      snippetCount: 0,
      reason: "zero fresh snippets; cannot ground any specific claim",
    };
  }

  return {
    kind: "low_confidence",
    title: "Limited sources — answer provisional",
    body: `I only have ${snippetCount} fresh source${snippetCount === 1 ? "" : "s"} for "${query}". I can give a short provisional take, or run a deeper research pass for broader coverage.`,
    ctaLabel: "Run deep research",
    ctaAction: "escalate_to_slow",
    snippetCount,
    reason: `${snippetCount} snippets below high-confidence threshold of ${MIN_SNIPPETS_FOR_HIGH}`,
  };
}

/**
 * Decision helper: should the runtime stream an LLM answer at all?
 *
 * - `high` → stream the answer
 * - `medium` → stream with uncertainty framing
 * - `low` → return the card, DO NOT invoke the LLM
 */
export function shouldStreamAnswer(confidence: RetrievalConfidence): "stream" | "stream_with_caveat" | "return_card" {
  switch (confidence) {
    case "high":
      return "stream";
    case "medium":
      return "stream_with_caveat";
    case "low":
      return "return_card";
  }
}
