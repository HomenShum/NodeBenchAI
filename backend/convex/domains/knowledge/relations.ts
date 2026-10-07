import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../../_generated/dataModel";

function assertUser(userId: string | null) {
  if (!userId) throw new Error("unauthenticated");
}

/* ------------------------------------------------------------------ */
/* Queries                                                            */
/* ------------------------------------------------------------------ */
export const by_document = query({
  args: { docId: v.id("documents") },
  handler: async (ctx, { docId }) => {
    // join through nodes.by_document to cut query fan-out
    const nodeIds = await ctx.db
      .query("nodes")
      .withIndex("by_document", (q) => q.eq("documentId", docId))
      .collect();

    const ids = nodeIds.map((n) => n._id);
    const rels: Array<any> = [];

    for (const id of ids) {
      for await (const rel of ctx.db
        .query("relations")
        .withIndex("by_from", (q) => q.eq("from", id))) {
        rels.push(rel);
      }
    }
    return rels;
  },
});

/* ------------------------------------------------------------------ */
/* Mutations                                                          */
/* ------------------------------------------------------------------ */
export const add = mutation({
  args: {
    from: v.id("nodes"),
    to: v.id("nodes"),
    relationTypeId: v.string(),
    order: v.optional(v.number()),
  },
  returns: v.id("relations"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    assertUser(userId);
    const id = await ctx.db.insert("relations", {
      ...args,
      createdBy: userId!,
      createdAt: Date.now(),
    });
    return id;
  },
});

export const move = mutation({
  args: {
    nodeId: v.id("nodes"),
    newParentId: v.id("nodes"),
    order: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { nodeId, newParentId, order }) => {
    const userId = await getAuthUserId(ctx);
    assertUser(userId);

    // delete existing child relation(s) pointing to nodeId
    for await (const rel of ctx.db
      .query("relations")
      .withIndex("by_to", (q) => q.eq("to", nodeId))) {
      await ctx.db.delete(rel._id);
    }

    await ctx.db.insert("relations", {
      from: newParentId,
      to: nodeId,
      relationTypeId: "child",
      order: order ?? Date.now(),
      createdBy: userId!,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("relations") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    assertUser(userId);
    const rel = await ctx.db.get(id) as Doc<"relations"> | null;
    if (!rel) throw new Error("not found");
    if (rel.createdBy !== userId) throw new Error("forbidden");
    await ctx.db.delete(id);
    return null;
  },
});
