/**
 * Narrative Domain Cron Jobs
 *
 * Scheduled tasks for the DRANE system:
 * 1. Weekly Newsroom Pipeline - Runs every Monday at 6 AM UTC
 * 2. Stale Thread Cleanup - Marks dormant threads
 *
 * @module domains/narrative/crons
 */

import { cronJobs } from "convex/server";
import { internal } from "../../../_generated/api";

const crons = cronJobs();

/**
 * Weekly Newsroom Pipeline
 *
 * Runs every Monday at 6:00 AM UTC to:
 * - Discover new news for tracked entities
 * - Analyze narrative shifts
 * - Update thread statuses
 *
 * Note: This cron schedules the actual pipeline runs via internal mutation
 * that queries for users with active narrative tracking.
 */
crons.weekly(
  "weekly_newsroom_pipeline",
  { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 },
  internal.domains.narrative.cronHandlers.triggerWeeklyPipelines
);

/**
 * Daily Stale Thread Check
 *
 * Runs daily at midnight UTC to mark threads as dormant
 * if they haven't had activity in 30 days.
 */
crons.daily(
  "daily_stale_thread_check",
  { hourUTC: 0, minuteUTC: 0 },
  internal.domains.narrative.cronHandlers.markDormantThreads
);

export default crons;
