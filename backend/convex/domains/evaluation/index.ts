/**
 * Evaluation Module Index
 *
 * Exports all evaluation functionality for agent testing
 */

// Ground truth data
export {
  PERSONAS,
  PERSONA_REQUIREMENTS,
  GROUND_TRUTH_ENTITIES,
  TEST_QUERIES,
  getEntityById,
  getQueriesForPersona,
  getQueriesForEntity,
  type Persona,
  type GroundTruthEntity,
  type TestQuery,
} from "./groundTruth";

// Boolean evaluator
export {
  evaluateResponse,
  summarizeResults,
  type BooleanFactors,
  type EvaluationResult,
  type EvaluationSummary,
} from "./booleanEvaluator";

// Evaluation harness configuration
export {
  PASSING_THRESHOLD,
  PERSONA_THRESHOLDS,
} from "./evalHarness";

// Evaluation harness actions
export {
  evaluateSingleQueryMock,
  evaluateAllQueriesMock,
  evaluateSingleQueryLive,
  evaluateBatchLive,
  getTestQueries,
  getGroundTruthEntities,
} from "./evalHarness";

// Live evaluation actions (anonymous + authenticated)
export {
  runSingleEvalAnonymous,
  runBatchEvalAuthenticated,
  quickEval,
} from "./liveEval";

// Evaluation run tracking (mutations + queries)
export {
  createEvalRun,
  updateEvalRun,
  completeEvalRun,
  getEvalRunStatus,
  getRecentEvalRuns,
} from "./evalRunTracking";

// ============================================================================
// COMPREHENSIVE EVAL SCENARIOS (NEW)
// ============================================================================

// Memory-first scenarios
export {
  ALL_MEMORY_FIRST_SCENARIOS,
  AMBIGUOUS_QUERY_SCENARIOS,
  STALENESS_SCENARIOS,
  QUALITY_TIER_SCENARIOS,
  memoryFirstScenarioValidator,
  type MemoryFirstScenario,
  type ScenarioValidation as MemoryFirstValidation,
  type MemoryInjection,
} from "./memoryFirstScenarios";

// Multi-turn & session resume scenarios
export {
  ALL_MULTI_TURN_SCENARIOS,
  MULTI_TURN_ENTITY_SCENARIOS,
  INVARIANT_SCENARIOS,
  COMPACTION_SCENARIOS,
  multiTurnScenarioValidator,
  type MultiTurnScenario,
  type TurnValidation,
  type ScenarioTurn,
} from "./multiTurnScenarios";

// Persona inference & self-repair scenarios
export {
  ALL_PERSONA_INFERENCE_SCENARIOS,
  PERSONA_KEYWORD_INFERENCE_SCENARIOS,
  AMBIGUOUS_PERSONA_SCENARIOS,
  SELF_REPAIR_SCENARIOS,
  PERSONA_PACKAGING_SCENARIOS,
  personaInferenceScenarioValidator,
  type PersonaInferenceScenario,
  type PersonaInferenceValidation,
} from "./personaInferenceScenarios";

// Media context scenarios
export {
  ALL_MEDIA_CONTEXT_SCENARIOS,
  FILE_UPLOAD_SCENARIOS,
  MULTI_MODAL_SCENARIOS,
  SPECIALIZED_MEDIA_SCENARIOS,
  mediaContextScenarioValidator,
  type MediaContextScenario,
  type MediaContextValidation,
  type FileUploadSetup,
} from "./mediaContextScenarios";

// Prompt enhancer scenarios
export {
  ALL_PROMPT_ENHANCER_SCENARIOS,
  MEMORY_INJECTION_SCENARIOS,
  ENTITY_EXTRACTION_SCENARIOS,
  PERSONA_INFERENCE_ENHANCEMENT_SCENARIOS,
  TEMPORAL_EXTRACTION_SCENARIOS,
  TOOL_SUGGESTION_SCENARIOS,
  FILE_CONTEXT_SCENARIOS,
  USER_EDIT_SCENARIOS,
  DOSSIER_CONTEXT_SCENARIOS,
  promptEnhancerScenarioValidator,
  type PromptEnhancerScenario,
  type EnhancementValidation,
  type EnhancementDiff,
} from "./promptEnhancerScenarios";

// Validators
export {
  validateToolOrdering,
  validateRequiredTools,
  validateForbiddenTools,
  validateNoDuplicateToolCalls,
  validateToolCallCount,
  validateScratchpadState,
  validateMessageIdIsolation,
  validateMemoryReset,
  validatePersonaInference,
  validatePersonaPackaging,
  validateOutputContains,
  validateOutputPattern,
  validateMediaReferences,
  validateContextReuse,
  validateCrossEntitySynthesis,
  validateCompactionOutput,
  validateEnhancedPrompt,
  validateEnhancementDiff,
  validateSuggestedTools,
  validateInjectedContext,
  validateMemoryFirstScenario,
  validateMultiTurnScenario,
  validatePersonaInferenceScenario,
  validateMediaContextScenario,
  combineValidationResults,
  groupResultsBySuite,
  generateValidationSummary,
  type ToolCall,
  type Scratchpad,
  type DebriefV1,
  type TurnResult,
  type ValidationResult,
  type ScenarioValidationResult,
} from "./validators";

// Comprehensive eval action
export {
  runComprehensiveEval,
  runQuickEval,
  listAllScenarios,
  type EvalSuite,
  type EvalRunConfig,
  type EvalResult,
} from "./comprehensiveEval";

// ============================================================================
// LLM JUDGE - Boolean Metric Based Scoring
// ============================================================================

// LLM Judge evaluation actions
export {
  evaluateWithBooleanJudge,
  quickBooleanEval,
  floatToBooleanAssessment,
  booleanScoreToRatio,
  type EntityResolutionCriteria,
  type PersonaInferenceCriteria,
  type FactualAccuracyCriteria,
  type ResponseQualityCriteria,
  type SafetyCriteria,
  type BooleanEvaluation,
  type QuickBooleanEvaluation,
} from "./llmJudge";
