/**
 * diligenceProjections — Convex query + mutation contract for projections
 * emitted by the orchestrator's structuring pass.
 *
 * Pattern: scratchpad-first → structure → deterministic merge (agent_pipeline)
 *
 * Prior art:
 *   - Anthropic "Building Effective Agents" (orchestrator-workers + merge)
 *   - Manus AI (structured output derived from virtual workspace)
 *   - Cognition Devin (structured notes from raw markdown session)
 *
 * See: .claude/rules/scratchpad_first.md
 *      .claude/rules/orchestrator_workers.md
 *      .claude/rules/agentic_reliability.md  (BOUND, DETERMINISTIC)
 *      docs/architecture/AGENT_PIPELINE.md
 *      convex/schema.ts → diligenceProjections table
 *
 * Scope:
 *   - query surface that `useDiligenceBlocks` reads from
 *   - projection upsert contract for the generic structuring pass
 *   - notebook-side materialization + refresh rerun entrypoints so overlays
 *     can converge on server rows instead of living forever in the client
 *     fallback path
 *
 * Invariants (enforced):
 *   BOUND         — listForEntity caps results at MAX_PROJECTIONS_PER_ENTITY
 *   HONEST_STATUS — upsert returns { status: "created" | "updated" | "stale" }
 *                   rather than silently 201-ing when version drifted
 *   DETERMINISTIC — (entitySlug, blockType, scratchpadRunId) is the dedupe key
 */

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { MutationCtx } from "../../_generated/server";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "../../_generated/server";
import {
  requireEntityWorkspaceWriteAccessBySlug,
  resolveEntityWorkspaceAccess,
} from "./helpers";
import {
  buildGenericDiligenceProjectionDrafts,
  buildScratchpadMarkdownForDrafts,
  buildScratchpadStructuredProjectionDrafts,
  syncGenericDiligenceProjectionDrafts,
} from "./diligenceProjectionRuntime";
import { structureScratchpadCheckpoint } from "./diligenceCheckpointStructuring";
import {
  emitDiligenceProjectionInstrumented,
  type EmitProjectionArgs,
  type EmitProjectionResult,
} from "../../../server/pipeline/diligenceProjectionWriter";
import {
  classifyError,
  fingerprintFailure,
  normalizeMessageStem,
} from "../../../server/pipeline/retryPolicy";
import { judgeDiligenceRun } from "../../../server/pipeline/diligenceJudge";

const DILIGENCE_BLOCK_TYPE_VALIDATOR = v.union(
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
);

const SCRATCHPAD_STATUS_VALIDATOR = v.union(
  v.literal("streaming"),
  v.literal("structuring"),
  v.literal("merged"),
  v.literal("failed"),
);

const OVERLAY_WORKFLOW_TYPE = "product_diligence_overlay";

type ProjectionRunReportPayload = {
  entitySlug: string;
  title: string;
  primaryEntity?: string;
  sections: Array<{
    id: string;
    title: string;
    body: string;
    sourceRefIds?: string[];
  }>;
  sources: Array<{
    id: string;
    label: string;
    href?: string;
    domain?: string;
    title?: string;
    siteName?: string;
  }>;
  updatedAt: number;
  revision?: number;
};

type StartRunReason = "materialize" | "refresh" | "session_complete";

function buildOverlayRunWorkflowId(args: {
  entityId: string;
  entitySlug: string;
  reason: StartRunReason;
  targetBlockType?: string;
}) {
  const nonce = Array.from(crypto.getRandomValues(new Uint32Array(2)))
    .map((value) => value.toString(36))
    .join("");
  return `scratchpad:${args.entitySlug}:${args.entityId}:${Date.now()}:${args.reason}:${args.targetBlockType ?? "all"}:${nonce}`;
}

function buildOverlayRunIdempotencyKey(args: {
  ownerKey: string;
  entitySlug: string;
  reportUpdatedAt: number;
  targetBlockType?: string;
}) {
  return `overlay:${args.ownerKey}:${args.entitySlug}:${args.reportUpdatedAt}:${args.targetBlockType ?? "all"}`;
}

function buildCheckpointId(workflowId: string, checkpointNumber: number) {
  return `${workflowId}:checkpoint:${checkpointNumber}`;
}

