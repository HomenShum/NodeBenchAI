export type SpreadsheetCellValue = string | number | null;

export type SpreadsheetRowDeltaOperation =
  | {
      op: "insert";
      index: number;
      value: SpreadsheetCellValue;
    }
  | {
      op: "delete";
      index: number;
    }
  | {
      op: "set";
      index: number;
      value: SpreadsheetCellValue;
    };

export type SpreadsheetRowDeltaChange = {
  operation: SpreadsheetRowDeltaOperation["op"];
  index: number;
  before?: SpreadsheetCellValue;
  after?: SpreadsheetCellValue;
};

export type SpreadsheetRowDeltaResult = {
  before: SpreadsheetCellValue[];
  after: SpreadsheetCellValue[];
  changes: SpreadsheetRowDeltaChange[];
};

function assertWholeIndex(index: number, label: string) {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

export function applySpreadsheetRowDelta(
  current: readonly SpreadsheetCellValue[],
  operations: readonly SpreadsheetRowDeltaOperation[],
): SpreadsheetRowDeltaResult {
  const before = [...current];
  const next = [...current];
  const changes: SpreadsheetRowDeltaChange[] = [];

  for (const operation of operations) {
    assertWholeIndex(operation.index, "operation.index");

    if (operation.op === "insert") {
      if (operation.index > next.length) {
        throw new Error(`Insert index ${operation.index} out of bounds for row length ${next.length}`);
      }
      next.splice(operation.index, 0, operation.value);
      changes.push({
        operation: "insert",
        index: operation.index,
        after: operation.value,
      });
      continue;
    }

    if (operation.op === "delete") {
      if (operation.index >= next.length) {
        throw new Error(`Delete index ${operation.index} out of bounds for row length ${next.length}`);
      }
      const [removed] = next.splice(operation.index, 1);
      changes.push({
        operation: "delete",
        index: operation.index,
        before: removed,
      });
      continue;
    }

    if (operation.op === "set") {
      if (operation.index >= next.length) {
        throw new Error(`Set index ${operation.index} out of bounds for row length ${next.length}`);
      }
      const previous = next[operation.index];
      next[operation.index] = operation.value;
      changes.push({
        operation: "set",
        index: operation.index,
        before: previous,
        after: operation.value,
      });
      continue;
    }

    const neverOperation: never = operation;
    throw new Error(`Unknown operation: ${JSON.stringify(neverOperation)}`);
  }

  return { before, after: next, changes };
}
