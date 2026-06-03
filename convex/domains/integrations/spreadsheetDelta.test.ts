import { describe, expect, it } from "vitest";
import { applySpreadsheetRowDelta } from "./spreadsheetDelta";

describe("applySpreadsheetRowDelta", () => {
  it("inserts a value and shifts an explicit null blank cell right", () => {
    const current = [1, 2, null, 4, 5];

    const result = applySpreadsheetRowDelta(current, [
      { op: "insert", index: 1, value: 1 },
    ]);

    expect(result.after).toEqual([1, 1, 2, null, 4, 5]);
    expect(current).toEqual([1, 2, null, 4, 5]);
    expect(result.changes).toEqual([
      { operation: "insert", index: 1, after: 1 },
    ]);
  });

  it("deletes one position and preserves null when null is not deleted", () => {
    const result = applySpreadsheetRowDelta([1, 1, 2, null, 4, 5], [
      { op: "delete", index: 1 },
    ]);

    expect(result.after).toEqual([1, 2, null, 4, 5]);
    expect(result.changes).toEqual([
      { operation: "delete", index: 1, before: 1 },
    ]);
  });

  it("sets a cell to null without deleting the position", () => {
    const result = applySpreadsheetRowDelta([1, 2, 3], [
      { op: "set", index: 1, value: null },
    ]);

    expect(result.after).toEqual([1, null, 3]);
    expect(result.after).toHaveLength(3);
    expect(result.changes).toEqual([
      { operation: "set", index: 1, before: 2, after: null },
    ]);
  });

  it("deletes a null cell when delete targets that position", () => {
    const result = applySpreadsheetRowDelta([1, null, 3], [
      { op: "delete", index: 1 },
    ]);

    expect(result.after).toEqual([1, 3]);
  });

  it("applies multiple operations in order", () => {
    const result = applySpreadsheetRowDelta([1, 2, null, 4, 5], [
      { op: "insert", index: 1, value: 1 },
      { op: "set", index: 3, value: null },
      { op: "delete", index: 4 },
    ]);

    expect(result.after).toEqual([1, 1, 2, null, 5]);
  });

  it("rejects invalid indices", () => {
    expect(() =>
      applySpreadsheetRowDelta([1, 2], [{ op: "insert", index: 3, value: 9 }]),
    ).toThrow("Insert index 3 out of bounds");
    expect(() =>
      applySpreadsheetRowDelta([1, 2], [{ op: "delete", index: 2 }]),
    ).toThrow("Delete index 2 out of bounds");
    expect(() =>
      applySpreadsheetRowDelta([1, 2], [{ op: "set", index: 2, value: null }]),
    ).toThrow("Set index 2 out of bounds");
  });
});