async function loadLatestReportForEntity(
  ctx: MutationCtx,
  args: { ownerKey: string; entitySlug: string },
) {
  return await ctx.db
    .query("productReports")
    .withIndex("by_owner_entity_updated", (q) =>
      q.eq("ownerKey", args.ownerKey).eq("entitySlug", args.entitySlug),
    )
    .order("desc")
    .first();
}

async function materializeEntityDiligenceProjections(
  ctx: MutationCtx,
  args: { ownerKey: string; entitySlug: string },
) {
  const report = await loadLatestReportForEntity(ctx, args);
  if (!report) {
    return {
      status: "noop" as const,
      reason: "missing-report",
      total: 0,
      created: 0,
      updated: 0,
      stale: 0,
      deleted: 0,
    };
  }
  if (!report.entityId) {
    return {
      status: "noop" as const,
      reason: "missing-entity",
      total: 0,
      created: 0,
      updated: 0,
      stale: 0,
      deleted: 0,
    };
  }

  const drafts = buildGenericDiligenceProjectionDrafts({
    entitySlug: report.entitySlug,
    title: report.title,
    primaryEntity: report.primaryEntity,
    sections: report.sections,
    sources: report.sources,
    updatedAt: report.updatedAt,
    revision: report.revision,
  });

  const synced = await syncGenericDiligenceProjectionDrafts(ctx, {
    ownerKey: args.ownerKey,
    entityId: report.entityId,
    entitySlug: args.entitySlug,
    drafts,
  });
  return { ...synced, reportId: report._id, reportUpdatedAt: report.updatedAt };
}

