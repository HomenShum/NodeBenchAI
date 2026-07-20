import { mutation, query } from "../../_generated/server";
import { v } from "convex/values";

import {
  productActivityActorTypeValidator,
  productActivityPayloadPreviewValidator,
  productActivityPrivacyScopeValidator,
  productActivityTypeValidator,
  productEventVisibilityValidator,
} from "./schema";
import {
  requireProductIdentity,
  resolveProductReadOwnerKeys,
} from "./helpers";

const MAX_KEYS = 80;
const MAX_LABEL = 180;
const MAX_DETAIL = 800;

const activityArgsValidator = {
  anonymousSessionId: v.optional(v.string()),
  reportId: v.optional(v.id("productReports")),
  workspaceId: v.optional(v.string()),
  entitySlug: v.optional(v.string()),
  eventId: v.optional(v.string()),
  activityType: productActivityTypeValidator,
  actorType: productActivityActorTypeValidator,
  visibility: v.optional(productEventVisibilityValidator),
  privacyScope: v.optional(productActivityPrivacyScopeValidator),
  entityKeys: v.optional(v.array(v.string())),
  claimKeys: v.optional(v.array(v.string())),
  sourceKeys: v.optional(v.array(v.string())),
  runId: v.optional(v.string()),
  sessionId: v.optional(v.string()),
  payloadPreview: productActivityPayloadPreviewValidator,
};

function trimString(value: string | undefined, max: number) {
  return (value ?? "").trim().slice(0, max);
}

function uniqueKeys(values: string[] | undefined) {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).slice(0, MAX_KEYS);
}

function sanitizePayloadPreview(payload: {
  label: string;
  detail?: string;
  status?: string;
  costCents?: number;
  paidCallsUsed?: number;
  searchCallsAvoided?: number;
  cacheHitRate?: number;
  sourceReuseCount?: number;
  timeToFirstSourcedAnswerMs?: number;
  href?: string;
  metadata?: any;
}) {
  return {
    label: trimString(payload.label, MAX_LABEL) || "Activity",
    ...(payload.detail ? { detail: trimString(payload.detail, MAX_DETAIL) } : {}),
    ...(payload.status ? { status: trimString(payload.status, 80) } : {}),
    ...(typeof payload.costCents === "number" ? { costCents: payload.costCents } : {}),
    ...(typeof payload.paidCallsUsed === "number" ? { paidCallsUsed: payload.paidCallsUsed } : {}),
    ...(typeof payload.searchCallsAvoided === "number" ? { searchCallsAvoided: payload.searchCallsAvoided } : {}),
    ...(typeof payload.cacheHitRate === "number" ? { cacheHitRate: payload.cacheHitRate } : {}),
    ...(typeof payload.sourceReuseCount === "number" ? { sourceReuseCount: payload.sourceReuseCount } : {}),
    ...(typeof payload.timeToFirstSourcedAnswerMs === "number"
      ? { timeToFirstSourcedAnswerMs: payload.timeToFirstSourcedAnswerMs }
      : {}),
    ...(payload.href ? { href: trimString(payload.href, 500) } : {}),
    ...(payload.metadata !== undefined ? { metadata: payload.metadata } : {}),
  };
}

