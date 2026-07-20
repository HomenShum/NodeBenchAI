"use node";

/**
 * Daily Brief Personal Overlay (Initializer + Worker for per-user tasks)
 *
 * - ensurePersonalOverlayInternal: builds per-user tasks from preferences/docs/teachings.
 * - runNextPersonalTaskInternal: advances one pending/failing personal task.
 */

import { v } from "convex/values";
import { internalAction, action } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import {
  getLlmModel,
  resolveModelAlias,
  getModelWithFailover,
} from "../../../shared/llm/modelCatalog";

async function generateWithProvider(
  modelInput: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 400,
): Promise<string> {
  const { model: modelName, provider } = getModelWithFailover(
    resolveModelAlias(modelInput),
  );

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
    const google = createGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
    const result = await generateText({
      model: google(modelName),
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: maxTokens,
    });
    return result.text;
  }

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

function toFeature(
  id: string,
  type: string,
  name: string,
  testCriteria: string,
  sourceRefs: any,
  priority: number,
  now: number,
) {
  return {
    id,
    type,
    name,
    status: "pending" as const,
    priority,
    testCriteria,
    sourceRefs,
    updatedAt: now,
  };
}

export const ensurePersonalOverlayInternal = internalAction({
  args: {
    memoryId: v.optional(v.id("dailyBriefMemories")),
  },
  handler: async (ctx, args): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const memory: any = args.memoryId
      ? await ctx.runQuery(
          internal.domains.research.dailyBriefMemoryQueries.getMemoryByIdInternal,
          { memoryId: args.memoryId },
        )
      : await ctx.runQuery(
          internal.domains.research.dailyBriefMemoryQueries.getLatestMemoryInternal,
          {},
        );

    if (!memory) throw new Error("No daily brief memory available");

    const existing: any = await ctx.runQuery(
      internal.domains.research.dailyBriefPersonalOverlayQueries.getOverlayInternal,
      { userId: userId as any, memoryId: memory._id },
    );
    if (existing) return existing;

    const prefs: any = await ctx.runQuery(
      api.domains.auth.userPreferences.getUserPreferences,
      {},
    );
    const trackedHashtags: string[] = prefs?.trackedHashtags ?? [];

    const recentDocs: any[] = await ctx.runQuery(
      api.domains.documents.documents.getRecentForMentions,
      { limit: 5 },
    );

    const teachings: any[] = await ctx.runQuery(
      internal.tools.teachability.userMemoryQueries.listTeachingsByUser,
      { userId: userId as any, status: "active", type: "preference", limit: 5 },
    );

    const now = Date.now();
    const features: any[] = [];

    trackedHashtags.slice(0, 5).forEach((tag, idx) => {
      const clean = tag.replace(/^#/, "");
      features.push(
        toFeature(
          `H${idx + 1}`,
          "watchlist_signal",
          `Scan today's brief for #${clean}`,
          `Identify top items in today's feed matching #${clean} and summarize implications for you.`,
          { hashtag: clean },
          1,
          now,
        ),
      );
    });

    recentDocs.slice(0, 3).forEach((doc, idx) => {
      features.push(
        toFeature(
          `D${idx + 1}`,
          "doc_linking",
          `Relate today's brief to your doc: ${doc.title}`,
          "Explain relevance to this document and suggest any follow-up edits or tasks.",
          { documentId: doc._id, title: doc.title },
          2,
          now,
        ),
      );
    });

    teachings.forEach((t, idx) => {
      const label = t.key || t.category || `preference-${idx + 1}`;
      features.push(
        toFeature(
          `T${idx + 1}`,
          "preference_followup",
          `Check brief relevance to preference: ${label}`,
          "Summarize any brief items that align or conflict with this preference.",
          { teachingId: t._id, content: t.content },
          3,
          now,
        ),
      );
    });

    if (features.length === 0) {
      features.push(
        toFeature(
          "U1",
          "personal_summary",
          "Create a personalized brief summary",
          "Produce a short personalized takeaway based on your preferences and recent docs.",
          { trackedHashtags, recentDocs, teachings },
          4,
          now,
        ),
      );
    }

    const progressLog = [
      {
        ts: now,
        status: "info",
        message: "Personal overlay initialized from tracked topics, docs, and teachings",
        meta: { trackedHashtags, docs: recentDocs.length, teachings: teachings.length },
      },
    ];

    const overlayId = await ctx.runMutation(
      internal.domains.research.dailyBriefPersonalOverlayMutations.createOverlay,
      {
        userId: userId as any,
        memoryId: memory._id,
        dateString: memory.dateString,
        features,
        progressLog,
      },
    );

    return await ctx.runQuery(
      internal.domains.research.dailyBriefPersonalOverlayQueries.getOverlayInternal,
      { userId: userId as any, memoryId: memory._id },
    );
  },
});

