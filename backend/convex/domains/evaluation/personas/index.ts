/**
 * Persona Evaluation Exports
 *
 * Central export for all persona-specific evaluation modules.
 */

// Types
export * from "./types";

// Unified Harness
export {
  runAllPersonaEvalsMock,
  runAllPersonaEvalsLive,
  runSinglePersonaEval,
  getAvailablePersonas,
  generateEvalReport,
} from "./unifiedPersonaHarness";

// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL PERSONAS
// ═══════════════════════════════════════════════════════════════════════════

export {
  TECHCORP_GROUND_TRUTH,
  APEX_FUND_GROUND_TRUTH,
  FINANCIAL_GROUND_TRUTHS,
  BANKER_CLAIM_SCENARIOS,
  LP_CLAIM_SCENARIOS,
  FINANCIAL_CLAIM_SCENARIOS,
} from "./financial/financialGroundTruth";

export {
  evaluate as evaluateJPMBanker,
} from "./financial/jpmBankerEval";

export {
  evaluate as evaluateLPAllocator,
} from "./financial/lpAllocatorEval";

// ═══════════════════════════════════════════════════════════════════════════
// INDUSTRY PERSONAS
// ═══════════════════════════════════════════════════════════════════════════

export {
  BIOGENEX_GROUND_TRUTH,
  CRISPR_ABE_GROUND_TRUTH,
  INDUSTRY_GROUND_TRUTHS,
  PHARMA_CLAIM_SCENARIOS,
  ACADEMIC_CLAIM_SCENARIOS,
  INDUSTRY_CLAIM_SCENARIOS,
} from "./industry/industryGroundTruth";

export {
  evaluate as evaluatePharmaBD,
} from "./industry/pharmaBDEval";

export {
  evaluate as evaluateAcademicRD,
} from "./industry/academicRDEval";

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGIC PERSONAS
// ═══════════════════════════════════════════════════════════════════════════

export {
  ACME_WIDGETCO_GROUND_TRUTH,
  FED_POLICY_GROUND_TRUTH,
  STRATEGIC_GROUND_TRUTHS,
  CORP_DEV_CLAIM_SCENARIOS,
  MACRO_CLAIM_SCENARIOS,
  STRATEGIC_CLAIM_SCENARIOS,
} from "./strategic/strategicGroundTruth";

export {
  evaluate as evaluateCorpDev,
} from "./strategic/corpDevEval";

export {
  evaluate as evaluateMacroStrategist,
} from "./strategic/macroStratEval";

export {
  DEVTOOLSAI_GROUND_TRUTH,
  WEAK_POSITION_GROUND_TRUTH,
  FOUNDER_STRATEGY_GROUND_TRUTHS,
  FOUNDER_STRATEGY_CLAIM_SCENARIOS,
} from "./strategic/founderStrategyGroundTruth";

export {
  evaluateFounderStrategy,
  evaluateFounderStrategyMock,
} from "./strategic/founderStrategyEval";

// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL PERSONAS (Additional)
// ═══════════════════════════════════════════════════════════════════════════

export {
  ALPHA_MOMENTUM_GROUND_TRUTH,
  OVERFITTED_STRATEGY_GROUND_TRUTH,
  QUANT_PM_GROUND_TRUTHS,
  QUANT_PM_CLAIM_SCENARIOS,
} from "./financial/quantPMGroundTruth";

export {
  evaluateQuantPM,
  evaluateQuantPMMock,
} from "./financial/quantPMEval";

// ═══════════════════════════════════════════════════════════════════════════
// TECHNICAL PERSONAS
// ═══════════════════════════════════════════════════════════════════════════

export {
  CLOUDSCALE_GROUND_TRUTH,
  LEGACY_PLATFORM_GROUND_TRUTH,
  TECHNICAL_GROUND_TRUTHS,
  CTO_CLAIM_SCENARIOS,
} from "./technical/technicalGroundTruth";

export {
  evaluateCTOTechLead,
  evaluateCTOTechLeadMock,
} from "./technical/ctoTechLeadEval";

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA PERSONAS
// ═══════════════════════════════════════════════════════════════════════════

export {
  VIRALTECH_LAYOFFS_GROUND_TRUTH,
  UNVERIFIED_MERGER_GROUND_TRUTH,
  MEDIA_GROUND_TRUTHS,
  JOURNALIST_CLAIM_SCENARIOS,
} from "./media/mediaGroundTruth";

export {
  evaluateJournalist,
  evaluateJournalistMock,
} from "./media/journalistEval";
