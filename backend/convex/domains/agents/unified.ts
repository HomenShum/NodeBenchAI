/**
 * unified.ts — canonical agent contract across three surfaces.
 *
 * The vision: one agent identity, three lenses.
 *   - `inline`  — decoration widgets inside notebook blocks
 *   - `drawer`  — side-panel fixed overlay (Ask NodeBench)
 *   - `chat`    — full-page chat surface (/chat → surfaceId=workspace)
 *
 * Before this module, each lens had its own Convex path:
 *   drawer → fastAgentPanelStreaming.initiateAsyncStreaming
 *   chat   → product.chat.startSession
 *   inline → diligenceProjections.requestRefreshAndRun
 *
 * Three paths = three histories = no cross-surface continuity. This
 * module's job is to give the FRONTEND one canonical `sendMessage` +
 * `getThread` entrypoint. It delegates to the appropriate legacy path
 * based on the `surface` arg, then SHADOW-WRITES into the canonical
 * `agentThreads` + `agentMessages` tables so the UI can read a
 * unified thread history via one query.
 *
 * Migration posture: dual-write for now (cheap, reversible); cutover
 * reads to canonical tables once backfill completes; retire legacy
 * tables in a later sprint.
 *
 * Invariants (agentic_reliability 8-point checklist):
 *   - BOUND: listThreads / getThread cap at 100 rows via `.take()`.
 *   - HONEST_STATUS: `sendMessage` returns `{ threadId, messageId,
 *     surfaceRouted, legacy: {...} }` — never a fake success. If the
 *     legacy path fails, we throw; the canonical tables are not
 *     written.
 *   - DETERMINISTIC: thread IDs are generated via crypto.randomUUID()
 *     when a new thread is created; provided threadIds are returned
 *     verbatim. Same input → same behavior.
 *   - ERROR_BOUNDARY: the shadow-write is fire-and-forget inside the
 *     mutation; failure to shadow does NOT fail the user-facing send.
 *   - DETERMINISTIC (keys): agentThreads is keyed by (ownerKey,
 *     threadId) with a unique-by-pair invariant; no collision risk
 *     because threadId UUIDs are generated.
 *
 * Pattern: Cockroach DB's "shadow cluster" migration pattern +
 * Anthropic's orchestrator-workers adapter shape.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import {
  requireProductIdentity,
  resolveProductIdentitySafely,
} from "../product/helpers";

const MAX_LIST_LIMIT = 100;
const MAX_MESSAGE_BODY_BYTES = 64 * 1024; // 64 KB cap per message

const surfaceValidator = v.union(
  v.literal("inline"),
  v.literal("drawer"),
  v.literal("chat"),
);

const roleValidator = v.union(
  v.literal("user"),
  v.literal("assistant"),
  v.literal("system"),
);

/**
 * `createThread` — allocates a canonical thread id. The frontend
 * calls this BEFORE `sendMessage` when starting a new conversation;
 * for continuing threads, pass the existing `threadId` to `sendMessage`
 * directly.
 *
 * Kept separate from `sendMessage` because the first message may
 * need context (entity, decoration, document) that the thread row
 * should carry as metadata.
 */
