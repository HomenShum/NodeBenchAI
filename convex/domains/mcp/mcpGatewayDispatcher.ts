/**
 * MCP Gateway Dispatcher — single Convex HTTP endpoint for all gateway tools.
 *
 * Validates x-mcp-secret server-side (matching core_agent_server pattern).
 * The gateway server no longer needs the admin key — only MCP_SECRET.
 *
 * Accepts: POST /api/mcpGateway { fn: string, args: Record<string, unknown> }
 * Returns: { success: true, data: <result> } or { success: false, error: <msg> }
 */

import { httpAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import {
  requireMcpSecret,
  readJson,
  ok,
  badRequest,
  serverError,
  tooManyRequests,
} from "./mcpHttpAuth";
import type { Id } from "../../_generated/dataModel";

// ── Types ───────────────────────────────────────────────────────────────────

type FnType = "query" | "mutation" | "action";

type AllowlistEntry = {
  ref: any;
  type: FnType;
  injectUserId?: boolean;
};

// ── Service user ID (Convex environment variable) ──────────────────────────

function getMcpServiceUserId(): Id<"users"> {
  const uid = process.env.MCP_SERVICE_USER_ID;
  if (!uid) {
    throw new Error(
      "MCP_SERVICE_USER_ID not set. Run: npx convex env set MCP_SERVICE_USER_ID <user_id>"
    );
  }
  return uid as Id<"users">;
}

// ── Allowlist ──────────────────────────────────────────────────────────────
// Keys = function name extracted from the Convex path (the part after ':').
// The gateway client shim extracts this from paths like "domain/module:funcName".

const ALLOWLIST: Record<string, AllowlistEntry> = {
  // ── GROUP A: Public queries — no auth needed ─────────────────────────────

  // Research (8)
  getPublicForYouFeed: {
    ref: api.domains.research.forYouFeed.getPublicForYouFeed,
    type: "query",
  },
  getLatestDashboardSnapshot: {
    ref: api.domains.research.dashboardQueries.getLatestDashboardSnapshot,
    type: "query",
  },
  getTrendingRepos: {
    ref: api.domains.research.githubExplorer.getTrendingRepos,
    type: "query",
  },
  getFastestGrowingRepos: {
    ref: api.domains.research.githubExplorer.getFastestGrowingRepos,
    type: "query",
  },
  getLatestPublicDossier: {
    ref: api.domains.research.publicDossierQueries.getLatestPublicDossier,
    type: "query",
  },
  getDealFlow: {
    ref: api.domains.research.dealFlowQueries.getDealFlow,
    type: "query",
  },
  getSignalTimeseries: {
    ref: api.domains.research.signalTimeseries.getSignalTimeseries,
    type: "query",
  },

  // Narrative — public (6)
  getPublicThreads: {
    ref: api.domains.narrative.queries.threads.getPublicThreads,
    type: "query",
  },
  getThread: {
    ref: api.domains.narrative.queries.threads.getThread,
    type: "query",
  },
  searchThreads: {
    ref: api.domains.narrative.queries.threads.searchThreads,
    type: "query",
  },
  getThreadsByEntity: {
    ref: api.domains.narrative.queries.threads.getThreadsByEntity,
    type: "query",
  },
  getThreadsWithEvents: {
    ref: api.domains.narrative.queries.threads.getThreadsWithEvents,
    type: "query",
  },
  getThreadStats: {
    ref: api.domains.narrative.queries.threads.getThreadStats,
    type: "query",
  },

  // Verification — public (3)
  getCalibrationStats: {
    ref: api.domains.verification.calibration.getCalibrationStats,
    type: "query",
  },
  getFactById: {
    ref: api.domains.verification.facts.getFactById,
    type: "query",
  },
  getSloMetricsSummary: {
    ref: api.domains.verification.calibration.getSloMetricsSummary,
    type: "query",
  },

  // Knowledge — public (8)
  searchEntityContexts: {
    ref: api.domains.knowledge.entityContexts.searchEntityContexts,
    type: "query",
  },
  getEntityContext: {
    ref: api.domains.knowledge.entityContexts.getEntityContext,
    type: "query",
  },
  getEntityContextByName: {
    ref: api.domains.knowledge.entityContexts.getEntityContextByName,
    type: "query",
  },
  listEntityContexts: {
    ref: api.domains.knowledge.entityContexts.listEntityContexts,
    type: "query",
  },
  getEntityContextStats: {
    ref: api.domains.knowledge.entityContexts.getEntityContextStats,
    type: "query",
  },
  getGraphBySource: {
    ref: api.domains.knowledge.knowledgeGraph.getGraphBySource,
    type: "query",
  },
  getGraphClaims: {
    ref: api.domains.knowledge.knowledgeGraph.getGraphClaims,
    type: "query",
  },
  getRegistryForDomain: {
    ref: api.domains.knowledge.sourceRegistry.getRegistryForDomain,
    type: "query",
  },

  // Public research memory and reusable dossiers
  resolveEntity: {
    ref: api.domains.publicResearch.core.resolveEntity,
    type: "mutation",
  },
  startResearchRun: {
    ref: api.domains.publicResearch.core.startResearchRun,
    type: "mutation",
  },
  getResearchStatus: {
    ref: api.domains.publicResearch.core.getResearchStatus,
    type: "query",
  },
  getEntityDossier: {
    ref: api.domains.publicResearch.core.getEntityDossier,
    type: "query",
  },
  getContextPack: {
    ref: api.domains.publicResearch.core.getContextPack,
    type: "query",
  },
  listLatestPublicEntityResearch: {
    ref: api.domains.publicResearch.core.listLatestPublicEntityResearch,
    type: "query",
  },
  submitPublicClaim: {
    ref: api.domains.publicResearch.core.submitPublicClaim,
    type: "mutation",
  },
  verifyClaim: {
    ref: api.domains.publicResearch.core.verifyClaim,
    type: "mutation",
  },
  linkPrivateSignalToPublicEntity: {
    ref: api.domains.publicResearch.core.linkPrivateSignalToPublicEntity,
    type: "mutation",
  },
  researchCompany: {
    ref: api.domains.publicResearch.actions.researchCompany,
    type: "action",
  },
  researchPerson: {
    ref: api.domains.publicResearch.actions.researchPerson,
    type: "action",
  },
  researchRole: {
    ref: api.domains.publicResearch.actions.researchRole,
    type: "action",
  },
  searchPublicSources: {
    ref: api.domains.publicResearch.actions.searchPublicSources,
    type: "action",
  },
  getDimensionProfile: {
    ref: api.domains.deepTrace.dimensions.getDimensionProfile,
    type: "query",
  },
  listDimensionSnapshots: {
    ref: api.domains.deepTrace.dimensions.listDimensionSnapshots,
    type: "query",
  },
  listDimensionEvidence: {
    ref: api.domains.deepTrace.dimensions.listDimensionEvidence,
    type: "query",
  },
  listDimensionInteractions: {
    ref: api.domains.deepTrace.dimensions.listDimensionInteractions,
    type: "query",
  },
  getDimensionBundle: {
    ref: api.domains.deepTrace.dimensions.getDimensionBundle,
    type: "query",
  },
  refreshDimensionProfile: {
    ref: api.domains.deepTrace.dimensions.refreshDimensionProfile,
    type: "action",
  },
  runResearchCell: {
    ref: internal.domains.deepTrace.researchCell.runResearchCell,
    type: "action",
  },
  runEntityIntelligenceMission: {
    ref: api.workflows.deepTrace.runEntityIntelligenceMission,
    type: "action",
  },

  // ── GROUP B: Internal MCP variants — need userId injection ───────────────

  // Research (1 action)
  getEntityInsights: {
    ref: internal.domains.mcp.mcpResearchEndpoints.mcpGetEntityInsights,
    type: "action",
    injectUserId: true,
  },

  // Narrative (3 queries)
  getThreadPosts: {
    ref: internal.domains.mcp.mcpNarrativeEndpoints.mcpGetThreadPosts,
    type: "query",
    injectUserId: true,
  },
  getOpenDisputes: {
    ref: internal.domains.mcp.mcpNarrativeEndpoints.mcpGetOpenDisputes,
    type: "query",
    injectUserId: true,
  },
  getContradictoryPosts: {
    ref: internal.domains.mcp.mcpNarrativeEndpoints.mcpGetContradictoryPosts,
    type: "query",
    injectUserId: true,
  },

  // Verification (4 queries)
  getVerificationSummary: {
    ref: internal.domains.mcp.mcpVerificationEndpoints.mcpGetVerificationSummary,
    type: "query",
    injectUserId: true,
  },
  getVerificationsForFact: {
    ref: internal.domains.mcp.mcpVerificationEndpoints.mcpGetVerificationsForFact,
    type: "query",
    injectUserId: true,
  },
  getArtifactsWithHealth: {
    ref: internal.domains.mcp.mcpVerificationEndpoints.mcpGetArtifactsWithHealth,
    type: "query",
    injectUserId: true,
  },
  getFactsByRun: {
    ref: internal.domains.mcp.mcpVerificationEndpoints.mcpGetFactsByRun,
    type: "query",
    injectUserId: true,
  },
  mcpStartExecutionRun: {
    ref: internal.domains.mcp.mcpExecutionTraceEndpoints.mcpStartExecutionRun,
    type: "mutation",
    injectUserId: true,
  },

  // ── GROUP C: Document internal endpoints — already accept userId ─────────

  mcpCreateDocument: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpCreateDocument,
    type: "mutation",
    injectUserId: true,
  },
  mcpGetDocument: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpGetDocument,
    type: "query",
  },
  mcpUpdateDocument: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpUpdateDocument,
    type: "mutation",
    injectUserId: true,
  },
  mcpArchiveDocument: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpArchiveDocument,
    type: "mutation",
    injectUserId: true,
  },
  mcpRestoreDocument: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpRestoreDocument,
    type: "mutation",
    injectUserId: true,
  },
  mcpToggleFavorite: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpToggleFavorite,
    type: "mutation",
    injectUserId: true,
  },
  mcpDuplicateDocument: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpDuplicateDocument,
    type: "mutation",
    injectUserId: true,
  },
  mcpSearchDocuments: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpSearchDocuments,
    type: "query",
    injectUserId: true,
  },
  mcpListDocuments: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpListDocuments,
    type: "query",
    injectUserId: true,
  },
  mcpExportToMarkdown: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpExportToMarkdown,
    type: "query",
    injectUserId: true,
  },
  mcpCreateFolder: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpCreateFolder,
    type: "mutation",
    injectUserId: true,
  },
  mcpListFolders: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpListFolders,
    type: "query",
    injectUserId: true,
  },
  mcpGetFolderWithDocuments: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpGetFolderWithDocuments,
    type: "query",
    injectUserId: true,
  },
  mcpAddDocumentToFolder: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpAddDocumentToFolder,
    type: "mutation",
    injectUserId: true,
  },
  mcpRemoveDocumentFromFolder: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpRemoveDocumentFromFolder,
    type: "mutation",
    injectUserId: true,
  },
  mcpCreateSpreadsheet: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpCreateSpreadsheet,
    type: "mutation",
    injectUserId: true,
  },
  mcpListSpreadsheets: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpListSpreadsheets,
    type: "query",
    injectUserId: true,
  },
  mcpGetSpreadsheetRange: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpGetSpreadsheetRange,
    type: "query",
  },
  mcpApplySpreadsheetOperations: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpApplySpreadsheetOperations,
    type: "mutation",
    injectUserId: true,
  },
  mcpListFiles: {
    ref: internal.domains.documents.mcpDocumentEndpoints.mcpListFiles,
    type: "query",
    injectUserId: true,
  },
  updateSessionStatus: {
    ref: api.domains.operations.taskManager.mutations.updateSessionStatus,
    type: "mutation",
  },
  updateSessionMetrics: {
    ref: api.domains.operations.taskManager.mutations.updateSessionMetrics,
    type: "mutation",
  },
  completeTrace: {
    ref: api.domains.operations.taskManager.mutations.completeTrace,
    type: "mutation",
  },
  recordStep: {
    ref: api.domains.operations.taskManager.mutations.recordStep,
    type: "mutation",
  },
  recordDecision: {
    ref: api.domains.operations.taskManager.mutations.recordDecision,
    type: "mutation",
  },
  recordVerification: {
    ref: api.domains.operations.taskManager.mutations.recordVerification,
    type: "mutation",
  },
  attachEvidence: {
    ref: api.domains.operations.taskManager.mutations.attachEvidence,
    type: "mutation",
  },
  requestTraceApproval: {
    ref: api.domains.operations.taskManager.mutations.requestTraceApproval,
    type: "mutation",
  },

  // ── GROUP D: Agent Planning ─────────────────────────────────────────────────

  createPlan: {
    ref: internal.domains.mcp.mcpPlans.createPlan,
    type: "mutation",
  },
  getPlan: {
    ref: internal.domains.mcp.mcpPlans.getPlan,
    type: "query",
  },
  updatePlan: {
    ref: internal.domains.mcp.mcpPlans.updatePlan,
    type: "mutation",
  },
  listPlans: {
    ref: internal.domains.mcp.mcpPlans.listPlans,
    type: "query",
  },
  deletePlan: {
    ref: internal.domains.mcp.mcpPlans.deletePlan,
    type: "mutation",
  },

  // ── GROUP E: Agent Memory ───────────────────────────────────────────────────

  writeMemory: {
    ref: internal.domains.mcp.mcpMemory.writeMemory,
    type: "mutation",
  },
  readMemory: {
    ref: internal.domains.mcp.mcpMemory.readMemory,
    type: "query",
  },
  listMemory: {
    ref: internal.domains.mcp.mcpMemory.listMemory,
    type: "query",
  },
  deleteMemory: {
    ref: internal.domains.mcp.mcpMemory.deleteMemory,
    type: "mutation",
  },
  getMemoryById: {
    ref: internal.domains.mcp.mcpMemory.getMemoryById,
    type: "query",
  },
  deleteMemoryById: {
    ref: internal.domains.mcp.mcpMemory.deleteMemoryById,
    type: "mutation",
  },

  // ── GROUP F: Search / Research ──────────────────────────────────────────────

  quickSearch: {
    ref: api.domains.search.fusion.actions.quickSearch,
    type: "action",
  },
  fusionSearch: {
    ref: api.domains.search.fusion.actions.fusionSearch,
    type: "action",
  },
  getMigrationStats: {
    ref: api.domains.agents.mcp_tools.models.migration.getMigrationStats,
    type: "query",
  },

  // ── GROUP G: OpenClaw (sandboxed agent orchestration) ─────────────────────

  createOpenClawSession: {
    ref: internal.domains.openclaw.sessionManager.create,
    type: "mutation",
    injectUserId: true,
  },
  getOpenClawSessions: {
    ref: internal.domains.openclaw.monitoring.listSessions,
    type: "query",
    injectUserId: true,
  },
  getOpenClawMetrics: {
    ref: internal.domains.openclaw.monitoring.getMetrics,
    type: "query",
    injectUserId: true,
  },

  // ── GROUP H: Forecasting OS ─────────────────────────────────────────────

  createForecast: {
    ref: internal.domains.forecasting.actions.createForecast.createForecastAction,
    type: "action",
    injectUserId: true,
  },
  getActiveForecasts: {
    ref: internal.domains.forecasting.forecastManager.getActiveForecastsForRefresh,
    type: "query",
  },
  getTopForecastsForLinkedIn: {
    ref: internal.domains.forecasting.forecastManager.getTopForecastsForLinkedIn,
    type: "query",
  },
  getUserTrackRecord: {
    ref: internal.domains.forecasting.forecastManager.getUserTrackRecord,
    type: "query",
    injectUserId: true,
  },

  // ── GROUP I: WebMCP (origin allowlist + tool inventory) ─────────────────
  approveWebMcpOrigin: {
    ref: api.domains.mcp.webmcpOriginManager.approveOrigin,
    type: "mutation",
  },
  revokeWebMcpOrigin: {
    ref: api.domains.mcp.webmcpOriginManager.revokeOrigin,
    type: "mutation",
  },
  listWebMcpOrigins: {
    ref: api.domains.mcp.webmcpOriginManager.listApprovedOrigins,
    type: "query",
  },
  getWebMcpOriginTools: {
    ref: api.domains.mcp.webmcpOriginManager.getOriginTools,
    type: "query",
  },
  updateWebMcpToolCache: {
    ref: internal.domains.mcp.webmcpOriginManager.updateOriginToolCache,
    type: "mutation",
  },

  // ── INTERNAL CONTROL: tool call ledger hooks (used by the gateway service for "direct" tools) ──
  // Keys beginning with "__mcp" are excluded from automatic ledger logging.
  __mcpToolCallStart: {
    ref: internal.domains.mcp.mcpToolLedger.startToolCallInternal,
    type: "mutation",
  },
  __mcpToolCallFinish: {
    ref: internal.domains.mcp.mcpToolLedger.finishToolCallInternal,
    type: "mutation",
  },
};

