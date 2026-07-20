/**
 * Publisher Agent - Narrative Publication with Citations
 *
 * The fourth and final agent in the Newsroom pipeline. Responsible for:
 * 1. Creating new narrative threads from proposals
 * 2. Adding events to existing threads
 * 3. Generating stable citation IDs for all sources
 * 4. Updating thread metrics and phases
 * 5. Persisting all changes to the database
 *
 * Uses Nate B. Jones style: clear attribution, evolving narratives.
 *
 * @module domains/narrative/newsroom/agents/publisherAgent
 */

import { generateText } from "ai";
import type { ActionCtx } from "../../../../../_generated/server";
import { internal } from "../../../../../_generated/api";
import type { Id } from "../../../../../_generated/dataModel";
import { getLanguageModelSafe } from "../../../../agents/mcp_tools/models";
import {
  fnv1a32Hex,
  makeWebSourceCitationId,
} from "../../../../../../shared/citations/webSourceCitations";
import type {
  NewsroomState,
  NarrativeShift,
  GeneratedNarrative,
  GeneratedEvent,
  NewsItem,
  CitationMetadata,
} from "../state";
import { getWeekNumber } from "../state";
import type { HypothesisCandidate } from "../../validators";

/**
 * Configuration for Publisher Agent
 */
export interface PublisherConfig {
  /** Model to use for summary generation */
  model?: string;
  /** Generate AI summaries for events */
  generateSummaries?: boolean;
  /** Auto-verify high-confidence events */
  autoVerifyThreshold?: number;
  /** Deterministic mode: disables non-deterministic decisions/timestamps where possible. */
  deterministicMode?: boolean;
  /**
   * Record/replay mode for external tools (LLM calls).
   * - live: call tools normally
   * - record: call tools and persist immutable recordings keyed by workflowId
   * - replay: use persisted recordings, no external calls
   */
  toolReplayMode?: "live" | "record" | "replay";
  /** Recording set identifier; defaults to `state.workflowId` when not provided. */
  toolReplayId?: string;
}

const DEFAULT_CONFIG: Required<PublisherConfig> = {
  model: "qwen3-coder-free",
  generateSummaries: true,
  autoVerifyThreshold: 0.85,
  deterministicMode: false,
  toolReplayMode: "live",
  toolReplayId: "",
};

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v) => {
    if (!v || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[Circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = obj[k];
    return out;
  });
}

async function upsertSourceArtifactsForNews(
  ctx: ActionCtx,
  sources: NewsItem[],
  opts: {
    fetchedAtFallbackMs: number;
    deterministicMode: boolean;
    workflowId?: string;
    agentName: string;
  }
): Promise<Map<string, Id<"sourceArtifacts">>> {
  const out = new Map<string, Id<"sourceArtifacts">>();
  for (const s of sources) {
    if (!s.url) continue;
    if (out.has(s.url)) continue;

    const citationId = makeWebSourceCitationId(s.url);
    const publishedAtMs = parsePublishedAtToMs(s.publishedAt) ?? undefined;
    const fetchedAt = opts.deterministicMode
      ? (publishedAtMs ?? opts.fetchedAtFallbackMs)
      : Date.now();

    const contentHash = await sha256Hex(
      JSON.stringify({
        version: 1,
        citationId,
        url: s.url,
        headline: s.headline,
        snippet: s.snippet,
        publishedAtMs,
      })
    );

    const upserted = await ctx.runMutation(
      internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact,
      {
        sourceType: "url_fetch",
        sourceUrl: s.url,
        title: s.headline,
        rawContent: (s.snippet || "").slice(0, 2000),
        extractedData: {
          kind: "news_snippet",
          sourceName: s.source,
          citationId,
          workflowId: opts.workflowId,
          createdByAgent: opts.agentName,
        },
        fetchedAt,
        contentHash,
      }
    );

    out.set(s.url, upserted.id);
  }
  return out;
}

/**
 * Generate a stable thread ID
 */
function generateThreadId(name: string, entityKeys: string[]): string {
  const input = `${name}_${entityKeys.sort().join("_")}`;
  return `nt_${fnv1a32Hex(input)}`;
}

