/**
 * MCP Gateway Schema — API keys & session telemetry tables
 *
 * Separated from apiKeys.ts (mutations/queries) per Convex convention:
 * schema definitions are pure table shapes, no runtime logic.
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════════════════
// mcpApiKeys — stores SHA-256 hashes of API keys (never raw keys)
// ═══════════════════════════════════════════════════════════════════════════

export const mcpApiKeys = defineTable({
  keyHash: v.string(),           // full SHA-256 hex of raw key
  keyHashPrefix: v.string(),     // first 12 chars of hash (fast lookup)
  userId: v.string(),            // owner of this key
  label: v.string(),             // human-friendly name (e.g. "cursor-dev", "claude-prod")
  permissions: v.array(v.string()), // e.g. ["tools:read", "tools:execute"]
  rateLimits: v.object({
    perMinute: v.number(),       // max calls per minute (default: 100)
    perDay: v.number(),          // max calls per day (default: 10,000)
  }),
  createdAt: v.number(),         // epoch ms
  lastUsedAt: v.number(),        // epoch ms — updated on each successful auth
  revokedAt: v.optional(v.number()), // epoch ms — soft-delete
})
  .index("by_hash_prefix", ["keyHashPrefix"])
  .index("by_user", ["userId"]);

// ═══════════════════════════════════════════════════════════════════════════
// mcpGatewaySessions — telemetry for each WebSocket session
// ═══════════════════════════════════════════════════════════════════════════

export const mcpGatewaySessions = defineTable({
  sessionId: v.string(),         // crypto.randomUUID per connection
  userId: v.string(),            // from API key
  connectedAt: v.number(),       // epoch ms
  disconnectedAt: v.number(),    // epoch ms
  durationMs: v.number(),        // disconnectedAt - connectedAt
  toolCallCount: v.number(),     // total tool calls in this session
  totalToolLatencyMs: v.number(), // sum of all tool call durations
  errorCount: v.number(),        // tool calls that errored
  disconnectReason: v.string(),  // "idle timeout", "client close", "error: ..."
})
  .index("by_user", ["userId"])
  .index("by_session", ["sessionId"]);
