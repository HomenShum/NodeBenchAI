/**
 * Persona Scoring Weights
 *
 * Per-persona category weights and pass thresholds.
 * Weights sum to 100% for each persona.
 */

import type { PersonaId } from "../../../config/autonomousConfig";
import type { PersonaScoringConfig, ScoringCategory } from "./scoringFramework";

// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL PERSONAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * JPM Startup Banker scoring configuration
 */
export const JPM_BANKER_SCORING: PersonaScoringConfig = {
  personaId: "JPM_STARTUP_BANKER",
  passingThreshold: 75,
  maxScore: 100,
  categories: [
    {
      name: "Funding Verification",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Stage Correct", points: 10, evaluationType: "boolean", groundTruthKey: "funding.stage" },
        { name: "Amount Correct", points: 10, evaluationType: "threshold", thresholdMin: 0.9, thresholdMax: 1.1 },
        { name: "Lead Investor", points: 5, evaluationType: "boolean", groundTruthKey: "funding.leadInvestor" },
      ],
    },
    {
      name: "Entity/HQ Verification",
      weight: 20,
      isCritical: false,
      subCategories: [
        { name: "City Correct", points: 7, evaluationType: "boolean", groundTruthKey: "hq.city" },
        { name: "State Correct", points: 7, evaluationType: "boolean", groundTruthKey: "hq.state" },
        { name: "Entity Found", points: 6, evaluationType: "boolean" },
      ],
    },
    {
      name: "Contact Information",
      weight: 20,
      isCritical: true,
      criticalThreshold: 40,
      subCategories: [
        { name: "IR Email Found", points: 10, evaluationType: "boolean", groundTruthKey: "contact.irEmail" },
        { name: "LinkedIn Found", points: 5, evaluationType: "boolean", groundTruthKey: "contact.linkedIn" },
        { name: "Phone Found", points: 5, evaluationType: "boolean", groundTruthKey: "contact.phone" },
      ],
    },
    {
      name: "Verdict Accuracy",
      weight: 20,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Verdict Correct", points: 15, evaluationType: "boolean", groundTruthKey: "verdict" },
        { name: "Verdict Justified", points: 5, evaluationType: "llm_judge" },
      ],
    },
    {
      name: "Thesis Quality",
      weight: 15,
      isCritical: false,
      subCategories: [
        { name: "Thesis Present", points: 5, evaluationType: "boolean" },
        { name: "Thesis Coherent", points: 5, evaluationType: "llm_judge" },
        { name: "Sector Identified", points: 5, evaluationType: "boolean", groundTruthKey: "sector" },
      ],
    },
  ],
};

/**
 * Early Stage VC scoring configuration
 */
export const EARLY_STAGE_VC_SCORING: PersonaScoringConfig = {
  personaId: "EARLY_STAGE_VC",
  passingThreshold: 70,
  maxScore: 100,
  categories: [
    {
      name: "Investment Thesis",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Thesis Clear", points: 10, evaluationType: "llm_judge" },
        { name: "Why Now Identified", points: 10, evaluationType: "boolean" },
        { name: "Wedge Identified", points: 5, evaluationType: "boolean" },
      ],
    },
    {
      name: "Market Analysis",
      weight: 20,
      isCritical: false,
      subCategories: [
        { name: "TAM Estimated", points: 10, evaluationType: "boolean" },
        { name: "Market Trends", points: 5, evaluationType: "boolean" },
        { name: "Timing Assessment", points: 5, evaluationType: "boolean" },
      ],
    },
    {
      name: "Competitive Analysis",
      weight: 20,
      isCritical: true,
      criticalThreshold: 40,
      subCategories: [
        { name: "Comps Identified", points: 10, evaluationType: "boolean" },
        { name: "Differentiation Clear", points: 5, evaluationType: "llm_judge" },
        { name: "Comp Metrics", points: 5, evaluationType: "boolean" },
      ],
    },
    {
      name: "Team Assessment",
      weight: 20,
      isCritical: false,
      subCategories: [
        { name: "Founders Identified", points: 10, evaluationType: "boolean" },
        { name: "Background Verified", points: 5, evaluationType: "boolean" },
        { name: "Domain Expertise", points: 5, evaluationType: "llm_judge" },
      ],
    },
    {
      name: "Deal Terms",
      weight: 15,
      isCritical: false,
      subCategories: [
        { name: "Valuation Found", points: 7, evaluationType: "boolean" },
        { name: "Stage Identified", points: 4, evaluationType: "boolean" },
        { name: "Terms Reasonable", points: 4, evaluationType: "llm_judge" },
      ],
    },
  ],
};

