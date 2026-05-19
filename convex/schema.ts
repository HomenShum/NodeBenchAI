// convex/schema.ts --------------------------------------------------------
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Domain schema imports
import {
  dossierFocusState,
  dossierAnnotations,
  dossierEnrichment,
} from "./domains/dossier/schema";

// Email schema imports
import {
  emailLabels,
  emailThreads,
  emailMessages,
  emailDailyReports,
  emailProcessingQueue,
  emailSyncState,
} from "./schema/emailSchema";

// Proactive system schema imports
import {
  proactiveEvents,
  opportunities,
  proactiveActions,
  detectorRuns,
  userProactiveSettings,
  proactiveFeedbackLabels,
  customDetectors,
  adminUsers,
  proactiveSubscriptions,
  usageTracking,
  userConsents,
} from "./domains/proactive/schema";

// OpenClaw domain schema imports
import {
  openclawWorkflows,
  openclawSessions,
  openclawExecutions,
  openclawDelegations,
} from "./domains/openclaw/schema";

// Forecasting OS domain schema imports
import {
  forecasts,
  forecastEvidence,
  forecastResolutions,
  forecastUpdateHistory,
  forecastCalibrationLog,
} from "./domains/forecasting/schema";
import {
  timeSeriesObservations,
  timeSeriesSignals,
  causalChains,
  zeroDraftArtifacts,
  proofPacks,
  specDocs,
} from "./domains/temporal/schema";
import {
  hyperloopVariants,
  hyperloopEvaluationRuns,
  hyperloopPromotions,
} from "./domains/hyperloop/schema";
import {
  relationshipObservations,
  relationshipEdges,
  worldEvents,
  watchlists,
  dimensionProfiles,
  dimensionSnapshots,
  dimensionEvidence,
  dimensionInteractions,
} from "./domains/deepTrace/schema";

// Oracle career progression schema imports
import {
  oraclePlayerProfiles,
  oracleQuestLog,
  oracleExpTransactions,
  oracleClassAdvancementLog,
  oracleTemporalOpportunities,
} from "./domains/oracle/schema";

// Mission execution schema imports (v2 Layer A + C)
import {
  missions,
  taskPlans,
  runSteps,
  judgeReviews,
  retryAttempts,
  sniffChecks,
  mergeBoundaries,
  agentPolicies,
  passportEnforcementLogs,
  decisionMemory,
  preExecutionGates,
  consistencyAlerts,
} from "./domains/missions/schema";

// Intelligence graph schema imports (v2 Layer E)
import {
  intelligenceEntities,
  entityAliases,
  peopleProfiles,
  investorProfiles,
  fundHoldings,
  ownershipSnapshots,
  stakeholderGraphs,
} from "./domains/intelligence/schema";

// World graph schema imports (v2 Layer E)
import {
  geoEntities,
  geoRelationships,
  infrastructureAssets,
  countryRiskSnapshots,
  entityExposureEdges,
  marketSignals,
} from "./domains/world/schema";

// Evaluation schema imports (v2 Layer H)
import {
  inferenceCalls,
  baselineComparisons,
  routingRecommendations,
  canaryRuns,
} from "./domains/evaluation/schema";
import {
  trajectoryEntities,
  trajectorySpans,
  trajectoryEvidenceBundles,
  trajectoryJudgeVerdicts,
  trajectoryFeedbackEvents,
  trajectoryInterventionEvents,
  trajectoryTrustNodes,
  trajectoryTrustEdges,
  trajectorySummaries,
  trajectoryCompoundingScores,
  trajectoryBenchmarkRuns,
} from "./domains/trajectory/schema";
import {
  successLoopRegistry,
  successLoopEvents,
  successLoopExperiments,
  frozenDecisions,
  successOutcomeLinks,
} from "./domains/successLoops/schema";
import { agentResponseReviews } from "./domains/agents/schema";

// MCP Gateway API key & session schema
import { mcpApiKeys, mcpGatewaySessions } from "./domains/mcp/apiKeysSchema";

// Founder Platform schema imports
import {
  founderWorkspaces,
  founderCompanies,
  founderImportedAssets,
  founderProducts,
  founderInitiatives,
  founderAgents,
  founderSignals,
  founderDecisions,
  founderInterventions,
  founderOutcomes,
  founderContextSnapshots,
  founderTimelineEvents,
  founderEvidence,
  founderPendingActions,
  founderTaskPackets,
  founderAgentPresence,
  founderCommandMessages,
  founderApprovalQueue,
  // Phase 10 — Causal Memory & Trajectory Intelligence
  founderEventLedger,
  founderPathSteps,
  founderStateDiffs,
  founderTimeRollups,
  founderPacketVersions,
  founderMemoVersions,
  founderImportantChanges,
  founderTrajectoryScores,
  founderRelatedEntities,
  // Phase 11 — Ambient Intelligence Layer
  ambientIngestionQueue,
  ambientCanonicalObjects,
  ambientChangeDetections,
  ambientPacketReadiness,
  // Phase 13 — Dogfood Judge Fix System
  dogfoodSessions,
  dogfoodJudgeRuns,
  dogfoodFailureCases,
  dogfoodFixAttempts,
  // Phase 14 — Shared Context Persistence
  sharedContextPeers,
  sharedContextPackets,
  sharedContextTasks,
  sharedContextMessages,
  founderHarnessEpisodes,
} from "./domains/founder/schema";
import {
  productPublicCards,
  productMigrationState,
  productInputBundles,
  productEvidenceItems,
  productChatSessions,
  productChatEvents,
  productToolEvents,
  productRunEvents,
  productResolutionCandidates,
  productSourceEvents,
  productReportDrafts,
  productClaims,
  productClaimSupports,
  productClaimReviews,
  productEntities,
  productEntityNotes,
  productWorkspaceShares,
  productEntityWorkspaceMembers,
  productEntityWorkspaceInvites,
  productEntityRelations,
  productDocuments,
  productDocumentBlocks,
  productDocumentEntityLinks,
  productDocumentSourceLinks,
  productDocumentEvents,
  productDocumentSnapshots,
  productReports,
  productReportRefreshes,
  productEventWorkspaces,
  productEventWorkspaceEntities,
  productEventWorkspaceEvidence,
  productEventWorkspaceClaims,
  productEventWorkspaceFollowUps,
  productEventBudgetDecisions,
  productEventCaptures,
  productEventRunRecords,
  productActivityLedger,
  productReportExports,
  productReportExportRows,
  productNudges,
  productProfileSummaries,
  productContextItems,
  productBlocks,
  productBlockRelations,
  productBlockWriteWindows,
  productNudgeSubscriptions,
  productNotebookPages,
  productUserSessions,
} from "./domains/product/schema";

// My Wiki — Phase 1+2 (personal synthesis layer). Derivative of productReports,
// productClaims, canonicalSources. See: docs/architecture/ME_AGENT_DESIGN.md
import {
  userWikiPages,
  userWikiRevisions,
  userWikiMaintainerJobs,
  // Dreaming Phase 2 tables
  userWikiStaging,
  userWikiThemes,
  userWikiOpenQuestions,
  userWikiNotes,
  userWikiEdges,
} from "./domains/product/userWikiSchema";

/* ------------------------------------------------------------------ */
/* 1.  DOCUMENTS  â€“  page/board/post level metadata                    */
/* ------------------------------------------------------------------ */
const documents = defineTable({
  title: v.string(),
  parentId: v.optional(v.id("documents")), // hierarchy
  isPublic: v.boolean(),
  // When true, public viewers may also edit (used by ProseMirror + UI to toggle read-only)
  allowPublicEdit: v.optional(v.boolean()),
  createdBy: v.id("users"),
  lastEditedBy: v.optional(v.id("users")), // who last edited this document
  coverImage: v.optional(v.id("_storage")),
  // LEGACY: holds ProseMirror JSON blob; retained temporarily for migration
  content: v.optional(v.string()),
  summary: v.optional(v.string()),

  icon: v.optional(v.string()),
  isArchived: v.optional(v.boolean()),
  isFavorite: v.optional(v.boolean()),
  publishedAt: v.optional(v.number()), // ms since epoch
  /** points at the top GraphNode that owns the editor view */
  rootNodeId: v.optional(v.id("nodes")),
  lastModified: v.optional(v.number()), // ms since epoch - when document was last updated
  // Optional: associate a document with a calendar day (local midnight ms)
  agendaDate: v.optional(v.number()),
  // Rolling count of snapshots for this document (maintained on insert/delete)
  snapshotCount: v.optional(v.number()),

  // Lazy indexing marker for RAG
  ragIndexedAt: v.optional(v.number()),
  // Gemini File Search indexing marker
  fileSearchIndexedAt: v.optional(v.number()),

  // FILE & SPECIAL DOCUMENT SUPPORT
  documentType: v.optional(
    v.union(
      v.literal("text"),
      v.literal("file"),
      v.literal("timeline"),
      v.literal("dossier"),
      v.literal("operator_profile"),
    ),
  ), // "text" (default) | "file" | "timeline" | "dossier" | "operator_profile"
  fileId: v.optional(v.id("files")), // reference to files table for file documents
  fileType: v.optional(v.string()), // "csv", "pdf", "image", etc. for file documents
  mimeType: v.optional(v.string()), // MIME type for file documents

  // RESEARCH DOSSIER SUPPORT
  dossierType: v.optional(
    v.union(
      v.literal("primary"), // The main chat transcript/dossier
      v.literal("media-asset"), // Linked media (video/image/document)
      v.literal("quick-notes"), // Quick notes linked to a dossier
    ),
  ),
  parentDossierId: v.optional(v.id("documents")), // Links media assets to primary dossier
  chatThreadId: v.optional(v.string()), // Source chat thread (Agent component uses string IDs)
  assetMetadata: v.optional(
    v.object({
      assetType: v.union(
        v.literal("image"),
        v.literal("video"),
        v.literal("youtube"),
        v.literal("sec-document"),
        v.literal("pdf"),
        v.literal("news"),
        v.literal("file"),
      ),
      sourceUrl: v.string(), // Original URL of the asset
      thumbnailUrl: v.optional(v.string()), // Thumbnail/preview URL
      extractedAt: v.number(), // Timestamp when found in chat
      toolName: v.optional(v.string()), // Which tool found this asset
      metadata: v.optional(v.any()), // Additional metadata (title, description, etc.)
    }),
  ),
  // Idempotency key for creation (threadId + title + content hash)
  creationKey: v.optional(v.string()),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // GAM: THEME MEMORY (for hashtag dossiers)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  themeMemory: v.optional(
    v.object({
      topicId: v.string(), // e.g., "theme:agent-memory"
      summary: v.string(),
      keyFacts: v.array(
        v.object({
          id: v.string(),
          text: v.string(),
          isHighConfidence: v.boolean(), // Boolean: passes threshold or not
          sourceDocIds: v.array(v.string()),
        }),
      ),
      narratives: v.array(
        v.object({
          label: v.string(),
          description: v.string(),
          supportingDocIds: v.array(v.string()),
        }),
      ),
      heuristics: v.array(v.string()),
      lastRefreshed: v.number(),
      // Boolean quality flags (not arbitrary scores)
      quality: v.object({
        hasSufficientFacts: v.boolean(),
        hasRecentResearch: v.boolean(),
        hasVerifiedSources: v.boolean(),
      }),
      staleDays: v.number(), // Default: 30 days
      researchDepth: v.union(
        v.literal("shallow"),
        v.literal("standard"),
        v.literal("deep"),
      ),
    }),
  ),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // LINKED ARTIFACTS (for citation tracking)
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  linkedArtifacts: v.optional(
    v.array(
      v.object({
        artifactId: v.id("sourceArtifacts"),
        citationKey: v.string(), // e.g., "[1]"
        addedAt: v.number(),
        addedBy: v.id("users"),
      }),
    ),
  ),
})
  .index("by_user", ["createdBy"])
  .index("by_user_archived", ["createdBy", "isArchived"])
  .index("by_parent", ["parentId"])
  .index("by_public", ["isPublic"])
  // For calendar integration: query notes by day per-user
  .index("by_user_agendaDate", ["createdBy", "agendaDate"])
  // Fast idempotency lookup
  .index("by_creation_key", ["creationKey"])
  // For dossier pattern: query linked assets by parent dossier
  .index("by_parent_dossier", ["parentDossierId"])
  // For dossier pattern: query all documents from a chat thread
  .index("by_chat_thread", ["chatThreadId"])

  .searchIndex("search_title", {
    searchField: "title",
    filterFields: ["isPublic", "createdBy", "isArchived"],
  })
  .searchIndex("search_content", {
    searchField: "content",
    filterFields: ["createdBy", "isArchived"],
  });

/* ------------------------------------------------------------------ */
/* 2.  NODES  â€“  one row per ProseMirror block (GraphNode)             */
/* ------------------------------------------------------------------ */
const nodes = defineTable({
  documentId: v.id("documents"), // which doc/board it belongs to
  parentId: v.optional(v.id("nodes")), // null â‡’ root
  order: v.number(), // sibling ordering
  type: v.string(), // "paragraph" | "heading" | â€¦
  text: v.optional(v.string()), // plain text (for search)
  json: v.optional(v.any()), // full PM node as JSON
  authorId: v.id("users"), // who created this node
  lastEditedBy: v.optional(v.id("users")), // who last edited this node
  createdAt: v.number(),
  updatedAt: v.number(),
  isUserNode: v.optional(v.boolean()), // flags for mention logic
})
  .index("by_document", ["documentId", "order"])
  .index("by_parent", ["parentId", "order"])
  .index("by_updated", ["updatedAt"])
  .searchIndex("search_text", {
    searchField: "text",
    filterFields: ["documentId", "authorId"],
  });

/* ------------------------------------------------------------------ */
/* 3.  RELATIONS  â€“  arbitrary graph edges (â€œchildâ€, â€œrelatedToâ€â€¦ )    */
/* ------------------------------------------------------------------ */
const relations = defineTable({
  from: v.id("nodes"),
  to: v.id("nodes"),
  relationTypeId: v.string(), // store the string id, faster than join
  order: v.optional(v.number()), // for ordered children
  createdBy: v.id("users"),
  createdAt: v.number(),
})
  .index("by_from", ["from"])
  .index("by_to", ["to"])
  .index("by_type", ["relationTypeId"]);

/* ------------------------------------------------------------------ */
/* 4.  RELATION TYPES  â€“  mostly static, but editable in UI            */
/* ------------------------------------------------------------------ */
const relationTypes = defineTable({
  id: v.string(), // "child", "relatedTo", "hashtag"â€¦
  name: v.string(),
  icon: v.optional(v.string()),
})
  // Quick look-up by primary string id (e.g. "child")
  .index("by_relationId", ["id"]);

/* ------------------------------------------------------------------ */
/* 5.  TAGS  â€“  domain/entity/topic keywords                           */
/* ------------------------------------------------------------------ */
export const tags = defineTable({
  name: v.string(), // canonical tag text (lower-cased)
  kind: v.optional(v.string()), // "domain" | "entity" | "topic" etc
  importance: v.optional(v.float64()), // 0â€“1 weighting when ranking context
  createdBy: v.id("users"),
  createdAt: v.number(),
})
  .index("by_name", ["name"])
  .index("by_kind", ["kind"])
  .searchIndex("search_name", {
    searchField: "name",
    filterFields: ["kind"],
  });

/* ------------------------------------------------------------------ */
/* 6.  TAG REFERENCES  â€“  many-to-many tag â†” page/node                 */
/* ------------------------------------------------------------------ */
export const tagRefs = defineTable({
  tagId: v.id("tags"),
  targetId: v.string(), // generic Id in string form
  targetType: v.string(), // "documents" | "nodes"
  createdBy: v.id("users"),
  createdAt: v.number(),
})
  .index("by_tag", ["tagId"])
  .index("by_target", ["targetId", "targetType"]);

/* ------------------------------------------------------------------ */
/* 7.  SMS LOGS                                                        */
/* ------------------------------------------------------------------ */
export const smsLogs = defineTable({
  to: v.string(),
  body: v.string(),
  status: v.string(), // "sent" | "failed" | "delivered" | "undelivered"
  createdAt: v.number(),
  // Enhanced tracking for cost analytics
  userId: v.optional(v.id("users")),
  messageSid: v.optional(v.string()), // Twilio message SID
  eventType: v.optional(v.string()), // "meeting_created" | "meeting_reminder" | "morning_digest"
  eventId: v.optional(v.id("events")),
  segments: v.optional(v.number()), // Number of SMS segments (160 chars = 1 segment)
  estimatedCostCents: v.optional(v.number()), // Estimated cost in cents
})
  .index("by_to", ["to"])
  .index("by_user", ["userId"])
  .index("by_user_date", ["userId", "createdAt"])
  .index("by_status", ["status"]);

/* ------------------------------------------------------------------ */
/* 7a. SMS USAGE DAILY - Aggregated usage per user per day            */
/* ------------------------------------------------------------------ */
export const smsUsageDaily = defineTable({
  userId: v.id("users"),
  date: v.string(), // YYYY-MM-DD
  totalMessages: v.number(),
  successfulMessages: v.number(),
  failedMessages: v.number(),
  totalSegments: v.number(),
  estimatedCostCents: v.number(), // Total estimated cost in cents
  // Breakdown by event type
  meetingCreatedCount: v.optional(v.number()),
  meetingReminderCount: v.optional(v.number()),
  morningDigestCount: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_user_date", ["userId", "date"])
  .index("by_date", ["date"]);

/* ------------------------------------------------------------------ */
/* 7b. TELEGRAM USERS - Telegram bot user preferences                 */
/* ------------------------------------------------------------------ */
export const telegramUsers = defineTable({
  telegramChatId: v.string(), // Telegram chat ID (unique per user)
  telegramUsername: v.optional(v.string()),
  firstName: v.optional(v.string()),
  notificationsEnabled: v.boolean(),
  createdAt: v.number(),
  lastActiveAt: v.number(),
})
  .index("by_chat_id", ["telegramChatId"])
  .index("by_last_active", ["lastActiveAt"]);

/* ------------------------------------------------------------------ */
/* 7c. TELEGRAM MESSAGES - Message log for audit/context              */
/* ------------------------------------------------------------------ */
export const telegramMessages = defineTable({
  telegramChatId: v.string(),
  messageText: v.string(),
  messageType: v.string(), // "incoming" | "outgoing"
  messageId: v.optional(v.number()), // Telegram message ID
  agentResponse: v.optional(v.string()),
  timestamp: v.number(),
})
  .index("by_chat_id", ["telegramChatId"])
  .index("by_timestamp", ["timestamp"])
  .index("by_chat_timestamp", ["telegramChatId", "timestamp"]);

/* ------------------------------------------------------------------ */
/* 8.  VECTOR CACHE  (optional)                                        */
/* ------------------------------------------------------------------ */
// If you want to persist your `SimpleVectorStore` so the index survives reloads
// keep a compact cache here; leave it out if youâ€™re only embedding client-side.
const embeddings = defineTable({
  chunkHash: v.string(), // sha256(text)
  vector: v.array(v.float64()), // normalised
});

/* ------------------------------------------------------------------ */
/* 6.  Bring it all together                                           */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* 9.  GRID PROJECTS  â€“  saved multi-document grid configurations     */
/* ------------------------------------------------------------------ */
const gridProjects = defineTable({
  name: v.string(), // user-defined name for the grid project
  description: v.optional(v.string()), // optional description
  createdBy: v.id("users"), // owner of the grid project
  documentIds: v.array(v.id("documents")), // array of document IDs in the grid
  layout: v.object({
    // grid layout configuration
    cols: v.number(),
    rows: v.number(),
    gridClass: v.string(),
    name: v.string(),
  }),
  createdAt: v.number(), // ms since epoch
  updatedAt: v.number(), // ms since epoch
  isArchived: v.optional(v.boolean()), // soft delete
})
  .index("by_user", ["createdBy"])
  .index("by_user_archived", ["createdBy", "isArchived"]);

/* ------------------------------------------------------------------ */
/* 7.  FILES  â€“  uploaded files for analysis                           */
/* ------------------------------------------------------------------ */
const files = defineTable({
  userId: v.string(), // user ID from auth
  storageId: v.string(), // Convex storage ID
  fileName: v.string(), // original filename
  fileType: v.string(), // "video", "image", "audio", "document"
  mimeType: v.string(), // MIME type
  fileSize: v.number(), // file size in bytes

  // Analysis results
  analysis: v.optional(v.string()), // analysis text result
  structuredData: v.optional(v.any()), // structured analysis data
  analysisType: v.optional(v.string()), // type of analysis performed
  processingTime: v.optional(v.number()), // time taken for analysis in ms
  analyzedAt: v.optional(v.number()), // ms since epoch when analyzed

  // Metadata
  isPublic: v.optional(v.boolean()), // whether file is publicly accessible
  tags: v.optional(v.array(v.string())), // user-defined tags
  description: v.optional(v.string()), // user description

  // Modification tracking for CSV editing
  lastModified: v.optional(v.number()), // ms since epoch when last modified
  modificationCount: v.optional(v.number()), // number of times file has been modified
  parentFileId: v.optional(v.id("files")), // reference to original file if this is a copy/export

  // GenAI cache & extracted metadata (optional)
  genaiFileName: v.optional(v.string()),
  genaiFileUri: v.optional(v.string()),
  cacheName: v.optional(v.string()),
  cacheExpiresAt: v.optional(v.number()),
  metadata: v.optional(v.any()),
  contentSummary: v.optional(v.string()),
  textPreview: v.optional(v.string()),
})
  .index("by_user", ["userId"])
  .index("by_user_and_type", ["userId", "fileType"])
  .searchIndex("search_files", {
    searchField: "fileName",
    filterFields: ["userId", "fileType"],
  });

/* ------------------------------------------------------------------ */
/* 8.  URL ANALYSES  â€“  URL content analysis results                   */
/* ------------------------------------------------------------------ */
const urlAnalyses = defineTable({
  userId: v.string(), // user ID from auth
  url: v.string(), // analyzed URL
  analysis: v.optional(v.string()), // analysis text result
  structuredData: v.optional(v.any()), // structured analysis data
  analyzedAt: v.number(), // ms since epoch when analyzed
  contentType: v.optional(v.string()), // detected content type
})
  .index("by_user", ["userId"])
  .index("by_url", ["url"]);

/* ------------------------------------------------------------------ */
/* 8b. FILE CHUNKS  â€“  extracted chunks + embeddings per file          */
/* ------------------------------------------------------------------ */
const chunks = defineTable({
  fileId: v.id("files"),
  text: v.string(),
  meta: v.optional(v.any()), // { page?, startTimeSec?, endTimeSec? }
  embedding: v.array(v.number()),
}).index("by_file", ["fileId"]);

/* ------------------------------------------------------------------ */
/* FOLDERS - Document organization system                              */
/* ------------------------------------------------------------------ */
const folders = defineTable({
  name: v.string(),
  color: v.string(), // CSS color class for folder display
  userId: v.id("users"), // folder owner
  isExpanded: v.optional(v.boolean()), // UI state for expand/collapse
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_name", ["userId", "name"]);

/* Document-to-Folder relationships */
const documentFolders = defineTable({
  documentId: v.id("documents"),
  folderId: v.id("folders"),
  userId: v.id("users"), // for access control
  addedAt: v.number(), // when document was added to folder
})
  .index("by_document", ["documentId"])
  .index("by_folder", ["folderId"])
  .index("by_user", ["userId"])
  .index("by_document_folder", ["documentId", "folderId"]);

/* ------------------------------------------------------------------ */
/* GEMINI FILE SEARCH STORES                                          */
/* ------------------------------------------------------------------ */
const fileSearchStores = defineTable({
  userId: v.id("users"),
  storeName: v.string(), // full resource name from Gemini
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_user", ["userId"]);

/* ------------------------------------------------------------------ */
/* MCP SERVERS - Model Context Protocol server configurations         */
/* ------------------------------------------------------------------ */
const mcpServers = defineTable({
  name: v.string(), // user-friendly name
  url: v.optional(v.string()), // URL for HTTP tool calls
  apiKey: v.optional(v.string()), // encrypted API key if needed
  userId: v.id("users"), // server owner
  createdAt: v.number(),
  updatedAt: v.number(),
  // Additional fields found in existing data
  connectionStatus: v.optional(v.string()), // "connected", "error", "disconnected"
  description: v.optional(v.string()), // server description
  isEnabled: v.optional(v.boolean()), // whether server is enabled
  lastConnected: v.optional(v.number()), // timestamp of last connection
  transport: v.optional(v.string()), // transport type ("sse", "http", etc.)
})
  .index("by_user", ["userId"])
  .index("by_name", ["name"])
  .index("by_user_name", ["userId", "name"]);

const mcpPlans = defineTable({
  planId: v.string(),
  goal: v.string(),
  steps: v.any(),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_planId", ["planId"]);

const mcpMemoryEntries = defineTable({
  key: v.string(),
  content: v.string(),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_key", ["key"]);

/* ------------------------------------------------------------------ */
/* AGENT RUNS - streaming progress for AI chat                        */
/* ------------------------------------------------------------------ */
const agentRuns = defineTable({
  userId: v.optional(v.id("users")),
  threadId: v.optional(v.string()),
  documentId: v.optional(v.id("documents")),
  mcpServerId: v.optional(v.id("mcpServers")),
  model: v.optional(v.string()),
  workflow: v.optional(v.string()),
  args: v.optional(v.any()),
  openaiVariant: v.optional(v.string()),
  status: v.union(
    v.literal("pending"),
    v.literal("queued"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("error"),
  ),
  intent: v.optional(v.string()),
  planExplain: v.optional(v.string()),
  plan: v.optional(v.any()),
  finalResponse: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  nextSeq: v.optional(v.number()),

  // Distributed work leasing (optional / backwards compatible)
  leaseOwner: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  priority: v.optional(v.number()),
  availableAt: v.optional(v.number()),

  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_threadId", ["threadId"])
  .index("by_createdAt", ["createdAt"])
  .index("by_user_createdAt", ["userId", "createdAt"])
  .index("by_status_availableAt", ["status", "availableAt"])
  .index("by_leaseExpiresAt", ["leaseExpiresAt"]);

/* ------------------------------------------------------------------ */
/* ACTION RECEIPTS â€” tamper-evident log of agent actions & policy      */
/* ------------------------------------------------------------------ */
const actionReceipts = defineTable({
  /** Content-addressed receipt ID (SHA-256 of receipt body) */
  receiptId: v.string(),
  /** Which agent performed the action */
  agentId: v.string(),
  /** Which agent run this receipt belongs to */
  agentRunId: v.optional(v.id("agentRuns")),
  /** User who owns the agent */
  userId: v.optional(v.id("users")),
  /** MCP tool name or internal operation */
  toolName: v.string(),
  /** Optional OpenClaw session join key */
  sessionKey: v.optional(v.string()),
  /** Optional OpenClaw channel identifier */
  channelId: v.optional(v.string()),
  /** Which phase of the action lifecycle this receipt represents */
  direction: v.optional(v.string()),
  /** Optional OpenClaw session linkage */
  openclawSessionId: v.optional(v.id("openclawSessions")),
  /** Optional OpenClaw execution linkage */
  openclawExecutionId: v.optional(v.id("openclawExecutions")),
  /** Optional deployment/runtime label for the originating shell */
  deployment: v.optional(v.string()),
  /** Tool input parameters (redacted if sensitive) */
  params: v.optional(v.any()),
  /** Human-readable summary of what happened */
  actionSummary: v.string(),
  /** Policy that authorized or blocked this action */
  policyId: v.string(),
  policyRuleName: v.string(),
  /** "allowed" | "denied" | "escalated" */
  policyAction: v.string(),
  /** References to evidence artifact IDs */
  evidenceRefs: v.array(v.string()),
  /** Result */
  resultSuccess: v.boolean(),
  resultSummary: v.string(),
  resultOutputHash: v.optional(v.string()),
  /** Reversibility */
  canUndo: v.boolean(),
  undoInstructions: v.optional(v.string()),
  /** Approval state for actions that require operator review */
  approvalState: v.optional(v.string()),
  approvalRequestedAt: v.optional(v.number()),
  approvalReviewedAt: v.optional(v.number()),
  approvalReviewedBy: v.optional(v.string()),
  approvalReviewNotes: v.optional(v.string()),
  /** Policy violations */
  violations: v.array(
    v.object({
      ruleId: v.string(),
      ruleName: v.string(),
      /** "warning" | "block" | "audit_only" */
      severity: v.string(),
      description: v.string(),
      resolution: v.optional(v.string()),
    }),
  ),
  createdAt: v.number(),
})
  .index("by_receiptId", ["receiptId"])
  .index("by_agentId", ["agentId"])
  .index("by_userId", ["userId", "createdAt"])
  .index("by_policyAction", ["policyAction", "createdAt"])
  .index("by_agentRunId", ["agentRunId"])
  .index("by_approvalState", ["approvalState", "createdAt"])
  .index("by_sessionKey", ["sessionKey", "createdAt"])
  .index("by_channelId", ["channelId", "createdAt"])
  .index("by_createdAt", ["createdAt"]);

/* ------------------------------------------------------------------ */
/* SOURCE ARTIFACTS - unified durable snapshots of external sources    */
/* ------------------------------------------------------------------ */
const sourceArtifacts = defineTable({
  runId: v.optional(v.id("agentRuns")),
  sourceType: v.union(
    v.literal("url_fetch"),
    v.literal("api_response"),
    v.literal("file_upload"),
    v.literal("extracted_text"),
    v.literal("video_transcript"),
  ),
  sourceUrl: v.optional(v.string()),
  contentHash: v.string(),
  rawContent: v.optional(v.string()),
  rawStorageId: v.optional(v.id("_storage")),
  mimeType: v.optional(v.string()),
  sizeBytes: v.optional(v.number()),
  title: v.optional(v.string()),
  extractedData: v.optional(v.any()),
  // Denormalized concat of title + sourceUrl (capped) for the federated
  // `search_sources` index. Optional — backfilled lazily on next upsert.
  searchableText: v.optional(v.string()),
  fetchedAt: v.number(),
  expiresAt: v.optional(v.number()),
})
  .index("by_run", ["runId", "fetchedAt"])
  .index("by_hash", ["contentHash"])
  .index("by_sourceUrl_hash", ["sourceUrl", "contentHash"])
  .index("by_sourceUrl", ["sourceUrl", "fetchedAt"])
  .searchIndex("search_sources", {
    searchField: "searchableText",
    filterFields: ["sourceType"],
  });

/* ------------------------------------------------------------------ */
/* ARTIFACT CHUNKS - addressable evidence units for retrieval           */
/* ------------------------------------------------------------------ */
const artifactChunks = defineTable({
  artifactId: v.id("sourceArtifacts"),
  runId: v.optional(v.id("agentRuns")),
  sourceUrl: v.optional(v.string()),
  fetchedAt: v.number(),
  contentHash: v.string(),
  chunkVersion: v.number(),
  chunkKey: v.string(), // deterministic key: artifactId:start-end:vN
  startOffset: v.optional(v.number()),
  endOffset: v.optional(v.number()),
  pageIndex: v.optional(v.number()), // 1-based page number from financial docs / PDFs
  timestampStart: v.optional(v.number()),
  timestampEnd: v.optional(v.number()),
  headingPath: v.optional(v.array(v.string())),
  nodeId: v.optional(v.string()),
  text: v.string(),
  chunkHash: v.string(),
  createdAt: v.number(),
})
  .index("by_artifact_version_offset", [
    "artifactId",
    "chunkVersion",
    "startOffset",
  ])
  .index("by_chunkKey", ["chunkKey"])
  .index("by_run_fetchedAt", ["runId", "fetchedAt"])
  .searchIndex("search_text", {
    searchField: "text",
    filterFields: ["artifactId", "runId", "chunkVersion"],
  });

/* ------------------------------------------------------------------ */
/* ARTIFACT INDEX JOBS - ingestion/indexing telemetry                   */
/* ------------------------------------------------------------------ */
const artifactIndexJobs = defineTable({
  artifactId: v.id("sourceArtifacts"),
  contentHash: v.string(),
  chunkVersion: v.number(),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("succeeded"),
    v.literal("failed"),
  ),
  attempts: v.number(),
  error: v.optional(v.string()),
  chunkCount: v.optional(v.number()),
  latencyMs: v.optional(v.number()),
  modelUsed: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_status_updatedAt", ["status", "updatedAt"])
  .index("by_artifact_hash_version", [
    "artifactId",
    "contentHash",
    "chunkVersion",
  ]);

/* ------------------------------------------------------------------ */
/* RESOURCE LINKS - MCP-style pointers to artifacts for large outputs  */
/* ------------------------------------------------------------------ */
const resourceLinks = defineTable({
  runId: v.optional(v.id("agentRuns")),
  toolName: v.string(), // Which tool produced this output
  toolCallId: v.string(), // Unique ID for the tool call
  artifactId: v.id("sourceArtifacts"), // Link to stored artifact
  chunkIds: v.optional(v.array(v.id("artifactChunks"))), // Specific chunks if distilled
  mimeType: v.string(), // e.g., "text/html", "application/json"
  sizeBytes: v.number(), // Original output size
  preview: v.string(), // First ~500 chars for context
  title: v.optional(v.string()), // Optional title for the resource
  originalTokenEstimate: v.number(), // Estimated tokens if inlined
  actualTokens: v.number(), // Tokens used (preview only)
  tokenSavings: v.number(), // Calculated savings
  createdAt: v.number(),
  accessedAt: v.optional(v.number()), // Last time resource was retrieved
})
  .index("by_run", ["runId", "createdAt"])
  .index("by_artifact", ["artifactId"])
  .index("by_tool_call", ["toolCallId"]);

/* ------------------------------------------------------------------ */
/* EVIDENCE PACKS - persisted bundles used in a run                     */
/* ------------------------------------------------------------------ */
const evidencePacks = defineTable({
  runId: v.optional(v.id("agentRuns")),
  query: v.string(),
  scope: v.optional(v.any()),
  chunkIds: v.array(v.id("artifactChunks")),
  createdAt: v.number(),
}).index("by_run_createdAt", ["runId", "createdAt"]);

/* ------------------------------------------------------------------ */
/* TOOL HEALTH - adaptive routing telemetry + circuit breaker          */
/* ------------------------------------------------------------------ */
const toolHealth = defineTable({
  toolName: v.string(),
  successCount: v.number(),
  failureCount: v.number(),
  avgLatencyMs: v.number(),
  lastSuccessAt: v.optional(v.number()),
  lastFailureAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  consecutiveFailures: v.optional(v.number()),
  circuitOpen: v.boolean(),
  circuitOpenedAt: v.optional(v.number()),
})
  .index("by_toolName", ["toolName"])
  .index("by_circuitOpen", ["circuitOpen", "toolName"]);

/* ------------------------------------------------------------------ */
/* PROMPT ENHANCEMENT FEEDBACK - Learning loop for dynamic tool instructions */
/* ------------------------------------------------------------------ */
const promptEnhancementFeedback = defineTable({
  userMessage: v.string(),
  expectedTools: v.array(v.string()),
  actualToolsCalled: v.array(v.string()),
  missedTools: v.array(v.string()),
  generatedInstructions: v.optional(v.string()),
  model: v.string(),
  threadId: v.string(),
  messageId: v.string(),
  wasSuccess: v.optional(v.boolean()),
  createdAt: v.number(),
})
  .index("by_thread", ["threadId", "createdAt"])
  .index("by_model", ["model", "createdAt"])
  .index("by_success", ["wasSuccess", "createdAt"]);

/* ------------------------------------------------------------------ */
/* PROJECT CONTEXT - Codebase context for prompt enhancement          */
/* ------------------------------------------------------------------ */
const projectContext = defineTable({
  // Project identity
  projectId: v.string(),
  userId: v.id("users"),

  // Codebase structure
  name: v.string(),
  techStack: v.array(v.string()), // ["React", "TypeScript", "Convex"]
  fileStructure: v.optional(
    v.object({
      rootPath: v.string(),
      keyDirectories: v.array(v.string()),
      totalFiles: v.number(),
    }),
  ),

  // Recent changes
  recentCommits: v.array(
    v.object({
      sha: v.string(),
      message: v.string(),
      author: v.string(),
      timestamp: v.number(),
      filesChanged: v.array(v.string()),
    }),
  ),

  // Patterns and conventions
  commonPatterns: v.array(v.string()), // ["Use Convex mutations for DB writes", "camelCase for variables"]
  styleGuide: v.optional(
    v.object({
      summary: v.string(),
      rules: v.array(v.string()),
    }),
  ),

  // Dependency context
  dependencies: v.optional(
    v.array(
      v.object({
        name: v.string(),
        version: v.string(),
        isDevDependency: v.boolean(),
      }),
    ),
  ),

  // Session state
  currentBranch: v.optional(v.string()),
  activeFiles: v.optional(v.array(v.string())), // Files open in editor

  // Metadata
  lastSyncedAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project_id", ["projectId"])
  .index("by_user", ["userId", "updatedAt"]);

const agentRunEvents = defineTable({
  runId: v.id("agentRuns"),
  seq: v.number(), // monotonically increasing per run
  kind: v.string(), // "thinking" | "plan" | "intent" | "group.start" | "step.start" | ...
  message: v.optional(v.string()),
  data: v.optional(v.any()),
  createdAt: v.number(),
}).index("by_run", ["runId", "seq"]);

/* ------------------------------------------------------------------ */
/* FINANCIAL OPERATOR CONSOLE — typed run + step stream for          */
/* perception -> extraction -> deterministic compute -> verification  */
/* User-facing chat renders one card per step kind.                   */
/* ------------------------------------------------------------------ */
const financialOperatorRuns = defineTable({
  userId: v.optional(v.id("users")),
  threadId: v.optional(v.string()),
  taskType: v.union(
    v.literal("financial_metric_extraction"), // ETR, cost of debt, ratios
    v.literal("financial_data_cleanup"),       // CRM list cleanup
    v.literal("covenant_compliance"),          // credit agreement review
    v.literal("variance_analysis"),            // actuals vs budget
    v.literal("custom"),
  ),
  goal: v.string(),
  files: v.optional(v.array(v.object({
    name: v.string(),
    kind: v.string(), // "pdf" | "xlsx" | "image" | "csv"
    sizeBytes: v.optional(v.number()),
  }))),
  status: v.union(
    v.literal("created"),
    v.literal("planning"),
    v.literal("running"),
    v.literal("awaiting_approval"),
    v.literal("completed"),
    v.literal("rejected"),
    v.literal("error"),
  ),
  // Bounded step counter for UI progress (HONEST_SCORES — only what we count)
  totalSteps: v.optional(v.number()),
  nextSeq: v.optional(v.number()),
  // Final operator summary surfaced above raw step stream
  finalSummary: v.optional(v.string()),
  artifacts: v.optional(v.array(v.object({
    kind: v.string(), // "notebook" | "csv" | "pr_draft" | "memo"
    label: v.string(),
    artifactRef: v.optional(v.string()), // foreign key to documents/files/etc
    url: v.optional(v.string()),
  }))),
  errorMessage: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_threadId", ["threadId"])
  .index("by_status_createdAt", ["status", "createdAt"])
  .index("by_user_createdAt", ["userId", "createdAt"]);

const financialOperatorSteps = defineTable({
  runId: v.id("financialOperatorRuns"),
  seq: v.number(), // monotonic per run
  kind: v.union(
    v.literal("run_brief"),        // initial plan with numbered steps
    v.literal("tool_call"),        // generic tool invocation card
    v.literal("extraction"),       // structured field extraction with sources
    v.literal("validation"),       // schema/unit/range checks
    v.literal("calculation"),      // deterministic sandbox compute
    v.literal("evidence"),         // source anchors + citations
    v.literal("artifact"),         // produced output (notebook, csv, PR)
    v.literal("approval_request"), // needs user decision
    v.literal("result"),           // final operator summary
  ),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("complete"),
    v.literal("error"),
    v.literal("needs_review"),
    v.literal("approved"),
    v.literal("rejected"),
  ),
  title: v.string(),     // short label shown in card header
  // Payload typed by kind in TS; stored as v.any() to keep schema flexible.
  // Each kind's exact shape is enforced by its mutation (validators in domain).
  payload: v.optional(v.any()),
  durationMs: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_run", ["runId", "seq"])
  .index("by_run_kind", ["runId", "kind"]);

/* ------------------------------------------------------------------ */
/* INSTAGRAM POSTS - Social media content ingestion                    */
/* ------------------------------------------------------------------ */
const instagramPosts = defineTable({
  userId: v.id("users"),
  postUrl: v.string(),
  shortcode: v.optional(v.string()), // Instagram post ID
  mediaType: v.union(
    v.literal("image"),
    v.literal("video"),
    v.literal("carousel"),
  ),
  caption: v.optional(v.string()),
  transcript: v.optional(v.string()), // Gemini video transcription
  extractedClaims: v.optional(
    v.array(
      v.object({
        claim: v.string(),
        confidence: v.number(), // 0-1
        sourceTimestamp: v.optional(v.number()), // seconds into video
        category: v.optional(v.string()), // "financial", "product", "opinion"
      }),
    ),
  ),
  mediaStorageId: v.optional(v.id("_storage")), // Downloaded media
  thumbnailUrl: v.optional(v.string()),
  authorUsername: v.optional(v.string()),
  authorFullName: v.optional(v.string()),
  likeCount: v.optional(v.number()),
  commentCount: v.optional(v.number()),
  postedAt: v.optional(v.number()), // Original post timestamp
  fetchedAt: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("transcribing"),
    v.literal("analyzing"),
    v.literal("completed"),
    v.literal("error"),
  ),
  errorMessage: v.optional(v.string()),
  // Fact-check verification results
  verificationResults: v.optional(
    v.array(
      v.object({
        claim: v.string(),
        status: v.string(), // "verified", "partially_verified", "unverified", "false"
        explanation: v.string(),
        sources: v.array(
          v.object({
            name: v.string(),
            url: v.optional(v.string()),
            credibility: v.string(), // "high", "medium", "low"
          }),
        ),
        confidence: v.number(), // 0-1
      }),
    ),
  ),
  verifiedAt: v.optional(v.number()), // When verification completed
})
  .index("by_user", ["userId"])
  .index("by_url", ["postUrl"])
  .index("by_shortcode", ["shortcode"])
  .index("by_status", ["status"])
  .index("by_verified", ["verifiedAt"]);

/* ------------------------------------------------------------------ */
/* AGENT DELEGATIONS - Tracking parallel subagent execution           */
/* ------------------------------------------------------------------ */
const agentDelegations = defineTable({
  // Identity & isolation
  runId: v.string(), // coordinatorThreadId (for UI scoping)
  delegationId: v.string(), // UUID, stable ID for this delegation
  userId: v.id("users"), // Multi-user isolation

  // Agent info
  agentName: v.union(
    v.literal("DocumentAgent"),
    v.literal("MediaAgent"),
    v.literal("SECAgent"),
    v.literal("OpenBBAgent"),
    v.literal("EntityResearchAgent"),
  ),
  query: v.string(), // Original task description

  // Lifecycle
  status: v.union(
    v.literal("scheduled"), // Scheduler accepted
    v.literal("running"), // generateText started
    v.literal("completed"), // Finished successfully
    v.literal("failed"), // Error
    v.literal("cancelled"), // User cancelled
  ),

  // Timing
  scheduledAt: v.number(),
  startedAt: v.optional(v.number()),
  finishedAt: v.optional(v.number()),

  // Results (refs, not inline - avoids OCC on streaming)
  subagentThreadId: v.optional(v.string()),
  finalPatchRef: v.optional(v.string()), // Pointer to patch document
  errorMessage: v.optional(v.string()),

  // Merge tracking
  mergeStatus: v.optional(
    v.union(v.literal("pending"), v.literal("merged"), v.literal("rejected")),
  ),
})
  .index("by_run", ["runId"])
  .index("by_run_status", ["runId", "status"])
  .index("by_user_run", ["userId", "runId"])
  .index("by_delegation", ["delegationId"]);

/* ------------------------------------------------------------------ */
/* AGENT WRITE EVENTS - Append-only streaming chunks (OCC-safe)       */
/* Mirrors agentRunEvents pattern: seq owned by action, not mutated   */
/* ------------------------------------------------------------------ */
const agentWriteEvents = defineTable({
  delegationId: v.string(), // FK to agentDelegations
  seq: v.number(), // Monotonic per delegation (action-owned)
  kind: v.union(
    v.literal("delta"), // Streaming text chunk
    v.literal("tool_start"), // Tool invocation started
    v.literal("tool_end"), // Tool completed
    v.literal("note"), // Status update
    v.literal("final"), // Final output chunk
  ),
  textChunk: v.optional(v.string()), // For delta/final
  toolName: v.optional(v.string()), // For tool_start/tool_end
  metadata: v.optional(v.any()), // Extra data (citations, artifactIds)
  createdAt: v.number(),
}).index("by_delegation", ["delegationId", "seq"]); // Compound for range queries

/* ------------------------------------------------------------------ */
/* CHAT - Now using @convex-dev/agent component                       */
/* Legacy chatThreads and chatMessages tables removed                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* STREAMING CHAT - Persistent Text Streaming for FastAgentPanel     */
/* ------------------------------------------------------------------ */
const chatThreadsStream = defineTable({
  userId: v.optional(v.id("users")), // Optional for anonymous users
  anonymousSessionId: v.optional(v.string()), // Session ID for anonymous users
  title: v.string(),
  model: v.optional(v.string()),
  agentThreadId: v.optional(v.string()), // Links to agent component thread for memory management
  pinned: v.optional(v.boolean()),
  cancelRequested: v.optional(v.boolean()),
  cancelRequestedAt: v.optional(v.number()),
  workflowProgress: v.optional(v.any()), // Stores Deep Agent steps: { steps: [...], status: "running"|"completed" }
  // Swarm support - links thread to parallel agent swarm
  swarmId: v.optional(v.string()), // Links to agentSwarms table
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_pinned", ["userId", "pinned"])
  .index("by_updatedAt", ["updatedAt"])
  .index("by_user_updatedAt", ["userId", "updatedAt"])
  .index("by_agentThreadId", ["agentThreadId"])
  .index("by_anonymous_session", ["anonymousSessionId"])
  .index("by_swarmId", ["swarmId"])
  // Federated search: title is the cheapest searchable signal for threads.
  // Filter by userId so per-user scoping is enforced at index level.
  .searchIndex("search_threads", {
    searchField: "title",
    filterFields: ["userId", "anonymousSessionId"],
  });

const chatMessagesStream = defineTable({
  threadId: v.id("chatThreadsStream"),
  userId: v.optional(v.id("users")), // Optional for anonymous users
  role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
  content: v.string(),
  streamId: v.optional(v.string()), // For persistent-text-streaming (legacy)
  agentMessageId: v.optional(v.string()), // Links to agent component message for stream deltas
  status: v.union(
    v.literal("pending"),
    v.literal("streaming"),
    v.literal("complete"),
    v.literal("error"),
  ),
  model: v.optional(v.string()),
  tokensUsed: v.optional(
    v.object({
      input: v.number(),
      output: v.number(),
    }),
  ),
  elapsedMs: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_thread", ["threadId", "createdAt"])
  .index("by_streamId", ["streamId"])
  .index("by_agentMessageId", ["agentMessageId"])
  .index("by_user", ["userId"]);

/* ------------------------------------------------------------------ */
/* SHARED PUBLIC CACHE — Canonical Source Layer (CSL)                  */
/* Cross-user public-origin content only.                              */
/* Privacy invariant: user queries, scratchpad, or auth-gated content  */
/* MUST NEVER be written here. Enforced by validators in               */
/* convex/domains/search/sharedCache.ts                                */
/* See: docs/architecture/FAST_SLOW_RUNTIME_SPEC.md §3                 */
/* ------------------------------------------------------------------ */
const canonicalSources = defineTable({
  // sha256(stableStringify({url, day}))
  key: v.string(),
  url: v.string(),
  fetchedAt: v.number(),
  ttlMs: v.number(),
  contentType: v.union(
    v.literal("html"),
    v.literal("json"),
    v.literal("pdf"),
    v.literal("markdown"),
    v.literal("text"),
  ),
  // sha256 of body — detect content drift, dedupe across same-URL re-fetches
  bodyHash: v.string(),
  // Bounded body (MAX_CSL_BODY_BYTES enforced at insert)
  body: v.string(),
  bodyBytes: v.number(),
  sourceClass: v.union(
    v.literal("news"),
    v.literal("regulatory"),
    v.literal("careers"),
    v.literal("profile"),
    v.literal("other"),
  ),
  // Hard privacy flag — validator rejects inserts with false
  isPublicOrigin: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_key", ["key"])
  .index("by_url", ["url"])
  .index("by_sourceClass_fetchedAt", ["sourceClass", "fetchedAt"]);

/* ------------------------------------------------------------------ */
/* SHARED PUBLIC CACHE — Extracted Signal Layer (ESL)                  */
/* Deduplicated public facts keyed by (entitySlug, signalType, day).   */
/* Privacy invariant: only derived from canonicalSources entries.      */
/* ------------------------------------------------------------------ */
const extractedSignals = defineTable({
  // sha256(stableStringify({entitySlug, signalType, dayBucket}))
  key: v.string(),
  entitySlug: v.string(),
  signalType: v.string(),
  // YYYY-MM-DD
  dayBucket: v.string(),
  // Value bounded to MAX_ESL_VALUE_BYTES at insert
  value: v.string(),
  // Citation chain back to CSL entries
  sourceCanonicalKeys: v.array(v.string()),
  // 0..1, computed from #sources + agreement; validator clamps
  confidence: v.number(),
  extractedAt: v.number(),
  extractorModel: v.string(),
  isPublicOrigin: v.boolean(),
})
  .index("by_key", ["key"])
  .index("by_entity_signal_day", ["entitySlug", "signalType", "dayBucket"])
  .index("by_entity", ["entitySlug"]);

/* ------------------------------------------------------------------ */
/* CROSS-SCOPE VIOLATION AUDIT LOG                                      */
/* Every suspected privacy boundary breach is recorded here for triage. */
/* ------------------------------------------------------------------ */
const crossScopeViolations = defineTable({
  detectedAt: v.number(),
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
  // Bounded to 1KB at insert
  details: v.string(),
  resolved: v.boolean(),
  resolvedAt: v.optional(v.number()),
})
  .index("by_detectedAt", ["detectedAt"])
  .index("by_severity_resolved", ["severity", "resolved"]);

/* ------------------------------------------------------------------ */
/* SEARCH CACHE - Global search result caching with versioning       */
/* ------------------------------------------------------------------ */
const searchCache = defineTable({
  prompt: v.string(), // Normalized search query (lowercase, trimmed)
  threadId: v.string(), // Current/latest thread ID with full content
  lastUpdated: v.number(), // Timestamp of last update
  searchCount: v.number(), // Popularity metric (how many times searched)
  versions: v.array(
    v.object({
      // History of updates
      date: v.string(), // YYYY-MM-DD when this version was created
      threadId: v.string(), // Thread ID for this version
      summary: v.string(), // What changed in this update
      timestamp: v.number(), // When this version was created
    }),
  ),
  isPublic: v.boolean(), // Whether this cache entry is publicly visible
  createdAt: v.number(), // Initial creation timestamp
})
  .index("by_prompt", ["prompt"]) // Fast lookup by query
  .index("by_popularity", ["searchCount"]) // For trending queries
  .index("by_updated", ["lastUpdated"]) // Recent updates
  .index("by_public", ["isPublic", "searchCount"]); // Public trending queries

/* ------------------------------------------------------------------ */
/* MCP TOOLS - Available tools from connected MCP servers             */
/* ------------------------------------------------------------------ */
const mcpTools = defineTable({
  serverId: v.id("mcpServers"), // which server provides this tool
  name: v.string(), // tool name
  description: v.optional(v.string()), // tool description (full)
  schema: v.optional(v.any()), // tool parameter schema (DEPRECATED - use mcpToolSchemas)
  isAvailable: v.boolean(), // whether tool is currently available
  isEnabled: v.optional(v.boolean()), // whether tool is enabled for use (user-controlled)
  lastUsed: v.optional(v.number()), // last time tool was used
  usageCount: v.optional(v.number()), // how many times tool has been used
  createdAt: v.number(),
  updatedAt: v.number(),
  // Progressive disclosure fields (thin descriptor for search)
  shortDescription: v.optional(v.string()), // One-line description (â‰¤100 chars) for search
  category: v.optional(v.string()), // e.g., "filesystem", "database", "api", "web"
  keywords: v.optional(v.array(v.string())), // Search keywords for tool discovery
  schemaHash: v.optional(v.string()), // FK to mcpToolSchemas.schemaHash for on-demand hydration
  accessTier: v.optional(
    v.union(
      v.literal("public"), // Anyone can see/use
      v.literal("user"), // User-owned tools only
      v.literal("restricted"), // Requires explicit grant
    ),
  ),
})
  .index("by_server", ["serverId"])
  .index("by_server_available", ["serverId", "isAvailable"])
  .index("by_name", ["name"])
  .index("by_server_name", ["serverId", "name"])
  .index("by_category", ["category", "isAvailable"])
  .index("by_schema_hash", ["schemaHash"]);

/* ------------------------------------------------------------------ */
/* MCP TOOL SCHEMAS - Cached full schemas for on-demand hydration     */
/* ------------------------------------------------------------------ */
const mcpToolSchemas = defineTable({
  toolId: v.id("mcpTools"), // FK to mcpTools
  serverId: v.id("mcpServers"), // Server for quick lookups
  toolName: v.string(), // Tool name for reference
  schemaHash: v.string(), // SHA-256 of JSON.stringify(schema) for dedup/versioning
  fullSchema: v.any(), // The complete JSON Schema
  parametersCount: v.number(), // Quick complexity metric
  requiredParams: v.array(v.string()), // List of required param names
  cachedAt: v.number(), // When schema was cached
  expiresAt: v.optional(v.number()), // Optional TTL for cache invalidation
})
  .index("by_tool", ["toolId"])
  .index("by_server_name", ["serverId", "toolName"])
  .index("by_hash", ["schemaHash"]);

/* ------------------------------------------------------------------ */
/* MCP SESSIONS - Active MCP client sessions                          */
/* ------------------------------------------------------------------ */
const mcpSessions = defineTable({
  serverId: v.id("mcpServers"), // which server this session connects to
  userId: v.id("users"), // session owner
  sessionId: v.string(), // unique session identifier
  status: v.union(
    v.literal("connecting"),
    v.literal("connected"),
    v.literal("disconnected"),
    v.literal("error"),
  ),
  connectedAt: v.optional(v.number()), // when session was established
  disconnectedAt: v.optional(v.number()), // when session ended
  errorMessage: v.optional(v.string()), // error details if status is error
  toolsAvailable: v.optional(v.array(v.string())), // available tool names
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_server", ["serverId"])
  .index("by_user", ["userId"])
  .index("by_session_id", ["sessionId"])
  .index("by_status", ["status"]);

/* ------------------------------------------------------------------ */
/* USER PREFERENCES - UI settings and customizations                  */
/* ------------------------------------------------------------------ */
const userPreferences = defineTable({
  userId: v.id("users"),
  // Sidebar preferences
  ungroupedSectionName: v.optional(v.string()), // custom name for ungrouped documents section
  isUngroupedExpanded: v.optional(v.boolean()), // expand/collapse state for ungrouped section
  organizationMode: v.optional(v.string()), // 'flat' | 'folders' | 'smart' | 'filetype'
  iconOrder: v.optional(v.array(v.string())), // persisted order of Integrate section icons
  docOrderByGroup: v.optional(v.record(v.string(), v.array(v.id("documents")))), // persisted per-group document order for Sidebar
  // Documents grid ordering (server-side persistence)
  docOrderByFilter: v.optional(
    v.record(v.string(), v.array(v.id("documents"))),
  ), // persisted per-filter document order for Documents grid (list/cards)
  docOrderBySegmented: v.optional(
    v.record(v.string(), v.array(v.id("documents"))),
  ), // persisted per-group document order for Documents grid segmented view
  // Account reminders/preferences
  linkReminderOptOut: v.optional(v.boolean()), // true => do not show anonymous link reminders
  // Calendar & planner UI preferences
  calendarHubSizePct: v.optional(v.number()), // preferred % height for Calendar panel (20-80)
  plannerMode: v.optional(
    v.union(
      v.literal("list"),
      v.literal("calendar"),
      v.literal("kanban"),
      v.literal("weekly"),
    ),
  ),
  // Timezone preference (IANA name, e.g. "America/Los_Angeles")
  timeZone: v.optional(v.string()),
  // Planner view preferences
  plannerDensity: v.optional(
    v.union(v.literal("comfortable"), v.literal("compact")),
  ),
  showWeekInAgenda: v.optional(v.boolean()),
  agendaMode: v.optional(
    v.union(
      v.literal("list"),
      v.literal("kanban"),
      v.literal("weekly"),
      v.literal("mini"),
    ),
  ),
  // Persisted selected day for Agenda (UTC ms of local day start)
  agendaSelectedDateMs: v.optional(v.number()),
  // Upcoming list-specific view preference
  upcomingMode: v.optional(v.union(v.literal("list"), v.literal("mini"))),
  // Per-user Kanban lane titles (display labels for status lanes)
  kanbanLaneTitles: v.optional(
    v.object({
      todo: v.string(),
      in_progress: v.string(),
      done: v.string(),
      blocked: v.string(),
    }),
  ),
  // Persisted ordering for Today's Agenda (list) and Upcoming lists
  agendaListOrder: v.optional(v.array(v.string())),
  upcomingListOrder: v.optional(v.array(v.string())),
  // Agents module preferences (generic key/value store)
  agentsPrefs: v.optional(v.record(v.string(), v.string())),
  // Tracked hashtags/topics for daily dossier/newsletter
  trackedHashtags: v.optional(v.array(v.string())),
  // Tech stack profile for dependency impact mapping
  techStack: v.optional(v.array(v.string())),
  // Calendar ingestion preferences
  gmailIngestEnabled: v.optional(v.boolean()),
  gcalSyncEnabled: v.optional(v.boolean()),
  calendarAutoAddMode: v.optional(
    v.union(v.literal("auto"), v.literal("propose")),
  ),
  // Onboarding status
  onboardingSeededAt: v.optional(v.number()),
  // SMS notification preferences
  phoneNumber: v.optional(v.string()), // E.164 format (e.g., "+14083335386")
  smsNotificationsEnabled: v.optional(v.boolean()), // Master toggle for SMS notifications
  smsMeetingCreated: v.optional(v.boolean()), // Notify when meeting is created
  smsMeetingReminder: v.optional(v.boolean()), // Notify before meeting starts
  smsMorningDigest: v.optional(v.boolean()), // Include in morning digest SMS
  smsReminderMinutes: v.optional(v.number()), // Minutes before meeting to send reminder (default: 15)
  // Theme customization preferences
  themeMode: v.optional(
    v.union(v.literal("light"), v.literal("dark"), v.literal("system")),
  ),
  themeAccentColor: v.optional(v.string()), // Hex color or preset name (e.g., "blue", "#3B82F6")
  themeDensity: v.optional(
    v.union(
      v.literal("comfortable"),
      v.literal("compact"),
      v.literal("spacious"),
    ),
  ),
  themeFontFamily: v.optional(v.string()), // Font family name (e.g., "Inter", "System")
  themeBackgroundPattern: v.optional(v.string()), // Background pattern name (e.g., "none", "dots", "grid")
  themeReducedMotion: v.optional(v.boolean()), // Reduce animations for accessibility
  // Future: more UI preferences can be added here
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_user", ["userId"]);

/* ------------------------------------------------------------------ */
/* QUICK CAPTURES - Instant capture of thoughts, voice memos, screenshots */
/* ------------------------------------------------------------------ */
const quickCaptures = defineTable({
  userId: v.id("users"),
  type: v.union(
    v.literal("note"),
    v.literal("task"),
    v.literal("voice"),
    v.literal("screenshot"),
  ),
  content: v.string(),
  title: v.optional(v.string()),
  audioUrl: v.optional(v.string()), // For voice memos (storage URL)
  audioStorageId: v.optional(v.id("_storage")), // For voice memos (storage ID)
  screenshotUrl: v.optional(v.string()), // For screenshots (storage URL)
  screenshotStorageId: v.optional(v.id("_storage")), // For screenshots (storage ID)
  annotations: v.optional(v.any()), // Screenshot annotations
  transcription: v.optional(v.string()), // Voice memo transcription
  processed: v.boolean(), // Has AI processed it?
  linkedDocumentId: v.optional(v.id("documents")),
  tags: v.optional(v.array(v.string())),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_user_type", ["userId", "type"])
  .index("by_user_created", ["userId", "createdAt"])
  .index("by_processed", ["userId", "processed"])
  // Federated search: search across the capture content (note text /
  // task / voice transcription is rendered into `content` by callers).
  // Filter by userId so per-user scoping is enforced at index level.
  .searchIndex("search_captures", {
    searchField: "content",
    filterFields: ["userId", "type", "processed"],
  });

/* ------------------------------------------------------------------ */
/* USER BEHAVIOR EVENTS - Track user actions for pattern recognition  */
/* ------------------------------------------------------------------ */
const userBehaviorEvents = defineTable({
  userId: v.id("users"),
  eventType: v.union(
    v.literal("document_created"),
    v.literal("document_viewed"),
    v.literal("document_edited"),
    v.literal("task_completed"),
    v.literal("task_created"),
    v.literal("agent_interaction"),
    v.literal("search_performed"),
    v.literal("calendar_event_ended"),
    v.literal("quick_capture"),
  ),
  entityId: v.optional(v.string()),
  metadata: v.optional(v.any()),
  timestamp: v.number(),
  timeOfDay: v.string(), // "morning" | "afternoon" | "evening" | "night"
  dayOfWeek: v.string(), // "monday" | "tuesday" | etc.
})
  .index("by_user_time", ["userId", "timestamp"])
  .index("by_user_type", ["userId", "eventType"])
  .index("by_entity", ["entityId"]);

/* ------------------------------------------------------------------ */
/* RECOMMENDATIONS - AI-powered suggestions for users                  */
/* ------------------------------------------------------------------ */
const recommendations = defineTable({
  userId: v.id("users"),
  type: v.union(
    v.literal("pattern"), // "You usually create notes after meetings"
    v.literal("idle_content"), // "Document X hasn't been updated"
    v.literal("collaboration"), // "3 people viewed this doc"
    v.literal("external_trigger"), // "New article about [topic]"
    v.literal("smart_suggestion"), // AI-generated recommendation
  ),
  priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  message: v.string(),
  actionLabel: v.string(),
  actionType: v.optional(v.string()), // "open_document" | "create_note" | etc.
  actionData: v.optional(v.any()),
  icon: v.optional(v.string()),
  dismissed: v.boolean(),
  clicked: v.optional(v.boolean()),
  createdAt: v.number(),
  expiresAt: v.number(),
})
  .index("by_user_active", ["userId", "dismissed", "expiresAt"])
  .index("by_user_created", ["userId", "createdAt"]);

/* ------------------------------------------------------------------ */
/* USER TEACHINGS - Long-term teachability memory (facts/prefs/skills) */
/* ------------------------------------------------------------------ */
const userTeachings = defineTable({
  userId: v.id("users"),
  type: v.union(v.literal("fact"), v.literal("preference"), v.literal("skill")),
  category: v.optional(v.string()), // Stable bucket for conflict resolution
  key: v.optional(v.string()), // Short label for the teaching
  content: v.string(), // Normalized teaching text
  embedding: v.optional(v.array(v.float64())), // Vector embedding for semantic retrieval
  status: v.union(v.literal("active"), v.literal("archived")),
  source: v.optional(v.union(v.literal("explicit"), v.literal("inferred"))),
  steps: v.optional(v.array(v.string())), // For skills: ordered steps
  triggerPhrases: v.optional(v.array(v.string())), // For skills: trigger phrases
  confidence: v.optional(v.float64()), // Analyzer confidence (0-1)
  usageCount: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
  createdAt: v.number(),
  archivedAt: v.optional(v.number()),
  threadId: v.optional(v.string()), // Source thread for provenance
})
  .index("by_user", ["userId"])
  .index("by_user_type", ["userId", "type"])
  .index("by_user_category", ["userId", "category"])
  .index("by_user_status", ["userId", "status"])
  .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1536 });

/* ------------------------------------------------------------------ */
/* GOOGLE ACCOUNTS - OAuth tokens for Gmail integration               */
/* ------------------------------------------------------------------ */
const googleAccounts = defineTable({
  userId: v.id("users"),
  provider: v.literal("google"),
  email: v.optional(v.string()),
  accessToken: v.string(),
  refreshToken: v.optional(v.string()),
  scope: v.optional(v.string()),
  expiryDate: v.optional(v.number()), // ms since epoch
  tokenType: v.optional(v.string()),
  historyId: v.optional(v.string()), // Gmail history cursor for watch
  gcalSyncToken: v.optional(v.string()), // Google Calendar sync token
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_provider", ["userId", "provider"]);

/* ------------------------------------------------------------------ */
/* INTEGRATIONS - Slack, GitHub, Notion OAuth tokens                   */
/* ------------------------------------------------------------------ */
const slackAccounts = defineTable({
  userId: v.id("users"),
  provider: v.literal("slack"),
  teamId: v.optional(v.string()),
  teamName: v.optional(v.string()),
  botUserId: v.optional(v.string()),
  authedUserId: v.optional(v.string()),
  accessToken: v.string(), // bot token
  userAccessToken: v.optional(v.string()), // authed_user.access_token if granted
  scope: v.optional(v.string()),
  tokenType: v.optional(v.string()),
  // Default channel for digest/notification delivery
  defaultChannelId: v.optional(v.string()),
  defaultChannelName: v.optional(v.string()),
  commandCenterThreadTs: v.optional(v.string()),
  commandCenterChannelId: v.optional(v.string()),
  lastCommandCenterDate: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_provider", ["userId", "provider"])
  .index("by_teamId", ["teamId"]);

const githubAccounts = defineTable({
  userId: v.id("users"),
  provider: v.literal("github"),
  username: v.optional(v.string()),
  accessToken: v.string(),
  scope: v.optional(v.string()),
  tokenType: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_provider", ["userId", "provider"]);

const notionAccounts = defineTable({
  userId: v.id("users"),
  provider: v.literal("notion"),
  workspaceId: v.optional(v.string()),
  workspaceName: v.optional(v.string()),
  botId: v.optional(v.string()),
  accessToken: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_provider", ["userId", "provider"]);

const linkedinAccounts = defineTable({
  userId: v.id("users"),
  provider: v.literal("linkedin"),
  personUrn: v.optional(v.string()), // urn:li:person:{id}
  displayName: v.optional(v.string()),
  email: v.optional(v.string()),
  profilePictureUrl: v.optional(v.string()),
  accessToken: v.string(),
  refreshToken: v.optional(v.string()),
  scope: v.optional(v.string()), // e.g., "w_member_social openid email"
  expiresAt: v.optional(v.number()), // ms since epoch
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_provider", ["userId", "provider"]);

/* ------------------------------------------------------------------ */
/* LINKEDIN FUNDING POSTS - Track posted companies for deduplication  */
/* Enables referencing previous posts and progression tracking        */
/* ------------------------------------------------------------------ */
/* 2-Stage Dedup System:
 *   Stage 1: Hard key match (entityId + eventKey) + semantic similarity (embedding)
 *   Stage 2: LLM-as-judge on shortlist â†’ DUPLICATE | UPDATE | NEW | CONTRADICTS
 */
const linkedinFundingPosts = defineTable({
  // Company identification (normalized to lowercase for dedup)
  companyNameNormalized: v.string(), // Lowercase, trimmed company name
  companyName: v.string(), // Original display name

  // Funding round info (at time of posting)
  roundType: v.string(), // "seed", "series-a", etc.
  amountRaw: v.string(), // "$50M"
  amountUsd: v.optional(v.number()), // Normalized USD

  // Sector categorization for filtering
  sector: v.optional(v.string()), // "HealthTech", "AI/ML", etc.
  sectorCategory: v.optional(v.string()), // "healthcare", "technology", etc.

  // Post details
  postUrn: v.string(), // LinkedIn post URN
  postUrl: v.string(), // Full URL to post
  postPart: v.optional(v.number()), // Which part of multi-part post (1, 2, 3)
  totalParts: v.optional(v.number()), // Total parts in series

  // Reference to previous posts for same company (progression tracking)
  previousPostId: v.optional(v.id("linkedinFundingPosts")),
  progressionType: v.optional(
    v.union(
      v.literal("new"), // First mention
      v.literal("update"), // Same round, updated info
      v.literal("next-round"), // Company raised new round
    ),
  ),

  // Timestamps
  postedAt: v.number(),
  fundingEventId: v.optional(v.id("fundingEvents")),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // 2-STAGE DEDUP SYSTEM - Semantic + LLM-as-judge deduplication
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  // Canonical identifiers for hard-match dedup (Stage 1a)
  entityId: v.optional(v.string()), // Canonical entity ID (e.g., company URN)
  eventKey: v.optional(v.string()), // Normalized event key: "{entityId}:{roundType}:{date}"

  // Structured claims for semantic comparison (Stage 1b + Stage 2)
  claims: v.optional(
    v.array(
      v.object({
        claimType: v.string(), // "funding_amount", "investor", "valuation", etc.
        subject: v.string(), // Entity the claim is about
        predicate: v.string(), // The relationship/property
        object: v.string(), // The value/target
        confidence: v.optional(v.number()), // Extraction confidence 0-1
      }),
    ),
  ),

  // Canonical summary for embedding (Stage 1b)
  contentSummary: v.optional(v.string()), // Canonical "card summary" text
  embedding: v.optional(v.array(v.float64())), // 1536-dim text-embedding-3-small

  // Supersession tracking (Stage 2 output)
  supersedesPostId: v.optional(v.id("linkedinFundingPosts")), // Post this replaces
  relatedPostIds: v.optional(v.array(v.id("linkedinFundingPosts"))), // Related posts
  diffSummary: v.optional(v.string()), // What changed from prior post

  // LLM-as-judge dedup verdict (Stage 2)
  dedupJudgment: v.optional(
    v.object({
      verdict: v.union(
        v.literal("NEW"), // First-ever post for this event
        v.literal("UPDATE"), // Same event, new material info
        v.literal("DUPLICATE"), // Semantically identical, skip
        v.literal("CONTRADICTS_PRIOR"), // Contradicts previous post
        v.literal("INCONCLUSIVE"), // Judge couldn't decide
      ),
      comparedToPostId: v.optional(v.id("linkedinFundingPosts")),
      reasoning: v.optional(v.string()), // Brief reasoning
      confidence: v.optional(v.number()), // Judge confidence 0-1
      judgedAt: v.number(), // When judgment was made
    }),
  ),
})
  .index("by_company", ["companyNameNormalized"])
  .index("by_company_round", ["companyNameNormalized", "roundType"])
  .index("by_postedAt", ["postedAt"])
  .index("by_sector", ["sectorCategory", "postedAt"])
  .index("by_roundType", ["roundType", "postedAt"])
  .index("by_entityId", ["entityId"])
  .index("by_eventKey", ["eventKey"])
  .searchIndex("search_company", {
    searchField: "companyName",
    filterFields: ["roundType", "sectorCategory"],
  })
  .vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 1536,
    filterFields: ["sectorCategory"],
  });

/* ------------------------------------------------------------------ */
/* SPECIALIZED LINKEDIN POSTS - FDA, Clinical Trials, Research, M&A  */
/* ------------------------------------------------------------------ */

/**
 * LinkedIn FDA Update Posts - Tracks regulatory milestone posts
 * Enables timeline progression: "Previously cleared 3 510(k)s, now PMA approved"
 */
const linkedinFdaPosts = defineTable({
  // Company identification
  companyNameNormalized: v.string(),
  companyName: v.string(),

  // FDA event details
  eventType: v.union(
    v.literal("510k"),
    v.literal("pma"),
    v.literal("bla"),
    v.literal("nda"),
    v.literal("recall"),
    v.literal("adverse_event"),
  ),
  productName: v.string(),
  referenceNumber: v.optional(v.string()), // K-number, PMA number, etc.
  decisionDate: v.string(),
  description: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),

  // Sector categorization
  sector: v.optional(v.string()),
  sectorCategory: v.optional(v.string()),

  // Post details
  postUrn: v.string(),
  postUrl: v.string(),
  postPart: v.optional(v.number()),
  totalParts: v.optional(v.number()),

  // Timeline progression
  previousPostId: v.optional(v.id("linkedinFdaPosts")),
  progressionType: v.optional(
    v.union(
      v.literal("new"),
      v.literal("additional-clearance"), // Another 510(k) for same company
      v.literal("major-upgrade"), // 510(k) â†’ PMA progression
      v.literal("recall-follow-up"), // Post about a recalled product
    ),
  ),

  // Timestamps
  postedAt: v.number(),
  fdaCacheId: v.optional(v.string()), // Link to investorPlaybookFdaCache
})
  .index("by_company", ["companyNameNormalized"])
  .index("by_company_type", ["companyNameNormalized", "eventType"])
  .index("by_postedAt", ["postedAt"])
  .index("by_sector", ["sectorCategory", "postedAt"])
  .index("by_eventType", ["eventType", "postedAt"]);

/**
 * LinkedIn Clinical Trial Posts - Tracks trial milestone posts
 * Enables timeline: "Phase 1 completed Dec 2024, now entering Phase 3"
 */
const linkedinClinicalPosts = defineTable({
  // Company identification
  companyNameNormalized: v.string(),
  companyName: v.string(),
  drugName: v.optional(v.string()),

  // Trial details
  trialPhase: v.union(
    v.literal("preclinical"),
    v.literal("phase-1"),
    v.literal("phase-1-2"),
    v.literal("phase-2"),
    v.literal("phase-2-3"),
    v.literal("phase-3"),
    v.literal("nda-submitted"),
    v.literal("approved"),
  ),
  nctId: v.optional(v.string()), // ClinicalTrials.gov NCT ID
  indication: v.optional(v.string()),
  milestone: v.string(), // "Phase 2 results announced", "FDA Fast Track", etc.
  milestoneDate: v.string(),
  sourceUrl: v.optional(v.string()),

  // Sector categorization
  sector: v.optional(v.string()),
  sectorCategory: v.optional(v.string()),

  // Post details
  postUrn: v.string(),
  postUrl: v.string(),
  postPart: v.optional(v.number()),
  totalParts: v.optional(v.number()),

  // Timeline progression
  previousPostId: v.optional(v.id("linkedinClinicalPosts")),
  previousPhase: v.optional(v.string()), // For phase progression tracking
  progressionType: v.optional(
    v.union(
      v.literal("new"),
      v.literal("phase-advance"), // Phase 1 â†’ Phase 2
      v.literal("results-announced"), // Trial results
      v.literal("regulatory-milestone"), // Fast Track, Breakthrough, etc.
      v.literal("approval"), // FDA/EMA approval
    ),
  ),

  // Timestamps
  postedAt: v.number(),
})
  .index("by_company", ["companyNameNormalized"])
  .index("by_company_drug", ["companyNameNormalized", "drugName"])
  .index("by_postedAt", ["postedAt"])
  .index("by_sector", ["sectorCategory", "postedAt"])
  .index("by_phase", ["trialPhase", "postedAt"]);

/**
 * LinkedIn Research Posts - Tracks academic paper/research posts
 * Enables timeline: "Building on their 2024 Nature paper on X..."
 */
const linkedinResearchPosts = defineTable({
  // Entity identification (company or researcher)
  entityNameNormalized: v.string(),
  entityName: v.string(),
  entityType: v.union(
    v.literal("company"),
    v.literal("researcher"),
    v.literal("institution"),
  ),

  // Paper details
  paperTitle: v.string(),
  authors: v.array(v.string()),
  journal: v.optional(v.string()),
  publishDate: v.string(),
  doi: v.optional(v.string()),
  arxivId: v.optional(v.string()),
  abstract: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),

  // Impact metrics
  citationCount: v.optional(v.number()),
  impactScore: v.optional(v.number()), // h-index, impact factor, etc.

  // Sector categorization
  sector: v.optional(v.string()),
  sectorCategory: v.optional(v.string()),
  researchArea: v.optional(v.string()), // "AI/ML", "Biotech", "Quantum", etc.

  // Post details
  postUrn: v.string(),
  postUrl: v.string(),
  postPart: v.optional(v.number()),
  totalParts: v.optional(v.number()),

  // Timeline progression
  previousPostId: v.optional(v.id("linkedinResearchPosts")),
  progressionType: v.optional(
    v.union(
      v.literal("new"),
      v.literal("follow-up-study"), // Same authors, related topic
      v.literal("breakthrough"), // High-impact publication
      v.literal("citation-milestone"), // Paper reached citation milestone
    ),
  ),

  // Timestamps
  postedAt: v.number(),
})
  .index("by_entity", ["entityNameNormalized"])
  .index("by_entity_type", ["entityNameNormalized", "entityType"])
  .index("by_postedAt", ["postedAt"])
  .index("by_sector", ["sectorCategory", "postedAt"])
  .index("by_researchArea", ["researchArea", "postedAt"]);

/**
 * LinkedIn M&A Posts - Tracks acquisition/merger posts
 * Enables timeline: "Third acquisition this year, previously acquired X and Y"
 */
const linkedinMaPosts = defineTable({
  // Acquirer identification
  acquirerNameNormalized: v.string(),
  acquirerName: v.string(),

  // Target identification
  targetNameNormalized: v.string(),
  targetName: v.string(),

  // Deal details
  dealType: v.union(
    v.literal("acquisition"),
    v.literal("merger"),
    v.literal("strategic-investment"),
    v.literal("spin-off"),
    v.literal("divestiture"),
  ),
  dealValue: v.optional(v.string()), // "$500M", "Undisclosed"
  dealValueUsd: v.optional(v.number()),
  announcedDate: v.string(),
  closedDate: v.optional(v.string()),
  status: v.union(
    v.literal("announced"),
    v.literal("pending"),
    v.literal("closed"),
    v.literal("terminated"),
  ),
  sourceUrl: v.optional(v.string()),

  // Sector categorization
  sector: v.optional(v.string()),
  sectorCategory: v.optional(v.string()),

  // Post details
  postUrn: v.string(),
  postUrl: v.string(),
  postPart: v.optional(v.number()),
  totalParts: v.optional(v.number()),

  // Timeline progression (for serial acquirers)
  previousPostId: v.optional(v.id("linkedinMaPosts")),
  acquirerDealCount: v.optional(v.number()), // How many deals this acquirer has done
  progressionType: v.optional(
    v.union(
      v.literal("new"),
      v.literal("serial-acquirer"), // Same acquirer, another deal
      v.literal("deal-update"), // Status change (announced â†’ closed)
      v.literal("target-history"), // Target's journey to acquisition
    ),
  ),

  // Timestamps
  postedAt: v.number(),
})
  .index("by_acquirer", ["acquirerNameNormalized"])
  .index("by_target", ["targetNameNormalized"])
  .index("by_postedAt", ["postedAt"])
  .index("by_sector", ["sectorCategory", "postedAt"])
  .index("by_dealType", ["dealType", "postedAt"]);

/* ------------------------------------------------------------------ */
/* LinkedIn Post Archive - Unified archive of ALL posted content      */
/* ------------------------------------------------------------------ */
const linkedinPostArchive = defineTable({
  dateString: v.string(),
  persona: v.string(),
  postType: v.string(),
  content: v.string(),
  postId: v.optional(v.string()),
  postUrl: v.optional(v.string()),
  factCheckCount: v.optional(v.number()),
  metadata: v.optional(v.any()),
  postedAt: v.number(),
  target: v.optional(v.union(v.literal("personal"), v.literal("organization"))),
})
  .index("by_date", ["dateString"])
  .index("by_type", ["postType", "postedAt"])
  .index("by_date_persona", ["dateString", "persona"])
  .index("by_postedAt", ["postedAt"])
  .index("by_target_postedAt", ["target", "postedAt"]);

/* ------------------------------------------------------------------ */
/* LinkedIn Archive Entity Links — denormalized many-to-many index     */
/* Each row: (archiveRowId, companyId) with copy of postedAt/postType  */
/* for cheap reverse lookups: "all posts mentioning entity X".         */
/* Populated by linkArchiveRowsToEntities + the funding-tracker        */
/* backfill. Convex doesn't natively index array fields for `contains` */
/* queries, so we denormalize.                                          */
/* ------------------------------------------------------------------ */
const linkedinArchiveEntityLinks = defineTable({
  archiveRowId: v.id("linkedinPostArchive"),
  companyId: v.id("entityContexts"),
  postedAt: v.number(),
  postType: v.string(),
  // Soft denormalized fields the UI uses without joining back to the post:
  dateString: v.string(),
  matchSource: v.union(
    v.literal("findings_round"), // matched via metadata.findings.rounds[].companyName
    v.literal("content_mention"), // matched via plain-text scan of content
  ),
})
  .index("by_company_postedAt", ["companyId", "postedAt"])
  .index("by_archive_row", ["archiveRowId"])
  .index("by_archive_company", ["archiveRowId", "companyId"]);

/* ------------------------------------------------------------------ */
/* Pi-AI Pipeline Runs — durable record of pi-ai pipeline executions   */
/*                                                                     */
/* One row per run; steps are normalized into pipelineSteps below so   */
/* the UI can render a step timeline cheaply via by_run index. Outputs */
/* either flow back into NodeBench (Workspace document, archive row)   */
/* or stay export-only (zip handoff to Claude Code per S23264).        */
/*                                                                     */
/* Telemetry note: each run is also written to the canonical           */
/* traceAuditEntries table (see pipeline_operational_standard.md) via  */
/* `emitPipelineProjectionInstrumented`, so the existing operator      */
/* dashboards + verdict gates work unchanged.                          */
/* ------------------------------------------------------------------ */
const pipelineRuns = defineTable({
  pipelineKind: v.union(
    v.literal("code_gen"),
    v.literal("design_gen"),
    v.literal("research"),
    v.literal("custom"),
  ),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("succeeded"),
    v.literal("failed"),
    v.literal("cancelled"),
  ),
  // Verdict mirrors agent_run_verdict_workflow's bounded enum.
  verdict: v.optional(
    v.union(
      v.literal("verified"),
      v.literal("provisionally_verified"),
      v.literal("needs_review"),
      v.literal("awaiting_approval"),
      v.literal("failed"),
      v.literal("in_progress"),
    ),
  ),
  title: v.string(),
  spec: v.string(), // input prompt / spec
  modelId: v.string(), // pi-ai model id (e.g., "openai:gpt-5.4-mini")
  ownerKey: v.optional(v.string()), // user:<id> or anon:<sessionId>
  createdAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  // Cost telemetry
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  estimatedUsd: v.optional(v.number()),
  // Output handoff
  outputDocumentId: v.optional(v.id("documents")),
  outputArchiveRowId: v.optional(v.id("linkedinPostArchive")),
  outputZipStorageId: v.optional(v.id("_storage")),
  // Failure surfacing — never silent per HONEST_STATUS
  errorMessage: v.optional(v.string()),
  // Stable run id for trace correlation across actions
  runId: v.string(),
  // Idempotency key — sha256(pipelineKind + spec + ownerKey)
  idempotencyKey: v.string(),
})
  .index("by_runId", ["runId"])
  .index("by_idempotencyKey", ["idempotencyKey"])
  .index("by_owner_createdAt", ["ownerKey", "createdAt"])
  .index("by_kind_createdAt", ["pipelineKind", "createdAt"])
  .index("by_status_createdAt", ["status", "createdAt"]);

/* ------------------------------------------------------------------ */
/* Pi-AI Scheduled Pipeline Runs — recurring or future-dated runs      */
/*                                                                     */
/* One row per schedule. The pipelineRunsCron sweep wakes hourly,      */
/* finds rows whose `nextRunAt <= now`, kicks off the workflow, and    */
/* advances `nextRunAt` per the cadence. Active rows have `enabled`    */
/* true; disable by patch (no row deletion to preserve audit trail).   */
/* ------------------------------------------------------------------ */
const scheduledPipelineRuns = defineTable({
  ownerKey: v.optional(v.string()), // user:<id> or system:<name>
  pipelineKind: v.union(
    v.literal("code_gen"),
    v.literal("design_gen"),
    v.literal("research"),
  ),
  spec: v.string(),
  title: v.optional(v.string()),
  modelId: v.string(),
  cadence: v.union(
    v.literal("once"),     // fire once at nextRunAt, then disable
    v.literal("hourly"),
    v.literal("daily"),
    v.literal("weekly"),
  ),
  enabled: v.boolean(),
  nextRunAt: v.number(),  // ms epoch
  lastRunAt: v.optional(v.number()),
  lastRunId: v.optional(v.string()),
  lastStatus: v.optional(v.string()),
  // Optional: deep-mode for research, image size for design-gen, etc.
  options: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_enabled_nextRunAt", ["enabled", "nextRunAt"])
  .index("by_owner_createdAt", ["ownerKey", "createdAt"]);

/* ------------------------------------------------------------------ */
/* Pi-AI Pipeline Run Streams — reactive partial-text rows for live    */
/* streaming UX. One row per (runId, stepName) pair; updated on every  */
/* delta during streamed pi-ai completions. Convex's reactive query    */
/* layer means clients see the text grow in real-time without HTTP     */
/* infrastructure (no PersistentTextStreaming HTTP endpoint required). */
/* ------------------------------------------------------------------ */
const pipelineRunStreams = defineTable({
  runId: v.string(),
  pipelineRunId: v.id("pipelineRuns"),
  stepName: v.string(), // e.g., "research.synthesize"
  partialText: v.string(),
  status: v.union(
    v.literal("streaming"),
    v.literal("complete"),
    v.literal("error"),
  ),
  startedAt: v.number(),
  updatedAt: v.number(),
  errorMessage: v.optional(v.string()),
})
  .index("by_runId_stepName", ["runId", "stepName"])
  .index("by_pipelineRunId", ["pipelineRunId"]);

/* ------------------------------------------------------------------ */
/* Pi-AI Pipeline Steps — normalized step events for cheap timeline    */
/* rendering. Each row = one observable event in a pipelineRuns row.   */
/* ------------------------------------------------------------------ */
const pipelineSteps = defineTable({
  runId: v.string(), // foreign-key to pipelineRuns.runId
  pipelineRunId: v.id("pipelineRuns"),
  seq: v.number(), // monotonic order within the run
  name: v.string(), // e.g., "spec.parse", "scaffold.generate", "verify.test"
  status: v.union(
    v.literal("running"),
    v.literal("ok"),
    v.literal("error"),
    v.literal("skipped"),
  ),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  // Honest score components — null/undefined means "not measured here"
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  estimatedUsd: v.optional(v.number()),
  modelId: v.optional(v.string()),
  // Free-form scratchpad (cap < 32KB enforced at write time per BOUND_READ)
  scratchpad: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
})
  .index("by_run", ["pipelineRunId", "seq"])
  .index("by_runId", ["runId"]);

/* ------------------------------------------------------------------ */
/* LinkedIn Held Posts - Posts blocked by engagement quality gate     */
/* ------------------------------------------------------------------ */
const linkedinHeldPosts = defineTable({
  dateString: v.string(),
  persona: v.string(),
  postType: v.string(),
  content: v.string(),
  target: v.string(),
  failures: v.array(v.string()),
  softWarnings: v.array(v.string()),
  heldAt: v.number(),
  status: v.union(
    v.literal("held"),
    v.literal("rewritten"),
    v.literal("force_posted"),
    v.literal("discarded"),
  ),
  resolvedAt: v.optional(v.number()),
  rewrittenContent: v.optional(v.string()),
  metadata: v.optional(v.any()),
})
  .index("by_status", ["status", "heldAt"])
  .index("by_date", ["dateString", "heldAt"]);

/* ------------------------------------------------------------------ */
/* LinkedIn Content Queue - Central backlog for ALL content           */
/* Posts flow: pending â†’ judging â†’ approved â†’ scheduled â†’ posted      */
/* ------------------------------------------------------------------ */
const linkedinContentQueue = defineTable({
  content: v.string(),
  contentHash: v.string(),
  postType: v.string(),
  persona: v.string(),
  target: v.union(v.literal("personal"), v.literal("organization")),
  scheduledSlot: v.optional(v.string()),
  scheduledFor: v.optional(v.number()),
  priority: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("judging"),
    v.literal("approved"),
    v.literal("needs_rewrite"),
    v.literal("rejected"),
    v.literal("scheduled"),
    v.literal("posted"),
    v.literal("failed"),
  ),
  engagementGateResult: v.optional(
    v.object({
      passed: v.boolean(),
      failures: v.array(v.string()),
      softWarnings: v.array(v.string()),
    }),
  ),
  llmJudgeResult: v.optional(
    v.object({
      model: v.string(),
      verdict: v.union(
        v.literal("approve"),
        v.literal("needs_rewrite"),
        v.literal("reject"),
      ),
      hookQuality: v.boolean(),
      opinionDepth: v.boolean(),
      questionAuthenticity: v.boolean(),
      reasoning: v.string(),
      judgedAt: v.number(),
    }),
  ),
  source: v.union(
    v.literal("backfill"),
    v.literal("fresh"),
    v.literal("manual"),
  ),
  sourcePostId: v.optional(v.string()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.number(),
  postedAt: v.optional(v.number()),
  postedPostId: v.optional(v.string()),
  postedPostUrl: v.optional(v.string()),
})
  .index("by_status", ["status", "createdAt"])
  .index("by_content_hash", ["contentHash"])
  .index("by_scheduled_slot", ["scheduledSlot", "scheduledFor"])
  .index("by_priority", ["status", "priority"])
  .index("by_source", ["source", "createdAt"])
  .index("by_target_status", ["target", "status", "priority"]);

/* ------------------------------------------------------------------ */
/* API KEYS - Per-user API keys for providers                        */
/* ------------------------------------------------------------------ */
const userApiKeys = defineTable({
  userId: v.id("users"),
  provider: v.string(),
  encryptedApiKey: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_user_provider", ["userId", "provider"]);

/* ------------------------------------------------------------------ */
/* DAILY USAGE - Per-user, per-provider daily counts                  */
/* ------------------------------------------------------------------ */
const dailyUsage = defineTable({
  userId: v.optional(v.id("users")),
  provider: v.string(),
  date: v.string(), // YYYY-MM-DD
  count: v.optional(v.number()),
  limit: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
})
  .index("by_provider_date", ["provider", "date"])
  .index("by_user_provider_date", ["userId", "provider", "date"]);

/* ------------------------------------------------------------------ */
/* SUBSCRIPTIONS - simple $1 supporter unlock                          */
/* ------------------------------------------------------------------ */
const subscriptions = defineTable({
  userId: v.id("users"),
  plan: v.union(v.literal("free"), v.literal("supporter")),
  status: v.union(v.literal("active"), v.literal("canceled")),
  createdAt: v.number(),
  updatedAt: v.number(),
  stripeSessionId: v.optional(v.string()),
  stripePaymentIntentId: v.optional(v.string()),
})
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"]);

/* ------------------------------------------------------------------ */
/* MCP TOOL LEARNING - AI learning data for adaptive guidance          */
/* ------------------------------------------------------------------ */
const mcpToolLearning = defineTable({
  toolId: v.id("mcpTools"), // which tool this learning data is for
  serverId: v.id("mcpServers"), // which server provides the tool
  naturalLanguageQuery: v.string(), // the natural language input
  convertedParameters: v.any(), // the AI-converted parameters
  executionSuccess: v.boolean(), // whether the execution succeeded
  executionResult: v.optional(v.any()), // the execution result (if successful)
  errorMessage: v.optional(v.string()), // error details (if failed)
  learningType: v.union(
    v.literal("auto_discovery"), // automatic learning during tool discovery
    v.literal("user_interaction"), // learning from real user interactions
    v.literal("manual_training"), // manually triggered learning
  ),
  qualityScore: v.optional(v.number()), // 0-1 score of how good this example is
  timingMs: v.optional(v.number()), // execution time in milliseconds
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_tool", ["toolId"])
  .index("by_server", ["serverId"])
  .index("by_success", ["executionSuccess"])
  .index("by_learning_type", ["learningType"])
  .index("by_quality", ["qualityScore"]);

/* ------------------------------------------------------------------ */
/* MCP GUIDANCE EXAMPLES - Curated examples for user guidance          */
/* ------------------------------------------------------------------ */
const mcpGuidanceExamples = defineTable({
  toolId: v.id("mcpTools"), // which tool these examples are for
  serverId: v.id("mcpServers"), // which server provides the tool
  examples: v.array(
    v.object({
      query: v.string(), // example natural language query
      parameters: v.any(), // the converted parameters
      description: v.string(), // human-readable description
      successRate: v.optional(v.number()), // success rate for this type of query
    }),
  ),
  generatedAt: v.number(), // when these examples were generated
  lastUpdated: v.number(), // when examples were last refreshed
  version: v.number(), // version number for cache invalidation
  isActive: v.boolean(), // whether these examples are currently active
})
  .index("by_tool", ["toolId"])
  .index("by_server", ["serverId"])
  .index("by_active", ["isActive"]);

/* ------------------------------------------------------------------ */
/* MCP TOOL HISTORY - Per-user usage history for MCP tools             */
/* ------------------------------------------------------------------ */
const mcpToolHistory = defineTable({
  userId: v.id("users"),
  toolId: v.id("mcpTools"),
  serverId: v.id("mcpServers"),
  naturalLanguageQuery: v.string(),
  parameters: v.any(),
  executionSuccess: v.boolean(),
  resultPreview: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_tool", ["userId", "toolId"])
  .index("by_user_createdAt", ["userId", "createdAt"])
  .index("by_user_tool_createdAt", ["userId", "toolId", "createdAt"]);

/* ------------------------------------------------------------------ */
/* MCP TOOL CALL LEDGER - Trusted access audit trail + policy gating    */
/* ------------------------------------------------------------------ */
const mcpPolicyConfigs = defineTable({
  name: v.string(), // singleton key, e.g. "default"

  // If true, policy violations block tool execution. If false, policy is logged only.
  enforce: v.boolean(),

  // Simple daily budgets. Keys are risk tiers (e.g. "read_only", "external_read", "write_internal").
  dailyLimitsByTier: v.optional(v.record(v.string(), v.number())),

  // Per-tool daily budgets (toolName -> limit).
  dailyLimitsByTool: v.optional(v.record(v.string(), v.number())),

  // Explicit tool denylist (toolName -> true). Used for rapid response.
  blockedTools: v.optional(v.record(v.string(), v.boolean())),

  // Free-form notes for ops rollouts.
  notes: v.optional(v.string()),

  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_name", ["name"]);

const mcpToolUsageDaily = defineTable({
  dateKey: v.string(), // YYYY-MM-DD (UTC)
  scope: v.union(
    v.literal("tier"),
    v.literal("tool"),
    v.literal("profile"),
    v.literal("account"),
    v.literal("account_tool"),
    v.literal("account_profile"),
  ),
  key: v.string(), // riskTier, toolName, profile, accountKey, or composite account key
  count: v.number(),
  costUnits: v.optional(v.number()),
  estimatedCostUsd: v.optional(v.number()),
  updatedAt: v.number(),
})
  .index("by_date_scope_key", ["dateKey", "scope", "key"])
  .index("by_date_scope", ["dateKey", "scope"]);

const mcpToolCallLedger = defineTable({
  toolName: v.string(),
  toolType: v.string(), // "query" | "mutation" | "action" | "direct" | "unknown"
  riskTier: v.string(), // "read_only" | "external_read" | "write_internal" | ...

  allowed: v.boolean(),
  policy: v.optional(v.any()), // evaluation summary (budgets, denylist, enforce, etc.)

  argsHash: v.string(),
  argsKeys: v.array(v.string()),
  argsPreview: v.optional(v.string()), // redacted + truncated for UI

  idempotencyKey: v.optional(v.string()),
  requestMeta: v.optional(v.any()), // upstream request context (gateway request id, etc.)
  requestId: v.optional(v.string()),
  accountKey: v.optional(v.string()),
  profileName: v.optional(v.string()),
  authMode: v.optional(v.string()),
  clientName: v.optional(v.string()),

  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
  durationMs: v.optional(v.number()),

  success: v.optional(v.boolean()),
  errorMessage: v.optional(v.string()),

  resultPreview: v.optional(v.string()), // redacted + truncated for UI
  resultBytes: v.optional(v.number()),
  costUnits: v.optional(v.number()),
  estimatedCostUsd: v.optional(v.number()),
  pricingVersion: v.optional(v.string()),
})
  .index("by_startedAt", ["startedAt"])
  .index("by_tool_startedAt", ["toolName", "startedAt"])
  .index("by_risk_startedAt", ["riskTier", "startedAt"])
  .index("by_allowed_startedAt", ["allowed", "startedAt"]);

/* ------------------------------------------------------------------ */
/* DOCUMENT SNAPSHOTS â€“ periodic snapshots to prevent step accumulation */
/* ------------------------------------------------------------------ */
const documentSnapshots = defineTable({
  documentId: v.id("documents"),
  content: v.string(),
  version: v.number(),
  createdBy: v.id("users"),
  createdAt: v.number(),
  stepCount: v.number(),

  // NEW FIELDS for enhanced management
  contentSize: v.optional(v.number()), // Track content size in bytes
  isEmergency: v.optional(v.boolean()), // Flag emergency snapshots
  isManual: v.optional(v.boolean()), // Flag manually triggered snapshots
  compressionRatio: v.optional(v.number()), // Track compression effectiveness
  triggerReason: v.optional(v.string()), // Why this snapshot was created
})
  .index("by_document", ["documentId"])
  .index("by_document_version", ["documentId", "version"])
  .index("by_created_at", ["createdAt"])
  .index("by_size", ["contentSize"]) // NEW: Index by content size
  .index("by_emergency", ["isEmergency"]); // NEW: Quick access to emergency snapshots

/* ------------------------------------------------------------------ */
/* SPREADSHEETS â€“ sheet metadata and individual cells                  */
/* ------------------------------------------------------------------ */
const spreadsheets = defineTable({
  name: v.string(),
  userId: v.optional(v.id("users")), // Optional to allow guest users
  // Optional link to a DCF interactive session (enables bidirectional sync)
  dcfSessionId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_name", ["name"]);

const sheetCells = defineTable({
  sheetId: v.id("spreadsheets"),
  row: v.number(),
  col: v.number(),
  value: v.optional(v.string()),
  type: v.optional(v.string()), // e.g. "text", "number", "formula"
  comment: v.optional(v.string()),
  updatedAt: v.number(),
  updatedBy: v.optional(v.id("users")),
})
  .index("by_sheet", ["sheetId"]) // broad queries
  .index("by_sheet_row_col", ["sheetId", "row", "col"]); // precise cell lookup

/* ------------------------------------------------------------------ */
/* TASKS â€“ personal task management                                   */
/* ------------------------------------------------------------------ */
const events = defineTable({
  userId: v.id("users"),
  title: v.string(),
  description: v.optional(v.string()),
  // Canonical Editor.js JSON (stringified) for event description
  descriptionJson: v.optional(v.string()),
  startTime: v.number(), // ms since epoch
  endTime: v.optional(v.number()), // ms since epoch
  allDay: v.optional(v.boolean()),
  location: v.optional(v.string()),
  status: v.optional(
    v.union(
      v.literal("confirmed"),
      v.literal("tentative"),
      v.literal("cancelled"),
    ),
  ),
  color: v.optional(v.string()),
  documentId: v.optional(v.id("documents")),
  tags: v.optional(v.array(v.string())),
  recurrence: v.optional(v.string()), // simple RRULE or custom text for now
  sourceType: v.optional(
    v.union(v.literal("gmail"), v.literal("gcal"), v.literal("doc")),
  ),
  sourceId: v.optional(v.string()), // external id (messageId/eventId/etc.)
  ingestionConfidence: v.optional(
    v.union(v.literal("low"), v.literal("med"), v.literal("high")),
  ),
  proposed: v.optional(v.boolean()), // requires user accept before "confirmed"
  rawSummary: v.optional(v.string()), // short extracted summary from source
  meta: v.optional(v.any()), // misc ingestion metadata (e.g., hash, origin headers)
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"]) // status filtering
  .index("by_user_start", ["userId", "startTime"]) // for range queries
  .index("by_document", ["documentId"])
  .index("by_user_source", ["userId", "sourceType", "sourceId"]); // for gmail/gcal dedup

/* ------------------------------------------------------------------ */
/* HOLIDAYS â€“ cached public holidays by country                        */
/* ------------------------------------------------------------------ */
const holidays = defineTable({
  country: v.string(), // e.g. "US"
  name: v.string(), // Holiday display name
  dateMs: v.number(), // UTC ms for the holiday date (00:00Z of that date)
  dateKey: v.string(), // "YYYY-MM-DD" (as provided by API)
  types: v.optional(v.array(v.string())),
  year: v.number(),
  raw: v.optional(v.any()), // Raw provider payload
  updatedAt: v.number(),
})
  .index("by_country_date", ["country", "dateMs"])
  .index("by_country_year", ["country", "year"])
  .index("by_date", ["dateMs"]);

/* ------------------------------------------------------------------ */
/* FINANCIAL EVENTS â€“ macro releases and earnings (cached)             */
/* ------------------------------------------------------------------ */
const financialEvents = defineTable({
  market: v.string(), // e.g. "US"
  category: v.string(), // e.g. "CPI" | "FOMC" | "NFP" | "GDP" | "PCE" | "EARNINGS"
  title: v.string(), // Display title
  dateMs: v.number(), // UTC ms of the calendar day (00:00Z)
  dateKey: v.string(), // "YYYY-MM-DD"
  time: v.optional(v.string()), // e.g. "08:30 ET"
  symbol: v.optional(v.string()), // For earnings: ticker
  raw: v.optional(v.any()), // Raw provider payload
  updatedAt: v.number(),
})
  .index("by_market_date", ["market", "dateMs"])
  .index("by_category_date", ["category", "dateMs"]);

/* ------------------------------------------------------------------ */
/* USER EVENTS â€“ personal event/task management (renamed from tasks)  */
/* ------------------------------------------------------------------ */
const userEvents = defineTable({
  userId: v.id("users"),
  ownerKey: v.optional(v.string()), // For dreaming pipeline / wiki integration
  title: v.string(),
  description: v.optional(v.string()),
  // New: canonical Editor.js JSON (stringified); plain description kept for search/snippets
  descriptionJson: v.optional(v.string()),
  status: v.union(
    v.literal("todo"),
    v.literal("in_progress"),
    v.literal("done"),
    v.literal("blocked"),
  ),
  priority: v.optional(
    v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("urgent"),
    ),
  ),
  dueDate: v.optional(v.number()), // ms since epoch
  startDate: v.optional(v.number()), // ms since epoch
  documentId: v.optional(v.id("documents")),
  eventId: v.optional(v.id("events")), // optional link to a scheduled event
  assigneeId: v.optional(v.id("users")), // optional assignee separate from owner
  refs: v.optional(
    v.array(
      v.union(
        v.object({ kind: v.literal("document"), id: v.id("documents") }),
        v.object({ kind: v.literal("userEvent"), id: v.id("userEvents") }),
        v.object({ kind: v.literal("event"), id: v.id("events") }),
      ),
    ),
  ),
  tags: v.optional(v.array(v.string())),
  color: v.optional(v.string()),
  isFavorite: v.optional(v.boolean()),
  order: v.optional(v.number()), // for Kanban ordering
  createdAt: v.number(),
  updatedAt: v.number(),

  // â”€â”€â”€ Encounter Capture (Slack/Email Distribution) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  sourceType: v.optional(
    v.union(
      v.literal("manual"), // User created in UI
      v.literal("slack"), // Captured from Slack
      v.literal("email_forward"), // Forwarded email ingest
    ),
  ),
  sourceId: v.optional(v.string()), // Slack message ts, email ID
  sourceChannelId: v.optional(v.string()), // Slack channel ID

  // Encounter-specific nested object for professional networking capture
  encounter: v.optional(
    v.object({
      participants: v.array(
        v.object({
          name: v.string(),
          role: v.optional(v.string()),
          company: v.optional(v.string()),
          email: v.optional(v.string()),
          linkedEntityId: v.optional(v.id("entityContexts")),
        }),
      ),
      companies: v.array(
        v.object({
          name: v.string(),
          linkedEntityId: v.optional(v.id("entityContexts")),
        }),
      ),
      context: v.optional(v.string()), // Meeting context/topic
      followUpRequested: v.optional(v.boolean()),
      rawText: v.optional(v.string()), // Original message/email content
      researchStatus: v.optional(
        v.union(
          v.literal("none"),
          v.literal("fast_pass"),
          v.literal("deep_dive"),
          v.literal("complete"),
        ),
      ),
    }),
  ),
})
  .index("by_user", ["userId"])
  .index("by_user_status", ["userId", "status"]) // Kanban, filters
  .index("by_user_dueDate", ["userId", "dueDate"]) // Today/Week queries
  .index("by_user_priority", ["userId", "priority"]) // prioritization
  .index("by_user_updatedAt", ["userId", "updatedAt"]) // recent activity
  .index("by_user_assignee", ["userId", "assigneeId"]) // filtering by assignee
  .index("by_document", ["documentId"])
  .index("by_user_sourceType", ["userId", "sourceType"]) // Encounter queries
  .index("by_owner_updated", ["ownerKey", "updatedAt"]); // Dreaming pipeline

/* ------------------------------------------------------------------ */
/* AGENT TIMELINES â€“ timeline docs + tasks + links                     */
/* ------------------------------------------------------------------ */
const agentTimelines = defineTable({
  // Associate a timeline with a document so it can render in DocumentView
  documentId: v.optional(v.id("documents")),
  agentThreadId: v.optional(v.string()),
  name: v.string(),
  // Base start used to compute absolute times: absoluteStart = baseStartMs + startOffsetMs
  baseStartMs: v.optional(v.number()),
  createdBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
  // Latest run result (persisted for UI readout)
  latestRunInput: v.optional(v.string()),
  latestRunOutput: v.optional(v.string()),
  latestRunAt: v.optional(v.number()),
})
  .index("by_document", ["documentId"])
  .index("by_user", ["createdBy"])
  .index("by_agent_thread", ["agentThreadId"]);

const agentTasks = defineTable({
  timelineId: v.id("agentTimelines"),
  agentThreadId: v.optional(v.string()),
  parentId: v.optional(v.id("agentTasks")),
  name: v.string(),
  // Offsets, not absolute times (backward-compatible with legacy startMs)
  startOffsetMs: v.optional(v.number()),
  startMs: v.optional(v.number()),
  durationMs: v.number(),
  progress: v.optional(v.number()), // 0..1
  status: v.optional(
    v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("paused"),
      v.literal("error"),
    ),
  ),
  agentType: v.optional(
    v.union(v.literal("orchestrator"), v.literal("main"), v.literal("leaf")),
  ),
  assigneeId: v.optional(v.id("users")),
  // Visual metadata and runtime stats for richer timeline rendering
  icon: v.optional(v.string()),
  color: v.optional(v.string()),
  sequence: v.optional(v.union(v.literal("parallel"), v.literal("sequential"))),
  description: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  outputSizeBytes: v.optional(v.number()),
  elapsedMs: v.optional(v.number()),
  startedAtMs: v.optional(v.number()),
  completedAtMs: v.optional(v.number()),
  // New: per-phase and retry/error markers
  phaseBoundariesMs: v.optional(v.array(v.number())),
  retryOffsetsMs: v.optional(v.array(v.number())),
  failureOffsetMs: v.optional(v.number()),
  order: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_timeline", ["timelineId"])
  .index("by_agent_thread", ["agentThreadId"])
  .index("by_parent", ["parentId"]);

const agentLinks = defineTable({
  timelineId: v.id("agentTimelines"),
  sourceTaskId: v.id("agentTasks"),
  targetTaskId: v.id("agentTasks"),
  type: v.optional(
    v.union(
      v.literal("e2e"),
      v.literal("s2s"),
      v.literal("s2e"),
      v.literal("e2s"),
    ),
  ),
  createdAt: v.number(),
}).index("by_timeline", ["timelineId"]);

/* ------------------------------------------------------------------ */
/* AGENT TIMELINE RUNS â€“ per-run history                               */
/* ------------------------------------------------------------------ */
const agentTimelineRuns = defineTable({
  timelineId: v.id("agentTimelines"),
  input: v.string(),
  output: v.string(),
  retryCount: v.optional(v.number()),
  modelUsed: v.optional(v.string()),
  createdAt: v.number(),
  meta: v.optional(v.any()),
})
  .index("by_timeline", ["timelineId"])
  .index("by_timeline_createdAt", ["timelineId", "createdAt"]);

/* ------------------------------------------------------------------ */
/* AGENT IMAGE RESULTS â€“ images found during agent execution          */
/* ------------------------------------------------------------------ */
const agentImageResults = defineTable({
  timelineId: v.id("agentTimelines"),
  taskId: v.optional(v.id("agentTasks")),
  imageUrl: v.string(),
  sourceUrl: v.optional(v.string()), // Source page URL
  title: v.optional(v.string()), // Image title/description
  thumbnailUrl: v.optional(v.string()), // Thumbnail URL
  width: v.optional(v.number()), // Image width
  height: v.optional(v.number()), // Image height
  format: v.optional(v.string()), // Image format (jpg, png, etc.)
  classification: v.optional(v.string()), // Classification result
  classificationConfidence: v.optional(v.number()), // Confidence score
  classificationDetails: v.optional(v.any()), // Detailed classification data
  metadata: v.optional(v.any()), // Additional metadata
  createdAt: v.number(),
})
  .index("by_timeline", ["timelineId"])
  .index("by_task", ["taskId"])
  .index("by_timeline_createdAt", ["timelineId", "createdAt"]);

/* ------------------------------------------------------------------ */
/* VOICE SESSIONS - Real-time voice agent sessions (RTVI/Daily Bots) */
/* ------------------------------------------------------------------ */
const voiceSessions = defineTable({
  sessionId: v.string(), // Unique session identifier
  userId: v.id("users"), // User who owns this session
  threadId: v.string(), // Agent thread ID for conversation continuity
  createdAt: v.number(), // Session creation timestamp
  lastActivityAt: v.number(), // Last interaction timestamp
  metadata: v.optional(
    v.object({
      // Optional session metadata
      clientType: v.optional(v.string()), // "daily-bots", "rtvi", etc.
      deviceInfo: v.optional(v.string()), // Device/browser info
      model: v.optional(v.string()), // AI model used
    }),
  ),
})
  .index("by_user", ["userId"])
  .index("by_session_id", ["sessionId"])
  .index("by_thread_id", ["threadId"])
  .index("by_last_activity", ["lastActivityAt"]);

/* ------------------------------------------------------------------ */
/* VOICE COST LEDGER - Per-user, per-day spend tracking by tier       */
/* See: docs/architecture/REALTIME_VOICE_INTEGRATION.md §2 (Phase 2)  */
/* Invariants: HONEST_SCORES (totalUsd from API response, not estimate)*/
/* ------------------------------------------------------------------ */
const voiceCostLedger = defineTable({
  userId: v.id("users"),
  dayUtc: v.string(), // YYYY-MM-DD UTC — deterministic reset boundary
  byTier: v.object({
    geminiLive: v.number(), // accumulator for current Gemini 3.1 Flash Live tier
    whisper: v.number(), // future: openai realtime transcription
    realtimeMini: v.number(), // future: openai realtime mini chat
    realtime2: v.number(), // future: openai realtime-2 phone-grade
    translate: v.number(), // future: openai realtime translation
  }),
  totalUsd: v.number(), // sum across all tiers — verified == sum(byTier)
  capUsd: v.number(), // user's daily cap, default $5
  capHitAt: v.optional(v.number()), // first ms timestamp cap was hit today
  updatedAt: v.number(),
})
  .index("by_user_day", ["userId", "dayUtc"])
  .index("by_day", ["dayUtc"]) // for daily admin rollups
  .index("by_user_recent", ["userId", "updatedAt"]);

/* ------------------------------------------------------------------ */
/* REALTIME AUDIT EVENTS - Privacy/budget/consent gate decisions      */
/* See: docs/architecture/REALTIME_VOICE_INTEGRATION.md §2 (Phase 2)  */
/* Invariants: BOUND (90d TTL), HONEST_STATUS, DETERMINISTIC          */
/* ------------------------------------------------------------------ */
const realtimeAuditEvents = defineTable({
  // Subject of the event — userId for authed users, anonId for anonymous
  userId: v.optional(v.id("users")),
  anonId: v.optional(v.string()),
  sessionId: v.optional(v.string()), // links to voiceSessions when applicable
  // Bounded enum of gate decisions — extend with care; dashboards depend on stability
  gate: v.union(
    v.literal("anonymous_no_persist"), // scenario 1: no private memory writes before consent
    v.literal("anonymous_to_linked"), // scenario 2: signup migrates anon session
    v.literal("budget_cap_hit"), // scenario 8: daily $/user cap reached
    v.literal("budget_warning_80pct"), // pre-emptive warning at 80% cap
    v.literal("pii_redacted"), // scenario 7: PII detected + redacted
    v.literal("idempotent_replay"), // scenario 9: same key returned existing capture
    v.literal("escalation_to_async"), // scenario 10: deep_research routed to Temporal
    v.literal("approval_required"), // scenario 8: phone-agent waiting for confirmation
    v.literal("approval_granted"),
    v.literal("approval_rejected"),
    v.literal("model_routing"), // deterministic routing decision recorded
    v.literal("session_terminated_pii"), // close 4005
    v.literal("session_terminated_cap"), // close 4004
  ),
  decision: v.union(
    v.literal("allowed"),
    v.literal("denied"),
    v.literal("needs_consent"),
    v.literal("needs_approval"),
    v.literal("downgraded"),
  ),
  // Hashed inputs for replay (DETERMINISTIC invariant)
  decisionHash: v.optional(v.string()),
  // Human-readable rationale, capped 500 chars
  rationale: v.optional(v.string()),
  // Optional structured payload — keep small, never store transcripts here
  metadata: v.optional(
    v.object({
      modelTier: v.optional(v.string()),
      capUsd: v.optional(v.number()),
      spentUsd: v.optional(v.number()),
      idempotencyKey: v.optional(v.string()),
      redactedSpanCount: v.optional(v.number()),
      temporalJobId: v.optional(v.string()),
    }),
  ),
  createdAt: v.number(),
})
  .index("by_user_recent", ["userId", "createdAt"])
  .index("by_anon_recent", ["anonId", "createdAt"])
  .index("by_session", ["sessionId"])
  .index("by_gate", ["gate", "createdAt"]); // dashboard aggregation

/* ------------------------------------------------------------------ */
/* REALTIME VOICE ADAPTER - Provider-agnostic capture/audit writes    */
/* ------------------------------------------------------------------ */
const realtimeVoiceCaptures = defineTable({
  userKey: v.string(),
  userId: v.optional(v.string()),
  anonymousSessionId: v.optional(v.string()),
  sessionId: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
  transcript: v.string(),
  originalTranscript: v.optional(v.string()),
  translatedTranscript: v.optional(v.string()),
  sourceLanguage: v.optional(v.string()),
  targetLanguage: v.optional(v.string()),
  surface: v.optional(v.string()),
  contextLabel: v.optional(v.string()),
  gate: v.string(),
  provenance: v.literal("voice"),
  confidence: v.literal("needs_review"),
  redactedSpans: v.optional(v.array(v.any())),
  entities: v.optional(v.array(v.any())),
  followUps: v.optional(v.array(v.string())),
  inboxRequired: v.optional(v.boolean()),
  asyncHandoff: v.optional(v.any()),
  metadata: v.optional(v.any()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
})
  .index("by_user_created", ["userKey", "createdAt"])
  .index("by_session", ["sessionId"])
  .index("by_idempotency", ["userKey", "idempotencyKey"]);

const realtimeVoiceAuditEvents = defineTable({
  userKey: v.string(),
  anonymousSessionId: v.optional(v.string()),
  sessionId: v.optional(v.string()),
  captureId: v.optional(v.id("realtimeVoiceCaptures")),
  eventType: v.string(),
  gate: v.string(),
  surface: v.optional(v.string()),
  payload: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_user_created", ["userKey", "createdAt"])
  .index("by_session", ["sessionId"])
  .index("by_capture", ["captureId"]);

const voiceRoutingDecisions = defineTable({
  userKey: v.string(),
  anonymousSessionId: v.optional(v.string()),
  surface: v.optional(v.string()),
  requestedTier: v.optional(v.string()),
  decision: v.any(),
  createdAt: v.number(),
}).index("by_user_created", ["userKey", "createdAt"]);

/* ------------------------------------------------------------------ */
/* FEED ITEMS - Central Newsstand for live intelligence feed          */
/* Shared public feed sourced from HackerNews, ArXiv, RSS, etc.       */
/* "Write Once, Read Many" - one hourly ingest, all users read free   */
/* ------------------------------------------------------------------ */
const feedItems = defineTable({
  sourceId: v.string(), // e.g., "hn-12345" (deduplication key)
  type: v.union(
    v.literal("news"),
    v.literal("signal"),
    v.literal("dossier"),
    v.literal("repo"), // GitHub repos
    v.literal("product"), // Product launches
  ),
  category: v.optional(
    v.union(
      // For segmented views
      v.literal("tech"), // General tech news
      v.literal("ai_ml"), // AI/ML research & news
      v.literal("startups"), // Startup/funding news
      v.literal("products"), // Product launches (Product Hunt, etc.)
      v.literal("opensource"), // Open source / GitHub
      v.literal("finance"), // Finance/markets
      v.literal("research"), // Academic research (ArXiv, etc.)
    ),
  ),
  title: v.string(),
  summary: v.string(), // The "Newsletter" style blurb
  url: v.string(), // Link to original content
  source: v.string(), // "YCombinator", "ArXiv", "GitHub", "ProductHunt"
  tags: v.array(v.string()), // ["Trending", "AI", "Funding"]
  metrics: v.optional(
    v.array(
      v.object({
        label: v.string(),
        value: v.string(),
        trend: v.optional(v.union(v.literal("up"), v.literal("down"))),
      }),
    ),
  ),
  publishedAt: v.string(), // ISO date string
  score: v.number(), // For sorting by "Heat"
  createdAt: v.optional(v.number()), // When we ingested this
})
  .index("by_published", ["publishedAt"])
  .index("by_score", ["score"])
  .index("by_source", ["source"])
  .index("by_type", ["type"])
  .index("by_category", ["category"]) // Segmented view filtering
  .index("by_source_id", ["sourceId"]); // Fast deduplication lookup

/* ------------------------------------------------------------------ */
/* LANDING PAGE LOG - Public, append-only "signals" style feed         */
/* Used by #signals route + system crons (morning brief)               */
/* ------------------------------------------------------------------ */
const landingPageLog = defineTable({
  day: v.string(), // YYYY-MM-DD (UTC)
  kind: v.union(
    v.literal("signal"),
    v.literal("funding"),
    v.literal("brief"),
    v.literal("note"),
    v.literal("system"),
  ),
  title: v.string(),
  markdown: v.string(),
  source: v.optional(v.string()),
  url: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  userId: v.optional(v.id("users")),
  anonymousSessionId: v.optional(v.string()),
  agentThreadId: v.optional(v.string()),
  meta: v.optional(v.any()),
  createdAt: v.number(),
})
  .index("by_createdAt", ["createdAt"])
  .index("by_day_createdAt", ["day", "createdAt"])
  .index("by_anon_day_createdAt", ["anonymousSessionId", "day", "createdAt"])
  .index("by_agent_thread", ["agentThreadId", "createdAt"]);

/* ------------------------------------------------------------------ */
/* REPO STATS CACHE - GitHub repo stats + velocity snapshots           */
/* ------------------------------------------------------------------ */
const repoStatsCache = defineTable({
  repoFullName: v.string(), // owner/name
  repoUrl: v.string(),
  description: v.optional(v.string()),
  stars: v.number(),
  forks: v.number(),
  watchers: v.optional(v.number()),
  openIssues: v.optional(v.number()),
  createdAt: v.string(),
  pushedAt: v.string(),
  starHistory: v.array(
    v.object({
      date: v.string(), // YYYY-MM-DD
      stars: v.number(), // total or daily count
      delta: v.optional(v.number()), // optional daily delta
    }),
  ),
  commitHistory: v.array(
    v.object({
      weekStart: v.string(), // YYYY-MM-DD
      commits: v.number(),
    }),
  ),
  languages: v.optional(
    v.array(
      v.object({
        name: v.string(),
        pct: v.number(),
      }),
    ),
  ),
  fetchedAt: v.number(),
})
  .index("by_repo", ["repoFullName"])
  .index("by_repo_url", ["repoUrl"]);

/* ------------------------------------------------------------------ */
/* PAPER DETAILS CACHE - ArXiv metadata + methodology extraction       */
/* ------------------------------------------------------------------ */
const paperDetailsCache = defineTable({
  paperId: v.string(), // arXiv ID
  url: v.string(),
  title: v.optional(v.string()),
  abstract: v.optional(v.string()),
  methodology: v.optional(v.string()),
  keyFindings: v.array(v.string()),
  authors: v.optional(v.array(v.string())),
  citationCount: v.optional(v.number()),
  doi: v.optional(v.string()),
  pdfUrl: v.optional(v.string()),
  publishedAt: v.optional(v.string()),
  sourceUrls: v.optional(v.array(v.string())),
  fetchedAt: v.number(),
})
  .index("by_paper_id", ["paperId"])
  .index("by_url", ["url"]);

/* ------------------------------------------------------------------ */
/* STACK IMPACT CACHE - CVE impact mapping vs user tech stack          */
/* ------------------------------------------------------------------ */
const stackImpactCache = defineTable({
  signalKey: v.string(), // hash of signal + stack
  signalTitle: v.optional(v.string()),
  signalUrl: v.optional(v.string()),
  techStack: v.array(v.string()),
  summary: v.string(),
  riskLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  cveId: v.optional(v.string()),
  cveUrl: v.optional(v.string()),
  sourceUrls: v.optional(v.array(v.string())),
  graph: v.object({
    focusNodeId: v.optional(v.string()),
    nodes: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        type: v.optional(v.string()),
        importance: v.optional(v.number()),
        tier: v.optional(v.number()), // 1 = direct, 2 = second-order
      }),
    ),
    edges: v.array(
      v.object({
        source: v.string(),
        target: v.string(),
        relationship: v.optional(v.string()),
        context: v.optional(v.string()),
        impact: v.optional(v.string()),
        order: v.optional(
          v.union(v.literal("primary"), v.literal("secondary")),
        ),
      }),
    ),
  }),
  fetchedAt: v.number(),
})
  .index("by_signal_key", ["signalKey"])
  .index("by_signal_url", ["signalUrl"]);

/* ------------------------------------------------------------------ */
/* MODEL COMPARISON CACHE - Token cost + perf trade-offs               */
/* ------------------------------------------------------------------ */
const modelComparisonCache = defineTable({
  modelKey: v.string(),
  context: v.optional(v.string()),
  summary: v.optional(v.string()),
  recommendation: v.optional(v.string()),
  rows: v.array(
    v.object({
      model: v.string(),
      inputCostPer1M: v.number(),
      outputCostPer1M: v.number(),
      contextWindow: v.number(),
      reliabilityScore: v.optional(v.number()),
      performance: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  ),
  sourceUrls: v.optional(v.array(v.string())),
  fetchedAt: v.number(),
}).index("by_model_key", ["modelKey"]);

/* ------------------------------------------------------------------ */
/* DEAL FLOW CACHE - AI-curated startup deal flow snapshots           */
/* ------------------------------------------------------------------ */
const dealFlowCache = defineTable({
  dateString: v.string(),
  focusSectors: v.optional(v.array(v.string())),
  deals: v.array(
    v.object({
      id: v.string(),
      company: v.string(),
      sector: v.string(),
      stage: v.string(),
      amount: v.string(),
      date: v.string(),
      location: v.string(),
      foundingYear: v.optional(v.string()),
      foundersBackground: v.optional(v.string()),
      leads: v.array(v.string()),
      coInvestors: v.optional(v.array(v.string())),
      summary: v.string(),
      traction: v.optional(v.string()),
      sentiment: v.optional(v.union(v.literal("hot"), v.literal("watch"))),
      spark: v.optional(v.array(v.number())),
      people: v.array(
        v.object({
          name: v.string(),
          role: v.string(),
          past: v.string(),
        }),
      ),
      timeline: v.array(
        v.object({
          label: v.string(),
          detail: v.string(),
        }),
      ),
      regulatory: v.optional(
        v.object({
          fdaStatus: v.optional(v.string()),
          patents: v.optional(v.array(v.string())),
          papers: v.optional(v.array(v.string())),
        }),
      ),
      sources: v.optional(
        v.array(
          v.object({
            name: v.string(),
            url: v.string(),
          }),
        ),
      ),
    }),
  ),
  fetchedAt: v.number(),
})
  .index("by_date", ["dateString"])
  .index("by_fetched_at", ["fetchedAt"]);

/* ------------------------------------------------------------------ */
/* REPO SCOUT CACHE - open-source alternatives for signals            */
/* ------------------------------------------------------------------ */
const repoScoutCache = defineTable({
  signalKey: v.string(),
  signalTitle: v.string(),
  signalSummary: v.optional(v.string()),
  repos: v.array(
    v.object({
      name: v.string(),
      url: v.string(),
      description: v.optional(v.string()),
      stars: v.number(),
      starVelocity: v.number(),
      commitsPerWeek: v.number(),
      lastPush: v.optional(v.string()),
      languages: v.optional(
        v.array(
          v.object({
            name: v.string(),
            pct: v.number(),
          }),
        ),
      ),
    }),
  ),
  moatSummary: v.optional(v.string()),
  moatRisks: v.optional(v.array(v.string())),
  fetchedAt: v.number(),
}).index("by_signal_key", ["signalKey"]);

/* ------------------------------------------------------------------ */
/* STRATEGY METRICS CACHE - pivot KPI extractions                     */
/* ------------------------------------------------------------------ */
const strategyMetricsCache = defineTable({
  signalKey: v.string(),
  signalTitle: v.string(),
  signalSummary: v.optional(v.string()),
  metrics: v.array(
    v.object({
      label: v.string(),
      value: v.string(),
      unit: v.optional(v.string()),
      context: v.optional(v.string()),
      source: v.optional(v.string()),
    }),
  ),
  narrative: v.optional(v.string()),
  risks: v.optional(v.array(v.string())),
  sources: v.optional(
    v.array(
      v.object({
        title: v.string(),
        url: v.string(),
      }),
    ),
  ),
  fetchedAt: v.number(),
}).index("by_signal_key", ["signalKey"]);

/* ------------------------------------------------------------------ */
/* SEARCH EVALUATIONS - LLM-as-judge benchmark results                 */
/* ------------------------------------------------------------------ */
/**
 * Stores search quality evaluation results from LLM-as-judge.
 *
 * Retention Policy:
 * - Evaluations are retained for 90 days by default
 * - No PII is stored (queries may contain user intent but not personal data)
 * - judgeInput/judgeResult are JSON strings for flexibility
 *
 * Indexes:
 * - by_evaluation_id: Unique lookup
 * - by_pass: Filter by pass/fail status
 * - by_created: Time-based queries and cleanup
 * - by_query_hash: Deduplicate evaluations for same query (future)
 * - by_judge_model: Analyze performance by model
 */
const searchEvaluations = defineTable({
  evaluationId: v.string(), // Unique evaluation ID
  query: v.string(), // Search query evaluated
  mode: v.string(), // Search mode (fast/balanced/comprehensive)
  judgeModel: v.optional(v.string()), // Approved model alias used for evaluation
  judgePromptVersion: v.optional(v.string()), // Version of judge prompt for reproducibility
  rawResponse: v.optional(v.string()), // Raw LLM response for replay/debugging
  judgeInput: v.string(), // JSON-serialized JudgeInput
  judgeResult: v.string(), // JSON-serialized JudgeResult
  pass: v.boolean(), // Overall pass/fail
  overallScore: v.number(), // Weighted score (0-1)
  createdAt: v.number(), // Timestamp
})
  .index("by_evaluation_id", ["evaluationId"])
  .index("by_pass", ["pass"])
  .index("by_created", ["createdAt"])
  .index("by_judge_model", ["judgeModel"]);

/* ------------------------------------------------------------------ */
/* CROSS-PROVIDER SEARCH EVALUATION - Consistency across providers     */
/* ------------------------------------------------------------------ */
/**
 * Individual query evaluation results across multiple providers.
 * Measures consistency, overlap, and score normalization.
 */
const searchCrossProviderEvals = defineTable({
  evalId: v.string(), // Unique evaluation ID
  evalVersion: v.string(), // Evaluation harness version
  query: v.string(), // Search query
  category: v.string(), // Category (funding, tech_news, company, etc.)
  timestamp: v.number(), // When evaluated
  providerResults: v.string(), // JSON: per-provider results
  metrics: v.string(), // JSON: cross-provider metrics
})
  .index("by_eval_id", ["evalId"])
  .index("by_category", ["category"])
  .index("by_timestamp", ["timestamp"]);

/**
 * Baseline snapshots for A/B comparison of search refinements.
 * Aggregates metrics across multiple query evaluations.
 */
const searchBaselineSnapshots = defineTable({
  snapshotId: v.string(), // Unique snapshot ID
  snapshotVersion: v.string(), // Evaluation harness version
  createdAt: v.number(), // When created
  queryCount: v.number(), // Number of queries evaluated
  aggregateMetrics: v.string(), // JSON: aggregate metrics
  evaluationIds: v.array(v.string()), // Individual evaluation IDs
})
  .index("by_snapshot_id", ["snapshotId"])
  .index("by_created", ["createdAt"]);

/* ------------------------------------------------------------------ */
/* AGENT EVALUATION RUNS - Boolean-based agent response evaluation     */
/* ------------------------------------------------------------------ */
/**
 * Tracks evaluation runs against ground truth test queries.
 * Supports both anonymous (sessionId) and authenticated (userId) modes.
 *
 * Used for continuous testing of agent response quality.
 */
const evaluationRuns = defineTable({
  sessionId: v.string(), // Session ID (for anonymous) or derived from userId
  userId: v.optional(v.id("users")), // Optional user ID (for authenticated)
  mode: v.union(
    v.literal("anonymous"),
    v.literal("authenticated"),
    v.literal("batch"),
  ),
  status: v.union(
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
  ),
  // Query tracking
  queryIds: v.array(v.string()), // List of test query IDs to run
  completedQueries: v.number(),
  passedQueries: v.number(),
  failedQueries: v.number(),
  // Individual results
  results: v.array(
    v.object({
      queryId: v.string(),
      query: v.string(),
      persona: v.string(),
      expectedOutcome: v.string(),
      actualOutcome: v.string(),
      passed: v.boolean(),
      containsRequired: v.boolean(),
      noForbidden: v.boolean(),
      failureReasons: v.array(v.string()),
      responseLength: v.number(),
      responseSnippet: v.optional(v.string()),
      executedAt: v.number(),
    }),
  ),
  // Summary
  summary: v.optional(
    v.object({
      total: v.number(),
      passed: v.number(),
      failed: v.number(),
      passRate: v.number(),
      isPassing: v.boolean(),
      threshold: v.number(),
    }),
  ),
  // Timestamps
  startedAt: v.number(),
  updatedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  // Error tracking
  error: v.optional(v.string()),
}).index("by_session", ["sessionId"]);

/**
 * Persona Episode Evaluation Scenarios
 *
 * Stores the 100 test scenarios for persona episode evaluation.
 * Loaded from persona-episode-eval-pack-v2.json during migration.
 */
const evaluation_scenarios = defineTable({
  scenarioId: v.string(), // Unique scenario ID (e.g., "banker_vague_disco")
  name: v.string(), // Human-readable name
  query: v.string(), // The test query/prompt
  expectedPersona: v.string(), // Expected persona (e.g., "JPM_STARTUP_BANKER")
  expectedEntityId: v.string(), // Expected entity ground truth ID
  allowedPersonas: v.optional(v.array(v.string())), // Optional: multiple allowed personas
  domain: v.optional(v.string()), // Domain category (e.g., "finance", "tech", "medical")
  // Behavioral requirements
  requirements: v.optional(
    v.object({
      minToolCalls: v.optional(v.number()),
      maxToolCalls: v.optional(v.number()),
      maxCostUsd: v.optional(v.number()),
      maxClarifyingQuestions: v.optional(v.number()),
      requireVerificationStep: v.optional(v.boolean()),
      requireProviderUsage: v.optional(v.boolean()),
      requireTools: v.optional(v.array(v.string())),
    }),
  ),
  // Metadata
  createdAt: v.number(),
  version: v.optional(v.string()), // Pack version (e.g., "v2")
})
  .index("by_scenario_id", ["scenarioId"])
  .index("by_domain", ["domain"]);

/* ------------------------------------------------------------------ */
/* DIGEST CACHE - Agent-generated digest storage                       */
/* ------------------------------------------------------------------ */
const digestCache = defineTable({
  dateString: v.string(), // YYYY-MM-DD
  persona: v.string(), // GENERAL, JPM_STARTUP_BANKER, etc.
  model: v.string(), // claude-haiku-3.5, etc.
  // Raw agent output
  rawText: v.string(), // Full LLM response
  // Parsed digest
  digest: v.object({
    dateString: v.string(),
    narrativeThesis: v.string(),
    leadStory: v.optional(
      v.object({
        title: v.string(),
        url: v.optional(v.string()),
        whyItMatters: v.string(),
        reflection: v.optional(
          v.object({
            what: v.string(),
            soWhat: v.string(),
            nowWhat: v.string(),
          }),
        ),
      }),
    ),
    signals: v.array(
      v.object({
        title: v.string(),
        url: v.optional(v.string()),
        summary: v.string(),
        hardNumbers: v.optional(v.string()),
        directQuote: v.optional(v.string()),
        reflection: v.optional(
          v.object({
            what: v.string(),
            soWhat: v.string(),
            nowWhat: v.string(),
          }),
        ),
      }),
    ),
    actionItems: v.array(
      v.object({
        persona: v.string(),
        action: v.string(),
      }),
    ),
    entitySpotlight: v.optional(
      v.array(
        v.object({
          name: v.string(),
          type: v.string(),
          keyInsight: v.string(),
          fundingStage: v.optional(v.string()),
        }),
      ),
    ),
    factCheckFindings: v.optional(
      v.array(
        v.object({
          claim: v.string(),
          status: v.string(),
          explanation: v.string(),
          source: v.optional(v.string()),
          sourceUrl: v.optional(v.string()),
          confidence: v.number(),
        }),
      ),
    ),
    fundingRounds: v.optional(
      v.array(
        v.object({
          rank: v.number(),
          companyName: v.string(),
          roundType: v.string(),
          amountRaw: v.string(),
          amountUsd: v.optional(v.number()),
          leadInvestors: v.array(v.string()),
          sector: v.optional(v.string()),
          productDescription: v.optional(v.string()),
          founderBackground: v.optional(v.string()),
          sourceUrl: v.optional(v.string()),
          announcedAt: v.number(),
          confidence: v.number(),
        }),
      ),
    ),
    storyCount: v.number(),
    topSources: v.array(v.string()),
    topCategories: v.array(v.string()),
    processingTimeMs: v.number(),
  }),
  // Formatted outputs (for different channels)
  ntfyPayload: v.optional(
    v.object({
      title: v.string(),
      body: v.string(),
    }),
  ),
  slackPayload: v.optional(v.string()),
  emailPayload: v.optional(v.string()),
  // Usage tracking
  usage: v.object({
    inputTokens: v.number(),
    outputTokens: v.number(),
    model: v.optional(v.string()),
  }),
  feedItemCount: v.number(),
  // Metadata
  createdAt: v.number(),
  expiresAt: v.number(), // TTL for cache invalidation
  sentToNtfy: v.optional(v.boolean()),
  sentToSlack: v.optional(v.boolean()),
  sentToEmail: v.optional(v.boolean()),
})
  .index("by_date_persona", ["dateString", "persona"])
  .index("by_date", ["dateString"])
  .index("by_expires", ["expiresAt"]);

/* ------------------------------------------------------------------ */
/* ENTITY MONITOR PROFILES - Continuous monitoring per FATF guidance   */
/* Ref: https://www.fatf-gafi.org/recommendations                      */
/* ------------------------------------------------------------------ */
const entityMonitorProfiles = defineTable({
  // Entity identification
  entityType: v.string(), // "company", "person", "domain"
  entityName: v.string(), // Company name, person name, etc.
  entityId: v.optional(v.string()), // External ID if known (CrunchBase, SEC, etc.)

  // Monitoring configuration
  monitorFrequency: v.string(), // "daily", "weekly", "monthly"
  riskTier: v.string(), // "low", "medium", "high", "critical"
  triggerReason: v.string(), // Why monitoring was triggered

  // Entity snapshot at creation
  initialSnapshot: v.object({
    websiteUrl: v.optional(v.string()),
    websiteLive: v.optional(v.union(v.boolean(), v.null())),
    sourceCredibility: v.optional(v.string()),
    riskScore: v.optional(v.number()),
    verificationStatus: v.optional(v.string()),
  }),

  // Latest check results
  lastCheckAt: v.optional(v.number()),
  lastCheckResult: v.optional(
    v.object({
      websiteLive: v.optional(v.union(v.boolean(), v.null())),
      riskScore: v.optional(v.number()),
      verificationStatus: v.optional(v.string()),
      changesDetected: v.array(v.string()), // List of detected changes
    }),
  ),
  nextCheckAt: v.number(), // Scheduled next check time

  // Change history
  changeCount: v.number(), // Number of changes detected
  alertsSent: v.number(), // Number of alerts triggered

  // Status
  status: v.string(), // "active", "paused", "archived"
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.optional(v.id("users")),
})
  .index("by_entity", ["entityType", "entityName"])
  .index("by_risk_tier", ["riskTier", "status"])
  .index("by_next_check", ["nextCheckAt", "status"])
  .index("by_status", ["status"]);

/* ------------------------------------------------------------------ */
/* VERIFICATION AUDIT LOG - Outcome tracking for calibration           */
/* Enables FP/FN measurement, SLO tracking, methodology transparency   */
/* ------------------------------------------------------------------ */
const verificationAuditLog = defineTable({
  // Entity identification
  entityType: v.string(), // "company", "funding_claim", "person"
  entityName: v.string(),
  entityId: v.optional(v.string()), // External ID if known

  // Verification request context
  requestId: v.string(), // Unique request ID for correlation
  requestSource: v.string(), // "linkedin_post", "dd_pipeline", "manual"
  triggeredBy: v.optional(v.id("users")),

  // Input claim (for methodology transparency)
  claimText: v.optional(v.string()), // Original claim being verified
  sourceUrl: v.optional(v.string()), // Source of the claim
  websiteUrl: v.optional(v.string()), // Company website checked

  // Verification results (tri-state)
  entityFound: v.union(v.boolean(), v.null()),
  websiteLive: v.union(v.boolean(), v.null()),
  sourceCredibility: v.string(), // "high", "medium", "low", "unknown"
  overallStatus: v.string(), // "verified", "partial", "unverified", "suspicious"
  confidenceScore: v.number(), // 0-1

  // Probe-level details (for observability)
  probeResults: v.object({
    entity: v.object({
      result: v.union(v.boolean(), v.null()),
      latencyMs: v.number(),
      source: v.optional(v.string()), // "fusion_search", "registry", etc.
      summary: v.optional(v.string()),
    }),
    website: v.object({
      result: v.union(v.boolean(), v.null()),
      latencyMs: v.number(),
      errorClass: v.optional(v.string()), // Error taxonomy class
      httpStatus: v.optional(v.number()),
      attemptCount: v.number(),
    }),
    credibility: v.object({
      tier: v.string(),
      domain: v.string(),
      matchType: v.optional(v.string()), // "exact", "subdomain", "pattern"
    }),
  }),

  // External fact-check results (if queried)
  factCheckResults: v.optional(
    v.object({
      provider: v.string(), // "google", "claimbuster", "none"
      hasResults: v.boolean(), // Did we find any fact-checks?
      factCheckCount: v.number(),
      consensus: v.optional(v.string()), // "true", "false", "mixed", "unproven", "insufficient"
      agreementLevel: v.optional(v.number()),
    }),
  ),

  // Labeled outcome (for calibration - set later by human review)
  labeledOutcome: v.optional(
    v.object({
      verdict: v.string(), // "legit", "scam", "unclear", "insufficient_info"
      labeledBy: v.optional(v.id("users")),
      labeledAt: v.number(),
      notes: v.optional(v.string()),
      evidenceUrls: v.optional(v.array(v.string())),
    }),
  ),

  // Calibration metrics (computed when labeled)
  calibration: v.optional(
    v.object({
      wasCorrect: v.boolean(), // Did verification match labeled outcome?
      errorType: v.optional(v.string()), // "false_positive", "false_negative", "correct"
      confidenceDelta: v.optional(v.number()), // How far off was confidence?
    }),
  ),

  // SLO tracking fields
  sloMetrics: v.object({
    totalLatencyMs: v.number(), // End-to-end verification time
    hadPrimarySource: v.boolean(), // Did we find SEC/registry/official source?
    hadTimeout: v.boolean(), // Any probe timed out?
    circuitBreakerTripped: v.boolean(), // Was any circuit breaker open?
    inconclusiveCount: v.number(), // How many probes were inconclusive?
  }),

  // Timestamps
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_entity", ["entityType", "entityName"])
  .index("by_request", ["requestId"])
  .index("by_source", ["requestSource", "createdAt"])
  .index("by_status", ["overallStatus", "createdAt"])
  .index("by_labeled", ["labeledOutcome.verdict", "createdAt"])
  .index("by_calibration", ["calibration.errorType", "createdAt"])
  .index("by_created", ["createdAt"]);

/* ------------------------------------------------------------------ */
/* VERIFICATION ACTIONS - Simple action logging for verification       */
/* Used by narrative/feed/agent verification integrations              */
/* ------------------------------------------------------------------ */
const verificationActions = defineTable({
  auditId: v.string(),
  action: v.string(), // "claim_verified", "claim_rejected", "source_checked", etc.
  targetType: v.string(), // "claim", "post", "fact", "source"
  targetId: v.string(),
  claim: v.optional(v.string()),
  sourceUrls: v.array(v.string()),
  verdict: v.string(),
  confidence: v.number(),
  reasoning: v.string(),
  sourceTiers: v.optional(v.array(v.string())),
  performedBy: v.string(),
  performedAt: v.number(),
  metadata: v.optional(v.any()),
})
  .index("by_target", ["targetType", "targetId"])
  .index("by_action", ["action", "performedAt"])
  .index("by_performer", ["performedBy", "performedAt"])
  .index("by_verdict", ["verdict", "performedAt"]);

/* ------------------------------------------------------------------ */
/* SCHEDULED REPORTS - Automated PDF report generation                 */
/* ------------------------------------------------------------------ */
const scheduledReports = defineTable({
  storageId: v.string(), // Convex storage ID for the PDF file
  fileName: v.string(), // Human-readable filename
  fileSize: v.number(), // File size in bytes
  reportType: v.string(), // "weekly-digest", "monthly-summary", "quarterly-funding-summary"
  title: v.string(), // Report title
  description: v.string(), // Report description
  quarterLabel: v.string(), // Period label (e.g., "Q4 2025", "Week of Jan 14")
  totalDeals: v.number(), // Number of deals in report
  totalAmountUsd: v.number(), // Total funding amount
  generatedAt: v.number(), // Timestamp when generated
  status: v.string(), // "pending", "generating", "completed", "failed"
  distributedTo: v.optional(v.array(v.string())), // Channels distributed to
  error: v.optional(v.string()), // Error message if failed
})
  .index("by_report_type", ["reportType"])
  .index("by_generated_at", ["generatedAt"])
  .index("by_status", ["status"]);

/* ------------------------------------------------------------------ */
/* CHAT MEMORIES - Persistent cross-thread memory for FastAgentPanel  */
/* ------------------------------------------------------------------ */
const chatMemories = defineTable({
  userId: v.id("users"),
  text: v.string(),
  source: v.optional(
    v.union(v.literal("user"), v.literal("context_menu"), v.literal("auto")),
  ),
  threadId: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_created", ["userId", "createdAt"]);

/* ------------------------------------------------------------------ */
/* CHAT SNAPSHOTS - Conversation state snapshots for FastAgentPanel   */
/* ------------------------------------------------------------------ */
const chatSnapshots = defineTable({
  userId: v.id("users"),
  threadId: v.optional(v.string()),
  name: v.string(),
  messageCount: v.number(),
  messages: v.array(
    v.object({
      role: v.string(),
      text: v.string(),
    }),
  ),
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_created", ["userId", "createdAt"]);

/* ------------------------------------------------------------------ */
/* CHAT ANNOTATIONS - Per-message notes/highlights                     */
/* ------------------------------------------------------------------ */
const chatAnnotations = defineTable({
  userId: v.id("users"),
  messageId: v.string(),
  threadId: v.optional(v.string()),
  note: v.string(),
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_message", ["messageId"])
  .index("by_user_thread", ["userId", "threadId"]);

/* ------------------------------------------------------------------ */
/* SCHEDULED MESSAGES - Messages scheduled to send later               */
/* ------------------------------------------------------------------ */
const chatScheduledMessages = defineTable({
  userId: v.id("users"),
  threadId: v.string(),
  text: v.string(),
  scheduledAt: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("sent"),
    v.literal("cancelled"),
  ),
  sentAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_status_scheduled", ["status", "scheduledAt"])
  .index("by_user_thread", ["userId", "threadId"]);

/* ------------------------------------------------------------------ */
/* TOOL APPROVALS - Pending tool call approvals for human-in-the-loop */
/* ------------------------------------------------------------------ */
const toolApprovals = defineTable({
  userId: v.id("users"),
  threadId: v.string(),
  toolName: v.string(),
  toolArgs: v.any(),
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("rejected"),
  ),
  riskLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  reason: v.optional(v.string()),
  decidedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_pending", ["userId", "status"])
  .index("by_thread", ["threadId", "status"]);

/* ------------------------------------------------------------------ */
/* DOGFOOD QA - Visual review runs (Gemini video understanding)        */
/* ------------------------------------------------------------------ */

const dogfoodQaRuns = defineTable({
  userId: v.id("users"),
  createdAt: v.number(),
  provider: v.literal("gemini"),
  model: v.string(),
  source: v.union(
    v.literal("video"),
    v.literal("frames"),
    v.literal("screenshots"),
  ),
  videoUrl: v.optional(v.string()),
  inputSha256: v.optional(v.string()),
  prompt: v.string(),
  summary: v.string(),
  issues: v.array(
    v.object({
      severity: v.union(
        v.literal("p0"),
        v.literal("p1"),
        v.literal("p2"),
        v.literal("p3"),
      ),
      title: v.string(),
      details: v.string(),
      suggestedFix: v.optional(v.string()),
      route: v.optional(v.string()),
      startSec: v.optional(v.number()),
      endSec: v.optional(v.number()),
      evidence: v.optional(v.array(v.string())),
    }),
  ),
  rawText: v.optional(v.string()),
})
  .index("by_user_createdAt", ["userId", "createdAt"])
  .index("by_createdAt", ["createdAt"])
  .index("by_user_inputSha256", ["userId", "inputSha256"]);

export default defineSchema({
  ...authTables, // `users`, `sessions`
  documents,
  nodes,
  relations,
  relationTypes,
  tags,
  tagRefs,
  smsLogs,
  smsUsageDaily,
  embeddings,
  gridProjects,
  files,
  urlAnalyses,
  chunks,
  folders,
  documentFolders,
  userPreferences,
  quickCaptures,
  userBehaviorEvents,
  recommendations,
  userTeachings,
  events,
  userEvents,
  holidays,
  financialEvents,
  mcpServers,
  mcpTools,
  mcpToolSchemas,
  mcpSessions,
  mcpPlans,
  mcpMemoryEntries,
  agentRuns,
  actionReceipts,
  sourceArtifacts,
  artifactChunks,
  artifactIndexJobs,
  resourceLinks,
  evidencePacks,
  toolHealth,
  promptEnhancementFeedback,
  projectContext,
  agentRunEvents,
  financialOperatorRuns,
  financialOperatorSteps,
  instagramPosts,
  agentDelegations,
  agentWriteEvents,
  fileSearchStores,
  // chatThreads and chatMessages removed - using @convex-dev/agent component
  chatThreadsStream,
  chatMessagesStream,
  searchCache,
  canonicalSources,
  extractedSignals,
  crossScopeViolations,
  userWikiPages,
  userWikiRevisions,
  userWikiMaintainerJobs,
  // Dreaming Phase 2 tables
  userWikiStaging,
  userWikiThemes,
  userWikiOpenQuestions,
  userWikiNotes,
  userWikiEdges,
  mcpToolLearning,
  mcpGuidanceExamples,
  mcpToolHistory,
  mcpPolicyConfigs,
  mcpToolUsageDaily,
  mcpToolCallLedger,
  documentSnapshots,
  spreadsheets,
  sheetCells,
  googleAccounts,
  slackAccounts,
  githubAccounts,
  notionAccounts,
  linkedinAccounts,
  linkedinFundingPosts,
  linkedinFdaPosts,
  linkedinClinicalPosts,
  linkedinResearchPosts,
  linkedinMaPosts,
  linkedinPostArchive,
  linkedinArchiveEntityLinks,
  pipelineRuns,
  pipelineSteps,
  pipelineRunStreams,
  scheduledPipelineRuns,
  linkedinHeldPosts,
  linkedinContentQueue,
  userApiKeys,
  dailyUsage,
  subscriptions,
  agentTimelines,
  agentTasks,
  agentLinks,
  agentTimelineRuns,
  agentImageResults,
  voiceSessions,
  voiceCostLedger,
  realtimeAuditEvents,
  realtimeVoiceCaptures,
  realtimeVoiceAuditEvents,
  voiceRoutingDecisions,
  landingPageLog,
  feedItems,
  repoStatsCache,
  paperDetailsCache,
  stackImpactCache,
  modelComparisonCache,
  dealFlowCache,
  repoScoutCache,
  strategyMetricsCache,
  searchEvaluations,
  searchCrossProviderEvals,
  searchBaselineSnapshots,
  evaluationRuns,
  evaluation_scenarios,
  digestCache,

  // FastAgentPanel persistent backend tables
  chatMemories,
  chatSnapshots,
  chatAnnotations,
  chatScheduledMessages,
  toolApprovals,
  dogfoodQaRuns,
  timeSeriesObservations,
  timeSeriesSignals,
  causalChains,
  zeroDraftArtifacts,
  proofPacks,
  specDocs,
  relationshipObservations,
  relationshipEdges,
  worldEvents,
  watchlists,
  dimensionProfiles,
  dimensionSnapshots,
  dimensionEvidence,
  dimensionInteractions,

  /* ------------------------------------------------------------------ */
  /* ORACLE â€” Career progression gamification                           */
  /* ------------------------------------------------------------------ */
  oraclePlayerProfiles,
  oracleQuestLog,
  oracleExpTransactions,
  oracleClassAdvancementLog,
  oracleTemporalOpportunities,
  productPublicCards,
  productMigrationState,
  productInputBundles,
  productEvidenceItems,
  productChatSessions,
  productChatEvents,
  productToolEvents,
  productRunEvents,
  productResolutionCandidates,
  productSourceEvents,
  productReportDrafts,
  productClaims,
  productClaimSupports,
  productClaimReviews,
  productEntities,
  productEntityNotes,
  productWorkspaceShares,
  productEntityWorkspaceMembers,
  productEntityWorkspaceInvites,
  productEntityRelations,
  productDocuments,
  productDocumentBlocks,
  productDocumentEntityLinks,
  productDocumentSourceLinks,
  productDocumentEvents,
  productDocumentSnapshots,
  productReports,
  productReportRefreshes,
  productEventWorkspaces,
  productEventWorkspaceEntities,
  productEventWorkspaceEvidence,
  productEventWorkspaceClaims,
  productEventWorkspaceFollowUps,
  productEventBudgetDecisions,
  productEventCaptures,
  productEventRunRecords,
  productActivityLedger,
  productReportExports,
  productReportExportRows,
  productNudges,
  productProfileSummaries,
  productContextItems,
  productBlocks,
  productBlockRelations,
  productBlockWriteWindows,
  productNudgeSubscriptions,

  /* ------------------------------------------------------------------ */
  /* CANONICAL V2 NOTEBOOK RUNTIME — agent scratchpad + projection layer */
  /* ------------------------------------------------------------------ */
  productNotebookPages,

  /* User sessions — Avatar status panel "Recent sessions" list */
  productUserSessions,

  /* ------------------------------------------------------------------ */
  /* ENTITY PROFILES - Cached Wikidata entity resolutions               */
  /* Canonical entity identification for deduplication and linking      */
  /* ------------------------------------------------------------------ */

  /**
   * Cached entity profiles from Wikidata
   * Used for canonical identification of people and companies
   */
  entityProfiles: defineTable({
    // Wikidata identification
    wikidataId: v.string(), // Q-format ID (e.g., "Q312" for Apple)
    entityType: v.union(
      v.literal("person"),
      v.literal("company"),
      v.literal("organization"),
      v.literal("location"),
      v.literal("other"),
    ),

    // Canonical names
    canonicalName: v.string(), // Official name from Wikidata
    description: v.optional(v.string()), // Wikidata description
    aliases: v.optional(v.array(v.string())), // Alternative names

    // Additional metadata for people
    personInfo: v.optional(
      v.object({
        linkedInUrl: v.optional(v.string()),
        twitterHandle: v.optional(v.string()),
        crunchbaseUrl: v.optional(v.string()),
        currentCompany: v.optional(v.string()),
        currentRole: v.optional(v.string()),
      }),
    ),

    // Additional metadata for companies
    companyInfo: v.optional(
      v.object({
        sector: v.optional(v.string()),
        industry: v.optional(v.string()),
        foundedYear: v.optional(v.number()),
        headquarters: v.optional(v.string()),
        stockTicker: v.optional(v.string()),
        linkedInUrl: v.optional(v.string()),
        crunchbaseUrl: v.optional(v.string()),
      }),
    ),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    lastVerifiedAt: v.optional(v.number()), // When Wikidata was last checked

    // Linking stats
    mentionCount: v.optional(v.number()), // How many times this entity was linked
    lastMentionedAt: v.optional(v.number()), // When last linked
  })
    .index("by_wikidataId", ["wikidataId"])
    .index("by_type", ["entityType", "canonicalName"])
    .index("by_name", ["canonicalName"])
    .searchIndex("search_name", {
      searchField: "canonicalName",
      filterFields: ["entityType"],
    }),

  /**
   * Entity mentions - tracks where entities appear across content
   * Links entities to posts, feed items, and other content
   */
  entityMentions: defineTable({
    entityId: v.id("entityProfiles"), // Reference to cached entity
    wikidataId: v.string(), // Denormalized for quick queries

    // Source reference
    sourceType: v.union(
      v.literal("linkedinFundingPost"),
      v.literal("feedItem"),
      v.literal("narrativeEvent"),
      v.literal("narrativePost"),
      v.literal("document"),
    ),
    sourceId: v.string(), // ID of the source document

    // Mention details
    mentionType: v.union(
      v.literal("primary"), // Main subject
      v.literal("secondary"), // Supporting mention
      v.literal("investor"), // Investor in funding context
      v.literal("partner"), // Partnership mention
      v.literal("competitor"), // Competitive mention
    ),
    extractedName: v.string(), // Original name as extracted
    context: v.optional(v.string()), // Surrounding text context
    confidence: v.number(), // Linking confidence 0-1

    // Timestamps
    createdAt: v.number(),
  })
    .index("by_entity", ["entityId", "createdAt"])
    .index("by_wikidataId", ["wikidataId", "createdAt"])
    .index("by_source", ["sourceType", "sourceId"])
    .index("by_mentionType", ["mentionType", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* AGENT SWARMS - Parallel SubAgent Orchestration                     */
  /* Implements Fan-Out/Gather pattern for parallel agent execution     */
  /* ------------------------------------------------------------------ */

  /**
   * Swarm definitions - groups of parallel agents working together.
   * Each swarm is linked to a thread for UI display.
   */
  agentSwarms: defineTable({
    swarmId: v.string(), // UUID for this swarm
    userId: v.id("users"), // Owner
    threadId: v.string(), // Associated chatThreadsStream._id

    // Swarm definition
    name: v.optional(v.string()), // User-defined name (e.g., "Research Team")
    query: v.string(), // Original user query
    pattern: v.union(
      v.literal("fan_out_gather"), // Parallel then merge (default)
      v.literal("pipeline"), // Sequential handoff
      v.literal("swarm"), // Autonomous collaboration
    ),

    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("spawning"),
      v.literal("executing"),
      v.literal("gathering"),
      v.literal("synthesizing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),

    // Agent configurations
    agentConfigs: v.array(
      v.object({
        agentName: v.string(), // DocumentAgent, MediaAgent, etc.
        role: v.string(), // Role description
        query: v.string(), // Task for this agent
        stateKeyPrefix: v.string(), // Unique namespace: "agent_name:key"
      }),
    ),

    // Results
    mergedResult: v.optional(v.string()),
    confidence: v.optional(v.number()), // 0-1 confidence score

    // Timing
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
  })
    .index("by_swarm", ["swarmId"])
    .index("by_thread", ["threadId"])
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"]),

  /**
   * Individual agent tasks within a swarm.
   * Each task represents one agent's work.
   */
  swarmAgentTasks: defineTable({
    swarmId: v.string(),
    taskId: v.string(), // UUID
    delegationId: v.optional(v.string()), // Links to agentDelegations

    // Agent assignment
    agentName: v.string(),
    query: v.string(),
    role: v.string(),

    // State isolation
    stateKeyPrefix: v.string(), // e.g., "DocumentAgent:research"

    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),

    // Results
    result: v.optional(v.string()),
    resultSummary: v.optional(v.string()),

    // Timing
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_swarm", ["swarmId"])
    .index("by_task", ["taskId"])
    .index("by_swarm_status", ["swarmId", "status"]),

  /**
   * Cross-agent context sharing with unique key isolation.
   * Prevents race conditions via namespaced keys.
   */
  swarmContextSharing: defineTable({
    swarmId: v.string(),

    // Namespaced key: "{agentName}:{type}:{specificKey}"
    key: v.string(),

    // Context data
    value: v.any(),
    valueType: v.union(
      v.literal("discovery"), // New fact discovered
      v.literal("artifact"), // File/URL reference
      v.literal("question"), // Follow-up question
      v.literal("synthesis"), // Partial synthesis
    ),

    // Provenance
    sourceAgentName: v.string(),
    sourceTaskId: v.string(),

    createdAt: v.number(),
  })
    .index("by_swarm", ["swarmId"])
    .index("by_key", ["key"])
    .index("by_swarm_type", ["swarmId", "valueType"]),

  /* ------------------------------------------------------------------ */
  /* PARALLEL TASK TREE - Deep Agent 2.0 Decision Tree Execution        */
  /* Implements A -> B1, B2, B3 -> verify -> cross-check -> merge       */
  /* ------------------------------------------------------------------ */

  /**
   * Root task tree for a given agent thread/run.
   * One tree per user query, tracks overall status and final merged result.
   */
  parallelTaskTrees: defineTable({
    userId: v.id("users"),
    agentThreadId: v.string(), // Links to agent conversation
    rootTaskId: v.optional(v.string()), // ID of root task node
    query: v.string(), // Original user query
    status: v.union(
      v.literal("decomposing"), // Breaking into subtasks
      v.literal("executing"), // Running parallel branches
      v.literal("verifying"), // Verification phase
      v.literal("cross_checking"), // Cross-checking results
      v.literal("merging"), // Merging surviving paths
      v.literal("completed"), // Done
      v.literal("failed"), // Terminal failure
    ),
    phase: v.optional(v.string()), // Current phase description
    phaseProgress: v.optional(v.number()), // 0-100 progress within phase

    // Execution stats
    totalBranches: v.optional(v.number()),
    activeBranches: v.optional(v.number()),
    completedBranches: v.optional(v.number()),
    prunedBranches: v.optional(v.number()),

    // Final result
    mergedResult: v.optional(v.string()),
    confidence: v.optional(v.number()), // 0-1 final confidence

    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),

    // Performance metrics
    elapsedMs: v.optional(v.number()),
    tokenUsage: v.optional(
      v.object({
        input: v.number(),
        output: v.number(),
      }),
    ),
  })
    .index("by_user", ["userId"])
    .index("by_agent_thread", ["agentThreadId"])
    .index("by_status", ["status"])
    .index("by_user_createdAt", ["userId", "createdAt"]),

  /**
   * Individual task nodes in the parallel execution tree.
   * Forms a DAG with parent-child relationships.
   */
  parallelTaskNodes: defineTable({
    treeId: v.id("parallelTaskTrees"),
    taskId: v.string(), // Stable unique ID (uuid)
    parentTaskId: v.optional(v.string()), // Null for root

    // Task info
    title: v.string(),
    description: v.optional(v.string()),
    taskType: v.union(
      v.literal("root"), // Root decomposition task
      v.literal("branch"), // Parallel exploration branch
      v.literal("verification"), // Verifier task
      v.literal("critique"), // Critique/cross-check task
      v.literal("merge"), // Merge surviving paths
      v.literal("refinement"), // Post-merge refinement
    ),

    // Execution state
    status: v.union(
      v.literal("pending"), // Waiting to execute
      v.literal("running"), // Currently executing
      v.literal("awaiting_children"), // Waiting for child tasks
      v.literal("verifying"), // In verification
      v.literal("completed"), // Done successfully
      v.literal("pruned"), // Pruned (didn't survive verification)
      v.literal("failed"), // Execution error
      v.literal("backtracked"), // Rolled back due to downstream failure
    ),

    // Parallel execution metadata
    branchIndex: v.optional(v.number()), // Position in parallel set (0, 1, 2...)
    siblingCount: v.optional(v.number()), // Total siblings in parallel set
    depth: v.number(), // Tree depth (0 = root)

    // Agent assignment
    agentName: v.optional(v.string()), // Which agent handles this
    subagentThreadId: v.optional(v.string()), // Thread for subagent

    // Result
    result: v.optional(v.string()), // Task output
    resultSummary: v.optional(v.string()), // Brief summary for UI
    confidence: v.optional(v.number()), // 0-1 confidence

    // Verification
    verificationScore: v.optional(v.number()), // 0-1 from verifier
    verificationNotes: v.optional(v.string()), // Verifier feedback
    critiques: v.optional(
      v.array(
        v.object({
          source: v.string(), // Which sibling critiqued
          verdict: v.union(
            v.literal("agree"),
            v.literal("disagree"),
            v.literal("partial"),
          ),
          reason: v.string(),
        }),
      ),
    ),
    survivedVerification: v.optional(v.boolean()), // Did it pass?

    // Timing
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),

    // Token usage
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),

    // Error handling
    errorMessage: v.optional(v.string()),
    retryCount: v.optional(v.number()),
    canBacktrack: v.optional(v.boolean()), // Can we backtrack from here?

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tree", ["treeId"])
    .index("by_tree_status", ["treeId", "status"])
    .index("by_tree_parent", ["treeId", "parentTaskId"])
    .index("by_tree_depth", ["treeId", "depth"])
    .index("by_taskId", ["taskId"]),

  /**
   * Real-time streaming events for task nodes.
   * Enables live UI updates during execution.
   */
  parallelTaskEvents: defineTable({
    treeId: v.id("parallelTaskTrees"),
    taskId: v.string(),
    seq: v.number(), // Monotonic within task

    eventType: v.union(
      v.literal("started"), // Task began
      v.literal("progress"), // Progress update
      v.literal("thinking"), // Reasoning step
      v.literal("tool_call"), // Tool invocation
      v.literal("result_partial"), // Partial result
      v.literal("result_final"), // Final result
      v.literal("verification_started"), // Verification began
      v.literal("verification_result"), // Verification outcome
      v.literal("critique_received"), // Critique from sibling
      v.literal("pruned"), // Task was pruned
      v.literal("completed"), // Task completed
      v.literal("failed"), // Task failed
      v.literal("backtracked"), // Task rolled back
    ),

    message: v.optional(v.string()),
    data: v.optional(v.any()), // Event-specific payload

    createdAt: v.number(),
  })
    .index("by_tree", ["treeId", "createdAt"])
    .index("by_task", ["taskId", "seq"])
    .index("by_tree_task", ["treeId", "taskId", "seq"]),

  /**
   * Cross-check matrix tracking which branches have critiqued each other.
   * Used to ensure thorough cross-validation.
   */
  parallelTaskCrossChecks: defineTable({
    treeId: v.id("parallelTaskTrees"),
    sourceTaskId: v.string(), // Task doing the critique
    targetTaskId: v.string(), // Task being critiqued

    verdict: v.union(
      v.literal("agree"), // Full agreement
      v.literal("disagree"), // Contradiction found
      v.literal("partial"), // Partial agreement
      v.literal("abstain"), // Cannot evaluate
    ),

    agreementPoints: v.optional(v.array(v.string())),
    disagreementPoints: v.optional(v.array(v.string())),
    confidence: v.number(), // 0-1 confidence in verdict
    reasoning: v.optional(v.string()),

    createdAt: v.number(),
  })
    .index("by_tree", ["treeId"])
    .index("by_source", ["sourceTaskId"])
    .index("by_target", ["targetTaskId"])
    .index("by_tree_source_target", ["treeId", "sourceTaskId", "targetTaskId"]),

  /* ------------------------------------------------------------------ */
  /* TRACE AUDIT LOG - Deterministic, code-generated execution trace    */
  /* Part of the TRACE (Tool-Routed Architecture for Controlled         */
  /* Execution) framework. Every entry is generated by CODE, not LLM.   */
  /* ------------------------------------------------------------------ */

  traceAuditEntries: defineTable({
    executionId: v.string(),
    executionType: v.union(
      v.literal("swarm"),
      v.literal("tree"),
      v.literal("chat"),
      v.literal("forecast_refresh"),
      v.literal("linkedin_post"),
      v.literal("pipeline_run"),
    ),
    workflowTag: v.optional(v.string()),
    seq: v.number(),
    timestamp: v.number(),
    choiceType: v.union(
      v.literal("gather_info"),
      v.literal("execute_data_op"),
      v.literal("execute_output"),
      v.literal("finalize"),
    ),
    toolName: v.string(),
    toolParams: v.optional(v.any()),
    metadata: v.object({
      rowCount: v.optional(v.number()),
      columnCount: v.optional(v.number()),
      uniqueValues: v.optional(v.any()),
      charCount: v.optional(v.number()),
      wordCount: v.optional(v.number()),
      keyTopics: v.optional(v.array(v.string())),
      errorMessage: v.optional(v.string()),
      durationMs: v.number(),
      success: v.boolean(),
      intendedState: v.optional(v.string()),
      actualState: v.optional(v.string()),
      correctionApplied: v.optional(v.boolean()),
      // Completion traceability â€” links finalize entries back to user's original ask
      originalRequest: v.optional(v.string()),
      deliverySummary: v.optional(v.string()),
    }),
    description: v.string(),
    createdAt: v.number(),
  })
    .index("by_execution", ["executionId", "seq"])
    .index("by_execution_type", ["executionType", "executionId"])
    .index("by_workflow_tag", ["workflowTag", "seq"]),

  /* ------------------------------------------------------------------ */
  /* DOSSIER DOMAIN - Bidirectional focus sync for agentâ†”chart views    */
  /* ------------------------------------------------------------------ */
  dossierFocusState,
  dossierAnnotations,
  dossierEnrichment,

  /* ------------------------------------------------------------------ */
  /* EMAIL MANAGEMENT - Full email thread/message management system     */
  /* ------------------------------------------------------------------ */
  emailLabels,
  emailThreads,
  emailMessages,
  emailDailyReports,
  emailProcessingQueue,
  emailSyncState,

  /* ------------------------------------------------------------------ */
  /* EMAIL EVENTS - Audit log for all email sends via agent tools       */
  /* ------------------------------------------------------------------ */
  emailEvents: defineTable({
    userId: v.id("users"),
    threadId: v.optional(v.string()), // Agent thread that triggered send
    runId: v.optional(v.string()), // Agent run ID for provenance
    messageId: v.optional(v.string()), // Resend message ID (on success)
    to: v.string(), // Recipient email
    cc: v.optional(v.array(v.string())), // CC recipients
    bcc: v.optional(v.array(v.string())), // BCC recipients
    subject: v.string(),
    bodyPreview: v.optional(v.string()), // First 200 chars of body
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("bounced"),
    ),
    providerResponse: v.optional(v.any()), // Raw response from Resend
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_thread", ["threadId"])
    .index("by_status", ["status"])
    .index("by_user_createdAt", ["userId", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* SPREADSHEET EVENTS - Patch/diff log for spreadsheet edits          */
  /* ------------------------------------------------------------------ */
  spreadsheetEvents: defineTable({
    userId: v.id("users"),
    spreadsheetId: v.id("spreadsheets"),
    threadId: v.optional(v.string()), // Agent thread that triggered edit
    runId: v.optional(v.string()), // Agent run ID for provenance
    operation: v.union(
      v.literal("set_cell"),
      v.literal("insert_row"),
      v.literal("delete_row"),
      v.literal("add_column"),
      v.literal("delete_column"),
      v.literal("apply_formula"),
      v.literal("add_sheet"),
      v.literal("rename_sheet"),
    ),
    targetRange: v.optional(v.string()), // A1 notation (e.g., "A1:B5")
    payload: v.any(), // Operation-specific data (before/after)
    previousArtifactId: v.optional(v.string()), // Link to previous versioned artifact
    newArtifactId: v.optional(v.string()), // Link to new versioned artifact
    validationErrors: v.optional(v.array(v.string())), // Formula/type validation errors
    status: v.union(
      v.literal("applied"),
      v.literal("reverted"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
  })
    .index("by_spreadsheet", ["spreadsheetId"])
    .index("by_user", ["userId"])
    .index("by_thread", ["threadId"])
    .index("by_spreadsheet_createdAt", ["spreadsheetId", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* CALENDAR ARTIFACTS - ICS VEVENT artifacts for calendar operations  */
  /* ------------------------------------------------------------------ */
  calendarArtifacts: defineTable({
    userId: v.id("users"),
    threadId: v.optional(v.string()), // Agent thread that created artifact
    runId: v.optional(v.string()),
    eventUid: v.string(), // VEVENT UID (stable across updates)
    operation: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("cancel"),
    ),
    icsContent: v.string(), // Full ICS VEVENT string
    summary: v.string(), // Event title
    dtStart: v.number(), // Start timestamp (ms)
    dtEnd: v.optional(v.number()), // End timestamp (ms)
    location: v.optional(v.string()),
    description: v.optional(v.string()),
    attendees: v.optional(v.array(v.string())), // Attendee emails
    sequence: v.number(), // SEQUENCE number for updates
    version: v.number(), // Internal version counter
    linkedEventId: v.optional(v.id("events")), // Link to actual calendar event if synced
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_eventUid", ["eventUid"])
    .index("by_user_dtStart", ["userId", "dtStart"])
    .index("by_thread", ["threadId"]),

  /* ------------------------------------------------------------------ */
  /* DOCUMENT PATCHES - Edit history for patch-based document editing   */
  /* ------------------------------------------------------------------ */
  documentPatches: defineTable({
    documentId: v.string(),
    operations: v.any(), // Array of patch operations
    description: v.optional(v.string()),
    originalContentPreview: v.optional(v.string()),
    newContentPreview: v.optional(v.string()),
    appliedCount: v.number(),
    failedCount: v.number(),
    threadId: v.optional(v.string()),
    runId: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_document_createdAt", ["documentId", "createdAt"])
    .index("by_thread", ["threadId"]),

  /* ------------------------------------------------------------------ */
  /* CONTEXT PACKS - Cached multi-document context bundles              */
  /* ------------------------------------------------------------------ */
  contextPacks: defineTable({
    packId: v.string(),
    threadId: v.string(),
    docSetHash: v.string(), // Hash of sorted docIds for cache key
    documents: v.array(
      v.object({
        docId: v.string(),
        title: v.string(),
        excerpts: v.array(
          v.object({
            text: v.string(),
            section: v.optional(v.string()),
            relevanceScore: v.optional(v.number()),
          }),
        ),
        totalTokensEstimate: v.number(),
      }),
    ),
    totalTokens: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
    metadata: v.object({
      docCount: v.number(),
      truncatedDocs: v.number(),
      maxTokensUsed: v.number(),
    }),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_hash", ["threadId", "docSetHash"])
    .index("by_expiresAt", ["expiresAt"]),

  /* ------------------------------------------------------------------ */
  /* EVAL RUNS - Benchmark evaluation runs for agent testing            */
  /* ------------------------------------------------------------------ */
  evalRuns: defineTable({
    suiteId: v.string(), // Test suite identifier
    model: v.string(), // Model used for evaluation
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    totalCases: v.number(),
    passedCases: v.number(),
    failedCases: v.number(),
    passRate: v.number(), // 0-1
    avgLatencyMs: v.number(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(v.any()), // Extra run configuration
  })
    .index("by_suite", ["suiteId"])
    .index("by_status", ["status"])
    .index("by_startedAt", ["startedAt"]),

  /* ------------------------------------------------------------------ */
  /* EVAL RESULTS - Individual test case results within an eval run     */
  /* ------------------------------------------------------------------ */
  evalResults: defineTable({
    runId: v.id("evalRuns"),
    testId: v.string(), // Test case ID
    passed: v.boolean(),
    latencyMs: v.number(),
    toolsCalled: v.array(v.string()),
    response: v.string(),
    reasoning: v.string(), // Judge's reasoning
    failureCategory: v.optional(v.string()), // For failure analysis
    suggestedFix: v.optional(v.string()), // Judge's suggestion
    artifacts: v.optional(v.array(v.string())), // Artifact IDs produced
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_testId", ["testId"])
    .index("by_run_passed", ["runId", "passed"]),

  /* ------------------------------------------------------------------ */
  /* RUBRIC EVOLUTIONS - Self-evolution audit trail (Karpathy loop)     */
  /* ------------------------------------------------------------------ */
  rubricEvolutions: defineTable({
    cycleId: v.string(),
    version: v.number(),
    changes: v.array(
      v.object({
        type: v.union(
          v.literal("add_gate"),
          v.literal("remove_gate"),
          v.literal("adjust_threshold"),
          v.literal("add_disqualifier"),
        ),
        gateName: v.string(),
        reasoning: v.string(),
        confidence: v.number(),
        before: v.string(),
        after: v.string(),
      }),
    ),
    overallReasoning: v.string(),
    expectedImpact: v.string(),
    analysisSnapshot: v.object({
      totalDecisions: v.number(),
      postRate: v.number(),
      falsePositiveRate: v.number(),
      dataWindowDays: v.number(),
      gateCount: v.number(),
    }),
    appliedAt: v.number(),
    status: v.union(v.literal("applied"), v.literal("skipped")),
  })
    .index("by_cycleId", ["cycleId"])
    .index("by_appliedAt", ["appliedAt"])
    .index("by_status", ["status", "appliedAt"]),

  // Human-in-the-Loop (HITL) Interrupts for agent approval workflow
  agentInterrupts: defineTable({
    threadId: v.string(),
    toolName: v.string(),
    arguments: v.any(),
    description: v.string(),
    allowedDecisions: v.array(v.string()), // ["approve", "edit", "reject"]
    status: v.string(), // "pending" | "approve" | "edit" | "reject" | "cancelled"
    decision: v.optional(
      v.object({
        type: v.string(),
        editedAction: v.optional(
          v.object({
            name: v.string(),
            args: v.any(),
          }),
        ),
        message: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_and_status", ["threadId", "status"]),

  // API Usage Tracking
  apiUsage: defineTable({
    userId: v.id("users"),
    apiName: v.string(),
    operation: v.string(),
    timestamp: v.number(),
    unitsUsed: v.optional(v.number()),
    estimatedCost: v.optional(v.number()),
    requestMetadata: v.optional(v.any()),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
    responseTime: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_api", ["userId", "apiName"])
    .index("by_user_and_timestamp", ["userId", "timestamp"]),

  apiUsageDaily: defineTable({
    userId: v.id("users"),
    apiName: v.string(),
    date: v.string(),
    totalCalls: v.number(),
    successfulCalls: v.number(),
    failedCalls: v.number(),
    totalUnitsUsed: v.number(),
    totalCost: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_date", ["userId", "date"])
    .index("by_user_api_date", ["userId", "apiName", "date"]),

  /* ------------------------------------------------------------------ */
  /* CONFIRMED COMPANIES - User-confirmed company selections for SEC    */
  /* ------------------------------------------------------------------ */
  confirmedCompanies: defineTable({
    threadId: v.string(), // Links to conversation thread
    companyName: v.string(), // User's original query term (e.g., "Dasher")
    confirmedCik: v.string(), // The CIK of the confirmed company
    confirmedName: v.string(), // Full legal name of the confirmed company
    confirmedTicker: v.optional(v.string()), // Ticker symbol if available
    createdAt: v.number(), // Timestamp of confirmation
  })
    .index("by_thread_and_name", ["threadId", "companyName"])
    .index("by_thread", ["threadId"]),

  /* ------------------------------------------------------------------ */
  /* PENDING DOCUMENT EDITS - Deep Agent edit instructions for client   */
  /* ------------------------------------------------------------------ */
  pendingDocumentEdits: defineTable({
    documentId: v.id("documents"), // Target document
    userId: v.id("users"), // User who initiated the edit
    agentThreadId: v.string(), // Agent thread for correlation
    documentVersion: v.number(), // Document version at time of read (OCC)
    operation: v.object({
      type: v.literal("anchoredReplace"), // Edit operation type
      anchor: v.string(), // Text anchor to find position
      search: v.string(), // Text to search for and replace
      replace: v.string(), // Replacement text
      sectionHint: v.optional(v.string()), // Human-readable section name
    }),
    status: v.union(
      v.literal("pending"), // Awaiting client application
      v.literal("applied"), // Successfully applied
      v.literal("failed"), // Client failed to apply
      v.literal("cancelled"), // User cancelled
      v.literal("stale"), // Document changed since planning
    ),
    errorMessage: v.optional(v.string()), // Error details if failed
    retryCount: v.number(), // Number of retry attempts
    createdAt: v.number(), // When edit was created
    appliedAt: v.optional(v.number()), // When edit was applied
  })
    .index("by_document", ["documentId"])
    .index("by_document_status", ["documentId", "status"])
    .index("by_thread", ["agentThreadId"])
    .index("by_user", ["userId"])
    .index("by_document_version", ["documentId", "documentVersion"]),

  /* ------------------------------------------------------------------ */
  /* CALENDAR DATE MARKERS - Auto-detected dates from files            */
  /* ------------------------------------------------------------------ */
  calendarDateMarkers: defineTable({
    userId: v.id("users"), // User who owns this marker
    documentId: v.id("documents"), // Document that triggered the marker
    fileName: v.string(), // Original filename
    detectedDate: v.number(), // Detected date timestamp
    confidence: v.string(), // 'high', 'medium', 'low'
    pattern: v.string(), // Pattern used to detect (ISO, US, MonthDay, etc.)
    createdAt: v.number(), // When marker was created
    updatedAt: v.number(), // When marker was last updated
  })
    .index("by_user", ["userId"])
    .index("by_document", ["documentId"])
    .index("by_user_and_date", ["userId", "detectedDate"]),

  /* ------------------------------------------------------------------ */
  /* HUMAN-IN-THE-LOOP - Agent requests for human input                */
  /* ------------------------------------------------------------------ */
  humanRequests: defineTable({
    userId: v.id("users"), // User who owns this request (for security)
    threadId: v.string(), // Agent thread ID
    messageId: v.string(), // Message ID where request was made
    toolCallId: v.string(), // Tool call ID for askHuman
    question: v.string(), // Question to ask human
    context: v.optional(v.string()), // Context about why asking
    options: v.optional(v.array(v.string())), // Suggested options
    status: v.union(
      v.literal("pending"),
      v.literal("answered"),
      v.literal("cancelled"),
    ),
    response: v.optional(v.string()), // Human's response
    respondedAt: v.optional(v.number()), // When human responded
  })
    .index("by_user", ["userId"])
    .index("by_thread", ["threadId"])
    .index("by_status", ["status"])
    .index("by_thread_and_status", ["threadId", "status"]),

  /* ------------------------------------------------------------------ */
  /* CONFIRMED PEOPLE - User-confirmed person selections                */
  /* ------------------------------------------------------------------ */
  confirmedPeople: defineTable({
    threadId: v.string(), // Links to conversation thread
    personName: v.string(), // User's original query term (e.g., "Michael Jordan")
    confirmedId: v.string(), // Unique identifier for the person
    confirmedName: v.string(), // Full name of the confirmed person
    confirmedProfession: v.optional(v.string()), // Profession/occupation
    confirmedOrganization: v.optional(v.string()), // Organization/company
    confirmedLocation: v.optional(v.string()), // Location
    createdAt: v.number(), // Timestamp of confirmation
  })
    .index("by_thread_and_name", ["threadId", "personName"])
    .index("by_thread", ["threadId"]),

  /* ------------------------------------------------------------------ */
  /* CONFIRMED EVENTS - User-confirmed event selections                 */
  /* ------------------------------------------------------------------ */
  confirmedEvents: defineTable({
    threadId: v.string(), // Links to conversation thread
    eventQuery: v.string(), // User's original query term (e.g., "Apple Event")
    confirmedId: v.string(), // Unique identifier for the event
    confirmedName: v.string(), // Full name of the confirmed event
    confirmedDate: v.optional(v.string()), // Event date
    confirmedLocation: v.optional(v.string()), // Event location
    confirmedDescription: v.optional(v.string()), // Event description
    createdAt: v.number(), // Timestamp of confirmation
  })
    .index("by_thread_and_query", ["threadId", "eventQuery"])
    .index("by_thread", ["threadId"]),

  /* ------------------------------------------------------------------ */
  /* CONFIRMED NEWS TOPICS - User-confirmed news article selections     */
  /* ------------------------------------------------------------------ */
  confirmedNewsTopics: defineTable({
    threadId: v.string(), // Links to conversation thread
    newsQuery: v.string(), // User's original query term (e.g., "Tesla news")
    confirmedId: v.string(), // Unique identifier for the article
    confirmedHeadline: v.string(), // Article headline
    confirmedSource: v.optional(v.string()), // News source
    confirmedDate: v.optional(v.string()), // Publication date
    confirmedUrl: v.optional(v.string()), // Article URL
    createdAt: v.number(), // Timestamp of confirmation
  })
    .index("by_thread_and_query", ["threadId", "newsQuery"])
    .index("by_thread", ["threadId"]),

  /* ------------------------------------------------------------------ */
  /* ENTITY CONTEXTS - Cached entity research data (companies, people)  */
  /* ------------------------------------------------------------------ */
  entityContexts: defineTable({
    entityName: v.string(), // Name of the entity (company/person)
    entityType: v.union(v.literal("company"), v.literal("person")),
    linkupData: v.optional(v.any()), // Raw LinkUp API response
    summary: v.string(), // Brief summary of the entity
    keyFacts: v.array(v.string()), // Array of key facts/highlights
    sources: v.array(
      v.object({
        name: v.string(),
        url: v.string(),
        snippet: v.optional(v.string()),
      }),
    ),
    // CRM Fields (NEW)
    crmFields: v.optional(
      v.object({
        companyName: v.string(),
        description: v.string(),
        headline: v.string(),
        hqLocation: v.string(),
        city: v.string(),
        state: v.string(),
        country: v.string(),
        website: v.string(),
        email: v.string(),
        phone: v.string(),
        founders: v.array(v.string()),
        foundersBackground: v.string(),
        keyPeople: v.array(
          v.object({
            name: v.string(),
            title: v.string(),
          }),
        ),
        industry: v.string(),
        companyType: v.string(),
        foundingYear: v.optional(v.number()),
        product: v.string(),
        targetMarket: v.string(),
        businessModel: v.string(),
        fundingStage: v.string(),
        totalFunding: v.string(),
        lastFundingDate: v.string(),
        investors: v.array(v.string()),
        investorBackground: v.string(),
        competitors: v.array(v.string()),
        competitorAnalysis: v.string(),
        fdaApprovalStatus: v.string(),
        fdaTimeline: v.string(),
        newsTimeline: v.array(
          v.object({
            date: v.string(),
            headline: v.string(),
            source: v.string(),
          }),
        ),
        recentNews: v.string(),
        keyEntities: v.array(v.string()),
        researchPapers: v.array(v.string()),
        partnerships: v.array(v.string()),
        completenessScore: v.number(),
        dataQuality: v.union(
          v.literal("verified"),
          v.literal("partial"),
          v.literal("incomplete"),
        ),
      }),
    ),
    //
    // BANKER-GRADE ENRICHMENT FIELDS (AUDIT_MOCKS aligned)
    //

    /** Structured funding data */
    funding: v.optional(v.any()),

    /** People data (founders, executives, board) */
    people: v.optional(v.any()),

    /** Product pipeline data */
    productPipeline: v.optional(v.any()),

    /** Recent news items (structured) */
    recentNewsItems: v.optional(v.any()),

    /** Contact points for outreach */
    contactPoints: v.optional(v.any()),

    /** Freshness metadata */
    freshness: v.optional(v.any()),

    /** Persona hooks for 10-persona audit */
    personaHooks: v.optional(v.any()),

    spreadsheetId: v.optional(v.id("documents")), // Optional link to source spreadsheet
    rowIndex: v.optional(v.number()), // Optional row index in spreadsheet
    researchedAt: v.number(), // Timestamp when researched
    researchedBy: v.optional(v.id("users")), // User who triggered the research (optional for anonymous)
    lastAccessedAt: v.number(), // Last time this context was accessed
    accessCount: v.number(), // Number of times accessed (cache hits)
    version: v.number(), // Version number for cache invalidation
    isStale: v.optional(v.boolean()), // Flag for stale data (> 7 days)

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // GAM: STRUCTURED MEMORY FIELDS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** Canonical key for disambiguation (e.g., "company:TSLA") */
    canonicalKey: v.optional(v.string()),

    /** Structured facts with boolean confidence flags */
    structuredFacts: v.optional(
      v.array(
        v.object({
          id: v.string(),
          subject: v.string(),
          predicate: v.string(),
          object: v.string(),
          /** Boolean: does this fact meet confidence threshold? */
          isHighConfidence: v.boolean(),
          sourceIds: v.array(v.string()),
          timestamp: v.string(),
          isOutdated: v.optional(v.boolean()),
        }),
      ),
    ),

    /** Narrative interpretations (growth story, bear case, etc.) */
    narratives: v.optional(
      v.array(
        v.object({
          label: v.string(),
          description: v.string(),
          supportingFactIds: v.array(v.string()),
          /** Boolean: is this narrative well-supported? */
          isWellSupported: v.boolean(),
          lastUpdated: v.string(),
        }),
      ),
    ),

    /** Actionable heuristics for agents */
    heuristics: v.optional(v.array(v.string())),

    /** Conflict tracking */
    conflicts: v.optional(
      v.array(
        v.object({
          factIds: v.array(v.string()),
          description: v.string(),
          status: v.union(v.literal("unresolved"), v.literal("resolved")),
          detectedAt: v.string(),
        }),
      ),
    ),

    /** Boolean quality flags (not arbitrary scores) */
    quality: v.optional(
      v.object({
        hasSufficientFacts: v.boolean(),
        hasRecentResearch: v.boolean(),
        hasNoConflicts: v.boolean(),
        hasVerifiedSources: v.boolean(),
        hasHighConfidenceFacts: v.boolean(),
        hasNarratives: v.boolean(),
        hasHeuristics: v.boolean(),
      }),
    ),

    /** Quality tier derived from flags */
    qualityTier: v.optional(
      v.union(
        v.literal("excellent"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("poor"),
      ),
    ),

    /** Fact count for quick checks */
    factCount: v.optional(v.number()),

    /** Cross-references */
    relatedEntityNames: v.optional(v.array(v.string())),
    linkedDocIds: v.optional(v.array(v.id("documents"))),

    /** Research job tracking */
    lastResearchJobId: v.optional(v.string()),
    researchDepth: v.optional(
      v.union(v.literal("shallow"), v.literal("standard"), v.literal("deep")),
    ),

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // KNOWLEDGE GRAPH INTEGRATION
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** Link to the entity's knowledge graph */
    knowledgeGraphId: v.optional(v.id("knowledgeGraphs")),

    /** Cluster assignment from HDBSCAN (null = noise/odd-one-out) */
    clusterId: v.optional(v.string()),

    /** Boolean: is this entity an outlier? (HDBSCAN noise label) */
    isOddOneOut: v.optional(v.boolean()),

    /** Boolean: is this entity within cluster support region? (One-Class SVM) */
    isInClusterSupport: v.optional(v.boolean()),

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // ARBITRAGE AGENT FIELDS (Receipts-first research)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** Arbitrage-specific metrics */
    arbitrageMetadata: v.optional(
      v.object({
        lastArbitrageCheckAt: v.number(),
        contradictionCount: v.number(),
        sourceQualityScore: v.number(), // 0-100 composite score
        verificationStatus: v.union(
          v.literal("verified"),
          v.literal("partial"),
          v.literal("unverified"),
        ),
        deltasSinceLastCheck: v.number(),
        hiddenSourcesCount: v.number(),
      }),
    ),

    /** Source health tracking (URL availability + content changes) */
    sourceHealth: v.optional(
      v.array(
        v.object({
          url: v.string(),
          lastChecked: v.number(),
          status: v.union(
            v.literal("ok"),
            v.literal("404"),
            v.literal("content_changed"),
          ),
          contentHash: v.string(),
          firstSeenHash: v.string(),
        }),
      ),
    ),

    /** Delta changelog (what changed since last arbitrage check) */
    deltas: v.optional(
      v.array(
        v.object({
          type: v.union(
            v.literal("fact_added"),
            v.literal("fact_removed"),
            v.literal("fact_modified"),
            v.literal("conflict_detected"),
            v.literal("conflict_resolved"),
            v.literal("source_404"),
            v.literal("source_changed"),
          ),
          factId: v.optional(v.string()),
          timestamp: v.number(),
          description: v.string(),
          severity: v.union(
            v.literal("high"),
            v.literal("medium"),
            v.literal("low"),
          ),
        }),
      ),
    ),

    // Deep Agent enrichment tracking (fixes publishedAt hack)
    ingestedAt: v.optional(v.number()), // When entity was first discovered
    lastEnrichedAt: v.optional(v.number()), // Last enrichment job completion
    enrichmentJobId: v.optional(v.id("enrichmentJobs")), // Current/last enrichment job
  })
    .index("by_entity", ["entityName", "entityType"])
    .index("by_ingestedAt", ["ingestedAt"])
    .index("by_spreadsheet", ["spreadsheetId", "rowIndex"])
    .index("by_user", ["researchedBy"])
    .index("by_researched_at", ["researchedAt"])
    .index("by_canonicalKey", ["canonicalKey"])
    .index("by_user_accessedAt", ["researchedBy", "lastAccessedAt"])
    .index("by_qualityTier", ["qualityTier"])
    .searchIndex("search_entity", {
      searchField: "entityName",
      filterFields: ["entityType", "researchedBy"],
    }),

  /* ------------------------------------------------------------------ */
  /* ADAPTIVE ENTITY PROFILES - LLM-discovered entity structure          */
  /* Dynamic timeline, relationships, and sections (not hardcoded)       */
  /* ------------------------------------------------------------------ */
  adaptiveEntityProfiles: defineTable({
    entityName: v.string(), // Name of the entity
    entityType: v.string(), // LLM-inferred type (founder, investor, company, etc.)

    // The full adaptive profile (stored as flexible JSON)
    profile: v.any(), // AdaptiveEntityProfile object

    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
    version: v.number(), // Version for cache invalidation

    // Quality tracking
    completeness: v.optional(v.number()), // 0-100 score
    confidence: v.optional(v.number()), // 0-100 score

    // Research state
    lastResearchedAt: v.optional(v.number()),
    researchDepth: v.optional(
      v.union(v.literal("quick"), v.literal("standard"), v.literal("deep")),
    ),

    // Link to base entity context
    entityContextId: v.optional(v.id("entityContexts")),
  })
    .index("by_name", ["entityName"])
    .index("by_type", ["entityType"])
    .index("by_updated", ["updatedAt"])
    .searchIndex("search_name", {
      searchField: "entityName",
      filterFields: ["entityType"],
    }),

  // Visitor tracking for analytics
  visitors: defineTable({
    userId: v.optional(v.id("users")),
    sessionId: v.string(),
    page: v.string(),
    lastSeen: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_user", ["userId"]),

  // Email tracking
  emailsSent: defineTable({
    email: v.string(),
    userId: v.optional(v.id("users")),
    subject: v.string(),
    success: v.boolean(),
    sentAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_user", ["userId"])
    .index("by_sent_at", ["sentAt"]),

  /* ------------------------------------------------------------------ */
  /* AGENT PLANS - Task plans created by Deep Agents                    */
  /* ------------------------------------------------------------------ */
  agentPlans: defineTable({
    userId: v.id("users"),
    agentThreadId: v.optional(v.string()),
    goal: v.string(),
    steps: v.array(
      v.object({
        description: v.string(),
        status: v.union(
          v.literal("pending"),
          v.literal("in_progress"),
          v.literal("completed"),
        ),
      }),
    ),
    features: v.optional(
      v.array(
        v.object({
          name: v.string(),
          status: v.union(
            v.literal("pending"),
            v.literal("failing"),
            v.literal("passing"),
          ),
          testCriteria: v.string(),
          notes: v.optional(v.string()),
        }),
      ),
    ),
    progressLog: v.optional(
      v.array(
        v.object({
          ts: v.number(),
          status: v.union(
            v.literal("info"),
            v.literal("pending"),
            v.literal("working"),
            v.literal("passing"),
            v.literal("failing"),
            v.literal("error"),
          ),
          message: v.string(),
          meta: v.optional(v.any()),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_updated", ["userId", "updatedAt"])
    .index("by_agent_thread", ["agentThreadId", "updatedAt"]),

  /* ------------------------------------------------------------------ */
  /* AGENT MEMORY - Persistent memory for Deep Agents                   */
  /* ------------------------------------------------------------------ */
  agentMemory: defineTable({
    userId: v.id("users"),
    key: v.string(),
    content: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_key", ["userId", "key"]),

  /* ------------------------------------------------------------------ */
  /* AGENT SCRATCHPADS - Persistent scratchpad per agent thread         */
  /*                                                                     */
  /* Pattern: scratchpad-first (see .claude/rules/scratchpad_first.md)   */
  /* Prior art: Anthropic Claude Code CLAUDE.md · Manus virtual workspace */
  /*                                                                     */
  /* 2026-04-19: extended with drift + status + idempotency fields to    */
  /* support the diligence-block pipeline. All new fields optional so    */
  /* existing callers remain backward-compatible.                        */
  /* ------------------------------------------------------------------ */
  agentScratchpads: defineTable({
    agentThreadId: v.string(),
    userId: v.id("users"),
    scratchpad: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),

    // ── Phase 1 extensions (all optional for backward compatibility) ──

    /** Canonical entity this scratchpad enriches (e.g., company slug). */
    entitySlug: v.optional(v.string()),

    /**
     * Entity version observed when this scratchpad was created. Used by
     * the compaction pass to detect drift — if the entity has advanced
     * past this version, structuring must re-run against current state.
     */
    entityVersionAtStart: v.optional(v.number()),

    /**
     * Run lifecycle status. Drives UI subscription (streaming vs final)
     * and the orphan-run janitor cron.
     *   streaming    — sub-agents still writing
     *   structuring  — structuring LLM pass in progress
     *   merged       — attribution complete, structured output persisted
     *   drifted      — entity advanced during structuring; needs re-merge
     *   failed       — permanent failure; details in failureReason
     *   skipped      — user abandoned (wrap-up dismissed)
     */
    status: v.optional(
      v.union(
        v.literal("streaming"),
        v.literal("structuring"),
        v.literal("merged"),
        v.literal("drifted"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
    ),

    /**
     * Deterministic idempotency key: sha256(entitySlug + ingestHash + userId).
     * Duplicate submits collide on this key and return the existing runId
     * rather than double-processing. See .claude/rules/async_reliability.md.
     */
    idempotencyKey: v.optional(v.string()),

    /**
     * Markdown body schema version. Lets readers handle multiple shapes
     * as we evolve the scratchpad template over time.
     */
    schemaVersion: v.optional(v.number()),

    /**
     * Mode the run was submitted in — drives UI subscription model.
     * Live runs stream the scratchpad to the chat UI; background runs
     * post a notification on completion.
     */
    mode: v.optional(v.union(v.literal("live"), v.literal("background"))),

    /** Reason recorded when status transitions to "failed". */
    failureReason: v.optional(v.string()),
  })
    .index("by_agent_thread", ["agentThreadId"])
    .index("by_user", ["userId"])
    .index("by_entity", ["entitySlug"])
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_status", ["status"]),

  /* ------------------------------------------------------------------ */
  /* SESSION ARTIFACTS - Per-session agent-generated candidates          */
  /*                                                                     */
  /* Pattern: batched end-of-session review (like Claude Code files-     */
  /* changed summary + Perplexity Lab artifacts rail).                   */
  /*                                                                     */
  /* Every agent-generated candidate (company mention, founder, product, */
  /* funding round, news item, memo) goes into this table in a "pending" */
  /* state. The user reviews at wrap-up:                                 */
  /*   keep     → promotes to a standalone entity Report                 */
  /*   dismiss  → stays in session context, doesn't become standalone    */
  /*   skip     → pending bucket, decided later                          */
  /*                                                                     */
  /* See: docs/archive/2026-q1/architecture-superseded/                   */
  /*      (earlier drafts of SESSION_ARTIFACTS.md)                       */
  /*      .claude/rules/scratchpad_first.md                              */
  /* ------------------------------------------------------------------ */
  sessionArtifacts: defineTable({
    /** Owning chat session. Matches agentThreadId from agentScratchpads. */
    sessionId: v.string(),
    userId: v.optional(v.id("users")),
    /** Anonymous session fallback for pre-auth users. */
    anonymousSessionId: v.optional(v.string()),

    /** Artifact kind — mirrors the 10 diligence blocks + extras. */
    artifactKind: v.union(
      v.literal("company"),
      v.literal("founder"),
      v.literal("product"),
      v.literal("funding"),
      v.literal("news"),
      v.literal("hiring"),
      v.literal("patent"),
      v.literal("publicOpinion"),
      v.literal("competitor"),
      v.literal("regulatory"),
      v.literal("memo"),
    ),

    /** Human-readable display name shown in the panel (e.g. "Jane Doe"). */
    displayName: v.string(),
    /** 1-line summary shown under the name. */
    summary: v.optional(v.string()),

    /** Evidence tier from the verification judge — drives default toggle. */
    confidenceTier: v.optional(
      v.union(
        v.literal("verified"),
        v.literal("corroborated"),
        v.literal("single-source"),
        v.literal("unverified"),
      ),
    ),

    /** Source count for the confidence chip. */
    sourceCount: v.optional(v.number()),
    /** Optional short source label (e.g. "LinkedIn · TechCrunch"). */
    sourceLabel: v.optional(v.string()),

    /** Review state. */
    status: v.union(
      v.literal("pending"), // awaiting user review (wrap-up)
      v.literal("kept"), // promoted to a standalone entity Report
      v.literal("dismissed"), // explicitly rejected by user
      v.literal("auto"), // auto-kept (verified tier, user didn't intervene)
    ),

    /** Slug of the entity Report this artifact promoted to, after `status = kept`. */
    promotedEntitySlug: v.optional(v.string()),

    /** Reference to the scratchpad run that produced this artifact. */
    scratchpadRunId: v.optional(v.string()),

    /** Free-form extra data (block-specific candidate shape). Keep small. */
    payload: v.optional(v.any()),

    createdAt: v.number(),
    updatedAt: v.number(),
    /** Set when status transitions from pending. */
    reviewedAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_status", ["sessionId", "status"])
    .index("by_user", ["userId"])
    .index("by_anonymous", ["anonymousSessionId"])
    .index("by_status", ["status"])
    .index("by_promoted_entity", ["promotedEntitySlug"]),

  /* ------------------------------------------------------------------ */
  /* AGENT EPISODIC MEMORY - Per-run chronological memory               */
  /* ------------------------------------------------------------------ */
  agentEpisodicMemory: defineTable({
    runId: v.string(),
    userId: v.id("users"),
    ts: v.number(),
    tags: v.optional(v.array(v.string())),
    data: v.any(),
  })
    .index("by_run", ["runId", "ts"])
    .index("by_user", ["userId", "ts"]),

  /* ------------------------------------------------------------------ */
  /* GAM: RESEARCH JOBS - Background research job queue                 */
  /* ------------------------------------------------------------------ */
  researchJobs: defineTable({
    userId: v.id("users"),
    targetType: v.union(v.literal("entity"), v.literal("theme")),
    /** Canonical key (e.g., "company:TSLA" or "theme:agent-memory") */
    targetId: v.string(),
    /** Human-readable name for display */
    targetDisplayName: v.string(),
    jobType: v.union(
      v.literal("initial"),
      v.literal("refresh"),
      v.literal("merge_review"),
      v.literal("deep_upgrade"),
    ),
    researchDepth: v.optional(
      v.union(v.literal("shallow"), v.literal("standard"), v.literal("deep")),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    priority: v.number(),
    triggerSource: v.optional(v.string()),
    error: v.optional(v.string()),
    /** Job duration tracking */
    durationMs: v.optional(v.number()),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_user_status", ["userId", "status"])
    .index("by_target", ["targetType", "targetId"])
    .index("by_createdAt", ["createdAt"]),

  /* ------------------------------------------------------------------ */
  /* GAM: MEMORY METRICS - Usage and quality tracking                   */
  /* ------------------------------------------------------------------ */
  memoryMetrics: defineTable({
    date: v.string(), // YYYY-MM-DD
    userId: v.optional(v.id("users")), // null for global metrics

    // Query metrics (boolean outcomes)
    queryMemoryCalls: v.number(),
    queryMemoryHits: v.number(), // found=true
    queryMemoryMisses: v.number(), // found=false
    queryMemoryStaleHits: v.number(), // found but stale

    // Job metrics
    researchJobsCreated: v.number(),
    researchJobsCompleted: v.number(),
    researchJobsFailed: v.number(),

    // Memory state counts
    totalEntityMemories: v.number(),
    totalThemeMemories: v.number(),

    // Write metrics
    factsAdded: v.number(),
    factsRejected: v.number(),
    conflictsDetected: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_user_date", ["userId", "date"]),

  /* ------------------------------------------------------------------ */
  /* ULTRA-LONG CHAT EVAL RUNS - Per-scenario run (multi-turn)           */
  /* Links to evalRuns for suite-level aggregation. Each row represents */
  /* one run of one scenario at one sample index (N-run sampling).      */
  /* ------------------------------------------------------------------ */
  ultraLongChatEvalRuns: defineTable({
    suiteRunId: v.id("evalRuns"),            // Parent suite run
    scenarioId: v.string(),                   // Scenario identifier
    scenarioVersion: v.number(),              // Dataset version at run time
    sampleIndex: v.number(),                  // Which sample in N-run sampling (0..N-1)
    model: v.string(),                        // Model tested
    threadId: v.string(),                     // Real agent thread used
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    totalTurns: v.number(),
    turnsCompleted: v.number(),
    turnsJudgedPassing: v.number(),
    passRate: v.number(),                     // 0-1 fraction of judged turns passing
    totalLatencyMs: v.number(),
    totalTokens: v.number(),
    totalCostUsd: v.number(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_suite", ["suiteRunId"])
    .index("by_scenario", ["scenarioId"])
    .index("by_suite_scenario", ["suiteRunId", "scenarioId"])
    .index("by_startedAt", ["startedAt"]),

  /* ------------------------------------------------------------------ */
  /* ULTRA-LONG CHAT EVAL TURNS - Per-turn trace + judge verdict        */
  /* One row per user turn with the agent response, tool calls,         */
  /* boolean judge criteria, and latency/tokens. Enables drill-down.    */
  /* ------------------------------------------------------------------ */
  ultraLongChatEvalTurns: defineTable({
    runId: v.id("ultraLongChatEvalRuns"),
    turnNumber: v.number(),                  // 1-indexed within the scenario
    userMessage: v.string(),
    assistantResponse: v.string(),            // Captured real response
    toolsCalled: v.array(v.string()),
    latencyMs: v.number(),
    tokensIn: v.number(),
    tokensOut: v.number(),
    // Boolean judge criteria for this turn
    criteria: v.object({
      rememberedPriorContext: v.boolean(),
      didNotReFetchStaleData: v.boolean(),
      prioritiesSurfacedWhenAsked: v.boolean(),
      noHallucinatedClaims: v.boolean(),
      appropriateAngleActivation: v.boolean(),
      stayedOnTopic: v.boolean(),
    }),
    criteriaReasons: v.any(),                 // Judge rationale per criterion
    passed: v.boolean(),                      // AND of all criteria
    judgeModel: v.string(),
    judgeLatencyMs: v.number(),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_turn", ["runId", "turnNumber"])
    .index("by_run_passed", ["runId", "passed"]),

  /* ------------------------------------------------------------------ */
  /* ULTRA-LONG CHAT EVAL AGGREGATES - N-run statistical summary         */
  /* One row per (suiteRunId, scenarioId) summarizing N samples with     */
  /* mean, stdev, 95% CI per boolean criterion. Enables regression gate.*/
  /* ------------------------------------------------------------------ */
  ultraLongChatEvalAggregates: defineTable({
    suiteRunId: v.id("evalRuns"),
    scenarioId: v.string(),
    scenarioVersion: v.number(),
    model: v.string(),
    sampleCount: v.number(),                  // N
    // Per-criterion statistics across N samples
    criterionStats: v.array(v.object({
      criterion: v.string(),
      meanPassRate: v.number(),                // [0,1]
      stdev: v.number(),
      ci95Low: v.number(),
      ci95High: v.number(),
    })),
    overallMeanPassRate: v.number(),
    overallCi95Low: v.number(),
    overallCi95High: v.number(),
    avgLatencyMsPerTurn: v.number(),
    avgCostUsdPerRun: v.number(),
    createdAt: v.number(),
  })
    .index("by_suite", ["suiteRunId"])
    .index("by_suite_scenario", ["suiteRunId", "scenarioId"])
    .index("by_scenario_createdAt", ["scenarioId", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* RESEARCH SESSIONS - Ultra-long chat progressive disclosure state   */
  /* Patterns: Claude Skills (3-layer PD), LangGraph (checkpointing),   */
  /*          Hermes (4-layer memory), DeerFlow (summarization)         */
  /* ------------------------------------------------------------------ */
  researchSessions: defineTable({
    userId: v.string(),           // User identity (supports anonymous)
    topic: v.string(),            // Main research topic
    primaryEntity: v.union(v.string(), v.null()),

    // Progressive disclosure state (Claude Skills 3-layer)
    layer1Index: v.array(v.string()),     // Available angles (metadata)
    layer2Active: v.array(v.string()),    // Loaded angles (summaries)
    layer3DeepDive: v.union(v.string(), v.null()),  // Active deep dive ref

    // Loaded angles with full state (LangGraph-style)
    loadedAngles: v.array(v.object({
      angleId: v.string(),
      loadedAt: v.number(),
      lastAccessed: v.number(),
      dataHash: v.string(),
      summary: v.string(),
      fullDataRef: v.string(),
      mode: v.union(v.literal("fresh"), v.literal("stale"), v.literal("rehydrated")),
    })),

    // Evidence management (DeerFlow aggressive summarization)
    evidenceSummary: v.string(),          // Rolling summary
    evidenceDetailRefs: v.array(v.string()),  // Full evidence references
    compressionLevel: v.union(v.literal(0), v.literal(1), v.literal(2), v.literal(3)),
    lastSummarizedAt: v.number(),

    // Conversation tracking (Hermes turn-level)
    conversationTurns: v.number(),
    totalTokensConsumed: v.number(),
    contextWindowTokens: v.number(),

    // Timestamps
    createdAt: v.number(),
    lastActivityAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_topic", ["userId", "topic"])
    .index("by_last_activity", ["lastActivityAt"]),

  /* ------------------------------------------------------------------ */
  /* RESEARCH MEMORY - Cross-session persistent claims (Hermes Layer 4) */
  /* ------------------------------------------------------------------ */
  researchMemory: defineTable({
    userId: v.string(),
    sessionId: v.union(v.string(), v.null()),  // Originating session
    claim: v.string(),
    confidence: v.number(),
    source: v.union(v.string(), v.null()),
    entity: v.union(v.string(), v.null()),
    topic: v.string(),
    tags: v.array(v.string()),
    createdAt: v.number(),
    lastAccessedAt: v.number(),
    accessCount: v.number(),           // Frequency-based relevance
  })
    .index("by_user", ["userId"])
    .index("by_user_topic", ["userId", "topic"])
    .index("by_user_entity", ["userId", "entity"])
    .index("by_session", ["sessionId"]),

  /* ------------------------------------------------------------------ */
  /* RESEARCH CHECKPOINTS - LangGraph-style state snapshots             */
  /* ------------------------------------------------------------------ */
  researchCheckpoints: defineTable({
    sessionId: v.string(),
    threadId: v.string(),               // LangGraph thread concept
    turnNumber: v.number(),
    checkpointNs: v.string(),           // Namespace for subgraphs
    state: v.any(),                     // Full state snapshot
    nextNodes: v.array(v.string()),     // What to execute next
    createdAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_thread", ["threadId"])
    .index("by_session_turn", ["sessionId", "turnNumber"]),

  /* ------------------------------------------------------------------ */
  /* KNOWLEDGE GRAPHS - Claim-based graphs for entity/theme research     */
  /* ------------------------------------------------------------------ */
  knowledgeGraphs: defineTable({
    // Identity
    name: v.string(),
    sourceType: v.union(
      v.literal("entity"), // from entityContexts
      v.literal("theme"), // from themeMemory
      v.literal("artifact"), // from document/file
      v.literal("session"), // from chat session research
    ),
    sourceId: v.string(), // canonicalKey or documentId
    userId: v.id("users"),

    // Graph-level embeddings (fingerprints)
    semanticFingerprint: v.optional(v.array(v.float64())),
    wlSignature: v.optional(v.string()), // Weisfeiler-Lehman hash

    // Clustering results (boolean outputs)
    clusterId: v.optional(v.string()), // null = noise/odd-one-out
    isOddOneOut: v.boolean(), // HDBSCAN noise label
    isInClusterSupport: v.optional(v.boolean()), // One-Class SVM inlier

    // Provenance
    claimCount: v.number(),
    edgeCount: v.number(),
    lastBuilt: v.number(),
    lastClustered: v.optional(v.number()),
    lastFingerprinted: v.optional(v.number()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_source", ["sourceType", "sourceId"])
    .index("by_cluster", ["clusterId"])
    .index("by_oddOneOut", ["isOddOneOut"])
    .index("by_user_source", ["userId", "sourceType"]),

  /* ------------------------------------------------------------------ */
  /* GRAPH CLAIMS - Individual claims (SPO triples) within a graph       */
  /* ------------------------------------------------------------------ */
  graphClaims: defineTable({
    graphId: v.id("knowledgeGraphs"),

    // Claim content (SPO triple)
    subject: v.string(),
    predicate: v.string(),
    object: v.string(),
    claimText: v.string(), // Full sentence form

    // Provenance
    sourceDocIds: v.array(v.string()),
    sourceSnippets: v.optional(v.array(v.string())),
    extractedAt: v.number(),

    // Boolean quality flags (no arbitrary scores)
    isHighConfidence: v.boolean(),
    isVerified: v.optional(v.boolean()),
    isOutdated: v.optional(v.boolean()),

    // Embedding for semantic similarity
    embedding: v.optional(v.array(v.float64())),

    createdAt: v.number(),
  })
    .index("by_graph", ["graphId"])
    .index("by_graph_subject", ["graphId", "subject"])
    .index("by_graph_predicate", ["graphId", "predicate"])
    .index("by_confidence", ["isHighConfidence"])
    .searchIndex("search_claims", {
      searchField: "claimText",
      filterFields: ["graphId", "isHighConfidence"],
    }),

  /* ------------------------------------------------------------------ */
  /* GRAPH EDGES - Relations between claims                              */
  /* ------------------------------------------------------------------ */
  graphEdges: defineTable({
    graphId: v.id("knowledgeGraphs"),
    fromClaimId: v.id("graphClaims"),
    toClaimId: v.id("graphClaims"),

    // Edge type
    edgeType: v.union(
      v.literal("supports"),
      v.literal("contradicts"),
      v.literal("mentions"),
      v.literal("causes"),
      v.literal("relatedTo"),
      v.literal("partOf"),
      v.literal("precedes"),
    ),

    // Strength (boolean, not score)
    isStrong: v.boolean(),

    // Provenance
    sourceDocId: v.optional(v.string()),

    createdAt: v.number(),
  })
    .index("by_graph", ["graphId"])
    .index("by_from", ["fromClaimId"])
    .index("by_to", ["toClaimId"])
    .index("by_type", ["edgeType"]),

  /* ------------------------------------------------------------------ */
  /* GRAPH CLUSTERS - HDBSCAN clustering results                         */
  /* ------------------------------------------------------------------ */
  graphClusters: defineTable({
    clusterId: v.string(), // UUID
    userId: v.id("users"),
    name: v.optional(v.string()), // Auto-generated or user label
    description: v.optional(v.string()),

    // Members
    memberGraphIds: v.array(v.id("knowledgeGraphs")),
    memberCount: v.number(),

    // Cluster fingerprint (centroid)
    centroidVector: v.optional(v.array(v.float64())),

    // One-Class SVM "soft hull" model reference
    svmModelRef: v.optional(v.string()),

    // Shared characteristics (for explainability)
    sharedPredicates: v.optional(v.array(v.string())),
    sharedSubjects: v.optional(v.array(v.string())),
    dominantSourceType: v.optional(v.string()),

    // Metadata
    algorithmUsed: v.optional(v.string()), // "hdbscan", "kmeans", etc.
    minClusterSize: v.optional(v.number()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_clusterId", ["clusterId"])
    .index("by_memberCount", ["memberCount"]),

  /* ------------------------------------------------------------------ */
  /* ARTIFACT RUN META - Sharded write mutex for artifact upserts       */
  /* Touched before every artifact write to serialize concurrent ops    */
  /* Sharded by artifactId hash to reduce contention (K=8 shards)       */
  /* ------------------------------------------------------------------ */
  artifactRunMeta: defineTable({
    runId: v.string(),
    shardId: v.optional(v.number()), // 0..K-1, where K=8 shards (optional for migration)
    bump: v.number(), // Incremented on every artifact write
    updatedAt: v.number(),
  })
    .index("by_run_shard", ["runId", "shardId"])
    .index("by_run", ["runId"]), // For maintenance scans

  /* ------------------------------------------------------------------ */
  /* ARTIFACT DEAD LETTERS - Failed persistence jobs for visibility     */
  /* ------------------------------------------------------------------ */
  artifactDeadLetters: defineTable({
    runId: v.string(),
    toolName: v.optional(v.string()),
    attempt: v.number(),
    errorType: v.union(
      v.literal("OCC"),
      v.literal("VALIDATION"),
      v.literal("EXTRACTOR"),
      v.literal("SCHEDULER"),
      v.literal("UNKNOWN"),
    ),
    errorMessage: v.string(), // Truncated to ~2KB
    artifactCount: v.number(),
    sampleUrls: v.array(v.string()), // Cap 3-5 URLs for debugging
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_createdAt", ["runId", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* ARTIFACT PERSIST JOBS - Idempotency tracking for scheduled jobs    */
  /* ------------------------------------------------------------------ */
  artifactPersistJobs: defineTable({
    runId: v.string(),
    idempotencyKey: v.string(),
    status: v.union(
      v.literal("started"),
      v.literal("done"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run_key", ["runId", "idempotencyKey"])
    .index("by_status_createdAt", ["status", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* ARTIFACT RUN STATS (SHARDED) - Observability counters per run      */
  /* Sharded to match mutex shards (K=8), avoiding new contention       */
  /* ------------------------------------------------------------------ */
  artifactRunStatsShards: defineTable({
    runId: v.string(),
    shardId: v.number(), // 0..K-1, matches mutex shards
    jobsScheduled: v.number(),
    jobsDeduped: v.number(),
    deadLetters: v.number(),
    occRetries: v.number(),
    noopsSkipped: v.number(),
    artifactsInserted: v.number(),
    artifactsPatched: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run_shard", ["runId", "shardId"])
    .index("by_run", ["runId"]),

  /* ------------------------------------------------------------------ */
  /* ARTIFACTS - First-class streaming artifacts for dossiers            */
  /* ------------------------------------------------------------------ */
  artifacts: defineTable({
    runId: v.string(), // agentThreadId - stable for whole dossier
    artifactId: v.string(), // Stable hash: art_<sha256_prefix>
    userId: v.id("users"),

    // Core (immutable after creation)
    kind: v.union(
      v.literal("url"),
      v.literal("file"),
      v.literal("video"),
      v.literal("image"),
      v.literal("document"),
    ),
    provider: v.optional(
      v.union(
        v.literal("youtube"),
        v.literal("sec"),
        v.literal("arxiv"),
        v.literal("news"),
        v.literal("web"),
        v.literal("local"),
      ),
    ),
    canonicalUrl: v.string(),

    // Display (mutable via enrich)
    title: v.string(),
    host: v.optional(v.string()),
    snippet: v.optional(v.string()),
    thumbnail: v.optional(v.string()),

    // Enrichment data (arrives later)
    transcript: v.optional(v.string()),
    pageRefs: v.optional(v.array(v.string())),

    // Metadata
    discoveredAt: v.number(),
    toolName: v.optional(v.string()),
    rev: v.number(), // Monotonic version for safe merges

    // Boolean flags (GAM philosophy)
    flags: v.object({
      hasThumbnail: v.boolean(),
      hasTranscript: v.boolean(),
      hasPageRefs: v.boolean(),
      isPinned: v.boolean(),
      isCited: v.boolean(),
      isEnriched: v.boolean(),
    }),

    // Verification health (light indicator, claim-specific verdicts in claimVerifications)
    verificationHealth: v.optional(
      v.union(
        v.literal("unknown"),
        v.literal("has_supported"), // At least one claim was supported
        v.literal("has_not_found"), // No claims found in source
        v.literal("has_contradicted"), // At least one claim was contradicted
      ),
    ),
    lastVerificationAt: v.optional(v.number()),

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // GLOBAL RESEARCH LEDGER: Sync fields for write-through
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /** Monotonic sequence number within run (for sync cursor) */
    seq: v.optional(v.number()),

    /** Query fingerprint if from a cached query */
    queryKey: v.optional(v.string()),

    /** Entity scope ("" if unscoped) */
    entityKey: v.optional(v.string()),

    /** Section this artifact was discovered in */
    sectionId: v.optional(v.string()),

    /** Provenance: only "tool" sources are eligible for global store */
    sourceType: v.optional(
      v.union(
        v.literal("tool"), // From GLOBAL_ARTIFACT_PRODUCERS (Linkup, SEC, etc.)
        v.literal("agent"), // Agent-generated (may be hallucinated)
        v.literal("user"), // User-provided
      ),
    ),

    /** Reference to global artifact (set after write-through) */
    globalArtifactKey: v.optional(v.string()),
  })
    .index("by_run", ["runId"])
    .index("by_run_artifact", ["runId", "artifactId"])
    .index("by_user_run", ["userId", "runId"])
    .index("by_user", ["userId"])
    .index("by_runId_seq", ["runId", "seq"]) // For write-through sync
    .index("by_createdAt", ["discoveredAt"]), // For diagnostics

  /* ------------------------------------------------------------------ */
  /* ARTIFACT LINKS - Artifact-to-section assignments                    */
  /* ------------------------------------------------------------------ */
  artifactLinks: defineTable({
    runId: v.string(),
    artifactId: v.string(),
    sectionId: v.string(),
    createdAt: v.number(),
  })
    .index("by_run_section", ["runId", "sectionId"])
    .index("by_run_artifact", ["runId", "artifactId"])
    .index("by_run", ["runId"]),

  /* ------------------------------------------------------------------ */
  /* EVIDENCE LINKS - Fact-to-artifact citations                         */
  /* ------------------------------------------------------------------ */
  evidenceLinks: defineTable({
    runId: v.string(),
    factId: v.string(),
    artifactIds: v.array(v.string()),
    createdAt: v.number(),
  })
    .index("by_run_fact", ["runId", "factId"])
    .index("by_run", ["runId"]),

  /* ------------------------------------------------------------------ */
  /* FACTS - Claim text from {{fact:...}} anchors                        */
  /* Stores the exact claim text for verification                        */
  /* ------------------------------------------------------------------ */
  facts: defineTable({
    runId: v.string(),
    factId: v.string(), // e.g., "funding_signals:etched_series_c"
    sectionKey: v.string(), // e.g., "funding_signals"
    claimText: v.string(), // The exact claim text to verify
    artifactIds: v.array(v.string()), // Linked evidence (from evidenceLinks)
    createdAt: v.number(),

    // Enhanced fields for Deep Agent intelligence layer
    confidence: v.optional(v.number()), // 0-1 scale based on source quality
    ttlDays: v.optional(v.number()), // Cache expiry in days
    snippetSpan: v.optional(
      v.object({
        // Where in source this was extracted
        startChar: v.number(),
        endChar: v.number(),
      }),
    ),
    sourceUrl: v.optional(v.string()), // Primary source URL
    retrievedAt: v.optional(v.number()), // When source was fetched
    contradictionFlag: v.optional(v.boolean()), // True if conflicts with other facts
    contradictingFactIds: v.optional(v.array(v.string())), // IDs of conflicting facts
  })
    .index("by_run", ["runId"])
    .index("by_run_fact", ["runId", "factId"])
    .index("by_run_section", ["runId", "sectionKey"])
    .index("by_confidence", ["confidence"])
    .index("by_contradiction", ["contradictionFlag"]),

  /* ------------------------------------------------------------------ */
  /* CLAIM VERIFICATIONS - LLM-as-a-judge verdicts per claim+artifact    */
  /* Keyed by (runId, factId, artifactId) for claim-specific verdicts    */
  /* ------------------------------------------------------------------ */
  claimVerifications: defineTable({
    runId: v.string(),
    factId: v.string(), // Links to facts table
    artifactId: v.string(), // Which artifact was checked

    // Verdict from LLM-as-a-judge
    verdict: v.union(
      v.literal("supported"), // Source explicitly states the claim
      v.literal("not_found"), // Source doesn't mention the claim
      v.literal("contradicted"), // Source contradicts the claim
      v.literal("inaccessible"), // Source is error page, paywall, blocked
    ),
    confidence: v.number(), // 0-1 confidence score
    explanation: v.optional(v.string()), // Short explanation (max 60 words)
    snippet: v.optional(v.string()), // Cached source excerpt for display

    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_fact", ["runId", "factId"])
    .index("by_artifact", ["artifactId"])
    .index("by_run_fact_artifact", ["runId", "factId", "artifactId"]),

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   * GLOBAL RESEARCH LEDGER
   * Shared research cache with append-only progression tracking.
   * See: convex/globalResearch/ for mutations/queries.
   * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

  /* ------------------------------------------------------------------ */
  /* GLOBAL ARTIFACTS - URL-deduplicated source store                    */
  /* One row per unique canonicalUrl across all users/runs               */
  /* ------------------------------------------------------------------ */
  globalArtifacts: defineTable({
    /** Deterministic key: "ga_" + sha256(canonicalUrl) */
    artifactKey: v.string(),
    canonicalUrl: v.string(),
    domain: v.string(), // Extracted host
    title: v.optional(v.string()),
    snippet: v.optional(v.string()),
    thumbnail: v.optional(v.string()),
    /** Hash of title+snippet for change detection */
    contentHash: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    seenCount: v.number(),
  })
    .index("by_artifactKey", ["artifactKey"])
    .index("by_canonicalUrl", ["canonicalUrl"]) // For dedupe cron
    .index("by_domain_lastSeenAt", ["domain", "lastSeenAt"])
    .index("by_lastSeenAt", ["lastSeenAt"]),

  /* ------------------------------------------------------------------ */
  /* GLOBAL QUERY CACHE - Simple TTL cache for search results            */
  /* MVP: Caches full response string; deduplication comes later         */
  /* ------------------------------------------------------------------ */
  globalQueryCache: defineTable({
    /** Deterministic: hash(query + toolName + params) */
    queryKey: v.string(),
    /** Full formatted response (ready to return) */
    cachedResponse: v.string(),
    /** Tool that produced this result */
    toolName: v.string(),
    /** When the cache was populated */
    completedAt: v.number(),
    /** TTL in ms (varies by query type) */
    ttlMs: v.number(),
  })
    .index("by_queryKey", ["queryKey"])
    .index("by_completedAt", ["completedAt"]), // For cleanup

  /* ------------------------------------------------------------------ */
  /* GLOBAL QUERIES - Query fingerprints for cache lookup                */
  /* ------------------------------------------------------------------ */
  globalQueries: defineTable({
    /** Deterministic key: "qk_" + hash(query + config + versions) */
    queryKey: v.string(),
    normalizedQuery: v.string(),
    toolName: v.string(),
    /** Frozen tool args (for debugging) */
    toolConfig: v.any(),
    /** Hash of toolConfig for reliable comparisons */
    toolConfigHash: v.string(),
    /** Tool version (e.g., "linkup-v2") */
    toolVersion: v.string(),
    /** Fingerprint algorithm version (bump when algo changes) */
    fingerprintVersion: v.number(),
    /**
     * Entity scope. Use "" for unscoped queries.
     * WARNING: Never query by_entityKey when entityKey === "" (hot partition).
     */
    entityKey: v.string(),
    /** Chosen TTL for this query type */
    ttlMs: v.number(),
    createdAt: v.number(),
  })
    .index("by_queryKey", ["queryKey"])
    // WARNING: Only use by_entityKey when entityKey !== ""
    .index("by_entityKey", ["entityKey"]),

  /* ------------------------------------------------------------------ */
  /* GLOBAL ARTIFACT MENTIONS - Append-only ledger of sightings          */
  /* Raw mentions kept 30 days, then compacted to globalMentionAgg       */
  /* ------------------------------------------------------------------ */
  globalArtifactMentions: defineTable({
    artifactKey: v.string(),
    queryKey: v.string(),
    /**
     * Entity scope. Use "" for unscoped.
     * WARNING: Never query by_entityKey_seenAt when entityKey === "".
     */
    entityKey: v.string(),
    seenAt: v.number(),
    toolName: v.string(),
    /** globalResearchRunId, "" if backfill */
    runId: v.string(),
    /** Section context, "" if none */
    sectionId: v.string(),
    rank: v.optional(v.number()),
    score: v.optional(v.number()),
  })
    .index("by_artifactKey_seenAt", ["artifactKey", "seenAt"])
    .index("by_queryKey_seenAt", ["queryKey", "seenAt"])
    // WARNING: Only use when entityKey !== ""
    .index("by_entityKey_seenAt", ["entityKey", "seenAt"])
    .index("by_seenAt", ["seenAt"]), // Retention cleanup

  /* ------------------------------------------------------------------ */
  /* GLOBAL MENTION AGGREGATES - Compacted daily summaries               */
  /* Prevents unbounded growth of raw mentions                           */
  /* ------------------------------------------------------------------ */
  globalMentionAgg: defineTable({
    /** Deterministic: hash(artifactKey + queryKey + dayBucket) */
    aggKey: v.string(),
    artifactKey: v.string(),
    queryKey: v.string(),
    /** Use "" for unscoped */
    entityKey: v.string(),
    /** Date bucket: "2024-01-15" */
    dayBucket: v.string(),
    mentionCount: v.number(),
    bestRank: v.optional(v.number()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_aggKey", ["aggKey"]) // Upsert lookup
    .index("by_queryKey_day", ["queryKey", "dayBucket"])
    // WARNING: Only use when entityKey !== ""
    .index("by_entityKey_day", ["entityKey", "dayBucket"])
    .index("by_artifactKey_day", ["artifactKey", "dayBucket"])
    .index("by_dayBucket", ["dayBucket"]), // "Top today" queries

  /* ------------------------------------------------------------------ */
  /* GLOBAL RESEARCH RUNS - Research job snapshots                       */
  /* Each run = one attempt to refresh a query's results                 */
  /* ------------------------------------------------------------------ */
  globalResearchRuns: defineTable({
    /** Unique run ID: "grr_" + uuid */
    researchRunId: v.string(),
    queryKey: v.string(),
    /**
     * Entity scope. Use "" for unscoped.
     * WARNING: Never query by_entityKey_* when entityKey === "".
     */
    entityKey: v.string(),
    status: v.union(
      v.literal("scheduled"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    /** Monotonic version per queryKey */
    version: v.number(),
    ttlMs: v.number(),
    /** startedAt + ttlMs (for cache expiry checks) */
    expiresAt: v.number(),
    /**
     * Always set (= scheduledAt initially, overwritten on start).
     * Used for reliable sorting since startedAt can be optional.
     */
    sortTs: v.number(),
    scheduledAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    artifactCount: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_researchRunId", ["researchRunId"])
    .index("by_queryKey_sortTs", ["queryKey", "sortTs"])
    .index("by_queryKey_status_sortTs", ["queryKey", "status", "sortTs"])
    // WARNING: Only use when entityKey !== ""
    .index("by_entityKey_sortTs", ["entityKey", "sortTs"])
    .index("by_status", ["status"])
    .index("by_expiresAt", ["expiresAt"]),

  /* ------------------------------------------------------------------ */
  /* GLOBAL RESEARCH EVENTS - Append-only changelog                      */
  /* Only the run-owner action writes events (prevents race conditions)  */
  /* ------------------------------------------------------------------ */
  globalResearchEvents: defineTable({
    researchRunId: v.string(),
    /** For dedup on read: hash(kind + artifactKey + version) */
    eventKey: v.string(),
    /** Monotonic within run */
    seq: v.number(),
    kind: v.union(
      v.literal("artifact_added"),
      v.literal("artifact_updated"),
      v.literal("artifact_removed"),
      v.literal("fact_extracted"),
      v.literal("run_started"),
      v.literal("run_completed"),
      v.literal("run_failed"),
    ),
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_runId_seq", ["researchRunId", "seq"])
    .index("by_createdAt", ["createdAt"]), // Retention

  /* ------------------------------------------------------------------ */
  /* GLOBAL QUERY LOCKS - Nonce-owned single-flight cache                */
  /* Prevents N concurrent users from running the same query N times     */
  /* ------------------------------------------------------------------ */
  globalQueryLocks: defineTable({
    queryKey: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    runId: v.string(),
    /** Random UUID for ownership verification */
    lockNonce: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    /** Default 10 minutes */
    staleAfterMs: v.number(),
  }).index("by_queryKey", ["queryKey"]),

  /* ------------------------------------------------------------------ */
  /* RESEARCH SUBSCRIPTIONS - User subscriptions for email digests       */
  /* ------------------------------------------------------------------ */
  researchSubscriptions: defineTable({
    userId: v.id("users"),
    subscriptionType: v.union(
      v.literal("entity"),
      v.literal("query"),
      v.literal("hashtag"),
    ),
    /** entityKey, queryKey, or hashtag */
    targetKey: v.string(),
    displayName: v.string(),
    frequency: v.union(
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("monthly"),
    ),
    deliveryMethod: v.union(v.literal("email"), v.literal("in_app")),
    /** Timezone for delivery (default "UTC") */
    timezone: v.string(),
    /** Hour of day for delivery (0-23, default 8) */
    deliveryHourLocal: v.number(),
    /** Max artifacts per digest (default 20) */
    maxItems: v.number(),
    /** Precomputed next send time (for efficient cron query) */
    nextDueAt: v.number(),
    lastSentAt: v.optional(v.number()),
    lastSeenVersion: v.optional(v.number()),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_active", ["userId", "isActive"])
    .index("by_nextDueAt_active", ["nextDueAt", "isActive"]),

  /* ------------------------------------------------------------------ */
  /* GLOBAL COMPACTION STATE - Singleton for incremental compaction      */
  /* ------------------------------------------------------------------ */
  globalCompactionState: defineTable({
    /** Singleton key: "mentions" | "artifacts" */
    compactionType: v.string(),
    /** Last processed seenAt timestamp */
    lastProcessedAt: v.number(),
    /** Stats for monitoring */
    lastRunAt: v.number(),
    mentionsCompacted: v.optional(v.number()),
    mentionsPurged: v.optional(v.number()),
    duplicatesMerged: v.optional(v.number()),
  }).index("by_type", ["compactionType"]),

  /* ------------------------------------------------------------------ */
  /* GLOBAL BACKFILL STATE - Resumable migration state                   */
  /* ------------------------------------------------------------------ */
  globalBackfillState: defineTable({
    backfillRunId: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("paused"),
      v.literal("completed"),
    ),
    /** Last processed run ID */
    lastRunId: v.optional(v.string()),
    /** Last processed seq within that run */
    lastSeq: v.optional(v.number()),
    processedCount: v.number(),
    eligibleCount: v.number(),
    startedAt: v.number(),
    lastUpdatedAt: v.number(),
  })
    .index("by_backfillRunId", ["backfillRunId"])
    .index("by_status", ["status"]),

  /* ------------------------------------------------------------------ */
  /* TOOL REGISTRY - Hybrid Search for Meta-Tool Discovery              */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* SKILLS REGISTRY - Multi-step workflow definitions (Anthropic spec)  */
  /* ------------------------------------------------------------------ */
  /**
   * Skills are pre-defined multi-step workflows that combine tools for common tasks.
   * Based on Anthropic's Skills specification (v1.0, October 2025).
   *
   * Skills follow the progressive disclosure pattern:
   * - searchAvailableSkills: Returns name + description (low tokens)
   * - describeSkill: Loads full instructions on-demand (high tokens)
   *
   * Format follows SKILL.md spec:
   * - name: hyphen-case unique identifier
   * - description: When to use this skill
   * - fullInstructions: Markdown workflow steps (loaded on-demand)
   */
  skills: defineTable({
    // Identity (Anthropic spec)
    name: v.string(), // Unique identifier (hyphen-case, e.g., "company-research")
    description: v.string(), // Brief description (shown in search results)

    // Content (loaded on-demand)
    fullInstructions: v.string(), // Full markdown body with workflow steps

    // Classification
    category: v.string(), // "research", "document", "media", "financial", "workflow"
    categoryName: v.string(), // Human-readable category name

    // Search support
    keywords: v.array(v.string()), // Keywords for keyword matching
    keywordsText: v.string(), // Joined keywords for BM25 search index

    // Vector embedding for semantic search (1536-dim OpenAI text-embedding-3-small)
    embedding: v.optional(v.array(v.float64())),

    // Anthropic spec optional fields
    license: v.optional(v.string()), // e.g., "Apache-2.0"
    allowedTools: v.optional(v.array(v.string())), // Pre-approved tools this skill uses
    metadata: v.optional(v.any()), // Custom metadata

    // L3 Nested Resources (Progressive Disclosure Level 3)
    // Resources are loaded on-demand when referenced in fullInstructions
    nestedResources: v.optional(
      v.array(
        v.object({
          name: v.string(), // Resource identifier (e.g., "examples", "keyword-table")
          type: v.union(
            v.literal("markdown"),
            v.literal("json"),
            v.literal("template"),
          ),
          uri: v.string(), // Resource URI (e.g., "./persona-inference-examples.md")
          tokensEstimate: v.optional(v.number()), // Estimated tokens when loaded
        }),
      ),
    ),

    // Skill Caching (avoid re-expanding unchanged skills)
    contentHash: v.optional(v.string()), // SHA-256 hash of fullInstructions
    version: v.optional(v.number()), // Monotonic version number

    // Usage tracking
    usageCount: v.number(), // Times this skill was used
    lastUsedAt: v.optional(v.number()), // Last usage timestamp

    // Status
    isEnabled: v.boolean(), // Whether skill is available

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_category", ["category"])
    .index("by_usage", ["usageCount"])
    .index("by_enabled", ["isEnabled"])
    .index("by_enabled_category", ["isEnabled", "category"])
    .index("by_content_hash", ["contentHash"]) // For skill caching
    .index("by_version", ["version"]) // For version tracking
    .searchIndex("search_description", {
      searchField: "description",
      filterFields: ["category", "isEnabled"],
    })
    .searchIndex("search_keywords", {
      searchField: "keywordsText",
      filterFields: ["category", "isEnabled"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["category", "isEnabled"],
    }),

  /**
   * Tracks individual skill usages for analytics
   */
  skillUsage: defineTable({
    skillName: v.string(), // Skill that was used
    queryText: v.string(), // Original search query
    wasSuccessful: v.boolean(), // Whether execution succeeded
    executionTimeMs: v.optional(v.number()),
    toolsInvoked: v.optional(v.array(v.string())), // Tools used during skill execution
    userId: v.optional(v.id("users")),
  })
    .index("by_skill", ["skillName"])
    .index("by_skill_success", ["skillName", "wasSuccessful"]),

  /**
   * Caches skill search results to reduce latency
   */
  skillSearchCache: defineTable({
    queryHash: v.string(), // Hash of normalized query
    queryText: v.string(), // Original query text
    category: v.optional(v.string()),
    results: v.array(
      v.object({
        skillName: v.string(),
        score: v.number(),
        matchType: v.string(),
      }),
    ),
    expiresAt: v.number(), // Unix timestamp for expiration
  })
    .index("by_hash", ["queryHash"])
    .index("by_expiry", ["expiresAt"]),

  /* ------------------------------------------------------------------ */
  /* TOOL REGISTRY - Atomic tool definitions                             */
  /* ------------------------------------------------------------------ */

  /**
   * Central catalog of all tools with BM25 + vector search capabilities
   */
  toolRegistry: defineTable({
    // Core identity
    toolName: v.string(), // Unique tool identifier (e.g., "createDocument")

    // Searchable content
    description: v.string(), // Full description for BM25 search
    keywords: v.array(v.string()), // Keywords for keyword matching
    keywordsText: v.string(), // Joined keywords for searchIndex

    // Classification
    category: v.string(), // Category key (e.g., "document", "media")
    categoryName: v.string(), // Human-readable category name

    // Module location
    module: v.string(), // Import path (e.g., "document/documentTools")

    // Optional enhancements
    examples: v.optional(v.array(v.string())), // Usage examples

    // Vector embedding for semantic search (1536-dim OpenAI text-embedding-3-small)
    embedding: v.optional(v.array(v.float64())),

    // Usage & ranking
    usageCount: v.number(), // Times this tool was invoked
    successRate: v.optional(v.number()), // Success rate 0-1
    avgExecutionMs: v.optional(v.number()), // Average execution time

    // Status
    isEnabled: v.boolean(), // Whether tool is available

    // Metadata
    metadata: v.optional(v.any()),
  })
    .index("by_toolName", ["toolName"])
    .index("by_category", ["category"])
    .index("by_usage", ["usageCount"])
    .index("by_enabled", ["isEnabled"])
    .index("by_enabled_category", ["isEnabled", "category"])
    .searchIndex("search_description", {
      searchField: "description",
      filterFields: ["category", "isEnabled"],
    })
    .searchIndex("search_keywords", {
      searchField: "keywordsText",
      filterFields: ["category", "isEnabled"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["category", "isEnabled"],
    }),

  /**
   * Tracks individual tool invocations for analytics and popularity ranking
   */
  toolUsage: defineTable({
    toolName: v.string(), // Tool that was invoked
    queryText: v.string(), // Original search query
    wasSuccessful: v.boolean(), // Whether execution succeeded
    executionTimeMs: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  })
    .index("by_tool", ["toolName"])
    .index("by_tool_success", ["toolName", "wasSuccessful"]),

  /**
   * Caches hybrid search results to reduce latency
   */
  toolSearchCache: defineTable({
    queryHash: v.string(), // SHA-256 hash of normalized query
    queryText: v.string(), // Original query text
    category: v.optional(v.string()),
    results: v.array(
      v.object({
        toolName: v.string(),
        score: v.number(),
        matchType: v.string(),
      }),
    ),
    expiresAt: v.number(), // Unix timestamp for expiration
  })
    .index("by_hash", ["queryHash"])
    .index("by_expiry", ["expiresAt"]),

  /* ------------------------------------------------------------------ */
  /* PUBLIC DOSSIERS - Daily AI-generated intelligence briefings        */
  /* No auth required - free for all users                              */
  /* ------------------------------------------------------------------ */
  publicDossiers: defineTable({
    sections: v.array(v.any()), // ScrollySection[] - JSON structure for scrollytelling
    topic: v.string(), // Topic/focus of the dossier (e.g., "AI Infrastructure")
    generatedAt: v.number(), // Unix timestamp when generated
    dateString: v.string(), // YYYY-MM-DD for easy querying
    version: v.number(), // Version number for same-day updates
  })
    .index("by_date", ["generatedAt"])
    .index("by_date_string", ["dateString"]),

  /* ------------------------------------------------------------------ */
  /* PUBLIC RESEARCH MEMORY - Entity registry and claim-level facts      */
  /* Apps may guide runs with private signals, but only public evidence  */
  /* and public claims are stored here.                                  */
  /* ------------------------------------------------------------------ */
  publicResearchEntities: defineTable({
    entityKey: v.string(), // Deterministic canonical key: "company:openai"
    entityType: v.union(
      v.literal("company"),
      v.literal("person"),
      v.literal("role"),
      v.literal("product"),
      v.literal("investor"),
      v.literal("school"),
      v.literal("source"),
    ),
    canonicalName: v.string(),
    normalizedName: v.string(),
    aliases: v.array(v.string()),
    domains: v.array(v.string()),
    siteUrls: v.array(v.string()),
    linkedinUrls: v.array(v.string()),
    githubUrls: v.array(v.string()),
    confidence: v.number(),
    status: v.union(v.literal("active"), v.literal("merged"), v.literal("needs_review")),
    mergeTargetEntityId: v.optional(v.id("publicResearchEntities")),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastResearchedAt: v.optional(v.number()),
    latestRunId: v.optional(v.string()),
  })
    .index("by_entityKey", ["entityKey"])
    .index("by_type_name", ["entityType", "normalizedName"])
    .index("by_updated", ["updatedAt"]),

  publicResearchClaims: defineTable({
    entityId: v.id("publicResearchEntities"),
    entityKey: v.string(),
    claim: v.string(),
    claimType: v.string(),
    sourceUrl: v.string(),
    sourceTitle: v.string(),
    evidenceSnippet: v.string(),
    retrievedAt: v.number(),
    contentHash: v.string(),
    confidence: v.number(),
    verifierStatus: v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("needs_review"),
      v.literal("rejected"),
      v.literal("contradicted"),
      v.literal("stale"),
    ),
    freshnessTtlMs: v.number(),
    contradictions: v.array(v.string()),
    sourceIsPublic: v.boolean(),
    privateBoundaryStatus: v.union(
      v.literal("clean"),
      v.literal("private_signal_stripped"),
      v.literal("blocked"),
    ),
    submittedBySurface: v.optional(v.string()),
    researchRunId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity_updated", ["entityKey", "updatedAt"])
    .index("by_entity_claim_hash", ["entityKey", "contentHash"])
    .index("by_verifier", ["verifierStatus"])
    .index("by_updated", ["updatedAt"]),

  publicResearchRuns: defineTable({
    researchRunId: v.string(),
    entityId: v.optional(v.id("publicResearchEntities")),
    entityKey: v.string(),
    entityName: v.string(),
    kind: v.union(
      v.literal("company"),
      v.literal("person"),
      v.literal("role"),
      v.literal("product"),
      v.literal("investor"),
      v.literal("school"),
      v.literal("source"),
    ),
    goal: v.string(),
    visibility: v.union(v.literal("public"), v.literal("private_guided")),
    status: v.union(
      v.literal("queued"),
      v.literal("searching"),
      v.literal("extracting"),
      v.literal("verifying"),
      v.literal("ready"),
      v.literal("needs_review"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    steps: v.array(
      v.object({
        name: v.string(),
        status: v.union(v.literal("queued"), v.literal("running"), v.literal("done"), v.literal("failed")),
        at: v.number(),
        note: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
    claimCount: v.number(),
    sourceCount: v.number(),
    error: v.optional(v.string()),
  })
    .index("by_researchRunId", ["researchRunId"])
    .index("by_entity_updated", ["entityKey", "updatedAt"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_updated", ["updatedAt"]),

  publicResearchPrivateLinks: defineTable({
    entityId: v.id("publicResearchEntities"),
    entityKey: v.string(),
    ownerKey: v.string(),
    privateSignalKind: v.string(),
    privateSignalHash: v.string(),
    publicPurpose: v.string(),
    createdAt: v.number(),
  })
    .index("by_owner_entity", ["ownerKey", "entityKey"])
    .index("by_entity", ["entityKey"]),

  /* ------------------------------------------------------------------ */
  /* DAILY BRIEF SNAPSHOTS - Automated morning dashboard metrics        */
  /* Generated daily at 6:00 AM UTC from aggregated feed data           */
  /* ------------------------------------------------------------------ */
  dailyBriefSnapshots: defineTable({
    dateString: v.string(), // YYYY-MM-DD for easy querying
    generatedAt: v.number(), // Unix timestamp when generated

    // Dashboard metrics for StickyDashboard component
    dashboardMetrics: v.object({
      meta: v.object({
        currentDate: v.string(),
        timelineProgress: v.number(),
      }),
      charts: v.object({
        trendLine: v.any(), // TrendLineConfig
        marketShare: v.array(v.any()), // MarketShareSegment[]
      }),
      techReadiness: v.object({
        existing: v.number(),
        emerging: v.number(),
        sciFi: v.number(),
      }),
      keyStats: v.array(v.any()), // KeyStat[]
      capabilities: v.array(v.any()), // CapabilityEntry[]
      annotations: v.optional(v.array(v.any())),
      agentCount: v.optional(
        v.object({
          count: v.number(),
          label: v.string(),
          speed: v.number(),
        }),
      ),
      entityGraph: v.optional(
        v.object({
          focusNodeId: v.optional(v.string()),
          nodes: v.array(
            v.object({
              id: v.string(),
              label: v.string(),
              type: v.optional(v.string()),
              importance: v.optional(v.number()),
              tier: v.optional(v.number()),
            }),
          ),
          edges: v.array(
            v.object({
              source: v.string(),
              target: v.string(),
              relationship: v.optional(v.string()),
              context: v.optional(v.string()),
              impact: v.optional(v.string()),
              order: v.optional(
                v.union(v.literal("primary"), v.literal("secondary")),
              ),
            }),
          ),
        }),
      ),
    }),

    // Source data summary
    sourceSummary: v.object({
      totalItems: v.number(),
      bySource: v.any(), // { "HackerNews": 15, "GitHub": 20, ... }
      byCategory: v.any(), // { "ai_ml": 25, "tech": 10, ... }
      topTrending: v.array(v.string()), // Top 5 trending topics
    }),

    // Generation metadata
    version: v.number(), // Version number for same-day updates
    processingTimeMs: v.optional(v.number()),
    errors: v.optional(v.array(v.string())),
  })
    .index("by_date_string", ["dateString"])
    .index("by_generated_at", ["generatedAt"]),

  /* ------------------------------------------------------------------ */
  /* DAILY BRIEF DOMAIN MEMORY - Two-agent persistent backlog/state     */
  /* Derived from dailyBriefSnapshots and advanced by worker agent      */
  /* ------------------------------------------------------------------ */
  dailyBriefMemories: defineTable({
    snapshotId: v.id("dailyBriefSnapshots"),
    dateString: v.string(), // YYYY-MM-DD
    generatedAt: v.number(), // Mirrors snapshot.generatedAt
    version: v.number(), // Mirrors snapshot.version

    goal: v.string(), // High-level daily objective

    features: v.array(
      v.object({
        id: v.string(),
        type: v.string(), // e.g. "repo_analysis", "paper_summary"
        name: v.string(),
        status: v.union(
          v.literal("pending"),
          v.literal("failing"),
          v.literal("passing"),
        ),
        priority: v.optional(v.number()),
        testCriteria: v.string(),
        sourceRefs: v.optional(v.any()), // Links to feed items/repos/papers/docs/charts
        notes: v.optional(v.string()),
        resultId: v.optional(v.id("dailyBriefTaskResults")),
        updatedAt: v.number(),
      }),
    ),

    progressLog: v.array(
      v.object({
        ts: v.number(),
        status: v.union(
          v.literal("info"),
          v.literal("pending"),
          v.literal("working"),
          v.literal("passing"),
          v.literal("failing"),
          v.literal("error"),
        ),
        message: v.string(),
        meta: v.optional(v.any()),
      }),
    ),

    context: v.any(), // Compacted machine-readable context bundle

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_snapshot", ["snapshotId"])
    .index("by_date_string", ["dateString"])
    .index("by_generated_at", ["generatedAt"]),

  /* ------------------------------------------------------------------ */
  /* DAILY BRIEF TASK RESULTS - Artifacts produced by worker tasks      */
  /* ------------------------------------------------------------------ */
  dailyBriefTaskResults: defineTable({
    memoryId: v.id("dailyBriefMemories"),
    taskId: v.string(),
    resultMarkdown: v.string(),
    citations: v.optional(v.any()),
    artifacts: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_memory", ["memoryId"])
    .index("by_task", ["taskId"]),

  /* ------------------------------------------------------------------ */
  /* REPORT TOPOLOGY SNAPSHOTS - Derived graph shape for UI + agents     */
  /* Density/PCA/centroid projections over bounded report neighborhoods  */
  /* ------------------------------------------------------------------ */
  reportTopologySnapshots: defineTable({
    snapshotKey: v.string(),
    rootKey: v.string(),
    view: v.union(v.literal("density"), v.literal("pca"), v.literal("centroid")),
    mode: v.union(v.literal("focus"), v.literal("clustered"), v.literal("expanded")),
    graphHash: v.string(),
    generatedAt: v.number(),
    expiresAt: v.number(),
    nodeCount: v.number(),
    edgeCount: v.number(),
    clusterCount: v.number(),
    snapshot: v.any(),
  })
    .index("by_snapshot_key", ["snapshotKey"])
    .index("by_root_view", ["rootKey", "view"])
    .index("by_generated_at", ["generatedAt"]),

  /* ------------------------------------------------------------------ */
  /* DAILY BRIEF PERSONAL OVERLAYS - Per-user derived tasks/state        */
  /* Built from tracked hashtags, docs, teachings                        */
  /* ------------------------------------------------------------------ */
  dailyBriefPersonalOverlays: defineTable({
    userId: v.id("users"),
    memoryId: v.id("dailyBriefMemories"),
    dateString: v.string(),

    features: v.array(
      v.object({
        id: v.string(),
        type: v.string(),
        name: v.string(),
        status: v.union(
          v.literal("pending"),
          v.literal("failing"),
          v.literal("passing"),
        ),
        priority: v.optional(v.number()),
        testCriteria: v.string(),
        sourceRefs: v.optional(v.any()),
        notes: v.optional(v.string()),
        resultMarkdown: v.optional(v.string()),
        updatedAt: v.number(),
      }),
    ),

    progressLog: v.array(
      v.object({
        ts: v.number(),
        status: v.union(
          v.literal("info"),
          v.literal("pending"),
          v.literal("working"),
          v.literal("passing"),
          v.literal("failing"),
          v.literal("error"),
        ),
        message: v.string(),
        meta: v.optional(v.any()),
      }),
    ),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_memory", ["userId", "memoryId"])
    .index("by_user_date", ["userId", "dateString"]),

  /* ------------------------------------------------------------------ */
  /* LLM USAGE TRACKING - Daily aggregates for rate limiting            */
  /* ------------------------------------------------------------------ */
  llmUsageDaily: defineTable({
    userId: v.id("users"),
    date: v.string(), // YYYY-MM-DD
    requests: v.number(), // Total requests today
    totalTokens: v.number(), // Total tokens (input + output)
    inputTokens: v.number(), // Total input tokens
    outputTokens: v.number(), // Total output tokens
    cachedTokens: v.number(), // Cached input tokens (discounted)
    totalCost: v.number(), // Total cost in USD
    successCount: v.number(), // Successful requests
    errorCount: v.number(), // Failed requests
    providers: v.optional(v.any()), // { openai: 5, anthropic: 3 }
    models: v.optional(v.any()), // { "gpt-5.4": 3, "claude-sonnet-4": 2 }
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_date", ["userId", "date"])
    .index("by_date", ["date"]),

  /* ------------------------------------------------------------------ */
  /* ANONYMOUS USAGE - Daily limits for unauthenticated users (5/day)   */
  /* ------------------------------------------------------------------ */
  anonymousUsageDaily: defineTable({
    sessionId: v.string(), // Browser fingerprint/session ID
    ipHash: v.optional(v.string()), // Hashed IP for additional tracking
    date: v.string(), // YYYY-MM-DD
    requests: v.number(), // Requests made today (max 5)
    totalTokens: v.number(), // Tokens used
    totalCost: v.number(), // Cost incurred
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_date", ["sessionId", "date"])
    .index("by_date", ["date"]),

  /* ------------------------------------------------------------------ */
  /* LLM USAGE LOG - Detailed per-request log for analytics             */
  /* ------------------------------------------------------------------ */
  llmUsageLog: defineTable({
    userId: v.id("users"),
    timestamp: v.number(),
    model: v.string(), // e.g., "gpt-5.4", "claude-sonnet-4"
    provider: v.string(), // "openai", "anthropic", "gemini"
    inputTokens: v.number(),
    outputTokens: v.number(),
    cachedTokens: v.number(),
    cost: v.number(), // Cost in USD
    latencyMs: v.optional(v.number()),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_timestamp", ["userId", "timestamp"])
    .index("by_model", ["model"])
    .index("by_provider", ["provider"]),

  /* ------------------------------------------------------------------ */
  /* SEARCH RUNS - Observability for multi-source search fusion          */
  /* ------------------------------------------------------------------ */
  searchRuns: defineTable({
    userId: v.optional(v.id("users")),
    threadId: v.optional(v.string()), // Agent thread ID if from agent
    query: v.string(), // The search query
    mode: v.string(), // "fast" | "balanced" | "comprehensive"
    sourcesRequested: v.array(v.string()), // Sources requested
    sourcesQueried: v.array(v.string()), // Sources actually queried
    totalResults: v.number(), // Total results after fusion
    totalBeforeFusion: v.number(), // Total results before fusion
    reranked: v.boolean(), // Whether LLM reranking was applied
    totalTimeMs: v.number(), // Total execution time
    cacheHit: v.optional(v.boolean()), // Whether cache was hit
    timestamp: v.number(), // When search was executed
    fusedResultIds: v.optional(v.array(v.string())), // IDs of fused results
  })
    .index("by_user", ["userId"])
    .index("by_user_timestamp", ["userId", "timestamp"])
    .index("by_timestamp", ["timestamp"])
    .index("by_mode", ["mode"])
    .index("by_thread", ["threadId"]),

  /* ------------------------------------------------------------------ */
  /* SEARCH RUN RESULTS - Per-source results for each search run         */
  /* ------------------------------------------------------------------ */
  searchRunResults: defineTable({
    searchRunId: v.id("searchRuns"), // Reference to parent search run
    source: v.string(), // "linkup" | "youtube" | "arxiv" etc.
    latencyMs: v.number(), // Time taken for this source
    resultCount: v.number(), // Number of results from this source
    success: v.boolean(), // Whether source search succeeded
    errorMessage: v.optional(v.string()), // Error message if failed
    resultIds: v.optional(v.array(v.string())), // IDs of results from this source
  })
    .index("by_search_run", ["searchRunId"])
    .index("by_source", ["source"])
    .index("by_source_success", ["source", "success"]),

  /* ------------------------------------------------------------------ */
  /* SEARCH QUOTA USAGE - FREE-FIRST tracking per provider               */
  /* ------------------------------------------------------------------ */
  searchQuotaUsage: defineTable({
    provider: v.string(), // "brave" | "serper" | "tavily" | "exa" | "linkup"
    monthKey: v.string(), // "2026-01" format for monthly reset
    usedQueries: v.number(), // Count of queries used this month
    successfulQueries: v.optional(v.number()),
    failedQueries: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    totalResponseTimeMs: v.optional(v.number()),
  })
    .index("by_provider", ["provider"])
    .index("by_provider_month", ["provider", "monthKey"])
    .index("by_month", ["monthKey"]),

  /* ------------------------------------------------------------------ */
  /* SEARCH FUSION CACHE - TTL-based cache for fusion search results     */
  /* ------------------------------------------------------------------ */
  searchFusionCache: defineTable({
    cacheKey: v.string(), // hash(query + sources + mode + userId)
    query: v.string(), // Original query
    mode: v.string(), // Search mode
    sources: v.array(v.string()), // Sources queried
    results: v.string(), // JSON-stringified results
    resultCount: v.number(), // Number of results
    createdAt: v.number(), // When cache entry was created
    expiresAt: v.number(), // When cache expires
    hitCount: v.optional(v.number()), // Number of times cache was hit
  })
    .index("by_cache_key", ["cacheKey"])
    .index("by_expires_at", ["expiresAt"])
    .index("by_query", ["query"]),

  /* ------------------------------------------------------------------ */
  /* DIGEST SUMMARY CACHE - Cached AI-generated digest summaries        */
  /* Avoids regenerating LLM summary on every component mount           */
  /* ------------------------------------------------------------------ */
  digestSummaryCache: defineTable({
    dateString: v.string(), // YYYY-MM-DD
    userId: v.optional(v.id("users")), // Optional: per-user personalization
    summary: v.string(), // AI-generated summary text
    dataHash: v.string(), // Hash of input data (for invalidation)
    generatedAt: v.number(), // When summary was generated
    expiresAt: v.number(), // TTL expiration (4 hours from generation)
    hitCount: v.optional(v.number()), // Cache hit counter
  })
    .index("by_date", ["dateString"])
    .index("by_date_user", ["dateString", "userId"])
    .index("by_expires_at", ["expiresAt"]),

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   * FUNDING INTELLIGENCE LAYER
   * Deep Agent + Linkup API integration for banker-grade entity enrichment
   * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

  /* ------------------------------------------------------------------ */
  /* FUNDING EVENTS - First-class funding round records with evidence    */
  /* Supports Seed/Series A separation and persona-aware digest          */
  /* ------------------------------------------------------------------ */
  fundingEvents: defineTable({
    // Core identifiers
    companyName: v.string(),
    companyId: v.optional(v.id("entityContexts")), // Link to enriched entity

    // Funding details
    roundType: v.union(
      v.literal("pre-seed"),
      v.literal("seed"),
      v.literal("series-a"),
      v.literal("series-b"),
      v.literal("series-c"),
      v.literal("series-d-plus"),
      v.literal("growth"),
      v.literal("debt"),
      v.literal("unknown"),
    ),
    amountUsd: v.optional(v.number()), // Normalized to USD cents
    amountRaw: v.string(), // Original "$50M" string
    announcedAt: v.number(), // Unix timestamp of announcement

    // Investors
    leadInvestors: v.array(v.string()),
    coInvestors: v.optional(v.array(v.string())),

    // Sources & confidence (evidence-backed)
    sourceUrls: v.array(v.string()),
    sourceNames: v.array(v.string()),
    confidence: v.number(), // 0-1 scale
    verificationStatus: v.union(
      v.literal("unverified"),
      v.literal("single-source"),
      v.literal("multi-source"),
      v.literal("verified"),
    ),

    // Additional context
    sector: v.optional(v.string()),
    location: v.optional(v.string()),
    description: v.optional(v.string()),
    valuation: v.optional(v.string()),

    // Use of Proceeds - Enhanced structured format (2026-01-21)
    useOfProceeds: v.optional(
      v.union(
        v.string(), // Legacy: simple string format
        v.object({
          // Allocation breakdown
          categories: v.array(
            v.object({
              category: v.string(), // "R&D", "Sales & Marketing", "Hiring", etc.
              percentage: v.optional(v.number()), // 0-100
              amount: v.optional(v.number()), // USD cents
              description: v.optional(v.string()),
            }),
          ),

          // Milestone-based tranches
          milestones: v.optional(
            v.array(
              v.object({
                milestone: v.string(), // "Launch enterprise tier", "FDA approval"
                fundingTranche: v.optional(v.number()), // USD cents to be released
                targetDate: v.optional(v.string()), // ISO date or "Q2 2026"
                description: v.optional(v.string()),
              }),
            ),
          ),

          // Source & confidence
          source: v.union(
            v.literal("SEC filing"),
            v.literal("press release"),
            v.literal("company statement"),
            v.literal("inferred"),
            v.literal("unknown"),
          ),
          confidence: v.number(), // 0-1

          // Summary for display
          summary: v.optional(v.string()), // Human-readable summary
        }),
      ),
    ),

    // Lifecycle
    ttlDays: v.number(), // Cache expiry in days
    createdAt: v.number(),
    updatedAt: v.number(),

    // Linking to other tables
    feedItemIds: v.optional(v.array(v.id("feedItems"))),
    factIds: v.optional(v.array(v.string())), // Links to facts table
  })
    .index("by_company", ["companyName", "roundType"])
    .index("by_companyId", ["companyId"])
    .index("by_announcedAt", ["announcedAt"])
    .index("by_roundType_announcedAt", ["roundType", "announcedAt"])
    .index("by_confidence", ["confidence"])
    .index("by_verificationStatus", ["verificationStatus"])
    .index("by_createdAt", ["createdAt"])
    .searchIndex("search_company", {
      searchField: "companyName",
      filterFields: ["roundType", "verificationStatus"],
    }),

  /* ------------------------------------------------------------------ */
  /* ENRICHMENT JOBS - Durable job tracking for workpool-based enrichment*/
  /* Supports high-priority (digest) and backfill pools                  */
  /* ------------------------------------------------------------------ */
  enrichmentJobs: defineTable({
    // Job identification
    jobId: v.string(), // UUID for deduplication
    jobType: v.union(
      v.literal("funding_detection"),
      v.literal("entity_promotion"),
      v.literal("full_article_fetch"),
      v.literal("structured_search"),
      v.literal("verification"),
      v.literal("persona_evaluation"),
    ),

    // Status tracking
    status: v.union(
      v.literal("pending"),
      v.literal("queued"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("retrying"),
    ),

    // Priority (higher = more urgent, 100 = digest-critical, 50 = backfill)
    priority: v.number(),

    // Retry handling
    attempts: v.number(),
    maxAttempts: v.number(),
    lastError: v.optional(v.string()),
    nextRetryAt: v.optional(v.number()),

    // Payload
    inputPayload: v.any(), // Job-specific input
    outputPayload: v.optional(v.any()), // Job-specific output

    // Relationships
    targetEntityId: v.optional(v.id("entityContexts")),
    targetFeedItemId: v.optional(v.id("feedItems")),
    sourceFundingEventId: v.optional(v.id("fundingEvents")),

    // Timing
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),

    // Workpool tracking
    poolName: v.optional(v.string()), // "highPriority" | "backfill"
    workpoolJobId: v.optional(v.string()),
  })
    .index("by_status", ["status", "priority"])
    .index("by_type_status", ["jobType", "status"])
    .index("by_targetEntity", ["targetEntityId"])
    .index("by_targetFeedItem", ["targetFeedItemId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_jobId", ["jobId"]),

  /* ------------------------------------------------------------------ */
  /* BENCHMARK HARNESS - Deterministic evaluation & regression testing  */
  /* ------------------------------------------------------------------ */

  /**
   * Benchmark task definitions - the golden dataset of test cases.
   * Each task represents a deterministic, reproducible test scenario.
   */
  benchmarkTasks: defineTable({
    taskId: v.string(), // Unique task identifier (e.g., "sec_10k_retrieval_01")
    suite: v.string(), // Suite name: "banking_memo", "social_factcheck", "mcp_smoke"
    name: v.string(), // Human-readable name
    description: v.optional(v.string()),

    // Task configuration
    taskType: v.union(
      v.literal("sec_retrieval"), // SEC filing retrieval
      v.literal("memo_generation"), // Banking memo workflow
      v.literal("instagram_ingestion"), // Instagram post ingestion
      v.literal("claim_extraction"), // Claim extraction from content
      v.literal("citation_validation"), // Citation integrity check
      v.literal("tool_health"), // Tool availability check
      v.literal("artifact_replay"), // Artifact idempotency check
    ),
    inputPayload: v.any(), // Task-specific input parameters

    // Expected outcomes (for validation)
    expectations: v.object({
      minArtifacts: v.optional(v.number()), // Minimum artifact count
      requiredFields: v.optional(v.array(v.string())),
      maxLatencyMs: v.optional(v.number()), // Performance threshold
      successRequired: v.boolean(), // Must succeed to pass
      idempotent: v.optional(v.boolean()), // Should produce same result on re-run
    }),

    // Metadata
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    isActive: v.boolean(),
    priority: v.optional(v.number()), // Execution order priority
  })
    .index("by_taskId", ["taskId"])
    .index("by_suite", ["suite"])
    .index("by_type", ["taskType"])
    .index("by_active", ["isActive"]),

  /**
   * Benchmark runs - execution of a suite of tasks.
   */
  benchmarkRuns: defineTable({
    runId: v.string(), // Unique run identifier
    suite: v.string(), // Suite being run
    triggeredBy: v.optional(v.string()), // "manual" | "ci" | "scheduled"
    gitCommit: v.optional(v.string()), // Git commit hash for traceability

    // Status tracking
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),

    // Task tracking
    totalTasks: v.number(),
    completedTasks: v.number(),
    passedTasks: v.number(),
    failedTasks: v.number(),

    // Aggregate metrics
    totalLatencyMs: v.optional(v.number()),
    avgLatencyMs: v.optional(v.number()),

    // Timestamps
    startedAt: v.number(),
    completedAt: v.optional(v.number()),

    // Error summary
    errors: v.optional(
      v.array(
        v.object({
          taskId: v.string(),
          error: v.string(),
        }),
      ),
    ),
  })
    .index("by_runId", ["runId"])
    .index("by_suite", ["suite"])
    .index("by_status", ["status"])
    .index("by_started", ["startedAt"]),

  /**
   * Benchmark scores - individual task results within a run.
   */
  benchmarkScores: defineTable({
    runId: v.string(), // Parent benchmark run
    taskId: v.string(), // Task that was executed
    suite: v.string(), // Suite for filtering

    // Execution result
    passed: v.boolean(),
    latencyMs: v.number(),

    // Validation details
    validationResults: v.object({
      artifactCountValid: v.optional(v.boolean()),
      requiredFieldsPresent: v.optional(v.boolean()),
      latencyWithinThreshold: v.optional(v.boolean()),
      idempotencyVerified: v.optional(v.boolean()),
      customChecks: v.optional(
        v.array(
          v.object({
            name: v.string(),
            passed: v.boolean(),
            message: v.optional(v.string()),
          }),
        ),
      ),
    }),

    // Artifacts produced (for traceability)
    artifactIds: v.optional(v.array(v.id("sourceArtifacts"))),

    // Raw output (for debugging)
    outputPreview: v.optional(v.string()), // First 500 chars of output
    error: v.optional(v.string()),

    // Timestamps
    executedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_task", ["taskId"])
    .index("by_suite_passed", ["suite", "passed"])
    .index("by_executed", ["executedAt"]),

  /* ------------------------------------------------------------------ */
  /* WORKBENCH RUNS - Cross-model benchmark on frozen app substrates     */
  /* NBW Phase 1 schema â€” execution engine wired in Phase 2             */
  /* NOTE for Codex: Phase 2 will add appSubstrateId FK once the        */
  /*   workbenchApps table is created. Keep this table minimal for now. */
  /* ------------------------------------------------------------------ */
  workbenchRuns: defineTable({
    // Identity
    model: v.string(), // "claude-sonnet-4-6", "gpt-4o", "gemini-3.1-flash-lite-preview"
    provider: v.string(), // "anthropic" | "openai" | "google" | "open-source"
    scenarioId: v.string(), // "ui-transform" | "agent-integration" | "long-run-reliability" | "architect-mode"
    appSubstrate: v.string(), // Frozen repo slug, e.g. "chef-todo-v1"

    // Execution state
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),

    // Scoring (multi-layer rubric, matches QA pipeline layers)
    compositeScore: v.optional(v.number()), // 0-100 weighted composite
    layer0Score: v.optional(v.number()), // Design compliance (static analysis)
    layer1Score: v.optional(v.number()), // Deterministic (build, tests, runtime)
    layer2Score: v.optional(v.number()), // Severity rubric (LLM judge)
    layer3Score: v.optional(v.number()), // Taste (visual quality)
    grade: v.optional(v.string()), // "A" | "B" | "C" | "D" | "F"

    // Operational metrics
    runDurationMs: v.optional(v.number()), // Wall-clock ms for the full run
    toolCallCount: v.optional(v.number()), // Total MCP tool calls made
    costUsd: v.optional(v.number()), // Estimated API cost for the run

    // Artifacts produced (for traceability, Phase 2+)
    artifactIds: v.optional(v.array(v.string())),

    // Timestamps
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_model", ["model"])
    .index("by_scenario", ["scenarioId"])
    .index("by_started", ["startedAt"]),

  /* ------------------------------------------------------------------ */
  /* ACTION DRAFTS - Write operation confirmation flow (P2 enforcement)  */
  /* Enables risk tier gating for write/destructive tool calls           */
  /* ------------------------------------------------------------------ */
  actionDrafts: defineTable({
    // Identity
    sessionId: v.string(), // Conversation/batch session
    userId: v.optional(v.id("users")),

    // Action details
    toolName: v.string(), // Tool that would be invoked
    args: v.string(), // JSON-stringified arguments
    riskTier: v.union(v.literal("write"), v.literal("destructive")),
    actionSummary: v.string(), // Human-readable summary

    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("denied"),
      v.literal("expired"),
    ),

    // Timestamps
    createdAt: v.number(),
    expiresAt: v.number(), // 5 minute default
    confirmedAt: v.optional(v.number()),
    deniedAt: v.optional(v.number()),
    expiredAt: v.optional(v.number()),

    // Denial reason
    denyReason: v.optional(v.string()),

    // Execution result (after confirmation)
    executedAt: v.optional(v.number()),
    result: v.optional(v.string()), // JSON-stringified result
    error: v.optional(v.string()),
  })
    .index("by_session", ["sessionId", "createdAt"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_status", ["status", "createdAt"])
    .index("by_expiry", ["expiresAt"]),

  /* ================================================================== */
  /* AUTONOMOUS AGENT ECOSYSTEM - Deep Agents 3.0                       */
  /* Implements zero-human-input continuous intelligence platform        */
  /* ================================================================== */

  /* ------------------------------------------------------------------ */
  /* SIGNALS - Ingested signals from feeds, webhooks, mentions          */
  /* ------------------------------------------------------------------ */
  signals: defineTable({
    // Signal source metadata
    source: v.string(), // "cron" | "rss" | "webhook" | "event" | "mention"
    sourceType: v.string(), // Specific source identifier (e.g., "hackernews", "arxiv")
    sourceUrl: v.optional(v.string()), // URL if applicable (RSS feed, webhook endpoint)

    // Content
    rawContent: v.string(), // Raw signal content
    title: v.optional(v.string()), // Signal title if available
    contentHash: v.string(), // SHA-256 hash for deduplication

    // Processing status
    processedAt: v.optional(v.number()), // When signal was processed
    processingStatus: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("processed"),
      v.literal("failed"),
      v.literal("skipped"), // Skipped due to deduplication
    ),

    // Extracted information
    extractedEntities: v.optional(v.array(v.string())), // NER extracted entities
    suggestedPersonas: v.optional(v.array(v.string())), // Persona IDs relevant to this signal

    // Urgency classification
    urgency: v.optional(
      v.union(
        v.literal("critical"), // Immediate action required
        v.literal("high"), // Same-day attention
        v.literal("medium"), // This week
        v.literal("low"), // When convenient
      ),
    ),

    // Research depth estimation
    estimatedResearchDepth: v.optional(
      v.union(
        v.literal("shallow"), // Quick lookup
        v.literal("standard"), // Normal research
        v.literal("deep"), // Comprehensive analysis
      ),
    ),

    // Error tracking
    errorMessage: v.optional(v.string()),
    retryCount: v.optional(v.number()),

    // Timestamps
    createdAt: v.number(),
    expiresAt: v.optional(v.number()), // TTL for cleanup
  })
    .index("by_processed", ["processedAt"])
    .index("by_status", ["processingStatus"])
    .index("by_source", ["source", "createdAt"])
    .index("by_contentHash", ["contentHash"])
    .index("by_urgency", ["urgency", "createdAt"])
    .index("by_expires", ["expiresAt"]),

  /* ------------------------------------------------------------------ */
  /* RESEARCH TASKS - Priority queue for autonomous research            */
  /* ------------------------------------------------------------------ */
  researchTasks: defineTable({
    // Entity identification
    entityId: v.string(), // Entity to research
    entityType: v.optional(v.string()), // "company" | "person" | "topic" | "product" | "event"
    entityName: v.optional(v.string()), // Human-readable name

    // Persona configuration
    personas: v.array(v.string()), // Persona IDs to apply
    primaryPersona: v.optional(v.string()), // Lead persona for this research

    // Priority calculation
    priority: v.number(), // 0-100, higher = more urgent
    priorityFactors: v.optional(
      v.object({
        urgencyBoost: v.optional(v.number()), // From signal urgency
        stalenessBoost: v.optional(v.number()), // From entity decay
        watchlistBoost: v.optional(v.number()), // From user watchlists
        trendingBoost: v.optional(v.number()), // From engagement spike
      }),
    ),

    // Status tracking
    status: v.union(
      v.literal("queued"), // Waiting for execution
      v.literal("researching"), // Active research underway
      v.literal("validating"), // Self-question validation
      v.literal("publishing"), // Queued for delivery
      v.literal("completed"), // Successfully finished
      v.literal("failed"), // Terminal failure
      v.literal("cancelled"), // User/system cancelled
    ),

    // Execution tracking
    swarmId: v.optional(v.string()), // Associated swarm if running
    qualityScore: v.optional(v.number()), // 0-100 from validation
    validationPassed: v.optional(v.boolean()), // Did it pass self-question?
    validationIssues: v.optional(
      v.array(
        v.object({
          type: v.string(), // "factual" | "freshness" | "completeness" | "grounding" | "contradiction"
          severity: v.string(), // "blocker" | "warning" | "info"
          description: v.string(),
        }),
      ),
    ),

    // Source tracking
    signalId: v.optional(v.id("signals")), // Signal that triggered this task
    triggeredBy: v.optional(
      v.union(
        v.literal("signal"), // From signal ingestion
        v.literal("decay"), // From staleness detection
        v.literal("watchlist"), // From user watchlist
        v.literal("enrichment"), // From enrichment prioritizer
        v.literal("manual"), // Manual trigger
      ),
    ),

    // Retry handling
    retryCount: v.number(),
    maxRetries: v.optional(v.number()), // Default: 3
    lastError: v.optional(v.string()),

    // Cost tracking
    tokensUsed: v.optional(v.number()),
    costUsd: v.optional(v.number()),

    // Timestamps
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
  })
    .index("by_status_priority", ["status", "priority"])
    .index("by_entity", ["entityId"])
    .index("by_status", ["status"])
    .index("by_signal", ["signalId"])
    .index("by_created", ["createdAt"])
    .index("by_persona", ["primaryPersona", "status"]),

  /* ------------------------------------------------------------------ */
  /* PUBLISHING TASKS - Multi-channel delivery workflow                 */
  /* ------------------------------------------------------------------ */
  publishingTasks: defineTable({
    // Source reference
    researchTaskId: v.id("researchTasks"),
    entityId: v.string(),
    entityName: v.optional(v.string()),

    // Content
    content: v.object({
      raw: v.string(), // Full research output
      summary: v.string(), // Executive summary
      keyFacts: v.array(
        v.object({
          label: v.string(),
          value: v.string(),
          category: v.optional(v.string()), // "funding" | "contact" | "news" | "metric"
          confidence: v.optional(v.number()),
        }),
      ),
      nextActions: v.array(v.string()), // Recommended actions
      persona: v.string(), // Persona that generated this
    }),

    // Channel configuration
    channels: v.array(
      v.object({
        channel: v.string(), // "ui" | "ntfy" | "email" | "sms" | "slack" | "rss"
        enabled: v.boolean(),
        format: v.string(), // "full" | "summary" | "alert" | "digest"
        urgency: v.optional(v.string()),
        recipients: v.optional(v.array(v.string())), // For targeted channels
        scheduledFor: v.optional(v.number()), // Scheduled delivery time
      }),
    ),

    // Status
    status: v.union(
      v.literal("pending"), // Awaiting formatting
      v.literal("formatting"), // Generating channel-specific formats
      v.literal("delivering"), // Sending to channels
      v.literal("completed"), // All deliveries done
      v.literal("partial"), // Some channels failed
      v.literal("failed"), // All channels failed
    ),

    // Delivery results
    deliveryResults: v.optional(
      v.array(
        v.object({
          channel: v.string(),
          success: v.boolean(),
          deliveredAt: v.optional(v.number()),
          messageId: v.optional(v.string()), // External message ID
          error: v.optional(v.string()),
          retryCount: v.optional(v.number()),
        }),
      ),
    ),

    // Timestamps
    createdAt: v.number(),
    formattedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_research_task", ["researchTaskId"])
    .index("by_entity", ["entityId"])
    .index("by_created", ["createdAt"]),

  /* ------------------------------------------------------------------ */
  /* ENTITY STATES - Comprehensive entity lifecycle tracking            */
  /* ------------------------------------------------------------------ */
  entityStates: defineTable({
    // Identity
    entityId: v.string(), // Canonical entity identifier
    canonicalName: v.string(), // Primary display name
    aliases: v.optional(v.array(v.string())), // Alternative names
    entityType: v.string(), // "company" | "person" | "topic" | "product" | "event"

    // Freshness tracking
    freshness: v.object({
      lastUpdated: v.number(), // Last successful research
      lastChecked: v.optional(v.number()), // Last staleness check
      staleDays: v.number(), // Days since last update
      decayScore: v.number(), // 0-1, lower = more stale
      decayHalfLifeDays: v.optional(v.number()), // Entity-specific half-life
    }),

    // Completeness tracking
    completeness: v.object({
      score: v.number(), // 0-100
      missingFields: v.array(v.string()), // Fields still needed
      enrichmentOpportunities: v.array(v.string()), // Suggested enrichments
      lastAssessed: v.number(),
    }),

    // Quality tracking
    quality: v.object({
      overallScore: v.number(), // 0-100
      personaScores: v.optional(v.any()), // Record<PersonaId, number>
      sourceCount: v.number(), // Number of unique sources
      contradictionCount: v.number(), // Unresolved contradictions
      lastValidated: v.number(),
    }),

    // Engagement tracking
    engagement: v.object({
      viewCount: v.number(),
      watchlistCount: v.number(),
      lastViewed: v.optional(v.number()),
      trendingScore: v.optional(v.number()), // Engagement velocity
    }),

    // Research history
    researchHistory: v.optional(
      v.array(
        v.object({
          taskId: v.id("researchTasks"),
          completedAt: v.number(),
          qualityScore: v.number(),
          personas: v.array(v.string()),
        }),
      ),
    ),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_decay", ["freshness.decayScore"])
    .index("by_completeness", ["completeness.score"])
    .index("by_quality", ["quality.overallScore"])
    .index("by_type", ["entityType"])
    .index("by_updated", ["updatedAt"]),

  /* ------------------------------------------------------------------ */
  /* ENGAGEMENT EVENTS - User interaction tracking for optimization     */
  /* ------------------------------------------------------------------ */
  engagementEvents: defineTable({
    // User identification
    userId: v.id("users"),

    // Event context
    channel: v.string(), // "ui" | "ntfy" | "email" | "sms" | "slack"
    eventType: v.string(), // "delivered" | "opened" | "clicked" | "dismissed" | "shared"

    // Content reference
    entityId: v.optional(v.string()),
    publishingTaskId: v.optional(v.id("publishingTasks")),
    contentType: v.optional(v.string()), // "research" | "digest" | "alert"

    // Event metadata
    metadata: v.optional(
      v.object({
        clickTarget: v.optional(v.string()), // What was clicked
        timeToOpen: v.optional(v.number()), // Ms from delivery to open
        deviceType: v.optional(v.string()), // "mobile" | "desktop"
        source: v.optional(v.string()), // Tracking source
      }),
    ),

    // Timestamps
    timestamp: v.number(),
  })
    .index("by_user_time", ["userId", "timestamp"])
    .index("by_channel", ["channel", "timestamp"])
    .index("by_entity", ["entityId", "timestamp"])
    .index("by_type", ["eventType", "timestamp"]),

  /* ------------------------------------------------------------------ */
  /* CONTRADICTIONS - Cross-source conflict tracking and resolution     */
  /* ------------------------------------------------------------------ */
  contradictions: defineTable({
    // Entity context
    entityId: v.string(),

    // Conflicting facts
    factA: v.object({
      claim: v.string(),
      source: v.string(),
      sourceUrl: v.optional(v.string()),
      confidence: v.number(), // 0-1
      timestamp: v.optional(v.number()), // When fact was discovered
    }),
    factB: v.object({
      claim: v.string(),
      source: v.string(),
      sourceUrl: v.optional(v.string()),
      confidence: v.number(),
      timestamp: v.optional(v.number()),
    }),

    // Classification
    nature: v.union(
      v.literal("direct"), // Direct logical contradiction
      v.literal("temporal"), // Time-based conflict (old vs new)
      v.literal("numerical"), // Conflicting numbers
      v.literal("semantic"), // Meaning-based conflict
    ),
    severity: v.union(
      v.literal("critical"), // Major data integrity issue
      v.literal("high"), // Important to resolve
      v.literal("medium"), // Should be resolved
      v.literal("low"), // Minor discrepancy
    ),

    // Resolution
    resolution: v.optional(
      v.object({
        winner: v.string(), // "A" | "B" | "neither" | "merged"
        reason: v.string(),
        resolvedBy: v.optional(v.string()), // "auto" | "human" | persona ID
        resolvedAt: v.number(),
        mergedClaim: v.optional(v.string()), // If merged into new claim
      }),
    ),

    // Tracking
    detectedAt: v.number(),
    detectedBy: v.optional(v.string()), // Which agent/process detected
  })
    .index("by_entity", ["entityId"])
    .index("by_unresolved", ["entityId", "resolution"])
    .index("by_severity", ["severity", "detectedAt"])
    .index("by_detected", ["detectedAt"]),

  /* ------------------------------------------------------------------ */
  /* HEALTH CHECKS - System component monitoring                        */
  /* ------------------------------------------------------------------ */
  healthChecks: defineTable({
    // Component identification
    component: v.string(), // "signalIngester" | "researchQueue" | etc.

    // Health status
    status: v.union(
      v.literal("healthy"),
      v.literal("degraded"),
      v.literal("down"),
    ),

    // Metrics
    latencyP50: v.number(), // 50th percentile latency (ms)
    latencyP99: v.number(), // 99th percentile latency (ms)
    errorRate: v.number(), // 0-1
    throughput: v.optional(v.number()), // Operations per minute

    // Queue metrics (if applicable)
    queueDepth: v.optional(v.number()),
    oldestItemAge: v.optional(v.number()), // Age in ms of oldest queued item

    // Resource metrics
    memoryUsage: v.optional(v.number()), // MB
    cpuUsage: v.optional(v.number()), // 0-1

    // Error details
    recentErrors: v.optional(
      v.array(
        v.object({
          timestamp: v.number(),
          message: v.string(),
          count: v.number(),
        }),
      ),
    ),

    // Check metadata
    checkedAt: v.number(),
    windowMinutes: v.number(), // Time window for metrics
  })
    .index("by_component", ["component", "checkedAt"])
    .index("by_status", ["status", "checkedAt"])
    .index("by_checked", ["checkedAt"]),

  /* ------------------------------------------------------------------ */
  /* HEALING ACTIONS - Self-healing execution log                       */
  /* ------------------------------------------------------------------ */
  healingActions: defineTable({
    // Target component
    component: v.string(),
    issue: v.string(), // Issue identifier

    // Action taken
    action: v.string(), // "restart" | "scale" | "fallback" | "isolate" | "alert"
    reason: v.string(),
    automated: v.boolean(), // Was this automatic or manual?

    // Execution
    status: v.union(
      v.literal("pending"),
      v.literal("executing"),
      v.literal("success"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    executedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),

    // Impact tracking
    impactMetrics: v.optional(
      v.object({
        preActionHealth: v.string(),
        postActionHealth: v.optional(v.string()),
        recoveryTimeMs: v.optional(v.number()),
      }),
    ),

    // Timestamps
    createdAt: v.number(),
  })
    .index("by_component", ["component", "createdAt"])
    .index("by_status", ["status", "createdAt"])
    .index("by_action", ["action", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* PERSONA BUDGETS - Per-persona resource consumption tracking        */
  /* ------------------------------------------------------------------ */
  personaBudgets: defineTable({
    // Persona identification
    personaId: v.string(),

    // Time period
    period: v.string(), // "daily" | "weekly" | "monthly"
    periodStart: v.number(), // Start of period
    periodEnd: v.number(), // End of period

    // Usage tracking
    tokensUsed: v.number(),
    costUsd: v.number(),
    researchCount: v.number(), // Number of research tasks
    publishCount: v.number(), // Number of publications

    // Budget limits
    tokenLimit: v.number(),
    costLimit: v.number(),

    // Status
    exhausted: v.boolean(), // Has budget been exhausted?
    exhaustedAt: v.optional(v.number()), // When budget was exhausted

    // Timestamps
    updatedAt: v.number(),
  })
    .index("by_persona_period", ["personaId", "period", "periodStart"])
    .index("by_exhausted", ["exhausted", "periodEnd"]),

  /* ------------------------------------------------------------------ */
  /* DELIVERY QUEUE - Low-level delivery job tracking                   */
  /* ------------------------------------------------------------------ */
  deliveryJobs: defineTable({
    // Channel targeting
    channel: v.string(), // "ntfy" | "email" | "sms" | "slack" | "rss"
    recipient: v.optional(v.string()), // Target recipient

    // Payload
    payload: v.any(), // Channel-specific payload

    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("sending"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("retrying"),
    ),

    // Retry handling
    attempts: v.number(),
    maxAttempts: v.number(), // Default: 5
    lastError: v.optional(v.string()),
    nextRetryAt: v.optional(v.number()),

    // External references
    publishingTaskId: v.optional(v.id("publishingTasks")),
    externalMessageId: v.optional(v.string()), // ID from delivery provider

    // Timestamps
    createdAt: v.number(),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_retry", ["status", "nextRetryAt"])
    .index("by_channel", ["channel", "status"])
    .index("by_publishing_task", ["publishingTaskId"]),

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   * FREE MODEL DISCOVERY & EVALUATION
   * Deep Agents 3.0 - Autonomous model selection for zero-cost operations
   * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

  /* ------------------------------------------------------------------ */
  /* FREE MODELS - Discovered free models from OpenRouter               */
  /* ------------------------------------------------------------------ */
  freeModels: defineTable({
    // Identity
    openRouterId: v.string(), // e.g., "qwen/qwen3-coder:free"
    name: v.string(), // Human-readable name
    contextLength: v.number(), // Max context window

    // Capabilities (refined by evaluation)
    capabilities: v.object({
      toolUse: v.boolean(),
      streaming: v.boolean(),
      structuredOutputs: v.boolean(),
      vision: v.boolean(),
    }),

    // Performance metrics (rolling averages)
    performanceScore: v.number(), // 0-100 composite score
    reliabilityScore: v.number(), // 0-100 based on success rate
    latencyAvgMs: v.number(), // Average response time

    // Evaluation tracking
    lastEvaluated: v.number(), // Last evaluation timestamp
    evaluationCount: v.number(), // Total evaluations run
    successCount: v.number(), // Successful evaluations
    failureCount: v.number(), // Failed evaluations

    // Status
    isActive: v.boolean(), // Meets reliability threshold
    rank: v.number(), // 1 = best, higher = worse
  })
    .index("by_openRouterId", ["openRouterId"])
    .index("by_rank", ["rank"])
    .index("by_active_rank", ["isActive", "rank"])
    .index("by_performance", ["performanceScore"]),

  /* ------------------------------------------------------------------ */
  /* FREE MODEL EVALUATIONS - Evaluation history for each model         */
  /* ------------------------------------------------------------------ */
  freeModelEvaluations: defineTable({
    modelId: v.id("freeModels"),
    success: v.boolean(),
    latencyMs: v.number(),
    responseQuality: v.optional(v.number()), // 0-100
    toolCallSuccess: v.optional(v.boolean()),
    error: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_model", ["modelId", "timestamp"])
    .index("by_timestamp", ["timestamp"]),

  /* ------------------------------------------------------------------ */
  /* FREE MODEL METADATA - System-level discovery tracking              */
  /* ------------------------------------------------------------------ */
  freeModelMeta: defineTable({
    key: v.string(), // "lastDiscovery" | "lastRankingUpdate"
    value: v.number(), // Timestamp value
  }),

  /* ------------------------------------------------------------------ */
  /* AUTONOMOUS MODEL USAGE - Usage tracking for autonomous operations  */
  /* ------------------------------------------------------------------ */
  autonomousModelUsage: defineTable({
    modelId: v.string(), // Model identifier used
    taskType: v.string(), // "research" | "synthesis" | "publishing" etc.
    success: v.boolean(),
    latencyMs: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cost: v.number(), // Cost in USD (0 for free models)
    error: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_model", ["modelId", "timestamp"])
    .index("by_taskType", ["taskType", "timestamp"])
    .index("by_timestamp", ["timestamp"])
    .index("by_success", ["success", "timestamp"]),

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   * DISCORD INTEGRATION
   * Bot-based messaging for slash commands and notifications
   * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

  /* ------------------------------------------------------------------ */
  /* DISCORD USERS - Registered Discord users for notifications         */
  /* ------------------------------------------------------------------ */
  discordUsers: defineTable({
    discordUserId: v.string(), // Discord user ID (snowflake)
    discordUsername: v.string(),
    discordGuildId: v.optional(v.string()), // Server/guild ID
    discordChannelId: v.optional(v.string()), // Preferred channel
    notificationsEnabled: v.boolean(),
    createdAt: v.number(),
    lastActiveAt: v.number(),
  })
    .index("by_user_id", ["discordUserId"])
    .index("by_guild", ["discordGuildId"])
    .index("by_last_active", ["lastActiveAt"]),

  /* ------------------------------------------------------------------ */
  /* DISCORD INTERACTIONS - Interaction log for audit/context           */
  /* ------------------------------------------------------------------ */
  discordInteractions: defineTable({
    discordUserId: v.string(),
    discordUsername: v.string(),
    guildId: v.optional(v.string()),
    channelId: v.optional(v.string()),
    interactionType: v.string(), // "slash_command" | "button_click" | "modal_submit"
    commandName: v.optional(v.string()),
    commandOptions: v.optional(v.any()),
    agentResponse: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_user_id", ["discordUserId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_guild_timestamp", ["guildId", "timestamp"]),

  /* ------------------------------------------------------------------ */
  /* SLACK INTERACTIONS - Interaction log for encounter capture/audit   */
  /* ------------------------------------------------------------------ */
  slackInteractions: defineTable({
    slackUserId: v.string(),
    slackUsername: v.string(),
    slackTeamId: v.string(),
    channelId: v.optional(v.string()),
    channelName: v.optional(v.string()),
    interactionType: v.string(), // "slash_command" | "message" | "button_click" | "modal_submit"
    commandName: v.optional(v.string()),
    commandOptions: v.optional(v.any()),
    messageText: v.optional(v.string()),
    nodebenchUserId: v.optional(v.id("users")), // Linked NodeBench user if mapped
    encounterId: v.optional(v.id("userEvents")), // Linked encounter if created
    agentResponse: v.optional(v.string()),
    processingTimeMs: v.optional(v.number()),
    timestamp: v.number(),
  })
    .index("by_slack_user", ["slackUserId"])
    .index("by_nodebench_user", ["nodebenchUserId"])
    .index("by_team", ["slackTeamId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_team_timestamp", ["slackTeamId", "timestamp"]),

  // Scheduled PDF Reports
  scheduledReports,

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   * DUE DILIGENCE FRAMEWORK
   * Parallelized multi-front research with traditional IC memo output
   * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

  /* ------------------------------------------------------------------ */
  /* DUE DILIGENCE JOBS - Orchestration layer for DD research            */
  /* ------------------------------------------------------------------ */
  dueDiligenceJobs: defineTable({
    jobId: v.string(), // UUID for deduplication
    userId: v.id("users"),
    entityId: v.optional(v.id("entityContexts")),
    entityName: v.string(),
    entityType: v.union(
      v.literal("company"),
      v.literal("fund"),
      v.literal("person"),
    ),

    // Trigger source
    triggerSource: v.union(
      v.literal("funding_detection"), // Auto-triggered from funding events
      v.literal("deals_feed"), // From deals/opportunities feed
      v.literal("manual"), // User-initiated
      v.literal("scheduled_refresh"), // Periodic refresh of stale DD
      v.literal("encounter"), // Triggered from encounter capture
    ),
    triggerEventId: v.optional(v.string()), // Link to fundingEvent or feedItem
    triggerEncounterId: v.optional(v.id("encounterEvents")), // Link to encounter if triggered from one

    // Status workflow
    status: v.union(
      v.literal("pending"), // Queued
      v.literal("analyzing"), // Complexity signal analysis
      v.literal("executing"), // Parallel branch execution
      v.literal("cross_checking"), // Cross-check phase
      v.literal("synthesizing"), // Memo generation
      v.literal("completed"),
      v.literal("failed"),
    ),

    // Branch tracking
    activeBranches: v.array(v.string()), // Currently executing branch types
    conditionalBranchesSpawned: v.optional(v.array(v.string())), // Dynamically added

    // Complexity signals (determines conditional branches)
    complexitySignals: v.optional(
      v.object({
        fundingSize: v.optional(v.number()), // USD amount
        teamSize: v.optional(v.number()), // Key people count
        hasPatentMentions: v.optional(v.boolean()),
        hasRegulatoryMentions: v.optional(v.boolean()),
        hasPublicSecurities: v.optional(v.boolean()),
        hasSerialFounders: v.optional(v.boolean()),
        hasVCBackedFounders: v.optional(v.boolean()),
        industryRisk: v.optional(
          v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
        ),
        sectors: v.optional(v.array(v.string())),
      }),
    ),

    // Results
    ddMemoId: v.optional(v.id("dueDiligenceMemos")),
    overallConfidence: v.optional(v.number()), // 0-1 final confidence

    // Contradiction tracking
    contradictions: v.optional(
      v.array(
        v.object({
          field: v.string(), // Which field has conflict
          sourceA: v.string(), // Branch or source A
          valueA: v.string(),
          sourceB: v.string(), // Branch or source B
          valueB: v.string(),
          resolution: v.optional(
            v.union(
              v.literal("resolved_to_a"),
              v.literal("resolved_to_b"),
              v.literal("unresolved"),
              v.literal("both_valid"),
            ),
          ),
          resolutionReason: v.optional(v.string()),
        }),
      ),
    ),

    // Task tree integration
    parallelTreeId: v.optional(v.id("parallelTaskTrees")),

    // Timing
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),

    // Error tracking
    error: v.optional(v.string()),
    retryCount: v.optional(v.number()),
  })
    .index("by_jobId", ["jobId"])
    .index("by_user", ["userId"])
    .index("by_entity", ["entityName", "entityType"])
    .index("by_entityId", ["entityId"])
    .index("by_status", ["status"])
    .index("by_user_status", ["userId", "status"])
    .index("by_trigger", ["triggerSource", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .searchIndex("search_entity", {
      searchField: "entityName",
      filterFields: ["entityType", "status"],
    }),

  /* ------------------------------------------------------------------ */
  /* DD RESEARCH BRANCHES - Individual research angles                   */
  /* ------------------------------------------------------------------ */
  ddResearchBranches: defineTable({
    jobId: v.string(), // Links to dueDiligenceJobs
    branchId: v.string(), // UUID
    branchType: v.union(
      // Core branches (always run)
      v.literal("company_profile"), // Basic company data
      v.literal("team_founders"), // Deep team/founder research
      v.literal("market_competitive"), // Market size, competitors
      // Conditional branches (spawned based on complexity)
      v.literal("technical_dd"), // Tech stack, architecture
      v.literal("ip_patents"), // Patent portfolio, IP
      v.literal("regulatory"), // SEC, FDA, compliance
      v.literal("financial_deep"), // Deep financial analysis
      v.literal("network_mapping"), // Network graph, relationships
    ),

    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("awaiting_verification"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"), // Conditional branch not needed
    ),

    // Integration with parallel task tree
    taskTreeId: v.optional(v.id("parallelTaskTrees")),
    taskNodeId: v.optional(v.string()), // parallelTaskNodes.taskId

    // Findings (branch-specific structured data)
    findings: v.optional(v.any()), // Varies by branchType
    findingsSummary: v.optional(v.string()), // Human-readable summary

    // Confidence & verification
    confidence: v.optional(v.number()), // 0-1 confidence in findings
    verificationScore: v.optional(v.number()), // From verifier agent

    // Sources used
    sourcesUsed: v.optional(
      v.array(
        v.object({
          sourceType: v.union(
            v.literal("sec_filing"),
            v.literal("news_article"),
            v.literal("company_website"),
            v.literal("linkedin"),
            v.literal("patent_db"),
            v.literal("crunchbase"),
            v.literal("pitchbook"),
            v.literal("llm_inference"),
          ),
          url: v.optional(v.string()),
          title: v.optional(v.string()),
          accessedAt: v.number(),
          reliability: v.union(
            v.literal("authoritative"), // SEC, USPTO, official
            v.literal("reliable"), // Major news, LinkedIn
            v.literal("secondary"), // Blog, press release
            v.literal("inferred"), // LLM synthesis
          ),
          // Optional section tracking
          section: v.optional(v.string()), // Which memo section this supports
          branchType: v.optional(v.string()), // Which branch produced this source
        }),
      ),
    ),

    // Timing
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),

    // Error
    error: v.optional(v.string()),
  })
    .index("by_job", ["jobId"])
    .index("by_branchId", ["branchId"])
    .index("by_job_type", ["jobId", "branchType"])
    .index("by_job_status", ["jobId", "status"])
    .index("by_status", ["status"]),

  /* ------------------------------------------------------------------ */
  /* DUE DILIGENCE MEMOS - Traditional IC/VC memo structure              */
  /* ------------------------------------------------------------------ */
  dueDiligenceMemos: defineTable({
    jobId: v.string(), // Links to dueDiligenceJobs
    entityName: v.string(),
    entityType: v.union(
      v.literal("company"),
      v.literal("fund"),
      v.literal("person"),
    ),

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // I. EXECUTIVE SUMMARY
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    executiveSummary: v.string(),
    verdict: v.union(
      v.literal("STRONG_BUY"),
      v.literal("BUY"),
      v.literal("HOLD"),
      v.literal("PASS"),
      v.literal("INSUFFICIENT_DATA"),
    ),
    verdictRationale: v.optional(v.string()),

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // II. COMPANY OVERVIEW
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    companyOverview: v.object({
      description: v.string(),
      hqLocation: v.optional(v.string()),
      foundedYear: v.optional(v.number()),
      employeeCount: v.optional(v.number()),
      employeeGrowth: v.optional(v.string()), // e.g., "+50% YoY"
      sectors: v.array(v.string()),
      stage: v.optional(v.string()), // Seed, Series A, etc.
      businessModel: v.optional(v.string()),
      keyProducts: v.optional(v.array(v.string())),
    }),

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // III. MARKET ANALYSIS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    marketAnalysis: v.object({
      marketSize: v.optional(v.string()), // TAM/SAM/SOM
      marketGrowth: v.optional(v.string()), // CAGR
      competitors: v.array(
        v.object({
          name: v.string(),
          description: v.optional(v.string()),
          fundingStage: v.optional(v.string()),
          differentiator: v.optional(v.string()),
          threat: v.optional(
            v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
          ), // Competitive threat level
        }),
      ),
      differentiators: v.array(v.string()), // Company's competitive advantages
      whyNow: v.optional(v.string()), // Market timing thesis
      tailwinds: v.optional(v.array(v.string())),
      headwinds: v.optional(v.array(v.string())),
    }),

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // IV. TEAM ASSESSMENT
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    teamAnalysis: v.object({
      founders: v.array(v.any()), // TeamMemberProfile[]
      executives: v.array(v.any()), // TeamMemberProfile[]
      boardMembers: v.array(v.any()), // TeamMemberProfile[]
      advisors: v.optional(v.array(v.any())),
      networkGraph: v.optional(v.any()), // Network visualization data
      trackRecordSummary: v.optional(v.string()),
      teamStrengths: v.optional(v.array(v.string())),
      teamGaps: v.optional(v.array(v.string())),
      founderMarketFit: v.optional(v.string()),
    }),

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // V. FINANCIALS / FUNDING HISTORY
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    fundingHistory: v.object({
      totalRaised: v.optional(
        v.object({
          amount: v.number(),
          currency: v.string(),
          unit: v.string(), // M, B, K
        }),
      ),
      rounds: v.array(
        v.object({
          roundType: v.string(),
          date: v.optional(v.string()),
          amount: v.optional(v.string()),
          leadInvestors: v.optional(v.array(v.string())),
          valuation: v.optional(v.string()),
          verified: v.optional(v.boolean()),
          source: v.optional(v.string()),
        }),
      ),
      valuationComps: v.optional(
        v.object({
          currentValuation: v.optional(v.string()),
          revenueMultiple: v.optional(v.number()),
          comparables: v.optional(
            v.array(
              v.object({
                company: v.string(),
                valuation: v.string(),
                multiple: v.optional(v.number()),
              }),
            ),
          ),
        }),
      ),
      burnRate: v.optional(v.string()),
      runway: v.optional(v.string()),
    }),

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // VI. RISKS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    risks: v.array(
      v.object({
        category: v.union(
          v.literal("Market"),
          v.literal("Execution"),
          v.literal("Regulatory"),
          v.literal("Team"),
          v.literal("Technical"),
          v.literal("Financial"),
          v.literal("Competitive"),
          v.literal("Legal"),
        ),
        description: v.string(),
        severity: v.union(
          v.literal("low"),
          v.literal("medium"),
          v.literal("high"),
          v.literal("critical"),
        ),
        likelihood: v.optional(
          v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
        ),
        mitigation: v.optional(v.string()),
        timeframe: v.optional(v.string()), // Near-term, medium-term, long-term
      }),
    ),

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // VII. INVESTMENT THESIS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    investmentThesis: v.object({
      thesisSummary: v.string(),
      keyDrivers: v.array(v.string()), // Why this will work
      keyMilestones: v.optional(
        v.array(
          v.object({
            milestone: v.string(),
            timeframe: v.optional(v.string()),
            importance: v.optional(v.string()),
          }),
        ),
      ),
      exitScenarios: v.optional(
        v.array(
          v.object({
            scenario: v.string(),
            probability: v.optional(v.string()), // Low/Medium/High
            potentialReturn: v.optional(v.string()),
            acquirers: v.optional(v.array(v.string())),
          }),
        ),
      ),
      comparableExits: v.optional(
        v.array(
          v.object({
            company: v.string(),
            exitType: v.string(),
            exitValue: v.string(),
            year: v.optional(v.number()),
          }),
        ),
      ),
    }),

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // VERIFICATION & SOURCES
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    verificationSummary: v.object({
      contradictionsFound: v.number(),
      contradictionsResolved: v.number(),
      overallConfidence: v.number(), // 0-1
      dataCompleteness: v.number(), // 0-1 how complete is the data
      sourceQuality: v.union(
        v.literal("high"), // Multiple authoritative sources
        v.literal("medium"), // Mix of sources
        v.literal("low"), // Mostly inferred
      ),
    }),

    // All sources used across all branches
    sources: v.array(
      v.object({
        sourceType: v.string(),
        url: v.optional(v.string()),
        title: v.optional(v.string()),
        reliability: v.string(),
        section: v.optional(v.string()), // Which memo section uses this
      }),
    ),

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // PERSONA READINESS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    personaReadiness: v.optional(
      v.record(
        v.string(),
        v.object({
          ready: v.boolean(),
          missingFields: v.optional(v.array(v.string())),
          relevanceScore: v.optional(v.number()), // 0-1 how relevant for this persona
        }),
      ),
    ),

    // Timing
    createdAt: v.number(),
    updatedAt: v.number(),

    // Version control
    version: v.number(),
    previousVersionId: v.optional(v.id("dueDiligenceMemos")),
  })
    .index("by_jobId", ["jobId"])
    .index("by_entity", ["entityName", "entityType"])
    .index("by_verdict", ["verdict"])
    .index("by_createdAt", ["createdAt"])
    .searchIndex("search_entity", {
      searchField: "entityName",
      filterFields: ["entityType", "verdict"],
    }),

  /* ------------------------------------------------------------------ */
  /* INVESTOR PLAYBOOK - Verification jobs and cache tables              */
  /* ------------------------------------------------------------------ */

  // Investor protection verification jobs
  investorPlaybookJobs: defineTable({
    jobId: v.string(), // UUID for deduplication
    userId: v.id("users"),

    // Input - the offering being verified
    offeringName: v.string(),
    offeringUrl: v.optional(v.string()),
    fundingPortal: v.optional(v.string()),
    pitchDocumentId: v.optional(v.id("documents")),
    pitchText: v.optional(v.string()),

    // Extracted claims from pitch
    extractedClaims: v.optional(
      v.object({
        companyName: v.string(),
        companyNameVariants: v.optional(v.array(v.string())),
        incorporationState: v.optional(v.string()),
        incorporationDate: v.optional(v.string()),
        secFilingType: v.optional(v.string()),
        fundingPortal: v.optional(v.string()),
        fdaClaims: v.array(
          v.object({
            description: v.string(),
            claimedType: v.string(),
            clearanceNumber: v.optional(v.string()),
            productName: v.optional(v.string()),
          }),
        ),
        patentClaims: v.array(
          v.object({
            description: v.string(),
            patentNumber: v.optional(v.string()),
            status: v.string(),
            inventorNames: v.optional(v.array(v.string())),
          }),
        ),
        fundingClaims: v.optional(
          v.object({
            targetRaise: v.optional(v.string()),
            previousRaises: v.optional(v.array(v.string())),
            valuation: v.optional(v.string()),
          }),
        ),
        otherClaims: v.array(
          v.object({
            category: v.string(),
            claim: v.string(),
            evidence: v.optional(v.string()),
          }),
        ),
        extractedAt: v.number(),
        confidence: v.number(),
      }),
    ),

    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("extracting_claims"),
      v.literal("verifying_entity"),
      v.literal("verifying_securities"),
      v.literal("validating_claims"),
      v.literal("checking_money_flow"),
      v.literal("synthesizing"),
      v.literal("completed"),
      v.literal("failed"),
    ),

    // Phase results
    entityVerification: v.optional(
      v.object({
        verified: v.boolean(),
        stateRegistry: v.optional(v.string()),
        record: v.optional(
          v.object({
            state: v.string(),
            entityName: v.string(),
            fileNumber: v.string(),
            formationDate: v.optional(v.string()),
            registeredAgent: v.optional(v.string()),
            registeredAgentAddress: v.optional(v.string()),
            status: v.string(),
            entityType: v.optional(v.string()),
          }),
        ),
        discrepancies: v.array(v.string()),
        redFlags: v.array(v.string()),
        verifiedAt: v.number(),
      }),
    ),

    securitiesVerification: v.optional(
      v.object({
        verified: v.boolean(),
        filingType: v.optional(v.string()),
        filing: v.optional(
          v.object({
            formType: v.string(),
            filingDate: v.string(),
            cik: v.string(),
            accessionNumber: v.string(),
            issuerName: v.string(),
            offeringAmount: v.optional(v.string()),
            url: v.string(),
          }),
        ),
        filingFound: v.boolean(),
        fundingPortal: v.optional(
          v.object({
            portalName: v.string(),
            finraId: v.optional(v.string()),
            registrationDate: v.optional(v.string()),
            isRegistered: v.boolean(),
          }),
        ),
        portalVerified: v.boolean(),
        discrepancies: v.array(v.string()),
        redFlags: v.array(v.string()),
        verifiedAt: v.number(),
      }),
    ),

    claimsValidation: v.optional(
      v.object({
        fdaVerifications: v.array(
          v.object({
            claimDescription: v.string(),
            verified: v.boolean(),
            kNumber: v.optional(v.string()),
            deviceName: v.optional(v.string()),
            applicant: v.optional(v.string()),
            discrepancy: v.optional(v.string()),
          }),
        ),
        patentVerifications: v.array(
          v.object({
            claimDescription: v.string(),
            verified: v.boolean(),
            patentNumber: v.optional(v.string()),
            assignee: v.optional(v.string()),
            assigneeMatches: v.boolean(),
            discrepancy: v.optional(v.string()),
          }),
        ),
        allFDAClaimed: v.number(),
        allFDAVerified: v.number(),
        allPatentsClaimed: v.number(),
        allPatentsVerified: v.number(),
        verifiedAt: v.number(),
      }),
    ),

    moneyFlowVerification: v.optional(
      v.object({
        verified: v.boolean(),
        expectedFlow: v.string(),
        escrowAgent: v.optional(v.string()),
        escrowVerified: v.boolean(),
        redFlags: v.array(v.string()),
        verifiedAt: v.number(),
      }),
    ),

    // Final result link
    resultId: v.optional(v.id("investorPlaybookResults")),

    // Timing
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),

    // Error
    error: v.optional(v.string()),
  })
    .index("by_jobId", ["jobId"])
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_offering", ["offeringName"])
    .index("by_createdAt", ["createdAt"])
    .searchIndex("search_offering", {
      searchField: "offeringName",
      filterFields: ["status"],
    }),

  // State registry verification cache
  investorPlaybookEntityCache: defineTable({
    entityName: v.string(),
    state: v.string(),
    fileNumber: v.optional(v.string()),
    formationDate: v.optional(v.string()),
    entityType: v.optional(v.string()),
    status: v.union(
      v.literal("Active"),
      v.literal("Inactive"),
      v.literal("Dissolved"),
      v.literal("Merged"),
      v.literal("Suspended"),
      v.literal("Unknown"),
    ),
    registeredAgent: v.optional(
      v.object({
        name: v.string(),
        address: v.string(),
      }),
    ),
    goodStanding: v.optional(v.boolean()),
    verifiedAt: v.number(),
    sourceUrl: v.optional(v.string()),
  })
    .index("by_entity_state", ["entityName", "state"])
    .index("by_verifiedAt", ["verifiedAt"]),

  // SEC EDGAR filings cache
  investorPlaybookSecCache: defineTable({
    entityName: v.string(),
    cik: v.optional(v.string()),
    formType: v.string(), // "C", "D", "10-K", etc.
    accessionNumber: v.string(),
    filingDate: v.string(),
    filingUrl: v.string(),
    offeringAmount: v.optional(v.number()),
    intermediaryName: v.optional(v.string()),
    parsedData: v.optional(v.any()),
    cachedAt: v.number(),
  })
    .index("by_entity", ["entityName"])
    .index("by_cik", ["cik"])
    .index("by_form", ["formType"])
    .index("by_cachedAt", ["cachedAt"]),

  // FDA verification cache
  investorPlaybookFdaCache: defineTable({
    entityName: v.string(),
    deviceName: v.optional(v.string()),
    verificationType: v.union(
      v.literal("510k"),
      v.literal("pma"),
      v.literal("registration"),
      v.literal("listing"),
      v.literal("recall"),
      v.literal("adverse_event"),
    ),
    referenceNumber: v.string(), // K-number, PMA number, etc.
    status: v.string(),
    decisionDate: v.optional(v.string()),
    productCode: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    cachedAt: v.number(),
  })
    .index("by_entity", ["entityName"])
    .index("by_type", ["verificationType"])
    .index("by_reference", ["referenceNumber"])
    .index("by_cachedAt", ["cachedAt"]),

  // USPTO patent cache
  investorPlaybookPatentCache: defineTable({
    entityName: v.string(),
    patentNumber: v.string(),
    title: v.string(),
    inventors: v.array(v.string()),
    assignee: v.string(),
    currentAssignee: v.optional(v.string()),
    filingDate: v.optional(v.string()),
    issueDate: v.optional(v.string()),
    expirationDate: v.optional(v.string()),
    patentType: v.optional(v.string()),
    status: v.union(
      v.literal("Active"),
      v.literal("Expired"),
      v.literal("Lapsed"),
    ),
    usptoUrl: v.string(),
    cachedAt: v.number(),
  })
    .index("by_entity", ["entityName"])
    .index("by_patent", ["patentNumber"])
    .index("by_assignee", ["assignee"])
    .index("by_cachedAt", ["cachedAt"]),

  // FINRA portal verification cache
  investorPlaybookFinraCache: defineTable({
    portalName: v.string(),
    crd: v.string(),
    secFileNumber: v.optional(v.string()),
    status: v.union(
      v.literal("Active"),
      v.literal("Inactive"),
      v.literal("Suspended"),
      v.literal("Withdrawn"),
    ),
    registrationDate: v.optional(v.string()),
    website: v.optional(v.string()),
    disclosureCount: v.optional(v.number()),
    verifiedAt: v.number(),
  })
    .index("by_portal", ["portalName"])
    .index("by_crd", ["crd"])
    .index("by_verifiedAt", ["verifiedAt"]),

  // Investor playbook synthesis results
  investorPlaybookResults: defineTable({
    jobId: v.optional(v.string()), // Links to DD job if part of full DD
    entityName: v.string(),
    entityType: v.union(
      v.literal("company"),
      v.literal("fund"),
      v.literal("person"),
    ),

    // Overall assessment
    overallRisk: v.union(
      v.literal("low"),
      v.literal("moderate"),
      v.literal("elevated"),
      v.literal("high"),
      v.literal("critical"),
    ),
    recommendation: v.union(
      v.literal("proceed"),
      v.literal("proceed_with_conditions"),
      v.literal("require_resolution"),
      v.literal("pass"),
    ),
    shouldDisengage: v.boolean(),

    // Verification scores
    verificationScores: v.object({
      entity: v.number(),
      securities: v.number(),
      finra: v.number(),
      fda: v.number(),
      patents: v.number(),
      moneyFlow: v.number(),
      overall: v.number(),
    }),

    // Discrepancies
    discrepancyCount: v.number(),
    criticalDiscrepancies: v.number(),

    // Stop rules
    stopRulesTriggered: v.array(v.string()),

    // Conditions/resolutions
    conditions: v.optional(v.array(v.string())),
    requiredResolutions: v.optional(v.array(v.string())),

    // Branch execution
    branchesExecuted: v.array(v.string()),
    executionTimeMs: v.number(),

    // Full synthesis (stored as JSON)
    fullSynthesis: v.optional(v.any()),

    // Metadata
    createdAt: v.number(),
    userId: v.optional(v.id("users")),
  })
    .index("by_entity", ["entityName", "entityType"])
    .index("by_risk", ["overallRisk"])
    .index("by_recommendation", ["recommendation"])
    .index("by_createdAt", ["createdAt"])
    .index("by_jobId", ["jobId"]),

  /* ------------------------------------------------------------------ */
  /* DEEP RESEARCH - Multi-agent research system                         */
  /* ------------------------------------------------------------------ */

  // Deep research jobs
  deepResearchJobs: defineTable({
    jobId: v.string(),
    userId: v.id("users"),
    query: v.string(),
    depth: v.union(
      v.literal("quick"),
      v.literal("standard"),
      v.literal("comprehensive"),
      v.literal("exhaustive"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("decomposing_query"),
      v.literal("spawning_agents"),
      v.literal("executing_research"),
      v.literal("cross_verifying"),
      v.literal("evaluating_hypotheses"),
      v.literal("synthesizing"),
      v.literal("completed"),
      v.literal("failed"),
    ),

    // Query decomposition
    decomposedQuery: v.optional(v.any()), // DecomposedQuery

    // Sub-agent tracking
    subAgentTasks: v.optional(
      v.array(
        v.object({
          taskId: v.string(),
          type: v.string(),
          target: v.string(),
          status: v.string(),
          startedAt: v.optional(v.number()),
          completedAt: v.optional(v.number()),
        }),
      ),
    ),

    // Results
    reportId: v.optional(v.id("deepResearchReports")),

    // Timing
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_jobId", ["jobId"])
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_createdAt", ["createdAt"]),

  // Deep research reports
  deepResearchReports: defineTable({
    jobId: v.string(),
    originalQuery: v.string(),

    // Summary
    executiveSummary: v.string(),
    keyFindings: v.array(v.string()),
    confidence: v.number(),

    // Verdict
    overallVerdict: v.union(
      v.literal("VERIFIED"),
      v.literal("PARTIALLY_SUPPORTED"),
      v.literal("UNVERIFIED"),
      v.literal("CONTRADICTED"),
      v.literal("FALSIFIED"),
    ),
    verdictReasoning: v.string(),

    // Findings (stored as JSON)
    personProfiles: v.optional(v.any()),
    companyProfiles: v.optional(v.any()),
    newsEvents: v.optional(v.any()),
    relationships: v.optional(v.any()),
    hypothesesEvaluated: v.optional(v.any()),

    // Verified claims
    verifiedClaimsCount: v.number(),
    unverifiedClaimsCount: v.number(),
    contradictionsCount: v.number(),

    // Sources
    sourcesCount: v.number(),

    // Sub-agent summary
    subAgentsSummary: v.optional(v.any()),

    // Timing
    executionTimeMs: v.number(),
    createdAt: v.number(),
    userId: v.optional(v.id("users")),
  })
    .index("by_jobId", ["jobId"])
    .index("by_verdict", ["overallVerdict"])
    .index("by_createdAt", ["createdAt"]),

  /* ------------------------------------------------------------------ */
  /* DD GROUND TRUTH - Golden dataset for DD evaluation                  */
  /* ------------------------------------------------------------------ */
  ddGroundTruth: defineTable({
    entityName: v.string(),
    entityType: v.union(
      v.literal("company"),
      v.literal("fund"),
      v.literal("person"),
    ),

    // Verified facts with sources
    verifiedFacts: v.object({
      // Company facts
      foundedYear: v.optional(
        v.object({
          value: v.number(),
          source: v.string(),
          verifiedAt: v.number(),
        }),
      ),
      hqLocation: v.optional(
        v.object({
          value: v.string(),
          source: v.string(),
          verifiedAt: v.number(),
        }),
      ),
      employeeCount: v.optional(
        v.object({
          value: v.number(),
          asOf: v.string(),
          source: v.string(),
          verifiedAt: v.number(),
        }),
      ),

      // Funding facts (SEC Form D verified)
      fundingRounds: v.optional(
        v.array(
          v.object({
            roundType: v.string(),
            amount: v.number(),
            date: v.string(),
            secFormDUrl: v.optional(v.string()),
            verified: v.boolean(),
          }),
        ),
      ),

      // Team facts (LinkedIn verified)
      keyPeople: v.optional(
        v.array(
          v.object({
            name: v.string(),
            role: v.string(),
            linkedinUrl: v.optional(v.string()),
            verified: v.boolean(),
          }),
        ),
      ),

      // Patent facts (USPTO verified)
      patents: v.optional(
        v.array(
          v.object({
            patentId: v.string(),
            title: v.string(),
            inventors: v.array(v.string()),
            usptoUrl: v.optional(v.string()),
            verified: v.boolean(),
          }),
        ),
      ),

      // Regulatory facts
      regulatoryStatus: v.optional(
        v.object({
          type: v.string(), // FDA, SEC, etc.
          status: v.string(),
          source: v.string(),
          verifiedAt: v.number(),
        }),
      ),
    }),

    // Expected memo content for evaluation
    expectedMemo: v.optional(
      v.object({
        expectedVerdict: v.optional(v.string()),
        expectedRiskCategories: v.optional(v.array(v.string())),
        expectedCompetitors: v.optional(v.array(v.string())),
      }),
    ),

    // Curation status
    curatorId: v.optional(v.id("users")),
    curationStatus: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("verified"),
      v.literal("contested"),
    ),
    curatorNotes: v.optional(v.string()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityName", "entityType"])
    .index("by_curation_status", ["curationStatus"]),

  /* ================================================================== */
  /* ENCOUNTER EVENTS - Fast pipeline capture for side-events           */
  /* ================================================================== */
  encounterEvents: defineTable({
    userId: v.id("users"),

    // Source tracking
    sourceType: v.union(
      v.literal("slack"),
      v.literal("web_ui"),
      v.literal("email_forward"),
      v.literal("calendar_sync"),
    ),
    sourceId: v.optional(v.string()),
    sourceChannelId: v.optional(v.string()),

    // Core encounter data
    rawText: v.string(),
    title: v.string(),
    context: v.optional(v.string()),

    // Extracted entities (from NER pass)
    participants: v.array(
      v.object({
        name: v.string(),
        role: v.optional(v.string()),
        company: v.optional(v.string()),
        email: v.optional(v.string()),
        linkedEntityId: v.optional(v.id("entityContexts")),
        confidence: v.number(),
      }),
    ),
    companies: v.array(
      v.object({
        name: v.string(),
        linkedEntityId: v.optional(v.id("entityContexts")),
        confidence: v.number(),
      }),
    ),

    // Research status
    researchStatus: v.union(
      v.literal("none"),
      v.literal("fast_pass_queued"),
      v.literal("fast_pass_complete"),
      v.literal("deep_dive_queued"),
      v.literal("deep_dive_running"),
      v.literal("complete"),
    ),

    // Fast-pass results (inline for <10s display)
    fastPassResults: v.optional(
      v.object({
        entitySummaries: v.array(
          v.object({
            entityName: v.string(),
            summary: v.string(),
            keyFacts: v.array(v.string()),
            fundingStage: v.optional(v.string()),
            lastFundingAmount: v.optional(v.string()),
            sector: v.optional(v.string()),
          }),
        ),
        generatedAt: v.number(),
        elapsedMs: v.number(),
      }),
    ),

    // Deep dive reference
    ddJobId: v.optional(v.string()),
    ddMemoId: v.optional(v.id("dueDiligenceMemos")),

    // Follow-up tracking
    followUpRequested: v.boolean(),
    followUpDate: v.optional(v.number()),
    followUpTaskId: v.optional(v.id("userEvents")),
    suggestedNextAction: v.optional(v.string()),

    // Timestamps
    capturedAt: v.number(),
    enrichedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "researchStatus"])
    .index("by_source", ["sourceType", "sourceId"])
    .index("by_user_captured", ["userId", "capturedAt"])
    .index("by_dd_job", ["ddJobId"])
    .searchIndex("search_encounter", {
      searchField: "rawText",
      filterFields: ["userId", "researchStatus"],
    }),

  /* ================================================================== */
  /* NEWS ITEMS - Ingested content from feed sources for blip pipeline  */
  /* ================================================================== */
  newsItems: defineTable({
    // Unique identification
    sourceId: v.string(),
    contentHash: v.string(),

    // Source metadata
    source: v.union(
      v.literal("hacker_news"),
      v.literal("arxiv"),
      v.literal("reddit"),
      v.literal("rss"),
      v.literal("github"),
      v.literal("product_hunt"),
      v.literal("dev_to"),
      v.literal("twitter"),
      v.literal("manual"),
    ),
    sourceUrl: v.string(),

    // Content
    title: v.string(),
    fullContent: v.optional(v.string()),
    summary: v.optional(v.string()),

    // Classification
    category: v.union(
      v.literal("tech"),
      v.literal("ai_ml"),
      v.literal("funding"),
      v.literal("research"),
      v.literal("security"),
      v.literal("startup"),
      v.literal("product"),
      v.literal("regulatory"),
      v.literal("markets"),
      v.literal("general"),
    ),
    tags: v.array(v.string()),

    // Engagement metrics (for ranking)
    engagementScore: v.number(),
    rawMetrics: v.optional(
      v.object({
        upvotes: v.optional(v.number()),
        comments: v.optional(v.number()),
        shares: v.optional(v.number()),
        stars: v.optional(v.number()),
      }),
    ),

    // Processing status
    processingStatus: v.union(
      v.literal("ingested"),
      v.literal("claim_extraction"),
      v.literal("blips_generated"),
      v.literal("verification_queued"),
      v.literal("complete"),
    ),

    // Timestamps
    publishedAt: v.number(),
    ingestedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("by_source_id", ["sourceId"])
    .index("by_content_hash", ["contentHash"])
    .index("by_source", ["source", "publishedAt"])
    .index("by_category", ["category", "publishedAt"])
    .index("by_status", ["processingStatus"])
    .index("by_engagement", ["engagementScore"])
    .index("by_published", ["publishedAt"]),

  /* ================================================================== */
  /* CLAIM SPANS - Extracted atomic claims from news items              */
  /* ================================================================== */
  claimSpans: defineTable({
    newsItemId: v.id("newsItems"),

    // Claim content
    claimText: v.string(),
    originalSpan: v.string(),
    spanStartIdx: v.number(),
    spanEndIdx: v.number(),

    // Classification
    claimType: v.union(
      v.literal("factual"),
      v.literal("quantitative"),
      v.literal("attribution"),
      v.literal("temporal"),
      v.literal("causal"),
      v.literal("comparative"),
      v.literal("predictive"),
      v.literal("opinion"),
    ),

    // Entities mentioned
    entities: v.array(
      v.object({
        name: v.string(),
        type: v.union(
          v.literal("company"),
          v.literal("person"),
          v.literal("product"),
          v.literal("technology"),
          v.literal("organization"),
          v.literal("location"),
        ),
        linkedEntityId: v.optional(v.id("entityContexts")),
      }),
    ),

    // Verification status
    verificationStatus: v.union(
      v.literal("unverified"),
      v.literal("pending"),
      v.literal("verified"),
      v.literal("partially_verified"),
      v.literal("contradicted"),
      v.literal("unverifiable"),
    ),
    verificationId: v.optional(v.id("blipClaimVerifications")),

    // Confidence
    extractionConfidence: v.number(),

    createdAt: v.number(),
  })
    .index("by_news_item", ["newsItemId"])
    .index("by_verification", ["verificationStatus"])
    .index("by_type", ["claimType"]),

  /* ================================================================== */
  /* MEANING BLIPS - Universal blips with persona lens at render time   */
  /* ================================================================== */
  meaningBlips: defineTable({
    // Source linkage
    newsItemId: v.id("newsItems"),
    claimSpanId: v.optional(v.id("claimSpans")),

    // Core blip content (UNIVERSAL - no persona baked in)
    headline: v.string(), // 5-word version
    summary: v.string(), // 10-word version
    context: v.string(), // 20-word version

    // Key facts for hover popover
    keyFacts: v.array(
      v.object({
        fact: v.string(),
        source: v.optional(v.string()),
        date: v.optional(v.string()),
        confidence: v.number(),
      }),
    ),

    // Entity spotlight
    primaryEntity: v.optional(
      v.object({
        name: v.string(),
        type: v.string(),
        linkedEntityId: v.optional(v.id("entityContexts")),
      }),
    ),

    // Verification summary
    verificationSummary: v.object({
      totalClaims: v.number(),
      verifiedClaims: v.number(),
      contradictedClaims: v.number(),
      overallConfidence: v.number(),
    }),

    // Source attribution
    sources: v.array(
      v.object({
        name: v.string(),
        url: v.optional(v.string()),
        publishedAt: v.optional(v.number()),
        reliability: v.union(
          v.literal("authoritative"),
          v.literal("reliable"),
          v.literal("secondary"),
          v.literal("inferred"),
        ),
      }),
    ),

    // Ranking signals
    relevanceScore: v.number(),
    engagementScore: v.number(),
    freshnessScore: v.number(),

    // Category for filtering
    category: v.string(),
    tags: v.array(v.string()),

    // Timestamps
    publishedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_news_item", ["newsItemId"])
    .index("by_category", ["category", "publishedAt"])
    .index("by_relevance", ["relevanceScore"])
    .index("by_published", ["publishedAt"]),

  /* ================================================================== */
  /* PERSONA LENSES - Pre-computed persona-specific view hints          */
  /* ================================================================== */
  personaLenses: defineTable({
    blipId: v.id("meaningBlips"),
    personaId: v.string(), // "JPM_STARTUP_BANKER", "EARLY_STAGE_VC", etc.

    // Persona-specific framing
    framingHook: v.string(),
    actionPrompt: v.optional(v.string()),
    relevanceScore: v.number(),

    // Why it matters for this persona
    whyItMatters: v.optional(v.string()),

    createdAt: v.number(),
  })
    .index("by_blip", ["blipId"])
    .index("by_persona", ["personaId", "relevanceScore"])
    .index("by_blip_persona", ["blipId", "personaId"]),

  /* ================================================================== */
  /* BLIP CLAIM VERIFICATIONS - LLM-as-judge verification results       */
  /* ================================================================== */
  blipClaimVerifications: defineTable({
    claimSpanId: v.id("claimSpans"),

    // Verification result
    verdict: v.union(
      v.literal("verified"),
      v.literal("partially_verified"),
      v.literal("contradicted"),
      v.literal("unverifiable"),
      v.literal("insufficient_evidence"),
    ),
    confidence: v.number(),

    // Evidence
    supportingEvidence: v.array(
      v.object({
        sourceUrl: v.optional(v.string()),
        sourceName: v.string(),
        snippet: v.string(),
        publishedAt: v.optional(v.number()),
        alignment: v.union(
          v.literal("supports"),
          v.literal("contradicts"),
          v.literal("neutral"),
        ),
      }),
    ),

    // Contradictions found
    contradictions: v.optional(
      v.array(
        v.object({
          contradictingClaim: v.string(),
          sourceUrl: v.optional(v.string()),
          sourceName: v.string(),
        }),
      ),
    ),

    // LLM judge metadata
    judgeModel: v.string(),
    judgeReasoning: v.string(),

    // Timing
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_claim", ["claimSpanId"])
    .index("by_verdict", ["verdict"])
    .index("by_confidence", ["confidence"]),

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   * KNOWLEDGE PRODUCT LAYER
   * Source Registry, Diff Tracking, and Skill Tree for curriculum management.
   * See: convex/domains/knowledge/ for mutations/queries.
   * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

  /* ------------------------------------------------------------------ */
  /* SOURCE REGISTRY - Authoritative source curation with trust metadata */
  /* ------------------------------------------------------------------ */
  sourceRegistry: defineTable({
    // Identity
    registryId: v.string(), // sr_<domain>_<slug>
    domain: v.string(), // "anthropic", "openai", "gemini", etc.

    // Source metadata
    canonicalUrl: v.string(),
    name: v.string(), // "Claude Prompt Library"
    category: v.union(
      v.literal("official_docs"),
      v.literal("prompt_library"),
      v.literal("changelog"),
      v.literal("github_repo"),
      v.literal("pricing"),
      v.literal("api_reference"),
      v.literal("newsletter"),
      v.literal("observability"),
      v.literal("framework_docs"),
    ),

    // Trust metadata
    trustRationale: v.string(), // "Official Anthropic documentation"
    reliabilityTier: v.union(
      v.literal("authoritative"), // Primary source (official docs, SEC filings)
      v.literal("reliable"), // Vetted secondary source
      v.literal("secondary"), // Community/third-party
    ),

    // Freshness
    refreshCadence: v.union(
      v.literal("hourly"),
      v.literal("daily"),
      v.literal("weekly"),
      v.literal("manual"),
    ),
    lastFetchedAt: v.optional(v.number()),
    lastChangedAt: v.optional(v.number()),
    currentContentHash: v.optional(v.string()),

    // Licensing
    usageConstraints: v.union(
      v.literal("internal_only"),
      v.literal("shareable_with_attribution"),
      v.literal("public_domain"),
    ),

    // Status
    isActive: v.boolean(),
    isPinned: v.boolean(), // Always include in dossiers

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_registryId", ["registryId"])
    .index("by_domain", ["domain"])
    .index("by_category", ["category"])
    .index("by_pinned", ["isPinned", "domain"])
    .index("by_active", ["isActive", "domain"]),

  /* ------------------------------------------------------------------ */
  /* SOURCE SNAPSHOTS - Point-in-time captures for diff tracking         */
  /* ------------------------------------------------------------------ */
  sourceSnapshots: defineTable({
    registryId: v.string(),
    snapshotAt: v.number(),
    contentHash: v.string(),
    rawContent: v.optional(v.string()), // Full content for diff (if small)
    contentStorageId: v.optional(v.id("_storage")), // For large content
    extractedSections: v.optional(
      v.array(
        v.object({
          sectionId: v.string(),
          title: v.string(),
          contentHash: v.string(),
        }),
      ),
    ),

    // Metadata
    httpStatus: v.optional(v.number()),
    contentLength: v.optional(v.number()),
    fetchDurationMs: v.optional(v.number()),
  })
    .index("by_registryId", ["registryId"])
    .index("by_registry_time", ["registryId", "snapshotAt"])
    .index("by_snapshotAt", ["snapshotAt"]),

  /* ------------------------------------------------------------------ */
  /* SOURCE DIFFS - Detected changes between snapshots                   */
  /* ------------------------------------------------------------------ */
  sourceDiffs: defineTable({
    registryId: v.string(),
    fromSnapshotAt: v.number(),
    toSnapshotAt: v.number(),

    // Change summary
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
      v.literal("minor_update"),
    ),
    severity: v.union(
      v.literal("critical"), // Breaking changes, major deprecations
      v.literal("high"), // Significant new features, important updates
      v.literal("medium"), // Notable changes worth tracking
      v.literal("low"), // Minor updates, typo fixes
    ),

    // Human-readable
    changeTitle: v.string(), // "New tool_use parameter added"
    changeSummary: v.string(), // 2-3 sentence explanation
    affectedSections: v.array(v.string()),

    // Raw diff
    diffHunks: v.optional(
      v.array(
        v.object({
          type: v.union(
            v.literal("add"),
            v.literal("remove"),
            v.literal("modify"),
          ),
          oldText: v.optional(v.string()),
          newText: v.optional(v.string()),
          context: v.optional(v.string()),
        }),
      ),
    ),

    // Classification metadata
    classifiedBy: v.optional(v.string()), // "llm" | "rules" | "human"
    classificationConfidence: v.optional(v.number()),

    detectedAt: v.number(),
  })
    .index("by_registryId", ["registryId"])
    .index("by_registry_time", ["registryId", "detectedAt"])
    .index("by_severity", ["severity", "detectedAt"])
    .index("by_changeType", ["changeType", "detectedAt"])
    .index("by_detectedAt", ["detectedAt"]),

  /* ------------------------------------------------------------------ */
  /* SKILL NODES - Hierarchical knowledge curriculum                     */
  /* ------------------------------------------------------------------ */
  skillNodes: defineTable({
    skillId: v.string(), // "llm_basics", "tool_use", "agent_orchestration"

    // Hierarchy
    parentSkillId: v.optional(v.string()),
    depth: v.number(), // 0 = foundation, 1 = intermediate, 2 = advanced, 3 = expert

    // Metadata
    title: v.string(),
    description: v.string(),
    domain: v.string(), // "foundations", "agent_systems", "production", "evaluation"

    // Prerequisites
    prerequisiteSkillIds: v.array(v.string()),

    // Linked content
    artifactIds: v.array(v.string()), // Linked reading materials (globalArtifact keys)
    registrySourceIds: v.array(v.string()), // Linked authoritative sources

    // Progression
    estimatedHours: v.optional(v.number()),
    milestones: v.array(
      v.object({
        milestoneId: v.string(),
        title: v.string(),
        criteria: v.string(),
      }),
    ),

    // Curation
    isAdminCurated: v.boolean(), // Admin-curated vs user-created
    createdBy: v.optional(v.id("users")),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_skillId", ["skillId"])
    .index("by_domain", ["domain", "depth"])
    .index("by_parent", ["parentSkillId"])
    .index("by_admin_curated", ["isAdminCurated", "domain"]),

  /* ------------------------------------------------------------------ */
  /* USER SKILL PROGRESS - Per-user progress tracking                    */
  /* ------------------------------------------------------------------ */
  userSkillProgress: defineTable({
    userId: v.id("users"),
    skillId: v.string(),

    status: v.union(
      v.literal("not_started"),
      v.literal("in_progress"),
      v.literal("completed"),
    ),
    completedMilestones: v.array(v.string()),

    // Reading progress
    artifactsRead: v.array(v.string()),
    lastActivityAt: v.number(),

    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_skill", ["userId", "skillId"])
    .index("by_skill", ["skillId"])
    .index("by_status", ["status", "userId"]),

  /* ================================================================== */
  /* FINANCIAL ANALYSIS EVALUATION SYSTEM                                */
  /* ================================================================== */

  /* ------------------------------------------------------------------ */
  /* GROUND TRUTH VERSIONS - Versioned, auditable ground truth           */
  /* ------------------------------------------------------------------ */
  groundTruthVersions: defineTable({
    // Identity
    entityKey: v.string(), // "NVDA" or "openai-series-e"
    version: v.number(), // Monotonic version number

    // Lifecycle status
    status: v.union(
      v.literal("draft"), // Author editing
      v.literal("pending_review"), // Awaiting second reviewer
      v.literal("approved"), // Two-person sign-off
      v.literal("superseded"), // Replaced by newer version
      v.literal("rejected"), // Review rejected
    ),

    // Frozen snapshot (immutable once approved)
    snapshotArtifactId: v.id("sourceArtifacts"), // Links to frozen JSON
    snapshotHash: v.string(), // SHA-256 of snapshot content

    // Authorship
    authorId: v.id("users"),
    reviewerId: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),

    // Change tracking
    changeNote: v.string(), // What changed from previous version
    previousVersionId: v.optional(v.id("groundTruthVersions")),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity_version", ["entityKey", "version"])
    .index("by_entity_status", ["entityKey", "status"])
    .index("by_author", ["authorId", "status"]),

  /* ------------------------------------------------------------------ */
  /* GROUND TRUTH AUDIT LOG - Audit trail for ground truth mutations     */
  /* ------------------------------------------------------------------ */
  groundTruthAuditLog: defineTable({
    versionId: v.id("groundTruthVersions"),
    entityKey: v.string(),

    action: v.union(
      v.literal("created"),
      v.literal("submitted_for_review"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("superseded"),
      v.literal("rollback"),
    ),

    actorId: v.id("users"),
    reason: v.optional(v.string()),
    metadata: v.optional(v.any()), // Action-specific data

    createdAt: v.number(),
  })
    .index("by_version", ["versionId", "createdAt"])
    .index("by_entity", ["entityKey", "createdAt"])
    .index("by_actor", ["actorId", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* GROUND TRUTH FINANCIALS - SEC EDGAR cached financial data          */
  /* ------------------------------------------------------------------ */
  groundTruthFinancials: defineTable({
    ticker: v.string(),
    cik: v.string(), // SEC CIK number
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()), // null for annual

    // Income Statement
    revenue: v.optional(v.number()),
    costOfRevenue: v.optional(v.number()),
    grossProfit: v.optional(v.number()),
    operatingIncome: v.optional(v.number()),
    netIncome: v.optional(v.number()),

    // Balance Sheet
    totalAssets: v.optional(v.number()),
    totalLiabilities: v.optional(v.number()),
    totalEquity: v.optional(v.number()),

    // Cash Flow
    operatingCashFlow: v.optional(v.number()),
    freeCashFlow: v.optional(v.number()),

    // Computed metrics
    grossMargin: v.optional(v.number()),
    operatingMargin: v.optional(v.number()),
    netMargin: v.optional(v.number()),

    // Source metadata
    sourceUrl: v.string(), // SEC EDGAR URL
    filingDate: v.string(), // ISO date
    fetchedAt: v.number(),
  })
    .index("by_ticker_year", ["ticker", "fiscalYear", "fiscalQuarter"])
    .index("by_cik", ["cik", "fiscalYear"])
    .index("by_ticker", ["ticker", "fetchedAt"]),

  /* ------------------------------------------------------------------ */
  /* GROUND TRUTH MARKET DATA - Alpha Vantage cached market metrics     */
  /* ------------------------------------------------------------------ */
  groundTruthMarketData: defineTable({
    ticker: v.string(),

    // Market data (from Alpha Vantage GLOBAL_QUOTE)
    currentPrice: v.optional(v.number()),
    volume: v.optional(v.number()),
    previousClose: v.optional(v.number()),
    changePercent: v.optional(v.number()),

    // Additional metrics (from Alpha Vantage OVERVIEW or manual seeding)
    marketCap: v.optional(v.number()),
    beta: v.optional(v.number()),
    forwardPE: v.optional(v.number()),

    // Analyst estimates (from manual seeding)
    analystTargetPrice: v.optional(v.number()),
    analystRecommendation: v.optional(v.string()),

    // Source metadata
    sourceUrl: v.string(),
    fetchedAt: v.number(),
  })
    .index("by_ticker", ["ticker"])
    .index("by_fetched", ["fetchedAt"]),

  /* ------------------------------------------------------------------ */
  /* DCF PROGRESS SESSIONS - Workflow state tracking                   */
  /* ------------------------------------------------------------------ */
  dcfProgressSessions: defineTable({
    sessionId: v.string(),
    ticker: v.string(),
    userId: v.optional(v.string()),
    scenario: v.string(),

    // Workflow state
    steps: v.any(), // Array of ProgressStep objects
    currentStep: v.number(),
    status: v.string(), // "initialized" | "in_progress" | "completed" | "failed" | "rolled_back" | "branched"

    // Branching support (LangGraph-style)
    parentSessionId: v.optional(v.string()),
    branchedFrom: v.optional(v.number()),

    // Results
    finalResult: v.optional(v.any()),
    error: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
  })
    .index("by_session_id", ["sessionId"])
    .index("by_ticker", ["ticker", "createdAt"])
    .index("by_status", ["status", "updatedAt"]),

  /* ------------------------------------------------------------------ */
  /* DCF SESSIONS - Interactive DCF model state                          */
  /* ------------------------------------------------------------------ */
  dcfSessions: defineTable({
    sessionId: v.string(),
    userId: v.optional(v.id("users")), // Optional to allow guest users
    ticker: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),

    // Optional link to a generated spreadsheet for real-time sync
    spreadsheetId: v.optional(v.id("spreadsheets")),

    // Editable parameters
    parameters: v.object({
      baseRevenue: v.number(),
      revenueGrowthRates: v.array(v.number()), // [Y1..Y5] decimals (e.g., 0.10)
      terminalGrowth: v.number(), // decimal (e.g., 0.03)

      grossMargin: v.array(v.number()),
      operatingMargin: v.array(v.number()),

      riskFreeRate: v.number(), // decimal (e.g., 0.042)
      beta: v.number(),
      marketRiskPremium: v.number(), // decimal (e.g., 0.075)
      costOfDebt: v.number(),
      taxRate: v.number(),
      debtWeight: v.number(),

      baseFCF: v.number(),
      sharesOutstanding: v.number(),
      netDebt: v.number(),
    }),

    // Calculated results
    results: v.object({
      wacc: v.number(),
      fcfProjections: v.array(
        v.object({
          year: v.number(),
          fcf: v.number(),
          growthRate: v.number(),
        }),
      ),
      terminalValue: v.number(),
      enterpriseValue: v.number(),
      equityValue: v.number(),
      fairValuePerShare: v.number(),
      evaluationScore: v.number(),
    }),

    // Edit history
    history: v.array(
      v.object({
        timestamp: v.number(),
        field: v.string(),
        oldValue: v.any(),
        newValue: v.any(),
        triggeredBy: v.union(v.literal("user"), v.literal("agent")),
      }),
    ),
  })
    .index("by_session_id", ["sessionId"])
    .index("by_user", ["userId"])
    .index("by_spreadsheet", ["spreadsheetId"]),

  /* ------------------------------------------------------------------ */
  /* BALANCE SHEET DATA - Real balance sheet metrics from SEC EDGAR     */
  /* ------------------------------------------------------------------ */
  balanceSheetData: defineTable({
    ticker: v.string(),
    fiscalYear: v.number(),

    // Balance sheet items
    sharesOutstanding: v.optional(v.number()),
    totalDebt: v.optional(v.number()),
    cash: v.optional(v.number()),
    netDebt: v.optional(v.number()),
    totalAssets: v.optional(v.number()),
    totalEquity: v.optional(v.number()),

    // Source metadata
    source: v.string(), // "sec_edgar" | "manual"
    sourceUrl: v.string(),
    fetchedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_ticker_year", ["ticker", "fiscalYear"])
    .index("by_ticker", ["ticker", "fetchedAt"]),

  /* ------------------------------------------------------------------ */
  /* FINANCIAL FUNDAMENTALS - Normalized SEC XBRL data                   */
  /* ------------------------------------------------------------------ */
  financialFundamentals: defineTable({
    // Identity
    ticker: v.string(), // "NVDA"
    cik: v.string(), // SEC CIK number
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()), // null = annual

    // Source provenance
    sourceArtifactId: v.id("sourceArtifacts"), // Original 10-K/10-Q
    xbrlUrl: v.string(), // SEC EDGAR URL
    filingDate: v.string(), // ISO date

    // Income Statement (in thousands)
    incomeStatement: v.object({
      revenue: v.number(),
      costOfRevenue: v.optional(v.number()),
      grossProfit: v.optional(v.number()),
      operatingExpenses: v.optional(v.number()),
      operatingIncome: v.optional(v.number()),
      netIncome: v.number(),
      eps: v.optional(v.number()),
      sharesOutstanding: v.optional(v.number()),
    }),

    // Balance Sheet
    balanceSheet: v.object({
      totalAssets: v.number(),
      totalLiabilities: v.number(),
      totalEquity: v.number(),
      cash: v.optional(v.number()),
      totalDebt: v.optional(v.number()),
      currentAssets: v.optional(v.number()),
      currentLiabilities: v.optional(v.number()),
    }),

    // Cash Flow
    cashFlow: v.object({
      operatingCashFlow: v.number(),
      capex: v.optional(v.number()),
      freeCashFlow: v.optional(v.number()),
      dividendsPaid: v.optional(v.number()),
      shareRepurchases: v.optional(v.number()),
    }),

    // Computed metrics
    metrics: v.optional(
      v.object({
        grossMargin: v.optional(v.number()),
        operatingMargin: v.optional(v.number()),
        netMargin: v.optional(v.number()),
        roic: v.optional(v.number()),
        roe: v.optional(v.number()),
        debtToEquity: v.optional(v.number()),
      }),
    ),

    // Data quality
    extractionConfidence: v.number(), // 0-1
    manualOverrides: v.optional(v.array(v.string())), // Fields manually corrected

    // Full provenance tracking for each normalized field
    // Maps field path (e.g., "incomeStatement.revenue") to provenance metadata
    fieldProvenance: v.optional(
      v.array(
        v.object({
          fieldPath: v.string(), // e.g., "incomeStatement.revenue"
          tag: v.string(), // Original XBRL concept name
          namespace: v.string(), // "us-gaap", "dei", "ifrs-full", or custom namespace
          units: v.string(), // "USD", "shares", "pure"
          periodStart: v.optional(v.string()), // ISO date for duration facts
          periodEnd: v.string(), // ISO date (end or instant)
          fiscalPeriod: v.string(), // "FY", "Q1", "Q2", "Q3", "Q4"
          formType: v.string(), // "10-K", "10-Q", etc.
          accessionNumber: v.string(), // SEC accession number
          filedDate: v.string(), // When filing was submitted
          dimensions: v.optional(
            v.array(
              v.object({
                // Dimensional qualifiers
                axis: v.string(),
                member: v.string(),
              }),
            ),
          ),
          selectionRationale: v.string(), // Why this tag was selected
          isCustomTag: v.boolean(), // Custom extension vs standard taxonomy
          alternativeTags: v.optional(v.array(v.string())), // Other tags considered
          isComputed: v.optional(v.boolean()), // True if derived/calculated
          computedFrom: v.optional(v.array(v.string())), // Source fields if computed
        }),
      ),
    ),

    // Quality flags
    hasCustomTags: v.optional(v.boolean()), // True if any field uses custom tags
    customTagCount: v.optional(v.number()), // Number of fields with custom tags
    needsReview: v.optional(v.boolean()), // Flag for manual review

    // Dimensional data strategy tracking
    // See xbrlParser.ts for full documentation of the CONSOLIDATED_ONLY approach
    dimensionalStrategy: v.optional(
      v.union(
        v.literal("CONSOLIDATED_ONLY"), // Extract only total/consolidated figures (current)
        v.literal("SEGMENT_AWARE"), // Extract segment-level data with reconciliation (future)
        v.literal("FULL_DIMENSIONAL"), // Extract all dimensional combinations (future)
      ),
    ),
    dimensionalFactsEncountered: v.optional(v.number()), // Total dimensional facts seen
    dimensionalFactsSkipped: v.optional(v.number()), // Dimensional facts not extracted
    hasSegmentData: v.optional(v.boolean()), // True if company reports segment data

    // Taxonomy version provenance (critical for reproducibility)
    // See taxonomyManagement.ts for full documentation
    taxonomyProvenance: v.optional(
      v.object({
        primaryTaxonomy: v.object({
          family: v.string(),
          releaseYear: v.number(),
          versionId: v.string(),
          effectiveDate: v.string(),
          taxonomyUrl: v.optional(v.string()),
          changeNotes: v.optional(v.array(v.string())),
        }),
        detectedNamespaces: v.array(v.string()),
        resolvedVersions: v.array(
          v.object({
            family: v.string(),
            releaseYear: v.number(),
            versionId: v.string(),
            effectiveDate: v.string(),
            taxonomyUrl: v.optional(v.string()),
            changeNotes: v.optional(v.array(v.string())),
          }),
        ),
        tagNormalizations: v.array(
          v.object({
            originalTag: v.string(),
            normalizedTag: v.string(),
            reason: v.string(),
          }),
        ),
        extractionEngineVersion: v.string(),
        tagMappingRevision: v.string(),
        extractedAt: v.number(),
      }),
    ),

    createdAt: v.number(),
  })
    .index("by_ticker_period", ["ticker", "fiscalYear", "fiscalQuarter"])
    .index("by_cik", ["cik", "fiscalYear"])
    .index("by_source", ["sourceArtifactId"])
    .index("by_needs_review", ["needsReview", "ticker"]),

  /* ------------------------------------------------------------------ */
  /* RESTATEMENT OVERRIDES - Manual filing selection overrides          */
  /* ------------------------------------------------------------------ */
  // When multiple filings exist for the same period (e.g., 10-K and 10-K/A),
  // default policy is "latest wins". Overrides allow pinning to specific filing.
  restatementOverrides: defineTable({
    ticker: v.string(),
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()),

    // Pinned filing
    pinnedAccession: v.string(), // SEC accession number to use
    reason: v.string(), // Why override was created

    // Authorship
    createdBy: v.string(), // User ID or "system"
    createdAt: v.number(),
    updatedAt: v.number(),

    // Expiration (optional - for temporary overrides)
    expiresAt: v.optional(v.number()),
  })
    .index("by_ticker", ["ticker"])
    .index("by_ticker_period", ["ticker", "fiscalYear", "fiscalQuarter"]),

  /* ------------------------------------------------------------------ */
  /* RESTATEMENT DECISION LOG - Audit trail for filing selections       */
  /* ------------------------------------------------------------------ */
  // Records every decision made when selecting between multiple filings.
  // Critical for reproducibility and debugging.
  restatementDecisionLog: defineTable({
    ticker: v.string(),
    fiscalYear: v.number(),
    fiscalQuarter: v.optional(v.number()),

    // Decision
    selectedAccession: v.string(),
    selectionMethod: v.string(), // "latest_wins", "manual_override", "pinned"
    reason: v.string(),

    // Available options
    availableAccessions: v.array(v.string()),

    // Override status
    hasOverride: v.boolean(),

    // Context
    runId: v.optional(v.string()),

    decidedAt: v.number(),
  })
    .index("by_ticker_period", ["ticker", "fiscalYear"])
    .index("by_decided_at", ["decidedAt"]),

  /* ------------------------------------------------------------------ */
  /* INCONCLUSIVE EVENT LOG - Track external dependency failures        */
  /* ------------------------------------------------------------------ */
  // Logs all "inconclusive" events when external dependencies fail.
  // Critical for monitoring, debugging, and SLO tracking.
  inconclusiveEventLog: defineTable({
    // Failure details
    dependency: v.string(), // "sec_edgar", "financial_api", etc.
    category: v.string(), // "api_error", "timeout", "rate_limited", etc.
    message: v.string(),
    retriable: v.boolean(),
    httpStatus: v.optional(v.number()),
    retryAfterMs: v.optional(v.number()),

    // Additional context
    context: v.optional(v.any()),

    // Entity context (optional)
    ticker: v.optional(v.string()),
    fiscalYear: v.optional(v.number()),
    operation: v.optional(v.string()), // What operation was attempted
    runId: v.optional(v.string()),

    occurredAt: v.number(),
  })
    .index("by_dependency", ["dependency", "occurredAt"])
    .index("by_occurred_at", ["occurredAt"])
    .index("by_category", ["category", "occurredAt"]),

  /* ------------------------------------------------------------------ */
  /* MODEL CARDS - MRM-style model documentation                        */
  /* ------------------------------------------------------------------ */
  // Model Risk Management documentation for enterprise compliance.
  // Aligned with SR 11-7, OCC 2011-12 regulatory frameworks.
  modelCards: defineTable({
    modelId: v.string(), // Unique model identifier
    name: v.string(), // Human-readable name
    version: v.string(), // Version string
    description: v.string(), // Brief description

    // Classification
    riskTier: v.string(), // tier1_critical, tier2_significant, etc.
    status: v.string(), // development, validation, approved, etc.
    useCase: v.string(), // valuation, risk_assessment, etc.

    // Ownership
    owner: v.string(), // Model owner (individual or team)

    // Validation tracking
    lastValidationDate: v.optional(v.string()),
    nextValidationDate: v.optional(v.string()),

    // Documentation
    keyLimitations: v.array(v.string()),
    compensatingControls: v.array(v.string()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_model_id", ["modelId"])
    .index("by_risk_tier", ["riskTier", "status"])
    .index("by_next_validation", ["nextValidationDate"]),

  /* ------------------------------------------------------------------ */
  /* MODEL PERFORMANCE METRICS - Ongoing monitoring                     */
  /* ------------------------------------------------------------------ */
  modelPerformanceMetrics: defineTable({
    modelId: v.string(),
    version: v.string(),

    // Reporting period
    periodStart: v.string(),
    periodEnd: v.string(),

    // Usage metrics
    totalExecutions: v.number(),
    uniqueUsers: v.number(),
    averageLatencyMs: v.number(),
    errorRate: v.number(),
    inconclusiveRate: v.number(),

    recordedAt: v.number(),
  })
    .index("by_model_period", ["modelId", "periodStart"])
    .index("by_recorded_at", ["recordedAt"]),

  /* ------------------------------------------------------------------ */
  /* SOURCE QUALITY LOG - Calibration data for source scoring           */
  /* ------------------------------------------------------------------ */
  // Logs every source quality classification for calibration/audit.
  // Human labels enable threshold tuning and accuracy measurement.
  sourceQualityLog: defineTable({
    // Source identification
    url: v.string(),
    domain: v.string(),
    sourceDate: v.optional(v.string()),
    metadata: v.optional(v.any()),

    // Classification result
    tier: v.string(), // tier1_authoritative, etc.
    score: v.number(), // 0-100
    matchedRules: v.array(v.string()),
    confidence: v.number(),
    scoreBreakdown: v.object({
      domainScore: v.number(),
      freshnessScore: v.number(),
      metadataScore: v.number(),
      citationScore: v.number(),
    }),

    // Context
    entityKey: v.optional(v.string()),
    evaluationId: v.optional(v.string()),

    // Calibration labels (filled by human reviewers)
    humanLabel: v.optional(
      v.union(
        v.literal("appropriate"),
        v.literal("over_scored"),
        v.literal("under_scored"),
        v.literal("wrong_tier"),
      ),
    ),
    suggestedTier: v.optional(v.string()),
    suggestedScore: v.optional(v.number()),
    labelNotes: v.optional(v.string()),
    labeledBy: v.optional(v.string()),
    labeledAt: v.optional(v.number()),

    classifiedAt: v.number(),
  })
    .index("by_classified_at", ["classifiedAt"])
    .index("by_domain", ["domain", "classifiedAt"])
    .index("by_tier", ["tier", "classifiedAt"])
    .index("by_labeled", ["humanLabel", "labeledAt"]),

  /* ------------------------------------------------------------------ */
  /* DCF MODELS - Executable DCF model representation                    */
  /* ------------------------------------------------------------------ */
  dcfModels: defineTable({
    // Identity
    modelId: v.string(), // UUID
    entityKey: v.string(), // "NVDA"
    version: v.number(),

    // Source (AI-generated or analyst)
    origin: v.union(
      v.literal("ai_generated"),
      v.literal("analyst"),
      v.literal("hybrid"),
    ),
    authorId: v.optional(v.id("users")),
    runId: v.optional(v.id("agentRuns")),

    // Model inputs - stored as artifact for immutability
    inputsArtifactId: v.id("sourceArtifacts"), // JSON of all inputs

    // Core assumptions (denormalized for queries)
    assumptions: v.object({
      // Forecast horizon
      forecastYears: v.number(), // Typically 5-10
      baseYear: v.number(), // FY from which projections start

      // Revenue assumptions
      revenue: v.object({
        baseRevenue: v.number(),
        growthRates: v.array(
          v.object({
            year: v.number(),
            rate: v.number(),
            rationale: v.string(),
            sourceChunkId: v.optional(v.string()), // Citation
          }),
        ),
        terminalGrowthRate: v.number(),
      }),

      // Operating assumptions
      operating: v.object({
        grossMargin: v.array(v.object({ year: v.number(), value: v.number() })),
        sgaPercent: v.array(v.object({ year: v.number(), value: v.number() })),
        rdPercent: v.optional(
          v.array(v.object({ year: v.number(), value: v.number() })),
        ),
        daPercent: v.array(v.object({ year: v.number(), value: v.number() })),
        capexPercent: v.array(
          v.object({ year: v.number(), value: v.number() }),
        ),
        nwcPercent: v.array(v.object({ year: v.number(), value: v.number() })),
      }),

      // WACC components
      wacc: v.object({
        riskFreeRate: v.number(),
        marketRiskPremium: v.number(),
        beta: v.number(),
        costOfEquity: v.number(),
        costOfDebt: v.number(),
        taxRate: v.number(),
        debtWeight: v.number(),
        equityWeight: v.number(),
        wacc: v.number(),
        sources: v.array(v.string()),
      }),

      // Terminal value
      terminal: v.object({
        method: v.union(v.literal("perpetuity"), v.literal("exit_multiple")),
        perpetuityGrowth: v.optional(v.number()),
        exitMultiple: v.optional(v.number()),
        exitMultipleType: v.optional(v.string()), // "EV/EBITDA", "EV/Revenue"
      }),

      // Capital structure / dilution
      capitalStructure: v.optional(
        v.object({
          currentShares: v.number(),
          expectedDilution: v.optional(v.number()), // Annual dilution rate
          netDebt: v.optional(v.number()),
        }),
      ),
    }),

    // Computed outputs (also stored as artifact for reproducibility)
    outputsArtifactId: v.id("sourceArtifacts"), // JSON of all outputs

    // Summary outputs (denormalized)
    outputs: v.object({
      enterpriseValue: v.number(),
      equityValue: v.number(),
      impliedSharePrice: v.optional(v.number()),
      presentValueFcf: v.number(),
      terminalValue: v.number(),
      terminalValuePercent: v.number(), // % of total EV
    }),

    // Sensitivity analysis
    sensitivity: v.optional(
      v.object({
        waccRange: v.array(v.number()), // e.g., [8%, 9%, 10%, 11%, 12%]
        terminalGrowthRange: v.array(v.number()),
        matrix: v.array(v.array(v.number())), // EV at each combo
      }),
    ),

    // Source citations
    citationArtifactIds: v.array(v.id("sourceArtifacts")),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity_version", ["entityKey", "version"])
    .index("by_run", ["runId"])
    .index("by_origin", ["origin", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* SOURCE QUALITY RULES - Machine-checkable source tier rules          */
  /* ------------------------------------------------------------------ */
  sourceQualityRules: defineTable({
    ruleId: v.string(),
    ruleName: v.string(),

    // Classification
    tier: v.union(
      v.literal("tier1_authoritative"), // SEC, USPTO, official gov
      v.literal("tier2_reliable"), // Earnings calls, IR decks
      v.literal("tier3_secondary"), // Sell-side, industry reports
      v.literal("tier4_news"), // News, press releases
      v.literal("tier5_unverified"), // LLM inference, social media
    ),

    // Detection rules (machine-checkable)
    urlPatterns: v.array(v.string()), // Regex patterns for URLs
    domainAllowlist: v.optional(v.array(v.string())),
    requiredMetadata: v.optional(v.array(v.string())), // e.g., ["filingDate", "cik"]
    maxAgeDays: v.optional(v.number()), // Freshness requirement

    // Scoring
    reliabilityScore: v.number(), // 0-100
    citationWeight: v.number(), // Weight in quality score

    // Examples for training
    examples: v.optional(v.array(v.string())),

    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tier", ["tier", "isActive"])
    .index("by_rule_id", ["ruleId"]),

  /* ------------------------------------------------------------------ */
  /* FINANCIAL MODEL EVALUATIONS - DCF evaluation results                */
  /* ------------------------------------------------------------------ */
  financialModelEvaluations: defineTable({
    evaluationId: v.string(),
    entityName: v.string(), // Ticker or entity identifier
    evaluationType: v.union(
      v.literal("dcf"),
      v.literal("comparables"),
      v.literal("lbo"),
    ),

    // Model references
    aiModelId: v.optional(v.id("dcfModels")),
    groundTruthVersionId: v.optional(v.id("groundTruthVersions")),

    // Scores (0-100)
    assumptionDriftScore: v.number(),
    sourceQualityScore: v.number(),
    modelAlignmentScore: v.number(),
    overallScore: v.number(),

    // Reproducibility gates
    gatesPassed: v.optional(v.boolean()),
    gateResults: v.optional(
      v.object({
        inputCompleteness: v.any(),
        determinismCheck: v.any(),
        provenanceCompleteness: v.any(),
        auditTrail: v.any(),
      }),
    ),

    // Detailed score breakdown
    scoreBreakdown: v.optional(v.any()),

    // Detailed comparisons (legacy)
    assumptionComparison: v.optional(v.any()),
    sourceComparison: v.optional(v.any()),
    formulaComparison: v.optional(v.any()),

    // Verdict
    verdict: v.union(
      v.literal("ALIGNED"),
      v.literal("MINOR_DRIFT"),
      v.literal("SIGNIFICANT_DRIFT"),
      v.literal("METHODOLOGY_MISMATCH"),
    ),

    // Pass/fail flags (legacy)
    passedAssumptionThreshold: v.optional(v.boolean()),
    passedSourceThreshold: v.optional(v.boolean()),
    passedOverall: v.optional(v.boolean()),

    userId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_evaluation_id", ["evaluationId"])
    .index("by_entity", ["entityName", "createdAt"])
    .index("by_verdict", ["verdict", "createdAt"])
    .index("by_model", ["aiModelId"])
    .index("by_groundtruth", ["groundTruthVersionId"]),

  /* ------------------------------------------------------------------ */
  /* MODEL CORRECTION EVENTS - HITL correction capture for learning      */
  /* ------------------------------------------------------------------ */
  modelCorrectionEvents: defineTable({
    // Identity
    correctionId: v.string(),
    evaluationId: v.id("financialModelEvaluations"),
    dcfModelId: v.id("dcfModels"),
    entityKey: v.string(),

    // Correction details
    fieldPath: v.string(), // e.g., "assumptions.revenue.growthRates[0].rate"
    aiValue: v.any(), // Original AI value
    correctedValue: v.any(), // Human-corrected value
    correctionType: v.union(
      v.literal("value_override"), // Simple value change
      v.literal("formula_fix"), // Methodology correction
      v.literal("source_replacement"), // Better source provided
      v.literal("assumption_reject"), // AI assumption rejected entirely
    ),

    // Justification
    reason: v.string(), // Why the correction was made
    betterSourceArtifactId: v.optional(v.id("sourceArtifacts")), // If source replacement

    // Magnitude tracking
    impactOnEv: v.optional(v.number()), // % change to enterprise value
    severityLevel: v.union(
      v.literal("minor"), // <5% EV impact
      v.literal("moderate"), // 5-15% EV impact
      v.literal("significant"), // >15% EV impact
    ),

    // Learning signal
    shouldUpdateGroundTruth: v.boolean(), // Flag for ground truth update
    learningCategory: v.optional(v.string()), // For categorizing patterns

    // Authorship
    correctedBy: v.id("users"),
    reviewedBy: v.optional(v.id("users")),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
    ),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_evaluation", ["evaluationId", "createdAt"])
    .index("by_entity", ["entityKey", "createdAt"])
    .index("by_field_path", ["fieldPath", "correctionType"])
    .index("by_status", ["status", "shouldUpdateGroundTruth"])
    .index("by_severity", ["severityLevel", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* MODEL REPRO PACKS - Reproducibility artifact frozen snapshots       */
  /* ------------------------------------------------------------------ */
  modelReproPacks: defineTable({
    packId: v.string(),
    entityKey: v.string(),

    // Links to immutable artifacts
    dcfModelId: v.id("dcfModels"),
    groundTruthVersionId: v.optional(v.id("groundTruthVersions")),

    // Frozen inputs (legacy format)
    fundamentalsArtifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    sourceArtifactIds: v.optional(v.array(v.id("sourceArtifacts"))),

    // Frozen model (legacy format)
    modelInputsHash: v.optional(v.string()),
    modelOutputsHash: v.optional(v.string()),

    // Full contents (new format - includes all provenance and hashes)
    contents: v.optional(v.any()),

    // Reproducibility validation
    fullyReproducible: v.optional(v.boolean()),

    // Evaluation results (if evaluated)
    evaluationId: v.optional(v.id("financialModelEvaluations")),
    evaluationScore: v.optional(v.number()),

    // Export formats
    exportedSpreadsheetId: v.optional(v.id("_storage")),
    exportedPdfId: v.optional(v.id("_storage")),
    exportedJsonId: v.optional(v.id("_storage")),

    // Metadata
    createdAt: v.number(),
    createdBy: v.optional(v.id("users")),
  })
    .index("by_pack_id", ["packId"])
    .index("by_entity", ["entityKey", "createdAt"])
    .index("by_model", ["dcfModelId"])
    .index("by_groundtruth", ["groundTruthVersionId"])
    .index("by_reproducible", ["fullyReproducible", "createdAt"]),

  /* ================================================================== */
  /* MCP SERVER AUTHENTICATION & ACCESS                                  */
  /* ================================================================== */

  /* ------------------------------------------------------------------ */
  /* MCP API TOKENS - Scoped tokens with rate limits                     */
  /* ------------------------------------------------------------------ */
  mcpApiTokens: defineTable({
    tokenHash: v.string(), // SHA-256 of token (never store plaintext)
    name: v.string(), // Human-readable name

    userId: v.string(),

    // Scopes (OWASP API5: BFLA Prevention)
    scopes: v.array(
      v.union(
        v.literal("read:artifacts"),
        v.literal("read:evaluations"),
        v.literal("read:groundtruth"),
        v.literal("read:models"),
        v.literal("write:evaluations"),
        v.literal("write:corrections"),
        v.literal("write:labels"),
        v.literal("admin:all"),
      ),
    ),

    // Tool allowlists (OWASP API5: Function-level authz)
    allowedTools: v.array(v.string()), // Specific tools or "*" for all

    // Environment restrictions
    allowedEnvironments: v.array(
      v.union(
        v.literal("development"),
        v.literal("staging"),
        v.literal("production"),
      ),
    ),

    // Rate limits (OWASP API4: Resource consumption)
    rateLimit: v.optional(
      v.object({
        requestsPerMinute: v.number(),
        requestsPerHour: v.number(),
        requestsPerDay: v.number(),
        burstAllowance: v.optional(v.number()),
      }),
    ),

    // Lifecycle
    expiresAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),

    createdAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_user", ["userId", "revokedAt"])
    .index("by_expires", ["expiresAt"]),

  /* ------------------------------------------------------------------ */
  /* MCP ACCESS LOG - Audit log for MCP access (OWASP API9, API10)      */
  /* ------------------------------------------------------------------ */
  mcpAccessLog: defineTable({
    tokenId: v.id("mcpApiTokens"),
    userId: v.string(),

    tool: v.string(), // Tool name
    operation: v.string(), // Operation performed
    argsHash: v.string(), // SHA-256 of arguments (not full args for privacy)

    statusCode: v.number(),
    latencyMs: v.number(),

    // Authorization tracking
    authorized: v.boolean(),
    scopesUsed: v.array(v.string()),
    authFailureReason: v.optional(v.string()),

    // Rate limit tracking
    rateLimitHit: v.optional(v.boolean()),
    quotaRemaining: v.optional(
      v.object({
        minute: v.number(),
        hour: v.number(),
        day: v.number(),
      }),
    ),

    createdAt: v.number(),
  })
    .index("by_token", ["tokenId", "createdAt"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_authorized", ["authorized", "createdAt"])
    .index("by_tool", ["tool", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* MCP RATE LIMIT BUCKETS - Token bucket state for rate limiting      */
  /* ------------------------------------------------------------------ */
  mcpRateLimitBuckets: defineTable({
    tokenId: v.id("mcpApiTokens"),

    minuteBucket: v.object({
      tokens: v.number(),
      lastRefillAt: v.number(),
      capacity: v.number(),
      refillRate: v.number(),
    }),

    hourBucket: v.object({
      tokens: v.number(),
      lastRefillAt: v.number(),
      capacity: v.number(),
      refillRate: v.number(),
    }),

    dayBucket: v.object({
      tokens: v.number(),
      lastRefillAt: v.number(),
      capacity: v.number(),
      refillRate: v.number(),
    }),

    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_token", ["tokenId"]),

  /* ------------------------------------------------------------------ */
  /* MCP SERVER PACKAGES - Supply chain security (OWASP API8)           */
  /* ------------------------------------------------------------------ */
  mcpServerPackages: defineTable({
    packageName: v.string(),
    version: v.string(),

    // Supply chain security
    checksum: v.string(), // SHA-256 of package
    signature: v.optional(v.string()), // Digital signature
    signedBy: v.optional(v.string()), // Signer identity

    // Approval workflow
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    status: v.union(
      v.literal("pending_review"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("deprecated"),
    ),

    // Security metadata
    knownVulnerabilities: v.optional(
      v.array(
        v.object({
          cveId: v.string(),
          severity: v.string(),
          patchedInVersion: v.optional(v.string()),
        }),
      ),
    ),

    // Usage tracking
    isPinned: v.boolean(), // If true, enforce this exact version
    lastUsedAt: v.optional(v.number()),

    createdAt: v.number(),
  })
    .index("by_package_version", ["packageName", "version"])
    .index("by_status", ["status", "approvedAt"])
    .index("by_pinned", ["isPinned", "packageName"]),

  /* ------------------------------------------------------------------ */
  /* WEBMCP ORIGINS â€” Approved WebMCP-enabled sites for consumer bridge  */
  /* ------------------------------------------------------------------ */
  webmcpOrigins: defineTable({
    origin: v.string(),
    label: v.string(),
    status: v.union(
      v.literal("approved"),
      v.literal("pending"),
      v.literal("revoked"),
    ),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    allowedToolPatterns: v.optional(v.array(v.string())),
    blockedToolPatterns: v.optional(v.array(v.string())),
    lastDiscoveredAt: v.optional(v.number()),
    discoveredToolCount: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_origin", ["origin"])
    .index("by_status", ["status", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* WEBMCP TOOL INVENTORY â€” Cached tool manifests per origin            */
  /* ------------------------------------------------------------------ */
  webmcpToolInventory: defineTable({
    originId: v.id("webmcpOrigins"),
    toolName: v.string(),
    description: v.string(),
    inputSchema: v.optional(v.any()),
    annotations: v.optional(v.any()),
    allowed: v.boolean(),
    riskTier: v.string(),
    discoveredAt: v.number(),
    lastCalledAt: v.optional(v.number()),
    callCount: v.optional(v.number()),
  })
    .index("by_origin", ["originId"])
    .index("by_origin_tool", ["originId", "toolName"]),

  /* ================================================================== */
  /* HITL (HUMAN-IN-THE-LOOP) WORKFLOWS                                  */
  /* ================================================================== */

  /* ------------------------------------------------------------------ */
  /* LABELING TASKS - Queue of items needing human labels               */
  /* ------------------------------------------------------------------ */
  labelingTasks: defineTable({
    taskId: v.string(),

    // Source reference
    sourceType: v.union(
      v.literal("source_quality"),
      v.literal("verification_audit"),
      v.literal("inconclusive_event"),
      v.literal("multi_vantage_disagreement"),
      v.literal("fact_check_coverage"),
    ),
    sourceRecordId: v.string(), // ID of source record

    // Stratification (for sampling)
    stratum: v.string(), // "high_confidence", "suspicious", "timeout", etc.
    persona: v.optional(v.string()), // Persona that made the call
    dependency: v.optional(v.string()), // External dependency involved
    confidenceBucket: v.optional(v.string()), // "high", "medium", "low"
    sourceTier: v.optional(v.string()), // tier1, tier2, etc.
    isMultiVantageDisagreement: v.optional(v.boolean()),
    costWeight: v.optional(v.number()), // FN risk weight

    // Context for labeler
    contextData: v.any(), // Claim, post, evidence, etc.

    // Assignment
    assignedTo: v.optional(v.string()),
    assignedAt: v.optional(v.number()),

    // SLA tracking
    slaDeadline: v.number(), // When this must be labeled by
    agingWarningThreshold: v.number(), // When to warn (e.g., 48h)

    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("assigned"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("escalated"),
    ),

    // Priority (high-cost FN risk = higher priority)
    priority: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low"),
    ),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_priority", ["status", "priority", "createdAt"])
    .index("by_stratum", ["stratum", "status"])
    .index("by_assigned", ["assignedTo", "status"])
    .index("by_sla", ["slaDeadline", "status"])
    .index("by_source", ["sourceType", "sourceRecordId"]),

  /* ------------------------------------------------------------------ */
  /* LABELS - Multi-annotator labels (immutable append-only)            */
  /* ------------------------------------------------------------------ */
  labels: defineTable({
    labelId: v.string(),

    // Link to task
    taskId: v.id("labelingTasks"),
    sourceType: v.string(),
    sourceRecordId: v.string(),

    // Labeler info
    labeledBy: v.string(),
    labeledAt: v.number(),

    // Label value (type depends on sourceType)
    label: v.union(
      // Source quality
      v.literal("appropriate"),
      v.literal("over_scored"),
      v.literal("under_scored"),
      v.literal("wrong_tier"),
      // Verification
      v.literal("verified_true"),
      v.literal("verified_false"),
      v.literal("inconclusive"),
      v.literal("needs_escalation"),
      // Inconclusive
      v.literal("true_inconclusive"),
      v.literal("false_negative"),
      v.literal("should_have_retried"),
    ),

    // Confidence in label
    confidence: v.number(), // 0-100

    // Link to rationale
    rationaleId: v.id("labelRationales"),

    // Metadata
    timeSpentSeconds: v.optional(v.number()),
    wasEscalated: v.optional(v.boolean()),

    createdAt: v.number(),
  })
    .index("by_task", ["taskId", "labeledAt"])
    .index("by_labeler", ["labeledBy", "labeledAt"])
    .index("by_source", ["sourceType", "sourceRecordId"])
    .index("by_label", ["label", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* LABEL RATIONALES - Structured evidence + reasoning                 */
  /* ------------------------------------------------------------------ */
  labelRationales: defineTable({
    rationaleId: v.string(),
    labelId: v.id("labels"),

    // Evidence references
    evidenceArtifactIds: v.array(v.id("sourceArtifacts")),
    evidenceChunkIds: v.optional(v.array(v.string())),
    evidenceUrls: v.optional(v.array(v.string())),

    // Reasoning
    shortRationale: v.string(), // 1-2 sentences
    detailedRationale: v.optional(v.string()),

    // Policy tags (for pattern analysis)
    policyTags: v.array(v.string()), // ["stale_data", "low_quality_source", etc.]

    // What evidence would change this decision
    pivotEvidence: v.optional(v.string()),

    // Suggested rule changes (feeds calibration)
    suggestedRuleChanges: v.optional(
      v.array(
        v.object({
          ruleId: v.string(),
          currentValue: v.any(),
          suggestedValue: v.any(),
          reasoning: v.string(),
        }),
      ),
    ),

    createdAt: v.number(),
  })
    .index("by_label", ["labelId"])
    .index("by_policy_tag", ["policyTags"])
    .index("by_created", ["createdAt"]),

  /* ------------------------------------------------------------------ */
  /* EVIDENCE ATTACHMENTS - Hash pointers to evidence (not raw blobs)   */
  /* ------------------------------------------------------------------ */
  evidenceAttachments: defineTable({
    attachmentId: v.string(),
    rationaleId: v.id("labelRationales"),

    // Attachment type
    type: v.union(
      v.literal("screenshot"),
      v.literal("pdf_excerpt"),
      v.literal("json_snippet"),
      v.literal("url_snapshot"),
    ),

    // Hash pointer (NOT the raw content)
    contentHash: v.string(), // SHA-256 of content
    storageId: v.optional(v.id("_storage")), // Reference to stored blob
    artifactId: v.optional(v.id("sourceArtifacts")), // Or link to existing artifact

    // Metadata
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    caption: v.optional(v.string()),

    createdAt: v.number(),
  })
    .index("by_rationale", ["rationaleId"])
    .index("by_hash", ["contentHash"]),

  /* ------------------------------------------------------------------ */
  /* ADJUDICATION REQUESTS - For disagreements + escalations            */
  /* ------------------------------------------------------------------ */
  adjudicationRequests: defineTable({
    adjudicationId: v.string(),

    // Link to task
    taskId: v.id("labelingTasks"),
    sourceType: v.string(),
    sourceRecordId: v.string(),

    // Reason for adjudication
    reason: v.union(
      v.literal("disagreement"), // Multiple labelers disagree
      v.literal("low_confidence"), // Labeler requested escalation
      v.literal("high_cost_fn"), // High FN risk
      v.literal("rule_ambiguity"), // Policy unclear
    ),

    // Disagreeing labels
    labelIds: v.array(v.id("labels")),

    // Risk/cost context
    costWeight: v.number(),
    fnRiskTier: v.optional(v.string()),

    // Priority (high-cost = high priority)
    priority: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low"),
    ),

    // Assignment
    assignedAdjudicator: v.optional(v.string()),
    assignedAt: v.optional(v.number()),

    // SLA
    slaDeadline: v.number(),

    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("resolved"),
      v.literal("deferred"),
    ),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_priority", ["status", "priority", "createdAt"])
    .index("by_task", ["taskId"])
    .index("by_adjudicator", ["assignedAdjudicator", "status"])
    .index("by_sla", ["slaDeadline", "status"]),

  /* ------------------------------------------------------------------ */
  /* ADJUDICATION DECISIONS - Immutable final decisions                 */
  /* ------------------------------------------------------------------ */
  adjudicationDecisions: defineTable({
    decisionId: v.string(),
    adjudicationId: v.id("adjudicationRequests"),

    // Decision
    finalLabel: v.string(),
    confidence: v.number(),

    // Reasoning (structured)
    decision: v.object({
      agreedWithLabelId: v.optional(v.id("labels")), // If agreed with one labeler
      synthesizedNewLabel: v.optional(v.boolean()), // If created new interpretation
      reasoning: v.string(),
      evidenceReferences: v.array(v.id("sourceArtifacts")),
      policyInterpretation: v.optional(v.string()),
    }),

    // Rule change suggestion (feeds calibration)
    suggestedRuleChanges: v.optional(
      v.array(
        v.object({
          ruleId: v.string(),
          changeType: v.union(
            v.literal("threshold_adjustment"),
            v.literal("new_pattern"),
            v.literal("policy_clarification"),
          ),
          proposal: v.string(),
          expectedImpact: v.string(),
        }),
      ),
    ),

    // Adjudicator
    adjudicatorId: v.string(),
    decidedAt: v.number(),

    // Required: evidence binding
    evidenceBindingComplete: v.boolean(),
    evidenceArtifactIds: v.array(v.id("sourceArtifacts")),
    evidenceContentHashes: v.array(v.string()),

    createdAt: v.number(),
  })
    .index("by_adjudication", ["adjudicationId"])
    .index("by_adjudicator", ["adjudicatorId", "decidedAt"])
    .index("by_decided", ["decidedAt"]),

  /* ------------------------------------------------------------------ */
  /* INTER-ANNOTATOR AGREEMENT SNAPSHOTS - Cohen's kappa tracking       */
  /* ------------------------------------------------------------------ */
  interAnnotatorAgreement: defineTable({
    snapshotId: v.string(),

    // Time window
    startDate: v.number(),
    endDate: v.number(),

    // Stratum
    stratum: v.string(),

    // Agreement metrics
    cohensKappa: v.number(), // -1 to 1
    percentAgreement: v.number(), // 0-100
    sampleSize: v.number(),

    // Breakdown by label pair
    confusionMatrix: v.any(), // Label1 Ã— Label2 confusion matrix

    // Annotator pairs analyzed
    annotatorPairs: v.array(
      v.object({
        annotator1: v.string(),
        annotator2: v.string(),
        kappa: v.number(),
        agreements: v.number(),
        disagreements: v.number(),
      }),
    ),

    // Quality gates
    passesKappaThreshold: v.boolean(), // >= 0.6 for "substantial"
    threshold: v.number(),

    computedAt: v.number(),
  })
    .index("by_stratum", ["stratum", "computedAt"])
    .index("by_computed", ["computedAt"]),

  /* ------------------------------------------------------------------ */
  /* DATASET PROMOTION GATES - Track deployable dataset criteria        */
  /* ------------------------------------------------------------------ */
  datasetPromotionGates: defineTable({
    gateId: v.string(),
    datasetVersion: v.string(),

    // Sample size gates
    minSampleSizePerStratum: v.record(v.string(), v.number()), // stratum â†’ min size
    actualSampleSize: v.record(v.string(), v.number()),
    sampleSizeGatePassed: v.boolean(),

    // Agreement gates
    minKappa: v.number(),
    actualKappa: v.number(),
    kappaGatePassed: v.boolean(),

    // Adjudication backlog gate
    maxAdjudicationBacklog: v.number(),
    actualAdjudicationBacklog: v.number(),
    backlogGatePassed: v.boolean(),

    // Overall gate
    allGatesPassed: v.boolean(),

    // Metadata
    evaluatedAt: v.number(),
    evaluatedBy: v.string(),
  })
    .index("by_version", ["datasetVersion"])
    .index("by_passed", ["allGatesPassed", "evaluatedAt"]),

  /* ------------------------------------------------------------------ */
  /* GAME DAY EXECUTION TRACKING - Quarterly drill evidence             */
  /* ------------------------------------------------------------------ */
  gameDayExecutions: defineTable({
    executionId: v.string(),
    scenarioName: v.string(),

    // Scheduling
    scheduledDate: v.number(),
    actualStartTime: v.number(),
    actualEndTime: v.optional(v.number()),

    // Participants
    participants: v.array(
      v.object({
        userId: v.string(),
        role: v.string(), // "incident_commander", "on_call", "observer"
      }),
    ),

    // Timeline of events
    timeline: v.array(
      v.object({
        time: v.number(),
        event: v.string(),
        actionTaken: v.string(),
        correct: v.boolean(),
        evidence: v.optional(v.string()),
      }),
    ),

    // Exit criteria checklist
    exitCriteria: v.array(
      v.object({
        criterion: v.string(), // "Burn rate under threshold for 15min"
        met: v.boolean(),
        metAt: v.optional(v.number()),
        evidence: v.optional(v.string()),
      }),
    ),

    // Outcomes
    status: v.union(
      v.literal("scheduled"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    allCriteriaMet: v.optional(v.boolean()),

    // Follow-ups
    actionItems: v.optional(
      v.array(
        v.object({
          item: v.string(),
          owner: v.string(),
          dueDate: v.number(),
          status: v.union(v.literal("open"), v.literal("closed")),
          closedAt: v.optional(v.number()),
        }),
      ),
    ),

    // Postmortem link
    postmortemDocumentId: v.optional(v.id("documents")),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_scheduled", ["scheduledDate"])
    .index("by_status", ["status", "scheduledDate"])
    .index("by_scenario", ["scenarioName", "scheduledDate"]),

  /* ------------------------------------------------------------------ */
  /* LABELER CALIBRATION - Gold set checks for quality                  */
  /* ------------------------------------------------------------------ */
  labelerCalibration: defineTable({
    calibrationId: v.string(),
    labelerId: v.string(),

    // Gold set used
    goldSetVersion: v.string(),
    goldSetSize: v.number(),

    // Results
    correctLabels: v.number(),
    incorrectLabels: v.number(),
    accuracy: v.number(), // 0-100

    // Breakdown by stratum
    byStratum: v.any(), // stratum â†’ {correct, incorrect, accuracy}

    // Pass/fail
    passThreshold: v.number(), // e.g., 80%
    passed: v.boolean(),

    // Certification
    certifiedUntil: v.optional(v.number()), // Valid until this date
    recalibrationRequired: v.boolean(),

    testDate: v.number(),
    createdAt: v.number(),
  })
    .index("by_labeler", ["labelerId", "testDate"])
    .index("by_certification", ["certifiedUntil", "passed"]),

  /* ------------------------------------------------------------------ */
  /* GOLD SET CASES - Known-answer items for calibration                */
  /* ------------------------------------------------------------------ */
  goldSetCases: defineTable({
    caseId: v.string(),
    goldSetVersion: v.string(),

    // Stratification
    stratum: v.string(),
    sourceType: v.string(), // "source_quality", "verification", etc.

    // Test data
    contextData: v.any(),
    sourceArtifactId: v.id("sourceArtifacts"),

    // Ground truth answer
    correctLabel: v.string(),
    correctConfidence: v.number(),
    toleranceBand: v.object({
      minConfidence: v.number(),
      maxConfidence: v.number(),
    }),

    // Rationale
    rationale: v.string(),
    policyReferences: v.array(v.string()),

    // Metadata
    createdBy: v.string(),
    reviewedBy: v.optional(v.string()),
    isActive: v.boolean(),

    createdAt: v.number(),
  })
    .index("by_gold_set_version", ["goldSetVersion", "isActive"])
    .index("by_stratum", ["stratum", "isActive"]),

  /* ------------------------------------------------------------------ */
  /* DISTRIBUTION DRIFT SNAPSHOTS - Track dataset shifts                */
  /* ------------------------------------------------------------------ */
  distributionDriftSnapshots: defineTable({
    snapshotId: v.string(),
    datasetVersion: v.string(),

    // Snapshot date
    snapshotDate: v.number(),

    // Distribution by stratum
    stratumDistribution: v.record(v.string(), v.number()), // stratum â†’ count

    // Topic/domain distribution
    topicDistribution: v.optional(v.record(v.string(), v.number())),
    domainDistribution: v.optional(v.record(v.string(), v.number())),

    // Comparison to baseline
    baselineSnapshotId: v.optional(v.string()),
    driftScore: v.optional(v.number()), // 0-100, 0=no drift
    significantDrift: v.optional(v.boolean()),

    // Breakdown
    driftDetails: v.optional(
      v.array(
        v.object({
          dimension: v.string(), // "stratum", "topic", "domain"
          category: v.string(),
          baselinePercent: v.number(),
          currentPercent: v.number(),
          delta: v.number(),
        }),
      ),
    ),

    // Gate requirement
    requiresRevalidation: v.boolean(),

    createdAt: v.number(),
  })
    .index("by_dataset", ["datasetVersion", "snapshotDate"])
    .index("by_drift", ["significantDrift", "snapshotDate"]),

  /* ------------------------------------------------------------------ */
  /* CANONICAL RECORDS - Deduplicated entity/event tracking             */
  /* ------------------------------------------------------------------ */
  canonicalRecords: defineTable({
    canonicalId: v.string(),

    // Entity identification
    entityKey: v.string(), // "NVDA", "openai-series-e"
    recordType: v.union(
      v.literal("company_fact"),
      v.literal("funding_event"),
      v.literal("product_launch"),
      v.literal("verification_claim"),
    ),

    // Canonical content
    canonicalContent: v.any(), // Structured canonical representation
    contentHash: v.string(), // Hash of canonical content

    // Source consolidation
    sourceArtifactIds: v.array(v.id("sourceArtifacts")),
    primarySourceId: v.id("sourceArtifacts"), // Authoritative source
    consolidatedAt: v.number(),

    // Version tracking
    version: v.number(),
    previousCanonicalId: v.optional(v.string()),

    // Change tracking
    changeType: v.optional(
      v.union(
        v.literal("new"),
        v.literal("update"),
        v.literal("correction"),
        v.literal("consolidation"),
      ),
    ),
    changeSummary: v.optional(v.string()), // LLM-generated summary
    changedFields: v.optional(v.array(v.string())),

    // Duplicate links
    duplicateOfCanonicalId: v.optional(v.string()),
    nearDuplicateIds: v.optional(v.array(v.string())),
    similarityScores: v.optional(v.record(v.string(), v.number())),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity_type", ["entityKey", "recordType"])
    .index("by_content_hash", ["contentHash"])
    .index("by_version", ["canonicalId", "version"])
    .index("by_duplicate", ["duplicateOfCanonicalId"]),

  /* ------------------------------------------------------------------ */
  /* DUPLICATE DETECTION JOBS - Near-duplicate processing                */
  /* ------------------------------------------------------------------ */
  duplicateDetectionJobs: defineTable({
    jobId: v.string(),

    // Scope
    sourceArtifactIds: v.array(v.id("sourceArtifacts")),
    entityKey: v.optional(v.string()),
    recordType: v.optional(v.string()),

    // Method
    method: v.union(
      v.literal("embedding_similarity"),
      v.literal("llm_judge"),
      v.literal("hybrid"),
    ),

    // Results
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),

    duplicatePairs: v.optional(
      v.array(
        v.object({
          artifactId1: v.id("sourceArtifacts"),
          artifactId2: v.id("sourceArtifacts"),
          similarityScore: v.number(), // 0-100
          isDuplicate: v.boolean(),
          reasoning: v.optional(v.string()),
        }),
      ),
    ),

    // Stats
    artifactsProcessed: v.optional(v.number()),
    duplicatesFound: v.optional(v.number()),
    canonicalRecordsCreated: v.optional(v.number()),

    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_entity", ["entityKey", "createdAt"]),

  /* ================================================================== */
  /* DYNAMIC CONTEXT CONFIGURATION                                       */
  /* ================================================================== */

  /* ------------------------------------------------------------------ */
  /* PROMPT ENHANCER CONFIGS - Formal Prompt Enhancer configuration      */
  /* ------------------------------------------------------------------ */
  promptEnhancerConfigs: defineTable({
    configId: v.string(),
    name: v.string(),

    // Entity extraction settings
    entityExtraction: v.object({
      enabledTypes: v.array(v.string()), // ["company", "person", "ticker"]
      confidenceThreshold: v.number(),
    }),

    // Temporal inference settings
    temporalInference: v.object({
      enabled: v.boolean(),
      defaultLookbackDays: v.number(),
      recencyBias: v.number(), // 0-1
    }),

    // Retrieval intent generation
    retrievalIntent: v.object({
      enabled: v.boolean(),
      maxQueries: v.number(),
      tokenBudget: v.number(),
      evidencePriorities: v.array(v.string()), // ["sec_filings", "earnings_calls"]
    }),

    // Persona inference
    personaInference: v.object({
      enabled: v.boolean(),
      personas: v.array(v.string()),
    }),

    isDefault: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_config_id", ["configId"])
    .index("by_default", ["isDefault"]),

  /* ------------------------------------------------------------------ */
  /* DISTILLER CONFIGS - Formal File Distiller configuration             */
  /* ------------------------------------------------------------------ */
  distillerConfigs: defineTable({
    configId: v.string(),
    name: v.string(),

    // Model selection
    modelStrategy: v.union(
      v.literal("free_first"), // devstral â†’ gemini-flash â†’ haiku
      v.literal("quality_first"), // haiku â†’ sonnet
      v.literal("specific"), // Use specified model
    ),
    preferredModel: v.optional(v.string()),

    // Extraction settings
    extraction: v.object({
      maxFacts: v.number(),
      minConfidence: v.number(),
      requireCitations: v.boolean(),
      citationFormat: v.string(), // "{{cite:artifactId:chunkId}}"
    }),

    // Token budget
    budget: v.object({
      maxInputTokens: v.number(),
      maxOutputTokens: v.number(),
    }),

    // Categories of facts to extract
    factCategories: v.array(v.string()), // ["financial", "team", "product", "market"]

    isDefault: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_config_id", ["configId"])
    .index("by_default", ["isDefault"]),

  /* ------------------------------------------------------------------ */
  /* SEC API RATE LIMITS - Track SEC EDGAR API request rate              */
  /* ------------------------------------------------------------------ */
  secApiRateLimits: defineTable({
    endpoint: v.string(), // e.g., "companyfacts/CIK0001234567"
    timestamp: v.number(), // When the request was made
    statusCode: v.number(), // HTTP status code
    latencyMs: v.number(), // Response latency
    retryAfterSec: v.optional(v.number()), // Retry-After header value (seconds)
    isRateLimited: v.optional(v.boolean()), // True if this was a 429 response
    errorMessage: v.optional(v.string()), // Error details for failed requests
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_endpoint", ["endpoint", "timestamp"])
    .index("by_rate_limited", ["isRateLimited", "timestamp"]),

  /* ------------------------------------------------------------------ */
  /* SEC API CIRCUIT BREAKER - Adaptive rate limiting with circuit breaker */
  /* ------------------------------------------------------------------ */
  secApiCircuitBreaker: defineTable({
    // Circuit breaker state
    state: v.union(
      v.literal("closed"), // Normal operation
      v.literal("open"), // Blocking all requests
      v.literal("half_open"), // Testing if service recovered
    ),

    // Failure tracking
    consecutiveFailures: v.number(),
    totalFailuresInWindow: v.number(), // Failures in rolling window
    windowStartTimestamp: v.number(),

    // Rate limit tracking
    lastRateLimitTimestamp: v.optional(v.number()),
    retryAfterUntil: v.optional(v.number()), // Don't retry before this timestamp

    // Backoff state
    currentBackoffMs: v.number(),
    maxBackoffMs: v.number(),

    // Circuit open/close times
    openedAt: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    halfOpenAt: v.optional(v.number()),

    // Configuration
    failureThreshold: v.number(), // Failures to open circuit
    successThreshold: v.number(), // Successes in half-open to close
    windowDurationMs: v.number(), // Rolling window for failure counting
    openDurationMs: v.number(), // How long to stay open before half-open

    updatedAt: v.number(),
  }),

  /* ------------------------------------------------------------------ */
  /* SEC API RESPONSE CACHE - Aggressive caching per SEC guidance        */
  /* ------------------------------------------------------------------ */
  secApiResponseCache: defineTable({
    // Cache key
    endpoint: v.string(), // Full endpoint path
    cacheKey: v.string(), // Hash of endpoint + params

    // Response data
    responseHash: v.string(), // SHA-256 of response for dedup
    artifactId: v.id("sourceArtifacts"), // Link to full response

    // Cache metadata
    fetchedAt: v.number(),
    expiresAt: v.number(), // When to consider stale
    hitCount: v.number(), // Number of cache hits

    // Validation
    etag: v.optional(v.string()), // For conditional requests
    lastModified: v.optional(v.string()),
  })
    .index("by_cache_key", ["cacheKey"])
    .index("by_endpoint", ["endpoint", "fetchedAt"])
    .index("by_expires", ["expiresAt"]),

  /* ------------------------------------------------------------------ */
  /* ENTITY MONITORING - Continuous KYC per FATF guidance               */
  /* ------------------------------------------------------------------ */
  entityMonitorProfiles,

  /* ------------------------------------------------------------------ */
  /* VERIFICATION AUDIT LOG - FP/FN calibration + SLO tracking          */
  /* ------------------------------------------------------------------ */
  verificationAuditLog,

  /* ------------------------------------------------------------------ */
  /* VERIFICATION ACTIONS - Simple action logging for integrations      */
  /* ------------------------------------------------------------------ */
  verificationActions,

  /* ================================================================== */
  /* SLO (SERVICE LEVEL OBJECTIVES) FRAMEWORK                            */
  /* ================================================================== */

  /* ------------------------------------------------------------------ */
  /* SLO MEASUREMENTS - Time series of SLO metric values                 */
  /* ------------------------------------------------------------------ */
  sloMeasurements: defineTable({
    sloId: v.string(),
    value: v.number(),
    metadata: v.optional(v.any()),
    recordedAt: v.number(),
  })
    .index("by_slo", ["sloId", "recordedAt"])
    .index("by_recorded", ["recordedAt"]),

  /* ------------------------------------------------------------------ */
  /* ALERT HISTORY - Track alert lifecycle                               */
  /* ------------------------------------------------------------------ */
  alertHistory: defineTable({
    alertId: v.string(),
    sloId: v.string(),
    severity: v.string(),
    currentValue: v.number(),
    threshold: v.number(),
    message: v.string(),
    triggeredAt: v.number(),
    acknowledgedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    acknowledgedBy: v.optional(v.string()),
    resolvedBy: v.optional(v.string()),
    resolutionNotes: v.optional(v.string()),
    rootCause: v.optional(v.string()),
    incidentId: v.optional(v.string()),

    // Burn-rate alerting fields
    dedupeKey: v.optional(v.string()),
    evaluationDetails: v.optional(v.any()),
  })
    .index("by_slo", ["sloId", "triggeredAt"])
    .index("by_severity", ["severity", "triggeredAt"])
    .index("by_triggered", ["triggeredAt"])
    .index("by_unresolved", ["resolvedAt", "severity"]),

  /* ------------------------------------------------------------------ */
  /* ERROR BUDGET SNAPSHOTS - Daily error budget state                   */
  /* ------------------------------------------------------------------ */
  errorBudgetSnapshots: defineTable({
    sloId: v.string(),
    snapshotDate: v.string(),
    totalBudgetPercent: v.number(),
    consumedPercent: v.number(),
    remainingPercent: v.number(),
    burnRateMultiplier: v.number(),
    projectedExhaustionDate: v.optional(v.string()),
    windowStartDate: v.string(),
    windowEndDate: v.string(),
    measurementCount: v.number(),
    recordedAt: v.number(),
  })
    .index("by_slo_date", ["sloId", "snapshotDate"])
    .index("by_date", ["snapshotDate"]),

  /* ------------------------------------------------------------------ */
  /* RUNBOOK EXECUTIONS - Track runbook usage                            */
  /* ------------------------------------------------------------------ */
  runbookExecutions: defineTable({
    runbookId: v.string(),
    alertHistoryId: v.optional(v.id("alertHistory")),
    executedBy: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    outcome: v.optional(
      v.union(
        v.literal("resolved"),
        v.literal("escalated"),
        v.literal("partial"),
        v.literal("ineffective"),
      ),
    ),
    stepsCompleted: v.optional(v.array(v.number())),
    stepsSkipped: v.optional(v.array(v.number())),
    feedback: v.optional(v.string()),
    suggestedImprovements: v.optional(v.array(v.string())),
  })
    .index("by_runbook", ["runbookId", "startedAt"])
    .index("by_outcome", ["outcome", "startedAt"]),

  /* ================================================================== */
  /* CLOSED-LOOP CALIBRATION WORKFLOW                                    */
  /* ================================================================== */

  /* ------------------------------------------------------------------ */
  /* CALIBRATION PROPOSALS - Threshold adjustment proposals              */
  /* ------------------------------------------------------------------ */
  calibrationProposals: defineTable({
    proposalId: v.string(),
    proposalType: v.string(),
    target: v.object({
      type: v.string(),
      id: v.string(),
      field: v.string(),
    }),
    currentValue: v.any(),
    proposedValue: v.any(),
    evidence: v.optional(
      v.object({
        supportingLabels: v.number(),
        totalLabels: v.number(),
        currentAccuracy: v.number(),
        projectedAccuracy: v.number(),
      }),
    ),
    rationale: v.string(),
    generatedBy: v.union(v.literal("system"), v.literal("human")),
    generatedAt: v.number(),
    status: v.union(
      v.literal("pending_review"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("deployed"),
      v.literal("rolled_back"),
    ),
    reviewSubmittedAt: v.optional(v.number()),
    assignedReviewer: v.optional(v.string()),
    reviewNotes: v.optional(v.string()),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    approvalNotes: v.optional(v.string()),
    rejectedBy: v.optional(v.string()),
    rejectedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
    deploymentId: v.optional(v.id("calibrationDeployments")),
  })
    .index("by_proposal_id", ["proposalId"])
    .index("by_status", ["status", "generatedAt"])
    .index("by_type", ["proposalType", "generatedAt"]),

  /* ------------------------------------------------------------------ */
  /* CALIBRATION REGRESSION TESTS - Pre-deployment validation            */
  /* ------------------------------------------------------------------ */
  calibrationRegressionTests: defineTable({
    proposalId: v.id("calibrationProposals"),
    passed: v.boolean(),
    gates: v.object({
      alertStormCheck: v.object({
        passed: v.boolean(),
        newAlertsCount: v.number(),
        threshold: v.number(),
        details: v.string(),
      }),
      missedIssuesCheck: v.object({
        passed: v.boolean(),
        missedCount: v.number(),
        threshold: v.number(),
        details: v.string(),
      }),
      accuracyImprovementCheck: v.object({
        passed: v.boolean(),
        currentAccuracy: v.number(),
        projectedAccuracy: v.number(),
        minImprovement: v.number(),
        details: v.string(),
      }),
      sampleSizeCheck: v.object({
        passed: v.boolean(),
        sampleSize: v.number(),
        minSampleSize: v.number(),
        details: v.string(),
      }),
    }),
    simulation: v.object({
      historicalDataPoints: v.number(),
      correctBefore: v.number(),
      correctAfter: v.number(),
      newErrors: v.number(),
      fixedErrors: v.number(),
    }),
    testedAt: v.number(),
  })
    .index("by_proposal", ["proposalId", "testedAt"])
    .index("by_passed", ["passed", "testedAt"]),

  /* ------------------------------------------------------------------ */
  /* CALIBRATION DEPLOYMENTS - Deployment records with rollback          */
  /* ------------------------------------------------------------------ */
  calibrationDeployments: defineTable({
    deploymentId: v.string(),
    proposalId: v.id("calibrationProposals"),
    changes: v.array(
      v.object({
        target: v.string(),
        field: v.string(),
        oldValue: v.any(),
        newValue: v.any(),
      }),
    ),
    deployedBy: v.string(),
    deployedAt: v.number(),
    rollbackEnabled: v.boolean(),
    rollbackBy: v.optional(v.string()),
    rolledBackAt: v.optional(v.number()),
    rollbackReason: v.optional(v.string()),
    monitoring: v.optional(
      v.object({
        unexpectedErrors: v.number(),
        alertVolumeChange: v.number(),
        observedAccuracy: v.optional(v.number()),
      }),
    ),
  })
    .index("by_deployment_id", ["deploymentId"])
    .index("by_proposal", ["proposalId"])
    .index("by_deployed_at", ["deployedAt"]),

  /* ================================================================== */
  /* INDEPENDENT VALIDATION WORKFLOW                                     */
  /* ================================================================== */

  /* ------------------------------------------------------------------ */
  /* VALIDATION REQUESTS - Model validation requests                     */
  /* ------------------------------------------------------------------ */
  validationRequests: defineTable({
    requestId: v.string(),
    modelCardId: v.id("modelCards"),
    trigger: v.union(
      v.literal("initial"),
      v.literal("scheduled_revalidation"),
      v.literal("model_change"),
      v.literal("performance_degradation"),
      v.literal("manual"),
    ),
    requestedBy: v.string(),
    requestedAt: v.number(),
    assignedValidator: v.optional(v.string()),
    assignedAt: v.optional(v.number()),
    assignedBy: v.optional(v.string()),
    status: v.union(
      v.literal("pending_assignment"),
      v.literal("in_progress"),
      v.literal("findings_review"),
      v.literal("completed"),
      v.literal("rejected"),
    ),
    notes: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  })
    .index("by_request_id", ["requestId"])
    .index("by_model", ["modelCardId", "requestedAt"])
    .index("by_status", ["status", "requestedAt"])
    .index("by_validator", ["assignedValidator", "status"]),

  /* ------------------------------------------------------------------ */
  /* VALIDATION FINDINGS - Issues found during validation                */
  /* ------------------------------------------------------------------ */
  validationFindings: defineTable({
    findingId: v.string(),
    validationRequestId: v.id("validationRequests"),
    severity: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low"),
      v.literal("informational"),
    ),
    category: v.union(
      v.literal("data_quality"),
      v.literal("methodology"),
      v.literal("documentation"),
      v.literal("performance"),
      v.literal("governance"),
      v.literal("other"),
    ),
    title: v.string(),
    description: v.string(),
    evidence: v.array(v.string()),
    recommendedAction: v.string(),
    status: v.union(
      v.literal("open"),
      v.literal("remediated"),
      v.literal("accepted_risk"),
      v.literal("not_applicable"),
    ),
    createdBy: v.string(),
    createdAt: v.number(),
    remediatedBy: v.optional(v.string()),
    remediatedAt: v.optional(v.number()),
    remediationNotes: v.optional(v.string()),
    acceptedBy: v.optional(v.string()),
    acceptedAt: v.optional(v.number()),
    acceptanceRationale: v.optional(v.string()),
  })
    .index("by_finding_id", ["findingId"])
    .index("by_request", ["validationRequestId", "severity"])
    .index("by_status", ["status", "severity"]),

  /* ------------------------------------------------------------------ */
  /* VALIDATION REPORTS - Final validation reports                       */
  /* ------------------------------------------------------------------ */
  validationReports: defineTable({
    reportId: v.string(),
    validationRequestId: v.id("validationRequests"),
    modelCardId: v.id("modelCards"),
    validatedBy: v.string(),
    validationDate: v.string(),
    independenceAttestation: v.object({
      validatorRole: v.string(),
      conflictOfInterest: v.boolean(),
      conflictDescription: v.optional(v.string()),
      attestedAt: v.number(),
    }),
    scope: v.object({
      conceptualSoundness: v.boolean(),
      ongoingMonitoring: v.boolean(),
      outcomeAnalysis: v.boolean(),
      dataQuality: v.boolean(),
      assumptions: v.boolean(),
      implementation: v.boolean(),
    }),
    findingsSummary: v.object({
      critical: v.number(),
      high: v.number(),
      medium: v.number(),
      low: v.number(),
      informational: v.number(),
    }),
    recommendation: v.union(
      v.literal("approve"),
      v.literal("conditional_approval"),
      v.literal("reject"),
    ),
    recommendationRationale: v.string(),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    nextValidationDate: v.optional(v.string()),
    generatedAt: v.number(),
  })
    .index("by_report_id", ["reportId"])
    .index("by_model", ["modelCardId", "validationDate"])
    .index("by_validator", ["validatedBy", "validationDate"])
    .index("by_generated_at", ["generatedAt"]),

  /* ================================================================== */
  /* PRIVACY & RETENTION ENFORCEMENT (GDPR)                              */
  /* ================================================================== */

  /* ------------------------------------------------------------------ */
  /* DELETION REQUESTS - Right to deletion (GDPR Article 17)             */
  /* ------------------------------------------------------------------ */
  deletionRequests: defineTable({
    requestId: v.string(),
    scope: v.union(
      v.literal("user_data"),
      v.literal("entity_data"),
      v.literal("specific_records"),
    ),
    subject: v.string(), // User ID or entity key
    recordIds: v.optional(v.array(v.string())),
    requestedBy: v.string(),
    requestedAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    deletionSummary: v.optional(
      v.object({
        tablesAffected: v.array(v.string()),
        recordsDeleted: v.number(),
        tombstonesCreated: v.number(),
        failedDeletions: v.array(
          v.object({
            table: v.string(),
            recordId: v.string(),
            error: v.string(),
          }),
        ),
      }),
    ),
    completedAt: v.optional(v.number()),
    completedBy: v.optional(v.string()),
  })
    .index("by_request_id", ["requestId"])
    .index("by_subject", ["subject", "requestedAt"])
    .index("by_status", ["status", "requestedAt"]),

  /* ------------------------------------------------------------------ */
  /* DELETION TOMBSTONES - Audit trail for deletions                     */
  /* ------------------------------------------------------------------ */
  deletionTombstones: defineTable({
    table: v.string(),
    recordId: v.string(),
    deletionRequestId: v.id("deletionRequests"),
    deletedAt: v.number(),
    deletedBy: v.optional(v.string()),
  })
    .index("by_table", ["table", "deletedAt"])
    .index("by_request", ["deletionRequestId"]),

  /* ------------------------------------------------------------------ */
  /* ARCHIVED RECORDS - Soft archive for TTL policies                    */
  /* ------------------------------------------------------------------ */
  // Used by privacyEnforcement.archiveRecords to retain an immutable copy of
  // expired records before deletion (cold storage within Convex).
  archivedRecords: defineTable({
    table: v.string(),
    recordId: v.string(),
    dataClass: v.string(),
    archivedAt: v.number(),
    contentHash: v.string(),
    data: v.any(),
  })
    .index("by_table", ["table", "archivedAt"])
    .index("by_record", ["table", "recordId"]),

  /* ------------------------------------------------------------------ */
  /* RETENTION AGGREGATIONS - Minimal aggregates before deleting logs    */
  /* ------------------------------------------------------------------ */
  retentionAggregations: defineTable({
    table: v.string(),
    dataClass: v.string(),
    expiresAt: v.number(),
    aggregatedAt: v.number(),
    recordsCount: v.number(),
  })
    .index("by_table", ["table", "aggregatedAt"])
    .index("by_data_class", ["dataClass", "aggregatedAt"]),

  /* ================================================================== */
  /* TASK MANAGER (SESSIONS / TRACES / SPANS)                            */
  /* ================================================================== */

  agentTaskSessions: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    type: v.union(
      v.literal("manual"),
      v.literal("cron"),
      v.literal("scheduled"),
      v.literal("agent"),
      v.literal("swarm"),
    ),
    visibility: v.union(v.literal("public"), v.literal("private")),
    userId: v.optional(v.id("users")),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    totalDurationMs: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cronJobName: v.optional(v.string()),
    agentRunId: v.optional(v.id("agentRuns")),
    agentThreadId: v.optional(v.string()),
    swarmId: v.optional(v.string()),
    goalId: v.optional(v.string()),
    visionSnapshot: v.optional(v.string()),
    successCriteria: v.optional(v.array(v.string())),
    sourceRefs: v.optional(
      v.array(
        v.object({
          label: v.string(),
          href: v.optional(v.string()),
          note: v.optional(v.string()),
          kind: v.optional(v.string()),
        }),
      ),
    ),
    crossCheckStatus: v.optional(
      v.union(
        v.literal("aligned"),
        v.literal("drifting"),
        v.literal("violated"),
      ),
    ),
    deltaFromVision: v.optional(v.string()),
    dogfoodRunId: v.optional(v.id("dogfoodQaRuns")),
    estimatedCostUsd: v.optional(v.number()),
    toolsUsed: v.optional(v.array(v.string())),
    agentsInvolved: v.optional(v.array(v.string())),
    errorMessage: v.optional(v.string()),
    errorStack: v.optional(v.string()),
    metadata: v.optional(v.any()),
  })
    .index("by_visibility_date", ["visibility", "startedAt"])
    .index("by_user_date", ["userId", "startedAt"])
    .index("by_type_date", ["type", "startedAt"])
    .index("by_cron", ["cronJobName", "startedAt"]),

  agentTaskTraces: defineTable({
    sessionId: v.id("agentTaskSessions"),
    traceId: v.string(),
    workflowName: v.string(),
    groupId: v.optional(v.string()),
    goalId: v.optional(v.string()),
    visionSnapshot: v.optional(v.string()),
    successCriteria: v.optional(v.array(v.string())),
    sourceRefs: v.optional(
      v.array(
        v.object({
          label: v.string(),
          href: v.optional(v.string()),
          note: v.optional(v.string()),
          kind: v.optional(v.string()),
        }),
      ),
    ),
    crossCheckStatus: v.optional(
      v.union(
        v.literal("aligned"),
        v.literal("drifting"),
        v.literal("violated"),
      ),
    ),
    deltaFromVision: v.optional(v.string()),
    dogfoodRunId: v.optional(v.id("dogfoodQaRuns")),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("error"),
    ),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    totalDurationMs: v.optional(v.number()),
    tokenUsage: v.optional(
      v.object({
        input: v.number(),
        output: v.number(),
        total: v.number(),
      }),
    ),
    estimatedCostUsd: v.optional(v.number()),
    model: v.optional(v.string()),
    metadata: v.optional(v.any()),
  })
    .index("by_session", ["sessionId", "startedAt"])
    .index("by_trace_id", ["traceId"]),

  agentTaskSpans: defineTable({
    traceId: v.id("agentTaskTraces"),
    parentSpanId: v.optional(v.id("agentTaskSpans")),
    seq: v.number(),
    depth: v.number(),
    spanType: v.union(
      v.literal("agent"),
      v.literal("generation"),
      v.literal("tool"),
      v.literal("guardrail"),
      v.literal("handoff"),
      v.literal("retrieval"),
      v.literal("delegation"),
      v.literal("custom"),
    ),
    name: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("error"),
    ),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    data: v.optional(v.any()),
    metadata: v.optional(v.any()),
    error: v.optional(
      v.object({
        message: v.string(),
        code: v.optional(v.string()),
        stack: v.optional(v.string()),
      }),
    ),
  })
    .index("by_trace", ["traceId", "seq"])
    .index("by_parent", ["parentSpanId", "seq"]),

  /* ================================================================== */
  /* DATA COMPLETENESS & OBSERVABILITY - P0/P1 TABLES                   */
  /* Added 2026-01-21 to close critical feedback loops                  */
  /* ================================================================== */

  /* ------------------------------------------------------------------ */
  /* ANALYTICS COMPONENT METRICS - Per-component report breakdown        */
  /* Enables measurement of individual report components (P0)            */
  /* ------------------------------------------------------------------ */
  dailyReportComponentMetrics: defineTable({
    // Report identification
    date: v.string(), // YYYY-MM-DD
    reportType: v.union(
      v.literal("daily_brief"),
      v.literal("weekly_digest"),
      v.literal("funding_report"),
      v.literal("research_highlights"),
    ),

    // Component details
    componentType: v.string(), // "funding_events", "research_highlights", "market_signals"
    sourceName: v.string(), // "SiliconAngle", "TechCrunch", etc.
    category: v.optional(v.string()), // "AI/ML", "FinTech", etc.

    // Metrics
    itemCount: v.number(), // Number of items in this component
    engagementScore: v.optional(v.number()), // 0-1 engagement score
    avgReadTimeSeconds: v.optional(v.number()),
    clickThroughRate: v.optional(v.number()), // 0-1 CTR
    impressions: v.optional(v.number()),
    clicks: v.optional(v.number()),

    // Quality metrics
    relevanceScore: v.optional(v.number()), // 0-1 relevance score
    freshnessHours: v.optional(v.number()), // How recent was the content

    // Metadata
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_date", ["date"])
    .index("by_date_type", ["date", "reportType"])
    .index("by_source", ["sourceName", "date"])
    .index("by_category", ["category", "date"])
    .index("by_component", ["componentType", "date"]),

  /**
   * Intent telemetry for product intelligence loops.
   * Records normalized user intents, whether they were handled,
   * and which channel produced them.
   */
  intentSignals: defineTable({
    userId: v.optional(v.id("users")),
    source: v.union(
      v.literal("voice"),
      v.literal("text"),
      v.literal("navigation"),
      v.literal("system"),
      v.literal("search"),
    ),
    intentKey: v.string(),
    action: v.string(),
    status: v.union(
      v.literal("handled"),
      v.literal("fallback"),
      v.literal("failed"),
    ),
    inputText: v.optional(v.string()),
    route: v.optional(v.string()),
    targetView: v.optional(v.string()),
    metadata: v.optional(v.any()),
    day: v.string(),
    occurredAt: v.number(),
  })
    .index("by_day", ["day"])
    .index("by_occurredAt", ["occurredAt"])
    .index("by_user_and_day", ["userId", "day"])
    .index("by_user_and_occurredAt", ["userId", "occurredAt"])
    .index("by_source_and_occurredAt", ["source", "occurredAt"])
    .index("by_status_and_occurredAt", ["status", "occurredAt"]),

  /* ------------------------------------------------------------------ */
  /* RECOMMENDATION OUTCOMES - Feedback loop for recommendation system  */
  /* Captures user actions on recommendations (P0 - CRITICAL)           */
  /* ------------------------------------------------------------------ */
  recommendationOutcomes: defineTable({
    // Recommendation reference
    recommendationId: v.id("recommendations"),
    userId: v.id("users"),

    // User action
    action: v.union(
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("ignored"),
      v.literal("dismissed"),
      v.literal("snoozed"),
    ),
    actionTimestamp: v.number(),

    // Feedback
    reason: v.optional(v.string()), // User-provided reason for rejection
    actualValue: v.optional(v.number()), // 0-1 user rating of value
    timeTakenMs: v.optional(v.number()), // How long before user acted

    // Context
    displayContext: v.optional(v.string()), // Where was recommendation shown
    metadata: v.optional(v.any()), // Additional context

    // Timestamps
    createdAt: v.number(),
  })
    .index("by_recommendation", ["recommendationId"])
    .index("by_user", ["userId", "actionTimestamp"])
    .index("by_action", ["action", "actionTimestamp"])
    .index("by_user_action", ["userId", "action"]),

  /* ------------------------------------------------------------------ */
  /* HUMAN DECISIONS - HITL decision outcome tracking (P0 - CRITICAL)   */
  /* Tracks what decisions humans made on agent requests                */
  /* ------------------------------------------------------------------ */
  humanDecisions: defineTable({
    // Request reference
    requestId: v.id("humanRequests"),
    requestType: v.string(), // Type of request from humanRequests

    // Decision
    decision: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("modified"),
      v.literal("escalated"),
      v.literal("deferred"),
    ),

    // Review details
    reviewTimeMs: v.number(), // Time taken to make decision
    reviewedBy: v.id("users"),
    reviewedAt: v.number(),

    // Feedback & modifications
    feedback: v.optional(v.string()), // Human feedback on the request
    modifiedFields: v.optional(v.array(v.string())),
    modifiedValues: v.optional(v.any()), // { field: newValue }

    // Confidence & reasoning
    confidence: v.optional(v.number()), // 0-1 confidence in decision
    reasoning: v.optional(v.string()), // Why this decision was made

    // Workflow
    escalatedTo: v.optional(v.id("users")), // If escalated, to whom
    deferredUntil: v.optional(v.number()), // If deferred, when to revisit

    // Metadata
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_request", ["requestId"])
    .index("by_reviewer", ["reviewedBy", "reviewedAt"])
    .index("by_decision", ["decision", "reviewedAt"])
    .index("by_request_type", ["requestType", "reviewedAt"]),

  /* ------------------------------------------------------------------ */
  /* ADMIN AUDIT LOG - Compliance audit trail (P1 - COMPLIANCE)         */
  /* Tracks all admin actions for GDPR/SOC2 compliance                  */
  /* ------------------------------------------------------------------ */
  adminAuditLog: defineTable({
    // Action details
    action: v.string(), // "user_created", "config_changed", "data_corrected"
    actionCategory: v.union(
      v.literal("user_management"),
      v.literal("config_change"),
      v.literal("data_correction"),
      v.literal("permission_change"),
      v.literal("deletion"),
      v.literal("access_grant"),
      v.literal("security_event"),
    ),

    // Resource details
    resourceType: v.string(), // "user", "config", "fundingEvent"
    resourceId: v.optional(v.string()), // ID of affected resource

    // State changes
    before: v.optional(v.any()), // State before action
    after: v.any(), // State after action

    // Justification
    reason: v.optional(v.string()), // Why was this action taken
    ticket: v.optional(v.string()), // Related ticket/issue number

    // Actor
    actor: v.id("users"),
    actorRole: v.optional(v.string()), // Role at time of action

    // Security
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),

    // Metadata
    metadata: v.optional(v.any()),
    timestamp: v.number(),
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_actor", ["actor", "timestamp"])
    .index("by_resource", ["resourceType", "resourceId", "timestamp"])
    .index("by_category", ["actionCategory", "timestamp"])
    .index("by_action", ["action", "timestamp"]),

  /* ------------------------------------------------------------------ */
  /* PERSONA CHANGE LOG - Persona configuration versioning (P1)         */
  /* Tracks changes to persona budgets, lenses, hooks                   */
  /* ------------------------------------------------------------------ */
  personaChangeLog: defineTable({
    // Persona identification
    personaId: v.string(), // Persona identifier
    personaType: v.union(
      v.literal("budget"),
      v.literal("lens"),
      v.literal("hook"),
      v.literal("preference"),
      v.literal("setting"),
    ),

    // Change details
    fieldChanged: v.string(), // Which field was changed
    previousValue: v.any(), // Previous value
    newValue: v.any(), // New value

    // Change metadata
    changeType: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("delete"),
      v.literal("reset"),
    ),

    // Actor
    actor: v.optional(v.id("users")), // Who made the change (null = system)
    actorType: v.union(
      v.literal("user"),
      v.literal("system"),
      v.literal("admin"),
      v.literal("automation"),
    ),

    // Justification
    reason: v.optional(v.string()), // Why was this changed

    // Impact tracking
    impactedRecommendations: v.optional(v.number()), // How many recs affected
    impactedJobs: v.optional(v.number()), // How many jobs affected

    // Metadata
    metadata: v.optional(v.any()),
    timestamp: v.number(),
  })
    .index("by_persona", ["personaId", "timestamp"])
    .index("by_type", ["personaType", "timestamp"])
    .index("by_field", ["fieldChanged", "timestamp"])
    .index("by_actor", ["actor", "timestamp"]),

  /* ------------------------------------------------------------------ */
  /* VERIFICATION SLO METRICS - Aggregated verification accuracy (P1)   */
  /* Daily rollup of verification accuracy for SLO tracking             */
  /* ------------------------------------------------------------------ */
  verificationSloMetrics: defineTable({
    // Time window
    date: v.string(), // YYYY-MM-DD
    verificationType: v.string(), // "funding_amount", "company_name", "investor"

    // Confusion matrix
    truePositives: v.number(),
    falsePositives: v.number(),
    trueNegatives: v.number(),
    falseNegatives: v.number(),

    // Derived metrics
    precision: v.number(), // TP/(TP+FP)
    recall: v.number(), // TP/(TP+FN)
    f1Score: v.number(), // Harmonic mean of precision/recall
    accuracy: v.number(), // (TP+TN)/(TP+TN+FP+FN)

    // Volume metrics
    totalVerifications: v.number(),
    totalSources: v.number(),
    avgSourcesPerVerification: v.number(),

    // SLO tracking
    sloTarget: v.number(), // Target precision (e.g., 0.95)
    sloMet: v.boolean(), // Did we meet SLO?
    sloMissMargin: v.optional(v.number()), // How far from target if missed

    // Metadata
    metadata: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_type_date", ["verificationType", "date"])
    .index("by_slo_met", ["sloMet", "date"]),

  /* ------------------------------------------------------------------ */
  /* PROACTIVE SYSTEM - Intelligent Automation & Proactive Features     */
  /* ------------------------------------------------------------------ */

  // Proactive event bus for activity signals
  proactiveEvents,

  // Detected opportunities from detectors
  opportunities,

  // Actions taken (suggest/draft/execute)
  proactiveActions,

  // Detector execution observability
  detectorRuns,

  // Per-user proactive settings
  userProactiveSettings,

  // User feedback for learning
  proactiveFeedbackLabels,

  // User-created custom detectors (premium)
  customDetectors,

  // Admin access control (invite-only)
  adminUsers,

  // Proactive billing and subscriptions
  proactiveSubscriptions,

  // Monthly quota tracking
  usageTracking,

  // Blanket consent tracking
  userConsents,

  /* ------------------------------------------------------------------ */
  /* OBSERVABILITY - OpenTelemetry Traces for LLM Applications (2026)  */
  /* ------------------------------------------------------------------ */

  /**
   * Distributed traces for agent workflows.
   * Implements OpenTelemetry semantic conventions for LLM observability.
   * Compatible with Langfuse, Datadog, LangSmith, etc.
   */
  traces: defineTable({
    traceId: v.string(), // UUID for entire execution
    name: v.string(), // "swarm_execution", "workflow_daily_brief"
    startTime: v.number(), // Unix timestamp ms
    endTime: v.optional(v.number()),
    level: v.union(
      v.literal("DEBUG"),
      v.literal("INFO"),
      v.literal("WARNING"),
      v.literal("ERROR"),
    ),

    // Metadata
    metadata: v.object({
      userId: v.optional(v.string()),
      sessionId: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      metadata: v.optional(v.any()),
    }),

    // Spans (individual operations within trace)
    spans: v.array(v.any()), // Array of span objects with attributes

    // Aggregated metrics
    totalCost: v.optional(v.number()), // Total USD cost across all LLM calls
    totalTokens: v.optional(v.number()), // Total tokens used

    // Status
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("error"),
    ),
    error: v.optional(v.string()),

    createdAt: v.number(),
  })
    .index("by_trace_id", ["traceId"])
    .index("by_name", ["name"])
    .index("by_start_time", ["startTime"])
    .index("by_session_id", ["metadata.sessionId"])
    .index("by_status", ["status"]),

  /* ------------------------------------------------------------------ */
  /* CHECKPOINTING - Agent State Persistence (2026 LangGraph Pattern)  */
  /* ------------------------------------------------------------------ */

  /**
   * Agent checkpoints for long-running workflows.
   * Enables resume-from-failure, human-in-the-loop, and state replay.
   * Based on LangGraph's PostgresSaver pattern.
   */
  checkpoints: defineTable({
    // Identity
    workflowId: v.string(), // UUID for entire workflow (e.g., swarmId)
    checkpointId: v.string(), // UUID for this checkpoint
    checkpointNumber: v.number(), // Sequential: 1, 2, 3...
    parentCheckpointId: v.optional(v.string()), // For branching (rare)

    // Workflow metadata
    workflowType: v.string(), // "swarm", "dcf_analysis", "research"
    workflowName: v.string(), // Human-readable name
    userId: v.optional(v.string()),
    sessionId: v.optional(v.string()),

    // Current state
    currentStep: v.string(), // "gathering", "synthesis", "approval_pending"
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("error"),
      v.literal("waiting_approval"),
    ),
    progress: v.number(), // 0-100%

    // Workflow state (varies by type)
    state: v.any(), // Flexible state object

    // Timing
    createdAt: v.number(),
    error: v.optional(v.string()),
    estimatedTimeRemaining: v.optional(v.number()),
    nextScheduledAction: v.optional(v.string()),
  })
    .index("by_workflow_id", ["workflowId"])
    .index("by_checkpoint_id", ["checkpointId"])
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"]),

  /* ------------------------------------------------------------------ */
  /* BATCH API - Async LLM Jobs for 50% Cost Savings (2026)            */
  /* ------------------------------------------------------------------ */

  /**
   * Batch API jobs for Anthropic & OpenAI.
   * Process non-urgent requests asynchronously for 50% cost discount.
   * Use cases: Daily briefs, scheduled content, background reports.
   */
  batchJobs: defineTable({
    batchId: v.string(), // Our internal ID
    provider: v.union(v.literal("anthropic"), v.literal("openai")),
    providerBatchId: v.string(), // Provider's batch ID

    // Status
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),

    // Progress
    requestCount: v.number(), // Total requests in batch
    completedCount: v.number(), // Completed so far
    failedCount: v.number(), // Failed so far

    // Timing
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()), // 24hrs from creation

    // Results
    results: v.optional(v.array(v.any())), // Completed results
    error: v.optional(v.string()),
  })
    .index("by_batch_id", ["batchId"])
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"]),

  /* ------------------------------------------------------------------ */
  /* INDUSTRY MONITORING - Continuous Updates from AI Leaders (2026)   */
  /* ------------------------------------------------------------------ */

  /**
   * Industry updates from Anthropic, OpenAI, Google DeepMind, LangChain, Vercel AI SDK.
   * Automatically scanned daily to identify relevant patterns and enhancements.
   */
  industryUpdates: defineTable({
    // Source
    provider: v.string(), // "anthropic", "openai", "google", "langchain", "vercel", "xai"
    providerName: v.string(), // "Anthropic", "OpenAI", "xAI", etc.
    url: v.string(), // Source URL

    // Content
    title: v.string(), // Update title/headline
    summary: v.string(), // 2-3 sentence summary
    relevance: v.number(), // Relevance score (0-100)
    actionableInsights: v.array(v.string()), // Key takeaways
    implementationSuggestions: v.array(v.string()), // How to integrate

    // Status tracking
    status: v.union(
      v.literal("new"),
      v.literal("reviewed"),
      v.literal("implemented"),
    ),

    // Timestamps
    scannedAt: v.number(), // When discovered
    reviewedAt: v.optional(v.number()), // When reviewed by team
    implementedAt: v.optional(v.number()), // When integrated
  })
    .index("by_status", ["status"])
    .index("by_scanned_at", ["scannedAt"])
    .index("by_provider", ["provider"])
    .index("by_relevance", ["relevance"]),

  /* ------------------------------------------------------------------ */
  /* X ALGORITHM INTEGRATION - For You Feed & Recommendations (2026)   */
  /* ------------------------------------------------------------------ */

  /**
   * For You Feed Snapshots - Cached personalized feed items
   * Implements X's Thunder + Phoenix + Home Mixer pattern
   */
  forYouFeedSnapshots: defineTable({
    userId: v.id("users"),
    items: v.array(v.any()), // Ranked feed items
    dateGroups: v.optional(
      v.array(
        v.object({
          // Items grouped by date for UI
          dateString: v.string(), // YYYY-MM-DD
          displayLabel: v.string(), // "Today", "Yesterday", "Jan 20"
          items: v.array(v.any()), // Items for this date
        }),
      ),
    ),
    mixRatio: v.object({
      inNetwork: v.number(), // 50% from people you follow
      outOfNetwork: v.number(), // 40% discovery
      trending: v.number(), // 10% trending
    }),
    totalCandidates: v.number(), // Total candidates evaluated
    generatedAt: v.number(), // When generated
  }).index("by_user", ["userId", "generatedAt"]),

  /**
   * Feed Engagement Events - Multi-action tracking for ranking improvement
   * Predicts: view, click, save, share
   */
  feedEngagements: defineTable({
    userId: v.id("users"),
    itemId: v.string(), // Item that was engaged with
    action: v.union(
      v.literal("view"),
      v.literal("click"),
      v.literal("save"),
      v.literal("share"),
    ),
    timestamp: v.number(),
  })
    .index("by_user", ["userId", "timestamp"])
    .index("by_item", ["itemId"])
    .index("by_action", ["action", "timestamp"]),

  /**
   * Document Discovery - Smart recommendations using X algorithm patterns
   */
  documentRecommendations: defineTable({
    userId: v.id("users"),
    documentId: v.id("documents"),
    phoenixScore: v.number(), // 0-100 relevance score
    relevanceReason: v.string(), // Why recommended
    engagementPrediction: v.object({
      view: v.number(), // 0-1 probability
      click: v.number(),
      save: v.number(),
      share: v.number(),
    }),
    source: v.union(
      v.literal("in_network"),
      v.literal("out_of_network"),
      v.literal("trending"),
    ),
    generatedAt: v.number(),
  })
    .index("by_user", ["userId", "phoenixScore"])
    .index("by_document", ["documentId"]),

  /**
   * Agent Marketplace Rankings - Ranked agent discovery
   */
  agentRankings: defineTable({
    agentType: v.string(), // Agent type/category
    agentId: v.string(), // Agent identifier
    phoenixScore: v.number(), // 0-100 ranking score
    usageCount: v.number(), // Total uses
    successRate: v.number(), // 0-1 success rate
    avgLatencyMs: v.number(), // Performance metric
    multiActionPrediction: v.object({
      run: v.number(), // 0-1 probability
      fork: v.number(),
      like: v.number(),
      share: v.number(),
    }),
    lastRankedAt: v.number(),
  })
    .index("by_agent_type", ["agentType", "phoenixScore"])
    .index("by_agent_id", ["agentId"]),

  /**
   * GitHub Repository Discovery - Trending repo analysis
   */
  githubRepositories: defineTable({
    fullName: v.string(), // owner/repo
    name: v.string(),
    description: v.string(),
    language: v.string(),
    stars: v.number(),
    starGrowth7d: v.number(), // Stars gained in 7 days
    phoenixScore: v.number(), // 0-100 relevance
    relevanceReason: v.string(),
    topics: v.array(v.string()),
    url: v.string(),
    lastUpdated: v.number(),
    discoveredAt: v.number(),
  })
    .index("by_phoenix_score", ["phoenixScore"])
    .index("by_star_growth", ["starGrowth7d"])
    .index("by_language", ["language", "stars"]),

  /**
   * Automated PR Suggestions - Generated from industry updates
   */
  prSuggestions: defineTable({
    updateId: v.id("industryUpdates"),
    title: v.string(),
    description: v.string(),
    changes: v.array(v.string()),
    testing: v.array(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("implemented"),
      v.literal("rejected"),
    ),
    createdAt: v.number(),
    approvedAt: v.optional(v.number()),
    implementedAt: v.optional(v.number()),
  })
    .index("by_update", ["updateId"])
    .index("by_status", ["status", "createdAt"]),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // NARRATIVE OPERATING SYSTEM TABLES
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Narrative Threads - Story arcs that evolve over time
   */
  narrativeThreads: defineTable({
    threadId: v.string(),
    name: v.string(),
    slug: v.string(),
    thesis: v.string(),
    counterThesis: v.optional(v.string()),
    entityKeys: v.array(v.string()),
    topicTags: v.array(v.string()),
    currentPhase: v.union(
      v.literal("emerging"),
      v.literal("escalating"),
      v.literal("climax"),
      v.literal("resolution"),
      v.literal("dormant"),
    ),
    firstEventAt: v.number(),
    latestEventAt: v.number(),
    eventCount: v.number(),
    plotTwistCount: v.number(),
    quality: v.object({
      hasMultipleSources: v.boolean(),
      hasRecentActivity: v.boolean(),
      hasVerifiedClaims: v.boolean(),
      hasCounterNarrative: v.boolean(),
    }),
    userId: v.id("users"),
    isPublic: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "latestEventAt"])
    .index("by_slug", ["slug"])
    .index("by_public", ["isPublic", "latestEventAt"])
    .index("by_phase", ["currentPhase", "latestEventAt"])
    .index("by_createdAt", ["createdAt"]),

  /**
   * Narrative Posts - Individual contributions to a thread
   */
  narrativePosts: defineTable({
    postId: v.string(),
    threadId: v.id("narrativeThreads"),
    parentPostId: v.optional(v.id("narrativePosts")),
    postType: v.union(
      v.literal("delta_update"),
      v.literal("thesis_revision"),
      v.literal("evidence_addition"),
      v.literal("counterpoint"),
      v.literal("question"),
      v.literal("correction"),
    ),
    title: v.optional(v.string()),
    content: v.string(),
    changeSummary: v.optional(v.array(v.string())),
    citations: v.array(
      v.object({
        citationKey: v.string(),
        artifactId: v.id("sourceArtifacts"),
        chunkId: v.optional(v.id("artifactChunks")),
        quote: v.optional(v.string()),
        pageIndex: v.optional(v.number()),
        publishedAt: v.optional(v.number()),
      }),
    ),
    supersedes: v.optional(v.id("narrativePosts")),
    supersededBy: v.optional(v.id("narrativePosts")),
    authorType: v.union(v.literal("agent"), v.literal("human")),
    authorId: v.string(),
    authorConfidence: v.optional(v.number()),
    isVerified: v.boolean(),
    hasContradictions: v.boolean(),
    requiresAdjudication: v.boolean(),
    // Agent posting governance: agent reactions excluded from engagement ranking
    isAgentReaction: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId", "createdAt"])
    .index("by_parent", ["parentPostId", "createdAt"])
    .index("by_type", ["postType", "createdAt"])
    .index("by_adjudication", ["requiresAdjudication", "createdAt"])
    .index("by_author", ["authorType", "authorId", "createdAt"]),

  /**
   * Narrative Replies - Thread commentary and evidence additions (Phase 7)
   * Supports: evidence additions, questions, corrections, endorsements
   */
  narrativeReplies: defineTable({
    replyId: v.string(),
    postId: v.id("narrativePosts"),
    parentReplyId: v.optional(v.id("narrativeReplies")),
    replyType: v.union(
      v.literal("evidence"), // New source or counterpoint
      v.literal("question"), // Clarifying question
      v.literal("correction"), // Error fix
      v.literal("support"), // Endorsement
      v.literal("challenge"), // Dispute
    ),
    content: v.string(),
    // Evidence linking
    evidenceArtifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    citationIds: v.optional(v.array(v.string())),
    // Source tracking (for harvested comments)
    sourceType: v.optional(
      v.union(
        v.literal("internal"), // Created in app
        v.literal("hackernews"), // Harvested from HN
        v.literal("reddit"), // Harvested from Reddit
        v.literal("twitter"), // Harvested from X/Twitter
        v.literal("other"), // Other external source
      ),
    ),
    sourceUrl: v.optional(v.string()),
    sourceAuthor: v.optional(v.string()),
    sourceTimestamp: v.optional(v.number()),
    // Author info
    authorType: v.union(
      v.literal("agent"),
      v.literal("human"),
      v.literal("harvested"),
    ),
    authorId: v.string(),
    // Quality signals
    sentiment: v.optional(
      v.union(
        v.literal("positive"),
        v.literal("negative"),
        v.literal("neutral"),
        v.literal("mixed"),
      ),
    ),
    relevanceScore: v.optional(v.number()),
    isHighSignal: v.boolean(),
    // Moderation
    isVerified: v.boolean(),
    isFlagged: v.boolean(),
    flagReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_post", ["postId", "createdAt"])
    .index("by_parent", ["parentReplyId", "createdAt"])
    .index("by_type", ["replyType", "createdAt"])
    .index("by_source", ["sourceType", "createdAt"])
    .index("by_high_signal", ["isHighSignal", "createdAt"]),

  /**
   * Narrative Events - Timestamped occurrences in a thread
   * Phase 6: Added dedup fields for audit-grade hardening
   */
  narrativeEvents: defineTable({
    eventId: v.string(),
    eventIdVersion: v.optional(v.string()),
    eventIdDerivation: v.optional(v.any()),
    threadId: v.id("narrativeThreads"),
    headline: v.string(),
    summary: v.string(),
    significance: v.union(
      v.literal("minor"),
      v.literal("moderate"),
      v.literal("major"),
      v.literal("plot_twist"),
    ),
    occurredAt: v.number(),
    discoveredAt: v.number(),
    weekNumber: v.string(),
    sourceUrls: v.array(v.string()),
    sourceNames: v.array(v.string()),
    citationIds: v.array(v.string()),
    // Optional evidence pointers for verification/citation popovers
    artifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    claimIds: v.optional(v.array(v.string())),
    // Dedup identity (Phase 6)
    contentHash: v.optional(v.string()),
    canonicalUrl: v.optional(v.string()),
    // Update linking (Phase 6)
    supersedesEventId: v.optional(v.id("narrativeEvents")),
    changeSummary: v.optional(v.string()),
    // Claim structure (Phase 6, extended Phase 7)
    claimSet: v.optional(
      v.array(
        v.object({
          claim: v.string(),
          kind: v.optional(
            v.union(
              v.literal("verifiable"),
              v.literal("interpretation"),
              v.literal("prediction"),
            ),
          ),
          confidence: v.number(),
          uncertainty: v.optional(v.number()),
          evidenceArtifactIds: v.array(v.string()),
          // Phase 7: Narrative manipulation risk label
          speculativeRisk: v.optional(
            v.union(
              v.literal("grounded"), // tier1/2 sources directly support
              v.literal("mixed"), // partly supported, partly interpretive
              v.literal("speculative"), // mostly interpretive, missing direct evidence
            ),
          ),
          // Phase 7: Entailment verdict â€” does evidence support the claim?
          entailmentVerdict: v.optional(
            v.union(
              v.literal("entailed"), // evidence directly supports
              v.literal("neutral"), // evidence neither supports nor contradicts
              v.literal("contradicted"), // evidence contradicts
            ),
          ),
          // Phase 7: Link claim to a structured hypothesis
          hypothesisId: v.optional(v.string()),
        }),
      ),
    ),
    // Agent metadata
    discoveredByAgent: v.string(),
    agentConfidence: v.number(),
    // Quality flags
    isVerified: v.boolean(),
    hasContradictions: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId", "occurredAt"])
    .index("by_week", ["weekNumber", "occurredAt"])
    .index("by_discovery", ["discoveredAt"])
    .index("by_significance", ["significance", "occurredAt"])
    .index("by_content_hash", ["contentHash"])
    .index("by_supersedes", ["supersedesEventId"])
    .searchIndex("search_headline", {
      searchField: "headline",
      filterFields: ["threadId"],
    }),

  /**
   * Evidence Artifacts - Immutable evidence snapshots for audit trail
   * Used for citation and claim-evidence binding (Phase 5/6).
   */
  evidenceArtifacts: defineTable({
    artifactId: v.string(),
    artifactVersion: v.string(),
    urlNormalizationVersion: v.string(),
    contentHashVersion: v.string(),
    url: v.string(),
    canonicalUrl: v.string(),
    publisher: v.string(),
    publishedAt: v.optional(v.number()),
    fetchedAt: v.number(),
    contentHash: v.string(),
    extractedQuotes: v.array(
      v.object({
        text: v.string(),
        context: v.optional(v.string()),
      }),
    ),
    entities: v.array(v.string()),
    topics: v.array(v.string()),
    credibilityTier: v.string(),
    retrievalTrace: v.object({
      searchQuery: v.optional(v.string()),
      agentName: v.string(),
      toolName: v.string(),
    }),
    supersedesArtifactId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_artifact_id", ["artifactId"])
    .index("by_content_hash", ["contentHash"])
    .index("by_canonical_url", ["canonicalUrl", "createdAt"])
    .index("by_created_at", ["createdAt"]),

  /**
   * Narrative Search Log - Audit trail of all searches performed
   */
  narrativeSearchLog: defineTable({
    searchId: v.string(),
    query: v.string(),
    searchType: v.union(
      v.literal("web_news"),
      v.literal("historical"),
      v.literal("entity_context"),
      v.literal("verification"),
    ),
    resultCount: v.number(),
    resultUrls: v.array(v.string()),
    resultSnippets: v.optional(v.array(v.string())),
    searchedAt: v.number(),
    weekNumber: v.string(),
    narrativeThreadId: v.optional(v.id("narrativeThreads")),
    narrativeEventIds: v.optional(v.array(v.id("narrativeEvents"))),
    agentName: v.string(),
    workflowId: v.optional(v.string()),
    userId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_workflow", ["workflowId", "searchedAt"])
    .index("by_thread", ["narrativeThreadId", "searchedAt"])
    .index("by_week", ["weekNumber", "searchedAt"])
    .index("by_searched_at", ["searchedAt"])
    .index("by_user", ["userId", "searchedAt"]),

  /**
   * Temporal Facts - Versioned facts with supersession chains
   * Bi-temporal: validFrom/validTo (real world) + observedAt/recordedAt (system)
   */
  temporalFacts: defineTable({
    factId: v.string(),
    threadId: v.id("narrativeThreads"),
    claimText: v.string(),
    subject: v.string(),
    predicate: v.string(),
    object: v.string(),
    // Valid time: when the fact was true in the real world
    validFrom: v.number(),
    validTo: v.optional(v.number()),
    // Transaction time: when we learned/stored it (bi-temporal)
    observedAt: v.optional(v.number()), // When agent retrieved evidence
    recordedAt: v.optional(v.number()), // When DB committed
    confidence: v.number(),
    supersedes: v.optional(v.string()),
    supersededBy: v.optional(v.string()),
    sourceEventIds: v.array(v.id("narrativeEvents")),
    weekNumber: v.string(),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId", "validFrom"])
    .index("by_subject", ["subject", "predicate", "validFrom"])
    .index("by_observed", ["observedAt"]),

  /**
   * Narrative Dispute Chains - Tracks contested claims
   */
  narrativeDisputeChains: defineTable({
    disputeId: v.string(),
    targetType: v.union(
      v.literal("post"),
      v.literal("event"),
      v.literal("fact"),
      v.literal("claim"),
    ),
    targetId: v.string(),
    disputeType: v.union(
      v.literal("factual_error"),
      v.literal("outdated"),
      v.literal("missing_context"),
      v.literal("alternative_interpretation"),
    ),
    originalClaim: v.string(),
    challengeClaim: v.string(),
    evidenceForChallenge: v.array(v.id("sourceArtifacts")),
    status: v.union(
      v.literal("open"),
      v.literal("under_review"),
      v.literal("resolved_original"),
      v.literal("resolved_challenge"),
      v.literal("merged"),
    ),
    resolution: v.optional(v.string()),
    resolvedBy: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    raisedBy: v.string(),
    raisedAt: v.number(),
  })
    .index("by_target", ["targetType", "targetId"])
    .index("by_status", ["status", "raisedAt"]),

  /**
   * Narrative Correlations - Cross-entity relationship tracking
   * Phase 6: Added correlationBasis and reviewStatus for audit-grade hardening
   */
  narrativeCorrelations: defineTable({
    correlationId: v.string(),
    primaryEventId: v.id("narrativeEvents"),
    primaryThreadId: v.id("narrativeThreads"),
    relatedEventIds: v.array(v.id("narrativeEvents")),
    relatedThreadIds: v.array(v.id("narrativeThreads")),
    correlationType: v.union(
      v.literal("causal"),
      v.literal("temporal"),
      v.literal("entity_overlap"),
      v.literal("topic_similarity"),
    ),
    strength: v.number(),
    description: v.string(),
    discoveredByAgent: v.string(),
    // Proof standard (Phase 6)
    correlationBasis: v.union(
      v.literal("shared_entity"),
      v.literal("shared_investor"),
      v.literal("explicit_reference"),
      v.literal("time_proximity"),
      v.literal("topic_similarity"),
      v.literal("llm_inference"),
    ),
    // Evidence binding (Phase 6)
    evidenceEventIds: v.array(v.id("narrativeEvents")),
    evidenceCitationIds: v.optional(v.array(v.string())),
    // Review status (Phase 6)
    reviewStatus: v.union(
      v.literal("auto_approved"),
      v.literal("needs_review"),
      v.literal("human_verified"),
      v.literal("human_rejected"),
    ),
    reviewedBy: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    weekNumber: v.string(),
    createdAt: v.number(),
  })
    .index("by_primary_event", ["primaryEventId"])
    .index("by_primary_thread", ["primaryThreadId"])
    .index("by_week", ["weekNumber", "createdAt"])
    .index("by_review_status", ["reviewStatus", "createdAt"])
    .index("by_basis", ["correlationBasis", "reviewStatus"]),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // P0 QUALITY CONTROL TABLES
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Content Rights Policies - Per-source ToS compliance
   */
  contentRightsPolicies: defineTable({
    domain: v.string(),
    sourceId: v.optional(v.id("sourceArtifacts")),
    policyType: v.union(
      v.literal("platform_default"),
      v.literal("source_specific"),
      v.literal("manual_override"),
    ),
    storageMode: v.union(
      v.literal("full_text"),
      v.literal("excerpt_only"),
      v.literal("hash_metadata"),
      v.literal("link_only"),
    ),
    maxExcerptChars: v.optional(v.number()),
    storageTTLDays: v.optional(v.number()),
    renderingMode: v.union(
      v.literal("direct_quote"),
      v.literal("paraphrase"),
      v.literal("summary_only"),
      v.literal("link_only"),
    ),
    aiUsageMode: v.union(
      v.literal("full"),
      v.literal("inference_only"),
      v.literal("citation_only"),
      v.literal("prohibited"),
    ),
    attributionRequired: v.boolean(),
    attributionTemplate: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_domain", ["domain"])
    .index("by_source", ["sourceId"]),

  /**
   * Claim Classifications - Fact/inference/sentiment separation
   */
  claimClassifications: defineTable({
    postId: v.id("narrativePosts"),
    sentenceIndex: v.number(),
    sentenceText: v.string(),
    claimType: v.union(
      v.literal("fact_claim"),
      v.literal("inference"),
      v.literal("sentiment"),
      v.literal("meta"),
    ),
    confidence: v.number(),
    isVerified: v.boolean(),
    linkedFactIds: v.optional(v.array(v.id("temporalFacts"))),
    linkedArtifactIds: v.optional(v.array(v.id("sourceArtifacts"))),
    verificationNote: v.optional(v.string()),
    // Phase 7: Narrative manipulation risk + entailment
    speculativeRisk: v.optional(
      v.union(
        v.literal("grounded"),
        v.literal("mixed"),
        v.literal("speculative"),
      ),
    ),
    entailmentVerdict: v.optional(
      v.union(
        v.literal("entailed"),
        v.literal("neutral"),
        v.literal("contradicted"),
      ),
    ),
    hypothesisId: v.optional(v.string()),
    classifiedAt: v.number(),
    classifiedBy: v.string(),
  })
    .index("by_post", ["postId", "sentenceIndex"])
    .index("by_type", ["claimType", "isVerified"])
    .index("by_unverified", ["isVerified", "claimType"])
    .index("by_hypothesis", ["hypothesisId", "entailmentVerdict"]),

  /**
   * Truth State - Contested fact display semantics
   */
  truthState: defineTable({
    factId: v.id("temporalFacts"),
    threadId: v.id("narrativeThreads"),
    status: v.union(
      v.literal("canonical"),
      v.literal("contested"),
      v.literal("superseded"),
      v.literal("retracted"),
    ),
    showInDefault: v.boolean(),
    requiresContext: v.boolean(),
    contextNote: v.optional(v.string()),
    resolutionNote: v.optional(v.string()),
    activeDisputeIds: v.array(v.id("narrativeDisputeChains")),
    lastStateChange: v.number(),
    stateChangedBy: v.string(),
  })
    .index("by_fact", ["factId"])
    .index("by_thread", ["threadId", "status"])
    .index("by_contested", ["status", "threadId"]),

  /**
   * Author Trust - Trust scoring for abuse resistance
   */
  authorTrust: defineTable({
    authorType: v.union(v.literal("agent"), v.literal("human")),
    authorId: v.string(),
    tier: v.union(
      v.literal("verified"),
      v.literal("established"),
      v.literal("new"),
      v.literal("quarantined"),
      v.literal("banned"),
    ),
    trustScore: v.number(),
    totalContributions: v.number(),
    verifiedContributions: v.number(),
    flaggedContributions: v.number(),
    lastActivityAt: v.number(),
    tierChangedAt: v.number(),
    tierChangedBy: v.string(),
    tierChangeReason: v.optional(v.string()),
  })
    .index("by_author", ["authorType", "authorId"])
    .index("by_tier", ["tier", "trustScore"]),

  /**
   * Content Quarantine - Pending review content
   */
  contentQuarantine: defineTable({
    contentType: v.union(
      v.literal("post"),
      v.literal("event"),
      v.literal("fact"),
      v.literal("comment"),
    ),
    contentId: v.string(),
    authorId: v.string(),
    reason: v.string(),
    detectedPatterns: v.array(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("expired"),
    ),
    reviewedBy: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_content", ["contentType", "contentId"])
    .index("by_author", ["authorId", "createdAt"]),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PHASE 7: HYPOTHESIS TESTING & SIGNAL METRICS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Narrative Hypotheses - Structured testable sub-claims within a thread
   * Supports competing explanations (H1..Hn) that can all be "live" at once.
   * Each hypothesis has a claim form, measurement approach, and evidence binding.
   * Claims in claimSet and claimClassifications link to these via hypothesisId.
   */
  narrativeHypotheses: defineTable({
    hypothesisId: v.string(),
    threadId: v.id("narrativeThreads"),
    label: v.string(), // e.g. "H1", "H2"
    title: v.string(), // e.g. "Attention displacement"
    claimForm: v.string(), // Testable claim statement
    measurementApproach: v.string(), // How to evaluate this hypothesis
    // Evidence summary
    supportingEvidenceCount: v.number(),
    contradictingEvidenceCount: v.number(),
    evidenceArtifactIds: v.array(v.string()),
    // Status
    status: v.union(
      v.literal("active"), // Still being evaluated
      v.literal("supported"), // Preponderance of evidence supports
      v.literal("weakened"), // Evidence mostly contradicts
      v.literal("inconclusive"), // Not enough evidence either way
      v.literal("retired"), // Superseded or no longer relevant
    ),
    // Confidence and risk
    confidence: v.number(), // 0-1 confidence in this hypothesis
    speculativeRisk: v.union(
      v.literal("grounded"),
      v.literal("mixed"),
      v.literal("speculative"),
    ),
    // Falsification criteria -- what would change our mind
    falsificationCriteria: v.optional(v.string()),
    // Competing hypothesis links
    competingHypothesisIds: v.optional(v.array(v.string())),
    // Metadata
    createdByAgent: v.string(),
    reviewedBy: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId", "status"])
    .index("by_hypothesis_id", ["hypothesisId"])
    .index("by_status", ["status", "updatedAt"]),

  /**
   * Editorial Hypotheses (Phase 8b §2) — public-by-default standalone
   * hypotheses for the editorial home's "competing explanations"
   * section.  Independent of narrativeThreads/users so the editorial
   * home can render without auth + without threading the LinkedIn
   * pipeline through them.
   *
   * Each row stores the deterministic 6-bool evidenceChecklist at seed
   * time (per the misc PR also addresses the "stored vs derived"
   * note from the original P0 list).  The checklist is computed from
   * the claim's source quality and explicitly stored — readers see the
   * stored value rather than re-derived heuristics.
   */
  editorialHypotheses: defineTable({
    hypothesisId: v.string(),                      // stable string id
    label: v.string(),                             // e.g. "H1"
    title: v.string(),                             // short headline
    topicSlug: v.string(),                         // e.g. "agent-stack-2026"
    topicName: v.string(),                         // human-readable topic
    claimForm: v.string(),                         // testable claim
    measurementApproach: v.string(),               // how we'd evaluate
    falsificationCriteria: v.string(),             // what would change our minds
    competingHypothesisIds: v.array(v.string()),   // sibling hypotheses
    supportingEvidenceCount: v.number(),
    contradictingEvidenceCount: v.number(),
    confidence: v.number(),                        // 0..1 analyst prior
    speculativeRisk: v.union(
      v.literal("grounded"),
      v.literal("mixed"),
      v.literal("speculative"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("supported"),
      v.literal("weakened"),
      v.literal("inconclusive"),
      v.literal("retired"),
    ),
    // STORED checklist — computed at seed time, not re-derived on read.
    // This addresses the misc-PR note about evidenceChecklist being
    // derived rather than stored.  Reading code falls back to derived
    // values only when this field is missing.
    evidenceChecklist: v.object({
      hasPrimarySource: v.boolean(),
      hasCorroboration: v.boolean(),
      hasFalsifiableClaim: v.boolean(),
      hasQuantitativeData: v.boolean(),
      hasNamedAttribution: v.boolean(),
      isReproducible: v.boolean(),
    }),
    sourceUrls: v.array(v.string()),
    createdByAgent: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_topic", ["topicSlug", "status"])
    .index("by_hypothesis_id", ["hypothesisId"])
    .index("by_status", ["status", "updatedAt"]),

  /**
   * Narrative Signal Metrics - Quantitative data products for hypothesis evaluation
   * Stores time-series measurements for attention, policy, labor, and market signals.
   * These feed directly into hypothesis scoring and narrative generation.
   */
  narrativeSignalMetrics: defineTable({
    metricId: v.string(),
    threadId: v.optional(v.id("narrativeThreads")),
    hypothesisId: v.optional(v.string()),
    // Signal domain
    domain: v.union(
      v.literal("attention"), // News/social/search volume
      v.literal("policy"), // EO/memo/procurement activity
      v.literal("labor"), // Job postings, layoffs
      v.literal("market"), // Insider selling, sector rotation
      v.literal("sentiment"), // Public opinion / social mood
    ),
    // Metric identity
    metricName: v.string(), // e.g. "attentionShiftDelta", "policyVelocityScore"
    topic: v.string(), // What this measures, e.g. "AI layoffs", "Epstein coverage"
    // Value
    value: v.number(),
    unit: v.optional(v.string()), // e.g. "articles/week", "percent", "score"
    // Time window
    measuredAt: v.number(),
    windowStartAt: v.number(),
    windowEndAt: v.number(),
    // Source and confidence
    sourceDescription: v.string(), // e.g. "GDELT news volume", "Indeed Hiring Lab"
    sourceUrls: v.array(v.string()),
    sourceTier: v.union(
      v.literal("tier1"), // Primary source (SEC, Federal Register, NEJM)
      v.literal("tier2"), // Reputable secondary (Reuters, Bloomberg)
      v.literal("tier3"), // Social/aggregated (Reddit, HN mention counts)
      v.literal("tier4"), // Unverified / model-derived
    ),
    confidence: v.number(),
    // Comparison baseline
    baselineValue: v.optional(v.number()),
    deltaFromBaseline: v.optional(v.number()),
    // Agent metadata
    collectedByAgent: v.string(),
    createdAt: v.number(),
  })
    .index("by_domain", ["domain", "measuredAt"])
    .index("by_thread", ["threadId", "domain", "measuredAt"]),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // GROUND TRUTH & VERIFICATION AUDIT TABLES
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Ground Truth Facts - Verified facts from authoritative sources
   */
  groundTruthFacts: defineTable({
    factId: v.string(),
    subject: v.string(),
    subjectIdentifiers: v.object({
      cik: v.optional(v.string()),
      ticker: v.optional(v.string()),
      lei: v.optional(v.string()),
      doi: v.optional(v.string()),
      nctId: v.optional(v.string()),
      patentNumber: v.optional(v.string()),
    }),
    category: v.string(),
    claim: v.string(),
    quantitativeValue: v.optional(v.number()),
    quantitativeUnit: v.optional(v.string()),
    effectiveDate: v.number(),
    expirationDate: v.optional(v.number()),
    sourceUrl: v.string(),
    sourceTier: v.string(),
    verificationMethod: v.string(),
    verifiedAt: v.number(),
    verifiedBy: v.string(),
    supersededBy: v.optional(v.string()),
    auditNotes: v.optional(v.string()),
  })
    .index("by_subject", ["subject", "effectiveDate"])
    .index("by_category", ["category", "effectiveDate"])
    .index("by_source", ["sourceUrl"])
    .index("by_active", ["subject", "expirationDate"]),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // AGENT OS â€” Perpetual Multi-Agent Runtime
  // First-class agent identities, communication channels, and heartbeat tracking.
  // Enables "agents as employees" pattern: always-ready, event-driven, governed.
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  /**
   * Agent Identities â€” first-class agent profiles with persona, permissions, and budget.
   * Unlike agentRuns (per-invocation execution records), this tracks the agent's
   * persistent identity, capabilities, and operational constraints across all sessions.
   */
  agentIdentities: defineTable({
    agentId: v.string(),
    name: v.string(),
    persona: v.string(),
    allowedTools: v.array(v.string()),
    allowedChannels: v.array(v.string()),
    // Operational constraints
    heartbeatIntervalMs: v.optional(v.number()),
    budgetDailyTokens: v.optional(v.number()),
    budgetDailyCostUsd: v.optional(v.number()),
    maxConcurrentRuns: v.optional(v.number()),
    // Trust integration â€” links to authorTrust for reputation tracking
    authorTrustTier: v.optional(
      v.union(
        v.literal("verified"),
        v.literal("established"),
        v.literal("new"),
        v.literal("quarantined"),
        v.literal("banned"),
      ),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("paused"),
      v.literal("retired"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_agentId", ["agentId"])
    .index("by_status", ["status", "updatedAt"])
    .index("by_name", ["name"]),

  /**
   * Agent Channels â€” grouping for teams/rooms.
   * narrativeThreads are content threads (research outputs);
   * agentChannels are operational communication channels (coordination).
   */
  agentChannels: defineTable({
    channelId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    memberAgentIds: v.array(v.string()),
    memberUserIds: v.array(v.string()),
    channelType: v.union(
      v.literal("team"),
      v.literal("broadcast"),
      v.literal("alert"),
    ),
    // Feed/ranking config for this channel
    rankingWeights: v.optional(
      v.object({
        recency: v.optional(v.number()),
        evidenceCoverage: v.optional(v.number()),
        novelty: v.optional(v.number()),
        authorTrust: v.optional(v.number()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_channelId", ["channelId"])
    .index("by_type", ["channelType", "updatedAt"]),

  /**
   * Agent Heartbeats â€” lightweight heartbeat log for perpetual agent runtime.
   * Tracks each "wake up" event: what triggered it, what work was done, cost.
   * Not agentRuns (which tracks full LLM invocations); this is the scheduling layer.
   */
  agentHeartbeats: defineTable({
    agentId: v.string(),
    triggeredBy: v.union(
      v.literal("schedule"),
      v.literal("event"),
      v.literal("manual"),
      v.literal("sweep"),
    ),
    triggerEventId: v.optional(v.string()),
    triggerOpportunityId: v.optional(v.string()),
    status: v.union(
      v.literal("started"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    // Work summary
    workQueueItemsProcessed: v.optional(v.number()),
    postsCreated: v.optional(v.number()),
    gapsIdentified: v.optional(v.number()),
    tokensBurned: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    // Linkage
    agentRunId: v.optional(v.id("agentRuns")),
    // Timestamps
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  })
    .index("by_agent", ["agentId", "startedAt"])
    .index("by_agent_status", ["agentId", "status"])
    .index("by_trigger", ["triggeredBy", "startedAt"]),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // MODEL ROUTER â€” Unified Inference Layer Audit Log
  // Every model call routed through modelRouter.ts is logged here for
  // budget tracking, usage dashboards, cost analysis, and repro packs.
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  modelRouterCalls: defineTable({
    modelId: v.string(),
    taskCategory: v.string(),
    requestedTier: v.string(),
    actualTier: v.string(),
    agentId: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    latencyMs: v.number(),
    fallbacksUsed: v.number(),
    fromCache: v.boolean(),
    pinnedModel: v.union(v.string(), v.null()),
    success: v.boolean(),
    errorMessage: v.union(v.string(), v.null()),
    calledAt: v.number(),
  })
    .index("by_agent", ["agentId", "calledAt"])
    .index("by_model", ["modelId", "calledAt"])
    .index("by_task", ["taskCategory", "calledAt"])
    .index("by_tier", ["actualTier", "calledAt"]),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // JUDGE METRICS â€” Standardized Boolean + Numeric Evaluation Outputs
  // Every LLM judge evaluation persists structured metrics here.
  // No prose â€” only booleans, 0-1 numbers, and categorical decisions.
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  judgeMetrics: defineTable({
    judgeId: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    evaluationContext: v.optional(v.string()),
    agentRunId: v.optional(v.string()),
    /** Boolean metric flags */
    booleans: v.any(),
    /** Numeric metric scores (0-1) */
    numerics: v.any(),
    /** Categorical decisions (verdict, duplicate_decision, etc.) */
    categories: v.any(),
    /** Whether all critical metrics pass */
    criticalPass: v.boolean(),
    /** Model used for judging */
    judgeModel: v.optional(v.string()),
    /** Latency of the judge call in ms */
    latencyMs: v.optional(v.number()),
    /** Raw reasoning (debugging only, not the primary output) */
    reasoning: v.optional(v.string()),
    recordedAt: v.number(),
  })
    .index("by_target", ["targetType", "targetId"])
    .index("by_judge", ["judgeId", "recordedAt"])
    .index("by_critical", ["criticalPass", "recordedAt"]),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // PROMOTION APPROVALS â€” HITL Queue for High-Impact Writes
  // Agents submit promotion requests; human operators approve/reject.
  // Enforces observation-vs-promotion boundary for knowledge integrity.
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  promotionApprovals: defineTable({
    agentId: v.string(),
    writeType: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    justification: v.string(),
    context: v.optional(v.string()),
    decision: v.string(),
    reviewedBy: v.union(v.string(), v.null()),
    reviewedAt: v.union(v.number(), v.null()),
    reviewNotes: v.union(v.string(), v.null()),
    requestedAt: v.number(),
  })
    .index("by_target", ["targetType", "targetId"])
    .index("by_decision", ["decision", "requestedAt"])
    .index("by_agent", ["agentId", "requestedAt"]),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // AGENT NAVIGATION INTENTS â€” Agent-driven UI view switching
  // Agents store navigation requests; frontend watches via useQuery and switches views.
  // Enables "do everything from chat" â€” agent says "opening that for you" and UI responds.
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  agentNavigationIntents: defineTable({
    navigationId: v.string(),
    threadId: v.string(),
    targetView: v.string(),
    context: v.optional(v.any()),
    reason: v.optional(v.string()),
    status: v.string(),
    createdAt: v.number(),
  })
    .index("by_threadId_and_status", ["threadId", "status"])
    .index("by_navigationId", ["navigationId"]),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // OPENCLAW â€” Sandboxed AI Agent Orchestration
  // Workflow definitions, session lifecycle, execution audit trail, delegations
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  openclawWorkflows,
  openclawSessions,
  openclawExecutions,
  openclawDelegations,

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // FORECASTING OS â€” Prediction Engine with Brier Scoring
  // Forecasts, evidence ledger, resolutions, update history, calibration log
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  forecasts,
  forecastEvidence,
  forecastResolutions,
  forecastUpdateHistory,
  forecastCalibrationLog,

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // MESSAGING â€” Channel Provider Abstraction Layer
  // Multi-channel preferences, fallback chains, opt-in/out, quiet hours
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  channelPreferences: defineTable({
    userId: v.id("users"),
    /** Ordered fallback chain: ["whatsapp", "slack", "email"] */
    preferredChannels: v.array(v.string()),
    /** Per-channel configuration */
    channelConfigs: v.array(
      v.object({
        channelId: v.string(),
        enabled: v.boolean(),
        /** Recipient identifier (phone, email, chat ID, session key) */
        identifier: v.string(),
        /** GDPR/TCPA explicit opt-in */
        optedIn: v.boolean(),
        /** Quiet hours start (e.g., "22:00") */
        quietHoursStart: v.optional(v.string()),
        /** Quiet hours end (e.g., "08:00") */
        quietHoursEnd: v.optional(v.string()),
        /** Max messages per day per channel */
        maxPerDay: v.optional(v.number()),
        /** Content types this channel receives: ["alert", "digest", "report"] */
        contentTypes: v.optional(v.array(v.string())),
      }),
    ),
    /** OpenClaw session keys for Gateway channels */
    openclawSessionKeys: v.optional(
      v.array(
        v.object({
          channelId: v.string(),
          sessionKey: v.string(),
        }),
      ),
    ),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // OPERATOR PROFILES â€” User-authored agent policy (USER.md equivalent)
  // Governs identity, goals, permissions, budget, output preferences
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  operatorProfiles: defineTable({
    userId: v.id("users"),
    /** Links to the markdown document in the documents table */
    documentId: v.id("documents"),

    /** Parsed structured config (extracted from markdown at save time) */
    identity: v.object({
      displayName: v.string(),
      role: v.optional(v.string()),
      domains: v.optional(v.array(v.string())),
      /** "concise" | "detailed" | "bullet-heavy" */
      writingStyle: v.optional(v.string()),
    }),

    goals: v.array(
      v.object({
        rank: v.number(),
        description: v.string(),
      }),
    ),

    /** "assist" | "batch_autopilot" | "full_autopilot" */
    autonomyMode: v.string(),
    /** "3h" | "6h" | "12h" | "daily" */
    scheduleInterval: v.optional(v.string()),
    /** "08:00" for daily mode (UTC) */
    scheduleTimeUtc: v.optional(v.string()),

    permissions: v.object({
      readWeb: v.boolean(),
      readDocs: v.boolean(),
      readEmail: v.boolean(),
      readCalendar: v.boolean(),
      writeForumPosts: v.boolean(),
      writeEmailDrafts: v.boolean(),
      sendEmail: v.boolean(),
      submitForms: v.boolean(),
      uploadDocuments: v.boolean(),
    }),

    budget: v.object({
      /** e.g., 50000 */
      maxTokensPerRun: v.number(),
      /** e.g., 20 */
      maxToolCallsPerRun: v.number(),
      /** e.g., 5 */
      maxExternalWritesPerRun: v.number(),
      /** "free" | "cheap" | "standard" */
      preferredModelTier: v.string(),
    }),

    outputPreferences: v.object({
      /** "tldr_bullets" | "narrative" | "structured" */
      briefFormat: v.string(),
      includeCostEstimate: v.boolean(),
      /** "inline" | "footnotes" */
      citationStyle: v.string(),
    }),

    lastSyncedToFilesystem: v.optional(v.number()),
    updatedAt: v.number(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // BATCH AUTOPILOT â€” Per-user scheduled autonomy
  // Sweep cron checks schedules â†’ triggers batch runs â†’ collects delta â†’
  // summarizes via free models â†’ generates personalized brief â†’ delivers
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  batchAutopilotSchedules: defineTable({
    userId: v.id("users"),
    profileId: v.id("operatorProfiles"),
    /** Interval in ms: 3h=10800000, 6h=21600000, 12h=43200000, 24h=86400000 */
    intervalMs: v.number(),
    isEnabled: v.boolean(),
    lastRunAt: v.optional(v.number()),
    nextRunAt: v.number(),
    /** Auto-disable after 3 consecutive failures */
    consecutiveFailures: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_next_run", ["isEnabled", "nextRunAt"]),

  batchAutopilotRuns: defineTable({
    userId: v.id("users"),
    scheduleId: v.id("batchAutopilotSchedules"),
    /** "collecting" | "summarizing" | "planning" | "generating_brief" | "delivering" | "completed" | "failed" */
    status: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    /** = previous run's completedAt (or profile createdAt for first run) */
    windowStartAt: v.number(),
    /** = this run's startedAt */
    windowEndAt: v.number(),
    /** Collected data counts */
    feedItemsCount: v.number(),
    signalsCount: v.number(),
    narrativeEventsCount: v.number(),
    /** Free-model summary of new discoveries */
    deltaSummary: v.optional(v.string()),
    /** Generated brief stored as document */
    briefDocumentId: v.optional(v.id("documents")),
    /** Brief content for delivery */
    briefMarkdown: v.optional(v.string()),
    /** Actions planned during the run (digest-first: usually empty) */
    plannedActions: v.optional(
      v.array(
        v.object({
          description: v.string(),
          /** "low" | "medium" | "high" */
          riskTier: v.string(),
          requiredPermission: v.string(),
          /** "planned" | "approved" | "executed" | "skipped" */
          status: v.string(),
          result: v.optional(v.string()),
        }),
      ),
    ),
    /** Cost tracking */
    tokensUsed: v.number(),
    modelCallsCount: v.number(),
    costUsd: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_user_status", ["userId", "status"])
    .index("by_schedule", ["scheduleId"])
    .index("by_started", ["startedAt"]),

  /* ------------------------------------------------------------------ */
  /* MISSION EXECUTION — v2 Layer A + C                                  */
  /* ------------------------------------------------------------------ */
  missions,
  taskPlans,
  runSteps,
  judgeReviews,
  retryAttempts,
  sniffChecks,
  mergeBoundaries,
  agentPolicies,
  passportEnforcementLogs,
  decisionMemory,
  preExecutionGates,
  consistencyAlerts,

  /* ------------------------------------------------------------------ */
  /* INTELLIGENCE GRAPH — v2 Layer E                                      */
  /* ------------------------------------------------------------------ */
  intelligenceEntities,
  entityAliases,
  peopleProfiles,
  investorProfiles,
  fundHoldings,
  ownershipSnapshots,
  stakeholderGraphs,

  /* ------------------------------------------------------------------ */
  /* WORLD GRAPH — v2 Layer E                                             */
  /* ------------------------------------------------------------------ */
  geoEntities,
  geoRelationships,
  infrastructureAssets,
  countryRiskSnapshots,
  entityExposureEdges,
  marketSignals,

  /* ------------------------------------------------------------------ */
  /* EVALUATION — v2 Layer H                                              */
  /* ------------------------------------------------------------------ */
  inferenceCalls,
  baselineComparisons,
  routingRecommendations,
  canaryRuns,

  /* ------------------------------------------------------------------ */
  /* TRAJECTORY INTELLIGENCE — V3                                         */
  /* ------------------------------------------------------------------ */
  trajectoryEntities,
  trajectorySpans,
  trajectoryEvidenceBundles,
  trajectoryJudgeVerdicts,
  trajectoryFeedbackEvents,
  trajectoryInterventionEvents,
  trajectoryTrustNodes,
  trajectoryTrustEdges,
  trajectorySummaries,
  trajectoryCompoundingScores,
  trajectoryBenchmarkRuns,

  /* ------------------------------------------------------------------ */
  /* SUCCESS LOOPS OS                                                    */
  /* ------------------------------------------------------------------ */
  successLoopRegistry,
  successLoopEvents,
  successLoopExperiments,
  frozenDecisions,
  successOutcomeLinks,
  agentResponseReviews,

  /* ------------------------------------------------------------------ */
  /* MCP GATEWAY — API keys & session telemetry                          */
  /* ------------------------------------------------------------------ */
  mcpApiKeys,
  mcpGatewaySessions,

  /* ------------------------------------------------------------------ */
  /* FOUNDER PLATFORM                                                    */
  /* ------------------------------------------------------------------ */
  founderWorkspaces,
  founderCompanies,
  founderImportedAssets,
  founderProducts,
  founderInitiatives,
  founderAgents,
  founderSignals,
  founderDecisions,
  founderInterventions,
  founderOutcomes,
  founderContextSnapshots,
  founderTimelineEvents,
  founderEvidence,
  founderPendingActions,
  founderTaskPackets,
  founderAgentPresence,
  founderCommandMessages,
  founderApprovalQueue,
  // Phase 10 — Causal Memory & Trajectory Intelligence
  founderEventLedger,
  founderPathSteps,
  founderStateDiffs,
  founderTimeRollups,
  founderPacketVersions,
  founderMemoVersions,
  founderImportantChanges,
  founderTrajectoryScores,
  founderRelatedEntities,
  // Phase 11 — Ambient Intelligence Layer
  ambientIngestionQueue,
  ambientCanonicalObjects,
  ambientChangeDetections,
  ambientPacketReadiness,
  // Phase 13 — Dogfood Judge Fix System
  dogfoodSessions,
  dogfoodJudgeRuns,
  dogfoodFailureCases,
  dogfoodFixAttempts,
  // Phase 14 — Shared Context Persistence
  sharedContextPeers,
  sharedContextPackets,
  sharedContextTasks,
  sharedContextMessages,
  // Phase 15 — Founder Operating Profiler
  profilerEvents: defineTable({
    sessionId: v.string(),
    surface: v.string(),
    integrationPath: v.string(),
    toolName: v.string(),
    toolInputSummary: v.optional(v.string()),
    latencyMs: v.number(),
    estimatedCostUsd: v.number(),
    success: v.boolean(),
    isDuplicate: v.boolean(),
    modelUsed: v.optional(v.string()),
    tokenIn: v.optional(v.number()),
    tokenOut: v.optional(v.number()),
    classification: v.optional(v.string()),
    query: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_session", ["sessionId", "timestamp"])
    .index("by_tool", ["toolName", "timestamp"])
    .index("by_fingerprint", ["fingerprint"]),
  profilerSessionSummaries: defineTable({
    sessionId: v.string(),
    surface: v.string(),
    roleInferred: v.string(),
    totalCalls: v.number(),
    totalCostUsd: v.number(),
    totalLatencyMs: v.number(),
    redundantCalls: v.number(),
    uniqueTools: v.array(v.string()),
    topToolChain: v.optional(v.string()),
    classification: v.optional(v.string()),
    query: v.optional(v.string()),
    timestamp: v.number(),
  }).index("by_timestamp", ["timestamp"]),

  // ── Search Sessions (Convex-native search pipeline) ──────────────────
  searchSessions: defineTable({
    query: v.string(),
    lens: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("classifying"),
      v.literal("searching"),
      v.literal("extracting"),
      v.literal("synthesizing"),
      v.literal("enriching"),
      v.literal("complete"),
      v.literal("error"),
    ),
    classification: v.optional(
      v.object({
        type: v.string(),
        entity: v.optional(v.string()),
        entities: v.optional(v.array(v.string())),
        lens: v.string(),
      }),
    ),
    trace: v.array(
      v.object({
        step: v.string(),
        tool: v.optional(v.string()),
        status: v.string(),
        detail: v.optional(v.string()),
        durationMs: v.optional(v.number()),
        startedAt: v.number(),
      }),
    ),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    userId: v.optional(v.id("users")),
    episodeId: v.optional(v.id("founderEpisodes")),
  })
    .index("by_user", ["userId", "startedAt"])
    .index("by_status", ["status"]),

  // ── Founder Episodes (durable before/during/after lifecycle) ──────────
  founderEpisodes: defineTable({
    episodeType: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("error"),
      v.literal("aborted"),
    ),
    query: v.optional(v.string()),
    lens: v.optional(v.string()),
    entityName: v.optional(v.string()),
    packetId: v.optional(v.string()),
    packetType: v.optional(v.string()),
    summary: v.optional(v.string()),
    searchSessionId: v.optional(v.id("searchSessions")),
    spans: v.array(
      v.object({
        stage: v.union(
          v.literal("before"),
          v.literal("during"),
          v.literal("after"),
        ),
        type: v.string(),
        status: v.union(
          v.literal("ok"),
          v.literal("running"),
          v.literal("error"),
        ),
        label: v.string(),
        detail: v.optional(v.string()),
        timestamp: v.string(),
        metrics: v.optional(v.any()),
      }),
    ),
    toolsInvoked: v.array(v.string()),
    artifactsProduced: v.array(v.string()),
    traceStepCount: v.optional(v.number()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    userId: v.optional(v.id("users")),
  })
    .index("by_status", ["status"])
    .index("by_type", ["episodeType", "startedAt"]),
  /* ------------------------------------------------------------------ */
  /* DILIGENCE PROJECTIONS - Structured output per diligence block       */
  /*                                                                     */
  /* One row per (entitySlug, blockType, scratchpadRunId) projection.    */
  /* The orchestrator emits these after the structuring pass. The UI     */
  /* reads them via useDiligenceBlocks → useDiligenceDecorations →        */
  /* DiligenceDecorationPlugin (ProseMirror widget overlay).             */
  /*                                                                     */
  /* 2026-04-19: generic projection orchestrator now materializes rows    */
  /* from saved report sections. Older entities can still fall back to    */
  /* snapshot-derived projections until the notebook surface backfills     */
  /* them via domains/product/diligenceProjections.materializeForEntity.  */
  /*                                                                     */
  /* Pattern: scratchpad-first → structure → deterministic merge         */
  /* See: .claude/rules/scratchpad_first.md                              */
  /*      .claude/rules/orchestrator_workers.md                          */
  /*      docs/architecture/AGENT_PIPELINE.md                            */
  /*      src/features/entities/components/notebook/DiligenceDecorationPlugin.ts */
  /* ------------------------------------------------------------------ */
  diligenceProjections: defineTable({
    /** Canonical entity this projection belongs to. */
    entitySlug: v.string(),
    /** One of the 10 diligence block types + "projection" fallback. */
    blockType: v.union(
      v.literal("projection"),
      v.literal("founder"),
      v.literal("product"),
      v.literal("funding"),
      v.literal("news"),
      v.literal("hiring"),
      v.literal("patent"),
      v.literal("publicOpinion"),
      v.literal("competitor"),
      v.literal("regulatory"),
      v.literal("financial"),
    ),
    /** Scratchpad run that produced this projection. */
    scratchpadRunId: v.string(),
    /**
     * Monotonic version — bumped whenever a structuring pass re-derives
     * this block. Used by the decoration plugin to memoize rebuilds.
     */
    version: v.number(),
    /** Overall evidence tier (computed from verification gates). */
    overallTier: v.union(
      v.literal("verified"),
      v.literal("corroborated"),
      v.literal("single-source"),
      v.literal("unverified"),
    ),
    /** Short header text rendered at the top of the decoration. */
    headerText: v.string(),
    /** Prose body (paragraphs joined with blank lines). Optional. */
    bodyProse: v.optional(v.string()),
    /** Source refs that ground this projection. */
    sourceRefIds: v.optional(v.array(v.string())),
    /** Source count surfaced directly in the overlay footer. */
    sourceCount: v.optional(v.number()),
    /** Short human label for the source set (e.g. "linkedin.com · sec.gov"). */
    sourceLabel: v.optional(v.string()),
    /** Notebook-style source tokens (e.g. [s1], [s2]). */
    sourceTokens: v.optional(v.array(v.string())),
    /** Block-specific candidate payload (e.g., FounderCandidate[]). */
    payload: v.optional(v.any()),
    /** Scratchpad section id this projection was derived from. */
    sourceSectionId: v.optional(v.string()),
    /** Epoch ms — when the structuring pass last updated this projection. */
    updatedAt: v.number(),
    /**
     * Epoch ms — set when the user clicks "Refresh" on the decoration.
     * The orchestrator picks up any projection where
     * refreshRequestedAt > updatedAt and re-runs the block's sub-agent.
     * Cleared implicitly when the next upsertFromStructuringPass bumps
     * updatedAt past this timestamp.
     */
    refreshRequestedAt: v.optional(v.number()),
  })
    .index("by_entity", ["entitySlug"])
    .index("by_entity_block", ["entitySlug", "blockType"])
    .index("by_scratchpad", ["scratchpadRunId"])
    .index("by_entity_block_run", [
      "entitySlug",
      "blockType",
      "scratchpadRunId",
    ])
    .index("by_refresh_requested", ["refreshRequestedAt"]),

  /* ------------------------------------------------------------------ */
  /* diligenceRunTelemetry — one row per orchestrator projection emit.  */
  /*                                                                     */
  /* This is the measurement ledger for the real-time chat + report     */
  /* generator pipeline. Every call to emitDiligenceProjectionInstrumented */
  /* (server/pipeline/diligenceProjectionWriter.ts) should land one row  */
  /* here via recordTelemetry so we can replay the judge retroactively   */
  /* and chart the pipeline's health over time.                          */
  /*                                                                     */
  /* BOUND: rows are write-once. Downstream maintenance deletes old      */
  /*        rows (>90 days) via a scheduled job — not modeled here.     */
  /* HONEST_STATUS: errorMessage is populated on failed emits so the    */
  /*                judge can evaluate the failure path.                */
  /* DETERMINISTIC: replaying a telemetry row through the judge must    */
  /*                produce the same verdict byte-for-byte.             */
  /* ------------------------------------------------------------------ */
  diligenceRunTelemetry: defineTable({
    /** Canonical entity this projection belonged to. */
    entitySlug: v.string(),
    /** One of the 10 canonical block types or "projection". */
    blockType: v.string(),
    /** Stable id for the scratchpad run that emitted this projection. */
    scratchpadRunId: v.string(),
    /** Version passed to the upsert mutation. */
    version: v.number(),
    /** Overall tier at time of emit. */
    overallTier: v.string(),
    /** Mirror of args.headerText — handy for human review. */
    headerText: v.string(),
    /** Emit outcome: "created" | "updated" | "stale" | "error" (no result). */
    status: v.string(),
    /** ms since epoch. */
    startedAt: v.number(),
    endedAt: v.number(),
    /** Derived convenience: endedAt - startedAt. Indexed so dashboards can sort. */
    elapsedMs: v.number(),
    /** Optional instrumentation — undefined means "not reported", not "zero". */
    toolCalls: v.optional(v.number()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    sourceCount: v.optional(v.number()),
    /** Populated when the emit errored. */
    errorMessage: v.optional(v.string()),
    /** Schema bump — increment when RunTelemetry shape changes. */
    schemaVersion: v.optional(v.number()),
  })
    .index("by_entity", ["entitySlug"])
    .index("by_entity_block", ["entitySlug", "blockType"])
    .index("by_scratchpad", ["scratchpadRunId"])
    .index("by_status", ["status"])
    .index("by_started", ["startedAt"]),

  /* ------------------------------------------------------------------ */
  /* diligenceJudgeVerdicts — boolean-gate verdicts over a telemetry row. */
  /*                                                                     */
  /* The judge in server/pipeline/diligenceJudge.ts runs inline on every */
  /* emit AND can be replayed from stored telemetry. We persist verdicts */
  /* here so the operator UI can chart gate-level pass/fail trends       */
  /* without re-running the judge on every page load.                    */
  /*                                                                     */
  /* HONEST_SCORES: score is stored as passCount / (pass + fail) — no    */
  /*                hardcoded floors. `gatesJson` carries the full gate   */
  /*                breakdown so dashboards can drill in without another */
  /*                table join.                                           */
  /* ------------------------------------------------------------------ */
  diligenceJudgeVerdicts: defineTable({
    /** Link back to the telemetry row that was judged. */
    telemetryId: v.id("diligenceRunTelemetry"),
    /** Denormalized for index-only queries. */
    entitySlug: v.string(),
    blockType: v.string(),
    scratchpadRunId: v.string(),
    /** Bounded enum (mirrors AGENT_RUN_VERDICT_WORKFLOW.md). */
    verdict: v.string(),
    passCount: v.number(),
    failCount: v.number(),
    skipCount: v.number(),
    /** 0..1, skipped gates excluded from denominator. */
    score: v.number(),
    latencyBudgetMs: v.number(),
    /**
     * JSON-encoded GateResult[] — keeps the table shape small while
     * preserving the full per-gate breakdown. Dashboards decode on read.
     */
    gatesJson: v.string(),
    /** ms since epoch when this verdict was recorded. */
    judgedAt: v.number(),
    /** Which judge revision produced this verdict — enables apples-to-apples rollouts. */
    judgeVersion: v.optional(v.string()),
  })
    .index("by_telemetry", ["telemetryId"])
    .index("by_entity", ["entitySlug"])
    .index("by_entity_block", ["entitySlug", "blockType"])
    .index("by_verdict", ["verdict"])
    .index("by_judged_at", ["judgedAt"]),

  /* ------------------------------------------------------------------ */
  /* diligenceLlmJudgeRuns — non-deterministic LLM annotations on top of */
  /*                         a verdict row.                              */
  /*                                                                     */
  /* The deterministic judge (server/pipeline/diligenceJudge.ts) handles */
  /* the boolean gates. This table captures the stochastic dimensions —  */
  /* prose quality, citation coherence, source credibility,             */
  /* tier-appropriateness — via an LLM call.                            */
  /*                                                                     */
  /* Why a separate table (not a column on diligenceJudgeVerdicts):     */
  /*   - LLM runs are rerunnable; we keep history per verdict           */
  /*   - Prompt version / model version varies; dashboards need to      */
  /*     separate cohorts                                                */
  /*   - A parse failure should not taint the deterministic verdict     */
  /*                                                                     */
  /* HONEST_SCORES — scores are parsed directly from the model; on parse*/
  /*                 failure, status="parse_error" and scores stay null */
  /*                 rather than defaulting to 0.5.                      */
  /* HONEST_STATUS — status is a bounded enum:                          */
  /*   "pending" | "scored" | "parse_error" | "request_failed"          */
  /* ------------------------------------------------------------------ */
  diligenceLlmJudgeRuns: defineTable({
    verdictId: v.id("diligenceJudgeVerdicts"),
    telemetryId: v.id("diligenceRunTelemetry"),
    entitySlug: v.string(),
    blockType: v.string(),
    status: v.string(), // "pending" | "scored" | "parse_error" | "request_failed"
    /** Fingerprint of the exact prompt sent — lets replays detect prompt drift. */
    promptHash: v.string(),
    /** Prompt schema version (from JUDGE_PROMPT_VERSION). */
    promptVersion: v.string(),
    modelName: v.string(),
    /** Optional per-field scores (null until status="scored"). */
    proseQuality: v.optional(v.number()),
    citationCoherence: v.optional(v.number()),
    sourceCredibility: v.optional(v.number()),
    tierAppropriate: v.optional(v.number()),
    overallSemantic: v.optional(v.number()),
    /** JSON-encoded string[], BOUND at 5 items x 240 chars each. */
    strengthsJson: v.optional(v.string()),
    concernsJson: v.optional(v.string()),
    proposedNextStep: v.optional(v.string()),
    reason: v.optional(v.string()),
    /** Populated on request_failed OR parse_error. */
    errorMessage: v.optional(v.string()),
    /** Latency of the LLM call itself (ms). */
    latencyMs: v.number(),
    judgedAt: v.number(),
  })
    .index("by_verdict", ["verdictId"])
    .index("by_telemetry", ["telemetryId"])
    .index("by_entity", ["entitySlug"])
    .index("by_status", ["status"])
    .index("by_judged_at", ["judgedAt"]),

  /* ------------------------------------------------------------------ */
  /* publicShares — anonymous read-only shares of a diligence resource. */
  /*                                                                     */
  /* Unlike productEntityWorkspaceMembers (which requires auth + invite),*/
  /* a publicShare is a bearer token: anyone with the URL can read the   */
  /* resource. Used for sending an exec brief to an investor without     */
  /* asking them to sign up. The owner mints explicit shares; we never   */
  /* auto-publicize.                                                     */
  /*                                                                     */
  /* Invariants:                                                         */
  /*   BOUND — listMine capped; token is random 32-byte base64url        */
  /*   HONEST_STATUS — revoked tokens return { status: "revoked" }, not  */
  /*                   a 404 that would look like "never existed"        */
  /*   DETERMINISTIC — token is the dedupe key (primary lookup)          */
  /* ------------------------------------------------------------------ */
  publicShares: defineTable({
    token: v.string(),
    resourceType: v.string(), // "entity" (v1), future: "memo" | "founder_profile"
    resourceSlug: v.string(),
    ownerKey: v.string(),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    lastViewedAt: v.optional(v.number()),
    viewCount: v.number(),
    label: v.optional(v.string()),
  })
    .index("by_token", ["token"])
    .index("by_owner", ["ownerKey"])
    .index("by_resource", ["resourceType", "resourceSlug"]),

  /* ------------------------------------------------------------------ */
  /* pipelineDeadLetters — terminal failures grouped by fingerprint.    */
  /* Per .claude/rules/async_reliability.md §4.                          */
  /* ------------------------------------------------------------------ */
  pipelineDeadLetters: defineTable({
    fingerprint: v.string(),
    errorClass: v.string(),
    source: v.string(),
    messageStem: v.string(),
    firstSeen: v.number(),
    lastSeen: v.number(),
    occurrenceCount: v.number(),
    sampleEntitySlug: v.optional(v.string()),
    sampleScratchpadRunId: v.optional(v.string()),
    sampleErrorJson: v.optional(v.string()),
    status: v.string(), // "open" | "acknowledged" | "resolved"
    resolvedAt: v.optional(v.number()),
    resolvedNote: v.optional(v.string()),
  })
    .index("by_fingerprint", ["fingerprint"])
    .index("by_status", ["status"])
    .index("by_last_seen", ["lastSeen"]),

  /* ------------------------------------------------------------------ */
  /* pipelineRetries — scheduled long-horizon retry queue.               */
  /* Per .claude/rules/async_reliability.md §3 (+12h, +24h, +48h).       */
  /* ------------------------------------------------------------------ */
  pipelineRetries: defineTable({
    entitySlug: v.string(),
    blockType: v.string(),
    reason: v.string(),
    errorClass: v.string(),
    attempt: v.number(),
    firstAttemptAtMs: v.number(),
    nextAttemptAtMs: v.number(),
    status: v.string(), // "scheduled" | "in_flight" | "completed" | "canceled" | "dead_lettered"
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
  })
    .index("by_next_attempt", ["nextAttemptAtMs"])
    .index("by_entity", ["entitySlug"])
    .index("by_status_next", ["status", "nextAttemptAtMs"]),

  /* ------------------------------------------------------------------ */
  /* entityTopicFiles — layered_memory.md L2: per-entity per-topic       */
  /*                   accumulated facts.                                */
  /*                                                                     */
  /* One row per (entitySlug, topicName). Content is a JSON-serialized   */
  /* TopicFileContent (server/pipeline/topicCompaction.ts) — small and  */
  /* bounded so it fits cleanly in a Convex document. Write path is     */
  /* EXCLUSIVELY the compaction step (compactBlockTopic) — sub-agents   */
  /* never write here directly (layer-boundary invariant).              */
  /* ------------------------------------------------------------------ */
  entityTopicFiles: defineTable({
    entitySlug: v.string(),
    topicName: v.string(), // "founder" | "product" | "funding" | ...
    /** JSON-serialized TopicFileContent — see server/pipeline/topicCompaction.ts. */
    contentJson: v.string(),
    /** One-liner cached from TopicFileContent.oneLineSummary for index reads. */
    oneLineSummary: v.string(),
    factCount: v.number(),
    compactedAt: v.number(),
    /** Schema bump — mirrors topicCompaction.TOPIC_SCHEMA_VERSION. */
    schemaVersion: v.number(),
  })
    .index("by_entity_topic", ["entitySlug", "topicName"])
    .index("by_entity", ["entitySlug"])
    .index("by_compacted_at", ["compactedAt"]),

  /* ------------------------------------------------------------------ */
  /* entityMemoryIndex — layered_memory.md L1: per-entity aggregate      */
  /*                    one-liner index (MEMORY.md analog).              */
  /*                                                                     */
  /* One row per entity. Regenerable from entityTopicFiles — this is a  */
  /* CACHE, not a source of truth. Rebuilt by rebuildMemoryIndex after  */
  /* every successful compaction pass.                                   */
  /* ------------------------------------------------------------------ */
  entityMemoryIndex: defineTable({
    entitySlug: v.string(),
    /** JSON-encoded Array<{ topicName, oneLineSummary, factCount, compactedAt }>. */
    indexJson: v.string(),
    topicCount: v.number(),
    totalFactCount: v.number(),
    lastRebuildAt: v.number(),
  }).index("by_entity", ["entitySlug"]),

  /* ------------------------------------------------------------------ */
  /* extendedThinkingRuns — multi-checkpoint autonomous Claude runs.     */
  /* Chain of internalActions via ctx.scheduler.runAfter; each checkpoint*/
  /* survives the per-action wall-clock limit.                           */
  /* ------------------------------------------------------------------ */
  extendedThinkingRuns: defineTable({
    entitySlug: v.string(),
    ownerKey: v.string(),
    goal: v.string(),
    status: v.string(), // queued | running | waiting_checkpoint | completed | failed | canceled
    currentCheckpoint: v.number(),
    totalCheckpoints: v.number(),
    thinkingBudgetTokens: v.number(),
    thinkingTokensUsed: v.number(),
    modelName: v.string(),
    startedAt: v.number(),
    lastActivityAt: v.number(),
    completedAt: v.optional(v.number()),
    canceledAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    researchComplete: v.optional(v.boolean()),
  })
    .index("by_entity", ["entitySlug"])
    .index("by_owner", ["ownerKey"])
    .index("by_status", ["status"])
    .index("by_last_activity", ["lastActivityAt"]),

  extendedThinkingCheckpoints: defineTable({
    runId: v.id("extendedThinkingRuns"),
    index: v.number(),
    status: v.string(), // scored | parse_error | request_failed
    promptHash: v.string(),
    modelName: v.string(),
    headline: v.optional(v.string()),
    findingsJson: v.optional(v.string()),
    nextFocus: v.optional(v.string()),
    reasoning: v.optional(v.string()),
    researchComplete: v.optional(v.boolean()),
    focus: v.optional(v.string()),
    latencyMs: v.number(),
    thinkingTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    judgedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_index", ["runId", "index"])
    .index("by_status", ["status"])
    .index("by_judged_at", ["judgedAt"]),

  hyperloopVariants,
  hyperloopEvaluationRuns,
  hyperloopPromotions,

  /* ------------------------------------------------------------------ */
  /* agentActions — unified audit log of every structured agent action. */
  /*                                                                    */
  /* One table for all three surfaces (inline notebook decorations,     */
  /* side-panel drawer, chat page). Any action the user takes via the   */
  /* agent — accepting a suggestion, dismissing a decoration, sending   */
  /* a message — lands here as a single row with `surfaceOrigin` set.   */
  /* This is the glue that lets the drawer show "earlier today I        */
  /* accepted a founder tier on Acme" even though the accept happened   */
  /* inline in the notebook.                                            */
  /*                                                                    */
  /* Pattern: Anthropic trace events + NodeBench surfaceOrigin tag.     */
  /* See docs/architecture/AGENT_INFRA_COHESION.md (to be authored).    */
  /* ------------------------------------------------------------------ */
  agentActions: defineTable({
    ownerKey: v.string(),
    userId: v.optional(v.id("users")),
    surfaceOrigin: v.union(
      v.literal("inline"),
      v.literal("drawer"),
      v.literal("chat"),
    ),
    // Linking — nullable because not every action ties to every concept.
    threadId: v.optional(v.string()),
    entitySlug: v.optional(v.string()),
    blockId: v.optional(v.string()),
    scratchpadRunId: v.optional(v.string()),
    // Action shape — bounded enum (HONEST_STATUS).
    kind: v.union(
      v.literal("decoration_accepted"),
      v.literal("decoration_dismissed"),
      v.literal("decoration_refreshed"),
      v.literal("decoration_asked_about"),
      v.literal("block_added"),
      v.literal("block_edited"),
      v.literal("message_sent"),
    ),
    summary: v.string(),
    payload: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerKey"])
    .index("by_owner_time", ["ownerKey", "createdAt"])
    .index("by_thread", ["threadId"])
    .index("by_entity", ["entitySlug"])
    .index("by_entity_time", ["entitySlug", "createdAt"]),

  /* ------------------------------------------------------------------ */
  /* agentThreads — canonical thread metadata across all three         */
  /* surfaces (inline | drawer | chat). Legacy tables                  */
  /* (chatThreadsStream, productChatSessions) continue to exist and    */
  /* receive dual-writes during migration; read path cuts over once    */
  /* backfill completes.                                                */
  /*                                                                    */
  /* Pattern: Cockroach "shadow cluster" migration + canonical-keyed    */
  /* threadId strings (UUID) so the same row can be referenced from    */
  /* legacy tables via `legacyMessageId`.                              */
  /* ------------------------------------------------------------------ */
  agentThreads: defineTable({
    ownerKey: v.string(),
    userId: v.optional(v.id("users")),
    threadId: v.string(), // app-generated UUID, stable across dual-write
    title: v.string(),
    surfaceOrigin: v.union(
      v.literal("inline"),
      v.literal("drawer"),
      v.literal("chat"),
    ),
    entitySlug: v.optional(v.string()),
    seedContext: v.optional(v.any()),
    status: v.union(
      v.literal("active"),
      v.literal("archived"),
      v.literal("deleted"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessageAt: v.number(),
    messageCount: v.number(),
  })
    .index("by_owner_thread", ["ownerKey", "threadId"])
    .index("by_owner_last_message", ["ownerKey", "lastMessageAt"])
    .index("by_entity", ["entitySlug"]),

  /* ------------------------------------------------------------------ */
  /* agentMessages — canonical per-turn log across surfaces. One row   */
  /* per turn regardless of origin. Legacy id back-pointer              */
  /* (`legacyMessageId` + `legacyTableHint`) lets us reconcile during   */
  /* migration.                                                         */
  /* ------------------------------------------------------------------ */
  agentMessages: defineTable({
    ownerKey: v.string(),
    userId: v.optional(v.id("users")),
    threadId: v.string(),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
    ),
    content: v.string(), // capped at ~64KB in appendMessage mutation
    surfaceOrigin: v.union(
      v.literal("inline"),
      v.literal("drawer"),
      v.literal("chat"),
    ),
    legacyMessageId: v.optional(v.string()),
    legacyTableHint: v.optional(v.string()),
    tokensUsed: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
    model: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_thread_time", ["threadId", "createdAt"])
    .index("by_owner_time", ["ownerKey", "createdAt"])
    .index("by_legacy", ["legacyMessageId"]),

  /* ------------------------------------------------------------------ */
  /* pulseReports — daily-regenerated notebook pages per entity.        */
  /*                                                                    */
  /* The Pulse surface: "what changed since yesterday" on any entity    */
  /* the user is tracking. Each row is a scheduled-or-manual regen of   */
  /* a lightweight markdown payload that renders as a notebook page at  */
  /* /entity/<slug>/pulse (today) or /entity/<slug>/pulse/<dateKey>.    */
  /*                                                                    */
  /* Pattern: Granola per-meeting notes + Arc Max daily digest + the    */
  /* Superhuman morning digest — adapted to per-entity scope. No new    */
  /* editor substrate; pulse is just a productBlocks namespace tag in   */
  /* V2. For V1 we store the summary markdown inline so the page can    */
  /* render even before full productBlocks writing lands.               */
  /*                                                                    */
  /* Invariants: one row per (ownerKey, entitySlug, dateKey). The       */
  /* (entitySlug, dateKey) index supports daily-cron reads across all   */
  /* owners. BOUND: summary capped at ~32KB in the mutation.            */
  /* ------------------------------------------------------------------ */
  pulseReports: defineTable({
    ownerKey: v.string(),
    userId: v.optional(v.id("users")),
    entitySlug: v.string(),
    dateKey: v.string(), // "YYYY-MM-DD" — the pulse's day of record
    status: v.union(
      v.literal("generating"),
      v.literal("ready"),
      v.literal("failed"),
    ),
    summaryMarkdown: v.optional(v.string()),
    changeCount: v.number(),
    materialChangeCount: v.number(),
    generatedAt: v.number(),
    readAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_owner_date", ["ownerKey", "dateKey"])
    .index("by_owner_entity_date", ["ownerKey", "entitySlug", "dateKey"])
    .index("by_entity_date", ["entitySlug", "dateKey"])
    .index("by_unread", ["ownerKey", "readAt"]),

  /* ------------------------------------------------------------------ */
  /* dismissedDecorations — persistent per-user dismissal of inline     */
  /* agent suggestions. Before this table, dismissals were client-only  */
  /* React state, lost on refresh. That violated user trust: dismissing */
  /* something should *stay* dismissed.                                 */
  /* ------------------------------------------------------------------ */
  dismissedDecorations: defineTable({
    ownerKey: v.string(),
    userId: v.optional(v.id("users")),
    entitySlug: v.string(),
    scratchpadRunId: v.string(),
    blockType: v.string(),
    dismissedAt: v.number(),
    reason: v.optional(v.string()),
  })
    .index("by_owner", ["ownerKey"])
    .index("by_owner_entity", ["ownerKey", "entitySlug"])
    .index("by_owner_run", ["ownerKey", "scratchpadRunId"]),

  /* =================================================================
   * CANONICAL ENTITY GRAPH DELTA (v1: company_dossier lens)
   * =================================================================
   * Reuses the existing intelligence layer as the canonical node
   * substrate (intelligenceEntities + entityAliases + peopleProfiles
   * + investorProfiles). Adds only what it does NOT model:
   *
   *   - entityRoles:    contextual role (A is investor relative to B)
   *   - edges:          typed, confidence-scored relationships
   *   - claims:         S-P-O / literal facts with polarity
   *   - claimEvidence:  page-indexed evidence with source tier
   *   - entityScores:   influence / recency / centrality metrics
   *
   * Complements knowledgeGraphs/graphClaims (SPO-string clustering)
   * without replacing it.
   *
   * Write path (scratchpad_first rule): sub-agents never write these
   * tables directly. `hydrateEntities` in the research orchestrator
   * is the single compaction-first writer.
   * ================================================================= */
  entityRoles: defineTable({
    entityId: v.id("intelligenceEntities"),
    role: v.union(
      v.literal("investor"),
      v.literal("customer"),
      v.literal("partner"),
      v.literal("speaker"),
      v.literal("sponsor"),
      v.literal("acquirer"),
      v.literal("portfolio_company"),
      v.literal("advisor"),
    ),
    contextEntityId: v.optional(v.id("intelligenceEntities")),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    confidence: v.number(),
    sourceRefs: v.array(v.string()),
  })
    .index("by_entity", ["entityId"])
    .index("by_entity_role", ["entityId", "role"])
    .index("by_context", ["contextEntityId"]),

  edges: defineTable({
    fromId: v.id("intelligenceEntities"),
    toId: v.id("intelligenceEntities"),
    relationFamily: v.string(),
    relationType: v.string(),
    confidence: v.number(),
    weight: v.optional(v.number()),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    metadata: v.optional(v.any()),
    sourceRefs: v.array(v.string()),
  })
    .index("by_from_rel", ["fromId", "relationType"])
    .index("by_to_rel", ["toId", "relationType"])
    .index("by_from_family", ["fromId", "relationFamily"])
    .index("by_to_family", ["toId", "relationFamily"]),

  claims: defineTable({
    subjectEntityId: v.id("intelligenceEntities"),
    predicate: v.string(),
    objectEntityId: v.optional(v.id("intelligenceEntities")),
    literalValue: v.optional(v.string()),
    polarity: v.union(
      v.literal("supports"),
      v.literal("contradicts"),
      v.literal("neutral"),
    ),
    confidence: v.number(),
    extractedAt: v.number(),
  })
    .index("by_subject", ["subjectEntityId"])
    .index("by_subject_pred", ["subjectEntityId", "predicate"])
    .index("by_object", ["objectEntityId"]),

  claimEvidence: defineTable({
    claimId: v.id("claims"),
    artifactEntityId: v.optional(v.id("intelligenceEntities")),
    chunkRef: v.optional(v.string()),
    pageNumber: v.optional(v.number()),
    sourceTier: v.union(
      v.literal("T1"),
      v.literal("T2"),
      v.literal("T3"),
      v.literal("USER"),
      v.literal("INTERNAL"),
    ),
    evidenceWeight: v.number(),
    quoteHash: v.optional(v.string()),
    url: v.optional(v.string()),
  })
    .index("by_claim", ["claimId"])
    .index("by_artifact", ["artifactEntityId"]),

  entityScores: defineTable({
    entityId: v.id("intelligenceEntities"),
    scoreType: v.union(
      v.literal("influence"),
      v.literal("recency"),
      v.literal("citation_density"),
      v.literal("event_centrality"),
      v.literal("market_centrality"),
    ),
    windowDays: v.optional(v.number()),
    value: v.number(),
    metadata: v.optional(v.any()),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_entity_type", ["entityId", "scoreType"])
    .index("by_type_updated", ["scoreType", "updatedAt"]),

  // ──────────────────────────────────────────────────────────────────────
  // Autonomous Continuation System — Subsystem A: Time-Travel + Learning
  // Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116)
  // A-PR-A.1: snapshot + lesson schema (this PR)
  // A-PR-A.2: snapshotCheckpoint pre-hook mutation (next)
  // A-PR-A.3: rollbackToCheckpoint agent action
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Auto-captured snapshots taken before every destructive agent tool call.
   * Used by `/rollback` to restore artifact state to a prior turn.
   * sha-deduped: identical content for the same (threadId, artifactId) reuses
   * the existing row instead of creating a new one.
   * Bounded: hard cap of 100 snapshots per thread (oldest evicted first).
   */
  agentSnapshots: defineTable({
    /** Convex agent thread that owns this snapshot. */
    threadId: v.string(),
    /** Monotonic turn counter within the thread. */
    turnId: v.number(),
    /** Tool that was about to mutate (informational; pre-hook fires before call). */
    toolName: v.string(),
    /** Artifact category — `notebook`, `entity`, `report`, `claim`, etc. */
    artifactType: v.string(),
    /** Stable identifier of the artifact being snapshotted. */
    artifactId: v.string(),
    /** sha256 of the serialized content for dedup. */
    contentSha256: v.string(),
    /** Serialized JSON of the pre-mutation artifact state. */
    content: v.string(),
    /** Previous turn that this snapshot extends (for chain visualization). */
    parentTurnId: v.optional(v.number()),
    /** Wall-clock when the snapshot was captured (ms). */
    createdAt: v.number(),
  })
    .index("by_thread_turn", ["threadId", "turnId"])
    .index("by_thread_artifact", ["threadId", "artifactType", "artifactId"])
    .index("by_thread_sha", ["threadId", "contentSha256"]),

  /**
   * Per-user budget caps for agent requests. One row per `ownerKey`.
   * The budget gate (`convex/domains/agents/budget/budgetGate.ts`)
   * looks up this row before each routed request, resets daily counters
   * when wall-clock crosses `resetAt`, and rejects requests that would
   * exceed `dailyTokenCap` or `dailyCostCapUsd`.
   *
   * v1: per-user caps only. Per-thread caps deferred to v2.
   * Plan: docs/agents/AUTONOMOUS_CONTINUATION_PLAN.md (PR #116) — B-PR6.
   */
  userBudgets: defineTable({
    /** Owner identity. Anonymous sessions reuse the same key shape. */
    ownerKey: v.string(),
    /** Daily token cap (input + output). 0 = no cap. */
    dailyTokenCap: v.number(),
    /** Daily USD cap. 0 = no cap. */
    dailyCostCapUsd: v.number(),
    /** Consumed today (resets at `resetAt`). */
    consumedTokensToday: v.number(),
    consumedCostUsdToday: v.number(),
    /** Wall-clock when daily counters reset. */
    resetAt: v.number(),
    /** Whether the user opted in to budget enforcement. Default true. */
    enforced: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerKey"]),

  /**
   * Lessons captured from rollbacks and infrastructure failures.
   * Top-K relevant lessons are injected verbatim into the next agent turn's
   * system prompt so the agent literally cannot repeat the same mistake
   * without the lesson being explicitly deleted or marked deprecated.
   * Per-thread isolation in v1; cross-thread guardrails deferred to v2.
   */
  agentLessons: defineTable({
    /** Thread the lesson is scoped to. */
    threadId: v.string(),
    /** Turn that triggered capture. */
    turnId: v.number(),
    /** Lesson category — drives which fields are populated. */
    type: v.union(
      v.literal("semantic"),       // agent broke an artifact
      v.literal("infrastructure"), // model failover / rate-limit
      v.literal("budget"),         // hit cost cap
      v.literal("spiral"),         // 3+ same-signature turns with no progress
    ),

    // ── Semantic lesson fields ──────────────────────────────────────────
    /** Tool name that produced the failure (e.g. `patch_notebook`). */
    toolName: v.optional(v.string()),
    /** What the agent did wrong. Surfaced verbatim in injection. */
    mistakePattern: v.optional(v.string()),
    /** What it should do next time. Surfaced verbatim in injection. */
    correctPattern: v.optional(v.string()),
    /** Artifact that was affected. */
    artifactType: v.optional(v.string()),

    // ── Infrastructure lesson fields ────────────────────────────────────
    /** Model that failed. */
    fromModel: v.optional(v.string()),
    /** Model that succeeded as fallback. */
    toModel: v.optional(v.string()),
    /** HTTP status or error symbol that triggered failover. */
    failedWith: v.optional(v.union(v.number(), v.string())),
    /** Whether the fallback succeeded — true entries upgrade priority. */
    succeeded: v.optional(v.boolean()),
    /** Number of times this fromModel→toModel pair has been observed. */
    count: v.optional(v.number()),

    // ── Budget lesson fields ────────────────────────────────────────────
    /** Task category that hit the budget cap (informs future estimates). */
    taskCategory: v.optional(v.string()),
    /** Estimated tokens remaining when the cap fired. */
    estimatedTokensRemaining: v.optional(v.number()),

    // ── Lifecycle ───────────────────────────────────────────────────────
    /** Wall-clock of capture (ms). */
    capturedAt: v.number(),
    /** Auto-prune after N more turns of inactivity. Null = never. */
    expiresAfterTurns: v.optional(v.number()),
    /** Pinned lessons never expire and bypass the per-turn injection cap. */
    pinned: v.boolean(),
    /** Deprecated lessons are skipped during injection but kept for audit. */
    deprecated: v.boolean(),
    /** Optional user-supplied sentence from the post-rollback toast. */
    userNote: v.optional(v.string()),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_type", ["threadId", "type"])
    .index("by_thread_tool", ["threadId", "toolName"]),

  // ─── Redesign Sprint S5 — Style profile + agent patches + inbox actions ───

  /** Operator analyst style manifest — drives how every report and chat reads.
   *  Inferred from sample memos via scripts/qa/inferStyle.ts. One active row per user. */
  styleProfiles: defineTable({
    userId: v.id("users"),
    label: v.string(),
    slug: v.string(),
    voice: v.string(),
    sectionOrder: v.array(v.string()),
    recommendationPhrasings: v.array(v.string()),
    riskLens: v.array(v.string()),
    sourcePreferences: v.array(v.string()),
    sentenceRhythm: v.string(),
    confidence: v.number(),
    patternsFound: v.number(),
    provenance: v.array(v.object({
      label: v.string(),
      chars: v.number(),
      weightPct: v.number(),
    })),
    modelUsed: v.string(),
    inferredAt: v.number(),
    isActive: v.boolean(),
  })
    .index("by_user_active", ["userId", "isActive"])
    .index("by_user_inferred", ["userId", "inferredAt"]),

  /** Redesign Sprint S5 — bidirectional contract for chat / agent → document edits
   *  in the redesign route. Distinct from the legacy `documentPatches` table (line 4816)
   *  which tracks patch-operations history. Replaces the in-memory pendingPatches queue
   *  in ReportNotebookView. */
  redesignDocumentPatches: defineTable({
    documentId: v.id("documents"),
    userId: v.id("users"),
    source: v.union(v.literal("chat"), v.literal("agent")),
    pipelineRunId: v.optional(v.id("pipelineRuns")),
    batchAutopilotRunId: v.optional(v.id("batchAutopilotRuns")),
    label: v.string(),
    preview: v.string(),
    html: v.string(),
    status: v.string(),
    proposedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    acceptedHtml: v.optional(v.string()),
  })
    .index("by_document_status", ["documentId", "status"])
    .index("by_user_status", ["userId", "status"])
    .index("by_pipelineRun", ["pipelineRunId"]),

  /** Reports universes — saved entity collections. */
  redesignUniverses: defineTable({
    userId: v.id("users"),
    name: v.string(),
    slug: v.string(),
    styleId: v.optional(v.id("styleProfiles")),
    rubric: v.string(),
    monitoring: v.boolean(),
    monitoringMinutes: v.optional(v.number()),
    entityIds: v.array(v.string()),
    entityCount: v.number(),
    refreshedAt: v.number(),
  })
    .index("by_user_monitoring", ["userId", "monitoring"]),

  /**
   * Phase 1 of production-fidelity chat — every real chat run is persisted
   * by reproducibility hash so the Sprint 4 P2.13 share URL
   * (/redesign/chat/r/{hash}) can serve the immutable answer back to anyone
   * with the link. Same packet → same hash → same URL across deploys.
   *
   * runId is unique per run; hash is unique per {prompt, tier, model,
   * shortAnswer, sortedEvidenceUrls} combination — same input → same cached
   * run, idempotent re-runs collapse onto the same row.
   */
  redesignChatRuns: defineTable({
    runId: v.string(),
    hash: v.optional(v.string()),
    userId: v.optional(v.id("users")),
    prompt: v.string(),
    tier: v.string(),
    model: v.string(),
    /**
     * Phase 2 lifecycle:
     *   "pending"  — scheduled, not yet picked up by internal action
     *   "running"  — events flowing
     *   "complete" — final packet bound; hash computed
     *   "error"    — failed (errorMessage populated)
     */
    status: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    /** Final AnswerPacket — populated when status === "complete". */
    packet: v.optional(v.any()),
    totalLatencyMs: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_runId", ["runId"])
    .index("by_hash", ["hash"])
    .index("by_user_created", ["userId", "createdAt"]),

  /**
   * Phase 2 streaming event log. Frontend useQuery subscribes by runId
   * and gets reactive updates as each event lands — Convex's native
   * streaming pattern (no HTTP SSE plumbing required).
   *
   * Event types:
   *   "stage"           — classify / context / synthesis / bind orchestrator stages
   *   "scratchpad"      — agent's working notes (streamed prose chunks)
   *   "tool_call"       — tool fired with detail + status + duration
   *   "grounding_chunk" — a single grounded source URL + title arrived
   *   "section"         — a structured AnswerPacket section committed
   *   "packet_complete" — final assembly; full packet now in redesignChatRuns
   *   "error"           — terminal failure
   */
  redesignChatStreamEvents: defineTable({
    runId: v.string(),
    /** Monotonic sequence number per runId, for ordering. */
    idx: v.number(),
    eventType: v.string(),
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_run_idx", ["runId", "idx"]),

  /** Inbox snooze records — soft-hide an inbox item until a future timestamp. */
  inboxSnoozes: defineTable({
    userId: v.id("users"),
    itemId: v.string(),
    itemSource: v.string(),
    snoozeUntil: v.number(),
    snoozedAt: v.number(),
    note: v.optional(v.string()),
  })
    .index("by_user_until", ["userId", "snoozeUntil"])
    .index("by_user_item", ["userId", "itemId"]),

  /** Per-message agent reaction feedback — feeds the eval flywheel. */
  agentRunFeedback: defineTable({
    userId: v.id("users"),
    runId: v.string(),
    runSource: v.string(),
    turnId: v.optional(v.string()),
    reaction: v.union(v.literal("up"), v.literal("down")),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_run", ["runId"]),

  /* ------------------------------------------------------------------ */
  /* PHASE 9a — Editorial-edition TTS audio cache                       */
  /* ------------------------------------------------------------------ */

  /**
   * Cache entries for the editorial home's "Listen" button.  Idempotency
   * by `cacheKey = ${dateKey}|${voiceId}` so swapping voices regenerates
   * cleanly and same-day clicks are free.
   *
   * Bound: tiny — one row per (dateKey, voiceId) pair.  Old days remain
   * playable until manual eviction.  Cost: ~$0.30 per generation
   * (ElevenLabs eleven_turbo_v2_5 priced ~$0.30/1K chars; cap is 2K
   * chars/script per editionTts.ts MAX_SCRIPT_CHARS).
   *
   * See convex/domains/integrations/voice/editionTts.ts.
   */
  editionAudioCache: defineTable({
    cacheKey: v.string(),                    // ${dateKey}|${voiceId}
    dateKey: v.string(),                     // YYYY-MM-DD
    voiceId: v.string(),                     // ElevenLabs voice id
    storageId: v.id("_storage"),             // mp3 blob in Convex storage
    generatedAt: v.number(),                 // ms epoch
    charCount: v.number(),                   // length of script that was synthesized
  })
    .index("by_cache_key", ["cacheKey"])
    .index("by_date_key", ["dateKey"]),

  /* ------------------------------------------------------------------ */
  /* PHASE 10b — Video lite-embed oEmbed metadata cache                 */
  /* ------------------------------------------------------------------ */

  /**
   * Cached oEmbed metadata for video URLs (YouTube/Vimeo/Twitch/Loom)
   * that appear inside editorial sections (§1 What moved, §3 Forecasts,
   * §6 Footnotes).  Exists so the editorial home can render thumbnail
   * cards instead of bare links without hammering oEmbed providers on
   * every page render.
   *
   * Cache key is sha256(url) — DETERMINISTIC.  TTL is 7 days
   * (`fetchedAt + 7d`) per the spec; lookup callers MUST check
   * `ttlExpiresAt` and treat expired rows as cache misses.
   *
   * HONEST_STATUS: failed fetches are persisted with an `errorMessage`
   * and null thumbnail/title so the read path returns a well-typed
   * "tried, failed" answer instead of silently re-querying every load.
   *
   * BOUND: one row per distinct video URL.  Worst case is 10s of
   * thousands of rows, all tiny (~512 B) — acceptable for the
   * editorial use-case.  No background eviction yet; the schema is
   * append-only with TTL-aware reads.
   *
   * Bound + SSRF defense lives in the writer
   * (convex/domains/integrations/video/oembedFetcher.ts) — schema
   * itself is just a key/value store.
   */
  videoOembedCache: defineTable({
    urlHash: v.string(),                     // sha256(url) hex — stable cache key
    url: v.string(),                         // raw URL the user/editorial referenced
    provider: v.union(
      v.literal("youtube"),
      v.literal("vimeo"),
      v.literal("twitch"),
      v.literal("loom"),
    ),
    thumbnailUrl: v.optional(v.string()),    // remote https thumbnail (CDN)
    title: v.optional(v.string()),           // oEmbed title
    author: v.optional(v.string()),          // oEmbed author_name
    durationSec: v.optional(v.number()),     // optional duration if provider returns it
    embedUrl: v.string(),                    // privacy-friendly embed URL (lazy-loaded on click)
    fetchedAt: v.number(),                   // ms epoch when row was last refreshed
    ttlExpiresAt: v.number(),                // fetchedAt + 7d — read path treats older rows as misses
    errorMessage: v.optional(v.string()),    // populated when oEmbed fetch failed (null thumbnail/title)
  })
    .index("by_url_hash", ["urlHash"])
    .index("by_ttl", ["ttlExpiresAt"]),

  /* ------------------------------------------------------------------ */
  /* PHASE 12 — Federated search response cache (anonymous hot queries) */
  /* ------------------------------------------------------------------ */

  /**
   * Server-side response cache for `federatedSearch`.  Anonymous-only
   * by construction.  See convex/domains/search/federatedSearchCache.ts
   * for full module docs (privacy invariant + 8-point reliability).
   *
   * BOUND:           response capped at MAX_CACHED_RESPONSE_BYTES (32 KB).
   * HONEST_STATUS:   miss returns null; cache failures fall through.
   * DETERMINISTIC:   key = cyrb53(sorted(q + collections + limit)).
   * BOUND_READ:      single-doc lookup by indexed key.
   */
  federatedSearchCache: defineTable({
    cacheKey: v.string(),                    // cyrb53(sorted(q + collections + limit))
    queryNormalized: v.string(),             // lowercased trimmed q (debug aid)
    collections: v.array(v.string()),        // requested collection names (sorted)
    limit: v.number(),                       // limit used
    response: v.string(),                    // JSON.stringify(FederatedSearchResponse)
    responseBytes: v.number(),               // utf8 length of `response` (BOUND audit)
    generatedAt: v.number(),                 // ms epoch when row was written
    ttlExpiresAt: v.number(),                // generatedAt + FEDERATED_CACHE_TTL_MS
    hitCount: v.number(),                    // monotonic counter (cache analytics)
  })
    .index("by_cache_key", ["cacheKey"])
    .index("by_ttl", ["ttlExpiresAt"]),

  /* ------------------------------------------------------------------ */
  /* EXPANDABLE GRAPH NOTEBOOK — Roam-style mention expansion            */
  /* ------------------------------------------------------------------ */

  /**
   * Tracks each mention expansion run: user clicks [⊕ Expand] on a mention
   * chip, which queues a Linkup search + Gemini extraction pipeline.
   *
   * Pattern: async_reliability — idempotency key, bounded retries, honest status.
   * Prior art: Roam Research bidirectional backlinks + block references
   *
   * BOUND:          max 5 search queries per run, 50 claims per patch
   * HONEST_STATUS:  never "completed" if any branch failed → "partial"
   * TIMEOUT:        60s AbortController on the action
   * DETERMINISTIC:  runId = sha256(entityId + userId + timestamp)
   */
  expansionRuns: defineTable({
    // Identity
    runId: v.string(),
    userId: v.string(),

    // Target
    targetEntityId: v.id("entityProfiles"),
    targetBlockId: v.optional(v.string()),
    targetDocumentId: v.optional(v.id("documents")),

    // Execution state machine: queued → searching → extracting → persisting → completed|partial|failed
    status: v.union(
      v.literal("queued"),
      v.literal("searching"),
      v.literal("extracting"),
      v.literal("persisting"),
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),

    // Results (honest counts — reflect actual persisted data)
    claimsCreated: v.number(),
    edgesCreated: v.number(),
    sourcesFound: v.number(),

    // Budget tracking
    searchQueries: v.number(),
    maxSearchQueries: v.number(),
    wallClockMs: v.optional(v.number()),

    // Error handling
    errorMessage: v.optional(v.string()),
    retryCount: v.number(),

    // Timestamps
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_entity", ["targetEntityId"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_status", ["status"])
    .index("by_runId", ["runId"]),

  /**
   * Bidirectional cross-references between entities/blocks/documents.
   * Created automatically when a mention is inserted, or when an expansion
   * agent discovers a relationship.
   *
   * Prior art: Roam Research bidirectional backlinks, Obsidian backlinks panel,
   * Roam Research / Obsidian backlink extraction.
   *
   * BOUND_READ:     max 50 backlinks returned per query (paginated)
   * DETERMINISTIC:  dedup by (sourceType, sourceId, targetEntityId, backlinkType)
   */
  backlinks: defineTable({
    // Source (who references)
    sourceType: v.union(
      v.literal("block"),
      v.literal("claim"),
      v.literal("document"),
      v.literal("signal"),
      v.literal("action"),
    ),
    sourceId: v.string(),
    sourceDocumentId: v.optional(v.string()),
    sourceContext: v.optional(v.string()),

    // Target (who is referenced)
    targetEntityId: v.id("entityProfiles"),

    // Relationship metadata
    backlinkType: v.union(
      v.literal("mention"),
      v.literal("citation"),
      v.literal("relatedTo"),
      v.literal("causes"),
      v.literal("contradicts"),
      v.literal("supports"),
      v.literal("derived"),
    ),
    confidence: v.optional(v.number()),

    // Provenance
    createdBy: v.union(
      v.literal("user"),
      v.literal("agent"),
      v.literal("system"),
    ),
    agentRunId: v.optional(v.string()),

    createdAt: v.number(),
  })
    .index("by_target", ["targetEntityId", "backlinkType"])
    .index("by_source", ["sourceType", "sourceId"])
    .index("by_document", ["sourceDocumentId"])
    .index("by_agent_run", ["agentRunId"]),

  /**
   * Cached expanded content for each entity. Prevents re-expansion on every
   * hover and enables instant preview. Refreshed on each successful expansion.
   *
   * BOUND:  keyFacts max 10, recentClaims max 20
   * TTL:    staleAfterMs default 86400000 (24h) — re-expansion needed after
   */
  expansionSnapshots: defineTable({
    entityId: v.id("entityProfiles"),

    // Cached content
    summary: v.string(),
    keyFacts: v.array(v.string()),
    recentClaims: v.array(v.object({
      claimText: v.string(),
      predicate: v.string(),
      confidence: v.boolean(),
      sourceUrl: v.optional(v.string()),
    })),
    backlinkCount: v.number(),
    lastExpanded: v.number(),

    // Staleness detection
    version: v.number(),
    staleAfterMs: v.number(),
  })
    .index("by_entity", ["entityId"]),
});
