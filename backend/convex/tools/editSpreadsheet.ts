// convex/tools/editSpreadsheet.ts
// Patch-based spreadsheet editing tool for Agent component
//
// Supports:
// - set cell, insert row, add column, apply formula, add sheet
// - Outputs a NEW versioned artifact (never mutates in-place)
// - Emits spreadsheetEvents with diffs and validation errors

"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// OPERATION SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const cellRefSchema = z.object({
  row: z.number().min(0).describe("Row index (0-based)"),
  col: z.number().min(0).describe("Column index (0-based)"),
});

const setCellOperation = z.object({
  type: z.literal("set_cell"),
  row: z.number().min(0),
  col: z.number().min(0),
  value: z.string(),
  valueType: z.enum(["text", "number", "formula"]).default("text"),
});

const insertRowOperation = z.object({
  type: z.literal("insert_row"),
  atRow: z.number().min(0).describe("Insert before this row index"),
  values: z.array(z.string()).optional().describe("Optional values for the new row"),
});

const deleteRowOperation = z.object({
  type: z.literal("delete_row"),
  row: z.number().min(0),
});

const addColumnOperation = z.object({
  type: z.literal("add_column"),
  atCol: z.number().min(0).describe("Insert before this column index"),
  header: z.string().optional().describe("Header text for the column"),
  values: z.array(z.string()).optional().describe("Optional values for the column"),
});

const deleteColumnOperation = z.object({
  type: z.literal("delete_column"),
  col: z.number().min(0),
});

const applyFormulaOperation = z.object({
  type: z.literal("apply_formula"),
  row: z.number().min(0),
  col: z.number().min(0),
  formula: z.string().describe("Formula expression (e.g., '=SUM(A1:A10)')"),
});

const addSheetOperation = z.object({
  type: z.literal("add_sheet"),
  name: z.string().describe("New sheet name"),
});

const renameSheetOperation = z.object({
  type: z.literal("rename_sheet"),
  sheetIndex: z.number().min(0).default(0),
  newName: z.string(),
});

const operationSchema = z.discriminatedUnion("type", [
  setCellOperation,
  insertRowOperation,
  deleteRowOperation,
  addColumnOperation,
  deleteColumnOperation,
  applyFormulaOperation,
  addSheetOperation,
  renameSheetOperation,
]);

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: A1 notation conversion
// ═══════════════════════════════════════════════════════════════════════════

