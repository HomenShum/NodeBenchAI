import { defineTable } from "convex/server";
import { v } from "convex/values";

export const productLensValidator = v.union(
  v.literal("founder"),
  v.literal("investor"),
  v.literal("banker"),
  v.literal("ceo"),
  v.literal("legal"),
  v.literal("student"),
);

export const productEvidenceTypeValidator = v.union(
  v.literal("file"),
  v.literal("document"),
  v.literal("link"),
  v.literal("voice"),
  v.literal("camera"),
  v.literal("image"),
  v.literal("text"),
);

export const productSectionStatusValidator = v.union(
  v.literal("pending"),
  v.literal("building"),
  v.literal("complete"),
);

export const productReportSectionValidator = v.object({
  id: v.string(),
  title: v.string(),
  body: v.string(),
  status: productSectionStatusValidator,
  sourceRefIds: v.optional(v.array(v.string())),
});

export const productRoutingModeValidator = v.union(
  v.literal("executive"),
  v.literal("advisor"),
);

export const productRoutingDecisionValidator = v.object({
  routingMode: productRoutingModeValidator,
  routingReason: v.optional(v.string()),
  routingSource: v.optional(
    v.union(v.literal("automatic"), v.literal("user_forced")),
  ),
  plannerModel: v.optional(v.string()),
  executionModel: v.optional(v.string()),
  reasoningEffort: v.optional(v.union(v.literal("medium"), v.literal("high"))),
});

export const productOperatorContextSnapshotValidator = v.object({
  label: v.optional(v.string()),
  hint: v.optional(v.string()),
});

export const productResolutionStateValidator = v.union(
  v.literal("exact"),
  v.literal("probable"),
  v.literal("ambiguous"),
  v.literal("unresolved"),
);

export const productArtifactStateValidator = v.union(
  v.literal("none"),
  v.literal("draft"),
  v.literal("saved"),
  v.literal("published"),
);

export const productSaveEligibilityValidator = v.union(
  v.literal("blocked"),
  v.literal("draft_only"),
  v.literal("save_ready"),
  v.literal("publish_ready"),
);

export const productRequestKindValidator = v.union(
  v.literal("conversational_follow_up"),
  v.literal("entity_lookup"),
  v.literal("compound_research"),
  v.literal("artifact_resume"),
);

export const productClaimTypeValidator = v.union(
  v.literal("entity_name"),
  v.literal("headquarters"),
  v.literal("funding_round"),
  v.literal("funding_amount"),
  v.literal("funding_date"),
  v.literal("founder_identity"),
  v.literal("founder_role"),
  v.literal("product_capability"),
  v.literal("pricing"),
  v.literal("customer"),
  v.literal("hiring_signal"),
  v.literal("job_salary"),
  v.literal("job_location"),
  v.literal("timeline_event"),
  v.literal("summary_other"),
);

export const productClaimSupportTypeValidator = v.union(
  v.literal("direct"),
  v.literal("inferred"),
  v.literal("weak"),
);

export const productClaimSupportStrengthValidator = v.union(
  v.literal("verified"),
  v.literal("corroborated"),
  v.literal("single_source"),
  v.literal("weak"),
);

export const productFreshnessStatusValidator = v.union(
  v.literal("fresh"),
  v.literal("stale"),
  v.literal("unknown"),
);

export const productNoteBlockKindValidator = v.union(
  v.literal("observation"),
  v.literal("insight"),
  v.literal("question"),
  v.literal("action"),
);

export const productNoteBlockValidator = v.object({
  id: v.string(),
  kind: productNoteBlockKindValidator,
  title: v.string(),
  body: v.string(),
});

export const productDocumentKindValidator = v.union(
  v.literal("entity_memory"),
  v.literal("report_memory"),
);

export const productDocumentBlockTypeValidator = v.union(
  v.literal("paragraph"),
  v.literal("heading"),
  v.literal("bullet"),
  v.literal("quote"),
  v.literal("check"),
  v.literal("code"),
);

export const productDocumentBlockValidator = v.object({
  blockId: v.string(),
  parentBlockId: v.optional(v.string()),
  order: v.number(),
  type: productDocumentBlockTypeValidator,
  depth: v.optional(v.number()),
  text: v.string(),
  markdown: v.optional(v.string()),
  lexical: v.optional(v.any()),
  entityRefs: v.optional(v.array(v.string())),
  sourceRefs: v.optional(v.array(v.string())),
});

export const productSourceValidator = v.object({
  id: v.string(),
  label: v.string(),
  href: v.optional(v.string()),
  type: v.optional(v.string()),
  status: v.optional(v.string()),
  title: v.optional(v.string()),
  domain: v.optional(v.string()),
  siteName: v.optional(v.string()),
  faviconUrl: v.optional(v.string()),
  publishedAt: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  imageCandidates: v.optional(v.array(v.string())),
  excerpt: v.optional(v.string()),
  confidence: v.optional(v.number()),
});

export const productRunEventKindValidator = v.union(
  v.literal("run_started"),
  v.literal("intent_classified"),
  v.literal("entity_candidates_ranked"),
  v.literal("entity_resolution_finalized"),
  v.literal("evidence_collected"),
  v.literal("tool_started"),
  v.literal("tool_completed"),
  v.literal("tool_recovered"),
  v.literal("provider_budget"),
  v.literal("interrupt_created"),
  v.literal("interrupt_resolved"),
  v.literal("claims_extracted"),
  v.literal("claims_rejected"),
  v.literal("claims_published"),
  v.literal("truth_compiled"),
  v.literal("actions_compiled"),
  v.literal("artifact_state_changed"),
  v.literal("milestone"),
  v.literal("run_completed"),
  v.literal("run_failed"),
);

export const productRunEventStatusValidator = v.union(
  v.literal("info"),
  v.literal("success"),
  v.literal("warning"),
  v.literal("error"),
  v.literal("pending"),
);

export const productRunVerdictValidator = v.union(
  v.literal("verified"),
  v.literal("provisionally_verified"),
  v.literal("needs_review"),
  v.literal("failed"),
);

export const productRunGateResultValidator = v.object({
  gateKey: v.string(),
  passed: v.boolean(),
  label: v.optional(v.string()),
});

export const productClaimSupportSnapshotValidator = v.object({
  sourceRefId: v.string(),
  spanText: v.string(),
  spanHash: v.string(),
  supportType: productClaimSupportTypeValidator,
  freshnessStatus: productFreshnessStatusValidator,
});

export const productCompiledSentenceValidator = v.object({
  sentenceId: v.string(),
  text: v.string(),
  claimIds: v.array(v.id("productClaims")),
  evidenceIds: v.array(v.id("productEvidenceItems")),
});

export const productCompiledSectionValidator = v.object({
  id: v.string(),
  title: v.string(),
  sentences: v.array(productCompiledSentenceValidator),
});

export const productActionItemValidator = v.object({
  type: v.string(),
  label: v.string(),
  rationale: v.string(),
  enabled: v.boolean(),
  blockedReason: v.optional(v.string()),
});

export const productClaimLedgerSummaryValidator = v.object({
  totalClaims: v.number(),
  publishableClaims: v.number(),
  rejectedClaims: v.number(),
  contradictedClaims: v.number(),
  corroboratedClaims: v.number(),
  verifiedClaims: v.number(),
  weakClaims: v.number(),
  rejectionReasons: v.array(v.string()),
});

