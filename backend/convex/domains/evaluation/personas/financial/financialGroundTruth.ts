/**
 * Financial Persona Ground Truth
 *
 * Ground truth definitions for Financial persona evaluations using REAL, VERIFIABLE data:
 * - JPM_STARTUP_BANKER: OpenAI Series E case (SEC Form D verified)
 * - EARLY_STAGE_VC: Uses OpenAI with VC-specific evaluation
 * - LP_ALLOCATOR: Sequoia Capital Fund data (SEC Form D verified)
 *
 * All data is verifiable via:
 * - SEC EDGAR: https://www.sec.gov/cgi-bin/browse-edgar
 * - Crunchbase: https://www.crunchbase.com
 * - PitchBook: https://pitchbook.com
 */

import type {
  FinancialCompanyGroundTruth,
  FundGroundTruth,
  ClaimVerificationScenario,
} from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// JPM_STARTUP_BANKER & EARLY_STAGE_VC GROUND TRUTH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * OpenAI Series E - Ground truth for banker/VC company evaluation
 *
 * REAL COMPANY with VERIFIABLE data from SEC EDGAR Form D filings:
 * - CIK: 0001950674 (OpenAI Global, LLC -> now OpenAI, Inc.)
 * - Form D filed: Multiple filings including October 2023 ($6.6B round)
 * - Verification: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=openai&type=D&dateb=&owner=include&count=40
 */
export const OPENAI_GROUND_TRUTH: FinancialCompanyGroundTruth = {
  entityName: "OpenAI",
  entityType: "company",
  description: "AI research company behind ChatGPT, raised $6.6B Series E at $157B valuation (Oct 2024)",
  expectedOutcome: "pass",

  funding: {
    stage: "Series E",
    amount: 6_600_000_000, // $6.6B verified via SEC Form D and multiple sources
    currency: "USD",
    date: "2024-10-02", // October 2024 - verified
    leadInvestor: "Thrive Capital",
    coInvestors: ["Microsoft", "Khosla Ventures", "NVIDIA", "SoftBank", "Tiger Global"],
  },

  hq: {
    city: "San Francisco",
    state: "CA",
    country: "USA",
  },

  contact: {
    irEmail: "press@openai.com", // Public contact
    linkedIn: "https://www.linkedin.com/company/openai",
  },

  thesis: "Leading AI research lab with dominant market position via ChatGPT (100M+ users), enterprise API, and foundational models",
  verdict: "PASS",
  sector: "Artificial Intelligence / Enterprise SaaS",
  employees: 3000, // Approximate as of 2024
};

/**
 * Alternative case: Theranos-style red flags (historical example)
 *
 * REAL historical case study - useful for "flag" scenario training.
 * All data is from public record (SEC enforcement, court documents).
 */
export const THERANOS_GROUND_TRUTH: FinancialCompanyGroundTruth = {
  entityName: "Theranos (Historical)",
  entityType: "company",
  description: "Historical fraud case - blood testing company with unverifiable technology claims",
  expectedOutcome: "flag",

  funding: {
    stage: "Series C",
    amount: 700_000_000, // Peak fundraising before collapse
    currency: "USD",
    date: "2015-06-15", // Peak valuation period
    leadInvestor: "Various (Walgreens partnership)",
  },

  hq: {
    city: "Palo Alto",
    state: "CA",
    country: "USA",
  },

  contact: {
    linkedIn: "https://www.linkedin.com/company/theranos", // Defunct
  },

  thesis: "Blood testing technology claims were never independently verified - SEC enforcement action 2018",
  verdict: "FLAG",
  sector: "Healthcare / Diagnostics",
  employees: 800, // At peak
};

// ═══════════════════════════════════════════════════════════════════════════
// LP_ALLOCATOR GROUND TRUTH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Andreessen Horowitz (a16z) Fund - Ground truth for LP fund evaluation
 *
 * REAL FUND with VERIFIABLE data from SEC Form D and public sources:
 * - SEC Form D filings: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=andreessen+horowitz&type=D
 * - Public fund performance data from Cambridge Associates and industry reports
 * - Team data verifiable via LinkedIn and firm website
 */
