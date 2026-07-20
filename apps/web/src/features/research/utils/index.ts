/**
 * Research Feature Utilities
 *
 * Exports utility functions for the research feature.
 */

export {
  parseAndValidateBrief,
  buildRetryPrompt,
  briefToScrollySections,
  extractAllEvidence,
  getSourceBreakdown,
  type GenerationResult,
  type GeneratorOptions
} from "./briefGenerator";

export { buildResearchStreamViewModel } from "./briefTransformers";