// ── Dispatcher httpAction ──────────────────────────────────────────────────

function inferRiskTier(fn: string, type: FnType): string {
  // Deterministic default policy:
  // - queries are read-only
  // - actions are external-read (network + spend)
  // - mutations are internal writes
  // - deletes are destructive (tighter budgets)
  const lower = fn.toLowerCase();
  if (lower.startsWith("delete")) return "destructive";
  if (type === "mutation") return "write_internal";
  if (type === "action") return "external_read";
  if (type === "query") return "read_only";
  return "unknown";
}

export const mcpGatewayHandler = httpAction(async (ctx, request) => {
  // 1. Auth — validate x-mcp-secret
  const authErr = requireMcpSecret(request);
  if (authErr) return authErr;

  // 2. Parse request body
  const body = await readJson(request);
  if (!body || typeof body.fn !== "string") {
    return badRequest(
      'Request body must be JSON: { "fn": "<toolName>", "args": { ... } }'
    );
  }

  const fn: string = body.fn;
  const args: Record<string, unknown> = body.args ?? {};
  const meta: Record<string, unknown> =
    body && typeof body.meta === "object" && body.meta ? body.meta : {};

  // 3. Lookup in allowlist
  const entry = ALLOWLIST[fn];
  if (!entry) {
    const available = Object.keys(ALLOWLIST).sort().join(", ");
    return badRequest(
      `Unknown function: "${fn}". ${Object.keys(ALLOWLIST).length} available: ${available}`
    );
  }

  // 4. Policy + ledger (trusted access layer)
  // Skip internal control functions so we don't create "logs that log themselves".
  const skipLedger = fn.startsWith("__mcp");
  const riskTier = inferRiskTier(fn, entry.type);
  const idempotencyKey =
    typeof (meta as any)?.idempotencyKey === "string"
      ? String((meta as any).idempotencyKey)
      : undefined;

  let ledgerCallId: Id<"mcpToolCallLedger"> | null = null;
  if (!skipLedger) {
    try {
      const start: any = await ctx.runMutation(
        internal.domains.mcp.mcpToolLedger.startToolCallInternal,
        {
          toolName: fn,
          toolType: entry.type,
          riskTier,
          args,
          idempotencyKey,
          requestMeta: {
            ...meta,
            userAgent: request.headers.get("user-agent") ?? undefined,
            forwardedFor: request.headers.get("x-forwarded-for") ?? undefined,
          },
        }
      );

      ledgerCallId = start.callId as Id<"mcpToolCallLedger">;
      if (!start.allowed) {
        const policy = start.policy;
        const blockedByDenylist = Boolean(policy?.denylist?.blockedByDenylist);
        const wouldExceed = Boolean(policy?.budgets?.wouldExceed);

        if (blockedByDenylist) {
          return badRequest(`Tool blocked by policy: "${fn}"`, {
            callId: ledgerCallId,
            policy,
          });
        }
        if (wouldExceed) {
          return tooManyRequests(`Tool budget exceeded: "${fn}"`, {
            callId: ledgerCallId,
            policy,
          });
        }
        return badRequest(`Tool blocked by policy: "${fn}"`, {
          callId: ledgerCallId,
          policy,
        });
      }
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mcpGateway] Failed to start ledger for ${fn}:`, message);
      return serverError(`Ledger start failed: ${message}`);
    }
  }

  // 5. Inject userId if needed
  const finalArgs = entry.injectUserId
    ? { ...args, userId: getMcpServiceUserId() }
    : { ...args };

  // 6. Dispatch
  const t0 = Date.now();
  try {
    let result: unknown;
    switch (entry.type) {
      case "query":
        result = await ctx.runQuery(entry.ref, finalArgs);
        break;
      case "mutation":
        result = await ctx.runMutation(entry.ref, finalArgs);
        break;
      case "action":
        result = await ctx.runAction(entry.ref, finalArgs);
        break;
    }

    const durationMs = Math.max(0, Date.now() - t0);
    if (ledgerCallId) {
      try {
        await ctx.runMutation(internal.domains.mcp.mcpToolLedger.finishToolCallInternal, {
          callId: ledgerCallId,
          success: true,
          durationMs,
          result,
        });
      } catch (e: any) {
        console.error(
          `[mcpGateway] Failed to finish ledger for ${fn}:`,
          e?.message ?? String(e)
        );
      }
    }

    return ok({ success: true, data: result });
  } catch (err: any) {
    const durationMs = Math.max(0, Date.now() - t0);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mcpGateway] Error dispatching ${fn}:`, message);

    if (ledgerCallId) {
      try {
        await ctx.runMutation(internal.domains.mcp.mcpToolLedger.finishToolCallInternal, {
          callId: ledgerCallId,
          success: false,
          durationMs,
          errorMessage: message,
        });
      } catch (e: any) {
        console.error(
          `[mcpGateway] Failed to finish ledger (error) for ${fn}:`,
          e?.message ?? String(e)
        );
      }
    }

    return serverError(message);
  }
});

// ── CORS preflight handler ─────────────────────────────────────────────────

export const mcpGatewayCorsHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-mcp-secret",
    },
  });
});