/**
 * Generate URL-friendly slug from name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function parsePublishedAtToMs(publishedAt?: string): number | null {
  if (!publishedAt) return null;
  const t = Date.parse(publishedAt);
  return Number.isFinite(t) ? t : null;
}

function pickOccurredAt(relatedSources: NewsItem[], fallback: number): number {
  const times = relatedSources
    .map((n) => parsePublishedAtToMs(n.publishedAt))
    .filter((t): t is number => typeof t === "number");
  if (times.length === 0) return fallback;
  return Math.max(...times);
}

function extractAtomicClaims(text: string, max = 6): string[] {
  const raw = String(text || "");
  if (!raw.trim()) return [];

  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const claims: string[] = [];
  for (const s of sentences) {
    if (claims.length >= max) break;
    // Skip obviously non-claimy filler
    if (s.length < 25) continue;
    claims.push(s);
  }

  return claims;
}

/**
 * Regex-based claim classification (fast synchronous fallback).
 */
function classifyClaimKind(claim: string, hasEvidence = false): {
  kind: "verifiable" | "interpretation" | "prediction";
  uncertainty?: number;
  speculativeRisk: "grounded" | "mixed" | "speculative";
  entailmentVerdict: "entailed" | "neutral" | "contradicted";
} {
  const c = claim.toLowerCase();
  // Predictions / forward-looking language
  if (
    /\b(will|expected|forecast|projected|likely|unlikely|may|might|could|anticipate|estimate)\b/.test(
      c
    )
  ) {
    return {
      kind: "prediction",
      uncertainty: 0.5,
      speculativeRisk: "speculative",
      entailmentVerdict: "neutral",
    };
  }
  // Interpretive / implication language
  if (/\b(suggests|implies|indicates|signals|appears|seems|means|reflects)\b/.test(c)) {
    return {
      kind: "interpretation",
      speculativeRisk: hasEvidence ? "mixed" : "speculative",
      entailmentVerdict: hasEvidence ? "neutral" : "neutral",
    };
  }
  // Verifiable claims — grounded only if we have evidence artifacts backing them
  return {
    kind: "verifiable",
    speculativeRisk: hasEvidence ? "grounded" : "mixed",
    entailmentVerdict: hasEvidence ? "entailed" : "neutral",
  };
}

type ClaimClassification = {
  kind: "verifiable" | "interpretation" | "prediction";
  uncertainty?: number;
  speculativeRisk: "grounded" | "mixed" | "speculative";
  entailmentVerdict: "entailed" | "neutral" | "contradicted";
};

/**
 * LLM-based batch claim classification (Phase 7 upgrade).
 *
 * Classifies all claims in a single LLM call for efficiency.
 * Falls back to regex classification on failure.
 */
async function classifyClaimsBatchLLM(
  claims: string[],
  hasEvidence: boolean,
  model: string
): Promise<ClaimClassification[]> {
  if (claims.length === 0) return [];

  try {
    const llm = await getLanguageModelSafe(model);
    const claimBlock = claims.map((c, i) => `[${i + 1}] ${c}`).join("\n");

    const { text } = await generateText({
      model: llm,
      prompt: `Classify each claim below. For each, determine:
- kind: "verifiable" (can be checked against facts), "interpretation" (subjective analysis), or "prediction" (forward-looking)
- speculativeRisk: "grounded" (backed by evidence), "mixed" (partially supported), or "speculative" (no direct evidence)
- entailmentVerdict: "entailed" (follows from evidence), "neutral" (neither supported nor contradicted), or "contradicted" (conflicts with evidence)
- uncertainty: 0.0-1.0 (how uncertain is this claim)

Evidence available: ${hasEvidence ? "YES - source artifacts exist" : "NO - no direct evidence artifacts"}

CLAIMS:
${claimBlock}

Respond ONLY with a JSON array, one object per claim in order:
[{"kind":"...","speculativeRisk":"...","entailmentVerdict":"...","uncertainty":0.0}, ...]`,
      temperature: 0.1,
    });

    let jsonStr = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    // Also try extracting array from surrounding text
    const arrMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrMatch) jsonStr = arrMatch[0];

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed) || parsed.length !== claims.length) {
      throw new Error(`Expected ${claims.length} classifications, got ${Array.isArray(parsed) ? parsed.length : "non-array"}`);
    }

    const validKinds = new Set(["verifiable", "interpretation", "prediction"]);
    const validRisks = new Set(["grounded", "mixed", "speculative"]);
    const validVerdicts = new Set(["entailed", "neutral", "contradicted"]);

    return parsed.map((c: any, i: number) => {
      // Validate each field, fall back to regex on invalid
      if (
        !c || typeof c !== "object" ||
        !validKinds.has(c.kind) ||
        !validRisks.has(c.speculativeRisk) ||
        !validVerdicts.has(c.entailmentVerdict)
      ) {
        return classifyClaimKind(claims[i], hasEvidence);
      }
      return {
        kind: c.kind as ClaimClassification["kind"],
        speculativeRisk: c.speculativeRisk as ClaimClassification["speculativeRisk"],
        entailmentVerdict: c.entailmentVerdict as ClaimClassification["entailmentVerdict"],
        uncertainty: typeof c.uncertainty === "number" ? Math.min(1, Math.max(0, c.uncertainty)) : undefined,
      };
    });
  } catch (e) {
    console.warn("[PublisherAgent] LLM claim classification failed, using regex fallback:", e);
    return claims.map((c) => classifyClaimKind(c, hasEvidence));
  }
}

