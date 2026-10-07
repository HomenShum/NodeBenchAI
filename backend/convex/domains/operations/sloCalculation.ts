/**
 * SLO Calculation
 *
 * Calculates daily verification SLO metrics from verification audit logs.
 * Tracks precision, recall, F1 score, and SLO compliance.
 *
 * Created: 2026-01-22 (P1 - Critical for verification quality)
 */

import { v } from "convex/values";
import { internalMutation, query } from "../../_generated/server";

/**
 * Calculate daily SLO metrics for all verification types
 */
export const calculateDailySlo = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get yesterday's date (since we run at 2 AM)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0]; // YYYY-MM-DD

    // Get verification audit logs for yesterday
    const startOfDay = new Date(dateStr).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

    const verificationLogs = await ctx.db
      .query("verificationAuditLog")
      .collect();

    // Filter to yesterday
    const yesterdayLogs = verificationLogs.filter(
      (log) => log.timestamp >= startOfDay && log.timestamp < endOfDay
    );

    if (yesterdayLogs.length === 0) {
      console.log(`[SLO] No verification logs for ${dateStr}`);
      return { success: true, message: "No logs for yesterday", date: dateStr };
    }

    // Group by verification type (based on entityType)
    const byType = new Map<string, typeof yesterdayLogs>();
    for (const log of yesterdayLogs) {
      const type = log.entityType || "unknown";
      const existing = byType.get(type) || [];
      existing.push(log);
      byType.set(type, existing);
    }

    const results: any[] = [];

    // Calculate metrics for each verification type
    for (const [verificationType, logs] of byType.entries()) {
      // Initialize confusion matrix
      let truePositives = 0;
      let falsePositives = 0;
      let trueNegatives = 0;
      let falseNegatives = 0;

      // Build confusion matrix from logs
      for (const log of logs) {
        const entityFound = log.entityFound;
        const overallStatus = log.overallStatus;

        // True Positive: Entity found AND verification passed
        if (entityFound && overallStatus === "verified") {
          truePositives++;
        }
        // False Positive: Entity found BUT verification failed
        else if (entityFound && overallStatus === "failed") {
          falsePositives++;
        }
        // True Negative: Entity not found AND verification marked as not needed
        else if (!entityFound && overallStatus === "not_needed") {
          trueNegatives++;
        }
        // False Negative: Entity not found BUT verification was needed
        else if (!entityFound && overallStatus === "failed") {
          falseNegatives++;
        }
      }

      // Calculate derived metrics
      const totalVerifications = logs.length;
      const totalPositives = truePositives + falsePositives;
      const totalActualPositives = truePositives + falseNegatives;

      const precision =
        totalPositives > 0 ? truePositives / totalPositives : 1.0;
      const recall =
        totalActualPositives > 0 ? truePositives / totalActualPositives : 1.0;
      const f1Score =
        precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
      const accuracy =
        totalVerifications > 0
          ? (truePositives + trueNegatives) / totalVerifications
          : 0;

      // Calculate average sources per verification
      const totalSources = logs.reduce(
        (sum, log) => sum + (log.probeResults?.length || 0),
        0
      );
      const avgSourcesPerVerification =
        totalVerifications > 0 ? totalSources / totalVerifications : 0;

      // SLO target for precision (95%)
      const sloTarget = 0.95;
      const sloMet = precision >= sloTarget;
      const sloMissMargin = sloMet ? 0 : sloTarget - precision;

      // Check if entry already exists for this date/type
      const existing = await ctx.db
        .query("verificationSloMetrics")
        .withIndex("by_type_date", (q) =>
          q.eq("verificationType", verificationType).eq("date", dateStr)
        )
        .first();

      if (existing) {
        // Update existing entry
        await ctx.db.patch(existing._id, {
          truePositives,
          falsePositives,
          trueNegatives,
          falseNegatives,
          precision,
          recall,
          f1Score,
          accuracy,
          totalVerifications,
          totalSources,
          avgSourcesPerVerification,
          sloTarget,
          sloMet,
          sloMissMargin: sloMet ? undefined : sloMissMargin,
          createdAt: Date.now(),
        });

        console.log(
          `[SLO] Updated ${verificationType} for ${dateStr}: precision=${precision.toFixed(3)}, recall=${recall.toFixed(3)}, SLO ${sloMet ? "MET" : "MISSED"}`
        );

        results.push({
          verificationType,
          action: "updated",
          precision,
          recall,
          sloMet,
        });
      } else {
        // Create new entry
        await ctx.db.insert("verificationSloMetrics", {
          date: dateStr,
          verificationType,
          truePositives,
          falsePositives,
          trueNegatives,
          falseNegatives,
          precision,
          recall,
          f1Score,
          accuracy,
          totalVerifications,
          totalSources,
          avgSourcesPerVerification,
          sloTarget,
          sloMet,
          sloMissMargin: sloMet ? undefined : sloMissMargin,
          metadata: {
            calculatedAt: Date.now(),
          },
          createdAt: Date.now(),
        });

        console.log(
          `[SLO] Created ${verificationType} for ${dateStr}: precision=${precision.toFixed(3)}, recall=${recall.toFixed(3)}, SLO ${sloMet ? "MET" : "MISSED"}`
        );

        results.push({
          verificationType,
          action: "created",
          precision,
          recall,
          sloMet,
        });
      }
    }

    console.log(
      `[SLO] Processed ${results.length} verification types for ${dateStr}`
    );

    return {
      success: true,
      date: dateStr,
      results,
      totalVerificationTypes: results.length,
      sloMetCount: results.filter((r) => r.sloMet).length,
      sloMissedCount: results.filter((r) => !r.sloMet).length,
    };
  },
});

