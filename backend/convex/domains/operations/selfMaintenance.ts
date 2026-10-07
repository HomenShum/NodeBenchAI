import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import {
  evaluateDailyBriefDidYouKnow,
  evaluateDidYouKnowArchiveRow,
  evaluateLinkedInArchiveAudit,
  type LinkedInArchiveAuditResult,
} from "./selfMaintenanceChecks";

function isoDateStringFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

type SelfMaintenanceReport = {
  workflowId: string;
  ranAtMs: number;
  passed: boolean;
  checks: Record<string, boolean>;
  errors: string[];
  warnings: string[];
  details: Record<string, unknown>;
  explanation?: {
    modelUsed: string;
    content: string;
    artifactId: string | null;
  };
};

export const saveSelfMaintenanceSnapshot = internalMutation({
  args: {
    workflowId: v.string(),
    report: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("checkpoints", {
      workflowId: args.workflowId,
      checkpointId: `self_maintenance_${args.workflowId}_${now}`,
      checkpointNumber: 1,
      parentCheckpointId: undefined,
      workflowType: "self_maintenance",
      workflowName: "Self Maintenance",
      userId: undefined,
      sessionId: undefined,
      currentStep: "complete",
      status: (args.report as any)?.passed === true ? "completed" : "error",
      progress: 100,
      state: {
        version: 1,
        kind: "self_maintenance_snapshot",
        capturedAt: now,
        report: args.report,
      },
      createdAt: now,
      error: (args.report as any)?.passed === true ? undefined : String(((args.report as any)?.errors?.[0] ?? "self maintenance failed")),
      estimatedTimeRemaining: undefined,
      nextScheduledAction: undefined,
    });
    return null;
  },
});

export const getLatestSelfMaintenanceSnapshot = internalQuery({
  args: {},
  returns: v.union(v.null(), v.any()),
  handler: async (ctx) => {
    const checkpoint = await ctx.db
      .query("checkpoints")
      .withIndex("by_created_at")
      .order("desc")
      .filter((q) => q.eq(q.field("workflowType"), "self_maintenance"))
      .first();
    return checkpoint ? checkpoint.state : null;
  },
});