/**
 * LP Allocator scoring configuration
 */
export const LP_ALLOCATOR_SCORING: PersonaScoringConfig = {
  personaId: "LP_ALLOCATOR",
  passingThreshold: 75,
  maxScore: 100,
  categories: [
    {
      name: "Track Record Verification",
      weight: 30,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "TVPI Verified", points: 12, evaluationType: "threshold", thresholdMin: 0.95, thresholdMax: 1.05 },
        { name: "DPI Verified", points: 12, evaluationType: "threshold", thresholdMin: 0.95, thresholdMax: 1.05 },
        { name: "IRR Verified", points: 6, evaluationType: "threshold", thresholdMin: 0.9, thresholdMax: 1.1 },
      ],
    },
    {
      name: "Team Experience",
      weight: 20,
      isCritical: false,
      subCategories: [
        { name: "GP Identified", points: 8, evaluationType: "boolean" },
        { name: "Years Experience", points: 6, evaluationType: "threshold", thresholdMin: 10 },
        { name: "Prior Funds", points: 6, evaluationType: "boolean" },
      ],
    },
    {
      name: "Strategy Clarity",
      weight: 15,
      isCritical: false,
      subCategories: [
        { name: "Strategy Described", points: 5, evaluationType: "boolean" },
        { name: "Stage Focus Clear", points: 5, evaluationType: "boolean" },
        { name: "Sector Focus Clear", points: 5, evaluationType: "boolean" },
      ],
    },
    {
      name: "Terms Assessment",
      weight: 15,
      isCritical: false,
      subCategories: [
        { name: "Mgmt Fee Verified", points: 5, evaluationType: "threshold", thresholdMin: 1.5, thresholdMax: 2.5 },
        { name: "Carry Verified", points: 5, evaluationType: "threshold", thresholdMin: 15, thresholdMax: 25 },
        { name: "GP Commitment", points: 5, evaluationType: "boolean" },
      ],
    },
    {
      name: "Mandate Fit",
      weight: 20,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Sector Match", points: 7, evaluationType: "boolean", groundTruthKey: "fit.sectorMatch" },
        { name: "Stage Match", points: 7, evaluationType: "boolean", groundTruthKey: "fit.stageMatch" },
        { name: "Geo Match", points: 6, evaluationType: "boolean", groundTruthKey: "fit.geoMatch" },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// INDUSTRY PERSONAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pharma BD scoring configuration
 */
export const PHARMA_BD_SCORING: PersonaScoringConfig = {
  personaId: "PHARMA_BD",
  passingThreshold: 80,
  maxScore: 100,
  categories: [
    {
      name: "Exposure Analysis",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Indication Correct", points: 8, evaluationType: "boolean", groundTruthKey: "exposure.targetIndication" },
        { name: "MOA Correct", points: 8, evaluationType: "boolean", groundTruthKey: "exposure.mechanismOfAction" },
        { name: "Phase Correct", points: 5, evaluationType: "boolean", groundTruthKey: "exposure.phase" },
        { name: "Competition Mapped", points: 4, evaluationType: "boolean" },
      ],
    },
    {
      name: "Impact Assessment",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Market Size", points: 8, evaluationType: "boolean" },
        { name: "Differentiation", points: 8, evaluationType: "boolean", groundTruthKey: "impact.differentiatedMOA" },
        { name: "Patent Protection", points: 5, evaluationType: "boolean" },
        { name: "First in Class", points: 4, evaluationType: "boolean", groundTruthKey: "impact.firstInClass" },
      ],
    },
    {
      name: "Risk Mitigations",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Clinical Risk Assessed", points: 8, evaluationType: "llm_judge" },
        { name: "Regulatory Path", points: 8, evaluationType: "boolean" },
        { name: "Manufacturing Ready", points: 5, evaluationType: "boolean", groundTruthKey: "mitigations.manufacturingReady" },
        { name: "Supply Chain", points: 4, evaluationType: "boolean" },
      ],
    },
    {
      name: "Timeline Realism",
      weight: 25,
      isCritical: false,
      subCategories: [
        { name: "Phase Timeline", points: 8, evaluationType: "boolean" },
        { name: "Approval Timeline", points: 8, evaluationType: "boolean" },
        { name: "Commercial Timeline", points: 5, evaluationType: "boolean" },
        { name: "NCT Number Verified", points: 4, evaluationType: "boolean", groundTruthKey: "clinicalData.nctNumber" },
      ],
    },
  ],
};