export const clearScratchpadProjectionRowsForEntity = internalMutation({
  args: {
    ownerKey: v.string(),
    entityId: v.id("productEntities"),
    entitySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("diligenceProjections")
      .withIndex("by_owner_entity", (q) =>
        q.eq("ownerKey", args.ownerKey).eq("entityId", args.entityId),
      )
      .collect();

    let deleted = 0;
    for (const row of rows) {
      if (
        row.producerAssurance !== "internal_structuring_v1" ||
        row.entitySlug !== args.entitySlug
      ) {
        continue;
      }
      if (!row.scratchpadRunId.startsWith(`scratchpad:${args.entitySlug}:`))
        continue;
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    return { deleted };
  },
});

export const runScratchpadProjectionPass = internalAction({
  args: {
    ownerKey: v.string(),
    entityId: v.id("productEntities"),
    report: v.object({
      entitySlug: v.string(),
      title: v.string(),
      primaryEntity: v.optional(v.string()),
      sections: v.array(
        v.object({
          id: v.string(),
          title: v.string(),
          body: v.string(),
          sourceRefIds: v.optional(v.array(v.string())),
        }),
      ),
      sources: v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          href: v.optional(v.string()),
          domain: v.optional(v.string()),
          title: v.optional(v.string()),
          siteName: v.optional(v.string()),
        }),
      ),
      updatedAt: v.number(),
      revision: v.optional(v.number()),
    }),
    workflowId: v.string(),
    reason: v.union(
      v.literal("materialize"),
      v.literal("refresh"),
      v.literal("session_complete"),
    ),
    targetBlockType: v.optional(DILIGENCE_BLOCK_TYPE_VALIDATOR),
    userId: v.optional(v.id("users")),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const report = args.report as ProjectionRunReportPayload;
    const allBaseDrafts = buildScratchpadStructuredProjectionDrafts(
      report,
      args.workflowId,
    );
    const drafts =
      args.targetBlockType == null
        ? allBaseDrafts
        : [
            ...allBaseDrafts.filter(
              (draft) => draft.blockType === args.targetBlockType,
            ),
            ...allBaseDrafts.filter(
              (draft) => draft.blockType !== args.targetBlockType,
            ),
          ];

    if (drafts.length === 0) {
      return {
        status: "noop" as const,
        reason: "no-drafts",
        runId: args.workflowId,
      };
    }

    const saveScratchpad = async (input: {
      status: "streaming" | "structuring" | "merged" | "failed";
      checkpointNumber: number;
      renderedDrafts: typeof drafts;
      latestBlockType?: string;
      latestHeaderText?: string;
      failureReason?: string;
      currentStep?: string;
    }) =>
      ctx.runMutation(
        internal.domains.product.diligenceScratchpads.upsertScratchpadRun,
        {
          runId: args.workflowId,
          ownerKey: args.ownerKey,
          entityId: args.entityId,
          entitySlug: report.entitySlug,
          userId: args.userId,
          markdownSource: buildScratchpadMarkdownForDrafts({
            entitySlug: report.entitySlug,
            entityName: report.primaryEntity ?? report.title,
            scratchpadBaseRunId: args.workflowId,
            status: input.status,
            currentStep: input.currentStep,
            failureReason: input.failureReason,
            drafts: input.renderedDrafts,
          }),
          status: input.status,
          mode: "live",
          idempotencyKey: args.idempotencyKey,
          checkpointNumber: input.checkpointNumber,
          latestBlockType: input.latestBlockType,
          latestHeaderText: input.latestHeaderText,
          failureReason: input.failureReason,
        },
      );

    const saveCheckpoint = async (input: {
      checkpointNumber: number;
      currentStep: string;
      progress: number;
      status: "active" | "completed" | "error";
      latestBlockType?: string;
      latestHeaderText?: string;
      error?: string;
    }) =>
      ctx.runMutation(internal.domains.agents.checkpointing.saveCheckpoint, {
        checkpoint: {
          workflowId: args.workflowId,
          checkpointId: buildCheckpointId(
            args.workflowId,
            input.checkpointNumber,
          ),
          checkpointNumber: input.checkpointNumber,
          parentCheckpointId:
            input.checkpointNumber > 0
              ? buildCheckpointId(args.workflowId, input.checkpointNumber - 1)
              : undefined,
          workflowType: OVERLAY_WORKFLOW_TYPE,
          workflowName: `Notebook overlay: ${report.primaryEntity ?? report.entitySlug}`,
          userId: args.userId ? String(args.userId) : undefined,
          currentStep: input.currentStep,
          status: input.status,
          progress: input.progress,
          state: {
            entitySlug: report.entitySlug,
            reason: args.reason,
            targetBlockType: args.targetBlockType ?? null,
            latestBlockType: input.latestBlockType ?? null,
            latestHeaderText: input.latestHeaderText ?? null,
            completedBlocks: Math.min(input.checkpointNumber, drafts.length),
            totalBlocks: drafts.length,
          },
          createdAt: Date.now(),
          error: input.error,
        },
      });

    try {
      await ctx.runMutation(
        internal.domains.product.diligenceProjections
          .clearScratchpadProjectionRowsForEntity,
        {
          ownerKey: args.ownerKey,
          entityId: args.entityId,
          entitySlug: report.entitySlug,
        },
      );

      await saveScratchpad({
        status: "streaming",
        checkpointNumber: 0,
        renderedDrafts: [],
        currentStep: "initialized",
      });
      await saveCheckpoint({
        checkpointNumber: 0,
        currentStep: "initialized",
        progress: 0,
        status: "active",
      });

      const structuredDrafts: typeof drafts = [];

      for (let index = 0; index < drafts.length; index += 1) {
        const baseDraft = drafts[index]!;
        const checkpointNumber = index + 1;
        const draftContext = [...structuredDrafts, baseDraft];
        const progress = Math.max(
          1,
          Math.round((checkpointNumber / drafts.length) * 100),
        );
        const currentStep = `checkpoint:${baseDraft.blockType}`;

        await saveScratchpad({
          status:
            checkpointNumber === drafts.length ? "structuring" : "streaming",
          checkpointNumber,
          renderedDrafts: draftContext,
          latestBlockType: baseDraft.blockType,
          latestHeaderText: baseDraft.headerText,
          currentStep,
        });
        await saveCheckpoint({
          checkpointNumber,
          currentStep,
          progress,
          status: "active",
          latestBlockType: baseDraft.blockType,
          latestHeaderText: baseDraft.headerText,
        });

        const scratchpadMarkdown = buildScratchpadMarkdownForDrafts({
          entitySlug: report.entitySlug,
          entityName: report.primaryEntity ?? report.title,
          scratchpadBaseRunId: args.workflowId,
          status:
            checkpointNumber === drafts.length ? "structuring" : "streaming",
          currentStep,
          drafts: draftContext,
        });

        const structuring = await structureScratchpadCheckpoint({
          entitySlug: report.entitySlug,
          entityName: report.primaryEntity ?? report.title,
          scratchpadMarkdown,
          checkpointNumber,
          checkpointStep: currentStep,
          draft: baseDraft,
          reportSources: report.sources,
        });
        const draft = structuring.draft;
        structuredDrafts.push(draft);

        const outcome = await emitDiligenceProjectionInstrumented(
          async (emitArgs) =>
            await ctx.runMutation(
              internal.domains.product.diligenceProjections
                .upsertFromStructuringPass,
              {
                ...emitArgs,
                ownerKey: args.ownerKey,
                entityId: args.entityId,
                producerRunId: args.workflowId,
              },
            ),
          draft,
          {
            seedTelemetry: {
              toolCalls: structuring.telemetry.toolCalls,
              tokensIn: structuring.telemetry.tokensIn,
              tokensOut: structuring.telemetry.tokensOut,
              sourceCount: structuring.telemetry.sourceCount,
            },
          },
        );

        const emitStatus = outcome.ok ? outcome.result.status : "error";
        const telemetryResult = await ctx.runMutation(
          internal.domains.product.diligenceRunTelemetry.recordTelemetry,
          {
            ownerKey: args.ownerKey,
            entityId: args.entityId,
            entitySlug: draft.entitySlug,
            blockType: draft.blockType,
            scratchpadRunId: draft.scratchpadRunId,
            version: draft.version,
            overallTier: draft.overallTier,
            headerText: draft.headerText,
            status: emitStatus,
            startedAt: outcome.telemetry.startedAt,
            endedAt: outcome.telemetry.endedAt,
            toolCalls: outcome.telemetry.toolCalls,
            tokensIn: outcome.telemetry.tokensIn,
            tokensOut: outcome.telemetry.tokensOut,
            sourceCount: outcome.telemetry.sourceCount,
            errorMessage: outcome.telemetry.errorMessage,
          },
        );

        // Async reliability (async_reliability.md §4): on emit failure,
        // fingerprint + upsert a DLQ row. Grouping by fingerprint means
        // 100 instances of the same bug appear as ONE triage row — not
        // 100. HONEST_STATUS: the failure is visible; ERROR_BOUNDARY:
        // we swallow DLQ write errors so the main pipeline loop stays up.
        if (!outcome.ok && outcome.telemetry.errorMessage) {
          try {
            const errorMessage = outcome.telemetry.errorMessage;
            const errorClass = classifyError({
              kind: "thrown",
              message: errorMessage,
            });
            const messageStem = normalizeMessageStem(errorMessage);
            const fingerprint = fingerprintFailure({
              errorClass,
              source: "orchestrator",
              messageStem,
            });
            await ctx.runMutation(
              internal.domains.product.pipelineReliability.recordDeadLetter,
              {
                fingerprint,
                errorClass,
                source: "orchestrator",
                messageStem,
                sampleEntitySlug: draft.entitySlug,
                sampleScratchpadRunId: draft.scratchpadRunId,
                sampleErrorJson: JSON.stringify({
                  blockType: draft.blockType,
                  version: draft.version,
                  errorMessage: errorMessage.slice(0, 480),
                }),
              },
            );
          } catch {
            // Swallow — DLQ write failure never kills the structuring pass.
          }
        }

        const verdict = judgeDiligenceRun({
          args: draft as EmitProjectionArgs,
          result: outcome.ok
            ? (outcome.result as EmitProjectionResult)
            : undefined,
          telemetry: outcome.telemetry,
        });

        await ctx.runMutation(
          internal.domains.product.diligenceJudge.recordVerdict,
          {
            ownerKey: args.ownerKey,
            entityId: args.entityId,
            telemetryId: telemetryResult.id,
            entitySlug: draft.entitySlug,
            blockType: draft.blockType,
            scratchpadRunId: draft.scratchpadRunId,
            verdict: verdict.verdict,
            passCount: verdict.passCount,
            failCount: verdict.failCount,
            skipCount: verdict.skipCount,
            score: verdict.score,
            latencyBudgetMs: verdict.latencyBudgetMs,
            gatesJson: JSON.stringify(verdict.gates),
          },
        );

        // Do not compact tenant-bound projection output into entityMemory yet.
        // The legacy memory tables are keyed only by entitySlug, so two owners
        // with the same slug would otherwise share facts. Re-enable this only
        // after entityTopicFiles/entityMemoryIndex carry ownerKey + entityId.
      }

      await saveScratchpad({
        status: "merged",
        checkpointNumber: drafts.length + 1,
        renderedDrafts: structuredDrafts,
        currentStep: "completed",
      });
      await saveCheckpoint({
        checkpointNumber: drafts.length + 1,
        currentStep: "completed",
        progress: 100,
        status: "completed",
      });
      return {
        status: "completed" as const,
        runId: args.workflowId,
        emittedBlocks: drafts.length,
        startedAt: now,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await saveScratchpad({
        status: "failed",
        checkpointNumber: drafts.length + 1,
        renderedDrafts: drafts,
        currentStep: "failed",
        failureReason: detail,
      });
      await saveCheckpoint({
        checkpointNumber: drafts.length + 1,
        currentStep: "failed",
        progress: 100,
        status: "error",
        error: detail,
      });
      throw error;
    }
  },
});

