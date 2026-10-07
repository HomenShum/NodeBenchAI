import { query, mutation, internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc } from "../../_generated/dataModel";

/* Slack */
export const slackGetConnection = query({
  args: {},
  returns: v.object({
    connected: v.boolean(),
    teamId: v.optional(v.string()),
    teamName: v.optional(v.string()),
    authedUserId: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { connected: false };
    const existing = await ctx.db
      .query("slackAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"slackAccounts"> | null;
    if (!existing) return { connected: false };
    return {
      connected: true,
      teamId: existing.teamId,
      teamName: existing.teamName,
      authedUserId: existing.authedUserId,
    };
  },
});

export const slackSaveTokens = internalMutation({
  args: {
    teamId: v.optional(v.string()),
    teamName: v.optional(v.string()),
    botUserId: v.optional(v.string()),
    authedUserId: v.optional(v.string()),
    accessToken: v.string(),
    userAccessToken: v.optional(v.string()),
    scope: v.optional(v.string()),
    tokenType: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("slackAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"slackAccounts"> | null;

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        teamId: args.teamId ?? existing.teamId,
        teamName: args.teamName ?? existing.teamName,
        botUserId: args.botUserId ?? existing.botUserId,
        authedUserId: args.authedUserId ?? existing.authedUserId,
        accessToken: args.accessToken,
        userAccessToken: args.userAccessToken ?? existing.userAccessToken,
        scope: args.scope ?? existing.scope,
        tokenType: args.tokenType ?? existing.tokenType,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("slackAccounts", {
        userId,
        provider: "slack",
        teamId: args.teamId,
        teamName: args.teamName,
        botUserId: args.botUserId,
        authedUserId: args.authedUserId,
        accessToken: args.accessToken,
        userAccessToken: args.userAccessToken,
        scope: args.scope,
        tokenType: args.tokenType,
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});

/* GitHub */
export const githubGetConnection = query({
  args: {},
  returns: v.object({
    connected: v.boolean(),
    username: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { connected: false };
    const existing = await ctx.db
      .query("githubAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"githubAccounts"> | null;
    if (!existing) return { connected: false };
    return { connected: true, username: existing.username };
  },
});

export const githubSaveTokens = internalMutation({
  args: {
    username: v.optional(v.string()),
    accessToken: v.string(),
    scope: v.optional(v.string()),
    tokenType: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("githubAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"githubAccounts"> | null;
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        username: args.username ?? existing.username,
        accessToken: args.accessToken,
        scope: args.scope ?? existing.scope,
        tokenType: args.tokenType ?? existing.tokenType,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("githubAccounts", {
        userId,
        provider: "github",
        username: args.username,
        accessToken: args.accessToken,
        scope: args.scope,
        tokenType: args.tokenType,
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});

/* Notion */
export const notionGetConnection = query({
  args: {},
  returns: v.object({
    connected: v.boolean(),
    workspaceId: v.optional(v.string()),
    workspaceName: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { connected: false };
    const existing = await ctx.db
      .query("notionAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"notionAccounts"> | null;
    if (!existing) return { connected: false };
    return {
      connected: true,
      workspaceId: existing.workspaceId,
      workspaceName: existing.workspaceName,
    };
  },
});

export const notionSaveTokens = internalMutation({
  args: {
    workspaceId: v.optional(v.string()),
    workspaceName: v.optional(v.string()),
    botId: v.optional(v.string()),
    accessToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("notionAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"notionAccounts"> | null;
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        workspaceId: args.workspaceId ?? existing.workspaceId,
        workspaceName: args.workspaceName ?? existing.workspaceName,
        botId: args.botId ?? existing.botId,
        accessToken: args.accessToken,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("notionAccounts", {
        userId,
        provider: "notion",
        workspaceId: args.workspaceId,
        workspaceName: args.workspaceName,
        botId: args.botId,
        accessToken: args.accessToken,
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});

/* Generic disconnect */
export const disconnectIntegration = mutation({
  args: { provider: v.union(v.literal("slack"), v.literal("github"), v.literal("notion")) },
  returns: v.null(),
  handler: async (ctx, { provider }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const table = provider === "slack" ? "slackAccounts" : provider === "github" ? "githubAccounts" : "notionAccounts";
    const existing = await ctx.db
      .query(table as any)
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .first() as { _id: Doc<"slackAccounts">["_id"] | Doc<"githubAccounts">["_id"] | Doc<"notionAccounts">["_id"] } | null;
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

/* -------------------------------------------------------------- */
/* Internal helpers for Workpool sync actions                      */
/* -------------------------------------------------------------- */

export const getSlackAccount = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      accessToken: v.string(),
      teamId: v.optional(v.string()),
      teamName: v.optional(v.string()),
      botUserId: v.optional(v.string()),
      authedUserId: v.optional(v.string()),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const acc = await ctx.db
      .query("slackAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"slackAccounts"> | null;
    if (!acc) return null;
    return {
      accessToken: acc.accessToken,
      teamId: acc.teamId,
      teamName: acc.teamName,
      botUserId: acc.botUserId,
      authedUserId: acc.authedUserId,
    };
  },
});

export const updateSlackMeta = internalMutation({
  args: {
    teamId: v.optional(v.string()),
    teamName: v.optional(v.string()),
    authedUserId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("slackAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"slackAccounts"> | null;
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      teamId: args.teamId ?? existing.teamId,
      teamName: args.teamName ?? existing.teamName,
      authedUserId: args.authedUserId ?? existing.authedUserId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const getGithubAccount = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      accessToken: v.string(),
      username: v.optional(v.string()),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const acc = await ctx.db
      .query("githubAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"githubAccounts"> | null;
    if (!acc) return null;
    return { accessToken: acc.accessToken, username: acc.username };
  },
});

export const updateGithubMeta = internalMutation({
  args: { username: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("githubAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"githubAccounts"> | null;
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      username: args.username ?? existing.username,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const getNotionAccount = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      accessToken: v.string(),
      botId: v.optional(v.string()),
      workspaceId: v.optional(v.string()),
      workspaceName: v.optional(v.string()),
    })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const acc = await ctx.db
      .query("notionAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"notionAccounts"> | null;
    if (!acc) return null;
    return {
      accessToken: acc.accessToken,
      botId: acc.botId,
      workspaceId: acc.workspaceId,
      workspaceName: acc.workspaceName,
    };
  },
});

export const updateNotionMeta = internalMutation({
  args: {
    botId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    workspaceName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("notionAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first() as Doc<"notionAccounts"> | null;
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      botId: args.botId ?? existing.botId,
      workspaceId: args.workspaceId ?? existing.workspaceId,
      workspaceName: args.workspaceName ?? existing.workspaceName,
      updatedAt: Date.now(),
    });
    return null;
  },
});
