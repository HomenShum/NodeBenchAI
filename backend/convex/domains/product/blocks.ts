/**
 * blocks.ts — Notebook view data derivation
 *
 * This module does NOT introduce new Convex tables yet. Instead it provides a
 * single query that reads existing product tables and derives a Roam/Mew-style
 * notebook snapshot:
 *
 *   - "virtual blocks" derived from productReports.sections + productEntityNotes
 *     + productEvidenceItems (author attribution + inline citation refs)
 *   - routing metadata from productReports.routing + operatorContext
 *   - execution plan trace from productToolEvents (grouped by session + step)
 *   - sources with confidence from productSourceEvents + productReports.sources
 *
 * Once the UI is validated, Phase B of the ultraplan migrates the persisted
 * source of truth to dedicated productBlocks + productBlockRelations tables.
 * Until then this derivation keeps the UI fed without double-writing.
 */

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { mutation, query } from "../../_generated/server";
import {
  resolveEntityWorkspaceAccess,
  requireEntityWorkspaceWriteAccessBySlug,
  requireBlockReadAccessById,
  requireBlockWriteAccessById,
  resolveProductReadOwnerKeys,
  requireProductIdentity,
} from "./helpers";
import { getSystemEntityNodeBySlug } from "../../../../shared/systemIntelligence";
import {
  comparePositions,
  comparePositionsWithId,
  initialPosition,
  positionBetween,
  positionsBetween,
} from "./blockOrdering";
import {
  productBlockAccessValidator,
  productBlockAuthorKindValidator,
  productBlockChipValidator,
  productBlockKindValidator,
  productBlockRelationKindValidator,
} from "./schema";
import { recomputeBlockSearchableText } from "../search/searchableTextRecompute";

// ────────────────────────────────────────────────────────────────────────────
// Input-size guard — prevent a single oversized block from OOMing the function
// runtime or bloating the document. 50 KB is ~10x a typical paragraph and still
// roundtrips cleanly through Convex's 1 MB mutation limit.
// Agentic reliability checklist: BOUND_READ. Agents can paste huge payloads
// from prior tool output; we want a loud ConvexError, not a silent truncation.
const MAX_BLOCK_CONTENT_BYTES = 50_000;
const NOTEBOOK_WRITE_BUCKET_MS = 10_000;
const NOTEBOOK_WRITE_WINDOW_MS = 60_000;
const NOTEBOOK_WRITE_BURST_LIMIT = 300;
const NOTEBOOK_WRITE_LIMIT_PER_MINUTE = 1_200;
const NOTEBOOK_WRITE_SHARDS = 16;
const NOTEBOOK_WRITE_KEY_MAX_LENGTH = 96;

class ProductConvexError<T extends Record<string, unknown>> extends Error {
  name = "ConvexError";
  data: T;

  constructor(data: T) {
    super(JSON.stringify(data));
    this.data = data;
    (this as Record<PropertyKey, unknown>)[Symbol.for("ConvexError")] = true;
  }
}

function convexError<T extends Record<string, unknown>>(data: T): ProductConvexError<T> {
  return new ProductConvexError(data);
}

function isConvexErrorLike(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (Symbol.for("ConvexError") in error ||
      ((error as { name?: unknown }).name === "ConvexError" &&
        "data" in (error as Record<string, unknown>)))
  );
}

function isWriteWindowOccFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("OptimisticConcurrencyControlFailure");
}

function assertBlockContentSize(
  content: unknown,
  context: { blockId?: Id<"productBlocks">; kind?: string },
): void {
  if (content == null) return;
  const serialized = JSON.stringify(content);
  // UTF-8 byte length. Convex functions run in a V8 isolate without Node's
  // `Buffer`, so use `TextEncoder` (which V8 isolates expose natively).
  const bytes = new TextEncoder().encode(serialized).length;
  if (bytes > MAX_BLOCK_CONTENT_BYTES) {
    throw convexError({
      code: "CONTENT_TOO_LARGE",
      bytes,
      max: MAX_BLOCK_CONTENT_BYTES,
      blockId: context.blockId,
      kind: context.kind,
    });
  }
}

function notebookWriteSessionKey(identity: Awaited<ReturnType<typeof requireProductIdentity>>): string {
  // requireProductIdentity throws when ownerKey is null, so at runtime the
  // value is always a string. TS doesn't narrow across throw, so we coerce.
  return identity.anonymousSessionId ?? (identity.ownerKey as string);
}

function notebookWriteShard(shardHint: string): number {
  let hash = 0;
  for (let index = 0; index < shardHint.length; index += 1) {
    hash = (hash * 31 + shardHint.charCodeAt(index)) >>> 0;
  }
  return hash % NOTEBOOK_WRITE_SHARDS;
}

function normalizeNotebookWriteActorKey(value: string, prefix: "actor" | "session"): string {
  const compact = value.trim().replace(/\s+/g, " ");
  const clipped =
    compact.length > NOTEBOOK_WRITE_KEY_MAX_LENGTH
      ? compact.slice(0, NOTEBOOK_WRITE_KEY_MAX_LENGTH)
      : compact;
  return `${prefix}:${clipped || "default"}`;
}

function notebookWriteActorKey(sessionKey: string, actorId?: string): string {
  if (actorId?.trim()) {
    return normalizeNotebookWriteActorKey(actorId, "actor");
  }
  return normalizeNotebookWriteActorKey(sessionKey, "session");
}

function nextAppendPosition(now: number): { int: number; frac: string } {
  // Appends do not need to read sibling ranges. Using a time-based key keeps
  // the path OCC-light under collaboration load, and comparePositionsWithId
  // already provides a deterministic tie-break when two inserts share a
  // millisecond.
  return { int: now * 1000, frac: initialPosition().frac };
}

