// convex/domains/operations/privacyEnforcement.ts
// Privacy & Retention Policy Enforcement
//
// Implements GDPR storage limitation + right to deletion.
// Enforces data-class-based retention with automated deletion.
//
// ============================================================================
// WHY PRIVACY ENFORCEMENT MATTERS
// ============================================================================
//
// 1. GDPR STORAGE LIMITATION (Article 5(1)(e))
//    - Personal data kept no longer than necessary for purpose
//    - Must define and enforce retention periods
//    - Automated deletion required (not just "policy")
//
// 2. RIGHT TO DELETION (Article 17)
//    - Users can request deletion of their data
//    - Must be honored within 30 days
//    - Requires tombstone + audit trail
//
// 3. DATA MINIMIZATION (Article 5(1)(c))
//    - Collect only necessary data
//    - Store hashes/pointers where possible
//    - Field-level minimization
//
// 4. PURPOSE LIMITATION (Article 5(1)(b))
//    - Data used only for stated purpose
//    - Access controls by purpose
//
// ============================================================================
// DATA CLASSES & RETENTION
// ============================================================================
//
// Raw Media (photos/audio/video):      7-30 days (shortest)
// Derived Text (transcripts/summaries): 90-365 days
// Operational Logs:                     30-90 days + aggregation
// Audit Logs:                           7 years (compliance)
// Ground Truth Labels:                  Indefinite (with consent)
//
// ============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation, mutation, query } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* DATA CLASS DEFINITIONS                                              */
/* ------------------------------------------------------------------ */

export type DataClass =
  | "raw_media"              // Photos, audio, video
  | "derived_text"           // Transcripts, summaries, extractions
  | "operational_logs"       // Inconclusive events, performance metrics
  | "audit_logs"             // Compliance, security, validation logs
  | "ground_truth_labels"    // Human labels for calibration
  | "financial_fundamentals" // XBRL data, SEC filings
  | "model_outputs";         // DCF models, evaluations, repro packs

export interface RetentionPolicy {
  dataClass: DataClass;

  /** TTL in days */
  retentionDays: number;

  /** What happens after TTL */
  action: "delete" | "aggregate" | "archive";

  /** Whether this requires user consent to extend */
  requiresConsent: boolean;

  /** Legal basis for retention */
  legalBasis: "consent" | "contract" | "legal_obligation" | "legitimate_interest";

  /** Purpose limitation */
  allowedPurposes: string[];
}

/* ------------------------------------------------------------------ */
/* RETENTION POLICIES                                                  */
/* ------------------------------------------------------------------ */

export const RETENTION_POLICIES: Record<DataClass, RetentionPolicy> = {
  raw_media: {
    dataClass: "raw_media",
    retentionDays: 30,
    action: "delete",
    requiresConsent: true,
    legalBasis: "consent",
    allowedPurposes: ["verification", "evidence_collection"],
  },

  derived_text: {
    dataClass: "derived_text",
    retentionDays: 365,
    action: "delete",
    requiresConsent: false,
    legalBasis: "legitimate_interest",
    allowedPurposes: ["verification", "model_training", "analytics"],
  },

  operational_logs: {
    dataClass: "operational_logs",
    retentionDays: 90,
    action: "aggregate",  // Keep aggregated metrics, delete raw logs
    requiresConsent: false,
    legalBasis: "legitimate_interest",
    allowedPurposes: ["operations", "reliability", "slo_monitoring"],
  },

  audit_logs: {
    dataClass: "audit_logs",
    retentionDays: 2555,  // 7 years (compliance requirement)
    action: "archive",
    requiresConsent: false,
    legalBasis: "legal_obligation",
    allowedPurposes: ["compliance", "audit", "security"],
  },

  ground_truth_labels: {
    dataClass: "ground_truth_labels",
    retentionDays: -1,  // Indefinite (with consent)
    action: "delete",   // Only on explicit user request
    requiresConsent: true,
    legalBasis: "consent",
    allowedPurposes: ["model_training", "calibration", "evaluation"],
  },

  financial_fundamentals: {
    dataClass: "financial_fundamentals",
    retentionDays: 1825,  // 5 years (financial data retention)
    action: "archive",
    requiresConsent: false,
    legalBasis: "legitimate_interest",
    allowedPurposes: ["financial_analysis", "model_training", "compliance"],
  },

  model_outputs: {
    dataClass: "model_outputs",
    retentionDays: 730,  // 2 years
    action: "archive",
    requiresConsent: false,
    legalBasis: "legitimate_interest",
    allowedPurposes: ["evaluation", "audit", "model_validation"],
  },
};

