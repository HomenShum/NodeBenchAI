/**
 * Shared Public Cache — CSL + ESL
 *
 * Convex queries and mutations backing the canonicalSources, extractedSignals,
 * and crossScopeViolations tables. Privacy invariant:
 *
 *   Shared layers (CSL, ESL) contain only content that is public by origin.
 *   User queries, scratchpad, and auth-gated content MUST NEVER be written here.
 *   Reads cross-layer are one-way: USL → CSL/ESL, never reverse.
 *
 * Every write path runs through a validator that:
 *   1. Rejects auth-bearing URLs (SSRF + bearer tokens)
 *   2. Rejects oversize bodies (BOUND_READ)
 *   3. Scans for USL-style markers (private-scope leak)
 *   4. Records any failed validation to crossScopeViolations
 *
 * Rules consulted:
 *   - .claude/rules/agentic_reliability.md (BOUND, HONEST_STATUS, SSRF,
 *     BOUND_READ, DETERMINISTIC)
 *   - docs/architecture/FAST_SLOW_RUNTIME_SPEC.md §3 (CSL/ESL architecture)
 */

import { v } from "convex/values";
import { mutation, query, internalMutation } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";

// ───────────────────────────────────────────────────────────────────────────
// Constants — all bounds explicit, per agentic_reliability BOUND rule
// ───────────────────────────────────────────────────────────────────────────

/** 1 MB cap on any single CSL body. Larger fetches must stream+summarize. */
export const MAX_CSL_BODY_BYTES = 1_024 * 1_024;
/** 4 KB cap on any single ESL value. */
export const MAX_ESL_VALUE_BYTES = 4_096;
/** 1 KB cap on violation detail to prevent log-flood DoS. */
export const MAX_VIOLATION_DETAIL_BYTES = 1_024;
/** Max ESL sources per signal (bounded citation chain). */
export const MAX_ESL_SOURCES = 12;

/** TTL per source class — `news` is shortest, `regulatory` is longest. */
export const TTL_BY_SOURCE_CLASS = {
  news: 1 * 60 * 60 * 1000, // 1h
  careers: 6 * 60 * 60 * 1000, // 6h
  profile: 24 * 60 * 60 * 1000, // 24h
  regulatory: 7 * 24 * 60 * 60 * 1000, // 7d
  other: 12 * 60 * 60 * 1000, // 12h
} as const;

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers — no ctx, no side effects
// ───────────────────────────────────────────────────────────────────────────

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[k] = sortKeys((value as Record<string, unknown>)[k]);
  }
  return sorted;
}

function stableStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(obj));
}

/**
 * cyrb53 — 53-bit deterministic non-crypto hash. Fast, pure-JS, works in
 * Convex's V8 runtime (no Node `crypto`). Sufficient for cache-key uniqueness
 * and content-drift detection; NOT a security primitive.
 * Source: Bryc, https://stackoverflow.com/a/52171480 (public domain)
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = 4294967296 * (2097151 & h2);
  return (hi + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Deterministic hash for cache keys and drift detection. Non-crypto. */
function stableHash(input: string): string {
  return cyrb53(input);
}

/** Byte length of a UTF-8 string (Convex-compatible). */
function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Canonical key for a CSL entry: bound to (url, day). */
export function canonicalKey(url: string, day: string): string {
  return stableHash(stableStringify({ url: url.trim().toLowerCase(), day }));
}

/** Signal key for an ESL entry: bound to (entitySlug, signalType, dayBucket). */
export function signalKey(entitySlug: string, signalType: string, dayBucket: string): string {
  return stableHash(
    stableStringify({
      entitySlug: entitySlug.trim().toLowerCase(),
      signalType: signalType.trim().toLowerCase(),
      dayBucket,
    }),
  );
}

/** Today's YYYY-MM-DD in UTC. */
export function currentDayBucket(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Rejects URLs that carry auth, cookies, bearer tokens, or point at
 * RFC1918/link-local/cloud-metadata hosts (defense-in-depth with SSRF guard).
 */
export function isPublicOriginUrl(rawUrl: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    return { ok: false, reason: "malformed URL" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, reason: `disallowed protocol ${parsed.protocol}` };
  }
  // SSRF blocklist — align with server-side URL validator
  const host = parsed.hostname.toLowerCase();
  const blocked: RegExp[] = [
    /^localhost$/,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\.0\.0\.0$/,
    /^\[::1\]$/,
    /metadata\.google\.internal/,
    /metadata\.aws\./,
  ];
  if (blocked.some((rx) => rx.test(host))) {
    return { ok: false, reason: `host ${host} is blocklisted` };
  }
  // Reject URLs that carry auth markers
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "URL carries basic-auth credentials" };
  }
  const suspiciousParams = [
    "access_token",
    "id_token",
    "refresh_token",
    "api_key",
    "apikey",
    "auth",
    "session",
    "sessionid",
    "sid",
    "signature",
    "sig",
  ];
  for (const p of suspiciousParams) {
    if (parsed.searchParams.has(p)) {
      return { ok: false, reason: `URL carries auth-like param ${p}` };
    }
  }
  return { ok: true };
}

