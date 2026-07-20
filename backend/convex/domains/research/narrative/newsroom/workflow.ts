"use node";

/**
 * Newsroom Workflow - LangGraph StateGraph Orchestration
 *
 * Orchestrates the 4-agent Newsroom pipeline:
 * Scout → Historian → Analyst → Publisher
 *
 * Uses LangGraph's StateGraph for:
 * - Checkpointing and resumability
 * - State transitions between agents
 * - Error handling and retries
 *
 * @module domains/narrative/newsroom/workflow
 */

import { v } from "convex/values";
import { action, internalAction } from "../../../../_generated/server";
import type { ActionCtx } from "../../../../_generated/server";
import type { Id } from "../../../../_generated/dataModel";
import { api, internal } from "../../../../_generated/api";
import { StateGraph, END, START, Annotation } from "@langchain/langgraph/web";

import {
  runScoutAgent,
  runHistorianAgent,
  runAnalystAgent,
  runCuratorAgent,
  runPublisherAgent,
  runCommentHarvester,
  type ScoutConfig,
  type HistorianConfig,
  type AnalystConfig,
  type CuratorConfig,
  type PublisherConfig,
  type CommentHarvesterConfig,
} from "./agents";

import {
  type NewsroomState,
  createInitialNewsroomState,
  getCurrentWeekNumber,
} from "./state";

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

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fnv1a32Hex(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseIsoWeekStartMs(weekNumber: string): number | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekNumber);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;

  // ISO week date: week 1 is the week with Jan 4.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // 1..7
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));

  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.getTime();
}

function computeDeterministicNowMsFromConfig(
  weekNumber: string,
  config: any
): number | null {
  const injected = config?.scout?.injectedNewsItems;
  if (Array.isArray(injected) && injected.length > 0) {
    const parsed = injected
      .map((n: any) => Date.parse(n?.publishedAt))
      .filter((t: any) => Number.isFinite(t)) as number[];
    if (parsed.length > 0) return Math.max(...parsed);
  }

  const weekStart = parseIsoWeekStartMs(weekNumber);
  if (weekStart === null) return null;
  // Use end-of-week as anchor to keep "lookback" stable within the same scenario.
  return weekStart + 7 * 24 * 60 * 60_000 - 1;
}

function getCodeVersion(): string | null {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    process.env.COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    null
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LANGGRAPH STATE ANNOTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LangGraph state annotation for the Newsroom workflow.
 * Maps NewsroomState to a format LangGraph can manage.
 */
const NewsroomAnnotation = Annotation.Root({
  // Core state passed through the pipeline
  state: Annotation<NewsroomState>,
  // Context reference for mutations
  actionCtx: Annotation<ActionCtx | null>,
});

type NewsroomGraphState = typeof NewsroomAnnotation.State;

// ═══════════════════════════════════════════════════════════════════════════
// WORKFLOW CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export interface NewsroomWorkflowConfig {
  scout?: ScoutConfig;
  historian?: HistorianConfig;
  analyst?: AnalystConfig;
  curator?: CuratorConfig;
  publisher?: PublisherConfig;
  commentHarvester?: CommentHarvesterConfig;
  postProcess?: {
    enableEventVerification?: boolean;
    enableTemporalFacts?: boolean;
    enablePostContradictions?: boolean;
    enableCommentHarvester?: boolean;
    enableCorrelations?: boolean;
    maxEvents?: number;
    maxFactsPerEvent?: number;
    correlationMinStrength?: number;
  };
  /** Root tool record/replay mode propagated to agents (unless overridden per-agent). */
  toolReplayMode?: "live" | "record" | "replay";
  /** Root recording set identifier propagated to agents (unless overridden per-agent). */
  toolReplayId?: string;
  /** Maximum retries per agent */
  maxRetries?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Skip curator agent (for backwards compatibility) */
  skipCurator?: boolean;
}

