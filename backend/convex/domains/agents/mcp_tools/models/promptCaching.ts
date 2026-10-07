/**
 * Prompt Caching for Anthropic Claude
 *
 * Industry Pattern (2026): 90% cost reduction on repeated context
 * - 5-minute cache: 1.25x write, 0.1x read (90% savings)
 * - 1-hour cache: 2x write, 0.1x read (95% savings on frequent reuse)
 *
 * Based on: Anthropic Prompt Caching (2025-2026 best practices)
 * https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 *
 * Usage:
 * - Add cache_control: { type: "ephemeral" } to system prompts, tools, or messages
 * - Cache blocks must be 1024+ tokens (2048+ recommended)
 * - Only last 4 blocks are cached (prioritize longest/most repeated)
 * - Supported models: Claude Opus 4.7, Sonnet 4.6, Haiku 4.5
 *
 * INDUSTRY_MONITOR: prompt_caching
 * Keywords: ["prompt caching", "cache", "anthropic", "cost optimization"]
 * Auto-scans: Anthropic, OpenAI (for caching updates)
 */

import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cache control directive for Anthropic API
 * - ephemeral: 5-minute cache (default, best for most use cases)
 */
export interface CacheControl {
  type: "ephemeral";
}

/**
 * Message with optional caching
 */
export interface CacheableMessage {
  role: "user" | "assistant";
  content: string | Array<any>;
  cache_control?: CacheControl;
}

/**
 * System prompt with optional caching
 */
export interface CacheableSystemPrompt {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

/**
 * Tool definition with optional caching
 */
export interface CacheableTool {
  name: string;
  description: string;
  input_schema: any;
  cache_control?: CacheControl;
}

/**
 * Caching statistics for observability
 */
export interface CachingStats {
  inputTokens: number;
  cacheCreationInputTokens?: number; // Tokens written to cache (1.25x cost)
  cacheReadInputTokens?: number; // Tokens read from cache (0.1x cost)
  outputTokens: number;
  totalCost: number;
  cacheHitRate?: number; // % of tokens served from cache
  estimatedSavings?: number; // USD saved vs non-cached request
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add caching to a system prompt
 *
 * Best practice: Cache system prompts that are >1024 tokens and reused across requests
 * Examples: Agent role definitions, workflow templates, tool catalogs
 */
export function cacheSystemPrompt(text: string): CacheableSystemPrompt {
  return {
    type: "text",
    text,
    cache_control: { type: "ephemeral" },
  };
}

/**
 * Add caching to the last user message with long context
 *
 * Best practice: Cache long document context, knowledge bases, or reference materials
 * that are shared across multiple queries in a conversation
 */
export function cacheUserMessage(content: string | Array<any>): CacheableMessage {
  return {
    role: "user",
    content,
    cache_control: { type: "ephemeral" },
  };
}

/**
 * Add caching to tool definitions
 *
 * Best practice: Cache large tool catalogs (>10 tools with detailed schemas)
 * that are consistent across requests
 */
export function cacheTools(tools: Array<any>): CacheableTool[] {
  if (tools.length === 0) return [];

  // Only cache the last tool definition (Anthropic caches last 4 blocks)
  // This works best with a large tool catalog as the final tool
  const cachedTools = [...tools];
  cachedTools[cachedTools.length - 1] = {
    ...cachedTools[cachedTools.length - 1],
    cache_control: { type: "ephemeral" },
  };

  return cachedTools as CacheableTool[];
}

/**
 * Calculate cost with caching
 *
 * @param inputTokens Total input tokens
 * @param cacheWriteTokens Tokens written to cache (first request)
 * @param cacheReadTokens Tokens read from cache (subsequent requests)
 * @param outputTokens Output tokens generated
 * @param model Model name (for pricing)
 * @returns Cost breakdown with savings estimate
 */
export function calculateCachingCost(
  inputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
  model: string
): CachingStats {
  // Pricing per million tokens (2026 rates)
  const pricing: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
    "claude-opus-4-7": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
    "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
    // Legacy compatibility while historical records still exist.
    "claude-opus-4": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
    "claude-opus-4-5": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    "claude-sonnet-4": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    "claude-sonnet-4-5": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
    "claude-haiku-4": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  };

  const modelPricing = pricing[model] || pricing["claude-sonnet-4-6"]; // Default to Sonnet 4.6

  // Calculate costs (per million tokens)
  const uncachedInputTokens = inputTokens - cacheWriteTokens - cacheReadTokens;

  const inputCost = (uncachedInputTokens * modelPricing.input) / 1_000_000;
  const cacheWriteCost = (cacheWriteTokens * modelPricing.cacheWrite) / 1_000_000;
  const cacheReadCost = (cacheReadTokens * modelPricing.cacheRead) / 1_000_000;
  const outputCost = (outputTokens * modelPricing.output) / 1_000_000;

  const totalCost = inputCost + cacheWriteCost + cacheReadCost + outputCost;

  // Calculate what this would have cost without caching
  const noCacheCost = ((inputTokens * modelPricing.input) + (outputTokens * modelPricing.output)) / 1_000_000;
  const estimatedSavings = noCacheCost - totalCost;

