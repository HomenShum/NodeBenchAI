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
import { complete, getModel } from "@mariozechner/pi-ai";

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

Respond conversationally — natural prose with optional structure
(short bullets when helpful). Don't dump raw JSON. The system
captures structured side-effects automatically.

Keep responses tight — 3-6 sentences for simple questions; up to
~150 words for research / synthesis.`;

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
  }),
  handler: async (ctx, args) => {
    const modelId = args.model || "moonshotai/kimi-k2.6";
    const userTurnId = `u${Date.now()}`;
    const agentTurnId = `a${Date.now() + 1}`;

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

    // 2. Call pi-ai. We don't force reasoningEnabled: false because some
    //    free OpenRouter models require reasoning mode. Free fallback
    //    chain if the requested model is rate-limited.
    const t0 = Date.now();
    const fallbackChain: string[] = [
      modelId,
      "z-ai/glm-4.5-air:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "moonshotai/kimi-k2.6",
    ];
    let agentResp: string = "";
    let modelUsed = modelId;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let costUsd: number | undefined;
    let errorMessage: string | undefined;
    let ok = false;

    for (const candidate of fallbackChain) {
      try {
        const model = getModel("openrouter" as any, candidate as any);
        const result = (await Promise.race([
          complete(model, {
            systemPrompt: SYSTEM_PROMPT,
            messages: [{ role: "user" as const, content: args.text, timestamp: Date.now() }],
          }),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error("budget_timeout")), 60_000),
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

        const stop = result?.stopReason;
        const apiErr = result?.errorMessage;
        if (apiErr || stop === "error" || stop === "aborted") {
          errorMessage = apiErr ?? `stopReason=${stop}`;
          // recoverable → try next chain entry
          const lower = (errorMessage ?? "").toLowerCase();
          if (
            lower.includes("429") ||
            lower.includes("rate") ||
            lower.includes("400") ||
            lower.includes("503") ||
            lower.includes("budget_timeout") ||
            lower.includes("reasoning is mandatory")
          ) {
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
        ok = !!text;
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
      }
    }

    const durationMs = Date.now() - t0;

    // 3. Persist agent turn.
    let agentActivityId: string | undefined;
    if (ok && agentResp) {
      try {
        const r = await ctx.runMutation(api.domains.product.activity.recordActivity, {
          anonymousSessionId: args.anonymousSessionId,
          activityType: "chat_message",
          actorType: "agent",
          sessionId: args.sessionId,
          payloadPreview: {
            label: "Agent response",
            detail: agentResp.length > 200 ? agentResp.slice(0, 200) + "…" : agentResp,
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
    };
  },
});
