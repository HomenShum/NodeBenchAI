import { v } from "convex/values";
import { internalQuery, mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id, Doc } from "../../_generated/dataModel";

// Utilities
function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Canonical tag kinds we support across the app
type TagKind = "keyword" | "entity" | "topic" | "community" | "relationship";

function canonicalizeKind(kind?: string | null, name?: string | null): TagKind | undefined {
  const k = (kind || "").toString().trim().toLowerCase();
  if (k) {
    if (["keyword", "key", "kw"].includes(k)) return "keyword";
    if (["entity", "person", "organization", "org", "company", "product", "library", "framework", "place", "location"].includes(k)) return "entity";
    if (["topic", "domain", "theme", "subject"].includes(k)) return "topic";
    if (["community", "forum", "group", "ecosystem", "audience", "users", "developers", "devs"].includes(k)) return "community";
    if (["relationship", "relation", "rel", "association", "interaction"].includes(k)) return "relationship";
  }

  // Guess kind based on name when not provided or unrecognized
  const n = (name || "").toString();
  const nLower = n.toLowerCase();
  if (!k) {
    // Community signals
    const communitySignals = ["community", "forum", "discord", "slack", "subreddit", "stack overflow", "github", "newsletter", "group", "meetup"];
    if (communitySignals.some((s) => nLower.includes(s))) return "community";

    // Relationship signals
    const relSignals = [" vs ", "integrat", "depend", "partner", "compete", "collaborat", "uses ", "built on", "powered by", "connects to"];
    if (relSignals.some((s) => nLower.includes(s))) return "relationship";

    // Proper noun → entity (e.g. "React", "OpenAI API")
    const hasCapitalizedWord = /(^|\s)[A-Z][\w-]+/.test(n);
    if (hasCapitalizedWord) return "entity";

    // Multi-word → topic, single word → keyword
    if (n.trim().includes(" ")) return "topic";
    return "keyword";
  }
  return undefined; // leave undefined if caller prefers
}

// Return type validator for tags we expose to the client
const TagDocValidator = v.object({
  _id: v.id("tags"),
  name: v.string(),
  kind: v.optional(v.string()),
  importance: v.optional(v.number()),
});

export const listForDocument = query({
  args: { documentId: v.id("documents") },
  returns: v.array(TagDocValidator),
  handler: async (ctx, { documentId }) => {
    const userId = await getAuthUserId(ctx);
    const doc = await ctx.db.get(documentId) as Doc<"documents"> | null;
    if (!doc) return [];
    if (!doc.isPublic && doc.createdBy !== userId) return [];

    // Load tagRefs by target
    const refs = await ctx.db
      .query("tagRefs")
      .withIndex("by_target", (q) => q.eq("targetId", String(documentId)).eq("targetType", "documents"))
      .collect();
    const results: Array<{ _id: Id<"tags">; name: string; kind?: string; importance?: number }> = [];
    for (const ref of refs) {
      const tag = await ctx.db.get(ref.tagId) as Doc<"tags"> | null;
      if (tag)
        results.push({
          _id: tag._id,
          name: tag.name,
          kind: canonicalizeKind(tag.kind, tag.name) || tag.kind,
          importance: tag.importance,
        });
    }
    return results;
  },
});

export const listForDocuments = query({
  args: { documentIds: v.array(v.id("documents")) },
  returns: v.array(
    v.object({
      documentId: v.id("documents"),
      tags: v.array(TagDocValidator),
    }),
  ),
  handler: async (ctx, { documentIds }) => {
    const userId = await getAuthUserId(ctx);
    const seen = new Set<string>();
    const uniqueDocumentIds: typeof documentIds = [];
    for (const id of documentIds) {
      if (!seen.has(id)) { seen.add(id); uniqueDocumentIds.push(id); }
    }
    const tagCache = new Map<
      Id<"tags">,
      { _id: Id<"tags">; name: string; kind?: string; importance?: number } | null
    >();
    const rows: Array<{
      documentId: Id<"documents">;
      tags: Array<{
        _id: Id<"tags">;
        name: string;
        kind?: string;
        importance?: number;
      }>;
    }> = [];

    for (const documentId of uniqueDocumentIds) {
      const doc = (await ctx.db.get(documentId)) as Doc<"documents"> | null;
      if (!doc) continue;
      if (!doc.isPublic && doc.createdBy !== userId) continue;

      const refs = await ctx.db
        .query("tagRefs")
        .withIndex("by_target", (q) =>
          q.eq("targetId", String(documentId)).eq("targetType", "documents"),
        )
        .collect();

      const tags: Array<{
        _id: Id<"tags">;
        name: string;
        kind?: string;
        importance?: number;
      }> = [];

      for (const ref of refs) {
        if (!tagCache.has(ref.tagId)) {
          const tag = (await ctx.db.get(ref.tagId)) as Doc<"tags"> | null;
          tagCache.set(
            ref.tagId,
            tag
              ? {
                  _id: tag._id,
                  name: tag.name,
                  kind: canonicalizeKind(tag.kind, tag.name) || tag.kind,
                  importance: tag.importance,
                }
              : null,
          );
        }
        const cachedTag = tagCache.get(ref.tagId);
        if (cachedTag) {
          tags.push(cachedTag);
        }
      }

      rows.push({ documentId, tags });
    }

    return rows;
  },
});

