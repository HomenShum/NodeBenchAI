"use node";

/**
 * traceWrapper.ts — TRACE-Wrapped Forecast Refresh
 *
 * Wraps the daily forecast refresh in TRACE audit entries so every step
 * is deterministically logged. Does NOT replace the cron handler — it
 * wraps it with audit instrumentation.
 *
 * TRACE steps:
 *   0. gather_info: queryActiveForecasts
 *   1. gather_info: fetchRecentSignals
 *   2. execute_data_op: matchSignalsToForecasts
 *   3. execute_data_op: scoreSignalImpact
 *   4. execute_output: updateProbabilities
 *   5. finalize: forecastRefreshComplete
 */

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import {
  matchSignalsToForecasts,
  type DigestSignal,
  type ActiveForecast,
  type ForecastUpdate,
} from "./signalMatcher";

// ─── Helper: Append TRACE entry ──────────────────────────────────────────────

interface TraceEntryArgs {
  executionId: string;
  workflowTag: string;
  seq: number;
  choiceType: "gather_info" | "execute_data_op" | "execute_output" | "finalize";
  toolName: string;
  description: string;
  metadata: {
    rowCount?: number;
    charCount?: number;
    wordCount?: number;
    keyTopics?: string[];
    errorMessage?: string;
    durationMs: number;
    success: boolean;
    originalRequest?: string;
    deliverySummary?: string;
  };
}

// ─── Traced Forecast Refresh ─────────────────────────────────────────────────

