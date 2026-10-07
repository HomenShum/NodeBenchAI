/**
 * Schema + unit validators for extracted financial inputs.
 *
 * Pattern: HONEST_SCORES (per .claude/rules/agentic_reliability.md).
 * Each validator counts what it actually checked. No hardcoded floors.
 * Findings are surfaced verbatim to the user, never swallowed.
 */

import type { ExtractedField, ValidationFinding } from "./types";

export interface ValidationResult {
  schemaPassed: boolean;
  unitsNormalized: boolean;
  findings: ValidationFinding[];
  checksRun: number;
  checksPassed: number;
}

export interface FieldSpec {
  fieldName: string;
  expectedUnit: string;          // "USD_millions" | "decimal" | "percent"
  required: boolean;
  // Optional sanity range — if set and value is outside, emit warning.
  sanityRange?: { min: number; max: number };
}

const CONFIDENCE_REVIEW_THRESHOLD = 0.9;

export function validateExtraction(args: {
  fields: ExtractedField[];
  spec: FieldSpec[];
}): ValidationResult {
  const findings: ValidationFinding[] = [];
  let checksRun = 0;
  let checksPassed = 0;
  let schemaPassed = true;
  let unitsNormalized = true;

  // 1. Required-field check
  for (const required of args.spec.filter((s) => s.required)) {
    checksRun++;
    const found = args.fields.find((f) => f.fieldName === required.fieldName);
    if (!found || found.value === null || found.value === undefined) {
      findings.push({
        level: "error",
        message: `Required field "${required.fieldName}" missing`,
        fieldRef: required.fieldName,
      });
      schemaPassed = false;
    } else {
      checksPassed++;
    }
  }

  // 2. Unit-match check
  for (const field of args.fields) {
    const spec = args.spec.find((s) => s.fieldName === field.fieldName);
    if (!spec) continue;
    checksRun++;
    if (field.unit && field.unit !== spec.expectedUnit) {
      findings.push({
        level: "warning",
        message: `Field "${field.fieldName}" has unit "${field.unit}", expected "${spec.expectedUnit}"`,
        fieldRef: field.fieldName,
      });
      unitsNormalized = false;
    } else {
      checksPassed++;
    }
  }

  // 3. Sanity-range check (optional)
  for (const field of args.fields) {
    const spec = args.spec.find((s) => s.fieldName === field.fieldName);
    if (!spec || !spec.sanityRange) continue;
    if (typeof field.value !== "number") continue;
    checksRun++;
    if (
      field.value < spec.sanityRange.min ||
      field.value > spec.sanityRange.max
    ) {
      findings.push({
        level: "warning",
        message: `Field "${field.fieldName}" value ${field.value} outside sanity range [${spec.sanityRange.min}, ${spec.sanityRange.max}]`,
        fieldRef: field.fieldName,
      });
    } else {
      checksPassed++;
    }
  }

  // 4. Confidence review-flag (informational, NOT a fail)
  for (const field of args.fields) {
    if (field.confidence < CONFIDENCE_REVIEW_THRESHOLD) {
      findings.push({
        level: "warning",
        message: `Field "${field.fieldName}" source confidence ${field.confidence.toFixed(2)} below ${CONFIDENCE_REVIEW_THRESHOLD}. Human review recommended.`,
        fieldRef: field.fieldName,
      });
    }
  }

  return {
    schemaPassed,
    unitsNormalized,
    findings,
    checksRun,
    checksPassed,
  };
}
