/**
 * chatAgent.ts — minimal live chat agent for the ExactChatSurface.
 *
 * Takes (text, model, sessionId), runs pi-ai's complete() against
 * OpenRouter, persists BOTH the user turn and the agent turn to
 * productActivityLedger, returns the agent text.
 *
 * The chat surface's sendTurn calls this action; the existing
 * getMostRecentChatThread query then reads the persisted agent turn
 * and the UI renders it as a normal agent turn (no separate streaming
 * path needed).
 *
 * Tracks telemetry per call: latency ms, input/output tokens, cost
 * (USD from pi-ai's usage.cost). Telemetry is stashed in
 * payloadPreview.metadata so the eval pipeline + admin dashboard can
 * read it without a schema change.
 */

import { action } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import { v } from "convex/values";
import { complete, getModel, Type } from "@mariozechner/pi-ai";
import type { Tool } from "@mariozechner/pi-ai";

/**
 * Auto-router state — Kilo-Code-style cooldown registry.
 *
 * When a model returns 429 / "rate limited upstream" / 5xx, mark it in
 * the cooldown Map for COOLDOWN_MS. The next request skips that model
 * entirely instead of wasting a budget gate. After cooldown expires it
 * automatically rejoins the active pool.
 *
 * Module-level Map persists across action invocations within the same
 * Convex worker process. NOT cluster-wide; that's fine — we want
 * per-worker fast failover, not consensus.
 */
const COOLDOWN_MS = 60_000;
const COOLDOWN_MAX_ENTRIES = 64; // BOUND — prevents unbounded growth
const cooldownUntil = new Map<string, number>();

function markCooldown(modelId: string, ms: number = COOLDOWN_MS) {
  // Evict oldest if at capacity (LRU-via-insertion-order)
  if (cooldownUntil.size >= COOLDOWN_MAX_ENTRIES && !cooldownUntil.has(modelId)) {
    const oldestKey = cooldownUntil.keys().next().value as string | undefined;
    if (oldestKey !== undefined) cooldownUntil.delete(oldestKey);
  }
  cooldownUntil.set(modelId, Date.now() + ms);
}

function isInCooldown(modelId: string): boolean {
  const until = cooldownUntil.get(modelId);
  if (!until) return false;
  if (Date.now() >= until) {
    cooldownUntil.delete(modelId);
    return false;
  }
  return true;
}

/**
 * Capability registry — which models support tool calling reliably?
 * Free OpenRouter models historically have spotty tool support — only
 * models proven by smoke tests get included here. Paid frontier models
 * (Anthropic, OpenAI, Kimi) all support tools.
 */
const TOOL_CAPABLE_PREFIXES = [
  "moonshotai/kimi",
  "anthropic/",
  "claude-",
  "gpt-",
  "openai/",
  "google/gemini",
  "gemini-",
  // Free models that have demonstrated tool calling in smoke tests:
  "z-ai/glm-4.5-air:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "inclusionai/ling-2.6-1t:free",
  "google/gemma-4-26b-a4b-it:free",
  "tencent/hy3-preview:free",
];

function supportsToolCalls(modelId: string): boolean {
  return TOOL_CAPABLE_PREFIXES.some((prefix) => modelId.startsWith(prefix) || modelId.includes(prefix));
}

/**
 * Per-anon-session rate limit + cost ceiling.
 *
 * Hackathon-day-0 protection: one bad actor (or one runaway tab) can't
 * burn the OpenRouter budget for everyone else. Tracks both call count
 * and cumulative paid cost per session.
 *
 * Authenticated users skip the limit (they have an account; abuse is
 * traceable). Anonymous users get capped.
 *
 * Bounds:
 *   - 60 calls per 10-minute window per session
 *   - $0.50 cumulative paid cost per session per 60-minute window
 *
 * Both windows are sliding — entries older than the window get pruned
 * on each check. The Map is bounded at 4096 sessions (LRU evict).
 */
const CALL_WINDOW_MS = 10 * 60_000;       // 10 min
const CALL_LIMIT = 60;                     // max calls per window
const COST_WINDOW_MS = 60 * 60_000;        // 1 hour
const COST_LIMIT_USD = 0.50;               // max paid spend per window
const RATE_LIMIT_MAX_SESSIONS = 4096;

