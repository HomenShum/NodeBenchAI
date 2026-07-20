// convex/domains/knowledge/sourceDiffs.ts
// Source Diff Detection and Change Tracking
// Part of the Knowledge Product Layer (Phase 1)

import { v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  action,
  internalAction,
} from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import type { Id, Doc } from "../../_generated/dataModel";

// ============================================================================
// Types
// ============================================================================

export type ChangeType =
  | "guidance_added"
  | "guidance_removed"
  | "guidance_modified"
  | "breaking_change"
  | "deprecation"
  | "new_pattern"
  | "pricing_change"
  | "api_change"
  | "model_update"
  | "minor_update";

export type Severity = "critical" | "high" | "medium" | "low";

export interface DiffHunk {
  type: "add" | "remove" | "modify";
  oldText?: string;
  newText?: string;
  context?: string;
}

export interface SourceDiff {
  registryId: string;
  fromSnapshotAt: number;
  toSnapshotAt: number;
  changeType: ChangeType;
  severity: Severity;
  changeTitle: string;
  changeSummary: string;
  affectedSections: string[];
  diffHunks?: DiffHunk[];
  classifiedBy?: string;
  classificationConfidence?: number;
  detectedAt: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate content hash for comparison
 */
export function generateContentHash(content: string): string {
  // Runtime-safe, deterministic 64-bit FNV-1a hash (not cryptographic).
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let i = 0; i < content.length; i++) {
    hash ^= BigInt(content.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }

  return hash.toString(16).padStart(16, "0").slice(0, 16);
}

/**
 * Simple diff algorithm - detects if content changed
 * For page-level diffing (as per plan decision)
 */
export function detectContentChange(
  oldContent: string | undefined,
  newContent: string
): { changed: boolean; oldHash?: string; newHash: string } {
  const newHash = generateContentHash(newContent);

  if (!oldContent) {
    return { changed: true, newHash };
  }

  const oldHash = generateContentHash(oldContent);
  return {
    changed: oldHash !== newHash,
    oldHash,
    newHash,
  };
}

/**
 * Extract meaningful sections from HTML/Markdown content
 */
export function extractSections(
  content: string
): Array<{ sectionId: string; title: string; contentHash: string }> {
  const sections: Array<{ sectionId: string; title: string; contentHash: string }> = [];

  // Match markdown headers (# Header, ## Header, etc.)
  const headerRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  let sectionIndex = 0;

  while ((match = headerRegex.exec(content)) !== null) {
    const level = match[1].length;
    const title = match[2].trim();
    const sectionId = `section_${sectionIndex}_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30)}`;

    // Get content until next header or end
    const startPos = match.index + match[0].length;
    const nextMatch = headerRegex.exec(content);
    const endPos = nextMatch ? nextMatch.index : content.length;
    headerRegex.lastIndex = match.index + match[0].length; // Reset for next iteration

    const sectionContent = content.slice(startPos, endPos).trim();
    const contentHash = generateContentHash(sectionContent);

    sections.push({ sectionId, title, contentHash });
    sectionIndex++;
  }

  return sections;
}

// ============================================================================
// Snapshot Mutations
// ============================================================================

/**
 * Create a new snapshot for a source
 */
export const createSnapshot = internalMutation({
  args: {
    registryId: v.string(),
    content: v.string(),
    httpStatus: v.optional(v.number()),
    fetchDurationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const contentHash = generateContentHash(args.content);
    const sections = extractSections(args.content);

    // Check if we should store raw content (limit to ~100KB)
    const contentLength = args.content.length;
    const storeRaw = contentLength < 100_000;

    const snapshotId = await ctx.db.insert("sourceSnapshots", {
      registryId: args.registryId,
      snapshotAt: now,
      contentHash,
      rawContent: storeRaw ? args.content : undefined,
      extractedSections: sections,
      httpStatus: args.httpStatus,
      contentLength,
      fetchDurationMs: args.fetchDurationMs,
    });

    console.log(
      `[sourceDiffs] Created snapshot for ${args.registryId}: ${contentHash} (${contentLength} bytes)`
    );

    return { snapshotId, snapshotAt: now, contentHash, sections };
  },
});

/**
 * Get latest snapshot for a source
 */
export const getLatestSnapshot = internalQuery({
  args: {
    registryId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sourceSnapshots")
      .withIndex("by_registry_time", (q) => q.eq("registryId", args.registryId))
      .order("desc")
      .first();
  },
});

/**
 * Get snapshots in a time range
 */
export const getSnapshotsInRange = query({
  args: {
    registryId: v.string(),
    fromTime: v.number(),
    toTime: v.number(),
  },
  handler: async (ctx, args) => {
    const snapshots = await ctx.db
      .query("sourceSnapshots")
      .withIndex("by_registry_time", (q) => q.eq("registryId", args.registryId))
      .collect();

    return snapshots.filter(
      (s) => s.snapshotAt >= args.fromTime && s.snapshotAt <= args.toTime
    );
  },
});

// ============================================================================
// Diff Detection
// ============================================================================

/**
 * Compare two snapshots and detect changes
 */
export const compareSnapshots = internalMutation({
  args: {
    registryId: v.string(),
    fromSnapshotId: v.id("sourceSnapshots"),
    toSnapshotId: v.id("sourceSnapshots"),
    changeClassification: v.object({
      changeType: v.union(
        v.literal("guidance_added"),
        v.literal("guidance_removed"),
        v.literal("guidance_modified"),
        v.literal("breaking_change"),
        v.literal("deprecation"),
        v.literal("new_pattern"),
        v.literal("pricing_change"),
        v.literal("api_change"),
        v.literal("model_update"),
        v.literal("minor_update")
      ),
      severity: v.union(
        v.literal("critical"),
        v.literal("high"),
        v.literal("medium"),
        v.literal("low")
      ),
      changeTitle: v.string(),
      changeSummary: v.string(),
      affectedSections: v.array(v.string()),
      classifiedBy: v.optional(v.string()),
      classificationConfidence: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const fromSnapshot = await ctx.db.get(args.fromSnapshotId);
    const toSnapshot = await ctx.db.get(args.toSnapshotId);

    if (!fromSnapshot || !toSnapshot) {
      throw new Error("Snapshot not found");
    }

    const now = Date.now();

    // Create diff record
    const diffId = await ctx.db.insert("sourceDiffs", {
      registryId: args.registryId,
      fromSnapshotAt: fromSnapshot.snapshotAt,
      toSnapshotAt: toSnapshot.snapshotAt,
      changeType: args.changeClassification.changeType,
      severity: args.changeClassification.severity,
      changeTitle: args.changeClassification.changeTitle,
      changeSummary: args.changeClassification.changeSummary,
      affectedSections: args.changeClassification.affectedSections,
      classifiedBy: args.changeClassification.classifiedBy,
      classificationConfidence: args.changeClassification.classificationConfidence,
      detectedAt: now,
    });

    console.log(
      `[sourceDiffs] Created diff for ${args.registryId}: ${args.changeClassification.changeType} (${args.changeClassification.severity})`
    );

    return diffId;
  },
});

/**
 * Record a diff directly (for use from actions)
 */
export const recordDiff = internalMutation({
  args: {
    registryId: v.string(),
    fromSnapshotAt: v.number(),
    toSnapshotAt: v.number(),
    changeType: v.union(
      v.literal("guidance_added"),
      v.literal("guidance_removed"),
      v.literal("guidance_modified"),
      v.literal("breaking_change"),
      v.literal("deprecation"),
      v.literal("new_pattern"),
      v.literal("pricing_change"),
      v.literal("api_change"),
      v.literal("model_update"),
      v.literal("minor_update")
    ),
    severity: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low")
    ),
    changeTitle: v.string(),
    changeSummary: v.string(),
    affectedSections: v.array(v.string()),
    diffHunks: v.optional(v.array(v.object({
      type: v.union(
        v.literal("add"),
        v.literal("remove"),
        v.literal("modify")
      ),
      oldText: v.optional(v.string()),
      newText: v.optional(v.string()),
      context: v.optional(v.string()),
    }))),
    classifiedBy: v.optional(v.string()),
    classificationConfidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const diffId = await ctx.db.insert("sourceDiffs", {
      registryId: args.registryId,
      fromSnapshotAt: args.fromSnapshotAt,
      toSnapshotAt: args.toSnapshotAt,
      changeType: args.changeType,
      severity: args.severity,
      changeTitle: args.changeTitle,
      changeSummary: args.changeSummary,
      affectedSections: args.affectedSections,
      diffHunks: args.diffHunks,
      classifiedBy: args.classifiedBy,
      classificationConfidence: args.classificationConfidence,
      detectedAt: now,
    });

    return diffId;
  },
});

// ============================================================================
// Diff Queries
// ============================================================================

/**
 * Get recent diffs for a source
 */
export const getRecentDiffs = query({
  args: {
    registryId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;

    return await ctx.db
      .query("sourceDiffs")
      .withIndex("by_registryId", (q) => q.eq("registryId", args.registryId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get all diffs across all sources (for "What Changed" view)
 */
export const getAllRecentDiffs = query({
  args: {
    limit: v.optional(v.number()),
    severityFilter: v.optional(v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low")
    )),
    sinceTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const sinceTime = args.sinceTime ?? Date.now() - 7 * 24 * 60 * 60 * 1000; // Default: last 7 days

    let query = ctx.db
      .query("sourceDiffs")
      .withIndex("by_detectedAt")
      .order("desc");

    const diffs = await query.collect();

    // Filter by time and severity
    let filtered = diffs.filter((d) => d.detectedAt >= sinceTime);

    if (args.severityFilter) {
      filtered = filtered.filter((d) => d.severity === args.severityFilter);
    }

    return filtered.slice(0, limit);
  },
});

/**
 * Get diffs by severity (for alerts)
 */
export const getDiffsBySeverity = query({
  args: {
    severity: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low")
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    return await ctx.db
      .query("sourceDiffs")
      .withIndex("by_severity", (q) => q.eq("severity", args.severity))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get diffs by change type
 */
export const getDiffsByChangeType = query({
  args: {
    changeType: v.union(
      v.literal("guidance_added"),
      v.literal("guidance_removed"),
      v.literal("guidance_modified"),
      v.literal("breaking_change"),
      v.literal("deprecation"),
      v.literal("new_pattern"),
      v.literal("pricing_change"),
      v.literal("api_change"),
      v.literal("model_update"),
      v.literal("minor_update")
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    return await ctx.db
      .query("sourceDiffs")
      .withIndex("by_changeType", (q) => q.eq("changeType", args.changeType))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get diff statistics
 */
export const getDiffStats = query({
  args: {
    sinceTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const sinceTime = args.sinceTime ?? Date.now() - 30 * 24 * 60 * 60 * 1000; // Default: last 30 days

    const diffs = await ctx.db
      .query("sourceDiffs")
      .withIndex("by_detectedAt")
      .collect();

    const recentDiffs = diffs.filter((d) => d.detectedAt >= sinceTime);

    // Group by severity
    const bySeverity: Record<string, number> = {};
    for (const d of recentDiffs) {
      bySeverity[d.severity] = (bySeverity[d.severity] || 0) + 1;
    }

    // Group by change type
    const byChangeType: Record<string, number> = {};
    for (const d of recentDiffs) {
      byChangeType[d.changeType] = (byChangeType[d.changeType] || 0) + 1;
    }

    // Group by registry (source)
    const bySource: Record<string, number> = {};
    for (const d of recentDiffs) {
      bySource[d.registryId] = (bySource[d.registryId] || 0) + 1;
    }

    return {
      total: recentDiffs.length,
      bySeverity,
      byChangeType,
      bySource,
      sinceTime,
    };
  },
});

/**
 * Refresh summary for UI (last refresh times, due counts)
 */
export const getRefreshSummary = query({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query("sourceRegistry").collect();
    const active = sources.filter((s) => s.isActive);

    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const WEEK = 7 * DAY;

    let dueCount = 0;
    let lastFetchedAt = 0;
    let lastChangedAt = 0;

    for (const source of active) {
      lastFetchedAt = Math.max(lastFetchedAt, source.lastFetchedAt ?? 0);
      lastChangedAt = Math.max(lastChangedAt, source.lastChangedAt ?? 0);

      const lastFetched = source.lastFetchedAt ?? 0;
      const age = now - lastFetched;
      let isDue = false;

      switch (source.refreshCadence) {
        case "hourly":
          isDue = age > HOUR;
          break;
        case "daily":
          isDue = age > DAY;
          break;
        case "weekly":
          isDue = age > WEEK;
          break;
        case "manual":
        default:
          isDue = false;
          break;
      }

      if (isDue) dueCount++;
    }

    const pinnedCount = active.filter((s) => s.isPinned).length;
    const latestDiff = await ctx.db
      .query("sourceDiffs")
      .withIndex("by_detectedAt")
      .order("desc")
      .first();

    return {
      activeCount: active.length,
      pinnedCount,
      dueCount,
      lastFetchedAt: lastFetchedAt || null,
      lastChangedAt: lastChangedAt || null,
      lastDiffDetectedAt: latestDiff?.detectedAt ?? null,
    };
  },
});

// ============================================================================
// Snapshot Fetch Action
// ============================================================================

/**
 * Fetch and snapshot a source (action - can make HTTP requests)
 */
export const fetchAndSnapshotSource = internalAction({
  args: {
    registryId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    changed: boolean;
    snapshotId?: Id<"sourceSnapshots">;
    error?: string;
  }> => {
    const startTime = Date.now();

    try {
      // Fetch the URL
      const response = await fetch(args.url, {
        headers: {
          "User-Agent": "NodeBench-KnowledgeBot/1.0 (Authoritative Source Monitor)",
        },
      });

      const fetchDurationMs = Date.now() - startTime;
      const httpStatus = response.status;

      if (!response.ok) {
        console.warn(
          `[sourceDiffs] Fetch failed for ${args.registryId}: HTTP ${httpStatus}`
        );
        return {
          success: false,
          changed: false,
          error: `HTTP ${httpStatus}`,
        };
      }

      const content = await response.text();

      // Get previous snapshot to compare
      const prevSnapshot = await ctx.runQuery(internal.domains.knowledge.sourceDiffs.getLatestSnapshot, {
        registryId: args.registryId,
      });

      const { changed, newHash } = detectContentChange(
        prevSnapshot?.rawContent ?? undefined,
        content
      );

      // Create new snapshot
      const result = await ctx.runMutation(internal.domains.knowledge.sourceDiffs.createSnapshot, {
        registryId: args.registryId,
        content,
        httpStatus,
        fetchDurationMs,
      });

      // Update source registry freshness
      await ctx.runMutation(internal.domains.knowledge.sourceRegistry.updateSourceFreshness, {
        registryId: args.registryId,
        contentHash: newHash,
        changed,
      });

      // If the content changed, immediately record a diff against the previous snapshot.
      // This avoids fragile "re-fetch latest snapshot" logic in cron loops.
      if (changed) {
        const source = await ctx.runQuery(internal.domains.knowledge.sourceRegistry.getSource, {
          registryId: args.registryId,
        });

        await ctx.runAction(internal.domains.knowledge.sourceDiffs.classifyChangeWithLLM, {
          registryId: args.registryId,
          sourceName: source?.name ?? args.registryId,
          oldContent: prevSnapshot?.rawContent ?? undefined,
          newContent: content,
          fromSnapshotAt: prevSnapshot?.snapshotAt ?? result.snapshotAt,
          toSnapshotAt: result.snapshotAt,
        });
      }

      console.log(
        `[sourceDiffs] Fetched ${args.registryId}: ${changed ? "CHANGED" : "unchanged"} (${fetchDurationMs}ms)`
      );

      return {
        success: true,
        changed,
        snapshotId: result.snapshotId,
      };
    } catch (error) {
      console.error(`[sourceDiffs] Error fetching ${args.registryId}:`, error);
      return {
        success: false,
        changed: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// ============================================================================
// LLM-Powered Change Classification
// ============================================================================

/**
 * Classify a change using LLM (for significant changes)
 */
export const classifyChangeWithLLM = internalAction({
  args: {
    registryId: v.string(),
    sourceName: v.string(),
    oldContent: v.optional(v.string()),
    newContent: v.string(),
    fromSnapshotAt: v.number(),
    toSnapshotAt: v.number(),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    diffId?: Id<"sourceDiffs">;
    error?: string;
  }> => {
    // For now, use a simple rule-based classification
    // TODO: Integrate with LLM for better classification

    const changeType = detectChangeTypeByRules(args.oldContent, args.newContent);
    const severity = inferSeverity(changeType);

    // Generate a simple summary
    const changeTitle = `Content updated in ${args.sourceName}`;
    const changeSummary = args.oldContent
      ? `The content at ${args.sourceName} has been modified. Review for important updates.`
      : `New content detected at ${args.sourceName}.`;

    // Record the diff
    const diffId = await ctx.runMutation(internal.domains.knowledge.sourceDiffs.recordDiff, {
      registryId: args.registryId,
      fromSnapshotAt: args.fromSnapshotAt,
      toSnapshotAt: args.toSnapshotAt,
      changeType,
      severity,
      changeTitle,
      changeSummary,
      affectedSections: [],
      classifiedBy: "rules",
      classificationConfidence: 0.7,
    });

    return { success: true, diffId };
  },
});

/**
 * Simple rule-based change type detection
 */
function detectChangeTypeByRules(
  oldContent: string | undefined,
  newContent: string
): ChangeType {
  const lowerNew = newContent.toLowerCase();

  // Check for specific keywords
  if (lowerNew.includes("deprecated") || lowerNew.includes("deprecation")) {
    return "deprecation";
  }
  if (lowerNew.includes("breaking change") || lowerNew.includes("breaking-change")) {
    return "breaking_change";
  }
  if (lowerNew.includes("new feature") || lowerNew.includes("introducing")) {
    return "guidance_added";
  }
  if (lowerNew.includes("price") || lowerNew.includes("pricing") || lowerNew.includes("cost")) {
    return "pricing_change";
  }
  if (lowerNew.includes("api") && (lowerNew.includes("change") || lowerNew.includes("update"))) {
    return "api_change";
  }
  if (lowerNew.includes("model") && (lowerNew.includes("new") || lowerNew.includes("release"))) {
    return "model_update";
  }

  // Default based on content presence
  if (!oldContent) {
    return "guidance_added";
  }

  // Check if content was removed (new is significantly shorter)
  if (newContent.length < oldContent.length * 0.5) {
    return "guidance_removed";
  }

  // Default to modified
  return "guidance_modified";
}

/**
 * Infer severity from change type
 */
function inferSeverity(changeType: ChangeType): Severity {
  switch (changeType) {
    case "breaking_change":
      return "critical";
    case "deprecation":
    case "api_change":
      return "high";
    case "model_update":
    case "pricing_change":
    case "new_pattern":
      return "medium";
    case "guidance_added":
    case "guidance_removed":
    case "guidance_modified":
    case "minor_update":
    default:
      return "low";
  }
}

// ============================================================================
// Cron Job Support
// ============================================================================

/**
 * Process all sources due for refresh (called by cron)
 */
export const processSourceRefresh = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    processed: number;
    changed: number;
    errors: number;
  }> => {
    // Get sources due for refresh
    const sourcesDue = await ctx.runQuery(
      internal.domains.knowledge.sourceRegistry.getSourcesDueForRefresh,
      {}
    );

    let processed = 0;
    let changed = 0;
    let errors = 0;

    for (const source of sourcesDue) {
      try {
        const result = await ctx.runAction(
          internal.domains.knowledge.sourceDiffs.fetchAndSnapshotSource,
          {
            registryId: source.registryId,
            url: source.canonicalUrl,
          }
        );

        processed++;
        if (result.changed) {
          changed++;
        }
      } catch (error) {
        console.error(`[sourceDiffs] Error processing ${source.registryId}:`, error);
        errors++;
      }
    }

    console.log(
      `[sourceDiffs] Refresh complete: ${processed} processed, ${changed} changed, ${errors} errors`
    );

    return { processed, changed, errors };
  },
});

/**
 * Manually refresh sources from the UI.
 * Default scope is pinned sources to keep costs bounded.
 */
export const refreshSourcesNow = action({
  args: {
    scope: v.optional(v.union(v.literal("pinned"), v.literal("due"), v.literal("all_active"))),
    maxSources: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    scope: "pinned" | "due" | "all_active";
    processed: number;
    changed: number;
    errors: number;
    totalCandidates: number;
    limited: boolean;
  }> => {
    const scope = args.scope ?? "pinned";
    const requestedMax = args.maxSources ?? 20;
    const maxSources = Math.max(1, Math.min(requestedMax, 50));

    const sources =
      scope === "due"
        ? await ctx.runQuery(internal.domains.knowledge.sourceRegistry.getSourcesDueForRefresh, {})
        : scope === "all_active"
          ? await ctx.runQuery(api.domains.knowledge.sourceRegistry.getAllActiveSources, {})
          : await ctx.runQuery(api.domains.knowledge.sourceRegistry.getPinnedSources, {});

    const candidates = sources.slice(0, maxSources);
    let processed = 0;
    let changed = 0;
    let errors = 0;

    for (const source of candidates) {
      try {
        const result = await ctx.runAction(internal.domains.knowledge.sourceDiffs.fetchAndSnapshotSource, {
          registryId: source.registryId,
          url: source.canonicalUrl,
        });
        processed++;
        if (result.changed) changed++;
      } catch (error) {
        console.error(`[sourceDiffs] Manual refresh failed for ${source.registryId}:`, error);
        errors++;
      }
    }

    return {
      scope,
      processed,
      changed,
      errors,
      totalCandidates: sources.length,
      limited: sources.length > candidates.length,
    };
  },
});
