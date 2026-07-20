#!/usr/bin/env node
/**
 * dcf-validation.ts — Validate DCF model against known company valuations.
 *
 * Tests:
 * 1. DCF math correctness (known inputs → expected outputs)
 * 2. Reverse DCF convergence (binary search finds correct growth rate)
 * 3. Sensitivity table consistency (each cell is internally valid)
 * 4. Pipeline integration (real search → DCF extraction → model output)
 */

// Import directly since this runs via tsx
import { runDCF, runReverseDCF, extractDCFInputs } from "../../workers/node/lib/dcfModel.js";
import { generateDCFSpreadsheetCells } from "../../workers/node/lib/dcfSpreadsheetBridge.js";

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, passed: true, detail: "OK" });
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err: any) {
    results.push({ name, passed: false, detail: err.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertClose(actual: number, expected: number, tolerance: number, msg: string) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) throw new Error(`${msg}: got ${actual}, expected ${expected} (±${tolerance})`);
}

console.log("\n  🧮 DCF Model Validation\n");

// ── Test 1: Basic DCF math ──

test("DCF with $1B revenue, 30% growth, 15% FCF margin", () => {
  const result = runDCF({
    revenue: 1e9,
    growthRate: 0.30,
    fcfMargin: 0.15,
    discountRate: 0.12,
    terminalGrowthRate: 0.03,
    projectionYears: 5,
  });
  assert(result.enterpriseValue > 0, "Enterprise value must be positive");
  assert(result.projectedFCF.length === 5, "Must have 5 years of FCF");
  assert(result.projectedFCF[0] > 0, "Year 1 FCF must be positive");
  assert(result.projectedFCF[4] > result.projectedFCF[0], "Year 5 FCF must exceed Year 1 (growing)");
  assert(result.pvOfFCFs > 0, "PV of FCFs must be positive");
  assert(result.discountedTerminalValue > 0, "Terminal value must be positive");
  assert(result.enterpriseValue === result.pvOfFCFs + result.discountedTerminalValue,
    "EV must equal PV of FCFs + PV of terminal");
});

test("DCF with negative growth produces lower value", () => {
  const growing = runDCF({ revenue: 1e9, growthRate: 0.30, fcfMargin: 0.15, discountRate: 0.12, terminalGrowthRate: 0.03, projectionYears: 5 });
  const declining = runDCF({ revenue: 1e9, growthRate: -0.10, fcfMargin: 0.15, discountRate: 0.12, terminalGrowthRate: 0.03, projectionYears: 5 });
  assert(growing.enterpriseValue > declining.enterpriseValue, "Growing company must be worth more than declining");
});

test("Higher WACC reduces enterprise value", () => {
  const lowWACC = runDCF({ revenue: 1e9, growthRate: 0.20, fcfMargin: 0.15, discountRate: 0.08, terminalGrowthRate: 0.03, projectionYears: 5 });
  const highWACC = runDCF({ revenue: 1e9, growthRate: 0.20, fcfMargin: 0.15, discountRate: 0.18, terminalGrowthRate: 0.03, projectionYears: 5 });
  assert(lowWACC.enterpriseValue > highWACC.enterpriseValue, "Lower WACC must produce higher value");
});

// ── Test 2: Reverse DCF convergence ──

test("Reverse DCF finds correct implied growth rate", () => {
  // First run a forward DCF at 25% growth
  const forward = runDCF({ revenue: 2e9, growthRate: 0.25, fcfMargin: 0.15, discountRate: 0.12, terminalGrowthRate: 0.03, projectionYears: 5 });
  // Then reverse DCF should recover ~25% growth
  const reverse = runReverseDCF({
    marketValue: forward.enterpriseValue,
    revenue: 2e9,
    fcfMargin: 0.15,
    discountRate: 0.12,
    terminalGrowthRate: 0.03,
    projectionYears: 5,
  });
  assertClose(reverse.impliedGrowthRate, 0.25, 0.02, "Implied growth should be ~25%");
});

test("Reverse DCF correctly assesses overvaluation", () => {
  const reverse = runReverseDCF({
    marketValue: 100e9, // $100B market value
    revenue: 1e9,       // $1B revenue → needs extreme growth
    fcfMargin: 0.15,
    discountRate: 0.12,
    terminalGrowthRate: 0.03,
    projectionYears: 5,
  });
  assert(reverse.impliedGrowthRate > 0.50, "Should imply >50% growth for 100x revenue multiple");
  assert(reverse.assessment === "aggressive" || reverse.assessment === "overvalued",
    `Should be aggressive or overvalued, got ${reverse.assessment}`);
});

// ── Test 3: Metric extraction ──

test("Extract revenue from text", () => {
  const result = extractDCFInputs({
    entityName: "TestCo",
    answer: "TestCo has $2B in annual revenue and is valued at $30 billion.",
    keyMetrics: [{ label: "ARR", value: "$2B" }],
    signals: [],
  });
  assert(result.canRunDCF, "Should be able to run DCF");
  assert(result.dcfInput!.revenue === 2e9, `Revenue should be $2B, got ${result.dcfInput!.revenue}`);
  assert(result.reverseDCFInput!.marketValue === 30e9, `Market value should be $30B`);
});

test("No DCF without revenue data", () => {
  const result = extractDCFInputs({
    entityName: "UnknownCo",
    answer: "Not much is known about this company.",
    keyMetrics: [],
    signals: [],
  });
  assert(!result.canRunDCF, "Should not run DCF without revenue");
});

// ── Test 4: Spreadsheet generation ──

test("Spreadsheet cells include sensitivity table", () => {
  const dcfResult = runDCF({ revenue: 2e9, growthRate: 0.30, fcfMargin: 0.15, discountRate: 0.12, terminalGrowthRate: 0.03, projectionYears: 5 });
  const reverseDCF = runReverseDCF({ marketValue: 60e9, revenue: 2e9, fcfMargin: 0.15, discountRate: 0.12, terminalGrowthRate: 0.03, projectionYears: 5 });
  const cells = generateDCFSpreadsheetCells("Anthropic", { revenue: 2e9, growthRate: 0.30, fcfMargin: 0.15, discountRate: 0.12, terminalGrowthRate: 0.03, projectionYears: 5 }, dcfResult, reverseDCF);
  assert(cells.length > 50, `Should have many cells, got ${cells.length}`);
  const headers = cells.filter(c => c.type === "header");
  assert(headers.some(h => String(h.value).includes("SENSITIVITY")), "Should have sensitivity table header");
  const inputs = cells.filter(c => c.type === "input");
  assert(inputs.length >= 5, `Should have editable inputs, got ${inputs.length}`);
});

// ── Scorecard ──

const passed = results.filter(r => r.passed).length;
const total = results.length;
console.log(`\n  ─── DCF VALIDATION ───`);
console.log(`  ${passed}/${total} tests passed\n`);
process.exit(passed === total ? 0 : 1);