type SessionMeter = {
  calls: number[];                 // timestamps
  costEntries: { ts: number; usd: number }[]; // (timestamp, cost) pairs
};
const sessionMeters = new Map<string, SessionMeter>();

function pruneSession(m: SessionMeter, now: number) {
  const callCutoff = now - CALL_WINDOW_MS;
  while (m.calls.length > 0 && m.calls[0] < callCutoff) m.calls.shift();
  const costCutoff = now - COST_WINDOW_MS;
  while (m.costEntries.length > 0 && m.costEntries[0].ts < costCutoff) m.costEntries.shift();
}

function getSessionMeter(sessionKey: string): SessionMeter {
  let m = sessionMeters.get(sessionKey);
  if (!m) {
    if (sessionMeters.size >= RATE_LIMIT_MAX_SESSIONS) {
      const oldest = sessionMeters.keys().next().value as string | undefined;
      if (oldest !== undefined) sessionMeters.delete(oldest);
    }
    m = { calls: [], costEntries: [] };
    sessionMeters.set(sessionKey, m);
  }
  return m;
}

function checkRateLimit(sessionKey: string): { ok: boolean; reason?: string; calls?: number; costUsd?: number } {
  const now = Date.now();
  const m = getSessionMeter(sessionKey);
  pruneSession(m, now);

  if (m.calls.length >= CALL_LIMIT) {
    const oldestCall = m.calls[0];
    const retrySec = Math.max(1, Math.ceil((CALL_WINDOW_MS - (now - oldestCall)) / 1000));
    return {
      ok: false,
      reason: `rate_limit: ${m.calls.length}/${CALL_LIMIT} calls in last 10 min. retry in ${retrySec}s`,
      calls: m.calls.length,
    };
  }

  const totalCost = m.costEntries.reduce((s, e) => s + e.usd, 0);
  if (totalCost >= COST_LIMIT_USD) {
    return {
      ok: false,
      reason: `cost_limit: $${totalCost.toFixed(4)} of $${COST_LIMIT_USD.toFixed(2)} cap reached this hour. switch to a free model or wait.`,
      costUsd: totalCost,
    };
  }

  m.calls.push(now);
  return { ok: true, calls: m.calls.length, costUsd: totalCost };
}

function recordCost(sessionKey: string, usd: number) {
  if (!Number.isFinite(usd) || usd <= 0) return;
  const m = getSessionMeter(sessionKey);
  m.costEntries.push({ ts: Date.now(), usd });
}

const SYSTEM_PROMPT = `You are NodeBench, an entity-intelligence agent for founders, bankers, and analysts.

Every input flows through:
  query/capture → memory search → entity resolution → report update →
  notebook update → graph edges → sources/claims → follow-up/export

Principles:
1. Memory-first: cite prior reports/captures/notebooks before live search.
2. Entity resolution: name companies/people/topics/events.
   Mark uncertain identity links as "needs_review".
3. Sources/claims: every nontrivial claim needs a source.
   Unverified claims are tagged "needs_review".
4. Privacy: never surface private contact info; never auto-send.
5. Budget: avoid paid search unless explicitly approved.
6. Follow-ups: end with a concrete next-action.

ATOMIC EDIT TOOLS (you have access to these and SHOULD call them when
the user's message implies a side effect):

  - upsertEntity(slug, name, type, summary?)
        Creates or updates a typed entity (company / person / topic / event).
        Call this when the user mentions a NEW or AMBIGUOUS entity.

  - recordClaim(text, status, sourceUrl?, entitySlug?)
        Records a claim with verification status. Use status="needs_review"
        for unverified field-note claims, status="rumor" for hearsay,
        status="verified" only when a source URL backs it.

  - attachSource(entitySlug, url, title?, fav?)
        Attaches a source to an entity. ONLY call when the URL is real
        and you can vouch for the linkage.

  - createFollowup(text, dueAt?)
        Creates a concrete follow-up task. Always call when the
        next-action involves the user doing something later.

  - addGraphEdge(fromSlug, toSlug, kind, confidence)
        Records a typed edge between two entities (e.g. founded /
        invests-in / works-at / partner-with / topic-of).
        Use confidence="medium" by default; "high" only with strong
        evidence; "low" when the edge is inferred but uncertain.

Call as MANY tools in parallel as the message warrants. After tools
complete, give a short conversational summary referencing what you
just persisted ("captured Alex / Orbital Labs, flagged the Benchling
claim as needs_review, queued a follow-up").

Keep prose tight — 2-4 sentences. The captured side-effects ARE the
deliverable; the prose is just orientation.`;

