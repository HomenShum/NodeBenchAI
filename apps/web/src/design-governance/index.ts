/**
 * Design Governance — public API.
 *
 * Usage:
 *   import { spec, isApprovedColor, getViolationsForSource } from '../design-governance';
 */

export type {
  DesignGovernanceSpec,
  BannedPattern,
  ColorBudget,
  TypographyRules,
  UppercasePolicy,
  SpacingRules,
  ComponentRules,
  StateRules,
  MotionRules,
  BorderRadiusRules,
} from "./spec";

export { DEFAULT_SPEC, getAllBannedPatterns } from "./defaultSpec";

import { DEFAULT_SPEC, getAllBannedPatterns } from "./defaultSpec";
import type { BannedPattern } from "./spec";

// ── Helpers ───────────────────────────────────────────────────

/** Check if a Tailwind color class is in the approved semantic set. */
export function isApprovedColor(className: string): boolean {
  const semantic = DEFAULT_SPEC.colorBudget.approvedSemanticColors;
  // Match patterns like bg-surface, text-content-secondary, border-edge, etc.
  for (const token of semantic) {
    if (
      className.includes(`bg-${token}`) ||
      className.includes(`text-${token}`) ||
      className.includes(`border-${token}`) ||
      className.includes(`ring-${token}`)
    ) {
      return true;
    }
  }
  // Allow approved accent shades (e.g. bg-indigo-600)
  const family = DEFAULT_SPEC.colorBudget.accentFamily;
  for (const shade of DEFAULT_SPEC.colorBudget.approvedAccentShades) {
    if (className.includes(`${family}-${shade}`)) return true;
  }
  return false;
}

/** Check if a typography class is in the approved set. */
export function isApprovedTypography(className: string): boolean {
  const allClasses = Object.values(DEFAULT_SPEC.typography.contextClasses).flat();
  return allClasses.some((c) => className.includes(c));
}

/** Check if uppercase usage is allowed in context. */
export function isUppercaseAllowed(className: string): boolean {
  return DEFAULT_SPEC.typography.uppercasePolicy.allowedClasses.some((c) =>
    className.includes(c),
  );
}

// ── Violation scanning ────────────────────────────────────────

export interface Violation {
  line: number;
  column: number;
  match: string;
  label: string;
  severity: "high" | "medium" | "low";
  category: string;
  fixSuggestion?: string;
}

/**
 * Scan source text for design governance violations.
 * @param source - File content as string
 * @param filePath - File path (used for exclude matching)
 * @returns Array of violations sorted by severity (high first)
 */
export function getViolationsForSource(
  source: string,
  filePath: string,
): Violation[] {
  const violations: Violation[] = [];
  const patterns = getAllBannedPatterns();

  for (const bp of patterns) {
    // Check file exclusions
    if (bp.excludeFiles?.some((exc) => filePath.includes(exc))) continue;

    const regex = new RegExp(bp.pattern, bp.flags);
    const lines = source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match: RegExpExecArray | null;

      // Reset regex for each line (global flag)
      regex.lastIndex = 0;
      while ((match = regex.exec(line)) !== null) {
        violations.push({
          line: i + 1,
          column: match.index + 1,
          match: match[0],
          label: bp.label,
          severity: bp.severity,
          category: bp.category,
          fixSuggestion: bp.fixSuggestion,
        });
      }
    }
  }

  // Sort: high → medium → low
  const order = { high: 0, medium: 1, low: 2 };
  violations.sort((a, b) => order[a.severity] - order[b.severity]);

  return violations;
}

/**
 * Summary stats from a list of violations.
 */
export function summarizeViolations(violations: Violation[]): {
  total: number;
  high: number;
  medium: number;
  low: number;
  byCategory: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};
  let high = 0,
    medium = 0,
    low = 0;

  for (const v of violations) {
    if (v.severity === "high") high++;
    else if (v.severity === "medium") medium++;
    else low++;
    byCategory[v.category] = (byCategory[v.category] || 0) + 1;
  }

  return { total: violations.length, high, medium, low, byCategory };
}
