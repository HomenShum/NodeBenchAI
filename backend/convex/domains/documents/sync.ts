"use node";
import { internalAction } from "../../_generated/server";
import { v } from "convex/values";

// Provider sync runners
export const runSlackSync = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const refs = await import("../../_generated/api");
    const account = await ctx.runQuery((refs as any).internal.domains.integrations.integrations.getSlackAccount, {});
    if (!account) return null;

    const token = account.accessToken;
    try {
      // Verify auth and get team/user
      const authRes = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({}),
      });
      const authJson: any = await authRes.json();
      if (!authRes.ok || !authJson.ok) return null;
      const teamId: string | undefined = authJson.team_id;
      const authedUserId: string | undefined = authJson.user_id;

      // Get team info (name)
      let teamName: string | undefined = account.teamName;
      if (teamId) {
        const teamInfoRes = await fetch("https://slack.com/api/team.info" + (teamId ? `?team=${encodeURIComponent(teamId)}` : ""), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const teamInfoJson: any = await teamInfoRes.json();
        if (teamInfoRes.ok && teamInfoJson?.ok && teamInfoJson.team?.name) {
          teamName = teamInfoJson.team.name as string;
        }
      }

      await ctx.runMutation((refs as any).internal.domains.integrations.integrations.updateSlackMeta, {
        teamId,
        teamName,
        authedUserId,
      });
    } catch (e) {
      console.warn("Slack sync failed", e);
    }
    return null;
  },
});

export const runGithubSync = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const refs = await import("../../_generated/api");
    const account = await ctx.runQuery((refs as any).internal.domains.integrations.integrations.getGithubAccount, {});
    if (!account) return null;

    try {
      const res = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${account.accessToken}`, Accept: "application/vnd.github+json" },
      });
      if (!res.ok) return null;
      const j: any = await res.json();
      const username: string | undefined = j.login;
      if (username) {
        await ctx.runMutation((refs as any).internal.domains.integrations.integrations.updateGithubMeta, { username });
      }
    } catch (e) {
      console.warn("GitHub sync failed", e);
    }
    return null;
  },
});

export const runNotionSync = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const refs = await import("../../_generated/api");
    const account = await ctx.runQuery((refs as any).internal.domains.integrations.integrations.getNotionAccount, {});
    if (!account) return null;

    try {
      const res = await fetch("https://api.notion.com/v1/users/me", {
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) return null;
      const j: any = await res.json();
      const botId: string | undefined = j?.id; // user/bot id
      if (botId && botId !== account.botId) {
        await ctx.runMutation((refs as any).internal.domains.integrations.integrations.updateNotionMeta, { botId });
      }
    } catch (e) {
      console.warn("Notion sync failed", e);
    }
    return null;
  },
});

export const runGmailSync = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const refs = await import("../../_generated/api");
    const account = await ctx.runQuery((refs as any).internal.domains.integrations.gmail.getAccount, {});
    if (!account) return null;

    try {
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
      if (!res.ok) return null;
      const j: any = await res.json();
      const email: string | undefined = j?.email;
      if (email) {
        await ctx.runMutation((refs as any).internal.domains.integrations.gmail.updateProfile, { email });
      }
    } catch (e) {
      console.warn("Gmail sync failed", e);
    }
    return null;
  },
});
