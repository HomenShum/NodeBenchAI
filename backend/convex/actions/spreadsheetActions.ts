"use node";

import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import Papa from "papaparse";

interface BulkUpdateResult {
  dryRun: boolean;
  committed?: boolean;
  affectedRows: number;
  changedCells: number;
  preview?: Array<{ row: number; col: number; old: string; new: string }>;
  newStorageId?: string;
  message: string;
  executionTime: number;
}

/**
 * Bulk update spreadsheet rows/columns using file-based manipulation
 * This action downloads the file, modifies it in-memory, and re-uploads
 */
export const bulkUpdateSpreadsheet = action({
  args: {
    documentId: v.id("documents"),
    operations: v.array(
      v.object({
        type: v.union(v.literal("updateColumn"), v.literal("updateRow"), v.literal("filter")),
        // For updateColumn
        columnIndex: v.optional(v.number()),
        columnName: v.optional(v.string()),
        // For updateRow
        rowIndex: v.optional(v.number()),
        // Common
        value: v.optional(v.union(v.string(), v.number(), v.null())),
        values: v.optional(v.array(v.union(v.string(), v.number(), v.null()))),
        // For filter operations
        filterColumn: v.optional(v.union(v.number(), v.string())),
        filterOperator: v.optional(v.union(
          v.literal("equals"),
          v.literal("contains"),
          v.literal("greaterThan"),
          v.literal("lessThan"),
          v.literal("startsWith"),
          v.literal("endsWith")
        )),
        filterValue: v.optional(v.union(v.string(), v.number())),
      })
    ),
    dryRun: v.optional(v.boolean()),
    confirm: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BulkUpdateResult> => {
    const startTime = Date.now();
    const isDryRun = args.dryRun !== false; // Default to true
    const isConfirmed = args.confirm === true;

    // Safety gate: require explicit confirmation for real writes
    if (!isDryRun && !isConfirmed) {
      throw new Error(
        "CommitNotConfirmed: Set both dryRun=false AND confirm=true to commit changes"
      );
    }

    // 1. Get authenticated user
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Extract userId from identity subject
    const userId = identity.subject;

    // 2. Fetch file document
    const fileDoc = await ctx.runQuery(api.domains.documents.fileDocuments.getFileDocument, {
      documentId: args.documentId,
      userId,
    });

    if (!fileDoc?.file || !fileDoc.storageUrl) {
      throw new Error("File not found or no storage URL");
    }

    const fileType = fileDoc.document.fileType;
    if (fileType !== "csv" && fileType !== "excel") {
      throw new Error(`Unsupported file type: ${fileType}. Only CSV and Excel are supported.`);
    }

    // 3. Download file content
    const response = await fetch(fileDoc.storageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    let headers: string[] = [];
    let rows: string[][] = [];
    let modifiedRows: string[][] = [];
    const affectedRowIndices: number[] = [];

    // 4. Parse based on file type
    if (fileType === "csv") {
      const csvText = await response.text();
      const parsed = Papa.parse<string[]>(csvText, {
        header: false,
        dynamicTyping: false,
        skipEmptyLines: false,
      });

      const allRows = parsed.data.map((r: string[]) => r.map((c: string) => c ?? ""));
      if (allRows.length === 0) throw new Error("Empty CSV file");

      headers = allRows[0] || [];
      rows = allRows.slice(1);
    } else {
      // Excel handling would go here (using XLSX library)
      throw new Error("Excel support not yet implemented in this action");
    }

    // 5. Apply operations
    modifiedRows = rows.map((row) => [...row]); // Deep copy

    for (const op of args.operations) {
      if (op.type === "updateColumn") {
        // Resolve column index
        let colIdx: number;
        if (op.columnIndex !== undefined) {
          colIdx = op.columnIndex;
        } else if (op.columnName !== undefined) {
          colIdx = headers.indexOf(op.columnName);
          if (colIdx === -1) {
            throw new Error(`Column "${op.columnName}" not found in headers`);
          }
        } else {
          throw new Error("Either columnIndex or columnName must be provided");
        }

        // Apply scalar or vector value
        if (op.value !== undefined) {
          // Scalar: apply to all rows
          for (let i = 0; i < modifiedRows.length; i++) {
            modifiedRows[i][colIdx] = String(op.value ?? "");
            if (!affectedRowIndices.includes(i)) affectedRowIndices.push(i);
          }
        } else if (op.values !== undefined) {
          // Vector: apply element-wise
          if (op.values.length !== modifiedRows.length) {
            throw new Error(
              `Vector length mismatch: ${op.values.length} values for ${modifiedRows.length} rows`
            );
          }
          for (let i = 0; i < modifiedRows.length; i++) {
            modifiedRows[i][colIdx] = String(op.values[i] ?? "");
            if (!affectedRowIndices.includes(i)) affectedRowIndices.push(i);
          }
        }
      } else if (op.type === "updateRow") {
        if (op.rowIndex === undefined) {
          throw new Error("rowIndex must be provided for updateRow operation");
        }
        if (op.rowIndex < 0 || op.rowIndex >= modifiedRows.length) {
          throw new Error(`Row index ${op.rowIndex} out of bounds`);
        }

        if (op.values !== undefined) {
          // Replace entire row
          modifiedRows[op.rowIndex] = op.values.map((v: any) => String(v ?? ""));
          if (!affectedRowIndices.includes(op.rowIndex)) {
            affectedRowIndices.push(op.rowIndex);
          }
        }
      } else if (op.type === "filter") {
        // Filter-based update (future enhancement)
        throw new Error("Filter operations not yet implemented");
      }
    }

    // 6. Compute diff
    const changedCells: Array<{ row: number; col: number; old: string; new: string }> = [];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < Math.max(rows[r].length, modifiedRows[r].length); c++) {
        const oldVal = rows[r][c] ?? "";
        const newVal = modifiedRows[r][c] ?? "";
        if (oldVal !== newVal) {
          changedCells.push({ row: r, col: c, old: oldVal, new: newVal });
        }
      }
    }

    // 7. If dry-run, return preview
    if (isDryRun) {
      return {
        dryRun: true,
        affectedRows: affectedRowIndices.length,
        changedCells: changedCells.length,
        preview: changedCells.slice(0, 10), // First 10 changes
        message: `Dry-run complete. ${changedCells.length} cells would be modified across ${affectedRowIndices.length} rows.`,
        executionTime: Date.now() - startTime,
      };
    }

    // 8. Commit: Re-upload modified file
    const csvContent = Papa.unparse([headers, ...modifiedRows], {
      quotes: false,
      newline: "\n",
    });

    const uploadUrl: string = await ctx.runMutation(api.domains.documents.files.generateUploadUrl);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const uploadRes: Response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: blob,
    });

    if (!uploadRes.ok) {
      throw new Error(`Upload failed: ${uploadRes.statusText}`);
    }

    const { storageId }: { storageId: string } = await uploadRes.json();
    if (!storageId) {
      throw new Error("Upload did not return storageId");
    }

    // 9. Finalize file update
    await ctx.runMutation(api.domains.documents.files.finalizeCsvReplace, {
      fileId: fileDoc.file._id,
      newStorageId: storageId,
      newFileSize: blob.size,
      modifiedCells: changedCells.map((c) => ({
        row: c.row,
        col: c.col,
        originalValue: c.old,
        newValue: c.new,
      })),
    });

    return {
      dryRun: false,
      committed: true,
      affectedRows: affectedRowIndices.length,
      changedCells: changedCells.length,
      newStorageId: storageId,
      message: `Successfully updated ${changedCells.length} cells across ${affectedRowIndices.length} rows.`,
      executionTime: Date.now() - startTime,
    };
  },
});

