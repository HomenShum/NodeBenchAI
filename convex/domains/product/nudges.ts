import { mutation, query, internalMutation, internalAction, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { resolveProductIdentitySafely, resolveProductReadOwnerKeys, requireProductIdentity } from "./helpers";
import { listOpenProductNudgesInGroup, upsertOpenProductNudge } from "./nudgeHelpers";
import { collapseNudgesIntoGroups } from "../../../shared/nudges";
import { isLegacyPromptArtifact, isPlaceholderPrepEntity } from "../../../shared/reportArtifacts";

function buildSuggestedActions(nudges: Array<{ actionLabel?: string; type?: string }>): string[] {
  const suggestions = new Set<string>();
  for (const nudge of nudges) {
    if (typeof nudge.actionLabel === "string" && nudge.actionLabel.trim()) {
      suggestions.add(nudge.actionLabel.trim());
      continue;
    }
    if (nudge.type === "follow_up_due") suggestions.add("Follow up");
    else if (nudge.type === "refresh_recommended" || nudge.type === "report_changed") suggestions.add("Refresh report");
    else if (nudge.type === "reply_draft_ready") suggestions.add("Reply draft ready");
  }
  return Array.from(suggestions).slice(0, 4);
}

function getInboxBucket(type?: string): "action_required" | "update" {
  if (
    type === "follow_up_due" ||
    type === "connector_follow_up" ||
    type === "refresh_recommended"
  ) {
    return "action_required";
  }
  return "update";
}

export const getNudgesSnapshot = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveProductIdentitySafely(ctx, args.anonymousSessionId);
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    const publicSnapshot = {
      nudges: [],
      lastCheckedAt: Date.now(),
      channels: [
        { label: "Slack", status: "Not connected" },
        { label: "Gmail", status: "Not connected" },
        { label: "Notion", status: "Not connected" },
        { label: "Linear", status: "Not connected" },
        { label: "Discord", status: "Not connected" },
        { label: "Telegram", status: "Not connected" },
      ],
      suggestedActions: ["Reply draft ready", "Refresh report", "Follow up"],
    };

    if (ownerKeys.length === 0) {
      return publicSnapshot;
    }

    let nudges: any[] = [];
    try {
      const nudgeGroups = await Promise.all(
        ownerKeys.map((ownerKey) =>
          ctx.db
            .query("productNudges")
            .withIndex("by_owner_status_updated", (q) => q.eq("ownerKey", ownerKey).eq("status", "open"))
            .order("desc")
            .take(12),
        ),
      );
      nudges = nudgeGroups
        .flat()
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .reduce<Array<(typeof nudgeGroups)[number][number]>>((acc, nudge) => {
          if (acc.some((existing) => existing._id === nudge._id)) return acc;
          acc.push(nudge);
          return acc;
        }, [])
        .slice(0, 12);
    } catch (error) {
      console.error("[product] getNudgesSnapshot nudges failed", {
        ownerKeys,
        error,
      });
      return publicSnapshot;
    }

    const userId = identity.rawUserId as any;
    const [google, slack, notion] = identity.rawUserId
      ? await Promise.all([
          ctx.db
            .query("googleAccounts")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .first()
            .catch(() => null),
          ctx.db
            .query("slackAccounts")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .first()
            .catch(() => null),
          ctx.db
            .query("notionAccounts")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .first()
            .catch(() => null),
        ])
      : [null, null, null];

    const reportIds = [...new Set(
      nudges
        .map((nudge) => nudge.linkedReportId ?? null)
        .filter((reportId): reportId is NonNullable<typeof nudges[number]["linkedReportId"]> => Boolean(reportId)),
    )];

    const linkedReports = await Promise.all(reportIds.map((reportId) => ctx.db.get(reportId)));
    const reportById = new Map(
      linkedReports
        .filter((report): report is NonNullable<typeof linkedReports[number]> => Boolean(report))
        .map((report) => [String(report._id), report]),
    );

    const enrichedNudges = nudges.map((nudge) => {
      const linkedReport = nudge.linkedReportId ? reportById.get(String(nudge.linkedReportId)) : null;
      return {
        ...nudge,
        linkedEntitySlug: linkedReport?.entitySlug,
        linkedReportQuery: linkedReport?.query,
        linkedReportLens: linkedReport?.lens,
        linkedReportTitle: linkedReport?.title,
        linkedReportRoutingMode: linkedReport?.routing?.routingMode,
      };
    }).filter((nudge) => {
      if (isPlaceholderPrepEntity(nudge.linkedEntitySlug ?? undefined)) return false;
      return !isLegacyPromptArtifact({
        entitySlug: nudge.linkedEntitySlug,
        title: nudge.linkedReportTitle,
        query: nudge.linkedReportQuery,
      });
    });
    const groupedNudges = collapseNudgesIntoGroups(enrichedNudges).map((nudge) => ({
      ...nudge,
      bucket: getInboxBucket(nudge.type),
    }));

    return {
      nudges: groupedNudges,
      lastCheckedAt: Date.now(),
      channels: [
        { label: "Slack", status: slack ? "Connected" : "Not connected" },
        { label: "Gmail", status: google ? "Connected" : "Not connected" },
        { label: "Notion", status: notion ? "Connected" : "Not connected" },
        { label: "Linear", status: "Not connected" },
        { label: "Discord", status: "Not connected" },
        { label: "Telegram", status: "Not connected" },
      ],
      suggestedActions: buildSuggestedActions(groupedNudges),
    };
  },
});

