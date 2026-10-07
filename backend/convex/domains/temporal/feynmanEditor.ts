/**
 * Feynman Editor Agent
 * "Thompson Protocol" content simplification engine.
 *
 * Takes a causal chain or signal and produces content that:
 * 1. Strips elitist jargon → plain English
 * 2. Uses visual analogies (Fireship/Professor Jiang style)
 * 3. Acknowledges uncertainty explicitly
 * 4. Cites source references with evidence scores
 *
 * Named after Feynman's principle: "If you can't explain it simply,
 * you don't understand it well enough."
 */

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { api } from "../../_generated/api";

/* ================================================================== */
/* TYPES                                                               */
/* ================================================================== */

export interface FeynmanOutput {
  headline: string;
  plainEnglishSummary: string;
  visualAnalogy: string;
  difficultyAcknowledgment: string;
  keyInsight: string;
  evidenceScore: {
    total: number;
    maxPossible: number;
    checks: Array<{
      label: string;
      passed: boolean;
    }>;
  };
  sourceRefs: Array<{
    label: string;
    href?: string;
    credibility: "verified" | "partial" | "unverified";
  }>;
  actionableStep: string;
  confidenceMessage: string;
}

export interface ContentDraft {
  postType: "signal" | "analysis" | "agency";
  title: string;
  body: string;
  hashtags: string[];
  evidenceBadge: string;
  cta: string;
}

/* ================================================================== */
/* JARGON DICTIONARY                                                   */
/* ================================================================== */

const JARGON_MAP: Record<string, string> = {
  "regime shift": "fundamental pattern change",
  "TSFM": "time series forecasting model",
  "zero-shot": "without any training examples",
  "fine-tuning": "customizing an AI model with specific data",
  "transformer architecture": "the attention-based AI design pattern",
  "token": "a word or word-piece that AI processes",
  "latency": "response time",
  "throughput": "processing speed",
  "p95": "the slowest 5% of requests",
  "p99": "the slowest 1% of requests",
  "WACC": "weighted cost of capital",
  "DCF": "discounted cash flow valuation",
  "ARR": "annual recurring revenue",
  "MRR": "monthly recurring revenue",
  "burn rate": "monthly cash spending",
  "runway": "months of cash remaining",
  "Series A/B/C": "fundraising round",
  "moat": "competitive advantage that's hard to copy",
  "TAM": "total addressable market",
  "ICP": "ideal customer profile",
  "PLG": "product-led growth",
  "GTM": "go-to-market strategy",
  "churn": "customer loss rate",
  "NRR": "net revenue retention",
  "LTV": "lifetime customer value",
  "CAC": "customer acquisition cost",
  "OTel": "OpenTelemetry (distributed tracing standard)",
  "HITL": "human-in-the-loop review",
  "MCP": "Model Context Protocol (AI tool standard)",
  "SOC 2": "security compliance certification",
  "RBAC": "role-based access control",
  "SSRF": "server-side request forgery attack",
  "XSS": "cross-site scripting attack",
  "idempotent": "safe to retry without side effects",
  "backpressure": "slowing down when overwhelmed",
  "circuit breaker": "automatic failure protection",
  "blue-green deployment": "switching between two identical environments",
  "canary release": "gradual rollout to a small percentage first",
  "feature flag": "toggle to turn features on/off without deploying",
};

/* ================================================================== */
/* CORE FUNCTIONS                                                      */
/* ================================================================== */

/**
 * Strip jargon from text using the dictionary.
 * Returns both cleaned text and a list of replacements made.
 */
function stripJargon(text: string): { cleaned: string; replacements: string[] } {
  let cleaned = text;
  const replacements: string[] = [];

  for (const [jargon, plain] of Object.entries(JARGON_MAP)) {
    const regex = new RegExp(`\\b${jargon}\\b`, "gi");
    if (regex.test(cleaned)) {
      cleaned = cleaned.replace(regex, plain);
      replacements.push(`"${jargon}" → "${plain}"`);
    }
  }

  return { cleaned, replacements };
}