// Hover preview for a tag by name
export const getPreviewByName = query({
  args: { name: v.string(), limit: v.optional(v.number()) },
  returns: v.object({
    name: v.string(),
    kind: v.optional(v.string()),
    count: v.number(),
    topDocuments: v.array(
      v.object({ _id: v.id("documents"), title: v.string() })
    ),
  }),
  handler: async (ctx, { name, limit = 5 }) => {
    const userId = await getAuthUserId(ctx);
    const nm = normalizeTagName(name);
    const lim = Math.max(1, Math.min(10, limit));

    const tag = await ctx.db
      .query("tags")
      .withIndex("by_name", (q) => q.eq("name", nm))
      .first() as Doc<"tags"> | null;

    if (!tag) {
      return { name: nm, kind: canonicalizeKind(undefined, nm), count: 0, topDocuments: [] };
    }

    const kind = canonicalizeKind(tag.kind, tag.name) || tag.kind;

    // Iterate refs to count accessible documents and collect top titles
    let count = 0;
    const topDocuments: Array<{ _id: Id<"documents">; title: string }> = [];
    const refs = ctx.db
      .query("tagRefs")
      .withIndex("by_tag", (q) => q.eq("tagId", tag._id));

    for await (const ref of refs) {
      if (ref.targetType !== "documents") continue;
      const docId = ref.targetId as unknown as Id<"documents">;
      const doc = await ctx.db.get(docId) as Doc<"documents"> | null;
      if (!doc) continue;
      const accessible = doc.isPublic || (userId ? doc.createdBy === userId : false);
      if (!accessible) continue;
      count++;
      if (topDocuments.length < lim) {
        topDocuments.push({ _id: doc._id, title: doc.title });
      }
    }

    return { name: tag.name, kind, count, topDocuments };
  },
});

// Search tags by name (for hashtag suggestions)
export const search = query({
  args: {
    query: v.string(),
    kinds: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  returns: v.array(TagDocValidator),
  handler: async (ctx, { query, kinds, limit = 8 }) => {
    const qStr = (query ?? "").trim();
    const lim = Math.max(1, Math.min(50, limit));

    // Fetch candidates using full-text search when we have a query, else fall back to recent tags
    let rows: Doc<"tags">[] = [];
    if (qStr.length > 0) {
      rows = await ctx.db
        .query("tags")
        .withSearchIndex("search_name", (q) => q.search("name", qStr))
        .take(lim * 2);
    } else {
      rows = await ctx.db.query("tags").order("desc").take(lim * 2);
    }

    const allowedKinds = kinds && kinds.length > 0 ? new Set(kinds.map((k: any) => k.toLowerCase())) : null;
    const out: Array<{ _id: Id<"tags">; name: string; kind?: string; importance?: number }> = [];
    for (const tag of rows) {
      const kind = canonicalizeKind(tag.kind, tag.name) || tag.kind;
      if (allowedKinds && kind && !allowedKinds.has(kind)) continue;
      out.push({ _id: tag._id, name: tag.name, kind, importance: tag.importance });
      if (out.length >= lim) break;
    }
    return out;
  },
});

export const addTagsToDocument = mutation({
  args: {
    documentId: v.id("documents"),
    tags: v.array(
      v.object({
        name: v.string(),
        kind: v.optional(v.string()),
        importance: v.optional(v.number()),
      }),
    ),
  },
  returns: v.array(TagDocValidator),
  handler: async (ctx, { documentId, tags }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const doc = await ctx.db.get(documentId) as Doc<"documents"> | null;
    if (!doc) throw new Error("Document not found");
    if (doc.createdBy !== userId) throw new Error("Unauthorized");

    const now = Date.now();

    // De-dup names within request
    const seen = new Set<string>();
    const pending = tags
      .map((t: any) => ({
        name: normalizeTagName(t.name),
        kind: canonicalizeKind(t.kind, t.name) || t.kind,
        importance: typeof t.importance === "number" ? Math.max(0, Math.min(1, t.importance)) : undefined,
      }))
      .filter((t: any) => {
        if (!t.name) return false;
        if (seen.has(t.name)) return false;
        seen.add(t.name);
        return true;
      });

    // Find or create tags, then upsert tagRefs
    for (const t of pending) {
      // Check existing tag by name
      const existing = await ctx.db
        .query("tags")
        .withIndex("by_name", (q) => q.eq("name", t.name))
        .first() as Doc<"tags"> | null;
      let tagId: Id<"tags">;
      if (existing) {
        tagId = existing._id;
        // Optionally update kind/importance if absent on existing and provided now
        const patch: Partial<Doc<"tags">> = {};
        if (t.kind && !existing.kind) patch.kind = t.kind as Doc<"tags">["kind"];
        if (
          typeof t.importance === "number" &&
          typeof existing.importance !== "number"
        )
          patch.importance = t.importance as Doc<"tags">["importance"];
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(tagId, patch);
        }
      } else {
        tagId = await ctx.db.insert("tags", {
          name: t.name,
          kind: t.kind,
          importance: t.importance,
          createdBy: userId,
          createdAt: now,
        });
      }

      // Upsert tagRef
      const existingRefs = await ctx.db
        .query("tagRefs")
        .withIndex("by_target", (q) => q.eq("targetId", String(documentId)).eq("targetType", "documents"))
        .collect();
      const hasRef = existingRefs.some((r) => r.tagId === tagId);
      if (!hasRef) {
        await ctx.db.insert("tagRefs", {
          tagId,
          targetId: String(documentId),
          targetType: "documents",
          createdBy: userId,
          createdAt: now,
        });
      }
    }

    // Return updated tag list
    const updated = await ctx.db
      .query("tagRefs")
      .withIndex("by_target", (q) => q.eq("targetId", String(documentId)).eq("targetType", "documents"))
      .collect();
    const out: Array<{ _id: Id<"tags">; name: string; kind?: string; importance?: number }> = [];
    for (const ref of updated) {
      const tag = await ctx.db.get(ref.tagId) as Doc<"tags"> | null;
      if (tag)
        out.push({
          _id: tag._id,
          name: tag.name,
          kind: canonicalizeKind(tag.kind, tag.name) || tag.kind,
          importance: tag.importance,
        });
    }
    return out;
  },
});

