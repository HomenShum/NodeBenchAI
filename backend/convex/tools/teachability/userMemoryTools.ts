"use node";

/**
 * Teachability memory actions (Node.js runtime)
 * - Store facts, preferences, and skills with embeddings
 * - Retrieve relevant teachings for context injection
 * - Match skill triggers
 *
 * Note: Queries and mutations are in userMemoryQueries.ts (Convex runtime)
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import OpenAI from "openai";
import type { Doc, Id } from "../../_generated/dataModel";

type TeachingType = "fact" | "preference" | "skill";
type UserTeaching = Doc<"userTeachings">;

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ||
  process.env.CONVEX_OPENAI_EMBEDDING_MODEL ||
  "text-embedding-3-small";

function normalizeCategory(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || undefined;
}

async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.CONVEX_OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[teachability.embedText] Missing OPENAI_API_KEY");
    return [];
  }

  const openai = new OpenAI({ apiKey });
  const resp = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  return (resp.data?.[0]?.embedding) ?? [];
}

function coerceUserId(raw: Id<"users">   | null | undefined): Id<"users"> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    const trimmed = raw.includes("|") ? raw.split("|")[0] : raw;
    return trimmed;
  }
  return raw;
}

async function resolveUserId(ctx: any): Promise<Id<"users"> | null> {
  const evalId = coerceUserId((ctx).evaluationUserId);
  if (evalId) return evalId;
  const authId = await getAuthUserId(ctx);
  return coerceUserId(authId as any);
}

const toolArgs = z.object({
  query: z.string(),
  limit: z.number().min(1).max(20).optional(),
});

/* ------------------------------------------------------------------ */
/* ACTIONS                                                             */
/* ------------------------------------------------------------------ */

export const storeTeaching = internalAction({
  args: {
    userId: v.id("users"),
    type: v.union(v.literal("fact"), v.literal("preference"), v.literal("skill")),
    content: v.string(),
    category: v.optional(v.string()),
    key: v.optional(v.string()),
    source: v.optional(v.union(v.literal("explicit"), v.literal("inferred"))),
    steps: v.optional(v.array(v.string())),
    triggerPhrases: v.optional(v.array(v.string())),
    confidence: v.optional(v.number()),
    threadId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ teachingId: Id<"userTeachings">; archivedIds: Id<"userTeachings">[] }> => {
    const category = normalizeCategory(args.category || args.key);
    const embeddingText = [
      args.content,
      ...(args.steps ?? []),
      ...(args.triggerPhrases ?? []),
    ].join("\n");

    let embedding: number[] | undefined;
    try {
      embedding = embeddingText.trim().length > 0 ? await embedText(embeddingText) : undefined;
    } catch (err) {
      console.warn("[storeTeaching] Embedding failed, storing without vector", err);
    }

    return await ctx.runMutation(internal.tools.teachability.userMemoryQueries.persistTeaching, {
      ...args,
      category,
      embedding,
      usageCount: 0,
      status: "active",
    });
  },
});