async function assertNotebookWriteRateLimit(
  ctx: MutationCtx,
  args: {
    ownerKey: string;
    sessionKey: string;
    actorKey?: string;
    operation: string;
    shardHint?: string;
  },
): Promise<void> {
  const now = Date.now();
  const currentBucketStartMs =
    Math.floor(now / NOTEBOOK_WRITE_BUCKET_MS) * NOTEBOOK_WRITE_BUCKET_MS;
  const oldestBucketStartMs =
    currentBucketStartMs - NOTEBOOK_WRITE_WINDOW_MS + NOTEBOOK_WRITE_BUCKET_MS;
  const actorKey = notebookWriteActorKey(args.sessionKey, args.actorKey);

  const recentActorBuckets = await ctx.db
    .query("productBlockWriteWindows")
    .withIndex("by_owner_session_actor_bucket", (q) =>
      q
        .eq("ownerKey", args.ownerKey)
        .eq("sessionKey", args.sessionKey)
        .eq("actorKey", actorKey)
        .gte("bucketStartMs", oldestBucketStartMs),
    )
    .collect();

  const actorTotalWrites = recentActorBuckets.reduce(
    (sum, bucket) => sum + Math.max(bucket.writeCount ?? 0, 0),
    0,
  );
  const actorBucketWrites = recentActorBuckets.reduce(
    (sum, bucket) =>
      bucket.bucketStartMs === currentBucketStartMs
        ? sum + Math.max(bucket.writeCount ?? 0, 0)
        : sum,
    0,
  );
  if (
    actorBucketWrites >= NOTEBOOK_WRITE_BURST_LIMIT ||
    actorTotalWrites >= NOTEBOOK_WRITE_LIMIT_PER_MINUTE
  ) {
    throw convexError({
      code: "RATE_LIMITED",
      scope: "actor",
      actorKey,
      operation: args.operation,
      bucketMs: NOTEBOOK_WRITE_BUCKET_MS,
      windowMs: NOTEBOOK_WRITE_WINDOW_MS,
      burstLimit: NOTEBOOK_WRITE_BURST_LIMIT,
      maxWritesPerWindow: NOTEBOOK_WRITE_LIMIT_PER_MINUTE,
      currentBucketWrites: actorBucketWrites,
      totalWritesInWindow: actorTotalWrites,
      retryAfterMs: currentBucketStartMs + NOTEBOOK_WRITE_BUCKET_MS - now,
    });
  }

  const actorShard = notebookWriteShard(
    `${args.sessionKey}:${actorKey}:${args.operation}:${args.shardHint ?? "default"}`,
  );

  try {
    await ctx.db.insert("productBlockWriteWindows", {
      ownerKey: args.ownerKey,
      sessionKey: args.sessionKey,
      actorKey,
      bucketStartMs: currentBucketStartMs,
      shard: actorShard,
      writeCount: 1,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (isWriteWindowOccFailure(error)) {
      throw convexError({
        code: "RATE_LIMITED",
        scope: "actor",
        actorKey,
        operation: args.operation,
        bucketMs: NOTEBOOK_WRITE_BUCKET_MS,
        windowMs: NOTEBOOK_WRITE_WINDOW_MS,
        burstLimit: NOTEBOOK_WRITE_BURST_LIMIT,
        maxWritesPerWindow: NOTEBOOK_WRITE_LIMIT_PER_MINUTE,
        currentBucketWrites: actorBucketWrites,
        totalWritesInWindow: actorTotalWrites,
        retryAfterMs: NOTEBOOK_WRITE_BUCKET_MS,
        reason: "write_window_conflict",
      });
    }
    throw error;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Types shared with the frontend
// ────────────────────────────────────────────────────────────────────────────

export type NotebookAuthor = "user" | "agent" | "anonymous";

export type NotebookBlockKind =
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "text"
  | "bullet"
  | "todo"
  | "callout"
  | "evidence";

export type NotebookBlock = {
  id: string;
  kind: NotebookBlockKind;
  author: NotebookAuthor;
  authorLabel: string; // e.g. "gemini-3.1-flash (synthesize)", "You · 14h ago"
  body: string;
  sourceRefIds?: string[];
  modelUsed?: string;
  costUsd?: number;
  confidence?: number;
  step?: number;
  revisionLabel?: string;
  href?: string;
  evidenceDomain?: string;
  parentBlockId?: string;
  editedFromAgent?: boolean;
  updatedAt?: number;
};

export type NotebookRouting = {
  mode?: "executive" | "advisor";
  reason?: string;
  source?: "automatic" | "user_forced";
  plannerModel?: string;
  executionModel?: string;
  reasoningEffort?: "medium" | "high";
  operatorLabel?: string;
  operatorHint?: string;
};

export type NotebookPlanStep = {
  step: number;
  tool: string;
  provider?: string;
  model?: string;
  reason?: string;
  status: "running" | "done" | "error";
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  preview?: string;
  costUsd?: number;
  parallel?: boolean;
  parallelGroupSize?: number;
};

export type NotebookPlanTrace = {
  steps: NotebookPlanStep[];
  totalDurationMs?: number;
  totalCostUsd?: number;
  adaptationCount: number;
  milestones: {
    firstStageAt?: number;
    firstSourceAt?: number;
    firstPartialAnswerAt?: number;
  };
};

export type NotebookSource = {
  id: string;
  label: string;
  href?: string;
  domain?: string;
  siteName?: string;
  title?: string;
  publishedAt?: string;
  excerpt?: string;
  confidence?: number;
  faviconUrl?: string;
  thumbnailUrl?: string;
  imageCandidates?: string[];
  supportCount?: number;
};

export type NotebookSourceSummary = {
  averageConfidence?: number;
  corroboratedCount: number;
  unverifiedCount: number;
  highConfidenceCount: number;
};

export type NotebookEntityLink = {
  slug: string;
  name: string;
  entityType: string;
  relation?: string;
  reason?: string;
};

export type NotebookSnapshot = {
  entitySlug: string;
  entityName: string;
  entityType: string;
  firstSeenAt?: number;
  sessionStartedAt?: number;
  reportCount: number;
  noteCount: number;
  routing: NotebookRouting;
  planTrace: NotebookPlanTrace;
  sources: NotebookSource[];
  sourceSummary: NotebookSourceSummary;
  blocks: NotebookBlock[];
  revision?: number;
  reportUpdatedAt?: number;
  lastError?: string;
  linkedFrom: NotebookEntityLink[];
  relatedEntities: NotebookEntityLink[];
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

// Per-tool cost estimate for plan trace display (matches TOOL_COST in server/routes/search.ts).
// TODO: move this into a shared constant both sides read once we wire Phase B.
const TOOL_COST_USD: Record<string, number> = {
  web_search: 0.002,
  linkup_search: 0.002,
  run_recon: 0.003,
  founder_local_gather: 0.0003,
  founder_local_weekly_reset: 0.0003,
  founder_local_synthesize: 0.0003,
  synthesize_packet: 0.003,
  classify_query: 0.0001,
  enrich_entity: 0.001,
};

function costForTool(tool: string, fallback = 0.003): number {
  return TOOL_COST_USD[tool] ?? fallback;
}

function estimatedCost(
  tool: string,
  durationMs?: number,
  tokensIn?: number,
  tokensOut?: number,
): number {
  // If we have token counts, approximate by Gemini Flash pricing
  // ($0.30/M input, $2.50/M output). Otherwise fall back to per-tool constant.
  if (typeof tokensIn === "number" && typeof tokensOut === "number") {
    return (tokensIn * 0.3 + tokensOut * 2.5) / 1_000_000;
  }
  return costForTool(tool);
}

function mapStatus(raw: string | undefined): NotebookPlanStep["status"] {
  if (raw === "error") return "error";
  if (raw === "running") return "running";
  return "done";
}

function domainFromHref(href: string | undefined | null): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function sourceLabelFromHref(href: string | undefined | null): string | undefined {
  const domain = domainFromHref(href);
  if (!domain) return undefined;
  return domain
    .split(".")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => (part.toLowerCase() === "ai" ? "AI" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function blockChipsToPlainText(
  chips: Array<{
    type?: string;
    value?: string;
    mentionTrigger?: string;
  }> | undefined,
): string {
  return (chips ?? [])
    .map((chip) => {
      if (chip.type === "linebreak") return "\n";
      if (chip.type === "mention") {
        return `${chip.mentionTrigger ?? "@"}${chip.value ?? ""}`;
      }
      return chip.value ?? "";
    })
    .join("");
}

function isMeaningfulPersistedBlock(
  block: Pick<Doc<"productBlocks">, "kind" | "content" | "sourceRefIds">,
): boolean {
  const plainText = blockChipsToPlainText(block.content as never).trim();
  if (plainText.length > 0) return true;
  if ((block.sourceRefIds?.length ?? 0) > 0) return true;
  return block.kind === "evidence";
}

function isPlaceholderNotebookBlock(
  block: Pick<Doc<"productBlocks">, "kind" | "authorKind" | "content" | "sourceRefIds">,
): boolean {
  if (block.kind !== "text") return false;
  if (block.authorKind !== "user" && block.authorKind !== "anonymous") return false;
  if ((block.sourceRefIds?.length ?? 0) > 0) return false;
  return blockChipsToPlainText(block.content as never).trim().length === 0;
}

// Simple, deterministic mapping of report-section title to block kind.
function headingKindForSection(title: string): NotebookBlockKind {
  const normalized = title.trim().toLowerCase();
  if (!normalized) return "heading-3";
  // Keep every section heading at H3 inside the synthetic H2 "Prep brief" parent.
  return "heading-3";
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function normalizeConfidence(confidence: number | undefined): number | undefined {
  if (confidence == null || !Number.isFinite(confidence)) return undefined;
  if (confidence > 1 && confidence <= 100) {
    return Number((confidence / 100).toFixed(2));
  }
  return Number(confidence.toFixed(2));
}

function sanitizeRelationSummary(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b(?:Recruiter notes(?: for due diligence)?|Firm site|Co-founders?|Goal|Need)\b:?/gi, "")
    .replace(/\b(?:Additional Context|confirmed|unconfirmed claims?)\b/gi, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(?:and|or|with)\s*$/i, "")
    .replace(/\s+:\s*$/, "")
    .replace(/[:;,.\-–—]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length < 3) return undefined;
  if (/^(?:and|or|with|goal|need|firm site|co-?founders?)$/i.test(cleaned)) return undefined;
  return cleaned.slice(0, 120);
}

function clampMilestoneTimestamp(
  timestamp: number | undefined,
  sessionStartedAt: number | undefined,
  totalDurationMs: number | undefined,
): number | undefined {
  if (timestamp == null || sessionStartedAt == null) return timestamp;
  const lowerBound = sessionStartedAt;
  const upperBound =
    totalDurationMs != null && Number.isFinite(totalDurationMs)
      ? sessionStartedAt + Math.max(totalDurationMs, 0)
      : undefined;
  const normalized = Math.max(timestamp, lowerBound);
  return upperBound != null ? Math.min(normalized, upperBound) : normalized;
}

type FilteredPaginationPage<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string | null;
  splitCursor?: string | null;
  pageStatus?: string;
};

export function liveRowsOnly<T extends { deletedAt?: number | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.deletedAt == null);
}

const PARALLEL_CANDIDATE_TOOLS = new Set([
  "web_search",
  "linkup_search",
  "founder_local_gather",
  "founder_local_weekly_reset",
  "founder_local_synthesize",
  "search_all_knowledge",
]);

const SYSTEM_NOTEBOOK_POST_LIMIT = 240;
const SYSTEM_RELATION_NOISE_PATTERNS = [
  /^product$/i,
  /^sources?$/i,
  /^founder lens/i,
  /^what(?:'s|\s)/i,
  /^how\s/i,
  /^why\s/i,
  /^this\s/i,
  /^these\s/i,
  /industry:/i,
  /\|/,
];

function buildSourceSupportCounts(
  sections: Array<{ sourceRefIds?: string[] }>,
  sources: NotebookSource[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const sourceByLabel = new Map(
    sources
      .map((source) => [source.label.toLowerCase(), source.id] as const)
      .filter((entry) => Boolean(entry[0])),
  );
  for (const section of sections) {
    for (const refId of section.sourceRefIds ?? []) {
      const normalized = refId.trim().toLowerCase();
      const canonical = counts.has(refId)
        ? refId
        : sourceByLabel.get(normalized) ?? refId;
      counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    }
  }
  return counts;
}

function buildSourceSummary(sources: NotebookSource[]): NotebookSourceSummary {
  const withConfidence = sources.filter((source) => typeof source.confidence === "number");
  const averageConfidence =
    withConfidence.length > 0
      ? Number(
          (
            withConfidence.reduce((sum, source) => sum + (source.confidence ?? 0), 0) /
            withConfidence.length
          ).toFixed(2),
        )
      : undefined;
  return {
    averageConfidence,
    corroboratedCount: sources.filter((source) => (source.supportCount ?? 0) > 1).length,
    unverifiedCount: sources.filter(
      (source) => !source.href || source.confidence == null || source.confidence < 0.6,
    ).length,
    highConfidenceCount: sources.filter((source) => (source.confidence ?? 0) >= 0.85).length,
  };
}

function buildSystemNotebookSections(args: {
  entityName: string;
  summary: string;
  relatedCount: number;
  sourceCount: number;
  systemGroup: string;
  latestTitle: string;
  sourceRefIds: string[];
}) {
  return [
    {
      id: "what-it-is",
      title: "What it is",
      body: args.summary,
      sourceRefIds: args.sourceRefIds,
    },
    {
      id: "why-it-matters",
      title: "Why it matters",
      body: `This notebook was projected from archived ${args.systemGroup.toLowerCase()} intelligence and organized into a reusable entity page.`,
      sourceRefIds: args.sourceRefIds,
    },
    {
      id: "source-trace",
      title: "Source trace",
      body: `Latest signal: ${args.latestTitle}. ${args.sourceCount} source${args.sourceCount === 1 ? "" : "s"} linked to ${args.entityName} so far.`,
      sourceRefIds: args.sourceRefIds,
    },
    {
      id: "what-to-do-next",
      title: "What to do next",
      body:
        args.relatedCount > 0
          ? `Walk the linked entities next. There are ${args.relatedCount} connected entities already visible from archived intelligence.`
          : `Open this in Chat and ask what changed, what is missing, or which sources deserve a deeper read.`,
      sourceRefIds: args.sourceRefIds,
    },
  ];
}

function isCleanSystemNotebookRelation(related: {
  name: string;
  entityType: string;
}) {
  if (!["company", "person", "market"].includes(related.entityType)) return false;
  const trimmed = related.name.trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 80) return false;
  if (/https?:\/\//i.test(trimmed)) return false;
  return !SYSTEM_RELATION_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// ────────────────────────────────────────────────────────────────────────────
// Main query
// ────────────────────────────────────────────────────────────────────────────

export const getEntityNotebook = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
  },
  handler: async (ctx, args): Promise<NotebookSnapshot | null> => {
    const workspaceAccess = await resolveEntityWorkspaceAccess(ctx, args);
    const ownerKeys = workspaceAccess
      ? [workspaceAccess.entity.ownerKey]
      : await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return null;

    // 1. Resolve the entity
    let entity: Doc<"productEntities"> | null = workspaceAccess?.entity ?? null;
    let latestReport: Doc<"productReports"> | null = null;
    let dataOwnerKey: string | null = entity?.ownerKey ?? null;
    let systemNode: ReturnType<typeof getSystemEntityNodeBySlug> | null = null;

    if (entity) {
      latestReport = await ctx.db
        .query("productReports")
        .withIndex("by_owner_entity_updated", (q) =>
          q.eq("ownerKey", entity!.ownerKey).eq("entitySlug", args.entitySlug),
        )
        .order("desc")
        .first();
      dataOwnerKey = entity.ownerKey;
    } else {
      for (const ownerKey of ownerKeys) {
        latestReport = await ctx.db
          .query("productReports")
          .withIndex("by_owner_entity_updated", (q) => q.eq("ownerKey", ownerKey).eq("entitySlug", args.entitySlug))
          .order("desc")
          .first();
        if (latestReport) {
          dataOwnerKey = ownerKey;
          break;
        }
      }
    }

    if (!entity && !latestReport) {
      const archivePosts = await ctx.db
        .query("linkedinPostArchive")
        .withIndex("by_postedAt")
        .order("desc")
        .take(SYSTEM_NOTEBOOK_POST_LIMIT);
      systemNode = getSystemEntityNodeBySlug(
        archivePosts.filter((post) => post.target !== "personal"),
        args.entitySlug,
      );
      if (!systemNode) return null;
    }

    // 2. Latest report (most recent by updatedAt)
    // 3. User notes
    const note = entity
      ? await ctx.db
          .query("productEntityNotes")
          .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
          .first()
      : null;
    const noteBlockCount = note?.content
      ? splitNoteIntoBlocks(note.content, note.updatedAt, `note-${note._id}`).length
      : 0;
    const latestSystemTimeline = systemNode?.timeline[0] ?? null;
    const systemSources = latestSystemTimeline
      ? latestSystemTimeline.sourceUrls.map((href, index) => ({
          id: `${latestSystemTimeline.key}-source-${index}`,
          label: latestSystemTimeline.sourceLabels[index] ?? sourceLabelFromHref(href) ?? `Source ${index + 1}`,
          href,
          domain: domainFromHref(href),
          title: latestSystemTimeline.sourceLabels[index] ?? sourceLabelFromHref(href) ?? `Source ${index + 1}`,
          publishedAt: latestSystemTimeline.postedAt ? new Date(latestSystemTimeline.postedAt).toISOString() : undefined,
          confidence: 0.72,
        }))
      : [];
    const systemSections = systemNode
      ? buildSystemNotebookSections({
          entityName: systemNode.name,
          summary: latestSystemTimeline?.summary ?? systemNode.summary,
          relatedCount: systemNode.relatedEntities.filter(isCleanSystemNotebookRelation).length,
          sourceCount: systemSources.length,
          systemGroup: systemNode.systemGroup,
          latestTitle: latestSystemTimeline?.title ?? systemNode.name,
          sourceRefIds: systemSources.map((source) => source.id),
        })
      : [];
    const reportSections = latestReport?.sections ?? systemSections;
    const reportSources = latestReport?.sources ?? systemSources;
    const reportTitle =
      latestReport?.title ??
      latestSystemTimeline?.title ??
      systemNode?.name ??
      "Prep brief";
    const reportRevision = latestReport?.revision ?? systemNode?.latestRevision;
    const reportUpdatedAt = latestReport?.updatedAt ?? latestSystemTimeline?.postedAt;
    const entityName =
      entity?.name ??
      latestReport?.primaryEntity ??
      systemNode?.name ??
      latestReport?.title ??
      args.entitySlug.replace(/[-_]+/g, " ");
    const entityType = entity?.entityType ?? latestReport?.type ?? systemNode?.entityType ?? "entity";
    const entityFirstSeenAt =
      entity?.createdAt ?? latestReport?.createdAt ?? systemNode?.timeline.at(-1)?.postedAt;

    // 4. Evidence for this entity (dedupe with reports later)
    const entityEvidence = entity
      ? await ctx.db
          .query("productEvidenceItems")
          .withIndex("by_owner_entity", (q) => q.eq("ownerKey", dataOwnerKey ?? entity.ownerKey).eq("entityId", entity._id))
          .collect()
      : [];

    // 5. Tool events + source events scoped to the latest session (if we have one)
    const sessionId = latestReport?.sessionId ?? null;
    const toolEvents = sessionId
      ? await ctx.db
          .query("productToolEvents")
          .withIndex("by_session_step", (q) => q.eq("sessionId", sessionId as Id<"productChatSessions">))
          .collect()
      : [];
    const sourceEvents = sessionId
      ? await ctx.db
          .query("productSourceEvents")
          .withIndex("by_session_created", (q) => q.eq("sessionId", sessionId as Id<"productChatSessions">))
          .collect()
      : [];
    const session = sessionId
      ? await ctx.db.get(sessionId as Id<"productChatSessions">)
      : null;
    const [outgoingRelations, incomingRelations] = dataOwnerKey
      ? await Promise.all([
          ctx.db
            .query("productEntityRelations")
            .withIndex("by_owner_from", (q) => q.eq("ownerKey", dataOwnerKey!).eq("fromEntitySlug", args.entitySlug))
            .collect(),
          ctx.db
            .query("productEntityRelations")
            .withIndex("by_owner_to", (q) => q.eq("ownerKey", dataOwnerKey!).eq("toEntitySlug", args.entitySlug))
            .collect(),
        ])
      : [[], []];

    // ──────────────────────────────────────────────────────────────────────
    // Build routing block
    // ──────────────────────────────────────────────────────────────────────
    const routing: NotebookRouting = {
      mode: latestReport?.routing?.routingMode ?? (systemNode ? "advisor" : undefined),
      reason:
        latestReport?.routing?.routingReason ??
        (systemNode ? "Projected from archived system intelligence." : undefined),
      source: latestReport?.routing?.routingSource ?? (systemNode ? "automatic" : undefined),
      plannerModel: latestReport?.routing?.plannerModel ?? (systemNode ? "system-archive" : undefined),
      executionModel: latestReport?.routing?.executionModel ?? (systemNode ? "system-archive" : undefined),
      reasoningEffort: latestReport?.routing?.reasoningEffort ?? (systemNode ? "medium" : undefined),
      operatorLabel:
        latestReport?.operatorContext?.label ??
        session?.operatorContext?.label ??
        (systemNode ? "System intelligence" : undefined),
      operatorHint:
        latestReport?.operatorContext?.hint ??
        session?.operatorContext?.hint ??
        systemNode?.systemGroup,
    };

    // ──────────────────────────────────────────────────────────────────────
    // Build plan trace
    // ──────────────────────────────────────────────────────────────────────
    const sortedToolEvents = toolEvents.slice().sort((a, b) => a.step - b.step);
    const parallelGroupSize = sortedToolEvents.filter((event) => PARALLEL_CANDIDATE_TOOLS.has(event.tool)).length;
    const sessionStartedAt = session?.createdAt;
    const totalDurationMs = session?.totalDurationMs;
    const firstStageAt = clampMilestoneTimestamp(
      sortedToolEvents[0]?.startedAt ?? sessionStartedAt,
      sessionStartedAt,
      totalDurationMs,
    );
    const firstSourceAt = clampMilestoneTimestamp(
      sourceEvents.slice().sort((a, b) => a.createdAt - b.createdAt)[0]?.createdAt,
      sessionStartedAt,
      totalDurationMs,
    );
    const firstPartialAnswerAt = clampMilestoneTimestamp(
      sortedToolEvents.find((event) => event.tool === "synthesize_packet" || event.tool === "package")?.updatedAt ??
        sortedToolEvents[sortedToolEvents.length - 1]?.updatedAt ??
        session?.updatedAt,
      sessionStartedAt,
      totalDurationMs,
    );

    const planSteps: NotebookPlanStep[] =
      sortedToolEvents.length > 0
        ? sortedToolEvents.map((event) => {
            const costUsd = Number(
              estimatedCost(event.tool, event.durationMs, event.tokensIn, event.tokensOut).toFixed(4),
            );
            const parallel = PARALLEL_CANDIDATE_TOOLS.has(event.tool) && parallelGroupSize > 1;
            return {
              step: event.step,
              tool: event.tool,
              provider: event.provider,
              model: event.model,
              reason: event.reason,
              status: mapStatus(event.status),
              durationMs: event.durationMs,
              tokensIn: event.tokensIn,
              tokensOut: event.tokensOut,
              preview: event.preview ? truncate(event.preview, 140) : undefined,
              costUsd,
              parallel,
              parallelGroupSize: parallel ? parallelGroupSize : undefined,
            };
          })
        : systemNode
          ? [
              {
                step: 1,
                tool: "project_system_intelligence",
                model: "system-archive",
                reason: "Projected archived LinkedIn organization posts into a reusable notebook snapshot.",
                status: "done",
                preview: latestSystemTimeline?.title ?? systemNode.name,
              },
            ]
          : [];

    const totalCostUsd = planSteps.reduce(
      (acc, step) => acc + estimatedCost(step.tool, step.durationMs, step.tokensIn, step.tokensOut),
      0,
    );

    const planTrace: NotebookPlanTrace = {
      steps: planSteps,
      totalDurationMs,
      totalCostUsd: planSteps.length > 0 ? Number(totalCostUsd.toFixed(4)) : undefined,
      adaptationCount: 0, // Not persisted yet — placeholder, comes from harness execution.adaptations
      milestones: {
        firstStageAt,
        firstSourceAt,
        firstPartialAnswerAt,
      },
    };

    // ──────────────────────────────────────────────────────────────────────
    // Build sources list
    // ──────────────────────────────────────────────────────────────────────
    // Prefer sourceEvents (richer, with confidence) and fall back to the
    // sources embedded in the report.
    const sourceMap = new Map<string, NotebookSource>();
    for (const reportSource of reportSources) {
      sourceMap.set(reportSource.id, {
        id: reportSource.id,
        label: reportSource.label,
        href: reportSource.href,
        domain: reportSource.domain ?? domainFromHref(reportSource.href),
        siteName: reportSource.siteName,
        title: reportSource.title ?? reportSource.label,
        publishedAt: reportSource.publishedAt,
        excerpt: reportSource.excerpt,
        confidence: normalizeConfidence(reportSource.confidence),
        faviconUrl: reportSource.faviconUrl,
        thumbnailUrl: reportSource.thumbnailUrl,
        imageCandidates: reportSource.imageCandidates,
      });
    }
    for (const sourceEvent of sourceEvents) {
      // If we've already got a richer entry from the report sources, only
      // upgrade confidence/excerpt if the report omitted them.
      const existing = sourceMap.get(sourceEvent.sourceKey);
      if (existing) {
        if (existing.confidence == null && sourceEvent.confidence != null) {
          existing.confidence = normalizeConfidence(sourceEvent.confidence);
        }
        if (!existing.excerpt && sourceEvent.excerpt) {
          existing.excerpt = sourceEvent.excerpt;
        }
        if (!existing.title && sourceEvent.title) {
          existing.title = sourceEvent.title;
        }
        if (!existing.thumbnailUrl && sourceEvent.thumbnailUrl) {
          existing.thumbnailUrl = sourceEvent.thumbnailUrl;
        }
        if ((!existing.imageCandidates || existing.imageCandidates.length === 0) && sourceEvent.imageCandidates) {
          existing.imageCandidates = sourceEvent.imageCandidates.slice(0, 4);
        }
        continue;
      }
      sourceMap.set(sourceEvent.sourceKey, {
        id: sourceEvent.sourceKey,
        label: sourceEvent.label,
        href: sourceEvent.href,
        domain: sourceEvent.domain ?? domainFromHref(sourceEvent.href),
        siteName: sourceEvent.siteName,
        title: sourceEvent.title ?? sourceEvent.label,
        publishedAt: sourceEvent.publishedAt,
        excerpt: sourceEvent.excerpt,
        confidence: normalizeConfidence(sourceEvent.confidence),
        faviconUrl: sourceEvent.faviconUrl,
        thumbnailUrl: sourceEvent.thumbnailUrl,
        imageCandidates: sourceEvent.imageCandidates?.slice(0, 4),
      });
    }
    const sourceSupportCounts = buildSourceSupportCounts(reportSections, Array.from(sourceMap.values()));
    const sources = Array.from(sourceMap.values()).map((source) => ({
      ...source,
      supportCount: sourceSupportCounts.get(source.id) ?? sourceSupportCounts.get(source.label) ?? 0,
    }));
    const sourceSummary = buildSourceSummary(sources);

    // ──────────────────────────────────────────────────────────────────────
    // Build the derived block list
    // ──────────────────────────────────────────────────────────────────────
    const blocks: NotebookBlock[] = [];

    // (a) Synthetic "Prep brief" H2 block that parents the report sections.
    const finalSynthesizeStep =
      [...planSteps].reverse().find((step) => step.tool === "synthesize_packet") ??
      planSteps[planSteps.length - 1];

    if (latestReport || systemNode) {
      const briefParentId = latestReport
        ? `brief-heading-${latestReport._id}`
        : `brief-heading-system-${args.entitySlug}`;
      blocks.push({
        id: briefParentId,
        kind: "heading-2",
        author: "agent",
        authorLabel: routing.executionModel
          ? `${routing.executionModel} · synthesize`
          : "agent · synthesize",
        body: reportTitle,
        modelUsed: routing.executionModel,
        step: finalSynthesizeStep?.step,
        updatedAt: reportUpdatedAt,
      });

      // (b) Each report section becomes a heading block + a body block.
      for (const section of reportSections) {
        const sectionKey = latestReport
          ? `${latestReport._id}-${section.id}`
          : `system-${args.entitySlug}-${section.id}`;
        blocks.push({
          id: `section-h-${sectionKey}`,
          kind: headingKindForSection(section.title),
          author: "agent",
          authorLabel: routing.executionModel ?? "agent",
          body: section.title,
          parentBlockId: briefParentId,
          step: finalSynthesizeStep?.step,
          updatedAt: reportUpdatedAt,
        });
        blocks.push({
          id: `section-b-${sectionKey}`,
          kind: "text",
          author: "agent",
          authorLabel: routing.executionModel
            ? `${routing.executionModel} · ${reportUpdatedAt ? "rev " + (reportRevision ?? 1) : "synthesize"}`
            : "agent",
          body: section.body,
          sourceRefIds: section.sourceRefIds,
          modelUsed: routing.executionModel,
          costUsd: planSteps.length > 0 ? Number((totalCostUsd / Math.max(1, reportSections.length)).toFixed(4)) : undefined,
          confidence: computeSectionConfidence(section.sourceRefIds, sources),
          step: finalSynthesizeStep?.step,
          revisionLabel:
            (reportRevision ?? 1) > 1
              ? `rev ${reportRevision ?? 1}${latestReport?.previousReportId ? " (was AI)" : ""}`
              : undefined,
          parentBlockId: `section-h-${sectionKey}`,
          updatedAt: reportUpdatedAt,
        });
      }
    }

    // (c) Evidence blocks — indented after the brief
    const fallbackEvidence =
      entityEvidence.length === 0 && systemNode
        ? systemSources.map((source, index) => ({
            _id: (`system-evidence-${args.entitySlug}-${index}` as unknown) as Id<"productEvidenceItems">,
            label: source.label,
            sourceUrl: source.href,
            updatedAt: reportUpdatedAt ?? Date.now(),
          }))
        : [];
    for (const item of entityEvidence.length > 0 ? entityEvidence : fallbackEvidence) {
      if (!item.sourceUrl && !item.label) continue;
      blocks.push({
        id: `evidence-${item._id}`,
        kind: "evidence",
        author: "agent",
        authorLabel: "harness · evidence",
        body: item.label,
        href: item.sourceUrl,
        evidenceDomain: domainFromHref(item.sourceUrl),
        confidence: confidenceFromEvidence(item, sources),
        updatedAt: item.updatedAt,
      });
    }

    // (d) User's working notes — split on blank lines into text blocks,
    // keep bullets as bullet blocks. Simple rules good enough for derivation.
    if (note?.content) {
      const noteBlocks = splitNoteIntoBlocks(note.content, note.updatedAt, `note-${note._id}`);
      blocks.push({
        id: `note-heading-${note._id}`,
        kind: "heading-2",
        author: "user",
        authorLabel: "You",
        body: "My working notes",
        updatedAt: note.updatedAt,
      });
      blocks.push(...noteBlocks);
    }

    const relatedEntityLookups = new Map<string, Doc<"productEntities"> | null>();
    const relationTargets = Array.from(
      new Set(
        [...outgoingRelations.map((relation) => relation.toEntitySlug), ...incomingRelations.map((relation) => relation.fromEntitySlug)].filter(
          (slug) => slug && slug !== args.entitySlug,
        ),
      ),
    );
    if (dataOwnerKey) {
      await Promise.all(
        relationTargets.map(async (slug) => {
          const related = await ctx.db
            .query("productEntities")
            .withIndex("by_owner_slug", (q) => q.eq("ownerKey", dataOwnerKey!).eq("slug", slug))
            .first();
          relatedEntityLookups.set(slug, related);
        }),
      );
    }

    const relatedEntities = outgoingRelations.reduce<NotebookEntityLink[]>((acc, relation) => {
      const related = relatedEntityLookups.get(relation.toEntitySlug);
      if (!related) return acc;
      const summary = sanitizeRelationSummary(relation.summary);
      acc.push({
        slug: related.slug,
        name: related.name,
        entityType: related.entityType,
        relation: relation.relation,
        reason:
          summary && summary.toLowerCase() !== related.name.toLowerCase()
            ? summary
            : relation.relation,
      });
      return acc;
    }, systemNode
      ? systemNode.relatedEntities
          .filter(isCleanSystemNotebookRelation)
          .map((related) => ({
            slug: related.slug,
            name: related.name,
            entityType: related.entityType,
            relation: "related",
            reason: related.reason,
          }))
      : []);

    const linkedFrom = incomingRelations.reduce<NotebookEntityLink[]>((acc, relation) => {
      const related = relatedEntityLookups.get(relation.fromEntitySlug);
      if (!related) return acc;
      const summary = sanitizeRelationSummary(relation.summary);
      acc.push({
        slug: related.slug,
        name: related.name,
        entityType: related.entityType,
        relation: relation.relation,
        reason:
          summary && summary.toLowerCase() !== related.name.toLowerCase()
            ? summary
            : relation.relation,
      });
      return acc;
    }, []);

    return {
      entitySlug: args.entitySlug,
      entityName,
      entityType,
      firstSeenAt: entityFirstSeenAt,
      sessionStartedAt: session?.createdAt,
      reportCount: entity?.reportCount ?? systemNode?.reportCount ?? (latestReport ? 1 : 0),
      noteCount: noteBlockCount,
      routing,
      planTrace,
      sources,
      sourceSummary,
      blocks,
      revision: reportRevision ?? undefined,
      reportUpdatedAt,
      lastError: session?.lastError,
      linkedFrom,
      relatedEntities,
    };
  },
});

// Weighted confidence across the sources cited by a section.
function computeSectionConfidence(
  sourceRefIds: string[] | undefined,
  sources: NotebookSource[],
): number | undefined {
  if (!sourceRefIds || sourceRefIds.length === 0) return undefined;
  const lookup = new Map(sources.map((source) => [source.id, source]));
  let sum = 0;
  let count = 0;
  for (const refId of sourceRefIds) {
    const source = lookup.get(refId);
    if (source?.confidence != null) {
      sum += source.confidence;
      count += 1;
    }
  }
  return count === 0 ? undefined : Number((sum / count).toFixed(2));
}

// When the evidence item's sourceUrl matches one of our source events,
// we can pull the confidence. Otherwise it stays undefined.
function confidenceFromEvidence(
  item: Doc<"productEvidenceItems">,
  sources: NotebookSource[],
): number | undefined {
  if (!item.sourceUrl) return undefined;
  const match = sources.find((source) => source.href === item.sourceUrl);
  return match?.confidence;
}

// ────────────────────────────────────────────────────────────────────────────
// Persisted block queries + mutations (Phase 1-4 of the ultraplan)
// These operate on the productBlocks table directly; once migration from
// productReports is complete, getEntityNotebook above will delegate here.
// ────────────────────────────────────────────────────────────────────────────

/**
 * List persisted blocks for an entity (ordered by positionInt, positionFrac).
 * Returns [] if no blocks exist yet (caller falls back to the derivation path).
 */
export const listEntityBlocks = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<"productBlocks">[]> => {
    const workspaceAccess = await resolveEntityWorkspaceAccess(ctx, args);
    const entity = workspaceAccess?.entity ?? null;
    if (!entity) return [];

    const rows = await ctx.db
      .query("productBlocks")
      .withIndex("by_owner_entity_position", (q) =>
        q.eq("ownerKey", entity.ownerKey).eq("entityId", entity._id),
      )
      .collect();

    return liveRowsOnly(rows);
  },
});

export const listEntityBlocksPaginated = (query as any)({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const workspaceAccess = await resolveEntityWorkspaceAccess(ctx, args);
    const entity = workspaceAccess?.entity ?? null;
    if (!entity) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const page = await ctx.db
      .query("productBlocks")
      .withIndex("by_owner_entity_position", (q: any) =>
        q.eq("ownerKey", entity!.ownerKey).eq("entityId", entity!._id),
      )
      .filter((q: any) => q.eq(q.field("deletedAt"), undefined))
      .paginate(args.paginationOpts);

    return {
      page: page.page,
      isDone: Boolean(page.isDone),
      continueCursor: typeof page.continueCursor === "string" ? page.continueCursor : "",
      splitCursor:
        typeof page.splitCursor === "string" || page.splitCursor === null ? page.splitCursor : null,
      pageStatus:
        page.pageStatus === "SplitRecommended" || page.pageStatus === "SplitRequired"
          ? page.pageStatus
          : null,
    };
  },
});

export const getEntityBlockSummary = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | null
    | {
        blockCount: number;
        userEditedCount: number;
        latestUpdatedAt?: number;
        latestUserEditAt?: number;
        latestHumanEditorOwnerKey?: string;
        latestHumanEditorUpdatedAt?: number;
      }
  > => {
    const workspaceAccess = await resolveEntityWorkspaceAccess(ctx, args);
    const entity = workspaceAccess?.entity ?? null;
    if (!entity) return null;

    const rows = await ctx.db
      .query("productBlocks")
      .withIndex("by_owner_entity", (q) => q.eq("ownerKey", entity.ownerKey).eq("entityId", entity._id))
      .collect();
    const liveRows = liveRowsOnly(rows);
    const userRows = liveRows.filter((row) => row.authorKind === "user");
    const humanRows = liveRows.filter(
      (row) => row.authorKind === "user" || row.authorKind === "anonymous",
    );
    const latestHumanRow = humanRows.reduce<(typeof humanRows)[number] | undefined>(
      (latest, row) => (latest == null || row.updatedAt > latest.updatedAt ? row : latest),
      undefined,
    );
    const latestHumanEditorOwnerKey =
      latestHumanRow?.authorKind === "user" && latestHumanRow.authorId
        ? `user:${latestHumanRow.authorId}`
        : latestHumanRow?.authorKind === "anonymous" && latestHumanRow.authorId
          ? `anon:${latestHumanRow.authorId}`
          : undefined;
    return {
      blockCount: liveRows.length,
      userEditedCount: userRows.length,
      latestUpdatedAt: liveRows.reduce<number | undefined>(
        (latest, row) => (latest == null || row.updatedAt > latest ? row.updatedAt : latest),
        undefined,
      ),
      latestUserEditAt: userRows.reduce<number | undefined>(
        (latest, row) => (latest == null || row.updatedAt > latest ? row.updatedAt : latest),
        undefined,
      ),
      latestHumanEditorOwnerKey,
      latestHumanEditorUpdatedAt: latestHumanRow?.updatedAt,
    };
  },
});

