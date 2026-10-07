/**
 * dcfSpreadsheetBridge.ts — Bridge Pipeline v2 DCF results to the existing
 * Convex spreadsheet infrastructure.
 *
 * Flow:
 * 1. Pipeline v2 produces DCFResult + ReverseDCFResult
 * 2. This bridge creates a Convex DCF session from those results
 * 3. Existing dcfSpreadsheetAdapter generates the live spreadsheet
 * 4. User opens spreadsheet in the Library surface → full interactive model
 *
 * Anthropic Cowork pattern: search → model → spreadsheet → sensitivity table
 */

import type { DCFResult, ReverseDCFResult, DCFInput } from "./dcfModel.js";

// ─── Spreadsheet cell layout for DCF model ───────────────────────

export interface DCFSpreadsheetCell {
  row: number;
  col: number;
  value: string | number;
  type: "label" | "input" | "formula" | "header";
  comment?: string;
}

/**
 * Generate a complete DCF spreadsheet layout from pipeline results.
 * Returns cells that can be rendered by react-spreadsheet or exported to XLSX.
 */
export function generateDCFSpreadsheetCells(
  entityName: string,
  dcfInput: DCFInput,
  dcfResult: DCFResult,
  reverseDCF: ReverseDCFResult | null,
): DCFSpreadsheetCell[] {
  const cells: DCFSpreadsheetCell[] = [];
  const years = dcfInput.projectionYears;

  // ── Header ──
  cells.push({ row: 0, col: 0, value: `${entityName} — DCF Valuation Model`, type: "header" });
  cells.push({ row: 0, col: years + 1, value: "NodeBench Pipeline v2", type: "label" });

  // ── Assumptions section ──
  cells.push({ row: 2, col: 0, value: "ASSUMPTIONS", type: "header" });
  cells.push({ row: 3, col: 0, value: "Current Revenue", type: "label" });
  cells.push({ row: 3, col: 1, value: dcfInput.revenue, type: "input", comment: "Annual revenue or ARR (editable)" });
  cells.push({ row: 4, col: 0, value: "Revenue Growth Rate", type: "label" });
  cells.push({ row: 4, col: 1, value: `${(dcfInput.growthRate * 100).toFixed(0)}%`, type: "input", comment: "Assumed annual growth (editable)" });
  cells.push({ row: 5, col: 0, value: "FCF Margin", type: "label" });
  cells.push({ row: 5, col: 1, value: `${(dcfInput.fcfMargin * 100).toFixed(0)}%`, type: "input", comment: "Free cash flow as % of revenue (editable)" });
  cells.push({ row: 6, col: 0, value: "WACC / Discount Rate", type: "label" });
  cells.push({ row: 6, col: 1, value: `${(dcfInput.discountRate * 100).toFixed(0)}%`, type: "input", comment: "Weighted average cost of capital (editable)" });
  cells.push({ row: 7, col: 0, value: "Terminal Growth Rate", type: "label" });
  cells.push({ row: 7, col: 1, value: `${(dcfInput.terminalGrowthRate * 100).toFixed(1)}%`, type: "input", comment: "Long-term sustainable growth (editable)" });

  // ── Projections ──
  cells.push({ row: 9, col: 0, value: "PROJECTIONS", type: "header" });

  // Year headers
  cells.push({ row: 10, col: 0, value: "", type: "label" });
  for (let y = 0; y < years; y++) {
    cells.push({ row: 10, col: y + 1, value: `Year ${y + 1}`, type: "header" });
  }
  cells.push({ row: 10, col: years + 1, value: "Terminal", type: "header" });

  // Projected revenue
  cells.push({ row: 11, col: 0, value: "Revenue", type: "label" });
  let rev = dcfInput.revenue;
  for (let y = 0; y < years; y++) {
    rev *= (1 + dcfInput.growthRate);
    cells.push({ row: 11, col: y + 1, value: Math.round(rev), type: "formula" });
  }

  // Projected FCF
  cells.push({ row: 12, col: 0, value: "Free Cash Flow", type: "label" });
  for (let y = 0; y < years; y++) {
    cells.push({ row: 12, col: y + 1, value: dcfResult.projectedFCF[y], type: "formula" });
  }
  cells.push({ row: 12, col: years + 1, value: Math.round(dcfResult.terminalValue), type: "formula", comment: "Terminal value (Gordon Growth)" });

  // Discounted FCF
  cells.push({ row: 13, col: 0, value: "Discounted FCF", type: "label" });
  for (let y = 0; y < years; y++) {
    cells.push({ row: 13, col: y + 1, value: dcfResult.discountedFCF[y], type: "formula" });
  }
  cells.push({ row: 13, col: years + 1, value: Math.round(dcfResult.discountedTerminalValue), type: "formula" });

  // ── Valuation summary ──
  cells.push({ row: 15, col: 0, value: "VALUATION", type: "header" });
  cells.push({ row: 16, col: 0, value: "PV of FCFs", type: "label" });
  cells.push({ row: 16, col: 1, value: dcfResult.pvOfFCFs, type: "formula" });
  cells.push({ row: 17, col: 0, value: "PV of Terminal Value", type: "label" });
  cells.push({ row: 17, col: 1, value: Math.round(dcfResult.discountedTerminalValue), type: "formula" });
  cells.push({ row: 18, col: 0, value: "Enterprise Value (DCF)", type: "label" });
  cells.push({ row: 18, col: 1, value: dcfResult.enterpriseValue, type: "formula", comment: "Intrinsic value from DCF" });

  // ── Reverse DCF (if available) ──
  if (reverseDCF) {
    cells.push({ row: 20, col: 0, value: "REVERSE DCF", type: "header" });
    cells.push({ row: 21, col: 0, value: "Market Value", type: "label" });
    cells.push({ row: 21, col: 1, value: reverseDCF.dcfAtImpliedRate.enterpriseValue, type: "input" });
    cells.push({ row: 22, col: 0, value: "Implied Growth Rate", type: "label" });
    cells.push({ row: 22, col: 1, value: `${(reverseDCF.impliedGrowthRate * 100).toFixed(1)}%`, type: "formula" });
    cells.push({ row: 23, col: 0, value: "Assessment", type: "label" });
    cells.push({ row: 23, col: 1, value: reverseDCF.assessment.replace(/_/g, " ").toUpperCase(), type: "formula" });
    cells.push({ row: 24, col: 0, value: "Explanation", type: "label" });
    cells.push({ row: 24, col: 1, value: reverseDCF.explanation.slice(0, 200), type: "label" });

    // ── Sensitivity table (growth rate vs WACC) ──
    cells.push({ row: 26, col: 0, value: "SENSITIVITY TABLE", type: "header" });
    cells.push({ row: 27, col: 0, value: "EV at different Growth / WACC", type: "label" });

    const growthRates = [0.15, 0.20, 0.25, 0.30, 0.40, 0.50];
    const waccRates = [0.08, 0.10, 0.12, 0.15, 0.18];

    // WACC headers
    cells.push({ row: 28, col: 0, value: "Growth \\ WACC →", type: "header" });
    waccRates.forEach((w, i) => {
      cells.push({ row: 28, col: i + 1, value: `${(w * 100).toFixed(0)}%`, type: "header" });
    });

    // Sensitivity grid
    growthRates.forEach((g, gi) => {
      cells.push({ row: 29 + gi, col: 0, value: `${(g * 100).toFixed(0)}%`, type: "label" });
      waccRates.forEach((w, wi) => {
        // Quick DCF calc for each combo
        let r = dcfInput.revenue;
        let pvFCF = 0;
        for (let y = 1; y <= years; y++) {
          r *= (1 + g);
          const fcf = r * dcfInput.fcfMargin;
          pvFCF += fcf / Math.pow(1 + w, y);
        }
        const termFCF = r * (1 + g) * dcfInput.fcfMargin * (1 + dcfInput.terminalGrowthRate);
        const tv = termFCF / Math.max(0.01, w - dcfInput.terminalGrowthRate);
        const pvTV = tv / Math.pow(1 + w, years);
        const ev = Math.round(pvFCF + pvTV);
        cells.push({ row: 29 + gi, col: wi + 1, value: ev, type: "formula" });
      });
    });
  }

  return cells;
}