export async function insertProductActivity(ctx: any, args: {
  ownerKey: string;
  reportId?: any;
  workspaceId?: string;
  entitySlug?: string;
  eventId?: string;
  activityType:
    | "report_opened"
    | "workspace_opened"
    | "chat_message"
    | "tool_call"
    | "source_attached"
    | "claim_changed"
    | "notebook_edited"
    | "notebook_patch_proposed"
    | "notebook_patch_accepted"
    | "notebook_patch_rejected"
    | "capture_recorded"
    | "graph_node_opened"
    | "graph_edge_opened"
    | "export_previewed"
    | "export_completed"
    | "search_budget_decision"
    | "cli_action"
    | "mcp_action";
  actorType: "user" | "agent" | "system" | "cli" | "mcp";
  visibility?: "private" | "team" | "tenant" | "public";
  privacyScope?: "private" | "team" | "tenant" | "public_cache" | "aggregate_anonymized";
  entityKeys?: string[];
  claimKeys?: string[];
  sourceKeys?: string[];
  runId?: string;
  sessionId?: string;
  payloadPreview: {
    label: string;
    detail?: string;
    status?: string;
    costCents?: number;
    paidCallsUsed?: number;
    searchCallsAvoided?: number;
    cacheHitRate?: number;
    sourceReuseCount?: number;
    timeToFirstSourcedAnswerMs?: number;
    href?: string;
    metadata?: any;
  };
  createdAt?: number;
}) {
  const createdAt = args.createdAt ?? Date.now();
  return ctx.db.insert("productActivityLedger", {
    ownerKey: args.ownerKey,
    ...(args.reportId ? { reportId: args.reportId } : {}),
    ...(args.workspaceId ? { workspaceId: trimString(args.workspaceId, 200) } : {}),
    ...(args.entitySlug ? { entitySlug: trimString(args.entitySlug, 200) } : {}),
    ...(args.eventId ? { eventId: trimString(args.eventId, 200) } : {}),
    activityType: args.activityType,
    actorType: args.actorType,
    visibility: args.visibility ?? "private",
    privacyScope: args.privacyScope ?? "private",
    entityKeys: uniqueKeys(args.entityKeys),
    claimKeys: uniqueKeys(args.claimKeys),
    sourceKeys: uniqueKeys(args.sourceKeys),
    ...(args.runId ? { runId: trimString(args.runId, 240) } : {}),
    ...(args.sessionId ? { sessionId: trimString(args.sessionId, 240) } : {}),
    payloadPreview: sanitizePayloadPreview(args.payloadPreview),
    createdAt,
  });
}

export const recordActivity = mutation({
  args: activityArgsValidator,
  handler: async (ctx, args) => {
    const identity = await requireProductIdentity(ctx, args.anonymousSessionId);
    const ownerKey = identity.ownerKey!;
    if (args.reportId) {
      const report = await ctx.db.get(args.reportId);
      if (!report || report.ownerKey !== ownerKey) {
        throw new Error("Report not found");
      }
    }
    const activityId = await insertProductActivity(ctx, {
      ownerKey,
      reportId: args.reportId,
      workspaceId: args.workspaceId,
      entitySlug: args.entitySlug,
      eventId: args.eventId,
      activityType: args.activityType,
      actorType: args.actorType,
      visibility: args.visibility,
      privacyScope: args.privacyScope,
      entityKeys: args.entityKeys,
      claimKeys: args.claimKeys,
      sourceKeys: args.sourceKeys,
      runId: args.runId,
      sessionId: args.sessionId,
      payloadPreview: args.payloadPreview,
    });
    return { ok: true, activityId };
  },
});

export const getReportTimeline = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    reportId: v.id("productReports"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return [];
    for (const ownerKey of ownerKeys) {
      const report = await ctx.db.get(args.reportId);
      if (!report || report.ownerKey !== ownerKey) continue;
      return ctx.db
        .query("productActivityLedger")
        .withIndex("by_owner_report_created", (q) =>
          q.eq("ownerKey", ownerKey).eq("reportId", args.reportId),
        )
        .order("desc")
        .take(Math.min(args.limit ?? 80, 200));
    }
    return [];
  },
});

export const getWorkspaceTimeline = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    workspaceId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return [];
    try {
      const rows = await Promise.all(
        ownerKeys.map((ownerKey) =>
          ctx.db
            .query("productActivityLedger")
            .withIndex("by_owner_workspace_created", (q) =>
              q.eq("ownerKey", ownerKey).eq("workspaceId", args.workspaceId),
            )
            .order("desc")
            .take(Math.min(args.limit ?? 80, 200)),
        ),
      );
      return rows
        .flat()
        .sort((left: any, right: any) => right.createdAt - left.createdAt)
        .slice(0, args.limit ?? 80);
    } catch (error) {
      console.error("[product] getWorkspaceTimeline failed", {
        workspaceId: args.workspaceId,
        error,
      });
      return [];
    }
  },
});

