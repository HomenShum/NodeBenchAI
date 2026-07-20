/**
 * Meta-Tools Module - Progressive Disclosure Pattern for Tool Scalability
 *
 * Uses Convex-native hybrid search combining BM25 keyword matching
 * and vector semantic search with Reciprocal Rank Fusion.
 *
 * Usage:
 * ```typescript
 * import { metaTools } from "../tools/meta";
 *
 * const agent = new Agent({
 *   tools: metaTools,  // Only 4 meta-tools instead of 50+ direct tools
 * });
 * ```
 *
 * Workflow:
 * 1. Agent calls searchAvailableTools({ query: "what I need" })
 * 2. Agent calls describeTools({ toolNames: ["tool1"] }) for schemas
 * 3. Agent calls invokeTool({ toolName: "tool1", arguments: {...} })
 *
 * Setup (run once after schema push):
 * ```typescript
 * // Seed tools from registry with embeddings
 * await ctx.runAction(internal.tools.meta.seedToolRegistry.seedAllTools, { generateEmbeddings: true });
 * ```
 */

// Meta-tools (hybrid search)
export {
  searchAvailableTools,
  listToolCategories,
  describeTools,
  invokeTool,
  metaTools,
} from "./toolDiscoveryV2";

// Registry utilities
export {
  toolSummaries,
  toolCategories,
  searchTools,
  getAllToolNames,
  getToolsByCategory,
  getToolCountByCategory,
  type ToolCategory,
  type ToolSummary,
} from "./toolRegistry";

// Hybrid search types (for advanced usage)
// Note: The actual functions are in hybridSearch.ts which uses "use node"
// Import them directly from "./hybridSearch" if needed in a Node.js context
export type {
  HybridSearchResult,
  RankedItem,
  CachedSearchResult,
} from "./hybridSearch";

// Cache management functions are available via internal API:
// - internal.tools.meta.hybridSearchQueries.getToolSearchCacheStats
// - internal.tools.meta.hybridSearchQueries.clearToolSearchCache
// - internal.tools.meta.hybridSearchQueries.invalidateExpiredCache
// - internal.tools.meta.hybridSearchQueries.getCachedSearchResults
// - internal.tools.meta.hybridSearchQueries.setCachedSearchResults

// Tool Execution Gateway (progressive disclosure enforcement)
export {
  executeViaGateway,
  confirmActionDraft,
  denyActionDraft,
  isMetaTool,
  getToolRiskTier,
  requiresConfirmation,
  createGatewayContext,
  setActiveSkill,
  getActiveSkill,
  getGatewayDisclosureSummary,
  META_TOOLS,
  TOOL_RISK_TIERS,
  type ActiveSkill,
  type GatewayContext,
  type GatewayResult,
  type ToolExecutor,
} from "./toolGateway";

