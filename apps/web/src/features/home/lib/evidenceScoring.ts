/**
 * Evidence Scoring — deterministic confidence derivation from evidence checklist.
 *
 * Every check is deterministic — no LLM involved in scoring.
 * Same checklist always produces same confidence level.
 *
 * Pattern: Boolean gates (Anthropic "Building Effective Agents", 2024)
 * Prior art: grounded_eval.md Layer 2 (claim-level grounding filter)
 *
 * See: docs/architecture/HOME_DAILY_BRIEF_LIVE_WIRING.md §3.2, §8
 */

import type {
  EvidenceChecklist,
  ConfidenceLevel,
  BriefSignal,
} from "./briefTypes";

// ─── Confidence Derivation ─────────────────────────────────────────────

/**
 * Derives confidence level from evidence checklist.
 * Deterministic — same checklist always produces same confidence.
 *
 * Thresholds:
 *   5-6 checks passing → "verified"    (green badge)
 *   3-4 checks passing → "estimated"   (amber badge)
 *   0-2 checks passing → "speculative" (red badge)
 */
export function deriveConfidence(
  signal: Pick<BriefSignal, "evidenceChecklist">,
): ConfidenceLevel {
  const checklist = signal.evidenceChecklist;
  if (!checklist) return "speculative";

  const passing = countPassingChecks(checklist);

  if (passing >= 5) return "verified";
  if (passing >= 3) return "estimated";
  return "speculative";
}

/**
 * Counts passing boolean checks in an evidence checklist.
 * Pure function — no side effects.
 */
export function countPassingChecks(checklist: EvidenceChecklist): number {
  return [
    checklist.hasPrimarySource,
    checklist.hasCorroboration,
    checklist.hasFalsifiableClaim,
    checklist.hasQuantitativeData,
    checklist.hasNamedAttribution,
    checklist.isReproducible,
  ].filter(Boolean).length;
}

// ─── Confidence Badge Colors (deterministic lookup) ────────────────────

export const CONFIDENCE_COLORS = {
  verified: {
    bg: "rgba(74,222,128,0.12)",
    text: "#4ade80",
    border: "rgba(74,222,128,0.25)",
    label: "Verified",
  },
  estimated: {
    bg: "rgba(251,191,36,0.12)",
    text: "#fbbf24",
    border: "rgba(251,191,36,0.25)",
    label: "Estimated",
  },
  speculative: {
    bg: "rgba(248,113,113,0.12)",
    text: "#f87171",
    border: "rgba(248,113,113,0.25)",
    label: "Speculative",
  },
} as const;

// ─── Evidence Checklist Computation ────────────────────────────────────

/**
 * Tier 1 domains — high-authority primary sources.
 * Government, regulatory, academic repositories.
 */
const TIER_1_DOMAINS = [
  "sec.gov",
  "federalregister.gov",
  "arxiv.org",
  "patents.google.com",
  "congress.gov",
  "who.int",
  "worldbank.org",
  "bls.gov",
  "census.gov",
  "fda.gov",
] as const;

/**
 * Tier 2 domains — established news and research outlets.
 * Major wire services, financial press, top-tier science journals.
 */
const TIER_2_DOMAINS = [
  "reuters.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "nytimes.com",
  "theinformation.com",
  "techcrunch.com",
  "nature.com",
  "science.org",
  "apnews.com",
] as const;

/**
 * Extract domain from a URL. Returns empty string on invalid URLs.
 */
function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Strip "www." prefix for matching
    return hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Regex for detecting quantitative data in text.
 * Matches: $1,234 | 42% | 3x | 10 billion | 5M | 100K
 */
const QUANTITATIVE_PATTERN =
  /\$[\d,.]+|[\d.]+%|\d+[xX]|\d+\s*(?:billion|million|trillion|M|B|K|T)\b/;

/**
 * Regex for detecting named attribution (First Last pattern).
 */
const NAMED_ATTRIBUTION_PATTERN = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/;

/**
 * Computes the 6-boolean evidence checklist for a signal.
 * Deterministic: same input → same output.
 *
 * These booleans are computed ONCE during brief generation (server-side)
 * and stored with the signal. The UI reads them — never recomputes.
 *
 * This client-side version exists for:
 *   1. Validating server-computed checklists in tests
 *   2. Computing checklists for signals that arrive without one
 *      (e.g., from older brief formats that predate the checklist)
 */
export function computeEvidenceChecklist(
  signal: { title: string; summary: string; directQuote?: string | null; falsificationCriteria?: string | null },
  sources: Array<{ url: string }>,
): EvidenceChecklist {
  const allDomains = sources.map((s) => extractDomain(s.url));
  const combinedText = `${signal.title} ${signal.summary}`;

  return {
    // Check 1: Primary source from Tier 1 or Tier 2 domain
    hasPrimarySource: allDomains.some(
      (d) =>
        (TIER_1_DOMAINS as readonly string[]).includes(d) ||
        (TIER_2_DOMAINS as readonly string[]).includes(d),
    ),

    // Check 2: Corroboration from 2+ distinct source domains
    hasCorroboration: new Set(allDomains.filter(Boolean)).size >= 2,

    // Check 3: Falsifiable claim exists (LLM-derived at generation, stored)
    hasFalsifiableClaim:
      signal.falsificationCriteria != null &&
      signal.falsificationCriteria.length > 10,

    // Check 4: Quantitative data (hard numbers present)
    hasQuantitativeData: QUANTITATIVE_PATTERN.test(combinedText),

    // Check 5: Named attribution (person or entity cited by name)
    hasNamedAttribution:
      NAMED_ATTRIBUTION_PATTERN.test(signal.summary) ||
      signal.directQuote != null,

    // Check 6: Reproducible URL (at least one followable, non-paywalled link)
    isReproducible: sources.some(
      (s) =>
        s.url &&
        s.url.startsWith("http") &&
        !s.url.includes("paywalled"),
    ),
  };
}

// ─── Significance Ranking ──────────────────────────────────────────────

/**
 * Ranks a signal by significance for BLUF ordering.
 * Higher score = more significant = shown first.
 *
 * Scoring: evidence strength (0-6) + quantitative bonus (2) + quote bonus (1)
 */
export function significanceRank(
  signal: Pick<BriefSignal, "evidenceChecklist" | "hardNumbers" | "directQuote">,
): number {
  let score = 0;

  // Base score from evidence checklist
  if (signal.evidenceChecklist) {
    score += countPassingChecks(signal.evidenceChecklist);
  }

  // Bonus for hard numbers (quantitative signals are more actionable)
  if (signal.hardNumbers) {
    score += 2;
  }

  // Bonus for direct quotes (attributed claims are more trustworthy)
  if (signal.directQuote) {
    score += 1;
  }

  return score;
}
