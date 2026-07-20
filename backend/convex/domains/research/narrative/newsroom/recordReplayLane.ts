"use node";

import { v } from "convex/values";
import { internalAction } from "../../../../_generated/server";
import { internal, api } from "../../../../_generated/api";
import { getCurrentWeekNumber } from "./state";

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v) => {
    if (!v || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[Circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = obj[k];
    return out;
  });
}

function fnv1a32Hex(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function digestEvents(events: any[]): string {
  return fnv1a32Hex(
    stableStringify(
      events
        .map((e) => ({
          eventId: e.eventId,
          threadId: String(e.threadId),
          headline: e.headline,
          summary: e.summary,
          occurredAt: e.occurredAt,
          weekNumber: e.weekNumber,
          citationIds: Array.isArray(e.citationIds) ? e.citationIds : [],
          claimSet: Array.isArray(e.claimSet) ? e.claimSet : [],
          eventIdVersion: e.eventIdVersion,
          eventIdDerivation: e.eventIdDerivation,
        }))
        .sort((a, b) => String(a.eventId).localeCompare(String(b.eventId)))
    )
  );
}

/**
 * Nightly “real-mode” lane: run once in record mode, then rerun in replay mode
 * using the recorded tool/LLM outputs, and assert persisted outputs match.
 */
export const runRecordReplayLane = internalAction({
  args: {
    entityKeys: v.array(v.string()),
    weekNumber: v.optional(v.string()),
    focusTopics: v.optional(v.array(v.string())),
    userId: v.id("users"),
    baseWorkflowId: v.optional(v.string()),
    config: v.optional(v.any()),
  },
  returns: v.object({
    recordWorkflowId: v.string(),
    replayWorkflowId: v.string(),
    toolReplayId: v.string(),
    persistedDigestRecord: v.string(),
    persistedDigestReplay: v.string(),
    match: v.boolean(),
    errors: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const weekNumber = args.weekNumber || getCurrentWeekNumber();
    const recordWorkflowId =
      args.baseWorkflowId ||
      `rr_${weekNumber}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const replayWorkflowId = `${recordWorkflowId}_replay`;
    const toolReplayId = recordWorkflowId;

    const baseConfig = args.config ?? {};
    const recordConfig = {
      ...baseConfig,
      toolReplayMode: "record",
      toolReplayId,
    };
    const replayConfig = {
      ...baseConfig,
      toolReplayMode: "replay",
      toolReplayId,
    };

    const errors: string[] = [];

    const recordResult = await ctx.runAction(internal.domains.narrative.newsroom.workflow.runPipeline, {
      entityKeys: args.entityKeys,
      weekNumber,
      focusTopics: args.focusTopics,
      userId: args.userId,
      workflowId: recordWorkflowId,
      config: recordConfig,
    });

    const threadDocIds = recordResult.published?.threadIds ?? [];
    const eventsRecord: any[] = [];
    for (const threadId of threadDocIds) {
      const threadEvents = await ctx.runQuery(api.domains.narrative.queries.events.getEventsByThread, {
        threadId: threadId as any,
        limit: 200,
      });
      for (const ev of threadEvents as any[]) {
        if (ev.weekNumber === weekNumber) eventsRecord.push(ev);
      }
    }
    const persistedDigestRecord = digestEvents(eventsRecord);

    await ctx.runAction(internal.domains.narrative.newsroom.workflow.runPipeline, {
      entityKeys: args.entityKeys,
      weekNumber,
      focusTopics: args.focusTopics,
      userId: args.userId,
      workflowId: replayWorkflowId,
      config: replayConfig,
    });

    const eventsReplay: any[] = [];
    for (const threadId of threadDocIds) {
      const threadEvents = await ctx.runQuery(api.domains.narrative.queries.events.getEventsByThread, {
        threadId: threadId as any,
        limit: 200,
      });
      for (const ev of threadEvents as any[]) {
        if (ev.weekNumber === weekNumber) eventsReplay.push(ev);
      }
    }
    const persistedDigestReplay = digestEvents(eventsReplay);

    const match = persistedDigestRecord === persistedDigestReplay;
    if (!match) {
      errors.push("Record/replay mismatch: persisted outputs differ.");
    }

    return {
      recordWorkflowId,
      replayWorkflowId,
      toolReplayId,
      persistedDigestRecord,
      persistedDigestReplay,
      match,
      errors,
    };
  },
});