export const snoozeNudge = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    nudgeId: v.id("productNudges"),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const nudge = await ctx.db.get(args.nudgeId);
    if (!nudge || nudge.ownerKey !== ownerKey) {
      throw new Error("Nudge not found");
    }
    const now = Date.now();
    const grouped = await listOpenProductNudgesInGroup(ctx, {
      ownerKey,
      seedNudge: nudge,
    });

    for (const current of grouped) {
      await ctx.db.patch(current._id, {
        status: "snoozed",
        dueAt: now + 24 * 60 * 60 * 1000,
        updatedAt: now,
      });
    }

    return { ok: true, affected: grouped.length || 1 };
  },
});

export const completeNudge = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    nudgeId: v.id("productNudges"),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    const nudge = await ctx.db.get(args.nudgeId);
    if (!nudge || nudge.ownerKey !== ownerKey) {
      throw new Error("Nudge not found");
    }
    const now = Date.now();
    const grouped = await listOpenProductNudgesInGroup(ctx, {
      ownerKey,
      seedNudge: nudge,
    });

    for (const current of grouped) {
      await ctx.db.patch(current._id, {
        status: "done",
        updatedAt: now,
      });
    }

    return { ok: true, affected: grouped.length || 1 };
  },
});

export const createHomePulseFollowupNudge = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    title: v.string(),
    summary: v.string(),
    actionLabel: v.optional(v.string()),
    actionTargetSurface: v.optional(v.string()),
    actionTargetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const now = Date.now();
    return await upsertOpenProductNudge(ctx, {
      ownerKey: identity.ownerKey,
      type: "follow_up_due",
      title: args.title.trim().slice(0, 160) || "Home Pulse follow-up",
      summary:
        args.summary.trim().slice(0, 700) ||
        "Review the latest Home Pulse and decide which report, notebook, or source trail needs a follow-up.",
      priority: "medium",
      dueAt: now + 24 * 60 * 60 * 1000,
      actionLabel: args.actionLabel ?? "Open in Chat",
      actionTargetSurface: args.actionTargetSurface ?? "chat",
      actionTargetId: args.actionTargetId ?? "home-pulse",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// Internal: create a nudge (called by cron or other internal actions)
// ---------------------------------------------------------------------------
export const createNudge = internalMutation({
  args: {
    ownerKey: v.string(),
    type: v.union(
      v.literal("follow_up_due"),
      v.literal("new_source_found"),
      v.literal("report_changed"),
      v.literal("saved_watch_item_changed"),
      v.literal("connector_message_detected"),
      v.literal("cron_summary"),
      v.literal("reply_draft_ready"),
      v.literal("refresh_recommended"),
    ),
    title: v.string(),
    summary: v.string(),
    linkedReportId: v.optional(v.id("productReports")),
    actionLabel: v.optional(v.string()),
    actionTargetSurface: v.optional(v.string()),
    actionTargetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await upsertOpenProductNudge(ctx, {
      ownerKey: args.ownerKey,
      type: args.type,
      title: args.title,
      summary: args.summary,
      linkedReportId: args.linkedReportId,
      actionLabel: args.actionLabel ?? "Open in Chat",
      actionTargetSurface: args.actionTargetSurface ?? "chat",
      actionTargetId: args.actionTargetId,
      priority: "medium",
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// Cron action: scan saved reports and create nudges for stale ones
// ---------------------------------------------------------------------------
export const checkReportsForNudges = internalAction({
  args: {},
  handler: async (ctx) => {
    const reports = await ctx.runQuery(
      internal.domains.product.reports.listAllReportsInternal,
      {},
    );

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let created = 0;

    for (const report of reports) {
      // Skip reports updated in the last 24 hours
      if (report.updatedAt > oneDayAgo) continue;

      // Check for an existing open nudge for this report to avoid duplicates
      const existingNudge = await ctx.runQuery(
        internal.domains.product.nudges.getOpenNudgeForReport,
        { ownerKey: report.ownerKey, reportId: report._id },
      );
      if (existingNudge) continue;

      const daysSinceUpdate = Math.floor(
        (Date.now() - report.updatedAt) / (24 * 60 * 60 * 1000),
      );

      const opensReportSurface = Boolean(report.entitySlug);

      await ctx.runMutation(internal.domains.product.nudges.createNudge, {
        ownerKey: report.ownerKey,
        type: "refresh_recommended",
        title: `"${report.title}" may have new information`,
        summary: opensReportSurface
          ? `This report was last updated ${daysSinceUpdate} day${daysSinceUpdate === 1 ? "" : "s"} ago. Open the saved report to review it, then refresh in Chat if the facts changed.`
          : `This report was last updated ${daysSinceUpdate} day${daysSinceUpdate === 1 ? "" : "s"} ago. Reopen in Chat to pull fresh sources.`,
        linkedReportId: report._id,
        actionLabel: opensReportSurface ? "Open report" : "Open in Chat",
        actionTargetSurface: opensReportSurface ? "reports" : "chat",
        actionTargetId: opensReportSurface ? report.entitySlug : String(report._id),
      });
      created++;
    }

    console.log(
      `[nudges] checkReportsForNudges: scanned ${reports.length} reports, created ${created} nudges`,
    );
  },
});

// ---------------------------------------------------------------------------
// Internal: check if a report already has an open nudge (dedup guard)
// ---------------------------------------------------------------------------
export const getOpenNudgeForReport = internalQuery({
  args: {
    ownerKey: v.string(),
    reportId: v.id("productReports"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("productNudges")
      .withIndex("by_owner_report", (q) =>
        q.eq("ownerKey", args.ownerKey).eq("linkedReportId", args.reportId),
      )
      .filter((q) => q.eq(q.field("status"), "open"))
      .first();
  },
});
