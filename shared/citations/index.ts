// shared/citations/index.ts
// Barrel export for citation utilities

export {
  buildStableCitationIndex,
  injectInlineCitationSupers,
  stripFactAnchors,
  extractFactIds,
  type FactToArtifacts,
  type CitationIndex,
} from "./injectInlineCitations";

export {
  fnv1a32Hex,
  makeWebSourceCitationId,
  type WebSourceLike,
} from "./webSourceCitations";
