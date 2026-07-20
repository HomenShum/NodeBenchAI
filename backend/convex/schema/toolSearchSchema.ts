/**
 * Tool Search Schema - Tables for Hybrid Search System
 * 
 * Three tables:
 * 1. toolRegistryTable - Tool catalog with embeddings for semantic search
 * 2. toolUsageTable - Usage tracking for popularity-based ranking
 * 3. toolSearchCacheTable - Query result caching (optional)
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY TABLE
// Central catalog of all tools with BM25 + vector search capabilities
// ═══════════════════════════════════════════════════════════════════════════

export const toolRegistryTable = defineTable({
  // Core identity
  toolName: v.string(),           // Unique tool identifier (e.g., "createDocument")
  
  // Searchable content
  description: v.string(),        // Full description for BM25 search
  keywords: v.array(v.string()),  // Keywords for keyword matching
  keywordsText: v.string(),       // Joined keywords for searchIndex (keywords as space-separated string)
  
  // Classification
  category: v.string(),           // Category key (e.g., "document", "media", "search")
  categoryName: v.string(),       // Human-readable category (e.g., "Document Operations")
  
  // Module location
  module: v.string(),             // Import path (e.g., "document/documentTools")
  
  // Optional enhancements
  examples: v.optional(v.array(v.string())),  // Usage examples for better semantic matching
  
  // Vector embedding for semantic search
  embedding: v.optional(v.array(v.float64())), // 1536-dim OpenAI text-embedding-3-small
  
  // Usage & ranking
  usageCount: v.number(),         // Times this tool was invoked (for popularity boost)
  successRate: v.optional(v.number()), // Success rate 0-1 (for quality ranking)
  avgExecutionMs: v.optional(v.number()), // Average execution time
  
  // Status
  isEnabled: v.boolean(),         // Whether tool is available for discovery
  
  // Metadata
  metadata: v.optional(v.any()),  // Arbitrary additional data
})
  // Standard indexes
  .index("by_toolName", ["toolName"])
  .index("by_category", ["category"])
  .index("by_usage", ["usageCount"])
  .index("by_enabled", ["isEnabled"])
  .index("by_enabled_category", ["isEnabled", "category"])
  
  // BM25 Full-text search index on description
  .searchIndex("search_description", {
    searchField: "description",
    filterFields: ["category", "isEnabled"],
  })
  
  // BM25 Full-text search index on keywords
  .searchIndex("search_keywords", {
    searchField: "keywordsText",
    filterFields: ["category", "isEnabled"],
  })
  
  // Vector index for semantic search
  .vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 1536,
    filterFields: ["category", "isEnabled"],
  });

// ═══════════════════════════════════════════════════════════════════════════
// TOOL USAGE TABLE
// Tracks individual tool invocations for analytics and popularity ranking
// ═══════════════════════════════════════════════════════════════════════════

export const toolUsageTable = defineTable({
  toolName: v.string(),           // Tool that was invoked
  queryText: v.string(),          // Original search query that led to this tool
  wasSuccessful: v.boolean(),     // Whether execution succeeded
  executionTimeMs: v.optional(v.number()), // Execution duration
  errorMessage: v.optional(v.string()),    // Error details if failed
  userId: v.optional(v.id("users")),       // User who invoked (if available)
})
  .index("by_tool", ["toolName"])
  .index("by_timestamp", ["_creationTime"])
  .index("by_tool_success", ["toolName", "wasSuccessful"]);

// ═══════════════════════════════════════════════════════════════════════════
// TOOL SEARCH CACHE TABLE (Optional)
// Caches hybrid search results to reduce latency for repeated queries
// ═══════════════════════════════════════════════════════════════════════════

export const toolSearchCacheTable = defineTable({
  queryHash: v.string(),          // SHA-256 hash of normalized query + params
  queryText: v.string(),          // Original query text
  category: v.optional(v.string()), // Category filter if applied
  results: v.array(v.object({     // Cached results
    toolName: v.string(),
    score: v.number(),
    matchType: v.string(),        // "keyword" | "semantic" | "hybrid"
  })),
  expiresAt: v.number(),          // Unix timestamp for cache expiration
})
  .index("by_hash", ["queryHash"])
  .index("by_expiry", ["expiresAt"]);

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTED TABLES FOR SCHEMA INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

export const toolSearchTables = {
  toolRegistry: toolRegistryTable,
  toolUsage: toolUsageTable,
  toolSearchCache: toolSearchCacheTable,
};

