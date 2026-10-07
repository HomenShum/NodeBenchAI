// convex/fileQueries.ts
import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";

// Query to get a file with security check
export const getFileForAnalysis = internalQuery({
  args: {
    fileId: v.id("files"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId) as Doc<"files"> | null;
    if (!file || file.userId !== args.userId) {
      return null;
    }
    return file;
  },
});

// Create a URL record for analysis tracking
export const createUrlRecord = internalMutation({
  args: {
    url: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const existingRecord = await ctx.db
      .query("urlAnalyses")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first() as Doc<"urlAnalyses"> | null;

    if (existingRecord) {
      return existingRecord._id;
    }
    
    // Create a placeholder file record for URL analysis
    const fileId = await ctx.db.insert("files", {
      userId: args.userId,
      storageId: "", // No storage for URLs
      fileName: args.url,
      fileType: "url",
      mimeType: "text/html",
      fileSize: 0,
    });
    
    return fileId;
  },
});

// Find an existing URL record
export const findUrlRecord = internalQuery({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("files")
      .filter((q) =>
        q.and(
          q.eq(q.field("fileName"), args.url),
          q.eq(q.field("fileType"), "url")
        )
      )
      .first() as Doc<"files"> | null;

    return record?._id || null;
  },
});

// Save analysis results
export const saveFileAnalysisResults = internalMutation({
  args: {
    fileId: v.id("files"),
    userId: v.string(),
    analysis: v.string(),
    structuredData: v.optional(v.any()),
    analysisType: v.string(),
    processingTime: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Verify ownership
    const file = await ctx.db.get(args.fileId) as Doc<"files"> | null;
    if (!file || file.userId !== args.userId) {
      throw new Error("File not found or unauthorized");
    }

    // Update the file record with analysis results
    await ctx.db.patch(args.fileId, {
      analysis: args.analysis,
      structuredData: args.structuredData,
      analysisType: args.analysisType,
      processingTime: args.processingTime,
      analyzedAt: args.createdAt,
    });

    // If this is a URL analysis, also update the urlAnalyses table
    if (file.fileType === "url") {
      const urlAnalysis = await ctx.db
        .query("urlAnalyses")
        .withIndex("by_url", (q) => q.eq("url", file.fileName))
        .filter((q) => q.eq(q.field("userId"), args.userId))
        .first() as Doc<"urlAnalyses"> | null;

      if (urlAnalysis) {
        await ctx.db.patch(urlAnalysis._id, {
          analysis: args.analysis,
          structuredData: args.structuredData,
          analyzedAt: args.createdAt,
        });
      } else {
        await ctx.db.insert("urlAnalyses", {
          userId: args.userId,
          url: file.fileName,
          analysis: args.analysis,
          structuredData: args.structuredData,
          analyzedAt: args.createdAt,
          contentType: file.mimeType,
        });
      }
    }
  },
});

// Save analysis error
export const saveFileAnalysisError = internalMutation({
  args: {
    fileId: v.id("files"),
    userId: v.string(),
    error: v.string(),
    analysisType: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Verify ownership
    const file = await ctx.db.get(args.fileId) as Doc<"files"> | null;
    if (!file || file.userId !== args.userId) {
      return; // Silently fail for error logging
    }

    // Store error in the file record
    await ctx.db.patch(args.fileId, {
      analysis: `Error: ${args.error}`,
      analysisType: args.analysisType,
      analyzedAt: args.createdAt,
    });
  },
});

// Fetch latest URL analysis for a user (reader cache)
export const getUrlAnalysisForUser = internalQuery({
  args: {
    url: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("urlAnalyses")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .order("desc")
      .first();
  },
});

// Upsert URL analysis for a user (reader cache)
export const upsertUrlAnalysisForUser = internalMutation({
  args: {
    url: v.string(),
    userId: v.string(),
    analysis: v.string(),
    structuredData: v.optional(v.any()),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("urlAnalyses")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first() as Doc<"urlAnalyses"> | null;

    const analyzedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        analysis: args.analysis,
        structuredData: args.structuredData,
        analyzedAt,
        contentType: args.contentType ?? existing.contentType,
      });
      return existing._id;
    }

    return await ctx.db.insert("urlAnalyses", {
      userId: args.userId,
      url: args.url,
      analysis: args.analysis,
      structuredData: args.structuredData,
      analyzedAt,
      contentType: args.contentType,
    });
  },
});
