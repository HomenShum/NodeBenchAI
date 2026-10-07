/**
 * evidenceSpan.ts — Structured evidence for search signals.
 *
 * Ported from TA Studio's ActionSpan pattern. Each signal gets
 * evidence spans that link claims to source material with
 * verification status.
 */

// ─── Types ───────────────────────────────────────────────────────

export type VerificationStatus = "verified" | "partial" | "unverified" | "contradicted";

export interface EvidenceSpan {
  /** Unique span ID */
  spanId: string;
  /** URL of the source (web, document, etc.) */
  sourceUrl: string | null;
  /** The specific claim or text this evidence supports */
  claimText: string;
  /** How well the source supports the claim */
  verificationStatus: VerificationStatus;
  /** 0-1 confidence in the verification */
  confidence: number;
  /** Snippet from the source that supports the claim */
  sourceSnippet: string;
  /** How this evidence was retrieved */
  retrievalMethod: "web_search" | "upload" | "mcp_tool" | "cached" | "inferred";
  /** Source title (for display) */
  sourceTitle: string;
}

export interface EvidenceManifest {
  /** Total evidence spans collected */
  totalSpans: number;
  /** Verified spans */
  verifiedCount: number;
  /** Partially verified */
  partialCount: number;
  /** Unverified (no matching source) */
  unverifiedCount: number;
  /** Contradicted by other evidence */
  contradictedCount: number;
  /** Overall verification rate (verified + partial) / total */
  verificationRate: number;
  /** All spans */
  spans: EvidenceSpan[];
}

// ─── Build evidence spans from search trace data ─────────────────

let spanCounter = 0;

function nextSpanId(): string {
  return `esp_${++spanCounter}_${Date.now().toString(36)}`;
}

/**
 * Extract evidence spans from the search pipeline's source snippets
 * and grounding metadata.
 */
export function createEvidenceSpans(
  sourceSnippets: Array<{
    url?: string;
    title?: string;
    snippet?: string;
    source?: string;
    kind?: string;
    corroboration?: "self_reported" | "external";
    qualityScore?: number;
  }>,
  signals: Array<{
    name?: string;
    title?: string;
    sourceIdx?: number;
  }>,
): EvidenceManifest {
  const spans: EvidenceSpan[] = [];

  // Create a span for each source snippet
  for (const src of sourceSnippets) {
    const snippet = src.snippet ?? src.source ?? "";
    if (!snippet) continue;

    // Find which signals reference this source
    const linkedSignals = signals.filter((s) => {
      if (s.sourceIdx != null && sourceSnippets.indexOf(src) === s.sourceIdx) return true;
      // Fuzzy: check if signal name appears in snippet
      const name = (s.name ?? s.title ?? "").toLowerCase();
      return name.length > 3 && snippet.toLowerCase().includes(name.slice(0, 20));
    });

    const isExternal = src.corroboration === "external";
    const isLowSignalKind = src.kind === "official_legal" || src.kind === "official_jobs" || src.kind === "social";
    const status: VerificationStatus =
      isLowSignalKind ? "unverified"
        : isExternal && snippet.length > 100 ? "verified"
          : snippet.length > 60 ? "partial"
            : snippet.length > 30 ? "partial"
              : "unverified";

    const confidence =
      status === "verified" ? Math.max(0.7, Math.min(0.95, (src.qualityScore ?? 85) / 100))
        : status === "partial" ? Math.max(0.35, Math.min(0.7, (src.qualityScore ?? 55) / 100))
          : 0.2;

    spans.push({
      spanId: nextSpanId(),
      sourceUrl: src.url ?? null,
      claimText: linkedSignals.map((s) => s.name ?? s.title ?? "").filter(Boolean).join("; ") || "General context",
      verificationStatus: status,
      confidence,
      sourceSnippet: snippet.slice(0, 300),
      retrievalMethod: src.url ? "web_search" : "inferred",
      sourceTitle: src.title ?? extractDomain(src.url) ?? "Source",
    });
  }

  // Check for unverified signals (no source snippet references them)
  for (const sig of signals) {
    const name = sig.name ?? sig.title ?? "";
    const hasEvidence = spans.some((sp) =>
      sp.claimText.toLowerCase().includes(name.toLowerCase().slice(0, 15)),
    );
    if (!hasEvidence && name) {
      spans.push({
        spanId: nextSpanId(),
        sourceUrl: null,
        claimText: name,
        verificationStatus: "unverified",
        confidence: 0.15,
        sourceSnippet: "",
        retrievalMethod: "inferred",
        sourceTitle: "No source found",
      });
    }
  }

  const verifiedCount = spans.filter((s) => s.verificationStatus === "verified").length;
  const partialCount = spans.filter((s) => s.verificationStatus === "partial").length;
  const unverifiedCount = spans.filter((s) => s.verificationStatus === "unverified").length;
  const contradictedCount = spans.filter((s) => s.verificationStatus === "contradicted").length;

  return {
    totalSpans: spans.length,
    verifiedCount,
    partialCount,
    unverifiedCount,
    contradictedCount,
    verificationRate: spans.length > 0 ? (verifiedCount + partialCount) / spans.length : 0,
    spans,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function extractDomain(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return null;
  }
}
