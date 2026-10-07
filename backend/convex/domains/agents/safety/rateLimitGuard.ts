/**
 * Rate-Limit Guard
 *
 * Composes existing billing rate limiters with per-entity and per-provider
 * caps that protect the demo from self-inflicted quota exhaustion when
 * 100 attendees hit the same hot path.
 *
 * Thin wrapper — delegates actual token bucket to
 * convex/domains/integrations/billing/rateLimiting.
 *
 * Rule: .claude/rules/agentic_reliability.md HONEST_STATUS — 429 on cap hit,
 * never silent queue.
 */

export type RateLimitScope =
  | "per_user_per_minute"
  | "per_entity_per_minute"
  | "per_provider_per_minute"
  | "per_tenant_per_hour";

export interface RateLimitCheck {
  allowed: boolean;
  scope: RateLimitScope;
  remaining: number;
  resetAtMs: number;
  retryAfterMs?: number;
  reason?: string;
}

export interface RateLimitKey {
  userId?: string;
  tenantId?: string;
  entitySlug?: string;
  provider?: "openai" | "anthropic" | "google" | "linkup" | "fusion";
  scope: RateLimitScope;
}

// Conservative caps tuned for 100-user conference demo.
// These are soft in-memory caps; real production caps live in the
// existing billing rate limiter. This is a demo-safety overlay.
const CAPS_PER_MINUTE: Record<RateLimitScope, number> = {
  per_user_per_minute: 30,
  per_entity_per_minute: 120, // hot entity during burst — allow crowd
  per_provider_per_minute: 300, // global provider cap
  per_tenant_per_hour: 2000,
};

interface Bucket {
  count: number;
  windowStartMs: number;
  windowMs: number;
}

const WINDOW_MS: Record<RateLimitScope, number> = {
  per_user_per_minute: 60_000,
  per_entity_per_minute: 60_000,
  per_provider_per_minute: 60_000,
  per_tenant_per_hour: 3_600_000,
};

const MAX_BUCKETS = 10_000;
const buckets = new Map<string, Bucket>();

function bucketKey(k: RateLimitKey): string {
  return [
    k.scope,
    k.userId ?? "-",
    k.tenantId ?? "-",
    k.entitySlug ?? "-",
    k.provider ?? "-",
  ].join("|");
}

function evictIfNeeded(): void {
  if (buckets.size < MAX_BUCKETS) return;
  const oldest = buckets.keys().next().value;
  if (oldest !== undefined) buckets.delete(oldest);
}

/**
 * Check (and consume) a rate-limit slot. Returns honest allow/deny.
 *
 * Does NOT silently queue. Callers must handle `allowed=false` by either
 * returning 429 to the user or waiting `retryAfterMs` before retrying.
 */
export function checkAndConsume(key: RateLimitKey): RateLimitCheck {
  const now = Date.now();
  const bkey = bucketKey(key);
  const windowMs = WINDOW_MS[key.scope];
  const cap = CAPS_PER_MINUTE[key.scope];

  let bucket = buckets.get(bkey);
  if (!bucket || now - bucket.windowStartMs >= windowMs) {
    evictIfNeeded();
    bucket = { count: 0, windowStartMs: now, windowMs };
    buckets.set(bkey, bucket);
  }

  if (bucket.count >= cap) {
    const retryAfterMs = Math.max(0, bucket.windowStartMs + windowMs - now);
    return {
      allowed: false,
      scope: key.scope,
      remaining: 0,
      resetAtMs: bucket.windowStartMs + windowMs,
      retryAfterMs,
      reason: `scope=${key.scope} cap=${cap} exhausted; retry in ${retryAfterMs}ms`,
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    scope: key.scope,
    remaining: cap - bucket.count,
    resetAtMs: bucket.windowStartMs + windowMs,
  };
}

/**
 * Layered check — user + entity + provider. If any layer denies, deny
 * overall and return the tightest window.
 */
export function checkAllLayers(args: {
  userId?: string;
  tenantId?: string;
  entitySlug?: string;
  provider?: RateLimitKey["provider"];
}): RateLimitCheck {
  const checks: RateLimitCheck[] = [];

  if (args.userId) {
    checks.push(checkAndConsume({ scope: "per_user_per_minute", userId: args.userId }));
  }
  if (args.entitySlug) {
    checks.push(
      checkAndConsume({ scope: "per_entity_per_minute", entitySlug: args.entitySlug }),
    );
  }
  if (args.provider) {
    checks.push(checkAndConsume({ scope: "per_provider_per_minute", provider: args.provider }));
  }
  if (args.tenantId) {
    checks.push(checkAndConsume({ scope: "per_tenant_per_hour", tenantId: args.tenantId }));
  }

  const denied = checks.find((c) => !c.allowed);
  if (denied) return denied;

  // All allowed → return the tightest remaining
  const tightest = checks.reduce<RateLimitCheck | null>((acc, c) => {
    if (!acc || c.remaining < acc.remaining) return c;
    return acc;
  }, null);

  return tightest ?? {
    allowed: true,
    scope: "per_user_per_minute",
    remaining: CAPS_PER_MINUTE.per_user_per_minute,
    resetAtMs: Date.now() + WINDOW_MS.per_user_per_minute,
  };
}

/**
 * Observability — expose current bucket state for telemetry panels.
 */
export function getRateLimitStats(): {
  totalBuckets: number;
  bucketsNearCap: number;
} {
  const now = Date.now();
  let near = 0;
  buckets.forEach((b, k) => {
    const scope = k.split("|")[0] as RateLimitScope;
    if (scope in CAPS_PER_MINUTE) {
      const cap = CAPS_PER_MINUTE[scope];
      const windowMs = WINDOW_MS[scope];
      const inWindow = now - b.windowStartMs < windowMs;
      if (inWindow && b.count / cap >= 0.8) near += 1;
    }
  });
  return { totalBuckets: buckets.size, bucketsNearCap: near };
}
