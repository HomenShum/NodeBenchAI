/**
 * My Wiki — Phase 1 schema (personal synthesis layer, derivative only)
 *
 * Lives under the Me surface. Three tables, all derivative of the
 * structured durable truth (productReports, productClaims,
 * canonicalSources, extractedSignals, files). NEVER the source of truth.
 *
 * See: docs/architecture/ME_PAGE_WIKI_SPEC.md (full multi-phase design)
 * See: docs/architecture/ME_AGENT_DESIGN.md (background maintainer)
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

export const userWikiPageTypeValidator = v.union(
  v.literal("topic"),
  v.literal("company"),
  v.literal("person"),
  v.literal("product"),
  v.literal("event"),
  v.literal("location"),
  v.literal("job"),
  v.literal("contradiction"),
);

export const userWikiFreshnessValidator = v.union(
  v.literal("fresh"),
  v.literal("recent"),
  v.literal("stale"),
  v.literal("very_stale"),
  v.literal("unknown"),
);

export const userWikiMaintainerSignalValidator = v.union(
  v.literal("report_saved"),
  v.literal("canonical_source_added"),
  v.literal("extracted_signal_added"),
  v.literal("pulse_material_change"),
  v.literal("file_uploaded"),
  v.literal("manual_regenerate"),
  v.literal("scheduled_refresh"),
);

export const userWikiPages = defineTable({
  ownerKey: v.string(),
  pageType: userWikiPageTypeValidator,
  // per-owner unique; lowercased + slug-safe; e.g. "stripe", "patrick-collison"
  slug: v.string(),
  title: v.string(),
  // One-liner shown in list views; derived from latest revision
  summary: v.string(),
  freshnessState: userWikiFreshnessValidator,
  contradictionCount: v.number(),
  // Ids used as provenance chain — wiki is derivative
  linkedArtifactIds: v.array(v.id("productReports")),
  linkedSourceKeys: v.array(v.string()),
  revision: v.number(),
  regeneratedAt: v.number(),
  // Set by the maintainer when a regen is debounced/scheduled
  pendingRegenAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_pageType", ["ownerKey", "pageType"])
  .index("by_owner_slug", ["ownerKey", "slug"])
  .index("by_owner_updated", ["ownerKey", "updatedAt"])
  .index("by_owner_freshness", ["ownerKey", "freshnessState"])
  .index("by_owner_contradictions", ["ownerKey", "contradictionCount"]);

export const userWikiRevisions = defineTable({
  ownerKey: v.string(),
  pageId: v.id("userWikiPages"),
  revision: v.number(),
  // Zone 1 generated sections — never edited in place
  summary: v.string(),
  whatItIs: v.string(),
  whyItMatters: v.string(),
  whatChanged: v.string(),
  openQuestions: v.string(),
  // Deterministic-replay hash over sorted source ids + model + prompt version
  sourceSnapshotHash: v.string(),
  sourceSnapshotIds: v.array(v.string()),
  modelUsed: v.string(),
  // What triggered this regeneration
  triggerSignal: userWikiMaintainerSignalValidator,
  // Gate state when this revision was produced
  answerControlPassed: v.boolean(),
  hallucinationGateFailed: v.boolean(),
  unsupportedClaimCount: v.number(),
  // Approval-mode setting for the owner at time of generation
  approvedByUser: v.boolean(),
  approvedAt: v.optional(v.number()),
  generatedAt: v.number(),
})
  .index("by_owner_page_rev", ["ownerKey", "pageId", "revision"])
  .index("by_owner_page_generatedAt", ["ownerKey", "pageId", "generatedAt"])
  .index("by_owner_generatedAt", ["ownerKey", "generatedAt"]);

/**
 * Durable job queue for the background maintainer.
 *
 * Every ingest-hook enqueues a job with (ownerKey, targetSlug,
 * triggerSignal, idempotencyKey). The processor coalesces identical
 * in-flight jobs via idempotencyKey (deterministic hash of the signal).
 *
 * BOUND: rows older than 7 days OR status=done get pruned by scheduled
 * cleanup. HONEST_STATUS: failed jobs carry their error + retry count,
 * never fake a success.
 */
export const userWikiMaintainerJobs = defineTable({
  ownerKey: v.string(),
  idempotencyKey: v.string(),
  targetSlug: v.string(),
  targetPageType: userWikiPageTypeValidator,
  triggerSignal: userWikiMaintainerSignalValidator,
  // triggerRef — free-form reference to what triggered this (reportId, csl key, etc.)
  triggerRef: v.string(),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("done"),
    v.literal("failed"),
    v.literal("dead_letter"),
  ),
  attempt: v.number(),
  lastError: v.optional(v.string()),
  enqueuedAt: v.number(),
  scheduledAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  runId: v.optional(v.string()),
})
  .index("by_owner_status_scheduled", ["ownerKey", "status", "scheduledAt"])
  .index("by_idempotency", ["idempotencyKey"])
  .index("by_status_scheduled", ["status", "scheduledAt"]);

/* ====================================================================
 * DREAMING PHASE TABLES (Phase 2)
 * OBSERVE → CONSOLIDATE → REFLECT pipeline
 * See: docs/architecture/ME_PAGE_WIKI_SPEC.md §6 (regeneration model)
 * ==================================================================== */

