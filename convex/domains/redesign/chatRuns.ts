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
 * Auth-gated: anonymous users still get the showcase fixture path.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";

// ───────── Types ─────────

type EvidenceRow = { idx: number; quote: string; source: string };
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

// ───────── Constants ─────────

const MAX_PROMPT_CHARS = 4_000;
const TIMEOUT_MS = 45_000;
const GEMINI_INPUT_USD_PER_1M_TOKENS = 0.075;
const GEMINI_OUTPUT_USD_PER_1M_TOKENS = 0.30;
const FALLBACK_SOURCE_TIMEOUT_MS = 12_000;
const FALLBACK_SOURCE_LIMIT = 5;

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

function modelForTier(tier: string): string {
  const normalized = normalizeChatTier(tier);
  if (normalized === "deep") return "gemini-3.1-pro-preview";
  if (normalized === "free") return "gemini-3.1-flash-lite-preview";
  return "gemini-3-flash-preview";
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

function classifyPrompt(prompt: string): { kind: string; entity?: string } {
  const lower = prompt.toLowerCase();
  const capMatch = prompt.match(/(?:about |on |for |re )?([A-Z][A-Za-z0-9]+(?:\s[A-Z][A-Za-z0-9]+)*)/);
  const entity = capMatch?.[1];
  if (lower.includes(" vs ") || lower.includes(" compare ")) return { kind: "competitor", entity };
  if (entity && entity.length > 2) return { kind: "company_search", entity };
  return { kind: "general" };
}

interface ParsedMemo {
  shortAnswer: string;
  whyItMatters: string;
  risks: string[];
  nextAction: string;
}

function parseMemo(text: string): ParsedMemo {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const sections: Record<string, string[]> = { short: [], why: [], evidence: [], risks: [], next: [] };
  let current: keyof typeof sections | null = null;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/^(#+\s*)?short answer/.test(lower) || /^1\.?\s*short/.test(lower)) { current = "short"; continue; }
    if (/^(#+\s*)?why/.test(lower) || /^2\.?\s*why/.test(lower)) { current = "why"; continue; }
    if (/^(#+\s*)?evidence/.test(lower) || /^3\.?\s*evidence/.test(lower)) { current = "evidence"; continue; }
    if (/^(#+\s*)?risk/.test(lower) || /^4\.?\s*risk/.test(lower)) { current = "risks"; continue; }
    if (/^(#+\s*)?next action/.test(lower) || /^5\.?\s*next/.test(lower)) { current = "next"; continue; }
    if (current) sections[current].push(line.replace(/^[-*•]\s*/, ""));
  }
  const shortAnswer = sections.short.join(" ").trim() || (lines[0] ?? "").slice(0, 240);
  const whyItMatters = sections.why.join(" ").trim() || (lines[1] ?? "").slice(0, 480);
  const risks = sections.risks.length > 0
    ? sections.risks.slice(0, 4)
    : ["Grounded sources may not reflect the very latest events — re-run before any irreversible action."];
  const nextAction = sections.next[0] || "Review evidence rows; pin the strongest claim into the active report.";
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
    const normalizedTier = normalizeChatTier(args.tier);
    const model = modelForTier(normalizedTier);
    const runId = generateRunId();
    let userId: any = undefined;
    try {
      const identity = await ctx.auth.getUserIdentity();
      if (identity?.subject) {
        const found = await ctx.db
          .query("users")
          .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.subject))
          .first()
          .catch(() => null);
        userId = found?._id;
      }
    } catch { /* anonymous OK */ }
    await ctx.db.insert("redesignChatRuns", {
      runId,
      userId,
      prompt,
      tier: normalizedTier,
      model,
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
    const orig = await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.originalRunId))
      .first();
    if (!orig) throw new Error("Original run not found");
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
    let userId: any = undefined;
    try {
      const identity = await ctx.auth.getUserIdentity();
      if (identity?.subject) {
        const found = await ctx.db
          .query("users")
          .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.subject))
          .first()
          .catch(() => null);
        userId = found?._id;
      }
    } catch { /* anonymous OK */ }
    await ctx.db.insert("redesignChatRuns", {
      runId,
      userId,
      prompt: orig.prompt,
      tier: normalizedTier,
      model,
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
    return await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
  },
});

/** Public query: get an immutable run by hash for the /r/{hash} share route. */
export const getByHash = query({
  args: { hash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_hash", (q) => q.eq("hash", args.hash))
      .first();
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

export const setRunRunning = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (row) await ctx.db.patch(row._id, { status: "running" });
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
    if (row) {
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
    if (row) {
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

    try {
      if (!apiKey) throw new Error("GEMINI_API_KEY not configured in Convex env");

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
      const contextBundle = {
        role: "operator",
        style: "evidence-first banker memo",
        report: args.contextRef ?? "no live artifact selected",
      };
      const tr2 = { step: "Build context bundle", detail: `${contextBundle.role} · ${contextBundle.style}`, status: "ok" as const, durationMs: Date.now() - t2 };
      trace.push(tr2);
      await append("tool_call", tr2);

      // Working notes preview (deterministic, while we wait for Gemini)
      await append("scratchpad", {
        text: `Plan
- Prompt: ${args.prompt.slice(0, 80)}${args.prompt.length > 80 ? "…" : ""}
- Classified as ${classification.kind}${classification.entity ? ` (entity: ${classification.entity})` : ""}
- Calling ${args.model} with web-search grounding`,
      });

      // Stage 3 — Gemini streaming with grounding
      const t3 = Date.now();
      // Phase 5 — pinned claims carry-forward as hard context
      const pinnedSection = args.pinnedClaims && args.pinnedClaims.length > 0
        ? `\n\nPinned claims (carry forward as established context — do not contradict without explicit re-grounding):\n${args.pinnedClaims.map((p, i) => `  ${i + 1}. ${p.text}${p.source ? ` (source: ${p.source})` : ""}`).join("\n")}`
        : "";
      // Phase 5 — counterfactual probe instruction
      const probeSection = args.probeMaskedSourceUrl
        ? `\n\nIMPORTANT — counterfactual probe: The source previously at <${args.probeMaskedSourceUrl}> (originally cited as [${args.probeMaskedSourceIdx ?? "?"}] in run ${args.probeOriginRunId ?? "?"}) is being treated as UNRELIABLE for this answer. DO NOT cite it. DO NOT use it as the basis for any claim. Re-answer the same prompt and explicitly note in "Risks / unknowns" how the conclusion changes (or holds) if that source is excluded. Prefer alternative grounded sources.`
        : "";
      const systemPrompt = `You are NodeBench's evidence-first analyst. Produce a banker-style memo with:
1. Short answer (one sentence with citation markers like [1] [2])
2. Why it matters (one paragraph with citation markers)
3. Evidence (3-5 bullets, each citing a source)
4. Risks / unknowns (2-3 bullets)
5. Next action (one imperative sentence)

Use [1], [2], [3] inline cite markers in the prose. Keep claims grounded in the web sources you retrieve. Prefer recency. If you can't find grounded evidence, say so explicitly.

Context: ${JSON.stringify(contextBundle)}${pinnedSection}${probeSection}`;
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

      try {
        // Use streamGenerateContent (alt=sse) for token-level streaming
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:streamGenerateContent?alt=sse&key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: args.prompt }] }],
            tools: [{ google_search: {} }],
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
          detail: `${args.model} · grounded · ${groundingChunks.length} chunks`,
          status: "ok" as const,
          durationMs: Date.now() - t3,
        };
        trace.push(tr3);
        await append("tool_call", tr3);
      } catch (err: any) {
        clearTimeout(timeoutId);
        const detail = err.name === "AbortError" ? "request_timeout" : (err.message || String(err));
        const tr3 = { step: "Gemini synthesis", detail, status: "error" as const, durationMs: Date.now() - t3 };
        trace.push(tr3);
        await append("tool_call", tr3);
        throw err;
      }

      // Stage 4 — bind evidence
      let fallbackSources: FallbackSourceSnippet[] = [];
      if (groundingChunks.length === 0) {
        const tFallback = Date.now();
        const fallback = await runFallbackSourceSearch(args.prompt);
        fallbackSources = fallback.snippets;
        for (const [i, source] of fallbackSources.entries()) {
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
      const parsed = parseMemo(rawText);
      const geminiEvidence: EvidenceRow[] = groundingChunks.slice(0, 6).map((chunk, i) => {
        const url = chunk.web?.uri ?? "";
        let host = url;
        try { host = new URL(url || "https://example.com").hostname; } catch { /* ignore */ }
        const title = chunk.web?.title ?? host;
        const support = groundingSupports.find((s) => s.groundingChunkIndices?.includes(i));
        const quote = support?.segment?.text?.trim() || `Cited from ${title}`;
        return { idx: i + 1, quote: quote.slice(0, 240), source: url || title };
      });
      const fallbackEvidence: EvidenceRow[] = fallbackSources.map((source, i) => ({
        idx: i + 1,
        quote: source.snippet.slice(0, 240),
        source: source.url,
      }));
      const evidence = geminiEvidence.length > 0 ? geminiEvidence : fallbackEvidence;
      if (evidence.length > 0 && !/\[\d+\]/.test(parsed.shortAnswer)) {
        parsed.shortAnswer = `${parsed.shortAnswer} [1]`;
      }
      if (evidence.length > 0 && !/\[\d+\]/.test(parsed.whyItMatters)) {
        parsed.whyItMatters = `${parsed.whyItMatters} [1]`;
      }
      const tr4 = {
        step: "Bind evidence",
        detail: `${evidence.length} citations from ${groundingChunks.length} Gemini chunks + ${fallbackSources.length} fallback sources`,
        status: (evidence.length > 0 ? "ok" : "warn") as "ok" | "warn",
        durationMs: Date.now() - t4,
      };
      trace.push(tr4);
      await append("tool_call", tr4);

      // Section commits
      await append("section", { name: "short_answer", text: parsed.shortAnswer });
      await append("section", { name: "why_it_matters", text: parsed.whyItMatters });
      await append("section", { name: "evidence", rows: evidence });
      await append("section", { name: "risks", items: parsed.risks });
      await append("section", { name: "next_action", text: parsed.nextAction });

      const totalLatencyMs = Date.now() - t0;
      const totalTokens = inputTokens + outputTokens;
      const estimatedCostUsd =
        (inputTokens / 1_000_000) * GEMINI_INPUT_USD_PER_1M_TOKENS +
        (outputTokens / 1_000_000) * GEMINI_OUTPUT_USD_PER_1M_TOKENS;
      const hash = answerHash({
        prompt: args.prompt,
        tier: args.tier,
        model: args.model,
        shortAnswer: parsed.shortAnswer,
        evidenceUrls: evidence.map((e) => e.source),
      });

      const packet: AnswerPacket = {
        shortAnswer: parsed.shortAnswer,
        whyItMatters: parsed.whyItMatters,
        evidence,
        risks: parsed.risks,
        nextAction: parsed.nextAction,
        sourceCount: evidence.length,
        paidCalls: 1,
        fromMemory: false,
        trace,
      };

      await ctx.runMutation(internal.domains.redesign.chatRuns.finalizeRun, {
        runId: args.runId,
        hash,
        packet,
        totalLatencyMs,
        totalTokens,
        estimatedCostUsd,
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
    const evidence: Array<{ idx: number; source: string; quote: string }> = row.packet.evidence;
    const updates: Array<{ idx: number; verified: boolean; validationError?: string }> = [];
    const tasks = evidence.map((e) => async () => {
      if (Date.now() > totalDeadline) return { idx: e.idx, verified: false, validationError: "global_timeout" };
      const url = e.source;
      if (!/^https?:\/\//i.test(url)) return { idx: e.idx, verified: false, validationError: "not_a_url" };
      const fetched = await fetchPageText(url);
      if (!fetched.ok) return { idx: e.idx, verified: false, validationError: fetched.reason };
      const ok = quoteIsSubstring(e.quote, fetched.text);
      return { idx: e.idx, verified: ok, validationError: ok ? undefined : "quote_not_in_body" };
    });
    const POOL = 4;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(POOL, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const i = cursor++;
        try { updates.push(await tasks[i]()); }
        catch (err: any) { updates.push({ idx: evidence[i].idx, verified: false, validationError: (err?.message || "error").slice(0, 60) }); }
      }
    });
    await Promise.all(workers);
    await ctx.runMutation(internal.domains.redesign.chatRuns.patchEvidenceVerification, {
      runId: args.runId,
      verifications: updates,
    });
    const verifiedCount = updates.filter((u) => u.verified).length;
    await ctx.runMutation(internal.domains.redesign.chatRuns.appendEvent, {
      runId: args.runId,
      eventType: "sources_validated",
      payload: {
        verified: verifiedCount,
        total: updates.length,
        unverified: updates.filter((u) => !u.verified).map((u) => ({ idx: u.idx, reason: u.validationError })),
      } as any,
    });
  },
});

export const getRunForValidation = query({
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
    })),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();
    if (!row?.packet) return;
    const byIdx = new Map<number, { verified: boolean; validationError?: string }>();
    for (const u of args.verifications) byIdx.set(u.idx, { verified: u.verified, validationError: u.validationError });
    const evidence = (row.packet.evidence ?? []).map((e: any) => {
      const u = byIdx.get(e.idx);
      if (!u) return e;
      return { ...e, verified: u.verified, verifiedAt: Date.now(), validationError: u.validationError };
    });
    const verifiedCount = evidence.filter((e: any) => e.verified).length;
    await ctx.db.patch(row._id, {
      packet: {
        ...row.packet,
        evidence,
        sourceCount: evidence.length,
        verifiedSourceCount: verifiedCount,
      },
    });
  },
});
