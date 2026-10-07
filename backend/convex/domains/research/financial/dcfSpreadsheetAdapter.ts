/**
 * DCF Spreadsheet Adapter
 *
 * Converts DCF sessions to/from the existing spreadsheet infrastructure
 *
 * Flow:
 * 1. DCF session created → generateSpreadsheetFromDCF → creates spreadsheet document
 * 2. User edits spreadsheet cell → syncCellToDCFSession → updates DCF parameter
 * 3. DCF recalculates → syncDCFToSpreadsheet → updates spreadsheet cells
 * 4. Real-time reactive: both UIs stay in sync
 */

import { internalMutation, internalQuery, action } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { v } from "convex/values";
import { DCF_SHEET, mapCellToField } from "./dcfSpreadsheetMapping";

/**
 * Internal query to get spreadsheet info
 */
export const getSpreadsheetInfo = internalQuery({
  args: {
    spreadsheetId: v.id("spreadsheets"),
  },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.spreadsheetId);
  },
});

/**
 * Generate a spreadsheet from a DCF session
 */
export const generateSpreadsheetFromDCF = action({
  args: {
    sessionId: v.string(),
  },
  returns: v.object({
    spreadsheetId: v.id("spreadsheets"),
    cellsCreated: v.number(),
  }),
  handler: async (ctx, args) => {
    // Get DCF session
    const session = await ctx.runQuery(
      internal.domains.financial.interactiveDCFSession.getSession,
      { sessionId: args.sessionId }
    );

    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    // Create spreadsheet (internal path, doesn't rely on auth context)
    const spreadsheetId = await ctx.runMutation(
      internal.domains.integrations.spreadsheets.createSheetForUser,
      {
        name: `${session.ticker} DCF Model`,
        userId: session.userId,
      }
    );

    // Build spreadsheet layout
    const cells = buildDCFSpreadsheetLayout(session);

    // Insert cells
    let cellsCreated = 0;
    for (const cell of cells) {
      await ctx.runMutation(
        internal.domains.integrations.spreadsheets.applyOperations,
        {
          sheetId: spreadsheetId,
          operations: [
            {
              op: "setCell",
              row: cell.row,
              col: cell.col,
              value: cell.value,
              type: cell.type,
              comment: cell.comment,
            },
          ],
        }
      );
      cellsCreated++;
    }

    // Link spreadsheet to DCF session
    await ctx.runMutation(
      internal.domains.financial.dcfSpreadsheetAdapter.linkSpreadsheetToSession,
      {
        sessionId: args.sessionId,
        spreadsheetId,
      }
    );

    return {
      spreadsheetId,
      cellsCreated,
    };
  },
});

/**
 * Link spreadsheet to DCF session (store in session metadata)
 */