/**
 * OBSERVE Phase output — staged candidates for later consolidation.
 * Light-weight ingestion: dedupe, cluster, rank confidence.
 * Never the source of truth; ephemeral (pruned after 7 days).
 */
export const userWikiStaging = defineTable({
  ownerKey: v.string(),
  candidateType: v.union(
    v.literal("entity"),
    v.literal("topic"),
    v.literal("relation"),
  ),
  sourceId: v.string(), // e.g., reportId, claimId, blockId
  sourceType: v.string(), // "productReports", "productClaims", "productBlocks"
  title: v.string(),
  summary: v.string(),
  confidence: v.number(), // 0-1, computed by OBSERVE agent
  entityRefs: v.array(v.string()), // slugs of related entities
  extractedAt: v.number(),
  // Clustering
  clusterId: v.optional(v.string()), // groups related candidates
  // Promotion gate
  promoteToDeep: v.boolean(), // OBSERVE sets this based on confidence threshold
  // Source provenance
  sourceSnapshotHash: v.optional(v.string()),
})
  .index("by_owner_cluster", ["ownerKey", "clusterId"])
  .index("by_owner_promote", ["ownerKey", "promoteToDeep"])
  .index("by_owner_extracted", ["ownerKey", "extractedAt"]);

/**
 * REFLECT Phase output — extracted themes across wiki pages.
 * Derived observations, not truth-bearing facts.
 */
export const userWikiThemes = defineTable({
  ownerKey: v.string(),
  themeId: v.string(), // stable ID for theme
  label: v.string(), // e.g., "AI infrastructure investments"
  description: v.string(),
  relatedPageSlugs: v.array(v.string()),
  confidence: v.number(), // 0-1
  generatedAt: v.number(),
  lastSeenAt: v.number(), // for decay tracking
  // Source
  extractedFromRevisionIds: v.array(v.id("userWikiRevisions")),
})
  .index("by_owner_theme", ["ownerKey", "themeId"])
  .index("by_owner_generated", ["ownerKey", "generatedAt"]);

/**
 * REFLECT Phase output — persistent open questions.
 * Spawned from revisions, can be answered by later work.
 */
export const userWikiOpenQuestions = defineTable({
  ownerKey: v.string(),
  questionId: v.string(),
  questionText: v.string(),
  relatedPageSlug: v.string(),
  spawnedFromRevisionId: v.id("userWikiRevisions"),
  status: v.union(v.literal("open"), v.literal("answered"), v.literal("stale")),
  answerSummary: v.optional(v.string()), // brief answer if status=answered
  createdAt: v.number(),
  answeredAt: v.optional(v.number()),
})
  .index("by_owner_page", ["ownerKey", "relatedPageSlug"])
  .index("by_owner_status", ["ownerKey", "status"]);

/**
 * Zone 3 — User notes (human-owned, never AI-written).
 * Bounded: 64KB per page.
 */
export const userWikiNotes = defineTable({
  ownerKey: v.string(),
  pageId: v.id("userWikiPages"),
  body: v.string(), // markdown
  bodyBytes: v.number(), // bounded: 65,536 max
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_page", ["ownerKey", "pageId"]);

/**
 * CONSOLIDATE Phase output — extracted edges between wiki pages.
 * Provenance-tracked; regenerable.
 */
export const userWikiEdges = defineTable({
  ownerKey: v.string(),
  fromPageId: v.id("userWikiPages"),
  toPageId: v.id("userWikiPages"),
  relationType: v.union(
    v.literal("related"),
    v.literal("competitor"),
    v.literal("works_at"),
    v.literal("invested_in"),
    v.literal("acquired_by"),
    v.literal("based_in"),
    v.literal("mentioned_in"),
    v.literal("contradicts"),
    v.literal("supersedes"),
  ),
  confidence: v.number(), // 0-1
  provenanceClaimId: v.optional(v.id("productClaims")),
  provenanceSourceKey: v.optional(v.string()),
  // Extraction metadata
  extractedByRevisionId: v.id("userWikiRevisions"),
  extractionPromptVersion: v.string(),
  // User override
  mutedByUser: v.boolean(), // user can mute edges without deleting
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_from", ["ownerKey", "fromPageId"])
  .index("by_owner_to", ["ownerKey", "toPageId"])
  .index("by_owner_relation", ["ownerKey", "relationType"]);

/**
 * EVALUATION — LLM Judge test results for dreaming pipeline
 * Tracks quality metrics across OBSERVE/CONSOLIDATE/REFLECT phases
 */
export const wikiDreamingEvaluations = defineTable({
  ownerKey: v.string(),
  phases: v.array(v.union(v.literal("observe"), v.literal("consolidate"), v.literal("reflect"))),
  results: v.array(v.object({
    testId: v.string(),
    passed: v.boolean(),
    score: v.number(),
    findings: v.optional(v.array(v.any())),
  })),
  summary: v.string(),
  avgScore: v.number(),
  createdAt: v.number(),
})
  .index("by_owner", ["ownerKey"])
  .index("by_owner_created", ["ownerKey", "createdAt"]);
