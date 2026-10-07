/**
 * Smart Date Extraction - Automatically detect dates from uploaded files
 * 
 * Features:
 * - Extract dates from filenames (e.g., "Invoice_Dec12.pdf", "Report_2024-01-15.xlsx")
 * - Create calendar markers for detected dates
 * - Run as background job after file upload
 */

import { v } from "convex/values";
import { query, internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc } from "../../_generated/dataModel";

// Common date patterns in filenames
const DATE_PATTERNS = [
  // ISO format: 2024-01-15, 2024_01_15, 20240115
  /(\d{4})[-_]?(\d{2})[-_]?(\d{2})/,
  // US format: 01-15-2024, 01_15_2024, 01152024
  /(\d{2})[-_]?(\d{2})[-_]?(\d{4})/,
  // Month name: Dec12, December12, Dec-12, Dec_12
  /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-_]?(\d{1,2})/i,
  // Day Month: 12Dec, 12-Dec, 12_December
  /(\d{1,2})[-_]?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*/i,
  // Q1, Q2, Q3, Q4 with year: Q1_2024, Q12024
  /Q([1-4])[-_]?(\d{4})/i,
  // Year only: 2024, FY2024, FY24
  /(?:FY)?(\d{4})/i,
];

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

interface ExtractedDate {
  date: Date;
  confidence: 'high' | 'medium' | 'low';
  source: 'filename' | 'content';
  pattern: string;
}

/**
 * Extract dates from a filename
 */
function extractDatesFromFilename(filename: string): ExtractedDate[] {
  const results: ExtractedDate[] = [];
  const baseName = filename.replace(/\.[^.]+$/, ''); // Remove extension
  const currentYear = new Date().getFullYear();

  // Try ISO format: 2024-01-15
  const isoMatch = baseName.match(/(\d{4})[-_](\d{2})[-_](\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (isValidDate(date)) {
      results.push({ date, confidence: 'high', source: 'filename', pattern: 'ISO' });
    }
  }

  // Try US format: 01-15-2024
  const usMatch = baseName.match(/(\d{2})[-_](\d{2})[-_](\d{4})/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (isValidDate(date)) {
      results.push({ date, confidence: 'high', source: 'filename', pattern: 'US' });
    }
  }

  // Try Month name with day: Dec12, December12
  const monthDayMatch = baseName.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-_]?(\d{1,2})/i);
  if (monthDayMatch) {
    const [, monthStr, dayStr] = monthDayMatch;
    const month = MONTH_MAP[monthStr.toLowerCase()];
    const day = parseInt(dayStr);
    if (month !== undefined && day >= 1 && day <= 31) {
      // Assume current year if not specified
      const date = new Date(currentYear, month, day);
      if (isValidDate(date)) {
        results.push({ date, confidence: 'medium', source: 'filename', pattern: 'MonthDay' });
      }
    }
  }

  // Try Day Month: 12Dec, 12-December
  const dayMonthMatch = baseName.match(/(\d{1,2})[-_]?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*/i);
  if (dayMonthMatch) {
    const [, dayStr, monthStr] = dayMonthMatch;
    const month = MONTH_MAP[monthStr.toLowerCase()];
    const day = parseInt(dayStr);
    if (month !== undefined && day >= 1 && day <= 31) {
      const date = new Date(currentYear, month, day);
      if (isValidDate(date)) {
        results.push({ date, confidence: 'medium', source: 'filename', pattern: 'DayMonth' });
      }
    }
  }

  // Try Quarter format: Q1_2024
  const quarterMatch = baseName.match(/Q([1-4])[-_]?(\d{4})/i);
  if (quarterMatch) {
    const [, quarter, year] = quarterMatch;
    const quarterStartMonth = (parseInt(quarter) - 1) * 3;
    const date = new Date(parseInt(year), quarterStartMonth, 1);
    if (isValidDate(date)) {
      results.push({ date, confidence: 'medium', source: 'filename', pattern: 'Quarter' });
    }
  }

  return results;
}

function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime()) && 
         date.getFullYear() >= 2000 && date.getFullYear() <= 2100;
}

/**
 * Internal query to get file info
 */
export const getFileInfo = internalQuery({
  args: { fileId: v.id("files") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.fileId);
  },
});

/**
 * Internal mutation to create a calendar marker for a detected date
 */
