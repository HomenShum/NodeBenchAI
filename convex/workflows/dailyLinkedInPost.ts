"use node";

/**
 * Daily LinkedIn Post Workflow
 *
 * Automated workflow that runs at 6:00 AM UTC daily to:
 * 1. Generate the morning digest with fact-checked findings
 * 2. Format for LinkedIn (professional tone, 2000 char limit)
 * 3. Post to LinkedIn via the linkedinPosting action
 *
 * Cost: $0.00 (uses best available free model for all LLM calls)
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AgentDigestOutput } from "../domains/agents/digestAgent";
import type { FastVerifyResult } from "../domains/verification/fastVerification";
import { calculateRiskScore, detectRiskSignals, selectDDTierWithRisk } from "../domains/agents/dueDiligence/riskScoring";
import type { MicroBranchResult } from "../domains/agents/dueDiligence/microBranches";
import {
  matchSignalsToForecasts,
  matchFindingsToForecasts,
  formatDeltaBadge,
  formatEvidenceLink,
  type DigestSignal,
  type DigestFinding,
  type ActiveForecast,
  type ForecastUpdate,
  type SignalForecastMatch,
  type FindingForecastMatch,
} from "../domains/forecasting/signalMatcher";

type LinkedInCompetingExplanation = {
  title: string;
  explanation: string;
  evidenceLevel: "grounded" | "mixed" | "speculative";
  measurementApproach: string;
  falsificationCriteria: string;
  evidenceChecklist?: {
    hasPrimarySource: boolean;
    hasCorroboration: boolean;
    hasFalsifiableClaim: boolean;
    hasQuantitativeData: boolean;
    hasNamedAttribution: boolean;
    isReproducible: boolean;
  };
  checksPassing?: number;
  checksTotal?: number;
};

// ═══════════════════════════════════════════════════════════════════════════
// LINKEDIN POST FORMATTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format the digest for LinkedIn posting as a multi-post thread.
 * Returns an array of 2-3 posts, each under 1450 chars.
 *
 * Post structure:
 * - Post 1 (The Signal): Hook + key developments. What's actually happening.
 * - Post 2 (The Analysis): Fact-checks, deeper context, cut through noise.
 * - Post 3 (The Agency): Actionable steps, skills to build, what's under your control.
 *
 * Content philosophy:
 * - Cut through noise and distraction narratives
 * - Highlight what's actionable vs what's just spectacle
 * - Provoke reader agency -- their own ability to explore, read, and resolve
 * - Help people focus on things under their control rather than despair
 *
 * Engagement gate requirements (each post):
 * - Lead with a hook/claim, NOT a report header
 * - Include at least one opinion/take ("This signals...", "Watch for...")
 * - Include at least one question
 * - Stay under 1500 characters
 * - Use content-specific hashtags (not just generic #AI)
 */
interface ForecastCard {
  question: string;
  probability: number;
  confidenceInterval?: { lower: number; upper: number };
  resolutionDate: string;
  topDrivers: string[];
  topCounterarguments: string[];
  updateCount: number;
  previousProbability?: number; // for Δ display
  traceSteps?: string[];       // compact TRACE breadcrumb (tool names)
}

// ── Thompson Protocol — deterministic anti-elitism lint ─────────────────────
// Inlined from packages/mcp-local/src/tools/thompsonProtocolTools.ts
// These are pure functions with zero dependencies.

const THOMPSON_BANNED_PHRASES: Array<{ phrase: string; category: string; replacement: string }> = [
  { phrase: "it is obvious that", category: "assumed_knowledge", replacement: "Here's what's happening:" },
  { phrase: "as we all know", category: "assumed_knowledge", replacement: "Here's the background:" },
  { phrase: "clearly", category: "assumed_knowledge", replacement: "" },
  { phrase: "of course", category: "assumed_knowledge", replacement: "" },
  { phrase: "trivially", category: "assumed_knowledge", replacement: "" },
  { phrase: "it goes without saying", category: "assumed_knowledge", replacement: "" },
  { phrase: "any competent", category: "assumed_knowledge", replacement: "" },
  { phrase: "this is basic", category: "assumed_knowledge", replacement: "" },
  { phrase: "simply put", category: "false_simplification", replacement: "Here's one way to think about it:" },
  { phrase: "all you have to do is", category: "false_simplification", replacement: "Here are the steps:" },
  { phrase: "it's easy", category: "false_simplification", replacement: "" },
  { phrase: "this is straightforward", category: "false_simplification", replacement: "Here's how it works:" },
  { phrase: "real engineers know", category: "exclusionary", replacement: "" },
  { phrase: "if you don't understand", category: "exclusionary", replacement: "Let me break this down:" },
  { phrase: "you should already know", category: "exclusionary", replacement: "Quick background:" },
  { phrase: "as i mentioned before", category: "passive_aggressive", replacement: "" },
  { phrase: "for those who missed it", category: "passive_aggressive", replacement: "" },
];

function thompsonLintBannedPhrases(text: string): Array<{ phrase: string; category: string; replacement: string; position: number }> {
  const lower = text.toLowerCase();
  const hits: Array<{ phrase: string; category: string; replacement: string; position: number }> = [];
  for (const entry of THOMPSON_BANNED_PHRASES) {
    let pos = 0;
    while ((pos = lower.indexOf(entry.phrase, pos)) !== -1) {
      hits.push({ ...entry, position: pos });
      pos += entry.phrase.length;
    }
  }
  return hits;
}

function thompsonCountSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  let count = 0;
  const vowels = "aeiouy";
  let prevVowel = false;
  for (const ch of w) {
    const isVowel = vowels.includes(ch);
    if (isVowel && !prevVowel) count++;
    prevVowel = isVowel;
  }
  if (w.endsWith("e") && count > 1) count--;
  return Math.max(1, count);
}

function thompsonAnalogyDensity(text: string): { score: number; analogyCount: number; translationCount: number; wordCount: number } {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const analogyPatterns = /\b(like a|think of|imagine|picture this|it's as if|similar to|the same way|just as a|works like|acts like|equivalent of)\b/gi;
  const analogyCount = (text.match(analogyPatterns) || []).length;
  const translationPatterns = /\b(in other words|put differently|meaning|that means|which means|in plain english|in simple terms)\b/gi;
  const translationCount = (text.match(translationPatterns) || []).length;
  const analogyDensity = wordCount > 0 ? (analogyCount / wordCount) * 200 : 0;
  const translationDensity = wordCount > 0 ? (translationCount / wordCount) * 300 : 0;
  const score = Math.min(100, Math.round((Math.min(analogyDensity, 2) * 30) + (Math.min(translationDensity, 2) * 10)));
  return { score, analogyCount, translationCount, wordCount };
}

function thompsonReadabilityMetrics(text: string): { fleschKincaidGrade: number; passiveVoicePct: number; avgSentenceLength: number; jargonDensity: number } {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const syllableCount = words.reduce((sum, w) => sum + thompsonCountSyllables(w), 0);
  const avgSentenceLength = sentences.length > 0 ? words.length / sentences.length : 0;
  const avgSyllablesPerWord = words.length > 0 ? syllableCount / words.length : 0;
  const fkGrade = 0.39 * avgSentenceLength + 11.8 * avgSyllablesPerWord - 15.59;
  const passivePatterns = /\b(is|was|were|been|being|are)\s+\w+ed\b/gi;
  const passiveMatches = text.match(passivePatterns) || [];
  const passiveVoicePct = sentences.length > 0 ? (passiveMatches.length / sentences.length) * 100 : 0;
  const complexWords = words.filter((w) => thompsonCountSyllables(w) > 3).length;
  const jargonDensity = words.length > 0 ? (complexWords / words.length) * 100 : 0;
  return {
    fleschKincaidGrade: Math.max(0, Math.round(fkGrade * 10) / 10),
    passiveVoicePct: Math.round(passiveVoicePct * 10) / 10,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    jargonDensity: Math.round(jargonDensity * 10) / 10,
  };
}

function formatDigestForLinkedIn(
  digest: AgentDigestOutput,
  _options: {
    maxLength?: number;
    minLength?: number;
    forecastCards?: ForecastCard[];
    trackRecord?: { scoredCount: number; overallBrier: number | null };
    signalMatches?: SignalForecastMatch[];
    findingMatches?: FindingForecastMatch[];
  } = {}
): string[] {
  const maxPerPost = 1450;
  const signals = digest.signals ?? [];
  const entities = digest.entitySpotlight ?? [];
  const findings = digest.factCheckFindings ?? [];
  const actions = digest.actionItems ?? [];
  const specificTags = buildContentSpecificHashtags(digest);
  const domain = extractDomain(digest.leadStory?.title || signals[0]?.title || "tech");
  const totalPosts = (findings.length > 0 || actions.length > 0) ? 3 : 2;

  function capPost(text: string): string {
    if (text.length <= maxPerPost) return text;
    return text.slice(0, maxPerPost - 3).trimEnd() + "...";
  }

  const explanations = (digest.competingExplanations ?? []) as LinkedInCompetingExplanation[];
  const framing = digest.narrativeFraming;

  // ── Post 1: WHAT'S HAPPENING ──
  // Factual lead. Data. Key developments. Competing explanations as prose.
  const p1: string[] = [];

  // Hook: use narrative framing if DRANE data is available
  if (framing) {
    p1.push(truncateAtSentenceBoundary(
      `While ${framing.dominantStory} dominates ${framing.attentionShare} of social feeds this week, ${framing.underReportedAngle}.`,
      280
    ));
  } else {
    const leadHook = digest.leadStory?.whyItMatters
      || digest.narrativeThesis
      || signals[0]?.summary
      || `Key developments in ${domain} today that aren't getting enough attention.`;
    p1.push(truncateAtSentenceBoundary(leadHook, 220));
  }
  p1.push("");

  // Build signal→forecast Δ badge lookup (max 2 badges per post)
  const signalMatchMap = new Map<number, SignalForecastMatch>();
  let badgeCount = 0;
  for (const sm of (_options.signalMatches ?? [])) {
    if (badgeCount >= 2) break;
    if (sm.probabilityDelta && sm.probabilityDelta.from !== sm.probabilityDelta.to) {
      if (!signalMatchMap.has(sm.signalIndex)) {
        signalMatchMap.set(sm.signalIndex, sm);
        badgeCount++;
      }
    }
  }

  const signalCount = Math.min(signals.length, 4);
  if (signalCount > 0) {
    for (let i = 0; i < signalCount; i++) {
      const s = signals[i];
      let line = `${i + 1}. ${s.title}`;
      if (s.hardNumbers) line += ` -- ${s.hardNumbers}`;
      p1.push(truncateAtSentenceBoundary(line, 200));
      const hasBadge = signalMatchMap.has(i);
      if (s.summary && i < 2) {
        // Trim summary slightly if we're adding a Δ badge (150→120 chars)
        p1.push(`   ${truncateAtSentenceBoundary(s.summary, hasBadge ? 120 : 150)}`);
      }
      if (s.url && i < 2) p1.push(`   ${s.url}`);
      // Δ badge: show which forecast this signal moved
      const match = signalMatchMap.get(i);
      if (match?.probabilityDelta) {
        p1.push(`   \u{1F4CA} ${formatDeltaBadge(match.forecastQuestion, match.probabilityDelta.from, match.probabilityDelta.to)}`);
      }
    }
    p1.push("");
  }

  for (const entity of entities.slice(0, 2)) {
    const stage = entity.fundingStage ? ` [${entity.fundingStage}]` : "";
    p1.push(`${entity.name}${stage}: ${truncateAtSentenceBoundary(entity.keyInsight, 120)}`);
  }
  if (entities.length > 0) p1.push("");

  // Competing explanations as natural prose (Phase 7)
  if (explanations.length >= 2) {
    p1.push(`When I fact-checked these, ${explanations.length} different takes emerged:`);
    for (const e of explanations.slice(0, 3)) {
      p1.push(`- ${truncateAtSentenceBoundary(e.explanation, 160)}`);
    }
    p1.push("");
    p1.push(`Each one leads to a different set of decisions.`);
  } else {
    p1.push(`These ${domain} developments connect in ways the headlines don't surface.`);
  }
  p1.push("");
  p1.push(`Which of these are you tracking?`);
  p1.push("");
  p1.push(`[1/${totalPosts}] ${specificTags}`);

  // ── Post 2: WHAT IT MEANS ──
  // Fact-checks with evidence grades, context, signal vs noise.
  const p2: string[] = [];

  p2.push(`Verification and context on today's ${domain} developments:`);
  p2.push("");

  // Build finding→forecast evidence link lookup (max 2 links per post)
  const findingMatchMap = new Map<number, FindingForecastMatch>();
  let linkCount = 0;
  for (const fm of (_options.findingMatches ?? [])) {
    if (linkCount >= 2) break;
    if (!findingMatchMap.has(fm.findingIndex)) {
      findingMatchMap.set(fm.findingIndex, fm);
      linkCount++;
    }
  }

  if (findings.length > 0) {
    for (let fi = 0; fi < Math.min(findings.length, 4); fi++) {
      const finding = findings[fi];
      const badge = finding.status === "verified" ? "VERIFIED"
        : finding.status === "false" ? "FALSE"
        : finding.status === "partially_verified" ? "PARTIAL"
        : "UNVERIFIED";
      p2.push(`[${badge}] ${truncateAtSentenceBoundary(finding.claim, 150)}`);
      const hasLink = findingMatchMap.has(fi);
      if (finding.explanation) {
        // Trim explanation slightly if we're adding an evidence link (140→110 chars)
        p2.push(`  ${truncateAtSentenceBoundary(finding.explanation, hasLink ? 110 : 140)}`);
      }
      // Source attribution with URL
      const srcParts: string[] = [];
      if (finding.source) srcParts.push(`Source: ${finding.source}`);
      if (finding.sourceUrl) srcParts.push(finding.sourceUrl);
      if (srcParts.length > 0) p2.push(`  ${srcParts.join(" | ")}`);
      // Evidence→forecast link
      const fMatch = findingMatchMap.get(fi);
      if (fMatch) {
        p2.push(`  ${formatEvidenceLink(fMatch.forecastQuestion, fMatch.direction, fMatch.probabilityDelta)}`);
      }
      p2.push("");
    }
  } else {
    // Fallback: use signals with URLs when no fact-checks available
    for (let i = 0; i < Math.min(signals.length, 3); i++) {
      const s = signals[i];
      if (s.summary) {
        p2.push(`${s.title}`);
        p2.push(`  ${truncateAtSentenceBoundary(s.summary, 180)}`);
        if (s.url) p2.push(`  ${s.url}`);
        p2.push("");
      }
    }
  }

  // Evidence breakdown from competing explanations (Phase 7)
  if (explanations.length > 0) {
    p2.push(`How the evidence stacks up:`);
    for (const e of explanations.slice(0, 3)) {
      p2.push(renderEvidenceLine(e));
    }
    p2.push("");
  }

  // Connect dots -- what's the real story behind the noise
  p2.push(`I built a system that fact-checks and scores evidence automatically. Above is what it found today.`);
  p2.push("");
  p2.push(`What's one claim you've seen this week that you'd want fact-checked?`);
  p2.push("");
  p2.push(`[2/${totalPosts}] ${specificTags}`);

  // ── Post 3: PRACTICAL GUIDE ──
  // Specific actions. Skills to learn. Forecast cards. Falsification criteria.
  const p3: string[] = [];

  p3.push(`Based on today's research -- here's a practical guide on what to focus on:`);
  p3.push("");

  if (actions.length > 0) {
    for (let i = 0; i < Math.min(actions.length, 4); i++) {
      p3.push(`${i + 1}. ${truncateAtSentenceBoundary(actions[i].action, 180)}`);
    }
    p3.push("");
  }

  // Skills and tools -- concrete, not motivational
  const skillSignals = signals.filter(s =>
    /skill|learn|tool|framework|open.?source|developer|build|create|opportunity|hiring|job|course|certif/i.test(
      `${s.title} ${s.summary || ""}`
    )
  ).slice(0, 3);

  if (skillSignals.length > 0) {
    p3.push("Worth learning or exploring:");
    for (const s of skillSignals) {
      p3.push(`- ${truncateAtSentenceBoundary(s.title, 140)}`);
      if (s.summary) p3.push(`  ${truncateAtSentenceBoundary(s.summary, 120)}`);
    }
    p3.push("");
  }

  // Forecast cards — predictions I'm tracking (with probabilities + delta + trace)
  const forecastCards = _options.forecastCards ?? [];
  if (forecastCards.length > 0) {
    // Enhanced mode (delta + trace) for ≤2 cards, compact for 3+
    const enhanced = forecastCards.length <= 2;
    const maxCards = enhanced ? 2 : 3;
    p3.push("Forecasts I'm tracking:");
    for (const fc of forecastCards.slice(0, maxCards)) {
      const pct = (fc.probability * 100).toFixed(0);
      const range = fc.confidenceInterval
        ? ` \u00B1${((fc.confidenceInterval.upper - fc.confidenceInterval.lower) * 50).toFixed(0)}%`
        : "";
      const driver = fc.topDrivers[0] || "";
      const counter = fc.topCounterarguments[0] || "";

      // Delta display: [was X%, ±Npp today]
      let deltaStr = "";
      if (fc.previousProbability != null && fc.previousProbability !== fc.probability) {
        const prevPct = Math.round(fc.previousProbability * 100);
        const deltaPp = Math.round(fc.probability * 100) - prevPct;
        deltaStr = ` [was ${prevPct}%, ${deltaPp >= 0 ? "+" : ""}${deltaPp}pp today]`;
      }

      p3.push(`\u2192 ${truncateAtSentenceBoundary(fc.question, 80)} [by ${fc.resolutionDate}]`);
      p3.push(`  P: ${pct}%${range}${deltaStr}`);
      if (driver) p3.push(`  Why: ${truncateAtSentenceBoundary(driver, 60)}${counter ? ` | Watch: ${truncateAtSentenceBoundary(counter, 50)}` : ""}`);

      // Trace breadcrumb (enhanced mode only, max 45 chars)
      if (enhanced && fc.traceSteps && fc.traceSteps.length > 0) {
        p3.push(`  via: ${fc.traceSteps.join(" \u2192 ")}`);
      }
    }

    // Track record with Brier percentile
    const tr = _options.trackRecord;
    if (tr && tr.scoredCount >= 5 && tr.overallBrier != null) {
      // Brier baselines: Metaculus community ~0.15, GJP superforecasters ~0.12, random ~0.25
      const percentile = tr.overallBrier <= 0.12 ? "top 5%"
        : tr.overallBrier <= 0.15 ? "top 15%"
        : tr.overallBrier <= 0.20 ? "top 30%"
        : "building";
      p3.push(`Track record: ${tr.scoredCount} resolved, Brier ${tr.overallBrier.toFixed(3)} [${percentile}]`);
    }
    p3.push("");
  }

  // Falsification criteria as reader empowerment (Phase 7)
  if (explanations.length >= 2) {
    p3.push(`How to challenge each take:`);
    for (const e of explanations.slice(0, 3)) {
      const badge = e.checksPassing != null && e.checksTotal != null
        ? ` [${e.checksPassing}/${e.checksTotal}]`
        : "";
      p3.push(`- ${truncateAtSentenceBoundary(e.title, 40)}${badge}: ${truncateAtSentenceBoundary(e.falsificationCriteria, 130)}`);
    }
    p3.push("");
  }

  // Builder closer -- practitioner voice, not motivational poster
  p3.push(`This runs daily. I'll keep publishing what it finds. If you spot a claim worth checking, drop it below.`);
  p3.push("");
  p3.push(`What are you building or investigating this week?`);
  p3.push("");
  p3.push(`[3/3] ${specificTags}`);

  const posts = totalPosts === 3
    ? [capPost(p1.join("\n")), capPost(p2.join("\n")), capPost(p3.join("\n"))]
    : [capPost(p1.join("\n")), capPost(p2.join("\n"))];
  for (let i = 0; i < posts.length; i++) {
    console.log(`[formatDigestForLinkedIn] Post ${i + 1}/${posts.length}: ${posts[i].length} chars`);
  }
  return posts;
}

/**
 * Render a human-readable evidence summary for each competing explanation.
 * Thompson Protocol: prose over shorthand. The reader should understand the
 * evidence strength without decoding comma-separated labels.
 */
function renderEvidenceLine(e: {
  title: string;
  evidenceLevel: string;
  evidenceChecklist?: {
    hasPrimarySource: boolean;
    hasCorroboration: boolean;
    hasFalsifiableClaim: boolean;
    hasQuantitativeData: boolean;
    hasNamedAttribution: boolean;
    isReproducible: boolean;
  };
  checksPassing?: number;
  checksTotal?: number;
}): string {
  const cl = e.evidenceChecklist;
  const title = truncateAtSentenceBoundary(e.title, 40);

  if (!cl || e.checksPassing == null || e.checksTotal == null) {
    // Fallback: no checklist data (legacy digests)
    if (e.evidenceLevel === "grounded") return `- ${title}: This take has strong backing from official sources.`;
    if (e.evidenceLevel === "mixed") return `- ${title}: Some evidence supports this, but gaps remain.`;
    return `- ${title}: Limited evidence so far — worth watching, not betting on.`;
  }

  const score = `${e.checksPassing}/${e.checksTotal}`;

  if (e.evidenceLevel === "grounded") {
    // Strong evidence — tell the reader what makes it credible
    const strengths: string[] = [];
    if (cl.hasPrimarySource) strengths.push("traced to an official source");
    if (cl.hasCorroboration) strengths.push("confirmed by multiple outlets");
    if (cl.hasQuantitativeData) strengths.push("backed by hard numbers");
    if (cl.hasNamedAttribution) strengths.push("attributed to named sources");
    if (cl.isReproducible) strengths.push("you can verify the links yourself");
    if (cl.hasFalsifiableClaim) strengths.push("makes a testable claim");
    const prose = strengths.length > 0
      ? strengths.slice(0, 3).join(", ")
      : "multiple checks passed";
    return `- ${title} [${score}]: ${prose}.`;
  }

  // Weak/mixed evidence — tell the reader what's missing
  const gaps: string[] = [];
  if (!cl.hasPrimarySource) gaps.push("no official source yet");
  if (!cl.hasCorroboration) gaps.push("only one outlet reporting");
  if (!cl.hasQuantitativeData) gaps.push("no hard numbers");
  if (!cl.hasNamedAttribution) gaps.push("no one is on the record");
  if (!cl.isReproducible) gaps.push("no verifiable links");
  if (!cl.hasFalsifiableClaim) gaps.push("hard to disprove");
  const prose = gaps.length > 0
    ? gaps.slice(0, 3).join(", ")
    : "several checks didn't pass";
  return `- ${title} [${score}]: Watch out — ${prose}.`;
}

/**
 * Extract a short domain/topic keyword from a signal title for opinion statements.
 */
function extractDomain(title: string): string {
  const keywords = ["AI", "ML", "funding", "security", "cloud", "infrastructure", "open source", "agents", "LLM", "robotics", "biotech", "fintech", "healthcare", "crypto", "blockchain"];
  const lower = title.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) return kw;
  }
  // Fall back to first few words
  return title.split(/\s+/).slice(0, 3).join(" ").replace(/[^a-zA-Z0-9\s]/g, "").trim() || "tech";
}

