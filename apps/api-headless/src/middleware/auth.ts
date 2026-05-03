import type { Request, Response, NextFunction } from "express";

// ── Types ──────────────────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      clientOrg?: string;
      clientId?: string;
      requestId?: string;
    }
  }
}

interface ApiKeyRecord {
  key: string;
  clientId: string;
  clientOrg: string;
  scopes: string[];
  rateLimit: number; // requests per minute
}

// ── In-memory key store (production: use Clerk / DB) ───────────────────────

const API_KEYS: Map<string, ApiKeyRecord> = new Map();

// Seed a dev key
if (process.env.NODE_ENV !== "production") {
  API_KEYS.set("dev-api-key-nodebench", {
    key: "dev-api-key-nodebench",
    clientId: "dev-client-001",
    clientOrg: "nodebench-dev",
    scopes: [
      "specs:read",
      "specs:write",
      "runs:read",
      "runs:write",
      "evidence:read",
      "evidence:write",
      "replay:read",
      "replay:write",
      "public_research:read",
      "public_research:write",
    ],
    rateLimit: 1000,
  });
}

// Allow runtime key registration via env
const envKeys = process.env.API_KEYS;
if (envKeys) {
  try {
    const parsed = JSON.parse(envKeys) as ApiKeyRecord[];
    for (const record of parsed) {
      API_KEYS.set(record.key, record);
    }
  } catch {
    console.warn("[auth] Failed to parse API_KEYS env var");
  }
}

// ── Token Bucket Rate Limiter ──────────────────────────────────────────────

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number; // tokens per second
}

const MAX_BUCKETS = 10_000;
const BUCKET_STALE_MS = 10 * 60 * 1000; // 10 minutes
const buckets: Map<string, TokenBucket> = new Map();

function evictStaleBuckets(now: number) {
  if (buckets.size <= MAX_BUCKETS) return;
  // Map iterates in insertion order — evict oldest stale entries
  for (const [key, bucket] of buckets) {
    if (buckets.size <= MAX_BUCKETS * 0.8) break;
    if (now - bucket.lastRefill > BUCKET_STALE_MS) {
      buckets.delete(key);
    }
  }
  // If still over limit, force-evict oldest entries
  if (buckets.size > MAX_BUCKETS) {
    const toRemove = buckets.size - MAX_BUCKETS;
    let removed = 0;
    for (const key of buckets.keys()) {
      if (removed >= toRemove) break;
      buckets.delete(key);
      removed++;
    }
  }
}

function checkRateLimit(clientId: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const maxTokens = maxPerMinute;
  const refillRate = maxPerMinute / 60; // per second

  let bucket = buckets.get(clientId);
  if (!bucket) {
    evictStaleBuckets(now);
    bucket = { tokens: maxTokens, lastRefill: now, maxTokens, refillRate };
    buckets.set(clientId, bucket);
  }

  // Refill tokens
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    return false;
  }

  bucket.tokens -= 1;
  return true;
}

// ── Middleware ──────────────────────────────────────────────────────────────

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth in dev mode
  if (process.env.NODE_ENV !== "production") {
    req.clientId = "dev-client-001";
    req.clientOrg = "nodebench-dev";
    next();
    return;
  }

  // Extract API key
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers["x-api-key"] as string | undefined;

  let apiKey: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    apiKey = authHeader.slice(7);
  } else if (apiKeyHeader) {
    apiKey = apiKeyHeader;
  }

  if (!apiKey) {
    res.status(401).json({
      error: "unauthorized",
      message: "Missing API key. Provide via Authorization: Bearer <key> or X-API-Key header.",
    });
    return;
  }

  // Validate key
  const record = API_KEYS.get(apiKey);
  if (!record) {
    res.status(401).json({
      error: "unauthorized",
      message: "Invalid API key.",
    });
    return;
  }

  // Rate limit
  if (!checkRateLimit(record.clientId, record.rateLimit)) {
    res.status(429).json({
      error: "rate_limited",
      message: "Rate limit exceeded. Try again later.",
      retryAfter: 60,
    });
    return;
  }

  // Attach client info
  req.clientId = record.clientId;
  req.clientOrg = record.clientOrg;

  next();
}

// ── Scope Check Helper ─────────────────────────────────────────────────────

export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Dev mode: allow all
    if (process.env.NODE_ENV !== "production") {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
    const apiKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : apiKeyHeader;

    if (!apiKey) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const record = API_KEYS.get(apiKey);
    if (!record || !record.scopes.includes(scope)) {
      res.status(403).json({
        error: "forbidden",
        message: `Missing required scope: ${scope}`,
      });
      return;
    }

    next();
  };
}