export const linkSpreadsheetToSession = internalMutation({
  args: {
    sessionId: v.string(),
    spreadsheetId: v.id("spreadsheets"),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("dcfSessions")
      .filter(q => q.eq(q.field("sessionId"), args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    // Store spreadsheet link in session
    await ctx.db.patch(session._id, {
      spreadsheetId: args.spreadsheetId,
      updatedAt: Date.now(),
    });

    // Also link sheet back to session (for UI + lookups)
    await ctx.db.patch(args.spreadsheetId, {
      dcfSessionId: args.sessionId,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Sync spreadsheet cell edit back to DCF session
 */
export const syncCellToDCFSession = action({
  args: {
    sessionId: v.string(),
    row: v.number(),
    col: v.number(),
    newValue: v.string(),
  },
  returns: v.object({
    updated: v.boolean(),
    field: v.optional(v.string()),
    recalculated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Map cell coordinates to DCF field
    const field = mapCellToField(args.row, args.col);

    if (!field) {
      // Not an editable cell
      return { updated: false, recalculated: false };
    }

    // Update DCF parameter
    await ctx.runMutation(
      internal.domains.financial.interactiveDCFSession.updateParameter,
      {
        sessionId: args.sessionId,
        field,
        newValue: args.newValue,
        triggeredBy: "user",
      }
    );

    return {
      updated: true,
      field,
      recalculated: true,
    };
  },
});

/**
 * Sync DCF session changes back to spreadsheet
 */
export const syncDCFToSpreadsheet = action({
  args: {
    sessionId: v.string(),
    spreadsheetId: v.id("spreadsheets"),
  },
  returns: v.object({
    cellsUpdated: v.number(),
  }),
  handler: async (ctx, args) => {
    // Get latest session state
    const session = await ctx.runQuery(
      internal.domains.financial.interactiveDCFSession.getSession,
      { sessionId: args.sessionId }
    );

    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    // Get cells to update (inputs + outputs)
    const cellsToUpdate = getSyncCells(session);

    // Update spreadsheet
    let cellsUpdated = 0;
    for (const cell of cellsToUpdate) {
      await ctx.runMutation(
        internal.domains.integrations.spreadsheets.applyOperations,
        {
          sheetId: args.spreadsheetId,
          operations: [
            {
              op: "setCell",
              row: cell.row,
              col: cell.col,
              value: cell.value,
              type: cell.type,
            },
          ],
        }
      );
      cellsUpdated++;
    }

    return { cellsUpdated };
  },
});

/**
 * Apply a cell edit to a spreadsheet and (if linked) sync it into the DCF session.
 * Intended for UI usage to ensure a single round-trip produces recalculated outputs.
 */
export const applyDCFSpreadsheetCellEdit = action({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    row: v.number(),
    col: v.number(),
    newValue: v.string(),
  },
  returns: v.object({
    applied: v.boolean(),
    field: v.optional(v.string()),
    recalculated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const sheet = await ctx.runQuery(
      internal.domains.financial.dcfSpreadsheetAdapter.getSpreadsheetInfo,
      { spreadsheetId: args.spreadsheetId }
    );
    const sessionId = (sheet as any)?.dcfSessionId as string | undefined;
    if (!sessionId) {
      await ctx.runMutation(internal.domains.integrations.spreadsheets.applyOperations, {
        sheetId: args.spreadsheetId,
        operations: [
          { op: "setCell", row: args.row, col: args.col, value: args.newValue, type: "text" },
        ],
      });
      return { applied: true, recalculated: false };
    }

    const field = mapCellToField(args.row, args.col);
    if (!field) {
      await ctx.runMutation(internal.domains.integrations.spreadsheets.applyOperations, {
        sheetId: args.spreadsheetId,
        operations: [
          { op: "setCell", row: args.row, col: args.col, value: args.newValue, type: "text" },
        ],
      });
      return { applied: true, recalculated: false };
    }

    const res = await ctx.runAction(internal.domains.financial.dcfSpreadsheetAdapter.syncCellToDCFSession, {
      sessionId,
      row: args.row,
      col: args.col,
      newValue: args.newValue,
    });

    // Note: updateParameter() triggers syncDCFToSpreadsheet(), so the sheet will be updated (inputs + outputs).
    return { applied: true, field: res.field, recalculated: res.recalculated };
  },
});

/**
 * Apply a natural-language instruction to a linked DCF session and sync results back to the spreadsheet.
 */
export const applyDCFSpreadsheetInstruction = action({
  args: {
    spreadsheetId: v.id("spreadsheets"),
    instruction: v.string(),
  },
  returns: v.object({
    edits: v.array(v.object({
      field: v.string(),
      oldValue: v.any(),
      newValue: v.any(),
      reasoning: v.string(),
    })),
    newFairValue: v.number(),
  }),
  handler: async (ctx, args) => {
    const sheet = await ctx.runQuery(
      internal.domains.financial.dcfSpreadsheetAdapter.getSpreadsheetInfo,
      { spreadsheetId: args.spreadsheetId }
    );
    const sessionId = (sheet as any)?.dcfSessionId as string | undefined;
    if (!sessionId) {
      throw new Error("Spreadsheet is not linked to a DCF session");
    }

    return await ctx.runAction(internal.domains.financial.interactiveDCFSession.agentEditParameters, {
      sessionId,
      userInstruction: args.instruction,
    });
  },
});

/**
 * Helper: Build spreadsheet layout from DCF session
 */
function buildDCFSpreadsheetLayout(session: any): Array<{
  row: number;
  col: number;
  value: string;
  type?: string;
  comment?: string;
}> {
  const cells: Array<{ row: number; col: number; value: string; type?: string; comment?: string }> = [];

  // Header
  cells.push({ row: 0, col: 0, value: `${session.ticker} DCF Model`, type: "text" });
  cells.push({ row: 1, col: 0, value: "", type: "text" });

  // Column headers
  cells.push({ row: 2, col: 0, value: "Item", type: "text" });
  cells.push({ row: 2, col: 1, value: "Value", type: "text" });
  cells.push({ row: 2, col: 2, value: "Unit", type: "text" });

  let currentRow = 3;

  // INPUTS SECTION
  cells.push({ row: currentRow++, col: 0, value: "INPUTS", type: "text" });
  cells.push({ row: currentRow++, col: 0, value: "", type: "text" });

  // Revenue assumptions
  cells.push({ row: currentRow++, col: 0, value: "Base Revenue", type: "text" });
  cells.push({ row: currentRow - 1, col: 1, value: session.parameters.baseRevenue.toFixed(0), type: "number" });
  cells.push({ row: currentRow - 1, col: 2, value: "$ millions", type: "text" });

  // Growth rates (editable)
  session.parameters.revenueGrowthRates.forEach((rate: number, i: number) => {
    cells.push({ row: currentRow, col: 0, value: `Year ${i + 1} Growth`, type: "text" });
    cells.push({
      row: currentRow,
      col: 1,
      value: (rate * 100).toFixed(1),
      type: "number",
      comment: `Editable - Row ${currentRow}, maps to revenueGrowthRates[${i}]`,
    });
    cells.push({ row: currentRow, col: 2, value: "%", type: "text" });
    currentRow++;
  });

  // Terminal growth (editable)
  cells.push({ row: currentRow, col: 0, value: "Terminal Growth", type: "text" });
  cells.push({
    row: currentRow,
    col: 1,
    value: (session.parameters.terminalGrowth * 100).toFixed(1),
    type: "number",
    comment: "Editable - maps to terminalGrowth",
  });
  cells.push({ row: currentRow, col: 2, value: "%", type: "text" });
  currentRow++;

  // WACC inputs (editable)
  cells.push({ row: currentRow++, col: 0, value: "", type: "text" });
  cells.push({ row: currentRow++, col: 0, value: "WACC Components", type: "text" });

  cells.push({ row: currentRow, col: 0, value: "Risk-Free Rate", type: "text" });
  cells.push({ row: currentRow, col: 1, value: (session.parameters.riskFreeRate * 100).toFixed(2), type: "number", comment: "Editable" });
  cells.push({ row: currentRow, col: 2, value: "%", type: "text" });
  currentRow++;

  cells.push({ row: currentRow, col: 0, value: "Beta", type: "text" });
  cells.push({ row: currentRow, col: 1, value: session.parameters.beta.toFixed(2), type: "number", comment: "Editable" });
  cells.push({ row: currentRow, col: 2, value: "", type: "text" });
  currentRow++;

  cells.push({ row: currentRow, col: 0, value: "Market Risk Premium", type: "text" });
  cells.push({ row: currentRow, col: 1, value: (session.parameters.marketRiskPremium * 100).toFixed(2), type: "number", comment: "Editable" });
  cells.push({ row: currentRow, col: 2, value: "%", type: "text" });
  currentRow++;

  // OUTPUTS SECTION (read-only calculated)
  cells.push({ row: currentRow++, col: 0, value: "", type: "text" });
  cells.push({ row: currentRow++, col: 0, value: "OUTPUTS (Calculated)", type: "text" });

  cells.push({ row: currentRow, col: 0, value: "WACC", type: "text" });
  cells.push({ row: currentRow, col: 1, value: (session.results.wacc * 100).toFixed(2), type: "number" });
  cells.push({ row: currentRow, col: 2, value: "%", type: "text" });
  currentRow++;

  cells.push({ row: currentRow, col: 0, value: "Enterprise Value", type: "text" });
  cells.push({ row: currentRow, col: 1, value: (session.results.enterpriseValue / 1000).toFixed(0), type: "number" });
  cells.push({ row: currentRow, col: 2, value: "$ billions", type: "text" });
  currentRow++;

  cells.push({ row: currentRow, col: 0, value: "Equity Value", type: "text" });
  cells.push({ row: currentRow, col: 1, value: (session.results.equityValue / 1000).toFixed(0), type: "number" });
  cells.push({ row: currentRow, col: 2, value: "$ billions", type: "text" });
  currentRow++;

  cells.push({ row: currentRow, col: 0, value: "Fair Value per Share", type: "text" });
  cells.push({ row: currentRow, col: 1, value: session.results.fairValuePerShare.toFixed(2), type: "number" });
  cells.push({ row: currentRow, col: 2, value: "$", type: "text" });
  currentRow++;

  cells.push({ row: currentRow, col: 0, value: "Evaluation Score", type: "text" });
  cells.push({ row: currentRow, col: 1, value: session.results.evaluationScore.toFixed(0), type: "number" });
  cells.push({ row: currentRow, col: 2, value: "/100", type: "text" });
  currentRow++;

  return cells;
}

/**
 * Helper: Get cells with calculated values to update
 */
function getSyncCells(session: any): Array<{
  row: number;
  col: number;
  value: string;
  type?: string;
}> {
  const cells: Array<{ row: number; col: number; value: string; type?: string }> = [];

  // Inputs
  cells.push({ row: 5, col: 1, value: session.parameters.baseRevenue.toFixed(0), type: "number" });

  session.parameters.revenueGrowthRates.forEach((rate: number, i: number) => {
    cells.push({
      row: DCF_SHEET.rows.revenueGrowthStart + i,
      col: 1,
      value: (rate * 100).toFixed(1),
      type: "number",
    });
  });

  cells.push({ row: DCF_SHEET.rows.terminalGrowth, col: 1, value: (session.parameters.terminalGrowth * 100).toFixed(1), type: "number" });
  cells.push({ row: DCF_SHEET.rows.riskFreeRate, col: 1, value: (session.parameters.riskFreeRate * 100).toFixed(2), type: "number" });
  cells.push({ row: DCF_SHEET.rows.beta, col: 1, value: session.parameters.beta.toFixed(2), type: "number" });
  cells.push({ row: DCF_SHEET.rows.marketRiskPremium, col: 1, value: (session.parameters.marketRiskPremium * 100).toFixed(2), type: "number" });

  // Outputs
  cells.push({ row: DCF_SHEET.outputs.wacc, col: 1, value: (session.results.wacc * 100).toFixed(2), type: "number" });
  cells.push({ row: DCF_SHEET.outputs.enterpriseValue, col: 1, value: (session.results.enterpriseValue / 1000).toFixed(0), type: "number" });
  cells.push({ row: DCF_SHEET.outputs.equityValue, col: 1, value: (session.results.equityValue / 1000).toFixed(0), type: "number" });
  cells.push({ row: DCF_SHEET.outputs.fairValuePerShare, col: 1, value: session.results.fairValuePerShare.toFixed(2), type: "number" });
  cells.push({ row: DCF_SHEET.outputs.evaluationScore, col: 1, value: session.results.evaluationScore.toFixed(0), type: "number" });

  return cells;
}