/**
 * Academic R&D scoring configuration
 */
export const ACADEMIC_RD_SCORING: PersonaScoringConfig = {
  personaId: "ACADEMIC_RD",
  passingThreshold: 70,
  maxScore: 100,
  categories: [
    {
      name: "Methodology Quality",
      weight: 20,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Technique Identified", points: 7, evaluationType: "boolean", groundTruthKey: "methodology.technique" },
        { name: "Validation Level", points: 7, evaluationType: "boolean", groundTruthKey: "methodology.validationLevel" },
        { name: "Replication Status", points: 6, evaluationType: "boolean" },
      ],
    },
    {
      name: "Findings Accuracy",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Primary Result", points: 10, evaluationType: "boolean", groundTruthKey: "findings.primaryResult" },
        { name: "Effect Size", points: 8, evaluationType: "boolean" },
        { name: "Statistical Significance", points: 7, evaluationType: "boolean" },
      ],
    },
    {
      name: "Citation Verification",
      weight: 15,
      isCritical: false,
      subCategories: [
        { name: "Citation Count", points: 6, evaluationType: "threshold", thresholdMin: 0.8 },
        { name: "Key Papers Found", points: 5, evaluationType: "boolean" },
        { name: "h5 Index", points: 4, evaluationType: "boolean" },
      ],
    },
    {
      name: "Gap Identification",
      weight: 20,
      isCritical: false,
      subCategories: [
        { name: "Gaps Identified", points: 10, evaluationType: "boolean" },
        { name: "Gap Relevance", points: 5, evaluationType: "llm_judge" },
        { name: "Gap Prioritization", points: 5, evaluationType: "llm_judge" },
      ],
    },
    {
      name: "Implications Clarity",
      weight: 20,
      isCritical: false,
      subCategories: [
        { name: "Clinical Translation", points: 7, evaluationType: "boolean" },
        { name: "Commercialization Path", points: 7, evaluationType: "boolean" },
        { name: "Regulatory Considerations", points: 6, evaluationType: "boolean" },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGIC PERSONAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Corp Dev scoring configuration
 */
export const CORP_DEV_SCORING: PersonaScoringConfig = {
  personaId: "CORP_DEV",
  passingThreshold: 75,
  maxScore: 100,
  categories: [
    {
      name: "Deal Facts Verification",
      weight: 30,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Acquirer Correct", points: 8, evaluationType: "boolean", groundTruthKey: "deal.acquirer" },
        { name: "Target Correct", points: 8, evaluationType: "boolean", groundTruthKey: "deal.target" },
        { name: "Deal Value", points: 7, evaluationType: "threshold", thresholdMin: 0.9, thresholdMax: 1.1 },
        { name: "Deal Type", points: 4, evaluationType: "boolean", groundTruthKey: "deal.dealType" },
        { name: "Status Correct", points: 3, evaluationType: "boolean", groundTruthKey: "deal.dealStatus" },
      ],
    },
    {
      name: "Strategic Rationale",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Synergies Identified", points: 10, evaluationType: "boolean" },
        { name: "Market Position Impact", points: 8, evaluationType: "boolean" },
        { name: "Technology/Talent", points: 7, evaluationType: "boolean" },
      ],
    },
    {
      name: "Risk Identification",
      weight: 25,
      isCritical: true,
      criticalThreshold: 40,
      subCategories: [
        { name: "Regulatory Risk", points: 8, evaluationType: "boolean" },
        { name: "Integration Risk", points: 8, evaluationType: "boolean" },
        { name: "Cultural Risk", points: 5, evaluationType: "boolean" },
        { name: "Financing Risk", points: 4, evaluationType: "boolean" },
      ],
    },
    {
      name: "Timeline Assessment",
      weight: 20,
      isCritical: false,
      subCategories: [
        { name: "Close Date", points: 8, evaluationType: "boolean", groundTruthKey: "deal.expectedClose" },
        { name: "Announcement Date", points: 6, evaluationType: "boolean", groundTruthKey: "deal.announcementDate" },
        { name: "Integration Timeline", points: 6, evaluationType: "boolean" },
      ],
    },
  ],
};

/**
 * Macro Strategist scoring configuration
 */
