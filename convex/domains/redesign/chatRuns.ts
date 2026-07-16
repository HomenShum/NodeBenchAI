/**
 * Real-LLM-backed chat for /redesign/chat — Phase 2 (streaming).
 *
 * Phase 2 architecture (Convex-native streaming, no HTTP SSE):
 *   1. Public mutation `startChat` inserts a `redesignChatRuns` row with
 *      status="pending", schedules the internal action, returns runId
 *      synchronously in <100ms.
 *   2. Internal action `runStreamingChat` runs the orchestrator stages
 *      (classify → context → Gemini call with grounding → bind), writing
 *      ordered events to `redesignChatStreamEvents` as each stage finishes.
 *   3. Internal action calls Gemini's `streamGenerateContent` endpoint and
 *      writes "scratchpad" events for each text chunk + "grounding_chunk"
 *      events as URLs arrive.
 *   4. Public query `streamEventsForRun` (used by `useRedesignChatRun`
 *      via Convex reactive subscription) re-runs whenever new events land,
 *      giving the frontend live progress without a single SSE byte.
 *   5. Public query `getRun` returns the run row (final packet once
 *      status="complete"). Subscribed by the same hook.
 *
 * Phase 3 (future PR): GET /redesign/chat/r/{hash} route reads
 * `redesignChatRuns by_hash` and renders the immutable answer.
 *
 * Phase 4 (future PR): probe re-run with masked source, real
 * proposeMemoryPatch on inline correction, source-URL substring
 * validation, production load polish.
 *
 * Release safety: live runs call paid model/search infrastructure. Guests can
 * read public artifacts, but starting or reading a live run requires the
 * owning non-anonymous account. Public sharing remains hash-based.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  decideLiveGrounding,
  type LiveGroundingDecision,
} from "../../../shared/redesign/contextRuntimePolicy";
import { classifyPrompt } from "../../../shared/redesign/promptClassifier";
import {
  classifyEvidenceVerification,
  type EvidenceVerificationState,
} from "../../../shared/redesign/sourceVerificationPolicy";
import { extractBankReconciliationFact } from "../../../shared/redesign/bankReconciliationFactExtractor";

// ───────── Types ─────────

type EvidenceRow = {
  idx: number;
  quote: string;
  source: string;
  sourceProvider?: string;
  verificationState?: EvidenceVerificationState;
  verificationDetail?: string;
  blocking?: boolean;
};
type TraceRow = {
  step: string;
  detail: string;
  status: "ok" | "warn" | "info" | "error";
  durationMs: number;
};

interface AnswerPacket {
  shortAnswer: string;
  whyItMatters: string;
  evidence: EvidenceRow[];
  risks: string[];
  nextAction: string;
  sourceCount: number;
  paidCalls: number;
  fromMemory: boolean;
  trace: TraceRow[];
}

type PlannerArtifact = {
  id: string;
  label: string;
  status: "selected" | "candidate" | "deferred" | "pending" | "complete" | "blocked";
  detail: string;
  confidence?: number;
  riskTier?: "low" | "medium" | "high";
  costUsd?: number;
};

type ContextRefDescription = {
  hasContext: boolean;
  raw: string | null;
  reportId: string | null;
  artifactKey: string | null;
  kind: "graph_packet" | "report" | "none";
  label: string;
};

type RuntimeSourceRef = {
  title: string;
  url?: string;
  source?: string;
  publishedAt?: string;
  excerpt?: string;
};

type RuntimeContextPacket = {
  hasContext: boolean;
  contextRef: string | null;
  contextKind: "graph_packet" | "report" | "none";
  reportId: string | null;
  artifactKey: string | null;
  title: string;
  summary: string;
  selectedContext: string[];
  rejectedContext: string[];
  sourceRefs: RuntimeSourceRef[];
  graph: {
    mode: "bounded_packet";
    nodeCount: number;
    edgeCount: number;
    clusters: Array<{ name: "used" | "changed" | "needs_review" | "blocked"; count: number; sample: string[] }>;
  };
  notebook: {
    sectionTitles: string[];
    htmlPreview?: string;
  };
  verification: {
    tier: "deterministic" | "retrieval" | "judge_required";
    decisions: string[];
  };
  telemetry: {
    memoryHit: boolean;
    sourceCacheHit: boolean;
    candidateCount: number;
  };
};

// ───────── Constants ─────────

const MAX_PROMPT_CHARS = 4_000;
const TIMEOUT_MS = 45_000;
const FALLBACK_SOURCE_TIMEOUT_MS = 12_000;
const FALLBACK_SOURCE_LIMIT = 5;

async function requirePaidChatUserId(ctx: any): Promise<any> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Sign in with an account before running live research.");
  }
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q: any) => q.eq("userId", userId))
    .collect();
  const hasNonAnonymousAccount = accounts.some((account: any) => account.provider !== "anonymous");
  if (!hasNonAnonymousAccount) {
    throw new Error("Live research requires a non-anonymous account. Sign in with email before running paid agent work.");
  }
  return userId;
}

async function assertRunReadable(ctx: any, runId: string): Promise<any> {
  const row = await ctx.db
    .query("redesignChatRuns")
    .withIndex("by_runId", (q: any) => q.eq("runId", runId))
    .first();
  if (!row) throw new Error("Run not found");
  const userId = await getAuthUserId(ctx);
  if (!userId || !row.userId || row.userId !== userId) {
    throw new Error("Run is private or unavailable.");
  }
  return row;
}

function redactSharedRun(row: any): any {
  if (!row) return null;
  const {
    userId: _userId,
    clientRequestId: _clientRequestId,
    cancelRequestedAt: _cancelRequestedAt,
    ...safeRow
  } = row;
  return safeRow;
}

// ───────── Helpers ─────────

/** Deterministic hash for reproducibility URL — stable across deploys. */
function answerHash(payload: {
  prompt: string;
  tier: string;
  model: string;
  shortAnswer: string;
  evidenceUrls: string[];
}): string {
  const sorted = [...payload.evidenceUrls].sort().join("\n");
  const seed = `${payload.model}|${payload.tier}|${payload.prompt}|${payload.shortAnswer}|${sorted}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2654435761) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 12);
}

function generateRunId(): string {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

type NormalizedChatTier = "free" | "fast" | "auto" | "deep";

function normalizeChatTier(tier: string): NormalizedChatTier {
  if (tier === "free" || tier === "fast" || tier === "auto" || tier === "deep") return tier;
  if (tier === "answer") return "fast";
  if (tier === "compare") return "deep";
  return "auto";
}

export function modelForTier(tier: string): string {
  const normalized = normalizeChatTier(tier);
  if (normalized === "deep") return "gemini-3.1-pro-preview";
  if (normalized === "free") return "gemini-3.1-flash-lite";
  return "gemini-3.5-flash";
}

export function pricingForModel(model: string): { inputUsdPer1m: number; outputUsdPer1m: number } {
  if (model === "gemini-3.5-flash") return { inputUsdPer1m: 1.5, outputUsdPer1m: 9 };
  if (model === "gemini-3.1-pro-preview") return { inputUsdPer1m: 2, outputUsdPer1m: 12 };
  if (model === "gemini-3.1-flash-lite") return { inputUsdPer1m: 0.25, outputUsdPer1m: 1.5 };
  // Unknown models must not inherit a misleading paid estimate.
  return { inputUsdPer1m: 0, outputUsdPer1m: 0 };
}

type FallbackSourceSnippet = {
  url: string;
  title: string;
  snippet: string;
  provider: "linkup";
};

function clipText(input: unknown, max: number): string {
  const text = typeof input === "string" ? input.replace(/\s+/g, " ").trim() : "";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

async function runFallbackSourceSearch(query: string): Promise<{
  snippets: FallbackSourceSnippet[];
  detail: string;
}> {
  const apiKey = process.env.LINKUP_API_KEY;
  if (!apiKey) {
    return { snippets: [], detail: "LINKUP_API_KEY not configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FALLBACK_SOURCE_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.linkup.so/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        depth: "standard",
        outputType: "searchResults",
        includeImages: false,
        maxResults: FALLBACK_SOURCE_LIMIT,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return {
        snippets: [],
        detail: `linkup_http_${res.status}: ${clipText(errText, 160)}`,
      };
    }

    const json = await res.json() as {
      results?: Array<{
        type?: string;
        url?: string;
        name?: string;
        content?: string;
      }>;
    };
    const seen = new Set<string>();
    const snippets = (json.results ?? [])
      .filter((row) => row?.type === "text" && typeof row.url === "string" && row.url.startsWith("http"))
      .filter((row) => {
        const url = row.url!;
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      })
      .slice(0, FALLBACK_SOURCE_LIMIT)
      .map((row): FallbackSourceSnippet => ({
        url: row.url!,
        title: clipText(row.name ?? row.url, 160) || row.url!,
        snippet: clipText(row.content, 600) || `Search result from ${row.url}`,
        provider: "linkup",
      }));

    return {
      snippets,
      detail: `${snippets.length} Linkup source results`,
    };
  } catch (err: any) {
    return {
      snippets: [],
      detail: err?.name === "AbortError" ? "linkup_timeout" : clipText(err?.message ?? err, 160),
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeContextRef(contextRef?: string): ContextRefDescription {
  if (!contextRef) {
    return {
      hasContext: false,
      raw: null,
      reportId: null,
      artifactKey: null,
      kind: "none",
      label: "No active context",
    };
  }
  if (contextRef.startsWith("graphctx:")) {
    const body = contextRef.slice("graphctx:".length);
    const artifactMarker = "::artifact:";
    const artifactIndex = body.indexOf(artifactMarker);
    const rawReportId = artifactIndex >= 0 ? body.slice(0, artifactIndex) : body;
    const rawArtifactKey = artifactIndex >= 0 ? body.slice(artifactIndex + artifactMarker.length) : null;
    let artifactKey: string | null = rawArtifactKey;
    if (rawArtifactKey) {
      try {
        artifactKey = decodeURIComponent(rawArtifactKey);
      } catch {
        artifactKey = rawArtifactKey;
      }
    }
    return {
      hasContext: true,
      raw: contextRef,
      reportId: rawReportId || null,
      artifactKey,
      kind: "graph_packet",
      label: `Graph context packet ${rawReportId}${artifactKey ? ` / ${artifactKey}` : ""}`,
    };
  }
  return {
    hasContext: true,
    raw: contextRef,
    reportId: contextRef,
    artifactKey: null,
    kind: "report",
    label: `Active report ${contextRef}`,
  };
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function normalizeForContext(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function firstMeaningfulLine(value: unknown): string {
  const text = String(value ?? "");
  return text
    .split(/\r?\n/)
    .map((line) => normalizeForContext(line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "")))
    .find(Boolean) ?? "";
}

function recordArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  }) : [];
}

function collectRuntimeSourceRefs(value: unknown, max = 12): RuntimeSourceRef[] {
  const refs: RuntimeSourceRef[] = [];
  const seen = new Set<string>();
  const visit = (item: unknown) => {
    if (refs.length >= max || item == null) return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    const record = asRecord(item);
    if (!record) return;
    const url = typeof record.url === "string"
      ? record.url
      : typeof record.href === "string"
        ? record.href
        : undefined;
    const title = normalizeForContext(record.title ?? record.headline ?? record.source ?? record.sourceDomain ?? "");
    const source = normalizeForContext(record.source ?? record.sourceDomain ?? record.domain ?? "");
    if (url || title || source) {
      const key = normalizeForContext(url ?? `${title}|${source}`).toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        refs.push({
          title: clipText(title || source || url || "Source reference", 120),
          url,
          source: source || undefined,
          publishedAt: typeof record.publishedAt === "string"
            ? record.publishedAt
            : typeof record.publishedAtIso === "string"
              ? record.publishedAtIso
              : undefined,
          excerpt: normalizeForContext(record.relevance ?? record.excerpt ?? record.snippet ?? record.summary ?? "").slice(0, 220) || undefined,
        });
      }
      return;
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return refs;
}

function emptyRuntimeContextPacket(context: ContextRefDescription): RuntimeContextPacket {
  return {
    hasContext: context.hasContext,
    contextRef: context.raw,
    contextKind: context.kind,
    reportId: context.reportId,
    artifactKey: context.artifactKey,
    title: context.label,
    summary: context.hasContext
      ? "Context reference was supplied but no matching Convex record was resolved."
      : "No selected report, entity, or graph packet was attached.",
    selectedContext: [],
    rejectedContext: context.hasContext ? ["No canonical Convex record matched the supplied context reference."] : [],
    sourceRefs: [],
    graph: {
      mode: "bounded_packet",
      nodeCount: 0,
      edgeCount: 0,
      clusters: [
        { name: "used", count: 0, sample: [] },
        { name: "changed", count: 0, sample: [] },
        { name: "needs_review", count: 0, sample: [] },
        { name: "blocked", count: context.hasContext ? 1 : 0, sample: context.hasContext ? ["Context record unresolved."] : [] },
      ],
    },
    notebook: { sectionTitles: [] },
    verification: {
      tier: context.hasContext ? "retrieval" : "deterministic",
      decisions: context.hasContext
        ? ["Require live retrieval before treating this context as memory-backed."]
        : ["Prompt-only run; no report memory loaded."],
    },
    telemetry: {
      memoryHit: false,
      sourceCacheHit: false,
      candidateCount: 0,
    },
  };
}

export const resolveContextRuntimePacket = internalQuery({
  args: { contextRef: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args): Promise<RuntimeContextPacket> => {
    const context = describeContextRef(args.contextRef);
    if (!context.hasContext || !context.reportId) return emptyRuntimeContextPacket(context);

    if (context.reportId.startsWith("daily_")) {
      const memoryId = (ctx.db as any).normalizeId("dailyBriefMemories", context.reportId.slice("daily_".length));
      const memory = memoryId ? await ctx.db.get(memoryId) as any : null;
      if (!memory) return emptyRuntimeContextPacket(context);
      const memoryContext = asRecord(memory.context) ?? {};
      const executiveRecord = asRecord(memoryContext.executiveBriefRecord);
      const brief = asRecord(executiveRecord?.brief) ?? asRecord(memoryContext.executiveBrief) ?? {};
      const actI = asRecord(brief.actI) ?? {};
      const actII = asRecord(brief.actII) ?? {};
      const actIII = asRecord(brief.actIII) ?? {};
      const meta = asRecord(brief.meta) ?? {};
      const signals = recordArray(actII.signals);
      const actions = recordArray(actIII.actions);
      const features = Array.isArray(memory.features) ? memory.features as any[] : [];
      const sourceRefs = collectRuntimeSourceRefs({ brief, features }, 12);
      const changedSamples = signals
        .map((signal) => normalizeForContext(signal.headline ?? signal.title ?? signal.synthesis))
        .filter(Boolean)
        .slice(0, 5);
      const actionSamples = actions
        .map((action) => normalizeForContext(action.title ?? action.action ?? action.summary ?? action.description))
        .filter(Boolean)
        .slice(0, 5);
      const blockedSamples = features
        .filter((feature) => feature?.status && feature.status !== "passing")
        .map((feature) => normalizeForContext(feature.name ?? feature.testCriteria))
        .filter(Boolean)
        .slice(0, 5);
      const summary = normalizeForContext(meta.summary ?? actI.synthesis ?? memory.goal ?? "Daily brief report context.");
      const sectionTitles = [
        actI.synthesis ? "What changed" : null,
        signals.length ? "Signals" : null,
        actions.length ? "Actions" : null,
        sourceRefs.length ? "Sources" : null,
      ].filter(Boolean) as string[];

      return {
        hasContext: true,
        contextRef: context.raw,
        contextKind: context.kind,
        reportId: context.reportId,
        artifactKey: context.artifactKey,
        title: `Daily Brief - ${memory.dateString}`,
        summary: clipText(summary, 360),
        selectedContext: [
          `Daily Brief ${memory.dateString}: ${clipText(summary, 240)}`,
          ...changedSamples.map((item) => `Changed: ${clipText(item, 180)}`),
          ...actionSamples.map((item) => `Action: ${clipText(item, 180)}`),
          context.artifactKey ? `Selected artifact: ${context.artifactKey}` : "",
        ].filter(Boolean).slice(0, 12),
        rejectedContext: blockedSamples.map((item) => `Needs review before write: ${clipText(item, 160)}`),
        sourceRefs,
        graph: {
          mode: "bounded_packet",
          nodeCount: 1 + signals.length + actions.length + sourceRefs.length,
          edgeCount: signals.length + actions.length + sourceRefs.length,
          clusters: [
            { name: "used", count: sourceRefs.length, sample: sourceRefs.slice(0, 3).map((ref) => ref.title) },
            { name: "changed", count: signals.length, sample: changedSamples.slice(0, 3) },
            { name: "needs_review", count: Math.max(blockedSamples.length, actions.length), sample: [...blockedSamples, ...actionSamples].slice(0, 3) },
            { name: "blocked", count: blockedSamples.length, sample: blockedSamples.slice(0, 3) },
          ],
        },
        notebook: {
          sectionTitles,
          htmlPreview: summary ? `<p>${clipText(summary, 220)}</p>` : undefined,
        },
        verification: {
          tier: blockedSamples.length > 0 ? "judge_required" : sourceRefs.length > 0 ? "retrieval" : "deterministic",
          decisions: [
            sourceRefs.length > 0
              ? `Loaded ${sourceRefs.length} source refs from Convex memory.`
              : "No source refs found in the memory packet.",
            blockedSamples.length > 0
              ? `${blockedSamples.length} memory features need review before notebook writes.`
              : "No failing memory features detected in this bounded packet.",
          ],
        },
        telemetry: {
          memoryHit: true,
          sourceCacheHit: sourceRefs.length > 0,
          candidateCount: 1 + signals.length + actions.length + sourceRefs.length,
        },
      };
    }

    if (context.reportId.startsWith("li_")) {
      const postId = (ctx.db as any).normalizeId("linkedinPostArchive", context.reportId.slice("li_".length));
      const post = postId ? await ctx.db.get(postId) as any : null;
      if (!post) return emptyRuntimeContextPacket(context);
      const metadata = asRecord(post.metadata) ?? {};
      const sourceRefs = collectRuntimeSourceRefs(metadata.sourcesUsed ?? metadata.sourceRefs ?? metadata.sources, 12);
      const title = firstMeaningfulLine(post.content) || `${post.postType ?? "Archive"} - ${post.dateString}`;
      const summary = clipText(normalizeForContext(post.content), 360);

      return {
        hasContext: true,
        contextRef: context.raw,
        contextKind: context.kind,
        reportId: context.reportId,
        artifactKey: context.artifactKey,
        title: clipText(title, 140),
        summary,
        selectedContext: [
          `Archive report ${post.dateString}: ${clipText(title, 180)}`,
          clipText(summary, 280),
          context.artifactKey ? `Selected artifact: ${context.artifactKey}` : "",
        ].filter(Boolean),
        rejectedContext: [],
        sourceRefs,
        graph: {
          mode: "bounded_packet",
          nodeCount: 1 + sourceRefs.length,
          edgeCount: sourceRefs.length,
          clusters: [
            { name: "used", count: sourceRefs.length, sample: sourceRefs.slice(0, 3).map((ref) => ref.title) },
            { name: "changed", count: 1, sample: [clipText(title, 120)] },
            { name: "needs_review", count: sourceRefs.length === 0 ? 1 : 0, sample: sourceRefs.length === 0 ? ["No source refs in archive metadata."] : [] },
            { name: "blocked", count: 0, sample: [] },
          ],
        },
        notebook: {
          sectionTitles: ["Archive summary", "Evidence", "Next action"],
          htmlPreview: `<p>${clipText(summary, 220)}</p>`,
        },
        verification: {
          tier: sourceRefs.length > 0 ? "retrieval" : "deterministic",
          decisions: [
            sourceRefs.length > 0
              ? `Loaded ${sourceRefs.length} archive source refs.`
              : "Archive context loaded without explicit source refs.",
          ],
        },
        telemetry: {
          memoryHit: true,
          sourceCacheHit: sourceRefs.length > 0,
          candidateCount: 1 + sourceRefs.length,
        },
      };
    }

    return emptyRuntimeContextPacket(context);
  },
});

function buildBoardState(args: {
  runId: string;
  prompt: string;
  tier: string;
  model: string;
  contextRef?: string;
  classification: { kind: string; entity?: string };
  runtimeContext: RuntimeContextPacket;
  liveGrounding: LiveGroundingDecision;
}): {
  boardState: Record<string, unknown>;
  contextCandidates: PlannerArtifact[];
  toolDecisions: PlannerArtifact[];
} {
  const entityLabel = args.classification.entity ?? "unresolved entity";
  const context = describeContextRef(args.contextRef);
  const hasReportContext = context.hasContext;
  const contextResolved = args.runtimeContext.telemetry.memoryHit;
  const liveGroundingStatus = args.liveGrounding.useLiveGrounding ? "selected" : "deferred";
  const contextCandidates: PlannerArtifact[] = [
    {
      id: "user_prompt",
      label: "User prompt",
      status: "selected",
      confidence: 1,
      detail: clipText(args.prompt, 180),
    },
    {
      id: "active_report",
      label: hasReportContext ? context.label : "Active report",
      status: contextResolved ? "selected" : hasReportContext ? "blocked" : "deferred",
      confidence: contextResolved ? 0.9 : hasReportContext ? 0.35 : 0,
      detail: hasReportContext
        ? contextResolved
          ? `Resolved ${args.runtimeContext.title} from Convex memory.`
          : `Composer supplied ${context.raw}, but no canonical Convex record resolved.`
        : "No active report reference was supplied, so the run stays answer-first.",
    },
    {
      id: "graph_context_packet",
      label: hasReportContext ? `Graph context for ${context.reportId ?? context.raw}` : "Graph context packet",
      status: contextResolved ? "selected" : hasReportContext ? "blocked" : "deferred",
      confidence: contextResolved ? 0.84 : hasReportContext ? 0.25 : 0,
      detail: hasReportContext
        ? contextResolved
          ? `${args.runtimeContext.graph.nodeCount} nodes, ${args.runtimeContext.graph.edgeCount} edges, ${args.runtimeContext.sourceRefs.length} source refs packed.`
          : "Graph packet could not be packed because the selected context did not resolve."
        : "No report context was supplied, so graph context stays on demand.",
    },
    {
      id: "context_runtime_packet",
      label: "ContextRuntimePacket",
      status: contextResolved ? "selected" : hasReportContext ? "blocked" : "deferred",
      confidence: contextResolved ? 0.86 : hasReportContext ? 0.3 : 0,
      detail: hasReportContext
        ? contextResolved
          ? `${args.runtimeContext.selectedContext.length} selected snippets, ${args.runtimeContext.rejectedContext.length} rejected/blocked snippets, ${args.runtimeContext.verification.tier} verification.`
          : "ContextRuntimePacket exists only as an unresolved reference for this run."
        : "No selected report/entity, so the packet starts from prompt-only recall lanes.",
    },
    {
      id: "entity_mention",
      label: entityLabel,
      status: args.classification.entity ? "candidate" : "deferred",
      confidence: args.classification.entity ? 0.72 : 0,
      detail: args.classification.entity
        ? `Classifier detected ${args.classification.kind}.`
        : "Prompt did not expose a stable entity name.",
    },
  ];

  const toolDecisions: PlannerArtifact[] = [
    {
      id: "search_memory",
      label: "search_memory",
      status: contextResolved ? "selected" : hasReportContext ? "blocked" : "deferred",
      riskTier: "low",
      costUsd: 0,
      detail: contextResolved
        ? `Used selected memory packet: ${args.runtimeContext.title}.`
        : hasReportContext
        ? "Selected context reference did not resolve to memory."
        : "No report context to search in this anonymous/public run.",
    },
    {
      id: "resolve_report_graph_context",
      label: "resolve_report_graph_context",
      status: contextResolved ? "selected" : hasReportContext ? "blocked" : "deferred",
      riskTier: "low",
      costUsd: 0,
      detail: contextResolved
        ? `Packed bounded graph clusters: ${args.runtimeContext.graph.clusters.map((cluster) => `${cluster.name}:${cluster.count}`).join(", ")}.`
        : hasReportContext
        ? "Graph context was requested but not resolvable."
        : "Requires a selected report/context reference.",
    },
    {
      id: "google_search_grounding",
      label: "google_search grounding",
      status: liveGroundingStatus,
      riskTier: "medium",
      costUsd: args.liveGrounding.useLiveGrounding ? undefined : 0,
      detail: args.liveGrounding.reason,
    },
    {
      id: "verify_sources",
      label: "verify_sources",
      status: "pending",
      riskTier: "low",
      costUsd: 0,
      detail: "Source URL substring validation is scheduled after packet assembly.",
    },
    {
      id: "patch_notebook",
      label: "patch_notebook",
      status: "deferred",
      riskTier: "medium",
      costUsd: 0,
      detail: "Notebook writes require an explicit user action from the answer packet.",
    },
  ];

  return {
    boardState: {
      runId: args.runId,
      surface: "redesign_chat",
      goal: "answer_with_cited_research_and_action_trace",
      status: "running",
      promptKind: args.classification.kind,
      entity: args.classification.entity ?? null,
      tier: args.tier,
      model: args.model,
      targetReport: context.reportId,
      contextRef: context.raw,
      contextKind: context.kind,
      successCriteria: [
        "classify intent",
        "select available memory/context",
        "resolve bounded report graph context",
        "ground answer in sources",
        "bind evidence rows",
        "schedule source validation",
        "emit cost and latency",
      ],
    },
    contextCandidates,
    toolDecisions,
  };
}

export interface ParsedMemo {
  shortAnswer: string;
  whyItMatters: string;
  risks: string[];
  nextAction: string;
}

export type RequestedResponseShape =
  | { kind: "memo" }
  | { kind: "title_only" }
  | { kind: "bullets"; count: number };

const RESPONSE_COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const SOURCE_NEEDED_LIMITATION =
  "Source needed: no supported URL is available, so source-strength and claim-strength comparisons are unverified.";

function parseRequestedCount(value: string): number | null {
  const count = /^\d+$/.test(value) ? Number(value) : RESPONSE_COUNT_WORDS[value.toLowerCase()];
  return Number.isInteger(count) && count >= 1 && count <= 12 ? count : null;
}

export function detectRequestedResponseShape(prompt: string): RequestedResponseShape {
  const normalized = prompt.replace(/\s+/g, " ").trim().toLowerCase();
  if (
    /\btitle[- ]only\b/.test(normalized)
    || /\b(?:only|just) (?:give|return|output|provide|write|respond with)?\s*(?:me )?(?:a |the )?title\b/.test(normalized)
    || /\b(?:give|return|output|provide|write|respond with) (?:me )?(?:a |the )?title only\b/.test(normalized)
  ) {
    return { kind: "title_only" };
  }

  const bulletMatch = normalized.match(
    /\b(?:exactly|in|as|using|give(?: me)?|return|output|provide|write)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:concise\s+|short\s+)?(?:bullet(?:\s+points?)?|bullets)\b/,
  );
  const count = bulletMatch ? parseRequestedCount(bulletMatch[1]) : null;
  return count ? { kind: "bullets", count } : { kind: "memo" };
}

function sourceUrl(source: string): string | null {
  const match = source.match(/https?:\/\/[^\s)>\]]+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0].replace(/[.,;:]+$/, ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function urlsInText(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s)>\]]+/gi)].flatMap((match) => {
    const url = sourceUrl(match[0]);
    return url ? [url] : [];
  });
}

function sanitizeUnsupportedSuperlatives(text: string): string {
  return text.replace(
    /\b(?:best|strongest)\s+(?:(?:supported|grounded|available)\s+)?(?:source|claim|evidence)\b/gi,
    "source or claim requiring verification",
  );
}

function compactResponseUnit(text: string, stripCitations = false): string {
  const compact = text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 $2")
    .replace(/^\s*(?:#{1,6}|[-*•]|\d+[.)])\s*/, "")
    .replace(/^\*\*(.+?)\*\*:?$/, "$1")
    .replace(stripCitations ? /\s*\[\d+\]/g : /$^/, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return compact.replace(/[.!?]+$/, "").slice(0, 600);
}

function responseUnits(parsed: ParsedMemo, stripCitations: boolean): string[] {
  const values = [
    parsed.shortAnswer,
    parsed.whyItMatters,
  ];
  const seen = new Set<string>();
  const units: string[] = [];
  for (const value of values) {
    for (const part of value.split(/\n+|(?<=[.!?])\s+/)) {
      const unit = compactResponseUnit(part, stripCitations);
      const key = unit.toLowerCase();
      if (!unit || seen.has(key)) continue;
      seen.add(key);
      units.push(unit);
    }
  }
  return units;
}

function isCleanCompactUnit(unit: string): boolean {
  if (!unit) return false;
  return !/(?:search\.cloud\.google\.com\/grounding-api-redirect|\[!\[|跳至主要內容|jump to main content|<\/?[a-z][^>]*>)/i.test(unit);
}

function requiresUrlInEveryBullet(prompt: string): boolean {
  return /\beach\s+bullet\b[^.]{0,100}\b(?:url|link)\b|\b(?:url|link)\b[^.]{0,100}\beach\s+bullet\b/i.test(prompt);
}

export function applyDeterministicResponsePolicy(
  prompt: string,
  parsed: ParsedMemo,
  evidence: Array<{
    source: string;
    quote?: string;
    blocking?: boolean;
    verificationState?: EvidenceVerificationState;
  }>,
): ParsedMemo {
  const supportedUrls = evidence.flatMap((row) => {
    const url = sourceUrl(row.source);
    return url
      && row.blocking !== true
      && row.verificationState !== "unsupported"
      && row.verificationState !== "fetch_blocked"
      ? [url]
      : [];
  });
  const requestedUrls = urlsInText(prompt);
  // Grounding providers commonly return an opaque redirect even when the
  // user supplied the canonical source. Keep the provider URL in evidence,
  // but display the requested canonical URL in an explicit URL contract.
  const hasSupportedUrl = supportedUrls.length > 0;
  const primarySupportedUrl = hasSupportedUrl
    ? requestedUrls[0] ?? supportedUrls[0]
    : null;
  const honest: ParsedMemo = hasSupportedUrl
    ? parsed
    : {
        shortAnswer: sanitizeUnsupportedSuperlatives(parsed.shortAnswer),
        whyItMatters: sanitizeUnsupportedSuperlatives(parsed.whyItMatters),
        risks: [
          ...parsed.risks.map(sanitizeUnsupportedSuperlatives).filter((risk) => risk !== SOURCE_NEEDED_LIMITATION),
          SOURCE_NEEDED_LIMITATION,
        ],
        nextAction: "Add a supported source URL before selecting or promoting any claim.",
      };

  const shape = detectRequestedResponseShape(prompt);
  if (shape.kind === "memo") return honest;

  if (shape.kind === "title_only") {
    const title = (compactResponseUnit(honest.shortAnswer || honest.whyItMatters, true) || "Evidence review").slice(0, 240);
    return {
      shortAnswer: hasSupportedUrl ? title : `Source needed: ${title}`.slice(0, 240),
      whyItMatters: "",
      risks: [],
      nextAction: "",
    };
  }

  const mustIncludeUrl = primarySupportedUrl !== null && requiresUrlInEveryBullet(prompt);
  const candidates = responseUnits(honest, mustIncludeUrl)
    .filter((unit) => unit !== SOURCE_NEEDED_LIMITATION && isCleanCompactUnit(unit));
  const bullets = hasSupportedUrl
    ? candidates.slice(0, shape.count)
    : candidates.slice(0, Math.max(0, shape.count - 1));
  while (bullets.length < shape.count - (hasSupportedUrl ? 0 : 1)) {
    bullets.push("The run did not return another clean supported detail; review the source directly");
  }
  if (!hasSupportedUrl) bullets.push(SOURCE_NEEDED_LIMITATION);
  while (bullets.length < shape.count) {
    bullets.push("The run did not return another clean supported detail; review the source directly");
  }
  const renderedBullets = bullets.slice(0, shape.count).map((bullet) =>
    mustIncludeUrl
      ? `${bullet
          .replace(/\s*\(?https?:\/\/[^\s)]+\)?/gi, "")
          .replace(/\s*[:;,]\s*$/, "")
          .trim()}: ${primarySupportedUrl}`
      : bullet,
  );
  return {
    shortAnswer: renderedBullets.map((bullet) => `- ${bullet}`).join("\n"),
    whyItMatters: "",
    risks: [],
    nextAction: "",
  };
}

export function parseMemo(text: string): ParsedMemo {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const sections: Record<string, string[]> = { short: [], why: [], evidence: [], risks: [], next: [] };
  let current: keyof typeof sections | null = null;
  for (const line of lines) {
    const lower = line
      .replace(/^#+\s*/, "")
      .replace(/^\*\*(.+?)\*\*:?$/, "$1")
      .replace(/^\d+[\).\s-]+/, "")
      .toLowerCase();
    if (/^short answer\b/.test(lower) || /^short\b/.test(lower)) { current = "short"; continue; }
    if (/^why\b/.test(lower)) { current = "why"; continue; }
    if (/^evidence\b/.test(lower)) { current = "evidence"; continue; }
    if (/^risks?\b/.test(lower) || /^unknowns?\b/.test(lower)) { current = "risks"; continue; }
    if (/^next action\b/.test(lower) || /^next\b/.test(lower)) { current = "next"; continue; }
    if (current) sections[current].push(line.replace(/^[-*•]\s*/, ""));
  }
  const fallbackLines = lines.filter((line) => !/^\*\*(to|from|date|subject):\*\*/i.test(line));
  // Keep enough of an unheaded compact response to preserve a complete URL.
  // The response-shape policy applies the final presentation limit later.
  const shortAnswer = sections.short.join(" ").trim() || (fallbackLines[0] ?? "").slice(0, 800);
  const whyItMatters = sections.why.join(" ").trim() || (fallbackLines[1] ?? "").slice(0, 480);
  const risks = sections.risks.length > 0
    ? sections.risks.slice(0, 4)
    : ["Grounded sources may not reflect the very latest events — re-run before any irreversible action."];
  const nextAction = sections.next[0] || "Review the evidence rows before promoting a claim into the active report.";
  return { shortAnswer, whyItMatters, risks, nextAction };
}

// ───────── Public mutations / queries ─────────

/**
 * Public mutation: kick off a streaming chat run. Returns the runId
 * immediately (typically <100ms) so the frontend can subscribe to
 * `streamEventsForRun(runId)` for live progress.
 */
export const startChat = mutation({
  args: {
    prompt: v.string(),
    /** Stable per user submission. Replays return the original run. */
    clientRequestId: v.optional(v.string()),
    tier: v.union(
      v.literal("free"),
      v.literal("fast"),
      v.literal("auto"),
      v.literal("deep"),
      v.literal("answer"),
      v.literal("compare"),
    ),
    contextRef: v.optional(v.string()),
    /** Phase 5 — pinned claims from prior turns to carry forward as hard
     *  context. Each item: short text + optional source URL. Server prepends
     *  these to the system prompt so the next answer respects them. */
    pinnedClaims: v.optional(v.array(v.object({
      text: v.string(),
      source: v.optional(v.string()),
    }))),
    /** Phase 5 — counterfactual probe. When set, the run is a probe
     *  re-evaluation of an earlier run with the cited source masked. */
    probeOriginRunId: v.optional(v.string()),
    probeMaskedSourceUrl: v.optional(v.string()),
    probeMaskedSourceIdx: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<string> => {
    const prompt = args.prompt.slice(0, MAX_PROMPT_CHARS);
    if (prompt.trim().length < 3) {
      throw new Error("Prompt too short — write at least a 3-character question.");
    }
    const userId = await requirePaidChatUserId(ctx);
    const clientRequestId = args.clientRequestId?.trim().slice(0, 160);
    if (clientRequestId) {
      const existing = await ctx.db
        .query("redesignChatRuns")
        .withIndex("by_user_client_request", (q) =>
          q.eq("userId", userId).eq("clientRequestId", clientRequestId),
        )
        .first();
      if (existing) return existing.runId;
    }
    const normalizedTier = normalizeChatTier(args.tier);
    const model = modelForTier(normalizedTier);
    const runId = generateRunId();
    await ctx.db.insert("redesignChatRuns", {
      runId,
      ...(clientRequestId ? { clientRequestId } : {}),
      userId,
      prompt,
      tier: normalizedTier,
      model,
      provider: "google-gemini",
      runtimeReceiptId: `redesign-chat:${runId}`,
      status: "pending",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.domains.redesign.chatRuns.runStreamingChat, {
      runId,
      prompt,
      tier: normalizedTier,
      contextRef: args.contextRef,
      model,
      pinnedClaims: args.pinnedClaims,
      probeOriginRunId: args.probeOriginRunId,
      probeMaskedSourceUrl: args.probeMaskedSourceUrl,
      probeMaskedSourceIdx: args.probeMaskedSourceIdx,
    });
    return runId;
  },
});

/**
 * Phase 5 — counterfactual probe. Re-runs a prior chat with one source
 * marked unreliable in the system prompt. Looks up the original run by
 * runId, reads the prompt + masked source URL, calls startChat with
 * probeOriginRunId set so the new run carries the masking instruction.
 *
 * Returns the new probedRunId; frontend subscribes via the same
 * streamEventsForRun pattern. The Sprint 4 P0.3 ProbeBanner can show
 * "Probed without [N]: <new shortAnswer>" when complete.
 */
export const probeRun = mutation({
  args: {
    originalRunId: v.string(),
    maskedSourceIdx: v.number(),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId = await requirePaidChatUserId(ctx);
    const orig = await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.originalRunId))
      .first();
    if (!orig) throw new Error("Original run not found");
    if (!orig.userId || orig.userId !== userId) {
      throw new Error("Original run is private or unavailable.");
    }
    if (!orig.packet || orig.status !== "complete") {
      throw new Error("Original run not complete — cannot probe yet");
    }
    const evidence = (orig.packet.evidence ?? []) as Array<{ idx: number; source: string; quote?: string }>;
    const masked = evidence.find((e) => e.idx === args.maskedSourceIdx);
    if (!masked) throw new Error(`No source [${args.maskedSourceIdx}] in original run`);
    // Reuse startChat semantics for auth, scheduling, etc.
    const normalizedTier = normalizeChatTier(orig.tier);
    const model = modelForTier(normalizedTier);
    const runId = generateRunId();
    await ctx.db.insert("redesignChatRuns", {
      runId,
      userId,
      prompt: orig.prompt,
      tier: normalizedTier,
      model,
      provider: "google-gemini",
      runtimeReceiptId: `redesign-chat:${runId}`,
      status: "pending",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.domains.redesign.chatRuns.runStreamingChat, {
      runId,
      prompt: orig.prompt,
      tier: normalizedTier,
      contextRef: undefined,
      model,
      probeOriginRunId: args.originalRunId,
      probeMaskedSourceUrl: masked.source,
      probeMaskedSourceIdx: args.maskedSourceIdx,
    });
    return runId;
  },
});

/**
 * Public query: subscribe to the streaming event log for a run.
 * Re-runs reactively as events land — frontend gets live updates.
 */
export const streamEventsForRun = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    await assertRunReadable(ctx, args.runId);
    return await ctx.db
      .query("redesignChatStreamEvents")
      .withIndex("by_run_idx", (q) => q.eq("runId", args.runId))
      .order("asc")
      .collect();
  },
});

/** Public query: get the run document (final packet once status="complete"). */
export const getRun = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    return await assertRunReadable(ctx, args.runId);
  },
});

/** Recover the owner's newest durable run after a reload. */
export const getLatestOwnedRun = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
  },
});

/**
 * Request cooperative cancellation. Pending work is stopped before a paid call;
 * running streams observe this flag and abort at the next chunk boundary.
 */
export const cancelRun = mutation({
  args: {
    runId: v.optional(v.string()),
    clientRequestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requirePaidChatUserId(ctx);
    if (!args.runId && !args.clientRequestId) throw new Error("A run or request id is required.");
    const row = args.runId
      ? await ctx.db
          .query("redesignChatRuns")
          .withIndex("by_runId", (q) => q.eq("runId", args.runId!))
          .first()
      : await ctx.db
          .query("redesignChatRuns")
          .withIndex("by_user_client_request", (q) =>
            q.eq("userId", userId).eq("clientRequestId", args.clientRequestId!),
          )
          .first();
    if (!row || row.userId !== userId) return { status: "unavailable", alreadyTerminal: false };
    if (row.status === "complete" || row.status === "error" || row.status === "cancelled") {
      return { status: row.status ?? "error", alreadyTerminal: true };
    }
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "cancelled",
      cancelRequestedAt: now,
      cancelledAt: now,
      completedAt: now,
    });
    return { status: "cancelled", alreadyTerminal: false };
  },
});

/** Public query: get an immutable run by hash for the /r/{hash} share route. */
export const getByHash = query({
  args: { hash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_hash", (q) => q.eq("hash", args.hash))
      .first();
    return redactSharedRun(row);
  },
});

// ───────── Internal: append events / set status ─────────

export const appendEvent = internalMutation({
  args: {
    runId: v.string(),
    eventType: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    // Compute next idx for ordering
    const existing = await ctx.db
      .query("redesignChatStreamEvents")
      .withIndex("by_run_idx", (q) => q.eq("runId", args.runId))
      .order("desc")
      .take(1);
    const nextIdx = (existing[0]?.idx ?? -1) + 1;
    return await ctx.db.insert("redesignChatStreamEvents", {
      runId: args.runId,
      idx: nextIdx,
      eventType: args.eventType,
      payload: args.payload,
      createdAt: Date.now(),
    });
  },
});

export const getRunControl = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    return row ? { status: row.status, cancelRequestedAt: row.cancelRequestedAt } : null;
  },
});

export const setRunRunning = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (row && row.status !== "cancelled") await ctx.db.patch(row._id, { status: "running" });
  },
});

export const finalizeRun = internalMutation({
  args: {
    runId: v.string(),
    hash: v.string(),
    packet: v.any(),
    totalLatencyMs: v.number(),
    totalTokens: v.number(),
    estimatedCostUsd: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (row && row.status !== "cancelled") {
      await ctx.db.patch(row._id, {
        status: "complete",
        hash: args.hash,
        packet: args.packet,
        totalLatencyMs: args.totalLatencyMs,
        totalTokens: args.totalTokens,
        estimatedCostUsd: args.estimatedCostUsd,
        completedAt: Date.now(),
      });
    }
  },
});

export const failRun = internalMutation({
  args: { runId: v.string(), errorMessage: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (row && row.status !== "cancelled") {
      await ctx.db.patch(row._id, {
        status: "error",
        errorMessage: args.errorMessage,
        completedAt: Date.now(),
      });
    }
  },
});

// ───────── Internal action: the actual streaming work ─────────

export const runStreamingChat = internalAction({
  args: {
    runId: v.string(),
    prompt: v.string(),
    tier: v.string(),
    contextRef: v.optional(v.string()),
    model: v.string(),
    /** Phase 5 — pinned claims to prepend to system prompt */
    pinnedClaims: v.optional(v.array(v.object({
      text: v.string(),
      source: v.optional(v.string()),
    }))),
    /** Phase 5 — counterfactual probe origin */
    probeOriginRunId: v.optional(v.string()),
    probeMaskedSourceUrl: v.optional(v.string()),
    probeMaskedSourceIdx: v.optional(v.number()),
  },
  handler: async (ctx: ActionCtx, args) => {
    const t0 = Date.now();
    const trace: TraceRow[] = [];
    const apiKey = process.env.GEMINI_API_KEY;

    const append = (eventType: string, payload: unknown) =>
      ctx.runMutation(internal.domains.redesign.chatRuns.appendEvent, {
        runId: args.runId,
        eventType,
        payload: payload as any,
      });
    const isCancelled = async () => {
      const control = await ctx.runQuery(
        internal.domains.redesign.chatRuns.getRunControl,
        { runId: args.runId },
      );
      return control?.status === "cancelled" || Boolean(control?.cancelRequestedAt);
    };
    const assertNotCancelled = async () => {
      if (await isCancelled()) throw new Error("RUN_CANCELLED");
    };

    try {
      if (!apiKey) throw new Error("GEMINI_API_KEY not configured in Convex env");

      await assertNotCancelled();
      await ctx.runMutation(internal.domains.redesign.chatRuns.setRunRunning, { runId: args.runId });

      // Stage 1 — classify
      const t1 = Date.now();
      const classification = classifyPrompt(args.prompt);
      const tr1 = { step: "Classify query", detail: `${classification.kind} · ${classification.entity ?? "no entity"}`, status: "ok" as const, durationMs: Date.now() - t1 };
      trace.push(tr1);
      await append("tool_call", tr1);
      await append("stage", { stage: "classified", classification });
      // Stage 2 — context
      const t2 = Date.now();
      const runtimeContext = await ctx.runQuery(
        internal.domains.redesign.chatRuns.resolveContextRuntimePacket,
        { contextRef: args.contextRef },
      ) as RuntimeContextPacket;
      const liveGrounding = decideLiveGrounding({
        prompt: args.prompt,
        hasContext: runtimeContext.hasContext,
        memoryHit: runtimeContext.telemetry.memoryHit,
        sourceCacheHit: runtimeContext.telemetry.sourceCacheHit,
        selectedContextCount: runtimeContext.selectedContext.length,
        sourceRefCount: runtimeContext.sourceRefs.length,
      });
      const planner = buildBoardState({
        runId: args.runId,
        prompt: args.prompt,
        tier: args.tier,
        model: args.model,
        contextRef: args.contextRef,
        classification,
        runtimeContext,
        liveGrounding,
      });
      await append("board_state", planner.boardState);
      for (const candidate of planner.contextCandidates) {
        await append("context_candidate", candidate);
      }
      for (const decision of planner.toolDecisions) {
        await append("tool_decision", decision);
      }
      await append("context_runtime_packet", runtimeContext);
      await append("live_grounding_decision", liveGrounding);
      // Deterministic fix for the bank-reconciliation derivation gap (see
      // docs/ACCOUNTING-FR-A4-JOURNAL-ENTRY.md, "CORRECTION" section): a
      // prompt-only instruction to "show your math" was confirmed 3/3 live
      // runs to never surface the actual arithmetic. When the prompt is an
      // unambiguous bank-reconciliation shape (exactly 3 dollar amounts, each
      // confidently tagged bank/ledger/outstanding), compute the tie-out
      // server-side and inject it as a pre-verified fact instead of asking
      // the model to both compute and format a derivation. Ambiguous shapes
      // return null and inject nothing -- the existing prompt-only behavior
      // is unchanged for every other request shape.
      const bankReconciliationFact = extractBankReconciliationFact(args.prompt);
      if (bankReconciliationFact) {
        await append("verified_calculation", bankReconciliationFact);
      }
      const contextBundle = {
        role: "operator",
        style: "evidence-first banker memo",
        report: runtimeContext.hasContext ? runtimeContext.title : "no live artifact selected",
        contextRef: runtimeContext.contextRef,
        reportId: runtimeContext.reportId,
        artifactKey: runtimeContext.artifactKey,
        summary: runtimeContext.summary,
        selectedContext: runtimeContext.selectedContext,
        sourceRefs: runtimeContext.sourceRefs.slice(0, 8),
        graph: runtimeContext.graph,
        notebook: runtimeContext.notebook,
        verification: runtimeContext.verification,
        // Undefined keys are dropped by JSON.stringify, so an ambiguous shape
        // (null) injects nothing into the prompt -- never a guessed fact.
        verifiedCalculation: bankReconciliationFact?.fact,
      };
      const tr2 = {
        step: "Build context bundle",
        detail: runtimeContext.telemetry.memoryHit
          ? `${contextBundle.role} · ${runtimeContext.title} · ${runtimeContext.sourceRefs.length} source refs`
          : `${contextBundle.role} · prompt-only context`,
        status: "ok" as const,
        durationMs: Date.now() - t2,
      };
      trace.push(tr2);
      await append("tool_call", tr2);

      // Working notes preview (deterministic, while we wait for Gemini)
      await append("scratchpad", {
        text: `Plan