/**
 * Append a new block at the end of the current block list (or at the end of a
 * specific parent's children). Used by slash commands + user "add block" action.
 */
export const appendBlock = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
    parentBlockId: v.optional(v.id("productBlocks")),
    kind: productBlockKindValidator,
    content: v.array(productBlockChipValidator),
    authorKind: productBlockAuthorKindValidator,
    authorId: v.optional(v.string()),
    sourceSessionId: v.optional(v.id("productChatSessions")),
    sourceToolStep: v.optional(v.number()),
    sourceRefIds: v.optional(v.array(v.string())),
    accessMode: v.optional(productBlockAccessValidator),
    attributes: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"productBlocks">> => {
    assertBlockContentSize(args.content, { kind: args.kind });
    const access = await requireEntityWorkspaceWriteAccessBySlug(ctx, args);
    const { entity, identity } = access;
    const sessionKey = notebookWriteSessionKey(identity);
    const actorKey = notebookWriteActorKey(sessionKey, args.authorId);
    let id: Id<"productBlocks">;
    try {
      await assertNotebookWriteRateLimit(ctx, {
        ownerKey: identity.ownerKey,
        sessionKey,
        actorKey: args.authorId,
        operation: "appendBlock",
        shardHint: `${args.authorId ?? "anon"}:${args.parentBlockId ?? "root"}`,
      });
      const now = Date.now();
      const nextPos = nextAppendPosition(now);
      id = await ctx.db.insert("productBlocks", {
        ownerKey: entity.ownerKey,
        entityId: entity._id,
        parentBlockId: args.parentBlockId,
        kind: args.kind,
        authorKind: args.authorKind,
        authorId: args.authorId,
        content: args.content,
        positionInt: nextPos.int,
        positionFrac: nextPos.frac,
        accessMode: args.accessMode ?? "edit",
        isPublic: false,
        sourceSessionId: args.sourceSessionId,
        sourceToolStep: args.sourceToolStep,
        sourceRefIds: args.sourceRefIds,
        attributes: args.attributes,
        revision: 1,
        // PR D: populate searchableText for the federated `search_blocks`
        // index. Inserts at PR #310 ship time were missing this.
        searchableText: recomputeBlockSearchableText({
          content: args.content,
          deletedAt: undefined,
        }),
        createdAt: now,
        updatedAt: now,
      });
      // PR E: schedule per-row embedding for the new block.
      await ctx.scheduler.runAfter(
        0,
        internal.domains.search.embedRowOnUpdate.embedBlockRow,
        { blockId: id },
      );
    } catch (error) {
      if (isWriteWindowOccFailure(error)) {
        throw convexError({
          code: "RATE_LIMITED",
          scope: "actor",
          actorKey,
          operation: "appendBlock",
          bucketMs: NOTEBOOK_WRITE_BUCKET_MS,
          windowMs: NOTEBOOK_WRITE_WINDOW_MS,
          burstLimit: NOTEBOOK_WRITE_BURST_LIMIT,
          maxWritesPerWindow: NOTEBOOK_WRITE_LIMIT_PER_MINUTE,
          retryAfterMs: NOTEBOOK_WRITE_BUCKET_MS,
          reason: "write_window_conflict",
        });
      }
      if (isConvexErrorLike(error)) throw error;
      throw convexError({
        code: "APPEND_BLOCK_INSERT_ERROR",
        stage: "insert",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return id;
  },
});

/**
 * Insert a block strictly between two siblings. Used when the user presses
 * Enter mid-list or the agent inserts a thought in a specific position.
 */
export const insertBlockBetween = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
    beforeBlockId: v.optional(v.id("productBlocks")),
    afterBlockId: v.optional(v.id("productBlocks")),
    parentBlockId: v.optional(v.id("productBlocks")),
    kind: productBlockKindValidator,
    content: v.array(productBlockChipValidator),
    authorKind: productBlockAuthorKindValidator,
    authorId: v.optional(v.string()),
    sourceRefIds: v.optional(v.array(v.string())),
    attributes: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<Id<"productBlocks">> => {
    assertBlockContentSize(args.content, { kind: args.kind });
    const access = await requireEntityWorkspaceWriteAccessBySlug(ctx, args);
    const { entity, identity } = access;
    await assertNotebookWriteRateLimit(ctx, {
      ownerKey: identity.ownerKey,
      sessionKey: notebookWriteSessionKey(identity),
      actorKey: args.authorId,
      operation: "insertBlockBetween",
      shardHint: `${args.authorId ?? "anon"}:${args.beforeBlockId ?? "none"}:${args.afterBlockId ?? "none"}`,
    });

    const before = args.beforeBlockId ? await ctx.db.get(args.beforeBlockId) : null;
    const after = args.afterBlockId ? await ctx.db.get(args.afterBlockId) : null;
    const beforePos = before ? { int: before.positionInt, frac: before.positionFrac } : null;
    const afterPos = after ? { int: after.positionInt, frac: after.positionFrac } : null;
    const nextPos = positionBetween(beforePos, afterPos);

    const now = Date.now();
    const blockId = await ctx.db.insert("productBlocks", {
      ownerKey: entity.ownerKey,
      entityId: entity._id,
      parentBlockId: args.parentBlockId,
      kind: args.kind,
      authorKind: args.authorKind,
      authorId: args.authorId,
      content: args.content,
      positionInt: nextPos.int,
      positionFrac: nextPos.frac,
      accessMode: "edit",
      isPublic: false,
      sourceRefIds: args.sourceRefIds,
      attributes: args.attributes,
      revision: 1,
      // PR D: populate searchableText for the federated `search_blocks` index.
      searchableText: recomputeBlockSearchableText({
        content: args.content,
        deletedAt: undefined,
      }),
      createdAt: now,
      updatedAt: now,
    });
    // PR E: schedule per-row embedding for the inserted block.
    await ctx.scheduler.runAfter(
      0,
      internal.domains.search.embedRowOnUpdate.embedBlockRow,
      { blockId },
    );
    return blockId;
  },
});

