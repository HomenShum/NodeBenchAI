/**
 * Single source of truth for the `spreadsheetEvents.operation` literals.
 *
 * Audit P1-2 / the 2026-06-03 `row_delta` prod-down: the only thing that can re-break a prod
 * `convex deploy` is a `spreadsheetEvents` document whose `operation` is NOT in the schema's
 * `v.union`. The writer (`storeSpreadsheetEvent`) used `firstOp?.type || "unknown"` — and
 * "unknown" is not in the union, so any op without a `.type` would have written a deploy-breaker.
 *
 * This list MUST stay equal to the `v.union` in `convex/schema.ts` (spreadsheetEvents.operation).
 * The writer validates every operation value against it and REJECTS out-of-union values, so a
 * bad value can never reach the table. `spreadsheetOperationSync.test.ts` asserts the Zod
 * `operationSchema` (editSpreadsheet.ts) is a subset of this list, so the writer can never
 * legitimately produce a value missing from the schema union.
 */
export const SPREADSHEET_OPERATION_TYPES = [
  "set_cell",
  "insert_row",
  "delete_row",
  "add_column",
  "delete_column",
  "apply_formula",
  "add_sheet",
  "rename_sheet",
  "row_delta",
] as const;

export type SpreadsheetOperationType = (typeof SPREADSHEET_OPERATION_TYPES)[number];

export function isSpreadsheetOperationType(value: unknown): value is SpreadsheetOperationType {
  return (
    typeof value === "string" &&
    (SPREADSHEET_OPERATION_TYPES as readonly string[]).includes(value)
  );
}