/**
 * Cap on how many projection rows the client reads per entity. Each block
 * is ~1 row per run, so 50 gives plenty of history while preventing unbounded
 * reads (BOUND rule).
 */
const MAX_PROJECTIONS_PER_ENTITY = 50;

/**
 * List the most recent projection per (blockType, scratchpadRunId) for the
 * given entity. Sorted by updatedAt desc so the newest projections come first.
 *
 * Phase 1 behavior: returns [] until the orchestrator writes rows. Clients
 * already gracefully fall back to the snapshot-derived projections in
 * useDiligenceBlocks.ts.
 */
export const listForEntity = query({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await resolveEntityWorkspaceAccess(ctx, args);
    if (!access) return [];
    const rows = await ctx.db
      .query("diligenceProjections")
      .withIndex("by_owner_entity_updated", (q) =>
        q
          .eq("ownerKey", access.entity.ownerKey)
          .eq("entityId", access.entity._id),
      )
      .order("desc")
      .take(MAX_PROJECTIONS_PER_ENTITY);

    // Deduplicate on (blockType, scratchpadRunId) — keep highest version.
    // Deterministic: same input set always yields same output order.
    const dedupKey = (row: (typeof rows)[number]) =>
      `${row.blockType}:${row.scratchpadRunId}`;
    const winners = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = dedupKey(row);
      const prior = winners.get(key);
      if (!prior || row.version > prior.version) {
        winners.set(key, row);
      }
    }

    return Array.from(winners.values())
      .filter(
        (row) =>
          (row.producerAssurance === "internal_structuring_v1" ||
            row.producerAssurance === "internal_canonical_v1") &&
          row.ownerKey === access.entity.ownerKey &&
          row.entityId === access.entity._id,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((row) => ({
        entitySlug: row.entitySlug,
        blockType: row.blockType,
        scratchpadRunId: row.scratchpadRunId,
        version: row.version,
        overallTier: row.overallTier,
        headerText: row.headerText,
        bodyProse: row.bodyProse,
        sourceRefIds: row.sourceRefIds,
        sourceCount: row.sourceCount,
        sourceLabel: row.sourceLabel,
        sourceTokens: row.sourceTokens,
        payload: row.payload,
        sourceSectionId: row.sourceSectionId,
        updatedAt: row.updatedAt,
      }));
  },
});