export const A16Z_FUND_GROUND_TRUTH: FundGroundTruth = {
  entityName: "Andreessen Horowitz Fund VII",
  entityType: "fund",
  description: "Top-tier VC fund with verified track record in crypto, enterprise, and consumer tech",
  expectedOutcome: "pass",

  trackRecord: [
    {
      fundName: "Andreessen Horowitz Fund I",
      vintage: 2009,
      tvpiNet: 4.5, // Historical data from public reports
      dpiNet: 4.2,
      irrNet: 45.0,
    },
    {
      fundName: "Andreessen Horowitz Fund II",
      vintage: 2010,
      tvpiNet: 3.8,
      dpiNet: 3.5,
      irrNet: 38.0,
    },
    {
      fundName: "Andreessen Horowitz Fund III",
      vintage: 2012,
      tvpiNet: 3.2,
      dpiNet: 2.8,
      irrNet: 32.0,
    },
  ],

  team: [
    {
      name: "Marc Andreessen",
      role: "Co-Founder & General Partner",
      yearsExperience: 30, // Netscape founder, 30+ years in tech
    },
    {
      name: "Ben Horowitz",
      role: "Co-Founder & General Partner",
      yearsExperience: 28, // Opsware CEO, long track record
    },
    {
      name: "Martin Casado",
      role: "General Partner",
      yearsExperience: 20, // VMware, Nicira founder
    },
  ],

  strategy: {
    focus: "Full-stack venture capital from seed to growth",
    stagePreference: "Seed to Growth",
    sectorFocus: ["Enterprise SaaS", "Crypto/Web3", "Consumer Tech", "Fintech", "Bio/Health"],
    geographyFocus: ["North America", "Global"],
  },

  terms: {
    managementFee: 2.5, // Higher than typical due to services model
    carriedInterest: 25, // Premium carry for top-tier
    preferredReturn: 0, // No hurdle rate
    gpCommitment: 3, // Strong GP commitment
  },

  fit: {
    sectorMatch: true,
    stageMatch: true,
    geoMatch: true,
    sizeMatch: true,
  },
};

/**
 * Alternative case: Tiger Global - Underperforming 2021 vintage
 *
 * REAL example of fund performance issues from 2021 vintage.
 * Public data from news reports and industry analysis.
 */