export type GuardedBlockInsertDraft = {
  kind: Doc<"productBlocks">["kind"];
  content: Doc<"productBlocks">["content"];
  sourceRefIds?: string[];
  attributes?: Doc<"productBlocks">["attributes"];
};

export type GuardedBlockBatchInsertArgs = {
  entityId: Id<"productEntities">;
  targetBlockId: Id<"productBlocks">;
  expectedTargetRevision: number;
  beforeDrafts: GuardedBlockInsertDraft[];
  afterDrafts: GuardedBlockInsertDraft[];
};

export type GuardedBlockBatchInsertResult = {
  targetBlockId: Id<"productBlocks">;
  insertedBlockIds: Id<"productBlocks">[];
  orderedBlockIds: Id<"productBlocks">[];
  lastBlockId: Id<"productBlocks">;
};

/**
 * Owner-only, transaction-safe materialization for an already-approved block
 * plan. The target supplies entity, parent, and ordering context; callers
 * cannot smuggle cross-notebook anchors or authorship through the batch.
 */
export async function applyGuardedBlockBatchInsert(
  ctx: MutationCtx,
  args: GuardedBlockBatchInsertArgs,
): Promise<GuardedBlockBatchInsertResult> {
  const drafts = [...args.beforeDrafts, ...args.afterDrafts];
  if (drafts.length > 50) {
    throw convexError({
      code: "BLOCK_BATCH_TOO_LARGE",
      maxBlocks: 50,
      actualBlocks: drafts.length,
    });
  }
  const batchBytes = new TextEncoder().encode(JSON.stringify(drafts)).length;
  if (batchBytes > 500_000) {
    throw convexError({
      code: "BLOCK_BATCH_BYTES_EXCEEDED",
      maxBytes: 500_000,
      actualBytes: batchBytes,
    });
  }
  for (const draft of drafts) {
    assertBlockContentSize(draft.content, { kind: draft.kind });
  }

  const access = await requireBlockWriteAccessById(ctx, {
    blockId: args.targetBlockId,
  });
  const { block: target, entity, identity, mode } = access;
  if (
    mode !== "owner" ||
    entity._id !== args.entityId ||
    target.entityId !== args.entityId ||
    target.ownerKey !== identity.ownerKey ||
    target.accessMode !== "edit"
  ) {
    throw new Error("Writable notebook block not found");
  }
  if (
    !Number.isSafeInteger(args.expectedTargetRevision) ||
    target.revision !== args.expectedTargetRevision
  ) {
    throw convexError({
      code: "REVISION_MISMATCH",
      blockId: args.targetBlockId,
      expectedRevision: args.expectedTargetRevision,
      actualRevision: target.revision,
    });
  }

  const siblings = await ctx.db
    .query("productBlocks")
    .withIndex("by_entity_position", (q) =>
      q.eq("entityId", args.entityId).eq("parentBlockId", target.parentBlockId),
    )
    .take(501);
  if (siblings.length > 500) {
    throw convexError({
      code: "BLOCK_SIBLING_READ_LIMIT",
      maxSiblings: 500,
      reason: "fail_closed_before_batch_insert",
    });
  }
  const orderedSiblings = siblings
    .filter((block) => block.deletedAt === undefined)
    .sort((left, right) =>
      comparePositionsWithId(
        { int: left.positionInt, frac: left.positionFrac, id: String(left._id) },
        { int: right.positionInt, frac: right.positionFrac, id: String(right._id) },
      ),
    );
  const targetIndex = orderedSiblings.findIndex(
    (block) => block._id === args.targetBlockId,
  );
  if (targetIndex < 0) {
    throw new Error("Writable notebook block not found");
  }
  const previous = orderedSiblings[targetIndex - 1] ?? null;
  const next = orderedSiblings[targetIndex + 1] ?? null;
  const targetPosition = {
    int: target.positionInt,
    frac: target.positionFrac,
  };
  const beforePositions = positionsBetween(
    previous
      ? { int: previous.positionInt, frac: previous.positionFrac }
      : null,
    targetPosition,
    args.beforeDrafts.length,
  );
  const afterPositions = positionsBetween(
    targetPosition,
    next ? { int: next.positionInt, frac: next.positionFrac } : null,
    args.afterDrafts.length,
  );

  const insertAt = async (
    draft: GuardedBlockInsertDraft,
    position: { int: number; frac: string },
    index: number,
  ): Promise<Id<"productBlocks">> => {
    await assertNotebookWriteRateLimit(ctx, {
      ownerKey: identity.ownerKey,
      sessionKey: notebookWriteSessionKey(identity),
      actorKey: identity.ownerKey,
      operation: "applyGuardedBlockBatchInsert",
      shardHint: `${args.targetBlockId}:${index}`,
    });
    const now = Date.now();
    const blockId = await ctx.db.insert("productBlocks", {
      ownerKey: entity.ownerKey,
      entityId: entity._id,
      parentBlockId: target.parentBlockId,
      kind: draft.kind,
      authorKind: "user",
      authorId: identity.ownerKey,
      content: draft.content,
      positionInt: position.int,
      positionFrac: position.frac,
      accessMode: "edit",
      isPublic: false,
      sourceRefIds: draft.sourceRefIds,
      attributes: draft.attributes,
      revision: 1,
      searchableText: recomputeBlockSearchableText({
        content: draft.content,
        deletedAt: undefined,
      }),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.domains.search.embedRowOnUpdate.embedBlockRow,
      { blockId },
    );
    return blockId;
  };

  const beforeBlockIds: Id<"productBlocks">[] = [];
  for (let index = 0; index < args.beforeDrafts.length; index += 1) {
    beforeBlockIds.push(
      await insertAt(args.beforeDrafts[index]!, beforePositions[index]!, index),
    );
  }
  const afterBlockIds: Id<"productBlocks">[] = [];
  for (let index = 0; index < args.afterDrafts.length; index += 1) {
    afterBlockIds.push(
      await insertAt(
        args.afterDrafts[index]!,
        afterPositions[index]!,
        args.beforeDrafts.length + index,
      ),
    );
  }
  const insertedBlockIds = [...beforeBlockIds, ...afterBlockIds];
  return {
    targetBlockId: target._id,
    insertedBlockIds,
    orderedBlockIds: [...beforeBlockIds, target._id, ...afterBlockIds],
    lastBlockId: afterBlockIds.at(-1) ?? target._id,
  };
}

/**
 * Update a block's content (or a subset of fields). Creates a previousBlockId
 * chain so the agent-generated version isn't lost when the user rewrites.
 */
export type GuardedBlockUpdateArgs = {
  anonymousSessionId?: string;
  shareToken?: string;
  blockId: Id<"productBlocks">;
  content?: Doc<"productBlocks">["content"];
  kind?: Doc<"productBlocks">["kind"];
  isChecked?: boolean;
  sourceRefIds?: string[];
  attributes?: Doc<"productBlocks">["attributes"];
  forkHistory?: boolean;
  editedByAuthorKind?: Doc<"productBlocks">["authorKind"];
  editedByAuthorId?: string;
  expectedRevision?: number;
};

export type GuardedBlockUpdateResult = {
  blockId: Id<"productBlocks">;
  ownerKey: string;
  beforeRevision: number;
  afterRevision: number;
  beforeContent: Doc<"productBlocks">["content"];
  afterContent: Doc<"productBlocks">["content"];
  previousBlockId?: Id<"productBlocks">;
};

/**
 * Shared guarded block-write primitive. Authority workflows call this from
 * the same transaction as their live grant check and receipt insert, so a
 * delegated edit cannot bypass notebook ownership, limits, OCC, history,
 * search, or embedding invariants.
 */
export async function applyGuardedBlockUpdate(
  ctx: MutationCtx,
  args: GuardedBlockUpdateArgs,
): Promise<GuardedBlockUpdateResult> {
  assertBlockContentSize(args.content, { blockId: args.blockId, kind: args.kind });
  const { block: existing, identity } = await requireBlockWriteAccessById(ctx, args);
  await assertNotebookWriteRateLimit(ctx, {
    ownerKey: identity.ownerKey,
    sessionKey: notebookWriteSessionKey(identity),
    actorKey: args.editedByAuthorId,
    operation: "updateBlock",
    shardHint: `${args.editedByAuthorId ?? "anon"}:${args.blockId}`,
  });
  if (existing.accessMode !== "edit") {
    throw convexError({ code: "BLOCK_READ_ONLY", blockId: args.blockId });
  }
  if (
    typeof args.expectedRevision === "number" &&
    args.expectedRevision !== existing.revision
  ) {
    throw convexError({
      code: "REVISION_MISMATCH",
      blockId: args.blockId,
      current: existing.revision,
      expected: args.expectedRevision,
    });
  }

  const now = Date.now();
  let previousBlockId: Id<"productBlocks"> | undefined;
  if (args.forkHistory) {
    previousBlockId = await ctx.db.insert("productBlocks", {
      ownerKey: existing.ownerKey,
      entityId: existing.entityId,
      parentBlockId: existing.parentBlockId,
      kind: existing.kind,
      authorKind: existing.authorKind,
      authorId: existing.authorId,
      content: existing.content,
      positionInt: existing.positionInt,
      positionFrac: existing.positionFrac,
      isChecked: existing.isChecked,
      accessMode: existing.accessMode,
      isPublic: existing.isPublic,
      sourceSessionId: existing.sourceSessionId,
      sourceToolStep: existing.sourceToolStep,
      sourceRefIds: existing.sourceRefIds,
      attributes: existing.attributes,
      previousBlockId: existing.previousBlockId,
      revision: existing.revision,
      deletedAt: now,
      searchableText: "",
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    });
  }

  const nextContent = args.content ?? existing.content;
  const nextBlockSearchableText = recomputeBlockSearchableText({
    content: nextContent,
    deletedAt: undefined,
  });
  const afterRevision = existing.revision + 1;
  await ctx.db.patch(args.blockId, {
    content: nextContent,
    kind: args.kind ?? existing.kind,
    isChecked: args.isChecked ?? existing.isChecked,
    sourceRefIds: args.sourceRefIds ?? existing.sourceRefIds,
    attributes: args.attributes ?? existing.attributes,
    previousBlockId: previousBlockId ?? existing.previousBlockId,
    revision: afterRevision,
    authorKind: args.editedByAuthorKind ?? existing.authorKind,
    authorId: args.editedByAuthorId ?? existing.authorId,
    searchableText: nextBlockSearchableText,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.domains.search.embedRowOnUpdate.embedBlockRow,
    { blockId: args.blockId },
  );
  return {
    blockId: args.blockId,
    ownerKey: identity.ownerKey,
    beforeRevision: existing.revision,
    afterRevision,
    beforeContent: existing.content,
    afterContent: nextContent,
    previousBlockId,
  };
}

export const updateBlock = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    blockId: v.id("productBlocks"),
    content: v.optional(v.array(productBlockChipValidator)),
    kind: v.optional(productBlockKindValidator),
    isChecked: v.optional(v.boolean()),
    sourceRefIds: v.optional(v.array(v.string())),
    attributes: v.optional(v.any()),
    // When true, we fork the prior version into previousBlockId so we don't lose
    // the original content (Google Docs-style per-block history).
    forkHistory: v.optional(v.boolean()),
    editedByAuthorKind: v.optional(productBlockAuthorKindValidator),
    editedByAuthorId: v.optional(v.string()),
    // Optimistic concurrency: if provided, reject the write when the stored
    // revision has moved past this value (another tab/agent won the race).
    // Clients pass the `revision` they last read. See REVISION_MISMATCH
    // handling in src/features/entities/components/notebook/EntityNotebookLive.
    expectedRevision: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"productBlocks">> => {
    const result = await applyGuardedBlockUpdate(ctx, args);
    return result.blockId;
  },
});

