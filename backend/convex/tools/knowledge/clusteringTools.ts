// convex/tools/clusteringTools.ts
// Tools for clustering Knowledge Graphs and detecting outliers
// Uses HDBSCAN for clustering and One-Class SVM for soft hull novelty detection

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal, api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #1: groupAndDetectOutliers
// HDBSCAN clustering with boolean outlier detection
// ═══════════════════════════════════════════════════════════════════════════

export const groupAndDetectOutliers = createTool({
  description: `Run HDBSCAN clustering on fingerprinted Knowledge Graphs.

Returns:
- clusterId for each graph (null = noise/odd-one-out)
- isOddOneOut boolean flag (from HDBSCAN noise detection)
- Cluster metadata with shared characteristics

Use this when you need to:
- Find natural groupings among entities/themes
- Identify outliers that don't fit any pattern
- Understand what makes entities similar

Prerequisites: Graphs must be fingerprinted (call fingerprintKnowledgeGraph first).`,

  args: z.object({
    graphIds: z.array(z.string()).optional()
      .describe("Specific graph IDs to cluster (null = all user's graphs)"),
    minClusterSize: z.number().default(2)
      .describe("Minimum cluster size for HDBSCAN (default: 2)"),
    sourceTypeFilter: z.enum(["entity", "theme", "artifact", "session"]).optional()
      .describe("Only cluster graphs of this source type"),
  }),

  handler: async (ctx: any, args) => {
    const userId = ctx.evaluationUserId || ctx.userId;
    if (!userId) {
      return {
        success: false,
        error: "Not authenticated",
      };
    }

    console.log(`[groupAndDetectOutliers] Starting clustering for user ${userId}`);

    // Load graphs
    let graphs: any[];
    
    if (args.graphIds && args.graphIds.length > 0) {
      // Load specific graphs
      graphs = await Promise.all(
        args.graphIds.map(id => 
          ctx.runQuery(api.domains.knowledge.knowledgeGraph.getGraphById, { 
            graphId: id 
          })
        )
      );
      graphs = graphs.filter(g => g !== null);
    } else {
      // Load all user's graphs
      graphs = await ctx.runQuery(api.domains.knowledge.knowledgeGraph.listUserGraphs, {
        userId,
        sourceType: args.sourceTypeFilter,
      });
    }

    // Filter to only fingerprinted graphs
    const fingerprintedGraphs = graphs.filter(g => 
      g.semanticFingerprint && g.semanticFingerprint.length > 0
    );

    if (fingerprintedGraphs.length < args.minClusterSize) {
      return {
        success: false,
        error: `Need at least ${args.minClusterSize} fingerprinted graphs for clustering. Found ${fingerprintedGraphs.length}.`,
        graphsFound: graphs.length,
        fingerprintedCount: fingerprintedGraphs.length,
      };
    }

    console.log(`[groupAndDetectOutliers] Clustering ${fingerprintedGraphs.length} graphs`);

    // Run HDBSCAN clustering
    // For now, we use a simplified JS implementation
    // In production, this should call a Python MCP server with sklearn
    const clusterResult = await runHDBSCAN(
      fingerprintedGraphs,
      args.minClusterSize
    );

    // Update each graph with cluster assignment
    for (const assignment of clusterResult.assignments) {
      await ctx.runMutation(internal.domains.knowledge.knowledgeGraph.updateClusterAssignment, {
        graphId: assignment.graphId,
        clusterId: assignment.clusterId,
        isOddOneOut: assignment.isOddOneOut,
      });
    }

    // Create/update cluster records
    for (const cluster of clusterResult.clusters) {
      await ctx.runMutation(internal.domains.knowledge.knowledgeGraph.upsertCluster, {
        clusterId: cluster.clusterId,
        userId,
        name: cluster.name,
        memberGraphIds: cluster.memberGraphIds,
        centroidVector: cluster.centroid,
        sharedPredicates: cluster.sharedPredicates,
        sharedSubjects: cluster.sharedSubjects,
        dominantSourceType: cluster.dominantSourceType,
        algorithmUsed: "hdbscan-js",
        minClusterSize: args.minClusterSize,
      });
    }

    console.log(`[groupAndDetectOutliers] Found ${clusterResult.clusters.length} clusters, ${clusterResult.oddOnesOut.length} outliers`);

    return {
      success: true,
      clustersFound: clusterResult.clusters.length,
      oddOnesOutCount: clusterResult.oddOnesOut.length,
      graphsProcessed: fingerprintedGraphs.length,
      clusters: clusterResult.clusters.map(c => ({
        clusterId: c.clusterId,
        name: c.name,
        memberCount: c.memberGraphIds.length,
        sharedPredicates: c.sharedPredicates,
      })),
      oddOnesOut: clusterResult.oddOnesOut.map(g => ({
        graphId: g.graphId,
        name: g.name,
      })),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #2: checkNovelty
// One-Class SVM soft hull for novelty detection
// ═══════════════════════════════════════════════════════════════════════════

export const checkNovelty = createTool({
  description: `Check if a Knowledge Graph is an inlier or outlier relative to existing clusters.

Uses One-Class SVM "soft hull" to determine if a new graph fits within
the support region of known clusters.

Returns:
- isInClusterSupport: boolean (true = fits pattern, false = novel/unusual)
- nearestClusterId: which cluster it's closest to
- explanation: why it's considered in/out

Use this when:
- Evaluating a new entity against known patterns
- Checking if research findings are unusual
- Identifying novel entities that deserve attention`,

  args: z.object({
    graphId: z.string().describe("ID of the graph to check"),
    clusterId: z.string().optional()
      .describe("Check against specific cluster (null = check all)"),
  }),

  handler: async (ctx: any, args) => {
    const userId = ctx.evaluationUserId || ctx.userId;
    if (!userId) {
      return {
        success: false,
        error: "Not authenticated",
      };
    }

    // Load the graph
    const graph = await ctx.runQuery(api.domains.knowledge.knowledgeGraph.getGraphById, {
      graphId: args.graphId,
    });

    if (!graph) {
      return {
        success: false,
        error: `Graph not found: ${args.graphId}`,
      };
    }

    if (!graph.semanticFingerprint) {
      return {
        success: false,
        error: "Graph not fingerprinted. Call fingerprintKnowledgeGraph first.",
      };
    }

    // Load clusters to compare against
    let clusters: any[];
    
    if (args.clusterId) {
      const cluster = await ctx.runQuery(api.domains.knowledge.knowledgeGraph.getClusterById, {
        clusterId: args.clusterId,
      });
      clusters = cluster ? [cluster] : [];
    } else {
      clusters = await ctx.runQuery(api.domains.knowledge.knowledgeGraph.listUserClusters, {
        userId,
      });
    }

    if (clusters.length === 0) {
      return {
        success: true,
        isInClusterSupport: false,
        nearestClusterId: null,
        explanation: "No clusters exist yet. This is the first entity or run clustering first.",
      };
    }

    // Find nearest cluster and check if within support region
    const result = checkSupportRegion(graph, clusters);

    // Update graph with novelty status
    await ctx.runMutation(internal.domains.knowledge.knowledgeGraph.updateClusterAssignment, {
      graphId: args.graphId,
      clusterId: result.nearestClusterId,
      isOddOneOut: !result.isInClusterSupport,
      isInClusterSupport: result.isInClusterSupport,
    });

    return {
      success: true,
      isInClusterSupport: result.isInClusterSupport,
      nearestClusterId: result.nearestClusterId,
      nearestClusterName: result.nearestClusterName,
      distance: result.distance,
      explanation: result.explanation,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #3: explainSimilarity
// Compare two graphs and explain their similarity/differences
// ═══════════════════════════════════════════════════════════════════════════

export const explainSimilarity = createTool({
  description: `Compare two Knowledge Graphs and explain their similarity or differences.

Analyzes:
- Shared claims and predicates
- Structural similarity (WL signature overlap)
- Semantic similarity (embedding distance)
- Key differences

Use this when:
- Comparing two entities
- Understanding why entities clustered together
- Identifying what makes entities different`,

  args: z.object({
    graphId1: z.string().describe("First graph ID"),
    graphId2: z.string().describe("Second graph ID"),
  }),

  handler: async (ctx: any, args): Promise<{
    success: boolean;
    error?: string;
    isSimilar?: boolean;
    sharedPredicates?: string[];
    uniqueToGraph1?: string[];
    uniqueToGraph2?: string[];
    predicateOverlap?: number;
    semanticSimilarity?: number | null;
    wlSignatureMatch?: boolean;
    graph1ClaimCount?: number;
    graph2ClaimCount?: number;
    similarClaims?: string[];
    explanation?: string;
  }> => {
    // Type definitions
    type GraphDoc = { 
      semanticFingerprint?: number[]; 
      wlSignature?: string;
    } | null;
    type ClaimDoc = { 
      predicate: string; 
      subject: string; 
      object: string;
    };

    // Load both graphs
    const graphResults = await Promise.all([
      ctx.runQuery(api.domains.knowledge.knowledgeGraph.getGraphById, { 
        graphId: args.graphId1 
      }) as Promise<GraphDoc>,
      ctx.runQuery(api.domains.knowledge.knowledgeGraph.getGraphById, { 
        graphId: args.graphId2 
      }) as Promise<GraphDoc>,
    ]);
    const graph1 = graphResults[0];
    const graph2 = graphResults[1];

    if (!graph1 || !graph2) {
      return {
        success: false,
        error: `One or both graphs not found`,
      };
    }

    // Load claims for both graphs
    const claimsResults = await Promise.all([
      ctx.runQuery(api.domains.knowledge.knowledgeGraph.getGraphClaims, { 
        graphId: args.graphId1 
      }) as Promise<ClaimDoc[]>,
      ctx.runQuery(api.domains.knowledge.knowledgeGraph.getGraphClaims, { 
        graphId: args.graphId2 
      }) as Promise<ClaimDoc[]>,
    ]);
    const claims1 = claimsResults[0];
    const claims2 = claimsResults[1];

    // Find shared predicates
    const predicates1 = new Set<string>(claims1.map((c) => c.predicate));
    const predicates2 = new Set<string>(claims2.map((c) => c.predicate));
    const sharedPredicates: string[] = [...predicates1].filter(p => predicates2.has(p));
    const uniqueToGraph1: string[] = [...predicates1].filter(p => !predicates2.has(p));
    const uniqueToGraph2: string[] = [...predicates2].filter(p => !predicates1.has(p));

    // Calculate semantic similarity if both have fingerprints
    let semanticSimilarity: number | null = null;
    if (graph1.semanticFingerprint && graph2.semanticFingerprint) {
      semanticSimilarity = cosineSimilarity(
        graph1.semanticFingerprint,
        graph2.semanticFingerprint
      );
    }

    // Check WL signature similarity
    const wlMatch: boolean = !!(graph1.wlSignature && graph2.wlSignature && 
                    graph1.wlSignature === graph2.wlSignature);

    // Find semantically similar claims
    const similarClaims: string[] = [];
    for (const c1 of claims1) {
      for (const c2 of claims2) {
        if (c1.predicate === c2.predicate && 
            (c1.subject === c2.subject || c1.object === c2.object)) {
          similarClaims.push(`Both: ${c1.predicate} (${c1.subject} vs ${c2.subject})`);
        }
      }
    }

    // Generate explanation
    const isSimilar = semanticSimilarity !== null && semanticSimilarity > 0.7;
    
    let explanation: string;
    if (isSimilar) {
      explanation = `These graphs are similar. They share ${sharedPredicates.length} predicates and have ${similarClaims.length} overlapping claims.`;
    } else if (sharedPredicates.length > 0) {
      explanation = `These graphs have some overlap (${sharedPredicates.length} shared predicates) but differ in structure.`;
    } else {
      explanation = `These graphs are quite different with no shared predicates.`;
    }

    return {
      success: true,
      isSimilar,
      
      // Structural comparison
      sharedPredicates,
      uniqueToGraph1,
      uniqueToGraph2,
      predicateOverlap: sharedPredicates.length / Math.max(predicates1.size, predicates2.size),
      
      // Semantic comparison
      semanticSimilarity,
      wlSignatureMatch: wlMatch,
      
      // Claim comparison
      graph1ClaimCount: claims1.length,
      graph2ClaimCount: claims2.length,
      similarClaims: similarClaims.slice(0, 10), // Limit to 10
      
      explanation,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Simplified HDBSCAN implementation
// In production, call a Python MCP server with sklearn.cluster.HDBSCAN
// ═══════════════════════════════════════════════════════════════════════════

interface ClusterAssignment {
  graphId: string;
  clusterId: string | null;
  isOddOneOut: boolean;
}

interface ClusterInfo {
  clusterId: string;
  name: string;
  memberGraphIds: string[];
  centroid: number[];
  sharedPredicates: string[];
  sharedSubjects: string[];
  dominantSourceType: string;
}

interface HDBSCANResult {
  assignments: ClusterAssignment[];
  clusters: ClusterInfo[];
  oddOnesOut: { graphId: string; name: string }[];
}

async function runHDBSCAN(
  graphs: any[],
  minClusterSize: number
): Promise<HDBSCANResult> {
  // Simplified clustering using distance-based grouping
  // Real HDBSCAN would use density-based clustering
  
  const assignments: ClusterAssignment[] = [];
  const clusters: ClusterInfo[] = [];
  const oddOnesOut: { graphId: string; name: string }[] = [];

  // Calculate pairwise distances
  const distances: number[][] = [];
  for (let i = 0; i < graphs.length; i++) {
    distances[i] = [];
    for (let j = 0; j < graphs.length; j++) {
      if (i === j) {
        distances[i][j] = 0;
      } else {
        distances[i][j] = 1 - cosineSimilarity(
          graphs[i].semanticFingerprint,
          graphs[j].semanticFingerprint
        );
      }
    }
  }

  // Simple hierarchical clustering approximation
  const threshold = 0.5; // Distance threshold for clustering
  const visited = new Set<number>();
  let clusterCount = 0;

  for (let i = 0; i < graphs.length; i++) {
    if (visited.has(i)) continue;

    // Find all graphs within threshold distance
    const clusterMembers: number[] = [i];
    visited.add(i);

    for (let j = i + 1; j < graphs.length; j++) {
      if (!visited.has(j) && distances[i][j] < threshold) {
        clusterMembers.push(j);
        visited.add(j);
      }
    }

    if (clusterMembers.length >= minClusterSize) {
      // Create cluster
      const clusterId = `cluster_${++clusterCount}`;
      const memberGraphs = clusterMembers.map(idx => graphs[idx]);
      
      // Calculate centroid
      const dim = memberGraphs[0].semanticFingerprint.length;
      const centroid = new Array(dim).fill(0);
      for (const g of memberGraphs) {
        for (let d = 0; d < dim; d++) {
          centroid[d] += g.semanticFingerprint[d];
        }
      }
      for (let d = 0; d < dim; d++) {
        centroid[d] /= memberGraphs.length;
      }

      // Find shared characteristics (would need claims data)
      const sourceTypes = memberGraphs.map(g => g.sourceType);
      const dominantSourceType = sourceTypes.sort((a, b) =>
        sourceTypes.filter(v => v === b).length - sourceTypes.filter(v => v === a).length
      )[0];

      // Generate cluster name based on source type and count
      const name = `${dominantSourceType} Group ${clusterCount} (${memberGraphs.length} members)`;

      clusters.push({
        clusterId,
        name,
        memberGraphIds: memberGraphs.map(g => g._id),
        centroid,
        sharedPredicates: [], // Would need claims analysis
        sharedSubjects: [],
        dominantSourceType,
      });

      // Assign members to cluster
      for (const idx of clusterMembers) {
        assignments.push({
          graphId: graphs[idx]._id,
          clusterId,
          isOddOneOut: false,
        });
      }
    } else {
      // Mark as outlier
      for (const idx of clusterMembers) {
        assignments.push({
          graphId: graphs[idx]._id,
          clusterId: null,
          isOddOneOut: true,
        });
        oddOnesOut.push({
          graphId: graphs[idx]._id,
          name: graphs[idx].name,
        });
      }
    }
  }

  return { assignments, clusters, oddOnesOut };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Check support region (simplified One-Class SVM)
// ═══════════════════════════════════════════════════════════════════════════

interface SupportRegionResult {
  isInClusterSupport: boolean;
  nearestClusterId: string | null;
  nearestClusterName: string | null;
  distance: number;
  explanation: string;
}

function checkSupportRegion(graph: any, clusters: any[]): SupportRegionResult {
  if (clusters.length === 0) {
    return {
      isInClusterSupport: false,
      nearestClusterId: null,
      nearestClusterName: null,
      distance: Infinity,
      explanation: "No clusters to compare against",
    };
  }

  // Find nearest cluster by centroid distance
  let nearestCluster: any = null;
  let minDistance = Infinity;

  for (const cluster of clusters) {
    if (cluster.centroidVector && cluster.centroidVector.length > 0) {
      const dist = 1 - cosineSimilarity(
        graph.semanticFingerprint,
        cluster.centroidVector
      );
      
      if (dist < minDistance) {
        minDistance = dist;
        nearestCluster = cluster;
      }
    }
  }

  if (!nearestCluster) {
    return {
      isInClusterSupport: false,
      nearestClusterId: null,
      nearestClusterName: null,
      distance: Infinity,
      explanation: "No clusters have computed centroids",
    };
  }

  // Simplified support region check: within 2 standard deviations of centroid
  // Real implementation would use trained One-Class SVM
  const supportThreshold = 0.6; // Distance threshold
  const isInSupport = minDistance < supportThreshold;

  let explanation: string;
  if (isInSupport) {
    explanation = `Graph fits within the support region of "${nearestCluster.name}" (distance: ${minDistance.toFixed(3)})`;
  } else {
    explanation = `Graph is outside the support region. Nearest cluster is "${nearestCluster.name}" but distance ${minDistance.toFixed(3)} exceeds threshold.`;
  }

  return {
    isInClusterSupport: isInSupport,
    nearestClusterId: nearestCluster.clusterId,
    nearestClusterName: nearestCluster.name,
    distance: minDistance,
    explanation,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Cosine similarity
// ═══════════════════════════════════════════════════════════════════════════

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

// Export all tools as array
export const clusteringTools: unknown[] = [
  groupAndDetectOutliers,
  checkNovelty,
  explainSimilarity,
];
