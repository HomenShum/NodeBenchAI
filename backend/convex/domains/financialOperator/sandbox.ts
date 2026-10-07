/**
 * Deterministic JS sandbox for financial computations.
 *
 * RULE: this module is the ONLY place math runs in the operator console.
 * The agent (LLM) MUST NOT compute ratios, percentages, or rollups in
 * its prompt — it gets the values from extractors, calls one of these
 * pure functions, and surfaces the result.
 *
 * Pattern: scratchpad-first + agent-as-orchestrator. The LLM is the
 * conductor, not the calculator. (Per .claude/rules/scratchpad_first.md
 * and Anthropic "Building Effective Agents".)
 *
 * All functions:
 *   - Pure (no I/O, no clock)
 *   - Throw typed errors on invalid input (no silent NaN)
 *   - Return both raw numbers and pre-formatted display strings
 */

export type SandboxKind = "js_pure";

export interface SandboxResult<T extends Record<string, number>> {
  inputs: Record<string, number>;
  outputs: T;
  formattedOutputs: Record<keyof T, string>;
  formulaText: string;
  sandboxKind: SandboxKind;
}

class FinancialSandboxError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    // Prefix code so callers can pattern-match on it in error.message.
    super(`[${code}] ${message}`);
    this.code = code;
    this.name = "FinancialSandboxError";
  }
}

function requireFinite(name: string, n: number): number {
  if (!Number.isFinite(n)) {
    throw new FinancialSandboxError("NOT_FINITE", `${name} is not finite`);
  }
  return n;
}

function requirePositive(name: string, n: number): number {
  if (n <= 0) {
    throw new FinancialSandboxError(
      "NOT_POSITIVE",
      `${name} must be > 0, got ${n}`,
    );
  }
  return n;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function ratio(n: number): string {
  return `${n.toFixed(2)}x`;
}

function usdMillions(n: number): string {
  return `$${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Effective tax rate = income tax expense / income before taxes
 *
 * Inputs in same currency unit (typically USD millions).
 * Returns ETR as decimal (0..1).
 */
export function computeETR(args: {
  incomeBeforeTaxes: number;
  incomeTaxExpense: number;
}): SandboxResult<{ etr: number }> {
  const ibt = requireFinite("incomeBeforeTaxes", args.incomeBeforeTaxes);
  const ite = requireFinite("incomeTaxExpense", args.incomeTaxExpense);
  requirePositive("incomeBeforeTaxes", ibt);

  const etr = ite / ibt;

  return {
    inputs: { incomeBeforeTaxes: ibt, incomeTaxExpense: ite },
    outputs: { etr },
    formattedOutputs: { etr: pct(etr) },
    formulaText: "etr = income_tax_expense / income_before_taxes",
    sandboxKind: "js_pure",
  };
}

/**
 * After-tax cost of debt = pre-tax debt rate × (1 − ETR)
 *
 * Pre-tax rate as decimal (0.0542 for 5.42%).
 */
export function computeAfterTaxCostOfDebt(args: {
  preTaxDebtRate: number;
  effectiveTaxRate: number;
}): SandboxResult<{ afterTaxCostOfDebt: number }> {
  const r = requireFinite("preTaxDebtRate", args.preTaxDebtRate);
  const etr = requireFinite("effectiveTaxRate", args.effectiveTaxRate);
  if (etr < 0 || etr > 1) {
    throw new FinancialSandboxError(
      "ETR_OUT_OF_RANGE",
      `effectiveTaxRate must be in [0,1], got ${etr}`,
    );
  }
  const afterTax = r * (1 - etr);

  return {
    inputs: { preTaxDebtRate: r, effectiveTaxRate: etr },
    outputs: { afterTaxCostOfDebt: afterTax },
    formattedOutputs: { afterTaxCostOfDebt: pct(afterTax) },
    formulaText:
      "after_tax_cost_of_debt = pre_tax_debt_rate * (1 - effective_tax_rate)",
    sandboxKind: "js_pure",
  };
}

/**
 * Net leverage ratio = (total debt − cash) / EBITDA
 *
 * All inputs in same currency unit.
 */
export function computeLeverageRatio(args: {
  totalDebt: number;
  cash: number;
  ebitda: number;
}): SandboxResult<{ netDebt: number; ratio: number }> {
  const d = requireFinite("totalDebt", args.totalDebt);
  const c = requireFinite("cash", args.cash);
  const e = requireFinite("ebitda", args.ebitda);
  requirePositive("ebitda", e);

  const netDebt = d - c;
  const r = netDebt / e;

  return {
    inputs: { totalDebt: d, cash: c, ebitda: e },
    outputs: { netDebt, ratio: r },
    formattedOutputs: {
      netDebt: usdMillions(netDebt),
      ratio: ratio(r),
    },
    formulaText:
      "net_debt = total_debt - cash; leverage = net_debt / ebitda",
    sandboxKind: "js_pure",
  };
}

/**
 * Variance = actual - budget; variancePct = variance / budget.
 *
 * Returns both raw values and signed-percent for display.
 */
export function computeVariance(args: {
  actual: number;
  budget: number;
}): SandboxResult<{ variance: number; variancePct: number }> {
  const a = requireFinite("actual", args.actual);
  const b = requireFinite("budget", args.budget);
  if (b === 0) {
    throw new FinancialSandboxError(
      "BUDGET_ZERO",
      "Cannot compute variance pct with zero budget",
    );
  }
  const variance = a - b;
  const variancePct = variance / b;
  const sign = variance >= 0 ? "+" : "";
  return {
    inputs: { actual: a, budget: b },
    outputs: { variance, variancePct },
    formattedOutputs: {
      variance: `${sign}${usdMillions(variance)}`,
      variancePct: `${sign}${pct(variancePct)}`,
    },
    formulaText: "variance = actual - budget; variance_pct = variance / budget",
    sandboxKind: "js_pure",
  };
}

/**
 * Compliance check: ratio ≤ threshold.
 * Returns the boolean and the "headroom" (threshold - ratio).
 */
export function checkCompliance(args: {
  observedRatio: number;
  threshold: number;
  ratioName: string;
}): SandboxResult<{ headroom: number; compliant: 0 | 1 }> {
  const r = requireFinite("observedRatio", args.observedRatio);
  const t = requireFinite("threshold", args.threshold);
  const compliant: 0 | 1 = r <= t ? 1 : 0;
  const headroom = t - r;
  return {
    inputs: { observedRatio: r, threshold: t },
    outputs: { headroom, compliant },
    formattedOutputs: {
      headroom: ratio(headroom),
      compliant: compliant === 1 ? "compliant" : "breach",
    },
    formulaText: `compliant = ${args.ratioName} <= threshold`,
    sandboxKind: "js_pure",
  };
}