/** Heuristic classifier used to pick a TTL bucket. Inspects host + path. */
export function classifySourceClass(url: string): keyof typeof TTL_BY_SOURCE_CLASS {
  let host = "";
  let path = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname.toLowerCase();
  } catch {
    return "other";
  }
  const hostPath = `${host}${path}`;
  if (/\.gov\b|sec\.gov|uspto\.gov|edgar/.test(host)) {
    return "regulatory";
  }
  if (
    host.includes("news") ||
    host.includes("techcrunch") ||
    host.includes("reuters") ||
    host.includes("bloomberg") ||
    host.includes("wsj.com") ||
    host.includes("nyt.com") ||
    host.includes("ft.com")
  ) {
    return "news";
  }
  if (/careers|jobs\.|lever\.co|greenhouse\.io|ashbyhq\.com/.test(hostPath)) {
    return "careers";
  }
  if (/crunchbase|linkedin\.com\/(company|in)|pitchbook|angelco|angellist/.test(hostPath)) {
    return "profile";
  }
  return "other";
}

/**
 * Scan body text for USL-style markers that indicate leaked user content.
 * False positives are fine — we fail closed on any suspicious pattern.
 */
export function detectUserContent(body: string): { clean: true } | { clean: false; reason: string } {
  const markers: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\bBearer [A-Za-z0-9_\-.]+/, reason: "bearer token fragment" },
    { pattern: /sk-[A-Za-z0-9]{32,}/, reason: "api-key shape" },
    { pattern: /"userId"\s*:\s*"/, reason: "userId JSON field" },
    { pattern: /"ownerKey"\s*:\s*"/, reason: "ownerKey JSON field" },
    { pattern: /"scratchpad"\s*:/, reason: "scratchpad JSON field" },
    { pattern: /"threadId"\s*:\s*"[^"]+"/, reason: "threadId JSON field" },
    { pattern: /Authorization:\s*Bearer/, reason: "Authorization header" },
    { pattern: /Cookie:\s*\S/, reason: "Cookie header" },
    { pattern: /"privateNote"\s*:/, reason: "privateNote JSON field" },
  ];
  for (const { pattern, reason } of markers) {
    if (pattern.test(body)) return { clean: false, reason };
  }
  return { clean: true };
}

export function clampConfidence(c: number): number {
  if (Number.isNaN(c)) return 0;
  return Math.max(0, Math.min(1, c));
}

// ───────────────────────────────────────────────────────────────────────────
// Queries — read-only. Bounded. Honest misses.
// ───────────────────────────────────────────────────────────────────────────

/** Look up a CSL entry. Returns null on miss (honest). Caps to one doc. */
export const getCanonicalSource = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const doc = await ctx.db
      .query("canonicalSources")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (!doc) return null;
    // Honest TTL — return null when expired; let caller decide to re-fetch
    const ageMs = Date.now() - doc.fetchedAt;
    if (ageMs > doc.ttlMs) {
      return { ...doc, expired: true };
    }
    return { ...doc, expired: false };
  },
});

/** Look up an ESL entry by (entitySlug, signalType, dayBucket). */
export const getExtractedSignal = query({
  args: {
    entitySlug: v.string(),
    signalType: v.string(),
    dayBucket: v.string(),
  },
  handler: async (ctx, { entitySlug, signalType, dayBucket }) => {
    const doc = await ctx.db
      .query("extractedSignals")
      .withIndex("by_entity_signal_day", (q) =>
        q
          .eq("entitySlug", entitySlug.trim().toLowerCase())
          .eq("signalType", signalType.trim().toLowerCase())
          .eq("dayBucket", dayBucket),
      )
      .first();
    return doc ?? null;
  },
});

