import { v } from "convex/values";
import { internalMutation } from "../../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const insertDogfoodQaRun = internalMutation({
  args: {
    createdAt: v.number(),
    provider: v.literal("gemini"),
    model: v.string(),
    source: v.union(v.literal("video"), v.literal("frames"), v.literal("screenshots")),
    videoUrl: v.optional(v.string()),
    inputSha256: v.optional(v.string()),
    prompt: v.string(),
    summary: v.string(),
    issues: v.array(
      v.object({
        severity: v.union(v.literal("p0"), v.literal("p1"), v.literal("p2"), v.literal("p3")),
        title: v.string(),
        details: v.string(),
        suggestedFix: v.optional(v.string()),
        route: v.optional(v.string()),
        startSec: v.optional(v.number()),
        endSec: v.optional(v.number()),
        evidence: v.optional(v.array(v.string())),
      }),
    ),
    rawText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return await ctx.db.insert("dogfoodQaRuns", { userId, ...args });
  },
});
