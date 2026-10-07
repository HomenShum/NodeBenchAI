/**
 * Model Normalization Migration
 *
 * One-time migration to normalize legacy model strings in chat threads and messages
 * to use the 7 approved model aliases.
 *
 * @module mcp_tools/models/migration
 */

import { action, internalAction, query, internalMutation, internalQuery } from "../../../../_generated/server";
import { internal } from "../../../../_generated/api";
import { v } from "convex/values";
import { normalizeModelInput, isApprovedModel } from "./modelResolver";
import type { Id } from "../../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// MIGRATION TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface MigrationResult {
  success: boolean;
  threadsChecked: number;
  threadsUpdated: number;
  messagesChecked: number;
  messagesUpdated: number;
  modelsNormalized: Record<string, { to: string; count: number }>;
  errors: string[];
  dryRun: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// MIGRATION QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const getLegacyThreads = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Array<{ _id: Id<"chatThreadsStream">; model: string; normalized: string }>> => {
    const limit = args.limit ?? 100;
    const threads = await ctx.db.query("chatThreadsStream").take(limit * 10);
    const legacyThreads: Array<{ _id: Id<"chatThreadsStream">; model: string; normalized: string }> = [];
    for (const thread of threads) {
      if (thread.model && !isApprovedModel(thread.model)) {
        const normalized = normalizeModelInput(thread.model);
        if (normalized !== thread.model) {
          legacyThreads.push({ _id: thread._id, model: thread.model, normalized });
        }
      }
      if (legacyThreads.length >= limit) break;
    }
    return legacyThreads;
  },
});

export const getLegacyMessages = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Array<{ _id: Id<"chatMessagesStream">; model: string; normalized: string }>> => {
    const limit = args.limit ?? 100;
    const messages = await ctx.db.query("chatMessagesStream").take(limit * 10);
    const legacyMessages: Array<{ _id: Id<"chatMessagesStream">; model: string; normalized: string }> = [];
    for (const msg of messages) {
      if (msg.model && !isApprovedModel(msg.model)) {
        const normalized = normalizeModelInput(msg.model);
        if (normalized !== msg.model) {
          legacyMessages.push({ _id: msg._id, model: msg.model, normalized });
        }
      }
      if (legacyMessages.length >= limit) break;
    }
    return legacyMessages;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MIGRATION MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const normalizeThreadModel = internalMutation({
  args: { threadId: v.id("chatThreadsStream"), normalizedModel: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { model: args.normalizedModel });
  },
});

export const normalizeMessageModel = internalMutation({
  args: { messageId: v.id("chatMessagesStream"), normalizedModel: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { model: args.normalizedModel });
  },
});

export const getMigrationStats = query({
  args: {},
  handler: async (ctx) => {
    const threads = await ctx.db.query("chatThreadsStream").collect();
    const messages = await ctx.db.query("chatMessagesStream").collect();
    let threadsWithModel = 0, messagesWithModel = 0;
    let threadsNeedingMigration = 0, messagesNeedingMigration = 0;
    const legacyModelsFound: Record<string, number> = {};
    for (const thread of threads) {
      if (thread.model) {
        threadsWithModel++;
        if (!isApprovedModel(thread.model)) {
          threadsNeedingMigration++;
          legacyModelsFound[thread.model] = (legacyModelsFound[thread.model] ?? 0) + 1;
        }
      }
    }
    for (const msg of messages) {
      if (msg.model) {
        messagesWithModel++;
        if (!isApprovedModel(msg.model)) {
          messagesNeedingMigration++;
          legacyModelsFound[msg.model] = (legacyModelsFound[msg.model] ?? 0) + 1;
        }
      }
    }
    return { threadsWithModel, messagesWithModel, threadsNeedingMigration, messagesNeedingMigration, legacyModelsFound };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MAIN MIGRATION ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the model normalization migration
 */
export const runModelMigration = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MigrationResult> => {
    const dryRun = args.dryRun ?? true;
    const batchSize = args.batchSize ?? 50;
    console.log(`[ModelMigration] Starting (dryRun: ${dryRun}, batchSize: ${batchSize})`);

    const result: MigrationResult = {
      success: true, threadsChecked: 0, threadsUpdated: 0,
      messagesChecked: 0, messagesUpdated: 0, modelsNormalized: {}, errors: [], dryRun,
    };

    try {
      // Process threads
      let hasMoreThreads = true;
      while (hasMoreThreads) {
        const legacyThreads = await ctx.runQuery(
          internal.domains.agents.mcp_tools.models.migration.getLegacyThreads,
          { limit: batchSize }
        );
        result.threadsChecked += legacyThreads.length;
        if (legacyThreads.length === 0) { hasMoreThreads = false; break; }

        for (const thread of legacyThreads) {
          if (!result.modelsNormalized[thread.model]) {
            result.modelsNormalized[thread.model] = { to: thread.normalized, count: 0 };
          }
          result.modelsNormalized[thread.model].count++;
          if (!dryRun) {
            await ctx.runMutation(
              internal.domains.agents.mcp_tools.models.migration.normalizeThreadModel,
              { threadId: thread._id, normalizedModel: thread.normalized }
            );
          }
          result.threadsUpdated++;
        }
        if (dryRun) hasMoreThreads = false;
      }

      // Process messages
      let hasMoreMessages = true;
      while (hasMoreMessages) {
        const legacyMessages = await ctx.runQuery(
          internal.domains.agents.mcp_tools.models.migration.getLegacyMessages,
          { limit: batchSize }
        );
        result.messagesChecked += legacyMessages.length;
        if (legacyMessages.length === 0) { hasMoreMessages = false; break; }

        for (const msg of legacyMessages) {
          if (!result.modelsNormalized[msg.model]) {
            result.modelsNormalized[msg.model] = { to: msg.normalized, count: 0 };
          }
          result.modelsNormalized[msg.model].count++;
          if (!dryRun) {
            await ctx.runMutation(
              internal.domains.agents.mcp_tools.models.migration.normalizeMessageModel,
              { messageId: msg._id, normalizedModel: msg.normalized }
            );
          }
          result.messagesUpdated++;
        }
        if (dryRun) hasMoreMessages = false;
      }
      console.log(`[ModelMigration] Complete:`, JSON.stringify(result));
    } catch (err) {
      result.success = false;
      result.errors.push(`Migration failed: ${err}`);
    }
    return result;
  },
});

/**
 * Public action to run migration (with safety check)
 */
export const migrateModelStrings = action({
  args: { dryRun: v.optional(v.boolean()), confirm: v.optional(v.string()) },
  handler: async (ctx, args): Promise<MigrationResult> => {
    const dryRun = args.dryRun !== false;
    if (!dryRun && args.confirm !== "I_UNDERSTAND_THIS_WILL_MODIFY_DATA") {
      return {
        success: false, threadsChecked: 0, threadsUpdated: 0,
        messagesChecked: 0, messagesUpdated: 0, modelsNormalized: {},
        errors: ["Set confirm to 'I_UNDERSTAND_THIS_WILL_MODIFY_DATA' to run non-dry"],
        dryRun: true,
      };
    }
    return await ctx.runAction(
      internal.domains.agents.mcp_tools.models.migration.runModelMigration,
      { dryRun, batchSize: 50 }
    );
  },
});
