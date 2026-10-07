/**
 * AT&T 10-K 2024 fixture — pinned values for the operator-console demo.
 *
 * These numbers stand in for what a real PDF/XBRL extractor would produce.
 * They are demo data: stable, citable, and obviously approximate. The
 * sandbox compute uses them deterministically — same input, same output.
 *
 * Replace with live extraction once `document.locate_sections` and
 * `finance.extract_tax_and_debt_inputs` are wired to a real PDF reader.
 */

export interface AttSourceSection {
  page: number;
  label: string;
  matches: string[];
}

export const ATT_FIXTURE = {
  meta: {
    company: "AT&T Inc.",
    ticker: "T",
    fiscalYear: 2024,
    filingType: "10-K",
    filingUrl: "https://investors.att.com/financial-reports", // disclosure: not fetched live
  },

  // Locate-sections result
  sections: [
    {
      page: 72,
      label: "Consolidated Statement of Income",
      matches: ["income before income taxes", "income tax expense"],
    },
    {
      page: 118,
      label: "Long-Term Debt Footnote",
      matches: ["weighted average interest rate"],
    },
  ] as AttSourceSection[],

  // Extracted financial values (demo numbers — illustrative only).
  // Units: dollars in millions; rates as decimal.
  extracted: {
    incomeBeforeTaxes: {
      value: 22450,
      unit: "USD_millions",
      sourceRef: "10-K p.72",
      confidence: 0.97,
    },
    incomeTaxExpense: {
      value: 3785,
      unit: "USD_millions",
      sourceRef: "10-K p.72",
      confidence: 0.94,
    },
    weightedAverageInterestRate: {
      value: 0.0542,
      unit: "decimal",
      sourceRef: "10-K p.118",
      confidence: 0.89, // intentionally below 0.90 → triggers needs_review
    },
  },

  // Source excerpts shown in evidence card
  excerpts: [
    {
      sourceRef: "10-K p.72",
      excerpt:
        "Income before income taxes: $22,450M. Income tax expense: $3,785M.",
    },
    {
      sourceRef: "10-K p.118",
      excerpt:
        "Weighted average interest rate on long-term debt was approximately 5.42% as of December 31, 2024.",
    },
  ],
} as const;

export type AttFixture = typeof ATT_FIXTURE;
