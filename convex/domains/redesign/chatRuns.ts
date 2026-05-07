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
    tier: v.union(v.literal("free"), v.literal("fast"), v.literal("auto"), v.literal("deep")),
    contextRef: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const prompt = args.prompt.slice(0, MAX_PROMPT_CHARS);
    if (prompt.trim().length < 3) {
      throw new Error("Prompt too short — write at least a 3-character question.");
    }
    const model = args.tier === "deep" ? "gemini-3.1-pro-preview"
      : args.tier === "free" ? "gemini-3.1-flash-lite-preview"
      : "gemini-3-flash-preview";
    const runId = generateRunId();
    let userId: any = undefined;
    try {
      const identity = await ctx.auth.getUserIdentity();
      if (identity?.subject) {
        // Best-effort lookup; not strictly required for the run to succeed.
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
      tier: args.tier,
      model,
      status: "pending",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.domains.redesign.chatRuns.runStreamingChat, {
      runId,
      prompt,
      tier: args.tier,
      contextRef: args.contextRef,
      model,
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
      const systemPrompt = `You are NodeBench's evidence-first analyst. Produce a banker-style memo with:
1. Short answer (one sentence with citation markers like [1] [2])
2. Why it matters (one paragraph with citation markers)
3. Evidence (3-5 bullets, each citing a source)
4. Risks / unknowns (2-3 bullets)
5. Next action (one imperative sentence)

Use [1], [2], [3] inline cite markers in the prose. Keep claims grounded in the web sources you retrieve. Prefer recency. If you can't find grounded evidence, say so explicitly.

Context: ${JSON.stringify(contextBundle)}`;

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
      const t4 = Date.now();
      const parsed = parseMemo(rawText);
      const evidence: EvidenceRow[] = groundingChunks.slice(0, 6).map((chunk, i) => {
        const url = chunk.web?.uri ?? "";
        let host = url;
        try { host = new URL(url || "https://example.com").hostname; } catch { /* ignore */ }
        const title = chunk.web?.title ?? host;
        const support = groundingSupports.find((s) => s.groundingChunkIndices?.includes(i));
        const quote = support?.segment?.text?.trim() || `Cited from ${title}`;
        return { idx: i + 1, quote: quote.slice(0, 240), source: url || title };
      });
      const tr4 = {
        step: "Bind evidence",
        detail: `${evidence.length} grounded citations from ${groundingChunks.length} chunks`,
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
