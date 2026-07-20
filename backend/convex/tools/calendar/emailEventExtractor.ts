import { internalAction } from "../../_generated/server";
import { v } from "convex/values";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { getLlmModel } from "../../../shared/llm/modelCatalog";

// Helper to get the appropriate language model based on model name
function getLanguageModel(modelName: string) {
  if (modelName.startsWith("claude-")) return anthropic(modelName);
  if (modelName.startsWith("gemini-")) return google(modelName);
  return openai.chat(modelName);
}

export const extractFromEmail = internalAction({
  args: {
    subject: v.optional(v.string()),
    snippet: v.optional(v.string()),
    headers: v.optional(v.any()),
    body: v.optional(v.string()),
    sourceId: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    event: v.optional(v.object({
      title: v.string(),
      startTime: v.number(),
      endTime: v.optional(v.number()),
      allDay: v.optional(v.boolean()),
      location: v.optional(v.string()),
      people: v.optional(v.array(v.string())),
      confidence: v.number(),
      sourceId: v.optional(v.string()),
      rawSummary: v.optional(v.string()),
    })),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    const prompt = [
      "Extract a single calendar event from this email content.",
      "Return STRICT JSON with fields: title, startTime (ms epoch), endTime (ms epoch, optional), allDay (bool), location (optional), people (array of names/emails, optional), confidence (0-1), rawSummary (<=140 chars).",
      "If no event can be extracted, respond with {\"success\":false,\"error\":\"reason\"}.",
      "",
      `Subject: ${args.subject ?? "(none)"}`,
      `Headers: ${JSON.stringify(args.headers ?? {})}`,
      `Snippet: ${args.snippet ?? "(none)"}`,
      `Body: ${args.body ?? "(none)"}`,
    ].join("\n");

    try {
      const result = await generateText({
        model: getLanguageModel(getLlmModel("analysis", "openai")),
        maxOutputTokens: 400,
        prompt,
      });

      let parsed: any;
      try {
        parsed = JSON.parse(result.text ?? "{}");
      } catch {
        return { success: false, error: "LLM returned non-JSON" };
      }

      if (!parsed || typeof parsed !== "object" || parsed.success === false) {
        return { success: false, error: parsed?.error || "No event found" };
      }

      const title = parsed.title || args.subject || "New Event";
      const startTime = Number(parsed.startTime);
      if (!Number.isFinite(startTime)) {
        return { success: false, error: "Missing startTime" };
      }

      const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;

      return {
        success: true,
        event: {
          title: String(title).slice(0, 140),
          startTime,
          endTime: Number.isFinite(parsed.endTime) ? Number(parsed.endTime) : undefined,
          allDay: parsed.allDay === true,
          location: parsed.location ? String(parsed.location).slice(0, 180) : undefined,
          people: Array.isArray(parsed.people) ? parsed.people.map((p: any) => String(p)).slice(0, 10) : undefined,
          confidence,
          sourceId: args.sourceId,
          rawSummary: parsed.rawSummary ? String(parsed.rawSummary).slice(0, 180) : undefined,
        },
      };
    } catch (err: any) {
      return { success: false, error: err?.message || "LLM extraction failed" };
    }
  },
});
