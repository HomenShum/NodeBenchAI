/**
 * Graph domain — Expandable mention nodes, backlinks, and entity expansion.
 *
 * Pattern: Roam-style expandable mention nodes with bidirectional
 * cross-linking, web-grounded agent expansion, and lazy infinite traversal.
 *
 * Prior art:
 *   - Roam Research: bidirectional backlinks as first-class primitives, block references
 *   - Obsidian: local graph view, backlinks panel
 *
 * See: docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md
 */

export {
  startExpansion,
  getExpansionStatus,
  getExpansionSnapshot,
} from "./expandEntity.js";

export {
  getBacklinksForEntity,
  getBacklinkCount,
  getBacklinksByDocument,
  getBacklinksBySource,
  getBacklinksByRun,
  getBacklinkSummary,
} from "./backlinkQueries.js";

export {
  getLatestRun,
  getRunByRunId,
  getRunsByUser,
  getActiveRuns,
  getEntityExpansionHistory,
  isExpanding,
} from "./expansionQueries.js";
