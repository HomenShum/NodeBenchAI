/**
 * Persona Inference Evaluation
 *
 * Tests the accuracy of persona detection from user queries.
 * Validates that the system correctly identifies user intent and persona.
 */

"use node";

import { action } from "../../../_generated/server";
import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface PersonaInferenceTestCase {
  id: string;
  query: string;
  expectedPersona: string;
  expectedConfidence: "high" | "medium" | "low";
  category: "financial" | "industry" | "strategic" | "general";
  signals: string[];
}

export interface InferenceResult {
  testCaseId: string;
  query: string;
  expectedPersona: string;
  inferredPersona: string;
  confidence: number;
  passed: boolean;
  matchedSignals: string[];
  reasoningNotes: string;
}

export interface InferenceEvalSummary {
  totalTests: number;
  passed: number;
  failed: number;
  accuracy: number;
  byCategory: Record<string, { total: number; passed: number; accuracy: number }>;
  byPersona: Record<string, { total: number; passed: number; accuracy: number }>;
  confusionMatrix: Array<{ expected: string; inferred: string; count: number }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST CASES
// ═══════════════════════════════════════════════════════════════════════════

export const PERSONA_INFERENCE_TEST_CASES: PersonaInferenceTestCase[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // FINANCIAL PERSONAS
  // ═══════════════════════════════════════════════════════════════════════════

  // JPM_STARTUP_BANKER
  {
    id: "banker_001",
    query: "I need to prepare a deal memo for TechCorp's Series B. What's their funding history and who are the key investors?",
    expectedPersona: "JPM_STARTUP_BANKER",
    expectedConfidence: "high",
    category: "financial",
    signals: ["deal memo", "Series B", "funding history", "investors"],
  },
  {
    id: "banker_002",
    query: "Looking at this company for potential M&A advisory. Need HQ location, revenue multiples, and key contacts.",
    expectedPersona: "JPM_STARTUP_BANKER",
    expectedConfidence: "high",
    category: "financial",
    signals: ["M&A advisory", "revenue multiples", "key contacts"],
  },
  {
    id: "banker_003",
    query: "What's the cap table structure and recent 409A valuation for this pre-IPO company?",
    expectedPersona: "JPM_STARTUP_BANKER",
    expectedConfidence: "medium",
    category: "financial",
    signals: ["cap table", "409A valuation", "pre-IPO"],
  },

  // EARLY_STAGE_VC
  {
    id: "vc_001",
    query: "Evaluating a seed-stage AI company. What's their team background, tech differentiation, and market size?",
    expectedPersona: "EARLY_STAGE_VC",
    expectedConfidence: "high",
    category: "financial",
    signals: ["seed-stage", "team background", "tech differentiation", "market size"],
  },
  {
    id: "vc_002",
    query: "Need to build a comp table for Series A SaaS companies in the developer tools space.",
    expectedPersona: "EARLY_STAGE_VC",
    expectedConfidence: "high",
    category: "financial",
    signals: ["comp table", "Series A", "SaaS", "developer tools"],
  },
  {
    id: "vc_003",
    query: "What's the founder-market fit for this team? Any previous exits or relevant domain experience?",
    expectedPersona: "EARLY_STAGE_VC",
    expectedConfidence: "high",
    category: "financial",
    signals: ["founder-market fit", "previous exits", "domain experience"],
  },

  // LP_ALLOCATOR
  {
    id: "lp_001",
    query: "Need to verify Apex Ventures Fund IV performance. What's their TVPI, DPI, and IRR across vintages?",
    expectedPersona: "LP_ALLOCATOR",
    expectedConfidence: "high",
    category: "financial",
    signals: ["TVPI", "DPI", "IRR", "vintages", "fund performance"],
  },
  {
    id: "lp_002",
    query: "Evaluating a GP for our fund-of-funds. What's their track record and team stability?",
    expectedPersona: "LP_ALLOCATOR",
    expectedConfidence: "high",
    category: "financial",
    signals: ["GP", "fund-of-funds", "track record", "team stability"],
  },
  {
    id: "lp_003",
    query: "How does this fund's strategy align with our portfolio construction? Check sector concentration.",
    expectedPersona: "LP_ALLOCATOR",
    expectedConfidence: "medium",
    category: "financial",
    signals: ["fund strategy", "portfolio construction", "sector concentration"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INDUSTRY PERSONAS
  // ═══════════════════════════════════════════════════════════════════════════

  // PHARMA_BD
  {
    id: "pharma_001",
    query: "Evaluating BioGenex's Phase 2 asset BGX-101. What's the clinical trial status and competitive landscape?",
    expectedPersona: "PHARMA_BD",
    expectedConfidence: "high",
    category: "industry",
    signals: ["Phase 2", "clinical trial", "competitive landscape", "asset evaluation"],
  },
  {
    id: "pharma_002",
    query: "Need to verify NCT number and enrollment status for this oncology trial on ClinicalTrials.gov.",
    expectedPersona: "PHARMA_BD",
    expectedConfidence: "high",
    category: "industry",
    signals: ["NCT number", "enrollment status", "ClinicalTrials.gov", "oncology"],
  },
  {
    id: "pharma_003",
    query: "What's the FDA regulatory pathway for this PD-L1 inhibitor? Any breakthrough therapy designation?",
    expectedPersona: "PHARMA_BD",
    expectedConfidence: "high",
    category: "industry",
    signals: ["FDA regulatory pathway", "PD-L1 inhibitor", "breakthrough therapy"],
  },

  // ACADEMIC_RD
  {
    id: "academic_001",
    query: "Looking for papers on CRISPR base editing efficiency. What's the latest methodology and replication status?",
    expectedPersona: "ACADEMIC_RD",
    expectedConfidence: "high",
    category: "industry",
    signals: ["papers", "CRISPR", "methodology", "replication"],
  },
  {
    id: "academic_002",
    query: "Need to triangulate these findings across PubMed and Semantic Scholar. What's the citation impact?",
    expectedPersona: "ACADEMIC_RD",
    expectedConfidence: "high",
    category: "industry",
    signals: ["triangulate", "PubMed", "Semantic Scholar", "citation impact"],
  },
  {
    id: "academic_003",
    query: "What are the research gaps in this field? Any contradictory findings or methodology concerns?",
    expectedPersona: "ACADEMIC_RD",
    expectedConfidence: "medium",
    category: "industry",
    signals: ["research gaps", "contradictory findings", "methodology concerns"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // STRATEGIC PERSONAS
  // ═══════════════════════════════════════════════════════════════════════════

  // CORP_DEV
  {
    id: "corpdev_001",
    query: "Evaluating the Acme-WidgetCo acquisition. What's the deal value, synergy targets, and regulatory risk?",
    expectedPersona: "CORP_DEV",
    expectedConfidence: "high",
    category: "strategic",
    signals: ["acquisition", "deal value", "synergy targets", "regulatory risk"],
  },
  {
    id: "corpdev_002",
    query: "Need to verify M&A rumors. Is this deal confirmed? Check SEC filings and press releases.",
    expectedPersona: "CORP_DEV",
    expectedConfidence: "high",
    category: "strategic",
    signals: ["M&A rumors", "SEC filings", "press releases", "deal confirmation"],
  },
  {
    id: "corpdev_003",
    query: "What's the strategic rationale for this acquisition? Market position impact and integration risk?",
    expectedPersona: "CORP_DEV",
    expectedConfidence: "high",
    category: "strategic",
    signals: ["strategic rationale", "market position", "integration risk"],
  },

  // MACRO_STRATEGIST
  {
    id: "macro_001",
    query: "Analyzing Fed policy impact for Q1 2026. What's CPI, Core PCE, and expected rate decision?",
    expectedPersona: "MACRO_STRATEGIST",
    expectedConfidence: "high",
    category: "strategic",
    signals: ["Fed policy", "CPI", "Core PCE", "rate decision"],
  },
  {
    id: "macro_002",
    query: "Need to verify economic indicators against FRED and BLS. What's the unemployment trend?",
    expectedPersona: "MACRO_STRATEGIST",
    expectedConfidence: "high",
    category: "strategic",
    signals: ["economic indicators", "FRED", "BLS", "unemployment"],
  },
  {
    id: "macro_003",
    query: "What positioning makes sense given the macro thesis? Long duration or short USD?",
    expectedPersona: "MACRO_STRATEGIST",
    expectedConfidence: "medium",
    category: "strategic",
    signals: ["positioning", "macro thesis", "duration", "USD"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // AMBIGUOUS/EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "ambiguous_001",
    query: "Tell me about TechCorp.",
    expectedPersona: "EARLY_STAGE_VC", // Default for company queries
    expectedConfidence: "low",
    category: "general",
    signals: ["company name only"],
  },
  {
    id: "ambiguous_002",
    query: "What's the latest news on this company?",
    expectedPersona: "EARLY_STAGE_VC",
    expectedConfidence: "low",
    category: "general",
    signals: ["news", "company"],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// INFERENCE ENGINE (Simple rule-based for testing)
// ═══════════════════════════════════════════════════════════════════════════

interface InferenceSignals {
  persona: string;
  confidence: number;
  matchedSignals: string[];
  reasoning: string;
}

function inferPersonaFromQuery(query: string): InferenceSignals {
  const lowerQuery = query.toLowerCase();
  const matchedSignals: string[] = [];

  // Scoring weights for each persona
  const scores: Record<string, number> = {
    JPM_STARTUP_BANKER: 0,
    EARLY_STAGE_VC: 0,
    LP_ALLOCATOR: 0,
    PHARMA_BD: 0,
    ACADEMIC_RD: 0,
    CORP_DEV: 0,
    MACRO_STRATEGIST: 0,
    FOUNDER_STRATEGY: 0,
    CTO_TECH_LEAD: 0,
    JOURNALIST: 0,
    QUANT_PM: 0,
  };

  // JPM_STARTUP_BANKER signals
  const bankerSignals = [
    "deal memo", "m&a advisory", "cap table", "409a", "pre-ipo",
    "revenue multiple", "key contacts", "valuation", "dcf",
  ];
  for (const signal of bankerSignals) {
    if (lowerQuery.includes(signal)) {
      scores.JPM_STARTUP_BANKER += 2;
      matchedSignals.push(signal);
    }
  }

  // EARLY_STAGE_VC signals
  const vcSignals = [
    "seed", "series a", "series b", "founder", "team background",
    "market size", "tam", "comp table", "differentiation", "exit",
  ];
  for (const signal of vcSignals) {
    if (lowerQuery.includes(signal)) {
      scores.EARLY_STAGE_VC += 2;
      matchedSignals.push(signal);
    }
  }

  // LP_ALLOCATOR signals
  const lpSignals = [
    "tvpi", "dpi", "irr", "vintage", "fund performance", "gp",
    "fund-of-funds", "track record", "portfolio construction",
  ];
  for (const signal of lpSignals) {
    if (lowerQuery.includes(signal)) {
      scores.LP_ALLOCATOR += 3; // Higher weight for specific LP terms
      matchedSignals.push(signal);
    }
  }

  // PHARMA_BD signals
  const pharmaSignals = [
    "phase 1", "phase 2", "phase 3", "clinical trial", "nct",
    "fda", "pdufa", "breakthrough therapy", "oncology", "pd-l1",
    "enrollment", "clinicaltrials.gov",
  ];
  for (const signal of pharmaSignals) {
    if (lowerQuery.includes(signal)) {
      scores.PHARMA_BD += 3;
      matchedSignals.push(signal);
    }
  }

  // ACADEMIC_RD signals
  const academicSignals = [
    "paper", "pubmed", "semantic scholar", "citation", "methodology",
    "replication", "research gap", "crispr", "peer review",
  ];
  for (const signal of academicSignals) {
    if (lowerQuery.includes(signal)) {
      scores.ACADEMIC_RD += 3;
      matchedSignals.push(signal);
    }
  }

  // CORP_DEV signals
  const corpDevSignals = [
    "acquisition", "merger", "m&a", "synergy", "integration risk",
    "deal value", "strategic rationale", "sec filing",
  ];
  for (const signal of corpDevSignals) {
    if (lowerQuery.includes(signal)) {
      scores.CORP_DEV += 2;
      matchedSignals.push(signal);
    }
  }

  // MACRO_STRATEGIST signals
  const macroSignals = [
    "fed", "fomc", "cpi", "pce", "unemployment", "gdp",
    "rate decision", "fred", "bls", "macro", "positioning",
  ];
  for (const signal of macroSignals) {
    if (lowerQuery.includes(signal)) {
      scores.MACRO_STRATEGIST += 3;
      matchedSignals.push(signal);
    }
  }

  // FOUNDER_STRATEGY signals
  const founderSignals = [
    "competitive landscape", "market positioning", "go-to-market", "gtm",
    "wedge", "moat", "differentiation", "customer segment", "pricing strategy",
    "competitive analysis", "market entry", "unfair advantage",
  ];
  for (const signal of founderSignals) {
    if (lowerQuery.includes(signal)) {
      scores.FOUNDER_STRATEGY += 2;
      matchedSignals.push(signal);
    }
  }

  // CTO_TECH_LEAD signals
  const ctoSignals = [
    "tech stack", "architecture", "github stars", "npm downloads",
    "technical debt", "scalability", "security audit", "code quality",
    "devops", "ci/cd", "infrastructure", "open source", "license",
  ];
  for (const signal of ctoSignals) {
    if (lowerQuery.includes(signal)) {
      scores.CTO_TECH_LEAD += 3;
      matchedSignals.push(signal);
    }
  }

  // JOURNALIST signals
  const journalistSignals = [
    "fact check", "source verification", "press release", "layoffs",
    "breaking news", "conflicting reports", "tier 1 source", "reuters",
    "bloomberg", "on the record", "off the record", "attribution",
  ];
  for (const signal of journalistSignals) {
    if (lowerQuery.includes(signal)) {
      scores.JOURNALIST += 3;
      matchedSignals.push(signal);
    }
  }

  // QUANT_PM signals
  const quantSignals = [
    "sharpe ratio", "drawdown", "backtest", "factor model", "alpha",
    "beta", "volatility", "strategy", "risk-adjusted", "sortino",
    "calmar", "momentum factor", "mean reversion",
  ];
  for (const signal of quantSignals) {
    if (lowerQuery.includes(signal)) {
      scores.QUANT_PM += 3;
      matchedSignals.push(signal);
    }
  }

  // Find highest scoring persona
  let maxScore = 0;
  let inferredPersona = "EARLY_STAGE_VC"; // Default
  for (const [persona, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      inferredPersona = persona;
    }
  }

  // Calculate confidence
  let confidence = 0;
  if (maxScore >= 6) confidence = 0.9;
  else if (maxScore >= 4) confidence = 0.7;
  else if (maxScore >= 2) confidence = 0.5;
  else confidence = 0.3;

  // Build reasoning
  const reasoning = maxScore > 0
    ? `Matched signals: ${matchedSignals.join(", ")}`
    : "No strong signals detected, defaulting to EARLY_STAGE_VC";

  return {
    persona: inferredPersona,
    confidence,
    matchedSignals,
    reasoning,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EVALUATION ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run persona inference evaluation on all test cases
 */
export const runPersonaInferenceEval = action({
  args: {},
  handler: async (): Promise<{
    results: InferenceResult[];
    summary: InferenceEvalSummary;
  }> => {
    const results: InferenceResult[] = [];

    for (const testCase of PERSONA_INFERENCE_TEST_CASES) {
      const inference = inferPersonaFromQuery(testCase.query);

      const passed = inference.persona === testCase.expectedPersona;

      results.push({
        testCaseId: testCase.id,
        query: testCase.query,
        expectedPersona: testCase.expectedPersona,
        inferredPersona: inference.persona,
        confidence: inference.confidence,
        passed,
        matchedSignals: inference.matchedSignals,
        reasoningNotes: inference.reasoning,
      });
    }

    // Generate summary
    const summary = generateInferenceSummary(results);

    return { results, summary };
  },
});

/**
 * Run inference on a single query
 */
export const inferPersona = action({
  args: {
    query: v.string(),
  },
  handler: async (ctx, args): Promise<InferenceSignals> => {
    return inferPersonaFromQuery(args.query);
  },
});

/**
 * Get test cases for review
 */
export const getInferenceTestCases = action({
  args: {
    category: v.optional(v.string()),
    persona: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PersonaInferenceTestCase[]> => {
    let cases = PERSONA_INFERENCE_TEST_CASES;

    if (args.category) {
      cases = cases.filter(c => c.category === args.category);
    }

    if (args.persona) {
      cases = cases.filter(c => c.expectedPersona === args.persona);
    }

    return cases;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function generateInferenceSummary(results: InferenceResult[]): InferenceEvalSummary {
  const totalTests = results.length;
  const passed = results.filter(r => r.passed).length;

  // By category
  const byCategory: Record<string, { total: number; passed: number; accuracy: number }> = {};
  for (const testCase of PERSONA_INFERENCE_TEST_CASES) {
    const cat = testCase.category;
    if (!byCategory[cat]) {
      byCategory[cat] = { total: 0, passed: 0, accuracy: 0 };
    }
    byCategory[cat].total++;
  }
  for (const result of results) {
    const testCase = PERSONA_INFERENCE_TEST_CASES.find(t => t.id === result.testCaseId);
    if (testCase && result.passed) {
      byCategory[testCase.category].passed++;
    }
  }
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].accuracy = byCategory[cat].total > 0
      ? byCategory[cat].passed / byCategory[cat].total
      : 0;
  }

  // By persona
  const byPersona: Record<string, { total: number; passed: number; accuracy: number }> = {};
  for (const testCase of PERSONA_INFERENCE_TEST_CASES) {
    const persona = testCase.expectedPersona;
    if (!byPersona[persona]) {
      byPersona[persona] = { total: 0, passed: 0, accuracy: 0 };
    }
    byPersona[persona].total++;
  }
  for (const result of results) {
    if (result.passed) {
      byPersona[result.expectedPersona].passed++;
    }
  }
  for (const persona of Object.keys(byPersona)) {
    byPersona[persona].accuracy = byPersona[persona].total > 0
      ? byPersona[persona].passed / byPersona[persona].total
      : 0;
  }

  // Confusion matrix
  const confusionMap = new Map<string, number>();
  for (const result of results) {
    const key = `${result.expectedPersona}|${result.inferredPersona}`;
    confusionMap.set(key, (confusionMap.get(key) || 0) + 1);
  }
  const confusionMatrix: Array<{ expected: string; inferred: string; count: number }> = [];
  for (const [key, count] of confusionMap.entries()) {
    const [expected, inferred] = key.split("|");
    confusionMatrix.push({ expected, inferred, count });
  }

  return {
    totalTests,
    passed,
    failed: totalTests - passed,
    accuracy: totalTests > 0 ? passed / totalTests : 0,
    byCategory,
    byPersona,
    confusionMatrix,
  };
}

/**
 * Generate inference evaluation report
 */
export const generateInferenceReport = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const { results, summary } = await ctx.runAction(
      // @ts-ignore - self-reference
      api.domains.evaluation.inference.personaInferenceEval.runPersonaInferenceEval,
      {}
    );

    const lines: string[] = [];

    lines.push(`═══════════════════════════════════════════════════════════════`);
    lines.push(`PERSONA INFERENCE EVALUATION REPORT`);
    lines.push(`═══════════════════════════════════════════════════════════════`);
    lines.push(``);

    lines.push(`SUMMARY`);
    lines.push(`  Total Tests: ${summary.totalTests}`);
    lines.push(`  Passed: ${summary.passed}`);
    lines.push(`  Failed: ${summary.failed}`);
    lines.push(`  Accuracy: ${(summary.accuracy * 100).toFixed(1)}%`);
    lines.push(``);

    lines.push(`BY CATEGORY`);
    for (const [cat, data] of Object.entries(summary.byCategory) as [string, { total: number; passed: number; accuracy: number }][]) {
      lines.push(`  ${cat}: ${data.passed}/${data.total} (${(data.accuracy * 100).toFixed(1)}%)`);
    }
    lines.push(``);

    lines.push(`BY PERSONA`);
    for (const [persona, data] of Object.entries(summary.byPersona) as [string, { total: number; passed: number; accuracy: number }][]) {
      lines.push(`  ${persona}: ${data.passed}/${data.total} (${(data.accuracy * 100).toFixed(1)}%)`);
    }
    lines.push(``);

    lines.push(`FAILURES`);
    const failures = results.filter((r: InferenceResult) => !r.passed);
    if (failures.length === 0) {
      lines.push(`  None! All tests passed.`);
    } else {
      for (const f of failures) {
        lines.push(`  [${f.testCaseId}] Expected: ${f.expectedPersona}, Got: ${f.inferredPersona}`);
        lines.push(`    Query: "${f.query.slice(0, 60)}..."`);
      }
    }
    lines.push(``);

    lines.push(`CONFUSION MATRIX (misclassifications)`);
    const misclassifications = summary.confusionMatrix.filter((c: { expected: string; inferred: string; count: number }) => c.expected !== c.inferred);
    if (misclassifications.length === 0) {
      lines.push(`  No misclassifications!`);
    } else {
      for (const c of misclassifications) {
        lines.push(`  ${c.expected} -> ${c.inferred}: ${c.count} case(s)`);
      }
    }

    lines.push(`═══════════════════════════════════════════════════════════════`);

    return lines.join("\n");
  },
});