/**
 * Compute a deterministic evidence score from source refs.
 * 6-point boolean checklist (same as LinkedIn pipeline).
 */
function computeEvidenceScore(
  sources: Array<{ href?: string; type?: string }>,
  opts?: { hasHardNumbers?: boolean; hasFalsifiableClaim?: boolean },
): {
  total: number;
  maxPossible: number;
  checks: Array<{ label: string; passed: boolean }>;
} {
  const checks = [
    { label: "Has government/regulatory source", passed: sources.some(s => s.type === "government" || s.type === "regulatory") },
    { label: "Has primary source (not just aggregator)", passed: sources.some(s => s.type === "primary" || s.type === "filing") },
    { label: "Multiple independent sources", passed: sources.length >= 2 },
    { label: "Contains hard numbers", passed: opts?.hasHardNumbers ?? false },
    { label: "Has corroborating source", passed: sources.length >= 3 },
    { label: "Has falsifiable claim", passed: opts?.hasFalsifiableClaim ?? false },
  ];

  return {
    total: checks.filter(c => c.passed).length,
    maxPossible: 6,
    checks,
  };
}

/* ================================================================== */
/* ACTIONS                                                             */
/* ================================================================== */

/**
 * Transform a signal + causal chain into Feynman-style plain English content.
 * No LLM required — deterministic template-based transformation.
 */
export const simplifySignal = action({
  args: {
    signalKey: v.string(),
    chainKey: v.optional(v.string()),
    targetAudience: v.optional(v.string()),
  },
  handler: async (ctx, { signalKey, chainKey, targetAudience }): Promise<FeynmanOutput> => {
    // Fetch the signal
    const signal = await ctx.runQuery(api.domains.temporal.queries.getSignalByKey, { signalKey });
    if (!signal) throw new Error(`Signal ${signalKey} not found`);

    // Fetch causal chain if provided
    let chain = null;
    if (chainKey) {
      chain = await ctx.runQuery(api.domains.temporal.queries.getCausalChainByKey, { chainKey });
    }

    // Strip jargon from signal summary
    const { cleaned: cleanSummary, replacements } = stripJargon(signal.summary);
    const { cleaned: cleanPlain } = stripJargon(signal.plainEnglish);

    // Build visual analogy based on signal type
    const analogies: Record<string, string> = {
      momentum: "Think of this like a train gaining speed — each new data point pushes it faster in the same direction.",
      regime_shift: "Imagine the river suddenly changed course. The old rules don't apply anymore.",
      anomaly: "This is like a fire alarm going off — it might be a real fire, or someone burnt toast. Either way, worth investigating.",
      causal_hint: "There's a breadcrumb trail connecting these events — follow the timestamps.",
      opportunity_window: "A door just opened, but it won't stay open forever. The window is measurable.",
      risk_window: "Warning lights are flashing — the data suggests turbulence ahead.",
    };

    // Compute evidence score — preserve source type data when available
    const sources = (signal.sourceRefs ?? []).map(s => ({
      href: s.href,
      type: (s as Record<string, unknown>).type as string | undefined,
    }));
    // Detect hard numbers: signal summary or plain English contains numeric values
    const hasHardNumbers = /\d+(\.\d+)?%|\$[\d,.]+|\d{2,}/.test(signal.summary + " " + signal.plainEnglish);
    const evidenceScore = computeEvidenceScore(sources, { hasHardNumbers });

    // Build confidence message
    const confidenceLevel = signal.confidence > 0.8 ? "high"
      : signal.confidence > 0.5 ? "moderate"
      : "preliminary";

    return {
      headline: cleanSummary.split(".")[0] || cleanSummary,
      plainEnglishSummary: cleanPlain,
      visualAnalogy: analogies[signal.signalType] ?? "The data tells a story — here's what it means.",
      difficultyAcknowledgment: replacements.length > 0
        ? `This topic involves some technical concepts. We translated ${replacements.length} terms into plain English.`
        : "This is relatively straightforward — no jargon translation needed.",
      keyInsight: signal.recommendedAction ?? `A ${signal.signalType} signal was detected with ${confidenceLevel} confidence.`,
      evidenceScore,
      sourceRefs: (signal.sourceRefs ?? []).map(s => ({
        label: s.label,
        href: s.href,
        credibility: signal.confidence > 0.7 ? "verified" as const : signal.confidence > 0.4 ? "partial" as const : "unverified" as const,
      })),
      actionableStep: signal.recommendedAction ?? "Monitor this signal for the next 48 hours. Set up a forecast to track the outcome.",
      confidenceMessage: `Confidence: ${(signal.confidence * 100).toFixed(0)}% (${confidenceLevel}). ${evidenceScore.total}/${evidenceScore.maxPossible} evidence checks passed.`,
    };
  },
});