/**
 * Build content-specific hashtags from digest data.
 * Avoids using ONLY generic tags (engagement gate rejects those).
 */
function buildContentSpecificHashtags(digest: AgentDigestOutput): string {
  const tags: string[] = [];

  // Extract entity names as hashtags
  for (const entity of (digest.entitySpotlight ?? []).slice(0, 2)) {
    const tag = entity.name.replace(/[^a-zA-Z0-9]/g, "");
    if (tag.length >= 3 && tag.length <= 30) tags.push(`#${tag}`);
  }

  // Extract category-based tags
  for (const cat of (digest.topCategories ?? []).slice(0, 2)) {
    if (typeof cat === "string" && cat.trim()) {
      const tag = cat.trim().replace(/[\s/]+/g, "").replace(/[^a-zA-Z0-9]/g, "");
      if (tag.length >= 2 && tag.length <= 30) tags.push(`#${tag}`);
    }
  }

  // Add 1-2 general tags to round out
  tags.push("#AI");
  if (digest.fundingRounds && digest.fundingRounds.length > 0) {
    tags.push("#StartupFunding");
  } else {
    tags.push("#TechNews");
  }

  // Deduplicate
  return [...new Set(tags)].slice(0, 5).join(" ");
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN WORKFLOW ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Post daily digest to LinkedIn.
 * This action is designed to be called from a cron job at 6:00 AM UTC.
 *
 * Steps:
 * 1. Generate digest with fact-checks using free model
 * 2. Format for LinkedIn
 * 3. Post to LinkedIn
 * 4. Log the result
 */
export const postDailyDigestToLinkedIn = internalAction({
  args: {
    persona: v.optional(v.string()),
    model: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    hoursBack: v.optional(v.number()),
    didYouKnowUrls: v.optional(v.array(v.string())),
    didYouKnowTonePreset: v.optional(
      v.union(v.literal("homer_bot_clone"), v.literal("casual_concise"), v.literal("professional"))
    ),
    forcePost: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const persona = args.persona || "GENERAL";
    const model = args.model || "qwen3-coder-free"; // Dynamic: best verified free model (Feb 2026)
    const dryRun = args.dryRun ?? false;
    const hoursBack = args.hoursBack ?? 168; // Default to 7 days for better content availability
    const forcePost = args.forcePost ?? false;

    console.log(`[dailyLinkedInPost] Starting daily LinkedIn post workflow, persona=${persona}, model=${model}, dryRun=${dryRun}, hoursBack=${hoursBack}, forcePost=${forcePost}`);

    // TRACE execution context
    const traceDate = new Date().toISOString().split("T")[0];
    const executionId = `linkedin_${traceDate}_${persona}_${Date.now()}`;
    const workflowTag = `linkedin_${traceDate}`;
    let traceSeq = 0;
    const traceStart = Date.now();

    const appendTraceEntry = async (entry: {
      seq: number;
      choiceType: "gather_info" | "execute_data_op" | "execute_output" | "finalize";
      toolName: string;
      description: string;
      metadata: {
        rowCount?: number;
        charCount?: number;
        wordCount?: number;
        keyTopics?: string[];
        errorMessage?: string;
        durationMs: number;
        success: boolean;
        originalRequest?: string;
        deliverySummary?: string;
      };
    }) => {
      try {
        await ctx.runMutation(
          internal.domains.agents.traceAuditLog.appendAuditEntry,
          {
            executionId,
            executionType: "linkedin_post" as const,
            workflowTag,
            seq: entry.seq,
            choiceType: entry.choiceType,
            toolName: entry.toolName,
            description: entry.description,
            metadata: entry.metadata,
          },
        );
      } catch (e) {
        console.warn(`[dailyLinkedInPost:TRACE] Failed to append entry seq=${entry.seq}:`, e instanceof Error ? e.message : String(e));
      }
    };

    // Step 1: Generate digest with fact-checks
    const step1Start = Date.now();
    let digestResult;
    try {
      digestResult = await ctx.runAction(
        internal.domains.agents.digestAgent.generateDigestWithFactChecks,
        { persona, model, hoursBack }
      );
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error(`[dailyLinkedInPost] Failed to generate digest: ${errorMsg}`);
      return {
        success: false,
        error: `Digest generation failed: ${errorMsg}`,
        posted: false,
      };
    }

    if (!digestResult.success || !digestResult.digest) {
      console.error(`[dailyLinkedInPost] Digest generation returned error: ${digestResult.error}`);
      return {
        success: false,
        error: digestResult.error || "Unknown digest error",
        posted: false,
      };
    }

    console.log(`[dailyLinkedInPost] Digest generated with ${digestResult.factCheckCount} fact-checks`);
    await appendTraceEntry({
      seq: traceSeq++,
      choiceType: "gather_info",
      toolName: "generateDigest",
      description: `Generated digest with ${digestResult.factCheckCount} fact-checks, ${(digestResult.digest.signals ?? []).length} signals`,
      metadata: {
        rowCount: (digestResult.digest.signals ?? []).length,
        keyTopics: (digestResult.digest.signals ?? []).slice(0, 3).map((s: any) => s.title?.slice(0, 40) || ""),
        durationMs: Date.now() - step1Start,
        success: true,
      },
    });

    // Step 1b: Generate competing explanations (agentic — LLM grades with boolean evidence checklist)
    try {
      const explanationsResult = await ctx.runAction(
        internal.domains.narrative.actions.competingExplanations.generateCompetingExplanations,
        {
          signals: (digestResult.digest.signals ?? []).slice(0, 6).map((s: any) => ({
            title: String(s.title || ""),
            summary: s.summary ? String(s.summary) : undefined,
            hardNumbers: s.hardNumbers ? String(s.hardNumbers) : undefined,
            url: s.url ? String(s.url) : undefined,
            directQuote: s.directQuote ? String(s.directQuote) : undefined,
          })),
          factChecks: (digestResult.digest.factCheckFindings ?? []).slice(0, 4).map((f: any) => ({
            claim: String(f.claim || ""),
            status: String(f.status || "unverified"),
            source: f.source ? String(f.source) : undefined,
            sourceUrl: f.sourceUrl ? String(f.sourceUrl) : undefined,
          })),
          entities: (digestResult.digest.entitySpotlight ?? []).slice(0, 3).map((e: any) => ({
            name: String(e.name || ""),
            keyInsight: String(e.keyInsight || ""),
          })),
          hasFundingRounds: (digestResult.digest.fundingRounds ?? []).length > 0,
          narrativeThesis: digestResult.digest.narrativeThesis,
          model,
        }
      );

      if (explanationsResult.explanations.length > 0) {
        digestResult.digest.competingExplanations = explanationsResult.explanations.map((e: any) => ({
          title: e.title,
          explanation: e.explanation,
          evidenceLevel: e.evidenceLevel,
          evidenceChecklist: e.evidenceChecklist,
          checksPassing: e.checksPassing,
          checksTotal: e.checksTotal,
          measurementApproach: e.measurementApproach,
          falsificationCriteria: e.falsificationCriteria,
        }));
        console.log(`[dailyLinkedInPost] Generated ${explanationsResult.explanations.length} competing explanations`);
        for (const e of explanationsResult.explanations) {
          console.log(`  "${e.title}" -> ${e.evidenceLevel} (${e.checksPassing}/${e.checksTotal} boolean checks)`);
        }
      }

      if (explanationsResult.framing) {
        digestResult.digest.narrativeFraming = explanationsResult.framing;
        console.log(`[dailyLinkedInPost] Narrative framing: "${explanationsResult.framing.dominantStory}" (${explanationsResult.framing.attentionShare})`);
      }
    } catch (e) {
      console.warn(`[dailyLinkedInPost] Competing explanations failed (non-fatal):`, e instanceof Error ? e.message : String(e));
    }
    await appendTraceEntry({
      seq: traceSeq++,
      choiceType: "gather_info",
      toolName: "generateExplanations",
      description: `Generated ${(digestResult.digest.competingExplanations ?? []).length} competing explanations`,
      metadata: {
        rowCount: (digestResult.digest.competingExplanations ?? []).length,
        durationMs: Date.now() - step1Start,
        success: true,
      },
    });

    // Step 1c: Query top active forecasts for LinkedIn cards
    let forecastCards: ForecastCard[] = [];
    let trackRecord: { scoredCount: number; overallBrier: number | null } | undefined;
    let signalMatches: SignalForecastMatch[] = [];
    let findingMatches: FindingForecastMatch[] = [];
    try {
      const topForecasts = await ctx.runQuery(
        internal.domains.forecasting.forecastManager.getTopForecastsForLinkedIn,
        { limit: 3 }
      );
      forecastCards = topForecasts.map((f: any) => ({
        question: f.question,
        probability: f.probability,
        confidenceInterval: f.confidenceInterval,
        resolutionDate: f.resolutionDate,
        topDrivers: f.topDrivers,
        topCounterarguments: f.topCounterarguments,
        updateCount: f.updateCount,
        previousProbability: f.previousProbability,
      }));
      // Get track record if we have forecasts
      if (forecastCards.length > 0) {
        const tr = await ctx.runQuery(
          internal.domains.forecasting.forecastManager.getUserTrackRecord,
          { userId: "default" }
        );
        trackRecord = { scoredCount: tr.scoredCount, overallBrier: tr.overallBrier };
      }
    } catch (e) {
      console.warn(`[dailyLinkedInPost] Forecast query failed (non-fatal):`, e instanceof Error ? e.message : String(e));
    }

    // Step 1d: Cross-reference signals↔forecasts and findings↔forecasts (deterministic)
    try {
      if (forecastCards.length > 0) {
        const digestSignals = (digestResult.digest.signals ?? []) as Array<{ title: string; summary?: string; hardNumbers?: string }>;
        const digestFindings = (digestResult.digest.factCheckFindings ?? []) as Array<{ claim: string; status: string; explanation?: string }>;

        // Build ActiveForecast[] for matching
        const activeForecasts: ActiveForecast[] = forecastCards.map((fc, i) => ({
          id: `fc_${i}`,
          question: fc.question,
          tags: [], // tags aren't on ForecastCard, but keyword matching still works
          topDrivers: fc.topDrivers,
          topCounterarguments: fc.topCounterarguments,
          probability: fc.probability,
        }));

        // Build ForecastUpdate[] from cards with previous probability
        const recentUpdates: ForecastUpdate[] = forecastCards
          .filter((fc) => fc.previousProbability != null && fc.previousProbability !== fc.probability)
          .map((fc, i) => ({
            forecastId: `fc_${i}`,
            previousProbability: fc.previousProbability!,
            newProbability: fc.probability,
            reasoning: "daily refresh",
            updatedAt: Date.now(),
          }));

        // Match signals → forecasts
        const signalInput: DigestSignal[] = digestSignals.map((s) => ({
          title: s.title || "",
          summary: s.summary || "",
          hardNumbers: s.hardNumbers,
        }));
        signalMatches = matchSignalsToForecasts(signalInput, activeForecasts, recentUpdates);

        // Match findings → forecasts
        const findingInput: DigestFinding[] = digestFindings.map((f) => ({
          claim: f.claim || "",
          status: (f.status as any) || "unverified",
          explanation: f.explanation || "",
        }));
        findingMatches = matchFindingsToForecasts(findingInput, activeForecasts, recentUpdates);

        console.log(`[dailyLinkedInPost] Cross-ref: ${signalMatches.length} signal→forecast matches, ${findingMatches.length} finding→forecast matches`);
      }
    } catch (e) {
      console.warn(`[dailyLinkedInPost] Cross-reference failed (non-fatal):`, e instanceof Error ? e.message : String(e));
    }
    await appendTraceEntry({
      seq: traceSeq++,
      choiceType: "execute_data_op",
      toolName: "matchSignalsToForecasts",
      description: `Cross-ref: ${signalMatches.length} signal\u2194forecast, ${findingMatches.length} finding\u2194forecast matches`,
      metadata: {
        rowCount: signalMatches.length + findingMatches.length,
        durationMs: Date.now() - step1Start,
        success: true,
      },
    });

    // Step 1e: Enrich forecast cards with TRACE breadcrumbs (last refresh audit trail)
    try {
      if (forecastCards.length > 0) {
        // Get TRACE steps from the most recent forecast_refresh execution
        const today = new Date().toISOString().split("T")[0];
        const traceEntries = await ctx.runQuery(
          internal.domains.agents.traceAuditLog.getAuditLogByWorkflowTag,
          { workflowTag: `forecast_refresh_${today}` }
        );
        if (traceEntries && traceEntries.length > 0) {
          // Extract compact tool name sequence for breadcrumb
          const traceSteps = traceEntries.map((e: any) => e.toolName).slice(0, 4);
          for (const fc of forecastCards) {
            fc.traceSteps = traceSteps;
          }
        }
      }
    } catch (e) {
      // Non-fatal — breadcrumbs are optional enrichment
      console.warn(`[dailyLinkedInPost] TRACE breadcrumb query failed (non-fatal):`, e instanceof Error ? e.message : String(e));
    }

    // Step 2: Format for LinkedIn (multi-post thread)
    const linkedInPosts = formatDigestForLinkedIn(digestResult.digest, {
      forecastCards,
      trackRecord,
      signalMatches,
      findingMatches,
    });

    // Optionally prepend didYouKnow to the first post
    const didYouKnowUrls =
      Array.isArray(args.didYouKnowUrls) && args.didYouKnowUrls.length > 0
        ? args.didYouKnowUrls
            .filter((u) => typeof u === "string")
            .map((u) => u.trim())
            .filter(Boolean)
            .slice(0, 2)
        : collectDidYouKnowUrlsFromDigest(digestResult.digest, 2);
    const didYouKnowWorkflowId = `linkedin_dyk_${digestResult.digest.dateString}_${persona}_${Date.now()}`;
    const didYouKnow = await maybePrependDidYouKnowToLinkedInContent({
      ctx,
      workflowId: didYouKnowWorkflowId,
      urls: didYouKnowUrls,
      baseContent: linkedInPosts[0],
      tonePreset: args.didYouKnowTonePreset ?? "casual_concise",
    });
    linkedInPosts[0] = didYouKnow.content;

    // Thompson Protocol lint gate — deterministic anti-elitism + readability + analogy density
    const thompsonLintResults = linkedInPosts.map((post, i) => {
      const hits = thompsonLintBannedPhrases(post);
      const metrics = thompsonReadabilityMetrics(post);
      const density = thompsonAnalogyDensity(post);
      if (hits.length > 0 || metrics.fleschKincaidGrade > 12) {
        console.warn(
          `[thompsonLint] Post ${i + 1}: ${hits.length} banned phrase(s), FK grade ${metrics.fleschKincaidGrade}`,
          hits.map((h) => `"${h.phrase}" (${h.category})`).join(", "),
        );
      }
      if (density.wordCount > 200 && density.analogyCount === 0) {
        console.warn(`[thompsonLint] Post ${i + 1}: No analogies detected in ${density.wordCount} words (density score: ${density.score}/100)`);
      }
      return { postIndex: i, hits, metrics, density };
    });

    // Auto-fix: replace banned phrases with their Thompson-approved alternatives
    for (const { postIndex, hits } of thompsonLintResults) {
      for (const hit of hits) {
        // Case-insensitive replacement preserving surrounding context
        const regex = new RegExp(hit.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        linkedInPosts[postIndex] = linkedInPosts[postIndex].replace(regex, hit.replacement);
      }
    }

    const totalThompsonHits = thompsonLintResults.reduce((sum, r) => sum + r.hits.length, 0);
    if (totalThompsonHits > 0) {
      console.log(`[thompsonLint] Auto-fixed ${totalThompsonHits} banned phrase(s) across ${linkedInPosts.length} posts`);
    }

    const totalContent = linkedInPosts.join("\n\n---\n\n");
    // Thompson readability summary across all posts
    const avgFk = thompsonLintResults.length > 0
      ? Math.round(thompsonLintResults.reduce((sum, r) => sum + r.metrics.fleschKincaidGrade, 0) / thompsonLintResults.length * 10) / 10
      : 0;
    const totalAnalogies = thompsonLintResults.reduce((sum, r) => sum + r.density.analogyCount, 0);
    const avgAnalogyScore = thompsonLintResults.length > 0
      ? Math.round(thompsonLintResults.reduce((sum, r) => sum + r.density.score, 0) / thompsonLintResults.length)
      : 0;
    console.log(`[dailyLinkedInPost] Formatted ${linkedInPosts.length} posts (${totalContent.length} chars, avg FK ${avgFk}, ${totalAnalogies} analogies, density score ${avgAnalogyScore}/100)`);
    await appendTraceEntry({
      seq: traceSeq++,
      choiceType: "execute_output",
      toolName: "formatPosts",
      description: `Formatted ${linkedInPosts.length}-post thread (${totalContent.length} chars, ${signalMatches.length} \u0394 badges, ${findingMatches.length} evidence links, ${totalThompsonHits} Thompson fixes, FK avg ${avgFk}, ${totalAnalogies} analogies, density ${avgAnalogyScore}/100)`,
      metadata: {
        charCount: totalContent.length,
        rowCount: linkedInPosts.length,
        wordCount: totalThompsonHits, // Thompson fixes count (repurposed field)
        durationMs: Date.now() - traceStart,
        success: true,
      },
    });

    // Step 3: Post to LinkedIn (unless dry run)
    if (dryRun) {
      for (let i = 0; i < linkedInPosts.length; i++) {
        console.log(`[dailyLinkedInPost] DRY RUN - Post ${i + 1}/${linkedInPosts.length} (${linkedInPosts[i].length} chars):\n${linkedInPosts[i]}`);
      }
      return {
        success: true,
        posted: false,
        dryRun: true,
        content: totalContent,
        postCount: linkedInPosts.length,
        factCheckCount: digestResult.factCheckCount,
        didYouKnow: didYouKnow.didYouKnowMetadata ?? null,
      };
    }

    // Dedup check (skip if any daily_digest already archived today)
    if (!forcePost) {
      const match = await ctx.runQuery(
        internal.workflows.dailyLinkedInPostMutations.findArchiveMatchForDatePersonaType,
        {
          dateString: digestResult.digest.dateString,
          persona,
          postType: "daily_digest",
          content: linkedInPosts[0],
        },
      );
      if (match.anyForType) {
        console.warn(
          `[dailyLinkedInPost] Skipping post (already archived today), persona=${persona}, date=${digestResult.digest.dateString}`,
        );
        return {
          success: true,
          posted: false,
          skipped: true,
          reason: match.exactMatchId ? "duplicate_content" : "already_posted_today",
          content: totalContent,
          factCheckCount: digestResult.factCheckCount,
          didYouKnow: didYouKnow.didYouKnowMetadata ?? null,
        };
      }
    }

    // Post each part with 30s delay between posts (LinkedIn rate limit)
    const postUrls: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < linkedInPosts.length; i++) {
      if (i > 0) {
        console.log(`[dailyLinkedInPost] Waiting 30s before posting part ${i + 1}...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }

      try {
        const postResult = await ctx.runAction(
          internal.domains.social.linkedinPosting.createTargetedTextPost,
          {
            text: linkedInPosts[i],
            target: "organization" as const,
            postType: "daily_digest",
            persona,
            dateString: digestResult.digest.dateString,
          }
        );

        if (postResult.success) {
          postUrls.push(postResult.postUrl || "");
          console.log(`[dailyLinkedInPost] Posted part ${i + 1}/${linkedInPosts.length}: ${postResult.postUrl}`);

          // Archive each part
          await ctx.runMutation(internal.workflows.dailyLinkedInPostMutations.logLinkedInPost, {
            dateString: digestResult.digest.dateString,
            persona,
            postId: postResult.postUrn,
            postUrl: postResult.postUrl,
            content: linkedInPosts[i],
            factCheckCount: i === 0 ? digestResult.factCheckCount : 0,
            postType: "daily_digest",
            metadata: {
              part: i + 1,
              totalParts: linkedInPosts.length,
              ...(i === 0 && didYouKnow.didYouKnowMetadata ? { didYouKnow: didYouKnow.didYouKnowMetadata } : {}),
            },
            target: "organization",
          });
        } else {
          errors.push(`Part ${i + 1}: ${postResult.error || "Unknown error"}`);
          console.error(`[dailyLinkedInPost] Failed to post part ${i + 1}:`, postResult.error);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        errors.push(`Part ${i + 1}: ${errorMsg}`);
        console.error(`[dailyLinkedInPost] Exception posting part ${i + 1}:`, errorMsg);
      }
    }

    console.log(`[dailyLinkedInPost] Posted ${postUrls.length}/${linkedInPosts.length} parts`);

    // TRACE finalize
    await appendTraceEntry({
      seq: traceSeq++,
      choiceType: "finalize",
      toolName: "linkedInPostComplete",
      description: `LinkedIn ${persona} post complete: ${postUrls.length}/${linkedInPosts.length} parts posted, ${forecastCards.length} forecast cards, ${signalMatches.length} \u0394 badges`,
      metadata: {
        rowCount: postUrls.length,
        durationMs: Date.now() - traceStart,
        success: postUrls.length > 0,
        originalRequest: `Daily LinkedIn ${persona} post for ${traceDate}`,
        deliverySummary: `${postUrls.length} posts published, ${forecastCards.length} forecasts, ${signalMatches.length} signal matches`,
      },
    });

    return {
      success: postUrls.length > 0,
      posted: postUrls.length > 0,
      postCount: postUrls.length,
      totalParts: linkedInPosts.length,
      postUrls,
      errors: errors.length > 0 ? errors : undefined,
      content: totalContent,
      factCheckCount: digestResult.factCheckCount,
      didYouKnow: didYouKnow.didYouKnowMetadata ?? null,
      usage: digestResult.usage,
      executionId, // TRACE execution ID for audit
    };
  },
});

/**
 * Post a standalone "Did you know" update to LinkedIn.
 * Intended for ad-hoc experiments or when digest/feed has no items.
 */
export const postDidYouKnowToLinkedIn = internalAction({
  args: {
    persona: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    forcePost: v.optional(v.boolean()),
    dateString: v.optional(v.string()), // YYYY-MM-DD (UTC)
    urls: v.array(v.string()),
    tonePreset: v.optional(
      v.union(v.literal("homer_bot_clone"), v.literal("casual_concise"), v.literal("professional"))
    ),
  },
  handler: async (ctx, args) => {
    const persona = args.persona || "GENERAL";
    const dryRun = args.dryRun ?? false;
    const forcePost = args.forcePost ?? false;
    const dateString = typeof args.dateString === "string" && args.dateString.trim().length > 0
      ? args.dateString.trim()
      : new Date().toISOString().split("T")[0];

    const urls = (Array.isArray(args.urls) ? args.urls : [])
      .filter((u) => typeof u === "string")
      .map((u) => u.trim())
      .filter(Boolean)
      .slice(0, 3);

    if (urls.length === 0) {
      return { success: false, posted: false, error: "No urls provided" };
    }

    const workflowId = `linkedin_dyk_${dateString}_${persona}_adhoc_${Date.now()}`;
    const didYouKnowRun = await ctx.runAction(
      internal.domains.narrative.didYouKnow.generateAndJudgeDidYouKnowFromUrls,
      {
        workflowId,
        urls,
        tonePreset: args.tonePreset ?? "homer_bot_clone",
        preferLinkup: true,
      }
    );

    if (!didYouKnowRun.judge?.passed) {
      return {
        success: false,
        posted: false,
        error: "DidYouKnow judge failed",
        didYouKnow: {
          workflowId,
          artifactId: String(didYouKnowRun.didYouKnowArtifactId),
          modelUsed: didYouKnowRun.modelUsed,
          output: didYouKnowRun.output,
          judge: didYouKnowRun.judge,
        },
      };
    }

    const content = truncateForLinkedIn(
      sanitizeForLinkedIn(String(didYouKnowRun.output.messageText || "")),
      2900
    );

    const didYouKnowMetadata = {
      passed: true,
      checks: didYouKnowRun.judge.checks,
      llmJudge: didYouKnowRun.judge.llmJudge,
      artifactId: String(didYouKnowRun.didYouKnowArtifactId),
      modelUsed: didYouKnowRun.modelUsed,
      sourcesUsed: didYouKnowRun.output.sourcesUsed,
      judgeExplanation: didYouKnowRun.judge.explanation,
      judgeReasons: didYouKnowRun.judge.reasons,
      tonePreset: args.tonePreset ?? "homer_bot_clone",
      workflowId,
    };

    if (dryRun) {
      return {
        success: true,
        posted: false,
        dryRun: true,
        content,
        didYouKnow: didYouKnowMetadata,
      };
    }

    if (!forcePost) {
      const match = await ctx.runQuery(
        internal.workflows.dailyLinkedInPostMutations.findArchiveMatchForDatePersonaType,
        { dateString, persona, postType: "did_you_know", content }
      );
      if (match.anyForType) {
        return {
          success: true,
          posted: false,
          skipped: true,
          reason: match.exactMatchId ? "duplicate_content" : "already_posted_today",
          content,
          didYouKnow: didYouKnowMetadata,
        };
      }
    }

    const postResult = await ctx.runAction(
      internal.domains.social.linkedinPosting.createTargetedTextPost,
      {
        text: content,
        target: "organization" as const,
        postType: "did_you_know",
        persona,
        dateString,
      }
    );
    if (!postResult.success) {
      return { success: false, posted: false, error: postResult.error || "LinkedIn post failed", content };
    }

    await ctx.runMutation(internal.workflows.dailyLinkedInPostMutations.logLinkedInPost, {
      dateString,
      persona,
      postId: postResult.postUrn,
      postUrl: postResult.postUrl,
      content,
      factCheckCount: 0,
      postType: "did_you_know",
      metadata: { didYouKnow: didYouKnowMetadata },
      target: "organization",
    });

    return {
      success: true,
      posted: true,
      postId: postResult.postUrn,
      postUrl: postResult.postUrl,
      content,
      didYouKnow: didYouKnowMetadata,
    };
  },
});

// NOTE: logLinkedInPost mutation moved to dailyLinkedInPostMutations.ts
// (mutations cannot be in "use node" files)

/**
 * Test the LinkedIn posting workflow without actually posting
 */
export const testLinkedInWorkflow = internalAction({
  args: {
    persona: v.optional(v.string()),
    model: v.optional(v.string()),
    didYouKnowUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(internal.workflows.dailyLinkedInPost.postDailyDigestToLinkedIn, {
      persona: args.persona,
      model: args.model,
      dryRun: true,
      didYouKnowUrls: args.didYouKnowUrls,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SEPARATE FUNDING POST - Posted at different time than main digest
// ═══════════════════════════════════════════════════════════════════════════

type LinkedInFundingRound = NonNullable<AgentDigestOutput["fundingRounds"]>[number] & {
  sourceUrls?: string[];
  sourceNames?: string[];
  sourceCount?: number;
  verificationStatus?: string;
  fundingEventId?: string;
  companyId?: Id<"entityContexts">;
  description?: string;
  location?: string;
  valuation?: string;
};

function isGenericFundingCompanyName(companyName: string | undefined | null): boolean {
  if (!companyName) return true;
  const normalized = companyName.trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === "unknown" ||
    normalized === "company" ||
    normalized.startsWith("unknown company") ||
    /^unknown\s*\(/i.test(normalized)
  );
}

function normalizeFundingCompanyName(companyName: string | undefined | null): string | null {
  if (isGenericFundingCompanyName(companyName)) return null;
  return String(companyName).trim().replace(/\s+/g, " ");
}

function sanitizeFundingRoundsForLinkedIn(
  fundingRounds: LinkedInFundingRound[]
): LinkedInFundingRound[] {
  const sanitized: LinkedInFundingRound[] = [];
  for (const round of fundingRounds) {
    const normalizedCompanyName = normalizeFundingCompanyName(round.companyName);
    if (!normalizedCompanyName) continue;
    sanitized.push({
      ...round,
      rank: sanitized.length + 1,
      companyName: normalizedCompanyName,
    });
  }
  return sanitized;
}

function formatFundingUsdCompact(amountUsd: number): string {
  if (amountUsd >= 1_000_000_000) return `$${(amountUsd / 1_000_000_000).toFixed(1)}B`;
  if (amountUsd >= 1_000_000) return `$${(amountUsd / 1_000_000).toFixed(1)}M`;
  if (amountUsd >= 1_000) return `$${(amountUsd / 1_000).toFixed(1)}K`;
  return `$${Math.round(amountUsd).toLocaleString()}`;
}

function normalizeRoundTypeForDisplay(roundType: string | undefined | null): {
  phrase: string;
  label: string;
} {
  const normalized = typeof roundType === "string" ? roundType.trim().toLowerCase() : "";
  if (!normalized || normalized === "unknown") {
    return { phrase: "an undisclosed round", label: "Undisclosed" };
  }
  const pretty = normalized.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const article = /^[aeiou]/i.test(pretty) ? "an" : "a";
  return { phrase: `${article} ${pretty} round`, label: pretty };
}

function truncateFundingDetail(text: string | undefined | null, max = 90): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function inferAudience(round: LinkedInFundingRound): string {
  const sector = (round.sector || "").toLowerCase();
  if (/(ai|ml|chip|semiconductor|compute|infrastructure)/i.test(sector)) {
    return "CTOs, AI product teams, infra buyers, and deep-tech investors";
  }
  if (/(fintech|payments|bank|insur)/i.test(sector)) {
    return "CFOs, fintech operators, bank innovation teams, and growth investors";
  }
  if (/(health|bio|med|pharma|clinical)/i.test(sector)) {
    return "healthcare operators, payers, medtech builders, and specialist funds";
  }
  return "operators in adjacent markets, enterprise buyers, and venture investors";
}

function inferOpportunity(round: LinkedInFundingRound): string {
  const amount = round.amountUsd || 0;
  const stage = (round.roundType || "").toLowerCase();
  const lead = round.leadInvestors?.[0];
  const leadSuffix = lead ? ` with ${lead} at the table` : "";

  if (amount >= 500_000_000) {
    return `Category consolidation and faster enterprise go-to-market${leadSuffix}.`;
  }
  if (stage === "seed" || stage === "pre-seed" || stage === "series-a") {
    return `Early partnership and design-win window before category pricing resets${leadSuffix}.`;
  }
  return `Execution runway to expand product footprint and channel distribution${leadSuffix}.`;
}

function inferRisk(round: LinkedInFundingRound): string {
  const stage = (round.roundType || "").toLowerCase();
  const verification = (round.verificationStatus || "unverified").toLowerCase();

  if (verification === "single-source" || verification === "unverified") {
    return `Source reliability risk: ${verification}; confirm secondary coverage before committing.`;
  }
  if (!stage || stage === "unknown") {
    return "Disclosure risk: terms are not fully public, so valuation and dilution are harder to benchmark.";
  }
  return "Execution risk: hiring and GTM expansion can outpace unit economics if demand lags.";
}

/**
 * Format funding rounds for a dedicated LinkedIn post.
 *
 * Engagement gate requirements:
 * - Lead with a hook, NOT a report header
 * - Include opinion/take and a question
 * - Stay under 1500 characters
 * - Use content-specific hashtags
 */
function formatFundingForLinkedIn(
  fundingRounds: LinkedInFundingRound[],
  _dateString: string
): string {
  const maxLength = 1450;
  const parts: string[] = [];
  const topRounds = sanitizeFundingRoundsForLinkedIn(fundingRounds).slice(0, 3);
  const totalRaised = topRounds.reduce((sum, f) => sum + (f.amountUsd || 0), 0);

  const sourceCitationUrls = [...new Set(topRounds
    .flatMap((round) => {
      const urls: string[] = [];
      if (typeof round.sourceUrl === "string" && round.sourceUrl.trim()) urls.push(round.sourceUrl.trim());
      if (Array.isArray(round.sourceUrls)) {
        for (const url of round.sourceUrls) {
          if (typeof url === "string" && url.trim()) urls.push(url.trim());
        }
      }
      return urls;
    })
    .filter((url) => /^https?:\/\//i.test(url)))];

  const investorCounts = new Map<string, number>();
  for (const round of topRounds) {
    for (const investor of round.leadInvestors || []) {
      const name = investor.trim();
      if (!name) continue;
      investorCounts.set(name, (investorCounts.get(name) || 0) + 1);
    }
  }

  const repeatInvestor = [...investorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .find((entry) => entry[1] >= 2)?.[0];

  const topSectors = [...new Set(topRounds
    .map((round) => (round.sector || "").trim())
    .filter(Boolean))]
    .slice(0, 2);

  const sectorTags = topSectors
    .map((sector) => `#${sector.replace(/[^a-zA-Z0-9]/g, "")}`)
    .filter((tag) => tag.length >= 4 && tag.length <= 30);

  // 1. Hook: lead with the biggest raise + Thompson analogy for funding stage
  const biggest = topRounds[0];
  if (biggest) {
    const roundDisplay = normalizeRoundTypeForDisplay(biggest.roundType);
    const biggestAmount = biggest.amountRaw || (biggest.amountUsd ? formatFundingUsdCompact(biggest.amountUsd) : "an undisclosed amount");
    const totalLabel = totalRaised > 0 ? formatFundingUsdCompact(totalRaised) : "significant capital";
    parts.push(`${biggest.companyName} just raised ${biggestAmount} in ${roundDisplay.phrase}, and today's top ${topRounds.length} raises add up to ${totalLabel}.`);

    // Thompson Protocol: analogy for the funding stage to make it accessible
    const roundType = (biggest.roundType || "").toLowerCase();
    if (roundType.includes("seed")) {
      parts.push(`Think of a Seed round like planting a garden — investors are betting the soil is good before anything has bloomed.`);
    } else if (roundType.includes("series a")) {
      parts.push(`A Series A is like a restaurant getting its first real review — the food is good, now it's time to fill every table.`);
    } else if (roundType.includes("series b")) {
      parts.push(`Series B is the growth spurt — the company proved it works, now it's scaling fast, like a food truck chain opening real locations.`);
    } else if (roundType.includes("series c") || roundType.includes("series d") || roundType.includes("late")) {
      parts.push(`At this stage, the company is like a restaurant chain — the model works everywhere, now it's about dominating the market.`);
    }
  } else {
    parts.push("New startup funding rounds dropped today.");
  }
  parts.push("");

  if (totalRaised > 0) {
    parts.push(`Funding snapshot: ${topRounds.length} notable rounds and ${formatFundingUsdCompact(totalRaised)} in disclosed capital.`);
    parts.push("");
  }

  // 2. Compact list of top raises
  for (const funding of topRounds) {
    const roundDisplay = normalizeRoundTypeForDisplay(funding.roundType);
    const roundLabel = roundDisplay.label;
    const amountLabel = funding.amountRaw || (funding.amountUsd ? formatFundingUsdCompact(funding.amountUsd) : "Undisclosed amount");

    let line = `${funding.rank}. ${funding.companyName} -- ${amountLabel} [${roundLabel}]`;
    if (funding.sector) line += ` -- ${funding.sector}`;
    parts.push(line);

    if (funding.leadInvestors && funding.leadInvestors.length > 0) {
      parts.push(`   Lead investors: ${funding.leadInvestors.slice(0, 2).join(", ")}`);
    }

    const traceSourceCount = typeof funding.sourceCount === "number"
      ? funding.sourceCount
      : Array.isArray(funding.sourceUrls)
        ? funding.sourceUrls.length
        : funding.sourceUrl
          ? 1
          : 0;
    const traceVerification = typeof funding.verificationStatus === "string" && funding.verificationStatus.trim()
      ? funding.verificationStatus
      : "unverified";
    const traceConfidence = Number.isFinite(funding.confidence) ? `${Math.round(funding.confidence * 100)}%` : "n/a";
    const traceEvent = typeof funding.fundingEventId === "string" ? funding.fundingEventId.slice(0, 8) : undefined;
    const tracePieces = [
      `Trace: ${traceVerification}`,
      `${traceSourceCount} sources`,
      `confidence ${traceConfidence}`,
      traceEvent ? `event ${traceEvent}` : undefined,
    ].filter(Boolean) as string[];
    parts.push(`   ${tracePieces.join(" | ")}`);
  }
  parts.push("");

  const deepDiveRounds = topRounds.slice(0, 2);
  if (deepDiveRounds.length > 0) {
    parts.push("Deeper breakdown:");
    for (const round of deepDiveRounds) {
      const industry = truncateFundingDetail(round.sector, 24) || "General tech";
      const product =
        truncateFundingDetail(round.productDescription, 70)
        || truncateFundingDetail(round.description, 70);
      const founder = truncateFundingDetail(round.founderBackground, 58);

      parts.push(`${round.rank}) ${round.companyName} | Industry: ${industry}`);
      // Honest output: omit Product/Founder lines entirely if no real data
      // — never print a placeholder string that pretends to be analysis.
      if (product) parts.push(`   Product: ${product}`);
      if (founder) parts.push(`   Founder lens: ${founder}`);
      parts.push(`   Opportunity: ${inferOpportunity(round)}`);
      parts.push(`   Audience: ${inferAudience(round)}`);
      parts.push(`   Risk: ${inferRisk(round)}`);
    }
    parts.push("");
  }

  if (sourceCitationUrls.length > 0) {
    parts.push("Sources:");
    sourceCitationUrls.slice(0, 3).forEach((url, index) => {
      parts.push(`${index + 1}) ${url}`);
    });
    parts.push("");
  }

  // 3. Opinion + question (required by engagement gate)
  if (repeatInvestor) {
    parts.push(`This signals capital concentration around repeat lead investors like ${repeatInvestor}, which usually precedes faster follow-on rounds.`);
  } else if (topSectors.length > 0) {
    parts.push(`This signals investors are still paying up for traction in ${topSectors.join(" and ")} themes.`);
  } else {
    parts.push(`This signals teams with clear GTM traction can still command strong pricing in this market.`);
  }
  parts.push("");
  parts.push(`Which of these rounds do you think sets up the strongest Series B pipeline over the next 12 months?`);
  parts.push("");

  // 4. Content-specific hashtags
  const tags: string[] = [];
  for (const f of topRounds.slice(0, 2)) {
    const tag = f.companyName.replace(/[^a-zA-Z0-9]/g, "");
    if (tag.length >= 3 && tag.length <= 30) tags.push(`#${tag}`);
  }
  tags.push(...sectorTags, "#StartupFunding", "#VentureCapital");
  parts.push([...new Set(tags)].slice(0, 5).join(" "));

  let content = parts.join("\n");
  if (content.length > maxLength) {
    content = content.slice(0, maxLength - 3).trimEnd() + "...";
  }

  return content;
}

/**
 * Post daily funding rounds to LinkedIn.
 * This is a SEPARATE post from the main digest, posted at a different time.
 * Designed to be called from cron at 12:00 PM UTC (after main 6:15 AM digest).
 */
export const postDailyFundingToLinkedIn = internalAction({
  args: {
    hoursBack: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    forcePost: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const hoursBack = args.hoursBack || 24;
    const dryRun = args.dryRun ?? false;
    const forcePost = args.forcePost ?? false;
    const dateString = new Date().toISOString().split("T")[0];

    console.log(`[dailyFundingPost] Starting funding post, hoursBack=${hoursBack}, dryRun=${dryRun}, forcePost=${forcePost}`);

    // 1. Fetch funding rounds
    let fundingRounds: LinkedInFundingRound[] = [];
    try {
      const fundingData = await ctx.runQuery(
        internal.domains.enrichment.fundingQueries.getFundingDigestSections,
        { lookbackHours: hoursBack }
      );

      const allFunding = [
        ...fundingData.seed,
        ...fundingData.seriesA,
        ...fundingData.other,
      ];

      // Sort by amount (largest first) and assign ranks
      const sortedFunding = allFunding
        .filter((f: any) => f.amountUsd && f.amountUsd > 0)
        .sort((a: any, b: any) => (b.amountUsd || 0) - (a.amountUsd || 0));

      fundingRounds = sortedFunding.slice(0, 10).map((f: any, index: number) => ({
        rank: index + 1,
        companyName: f.companyName,
        roundType: f.roundType,
        amountRaw: f.amountRaw,
        amountUsd: f.amountUsd,
        leadInvestors: f.leadInvestors || [],
        sector: f.sector,
        // productDescription falls back to the funding event's `description`
        // field. founderBackground will be hydrated from entityContexts below
        // (best-effort) — never fabricate placeholder prose if both are missing.
        productDescription: typeof f.description === "string" && f.description.trim()
          ? f.description
          : undefined,
        founderBackground: undefined,
        sourceUrl: Array.isArray(f.sourceUrls) ? f.sourceUrls[0] : undefined,
        sourceUrls: Array.isArray(f.sourceUrls) ? f.sourceUrls.slice(0, 5) : [],
        sourceNames: Array.isArray(f.sourceNames) ? f.sourceNames.slice(0, 5) : [],
        sourceCount: typeof f.sourceCount === "number"
          ? f.sourceCount
          : Array.isArray(f.sourceUrls)
            ? f.sourceUrls.length
            : 0,
        verificationStatus: typeof f.verificationStatus === "string" ? f.verificationStatus : undefined,
        fundingEventId: typeof f.eventId === "string" ? f.eventId : undefined,
        companyId: f.companyId,
        description: typeof f.description === "string" ? f.description : undefined,
        location: typeof f.location === "string" ? f.location : undefined,
        valuation: typeof f.valuation === "string" ? f.valuation : undefined,
        announcedAt: typeof f.announcedAt === "number" ? f.announcedAt : Date.now(),
        confidence: f.confidence || 0.5,
      }));

      // Best-effort founder/product enrichment from linked entity contexts.
      // Skips silently if the entity isn't enriched — the formatter omits
      // the founder line entirely rather than printing a placeholder.
      const roundsNeedingEntity = fundingRounds.filter(
        (r) => r.companyId && (!r.founderBackground || !r.productDescription),
      );
      if (roundsNeedingEntity.length > 0) {
        try {
          const enrichment = await ctx.runQuery(
            internal.domains.enrichment.fundingQueries.getEntityFundingDetails,
            { companyIds: roundsNeedingEntity.map((r) => r.companyId!) },
          );
          for (const round of fundingRounds) {
            const detail = enrichment.find((e: any) => e.companyId === round.companyId);
            if (!detail) continue;
            if (!round.productDescription && detail.productDescription) {
              round.productDescription = detail.productDescription;
            }
            if (!round.founderBackground && detail.founderBackground) {
              round.founderBackground = detail.founderBackground;
            }
          }
        } catch (e) {
          console.warn(
            "[dailyFundingPost] Entity enrichment failed (non-fatal):",
            e instanceof Error ? e.message : String(e),
          );
        }
      }

      console.log(`[dailyFundingPost] Found ${fundingRounds.length} funding rounds`);
    } catch (e) {
      console.warn("[dailyFundingPost] Failed to fetch funding rounds:", e instanceof Error ? e.message : String(e));
    }

    // 2. Remove generic/placeholder company names before formatting or posting
    const rawFundingCount = fundingRounds.length;
    fundingRounds = sanitizeFundingRoundsForLinkedIn(fundingRounds);
    const filteredUnknownCompanyCount = rawFundingCount - fundingRounds.length;
    if (filteredUnknownCompanyCount > 0) {
      console.warn(
        `[dailyFundingPost] Filtered ${filteredUnknownCompanyCount} funding rows with unresolved company names before posting`
      );
    }

    // 3. Check if we have funding to post
    if (fundingRounds.length === 0) {
      console.log("[dailyFundingPost] No funding rounds to post today");
      return {
        success: true,
        posted: false,
        reason: "No funding rounds with resolved company names",
        fundingCount: 0,
        filteredUnknownCompanyCount,
      };
    }

    // 4. Format for LinkedIn
    const linkedInContent = formatFundingForLinkedIn(fundingRounds, dateString);
    console.log(`[dailyFundingPost] LinkedIn content formatted (${linkedInContent.length} chars)`);

    // 5. Post to LinkedIn (unless dry run)
    if (dryRun) {
      console.log(`[dailyFundingPost] DRY RUN - would post:\n${linkedInContent}`);
      return {
        success: true,
        posted: false,
        dryRun: true,
        content: linkedInContent,
        fundingCount: fundingRounds.length,
        filteredUnknownCompanyCount,
      };
    }

    if (!forcePost) {
      const match = await ctx.runQuery(
        internal.workflows.dailyLinkedInPostMutations.findArchiveMatchForDatePersonaType,
        {
          dateString,
          persona: "FUNDING",
          postType: "funding_tracker",
          content: linkedInContent,
        },
      );
      if (match.anyForType) {
        console.warn(`[dailyFundingPost] Skipping post (already archived today), date=${dateString}`);
        return {
          success: true,
          posted: false,
          skipped: true,
          reason: match.exactMatchId ? "duplicate_content" : "already_posted_today",
          content: linkedInContent,
          fundingCount: fundingRounds.length,
          filteredUnknownCompanyCount,
        };
      }
    }

    let postResult;
    try {
      postResult = await ctx.runAction(
        internal.domains.social.linkedinPosting.createTargetedTextPost,
        {
          text: linkedInContent,
          target: "organization" as const,
          postType: "funding_tracker",
          persona: "FUNDING",
          dateString,
        }
      );
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error(`[dailyFundingPost] Failed to post to LinkedIn: ${errorMsg}`);
      return {
        success: false,
        error: `LinkedIn post failed: ${errorMsg}`,
        posted: false,
        content: linkedInContent,
        filteredUnknownCompanyCount,
      };
    }

    if (!postResult.success) {
      console.error(`[dailyFundingPost] LinkedIn post failed: ${postResult.error}`);
      return {
        success: false,
        error: postResult.error,
        posted: false,
        content: linkedInContent,
        filteredUnknownCompanyCount,
      };
    }

    console.log(`[dailyFundingPost] Successfully posted funding to LinkedIn, postUrl=${postResult.postUrl}`);

    // Archive the post
    const today = new Date().toISOString().split("T")[0];
    await ctx.runMutation(internal.workflows.dailyLinkedInPostMutations.logLinkedInPost, {
      dateString: today,
      persona: "FUNDING",
      postId: postResult.postUrn,
      postUrl: postResult.postUrl,
      content: linkedInContent,
      factCheckCount: 0,
      postType: "funding_tracker",
      target: "organization",
    });

    return {
      success: true,
      posted: true,
      postId: postResult.postUrn,
      postUrl: postResult.postUrl,
      content: linkedInContent,
      fundingCount: fundingRounds.length,
      filteredUnknownCompanyCount,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-PERSONA POSTING - Different posts for different audiences
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Persona configurations for different LinkedIn audiences.
 * Each persona gets tailored content focus and hashtags.
 */
const LINKEDIN_PERSONAS = {
  // For investors, VCs, and startup ecosystem
  VC_INVESTOR: {
    id: "VC_INVESTOR",
    name: "VC/Investor Focus",
    description: "Funding-focused content for venture capital and investor audience",
    hashtags: "#VentureCapital #Startups #FundingNews #AngelInvesting #SeriesA #SeedFunding",
    focusSections: ["fundingRounds", "entitySpotlight", "actionItems"],
    formatPrefix: "VC Daily Brief",
  },
  // For technical audience (CTOs, engineers, developers)
  TECH_BUILDER: {
    id: "TECH_BUILDER",
    name: "Tech Builder Focus",
    description: "Technical deep-dives for CTOs, engineers, and developers",
    hashtags: "#TechNews #AI #MachineLearning #DevOps #Engineering #OpenSource",
    focusSections: ["signals", "leadStory", "actionItems"],
    formatPrefix: "Tech Daily Brief",
  },
  // General audience (founders, executives, general business)
  GENERAL: {
    id: "GENERAL",
    name: "General Business",
    description: "Balanced content for founders, executives, and business professionals",
    hashtags: "#AI #TechNews #DailyBrief #FactCheck #NodeBenchAI",
    focusSections: ["leadStory", "signals", "actionItems", "entitySpotlight"],
    formatPrefix: "Daily Brief",
  },
} as const;

type PersonaId = keyof typeof LINKEDIN_PERSONAS;

/**
 * Format digest content tailored to a specific persona as a multi-post thread.
 * Returns string[] (2-3 posts), each under 1450 chars.
 *
 * Post structure per persona:
 * - Post 1: What's happening (persona-specific lens on key developments)
 * - Post 2: What it means (verification, context, signal vs noise)
 * - Post 3: Practical guide (specific actions, skills, resources)
 *
 * Content approach: researched, reasoned, guide-like. No motivational language.
 */
function formatDigestForPersona(
  digest: AgentDigestOutput,
  personaId: PersonaId,
  _options: { maxLength?: number; minLength?: number } = {}
): string[] {
  const maxPerPost = 1450;
  const signals = digest.signals ?? [];
  const entities = digest.entitySpotlight ?? [];
  const findings = digest.factCheckFindings ?? [];
  const actions = digest.actionItems ?? [];
  const totalPosts = (findings.length > 0 || actions.length > 0) ? 3 : 2;

  function personaTags(): string {
    const tags: string[] = [];
    for (const e of entities.slice(0, 2)) {
      const tag = e.name.replace(/[^a-zA-Z0-9]/g, "");
      if (tag.length >= 3 && tag.length <= 30) tags.push(`#${tag}`);
    }
    if (personaId === "VC_INVESTOR") {
      tags.push("#VentureCapital", "#StartupFunding");
    } else if (personaId === "TECH_BUILDER") {
      tags.push("#Engineering", "#OpenSource");
    } else {
      tags.push(...buildContentSpecificHashtags(digest).split(" ").filter(Boolean));
    }
    return [...new Set(tags)].slice(0, 5).join(" ");
  }

  const tags = personaTags();
  const domain = extractDomain(digest.leadStory?.title || signals[0]?.title || "tech");
  const explanations = (digest.competingExplanations ?? []) as LinkedInCompetingExplanation[];
  const framing = digest.narrativeFraming;

  function capPost(text: string): string {
    if (text.length <= maxPerPost) return text;
    return text.slice(0, maxPerPost - 3).trimEnd() + "...";
  }

  // ── Post 1: WHAT'S HAPPENING (persona-specific lens) ──
  const p1: string[] = [];

  if (personaId === "VC_INVESTOR") {
    const hook = digest.leadStory?.whyItMatters || digest.narrativeThesis || signals[0]?.summary
      || `Key deal flow and capital movement in ${domain} today.`;
    p1.push(truncateAtSentenceBoundary(hook, 220));
    p1.push("");
    for (let i = 0; i < Math.min(signals.length, 4); i++) {
      let line = `${i + 1}. ${signals[i].title}`;
      if (signals[i].hardNumbers) line += ` -- ${signals[i].hardNumbers}`;
      p1.push(truncateAtSentenceBoundary(line, 200));
      if (signals[i].summary && i < 2) p1.push(`   ${truncateAtSentenceBoundary(signals[i].summary!, 140)}`);
      if (signals[i].url && i < 2) p1.push(`   ${signals[i].url}`);
    }
    if (signals.length > 0) p1.push("");
    for (const entity of entities.slice(0, 2)) {
      const stage = entity.fundingStage ? ` [${entity.fundingStage}]` : "";
      p1.push(`${entity.name}${stage}: ${truncateAtSentenceBoundary(entity.keyInsight, 120)}`);
    }
    if (entities.length > 0) p1.push("");
    if (explanations.length >= 2) {
      p1.push(`There are ${explanations.length} ways to read the dominant deal flow narrative:`);
      for (const e of explanations.slice(0, 3)) {
        p1.push(`- ${truncateAtSentenceBoundary(e.explanation, 150)}`);
      }
      p1.push("");
      p1.push(`Each explanation leads to a different portfolio strategy.`);
    } else {
      p1.push(`Watch how these ${domain} signals connect -- the pattern across deals matters more than any single round.`);
    }
    p1.push("");
    p1.push("Which of these are you tracking for your portfolio?");
    p1.push("");
    p1.push(`[1/${totalPosts}] ${tags}`);
  } else if (personaId === "TECH_BUILDER") {
    const hook = digest.leadStory?.whyItMatters || digest.narrativeThesis || signals[0]?.summary
      || `Technical developments in ${domain} worth evaluating today.`;
    p1.push(truncateAtSentenceBoundary(hook, 220));
    p1.push("");
    for (let i = 0; i < Math.min(signals.length, 4); i++) {
      let line = `${i + 1}. ${signals[i].title}`;
      if (signals[i].hardNumbers) line += ` -- ${signals[i].hardNumbers}`;
      p1.push(truncateAtSentenceBoundary(line, 200));
      if (signals[i].summary && i < 2) p1.push(`   ${truncateAtSentenceBoundary(signals[i].summary!, 140)}`);
      if (signals[i].url && i < 2) p1.push(`   ${signals[i].url}`);
    }
    if (signals.length > 0) p1.push("");
    for (const entity of entities.slice(0, 2)) {
      p1.push(`${entity.name}: ${truncateAtSentenceBoundary(entity.keyInsight, 120)}`);
    }
    if (entities.length > 0) p1.push("");
    if (explanations.length >= 2) {
      p1.push(`There are ${explanations.length} ways to read where the stack is heading:`);
      for (const e of explanations.slice(0, 3)) {
        p1.push(`- ${truncateAtSentenceBoundary(e.explanation, 150)}`);
      }
      p1.push("");
      p1.push(`Each points to different architectural bets worth evaluating.`);
    } else {
      p1.push(`Watch how these ${domain} releases and shifts connect -- they point to where the stack is heading.`);
    }
    p1.push("");
    p1.push("Which of these have you evaluated?");
    p1.push("");
    p1.push(`[1/${totalPosts}] ${tags}`);
  } else {
    // GENERAL
    const hook = digest.leadStory?.whyItMatters || digest.narrativeThesis || signals[0]?.summary
      || `Key developments in ${domain} today that aren't getting enough attention.`;
    p1.push(truncateAtSentenceBoundary(hook, 220));
    p1.push("");
    for (let i = 0; i < Math.min(signals.length, 4); i++) {
      let line = `${i + 1}. ${signals[i].title}`;
      if (signals[i].hardNumbers) line += ` -- ${signals[i].hardNumbers}`;
      p1.push(truncateAtSentenceBoundary(line, 200));
      if (signals[i].summary && i < 2) p1.push(`   ${truncateAtSentenceBoundary(signals[i].summary!, 140)}`);
      if (signals[i].url && i < 2) p1.push(`   ${signals[i].url}`);
    }
    if (signals.length > 0) p1.push("");
    for (const entity of entities.slice(0, 2)) {
      const stage = entity.fundingStage ? ` [${entity.fundingStage}]` : "";
      p1.push(`${entity.name}${stage}: ${truncateAtSentenceBoundary(entity.keyInsight, 120)}`);
    }
    if (entities.length > 0) p1.push("");
    if (explanations.length >= 2) {
      p1.push(`When I fact-checked these, ${explanations.length} different takes emerged:`);
      for (const e of explanations.slice(0, 3)) {
        p1.push(`- ${truncateAtSentenceBoundary(e.explanation, 160)}`);
      }
      p1.push("");
      p1.push(`Each one leads to a different set of decisions.`);
    } else {
      p1.push(`These ${domain} developments connect in ways the headlines don't surface.`);
    }
    p1.push("");
    p1.push("Which of these are you tracking?");
    p1.push("");
    p1.push(`[1/${totalPosts}] ${tags}`);
  }

  // ── Post 2: WHAT IT MEANS (verification, context, signal vs noise) ──
  const p2: string[] = [];

  if (personaId === "VC_INVESTOR") {
    p2.push(`Verification and context on today's ${domain} deal flow:`);
  } else if (personaId === "TECH_BUILDER") {
    p2.push(`Verification and context on today's ${domain} technical developments:`);
  } else {
    p2.push(`Verification and context on today's ${domain} developments:`);
  }
  p2.push("");

  if (findings.length > 0) {
    for (const finding of findings.slice(0, 4)) {
      const badge = finding.status === "verified" ? "VERIFIED"
        : finding.status === "false" ? "FALSE"
        : finding.status === "partially_verified" ? "PARTIAL" : "UNVERIFIED";
      p2.push(`[${badge}] ${truncateAtSentenceBoundary(finding.claim, 150)}`);
      if (finding.explanation) p2.push(`  ${truncateAtSentenceBoundary(finding.explanation, 140)}`);
      const srcParts: string[] = [];
      if (finding.source) srcParts.push(`Source: ${finding.source}`);
      if (finding.sourceUrl) srcParts.push(finding.sourceUrl);
      if (srcParts.length > 0) p2.push(`  ${srcParts.join(" | ")}`);
      p2.push("");
    }
  } else {
    for (let i = 0; i < Math.min(signals.length, 3); i++) {
      const s = signals[i];
      if (s.summary) {
        p2.push(`${s.title}`);
        p2.push(`  ${truncateAtSentenceBoundary(s.summary, 180)}`);
        if (s.url) p2.push(`  ${s.url}`);
        p2.push("");
      }
    }
  }

  // Evidence breakdown from competing explanations (Phase 7)
  if (explanations.length > 0) {
    p2.push(`How the evidence stacks up:`);
    for (const e of explanations.slice(0, 3)) {
      p2.push(renderEvidenceLine(e));
    }
    p2.push("");
  }

  p2.push(`I built a system that fact-checks and scores evidence automatically. Above is what it found today.`);
  p2.push("");
  p2.push("What's one claim you've seen this week that you'd want fact-checked?");
  p2.push("");
  p2.push(`[2/${totalPosts}] ${tags}`);

  // ── Post 3: PRACTICAL GUIDE (specific actions, skills, resources) ──
  const p3: string[] = [];

  if (personaId === "VC_INVESTOR") {
    p3.push(`Based on today's research -- a practical guide for investors:`);
  } else if (personaId === "TECH_BUILDER") {
    p3.push(`Based on today's research -- a practical guide for builders:`);
  } else {
    p3.push(`Based on today's research -- here's a practical guide on what to focus on:`);
  }
  p3.push("");

  if (actions.length > 0) {
    for (let i = 0; i < Math.min(actions.length, 4); i++) {
      p3.push(`${i + 1}. ${truncateAtSentenceBoundary(actions[i].action, 180)}`);
    }
    p3.push("");
  }

  const skillSignals = signals.filter(s =>
    /skill|learn|tool|framework|open.?source|developer|build|create|opportunity|hiring|job|course|certif/i.test(
      `${s.title} ${s.summary || ""}`
    )
  ).slice(0, 3);

  if (skillSignals.length > 0) {
    if (personaId === "VC_INVESTOR") {
      p3.push("Sectors and tools worth diligence:");
    } else if (personaId === "TECH_BUILDER") {
      p3.push("Tools and frameworks to evaluate:");
    } else {
      p3.push("Worth learning or exploring:");
    }
    for (const s of skillSignals) {
      p3.push(`- ${truncateAtSentenceBoundary(s.title, 140)}`);
      if (s.summary) p3.push(`  ${truncateAtSentenceBoundary(s.summary, 120)}`);
    }
    p3.push("");
  }

  // Falsification criteria as reader empowerment (Phase 7)
  if (explanations.length >= 2) {
    p3.push(`How to challenge each take:`);
    for (const e of explanations.slice(0, 3)) {
      const badge = e.checksPassing != null && e.checksTotal != null
        ? ` [${e.checksPassing}/${e.checksTotal}]`
        : "";
      p3.push(`- ${truncateAtSentenceBoundary(e.title, 40)}${badge}: ${truncateAtSentenceBoundary(e.falsificationCriteria, 130)}`);
    }
    p3.push("");
  }

  if (personaId === "VC_INVESTOR") {
    p3.push(`This runs daily. If you want a specific deal or sector fact-checked, drop it below.`);
    p3.push("");
    p3.push("What deal are you researching right now?");
  } else if (personaId === "TECH_BUILDER") {
    p3.push(`This runs daily and the fact-checking is open. If you spot something worth verifying, drop it below.`);
    p3.push("");
    p3.push("What are you building or testing this week?");
  } else {
    p3.push(`This runs daily. I'll keep publishing what it finds. If you spot a claim worth checking, drop it below.`);
    p3.push("");
    p3.push("What are you building or investigating this week?");
  }
  p3.push("");
  p3.push(`[3/3] ${tags}`);

  const posts = totalPosts === 3
    ? [capPost(p1.join("\n")), capPost(p2.join("\n")), capPost(p3.join("\n"))]
    : [capPost(p1.join("\n")), capPost(p2.join("\n"))];
  for (let i = 0; i < posts.length; i++) {
    console.log(`[formatDigestForPersona] ${personaId} Post ${i + 1}/${posts.length}: ${posts[i].length} chars`);
  }
  return posts;
}

/**
 * Post daily digest to LinkedIn for multiple personas.
 * Creates separate posts tailored to different audiences.
 *
 * Default personas: GENERAL, VC_INVESTOR, TECH_BUILDER
 * Can be scheduled at different times to avoid spam.
 */
export const postMultiPersonaDigest = internalAction({
  args: {
    personas: v.optional(v.array(v.string())),
    model: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    delayBetweenPostsMs: v.optional(v.number()),
    didYouKnowUrls: v.optional(v.array(v.string())),
    didYouKnowTonePreset: v.optional(
      v.union(v.literal("homer_bot_clone"), v.literal("casual_concise"), v.literal("professional"))
    ),
    forcePost: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const requestedPersonas = (args.personas || ["GENERAL"]) as PersonaId[];
    const model = args.model || "qwen3-coder-free";
    const dryRun = args.dryRun ?? false;
    const delayMs = args.delayBetweenPostsMs || 5000; // 5 second delay between posts
    const forcePost = args.forcePost ?? false;

    console.log(`[multiPersonaDigest] Starting multi-persona posting for: ${requestedPersonas.join(", ")}`);

    const results: Array<{
      persona: string;
      success: boolean;
      postUrl?: string;
      postUrls?: string[];
      postCount?: number;
      totalParts?: number;
      error?: string;
      content?: string;
      didYouKnow?: any;
    }> = [];

    // Generate digest once (reuse for all personas)
    let digestResult;
    try {
      digestResult = await ctx.runAction(
        internal.domains.agents.digestAgent.generateDigestWithFactChecks,
        { persona: "GENERAL", model }
      );
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error(`[multiPersonaDigest] Failed to generate digest: ${errorMsg}`);
      return {
        success: false,
        error: `Digest generation failed: ${errorMsg}`,
        results: [],
      };
    }

    if (!digestResult.success || !digestResult.digest) {
      return {
        success: false,
        error: digestResult.error || "Unknown digest error",
        results: [],
      };
    }

    const dateString = digestResult.digest.dateString;

    // Generate a single didYouKnow preface shared across personas (judge-verified).
    const didYouKnowUrls =
      Array.isArray(args.didYouKnowUrls) && args.didYouKnowUrls.length > 0
        ? args.didYouKnowUrls
            .filter((u) => typeof u === "string")
            .map((u) => u.trim())
            .filter(Boolean)
            .slice(0, 2)
        : collectDidYouKnowUrlsFromDigest(digestResult.digest, 2);
    const didYouKnowWorkflowId = `linkedin_dyk_${digestResult.digest.dateString}_multi_${Date.now()}`;
    const didYouKnowPreface = await maybePrependDidYouKnowToLinkedInContent({
      ctx,
      workflowId: didYouKnowWorkflowId,
      urls: didYouKnowUrls,
      baseContent: "",
      tonePreset: args.didYouKnowTonePreset ?? "casual_concise",
    });
    const didYouKnowText =
      didYouKnowPreface.didYouKnowMetadata ? didYouKnowPreface.content.trim() : "";

    // Post for each persona
    for (let i = 0; i < requestedPersonas.length; i++) {
      const personaId = requestedPersonas[i];

      // Validate persona exists
      if (!LINKEDIN_PERSONAS[personaId]) {
        results.push({
          persona: personaId,
          success: false,
          error: `Unknown persona: ${personaId}`,
        });
        continue;
      }

      // Format content for this persona (multi-post thread)
      const linkedInPosts = formatDigestForPersona(digestResult.digest, personaId);
      // Optionally prepend didYouKnow to the first post
      if (didYouKnowText) {
        linkedInPosts[0] = truncateForLinkedIn(`${didYouKnowText}\n\n${linkedInPosts[0]}`, 1450);
      }

      const totalContent = linkedInPosts.join("\n\n---\n\n");
      console.log(`[multiPersonaDigest] Formatted ${linkedInPosts.length} posts for ${personaId} (total ${totalContent.length} chars)`);

      if (dryRun) {
        for (let p = 0; p < linkedInPosts.length; p++) {
          console.log(`[multiPersonaDigest] DRY RUN - ${personaId} Post ${p + 1}/${linkedInPosts.length} (${linkedInPosts[p].length} chars):\n${linkedInPosts[p]}`);
        }
        results.push({
          persona: personaId,
          success: true,
          content: totalContent,
          postCount: linkedInPosts.length,
          didYouKnow: didYouKnowPreface.didYouKnowMetadata ?? null,
        });
        continue;
      }

      if (!forcePost) {
        const match = await ctx.runQuery(
          internal.workflows.dailyLinkedInPostMutations.findArchiveMatchForDatePersonaType,
          {
            dateString,
            persona: personaId,
            postType: "daily_digest",
            content: linkedInPosts[0],
          },
        );
        if (match.anyForType) {
          console.warn(`[multiPersonaDigest] Skipping post (already archived today), persona=${personaId}, date=${dateString}`);
          results.push({
            persona: personaId,
            success: true,
            content: totalContent,
            didYouKnow: didYouKnowPreface.didYouKnowMetadata ?? null,
          });
          continue;
        }
      }

      // Post each part to LinkedIn with delay between parts
      const personaPostUrls: string[] = [];
      let personaError: string | undefined;

      for (let p = 0; p < linkedInPosts.length; p++) {
        if (p > 0) {
          console.log(`[multiPersonaDigest] Waiting 30s before posting ${personaId} part ${p + 1}...`);
          await new Promise(resolve => setTimeout(resolve, 30000));
        }

        try {
          const postResult = await ctx.runAction(
            internal.domains.social.linkedinPosting.createTargetedTextPost,
            {
              text: linkedInPosts[p],
              target: "organization" as const,
              postType: "daily_digest",
              persona: personaId,
              dateString,
            }
          );

          if (postResult.success) {
            personaPostUrls.push(postResult.postUrl || "");
            console.log(`[multiPersonaDigest] Posted ${personaId} part ${p + 1}/${linkedInPosts.length}: ${postResult.postUrl}`);

            // Archive each part
            await ctx.runMutation(internal.workflows.dailyLinkedInPostMutations.logLinkedInPost, {
              dateString,
              persona: personaId,
              postId: postResult.postUrn,
              postUrl: postResult.postUrl,
              content: linkedInPosts[p],
              factCheckCount: p === 0 ? digestResult.factCheckCount : 0,
              postType: "daily_digest",
              metadata: {
                part: p + 1,
                totalParts: linkedInPosts.length,
                ...(p === 0 && didYouKnowPreface.didYouKnowMetadata ? { didYouKnow: didYouKnowPreface.didYouKnowMetadata } : {}),
              },
              target: "organization",
            });
          } else {
            personaError = postResult.error || "Unknown error";
            console.error(`[multiPersonaDigest] Failed ${personaId} part ${p + 1}:`, personaError);
          }
        } catch (e) {
          personaError = e instanceof Error ? e.message : String(e);
          console.error(`[multiPersonaDigest] Exception ${personaId} part ${p + 1}:`, personaError);
        }
      }

      results.push({
        persona: personaId,
        success: personaPostUrls.length > 0,
        postUrls: personaPostUrls,
        postCount: personaPostUrls.length,
        totalParts: linkedInPosts.length,
        error: personaError,
        content: totalContent,
        didYouKnow: didYouKnowPreface.didYouKnowMetadata ?? null,
      });

      // Delay between personas (except for last one)
      if (i < requestedPersonas.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`[multiPersonaDigest] Completed: ${successCount}/${results.length} posts successful`);

    return {
      success: successCount > 0,
      totalPosts: results.length,
      successCount,
      results,
    };
  },
});

/**
 * Test multi-persona posting without actually posting
 */
export const testMultiPersonaDigest = internalAction({
  args: {
    personas: v.optional(v.array(v.string())),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(internal.workflows.dailyLinkedInPost.postMultiPersonaDigest, {
      personas: args.personas || ["GENERAL", "VC_INVESTOR", "TECH_BUILDER"],
      model: args.model,
      dryRun: true,
    });
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STARTUP FUNDING BRIEF - Detailed company profiles with backgrounds
// Uses LIVE data from fundingEvents + entityContexts tables
// ═══════════════════════════════════════════════════════════════════════════

/**
 * DD (Due Diligence) result for funding profiles
 */
interface DDResult {
  riskScore: number;
  tier: "FAST_VERIFY" | "LIGHT_DD" | "STANDARD_DD" | "FULL_PLAYBOOK";
  wasOverridden: boolean;  // Tier escalated due to risk signals
  escalationTriggers: string[];
  signals: Array<{
    category: string;
    severity: string;
    signal: string;
  }>;
  microBranchResults?: Array<{
    branch: string;
    status: "pass" | "warn" | "fail" | "inconclusive";
    summary: string;
  }>;
}

/**
 * Funding company profile for detailed posts
 */
interface FundingProfile {
  companyName: string;
  roundType: string;
  amount: string;
  amountUsd?: number;  // For DD tier calculation
  announcedDate: string;
  sector: string;
  product: string;
  founders: string;
  foundersBackground: string;
  investors: string[];
  investorBackground: string;
  website: string;
  sourceUrl: string;
  crunchbaseUrl: string;
  newsUrl: string;
  confidence: number;
  verificationStatus: string;
  // Fast verification result (added for LinkedIn badges)
  fastVerify?: FastVerifyResult;
  // Full DD result (risk-aware tier selection)
  ddResult?: DDResult;
  // Progression tracking: indicates company raised previous round
  progression?: {
    previousRound: string;
    previousPostUrl?: string;
    diffSummary?: string; // For semantic dedup updates
  };
  // Full funding timeline from fundingEvents (original source data)
  fundingTimeline?: Array<{
    roundType: string;
    amount: string;
    amountUsd?: number;
    date: string;           // Formatted date string from announcedAt
    sourceUrls: string[];   // Original discovery source URLs
    announcedAt: number;    // Original announcement timestamp
    leadInvestors: string[];
  }>;
}

/**
 * Sanitize text for LinkedIn posting.
 * Removes invisible characters, normalizes Unicode, and keeps only safe chars.
 * CRITICAL: AI-generated content often contains invisible Unicode that breaks LinkedIn!
 * CRITICAL: Parentheses cause LinkedIn to truncate posts - replace with brackets!
 */
function sanitizeForLinkedIn(text: string): string {
  if (!text) return text;
  return text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Control characters
    .replace(/[\u200B-\u200F\u2028-\u202E\uFEFF]/g, '') // Zero-width and direction
    .replace(/[\u00A0\u2007\u202F\u2060]/g, ' ') // Special spaces
    .replace(/[\u2018\u2019\u0060\u00B4\u2032\u2035]/g, "'") // Quote variants
    .replace(/[\u201C\u201D\u00AB\u00BB\u2033\u2036]/g, '"') // Double quote variants
    .replace(/[\u2013\u2014\u2015\u2212]/g, '-') // Dash variants
    .replace(/[\uFF08\u0028\(]/g, '[') // ALL parentheses to brackets - LinkedIn truncates at ()!
    .replace(/[\uFF09\u0029\)]/g, ']')
    .replace(/[\u2026]/g, '...') // Ellipsis
    .replace(/[^\x20-\x7E\n\u00C0-\u024F\u1E00-\u1EFF\[\]]/g, '') // Keep only safe chars + brackets
    .replace(/ +/g, ' ') // Collapse spaces
    .trim();
}

function truncateForLinkedIn(text: string, maxChars = 2900): string {
  const raw = (text || "").trim();
  if (raw.length <= maxChars) return raw;
  return raw.slice(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
}

function truncateAtSentenceBoundary(text: string, maxChars: number): string {
  const raw = (text || "").trim();
  if (raw.length <= maxChars) return raw;

  const head = raw.slice(0, maxChars);
  const lastStop = Math.max(head.lastIndexOf("."), head.lastIndexOf("!"), head.lastIndexOf("?"));
  if (lastStop >= 60) return head.slice(0, lastStop + 1).trimEnd();

  return head.trimEnd() + "...";
}

function collectDidYouKnowUrlsFromDigest(digest: AgentDigestOutput, maxUrls = 2): string[] {
  const candidates: string[] = [];
  if (digest.leadStory?.url) candidates.push(digest.leadStory.url);
  for (const s of digest.signals ?? []) {
    if (s?.url) candidates.push(s.url);
  }
  for (const f of digest.factCheckFindings ?? []) {
    if (f?.sourceUrl) candidates.push(f.sourceUrl);
  }
  const cleaned = candidates
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter((u) => u.length > 0);
  return [...new Set(cleaned)].slice(0, maxUrls);
}

async function maybePrependDidYouKnowToLinkedInContent(args: {
  ctx: any;
  workflowId: string;
  urls: string[];
  baseContent: string;
  tonePreset: "homer_bot_clone" | "casual_concise" | "professional";
}): Promise<{
  content: string;
  didYouKnowMetadata?: any;
}> {
  const urls = args.urls.slice(0, 2);
  if (urls.length === 0) return { content: args.baseContent };

  try {
    const prepared = await args.ctx.runAction(
      internal.domains.narrative.didYouKnowSources.fetchSourcesForDidYouKnow,
      { urls, workflowId: args.workflowId, preferLinkup: true, maxUrls: 2 }
    );

    const didYouKnow = await args.ctx.runAction(internal.domains.narrative.didYouKnow.generateDidYouKnow, {
      workflowId: args.workflowId,
      sources: prepared.map((s: any) => ({
        url: s.url,
        title: s.title,
        publishedAtIso: s.publishedAtIso,
        excerpt: s.excerpt,
      })),
      tonePreset: args.tonePreset,
      maxTokens: 520,
      temperature: 0.5,
    });

    const judge = await args.ctx.runAction(internal.domains.narrative.didYouKnow.judgeDidYouKnow, {
      workflowId: args.workflowId,
      didYouKnowArtifactId: didYouKnow.artifactId,
      output: didYouKnow.output,
    });

    if (!judge.passed) return { content: args.baseContent };

    const preface = truncateAtSentenceBoundary(sanitizeForLinkedIn(didYouKnow.output.messageText), 420).trim();
    if (!preface) return { content: args.baseContent };

    const combined = truncateForLinkedIn(`${preface}\n\n${args.baseContent}`, 1450);
	    return {
	      content: combined,
	      didYouKnowMetadata: {
	        passed: true,
	        checks: judge.checks,
	        llmJudge: judge.llmJudge,
	        artifactId: String(didYouKnow.artifactId),
	        modelUsed: didYouKnow.modelUsed,
	        sourcesUsed: didYouKnow.output.sourcesUsed,
	        judgeExplanation: judge.explanation,
	        judgeReasons: judge.reasons,
	      },
	    };
  } catch (e: any) {
    console.warn("[dailyLinkedInPost] didYouKnow generation failed (non-fatal):", e?.message || e);
    return { content: args.baseContent };
  }
}

function formatDDTierBadge(tier: DDResult["tier"]): string {
  // Enhanced badges: Shorter format with tier-appropriate indicators
  switch (tier) {
    case "FULL_PLAYBOOK":
      return "[DD:FULL]"; // Deep institutional-grade DD
    case "STANDARD_DD":
      return "[DD:STD]"; // Standard due diligence
    case "LIGHT_DD":
      return "[DD:LT]"; // Light touch DD
    case "FAST_VERIFY":
    default:
      return "[DD:FV]"; // Fast verification only
  }
}

/**
 * Format risk score as qualitative label with optional score
 */
function formatRiskLabel(riskScore: number, showNumeric = true): string {
  let label: string;
  if (riskScore >= 75) {
    label = "CRITICAL";
  } else if (riskScore >= 50) {
    label = "HIGH";
  } else if (riskScore >= 25) {
    label = "MEDIUM";
  } else {
    label = "LOW";
  }
  return showNumeric ? `${label} (${riskScore}/100)` : label;
}

/**
 * Format micro-branch result in user-friendly format
 * Converts technical branch names to readable labels
 */
function formatMicroBranchResult(branch: string, status: string): string {
  // Friendly branch name mapping
  const branchLabels: Record<string, string> = {
    identity_registry: "Registry",
    beneficial_ownership: "Ownership",
    website_verification: "Website",
    news_sentiment: "News",
    regulatory_check: "Regulatory",
    patent_search: "Patents",
    team_verification: "Team",
  };

  // Friendly status mapping with indicators
  const statusLabels: Record<string, string> = {
    pass: "OK",
    fail: "FAIL",
    warn: "WARN",
    skip: "N/A",
    error: "ERR",
  };

  const friendlyBranch = branchLabels[branch] || branch.replace(/_/g, " ");
  const friendlyStatus = statusLabels[status] || status;

  return `${friendlyBranch}:${friendlyStatus}`;
}

/**
 * Format source credibility with visual indicator
 */
function formatSourceCredibility(credibility: string | undefined): string {
  switch (credibility) {
    case "high":
      return "[SRC:TRUSTED]";
    case "medium":
      return "[SRC:KNOWN]";
    case "low":
    default:
      return "[SRC:UNVERIFIED]";
  }
}

function shouldShowDDInPost(p: FundingProfile): boolean {
  const dd = p.ddResult;
  if (!dd) return false;
  if (dd.escalationTriggers.length > 0) return true;
  if (dd.tier !== "FAST_VERIFY") return true;
  if ((p.fastVerify?.overallStatus ?? "unverified") !== "verified") return true;
  return dd.riskScore >= 25;
}

function topRiskSignals(dd: DDResult, limit: number): string[] {
  const severityRank: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  return [...dd.signals]
    .sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0))
    .slice(0, limit)
    .map(s => `${s.severity}: ${s.signal}`);
}

/**
 * Format a detailed Startup Funding Brief for LinkedIn.
 * Each company gets a full profile with background info.
 */
/**
 * Format a DETAILED company profile (full info - ~600-800 chars each)
 * Includes founders, backgrounds, investor notes for banker-grade intel
 * Now includes verification badges from fast verification
 */
function formatCompanyDetailed(
  p: FundingProfile,
  index: number
): string {
  const roundLabel = p.roundType.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const lines: string[] = [];

  // Company name with verification badge and progression indicator
  const verifyBadge = p.fastVerify?.badge || "";
  const ddBadge = p.ddResult ? formatDDTierBadge(p.ddResult.tier) : "";
  const progressionBadge = p.progression ? "[FOLLOW-ON]" : "";
  const safeCompanyName = sanitizeForLinkedIn(p.companyName).toUpperCase();
  lines.push(`${index}. ${safeCompanyName} ${verifyBadge} ${ddBadge} ${progressionBadge}`.trim().replace(/\s+/g, " "));
  lines.push(`${roundLabel} - ${p.amount}`);
  lines.push(`Announced: ${p.announcedDate}`);

  // Funding timeline: show COMPLETE funding journey with source citations
  // For later-stage companies (Series B+), show ALL prior rounds from inception
  if (p.fundingTimeline && p.fundingTimeline.length > 0) {
    // Determine if this is a later-stage company (Series B or beyond)
    const laterStageRounds = ["series-b", "series-c", "series-d-plus", "growth", "ipo"];
    const isLaterStage = laterStageRounds.includes(p.roundType.toLowerCase());

    // For Series B+: show ALL rounds (complete journey from inception)
    // For early-stage: show up to 4 rounds (still informative but compact)
    const maxRoundsToShow = isLaterStage ? p.fundingTimeline.length : 4;
    const priorRounds = p.fundingTimeline.slice(0, maxRoundsToShow);

    // Calculate total raised across all rounds for context
    const totalRaised = p.fundingTimeline.reduce((sum, entry) => {
      return sum + (entry.amountUsd || 0);
    }, 0);
    const totalRaisedStr = totalRaised > 0
      ? `$${(totalRaised / 1_000_000).toFixed(1)}M total`
      : "";

    lines.push(`FUNDING JOURNEY:${totalRaisedStr ? ` [${totalRaisedStr}]` : ""}`);

    for (const entry of priorRounds) {
      const roundLabel = entry.roundType.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      // Format: "Jan 2024: Seed [$5M]"
      const roundLine = `  -> ${entry.date}: ${roundLabel} [${entry.amount}]`;
      lines.push(sanitizeForLinkedIn(roundLine));

      // Add source URL if available (first source only to keep compact)
      if (entry.sourceUrls && entry.sourceUrls.length > 0) {
        const sourceUrl = entry.sourceUrls[0];
        // Only show domain for readability
        try {
          const domain = new URL(sourceUrl).hostname.replace("www.", "");
          lines.push(`     Source: ${domain}`);
        } catch {
          // Skip invalid URLs
        }
      }

      // Show lead investor if available
      if (entry.leadInvestors && entry.leadInvestors.length > 0) {
        lines.push(`     Lead: ${sanitizeForLinkedIn(entry.leadInvestors[0])}`);
      }
    }

    // If we truncated, indicate there's more history
    if (p.fundingTimeline.length > maxRoundsToShow) {
      lines.push(`  ... +${p.fundingTimeline.length - maxRoundsToShow} earlier rounds`);
    }

    // Add diff summary if semantic dedup detected changes
    if (p.progression?.diffSummary) {
      lines.push(`Update: ${sanitizeForLinkedIn(p.progression.diffSummary)}`);
    }
  } else if (p.progression) {
    // Fallback: simple progression display if no full timeline
    const prevRoundLabel = p.progression.previousRound.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    lines.push(`PROGRESSION: Previously raised ${prevRoundLabel}`);
    if (p.progression.diffSummary) {
      lines.push(`Update: ${sanitizeForLinkedIn(p.progression.diffSummary)}`);
    }
  }

  // DD signals (risk tier, escalation triggers, micro-branches)
  if (p.ddResult && shouldShowDDInPost(p)) {
    const dd = p.ddResult;
    // Enhanced: Use qualitative risk label instead of raw score
    const riskLabel = formatRiskLabel(dd.riskScore);
    const overrideNote = dd.wasOverridden ? " [RISK_OVERRIDE]" : "";
    const tierLine = `DD: ${dd.tier}${overrideNote} | Risk: ${riskLabel}`;
    lines.push(sanitizeForLinkedIn(tierLine));

    // Enhanced: Prioritize escalation alerts with urgency indicator
    if (dd.escalationTriggers.length > 0) {
      const urgency = dd.riskScore >= 50 ? "URGENT" : "ALERT";
      lines.push(`${urgency}: ${sanitizeForLinkedIn(dd.escalationTriggers.slice(0, 2).join("; "))}`);
    }

    // Risk signals with severity context
    const signals = topRiskSignals(dd, 2);
    if (signals.length > 0) {
      lines.push(`Signals: ${sanitizeForLinkedIn(signals.join("; "))}`);
    }

    // Enhanced: More user-friendly micro-branch display
    if (dd.microBranchResults && dd.microBranchResults.length > 0) {
      const checks = dd.microBranchResults
        .slice(0, 3)
        .map(r => formatMicroBranchResult(r.branch, r.status))
        .join(", ");
      lines.push(`Checks: ${sanitizeForLinkedIn(checks)}`);
    }
  }

  // Sector
  const sector = sanitizeForLinkedIn(p.sector);
  if (sector && sector !== "N/A") {
    lines.push(`Sector: ${sector}`);
  }

  // Product - full description
  const product = sanitizeForLinkedIn(p.product);
  if (product && product !== "N/A") {
    lines.push(`Product: ${product}`);
  }

  // Founders with backgrounds
  const founders = sanitizeForLinkedIn(p.founders);
  if (founders && founders !== "N/A") {
    lines.push(`Founders: ${founders}`);
    const foundersBackground = sanitizeForLinkedIn(p.foundersBackground || "");
    if (foundersBackground && foundersBackground !== "N/A") {
      lines.push(`Background: ${foundersBackground}`);
    }
  }

  // Investors with notes
  if (p.investors.length > 0) {
    const investorList = p.investors.slice(0, 5).map(inv => sanitizeForLinkedIn(inv)).join(", ");
    lines.push(`Investors: ${investorList}`);
    const investorBackground = sanitizeForLinkedIn(p.investorBackground || "");
    if (investorBackground && investorBackground !== "N/A") {
      lines.push(`Investor Notes: ${investorBackground}`);
    }
  }

  // Website
  if (p.website && p.website !== "N/A") {
    lines.push(`Website: ${p.website}`);
  }

  // Website check transparency (avoid false "site down" claims)
  if (p.fastVerify?.details?.websiteUrl) {
    const live = p.fastVerify.websiteLive;
    const status = p.fastVerify.details.websiteStatus;
    const err = p.fastVerify.details.websiteError;
    if (live === false) {
      lines.push(`Website check: unreachable${err ? ` (${sanitizeForLinkedIn(err)})` : ""}`);
    } else if (live === null) {
      lines.push(`Website check: inconclusive${err ? ` (${sanitizeForLinkedIn(err)})` : ""}`);
    } else if (typeof status === "number" && status >= 400) {
      // Many sites return 403/429 to bots but are still live in-browser.
      lines.push(`Website check: responding (HTTP ${status})`);
    }
  }

  // Source URL with credibility indicator
  if (p.sourceUrl) {
    const accessedDate = new Date().toISOString().split("T")[0];
    const credIndicator = p.fastVerify?.sourceCredibility
      ? ` ${formatSourceCredibility(p.fastVerify.sourceCredibility)}`
      : "";
    lines.push(`Source${credIndicator} [${accessedDate}]: ${p.sourceUrl}`);
  }

  // Enhanced: Verification status with confidence and actionable guidance
  if (p.fastVerify) {
    const status = p.fastVerify.overallStatus;
    const confidence = p.confidence;

    if (status === "unverified" || status === "suspicious") {
      const credLabel = formatSourceCredibility(p.fastVerify.sourceCredibility);
      const confNote = confidence && confidence < 0.7 ? ` | Conf: ${(confidence * 100).toFixed(0)}%` : "";
      lines.push(`DD Note: ${credLabel}${confNote} - verify independently`);
    } else if (status === "partial") {
      const confNote = confidence && confidence < 0.85 ? ` | Conf: ${(confidence * 100).toFixed(0)}%` : "";
      lines.push(`DD Note: Partial verification${confNote} - some signals found`);
    } else if (status === "verified" && confidence && confidence >= 0.9) {
      // Only show confidence for high-confidence verified items
      lines.push(`Verified | Conf: ${(confidence * 100).toFixed(0)}%`);
    }
    // For "verified" without high confidence, the badge is sufficient
  }

  return lines.join("\n");
}

/**
 * Format multi-part LinkedIn posts with DETAILED company profiles
 * Returns array of posts, each under 2800 chars (safe margin)
 * With ~700 chars per detailed profile, expect ~3-4 companies per post
 *
 * INCLUDES: Link to full funding brief on the app for additional companies
 */
function formatStartupFundingBriefMultiPart(
  profiles: FundingProfile[],
  dateString: string,
  totalEventsAvailable?: number
): string[] {
  const MAX_POST_LENGTH = 2800; // Safe margin under 3000
  const posts: string[] = [];

  // App URL for full funding brief (uses hash-based navigation)
  const APP_URL = "https://nodebench-ai.vercel.app/#funding";

  // Compute verification summary for header
  const verifyStats = {
    verified: profiles.filter(p => p.fastVerify?.overallStatus === "verified").length,
    partial: profiles.filter(p => p.fastVerify?.overallStatus === "partial").length,
    unverified: profiles.filter(p => !p.fastVerify || p.fastVerify.overallStatus === "unverified" || p.fastVerify.overallStatus === "suspicious").length,
  };

  // DD tier summary
  const ddStats = {
    fullPlaybook: profiles.filter(p => p.ddResult?.tier === "FULL_PLAYBOOK").length,
    standardDD: profiles.filter(p => p.ddResult?.tier === "STANDARD_DD").length,
    lightDD: profiles.filter(p => p.ddResult?.tier === "LIGHT_DD").length,
    fastVerify: profiles.filter(p => !p.ddResult || p.ddResult.tier === "FAST_VERIFY").length,
  };

  // Build concise verification summary line
  const verifyLine = verifyStats.verified > 0 || verifyStats.partial > 0
    ? `DD Summary: ${verifyStats.verified} verified, ${verifyStats.partial} partial, ${verifyStats.unverified} pending`
    : "";

  const header = `STARTUP FUNDING BRIEF\n${dateString} - NodeBench AI`;

  // Show if there are more events than we're displaying
  const moreEventsNote = totalEventsAvailable && totalEventsAvailable > profiles.length
    ? `\n\nSee all ${totalEventsAvailable} funding rounds: ${APP_URL}`
    : `\n\nFull funding brief: ${APP_URL}`;

  const footer = `${moreEventsNote}\n\nNodeBench AI - Startup Intelligence\n#Startups #Funding #VentureCapital #AI #TechNews`;

  // Add verification summary to first post header
  const headerWithSummary = verifyLine
    ? `${header}\n${verifyLine}\n[1/?] Latest Funding Rounds\n`
    : `${header}\n[1/?] Latest Funding Rounds\n`;

  let currentPost = headerWithSummary;
  let partNumber = 1;
  let profileIndex = 1;

  for (const profile of profiles) {
    // Use DETAILED format - full founders, backgrounds, investor notes
    const companySection = formatCompanyDetailed(profile, profileIndex);
    const sectionWithSpacing = "\n\n" + companySection;

    // Check if adding this section would exceed limit
    if (currentPost.length + sectionWithSpacing.length + footer.length > MAX_POST_LENGTH) {
      // Finish current post
      currentPost += footer;
      posts.push(currentPost);

      // Start new post
      partNumber++;
      currentPost = `${header}\n[${partNumber}/?] Continued\n` + "\n" + companySection;
    } else {
      currentPost += sectionWithSpacing;
    }
    profileIndex++;
  }

  // Add final post
  currentPost += footer;
  posts.push(currentPost);

  // Update part numbers now that we know total count
  const totalParts = posts.length;
  for (let i = 0; i < posts.length; i++) {
    posts[i] = posts[i].replace(`[${i + 1}/?]`, `[${i + 1}/${totalParts}]`);
  }

  return posts;
}

/**
 * Original single-post formatter (for reference/fallback)
 */
function formatStartupFundingBrief(
  profiles: FundingProfile[],
  dateString: string
): string {
  // Build content with explicit double newlines for LinkedIn paragraph breaks
  const sections: string[] = [];

  // Header
  sections.push(`STARTUP FUNDING BRIEF\n${dateString} - NodeBench AI\nLatest Funding Rounds`);

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    const roundLabel = p.roundType.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    // Sanitize all AI-enriched content
    const sector = sanitizeForLinkedIn(p.sector);
    const product = sanitizeForLinkedIn(p.product);
    const founders = sanitizeForLinkedIn(p.founders);
    const foundersBackground = sanitizeForLinkedIn(p.foundersBackground || "");
    const investorBackground = sanitizeForLinkedIn(p.investorBackground || "");

    // Build company section
    const companyLines: string[] = [];
    companyLines.push(`${i + 1}. ${p.companyName.toUpperCase()}`);
    companyLines.push(`${roundLabel} - ${p.amount}`);
    companyLines.push(`Announced: ${p.announcedDate}`);

    if (sector && sector !== "N/A") {
      companyLines.push(`Sector: ${sector}`);
    }
    if (product && product !== "N/A") {
      companyLines.push(`Product: ${product}`);
    }
    if (founders && founders !== "N/A") {
      companyLines.push(`Founders: ${founders}`);
      if (foundersBackground && foundersBackground !== "N/A") {
        companyLines.push(`Background: ${foundersBackground}`);
      }
    }
    if (p.investors.length > 0) {
      const investorList = p.investors.slice(0, 5).map(inv => sanitizeForLinkedIn(inv)).join(", ");
      companyLines.push(`Investors: ${investorList}`);
      if (investorBackground && investorBackground !== "N/A") {
        companyLines.push(`Investor Notes: ${investorBackground}`);
      }
    }
    if (p.website && p.website !== "N/A") {
      companyLines.push(`Website: ${p.website}`);
    }
    if (p.sourceUrl) {
      companyLines.push(`Source: ${p.sourceUrl}`);
    }

    sections.push(companyLines.join("\n"));
  }

  // Footer with hashtags on separate line
  sections.push(`NodeBench AI - Startup Intelligence`);
  sections.push(`#Startups #Funding #VentureCapital #AI #TechNews #Founders`);

  // Join sections with double newlines for LinkedIn paragraph breaks
  return sections.join("\n\n");
}

/**
 * Enrich a company profile by fetching source article and extracting details via LLM.
 * CRITICAL: Also extracts the ACTUAL company name from source content to fix "Unknown Company" issues.
 */
async function enrichCompanyProfile(
  ctx: any,
  companyName: string,
  sourceUrl: string,
  existingData: Partial<FundingProfile>
): Promise<Partial<FundingProfile>> {
  // Skip if we already have good data (but still run if company name looks generic)
  const hasGoodData = existingData.founders !== "N/A" && existingData.product !== "N/A";
  const hasGenericName = companyName.toLowerCase().includes("unknown") ||
    companyName.toLowerCase() === "company" ||
    companyName.length < 3;

  if (hasGoodData && !hasGenericName) {
    return existingData;
  }

  console.log(`[enrichCompanyProfile] Enriching ${companyName} from ${sourceUrl} (genericName=${hasGenericName})`);

  try {
    // Fetch the source article content with JS rendering
    let articleContent = "";
    if (sourceUrl) {
      try {
        const fetchResult = await ctx.runAction(
          internal.tools.media.linkupFetch.linkupFetchInternal,
          { url: sourceUrl, renderJs: true }
        );
        // Handle both string and object returns
        if (typeof fetchResult === "string") {
          articleContent = fetchResult;
        } else if (fetchResult && typeof fetchResult === "object") {
          articleContent = (fetchResult as any).content || (fetchResult as any).text || JSON.stringify(fetchResult);
        }
        console.log(`[enrichCompanyProfile] Fetched ${articleContent.length} chars from source`);
      } catch (e) {
        console.warn(`[enrichCompanyProfile] Failed to fetch source: ${e}`);
      }
    }

    // If still no content, construct from what we know + basic description
    if (!articleContent || articleContent.length < 100) {
      // Build a fallback context from the company name and any known info
      articleContent = `Company: ${companyName}. This is a company that recently received funding. Research their products and founders.`;
      console.log(`[enrichCompanyProfile] Using fallback context for ${companyName}`);
    }

    // Use direct OpenRouter API call (free model)
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) {
      console.warn(`[enrichCompanyProfile] No OPENROUTER_API_KEY, skipping enrichment`);
      return existingData;
    }

    // Build the extraction prompt - VC/Banking standard taxonomy
    // CRITICAL: Include companyName extraction to fix "Unknown Company" issues
    const extractionPrompt = `You are a senior associate at a top-tier investment bank preparing a deal memo.
The original company name detected was: "${companyName}" - this may be INCORRECT or generic.

${articleContent.length > 200 ? `SOURCE MATERIAL:\n${articleContent.substring(0, 8000)}\n\n` : ""}

CRITICAL: Extract the ACTUAL company name from the source material. Look for:
- Company name in headlines (e.g., "XYZ Raises $50M")
- Company name mentioned with funding amount
- Website domain name (e.g., if website is xyz.com, company is likely "XYZ")
- Press release "about" sections

Return ONLY valid JSON:

{
  "companyName": "The CORRECT company name - extract from source, not the generic name provided. Must be a real company name, not 'Unknown Company'",
  "product": "Core value proposition and technology stack - be specific (1-2 sentences, use precise technical terms)",
  "sector": "Use STANDARD VC TAXONOMY:
    - AI/ML: Foundation Models, MLOps, AI Infrastructure, Vertical AI, AI Agents, Computer Vision, NLP
    - Enterprise SaaS: DevTools, Security, Data Infrastructure, Collaboration, Analytics, HRTech, LegalTech
    - FinTech: Payments, Lending, InsurTech, WealthTech, Banking Infrastructure, Crypto/Web3
    - HealthTech: Biotech, MedTech, Digital Health, Drug Discovery, Diagnostics, Clinical Trials
    - Consumer: Marketplace, Social, Gaming, E-commerce, EdTech, Creator Economy
    - DeepTech: Robotics, Semiconductors, Quantum, Climate Tech, Space Tech, Defense Tech
    - Infra: Cloud, Storage, Networking, Compute
    Format: 'Category - Subcategory' (e.g., 'AI/ML - Foundation Models', 'FinTech - Payments')",
  "founders": "Name (Title) - Format exactly as: 'John Smith (CEO), Jane Doe (CTO)'",
  "foundersBackground": "Prior exits, notable employers (FAANG, unicorns), education (Stanford/MIT/Harvard). Format: 'Ex-Google DeepMind, Stanford PhD; Ex-Stripe, MIT'",
  "investors": ["Lead investor first, then notable participants - max 5"],
  "investorBackground": "Investor track record: prior portfolio companies, fund thesis, AUM if known",
  "website": "https://company.com format",
  "roundType": "Exact round: pre-seed, seed, series-a, series-b, series-c, series-d, growth, bridge, extension, PIPE"
}

RULES:
- ALWAYS extract the real company name from the source - NEVER return "Unknown Company"
- Use "Unknown" only for genuinely unknown data fields, NOT for company name
- Use your knowledge for publicly available information
- Be precise - bankers verify everything`;

    // Direct OpenRouter API call using free model (MiMo V2 Flash - excellent for research)
    console.log(`[enrichCompanyProfile] Calling OpenRouter API for ${companyName}...`);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nodebench.ai",
        "X-Title": "NodeBench AI Funding Brief",
      },
      body: JSON.stringify({
        model: "qwen/qwen3-coder:free", // Best available free model (Feb 2026)
        messages: [{ role: "user", content: extractionPrompt }],
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[enrichCompanyProfile] OpenRouter error: ${response.status} ${errorText}`);
      return existingData;
    }

    const data = await response.json();
    const resultText = data.choices?.[0]?.message?.content || "";
    console.log(`[enrichCompanyProfile] Got response (${resultText.length} chars): ${resultText.substring(0, 200)}...`);

    // Parse the JSON response - handle various formats
    let cleanText = resultText;
    // Remove thinking tokens if present
    cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>/g, "");
    // Remove markdown code blocks
    cleanText = cleanText.replace(/```json\s*/g, "").replace(/```\s*/g, "");

    console.log(`[enrichCompanyProfile] Cleaned text for parsing: ${cleanText.substring(0, 300)}...`);

    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]);
      console.log(`[enrichCompanyProfile] Extracted data for ${companyName}:`, Object.keys(extracted));

      // CRITICAL: Update company name if we found a better one
      let newCompanyName = existingData.companyName;
      if (extracted.companyName &&
          extracted.companyName !== "Unknown" &&
          extracted.companyName !== "Unknown Company" &&
          extracted.companyName.length > 2) {
        newCompanyName = extracted.companyName;
        console.log(`[enrichCompanyProfile] Corrected company name: "${companyName}" -> "${newCompanyName}"`);
      }

      return {
        ...existingData,
        companyName: newCompanyName,
        product: extracted.product !== "Unknown" ? extracted.product : existingData.product,
        sector: extracted.sector !== "Unknown" ? extracted.sector : existingData.sector,
        founders: extracted.founders !== "Unknown" ? extracted.founders : existingData.founders,
        foundersBackground: extracted.foundersBackground !== "Unknown" ? extracted.foundersBackground : existingData.foundersBackground,
        investors: extracted.investors?.length > 0 ? extracted.investors : existingData.investors,
        investorBackground: extracted.investorBackground !== "Unknown" ? extracted.investorBackground : existingData.investorBackground,
        website: extracted.website !== "Unknown" ? extracted.website : existingData.website,
        roundType: extracted.roundType !== "Unknown" ? extracted.roundType : existingData.roundType,
      };
    }
  } catch (e) {
    console.error(`[enrichCompanyProfile] Enrichment failed for ${companyName}:`, e);
  }

  return existingData;
}

/**
 * Post a detailed Startup Funding Brief to LinkedIn.
 * Pulls LIVE data from fundingEvents + entityContexts tables.
 * Uses AI enrichment to research missing company details.
 *
 * EXPANDED FEATURES:
 * - Deduplication: Skips companies already posted within lookbackDays
 * - Sector filtering: Can focus on specific sectors (healthcare, fintech, etc.)
 * - Progression tracking: Notes when a company raises a new round
 */
export const postStartupFundingBrief = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    hoursBack: v.optional(v.number()),
    maxProfiles: v.optional(v.number()),
    roundTypes: v.optional(v.array(v.string())),
    sectorCategories: v.optional(v.array(v.string())), // Filter by sector
    enableEnrichment: v.optional(v.boolean()),
    skipDeduplication: v.optional(v.boolean()), // Bypass dedup check
    deduplicationDays: v.optional(v.number()), // Lookback window for dedup
    useSemanticDedup: v.optional(v.boolean()), // NEW: Use 2-stage LLM-as-judge dedup
    forcePost: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const hoursBack = args.hoursBack ?? 48;
    const maxProfiles = args.maxProfiles ?? 10; // Increased default from 5 to 10
    const enableEnrichment = args.enableEnrichment ?? true;
    const skipDeduplication = args.skipDeduplication ?? false;
    const forcePost = args.forcePost ?? false;
    // Default: 21 days catches leaked→confirmed gap (SEC Form D = 15 days + announcement delay)
    // Research: https://techcrunch.com/2019/03/28/how-to-delay-your-form-ds/
    const deduplicationDays = args.deduplicationDays ?? 21;
    const useSemanticDedup = args.useSemanticDedup ?? false; // NEW: Default to legacy dedup for now

    // EXPANDED: Include all major round types by default
    const roundTypes = args.roundTypes ?? [
      "pre-seed", "seed", "series-a", "series-b", "series-c", "series-d-plus",
      "growth", "debt", "unknown"
    ];

    // Sector category filter (optional)
    const sectorCategories = args.sectorCategories; // undefined = all sectors
    const dateString = new Date().toISOString().split("T")[0];

    console.log(`[startupFundingBrief] Starting funding brief generation`);
    console.log(`  - hoursBack=${hoursBack}, max=${maxProfiles}, enrich=${enableEnrichment}`);
    console.log(`  - roundTypes=${roundTypes.join(",")}`);
    console.log(`  - sectorCategories=${sectorCategories?.join(",") ?? "all"}`);
    console.log(`  - dedup=${!skipDeduplication}, dedup window=${deduplicationDays} days`);
    console.log(`  - useSemanticDedup=${useSemanticDedup} (2-stage LLM-as-judge)`);
    console.log(`  - forcePost=${forcePost}`);

    // Step 1: Fetch funding events from the database
    let fundingEvents: any[] = [];
    try {
      fundingEvents = await ctx.runQuery(
        internal.domains.enrichment.fundingMutations.getRecentFundingEvents,
        {
          lookbackHours: hoursBack,
          roundTypes: roundTypes as any,
          minConfidence: 0.5,
          limit: maxProfiles * 2,
        }
      );
      console.log(`[startupFundingBrief] Fetched ${fundingEvents.length} funding events from DB`);
    } catch (e) {
      console.error(`[startupFundingBrief] Failed to fetch funding events:`, e);
      fundingEvents = [];
    }

    // Step 1.5: Deduplication check
    // NEW: Support both legacy (time-based) and semantic (LLM-as-judge) dedup
    let previouslyPosted: Record<string, {
      previousPostUrl: string;
      previousRoundType: string;
      previousAmountRaw: string;
      postedAt: number;
    } | null> = {};

    // For semantic dedup, we'll store approved candidates with their embeddings
    let semanticDedupResults: Map<string, {
      verdict: string;
      reasoning?: string;
      confidence?: number;
      priorPostId?: string;
      diffSummary?: string;
      embedding?: number[];
    }> = new Map();

    if (!skipDeduplication && fundingEvents.length > 0) {
      if (useSemanticDedup) {
        // NEW: 2-Stage Semantic Dedup with LLM-as-judge
        console.log(`[startupFundingBrief] Using 2-stage semantic dedup with LLM-as-judge`);
        try {
          const candidates = fundingEvents.map(e => ({
            companyName: e.companyName,
            roundType: e.roundType,
            amountRaw: e.amount || `$${e.amountUsd?.toLocaleString() || "undisclosed"}`,
            sector: e.sector,
            fundingEventId: e._id,
          }));

          const approvedPosts = await ctx.runAction(
            internal.domains.social.postDedupAction.batchCheckDedup,
            {
              candidates,
              lookbackDays: deduplicationDays * 3, // Wider lookback for semantic matching
              maxPosts: maxProfiles,
            }
          );

          // Store results for later use
          for (const post of approvedPosts) {
            semanticDedupResults.set(post.companyName, {
              verdict: post.verdict,
              reasoning: post.reasoning,
              confidence: post.confidence,
              priorPostId: post.priorPostId,
              diffSummary: post.diffSummary,
              embedding: post.embedding,
            });
          }

          console.log(`[startupFundingBrief] Semantic dedup: ${approvedPosts.length}/${fundingEvents.length} approved for posting`);
          console.log(`  - Verdicts: ${approvedPosts.map(p => `${p.companyName}:${p.verdict}`).join(", ")}`);
        } catch (e) {
          console.warn(`[startupFundingBrief] Semantic dedup failed, falling back to legacy:`, e);
          // Fall back to legacy dedup
          previouslyPosted = await ctx.runQuery(
            internal.domains.social.linkedinFundingPosts.batchCheckCompaniesPosted,
            {
              companyNames: fundingEvents.map(e => e.companyName),
              lookbackDays: deduplicationDays,
            }
          );
        }
      } else {
        // Legacy time-based dedup
        try {
          previouslyPosted = await ctx.runQuery(
            internal.domains.social.linkedinFundingPosts.batchCheckCompaniesPosted,
            {
              companyNames: fundingEvents.map(e => e.companyName),
              lookbackDays: deduplicationDays,
            }
          );
          const postedCount = Object.values(previouslyPosted).filter(v => v !== null).length;
          console.log(`[startupFundingBrief] Legacy dedup check: ${postedCount}/${fundingEvents.length} companies already posted`);
        } catch (e) {
          console.warn(`[startupFundingBrief] Dedup check failed, proceeding without:`, e);
        }
      }
    }

    // Step 1.6: Fetch COMPLETE funding history from fundingEvents table (original source data)
    // This gives us REAL funding rounds with original sourceUrls and announcedAt dates
    // NO lookback limits - for Series B/C/D/IPO companies, we want the FULL journey from inception
    let fundingHistories: Record<string, Array<{
      roundType: string;
      amountRaw: string;
      amountUsd?: number;
      announcedAt: number;
      sourceUrls: string[];
      leadInvestors: string[];
      confidence: number;
      verificationStatus: string;
    }>> = {};

    if (fundingEvents.length > 0) {
      try {
        fundingHistories = await ctx.runQuery(
          internal.domains.enrichment.fundingQueries.batchGetFundingHistory,
          {
            companyNames: fundingEvents.map(e => e.companyName),
            fullHistory: true, // Get COMPLETE history - no time limits
          }
        );
        const companiesWithHistory = Object.values(fundingHistories).filter(t => t.length > 1).length;
        const maxRounds = Math.max(...Object.values(fundingHistories).map(t => t.length), 0);
        console.log(`[startupFundingBrief] Fetched funding history: ${companiesWithHistory}/${fundingEvents.length} companies have prior rounds (max: ${maxRounds} rounds)`);
      } catch (e) {
        console.warn(`[startupFundingBrief] Failed to fetch funding history:`, e);
      }
    }

    // Step 2: Enrich with entity context data + AI enrichment
    const fundingProfiles: FundingProfile[] = [];
    const skippedDuplicates: string[] = [];
    const skippedInvalid: string[] = [];
    const progressions: { company: string; previousUrl: string; previousRound: string }[] = [];
    // NEW: Track embeddings and verdicts for recording
    const postMetadata: Map<string, { embedding?: number[]; verdict?: string; diffSummary?: string }> = new Map();

    for (const event of fundingEvents) {
      if (fundingProfiles.length >= maxProfiles) break;

      // DEDUPLICATION CHECK
      if (useSemanticDedup && semanticDedupResults.size > 0) {
        // NEW: Semantic dedup check
        const dedupResult = semanticDedupResults.get(event.companyName);
        if (!dedupResult) {
          // Not in approved list - skip
          console.log(`[startupFundingBrief] Skipping ${event.companyName} - not approved by semantic dedup`);
          skippedDuplicates.push(`${event.companyName} [${event.roundType}] -> semantic:DUPLICATE`);
          continue;
        }

        // Track metadata for recording
        postMetadata.set(event.companyName, {
          embedding: dedupResult.embedding,
          verdict: dedupResult.verdict,
          diffSummary: dedupResult.diffSummary,
        });

        // Check if it's an UPDATE (progression with diff)
        if (dedupResult.verdict === "UPDATE" && dedupResult.priorPostId) {
          console.log(`[startupFundingBrief] Update detected: ${event.companyName} - ${dedupResult.diffSummary}`);
          progressions.push({
            company: event.companyName,
            previousUrl: dedupResult.priorPostId, // Will be resolved to URL later
            previousRound: dedupResult.diffSummary || "updated info",
          });
        }
      } else {
        // Legacy dedup check
        const prevPost = previouslyPosted[event.companyName];
        if (prevPost && !skipDeduplication) {
          // Check if this is the same round (duplicate) or a new round (progression)
          if (prevPost.previousRoundType === event.roundType) {
            console.log(`[startupFundingBrief] Skipping ${event.companyName} - already posted ${event.roundType} on ${new Date(prevPost.postedAt).toLocaleDateString()}`);
            skippedDuplicates.push(`${event.companyName} [${event.roundType}] -> ${prevPost.previousPostUrl}`);
            continue;
          } else {
            // This is a progression (new round since last post)
            console.log(`[startupFundingBrief] Progression: ${event.companyName} from ${prevPost.previousRoundType} to ${event.roundType}`);
            progressions.push({
              company: event.companyName,
              previousUrl: prevPost.previousPostUrl,
              previousRound: prevPost.previousRoundType,
            });
          }
        }
      }

      // Try to get entity context for richer data
      let entityData: any = null;
      if (event.companyId) {
        try {
          entityData = await ctx.runQuery(
            internal.domains.knowledge.entityContexts.getEntityContextById,
            { entityId: event.companyId }
          );
        } catch (e) {
          console.warn(`[startupFundingBrief] Could not fetch entity for ${event.companyName}`);
        }
      }

      const crm = entityData?.crmFields;

      // Check sector filter (if specified)
      const eventSector = crm?.industry || event.sector || "";
      if (sectorCategories && sectorCategories.length > 0) {
        const sectorLower = eventSector.toLowerCase();
        const matchesSector = sectorCategories.some((cat: string) => {
          if (cat === "healthcare" && (sectorLower.includes("health") || sectorLower.includes("bio") || sectorLower.includes("med"))) return true;
          if (cat === "fintech" && (sectorLower.includes("fin") || sectorLower.includes("payment") || sectorLower.includes("bank"))) return true;
          if (cat === "ai_ml" && (sectorLower.includes("ai") || sectorLower.includes("ml") || sectorLower.includes("machine"))) return true;
          if (cat === "enterprise" && (sectorLower.includes("saas") || sectorLower.includes("enterprise") || sectorLower.includes("b2b"))) return true;
          if (cat === "consumer" && (sectorLower.includes("consumer") || sectorLower.includes("commerce") || sectorLower.includes("retail"))) return true;
          if (cat === "deeptech" && (sectorLower.includes("deep") || sectorLower.includes("robot") || sectorLower.includes("quantum"))) return true;
          if (cat === "climate" && (sectorLower.includes("climate") || sectorLower.includes("energy") || sectorLower.includes("clean"))) return true;
          if (cat === "technology") return true; // Match all tech
          return false;
        });
        if (!matchesSector) {
          console.log(`[startupFundingBrief] Skipping ${event.companyName} - sector "${eventSector}" doesn't match ${sectorCategories.join(",")}`);
          continue;
        }
      }

      // Check for progression data (from either semantic or legacy dedup)
      const progressionEntry = progressions.find(p => p.company === event.companyName);
      const progressionData = progressionEntry ? {
        previousRound: progressionEntry.previousRound,
        previousPostUrl: progressionEntry.previousUrl,
        diffSummary: useSemanticDedup ? semanticDedupResults.get(event.companyName)?.diffSummary : undefined,
      } : undefined;

      // Build funding timeline from original fundingEvents data (real source URLs)
      const companyHistory = fundingHistories[event.companyName] ?? [];
      // Only show timeline if there are PRIOR rounds (more than 1 entry, excluding current)
      const priorRounds = companyHistory.filter(entry => entry.announcedAt < event.announcedAt);
      const formattedTimeline = priorRounds.length > 0
        ? priorRounds.map(entry => ({
            roundType: entry.roundType,
            amount: entry.amountRaw,
            amountUsd: entry.amountUsd,
            date: new Date(entry.announcedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
            }),
            sourceUrls: entry.sourceUrls,
            announcedAt: entry.announcedAt,
            leadInvestors: entry.leadInvestors,
          }))
        : undefined;

      // Build initial profile
      let profile: FundingProfile = {
        companyName: event.companyName,
        roundType: event.roundType,
        amount: event.amountRaw || (event.amountUsd ? `$${(event.amountUsd / 1_000_000).toFixed(1)}M` : "Undisclosed"),
        amountUsd: event.amountUsd ?? undefined,
        announcedDate: new Date(event.announcedAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        sector: crm?.industry || event.sector || "N/A",
        product: crm?.product || event.description || "N/A",
        founders: crm?.founders?.join(", ") || "N/A",
        foundersBackground: crm?.foundersBackground || "N/A",
        investors: [
          ...event.leadInvestors,
          ...(event.coInvestors || []),
        ].slice(0, 6),
        investorBackground: crm?.investorBackground || "N/A",
        website: crm?.website || "N/A",
        sourceUrl: event.sourceUrls?.[0] || "",
        crunchbaseUrl: `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(event.companyName)}`,
        newsUrl: `https://news.google.com/search?q=${encodeURIComponent(event.companyName + " funding")}`,
        confidence: event.confidence,
        verificationStatus: event.verificationStatus,
        progression: progressionData,
        fundingTimeline: formattedTimeline,
      };

      // Step 3: AI enrichment if needed and enabled
      const nameLooksGeneric = (name: string) => {
        const n = (name || "").trim().toLowerCase();
        return n.length < 3 || n.includes("unknown") || n === "company";
      };
      const needsNameFix = nameLooksGeneric(profile.companyName);
      const needsMissingFields =
        profile.founders === "N/A" || profile.product === "N/A" || profile.sector === "N/A";

      console.log(`[startupFundingBrief] Profile for ${event.companyName}:`, {
        founders: profile.founders,
        product: profile.product,
        sector: profile.sector,
        enableEnrichment,
        needsEnrichment: needsMissingFields || needsNameFix,
      });
      if (enableEnrichment && (needsMissingFields || needsNameFix)) {
        console.log(`[startupFundingBrief] Enriching ${event.companyName} via AI...`);
        const enriched = await enrichCompanyProfile(
          ctx,
          event.companyName,
          event.sourceUrls?.[0] || "",
          profile
        );
        profile = { ...profile, ...enriched } as FundingProfile;
      }

      if (nameLooksGeneric(profile.companyName)) {
        console.warn(`[startupFundingBrief] Skipping profile with invalid companyName: "${profile.companyName}"`);
        skippedInvalid.push(profile.companyName);
        continue;
      }

      fundingProfiles.push(profile);
    }

    console.log(`[startupFundingBrief] Built ${fundingProfiles.length} profiles with enrichment`);

    if (fundingProfiles.length === 0) {
      console.log(`[startupFundingBrief] No funding events found in the last ${hoursBack} hours`);
      return {
        success: true,
        posted: false,
        reason: `No ${roundTypes.join("/")} funding events found in the last ${hoursBack} hours`,
        profileCount: 0,
      };
    }

    // Step 4: Fast verification for each company
    console.log(`[startupFundingBrief] Running fast verification on ${fundingProfiles.length} companies...`);
    try {
      const verifyResults = await ctx.runAction(
        internal.domains.verification.fastVerification.batchFastVerify,
        {
          companies: fundingProfiles.map(p => ({
            companyName: p.companyName,
            websiteUrl: p.website !== "N/A" ? p.website : undefined,
            sourceUrl: p.sourceUrl || undefined,
          })),
          maxConcurrent: 3,
        }
      );

      // Attach verification results to profiles
      for (let i = 0; i < fundingProfiles.length; i++) {
        if (verifyResults[i]) {
          fundingProfiles[i].fastVerify = verifyResults[i];
        }
      }

      const verifiedCount = verifyResults.filter((r: FastVerifyResult) => r.overallStatus === "verified" || r.overallStatus === "partial").length;
      console.log(`[startupFundingBrief] Fast verification complete: ${verifiedCount}/${fundingProfiles.length} verified/partial`);
    } catch (e) {
      console.warn(`[startupFundingBrief] Fast verification failed, continuing without badges:`, e);
    }

    // Step 4.5: Risk-aware DD tier selection + micro-branch signals (bounded)
    console.log(`[startupFundingBrief] Computing DD tiers and risk signals...`);
    try {
      const ddResults = await Promise.all(
        fundingProfiles.map(async (p): Promise<DDResult> => {
          const founderNames =
            p.founders && p.founders !== "N/A"
              ? p.founders
                  .split(",")
                  .map(s => s.trim())
                  .filter(Boolean)
                  .slice(0, 2)
              : undefined;

          const riskInputBase = {
            companyName: p.companyName,
            websiteUrl: p.website && p.website !== "N/A" ? p.website : undefined,
            amountUsd: p.amountUsd,
            roundType: p.roundType,
            sectors: p.sector && p.sector !== "N/A" ? [p.sector] : undefined,
            sourceUrl: p.sourceUrl || undefined,
              fastVerifyResult: p.fastVerify
                ? {
                    entityFound: p.fastVerify.entityFound,
                    websiteLive: p.fastVerify.websiteLive,
                    websiteStatus: p.fastVerify.details.websiteStatus,
                    websiteError: p.fastVerify.details.websiteError,
                    sourceCredibility: p.fastVerify.sourceCredibility,
                  }
                : undefined,
            };

          // Initial risk score (cheap)
          let signals = detectRiskSignals(riskInputBase as any);
          let riskScore = calculateRiskScore(signals);
          let tierSelection = selectDDTierWithRisk(
            p.amountUsd ?? null,
            p.roundType,
            riskScore
          );

          // Run micro-branches only when needed (limit tool/API cost)
          const status = p.fastVerify?.overallStatus;
          const shouldRunMicroBranches =
            tierSelection.tier !== "FAST_VERIFY" ||
            riskScore.overall >= 25 ||
            status === "unverified" ||
            status === "suspicious";

          let microBranchResults: MicroBranchResult[] = [];
          if (shouldRunMicroBranches) {
            const microCalls: Array<Promise<MicroBranchResult>> = [];

            microCalls.push(
              ctx.runAction(internal.domains.agents.dueDiligence.microBranches.runIdentityRegistry, {
                companyName: p.companyName,
              })
            );

            microCalls.push(
              ctx.runAction(internal.domains.agents.dueDiligence.microBranches.runBeneficialOwnership, {
                companyName: p.companyName,
                founderNames,
              })
            );

            microBranchResults = await Promise.all(microCalls);

            // Recompute risk with micro-branch signals
            const registry = microBranchResults.find(r => r.branch === "identity_registry");
            const foundInRegistry = registry?.status === "pass";

            signals = detectRiskSignals({
              ...(riskInputBase as any),
              foundInRegistry,
            });
            riskScore = calculateRiskScore(signals);
            tierSelection = selectDDTierWithRisk(
              p.amountUsd ?? null,
              p.roundType,
              riskScore
            );
          }

          return {
            riskScore: riskScore.overall,
            tier: tierSelection.tier,
            wasOverridden: tierSelection.wasOverridden,
            escalationTriggers: riskScore.escalationTriggers,
            signals: riskScore.signals.map(s => ({
              category: s.category,
              severity: s.severity,
              signal: s.signal,
            })),
            microBranchResults: microBranchResults.length
              ? microBranchResults.map(r => ({
                  branch: r.branch,
                  status: r.status,
                  summary: r.summary,
                }))
              : undefined,
          };
        })
      );

      for (let i = 0; i < fundingProfiles.length; i++) {
        fundingProfiles[i].ddResult = ddResults[i];
      }

      const tierCounts = ddResults.reduce<Record<string, number>>((acc, r) => {
        acc[r.tier] = (acc[r.tier] || 0) + 1;
        return acc;
      }, {});
      console.log(`[startupFundingBrief] DD tiers computed:`, tierCounts);
    } catch (e) {
      console.warn(`[startupFundingBrief] DD tier selection failed, continuing without DD overlay:`, e);
    }

    // Format the LinkedIn posts (multi-part if needed)
    // Pass total events count to show link to app for full list
    const totalEventsAvailable = fundingEvents.length;
    const linkedInPosts = formatStartupFundingBriefMultiPart(fundingProfiles, dateString, totalEventsAvailable);
    const totalContent = linkedInPosts.join("\n\n---\n\n");
    console.log(`[startupFundingBrief] Formatted ${linkedInPosts.length} posts (${linkedInPosts.map(p => p.length).join(", ")} chars each)`);

    if (dryRun) {
      console.log(`[startupFundingBrief] DRY RUN - ${linkedInPosts.length} posts:`);
      linkedInPosts.forEach((p, i) => console.log(`\n--- Post ${i + 1} ---\n${p}`));

      // Build verification summary
      const verificationSummary = {
        total: fundingProfiles.length,
        verified: fundingProfiles.filter(p => p.fastVerify?.overallStatus === "verified").length,
        partial: fundingProfiles.filter(p => p.fastVerify?.overallStatus === "partial").length,
        unverified: fundingProfiles.filter(p => p.fastVerify?.overallStatus === "unverified" || p.fastVerify?.overallStatus === "suspicious").length,
        noVerification: fundingProfiles.filter(p => !p.fastVerify).length,
      };

      return {
        success: true,
        posted: false,
        dryRun: true,
        content: totalContent,
        postCount: linkedInPosts.length,
        profileCount: fundingProfiles.length,
        profiles: fundingProfiles.map(p => ({
          name: p.companyName,
          round: p.roundType,
          amount: p.amount,
          product: p.product,
          founders: p.founders,
          verification: p.fastVerify ? {
            status: p.fastVerify.overallStatus,
            badge: p.fastVerify.badge,
            sourceCredibility: p.fastVerify.sourceCredibility,
            entityFound: p.fastVerify.entityFound,
            websiteLive: p.fastVerify.websiteLive,
          } : undefined,
          dd: p.ddResult ? {
            tier: p.ddResult.tier,
            riskScore: p.ddResult.riskScore,
            escalationTriggers: p.ddResult.escalationTriggers,
          } : undefined,
        })),
        verificationSummary,
      };
    }

    // Post each part to LinkedIn with delay between posts
    const postUrlsByPart: Array<string | null> = new Array(linkedInPosts.length).fill(null);
    const skippedParts: number[] = [];
    const errors: string[] = [];

    for (let i = 0; i < linkedInPosts.length; i++) {
      if (!forcePost) {
        const match = await ctx.runQuery(
          internal.workflows.dailyLinkedInPostMutations.findArchiveMatchForDatePersonaType,
          {
            dateString,
            persona: "FUNDING",
            postType: "funding_brief",
            content: linkedInPosts[i],
            part: i + 1,
          },
        );
        if (match.exactMatchId) {
          console.warn(`[startupFundingBrief] Skipping part ${i + 1} (duplicate archived content)`);
          skippedParts.push(i + 1);
          continue;
        }
      }

      // Add 30 second delay between posts (LinkedIn rate limit)
      if (i > 0) {
        console.log(`[startupFundingBrief] Waiting 30s before posting part ${i + 1}...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }

      try {
        const postResult = await ctx.runAction(
          internal.domains.social.linkedinPosting.createTargetedTextPost,
          {
            text: linkedInPosts[i],
            target: "organization" as const,
            postType: "funding_brief",
            persona: "FUNDING",
            dateString,
          }
        );

        if (postResult.success && postResult.postUrl) {
          postUrlsByPart[i] = postResult.postUrl;
          console.log(`[startupFundingBrief] Posted part ${i + 1}/${linkedInPosts.length}: ${postResult.postUrl}`);
        } else {
          errors.push(`Part ${i + 1}: ${postResult.error || "Unknown error"}`);
          console.error(`[startupFundingBrief] Failed to post part ${i + 1}:`, postResult.error);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        errors.push(`Part ${i + 1}: ${errorMsg}`);
        console.error(`[startupFundingBrief] Exception posting part ${i + 1}:`, errorMsg);
      }
    }

    const postUrls = postUrlsByPart.filter((u): u is string => typeof u === "string" && u.length > 0);
    const allPosted = postUrlsByPart.every((u) => typeof u === "string" && u.length > 0);
    console.log(`[startupFundingBrief] Posted ${postUrls.length}/${linkedInPosts.length} parts (skipped=${skippedParts.length})`);

    // Archive each posted part
    for (let i = 0; i < linkedInPosts.length; i++) {
      const url = postUrlsByPart[i];
      if (url) {
        await ctx.runMutation(internal.workflows.dailyLinkedInPostMutations.logLinkedInPost, {
          dateString,
          persona: "FUNDING",
          postId: url.split("/").pop() || url,
          postUrl: url,
          content: linkedInPosts[i],
          factCheckCount: 0,
          postType: "funding_brief",
          metadata: { part: i + 1, totalParts: linkedInPosts.length },
          target: "organization",
        });
      }
    }

    // Step 5: Record posted companies for deduplication tracking
    if (postUrls.length > 0) {
      try {
        // Prepare the batch record request
        const companiesForRecording = fundingProfiles.map(profile => ({
          companyName: profile.companyName,
          roundType: profile.roundType,
          amountRaw: profile.amount,
          sector: profile.sector,
          postUrn: postUrls[0].split("/").pop() || postUrls[0], // Extract URN from URL
          postUrl: postUrls[0], // Link to first post (they're related)
          postPart: 1,
          totalParts: postUrls.length,
        }));

        // Record the basic post info
        const recordedIds = await ctx.runMutation(
          internal.domains.social.linkedinFundingPosts.batchRecordPostedCompanies,
          { companies: companiesForRecording }
        );
        console.log(`[startupFundingBrief] Recorded ${companiesForRecording.length} companies for deduplication`);

        // NEW: If using semantic dedup, also store embeddings and metadata
        if (useSemanticDedup && postMetadata.size > 0) {
          for (let i = 0; i < fundingProfiles.length; i++) {
            const profile = fundingProfiles[i];
            const metadata = postMetadata.get(profile.companyName);
            if (metadata && recordedIds[i]) {
              try {
                await ctx.runMutation(
                  internal.domains.social.postDedup.updatePostEmbedding,
                  {
                    postId: recordedIds[i],
                    contentSummary: `${profile.companyName} raised ${profile.amount} in ${profile.roundType}`,
                    embedding: metadata.embedding,
                  }
                );
              } catch (embErr) {
                console.warn(`[startupFundingBrief] Failed to store embedding for ${profile.companyName}:`, embErr);
              }
            }
          }
          console.log(`[startupFundingBrief] Stored embeddings for semantic dedup`);
        }
      } catch (e) {
        console.warn(`[startupFundingBrief] Failed to record companies for dedup:`, e);
        // Don't fail the whole operation if recording fails
      }
    }

    return {
      success: allPosted,
      posted: postUrls.length > 0,
      postUrl: postUrls[0], // First post URL
      postUrls: postUrls,
      postCount: linkedInPosts.length,
      postedCount: postUrls.length,
      content: totalContent,
      profileCount: fundingProfiles.length,
      skippedDuplicates: skippedDuplicates.length > 0 ? skippedDuplicates : undefined,
      skippedInvalid: skippedInvalid.length > 0 ? skippedInvalid : undefined,
      skippedParts: skippedParts.length > 0 ? skippedParts : undefined,
      progressions: progressions.length > 0 ? progressions : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  },
});

/**
 * Test the startup funding brief without posting
 */
export const testStartupFundingBrief = internalAction({
  args: {
    hoursBack: v.optional(v.number()),
    maxProfiles: v.optional(v.number()),
    enableEnrichment: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(internal.workflows.dailyLinkedInPost.postStartupFundingBrief, {
      dryRun: true,
      hoursBack: args.hoursBack ?? 720, // Default to 30 days for testing
      maxProfiles: args.maxProfiles ?? 5,
      enableEnrichment: args.enableEnrichment ?? true,
    });
  },
});

/**
 * Backfill funding-tracker archive rows that were generated by the
 * pre-fix pipeline (visible markers: "0 sources", "Product details are
 * limited", "Founder background not captured"). For each broken row:
 *
 *  1. Re-fetch fundingEvents announced inside a 24h window ending at the
 *     row's `postedAt` (matches the original cron's hoursBack=24).
 *  2. Best-effort hydrate productDescription / founderBackground from
 *     entityContexts.crmFields (same path as the live action).
 *  3. Re-format with formatFundingForLinkedIn so the rendered post text
 *     reflects real source counts + omits placeholder lines.
 *  4. Persist a structured `findings` blob alongside the new content so
 *     the website (and future cheap chat retrieval) can pull entities,
 *     amounts, sectors, and source URLs without re-parsing the prose.
 *
 * Idempotent: re-running on an already-backfilled row produces the same
 * content + metadata.findings shape. Set dryRun:true to preview.
 */
export const backfillFundingTrackerPosts = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    onlyBroken: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const onlyBroken = args.onlyBroken ?? true;

    const archive = await ctx.runQuery(
      internal.domains.social.linkedinArchiveQueries.getAllFundingTrackerPostsForBackfill,
      {},
    );

    const isBroken = (content: string): boolean =>
      /\b0 sources\b/.test(content) ||
      content.includes("Product details are limited") ||
      content.includes("Founder background not captured");

    const targets = onlyBroken ? archive.filter((p) => isBroken(p.content)) : archive;

    type Outcome = {
      id: string;
      dateString: string;
      eventCount: number;
      sourceCountTotal: number;
      oldLen: number;
      newLen: number;
      status: "patched" | "would_patch" | "no_events" | "skipped_unchanged";
    };
    const results: Outcome[] = [];

    for (const post of targets) {
      const windowEnd = post.postedAt;
      const windowStart = windowEnd - 24 * 60 * 60 * 1000;

      const events = await ctx.runQuery(
        internal.domains.enrichment.fundingQueries.getFundingEventsInWindow,
        { startMs: windowStart, endMs: windowEnd },
      );

      if (events.length === 0) {
        results.push({
          id: post._id,
          dateString: post.dateString,
          eventCount: 0,
          sourceCountTotal: 0,
          oldLen: post.content.length,
          newLen: 0,
          status: "no_events",
        });
        continue;
      }

      const sortedFunding = [...events]
        .filter((f: any) => f.amountUsd && f.amountUsd > 0)
        .sort((a: any, b: any) => (b.amountUsd || 0) - (a.amountUsd || 0));

      let fundingRounds: LinkedInFundingRound[] = sortedFunding
        .slice(0, 10)
        .map((f: any, index: number) => ({
          rank: index + 1,
          companyName: f.companyName,
          roundType: f.roundType,
          amountRaw: f.amountRaw,
          amountUsd: f.amountUsd,
          leadInvestors: f.leadInvestors || [],
          sector: f.sector,
          productDescription:
            typeof f.description === "string" && f.description.trim() ? f.description : undefined,
          founderBackground: undefined,
          sourceUrl: Array.isArray(f.sourceUrls) ? f.sourceUrls[0] : undefined,
          sourceUrls: Array.isArray(f.sourceUrls) ? f.sourceUrls.slice(0, 5) : [],
          sourceNames: Array.isArray(f.sourceNames) ? f.sourceNames.slice(0, 5) : [],
          sourceCount:
            typeof f.sourceCount === "number"
              ? f.sourceCount
              : Array.isArray(f.sourceUrls)
                ? f.sourceUrls.length
                : 0,
          verificationStatus:
            typeof f.verificationStatus === "string" ? f.verificationStatus : undefined,
          fundingEventId: typeof f.eventId === "string" ? f.eventId : undefined,
          companyId: f.companyId,
          description: typeof f.description === "string" ? f.description : undefined,
          location: typeof f.location === "string" ? f.location : undefined,
          valuation: typeof f.valuation === "string" ? f.valuation : undefined,
          announcedAt: typeof f.announcedAt === "number" ? f.announcedAt : windowEnd,
          confidence: f.confidence || 0.5,
        }));

      // Best-effort entity enrichment (mirrors postDailyFundingToLinkedIn).
      const roundsNeedingEntity = fundingRounds.filter(
        (r) => r.companyId && (!r.founderBackground || !r.productDescription),
      );
      if (roundsNeedingEntity.length > 0) {
        try {
          const enrichment = await ctx.runQuery(
            internal.domains.enrichment.fundingQueries.getEntityFundingDetails,
            { companyIds: roundsNeedingEntity.map((r) => r.companyId!) },
          );
          for (const round of fundingRounds) {
            const detail = enrichment.find((e: any) => e.companyId === round.companyId);
            if (!detail) continue;
            if (!round.productDescription && detail.productDescription) {
              round.productDescription = detail.productDescription;
            }
            if (!round.founderBackground && detail.founderBackground) {
              round.founderBackground = detail.founderBackground;
            }
          }
        } catch (e) {
          console.warn(
            "[backfillFundingTracker] Entity enrichment failed (non-fatal):",
            e instanceof Error ? e.message : String(e),
          );
        }
      }

      fundingRounds = sanitizeFundingRoundsForLinkedIn(fundingRounds);
      if (fundingRounds.length === 0) {
        results.push({
          id: post._id,
          dateString: post.dateString,
          eventCount: events.length,
          sourceCountTotal: 0,
          oldLen: post.content.length,
          newLen: 0,
          status: "no_events",
        });
        continue;
      }

      const newContent = formatFundingForLinkedIn(fundingRounds, post.dateString);
      const sourceCountTotal = fundingRounds.reduce(
        (sum, r) => sum + (r.sourceCount || 0),
        0,
      );

      // Structured findings: cheap retrieval substrate for the website +
      // future chat. Mirrors what the formatter consumes so a chat layer
      // can answer "what got funded today" without re-running an LLM.
      const findings = {
        version: 1,
        backfilledAt: Date.now(),
        backfillSource: "backfillFundingTrackerPosts",
        windowStartMs: windowStart,
        windowEndMs: windowEnd,
        rounds: fundingRounds.map((r) => ({
          rank: r.rank,
          companyName: r.companyName,
          companyId: r.companyId,
          eventId: r.fundingEventId,
          roundType: r.roundType,
          amountRaw: r.amountRaw,
          amountUsd: r.amountUsd,
          leadInvestors: r.leadInvestors,
          sector: r.sector,
          location: r.location,
          valuation: r.valuation,
          verificationStatus: r.verificationStatus,
          confidence: r.confidence,
          sourceCount: r.sourceCount,
          sourceUrls: r.sourceUrls,
          sourceNames: r.sourceNames,
          productDescription: r.productDescription,
          founderBackground: r.founderBackground,
          announcedAt: r.announcedAt,
        })),
      };

      if (newContent === post.content) {
        results.push({
          id: post._id,
          dateString: post.dateString,
          eventCount: events.length,
          sourceCountTotal,
          oldLen: post.content.length,
          newLen: newContent.length,
          status: "skipped_unchanged",
        });
        continue;
      }

      if (!dryRun) {
        await ctx.runMutation(
          internal.domains.social.linkedinArchiveEditsMutations.patchArchiveRowContent,
          {
            archiveRowId: post._id,
            content: newContent,
            metadataPatch: { findings },
          },
        );
        // Refresh the entity-link join table so per-entity queries find
        // this row immediately. Idempotent — diffs against existing links.
        await ctx.runMutation(
          internal.domains.social.linkedinArchiveEntityLinks.upsertArchiveRowEntityLinks,
          { archiveRowId: post._id },
        );
      }

      results.push({
        id: post._id,
        dateString: post.dateString,
        eventCount: events.length,
        sourceCountTotal,
        oldLen: post.content.length,
        newLen: newContent.length,
        status: dryRun ? "would_patch" : "patched",
      });
    }

    const summary = {
      total: archive.length,
      considered: targets.length,
      patched: results.filter((r) => r.status === "patched").length,
      wouldPatch: results.filter((r) => r.status === "would_patch").length,
      noEvents: results.filter((r) => r.status === "no_events").length,
      skippedUnchanged: results.filter((r) => r.status === "skipped_unchanged").length,
      dryRun,
    };

    console.log(
      `[backfillFundingTracker] ${JSON.stringify(summary)}; sample=${JSON.stringify(results.slice(0, 3))}`,
    );

    return { summary, results };
  },
});
