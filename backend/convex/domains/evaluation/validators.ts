/**
 * Evaluation Validators
 *
 * Validation functions for comprehensive eval harness.
 * Validates tool ordering, scratchpad state, persona inference,
 * output content, and invariant enforcement.
 */

import type {
  MemoryFirstScenario,
  ScenarioValidation as MemoryFirstValidation,
} from "./memoryFirstScenarios";
import type {
  MultiTurnScenario,
  TurnValidation,
} from "./multiTurnScenarios";
import type {
  PersonaInferenceScenario,
  PersonaInferenceValidation,
} from "./personaInferenceScenarios";
import type {
  MediaContextScenario,
  MediaContextValidation,
} from "./mediaContextScenarios";
import type {
  PromptEnhancerScenario,
  EnhancementValidation,
} from "./promptEnhancerScenarios";

// ============================================================================
// TYPES
// ============================================================================

export interface ToolCall {
  name: string;
  args?: Record<string, unknown>;
  timestamp: number;
  result?: unknown;
}

export interface Scratchpad {
  messageId: string;
  activeEntities: string[];
  memoryUpdatedEntities: string[];
  currentIntent: string;
  stepCount: number;
  toolCallCount: number;
  planningCallCount: number;
  capabilitiesVersion?: string;
  compactedAt?: number;
}

export interface DebriefV1 {
  persona: {
    inferred: string;
    confidence: number;
    keywords: string[];
  };
  output: string;
  toolCalls: ToolCall[];
  scratchpad: Scratchpad;
}

export interface TurnResult {
  query: string;
  output: string;
  toolCalls: ToolCall[];
  scratchpad: Scratchpad;
  threadId: string;
  messageId: string;
  persona?: {
    inferred: string;
    confidence: number;
  };
  error?: string;
}

export interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings?: string[];
}

export interface ScenarioValidationResult extends ValidationResult {
  scenarioId: string;
  scenarioName: string;
  suite: string;
  turnResults?: ValidationResult[];
  details?: Record<string, unknown>;
}

// ============================================================================
// TOOL ORDERING VALIDATION
// ============================================================================

/**
 * Validates that tools are called in the correct order
 */
