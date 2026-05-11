import { mutation, query } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";

import {
  requireProductIdentity,
  resolveProductReadOwnerKeys,
  toAnonymousProductOwnerKey,
} from "./helpers";
import { composeSearchableText } from "../search/federatedHelpers";
import {
  productEventBudgetDecisionInputValidator,
  productEventCaptureInputValidator,
  productEventRunStatusValidator,
  productEventWorkspaceClaimInputValidator,
  productEventWorkspaceEntityInputValidator,
  productEventWorkspaceEvidenceInputValidator,
  productEventWorkspaceFollowUpInputValidator,
  productEventWorkspaceSourceValidator,
  productEventWorkspaceTabValidator,
} from "./schema";
import { insertProductActivity } from "./activity";

const DEFAULT_EVENT_WORKSPACE_TABS = [
  "brief",
  "cards",
  "notebook",
  "sources",
  "chat",
  "map",
] as const;

const notebookActionValidator = v.union(
  v.literal("organize_notes"),
  v.literal("create_dossier"),
  v.literal("clone_structure"),
  v.literal("link_concepts"),
  v.literal("extract_followups"),
  v.literal("audit_claims"),
  v.literal("merge_entities"),
  v.literal("refresh_stale_sections"),
  v.literal("turn_into_template"),
);

const notebookEntityTypeValidator = v.union(
  v.literal("company"),
  v.literal("person"),
  v.literal("product"),
  v.literal("market"),
  v.literal("event"),
  v.literal("topic"),
);

const notebookClaimStatusValidator = v.union(
  v.literal("field_note"),
  v.literal("needs_review"),
  v.literal("verified"),
  v.literal("rejected"),
);

const notebookEntityChangeValidator = v.object({
  kind: v.literal("upsert_entity"),
  entityKey: v.string(),
  name: v.string(),
  entityType: notebookEntityTypeValidator,
  confidence: v.number(),
  sourceCaptureIds: v.optional(v.array(v.string())),
});

const notebookClaimChangeValidator = v.object({
  kind: v.literal("propose_claim_update"),
  claimId: v.string(),
  claim: v.string(),
  status: notebookClaimStatusValidator,
  evidenceIds: v.array(v.string()),
  reason: v.string(),
});

const notebookFollowUpChangeValidator = v.object({
  kind: v.literal("create_followup"),
  action: v.string(),
  linkedEntityKeys: v.array(v.string()),
  priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  sourceCaptureIds: v.optional(v.array(v.string())),
});

const notebookEdgeChangeValidator = v.object({
  kind: v.literal("create_edge"),
  fromKey: v.string(),
  toKey: v.string(),
  edgeType: v.union(
    v.literal("BUILDS"),
    v.literal("MENTIONED_IN"),
    v.literal("CLAIMS"),
    v.literal("ATTENDED"),
    v.literal("COMPETES_WITH"),
    v.literal("RELATED_TO"),
    v.literal("HAS_PROFILE"),
  ),
  explanation: v.string(),
  confidence: v.number(),
});

const notebookRunTraceStepValidator = v.object({
  label: v.string(),
  detail: v.string(),
});

const notebookPatchValidator = v.object({
  actionId: v.string(),
  action: notebookActionValidator,
  summary: v.string(),
  proposedEntityChanges: v.array(notebookEntityChangeValidator),
  proposedClaimChanges: v.array(notebookClaimChangeValidator),
  proposedFollowUpChanges: v.array(notebookFollowUpChangeValidator),
  proposedEdgeChanges: v.array(notebookEdgeChangeValidator),
  requiresConfirmation: v.boolean(),
  runTrace: v.array(notebookRunTraceStepValidator),
});

const notebookCaptureInputValidator = v.object({
  captureId: v.string(),
  rawText: v.string(),
  extractedEntityIds: v.optional(v.array(v.string())),
});

const snapshotArgs = {
  anonymousSessionId: v.optional(v.string()),
  workspaceId: v.string(),
  reportId: v.optional(v.id("productReports")),
  eventId: v.optional(v.string()),
  title: v.string(),
  eventSessionId: v.optional(v.string()),
  defaultTabs: v.optional(v.array(productEventWorkspaceTabValidator)),
  source: v.optional(productEventWorkspaceSourceValidator),
  runId: v.optional(v.string()),
  runStatus: v.optional(productEventRunStatusValidator),
  entities: v.optional(v.array(productEventWorkspaceEntityInputValidator)),
  evidence: v.optional(v.array(productEventWorkspaceEvidenceInputValidator)),
  claims: v.optional(v.array(productEventWorkspaceClaimInputValidator)),
  followUps: v.optional(v.array(productEventWorkspaceFollowUpInputValidator)),
  budgetDecisions: v.optional(v.array(productEventBudgetDecisionInputValidator)),
  captures: v.optional(v.array(productEventCaptureInputValidator)),
};

