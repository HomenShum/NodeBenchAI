// convex/lib/artifactValidators.ts
// Convex validators (v.*) for artifact schema boundaries
// Types imported from src/shared/artifacts.ts

import { v } from "convex/values";

// ═══════════════════════════════════════════════════════════════════════════
// ENUM VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

// Validators must match schema.ts exactly
export const artifactKindValidator = v.union(
  v.literal("url"),
  v.literal("file"),
  v.literal("video"),
  v.literal("image"),
  v.literal("document")
);

// Schema-compatible providers only (extended types map to "web")
export const artifactProviderValidator = v.union(
  v.literal("youtube"),
  v.literal("sec"),
  v.literal("arxiv"),
  v.literal("news"),
  v.literal("web"),
  v.literal("local")
);

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACT FLAGS VALIDATOR (GAM philosophy - booleans only)
// ═══════════════════════════════════════════════════════════════════════════

export const artifactFlagsValidator = v.object({
  hasThumbnail: v.boolean(),
  hasTranscript: v.boolean(),
  hasPageRefs: v.boolean(),
  isPinned: v.boolean(),
  isCited: v.boolean(),
  isEnriched: v.boolean(),
});

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACT CARD VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════

export const artifactCardValidator = v.object({
  id: v.string(),
  kind: artifactKindValidator,
  provider: v.optional(artifactProviderValidator),
  canonicalUrl: v.string(),
  title: v.string(),
  host: v.optional(v.string()),
  snippet: v.optional(v.string()),
  thumbnail: v.optional(v.string()),
  transcript: v.optional(v.string()),
  pageRefs: v.optional(v.array(v.string())),
  discoveredAt: v.number(),
  toolName: v.optional(v.string()),
  rev: v.number(),
  flags: artifactFlagsValidator,
});

// ═══════════════════════════════════════════════════════════════════════════
// STREAM EVENT VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

export const artifactBatchEventValidator = v.object({
  type: v.literal("artifact_batch"),
  runId: v.string(),
  messageId: v.string(),
  seq: v.number(),
  artifacts: v.array(artifactCardValidator),
});

export const artifactEnrichEventValidator = v.object({
  type: v.literal("artifact_enrich"),
  runId: v.string(),
  messageId: v.string(),
  seq: v.number(),
  artifactId: v.string(),
  enrich: v.object({
    title: v.optional(v.string()),
    host: v.optional(v.string()),
    snippet: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
    transcript: v.optional(v.string()),
    pageRefs: v.optional(v.array(v.string())),
    discoveredAt: v.optional(v.number()),
    toolName: v.optional(v.string()),
    rev: v.optional(v.number()),
    flags: v.optional(artifactFlagsValidator),
  }),
  rev: v.number(),
});

export const artifactLinkSectionEventValidator = v.object({
  type: v.literal("artifact_link_section"),
  runId: v.string(),
  messageId: v.string(),
  seq: v.number(),
  artifactId: v.string(),
  sectionId: v.string(),
});

export const evidenceLinkEventValidator = v.object({
  type: v.literal("evidence_link"),
  runId: v.string(),
  messageId: v.string(),
  seq: v.number(),
  factId: v.string(),
  artifactIds: v.array(v.string()),
});

export const artifactPinEventValidator = v.object({
  type: v.literal("artifact_pin"),
  runId: v.string(),
  messageId: v.string(),
  seq: v.number(),
  artifactId: v.string(),
  pinned: v.boolean(),
});

// ═══════════════════════════════════════════════════════════════════════════
// TABLE FIELD VALIDATORS (for schema.ts)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validator for artifacts table rows
 */
export const artifactTableValidator = {
  runId: v.string(),              // agentThreadId - stable for dossier
  artifactId: v.string(),         // Stable hash: art_<sha256_prefix>
  userId: v.id("users"),
  
  kind: artifactKindValidator,
  provider: v.optional(artifactProviderValidator),
  canonicalUrl: v.string(),
  
  title: v.string(),
  host: v.optional(v.string()),
  snippet: v.optional(v.string()),
  thumbnail: v.optional(v.string()),
  transcript: v.optional(v.string()),
  pageRefs: v.optional(v.array(v.string())),
  
  discoveredAt: v.number(),
  toolName: v.optional(v.string()),
  rev: v.number(),
  
  flags: artifactFlagsValidator,
};

/**
 * Validator for artifactLinks table rows
 */
export const artifactLinkTableValidator = {
  runId: v.string(),
  artifactId: v.string(),
  sectionId: v.string(),
  createdAt: v.number(),
};

/**
 * Validator for evidenceLinks table rows
 */
export const evidenceLinkTableValidator = {
  runId: v.string(),
  factId: v.string(),
  artifactIds: v.array(v.string()),
  createdAt: v.number(),
};

// ═══════════════════════════════════════════════════════════════════════════
// QUERY ARG VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Common args for run-scoped queries
 */
export const runScopedQueryArgs = {
  runId: v.string(),
};

/**
 * Args for upserting an artifact
 */
export const upsertArtifactArgs = {
  runId: v.string(),
  artifact: artifactCardValidator,
};

/**
 * Args for enriching an artifact
 */
export const enrichArtifactArgs = {
  runId: v.string(),
  artifactId: v.string(),
  enrich: v.object({
    title: v.optional(v.string()),
    snippet: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
    transcript: v.optional(v.string()),
    pageRefs: v.optional(v.array(v.string())),
    flags: v.optional(artifactFlagsValidator),
  }),
  rev: v.number(),
};

/**
 * Args for linking artifact to section
 */
export const linkArtifactToSectionArgs = {
  runId: v.string(),
  artifactId: v.string(),
  sectionId: v.string(),
};

/**
 * Args for linking evidence to artifacts
 */
export const linkEvidenceArgs = {
  runId: v.string(),
  factId: v.string(),
  artifactIds: v.array(v.string()),
};

/**
 * Args for pinning artifact
 */
export const pinArtifactArgs = {
  runId: v.string(),
  artifactId: v.string(),
  pinned: v.boolean(),
};
