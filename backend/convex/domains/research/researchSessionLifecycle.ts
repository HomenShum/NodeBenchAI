/**
 * Research Session Lifecycle
 *
 * Owns the state machine for ultra-long multi-angle chat sessions using:
 *   - researchSessions (3-layer progressive disclosure)
 *   - researchMemory (Hermes Layer 4 - durable cross-session priorities)
 *   - researchCheckpoints (LangGraph-style state snapshots)
 *
 * Integrates with the existing ultra-long chat compaction in shared/ultraLongChatContext.ts
 * plus advisor/executor routing in convex/domains/agents/mcp_tools/models/modelResolver.ts.
 *
 * PATTERN: Compaction FIRST, JIT retrieval SECOND, model overflow THIRD.
 * MODEL POLICY (advisor):
 *   - Kimi K2.6 is the primary advisor/orchestrator.
 *   - Gemini 3.x lanes (3.1 Pro / 3 Flash / 3.1 Flash-Lite) are preferred executors.
 *   - GPT-5.4 mini / MiniMax M2.7 are secondary executors.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

// ════════════════════════════════════════════════════════════════════
// COMPACTION STATE SHAPE (matches schema.ts researchSessions table)
// ════════════════════════════════════════════════════════════════════

export type CompressionLevel = 0 | 1 | 2 | 3;

export interface LoadedAngleState {
  angleId: string;
  loadedAt: number;
  lastAccessed: number;
  dataHash: string;
  summary: string;
  fullDataRef: string;
  mode: "fresh" | "stale" | "rehydrated";
}

// ════════════════════════════════════════════════════════════════════
// SESSION LIFECYCLE: create / get / update
// ════════════════════════════════════════════════════════════════════

export const createSession = internalMutation({
  args: {
    userId: v.string(),
    topic: v.string(),
    primaryEntity: v.optional(v.string()),
    contextWindowTokens: v.optional(v.number()),
  },
  returns: v.id("researchSessions"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("researchSessions", {
      userId: args.userId,
      topic: args.topic,
      primaryEntity: args.primaryEntity ?? null,
      layer1Index: [],
      layer2Active: [],
      layer3DeepDive: null,
      loadedAngles: [],
      evidenceSummary: "",
      evidenceDetailRefs: [],
      compressionLevel: 0,
      lastSummarizedAt: now,
      conversationTurns: 0,
      totalTokensConsumed: 0,
      contextWindowTokens: args.contextWindowTokens ?? 262144,
      createdAt: now,
      lastActivityAt: now,
    });
  },
});

export const getSession = internalQuery({
  args: { sessionId: v.id("researchSessions") },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

export const listUserSessions = internalQuery({
  args: { userId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("researchSessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(args.limit ?? 20);
    return rows;
  },
});

// ════════════════════════════════════════════════════════════════════
// ANGLE LIFECYCLE: load / access / stale / evict
// ════════════════════════════════════════════════════════════════════

export const loadAngle = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    angleId: v.string(),
    summary: v.string(),
    fullDataRef: v.string(),
    dataHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error(`Session not found: ${args.sessionId}`);

    const now = Date.now();
    const existing = session.loadedAngles.find((a: LoadedAngleState) => a.angleId === args.angleId);

    let loaded: LoadedAngleState[];
    if (existing) {
      loaded = session.loadedAngles.map((a: LoadedAngleState) =>
        a.angleId === args.angleId
          ? {
              ...a,
              lastAccessed: now,
              summary: args.summary,
              fullDataRef: args.fullDataRef,
              dataHash: args.dataHash,
              mode: a.dataHash === args.dataHash ? a.mode : "rehydrated",
            }
          : a,
      );
    } else {
      loaded = [
        ...session.loadedAngles,
        {
          angleId: args.angleId,
          loadedAt: now,
          lastAccessed: now,
          dataHash: args.dataHash,
          summary: args.summary,
          fullDataRef: args.fullDataRef,
          mode: "fresh" as const,
        },
      ];
    }

    const layer2Active = Array.from(new Set([...session.layer2Active, args.angleId]));
    const layer1Index = Array.from(new Set([...session.layer1Index, args.angleId]));

    await ctx.db.patch(args.sessionId, {
      loadedAngles: loaded,
      layer2Active,
      layer1Index,
      lastActivityAt: now,
    });
    return null;
  },
});

export const evictStaleAngles = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    staleThresholdMs: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return 0;
    const now = Date.now();
    const threshold = args.staleThresholdMs ?? 10 * 60 * 1000;

    let evicted = 0;
    const next = session.loadedAngles
      .map((a: LoadedAngleState) => {
        if (now - a.lastAccessed > threshold) {
          evicted++;
          return { ...a, mode: "stale" as const };
        }
        return a;
      });

    const fresh = next.filter((a: LoadedAngleState) => a.mode !== "stale");
    const layer2Active = fresh.map((a: LoadedAngleState) => a.angleId);

    await ctx.db.patch(args.sessionId, {
      loadedAngles: fresh,
      layer2Active,
      lastActivityAt: now,
    });
    return evicted;
  },
});

// ════════════════════════════════════════════════════════════════════
// EVIDENCE COMPACTION (rolling summary with compression levels)
// ════════════════════════════════════════════════════════════════════

export const appendEvidence = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    detailRef: v.string(),
    summaryDelta: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error(`Session not found: ${args.sessionId}`);

    const now = Date.now();
    const refs = Array.from(new Set([...session.evidenceDetailRefs, args.detailRef]));
    const mergedSummary = [session.evidenceSummary, args.summaryDelta].filter(Boolean).join("\n\n");

    await ctx.db.patch(args.sessionId, {
      evidenceSummary: mergedSummary.slice(0, 8000),
      evidenceDetailRefs: refs.slice(-50),
      lastSummarizedAt: now,
      lastActivityAt: now,
    });
    return null;
  },
});

export const compressEvidence = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    compressedSummary: v.string(),
    newLevel: v.union(v.literal(0), v.literal(1), v.literal(2), v.literal(3)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.sessionId, {
      evidenceSummary: args.compressedSummary.slice(0, 8000),
      compressionLevel: args.newLevel,
      lastSummarizedAt: now,
      lastActivityAt: now,
    });
    return null;
  },
});

// ════════════════════════════════════════════════════════════════════
// TURN TRACKING + CHECKPOINTS
// ════════════════════════════════════════════════════════════════════

export const recordTurn = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    tokensConsumed: v.number(),
  },
  returns: v.object({
    turnNumber: v.number(),
    shouldCompress: v.boolean(),
    suggestedLevel: v.union(v.literal(0), v.literal(1), v.literal(2), v.literal(3)),
  }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error(`Session not found: ${args.sessionId}`);

    const now = Date.now();
    const turnNumber = session.conversationTurns + 1;
    const totalTokens = session.totalTokensConsumed + args.tokensConsumed;
    const usage = totalTokens / Math.max(1, session.contextWindowTokens);

    let suggestedLevel: CompressionLevel = session.compressionLevel;
    let shouldCompress = false;

    if (usage > 0.85) {
      suggestedLevel = 3;
      shouldCompress = true;
    } else if (usage > 0.7) {
      suggestedLevel = 2;
      shouldCompress = session.compressionLevel < 2;
    } else if (usage > 0.5) {
      suggestedLevel = 1;
      shouldCompress = session.compressionLevel < 1;
    }

    await ctx.db.patch(args.sessionId, {
      conversationTurns: turnNumber,
      totalTokensConsumed: totalTokens,
      lastActivityAt: now,
    });

    return { turnNumber, shouldCompress, suggestedLevel };
  },
});

export const saveCheckpoint = internalMutation({
  args: {
    sessionId: v.id("researchSessions"),
    threadId: v.string(),
    turnNumber: v.number(),
    checkpointNs: v.string(),
    state: v.any(),
    nextNodes: v.array(v.string()),
  },
  returns: v.id("researchCheckpoints"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("researchCheckpoints", {
      sessionId: args.sessionId,
      threadId: args.threadId,
      turnNumber: args.turnNumber,
      checkpointNs: args.checkpointNs,
      state: args.state,
      nextNodes: args.nextNodes,
      createdAt: Date.now(),
    });
  },
});

export const loadLatestCheckpoint = internalQuery({
  args: {
    sessionId: v.id("researchSessions"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("researchCheckpoints")
      .withIndex("by_session_turn", (q) => q.eq("sessionId", args.sessionId as unknown as string))
      .order("desc")
      .take(1);
    return rows[0] ?? null;
  },
});

// ════════════════════════════════════════════════════════════════════
// DURABLE MEMORY (Hermes Layer 4) - cross-session priorities
// ════════════════════════════════════════════════════════════════════

export const recordMemory = internalMutation({
  args: {
    userId: v.string(),
    sessionId: v.optional(v.string()),
    claim: v.string(),
    confidence: v.number(),
    source: v.optional(v.string()),
    entity: v.optional(v.string()),
    topic: v.string(),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.id("researchMemory"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("researchMemory", {
      userId: args.userId,
      sessionId: args.sessionId ?? null,
      claim: args.claim,
      confidence: args.confidence,
      source: args.source ?? null,
      entity: args.entity ?? null,
      topic: args.topic,
      tags: args.tags ?? [],
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
    });
  },
});

export const getRelevantMemory = internalQuery({
  args: {
    userId: v.string(),
    topic: v.optional(v.string()),
    entity: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 12;
    let rows;

    if (args.entity) {
      rows = await ctx.db
        .query("researchMemory")
        .withIndex("by_user_entity", (q) =>
          q.eq("userId", args.userId).eq("entity", args.entity ?? null),
        )
        .order("desc")
        .take(limit);
    } else if (args.topic) {
      rows = await ctx.db
        .query("researchMemory")
        .withIndex("by_user_topic", (q) =>
          q.eq("userId", args.userId).eq("topic", args.topic!),
        )
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("researchMemory")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .order("desc")
        .take(limit);
    }

    // Rank by: recency * confidence * access frequency
    const now = Date.now();
    return rows
      .map((row: any) => {
        const ageMs = Math.max(1, now - row.lastAccessedAt);
        const recency = 1 / Math.log(ageMs / 3600_000 + 2); // log-decay over hours
        const score = recency * row.confidence * Math.log(row.accessCount + 1);
        return { ...row, _score: score };
      })
      .sort((a: any, b: any) => b._score - a._score);
  },
});

export const bumpMemoryAccess = internalMutation({
  args: {
    memoryId: v.id("researchMemory"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.memoryId);
    if (!row) return null;
    await ctx.db.patch(args.memoryId, {
      lastAccessedAt: Date.now(),
      accessCount: row.accessCount + 1,
    });
    return null;
  },
});