/* ------------------------------------------------------------------ */
/* TABLE-TO-DATA-CLASS MAPPING                                         */
/* ------------------------------------------------------------------ */

export const TABLE_DATA_CLASS_MAP: Record<string, DataClass> = {
  // Operational logs
  inconclusiveEventLog: "operational_logs",
  sourceQualityLog: "operational_logs",
  sloMeasurements: "operational_logs",
  modelPerformanceMetrics: "operational_logs",
  retentionAggregations: "operational_logs",

  // Audit logs
  alertHistory: "audit_logs",
  restatementDecisionLog: "audit_logs",
  validationReports: "audit_logs",
  calibrationDeployments: "audit_logs",
  groundTruthAuditLog: "audit_logs",
  deletionRequests: "audit_logs",
  deletionTombstones: "audit_logs",
  archivedRecords: "audit_logs",
  narrativeSearchLog: "audit_logs",

  // Ground truth
  groundTruthVersions: "ground_truth_labels",

  // Financial data
  financialFundamentals: "financial_fundamentals",
  groundTruthFinancials: "financial_fundamentals",
  sourceArtifacts: "derived_text",
  evidenceArtifacts: "audit_logs",

  // Model outputs
  dcfModels: "model_outputs",
  financialModelEvaluations: "model_outputs",
  modelReproPacks: "model_outputs",
  narrativeThreads: "model_outputs",
  narrativeEvents: "model_outputs",
  narrativePosts: "model_outputs",
  narrativeReplies: "model_outputs",
  temporalFacts: "model_outputs",
  narrativeDisputeChains: "model_outputs",
  narrativeCorrelations: "model_outputs",
};

type TtlTableConfig = {
  timestampField: string;
  index?: string;
};

const TTL_TABLE_CONFIG: Record<string, TtlTableConfig> = {
  inconclusiveEventLog: { timestampField: "occurredAt", index: "by_occurred_at" },
  sourceQualityLog: { timestampField: "classifiedAt", index: "by_classified_at" },
  sloMeasurements: { timestampField: "recordedAt", index: "by_recorded" },
  modelPerformanceMetrics: { timestampField: "recordedAt", index: "by_recorded_at" },
  alertHistory: { timestampField: "triggeredAt", index: "by_triggered" },
  restatementDecisionLog: { timestampField: "decidedAt", index: "by_decided_at" },
  calibrationDeployments: { timestampField: "deployedAt", index: "by_deployed_at" },
  validationReports: { timestampField: "generatedAt", index: "by_generated_at" },
  narrativeSearchLog: { timestampField: "searchedAt", index: "by_searched_at" },
  evidenceArtifacts: { timestampField: "createdAt", index: "by_created_at" },
  narrativeEvents: { timestampField: "createdAt" },
};

