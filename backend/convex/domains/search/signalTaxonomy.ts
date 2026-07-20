/**
 * Signal Taxonomy — controlled vocabulary for entity intelligence.
 *
 * Manual ontology at the top, agent categorization underneath.
 * 12 top-level categories, ~35 canonical labels, scoring semantics.
 *
 * The agent classifies into this vocabulary — it does NOT invent labels.
 * Novel signals go into a "needs_review" queue for ontology upgrades.
 */

// ── Top-Level Categories (stable, versioned) ─────────────────────────────

export const SIGNAL_CATEGORIES = [
  "team_founder",
  "market",
  "product",
  "traction",
  "gtm_distribution",
  "moat_defensibility",
  "technical_risk",
  "financial_readiness",
  "diligence_verifiability",
  "regulatory_compliance",
  "strategic_fit",
  "execution_risk",
] as const;

export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

// ── Category Display Names ───────────────────────────────────────────────

export const CATEGORY_DISPLAY: Record<SignalCategory, { label: string; icon: string; color: string }> = {
  team_founder:            { label: "Team / Founder",            icon: "Users",       color: "#8b5cf6" },
  market:                  { label: "Market",                    icon: "TrendingUp",  color: "#06b6d4" },
  product:                 { label: "Product",                   icon: "Package",     color: "#3b82f6" },
  traction:                { label: "Traction",                  icon: "BarChart3",   color: "#22c55e" },
  gtm_distribution:        { label: "GTM / Distribution",        icon: "Megaphone",   color: "#f59e0b" },
  moat_defensibility:      { label: "Moat / Defensibility",      icon: "Shield",      color: "#ef4444" },
  technical_risk:          { label: "Technical Risk",            icon: "AlertTriangle", color: "#f97316" },
  financial_readiness:     { label: "Financial Readiness",       icon: "DollarSign",  color: "#10b981" },
  diligence_verifiability: { label: "Diligence / Verifiability", icon: "CheckCircle", color: "#6366f1" },
  regulatory_compliance:   { label: "Regulatory / Compliance",   icon: "Scale",       color: "#ec4899" },
  strategic_fit:           { label: "Strategic Fit",             icon: "Target",      color: "#14b8a6" },
  execution_risk:          { label: "Execution Risk",            icon: "Zap",         color: "#d97757" },
};

// ── Canonical Signal Labels (agent picks from this set) ──────────────────

export interface CanonicalLabel {
  id: string;
  category: SignalCategory;
  label: string;
  description: string;
}

