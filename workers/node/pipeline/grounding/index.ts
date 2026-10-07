/**
 * Grounding — claim-level anti-hallucination filter for agent outputs.
 *
 * Pattern: Layer 2 of the 4-layer grounding pipeline (retrieval confidence →
 *          claim filter → grounded judge → citation chain).
 *
 * Prior art:
 *   - Deepchecks "LLM claim-level verification" (2024)
 *   - arXiv:2510.24476 — RAG + reasoning + agentic systems
 *   - Google Vertex AI grounding pipeline research
 *
 * See: docs/architecture/USER_FEEDBACK_SECURITY.md ·
 *      .claude/rules/grounded_eval.md
 *      .claude/rules/scratchpad_first.md (structuring pass uses this)
 *
 * This module centralizes the `isGrounded` check so every diligence block,
 * every search route, and every structuring pass can rely on ONE
 * implementation. Drift between inline copies was a real bug source —
 * see `server/routes/search.ts` for the historical inline copy this
 * module supersedes.
 */

/**
 * Coarse grounding filter: rejects claims with ZERO word overlap against
 * the retrieved source corpus. Intentionally lenient — a downstream
 * semantic judge (Gemini, etc.) handles nuanced verification.
 *
 * Rules:
 *  - Empty claim → passes (nothing to reject)
 *  - Very short source corpus (<50 chars) → passes (not enough signal to filter)
 *  - No substantive words (>4 chars) in the claim → passes (short slogans unverifiable either way)
 *  - Otherwise: at least ONE word of length >4 must appear in the source corpus
 *
 * @param claim       The extracted claim text (e.g., a signal name, a risk description)
 * @param sourceText  The full retrieved source corpus concatenated (lowercased internally)
 * @returns true if the claim has at least one substantive word overlap
 *
 * @example
 * ```ts
 * const sources = await fetchSources(entity);
 * const corpus = sources.map(s => s.text).join(" ");
 * const grounded = extracted.filter(claim => isGrounded(claim.text, corpus));
 * ```
 */
export function isGrounded(claim: string, sourceText: string): boolean {
  if (!claim || !sourceText || sourceText.length < 50) return true;
  const lowerSource = sourceText.toLowerCase();
  const words = claim
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 4);
  if (words.length === 0) return true;
  const matched = words.filter((w) => lowerSource.includes(w));
  return matched.length >= 1;
}

/**
 * Batch variant: filter a list of items, keeping only those whose claim text
 * is grounded against the shared source corpus. Returns the kept items plus
 * a count of how many were dropped.
 *
 * Use when a sub-agent extracts N candidates and you want one pass of
 * grounding across all of them.
 */
export function filterGrounded<T>(
  items: readonly T[],
  getClaimText: (item: T) => string,
  sourceText: string,
): { kept: T[]; droppedCount: number } {
  const kept: T[] = [];
  let droppedCount = 0;
  for (const item of items) {
    const text = getClaimText(item);
    if (isGrounded(text, sourceText)) {
      kept.push(item);
    } else {
      droppedCount += 1;
    }
  }
  return { kept, droppedCount };
}

/**
 * Build a source-text corpus from an array of snippets. Idempotent and
 * deterministic: the same snippets always produce the same corpus string.
 *
 * Deterministic construction is important for HONEST_SCORES + DETERMINISTIC
 * rules — grounded/ungrounded counts must be reproducible across runs.
 */
export function buildSourceCorpus(snippets: readonly string[]): string {
  return snippets
    .map((s) => s ?? "")
    .filter((s) => s.length > 0)
    .join(" ");
}

/**
 * Retrieval confidence tier — Layer 1 of the grounding pipeline.
 * Classifies the source quality BEFORE extraction runs, so sub-agents can
 * bail early when the evidence base is too thin.
 *
 * @param snippetCount  Number of source snippets retrieved
 * @returns "high" (3+) | "medium" (1-2) | "low" (0)
 */
export type RetrievalConfidence = "high" | "medium" | "low";

export function getRetrievalConfidence(snippetCount: number): RetrievalConfidence {
  if (snippetCount >= 3) return "high";
  if (snippetCount >= 1) return "medium";
  return "low";
}