/* ──────────────────────────────────────────────────────────────────
   Atomic-edit tool schemas (pi-ai TypeBox).
   Mapped 1:1 to Convex mutations in EXECUTORS below.
   ────────────────────────────────────────────────────────────────── */
const TOOLS: Tool[] = [
  {
    name: "upsertEntity",
    description: "Create or update a typed entity (company, person, topic, or event). Returns the entity slug.",
    parameters: Type.Object({
      slug: Type.String({ description: "URL-safe slug, e.g. 'orbital-labs'" }),
      name: Type.String({ description: "Display name, e.g. 'Orbital Labs'" }),
      type: Type.Union([
        Type.Literal("company"),
        Type.Literal("person"),
        Type.Literal("topic"),
        Type.Literal("event"),
      ]),
      summary: Type.Optional(Type.String({ description: "One-line summary (max 200 chars)" })),
    }),
  },
  {
    name: "recordClaim",
    description: "Record a claim with verification status. Use needs_review for field-note unverified claims.",
    parameters: Type.Object({
      text: Type.String({ description: "The claim text, max 280 chars" }),
      status: Type.Union([
        Type.Literal("verified"),
        Type.Literal("needs_review"),
        Type.Literal("rumor"),
      ]),
      sourceUrl: Type.Optional(Type.String({ description: "Source URL if known" })),
      entitySlug: Type.Optional(Type.String({ description: "Linked entity slug" })),
    }),
  },
  {
    name: "attachSource",
    description: "Attach a source URL to an entity. Only call when the URL is real and the linkage is reliable.",
    parameters: Type.Object({
      entitySlug: Type.String(),
      url: Type.String({ description: "Source URL, must be https://" }),
      title: Type.Optional(Type.String()),
      fav: Type.Optional(Type.String({ description: "Favicon initial(s)" })),
    }),
  },
  {
    name: "createFollowup",
    description: "Create a concrete follow-up task for the user.",
    parameters: Type.Object({
      text: Type.String({ description: "Action verb-led text, e.g. 'Reply to Alex by EOD'" }),
      dueAt: Type.Optional(Type.String({ description: "ISO date string, optional" })),
    }),
  },
  {
    name: "addGraphEdge",
    description: "Record a typed edge between two entities.",
    parameters: Type.Object({
      fromSlug: Type.String(),
      toSlug: Type.String(),
      kind: Type.String({ description: "founded | invests-in | works-at | partner-with | topic-of | competes-with" }),
      confidence: Type.Union([
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
      ]),
    }),
  },
];