export const CANONICAL_LABELS: CanonicalLabel[] = [
  // Team / Founder
  { id: "founder_market_fit",         category: "team_founder",        label: "Founder-Market Fit",          description: "Founder's background aligns with the market they're attacking" },
  { id: "key_technical_leadership",   category: "team_founder",        label: "Key Technical Leadership",    description: "Strong technical co-founder or CTO with relevant domain expertise" },
  { id: "key_person_dependency",      category: "team_founder",        label: "Key-Person Dependency",       description: "Critical operations depend on a single individual" },
  { id: "team_completeness",          category: "team_founder",        label: "Team Completeness",           description: "Key roles filled: CEO, CTO, sales/GTM, ops" },
  { id: "board_advisory_strength",    category: "team_founder",        label: "Board / Advisory Strength",   description: "Quality and relevance of board members and advisors" },

  // Market
  { id: "tam_sizing",                 category: "market",              label: "TAM / Market Size",           description: "Total addressable market size and growth trajectory" },
  { id: "market_timing",              category: "market",              label: "Market Timing",               description: "Why this product at this moment — secular trends, regulatory shifts" },
  { id: "competitive_density",        category: "market",              label: "Competitive Density",         description: "Number and strength of direct competitors" },

  // Product
  { id: "product_market_fit",         category: "product",             label: "Product-Market Fit",          description: "Evidence of PMF: retention, NPS, organic growth, customer pull" },
  { id: "technical_differentiation",  category: "product",             label: "Technical Differentiation",   description: "Proprietary technology, architecture, or data advantage" },
  { id: "platform_maturity",          category: "product",             label: "Platform Maturity",           description: "Completeness of product: features, stability, API coverage" },

  // Traction
  { id: "revenue_trajectory",         category: "traction",            label: "Revenue Trajectory",          description: "Revenue growth rate, ARR/MRR trend, acceleration or deceleration" },
  { id: "customer_concentration",     category: "traction",            label: "Customer Concentration",      description: "Revenue dependence on top N customers" },
  { id: "commercial_validation",      category: "traction",            label: "Commercial Validation",       description: "Paying customers, LOIs, pilots, design partners" },

  // GTM / Distribution
  { id: "distribution_channel",       category: "gtm_distribution",    label: "Distribution Channel",        description: "Primary acquisition channel: PLG, sales, partnerships, marketplace" },
  { id: "cac_ltv_efficiency",         category: "gtm_distribution",    label: "CAC/LTV Efficiency",          description: "Unit economics: cost to acquire vs lifetime value" },
  { id: "viral_coefficient",          category: "gtm_distribution",    label: "Viral / Network Effects",     description: "Built-in growth loops, referral mechanics, network value" },

  // Moat / Defensibility
  { id: "ip_defensibility",           category: "moat_defensibility",  label: "IP Defensibility",            description: "Patents, trade secrets, proprietary data, or regulatory moats" },
  { id: "switching_cost",             category: "moat_defensibility",  label: "Switching Cost",              description: "How hard it is for customers to leave once adopted" },
  { id: "data_network_effect",        category: "moat_defensibility",  label: "Data / Network Effect",       description: "Product improves with more users or more data" },

  // Technical Risk
  { id: "scalability_risk",           category: "technical_risk",      label: "Scalability Risk",            description: "Architecture can handle 10x-100x growth without rewrite" },
  { id: "dependency_risk",            category: "technical_risk",      label: "Dependency Risk",             description: "Critical reliance on third-party APIs, models, or infrastructure" },
  { id: "security_risk",              category: "technical_risk",      label: "Security Risk",               description: "Data handling, auth, encryption, compliance posture" },

  // Financial Readiness
  { id: "runway_burn",                category: "financial_readiness", label: "Runway / Burn Rate",          description: "Months of runway at current burn rate" },
  { id: "unit_economics",             category: "financial_readiness", label: "Unit Economics",              description: "Gross margin, contribution margin, path to profitability" },
  { id: "funding_history",            category: "financial_readiness", label: "Funding History",             description: "Rounds raised, investors, valuation trajectory" },

  // Diligence / Verifiability
  { id: "claim_verifiability",        category: "diligence_verifiability", label: "Claim Verifiability",     description: "Can stated metrics be independently verified?" },
  { id: "evidence_quality",           category: "diligence_verifiability", label: "Evidence Quality",        description: "Sources are primary, cited, and cross-referenced" },
  { id: "information_completeness",   category: "diligence_verifiability", label: "Information Completeness", description: "Gaps in available data — what's missing and why" },

  // Regulatory / Compliance
  { id: "regulatory_exposure",        category: "regulatory_compliance", label: "Regulatory Exposure",       description: "Industry-specific regulations that could impact operations" },
  { id: "data_privacy_compliance",    category: "regulatory_compliance", label: "Data Privacy Compliance",   description: "GDPR, CCPA, SOC2, HIPAA readiness" },

  // Strategic Fit
  { id: "strategic_alignment",        category: "strategic_fit",       label: "Strategic Alignment",         description: "How well the company fits an investor's thesis or portfolio" },
  { id: "exit_optionality",           category: "strategic_fit",       label: "Exit Optionality",            description: "Realistic paths to exit: IPO, M&A, strategic acquisition" },

  // Execution Risk
  { id: "operational_maturity",       category: "execution_risk",      label: "Operational Maturity",        description: "Process discipline: hiring, ops, legal, finance infrastructure" },
  { id: "market_execution_speed",     category: "execution_risk",      label: "Market Execution Speed",      description: "Velocity of shipping, iterating, and responding to market" },
];

// ── Signal Scoring Semantics ─────────────────────────────────────────────

export type SignalScore = "strong" | "medium" | "weak" | "missing" | "contradicted";

export const SCORE_DISPLAY: Record<SignalScore, { label: string; color: string; weight: number }> = {
  strong:       { label: "Strong",       color: "#22c55e", weight: 1.0 },
  medium:       { label: "Medium",       color: "#f59e0b", weight: 0.6 },
  weak:         { label: "Weak",         color: "#ef4444", weight: 0.3 },
  missing:      { label: "Missing",      color: "#6b7280", weight: 0.0 },
  contradicted: { label: "Contradicted", color: "#dc2626", weight: -0.2 },
};

// ── Classified Signal (what the agent produces) ──────────────────────────

export interface ClassifiedSignal {
  signal_id: string;
  category: SignalCategory;
  label_id: string;           // from CANONICAL_LABELS, or "novel_*" for unknown
  label: string;              // human-readable display label
  score: SignalScore;
  confidence: number;         // 0-1
  summary: string;            // evidence-backed explanation
  evidence_refs: string[];    // source IDs
  contradiction_refs: string[]; // contradiction IDs
  repeat_count: number;       // how many raw findings mapped to this signal
  needs_review: boolean;      // true if agent couldn't find a canonical label
}

// ── Classification Prompt (for Gemini agent) ─────────────────────────────

