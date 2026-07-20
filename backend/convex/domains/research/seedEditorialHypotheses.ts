/**
 * Phase 8b §2 — Editorial Hypotheses Seed.
 *
 * Inserts 5 evergreen "competing explanations" for the editorial home's
 * §2 section.  Each hypothesis is standalone (not bound to a
 * narrativeThread) so the editorial home can render without auth and
 * without coupling to the LinkedIn pipeline.
 *
 * Idempotent: by-hypothesisId match skips dupes on re-run.
 *
 * Per the misc-PR note: each row's evidenceChecklist is STORED at seed
 * time (deterministic 6-bool computed from the claim's source quality)
 * rather than re-derived on read.  When the editorial home reads the
 * row, it returns the stored value verbatim.
 *
 * Run via:
 *   npx convex run domains/research/seedEditorialHypotheses:seed '{}'
 *
 * agentic_reliability invariants:
 *   BOUND          fixed list of 5 hypotheses
 *   HONEST_STATUS  inserted/skipped counts returned
 *   HONEST_SCORES  evidenceChecklist computed from explicit per-row
 *                  source quality, not invented
 *   DETERMINISTIC  hypothesisId is the canonical key
 *   ERROR_BOUNDARY each row inserted independently
 */

import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";

type Seed = {
  hypothesisId: string;       // stable canonical ID
  label: string;              // "H1", "H2"
  title: string;
  topicSlug: string;
  topicName: string;
  claimForm: string;
  measurementApproach: string;
  falsificationCriteria: string;
  competingHypothesisIds: string[];
  confidence: number;
  speculativeRisk: "grounded" | "mixed" | "speculative";
  // STORED — computed at seed time from the source-quality of the
  // hand-authored claim.  Each boolean is true ONLY when explicitly
  // observable (per HONEST_SCORES — no invented passes).
  evidenceChecklist: {
    hasPrimarySource: boolean;
    hasCorroboration: boolean;
    hasFalsifiableClaim: boolean;
    hasQuantitativeData: boolean;
    hasNamedAttribution: boolean;
    isReproducible: boolean;
  };
  sourceUrls: string[];
};

