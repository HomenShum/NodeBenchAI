import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { getNudgeGroupKey } from "../../../shared/nudges";

type ProductNudgeType = Doc<"productNudges">["type"];
type ProductNudgePriority = Doc<"productNudges">["priority"];

export type ProductNudgeUpsertArgs = {
  ownerKey: string;
  type: ProductNudgeType;
  title: string;
  summary: string;
  linkedReportId?: Id<"productReports">;
  linkedChatSessionId?: Id<"productChatSessions">;
  actionLabel?: string;
  actionTargetSurface?: string;
  actionTargetId?: string;
  priority?: ProductNudgePriority;
  dueAt?: number;
  createdAt?: number;
  updatedAt?: number;
};

const PRIORITY_RANK: Record<ProductNudgePriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function pickPriority(
  requested?: ProductNudgePriority,
  existing?: ProductNudgePriority,
): ProductNudgePriority {
  if (!requested) return existing ?? "medium";
  if (!existing) return requested;
  return PRIORITY_RANK[requested] >= PRIORITY_RANK[existing] ? requested : existing;
}

function isSameOpenNudgeGroup(
  left: Pick<
    ProductNudgeUpsertArgs,
    | "type"
    | "title"
    | "linkedReportId"
    | "linkedChatSessionId"
    | "actionTargetSurface"
    | "actionTargetId"
  >,
  right: Pick<
    ProductNudgeUpsertArgs,
    | "type"
    | "title"
    | "linkedReportId"
    | "linkedChatSessionId"
    | "actionTargetSurface"
    | "actionTargetId"
  >,
) {
  return getNudgeGroupKey(left) === getNudgeGroupKey(right);
}

export async function upsertOpenProductNudge(
  ctx: Pick<MutationCtx, "db">,
  args: ProductNudgeUpsertArgs,
) {
  const now = args.updatedAt ?? Date.now();
  const hasTargetGroup = Boolean(args.actionTargetSurface && args.actionTargetId);
  const openCandidates = hasTargetGroup
    ? await ctx.db
        .query("productNudges")
        .withIndex("by_owner_status_updated", (q) =>
          q.eq("ownerKey", args.ownerKey).eq("status", "open"),
        )
        .order("desc")
        .take(40)
    : args.linkedReportId
      ? await ctx.db
          .query("productNudges")
          .withIndex("by_owner_report", (q) =>
            q.eq("ownerKey", args.ownerKey).eq("linkedReportId", args.linkedReportId!),
          )
          .collect()
      : await ctx.db
          .query("productNudges")
          .withIndex("by_owner_status_updated", (q) =>
            q.eq("ownerKey", args.ownerKey).eq("status", "open"),
          )
          .order("desc")
          .take(40);

  const sameGroup = openCandidates
    .filter((nudge) => nudge.status === "open")
    .filter((nudge) =>
      isSameOpenNudgeGroup(
        {
          type: args.type,
          title: args.title,
          linkedReportId: args.linkedReportId,
          linkedChatSessionId: args.linkedChatSessionId,
          actionTargetSurface: args.actionTargetSurface,
          actionTargetId: args.actionTargetId,
        },
        {
          type: nudge.type,
          title: nudge.title,
          linkedReportId: nudge.linkedReportId,
          linkedChatSessionId: nudge.linkedChatSessionId,
          actionTargetSurface: nudge.actionTargetSurface,
          actionTargetId: nudge.actionTargetId,
        },
      ),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);

  if (sameGroup.length > 0) {
    const primary = sameGroup[0]!;
    await ctx.db.patch(primary._id, {
      type: args.type,
      title: args.title,
      summary: args.summary,
      linkedReportId: args.linkedReportId ?? primary.linkedReportId,
      linkedChatSessionId: args.linkedChatSessionId ?? primary.linkedChatSessionId,
      priority: pickPriority(args.priority, primary.priority),
      dueAt: args.dueAt ?? primary.dueAt,
      actionLabel: args.actionLabel ?? primary.actionLabel,
      actionTargetSurface: args.actionTargetSurface ?? primary.actionTargetSurface,
      actionTargetId: args.actionTargetId ?? primary.actionTargetId,
      updatedAt: now,
    });

    return {
      nudgeId: primary._id,
      inserted: false,
      mergedCount: sameGroup.length,
    };
  }

  const nudgeId = await ctx.db.insert("productNudges", {
    ownerKey: args.ownerKey,
    type: args.type,
    title: args.title,
    summary: args.summary,
    linkedReportId: args.linkedReportId,
    linkedChatSessionId: args.linkedChatSessionId,
    status: "open",
    priority: args.priority ?? "medium",
    dueAt: args.dueAt,
    actionLabel: args.actionLabel ?? "Open in Chat",
    actionTargetSurface: args.actionTargetSurface,
    actionTargetId: args.actionTargetId,
    createdAt: args.createdAt ?? now,
    updatedAt: now,
  });

  return {
    nudgeId,
    inserted: true,
      mergedCount: 1,
  };
}

export async function listOpenProductNudgesInGroup(
  ctx: Pick<MutationCtx, "db">,
  args: {
    ownerKey: string;
    seedNudge: Pick<
      Doc<"productNudges">,
      | "type"
      | "title"
      | "linkedReportId"
      | "linkedChatSessionId"
      | "actionTargetSurface"
      | "actionTargetId"
      | "status"
    >;
  },
) {
  const hasTargetGroup = Boolean(
    args.seedNudge.actionTargetSurface && args.seedNudge.actionTargetId,
  );
  const openCandidates = hasTargetGroup
    ? await ctx.db
        .query("productNudges")
        .withIndex("by_owner_status_updated", (q) =>
          q.eq("ownerKey", args.ownerKey).eq("status", "open"),
        )
        .order("desc")
        .take(40)
    : args.seedNudge.linkedReportId
      ? await ctx.db
          .query("productNudges")
          .withIndex("by_owner_report", (q) =>
            q.eq("ownerKey", args.ownerKey).eq("linkedReportId", args.seedNudge.linkedReportId!),
          )
          .collect()
      : await ctx.db
          .query("productNudges")
          .withIndex("by_owner_status_updated", (q) =>
            q.eq("ownerKey", args.ownerKey).eq("status", "open"),
          )
          .order("desc")
          .take(40);

  return openCandidates
    .filter((nudge) => nudge.status === "open")
    .filter((nudge) =>
      isSameOpenNudgeGroup(
        {
          type: args.seedNudge.type,
          title: args.seedNudge.title,
          linkedReportId: args.seedNudge.linkedReportId,
          linkedChatSessionId: args.seedNudge.linkedChatSessionId,
          actionTargetSurface: args.seedNudge.actionTargetSurface,
          actionTargetId: args.seedNudge.actionTargetId,
        },
        {
          type: nudge.type,
          title: nudge.title,
          linkedReportId: nudge.linkedReportId,
          linkedChatSessionId: nudge.linkedChatSessionId,
          actionTargetSurface: nudge.actionTargetSurface,
          actionTargetId: nudge.actionTargetId,
        },
      ),
    );
}