function normalizeKey(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function eventIdFor(workspaceId: string, eventId?: string) {
  return normalizeKey(eventId?.trim() || workspaceId, "eventId");
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function slugify(value: string) {
  const slug = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/['".,()[\]{}]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unassigned";
}

function titleizeKey(value: string) {
  return slugify(value)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Unassigned";
}

function mapNotebookEntityType(
  entityType: string,
): "event" | "person" | "company" | "product" | "market" | "topic" | "job" | "customer_segment" | "claim" | "source" {
  if (
    entityType === "event" ||
    entityType === "person" ||
    entityType === "company" ||
    entityType === "product" ||
    entityType === "topic" ||
    entityType === "market"
  ) {
    return entityType;
  }
  return "company";
}

function mapNotebookClaimStatus(
  status: string,
): "field_note" | "needs_evidence" | "provisional" | "verified" {
  if (status === "field_note" || status === "verified") return status;
  if (status === "rejected") return "needs_evidence";
  return "needs_evidence";
}

function mapNotebookPromotionGate(status: string) {
  if (status === "verified") return "none" as const;
  if (status === "field_note") return "needs_public_source" as const;
  return "needs_human_review" as const;
}

function validateReferences(args: {
  entities?: Array<{ id: string }>;
  evidence?: Array<{ id: string }>;
  claims?: Array<{ id: string; subjectId: string; evidenceIds: string[] }>;
  followUps?: Array<{ id: string; linkedEntityIds: string[] }>;
}) {
  const entityIds = new Set((args.entities ?? []).map((entity) => entity.id));
  const evidenceIds = new Set((args.evidence ?? []).map((item) => item.id));
  const errors: string[] = [];

  for (const claim of args.claims ?? []) {
    if (entityIds.size > 0 && !entityIds.has(claim.subjectId)) {
      errors.push(`Claim ${claim.id} references missing subject ${claim.subjectId}`);
    }
    for (const evidenceId of claim.evidenceIds) {
      if (evidenceIds.size > 0 && !evidenceIds.has(evidenceId)) {
        errors.push(`Claim ${claim.id} references missing evidence ${evidenceId}`);
      }
    }
  }

  for (const followUp of args.followUps ?? []) {
    for (const entityId of followUp.linkedEntityIds) {
      if (entityIds.size > 0 && !entityIds.has(entityId)) {
        errors.push(`Follow-up ${followUp.id} references missing entity ${entityId}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

export function buildEventWorkspaceInputsFromNotebookPatch(args: {
  patch: any;
  captures?: Array<{
    captureId: string;
    rawText: string;
    extractedEntityIds?: string[];
  }>;
}) {
  const entityByKey = new Map<string, any>();
  const ensureEntity = (
    key: string,
    name = titleizeKey(key),
    entityType = "company",
    confidence = 0.45,
  ) => {
    const entityKey = slugify(key);
    if (entityByKey.has(entityKey)) return entityByKey.get(entityKey);
    const entity = {
      id: entityKey,
      uri: `nodebench://entity/${entityKey}`,
      type: mapNotebookEntityType(entityType),
      name,
      layer: "workspace_memory" as const,
      confidence,
    };
    entityByKey.set(entityKey, entity);
    return entity;
  };

  for (const entity of args.patch.proposedEntityChanges ?? []) {
    ensureEntity(
      entity.entityKey,
      entity.name,
      entity.entityType,
      Math.max(0, Math.min(1, entity.confidence ?? 0.5)),
    );
  }

  const captures = (args.captures ?? []).slice(0, 40).map((capture) => {
    const extractedEntityIds = unique(
      (capture.extractedEntityIds ?? []).map((item) => slugify(item)),
    );
    for (const entityKey of extractedEntityIds) {
      ensureEntity(entityKey, titleizeKey(entityKey), "company", 0.5);
    }
    return {
      captureId: normalizeKey(capture.captureId, "capture.captureId"),
      kind: "text" as const,
      rawText: capture.rawText,
      extractedEntityIds,
      extractedClaimIds: [],
      confidence: 0.66,
      status: "attached" as const,
    };
  });

  for (const followUp of args.patch.proposedFollowUpChanges ?? []) {
    for (const entityKey of followUp.linkedEntityKeys ?? []) {
      ensureEntity(entityKey);
    }
  }

  const claimSubjectKey =
    [...entityByKey.keys()][0] ?? ensureEntity("claim-review", "Claim review", "claim", 0.4).id;

  const claims = (args.patch.proposedClaimChanges ?? []).slice(0, 80).map((claim: any) => {
    const claimKey = slugify(claim.claimId || claim.claim);
    return {
      id: claimKey,
      subjectId: claimSubjectKey,
      claim: claim.claim,
      status: mapNotebookClaimStatus(claim.status),
      visibility: "private" as const,
      evidenceIds: unique((claim.evidenceIds ?? []).map((id: string) => slugify(id))),
      promotionGate: mapNotebookPromotionGate(claim.status),
    };
  });

  for (const claim of claims) {
    ensureEntity(claim.subjectId, titleizeKey(claim.subjectId), "claim", 0.4);
  }

  const followUps = (args.patch.proposedFollowUpChanges ?? []).slice(0, 80).map((followUp: any, index: number) => ({
    id: slugify(`${args.patch.actionId}.followup.${index}.${followUp.action}`),
    owner: "me",
    action: followUp.action,
    linkedEntityIds: unique(
      (followUp.linkedEntityKeys ?? []).map((entityKey: string) => slugify(entityKey)),
    ),
    due: followUp.priority === "high" ? "today" as const : "this_week" as const,
    priority: followUp.priority,
    status: "open" as const,
  }));

  return {
    entities: [...entityByKey.values()],
    captures,
    claims,
    followUps,
    edgeCount: (args.patch.proposedEdgeChanges ?? []).length,
  };
}

async function resolveEventWorkspaceWriteOwnerKey(
  ctx: any,
  anonymousSessionId?: string | null,
) {
  const anonymousOwnerKey = toAnonymousProductOwnerKey(anonymousSessionId);
  if (anonymousOwnerKey) return anonymousOwnerKey;
  const identity = await requireProductIdentity(ctx, anonymousSessionId);
  return identity.ownerKey;
}

async function resolveEventWorkspaceReadOwnerKeys(
  ctx: any,
  anonymousSessionId?: string | null,
) {
  const ownerKeys: string[] = [];
  const push = (ownerKey?: string | null) => {
    if (!ownerKey || ownerKeys.includes(ownerKey)) return;
    ownerKeys.push(ownerKey);
  };

  push(toAnonymousProductOwnerKey(anonymousSessionId));

  try {
    for (const ownerKey of await resolveProductReadOwnerKeys(ctx, anonymousSessionId)) {
      push(ownerKey);
    }
  } catch (error) {
    console.warn("[eventWorkspace] auth-backed owner resolution failed; using anonymous owner", error);
  }

  return ownerKeys;
}

async function upsertProductEntityFromNotebookPatch(
  ctx: any,
  args: {
    ownerKey: string;
    reportId?: any;
    entity: {
      id: string;
      name: string;
      type: string;
      confidence: number;
    };
    now: number;
  },
) {
  const slug = slugify(args.entity.id || args.entity.name);
  const existing = await ctx.db
    .query("productEntities")
    .withIndex("by_owner_slug", (q: any) => q.eq("ownerKey", args.ownerKey).eq("slug", slug))
    .first();
  const patch = {
    name: args.entity.name,
    entityType: args.entity.type,
    summary: `Accepted from web notebook action with ${Math.round(args.entity.confidence * 100)}% confidence.`,
    savedBecause: "notebook_action_accept",
    latestReportId: args.reportId,
    latestReportUpdatedAt: args.reportId ? args.now : undefined,
    updatedAt: args.now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, {
      ...patch,
      latestRevision: (existing.latestRevision ?? 0) + 1,
      reportCount: args.reportId ? Math.max(existing.reportCount ?? 1, 1) : existing.reportCount,
    });
    // PR E: schedule per-row embedding for the patched entity.
    await ctx.scheduler.runAfter(
      0,
      internal.domains.search.embedRowOnUpdate.embedEntityRow,
      { entityId: existing._id },
    );
    return existing._id;
  }
  const entityId = await ctx.db.insert("productEntities", {
    ownerKey: args.ownerKey,
    slug,
    createdAt: args.now,
    latestRevision: 1,
    reportCount: args.reportId ? 1 : 0,
    searchableText: composeSearchableText([
      patch.name,
      slug,
      patch.summary,
      patch.savedBecause,
    ]),
    ...patch,
  });
  // PR E: schedule per-row embedding for the inserted entity.
  await ctx.scheduler.runAfter(
    0,
    internal.domains.search.embedRowOnUpdate.embedEntityRow,
    { entityId },
  );
  return entityId;
}

async function insertProductClaimFromNotebookPatch(
  ctx: any,
  args: {
    ownerKey: string;
    reportId?: any;
    claim: {
      id: string;
      claim: string;
      status: string;
      evidenceIds: string[];
    };
    now: number;
  },
) {
  if (!args.reportId) return null;
  const claimKey = slugify(`notebook.${args.claim.id}`);
  const existingClaims = await ctx.db
    .query("productClaims")
    .withIndex("by_owner_report", (q: any) =>
      q.eq("ownerKey", args.ownerKey).eq("reportId", args.reportId),
    )
    .collect();
  const existing = existingClaims.find((claim: any) => claim.claimKey === claimKey);
  const patch = {
    claimText: args.claim.claim,
    claimType: "summary_other" as const,
    slotKey: claimKey,
    sectionId: "notebook-action",
    sourceRefIds: args.claim.evidenceIds,
    supportStrength: args.claim.status === "verified" ? "verified" as const : "weak" as const,
    freshnessStatus: "unknown" as const,
    contradictionFlag: false,
    publishable: args.claim.status === "verified",
    rejectionReasons:
      args.claim.status === "verified" ? [] : ["Accepted from notebook as review-only"],
    updatedAt: args.now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return ctx.db.insert("productClaims", {
    ownerKey: args.ownerKey,
    reportId: args.reportId,
    claimKey,
    createdAt: args.now,
    ...patch,
  });
}

async function upsertEventWorkspaceSnapshot(ctx: any, args: any, ownerKey: string) {
  const now = Date.now();
  const workspaceId = normalizeKey(args.workspaceId, "workspaceId");
  const eventId = eventIdFor(workspaceId, args.eventId);
  const title = normalizeKey(args.title, "title");
  const source = args.source ?? "agent_run";
  const defaultTabs = args.defaultTabs?.length
    ? args.defaultTabs
    : [...DEFAULT_EVENT_WORKSPACE_TABS];

  validateReferences(args);

  const existingWorkspace = await ctx.db
    .query("productEventWorkspaces")
    .withIndex("by_owner_workspace", (q: any) =>
      q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
    )
    .first();
  if (existingWorkspace) {
    await ctx.db.patch(existingWorkspace._id, {
      eventId,
      title,
      ...(args.reportId ? { reportId: args.reportId } : {}),
      defaultTabs,
      source,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("productEventWorkspaces", {
      ownerKey,
      workspaceId,
      eventId,
      title,
      ...(args.reportId ? { reportId: args.reportId } : {}),
      defaultTabs,
      source,
      createdAt: now,
      updatedAt: now,
    });
  }

  let entityCount = 0;
  for (const entity of args.entities ?? []) {
    const entityKey = normalizeKey(entity.id, "entity.id");
    const existing = await ctx.db
      .query("productEventWorkspaceEntities")
      .withIndex("by_owner_workspace_entity", (q: any) =>
        q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId).eq("entityKey", entityKey),
      )
      .first();
    const patch = {
      eventId,
      uri: entity.uri,
      entityType: entity.type,
      name: entity.name,
      layer: entity.layer,
      confidence: entity.confidence,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("productEventWorkspaceEntities", {
        ownerKey,
        workspaceId,
        entityKey,
        createdAt: now,
        ...patch,
      });
    }
    entityCount += 1;
  }

  let evidenceCount = 0;
  for (const item of args.evidence ?? []) {
    const evidenceKey = normalizeKey(item.id, "evidence.id");
    const existing = await ctx.db
      .query("productEventWorkspaceEvidence")
      .withIndex("by_owner_workspace_evidence", (q: any) =>
        q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId).eq("evidenceKey", evidenceKey),
      )
      .first();
    const patch = {
      eventId,
      sourceId: item.sourceId,
      sourceRefId: item.sourceRefId,
      layer: item.layer,
      title: item.title,
      visibility: item.visibility,
      reusable: item.reusable,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("productEventWorkspaceEvidence", {
        ownerKey,
        workspaceId,
        evidenceKey,
        createdAt: now,
        ...patch,
      });
    }
    evidenceCount += 1;
  }

  let claimCount = 0;
  for (const claim of args.claims ?? []) {
    const claimKey = normalizeKey(claim.id, "claim.id");
    const existing = await ctx.db
      .query("productEventWorkspaceClaims")
      .withIndex("by_owner_workspace_claim", (q: any) =>
        q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId).eq("claimKey", claimKey),
      )
      .first();
    const patch = {
      eventId,
      subjectEntityKey: claim.subjectId,
      claim: claim.claim,
      status: claim.status,
      visibility: claim.visibility,
      evidenceKeys: claim.evidenceIds,
      promotionGate: claim.promotionGate,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("productEventWorkspaceClaims", {
        ownerKey,
        workspaceId,
        claimKey,
        createdAt: now,
        ...patch,
      });
    }
    claimCount += 1;
  }

  let followUpCount = 0;
  for (const followUp of args.followUps ?? []) {
    const followUpKey = normalizeKey(followUp.id, "followUp.id");
    const existing = await ctx.db
      .query("productEventWorkspaceFollowUps")
      .withIndex("by_owner_workspace_followup", (q: any) =>
        q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId).eq("followUpKey", followUpKey),
      )
      .first();
    const patch = {
      eventId,
      owner: followUp.owner,
      action: followUp.action,
      linkedEntityKeys: followUp.linkedEntityIds,
      due: followUp.due,
      priority: followUp.priority,
      status: followUp.status ?? "open",
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("productEventWorkspaceFollowUps", {
        ownerKey,
        workspaceId,
        followUpKey,
        createdAt: now,
        ...patch,
      });
    }
    followUpCount += 1;
  }

  let budgetDecisionCount = 0;
  for (const decision of args.budgetDecisions ?? []) {
    const scenario = normalizeKey(decision.scenario, "budgetDecision.scenario");
    const existing = await ctx.db
      .query("productEventBudgetDecisions")
      .withIndex("by_owner_workspace_scenario", (q: any) =>
        q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId).eq("scenario", scenario),
      )
      .first();
    const patch = {
      eventId,
      actorType: decision.actorType,
      route: decision.route,
      paidCallsUsed: decision.paidCallsUsed,
      requiresApproval: decision.requiresApproval,
      persistedLayer: decision.persistedLayer,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("productEventBudgetDecisions", {
        ownerKey,
        workspaceId,
        scenario,
        createdAt: now,
        ...patch,
      });
    }
    budgetDecisionCount += 1;
  }

  let captureCount = 0;
  for (const capture of args.captures ?? []) {
    const captureKey = normalizeKey(capture.captureId, "capture.captureId");
    const existing = await ctx.db
      .query("productEventCaptures")
      .withIndex("by_owner_capture", (q: any) =>
        q.eq("ownerKey", ownerKey).eq("captureKey", captureKey),
      )
      .first();
    const patch = {
      workspaceId,
      eventId,
      eventSessionId: capture.eventSessionId ?? args.eventSessionId,
      kind: capture.kind,
      rawText: capture.rawText,
      transcript: capture.transcript,
      artifactId: capture.artifactId,
      status: capture.status,
      extractedEntityKeys: capture.extractedEntityIds,
      extractedClaimKeys: capture.extractedClaimIds,
      confidence: capture.confidence,
      visibility: "private" as const,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("productEventCaptures", {
        ownerKey,
        captureKey,
        createdAt: capture.createdAt ?? now,
        ...patch,
      });
    }
    captureCount += 1;
  }

  if (args.runId) {
    const runId = normalizeKey(args.runId, "runId");
    const existingRun = await ctx.db
      .query("productEventRunRecords")
      .withIndex("by_owner_run", (q: any) => q.eq("ownerKey", ownerKey).eq("runId", runId))
      .first();
    const patch = {
      workspaceId,
      eventId,
      eventSessionId: args.eventSessionId,
      source,
      status: args.runStatus ?? "complete",
      entityKeys: unique((args.entities ?? []).map((entity: any) => entity.id)),
      claimKeys: unique((args.claims ?? []).map((claim: any) => claim.id)),
      evidenceKeys: unique((args.evidence ?? []).map((item: any) => item.id)),
      followUpKeys: unique((args.followUps ?? []).map((item: any) => item.id)),
      budgetScenarioKeys: unique((args.budgetDecisions ?? []).map((item: any) => item.scenario)),
      captureKeys: unique((args.captures ?? []).map((item: any) => item.captureId)),
      updatedAt: now,
    };
    if (existingRun) {
      await ctx.db.patch(existingRun._id, patch);
    } else {
      await ctx.db.insert("productEventRunRecords", {
        ownerKey,
        runId,
        createdAt: now,
        ...patch,
      });
    }
  }

  return {
    workspaceId,
    eventId,
    entityCount,
    evidenceCount,
    claimCount,
    followUpCount,
    budgetDecisionCount,
    captureCount,
    runRecorded: Boolean(args.runId),
  };
}

export const upsertSnapshot = mutation({
  args: snapshotArgs,
  handler: async (ctx, args) => {
    const ownerKey = await resolveEventWorkspaceWriteOwnerKey(ctx, args.anonymousSessionId);
    return upsertEventWorkspaceSnapshot(ctx, args, ownerKey);
  },
});

export const recordCapture = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    workspaceId: v.string(),
    eventId: v.optional(v.string()),
    title: v.string(),
    eventSessionId: v.string(),
    runId: v.optional(v.string()),
    capture: productEventCaptureInputValidator,
    entities: v.optional(v.array(productEventWorkspaceEntityInputValidator)),
    evidence: v.optional(v.array(productEventWorkspaceEvidenceInputValidator)),
    claims: v.optional(v.array(productEventWorkspaceClaimInputValidator)),
    followUps: v.optional(v.array(productEventWorkspaceFollowUpInputValidator)),
    budgetDecisions: v.optional(v.array(productEventBudgetDecisionInputValidator)),
  },
  handler: async (ctx, args) => {
    const ownerKey = await resolveEventWorkspaceWriteOwnerKey(ctx, args.anonymousSessionId);
    const result = await upsertEventWorkspaceSnapshot(
      ctx,
      {
        ...args,
        source: "live_capture",
        runStatus: "complete",
        captures: [args.capture],
      },
      ownerKey,
    );
    await insertProductActivity(ctx, {
      ownerKey,
      workspaceId: args.workspaceId,
      eventId: result.eventId,
      activityType: "capture_recorded",
      actorType: "user",
      visibility: "private",
      privacyScope: "private",
      entityKeys: args.capture.extractedEntityIds,
      claimKeys: args.capture.extractedClaimIds,
      sourceKeys: (args.evidence ?? []).map((item) => item.id),
      runId: args.runId,
      sessionId: args.eventSessionId,
      payloadPreview: {
        label: "Captured to active event session",
        detail: args.capture.rawText ?? args.capture.transcript ?? "Artifact-backed capture",
        status: args.capture.status,
        paidCallsUsed: 0,
        searchCallsAvoided: Math.max(1, (args.entities?.length ?? 0) + (args.claims?.length ?? 0)),
        cacheHitRate: 1,
      },
    });
    await insertProductActivity(ctx, {
      ownerKey,
      workspaceId: args.workspaceId,
      eventId: result.eventId,
      activityType: "search_budget_decision",
      actorType: "system",
      visibility: "private",
      privacyScope: "private",
      entityKeys: args.capture.extractedEntityIds,
      claimKeys: args.capture.extractedClaimIds,
      sourceKeys: (args.evidence ?? []).map((item) => item.id),
      runId: args.runId,
      sessionId: args.eventSessionId,
      payloadPreview: {
        label: "Using event corpus",
        detail: "Event capture used corpus, tenant memory, and source cache before live search.",
        status: "0 paid calls",
        paidCallsUsed: 0,
        searchCallsAvoided: Math.max(1, result.entityCount + result.claimCount),
        cacheHitRate: 1,
        sourceReuseCount: args.evidence?.filter((item) => item.reusable).length ?? 0,
      },
    });
    return result;
  },
});