/**
 * Get SLO metrics for a date range
 */
export const getSloMetrics = query({
  args: {
    verificationType: v.optional(v.string()),
    startDate: v.optional(v.string()), // YYYY-MM-DD
    endDate: v.optional(v.string()), // YYYY-MM-DD
  },
  handler: async (ctx, args) => {
    let metrics;

    if (args.verificationType) {
      metrics = await ctx.db
        .query("verificationSloMetrics")
        .withIndex("by_type_date", (q) =>
          q.eq("verificationType", args.verificationType)
        )
        .collect();
    } else {
      metrics = await ctx.db.query("verificationSloMetrics").collect();
    }

    // Filter by date range
    if (args.startDate || args.endDate) {
      metrics = metrics.filter((m) => {
        if (args.startDate && m.date < args.startDate) return false;
        if (args.endDate && m.date > args.endDate) return false;
        return true;
      });
    }

    return metrics.sort((a, b) => b.date.localeCompare(a.date));
  },
});

/**
 * Get SLO compliance summary
 */
export const getSloComplianceSummary = query({
  args: {
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let metrics = await ctx.db.query("verificationSloMetrics").collect();

    // Filter by date range
    if (args.startDate || args.endDate) {
      metrics = metrics.filter((m) => {
        if (args.startDate && m.date < args.startDate) return false;
        if (args.endDate && m.date > args.endDate) return false;
        return true;
      });
    }

    if (metrics.length === 0) {
      return {
        total: 0,
        sloMet: 0,
        sloMissed: 0,
        overallCompliance: 0,
        avgPrecision: 0,
        avgRecall: 0,
        avgF1Score: 0,
      };
    }

    const sloMet = metrics.filter((m) => m.sloMet).length;
    const sloMissed = metrics.filter((m) => !m.sloMet).length;

    const avgPrecision =
      metrics.reduce((sum, m) => sum + m.precision, 0) / metrics.length;
    const avgRecall =
      metrics.reduce((sum, m) => sum + m.recall, 0) / metrics.length;
    const avgF1Score =
      metrics.reduce((sum, m) => sum + m.f1Score, 0) / metrics.length;

    // Get worst performing types
    const worstTypes = metrics
      .filter((m) => !m.sloMet)
      .sort((a, b) => a.precision - b.precision)
      .slice(0, 5)
      .map((m) => ({
        verificationType: m.verificationType,
        date: m.date,
        precision: m.precision,
        sloMissMargin: m.sloMissMargin,
      }));

    // Get SLO trends (last 7 days)
    const recentMetrics = metrics
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 7);
    const recentCompliance = recentMetrics.filter((m) => m.sloMet).length / recentMetrics.length;

    return {
      total: metrics.length,
      sloMet,
      sloMissed,
      overallCompliance: metrics.length > 0 ? sloMet / metrics.length : 0,
      avgPrecision,
      avgRecall,
      avgF1Score,
      worstTypes,
      recentCompliance,
      dateRange: {
        start: args.startDate || (metrics.length > 0 ? metrics[metrics.length - 1].date : null),
        end: args.endDate || (metrics.length > 0 ? metrics[0].date : null),
      },
    };
  },
});