export const searchTeachings = internalAction({
  args: {
    userId: v.id("users"),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<UserTeaching[]> => {
    const limit = args.limit ?? 6;
    const query = args.query.trim();
    if (!query) return [];

    let embedding: number[] = [];
    try {
      embedding = await embedText(query);
    } catch (err) {
      console.warn("[searchTeachings] Embedding failed", err);
    }

    // Vector search
    const vectorDocs: UserTeaching[] = [];
    if (embedding.length > 0) {
      try {
        const vectorResults = await ctx.vectorSearch("userTeachings", "by_embedding", {
          vector: embedding,
          limit,
          filter: (q: any) =>
            q.eq("userId", args.userId)
              .eq("status", "active"),
        });

        for (const hit of vectorResults) {
          const doc = await ctx.runQuery(internal.tools.teachability.userMemoryQueries.getTeachingById, {
            teachingId: hit._id as Id<"userTeachings">,
          });
          if (doc) vectorDocs.push(doc);
        }
      } catch (err) {
        console.warn("[searchTeachings] Vector search failed", err);
      }
    }

    // Keyword fallback
    let keywordDocs: UserTeaching[] = [];
    try {
      const all: UserTeaching[] = await ctx.runQuery(internal.tools.teachability.userMemoryQueries.listTeachingsByUser, {
        userId: args.userId,
        status: "active",
        limit: 80,
      });
      const qLower = query.toLowerCase();
      keywordDocs = all.filter((t) =>
        t.content.toLowerCase().includes(qLower) ||
        (t.category ?? "").toLowerCase().includes(qLower)
      );
    } catch (err) {
      console.warn("[searchTeachings] Keyword fallback failed", err);
    }

    const deduped: UserTeaching[] = [];
    const seen = new Set<string>();
    for (const doc of [...vectorDocs, ...keywordDocs]) {
      const key = String(doc._id);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(doc);
      if (deduped.length >= limit) break;
    }

    return deduped;
  },
});

export const matchUserSkillTrigger = internalAction({
  args: {
    userId: v.id("users"),
    userMessage: v.string(),
  },
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  handler: async (ctx, args): Promise<UserTeaching | null> => {
    const lowerMessage = args.userMessage.toLowerCase();

    // 1) Exact trigger phrase match
    try {
      const skills: UserTeaching[] = await ctx.runQuery(internal.tools.teachability.userMemoryQueries.listSkillsWithTriggers, {
        userId: args.userId,
      });
      const hit = skills.find((skill: UserTeaching) =>
        (skill.triggerPhrases ?? []).some((phrase: string) =>
          lowerMessage.includes(phrase.toLowerCase())
        )
      );
      if (hit) return hit;
    } catch (err) {
      console.warn("[matchUserSkillTrigger] Trigger match failed", err);
    }

    // 2) Semantic match fallback
    try {
      const embedding = await embedText(args.userMessage);
      if (embedding.length === 0) return null;

      const vectorResults = await ctx.vectorSearch("userTeachings", "by_embedding", {
        vector: embedding,
        limit: 3,
        filter: (q: any) =>
          q.eq("userId", args.userId)
            .eq("status", "active")
            .eq("type", "skill"),
      });

      for (const hit of vectorResults) {
        // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
        const doc: UserTeaching | null = await ctx.runQuery(internal.tools.teachability.userMemoryQueries.getTeachingById, {
          teachingId: hit._id as Id<"userTeachings">,
        });
        if (doc) return doc;
      }
    } catch (err) {
      console.warn("[matchUserSkillTrigger] Semantic match failed", err);
    }

    return null;
  },
});

export const analyzeAndStoreTeachings = internalAction({
  args: {
    userId: v.id("users"),
    userMessage: v.string(),
    assistantResponse: v.optional(v.string()),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const analysis = await ctx.runAction(
      internal.tools.teachability.teachingAnalyzer.runTeachingAnalysis,
      {
        userMessage: args.userMessage,
        assistantResponse: args.assistantResponse,
        threadId: args.threadId,
      }
    );

    if (!analysis?.teachings || analysis.teachings.length === 0) {
      return { inserted: 0, archivedIds: [] as Id<"userTeachings">[] };
    }

    const archivedIds: Id<"userTeachings">[] = [];
    let inserted = 0;
    for (const teaching of analysis.teachings) {
      const result = await ctx.runAction(internal.tools.teachability.userMemoryTools.storeTeaching, {
        userId: args.userId,
        type: teaching.type as TeachingType,
        content: teaching.content,
        category: teaching.category ?? undefined,
        key: teaching.key ?? undefined,
        source: "inferred",
        steps: teaching.steps,
        triggerPhrases: teaching.triggerPhrases,
        confidence: teaching.confidence,
        threadId: args.threadId,
      });
      inserted += 1;
      archivedIds.push(...(result.archivedIds ?? []));
    }

    return { inserted, archivedIds };
  },
});

/* ------------------------------------------------------------------ */
/* TOOLS (Agent-facing)                                                */
/* ------------------------------------------------------------------ */

export const searchTeachingsTool = createTool<
  z.infer<typeof toolArgs>,
  UserTeaching[]
>({
  description: "Search the user's taught memories (facts, preferences, skills) semantically.",
  args: toolArgs,
  handler: async (ctx, args): Promise<UserTeaching[]> => {
    const userId = await resolveUserId(ctx);
    if (!userId) return [];
    return await ctx.runAction(internal.tools.teachability.userMemoryTools.searchTeachings, {
      userId,
      query: args.query,
      limit: args.limit,
    });
  },
});

export const getTopPreferencesTool = createTool<
  { limit?: number },
  UserTeaching[]
>({
  description: "Load the user's global preferences (always-on instructions).",
  args: z.object({
    limit: z.number().min(1).max(10).optional(),
  }),
  handler: async (ctx, args): Promise<UserTeaching[]> => {
    const userId = await resolveUserId(ctx);
    if (!userId) return [];
    return await ctx.runQuery(internal.tools.teachability.userMemoryQueries.getTopPreferences, {
      userId,
      limit: args.limit,
    });
  },
});
