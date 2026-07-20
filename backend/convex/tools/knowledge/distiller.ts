// convex/tools/knowledge/distiller.ts
// Small-model extraction of facts/claims with citations
// Uses FREE-FIRST strategy: qwen3-coder-free -> gemini-3-flash-preview -> claude-haiku-4.5

import { v } from "convex/values";
import { action, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id, Doc } from "../../_generated/dataModel";
import { generateText } from "ai";
import {
  executeWithModelFallback,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
  getModelSpec,
  calculateCost,
  type ApprovedModel,
} from "../../domains/agents/mcp_tools/models/modelResolver";
import {
  FACT_EXTRACTION_SYSTEM_PROMPT,
  generateFactExtractionPrompt,
  parseFactExtractionResponse,
} from "./distillerPrompts";

/* ------------------------------------------------------------------ */
/* TYPES                                                               */
/* ------------------------------------------------------------------ */

/**
 * Citation linking a fact to its source
 */
export interface FactCitation {
  artifactId: string;
  chunkId: string;
  quote: string;
  pageIndex?: number;
  anchor: string;  // {{fact:distilled:factId:chunkId}}
}

/**
 * Extracted fact with citations
 */
export interface DistilledFact {
  id: string;
  text: string;
  confidence: number;
  citations: FactCitation[];
  category?: string;
}

/**
 * Result of distillation
 */
export interface DistillationResult {
  facts: DistilledFact[];
  tokensUsed: number;
  modelUsed: string;
  isFreeModel: boolean;
  fallbacksUsed: number;
  latencyMs: number;
  cost: {
    inputCost: number;
    outputCost: number;
    totalCost: number;
  };
}

/* ------------------------------------------------------------------ */
/* CONSTANTS                                                           */
/* ------------------------------------------------------------------ */

// Maximum facts to extract per call
const MAX_FACTS = 20;

// Default facts to extract
const DEFAULT_MAX_FACTS = 10;

// Maximum tokens for output
const MAX_OUTPUT_TOKENS = 1500;

// Approximate tokens per character
const TOKENS_PER_CHAR = 0.25;

/* ------------------------------------------------------------------ */
/* HELPERS                                                             */
/* ------------------------------------------------------------------ */

/**
 * Generate citation anchor
 */
function generateCitationAnchor(factId: string, chunkId: string): string {
  return `{{fact:distilled:${factId}:${chunkId}}}`;
}

/**
 * Estimate tokens from text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

function getUsageTokens(usage: unknown): { inputTokens: number; outputTokens: number; totalTokens: number } {
  const u = usage as any;
  const inputTokens = Number(u?.promptTokens ?? u?.inputTokens ?? 0);
  const outputTokens = Number(u?.completionTokens ?? u?.outputTokens ?? 0);
  const totalTokens = Number(u?.totalTokens ?? inputTokens + outputTokens);
  return { inputTokens, outputTokens, totalTokens };
}

/* ------------------------------------------------------------------ */
/* INTERNAL QUERIES                                                    */
/* ------------------------------------------------------------------ */

/**
 * Get chunks for multiple artifacts
 */
export const getChunksForArtifacts = internalQuery({
  args: {
    artifactIds: v.array(v.id("sourceArtifacts")),
    maxChunksPerArtifact: v.optional(v.number()),
  },
  returns: v.array(v.object({
    chunkId: v.id("artifactChunks"),
    artifactId: v.id("sourceArtifacts"),
    text: v.string(),
    sourceUrl: v.optional(v.string()),
    startOffset: v.optional(v.number()),
    endOffset: v.optional(v.number()),
    pageIndex: v.optional(v.number()),
  })),
  handler: async (ctx, args) => {
    const maxPerArtifact = Math.min(args.maxChunksPerArtifact ?? 5, 10);
    const allChunks: Array<{
      chunkId: Id<"artifactChunks">;
      artifactId: Id<"sourceArtifacts">;
      text: string;
      sourceUrl?: string;
      startOffset?: number;
      endOffset?: number;
      pageIndex?: number;
    }> = [];

    for (const artifactId of args.artifactIds.slice(0, 10)) {
      const chunks = await ctx.db
        .query("artifactChunks")
        .withIndex("by_artifact_version_offset", (q) =>
          q.eq("artifactId", artifactId).eq("chunkVersion", 1)
        )
        .take(maxPerArtifact);

      for (const chunk of chunks as Doc<"artifactChunks">[]) {
        allChunks.push({
          chunkId: chunk._id,
          artifactId: chunk.artifactId,
          text: chunk.text,
          sourceUrl: chunk.sourceUrl,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          pageIndex: chunk.pageIndex,
        });
      }
    }

    return allChunks;
  },
});

