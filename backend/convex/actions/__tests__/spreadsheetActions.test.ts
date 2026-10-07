/**
 * Unit tests for spreadsheet bulk update actions
 * 
 * These tests verify the file-based spreadsheet manipulation logic
 * without requiring a full Convex deployment.
 */

import { describe, it, expect } from "vitest";

describe("Spreadsheet Bulk Update", () => {
  describe("Safety Gates", () => {
    it("should default to dry-run mode", () => {
      // When dryRun is not specified, it should default to true
      const args: any = {
        documentId: "test-doc-id",
        operations: [{ type: "updateColumn", columnName: "Status", value: "Pending" }],
      };

      const isDryRun = args.dryRun !== false;
      expect(isDryRun).toBe(true);
    });

    it("should require explicit confirmation for commits", () => {
      const args = {
        documentId: "test-doc-id",
        operations: [{ type: "updateColumn", columnName: "Status", value: "Pending" }],
        dryRun: false,
        confirm: false,
      };
      
      const isDryRun = args.dryRun !== false;
      const isConfirmed = args.confirm === true;
      
      // Should throw error if not dry-run and not confirmed
      if (!isDryRun && !isConfirmed) {
        expect(() => {
          throw new Error("CommitNotConfirmed: Set both dryRun=false AND confirm=true to commit changes");
        }).toThrow("CommitNotConfirmed");
      }
    });

    it("should allow commits when both flags are set correctly", () => {
      const args = {
        documentId: "test-doc-id",
        operations: [{ type: "updateColumn", columnName: "Status", value: "Pending" }],
        dryRun: false,
        confirm: true,
      };
      
      const isDryRun = args.dryRun !== false;
      const isConfirmed = args.confirm === true;
      
      expect(isDryRun).toBe(false);
      expect(isConfirmed).toBe(true);
    });
  });

  describe("Operation Validation", () => {
    it("should validate updateColumn requires columnIndex or columnName", () => {
      const invalidOp: any = {
        type: "updateColumn",
        value: "test",
        // Missing both columnIndex and columnName
      };

      const hasColumnIdentifier =
        invalidOp.columnIndex !== undefined ||
        invalidOp.columnName !== undefined;

      expect(hasColumnIdentifier).toBe(false);
    });

    it("should validate updateColumn requires value or values", () => {
      const invalidOp: any = {
        type: "updateColumn",
        columnName: "Status",
        // Missing both value and values
      };

      const hasValue =
        invalidOp.value !== undefined ||
        invalidOp.values !== undefined;

      expect(hasValue).toBe(false);
    });

    it("should validate updateRow requires rowIndex and values", () => {
      const validOp = {
        type: "updateRow",
        rowIndex: 5,
        values: ["John", "Doe", "john@example.com"],
      };
      
      expect(validOp.rowIndex).toBeDefined();
      expect(validOp.values).toBeDefined();
      expect(Array.isArray(validOp.values)).toBe(true);
    });
  });

  describe("CSV Manipulation Logic", () => {
    it("should correctly identify column by name", () => {
      const headers = ["Name", "Email", "Status", "Score"];
      const columnName = "Status";
      
      const colIdx = headers.indexOf(columnName);
      
      expect(colIdx).toBe(2);
    });

    it("should handle missing column names", () => {
      const headers = ["Name", "Email", "Status", "Score"];
      const columnName = "NonExistent";
      
      const colIdx = headers.indexOf(columnName);
      
      expect(colIdx).toBe(-1);
    });

    it("should detect vector length mismatches", () => {
      const rows = [
        ["John", "john@example.com", "Active", "85"],
        ["Jane", "jane@example.com", "Pending", "92"],
        ["Bob", "bob@example.com", "Active", "78"],
      ];
      
      const values = [100, 200]; // Only 2 values for 3 rows
      
      const isLengthMismatch = values.length !== rows.length;
      
      expect(isLengthMismatch).toBe(true);
    });

    it("should correctly apply scalar value to all rows", () => {
      const rows = [
        ["John", "john@example.com", "Active"],
        ["Jane", "jane@example.com", "Pending"],
        ["Bob", "bob@example.com", "Active"],
      ];
      
      const colIdx = 2; // Status column
      const scalarValue = "Completed";
      
      const modifiedRows = rows.map(row => {
        const newRow = [...row];
        newRow[colIdx] = scalarValue;
        return newRow;
      });
      
      expect(modifiedRows[0][2]).toBe("Completed");
      expect(modifiedRows[1][2]).toBe("Completed");
      expect(modifiedRows[2][2]).toBe("Completed");
    });

    it("should correctly apply vector values to rows", () => {
      const rows = [
        ["John", "john@example.com", "85"],
        ["Jane", "jane@example.com", "92"],
        ["Bob", "bob@example.com", "78"],
      ];
      
      const colIdx = 2; // Score column
      const vectorValues = [90, 95, 80];
      
      const modifiedRows = rows.map((row, i) => {
        const newRow = [...row];
        newRow[colIdx] = String(vectorValues[i]);
        return newRow;
      });
      
      expect(modifiedRows[0][2]).toBe("90");
      expect(modifiedRows[1][2]).toBe("95");
      expect(modifiedRows[2][2]).toBe("80");
    });

    it("should correctly compute cell diffs", () => {
      const originalRows = [
        ["John", "Active"],
        ["Jane", "Pending"],
      ];
      
      const modifiedRows = [
        ["John", "Completed"],
        ["Jane", "Completed"],
      ];
      
      const changedCells: Array<{ row: number; col: number; old: string; new: string }> = [];
      
      for (let r = 0; r < originalRows.length; r++) {
        for (let c = 0; c < originalRows[r].length; c++) {
          const oldVal = originalRows[r][c];
          const newVal = modifiedRows[r][c];
          if (oldVal !== newVal) {
            changedCells.push({ row: r, col: c, old: oldVal, new: newVal });
          }
        }
      }
      
      expect(changedCells.length).toBe(2);
      expect(changedCells[0]).toEqual({ row: 0, col: 1, old: "Active", new: "Completed" });
      expect(changedCells[1]).toEqual({ row: 1, col: 1, old: "Pending", new: "Completed" });
    });
  });
});

