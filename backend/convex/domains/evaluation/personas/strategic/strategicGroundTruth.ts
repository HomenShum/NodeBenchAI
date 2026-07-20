/**
 * Strategic Persona Ground Truth
 *
 * Ground truth definitions for Strategic persona evaluations using REAL, VERIFIABLE data:
 * - CORP_DEV: Johnson & Johnson / Shockwave Medical Acquisition ($13.1B, May 2024)
 * - MACRO_STRATEGIST: Fed Policy and FRED Economic Data (verifiable via FRED API)
 *
 * All data is verifiable via:
 * - SEC EDGAR: https://www.sec.gov/cgi-bin/browse-edgar
 * - FRED: https://fred.stlouisfed.org
 * - Reuters, Bloomberg, WSJ for deal announcements
 */

import type {
  MADealGroundTruth,
  MacroEventGroundTruth,
  ClaimVerificationScenario,
} from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// CORP_DEV GROUND TRUTH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Johnson & Johnson / Shockwave Medical - Ground truth for Corp Dev evaluation
 *
 * REAL M&A deal verifiable via SEC EDGAR:
 * - Announced: April 5, 2024
 * - Closed: May 31, 2024
 * - Deal value: $13.1B ($335/share)
 * - SEC 8-K filing: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=shockwave
 */
export const JNJ_SHOCKWAVE_GROUND_TRUTH: MADealGroundTruth = {
  entityName: "J&J Acquisition of Shockwave Medical",
  entityType: "event",
  description: "J&J MedTech acquired Shockwave Medical for $13.1B to expand cardiovascular device portfolio",
  expectedOutcome: "pass",

  deal: {
    acquirer: "Johnson & Johnson (JNJ MedTech)",
    target: "Shockwave Medical Inc. (SWAV)",
    dealValue: "$13.1B", // $335 per share
    dealType: "All-cash",
    announcementDate: "2024-04-05", // REAL date
    expectedClose: "May 2024",
    dealStatus: "Closed", // Completed May 31, 2024
  },

  strategicRationale: {
    synergies: "Significant revenue synergies via J&J MedTech distribution",
    revenueSynergies: "Access to J&J's global cardiovascular sales force",
    costSynergies: "Manufacturing integration, shared R&D infrastructure",
    marketPositionImpact: "Strengthens J&J position in interventional cardiology",
    technologyAcquisition: true, // Intravascular lithotripsy (IVL) technology
    talentAcquisition: true,
  },

  risks: {
    regulatoryRisk: "FTC/DOJ cleared - no major antitrust concerns",
    integrationRisk: "Moderate - established med device company",
    culturalRisk: "Low - both medical device cultures",
    financingRisk: "None - J&J has strong balance sheet",
    customerChurnRisk: "Low - differentiated IVL technology",
  },

  valuation: {
    evRevenue: 18.5, // ~18.5x revenue (premium for growth)
    evEbitda: 50.0, // High multiple for high-growth medical device
    premium: 28, // 28% premium to unaffected share price
    comparableDeals: [
      "Boston Scientific-Axonics ($3.7B, 2024)",
      "Abbott-CSI (Cardiovascular Systems, $890M, 2023)",
    ],
  },
};

/**
 * Alternative case: Spirit Airlines / JetBlue Blocked Merger
 *
 * REAL failed merger - DOJ blocked, verifiable via court documents and SEC filings.
 */