export const acceptNotebookActionPatch = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    workspaceId: v.string(),
    reportId: v.optional(v.id("productReports")),
    reportTitle: v.optional(v.string()),
    acceptanceId: v.string(),
    patch: notebookPatchValidator,
    captures: v.optional(v.array(notebookCaptureInputValidator)),
  },
  handler: async (ctx, args) => {
    const ownerKey = await resolveEventWorkspaceWriteOwnerKey(ctx, args.anonymousSessionId);
    const workspaceId = normalizeKey(args.workspaceId, "workspaceId");
    const now = Date.now();

    let report: any = null;
    if (args.reportId) {
      report = await ctx.db.get(args.reportId);
      if (!report || report.ownerKey !== ownerKey) {
        throw new Error("Report not found");
      }
    }

    const title = normalizeKey(
      report?.title || args.reportTitle || titleizeKey(workspaceId),
      "title",
    );
    const projected = buildEventWorkspaceInputsFromNotebookPatch({
      patch: args.patch,
      captures: args.captures,
    });
    const runId = normalizeKey(
      `notebook-action.${slugify(args.acceptanceId || args.patch.actionId)}`,
      "runId",
    );

    const snapshotResult = await upsertEventWorkspaceSnapshot(
      ctx,
      {
        workspaceId,
        eventId: workspaceId,
        title,
        reportId: args.reportId,
        source: "agent_run",
        runId,
        runStatus: "complete",
        entities: projected.entities,
        claims: projected.claims,
        followUps: projected.followUps,
        captures: projected.captures,
      },
      ownerKey,
    );

    const productEntityIds: any[] = [];
    for (const entity of projected.entities) {
      productEntityIds.push(
        await upsertProductEntityFromNotebookPatch(ctx, {
          ownerKey,
          reportId: args.reportId,
          entity,
          now,
        }),
      );
    }

    const productClaimIds: any[] = [];
    for (const claim of projected.claims) {
      const claimId = await insertProductClaimFromNotebookPatch(ctx, {
        ownerKey,
        reportId: args.reportId,
        claim: {
          id: claim.id,
          claim: claim.claim,
          status: claim.status,
          evidenceIds: claim.evidenceIds,
        },
        now,
      });
      if (claimId) productClaimIds.push(claimId);
    }

    if (report && productClaimIds.length > 0) {
      const existingClaimIds = new Set((report.claimIds ?? []).map((id: any) => String(id)));
      const mergedClaimIds = [
        ...(report.claimIds ?? []),
        ...productClaimIds.filter((id) => !existingClaimIds.has(String(id))),
      ];
      await ctx.db.patch(report._id, {
        claimIds: mergedClaimIds,
        updatedAt: now,
      });
    }

    await insertProductActivity(ctx, {
      ownerKey,
      reportId: args.reportId,
      workspaceId,
      eventId: workspaceId,
      activityType: "notebook_patch_accepted",
      actorType: "agent",
      visibility: "private",
      privacyScope: "private",
      entityKeys: projected.entities.map((entity) => entity.id),
      claimKeys: projected.claims.map((claim) => claim.id),
      sourceKeys: projected.claims.flatMap((claim) => claim.evidenceIds),
      runId,
      payloadPreview: {
        label: "Accepted notebook action patch",
        detail: args.patch.summary,
        status: args.patch.requiresConfirmation ? "reviewable" : "accepted",
        paidCallsUsed: 0,
        searchCallsAvoided: Math.max(1, projected.entities.length + projected.claims.length),
      },
    });

    return {
      ok: true,
      workspaceId,
      runId,
      entityCount: snapshotResult.entityCount,
      claimCount: snapshotResult.claimCount,
      followUpCount: snapshotResult.followUpCount,
      captureCount: snapshotResult.captureCount,
      productEntityCount: productEntityIds.length,
      productClaimCount: productClaimIds.length,
      edgeCount: projected.edgeCount,
      savedAt: now,
    };
  },
});

