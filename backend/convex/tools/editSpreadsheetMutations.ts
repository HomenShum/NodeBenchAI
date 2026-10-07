// convex/tools/editSpreadsheetMutations.ts
// Internal mutations and queries for spreadsheet operations

import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { Doc } from "../_generated/dataModel";
import {
  SPREADSHEET_OPERATION_TYPES,
  isSpreadsheetOperationType,
} from "./spreadsheetOperationTypes";

/**
 * Get a spreadsheet by ID
 */
export const getSpreadsheet = internalQuery({
  args: {
    spreadsheetId: v.id("spreadsheets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.spreadsheetId) as Doc<"spreadsheets"> | null;
  },
});

/**
 * Get all cells for a spreadsheet
 */
export const getSpreadsheetCells = internalQuery({
  args: {
    spreadsheetId: v.id("spreadsheets"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sheetCells")
      .withIndex("by_sheet", q => q.eq("sheetId", args.spreadsheetId))
      .collect() as Doc<"sheetCells">[];
  },
});

/**
 * Store a spreadsheet edit event for audit trail
 */
export const storeSpreadsheetEvent = internalMutation({
  args: {
    spreadsheetId: v.string(),
    operations: v.any(),
    changes: v.any(),
    validationErrors: v.array(v.string()),
    description: v.optional(v.string()),
    threadId: v.optional(v.string()),
    runId: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Determine the primary operation type from the first operation, then HARD-VALIDATE it
    // against the schema union before it can be inserted. Previously this fell back to
    // "unknown" — a value NOT in spreadsheetEvents.operation — so any op missing a `.type`
    // would have written a document that fails `convex deploy` schema validation and aborts
    // ALL prod deploys (the 2026-06-03 row_delta incident class). Reject out-of-union values
    // at the boundary so a bad value can never reach the table.
    const firstOp = Array.isArray(args.operations) ? args.operations[0] : undefined;
    const operationType = firstOp?.type;
    if (!isSpreadsheetOperationType(operationType)) {
      throw new Error(
        `[storeSpreadsheetEvent] operation type ${JSON.stringify(operationType)} is not a known ` +
          `spreadsheetEvents.operation (${SPREADSHEET_OPERATION_TYPES.join(", ")}). Refusing to ` +
          `insert an out-of-schema value — it would break the production Convex deploy.`,
      );
    }

    // Build the event payload
    const eventData: any = {
      spreadsheetId: args.spreadsheetId,
      operation: operationType,
      payload: {
        operations: args.operations,
        changes: args.changes,
        description: args.description,
      },
      status: args.validationErrors.length > 0 ? "failed" : "applied",
      createdAt: now,
    };

    if (args.validationErrors.length > 0) {
      eventData.validationErrors = args.validationErrors;
    }

    if (args.threadId) eventData.threadId = args.threadId;
    if (args.runId) eventData.runId = args.runId;
    if (args.userId) eventData.userId = args.userId;

    // Calculate a target range from operations
    let minRow = Infinity, maxRow = -Infinity;
    let minCol = Infinity, maxCol = -Infinity;

    for (const op of args.operations) {
      if (typeof op.row === "number") {
        minRow = Math.min(minRow, op.row);
        maxRow = Math.max(maxRow, op.row);
      }
      if (typeof op.col === "number") {
        minCol = Math.min(minCol, op.col);
        maxCol = Math.max(maxCol, op.col);
      }
      if (typeof op.atRow === "number") {
        minRow = Math.min(minRow, op.atRow);
        maxRow = Math.max(maxRow, op.atRow);
      }
      if (typeof op.atCol === "number") {
        minCol = Math.min(minCol, op.atCol);
        maxCol = Math.max(maxCol, op.atCol);
      }
    }

    if (minRow !== Infinity && minCol !== Infinity) {
      const startCol = String.fromCharCode(65 + minCol);
      const endCol = String.fromCharCode(65 + maxCol);
      eventData.targetRange = `${startCol}${minRow + 1}:${endCol}${maxRow + 1}`;
    }

    const id = await ctx.db.insert("spreadsheetEvents", eventData);

    console.log("[storeSpreadsheetEvent] Event stored", {
      id,
      spreadsheetId: args.spreadsheetId,
      operation: operationType,
      status: eventData.status,
    });

    return id;
  },
});

/**
 * Get recent events for a spreadsheet
 */
export const getSpreadsheetEvents = internalQuery({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;

    return await ctx.db
      .query("spreadsheetEvents")
      .withIndex("by_spreadsheet", q => q.eq("spreadsheetId", args.spreadsheetId))
      .order("desc")
      .take(limit) as Doc<"spreadsheetEvents">[];
  },
});

/**
 * Apply cell changes to the spreadsheet (creates new version)
 */
export const applyCellChanges = internalMutation({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    changes: v.array(v.object({
      row: v.number(),
      col: v.number(),
      value: v.string(),
      type: v.optional(v.string()),
    })),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    for (const change of args.changes) {
      // Check if cell exists
      const existing = await ctx.db
        .query("sheetCells")
        .withIndex("by_sheet_row_col", q =>
          q.eq("sheetId", args.spreadsheetId)
            .eq("row", change.row)
            .eq("col", change.col)
        )
        .first() as Doc<"sheetCells"> | null;

      if (existing) {
        // Update existing cell
        await ctx.db.patch(existing._id, {
          value: change.value,
          type: change.type || existing.type,
          updatedAt: now,
          updatedBy: args.userId,
        });
      } else {
        // Create new cell
        await ctx.db.insert("sheetCells", {
          sheetId: args.spreadsheetId,
          row: change.row,
          col: change.col,
          value: change.value,
          type: change.type || "text",
          updatedAt: now,
          updatedBy: args.userId,
        });
      }
    }

    // Update spreadsheet timestamp
    await ctx.db.patch(args.spreadsheetId, {
      updatedAt: now,
    });

    return { updated: args.changes.length };
  },
});