/**
 * Upsert a projection from the structuring pass. Called by the orchestrator
 * runtime after each block's structuring LLM call completes.
 *
 * HONEST_STATUS:
 *   - returns { status: "created" } when no prior row existed
 *   - returns { status: "updated" } when the new version is higher than existing
 *   - returns { status: "stale", currentVersion } when the incoming version
 *     is <= the stored version. The orchestrator treats stale as "we've
 *     already processed a later run; discard this projection"
 *
 * DETERMINISTIC:
 *   Dedup key is (entitySlug, blockType, scratchpadRunId). Same input always
 *   produces the same result, even if the orchestrator retries.
 */
export const upsertFromStructuringPass = internalMutation({
  args: {
    ownerKey: v.string(),
    entityId: v.id("productEntities"),
    producerRunId: v.string(),
    entitySlug: v.string(),
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
    scratchpadRunId: v.string(),
    version: v.number(),
    overallTier: v.union(
      v.literal("verified"),
      v.literal("corroborated"),
      v.literal("single-source"),
      v.literal("unverified"),
    ),
    headerText: v.string(),
    bodyProse: v.optional(v.string()),
    sourceRefIds: v.optional(v.array(v.string())),
    sourceCount: v.optional(v.number()),
    sourceLabel: v.optional(v.string()),
    sourceTokens: v.optional(v.array(v.string())),
    payload: v.optional(v.any()),
    sourceSectionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [entity, scratchpad] = await Promise.all([
      ctx.db.get(args.entityId),
      ctx.db
        .query("agentScratchpads")
        .withIndex("by_agent_thread", (q) =>
          q.eq("agentThreadId", args.producerRunId),
        )
        .first(),
    ]);
    if (
      !entity ||
      !scratchpad ||
      entity.ownerKey !== args.ownerKey ||
      entity.slug !== args.entitySlug ||
      scratchpad.entitySlug !== args.entitySlug ||
      scratchpad.ownerKey !== args.ownerKey ||
      scratchpad.entityId !== args.entityId ||
      !args.scratchpadRunId.startsWith(`${args.producerRunId}:`)
    ) {
      throw new Error(
        "Trusted diligence projection producer context is invalid",
      );
    }
    const existing = await ctx.db
      .query("diligenceProjections")
      .withIndex("by_owner_entity_block_run", (q) =>
        q
          .eq("ownerKey", args.ownerKey)
          .eq("entityId", args.entityId)
          .eq("blockType", args.blockType)
          .eq("scratchpadRunId", args.scratchpadRunId),
      )
      .first();

    const now = Date.now();

    if (!existing) {
      await ctx.db.insert("diligenceProjections", {
        entitySlug: args.entitySlug,
        ownerKey: args.ownerKey,
        entityId: args.entityId,
        producerScratchpadId: scratchpad._id,
        producerAssurance: "internal_structuring_v1",
        blockType: args.blockType,
        scratchpadRunId: args.scratchpadRunId,
        version: args.version,
        overallTier: args.overallTier,
        headerText: args.headerText,
        bodyProse: args.bodyProse,
        sourceRefIds: args.sourceRefIds,
        sourceCount: args.sourceCount,
        sourceLabel: args.sourceLabel,
        sourceTokens: args.sourceTokens,
        payload: args.payload,
        sourceSectionId: args.sourceSectionId,
        updatedAt: now,
      });
      return { status: "created" as const };
    }

    if (args.version <= existing.version) {
      return {
        status: "stale" as const,
        currentVersion: existing.version,
      };
    }

    await ctx.db.patch(existing._id, {
      ownerKey: args.ownerKey,
      entityId: args.entityId,
      producerScratchpadId: scratchpad._id,
      producerAssurance: "internal_structuring_v1",
      version: args.version,
      overallTier: args.overallTier,
      headerText: args.headerText,
      bodyProse: args.bodyProse,
      sourceRefIds: args.sourceRefIds,
      sourceCount: args.sourceCount,
      sourceLabel: args.sourceLabel,
      sourceTokens: args.sourceTokens,
      payload: args.payload,
      sourceSectionId: args.sourceSectionId,
      updatedAt: now,
    });
    return { status: "updated" as const };
  },
});

