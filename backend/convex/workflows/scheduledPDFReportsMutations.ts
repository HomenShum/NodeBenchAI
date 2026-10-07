/**
 * Scheduled PDF Reports - Mutations
 *
 * Database mutations for scheduled PDF report generation.
 * Separated from the main file because mutations cannot be in "use node" files.
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * Create report record for scheduled PDF report
 * Uses the scheduledReports table (simpler schema for automated reports)
 */
export const createScheduledReportDocument = internalMutation({
  args: {
    storageId: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    reportType: v.string(),
    title: v.string(),
    description: v.string(),
    metadata: v.object({
      quarterLabel: v.string(),
      totalDeals: v.number(),
      totalAmountUsd: v.number(),
      generatedAt: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Store in scheduledReports table (simple schema for automated reports)
    const reportId = await ctx.db.insert("scheduledReports", {
      storageId: args.storageId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      reportType: args.reportType,
      title: args.title,
      description: args.description,
      quarterLabel: args.metadata.quarterLabel,
      totalDeals: args.metadata.totalDeals,
      totalAmountUsd: args.metadata.totalAmountUsd,
      generatedAt: now,
      status: "completed",
    });

    return { documentId: reportId };
  },
});
