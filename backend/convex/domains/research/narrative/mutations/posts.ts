/**
 * Narrative Posts Mutations
 *
 * CRUD operations for narrativePosts table.
 * Posts represent delta updates, thesis revisions, evidence additions,
 * counterpoints, questions, and corrections within narrative threads.
 *
 * This implements the "internal X/Reddit" pattern for collaborative knowledge building.
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "../../../../_generated/dataModel";

/**
 * FNV-1a 32-bit hash for stable ID generation
 * Matches the pattern used across the codebase
 */
function fnv1a32Hex(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Post type union for validation
 */
const postTypeValidator = v.union(
  v.literal("delta_update"),
  v.literal("thesis_revision"),
  v.literal("evidence_addition"),
  v.literal("counterpoint"),
  v.literal("question"),
  v.literal("correction")
);

/**
 * Citation object validator
 */
const citationValidator = v.object({
  citationKey: v.string(),
  artifactId: v.id("sourceArtifacts"),
  chunkId: v.optional(v.id("artifactChunks")),
  quote: v.optional(v.string()),
  pageIndex: v.optional(v.number()),
  publishedAt: v.optional(v.number()),
});

// ============================================================================
// PUBLIC MUTATIONS (User-facing, require auth)
// ============================================================================

/**
 * Create a new post within a narrative thread
 */
export const createPost = mutation({
  args: {
    threadId: v.id("narrativeThreads"),
    parentPostId: v.optional(v.id("narrativePosts")),
    postType: postTypeValidator,
    title: v.optional(v.string()),
    content: v.string(),
    changeSummary: v.optional(v.array(v.string())),
    citations: v.array(citationValidator),
    supersedes: v.optional(v.id("narrativePosts")),
  },
  returns: v.id("narrativePosts"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    // Verify thread exists and user has access
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread not found");
    if (thread.userId !== userId && !thread.isPublic) {
      throw new Error("Not authorized to post to this thread");
    }

    // Verify parent post exists if specified
    if (args.parentPostId) {
      const parentPost = await ctx.db.get(args.parentPostId);
      if (!parentPost) throw new Error("Parent post not found");
      if (parentPost.threadId !== args.threadId) {
        throw new Error("Parent post must be in the same thread");
      }
    }

    // If superseding another post, update that post
    if (args.supersedes) {
      const supersededPost = await ctx.db.get(args.supersedes);
      if (!supersededPost) throw new Error("Superseded post not found");
    }

    const now = Date.now();
    const postId = `np_${fnv1a32Hex(args.content + now)}`;

    const newPostId = await ctx.db.insert("narrativePosts", {
      postId,
      threadId: args.threadId,
      parentPostId: args.parentPostId,
      postType: args.postType,
      title: args.title,
      content: args.content,
      changeSummary: args.changeSummary,
      citations: args.citations,
      supersedes: args.supersedes,
      supersededBy: undefined,
      authorType: "human",
      authorId: userId,
      authorConfidence: undefined,
      isVerified: false,
      hasContradictions: false,
      requiresAdjudication: false,
      createdAt: now,
      updatedAt: now,
    });

    // If superseding, update the superseded post
    if (args.supersedes) {
      await ctx.db.patch(args.supersedes, {
        supersededBy: newPostId,
        updatedAt: now,
      });
    }

    // Update thread metrics
    await ctx.db.patch(args.threadId, {
      updatedAt: now,
    });

    return newPostId;
  },
});

/**
 * Update an existing post
 */
export const updatePost = mutation({
  args: {
    postId: v.id("narrativePosts"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    changeSummary: v.optional(v.array(v.string())),
    citations: v.optional(v.array(citationValidator)),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    // Only author can edit
    if (post.authorType !== "human" || post.authorId !== userId) {
      throw new Error("Not authorized to edit this post");
    }

    // Cannot edit superseded posts
    if (post.supersededBy) {
      throw new Error("Cannot edit superseded posts - create a new revision");
    }

    const updates: Partial<Doc<"narrativePosts">> = {
      updatedAt: Date.now(),
    };

    if (args.title !== undefined) updates.title = args.title;
    if (args.content !== undefined) updates.content = args.content;
    if (args.changeSummary !== undefined) updates.changeSummary = args.changeSummary;
    if (args.citations !== undefined) updates.citations = args.citations;

    await ctx.db.patch(args.postId, updates);
  },
});

/**
 * Delete a post (soft-delete by marking superseded)
 */
export const deletePost = mutation({
  args: {
    postId: v.id("narrativePosts"),
    hardDelete: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    if (post.authorType !== "human" || post.authorId !== userId) {
      throw new Error("Not authorized to delete this post");
    }

    if (args.hardDelete) {
      await ctx.db.delete(args.postId);
    } else {
      // Soft delete: mark as having no successor
      await ctx.db.patch(args.postId, {
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Flag a post for adjudication (human review)
 */
export const flagForAdjudication = mutation({
  args: {
    postId: v.id("narrativePosts"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    // Verify user has access to the thread
    const thread = await ctx.db.get(post.threadId);
    if (!thread) throw new Error("Thread not found");
    if (thread.userId !== userId && !thread.isPublic) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(args.postId, {
      requiresAdjudication: true,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Mark a post as verified
 */
export const verifyPost = mutation({
  args: {
    postId: v.id("narrativePosts"),
    isVerified: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    // Only thread owner can verify
    const thread = await ctx.db.get(post.threadId);
    if (!thread || thread.userId !== userId) {
      throw new Error("Only thread owner can verify posts");
    }

    await ctx.db.patch(args.postId, {
      isVerified: args.isVerified,
      requiresAdjudication: false,
      updatedAt: Date.now(),
    });
  },
});

// ============================================================================
// INTERNAL MUTATIONS (Agent-facing, no auth required)
// ============================================================================

/**
 * Create a post as an agent
 */
export const createPostInternal = internalMutation({
  args: {
    threadId: v.id("narrativeThreads"),
    parentPostId: v.optional(v.id("narrativePosts")),
    postType: postTypeValidator,
    title: v.optional(v.string()),
    content: v.string(),
    changeSummary: v.optional(v.array(v.string())),
    citations: v.array(citationValidator),
    supersedes: v.optional(v.id("narrativePosts")),
    agentName: v.string(),
    confidence: v.optional(v.number()),
  },
  returns: v.id("narrativePosts"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const postId = `np_${fnv1a32Hex(args.content + args.agentName + now)}`;

    // Guard citations (prevents self-citation / internal-content loops)
    const guarded = await ctx.runQuery(
      internal.domains.narrative.guards.selfCitationGuard.guardCitations,
      {
        citations: args.citations,
        authorId: args.agentName,
        authorType: "agent",
        strict: false,
      }
    );

    if (!guarded.allowed) {
      console.warn("[Posts] Citation guard blocked post creation:", guarded.error);
    }

    // If superseding another post, update that post first
    if (args.supersedes) {
      const supersededPost = await ctx.db.get(args.supersedes);
      if (!supersededPost) throw new Error("Superseded post not found");
    }

    const newPostId = await ctx.db.insert("narrativePosts", {
      postId,
      threadId: args.threadId,
      parentPostId: args.parentPostId,
      postType: args.postType,
      title: args.title,
      content: args.content,
      changeSummary: args.changeSummary,
      citations: guarded.citations,
      supersedes: args.supersedes,
      supersededBy: undefined,
      authorType: "agent",
      authorId: args.agentName,
      authorConfidence: args.confidence,
      isVerified: false,
      hasContradictions: false,
      requiresAdjudication: false,
      createdAt: now,
      updatedAt: now,
    });

    // Update the superseded post
    if (args.supersedes) {
      await ctx.db.patch(args.supersedes, {
        supersededBy: newPostId,
        updatedAt: now,
      });
    }

    // Update thread
    await ctx.db.patch(args.threadId, {
      updatedAt: now,
    });

    return newPostId;
  },
});

/**
 * Mark a post as having contradictions (used by contradiction detector)
 */
export const markContradictions = internalMutation({
  args: {
    postId: v.id("narrativePosts"),
    hasContradictions: v.boolean(),
    requiresAdjudication: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) return;

    await ctx.db.patch(args.postId, {
      hasContradictions: args.hasContradictions,
      requiresAdjudication: args.requiresAdjudication ?? args.hasContradictions,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Batch update post verification status
 */
export const batchVerify = internalMutation({
  args: {
    postIds: v.array(v.id("narrativePosts")),
    isVerified: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const postId of args.postIds) {
      const post = await ctx.db.get(postId);
      if (post) {
        await ctx.db.patch(postId, {
          isVerified: args.isVerified,
          updatedAt: now,
        });
      }
    }
  },
});

/**
 * Create a thesis revision post (specialized for Thread Curator agent)
 */
export const createThesisRevision = internalMutation({
  args: {
    threadId: v.id("narrativeThreads"),
    newThesis: v.string(),
    previousThesis: v.string(),
    changeSummary: v.array(v.string()),
    citations: v.array(citationValidator),
    agentName: v.string(),
    confidence: v.number(),
  },
  returns: v.id("narrativePosts"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const postId = `np_${fnv1a32Hex(args.newThesis + args.agentName + now)}`;

    const content = `## Thesis Revision\n\n**Previous thesis:** ${args.previousThesis}\n\n**New thesis:** ${args.newThesis}\n\n### What Changed\n${args.changeSummary.map((s) => `- ${s}`).join("\n")}`;

    const newPostId = await ctx.db.insert("narrativePosts", {
      postId,
      threadId: args.threadId,
      parentPostId: undefined,
      postType: "thesis_revision",
      title: "Thesis Revision",
      content,
      changeSummary: args.changeSummary,
      citations: args.citations,
      supersedes: undefined,
      supersededBy: undefined,
      authorType: "agent",
      authorId: args.agentName,
      authorConfidence: args.confidence,
      isVerified: false,
      hasContradictions: false,
      requiresAdjudication: true, // Thesis revisions always need review
      createdAt: now,
      updatedAt: now,
    });

    // Update the thread's thesis
    await ctx.db.patch(args.threadId, {
      thesis: args.newThesis,
      updatedAt: now,
    });

    return newPostId;
  },
});

/**
 * Resolve adjudication for a post
 */
export const resolveAdjudication = internalMutation({
  args: {
    postId: v.id("narrativePosts"),
    resolution: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("modified")
    ),
    resolvedBy: v.string(),
    modifiedContent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) return;

    const updates: Partial<Doc<"narrativePosts">> = {
      requiresAdjudication: false,
      isVerified: args.resolution === "approved",
      updatedAt: Date.now(),
    };

    if (args.resolution === "modified" && args.modifiedContent) {
      updates.content = args.modifiedContent;
    }

    await ctx.db.patch(args.postId, updates);
  },
});

// ============================================================================
// NARRATIVE REPLIES (Phase 7: Social Substrate)
// ============================================================================

/**
 * Reply type validator
 */
const replyTypeValidator = v.union(
  v.literal("evidence"),
  v.literal("question"),
  v.literal("correction"),
  v.literal("support")
);

/**
 * Create a reply to a post
 */
export const createReply = mutation({
  args: {
    postId: v.id("narrativePosts"),
    parentReplyId: v.optional(v.id("narrativeReplies")),
    replyType: replyTypeValidator,
    content: v.string(),
    evidenceArtifactIds: v.optional(v.array(v.string())),
  },
  returns: v.id("narrativeReplies"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    // Verify post exists
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post not found");

    // Verify parent reply if specified
    if (args.parentReplyId) {
      const parentReply = await ctx.db.get(args.parentReplyId);
      if (!parentReply) throw new Error("Parent reply not found");
      if (parentReply.postId !== args.postId) {
        throw new Error("Parent reply must be on the same post");
      }
    }

    const now = Date.now();
    const replyId = `nr_${fnv1a32Hex(args.content + userId + now)}`;

    const docId = await ctx.db.insert("narrativeReplies", {
      replyId,
      postId: args.postId,
      parentReplyId: args.parentReplyId,
      replyType: args.replyType,
      content: args.content,
      evidenceArtifactIds: args.evidenceArtifactIds,
      authorType: "human",
      authorId: userId,
      createdAt: now,
    });

    // If correction reply, flag the post for adjudication
    if (args.replyType === "correction") {
      await ctx.db.patch(args.postId, {
        requiresAdjudication: true,
        updatedAt: now,
      });
    }

    return docId;
  },
});

/**
 * Create a reply as an agent
 */
export const createReplyInternal = internalMutation({
  args: {
    postId: v.id("narrativePosts"),
    parentReplyId: v.optional(v.id("narrativeReplies")),
    replyType: replyTypeValidator,
    content: v.string(),
    evidenceArtifactIds: v.optional(v.array(v.string())),
    agentName: v.string(),
  },
  returns: v.id("narrativeReplies"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const replyId = `nr_${fnv1a32Hex(args.content + args.agentName + now)}`;

    const docId = await ctx.db.insert("narrativeReplies", {
      replyId,
      postId: args.postId,
      parentReplyId: args.parentReplyId,
      replyType: args.replyType,
      content: args.content,
      evidenceArtifactIds: args.evidenceArtifactIds,
      authorType: "agent",
      authorId: args.agentName,
      createdAt: now,
    });

    return docId;
  },
});

/**
 * Delete a reply
 */
export const deleteReply = mutation({
  args: {
    replyId: v.id("narrativeReplies"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Authentication required");

    const reply = await ctx.db.get(args.replyId);
    if (!reply) throw new Error("Reply not found");

    // Only author can delete
    if (reply.authorType !== "human" || reply.authorId !== userId) {
      throw new Error("Not authorized to delete this reply");
    }

    await ctx.db.delete(args.replyId);
  },
});