- Prompt: ${args.prompt.slice(0, 80)}${args.prompt.length > 80 ? "…" : ""}
- Classified as ${classification.kind}${classification.entity ? ` (entity: ${classification.entity})` : ""}
- Context: ${runtimeContext.telemetry.memoryHit ? `resolved ${runtimeContext.title}` : "prompt-only, no memory hit"}
- Live grounding: ${liveGrounding.useLiveGrounding ? "enabled" : "skipped"} (${liveGrounding.reason})
- Calling ${args.model}${liveGrounding.useLiveGrounding ? " with web-search grounding" : " against selected memory context"}`,
      });

      // Stage 3 — Gemini streaming with grounding
      await assertNotCancelled();
      const t3 = Date.now();
      // Phase 5 — pinned claims carry-forward as hard context
      const pinnedSection = args.pinnedClaims && args.pinnedClaims.length > 0
        ? `\n\nPinned claims (carry forward as established context — do not contradict without explicit re-grounding):\n${args.pinnedClaims.map((p, i) => `  ${i + 1}. ${p.text}${p.source ? ` (source: ${p.source})` : ""}`).join("\n")}`
        : "";
      // Phase 5 — counterfactual probe instruction
      const probeSection = args.probeMaskedSourceUrl
        ? `\n\nIMPORTANT — counterfactual probe: The source previously at <${args.probeMaskedSourceUrl}> (originally cited as [${args.probeMaskedSourceIdx ?? "?"}] in run ${args.probeOriginRunId ?? "?"}) is being treated as UNRELIABLE for this answer. DO NOT cite it. DO NOT use it as the basis for any claim. Re-answer the same prompt and explicitly note in "Risks / unknowns" how the conclusion changes (or holds) if that source is excluded. Prefer alternative grounded sources.`
        : "";
      // Deterministic bank-reconciliation fact (see extractBankReconciliationFact
      // above): when present, relay it verbatim instead of recomputing -- this is
      // the actual fix for the "never shows the derivation" gap, not another
      // prompt-only ask to compute under constraint.
      const verifiedCalculationSection = bankReconciliationFact
        ? `\n\nA server-side VERIFIED_CALCULATION is available in the context packet's "verifiedCalculation" field: ${bankReconciliationFact.fact} This arithmetic has already been computed and checked for you. State it verbatim (the exact numbers and the tie/no-tie conclusion) inside "Why it matters" instead of recomputing or restating different numbers.`
        : "";
      const requestedResponseShape = detectRequestedResponseShape(args.prompt);
      const responseShapeInstruction = requestedResponseShape.kind === "title_only"
        ? "The user requested a title-only response. Output exactly one plain-text title line with no heading, label, bullets, explanation, or memo sections."
        : requestedResponseShape.kind === "bullets"
          ? `The user requested exactly ${requestedResponseShape.count} bullets. Output exactly ${requestedResponseShape.count} Markdown bullet lines beginning with \"- \" and no heading, preamble, conclusion, or memo sections.`
          : `Produce a banker-style memo. Do not include To, From, Date, or Subject headers. Use exactly these markdown section headings:
1. Short answer (one sentence with citation markers like [1] [2])
2. Why it matters (one paragraph with citation markers)
3. Evidence (3-5 bullets, each citing a source)
4. Risks / unknowns (2-3 bullets)
5. Next action (one imperative sentence)`;
      const citationInstruction = requestedResponseShape.kind === "title_only"
        ? "Do not include citation markers in the title."
        : "Use [1], [2], [3] inline cite markers when a statement has a supported source URL.";
      const calculationInstruction = requestedResponseShape.kind === "title_only"
        ? ""
        : requestedResponseShape.kind === "bullets"
          ? "If the request requires a calculation or reconciliation, include the exact derivation and pass/fail conclusion within the requested bullet count."
          : `If the user's request involves a numeric calculation, reconciliation, balancing check, or explicitly
asks you to "show your math" / "show your work" / confirm a total: state the actual derivation
(the specific numbers and operation, e.g. "$X - $Y = $Z") and an explicit pass/fail confirmation
of what they asked you to verify inside "Why it matters" - do not just assert the conclusion. This
does not apply to ordinary research/company/market questions.`;
      const systemPrompt = `You are NodeBench's evidence-first analyst. ${responseShapeInstruction}

${citationInstruction} ${liveGrounding.useLiveGrounding ? "Keep claims grounded in the web sources you retrieve. Prefer recency." : "Use only the selected memory/context packet and cached source refs; do not imply a fresh web search was performed."} If you can't find grounded evidence, say so explicitly.

${calculationInstruction}

Context: ${JSON.stringify(contextBundle)}${pinnedSection}${probeSection}${verifiedCalculationSection}`;
      // Emit a stage event so the UI can show "Probing without [N]" / "Carrying forward N pins"
      if (probeSection) {
        await append("stage", { stage: "probe", maskedUrl: args.probeMaskedSourceUrl, maskedIdx: args.probeMaskedSourceIdx, originRunId: args.probeOriginRunId });
      }
      if (pinnedSection) {
        await append("stage", { stage: "pinned", count: args.pinnedClaims!.length });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let rawText = "";
      let groundingChunks: Array<{ web?: { uri: string; title?: string } }> = [];
      let groundingSupports: Array<{
        segment?: { text?: string; startIndex?: number; endIndex?: number };
        groundingChunkIndices?: number[];
      }> = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let firstSourceAt: number | undefined;

      try {
        // Use streamGenerateContent (alt=sse) for token-level streaming
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:streamGenerateContent?alt=sse&key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: args.prompt }] }],
            ...(liveGrounding.useLiveGrounding ? { tools: [{ google_search: {} }] } : {}),
            generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
        }
        // Parse SSE stream
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const seenChunkUris = new Set<string>();
        while (true) {
          if (await isCancelled()) {
            controller.abort();
            await reader.cancel();
            throw new Error("RUN_CANCELLED");
          }
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let newlineIdx;
          while ((newlineIdx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, newlineIdx).trim();
            buf = buf.slice(newlineIdx + 1);
            if (!line.startsWith("data:")) continue;
            const json = line.slice(5).trim();
            if (!json || json === "[DONE]") continue;
            try {
              const obj = JSON.parse(json);
              const candidate = obj?.candidates?.[0];
              const partText: string | undefined = candidate?.content?.parts?.[0]?.text;
              if (partText) {
                rawText += partText;
                await append("scratchpad", { text: partText });
              }
              const meta = candidate?.groundingMetadata;
              if (meta?.groundingChunks) {
                for (let i = 0; i < meta.groundingChunks.length; i++) {
                  const chunk = meta.groundingChunks[i];
                  const uri = chunk?.web?.uri;
                  if (uri && !seenChunkUris.has(uri)) {
                    seenChunkUris.add(uri);
                    firstSourceAt ??= Date.now();
                    await append("grounding_chunk", {
                      idx: groundingChunks.length + 1,
                      url: uri,
                      title: chunk.web?.title ?? uri,
                    });
                    groundingChunks.push(chunk);
                  }
                }
                if (Array.isArray(meta.groundingSupports)) {
                  groundingSupports = meta.groundingSupports;
                }
              }
              if (obj?.usageMetadata) {
                inputTokens = obj.usageMetadata.promptTokenCount ?? inputTokens;
                outputTokens = obj.usageMetadata.candidatesTokenCount ?? outputTokens;
              }
            } catch (parseErr) {
              // Skip malformed SSE chunks
              void parseErr;
            }
          }
        }
        clearTimeout(timeoutId);
        const tr3 = {
          step: "Gemini synthesis",
          detail: liveGrounding.useLiveGrounding
            ? `${args.model} · grounded · ${groundingChunks.length} chunks`
            : `${args.model} · memory-first · live search skipped`,
          status: "ok" as const,
          durationMs: Date.now() - t3,
        };
        trace.push(tr3);
        await append("tool_call", tr3);
      } catch (err: any) {
        clearTimeout(timeoutId);
        if ((err?.message || String(err)) === "RUN_CANCELLED" || await isCancelled()) {
          throw new Error("RUN_CANCELLED");
        }
        const detail = err.name === "AbortError" ? "request_timeout" : (err.message || String(err));
        const tr3 = { step: "Gemini synthesis", detail, status: "error" as const, durationMs: Date.now() - t3 };
        trace.push(tr3);
        await append("tool_call", tr3);
        throw err;
      }

      // Stage 4 — bind evidence
      let fallbackSources: FallbackSourceSnippet[] = [];
      if (liveGrounding.useLiveGrounding && groundingChunks.length === 0) {
        const tFallback = Date.now();
        const fallback = await runFallbackSourceSearch(args.prompt);
        fallbackSources = fallback.snippets;
        for (const [i, source] of fallbackSources.entries()) {
          firstSourceAt ??= Date.now();
          await append("grounding_chunk", {
            idx: i + 1,
            url: source.url,
            title: source.title,
            provider: source.provider,
            fallback: true,
          });
        }
        const trFallback = {
          step: "Fallback source search",
          detail: fallback.detail,
          status: (fallbackSources.length > 0 ? "ok" : "warn") as "ok" | "warn",
          durationMs: Date.now() - tFallback,
        };
        trace.push(trFallback);
        await append("tool_call", trFallback);
      }

      const t4 = Date.now();
      let parsed = parseMemo(rawText);
      const geminiEvidence: EvidenceRow[] = groundingChunks.slice(0, 6).map((chunk, i) => {
        const url = chunk.web?.uri ?? "";
        let host = url;
        try { host = new URL(url || "https://example.com").hostname; } catch { /* ignore */ }
        const title = chunk.web?.title ?? host;
        const support = groundingSupports.find((s) => s.groundingChunkIndices?.includes(i));
        const quote = support?.segment?.text?.trim() || `Cited from ${title}`;
        return { idx: i + 1, quote: quote.slice(0, 240), source: url || title, sourceProvider: "gemini_grounding" };
      });
      const fallbackEvidence: EvidenceRow[] = fallbackSources.map((source, i) => ({
        idx: i + 1,
        quote: source.snippet.slice(0, 240),
        source: source.url,
        sourceProvider: source.provider,
      }));
      const memoryEvidence: EvidenceRow[] = runtimeContext.sourceRefs
        .filter((source) => source.url || source.source || source.title)
        .slice(0, 6)
        .map((source, i) => ({
          idx: i + 1,
          quote: clipText(source.excerpt || `Cached source: ${source.title}`, 240),
          source: source.url || source.source || source.title,
          sourceProvider: source.url ? "source_cache" : "memory_cache",
        }));
      const evidence = geminiEvidence.length > 0
        ? geminiEvidence
        : fallbackEvidence.length > 0
          ? fallbackEvidence
          : memoryEvidence;
      if (evidence.length > 0 && !/\[\d+\]/.test(parsed.shortAnswer)) {
        parsed.shortAnswer = `${parsed.shortAnswer} [1]`;
      }
      if (evidence.length > 0 && !/\[\d+\]/.test(parsed.whyItMatters)) {
        parsed.whyItMatters = `${parsed.whyItMatters} [1]`;
      }
      parsed = applyDeterministicResponsePolicy(args.prompt, parsed, evidence);
      const tr4 = {
        step: "Bind evidence",
        detail: `${evidence.length} citations from ${groundingChunks.length} Gemini chunks + ${fallbackSources.length} fallback sources + ${memoryEvidence.length} cached sources`,
        status: (evidence.length > 0 ? "ok" : "warn") as "ok" | "warn",
        durationMs: Date.now() - t4,
      };
      trace.push(tr4);
      await append("tool_call", tr4);
      for (const row of evidence) {
        await append("claim_check", {
          idx: row.idx,
          status: "pending_source_validation",
          method: "url_substring_validation",
          source: row.source,
          detail: "Evidence row bound; background validator will confirm quote support.",
        });
      }

      // Section commits
      await append("section", { name: "short_answer", text: parsed.shortAnswer });
      await append("section", { name: "why_it_matters", text: parsed.whyItMatters });
      await append("section", { name: "evidence", rows: evidence });
      await append("section", { name: "risks", items: parsed.risks });
      await append("section", { name: "next_action", text: parsed.nextAction });

      const totalLatencyMs = Date.now() - t0;
      const totalTokens = inputTokens + outputTokens;
      const pricing = pricingForModel(args.model);
      const estimatedCostUsd =
        (inputTokens / 1_000_000) * pricing.inputUsdPer1m +
        (outputTokens / 1_000_000) * pricing.outputUsdPer1m;
      const hash = answerHash({
        prompt: args.prompt,
        tier: args.tier,
        model: args.model,
        shortAnswer: parsed.shortAnswer,
        evidenceUrls: evidence.map((e) => e.source),
      });

      const runtime = {
        boardState: {
          ...planner.boardState,
          status: "complete",
        },
        contextCandidates: planner.contextCandidates,
        toolDecisions: planner.toolDecisions.map((decision) =>
          decision.id === "verify_sources" ? { ...decision, status: "pending" as const } : decision,
        ),
        claimChecks: evidence.map((row) => ({
          idx: row.idx,
          status: "pending_source_validation",
          method: "url_substring_validation",
          source: row.source,
          detail: "Evidence row bound; background validator will confirm quote support.",
        })),
        contextPacket: runtimeContext,
        liveGroundingDecision: liveGrounding,
        metrics: {
          runId: args.runId,
          totalLatencyMs,
          totalTokens,
          estimatedCostUsd,
          paidCalls: 1,
          sourceCount: evidence.length,
          toolCallCount: trace.length,
          liveSearchCalls: liveGrounding.useLiveGrounding ? 1 : 0,
          memoryHitRate: runtimeContext.telemetry.memoryHit ? 1 : 0,
          sourceCacheHitRate: runtimeContext.telemetry.sourceCacheHit ? 1 : 0,
          timeToFirstSourceMs: firstSourceAt ? firstSourceAt - t0 : null,
          timeToFinalMs: totalLatencyMs,
        },
        actionOutputs: [
          {
            id: "next_action",
            label: "Recommended next action",
            status: "local_only_recommendation",
            detail: parsed.nextAction,
          },
        ],
      };
      const packet: AnswerPacket & { runtime: typeof runtime } = {
        shortAnswer: parsed.shortAnswer,
        whyItMatters: parsed.whyItMatters,
        evidence,
        risks: parsed.risks,
        nextAction: parsed.nextAction,
        sourceCount: evidence.length,
        paidCalls: 1,
        fromMemory: runtimeContext.telemetry.memoryHit,
        trace,
        runtime,
      };

      await assertNotCancelled();
      await ctx.runMutation(internal.domains.redesign.chatRuns.finalizeRun, {
        runId: args.runId,
        hash,
        packet,
        totalLatencyMs,
        totalTokens,
        estimatedCostUsd,
      });
      await append("run_metrics", {
        runId: args.runId,
        totalLatencyMs,
        totalTokens,
        estimatedCostUsd,
        paidCalls: 1,
        sourceCount: evidence.length,
        toolCallCount: trace.length,
        liveSearchCalls: liveGrounding.useLiveGrounding ? 1 : 0,
        memoryHitRate: runtimeContext.telemetry.memoryHit ? 1 : 0,
        sourceCacheHitRate: runtimeContext.telemetry.sourceCacheHit ? 1 : 0,
        timeToFirstSourceMs: firstSourceAt ? firstSourceAt - t0 : null,
        timeToFinalMs: totalLatencyMs,
      });
      await append("packet_complete", { hash, totalLatencyMs, totalTokens, estimatedCostUsd });

      // Phase 6 — schedule background source-URL substring validation.
      // Runs after the packet is sealed so the user sees the answer
      // immediately; verification flags are patched onto evidence rows
      // when they land, frontend re-renders via reactive subscription.
      if (evidence.length > 0) {
        await ctx.scheduler.runAfter(0, internal.domains.redesign.chatRuns.validateRunSources, {
          runId: args.runId,
        });
      }
    } catch (err: any) {
      if ((err?.message || String(err)) === "RUN_CANCELLED" || await isCancelled()) {
        return;
      }
      const errorMessage = (err?.message || String(err)).slice(0, 280);
      await append("error", { errorMessage });
      await ctx.runMutation(internal.domains.redesign.chatRuns.failRun, {
        runId: args.runId,
        errorMessage,
      });
    }
  },
});