/**
 * Render the three-part hypothesis block per DRANE design principle:
 *   Part 1: Competing Explanations — the hypotheses themselves
 *   Part 2: Evidence for Each — speculative risk and measurement approach
 *   Part 3: What Would Change My Mind — falsification criteria
 *
 * Only called when hypothesisCandidates are present on state.
 */
function renderHypothesisSection(candidates: HypothesisCandidate[]): string {
  if (candidates.length === 0) return "";

  // Part 1: Competing Explanations
  const part1 = ["## Competing Explanations"];
  for (const h of candidates) {
    part1.push(`- **${h.label}**: ${h.title} -- ${h.claimForm}`);
  }

  // Part 2: Evidence for Each
  const part2 = ["## Evidence for Each"];
  for (const h of candidates) {
    const risk = h.speculativeRisk === "grounded" ? "Grounded"
      : h.speculativeRisk === "mixed" ? "Partly supported"
      : "Interpretive";
    part2.push(`- **${h.label}** [${risk}]: ${h.measurementApproach}`);
  }

  // Part 3: What Would Change My Mind
  const part3 = ["## What Would Change My Mind"];
  for (const h of candidates) {
    if (h.falsificationCriteria) {
      part3.push(`- **${h.label}**: ${h.falsificationCriteria}`);
    } else {
      part3.push(`- **${h.label}**: No falsification criteria defined`);
    }
  }

  return [part1.join("\n"), part2.join("\n"), part3.join("\n")].join("\n\n");
}

/**
 * Render a markdown evidence grade block from a claimSet (Phase 7).
 */
function renderEvidenceGrade(claimSet: Array<{
  speculativeRisk?: string;
  entailmentVerdict?: string;
}>): string {
  if (claimSet.length === 0) return "";
  const counts = { grounded: 0, mixed: 0, speculative: 0 };
  const verdicts = { entailed: 0, neutral: 0, contradicted: 0 };
  for (const c of claimSet) {
    const r = c.speculativeRisk as keyof typeof counts;
    if (r && r in counts) counts[r]++;
    const v = c.entailmentVerdict as keyof typeof verdicts;
    if (v && v in verdicts) verdicts[v]++;
  }
  const parts: string[] = [];
  if (counts.grounded > 0) parts.push(`${counts.grounded} grounded`);
  if (counts.mixed > 0) parts.push(`${counts.mixed} mixed`);
  if (counts.speculative > 0) parts.push(`${counts.speculative} speculative`);
  if (verdicts.contradicted > 0) parts.push(`${verdicts.contradicted} contradicted`);
  if (parts.length === 0) return "";
  return `\n\n## Evidence Grade\n${parts.join(" | ")} (${claimSet.length} claims total)`;
}

/**
 * Map narrative shift to event significance
 */
function getSignificance(
  shift: NarrativeShift
): "minor" | "moderate" | "major" | "plot_twist" {
  if (shift.type === "plot_twist") return "plot_twist";
  if (shift.confidence >= 0.9) return "major";
  if (shift.confidence >= 0.7) return "moderate";
  return "minor";
}

/**
 * Extract relevant news items for a shift
 */
function findRelatedNews(
  shift: NarrativeShift,
  news: NewsItem[]
): NewsItem[] {
  const description = shift.description.toLowerCase();
  const keywords = description
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 5);

  return news
    .filter((n) => {
      const text = `${n.headline} ${n.snippet}`.toLowerCase();
      return keywords.some((kw) => text.includes(kw));
    })
    .slice(0, 5); // Max 5 sources per event
}

/**
 * Build citation metadata from news items
 */
function buildCitations(
  news: NewsItem[],
  existingCitations: Map<string, CitationMetadata>
): Map<string, CitationMetadata> {
  const citations = new Map(existingCitations);

  for (const item of news) {
    if (!item.url) continue;

    const citationId = makeWebSourceCitationId(item.url);
    if (!citations.has(citationId)) {
      citations.set(citationId, {
        id: citationId,
        url: item.url,
        title: item.headline,
        publishedAt: item.publishedAt,
        domain: new URL(item.url).hostname.replace("www.", ""),
      });
    }
  }

  return citations;
}

