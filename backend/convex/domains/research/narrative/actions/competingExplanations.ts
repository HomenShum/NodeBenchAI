"use node";

/**
 * Agentic Competing Explanations Generator (Phase 7)
 *
 * Fully agentic action that takes digest data (signals, fact-checks, entities)
 * and generates 3 competing explanations with:
 *   - Boolean evidence checklist (DETERMINISTIC — computed from data, not LLM)
 *   - Falsification criteria (what would disprove each — LLM-generated)
 *   - Narrative framing (what's dominating attention vs what matters)
 *
 * Evidence checklist rules (no LLM involvement):
 *   hasPrimarySource:    URL domain is tier-1/2 OR verified fact-check exists
 *   hasCorroboration:    2+ distinct source domains across all signals/fact-checks
 *   hasFalsifiableClaim: LLM returned non-empty falsification criteria (only LLM-derived check)
 *   hasQuantitativeData: Any signal has hardNumbers OR funding round exists
 *   hasNamedAttribution: Named entity exists OR fact-check has named source
 *   isReproducible:      Any signal or fact-check has a followable URL
 *
 * Called by the daily LinkedIn post workflow AFTER digest generation.
 * Returns structured data injected into AgentDigestOutput.competingExplanations.
 *
 * @module domains/narrative/actions/competingExplanations
 */

import { v } from "convex/values";
import { generateText } from "ai";
import { internalAction } from "../../../../_generated/server";
import { executeWithModelFallback } from "../../../agents/mcp_tools/models/modelResolver";
import type { ApprovedModel } from "../../../agents/mcp_tools/models/modelResolver";
import type { EvidenceChecklist } from "../validators";
import {
  deriveEvidenceLevel,
  countPassingChecks,
} from "../validators";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompetingExplanation {
  title: string;
  explanation: string;
  evidenceLevel: "grounded" | "mixed" | "speculative";
  evidenceChecklist: EvidenceChecklist;
  checksPassing: number;
  checksTotal: number;
  measurementApproach: string;
  falsificationCriteria: string;
}

export interface NarrativeFraming {
  dominantStory: string;
  attentionShare: string;
  underReportedAngle: string;
}

export interface CompetingExplanationsResult {
  explanations: CompetingExplanation[];
  framing: NarrativeFraming | null;
}

// ─── Deterministic Evidence Checklist ────────────────────────────────────────

/** Tier-1: Government, regulatory, court filings, official statistics */
const TIER1_DOMAINS = [
  "sec.gov", "federalregister.gov", "fda.gov", "nih.gov", "clinicaltrials.gov",
  "bls.gov", "census.gov", "courts.gov", "uscourts.gov", "congress.gov",
  "whitehouse.gov", "treasury.gov", "justice.gov", "ftc.gov",
  "ecfr.gov", "regulations.gov", "govinfo.gov",
];

/** Tier-2: Major wire services, peer-reviewed research */
const TIER2_DOMAINS = [
  "reuters.com", "apnews.com", "bloomberg.com",
  "nejm.org", "nature.com", "science.org", "thelancet.com", "cell.com",
  "arxiv.org", "pubmed.ncbi.nlm.nih.gov", "jamanetwork.com",
  "wsj.com", "ft.com", "economist.com",
];

function extractDomainFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname || null;
  } catch {
    return null;
  }
}

