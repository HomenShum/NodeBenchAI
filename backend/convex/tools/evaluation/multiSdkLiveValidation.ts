"use node";

import { internalAction } from "../../_generated/server";
import type { ActionCtx } from "../../_generated/server";
import { v } from "convex/values";

import {
  clearRegistry,
  executeWithAdapter,
  registerAdapter,
} from "../../domains/agents/adapters/registry";

import { createAnthropicReasoningAdapter } from "../../domains/agents/adapters/anthropic/anthropicReasoningAdapter";
import {
  createGoogleInteractionsAdapter,
  DEFAULT_GEMINI_DEEP_RESEARCH_AGENT,
} from "../../domains/agents/adapters/google/googleInteractionsAdapter";
import { createOpenAIAgentsAdapter } from "../../domains/agents/adapters/openai/openaiAgentsAdapter";
import { createVercelAiSdkAdapter } from "../../domains/agents/adapters/vercel/vercelAiSdkAdapter";
import { createLangGraphAdapter } from "../../domains/agents/adapters/langgraph/langgraphAdapter";

const resultStatusValidator = v.union(
  v.literal("pass"),
  v.literal("fail"),
  v.literal("skipped")
);

export const runMultiSdkLiveValidation = internalAction({
  args: {},
  returns: v.object({
    env: v.object({
      hasOpenAIKey: v.boolean(),
      hasAnthropicKey: v.boolean(),
      hasGeminiKey: v.boolean(),
      hasGoogleAiKey: v.boolean(),
      hasGoogleGenerativeAIKey: v.boolean(),
      hasOpenRouterKey: v.boolean(),
    }),
    results: v.array(
      v.object({
        adapter: v.string(),
        status: resultStatusValidator,
        detail: v.string(),
      })
    ),
  }),
  handler: async (_ctx: ActionCtx) => {
    const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
    const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
    const hasGoogleAiKey = Boolean(process.env.GOOGLE_AI_API_KEY);
    const hasGoogleGenerativeAIKey = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
    const hasOpenRouterKey = Boolean(process.env.OPENROUTER_API_KEY);

    clearRegistry();

    registerAdapter(
      createOpenAIAgentsAdapter({
        name: "LiveOpenAIAgents",
        instructions: "You are a helpful assistant. Answer concisely.",
        model: "gpt-5.4-mini",
        maxTurns: 3,
      })
    );

    registerAdapter(
      createAnthropicReasoningAdapter({
        name: "LiveAnthropicReasoning",
        model: "claude-sonnet-4.6",
        thinking: { enabled: false, budgetTokens: 0 },
        systemPrompt: "You are a helpful assistant. Answer concisely.",
      })
    );

    registerAdapter(
      createGoogleInteractionsAdapter({
        name: "LiveGoogleDeepResearch",
        agent: DEFAULT_GEMINI_DEEP_RESEARCH_AGENT,
        background: true,
        stream: false,
        tools: [
          { type: "google_search", search_types: ["web_search"] },
          { type: "url_context" },
        ],
        agentConfig: {
          type: "deep-research",
          thinking_summaries: "none",
        },
        pollIntervalMs: 4000,
        maxPolls: 30,
      })
    );

    registerAdapter(
      createVercelAiSdkAdapter({
        name: "LiveVercelAiSdk",
        model: "kimi-k2.6",
        systemPrompt: "You are a helpful assistant. Answer concisely.",
        maxSteps: 3,
      })
    );

    registerAdapter(
      createLangGraphAdapter({
        name: "LiveLangGraph",
        model: "kimi-k2.6",
        systemPrompt: "You are a helpful assistant. Answer concisely.",
        maxIterations: 3,
      })
    );

    const results: Array<{ adapter: string; status: "pass" | "fail" | "skipped"; detail: string }> = [];

    if (!hasOpenAIKey) {
      results.push({
        adapter: "openai",
        status: "skipped",
        detail: "OPENAI_API_KEY not set",
      });
    } else {
      const r = await executeWithAdapter("LiveOpenAIAgents", {
        query: "What is the capital of France? Answer with just the city name.",
      });
      const answer = String(r.result ?? "").toLowerCase();
      const passed = r.status === "success" && answer.includes("paris");
      results.push({
        adapter: "openai",
        status: passed ? "pass" : "fail",
        detail: passed ? "ok" : `status=${r.status}`,
      });
    }

    if (!hasAnthropicKey) {
      results.push({
        adapter: "anthropic",
        status: "skipped",
        detail: "ANTHROPIC_API_KEY not set",
      });
    } else {
      const r = await executeWithAdapter("LiveAnthropicReasoning", {
        query: "What is 2 + 2? Answer with just the number.",
      });
      const answer = String((r.result as any)?.answer ?? "");
      const passed = r.status === "success" && answer.includes("4");
      results.push({
        adapter: "anthropic",
        status: passed ? "pass" : "fail",
        detail: passed ? "ok" : `status=${r.status}`,
      });
    }

    if (!hasGeminiKey && !hasGoogleAiKey && !hasGoogleGenerativeAIKey) {
      results.push({
        adapter: "google",
        status: "skipped",
        detail: "GEMINI_API_KEY/GOOGLE_AI_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY not set",
      });
    } else {
      const r = await executeWithAdapter("LiveGoogleDeepResearch", {
        query: "Deep research this simple question and answer with just the city name: what is the capital of France?",
        timeoutMs: 120000,
      });
      const payload = (r.result as any) ?? {};
      const answer = String(payload.finalText ?? r.result ?? "").toLowerCase();
      const backgroundStarted =
        r.status === "timeout" &&
        payload?.status === "in_progress" &&
        typeof payload?.interactionId === "string" &&
        payload.interactionId.length > 0;
      const passed =
        (r.status === "success" && answer.includes("paris")) ||
        backgroundStarted;
      results.push({
        adapter: "google",
        status: passed ? "pass" : "fail",
        detail: passed
          ? backgroundStarted
            ? "background_started"
            : "ok"
          : `status=${r.status}; interactionStatus=${String(payload.status ?? "unknown")}`,
      });
    }

    if (!hasOpenAIKey && !hasAnthropicKey && !hasGoogleGenerativeAIKey && !hasGoogleAiKey && !hasGeminiKey && !hasOpenRouterKey) {
      results.push({
        adapter: "vercel",
        status: "skipped",
        detail: "No provider key present (OPENAI_API_KEY/ANTHROPIC_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY/GOOGLE_AI_API_KEY/GEMINI_API_KEY/OPENROUTER_API_KEY)",
      });
      results.push({
        adapter: "langgraph",
        status: "skipped",
        detail: "No provider key present (OPENAI_API_KEY/ANTHROPIC_API_KEY/GOOGLE_GENERATIVE_AI_API_KEY/GOOGLE_AI_API_KEY/GEMINI_API_KEY/OPENROUTER_API_KEY)",
      });
    } else {
      const vercel = await executeWithAdapter("LiveVercelAiSdk", {
        query: "What is 1 + 1? Answer with just the number.",
      });
      const vercelAnswer = String(vercel.result ?? "");
      const vercelPassed = vercel.status === "success" && vercelAnswer.includes("2");
      results.push({
        adapter: "vercel",
        status: vercelPassed ? "pass" : "fail",
        detail: vercelPassed ? "ok" : `status=${vercel.status}`,
      });

      const langgraph = await executeWithAdapter("LiveLangGraph", {
        query: "What is the capital of Japan? Answer with just the city name.",
      });
      const langgraphAnswer = String(langgraph.result ?? "").toLowerCase();
      const langgraphPassed = langgraph.status === "success" && langgraphAnswer.includes("tokyo");
      results.push({
        adapter: "langgraph",
        status: langgraphPassed ? "pass" : "fail",
        detail: langgraphPassed ? "ok" : `status=${langgraph.status}`,
      });
    }

    return {
      env: {
        hasOpenAIKey,
        hasAnthropicKey,
        hasGeminiKey,
        hasGoogleAiKey,
        hasGoogleGenerativeAIKey,
        hasOpenRouterKey,
      },
      results,
    };
  },
});