export const productEventMemoryLayerValidator = v.union(
  v.literal("event_corpus"),
  v.literal("private_capture"),
  v.literal("team_memory"),
  v.literal("source_cache"),
  v.literal("workspace_memory"),
);

export const productEventEntityTypeValidator = v.union(
  v.literal("event"),
  v.literal("person"),
  v.literal("company"),
  v.literal("product"),
  v.literal("market"),
  v.literal("topic"),
  v.literal("job"),
  v.literal("customer_segment"),
  v.literal("claim"),
  v.literal("source"),
);

export const productEventClaimStatusValidator = v.union(
  v.literal("field_note"),
  v.literal("needs_evidence"),
  v.literal("provisional"),
  v.literal("verified"),
  v.literal("stale"),
  v.literal("contradicted"),
);

export const productEventVisibilityValidator = v.union(
  v.literal("private"),
  v.literal("team"),
  v.literal("tenant"),
  v.literal("public"),
);

export const productEventPromotionGateValidator = v.union(
  v.literal("none"),
  v.literal("needs_public_source"),
  v.literal("needs_human_review"),
  v.literal("approval_required"),
);

export const productEventCaptureKindValidator = v.union(
  v.literal("text"),
  v.literal("voice"),
  v.literal("image"),
  v.literal("screenshot"),
  v.literal("file"),
);

export const productEventCaptureStatusValidator = v.union(
  v.literal("captured"),
  v.literal("attached"),
  v.literal("needs_confirmation"),
  v.literal("unassigned"),
);

export const productEventWorkspaceTabValidator = v.union(
  v.literal("brief"),
  v.literal("cards"),
  v.literal("notebook"),
  v.literal("sources"),
  v.literal("chat"),
  v.literal("map"),
);

export const productEventWorkspaceSourceValidator = v.union(
  v.literal("fixture_seed"),
  v.literal("live_capture"),
  v.literal("agent_run"),
);

export const productEventRunStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("complete"),
  v.literal("error"),
);

export const productEventActorTypeValidator = v.union(
  v.literal("anonymous"),
  v.literal("event_guest"),
  v.literal("member"),
  v.literal("admin"),
  v.literal("research_lead"),
  v.literal("agent"),
);

export const productEventBudgetRouteStepValidator = v.union(
  v.literal("event_corpus"),
  v.literal("tenant_memory"),
  v.literal("source_cache"),
  v.literal("free_public_search"),
  v.literal("paid_search"),
);

export const productEventWorkspaceEntityInputValidator = v.object({
  id: v.string(),
  uri: v.string(),
  type: productEventEntityTypeValidator,
  name: v.string(),
  layer: productEventMemoryLayerValidator,
  confidence: v.number(),
});

export const productEventWorkspaceEvidenceInputValidator = v.object({
  id: v.string(),
  sourceId: v.optional(v.number()),
  sourceRefId: v.optional(v.string()),
  layer: productEventMemoryLayerValidator,
  title: v.string(),
  visibility: productEventVisibilityValidator,
  reusable: v.boolean(),
});

export const productEventWorkspaceClaimInputValidator = v.object({
  id: v.string(),
  subjectId: v.string(),
  claim: v.string(),
  status: productEventClaimStatusValidator,
  visibility: productEventVisibilityValidator,
  evidenceIds: v.array(v.string()),
  promotionGate: productEventPromotionGateValidator,
});

export const productEventWorkspaceFollowUpInputValidator = v.object({
  id: v.string(),
  owner: v.string(),
  action: v.string(),
  linkedEntityIds: v.array(v.string()),
  due: v.union(v.literal("today"), v.literal("this_week"), v.literal("later")),
  priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  status: v.optional(v.union(v.literal("open"), v.literal("done"), v.literal("dismissed"))),
});

export const productEventBudgetDecisionInputValidator = v.object({
  scenario: v.string(),
  actorType: productEventActorTypeValidator,
  route: v.array(productEventBudgetRouteStepValidator),
  paidCallsUsed: v.number(),
  requiresApproval: v.boolean(),
  persistedLayer: productEventMemoryLayerValidator,
});

export const productEventCaptureInputValidator = v.object({
  captureId: v.string(),
  eventSessionId: v.optional(v.string()),
  kind: productEventCaptureKindValidator,
  rawText: v.optional(v.string()),
  transcript: v.optional(v.string()),
  artifactId: v.optional(v.string()),
  extractedEntityIds: v.array(v.string()),
  extractedClaimIds: v.array(v.string()),
  confidence: v.number(),
  status: productEventCaptureStatusValidator,
  createdAt: v.optional(v.number()),
});

export const productActivityTypeValidator = v.union(
  v.literal("report_opened"),
  v.literal("workspace_opened"),
  v.literal("chat_message"),
  v.literal("tool_call"),
  v.literal("source_attached"),
  v.literal("claim_changed"),
  v.literal("notebook_edited"),
  v.literal("notebook_patch_proposed"),
  v.literal("notebook_patch_accepted"),
  v.literal("notebook_patch_rejected"),
  v.literal("capture_recorded"),
  v.literal("graph_node_opened"),
  v.literal("graph_edge_opened"),
  v.literal("export_previewed"),
  v.literal("export_completed"),
  v.literal("search_budget_decision"),
  v.literal("cli_action"),
  v.literal("mcp_action"),
);

export const productActivityActorTypeValidator = v.union(
  v.literal("user"),
  v.literal("agent"),
  v.literal("system"),
  v.literal("cli"),
  v.literal("mcp"),
);

export const productActivityPrivacyScopeValidator = v.union(
  v.literal("private"),
  v.literal("team"),
  v.literal("tenant"),
  v.literal("public_cache"),
  v.literal("aggregate_anonymized"),
);

export const productActivityPayloadPreviewValidator = v.object({
  label: v.string(),
  detail: v.optional(v.string()),
  status: v.optional(v.string()),
  costCents: v.optional(v.number()),
  paidCallsUsed: v.optional(v.number()),
  searchCallsAvoided: v.optional(v.number()),
  cacheHitRate: v.optional(v.number()),
  sourceReuseCount: v.optional(v.number()),
  timeToFirstSourcedAnswerMs: v.optional(v.number()),
  href: v.optional(v.string()),
  metadata: v.optional(v.any()),
});

export const productReportExportFormatValidator = v.union(
  v.literal("crm_csv"),
  v.literal("csv"),
  v.literal("hubspot_csv"),
  v.literal("salesforce_csv"),
  v.literal("attio_csv"),
  v.literal("affinity_csv"),
  v.literal("notion_csv"),
  v.literal("json"),
  v.literal("markdown"),
);

export const productReportExportStatusValidator = v.union(
  v.literal("previewed"),
  v.literal("completed"),
  v.literal("cancelled"),
);

export const productReportExportRowTypeValidator = v.union(
  v.literal("contact"),
  v.literal("company"),
  v.literal("interaction"),
  v.literal("followup"),
  v.literal("claim"),
  v.literal("source"),
);