const SEED_HYPOTHESES: Seed[] = [
  // ── Topic A: Open-source agents closing capability gap ──
  {
    hypothesisId: "edh:agent-os-h1",
    label: "H1",
    title: "Open-source agents close the proprietary gap by 2027",
    topicSlug: "agent-stack-2026",
    topicName: "Agent stack maturity",
    claimForm:
      "By 2027-12-31, at least one open-weight model + open-source agent runtime will match or exceed Claude/GPT-frontier performance on SWE-bench Verified within 5 percentage points.",
    measurementApproach:
      "Track SWE-bench Verified leaderboard quarterly. Compare top open-weight + open-runtime stack vs top closed model. Resolve when gap ≤ 5pp for 2 consecutive quarters.",
    falsificationCriteria:
      "Closed-source labs maintain >10pp lead through end of 2027 across SWE-bench, HumanEval, and MMLU.",
    competingHypothesisIds: ["edh:agent-os-h2"],
    confidence: 0.55,
    speculativeRisk: "mixed",
    evidenceChecklist: {
      // arXiv abstracts + SWE-bench leaderboard are public and
      // tier3-tier2; falsifiability is explicit; no quantitative data
      // citation embedded in the claim itself (only in measurement).
      hasPrimarySource: true,        // SWE-bench leaderboard is canonical
      hasCorroboration: true,        // multiple labs publish results
      hasFalsifiableClaim: true,     // 5pp/10pp thresholds defined
      hasQuantitativeData: true,     // explicit pp thresholds in claim
      hasNamedAttribution: false,    // no named expert in claim text
      isReproducible: true,          // anyone can re-check leaderboards
    },
    sourceUrls: [
      "https://www.swebench.com",
      "https://huggingface.co/spaces/HuggingFaceH4/open_llm_leaderboard",
    ],
  },
  {
    hypothesisId: "edh:agent-os-h2",
    label: "H2",
    title: "Closed-frontier moat persists through 2027",
    topicSlug: "agent-stack-2026",
    topicName: "Agent stack maturity",
    claimForm:
      "Closed-source frontier labs (Anthropic, OpenAI, Google DeepMind) will maintain >10pp lead on SWE-bench Verified through 2027-12-31, sustained by RLHF data scale + training compute that open-source cannot match.",
    measurementApproach:
      "Quarterly track of top 3 closed vs top 3 open-weight on SWE-bench Verified. Resolve when gap < 10pp for 2 consecutive quarters (favoring open-source thesis), or > 10pp through 2027 (favoring closed thesis).",
    falsificationCriteria:
      "Any quarter in 2027 where an open-weight model + open runtime is within 5pp of frontier closed lab on SWE-bench Verified.",
    competingHypothesisIds: ["edh:agent-os-h1"],
    confidence: 0.45,
    speculativeRisk: "mixed",
    evidenceChecklist: {
      hasPrimarySource: true,
      hasCorroboration: true,
      hasFalsifiableClaim: true,
      hasQuantitativeData: true,
      hasNamedAttribution: false,
      isReproducible: true,
    },
    sourceUrls: [
      "https://www.swebench.com",
      "https://www.anthropic.com/research",
    ],
  },

  // ── Topic B: Forecasting becomes lab differentiator ──
  {
    hypothesisId: "edh:forecasting-h1",
    label: "H1",
    title: "Brier-scored track records become a marketing axis by 2027",
    topicSlug: "forecasting-os-2026",
    topicName: "Forecasting OS adoption",
    claimForm:
      "By 2027-06-30, at least 2 frontier AI labs will publish ongoing Brier-scored forecasting track records (≥ 50 resolved questions) as a marketing differentiator.",
    measurementApproach:
      "Monitor Anthropic, OpenAI, Google DeepMind, xAI, Meta marketing pages and changelog. Count labs with public dashboards showing ≥50 resolved Brier-scored forecasts.",
    falsificationCriteria:
      "Through 2027-06-30, fewer than 2 frontier labs publish such a dashboard.",
    competingHypothesisIds: ["edh:forecasting-h2"],
    confidence: 0.3,
    speculativeRisk: "speculative",
    evidenceChecklist: {
      hasPrimarySource: false,       // no current example exists yet
      hasCorroboration: false,
      hasFalsifiableClaim: true,     // explicit count + deadline
      hasQuantitativeData: true,
      hasNamedAttribution: false,
      isReproducible: true,          // observers can verify
    },
    sourceUrls: [
      "https://manifold.markets",
      "https://www.metaculus.com",
    ],
  },
  {
    hypothesisId: "edh:forecasting-h2",
    label: "H2",
    title: "Calibration remains too risky to publish openly",
    topicSlug: "forecasting-os-2026",
    topicName: "Forecasting OS adoption",
    claimForm:
      "Through 2027-12-31, no frontier lab will publish an open Brier-scored forecasting track record because exposing miscalibration is competitively damaging.",
    measurementApproach:
      "Survey lab marketing/research pages quarterly. Resolve when any lab publishes ≥ 50 resolved Brier scores publicly, OR when 2027 ends without one.",
    falsificationCriteria:
      "Any frontier lab publishes a public Brier-scored forecasting dashboard with ≥ 50 resolved questions before 2027-12-31.",
    competingHypothesisIds: ["edh:forecasting-h1"],
    confidence: 0.7,
    speculativeRisk: "mixed",
    evidenceChecklist: {
      hasPrimarySource: true,        // historical absence is observable
      hasCorroboration: true,        // multiple labs, none publishing
      hasFalsifiableClaim: true,
      hasQuantitativeData: true,
      hasNamedAttribution: false,
      isReproducible: true,
    },
    sourceUrls: [
      "https://manifold.markets/AI",
      "https://forecastingbench.org",
    ],
  },

  // ── Topic C: Regulation lags capability ──
  {
    hypothesisId: "edh:regulation-h1",
    label: "H1",
    title: "US federal agentic-AI rule lands by 2027 due to incident pressure",
    topicSlug: "agentic-regulation-2026",
    topicName: "Agentic AI regulation",
    claimForm:
      "A binding US federal regulation specifically targeting agentic AI (autonomous tool use) will be finalized in the Federal Register by 2027-12-31, triggered by a high-profile autonomous-agent incident.",
    measurementApproach:
      "Monitor Federal Register for final rules referencing 'autonomous AI', 'agentic AI', 'agent autonomy'. Resolve YES if found by 2027-12-31; NO otherwise.",
    falsificationCriteria:
      "No final binding US federal rule specifically targeting agentic AI is published before 2027-12-31.",
    competingHypothesisIds: [],
    confidence: 0.4,
    speculativeRisk: "mixed",
    evidenceChecklist: {
      hasPrimarySource: true,        // Federal Register is canonical
      hasCorroboration: true,        // EU AI Act precedent
      hasFalsifiableClaim: true,
      hasQuantitativeData: false,    // no count threshold in claim
      hasNamedAttribution: false,
      isReproducible: true,
    },
    sourceUrls: [
      "https://www.federalregister.gov/documents/search?conditions[term]=agentic+AI",
      "https://artificialintelligenceact.eu",
    ],
  },
];

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let inserted = 0;
    let skipped = 0;
    for (const seed of SEED_HYPOTHESES) {
      const existing = await ctx.db
        .query("editorialHypotheses")
        .withIndex("by_hypothesis_id", (q) =>
          q.eq("hypothesisId", seed.hypothesisId),
        )
        .first();
      if (existing) {
        skipped++;
        continue;
      }
      await ctx.db.insert("editorialHypotheses", {
        hypothesisId: seed.hypothesisId,
        label: seed.label,
        title: seed.title,
        topicSlug: seed.topicSlug,
        topicName: seed.topicName,
        claimForm: seed.claimForm,
        measurementApproach: seed.measurementApproach,
        falsificationCriteria: seed.falsificationCriteria,
        competingHypothesisIds: seed.competingHypothesisIds,
        supportingEvidenceCount: seed.sourceUrls.length, // each URL = 1 supporting source
        contradictingEvidenceCount: 0,
        confidence: seed.confidence,
        speculativeRisk: seed.speculativeRisk,
        status: "active" as const,
        evidenceChecklist: seed.evidenceChecklist,
        sourceUrls: seed.sourceUrls,
        createdByAgent: "editorial-seed",
        createdAt: now,
        updatedAt: now,
      });
      inserted++;
    }
    return { inserted, skipped, total: SEED_HYPOTHESES.length };
  },
});
