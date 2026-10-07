"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

const sheetIdSchema = z.string().min(1);

export const createSpreadsheet = createTool({
  description: `Create a new spreadsheet (sheet) owned by the current user.`,
  args: z.object({
    name: z.string().min(1).describe("Spreadsheet name"),
  }),
  handler: async (ctx, args): Promise<string> => {
    const sheetId = await ctx.runMutation(api.domains.integrations.spreadsheets.createSheet, {
      name: args.name,
    });
    return `Created spreadsheet "${args.name}" (id: ${sheetId}).`;
  },
});

export const listSpreadsheets = createTool({
  description: `List your spreadsheets (most recently updated first).`,
  args: z.object({
    limit: z.number().min(1).max(100).default(25),
  }),
  handler: async (ctx, args): Promise<string> => {
    const sheets = await ctx.runQuery(api.domains.integrations.spreadsheets.listSheets, {
      limit: args.limit,
    });
    if (!sheets.length) return "No spreadsheets found.";

    const lines = (sheets as any[]).map((s: any, idx: number) => {
      const when = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "unknown";
      return `${idx + 1}. ${s.name} (id: ${s._id}) — updated ${when}`;
    });
    return `Spreadsheets:\n${lines.join("\n")}`;
  },
});

export const setCell = createTool({
  description: `Set a single cell value (0-based row/col).`,
  args: z.object({
    sheetId: sheetIdSchema.describe("Spreadsheet ID"),
    row: z.number().min(0),
    col: z.number().min(0),
    value: z.string(),
    type: z.string().optional().describe('Optional cell type, e.g. "text", "number", "formula"'),
    comment: z.string().optional(),
  }),
  handler: async (ctx, args): Promise<string> => {
    const res = await ctx.runMutation(api.domains.integrations.spreadsheets.applyOperations, {
      sheetId: args.sheetId,
      operations: [
        {
          op: "setCell",
          row: args.row,
          col: args.col,
          value: args.value,
          type: args.type,
          comment: args.comment,
        },
      ],
    });
    return `Set cell (${args.row},${args.col}) on ${args.sheetId}. Applied=${res.applied} Errors=${res.errors}.`;
  },
});

export const setRange = createTool({
  description: `Set a rectangular range. Provide either a constant value or a 2D values array.`,
  args: z.object({
    sheetId: sheetIdSchema,
    startRow: z.number().min(0),
    endRow: z.number().min(0),
    startCol: z.number().min(0),
    endCol: z.number().min(0),
    value: z.string().optional(),
    values: z.array(z.array(z.string())).optional(),
  }),
  handler: async (ctx, args): Promise<string> => {
    const res = await ctx.runMutation(api.domains.integrations.spreadsheets.applyOperations, {
      sheetId: args.sheetId,
      operations: [
        {
          op: "setRange",
          startRow: args.startRow,
          endRow: args.endRow,
          startCol: args.startCol,
          endCol: args.endCol,
          value: args.value,
          values: args.values,
        },
      ],
    });
    return `Set range on ${args.sheetId}. Applied=${res.applied} Errors=${res.errors}.`;
  },
});

export const clearCell = createTool({
  description: `Clear a single cell (0-based row/col).`,
  args: z.object({
    sheetId: sheetIdSchema,
    row: z.number().min(0),
    col: z.number().min(0),
  }),
  handler: async (ctx, args): Promise<string> => {
    const res = await ctx.runMutation(api.domains.integrations.spreadsheets.applyOperations, {
      sheetId: args.sheetId,
      operations: [{ op: "clearCell", row: args.row, col: args.col }],
    });
    return `Cleared cell (${args.row},${args.col}) on ${args.sheetId}. Applied=${res.applied} Errors=${res.errors}.`;
  },
});

export const insertRow = createTool({
  description: `Insert an empty row (or with optional values) at the given row index, shifting existing rows down.`,
  args: z.object({
    sheetId: sheetIdSchema,
    atRow: z.number().min(0),
    values: z.array(z.string()).optional(),
  }),
  handler: async (ctx, args): Promise<string> => {
    const res = await ctx.runMutation(api.domains.integrations.spreadsheets.insertRow, {
      sheetId: args.sheetId,
      atRow: args.atRow,
      values: args.values,
    });
    return `Inserted row ${args.atRow} on ${args.sheetId}. Shifted=${res.shiftedCells} InsertedCells=${res.insertedCells}.`;
  },
});

export const deleteRow = createTool({
  description: `Delete a row at the given row index, shifting higher rows up.`,
  args: z.object({
    sheetId: sheetIdSchema,
    row: z.number().min(0),
  }),
  handler: async (ctx, args): Promise<string> => {
    const res = await ctx.runMutation(api.domains.integrations.spreadsheets.deleteRow, {
      sheetId: args.sheetId,
      row: args.row,
    });
    return `Deleted row ${args.row} on ${args.sheetId}. DeletedCells=${res.deletedCells} Shifted=${res.shiftedCells}.`;
  },
});

export const getSpreadsheet = createTool({
  description: `Get full spreadsheet metadata + all populated cells.`,
  args: z.object({
    sheetId: sheetIdSchema.describe("Spreadsheet ID"),
    maxCells: z.number().min(1).max(5000).default(2000).describe("Safety cap on returned cells"),
  }),
  handler: async (ctx, args): Promise<string> => {
    const sheet = await ctx.runQuery(internal.tools.editSpreadsheetMutations.getSpreadsheet, {
      spreadsheetId: args.sheetId as any,
    });
    if (!sheet) return `Spreadsheet not found: ${args.sheetId}`;

    const cells = await ctx.runQuery(internal.tools.editSpreadsheetMutations.getSpreadsheetCells, {
      spreadsheetId: args.sheetId as any,
    });

    const limited = (cells as any[]).slice(0, args.maxCells);
    const payload = {
      sheet: { id: sheet._id, name: sheet.name, createdAt: sheet.createdAt, updatedAt: sheet.updatedAt },
      cellCount: (cells as any[]).length,
      cells: limited.map((c: any) => ({
        row: c.row,
        col: c.col,
        value: c.value ?? null,
        type: c.type ?? null,
        comment: c.comment ?? null,
        updatedAt: c.updatedAt,
      })),
      truncated: (cells as any[]).length > limited.length,
    };
    return JSON.stringify(payload);
  },
});

export const spreadsheetCrudTools = {
  createSpreadsheet,
  listSpreadsheets,
  setCell,
  clearCell,
  setRange,
  insertRow,
  deleteRow,
  getSpreadsheet,
};

