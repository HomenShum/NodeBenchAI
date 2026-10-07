/**
 * Financial extractors — produce typed {fields, sources} from inputs.
 *
 * Each extractor:
 *   - Takes raw inputs (or a fixture for the demo)
 *   - Returns ExtractedField[] with sourceRef + confidence + status
 *   - Flags low-confidence values as needs_review (HONEST_SCORES)
 *
 * The extractor itself is pure. The orchestrator action wraps it in a
 * tool_call step + an extraction step so the chat renders the work.
 *
 * NOTE: the extractor signatures are designed so that swapping a fixture
 * for a real PDF reader (e.g. a future `extractFromPdfAnalysis(...)`)
 * does not change the orchestrator. Only the data source changes.
 */

import { ATT_FIXTURE } from "./attFixture";
import type { ExtractedField } from "./types";

const REVIEW_THRESHOLD = 0.9;

function classifyStatus(confidence: number): ExtractedField["status"] {
  if (confidence >= REVIEW_THRESHOLD) return "verified";
  if (confidence >= 0.5) return "needs_review";
  return "unresolved";
}

/**
 * Extract income tax + debt rate inputs for an ETR / after-tax cost of debt
 * calculation. Demo wiring: returns AT&T fixture values.
 */
export function extractTaxAndDebtInputs(): {
  fields: ExtractedField[];
  sections: Array<{ page: number; label: string }>;
} {
  const f = ATT_FIXTURE.extracted;

  const fields: ExtractedField[] = [
    {
      fieldName: "Income before income taxes",
      value: f.incomeBeforeTaxes.value,
      unit: f.incomeBeforeTaxes.unit,
      sourceRef: f.incomeBeforeTaxes.sourceRef,
      confidence: f.incomeBeforeTaxes.confidence,
      status: classifyStatus(f.incomeBeforeTaxes.confidence),
    },
    {
      fieldName: "Income tax expense",
      value: f.incomeTaxExpense.value,
      unit: f.incomeTaxExpense.unit,
      sourceRef: f.incomeTaxExpense.sourceRef,
      confidence: f.incomeTaxExpense.confidence,
      status: classifyStatus(f.incomeTaxExpense.confidence),
    },
    {
      fieldName: "Weighted average debt rate",
      value: f.weightedAverageInterestRate.value,
      unit: f.weightedAverageInterestRate.unit,
      sourceRef: f.weightedAverageInterestRate.sourceRef,
      confidence: f.weightedAverageInterestRate.confidence,
      status: classifyStatus(f.weightedAverageInterestRate.confidence),
      reviewNote:
        "Debt-rate footnote requires manual confirmation before final approval.",
    },
  ];

  const sections = ATT_FIXTURE.sections.map((s) => ({
    page: s.page,
    label: s.label,
  }));

  return { fields, sections };
}

/**
 * Locate-sections tool result. Demo: returns AT&T fixture sections.
 * Real impl would call a PDF section finder (heading detection + grep).
 */
export function locateSectionsForTaxAndDebt() {
  return ATT_FIXTURE.sections.slice();
}

/**
 * Evidence anchors — short excerpts paired with source refs for the
 * evidence card. Demo: returns AT&T fixture excerpts.
 */
export function gatherEvidenceForTaxAndDebt() {
  return ATT_FIXTURE.excerpts.map((e) => ({
    label: ATT_FIXTURE.sections.find((s) =>
      e.sourceRef.includes(`p.${s.page}`),
    )?.label ?? "Source",
    sourceRef: e.sourceRef,
    excerpt: e.excerpt,
  }));
}
