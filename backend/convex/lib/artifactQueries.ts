// convex/lib/artifactQueries.ts
// Queries and mutations for artifact persistence
// Used for hydration (page reload) and newsletter generation

import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  artifactCardValidator,
  artifactFlagsValidator,
} from "./artifactValidators";
import { toArtifactCards, toArtifactCard } from "./artifactModels";

// ═══════════════════════════════════════════════════════════════════════════
// AUTH HELPER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get authenticated user ID safely (handles malformed IDs from auth providers)
 */
async function getSafeUserId(ctx: any): Promise<Id<"users"> | null> {
  const rawUserId = await getAuthUserId(ctx);
  if (!rawUserId) return null;

  // Handle malformed user IDs with pipe characters
  let userId: Id<"users">;
  if (typeof rawUserId === 'string' && rawUserId.includes('|')) {
    const userIdPart = rawUserId.split('|')[0];
    if (!userIdPart || userIdPart.length < 10) return null;
    userId = userIdPart as Id<"users">;
  } else {
    userId = rawUserId;
  }

  // Verify the user exists
  const user = await ctx.db.get(userId) as Doc<"users"> | null;
  if (!user) return null;

  return userId;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES - Hydration for newsletter generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all artifacts for a run (filtered by userId for security)
 * Returns ArtifactCard[] (mapped from DB rows at the edge)
 */
export const getArtifactsByRun = query({
  args: {
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) return [];
    
    const rows = await ctx.db
      .query("artifacts")
      .withIndex("by_user_run", (q) =>
        q.eq("userId", userId).eq("runId", args.runId)
      )
      .collect() as Doc<"artifacts">[];

    // Map DB rows to ArtifactCard at the edge
    return toArtifactCards(rows);
  },
});

/**
 * Get artifact links (section assignments) for a run
 */
export const getArtifactLinksByRun = query({
  args: {
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) return [];
    
    // Security: verify user owns artifacts in this run first
    const hasAccess = await ctx.db
      .query("artifacts")
      .withIndex("by_user_run", (q) =>
        q.eq("userId", userId).eq("runId", args.runId)
      )
      .first() as Doc<"artifacts"> | null;

    if (!hasAccess) return [];

    return await ctx.db
      .query("artifactLinks")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect() as Doc<"artifactLinks">[];
  },
});

/**
 * Get evidence links (fact → artifact citations) for a run
 */
export const getEvidenceLinksByRun = query({
  args: {
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) return [];
    
    // Check if user has any artifacts in this run
    const hasAccess = await ctx.db
      .query("artifacts")
      .withIndex("by_user_run", (q) =>
        q.eq("userId", userId).eq("runId", args.runId)
      )
      .first() as Doc<"artifacts"> | null;

    if (!hasAccess) return [];

    return await ctx.db
      .query("evidenceLinks")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect() as Doc<"evidenceLinks">[];
  },
});

/**
 * Get a single artifact by ID (for detail views)
 * Returns ArtifactCard | null (mapped from DB row)
 */
export const getArtifactById = query({
  args: {
    runId: v.string(),
    artifactId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) return null;
    
    // Fetch artifact and verify ownership
    const row = await ctx.db
      .query("artifacts")
      .withIndex("by_run_artifact", (q) =>
        q.eq("runId", args.runId).eq("artifactId", args.artifactId)
      )
      .first() as Doc<"artifacts"> | null;

    // Security check: verify user owns this artifact
    if (!row || row.userId !== userId) return null;
    
    // Map to ArtifactCard at the edge
    return toArtifactCard(row);
  },
});

/**
 * Get artifacts by section (for per-section MediaRail)
 * Returns ArtifactCard[] (mapped from DB rows)
 */
