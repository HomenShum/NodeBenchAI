"use node";

/**
 * Teachability Analyzer
 * Detects facts, preferences, and skills worth persisting as long-term memory.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import OpenAI from "openai";

type TeachingType = "fact" | "preference" | "skill";

interface TeachingCandidate {
  type: TeachingType;
  content: string;
  category?: string | null;
  key?: string | null;
  triggerPhrases?: string[];
  steps?: string[];
  confidence?: number;
}

type TeachingAnalysisResult = {
  hasTeaching: boolean;
  teachings: TeachingCandidate[];
};

const ANALYZER_PROMPT = `
You are a Teachability analyzer. Extract durable knowledge from a user turn.

Return JSON with shape:
{
  "hasTeaching": boolean,
  "teachings": [
    {
      "type": "fact" | "preference" | "skill",
      "content": string,
      "category": string (stable, snake_case e.g., "user_name", "tone_preference"),
      "key": string (short label),
      "triggerPhrases": string[] (skill only, <=4),
      "steps": string[] (skill only, concise),
      "confidence": number (0-1)
    }
  ]
}

Guidelines:
- Facts: declarative info (name, company, role, tools, reminders).
- Preferences: how to respond (tone, format, brevity). ALWAYS tag as type="preference".
- Skills: procedures/rules ("when I say X, do Y", "AAA means add"). Provide steps + trigger phrases.
- Category should group conflicts (name, company, tone, format, timezone, stack, style, citation_style, calendar, meeting_prep, contact_info).
- Drop low-signal/noise. Confidence < 0.35 => omit.
- Keep content concise and actionable.`;

function normalizeCategory(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || undefined;
}

function sanitizeTeaching(input: any): TeachingCandidate | null {
  if (!input || typeof input !== "object") return null;
  const type = input.type;
  if (type !== "fact" && type !== "preference" && type !== "skill") return null;
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!content) return null;

  const confidenceRaw = typeof input.confidence === "number" ? input.confidence : undefined;
  const confidence = confidenceRaw !== undefined
    ? Math.max(0, Math.min(1, confidenceRaw))
    : undefined;

  const triggerPhrases = Array.isArray(input.triggerPhrases)
    ? input.triggerPhrases
      .map((t: any) => (typeof t === "string" ? t.trim() : ""))
      .filter(Boolean)
      .slice(0, 5)
    : undefined;

  const steps = Array.isArray(input.steps)
    ? input.steps
      .map((s: any) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean)
      .slice(0, 12)
    : undefined;

  return {
    type,
    content,
    category: normalizeCategory(input.category || input.key),
    key: typeof input.key === "string" ? input.key.slice(0, 120) : undefined,
    triggerPhrases,
    steps,
    confidence,
  };
}

async function callAnalyzer(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<TeachingAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.CONVEX_OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[runTeachingAnalysis] Missing OPENAI_API_KEY");
    return { hasTeaching: false, teachings: [] as TeachingCandidate[] };
  }

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: process.env.TEACHABILITY_ANALYZER_MODEL || "gpt-5.4-mini",
    messages,
    response_format: { type: "json_object" },
    temperature: 0,
    max_completion_tokens: 500,
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.warn("[runTeachingAnalysis] Failed to parse JSON response", err);
    parsed = {};
  }

  const teachingsRaw: unknown[] = Array.isArray(parsed.teachings)
    ? parsed.teachings
    : [];
  const teachings = teachingsRaw
    .map(sanitizeTeaching)
    .filter((t): t is TeachingCandidate => !!t && (t.confidence ?? 1) >= 0.35);

  return {
    hasTeaching: parsed.hasTeaching === true || teachings.length > 0,
    teachings,
  };
}

export const runTeachingAnalysis = internalAction({
  args: {
    userMessage: v.string(),
    assistantResponse: v.optional(v.string()),
    threadId: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<TeachingAnalysisResult> => {
    try {
      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: ANALYZER_PROMPT },
        { role: "user", content: args.userMessage },
      ];

      if (args.assistantResponse) {
        messages.push({
          role: "assistant",
          content: args.assistantResponse.slice(0, 4000),
        });
      }

      return await callAnalyzer(messages);
    } catch (err) {
      console.warn("[runTeachingAnalysis] Analyzer error", err);
      return { hasTeaching: false, teachings: [] as TeachingCandidate[] };
    }
  },
});

const analyzeForTeachingArgs = z.object({
  userMessage: z.string().describe("The latest user message"),
  assistantResponse: z.string().optional().describe("Your response for extra context"),
  threadId: z.string().optional().describe("Thread id for provenance"),
});

export const analyzeForTeaching = createTool<
  z.infer<typeof analyzeForTeachingArgs>,
  TeachingAnalysisResult
>({
  description: `Analyze the current turn for facts, preferences, or skills worth remembering.
Returns JSON with hasTeaching and teachings[]. Use after the user shares personal details, preferences, or procedures.`,
  args: analyzeForTeachingArgs,
  handler: async (ctx, args): Promise<TeachingAnalysisResult> => {
    return await ctx.runAction(internal.tools.teachability.teachingAnalyzer.runTeachingAnalysis, args);
  },
});
