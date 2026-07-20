/**
 * Enrichment Workpools
 *
 * Defines priority-based workpools for entity enrichment and funding detection.
 * - High-priority pool: Digest-critical items (funding events, entity promotion)
 * - Backfill pool: Background enrichment with lower parallelism
 */
import { Workpool } from "@convex-dev/workpool";
import { components } from "../../_generated/api";

/**
 * High-priority pool for digest-critical items.
 * Used for time-sensitive enrichment like funding detection before daily brief.
 */
export const enrichHighPriorityPool = new Workpool(components.workpool, {
  maxParallelism: 5,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 3,
    initialBackoffMs: 1000,
    base: 2,
  },
});

/**
 * Backfill pool for background enrichment.
 * Used for non-urgent enrichment like historical data backfill.
 */
export const enrichBackfillPool = new Workpool(components.workpool, {
  maxParallelism: 2,
  retryActionsByDefault: true,
  defaultRetryBehavior: {
    maxAttempts: 5,
    initialBackoffMs: 2000,
    base: 2,
  },
});