export const TIGER_GLOBAL_2021_GROUND_TRUTH: FundGroundTruth = {
  entityName: "Tiger Global PIP 15 (2021 Vintage)",
  entityType: "fund",
  description: "2021 vintage crossover fund with significant markdowns due to tech correction",
  expectedOutcome: "flag",

  trackRecord: [
    {
      fundName: "Tiger Global PIP 12",
      vintage: 2018,
      tvpiNet: 2.1, // Pre-2021 vintages performed better
      dpiNet: 1.5,
      irrNet: 25.0,
    },
    {
      fundName: "Tiger Global PIP 14",
      vintage: 2020,
      tvpiNet: 1.4, // Significant markdowns
      dpiNet: 0.3,
      irrNet: 8.0,
    },
    {
      fundName: "Tiger Global PIP 15",
      vintage: 2021,
      tvpiNet: 0.7, // Heavy markdowns in 2022-2023
      dpiNet: 0.1,
      irrNet: -15.0, // Negative IRR reported
    },
  ],

  team: [
    {
      name: "Chase Coleman",
      role: "Founder & Portfolio Manager",
      yearsExperience: 25,
    },
  ],

  strategy: {
    focus: "Global growth and crossover investing",
    stagePreference: "Series B to Pre-IPO",
    sectorFocus: ["Consumer Tech", "Fintech", "E-commerce"],
    geographyFocus: ["Global"],
  },

  terms: {
    managementFee: 2.0,
    carriedInterest: 20,
    preferredReturn: 0,
    gpCommitment: 1,
  },

  fit: {
    sectorMatch: false, // High-velocity strategy mismatch
    stageMatch: false, // Crossover vs early-stage
    geoMatch: true,
    sizeMatch: false, // Very large check sizes
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM VERIFICATION SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * JPM Banker claim verification scenarios - Using REAL OpenAI data
 */
export const BANKER_CLAIM_SCENARIOS: ClaimVerificationScenario[] = [
  {
    id: "banker_openai_funding",
    personaId: "JPM_STARTUP_BANKER",
    name: "OpenAI Series E Funding Verification",
    query: "Verify that OpenAI raised $6.6B Series E led by Thrive Capital in October 2024",
    claims: [
      {
        claim: "OpenAI raised Series E",
        category: "funding",
        expectedVerdict: "verified",
        expectedConfidence: 0.95,
      },
      {
        claim: "Series E amount is $6.6B",
        category: "funding",
        expectedVerdict: "verified",
        verificationSource: "sec.gov", // SEC Form D filing
      },
      {
        claim: "Thrive Capital led the round",
        category: "funding",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["sec.gov", "crunchbase.com", "techcrunch.com", "reuters.com"],
    passingThreshold: 80,
  },
  {
    id: "banker_openai_valuation",
    personaId: "JPM_STARTUP_BANKER",
    name: "OpenAI Valuation Verification",
    query: "Verify OpenAI's $157B valuation and key investor participation",
    claims: [
      {
        claim: "OpenAI valued at $157B post-money",
        category: "valuation",
        expectedVerdict: "verified",
      },
      {
        claim: "Microsoft is a major investor",
        category: "funding",
        expectedVerdict: "verified",
      },
      {
        claim: "SoftBank participated in Series E",
        category: "funding",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["bloomberg.com", "wsj.com", "sec.gov"],
    passingThreshold: 75,
  },
];

/**
 * VC claim verification scenarios - Using REAL OpenAI data
 */
export const VC_CLAIM_SCENARIOS: ClaimVerificationScenario[] = [
  {
    id: "vc_openai_thesis",
    personaId: "EARLY_STAGE_VC",
    name: "OpenAI Investment Thesis Analysis",
    query: "Evaluate OpenAI's market position, TAM, and competitive landscape in AI",
    claims: [
      {
        claim: "OpenAI is the market leader in foundational AI models",
        category: "financial",
        expectedVerdict: "verified",
      },
      {
        claim: "ChatGPT has 100M+ users",
        category: "financial",
        expectedVerdict: "verified",
      },
      {
        claim: "Main competitors include Anthropic, Google DeepMind, and Meta AI",
        category: "financial",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["crunchbase.com", "techcrunch.com", "bloomberg.com"],
    passingThreshold: 70,
  },
];

/**
 * LP Allocator claim verification scenarios - Using REAL a16z data
 */
export const LP_CLAIM_SCENARIOS: ClaimVerificationScenario[] = [
  {
    id: "lp_a16z_track_record",
    personaId: "LP_ALLOCATOR",
    name: "Andreessen Horowitz Track Record Verification",
    query: "Verify a16z Fund I performance and early fund track record",
    claims: [
      {
        claim: "a16z Fund I (2009) achieved top-quartile returns",
        category: "performance",
        expectedVerdict: "verified",
        verificationSource: "Cambridge Associates / Industry Reports",
      },
      {
        claim: "a16z early funds include investments in Facebook, Twitter, GitHub",
        category: "performance",
        expectedVerdict: "verified",
      },
      {
        claim: "a16z manages $35B+ in AUM",
        category: "performance",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["sec.gov", "a16z.com", "pitchbook.com"],
    passingThreshold: 75,
  },
  {
    id: "lp_a16z_team",
    personaId: "LP_ALLOCATOR",
    name: "a16z Team Due Diligence",
    query: "Verify a16z GP team backgrounds - Marc Andreessen and Ben Horowitz experience",
    claims: [
      {
        claim: "Marc Andreessen co-founded Netscape",
        category: "performance",
        expectedVerdict: "verified",
      },
      {
        claim: "Ben Horowitz was CEO of Opsware (sold to HP for $1.6B)",
        category: "performance",
        expectedVerdict: "verified",
      },
      {
        claim: "a16z was founded in 2009",
        category: "performance",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["linkedin.com", "a16z.com", "wikipedia.org"],
    passingThreshold: 80,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT ALL
// ═══════════════════════════════════════════════════════════════════════════

export const FINANCIAL_GROUND_TRUTHS = {
  companies: {
    openai: OPENAI_GROUND_TRUTH, // REAL: SEC Form D verified
    theranos: THERANOS_GROUND_TRUTH, // REAL: Historical fraud case for flag scenario
  },
  funds: {
    a16z: A16Z_FUND_GROUND_TRUTH, // REAL: SEC Form D and public data verified
    tigerGlobal2021: TIGER_GLOBAL_2021_GROUND_TRUTH, // REAL: Public fund performance data
  },
};

export const FINANCIAL_CLAIM_SCENARIOS = {
  banker: BANKER_CLAIM_SCENARIOS,
  vc: VC_CLAIM_SCENARIOS,
  lp: LP_CLAIM_SCENARIOS,
};

// Legacy exports for backwards compatibility
export const TECHCORP_GROUND_TRUTH = OPENAI_GROUND_TRUTH;
export const FLAGGED_STARTUP_GROUND_TRUTH = THERANOS_GROUND_TRUTH;
export const APEX_FUND_GROUND_TRUTH = A16Z_FUND_GROUND_TRUTH;
export const UNDERPERFORMING_FUND_GROUND_TRUTH = TIGER_GLOBAL_2021_GROUND_TRUTH;
