import { cronJobs } from "convex/server";
import { internal } from "../_generated/api";

const crons = cronJobs();

/**
 * Daily Public Dossier Generation
 * 
 * Runs every day at 6:00 AM UTC to generate the free daily AI intelligence briefing.
 * This dossier is available to all users without authentication.
 * 
 * The generated dossier covers:
 * - AI infrastructure funding highlights
 * - Emerging trends and technical deep dives
 * - Week ahead outlook and market sentiment
 */
crons.daily(
  "generate-daily-public-dossier",
  { hourUTC: 6, minuteUTC: 0 },
  internal.domains.research.publicDossier.generateDailyDossier,
  { topic: "AI Infrastructure & Venture Capital" }
);

export default crons;