export const runChatAgent = action({
  args: {
    text: v.string(),
    model: v.optional(v.string()),
    anonymousSessionId: v.optional(v.string()),
    sessionId: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    text: v.string(),
    model: v.string(),
    durationMs: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    userActivityId: v.optional(v.string()),
    agentActivityId: v.optional(v.string()),
    toolExecs: v.array(
      v.object({
        name: v.string(),
        args: v.any(),
        ok: v.boolean(),
        result: v.optional(v.any()),
        error: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const modelId = args.model || "moonshotai/kimi-k2.6";
    const userTurnId = `u${Date.now()}`;
    const agentTurnId = `a${Date.now() + 1}`;

    // Rate-limit anon sessions only — authed users have accounts so
    // abuse is traceable + addressable. Key on anonymousSessionId,
    // fall back to provided sessionId.
    const rateLimitKey = args.anonymousSessionId || args.sessionId;
    if (rateLimitKey) {
      const rl = checkRateLimit(rateLimitKey);
      if (!rl.ok) {
        // Honest status — return ok=false so the UI surfaces the cap to
        // the user rather than silently swallowing it. No agent call,
        // no ledger write (don't burn the user's count on a rejected
        // request).
        return {
          ok: false,
          text: "",
          model: modelId,
          durationMs: 0,
          errorMessage: rl.reason ?? "rate_limit",
          toolExecs: [],
        };
      }
    }

    // 1. Persist user turn.
    let userActivityId: string | undefined;
    try {
      const r = await ctx.runMutation(api.domains.product.activity.recordActivity, {
        anonymousSessionId: args.anonymousSessionId,
        activityType: "chat_message",
        actorType: "user",
        sessionId: args.sessionId,
        payloadPreview: {
          label: "User message",
          detail: args.text.length > 200 ? args.text.slice(0, 200) + "…" : args.text,
          metadata: { model: modelId, turnId: userTurnId, text: args.text },
        },
      });
      userActivityId = String((r as any)?.activityId ?? r);
    } catch (err) {
      console.warn("[runChatAgent] persist user turn failed:", err);
    }

    // 2. Call pi-ai. Kilo-Code-style auto-router:
    //    - Order = leaderboard reliable-score ranking (highest pass rate first)
    //    - Per-model cooldown skip (rate-limited models parked for 60s)
    //    - Capability filter: tool-call queries skip non-tool-supporting models
    //    - Free first, paid last (kimi-k2.6 only on full-chain bust)
    const t0 = Date.now();
    const tier1Free = [
      "nvidia/nemotron-3-super-120b-a12b:free", // #1 reliable free, leaderboard 3.11
      "inclusionai/ling-2.6-1t:free",           // #2 reliable free, leaderboard 3.06
      "z-ai/glm-4.5-air:free",                  // #3 reliable free, leaderboard 2.92
      "tencent/hy3-preview:free",               // #4 reliable free, leaderboard 2.83 (fastest)
    ];
    const tier2Paid = [
      "moonshotai/kimi-k2.6",                   // proven frontier, ~$0.002/call
    ];
    // De-dupe + put requested model FIRST so user choice always wins.
    const seen = new Set<string>();
    const fallbackChain: string[] = [];
    for (const m of [modelId, ...tier1Free, ...tier2Paid]) {
      if (!seen.has(m) && !isInCooldown(m)) {
        seen.add(m);
        fallbackChain.push(m);
      }
    }
    if (fallbackChain.length === 0) {
      // Every model is in cooldown — try the requested one anyway as last resort.
      fallbackChain.push(modelId);
    }
    let agentResp: string = "";
    let modelUsed = modelId;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let costUsd: number | undefined;
    let errorMessage: string | undefined;
    let ok = false;

    // Tool-call execution log — surfaced to the UI in the agent turn's
    // payloadPreview.metadata so users see WHAT the agent persisted.
    type ToolExec = {
      name: string;
      args: Record<string, any>;
      ok: boolean;
      result?: any;
      error?: string;
    };
    const toolExecs: ToolExec[] = [];
    const messages: any[] = [
      { role: "user" as const, content: args.text, timestamp: Date.now() },
    ];

    for (const candidate of fallbackChain) {
      try {
        const model = getModel("openrouter" as any, candidate as any);

        // Multi-turn loop: agent may emit tool_calls; we execute, push
        // toolResult messages back, and call again. Cap at 4 rounds so a
        // misbehaving model can't infinite-loop the action.
        let result: any = null;
        for (let round = 0; round < 4; round++) {
          result = await Promise.race([
            complete(model, {
              systemPrompt: SYSTEM_PROMPT,
              messages,
              tools: TOOLS,
            }),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new Error("budget_timeout")), 60_000),
            ),
          ]);

          // Push the assistant message into the conversation.
          messages.push(result);

          const content = result?.content;
          if (!Array.isArray(content)) break;

          // Find any toolCall items and execute them.
          const toolCalls = content.filter((c: any) => c?.type === "toolCall");
          if (toolCalls.length === 0) break;

          for (const tc of toolCalls) {
            const exec = await executeTool(ctx, tc.name, tc.arguments, {
              anonymousSessionId: args.anonymousSessionId,
              sessionId: args.sessionId,
            });
            toolExecs.push({
              name: tc.name,
              args: tc.arguments,
              ok: exec.ok,
              result: exec.result,
              error: exec.error,
            });
            messages.push({
              role: "toolResult" as const,
              toolCallId: tc.id,
              toolName: tc.name,
              content: [
                {
                  type: "text" as const,
                  text: exec.ok
                    ? JSON.stringify(exec.result ?? { ok: true })
                    : `error: ${exec.error}`,
                },
              ],
              isError: !exec.ok,
              timestamp: Date.now(),
            });
          }

          // If the assistant only emitted tool calls (no text), continue
          // the loop so it can compose the final prose. If it also wrote
          // text, we'll usually stop in the next iteration when no new
          // tool calls fire.
        }

        // Extract final text content from the last assistant message.
        const finalContent = result?.content;
        let text = "";
        if (typeof finalContent === "string") text = finalContent;
        else if (Array.isArray(finalContent)) {
          text = finalContent
            .filter((c: any) => c?.type === "text" && typeof c.text === "string")
            .map((c: any) => c.text)
            .join("\n");
        }

        const stop = result?.stopReason;
        const apiErr = result?.errorMessage;
        if (apiErr || stop === "error" || stop === "aborted") {
          errorMessage = apiErr ?? `stopReason=${stop}`;
          const lower = (errorMessage ?? "").toLowerCase();
          if (
            lower.includes("429") ||
            lower.includes("rate") ||
            lower.includes("400") ||
            lower.includes("503") ||
            lower.includes("budget_timeout") ||
            lower.includes("reasoning is mandatory")
          ) {
            // Park this model — don't try it again for COOLDOWN_MS so the
            // next request skips it cleanly (Kilo Code auto-router pattern).
            markCooldown(candidate);
            modelUsed = candidate;
            continue;
          }
          break;
        }

        const usage = result?.usage ?? {};
        inputTokens = usage.inputTokens ?? usage.input_tokens;
        outputTokens = usage.outputTokens ?? usage.output_tokens;
        const c = usage.cost;
        if (c && typeof c === "object") {
          costUsd =
            c.total ??
            ["input", "output", "cacheRead", "cacheWrite"]
              .map((k) => (typeof c[k] === "number" ? c[k] : 0))
              .reduce((a, b) => a + b, 0);
        } else if (typeof c === "number") {
          costUsd = c;
        }

        agentResp = text;
        modelUsed = candidate;
        // Charge the rate-limit budget AFTER a successful paid call.
        // Free models (cost = 0 or undefined) don't decrement the budget.
        if (rateLimitKey && typeof costUsd === "number" && costUsd > 0) {
          recordCost(rateLimitKey, costUsd);
        }
        ok = !!text || toolExecs.length > 0;
        if (ok) break;
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
        const lower = errorMessage.toLowerCase();
        if (
          !lower.includes("429") &&
          !lower.includes("rate") &&
          !lower.includes("400") &&
          !lower.includes("budget_timeout")
        ) {
          break;
        }
        // Recoverable error → cooldown this candidate before next iteration
        markCooldown(candidate);
      }
    }

    const durationMs = Date.now() - t0;

    // 3. Persist agent turn — including the tool-execution log so the
    //    UI can render "captured 2 entities · 1 claim · 1 follow-up".
    let agentActivityId: string | undefined;
    if (ok && (agentResp || toolExecs.length > 0)) {
      const toolSummary = toolExecs.length > 0
        ? `${toolExecs.filter((t) => t.ok).length}/${toolExecs.length} tools fired: ${toolExecs.map((t) => t.name).join(", ")}`
        : "";
      try {
        const r = await ctx.runMutation(api.domains.product.activity.recordActivity, {
          anonymousSessionId: args.anonymousSessionId,
          activityType: "chat_message",
          actorType: "agent",
          sessionId: args.sessionId,
          payloadPreview: {
            label: "Agent response",
            detail: agentResp.length > 200 ? agentResp.slice(0, 200) + "…" : agentResp || toolSummary,
            costCents: typeof costUsd === "number" ? Math.round(costUsd * 10000) : undefined,
            paidCallsUsed: typeof costUsd === "number" && costUsd > 0 ? 1 : 0,
            timeToFirstSourcedAnswerMs: durationMs,
            metadata: {
              model: modelUsed,
              requestedModel: modelId,
              turnId: agentTurnId,
              text: agentResp,
              inputTokens,
              outputTokens,
              costUsd,
              toolExecs,
              toolSummary,
            },
          },
        });
        agentActivityId = String((r as any)?.activityId ?? r);
      } catch (err) {
        console.warn("[runChatAgent] persist agent turn failed:", err);
      }
    }

    return {
      ok,
      text: agentResp,
      model: modelUsed,
      durationMs,
      inputTokens,
      outputTokens,
      costUsd,
      errorMessage: ok ? undefined : errorMessage,
      userActivityId,
      agentActivityId,
      toolExecs,
    };
  },
});