/**
 * Request a refresh for a specific projection. Called when the user clicks
 * the "Refresh" button on a live decoration.
 *
 * Phase 1 behavior: idempotently marks the projection's `refreshRequestedAt`
 * so the next orchestrator pass knows to re-run this block's sub-agent.
 * The orchestrator is then responsible for:
 *   1. Reading projections with refreshRequestedAt > lastProcessedAt
 *   2. Running the block's sub-agent
 *   3. Calling upsertFromStructuringPass with a bumped version
 *   4. The row's refreshRequestedAt is cleared implicitly via the version bump
 *
 * UX contract (industry-standard async acknowledgement):
 *   - Returns HONEST_STATUS: "queued" (newly flagged) / "already-queued"
 *     (user clicked twice) / "not-found" (stale runId from a deleted row)
 *   - Caller can surface the status as a toast; "already-queued" tells the
 *     user their prior click is still pending
 */
export const requestRefresh = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
    blockType: DILIGENCE_BLOCK_TYPE_VALIDATOR,
    scratchpadRunId: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await requireEntityWorkspaceWriteAccessBySlug(ctx, args);
    const existing = await ctx.db
      .query("diligenceProjections")
      .withIndex("by_owner_entity_block_run", (q) =>
        q
          .eq("ownerKey", workspace.entity.ownerKey)
          .eq("entityId", workspace.entity._id)
          .eq("blockType", args.blockType)
          .eq("scratchpadRunId", args.scratchpadRunId),
      )
      .first();

    if (!existing || existing.producerAssurance !== "internal_structuring_v1") {
      return { status: "not-found" as const };
    }

    const now = Date.now();
    const alreadyQueued =
      typeof existing.refreshRequestedAt === "number" &&
      existing.refreshRequestedAt > (existing.updatedAt ?? 0);

    if (alreadyQueued) {
      return {
        status: "already-queued" as const,
        queuedAt: existing.refreshRequestedAt!,
      };
    }

    await ctx.db.patch(existing._id, { refreshRequestedAt: now });
    return { status: "queued" as const, queuedAt: now };
  },
});

