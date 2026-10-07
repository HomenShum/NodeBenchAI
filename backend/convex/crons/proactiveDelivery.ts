/**
 * Proactive Delivery Cron
 * Processes pending opportunities and delivers them to users
 *
 * Schedule: Every 5 minutes
 * Purpose: Ensure timely delivery of proactive opportunities
 */

import { cronJobs } from "convex/server";
import { internal } from "../_generated/api";

const crons = cronJobs();

crons.interval(
  "proactive-delivery",
  { minutes: 5 }, // Run every 5 minutes
  internal.domains.proactive.deliveryOrchestrator.processePendingOpportunities
);

export default crons;
