"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { getLlmModel } from "../../shared/llm/modelCatalog";
import { getModelSpec, resolveModelAlias, type ApprovedModel } from "../domains/agents/mcp_tools/models/modelResolver";

type Provider = "openai" | "gemini";

const DEFAULT_CONTEXT =
  "NodeBench AI Fast Agents external orchestrator: respond concisely, keep output tool-call friendly, and honor any supplied plan/memory context.";

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: getLlmModel("chat", "openai"),
  gemini: getLlmModel("chat", "gemini"),
};

async function callOpenAI({
  message,
  model,
  sessionId,
  context,
}: {
  message: string;
  model?: string;
  sessionId?: string;
  context: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const chosenModel = model || DEFAULT_MODELS.openai;
  const payload = {
    model: chosenModel,
    messages: [
      { role: "system", content: context },
      { role: "user", content: message },
    ],
    metadata: sessionId ? { sessionId } : undefined,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenAI orchestrator error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content ?? "";

  return {
    text,
    provider: "openai",
    metadata: {
      model: chosenModel,
      sessionId,
      usage: data?.usage,
      id: data?.id,
    },
  };
}

async function callGemini({
  message,
  model,
  sessionId,
  context,
}: {
  message: string;
  model?: string;
  sessionId?: string;
  context: string;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const requested = (model || DEFAULT_MODELS.gemini).trim();

  const resolved = resolveModelAlias(requested);
  const resolvedSpec = resolved ? getModelSpec(resolved) : null;

  const stableFallbacks = [
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gemini-2.5-flash",
  ];

  const approvedGeminiAliases: ApprovedModel[] = [
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gemini-2.5-flash",
  ];
  const approvedFallbackSdkIds = approvedGeminiAliases
    .map((alias) => getModelSpec(alias).sdkId)
    .filter(Boolean);

  const candidates = Array.from(
    new Set(
      [
        requested,
        resolvedSpec?.provider === "google" ? resolvedSpec.sdkId : null,
        ...stableFallbacks,
        ...approvedFallbackSdkIds,
      ].filter(Boolean)
    )
  );

  let lastError: string | undefined;

  for (const candidate of candidates) {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      candidate +
      ":generateContent?key=" +
      apiKey;

    const payload = {
      systemInstruction: { parts: [{ text: context }] },
      contents: [{ role: "user", parts: [{ text: message }] }],
      safetySettings: [
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      lastError = "Gemini orchestrator error (" + response.status + "): " + errorText;
      if (response.status === 404 || /not found|unsupported/i.test(errorText)) {
        continue;
      }
      throw new Error(lastError);
    }

    const data = await response.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.find((p: any) => p?.text)?.text ?? "";

    return {
      text,
      provider: "gemini",
      metadata: {
        model: candidate,
        sessionId,
        candidateId: data?.candidates?.[0]?.candidateId,
        safetyRatings: data?.candidates?.[0]?.safetyRatings,
      },
    };
  }

  throw new Error(lastError || "Gemini orchestrator error: all candidate models failed");
}

export const runExternalOrchestrator = internalAction({
  args: {
    provider: v.union(v.literal("openai"), v.literal("gemini")),
    message: v.string(),
    sessionId: v.optional(v.string()),
    model: v.optional(v.string()),
    context: v.optional(v.string()),
  },
  returns: v.object({
    text: v.string(),
    provider: v.string(),
    metadata: v.optional(v.any()),
  }),
  handler: async (_ctx, { provider, message, sessionId, model, context }) => {
    const trimmed = message.trim();
    if (!trimmed) {
      throw new Error("Message cannot be empty");
    }

    const orchestrationContext = context?.trim() || DEFAULT_CONTEXT;

    if (provider === "openai") {
      return await callOpenAI({
        message: trimmed,
        model,
        sessionId,
        context: orchestrationContext,
      });
    }

    if (provider === "gemini") {
      return await callGemini({
        message: trimmed,
        model,
        sessionId,
        context: orchestrationContext,
      });
    }

    throw new Error(`Unsupported provider: ${provider}`);
  },
});
