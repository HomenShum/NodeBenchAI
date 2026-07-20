/**
 * Report Documents
 *
 * Mutations for saving generated PDF reports to the Documents Hub.
 * Enables storing quarterly summaries, company dossiers, and weekly digests.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id, Doc } from "../../_generated/dataModel";

/**
 * Report type validator
 */
const reportTypeValidator = v.union(
  v.literal("quarterly-funding-summary"),
  v.literal("company-dossier"),
  v.literal("weekly-digest"),
  v.literal("custom-report")
);

/**
 * Create a generated report document.
 * Called after uploading the PDF blob to Convex storage.
 */
export const createReportDocument = mutation({
  args: {
    storageId: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    reportType: reportTypeValidator,
    title: v.string(),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    metadata: v.optional(
      v.object({
        quarterLabel: v.optional(v.string()),
        companyName: v.optional(v.string()),
        weekLabel: v.optional(v.string()),
        persona: v.optional(v.string()),
        totalDeals: v.optional(v.number()),
        totalAmountUsd: v.optional(v.number()),
        generatedAt: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const now = Date.now();

    // Create file record
    const fileId = await ctx.db.insert("files", {
      userId,
      storageId: args.storageId,
      fileName: args.fileName,
      fileType: "pdf",
      mimeType: "application/pdf",
      fileSize: args.fileSize,
    });

    // Build tags array
    const baseTags = ["report", "generated"];
    const reportTypeTags: Record<string, string[]> = {
      "quarterly-funding-summary": ["funding", "quarterly", "summary"],
      "company-dossier": ["dossier", "company", "research"],
      "weekly-digest": ["digest", "weekly", "intelligence"],
      "custom-report": ["custom"],
    };
    const allTags = [
      ...baseTags,
      ...reportTypeTags[args.reportType],
      ...(args.tags || []),
    ];

    // Create document record
    const documentId = await ctx.db.insert("documents", {
      title: args.title,
      isPublic: false,
      createdBy: userId,
      lastEditedBy: userId,
      documentType: "file",
      fileId: fileId,
      fileType: "pdf",
      mimeType: "application/pdf",
      lastModified: now,
      tags: allTags,
      // Store report metadata in content for searchability
      content: JSON.stringify({
        type: "report",
        reportType: args.reportType,
        description: args.description,
        metadata: args.metadata,
        generatedAt: now,
      }),
      contentPreview: args.description || `${args.reportType} report generated on ${new Date().toLocaleDateString()}`,
    });

    console.log(`[reportDocuments] Created report document: ${documentId}`, {
      reportType: args.reportType,
      fileName: args.fileName,
      userId,
    });

    return {
      documentId,
      fileId,
      success: true,
    };
  },
});

/**
 * Get recent generated reports.
 */
export const getRecentReports = query({
  args: {
    limit: v.optional(v.number()),
    reportType: v.optional(reportTypeValidator),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const limit = args.limit ?? 20;

    // Query documents with report tag
    let documents = await ctx.db
      .query("documents")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .order("desc")
      .filter((q) =>
        q.and(
          q.eq(q.field("documentType"), "file"),
          q.eq(q.field("fileType"), "pdf")
        )
      )
      .take(limit * 2); // Get more to filter

    // Filter for reports (have 'report' tag)
    documents = documents.filter((doc) =>
      doc.tags?.includes("report") && doc.tags?.includes("generated")
    );

    // Further filter by report type if specified
    if (args.reportType) {
      const typeTag = args.reportType.split("-").pop() || "";
      documents = documents.filter((doc) =>
        doc.tags?.includes(typeTag)
      );
    }

    // Get file URLs
    const result = await Promise.all(
      documents.slice(0, limit).map(async (doc) => {
        let fileUrl = null;
        if (doc.fileId) {
          const file = await ctx.db.get(doc.fileId) as Doc<"files"> | null;
          if (file?.storageId) {
            fileUrl = await ctx.storage.getUrl(file.storageId);
          }
        }

        // Parse metadata from content
        let metadata = null;
        try {
          if (doc.content) {
            const parsed = JSON.parse(doc.content);
            metadata = parsed.metadata;
          }
        } catch {
          // Ignore parse errors
        }

        return {
          id: doc._id,
          title: doc.title,
          fileUrl,
          tags: doc.tags,
          lastModified: doc.lastModified,
          metadata,
        };
      })
    );

    return result;
  },
});

/**
 * Get a single report document with file URL.
 */
export const getReportDocument = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId) as Doc<"documents"> | null;
    if (!doc) {
      return null;
    }

    let fileUrl = null;
    if (doc.fileId) {
      const file = await ctx.db.get(doc.fileId as Id<"files">) as Doc<"files"> | null;
      if (file?.storageId) {
        fileUrl = await ctx.storage.getUrl(file.storageId);
      }
    }

    return {
      ...doc,
      fileUrl,
    };
  },
});
