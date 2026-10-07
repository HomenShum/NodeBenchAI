// convex/lib/factValidation.ts
// Fact validation with boolean pass/fail logic for GAM

import { QUALITY_THRESHOLDS } from "./memoryLimits";

/**
 * A structured fact from research.
 * Uses boolean isHighConfidence instead of arbitrary numeric confidence.
 */
export interface StructuredFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  /** Boolean: does this fact meet confidence threshold? */
  isHighConfidence: boolean;
  sourceIds: string[];
  timestamp: string;
  isOutdated?: boolean;
}

/**
 * Validation result - boolean pass/fail with reasons.
 */
export interface FactValidationResult {
  /** Does this fact pass all validation checks? */
  isValid: boolean;
  
  /** Does this fact meet confidence threshold? */
  isHighConfidence: boolean;
  
  /** Does the subject match the expected entity? */
  isSubjectRelevant: boolean;
  
  /** Is the fact well-formed (non-empty fields)? */
  isWellFormed: boolean;
  
  /** Human-readable error messages for failures */
  errors: string[];
  
  /** Warnings (non-blocking issues) */
  warnings: string[];
}

/**
 * Validate a single fact using boolean logic.
 * Returns clear PASS/FAIL for each check.
 */
export function validateFact(
  fact: {
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
  },
  entityName: string
): FactValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check 1: Well-formed (all fields non-empty)
  const isWellFormed = 
    fact.subject.trim().length > 0 &&
    fact.predicate.trim().length > 0 &&
    fact.object.trim().length > 0;
  
  if (!isWellFormed) {
    errors.push("Fact has empty subject, predicate, or object");
  }

  // Check 2: Confidence in valid range [0, 1]
  const confidenceInRange = fact.confidence >= 0 && fact.confidence <= 1;
  if (!confidenceInRange) {
    errors.push(`Confidence ${fact.confidence} must be in [0, 1]`);
  }

  // Check 3: High confidence (meets threshold)
  const isHighConfidence = fact.confidence >= QUALITY_THRESHOLDS.minFactConfidence;
  if (!isHighConfidence) {
    errors.push(`Confidence ${fact.confidence} below threshold ${QUALITY_THRESHOLDS.minFactConfidence}`);
  }

  // Check 4: Subject relevance (should relate to entity)
  const subjectLower = fact.subject.toLowerCase();
  const entityLower = entityName.toLowerCase();
  const isSubjectRelevant = 
    subjectLower.includes(entityLower) || 
    entityLower.includes(subjectLower) ||
    subjectLower.split(/\s+/).some(word => entityLower.includes(word));
  
  if (!isSubjectRelevant) {
    warnings.push(`Subject "${fact.subject}" may not relate to entity "${entityName}"`);
  }

  // Check 5: Object not too long
  if (fact.object.length > 1000) {
    errors.push("Object too long (max 1000 chars)");
  }

  // Check 6: Predicate not too long
  if (fact.predicate.length > 100) {
    errors.push("Predicate too long (max 100 chars)");
  }

  // Overall validity: all critical checks pass
  const isValid = isWellFormed && confidenceInRange && isHighConfidence && 
    fact.object.length <= 1000 && fact.predicate.length <= 100;

  return {
    isValid,
    isHighConfidence,
    isSubjectRelevant,
    isWellFormed,
    errors,
    warnings,
  };
}

/**
 * Validate a batch of facts.
 * Separates valid facts from rejected ones.
 */
export function validateFactBatch(
  facts: Array<{
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
  }>,
  entityName: string
): {
  validFacts: typeof facts;
  rejectedFacts: Array<typeof facts[0] & { reason: string }>;
  validationSummary: {
    total: number;
    valid: number;
    rejected: number;
    allHighConfidence: boolean;
  };
} {
  const validFacts: typeof facts = [];
  const rejectedFacts: Array<typeof facts[0] & { reason: string }> = [];

  for (const fact of facts) {
    const result = validateFact(fact, entityName);
    
    if (result.isValid) {
      validFacts.push(fact);
    } else {
      rejectedFacts.push({
        ...fact,
        reason: result.errors.join("; "),
      });
    }
  }

  return {
    validFacts,
    rejectedFacts,
    validationSummary: {
      total: facts.length,
      valid: validFacts.length,
      rejected: rejectedFacts.length,
      // All validated facts passed the confidence check (that's part of validation)
      allHighConfidence: true,
    },
  };
}

/**
 * Check for conflicts between two facts.
 * Returns true if facts conflict (same subject+predicate, different object).
 */
export function factsConflict(
  fact1: { subject: string; predicate: string; object: string },
  fact2: { subject: string; predicate: string; object: string }
): boolean {
  const sameSubject = fact1.subject.toLowerCase() === fact2.subject.toLowerCase();
  const samePredicate = fact1.predicate.toLowerCase() === fact2.predicate.toLowerCase();
  const differentObject = fact1.object.toLowerCase() !== fact2.object.toLowerCase();
  
  return sameSubject && samePredicate && differentObject;
}

/**
 * Find conflicts between a new fact and existing facts.
 */
export function findConflicts(
  newFact: { subject: string; predicate: string; object: string },
  existingFacts: StructuredFact[]
): StructuredFact[] {
  return existingFacts.filter(existing => 
    !existing.isOutdated && factsConflict(newFact, existing)
  );
}

/**
 * Generate a unique fact ID.
 */
export function generateFactId(): string {
  return `fact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