/**
 * Soft-delete a block. Keeps the row around so revision chains and `by_previous`
 * lookups still work (Google Docs-style).
 */
export const deleteBlock = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    blockId: v.id("productBlocks"),
  },
  handler: async (ctx, args) => {
    const { block: existing, identity } = await requireBlockWriteAccessById(ctx, args);
    await assertNotebookWriteRateLimit(ctx, {
      ownerKey: identity.ownerKey,
      sessionKey: notebookWriteSessionKey(identity),
      operation: "deleteBlock",
      shardHint: String(args.blockId),
    });
    if (existing.accessMode !== "edit") {
      throw convexError({ code: "BLOCK_READ_ONLY", blockId: args.blockId });
    }
    // PR D: clear searchableText on soft-delete so the federated
    // `search_blocks` index drops the row from results immediately.
    await ctx.db.patch(args.blockId, {
      deletedAt: Date.now(),
      searchableText: "",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Move a block to a new position (between two other blocks). Does NOT re-index
 * any siblings — that's the whole point of fractional indexing.
 */
export const moveBlock = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    blockId: v.id("productBlocks"),
    beforeBlockId: v.optional(v.id("productBlocks")),
    afterBlockId: v.optional(v.id("productBlocks")),
    parentBlockId: v.optional(v.id("productBlocks")),
    // When true, unsets parentBlockId (moves to root). Takes precedence over
    // parentBlockId when both are provided.
    clearParent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { block: existing, identity } = await requireBlockWriteAccessById(ctx, args);
    await assertNotebookWriteRateLimit(ctx, {
      ownerKey: identity.ownerKey,
      sessionKey: notebookWriteSessionKey(identity),
      operation: "moveBlock",
      shardHint: `${args.blockId}:${args.parentBlockId ?? "root"}`,
    });
    if (existing.accessMode !== "edit") {
      throw convexError({ code: "BLOCK_READ_ONLY", blockId: args.blockId });
    }
    const before = args.beforeBlockId ? await ctx.db.get(args.beforeBlockId) : null;
    const after = args.afterBlockId ? await ctx.db.get(args.afterBlockId) : null;
    const beforePos = before ? { int: before.positionInt, frac: before.positionFrac } : null;
    const afterPos = after ? { int: after.positionInt, frac: after.positionFrac } : null;
    const nextPos = positionBetween(beforePos, afterPos);

    // Resolve the candidate next parent. `clearParent` wins over any explicit
    // parentBlockId so the UI can force a root-level move.
    let nextParent: Id<"productBlocks"> | undefined = args.clearParent
      ? undefined
      : (args.parentBlockId ?? existing.parentBlockId ?? undefined);

    // Cycle / self-loop guard. A block must never be its own ancestor. We
    // walk the candidate parent's ancestor chain (bounded to 32 hops); if we
    // encounter `args.blockId` along the way the move would form a cycle and
    // we reject it with a structured error. We also reject an explicit
    // self-parent immediately, even if `existing.parentBlockId` was already
    // corrupt.
    if (nextParent) {
      if (nextParent === args.blockId) {
        throw convexError({
          code: "BLOCK_MOVE_CYCLE",
          blockId: args.blockId,
          parentBlockId: nextParent,
          reason: "self_loop",
        });
      }
      let cursor: Id<"productBlocks"> | undefined = nextParent;
      const seen = new Set<string>();
      for (let hops = 0; hops < 32 && cursor; hops += 1) {
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const parentDoc: Doc<"productBlocks"> | null = await ctx.db.get(cursor);
        if (!parentDoc || parentDoc.deletedAt) {
          // Broken parent link — fall back to root rather than keep a dangling
          // reference.
          nextParent = undefined;
          break;
        }
        const nextHop = parentDoc.parentBlockId as Id<"productBlocks"> | undefined;
        if (!nextHop) break;
        if (nextHop === args.blockId) {
          throw convexError({
            code: "BLOCK_MOVE_CYCLE",
            blockId: args.blockId,
            parentBlockId: nextParent,
            reason: "descendant_as_parent",
          });
        }
        cursor = nextHop;
      }
    }

    await ctx.db.patch(args.blockId, {
      positionInt: nextPos.int,
      positionFrac: nextPos.frac,
      parentBlockId: nextParent,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Repair helper — scans a block's ancestor chain and breaks any self-loop or
 * cycle by clearing `parentBlockId` on the offending node(s). This is used to
 * recover from legacy rows that pre-date the cycle guard in `moveBlock`.
 */
export const repairBlockParentCycles = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    blockId: v.id("productBlocks"),
  },
  handler: async (ctx, args): Promise<{ repaired: Array<Id<"productBlocks">> }> => {
    const { block: start, identity } = await requireBlockWriteAccessById(ctx, args);
    await assertNotebookWriteRateLimit(ctx, {
      ownerKey: identity.ownerKey,
      sessionKey: notebookWriteSessionKey(identity),
      operation: "repairBlockParentCycles",
      shardHint: String(args.blockId),
    });
    if (start.accessMode !== "edit") {
      throw convexError({ code: "BLOCK_READ_ONLY", blockId: args.blockId });
    }
    const repaired: Array<Id<"productBlocks">> = [];
    const seen = new Set<string>();
    let cursor: Doc<"productBlocks"> | null = start;
    for (let hops = 0; hops < 64 && cursor; hops += 1) {
      const id = String(cursor._id);
      const parent = cursor.parentBlockId as Id<"productBlocks"> | undefined;
      const needsRepair =
        parent === cursor._id || (parent ? seen.has(String(parent)) : false);
      if (needsRepair) {
        await ctx.db.patch(cursor._id, {
          parentBlockId: undefined,
          updatedAt: Date.now(),
        });
        repaired.push(cursor._id);
        break;
      }
      seen.add(id);
      if (!parent) break;
      cursor = await ctx.db.get(parent);
    }
    return { repaired };
  },
});

/**
 * Create a relation from a block to an entity/block/url. Used when the user
 * types `@`, `#`, or `<>` triggers and picks a target.
 */
export const createBlockRelation = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    fromBlockId: v.id("productBlocks"),
    toEntityId: v.optional(v.id("productEntities")),
    toBlockId: v.optional(v.id("productBlocks")),
    toUrl: v.optional(v.string()),
    relationKind: productBlockRelationKindValidator,
    relationLabel: v.optional(v.string()),
    authorKind: productBlockAuthorKindValidator,
    authorId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"productBlockRelations">> => {
    const { block, identity } = await requireBlockWriteAccessById(ctx, {
      anonymousSessionId: args.anonymousSessionId,
      shareToken: args.shareToken,
      blockId: args.fromBlockId,
    });
    await assertNotebookWriteRateLimit(ctx, {
      ownerKey: identity.ownerKey,
      sessionKey: notebookWriteSessionKey(identity),
      actorKey: args.authorId,
      operation: "createBlockRelation",
      shardHint: `${args.fromBlockId}:${args.authorId ?? "anon"}`,
    });
    if (block.accessMode !== "edit") {
      throw convexError({ code: "BLOCK_READ_ONLY", blockId: args.fromBlockId });
    }
    return ctx.db.insert("productBlockRelations", {
      ownerKey: block.ownerKey,
      fromBlockId: args.fromBlockId,
      toEntityId: args.toEntityId,
      toBlockId: args.toBlockId,
      toUrl: args.toUrl,
      relationKind: args.relationKind,
      relationLabel: args.relationLabel,
      authorKind: args.authorKind,
      authorId: args.authorId,
      createdAt: Date.now(),
    });
  },
});

