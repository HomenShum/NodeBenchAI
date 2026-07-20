import { describe, expect, test } from "vitest";
import {
  getParameterAtPath,
  mapCellToField,
  normalizeDCFParameterValue,
  setParameterAtPath,
} from "../../convex/domains/financial/dcfSpreadsheetMapping";

describe("dcfSpreadsheetMapping", () => {
  test("mapCellToField maps editable input cells", () => {
    expect(mapCellToField(6, 1)).toBe("revenueGrowthRates[0]");
    expect(mapCellToField(10, 1)).toBe("revenueGrowthRates[4]");
    expect(mapCellToField(11, 1)).toBe("terminalGrowth");
    expect(mapCellToField(14, 1)).toBe("riskFreeRate");
    expect(mapCellToField(15, 1)).toBe("beta");
    expect(mapCellToField(16, 1)).toBe("marketRiskPremium");
  });

  test("mapCellToField ignores non-editable cells", () => {
    expect(mapCellToField(6, 0)).toBeNull();
    expect(mapCellToField(19, 1)).toBeNull(); // output row
    expect(mapCellToField(0, 1)).toBeNull();
  });

  test("normalizeDCFParameterValue converts percent-like inputs for rate fields", () => {
    expect(normalizeDCFParameterValue("riskFreeRate", "4.2")).toBeCloseTo(0.042, 6);
    expect(normalizeDCFParameterValue("riskFreeRate", "4.2%")).toBeCloseTo(0.042, 6);
    expect(normalizeDCFParameterValue("terminalGrowth", 3)).toBeCloseTo(0.03, 6);
    expect(normalizeDCFParameterValue("revenueGrowthRates[0]", "15")).toBeCloseTo(0.15, 6);
  });

  test("normalizeDCFParameterValue leaves non-rate fields as-is", () => {
    expect(normalizeDCFParameterValue("beta", "1.25")).toBeCloseTo(1.25, 6);
    expect(normalizeDCFParameterValue("beta", 0.9)).toBeCloseTo(0.9, 6);
  });

  test("getParameterAtPath and setParameterAtPath support arrays", () => {
    const params = {
      beta: 1.2,
      revenueGrowthRates: [0.1, 0.08, 0.06, 0.05, 0.04],
    };
    expect(getParameterAtPath(params, "beta")).toBe(1.2);
    expect(getParameterAtPath(params, "revenueGrowthRates[1]")).toBe(0.08);

    const next = setParameterAtPath(params, "revenueGrowthRates[1]", 0.09);
    expect(next.revenueGrowthRates[1]).toBe(0.09);
    expect(params.revenueGrowthRates[1]).toBe(0.08); // immutable update
  });
});

