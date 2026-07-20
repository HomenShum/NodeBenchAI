/**
 * SLO Calculation Cron
 *
 * Runs daily to calculate verification SLO metrics.
 * Tracks precision, recall, F1 score, and SLO compliance for each verification type.
 *
 * Created: 2026-01-22 (P1 - Critical for verification quality tracking)
 */

import { cronJobs } from "convex/server";
import { internal } from "../_generated/api";

const crons = cronJobs();

/**
 * Daily SLO Calculation
 * Runs at 2 AM UTC to calculate previous day's SLO metrics
 */
crons.daily(
  "Calculate verification SLO metrics",
  { hourUTC: 2, minuteUTC: 0 },
  internal.domains.operations.sloCalculation.calculateDailySlo
);

export default crons;