/**
 * Generate a 3-post content thread from a signal.
 * Structure: Signal → Analysis → Agency (same as LinkedIn pipeline).
 */
export const generateContentThread = action({
  args: {
    signalKey: v.string(),
    chainKey: v.optional(v.string()),
    platform: v.optional(v.union(v.literal("linkedin"), v.literal("twitter"), v.literal("blog"))),
  },
  handler: async (ctx, { signalKey, chainKey, platform }) => {
    const feynmanOutput = await ctx.runAction(
      api.domains.temporal.feynmanEditor.simplifySignal,
      { signalKey, chainKey },
    );

    const badge = `[${feynmanOutput.evidenceScore.total}/${feynmanOutput.evidenceScore.maxPossible}]`;

    const drafts: ContentDraft[] = [
      // Post 1: The Signal
      {
        postType: "signal",
        title: "The Signal",
        body: [
          feynmanOutput.headline,
          "",
          feynmanOutput.plainEnglishSummary,
          "",
          feynmanOutput.visualAnalogy,
          "",
          `Evidence score: ${badge}`,
          "",
          "Which signal are you tracking?",
        ].join("\n"),
        hashtags: ["#DataDriven", "#Signals"],
        evidenceBadge: badge,
        cta: "Which signal are you tracking?",
      },
      // Post 2: The Analysis
      {
        postType: "analysis",
        title: "The Analysis",
        body: [
          `Deep dive: ${feynmanOutput.headline}`,
          "",
          feynmanOutput.difficultyAcknowledgment,
          "",
          `Key insight: ${feynmanOutput.keyInsight}`,
          "",
          `Confidence: ${feynmanOutput.confidenceMessage}`,
          "",
          "Sources:",
          ...feynmanOutput.sourceRefs.map(s =>
            `- ${s.label} [${s.credibility.toUpperCase()}]${s.href ? ` ${s.href}` : ""}`
          ),
          "",
          "What claim would you fact-check?",
        ].join("\n"),
        hashtags: ["#Analysis", "#FactCheck"],
        evidenceBadge: badge,
        cta: "What claim would you fact-check?",
      },
      // Post 3: The Agency
      {
        postType: "agency",
        title: "The Agency",
        body: [
          `What you can do about it:`,
          "",
          feynmanOutput.actionableStep,
          "",
          `Stress-test this conclusion:`,
          ...feynmanOutput.evidenceScore.checks
            .filter(c => !c.passed)
            .map(c => `- Missing: ${c.label}`),
          "",
          `Overall evidence: ${badge}`,
          "",
          "What are you working on?",
        ].join("\n"),
        hashtags: ["#Actionable", "#BuildInPublic"],
        evidenceBadge: badge,
        cta: "What are you working on?",
      },
    ];

    return {
      platform: platform ?? "linkedin",
      signalKey,
      feynmanOutput,
      drafts,
      totalDrafts: drafts.length,
    };
  },
});