function isPrimarySourceDomain(domain: string): boolean {
  return TIER1_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
    || TIER2_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

interface ChecklistInput {
  signals: Array<{ title: string; summary?: string; hardNumbers?: string; url?: string; directQuote?: string }>;
  factChecks: Array<{ claim: string; status: string; source?: string; sourceUrl?: string }>;
  entities: Array<{ name: string; keyInsight: string }>;
  hasFundingRounds: boolean;
}

/**
 * Compute evidence checklist deterministically from data.
 * No LLM involvement except hasFalsifiableClaim (set per-explanation later).
 */
function computeBaseChecklist(input: ChecklistInput): Omit<EvidenceChecklist, "hasFalsifiableClaim"> {
  // Collect all URLs from signals + fact-checks
  const allUrls: string[] = [];
  for (const s of input.signals) {
    if (s.url) allUrls.push(s.url);
  }
  for (const f of input.factChecks) {
    if (f.sourceUrl) allUrls.push(f.sourceUrl);
  }

  // Extract unique domains
  const domains = new Set<string>();
  for (const url of allUrls) {
    const d = extractDomainFromUrl(url);
    if (d) domains.add(d);
  }

  // hasPrimarySource: any URL is tier-1/2 OR any fact-check is verified with a named source
  const hasUrlFromPrimarySource = [...domains].some(isPrimarySourceDomain);
  const hasVerifiedFactCheck = input.factChecks.some(
    (f) => f.status === "verified" && f.source && f.source.length > 0
  );
  const hasPrimarySource = hasUrlFromPrimarySource || hasVerifiedFactCheck;

  // hasCorroboration: 2+ distinct source domains
  const hasCorroboration = domains.size >= 2;

  // hasQuantitativeData: any signal has hardNumbers OR funding rounds exist
  const hasHardNumbers = input.signals.some((s) => s.hardNumbers && s.hardNumbers.trim().length > 0);
  const hasQuantitativeData = hasHardNumbers || input.hasFundingRounds;

  // hasNamedAttribution: named entity exists OR fact-check has named source OR signal has directQuote
  const hasNamedEntity = input.entities.length > 0;
  const hasNamedSource = input.factChecks.some((f) => f.source && f.source.length > 3);
  const hasDirectQuote = input.signals.some((s) => s.directQuote && s.directQuote.length > 10);
  const hasNamedAttribution = hasNamedEntity || hasNamedSource || hasDirectQuote;

  // isReproducible: any signal or fact-check has a followable URL
  const isReproducible = allUrls.length > 0;

  return {
    hasPrimarySource,
    hasCorroboration,
    hasQuantitativeData,
    hasNamedAttribution,
    isReproducible,
  };
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildPrompt(input: {
  signals: Array<{ title: string; summary?: string; hardNumbers?: string; url?: string }>;
  factChecks: Array<{ claim: string; status: string; source?: string }>;
  entities: Array<{ name: string; keyInsight: string }>;
  narrativeThesis?: string;
}): string {
  const signalBlock = input.signals
    .slice(0, 6)
    .map((s, i) => {
      let line = `${i + 1}. ${s.title}`;
      if (s.hardNumbers) line += ` (${s.hardNumbers})`;
      if (s.summary) line += `\n   ${s.summary}`;
      if (s.url) line += `\n   Source: ${s.url}`;
      return line;
    })
    .join("\n");

  const factCheckBlock = input.factChecks.length > 0
    ? input.factChecks
        .slice(0, 4)
        .map((f) => `- [${f.status.toUpperCase()}] ${f.claim}${f.source ? ` (${f.source})` : ""}`)
        .join("\n")
    : "No fact-checks available.";

  const entityBlock = input.entities.length > 0
    ? input.entities
        .slice(0, 3)
        .map((e) => `- ${e.name}: ${e.keyInsight}`)
        .join("\n")
    : "";

  return `You are a narrative intelligence analyst. Your job is to identify COMPETING EXPLANATIONS for what's happening in the news right now.

Given today's signals and fact-checks, produce exactly 3 competing explanations. Each explanation is a different way to read the same set of facts. They should genuinely compete -- a reader who believes explanation 1 would draw different conclusions than one who believes explanation 2.

TODAY'S SIGNALS:
${signalBlock}

FACT-CHECK RESULTS:
${factCheckBlock}
${entityBlock ? `\nKEY ENTITIES:\n${entityBlock}` : ""}
${input.narrativeThesis ? `\nNARRATIVE THESIS: ${input.narrativeThesis}` : ""}

IMPORTANT: Do NOT evaluate evidence quality. That is handled separately by a deterministic system. Your job is ONLY to:
1. Generate 3 genuinely competing explanations
2. For each, describe how you would measure if it's correct
3. For each, state what specific evidence would DISPROVE it (falsification criteria)

Also identify the DOMINANT STORY in social media right now (the one getting the most attention) and what's being UNDER-REPORTED.

Respond ONLY with valid JSON:
{
  "explanations": [
    {
      "title": "short name for this explanation (3-6 words)",
      "explanation": "1-2 sentence explanation a LinkedIn reader would understand without jargon.",
      "measurementApproach": "How would you measure whether this explanation is correct? Be specific.",
      "falsificationCriteria": "What specific evidence would disprove this? Write as: 'This weakens if [specific observable condition]'"
    }
  ],
  "framing": {
    "dominantStory": "what topic is dominating social feeds right now (brief description)",
    "attentionShare": "rough percentage like '80%' or '90%'",
    "underReportedAngle": "what's actually important but getting buried (brief, connects to the signals above)"
  }
}`;
}

// ─── Response Parser ────────────────────────────────────────────────────────

interface LLMExplanation {
  title: string;
  explanation: string;
  measurementApproach: string;
  falsificationCriteria: string;
}

function parseResponse(text: string): { explanations: LLMExplanation[]; framing: NarrativeFraming | null } | null {
  try {
    let jsonStr = text;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) jsonStr = fenced[1].trim();
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) jsonStr = objMatch[0];

    const parsed = JSON.parse(jsonStr);

    if (!parsed.explanations || !Array.isArray(parsed.explanations)) return null;

    const explanations: LLMExplanation[] = parsed.explanations
      .slice(0, 3)
      .map((e: any) => ({
        title: String(e.title || "Unnamed explanation").slice(0, 60),
        explanation: String(e.explanation || "").slice(0, 200),
        measurementApproach: String(e.measurementApproach || "").slice(0, 200),
        falsificationCriteria: String(e.falsificationCriteria || "").slice(0, 200),
      }));

    let framing: NarrativeFraming | null = null;
    if (parsed.framing && parsed.framing.dominantStory) {
      framing = {
        dominantStory: String(parsed.framing.dominantStory).slice(0, 100),
        attentionShare: String(parsed.framing.attentionShare || "80%").slice(0, 10),
        underReportedAngle: String(parsed.framing.underReportedAngle || "").slice(0, 200),
      };
    }

    return { explanations, framing };
  } catch (e) {
    console.error("[CompetingExplanations] Failed to parse LLM response:", e);
    return null;
  }
}

