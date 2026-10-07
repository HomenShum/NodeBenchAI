/**
 * agentCache.ts
 *
 * Intelligent Caching & Memoization for Deep Agent 2.0
 *
 * Caching Strategy:
 * - Context cache: 20-30% savings on repeated operations
 * - Embedding cache: Expensive vector operations
 * - Search results cache: Avoid redundant web searches
 * - LRU eviction: Keep cache size bounded
 *
 * Expected Improvement: 20-30% on repeated operations
 */

import { Id } from "../_generated/dataModel";

export interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
  hits: number;
  metadata?: Record<string, any>;
}

export interface CacheStats {
  total: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
  avgAge: number;
  totalSize: number;
}

/**
 * LRU Cache with TTL support
 */
export class AgentCache<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;
  private defaultTTL: number;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(options: {
    maxSize?: number;
    defaultTTL?: number;
  } = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = options.defaultTTL || 3600000; // 1 hour default
  }

  /**
   * Get value from cache
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    // Update hits and move to end (LRU)
    entry.hits++;
    this.stats.hits++;
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T, ttl?: number, metadata?: Record<string, any>): void {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      key,
      value,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
      hits: 0,
      metadata,
    };

    this.cache.set(key, entry);
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete key from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const now = Date.now();

    return {
      total: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
      avgAge: entries.length > 0
        ? entries.reduce((sum, e) => sum + (now - e.timestamp), 0) / entries.length
        : 0,
      totalSize: this.cache.size,
    };
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      this.cache.delete(firstKey);
      this.stats.evictions++;
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }
}

/**
 * Cache key generators for common scenarios
 */
export const CacheKeys = {
  document: (id: Id<"documents">) => `doc:${id}`,
  documentContent: (id: Id<"documents">, version?: number) =>
    version ? `doc-content:${id}:v${version}` : `doc-content:${id}`,
  documentSummary: (id: Id<"documents">) => `doc-summary:${id}`,
  documentEmbedding: (id: Id<"documents">) => `doc-embedding:${id}`,

  search: (query: string, filters?: Record<string, any>) =>
    `search:${query}:${filters ? JSON.stringify(filters) : ''}`,
  webSearch: (query: string) => `web-search:${query}`,

  entity: (entityId: string) => `entity:${entityId}`,
  entityInsights: (entityId: string) => `entity-insights:${entityId}`,

  userContext: (userId: Id<"users">) => `user-context:${userId}`,
  agentMemory: (agentId: string, key: string) => `agent-memory:${agentId}:${key}`,

  custom: (namespace: string, key: string) => `${namespace}:${key}`,
};

/**
 * Specialized caches for different data types
 */
export class AgentCacheManager {
  // Document-related caching
  private documentCache = new AgentCache<any>({
    maxSize: 500,
    defaultTTL: 1800000, // 30 minutes
  });

  // Search results caching
  private searchCache = new AgentCache<any>({
    maxSize: 200,
    defaultTTL: 600000, // 10 minutes
  });

  // Embedding caching (expensive operations)
  private embeddingCache = new AgentCache<number[]>({
    maxSize: 1000,
    defaultTTL: 7200000, // 2 hours
  });

  // Context caching (frequently accessed)
  private contextCache = new AgentCache<any>({
    maxSize: 300,
    defaultTTL: 900000, // 15 minutes
  });

  // Entity insights caching
  private entityCache = new AgentCache<any>({
    maxSize: 500,
    defaultTTL: 3600000, // 1 hour
  });

  /**
   * Get document with caching
   */
  async getDocument(
    id: Id<"documents">,
    fetcher: () => Promise<any>
  ): Promise<any> {
    const key = CacheKeys.document(id);
    const cached = this.documentCache.get(key);

    if (cached) {
      console.log(`[Cache] HIT: Document ${id}`);
      return cached;
    }

    console.log(`[Cache] MISS: Document ${id}`);
    const doc = await fetcher();
    this.documentCache.set(key, doc);
    return doc;
  }

  /**
   * Get document embedding with caching
   */
  async getEmbedding(
    id: Id<"documents">,
    generator: () => Promise<number[]>
  ): Promise<number[]> {
    const key = CacheKeys.documentEmbedding(id);
    const cached = this.embeddingCache.get(key);

    if (cached) {
      console.log(`[Cache] HIT: Embedding ${id}`);
      return cached;
    }

    console.log(`[Cache] MISS: Embedding ${id} (generating...)`);
    const embedding = await generator();
    this.embeddingCache.set(key, embedding, 7200000); // 2 hours
    return embedding;
  }