// Remove a tag reference from a document and return updated tags
export const removeTagFromDocument = mutation({
  args: {
    documentId: v.id("documents"),
    tagId: v.id("tags"),
  },
  returns: v.array(TagDocValidator),
  handler: async (ctx, { documentId, tagId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const doc = await ctx.db.get(documentId) as Doc<"documents"> | null;
    if (!doc) throw new Error("Document not found");
    if (doc.createdBy !== userId) throw new Error("Unauthorized");

    // Find the tagRef for this document/tag pair and delete it if present
    const ref = await ctx.db
      .query("tagRefs")
      .withIndex("by_target", (q) => q.eq("targetId", String(documentId)).eq("targetType", "documents"))
      .filter((q) => q.eq(q.field("tagId"), tagId))
      .first() as Doc<"tagRefs"> | null;
    if (ref) {
      await ctx.db.delete(ref._id);
    }

    // Return updated tag list
    const updated = await ctx.db
      .query("tagRefs")
      .withIndex("by_target", (q) => q.eq("targetId", String(documentId)).eq("targetType", "documents"))
      .collect();
    const out: Array<{ _id: Id<"tags">; name: string; kind?: string; importance?: number }> = [];
    for (const r of updated) {
      const tag = await ctx.db.get(r.tagId) as Doc<"tags"> | null;
      if (tag)
        out.push({
          _id: tag._id,
          name: tag.name,
          kind: canonicalizeKind(tag.kind, tag.name) || tag.kind,
          importance: tag.importance,
        });
    }
    return out;
  },
});

// Update a tag's kind (canonicalized) and return updated tags for the document
export const updateTagKind = mutation({
  args: { documentId: v.id("documents"), tagId: v.id("tags"), kind: v.optional(v.string()) },
  returns: v.array(TagDocValidator),
  handler: async (ctx, { documentId, tagId, kind }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const doc = await ctx.db.get(documentId) as Doc<"documents"> | null;
    if (!doc) throw new Error("Document not found");
    if (doc.createdBy !== userId) throw new Error("Unauthorized");

    const tag = await ctx.db.get(tagId) as Doc<"tags"> | null;
    if (!tag) throw new Error("Tag not found");

    const canonical = canonicalizeKind(kind, tag.name) || kind;
    await ctx.db.patch(tagId, { kind: canonical });

    // Return updated tag list for this document
    const updated = await ctx.db
      .query("tagRefs")
      .withIndex("by_target", (q) => q.eq("targetId", String(documentId)).eq("targetType", "documents"))
      .collect();
    const out: Array<{ _id: Id<"tags">; name: string; kind?: string; importance?: number }> = [];
    for (const r of updated) {
      const t = await ctx.db.get(r.tagId) as Doc<"tags"> | null;
      if (t)
        out.push({
          _id: t._id,
          name: t.name,
          kind: canonicalizeKind(t.kind, t.name) || t.kind,
          importance: t.importance,
        });
    }
    return out;
  },
});

// Internal helper to assemble plain text from a document's content
export const getDocumentText = internalQuery({
  args: { documentId: v.id("documents"), maxChars: v.optional(v.number()) },
  returns: v.string(),
  handler: async (ctx, { documentId, maxChars = 8000 }) => {
    const doc = await ctx.db.get(documentId) as Doc<"documents"> | null;
    if (!doc) return "";

    const pieces: string[] = [doc.title];
    // Pull nodes' text in order
    const nodes = await ctx.db
      .query("nodes")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .order("asc")
      .take(400);

    for (const n of nodes) {
      if (n.text && typeof n.text === "string") {
        pieces.push(n.text);
      }
      if (pieces.join("\n").length > maxChars) break;
    }

    let full = pieces.join("\n");
    if (full.length > maxChars) full = full.slice(0, maxChars);
    return full;
  },
});