export const runNightlySelfMaintenance = internalAction({
  args: {
    workflowId: v.optional(v.string()),
    asOfMs: v.optional(v.number()),
    includeLlmExplanation: v.optional(v.boolean()),
    didYouKnowPostLimit: v.optional(v.number()),
    requireDidYouKnowArchive: v.optional(v.boolean()),
    requireDailyBriefDidYouKnow: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SelfMaintenanceReport> => {
    const ranAtMs = typeof args.asOfMs === "number" ? args.asOfMs : Date.now();
    const workflowId =
      typeof args.workflowId === "string" && args.workflowId.length > 0
        ? args.workflowId
        : `self_maintenance_${isoDateStringFromMs(ranAtMs)}`;

    const errors: string[] = [];
    const warnings: string[] = [];

    const checks: Record<string, boolean> = {};
    const details: Record<string, unknown> = {};

    // 1) LinkedIn archive invariants (hard gate)
    const archiveAudit = (await ctx.runAction(internal.domains.social.linkedinArchiveAudit.runArchiveAudit, {
      pageSize: 250,
      maxRows: 200000,
      includeSamples: false,
    })) as LinkedInArchiveAuditResult;

    const archiveGate = evaluateLinkedInArchiveAudit(archiveAudit);
    details.linkedinArchiveAudit = archiveGate.details;
    for (const [k, v] of Object.entries(archiveGate.checks)) checks[`linkedinArchive.${k}`] = v;
    if (!archiveGate.passed) errors.push(...archiveGate.errors);
    warnings.push(...archiveGate.warnings);

    // 2) Did You Know LinkedIn archive integrity (hard gate)
    const didYouKnowLimit = Math.min(Math.max(args.didYouKnowPostLimit ?? 25, 1), 200);
    const didYouKnowPage = await ctx.runQuery(api.domains.social.linkedinArchiveQueries.getArchivedPosts, {
      postType: "did_you_know",
      limit: didYouKnowLimit,
      dedupe: true,
    });

    const didYouKnowRows = Array.isArray((didYouKnowPage as any)?.posts) ? ((didYouKnowPage as any).posts as any[]) : [];
    const didYouKnowRowResults = didYouKnowRows.map((row) =>
      evaluateDidYouKnowArchiveRow({ postType: "did_you_know", metadata: row?.metadata })
    );

    const requireDidYouKnowArchive = args.requireDidYouKnowArchive ?? false;
    const didYouKnowAllPass = didYouKnowRowResults.every((r) => r.passed);
    checks.didYouKnowArchiveHasRows = didYouKnowRowResults.length > 0;
    checks.didYouKnowArchiveAllRowsPass = didYouKnowAllPass;
    details.didYouKnowArchive = {
      checked: didYouKnowRowResults.length,
      failures: didYouKnowRowResults.filter((r) => !r.passed).slice(0, 3).map((r) => ({ errors: r.errors, checks: r.checks })),
    };
    if (!checks.didYouKnowArchiveHasRows && requireDidYouKnowArchive) {
      errors.push("No did_you_know posts found in linkedinPostArchive");
    }
    if (!checks.didYouKnowArchiveAllRowsPass) errors.push("One or more did_you_know archive rows failed integrity checks");

    // 3) Daily Brief didYouKnow propagation (configurable gate)
    const requireDailyBriefDidYouKnow = args.requireDailyBriefDidYouKnow ?? false;
    const latestMemory = await ctx.runQuery(internal.domains.research.dailyBriefMemoryQueries.getLatestMemoryInternal, {});
    const brief: any = (latestMemory as any)?.context?.executiveBrief;
    const briefDidYouKnow = brief?.didYouKnow;

    if (!latestMemory) {
      warnings.push("No dailyBriefMemories found");
      checks.dailyBriefPresent = false;
      checks.dailyBriefDidYouKnowPass = !requireDailyBriefDidYouKnow;
    } else {
      checks.dailyBriefPresent = true;
      const briefGate = evaluateDailyBriefDidYouKnow(briefDidYouKnow);
      for (const [k, v] of Object.entries(briefGate.checks)) checks[`dailyBrief.didYouKnow.${k}`] = v;
      details.dailyBriefDidYouKnow = {
        dateString: (latestMemory as any)?.dateString,
        memoryId: (latestMemory as any)?._id,
        errors: briefGate.errors,
        checks: briefGate.checks,
      };
      checks.dailyBriefDidYouKnowPass = briefGate.passed;
      if (requireDailyBriefDidYouKnow && !briefGate.passed) errors.push(...briefGate.errors);
    }

    // 4) Bug loop invariants (Ralph loop substrate)
    try {
      const bugExport = await ctx.runQuery(internal.domains.operations.bugLoop.exportBugCardsForVault, {
        limit: 200,
        maxOccurrencesPerCard: 1,
      });
      const cards = Array.isArray((bugExport as any)?.cards) ? ((bugExport as any).cards as any[]) : [];
      checks.bugLoopHasCardsOrEmpty = true;
      checks.bugLoopCardsHaveOccurrences = cards.every((c) => Array.isArray(c?.meta?.occurrenceArtifacts) && c.meta.occurrenceArtifacts.length > 0);
      checks.bugLoopCardsHaveSignatureDerivation = cards.every((c) => c?.meta?.signatureDerivation && typeof c.meta.signatureDerivation === "object");
      checks.bugLoopHumanApproveHasInvestigation = cards.every((c) => {
        const col = String(c?.meta?.column ?? "");
        if (col !== "human_approve") return true;
        return Boolean(c?.meta?.investigation?.artifactId);
      });
      details.bugLoop = {
        checked: cards.length,
        columns: cards.reduce((acc: Record<string, number>, c) => {
          const col = String(c?.meta?.column ?? "unknown");
          acc[col] = (acc[col] ?? 0) + 1;
          return acc;
        }, {}),
      };
      if (cards.length > 0) {
        if (!checks.bugLoopCardsHaveOccurrences) errors.push("Bug loop: one or more bug cards missing occurrenceArtifacts");
        if (!checks.bugLoopCardsHaveSignatureDerivation) errors.push("Bug loop: one or more bug cards missing signatureDerivation");
        if (!checks.bugLoopHumanApproveHasInvestigation) errors.push("Bug loop: one or more human_approve bug cards missing investigation artifact");
      }
    } catch (e: any) {
      warnings.push(`Bug loop check failed: ${String(e?.message || e)}`);
      checks.bugLoopHasCardsOrEmpty = false;
    }

    const passed = errors.length === 0;
    checks.passed = passed;

    const report: SelfMaintenanceReport = {
      workflowId,
      ranAtMs,
      passed,
      checks,
      errors,
      warnings,
      details,
    };

    const includeLlmExplanation = args.includeLlmExplanation ?? false;
    if (includeLlmExplanation) {
      try {
        const context = {
          workflowId,
          ranAtMs,
          passed,
          checks,
          errors,
          warnings,
          details,
        };

        const response = await ctx.runAction(
          internal.domains.models.autonomousModelResolver.executeWithFallback,
          {
            taskType: "analysis",
            messages: [
              {
                role: "system",
                content:
                  "You are a QA/audit assistant. Explain a self-maintenance report for engineers and operators. " +
                  "Use ONLY the provided context JSON. Do not speculate. " +
                  "Explain which boolean checks failed and what to do next. " +
                  "Hard rules: no em dash, no en dash, no emojis. " +
                  "Format: 6 to 10 short bullet points, each under 140 chars.",
              },
              { role: "user", content: `Context JSON:\n${JSON.stringify(context, null, 2)}` },
            ],
            maxTokens: 500,
            temperature: 0.2,
          }
        );

        const stored = await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
          sourceType: "extracted_text",
          sourceUrl: `ops://self_maintenance/${workflowId}`,
          title: "Self maintenance explanation",
          rawContent: response.content,
          extractedData: {
            kind: "self_maintenance_explanation",
            workflowId,
            ranAtMs,
            modelUsed: response.modelUsed,
            context,
          },
          fetchedAt: Date.now(),
        });

        report.explanation = {
          modelUsed: response.modelUsed,
          content: response.content,
          artifactId: stored?.id ? String(stored.id) : null,
        };
      } catch (e: any) {
        warnings.push(`LLM explanation failed: ${String(e?.message || e)}`);
      }
    }

    await ctx.runMutation(internal.domains.operations.selfMaintenance.saveSelfMaintenanceSnapshot, {
      workflowId,
      report,
    });

    return report;
  },
});

export const runNightlySelfMaintenanceCron = internalAction({
  args: {},
  handler: async (ctx) => {
    return await ctx.runAction(internal.domains.operations.selfMaintenance.runNightlySelfMaintenance, {
      includeLlmExplanation: true,
    });
  },
});
