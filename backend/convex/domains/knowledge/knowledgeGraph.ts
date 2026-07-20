// convex/domains/knowledge/knowledgeGraph.ts
// Backend functions for Knowledge Graph operations
// Handles graph creation, querying, fingerprinting, and clustering

import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  internalAction
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id, Doc } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a knowledge graph by its source
 */
export const getGraphBySource = query({
  args: {
    sourceType: v.union(
      v.literal("entity"),
      v.literal("theme"),
      v.literal("artifact"),
      v.literal("session")
    ),
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("knowledgeGraphs")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId)
      )
      .first() as Doc<"knowledgeGraphs"> | null;
  },
});

/**
 * Get a knowledge graph by ID
 */
export const getGraphById = query({
  args: {
    graphId: v.id("knowledgeGraphs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.graphId) as Doc<"knowledgeGraphs"> | null;
  },
});

/**
 * Get all claims for a graph
 */
export const getGraphClaims = query({
  args: {
    graphId: v.id("knowledgeGraphs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("graphClaims")
      .withIndex("by_graph", (q) => q.eq("graphId", args.graphId))
      .collect() as Doc<"graphClaims">[];
  },
});

/**
 * Get all edges for a graph
 */
export const getGraphEdges = query({
  args: {
    graphId: v.id("knowledgeGraphs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("graphEdges")
      .withIndex("by_graph", (q) => q.eq("graphId", args.graphId))
      .collect() as Doc<"graphEdges">[];
  },
});

/**
 * List all graphs for a user
 */
export const listUserGraphs = query({
  args: {
    userId: v.optional(v.id("users")),
    sourceType: v.optional(v.union(
      v.literal("entity"),
      v.literal("theme"),
      v.literal("artifact"),
      v.literal("session")
    )),
  },
  handler: async (ctx, args) => {
    if (!args.userId) {
      return [];
    }

    const graphs = await ctx.db
      .query("knowledgeGraphs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect() as Doc<"knowledgeGraphs">[];

    if (args.sourceType) {
      return graphs.filter((g: Doc<"knowledgeGraphs">) => g.sourceType === args.sourceType);
    }

    return graphs;
  },
});

/**
 * Get graphs by cluster ID
 */
export const getGraphsByCluster = query({
  args: {
    clusterId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("knowledgeGraphs")
      .withIndex("by_cluster", (q) => q.eq("clusterId", args.clusterId))
      .collect() as Doc<"knowledgeGraphs">[];
  },
});

/**
 * Get all odd-one-out graphs for a user
 */
export const getOddOneOutGraphs = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const graphs = await ctx.db
      .query("knowledgeGraphs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect() as Doc<"knowledgeGraphs">[];

    return graphs.filter((g: Doc<"knowledgeGraphs">) => g.isOddOneOut === true);
  },
});

/**
 * Get a cluster by ID
 */
export const getClusterById = query({
  args: {
    clusterId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("graphClusters")
      .withIndex("by_clusterId", (q) => q.eq("clusterId", args.clusterId))
      .first() as Doc<"graphClusters"> | null;
  },
});

/**
 * List all clusters for a user
 */
export const listUserClusters = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("graphClusters")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect() as Doc<"graphClusters">[];
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a new knowledge graph with claims and edges
 */
export const createGraph = internalMutation({
  args: {
    name: v.string(),
    sourceType: v.union(
      v.literal("entity"),
      v.literal("theme"),
      v.literal("artifact"),
      v.literal("session")
    ),
    sourceId: v.string(),
    userId: v.id("users"),
    /** Override timestamps for deterministic evaluation/replay. */
    createdAtOverride: v.optional(v.number()),
    claims: v.array(v.object({
      subject: v.string(),
      predicate: v.string(),
      object: v.string(),
      claimText: v.string(),
      isHighConfidence: v.boolean(),
      sourceDocIds: v.array(v.string()),
      sourceSnippets: v.optional(v.array(v.string())),
    })),
    edges: v.array(v.object({
      fromIndex: v.number(),
      toIndex: v.number(),
      edgeType: v.union(
        v.literal("supports"),
        v.literal("contradicts"),
        v.literal("mentions"),
        v.literal("causes"),
        v.literal("relatedTo"),
        v.literal("partOf"),
        v.literal("precedes")
      ),
      isStrong: v.boolean(),
    })),
  },
  handler: async (ctx, args) => {
    const now = args.createdAtOverride ?? Date.now();

    // Check if graph already exists for this source
    const existing = await ctx.db
      .query("knowledgeGraphs")
      .withIndex("by_source", (q) =>
        q.eq("sourceType", args.sourceType).eq("sourceId", args.sourceId)
      )
      .first() as Doc<"knowledgeGraphs"> | null;

    if (existing) {
      // Delete existing claims and edges
      const existingClaims = await ctx.db
        .query("graphClaims")
        .withIndex("by_graph", (q) => q.eq("graphId", existing._id))
        .collect() as Doc<"graphClaims">[];

      for (const claim of existingClaims) {
        await ctx.db.delete(claim._id);
      }

      const existingEdges = await ctx.db
        .query("graphEdges")
        .withIndex("by_graph", (q) => q.eq("graphId", existing._id))
        .collect() as Doc<"graphEdges">[];

      for (const edge of existingEdges) {
        await ctx.db.delete(edge._id);
      }

      // Update existing graph
      await ctx.db.patch(existing._id, {
        name: args.name,
        claimCount: args.claims.length,
        edgeCount: args.edges.length,
        lastBuilt: now,
        updatedAt: now,
        // Clear fingerprints since graph changed
        semanticFingerprint: undefined,
        wlSignature: undefined,
        lastFingerprinted: undefined,
      });

      // Insert new claims
      const claimIds: Id<"graphClaims">[] = [];
      for (const claim of args.claims) {
        const claimId = await ctx.db.insert("graphClaims", {
          graphId: existing._id,
          subject: claim.subject,
          predicate: claim.predicate,
          object: claim.object,
          claimText: claim.claimText,
          isHighConfidence: claim.isHighConfidence,
          sourceDocIds: claim.sourceDocIds,
          sourceSnippets: claim.sourceSnippets,
          extractedAt: now,
          createdAt: now,
        });
        claimIds.push(claimId);
      }

      // Insert new edges
      for (const edge of args.edges) {
        if (edge.fromIndex < claimIds.length && edge.toIndex < claimIds.length) {
          await ctx.db.insert("graphEdges", {
            graphId: existing._id,
            fromClaimId: claimIds[edge.fromIndex],
            toClaimId: claimIds[edge.toIndex],
            edgeType: edge.edgeType,
            isStrong: edge.isStrong,
            createdAt: now,
          });
        }
      }

      return existing._id;
    }

    // Create new graph
    const graphId = await ctx.db.insert("knowledgeGraphs", {
      name: args.name,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      userId: args.userId,
      claimCount: args.claims.length,
      edgeCount: args.edges.length,
      isOddOneOut: false, // Default, will be updated by clustering
      lastBuilt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Insert claims
    const claimIds: Id<"graphClaims">[] = [];
    for (const claim of args.claims) {
      const claimId = await ctx.db.insert("graphClaims", {
        graphId,
        subject: claim.subject,
        predicate: claim.predicate,
        object: claim.object,
        claimText: claim.claimText,
        isHighConfidence: claim.isHighConfidence,
        sourceDocIds: claim.sourceDocIds,
        sourceSnippets: claim.sourceSnippets,
        extractedAt: now,
        createdAt: now,
      });
      claimIds.push(claimId);
    }

    // Insert edges
    for (const edge of args.edges) {
      if (edge.fromIndex < claimIds.length && edge.toIndex < claimIds.length) {
        await ctx.db.insert("graphEdges", {
          graphId,
          fromClaimId: claimIds[edge.fromIndex],
          toClaimId: claimIds[edge.toIndex],
          edgeType: edge.edgeType,
          isStrong: edge.isStrong,
          createdAt: now,
        });
      }
    }

    return graphId;
  },
});

/**
 * Update graph fingerprints
 */
export const updateFingerprints = internalMutation({
  args: {
    graphId: v.id("knowledgeGraphs"),
    semanticFingerprint: v.optional(v.array(v.float64())),
    wlSignature: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.graphId, {
      semanticFingerprint: args.semanticFingerprint,
      wlSignature: args.wlSignature,
      lastFingerprinted: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update claim embedding
 */
export const updateClaimEmbedding = internalMutation({
  args: {
    claimId: v.id("graphClaims"),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.claimId, {
      embedding: args.embedding,
    });
  },
});

/**
 * Update graph clustering results
 */
export const updateClusterAssignment = internalMutation({
  args: {
    graphId: v.id("knowledgeGraphs"),
    clusterId: v.optional(v.string()),
    isOddOneOut: v.boolean(),
    isInClusterSupport: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.graphId, {
      clusterId: args.clusterId,
      isOddOneOut: args.isOddOneOut,
      isInClusterSupport: args.isInClusterSupport,
      lastClustered: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Create or update a cluster
 */
export const upsertCluster = internalMutation({
  args: {
    clusterId: v.string(),
    userId: v.id("users"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    memberGraphIds: v.array(v.id("knowledgeGraphs")),
    centroidVector: v.optional(v.array(v.float64())),
    sharedPredicates: v.optional(v.array(v.string())),
    sharedSubjects: v.optional(v.array(v.string())),
    dominantSourceType: v.optional(v.string()),
    algorithmUsed: v.optional(v.string()),
    minClusterSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("graphClusters")
      .withIndex("by_clusterId", (q) => q.eq("clusterId", args.clusterId))
      .first() as Doc<"graphClusters"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        description: args.description,
        memberGraphIds: args.memberGraphIds,
        memberCount: args.memberGraphIds.length,
        centroidVector: args.centroidVector,
        sharedPredicates: args.sharedPredicates,
        sharedSubjects: args.sharedSubjects,
        dominantSourceType: args.dominantSourceType,
        algorithmUsed: args.algorithmUsed,
        minClusterSize: args.minClusterSize,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("graphClusters", {
      clusterId: args.clusterId,
      userId: args.userId,
      name: args.name,
      description: args.description,
      memberGraphIds: args.memberGraphIds,
      memberCount: args.memberGraphIds.length,
      centroidVector: args.centroidVector,
      sharedPredicates: args.sharedPredicates,
      sharedSubjects: args.sharedSubjects,
      dominantSourceType: args.dominantSourceType,
      algorithmUsed: args.algorithmUsed,
      minClusterSize: args.minClusterSize,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Delete a graph and its claims/edges
 */
export const deleteGraph = mutation({
  args: {
    graphId: v.id("knowledgeGraphs"),
  },
  handler: async (ctx, args) => {
    // Delete all claims
    const claims = await ctx.db
      .query("graphClaims")
      .withIndex("by_graph", (q) => q.eq("graphId", args.graphId))
      .collect() as Doc<"graphClaims">[];

    for (const claim of claims) {
      await ctx.db.delete(claim._id);
    }

    // Delete all edges
    const edges = await ctx.db
      .query("graphEdges")
      .withIndex("by_graph", (q) => q.eq("graphId", args.graphId))
      .collect() as Doc<"graphEdges">[];

    for (const edge of edges) {
      await ctx.db.delete(edge._id);
    }

    // Delete the graph
    await ctx.db.delete(args.graphId);
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL ACTIONS (for embeddings and fingerprinting)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Embed claims using OpenAI or Gemini
 */
export const embedClaims = internalAction({
  args: {
    claimIds: v.array(v.id("graphClaims")),
  },
  handler: async (ctx, args): Promise<{ embeddedCount: number; error?: string }> => {
    // Load claims with explicit typing
    type ClaimDoc = { _id: Id<"graphClaims">; claimText: string } | null;
    const claimPromises: Promise<ClaimDoc>[] = args.claimIds.map(
      (id: any) => ctx.runQuery(internal.domains.knowledge.knowledgeGraph.getClaimById, { claimId: id }) as Promise<ClaimDoc>
    );
    const claims = await Promise.all(claimPromises);

    // Filter out nulls with proper typing
    const validClaims = claims.filter((c): c is NonNullable<ClaimDoc> => c !== null);
    
    if (validClaims.length === 0) {
      return { embeddedCount: 0 };
    }

    // Use OpenAI embeddings (or Gemini as fallback)
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Batch embed (OpenAI supports up to 2048 inputs per request)
    const texts = validClaims.map((c) => c.claimText);
    
    try {
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: texts,
      });

      // Update each claim with its embedding
      for (let i = 0; i < validClaims.length; i++) {
        const claim = validClaims[i];
        const embedding = response.data[i].embedding;
        
        await ctx.runMutation(internal.domains.knowledge.knowledgeGraph.updateClaimEmbedding, {
          claimId: claim._id,
          embedding,
        });
      }

      return { embeddedCount: validClaims.length };
    } catch (error) {
      console.error("[embedClaims] Error embedding claims:", error);
      return { embeddedCount: 0, error: String(error) };
    }
  },
});

/**
 * Compute semantic fingerprint (mean pooling of claim embeddings)
 */
export const computeSemanticFingerprint = internalAction({
  args: {
    graphId: v.id("knowledgeGraphs"),
  },
  handler: async (ctx, args): Promise<number[] | null> => {
    type ClaimWithEmbedding = { embedding?: number[] | null; predicate: string; _id: string };
    const claims: ClaimWithEmbedding[] = await ctx.runQuery(internal.domains.knowledge.knowledgeGraph.getGraphClaimsInternal, {
      graphId: args.graphId,
    });

    const claimsWithEmbeddings = claims.filter((c): c is ClaimWithEmbedding & { embedding: number[] } => 
      c.embedding !== undefined && c.embedding !== null && c.embedding.length > 0
    );
    
    if (claimsWithEmbeddings.length === 0) {
      return null;
    }

    // Mean pooling
    const dim = claimsWithEmbeddings[0].embedding.length;
    const meanVector = new Array(dim).fill(0);

    for (const claim of claimsWithEmbeddings) {
      for (let i = 0; i < dim; i++) {
        meanVector[i] += claim.embedding[i];
      }
    }

    for (let i = 0; i < dim; i++) {
      meanVector[i] /= claimsWithEmbeddings.length;
    }

    // Normalize
    const norm = Math.sqrt(meanVector.reduce((sum, x) => sum + x * x, 0));
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        meanVector[i] /= norm;
      }
    }

    return meanVector;
  },
});

/**
 * Compute Weisfeiler-Lehman signature for structural fingerprinting
 */
export const computeWLSignature = internalAction({
  args: {
    graphId: v.id("knowledgeGraphs"),
  },
  handler: async (ctx, args): Promise<string> => {
    type ClaimDoc = { _id: string; predicate: string };
    type EdgeDoc = { fromClaimId: string; toClaimId: string; edgeType: string };
    
    const claims: ClaimDoc[] = await ctx.runQuery(internal.domains.knowledge.knowledgeGraph.getGraphClaimsInternal, {
      graphId: args.graphId,
    });

    const edges: EdgeDoc[] = await ctx.runQuery(internal.domains.knowledge.knowledgeGraph.getGraphEdgesInternal, {
      graphId: args.graphId,
    });

    // Build adjacency structure
    const claimIdToIndex = new Map<string, number>();
    claims.forEach((c: ClaimDoc, i: number) => claimIdToIndex.set(c._id, i));

    // Initialize node labels with predicates (structural role)
    let labels = claims.map((c: ClaimDoc) => c.predicate);

    // WL iterations (typically 2-3 is enough)
    const iterations = 3;
    
    for (let iter = 0; iter < iterations; iter++) {
      const newLabels: string[] = [];
      
      for (let i = 0; i < claims.length; i++) {
        // Collect neighbor labels
        const neighborLabels: string[] = [];
        
        for (const edge of edges) {
          const fromIdx = claimIdToIndex.get(edge.fromClaimId);
          const toIdx = claimIdToIndex.get(edge.toClaimId);
          
          if (fromIdx === i && toIdx !== undefined) {
            neighborLabels.push(`${edge.edgeType}:${labels[toIdx]}`);
          }
          if (toIdx === i && fromIdx !== undefined) {
            neighborLabels.push(`${edge.edgeType}:${labels[fromIdx]}`);
          }
        }

        // Sort and concatenate for deterministic hash
        neighborLabels.sort();
        const newLabel = `${labels[i]}|${neighborLabels.join(",")}`;
        newLabels.push(newLabel);
      }

      labels = newLabels;
    }

    // Create final signature by sorting and hashing all labels
    labels.sort();
    const signature = labels.join("||");
    
    // Simple hash for compact representation
    let hash = 0;
    for (let i = 0; i < signature.length; i++) {
      const char = signature.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return `WL_${hash.toString(16)}_${claims.length}c_${edges.length}e`;
  },
});

// Internal queries for actions
export const getClaimById = internalQuery({
  args: { claimId: v.id("graphClaims") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.claimId) as Doc<"graphClaims"> | null;
  },
});

export const getGraphClaimsInternal = internalQuery({
  args: { graphId: v.id("knowledgeGraphs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("graphClaims")
      .withIndex("by_graph", (q) => q.eq("graphId", args.graphId))
      .collect() as Doc<"graphClaims">[];
  },
});

export const getGraphEdgesInternal = internalQuery({
  args: { graphId: v.id("knowledgeGraphs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("graphEdges")
      .withIndex("by_graph", (q) => q.eq("graphId", args.graphId))
      .collect() as Doc<"graphEdges">[];
  },
});