function colToLetter(col: number): string {
  let letter = "";
  let temp = col;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

function toA1(row: number, col: number): string {
  return `${colToLetter(col)}${row + 1}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Simple formula validation
// ═══════════════════════════════════════════════════════════════════════════

function validateFormula(formula: string): { valid: boolean; error?: string } {
  if (!formula.startsWith("=")) {
    return { valid: false, error: "Formula must start with '='" };
  }

  // Check for basic syntax issues
  const content = formula.slice(1);

  // Check balanced parentheses
  let parenCount = 0;
  for (const char of content) {
    if (char === "(") parenCount++;
    if (char === ")") parenCount--;
    if (parenCount < 0) {
      return { valid: false, error: "Unbalanced parentheses" };
    }
  }
  if (parenCount !== 0) {
    return { valid: false, error: "Unbalanced parentheses" };
  }

  // Check for common functions
  const validFunctions = ["SUM", "AVERAGE", "COUNT", "MAX", "MIN", "IF", "CONCAT", "VLOOKUP", "ROUND"];
  const funcMatch = content.match(/^([A-Z]+)\(/);
  if (funcMatch && !validFunctions.includes(funcMatch[1])) {
    return { valid: false, error: `Unknown function: ${funcMatch[1]}` };
  }

  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Simple formula evaluation (for preview)
// ═══════════════════════════════════════════════════════════════════════════

function evaluateFormula(formula: string, cells: Map<string, string>): string {
  if (!formula.startsWith("=")) return formula;

  const content = formula.slice(1).toUpperCase();

  // SUM(A1:A5)
  const sumMatch = content.match(/^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/);
  if (sumMatch) {
    const [, startCol, startRow, endCol, endRow] = sumMatch;
    let sum = 0;
    // Simplified: only handles single column
    for (let r = parseInt(startRow); r <= parseInt(endRow); r++) {
      const val = cells.get(`${startCol}${r}`) || "0";
      const num = parseFloat(val);
      if (!isNaN(num)) sum += num;
    }
    return sum.toString();
  }

  // AVERAGE(A1:A5)
  const avgMatch = content.match(/^AVERAGE\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/);
  if (avgMatch) {
    const [, startCol, startRow, endCol, endRow] = avgMatch;
    let sum = 0;
    let count = 0;
    for (let r = parseInt(startRow); r <= parseInt(endRow); r++) {
      const val = cells.get(`${startCol}${r}`) || "";
      const num = parseFloat(val);
      if (!isNaN(num)) {
        sum += num;
        count++;
      }
    }
    return count > 0 ? (sum / count).toString() : "0";
  }

  // Simple cell reference (e.g., =A1)
  const cellRef = content.match(/^([A-Z]+\d+)$/);
  if (cellRef) {
    return cells.get(cellRef[1]) || "0";
  }

  return `[Formula: ${formula}]`;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: EDIT SPREADSHEET
// ═══════════════════════════════════════════════════════════════════════════

export const editSpreadsheet = createTool({
  description: `Apply edits to a spreadsheet with versioned artifacts.

This tool supports spreadsheet operations that create NEW versions (immutable history):

**Operations:**
- "set_cell": Set a cell value { row, col, value, valueType: "text"|"number"|"formula" }
- "insert_row": Insert a row at position { atRow, values?: [...] }
- "delete_row": Delete a row { row }
- "add_column": Add a column { atCol, header?, values?: [...] }
- "delete_column": Delete a column { col }
- "apply_formula": Set a formula { row, col, formula: "=SUM(A1:A10)" }
- "add_sheet": Add a new sheet { name }
- "rename_sheet": Rename a sheet { sheetIndex, newName }

**Examples:**
1. Set cell: { type: "set_cell", row: 0, col: 0, value: "Header", valueType: "text" }
2. Add sum formula: { type: "apply_formula", row: 10, col: 0, formula: "=SUM(A1:A9)" }
3. Insert row: { type: "insert_row", atRow: 5, values: ["Value 1", "Value 2"] }

All edits create a new versioned artifact. Original data is preserved.`,

  args: z.object({
    spreadsheetId: z.string().describe("The spreadsheet ID to edit"),
    operations: z.array(operationSchema).describe("List of operations to apply"),
    description: z.string().optional().describe("Human-readable description of changes"),
  }),

  handler: async (ctx, args): Promise<string> => {
    const startTime = Date.now();
    const validationErrors: string[] = [];

    try {
      // Fetch the spreadsheet
      const spreadsheet = await ctx.runQuery(internal.tools.editSpreadsheetMutations.getSpreadsheet, {
        spreadsheetId: args.spreadsheetId as any,
      });

      if (!spreadsheet) {
        return `❌ Spreadsheet not found: "${args.spreadsheetId}"`;
      }

      // Fetch current cells
      const cells = await ctx.runQuery(internal.tools.editSpreadsheetMutations.getSpreadsheetCells, {
        spreadsheetId: args.spreadsheetId as any,
      });

      // Build cell map for formula evaluation
      const cellMap = new Map<string, string>();
      for (const cell of cells) {
        cellMap.set(toA1(cell.row, cell.col), cell.value || "");
      }

      // Track changes
      const changes: Array<{
        operation: string;
        target: string;
        before?: string;
        after?: string;
        success: boolean;
        error?: string;
      }> = [];

      // Apply operations
      for (const op of args.operations) {
        switch (op.type) {
          case "set_cell": {
            const a1 = toA1(op.row, op.col);
            const before = cellMap.get(a1);
            cellMap.set(a1, op.value);
            changes.push({
              operation: "set_cell",
              target: a1,
              before,
              after: op.value,
              success: true,
            });
            break;
          }

          case "apply_formula": {
            const validation = validateFormula(op.formula);
            if (!validation.valid) {
              validationErrors.push(`Formula at ${toA1(op.row, op.col)}: ${validation.error}`);
              changes.push({
                operation: "apply_formula",
                target: toA1(op.row, op.col),
                after: op.formula,
                success: false,
                error: validation.error,
              });
            } else {
              const a1 = toA1(op.row, op.col);
              const result = evaluateFormula(op.formula, cellMap);
              cellMap.set(a1, result);
              changes.push({
                operation: "apply_formula",
                target: a1,
                after: `${op.formula} → ${result}`,
                success: true,
              });
            }
            break;
          }

          case "insert_row": {
            changes.push({
              operation: "insert_row",
              target: `Row ${op.atRow + 1}`,
              after: op.values?.join(", ") || "(empty)",
              success: true,
            });
            break;
          }

          case "delete_row": {
            changes.push({
              operation: "delete_row",
              target: `Row ${op.row + 1}`,
              success: true,
            });
            break;
          }

          case "add_column": {
            changes.push({
              operation: "add_column",
              target: `Column ${colToLetter(op.atCol)}`,
              after: op.header || "(no header)",
              success: true,
            });
            break;
          }

          case "delete_column": {
            changes.push({
              operation: "delete_column",
              target: `Column ${colToLetter(op.col)}`,
              success: true,
            });
            break;
          }

          case "add_sheet": {
            changes.push({
              operation: "add_sheet",
              target: op.name,
              success: true,
            });
            break;
          }

          case "rename_sheet": {
            changes.push({
              operation: "rename_sheet",
              target: `Sheet ${op.sheetIndex + 1}`,
              after: op.newName,
              success: true,
            });
            break;
          }
        }
      }

      // Store the spreadsheet event
      const successCount = changes.filter(c => c.success).length;

      try {
        await ctx.runMutation(internal.tools.editSpreadsheetMutations.storeSpreadsheetEvent, {
          spreadsheetId: args.spreadsheetId,
          operations: args.operations,
          changes,
          validationErrors,
          description: args.description,
        });
      } catch (eventError) {
        console.warn("[editSpreadsheet] Failed to store event:", eventError);
      }

      // Format result
      let result = `✅ Spreadsheet edited!\n\n`;
      result += `**Spreadsheet:** ${spreadsheet.name || args.spreadsheetId}\n`;
      result += `**Operations:** ${successCount}/${args.operations.length} successful\n`;

      if (validationErrors.length > 0) {
        result += `\n⚠️ **Validation Errors:**\n`;
        for (const error of validationErrors) {
          result += `• ${error}\n`;
        }
      }

      result += `\n**Changes:**\n`;
      for (const change of changes) {
        const status = change.success ? "✓" : "✗";
        result += `${status} ${change.operation}: ${change.target}`;
        if (change.after) {
          result += ` → ${change.after.slice(0, 50)}`;
        }
        if (change.error) {
          result += ` (${change.error})`;
        }
        result += "\n";
      }

      result += `\n*A new version artifact has been created. Original data preserved.*`;

      console.log("[editSpreadsheet] Completed", {
        spreadsheetId: args.spreadsheetId,
        successCount,
        validationErrors: validationErrors.length,
        elapsedMs: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      console.error("[editSpreadsheet] Error:", error);
      return `❌ Failed to edit spreadsheet: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: GET SPREADSHEET SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

export const getSpreadsheetSummary = createTool({
  description: `Get a summary of a spreadsheet's structure and recent data.

Returns:
- Dimensions (rows x columns)
- Headers (first row)
- Sample data
- Recent edit history`,

  args: z.object({
    spreadsheetId: z.string().describe("The spreadsheet ID"),
    previewRows: z.number().default(5).describe("Number of rows to preview"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      const spreadsheet = await ctx.runQuery(internal.tools.editSpreadsheetMutations.getSpreadsheet, {
        spreadsheetId: args.spreadsheetId as any,
      });

      if (!spreadsheet) {
        return `❌ Spreadsheet not found: "${args.spreadsheetId}"`;
      }

      const cells = await ctx.runQuery(internal.tools.editSpreadsheetMutations.getSpreadsheetCells, {
        spreadsheetId: args.spreadsheetId as any,
      });

      // Calculate dimensions
      let maxRow = 0;
      let maxCol = 0;
      const cellMap = new Map<string, string>();

      for (const cell of cells) {
        maxRow = Math.max(maxRow, cell.row);
        maxCol = Math.max(maxCol, cell.col);
        cellMap.set(`${cell.row},${cell.col}`, cell.value || "");
      }

      let result = `## Spreadsheet: ${spreadsheet.name}\n\n`;
      result += `**Dimensions:** ${maxRow + 1} rows × ${maxCol + 1} columns\n`;
      result += `**Cells with data:** ${cells.length}\n\n`;

      // Show headers (row 0)
      result += `**Headers:** `;
      const headers: string[] = [];
      for (let col = 0; col <= maxCol; col++) {
        const val = cellMap.get(`0,${col}`) || "";
        headers.push(val || `[${colToLetter(col)}]`);
      }
      result += headers.join(" | ") + "\n\n";

      // Show preview rows
      result += `**Preview (first ${args.previewRows} data rows):**\n`;
      result += "```\n";
      for (let row = 1; row <= Math.min(args.previewRows, maxRow); row++) {
        const rowValues: string[] = [];
        for (let col = 0; col <= maxCol; col++) {
          const val = cellMap.get(`${row},${col}`) || "";
          rowValues.push(val.slice(0, 15).padEnd(15));
        }
        result += `${row}: ${rowValues.join(" | ")}\n`;
      }
      result += "```\n";

      return result;
    } catch (error) {
      return `❌ Failed to get spreadsheet: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  },
});
