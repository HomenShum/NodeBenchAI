import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id, Doc } from "../../_generated/dataModel";

/**
 * Creates a file document from an uploaded file
 * This allows files to be treated as documents in the editor/grid system
 */
export const createFileDocument = mutation({
  args: {
    fileId: v.id("files"),
    title: v.optional(v.string()), // If not provided, will use fileName from file
    parentId: v.optional(v.id("documents")),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Get the file details
    const file = await ctx.db.get(args.fileId) as Doc<"files"> | null;
    if (!file) {
      throw new Error("File not found");
    }

    // Verify user owns the file
    if (file.userId !== userId) {
      throw new Error("Not authorized to access this file");
    }

    // Determine file type category for appropriate viewer
    let fileType = "unknown";
    const nameLower = (file.fileName || "").toLowerCase();
    const mimeLower = (file.mimeType || "").toLowerCase();
    if (mimeLower.includes("text/csv") || nameLower.endsWith(".csv")) {
      fileType = "csv";
    } else if (mimeLower.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") ||
               mimeLower.includes("application/vnd.ms-excel") ||
               nameLower.endsWith(".xlsx") || nameLower.endsWith(".xls")) {
      fileType = "excel";
    } else if (mimeLower.includes("application/pdf")) {
      fileType = "pdf";
    } else if (mimeLower.startsWith("image/")) {
      fileType = "image";
    } else if (mimeLower.startsWith("video/")) {
      fileType = "video";
    } else if (mimeLower.startsWith("audio/")) {
      fileType = "audio";
    } else if (mimeLower.includes("text/")) {
      fileType = "text";
    }

    const now = Date.now();
    
    const documentId = await ctx.db.insert("documents", {
      title: args.title || file.fileName,
      parentId: args.parentId,
      isPublic: args.isPublic || false,
      createdBy: userId,
      lastEditedBy: userId,
      documentType: "file",
      fileId: args.fileId,
      fileType,
      mimeType: file.mimeType,
      lastModified: now,
    });

    // Index file document into Gemini File Search asynchronously
    // Use statically imported 'internal' - dynamic imports are not supported in mutations
    await ctx.scheduler.runAfter(0, internal.domains.documents.fileSearch.upsertDocument, { documentId });

    return documentId;
  },
});

/**
 * Get file document with file details
 */