export const createDateMarker = internalMutation({
  args: {
    userId: v.id("users"),
    documentId: v.id("documents"),
    fileName: v.string(),
    detectedDate: v.number(), // timestamp
    confidence: v.string(),
    pattern: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if a marker already exists for this document and date
    const existingMarker = await ctx.db
      .query("calendarDateMarkers")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .first() as Doc<"calendarDateMarkers"> | null;

    if (existingMarker) {
      // Update existing marker
      await ctx.db.patch(existingMarker._id, {
        detectedDate: args.detectedDate,
        confidence: args.confidence,
        pattern: args.pattern,
        updatedAt: Date.now(),
      });
      return existingMarker._id;
    }

    // Create new marker
    const markerId = await ctx.db.insert("calendarDateMarkers", {
      userId: args.userId,
      documentId: args.documentId,
      fileName: args.fileName,
      detectedDate: args.detectedDate,
      confidence: args.confidence,
      pattern: args.pattern,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return markerId;
  },
});

/**
 * Internal action to extract dates from a file and create calendar markers
 */
export const extractAndMarkDates = internalAction({
  args: {
    fileId: v.id("files"),
    documentId: v.id("documents"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    console.log(`[smartDateExtraction] Processing file ${args.fileId}`);

    // Get file info
    const file = await ctx.runQuery(internal.domains.documents.smartDateExtraction.getFileInfo, {
      fileId: args.fileId,
    });

    if (!file) {
      console.log(`[smartDateExtraction] File not found: ${args.fileId}`);
      return { success: false, error: "File not found" };
    }

    // Extract dates from filename
    const extractedDates = extractDatesFromFilename(file.fileName);

    if (extractedDates.length === 0) {
      console.log(`[smartDateExtraction] No dates found in filename: ${file.fileName}`);
      return { success: true, datesFound: 0 };
    }

    // Use the highest confidence date
    const bestDate = extractedDates.sort((a, b) => {
      const confidenceOrder = { high: 0, medium: 1, low: 2 };
      return confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    })[0];

    console.log(`[smartDateExtraction] Found date: ${bestDate.date.toISOString()} (${bestDate.confidence} confidence, ${bestDate.pattern} pattern)`);

    // Create calendar marker
    await ctx.runMutation(internal.domains.documents.smartDateExtraction.createDateMarker, {
      userId: args.userId,
      documentId: args.documentId,
      fileName: file.fileName,
      detectedDate: bestDate.date.getTime(),
      confidence: bestDate.confidence,
      pattern: bestDate.pattern,
    });

    return {
      success: true,
      datesFound: extractedDates.length,
      markedDate: bestDate.date.toISOString(),
      confidence: bestDate.confidence,
    };
  },
});

/**
 * Public query to get date markers for a date range (for calendar display)
 */
export const getDateMarkersForRange = query({
  args: {
    startDate: v.number(), // timestamp
    endDate: v.number(),   // timestamp
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get all markers for this user within the date range
    const markers = await ctx.db
      .query("calendarDateMarkers")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", userId)
          .gte("detectedDate", args.startDate)
          .lte("detectedDate", args.endDate)
      )
      .collect();

    // Enrich with document info
    const enrichedMarkers = await Promise.all(
      markers.map(async (marker) => {
        const doc = await ctx.db.get(marker.documentId) as Doc<"documents"> | null;
        return {
          ...marker,
          documentTitle: doc?.title || marker.fileName,
          documentType: doc?.documentType,
          fileType: doc?.fileType,
        };
      })
    );

    return enrichedMarkers;
  },
});

/**
 * Public query to get all date markers for a specific date
 */
export const getDateMarkersForDate = query({
  args: {
    date: v.number(), // timestamp for start of day
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get markers for this specific day (within 24 hours)
    const dayStart = args.date;
    const dayEnd = args.date + 24 * 60 * 60 * 1000;

    const markers = await ctx.db
      .query("calendarDateMarkers")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", userId)
          .gte("detectedDate", dayStart)
          .lt("detectedDate", dayEnd)
      )
      .collect();

    // Enrich with document info
    const enrichedMarkers = await Promise.all(
      markers.map(async (marker) => {
        const doc = await ctx.db.get(marker.documentId) as Doc<"documents"> | null;
        return {
          ...marker,
          documentTitle: doc?.title || marker.fileName,
          documentType: doc?.documentType,
          fileType: doc?.fileType,
        };
      })
    );

    return enrichedMarkers;
  },
});