/**
 * Materialize the generic diligence pipeline for an entity from its latest
 * saved report. This is the bridge from existing report packets into the
 * overlay-first notebook runtime.
 */
export const materializeForEntity = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await requireEntityWorkspaceWriteAccessBySlug(ctx, args);
    const report = await loadLatestReportForEntity(ctx, {
      ownerKey: workspace.entity.ownerKey,
      entitySlug: workspace.entity.slug,
    });
    if (!report) {
      return { status: "noop" as const, reason: "missing-report" };
    }

    const idempotencyKey = buildOverlayRunIdempotencyKey({
      ownerKey: workspace.entity.ownerKey,
      entitySlug: workspace.entity.slug,
      reportUpdatedAt: report.updatedAt,
    });
    const existingRun = await ctx.db
      .query("agentScratchpads")
      .withIndex("by_idempotency", (q) =>
        q.eq("idempotencyKey", idempotencyKey),
      )
      .first();

    if (existingRun && existingRun.status !== "failed") {
      return {
        status: "already-running" as const,
        runId: existingRun.agentThreadId,
        idempotencyKey,
      };
    }

    const workflowId = buildOverlayRunWorkflowId({
      entityId: String(workspace.entity._id),
      entitySlug: workspace.entity.slug,
      reason: "materialize",
    });
    const now = Date.now();
    const workflowCollision = await ctx.db
      .query("agentScratchpads")
      .withIndex("by_agent_thread", (q) => q.eq("agentThreadId", workflowId))
      .first();
    if (workflowCollision) {
      throw new Error("Unable to allocate a unique diligence workflow id");
    }
    await ctx.db.insert("agentScratchpads", {
      agentThreadId: workflowId,
      userId: (workspace.identity.rawUserId ?? ("system" as any)) as any,
      scratchpad: {
        markdownSource: `# Diligence scratchpad\n\n- Entity: ${report.primaryEntity ?? report.title}\n- Run: ${workflowId}\n- Status: streaming\n- Current step: initialized`,
        checkpointNumber: 0,
        workflowType: OVERLAY_WORKFLOW_TYPE,
      },
      ownerKey: workspace.entity.ownerKey,
      entityId: workspace.entity._id,
      entitySlug: workspace.entity.slug,
      status: "streaming",
      mode: "live",
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.domains.product.diligenceProjections.runScratchpadProjectionPass,
      {
        ownerKey: workspace.entity.ownerKey,
        entityId: workspace.entity._id,
        workflowId,
        reason: "materialize",
        userId: workspace.identity.rawUserId,
        idempotencyKey,
        report: {
          entitySlug: report.entitySlug,
          title: report.title,
          primaryEntity: report.primaryEntity,
          sections: report.sections,
          sources: report.sources,
          updatedAt: report.updatedAt,
          revision: report.revision,
        },
      },
    );

    return {
      status: "queued" as const,
      runId: workflowId,
      idempotencyKey,
      reportUpdatedAt: report.updatedAt,
    };
  },
});

