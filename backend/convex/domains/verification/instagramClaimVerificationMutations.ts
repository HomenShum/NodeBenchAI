/**
 * Instagram Claim Verification - Mutations
 *
 * Non-Node.js mutations for storing verification results.
 * Called by the Node.js actions in instagramClaimVerification.ts.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";

/**
 * Store verification results on the Instagram post
 */
export const storeVerificationResults = internalMutation({
  args: {
    postId: v.id("instagramPosts"),
    results: v.array(
      v.object({
        claim: v.string(),
        status: v.string(),
        explanation: v.string(),
        sources: v.array(
          v.object({
            name: v.string(),
            url: v.optional(v.string()),
            credibility: v.string(),
          })
        ),
        confidence: v.number(),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.postId, {
      verificationResults: args.results,
      verifiedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Get posts verified since a timestamp
 */
export const getRecentlyVerifiedPostsQuery = internalQuery({
  args: { since: v.number() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // Query all posts and filter by verifiedAt
    const posts = await ctx.db.query("instagramPosts").collect();
    return posts.filter(
      (p) => p.verifiedAt && p.verifiedAt >= args.since && p.verificationResults
    );
  },
});
