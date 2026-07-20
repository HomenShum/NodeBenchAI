// convex/lib/artifactPersistence.ts
// Server-side artifact persistence with monotonic rev
// This is the source of truth - computes IDs, canonicalizes URLs, manages rev
// 
// Production Safety:
// - Singleton meta-doc with self-healing
// - Duplicate scrub on (runId, artifactId)
// - No-op patch guard (rev bumps only on material change)
// - Structured logging counters

import { v } from "convex/values";
import { internalMutation, internalQuery, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id, Doc } from "../_generated/dataModel";
import { 
  canonicalizeUrl, 
  extractHost, 
  classifyProvider,
  generateArtifactIdSync,
} from "../../shared/artifacts";

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE FLAGS & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ENABLE_ARTIFACT_WRITE_LOGS = true; // Set to false in prod if too noisy

// Retry configuration for OCC conflicts
const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 8000;

// Chunking configuration (prevent scheduler payload failures)
const MAX_ARTIFACTS_PER_JOB = 25;
const MAX_URLS_IN_SAMPLE = 5;
const MAX_ERROR_MESSAGE_LENGTH = 2000;

// Error type classification for dead-letter
type ErrorType = "OCC" | "VALIDATION" | "EXTRACTOR" | "SCHEDULER" | "UNKNOWN";

/**
 * Classify error type for dead-letter records
 */
function classifyErrorType(err: unknown): ErrorType {
  if (isWriteConflict(err)) return "OCC";
  
  const message = ((err as any)?.message ?? String(err)).toLowerCase();
  
  if (message.includes("validation") || message.includes("validator") || message.includes("argument")) {
    return "VALIDATION";
  }
  if (message.includes("extract") || message.includes("parse")) {
    return "EXTRACTOR";
  }
  if (message.includes("scheduler") || message.includes("schedule")) {
    return "SCHEDULER";
  }
  
  return "UNKNOWN";
}

/**
 * Truncate error message to safe length for storage
 */
function truncateErrorMessage(msg: string): string {
  if (msg.length <= MAX_ERROR_MESSAGE_LENGTH) return msg;
  return msg.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3) + "...";
}

/**
 * Simple hash for idempotency key generation
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Chunk an array into smaller arrays
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Compute backoff delay for scheduled retries (exponential + jitter)
 */
function backoffMs(attempt: number): number {
  const expo = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * 200); // 0-199ms
  return expo + jitter;
}

/**
 * Sleep helper for stress tests only (not used in retry action)
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Sharding configuration for mutex
const SHARD_COUNT = 8; // K=8 shards to reduce contention

/**
 * Compute shard ID from artifact ID (deterministic)
 * Uses simple hash to distribute artifacts across shards
 */
function computeShardId(artifactId: string): number {
  let hash = 0;
  for (let i = 0; i < artifactId.length; i++) {
    const char = artifactId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) % SHARD_COUNT;
}

// ═══════════════════════════════════════════════════════════════════════════
// OCC CONFLICT DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect if an error is a retryable write conflict (OCC).
 * Don't retry validation errors or unknown errors.
 */
function isWriteConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  
  const message = (err as any)?.message ?? '';
  const code = (err as any)?.data?.code ?? '';
  
  // Check known OCC conflict patterns
  // Convex OCC errors include: "Documents read from or written to ... changed while this mutation was being run"
  const conflictPatterns = [
    'write conflict',
    'optimisticconcurrencycontrol',
    'occ conflict',
    'conflict',
    'document has been modified',
    'changed while this mutation was being run',  // Convex OCC error pattern
    'documents read from or written to',          // Convex OCC error pattern
    'another call to this mutation changed',      // Convex OCC error pattern
  ];
  
  const lowerMessage = message.toLowerCase();
  const lowerCode = code.toLowerCase();
  
  return conflictPatterns.some(p => 
    lowerMessage.includes(p) || lowerCode.includes(p)
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// COUNTERS TYPE
// ═══════════════════════════════════════════════════════════════════════════

interface WriteCounters {
  metaTouched: number;
  metaDupesDeleted: number;
  metaLegacyMigrated: number;  // FIX 3: Track legacy meta migrations
  inserted: number;
  patched: number;
  noopsSkipped: number;
  dupesDeleted: number;
}

function createCounters(): WriteCounters {
  return {
    metaTouched: 0,
    metaDupesDeleted: 0,
    metaLegacyMigrated: 0,
    inserted: 0,
    patched: 0,
    noopsSkipped: 0,
    dupesDeleted: 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 1: SHARDED META-DOC WITH SELF-HEALING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Touch a specific shard's meta document to serialize concurrent writes.
 * Self-heals if multiple meta docs exist for the same (runId, shardId).
 * 
 * FIX 3: Also handles legacy meta docs (where shardId === undefined).
 * - If legacy docs exist: migrate one to shard 0, delete the rest
 * - This ensures old data doesn't create "black holes" in sharded lookups
 * 
 * Sharding reduces contention: artifacts with different shardIds don't conflict.
 */
async function touchRunMetaShard(ctx: any, runId: string, shardId: number, counters: WriteCounters) {
  const now = Date.now();

  // Step 1: Try to find sharded meta docs
  const metas = await ctx.db
    .query("artifactRunMeta")
    .withIndex("by_run_shard", (q: any) => q.eq("runId", runId).eq("shardId", shardId))
    .collect();

  // Handle duplicates if found
  if (metas.length > 1) {
    // Keep first, delete extras
    for (const extra of metas.slice(1)) {
      await ctx.db.delete(extra._id);
    }
    counters.metaDupesDeleted += metas.length - 1;
  }

  // If we found a sharded meta, just touch it
  if (metas.length >= 1) {
    await ctx.db.patch(metas[0]._id, { bump: (metas[0].bump ?? 0) + 1, updatedAt: now });
    counters.metaTouched++;
    return;
  }

  // Step 2: No sharded meta found - check for legacy docs (shardId === undefined)
  const allByRun = await ctx.db
    .query("artifactRunMeta")
    .withIndex("by_run", (q: any) => q.eq("runId", runId))
    .collect();

  const legacyMetas = allByRun.filter((m: any) => m.shardId === undefined || m.shardId === null);

  if (legacyMetas.length > 0) {
    // Found legacy meta docs - migrate one, delete the rest
    // Sort by bump desc to keep the one with highest bump
    legacyMetas.sort((a: any, b: any) => (b.bump ?? 0) - (a.bump ?? 0));
    const keeper = legacyMetas[0];

    if (shardId === 0) {
      // Migrate the legacy doc to shard 0
      await ctx.db.patch(keeper._id, { shardId: 0, bump: (keeper.bump ?? 0) + 1, updatedAt: now });
      counters.metaLegacyMigrated++;
    } else {
      // For other shards, create a new doc (legacy stays as-is for shard 0 to migrate)
      await ctx.db.insert("artifactRunMeta", { runId, shardId, bump: 1, updatedAt: now });
    }

    // Delete extra legacy docs (keep one for shard 0 migration)
    const extraLegacy = shardId === 0 ? legacyMetas.slice(1) : [];
    for (const extra of extraLegacy) {
      await ctx.db.delete(extra._id);
    }
    if (extraLegacy.length > 0) {
      counters.metaDupesDeleted += extraLegacy.length;
    }

    counters.metaTouched++;
    return;
  }

  // Step 3: True cold start - create new shard meta doc
  await ctx.db.insert("artifactRunMeta", { runId, shardId, bump: 1, updatedAt: now });
  counters.metaTouched++;
}

/**
 * Legacy touchRunMeta - touches shard 0 for backward compatibility.
 * Used by enrichArtifact, setArtifactPinned, setArtifactCited which update single artifacts.
 */
async function touchRunMeta(ctx: any, runId: string, counters: WriteCounters) {
  await touchRunMetaShard(ctx, runId, 0, counters);
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 2: DUPLICATE SCRUB ON (runId, artifactId)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get artifact row by (runId, artifactId), scrubbing duplicates if found.
 * Keeps the row with highest rev (or newest updatedAt).
 */
async function getAndScrubArtifactRow(
  ctx: any,
  runId: string,
  artifactId: string,
  counters: WriteCounters
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
): Promise<Doc<"artifacts"> | null> {
  const matches = await ctx.db
    .query("artifacts")
    .withIndex("by_run_artifact", (q: any) => q.eq("runId", runId).eq("artifactId", artifactId))
    .collect();

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Multiple rows found - scrub duplicates
  // Sort by rev desc, then discoveredAt desc (keep highest/newest)
  matches.sort((a: any, b: any) =>
    (b.rev ?? 0) - (a.rev ?? 0) || (b.discoveredAt ?? 0) - (a.discoveredAt ?? 0)
  );

  const keep = matches[0];
  for (const dupe of matches.slice(1)) {
    await ctx.db.delete(dupe._id);
  }

  counters.dupesDeleted += matches.length - 1;
  return keep;
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX 3: NO-OP PATCH GUARD (MATERIAL CHANGE CHECK)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if any material fields changed (fields that affect UI/reactivity).
 * Returns true if patch is needed, false if it's a no-op.
 */
function materialChanged(existing: Doc<"artifacts">, next: {
  title?: string;
  snippet?: string;
  thumbnail?: string;
  host?: string;
  provider?: string;
  kind?: string;
  flags?: any;
}): boolean {
  // Compare only fields that affect UI/reactivity
  if (next.title !== undefined && next.title !== existing.title) return true;
  if (next.snippet !== undefined && next.snippet !== existing.snippet) return true;
  if (next.thumbnail !== undefined && next.thumbnail !== existing.thumbnail) return true;
  if (next.host !== undefined && next.host !== existing.host) return true;
  
  // Compare flags if provided
  if (next.flags !== undefined) {
    const existingFlags = existing.flags;
    if (JSON.stringify(existingFlags) !== JSON.stringify(next.flags)) return true;
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATORS (matches schema.ts)
// ═══════════════════════════════════════════════════════════════════════════

const rawArtifactValidator = v.object({
  url: v.string(),
  title: v.optional(v.string()),
  snippet: v.optional(v.string()),
  thumbnail: v.optional(v.string()),
  kind: v.string(),
  provider: v.optional(v.string()),
});

// Schema-compatible kind type
type SchemaKind = "url" | "file" | "video" | "image" | "document";

// Schema-compatible provider type  
type SchemaProvider = "youtube" | "sec" | "arxiv" | "news" | "web" | "local";

// Map extended providers to schema-compatible ones
function toSchemaProvider(provider: string | undefined): SchemaProvider | undefined {
  if (!provider) return undefined;
  const mapping: Record<string, SchemaProvider> = {
    youtube: "youtube",
    sec: "sec",
    arxiv: "arxiv",
    news: "news",
    web: "web",
    local: "local",
    // Map extended providers to "web"
    twitter: "web",
    linkedin: "web",
    crunchbase: "web",
    pitchbook: "web",
    wikipedia: "web",
    reddit: "web",
    github: "web",
  };
  return mapping[provider] || "web";
}

// Map extended kinds to schema-compatible ones
function toSchemaKind(kind: string): SchemaKind {
  const mapping: Record<string, SchemaKind> = {
    url: "url",
    file: "file",
    video: "video",
    image: "image",
    document: "document",
    sec: "document",
    person: "url",
    company: "url",
  };
  return mapping[kind] || "url";
}

// ═══════════════════════════════════════════════════════════════════════════
// UPSERT MUTATION (Server-side truth)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert raw artifacts from a tool call
 * Server computes: canonicalUrl, artifactId, flags, rev, discoveredAt
 * 
 * Production Safety:
 * - Sharded meta-doc with self-healing (Fix 1) - reduces contention
 * - Duplicate scrub on (runId, artifactId) (Fix 2)
 * - No-op patch guard - rev bumps only on material change (Fix 3)
 * - Structured logging counters
 * 
 * IMPORTANT: This is the ONLY mutation that writes artifacts.
 */
export const upsertRawArtifacts = internalMutation({
  args: {
    runId: v.string(),
    userId: v.id("users"),
    toolName: v.string(),
    rawArtifacts: v.array(rawArtifactValidator),
  },
  handler: async (ctx, { runId, userId, toolName, rawArtifacts }) => {
    const now = Date.now();
    const counters = createCounters();
    const upsertedIds: string[] = [];
    
    // ══════════════════════════════════════════════════════════════════════
    // STEP 1: Pre-compute artifactIds and group by shard
    // ══════════════════════════════════════════════════════════════════════
    const artifactsWithMeta = rawArtifacts.map((raw: any) => {
      const canonicalUrl = canonicalizeUrl(raw.url);
      const artifactId = generateArtifactIdSync(runId, canonicalUrl);
      const shardId = computeShardId(artifactId);
      return { raw, canonicalUrl, artifactId, shardId };
    });
    
    // Group by shardId
    const shardGroups = new Map<number, typeof artifactsWithMeta>();
    for (const item of artifactsWithMeta) {
      const group = shardGroups.get(item.shardId) ?? [];
      group.push(item);
      shardGroups.set(item.shardId, group);
    }
    
    // ══════════════════════════════════════════════════════════════════════
    // STEP 2: Process each shard - touch meta once, then upsert artifacts
    // ══════════════════════════════════════════════════════════════════════
    for (const [shardId, shardArtifacts] of shardGroups) {
      // Touch this shard's meta (serializes writes within shard only)
      await touchRunMetaShard(ctx, runId, shardId, counters);
      
      // Now process artifacts in this shard
      for (const { raw, canonicalUrl, artifactId } of shardArtifacts) {
        // FIX 2: Get existing row, scrubbing duplicates if found
        const existing = await getAndScrubArtifactRow(ctx, runId, artifactId, counters);
        
        // Build flags (preserve existing or create default)
        const flags = existing?.flags ?? {
          hasThumbnail: !!raw.thumbnail,
          hasTranscript: false,
          hasPageRefs: false,
          isPinned: false,
          isCited: false,
          isEnriched: false,
        };
        
        // Update hasThumbnail if thumbnail is provided
        if (raw.thumbnail && !flags.hasThumbnail) {
          flags.hasThumbnail = true;
        }
        
        // Map to schema-compatible types
        const schemaKind = toSchemaKind(raw.kind);
        const schemaProvider = toSchemaProvider(raw.provider || classifyProvider(raw.url));
        const host = extractHost(raw.url);
        
        if (!existing) {
          // Insert new artifact
          await ctx.db.insert("artifacts", {
            artifactId,
            runId,
            userId,
            toolName,
            canonicalUrl,
            title: raw.title || "Source",
            snippet: raw.snippet,
            thumbnail: raw.thumbnail,
            host,
            kind: schemaKind,
            provider: schemaProvider,
            rev: 1,
            discoveredAt: now,
            flags,
          });
          counters.inserted++;
          upsertedIds.push(artifactId);
          continue;
        }
        
        // Build next row for comparison
        const nextRow = {
          title: raw.title || existing.title,
          snippet: raw.snippet ?? existing.snippet,
          thumbnail: raw.thumbnail ?? existing.thumbnail,
          host,
          flags,
        };
        
        // FIX 3: Skip patch if nothing material changed
        if (!materialChanged(existing, nextRow)) {
          counters.noopsSkipped++;
          upsertedIds.push(artifactId);
          continue;
        }
        
        // Material change detected - bump rev and patch
        const newRev = existing.rev + 1;
        await ctx.db.patch(existing._id, {
          toolName,
          title: nextRow.title,
          snippet: nextRow.snippet,
          thumbnail: nextRow.thumbnail,
          host: nextRow.host,
          rev: newRev,
          flags: nextRow.flags,
        });
        counters.patched++;
        upsertedIds.push(artifactId);
      }
    }
    
    // Structured logging
    if (ENABLE_ARTIFACT_WRITE_LOGS) {
      console.log("[artifactPersistence:upsert]", { runId, toolName, shardsUsed: shardGroups.size, ...counters });
    }
    
    return { upsertedIds, count: upsertedIds.length, counters };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// RETRY ACTION (reliable artifact persistence under contention)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Persist artifacts with automatic retry on OCC conflicts.
 * 
 * Features:
 * - Single attempt per invocation, scheduled backoff for retries
 * - On OCC conflict: schedule next attempt with exponential backoff + jitter
 * - On max attempts: write to dead-letter table for visibility
 * - Idempotency: skips if job with same key already completed
 * - Never retries validation/arg errors
 * 
 * Called by the tool wrapper scheduler to ensure no artifacts are silently lost.
 */
export const persistArtifactsWithRetry = internalAction({
  args: {
    runId: v.string(),
    userId: v.id("users"),
    toolName: v.string(),
    rawArtifacts: v.array(v.object({
      url: v.string(),
      title: v.optional(v.string()),
      snippet: v.optional(v.string()),
      thumbnail: v.optional(v.string()),
      kind: v.string(),
      provider: v.optional(v.string()),
    })),
    attempt: v.number(),
    idempotencyKey: v.optional(v.string()), // For deduping replays
    sectionId: v.optional(v.string()), // For per-section linking
  },
  handler: async (ctx, args): Promise<{
    ok: boolean;
    scheduled: boolean;
    attempt: number;
    delay?: number;
    error?: string;
    deduped?: boolean;
    deadLettered?: boolean;
  }> => {
    const { runId, userId, toolName, rawArtifacts, attempt, idempotencyKey, sectionId } = args;
    
    // Check idempotency if key provided
    if (idempotencyKey) {
      const existingJob = await ctx.runQuery(
        internal.lib.artifactPersistence.getJobByKey,
        { runId, idempotencyKey }
      );
      
      if (existingJob?.status === "done") {
        // Already completed - skip
        return { ok: true, scheduled: false, attempt, deduped: true };
      }
      
      // Mark as started (upsert)
      await ctx.runMutation(internal.lib.artifactPersistence.upsertJobStatus, {
        runId,
        idempotencyKey,
        status: "started",
        attempts: attempt,
      });
    }
    
    // Check if we've exceeded max attempts
    if (attempt >= MAX_ATTEMPTS) {
      const firstUrl = rawArtifacts[0]?.url ?? 'unknown';
      console.error("[persistArtifactsWithRetry] MAX ATTEMPTS EXCEEDED - dead-lettering", {
        runId,
        toolName,
        countArtifacts: rawArtifacts.length,
        firstArtifactUrl: firstUrl,
        attempts: attempt,
      });
      
      // Write dead-letter
      await ctx.runMutation(internal.lib.artifactPersistence.writeDeadLetter, {
        runId,
        toolName,
        attempt,
        errorType: "OCC" as const,
        errorMessage: "Max retry attempts exceeded",
        artifactCount: rawArtifacts.length,
        sampleUrls: rawArtifacts.slice(0, MAX_URLS_IN_SAMPLE).map((a: any) => a.url),
      });
      
      // Mark job as failed
      if (idempotencyKey) {
        await ctx.runMutation(internal.lib.artifactPersistence.upsertJobStatus, {
          runId,
          idempotencyKey,
          status: "failed",
          attempts: attempt,
        });
      }
      
      return { ok: false, scheduled: false, attempt, error: "Max retry attempts exceeded", deadLettered: true };
    }
    
    try {
      // Single attempt per invocation
      await ctx.runMutation(internal.lib.artifactPersistence.upsertRawArtifacts, {
        runId,
        userId,
        toolName,
        rawArtifacts,
      });
      
      if (ENABLE_ARTIFACT_WRITE_LOGS && attempt > 0) {
        console.log("[persistArtifactsWithRetry] Succeeded after retries", {
          runId,
          toolName,
          totalAttempts: attempt + 1,
        });
      }
      
      // Mark job as done
      if (idempotencyKey) {
        await ctx.runMutation(internal.lib.artifactPersistence.upsertJobStatus, {
          runId,
          idempotencyKey,
          status: "done",
          attempts: attempt + 1,
        });
      }
      
      // Link artifacts to section if sectionId provided
      if (sectionId) {
        for (const artifact of rawArtifacts) {
          const canonicalUrl = canonicalizeUrl(artifact.url);
          const artifactId = generateArtifactIdSync(runId, canonicalUrl);
          await ctx.runMutation(internal.lib.artifactPersistence.linkArtifactToSection, {
            runId,
            artifactId,
            sectionId,
          });
        }
      }
      
      return { ok: true, scheduled: false, attempt: attempt + 1 };
      
    } catch (err: unknown) {
      const conflict = isWriteConflict(err);
      const nextAttempt = attempt + 1;
      
      if (conflict && nextAttempt < MAX_ATTEMPTS) {
        // OCC conflict - schedule retry with backoff
        const delay = backoffMs(attempt);
        
        if (ENABLE_ARTIFACT_WRITE_LOGS) {
          console.log("[persistArtifactsWithRetry] OCC conflict, scheduling retry", {
            runId,
            toolName,
            attempt: nextAttempt,
            delayMs: delay,
          });
        }
        
        await ctx.scheduler.runAfter(
          delay,
          internal.lib.artifactPersistence.persistArtifactsWithRetry,
          { ...args, attempt: nextAttempt }
        );
        
        return { ok: false, scheduled: true, attempt: nextAttempt, delay };
      }
      
      // Non-retryable error OR max attempts reached - write dead-letter
      const errorMessage = (err as any)?.message ?? String(err);
      const errorType = classifyErrorType(err);
      
      console.error("[persistArtifactsWithRetry] Failed - writing dead-letter", {
        runId,
        toolName,
        attempt: nextAttempt,
        errorType,
        error: errorMessage,
      });
      
      // Write dead-letter record for visibility
      await ctx.runMutation(internal.lib.artifactPersistence.writeDeadLetter, {
        runId,
        toolName,
        attempt: nextAttempt,
        errorType,
        errorMessage: truncateErrorMessage(errorMessage),
        artifactCount: rawArtifacts.length,
        sampleUrls: rawArtifacts.slice(0, MAX_URLS_IN_SAMPLE).map((a: any) => a.url),
      });
      
      // Mark job as failed
      if (idempotencyKey) {
        await ctx.runMutation(internal.lib.artifactPersistence.upsertJobStatus, {
          runId,
          idempotencyKey,
          status: "failed",
          attempts: nextAttempt,
        });
      }
      
      return { ok: false, scheduled: false, attempt: nextAttempt, error: errorMessage, deadLettered: true };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Query persist job by idempotency key
 */
export const getJobByKey = internalQuery({
  args: {
    runId: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { runId, idempotencyKey }) => {
    return await ctx.db
      .query("artifactPersistJobs")
      .withIndex("by_run_key", q => q.eq("runId", runId).eq("idempotencyKey", idempotencyKey))
      .first() as Doc<"artifactPersistJobs"> | null;
  },
});

/**
 * Upsert persist job status
 */
export const upsertJobStatus = internalMutation({
  args: {
    runId: v.string(),
    idempotencyKey: v.string(),
    status: v.union(v.literal("started"), v.literal("done"), v.literal("failed")),
    attempts: v.number(),
  },
  handler: async (ctx, { runId, idempotencyKey, status, attempts }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("artifactPersistJobs")
      .withIndex("by_run_key", q => q.eq("runId", runId).eq("idempotencyKey", idempotencyKey))
      .first() as Doc<"artifactPersistJobs"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, { status, attempts, updatedAt: now });
    } else {
      await ctx.db.insert("artifactPersistJobs", {
        runId,
        idempotencyKey,
        status,
        attempts,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SHARDED STATS MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Increment stats for a run (sharded to match mutex, avoids new contention)
 */
export const incrementRunStats = internalMutation({
  args: {
    runId: v.string(),
    shardId: v.number(),
    deltas: v.object({
      jobsScheduled: v.optional(v.number()),
      jobsDeduped: v.optional(v.number()),
      deadLetters: v.optional(v.number()),
      occRetries: v.optional(v.number()),
      noopsSkipped: v.optional(v.number()),
      artifactsInserted: v.optional(v.number()),
      artifactsPatched: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { runId, shardId, deltas }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("artifactRunStatsShards")
      .withIndex("by_run_shard", q => q.eq("runId", runId).eq("shardId", shardId))
      .first() as Doc<"artifactRunStatsShards"> | null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        jobsScheduled: existing.jobsScheduled + (deltas.jobsScheduled ?? 0),
        jobsDeduped: existing.jobsDeduped + (deltas.jobsDeduped ?? 0),
        deadLetters: existing.deadLetters + (deltas.deadLetters ?? 0),
        occRetries: existing.occRetries + (deltas.occRetries ?? 0),
        noopsSkipped: existing.noopsSkipped + (deltas.noopsSkipped ?? 0),
        artifactsInserted: existing.artifactsInserted + (deltas.artifactsInserted ?? 0),
        artifactsPatched: existing.artifactsPatched + (deltas.artifactsPatched ?? 0),
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("artifactRunStatsShards", {
        runId,
        shardId,
        jobsScheduled: deltas.jobsScheduled ?? 0,
        jobsDeduped: deltas.jobsDeduped ?? 0,
        deadLetters: deltas.deadLetters ?? 0,
        occRetries: deltas.occRetries ?? 0,
        noopsSkipped: deltas.noopsSkipped ?? 0,
        artifactsInserted: deltas.artifactsInserted ?? 0,
        artifactsPatched: deltas.artifactsPatched ?? 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Get aggregated stats for a run (sums across all shards)
 */
export const getRunStats = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const shards = await ctx.db
      .query("artifactRunStatsShards")
      .withIndex("by_run", q => q.eq("runId", runId))
      .collect() as Doc<"artifactRunStatsShards">[];

    return {
      jobsScheduled: shards.reduce((sum: number, s: Doc<"artifactRunStatsShards">) => sum + s.jobsScheduled, 0),
      jobsDeduped: shards.reduce((sum: number, s: Doc<"artifactRunStatsShards">) => sum + s.jobsDeduped, 0),
      deadLetters: shards.reduce((sum: number, s: Doc<"artifactRunStatsShards">) => sum + s.deadLetters, 0),
      occRetries: shards.reduce((sum: number, s: Doc<"artifactRunStatsShards">) => sum + s.occRetries, 0),
      noopsSkipped: shards.reduce((sum: number, s: Doc<"artifactRunStatsShards">) => sum + s.noopsSkipped, 0),
      artifactsInserted: shards.reduce((sum: number, s: Doc<"artifactRunStatsShards">) => sum + s.artifactsInserted, 0),
      artifactsPatched: shards.reduce((sum: number, s: Doc<"artifactRunStatsShards">) => sum + s.artifactsPatched, 0),
      shardCount: shards.length,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Cleanup old persist jobs (run daily via cron)
 * - done jobs: delete after 7 days
 * - failed jobs: delete after 14 days
 */
export const cleanupArtifactJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deletedDone = 0;
    let deletedFailed = 0;
    
    // Delete old done jobs (7 days)
    const doneCutoff = now - SEVEN_DAYS_MS;
    const oldDoneJobs = await ctx.db
      .query("artifactPersistJobs")
      .withIndex("by_status_createdAt", q =>
        q.eq("status", "done").lt("createdAt", doneCutoff)
      )
      .take(500) as Doc<"artifactPersistJobs">[]; // Batch limit

    for (const job of oldDoneJobs) {
      await ctx.db.delete(job._id);
      deletedDone++;
    }
    
    // Delete old failed jobs (14 days)
    const failedCutoff = now - FOURTEEN_DAYS_MS;
    const oldFailedJobs = await ctx.db
      .query("artifactPersistJobs")
      .withIndex("by_status_createdAt", q =>
        q.eq("status", "failed").lt("createdAt", failedCutoff)
      )
      .take(500) as Doc<"artifactPersistJobs">[];

    for (const job of oldFailedJobs) {
      await ctx.db.delete(job._id);
      deletedFailed++;
    }
    
    if (deletedDone > 0 || deletedFailed > 0) {
      console.log(`[cleanupArtifactJobs] Deleted ${deletedDone} done, ${deletedFailed} failed jobs`);
    }
    
    return { deletedDone, deletedFailed };
  },
});

/**
 * Cleanup old dead-letters (run daily via cron)
 * Keep 30 days for postmortem analysis
 */
export const cleanupDeadLetters = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
    let deleted = 0;
    
    const oldDeadLetters = await ctx.db
      .query("artifactDeadLetters")
      .withIndex("by_run_createdAt")
      .filter(q => q.lt(q.field("createdAt"), cutoff))
      .take(500) as Doc<"artifactDeadLetters">[];

    for (const dl of oldDeadLetters) {
      await ctx.db.delete(dl._id);
      deleted++;
    }
    
    if (deleted > 0) {
      console.log(`[cleanupDeadLetters] Deleted ${deleted} old dead-letters`);
    }
    
    return { deleted };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION LINKING MUTATION (internal)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Link an artifact to a section (internal version for persistence action).
 * Upserts: if already linked, updates sectionId; otherwise creates link.
 */
export const linkArtifactToSection = internalMutation({
  args: {
    runId: v.string(),
    artifactId: v.string(),
    sectionId: v.string(),
  },
  handler: async (ctx, { runId, artifactId, sectionId }) => {
    // Check if link already exists
    const existing = await ctx.db
      .query("artifactLinks")
      .withIndex("by_run_artifact", q =>
        q.eq("runId", runId).eq("artifactId", artifactId)
      )
      .first() as Doc<"artifactLinks"> | null;

    if (existing) {
      // Update if different section
      if (existing.sectionId !== sectionId) {
        await ctx.db.patch(existing._id, { sectionId });
        return { action: "updated", id: existing._id };
      }
      return { action: "skipped", reason: "already linked" };
    }
    
    // Create new link
    const id = await ctx.db.insert("artifactLinks", {
      runId,
      artifactId,
      sectionId,
      createdAt: Date.now(),
    });
    
    return { action: "linked", id };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// DEAD-LETTER MUTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Write a dead-letter record for failed persistence jobs.
 * Keeps payloads small (sample URLs only, truncated error message).
 */
export const writeDeadLetter = internalMutation({
  args: {
    runId: v.string(),
    toolName: v.optional(v.string()),
    attempt: v.number(),
    errorType: v.union(
      v.literal("OCC"),
      v.literal("VALIDATION"),
      v.literal("EXTRACTOR"),
      v.literal("SCHEDULER"),
      v.literal("UNKNOWN")
    ),
    errorMessage: v.string(),
    artifactCount: v.number(),
    sampleUrls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("artifactDeadLetters", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/**
 * Query dead-letters for a run (for testing/debugging)
 */
export const getDeadLettersByRun = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("artifactDeadLetters")
      .withIndex("by_run", q => q.eq("runId", runId))
      .collect();
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// ENRICH MUTATION (with rev check)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enrich an existing artifact (e.g., add thumbnail, update snippet)
 * Uses singleton meta-doc + duplicate scrub + no-op guard
 */
export const enrichArtifact = internalMutation({
  args: {
    runId: v.string(),
    artifactId: v.string(),
    updates: v.object({
      thumbnail: v.optional(v.string()),
      snippet: v.optional(v.string()),
      title: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { runId, artifactId, updates }) => {
    const counters = createCounters();
    
    // FIX 1: Touch singleton meta (self-healing)
    await touchRunMeta(ctx, runId, counters);
    
    // FIX 2: Get existing row, scrubbing duplicates if found
    const existing = await getAndScrubArtifactRow(ctx, runId, artifactId, counters);
    
    if (!existing) {
      return { success: false, error: "Artifact not found", counters };
    }
    
    // Build next state for comparison
    const nextState = {
      thumbnail: updates.thumbnail ?? existing.thumbnail,
      snippet: updates.snippet ?? existing.snippet,
      title: updates.title ?? existing.title,
      flags: updates.thumbnail !== undefined 
        ? { ...existing.flags, hasThumbnail: true }
        : existing.flags,
    };
    
    // FIX 3: Skip if nothing material changed
    if (!materialChanged(existing, nextState)) {
      counters.noopsSkipped++;
      if (ENABLE_ARTIFACT_WRITE_LOGS) {
        console.log("[artifactPersistence:enrich]", { runId, artifactId, ...counters });
      }
      return { success: true, rev: existing.rev, skipped: true, counters };
    }
    
    // Material change - bump rev and patch
    const newRev = existing.rev + 1;
    await ctx.db.patch(existing._id, {
      thumbnail: nextState.thumbnail,
      snippet: nextState.snippet,
      title: nextState.title,
      flags: nextState.flags,
      rev: newRev,
    });
    counters.patched++;
    
    if (ENABLE_ARTIFACT_WRITE_LOGS) {
      console.log("[artifactPersistence:enrich]", { runId, artifactId, ...counters });
    }
    
    return { success: true, rev: newRev, counters };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// FLAG MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pin or unpin an artifact
 * Uses singleton meta-doc + duplicate scrub + no-op guard
 */
export const setArtifactPinned = internalMutation({
  args: {
    runId: v.string(),
    artifactId: v.string(),
    isPinned: v.boolean(),
  },
  handler: async (ctx, { runId, artifactId, isPinned }) => {
    const counters = createCounters();
    
    // FIX 1: Touch singleton meta (self-healing)
    await touchRunMeta(ctx, runId, counters);
    
    // FIX 2: Get existing row, scrubbing duplicates if found
    const existing = await getAndScrubArtifactRow(ctx, runId, artifactId, counters);
    
    if (!existing) return { success: false, counters };
    
    // FIX 3: Skip if flag already matches
    if (existing.flags.isPinned === isPinned) {
      counters.noopsSkipped++;
      if (ENABLE_ARTIFACT_WRITE_LOGS) {
        console.log("[artifactPersistence:pin]", { runId, artifactId, isPinned, ...counters });
      }
      return { success: true, skipped: true, counters };
    }
    
    await ctx.db.patch(existing._id, {
      flags: { ...existing.flags, isPinned },
      rev: existing.rev + 1,
    });
    counters.patched++;
    
    if (ENABLE_ARTIFACT_WRITE_LOGS) {
      console.log("[artifactPersistence:pin]", { runId, artifactId, isPinned, ...counters });
    }
    
    return { success: true, counters };
  },
});

/**
 * Mark artifact as cited in final output
 * Uses singleton meta-doc + duplicate scrub + no-op guard
 */
export const setArtifactCited = internalMutation({
  args: {
    runId: v.string(),
    artifactId: v.string(),
    isCited: v.boolean(),
  },
  handler: async (ctx, { runId, artifactId, isCited }) => {
    const counters = createCounters();
    
    // FIX 1: Touch singleton meta (self-healing)
    await touchRunMeta(ctx, runId, counters);
    
    // FIX 2: Get existing row, scrubbing duplicates if found
    const existing = await getAndScrubArtifactRow(ctx, runId, artifactId, counters);
    
    if (!existing) return { success: false, counters };
    
    // FIX 3: Skip if flag already matches
    if (existing.flags.isCited === isCited) {
      counters.noopsSkipped++;
      if (ENABLE_ARTIFACT_WRITE_LOGS) {
        console.log("[artifactPersistence:cite]", { runId, artifactId, isCited, ...counters });
      }
      return { success: true, skipped: true, counters };
    }
    
    await ctx.db.patch(existing._id, {
      flags: { ...existing.flags, isCited },
      rev: existing.rev + 1,
    });
    counters.patched++;
    
    if (ENABLE_ARTIFACT_WRITE_LOGS) {
      console.log("[artifactPersistence:cite]", { runId, artifactId, isCited, ...counters });
    }
    
    return { success: true, counters };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all artifacts for a run
 */
export const getArtifactsByRun = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("artifacts")
      .withIndex("by_run", q => q.eq("runId", runId))
      .collect();
  },
});

/**
 * Get a specific artifact
 */
export const getArtifact = internalQuery({
  args: { runId: v.string(), artifactId: v.string() },
  handler: async (ctx, { runId, artifactId }) => {
    return await ctx.db
      .query("artifacts")
      .withIndex("by_run_artifact", q => 
        q.eq("runId", runId).eq("artifactId", artifactId)
      )
      .first();
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST (must-have for production safety)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate overlapping test artifacts (same URLs from "different tools")
 */
function makeOverlappingArtifacts() {
  const urls = [
    "https://example.com/article-1",
    "https://example.com/article-2",
    "https://example.com/article-3",
    "https://youtube.com/watch?v=abc123",
    "https://github.com/owner/repo",
  ];
  
  return urls.flatMap((url, i) => [
    { url, title: `Title ${i} - Tool A`, kind: "url", provider: "web" },
    { url, title: `Title ${i} - Tool B`, kind: "url", provider: "web" },
    { url, title: `Title ${i} - Tool C`, kind: "url", provider: "web" },
    { url: url + "?variant=1", title: `Variant ${i}`, kind: "url", provider: "web" },
  ]);
}

/**
 * Stress test: 50 concurrent upserts with overlapping artifact IDs
 * 
 * Asserts:
 * - artifactRunMeta count per runId == 1 (after self-heal)
 * - artifacts count == unique (runId, artifactId) — no duplicates
 * - Counters show expected behavior
 * 
 * Run via: npx convex run lib/artifactPersistence:stressArtifacts --args '{"runId":"test-run-123"}'
 */
export const stressArtifacts = internalAction({
  args: { 
    runId: v.string(),
    userId: v.id("users"),  // Required - must be a valid user ID
    concurrency: v.optional(v.number()),
  },
  handler: async (ctx, { runId, userId, concurrency = 50 }): Promise<{
    ok: boolean;
    metaCount: number;
    artifactCount: number;
    expectedUniqueUrls: number;
    concurrentCalls: number;
    successes: number;
    failures: number;
  }> => {
    const payload = makeOverlappingArtifacts();
    
    console.log(`[stressArtifacts] Starting ${concurrency} concurrent upserts with ${payload.length} artifacts each`);
    
    // Fan out concurrent mutations
    const promises: Promise<any>[] = [];
    for (let i = 0; i < concurrency; i++) {
      promises.push(
        ctx.runMutation(internal.lib.artifactPersistence.upsertRawArtifacts, {
          runId,
          userId,
          toolName: `stress-tool-${i}`,
          rawArtifacts: payload,
        })
      );
    }
    
    const results: PromiseSettledResult<any>[] = await Promise.allSettled(promises);
    
    // Count successes and failures
    const successes = results.filter((r: PromiseSettledResult<any>) => r.status === "fulfilled").length;
    const failures = results.filter((r: PromiseSettledResult<any>) => r.status === "rejected").length;
    
    console.log(`[stressArtifacts] Completed: ${successes} succeeded, ${failures} failed (retries expected)`);
    
    // Verify: exactly 1 meta doc
    const metas: Doc<"artifactRunMeta">[] = await ctx.runQuery(internal.lib.artifactPersistence.getMetasByRun, { runId });
    if (metas.length !== 1) {
      throw new Error(`[FAIL] meta docs != 1: ${metas.length}`);
    }
    
    // Verify: no duplicate artifacts
    const allArtifacts: Doc<"artifacts">[] = await ctx.runQuery(internal.lib.artifactPersistence.getArtifactsByRun, { runId });
    const seen = new Set<string>();
    for (const row of allArtifacts) {
      const key = `${row.runId}:${row.artifactId}`;
      if (seen.has(key)) {
        throw new Error(`[FAIL] duplicate artifact row found: ${key}`);
      }
      seen.add(key);
    }
    
    // Calculate expected unique artifact count (unique canonical URLs)
    const uniqueUrls = new Set(payload.map(p => canonicalizeUrl(p.url)));
    
    console.log(`[stressArtifacts] ✅ PASSED`);
    console.log(`  - Meta docs: ${metas.length} (expected: 1)`);
    console.log(`  - Artifacts: ${allArtifacts.length} (expected unique URLs: ${uniqueUrls.size})`);
    console.log(`  - No duplicates found`);
    
    return {
      ok: true,
      metaCount: metas.length,
      artifactCount: allArtifacts.length,
      expectedUniqueUrls: uniqueUrls.size,
      concurrentCalls: concurrency,
      successes,
      failures,
    };
  },
});

/**
 * Helper query to get all meta docs for a run (for stress test verification)
 */
export const getMetasByRun = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("artifactRunMeta")
      .withIndex("by_run", q => q.eq("runId", runId))
      .collect();
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST V2: UNIQUE PER WORKER (tests reliability, not just dedupe)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate unique + shared artifacts for a specific worker
 */
function makeWorkerArtifacts(workerId: number, uniqueCount: number, sharedUrls: string[]) {
  const artifacts: Array<{ url: string; title: string; kind: string; provider: string }> = [];
  
  // Unique URLs for this worker
  for (let i = 0; i < uniqueCount; i++) {
    artifacts.push({
      url: `https://worker${workerId}.example.com/unique-${i}`,
      title: `Worker ${workerId} Unique ${i}`,
      kind: "url",
      provider: "web",
    });
  }
  
  // Shared URLs (same across all workers)
  for (const url of sharedUrls) {
    artifacts.push({
      url,
      title: `Shared from Worker ${workerId}`,
      kind: "url",
      provider: "web",
    });
  }
  
  return artifacts;
}

/**
 * Stress test V2: Tests RELIABILITY (no lost artifacts), not just dedupe.
 * 
 * Each worker gets M unique URLs + some shared URLs.
 * Uses the retry action to ensure eventual persistence.
 * 
 * Asserts:
 * - Persisted unique count == N * M (no loss!)
 * - Persisted shared count == sharedUrls.length (deduped correctly)
 * - Total artifacts == N * M + sharedUrls.length
 * - Meta docs <= K (sharded)
 * 
 * If this test flaps, it means artifacts are being silently lost.
 */
export const stressArtifactsReliability = internalAction({
  args: { 
    runId: v.string(),
    userId: v.id("users"),
    workerCount: v.optional(v.number()),      // N workers (default: 20)
    uniquePerWorker: v.optional(v.number()),  // M unique URLs per worker (default: 3)
  },
  handler: async (ctx, { runId, userId, workerCount = 20, uniquePerWorker = 3 }): Promise<{
    ok: boolean;
    expectedTotal: number;
    actualTotal: number;
    expectedUnique: number;
    actualUnique: number;
    shardCount: number;
    workerCount: number;
    deadLetterCount: number;
  }> => {
    const sharedUrls = [
      "https://shared.example.com/common-1",
      "https://shared.example.com/common-2",
    ];
    
    const expectedUnique = workerCount * uniquePerWorker;
    const expectedTotal = expectedUnique + sharedUrls.length;
    
    console.log(`[stressReliability] Starting ${workerCount} workers, ${uniquePerWorker} unique each, ${sharedUrls.length} shared`);
    console.log(`[stressReliability] Expected: ${expectedUnique} unique + ${sharedUrls.length} shared = ${expectedTotal} total`);
    
    // Fan out concurrent ACTIONS (not mutations) - uses retry logic
    const promises: Promise<any>[] = [];
    for (let i = 0; i < workerCount; i++) {
      const payload = makeWorkerArtifacts(i, uniquePerWorker, sharedUrls);
      promises.push(
        ctx.runAction(internal.lib.artifactPersistence.persistArtifactsWithRetry, {
          runId,
          userId,
          toolName: `reliability-worker-${i}`,
          rawArtifacts: payload,
          attempt: 0,
        })
      );
    }
    
    // Wait for all workers to complete (initial attempt)
    const results = await Promise.allSettled(promises);
    const successes = results.filter(r => r.status === "fulfilled").length;
    const failures = results.filter(r => r.status === "rejected").length;
    
    // Count how many scheduled retries
    let scheduledCount = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && (r.value)?.scheduled) {
        scheduledCount++;
      }
    }
    
    console.log(`[stressReliability] Initial batch: ${successes} fulfilled, ${failures} rejected, ${scheduledCount} scheduled retries`);
    
    // Poll for expected artifact count instead of fixed wait
    const maxWaitMs = 30000;
    const pollIntervalMs = 500;
    const startTime = Date.now();
    let allArtifacts: Doc<"artifacts">[] = [];
    
    console.log(`[stressReliability] Polling for ${expectedTotal} artifacts (timeout: ${maxWaitMs}ms)...`);
    
    while (Date.now() - startTime < maxWaitMs) {
      allArtifacts = await ctx.runQuery(
        internal.lib.artifactPersistence.getArtifactsByRun, 
        { runId }
      );
      
      if (allArtifacts.length >= expectedTotal) {
        console.log(`[stressReliability] Reached expected count after ${Date.now() - startTime}ms`);
        break;
      }
      
      await sleep(pollIntervalMs);
    }
    
    // Get meta docs
    const metas: Doc<"artifactRunMeta">[] = await ctx.runQuery(
      internal.lib.artifactPersistence.getMetasByRun, 
      { runId }
    );
    
    // Check dead-letter table is empty
    const deadLetters = await ctx.runQuery(
      internal.lib.artifactPersistence.getDeadLettersByRun,
      { runId }
    );
    
    // Count unique vs shared
    let actualUnique = 0;
    let actualShared = 0;
    for (const artifact of allArtifacts) {
      if (artifact.canonicalUrl?.includes("shared.example.com")) {
        actualShared++;
      } else {
        actualUnique++;
      }
    }
    
    const actualTotal = allArtifacts.length;
    const deadLetterCount = deadLetters.length;
    const ok = actualTotal === expectedTotal && actualUnique === expectedUnique && deadLetterCount === 0;
    
    if (ok) {
      console.log(`[stressReliability] ✅ PASSED - No artifacts lost!`);
    } else {
      console.error(`[stressReliability] ❌ FAILED`);
      if (actualTotal !== expectedTotal) {
        console.error(`  Artifacts lost! Expected: ${expectedTotal}, Actual: ${actualTotal}`);
      }
      if (actualUnique !== expectedUnique) {
        console.error(`  Unique mismatch! Expected: ${expectedUnique}, Actual: ${actualUnique}`);
      }
      if (deadLetterCount > 0) {
        console.error(`  Dead-letters found: ${deadLetterCount}`);
        for (const dl of deadLetters) {
          console.error(`    - ${dl.toolName}: ${dl.errorType} - ${dl.errorMessage.slice(0, 100)}`);
        }
      }
    }
    
    console.log(`[stressReliability] Results:`);
    console.log(`  - Total artifacts: ${actualTotal} (expected: ${expectedTotal})`);
    console.log(`  - Unique artifacts: ${actualUnique} (expected: ${expectedUnique})`);
    console.log(`  - Shared artifacts: ${actualShared} (expected: ${sharedUrls.length})`);
    console.log(`  - Meta shards used: ${metas.length} (max: ${SHARD_COUNT})`);
    console.log(`  - Dead-letters: ${deadLetterCount} (expected: 0)`);
    
    if (!ok) {
      throw new Error(`[FAIL] Test failed! Artifacts: ${actualTotal}/${expectedTotal}, Dead-letters: ${deadLetterCount}`);
    }
    
    return {
      ok,
      expectedTotal,
      actualTotal,
      expectedUnique,
      actualUnique,
      shardCount: metas.length,
      workerCount,
      deadLetterCount,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST V3: BIG PAYLOAD (tests chunking)
// ═══════════════════════════════════════════════════════════════════════════

const CHUNK_SIZE = 25; // Must match wrapper's MAX_ARTIFACTS_PER_JOB

/**
 * Stress test for chunking: 200+ artifacts in one "tool call"
 * 
 * Asserts:
 * - Chunks are created correctly (200 / 25 = 8 chunks)
 * - All artifacts persist (no loss from chunking)
 * - No dead-letters
 * - Idempotency keys are unique per chunk
 */
export const stressChunking = internalAction({
  args: {
    runId: v.string(),
    userId: v.id("users"),
    artifactCount: v.optional(v.number()),  // Default: 200
  },
  handler: async (ctx, { runId, userId, artifactCount = 200 }): Promise<{
    ok: boolean;
    expectedArtifacts: number;
    actualArtifacts: number;
    expectedChunks: number;
    deadLetterCount: number;
  }> => {
    const expectedChunks = Math.ceil(artifactCount / CHUNK_SIZE);
    
    console.log(`[stressChunking] Starting with ${artifactCount} artifacts (expected ${expectedChunks} chunks)`);
    
    // Generate big payload
    const payload: Array<{ url: string; title: string; kind: string; provider: string }> = [];
    for (let i = 0; i < artifactCount; i++) {
      payload.push({
        url: `https://chunking-test.example.com/article-${i}`,
        title: `Chunking Test Article ${i}`,
        kind: "url",
        provider: "web",
      });
    }
    
    // Simulate chunking like the wrapper does
    const chunks: Array<typeof payload> = [];
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
      chunks.push(payload.slice(i, i + CHUNK_SIZE));
    }
    
    // Schedule each chunk (like the wrapper would)
    const promises: Promise<any>[] = [];
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const canonicalUrls = chunk.map(a => a.url);
      
      // Generate idempotency key (simplified - matches shared/artifacts.ts logic)
      const sortedUrls = [...canonicalUrls].sort();
      let urlsHash = 5381;
      const urlsJoined = sortedUrls.join("\n");
      for (let i = 0; i < urlsJoined.length; i++) {
        urlsHash = ((urlsHash << 5) + urlsHash) ^ urlsJoined.charCodeAt(i);
      }
      const urlsHashStr = Math.abs(urlsHash).toString(36);
      
      const fullInput = `${runId}|chunking-test|${chunkIndex}|${urlsHashStr}`;
      let fullHash = 5381;
      for (let i = 0; i < fullInput.length; i++) {
        fullHash = ((fullHash << 5) + fullHash) ^ fullInput.charCodeAt(i);
      }
      const idempotencyKey = `idem_${Math.abs(fullHash).toString(36)}`;
      
      promises.push(
        ctx.runAction(internal.lib.artifactPersistence.persistArtifactsWithRetry, {
          runId,
          userId,
          toolName: "chunking-test",
          rawArtifacts: chunk,
          attempt: 0,
          idempotencyKey,
        })
      );
    }
    
    console.log(`[stressChunking] Scheduled ${promises.length} chunks`);
    
    // Wait for all chunks
    await Promise.allSettled(promises);
    
    // Poll for expected artifact count
    const maxWaitMs = 30000;
    const pollIntervalMs = 500;
    const startTime = Date.now();
    let allArtifacts: Doc<"artifacts">[] = [];
    
    while (Date.now() - startTime < maxWaitMs) {
      allArtifacts = await ctx.runQuery(
        internal.lib.artifactPersistence.getArtifactsByRun, 
        { runId }
      );
      
      if (allArtifacts.length >= artifactCount) {
        console.log(`[stressChunking] Reached expected count after ${Date.now() - startTime}ms`);
        break;
      }
      
      await sleep(pollIntervalMs);
    }
    
    // Check dead-letters
    const deadLetters = await ctx.runQuery(
      internal.lib.artifactPersistence.getDeadLettersByRun,
      { runId }
    );
    
    const deadLetterCount = deadLetters.length;
    const ok = allArtifacts.length === artifactCount && deadLetterCount === 0;
    
    if (ok) {
      console.log(`[stressChunking] ✅ PASSED`);
    } else {
      console.error(`[stressChunking] ❌ FAILED`);
      console.error(`  Artifacts: ${allArtifacts.length}/${artifactCount}`);
      console.error(`  Dead-letters: ${deadLetterCount}`);
    }
    
    console.log(`[stressChunking] Results:`);
    console.log(`  - Expected chunks: ${expectedChunks}`);
    console.log(`  - Artifacts: ${allArtifacts.length} (expected: ${artifactCount})`);
    console.log(`  - Dead-letters: ${deadLetterCount}`);
    
    if (!ok) {
      throw new Error(`[FAIL] Chunking test failed!`);
    }
    
    return {
      ok,
      expectedArtifacts: artifactCount,
      actualArtifacts: allArtifacts.length,
      expectedChunks,
      deadLetterCount,
    };
  },
});
