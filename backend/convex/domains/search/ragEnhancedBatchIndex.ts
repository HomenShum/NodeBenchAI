/**
 * Batch Re-indexing for Enhanced RAG
 *
 * This file provides utilities to re-index existing documents into the enhanced RAG system.
 * Use this to migrate documents that were created before enhanced RAG was implemented.
 */

import { action, internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../../_generated/api";
import type { Id, Doc } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

// Internal query to list non-archived documents for a user
export const listUserDocsNotArchived = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect() as Doc<"documents">[];
  },
});

/**
 * Get all documents that need to be indexed
 * Returns documents in batches for processing
 */
export const getDocumentsToIndex = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<any> => {
    const limit = args.limit || 100;

    // Get all non-archived documents
    const results = await ctx.db
      .query("documents")
      .filter((q) => q.eq(q.field("isArchived"), false))
      .paginate({
        cursor: args.cursor || null,
        numItems: limit,
      }) as { page: Doc<"documents">[]; isDone: boolean; continueCursor: string };

    return {
      documents: results.page.map((doc: Doc<"documents">) => ({
        _id: doc._id,
        title: doc.title,
        createdBy: doc.createdBy,
        documentType: doc.documentType,
      })),
      isDone: results.isDone,
      continueCursor: results.continueCursor,
    };
  },
});

/**
 * Batch re-index all documents for a specific user
 * This will index all their documents into the enhanced RAG system
 */
export const batchReindexUserDocuments = internalAction({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<any> => {
    const limit = args.limit || 50; // Process 50 documents at a time
    let cursor: string | undefined = undefined;
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    console.log(`[batchReindexUserDocuments] Starting batch re-index for user: ${args.userId}`);

    do {
      // Get batch of documents
      const batch: any = await ctx.runQuery(internal.domains.search.ragEnhancedBatchIndex.getDocumentsToIndex, {
        cursor,
        limit,
      });

      // Filter to only this user's documents
      const userDocs = batch.documents.filter((doc: any) => doc.createdBy === args.userId);

      console.log(`[batchReindexUserDocuments] Processing batch: ${userDocs.length} documents for user ${args.userId}`);

      // Index each document
      for (const doc of userDocs) {
        try {
          const result: any = await ctx.runAction(internal.domains.search.ragEnhanced.addDocumentToEnhancedRag, {
            documentId: doc._id,
            userId: args.userId,
          });

          if (result.success) {
            totalSuccess++;
            console.log(`[batchReindexUserDocuments] ✓ Indexed: ${doc.title} (${result.chunksCount} chunks)`);
          } else {
            totalFailed++;
            console.warn(`[batchReindexUserDocuments] ✗ Failed: ${doc.title}`);
          }
        } catch (error) {
          totalFailed++;
          console.error(`[batchReindexUserDocuments] ✗ Error indexing ${doc.title}:`, error);
        }

        totalProcessed++;
      }

      cursor = batch.isDone ? undefined : batch.continueCursor;
    } while (cursor);

    const summary = {
      userId: args.userId,
      totalProcessed,
      totalSuccess,
      totalFailed,
      successRate: totalProcessed > 0 ? (totalSuccess / totalProcessed * 100).toFixed(1) + '%' : '0%',
    };

    console.log(`[batchReindexUserDocuments] Complete:`, summary);

    return summary;
  },
});

/**
 * Re-index ALL documents in the system (admin function)
 * Use with caution - this will process all documents for all users
 */
export const batchReindexAllDocuments = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<any> => {
    const limit = args.limit || 50;
    let cursor: string | undefined = undefined;
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    console.log(`[batchReindexAllDocuments] Starting FULL batch re-index of all documents`);

    do {
      const batch: any = await ctx.runQuery(internal.domains.search.ragEnhancedBatchIndex.getDocumentsToIndex, {
        cursor,
        limit,
      });

      console.log(`[batchReindexAllDocuments] Processing batch: ${batch.documents.length} documents`);

      for (const doc of batch.documents) {
        if (!doc.createdBy) {
          console.warn(`[batchReindexAllDocuments] Skipping document without createdBy: ${doc._id}`);
          continue;
        }

        try {
          const result: any = await ctx.runAction(internal.domains.search.ragEnhanced.addDocumentToEnhancedRag, {
            documentId: doc._id,
            userId: doc.createdBy,
          });

          if (result.success) {
            totalSuccess++;
            console.log(`[batchReindexAllDocuments] ✓ Indexed: ${doc.title} (${result.chunksCount} chunks)`);
          } else {
            totalFailed++;
            console.warn(`[batchReindexAllDocuments] ✗ Failed: ${doc.title}`);
          }
        } catch (error) {
          totalFailed++;
          console.error(`[batchReindexAllDocuments] ✗ Error indexing ${doc.title}:`, error);
        }

        totalProcessed++;
      }

      cursor = batch.isDone ? undefined : batch.continueCursor;
    } while (cursor);

    const summary = {
      totalProcessed,
      totalSuccess,
      totalFailed,
      successRate: totalProcessed > 0 ? (totalSuccess / totalProcessed * 100).toFixed(1) + '%' : '0%',
    };

    console.log(`[batchReindexAllDocuments] Complete:`, summary);

    return summary;
  },
});

