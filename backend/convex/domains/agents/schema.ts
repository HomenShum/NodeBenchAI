import { defineTable } from "convex/server";
import { v } from "convex/values";

export const agentResponseReviews = defineTable({
  reviewKey: v.string(),
  messageId: v.id("chatMessagesStream"),
  threadId: v.id("chatThreadsStream"),
  userId: v.optional(v.id("users")),
  agentThreadId: v.optional(v.string()),
  reviewMode: v.union(v.literal("initial"), v.literal("rejudge"), v.literal("backfill")),
  promptSummary: v.string(),
  responseExcerpt: v.string(),
  matchedCategoryKeys: v.array(v.string()),
  status: v.union(v.literal("pass"), v.literal("watch"), v.literal("fail")),
  overallScore: v.number(),
  outputQualityScore: v.number(),
  evidenceGroundingScore: v.number(),
  actionabilityScore: v.number(),
  temporalAwarenessScore: v.number(),
  trustPostureScore: v.number(),
  compoundingFitScore: v.number(),
  routingFitScore: v.number(),
  issueFlags: v.array(v.string()),
  strengths: v.array(v.string()),
  weaknesses: v.array(v.string()),
  recommendations: v.array(v.string()),
  metrics: v.object({
    charCount: v.number(),
    lineCount: v.number(),
    bulletCount: v.number(),
    urlCount: v.number(),
    markdownLinkCount: v.number(),
    absoluteDateCount: v.number(),
    codeRefCount: v.number(),
    actionVerbCount: v.number(),
    questionCount: v.number(),
    citationSignalCount: v.number(),
  }),
  reviewedAt: v.number(),
  sourceRecordType: v.string(),
  sourceRecordId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_review_key", ["reviewKey"])
  .index("by_message_reviewed", ["messageId", "reviewedAt"])
  .index("by_thread_reviewed", ["threadId", "reviewedAt"])
  .index("by_user_reviewed", ["userId", "reviewedAt"])
  .index("by_status_reviewed", ["status", "reviewedAt"]);
