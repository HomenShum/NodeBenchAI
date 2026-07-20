"use node";

import { v } from "convex/values";
import { action } from "../../_generated/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { getLlmModel, getProviderForModel, resolveModelAlias, getModelWithFailover } from "../../../shared/llm/modelCatalog";

// NOTE: Query is in morningDigestQueries.ts (Convex requires queries in non-Node files)
// Import it via: api.domains.ai.morningDigestQueries.getDigestData

// Multi-provider LLM helper
async function generateWithProvider(
  modelInput: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 200
): Promise<string> {
  const { model: modelName, provider } = getModelWithFailover(resolveModelAlias(modelInput));
  
  if (provider === "anthropic") {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: modelName,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return response.content[0]?.type === "text" ? response.content[0].text : "";
  }
  
  if (provider === "gemini") {
    const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await generateText({
      model: google(modelName),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: maxTokens,
    });
    return result.text;
  }
  
  // Default: OpenAI
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: maxTokens,
  });
  return response.choices[0]?.message?.content || "";
}

// Generate AI summary from digest data
export const generateDigestSummary = action({
  args: {
    marketMovers: v.array(v.object({
      title: v.string(),
      summary: v.optional(v.string()),
      tags: v.array(v.string()),
    })),
    watchlistRelevant: v.array(v.object({
      title: v.string(),
      summary: v.optional(v.string()),
      tags: v.array(v.string()),
    })),
    riskAlerts: v.array(v.object({
      title: v.string(),
      summary: v.optional(v.string()),
      tags: v.array(v.string()),
    })),
    trackedHashtags: v.array(v.string()),
    userName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Build context for the AI
    const marketContext = args.marketMovers
      .map((item: any) => `- ${item.title}`)
      .join('\n');

    const watchlistContext = args.watchlistRelevant
      .map((item: any) => `- ${item.title}`)
      .join('\n');

    const riskContext = args.riskAlerts
      .map((item: any) => `- ${item.title}`)
      .join('\n');

    const trackedTopics = args.trackedHashtags.length > 0
      ? args.trackedHashtags.map((h: any) => `#${h}`).join(', ')
      : 'general tech and finance news';

    const prompt = `You are a concise financial analyst writing a morning briefing. Based on the following news items, write a 2-3 sentence summary that:
1. Highlights the overall market sentiment
2. Mentions any items relevant to the user's tracked topics (${trackedTopics})
3. Notes any risks to watch

Market Movers:
${marketContext || 'No significant market news'}

Watchlist Relevant:
${watchlistContext || 'No items matching tracked topics'}

Risk Alerts:
${riskContext || 'No significant risk alerts'}

Write a professional, concise summary (2-3 sentences max). Do not use bullet points. Focus on actionable insights.`;

    try {
      const summary = await generateWithProvider(
        getLlmModel("chat"),
        "You are a professional financial analyst writing morning market briefings.",
        prompt,
        200
      );

      return {
        summary: summary || "Unable to generate summary.",
        generatedAt: Date.now(),
      };
    } catch (error: any) {
      console.error("Error generating digest summary:", error);
      return {
        summary: "Markets are moving. Check the feed for the latest updates on your tracked topics.",
        generatedAt: Date.now(),
        error: error.message,
      };
    }
  },
});

// Detect sentiment for a feed item
export const detectSentiment = action({
  args: {
    title: v.string(),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const response = await generateWithProvider(
        getLlmModel("chat"),
        "You are a sentiment classifier. Respond with exactly one word: bullish, bearish, or neutral.",
        `Classify the sentiment of this news headline:\n"${args.title}"\n${args.summary ? `Summary: ${args.summary}` : ''}`,
        10
      );

      const sentiment = response?.toLowerCase().trim();
      if (sentiment === 'bullish' || sentiment === 'bearish' || sentiment === 'neutral') {
        return { sentiment };
      }
      return { sentiment: 'neutral' };
    } catch (error) {
      return { sentiment: 'neutral' };
    }
  },
});
