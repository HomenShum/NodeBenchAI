import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query, internalAction, internalMutation } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import {
  AGENT_QUESTION_CATALOG,
  reviewAgentResponse,
  summarizeResponseReviews,
  type AgentResponseFlywheelSnapshot,
  type AgentResponseReviewAggregateRow,
} from "../../../shared/agentResponseFlywheel";
import { buildTrajectoryEntityKey } from "../trajectory/lib";

const MAX_REVIEW_WINDOW = 120;
const MAX_EXCERPT_CHARS = 320;
const AGENT_ENTITY_KEY = buildTrajectoryEntityKey("agent", "fast-agent-panel");
const AGENT_ENTITY_LABEL = "Fast Agent Panel";

type FlywheelCtx = {
  db: {
    get: (id: Id<any>) => Promise<Doc<any> | null>;
    insert: <TableName extends string>(table: TableName, value: any) => Promise<Id<TableName>>;
    query: (table: string) => any;
  };
};

function truncateText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function dedupeLatestByMessage(
  rows: Doc<"agentResponseReviews">[],
): AgentResponseReviewAggregateRow[] {
  const seen = new Set<string>();
  const result: AgentResponseReviewAggregateRow[] = [];
  for (const row of rows) {
    const key = String(row.messageId);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      reviewKey: row.reviewKey,
      messageId: String(row.messageId),
      promptSummary: row.promptSummary,
      status: row.status,
      overallScore: row.overallScore,
      matchedCategoryKeys: row.matchedCategoryKeys as AgentResponseReviewAggregateRow["matchedCategoryKeys"],
      outputQualityScore: row.outputQualityScore,
      evidenceGroundingScore: row.evidenceGroundingScore,
      actionabilityScore: row.actionabilityScore,
      temporalAwarenessScore: row.temporalAwarenessScore,
      trustPostureScore: row.trustPostureScore,
      compoundingFitScore: row.compoundingFitScore,
      routingFitScore: row.routingFitScore,
      weaknesses: row.weaknesses,
      recommendations: row.recommendations,
      reviewedAt: row.reviewedAt,
    });
  }
  return result;
}

async function ensureTrajectoryEntity(ctx: FlywheelCtx) {
  const existing = await ctx.db
    .query("trajectoryEntities")
    .withIndex("by_entity", (q: any) => q.eq("entityType", "agent").eq("entityKey", AGENT_ENTITY_KEY))
    .first();

  if (existing) {
    return existing;
  }

  const now = Date.now();
  await ctx.db.insert("trajectoryEntities", {
    entityKey: AGENT_ENTITY_KEY,
    entityType: "agent",
    label: AGENT_ENTITY_LABEL,
    description: "Persistent trajectory entity for Fast Agent Panel response quality.",
    activePopulation: true,
    sourceRecordType: "chatMessagesStream",
    sourceRecordId: "fast-agent-panel",
    createdAt: now,
    updatedAt: now,
  });
}

function extractSourceRefs(response: string) {
  const urls = response.match(/https?:\/\/[^\s)]+/gi) ?? [];
  return urls.slice(0, 5).map((href) => ({
    label: href.replace(/^https?:\/\//i, "").slice(0, 80),
    href,
    kind: "web",
    note: "Extracted from agent response",
  }));
}

