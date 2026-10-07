import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../_generated/server";
import type { Doc } from "../../../_generated/dataModel";

export const createEvidencePack = internalMutation({
  args: {
    runId: v.optional(v.id("agentRuns")),
    query: v.string(),
    scope: v.optional(v.any()),
    chunkIds: v.array(v.id("artifactChunks")),
  },
  returns: v.id("evidencePacks"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("evidencePacks", {
      runId: args.runId,
      query: args.query,
      scope: args.scope,
      chunkIds: args.chunkIds,
      createdAt: Date.now(),
    });
  },
});

export const getEvidencePackById = internalQuery({
  args: { evidencePackId: v.id("evidencePacks") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("evidencePacks"),
      runId: v.optional(v.id("agentRuns")),
      query: v.string(),
      scope: v.optional(v.any()),
      chunkIds: v.array(v.id("artifactChunks")),
      createdAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const pack = await ctx.db.get(args.evidencePackId) as Doc<"evidencePacks"> | null;
    if (!pack) return null;
    return pack as any;
  },
});

