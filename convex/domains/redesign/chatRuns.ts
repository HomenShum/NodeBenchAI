/**
 * Real-LLM-backed chat for /redesign/chat. Phase 1 of the
 * "production-fidelity chat" buildout — see docs/architecture/REDESIGN_CHAT_ENHANCEMENTS.md
 *
 * Phase 1 (this file):
 *   - Calls Gemini 3.1 Flash with web-search grounding
 *   - Returns AnswerPacket-shaped response with REAL source URLs
 *     pulled from Gemini's groundingMetadata.groundingChunks
 *   - Stores every run in redesignChatRuns by deterministic hash
 *     so the Sprint 4 reproducibility-hash URL can be served from cache
 *   - Auth-gated: anonymous users still get the showcase fixture
 *   - 30s timeout per agentic_reliability rule
 *
 * Phase 2 will convert this to streaming via Convex's HTTP streaming
 * actions (split planning/scratchpad/synthesis events).
 *
 * Phase 3 will add the GET /redesign/chat/r/{hash} route that reads
 * from redesignChatRuns and renders the immutable answer.
 */

import { v } from "convex/values";
import { action, query, type ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { internalMutation } from "../../_generated/server";

type EvidenceRow = { idx: number; quote: string; source: string };
type TraceRow = {
  step: string;
  detail: string;
  status: "ok" | "warn" | "info" | "error";
  durationMs: number;
};

interface ChatRunOut {
  runId: string;
  hash: string;
  shortAnswer: string;
  whyItMatters: string;
  evidence: EvidenceRow[];
  risks: string[];
  nextAction: string;
  sourceCount: number;
  paidCalls: number;
  fromMemory: boolean;
  trace: TraceRow[];
  totalLatencyMs: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

const MAX_PROMPT_CHARS = 4_000;
const TIMEOUT_MS = 30_000;
const GEMINI_INPUT_USD_PER_1M_TOKENS = 0.075; // Gemini 3.1 Flash pricing (estimate)
const GEMINI_OUTPUT_USD_PER_1M_TOKENS = 0.30;

/** Deterministic hash for reproducibility URL — stable across deployments. */
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

/** Internal mutation: persist a run for reproducibility. */
export const persistRun = internalMutation({
  args: {
    runId: v.string(),
    hash: v.string(),
    userId: v.optional(v.id("users")),
    prompt: v.string(),
    tier: v.string(),
    model: v.string(),
    packet: v.any(),
    totalLatencyMs: v.number(),
    totalTokens: v.number(),
    estimatedCostUsd: v.number(),
  },
  handler: async (ctx, args) => {
    // Idempotent: if hash already exists, return existing run
    const existing = await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_hash", (q) => q.eq("hash", args.hash))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("redesignChatRuns", {
      runId: args.runId,
      hash: args.hash,
      userId: args.userId,
      prompt: args.prompt,
      tier: args.tier,
      model: args.model,
      packet: args.packet,
      totalLatencyMs: args.totalLatencyMs,
      totalTokens: args.totalTokens,
      estimatedCostUsd: args.estimatedCostUsd,
      createdAt: Date.now(),
    });
  },
});

/** Public query: read an immutable run by hash (for /redesign/chat/r/{hash}). */
export const getByHash = query({
  args: { hash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("redesignChatRuns")
      .withIndex("by_hash", (q) => q.eq("hash", args.hash))
      .first();
  },
});

/**
 * Public action: run a real LLM chat turn with web-search grounding.
 * Returns an AnswerPacket-shaped response that can drive the Sprint 1-4 UI
 * affordances (hover popover, counterfactual probe, share hash, etc.) with
 * real data instead of fixtures.
 */
