/**
 * Scenario test for the validator.
 *
 * Persona: a reviewer who needs to know exactly what failed and why,
 * without rerunning the full agent. The validator must:
 *   - Emit specific findings per failure (no "validation failed")
 *   - Count what it actually checked (HONEST_SCORES)
 *   - Surface low-confidence values as warnings, not errors (review, not fail)
 *
 * Coverage axes (per scenario_testing.md):
 *   1. Who: financial reviewer reading a validation card.
 *   2. What: confirms required fields, units, sanity ranges, confidence.
 *   3. How: feed extraction output → expect exact findings list.
 *   4. Scale: handles 100 fields without dropping a finding.
 *   5. Duration: idempotent across repeats.
 *   6. Failure modes: missing required, wrong unit, out of range, low confidence.
 */

import { describe, it, expect } from "vitest";
import { validateExtraction, type FieldSpec } from "../validators";
import type { ExtractedField } from "../types";

const TAX_SPEC: FieldSpec[] = [
  {
    fieldName: "Income before income taxes",
    expectedUnit: "USD_millions",
    required: true,
    sanityRange: { min: 0, max: 5_000_000 },
  },
  {
    fieldName: "Income tax expense",
    expectedUnit: "USD_millions",
    required: true,
  },
  {
    fieldName: "Weighted average debt rate",
    expectedUnit: "decimal",
    required: true,
    sanityRange: { min: 0, max: 0.5 },
  },
];

function field(
  overrides: Partial<ExtractedField> = {},
): ExtractedField {
  return {
    fieldName: "Income before income taxes",
    value: 22450,
    unit: "USD_millions",
    sourceRef: "10-K p.72",
    confidence: 0.97,
    status: "verified",
    ...overrides,
  };
}

describe("validator — scenario coverage", () => {
  it("happy path: 3 verified fields → schema passes, 0 findings", () => {
    const r = validateExtraction({
      fields: [
        field(),
        field({
          fieldName: "Income tax expense",
          value: 3785,
        }),
        field({
          fieldName: "Weighted average debt rate",
          value: 0.0542,
          unit: "decimal",
        }),
      ],
      spec: TAX_SPEC,
    });
    expect(r.schemaPassed).toBe(true);
    expect(r.unitsNormalized).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.checksPassed).toBe(r.checksRun);
  });

  it("low confidence → warning finding, not schema fail", () => {
    const r = validateExtraction({
      fields: [
        field({ confidence: 0.97 }),
        field({ fieldName: "Income tax expense", value: 3785 }),
        field({
          fieldName: "Weighted average debt rate",
          value: 0.0542,
          unit: "decimal",
          confidence: 0.85, // below 0.9 threshold
        }),
      ],
      spec: TAX_SPEC,
    });
    expect(r.schemaPassed).toBe(true);
    expect(r.findings.some((f) => f.level === "warning" && f.message.includes("0.85"))).toBe(true);
  });

  it("missing required field → schema fails with specific finding", () => {
    const r = validateExtraction({
      fields: [field({ value: null })],
      spec: TAX_SPEC,
    });
    expect(r.schemaPassed).toBe(false);
    const errors = r.findings.filter((f) => f.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("Income before income taxes");
  });

  it("wrong unit → unitsNormalized false + warning finding", () => {
    const r = validateExtraction({
      fields: [
        field({ unit: "USD_thousands" }),
        field({ fieldName: "Income tax expense", value: 3785 }),
        field({
          fieldName: "Weighted average debt rate",
          value: 0.0542,
          unit: "decimal",
        }),
      ],
      spec: TAX_SPEC,
    });
    expect(r.unitsNormalized).toBe(false);
    expect(
      r.findings.some(
        (f) => f.level === "warning" && f.message.includes("USD_thousands"),
      ),
    ).toBe(true);
  });

  it("out-of-range debt rate → warning finding, not schema fail", () => {
    const r = validateExtraction({
      fields: [
        field(),
        field({ fieldName: "Income tax expense", value: 3785 }),
        field({
          fieldName: "Weighted average debt rate",
          value: 0.85, // out of range (max 0.5)
          unit: "decimal",
        }),
      ],
      spec: TAX_SPEC,
    });
    expect(r.schemaPassed).toBe(true);
    expect(
      r.findings.some(
        (f) => f.level === "warning" && f.message.includes("outside sanity range"),
      ),
    ).toBe(true);
  });

  it("scale: 100 fields produces deterministic finding count", () => {
    const fields: ExtractedField[] = Array.from({ length: 100 }, (_, i) =>
      field({
        fieldName: `Income before income taxes`,
        confidence: i % 2 === 0 ? 0.95 : 0.5,
      }),
    );
    const r = validateExtraction({
      fields,
      spec: [TAX_SPEC[0]],
    });
    // Required check counts for `[0]` once + 100 unit checks + low-conf warnings.
    // The deterministic property: same inputs → same totals.
    const r2 = validateExtraction({
      fields,
      spec: [TAX_SPEC[0]],
    });
    expect(r.checksRun).toBe(r2.checksRun);
    expect(r.findings.length).toBe(r2.findings.length);
  });
});
