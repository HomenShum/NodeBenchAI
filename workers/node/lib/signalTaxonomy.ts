/**
 * signalTaxonomy.ts — Fixed ontology for signal classification.
 *
 * Human-designed, versioned. Agents classify INTO this vocabulary,
 * they don't invent labels. Novel signals go to "Uncategorized" with
 * low confidence for ontology review.
 */

// ─── 12 Top-Level Categories ─────────────────────────────────────

export const SIGNAL_CATEGORIES = [
  "Team / Founder",
  "Market",
  "Product",
  "Traction",
  "GTM / Distribution",
  "Moat / Defensibility",
  "Technical Risk",
  "Financial Readiness",
  "Diligence / Verifiability",
  "Regulatory / Compliance",
  "Strategic Fit",
  "Execution Risk",
] as const;

export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

// ─── Canonical Labels (30) ───────────────────────────────────────

export interface CanonicalLabel {
  label: string;
  category: SignalCategory;
  keywords: string[]; // for fuzzy matching raw signal names
}

export const CANONICAL_LABELS: CanonicalLabel[] = [
  // Team / Founder
  { label: "Founder-Market Fit", category: "Team / Founder", keywords: ["founder", "background", "domain expertise", "experience"] },
  { label: "Key Technical Leadership", category: "Team / Founder", keywords: ["cto", "technical", "engineering", "leadership", "team"] },
  { label: "Hiring Velocity", category: "Team / Founder", keywords: ["hiring", "headcount", "growth", "talent", "recruiting"] },

  // Market
  { label: "Market Size", category: "Market", keywords: ["tam", "sam", "market size", "addressable", "opportunity"] },
  { label: "Market Timing", category: "Market", keywords: ["timing", "wave", "adoption", "inflection", "trend"] },
  { label: "Competitive Density", category: "Market", keywords: ["competitors", "crowded", "fragmented", "consolidated", "landscape"] },

  // Product
  { label: "Product-Market Fit Signals", category: "Product", keywords: ["pmf", "retention", "engagement", "usage", "product-market"] },
  { label: "Technical Differentiation", category: "Product", keywords: ["architecture", "tech stack", "proprietary", "novel", "innovation"] },
  { label: "User Experience Quality", category: "Product", keywords: ["ux", "design", "usability", "onboarding", "friction"] },

  // Traction
  { label: "Revenue Growth", category: "Traction", keywords: ["revenue", "arr", "mrr", "sales", "growth rate"] },
  { label: "User Growth", category: "Traction", keywords: ["users", "dau", "mau", "signups", "adoption rate"] },
  { label: "Commercial Validation", category: "Traction", keywords: ["customers", "contracts", "pilots", "enterprise", "paid"] },

  // GTM / Distribution
  { label: "Distribution Channel", category: "GTM / Distribution", keywords: ["distribution", "channel", "viral", "organic", "acquisition"] },
  { label: "Sales Efficiency", category: "GTM / Distribution", keywords: ["cac", "ltv", "payback", "sales cycle", "efficiency"] },
  { label: "Developer Adoption", category: "GTM / Distribution", keywords: ["developer", "open source", "api", "sdk", "developer adoption"] },

  // Moat / Defensibility
  { label: "IP Defensibility", category: "Moat / Defensibility", keywords: ["ip", "patent", "proprietary", "trade secret", "defensibility"] },
  { label: "Network Effects", category: "Moat / Defensibility", keywords: ["network effect", "flywheel", "ecosystem", "platform", "switching cost"] },
  { label: "Data Moat", category: "Moat / Defensibility", keywords: ["data", "training data", "proprietary data", "data advantage", "data flywheel"] },

  // Technical Risk
  { label: "Scalability Risk", category: "Technical Risk", keywords: ["scale", "infrastructure", "performance", "bottleneck", "architecture risk"] },
  { label: "Dependency Risk", category: "Technical Risk", keywords: ["dependency", "vendor lock-in", "api dependency", "platform risk", "single point"] },

  // Financial Readiness
  { label: "Runway", category: "Financial Readiness", keywords: ["runway", "burn rate", "cash", "months remaining", "fundraising"] },
  { label: "Unit Economics", category: "Financial Readiness", keywords: ["unit economics", "margin", "gross margin", "contribution", "profitability"] },

  // Diligence / Verifiability
  { label: "Evidence Quality", category: "Diligence / Verifiability", keywords: ["evidence", "source", "verifiable", "citation", "proof"] },
  { label: "Claim Consistency", category: "Diligence / Verifiability", keywords: ["contradiction", "inconsistent", "conflicting", "mismatch"] },

  // Regulatory / Compliance
  { label: "Regulatory Exposure", category: "Regulatory / Compliance", keywords: ["regulation", "compliance", "legal", "gdpr", "licensing"] },

  // Strategic Fit
  { label: "Strategic Alignment", category: "Strategic Fit", keywords: ["strategy", "alignment", "thesis", "portfolio fit", "synergy"] },
  { label: "Independence", category: "Strategic Fit", keywords: ["independent", "autonomy", "parent company", "subsidiary", "spin-off"] },

  // Execution Risk
  { label: "Execution Complexity", category: "Execution Risk", keywords: ["complexity", "execution risk", "operational", "coordination", "delivery"] },
  { label: "Go-to-Market Risk", category: "Execution Risk", keywords: ["gtm risk", "market entry", "launch", "adoption risk", "timing risk"] },
];

