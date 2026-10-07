/**
 * Monthly variance-analysis fixture — Example D.
 *
 * Includes a diverse top/bottom mix so the variance sandbox renders
 * both signed-positive and signed-negative formatting paths.
 */

export interface VarianceLine {
  account: string;
  category: "revenue" | "cost_of_revenue" | "opex" | "infrastructure" | "other";
  actual: number;
  budget: number;
  driverNote?: string;
}

export const VARIANCE_FIXTURE = {
  period: "March 2026",
  files: [
    { name: "march_actuals.xlsx", kind: "xlsx" },
    { name: "fy_budget.xlsx", kind: "xlsx" },
  ],
  alignment: {
    matchedAccounts: 124,
    unmatchedActuals: 3,
    unmatchedBudget: 5,
  },
  // Lines in dollars; formatter divides by 1M for display.
  lines: [
    {
      account: "Subscription Revenue",
      category: "revenue",
      actual: 4_200_000,
      budget: 3_700_000,
      driverNote: "Enterprise renewals closed earlier than budgeted.",
    },
    {
      account: "Services Revenue",
      category: "revenue",
      actual: 850_000,
      budget: 900_000,
      driverNote: "One implementation slipped to April.",
    },
    {
      account: "Cloud Infrastructure",
      category: "infrastructure",
      actual: 980_000,
      budget: 720_000,
      driverNote: "GPU inference costs rose with higher agent run volume.",
    },
    {
      account: "Sales Headcount",
      category: "opex",
      actual: 1_100_000,
      budget: 1_150_000,
      driverNote: "Two requisitions delayed by one month.",
    },
    {
      account: "Engineering Headcount",
      category: "opex",
      actual: 1_400_000,
      budget: 1_350_000,
      driverNote: "On plan; small-bonus accrual.",
    },
    {
      account: "Marketing",
      category: "opex",
      actual: 320_000,
      budget: 400_000,
      driverNote: "Demand-gen campaign delayed.",
    },
  ] satisfies VarianceLine[],
} as const;
