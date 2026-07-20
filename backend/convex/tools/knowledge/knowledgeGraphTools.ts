// convex/tools/knowledgeGraphTools.ts
// Tools for building and fingerprinting Knowledge Graphs from entity/theme research
// KG-first approach: Claims (SPO triples) + Relations + Provenance

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal, api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtractedClaim {
  subject: string;
  predicate: string;
  object: string;
  claimText: string;
  isHighConfidence: boolean;
  sourceDocIds: string[];
  sourceSnippets?: string[];
}

export interface ExtractedEdge {
  fromIndex: number;  // Index into claims array
  toIndex: number;
  edgeType: "supports" | "contradicts" | "mentions" | "causes" | "relatedTo" | "partOf" | "precedes";
  isStrong: boolean;
}

export interface ClaimExtractionResult {
  claims: ExtractedClaim[];
  edges: ExtractedEdge[];
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #1: buildKnowledgeGraph
// Extracts claims and relations from an entity/theme/artifact
// ═══════════════════════════════════════════════════════════════════════════

export const buildKnowledgeGraph = createTool({
  description: `Build a Knowledge Graph from an entity, theme, or artifact.

Extracts:
- Claims: Subject-Predicate-Object triples with provenance
- Edges: Relations between claims (supports, contradicts, etc.)

Use this when you need to:
- Structure research findings into a queryable graph
- Compare entities by their claim structure
- Find contradictions or gaps in research
- Prepare data for clustering/similarity analysis

Returns graphId and counts. Does NOT compute fingerprints (call fingerprintKnowledgeGraph after).`,

  args: z.object({
    sourceType: z.enum(["entity", "theme", "artifact", "session"])
      .describe("Type of source to build graph from"),
    sourceId: z.string()
      .describe("Canonical key (e.g., 'company:TSLA') or document ID"),
    name: z.string().optional()
      .describe("Optional name for the graph (auto-generated if not provided)"),
    forceRebuild: z.boolean().default(false)
      .describe("If true, rebuild even if graph already exists"),
  }),

  handler: async (ctx: any, args): Promise<{
    success: boolean;
    error?: string;
    graphId: string | null;
    claimCount?: number;
    edgeCount?: number;
    isExisting?: boolean;
    message?: string;
  }> => {
    const userId = ctx.evaluationUserId || ctx.userId;
    if (!userId) {
      return {
        success: false,
        error: "Not authenticated",
        graphId: null,
      };
    }

    console.log(`[buildKnowledgeGraph] Building graph for ${args.sourceType}:${args.sourceId}`);

    // Check if graph already exists
    const existingGraph = await ctx.runQuery(api.domains.knowledge.knowledgeGraph.getGraphBySource, {
      sourceType: args.sourceType,
      sourceId: args.sourceId,
    });

    if (existingGraph && !args.forceRebuild) {
      console.log(`[buildKnowledgeGraph] Graph already exists: ${existingGraph._id}`);
      return {
        success: true,
        graphId: existingGraph._id,
        claimCount: existingGraph.claimCount,
        edgeCount: existingGraph.edgeCount,
        isExisting: true,
        message: "Graph already exists. Use forceRebuild=true to rebuild.",
      };
    }

    // Load source data based on type
    let sourceData: any = null;
    let graphName = args.name;

    if (args.sourceType === "entity") {
      // Parse canonical key (e.g., "company:TSLA" or just entity name)
      const [entityType, entityName] = args.sourceId.includes(":")
        ? args.sourceId.split(":", 2)
        : ["company", args.sourceId];

      sourceData = await ctx.runQuery(api.domains.knowledge.entityContexts.getEntityContext, {
        entityName,
        entityType: entityType as "company" | "person",
      });

      if (!sourceData) {
        return {
          success: false,
          error: `Entity not found: ${args.sourceId}`,
          graphId: null,
        };
      }

      graphName = graphName || `${entityName} Knowledge Graph`;
    } else if (args.sourceType === "artifact") {
      // Load document
      sourceData = await ctx.runQuery(api.domains.documents.documents.getById, {
        documentId: args.sourceId,
        userId,
      });

      if (!sourceData) {
        return {
          success: false,
          error: `Document not found: ${args.sourceId}`,
          graphId: null,
        };
      }

      graphName = graphName || `${sourceData.title} Graph`;
    }
    // TODO: Add theme and session support

    // Extract claims from source data
    const extractionResult = await extractClaimsFromSource(ctx, args.sourceType, sourceData);

    // Create the knowledge graph
    const graphId = await ctx.runMutation(internal.domains.knowledge.knowledgeGraph.createGraph, {
      name: graphName || `${args.sourceType}:${args.sourceId}`,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      userId,
      claims: extractionResult.claims,
      edges: extractionResult.edges,
    });

    // If this is an entity, link the graph back to entityContexts
    if (args.sourceType === "entity" && sourceData?._id) {
      await ctx.runMutation(internal.domains.knowledge.entityContexts.linkKnowledgeGraph, {
        entityContextId: sourceData._id,
        knowledgeGraphId: graphId,
      });
    }

    console.log(`[buildKnowledgeGraph] Created graph ${graphId} with ${extractionResult.claims.length} claims, ${extractionResult.edges.length} edges`);

    return {
      success: true,
      graphId,
      claimCount: extractionResult.claims.length,
      edgeCount: extractionResult.edges.length,
      isExisting: false,
      message: `Built knowledge graph with ${extractionResult.claims.length} claims and ${extractionResult.edges.length} edges`,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #2: fingerprintKnowledgeGraph
// Generates semantic and structural fingerprints for clustering
// ═══════════════════════════════════════════════════════════════════════════

export const fingerprintKnowledgeGraph = createTool({
  description: `Generate semantic and structural fingerprints for a Knowledge Graph.

Creates:
- Semantic fingerprint: Pooled embedding of all claims
- WL signature: Weisfeiler-Lehman hash for structural similarity
- Claim embeddings: Individual vectors for each claim

Required before running clustering/similarity analysis.
Call this after buildKnowledgeGraph.`,

  args: z.object({
    graphId: z.string().describe("ID of the knowledge graph to fingerprint"),
  }),

  handler: async (ctx: any, args): Promise<{
    success: boolean;
    error?: string;
    graphId?: string;
    hasSemanticFingerprint?: boolean;
    hasWlSignature?: boolean;
    claimVectorCount?: number;
    message?: string;
  }> => {
    const userId = ctx.evaluationUserId || ctx.userId;
    if (!userId) {
      return {
        success: false,
        error: "Not authenticated",
      };
    }

    console.log(`[fingerprintKnowledgeGraph] Fingerprinting graph: ${args.graphId}`);

    // Load the graph
    type GraphDoc = { _id: string } | null;
    const graph: GraphDoc = await ctx.runQuery(api.domains.knowledge.knowledgeGraph.getGraphById, {
      graphId: args.graphId,
    });

    if (!graph) {
      return {
        success: false,
        error: `Graph not found: ${args.graphId}`,
      };
    }

    // Load all claims for this graph
    type ClaimDoc = { _id: string; embedding?: number[] };
    const claims: ClaimDoc[] = await ctx.runQuery(api.domains.knowledge.knowledgeGraph.getGraphClaims, {
      graphId: args.graphId,
    });

    if (claims.length === 0) {
      return {
        success: false,
        error: "Graph has no claims to fingerprint",
      };
    }

    // Generate embeddings for claims that don't have them
    const claimsNeedingEmbedding = claims.filter((c: any) => !c.embedding);
    
    if (claimsNeedingEmbedding.length > 0) {
      console.log(`[fingerprintKnowledgeGraph] Embedding ${claimsNeedingEmbedding.length} claims`);
      
      // Batch embed claims
      await ctx.runAction(internal.domains.knowledge.knowledgeGraph.embedClaims, {
        claimIds: claimsNeedingEmbedding.map((c: any) => c._id),
      });
    }

    // Compute graph-level semantic fingerprint (mean pooling)
    const semanticFingerprint = await ctx.runAction(internal.domains.knowledge.knowledgeGraph.computeSemanticFingerprint, {
      graphId: args.graphId,
    });

    // Compute Weisfeiler-Lehman hash for structural fingerprint
    const wlSignature = await ctx.runAction(internal.domains.knowledge.knowledgeGraph.computeWLSignature, {
      graphId: args.graphId,
    });

    // Update the graph with fingerprints
    await ctx.runMutation(internal.domains.knowledge.knowledgeGraph.updateFingerprints, {
      graphId: args.graphId,
      semanticFingerprint,
      wlSignature,
    });

    console.log(`[fingerprintKnowledgeGraph] Completed fingerprinting for ${args.graphId}`);

    return {
      success: true,
      graphId: args.graphId,
      hasSemanticFingerprint: true,
      hasWlSignature: true,
      claimVectorCount: claims.length,
      message: `Fingerprinted graph with ${claims.length} claim vectors`,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #3: getGraphSummary
// Quick overview of a knowledge graph
// ═══════════════════════════════════════════════════════════════════════════

export const getGraphSummary = createTool({
  description: `Get a summary of a knowledge graph including claim counts, edge types, and clustering status.`,

  args: z.object({
    graphId: z.string().describe("ID of the knowledge graph"),
  }),

  handler: async (ctx: any, args): Promise<{
    success: boolean;
    error?: string;
    graphId?: string;
    name?: string;
    sourceType?: string;
    sourceId?: string;
    claimCount?: number;
    highConfidenceClaimCount?: number;
    edgeCount?: number;
    uniquePredicates?: string[];
    edgeTypeCounts?: Record<string, number>;
    hasSemanticFingerprint?: boolean;
    hasWlSignature?: boolean;
    clusterId?: string | null;
    isOddOneOut?: boolean;
    isInClusterSupport?: boolean | null;
    lastBuilt?: number;
    lastFingerprinted?: number | null;
    lastClustered?: number | null;
  }> => {
    type GraphDoc = {
      name: string;
      sourceType: string;
      sourceId: string;
      semanticFingerprint?: number[];
      wlSignature?: string;
      clusterId?: string;
      isOddOneOut: boolean;
      isInClusterSupport?: boolean;
      lastBuilt: number;
      lastFingerprinted?: number;
      lastClustered?: number;
    } | null;
    
    const graph: GraphDoc = await ctx.runQuery(api.domains.knowledge.knowledgeGraph.getGraphById, {
      graphId: args.graphId,
    });

    if (!graph) {
      return {
        success: false,
        error: `Graph not found: ${args.graphId}`,
      };
    }

    // Get claim statistics
    type ClaimDoc = { isHighConfidence: boolean; predicate: string };
    const claims: ClaimDoc[] = await ctx.runQuery(api.domains.knowledge.knowledgeGraph.getGraphClaims, {
      graphId: args.graphId,
    });

    const highConfidenceClaims = claims.filter((c) => c.isHighConfidence);
    
    // Get unique predicates
    const predicates: string[] = [...new Set(claims.map((c) => c.predicate))];

    // Get edge statistics
    type EdgeDoc = { edgeType: string };
    const edges: EdgeDoc[] = await ctx.runQuery(api.domains.knowledge.knowledgeGraph.getGraphEdges, {
      graphId: args.graphId,
    });

    const edgeTypeCounts: Record<string, number> = {};
    edges.forEach((e: any) => {
      edgeTypeCounts[e.edgeType] = (edgeTypeCounts[e.edgeType] || 0) + 1;
    });

    return {
      success: true,
      graphId: args.graphId,
      name: graph.name,
      sourceType: graph.sourceType,
      sourceId: graph.sourceId,
      
      // Counts
      claimCount: claims.length,
      highConfidenceClaimCount: highConfidenceClaims.length,
      edgeCount: edges.length,
      
      // Structure
      uniquePredicates: predicates,
      edgeTypeCounts,
      
      // Fingerprint status
      hasSemanticFingerprint: !!graph.semanticFingerprint,
      hasWlSignature: !!graph.wlSignature,
      
      // Clustering status
      clusterId: graph.clusterId,
      isOddOneOut: graph.isOddOneOut,
      isInClusterSupport: graph.isInClusterSupport,
      
      // Timestamps
      lastBuilt: graph.lastBuilt,
      lastFingerprinted: graph.lastFingerprinted,
      lastClustered: graph.lastClustered,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Extract claims from source data
// ═══════════════════════════════════════════════════════════════════════════

async function extractClaimsFromSource(
  ctx: any,
  sourceType: string,
  sourceData: any
): Promise<ClaimExtractionResult> {
  const claims: ExtractedClaim[] = [];
  const edges: ExtractedEdge[] = [];

  if (sourceType === "entity") {
    // Extract from entityContext's structuredFacts if available
    if (sourceData.structuredFacts && sourceData.structuredFacts.length > 0) {
      sourceData.structuredFacts.forEach((fact: any) => {
        claims.push({
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          claimText: `${fact.subject} ${fact.predicate} ${fact.object}`,
          isHighConfidence: fact.isHighConfidence,
          sourceDocIds: fact.sourceIds || [],
        });
      });
    } else {
      // Fallback: Convert keyFacts to claims
      const entityName = sourceData.entityName;
      sourceData.keyFacts?.forEach((fact: string, index: number) => {
        claims.push({
          subject: entityName,
          predicate: "has_fact",
          object: fact,
          claimText: fact,
          isHighConfidence: true, // Assume high confidence for curated key facts
          sourceDocIds: sourceData.sources?.map((s: any) => s.url) || [],
        });
      });
    }

    // Extract from narratives
    sourceData.narratives?.forEach((narrative: any, index: number) => {
      const claimIndex = claims.length;
      claims.push({
        subject: sourceData.entityName,
        predicate: `narrative:${narrative.label}`,
        object: narrative.description,
        claimText: `${narrative.label}: ${narrative.description}`,
        isHighConfidence: narrative.isWellSupported,
        sourceDocIds: narrative.supportingFactIds || [],
      });

      // Link narrative to supporting facts
      narrative.supportingFactIds?.forEach((factId: string) => {
        const factIndex = claims.findIndex(c => 
          c.sourceDocIds.includes(factId) || c.claimText.includes(factId)
        );
        if (factIndex >= 0) {
          edges.push({
            fromIndex: claimIndex,
            toIndex: factIndex,
            edgeType: "supports",
            isStrong: true,
          });
        }
      });
    });

    // Extract from CRM fields if available
    if (sourceData.crmFields) {
      const crm = sourceData.crmFields;
      
      if (crm.industry) {
        claims.push({
          subject: sourceData.entityName,
          predicate: "operates_in_industry",
          object: crm.industry,
          claimText: `${sourceData.entityName} operates in ${crm.industry}`,
          isHighConfidence: true,
          sourceDocIds: [],
        });
      }

      if (crm.totalFunding) {
        claims.push({
          subject: sourceData.entityName,
          predicate: "has_total_funding",
          object: crm.totalFunding,
          claimText: `${sourceData.entityName} has raised ${crm.totalFunding}`,
          isHighConfidence: true,
          sourceDocIds: [],
        });
      }

      if (crm.fundingStage) {
        claims.push({
          subject: sourceData.entityName,
          predicate: "at_funding_stage",
          object: crm.fundingStage,
          claimText: `${sourceData.entityName} is at ${crm.fundingStage} stage`,
          isHighConfidence: true,
          sourceDocIds: [],
        });
      }

      // Add founders as claims
      crm.founders?.forEach((founder: string) => {
        claims.push({
          subject: founder,
          predicate: "founded",
          object: sourceData.entityName,
          claimText: `${founder} founded ${sourceData.entityName}`,
          isHighConfidence: true,
          sourceDocIds: [],
        });
      });

      // Add investors as claims
      crm.investors?.forEach((investor: string) => {
        claims.push({
          subject: investor,
          predicate: "invested_in",
          object: sourceData.entityName,
          claimText: `${investor} invested in ${sourceData.entityName}`,
          isHighConfidence: true,
          sourceDocIds: [],
        });
      });

      // Add competitors as claims with relatedTo edges
      const competitorStartIndex = claims.length;
      crm.competitors?.forEach((competitor: string, i: number) => {
        claims.push({
          subject: sourceData.entityName,
          predicate: "competes_with",
          object: competitor,
          claimText: `${sourceData.entityName} competes with ${competitor}`,
          isHighConfidence: true,
          sourceDocIds: [],
        });
      });
    }
  } else if (sourceType === "artifact") {
    // Extract claims from document content using LLM
    // For now, create a simple claim from the document
    if (sourceData.content) {
      claims.push({
        subject: sourceData.title,
        predicate: "contains",
        object: sourceData.summary || sourceData.content.substring(0, 200),
        claimText: sourceData.summary || `Document: ${sourceData.title}`,
        isHighConfidence: true,
        sourceDocIds: [sourceData._id],
      });
    }
  }

  // Build edges between claims that share subjects/objects
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const c1 = claims[i];
      const c2 = claims[j];

      // If claims share subject or object, they're related
      if (c1.subject === c2.subject || c1.object === c2.object ||
          c1.subject === c2.object || c1.object === c2.subject) {
        edges.push({
          fromIndex: i,
          toIndex: j,
          edgeType: "relatedTo",
          isStrong: c1.subject === c2.subject, // Strong if same subject
        });
      }
    }
  }

  return { claims, edges };
}

// Export all tools as array
export const knowledgeGraphTools: unknown[] = [
  buildKnowledgeGraph,
  fingerprintKnowledgeGraph,
  getGraphSummary,
];