/**
 * Generate event summary using LLM
 */
async function generateEventSummary(
  ctx: ActionCtx,
  parentWorkflowId: string | undefined,
  toolReplayMode: "live" | "record" | "replay",
  shift: NarrativeShift,
  relatedNews: NewsItem[],
  model: string
): Promise<string> {
  const newsContext = relatedNews
    .map((n) => `- ${n.headline}: ${n.snippet.slice(0, 150)}`)
    .join("\n");

  const prompt = `Write a concise, factual summary (2-3 sentences) of this narrative development:

Event: ${shift.description}
Type: ${shift.type}

Related News:
${newsContext}

Requirements:
- Be specific and cite key details
- Use objective, journalistic tone
- Focus on what happened and why it matters`;

  try {
    const toolName = "generateText.newsroom_publisher_summary";
    const toolInput = { model, prompt, maxRetries: 2, temperature: 0.3 };
    const inputHash = fnv1a32Hex(stableStringify(toolInput));

    let result: any;
    if (toolReplayMode === "replay" && parentWorkflowId) {
      const recorded = await ctx.runQuery(
        internal.domains.narrative.mutations.toolReplay.getToolRecord,
        { parentWorkflowId, toolName, inputHash }
      );
      if (!recorded) {
        throw new Error(
          `[PublisherAgent] Replay record missing for ${toolName} (${inputHash})`
        );
      }
      result = recorded;
    } else {
      result = await generateText({
        model: getLanguageModelSafe(model),
        prompt,
        maxRetries: 2,
        temperature: 0.3,
      });
      if (toolReplayMode === "record" && parentWorkflowId) {
        await ctx.runMutation(internal.domains.narrative.mutations.toolReplay.saveToolRecord, {
          parentWorkflowId,
          toolName,
          inputHash,
          input: toolInput,
          output: result,
        });
      }
    }
    return result.text.trim();
  } catch (error) {
    console.error("[PublisherAgent] Summary generation failed:", error);
    return shift.description;
  }
}

/**
 * Determine phase based on event count and recent activity
 */
function determinePhase(
  eventCount: number,
  recentEventCount: number,
  hasPlotTwist: boolean
): "emerging" | "escalating" | "climax" | "resolution" | "dormant" {
  if (eventCount <= 2) return "emerging";
  if (hasPlotTwist) return "climax";
  if (recentEventCount >= 3) return "escalating";
  if (recentEventCount === 0) return "dormant";
  return "resolution";
}

/**
 * Publisher Agent: Persist narrative updates with citations
 *
 * @param ctx - Convex action context
 * @param state - Current newsroom state
 * @param config - Publisher configuration
 * @returns Updated state with generated narratives
 */