// (Phase 2 hook uses startChat + streamEventsForRun + getRun directly.)

// ───────── Phase 6 — Source URL substring validation ─────────

function isUrlSafe(rawUrl: string): { ok: boolean; reason?: string } {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return { ok: false, reason: "malformed" }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: `bad_protocol:${url.protocol}` };
  }
  const host = url.hostname.toLowerCase();
  if (host === "metadata.google.internal" || host === "169.254.169.254") return { ok: false, reason: "cloud_metadata" };
  if (host === "localhost" || host === "0.0.0.0" || host === "::1" || host === "[::1]") return { ok: false, reason: "loopback" };
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return { ok: false, reason: "rfc1918" };
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return { ok: false, reason: "rfc1918" };
  if (/^169\.254\./.test(host)) return { ok: false, reason: "link_local" };
  return { ok: true };
}

const VALIDATION_FETCH_TIMEOUT_MS = 8_000;
const VALIDATION_MAX_BYTES = 256 * 1024;
const VALIDATION_TOTAL_TIMEOUT_MS = 30_000;

async function fetchPageText(url: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const safety = isUrlSafe(url);
  if (!safety.ok) return { ok: false, reason: safety.reason ?? "unsafe" };
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), VALIDATION_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "NodeBench-SourceValidator/0.1 (+https://www.nodebenchai.com)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(tid);
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const contentType = res.headers.get("content-type") ?? "";
    if (!/^text\/|^application\/(xhtml|json|xml)/i.test(contentType)) {
      return { ok: false, reason: `bad_content_type:${contentType.split(";")[0]}` };
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      buf += decoder.decode(value, { stream: true });
      if (total >= VALIDATION_MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    const text = buf
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim();
    return { ok: true, text };
  } catch (err: any) {
    clearTimeout(tid);
    return { ok: false, reason: err?.name === "AbortError" ? "timeout" : (err?.message || "fetch_error").slice(0, 80) };
  }
}