// ─── Public Action ───────────────────────────────────────────────────────────

/**
 * Generate competing explanations from digest data.
 *
 * Evidence grading is DETERMINISTIC — computed from actual data (URLs, sources,
 * hard numbers, entities), not from LLM self-assessment. The LLM only generates
 * explanations, measurement approaches, and falsification criteria.
 *
 * The only LLM-derived boolean is hasFalsifiableClaim: true if the LLM returned
 * non-empty falsification criteria for that explanation.
 */
export const generateCompetingExplanations = internalAction({
  args: {
    signals: v.array(v.object({
      title: v.string(),
      summary: v.optional(v.string()),
      hardNumbers: v.optional(v.string()),
      url: v.optional(v.string()),
      directQuote: v.optional(v.string()),
    })),
    factChecks: v.array(v.object({
      claim: v.string(),
      status: v.string(),
      source: v.optional(v.string()),
      sourceUrl: v.optional(v.string()),
    })),
    entities: v.array(v.object({
      name: v.string(),
      keyInsight: v.string(),
    })),
    hasFundingRounds: v.optional(v.boolean()),
    narrativeThesis: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  returns: v.object({
    explanations: v.array(v.object({
      title: v.string(),
      explanation: v.string(),
      evidenceLevel: v.union(v.literal("grounded"), v.literal("mixed"), v.literal("speculative")),
      evidenceChecklist: v.object({
        hasPrimarySource: v.boolean(),
        hasCorroboration: v.boolean(),
        hasFalsifiableClaim: v.boolean(),
        hasQuantitativeData: v.boolean(),
        hasNamedAttribution: v.boolean(),
        isReproducible: v.boolean(),
      }),
      checksPassing: v.number(),
      checksTotal: v.number(),
      measurementApproach: v.string(),
      falsificationCriteria: v.string(),
    })),
    framing: v.union(
      v.object({
        dominantStory: v.string(),
        attentionShare: v.string(),
        underReportedAngle: v.string(),
      }),
      v.null(),
    ),
    baseChecklistLog: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    const modelId = args.model || "qwen3-coder-free";

    if (args.signals.length === 0) {
      console.log("[CompetingExplanations] No signals provided, skipping");
      return { explanations: [], framing: null, error: "No signals" };
    }

    // Step 1: Compute base evidence checklist DETERMINISTICALLY from data
    const base = computeBaseChecklist({
      signals: args.signals,
      factChecks: args.factChecks,
      entities: args.entities,
      hasFundingRounds: args.hasFundingRounds ?? false,
    });

    const baseLog = [
      `hasPrimarySource=${base.hasPrimarySource}`,
      `hasCorroboration=${base.hasCorroboration}`,
      `hasQuantitativeData=${base.hasQuantitativeData}`,
      `hasNamedAttribution=${base.hasNamedAttribution}`,
      `isReproducible=${base.isReproducible}`,
    ].join(", ");
    console.log(`[CompetingExplanations] Base checklist (from data): ${baseLog}`);
    console.log(`[CompetingExplanations] Generating from ${args.signals.length} signals, ${args.factChecks.length} fact-checks, startModel=${modelId}`);

    // Step 2: LLM generates explanations + falsification (NOT evidence grades)
    const prompt = buildPrompt({
      signals: args.signals,
      factChecks: args.factChecks,
      entities: args.entities,
      narrativeThesis: args.narrativeThesis,
    });

    try {
      const { result: text, modelUsed, isFree, fallbacksUsed } = await executeWithModelFallback(
        async (model) => {
          const r = await generateText({ model, prompt, temperature: 0.3 });
          return r.text;
        },
        {
          startModel: modelId as ApprovedModel,
          onFallback: (from, to, err) => {
            console.warn(`[CompetingExplanations] Model ${from} failed (${err.message}), falling back to ${to}`);
          },
        }
      );

      console.log(`[CompetingExplanations] LLM responded (model=${modelUsed}, free=${isFree}, fallbacks=${fallbacksUsed})`);

      const parsed = parseResponse(text);
      if (!parsed || parsed.explanations.length === 0) {
        console.warn("[CompetingExplanations] LLM returned no valid explanations");
        return { explanations: [], framing: null, error: "Parse failure" };
      }

      // Step 3: Merge deterministic base checklist with per-explanation hasFalsifiableClaim
      const explanations: CompetingExplanation[] = parsed.explanations.map((llm) => {
        const hasFalsifiableClaim = llm.falsificationCriteria.length > 10
          && !llm.falsificationCriteria.toLowerCase().includes("no falsification");

        const checklist: EvidenceChecklist = {
          ...base,
          hasFalsifiableClaim,
        };

        return {
          title: llm.title,
          explanation: llm.explanation,
          evidenceLevel: deriveEvidenceLevel(checklist),
          evidenceChecklist: checklist,
          checksPassing: countPassingChecks(checklist),
          checksTotal: 6,
          measurementApproach: llm.measurementApproach,
          falsificationCriteria: llm.falsificationCriteria || "No falsification criteria defined",
        };
      });

      // Log evidence grades with per-check detail
      for (const e of explanations) {
        const checks = Object.entries(e.evidenceChecklist)
          .map(([k, v]) => `${v ? "✓" : "✗"} ${k}`)
          .join(", ");
        console.log(`[CompetingExplanations] "${e.title}" -> ${e.evidenceLevel} (${e.checksPassing}/${e.checksTotal}): ${checks}`);
      }

      return {
        explanations,
        framing: parsed.framing,
        baseChecklistLog: baseLog,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[CompetingExplanations] All models failed:", msg);
      return { explanations: [], framing: null, error: msg };
    }
  },
});