/**
 * Get artifact metadata
 */
export const getArtifactMetadata = internalQuery({
  args: {
    artifactIds: v.array(v.id("sourceArtifacts")),
  },
  returns: v.array(v.object({
    _id: v.id("sourceArtifacts"),
    title: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const results: Array<{
      _id: Id<"sourceArtifacts">;
      title?: string;
      sourceUrl?: string;
    }> = [];

    for (const id of args.artifactIds) {
      const artifact = await ctx.db.get(id) as Doc<"sourceArtifacts"> | null;
      if (artifact) {
        results.push({
          _id: artifact._id,
          title: artifact.title,
          sourceUrl: artifact.sourceUrl,
        });
      }
    }

    return results;
  },
});

/* ------------------------------------------------------------------ */
/* ACTIONS - Main distillation tools                                   */
/* ------------------------------------------------------------------ */

/**
 * Distill facts from multiple artifacts
 * Uses FREE-FIRST strategy with automatic fallback
 */
export const distillArtifacts = action({
  args: {
    artifactIds: v.array(v.id("sourceArtifacts")),
    query: v.string(),
    persona: v.optional(v.string()),
    maxFacts: v.optional(v.number()),
    preferredModel: v.optional(v.string()),
  },
  returns: v.object({
    facts: v.array(v.object({
      id: v.string(),
      text: v.string(),
      confidence: v.number(),
      citations: v.array(v.object({
        artifactId: v.string(),
        chunkId: v.string(),
        quote: v.string(),
        pageIndex: v.optional(v.number()),
        anchor: v.string(),
      })),
      category: v.optional(v.string()),
    })),
    tokensUsed: v.number(),
    modelUsed: v.string(),
    isFreeModel: v.boolean(),
    fallbacksUsed: v.number(),
    latencyMs: v.number(),
    cost: v.object({
      inputCost: v.number(),
      outputCost: v.number(),
      totalCost: v.number(),
    }),
  }),
  handler: async (ctx, args): Promise<DistillationResult> => {
    const startTime = Date.now();
    const maxFacts = Math.min(args.maxFacts ?? DEFAULT_MAX_FACTS, MAX_FACTS);

    // Ensure artifacts are indexed so we can cite chunk IDs deterministically.
    for (const artifactId of args.artifactIds.slice(0, 10)) {
      const chunkCount = await ctx.runQuery(internal.domains.artifacts.evidenceSearch.countChunksForArtifact, {
        artifactId,
      });
      if (chunkCount === 0) {
        await ctx.runAction(internal.domains.artifacts.evidenceIndexActions.indexArtifact, {
          artifactId,
        });
      }
    }

    // Get chunks from all artifacts
    const chunks = (await ctx.runQuery(
      internal.tools.knowledge.distiller.getChunksForArtifacts,
      {
        artifactIds: args.artifactIds,
        maxChunksPerArtifact: 5,
      }
    )) as Array<{
      chunkId: Id<"artifactChunks">;
      artifactId: Id<"sourceArtifacts">;
      text: string;
      sourceUrl?: string;
      startOffset?: number;
      endOffset?: number;
      pageIndex?: number;
    }>;

    if (chunks.length === 0) {
      return {
        facts: [],
        tokensUsed: 0,
        modelUsed: DEFAULT_MODEL,
        isFreeModel: true,
        fallbacksUsed: 0,
        latencyMs: Date.now() - startTime,
        cost: { inputCost: 0, outputCost: 0, totalCost: 0 },
      };
    }

    // Build prompt
    const userPrompt = generateFactExtractionPrompt(
      args.query,
      chunks.map((c, i) => ({
        index: i,
        text: c.text,
        sourceUrl: c.sourceUrl,
      })),
      args.persona,
      maxFacts
    );

    // Create a mapping from chunk index to actual chunk data
    const chunkMap = new Map(chunks.map((c, i) => [i, c]));

    // Execute with fallback
    const { result, modelUsed, isFree, fallbacksUsed } = await executeWithModelFallback(
      async (model, modelId) => {
        const response = await generateText({
          model,
          system: FACT_EXTRACTION_SYSTEM_PROMPT,
          prompt: userPrompt,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        });

        return {
          text: response.text,
          usage: response.usage,
          modelId,
        };
      },
      {
        startModel: (args.preferredModel as ApprovedModel) ?? DEFAULT_MODEL,
        onFallback: (from, to, error) => {
          console.log(`[distiller] Fallback ${from} → ${to}: ${error.message}`);
        },
      }
    );

    // Parse the response
    const parsed = parseFactExtractionResponse(result.text);
    if (!parsed) {
      console.warn("[distiller] Failed to parse fact extraction response");
      const usage = getUsageTokens(result.usage);
      return {
        facts: [],
        tokensUsed: usage.totalTokens || estimateTokens(result.text),
        modelUsed,
        isFreeModel: isFree,
        fallbacksUsed,
        latencyMs: Date.now() - startTime,
        cost: calculateCost(
          modelUsed,
          usage.inputTokens,
          usage.outputTokens
        ),
      };
    }

    // Map parsed facts to DistilledFacts with proper citations
    const distilledFacts: DistilledFact[] = parsed.facts.slice(0, maxFacts).map((fact) => {
      const citations: FactCitation[] = fact.citations.map((citation) => {
        const chunk = chunkMap.get(citation.chunkIndex);
        if (!chunk) {
          // Fallback to first chunk if index is invalid
          const firstChunk = chunks[0];
          return {
            artifactId: String(firstChunk.artifactId),
            chunkId: String(firstChunk.chunkId),
            quote: citation.quote,
            pageIndex: firstChunk.pageIndex,
            anchor: generateCitationAnchor(fact.id, String(firstChunk.chunkId)),
          };
        }
        return {
          artifactId: String(chunk.artifactId),
          chunkId: String(chunk.chunkId),
          quote: citation.quote,
          pageIndex: chunk.pageIndex,
          anchor: generateCitationAnchor(fact.id, String(chunk.chunkId)),
        };
      });

      return {
        id: fact.id,
        text: fact.text,
        confidence: fact.confidence,
        citations,
        category: fact.category,
      };
    });

    const usage = getUsageTokens(result.usage);
    const tokensUsed = usage.totalTokens || estimateTokens(result.text);
    const cost = calculateCost(
      modelUsed,
      usage.inputTokens || Math.floor(tokensUsed * 0.7),
      usage.outputTokens || Math.floor(tokensUsed * 0.3)
    );

    return {
      facts: distilledFacts,
      tokensUsed,
      modelUsed,
      isFreeModel: isFree,
      fallbacksUsed,
      latencyMs: Date.now() - startTime,
      cost,
    };
  },
});

/**
 * Quick distillation for a single artifact
 * Convenience wrapper for common use case
 */
export const distillSingleArtifact = action({
  args: {
    artifactId: v.id("sourceArtifacts"),
    query: v.string(),
    maxFacts: v.optional(v.number()),
  },
  returns: v.object({
    facts: v.array(v.object({
      id: v.string(),
      text: v.string(),
      confidence: v.number(),
      citations: v.array(v.object({
        artifactId: v.string(),
        chunkId: v.string(),
        quote: v.string(),
        pageIndex: v.optional(v.number()),
        anchor: v.string(),
      })),
      category: v.optional(v.string()),
    })),
    tokensUsed: v.number(),
    modelUsed: v.string(),
    latencyMs: v.number(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.runAction(
      internal.tools.knowledge.distiller.distillArtifacts,
      {
        artifactIds: [args.artifactId],
        query: args.query,
        maxFacts: args.maxFacts,
      }
    );

    return {
      facts: result.facts,
      tokensUsed: result.tokensUsed,
      modelUsed: result.modelUsed,
      latencyMs: result.latencyMs,
    };
  },
});

/**
 * Distill with explicit model selection (for testing/comparison)
 */
export const distillWithModel = action({
  args: {
    artifactIds: v.array(v.id("sourceArtifacts")),
    query: v.string(),
    model: v.string(),
    maxFacts: v.optional(v.number()),
  },
  returns: v.object({
    facts: v.array(v.object({
      id: v.string(),
      text: v.string(),
      confidence: v.number(),
      citations: v.array(v.object({
        artifactId: v.string(),
        chunkId: v.string(),
        quote: v.string(),
        pageIndex: v.optional(v.number()),
        anchor: v.string(),
      })),
      category: v.optional(v.string()),
    })),
    tokensUsed: v.number(),
    modelUsed: v.string(),
    isFreeModel: v.boolean(),
    latencyMs: v.number(),
    cost: v.object({
      inputCost: v.number(),
      outputCost: v.number(),
      totalCost: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.runAction(
      internal.tools.knowledge.distiller.distillArtifacts,
      {
        artifactIds: args.artifactIds,
        query: args.query,
        maxFacts: args.maxFacts,
        preferredModel: args.model,
      }
    );

    return {
      facts: result.facts,
      tokensUsed: result.tokensUsed,
      modelUsed: result.modelUsed,
      isFreeModel: result.isFreeModel,
      latencyMs: result.latencyMs,
      cost: result.cost,
    };
  },
});