export function buildClassificationPrompt(entityName: string, rawFindings: string): string {
  const categoryList = SIGNAL_CATEGORIES.map((c) => `  - ${c}: ${CATEGORY_DISPLAY[c].label}`).join("\n");
  const labelList = CANONICAL_LABELS.map((l) => `  - ${l.id} (${l.category}): ${l.label} — ${l.description}`).join("\n");

  return `You are classifying raw intelligence findings about "${entityName}" into a structured signal taxonomy.

## Categories (pick one per signal):
${categoryList}

## Canonical Labels (pick the best-fit label for each signal):
${labelList}

## Rules:
1. Each finding maps to ONE category and ONE label.
2. Use the canonical label_id from the list above. If no label fits, use label_id "novel_<your_short_name>" and set needs_review: true.
3. Score each signal: "strong" (clear evidence), "medium" (partial evidence), "weak" (circumstantial), "missing" (no data), "contradicted" (conflicting evidence).
4. Confidence is 0-1 based on source quality and evidence strength.
5. If multiple findings map to the same label, merge them: increase confidence, combine evidence_refs, set repeat_count.
6. Detect contradictions: if two findings conflict, flag both with contradiction_refs pointing to each other.

## Raw Findings:
${rawFindings}

## Output Format:
Return a JSON array of ClassifiedSignal objects:
[
  {
    "signal_id": "sig_001",
    "category": "team_founder",
    "label_id": "founder_market_fit",
    "label": "Founder-Market Fit",
    "score": "strong",
    "confidence": 0.85,
    "summary": "Evidence-backed explanation of why this score...",
    "evidence_refs": ["src_1", "src_3"],
    "contradiction_refs": [],
    "repeat_count": 2,
    "needs_review": false
  }
]

Return ONLY the JSON array. No markdown, no explanation.`;
}

// ── Duplicate Collapse ───────────────────────────────────────────────────

export function collapseSignals(signals: ClassifiedSignal[]): ClassifiedSignal[] {
  const byLabel = new Map<string, ClassifiedSignal[]>();
  for (const s of signals) {
    const key = `${s.category}::${s.label_id}`;
    const existing = byLabel.get(key) ?? [];
    existing.push(s);
    byLabel.set(key, existing);
  }

  const collapsed: ClassifiedSignal[] = [];
  for (const [, group] of byLabel) {
    if (group.length === 1) {
      collapsed.push(group[0]);
      continue;
    }
    // Merge: highest confidence, combined evidence, summed repeat count
    const merged = { ...group[0] };
    merged.confidence = Math.max(...group.map((s) => s.confidence));
    merged.repeat_count = group.reduce((s, g) => s + g.repeat_count, 0);
    merged.evidence_refs = [...new Set(group.flatMap((s) => s.evidence_refs))];
    merged.contradiction_refs = [...new Set(group.flatMap((s) => s.contradiction_refs))];
    // Pick the strongest score
    const scoreOrder: SignalScore[] = ["strong", "medium", "weak", "missing", "contradicted"];
    merged.score = group.map((s) => s.score).sort((a, b) => scoreOrder.indexOf(a) - scoreOrder.indexOf(b))[0];
    // Merge summaries
    const uniqueSummaries = [...new Set(group.map((s) => s.summary))];
    merged.summary = uniqueSummaries.join(" ");
    collapsed.push(merged);
  }

  return collapsed.sort((a, b) => {
    // Sort by category order, then by confidence desc
    const catDiff = SIGNAL_CATEGORIES.indexOf(a.category) - SIGNAL_CATEGORIES.indexOf(b.category);
    if (catDiff !== 0) return catDiff;
    return b.confidence - a.confidence;
  });
}

// ── Contradiction-Linked Follow-Up Questions ─────────────────────────────

export function generateFollowUpQuestions(signals: ClassifiedSignal[], entityName: string): string[] {
  const questions: string[] = [];

  // 1. Contradicted signals → direct challenge questions
  const contradicted = signals.filter((s) => s.score === "contradicted" || s.contradiction_refs.length > 0);
  for (const s of contradicted.slice(0, 3)) {
    questions.push(
      `${entityName} shows contradicting evidence on ${CATEGORY_DISPLAY[s.category].label} (${s.label}). What specific data would resolve this contradiction?`,
    );
  }

  // 2. Missing signals in critical categories → gap questions
  const criticalCategories: SignalCategory[] = ["financial_readiness", "team_founder", "traction", "moat_defensibility"];
  for (const cat of criticalCategories) {
    const catSignals = signals.filter((s) => s.category === cat);
    if (catSignals.length === 0 || catSignals.every((s) => s.score === "missing")) {
      questions.push(
        `No verifiable data found for ${CATEGORY_DISPLAY[cat].label}. What evidence would you need to assess ${entityName} on this dimension?`,
      );
    }
  }

  // 3. Weak signals with high repeat count → validation questions
  const weakButRepeated = signals.filter((s) => s.score === "weak" && s.repeat_count >= 2);
  for (const s of weakButRepeated.slice(0, 2)) {
    questions.push(
      `${s.label} for ${entityName} appears in ${s.repeat_count} sources but remains weak. What would upgrade this from weak to strong evidence?`,
    );
  }

  // 4. Strong + weak in same category → tension questions
  for (const cat of SIGNAL_CATEGORIES) {
    const catSignals = signals.filter((s) => s.category === cat);
    const strong = catSignals.filter((s) => s.score === "strong");
    const weak = catSignals.filter((s) => s.score === "weak" || s.score === "contradicted");
    if (strong.length > 0 && weak.length > 0) {
      questions.push(
        `${entityName} scores strong on ${strong[0].label} but weak on ${weak[0].label} within ${CATEGORY_DISPLAY[cat].label}. How does ${strong[0].label} compensate for ${weak[0].label}?`,
      );
    }
  }

  return questions.slice(0, 6); // max 6 follow-ups
}
