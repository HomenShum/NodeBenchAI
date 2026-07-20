import { query } from "../../_generated/server";
import { v } from "convex/values";
import { resolveProductReadOwnerKeys } from "./helpers";

const EMPTY_SHELL_SNAPSHOT = {
  recentChats: [],
  recentReports: [],
  openNudges: [],
};

export const getWorkspaceRailSnapshot = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);

    if (ownerKeys.length === 0) {
      return EMPTY_SHELL_SNAPSHOT;
    }

    try {
      const [chatGroups, reportGroups, nudgeGroups] = await Promise.all([
        Promise.all(
          ownerKeys.map((ownerKey) =>
            ctx.db
              .query("productChatSessions")
              .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
              .order("desc")
              .take(4),
          ),
        ),
        Promise.all(
          ownerKeys.map((ownerKey) =>
            ctx.db
              .query("productReports")
              .withIndex("by_owner_updated", (q) => q.eq("ownerKey", ownerKey))
              .order("desc")
              .take(4),
          ),
        ),
        Promise.all(
          ownerKeys.map((ownerKey) =>
            ctx.db
              .query("productNudges")
              .withIndex("by_owner_status_updated", (q) => q.eq("ownerKey", ownerKey).eq("status", "open"))
              .order("desc")
              .take(3),
          ),
        ),
      ]);

      const recentChats = chatGroups
        .flat()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .reduce<Array<(typeof chatGroups)[number][number]>>((acc, chat) => {
          if (acc.some((existing) => existing._id === chat._id)) return acc;
          acc.push(chat);
          return acc;
        }, [])
        .slice(0, 4);

      const recentReports = reportGroups
        .flat()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .reduce<Array<(typeof reportGroups)[number][number]>>((acc, report) => {
          if (acc.some((existing) => existing._id === report._id)) return acc;
          acc.push(report);
          return acc;
        }, [])
        .slice(0, 4);

      const openNudges = nudgeGroups
        .flat()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .reduce<Array<(typeof nudgeGroups)[number][number]>>((acc, nudge) => {
          if (acc.some((existing) => existing._id === nudge._id)) return acc;
          acc.push(nudge);
          return acc;
        }, [])
        .slice(0, 3);

      return {
        recentChats,
        recentReports,
        openNudges,
      };
    } catch (error) {
      console.error("[product] getWorkspaceRailSnapshot failed", {
        ownerKeys,
        error,
      });
      return EMPTY_SHELL_SNAPSHOT;
    }
  },
});