export const ensurePersonalOverlay = action({
  args: {
    memoryId: v.optional(v.id("dailyBriefMemories")),
  },
  handler: async (ctx, args): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return await ctx.runAction(
      internal.domains.research.dailyBriefPersonalOverlay.ensurePersonalOverlayInternal,
      args,
    );
  },
});

async function executePersonalFeature(
  feature: any,
  memory: any,
  modelOverride?: string,
): Promise<{ status: "passing" | "failing"; markdown: string; notes?: string }> {
  const systemPrompt =
    "You are a senior research analyst. Produce crisp, personalized markdown for the user.";

  let userPrompt = `TASK: ${feature.name}\n\nCRITERIA:\n${feature.testCriteria}\n\nSOURCE:\n${JSON.stringify(
    feature.sourceRefs ?? {},
    null,
    2,
  )}\n\nBRIEF CONTEXT:\n${JSON.stringify(
    memory.context,
    null,
    2,
  )}\n\nOUTPUT: Provide markdown satisfying the criteria.`;

  if (feature.type === "watchlist_signal") {
    const tag = feature.sourceRefs?.hashtag;
    userPrompt =
      `Find and summarize items in today's brief related to #${tag}.\n\n` +
      `Use top feed items:\n${JSON.stringify(
        memory.context?.topFeedItems ?? [],
        null,
        2,
      )}\n\n` +
      `Return markdown with: Matching items (up to 3), Why it matters to the user, Suggested follow-ups.`;
  } else if (feature.type === "doc_linking") {
    userPrompt =
      `Relate today's brief to the user's document.\n\n` +
      `Document ref:\n${JSON.stringify(feature.sourceRefs, null, 2)}\n\n` +
      `Brief context:\n${JSON.stringify(memory.context, null, 2)}\n\n` +
      `Return markdown with: Relevance, Potential updates, Suggested next steps.`;
  } else if (feature.type === "preference_followup") {
    userPrompt =
      `Check today's brief for relevance to the user's preference/teaching.\n\n` +
      `Teaching:\n${JSON.stringify(feature.sourceRefs, null, 2)}\n\n` +
      `Brief context:\n${JSON.stringify(memory.context, null, 2)}\n\n` +
      `Return markdown noting alignments or conflicts and why.`;
  }

  const text = await generateWithProvider(
    modelOverride ?? getLlmModel("analysis"),
    systemPrompt,
    userPrompt,
    500,
  );

  if (!text || text.trim().length < 20) {
    return {
      status: "failing",
      markdown: text?.trim() ? text : "",
      notes: "Worker returned insufficient output.",
    };
  }

  return { status: "passing", markdown: text };
}

export const runNextPersonalTaskInternal = internalAction({
  args: {
    memoryId: v.optional(v.id("dailyBriefMemories")),
    taskId: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    const overlay: any = await ctx.runAction(
      internal.domains.research.dailyBriefPersonalOverlay.ensurePersonalOverlayInternal,
      { memoryId: args.memoryId },
    );

    if (!overlay) {
      return { done: true, message: "No personal overlay available." };
    }

    const memory: any = await ctx.runQuery(
      internal.domains.research.dailyBriefMemoryQueries.getMemoryByIdInternal,
      { memoryId: overlay.memoryId },
    );

    const features: any[] = overlay.features ?? [];

    const forced = args.taskId
      ? features.find((f) => f.id === args.taskId)
      : null;

    const pending = features.filter(
      (f) => f?.status === "pending" || f?.status == null,
    );
    const failing = features.filter((f) => f?.status === "failing");

    if (pending.length === 0 && failing.length === 0) {
      return { done: true, overlayId: overlay._id, message: "All personal tasks passing." };
    }

    const candidates = pending.length > 0 ? pending : failing;
    candidates.sort((a, b) => (a?.priority ?? 999) - (b?.priority ?? 999));

    const next = forced ?? candidates[0];
    if (!next) {
      return { done: true, overlayId: overlay._id, message: "No runnable personal tasks." };
    }

    const exec = await executePersonalFeature(next, memory, args.model ?? undefined);

    await ctx.runMutation(
      internal.domains.research.dailyBriefPersonalOverlayMutations.updatePersonalTaskStatus,
      {
        overlayId: overlay._id,
        taskId: next.id,
        status: exec.status,
        notes: exec.notes,
        resultMarkdown: exec.markdown,
        logMessage: `${next.name} → ${exec.status}`,
        logStatus: exec.status,
        meta: { taskType: next.type },
      },
    );

    return {
      done: false,
      overlayId: overlay._id,
      taskId: next.id,
      status: exec.status,
    };
  },
});

export const runNextPersonalTask = action({
  args: {
    memoryId: v.optional(v.id("dailyBriefMemories")),
    taskId: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return await ctx.runAction(
      internal.domains.research.dailyBriefPersonalOverlay.runNextPersonalTaskInternal,
      args,
    );
  },
});