export const MACRO_STRATEGIST_SCORING: PersonaScoringConfig = {
  personaId: "MACRO_STRATEGIST",
  passingThreshold: 70,
  maxScore: 100,
  categories: [
    {
      name: "Thesis Coherence",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Event Identified", points: 8, evaluationType: "boolean", groundTruthKey: "thesis.event" },
        { name: "Expected Move", points: 8, evaluationType: "boolean", groundTruthKey: "thesis.expectedMove" },
        { name: "Rationale Clear", points: 5, evaluationType: "llm_judge" },
        { name: "Timeframe Specified", points: 4, evaluationType: "boolean" },
      ],
    },
    {
      name: "Indicator Accuracy",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Key Indicators", points: 10, evaluationType: "boolean" },
        { name: "Values Correct", points: 8, evaluationType: "threshold", thresholdMin: 0.95, thresholdMax: 1.05 },
        { name: "Sources Cited", points: 7, evaluationType: "boolean" },
      ],
    },
    {
      name: "Risk Comprehensiveness",
      weight: 25,
      isCritical: false,
      subCategories: [
        { name: "Upside Risk", points: 8, evaluationType: "boolean" },
        { name: "Downside Risk", points: 8, evaluationType: "boolean" },
        { name: "Tail Risk", points: 5, evaluationType: "boolean" },
        { name: "Risk Quantified", points: 4, evaluationType: "llm_judge" },
      ],
    },
    {
      name: "Positioning Actionability",
      weight: 25,
      isCritical: false,
      subCategories: [
        { name: "Positions Specified", points: 10, evaluationType: "boolean" },
        { name: "Direction Clear", points: 8, evaluationType: "boolean" },
        { name: "Rationale Provided", points: 7, evaluationType: "llm_judge" },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// TECHNICAL PERSONAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CTO / Tech Lead scoring configuration
 */
export const CTO_TECH_LEAD_SCORING: PersonaScoringConfig = {
  personaId: "CTO_TECH_LEAD",
  passingThreshold: 75,
  maxScore: 100,
  categories: [
    {
      name: "Tech Stack Verification",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Primary Languages", points: 8, evaluationType: "boolean", groundTruthKey: "techStack.primaryLanguages" },
        { name: "Frameworks Identified", points: 7, evaluationType: "boolean", groundTruthKey: "techStack.frameworks" },
        { name: "Cloud Provider", points: 5, evaluationType: "boolean", groundTruthKey: "techStack.cloudProvider" },
        { name: "Database Technologies", points: 5, evaluationType: "boolean", groundTruthKey: "techStack.databases" },
      ],
    },
    {
      name: "Architecture Quality",
      weight: 20,
      isCritical: true,
      criticalThreshold: 40,
      subCategories: [
        { name: "Architecture Pattern", points: 7, evaluationType: "boolean", groundTruthKey: "architecture.pattern" },
        { name: "Scalability Design", points: 7, evaluationType: "llm_judge" },
        { name: "Technical Debt Level", points: 6, evaluationType: "llm_judge" },
      ],
    },
    {
      name: "Security & Compliance",
      weight: 20,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Certifications Verified", points: 8, evaluationType: "boolean", groundTruthKey: "compliance.certifications" },
        { name: "Security Practices", points: 6, evaluationType: "boolean" },
        { name: "Data Privacy", points: 6, evaluationType: "boolean" },
      ],
    },
    {
      name: "Team Metrics",
      weight: 20,
      isCritical: false,
      subCategories: [
        { name: "Team Size Verified", points: 7, evaluationType: "threshold", thresholdMin: 0.8, thresholdMax: 1.2 },
        { name: "Seniority Mix", points: 7, evaluationType: "boolean" },
        { name: "Key Roles Filled", points: 6, evaluationType: "boolean" },
      ],
    },
    {
      name: "DevOps Maturity",
      weight: 15,
      isCritical: false,
      subCategories: [
        { name: "CI/CD Pipeline", points: 5, evaluationType: "boolean", groundTruthKey: "devops.cicd" },
        { name: "Deployment Frequency", points: 5, evaluationType: "boolean" },
        { name: "Monitoring Coverage", points: 5, evaluationType: "boolean" },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA PERSONAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Journalist / Media scoring configuration
 */
export const JOURNALIST_SCORING: PersonaScoringConfig = {
  personaId: "JOURNALIST",
  passingThreshold: 75,
  maxScore: 100,
  categories: [
    {
      name: "Fact Verification",
      weight: 30,
      isCritical: true,
      criticalThreshold: 60,
      subCategories: [
        { name: "Primary Facts Verified", points: 12, evaluationType: "boolean" },
        { name: "Numbers Accurate", points: 10, evaluationType: "threshold", thresholdMin: 0.95, thresholdMax: 1.05 },
        { name: "Timeline Verified", points: 8, evaluationType: "boolean" },
      ],
    },
    {
      name: "Source Quality",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Primary Sources Cited", points: 10, evaluationType: "boolean" },
        { name: "Source Diversity", points: 8, evaluationType: "boolean" },
        { name: "Named Sources", points: 7, evaluationType: "boolean" },
      ],
    },
    {
      name: "Conflict Detection",
      weight: 20,
      isCritical: false,
      subCategories: [
        { name: "Contradictions Found", points: 7, evaluationType: "boolean" },
        { name: "Alternative Narratives", points: 7, evaluationType: "boolean" },
        { name: "Bias Detection", points: 6, evaluationType: "llm_judge" },
      ],
    },
    {
      name: "Context Completeness",
      weight: 15,
      isCritical: false,
      subCategories: [
        { name: "Historical Context", points: 5, evaluationType: "boolean" },
        { name: "Industry Context", points: 5, evaluationType: "boolean" },
        { name: "Stakeholder Context", points: 5, evaluationType: "boolean" },
      ],
    },
    {
      name: "Attribution Standards",
      weight: 10,
      isCritical: false,
      subCategories: [
        { name: "Quotes Accurate", points: 4, evaluationType: "boolean" },
        { name: "Proper Attribution", points: 3, evaluationType: "boolean" },
        { name: "Link Verification", points: 3, evaluationType: "boolean" },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// ADDITIONAL FINANCIAL PERSONAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Quant PM scoring configuration
 */
export const QUANT_PM_SCORING: PersonaScoringConfig = {
  personaId: "QUANT_PM",
  passingThreshold: 75,
  maxScore: 100,
  categories: [
    {
      name: "Performance Verification",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Sharpe Ratio Verified", points: 10, evaluationType: "threshold", thresholdMin: 0.9, thresholdMax: 1.1 },
        { name: "Returns Verified", points: 8, evaluationType: "threshold", thresholdMin: 0.9, thresholdMax: 1.1 },
        { name: "Drawdown Verified", points: 7, evaluationType: "threshold", thresholdMin: 0.85, thresholdMax: 1.15 },
      ],
    },
    {
      name: "Risk Metrics",
      weight: 20,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Volatility Accurate", points: 7, evaluationType: "threshold", thresholdMin: 0.9, thresholdMax: 1.1 },
        { name: "Beta Verified", points: 7, evaluationType: "threshold", thresholdMin: 0.85, thresholdMax: 1.15 },
        { name: "VaR Assessment", points: 6, evaluationType: "boolean" },
      ],
    },
    {
      name: "Methodology Assessment",
      weight: 20,
      isCritical: true,
      criticalThreshold: 40,
      subCategories: [
        { name: "Backtest Quality", points: 7, evaluationType: "boolean", groundTruthKey: "backtest.survivorshipBiasFree" },
        { name: "Transaction Costs", points: 7, evaluationType: "boolean", groundTruthKey: "backtest.transactionCostsModeled" },
        { name: "Slippage Modeled", points: 6, evaluationType: "boolean", groundTruthKey: "backtest.slippageModeled" },
      ],
    },
    {
      name: "Factor Attribution",
      weight: 20,
      isCritical: false,
      subCategories: [
        { name: "Factor Exposures Identified", points: 8, evaluationType: "boolean" },
        { name: "Alpha Decomposition", points: 7, evaluationType: "boolean" },
        { name: "Style Drift Analysis", points: 5, evaluationType: "boolean" },
      ],
    },
    {
      name: "Robustness Testing",
      weight: 15,
      isCritical: false,
      subCategories: [
        { name: "Out-of-Sample Testing", points: 5, evaluationType: "boolean" },
        { name: "Regime Analysis", points: 5, evaluationType: "boolean" },
        { name: "Sensitivity Analysis", points: 5, evaluationType: "boolean" },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// ADDITIONAL STRATEGIC PERSONAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Founder/Strategy scoring configuration
 */
export const FOUNDER_STRATEGY_SCORING: PersonaScoringConfig = {
  personaId: "FOUNDER_STRATEGY",
  passingThreshold: 70,
  maxScore: 100,
  categories: [
    {
      name: "Market Sizing",
      weight: 20,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "TAM Verified", points: 7, evaluationType: "boolean", groundTruthKey: "market.tam" },
        { name: "SAM Verified", points: 7, evaluationType: "boolean", groundTruthKey: "market.sam" },
        { name: "Growth Rate Accurate", points: 6, evaluationType: "threshold", thresholdMin: 0.8, thresholdMax: 1.2 },
      ],
    },
    {
      name: "Competitive Intelligence",
      weight: 25,
      isCritical: true,
      criticalThreshold: 50,
      subCategories: [
        { name: "Competitors Identified", points: 10, evaluationType: "boolean" },
        { name: "Market Share Data", points: 8, evaluationType: "boolean" },
        { name: "Funding Landscape", points: 7, evaluationType: "boolean" },
      ],
    },
    {
      name: "Positioning Analysis",
      weight: 20,
      isCritical: false,
      subCategories: [
        { name: "Wedge Identified", points: 7, evaluationType: "boolean", groundTruthKey: "positioning.wedge" },
        { name: "Differentiation Clear", points: 7, evaluationType: "boolean" },
        { name: "Unfair Advantages", points: 6, evaluationType: "boolean" },
      ],
    },
    {
      name: "GTM Clarity",
      weight: 20,
      isCritical: false,
      subCategories: [
        { name: "Channel Strategy", points: 7, evaluationType: "boolean", groundTruthKey: "goToMarket.primaryChannel" },
        { name: "Sales Motion", points: 7, evaluationType: "boolean", groundTruthKey: "goToMarket.salesMotion" },
        { name: "Target Customer", points: 6, evaluationType: "boolean" },
      ],
    },
    {
      name: "Risk Assessment",
      weight: 15,
      isCritical: false,
      subCategories: [
        { name: "Competitive Risks", points: 5, evaluationType: "boolean" },
        { name: "Execution Risks", points: 5, evaluationType: "boolean" },
        { name: "Market Risks", points: 5, evaluationType: "boolean" },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// PERSONA CONFIG REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get scoring configuration for a persona
 */
export function getPersonaScoringConfig(personaId: PersonaId): PersonaScoringConfig | null {
  const configs: Partial<Record<PersonaId, PersonaScoringConfig>> = {
    // Financial Personas
    JPM_STARTUP_BANKER: JPM_BANKER_SCORING,
    EARLY_STAGE_VC: EARLY_STAGE_VC_SCORING,
    LP_ALLOCATOR: LP_ALLOCATOR_SCORING,
    QUANT_PM: QUANT_PM_SCORING,
    // Industry Personas
    PHARMA_BD: PHARMA_BD_SCORING,
    ACADEMIC_RD: ACADEMIC_RD_SCORING,
    // Strategic Personas
    CORP_DEV: CORP_DEV_SCORING,
    MACRO_STRATEGIST: MACRO_STRATEGIST_SCORING,
    FOUNDER_STRATEGY: FOUNDER_STRATEGY_SCORING,
    // Technical Personas
    CTO_TECH_LEAD: CTO_TECH_LEAD_SCORING,
    // Media Personas
    JOURNALIST: JOURNALIST_SCORING,
  };

  return configs[personaId] ?? null;
}

/**
 * Get all configured persona scoring configs
 */
export function getAllPersonaScoringConfigs(): PersonaScoringConfig[] {
  return [
    // Financial Personas
    JPM_BANKER_SCORING,
    EARLY_STAGE_VC_SCORING,
    LP_ALLOCATOR_SCORING,
    QUANT_PM_SCORING,
    // Industry Personas
    PHARMA_BD_SCORING,
    ACADEMIC_RD_SCORING,
    // Strategic Personas
    CORP_DEV_SCORING,
    MACRO_STRATEGIST_SCORING,
    FOUNDER_STRATEGY_SCORING,
    // Technical Personas
    CTO_TECH_LEAD_SCORING,
    // Media Personas
    JOURNALIST_SCORING,
  ];
}

/**
 * Validate that category weights sum to 100
 */
export function validateScoringConfig(config: PersonaScoringConfig): { valid: boolean; error?: string } {
  const totalWeight = config.categories.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight !== 100) {
    return {
      valid: false,
      error: `Category weights for ${config.personaId} sum to ${totalWeight}, expected 100`,
    };
  }
  return { valid: true };
}
