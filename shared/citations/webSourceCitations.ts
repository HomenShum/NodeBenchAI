// shared/citations/webSourceCitations.ts
// Shared helper for stable citation IDs on claim-bound web sources.
// Source retrieval alone never creates an inline citation relationship.

export interface WebSourceLike {
  title?: string;
  url: string;
  domain?: string;
  description?: string;
  publishedAt?: string;
}

function normalizeUrlForId(url: string): string {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "";

  // Avoid throwing for non-URL strings; we just normalize lightly.
  // Keep query params because they can uniquely identify pages.
  return trimmed.replace(/#.*$/, "");
}

/**
 * FNV-1a 32-bit hash (hex) for stable, short identifiers.
 * Deterministic across JS runtimes.
 */
export function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619 (mod 2^32)
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Stable citation ID for a web source URL.
 * Example: "websrc_9f86d081"
 */
export function makeWebSourceCitationId(url: string): string {
  const normalized = normalizeUrlForId(url);
  return `websrc_${fnv1a32Hex(normalized || String(url ?? ""))}`;
}

