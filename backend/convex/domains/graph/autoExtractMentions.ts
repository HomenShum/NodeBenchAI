/**
 * autoExtractMentions — Background job that scans document content for
 * entity mentions and creates backlinks automatically.
 *
 * Runs after document save/update to detect @mentions and known entity
 * names, then inserts corresponding backlink entries in the graph.
 *
 * Pattern: Background mutation triggered by document save hooks.
 * Prior art:
 *   - Roam Research: auto-backlinks on [[page reference]] creation
 *   - Obsidian: automatic backlink indexing on file save
 *
 * See: docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md Phase 4
 */

import { v } from "convex/values";
import { internalMutation, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";

/** BOUND: max entities to scan per document */
const MAX_ENTITIES_PER_DOC = 50;
/** BOUND: max backlinks to create per extraction run */
const MAX_BACKLINKS_PER_RUN = 100;
/** BOUND: max document content length to scan */
const MAX_CONTENT_LENGTH = 50_000;

/**
 * Extract entity mentions from document text content.
 * Returns entity slugs found in the text.
 */
export const extractMentionsFromDocument = internalAction({
  args: {
    documentId: v.id("documents"),
    content: v.string(),
    sourceEntityId: v.optional(v.id("entityProfiles")),
  },
  handler: async (ctx, args) => {
    const content = args.content.slice(0, MAX_CONTENT_LENGTH);

    // 1. Find all @mention patterns
    const mentionPattern = /@([A-Za-z][A-Za-z0-9\s-]{1,60})/g;
    const mentionNames: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = mentionPattern.exec(content)) !== null) {
      mentionNames.push(match[1].trim());
    }

    if (mentionNames.length === 0) return { extracted: 0 };

    // 2. Look up which mentioned names match known entity profiles
    const uniqueNames = [...new Set(mentionNames)].slice(0, MAX_ENTITIES_PER_DOC);
    const matchedEntities: Array<{
      entityId: string;
      name: string;
      context: string;
    }> = [];

    for (const name of uniqueNames) {
      const entities = await ctx.runQuery(
        internal.domains.graph.autoExtractMentions.findEntityByName,
        { name },
      );

      if (entities && entities.length > 0) {
        // Find context around the mention in the document
        const idx = content.toLowerCase().indexOf(name.toLowerCase());
        const contextStart = Math.max(0, idx - 50);
        const contextEnd = Math.min(content.length, idx + name.length + 50);
        const context = content.slice(contextStart, contextEnd);

        matchedEntities.push({
          entityId: entities[0]._id,
          name: entities[0].canonicalName ?? name,
          context,
        });
      }
    }

    if (matchedEntities.length === 0) return { extracted: 0 };

    // 3. Create backlinks for each matched entity
    let created = 0;
    for (const entity of matchedEntities.slice(0, MAX_BACKLINKS_PER_RUN)) {
      try {
        await ctx.runMutation(
          internal.domains.graph.autoExtractMentions.upsertMentionBacklink,
          {
            sourceDocumentId: args.documentId,
            sourceEntityId: args.sourceEntityId,
            // Safe cast: entityId originates from entities[0]._id (Id<"entityProfiles">)
            // stored as string in the intermediate matchedEntities array
            targetEntityId: entity.entityId as unknown as typeof args.documentId,
            sourceContext: entity.context.slice(0, 200),
          },
        );
        created++;
      } catch (err) {
        console.warn(`[autoExtractMentions] Failed to create backlink for ${entity.name}:`, err);
        // Continue processing remaining entities — partial success is first-class
      }
    }

    return { extracted: created };
  },
});

/**
 * Find entity profile by canonical name (case-insensitive search).
 */
export const findEntityByName = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    // Search entity profiles by name
    const results = await ctx.db
      .query("entityProfiles")
      .filter((q) =>
        q.eq(
          q.field("canonicalName"),
          args.name,
        ),
      )
      .take(1);

    return results;
  },
});

/**
 * Create or update a mention-type backlink from a document to an entity.
 * Idempotent: won't create duplicates for the same source→target pair.
 */
export const upsertMentionBacklink = internalMutation({
  args: {
    sourceDocumentId: v.id("documents"),
    sourceEntityId: v.optional(v.id("entityProfiles")),
    targetEntityId: v.id("entityProfiles"),
    sourceContext: v.string(),
  },
  handler: async (ctx, args) => {
    // Check for existing backlink (idempotency)
    const existing = await ctx.db
      .query("backlinks")
      .withIndex("by_target", (q) => q.eq("targetEntityId", args.targetEntityId))
      .filter((q) =>
        q.and(
          q.eq(q.field("backlinkType"), "mention"),
          q.eq(q.field("sourceDocumentId"), args.sourceDocumentId),
        ),
      )
      .first();

    if (existing) {
      // Update context if changed
      if (existing.sourceContext !== args.sourceContext) {
        await ctx.db.patch(existing._id, {
          sourceContext: args.sourceContext,
          updatedAt: Date.now(),
        });
      }
      return { created: false, updated: true };
    }

    // Create new backlink
    await ctx.db.insert("backlinks", {
      sourceEntityId: args.sourceEntityId,
      sourceDocumentId: args.sourceDocumentId,
      targetEntityId: args.targetEntityId,
      backlinkType: "mention",
      confidence: 0.9,
      sourceContext: args.sourceContext,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { created: true, updated: false };
  },
});