/**
 * List backlinks — all blocks that mention a given entity.
 * Powers the "Linked from · N places" section at the bottom of entity pages.
 */
export const listBacklinksForEntity = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const workspaceAccess = await resolveEntityWorkspaceAccess(ctx, args);
    const entity = workspaceAccess?.entity ?? null;
    if (!entity) return [];

    const relations = await ctx.db
      .query("productBlockRelations")
      .withIndex("by_owner_entity", (q) =>
        q.eq("ownerKey", entity!.ownerKey).eq("toEntityId", entity!._id),
      )
      .collect();

    // Fetch the from-blocks so we can surface their snippet + parent entity.
    const results = await Promise.all(
      relations.map(async (rel) => {
        const block = await ctx.db.get(rel.fromBlockId);
        if (!block || block.deletedAt) return null;
        const parentEntity = await ctx.db.get(block.entityId);
        if (!parentEntity) return null;
        return {
          relationId: rel._id,
          relationKind: rel.relationKind,
          blockId: block._id,
          blockKind: block.kind,
          snippet: block.content
            .filter((c) => c.type === "text" || c.type === "mention")
            .map((c) => c.value)
            .join(" ")
            .slice(0, 180),
          fromEntityId: parentEntity._id,
          fromEntitySlug: parentEntity.slug,
          fromEntityName: parentEntity.name,
          createdAt: rel.createdAt,
        };
      }),
    );
    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