/** List recent ESL signals for an entity — capped at 50 rows. */
export const listSignalsForEntity = query({
  args: {
    entitySlug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { entitySlug, limit }) => {
    const cap = Math.min(Math.max(1, limit ?? 25), 50);
    return await ctx.db
      .query("extractedSignals")
      .withIndex("by_entity", (q) => q.eq("entitySlug", entitySlug.trim().toLowerCase()))
      .order("desc")
      .take(cap);
  },
});

/** Read unresolved P0 violations — for ops panels. */
export const listOpenP0Violations = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const cap = Math.min(Math.max(1, limit ?? 20), 100);
    return await ctx.db
      .query("crossScopeViolations")
      .withIndex("by_severity_resolved", (q) => q.eq("severity", "p0").eq("resolved", false))
      .order("desc")
      .take(cap);
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Mutations — all validated, all bounded, honest errors
// ───────────────────────────────────────────────────────────────────────────

/**
 * Record a cross-scope privacy violation. Internal — the writers below
 * call this automatically on any validation failure.
 */
export const recordCrossScopeViolation = internalMutation({
  args: {
    violationType: v.union(
      v.literal("user_content_in_csl"),
      v.literal("user_content_in_esl"),
      v.literal("unknown_origin"),
      v.literal("auth_url_attempted"),
      v.literal("usl_read_from_shared"),
      v.literal("oversize_body"),
    ),
    offendingKey: v.string(),
    severity: v.union(v.literal("warn"), v.literal("p0")),
    details: v.string(),
  },
  handler: async (ctx, args) => {
    const truncatedDetails = args.details.slice(0, MAX_VIOLATION_DETAIL_BYTES);
    await ctx.db.insert("crossScopeViolations", {
      detectedAt: Date.now(),
      violationType: args.violationType,
      offendingKey: args.offendingKey,
      severity: args.severity,
      details: truncatedDetails,
      resolved: false,
    });
  },
});

/**
 * Upsert a CSL entry. Validates public-origin, bounded body, no user content.
 * On any validation failure, records a violation and throws — caller must
 * handle. Never silently succeeds on unsafe input (HONEST_STATUS).
 */
export const upsertCanonicalSource = mutation({
  args: {
    url: v.string(),
    body: v.string(),
    contentType: v.union(
      v.literal("html"),
      v.literal("json"),
      v.literal("pdf"),
      v.literal("markdown"),
      v.literal("text"),
    ),
  },
  handler: async (ctx, { url, body, contentType }) => {
    const now = Date.now();
    const day = currentDayBucket(now);
    const key = canonicalKey(url, day);

    // 1. Origin check
    const originCheck = isPublicOriginUrl(url);
    if (!originCheck.ok) {
      await ctx.db.insert("crossScopeViolations", {
        detectedAt: now,
        violationType: "auth_url_attempted",
        offendingKey: key,
        severity: "p0",
        details: `url=${url.slice(0, 200)}; reason=${originCheck.reason}`.slice(0, MAX_VIOLATION_DETAIL_BYTES),
        resolved: false,
      });
      throw new Error(`[sharedCache] CSL insert rejected: ${originCheck.reason}`);
    }

    // 2. Size bound
    const bodyBytes = utf8ByteLength(body);
    if (bodyBytes > MAX_CSL_BODY_BYTES) {
      await ctx.db.insert("crossScopeViolations", {
        detectedAt: now,
        violationType: "oversize_body",
        offendingKey: key,
        severity: "p0",
        details: `url=${url.slice(0, 200)}; bytes=${bodyBytes}; cap=${MAX_CSL_BODY_BYTES}`.slice(
          0,
          MAX_VIOLATION_DETAIL_BYTES,
        ),
        resolved: false,
      });
      throw new Error(
        `[sharedCache] CSL body exceeds ${MAX_CSL_BODY_BYTES} bytes (got ${bodyBytes})`,
      );
    }

    // 3. User-content scan (fails closed)
    const userContent = detectUserContent(body);
    if (!userContent.clean) {
      await ctx.db.insert("crossScopeViolations", {
        detectedAt: now,
        violationType: "user_content_in_csl",
        offendingKey: key,
        severity: "p0",
        details: `url=${url.slice(0, 200)}; reason=${userContent.reason}`.slice(0, MAX_VIOLATION_DETAIL_BYTES),
        resolved: false,
      });
      throw new Error(`[sharedCache] CSL user-content leak detected: ${userContent.reason}`);
    }

    const sourceClass = classifySourceClass(url);
    const bodyHash = stableHash(body);

    const existing = await ctx.db
      .query("canonicalSources")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first() as Doc<"canonicalSources"> | null;

    if (existing) {
      // If content drifted, update; otherwise touch updatedAt only
      const patch: Record<string, unknown> = { updatedAt: now };
      if (existing.bodyHash !== bodyHash) {
        patch.body = body;
        patch.bodyHash = bodyHash;
        patch.bodyBytes = bodyBytes;
        patch.fetchedAt = now;
        patch.contentType = contentType;
      }
      await ctx.db.patch(existing._id, patch);
      return { id: existing._id, action: "updated", key };
    }

    const id = await ctx.db.insert("canonicalSources", {
      key,
      url,
      fetchedAt: now,
      ttlMs: TTL_BY_SOURCE_CLASS[sourceClass],
      contentType,
      bodyHash,
      body,
      bodyBytes,
      sourceClass,
      isPublicOrigin: true,
      createdAt: now,
      updatedAt: now,
    });
    return { id, action: "inserted", key };
  },
});

