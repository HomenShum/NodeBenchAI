/**
 * Founder Strategy Ground Truth
 *
 * Ground truth definitions for Founder/Strategy persona evaluations.
 */

import type {
  BaseGroundTruth,
  ClaimVerificationScenario,
} from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// FOUNDER_STRATEGY GROUND TRUTH
// ═══════════════════════════════════════════════════════════════════════════

export interface MarketAnalysisGroundTruth extends BaseGroundTruth {
  entityType: "company";

  market: {
    category: string;
    tam: string;
    sam: string;
    som: string;
    growthRate: number;
    maturityStage: "emerging" | "growth" | "mature" | "declining";
  };

  competition: {
    directCompetitors: Array<{
      name: string;
      marketShare: number;
      funding: string;
      positioning: string;
    }>;
    indirectCompetitors: string[];
    substitutes: string[];
    barriers: string[];
  };

  positioning: {
    wedge: string;
    differentiation: string[];
    unfairAdvantages: string[];
    risks: string[];
  };

  goToMarket: {
    primaryChannel: string;
    salesMotion: "PLG" | "Sales-led" | "Hybrid" | "Channel";
    targetCustomer: string;
    averageContractValue?: string;
  };
}

/**
 * DevToolsAI - Ground truth for Founder/Strategy evaluation
 *
 * A realistic AI developer tools company for competitive analysis.
 */
export const DEVTOOLSAI_GROUND_TRUTH: MarketAnalysisGroundTruth = {
  entityName: "DevToolsAI Market Analysis",
  entityType: "company",
  description: "AI-powered developer productivity tools competitive analysis",
  expectedOutcome: "pass",

  market: {
    category: "AI Developer Tools",
    tam: "$50B (Global Developer Tools)",
    sam: "$12B (AI-assisted Development)",
    som: "$800M (AI Code Assistants)",
    growthRate: 35,
    maturityStage: "growth",
  },

  competition: {
    directCompetitors: [
      {
        name: "GitHub Copilot",
        marketShare: 45,
        funding: "Microsoft-backed",
        positioning: "Integrated into GitHub/VSCode ecosystem",
      },
      {
        name: "Cursor",
        marketShare: 15,
        funding: "Series B $400M",
        positioning: "AI-native IDE",
      },
      {
        name: "Codeium",
        marketShare: 10,
        funding: "Series C $150M",
        positioning: "Free tier, enterprise focus",
      },
    ],
    indirectCompetitors: ["JetBrains AI", "Amazon CodeWhisperer"],
    substitutes: ["Traditional IDEs", "Stack Overflow", "Documentation"],
    barriers: ["Data moat", "Model training costs", "IDE integration complexity"],
  },

  positioning: {
    wedge: "Enterprise security and on-prem deployment",
    differentiation: [
      "SOC 2 Type II compliant from day 1",
      "On-premise deployment option",
      "Custom model fine-tuning",
      "Code never leaves customer environment",
    ],
    unfairAdvantages: [
      "Former security engineers from Google/Meta",
      "Enterprise sales network from founders",
      "Proprietary training data from OSS contributions",
    ],
    risks: [
      "Microsoft/GitHub competitive response",
      "Enterprise sales cycle length",
      "Model performance parity",
    ],
  },

  goToMarket: {
    primaryChannel: "Enterprise direct sales",
    salesMotion: "Sales-led",
    targetCustomer: "Fortune 500 engineering teams",
    averageContractValue: "$250K ARR",
  },
};

/**
 * Alternative case: Weak competitive position
 */
export const WEAK_POSITION_GROUND_TRUTH: MarketAnalysisGroundTruth = {
  entityName: "MeToo AI Tools",
  entityType: "company",
  description: "Undifferentiated AI tools with poor competitive position",
  expectedOutcome: "flag",

  market: {
    category: "AI Developer Tools",
    tam: "$50B",
    sam: "$12B",
    som: "$50M",
    growthRate: 35,
    maturityStage: "growth",
  },

  competition: {
    directCompetitors: [
      {
        name: "GitHub Copilot",
        marketShare: 45,
        funding: "Microsoft-backed",
        positioning: "Market leader",
      },
    ],
    indirectCompetitors: ["Every major tech company"],
    substitutes: ["Free alternatives"],
    barriers: ["None identified"],
  },

  positioning: {
    wedge: "Cheaper pricing",
    differentiation: [],
    unfairAdvantages: [],
    risks: [
      "No differentiation",
      "Race to bottom on pricing",
      "Well-funded competitors",
      "No moat",
    ],
  },

  goToMarket: {
    primaryChannel: "Self-serve",
    salesMotion: "PLG",
    targetCustomer: "Individual developers",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM VERIFICATION SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

export const FOUNDER_STRATEGY_CLAIM_SCENARIOS: ClaimVerificationScenario[] = [
  {
    id: "founder_market_size",
    personaId: "FOUNDER_STRATEGY",
    name: "Market Size Verification",
    query: "Verify AI developer tools TAM is $50B with 35% growth rate",
    claims: [
      {
        claim: "TAM is $50B",
        category: "market",
        expectedVerdict: "verified",
        verificationSource: "Gartner/IDC reports",
      },
      {
        claim: "Market growth rate is 35%",
        category: "market",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["gartner.com", "idc.com", "statista.com"],
    passingThreshold: 70,
  },
  {
    id: "founder_competition",
    personaId: "FOUNDER_STRATEGY",
    name: "Competitive Landscape",
    query: "Map competitive landscape for AI code assistants including GitHub Copilot market share",
    claims: [
      {
        claim: "GitHub Copilot is market leader",
        category: "competition",
        expectedVerdict: "verified",
      },
      {
        claim: "Cursor raised Series B",
        category: "competition",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["techcrunch.com", "crunchbase.com", "company announcements"],
    passingThreshold: 65,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT ALL
// ═══════════════════════════════════════════════════════════════════════════

export const FOUNDER_STRATEGY_GROUND_TRUTHS = {
  devToolsAI: DEVTOOLSAI_GROUND_TRUTH,
  weakPosition: WEAK_POSITION_GROUND_TRUTH,
};