/**
 * List revision history for a block (walks the previousBlockId chain).
 * Returns oldest-first. Powers the per-block "show history" disclosure.
 */
export const listBlockRevisions = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    blockId: v.id("productBlocks"),
  },
  handler: async (ctx, args): Promise<Doc<"productBlocks">[]> => {
    let access: Awaited<ReturnType<typeof requireBlockReadAccessById>> | null = null;
    try {
      access = await requireBlockReadAccessById(ctx, args);
    } catch {
      return [];
    }
    const ownerKeys = [access.block.ownerKey];
    const chain: Doc<"productBlocks">[] = [];
    let cursor: Id<"productBlocks"> | undefined = args.blockId;
    const seen = new Set<string>();
    let depth = 0;
    while (cursor && !seen.has(cursor) && depth < 50) {
      seen.add(cursor);
      const row = await ctx.db.get(cursor);
      if (!row || !ownerKeys.includes(row.ownerKey)) break;
      chain.push(row);
      cursor = row.previousBlockId;
      depth += 1;
    }
    return chain.reverse();
  },
});

/**
 * Set a block's accessMode (Phase 10 — collaborator access).
 */
export const setBlockAccessMode = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    blockId: v.id("productBlocks"),
    accessMode: productBlockAccessValidator,
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    await assertNotebookWriteRateLimit(ctx, {
      ownerKey: identity.ownerKey,
      sessionKey: notebookWriteSessionKey(identity),
      operation: "setBlockAccessMode",
      shardHint: `${args.blockId}:${args.accessMode}`,
    });
    const row = await ctx.db.get(args.blockId);
    if (!row || row.ownerKey !== identity.ownerKey) throw new Error("Block not found");
    await ctx.db.patch(args.blockId, {
      accessMode: args.accessMode,
      isPublic: args.isPublic ?? row.isPublic,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Promote an inline link into a standalone evidence block attached as a child
 * of its citing block. The link chip stays in the parent text, but a child
 * evidence block is added + a block relation "evidence" is recorded.
 */
export const promoteLinkToEvidence = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    fromBlockId: v.id("productBlocks"),
    url: v.string(),
    label: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"productBlocks">> => {
    const { block: citing, identity } = await requireBlockWriteAccessById(ctx, {
      anonymousSessionId: args.anonymousSessionId,
      shareToken: args.shareToken,
      blockId: args.fromBlockId,
    });
    await assertNotebookWriteRateLimit(ctx, {
      ownerKey: identity.ownerKey,
      sessionKey: notebookWriteSessionKey(identity),
      operation: "promoteLinkToEvidence",
      shardHint: `${args.fromBlockId}:${args.url}`,
    });
    if (citing.accessMode !== "edit") {
      throw convexError({ code: "BLOCK_READ_ONLY", blockId: args.fromBlockId });
    }
    const siblings = await ctx.db
      .query("productBlocks")
      .withIndex("by_owner_entity_parent_position", (q) =>
        q
          .eq("ownerKey", citing.ownerKey)
          .eq("entityId", citing.entityId)
          .eq("parentBlockId", citing.parentBlockId),
      )
      .collect();
    const sorted = siblings
      .filter((b) => !b.deletedAt)
      .sort((a, b) =>
        comparePositionsWithId(
          { int: a.positionInt, frac: a.positionFrac, id: a._id },
          { int: b.positionInt, frac: b.positionFrac, id: b._id },
        ),
      );
    const citingIdx = sorted.findIndex((b) => b._id === citing._id);
    const before = citingIdx >= 0 ? sorted[citingIdx] : null;
    const after = citingIdx >= 0 ? sorted[citingIdx + 1] : null;
    const beforePos = before ? { int: before.positionInt, frac: before.positionFrac } : null;
    const afterPos = after ? { int: after.positionInt, frac: after.positionFrac } : null;
    const pos = positionBetween(beforePos, afterPos);

    const now = Date.now();
    const evidenceContent = [
      { type: "link", value: args.label, url: args.url },
    ];
    const evidenceBlockId = await ctx.db.insert("productBlocks", {
      ownerKey: citing.ownerKey,
      entityId: citing.entityId,
      parentBlockId: citing._id,
      kind: "evidence",
      authorKind: "user",
      authorId: "user:promote",
      content: evidenceContent,
      positionInt: pos.int,
      positionFrac: pos.frac,
      accessMode: "edit",
      isPublic: false,
      revision: 1,
      // PR D: populate searchableText for the federated `search_blocks` index.
      searchableText: recomputeBlockSearchableText({
        content: evidenceContent,
        deletedAt: undefined,
      }),
      createdAt: now,
      updatedAt: now,
    });
    // PR E: schedule per-row embedding for the promoted evidence block.
    await ctx.scheduler.runAfter(
      0,
      internal.domains.search.embedRowOnUpdate.embedBlockRow,
      { blockId: evidenceBlockId },
    );
    await ctx.db.insert("productBlockRelations", {
      ownerKey: citing.ownerKey,
      fromBlockId: citing._id,
      toBlockId: evidenceBlockId,
      toUrl: args.url,
      relationKind: "evidence",
      authorKind: "user",
      createdAt: now,
    });
    return evidenceBlockId;
  },
});

/**
 * NOTE: `searchEntitiesForMention` was removed in 2026-05. The legacy
 * implementation did `query("productEntities").take(200)` then JS-filtered
 * by name/slug substring, which silently truncated results for power users
 * with >200 entities and offered no typo tolerance.
 *
 * MentionPicker now routes through the federated search action
 * (`domains/search/federatedSearch:federatedSearch`) which is backed by the
 * `search_entities` searchIndex (PR #310) + vector hybrid (PR #315) — no
 * scan cliff, typo tolerance, deterministic ranking, and the same privacy
 * gate as the rest of the federated surface.
 *
 * See: src/features/entities/components/notebook/MentionPicker.tsx
 */

/**
 * Migration: backfill productBlocks for an entity from its current
 * productReports.sections + productEntityNotes + productEvidenceItems.
 * Idempotent — clears any existing agent-authored blocks for the entity
 * before inserting fresh ones. User-authored blocks are preserved.
 */