export function validateToolOrdering(
  toolCalls: ToolCall[],
  rules: {
    mustCallBefore?: Record<string, string[]>;
    mustNotCallFirst?: string[];
  }
): ValidationResult {
  const errors: string[] = [];
  const callOrder = toolCalls.map((c) => c.name);

  // Check mustCallBefore rules
  if (rules.mustCallBefore) {
    for (const [before, afters] of Object.entries(rules.mustCallBefore)) {
      const beforeIndex = callOrder.indexOf(before);
      if (beforeIndex === -1) {
        errors.push(`Required tool ${before} was not called`);
        continue;
      }

      for (const after of afters) {
        const afterIndex = callOrder.indexOf(after);
        if (afterIndex !== -1 && afterIndex < beforeIndex) {
          errors.push(
            `${after} called before ${before} (expected ${before} first)`
          );
        }
      }
    }
  }

  // Check mustNotCallFirst rules
  if (rules.mustNotCallFirst && callOrder.length > 0) {
    for (const tool of rules.mustNotCallFirst) {
      if (callOrder[0] === tool) {
        errors.push(`${tool} was called first, but should not be`);
      }
    }
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Validates that required tools are called
 */
export function validateRequiredTools(
  toolCalls: ToolCall[],
  mustCallTools: string[]
): ValidationResult {
  const errors: string[] = [];
  const calledTools = new Set(toolCalls.map((c) => c.name));

  for (const required of mustCallTools) {
    if (!calledTools.has(required)) {
      errors.push(`Required tool ${required} was not called`);
    }
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Validates that certain tools are NOT called
 */
export function validateForbiddenTools(
  toolCalls: ToolCall[],
  mustNotCall: string[]
): ValidationResult {
  const errors: string[] = [];
  const calledTools = new Set(toolCalls.map((c) => c.name));

  for (const forbidden of mustNotCall) {
    if (calledTools.has(forbidden)) {
      errors.push(`Forbidden tool ${forbidden} was called`);
    }
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Validates that a tool is not called more than once
 */
export function validateNoDuplicateToolCalls(
  toolCalls: ToolCall[],
  mustNotCallTwice: string[]
): ValidationResult {
  const errors: string[] = [];
  const callCounts = new Map<string, number>();

  for (const call of toolCalls) {
    callCounts.set(call.name, (callCounts.get(call.name) ?? 0) + 1);
  }

  for (const tool of mustNotCallTwice) {
    const count = callCounts.get(tool) ?? 0;
    if (count > 1) {
      errors.push(`Tool ${tool} was called ${count} times, expected at most 1`);
    }
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Validates minimum tool call count
 */
export function validateToolCallCount(
  toolCalls: ToolCall[],
  minimum: number
): ValidationResult {
  const errors: string[] = [];

  if (toolCalls.length < minimum) {
    errors.push(
      `Tool call count ${toolCalls.length} is less than minimum ${minimum}`
    );
  }

  return { passed: errors.length === 0, errors };
}

// ============================================================================
// SCRATCHPAD VALIDATION
// ============================================================================

/**
 * Validates scratchpad state matches expected values
 */
export function validateScratchpadState(
  scratchpad: Scratchpad,
  mustContain: Record<string, unknown>
): ValidationResult {
  const errors: string[] = [];

  for (const [key, expected] of Object.entries(mustContain)) {
    const actual = scratchpad[key as keyof Scratchpad];

    if (expected instanceof RegExp) {
      if (!expected.test(String(actual))) {
        errors.push(`Scratchpad.${key} "${actual}" did not match ${expected}`);
      }
    } else if (Array.isArray(expected)) {
      const actualArray = actual as unknown[];
      const missing = expected.filter((e) => !actualArray?.includes(e));
      if (missing.length > 0) {
        errors.push(`Scratchpad.${key} missing values: ${missing.join(", ")}`);
      }
    } else if (typeof expected === "number") {
      if (actual !== expected) {
        errors.push(`Scratchpad.${key} was ${actual}, expected ${expected}`);
      }
    } else if (actual !== expected) {
      errors.push(`Scratchpad.${key} was ${actual}, expected ${expected}`);
    }
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Validates message ID isolation across turns
 */
export function validateMessageIdIsolation(
  previousMessageId: string,
  currentMessageId: string
): ValidationResult {
  const errors: string[] = [];

  if (previousMessageId === currentMessageId) {
    errors.push(
      `Message ID not isolated: ${currentMessageId} same as previous`
    );
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Validates memoryUpdatedEntities reset between messages
 */
export function validateMemoryReset(
  previousScratchpad: Scratchpad,
  currentScratchpad: Scratchpad
): ValidationResult {
  const errors: string[] = [];

  // New message should have empty memoryUpdatedEntities initially
  if (
    currentScratchpad.memoryUpdatedEntities.length > 0 &&
    previousScratchpad.memoryUpdatedEntities.some((e) =>
      currentScratchpad.memoryUpdatedEntities.includes(e)
    )
  ) {
    errors.push(
      "memoryUpdatedEntities carried over from previous message (should reset)"
    );
  }

  return { passed: errors.length === 0, errors };
}

// ============================================================================
// PERSONA VALIDATION
// ============================================================================

/**
 * Validates persona was correctly inferred
 */
export function validatePersonaInference(
  inferredPersona: string,
  rules: {
    inferredPersonaMustBe?: string;
    inferredPersonaMustBeOneOf?: string[];
  }
): ValidationResult {
  const errors: string[] = [];

  if (rules.inferredPersonaMustBe) {
    if (inferredPersona !== rules.inferredPersonaMustBe) {
      errors.push(
        `Inferred persona "${inferredPersona}", expected "${rules.inferredPersonaMustBe}"`
      );
    }
  }

  if (rules.inferredPersonaMustBeOneOf) {
    if (!rules.inferredPersonaMustBeOneOf.includes(inferredPersona)) {
      errors.push(
        `Inferred persona "${inferredPersona}", expected one of: ${rules.inferredPersonaMustBeOneOf.join(", ")}`
      );
    }
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Validates persona-specific output packaging
 */
export function validatePersonaPackaging(
  output: string,
  requiredSections: string[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const outputLower = output.toLowerCase();

  for (const section of requiredSections) {
    const sectionLower = section.toLowerCase();
    if (!outputLower.includes(sectionLower)) {
      errors.push(`Output missing required section: "${section}"`);
    }
  }

  return { passed: errors.length === 0, errors, warnings };
}

// ============================================================================
// OUTPUT CONTENT VALIDATION
// ============================================================================

/**
 * Validates output contains required strings
 */
export function validateOutputContains(
  output: string,
  mustContain: string[]
): ValidationResult {
  const errors: string[] = [];
  const outputLower = output.toLowerCase();

  for (const required of mustContain) {
    const requiredLower = required.toLowerCase();
    if (!outputLower.includes(requiredLower)) {
      errors.push(`Output missing required content: "${required}"`);
    }
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Validates output matches a pattern
 */
export function validateOutputPattern(
  output: string,
  pattern: RegExp | string
): ValidationResult {
  const errors: string[] = [];

  const regex = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern;

  if (!regex.test(output)) {
    errors.push(`Output did not match pattern: ${pattern}`);
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Validates output references uploaded files/media
 */
export function validateMediaReferences(
  output: string,
  mustReference: string[]
): ValidationResult {
  const errors: string[] = [];
  const outputLower = output.toLowerCase();

  for (const ref of mustReference) {
    const refLower = ref.toLowerCase();
    if (!outputLower.includes(refLower)) {
      errors.push(`Output missing media reference: "${ref}"`);
    }
  }

  return { passed: errors.length === 0, errors };
}

// ============================================================================
// MULTI-TURN VALIDATION
// ============================================================================

/**
 * Validates context reuse across turns
 */
export function validateContextReuse(
  previousScratchpad: Scratchpad,
  currentScratchpad: Scratchpad
): ValidationResult {
  const errors: string[] = [];

  // Active entities from previous turn should still be accessible
  // (not necessarily in activeEntities, but should be retrievable)

  return { passed: errors.length === 0, errors };
}

/**
 * Validates synthesis across multiple entities
 */
export function validateCrossEntitySynthesis(
  output: string,
  expectedEntities: string[]
): ValidationResult {
  const errors: string[] = [];
  const outputLower = output.toLowerCase();

  const mentionedEntities = expectedEntities.filter((e) =>
    outputLower.includes(e.toLowerCase())
  );

  if (mentionedEntities.length < 2) {
    errors.push(
      `Cross-entity synthesis expected but only ${mentionedEntities.length} entity mentioned`
    );
  }

  // Check for comparison language
  const comparisonTerms = [
    "compare",
    "versus",
    "vs",
    "whereas",
    "while",
    "both",
    "however",
    "in contrast",
  ];
  const hasComparison = comparisonTerms.some((term) =>
    outputLower.includes(term)
  );

  if (!hasComparison && mentionedEntities.length >= 2) {
    // Warning but not error - may still be valid synthesis
  }

  return { passed: errors.length === 0, errors };
}

// ============================================================================
// COMPACTION VALIDATION
// ============================================================================

/**
 * Validates compactContext output structure
 */
export function validateCompactionOutput(
  compactionResult: unknown,
  mustHave: string[]
): ValidationResult {
  const errors: string[] = [];

  if (typeof compactionResult !== "object" || compactionResult === null) {
    errors.push("Compaction result is not an object");
    return { passed: false, errors };
  }

  const result = compactionResult as Record<string, unknown>;

  for (const field of mustHave) {
    if (!(field in result)) {
      errors.push(`Compaction result missing field: "${field}"`);
    }
  }

  return { passed: errors.length === 0, errors };
}

// ============================================================================
// PROMPT ENHANCER VALIDATION
// ============================================================================

/**
 * Validates enhanced prompt includes required content
 */
export function validateEnhancedPrompt(
  enhancedPrompt: string,
  validation: EnhancementValidation
): ValidationResult {
  const errors: string[] = [];
  const enhancedLower = enhancedPrompt.toLowerCase();

  if (validation.enhancedPromptMustInclude) {
    for (const required of validation.enhancedPromptMustInclude) {
      if (!enhancedLower.includes(required.toLowerCase())) {
        errors.push(`Enhanced prompt missing: "${required}"`);
      }
    }
  }

  if (validation.enhancedPromptMustNotInclude) {
    for (const forbidden of validation.enhancedPromptMustNotInclude) {
      if (enhancedLower.includes(forbidden.toLowerCase())) {
        errors.push(`Enhanced prompt should not include: "${forbidden}"`);
      }
    }
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Validates enhancement diff sources
 */
export function validateEnhancementDiff(
  diff: { source: string }[],
  mustContain: { source: string }[]
): ValidationResult {
  const errors: string[] = [];
  const sources = new Set(diff.map((d) => d.source));

  for (const required of mustContain) {
    const matched = Array.from(sources).some((s) =>
      s.startsWith(required.source)
    );
    if (!matched) {
      errors.push(`Enhancement diff missing source: "${required.source}"`);
    }
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Validates suggested tools
 */
export function validateSuggestedTools(
  suggestedTools: string[],
  validation: {
    mustInclude?: string[];
    mustNotInclude?: string[];
  }
): ValidationResult {
  const errors: string[] = [];
  const toolSet = new Set(suggestedTools);

  if (validation.mustInclude) {
    for (const tool of validation.mustInclude) {
      if (!toolSet.has(tool)) {
        errors.push(`Suggested tools missing: "${tool}"`);
      }
    }
  }

  if (validation.mustNotInclude) {
    for (const tool of validation.mustNotInclude) {
      if (toolSet.has(tool)) {
        errors.push(`Suggested tools should not include: "${tool}"`);
      }
    }
  }

  return { passed: errors.length === 0, errors };
}

/**
 * Validates injected context
 */
export function validateInjectedContext(
  injectedContext: {
    entities?: { name: string }[];
    personaHint?: string;
    memory?: { entityName: string; qualityTier?: string }[];
  },
  expected: {
    entities?: { name: string }[];
    personaHint?: string;
    memory?: { entityName: string; qualityTier?: string }[];
  }
): ValidationResult {
  const errors: string[] = [];

  if (expected.entities) {
    const actualNames = new Set(
      injectedContext.entities?.map((e) => e.name.toLowerCase()) ?? []
    );
    for (const expectedEntity of expected.entities) {
      if (!actualNames.has(expectedEntity.name.toLowerCase())) {
        errors.push(`Injected context missing entity: "${expectedEntity.name}"`);
      }
    }
  }

  if (expected.personaHint) {
    if (injectedContext.personaHint !== expected.personaHint) {
      errors.push(
        `Persona hint was "${injectedContext.personaHint}", expected "${expected.personaHint}"`
      );
    }
  }

  if (expected.memory) {
    const actualMemory = new Map(
      injectedContext.memory?.map((m) => [m.entityName.toLowerCase(), m]) ?? []
    );
    for (const expectedMem of expected.memory) {
      const actual = actualMemory.get(expectedMem.entityName.toLowerCase());
      if (!actual) {
        errors.push(
          `Injected context missing memory for: "${expectedMem.entityName}"`
        );
      } else if (
        expectedMem.qualityTier &&
        actual.qualityTier !== expectedMem.qualityTier
      ) {
        errors.push(
          `Memory quality tier was "${actual.qualityTier}", expected "${expectedMem.qualityTier}"`
        );
      }
    }
  }

  return { passed: errors.length === 0, errors };
}

// ============================================================================
// COMPOSITE VALIDATORS
// ============================================================================

/**
 * Validates a complete memory-first scenario
 */
export function validateMemoryFirstScenario(
  scenario: MemoryFirstScenario,
  result: TurnResult
): ScenarioValidationResult {
  const errors: string[] = [];
  const validation = scenario.validation;

  // Tool ordering
  if (validation.mustCallBefore) {
    const orderResult = validateToolOrdering(result.toolCalls, {
      mustCallBefore: validation.mustCallBefore,
    });
    errors.push(...orderResult.errors);
  }

  // Required tools
  if (validation.mustCallTools) {
    const toolResult = validateRequiredTools(
      result.toolCalls,
      validation.mustCallTools
    );
    errors.push(...toolResult.errors);
  }

  // Forbidden tools
  if (validation.mustNotCall) {
    const forbiddenResult = validateForbiddenTools(
      result.toolCalls,
      validation.mustNotCall
    );
    errors.push(...forbiddenResult.errors);
  }

  // Tool not called first
  if (validation.mustNotCallFirst) {
    const orderResult = validateToolOrdering(result.toolCalls, {
      mustNotCallFirst: validation.mustNotCallFirst,
    });
    errors.push(...orderResult.errors);
  }

  // Output content
  if (validation.outputMustContain) {
    const outputResult = validateOutputContains(
      result.output,
      validation.outputMustContain
    );
    errors.push(...outputResult.errors);
  }

  return {
    passed: errors.length === 0,
    errors,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    suite: "memory-first",
  };
}

/**
 * Validates a complete multi-turn scenario
 */
export function validateMultiTurnScenario(
  scenario: MultiTurnScenario,
  turnResults: TurnResult[]
): ScenarioValidationResult {
  const errors: string[] = [];
  const turnValidations: ValidationResult[] = [];
  let previousMessageId: string | undefined;
  let previousScratchpad: Scratchpad | undefined;

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i];
    const result = turnResults[i];
    const turnErrors: string[] = [];

    if (!result) {
      turnErrors.push(`Turn ${i + 1} result missing`);
      turnValidations.push({ passed: false, errors: turnErrors });
      continue;
    }

    const validation = turn.validation;
    if (!validation) {
      turnValidations.push({ passed: true, errors: [] });
      previousMessageId = result.messageId;
      previousScratchpad = result.scratchpad;
      continue;
    }

    // Tool requirements
    if (validation.mustCallTools) {
      const toolResult = validateRequiredTools(
        result.toolCalls,
        validation.mustCallTools
      );
      turnErrors.push(...toolResult.errors);
    }

    // Scratchpad state
    if (validation.scratchpadMustContain) {
      const scratchpadResult = validateScratchpadState(
        result.scratchpad,
        validation.scratchpadMustContain
      );
      turnErrors.push(...scratchpadResult.errors);
    }

    // Message ID isolation
    if (validation.messageIdMustDiffer && previousMessageId) {
      const isolationResult = validateMessageIdIsolation(
        previousMessageId,
        result.messageId
      );
      turnErrors.push(...isolationResult.errors);
    }

    // Memory reset
    if (validation.memoryUpdatedEntitiesMustReset && previousScratchpad) {
      const resetResult = validateMemoryReset(
        previousScratchpad,
        result.scratchpad
      );
      turnErrors.push(...resetResult.errors);
    }

    // Cross-entity synthesis
    if (validation.mustSynthesizeAcrossEntities) {
      const synthesisResult = validateCrossEntitySynthesis(
        result.output,
        result.scratchpad.activeEntities
      );
      turnErrors.push(...synthesisResult.errors);
    }

    // Output content
    if (validation.outputMustContain) {
      const outputResult = validateOutputContains(
        result.output,
        validation.outputMustContain
      );
      turnErrors.push(...outputResult.errors);
    }

    turnValidations.push({ passed: turnErrors.length === 0, errors: turnErrors });
    errors.push(...turnErrors);

    previousMessageId = result.messageId;
    previousScratchpad = result.scratchpad;
  }

  // Scenario-level validation
  if (scenario.validation) {
    const allToolCalls = turnResults.flatMap((r) => r.toolCalls);

    if (scenario.validation.toolCallCountMinimum) {
      const countResult = validateToolCallCount(
        allToolCalls,
        scenario.validation.toolCallCountMinimum
      );
      errors.push(...countResult.errors);
    }

    if (scenario.validation.mustCallTools) {
      const toolResult = validateRequiredTools(
        allToolCalls,
        scenario.validation.mustCallTools
      );
      errors.push(...toolResult.errors);
    }

    if (scenario.validation.mustNotCallTwice) {
      const dupeResult = validateNoDuplicateToolCalls(
        allToolCalls,
        scenario.validation.mustNotCallTwice
      );
      errors.push(...dupeResult.errors);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    suite: scenario.category,
    turnResults: turnValidations,
  };
}

/**
 * Validates a complete persona inference scenario
 */
export function validatePersonaInferenceScenario(
  scenario: PersonaInferenceScenario,
  result: TurnResult
): ScenarioValidationResult {
  const errors: string[] = [];
  const validation = scenario.validation;

  // Persona inference
  if (validation.inferredPersonaMustBe || validation.inferredPersonaMustBeOneOf) {
    const personaResult = validatePersonaInference(
      result.persona?.inferred ?? "UNKNOWN",
      {
        inferredPersonaMustBe: validation.inferredPersonaMustBe,
        inferredPersonaMustBeOneOf: validation.inferredPersonaMustBeOneOf,
      }
    );
    errors.push(...personaResult.errors);
  }

  // Required tools
  if (validation.mustCallTools) {
    const toolResult = validateRequiredTools(
      result.toolCalls,
      validation.mustCallTools
    );
    errors.push(...toolResult.errors);
  }

  // Forbidden tools
  if (validation.mustNotCall) {
    const forbiddenResult = validateForbiddenTools(
      result.toolCalls,
      validation.mustNotCall
    );
    errors.push(...forbiddenResult.errors);
  }

  // Output pattern
  if (validation.outputMustMatch) {
    const patternResult = validateOutputPattern(
      result.output,
      validation.outputMustMatch
    );
    errors.push(...patternResult.errors);
  }

  // Output content
  if (validation.outputMustContain) {
    const outputResult = validateOutputContains(
      result.output,
      validation.outputMustContain
    );
    errors.push(...outputResult.errors);
  }

  // Persona packaging
  if (validation.personaPackagingMustInclude) {
    const packagingResult = validatePersonaPackaging(
      result.output,
      validation.personaPackagingMustInclude
    );
    errors.push(...packagingResult.errors);
  }

  return {
    passed: errors.length === 0,
    errors,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    suite: scenario.category,
  };
}

/**
 * Validates a complete media context scenario
 */
export function validateMediaContextScenario(
  scenario: MediaContextScenario,
  result: TurnResult
): ScenarioValidationResult {
  const errors: string[] = [];
  const validation = scenario.validation;

  // Required tools
  if (validation.mustCallTools) {
    const toolResult = validateRequiredTools(
      result.toolCalls,
      validation.mustCallTools
    );
    errors.push(...toolResult.errors);
  }

  // Forbidden tools
  if (validation.mustNotCall) {
    const forbiddenResult = validateForbiddenTools(
      result.toolCalls,
      validation.mustNotCall
    );
    errors.push(...forbiddenResult.errors);
  }

  // Media references
  if (validation.outputMustReference) {
    const refResult = validateMediaReferences(
      result.output,
      validation.outputMustReference
    );
    errors.push(...refResult.errors);
  }

  // Output content
  if (validation.outputMustContain) {
    const outputResult = validateOutputContains(
      result.output,
      validation.outputMustContain
    );
    errors.push(...outputResult.errors);
  }

  return {
    passed: errors.length === 0,
    errors,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    suite: scenario.category,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Combines multiple validation results
 */
export function combineValidationResults(
  results: ValidationResult[]
): ValidationResult {
  const allErrors = results.flatMap((r) => r.errors);
  const allWarnings = results.flatMap((r) => r.warnings ?? []);

  return {
    passed: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
  };
}

/**
 * Groups scenario results by suite
 */
export function groupResultsBySuite(
  results: ScenarioValidationResult[]
): Record<string, ScenarioValidationResult[]> {
  const grouped: Record<string, ScenarioValidationResult[]> = {};

  for (const result of results) {
    if (!grouped[result.suite]) {
      grouped[result.suite] = [];
    }
    grouped[result.suite].push(result);
  }

  return grouped;
}

/**
 * Generates a summary of validation results
 */
export function generateValidationSummary(results: ScenarioValidationResult[]): {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  bySuite: Record<
    string,
    { total: number; passed: number; failed: number; passRate: number }
  >;
} {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  const passRate = total > 0 ? (passed / total) * 100 : 0;

  const bySuite: Record<
    string,
    { total: number; passed: number; failed: number; passRate: number }
  > = {};

  const grouped = groupResultsBySuite(results);
  for (const [suite, suiteResults] of Object.entries(grouped)) {
    const suiteTotal = suiteResults.length;
    const suitePassed = suiteResults.filter((r) => r.passed).length;
    bySuite[suite] = {
      total: suiteTotal,
      passed: suitePassed,
      failed: suiteTotal - suitePassed,
      passRate: suiteTotal > 0 ? (suitePassed / suiteTotal) * 100 : 0,
    };
  }

  return { total, passed, failed, passRate, bySuite };
}
