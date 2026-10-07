// convex/domains/agents/coordinator/contextPackQueries.ts
// Queries for context pack cache (runs in V8 runtime, not Node.js)

import { internalQuery } from "../../../_generated/server";
import { v } from "convex/values";
import type { Doc } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface DocumentExcerpt {
  docId: string;
  title: string;
  excerpts: Array<{
    text: string;
    section?: string;
    relevanceScore?: number;
  }>;
  totalTokensEstimate: number;
}

interface ContextPack {
  packId: string;
  threadId: string;
  docSetHash: string;
  documents: DocumentExcerpt[];
  totalTokens: number;
  createdAt: number;
  expiresAt: number;
  metadata: {
    docCount: number;
    truncatedDocs: number;
    maxTokensUsed: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERY: Check cache for existing context pack
// ═══════════════════════════════════════════════════════════════════════════

export const getCachedContextPack = internalQuery({
  args: {
    threadId: v.string(),
    docSetHash: v.string(),
  },
  handler: async (ctx, args): Promise<ContextPack | null> => {
    // Query for cached pack
    const cached = await ctx.db
      .query("contextPacks")
      .withIndex("by_thread_hash", q =>
        q.eq("threadId", args.threadId).eq("docSetHash", args.docSetHash)
      )
      .first() as Doc<"contextPacks"> | null;

    if (!cached) return null;

    // Check if expired
    if (cached.expiresAt < Date.now()) {
      return null;
    }

    return cached as unknown as ContextPack;
  },
});

