"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { getLlmModel, resolveModelAlias, getModelWithFailover } from "../shared/llm/modelCatalog";

/**
 * LLM-powered tag generation for documents
 * Uses model catalog (gpt-5.1 for analysis) for semantic tag extraction
 */

interface ExtractedTag {
  name: string;
  kind: "keyword" | "entity" | "topic" | "community" | "relationship";
  importance: number;
}

/**
 * Generate semantic tags for a document using LLM
 * Called from DocumentHeader.tsx via useAction
 */
export const generateForDocument = action({
  args: {
    documentId: v.id("documents"),
  },
  returns: v.object({
    success: v.boolean(),
    tagsGenerated: v.number(),
    tags: v.array(v.object({
      name: v.string(),
      kind: v.optional(v.string()),
      importance: v.optional(v.number()),
    })),
  }),
  handler: async (ctx, { documentId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get document text content
    const text = await ctx.runQuery(internal.domains.knowledge.tags.getDocumentText, {
      documentId,
      maxChars: 6000, // Keep prompt size reasonable
    });

    if (!text || text.trim().length < 20) {
      return { success: false, tagsGenerated: 0, tags: [] };
    }

    // Multi-provider LLM support
    const { model: modelName, provider } = getModelWithFailover(resolveModelAlias(getLlmModel("analysis")));
    
    const systemPrompt = `You are a semantic tag extraction expert. Extract 3-8 meaningful tags from the document content.

For each tag, provide:
- name: The tag text (lowercase, 1-3 words max)
- kind: One of "keyword", "entity", "topic", "community", "relationship"
  - keyword: Single important terms (e.g., "finance", "api", "machine learning")
  - entity: Named entities like companies, products, people (e.g., "openai", "react", "elon musk")
  - topic: Broader themes or domains (e.g., "artificial intelligence", "web development")
  - community: Groups, forums, ecosystems (e.g., "open source", "startup ecosystem")
  - relationship: Connections between entities (e.g., "competitor analysis", "integration")
- importance: 0.0-1.0 score (1.0 = most important)

Respond with ONLY a JSON array of tag objects. No markdown, no explanation.
Example: [{"name":"react","kind":"entity","importance":0.9},{"name":"web development","kind":"topic","importance":0.7}]`;

    const userPrompt = `Extract semantic tags from this document:\n\n${text}`;
    
    let responseText: string;
    
    if (provider === "anthropic") {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: modelName,
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      responseText = response.content[0]?.type === "text" ? response.content[0].text : "[]";
    } else if (provider === "gemini") {
      const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
      const result = await generateText({
        model: google(modelName),
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 500,
      });
      responseText = result.text;
    } else {
      // OpenAI
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 500,
      });
      responseText = response.choices[0]?.message?.content?.trim() || "[]";
    }

    // Parse LLM response
    const content = responseText;
    let extractedTags: ExtractedTag[] = [];

    try {
      // Handle potential markdown code blocks
      let jsonStr = content;
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```$/g, "").trim();
      }
      extractedTags = JSON.parse(jsonStr);
    } catch (e) {
      console.error("[generateForDocument] Failed to parse LLM response:", content, e);
      return { success: false, tagsGenerated: 0, tags: [] };
    }

    // Validate and normalize tags
    const validTags = extractedTags
      .filter((t) => t.name && typeof t.name === "string" && t.name.length > 0)
      .slice(0, 10) // Max 10 tags
      .map((t) => ({
        name: t.name.toLowerCase().trim().slice(0, 50),
        kind: ["keyword", "entity", "topic", "community", "relationship"].includes(t.kind)
          ? t.kind
          : undefined,
        importance: typeof t.importance === "number"
          ? Math.max(0, Math.min(1, t.importance))
          : undefined,
      }));

    if (validTags.length === 0) {
      return { success: false, tagsGenerated: 0, tags: [] };
    }

    // Save tags to database
    const savedTags: Array<{ name: string; kind?: string; importance?: number }> = await ctx.runMutation(api.tags.addTagsToDocument, {
      documentId,
      tags: validTags,
    });

    // Track usage with actual provider
    try {
      await ctx.runMutation(internal.domains.auth.usage.incrementDailyUsage, {
        provider,
      });
    } catch (e) {
      console.warn("[generateForDocument] Failed to track usage:", e);
    }

    return {
      success: true,
      tagsGenerated: savedTags.length,
      tags: savedTags.map((t: { name: string; kind?: string; importance?: number }) => ({
        name: t.name,
        kind: t.kind,
        importance: t.importance,
      })),
    };
  },
});
