import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// NOTE: ProseMirror snapshot cleanup cron removed because the referenced
// internal function does not exist (cleanupSnapshotsCron). This avoids
// deployment errors about scheduling a missing function.

// Refresh US holidays daily (cache current and next year)
crons.interval(
  "refresh US holidays",
  { hours: 24 },
  internal.domains.calendar.holidaysActions.refreshUSCron,
  {}
);

// Pi-AI pipeline scheduler — sweeps `scheduledPipelineRuns` hourly,
// kicks off any rows whose `nextRunAt <= now` via the durable workflow.
// Bounded to 50 schedules per sweep (BOUND invariant in pipelineSchedule.ts).
crons.interval(
  "pi-ai pipeline scheduler",
  { minutes: 60 },
  internal.domains.pipelines.pipelineSchedule.runDuePipelineSchedules,
  {},
);

// ═══════════════════════════════════════════════════════════════════════════
// GAM: Memory maintenance crons
// ═══════════════════════════════════════════════════════════════════════════

// Mark stale entity contexts daily (entities not refreshed in 7+ days)
crons.daily(
  "mark stale entity contexts",
  { hourUTC: 3, minuteUTC: 0 },
  internal.domains.knowledge.entityContexts.markStaleContexts,
  {}
);

// Run memory GC weekly (archive old, trim oversized)
// Disabled until memoryGC module is implemented
// crons.weekly(
//   "memory GC",
//   { dayOfWeek: "sunday", hourUTC: 4, minuteUTC: 0 },
//   internal.domains.agents.memoryGC.runWeeklyGC,
//   {}
// );

// ═══════════════════════════════════════════════════════════════════════════
// Artifact persistence cleanup crons
// ═══════════════════════════════════════════════════════════════════════════

