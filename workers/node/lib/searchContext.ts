/**
 * SearchContext — In-memory cache for search context carry-forward.
 *
 * When a user does a follow-up search on the same entity, this module
 * provides the prior packet's context so the pipeline can build on it
 * instead of starting from scratch.
 *
 * Bounded: MAX_CONTEXTS with LRU eviction.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface SearchContextEntry {
  entityName: string;
  lens: string;
  query: string;
  answer: string;
  confidence: number;
  sourceUrls: string[];
  signals: string[];
  risks: string[];
  keyMetrics: Array<{ label: string; value: string }>;
  timestamp: number;
}

// ── Bounded LRU cache ────────────────────────────────────────────────

const MAX_CONTEXTS = 50;
const contextCache = new Map<string, SearchContextEntry>();

function makeKey(entityName: string, lens: string): string {
  return `${entityName.toLowerCase().trim()}:${lens}`;
}

export function setSearchContext(entry: SearchContextEntry): void {
  const key = makeKey(entry.entityName, entry.lens);

  // LRU eviction: delete oldest if at capacity
  if (contextCache.size >= MAX_CONTEXTS && !contextCache.has(key)) {
    const oldest = contextCache.keys().next().value;
    if (oldest) contextCache.delete(oldest);
  }

  // Delete + re-insert to move to end (LRU)
  contextCache.delete(key);
  contextCache.set(key, entry);
}

export function getSearchContext(entityName: string, lens: string): SearchContextEntry | null {
  const key = makeKey(entityName, lens);
  const entry = contextCache.get(key);
  if (!entry) return null;

  // Move to end (LRU touch)
  contextCache.delete(key);
  contextCache.set(key, entry);
  return entry;
}

/**
 * Build a context prompt snippet from prior search context.
 * Injected into the Gemini analyze prompt so the LLM builds on prior knowledge.
 */
export function buildContextPrompt(ctx: SearchContextEntry): string {
  const parts: string[] = [];
  parts.push(`Prior research on ${ctx.entityName} (${ctx.lens} lens, ${ctx.confidence}% confidence):`);
  if (ctx.answer) parts.push(`Summary: ${ctx.answer.slice(0, 300)}`);
  if (ctx.keyMetrics.length > 0) {
    parts.push(`Key metrics: ${ctx.keyMetrics.map((m) => `${m.label}: ${m.value}`).join(", ")}`);
  }
  if (ctx.signals.length > 0) parts.push(`Known signals: ${ctx.signals.slice(0, 5).join(", ")}`);
  if (ctx.risks.length > 0) parts.push(`Known risks: ${ctx.risks.slice(0, 3).join(", ")}`);
  parts.push("Build on this context. Focus on what's NEW or CHANGED.");
  return parts.join("\n");
}

export function getContextCacheStats(): { size: number; maxSize: number; entities: string[] } {
  return {
    size: contextCache.size,
    maxSize: MAX_CONTEXTS,
    entities: [...contextCache.values()].map((e) => `${e.entityName} (${e.lens})`),
  };
}
