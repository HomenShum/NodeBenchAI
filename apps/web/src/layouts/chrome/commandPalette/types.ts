/**
 * Shared types for the Cmd-K palette federated-search consumer.
 *
 * Mirrors the action response shape from
 * `convex/domains/search/federatedSearch.ts`. Re-declared here to:
 *   1. Avoid pulling Convex's generated api types into UI code at build time.
 *   2. Keep the UI compilable when the action's path moves.
 *
 * If federatedSearch's response shape changes, update both. The mismatch
 * surface area is small (single hook) so keeping them in sync is cheap.
 */

export type FederatedCollection =
  | "nb_entities"
  | "nb_reports"
  | "nb_notebook_blocks"
  | "nb_claims"
  | "nb_sources"
  | "nb_captures"
  | "nb_threads";

export interface FederatedHandle {
  type: FederatedCollection;
  uri: string;
  title: string;
  snippet: string;
  score: number;
  source: string;
  actions: string[];
}

export interface CollectionResult {
  collection: FederatedCollection;
  ok: boolean;
  results: FederatedHandle[];
  count: number;
  error?: string;
}

export interface FederatedSearchResponse {
  query: string;
  collections: CollectionResult[];
  total: number;
  timedOut: boolean;
  partial: boolean;
  identityScope: "authenticated" | "anonymous";
}

/**
 * Display order — drives left-to-right group rendering and Cmd+1..7 jump
 * shortcuts. Stable across calls (DETERMINISTIC).
 */
export const COLLECTION_DISPLAY_ORDER: ReadonlyArray<FederatedCollection> = [
  "nb_entities",
  "nb_reports",
  "nb_notebook_blocks",
  "nb_claims",
  "nb_sources",
  "nb_captures",
  "nb_threads",
];

/**
 * Plain-language labels (per .claude/rules/reexamine_design_reduction.md —
 * kill jargon). Used in group headers and aria-live announcements.
 */
export const COLLECTION_LABELS: Record<FederatedCollection, string> = {
  nb_entities: "Entities",
  nb_reports: "Reports",
  nb_notebook_blocks: "Notebook blocks",
  nb_claims: "Claims",
  nb_sources: "Sources",
  nb_captures: "Captures",
  nb_threads: "Threads",
};

/** Per-group display cap (BOUND). Federated search action also caps server-side. */
export const MAX_RESULTS_PER_GROUP = 5;
/** Total cap across all groups in the palette (BOUND). */
export const MAX_RESULTS_TOTAL = 35;
/** Client-side abort budget: server is 3 s + 0.5 s buffer (TIMEOUT). */
export const CLIENT_TIMEOUT_MS = 3500;
/** Debounce window before firing federatedSearch on every keystroke. */
export const SEARCH_DEBOUNCE_MS = 150;