export async function runPublisherAgent(
  ctx: ActionCtx,
  state: NewsroomState,
  config: PublisherConfig = {}
): Promise<NewsroomState> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  console.log(`[PublisherAgent] Publishing ${state.narrativeShifts.length} narrative shifts`);
  console.log(`[PublisherAgent] Model: ${cfg.model}, Generate summaries: ${cfg.generateSummaries}`);

  const generatedNarratives: GeneratedNarrative[] = [];
  const errors: string[] = [];
  let citations = new Map(state.citations);
  const publishedThreadIds: string[] = [...(state.publishedThreadIds ?? [])];
  const publishedEventIds: string[] = [...(state.publishedEventIds ?? [])];
  const publishedEventStableIds: string[] = [...(state.publishedEventStableIds ?? [])];
  const publishedPostIds: string[] = [...((state as any).publishedPostIds ?? [])];
  const persistedSearchLogIds: string[] = [...(state.persistedSearchLogIds ?? [])];
  const dedupDecisions: any[] = [...((state as any).dedupDecisions ?? [])];

  // Group shifts by type
  const newThreadProposals = state.narrativeShifts.filter(
    (s) => s.type === "new_thread" && s.newThreadProposal
  );
  const threadUpdates = state.narrativeShifts.filter(
    (s) => s.type !== "new_thread"
  );

  console.log(`[PublisherAgent] ${newThreadProposals.length} new threads, ${threadUpdates.length} updates`);

  // Process new thread proposals
  for (const shift of newThreadProposals) {
    const proposal = shift.newThreadProposal!;

    try {
      // Find related news for this thread
      const relatedNews = findRelatedNews(shift, state.weeklyNews);
      let relatedSources = relatedNews.filter((n) => !!n.url);
      if (relatedSources.length === 0) {
        // Safety: never publish an event with zero sources in live mode.
        // Fall back to the top items from this run so citation coverage stays meaningful.
        relatedSources = state.weeklyNews.filter((n) => !!n.url).slice(0, 3);
      }
      citations = buildCitations(relatedSources, citations);

      // Generate event summary if enabled
      const summary = cfg.generateSummaries
        ? await generateEventSummary(
            ctx,
            cfg.toolReplayId ?? state.workflowId,
            cfg.toolReplayMode,
            shift,
            relatedSources,
            cfg.model
          )
        : shift.description;

      const wallNow = cfg.deterministicMode ? (state.deterministicNowMs ?? Date.now()) : Date.now();
      const occurredAt = pickOccurredAt(relatedSources, wallNow);
      const threadId = generateThreadId(proposal.name, proposal.entityKeys);
      const createdAtOverride = cfg.deterministicMode ? occurredAt : undefined;

      const sourceArtifactByUrl = await upsertSourceArtifactsForNews(ctx, relatedSources, {
        fetchedAtFallbackMs: occurredAt,
        deterministicMode: cfg.deterministicMode,
        workflowId: state.workflowId,
        agentName: "publisher",
      });
      const sourceArtifactIds = relatedSources
        .map((n) => sourceArtifactByUrl.get(n.url))
        .filter(Boolean) as Id<"sourceArtifacts">[];

      // Create the thread
      const createdThreadId = await ctx.runMutation(
        internal.domains.narrative.mutations.threads.createThreadInternal,
        {
          threadId,
          name: proposal.name,
          slug: generateSlug(proposal.name),
          entityKeys: proposal.entityKeys,
          topicTags: proposal.topicTags,
          thesis: proposal.thesis,
          currentPhase: "emerging",
          firstEventAt: occurredAt,
          latestEventAt: occurredAt,
          eventCount: 0,
          plotTwistCount: 0,
          quality: {
            hasMultipleSources: relatedSources.length >= 2,
            hasRecentActivity: true,
            hasVerifiedClaims: false,
            hasCounterNarrative: false,
          },
          userId: state.userId,
          isPublic: false,
          createdAtOverride,
        }
      );
      publishedThreadIds.push(createdThreadId as string);

      // Create evidence artifacts for the related sources (best-effort)
      let evidenceArtifactIds: string[] = [];
      if (relatedSources.length > 0) {
        try {
           const artifacts = relatedSources.map((n) => ({
             url: n.url,
             contentHash: fnv1a32Hex(`${makeWebSourceCitationId(n.url)}|${n.headline}|${n.snippet}`),
             publishedAt: parsePublishedAtToMs(n.publishedAt) ?? undefined,
             fetchedAt: cfg.deterministicMode
               ? (parsePublishedAtToMs(n.publishedAt) ?? occurredAt)
               : undefined,
             extractedQuotes: [{ text: (n.snippet || "").slice(0, 500), context: n.headline }],
             entities: proposal.entityKeys,
             topics: (state.focusTopics || []).slice(0, 8),
             retrievalTrace: {
               searchQuery: undefined,
               agentName: "publisher",
               toolName: "newsroom_pipeline",
             },
           }));
          const created = await ctx.runMutation(
            internal.domains.narrative.mutations.evidence.batchCreateEvidenceArtifacts,
            { artifacts }
          );
          evidenceArtifactIds = created.map((a: any) => a.artifactId);
        } catch (e) {
          console.error("[PublisherAgent] Evidence artifact creation failed:", e);
        }
      }

      const hasEvidence = evidenceArtifactIds.length > 0;
      const atomicClaims = extractAtomicClaims(summary);
      // Use LLM batch classification when summaries are enabled, regex fallback otherwise
      const classifications = cfg.generateSummaries
        ? await classifyClaimsBatchLLM(atomicClaims, hasEvidence, cfg.model)
        : atomicClaims.map((c) => classifyClaimKind(c, hasEvidence));
      const claimSet = atomicClaims.map((claim, i) => ({
        claim,
        confidence: shift.confidence,
        evidenceArtifactIds,
        ...classifications[i],
      }));

      // Create initial event for the thread
      const created = await ctx.runAction(
        internal.domains.narrative.mutations.dedup.createEventWithDedup,
        {
          threadId: createdThreadId,
          headline: proposal.name,
          summary,
          significance: getSignificance(shift),
          occurredAt,
          sourceUrls: relatedSources.map((n) => n.url),
          sourceNames: relatedSources.map((n) => n.source),
          sourceType: "web_news",
          entityKeys: proposal.entityKeys,
          discoveredByAgent: "publisher",
          agentConfidence: shift.confidence,
          artifactIds: sourceArtifactIds.length > 0 ? sourceArtifactIds : undefined,
          dedupPolicy: {
            mode: cfg.deterministicMode ? "deterministic" : "live",
            version: "v1",
          },
          createdAtOverride,
          claimSet: claimSet.length > 0 ? claimSet : undefined,
        }
      );
      if (created.created && created.eventDocId) {
        publishedEventIds.push(created.eventDocId as string);
      }
      if (created.created && created.stableEventId) {
        publishedEventStableIds.push(created.stableEventId);
      }
      dedupDecisions.push({
        threadId: String(createdThreadId),
        created: created.created,
        eventDocId: created.eventDocId ? String(created.eventDocId) : undefined,
        stableEventId: created.stableEventId,
        dedupResult: created.dedupResult,
      });

      // Track generated narrative
      generatedNarratives.push({
        threadId: createdThreadId as string,
        isNewThread: true,
        newEvents: [
          {
            headline: proposal.name,
            summary,
            significance: getSignificance(shift),
            sourceUrls: relatedSources.map((n) => n.url),
            citationIds: relatedSources.map((n) => makeWebSourceCitationId(n.url)),
            occurredAt,
          },
        ],
        updatedThesis: proposal.thesis,
        updatedPhase: "emerging",
      });

      // Create inaugural post for the new thread (Phase 7: Social Substrate)
      try {
        const postCitations = relatedSources.slice(0, 5).map((n) => ({
          citationKey: makeWebSourceCitationId(n.url),
          artifactId: sourceArtifactByUrl.get(n.url) as any,
          quote: n.snippet?.slice(0, 200),
          publishedAt: parsePublishedAtToMs(n.publishedAt) ?? undefined,
        })).filter(c => c.artifactId);

        // Build post content with Phase 7 hypothesis + evidence grade sections
        const hypothesisSection = state.hypothesisCandidates?.length
          ? "\n\n" + renderHypothesisSection(state.hypothesisCandidates)
          : "";
        const evidenceGradeSection = claimSet.length > 0
          ? renderEvidenceGrade(claimSet)
          : "";
        const postContent = `## Thesis\n${proposal.thesis}\n\n## Summary\n${summary}${hypothesisSection}${evidenceGradeSection}`;

        const createdPostId = await ctx.runMutation(
          internal.domains.narrative.mutations.posts.createPostInternal,
          {
            threadId: createdThreadId as Id<"narrativeThreads">,
            postType: "delta_update",
            title: `New Thread: ${proposal.name}`,
            content: postContent,
            changeSummary: [
              `New narrative thread created`,
              `Thesis: ${proposal.thesis.slice(0, 100)}`,
              `Based on ${relatedSources.length} source(s)`,
            ],
            citations: postCitations,
            agentName: "publisher",
            confidence: shift.confidence,
          }
        );
        publishedPostIds.push(String(createdPostId));

        console.log(`[PublisherAgent] Created inaugural post for thread`);
      } catch (postError) {
        console.warn(`[PublisherAgent] Post creation failed (non-fatal):`, postError);
      }

      console.log(`[PublisherAgent] Created thread: ${proposal.name} (${createdThreadId})`);
    } catch (error) {
      const errorMsg = `Failed to create thread "${proposal.name}": ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[PublisherAgent] ${errorMsg}`);
      errors.push(errorMsg);
    }
  }

  // Process updates to existing threads
  for (const shift of threadUpdates) {
    try {
      // Find related news
      const relatedNews = findRelatedNews(shift, state.weeklyNews);
      let relatedSources = relatedNews.filter((n) => !!n.url);
      if (relatedSources.length === 0) {
        relatedSources = state.weeklyNews.filter((n) => !!n.url).slice(0, 3);
      }
      citations = buildCitations(relatedSources, citations);

      // Generate event summary
      const summary = cfg.generateSummaries
        ? await generateEventSummary(
            ctx,
            cfg.toolReplayId ?? state.workflowId,
            cfg.toolReplayMode,
            shift,
            relatedSources,
            cfg.model
          )
        : shift.description;

      const wallNow = cfg.deterministicMode ? (state.deterministicNowMs ?? Date.now()) : Date.now();
      const occurredAt = pickOccurredAt(relatedSources, wallNow);
      const createdAtOverride = cfg.deterministicMode ? occurredAt : undefined;

      // Determine which thread to update
      const validExistingThreadIds = new Set(
        (state.existingThreads ?? []).map((t) => String(t.threadId))
      );
      let targetThreadId = shift.affectedThreadId;
      if (targetThreadId && !validExistingThreadIds.has(String(targetThreadId))) {
        // Analyst sometimes outputs a human-readable label instead of an actual thread ID.
        // Ignore it and fall back to deterministic matching below.
        targetThreadId = undefined;
      }

      // If no specific thread, try to find the best matching existing thread
      if (!targetThreadId && state.existingThreads.length > 0) {
        // Match by entity keys or topic similarity
        const matchingThread = state.existingThreads[0]; // Simple: use most recent
        targetThreadId = matchingThread.threadId;
      }

      if (targetThreadId) {
        const sourceArtifactByUrl = await upsertSourceArtifactsForNews(ctx, relatedSources, {
          fetchedAtFallbackMs: occurredAt,
          deterministicMode: cfg.deterministicMode,
          workflowId: state.workflowId,
          agentName: "publisher",
        });
        const sourceArtifactIds = relatedSources
          .map((n) => sourceArtifactByUrl.get(n.url))
          .filter(Boolean) as Id<"sourceArtifacts">[];

        // Create evidence artifacts for the related sources (best-effort)
        let evidenceArtifactIds: string[] = [];
        if (relatedSources.length > 0) {
          try {
            const artifacts = relatedSources.map((n) => ({
              url: n.url,
              contentHash: fnv1a32Hex(`${makeWebSourceCitationId(n.url)}|${n.headline}|${n.snippet}`),
              publishedAt: parsePublishedAtToMs(n.publishedAt) ?? undefined,
              fetchedAt: cfg.deterministicMode
                ? (parsePublishedAtToMs(n.publishedAt) ?? occurredAt)
                : undefined,
              extractedQuotes: [{ text: (n.snippet || "").slice(0, 500), context: n.headline }],
              entities: state.targetEntityKeys,
              topics: (state.focusTopics || []).slice(0, 8),
              retrievalTrace: {
                searchQuery: undefined,
                agentName: "publisher",
                toolName: "newsroom_pipeline",
              },
            }));
            const createdArtifacts = await ctx.runMutation(
              internal.domains.narrative.mutations.evidence.batchCreateEvidenceArtifacts,
              { artifacts }
            );
            evidenceArtifactIds = createdArtifacts.map((a: any) => a.artifactId);
          } catch (e) {
            console.error("[PublisherAgent] Evidence artifact creation failed:", e);
          }
        }

        const hasEvidence = evidenceArtifactIds.length > 0;
        const updateAtomicClaims = extractAtomicClaims(summary);
        const updateClassifications = cfg.generateSummaries
          ? await classifyClaimsBatchLLM(updateAtomicClaims, hasEvidence, cfg.model)
          : updateAtomicClaims.map((c) => classifyClaimKind(c, hasEvidence));
        const claimSet = updateAtomicClaims.map((claim, i) => ({
          claim,
          confidence: shift.confidence,
          evidenceArtifactIds,
          ...updateClassifications[i],
        }));

        // Add event to existing thread (dedup-aware)
        const created = await ctx.runAction(
          internal.domains.narrative.mutations.dedup.createEventWithDedup,
          {
            threadId: targetThreadId as Id<"narrativeThreads">,
            headline: shift.description.slice(0, 200),
            summary,
            significance: getSignificance(shift),
            occurredAt,
            sourceUrls: relatedSources.map((n) => n.url),
            sourceNames: relatedSources.map((n) => n.source),
            sourceType: "web_news",
            entityKeys: state.targetEntityKeys,
            discoveredByAgent: "publisher",
            agentConfidence: shift.confidence,
            artifactIds: sourceArtifactIds.length > 0 ? sourceArtifactIds : undefined,
            dedupPolicy: {
              mode: cfg.deterministicMode ? "deterministic" : "live",
              version: "v1",
            },
            createdAtOverride,
            claimSet: claimSet.length > 0 ? claimSet : undefined,
          }
        );
        if (created.created && created.eventDocId) {
          publishedEventIds.push(created.eventDocId as string);
        }
        if (created.created && created.stableEventId) {
          publishedEventStableIds.push(created.stableEventId);
        }
        dedupDecisions.push({
          threadId: String(targetThreadId),
          created: created.created,
          eventDocId: created.eventDocId ? String(created.eventDocId) : undefined,
          stableEventId: created.stableEventId,
          dedupResult: created.dedupResult,
        });

        // Track generated narrative
        generatedNarratives.push({
          threadId: targetThreadId,
          isNewThread: false,
          newEvents: [
            {
              headline: shift.description.slice(0, 200),
              summary,
              significance: getSignificance(shift),
              sourceUrls: relatedSources.map((n) => n.url),
              citationIds: relatedSources.map((n) => makeWebSourceCitationId(n.url)),
              occurredAt,
            },
          ],
        });

        // Create social substrate post for the thread update (Phase 7)
        // This enables the "internal X/Reddit" collaborative pattern
        if (created.created) {
          try {
            const postType = shift.type === "plot_twist" ? "thesis_revision" as const
              : shift.type === "sentiment_shift" ? "evidence_addition" as const
              : "delta_update" as const;

            const changeSummary = [
              `${shift.type.replace("_", " ")}: ${shift.description.slice(0, 100)}`,
              ...(relatedSources.length > 0
                ? [`Based on ${relatedSources.length} source(s)`]
                : []),
            ];

            // Build citations for the post
            const postCitations = relatedSources.slice(0, 5).map((n) => ({
              citationKey: makeWebSourceCitationId(n.url),
              artifactId: sourceArtifactByUrl.get(n.url) as any,
              quote: n.snippet?.slice(0, 200),
              publishedAt: parsePublishedAtToMs(n.publishedAt) ?? undefined,
            })).filter(c => c.artifactId);

            // Append evidence grade section if claims were generated
            const updateEvidenceGrade = claimSet.length > 0
              ? renderEvidenceGrade(claimSet)
              : "";
            const updatePostContent = summary + updateEvidenceGrade;

            const createdPostId = await ctx.runMutation(
              internal.domains.narrative.mutations.posts.createPostInternal,
              {
                threadId: targetThreadId as Id<"narrativeThreads">,
                postType,
                title: shift.description.slice(0, 100),
                content: updatePostContent,
                changeSummary,
                citations: postCitations,
                agentName: "publisher",
                confidence: shift.confidence,
              }
            );
            publishedPostIds.push(String(createdPostId));

            console.log(`[PublisherAgent] Created ${postType} post for thread update`);
          } catch (postError) {
            // Non-fatal: post creation is supplementary to event creation
            console.warn(`[PublisherAgent] Post creation failed (non-fatal):`, postError);
          }
        }

        console.log(`[PublisherAgent] Added event to thread: ${targetThreadId}`);
      } else {
        console.log(`[PublisherAgent] No matching thread for shift: ${shift.description.slice(0, 50)}...`);
      }
    } catch (error) {
      const errorMsg = `Failed to process shift "${shift.description.slice(0, 50)}...": ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[PublisherAgent] ${errorMsg}`);
      errors.push(errorMsg);
    }
  }

  // Log all searches to the database
  if (state.searchLogs.length > 0) {
    try {
      const ids = await ctx.runMutation(
        internal.domains.narrative.mutations.searchLog.batchLogSearches,
        {
          searches: state.searchLogs.map((log) => ({
            query: log.query,
            searchType: log.searchType,
            resultCount: log.resultCount,
            resultUrls: log.resultUrls,
            agentName: "newsroom_pipeline",
          })),
          userId: state.userId,
          workflowId: state.workflowId,
          weekNumber: state.weekNumber,
          searchedAt: Date.now(),
        }
      );
      persistedSearchLogIds.push(...(ids as unknown as string[]));
      console.log(`[PublisherAgent] Logged ${state.searchLogs.length} searches`);
    } catch (error) {
      console.error(`[PublisherAgent] Failed to log searches:`, error);
    }
  }

  console.log(`[PublisherAgent] Published ${generatedNarratives.length} narratives, ${citations.size} citations`);

  // Return final state
  return {
    ...state,
    generatedNarratives,
    citations,
    errors: [...state.errors, ...errors],
    publishedThreadIds,
    publishedEventIds,
    publishedEventStableIds,
    publishedPostIds,
    persistedSearchLogIds,
    dedupDecisions,
    currentStep: "complete",
    completedAt: Date.now(),
  };
}

/**
 * Publisher Agent tool definition for use in LangGraph
 */
export const publisherAgentTool = {
  name: "publish_narratives",
  description: "Persist narrative updates and events to the database",
  parameters: {
    generateSummaries: {
      type: "boolean",
      description: "Generate AI summaries for events",
    },
    autoVerifyThreshold: {
      type: "number",
      description: "Confidence threshold for auto-verification",
    },
  },
};