export const backfillEntityBlocks = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
  },
  handler: async (ctx, args): Promise<{ inserted: number; cleared: number }> => {
    const access = await requireEntityWorkspaceWriteAccessBySlug(ctx, args);
    const { entity, identity } = access;
    await assertNotebookWriteRateLimit(ctx, {
      ownerKey: identity.ownerKey,
      sessionKey: notebookWriteSessionKey(identity),
      operation: "backfillEntityBlocks",
      shardHint: args.entitySlug,
    });

    // Clear agent-authored blocks so we don't accumulate duplicates across runs.
    const existing = await ctx.db
      .query("productBlocks")
      .withIndex("by_owner_entity", (q) => q.eq("ownerKey", entity.ownerKey).eq("entityId", entity._id))
      .collect();
    const liveExisting = liveRowsOnly(existing);
    const shouldResetPlaceholderBlocks =
      liveExisting.length > 0 && liveExisting.every((block) => !isMeaningfulPersistedBlock(block));
    let cleared = 0;
    for (const block of existing) {
      if (block.deletedAt) continue;
      if (
        block.authorKind === "agent" ||
        (shouldResetPlaceholderBlocks && isPlaceholderNotebookBlock(block))
      ) {
        // PR D: clear searchableText so the federated `search_blocks` index
        // drops these soft-deleted rows immediately (no stale results).
        await ctx.db.patch(block._id, {
          deletedAt: Date.now(),
          searchableText: "",
          updatedAt: Date.now(),
        });
        cleared += 1;
      }
    }

    // Grab the latest report to seed agent-authored blocks.
    const latestReport = await ctx.db
      .query("productReports")
      .withIndex("by_owner_entity_updated", (q) =>
        q.eq("ownerKey", entity.ownerKey).eq("entitySlug", args.entitySlug),
      )
      .order("desc")
      .first();

    const now = Date.now();
    let inserted = 0;

    let seedTitle: string | null = null;
    let seedSections:
      | Array<{
          title: string;
          body: string;
          sourceRefIds?: string[];
        }>
      | null = null;
    let seedAuthorId: string | undefined;
    let seedSessionId: Id<"productChatSessions"> | undefined;

    if (latestReport) {
      seedTitle = latestReport.title || "Prep brief";
      seedSections = (latestReport.sections ?? []).map((section) => ({
        title: section.title,
        body: section.body,
        sourceRefIds: section.sourceRefIds,
      }));
      seedAuthorId = latestReport.routing?.executionModel ?? "agent";
      seedSessionId = latestReport.sessionId ?? undefined;
    } else {
      const archivePosts = await ctx.db
        .query("linkedinPostArchive")
        .withIndex("by_postedAt")
        .order("desc")
        .take(SYSTEM_NOTEBOOK_POST_LIMIT);
      const systemNode = getSystemEntityNodeBySlug(
        archivePosts.filter((post) => post.target !== "personal"),
        args.entitySlug,
      );
      const latestSystemTimeline = systemNode?.timeline[0] ?? null;
      const systemSources = latestSystemTimeline
        ? latestSystemTimeline.sourceUrls.map((href, index) => ({
            id: `${latestSystemTimeline.key}-source-${index}`,
            label:
              latestSystemTimeline.sourceLabels[index] ??
              sourceLabelFromHref(href) ??
              `Source ${index + 1}`,
          }))
        : [];
      if (systemNode) {
        seedTitle = latestSystemTimeline?.title ?? systemNode.name ?? entity.name;
        seedSections = buildSystemNotebookSections({
          entityName: systemNode.name,
          summary: latestSystemTimeline?.summary ?? systemNode.summary,
          relatedCount: systemNode.relatedEntities.filter(isCleanSystemNotebookRelation).length,
          sourceCount: systemSources.length,
          systemGroup: systemNode.systemGroup,
          latestTitle: latestSystemTimeline?.title ?? systemNode.name,
          sourceRefIds: systemSources.map((source) => source.id),
        }).map((section) => ({
          title: section.title,
          body: section.body,
          sourceRefIds: section.sourceRefIds,
        }));
        seedAuthorId = "system-archive";
      }
    }

    if (seedTitle && seedSections && seedSections.length > 0) {
      const sectionCount = seedSections.length;
      // One heading block for the report itself + heading + body per section.
      const positions = positionsBetween(null, null, 1 + sectionCount * 2);
      let posIdx = 0;

      const briefHeadingContent = [{ type: "text" as const, value: seedTitle }];
      const briefHeadingId = await ctx.db.insert("productBlocks", {
        ownerKey: entity.ownerKey,
        entityId: entity._id,
        parentBlockId: undefined,
        kind: "heading_2",
        authorKind: "agent",
        authorId: seedAuthorId,
        content: briefHeadingContent,
        positionInt: positions[posIdx].int,
        positionFrac: positions[posIdx].frac,
        accessMode: "edit",
        isPublic: false,
        sourceSessionId: seedSessionId,
        revision: 1,
        // PR D: populate searchableText for the federated `search_blocks`.
        searchableText: recomputeBlockSearchableText({
          content: briefHeadingContent,
          deletedAt: undefined,
        }),
        createdAt: now,
        updatedAt: now,
      });
      // PR E: schedule embedding for the seeded brief-heading block.
      await ctx.scheduler.runAfter(
        0,
        internal.domains.search.embedRowOnUpdate.embedBlockRow,
        { blockId: briefHeadingId },
      );
      posIdx += 1;
      inserted += 1;

      for (const section of seedSections) {
        const sectionHeadingContent = [
          { type: "text" as const, value: section.title },
        ];
        const headingId = await ctx.db.insert("productBlocks", {
          ownerKey: entity.ownerKey,
          entityId: entity._id,
          parentBlockId: briefHeadingId,
          kind: "heading_3",
          authorKind: "agent",
          authorId: seedAuthorId,
          content: sectionHeadingContent,
          positionInt: positions[posIdx].int,
          positionFrac: positions[posIdx].frac,
          accessMode: "edit",
          isPublic: false,
          sourceSessionId: seedSessionId,
          revision: 1,
          // PR D: populate searchableText for the federated `search_blocks`.
          searchableText: recomputeBlockSearchableText({
            content: sectionHeadingContent,
            deletedAt: undefined,
          }),
          createdAt: now,
          updatedAt: now,
        });
        // PR E: schedule embedding for the section-heading block.
        await ctx.scheduler.runAfter(
          0,
          internal.domains.search.embedRowOnUpdate.embedBlockRow,
          { blockId: headingId },
        );
        posIdx += 1;
        inserted += 1;

        const sectionBodyContent = [
          { type: "text" as const, value: section.body },
        ];
        const bodyId = await ctx.db.insert("productBlocks", {
          ownerKey: entity.ownerKey,
          entityId: entity._id,
          parentBlockId: headingId,
          kind: "text",
          authorKind: "agent",
          authorId: seedAuthorId,
          content: sectionBodyContent,
          positionInt: positions[posIdx].int,
          positionFrac: positions[posIdx].frac,
          accessMode: "edit",
          isPublic: false,
          sourceSessionId: seedSessionId,
          sourceRefIds: section.sourceRefIds,
          revision: 1,
          // PR D: populate searchableText for the federated `search_blocks`.
          searchableText: recomputeBlockSearchableText({
            content: sectionBodyContent,
            deletedAt: undefined,
          }),
          createdAt: now,
          updatedAt: now,
        });
        // PR E: schedule embedding for the section-body block.
        await ctx.scheduler.runAfter(
          0,
          internal.domains.search.embedRowOnUpdate.embedBlockRow,
          { blockId: bodyId },
        );
        posIdx += 1;
        inserted += 1;
      }
    }

    // Evidence blocks (attached to this entity)
    const evidenceItems = await ctx.db
      .query("productEvidenceItems")
      .withIndex("by_owner_entity", (q) => q.eq("ownerKey", entity.ownerKey).eq("entityId", entity._id))
      .collect();
    if (evidenceItems.length > 0) {
      const positions = positionsBetween(null, null, evidenceItems.length);
      for (let i = 0; i < evidenceItems.length; i++) {
        const item = evidenceItems[i];
        const evidenceLinkContent = [
          {
            type: "link" as const,
            value: item.label,
            url: item.sourceUrl,
          },
        ];
        const evidenceLinkId = await ctx.db.insert("productBlocks", {
          ownerKey: entity.ownerKey,
          entityId: entity._id,
          kind: "evidence",
          authorKind: "agent",
          authorId: "harness:evidence",
          content: evidenceLinkContent,
          positionInt: positions[i].int,
          positionFrac: positions[i].frac,
          accessMode: "edit",
          isPublic: false,
          revision: 1,
          // PR D: populate searchableText for the federated `search_blocks`.
          searchableText: recomputeBlockSearchableText({
            content: evidenceLinkContent,
            deletedAt: undefined,
          }),
          createdAt: now,
          updatedAt: now,
        });
        // PR E: schedule embedding for the harness-evidence block.
        await ctx.scheduler.runAfter(
          0,
          internal.domains.search.embedRowOnUpdate.embedBlockRow,
          { blockId: evidenceLinkId },
        );
        inserted += 1;
      }
    }

    return { inserted, cleared };
  },
});

// Super-light markdown → block splitter. Splits on blank lines, keeps bullets
// as bullet blocks, and preserves order. The real impl (Phase B) will persist
// Lexical-aware block state.
function splitNoteIntoBlocks(
  content: string,
  updatedAt: number,
  idPrefix: string,
): NotebookBlock[] {
  const lines = content.split(/\r?\n/);
  const result: NotebookBlock[] = [];
  let paragraph: string[] = [];
  let paragraphIdx = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    result.push({
      id: `${idPrefix}-p${paragraphIdx++}`,
      kind: "text",
      author: "user",
      authorLabel: "You",
      body: paragraph.join(" ").trim(),
      updatedAt,
    });
    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    if (/^[-*•]\s+/.test(line)) {
      flushParagraph();
      result.push({
        id: `${idPrefix}-b${result.length}`,
        kind: "bullet",
        author: "user",
        authorLabel: "You",
        body: line.replace(/^[-*•]\s+/, ""),
        updatedAt,
      });
      continue;
    }
    if (/^(\s*)\[[ x]\]\s+/i.test(line)) {
      flushParagraph();
      result.push({
        id: `${idPrefix}-t${result.length}`,
        kind: "todo",
        author: "user",
        authorLabel: "You",
        body: line.replace(/^(\s*)\[[ x]\]\s+/i, ""),
        updatedAt,
      });
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      flushParagraph();
      const depth = (line.match(/^#+/)?.[0].length ?? 1) as 1 | 2 | 3;
      const kind: NotebookBlockKind = depth === 1 ? "heading-1" : depth === 2 ? "heading-2" : "heading-3";
      result.push({
        id: `${idPrefix}-h${result.length}`,
        kind,
        author: "user",
        authorLabel: "You",
        body: line.replace(/^#{1,3}\s+/, ""),
        updatedAt,
      });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return result;
}
