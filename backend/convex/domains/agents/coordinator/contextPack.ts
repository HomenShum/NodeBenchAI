// convex/domains/agents/coordinator/contextPack.ts
// Multi-document context pack builder for coordinator pre-step
//
// Builds a structured context bundle from up to 100 documents.
// Citations are artifact IDs, not URLs. Cached per (threadId, docSetHash).

"use node";

import { internalAction } from "../../../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../../../_generated/api";
import crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface DocumentExcerpt {
  docId: string;
  title: string;
  excerpts: Array<{
    text: string;
    section?: string;
    relevanceScore?: number;
  }>;
  totalTokensEstimate: number;
}

interface ContextPack {
  packId: string;
  threadId: string;
  docSetHash: string;
  documents: DocumentExcerpt[];
  totalTokens: number;
  createdAt: number;
  expiresAt: number;
  metadata: {
    docCount: number;
    truncatedDocs: number;
    maxTokensUsed: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const MAX_DOCUMENTS = 100;
const DEFAULT_MAX_TOKENS = 50000; // ~12,500 words
const EXCERPT_MAX_CHARS = 2000; // Per document excerpt
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Simple token estimation (4 chars ≈ 1 token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Generate deterministic hash for document set
function hashDocSet(docIds: string[]): string {
  const sorted = [...docIds].sort();
  return crypto.createHash("sha256").update(sorted.join("|")).digest("hex").slice(0, 16);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION: Build context pack from documents
// ═══════════════════════════════════════════════════════════════════════════

export const buildContextPack = internalAction({
  args: {
    docIds: v.array(v.string()),
    artifactIds: v.optional(v.array(v.string())),
    threadId: v.string(),
    maxTokens: v.optional(v.number()),
    query: v.optional(v.string()), // Optional query for relevance ranking
  },
  handler: async (ctx, args): Promise<ContextPack> => {
    const startTime = Date.now();
    const maxTokens = args.maxTokens ?? DEFAULT_MAX_TOKENS;

    // Limit document count
    const docIds = args.docIds.slice(0, MAX_DOCUMENTS);
    const docSetHash = hashDocSet(docIds);

    // Check cache first (query is in separate file for V8 runtime)
    const cached = await ctx.runQuery(internal.domains.agents.coordinator.contextPackQueries.getCachedContextPack, {
      threadId: args.threadId,
      docSetHash,
    });

    if (cached) {
      console.log(`[buildContextPack] Cache HIT for ${docIds.length} docs`);
      return cached;
    }

    console.log(`[buildContextPack] Building pack for ${docIds.length} documents (max ${maxTokens} tokens)`);

    // Fetch document contents
    const documents: DocumentExcerpt[] = [];
    let totalTokens = 0;
    let truncatedDocs = 0;

    for (const docId of docIds) {
      // Skip if we've hit token limit
      if (totalTokens >= maxTokens) {
        truncatedDocs++;
        continue;
      }

      try {
        // Fetch document content using internal API (bypasses auth for agent tools)
        const doc = await ctx.runQuery(internal.domains.documents.documents.getDocumentById, {
          documentId: docId,
        });

        if (!doc) {
          console.warn(`[buildContextPack] Document not found: ${docId}`);
          continue;
        }

        // Extract text content
        let textContent = "";

        // Try to get content from different sources
        if (doc.content) {
          // Parse ProseMirror JSON if present
          try {
            const parsed = JSON.parse(doc.content);
            textContent = extractTextFromProseMirror(parsed);
          } catch {
            textContent = doc.content;
          }
        }

        if (!textContent && doc.summary) {
          textContent = doc.summary;
        }

        if (!textContent) {
          console.warn(`[buildContextPack] No content for doc: ${docId}`);
          continue;
        }

        // Calculate available budget for this document
        const remainingTokens = maxTokens - totalTokens;
        const docTokens = estimateTokens(textContent);

        // Create excerpt (truncate if needed)
        let excerpt = textContent;
        let excerptTokens = docTokens;

        if (docTokens > remainingTokens || textContent.length > EXCERPT_MAX_CHARS) {
          // Truncate to fit budget
          const maxChars = Math.min(EXCERPT_MAX_CHARS, remainingTokens * 4);
          excerpt = textContent.slice(0, maxChars);
          if (textContent.length > maxChars) {
            excerpt += "\n\n[... content truncated ...]";
          }
          excerptTokens = estimateTokens(excerpt);
          truncatedDocs++;
        }

        documents.push({
          docId,
          title: doc.title || "Untitled",
          excerpts: [{
            text: excerpt,
            section: undefined,
            relevanceScore: undefined,
          }],
          totalTokensEstimate: excerptTokens,
        });

        totalTokens += excerptTokens;

      } catch (err) {
        console.error(`[buildContextPack] Error fetching doc ${docId}:`, err);
      }
    }

    // Create context pack
    const packId = `pack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const pack: ContextPack = {
      packId,
      threadId: args.threadId,
      docSetHash,
      documents,
      totalTokens,
      createdAt: now,
      expiresAt: now + CACHE_TTL_MS,
      metadata: {
        docCount: documents.length,
        truncatedDocs,
        maxTokensUsed: maxTokens,
      },
    };

    // Store in cache
    try {
      await ctx.runMutation(internal.domains.agents.coordinator.contextPackMutations.storeContextPack, {
        pack,
      });
    } catch (cacheError) {
      console.warn("[buildContextPack] Failed to cache pack:", cacheError);
    }

    console.log(`[buildContextPack] Built pack with ${documents.length} docs, ${totalTokens} tokens in ${Date.now() - startTime}ms`);

    return pack;
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Extract text from ProseMirror JSON
// ═══════════════════════════════════════════════════════════════════════════

function extractTextFromProseMirror(node: any): string {
  if (!node) return "";

  if (typeof node === "string") return node;

  if (node.text) return node.text;

  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractTextFromProseMirror).join("\n");
  }

  return "";
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION: Format context pack for LLM consumption
// ═══════════════════════════════════════════════════════════════════════════

export const formatContextPackForPrompt = internalAction({
  args: {
    pack: v.any(), // ContextPack
    format: v.optional(v.union(
      v.literal("full"),      // Include all excerpts
      v.literal("summary"),   // Just titles and brief excerpts
      v.literal("citations")  // Just document IDs for citation reference
    )),
  },
  handler: async (_ctx, args): Promise<string> => {
    const pack = args.pack as ContextPack;
    const format = args.format ?? "full";

    if (format === "citations") {
      // Just return citation map
      const citations = pack.documents.map((doc, idx) =>
        `[${idx + 1}] ${doc.title} (docId: ${doc.docId})`
      );
      return `## Available Documents for Citation\n\n${citations.join("\n")}`;
    }

    let result = `## Context Pack (${pack.documents.length} documents, ~${pack.totalTokens} tokens)\n\n`;

    for (let i = 0; i < pack.documents.length; i++) {
      const doc = pack.documents[i];
      const citation = `[${i + 1}]`;

      result += `### ${citation} ${doc.title}\n`;
      result += `*Document ID: ${doc.docId}*\n\n`;

      if (format === "summary") {
        // Just first 200 chars
        const preview = doc.excerpts[0]?.text.slice(0, 200) || "(no content)";
        result += `${preview}...\n\n`;
      } else {
        // Full excerpt
        for (const excerpt of doc.excerpts) {
          if (excerpt.section) {
            result += `**${excerpt.section}:**\n`;
          }
          result += `${excerpt.text}\n\n`;
        }
      }

      result += "---\n\n";
    }

    result += `\n**Citation Format:** Use [1], [2], etc. to cite these documents. Each number maps to a docId above.\n`;

    return result;
  },
});
