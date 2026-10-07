import { v } from "convex/values";
import { action, mutation, query } from "../../_generated/server";
import { getAuthUserId, getAuthSessionId, invalidateSessions } from "@convex-dev/auth/server";
import type { Doc } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";

export const listSessions = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("authSessions"),
      _creationTime: v.number(),
      expirationTime: v.number(),
      isCurrent: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const currentSessionId = await getAuthSessionId(ctx);
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    return sessions.map((s) => ({
      _id: s._id,
      _creationTime: s._creationTime,
      expirationTime: s.expirationTime,
      isCurrent: currentSessionId !== null && s._id === currentSessionId,
    }));
  },
});

export const listLinkedAccounts = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("authAccounts"),
      _creationTime: v.number(),
      provider: v.string(),
      providerAccountId: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect();
    return accounts.map((a) => ({
      _id: a._id,
      _creationTime: a._creationTime,
      provider: a.provider,
      providerAccountId: a.providerAccountId,
    }));
  },
});

export const signOutOtherSessions = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const currentSessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, { userId, except: currentSessionId ? [currentSessionId] : [] });
    return null;
  },
});

export const signOutSession = mutation({
  args: { sessionId: v.id("authSessions") },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    // Verify the session belongs to the user and is not the current session
    const session = await ctx.db.get(sessionId) as Doc<"authSessions"> | null;
    if (!session) return null;
    if (session.userId !== userId) throw new Error("Forbidden");
    const currentSessionId = await getAuthSessionId(ctx);
    if (currentSessionId && sessionId === currentSessionId) {
      throw new Error("Cannot sign out the current session here");
    }

    // Capture session state before deletion
    const sessionSnapshot = {
      _id: session._id,
      userId: session.userId,
      _creationTime: session._creationTime,
      expirationTime: session.expirationTime,
    };

    // Delete refresh tokens for this session
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const t of tokens) {
      await ctx.db.delete(t._id);
    }

    // Delete the session itself
    await ctx.db.delete(sessionId);

    // Log the security action
    await ctx.runMutation(internal.domains.operations.adminAuditLog.logAdminActionInternal, {
      action: "sign_out_session",
      actionCategory: "security_event",
      actor: userId,
      resourceType: "authSessions",
      resourceId: sessionId,
      before: sessionSnapshot,
      after: { deleted: true },
      reason: `User manually signed out session`,
      metadata: {
        tokensDeleted: tokens.length,
        sessionAge: Date.now() - session._creationTime,
      },
    }).catch((err) => {
      console.warn('[signOutSession] Failed to log audit entry:', err);
    });

    return null;
  },
});
