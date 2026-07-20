import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { buildDeltaSummaryPrompt, buildBriefPrompt } from "./promptBuilder";

const INTERVAL_LABELS: Record<number, string> = {
  10800000: "3 hours",
  21600000: "6 hours",
  43200000: "12 hours",
  86400000: "24 hours",
};

/**
 * Execute a single batch autopilot run.
 *
 * Pipeline:
 * 1. Collect delta (discoveries since last run)
 * 2. Summarize delta (free model)
 * 3. Generate personalized brief (free model)
 * 4. Plan actions (skip if digest-first)
 * 5. Deliver brief (channel preferences)
 * 6. Complete
 */
export const executeBatchRun = internalAction({
  args: { runId: v.id("batchAutopilotRuns") },
  handler: async (ctx, { runId }) => {
    let tokensUsed = 0;
    let modelCallsCount = 0;

    try {
      // Load the run
      const run = await ctx.runQuery(internal.domains.batchAutopilot.queries._getRunById, { runId });
      if (!run) throw new Error("Run not found");

      // Load profile
      const profile = await ctx.runQuery(
        internal.domains.operatorProfile.queries.getProfileByUserId,
        { userId: run.userId }
      );
      if (!profile) throw new Error("No operator profile found");

      // Load schedule for interval label
      const schedule = await ctx.runQuery(
        internal.domains.batchAutopilot.queries._getScheduleById,
        { scheduleId: run.scheduleId }
      );
      const intervalLabel = schedule
        ? INTERVAL_LABELS[schedule.intervalMs] || `${Math.round(schedule.intervalMs / 3600000)}h`
        : "recent period";

      // ── Step 1: Collect Delta ────────────────────────────────────────
      await ctx.runMutation(internal.domains.batchAutopilot.scheduler.updateRunStatus, {
        runId,
        status: "collecting",
      });

      const delta = await ctx.runQuery(
        internal.domains.batchAutopilot.deltaCollector.collectDelta,
        { windowStartAt: run.windowStartAt, windowEndAt: run.windowEndAt }
      );

      const totalItems = delta.counts.feedItems + delta.counts.signals +
        delta.counts.narrativeEvents + delta.counts.researchTasks;

      // Short-circuit if nothing new
      if (totalItems === 0) {
        await ctx.runMutation(internal.domains.batchAutopilot.scheduler.markRunCompleted, {
          runId,
          briefMarkdown: `## No New Discoveries\n\nNo new items found in the past ${intervalLabel}. The next check is scheduled automatically.`,
          feedItemsCount: 0,
          signalsCount: 0,
          narrativeEventsCount: 0,
          tokensUsed: 0,
          modelCallsCount: 0,
        });
        return;
      }

      // ── Step 2: Summarize Delta ──────────────────────────────────────
      await ctx.runMutation(internal.domains.batchAutopilot.scheduler.updateRunStatus, {
        runId,
        status: "summarizing",
      });

      const summaryPrompt = buildDeltaSummaryPrompt(delta, intervalLabel);
      let deltaSummary: string;

      try {
        const summaryResult = await ctx.runAction(
          internal.domains.models.modelRouter.route,
          {
            taskCategory: "summarization",
            tier: "free",
            systemPrompt:
              "You summarize newly collected intelligence into concise, source-aware analyst notes.",
            messages: [{ role: "user", content: summaryPrompt }],
            maxTokens: 2000,
          }
        );
        deltaSummary = summaryResult.text || "";
        tokensUsed += summaryResult.inputTokens + summaryResult.outputTokens;
        modelCallsCount++;
      } catch (e) {
        // Fallback: use raw data as summary
        deltaSummary = `Found ${totalItems} items: ${delta.counts.feedItems} feed items, ${delta.counts.signals} signals, ${delta.counts.narrativeEvents} events, ${delta.counts.researchTasks} research tasks.`;
        console.warn("[batchAutopilot] Summary model call failed, using fallback:", e);
      }

      // Budget check
      if (tokensUsed >= profile.budget.maxTokensPerRun) {
        await ctx.runMutation(internal.domains.batchAutopilot.scheduler.markRunCompleted, {
          runId,
          briefMarkdown: `## Budget Reached\n\n${deltaSummary}\n\n*Brief generation skipped — token budget (${profile.budget.maxTokensPerRun}) reached.*`,
          deltaSummary,
          feedItemsCount: delta.counts.feedItems,
          signalsCount: delta.counts.signals,
          narrativeEventsCount: delta.counts.narrativeEvents,
          tokensUsed,
          modelCallsCount,
        });
        return;
      }

      // ── Step 3: Generate Personalized Brief ──────────────────────────
      await ctx.runMutation(internal.domains.batchAutopilot.scheduler.updateRunStatus, {
        runId,
        status: "generating_brief",
      });

      const briefPrompt = buildBriefPrompt(deltaSummary, {
        displayName: profile.identity.displayName,
        role: profile.identity.role,
        domains: profile.identity.domains,
        writingStyle: profile.identity.writingStyle,
        goals: profile.goals,
        briefFormat: profile.outputPreferences.briefFormat,
        citationStyle: profile.outputPreferences.citationStyle,
        includeCostEstimate: profile.outputPreferences.includeCostEstimate,
      });

      let briefMarkdown: string;
      try {
        const briefResult = await ctx.runAction(
          internal.domains.models.modelRouter.route,
          {
            taskCategory: "content_generation",
            tier: profile.budget.preferredModelTier || "free",
            systemPrompt:
              "You write personalized intelligence briefs that preserve the operator's stated goals, writing style, and evidence preferences.",
            messages: [{ role: "user", content: briefPrompt }],
            maxTokens: 4000,
          }
        );
        briefMarkdown = briefResult.text || deltaSummary;
        tokensUsed += briefResult.inputTokens + briefResult.outputTokens;
        modelCallsCount++;
      } catch (e) {
        // Fallback: use the summary as the brief
        briefMarkdown = `## Intelligence Brief\n\n${deltaSummary}`;
        console.warn("[batchAutopilot] Brief model call failed, using summary:", e);
      }

      // Store brief as document
      let briefDocumentId;
      try {
        briefDocumentId = await ctx.runMutation(
          internal.domains.batchAutopilot.mutations._createBriefDocument,
          {
            userId: run.userId,
            title: `Brief — ${new Date(run.startedAt).toLocaleDateString()}`,
            content: briefMarkdown,
          }
        );
      } catch (e) {
        console.warn("[batchAutopilot] Failed to store brief document:", e);
      }

      // ── Step 4: Plan Actions (skip if digest-first) ──────────────────
      // In digest-first mode, we skip action planning entirely.
      // Actions would only be planned if WRITE permissions are enabled
      // AND the user has opted out of digest-first default.
      // For MVP: always skip. Action planning comes later.

      // ── Step 5: Deliver Brief ────────────────────────────────────────
      await ctx.runMutation(internal.domains.batchAutopilot.scheduler.updateRunStatus, {
        runId,
        status: "delivering",
      });

      // Delivery via channel preferences is best-effort
      try {
        // For now, the brief is stored in the document and available in-app.
        // Channel delivery (email, Slack, etc.) can be wired up to the
        // outbound pipeline once the messaging integration is complete.
        console.log(`[batchAutopilot] Brief generated for user ${run.userId}, ${briefMarkdown.length} chars`);
      } catch (e) {
        console.warn("[batchAutopilot] Delivery failed:", e);
      }

      // ── Step 6: Complete ─────────────────────────────────────────────
      await ctx.runMutation(internal.domains.batchAutopilot.scheduler.markRunCompleted, {
        runId,
        briefMarkdown,
        briefDocumentId,
        deltaSummary,
        feedItemsCount: delta.counts.feedItems,
        signalsCount: delta.counts.signals,
        narrativeEventsCount: delta.counts.narrativeEvents,
        tokensUsed,
        modelCallsCount,
      });

      console.log(`[batchAutopilot] Run ${runId} completed: ${totalItems} items, ${tokensUsed} tokens, ${modelCallsCount} calls`);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[batchAutopilot] Run ${runId} failed:`, errorMsg);

      await ctx.runMutation(internal.domains.batchAutopilot.scheduler.markRunFailed, {
        runId,
        error: errorMsg,
        tokensUsed,
        modelCallsCount,
      });
    }
  },
});
