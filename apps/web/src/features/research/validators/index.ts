/**
 * Research Feature Validators
 *
 * Exports validation utilities for the research feature including:
 * - Brief payload validator (anti-log lint)
 * - Vega spec security validator
 */

export {
  validateBriefPayload,
  formatValidationErrorsForRetry,
  hasLogLikeContent,
  type ValidationResult
} from "./briefValidator";