  // Calculate cache hit rate
  const cacheHitRate = inputTokens > 0 ? (cacheReadTokens / inputTokens) * 100 : 0;

  return {
    inputTokens,
    cacheCreationInputTokens: cacheWriteTokens,
    cacheReadInputTokens: cacheReadTokens,
    outputTokens,
    totalCost,
    cacheHitRate,
    estimatedSavings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHING STRATEGIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Strategy 1: Swarm Orchestrator Caching
 *
 * Pattern: System prompt + agent definitions are repeated across all agents
 * Savings: 90% on system prompt (typically 2000-5000 tokens)
 *
 * Implementation:
 * 1. Cache system prompt with agent roles
 * 2. Cache tool definitions (if >10 tools)
 * 3. Each agent in swarm reuses cached context
 */
export interface SwarmCachingConfig {
  systemPrompt: string; // Should be >1024 tokens
  tools?: Array<any>; // Tool definitions
  enableToolCaching: boolean; // Cache tools if >10 tools
}

export function buildCachedSwarmRequest(config: SwarmCachingConfig) {
  const cachedSystem = cacheSystemPrompt(config.systemPrompt);

  const cachedTools = config.enableToolCaching && config.tools && config.tools.length > 10
    ? cacheTools(config.tools)
    : config.tools;

  return {
    system: [cachedSystem],
    tools: cachedTools,
  };
}

/**
 * Strategy 2: Workflow Template Caching
 *
 * Pattern: Daily/weekly workflows reuse same template structure
 * Savings: 90% on template (typically 1000-3000 tokens)
 *
 * Example: Daily Morning Brief, LinkedIn post generation
 */
export interface WorkflowCachingConfig {
  templatePrompt: string; // Reusable template >1024 tokens
  dynamicContext: string; // Changes per execution
}

export function buildCachedWorkflowRequest(config: WorkflowCachingConfig): CacheableMessage[] {
  return [
    {
      role: "user",
      content: config.templatePrompt,
      cache_control: { type: "ephemeral" },
    },
    {
      role: "user",
      content: config.dynamicContext,
    },
  ];
}

/**
 * Strategy 3: Document Analysis Caching
 *
 * Pattern: Long document context reused for multiple questions
 * Savings: 90% on document (potentially 10,000+ tokens)
 *
 * Example: SEC filing analysis, research paper Q&A
 */
export interface DocumentCachingConfig {
  documentContent: string; // Long document >2048 tokens
  queries: string[]; // Multiple questions about same document
}

export function buildCachedDocumentRequest(
  config: DocumentCachingConfig,
  currentQuery: string
): CacheableMessage[] {
  return [
    {
      role: "user",
      content: [
        { type: "text", text: config.documentContent },
        {
          type: "text",
          text: currentQuery,
        },
      ],
      cache_control: { type: "ephemeral" },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// BEST PRACTICES & GUIDELINES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * WHEN TO USE PROMPT CACHING:
 *
 * ✅ GOOD USE CASES:
 * - Swarm agents with shared system prompts (2000+ tokens)
 * - Workflow templates reused hourly/daily (1000+ tokens)
 * - Document Q&A with multiple queries (5000+ tokens)
 * - Large tool catalogs (>10 tools, 2000+ tokens)
 * - RAG with static knowledge base chunks
 *
 * ❌ AVOID:
 * - One-off requests (no reuse = no savings)
 * - Short prompts <1024 tokens (below minimum threshold)
 * - Highly dynamic content that changes every request
 * - Requests >5min apart (cache expires)
 *
 * OPTIMIZATION TIPS:
 * 1. Front-load static content (system prompts, docs, tools)
 * 2. Only cache blocks >1024 tokens (2048+ recommended)
 * 3. Limit to 4 cached blocks (most recent are cached)
 * 4. Monitor cache hit rates (aim for >70%)
 * 5. Combine with batch API for non-urgent tasks (50% + 90% = 95% savings)
 *
 * COST EXAMPLE:
 * Swarm with 10 agents, 3000-token system prompt:
 * - Without caching: 10 × 3000 × $3/M = $0.090
 * - With caching: (3000 × 1.25 + 9 × 3000 × 0.1) × $3/M = $0.011
 * - Savings: 88% ($0.079 per swarm execution)
 * - At 1000 swarms/month: $79 saved
 */

/**
 * MONITORING CACHING EFFECTIVENESS:
 *
 * Track these metrics per request:
 * - cache_creation_input_tokens: Tokens written to cache (should be low %)
 * - cache_read_input_tokens: Tokens served from cache (should be high %)
 * - Cache hit rate: cache_read / total_input (target >70%)
 * - Cost savings: Compare vs non-cached baseline
 *
 * Alert if:
 * - Cache hit rate <50% (caching wrong content or too dynamic)
 * - Cache write tokens >50% (creating cache too frequently)
 * - Savings <$0.001 per request (not worth complexity)
 */

export const CACHING_GUIDELINES = {
  MIN_TOKENS_TO_CACHE: 1024,
  RECOMMENDED_MIN_TOKENS: 2048,
  MAX_CACHED_BLOCKS: 4,
  CACHE_TTL_MINUTES: 5,
  TARGET_HIT_RATE: 70, // %
  MIN_SAVINGS_THRESHOLD: 0.001, // USD
} as const;