export const productPublicCards = defineTable({
  key: v.string(),
  title: v.string(),
  summary: v.string(),
  prompt: v.string(),
  lens: productLensValidator,
  visibility: v.union(v.literal("public"), v.literal("internal")),
  sourceLabel: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  rank: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_key", ["key"])
  .index("by_visibility_rank", ["visibility", "rank"]);

export const productMigrationState = defineTable({
  ownerKey: v.string(),
  schemaVersion: v.string(),
  bootstrappedAt: v.number(),
  claimedAnonymousRows: v.optional(v.number()),
  migratedFiles: v.number(),
  migratedDocuments: v.number(),
  migratedReports: v.number(),
  updatedAt: v.number(),
}).index("by_owner", ["ownerKey"]);

export const productInputBundles = defineTable({
  ownerKey: v.string(),
  query: v.string(),
  lens: productLensValidator,
  entrySurface: v.union(
    v.literal("home"),
    v.literal("chat"),
    v.literal("reports"),
    v.literal("nudges"),
    v.literal("me"),
  ),
  status: v.union(
    v.literal("draft"),
    v.literal("queued"),
    v.literal("processing"),
    v.literal("complete"),
    v.literal("error"),
  ),
  rawText: v.optional(v.string()),
  links: v.optional(v.array(v.string())),
  uploadedFiles: v.optional(
    v.array(
      v.object({
        evidenceId: v.optional(v.id("productEvidenceItems")),
        name: v.string(),
        type: v.string(),
        size: v.optional(v.number()),
      }),
    ),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_owner_updated", ["ownerKey", "updatedAt"]);

export const productEvidenceItems = defineTable({
  ownerKey: v.string(),
  bundleId: v.optional(v.id("productInputBundles")),
  reportId: v.optional(v.id("productReports")),
  sessionId: v.optional(v.id("productChatSessions")),
  entityId: v.optional(v.id("productEntities")),
  type: productEvidenceTypeValidator,
  label: v.string(),
  description: v.optional(v.string()),
  status: v.union(
    v.literal("ready"),
    v.literal("processing"),
    v.literal("linked"),
  ),
  sourceUrl: v.optional(v.string()),
  sourceDomain: v.optional(v.string()),
  publishedAt: v.optional(v.string()),
  snapshotHash: v.optional(v.string()),
  mimeType: v.optional(v.string()),
  textPreview: v.optional(v.string()),
  matchedEntityId: v.optional(v.id("productEntities")),
  matchedEntityConfidence: v.optional(v.number()),
  freshnessStatus: v.optional(productFreshnessStatusValidator),
  retrievalQuery: v.optional(v.string()),
  legacyFileId: v.optional(v.id("files")),
  legacyDocumentId: v.optional(v.id("documents")),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_updated", ["ownerKey", "updatedAt"])
  .index("by_owner_bundle", ["ownerKey", "bundleId"])
  .index("by_owner_report", ["ownerKey", "reportId"])
  .index("by_owner_session", ["ownerKey", "sessionId"])
  .index("by_owner_entity", ["ownerKey", "entityId"])
  .index("by_owner_legacy_file", ["ownerKey", "legacyFileId"])
  .index("by_owner_legacy_document", ["ownerKey", "legacyDocumentId"]);

export const productChatSessions = defineTable({
  ownerKey: v.string(),
  bundleId: v.optional(v.id("productInputBundles")),
  linkedReportId: v.optional(v.id("productReports")),
  query: v.string(),
  lens: productLensValidator,
  title: v.string(),
  intentKind: v.optional(productRequestKindValidator),
  resolutionState: v.optional(productResolutionStateValidator),
  resolvedEntityId: v.optional(v.id("productEntities")),
  resolvedEntitySlug: v.optional(v.string()),
  resolutionConfidence: v.optional(v.number()),
  resolutionReason: v.optional(v.string()),
  artifactState: v.optional(productArtifactStateValidator),
  saveEligibility: v.optional(productSaveEligibilityValidator),
  saveEligibilityReason: v.optional(v.string()),
  status: v.union(
    v.literal("queued"),
    v.literal("streaming"),
    v.literal("complete"),
    v.literal("error"),
  ),
  latestSummary: v.optional(v.string()),
  lastError: v.optional(v.string()),
  totalDurationMs: v.optional(v.number()),
  verdict: v.optional(productRunVerdictValidator),
  gateResults: v.optional(v.array(productRunGateResultValidator)),
  costUsd: v.optional(v.number()),
  needsAttention: v.optional(v.boolean()),
  routing: v.optional(productRoutingDecisionValidator),
  operatorContext: v.optional(productOperatorContextSnapshotValidator),
  autoSavedReportId: v.optional(v.id("productReports")),
  deletedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_updated", ["ownerKey", "updatedAt"])
  .index("by_owner_report", ["ownerKey", "linkedReportId"]);

export const productChatEvents = defineTable({
  ownerKey: v.string(),
  sessionId: v.id("productChatSessions"),
  type: v.union(
    v.literal("message"),
    v.literal("system"),
    v.literal("milestone"),
    v.literal("error"),
  ),
  label: v.string(),
  body: v.string(),
  payload: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_session_created", ["sessionId", "createdAt"])
  .index("by_owner_created", ["ownerKey", "createdAt"]);

export const productToolEvents = defineTable({
  ownerKey: v.string(),
  sessionId: v.id("productChatSessions"),
  tool: v.string(),
  provider: v.optional(v.string()),
  model: v.optional(v.string()),
  step: v.number(),
  totalPlanned: v.number(),
  reason: v.optional(v.string()),
  status: v.union(v.literal("running"), v.literal("done"), v.literal("error")),
  durationMs: v.optional(v.number()),
  tokensIn: v.optional(v.number()),
  tokensOut: v.optional(v.number()),
  preview: v.optional(v.string()),
  startedAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_session_step", ["sessionId", "step"])
  .index("by_owner_updated", ["ownerKey", "updatedAt"]);

export const productRunEvents = defineTable({
  ownerKey: v.string(),
  sessionId: v.id("productChatSessions"),
  kind: productRunEventKindValidator,
  status: productRunEventStatusValidator,
  label: v.string(),
  tool: v.optional(v.string()),
  provider: v.optional(v.string()),
  model: v.optional(v.string()),
  step: v.optional(v.number()),
  totalPlanned: v.optional(v.number()),
  payload: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_session_created", ["sessionId", "createdAt"])
  .index("by_owner_created", ["ownerKey", "createdAt"])
  .index("by_session_kind_created", ["sessionId", "kind", "createdAt"]);

export const productResolutionCandidates = defineTable({
  ownerKey: v.string(),
  sessionId: v.id("productChatSessions"),
  entityId: v.optional(v.id("productEntities")),
  candidateKey: v.string(),
  label: v.string(),
  slug: v.string(),
  confidence: v.number(),
  reason: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_session_confidence", ["sessionId", "confidence"])
  .index("by_owner_updated", ["ownerKey", "updatedAt"]);

export const productSourceEvents = defineTable({
  ownerKey: v.string(),
  sessionId: v.id("productChatSessions"),
  sourceKey: v.string(),
  label: v.string(),
  href: v.optional(v.string()),
  type: v.optional(v.string()),
  status: v.optional(v.string()),
  title: v.optional(v.string()),
  domain: v.optional(v.string()),
  siteName: v.optional(v.string()),
  faviconUrl: v.optional(v.string()),
  publishedAt: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  imageCandidates: v.optional(v.array(v.string())),
  excerpt: v.optional(v.string()),
  confidence: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_session_created", ["sessionId", "createdAt"])
  .index("by_owner_created", ["ownerKey", "createdAt"]);

export const productReportDrafts = defineTable({
  ownerKey: v.string(),
  sessionId: v.id("productChatSessions"),
  title: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("building"),
    v.literal("complete"),
  ),
  sections: v.array(productReportSectionValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_session", ["sessionId"])
  .index("by_owner_updated", ["ownerKey", "updatedAt"]);

export const productClaims = defineTable({
  ownerKey: v.string(),
  sessionId: v.optional(v.id("productChatSessions")),
  reportId: v.optional(v.id("productReports")),
  entityId: v.optional(v.id("productEntities")),
  claimKey: v.string(),
  claimText: v.string(),
  claimType: productClaimTypeValidator,
  slotKey: v.string(),
  sectionId: v.string(),
  sourceRefIds: v.array(v.string()),
  supportStrength: productClaimSupportStrengthValidator,
  freshnessStatus: productFreshnessStatusValidator,
  contradictionFlag: v.boolean(),
  conflictClaimIds: v.optional(v.array(v.id("productClaims"))),
  publishable: v.boolean(),
  rejectionReasons: v.array(v.string()),
  gateResults: v.optional(v.array(productRunGateResultValidator)),
  // Public-by-default visibility for federated search. Optional so existing
  // rows back-compat to "public" (claims about public entities are
  // public-research-derived). Owner-private claims set "private".
  // See docs/architecture/CONVEX_FEDERATED_SEARCH.md (PR public-visibility).
  visibility: v.optional(
    v.union(v.literal("public"), v.literal("team"), v.literal("private")),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_session", ["ownerKey", "sessionId"])
  .index("by_owner_report", ["ownerKey", "reportId"])
  .index("by_owner_entity", ["ownerKey", "entityId"])
  .index("by_owner_publishable", ["ownerKey", "publishable"])
  .index("by_owner_claim_type", ["ownerKey", "claimType"])
  .index("by_owner_slot_key", ["ownerKey", "slotKey"])
  .index("by_owner_created", ["ownerKey", "createdAt"])
  // Federated search: index claimText directly (already a single string).
  // Filter by ownerKey + claimType + publishable + visibility — visibility
  // lets the federated search action surface public claims to anonymous
  // callers via a separate eq("visibility", "public") branch.
  .searchIndex("search_claims", {
    searchField: "claimText",
    filterFields: ["ownerKey", "claimType", "publishable", "visibility"],
  });

export const productClaimSupports = defineTable({
  ownerKey: v.string(),
  claimId: v.id("productClaims"),
  evidenceId: v.id("productEvidenceItems"),
  sessionId: v.optional(v.id("productChatSessions")),
  reportId: v.optional(v.id("productReports")),
  sourceRefId: v.string(),
  spanText: v.string(),
  spanHash: v.string(),
  supportType: productClaimSupportTypeValidator,
  entityId: v.optional(v.id("productEntities")),
  freshnessStatus: productFreshnessStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_claim", ["claimId"])
  .index("by_evidence", ["evidenceId"])
  .index("by_owner_created", ["ownerKey", "createdAt"]);

export const productClaimReviews = defineTable({
  ownerKey: v.string(),
  claimId: v.id("productClaims"),
  sessionId: v.optional(v.id("productChatSessions")),
  reportId: v.optional(v.id("productReports")),
  reviewer: v.union(v.literal("deterministic"), v.literal("llm")),
  status: v.union(
    v.literal("approved"),
    v.literal("rejected"),
    v.literal("needs_review"),
  ),
  reasoning: v.optional(v.string()),
  gateResults: v.optional(v.array(productRunGateResultValidator)),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_claim", ["claimId"])
  .index("by_owner_created", ["ownerKey", "createdAt"])
  .index("by_owner_session", ["ownerKey", "sessionId"]);

export const productEntities = defineTable({
  ownerKey: v.string(),
  slug: v.string(),
  name: v.string(),
  entityType: v.string(),
  summary: v.string(),
  savedBecause: v.optional(v.string()),
  latestReportId: v.optional(v.id("productReports")),
  latestReportUpdatedAt: v.optional(v.number()),
  latestRevision: v.number(),
  reportCount: v.number(),
  // Denormalized concat of name + slug + summary + savedBecause for the
  // federated `search_entities` index. Maintained by entity upsert helpers.
  // Optional because existing rows are backfilled lazily on next mutation.
  searchableText: v.optional(v.string()),
  // Vector embedding of `searchableText` for the federated `vec_entities`
  // hybrid search index (PR E). 1536-dim from OpenAI text-embedding-3-small
  // — matches the model already used by knowledgeGraph.ts. Optional because
  // existing rows are backfilled lazily; un-embedded rows still appear in
  // keyword results, just not vector results.
  embedding: v.optional(v.array(v.float64())),
  // Public-by-default visibility for federated entity search. Optional —
  // pre-existing rows are backfilled to "public" (most NodeBench entities
  // like "Anthropic" or "OpenAI" are public-research-derived). Owners who
  // want to keep an entity private explicitly set "private".
  // See docs/architecture/CONVEX_FEDERATED_SEARCH.md (PR public-visibility).
  visibility: v.optional(
    v.union(v.literal("public"), v.literal("team"), v.literal("private")),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_updated", ["ownerKey", "updatedAt"])
  .index("by_owner_slug", ["ownerKey", "slug"])
  .index("by_owner_name", ["ownerKey", "name"])
  .searchIndex("search_entities", {
    searchField: "searchableText",
    // visibility is filterable so anonymous federated search can run a
    // separate eq("visibility", "public") branch in parallel with the
    // owner-scoped branch — and dedupe the merged result.
    filterFields: ["ownerKey", "entityType", "visibility"],
  })
  .vectorIndex("vec_entities", {
    vectorField: "embedding",
    dimensions: 1536,
    filterFields: ["ownerKey", "entityType", "visibility"],
  });

export const productEntityNotes = defineTable({
  ownerKey: v.string(),
  entityId: v.id("productEntities"),
  content: v.string(),
  blocks: v.optional(v.array(productNoteBlockValidator)),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity", ["entityId"])
  .index("by_owner_updated", ["ownerKey", "updatedAt"]);

export const productWorkspaceShareAccessValidator = v.union(
  v.literal("view"),
  v.literal("edit"),
);

export const productWorkspaceShareResourceValidator =
  v.literal("entity_workspace");

export const productWorkspaceInviteStatusValidator = v.union(
  v.literal("pending"),
  v.literal("accepted"),
);

export const productWorkspaceInviteDeliveryStatusValidator = v.union(
  v.literal("sent"),
  v.literal("link_only"),
);

export const productWorkspaceShares = defineTable({
  ownerKey: v.string(),
  resourceType: productWorkspaceShareResourceValidator,
  entityId: v.id("productEntities"),
  entitySlug: v.string(),
  token: v.string(),
  access: productWorkspaceShareAccessValidator,
  revokedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_token", ["token"])
  .index("by_owner_entity", ["ownerKey", "entityId", "updatedAt"])
  .index("by_owner_entity_access", [
    "ownerKey",
    "entityId",
    "access",
    "updatedAt",
  ])
  .index("by_owner_updated", ["ownerKey", "updatedAt"]);

export const productEntityWorkspaceMembers = defineTable({
  ownerKey: v.string(),
  entityId: v.id("productEntities"),
  entitySlug: v.string(),
  userId: v.id("users"),
  userEmail: v.string(),
  userName: v.optional(v.string()),
  userImage: v.optional(v.string()),
  token: v.string(),
  access: productWorkspaceShareAccessValidator,
  invitedByUserId: v.optional(v.id("users")),
  notificationStatus: v.optional(productWorkspaceInviteDeliveryStatusValidator),
  notificationUpdatedAt: v.optional(v.number()),
  notificationMessageId: v.optional(v.string()),
  notificationError: v.optional(v.string()),
  revokedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_token", ["token"])
  .index("by_owner_entity_user", ["ownerKey", "entityId", "userId"])
  .index("by_owner_entity_updated", ["ownerKey", "entityId", "updatedAt"])
  .index("by_user_updated", ["userId", "updatedAt"]);

export const productEntityWorkspaceInvites = defineTable({
  ownerKey: v.string(),
  entityId: v.id("productEntities"),
  entitySlug: v.string(),
  email: v.string(),
  normalizedEmail: v.string(),
  token: v.string(),
  access: productWorkspaceShareAccessValidator,
  status: productWorkspaceInviteStatusValidator,
  invitedByUserId: v.optional(v.id("users")),
  acceptedByUserId: v.optional(v.id("users")),
  notificationStatus: v.optional(productWorkspaceInviteDeliveryStatusValidator),
  notificationUpdatedAt: v.optional(v.number()),
  notificationMessageId: v.optional(v.string()),
  notificationError: v.optional(v.string()),
  revokedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  acceptedAt: v.optional(v.number()),
})
  .index("by_token", ["token"])
  .index("by_owner_entity_email", [
    "ownerKey",
    "entityId",
    "normalizedEmail",
    "updatedAt",
  ])
  .index("by_owner_entity_updated", ["ownerKey", "entityId", "updatedAt"]);

export const productEntityRelations = defineTable({
  ownerKey: v.string(),
  fromEntitySlug: v.string(),
  toEntitySlug: v.string(),
  relation: v.string(),
  summary: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_from", ["ownerKey", "fromEntitySlug"])
  .index("by_owner_to", ["ownerKey", "toEntitySlug"])
  .index("by_owner_pair", ["ownerKey", "fromEntitySlug", "toEntitySlug"]);

export const productDocuments = defineTable({
  ownerKey: v.string(),
  kind: productDocumentKindValidator,
  title: v.string(),
  entityId: v.optional(v.id("productEntities")),
  entitySlug: v.optional(v.string()),
  linkedReportId: v.optional(v.id("productReports")),
  markdown: v.string(),
  plainText: v.string(),
  lexicalState: v.optional(v.any()),
  latestRevision: v.number(),
  latestSnapshotId: v.optional(v.id("productDocumentSnapshots")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_updated", ["ownerKey", "updatedAt"])
  .index("by_owner_entity_kind", ["ownerKey", "entitySlug", "kind"])
  .index("by_owner_report_kind", ["ownerKey", "linkedReportId", "kind"]);

export const productDocumentBlocks = defineTable({
  ownerKey: v.string(),
  documentId: v.id("productDocuments"),
  blockId: v.string(),
  parentBlockId: v.optional(v.string()),
  order: v.number(),
  type: productDocumentBlockTypeValidator,
  depth: v.optional(v.number()),
  text: v.string(),
  markdown: v.optional(v.string()),
  lexical: v.optional(v.any()),
  entityRefs: v.optional(v.array(v.string())),
  sourceRefs: v.optional(v.array(v.string())),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_document_order", ["documentId", "order"])
  .index("by_owner_document", ["ownerKey", "documentId"]);

export const productDocumentEntityLinks = defineTable({
  ownerKey: v.string(),
  documentId: v.id("productDocuments"),
  blockId: v.optional(v.string()),
  entitySlug: v.string(),
  relation: v.union(v.literal("primary"), v.literal("mention")),
  createdAt: v.number(),
})
  .index("by_document", ["documentId"])
  .index("by_entity_slug", ["entitySlug"]);

export const productDocumentSourceLinks = defineTable({
  ownerKey: v.string(),
  documentId: v.id("productDocuments"),
  blockId: v.optional(v.string()),
  evidenceId: v.id("productEvidenceItems"),
  createdAt: v.number(),
})
  .index("by_document", ["documentId"])
  .index("by_evidence", ["evidenceId"]);

export const productDocumentEvents = defineTable({
  ownerKey: v.string(),
  documentId: v.id("productDocuments"),
  type: v.union(
    v.literal("created"),
    v.literal("edited"),
    v.literal("snapshot"),
    v.literal("imported"),
    v.literal("exported"),
  ),
  label: v.string(),
  summary: v.optional(v.string()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_document_created", ["documentId", "createdAt"])
  .index("by_owner_created", ["ownerKey", "createdAt"]);

export const productDocumentSnapshots = defineTable({
  ownerKey: v.string(),
  documentId: v.id("productDocuments"),
  revision: v.number(),
  markdown: v.string(),
  plainText: v.string(),
  lexicalState: v.optional(v.any()),
  blockCount: v.number(),
  summary: v.string(),
  createdAt: v.number(),
})
  .index("by_document_revision", ["documentId", "revision"])
  .index("by_owner_created", ["ownerKey", "createdAt"]);

export const productReports = defineTable({
  ownerKey: v.string(),
  sessionId: v.optional(v.id("productChatSessions")),
  bundleId: v.optional(v.id("productInputBundles")),
  legacyDocumentId: v.optional(v.id("documents")),
  entityId: v.optional(v.id("productEntities")),
  entitySlug: v.optional(v.string()),
  title: v.string(),
  type: v.string(),
  summary: v.string(),
  status: v.union(
    v.literal("draft"),
    v.literal("saved"),
    v.literal("published"),
    v.literal("archived"),
  ),
  resolutionState: v.optional(productResolutionStateValidator),
  artifactState: v.optional(productArtifactStateValidator),
  saveEligibility: v.optional(productSaveEligibilityValidator),
  primaryEntity: v.optional(v.string()),
  lens: productLensValidator,
  query: v.string(),
  routing: v.optional(productRoutingDecisionValidator),
  operatorContext: v.optional(productOperatorContextSnapshotValidator),
  sections: v.array(productReportSectionValidator),
  sources: v.array(productSourceValidator),
  evidenceItemIds: v.array(v.id("productEvidenceItems")),
  claimIds: v.optional(v.array(v.id("productClaims"))),
  compiledAnswerV2: v.optional(
    v.object({
      resolutionState: productResolutionStateValidator,
      artifactState: productArtifactStateValidator,
      saveEligibility: productSaveEligibilityValidator,
      truthSections: v.array(productCompiledSectionValidator),
      actions: v.array(productActionItemValidator),
    }),
  ),
  qualityGateSummary: v.optional(productClaimLedgerSummaryValidator),
  revision: v.optional(v.number()),
  previousReportId: v.optional(v.id("productReports")),
  pinned: v.boolean(),
  visibility: v.union(
    v.literal("private"),
    v.literal("workspace"),
    v.literal("public"),
  ),
  lastRefreshAt: v.optional(v.number()),
  // Free-form web-notebook HTML — owner-edited via the dedicated web report
  // notebook surface (ReportNotebookDetail). Stored as a single string so we
  // don't fragment notebook semantics across multiple tables; the workspace
  // surface continues to use sections/compiledAnswerV2 directly.
  notebookHtml: v.optional(v.string()),
  // Denormalized concat of title + summary + query + primaryEntity for the
  // federated `search_reports` index. Maintained by report mutations.
  searchableText: v.optional(v.string()),
  // Vector embedding of `searchableText` for the federated `vec_reports`
  // hybrid search index (PR E). 1536-dim from OpenAI text-embedding-3-small.
  // Optional — backfilled lazily; missing embeddings simply skip vector
  // matching for the row.
  embedding: v.optional(v.array(v.float64())),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_updated", ["ownerKey", "updatedAt"])
  .index("by_owner_pinned", ["ownerKey", "pinned"])
  .index("by_owner_legacy_document", ["ownerKey", "legacyDocumentId"])
  .index("by_owner_session", ["ownerKey", "sessionId"])
  .index("by_owner_entity_updated", ["ownerKey", "entitySlug", "updatedAt"])
  .searchIndex("search_reports", {
    searchField: "searchableText",
    filterFields: ["ownerKey", "type", "status", "visibility"],
  })
  .vectorIndex("vec_reports", {
    vectorField: "embedding",
    dimensions: 1536,
    filterFields: ["ownerKey", "type", "status", "visibility"],
  });

export const productReportRefreshes = defineTable({
  ownerKey: v.string(),
  reportId: v.id("productReports"),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("complete"),
    v.literal("error"),
  ),
  triggeredBy: v.union(
    v.literal("user"),
    v.literal("nudge"),
    v.literal("system"),
  ),
  summary: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_report_created", ["reportId", "createdAt"])
  .index("by_owner_created", ["ownerKey", "createdAt"]);

export const productEventWorkspaces = defineTable({
  ownerKey: v.string(),
  workspaceId: v.string(),
  eventId: v.string(),
  title: v.string(),
  reportId: v.optional(v.id("productReports")),
  defaultTabs: v.array(productEventWorkspaceTabValidator),
  source: productEventWorkspaceSourceValidator,
  // Optional — pre-existing data drift; tracked here so schema validates.
  activeEventSessionId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_workspace", ["ownerKey", "workspaceId"])
  .index("by_owner_event", ["ownerKey", "eventId"])
  .index("by_owner_updated", ["ownerKey", "updatedAt"]);

export const productEventWorkspaceEntities = defineTable({
  ownerKey: v.string(),
  workspaceId: v.string(),
  eventId: v.string(),
  entityKey: v.string(),
  uri: v.string(),
  entityType: productEventEntityTypeValidator,
  name: v.string(),
  layer: productEventMemoryLayerValidator,
  confidence: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_workspace", ["ownerKey", "workspaceId"])
  .index("by_owner_workspace_entity", ["ownerKey", "workspaceId", "entityKey"])
  .index("by_owner_uri", ["ownerKey", "uri"]);

export const productEventWorkspaceEvidence = defineTable({
  ownerKey: v.string(),
  workspaceId: v.string(),
  eventId: v.string(),
  evidenceKey: v.string(),
  sourceId: v.optional(v.number()),
  sourceRefId: v.optional(v.string()),
  layer: productEventMemoryLayerValidator,
  title: v.string(),
  visibility: productEventVisibilityValidator,
  reusable: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_workspace", ["ownerKey", "workspaceId"])
  .index("by_owner_workspace_evidence", ["ownerKey", "workspaceId", "evidenceKey"])
  .index("by_owner_workspace_visibility", ["ownerKey", "workspaceId", "visibility"]);

export const productEventWorkspaceClaims = defineTable({
  ownerKey: v.string(),
  workspaceId: v.string(),
  eventId: v.string(),
  claimKey: v.string(),
  subjectEntityKey: v.string(),
  claim: v.string(),
  status: productEventClaimStatusValidator,
  visibility: productEventVisibilityValidator,
  evidenceKeys: v.array(v.string()),
  promotionGate: productEventPromotionGateValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_workspace", ["ownerKey", "workspaceId"])
  .index("by_owner_workspace_claim", ["ownerKey", "workspaceId", "claimKey"])
  .index("by_owner_workspace_status", ["ownerKey", "workspaceId", "status"]);

export const productEventWorkspaceFollowUps = defineTable({
  ownerKey: v.string(),
  workspaceId: v.string(),
  eventId: v.string(),
  followUpKey: v.string(),
  owner: v.string(),
  action: v.string(),
  linkedEntityKeys: v.array(v.string()),
  due: v.union(v.literal("today"), v.literal("this_week"), v.literal("later")),
  priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  status: v.union(v.literal("open"), v.literal("done"), v.literal("dismissed")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_workspace", ["ownerKey", "workspaceId"])
  .index("by_owner_workspace_followup", ["ownerKey", "workspaceId", "followUpKey"])
  .index("by_owner_workspace_status", ["ownerKey", "workspaceId", "status"]);

export const productEventBudgetDecisions = defineTable({
  ownerKey: v.string(),
  workspaceId: v.string(),
  eventId: v.string(),
  scenario: v.string(),
  actorType: productEventActorTypeValidator,
  route: v.array(productEventBudgetRouteStepValidator),
  paidCallsUsed: v.number(),
  requiresApproval: v.boolean(),
  persistedLayer: productEventMemoryLayerValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_workspace", ["ownerKey", "workspaceId"])
  .index("by_owner_workspace_scenario", ["ownerKey", "workspaceId", "scenario"]);

export const productEventCaptures = defineTable({
  ownerKey: v.string(),
  workspaceId: v.string(),
  eventId: v.string(),
  eventSessionId: v.optional(v.string()),
  captureKey: v.string(),
  kind: productEventCaptureKindValidator,
  rawText: v.optional(v.string()),
  transcript: v.optional(v.string()),
  artifactId: v.optional(v.string()),
  status: productEventCaptureStatusValidator,
  extractedEntityKeys: v.array(v.string()),
  extractedClaimKeys: v.array(v.string()),
  confidence: v.number(),
  visibility: productEventVisibilityValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_workspace", ["ownerKey", "workspaceId"])
  .index("by_owner_session", ["ownerKey", "eventSessionId"])
  .index("by_owner_capture", ["ownerKey", "captureKey"])
  .index("by_owner_workspace_status", ["ownerKey", "workspaceId", "status"]);

export const productEventRunRecords = defineTable({
  ownerKey: v.string(),
  workspaceId: v.string(),
  eventId: v.string(),
  runId: v.string(),
  eventSessionId: v.optional(v.string()),
  source: productEventWorkspaceSourceValidator,
  status: productEventRunStatusValidator,
  entityKeys: v.array(v.string()),
  claimKeys: v.array(v.string()),
  evidenceKeys: v.array(v.string()),
  followUpKeys: v.array(v.string()),
  budgetScenarioKeys: v.array(v.string()),
  captureKeys: v.array(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_workspace", ["ownerKey", "workspaceId"])
  .index("by_owner_run", ["ownerKey", "runId"])
  .index("by_owner_status", ["ownerKey", "status"]);

export const productActivityLedger = defineTable({
  ownerKey: v.string(),
  reportId: v.optional(v.id("productReports")),
  workspaceId: v.optional(v.string()),
  entitySlug: v.optional(v.string()),
  eventId: v.optional(v.string()),
  activityType: productActivityTypeValidator,
  actorType: productActivityActorTypeValidator,
  visibility: productEventVisibilityValidator,
  privacyScope: productActivityPrivacyScopeValidator,
  entityKeys: v.array(v.string()),
  claimKeys: v.array(v.string()),
  sourceKeys: v.array(v.string()),
  runId: v.optional(v.string()),
  sessionId: v.optional(v.string()),
  payloadPreview: productActivityPayloadPreviewValidator,
  createdAt: v.number(),
})
  .index("by_owner_created", ["ownerKey", "createdAt"])
  .index("by_owner_report_created", ["ownerKey", "reportId", "createdAt"])
  .index("by_owner_workspace_created", ["ownerKey", "workspaceId", "createdAt"])
  .index("by_owner_entity_created", ["ownerKey", "entitySlug", "createdAt"])
  .index("by_owner_activity_created", ["ownerKey", "activityType", "createdAt"]);

export const productReportExports = defineTable({
  ownerKey: v.string(),
  reportId: v.id("productReports"),
  workspaceId: v.optional(v.string()),
  exportKey: v.string(),
  format: productReportExportFormatValidator,
  status: productReportExportStatusValidator,
  rowCounts: v.object({
    contacts: v.number(),
    companies: v.number(),
    interactions: v.number(),
    followups: v.number(),
    claims: v.number(),
    sources: v.number(),
  }),
  privacyScope: productActivityPrivacyScopeValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_report", ["ownerKey", "reportId"])
  .index("by_owner_export", ["ownerKey", "exportKey"])
  .index("by_owner_updated", ["ownerKey", "updatedAt"]);

export const productReportExportRows = defineTable({
  ownerKey: v.string(),
  exportKey: v.string(),
  reportId: v.id("productReports"),
  rowType: productReportExportRowTypeValidator,
  rowKey: v.string(),
  label: v.string(),
  nodebenchUri: v.optional(v.string()),
  confidence: v.number(),
  source: v.string(),
  privacyScope: productActivityPrivacyScopeValidator,
  verificationStatus: productEventClaimStatusValidator,
  data: v.any(),
  createdAt: v.number(),
})
  .index("by_owner_export", ["ownerKey", "exportKey"])
  .index("by_owner_report", ["ownerKey", "reportId"])
  .index("by_owner_row_type", ["ownerKey", "rowType"]);

export const productNudgeTypeValidator = v.union(
  v.literal("follow_up_due"),
  v.literal("new_source_found"),
  v.literal("report_changed"),
  v.literal("saved_watch_item_changed"),
  v.literal("connector_message_detected"),
  v.literal("cron_summary"),
  v.literal("reply_draft_ready"),
  v.literal("refresh_recommended"),
);

export const productNudges = defineTable({
  ownerKey: v.string(),
  type: productNudgeTypeValidator,
  title: v.string(),
  summary: v.string(),
  linkedReportId: v.optional(v.id("productReports")),
  linkedChatSessionId: v.optional(v.id("productChatSessions")),
  linkedChannel: v.optional(v.string()),
  status: v.union(v.literal("open"), v.literal("snoozed"), v.literal("done")),
  priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  dueAt: v.optional(v.number()),
  actionLabel: v.string(),
  actionTargetSurface: v.optional(v.string()),
  actionTargetId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_status_updated", ["ownerKey", "status", "updatedAt"])
  .index("by_owner_due", ["ownerKey", "dueAt"])
  .index("by_owner_report", ["ownerKey", "linkedReportId"]);

export const productProfileSummaries = defineTable({
  ownerKey: v.string(),
  backgroundSummary: v.string(),
  preferredLens: productLensValidator,
  rolesOfInterest: v.array(v.string()),
  location: v.optional(v.string()),
  preferences: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_owner", ["ownerKey"]);

export const productContextItems = defineTable({
  ownerKey: v.string(),
  type: v.union(
    v.literal("company"),
    v.literal("person"),
    v.literal("role"),
    v.literal("note"),
    v.literal("report"),
    v.literal("file"),
    v.literal("preference"),
    v.literal("observation"),
    v.literal("question"),
    v.literal("action"),
  ),
  title: v.string(),
  summary: v.string(),
  tags: v.array(v.string()),
  entity: v.optional(v.string()),
  linkedReportId: v.optional(v.id("productReports")),
  legacyFileId: v.optional(v.id("files")),
  legacyDocumentId: v.optional(v.id("documents")),
  permissions: v.object({
    chat: v.boolean(),
    reports: v.boolean(),
    nudges: v.boolean(),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_updated", ["ownerKey", "updatedAt"])
  .index("by_owner_type", ["ownerKey", "type"])
  .index("by_owner_entity", ["ownerKey", "entity"])
  .index("by_owner_legacy_file", ["ownerKey", "legacyFileId"])
  .index("by_owner_legacy_document", ["ownerKey", "legacyDocumentId"])
  .index("by_owner_linked_report", ["ownerKey", "linkedReportId"]);

// ──────────────────────────────────────────────────────────────────────────
// Block model (Phase 1 of Ideaflow/Mew-inspired notebook)
// Inspired by Mew's graph_node + relation_lists with fractional indexing.
// See docs/architecture/IDEAFLOW_BLOCK_NOTEBOOK_ULTRAPLAN.md
// ──────────────────────────────────────────────────────────────────────────

export const productBlockKindValidator = v.union(
  v.literal("text"),
  v.literal("heading_1"),
  v.literal("heading_2"),
  v.literal("heading_3"),
  v.literal("bullet"),
  v.literal("todo"),
  v.literal("quote"),
  v.literal("callout"),
  v.literal("code"),
  v.literal("image"),
  v.literal("evidence"),
  v.literal("mention"),
  v.literal("generated_marker"),
);

export const productBlockChipValidator = v.object({
  type: v.union(
    v.literal("text"),
    v.literal("mention"),
    v.literal("link"),
    v.literal("linebreak"),
    v.literal("image"),
  ),
  value: v.string(),
  url: v.optional(v.string()),
  // Bitmap: 1=bold, 2=italic, 4=underline, 8=strike, 16=code. Combinable.
  styles: v.optional(v.number()),
  mentionTrigger: v.optional(v.string()), // "@", "#", "<>", "/ai", etc.
  mentionTarget: v.optional(v.string()),
});

export const productBlockAuthorKindValidator = v.union(
  v.literal("user"),
  v.literal("agent"),
  v.literal("anonymous"),
);

export const productBlockAccessValidator = v.union(
  v.literal("read"),
  v.literal("append"),
  v.literal("edit"),
);

export const productBlocks = defineTable({
  ownerKey: v.string(),
  entityId: v.id("productEntities"),
  parentBlockId: v.optional(v.id("productBlocks")),
  kind: productBlockKindValidator,
  authorKind: productBlockAuthorKindValidator,
  authorId: v.optional(v.string()),
  content: v.array(productBlockChipValidator),
  // Fractional indexing — never re-indexed; inserts use generateKeyBetween.
  positionInt: v.number(),
  positionFrac: v.string(),
  isChecked: v.optional(v.boolean()),
  accessMode: productBlockAccessValidator,
  isPublic: v.boolean(),
  // Link back to the agent run that produced this block (if agent-authored).
  sourceSessionId: v.optional(v.id("productChatSessions")),
  sourceToolStep: v.optional(v.number()),
  sourceRefIds: v.optional(v.array(v.string())),
  attributes: v.optional(v.any()),
  // Google Docs-style revision chain — previous incarnation if this block was rewritten.
  previousBlockId: v.optional(v.id("productBlocks")),
  revision: v.number(),
  deletedAt: v.optional(v.number()),
  // Denormalized text content for the federated `search_blocks` index.
  // Maintained on block upsert/edit. Optional so existing rows are
  // backfilled lazily on next mutation; deleted blocks have undefined.
  searchableText: v.optional(v.string()),
  // Vector embedding of `searchableText` for the federated `vec_blocks`
  // hybrid search index (PR E). 1536-dim from OpenAI text-embedding-3-small.
  // Optional; soft-deleted blocks have empty searchableText so we skip
  // generating an embedding for them.
  embedding: v.optional(v.array(v.float64())),
  // Public-by-default visibility for federated block search. Optional —
  // pre-existing rows are backfilled to "public" (the surrounding entity is
  // typically public; blocks that anchor private notes set "private").
  // See docs/architecture/CONVEX_FEDERATED_SEARCH.md (PR public-visibility).
  visibility: v.optional(
    v.union(v.literal("public"), v.literal("team"), v.literal("private")),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_position", [
    "entityId",
    "parentBlockId",
    "positionInt",
    "positionFrac",
  ])
  .index("by_owner_entity", ["ownerKey", "entityId"])
  .index("by_owner_entity_position", [
    "ownerKey",
    "entityId",
    "positionInt",
    "positionFrac",
  ])
  .index("by_owner_entity_parent_position", [
    "ownerKey",
    "entityId",
    "parentBlockId",
    "positionInt",
    "positionFrac",
  ])
  .index("by_entity_author_updated", ["entityId", "authorKind", "updatedAt"])
  .index("by_session_step", ["sourceSessionId", "sourceToolStep"])
  .index("by_previous", ["previousBlockId"])
  .searchIndex("search_blocks", {
    searchField: "searchableText",
    // visibility is filterable so anonymous callers can hit
    // eq("visibility", "public") in parallel with the owner-scoped branch.
    filterFields: ["ownerKey", "entityId", "kind", "authorKind", "visibility"],
  })
  .vectorIndex("vec_blocks", {
    vectorField: "embedding",
    dimensions: 1536,
    filterFields: ["ownerKey", "entityId", "kind", "authorKind", "visibility"],
  });

export const productBlockRelationKindValidator = v.union(
  v.literal("mention"),
  v.literal("tag"),
  v.literal("evidence"),
  v.literal("derived_from"),
  v.literal("response_to"),
  v.literal("custom"),
);

export const productBlockRelations = defineTable({
  ownerKey: v.string(),
  fromBlockId: v.id("productBlocks"),
  toEntityId: v.optional(v.id("productEntities")),
  toBlockId: v.optional(v.id("productBlocks")),
  toUrl: v.optional(v.string()),
  relationKind: productBlockRelationKindValidator,
  relationLabel: v.optional(v.string()),
  authorKind: productBlockAuthorKindValidator,
  authorId: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_owner_from", ["ownerKey", "fromBlockId"])
  .index("by_owner_entity", ["ownerKey", "toEntityId"])
  .index("by_owner_block", ["ownerKey", "toBlockId"])
  .index("by_owner_url", ["ownerKey", "toUrl"]);

export const productBlockWriteWindows = defineTable({
  ownerKey: v.string(),
  sessionKey: v.string(),
  actorKey: v.optional(v.string()),
  bucketStartMs: v.number(),
  shard: v.optional(v.number()),
  writeCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner_session_bucket", ["ownerKey", "sessionKey", "bucketStartMs"])
  .index("by_owner_session_actor_bucket", [
    "ownerKey",
    "sessionKey",
    "actorKey",
    "bucketStartMs",
  ]);

/**
 * productNudgeSubscriptions — "track this entity" subscriptions.
 *
 * Closes framework audit violation #5 (TRANSITION Report → Nudge).
 * One row per (ownerKey, entityId) subscription. A Convex cron scans
 * subscriptions every N minutes, diffs the entity's most-recent block
 * updatedAt against `lastNotifiedAt`, and when newer agent-authored
 * content exists, dispatches a single ntfy message and updates the
 * timestamp. No duplicate dispatch without new content.
 *
 * Per-user rate limit lives on the subscription row (minIntervalMs)
 * so an aggressive writer never storms a subscriber.
 */
export const productNudgeSubscriptions = defineTable({
  ownerKey: v.string(),
  entityId: v.id("productEntities"),
  entitySlug: v.string(),
  entityName: v.string(),
  // "ntfy" today; extensible to email / slack / webhook later. Dispatch
  // path resolves the destination from productProfileSummaries.
  channel: v.union(v.literal("ntfy"), v.literal("email"), v.literal("slack")),
  // When the user last reset their subscription (used for "since when").
  createdAt: v.number(),
  updatedAt: v.number(),
  // Last time the dispatcher fired for this subscription. Initialized to
  // createdAt so the first run doesn't replay every pre-subscription edit.
  lastNotifiedAt: v.number(),
  // Minimum gap between dispatches for THIS subscription. Prevents a
  // prolific agent from paging the subscriber more than once per window.
  minIntervalMs: v.optional(v.number()),
  // Optional dispatch target override (e.g. a per-user ntfy topic).
  // When null, dispatcher falls back to the system OPS_NTFY_URL env.
  ntfyUrl: v.optional(v.string()),
})
  // Primary lookup: "is this user subscribed to this entity?"
  .index("by_owner_entity", ["ownerKey", "entityId"])
  // Secondary lookup: "list all my subscriptions" — sorted by updatedAt.
  .index("by_owner_updated", ["ownerKey", "updatedAt"])
  // Dispatcher lookup: "which subscriptions haven't been checked recently?"
  .index("by_last_notified", ["lastNotifiedAt"]);

// ═══════════════════════════════════════════════════════════════════════════
// CANONICAL V2 SCHEMA — Notebook-centric runtime substrate
// NOTE: agentThreads, agentMessages, extendedThinkingRuns, agentScratchpads,
// extendedThinkingCheckpoints, diligenceProjections, agentActions, pulseReports,
// publicShares, deadLetters, entityMemoryIndex, entityMemoryTopics are all
// defined inline in convex/schema.ts. Only productNotebookPages is added here
// because it did not exist in the main schema prior to this change.
// ═══════════════════════════════════════════════════════════════════════════

export const productNotebookPages = defineTable({
  ownerKey: v.string(),
  entitySlug: v.string(),
  pageType: v.union(v.literal("entity"), v.literal("pulse")),
  title: v.string(),
  dateKey: v.optional(v.string()), // required for pulse pages, e.g. "2026-04-20"
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity_type", ["entitySlug", "pageType"])
  .index("by_entity_date", ["entitySlug", "dateKey"])
  .index("by_owner_updated", ["ownerKey", "updatedAt"]);


// ═══════════════════════════════════════════════════════════════════════════
// User sessions (D1) — powers the Avatar status panel "Recent sessions" list.
// One row per device + browser combo for an owner key.  The mutation upserts
// on lastSeenAt so the same MacBook · Chrome doesn't proliferate rows; the
// UI list reads top 3 sessions by `lastSeenAt` desc.
// ═══════════════════════════════════════════════════════════════════════════

export const productUserSessions = defineTable({
  ownerKey: v.string(),
  /** Stable session-instance key (browser sessionStorage id). One per tab. */
  sessionKey: v.string(),
  /** Human label rendered in the UI: "MacBook · Safari · SF". */
  deviceLabel: v.string(),
  /** First seen — the original auth/visit time. */
  firstSeenAt: v.number(),
  /** Last activity update — refreshed on every recordCurrentSession call. */
  lastSeenAt: v.number(),
  /** True for the row matching the current sessionKey on the calling client. */
  isCurrent: v.boolean(),
})
  .index("by_owner_lastseen", ["ownerKey", "lastSeenAt"])
  .index("by_owner_session", ["ownerKey", "sessionKey"]);