function quoteIsSubstring(quote: string, pageText: string): boolean {
  const norm = quote.replace(/\s+/g, " ").toLowerCase().trim();
  if (norm.length < 8) return false;
  if (pageText.includes(norm)) return true;
  const words = norm.split(/\s+/);
  if (words.length >= 8) {
    const window = words.slice(0, Math.min(8, words.length)).join(" ");
    if (pageText.includes(window)) return true;
  }
  return false;
}

export const validateRunSources = internalAction({
  args: { runId: v.string() },
  handler: async (ctx: ActionCtx, args) => {
    const totalDeadline = Date.now() + VALIDATION_TOTAL_TIMEOUT_MS;
    const row: any = await ctx.runQuery(internal.domains.redesign.chatRuns.getRunForValidation, { runId: args.runId });
    if (!row?.packet?.evidence?.length) return;
    const evidence: EvidenceRow[] = row.packet.evidence;
    const updates: Array<{
      idx: number;
      verified: boolean;
      validationError?: string;
      verificationState: EvidenceVerificationState;
      verificationDetail: string;
      status: string;
      blocking: boolean;
    }> = [];
    const tasks = evidence.map((e) => async () => {
      if (Date.now() > totalDeadline) {
        const decision = classifyEvidenceVerification({
          source: e.source,
          sourceProvider: e.sourceProvider,
          fetchedOk: false,
          fetchReason: "global_timeout",
        });
        return { idx: e.idx, verified: decision.verified, validationError: "global_timeout", verificationState: decision.state, verificationDetail: decision.detail, status: decision.status, blocking: decision.blocking };
      }
      const url = e.source;
      if (!/^https?:\/\//i.test(url)) {
        const decision = classifyEvidenceVerification({ source: url, sourceProvider: e.sourceProvider });
        return { idx: e.idx, verified: decision.verified, validationError: "not_a_url", verificationState: decision.state, verificationDetail: decision.detail, status: decision.status, blocking: decision.blocking };
      }
      const fetched = await fetchPageText(url);
      if (!fetched.ok) {
        const decision = classifyEvidenceVerification({
          source: url,
          sourceProvider: e.sourceProvider,
          fetchedOk: false,
          fetchReason: fetched.reason,
        });
        return { idx: e.idx, verified: decision.verified, validationError: fetched.reason, verificationState: decision.state, verificationDetail: decision.detail, status: decision.status, blocking: decision.blocking };
      }
      const ok = quoteIsSubstring(e.quote, fetched.text);
      const decision = classifyEvidenceVerification({
        source: url,
        sourceProvider: e.sourceProvider,
        fetchedOk: true,
        quoteMatched: ok,
      });
      return { idx: e.idx, verified: decision.verified, validationError: ok ? undefined : "quote_not_in_body", verificationState: decision.state, verificationDetail: decision.detail, status: decision.status, blocking: decision.blocking };
    });
    const POOL = 4;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(POOL, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const i = cursor++;
        try { updates.push(await tasks[i]()); }
        catch (err: any) {
          const validationError = (err?.message || "error").slice(0, 60);
          const decision = classifyEvidenceVerification({
            source: evidence[i].source,
            sourceProvider: evidence[i].sourceProvider,
            fetchedOk: false,
            fetchReason: validationError,
          });
          updates.push({ idx: evidence[i].idx, verified: decision.verified, validationError, verificationState: decision.state, verificationDetail: decision.detail, status: decision.status, blocking: decision.blocking });
        }
      }
    });
    await Promise.all(workers);
    updates.sort((a, b) => a.idx - b.idx);
    await ctx.runMutation(internal.domains.redesign.chatRuns.patchEvidenceVerification, {
      runId: args.runId,
      verifications: updates,
    });
    const verifiedCount = updates.filter((u) => u.verified).length;
    const softWarningCount = updates.filter((u) => !u.verified && !u.blocking).length;
    for (const update of updates) {
      await ctx.runMutation(internal.domains.redesign.chatRuns.appendEvent, {
        runId: args.runId,
        eventType: "claim_check",
        payload: {
          idx: update.idx,
          status: update.status,
          method: "url_substring_validation",
          verified: update.verified,
          validationError: update.validationError,
          verificationState: update.verificationState,
          verificationDetail: update.verificationDetail,
          blocking: update.blocking,
        } as any,
      });
    }
    await ctx.runMutation(internal.domains.redesign.chatRuns.appendEvent, {
      runId: args.runId,
      eventType: "sources_validated",
      payload: {
        verified: verifiedCount,
        softWarnings: softWarningCount,
        total: updates.length,
        unverified: updates.filter((u) => u.blocking).map((u) => ({
          idx: u.idx,
          reason: u.validationError,
          status: u.status,
          verificationState: u.verificationState,
          verificationDetail: u.verificationDetail,
          blocking: u.blocking,
        })),
        warnings: updates.filter((u) => !u.verified && !u.blocking).map((u) => ({
          idx: u.idx,
          reason: u.validationError,
          status: u.status,
          verificationState: u.verificationState,
          verificationDetail: u.verificationDetail,
          blocking: u.blocking,
        })),
      } as any,
    });
  },
});