const DEFAULT_WORKFLOW_CONFIG: Required<NewsroomWorkflowConfig> = {
  scout: {},
  historian: {},
  analyst: {},
  curator: {},
  publisher: {},
  commentHarvester: {},
  postProcess: {
    enableEventVerification: true,
    enableTemporalFacts: true,
    enablePostContradictions: true,
    enableCommentHarvester: true,
    enableCorrelations: true,
    maxEvents: 25,
    maxFactsPerEvent: 3,
    correlationMinStrength: 0.5,
  },
  toolReplayMode: "live",
  toolReplayId: "",
  maxRetries: 2,
  verbose: true,
  skipCurator: false,
};

// ═══════════════════════════════════════════════════════════════════════════
// WORKFLOW RESULT
// ═══════════════════════════════════════════════════════════════════════════

export interface NewsroomWorkflowResult {
  success: boolean;
  workflowId?: string;
  weekNumber: string;
  entityKeys: string[];
  validation?: {
    passed: boolean;
    metrics: {
      citationCoverage: number;
      claimCoverage: number;
      unsupportedClaimRate: number;
      evidenceArtifactHitRate: number;
    };
    errors: string[];
    warnings: string[];
  };
  stats: {
    newsItemsFound: number;
    claimsRetrieved: number;
    existingThreads: number;
    shiftsDetected: number;
    narrativesPublished: number;
    searchesLogged: number;
    citationsGenerated: number;
    verifiedEvents?: number;
    temporalFactsCreated?: number;
    contradictionsFound?: number;
    disputesCreated?: number;
  };
  published?: {
    threadIds: string[];
    eventIds: string[];
    stableEventIds: string[];
    searchLogIds: string[];
    postIds?: string[];
  };
  errors: string[];
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// AGENT NODE WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scout node - discovers this week's news
 */
async function scoutNode(
  graphState: NewsroomGraphState,
  config: NewsroomWorkflowConfig
): Promise<Partial<NewsroomGraphState>> {
  const ctx = graphState.actionCtx;
  if (!ctx) throw new Error("Action context not available");

  console.log("[NewsroomWorkflow] Running Scout Agent...");
  const updatedState = await runScoutAgent(ctx, graphState.state, config.scout);

  return { state: updatedState };
}

/**
 * Historian node - retrieves historical context
 */
async function historianNode(
  graphState: NewsroomGraphState,
  config: NewsroomWorkflowConfig
): Promise<Partial<NewsroomGraphState>> {
  const ctx = graphState.actionCtx;
  if (!ctx) throw new Error("Action context not available");

  console.log("[NewsroomWorkflow] Running Historian Agent...");
  const updatedState = await runHistorianAgent(ctx, graphState.state, config.historian);

  return { state: updatedState };
}

/**
 * Analyst node - detects narrative shifts
 */
async function analystNode(
  graphState: NewsroomGraphState,
  config: NewsroomWorkflowConfig
): Promise<Partial<NewsroomGraphState>> {
  const ctx = graphState.actionCtx;
  if (!ctx) throw new Error("Action context not available");

  console.log("[NewsroomWorkflow] Running Analyst Agent...");
  const updatedState = await runAnalystAgent(ctx, graphState.state, config.analyst);

  return { state: updatedState };
}

/**
 * Curator node - decides how to handle narrative shifts
 * (append delta, revise thesis, spawn new thread, or skip)
 */
async function curatorNode(
  graphState: NewsroomGraphState,
  config: NewsroomWorkflowConfig
): Promise<Partial<NewsroomGraphState>> {
  const ctx = graphState.actionCtx;
  if (!ctx) throw new Error("Action context not available");

  // Skip curator if configured
  if (config.skipCurator) {
    console.log("[NewsroomWorkflow] Skipping Curator Agent (skipCurator=true)");
    return { state: graphState.state };
  }

  console.log("[NewsroomWorkflow] Running Curator Agent...");
  const updatedState = await runCuratorAgent(ctx, graphState.state, config.curator);

  return { state: updatedState };
}

/**
 * Publisher node - persists narrative updates
 */
async function publisherNode(
  graphState: NewsroomGraphState,
  config: NewsroomWorkflowConfig
): Promise<Partial<NewsroomGraphState>> {
  const ctx = graphState.actionCtx;
  if (!ctx) throw new Error("Action context not available");

  console.log("[NewsroomWorkflow] Running Publisher Agent...");
  const updatedState = await runPublisherAgent(ctx, graphState.state, config.publisher);

  return { state: updatedState };
}

async function postProcessNode(
  graphState: NewsroomGraphState,
  config: NewsroomWorkflowConfig
): Promise<Partial<NewsroomGraphState>> {
  const ctx = graphState.actionCtx;
  if (!ctx) throw new Error("Action context not available");

  const state = graphState.state;
  const ppCfg = { ...DEFAULT_WORKFLOW_CONFIG.postProcess, ...(config.postProcess ?? {}) };

  const deterministic = !!(config.publisher as any)?.deterministicMode;
  if (deterministic) {
    console.log("[NewsroomWorkflow] Skipping post-process (deterministicMode=true)");
    return { state };
  }

  const publishedEventIds = (state.publishedEventIds ?? []).slice(-(ppCfg.maxEvents ?? 25));
  const publishedPostIds = ((state as any).publishedPostIds ?? []) as string[];

  let verifiedEvents = 0;
  let temporalFactsCreated = 0;
  let contradictionsFound = 0;
  let disputesCreated = 0;

  for (const eventIdStr of publishedEventIds) {
    const eventId = eventIdStr as unknown as Id<"narrativeEvents">;
    const event = await ctx.runQuery(api.domains.narrative.queries.events.getEvent, { eventId });
    if (!event) continue;

    // Ensure artifactIds exist for verification/citation popovers
    let artifactIds = (event as any).artifactIds as Id<"sourceArtifacts">[] | undefined;
    if (!Array.isArray(artifactIds) || artifactIds.length === 0) {
      const created: Id<"sourceArtifacts">[] = [];
      const urls = ((event as any).sourceUrls ?? []) as string[];
      for (const url of urls) {
        if (!url) continue;
        const contentHash = await sha256Hex(
          stableStringify({
            version: 1,
            url,
            eventId: (event as any).eventId,
            headline: (event as any).headline,
          })
        );
        const upserted = await ctx.runMutation(
          internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact,
          {
            sourceType: "url_fetch",
            sourceUrl: url,
            title: (event as any).headline,
            rawContent: String((event as any).summary || "").slice(0, 2000),
            extractedData: {
              kind: "event_source_fallback",
              workflowId: state.workflowId,
              createdByAgent: "newsroom_postprocess",
            },
            fetchedAt: (event as any).discoveredAt ?? Date.now(),
            contentHash,
          }
        );
        created.push(upserted.id);
      }
      if (created.length > 0) {
        artifactIds = created;
        await ctx.runMutation(
          internal.domains.narrative.mutations.events.setEventArtifactIdsInternal,
          { eventId, artifactIds: created }
        );
      }
    }

    try {
      await ctx.runAction(
        internal.domains.deepTrace.integrations.syncNarrativeEventToDeepTrace,
        {
          eventId,
          artifactIds,
          fallbackEntityKey: state.targetEntityKeys?.[0],
        },
      );
    } catch (e) {
      console.warn("[NewsroomWorkflow] DeepTrace narrative sync failed (non-fatal):", e);
    }

    if (ppCfg.enableEventVerification && Array.isArray(artifactIds) && artifactIds.length > 0) {
      try {
        const verification = await ctx.runAction(
          internal.domains.verification.integrations.narrativeVerification.verifyNarrativeEvent,
          {
            eventId: (event as any).eventId,
            threadId: event.threadId,
            sourceUrls: (event as any).sourceUrls ?? [],
            headline: (event as any).headline,
            summary: (event as any).summary,
            artifactIds,
          }
        );

        const isVerified =
          verification.overallConfidence >= 0.75 &&
          verification.sourceCredibilityScore >= 0.7 &&
          !verification.hasContradictions;

        await ctx.runMutation(
          internal.domains.narrative.mutations.events.setEventVerificationInternal,
          {
            eventId,
            isVerified,
            hasContradictions: verification.hasContradictions,
          }
        );
        if (isVerified) verifiedEvents++;
      } catch (e) {
        console.warn("[NewsroomWorkflow] Event verification failed (non-fatal):", e);
      }
    }

    if (ppCfg.enableTemporalFacts) {
      try {
        const extraction = await ctx.runAction(
          internal.domains.verification.entailmentChecker.extractVerifiableFacts,
          {
            content: `${(event as any).headline}. ${(event as any).summary}`,
            sourceUrl: ((event as any).sourceUrls ?? [])[0] ?? "",
          }
        );

        const facts = Array.isArray((extraction as any).facts) ? (extraction as any).facts : [];
        const limited = facts.slice(0, ppCfg.maxFactsPerEvent ?? 3);
        if (limited.length > 0) {
          const fallbackSubject = state.targetEntityKeys?.[0] ?? "";
          const tfIds = await ctx.runMutation(
            internal.domains.narrative.mutations.temporalFacts.batchCreateTemporalFacts,
            {
              facts: limited.map((f: any, idx: number) => ({
                factId: `tf_${(event as any).eventId}_${idx}`,
                threadId: event.threadId,
                claimText: String(f.factText ?? f.claim ?? f.fact ?? ""),
                subject: (() => {
                  const s = String(f.subject ?? "").trim();
                  return s.length > 0 ? s : String(fallbackSubject);
                })(),
                predicate: String(f.claimType ?? "fact"),
                object: String(f.factText ?? f.claim ?? f.fact ?? ""),
                validFrom: (event as any).occurredAt,
                confidence: Number(f.extractionConfidence ?? (event as any).agentConfidence ?? 0.5),
                sourceEventIds: [eventId],
                weekNumber: (event as any).weekNumber,
                observedAt: (extraction as any).extractedAt ?? Date.now(),
              })),
            }
          );
          temporalFactsCreated += Array.isArray(tfIds) ? tfIds.length : 0;
        }
      } catch (e) {
        console.warn("[NewsroomWorkflow] Temporal facts extraction failed (non-fatal):", e);
      }
    }
  }

  if (ppCfg.enablePostContradictions && publishedPostIds.length > 0) {
    for (const postIdStr of publishedPostIds) {
      const postId = postIdStr as unknown as Id<"narrativePosts">;
      const post = await ctx.runQuery(api.domains.narrative.queries.posts.getPost, { postId });
      if (!post) continue;
      try {
        const contradictions = await ctx.runAction(
          internal.domains.verification.contradictionDetector.detectContradictions,
          {
            threadId: post.threadId,
            postId,
            content: post.content,
          }
        );
        contradictionsFound += contradictions.contradictionCount;
        disputesCreated += contradictions.disputeIds.length;

        await ctx.runMutation(
          internal.domains.narrative.mutations.posts.markContradictions,
          {
            postId,
            hasContradictions: contradictions.hasContradictions,
            requiresAdjudication: contradictions.hasContradictions,
          }
        );
      } catch (e) {
        console.warn("[NewsroomWorkflow] Post contradiction detection failed (non-fatal):", e);
      }
    }
  }

  return {
    state: {
      ...state,
      postProcessStats: {
        verifiedEvents,
        temporalFactsCreated,
        contradictionsFound,
        disputesCreated,
      },
    } as any,
  };
}

async function commentHarvesterNode(
  graphState: NewsroomGraphState,
  config: NewsroomWorkflowConfig
): Promise<Partial<NewsroomGraphState>> {
  const ctx = graphState.actionCtx;
  if (!ctx) throw new Error("Action context not available");

  const state = graphState.state;
  const ppCfg = { ...DEFAULT_WORKFLOW_CONFIG.postProcess, ...(config.postProcess ?? {}) };

  const deterministic = !!(config.publisher as any)?.deterministicMode;
  if (deterministic || !ppCfg.enableCommentHarvester) {
    return { state };
  }

  const publishedPostIds = ((state as any).publishedPostIds ?? []) as string[];
  if (publishedPostIds.length === 0) return { state };

  try {
    const harvest = await runCommentHarvester(ctx, state, config.commentHarvester);
    const notable = harvest.comments.filter((c) => c.isNotableQuote).slice(0, 5);

    let repliesCreated = 0;
    const fallbackPostId = publishedPostIds[publishedPostIds.length - 1] as unknown as Id<"narrativePosts">;

    const normalizeUrlForMatch = (url?: string): string | null => {
      if (!url) return null;
      try {
        const u = new URL(url);
        u.hash = "";
        u.search = "";
        const canonical = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/$/, "");
        return canonical.toLowerCase();
      } catch {
        return url.toLowerCase().replace(/\/$/, "");
      }
    };

    // Best-effort mapping: attach harvested replies to the most relevant published post
    // by matching comment parentUrl (or comment url) against post citation sourceUrls.
    const postIdByCanonicalUrl = new Map<string, Id<"narrativePosts">>();
    for (const postIdStr of publishedPostIds) {
      const postId = postIdStr as unknown as Id<"narrativePosts">;
      const post = await ctx.runQuery(api.domains.narrative.queries.posts.getPost, { postId });
      if (!post) continue;
      for (const c of post.citations ?? []) {
        const artifact = await ctx.runQuery(internal.domains.artifacts.sourceArtifacts.getArtifactById, {
          artifactId: c.artifactId,
        });
        const key = normalizeUrlForMatch((artifact as any)?.sourceUrl);
        if (key && !postIdByCanonicalUrl.has(key)) {
          postIdByCanonicalUrl.set(key, postId);
        }
      }
    }

    for (const c of notable) {
      const parentKey = normalizeUrlForMatch(c.parentUrl);
      const urlKey = normalizeUrlForMatch(c.url);
      const postId =
        (parentKey ? postIdByCanonicalUrl.get(parentKey) : undefined) ??
        (urlKey ? postIdByCanonicalUrl.get(urlKey) : undefined) ??
        fallbackPostId;

      const sourceType =
        c.source === "hacker_news" ? "hackernews" :
        c.source === "reddit" ? "reddit" :
        c.source === "twitter" ? "twitter" :
        "other";
      const sentiment =
        c.stance === "bullish" ? "positive" :
        c.stance === "bearish" ? "negative" :
        c.stance === "skeptical" ? "mixed" :
        "neutral";

      const sourceArtifact = await ctx.runMutation(
        internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact,
        {
          sourceType: "extracted_text",
          sourceUrl: c.url,
          rawContent: c.content,
          title: `${sourceType} comment`,
          extractedData: {
            kind: "harvested_comment",
            createdByAgent: "CommentHarvester",
            parentUrl: c.parentUrl,
            stance: c.stance,
            score: c.score,
            timestamp: c.timestamp,
          },
          fetchedAt: Date.now(),
        }
      );

      await ctx.runMutation(internal.domains.narrative.mutations.replies.createHarvestedReply, {
        postId,
        replyType: "evidence",
        content: c.content,
        evidenceArtifactIds: [sourceArtifact.id as any],
        sourceType,
        sourceUrl: c.url,
        sourceAuthor: c.author,
        sourceTimestamp: c.timestamp,
        sentiment,
        relevanceScore: 0.7,
        isHighSignal: true,
        harvesterAgent: "CommentHarvester",
      } as any);
      repliesCreated++;
    }

    return {
      state: {
        ...state,
        commentHarvestStats: {
          comments: harvest.comments.length,
          notableQuotes: notable.length,
          repliesCreated,
        },
      } as any,
    };
  } catch (e) {
    console.warn("[NewsroomWorkflow] Comment harvester failed (non-fatal):", e);
    return { state };
  }
}

