"use node";

import { getAdapter, registerAdapter } from "./registry";

let registrationPromise: Promise<void> | null = null;

export function ensureDefaultAdaptersRegistered(): Promise<void> {
  if (registrationPromise) return registrationPromise;

  registrationPromise = (async () => {
    if (
      getAdapter("DefaultAnthropicReasoning") &&
      getAdapter("DefaultOpenAIAgents") &&
      getAdapter("DefaultGoogleDeepResearch") &&
      getAdapter("DefaultVercelAiSdk") &&
      getAdapter("DefaultLangGraph") &&
      getAdapter("TemporalForecastLangGraph")
    ) {
      return;
    }

    const [
      anthropicModule,
      openaiModule,
      googleModule,
      vercelModule,
      langgraphModule,
    ] =
      await Promise.all([
        import("./anthropic/anthropicReasoningAdapter"),
        import("./openai/openaiAgentsAdapter"),
        import("./google/googleInteractionsAdapter"),
        import("./vercel/vercelAiSdkAdapter"),
        import("./langgraph/langgraphAdapter"),
      ]);

    if (!getAdapter("DefaultAnthropicReasoning")) {
      registerAdapter(
        anthropicModule.createAnthropicReasoningAdapter({
          name: "DefaultAnthropicReasoning",
          thinking: { enabled: false, budgetTokens: 0 },
          systemPrompt: "You are a helpful assistant. Answer concisely.",
        }),
      );
    }

    if (!getAdapter("DefaultOpenAIAgents")) {
      registerAdapter(
        openaiModule.createOpenAIAgentsAdapter({
          name: "DefaultOpenAIAgents",
          instructions: "You are a helpful assistant. Answer concisely.",
          model: "gpt-5.4-mini",
          maxTurns: 6,
        }),
      );
    }

    if (
      !getAdapter("DefaultGoogleDeepResearch") &&
      (process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_AI_API_KEY ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY)
    ) {
      registerAdapter(
        googleModule.createGoogleInteractionsAdapter({
          name: "DefaultGoogleDeepResearch",
          agent: googleModule.DEFAULT_GEMINI_DEEP_RESEARCH_AGENT,
          background: true,
          stream: false,
          useNodeBenchResearchMcp: true,
          tools: [
            { type: "google_search", search_types: ["web_search"] },
            { type: "url_context" },
            { type: "code_execution" },
          ],
          agentConfig: {
            type: "deep-research",
            thinking_summaries: "auto",
          },
          pollIntervalMs: 5000,
          maxPolls: 90,
        }),
      );
    }

    if (!getAdapter("DefaultVercelAiSdk")) {
      registerAdapter(
        vercelModule.createVercelAiSdkAdapter({
          name: "DefaultVercelAiSdk",
          model: "kimi-k2.6",
          systemPrompt: "You are a helpful assistant. Answer concisely.",
          maxSteps: 5,
        }),
      );
    }

    if (!getAdapter("DefaultLangGraph")) {
      registerAdapter(
        langgraphModule.createLangGraphAdapter({
          name: "DefaultLangGraph",
          model: "kimi-k2.6",
          systemPrompt: "You are a helpful assistant. Answer concisely.",
          maxIterations: 5,
        }),
      );
    }

    if (!getAdapter("TemporalForecastLangGraph")) {
      registerAdapter(
        langgraphModule.createTemporalForecastGraphAdapter({
          name: "TemporalForecastLangGraph",
          maxIterations: 12,
        }),
      );
    }
  })().catch((err) => {
    registrationPromise = null;
    throw err;
  });

  return registrationPromise;
}