export const JETBLUE_SPIRIT_GROUND_TRUTH: MADealGroundTruth = {
  entityName: "JetBlue-Spirit Airlines Blocked Merger",
  entityType: "event",
  description: "DOJ successfully blocked JetBlue's $3.8B acquisition of Spirit Airlines (Jan 2024)",
  expectedOutcome: "flag",

  deal: {
    acquirer: "JetBlue Airways (JBLU)",
    target: "Spirit Airlines (SAVE)",
    dealValue: "$3.8B", // $33.50 per share
    dealType: "Cash+Stock",
    announcementDate: "2022-07-28",
    expectedClose: "Blocked by DOJ (Jan 2024)",
    dealStatus: "Terminated", // DOJ lawsuit successful
  },

  strategicRationale: {
    synergies: "$600M-$700M annual synergies claimed",
    revenueSynergies: "Expanded route network",
    costSynergies: "Fleet consolidation",
    marketPositionImpact: "Would have created 5th largest US carrier",
    technologyAcquisition: false,
    talentAcquisition: true,
  },

  risks: {
    regulatoryRisk: "CRITICAL - DOJ sued to block, won in federal court Jan 2024",
    integrationRisk: "High - different business models (ULCC vs low-cost)",
    culturalRisk: "High - Spirit's ULCC culture vs JetBlue premium economy",
    financingRisk: "Moderate - required significant debt financing",
    customerChurnRisk: "High - Spirit customers valued ultra-low fares",
  },

  valuation: {
    evRevenue: 0.7,
    evEbitda: 8.0,
    premium: 50, // Significant premium offered
    comparableDeals: [
      "Alaska Air-Hawaiian ($1.9B, 2023 - under DOJ review)",
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// MACRO_STRATEGIST GROUND TRUTH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Federal Reserve December 2024 Rate Decision - Ground truth for Macro Strategist
 *
 * REAL FRED economic data verifiable via Federal Reserve Economic Data:
 * - FRED CPI: https://fred.stlouisfed.org/series/CPIAUCSL
 * - FRED PCE: https://fred.stlouisfed.org/series/PCEPI
 * - FRED Unemployment: https://fred.stlouisfed.org/series/UNRATE
 * - Fed Funds Rate: https://fred.stlouisfed.org/series/FEDFUNDS
 */
export const FED_DEC2024_GROUND_TRUTH: MacroEventGroundTruth = {
  entityName: "Fed December 2024 Rate Decision",
  entityType: "event",
  description: "FOMC cut rates 25bps in Dec 2024 to 4.25-4.50% - real policy analysis",
  expectedOutcome: "pass",

  thesis: {
    event: "FOMC December 18, 2024 Rate Decision",
    currentLevel: "4.25-4.50%", // After Dec 2024 cut
    expectedMove: "-25bps (realized)",
    confidence: 95, // High confidence - already happened
    rationale: "Third consecutive cut: Sep 50bps, Nov 25bps, Dec 25bps",
    timeframe: "December 2024",
  },

  indicators: [
    {
      name: "CPI YoY",
      value: 2.7, // November 2024 actual (FRED: CPIAUCSL)
      unit: "%",
      trend: "falling",
      source: "BLS / FRED CPIAUCSL",
    },
    {
      name: "Core PCE YoY",
      value: 2.8, // November 2024 actual (FRED: PCEPILFE)
      unit: "%",
      trend: "stable",
      source: "BEA / FRED PCEPILFE",
    },
    {
      name: "Unemployment Rate",
      value: 4.2, // November 2024 actual (FRED: UNRATE)
      unit: "%",
      trend: "stable",
      source: "BLS / FRED UNRATE",
    },
    {
      name: "GDP Growth Q3 2024",
      value: 2.8, // Q3 2024 actual (FRED: A191RL1Q225SBEA)
      unit: "%",
      trend: "stable",
      source: "BEA / FRED",
    },
    {
      name: "Fed Funds Effective Rate",
      value: 4.33, // After Dec 2024 cut (FRED: FEDFUNDS)
      unit: "%",
      trend: "falling",
      source: "Fed / FRED FEDFUNDS",
    },
  ],

  risks: {
    upside: "Sticky services inflation, strong consumer spending",
    downside: "Tariff uncertainty, labor market cooling faster than expected",
    tail: "Fiscal policy shock, Treasury market dysfunction",
  },

  positioning: [
    {
      asset: "10Y Treasury",
      direction: "long",
      rationale: "Fed cutting cycle supportive for duration",
    },
    {
      asset: "S&P 500",
      direction: "long",
      rationale: "Soft landing scenario, earnings growth resilient",
    },
    {
      asset: "USD/EUR",
      direction: "neutral",
      rationale: "Both central banks cutting, policy divergence narrowing",
    },
    {
      asset: "Gold",
      direction: "long",
      rationale: "Central bank buying, real rates declining",
    },
  ],
};

/**
 * Alternative case: 2022 Inflation Shock (historical stress test)
 *
 * REAL historical scenario for stress testing - peak inflation June 2022.
 * All data verifiable via FRED.
 */
export const INFLATION_2022_GROUND_TRUTH: MacroEventGroundTruth = {
  entityName: "2022 Inflation Shock (Historical)",
  entityType: "event",
  description: "Peak inflation June 2022 at 9.1% - historical stress test scenario",
  expectedOutcome: "flag",

  thesis: {
    event: "Peak Inflation June 2022",
    currentLevel: "9.1% CPI YoY (June 2022 peak)",
    expectedMove: "Aggressive Fed hiking cycle",
    confidence: 100, // Historical fact
    rationale: "Post-COVID supply chain + fiscal stimulus + energy shock",
    timeframe: "June 2022",
  },

  indicators: [
    {
      name: "CPI YoY Peak",
      value: 9.1, // June 2022 actual (FRED: CPIAUCSL)
      unit: "%",
      trend: "rising",
      source: "BLS / FRED CPIAUCSL",
    },
    {
      name: "Core CPI YoY",
      value: 5.9, // June 2022 (FRED: CPILFESL)
      unit: "%",
      trend: "rising",
      source: "BLS / FRED CPILFESL",
    },
    {
      name: "Fed Funds Target",
      value: 1.75, // After June 2022 75bp hike
      unit: "%",
      trend: "rising",
      source: "Fed / FRED FEDFUNDS",
    },
    {
      name: "10Y Treasury Yield",
      value: 3.5, // June 2022 approximate
      unit: "%",
      trend: "rising",
      source: "Treasury / FRED DGS10",
    },
  ],

  risks: {
    upside: "Faster supply chain normalization",
    downside: "Embedded inflation expectations, wage-price spiral",
    tail: "Volcker-style rate hikes causing deep recession",
  },

  positioning: [
    {
      asset: "Equities",
      direction: "short",
      rationale: "Multiple compression from rising rates",
    },
    {
      asset: "Treasuries",
      direction: "short",
      rationale: "Fed hiking aggressively, yields rising",
    },
    {
      asset: "Commodities",
      direction: "long",
      rationale: "Inflation hedge, energy shock",
    },
    {
      asset: "TIPS",
      direction: "long",
      rationale: "Inflation protection",
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM VERIFICATION SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Corp Dev claim verification scenarios - Using REAL J&J/Shockwave deal
 */
export const CORP_DEV_CLAIM_SCENARIOS: ClaimVerificationScenario[] = [
  {
    id: "corpdev_jnj_shockwave",
    personaId: "CORP_DEV",
    name: "J&J Shockwave Medical Acquisition Verification",
    query: "Verify J&J acquired Shockwave Medical for $13.1B, closed May 2024",
    claims: [
      {
        claim: "J&J acquired Shockwave Medical",
        category: "event",
        expectedVerdict: "verified",
        verificationSource: "SEC 8-K",
      },
      {
        claim: "Deal value was $13.1B ($335/share)",
        category: "financial",
        expectedVerdict: "verified",
      },
      {
        claim: "Deal closed May 31, 2024",
        category: "deal",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["sec.gov", "reuters.com", "wsj.com"],
    passingThreshold: 85,
  },
  {
    id: "corpdev_jetblue_spirit_blocked",
    personaId: "CORP_DEV",
    name: "JetBlue-Spirit DOJ Block Verification",
    query: "Verify DOJ successfully blocked JetBlue-Spirit merger in January 2024",
    claims: [
      {
        claim: "DOJ sued to block JetBlue-Spirit merger",
        category: "regulatory",
        expectedVerdict: "verified",
      },
      {
        claim: "Federal court ruled in favor of DOJ January 2024",
        category: "legal",
        expectedVerdict: "verified",
      },
      {
        claim: "Merger was terminated after court ruling",
        category: "deal",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["justice.gov", "sec.gov", "reuters.com"],
    passingThreshold: 80,
  },
];

/**
 * Macro Strategist claim verification scenarios - Using REAL FRED data
 */
export const MACRO_CLAIM_SCENARIOS: ClaimVerificationScenario[] = [
  {
    id: "macro_fed_dec2024",
    personaId: "MACRO_STRATEGIST",
    name: "Fed December 2024 Rate Decision Verification",
    query: "Verify Fed cut rates to 4.25-4.50% in December 2024 and CPI was 2.7%",
    claims: [
      {
        claim: "Fed cut rates 25bps to 4.25-4.50% in Dec 2024",
        category: "policy",
        expectedVerdict: "verified",
        verificationSource: "Federal Reserve / FRED FEDFUNDS",
      },
      {
        claim: "CPI YoY was 2.7% in November 2024",
        category: "economic",
        expectedVerdict: "verified",
        verificationSource: "BLS / FRED CPIAUCSL",
      },
      {
        claim: "Unemployment rate was 4.2% in November 2024",
        category: "economic",
        expectedVerdict: "verified",
        verificationSource: "BLS / FRED UNRATE",
      },
    ],
    expectedSources: ["fred.stlouisfed.org", "bls.gov", "federalreserve.gov"],
    passingThreshold: 90,
  },
  {
    id: "macro_2022_inflation",
    personaId: "MACRO_STRATEGIST",
    name: "2022 Inflation Peak Verification",
    query: "Verify CPI peaked at 9.1% in June 2022",
    claims: [
      {
        claim: "CPI YoY peaked at 9.1% in June 2022",
        category: "economic",
        expectedVerdict: "verified",
        verificationSource: "FRED CPIAUCSL",
      },
      {
        claim: "Fed began aggressive rate hiking cycle in 2022",
        category: "policy",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["fred.stlouisfed.org", "bls.gov", "federalreserve.gov"],
    passingThreshold: 85,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT ALL
// ═══════════════════════════════════════════════════════════════════════════

export const STRATEGIC_GROUND_TRUTHS = {
  corpDev: {
    jnjShockwave: JNJ_SHOCKWAVE_GROUND_TRUTH, // REAL: SEC 8-K verified, completed May 2024
    jetblueSpiritBlocked: JETBLUE_SPIRIT_GROUND_TRUTH, // REAL: DOJ blocked Jan 2024
  },
  macro: {
    fedDec2024: FED_DEC2024_GROUND_TRUTH, // REAL: FRED data verified
    inflation2022: INFLATION_2022_GROUND_TRUTH, // REAL: Historical FRED data
  },
};

export const STRATEGIC_CLAIM_SCENARIOS = {
  corpDev: CORP_DEV_CLAIM_SCENARIOS,
  macro: MACRO_CLAIM_SCENARIOS,
};

// Legacy exports for backwards compatibility
export const ACME_WIDGETCO_GROUND_TRUTH = JNJ_SHOCKWAVE_GROUND_TRUTH;
export const DISTRESSED_ACQUISITION_GROUND_TRUTH = JETBLUE_SPIRIT_GROUND_TRUTH;
export const FED_POLICY_GROUND_TRUTH = FED_DEC2024_GROUND_TRUTH;
export const GEOPOLITICAL_SHOCK_GROUND_TRUTH = INFLATION_2022_GROUND_TRUTH;
