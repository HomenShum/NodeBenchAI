/**
 * routingHints.ts — Deterministic token-overlap routing scores.
 *
 * Ported from TA Studio's routing_score.py pattern.
 * Pre-computes overlap between user query and domain keyword sets,
 * then injects top-3 scores as hints into the LLM classification prompt.
 *
 * This reduces LLM decision latency and token cost by providing
 * concrete signal strength without classifier overhead.
 */

// ─── Domain capability keyword sets ──────────────────────────────

interface DomainKeywords {
  domain: string;
  label: string;
  keywords: string[];
}

const DOMAIN_CAPABILITIES: DomainKeywords[] = [
  {
    domain: "company_search",
    label: "Company Intelligence",
    keywords: [
      "company", "startup", "competitor", "market", "funding", "revenue",
      "valuation", "team", "founder", "ceo", "investors", "series",
      "acquisition", "ipo", "growth", "traction", "product", "moat",
      "defensibility", "diligence", "analysis", "research", "investigate",
      "who", "what is", "tell me about", "search",
    ],
  },
  {
    domain: "founder_ops",
    label: "Founder Operations",
    keywords: [
      "weekly reset", "weekly", "delegation", "hand off", "delegate",
      "agent", "packet", "operating", "contradictions", "changed",
      "what changed", "my company", "our", "my startup", "my team",
      "refresh", "context", "priorities", "next moves", "strategy",
    ],
  },
  {
    domain: "competitor_analysis",
    label: "Competitive Analysis",
    keywords: [
      "vs", "versus", "compare", "comparison", "competitor",
      "alternative", "better than", "difference", "landscape",
      "market share", "head to head", "benchmark", "relative",
    ],
  },
  {
    domain: "financial_analysis",
    label: "Financial Analysis",
    keywords: [
      "revenue", "arr", "mrr", "burn", "runway", "margins",
      "unit economics", "cac", "ltv", "payback", "profitability",
      "raise", "fundraise", "valuation", "cap table", "dilution",
      "series a", "series b", "seed", "pre-seed", "banker",
    ],
  },
  {
    domain: "diligence",
    label: "Due Diligence",
    keywords: [
      "diligence", "risk", "red flag", "compliance", "regulatory",
      "legal", "ip", "patent", "lawsuit", "fraud", "verify",
      "evidence", "proof", "audit", "investigate", "check",
      "contradiction", "inconsistent", "claim",
    ],
  },
  {
    domain: "idea_validation",
    label: "Idea Validation",
    keywords: [
      "idea", "validate", "build", "should i", "feasible",
      "wedge", "beachhead", "pmf", "product market fit",
      "problem", "solution", "hypothesis", "experiment",
      "mvp", "prototype", "test", "assumption",
    ],
  },
];

// ─── Token overlap scoring ───────────────────────────────────────

export interface RoutingHint {
  domain: string;
  label: string;
  score: number;
}

/**
 * Compute token overlap scores between a query and all domain keyword sets.
 * Returns scores sorted descending, normalized to 0-1.
 */
export function computeRoutingHints(query: string): RoutingHint[] {
  const queryTokens = tokenize(query);
  const results: RoutingHint[] = [];

  for (const domain of DOMAIN_CAPABILITIES) {
    let matchWeight = 0;
    for (const keyword of domain.keywords) {
      const kwTokens = keyword.split(/\s+/);
      // Multi-word keyword: check if all tokens appear in query
      if (kwTokens.length > 1) {
        const allPresent = kwTokens.every((t) =>
          queryTokens.some((qt) => qt.includes(t) || t.includes(qt)),
        );
        if (allPresent) matchWeight += kwTokens.length * 2; // multi-word matches worth more
      } else {
        // Single-word keyword: check token presence
        if (queryTokens.some((qt) => qt.includes(keyword) || keyword.includes(qt))) {
          matchWeight += 1;
        }
      }
    }

    // Normalize: max possible is ~all keywords matching
    const maxPossible = domain.keywords.length * 1.5;
    const score = Math.min(1, matchWeight / maxPossible);

    results.push({ domain: domain.domain, label: domain.label, score: Math.round(score * 100) / 100 });
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Format routing hints as a prompt injection for LLM classification.
 * Only includes top-3 domains with score > 0.
 */
export function formatRoutingHintsForPrompt(hints: RoutingHint[]): string {
  const top = hints.filter((h) => h.score > 0).slice(0, 3);
  if (top.length === 0) return "";

  const lines = top.map((h) => `${h.label}: ${h.score}`).join(" | ");
  const best = top[0];
  return `Routing hints (token overlap): ${lines} — Highest signal: ${best.label}`;
}

// ─── Helpers ─────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}