  /**
   * Get search results with caching
   */
  async getSearchResults(
    query: string,
    searcher: () => Promise<any>
  ): Promise<any> {
    const key = CacheKeys.search(query);
    const cached = this.searchCache.get(key);

    if (cached) {
      console.log(`[Cache] HIT: Search "${query}"`);
      return cached;
    }

    console.log(`[Cache] MISS: Search "${query}"`);
    const results = await searcher();
    this.searchCache.set(key, results);
    return results;
  }

  /**
   * Get entity insights with caching
   */
  async getEntityInsights(
    entityId: string,
    fetcher: () => Promise<any>
  ): Promise<any> {
    const key = CacheKeys.entityInsights(entityId);
    const cached = this.entityCache.get(key);

    if (cached) {
      console.log(`[Cache] HIT: Entity insights ${entityId}`);
      return cached;
    }

    console.log(`[Cache] MISS: Entity insights ${entityId}`);
    const insights = await fetcher();
    this.entityCache.set(key, insights);
    return insights;
  }

  /**
   * Invalidate document cache
   */
  invalidateDocument(id: Id<"documents">): void {
    this.documentCache.delete(CacheKeys.document(id));
    this.documentCache.delete(CacheKeys.documentContent(id));
    this.documentCache.delete(CacheKeys.documentSummary(id));
    this.embeddingCache.delete(CacheKeys.documentEmbedding(id));
    console.log(`[Cache] Invalidated document ${id}`);
  }

  /**
   * Get combined statistics
   */
  getStats(): Record<string, CacheStats> {
    return {
      documents: this.documentCache.getStats(),
      search: this.searchCache.getStats(),
      embeddings: this.embeddingCache.getStats(),
      context: this.contextCache.getStats(),
      entities: this.entityCache.getStats(),
    };
  }

  /**
   * Print cache performance report
   */
  printReport(): void {
    const stats = this.getStats();

    console.log('\n=== Agent Cache Performance Report ===');
    for (const [name, stat] of Object.entries(stats)) {
      console.log(`\n${name.toUpperCase()} Cache:`);
      console.log(`  Total entries: ${stat.total}`);
      console.log(`  Hit rate: ${(stat.hitRate * 100).toFixed(1)}%`);
      console.log(`  Hits: ${stat.hits} | Misses: ${stat.misses}`);
      console.log(`  Evictions: ${stat.evictions}`);
      console.log(`  Avg age: ${Math.round(stat.avgAge / 1000)}s`);
    }

    const totalHits = Object.values(stats).reduce((sum, s) => sum + s.hits, 0);
    const totalMisses = Object.values(stats).reduce((sum, s) => sum + s.misses, 0);
    const overallHitRate = totalHits / (totalHits + totalMisses);

    console.log(`\nOVERALL:`);
    console.log(`  Hit rate: ${(overallHitRate * 100).toFixed(1)}%`);
    console.log(`  Total hits: ${totalHits}`);
    console.log(`  Total misses: ${totalMisses}`);
    console.log('=====================================\n');
  }

  /**
   * Cleanup expired entries across all caches
   */
  cleanup(): void {
    const cleaned = {
      documents: this.documentCache.cleanup(),
      search: this.searchCache.cleanup(),
      embeddings: this.embeddingCache.cleanup(),
      context: this.contextCache.cleanup(),
      entities: this.entityCache.cleanup(),
    };

    const total = Object.values(cleaned).reduce((sum, c) => sum + c, 0);
    console.log(`[Cache] Cleaned up ${total} expired entries`);
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.documentCache.clear();
    this.searchCache.clear();
    this.embeddingCache.clear();
    this.contextCache.clear();
    this.entityCache.clear();
    console.log('[Cache] All caches cleared');
  }
}

// Singleton instance
export const agentCacheManager = new AgentCacheManager();

/**
 * Memoization decorator for expensive operations
 */
export function memoize<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: {
    keyGenerator?: (...args: Parameters<T>) => string;
    ttl?: number;
    cache?: AgentCache<any>;
  } = {}
): T {
  const cache = options.cache || new AgentCache({ defaultTTL: options.ttl });

  const keyGenerator = options.keyGenerator || ((...args) => JSON.stringify(args));

  return (async (...args: Parameters<T>) => {
    const key = keyGenerator(...args);
    const cached = cache.get(key);

    if (cached !== null) {
      return cached;
    }

    const result = await fn(...args);
    cache.set(key, result, options.ttl);
    return result;
  }) as T;
}