async function recordTrajectoryArtifacts(
  ctx: FlywheelCtx,
  message: Doc<"chatMessagesStream">,
  review: ReturnType<typeof reviewAgentResponse>,
  priorReview: Doc<"agentResponseReviews"> | null,
) {
  await ensureTrajectoryEntity(ctx);

  const sourceRecordId = String(message._id);
  const existingSpan = await ctx.db
    .query("trajectorySpans")
    .withIndex("by_source", (q: any) =>
      q.eq("sourceRecordType", "chatMessagesStream").eq("sourceRecordId", sourceRecordId),
    )
    .first();

  const now = Date.now();
  const sourceRefs = extractSourceRefs(message.content);

  if (!existingSpan) {
    await ctx.db.insert("trajectorySpans", {
      entityKey: AGENT_ENTITY_KEY,
      entityType: "agent",
      spanKey: `chat-message:${sourceRecordId}`,
      traceKey: undefined,
      sessionKey: String(message.threadId),
      spanType: "agent_response",
      name: "Assistant response",
      status: review.status === "fail" ? "failed" : review.status === "watch" ? "watch" : "completed",
      summary: review.summary,
      score: review.overallScore,
      evidenceCompletenessScore: review.dimensions.evidenceGrounding,
      sourceRefs,
      sourceRecordType: "chatMessagesStream",
      sourceRecordId,
      createdAt: message.createdAt ?? now,
      updatedAt: now,
    });

    await ctx.db.insert("trajectoryJudgeVerdicts", {
      entityKey: AGENT_ENTITY_KEY,
      entityType: "agent",
      verdictKey: `chat-message:${sourceRecordId}:initial-review`,
      verdict: review.status,
      summary: review.summary,
      confidence: review.overallScore,
      criteriaPassed: 7 - review.issueFlags.length,
      criteriaTotal: 7,
      sourceRecordType: "chatMessagesStream",
      sourceRecordId,
      createdAt: now,
      updatedAt: now,
    });
  }

  await ctx.db.insert("trajectoryFeedbackEvents", {
    entityKey: AGENT_ENTITY_KEY,
    entityType: "agent",
    eventType: priorReview ? "agent_response_rejudge" : "agent_response_review",
    status: review.status,
    title: priorReview ? "Agent response re-judged" : "Agent response reviewed",
    summary: review.summary,
    observationWindowStartAt: priorReview?.reviewedAt ?? (message.createdAt ?? now),
    observationWindowEndAt: now,
    observedAt: now,
    outcomeScore: review.overallScore,
    scoreDelta: priorReview ? review.overallScore - priorReview.overallScore : undefined,
    sourceRecordType: "chatMessagesStream",
    sourceRecordId,
    metadata: {
      matchedCategoryKeys: review.matchedCategoryKeys,
      issueFlags: review.issueFlags,
      recommendations: review.recommendations,
    },
    createdAt: now,
    updatedAt: now,
  });
}

async function getPriorPrompt(
  ctx: FlywheelCtx,
  message: Doc<"chatMessagesStream">,
): Promise<string> {
  const threadMessages = await ctx.db
    .query("chatMessagesStream")
    .withIndex("by_thread", (q: any) => q.eq("threadId", message.threadId))
    .order("desc")
    .take(20);

  const priorPrompt = threadMessages.find(
    (candidate: Doc<"chatMessagesStream">) =>
      candidate.role === "user" && (candidate.createdAt ?? candidate._creationTime) <= (message.createdAt ?? message._creationTime),
  );

  return priorPrompt?.content ?? "";
}

async function reviewOneMessage(
  ctx: FlywheelCtx,
  messageId: Id<"chatMessagesStream">,
  options?: {
    forceRejudge?: boolean;
    reviewMode?: "initial" | "rejudge" | "backfill";
  },
) {
  const message = await ctx.db.get(messageId);
  if (!message || message.role !== "assistant" || message.status !== "complete") {
    return { skipped: true, reason: "message_not_reviewable" as const };
  }

  const trimmedContent = message.content.trim();
  if (!trimmedContent) {
    return { skipped: true, reason: "empty_response" as const };
  }

  const existingReviews = await ctx.db
    .query("agentResponseReviews")
    .withIndex("by_message_reviewed", (q: any) => q.eq("messageId", messageId))
    .order("desc")
    .take(10);

  if (existingReviews.length > 0 && !options?.forceRejudge && options?.reviewMode !== "backfill") {
    return {
      skipped: true,
      reason: "already_reviewed" as const,
      reviewId: existingReviews[0]._id,
    };
  }

  const prompt = await getPriorPrompt(ctx, message);
  const review = reviewAgentResponse({
    prompt,
    response: trimmedContent,
  });

  const now = Date.now();
  const reviewKey = `chat-message:${String(messageId)}:r${existingReviews.length + 1}`;
  const reviewMode =
    options?.reviewMode ??
    (existingReviews.length === 0 ? "initial" : options?.forceRejudge ? "rejudge" : "backfill");

  const reviewId = await ctx.db.insert("agentResponseReviews", {
    reviewKey,
    messageId,
    threadId: message.threadId,
    userId: message.userId,
    agentThreadId: undefined,
    reviewMode,
    promptSummary: truncateText(prompt, 200),
    responseExcerpt: truncateText(trimmedContent, MAX_EXCERPT_CHARS),
    matchedCategoryKeys: review.matchedCategoryKeys,
    status: review.status,
    overallScore: review.overallScore,
    outputQualityScore: review.dimensions.outputQuality,
    evidenceGroundingScore: review.dimensions.evidenceGrounding,
    actionabilityScore: review.dimensions.actionability,
    temporalAwarenessScore: review.dimensions.temporalAwareness,
    trustPostureScore: review.dimensions.trustPosture,
    compoundingFitScore: review.dimensions.compoundingFit,
    routingFitScore: review.dimensions.routingFit,
    issueFlags: review.issueFlags,
    strengths: review.strengths,
    weaknesses: review.weaknesses,
    recommendations: review.recommendations,
    metrics: review.metrics,
    reviewedAt: now,
    sourceRecordType: "chatMessagesStream",
    sourceRecordId: String(messageId),
    createdAt: now,
    updatedAt: now,
  });

  await recordTrajectoryArtifacts(ctx, message, review, existingReviews[0] ?? null);

  return {
    skipped: false,
    reviewId,
    reviewKey,
    overallScore: review.overallScore,
    status: review.status,
  };
}

