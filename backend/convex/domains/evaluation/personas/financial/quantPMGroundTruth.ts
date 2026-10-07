/**
 * Quant PM Ground Truth
 *
 * Ground truth definitions for Quantitative Portfolio Manager evaluations.
 */

import type {
  BaseGroundTruth,
  ClaimVerificationScenario,
} from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// QUANT_PM GROUND TRUTH
// ═══════════════════════════════════════════════════════════════════════════

export interface QuantStrategyGroundTruth extends BaseGroundTruth {
  entityType: "strategy";

  strategy: {
    name: string;
    type: "factor" | "stat_arb" | "momentum" | "mean_reversion" | "ml_based";
    timeHorizon: "intraday" | "daily" | "weekly" | "monthly";
    assetClass: string[];
  };

  performance: {
    sharpeRatio: number;
    annualizedReturn: number;
    maxDrawdown: number;
    calmarRatio?: number;
    sortinoRatio?: number;
    informationRatio?: number;
  };

  riskMetrics: {
    volatility: number;
    beta: number;
    valueAtRisk95: number;
    expectedShortfall: number;
  };

  backtest: {
    startDate: string;
    endDate: string;
    dataSource: string;
    survivorshipBiasFree: boolean;
    transactionCostsModeled: boolean;
    slippageModeled: boolean;
  };

  factorExposures?: {
    market: number;
    size: number;
    value: number;
    momentum: number;
    quality: number;
    lowVol: number;
  };
}

/**
 * Alpha Momentum Strategy - Ground truth for Quant PM evaluation
 */
export const ALPHA_MOMENTUM_GROUND_TRUTH: QuantStrategyGroundTruth = {
  entityName: "Alpha Momentum Strategy",
  entityType: "strategy",
  description: "Cross-sectional momentum strategy with volatility targeting",
  expectedOutcome: "pass",

  strategy: {
    name: "Alpha Momentum L/S",
    type: "momentum",
    timeHorizon: "monthly",
    assetClass: ["US Equities", "Developed Markets"],
  },

  performance: {
    sharpeRatio: 1.45,
    annualizedReturn: 12.8,
    maxDrawdown: -18.5,
    calmarRatio: 0.69,
    sortinoRatio: 1.92,
    informationRatio: 0.85,
  },

  riskMetrics: {
    volatility: 8.8,
    beta: 0.15,
    valueAtRisk95: -1.8,
    expectedShortfall: -2.5,
  },

  backtest: {
    startDate: "2010-01-01",
    endDate: "2025-12-31",
    dataSource: "CRSP/Compustat merged",
    survivorshipBiasFree: true,
    transactionCostsModeled: true,
    slippageModeled: true,
  },

  factorExposures: {
    market: 0.15,
    size: -0.10,
    value: -0.25,
    momentum: 0.85,
    quality: 0.20,
    lowVol: 0.10,
  },
};

/**
 * Alternative case: Overfitted strategy with poor out-of-sample
 */
export const OVERFITTED_STRATEGY_GROUND_TRUTH: QuantStrategyGroundTruth = {
  entityName: "Overfitted ML Strategy",
  entityType: "strategy",
  description: "ML-based strategy with data snooping concerns",
  expectedOutcome: "flag",

  strategy: {
    name: "Neural Alpha",
    type: "ml_based",
    timeHorizon: "daily",
    assetClass: ["US Equities"],
  },

  performance: {
    sharpeRatio: 3.5, // Suspiciously high
    annualizedReturn: 45.0, // Unrealistic
    maxDrawdown: -5.0,
    calmarRatio: 9.0,
  },

  riskMetrics: {
    volatility: 12.8,
    beta: 0.0, // Claims market neutral
    valueAtRisk95: -0.8,
    expectedShortfall: -1.2,
  },

  backtest: {
    startDate: "2020-01-01",
    endDate: "2024-12-31",
    dataSource: "Proprietary",
    survivorshipBiasFree: false,
    transactionCostsModeled: false,
    slippageModeled: false,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM VERIFICATION SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

export const QUANT_PM_CLAIM_SCENARIOS: ClaimVerificationScenario[] = [
  {
    id: "quant_performance",
    personaId: "QUANT_PM",
    name: "Performance Verification",
    query: "Verify Alpha Momentum strategy has 1.45 Sharpe and 12.8% annual return",
    claims: [
      {
        claim: "Sharpe ratio is 1.45",
        category: "performance",
        expectedVerdict: "verified",
      },
      {
        claim: "Annualized return is 12.8%",
        category: "performance",
        expectedVerdict: "verified",
      },
      {
        claim: "Max drawdown is -18.5%",
        category: "risk",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["backtest report", "factor attribution"],
    passingThreshold: 75,
  },
  {
    id: "quant_methodology",
    personaId: "QUANT_PM",
    name: "Backtest Methodology",
    query: "Assess backtest methodology for survivorship bias and transaction costs",
    claims: [
      {
        claim: "Backtest uses survivorship-bias-free data",
        category: "methodology",
        expectedVerdict: "verified",
      },
      {
        claim: "Transaction costs are modeled",
        category: "methodology",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["methodology documentation", "data vendor specs"],
    passingThreshold: 70,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT ALL
// ═══════════════════════════════════════════════════════════════════════════

export const QUANT_PM_GROUND_TRUTHS = {
  alphaMomentum: ALPHA_MOMENTUM_GROUND_TRUTH,
  overfittedML: OVERFITTED_STRATEGY_GROUND_TRUTH,
};
