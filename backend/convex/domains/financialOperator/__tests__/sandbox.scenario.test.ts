/**
 * Scenario test for the financial sandbox.
 *
 * Persona: a financial analyst who needs the same number twice in a row,
 * across many runs, with no surprises. The compute must be:
 *   - Deterministic (replay exactness)
 *   - Honest about errors (zero ratios, NaN, out-of-range)
 *   - Bounded (no silent NaN propagation into a published artifact)
 *
 * This test models all six scenario axes (per .claude/rules/scenario_testing):
 *   1. Who: analyst replaying a published metric.
 *   2. What: ETR + after-tax cost of debt + leverage + variance.
 *   3. How: known inputs → expected outputs to 4 decimal places.
 *   4. Scale: 1k repeats — same input must always yield same output.
 *   5. Duration: long-running — 1k iterations, each must equal the first.
 *   6. Failure modes: divide-by-zero, out-of-range, NaN.
 */

import { describe, it, expect } from "vitest";
import {
  checkCompliance,
  computeAfterTaxCostOfDebt,
  computeETR,
  computeLeverageRatio,
  computeVariance,
} from "../sandbox";

describe("financial sandbox — scenario coverage", () => {
  describe("happy path: AT&T 10-K demo numbers", () => {
    const ibt = 22450;
    const ite = 3785;
    const debtRate = 0.0542;

    it("produces the documented ETR (~16.86%)", () => {
      const r = computeETR({
        incomeBeforeTaxes: ibt,
        incomeTaxExpense: ite,
      });
      expect(r.outputs.etr).toBeCloseTo(0.1686, 4);
      expect(r.formattedOutputs.etr).toBe("16.86%");
      expect(r.sandboxKind).toBe("js_pure");
    });

    it("produces the documented after-tax cost of debt (~4.51%)", () => {
      const etr = computeETR({
        incomeBeforeTaxes: ibt,
        incomeTaxExpense: ite,
      }).outputs.etr;
      const r = computeAfterTaxCostOfDebt({
        preTaxDebtRate: debtRate,
        effectiveTaxRate: etr,
      });
      expect(r.outputs.afterTaxCostOfDebt).toBeCloseTo(0.0451, 4);
      expect(r.formattedOutputs.afterTaxCostOfDebt).toBe("4.51%");
    });
  });

  describe("long-running determinism: 1000 replays", () => {
    it("ETR is bit-identical across 1000 calls", () => {
      const inputs = { incomeBeforeTaxes: 22450, incomeTaxExpense: 3785 };
      const baseline = computeETR(inputs).outputs.etr;
      for (let i = 0; i < 1000; i++) {
        const r = computeETR(inputs);
        // Stronger than toBeCloseTo — must be identical bytes.
        expect(r.outputs.etr).toBe(baseline);
      }
    });

    it("leverage ratio is bit-identical across 1000 calls", () => {
      const inputs = { totalDebt: 840_000_000, cash: 95_000_000, ebitda: 210_000_000 };
      const baseline = computeLeverageRatio(inputs).outputs.ratio;
      for (let i = 0; i < 1000; i++) {
        const r = computeLeverageRatio(inputs);
        expect(r.outputs.ratio).toBe(baseline);
      }
    });
  });

  describe("sad paths: must throw, never silent NaN", () => {
    it("ETR rejects zero income before taxes", () => {
      expect(() =>
        computeETR({ incomeBeforeTaxes: 0, incomeTaxExpense: 100 }),
      ).toThrow(/incomeBeforeTaxes/);
    });

    it("ETR rejects NaN inputs", () => {
      expect(() =>
        computeETR({ incomeBeforeTaxes: Number.NaN, incomeTaxExpense: 100 }),
      ).toThrow(/not finite/);
    });

    it("after-tax cost of debt rejects out-of-range ETR", () => {
      expect(() =>
        computeAfterTaxCostOfDebt({ preTaxDebtRate: 0.05, effectiveTaxRate: 1.5 }),
      ).toThrow(/ETR_OUT_OF_RANGE/);
      expect(() =>
        computeAfterTaxCostOfDebt({ preTaxDebtRate: 0.05, effectiveTaxRate: -0.1 }),
      ).toThrow(/ETR_OUT_OF_RANGE/);
    });

    it("leverage rejects zero EBITDA (would otherwise divide by zero)", () => {
      expect(() =>
        computeLeverageRatio({ totalDebt: 1000, cash: 100, ebitda: 0 }),
      ).toThrow(/ebitda/);
    });

    it("variance rejects zero budget (would otherwise produce Infinity)", () => {
      expect(() => computeVariance({ actual: 100, budget: 0 })).toThrow(
        /BUDGET_ZERO/,
      );
    });
  });

  describe("compliance gate: covenant scenario", () => {
    it("flags compliant when net leverage ≤ threshold", () => {
      const lev = computeLeverageRatio({
        totalDebt: 840_000_000,
        cash: 95_000_000,
        ebitda: 210_000_000,
      });
      const c = checkCompliance({
        observedRatio: lev.outputs.ratio,
        threshold: 4.25,
        ratioName: "net_leverage",
      });
      expect(c.outputs.compliant).toBe(1);
      expect(c.outputs.headroom).toBeGreaterThan(0);
    });

    it("flags breach when ratio > threshold (no fake VERIFIED)", () => {
      const c = checkCompliance({
        observedRatio: 5.1,
        threshold: 4.25,
        ratioName: "net_leverage",
      });
      expect(c.outputs.compliant).toBe(0);
      expect(c.outputs.headroom).toBeLessThan(0);
      expect(c.formattedOutputs.compliant).toBe("breach");
    });
  });

  describe("variance: signed formatting both directions", () => {
    it("favorable variance shows + sign", () => {
      const r = computeVariance({ actual: 4_200_000, budget: 3_700_000 });
      expect(r.outputs.variance).toBe(500_000);
      expect(r.formattedOutputs.variance.startsWith("+")).toBe(true);
    });

    it("unfavorable variance shows raw negative without +", () => {
      const r = computeVariance({ actual: 3_500_000, budget: 3_700_000 });
      expect(r.outputs.variance).toBe(-200_000);
      expect(r.formattedOutputs.variance.startsWith("+")).toBe(false);
    });
  });
});