export const recordGraphTraversal = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    workspaceId: v.string(),
    reportId: v.optional(v.id("productReports")),
    targetType: v.union(v.literal("node"), v.literal("edge")),
    targetKey: v.string(),
    targetLabel: v.string(),
    entityKeys: v.optional(v.array(v.string())),
    claimKeys: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const ownerKey = await resolveEventWorkspaceWriteOwnerKey(ctx, args.anonymousSessionId);
    const activityId = await insertProductActivity(ctx, {
      ownerKey,
      reportId: args.reportId,
      workspaceId: args.workspaceId,
      entitySlug: args.targetType === "node" ? args.targetKey : undefined,
      activityType: args.targetType === "node" ? "graph_node_opened" : "graph_edge_opened",
      actorType: "user",
      visibility: "private",
      privacyScope: "private",
      entityKeys: args.entityKeys ?? (args.targetType === "node" ? [args.targetKey] : []),
      claimKeys: args.claimKeys ?? [],
      sourceKeys: [],
      payloadPreview: {
        label: `Opened ${args.targetType}`,
        detail: args.targetLabel,
        status: "relationship traversal",
      },
    });
    return { ok: true, activityId };
  },
});

export const getSnapshot = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    workspaceId: v.string(),
  },
  handler: async (ctx, args) => {
    const workspaceId = normalizeKey(args.workspaceId, "workspaceId");
    const ownerKeys = await resolveEventWorkspaceReadOwnerKeys(ctx, args.anonymousSessionId);

    for (const ownerKey of ownerKeys) {
      const workspace = await ctx.db
        .query("productEventWorkspaces")
        .withIndex("by_owner_workspace", (q) =>
          q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
        )
        .first();
      if (!workspace) continue;

      const [
        entities,
        evidence,
        claims,
        followUps,
        budgetDecisions,
        captures,
        runRecords,
      ] = await Promise.all([
        ctx.db
          .query("productEventWorkspaceEntities")
          .withIndex("by_owner_workspace", (q) =>
            q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
          )
          .collect(),
        ctx.db
          .query("productEventWorkspaceEvidence")
          .withIndex("by_owner_workspace", (q) =>
            q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
          )
          .collect(),
        ctx.db
          .query("productEventWorkspaceClaims")
          .withIndex("by_owner_workspace", (q) =>
            q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
          )
          .collect(),
        ctx.db
          .query("productEventWorkspaceFollowUps")
          .withIndex("by_owner_workspace", (q) =>
            q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
          )
          .collect(),
        ctx.db
          .query("productEventBudgetDecisions")
          .withIndex("by_owner_workspace", (q) =>
            q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
          )
          .collect(),
        ctx.db
          .query("productEventCaptures")
          .withIndex("by_owner_workspace", (q) =>
            q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
          )
          .collect(),
        ctx.db
          .query("productEventRunRecords")
          .withIndex("by_owner_workspace", (q) =>
            q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
          )
          .collect(),
      ]);

      return {
        workspace,
        entities,
        evidence,
        claims,
        followUps,
        budgetDecisions,
        captures,
        runRecords,
      };
    }

    return null;
  },
});