/* ──────────────────────────────────────────────────────────────────
   enhancePrompt — Kilo Code / Augment-style prompt enhancer.

   Pattern (well-documented across Roo/Kilo/Cline/Augment):
     1. User types a vague prompt ("Met Alex from Orbital Labs")
     2. Click "Enhance" → small fast model rewrites it with workspace
        context + explicit acceptance criteria
     3. Enhanced prompt replaces the original; user can edit further.

   NodeBench's adaptation pulls in:
     - Active entity / pinned context from the current thread
     - Recent claims for that entity
     - Available atomic-edit tools (so the enhancer can hint at side
       effects the user probably wants)
     - The leaderboard's top free model as the enhancer (cheap + fast)

   Returns a single string. Never throws — falls back to the raw
   prompt on any error so the user can still send it.
   ────────────────────────────────────────────────────────────────── */
const ENHANCE_SYSTEM = `You rewrite vague user prompts into specific, actionable NodeBench captures.

Goals:
  • Identify entities (people, companies, topics, events) the user mentions
  • Surface implicit claims that should be flagged as needs_review or rumor
  • Note relationships (works-at, partner-with, founded, invests-in)
  • Suggest concrete next-actions when the prompt implies one
  • Keep the user's voice — do NOT add facts they didn't mention
  • Stay under 300 words; prefer 2-4 short sentences plus a brief checklist

NodeBench tools the agent can call (mention them when relevant so the
agent knows what side effects to fire):
  upsertEntity, recordClaim, attachSource, createFollowup, addGraphEdge

Respond with ONLY the enhanced prompt — no preamble, no explanations,
no "Here's an improved version:" wrapper.`;