export const getFileDocument = query({
  args: {
    documentId: v.id("documents"),
    userId: v.optional(v.id("users")), // Optional for evaluation/testing
  },
  returns: v.union(
    v.object({
      document: v.object({
        _id: v.id("documents"),
        title: v.string(),
        documentType: v.optional(v.union(v.literal("text"), v.literal("file"))),
        fileType: v.optional(v.string()),
        mimeType: v.optional(v.string()),
        createdBy: v.id("users"),
        lastModified: v.optional(v.number()),
        isPublic: v.boolean(),
        isArchived: v.optional(v.boolean()),
      }),
      file: v.object({
        _id: v.id("files"),
        fileName: v.string(),
        fileSize: v.number(),
        storageId: v.string(),
        analysis: v.optional(v.string()),
        structuredData: v.optional(v.any()),
      }),
      storageUrl: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    // Use provided userId or fall back to authenticated user
    const userId = args.userId || await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const document = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
    if (!document || document.documentType !== "file" || !document.fileId) {
      return null;
    }

    // Check access permissions
    if (!document.isPublic && document.createdBy !== userId) {
      return null;
    }

    const file = await ctx.db.get(document.fileId) as Doc<"files"> | null;
    if (!file) {
      return null;
    }

    // Get storage URL for file viewing
    const storageUrl = file.storageId ? await ctx.storage.getUrl(file.storageId) : undefined;
    // Ensure storageUrl is undefined instead of null for type compatibility
    const safeStorageUrl = storageUrl || undefined;

    return {
      document: {
        _id: document._id,
        title: document.title,
        documentType: document.documentType,
        fileType: document.fileType,
        mimeType: document.mimeType,
        createdBy: document.createdBy,
        lastModified: document.lastModified,
        isPublic: document.isPublic,
        isArchived: document.isArchived,
      },
      file: {
        _id: file._id,
        fileName: file.fileName,
        fileSize: file.fileSize,
        storageId: file.storageId,
        analysis: file.analysis,
        structuredData: file.structuredData,
      },
      storageUrl: safeStorageUrl,
    };
  },
});

/**
 * List all file documents for a user
 */
export const getUserFileDocuments = query({
  args: {
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.array(v.object({
    _id: v.id("documents"),
    title: v.string(),
    fileType: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    lastModified: v.optional(v.number()),
    fileName: v.string(),
    fileSize: v.number(),
  })),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const documents = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .filter((q) => 
        q.and(
          q.eq(q.field("documentType"), "file"),
          args.includeArchived ? q.or(q.eq(q.field("isArchived"), false), q.eq(q.field("isArchived"), undefined)) : q.or(q.eq(q.field("isArchived"), false), q.eq(q.field("isArchived"), undefined))
        )
      )
      .collect();

    const results: Array<{
      _id: any;
      title: any;
      fileType: any;
      mimeType: any;
      lastModified: any;
      fileName: any;
      fileSize: any;
    }> = [];
    for (const doc of documents) {
      if (doc.fileId) {
        const file = await ctx.db.get(doc.fileId) as Doc<"files"> | null;
        if (file) {
          results.push({
            _id: doc._id,
            title: doc.title,
            fileType: doc.fileType,
            mimeType: doc.mimeType,
            lastModified: doc.lastModified,
            fileName: file.fileName,
            fileSize: file.fileSize,
          });
        }
      }
    }

    return results.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
  },
});

/**
 * Auto-create file documents for files that don't have them yet
 * This can be called periodically or on-demand to sync files → documents
 */
export const syncFilesToDocuments = mutation({
  args: {},
  returns: v.array(v.id("documents")),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Get all user files
    const files = await ctx.db
      .query("files")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Get all existing file documents
    const existingFileDocuments = await ctx.db
      .query("documents")
      .withIndex("by_user", (q) => q.eq("createdBy", userId))
      .filter((q) => q.eq(q.field("documentType"), "file"))
      .collect();

    const existingFileIds = new Set(
      existingFileDocuments
        .map(doc => doc.fileId)
        .filter(Boolean)
    );

    const createdDocuments: Id<"documents">[] = [];

    // Create documents for files that don't have them
    for (const file of files) {
      if (!existingFileIds.has(file._id)) {
        // Determine file type
        let fileType = "unknown";
        const nameLower = (file.fileName || "").toLowerCase();
        const mimeLower = (file.mimeType || "").toLowerCase();
        if (mimeLower.includes("text/csv") || nameLower.endsWith(".csv")) {
          fileType = "csv";
        } else if (mimeLower.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") ||
                   mimeLower.includes("application/vnd.ms-excel") ||
                   nameLower.endsWith(".xlsx") || nameLower.endsWith(".xls")) {
          fileType = "excel";
        } else if (mimeLower.includes("application/pdf")) {
          fileType = "pdf";
        } else if (mimeLower.startsWith("image/")) {
          fileType = "image";
        } else if (mimeLower.startsWith("video/")) {
          fileType = "video";
        } else if (mimeLower.startsWith("audio/")) {
          fileType = "audio";
        } else if (mimeLower.includes("text/")) {
          fileType = "text";
        }

        const documentId = await ctx.db.insert("documents", {
          title: file.fileName,
          isPublic: false,
          createdBy: userId,
          lastEditedBy: userId,
          documentType: "file",
          fileId: file._id,
          fileType,
          mimeType: file.mimeType,
          lastModified: Date.now(),
        });

        createdDocuments.push(documentId);
      }
    }

    return createdDocuments;
  },
});