// ─── Classified Signal (3-layer object) ──────────────────────────

export interface ClassifiedSignal {
  /** Stable top-level category from SIGNAL_CATEGORIES */
  category: SignalCategory;
  /** Human-readable label from CANONICAL_LABELS */
  label: string;
  /** Original raw signal name from extraction */
  rawName: string;
  /** up | down | neutral */
  direction: string;
  /** high | medium | low */
  impact: string;
  /** 0-1 confidence in the classification */
  confidence: number;
  /** Evidence-backed explanation */
  summary: string;
  /** Source reference indices */
  evidenceRefs: string[];
  /** True if this didn't match any canonical label well */
  needsOntologyReview: boolean;
}

// ─── Classify a raw signal into the taxonomy ─────────────────────

const KEYWORD_CACHE = new Map<string, { label: CanonicalLabel; score: number }>();
const MAX_CACHE = 500;

function keywordScore(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score += kw.length; // longer keyword matches = higher confidence
  }
  return score;
}

export function classifySignal(raw: {
  name?: string;
  title?: string;
  direction?: string;
  impact?: string;
  sourceIdx?: number;
}): ClassifiedSignal {
  const rawName = raw.name ?? raw.title ?? String(raw);
  const cacheKey = rawName.toLowerCase().trim();

  // Check cache
  const cached = KEYWORD_CACHE.get(cacheKey);
  if (cached) {
    return {
      category: cached.label.category,
      label: cached.label.label,
      rawName,
      direction: raw.direction ?? "neutral",
      impact: raw.impact ?? "medium",
      confidence: Math.min(0.95, cached.score / 20), // normalize
      summary: rawName,
      evidenceRefs: raw.sourceIdx != null ? [`src_${raw.sourceIdx}`] : [],
      needsOntologyReview: false,
    };
  }

  // Find best matching canonical label
  let bestLabel: CanonicalLabel | null = null;
  let bestScore = 0;

  for (const cl of CANONICAL_LABELS) {
    const score = keywordScore(rawName, cl.keywords);
    if (score > bestScore) {
      bestScore = score;
      bestLabel = cl;
    }
  }

  // Cache result (with eviction)
  if (bestLabel && bestScore > 0) {
    if (KEYWORD_CACHE.size >= MAX_CACHE) {
      const firstKey = KEYWORD_CACHE.keys().next().value;
      if (firstKey) KEYWORD_CACHE.delete(firstKey);
    }
    KEYWORD_CACHE.set(cacheKey, { label: bestLabel, score: bestScore });
  }

  if (bestLabel && bestScore >= 3) {
    return {
      category: bestLabel.category,
      label: bestLabel.label,
      rawName,
      direction: raw.direction ?? "neutral",
      impact: raw.impact ?? "medium",
      confidence: Math.min(0.95, bestScore / 20),
      summary: rawName,
      evidenceRefs: raw.sourceIdx != null ? [`src_${raw.sourceIdx}`] : [],
      needsOntologyReview: bestScore < 6,
    };
  }

  // No match — uncategorized, needs review
  return {
    category: "Execution Risk", // safe default
    label: rawName.length > 40 ? rawName.slice(0, 37) + "..." : rawName,
    rawName,
    direction: raw.direction ?? "neutral",
    impact: raw.impact ?? "medium",
    confidence: 0.3,
    summary: rawName,
    evidenceRefs: raw.sourceIdx != null ? [`src_${raw.sourceIdx}`] : [],
    needsOntologyReview: true,
  };
}

/**
 * Classify an array of raw signals and deduplicate by label.
 * Signals with the same label get merged (highest confidence wins, evidence refs combined).
 */
export function classifySignals(rawSignals: any[]): ClassifiedSignal[] {
  const classified = rawSignals.map((s) => classifySignal(s));

  // Deduplicate by category + label
  const merged = new Map<string, ClassifiedSignal>();
  for (const sig of classified) {
    const key = `${sig.category}::${sig.label}`;
    const existing = merged.get(key);
    if (existing) {
      // Merge: keep higher confidence, combine evidence
      if (sig.confidence > existing.confidence) {
        existing.confidence = sig.confidence;
        existing.summary = sig.summary;
      }
      existing.evidenceRefs = [...new Set([...existing.evidenceRefs, ...sig.evidenceRefs])];
    } else {
      merged.set(key, { ...sig });
    }
  }

  // Sort by confidence descending
  return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
}