export const getGraphSnapshot = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    workspaceId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspaceId = normalizeKey(args.workspaceId, "workspaceId");
    const ownerKeys = await resolveEventWorkspaceReadOwnerKeys(ctx, args.anonymousSessionId);
    const limit = Math.max(25, Math.min(args.limit ?? 500, 2000));

    for (const ownerKey of ownerKeys) {
      const workspace = await ctx.db
        .query("productEventWorkspaces")
        .withIndex("by_owner_workspace", (q) =>
          q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
        )
        .first();
      if (!workspace) continue;

      const [entities, evidence, claims, followUps, captures] = await Promise.all([
        ctx.db
          .query("productEventWorkspaceEntities")
          .withIndex("by_owner_workspace", (q) =>
            q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
          )
          .take(limit),
        ctx.db
          .query("productEventWorkspaceEvidence")
          .withIndex("by_owner_workspace", (q) =>
            q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
          )
          .take(limit),
        ctx.db
          .query("productEventWorkspaceClaims")
          .withIndex("by_owner_workspace", (q) =>
            q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
          )
          .take(limit),
        ctx.db
          .query("productEventWorkspaceFollowUps")
          .withIndex("by_owner_workspace", (q) =>
            q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
          )
          .take(limit),
        ctx.db
          .query("productEventCaptures")
          .withIndex("by_owner_workspace", (q) =>
            q.eq("ownerKey", ownerKey).eq("workspaceId", workspaceId),
          )
          .take(limit),
      ]);

      const rootId = `workspace.${workspaceId}`;
      const nodes = [
        {
          id: rootId,
          label: workspace.title,
          type: "event",
          layer: "event_corpus",
          privacyScope: "event_corpus",
          confidence: 1,
          uri: `nodebench://event/${workspace.eventId}`,
          size: 18,
        },
        ...entities.map((entity: any) => ({
          id: entity.entityKey,
          label: entity.name,
          type: entity.entityType,
          layer: entity.layer,
          privacyScope: entity.layer,
          confidence: entity.confidence,
          uri: entity.uri,
          size: Math.max(8, Math.round(8 + entity.confidence * 8)),
        })),
        ...claims.map((claim: any) => ({
          id: `claim.${claim.claimKey}`,
          label: claim.claim.slice(0, 72),
          type: "claim",
          layer: "private_capture",
          privacyScope: claim.visibility,
          confidence: claim.status === "verified" ? 0.95 : 0.55,
          uri: `nodebench://claim/${claim.claimKey}`,
          status: claim.status,
          claimStatus: claim.status,
          size: 9,
        })),
        ...evidence.map((item: any) => ({
          id: `source.${item.evidenceKey}`,
          label: item.title,
          type: "source",
          layer: item.layer,
          privacyScope: item.visibility,
          confidence: item.reusable ? 0.9 : 0.6,
          uri: `nodebench://source/${item.evidenceKey}`,
          visibility: item.visibility,
          size: 7,
        })),
      ];

      const edges = [
        ...entities.map((entity: any) => ({
          id: `${rootId}->${entity.entityKey}`,
          source: rootId,
          target: entity.entityKey,
          label: entity.layer === "private_capture" ? "captured" : "contains",
          type: "MENTIONED_IN",
          confidence: entity.confidence,
        })),
        ...claims.map((claim: any) => ({
          id: `${claim.subjectEntityKey}->claim.${claim.claimKey}`,
          source: claim.subjectEntityKey,
          target: `claim.${claim.claimKey}`,
          label: claim.status.replaceAll("_", " "),
          type: "CLAIMS",
          confidence: claim.status === "verified" ? 0.95 : 0.55,
        })),
        ...claims.flatMap((claim: any) =>
          (claim.evidenceKeys ?? []).map((evidenceKey: string) => ({
            id: `claim.${claim.claimKey}->source.${evidenceKey}`,
            source: `claim.${claim.claimKey}`,
            target: `source.${evidenceKey}`,
            label: "supported by",
            type: "SUPPORTED_BY",
            confidence: claim.status === "verified" ? 0.9 : 0.5,
          })),
        ),
        ...followUps.flatMap((followUp: any) =>
          (followUp.linkedEntityKeys ?? []).map((entityKey: string) => ({
            id: `${entityKey}->followup.${followUp.followUpKey}`,
            source: entityKey,
            target: rootId,
            label: followUp.priority,
            type: "FOLLOW_UP",
            confidence: followUp.priority === "high" ? 0.85 : 0.65,
          })),
        ),
      ].filter((edge: any) =>
        nodes.some((node) => node.id === edge.source) &&
        nodes.some((node) => node.id === edge.target),
      );

      return {
        workspace,
        nodes,
        edges,
        stats: {
          nodeCount: nodes.length,
          edgeCount: edges.length,
          entityCount: entities.length,
          claimCount: claims.length,
          sourceCount: evidence.length,
          captureCount: captures.length,
        },
      };
    }

    return null;
  },
});
