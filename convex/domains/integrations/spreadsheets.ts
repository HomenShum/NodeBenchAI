import { v } from "convex/values";
import { internalMutation, mutation, query } from "../../_generated/server";
import { Doc, Id } from "../../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  applySpreadsheetRowDelta,
  type SpreadsheetCellValue,
  type SpreadsheetRowDeltaOperation,
} from "./spreadsheetDelta";

const MAX_ROW_DELTA_CELLS = 500;

const cellValueValidator = v.union(v.string(), v.number(), v.null());

function toStoredCellValue(value: SpreadsheetCellValue): string {
  if (value === null) return "";
  return String(value);
}

function toStoredCellType(value: SpreadsheetCellValue, type?: string): string {
  if (type) return type;
  if (value === null) return "blank";
  if (typeof value === "number") return "number";
  return "text";
}

function fromStoredCellValue(cell: Doc<"sheetCells"> | undefined): SpreadsheetCellValue {
  if (!cell) return null;
  if (cell.type === "blank") return null;
  return cell.value ?? null;
}

function colToLetter(col: number): string {
  let letter = "";
  let temp = col;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

async function getSafeUserId(ctx: any): Promise<Id<"users">> {
  // Support evaluation mode where userId is passed in ctx.evaluationUserId
  if ((ctx).evaluationUserId) {
    return (ctx).evaluationUserId as Id<"users">;
  }
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

// Validators for spreadsheet operations
const setCellValidator = v.object({
  op: v.literal("setCell"),
  row: v.number(),
  col: v.number(),
  value: cellValueValidator,
  type: v.optional(v.string()),
  comment: v.optional(v.string()),
});

const clearCellValidator = v.object({
  op: v.literal("clearCell"),
  row: v.number(),
  col: v.number(),
});

const setRangeValidator = v.object({
  op: v.literal("setRange"),
  startRow: v.number(),
  endRow: v.number(),
  startCol: v.number(),
  endCol: v.number(),
  // Provide either a constant value or a 2D values array
  value: v.optional(cellValueValidator),
  values: v.optional(v.array(v.array(cellValueValidator))),
});

const rowDeltaOperationValidator = v.union(
  v.object({
    op: v.literal("insert"),
    index: v.number(),
    value: cellValueValidator,
  }),
  v.object({
    op: v.literal("delete"),
    index: v.number(),
  }),
  v.object({
    op: v.literal("set"),
    index: v.number(),
    value: cellValueValidator,
  }),
);

const operationValidator = v.union(setCellValidator, clearCellValidator, setRangeValidator);

export const createSheet = mutation({
  args: { name: v.string() },
  returns: v.id("spreadsheets"),
  handler: async (ctx, { name }): Promise<Id<"spreadsheets">> => {
    const userId = await getSafeUserId(ctx);

    const now = Date.now();
    const sheetId = await ctx.db.insert("spreadsheets", {
      name,
      userId,
      createdAt: now,
      updatedAt: now,
    });
    return sheetId;
  },
});

// Internal helper for system/agent flows that already know the userId (or guest users).
export const createSheetForUser = internalMutation({
  args: { name: v.string(), userId: v.optional(v.id("users")) },
  returns: v.id("spreadsheets"),
  handler: async (ctx, { name, userId }): Promise<Id<"spreadsheets">> => {
    const now = Date.now();
    return await ctx.db.insert("spreadsheets", {
      name,
      userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const listSheets = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    // Return empty array for unauthenticated users (guest mode)
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const limit = Math.max(1, Math.min(args.limit ?? 25, 100));

    const sheets = await ctx.db
      .query("spreadsheets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100) as Doc<"spreadsheets">[];

    sheets.sort((a: Doc<"spreadsheets">, b: Doc<"spreadsheets">) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return sheets.slice(0, limit);
  },
});

export const getSheet = query({
  args: { sheetId: v.id("spreadsheets") },
  returns: v.any(),
  handler: async (ctx, { sheetId }) => {
    const userId = await getSafeUserId(ctx);
    const sheet = await ctx.db.get(sheetId) as Doc<"spreadsheets"> | null;
    if (!sheet) return null;
    if (sheet.userId !== userId) throw new Error("Not authorized");
    return sheet;
  },
});

export const getRange = query({
  args: {
    sheetId: v.id("spreadsheets"),
    startRow: v.number(),
    endRow: v.number(),
    startCol: v.number(),
    endCol: v.number(),
  },
  returns: v.array(
    v.object({
      row: v.number(),
      col: v.number(),
      value: v.optional(v.string()),
      type: v.optional(v.string()),
      comment: v.optional(v.string()),
      _id: v.id("sheetCells"),
    })
  ),
  handler: async (ctx, { sheetId, startRow, endRow, startCol, endCol }) => {
    if (startRow > endRow || startCol > endCol) return [];

    // Fetch rows in range using the index prefix (sheetId, row)
    const rows = await ctx.db
      .query("sheetCells")
      .withIndex("by_sheet_row_col", (q) =>
        q.eq("sheetId", sheetId).gte("row", startRow).lte("row", endRow)
      )
      .collect() as Doc<"sheetCells">[];

    // Filter columns in JS (Convex best practice prefers indices, but this is acceptable for small ranges)
    return rows
      .filter((c: Doc<"sheetCells">) => c.col >= startCol && c.col <= endCol)
      .map((c: Doc<"sheetCells">) => ({
        _id: c._id,
        row: c.row,
        col: c.col,
        value: c.value,
        type: c.type,
        comment: c.comment,
      }));
  },
});

export const applyOperations = mutation({
  args: {
    sheetId: v.id("spreadsheets"),
    operations: v.array(operationValidator),
  },
  returns: v.object({
    applied: v.number(),
    errors: v.number(),
  }),
  handler: async (ctx, { sheetId, operations }) => {
    const sheet = await ctx.db.get(sheetId) as Doc<"spreadsheets"> | null;
    if (!sheet) throw new Error("Sheet not found");

    let applied = 0;
    let errors = 0;
    const now = Date.now();

    for (const op of operations) {
      try {
        if (op.op === "setCell") {
          const value = toStoredCellValue(op.value);
          const type = toStoredCellType(op.value, op.type);
          const existing = await ctx.db
            .query("sheetCells")
            .withIndex("by_sheet_row_col", (q) =>
              q.eq("sheetId", sheetId).eq("row", op.row).eq("col", op.col)
            )
            .first() as Doc<"sheetCells"> | null;

          if (existing) {
            await ctx.db.patch(existing._id, {
              value,
              type,
              comment: op.comment,
              updatedAt: now,
            });
          } else {
            await ctx.db.insert("sheetCells", {
              sheetId,
              row: op.row,
              col: op.col,
              value,
              type,
              comment: op.comment,
              updatedAt: now,
            });
          }
          applied++;
        } else if (op.op === "clearCell") {
          const existing = await ctx.db
            .query("sheetCells")
            .withIndex("by_sheet_row_col", (q) =>
              q.eq("sheetId", sheetId).eq("row", op.row).eq("col", op.col)
            )
            .first() as Doc<"sheetCells"> | null;

          if (existing) {
            await ctx.db.patch(existing._id, {
              value: undefined,
              type: undefined,
              comment: undefined,
              updatedAt: now,
            });
          }
          applied++;
        } else if (op.op === "setRange") {
          const { startRow, endRow, startCol, endCol } = op;
          if (startRow > endRow || startCol > endCol) {
            throw new Error("Invalid range");
          }
          const height = endRow - startRow + 1;
          const width = endCol - startCol + 1;

          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              const row = startRow + r;
              const col = startCol + c;
              const hasMatrixValue =
                op.values !== undefined &&
                op.values[r] !== undefined &&
                c < op.values[r].length;
              const value = hasMatrixValue
                ? op.values![r][c]
                : op.value !== undefined
                  ? op.value
                  : "";
              const storedValue = toStoredCellValue(value);
              const type = toStoredCellType(value);

              const existing = await ctx.db
                .query("sheetCells")
                .withIndex("by_sheet_row_col", (q) =>
                  q.eq("sheetId", sheetId).eq("row", row).eq("col", col)
                )
                .first() as Doc<"sheetCells"> | null;

              if (existing) {
                await ctx.db.patch(existing._id, {
                  value: storedValue,
                  type,
                  updatedAt: now,
                });
              } else {
                await ctx.db.insert("sheetCells", {
                  sheetId,
                  row,
                  col,
                  value: storedValue,
                  type,
                  updatedAt: now,
                });
              }
            }
          }
          applied++;
        } else {
          // Unknown op
          errors++;
        }
      } catch (e) {
        console.error("applyOperations error on op", op, e);
        errors++;
      }
    }

    // Update sheet timestamp if any changes applied
    if (applied > 0) {
      await ctx.db.patch(sheetId, { updatedAt: now });
    }

    return { applied, errors };
  },
});

export const applyRowDelta = mutation({
  args: {
    sheetId: v.id("spreadsheets"),
    row: v.number(),
    operations: v.array(rowDeltaOperationValidator),
    expectedUpdatedAt: v.optional(v.number()),
    source: v.optional(v.string()),
    threadId: v.optional(v.string()),
    runId: v.optional(v.string()),
  },
  returns: v.object({
    applied: v.number(),
    errors: v.number(),
    row: v.number(),
    before: v.array(cellValueValidator),
    after: v.array(cellValueValidator),
    changes: v.array(
      v.object({
        operation: v.string(),
        index: v.number(),
        before: v.optional(cellValueValidator),
        after: v.optional(cellValueValidator),
      }),
    ),
    previousVersion: v.number(),
    nextVersion: v.number(),
    eventId: v.id("spreadsheetEvents"),
  }),
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    const sheet = await ctx.db.get(args.sheetId) as Doc<"spreadsheets"> | null;
    if (!sheet) throw new Error("Sheet not found");
    if (sheet.userId && sheet.userId !== userId) throw new Error("Not authorized");
    const previousVersion = sheet.updatedAt ?? 0;
    if (args.expectedUpdatedAt !== undefined && args.expectedUpdatedAt !== previousVersion) {
      throw new Error(
        `VersionConflict: expected updatedAt ${args.expectedUpdatedAt}, found ${previousVersion}`,
      );
    }

    const rowCells = await ctx.db
      .query("sheetCells")
      .withIndex("by_sheet_row_col", (q) => q.eq("sheetId", args.sheetId).eq("row", args.row))
      .collect() as Doc<"sheetCells">[];
    rowCells.sort((a, b) => a.col - b.col);

    const maxCol = rowCells.reduce((max, cell) => Math.max(max, cell.col), -1);
    const byCol = new Map<number, Doc<"sheetCells">>();
    for (const cell of rowCells) byCol.set(cell.col, cell);
    const current = Array.from({ length: maxCol + 1 }, (_unused, col) =>
      fromStoredCellValue(byCol.get(col)),
    );

    const result = applySpreadsheetRowDelta(
      current,
      args.operations as SpreadsheetRowDeltaOperation[],
    );
    if (result.after.length > MAX_ROW_DELTA_CELLS) {
      throw new Error(`RowDeltaTooLarge: row delta produced ${result.after.length} cells`);
    }

    const now = Date.now();
    for (const cell of rowCells) {
      await ctx.db.delete(cell._id);
    }
    for (let col = 0; col < result.after.length; col++) {
      const value = result.after[col];
      await ctx.db.insert("sheetCells", {
        sheetId: args.sheetId,
        row: args.row,
        col,
        value: toStoredCellValue(value),
        type: toStoredCellType(value),
        updatedAt: now,
        updatedBy: userId,
      });
    }
    await ctx.db.patch(args.sheetId, { updatedAt: now });

    const endCol = Math.max(0, result.after.length - 1);
    const targetRange = `A${args.row + 1}:${colToLetter(endCol)}${args.row + 1}`;
    const eventId = await ctx.db.insert("spreadsheetEvents", {
      userId,
      spreadsheetId: args.sheetId,
      threadId: args.threadId,
      runId: args.runId,
      operation: "row_delta",
      targetRange,
      payload: {
        row: args.row,
        operations: args.operations,
        source: args.source ?? "agent",
        before: result.before,
        after: result.after,
        changes: result.changes,
        previousVersion,
        nextVersion: now,
      },
      status: "applied",
      createdAt: now,
    });

    return {
      applied: args.operations.length,
      errors: 0,
      row: args.row,
      before: result.before,
      after: result.after,
      changes: result.changes,
      previousVersion,
      nextVersion: now,
      eventId,
    };
  },
});

export const insertRow = mutation({
  args: {
    sheetId: v.id("spreadsheets"),
    atRow: v.number(),
    values: v.optional(v.array(cellValueValidator)),
  },
  returns: v.object({
    shiftedCells: v.number(),
    insertedCells: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    const sheet = await ctx.db.get(args.sheetId) as Doc<"spreadsheets"> | null;
    if (!sheet) throw new Error("Sheet not found");
    if (sheet.userId !== userId) throw new Error("Not authorized");

    const now = Date.now();
    const cellsToShift = await ctx.db
      .query("sheetCells")
      .withIndex("by_sheet_row_col", (q) => q.eq("sheetId", args.sheetId).gte("row", args.atRow))
      .collect() as Doc<"sheetCells">[];

    // Shift downward, highest rows first.
    cellsToShift.sort((a: Doc<"sheetCells">, b: Doc<"sheetCells">) => (b.row - a.row) || (b.col - a.col));
    for (const cell of cellsToShift) {
      await ctx.db.patch(cell._id, {
        row: cell.row + 1,
        updatedAt: now,
        updatedBy: userId,
      });
    }

    let insertedCells = 0;
    if (args.values && args.values.length > 0) {
      for (let col = 0; col < args.values.length; col++) {
        const rawValue = args.values[col];
        await ctx.db.insert("sheetCells", {
          sheetId: args.sheetId,
          row: args.atRow,
          col,
          value: toStoredCellValue(rawValue),
          type: toStoredCellType(rawValue),
          updatedAt: now,
          updatedBy: userId,
        });
        insertedCells++;
      }
    }

    await ctx.db.patch(args.sheetId, { updatedAt: now });
    return { shiftedCells: cellsToShift.length, insertedCells };
  },
});

export const deleteRow = mutation({
  args: {
    sheetId: v.id("spreadsheets"),
    row: v.number(),
  },
  returns: v.object({
    deletedCells: v.number(),
    shiftedCells: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await getSafeUserId(ctx);
    const sheet = await ctx.db.get(args.sheetId) as Doc<"spreadsheets"> | null;
    if (!sheet) throw new Error("Sheet not found");
    if (sheet.userId !== userId) throw new Error("Not authorized");

    const now = Date.now();
    const rowCells = await ctx.db
      .query("sheetCells")
      .withIndex("by_sheet_row_col", (q) => q.eq("sheetId", args.sheetId).eq("row", args.row))
      .collect() as Doc<"sheetCells">[];

    for (const cell of rowCells) {
      await ctx.db.delete(cell._id);
    }

    const cellsToShift = await ctx.db
      .query("sheetCells")
      .withIndex("by_sheet_row_col", (q) => q.eq("sheetId", args.sheetId).gte("row", args.row + 1))
      .collect() as Doc<"sheetCells">[];

    // Shift upward, lowest rows first.
    cellsToShift.sort((a: Doc<"sheetCells">, b: Doc<"sheetCells">) => (a.row - b.row) || (a.col - b.col));
    for (const cell of cellsToShift) {
      await ctx.db.patch(cell._id, {
        row: cell.row - 1,
        updatedAt: now,
        updatedBy: userId,
      });
    }

    await ctx.db.patch(args.sheetId, { updatedAt: now });
    return { deletedCells: rowCells.length, shiftedCells: cellsToShift.length };
  },
});