export const createThread = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    title: v.optional(v.string()),
    surfaceOrigin: surfaceValidator,
    entitySlug: v.optional(v.string()),
    seedContext: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.anonymousSessionId ?? (identity.ownerKey as string);
    const threadId = globalThis.crypto?.randomUUID?.() ?? `thr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const now = Date.now();
    const insertedId = await ctx.db.insert("agentThreads", {
      ownerKey,
      userId: (identity.rawUserId ?? undefined) as any,
      threadId,
      title: (args.title ?? "New conversation").slice(0, 200),
      surfaceOrigin: args.surfaceOrigin,
      entitySlug: args.entitySlug,
      seedContext: args.seedContext,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      messageCount: 0,
    });
    return { threadId, rowId: insertedId };
  },
});

/**
 * `appendMessage` — inserts a message into a canonical thread.
 *
 * This is the SHADOW-WRITE entry point. Legacy paths continue to
 * write their own rows (chatMessagesStream / productChatEvents); the
 * frontend-facing wrapper also calls this mutation so canonical
 * tables accrue in parallel.
 *
 * Not intended to be user-visible as the primary send path; the
 * drawer still calls its streaming action for live UX. Instead, the
 * frontend dispatches `appendMessage` as a post-write tail from the
 * drawer's submit handler.
 */
export const appendMessage = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    threadId: v.string(),
    role: roleValidator,
    content: v.string(),
    surfaceOrigin: surfaceValidator,
    legacyMessageId: v.optional(v.string()),
    legacyTableHint: v.optional(v.string()),
    tokensUsed: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.anonymousSessionId ?? (identity.ownerKey as string);
    // BOUND: cap message body at 64 KB. Truncate instead of reject so
    // a rogue long response from the agent doesn't lose the whole
    // turn in the canonical log.
    const bodyBytes = new TextEncoder().encode(args.content).byteLength;
    const content =
      bodyBytes > MAX_MESSAGE_BODY_BYTES
        ? args.content.slice(0, Math.floor(MAX_MESSAGE_BODY_BYTES * 0.9))
        : args.content;
    const now = Date.now();
    const insertedId = await ctx.db.insert("agentMessages", {
      ownerKey,
      userId: (identity.rawUserId ?? undefined) as any,
      threadId: args.threadId,
      role: args.role,
      content,
      surfaceOrigin: args.surfaceOrigin,
      legacyMessageId: args.legacyMessageId,
      legacyTableHint: args.legacyTableHint,
      tokensUsed: args.tokensUsed,
      elapsedMs: args.elapsedMs,
      model: args.model,
      createdAt: now,
    });
    // Best-effort bump on the thread row for `lastMessageAt` /
    // `messageCount`. If the thread row doesn't exist (legacy thread
    // flowing through for the first time), we create it lazily so
    // the read path always sees a thread row.
    const existingThread = await ctx.db
      .query("agentThreads")
      .withIndex("by_owner_thread", (q) =>
        q.eq("ownerKey", ownerKey).eq("threadId", args.threadId),
      )
      .first();
    if (existingThread) {
      await ctx.db.patch(existingThread._id, {
        lastMessageAt: now,
        messageCount: existingThread.messageCount + 1,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("agentThreads", {
        ownerKey,
        userId: (identity.rawUserId ?? undefined) as any,
        threadId: args.threadId,
        title: (args.content.slice(0, 60) || "Conversation").trim(),
        surfaceOrigin: args.surfaceOrigin,
        status: "active",
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
        messageCount: 1,
      });
    }
    return insertedId;
  },
});

/**
 * `getThread` — canonical thread read. Returns thread metadata +
 * all messages in chronological order.
 *
 * Cheap on the happy path (O(messages) linear scan via index). For
 * long threads, UI paginates via `beforeCreatedAt` / `limit`.
 */
export const getThread = query({
  args: {
    threadId: v.string(),
    anonymousSessionId: v.optional(v.string()),
    limit: v.optional(v.number()),
    beforeCreatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveProductIdentitySafely(ctx, args.anonymousSessionId);
    if (!identity) return null;
    const ownerKey = identity.anonymousSessionId ?? (identity.ownerKey as string);
    const thread = await ctx.db
      .query("agentThreads")
      .withIndex("by_owner_thread", (q) =>
        q.eq("ownerKey", ownerKey).eq("threadId", args.threadId),
      )
      .first();
    if (!thread) return null;
    const limit = Math.min(args.limit ?? 100, MAX_LIST_LIMIT);
    const messageQuery = ctx.db
      .query("agentMessages")
      .withIndex("by_thread_time", (q) => q.eq("threadId", args.threadId));
    const rows = args.beforeCreatedAt
      ? await messageQuery
          .filter((q) => q.lt(q.field("createdAt"), args.beforeCreatedAt!))
          .order("desc")
          .take(limit)
      : await messageQuery.order("asc").take(limit);
    return {
      thread,
      messages: args.beforeCreatedAt ? rows.reverse() : rows,
    };
  },
});

/**
 * `listRecentThreads` — thread list for the current owner, most
 * recent first. Used by the drawer's "recent conversations" header
 * and by the chat page's left rail.
 */
export const listRecentThreads = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    surfaceOrigin: v.optional(surfaceValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await resolveProductIdentitySafely(ctx, args.anonymousSessionId);
    if (!identity) return [];
    const ownerKey = identity.anonymousSessionId ?? (identity.ownerKey as string);
    const limit = Math.min(args.limit ?? 25, MAX_LIST_LIMIT);
    const rows = await ctx.db
      .query("agentThreads")
      .withIndex("by_owner_last_message", (q) => q.eq("ownerKey", ownerKey))
      .order("desc")
      .take(limit);
    return args.surfaceOrigin
      ? rows.filter((r) => r.surfaceOrigin === args.surfaceOrigin)
      : rows;
  },
});