/**
 * Re-index a single document (useful for testing or manual fixes)
 */
export const reindexSingleDocument = internalAction({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args): Promise<any> => {
    // Get document to find userId
    const doc: any = await ctx.runQuery(internal.domains.search.ragEnhancedBatchIndex.getDocumentInfo, {
      documentId: args.documentId,
    });

    if (!doc) {
      throw new Error(`Document not found: ${args.documentId}`);
    }

    if (!doc.createdBy) {
      throw new Error(`Document has no createdBy field: ${args.documentId}`);
    }

    console.log(`[reindexSingleDocument] Re-indexing: ${doc.title}`);

    const result: any = await ctx.runAction(internal.domains.search.ragEnhanced.addDocumentToEnhancedRag, {
      documentId: args.documentId,
      userId: doc.createdBy,
    });

    if (result.success) {
      console.log(`[reindexSingleDocument] ✓ Success: ${doc.title} (${result.chunksCount} chunks)`);
    } else {
      console.warn(`[reindexSingleDocument] ✗ Failed: ${doc.title}`);
    }

    return result;
  },
});

/**
 * Helper query to get document info
 */
export const getDocumentInfo = internalQuery({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
    if (!doc) return null;

    return {
      _id: doc._id,
      title: doc.title,
      createdBy: doc.createdBy,
      documentType: doc.documentType,
      isArchived: doc.isArchived,
    };
  },
});


/**
 * Ensure up-to-date indexing for a user's recently modified or never-indexed documents.
 * Used as a lightweight, on-demand "lazy indexing" step before search.
 */
export const ensureUpToDateIndexForUser = internalAction({
  args: {
    userId: v.id("users"),
    windowMs: v.optional(v.number()), // consider docs modified within this window; defaults to 7 days
    limit: v.optional(v.number()), // safety cap
  },
  handler: async (ctx, args): Promise<any> => {
    const windowMs = args.windowMs ?? 1000 * 60 * 60 * 24 * 7; // 7 days
    const now = Date.now();
    const since = now - windowMs;
    const limit = args.limit ?? 200;

    // Fetch this user's documents via internal query (actions cannot access ctx.db)
    const userDocs: any[] = await ctx.runQuery(internal.domains.search.ragEnhancedBatchIndex.listUserDocsNotArchived, { userId: args.userId });

    // Narrow to recently modified or never-indexed docs
    const candidates = userDocs
      .filter((d: any) => {
        const lastModified = d.lastModified ?? d._creationTime ?? 0;
        const ragIndexedAt = d.ragIndexedAt ?? 0;
        const neverIndexed = !ragIndexedAt;
        const modifiedSince = lastModified >= since;
        const changedSinceIndex = ragIndexedAt && lastModified > ragIndexedAt;
        return neverIndexed || modifiedSince || changedSinceIndex;
      })
      .slice(0, limit);

    let processed = 0;
    let queued = 0;
    let errors = 0;

    for (const doc of candidates) {
      try {
        // Step A: Ensure metadata is present/up-to-date before indexing (lazy analysis)
        try {
          if (doc.documentType === "dossier" && (doc).dossierType === "primary") {
            await ctx.runAction(api.domains.ai.metadataAnalyzer.buildDossierMetadata, { dossierId: doc._id as Id<"documents"> });
          } else {
            await ctx.runAction(api.domains.ai.metadataAnalyzer.analyzeDocumentMetadata, { documentId: doc._id as Id<"documents"> });
          }
        } catch (metaErr) {
          console.warn("[ensureUpToDateIndexForUser] Metadata analysis skipped", { docId: doc._id, err: metaErr });
        }

        // Step B: Index into Enhanced RAG
        await ctx.runAction(internal.domains.search.ragEnhanced.addDocumentToEnhancedRag, {
          documentId: doc._id as Id<"documents">,
          userId: args.userId,
        });
        queued++;
      } catch (e) {
        errors++;
        console.warn("[ensureUpToDateIndexForUser] Failed to index", { docId: doc._id, title: doc.title, e });
      } finally {
        processed++;
      }
    }

    return { processed, queued, errors, windowMs, considered: userDocs.length };
  },
});

/**
 * PUBLIC ACTION: Re-index current user's documents
 * This can be called by users to index their existing documents into enhanced RAG
 */
export const reindexMyDocuments = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    console.log(`[reindexMyDocuments] User ${userId} requested re-indexing of their documents`);

    const result: any = await ctx.runAction(internal.domains.search.ragEnhancedBatchIndex.batchReindexUserDocuments, {
      userId,
    });

    return {
      success: true,
      message: `Re-indexed ${result.totalSuccess} of ${result.totalProcessed} documents (${result.successRate} success rate)`,
      ...result,
    };
  },
});

