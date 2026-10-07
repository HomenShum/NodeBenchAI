/**
 * Credit-agreement covenant compliance fixture — Example C.
 *
 * Demo numbers chosen to land inside the leverage covenant (3.55x vs
 * 4.25x cap) so the deterministic sandbox produces a clean "compliant"
 * verdict. Real implementations should hit a covenant-extractor backed
 * by an LLM section reader.
 */

export const COVENANT_FIXTURE = {
  meta: {
    borrower: "Demo Borrower Inc.",
    creditAgreementFile: "credit_agreement.pdf",
    financialsFile: "q4_financials.xlsx",
  },

  sections: [
    {
      page: 42,
      label: "Financial Covenants",
      match: "Maximum Total Net Leverage Ratio",
    },
    {
      page: 87,
      label: "Definitions — Consolidated EBITDA",
      match: "Consolidated EBITDA",
    },
    {
      page: 91,
      label: "Definitions — Total Net Debt",
      match: "Total Net Debt",
    },
  ],

  covenant: {
    name: "Maximum Total Net Leverage Ratio",
    threshold: 4.25,
    ratioType: "Total Net Debt / Consolidated EBITDA",
    numeratorDefinition: "Total Net Debt = total debt - unrestricted cash",
    denominatorDefinition: "Consolidated EBITDA (with permitted add-backs)",
  },

  // Inputs in dollars (full units, not millions, so the formatter shows $.XM)
  inputs: {
    totalDebt: {
      value: 840_000_000,
      sourceRef: "Q4 Financials — Debt Schedule!B14",
      confidence: 0.96,
    },
    cash: {
      value: 95_000_000,
      sourceRef: "Q4 Financials — Balance Sheet!B21",
      confidence: 0.98,
    },
    adjustedEBITDA: {
      value: 210_000_000,
      sourceRef: "Q4 Financials — Adjusted EBITDA!B37",
      confidence: 0.88,
    },
  },

  excerpts: [
    {
      sourceRef: "Credit Agreement p.42",
      excerpt:
        "Borrower shall not permit the Total Net Leverage Ratio at the end of any fiscal quarter to exceed 4.25 to 1.00.",
    },
    {
      sourceRef: "Credit Agreement p.87",
      excerpt:
        "\"Consolidated EBITDA\" means, for any period, the sum of net income plus interest expense, taxes, depreciation, amortization, and certain permitted non-recurring add-backs.",
    },
  ],
} as const;