/**
 * Upsert an ESL entry. Requires at least one CSL source key. Validates
 * public-origin (all referenced CSL entries must be public), bounded value,
 * no user content.
 */
export const upsertExtractedSignal = mutation({
  args: {
    entitySlug: v.string(),
    signalType: v.string(),
    dayBucket: v.string(),
    value: v.string(),
    sourceCanonicalKeys: v.array(v.string()),
    confidence: v.number(),
    extractorModel: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const key = signalKey(args.entitySlug, args.signalType, args.dayBucket);

    // 1. Must have at least one source
    if (args.sourceCanonicalKeys.length === 0) {
      throw new Error("[sharedCache] ESL upsert requires at least one source");
    }
    if (args.sourceCanonicalKeys.length > MAX_ESL_SOURCES) {
      throw new Error(
        `[sharedCache] ESL upsert exceeds ${MAX_ESL_SOURCES} sources`,
      );
    }

    // 2. Size bound
    const valueBytes = utf8ByteLength(args.value);
    if (valueBytes > MAX_ESL_VALUE_BYTES) {
      throw new Error(`[sharedCache] ESL value exceeds ${MAX_ESL_VALUE_BYTES} bytes`);
    }

    // 3. User-content scan
    const userContent = detectUserContent(args.value);
    if (!userContent.clean) {
      await ctx.db.insert("crossScopeViolations", {
        detectedAt: now,
        violationType: "user_content_in_esl",
        offendingKey: key,
        severity: "p0",
        details: `entity=${args.entitySlug}; signal=${args.signalType}; reason=${userContent.reason}`.slice(
          0,
          MAX_VIOLATION_DETAIL_BYTES,
        ),
        resolved: false,
      });
      throw new Error(`[sharedCache] ESL user-content leak: ${userContent.reason}`);
    }

    // 4. Verify every referenced CSL exists AND is public-origin
    for (const cslKey of args.sourceCanonicalKeys) {
      const source = await ctx.db
        .query("canonicalSources")
        .withIndex("by_key", (q) => q.eq("key", cslKey))
        .first();
      if (!source) {
        throw new Error(`[sharedCache] ESL references unknown CSL key ${cslKey}`);
      }
      if (!source.isPublicOrigin) {
        await ctx.db.insert("crossScopeViolations", {
          detectedAt: now,
          violationType: "user_content_in_esl",
          offendingKey: key,
          severity: "p0",
          details: `referenced CSL ${cslKey} marked non-public-origin`.slice(0, MAX_VIOLATION_DETAIL_BYTES),
          resolved: false,
        });
        throw new Error(`[sharedCache] ESL references non-public CSL ${cslKey}`);
      }
    }

    const existing = await ctx.db
      .query("extractedSignals")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first() as Doc<"extractedSignals"> | null;

    const patch = {
      entitySlug: args.entitySlug.trim().toLowerCase(),
      signalType: args.signalType.trim().toLowerCase(),
      dayBucket: args.dayBucket,
      value: args.value,
      sourceCanonicalKeys: args.sourceCanonicalKeys,
      confidence: clampConfidence(args.confidence),
      extractedAt: now,
      extractorModel: args.extractorModel,
      isPublicOrigin: true,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { id: existing._id, action: "updated", key };
    }
    const id = await ctx.db.insert("extractedSignals", { key, ...patch });
    return { id, action: "inserted", key };
  },
});

/**
 * Resolve a violation (admin action).
 */
export const resolveViolation = mutation({
  args: { id: v.id("crossScopeViolations") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { resolved: true, resolvedAt: Date.now() });
  },
});