/**
 * Full refresh path used by the notebook overlay. It acknowledges the click,
 * marks the projection as refresh-requested when a row exists, then re-runs
 * the generic projection orchestrator immediately so the UI can converge on
 * authoritative rows instead of staying on the client fallback.
 */
export const requestRefreshAndRun = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
    blockType: DILIGENCE_BLOCK_TYPE_VALIDATOR,
    scratchpadRunId: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await requireEntityWorkspaceWriteAccessBySlug(ctx, args);
    const report = await loadLatestReportForEntity(ctx, {
      ownerKey: workspace.entity.ownerKey,
      entitySlug: workspace.entity.slug,
    });
    if (!report) {
      return {
        refreshStatus: "not-found" as const,
        queuedAt: undefined,
        rerun: { status: "noop" as const, reason: "missing-report" },
      };
    }

    const existing = await ctx.db
      .query("diligenceProjections")
      .withIndex("by_owner_entity_block_run", (q) =>
        q
          .eq("ownerKey", workspace.entity.ownerKey)
          .eq("entityId", workspace.entity._id)
          .eq("blockType", args.blockType)
          .eq("scratchpadRunId", args.scratchpadRunId),
      )
      .first();

    let refreshStatus: "queued" | "already-queued" | "not-found" = "not-found";
    let queuedAt: number | undefined;
    if (existing?.producerAssurance === "internal_structuring_v1") {
      const now = Date.now();
      const alreadyQueued =
        typeof existing.refreshRequestedAt === "number" &&
        existing.refreshRequestedAt > (existing.updatedAt ?? 0);
      if (alreadyQueued) {
        refreshStatus = "already-queued";
        queuedAt = existing.refreshRequestedAt;
      } else {
        refreshStatus = "queued";
        queuedAt = now;
        await ctx.db.patch(existing._id, { refreshRequestedAt: now });
      }
    }

    const workflowId = buildOverlayRunWorkflowId({
      entityId: String(workspace.entity._id),
      entitySlug: workspace.entity.slug,
      reason: "refresh",
      targetBlockType: args.blockType,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.domains.product.diligenceProjections.runScratchpadProjectionPass,
      {
        ownerKey: workspace.entity.ownerKey,
        entityId: workspace.entity._id,
        workflowId,
        reason: "refresh",
        targetBlockType: args.blockType,
        userId: workspace.identity.rawUserId,
        report: {
          entitySlug: report.entitySlug,
          title: report.title,
          primaryEntity: report.primaryEntity,
          sections: report.sections,
          sources: report.sources,
          updatedAt: report.updatedAt,
          revision: report.revision,
        },
      },
    );

    return {
      refreshStatus,
      queuedAt,
      rerun: {
        status: "queued" as const,
        runId: workflowId,
      },
    };
  },
});

/**
 * Remove all projections for an entity — used when the entity is deleted
 * or when a power user wants to wipe the live intelligence layer.
 *
 * BOUND: deletes in page-sized chunks so a single mutation never runs away
 * on an entity with thousands of historical projections (defense in depth;
 * MAX_PROJECTIONS_PER_ENTITY should already prevent that).
 */
export const clearForEntity = mutation({
  args: {
    anonymousSessionId: v.optional(v.string()),
    shareToken: v.optional(v.string()),
    entitySlug: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await requireEntityWorkspaceWriteAccessBySlug(ctx, args);
    const rows = await ctx.db
      .query("diligenceProjections")
      .withIndex("by_owner_entity", (q) =>
        q
          .eq("ownerKey", workspace.entity.ownerKey)
          .eq("entityId", workspace.entity._id),
      )
      .take(MAX_PROJECTIONS_PER_ENTITY);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { deleted: rows.length };
  },
});
