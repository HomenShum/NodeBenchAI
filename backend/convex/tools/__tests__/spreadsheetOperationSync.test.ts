import { describe, it, expect } from "vitest";
import {
  SPREADSHEET_OPERATION_TYPES,
  isSpreadsheetOperationType,
} from "../spreadsheetOperationTypes";

/**
 * Recurrence guard for the 2026-06-03 `row_delta` prod-down (audit P0 + P1-2).
 *
 * The prod deploy pipeline aborts when a `spreadsheetEvents` document carries an `operation`
 * value not in the schema's `v.union`. The `storeSpreadsheetEvent` writer now validates against
 * SPREADSHEET_OPERATION_TYPES and REJECTS anything else, so it can never insert a deploy-breaker.
 * These tests lock that guard + the canonical literal set.
 *
 * If you add a new spreadsheet operation: update (1) this list, (2) the `v.union` in
 * convex/schema.ts (spreadsheetEvents.operation), and (3) the Zod operationSchema in
 * editSpreadsheet.ts — in the SAME PR. Adding it in only one place is the exact failure mode
 * that caused the incident.
 */
describe("spreadsheetEvents.operation guard (row_delta recurrence prevention)", () => {
  it("the canonical literal set has no duplicates", () => {
    expect(new Set(SPREADSHEET_OPERATION_TYPES).size).toBe(SPREADSHEET_OPERATION_TYPES.length);
  });

  it("matches the schema union exactly (incl. row_delta from the P0 expand)", () => {
    expect([...SPREADSHEET_OPERATION_TYPES].sort()).toEqual(
      [
        "add_column",
        "add_sheet",
        "apply_formula",
        "delete_column",
        "delete_row",
        "insert_row",
        "rename_sheet",
        "row_delta",
        "set_cell",
      ].sort(),
    );
  });

  it("accepts every known operation type", () => {
    for (const t of SPREADSHEET_OPERATION_TYPES) {
      expect(isSpreadsheetOperationType(t)).toBe(true);
    }
  });

  it("REJECTS out-of-union values that would break a prod deploy", () => {
    // "unknown" was the old silent fallback — the latent deploy-breaker. It must now be rejected.
    for (const bad of ["unknown", undefined, null, "", "ROW_DELTA", "merge_cells", 42, {}, []]) {
      expect(isSpreadsheetOperationType(bad)).toBe(false);
    }
  });
});