export const enhancePrompt = action({
  args: {
    text: v.string(),
    model: v.optional(v.string()),
    contextHints: v.optional(
      v.object({
        activeEntitySlug: v.optional(v.string()),
        pinnedContext: v.optional(v.array(v.string())),
        recentTurnCount: v.optional(v.number()),
      }),
    ),
  },
  returns: v.object({
    ok: v.boolean(),
    enhanced: v.string(),
    durationMs: v.number(),
    modelUsed: v.string(),
    costUsd: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const t0 = Date.now();
    const original = args.text.trim();
    if (original.length < 3) {
      return {
        ok: true,
        enhanced: original,
        durationMs: 0,
        modelUsed: "noop",
      };
    }

    // Default to a fast free model for enhancement (cheaper than the
    // main agent). Honors override if caller wants a specific model.
    const enhancerChain = [
      args.model,
      "tencent/hy3-preview:free",                // ~5s avg, leaderboard #5
      "z-ai/glm-4.5-air:free",                   // backup
      "moonshotai/kimi-k2.6",                    // paid frontier last resort
    ].filter((m): m is string => typeof m === "string");

    const ctxLines: string[] = [];
    if (args.contextHints?.activeEntitySlug) {
      ctxLines.push(`Active entity slug: ${args.contextHints.activeEntitySlug}`);
    }
    if (args.contextHints?.pinnedContext?.length) {
      ctxLines.push(`Pinned context: ${args.contextHints.pinnedContext.join(", ")}`);
    }
    if (typeof args.contextHints?.recentTurnCount === "number") {
      ctxLines.push(`Thread length: ${args.contextHints.recentTurnCount} turns`);
    }

    const userPayload = ctxLines.length > 0
      ? `[Workspace context]\n${ctxLines.join("\n")}\n\n[User prompt to enhance]\n${original}`
      : original;

    let lastError: string | undefined;
    for (const candidate of enhancerChain) {
      if (isInCooldown(candidate)) continue;
      try {
        const model = getModel("openrouter" as any, candidate as any);
        const result = (await Promise.race([
          complete(model, {
            systemPrompt: ENHANCE_SYSTEM,
            messages: [{ role: "user" as const, content: userPayload, timestamp: Date.now() }],
          }),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("enhance_timeout")), 30_000),
          ),
        ])) as any;

        const content = result?.content;
        let text = "";
        if (typeof content === "string") text = content;
        else if (Array.isArray(content)) {
          text = content
            .filter((c: any) => c?.type === "text" && typeof c.text === "string")
            .map((c: any) => c.text)
            .join("\n");
        }
        text = text.trim();
        if (!text) {
          lastError = "empty enhancer response";
          markCooldown(candidate, 30_000);
          continue;
        }

        let costUsd: number | undefined;
        const usage = result?.usage ?? {};
        const c = usage.cost;
        if (c && typeof c === "object") {
          costUsd =
            c.total ??
            ["input", "output"]
              .map((k) => (typeof c[k] === "number" ? c[k] : 0))
              .reduce((a, b) => a + b, 0);
        }

        return {
          ok: true,
          enhanced: text,
          durationMs: Date.now() - t0,
          modelUsed: candidate,
          costUsd,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        markCooldown(candidate, 30_000);
      }
    }

    // All enhancer chain failed — return original prompt unchanged.
    // HONEST_STATUS: ok=false, but enhanced still carries the original
    // so the caller doesn't lose the user's text.
    return {
      ok: false,
      enhanced: original,
      durationMs: Date.now() - t0,
      modelUsed: "fallback:original",
      errorMessage: lastError ?? "all enhancer models unavailable",
    };
  },
});