export const getArtifactsBySection = query({
  args: {
    runId: v.string(),
    sectionId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) return [];
    
    // Get artifact links for this section
    const links = await ctx.db
      .query("artifactLinks")
      .withIndex("by_run_section", (q) =>
        q.eq("runId", args.runId).eq("sectionId", args.sectionId)
      )
      .collect() as Doc<"artifactLinks">[];

    // Fetch full artifact data (only user's artifacts)
    const rows = await Promise.all(
      links.map(async (link: Doc<"artifactLinks">) => {
        const row = await ctx.db
          .query("artifacts")
          .withIndex("by_run_artifact", (q) =>
            q.eq("runId", args.runId).eq("artifactId", link.artifactId)
          )
          .first() as Doc<"artifacts"> | null;
        // Security: only return if user owns this artifact
        return row && row.userId === userId ? row : null;
      })
    );
    
    // Filter nulls and map to ArtifactCard at the edge
    return toArtifactCards(rows.filter((r: Doc<"artifacts"> | null): r is Doc<"artifacts"> => r !== null));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS - Artifact persistence (called after streaming)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert an artifact (insert or update if rev is higher)
 */
export const upsertArtifact = mutation({
  args: {
    runId: v.string(),
    artifact: artifactCardValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    
    // Check if artifact already exists
    const existing = await ctx.db
      .query("artifacts")
      .withIndex("by_run_artifact", (q) =>
        q.eq("runId", args.runId).eq("artifactId", args.artifact.id)
      )
      .first() as Doc<"artifacts"> | null;

    if (existing) {
      // Only update if rev is higher (safe merge)
      if (args.artifact.rev > existing.rev) {
        await ctx.db.patch(existing._id, {
          ...args.artifact,
          userId, // Ensure userId stays correct
        });
        return { action: "updated", id: existing._id };
      }
      return { action: "skipped", id: existing._id, reason: "rev not higher" };
    }
    
    // Insert new artifact
    const id = await ctx.db.insert("artifacts", {
      runId: args.runId,
      artifactId: args.artifact.id,
      userId,
      kind: args.artifact.kind,
      provider: args.artifact.provider,
      canonicalUrl: args.artifact.canonicalUrl,
      title: args.artifact.title,
      host: args.artifact.host,
      snippet: args.artifact.snippet,
      thumbnail: args.artifact.thumbnail,
      transcript: args.artifact.transcript,
      pageRefs: args.artifact.pageRefs,
      discoveredAt: args.artifact.discoveredAt,
      toolName: args.artifact.toolName,
      rev: args.artifact.rev,
      flags: args.artifact.flags,
    });
    
    return { action: "inserted", id };
  },
});

/**
 * Internal mutation for upsert (from actions)
 */
export const internalUpsertArtifact = internalMutation({
  args: {
    runId: v.string(),
    userId: v.id("users"),
    artifact: artifactCardValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("artifacts")
      .withIndex("by_run_artifact", (q) =>
        q.eq("runId", args.runId).eq("artifactId", args.artifact.id)
      )
      .first() as Doc<"artifacts"> | null;

    if (existing) {
      if (args.artifact.rev > existing.rev) {
        await ctx.db.patch(existing._id, {
          ...args.artifact,
          userId: args.userId,
        });
        return { action: "updated" as const, id: existing._id };
      }
      return { action: "skipped" as const, id: existing._id };
    }
    
    const id = await ctx.db.insert("artifacts", {
      runId: args.runId,
      artifactId: args.artifact.id,
      userId: args.userId,
      kind: args.artifact.kind,
      provider: args.artifact.provider,
      canonicalUrl: args.artifact.canonicalUrl,
      title: args.artifact.title,
      host: args.artifact.host,
      snippet: args.artifact.snippet,
      thumbnail: args.artifact.thumbnail,
      transcript: args.artifact.transcript,
      pageRefs: args.artifact.pageRefs,
      discoveredAt: args.artifact.discoveredAt,
      toolName: args.artifact.toolName,
      rev: args.artifact.rev,
      flags: args.artifact.flags,
    });
    
    return { action: "inserted" as const, id };
  },
});

/**
 * Enrich an existing artifact (with rev check)
 */
export const enrichArtifact = mutation({
  args: {
    runId: v.string(),
    artifactId: v.string(),
    enrich: v.object({
      title: v.optional(v.string()),
      snippet: v.optional(v.string()),
      thumbnail: v.optional(v.string()),
      transcript: v.optional(v.string()),
      pageRefs: v.optional(v.array(v.string())),
      flags: v.optional(artifactFlagsValidator),
    }),
    rev: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    
    const existing = await ctx.db
      .query("artifacts")
      .withIndex("by_run_artifact", (q) =>
        q.eq("runId", args.runId).eq("artifactId", args.artifactId)
      )
      .first() as Doc<"artifacts"> | null;

    if (!existing) {
      return { action: "skipped", reason: "artifact not found" };
    }

    // Security: verify user owns this artifact
    if (existing.userId !== userId) {
      return { action: "skipped", reason: "unauthorized" };
    }

    // Only merge if rev is higher
    if (args.rev <= existing.rev) {
      return { action: "skipped", reason: "rev not higher" };
    }
    
    // Merge enrichment data
    const update: Record<string, any> = { rev: args.rev };
    
    if (args.enrich.title !== undefined) update.title = args.enrich.title;
    if (args.enrich.snippet !== undefined) update.snippet = args.enrich.snippet;
    if (args.enrich.thumbnail !== undefined) {
      update.thumbnail = args.enrich.thumbnail;
      update.flags = { ...existing.flags, hasThumbnail: true };
    }
    if (args.enrich.transcript !== undefined) {
      update.transcript = args.enrich.transcript;
      update.flags = { ...(update.flags || existing.flags), hasTranscript: true };
    }
    if (args.enrich.pageRefs !== undefined) {
      update.pageRefs = args.enrich.pageRefs;
      update.flags = { ...(update.flags || existing.flags), hasPageRefs: true };
    }
    if (args.enrich.flags !== undefined) {
      update.flags = { ...(update.flags || existing.flags), ...args.enrich.flags, isEnriched: true };
    }
    
    await ctx.db.patch(existing._id, update);
    return { action: "enriched", id: existing._id };
  },
});

/**
 * Link artifact to a section
 */
export const linkArtifactToSection = mutation({
  args: {
    runId: v.string(),
    artifactId: v.string(),
    sectionId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    
    // Check if link already exists
    const existing = await ctx.db
      .query("artifactLinks")
      .withIndex("by_run_artifact", (q) =>
        q.eq("runId", args.runId).eq("artifactId", args.artifactId)
      )
      .first() as Doc<"artifactLinks"> | null;

    if (existing && existing.sectionId === args.sectionId) {
      return { action: "skipped", reason: "link exists" };
    }
    
    // If linked to different section, update
    if (existing) {
      await ctx.db.patch(existing._id, { sectionId: args.sectionId });
      return { action: "updated", id: existing._id };
    }
    
    // Create new link
    const id = await ctx.db.insert("artifactLinks", {
      runId: args.runId,
      artifactId: args.artifactId,
      sectionId: args.sectionId,
      createdAt: Date.now(),
    });
    
    return { action: "linked", id };
  },
});

/**
 * Link evidence (fact) to artifacts
 */
export const linkEvidence = mutation({
  args: {
    runId: v.string(),
    factId: v.string(),
    artifactIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    
    // Check if link already exists
    const existing = await ctx.db
      .query("evidenceLinks")
      .withIndex("by_run_fact", (q) =>
        q.eq("runId", args.runId).eq("factId", args.factId)
      )
      .first() as Doc<"evidenceLinks"> | null;

    if (existing) {
      // Merge artifact IDs (dedupe)
      const merged = [...new Set([...existing.artifactIds, ...args.artifactIds])];
      await ctx.db.patch(existing._id, { artifactIds: merged });
      return { action: "merged", id: existing._id };
    }
    
    // Create new link
    const id = await ctx.db.insert("evidenceLinks", {
      runId: args.runId,
      factId: args.factId,
      artifactIds: args.artifactIds,
      createdAt: Date.now(),
    });
    
    // Mark artifacts as cited
    for (const artifactId of args.artifactIds) {
      const artifact = await ctx.db
        .query("artifacts")
        .withIndex("by_run_artifact", (q) =>
          q.eq("runId", args.runId).eq("artifactId", artifactId)
        )
        .first() as Doc<"artifacts"> | null;

      if (artifact) {
        await ctx.db.patch(artifact._id, {
          flags: { ...artifact.flags, isCited: true },
        });
      }
    }
    
    return { action: "linked", id };
  },
});

/**
 * Pin/unpin an artifact
 */
export const pinArtifact = mutation({
  args: {
    runId: v.string(),
    artifactId: v.string(),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    if (!userId) throw new Error("Unauthorized");
    
    const existing = await ctx.db
      .query("artifacts")
      .withIndex("by_run_artifact", (q) =>
        q.eq("runId", args.runId).eq("artifactId", args.artifactId)
      )
      .first() as Doc<"artifacts"> | null;

    if (!existing) {
      return { action: "skipped", reason: "artifact not found" };
    }

    // Security: verify user owns this artifact
    if (existing.userId !== userId) {
      return { action: "skipped", reason: "unauthorized" };
    }

    await ctx.db.patch(existing._id, {
      flags: { ...existing.flags, isPinned: args.pinned },
    });
    
    return { action: args.pinned ? "pinned" : "unpinned", id: existing._id };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL QUERIES - For citation scrubbing (no auth, called from actions)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all allowed canonical URLs for a run (internal, for citation scrubber)
 * Returns array of canonical URLs from artifacts for this run
 */
export const getAllowedUrlsForRun = internalQuery({
  args: {
    runId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("artifacts")
      .withIndex("by_user_run", (q) =>
        q.eq("userId", args.userId).eq("runId", args.runId)
      )
      .collect() as Doc<"artifacts">[];

    // Return canonical URLs
    return rows.map((r: Doc<"artifacts">) => r.canonicalUrl);
  },
});
