import { v } from "convex/values";
import { mutation, query, internalQuery, internalMutation } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";

export const generateUploadUrl = mutation(async (ctx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  return await ctx.storage.generateUploadUrl();
});

// Finalize a CSV replacement by updating the file's storageId and metadata
export const finalizeCsvReplace = mutation({
  args: {
    fileId: v.id("files"),
    newStorageId: v.string(),
    newFileSize: v.number(),
    modifiedCells: v.optional(
      v.array(
        v.object({
          row: v.number(),
          col: v.number(),
          originalValue: v.string(),
          newValue: v.string(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const file = await ctx.db.get(args.fileId) as Doc<"files"> | null;
    if (!file) throw new Error("File not found");
    if (file.userId !== userId) throw new Error("Not authorized to modify this file");

    await ctx.db.patch(args.fileId, {
      storageId: args.newStorageId,
      fileSize: args.newFileSize,
      lastModified: Date.now(),
      modificationCount: ((file as any).modificationCount || 0) + 1,
    });

    console.log(`CSV storage replaced for file ${args.fileId}`, {
      userId,
      newStorageId: args.newStorageId,
      newSize: args.newFileSize,
      cellsModified: args.modifiedCells?.length ?? 0,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

// Finalize an Excel (XLSX) replacement by updating the file's storageId and metadata
export const finalizeExcelReplace = mutation({
  args: {
    fileId: v.id("files"),
    newStorageId: v.string(),
    newFileSize: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const file = await ctx.db.get(args.fileId) as Doc<"files"> | null;
    if (!file) throw new Error("File not found");
    if (file.userId !== userId) throw new Error("Not authorized to modify this file");

    await ctx.db.patch(args.fileId, {
      storageId: args.newStorageId,
      fileSize: args.newFileSize,
      lastModified: Date.now(),
      modificationCount: ((file as any).modificationCount || 0) + 1,
    });

    console.log(`XLSX storage replaced for file ${args.fileId}`, {
      userId,
      newStorageId: args.newStorageId,
      newSize: args.newFileSize,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});


export const createFile = mutation({
  args: {
    storageId: v.string(),
    fileName: v.string(),
    fileType: v.string(),
    mimeType: v.string(),
    fileSize: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Create the file record first
    const fileId = await ctx.db.insert("files", {
      userId,
      storageId: args.storageId,
      fileName: args.fileName,
      fileType: args.fileType,
      mimeType: args.mimeType,
      fileSize: args.fileSize,
    });

    // Automatically create a corresponding file document
    let documentFileType = "unknown";
    if (args.mimeType?.includes("text/csv") || args.fileName?.endsWith(".csv")) {
      documentFileType = "csv";
    } else if (args.mimeType?.includes("application/pdf")) {
      documentFileType = "pdf";
    } else if (args.mimeType?.startsWith("image/")) {
      documentFileType = "image";
    } else if (args.mimeType?.startsWith("video/")) {
      documentFileType = "video";
    } else if (args.mimeType?.startsWith("audio/")) {
      documentFileType = "audio";
    } else if (args.mimeType?.includes("text/")) {
      documentFileType = "text";
    }

    const now = Date.now();

    // Auto-create the file document
    const documentId = await ctx.db.insert("documents", {
      title: args.fileName,
      isPublic: false,
      createdBy: userId,
      lastEditedBy: userId,
      documentType: "file",
      fileId: fileId,
      fileType: documentFileType,
      mimeType: args.mimeType,
      lastModified: now,
    });

    // Schedule smart date extraction as background job
    await ctx.scheduler.runAfter(0, internal.domains.documents.smartDateExtraction.extractAndMarkDates, {
      fileId,
      documentId,
      userId,
    });

    return fileId;
  },
});

export const getFile = internalQuery({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.fileId);
  },
});

export const updateFileAnalysis = internalMutation({
  args: {
    fileId: v.id("files"),
    analysis: v.string(),
    structuredData: v.optional(v.any()),
    analysisType: v.string(),
    processingTime: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.fileId, {
      analysis: args.analysis,
      structuredData: args.structuredData,
      analysisType: args.analysisType,
      processingTime: args.processingTime,
      analyzedAt: Date.now(),
    });
  },
});

export const getRecentAnalyses = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const limit = args.limit || 10;
    const files = await ctx.db
      .query("files")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .filter((q) => q.neq(q.field("analysis"), undefined))
      .order("desc")
      .take(limit);

    return files.map((file) => ({
      _id: file._id,
      fileName: file.fileName,
      fileType: file.fileType,
      analyzedAt: file.analyzedAt,
      result: file.analysis || "",
    }));
  },
});

export const getUserFiles = query({
  args: {
    fileType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    let query = ctx.db
      .query("files")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject));

    if (args.fileType) {
      const fileType = args.fileType; // Type narrowing assignment
      query = ctx.db
        .query("files")
        .withIndex("by_user_and_type", (q) =>
          q.eq("userId", identity.subject).eq("fileType", fileType)
        );
    }

    const files = await query
      .order("desc")
      .take(args.limit || 50);

    return files;
  },
});
export const renameFile = mutation({
  args: {
    fileId: v.id("files"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const file = await ctx.db.get(args.fileId) as Doc<"files"> | null;
    if (!file) {
      throw new Error("File not found");
    }

    if (file.userId !== userId) {
      throw new Error("Not authorized to rename this file");
    }

    await ctx.db.patch(args.fileId, {
      fileName: args.fileName,
      lastModified: Date.now(),
    });

    return { success: true };
  },
});

// Legacy function for backward compatibility
export const listRecentFiles = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    const limit = args.limit || 10;
    const files = await ctx.db
      .query("files")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .filter((q) => q.neq(q.field("analysis"), undefined))
      .order("desc")
      .take(limit);

    return files.map((file) => ({
      _id: file._id,
      fileName: file.fileName,
      fileType: file.fileType,
      analyzedAt: file.analyzedAt,
      result: file.analysis || "",
    }));
  },
});

// URL Analysis functions
export const createUrlAnalysis = internalMutation({
  args: {
    url: v.string(),
    analysis: v.optional(v.string()),
    structuredData: v.optional(v.any()),
    contentType: v.optional(v.string()),
    analysisType: v.optional(v.string()),
    processingTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const analysisId = await ctx.db.insert("urlAnalyses", {
      userId: identity.subject,
      url: args.url,
      analysis: args.analysis,
      structuredData: args.structuredData,
      analyzedAt: Date.now(),
      contentType: args.contentType,
    });

    return analysisId;
  },
});

export const getUrlAnalyses = query({
  args: {
    limit: v.optional(v.number()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }

    let query = ctx.db
      .query("urlAnalyses")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject));

    if (args.url) {
      const url = args.url; // Type narrowing assignment
      query = ctx.db
        .query("urlAnalyses")
        .withIndex("by_url", (q) => q.eq("url", url))
        .filter((q) => q.eq(q.field("userId"), identity.subject));
    }

    const analyses = await query
      .order("desc")
      .take(args.limit || 20);

    return analyses;
  },
});

// Update CSV file content
export const updateCsvContent = mutation({
  args: {
    fileId: v.id("files"),
    csvContent: v.string(),
    modifiedCells: v.array(v.object({
      row: v.number(),
      col: v.number(),
      originalValue: v.string(),
      newValue: v.string()
    }))
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Get the existing file
    const file = await ctx.db.get(args.fileId) as Doc<"files"> | null;
    if (!file) {
      throw new Error("File not found");
    }

    // Verify ownership
    if (file.userId !== userId) {
      throw new Error("Not authorized to modify this file");
    }

    // For now, we'll just update the modification tracking
    // In a full implementation, you'd need to handle file storage through upload URLs
    const contentSize = new TextEncoder().encode(args.csvContent).length;

    // Update the file record with modification tracking
    await ctx.db.patch(args.fileId, {
      // Keep existing storageId for now - would need proper file replacement in production
      fileSize: contentSize,
      lastModified: Date.now(),
      modificationCount: ((file as any).modificationCount || 0) + 1
    });

    // Log the modification details for audit trail
    console.log(`CSV file ${args.fileId} updated:`, {
      cellsModified: args.modifiedCells.length,
      userId,
      timestamp: Date.now(),
      newSize: contentSize
    });

    return {
      success: true,
      fileId: args.fileId,
      modifiedCells: args.modifiedCells.length,
      contentSize
    };
  },
});

// Prepare CSV export data (client will handle the actual file creation)
export const prepareCsvExport = mutation({
  args: {
    originalFileId: v.id("files"),
    csvContent: v.string(),
    newFileName: v.string()
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Get the original file for reference
    const originalFile = await ctx.db.get(args.originalFileId) as Doc<"files"> | null;
    if (!originalFile) {
      throw new Error("Original file not found");
    }

    // Verify ownership
    if (originalFile.userId !== userId) {
      throw new Error("Not authorized to export this file");
    }

    const contentSize = new TextEncoder().encode(args.csvContent).length;

    // Log the export for audit trail
    console.log(`CSV export prepared:`, {
      originalFileId: args.originalFileId,
      newFileName: args.newFileName,
      userId,
      contentSize,
      timestamp: Date.now()
    });

    return {
      success: true,
      originalFileName: originalFile.fileName,
      newFileName: args.newFileName,
      contentSize,
      csvContent: args.csvContent
    };
  },
});

// Storage URL helper
export const getUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});
