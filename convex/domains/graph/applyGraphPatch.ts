/**
 * Validates and applies a graph patch proposed by the expansion agent.
 *
 * The agent NEVER writes directly to the graph — it proposes a structured
 * patch, and this mutation validates bounds, deduplicates, and applies.
 *
 * Pattern: scratchpad-first (agent proposes, mutation validates)
 * Prior art:
 *   - Roam Research: structured backlink persistence after outline parsing
 *   - Anthropic: Building Effective Agents (2024), tool output validation
 *
 * Invariants:
 *   BOUND      — max 50 claims, 100 edges, 50 backlinks per patch
 *   HONEST_STATUS — returns actual counts, not claimed counts
 *   DETERMINISTIC — dedup by (subject, predicate, object) triple
 *   SSRF       — sourceUrls validated before storing
 *
 * See: docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md §3.2
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

// ── Constants ────────────────────────────────────────────────────────────

const MAX_CLAIMS = 50;
const MAX_EDGES = 100;
const MAX_BACKLINKS = 50;

// ── SSRF validation ──────────────────────────────────────────────────────

const SSRF_BLOCKED = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
  /^metadata\.google\.internal$/i,
];

function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    return !SSRF_BLOCKED.some((p) => p.test(parsed.hostname));
  } catch {
    return false;
  }
}

// ── DETERMINISTIC: stable triple hash for dedup ──────────────────────────

function tripleKey(subject: string, predicate: string, object: string): string {
  return `${subject.toLowerCase().trim()}::${predicate.toLowerCase().trim()}::${object.toLowerCase().trim()}`;
}

// ── Main patch mutation ──────────────────────────────────────────────────

export const applyPatch = internalMutation({
  args: {
    targetEntityId: v.id("entityProfiles"),
    agentRunId: v.string(),
    userId: v.optional(v.string()),

    claims: v.array(
      v.object({
        subject: v.string(),
        predicate: v.string(),
        object: v.string(),
        claimText: v.string(),
        sourceUrls: v.array(v.string()),
        isHighConfidence: v.boolean(),
      }),
    ),

    backlinks: v.array(
      v.object({
        targetEntityName: v.string(),
        backlinkType: v.union(
          v.literal("relatedTo"),
          v.literal("causes"),
          v.literal("supports"),
          v.literal("derived"),
        ),
        confidence: v.number(),
        sourceContext: v.optional(v.string()),
      }),
    ),
  },

  handler: async (ctx, args) => {
    let claimsCreated = 0;
    let edgesCreated = 0;
    let backlinksCreated = 0;

    // ── 1. Find or create knowledge graph for this entity ───────────

    // Find or create a knowledge graph scoped to this entity expansion.
    // knowledgeGraphs requires: name, sourceType, sourceId, userId, isOddOneOut,
    // claimCount, edgeCount, lastBuilt, createdAt, updatedAt.
    let graphDoc = await ctx.db
      .query("knowledgeGraphs")
      .filter((q) =>
        q.and(
          q.eq(q.field("sourceType"), "entity"),
          q.eq(q.field("sourceId"), args.targetEntityId),
        ),
      )
      .first();

    const now = Date.now();

    if (!graphDoc) {
      const graphId = await ctx.db.insert("knowledgeGraphs", {
        name: `Expansion: ${args.targetEntityId}`,
        sourceType: "entity",
        sourceId: args.targetEntityId,
        // userId is required by knowledgeGraphs schema (v.id("users")).
        // Cast from string — the expansion action passes a Clerk user ID.
        userId: (args.userId ?? "system") as any,
        isOddOneOut: false,
        claimCount: 0,
        edgeCount: 0,
        lastBuilt: now,
        createdAt: now,
        updatedAt: now,
      });
      graphDoc = await ctx.db.get(graphId);
    }

    if (!graphDoc) {
      return { claimsCreated: 0, edgesCreated: 0, backlinksCreated: 0 };
    }

    const graphId = graphDoc._id;

    // ── 2. Deduplicate + insert claims (BOUND: max 50) ─────────────

    // Load existing claims for dedup
    const existingClaims = await ctx.db
      .query("graphClaims")
      .filter((q) => q.eq(q.field("graphId"), graphId))
      .take(500); // BOUND_READ

    const existingTriples = new Set(
      existingClaims.map((c) => tripleKey(c.subject, c.predicate, c.object)),
    );

    const newClaimIds: Array<{ id: any; subject: string }> = [];

    for (const claim of args.claims.slice(0, MAX_CLAIMS)) {
      const key = tripleKey(claim.subject, claim.predicate, claim.object);
      if (existingTriples.has(key)) continue; // DETERMINISTIC: skip dupes

      // SSRF: validate source URLs
      const safeUrls = claim.sourceUrls.filter(isUrlSafe);

      const claimNow = Date.now();
      const claimId = await ctx.db.insert("graphClaims", {
        graphId,
        subject: claim.subject.slice(0, 200),
        predicate: claim.predicate.slice(0, 100),
        object: claim.object.slice(0, 500),
        claimText: claim.claimText.slice(0, 500),
        sourceDocIds: [], // expansion-sourced claims link via sourceUrls, not docs
        sourceSnippets: safeUrls.slice(0, 5), // Store source URLs as snippets for traceability
        extractedAt: claimNow,
        isHighConfidence: claim.isHighConfidence,
        createdAt: claimNow,
      });

      newClaimIds.push({ id: claimId, subject: claim.subject });
      existingTriples.add(key);
      claimsCreated++;
    }

    // ── 3. Create edges between claims (BOUND: max 100) ────────────

    // For now, create "relatedTo" edges between claims about the same entity
    const claimsBySubject = new Map<string, any[]>();
    for (const nc of newClaimIds) {
      const key = nc.subject.toLowerCase();
      if (!claimsBySubject.has(key)) claimsBySubject.set(key, []);
      claimsBySubject.get(key)!.push(nc.id);
    }

    let edgeCount = 0;
    for (const [, ids] of claimsBySubject) {
      if (ids.length < 2) continue;
      // Create chain edges between sequential claims
      for (let i = 0; i < ids.length - 1 && edgeCount < MAX_EDGES; i++) {
        await ctx.db.insert("graphEdges", {
          graphId,
          fromClaimId: ids[i],
          toClaimId: ids[i + 1],
          edgeType: "relatedTo",
          isStrong: false,
          createdAt: Date.now(),
        });
        edgeCount++;
        edgesCreated++;
      }
    }

    // ── 4. Create backlinks (BOUND: max 50) ─────────────────────────

    for (const bl of args.backlinks.slice(0, MAX_BACKLINKS)) {
      // Try to resolve the target entity by name
      const targetEntity = await ctx.db
        .query("entityProfiles")
        .filter((q) =>
          q.eq(
            q.field("canonicalName"),
            bl.targetEntityName,
          ),
        )
        .first();

      if (!targetEntity) continue; // Skip unresolvable entities

      // Dedup: check if this exact backlink exists
      const existingBacklink = await ctx.db
        .query("backlinks")
        .withIndex("by_source", (q) =>
          q.eq("sourceType", "claim").eq("sourceId", args.targetEntityId),
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("targetEntityId"), targetEntity._id),
            q.eq(q.field("backlinkType"), bl.backlinkType),
          ),
        )
        .first();

      if (existingBacklink) continue;

      await ctx.db.insert("backlinks", {
        sourceType: "claim",
        sourceId: args.targetEntityId,
        targetEntityId: targetEntity._id,
        backlinkType: bl.backlinkType,
        confidence: Math.max(0, Math.min(1, bl.confidence)), // Clamp 0-1
        sourceContext: bl.sourceContext?.slice(0, 200),
        createdBy: "agent",
        agentRunId: args.agentRunId,
        createdAt: Date.now(),
      });

      backlinksCreated++;
    }

    // Update graph counters (honest counts)
    if (claimsCreated > 0 || edgesCreated > 0) {
      await ctx.db.patch(graphId, {
        claimCount: graphDoc.claimCount + claimsCreated,
        edgeCount: graphDoc.edgeCount + edgesCreated,
        lastBuilt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    // HONEST_STATUS: return actual persisted counts
    return { claimsCreated, edgesCreated, backlinksCreated };
  },
});