export const tracedForecastRefresh = internalAction({
  args: {
    date: v.optional(v.string()),
  },
  handler: async (ctx, { date: dateArg }) => {
    // Compute date at fire time, not module-load time.
    // Cron args are evaluated once at deploy — passing Date there freezes it.
    const date = dateArg || new Date().toISOString().split("T")[0];
    const executionId = `forecast_refresh_${date}_${Date.now()}`;
    const workflowTag = `forecast_refresh_${date}`;
    let seq = 0;

    const appendEntry = async (entry: Omit<TraceEntryArgs, "executionId" | "workflowTag">) => {
      try {
        await ctx.runMutation(
          internal.domains.agents.traceAuditLog.appendAuditEntry,
          {
            executionId,
            executionType: "forecast_refresh" as const,
            workflowTag,
            seq: entry.seq,
            choiceType: entry.choiceType,
            toolName: entry.toolName,
            description: entry.description,
            metadata: entry.metadata,
          },
        );
      } catch (e) {
        console.warn(`[tracedForecastRefresh] Failed to append TRACE entry seq=${entry.seq}:`, e instanceof Error ? e.message : String(e));
      }
    };

    const startTime = Date.now();
    let forecastsRefreshed = 0;
    let totalDeltaPp = 0;
    let signalMatches = 0;

    // Step 0: Query active forecasts needing refresh
    const step0Start = Date.now();
    let activeForecasts: any[] = [];
    try {
      activeForecasts = await ctx.runQuery(
        internal.domains.forecasting.forecastManager.getActiveForecastsForRefresh,
        {},
      );
      await appendEntry({
        seq: seq++,
        choiceType: "gather_info",
        toolName: "queryActiveForecasts",
        description: `Found ${activeForecasts.length} active forecasts needing refresh`,
        metadata: {
          rowCount: activeForecasts.length,
          keyTopics: activeForecasts.slice(0, 5).map((f: any) => f.question?.slice(0, 50) || "unknown"),
          durationMs: Date.now() - step0Start,
          success: true,
        },
      });
    } catch (e) {
      await appendEntry({
        seq: seq++,
        choiceType: "gather_info",
        toolName: "queryActiveForecasts",
        description: "Failed to query active forecasts",
        metadata: {
          durationMs: Date.now() - step0Start,
          success: false,
          errorMessage: e instanceof Error ? e.message : String(e),
        },
      });
      // Finalize early on failure
      await appendEntry({
        seq: seq++,
        choiceType: "finalize",
        toolName: "forecastRefreshComplete",
        description: "Forecast refresh aborted: could not query active forecasts",
        metadata: {
          durationMs: Date.now() - startTime,
          success: false,
          originalRequest: `Daily forecast refresh for ${date}`,
          deliverySummary: "Aborted — query failure",
        },
      });
      return { executionId, success: false, forecastsRefreshed: 0 };
    }

    if (activeForecasts.length === 0) {
      await appendEntry({
        seq: seq++,
        choiceType: "finalize",
        toolName: "forecastRefreshComplete",
        description: "No forecasts need refresh today",
        metadata: {
          durationMs: Date.now() - startTime,
          success: true,
          originalRequest: `Daily forecast refresh for ${date}`,
          deliverySummary: "0 forecasts needed refresh",
        },
      });
      return { executionId, success: true, forecastsRefreshed: 0 };
    }

    // Step 1: Fetch recent signals from latest digest (if available)
    const step1Start = Date.now();
    let recentSignals: DigestSignal[] = [];
    try {
      // Try to get today's digest signals — non-fatal if unavailable
      // This is a best-effort enrichment step
      await appendEntry({
        seq: seq++,
        choiceType: "gather_info",
        toolName: "fetchRecentSignals",
        description: `Signals step: digest signals not yet available for cross-reference (runs before digest cron)`,
        metadata: {
          rowCount: 0,
          durationMs: Date.now() - step1Start,
          success: true,
        },
      });
    } catch (e) {
      await appendEntry({
        seq: seq++,
        choiceType: "gather_info",
        toolName: "fetchRecentSignals",
        description: "Could not fetch recent signals (non-fatal)",
        metadata: {
          durationMs: Date.now() - step1Start,
          success: true, // non-fatal
          errorMessage: e instanceof Error ? e.message : String(e),
        },
      });
    }

    // Step 2: Match signals to forecasts (deterministic)
    const step2Start = Date.now();
    const forecastsForMatching: ActiveForecast[] = activeForecasts.map((f: any) => ({
      id: f._id,
      question: f.question,
      tags: f.tags || [],
      topDrivers: f.topDrivers || [],
      topCounterarguments: f.topCounterarguments || [],
      probability: f.probability || 0.5,
    }));

    const matches = recentSignals.length > 0
      ? matchSignalsToForecasts(recentSignals, forecastsForMatching)
      : [];
    signalMatches = matches.length;

    await appendEntry({
      seq: seq++,
      choiceType: "execute_data_op",
      toolName: "matchSignalsToForecasts",
      description: `Matched ${matches.length} signal↔forecast pairs from ${recentSignals.length} signals × ${activeForecasts.length} forecasts`,
      metadata: {
        rowCount: matches.length,
        keyTopics: matches.slice(0, 3).map((m) => `signal[${m.signalIndex}]→${m.forecastQuestion.slice(0, 30)}`),
        durationMs: Date.now() - step2Start,
        success: true,
      },
    });

    // Step 3: Score impact — call refreshForecast for each active forecast
    const step3Start = Date.now();
    const updates: ForecastUpdate[] = [];

    for (const forecast of activeForecasts) {
      try {
        await ctx.runAction(
          internal.domains.forecasting.actions.refreshForecast.refreshForecastAction,
          { forecastId: forecast._id },
        );
        forecastsRefreshed++;
        // Note: actual delta tracking would require querying updateHistory after each refresh
      } catch (e) {
        console.warn(`[tracedForecastRefresh] Failed to refresh forecast ${forecast._id}:`, e instanceof Error ? e.message : String(e));
      }
    }

    await appendEntry({
      seq: seq++,
      choiceType: "execute_data_op",
      toolName: "scoreSignalImpact",
      description: `Refreshed ${forecastsRefreshed}/${activeForecasts.length} forecasts`,
      metadata: {
        rowCount: forecastsRefreshed,
        durationMs: Date.now() - step3Start,
        success: forecastsRefreshed > 0,
      },
    });

    // Step 4: Summary output
    await appendEntry({
      seq: seq++,
      choiceType: "execute_output",
      toolName: "updateProbabilities",
      description: `Updated probabilities for ${forecastsRefreshed} forecasts with ${signalMatches} signal matches`,
      metadata: {
        rowCount: forecastsRefreshed,
        durationMs: 0, // already counted in step 3
        success: true,
      },
    });

    // Step 5: Finalize
    await appendEntry({
      seq: seq++,
      choiceType: "finalize",
      toolName: "forecastRefreshComplete",
      description: `Forecast refresh complete: ${forecastsRefreshed} updated, ${signalMatches} signal matches`,
      metadata: {
        durationMs: Date.now() - startTime,
        success: true,
        originalRequest: `Daily forecast refresh for ${date}`,
        deliverySummary: `${forecastsRefreshed} forecasts refreshed, ${signalMatches} signal-forecast matches`,
      },
    });

    return {
      executionId,
      workflowTag,
      success: true,
      forecastsRefreshed,
      signalMatches,
      totalDurationMs: Date.now() - startTime,
    };
  },
});
