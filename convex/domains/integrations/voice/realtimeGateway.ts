import { v } from "convex/values";
import { mutation, query } from "../../../_generated/server";

type RealtimeVoiceCapture = {
  _id: string;
  captureId?: string;
};

function now(): number {
  return Date.now();
}

export const ingestRealtimeVoiceCapture = mutation({
  args: {
    userKey: v.string(),
    userId: v.optional(v.string()),
    anonymousSessionId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    transcript: v.string(),
    originalTranscript: v.optional(v.string()),
    translatedTranscript: v.optional(v.string()),
    sourceLanguage: v.optional(v.string()),
    targetLanguage: v.optional(v.string()),
    surface: v.optional(v.string()),
    contextLabel: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    gate: v.string(),
    redactedSpans: v.optional(v.array(v.any())),
    entities: v.optional(v.array(v.any())),
    followUps: v.optional(v.array(v.string())),
    inboxRequired: v.optional(v.boolean()),
    asyncHandoff: v.optional(v.any()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const db = ctx.db as any;
    const ts = now();

    if (args.idempotencyKey) {
      const existing = (await db
        .query("realtimeVoiceCaptures")
        .withIndex("by_idempotency", (q: any) =>
          q.eq("userKey", args.userKey).eq("idempotencyKey", args.idempotencyKey),
        )
        .first()) as RealtimeVoiceCapture | null;

      if (existing) {
        const auditId = await db.insert("realtimeVoiceAuditEvents", {
          userKey: args.userKey,
          anonymousSessionId: args.anonymousSessionId,
          sessionId: args.sessionId,
          captureId: existing._id,
          eventType: "capture_idempotent_replay",
          gate: "idempotency_replay",
          surface: args.surface,
          payload: { idempotencyKey: args.idempotencyKey },
          createdAt: ts,
        });
        return { captureId: existing._id, auditId, idempotent: true };
      }
    }

    const captureId = await db.insert("realtimeVoiceCaptures", {
      userKey: args.userKey,
      userId: args.userId,
      anonymousSessionId: args.anonymousSessionId,
      sessionId: args.sessionId,
      idempotencyKey: args.idempotencyKey,
      transcript: args.transcript,
      originalTranscript: args.originalTranscript,
      translatedTranscript: args.translatedTranscript,
      sourceLanguage: args.sourceLanguage,
      targetLanguage: args.targetLanguage,
      surface: args.surface,
      contextLabel: args.contextLabel,
      gate: args.gate,
      provenance: "voice",
      confidence: "needs_review",
      redactedSpans: args.redactedSpans,
      entities: args.entities,
      followUps: args.followUps,
      inboxRequired: args.inboxRequired,
      asyncHandoff: args.asyncHandoff,
      metadata: args.metadata,
      createdAt: ts,
    });

    const auditId = await db.insert("realtimeVoiceAuditEvents", {
      userKey: args.userKey,
      anonymousSessionId: args.anonymousSessionId,
      sessionId: args.sessionId,
      captureId,
      eventType: "capture_ingested",
      gate: args.gate,
      surface: args.surface,
      payload: {
        idempotencyKey: args.idempotencyKey,
        entityCount: args.entities?.length ?? 0,
        followUpCount: args.followUps?.length ?? 0,
        redactionCount: args.redactedSpans?.length ?? 0,
        inboxRequired: args.inboxRequired,
        asyncHandoff: args.asyncHandoff,
      },
      createdAt: ts,
    });

    return { captureId, auditId, idempotent: false };
  },
});

export const recordVoiceRoutingDecision = mutation({
  args: {
    userKey: v.string(),
    anonymousSessionId: v.optional(v.string()),
    surface: v.optional(v.string()),
    requestedTier: v.optional(v.string()),
    decision: v.any(),
  },
  handler: async (ctx, args) => {
    const db = ctx.db as any;
    return await db.insert("voiceRoutingDecisions", {
      userKey: args.userKey,
      anonymousSessionId: args.anonymousSessionId,
      surface: args.surface,
      requestedTier: args.requestedTier,
      decision: args.decision,
      createdAt: now(),
    });
  },
});

export const linkAnonymousVoiceCaptures = mutation({
  args: {
    anonymousSessionId: v.string(),
    userKey: v.string(),
  },
  handler: async (ctx, args) => {
    const db = ctx.db as any;
    const captures = await db
      .query("realtimeVoiceCaptures")
      .withIndex("by_user_created", (q: any) =>
        q.eq("userKey", `anon:${args.anonymousSessionId}`),
      )
      .collect();

    const ts = now();
    for (const capture of captures) {
      await db.patch(capture._id, {
        userKey: args.userKey,
        gate: "linked_after_signup",
        updatedAt: ts,
      });
      await db.insert("realtimeVoiceAuditEvents", {
        userKey: args.userKey,
        anonymousSessionId: args.anonymousSessionId,
        captureId: capture._id,
        eventType: "anonymous_capture_linked",
        gate: "linked_after_signup",
        payload: { previousUserKey: `anon:${args.anonymousSessionId}` },
        createdAt: ts,
      });
    }

    return { linked: captures.length };
  },
});

export const getRecentRealtimeVoiceCaptures = query({
  args: {
    userKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const db = ctx.db as any;
    return await db
      .query("realtimeVoiceCaptures")
      .withIndex("by_user_created", (q: any) => q.eq("userKey", args.userKey))
      .order("desc")
      .take(Math.min(args.limit ?? 20, 100));
  },
});