/**
 * Internal test action that bypasses authentication
 * Used for testing and evaluation purposes only
 */
export const testBulkUpdateSpreadsheet = internalAction({
  args: {
    documentId: v.id("documents"),
    userId: v.optional(v.id("users")), // Optional userId for testing
    operations: v.array(
      v.object({
        type: v.union(
          v.literal("updateColumn"),
          v.literal("updateRow"),
          v.literal("filter")
        ),
        columnIndex: v.optional(v.number()),
        columnName: v.optional(v.string()),
        rowIndex: v.optional(v.number()),
        value: v.optional(v.union(v.string(), v.number(), v.null())),
        values: v.optional(v.array(v.union(v.string(), v.number(), v.null()))),
        filterExpression: v.optional(v.string()),
      })
    ),
    dryRun: v.optional(v.boolean()),
    confirm: v.optional(v.boolean()),
  },
  returns: v.object({
    dryRun: v.boolean(),
    committed: v.optional(v.boolean()),
    affectedRows: v.number(),
    changedCells: v.number(),
    preview: v.optional(
      v.array(
        v.object({
          row: v.number(),
          col: v.number(),
          old: v.string(),
          new: v.string(),
        })
      )
    ),
    newStorageId: v.optional(v.string()),
    message: v.string(),
    executionTime: v.number(),
  }),
  handler: async (ctx, args): Promise<BulkUpdateResult> => {
    const startTime = Date.now();
    const isDryRun = args.dryRun !== false;
    const isConfirmed = args.confirm === true;

    if (!isDryRun && !isConfirmed) {
      throw new Error(
        "CommitNotConfirmed: Set both dryRun=false AND confirm=true to commit changes"
      );
    }

    // 1. Fetch file document with optional userId (for testing)
    const fileDoc = await ctx.runQuery(api.domains.documents.fileDocuments.getFileDocument, {
      documentId: args.documentId,
      userId: args.userId,
    });

    if (!fileDoc?.file || !fileDoc.storageUrl) {
      throw new Error("File not found or no storage URL");
    }

    const fileType = fileDoc.document.fileType;
    if (fileType !== "csv" && fileType !== "excel") {
      throw new Error(
        `Unsupported file type: ${fileType}. Only CSV and Excel are supported.`
      );
    }

    // 2. Download file content
    const response = await fetch(fileDoc.storageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    const fileContent = await response.text();

    let headers: string[] = [];
    let rows: string[][] = [];
    let modifiedRows: string[][] = [];
    const affectedRowIndices: number[] = [];

    // 3. Parse based on file type
    if (fileType === "csv") {
      const parsed = Papa.parse(fileContent, {
        header: false,
        skipEmptyLines: true,
      });

      if (parsed.errors.length > 0) {
        throw new Error(`CSV parsing error: ${parsed.errors[0].message}`);
      }

      const allRows = parsed.data as string[][];
      if (allRows.length === 0) {
        throw new Error("CSV file is empty");
      }

      headers = allRows[0];
      rows = allRows.slice(1);
      modifiedRows = rows.map((row) => [...row]);
    } else {
      throw new Error("Excel support not yet implemented in this action");
    }

    // 4. Apply operations
    for (const op of args.operations) {
      if (op.type === "updateColumn") {
        let colIndex: number;

        if (op.columnIndex !== undefined) {
          colIndex = op.columnIndex;
        } else if (op.columnName) {
          colIndex = headers.indexOf(op.columnName);
          if (colIndex === -1) {
            throw new Error(`Column "${op.columnName}" not found in headers`);
          }
        } else {
          throw new Error(
            "Either columnIndex or columnName must be provided for updateColumn"
          );
        }

        if (op.values) {
          // Vector update
          if (op.values.length !== modifiedRows.length) {
            throw new Error(
              `VectorLengthMismatch: Provided ${op.values.length} values but sheet has ${modifiedRows.length} rows`
            );
          }
          for (let i = 0; i < modifiedRows.length; i++) {
            modifiedRows[i][colIndex] = String(op.values[i] ?? "");
            if (!affectedRowIndices.includes(i)) {
              affectedRowIndices.push(i);
            }
          }
        } else if (op.value !== undefined) {
          // Scalar update
          const valueStr = String(op.value ?? "");
          for (let i = 0; i < modifiedRows.length; i++) {
            modifiedRows[i][colIndex] = valueStr;
            if (!affectedRowIndices.includes(i)) {
              affectedRowIndices.push(i);
            }
          }
        } else {
          throw new Error(
            "Either value or values must be provided for updateColumn"
          );
        }
      } else if (op.type === "updateRow") {
        if (op.rowIndex === undefined) {
          throw new Error("rowIndex is required for updateRow");
        }
        if (!op.values) {
          throw new Error("values array is required for updateRow");
        }
        if (op.rowIndex < 0 || op.rowIndex >= modifiedRows.length) {
          throw new Error(
            `Row index ${op.rowIndex} out of bounds (0-${modifiedRows.length - 1})`
          );
        }
        if (op.values.length !== headers.length) {
          throw new Error(
            `Row values length ${op.values.length} does not match header count ${headers.length}`
          );
        }

        modifiedRows[op.rowIndex] = op.values.map((v: any) => String(v ?? ""));
        if (!affectedRowIndices.includes(op.rowIndex)) {
          affectedRowIndices.push(op.rowIndex);
        }
      }
    }

    // 5. Compute diff
    const changedCells: Array<{
      row: number;
      col: number;
      old: string;
      new: string;
    }> = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < headers.length; j++) {
        if (rows[i][j] !== modifiedRows[i][j]) {
          changedCells.push({
            row: i,
            col: j,
            old: rows[i][j] || "",
            new: modifiedRows[i][j] || "",
          });
        }
      }
    }

    // 6. If dry-run, return preview
    if (isDryRun) {
      return {
        dryRun: true,
        affectedRows: affectedRowIndices.length,
        changedCells: changedCells.length,
        preview: changedCells.slice(0, 10),
        message: `DRY RUN: Would update ${changedCells.length} cells across ${affectedRowIndices.length} rows. Set dryRun=false and confirm=true to commit.`,
        executionTime: Date.now() - startTime,
      };
    }

    // 7. Commit: Re-upload modified file
    const modifiedCsv = Papa.unparse({
      fields: headers,
      data: modifiedRows,
    });

    const uploadUrl: string = await ctx.runMutation(api.domains.documents.files.generateUploadUrl);
    const blob = new Blob([modifiedCsv], { type: "text/csv;charset=utf-8" });
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: blob,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.statusText}`);
    }

    const { storageId } = (await uploadResponse.json()) as { storageId: string };
    if (!storageId) {
      throw new Error("Upload did not return storageId");
    }

    // 8. Finalize file update
    await ctx.runMutation(api.domains.documents.files.finalizeCsvReplace, {
      fileId: fileDoc.file._id,
      newStorageId: storageId,
      newFileSize: blob.size,
      modifiedCells: changedCells.map((c) => ({
        row: c.row,
        col: c.col,
        originalValue: c.old,
        newValue: c.new,
      })),
    });

    return {
      dryRun: false,
      committed: true,
      affectedRows: affectedRowIndices.length,
      changedCells: changedCells.length,
      newStorageId: storageId,
      message: `Successfully updated ${changedCells.length} cells across ${affectedRowIndices.length} rows.`,
      executionTime: Date.now() - startTime,
    };
  },
});