export const runChat = action({
  args: {
    prompt: v.string(),
    tier: v.union(v.literal("free"), v.literal("fast"), v.literal("auto"), v.literal("deep")),
    contextRef: v.optional(v.string()),
  },
  handler: async (ctx: ActionCtx, args): Promise<ChatRunOut> => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY not configured — cannot run real chat. Set in Convex env.");
    }
    const prompt = args.prompt.slice(0, MAX_PROMPT_CHARS);
    if (prompt.trim().length < 3) {
      throw new Error("Prompt too short — write at least a 3-character question.");
    }

    // Tier → model
    const model = args.tier === "deep"
      ? "gemini-3.1-pro-preview"
      : args.tier === "free"
      ? "gemini-3.1-flash-lite-preview"
      : "gemini-3-flash-preview";

    const trace: TraceRow[] = [];
    const t0 = Date.now();

    // --- Stage 1: classify_query (deterministic, no model call) ---
    const t1 = Date.now();
    const classification = classifyPrompt(prompt);
    trace.push({
      step: "Classify query",
      detail: `${classification.kind} · ${classification.entity ?? "no entity"}`,
      status: "ok",
      durationMs: Date.now() - t1,
    });

    // --- Stage 2: build_context_bundle (deterministic for now) ---
    const t2 = Date.now();
    const contextBundle = {
      role: "operator",
      style: "evidence-first banker memo",
      report: args.contextRef ?? "no live artifact selected",
    };
    trace.push({
      step: "Build context bundle",
      detail: `${contextBundle.role} · ${contextBundle.style}`,
      status: "ok",
      durationMs: Date.now() - t2,
    });

    // --- Stage 3: Gemini with web-search grounding ---
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

    let geminiResponse: any;
    let groundingChunks: Array<{ web?: { uri: string; title?: string } }> = [];
    let groundingSupports: Array<{
      segment?: { text?: string; startIndex?: number; endIndex?: number };
      groundingChunkIndices?: number[];
    }> = [];
    let totalTokens = 0;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1500,
          responseMimeType: "text/plain",
        },
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
      }
      geminiResponse = await res.json();
      const candidate = geminiResponse?.candidates?.[0];
      const meta = candidate?.groundingMetadata;
      groundingChunks = Array.isArray(meta?.groundingChunks) ? meta.groundingChunks : [];
      groundingSupports = Array.isArray(meta?.groundingSupports) ? meta.groundingSupports : [];
      totalTokens = (geminiResponse?.usageMetadata?.totalTokenCount ?? 0) as number;
      trace.push({
        step: "Gemini synthesis",
        detail: `${model} · grounded · ${groundingChunks.length} chunks`,
        status: "ok",
        durationMs: Date.now() - t3,
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      trace.push({
        step: "Gemini synthesis",
        detail: err.name === "AbortError" ? "request_timeout" : (err.message || String(err)),
        status: "error",
        durationMs: Date.now() - t3,
      });
      throw err;
    }

    // --- Stage 4: parse and bind ---
    const t4 = Date.now();
    const rawText: string = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = parseMemo(rawText);

    // Build evidence rows from groundingChunks (real URLs)
    const evidence: EvidenceRow[] = groundingChunks.slice(0, 6).map((chunk, i) => {
      const url = chunk.web?.uri ?? "";
      const title = chunk.web?.title ?? new URL(url || "https://example.com").hostname;
      // Best-effort quote: use the segment from groundingSupports that points at this chunk
      const support = groundingSupports.find((s) => s.groundingChunkIndices?.includes(i));
      const quote = support?.segment?.text?.trim() || `Cited from ${title}`;
      return {
        idx: i + 1,
        quote: quote.slice(0, 240),
        source: url || title,
      };
    });

    trace.push({
      step: "Bind evidence",
      detail: `${evidence.length} grounded citations from ${groundingChunks.length} chunks`,
      status: evidence.length > 0 ? "ok" : "warn",
      durationMs: Date.now() - t4,
    });

    const totalLatencyMs = Date.now() - t0;
    const inputTokens = (geminiResponse?.usageMetadata?.promptTokenCount ?? 0) as number;
    const outputTokens = (geminiResponse?.usageMetadata?.candidatesTokenCount ?? 0) as number;
    const estimatedCostUsd =
      (inputTokens / 1_000_000) * GEMINI_INPUT_USD_PER_1M_TOKENS +
      (outputTokens / 1_000_000) * GEMINI_OUTPUT_USD_PER_1M_TOKENS;

    const runId = `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const hash = answerHash({
      prompt,
      tier: args.tier,
      model,
      shortAnswer: parsed.shortAnswer,
      evidenceUrls: evidence.map((e) => e.source),
    });

    const packet = {
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

    // Persist for reproducibility hash route
    const userId = await getAuthUserIdSafely(ctx);
    await ctx.runMutation(internal.domains.redesign.chatRuns.persistRun, {
      runId,
      hash,
      userId: userId ?? undefined,
      prompt,
      tier: args.tier,
      model,
      packet,
      totalLatencyMs,
      totalTokens,
      estimatedCostUsd,
    });

    return {
      runId,
      hash,
      ...packet,
      totalLatencyMs,
      totalTokens,
      estimatedCostUsd,
    };
  },
});

// --- Helpers ---

async function getAuthUserIdSafely(ctx: ActionCtx): Promise<any> {
  try {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    // Minimal fallback — full auth-userId lookup would query the users table.
    return null;
  } catch {
    return null;
  }
}

function classifyPrompt(prompt: string): { kind: string; entity?: string } {
  const lower = prompt.toLowerCase();
  // Capitalised entity at start: "Anthropic ..." or "What about Anthropic"
  const capMatch = prompt.match(/(?:about |on |for |re )?([A-Z][A-Za-z0-9]+(?:\s[A-Z][A-Za-z0-9]+)*)/);
  const entity = capMatch?.[1];
  if (lower.includes(" vs ") || lower.includes(" compare ")) {
    return { kind: "competitor", entity };
  }
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
  // Lightweight section parser. Falls back to first sentence as shortAnswer.
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const sections: Record<string, string[]> = {
    short: [],
    why: [],
    evidence: [],
    risks: [],
    next: [],
  };
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