export const getEntityTimeline = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    entitySlug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return [];
    const rows = await Promise.all(
      ownerKeys.map((ownerKey) =>
        ctx.db
          .query("productActivityLedger")
          .withIndex("by_owner_entity_created", (q) =>
            q.eq("ownerKey", ownerKey).eq("entitySlug", args.entitySlug),
          )
          .order("desc")
          .take(Math.min(args.limit ?? 80, 200)),
      ),
    );
    return rows.flat().sort((left: any, right: any) => right.createdAt - left.createdAt).slice(0, args.limit ?? 80);
  },
});

export const getReportMetrics = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    reportId: v.id("productReports"),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return null;
    for (const ownerKey of ownerKeys) {
      const report = await ctx.db.get(args.reportId);
      if (!report || report.ownerKey !== ownerKey) continue;
      const events = await ctx.db
        .query("productActivityLedger")
        .withIndex("by_owner_report_created", (q) =>
          q.eq("ownerKey", ownerKey).eq("reportId", args.reportId),
        )
        .collect();
      const byType = events.reduce<Record<string, number>>((acc, event: any) => {
        acc[event.activityType] = (acc[event.activityType] ?? 0) + 1;
        return acc;
      }, {});
      const paidCallsUsed = events.reduce((sum: number, event: any) => sum + (event.payloadPreview?.paidCallsUsed ?? 0), 0);
      const searchesAvoided = events.reduce((sum: number, event: any) => sum + (event.payloadPreview?.searchCallsAvoided ?? 0), 0);
      const cacheEvents = events.filter((event: any) => typeof event.payloadPreview?.cacheHitRate === "number");
      const cacheHitRate =
        cacheEvents.length === 0
          ? 0
          : cacheEvents.reduce((sum: number, event: any) => sum + event.payloadPreview.cacheHitRate, 0) / cacheEvents.length;
      return {
        totalEvents: events.length,
        byType,
        paidCallsUsed,
        searchesAvoided,
        cacheHitRate,
        notebookEdits: byType.notebook_edited ?? 0,
        captures: byType.capture_recorded ?? 0,
        graphTraversals: (byType.graph_node_opened ?? 0) + (byType.graph_edge_opened ?? 0),
        exports: byType.export_completed ?? 0,
        latestActivityAt: events.reduce((max: number, event: any) => Math.max(max, event.createdAt), 0),
      };
    }
    return null;
  },
});

export const getWorkspaceMetrics = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    workspaceId: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerKeys = await resolveProductReadOwnerKeys(ctx, args.anonymousSessionId);
    if (ownerKeys.length === 0) return null;
    let events: any[];
    try {
      events = (
        await Promise.all(
          ownerKeys.map((ownerKey) =>
            ctx.db
              .query("productActivityLedger")
              .withIndex("by_owner_workspace_created", (q) =>
                q.eq("ownerKey", ownerKey).eq("workspaceId", args.workspaceId),
              )
              .collect(),
          ),
        )
      ).flat();
    } catch (error) {
      console.error("[product] getWorkspaceMetrics failed", {
        workspaceId: args.workspaceId,
        error,
      });
      return null;
    }
    const byType = events.reduce<Record<string, number>>((acc, event: any) => {
      acc[event.activityType] = (acc[event.activityType] ?? 0) + 1;
      return acc;
    }, {});
    const paidCallsUsed = events.reduce((sum: number, event: any) => sum + (event.payloadPreview?.paidCallsUsed ?? 0), 0);
    const searchesAvoided = events.reduce((sum: number, event: any) => sum + (event.payloadPreview?.searchCallsAvoided ?? 0), 0);
    const cacheEvents = events.filter((event: any) => typeof event.payloadPreview?.cacheHitRate === "number");
    const cacheHitRate =
      cacheEvents.length === 0
        ? 0
        : cacheEvents.reduce((sum: number, event: any) => sum + event.payloadPreview.cacheHitRate, 0) / cacheEvents.length;
    return {
      totalEvents: events.length,
      byType,
      paidCallsUsed,
      searchesAvoided,
      cacheHitRate,
      notebookEdits: byType.notebook_edited ?? 0,
      captures: byType.capture_recorded ?? 0,
      graphTraversals: (byType.graph_node_opened ?? 0) + (byType.graph_edge_opened ?? 0),
      exports: byType.export_completed ?? 0,
      latestActivityAt: events.reduce((max: number, event: any) => Math.max(max, event.createdAt), 0),
    };
  },
});