/**
 * Convert DCF spreadsheet cells to a 2D array for react-spreadsheet rendering.
 */
export function cellsToGrid(cells: DCFSpreadsheetCell[]): Array<Array<{ value: string; className?: string }>> {
  const maxRow = Math.max(...cells.map(c => c.row), 0);
  const maxCol = Math.max(...cells.map(c => c.col), 0);

  const grid: Array<Array<{ value: string; className?: string }>> = [];
  for (let r = 0; r <= maxRow; r++) {
    const row: Array<{ value: string; className?: string }> = [];
    for (let c = 0; c <= maxCol; c++) {
      row.push({ value: "" });
    }
    grid.push(row);
  }

  for (const cell of cells) {
    const className =
      cell.type === "header" ? "font-bold text-accent-primary" :
      cell.type === "input" ? "bg-blue-500/10 text-blue-300" :
      cell.type === "formula" ? "tabular-nums" :
      "text-content-muted";

    grid[cell.row][cell.col] = {
      value: typeof cell.value === "number"
        ? cell.value >= 1e9 ? `$${(cell.value / 1e9).toFixed(1)}B`
          : cell.value >= 1e6 ? `$${(cell.value / 1e6).toFixed(0)}M`
            : cell.value.toLocaleString()
        : String(cell.value),
      className,
    };
  }

  return grid;
}