export async function buildAgentResponseFlywheelSnapshot(
  ctx: { db: { query: (table: string) => any } },
  userId: Id<"users"> | null,
): Promise<AgentResponseFlywheelSnapshot> {
  if (!userId) {
    return summarizeResponseReviews([]);
  }

  const reviews = await ctx.db
    .query("agentResponseReviews")
    .withIndex("by_user_reviewed", (q: any) => q.eq("userId", userId))
    .order("desc")
    .take(MAX_REVIEW_WINDOW);

  return summarizeResponseReviews(dedupeLatestByMessage(reviews));
}

export const getAgentQuestionCatalog = query({
  args: {},
  returns: v.any(),
  handler: async () => AGENT_QUESTION_CATALOG,
});

export const getAgentResponseFlywheelSnapshot = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return buildAgentResponseFlywheelSnapshot(ctx as unknown as FlywheelCtx, userId ?? null);
  },
});

export const reviewStreamMessage = internalMutation({
  args: {
    messageId: v.id("chatMessagesStream"),
    forceRejudge: v.optional(v.boolean()),
    reviewMode: v.optional(v.union(v.literal("initial"), v.literal("rejudge"), v.literal("backfill"))),
  },
  returns: v.any(),
  handler: async (ctx, args) =>
    reviewOneMessage(ctx as unknown as FlywheelCtx, args.messageId, {
      forceRejudge: args.forceRejudge,
      reviewMode: args.reviewMode,
    }),
});

export const backfillRecentAgentResponses = internalMutation({
  args: {
    limit: v.optional(v.number()),
    forceRejudge: v.optional(v.boolean()),
  },
  returns: v.object({
    scanned: v.number(),
    reviewed: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const scanLimit = Math.max(20, Math.min((args.limit ?? 40) * 5, 300));
    const recentMessages = await ctx.db.query("chatMessagesStream").order("desc").take(scanLimit);
    const candidates = recentMessages
      .filter(
        (message: Doc<"chatMessagesStream">) =>
          message.role === "assistant" &&
          message.status === "complete" &&
          Boolean(message.content?.trim()),
      )
      .slice(0, Math.max(1, Math.min(args.limit ?? 40, 80)));

    let reviewed = 0;
    let skipped = 0;
    for (const candidate of candidates) {
      const result = await reviewOneMessage(ctx as unknown as FlywheelCtx, candidate._id, {
        forceRejudge: args.forceRejudge,
        reviewMode: args.forceRejudge ? "rejudge" : "backfill",
      });
      if (result.skipped) {
        skipped += 1;
      } else {
        reviewed += 1;
      }
    }

    return {
      scanned: candidates.length,
      reviewed,
      skipped,
    };
  },
});

export const runResponseFlywheelMaintenance = internalAction({
  args: {
    limit: v.optional(v.number()),
    forceRejudge: v.optional(v.boolean()),
    syncSuccessLoops: v.optional(v.boolean()),
  },
  returns: v.object({
    scanned: v.number(),
    reviewed: v.number(),
    skipped: v.number(),
    syncedLoops: v.optional(v.number()),
    generatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const reviewResult = await ctx.runMutation(
      internal.domains.agents.responseFlywheel.backfillRecentAgentResponses,
      {
        limit: args.limit,
        forceRejudge: args.forceRejudge,
      },
    );

    let syncedLoops: number | undefined;
    if (args.syncSuccessLoops ?? true) {
      const syncResult = await ctx.runMutation(
        internal.domains.successLoops.mutations.syncSourceRecordToTrajectory,
        {},
      );
      syncedLoops = syncResult.synced;
    }

    const generatedAt = Date.now();
    await ctx.runMutation(internal.domains.agents.autonomousCronsQueries.storeCronResult, {
      title: `Response Flywheel Maintenance - ${new Date(generatedAt).toISOString().slice(0, 10)}`,
      cronJobName: "response_flywheel_maintenance",
      metadata: {
        ...reviewResult,
        syncedLoops,
        forceRejudge: args.forceRejudge ?? false,
      },
    });

    return {
      ...reviewResult,
      syncedLoops,
      generatedAt,
    };
  },
});
