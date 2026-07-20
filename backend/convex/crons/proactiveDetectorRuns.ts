/**
 * Proactive Detector Runs Cron
 * Automatically runs batch detectors on schedule
 *
 * Schedule: Every hour (matching meeting prep detector schedule)
 * Purpose: Execute detectors and create opportunities
 */

import { cronJobs } from "convex/server";
import { internal } from "../_generated/api";

const crons = cronJobs();

crons.hourly(
  "proactive-detector-runs",
  { minuteUTC: 0 }, // Run at the top of every hour
  internal.domains.proactive.detectors.executor.runBatchDetectors
);

export default crons;