// Cleanup old persist jobs daily (done: 7 days, failed: 14 days)
crons.daily(
  "cleanup artifact persist jobs",
  { hourUTC: 4, minuteUTC: 30 },
  internal.lib.artifactPersistence.cleanupArtifactJobs,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// Industry Monitoring - Scan for updates from AI leaders (2026)
// ═══════════════════════════════════════════════════════════════════════════

// Enhanced industry scan with X/web search (Phase 5)
// Runs daily at 6 AM UTC - includes X search, web search, and PR generation
crons.daily(
  "enhanced industry scan",
  { hourUTC: 6, minuteUTC: 0 }, // 6 AM UTC daily
  internal.domains.monitoring.industryUpdatesEnhanced.enhancedIndustryScan,
  {}
);

// Public-trending seed for editorial home §1 (Track B, 2026-05-09).
// The enhancedIndustryScan above writes to prSuggestions only — it never
// inserts industryUpdates rows (the original write path is commented out
// at industryUpdatesEnhanced.ts line 209). That left getTodayPulse's
// public-trending fallback returning provenance:"empty" for every guest.
// This cron pulls HN top + arXiv cs.AI recent (free, no API key) every
// 6 hours so guest §1 always renders trending content. Idempotent —
// dedupes by URL so re-runs don't double-insert.
crons.interval(
  "public-trending seed (HN + arXiv)",
  { hours: 6 },
  internal.domains.monitoring.publicTrendingSeed.seedPublicTrending,
  {},
);

// Phase 9a: GDELT-lite ingestion for §1 + §6 source diversity.
// GDELT Doc 2.0 free-tier endpoint requires no key.  Fires once daily
// (more than once = no extra signal — GDELT updates every 15 min but
// our 8-article window doesn't churn faster than daily).  Reuses
// publicTrendingSeed's upsert mutations so URL dedupe is shared.
crons.daily(
  "GDELT-lite trending seed",
  { hourUTC: 8, minuteUTC: 0 },
  internal.domains.monitoring.gdeltSeed.seedGdeltTrending,
  {},
);

// Phase 8a §4: live editorial scoreboard.  Pulls OpenAlex cs.AI paper
// count, HN Algolia AI front-page volume, and GitHub trending AI-agent
// repo median stars.  Writes/patches today's dailyBriefSnapshots row's
// keyStats.  Daily at 09:00 UTC so it lands before US morning traffic.
crons.daily(
  "editorial scoreboard (OpenAlex + HN + GitHub)",
  { hourUTC: 9, minuteUTC: 0 },
  internal.domains.research.editionScoreboardSeed.seedDailyKeyStats,
  {},
);

// Phase 9a: MCP server count daily counter.  Scrapes mcpservers.org
// for the current "Showing N of TOTAL servers" tagline and patches
// today's keyStats with one extra row labelled "MCP servers tracked".
// Runs at 06:00 UTC — lands before the editorial scoreboard at 09:00.
crons.daily(
  "MCP server count (mcpservers.org)",
  { hourUTC: 6, minuteUTC: 0 },
  internal.domains.research.mcpServerCountSeed.seedMcpServerCount,
  {},
);

// Phase 10a: FRED-lite macro indicators (CPI, fed funds, unemployment,
// GDP, M2, 10Y Treasury) for the editorial home's §4 Scoreboard.
// FRED's daily release window closes ~16:00 ET (~21:00 UTC); 08:00 UTC
// the next morning catches the previous day's release.  Runs after
// MCP-count (06:00 UTC) and before the editorial scoreboard (09:00 UTC)
// so all three sets land in today's snapshot before US morning traffic.
crons.daily(
  "FRED-lite macro stats",
  { hourUTC: 8, minuteUTC: 0 },
  internal.domains.integrations.macro.fredSeed.seedFredStats,
  {},
);

// ═══════════════════════════════════════════════════════════════════════════
// X ALGORITHM FEATURES - Phoenix ML powered discovery (Phase 2-6)
// ═══════════════════════════════════════════════════════════════════════════

// Update agent marketplace rankings hourly (Phase 4)
// Recalculates Phoenix scores based on success rate, usage, latency, engagement
crons.interval(
  "update agent marketplace rankings",
  { hours: 1 },
  internal.domains.agents.agentMarketplace.updateAgentRankings,
  {}
);

// Discover trending GitHub repositories hourly (Phase 6)
// Fetches trending repos for AI/LLM topics and scores with Phoenix ML
crons.interval(
  "discover trending GitHub repos",
  { hours: 1 },
  internal.domains.research.githubExplorer.discoverTrendingRepos,
  { userInterests: ["ai", "llm", "agents", "machine-learning"] }
);

// Cleanup old dead-letters daily (keep 30 days)
crons.daily(
  "cleanup artifact dead-letters",
  { hourUTC: 4, minuteUTC: 45 },
  internal.lib.artifactPersistence.cleanupDeadLetters,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// Global Research Ledger: Compaction and maintenance crons
// ═══════════════════════════════════════════════════════════════════════════

// Compact raw mentions to aggregates daily (process 24h window per run)
crons.daily(
  "compact global mentions",
  { hourUTC: 2, minuteUTC: 0 },
  internal.globalResearch.compaction.compactMentions,
  {}
);

// Purge old raw mentions beyond 30-day retention
crons.daily(
  "purge old global mentions",
  { hourUTC: 2, minuteUTC: 30 },
  internal.globalResearch.compaction.purgeMentions,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// Calendar ingestion (Gmail/GCal) reconciliation
// ═══════════════════════════════════════════════════════════════════════════

crons.interval(
  "gmail ingest recent messages",
  { hours: 1 },
  internal.domains.integrations.gmail.ingestMessagesCron,
  {}
);

crons.interval(
  "email intelligence sweep",
  { minutes: 15 },
  internal.crons.emailIntelligenceCron.runEmailIntelligenceSweep,
  { maxEmails: 10 }
);

// ═══════════════════════════════════════════════════════════════════════════
// Email Management System - Full thread management, categorization & reports
// ═══════════════════════════════════════════════════════════════════════════

// Sync and process new emails every 30 minutes
// Fetches threads from Gmail, analyzes & categorizes using AI agent
crons.interval(
  "email sync and process",
  { minutes: 30 },
  internal.domains.agents.emailAgent.processNewEmailsCron,
  {}
);

// Generate and deliver daily email reports at 10:00 PM UTC (end of business day)
// Creates nested groupings by category, sends via email and/or ntfy
crons.daily(
  "daily email report",
  { hourUTC: 22, minuteUTC: 0 },
  internal.domains.integrations.email.dailyEmailReport.runDailyEmailReportCron,
  {}
);

// Detect urgent emails and send alerts every 15 minutes
// Identifies emails needing immediate attention based on AI priority or keywords
crons.interval(
  "urgent email alerts",
  { minutes: 15 },
  internal.domains.agents.emailAgent.urgentEmailAlertsCron,
  {}
);

// Renew Gmail push notification watches daily (watches expire after ~7 days)
crons.daily(
  "renew Gmail watches",
  { hourUTC: 1, minuteUTC: 0 },
  internal.domains.integrations.email.emailWebhook.renewGmailWatchesCron,
  {}
);

crons.interval(
  "gcal sync primary calendar",
  { hours: 1 },
  internal.domains.integrations.gcal.syncPrimaryCalendar,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// SMS Meeting Reminders
// ═══════════════════════════════════════════════════════════════════════════

// Send SMS reminders for upcoming meetings (runs every 5 minutes)
crons.interval(
  "send meeting reminder SMS",
  { minutes: 5 },
  internal.domains.integrations.sms.sendMeetingRemindersCron,
  {}
);

// Deduplicate global artifacts (merge race-condition duplicates)
crons.daily(
  "dedupe global artifacts",
  { hourUTC: 3, minuteUTC: 30 },
  internal.globalResearch.compaction.dedupeArtifacts,
  {}
);

// Self maintenance: audit invariants and persist a boolean-gated report
crons.daily(
  "self maintenance",
  { hourUTC: 5, minuteUTC: 10 },
  internal.domains.operations.selfMaintenance.runNightlySelfMaintenanceCron,
  {}
);

// Response flywheel maintenance: keep recent assistant replies reviewed and
// re-sync outer-loop scoring against the latest response-quality signals.
crons.interval(
  "response flywheel backfill",
  { hours: 6 },
  internal.domains.agents.responseFlywheel.runResponseFlywheelMaintenance,
  { limit: 24, forceRejudge: false, syncSuccessLoops: true }
);

crons.daily(
  "response flywheel rejudge",
  { hourUTC: 5, minuteUTC: 40 },
  internal.domains.agents.responseFlywheel.runResponseFlywheelMaintenance,
  { limit: 16, forceRejudge: true, syncSuccessLoops: true }
);

// Cleanup stale locks hourly (locks stuck in "running" > 1 hour)
crons.interval(
  "cleanup stale global locks",
  { hours: 1 },
  internal.globalResearch.compaction.cleanupStaleLocks,
  { maxAgeMs: 60 * 60 * 1000 }
);

// Purge old research events weekly (keep 90 days)
crons.weekly(
  "purge old research events",
  { dayOfWeek: "sunday", hourUTC: 3, minuteUTC: 0 },
  internal.globalResearch.compaction.purgeOldEvents,
  { retentionDays: 90 }
);

// ═══════════════════════════════════════════════════════════════════════════
// Meta-Tool Discovery: Cache maintenance crons
// ═══════════════════════════════════════════════════════════════════════════

// Cleanup expired tool search cache entries hourly (TTL: 1 hour)
crons.interval(
  "cleanup tool search cache",
  { hours: 1 },
  internal.tools.meta.hybridSearchQueries.invalidateExpiredCache,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// Search Fusion: Benchmark evaluation retention cleanup
// ═══════════════════════════════════════════════════════════════════════════

// Cleanup old search evaluations weekly (90-day retention policy)
// Runs Sunday at 5:00 AM UTC to avoid peak usage hours
crons.weekly(
  "cleanup search evaluations",
  { dayOfWeek: "sunday", hourUTC: 5, minuteUTC: 0 },
  internal.domains.search.fusion.benchmark.cleanupOldEvaluations,
  {}
);

// Weekly forecast calibration (Sunday 6:00 AM UTC)
// Computes calibration bins + Brier aggregates for track record
crons.weekly(
  "weekly forecast calibration",
  { dayOfWeek: "sunday", hourUTC: 6, minuteUTC: 0 },
  internal.domains.forecasting.cronHandlers.weeklyCalibration.handler,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// Feed Ingestion Crons
// ═══════════════════════════════════════════════════════════════════════════

// Ingest Hacker News hourly (top stories)
crons.interval("ingest Hacker News feed", { hours: 1 }, internal.feed.ingestHackerNewsInternal, {});

// Ingest ArXiv CS.AI papers every 6 hours (new papers published at ~8pm ET)
crons.interval("ingest ArXiv AI papers", { hours: 6 }, internal.feed.ingestArXivInternal, {});

// Ingest Reddit /r/MachineLearning every 4 hours
crons.interval("ingest Reddit ML feed", { hours: 4 }, internal.feed.ingestRedditInternal, {});

// Ingest RSS feeds every 2 hours (TechCrunch, etc.)
crons.interval("ingest RSS tech feeds", { hours: 2 }, internal.feed.ingestRSSInternal, {});

// ═══════════════════════════════════════════════════════════════════════════
// BLIPS PIPELINE - "Undo AI Slop" Meaning Blips Feed
// Daily ingestion → claim extraction → blip generation → verification → persona lenses
// ═══════════════════════════════════════════════════════════════════════════

// Run phased blip pipeline daily at 6:30 AM UTC (after morning brief)
// Uses scheduling to break up long-running pipeline into phases
crons.daily(
  "run blips pipeline (phased)",
  { hourUTC: 6, minuteUTC: 30 },
  internal.domains.blips.blipPipeline.runPipelinePhased,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// Funding Detection Pipeline - Auto-detect funding from feeds, enrich, dedupe
// ═══════════════════════════════════════════════════════════════════════════

// Scan feed items for funding announcements every 30 minutes
// Runs after feed ingestion to detect new funding events
crons.interval(
  "detect funding from feeds",
  { minutes: 30 },
  internal.domains.enrichment.fundingDetection.detectFundingCandidates,
  { lookbackHours: 6, minConfidence: 0.3, limit: 50 }
);

// Process enrichment queue every 5 minutes
// Handles funding_detection, entity_promotion, verification jobs
crons.interval(
  "process enrichment queue",
  { minutes: 5 },
  internal.domains.enrichment.enrichmentWorker.startBatchProcessing,
  { limit: 10 }
);

// ═══════════════════════════════════════════════════════════════════════════
// Daily Morning Brief - Automated dashboard metrics and digest generation
// ═══════════════════════════════════════════════════════════════════════════

// Run daily morning brief at 6:00 AM UTC
// Orchestrates: feed ingestion → dashboard metrics → digest generation → storage
crons.daily(
  "generate daily morning brief",
  { hourUTC: 6, minuteUTC: 0 },
  internal.workflows.dailyMorningBrief.runDailyMorningBrief,
  {}
);

// ── FORECASTING OS ──────────────────────────────────────────────────────────
// Refresh forecasts before LinkedIn digest, check resolutions after

// Daily forecast refresh at 5:00 AM UTC (before 6:15 AM LinkedIn digest)
// TRACE-wrapped: every step is audited to traceAuditEntries (executionType: "forecast_refresh")
crons.daily(
  "daily forecast refresh",
  { hourUTC: 5, minuteUTC: 0 },
  internal.domains.forecasting.traceWrapper.tracedForecastRefresh,
  {}
);

// Post daily digest to LinkedIn at 6:15 AM UTC (15 min after digest generation)
// Uses fact-checked findings + digest summary, formatted for professional audience
crons.daily(
  "post daily digest to LinkedIn",
  { hourUTC: 6, minuteUTC: 15 },
  internal.workflows.dailyLinkedInPost.postDailyDigestToLinkedIn,
  { persona: "GENERAL" }
);

// Daily forecast resolution check at 7:00 AM UTC
// Flags forecasts past their resolution date for manual review
crons.daily(
  "forecast resolution check",
  { hourUTC: 7, minuteUTC: 0 },
  internal.domains.forecasting.cronHandlers.resolutionCheck.handler,
  {}
);

// Generate daily AI Agent Project Idea post at 7:15 AM UTC
// Reads digest, picks most buildable signal, recommends nodebench-mcp tools
crons.daily(
  "generate agent project idea post",
  { hourUTC: 7, minuteUTC: 15 },
  internal.workflows.agentProjectIdeaPost.generateAgentProjectIdeaPost,
  {}
);

// Post daily funding tracker to LinkedIn at 12:00 PM UTC (separate from main digest)
// Dedicated post for startup funding news, ranked by amount
crons.daily(
  "post daily funding to LinkedIn",
  { hourUTC: 12, minuteUTC: 0 },
  internal.workflows.dailyLinkedInPost.postDailyFundingToLinkedIn,
  { hoursBack: 24 }
);

// Post VC Deal Flow Memo to LinkedIn at 9:00 AM UTC
// Investment-focused content for VCs and investors
crons.daily(
  "post VC deal flow memo to LinkedIn",
  { hourUTC: 9, minuteUTC: 0 },
  internal.workflows.dailyLinkedInPost.postDailyDigestToLinkedIn,
  { persona: "VC_INVESTOR" }
);

// Post Tech Radar to LinkedIn at 3:00 PM UTC
// Engineering intelligence for CTOs and developers
crons.daily(
  "post tech radar to LinkedIn",
  { hourUTC: 15, minuteUTC: 0 },
  internal.workflows.dailyLinkedInPost.postDailyDigestToLinkedIn,
  { persona: "TECH_BUILDER" }
);

// Post Startup Funding Brief to LinkedIn at 10:00 AM UTC
// Detailed company profiles with founders, products, investors
crons.daily(
  "post startup funding brief to LinkedIn",
  { hourUTC: 10, minuteUTC: 0 },
  internal.workflows.dailyLinkedInPost.postStartupFundingBrief,
  { hoursBack: 48, maxProfiles: 5 }
);

// ═══════════════════════════════════════════════════════════════════════════
// SPECIALIZED LINKEDIN POSTS - FDA, Research, Clinical Trials, M&A
// ═══════════════════════════════════════════════════════════════════════════

// Post FDA regulatory updates to LinkedIn at 11:00 AM UTC (Tue/Thu)
// 510(k) clearances, PMA approvals, recalls for biotech/medtech sectors
crons.daily(
  "post FDA updates to LinkedIn",
  { hourUTC: 11, minuteUTC: 0 },
  internal.workflows.specializedLinkedInPosts.postFDAUpdates,
  { lookbackHours: 48, testMode: false }
);

// Post academic research highlights to LinkedIn at 2:00 PM UTC (Mon/Wed/Fri)
// Significant papers related to tracked companies and sectors
crons.daily(
  "post academic research to LinkedIn",
  { hourUTC: 14, minuteUTC: 0 },
  internal.workflows.specializedLinkedInPosts.postAcademicResearch,
  { lookbackDays: 7, testMode: false }
);

// Post clinical trial milestones to LinkedIn at 4:00 PM UTC (weekly on Thu)
// Phase transitions, results posted, significant new trials
crons.weekly(
  "post clinical trial milestones to LinkedIn",
  { dayOfWeek: "thursday", hourUTC: 16, minuteUTC: 0 },
  internal.workflows.specializedLinkedInPosts.postClinicalTrialMilestones,
  { lookbackDays: 7, testMode: false }
);

// Post M&A activity to LinkedIn at 1:00 PM UTC (Mon)
// Acquisitions, mergers, strategic investments in tracked sectors
crons.weekly(
  "post MA activity to LinkedIn",
  { dayOfWeek: "monday", hourUTC: 13, minuteUTC: 0 },
  internal.workflows.specializedLinkedInPosts.postMAActivity,
  { lookbackDays: 7, testMode: false }
);

// ═══════════════════════════════════════════════════════════════════════════
// LINKEDIN CONTENT QUEUE - Judge, schedule, and post from backlog
// ═══════════════════════════════════════════════════════════════════════════

// Judge pending queue items every 30 minutes (uses FREE models: qwen3-coder-free)
crons.interval(
  "judge pending LinkedIn queue",
  { minutes: 30 },
  internal.domains.social.linkedinQualityJudge.batchJudgePending,
  { limit: 5 }
);

// Schedule approved posts into time slots every hour
crons.interval(
  "schedule approved LinkedIn posts",
  { hours: 1 },
  internal.domains.social.linkedinScheduleGrid.scheduleNextApprovedPost,
  { target: "organization" }
);

// Post scheduled items when they're due (hourly) — handles both org and personal targets
crons.interval(
  "process LinkedIn queue",
  { hours: 1 },
  internal.domains.social.linkedinPosting.processQueuedPost,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// FOUNDER PERSONAL POSTS - Auto-generated in founder voice (3/week)
// ═══════════════════════════════════════════════════════════════════════════

// Generate all 3 personal posts for the week (Sun 10PM UTC = prep for week ahead)
crons.weekly(
  "generate founder personal posts",
  { dayOfWeek: "sunday", hourUTC: 22, minuteUTC: 0 },
  internal.workflows.founderPostGenerator.weeklyFounderBatch,
  {}
);

// Schedule approved personal posts into Mon/Wed/Fri evening slots (every 2 hours)
crons.interval(
  "schedule approved personal LinkedIn posts",
  { hours: 2 },
  internal.domains.social.linkedinScheduleGrid.scheduleNextApprovedPost,
  { target: "personal" }
);

// Advance Daily Brief domain memory tasks every 15 minutes
crons.interval(
  "advance daily brief tasks",
  { minutes: 15 },
  internal.domains.research.dailyBriefWorker.runNextTaskInternal,
  {}
);

// Agent run orchestration: reclaim expired leases frequently so work can be picked up by other workers.
crons.interval(
  "reclaim expired agent run leases",
  { minutes: 1 },
  internal.domains.agents.orchestrator.queueProtocol.reclaimExpiredLeases,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// AUTONOMOUS AGENT ECOSYSTEM - Deep Agents 3.0
// Zero-Human-Input Continuous Intelligence Platform
// ═══════════════════════════════════════════════════════════════════════════

// --- Signal Ingestion ---
// Ingest signals from all configured sources (RSS feeds, etc.) every 5 minutes
crons.interval(
  "autonomous signal ingestion",
  { minutes: 5 },
  internal.domains.signals.signalIngester.tickSignalIngestion,
  {}
);

// Process pending signals every minute
crons.interval(
  "autonomous signal processing",
  { minutes: 1 },
  internal.domains.signals.signalProcessor.tickSignalProcessing,
  {}
);

// --- Research Queue ---
// Run autonomous research loop every minute
// Dequeues highest priority tasks and executes research swarms
crons.interval(
  "autonomous research loop",
  { minutes: 1 },
  internal.domains.research.autonomousResearcher.tickAutonomousResearch,
  {}
);

// --- Publishing Pipeline ---
// Process publishing tasks (format and deliver to channels)
crons.interval(
  "autonomous publishing",
  { minutes: 1 },
  internal.domains.publishing.publishingOrchestrator.tickPublishing,
  {}
);

// Process delivery queue (retry failed deliveries)
crons.interval(
  "autonomous delivery queue",
  { minutes: 1 },
  internal.domains.publishing.deliveryQueue.tickDeliveryQueue,
  {}
);

// --- Entity Lifecycle ---
// Update entity decay scores hourly
crons.interval(
  "entity decay hourly update",
  { hours: 1 },
  internal.domains.entities.decayManager.tickDecayUpdate,
  {}
);

// Daily decay check and stale entity re-research queuing
// Runs at midnight UTC to identify and queue stale entities
crons.daily(
  "entity decay daily check",
  { hourUTC: 0, minuteUTC: 0 },
  internal.domains.entities.decayManager.checkAndQueueStale,
  {}
);

// --- Cleanup Jobs ---
// Cleanup old research tasks weekly (completed/failed > 7 days)
crons.weekly(
  "cleanup old research tasks",
  { dayOfWeek: "sunday", hourUTC: 4, minuteUTC: 0 },
  internal.domains.research.researchQueue.cleanupOldTasks,
  {}
);

// Cleanup expired signals weekly
crons.weekly(
  "cleanup expired signals",
  { dayOfWeek: "sunday", hourUTC: 4, minuteUTC: 15 },
  internal.domains.signals.signalIngester.cleanupExpiredSignals,
  {}
);

// Cleanup old delivery jobs weekly
crons.weekly(
  "cleanup old delivery jobs",
  { dayOfWeek: "sunday", hourUTC: 4, minuteUTC: 30 },
  internal.domains.publishing.deliveryQueue.cleanupOldJobs,
  {}
);

// --- Self-Questioning & Validation (Phase 3) ---
// Auto-resolve low-severity contradictions daily
crons.daily(
  "auto-resolve contradictions",
  { hourUTC: 5, minuteUTC: 0 },
  internal.domains.validation.contradictionDetector.autoResolveContradictions,
  { limit: 100 }
);

// --- Persona-Driven Autonomy (Phase 6) ---
// Run all-persona autonomous research every 30 minutes
crons.interval(
  "persona autonomous research",
  { minutes: 30 },
  internal.domains.personas.personaAutonomousAgent.tickAllPersonas,
  {}
);

// Reset persona budgets daily at midnight UTC
crons.daily(
  "reset persona budgets",
  { hourUTC: 0, minuteUTC: 5 },
  internal.domains.personas.personaAutonomousAgent.initializeAllBudgets,
  {}
);

// --- Self-Healing & Observability (Phase 7) ---
// Run health checks every 5 minutes
crons.interval(
  "system health check",
  { minutes: 5 },
  internal.domains.observability.healthMonitor.tickHealthCheck,
  {}
);

// Run self-healing every 15 minutes
crons.interval(
  "autonomous self-healing",
  { minutes: 15 },
  internal.domains.observability.selfHealer.tickSelfHealing,
  {}
);

// Generate health report daily
crons.daily(
  "generate health report",
  { hourUTC: 7, minuteUTC: 0 },
  internal.domains.observability.healthMonitor.generateHealthReport,
  { hours: 24 }
);

// Cleanup old health checks weekly (keep 7 days)
crons.weekly(
  "cleanup old health checks",
  { dayOfWeek: "sunday", hourUTC: 4, minuteUTC: 45 },
  internal.domains.observability.healthMonitor.cleanupOldHealthChecks,
  {}
);

// Cleanup old healing actions weekly (keep 30 days)
crons.weekly(
  "cleanup old healing actions",
  { dayOfWeek: "sunday", hourUTC: 5, minuteUTC: 0 },
  internal.domains.observability.selfHealer.cleanupOldHealingActions,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// LINKEDIN TOKEN REFRESH - Auto-refresh before expiry
// ═══════════════════════════════════════════════════════════════════════════

// Check LinkedIn token health daily at 00:00 UTC; refresh proactively 7 days before expiry
crons.daily(
  "check and refresh LinkedIn token",
  { hourUTC: 0, minuteUTC: 0 },
  internal.domains.social.linkedinOAuth.checkAndRefreshToken,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// FREE MODEL DISCOVERY & EVALUATION - Zero-cost autonomous operations
// ═══════════════════════════════════════════════════════════════════════════

// Discover and evaluate free models hourly
crons.interval(
  "free model discovery and evaluation",
  { hours: 1 },
  internal.domains.models.freeModelDiscovery.tickModelDiscovery,
  {}
);

// ============================================================================
// OPERATIONS - SLO Collection + Burn-Rate Alerting
// ============================================================================

// Collect SLO measurements and evaluate burn-rate/compliance alerts.
// Runs frequently to support multi-window alerting (e.g., 1h/5m windows).
crons.interval(
  "collect SLO measurements and evaluate alerts",
  { minutes: 5 },
  internal.domains.operations.sloCollector.collectAndEvaluateAlerts,
  {}
);

// ============================================================================
// OPERATIONS - Privacy / Retention / DSAR
// ============================================================================

// Enforce data-class retention policies (TTL) daily.
crons.daily(
  "privacy retention TTL deletion",
  { hourUTC: 2, minuteUTC: 45 },
  internal.domains.operations.privacyEnforcement.runTtlDeletion,
  {}
);

// Process pending GDPR deletion requests hourly.
crons.interval(
  "process pending deletion requests",
  { hours: 1 },
  internal.domains.operations.privacyEnforcement.processPendingDeletionRequests,
  { limit: 10 }
);

// Cleanup old autonomous model usage weekly (keep 7 days)
crons.weekly(
  "cleanup autonomous model usage",
  { dayOfWeek: "sunday", hourUTC: 5, minuteUTC: 15 },
  internal.domains.models.autonomousModelResolver.cleanupOldUsageRecords,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARKING & MODEL EVALUATION - Free-first strategy quality gates
// ═══════════════════════════════════════════════════════════════════════════

// Live performance evaluation of all active free models daily at 02:00 UTC
// Runs 13 evaluation scenarios across 4 task types, updates rankings
crons.daily(
  "live model performance evaluation",
  { hourUTC: 2, minuteUTC: 0 },
  internal.domains.models.livePerformanceEval.evaluateAllModels,
  {}
);

// Tool health benchmark daily at 03:00 UTC (after model eval completes)
// Checks circuit breaker states, records pass/fail into benchmarkRuns
crons.daily(
  "tool health benchmark suite",
  { hourUTC: 3, minuteUTC: 0 },
  internal.domains.evaluation.cronHandlers.tickToolHealthBenchmark,
  {}
);

// Leaderboard snapshot daily at 04:00 UTC (after benchmarks complete)
// Snapshots free model rankings into workbenchRuns for trending/UI
crons.daily(
  "leaderboard snapshot refresh",
  { hourUTC: 4, minuteUTC: 0 },
  internal.domains.evaluation.cronHandlers.refreshLeaderboardSnapshot,
  {}
);

// DD calibration benchmark weekly on Sunday at 06:00 UTC
// Runs full due diligence benchmark suite, detects scoring drift
crons.weekly(
  "dd calibration benchmark",
  { dayOfWeek: "sunday", hourUTC: 6, minuteUTC: 0 },
  internal.domains.evaluation.cronHandlers.tickCalibrationBenchmark,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// AGENT OS - Sweep undispatched proactive events to agents
// ═══════════════════════════════════════════════════════════════════════════

// Sweep undispatched events every 30 minutes and route them to available agents
crons.interval(
  "sweep undispatched events to agents",
  { minutes: 30 },
  internal.domains.proactive.agentDispatch.sweepAndDispatch,
  {}
);

// Perpetual agent loop: tick all active agents every 15 minutes
// Checks eligibility (budget, rate limit, concurrency), pulls dispatched events, executes work
crons.interval(
  "perpetual agent loop tick",
  { minutes: 15 },
  internal.domains.agents.agentLoop.tickAgentLoop,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// BATCH AUTOPILOT — Per-user scheduled autonomy
// Sweeps pending schedules every 15 minutes, triggers batch runs
// ═══════════════════════════════════════════════════════════════════════════

crons.interval(
  "batch autopilot sweep",
  { minutes: 15 },
  internal.domains.batchAutopilot.scheduler.sweepPendingRuns,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// NARRATIVE DOMAIN - Defensibility Guards (Phase 8)
// ═══════════════════════════════════════════════════════════════════════════

// Expire old quarantine entries daily
// Marks pending entries past their expiry date as expired
crons.daily(
  "expire quarantine entries",
  { hourUTC: 1, minuteUTC: 30 },
  internal.domains.narrative.cronHandlers.expireQuarantineEntries,
  {}
);

// Enforce content TTL daily
// Deletes content past its TTL based on content rights policies
crons.daily(
  "enforce content TTL",
  { hourUTC: 2, minuteUTC: 0 },
  internal.domains.narrative.cronHandlers.enforceContentTTL,
  {}
);

// Cleanup old search logs weekly (90-day retention)
crons.weekly(
  "cleanup narrative search logs",
  { dayOfWeek: "sunday", hourUTC: 3, minuteUTC: 15 },
  internal.domains.narrative.cronHandlers.cleanupOldSearchLogs,
  {}
);

// Process high-scoring feed items into narrative events daily
// Runs after the weekly pipeline to catch any high-signal content
crons.daily(
  "process feed items to narrative",
  { hourUTC: 7, minuteUTC: 0 },
  internal.domains.narrative.integrations.hooks.processFeedItemsToNarrative,
  { lookbackDays: 1, minPhoenixScore: 75 }
);

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULED PDF REPORTS - Automated funding report generation
// ═══════════════════════════════════════════════════════════════════════════

// Weekly funding report - Every Monday at 8:00 AM UTC
// Generates PDF with AI insights and distributes to Discord/ntfy
crons.weekly(
  "generate weekly funding PDF report",
  { dayOfWeek: "monday", hourUTC: 8, minuteUTC: 0 },
  internal.workflows.scheduledPDFReports.runWeeklyReportCron,
  {}
);

// Monthly funding report - 1st of each month at 9:00 AM UTC
// Full distribution including LinkedIn
crons.monthly(
  "generate monthly funding PDF report",
  { day: 1, hourUTC: 9, minuteUTC: 0 },
  internal.workflows.scheduledPDFReports.runMonthlyReportCron,
  {}
);

// Quarterly funding report - 1st of quarter (Jan, Apr, Jul, Oct) at 10:00 AM UTC
// Comprehensive JPMorgan-style executive summary
// Note: Using monthly cron with day filter since Convex doesn't have quarterly cron
crons.monthly(
  "generate quarterly funding PDF report",
  { day: 1, hourUTC: 10, minuteUTC: 0 },
  internal.workflows.scheduledPDFReports.runQuarterlyReportCron,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// AMBIENT INTELLIGENCE — Phase 11 canonicalization pipeline
// Ingestion → change detection → packet readiness → pruning
// ═══════════════════════════════════════════════════════════════════════════

// Process ingestion queue every 30 seconds (canonicalize raw items)
crons.interval(
  "ambient ingestion queue processing",
  { seconds: 30 },
  internal.domains.founder.ambientIntelligenceJobs.processIngestionQueue,
  {}
);

// Detect ambient changes every 5 minutes (scan recent canonical objects)
crons.interval(
  "ambient change detection",
  { minutes: 5 },
  internal.domains.founder.ambientIntelligenceJobs.detectAmbientChanges,
  {}
);

// Assess packet readiness every 15 minutes (staleness scoring per company)
crons.interval(
  "ambient packet readiness assessment",
  { minutes: 15 },
  internal.domains.founder.ambientIntelligenceJobs.assessPacketReadiness,
  {}
);

// Prune and compact daily at 3:30 AM UTC (old ingestions, resolved detections, superseded chains)
crons.daily(
  "ambient prune and compact",
  { hourUTC: 3, minuteUTC: 30 },
  internal.domains.founder.ambientIntelligenceJobs.pruneAndCompact,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// Product Nudges — check saved reports for staleness
// ═══════════════════════════════════════════════════════════════════════════

crons.daily(
  "check reports for nudges",
  { hourUTC: 9, minuteUTC: 0 },
  internal.domains.product.nudges.checkReportsForNudges,
  {}
);

// Entity tracking dispatcher. Walks productNudgeSubscriptions every
// 5 minutes, posts one ntfy per subscription whose entity has been
// touched by an agent since lastNotifiedAt. Idle subscriptions cost
// a single indexed read per tick. See docs/architecture/ENTITY_PAGE_
// FRAMEWORK_AUDIT.md violation #5 + docs/architecture/NOTEBOOK_
// HARDENING_CHANGELOG.md row for this feature.
crons.interval(
  "dispatch entity tracking notifications",
  { minutes: 5 },
  internal.domains.product.notebookTracking.scanAndDispatch,
  { batchSize: 50 }
);

// Async reliability: sweep due rows in pipelineRetries every 5 minutes.
// Per .claude/rules/async_reliability.md §3, long-horizon retries
// (+12h / +24h / +48h for data_unavailable failures) live on the
// pipelineRetries table; this cron promotes due rows into active runs.
// BOUND — 50 rows per sweep, claims via markRetryInFlight to prevent
// double-dispatch across overlapping ticks.
crons.interval(
  "dispatch due pipeline retries",
  { minutes: 5 },
  internal.domains.product.pipelineRetryDispatcher.dispatchDueRetries,
  { limit: 50 }
);

// ═══════════════════════════════════════════════════════════════════════════
// PR E — Embedding pipeline auto-hooks: daily stale sweep
// ═══════════════════════════════════════════════════════════════════════════
//
// Belt-and-suspenders cron for the per-row embed scheduler. Every mutation
// that touches a productEntities / productReports / productBlocks row now
// schedules embedRowOnUpdate.embedXxxRow immediately after the write. This
// cron is the safety net for rows that slipped through (e.g. scheduler
// dropouts, pre-PR-E rows that never had a hook fire).
//
// BOUND: batchSize=200, ~25 KB OpenAI bodies, MAX_STALE_PAGES=20 — total
// upper bound per sweep is ~$0.02 at current text-embedding-3-small pricing.
// HONEST_STATUS: skipped/embedded/failed counts returned in telemetry.
// TIMEOUT: per-call 30s, total cron capped by Convex 10-min action budget.
crons.interval(
  "embed stale product rows (daily)",
  { hours: 24 },
  internal.domains.search.embedRowOnUpdate.embedStaleRows,
  { batchSize: 200 },
);

export default crons;
