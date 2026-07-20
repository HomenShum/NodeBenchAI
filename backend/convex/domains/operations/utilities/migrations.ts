import { internalMutation, mutation } from "../../../_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "../../../_generated/dataModel";
import { internal } from "../../../_generated/api";
import { coerceToBlockJson, detectNodeType, createBlockJson, extractPlainText } from "../../../lib/markdown";

/**
 * One-off mutation that converts a single legacy document (stored as a
 * ProseMirror JSON blob in `documents.content`) into graph rows in
 * `nodes` and `relations`.
 *
 * Run via: `npx convex run migrateDocument -- --docId <id>`
 */
export const migrateDocument = internalMutation({
  args: { docId: v.id("documents") },
  returns: v.null(),
  handler: async (ctx, { docId }) => {
    const doc = await ctx.db.get(docId) as Doc<"documents"> | null;
    if (!doc || !doc.content) return null;

    const pmJSON = JSON.parse(doc.content);
    let orderCounter = 0;

    // Recursive helper to explode the ProseMirror tree.
    const walk = async (
      pmNode: any,
      parentId?: Id<"nodes">,
    ): Promise<Id<"nodes"> | null> => {
      // Derive markdown from ProseMirror node textContent
      const md = String(pmNode?.textContent ?? "").trim();
      if (!md) {
        // Recurse into children to find contentful descendants
        let lastChildId: Id<"nodes"> | null = null;
        if (Array.isArray(pmNode?.content)) {
          for (const child of pmNode.content) {
            const childId = await walk(child, parentId);
            if (childId) lastChildId = childId;
          }
        }
        return lastChildId;
      }

      // Build a normalized BlockNote block from markdown
      const nodeType = detectNodeType(md);
      const normalized = coerceToBlockJson(createBlockJson(nodeType, md), extractPlainText(md));

      const thisId = await ctx.db.insert("nodes", {
        documentId: docId,
        parentId,
        order: orderCounter++,
        type: normalized.type,
        text: normalized.text,
        json: normalized.block,
        authorId: doc.createdBy,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isUserNode: true,
      });

      if (parentId) {
        await ctx.db.insert("relations", {
          from: parentId,
          to: thisId,
          relationTypeId: "child",
          order: orderCounter,
          createdBy: doc.createdBy,
          createdAt: Date.now(),
        });
      }

      // Recurse into children (some PM nodes may have additional content)
      if (Array.isArray(pmNode?.content)) {
        for (const child of pmNode.content) {
          await walk(child, thisId);
        }
      }
      return thisId;
    };

    const rootId = await walk(pmJSON);

    // Back-reference the root node on the legacy document row.
    if (rootId) {
      await ctx.db.patch(docId, { rootNodeId: rootId });
    }

    // Optionally clear the old blob to free space (commented by default).
    // await ctx.db.patch(docId, { content: undefined });

    return null;
  },
});

/**
 * Batch migration over every legacy document that still has a `content` blob.
 *
 * Run once via: `npx convex run migrateAllDocs`
 */
export const migrateAllDocs = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const docs = await ctx.db
      .query("documents")
      .collect() as Doc<"documents">[];
    for (const doc of docs) {
      if (doc.content && !doc.rootNodeId) {
        // Call the above mutation via scheduler to avoid bursting the 500kb and time limits.
        // Using internal reference means no auth checks.
        // Schedule with zero-delay so we stay within per-mutation limits.
        // Use statically imported 'internal' - dynamic imports are not supported in mutations
        await ctx.scheduler.runAfter(
          0,
          internal.domains.utilities.migrations.migrateDocument,
          { docId: doc._id },
        );
      }
    }
    return null;
  },
});
