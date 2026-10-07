/**
 * Dossier Domain - Public API
 *
 * Exports all dossier-related operations for:
 * - Focus state (bidirectional text↔chart sync)
 * - Annotations (agent-generated chart labels)
 * - Enrichment (cached context for data points)
 */

// Schema exports (for main schema.ts)
export {
  dossierFocusState,
  dossierAnnotations,
  dossierEnrichment,
} from "./schema";

// Focus state operations
export {
  getFocusState,
  updateFocus,
  clearFocus,
  updateFocusInternal,
  getFocusStateInternal,
} from "./focusState";

// Annotation operations
export {
  getAnnotations,
  getAnnotationForDataPoint,
  addAnnotation,
  deleteAnnotation,
  updateAnnotation,
  addAnnotationInternal,
  getAnnotationsInternal,
} from "./annotations";

// Enrichment operations
export {
  getEnrichment,
  getEnrichments,
  addEnrichment,
  addEnrichmentInternal,
  getEnrichmentInternal,
} from "./enrichment";