function fnv1a32Hex(str: string): string {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/* ------------------------------------------------------------------ */
/* DELETION WORKFLOW                                                   */
/* ------------------------------------------------------------------ */

/**
 * Deletion request (Right to Deletion / GDPR Article 17)
 */
export interface DeletionRequest {
  requestId: string;

  /** What to delete */
  scope: "user_data" | "entity_data" | "specific_records";

  /** User ID or entity key */
  subject: string;

  /** Specific record IDs (if scope is specific_records) */
  recordIds?: string[];

  /** Requester */
  requestedBy: string;
  requestedAt: number;

  /** Status */
  status: "pending" | "in_progress" | "completed" | "failed";

  /** Deletion summary */
  deletionSummary?: {
    tablesAffected: string[];
    recordsDeleted: number;
    tombstonesCreated: number;
    failedDeletions: Array<{
      table: string;
      recordId: string;
      error: string;
    }>;
  };

  /** Completion */
  completedAt?: number;
  completedBy?: string;
}

/* ------------------------------------------------------------------ */
/* SCHEDULED DELETION JOBS                                             */
/* ------------------------------------------------------------------ */

/**
 * Run TTL-based deletion for expired records
 */
export const runTtlDeletion = internalAction({
  args: {
    dataClass: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    dataClass: v.optional(v.string()),
    tablesProcessed: v.array(v.string()),
    recordsDeleted: v.number(),
    recordsAggregated: v.number(),
    recordsArchived: v.number(),
    dryRun: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    let recordsDeleted = 0;
    let recordsAggregated = 0;
    let recordsArchived = 0;
    const tablesProcessed: string[] = [];

    const dataClassesToProcess = args.dataClass
      ? [args.dataClass as DataClass]
      : Object.keys(RETENTION_POLICIES) as DataClass[];

    for (const dataClass of dataClassesToProcess) {
      const policy = RETENTION_POLICIES[dataClass];
      if (policy.retentionDays < 0) continue;  // Indefinite retention

      // Find tables for this data class
      const tables = Object.entries(TABLE_DATA_CLASS_MAP)
        .filter(([_, dc]) => dc === dataClass)
        .map(([table]) => table);

      for (const table of tables) {
        tablesProcessed.push(table);

        // Calculate expiration timestamp
        const expiresAt = Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000;

        // Query expired records
        const expired = await ctx.runQuery(
          internal.domains.operations.privacyEnforcement.getExpiredRecords,
          { table, expiresAt }
        );

        if (policy.action === "delete") {
          if (!dryRun) {
            for (const recordId of expired) {
              await ctx.runMutation(
                internal.domains.operations.privacyEnforcement.deleteRecord,
                { table, recordId }
              );
              recordsDeleted++;
            }
          } else {
            recordsDeleted += expired.length;
          }
        } else if (policy.action === "aggregate") {
          if (!dryRun) {
            // Aggregate then delete
            await ctx.runMutation(
              internal.domains.operations.privacyEnforcement.aggregateAndDelete,
              { table, recordIds: expired }
            );
            recordsAggregated += expired.length;
          } else {
            recordsAggregated += expired.length;
          }
        } else if (policy.action === "archive") {
          if (!dryRun) {
            // Move to archive storage
            await ctx.runMutation(
              internal.domains.operations.privacyEnforcement.archiveRecords,
              { table, recordIds: expired }
            );
            recordsArchived += expired.length;
          } else {
            recordsArchived += expired.length;
          }
        }
      }
    }

    return {
      dataClass: args.dataClass,
      tablesProcessed,
      recordsDeleted,
      recordsAggregated,
      recordsArchived,
      dryRun,
    };
  },
});

/**
 * Process a user deletion request
 */
export const processDeletionRequest = internalAction({
  args: {
    requestId: v.id("deletionRequests"),
  },
  returns: v.object({
    success: v.boolean(),
    recordsDeleted: v.number(),
    tablesAffected: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    // Get deletion request
    const request = await ctx.runQuery(
      internal.domains.operations.privacyEnforcement.getDeletionRequest,
      { requestId: args.requestId }
    );

    if (!request) {
      throw new Error(`Deletion request not found: ${args.requestId}`);
    }

    // Mark as in progress
    await ctx.runMutation(
      internal.domains.operations.privacyEnforcement.updateDeletionRequestStatus,
      { requestId: args.requestId, status: "in_progress" }
    );

    const tablesAffected: string[] = [];
    let recordsDeleted = 0;
    const failedDeletions: Array<{ table: string; recordId: string; error: string }> = [];

    if (request.scope === "user_data") {
      // Delete all data for a user
      const userTables = [
        "mcpServers",
        "agentRuns",
        "narrativeThreads",
        "narrativePosts",
        "narrativeReplies",
        "evidenceArtifacts",
        "narrativeSearchLog",
        "groundTruthVersions",
        "validationFindings",
        "calibrationProposals",
        // Add more user-linkable tables
      ];

      for (const table of userTables) {
        const records = await ctx.runQuery(
          internal.domains.operations.privacyEnforcement.getUserRecords,
          { table, userId: request.subject }
        );

        for (const recordId of records) {
          try {
            await ctx.runMutation(
              internal.domains.operations.privacyEnforcement.deleteRecordWithTombstone,
              { table, recordId, deletionRequestId: args.requestId }
            );
            recordsDeleted++;
          } catch (error) {
            failedDeletions.push({
              table,
              recordId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (records.length > 0) {
          tablesAffected.push(table);
        }
      }
    } else if (request.scope === "entity_data") {
      // Delete data associated with a single entity key (best-effort).
      const entityKey = request.subject;
      const entityTables = [
        { table: "groundTruthVersions", field: "entityKey" },
        { table: "groundTruthFinancials", field: "ticker" },
      ];

      for (const { table, field } of entityTables) {
        const docs = await (ctx.db.query(table as any) as any)
          .filter((q: any) => q.eq(q.field(field), entityKey))
          .collect();
        for (const d of docs) {
          try {
            await ctx.runMutation(
              internal.domains.operations.privacyEnforcement.deleteRecordWithTombstone,
              { table, recordId: String(d._id), deletionRequestId: args.requestId }
            );
            recordsDeleted++;
          } catch (error) {
            failedDeletions.push({
              table,
              recordId: String(d._id),
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if (docs.length > 0) tablesAffected.push(table);
      }

      // Narrative threads where entityKeys contains the entityKey.
      const threads = await ctx.db.query("narrativeThreads").collect();
      const matchingThreads = threads.filter((t) => Array.isArray(t.entityKeys) && t.entityKeys.includes(entityKey));
      for (const t of matchingThreads) {
        try {
          await ctx.runMutation(
            internal.domains.operations.privacyEnforcement.deleteRecordWithTombstone,
            { table: "narrativeThreads", recordId: String(t._id), deletionRequestId: args.requestId }
          );
          recordsDeleted++;
        } catch (error) {
          failedDeletions.push({
            table: "narrativeThreads",
            recordId: String(t._id),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (matchingThreads.length > 0) tablesAffected.push("narrativeThreads");

    } else if (request.scope === "specific_records" && request.recordIds) {
      // Delete specific records, encoded as "table:recordId"
      for (const ref of request.recordIds) {
        const [table, recordId] = String(ref).split(":", 2);
        if (!table || !recordId) {
          failedDeletions.push({ table: "unknown", recordId: String(ref), error: "invalid_record_ref_format" });
          continue;
        }
        try {
          await ctx.runMutation(
            internal.domains.operations.privacyEnforcement.deleteRecordWithTombstone,
            { table, recordId, deletionRequestId: args.requestId }
          );
          recordsDeleted++;
          if (!tablesAffected.includes(table)) tablesAffected.push(table);
        } catch (error) {
          failedDeletions.push({
            table,
            recordId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Create deletion summary
    const summary = {
      tablesAffected,
      recordsDeleted,
      tombstonesCreated: recordsDeleted,
      failedDeletions,
    };

    // Mark as completed
    await ctx.runMutation(
      internal.domains.operations.privacyEnforcement.completeDeletionRequest,
      {
        requestId: args.requestId,
        summary,
      }
    );

    return {
      success: failedDeletions.length === 0,
      recordsDeleted,
      tablesAffected,
    };
  },
});

/* ------------------------------------------------------------------ */
/* FIELD-LEVEL MINIMIZATION                                            */
/* ------------------------------------------------------------------ */

/**
 * Hash sensitive fields for storage
 */
export function hashSensitiveField(value: string): string {
  // In production, use crypto.subtle.digest
  // For now, simplified
  return `hash_${value.length}_${value.charCodeAt(0)}`;
}

/**
 * Minimize personal data before storage
 */
export function minimizePersonalData(data: {
  email?: string;
  name?: string;
  phone?: string;
  ipAddress?: string;
}): {
  emailHash?: string;
  nameInitials?: string;
  phoneHash?: string;
  ipAddressSubnet?: string;
} {
  return {
    emailHash: data.email ? hashSensitiveField(data.email) : undefined,
    nameInitials: data.name
      ? data.name.split(" ").map(n => n[0]).join("")
      : undefined,
    phoneHash: data.phone ? hashSensitiveField(data.phone) : undefined,
    ipAddressSubnet: data.ipAddress
      ? data.ipAddress.split(".").slice(0, 3).join(".") + ".0"
      : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* CONVEX QUERIES/MUTATIONS                                            */
/* ------------------------------------------------------------------ */

export const getExpiredRecords = query({
  args: {
    table: v.string(),
    expiresAt: v.number(),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const cfg = TTL_TABLE_CONFIG[args.table];
    if (!cfg) return [];

    const tableName = args.table as any;
    const limit = 500;

    try {
      if (cfg.index) {
        const docs = await (ctx.db.query(tableName) as any)
          .withIndex(cfg.index, (q: any) => q.lt(cfg.timestampField, args.expiresAt))
          .take(limit);
        return (docs as any[]).map((d) => String(d._id));
      }

      const docs = await (ctx.db.query(tableName) as any)
        .filter((q: any) => q.lt(q.field(cfg.timestampField), args.expiresAt))
        .take(limit);
      return (docs as any[]).map((d) => String(d._id));
    } catch (err) {
      console.warn("[privacyEnforcement] getExpiredRecords failed:", args.table, err);
      return [];
    }
  },
});

export const deleteRecord = internalMutation({
  args: {
    table: v.string(),
    recordId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const id = args.recordId as unknown as Id<any>;
    const existing = await ctx.db.get(id);
    if (existing) {
      await ctx.db.delete(id);
    }
    return null;
  },
});

export const aggregateAndDelete = internalMutation({
  args: {
    table: v.string(),
    recordIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const dataClass = TABLE_DATA_CLASS_MAP[args.table] ?? "operational_logs";
    await ctx.db.insert("retentionAggregations", {
      table: args.table,
      dataClass,
      expiresAt: now,
      aggregatedAt: now,
      recordsCount: args.recordIds.length,
    });

    for (const recordId of args.recordIds) {
      const id = recordId as unknown as Id<any>;
      const existing = await ctx.db.get(id);
      if (existing) {
        await ctx.db.delete(id);
      }
    }
    return null;
  },
});

export const archiveRecords = internalMutation({
  args: {
    table: v.string(),
    recordIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const dataClass = TABLE_DATA_CLASS_MAP[args.table] ?? "audit_logs";

    for (const recordId of args.recordIds) {
      const id = recordId as unknown as Id<any>;
      const existing = await ctx.db.get(id);
      if (!existing) continue;

      const content = JSON.stringify(existing);
      const contentHash = `fnv1a32_${fnv1a32Hex(content)}`;

      await ctx.db.insert("archivedRecords", {
        table: args.table,
        recordId,
        dataClass,
        archivedAt: now,
        contentHash,
        data: existing,
      });

      await ctx.db.delete(id);
    }
    return null;
  },
});

export const getDeletionRequest = query({
  args: { requestId: v.id("deletionRequests") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.requestId);
  },
});

export const updateDeletionRequestStatus = internalMutation({
  args: {
    requestId: v.id("deletionRequests"),
    status: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, {
      status: args.status,
    });
    return null;
  },
});

export const completeDeletionRequest = internalMutation({
  args: {
    requestId: v.id("deletionRequests"),
    summary: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, {
      status: "completed",
      deletionSummary: args.summary,
      completedAt: Date.now(),
    });
    return null;
  },
});

export const getUserRecords = query({
  args: {
    table: v.string(),
    userId: v.string(),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const table = args.table;
    const userId = args.userId;
    const limit = 2000;

    try {
      if (table === "mcpServers") {
        const docs = await ctx.db
          .query("mcpServers")
          .withIndex("by_user", (q) => q.eq("userId", userId as any))
          .take(limit);
        return docs.map((d) => String(d._id));
      }

      if (table === "agentRuns") {
        const docs = await ctx.db
          .query("agentRuns")
          .withIndex("by_user", (q) => q.eq("userId", userId as any))
          .take(limit);
        return docs.map((d) => String(d._id));
      }

      if (table === "narrativeThreads") {
        const docs = await ctx.db
          .query("narrativeThreads")
          .withIndex("by_user", (q) => q.eq("userId", userId as any))
          .take(limit);
        return docs.map((d) => String(d._id));
      }

      if (table === "narrativePosts") {
        const docs = await ctx.db.query("narrativePosts").collect();
        return docs
          .filter((p) => p.authorType === "human" && p.authorId === userId)
          .slice(0, limit)
          .map((d) => String(d._id));
      }

      if (table === "narrativeReplies") {
        const docs = await ctx.db.query("narrativeReplies").collect();
        return docs
          .filter((r) => r.authorType === "human" && r.authorId === userId)
          .slice(0, limit)
          .map((d) => String(d._id));
      }

      if (table === "groundTruthVersions") {
        const docs = await ctx.db
          .query("groundTruthVersions")
          .withIndex("by_author", (q) => q.eq("authorId", userId as any).eq("status", "approved"))
          .take(limit);
        return docs.map((d) => String(d._id));
      }

      if (table === "validationFindings") {
        const docs = await ctx.db.query("validationFindings").collect();
        return docs
          .filter((f: any) => f.createdBy === userId || f.updatedBy === userId)
          .slice(0, limit)
          .map((d: any) => String(d._id));
      }

      if (table === "calibrationProposals") {
        const docs = await ctx.db.query("calibrationProposals").collect();
        return docs
          .filter((p: any) => p.proposedBy === userId)
          .slice(0, limit)
          .map((d: any) => String(d._id));
      }

      if (table === "evidenceArtifacts") {
        const docs = await ctx.db.query("evidenceArtifacts").collect();
        return docs
          .filter((a: any) => a.retrievalTrace?.agentName === userId)
          .slice(0, limit)
          .map((d: any) => String(d._id));
      }

      if (table === "narrativeSearchLog") {
        const docs = await ctx.db
          .query("narrativeSearchLog")
          .withIndex("by_user", (q) => q.eq("userId", userId as any))
          .take(limit);
        return docs.map((d) => String(d._id));
      }

      return [];
    } catch (err) {
      console.warn("[privacyEnforcement] getUserRecords failed:", args.table, err);
      return [];
    }
  },
});

export const deleteRecordWithTombstone = internalMutation({
  args: {
    table: v.string(),
    recordId: v.string(),
    deletionRequestId: v.id("deletionRequests"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Create tombstone for audit trail
    await ctx.db.insert("deletionTombstones", {
      table: args.table,
      recordId: args.recordId,
      deletionRequestId: args.deletionRequestId,
      deletedAt: Date.now(),
    });

    const id = args.recordId as unknown as Id<any>;
    const existing = await ctx.db.get(id);
    if (existing) {
      await ctx.db.delete(id);
    }

    return null;
  },
});

/**
 * Process pending deletion requests (cron-friendly)
 */
export const processPendingDeletionRequests = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.object({
    processed: v.number(),
    succeeded: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const pending = await ctx.db
      .query("deletionRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(limit);

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const req of pending) {
      processed++;
      try {
        const result = await ctx.runAction(
          internal.domains.operations.privacyEnforcement.processDeletionRequest,
          { requestId: req._id }
        );
        if (result.success) succeeded++;
        else failed++;
      } catch (err) {
        failed++;
        console.warn("[privacyEnforcement] Failed processing deletion request:", req._id, err);
        try {
          await ctx.runMutation(
            internal.domains.operations.privacyEnforcement.updateDeletionRequestStatus,
            { requestId: req._id, status: "failed" }
          );
        } catch {}
      }
    }

    return { processed, succeeded, failed };
  },
});

/**
 * Create a deletion request
 */
export const createDeletionRequest = mutation({
  args: {
    scope: v.union(
      v.literal("user_data"),
      v.literal("entity_data"),
      v.literal("specific_records")
    ),
    subject: v.string(),
    recordIds: v.optional(v.array(v.string())),
    requestedBy: v.string(),
  },
  returns: v.id("deletionRequests"),
  handler: async (ctx, args) => {
    const requestId = await ctx.db.insert("deletionRequests", {
      requestId: `del_req_${Date.now()}`,
      scope: args.scope,
      subject: args.subject,
      recordIds: args.recordIds,
      requestedBy: args.requestedBy,
      requestedAt: Date.now(),
      status: "pending",
    });

    // Log the security/privacy action
    await ctx.runMutation(internal.domains.operations.adminAuditLog.logAdminActionInternal, {
      action: "create_deletion_request",
      actionCategory: "security_event",
      actor: args.requestedBy,
      resourceType: "deletionRequests",
      resourceId: requestId,
      before: null,
      after: {
        scope: args.scope,
        subject: args.subject,
        recordCount: args.recordIds?.length ?? 0,
      },
      reason: `GDPR deletion request created for ${args.scope}: ${args.subject}`,
      metadata: {
        scope: args.scope,
        subject: args.subject,
        recordIdsCount: args.recordIds?.length ?? 0,
        gdprCompliance: true,
      },
    }).catch((err) => {
      console.warn('[createDeletionRequest] Failed to log audit entry:', err);
    });

    return requestId;
  },
});

/**
 * Get retention policy for a table
 */
export const getRetentionPolicy = query({
  args: { table: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const dataClass = TABLE_DATA_CLASS_MAP[args.table];
    if (!dataClass) return null;

    return RETENTION_POLICIES[dataClass];
  },
});
