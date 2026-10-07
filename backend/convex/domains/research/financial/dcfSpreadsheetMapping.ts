/**
 * Pure helpers for DCF spreadsheet ↔ DCF session synchronization.
 *
 * Keep this file free of Convex imports so it can be unit-tested in Vitest.
 */

export const DCF_SHEET = {
  columns: {
    item: 0,
    value: 1,
    unit: 2,
  },
  rows: {
    revenueGrowthStart: 6, // rows 6..10 are Year 1..5 growth
    revenueGrowthEnd: 10,
    terminalGrowth: 11,
    riskFreeRate: 14,
    beta: 15,
    marketRiskPremium: 16,
  },
  outputs: {
    wacc: 19,
    enterpriseValue: 20,
    equityValue: 21,
    fairValuePerShare: 22,
    evaluationScore: 23,
  },
} as const;

export function mapCellToField(row: number, col: number): string | null {
  if (col !== DCF_SHEET.columns.value) return null;

  if (row >= DCF_SHEET.rows.revenueGrowthStart && row <= DCF_SHEET.rows.revenueGrowthEnd) {
    const index = row - DCF_SHEET.rows.revenueGrowthStart;
    return `revenueGrowthRates[${index}]`;
  }
  if (row === DCF_SHEET.rows.terminalGrowth) return "terminalGrowth";
  if (row === DCF_SHEET.rows.riskFreeRate) return "riskFreeRate";
  if (row === DCF_SHEET.rows.beta) return "beta";
  if (row === DCF_SHEET.rows.marketRiskPremium) return "marketRiskPremium";
  return null;
}

function isRateField(fieldPath: string): boolean {
  // Fields stored as decimals in the DCF session but shown as percent in the sheet.
  return (
    fieldPath.startsWith("revenueGrowthRates[") ||
    fieldPath === "terminalGrowth" ||
    fieldPath === "riskFreeRate" ||
    fieldPath === "marketRiskPremium" ||
    fieldPath === "costOfDebt" ||
    fieldPath === "taxRate" ||
    fieldPath === "debtWeight"
  );
}

export function parseNumericInput(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const cleaned = raw.trim().replace(/%/g, "");
    const num = Number.parseFloat(cleaned);
    if (!Number.isFinite(num)) throw new Error(`Invalid numeric value: ${raw}`);
    return num;
  }
  throw new Error(`Invalid numeric value type: ${typeof raw}`);
}

export function normalizeDCFParameterValue(fieldPath: string, rawValue: unknown): number {
  const num = parseNumericInput(rawValue);

  if (isRateField(fieldPath)) {
    // Heuristic: if user/agent supplies "4.2" meaning 4.2%, store as 0.042.
    return num > 1 ? num / 100 : num;
  }

  return num;
}

export function parseFieldPath(fieldPath: string): { baseField: string; arrayIndex: number | null } {
  const m = fieldPath.match(/^([a-zA-Z]+)(?:\[(\d+)\])?$/);
  if (!m) throw new Error(`Invalid field path: ${fieldPath}`);
  return { baseField: m[1], arrayIndex: m[2] ? Number.parseInt(m[2], 10) : null };
}

export function getParameterAtPath(parameters: Record<string, any>, fieldPath: string): any {
  const { baseField, arrayIndex } = parseFieldPath(fieldPath);
  if (!(baseField in parameters)) throw new Error(`Unknown parameter field: ${baseField}`);
  const value = (parameters as any)[baseField];
  if (arrayIndex === null) return value;
  if (!Array.isArray(value)) throw new Error(`Field is not an array: ${baseField}`);
  return value[arrayIndex];
}

export function setParameterAtPath<T extends Record<string, any>>(
  parameters: T,
  fieldPath: string,
  newValue: any,
): T {
  const { baseField, arrayIndex } = parseFieldPath(fieldPath);
  if (!(baseField in parameters)) throw new Error(`Unknown parameter field: ${baseField}`);

  const next = { ...(parameters as any) };
  if (arrayIndex === null) {
    next[baseField] = newValue;
    return next as T;
  }

  const arr = next[baseField];
  if (!Array.isArray(arr)) throw new Error(`Field is not an array: ${baseField}`);
  const copy = [...arr];
  copy[arrayIndex] = newValue;
  next[baseField] = copy;
  return next as T;
}