async function correlationNode(
  graphState: NewsroomGraphState,
  config: NewsroomWorkflowConfig
): Promise<Partial<NewsroomGraphState>> {
  const ctx = graphState.actionCtx;
  if (!ctx) throw new Error("Action context not available");

  const state = graphState.state;
  const ppCfg = { ...DEFAULT_WORKFLOW_CONFIG.postProcess, ...(config.postProcess ?? {}) };

  const deterministic = !!(config.publisher as any)?.deterministicMode;
  if (deterministic || !ppCfg.enableCorrelations) {
    return { state };
  }

  try {
    const result = await ctx.runAction(
      internal.domains.narrative.mutations.correlations.detectCorrelationsForWeek,
      {
        weekNumber: state.weekNumber,
        minStrength: ppCfg.correlationMinStrength,
      }
    );
    return {
      state: {
        ...state,
        correlationStats: result,
      } as any,
    };
  } catch (e) {
    console.warn("[NewsroomWorkflow] Correlation detection failed (non-fatal):", e);
    return { state };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKFLOW GRAPH BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the Newsroom StateGraph
 *
 * Pipeline: Scout → Historian → Analyst → Curator → Publisher
 *
 * The Curator agent sits between Analyst and Publisher to:
 * 1. Decide how to handle each narrative shift (append, revise thesis, spawn thread)
 * 2. Enforce diff-first writing (what changed since last time)
 * 3. Ensure citation coverage for all claims
 * 4. Create social substrate posts for thread updates
 */
function buildNewsroomGraph(config: NewsroomWorkflowConfig) {
  const graph = new StateGraph(NewsroomAnnotation)
    .addNode("scout", (state) => scoutNode(state, config))
    .addNode("historian", (state) => historianNode(state, config))
    .addNode("analyst", (state) => analystNode(state, config))
    .addNode("curator", (state) => curatorNode(state, config))
    .addNode("publisher", (state) => publisherNode(state, config))
    .addNode("postprocess", (state) => postProcessNode(state, config))
    .addNode("commentHarvester", (state) => commentHarvesterNode(state, config))
    .addNode("correlations", (state) => correlationNode(state, config))
    // Linear pipeline: START → scout → historian → analyst → curator → publisher → END
    .addEdge(START, "scout")
    .addEdge("scout", "historian")
    .addEdge("historian", "analyst")
    .addEdge("analyst", "curator")
    .addEdge("curator", "publisher")
    .addEdge("publisher", "postprocess")
    .addEdge("postprocess", "commentHarvester")
    .addEdge("commentHarvester", "correlations")
    .addEdge("correlations", END);

  return graph.compile();
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVEX ACTION - RUN PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the complete Newsroom pipeline for a set of entities
 */
export const runPipeline = internalAction({
  args: {
    entityKeys: v.array(v.string()),
    weekNumber: v.optional(v.string()),
    focusTopics: v.optional(v.array(v.string())),
    userId: v.id("users"),
    workflowId: v.optional(v.string()),
    config: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<NewsroomWorkflowResult> => {
    const startTime = Date.now();
    const weekNumber = args.weekNumber || getCurrentWeekNumber();
    const workflowId =
      args.workflowId ||
      `drane_${weekNumber}_${startTime}_${Math.random().toString(36).slice(2, 8)}`;
    const baseConfig: NewsroomWorkflowConfig = {
      ...DEFAULT_WORKFLOW_CONFIG,
      ...(args.config || {}),
    };

    const effectiveToolReplayMode = baseConfig.toolReplayMode ?? "live";
    const effectiveToolReplayId =
      typeof baseConfig.toolReplayId === "string" && baseConfig.toolReplayId.trim().length > 0
        ? baseConfig.toolReplayId.trim()
        : workflowId;

    const config: NewsroomWorkflowConfig = {
      ...baseConfig,
      toolReplayMode: effectiveToolReplayMode,
      toolReplayId: effectiveToolReplayId,
      scout: {
        ...(baseConfig.scout ?? {}),
        toolReplayMode: (baseConfig.scout as any)?.toolReplayMode ?? effectiveToolReplayMode,
        toolReplayId: (baseConfig.scout as any)?.toolReplayId ?? effectiveToolReplayId,
      } as any,
      analyst: {
        ...(baseConfig.analyst ?? {}),
        toolReplayMode: (baseConfig.analyst as any)?.toolReplayMode ?? effectiveToolReplayMode,
        toolReplayId: (baseConfig.analyst as any)?.toolReplayId ?? effectiveToolReplayId,
      } as any,
      publisher: {
        ...(baseConfig.publisher ?? {}),
        toolReplayMode: (baseConfig.publisher as any)?.toolReplayMode ?? effectiveToolReplayMode,
        toolReplayId: (baseConfig.publisher as any)?.toolReplayId ?? effectiveToolReplayId,
      } as any,
    };

    const configHash = `cfg_${fnv1a32Hex(stableStringify(config))}`;

    console.log("═══════════════════════════════════════════════════════════════");
    console.log("[NewsroomWorkflow] Starting pipeline");
    console.log(`[NewsroomWorkflow] Entities: ${args.entityKeys.join(", ")}`);
    console.log(`[NewsroomWorkflow] Week: ${weekNumber}`);
    console.log("═══════════════════════════════════════════════════════════════");

    try {
      const deterministicMode = !!(config.publisher as any)?.deterministicMode;
      const deterministicNowMs = deterministicMode
        ? computeDeterministicNowMsFromConfig(weekNumber, config) ?? undefined
        : undefined;

      // Initialize state
      const initialState = createInitialNewsroomState(
        args.entityKeys,
        weekNumber,
        args.userId,
        args.focusTopics,
        workflowId,
        deterministicMode ? deterministicNowMs : undefined,
        deterministicNowMs
      );

      // Build and run the graph
      const compiledGraph = buildNewsroomGraph(config);

      const result = await compiledGraph.invoke({
        state: initialState,
        actionCtx: ctx,
      });

      const finalState = result.state;
      const durationMs = Date.now() - startTime;

      console.log("═══════════════════════════════════════════════════════════════");
      console.log("[NewsroomWorkflow] Pipeline complete");
      console.log(`[NewsroomWorkflow] Duration: ${durationMs}ms`);
      console.log("═══════════════════════════════════════════════════════════════");

      const published = {
        threadIds: finalState.publishedThreadIds ?? [],
        eventIds: finalState.publishedEventIds ?? [],
        stableEventIds: finalState.publishedEventStableIds ?? [],
        searchLogIds: finalState.persistedSearchLogIds ?? [],
        postIds: (finalState as any).publishedPostIds ?? [],
      };

      // Best-effort: persist a replay-friendly snapshot for audit/debugging.
      try {
        await ctx.runMutation(
          internal.domains.narrative.mutations.workflowTrace.saveNewsroomWorkflowSnapshot,
          {
            workflowId,
            weekNumber,
             entityKeys: args.entityKeys,
             fixtureId: finalState.fixtureId,
             config: args.config ?? null,
             configHash,
             codeVersion: getCodeVersion() ?? undefined,
             toolReplayMode: config.toolReplayMode ?? "live",
             deterministicNowMs: finalState.deterministicNowMs ?? deterministicNowMs,
             published: {
               threadDocIds: published.threadIds,
               eventDocIds: published.eventIds,
               stableEventIds: published.stableEventIds,
               searchLogIds: published.searchLogIds,
               postDocIds: (published as any).postIds ?? [],
             },
             dedupDecisions: finalState.dedupDecisions ?? [],
             stats: {
               newsItemsFound: finalState.weeklyNews.length,
               claimsRetrieved: finalState.historicalContext.length,
               existingThreads: finalState.existingThreads.length,
              shiftsDetected: finalState.narrativeShifts.length,
              narrativesPublished: finalState.generatedNarratives.length,
              searchesLogged: finalState.searchLogs.length,
              citationsGenerated: finalState.citations.size,
              verifiedEvents: (finalState as any).postProcessStats?.verifiedEvents,
              temporalFactsCreated: (finalState as any).postProcessStats?.temporalFactsCreated,
              contradictionsFound: (finalState as any).postProcessStats?.contradictionsFound,
              disputesCreated: (finalState as any).postProcessStats?.disputesCreated,
            },
            errors: finalState.errors,
          }
        );
      } catch (e) {
        console.warn("[NewsroomWorkflow] Snapshot persistence failed:", e);
      }

      // Best-effort: validate persisted outputs for this workflowId.
      let validation: NewsroomWorkflowResult["validation"] | undefined;
      try {
        const vres = await ctx.runAction(api.domains.narrative.tests.qaFramework.validateWorkflowRun, {
          workflowId,
        });
        validation = {
          passed: Boolean((vres as any).passed),
          metrics: (vres as any).metrics,
          errors: (vres as any).errors ?? [],
          warnings: (vres as any).warnings ?? [],
        };
      } catch (e) {
        console.warn("[NewsroomWorkflow] Validation failed (non-fatal):", e);
      }

      return {
        success: finalState.errors.length === 0,
        workflowId,
        weekNumber,
        entityKeys: args.entityKeys,
        validation,
        stats: {
          newsItemsFound: finalState.weeklyNews.length,
          claimsRetrieved: finalState.historicalContext.length,
          existingThreads: finalState.existingThreads.length,
          shiftsDetected: finalState.narrativeShifts.length,
          narrativesPublished: finalState.generatedNarratives.length,
          searchesLogged: finalState.searchLogs.length,
          citationsGenerated: finalState.citations.size,
          verifiedEvents: (finalState as any).postProcessStats?.verifiedEvents,
          temporalFactsCreated: (finalState as any).postProcessStats?.temporalFactsCreated,
          contradictionsFound: (finalState as any).postProcessStats?.contradictionsFound,
          disputesCreated: (finalState as any).postProcessStats?.disputesCreated,
        },
        published,
        errors: finalState.errors,
        durationMs,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[NewsroomWorkflow] Pipeline failed:", errorMsg);

      return {
        success: false,
        workflowId,
        weekNumber,
        entityKeys: args.entityKeys,
        stats: {
          newsItemsFound: 0,
          claimsRetrieved: 0,
          existingThreads: 0,
          shiftsDetected: 0,
          narrativesPublished: 0,
          searchesLogged: 0,
          citationsGenerated: 0,
        },
        published: { threadIds: [], eventIds: [], stableEventIds: [], searchLogIds: [], postIds: [] },
        errors: [errorMsg],
        durationMs: Date.now() - startTime,
      };
    }
  },
});

/**
 * Public action to run the Newsroom pipeline
 * Validates user authentication before running
 */
export const runNewsroomPipeline = action({
  args: {
    entityKeys: v.array(v.string()),
    weekNumber: v.optional(v.string()),
    focusTopics: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<NewsroomWorkflowResult> => {
    // Get authenticated user
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        success: false,
        weekNumber: args.weekNumber || getCurrentWeekNumber(),
        entityKeys: args.entityKeys,
        stats: {
          newsItemsFound: 0,
          claimsRetrieved: 0,
          existingThreads: 0,
          shiftsDetected: 0,
          narrativesPublished: 0,
          searchesLogged: 0,
          citationsGenerated: 0,
        },
        errors: ["Authentication required"],
        durationMs: 0,
      };
    }

    // Get user ID from identity (users table uses Convex Auth, lookup by email)
    const users = identity.email
      ? await ctx.runQuery(
          internal.domains.auth.users.getUserByEmail,
          { email: identity.email }
        )
      : null;

    if (!users) {
      return {
        success: false,
        weekNumber: args.weekNumber || getCurrentWeekNumber(),
        entityKeys: args.entityKeys,
        stats: {
          newsItemsFound: 0,
          claimsRetrieved: 0,
          existingThreads: 0,
          shiftsDetected: 0,
          narrativesPublished: 0,
          searchesLogged: 0,
          citationsGenerated: 0,
        },
        errors: ["User not found"],
        durationMs: 0,
      };
    }

    // Run the internal action
    return await ctx.runAction(
      internal.domains.narrative.newsroom.workflow.runPipeline,
      {
        entityKeys: args.entityKeys,
        weekNumber: args.weekNumber,
        focusTopics: args.focusTopics,
        userId: users._id,
      }
    );
  },
});