export const getRunForValidation = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
  },
});

export const patchEvidenceVerification = internalMutation({
  args: {
    runId: v.string(),
    verifications: v.array(v.object({
      idx: v.number(),
      verified: v.boolean(),
      validationError: v.optional(v.string()),
      verificationState: v.optional(v.string()),
      verificationDetail: v.optional(v.string()),
      status: v.optional(v.string()),
      blocking: v.optional(v.boolean()),
    })),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (!row?.packet) return;
    const byIdx = new Map<number, {
      verified: boolean;
      validationError?: string;
      verificationState?: string;
      verificationDetail?: string;
      status?: string;
      blocking?: boolean;
    }>();
    for (const u of args.verifications) {
      byIdx.set(u.idx, {
        verified: u.verified,
        validationError: u.validationError,
        verificationState: u.verificationState,
        verificationDetail: u.verificationDetail,
        status: u.status,
        blocking: u.blocking,
      });
    }
    const evidence = (row.packet.evidence ?? []).map((e: any) => {
      const u = byIdx.get(e.idx);
      if (!u) return e;
      return {
        ...e,
        verified: u.verified,
        verifiedAt: Date.now(),
        validationError: u.validationError,
        verificationState: u.verificationState,
        verificationDetail: u.verificationDetail,
        blocking: u.blocking,
      };
    });
    const verifiedCount = evidence.filter((e: any) => e.verified).length;
    const softWarningCount = evidence.filter((e: any) => e.verified === false && e.blocking === false).length;
    const unsupportedCount = evidence.filter((e: any) => e.blocking === true).length;
    const cachedCount = evidence.filter((e: any) => e.verificationState === "cached_reference").length;
    const fetchBlockedCount = evidence.filter((e: any) => e.verificationState === "fetch_blocked").length;
    const providerGroundedCount = evidence.filter((e: any) => e.verificationState === "provider_grounded").length;
    const runtime = row.packet.runtime
      ? {
          ...row.packet.runtime,
          claimChecks: evidence.map((e: any) => ({
            idx: e.idx,
            status: e.verified ? "source_validation_passed" : e.verificationState ?? "source_validation_failed",
            method: "url_substring_validation",
            source: e.source,
            verified: e.verified,
            validationError: e.validationError,
            verificationState: e.verificationState,
            verificationDetail: e.verificationDetail,
            blocking: e.blocking,
            detail: e.verificationDetail ?? (e.verified ? "Quote substring confirmed in source body." : "Quote substring was not confirmed in source body."),
          })),
          metrics: {
            ...(row.packet.runtime.metrics ?? {}),
            sourceCount: evidence.length,
            verifiedSourceCount: verifiedCount,
            softWarningSourceCount: softWarningCount,
            unsupportedSourceCount: unsupportedCount,
            cachedSourceCount: cachedCount,
            fetchBlockedSourceCount: fetchBlockedCount,
            providerGroundedSourceCount: providerGroundedCount,
          },
        }
      : undefined;
    await ctx.db.patch(row._id, {
      packet: {
        ...row.packet,
        evidence,
        sourceCount: evidence.length,
        verifiedSourceCount: verifiedCount,
        softWarningSourceCount: softWarningCount,
        unsupportedSourceCount: unsupportedCount,
        ...(runtime ? { runtime } : {}),
      },
    });
  },
});