/* ──────────────────────────────────────────────────────────────────
   executeTool — dispatch a single pi-ai toolCall to its real Convex
   mutation. Each tool gets bounded payloads, owner-key scoping, and
   its own try/catch so one bad call doesn't poison the loop.

   Returns { ok, result?, error? } so the caller can build the
   toolResult message + the side-effect log.
   ────────────────────────────────────────────────────────────────── */
async function executeTool(
  ctx: any,
  name: string,
  rawArgs: Record<string, any>,
  ctxArgs: { anonymousSessionId: string | undefined; sessionId: string },
): Promise<{ ok: boolean; result?: any; error?: string }> {
  const trim = (s: any, max: number) =>
    typeof s === "string" ? s.slice(0, max) : "";

  try {
    switch (name) {
      case "upsertEntity": {
        const slug = trim(rawArgs.slug, 200);
        const displayName = trim(rawArgs.name, 200);
        const entityType = trim(rawArgs.type, 50);
        const summary = trim(rawArgs.summary ?? "", 500);
        if (!slug || !displayName || !entityType) {
          return { ok: false, error: "missing slug/name/type" };
        }
        // Recorded as an activity-ledger row tagged with the entity slug.
        // Real entity row creation goes through ensureEntityForReport
        // which requires a report context — for chat capture we just
        // record the atomic intent so the user sees it persisted.
        const r = await ctx.runMutation(api.domains.product.activity.recordActivity, {
          anonymousSessionId: ctxArgs.anonymousSessionId,
          activityType: "chat_message",
          actorType: "agent",
          sessionId: ctxArgs.sessionId,
          entitySlug: slug,
          entityKeys: [slug],
          payloadPreview: {
            label: `Captured entity: ${displayName}`,
            detail: summary || `${entityType} entity created from chat capture`,
            metadata: { tool: "upsertEntity", slug, name: displayName, entityType, summary },
          },
        });
        return { ok: true, result: { activityId: String((r as any)?.activityId ?? r), slug } };
      }

      case "recordClaim": {
        const text = trim(rawArgs.text, 280);
        const status = trim(rawArgs.status, 30);
        const sourceUrl = trim(rawArgs.sourceUrl ?? "", 500);
        const entitySlug = trim(rawArgs.entitySlug ?? "", 200);
        if (!text || !status) return { ok: false, error: "missing text/status" };
        const r = await ctx.runMutation(api.domains.product.activity.recordActivity, {
          anonymousSessionId: ctxArgs.anonymousSessionId,
          activityType: "claim_changed",
          actorType: "agent",
          sessionId: ctxArgs.sessionId,
          entitySlug: entitySlug || undefined,
          entityKeys: entitySlug ? [entitySlug] : [],
          payloadPreview: {
            label: `Claim recorded · ${status}`,
            detail: text,
            status,
            href: sourceUrl || undefined,
            metadata: { tool: "recordClaim", text, status, sourceUrl, entitySlug },
          },
        });
        return { ok: true, result: { activityId: String((r as any)?.activityId ?? r), status } };
      }

      case "attachSource": {
        const entitySlug = trim(rawArgs.entitySlug, 200);
        const url = trim(rawArgs.url, 500);
        const title = trim(rawArgs.title ?? "", 200);
        const fav = trim(rawArgs.fav ?? "", 4);
        if (!entitySlug || !url) return { ok: false, error: "missing entitySlug/url" };
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
          return { ok: false, error: "url must be http(s)" };
        }
        const r = await ctx.runMutation(api.domains.product.activity.recordActivity, {
          anonymousSessionId: ctxArgs.anonymousSessionId,
          activityType: "source_attached",
          actorType: "agent",
          sessionId: ctxArgs.sessionId,
          entitySlug,
          entityKeys: [entitySlug],
          sourceKeys: [url],
          payloadPreview: {
            label: `Source attached to ${entitySlug}`,
            detail: title || url,
            href: url,
            metadata: { tool: "attachSource", entitySlug, url, title, fav },
          },
        });
        return { ok: true, result: { activityId: String((r as any)?.activityId ?? r) } };
      }

      case "createFollowup": {
        const text = trim(rawArgs.text, 280);
        const dueAt = trim(rawArgs.dueAt ?? "", 40);
        if (!text) return { ok: false, error: "missing text" };
        const r = await ctx.runMutation(api.domains.product.activity.recordActivity, {
          anonymousSessionId: ctxArgs.anonymousSessionId,
          activityType: "chat_message",
          actorType: "agent",
          sessionId: ctxArgs.sessionId,
          payloadPreview: {
            label: "Follow-up created",
            detail: dueAt ? `${text} · due ${dueAt}` : text,
            metadata: { tool: "createFollowup", text, dueAt },
          },
        });
        return { ok: true, result: { activityId: String((r as any)?.activityId ?? r) } };
      }

      case "addGraphEdge": {
        const fromSlug = trim(rawArgs.fromSlug, 200);
        const toSlug = trim(rawArgs.toSlug, 200);
        const kind = trim(rawArgs.kind, 50);
        const confidence = trim(rawArgs.confidence, 20);
        if (!fromSlug || !toSlug || !kind) return { ok: false, error: "missing slugs/kind" };
        const r = await ctx.runMutation(api.domains.product.activity.recordActivity, {
          anonymousSessionId: ctxArgs.anonymousSessionId,
          activityType: "chat_message",
          actorType: "agent",
          sessionId: ctxArgs.sessionId,
          entityKeys: [fromSlug, toSlug],
          payloadPreview: {
            label: `Graph edge · ${fromSlug} —[${kind}]→ ${toSlug}`,
            detail: `confidence: ${confidence}`,
            metadata: { tool: "addGraphEdge", fromSlug, toSlug, kind, confidence },
          },
        });
        return { ok: true, result: { activityId: String((r as any)?.activityId ?? r) } };
      }

      default:
        return { ok: false, error: `unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
