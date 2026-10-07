"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { generateMorningDigestEmail, type MeetingReminder } from "../domains/integrations/email/morningDigestEmailTemplate";

/**
 * Daily Morning Brief Workflow
 *
 * Orchestrates the automated daily morning brief generation:
 * 1. Ingest fresh data from all free sources (HN, GitHub, Dev.to, ArXiv, etc.)
 * 2. Calculate dashboard metrics for StickyDashboard
 * 3. Generate AI summary for Morning Digest
 * 4. Store results in database
 * 5. Send meeting reminder emails to users with events today
 *
 * Runs daily at 6:00 AM UTC via cron job
 */
export const runDailyMorningBrief = (internalAction as any)({
  args: {},
  handler: async (ctx: any): Promise<any> => {
    const startTime = Date.now();
    console.log("[dailyMorningBrief] dYO. Starting daily morning brief workflow...");

    const errors: string[] = [];
    let ntfySent = false;
    let ntfySkipped = false;

    try {
      // ========================================================================
      // STEP 1: Ingest fresh data from all free sources
      // ========================================================================
      console.log("[dailyMorningBrief] dY\" Step 1: Ingesting data from all sources...");

      const ingestResult: any = await ctx.runAction(api.feed.ingestAll, {});

      console.log("[dailyMorningBrief] ƒo. Ingestion complete:", {
        hackerNews: ingestResult.hackerNews,
        github: ingestResult.github,
        devTo: ingestResult.devTo,
        arxiv: ingestResult.arxiv,
        reddit: ingestResult.reddit,
      });

      // Track any ingestion errors
      if (ingestResult.hackerNews?.status === "error") {
        errors.push(`HackerNews: ${ingestResult.hackerNews.message}`);
      }
      if (ingestResult.github?.status === "error") {
        errors.push(`GitHub: ${ingestResult.github.message}`);
      }
      if (ingestResult.devTo?.status === "error") {
        errors.push(`Dev.to: ${ingestResult.devTo.message}`);
      }

      // ========================================================================
      // STEP 2: Calculate dashboard metrics
      // ========================================================================
      console.log("[dailyMorningBrief] dY\"S Step 2: Calculating dashboard metrics...");

      const {
        dashboardMetrics,
        sourceSummary,
      }: any = await ctx.runAction(
        internal.domains.research.dashboardMetrics.calculateDashboardMetrics,
        {},
      );

      console.log("[dailyMorningBrief] ƒo. Dashboard metrics calculated");

      // ========================================================================
      // STEP 3: Source summary (derived from feed items)
      // ========================================================================
      console.log("[dailyMorningBrief] dY\"? Step 3: Generating source summary...");

      // ========================================================================
      // STEP 4: Store dashboard metrics
      // ========================================================================
      console.log("[dailyMorningBrief] dY\"'_ Step 4: Storing dashboard metrics...");

      const processingTime = Date.now() - startTime;

      const storeResult: any = await ctx.runMutation(
        internal.domains.research.dashboardMutations.storeDashboardMetrics,
        {
          dashboardMetrics,
          sourceSummary,
          processingTimeMs: processingTime,
        },
      );

      console.log("[dailyMorningBrief] ƒo. Metrics stored:", storeResult);

      // ========================================================================
      // STEP 5: Initialize daily brief domain memory (two-agent pattern)
      // ========================================================================
      try {
        await ctx.runAction(
          internal.domains.research.dailyBriefInitializer.initializeForSnapshot,
          { snapshotId: storeResult.snapshotId },
        );
        console.log("[dailyMorningBrief] ƒo. Domain memory initialized");
      } catch (initErr) {
        console.warn("[dailyMorningBrief] Domain memory init failed:", initErr);
      }

      // STEP 5b: Generate executive narrative brief (Structured Outputs + lint gate)
      // Best-effort: fetch the latest memory (should be the one we just initialized).
      try {
        const memory: any = await ctx.runQuery(
          internal.domains.research.dailyBriefMemoryQueries.getLatestMemoryInternal,
          {},
        );
        if (memory?._id && memory.dateString === storeResult.dateString) {
          await ctx.runAction(
            internal.domains.research.executiveBrief.generateExecutiveBriefForMemoryInternal,
            { memoryId: memory._id },
          );
          console.log("[dailyMorningBrief] ’'o. Executive brief generated");
        }
      } catch (briefErr) {
        console.warn("[dailyMorningBrief] Executive brief generation failed:", briefErr);
      }

      // ========================================================================
      // STEP 5c: Send global ntfy morning digest (dense, verified)
      // ========================================================================
      console.log("[dailyMorningBrief] Step 5c: Sending ntfy morning digest...");

      try {
        const feedItems = await ctx.runQuery(
          internal.domains.research.dashboardQueries.getFeedItemsForMetrics,
          {},
        ) as FeedItemLite[];

        const memoriesForDate: any[] = await ctx.runQuery(
          internal.domains.research.dailyBriefMemoryQueries.listMemoriesByDateStringInternal,
          { dateString: storeResult.dateString, limit: 15 },
        );
        const memoryForDate = memoriesForDate[0] ?? null;
        const latestMemory: any = await ctx.runQuery(
          internal.domains.research.dailyBriefMemoryQueries.getLatestMemoryInternal,
          {},
        );
        const digestMemory = memoryForDate ?? latestMemory;
        const digestContext = (digestMemory?.context ?? {});
        const briefRecord = (digestContext)?.executiveBriefRecord;
        const executiveBrief =
          briefRecord?.brief ||
          digestContext.executiveBrief ||
          digestContext.generatedBrief ||
          null;
        let landingBriefBody: string | null =
          typeof digestContext.ntfyDigestBody === "string" && digestContext.ntfyDigestBody.trim()
            ? digestContext.ntfyDigestBody.trim()
            : null;
        const alreadySent = memoriesForDate.some(
          (memory) => memory?.context?.ntfyDigestDate === storeResult.dateString,
        );

        if (alreadySent) {
          ntfySkipped = true;
          console.log("[dailyMorningBrief] ntfy digest already sent; skipping");
        } else {
          const signalUrls = Array.isArray(executiveBrief?.actII?.signals)
            ? executiveBrief.actII.signals
                .map((signal: any) => signal?.evidence?.[0]?.url)
                .filter((url: string) => typeof url === "string" && url.trim())
            : [];
          const topStoryUrls = getTopStories(feedItems, 12)
            .map((story) => story.url)
            .filter((url) => url && url.trim());
          const coverageUrls: string[] = Array.from(
            new Set(
              feedItems
                .map((item: FeedItemLite) => (item.url ?? "").trim())
                .filter((url: string) => url),
            ),
          );
          const coverageLimit = Math.min(coverageUrls.length, 60);
          const coverageTargetUrls: string[] = coverageUrls.slice(0, coverageLimit);
          const targetUrls: string[] = Array.from(
            new Set([...signalUrls, ...topStoryUrls, ...coverageTargetUrls]),
          );

          try {
            await ensureStoryTasks(ctx, digestMemory, feedItems, targetUrls, {
              maxSummaries: coverageLimit || 16,
              maxIntel: 5,
            });
          } catch (err: any) {
            console.warn("[dailyMorningBrief] ensure story tasks failed:", err?.message || err);
          }

          const coverageData = digestMemory?._id
            ? await collectCoverageSummaries(ctx, digestMemory, feedItems, coverageTargetUrls, {
                maxItems: coverageLimit || 16,
                concurrency: 4,
              })
            : { items: [], summaryByUrl: {} };
          const storySummaries = coverageData.summaryByUrl;
          const storyIntel = digestMemory?._id
            ? await collectStoryIntel(ctx, digestMemory, feedItems, targetUrls, 5)
            : {};
          const coverageRollup = coverageData.items.length > 0
            ? await ctx.runAction(
                (internal as any).domains.research.dailyBriefWorker.summarizeCoverageRollup,
                { items: coverageData.items, maxSources: 6 },
              )
            : null;
          const entityGraph = digestMemory?._id
            ? await collectGraphExtraction(ctx, digestMemory)
            : null;

          // Enrich top entities from the graph with banker-grade insights
          let enrichedEntities: EnrichedEntity[] = [];
          if (entityGraph) {
            try {
              enrichedEntities = await enrichTopEntitiesFromGraph(ctx, entityGraph, 3);
              console.log(`[dailyMorningBrief] Enriched ${enrichedEntities.length} entities`);
            } catch (err: any) {
              console.warn("[dailyMorningBrief] entity enrichment failed:", err?.message || err);
            }
          }

          if (entityGraph && storeResult.snapshotId) {
            try {
              await ctx.runMutation(
                internal.domains.research.dashboardMutations.patchDashboardEntityGraph,
                {
                  snapshotId: storeResult.snapshotId,
                  entityGraph,
                },
              );
            } catch (err: any) {
              console.warn("[dailyMorningBrief] entity graph patch failed:", err?.message || err);
            }
          }

          if (entityGraph && digestMemory?._id) {
            await ctx.runMutation(
              internal.domains.research.dailyBriefMemoryMutations.updateMemoryContext,
              {
                memoryId: digestMemory._id,
                contextPatch: {
                  entityGraph,
                },
              },
            );
          }
          if (digestMemory?._id && (coverageData.items.length > 0 || coverageRollup)) {
            await ctx.runMutation(
              internal.domains.research.dailyBriefMemoryMutations.updateMemoryContext,
              {
                memoryId: digestMemory._id,
                contextPatch: {
                  coverageSummaries: coverageData.items,
                  coverageRollup,
                  enrichedEntities: enrichedEntities.length > 0 ? enrichedEntities : undefined,
                },
              },
            );
          }

          const digestPayload = buildNtfyDigestPayload({
            dateString: storeResult.dateString,
            sourceSummary,
            dashboardMetrics,
            previousDashboardMetrics: digestContext.previousDashboardMetrics ?? null,
            feedItems,
            executiveBrief,
            storySummaries,
            storyIntel,
            coverageSummaries: coverageData.items,
            coverageRollup,
            entityGraph,
            enrichedEntities, // Banker-grade entity insights
            briefRecordStatus: briefRecord?.status,
            evidence: briefRecord?.evidence,
          });
          landingBriefBody = digestPayload.body;

          const chartAttachment = await buildNtfyChartAttachment(
            ctx,
            dashboardMetrics,
            digestMemory,
            storeResult.dateString,
          );

          await ctx.runAction(api.domains.integrations.ntfy.sendNotification, { 
            title: digestPayload.title, 
            body: digestPayload.body, 
            priority: 3, 
            tags: ["newspaper", "bar_chart", "briefcase"], 
            click: DASHBOARD_URL, 
            attach: chartAttachment?.url, 
            filename: chartAttachment ? `dashboard-${storeResult.dateString}.svg` : undefined, 
            eventType: "morning_digest", 
          }); 

          ntfySent = true; 
          console.log("[dailyMorningBrief] ntfy digest sent"); 

          if (digestMemory?._id) {
            await ctx.runMutation(
              internal.domains.research.dailyBriefMemoryMutations.updateMemoryContext,
              {
                memoryId: digestMemory._id,
                contextPatch: {
                  ntfyDigestDate: storeResult.dateString,
                  ntfyDigestSentAt: Date.now(),
                  ntfyDigestTitle: digestPayload.title,
                  ntfyDigestBody: digestPayload.body,
                  ntfyChartStorageId: chartAttachment?.storageId ?? digestContext.ntfyChartStorageId,
                  ntfyChartDate: chartAttachment ? storeResult.dateString : digestContext.ntfyChartDate,
                },
              },
            );
          }
        }

        // Always ensure the public landing log contains a brief entry, even if ntfy is skipped.
        try {
          const existing: any[] = await ctx.runQuery(api.domains.landing.landingPageLog.listPublic as any, {
            day: storeResult.dateString,
            limit: 200,
          });
          const hasBrief = Array.isArray(existing) && existing.some((e: any) => e?.kind === "brief");
          if (!hasBrief) {
            const fallbackSynthesis =
              executiveBrief?.actII?.synthesis ||
              executiveBrief?.actI?.brief ||
              executiveBrief?.summary ||
              null;
            const body =
              landingBriefBody ||
              (typeof fallbackSynthesis === "string" && fallbackSynthesis.trim()
                ? `**Executive Synthesis**\n\n${fallbackSynthesis.trim()}`
                : null);

            if (body) {
              await ctx.runMutation(internal.domains.landing.landingPageLog.appendSystem, {
                kind: "brief",
                title: `Morning Dossier - ${storeResult.dateString}`,
                markdown: `${body}\n\n${formatMarkdownLink("Open Signals Log", `${DASHBOARD_URL}#signals`)}`,
                source: "daily_brief_cron",
                tags: ["morning_brief", "automated"],
                day: storeResult.dateString,
              });
            }
          }
        } catch (logErr: any) {
          console.warn("[dailyMorningBrief] landingPageLog append failed:", logErr?.message || logErr);
        }
      } catch (ntfyErr: any) {
        console.warn("[dailyMorningBrief] ntfy digest failed:", ntfyErr?.message);
        errors.push(`ntfy digest: ${ntfyErr?.message}`);
      }

      // ========================================================================
      // STEP 5d: Send morning digest emails and SMS with meeting reminders
      // ========================================================================
      console.log("[dailyMorningBrief] Step 5d: Sending meeting reminder emails and SMS...");

      let emailsSent = 0;
      let smsSent = 0;
      try {
        // Get all users with events today
        const usersWithEvents: any[] = await ctx.runQuery(
          internal.domains.calendar.events.getUsersWithEventsToday,
          {},
        );

        console.log(`[dailyMorningBrief] Found ${usersWithEvents.length} users with events today`);

        // Format today's date for the email
        const today = new Date();
        const dateString = today.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

        // Send email and SMS to each user with events
        for (const userWithEvents of usersWithEvents) {
          // Format meetings for the templates
          const meetings: MeetingReminder[] = userWithEvents.events.map((event: any) => ({
            title: event.title || event.rawSummary || 'Untitled Event',
            startTime: event.startTime,
            endTime: event.endTime,
            location: event.location,
            description: event.description,
            allDay: event.allDay,
          }));

          // Send email if user has email
          if (userWithEvents.email) {
            try {
              // Generate the email HTML
              const emailHtml = generateMorningDigestEmail({
                recipientName: userWithEvents.name?.split(' ')[0], // First name only
                dateString,
                meetings,
                topInsight: sourceSummary.totalItems > 0
                  ? `Today we're tracking ${sourceSummary.totalItems} items across ${Object.keys(sourceSummary.bySource || {}).length} sources.`
                  : undefined,
              });

              // Send the email
              await ctx.runAction(api.domains.integrations.email.sendEmail, {
                to: userWithEvents.email,
                subject: `☀️ Morning Dossier - ${meetings.length} meeting${meetings.length !== 1 ? 's' : ''} today`,
                body: emailHtml,
              });

              emailsSent++;
              console.log(`[dailyMorningBrief] ✉️ Email sent to ${userWithEvents.email}`);
            } catch (emailErr: any) {
              console.warn(`[dailyMorningBrief] Failed to send email to ${userWithEvents.email}:`, emailErr?.message);
              errors.push(`Email to ${userWithEvents.email}: ${emailErr?.message}`);
            }
          }

          // Send SMS if user has SMS enabled
          try {
            const smsResult: any = await ctx.runAction(
              internal.domains.integrations.sms.sendMorningDigestSms,
              {
                userId: userWithEvents.userId,
                meetings: meetings.map((m: MeetingReminder) => ({
                  title: m.title,
                  startTime: m.startTime,
                  endTime: m.endTime,
                  location: m.location,
                })),
                dateString,
              },
            );
            if (smsResult.sent) {
              smsSent++;
              console.log(`[dailyMorningBrief] 📱 SMS sent to user ${userWithEvents.userId}`);
            }
          } catch (smsErr: any) {
            console.warn(`[dailyMorningBrief] Failed to send SMS to user ${userWithEvents.userId}:`, smsErr?.message);
            // Don't add to errors array - SMS is optional
          }
        }

        console.log(`[dailyMorningBrief] ✅ Sent ${emailsSent} emails and ${smsSent} SMS messages`);
      } catch (emailStepErr: any) {
        console.warn("[dailyMorningBrief] Meeting reminder emails/SMS step failed:", emailStepErr);
        errors.push(`Meeting reminders: ${emailStepErr?.message}`);
      }

      // ========================================================================
      // STEP 6: Summary and completion
      // ========================================================================
      const totalTime = Date.now() - startTime;

      console.log("[dailyMorningBrief] dYZ% Daily morning brief complete!", {
        totalTimeMs: totalTime,
        totalItems: sourceSummary.totalItems,
        ntfySent,
        ntfySkipped,
        emailsSent,
        errors: errors.length > 0 ? errors : "none",
        snapshotId: storeResult.snapshotId,
        dateString: storeResult.dateString,
        version: storeResult.version,
      });

      // ========================================================================
      // TRACK COMPONENT METRICS (Week 1 - Data Completeness Initiative)
      // ========================================================================
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

      // Build component metrics for each source
      const componentMetrics: Array<{
        date: string;
        reportType: "daily_brief" | "weekly_digest" | "funding_report" | "research_highlights";
        componentType: string;
        sourceName: string;
        category?: string;
        itemCount: number;
        freshnessHours?: number;
      }> = [];

      // Track items by source
      const bySource = sourceSummary.bySource || {};
      for (const [sourceName, count] of Object.entries(bySource)) {
        if (typeof count === 'number' && count > 0) {
          componentMetrics.push({
            date: today,
            reportType: "daily_brief",
            componentType: "feed_items",
            sourceName,
            itemCount: count,
            freshnessHours: 24, // Daily brief covers last 24 hours
          });
        }
      }

      // Track items by category (for top categories only)
      const byCategory = sourceSummary.byCategory || {};
      const topCategories = Object.entries(byCategory)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 5); // Top 5 categories

      for (const [categoryName, count] of topCategories) {
        if (typeof count === 'number' && count > 0) {
          componentMetrics.push({
            date: today,
            reportType: "daily_brief",
            componentType: "feed_items",
            sourceName: "All Sources",
            category: categoryName,
            itemCount: count,
            freshnessHours: 24,
          });
        }
      }

      // Record all component metrics
      try {
        await ctx.runMutation(internal.domains.analytics.componentMetrics.batchRecordComponentMetrics, {
          metrics: componentMetrics,
        });
        console.log(`[Analytics] Recorded ${componentMetrics.length} component metrics for daily brief ${today}`);
      } catch (e: any) {
        console.error(`[Analytics] Failed to record component metrics: ${e.message}`);
        // Don't fail the whole workflow if metrics recording fails
      }

      return {
        success: true,
        totalTimeMs: totalTime,
        sourceSummary,
        dashboardMetrics,
        ntfySent,
        ntfySkipped,
        emailsSent,
        errors: errors.length > 0 ? errors : undefined,
        snapshotId: storeResult.snapshotId,
        dateString: storeResult.dateString,
        version: storeResult.version,
      };
    } catch (error: any) {
      console.error("[dailyMorningBrief] ƒ?O Workflow failed:", error);

      return {
        success: false,
        error: error.message,
        errors,
        totalTimeMs: Date.now() - startTime,
      };
    }
  },
});

type FeedItemLite = {
  title: string;
  summary?: string;
  source?: string;
  tags?: string[];
  category?: string;
  score?: number;
  publishedAt?: string;
  type?: string;
  url?: string;
};

type StoryIntel = {
  summary?: string | null;
  hard_numbers?: string | null;
  direct_quote?: string | null;
  conflict?: string | null;
  pivot?: string | null;
  lesson?: string | null;
};

type GraphNode = {
  id: string;
  label: string;
  type?: string;
  importance?: number;
  tier?: number;
};

type GraphEdge = {
  source: string;
  target: string;
  relationship?: string;
  context?: string;
  impact?: string;
  order?: "primary" | "secondary";
};

type EntityGraph = {
  focusNodeId?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const STORY_SUMMARY_VERSION = 2;

type CoverageSummaryItem = {
  title: string;
  summary: string;
  url?: string;
  source?: string;
  category?: string;
};

type CoverageRollup = {
  overallSummary?: string;
  sourceSummaries?: Array<{ source: string; summary: string; count?: number }>;
  themes?: string[];
};

const DASHBOARD_URL = "https://nodebench-ai.vercel.app/";

function sanitizeText(input: string): string {
  return input
    .replace(/\u2026/g, ".")
    .replace(/\.{3,}/g, ".")
    .replace(/[^\x00-\x7F]/g, "");
}

function normalizeText(input?: string): string {
  return sanitizeText(input ?? "").replace(/\s+/g, " ").trim();
}

function stripMarkdown(input: string): string {
  return input
    .replace(/`+/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/^[#>\-\s]+/gm, "")
    .trim();
}

function sanitizeUrlForMarkdown(url: string): string {
  const trimmed = normalizeText(url);
  if (!trimmed) return "";
  try {
    return encodeURI(trimmed)
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/\[/g, "%5B")
      .replace(/\]/g, "%5D");
  } catch {
    return trimmed
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/\[/g, "%5B")
      .replace(/\]/g, "%5D");
  }
}

function formatMarkdownLink(label: string, url?: string, fallbackUrl?: string): string {
  const safeUrl = url ? sanitizeUrlForMarkdown(url) : "";
  if (safeUrl) return `[${label}](${safeUrl})`;
  const fallback = fallbackUrl ? sanitizeUrlForMarkdown(fallbackUrl) : "";
  if (fallback) return `[${label}](${fallback})`;
  return label;
}

function clipText(input: string, maxLen: number): string {
  const cleaned = normalizeText(input);
  if (cleaned.length <= maxLen) return cleaned;
  const slice = cleaned.slice(0, maxLen);
  const sentenceEnd = Math.max(
    slice.lastIndexOf("."),
    slice.lastIndexOf("!"),
    slice.lastIndexOf("?"),
  );
  if (sentenceEnd > Math.floor(maxLen * 0.6)) {
    return slice.slice(0, sentenceEnd + 1).trim().replace(/[[*(_]+$/g, "").trim();
  }
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxLen * 0.6)) {
    return slice.slice(0, lastSpace).trim().replace(/[[*(_]+$/g, "").trim();
  }
  return slice.trim().replace(/[[*(_]+$/g, "").trim();
}

function formatTopList(entries: Array<[string, number]>, limit: number): string {
  const top = entries
    .filter(([, count]) => count > 0)
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => `${name} ${count}`);
  return top.join(", ");
}

function sourceLinkForName(source: string): string | null {
  const normalized = normalizeText(source).toLowerCase();
  if (normalized.includes("arxiv")) return "https://arxiv.org";
  if (normalized.includes("github")) return "https://github.com/trending";
  if (normalized.includes("ycombinator") || normalized.includes("hackernews")) {
    return "https://news.ycombinator.com";
  }
  if (normalized.includes("dev.to")) return "https://dev.to";
  if (normalized.includes("reddit")) return "https://www.reddit.com/r/MachineLearning";
  if (normalized.includes("techcrunch")) return "https://techcrunch.com";
  if (normalized.includes("producthunt")) return "https://www.producthunt.com";
  return null;
}

function formatTopSourcesWithLinks(entries: Array<[string, number]>, limit: number): string {
  return entries
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => {
      const link = sourceLinkForName(name);
      const safeLink = link ? sanitizeUrlForMarkdown(link) : "";
      return safeLink ? `[${name} ${count}](${safeLink})` : `${name} ${count}`;
    })
    .join(" | ");
}

function lineHasLink(line: string): boolean {
  return /\[[^\]]+\]\([^)]+\)/.test(line);
}

function extractWhyItMatters(summary: string): string {
  const cleaned = normalizeText(stripMarkdown(summary));
  if (!cleaned) return "";
  const match = cleaned.match(/why it matters:\s*(.*)/i);
  if (match && match[1]) return match[1].trim();
  return cleaned.replace(/what happened:\s*/i, "").trim();
}

function parseNumericValue(value: string): number | null {
  const cleaned = normalizeText(value);
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function parseUnit(value: string): string {
  const cleaned = normalizeText(value);
  if (cleaned.includes("%")) return "%";
  if (cleaned.includes("pts")) return "pts";
  if (cleaned.includes("s")) return "s";
  return "";
}

type DeltaEntry = { label: string; delta: number; unit: string };

function collectDeltaEntries(current: any, previous: any): DeltaEntry[] {
  if (!current || !previous) return [];
  const deltas: DeltaEntry[] = [];

  const currentKeyStats: any[] = Array.isArray(current?.keyStats) ? (current.keyStats as any[]) : [];
  const previousKeyStats: any[] = Array.isArray(previous?.keyStats) ? (previous.keyStats as any[]) : [];
  const prevKeyMap = new Map(previousKeyStats.map((stat: any) => [stat.label, stat]));

  currentKeyStats.forEach((stat: any) => {
    const prev = prevKeyMap.get(stat.label);
    const curValue = parseNumericValue(stat.value ?? "");
    const prevValue = prev ? parseNumericValue(prev.value ?? "") : null;
    if (curValue == null || prevValue == null) return;
    const delta = curValue - prevValue;
    if (!delta) return;
    deltas.push({ label: stat.label, delta, unit: parseUnit(stat.value ?? "") });
  });

  const curTech = current.techReadiness;
  const prevTech = previous.techReadiness;
  if (curTech && prevTech) {
    (["existing", "emerging", "sciFi"] as const).forEach((key) => {
      if (typeof curTech[key] !== "number" || typeof prevTech[key] !== "number") return;
      const delta = curTech[key] - prevTech[key];
      if (!delta) return;
      const label = key === "sciFi" ? "SciFi" : key.charAt(0).toUpperCase() + key.slice(1);
      deltas.push({ label, delta, unit: "pts" });
    });
  }

  const curCaps: any[] = Array.isArray(current?.capabilities) ? (current.capabilities as any[]) : [];
  const prevCaps: any[] = Array.isArray(previous?.capabilities) ? (previous.capabilities as any[]) : [];
  const prevCapsMap = new Map(prevCaps.map((cap: any) => [cap.label, cap]));
  curCaps.forEach((cap: any) => {
    const prev = prevCapsMap.get(cap.label);
    if (!prev || typeof cap.score !== "number" || typeof prev.score !== "number") return;
    const delta = cap.score - prev.score;
    if (Math.abs(delta) < 0.01) return;
    deltas.push({ label: cap.label, delta, unit: "" });
  });

  return deltas;
}

function formatDeltaValue(entry: DeltaEntry): string {
  const abs = Math.abs(entry.delta);
  const formatted =
    abs >= 10 ? abs.toFixed(0) : abs >= 1 ? abs.toFixed(1) : abs.toFixed(2);
  const sign = entry.delta >= 0 ? "+" : "-";
  const unitSuffix = entry.unit ? ` ${entry.unit}` : "";
  return `${entry.label} ${sign}${formatted}${unitSuffix}`;
}

function buildDeltaSummary(current: any, previous: any, limit: number = 3): string {
  const entries = collectDeltaEntries(current, previous)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
  if (entries.length === 0) return "";
  return entries.map(formatDeltaValue).join("; ");
}

function buildTrendLineSvg(config: any): string {
  const width = 640;
  const height = 300;
  const paddingX = 48;
  const paddingY = 42;
  const series = Array.isArray(config?.series) ? config.series[0] : null;
  const values = Array.isArray(series?.data)
    ? series.data.map((d: any) => Number(d?.value)).filter((v: number) => Number.isFinite(v))
    : [];
  const title = normalizeText(config?.title || "Signal Reliability Index");

  if (values.length < 2) {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
      `<rect width="100%" height="100%" fill="#f8fafc"/>`,
      `<text x="${paddingX}" y="${paddingY}" font-size="14" font-family="Arial, sans-serif" fill="#0f172a">${title}</text>`,
      `<text x="${paddingX}" y="${paddingY + 28}" font-size="12" font-family="Arial, sans-serif" fill="#64748b">No trend data yet</text>`,
      `</svg>`,
    ].join("");
  }

  const minVal = typeof config?.gridScale?.min === "number"
    ? config.gridScale.min
    : Math.min(...values);
  const maxVal = typeof config?.gridScale?.max === "number"
    ? config.gridScale.max
    : Math.max(...values);
  const range = Math.max(maxVal - minVal, 1);
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const xStep = values.length > 1 ? usableWidth / (values.length - 1) : usableWidth;

  const points = values.map((value: number, idx: number) => {
    const x = paddingX + idx * xStep;
    const y = height - paddingY - ((value - minVal) / range) * usableHeight;
    return { x, y, value };
  });

  const path = points
    .map((pt: any, idx: number) => `${idx === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(" ");

  const gridLines = 4;
  const grid = Array.from({ length: gridLines + 1 }).map((_: any, idx: number) => {
    const y = paddingY + (usableHeight / gridLines) * idx;
    return `<line x1="${paddingX}" y1="${y.toFixed(1)}" x2="${width - paddingX}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" />`;
  });

  const xLabels = Array.isArray(config?.xAxisLabels) ? config.xAxisLabels : [];
  const leftLabel = xLabels[0] ? normalizeText(String(xLabels[0])) : "";
  const rightLabel = xLabels[xLabels.length - 1] ? normalizeText(String(xLabels[xLabels.length - 1])) : "";
  const lastPoint = points[points.length - 1];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<rect width="100%" height="100%" fill="#f8fafc"/>`,
    ...grid,
    `<path d="${path}" fill="none" stroke="#4f46e5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`,
    ...points.map((pt: any) => `<circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3" fill="#4f46e5" />`),
    `<text x="${paddingX}" y="${paddingY - 18}" font-size="14" font-family="Arial, sans-serif" fill="#0f172a">${title}</text>`,
    leftLabel
      ? `<text x="${paddingX}" y="${height - paddingY + 18}" font-size="11" font-family="Arial, sans-serif" fill="#64748b">${leftLabel}</text>`
      : "",
    rightLabel
      ? `<text x="${width - paddingX}" y="${height - paddingY + 18}" font-size="11" font-family="Arial, sans-serif" fill="#64748b" text-anchor="end">${rightLabel}</text>`
      : "",
    lastPoint
      ? `<text x="${lastPoint.x + 8}" y="${Math.max(lastPoint.y - 8, paddingY)}" font-size="11" font-family="Arial, sans-serif" fill="#1e293b">${lastPoint.value.toFixed(1)}</text>`
      : "",
    `</svg>`,
  ].filter(Boolean).join("");
}

async function buildNtfyChartAttachment(
  ctx: any,
  dashboardMetrics: any,
  memory: any,
  dateString: string,
): Promise<{ url: string; storageId: string } | null> {
  const trendLine = dashboardMetrics?.charts?.trendLine;
  if (!trendLine) return null;

  const existingStorageId = memory?.context?.ntfyChartStorageId;
  const existingDate = memory?.context?.ntfyChartDate;
  if (existingStorageId && existingDate === dateString) {
    const url = await ctx.storage.getUrl(existingStorageId);
    if (url) return { url, storageId: existingStorageId };
  }

  const svg = buildTrendLineSvg(trendLine);
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const storageId = await ctx.storage.store(blob);
  const url = await ctx.storage.getUrl(storageId);
  if (!url) return null;

  return { url, storageId };
}

function formatIntelLines(args: {
  index: number;
  title: string;
  url?: string;
  intel?: StoryIntel;
  fallbackSummary?: string;
  summaryLen: number;
  detailLen: number;
  quoteLen: number;
}): string[] {
  const lines: string[] = [];
  const titleText = clipText(args.title, 70);
  const url = (args.url ?? "").trim();
  const titleLine = url
    ? formatMarkdownLink(titleText, url)
    : formatMarkdownLink(titleText, DASHBOARD_URL);
  lines.push(`${args.index}. ${titleLine}`);

  const summary = args.intel?.summary || args.intel?.lesson || args.fallbackSummary;
  if (summary) {
    const summaryLine = clipText(summary, args.summaryLen);
    lines.push(
      `   ${summaryLine} ${url ? formatMarkdownLink("Source", url) : formatMarkdownLink("Dashboard", DASHBOARD_URL)}`,
    );
  }

  const detailParts: string[] = [];
  if (args.intel?.hard_numbers) {
    detailParts.push(`Impact: ${clipText(args.intel.hard_numbers, args.detailLen)}`);
  }
  if (args.intel?.direct_quote) {
    detailParts.push(`Quote: "${clipText(args.intel.direct_quote, args.quoteLen)}"`);
  }

  if (detailParts.length === 0) {
    const conflict = args.intel?.conflict;
    const pivot = args.intel?.pivot;
    if (conflict || pivot) {
      const intelLine = [
        conflict ? clipText(conflict, args.detailLen) : "",
        pivot ? `-> ${clipText(pivot, args.detailLen)}` : "",
      ]
        .join(" ")
        .trim();
      if (intelLine) detailParts.push(`Intel: ${intelLine}`);
    }
  }

  if (detailParts.length > 0) {
    lines.push(`   ${detailParts.join(" | ")}`);
  }

  return lines;
}

function getTopTags(feedItems: FeedItemLite[], fallback: string[] = []): string[] {
  if (fallback.length > 0) return fallback.slice(0, 6);
  const counts = new Map<string, number>();
  feedItems.forEach((item) => {
    (item.tags ?? []).forEach((tag) => {
      const normalized = normalizeText(tag.replace(/^#/, "").toLowerCase());
      if (!normalized) return;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .sort((a: any, b: any) => b[1] - a[1])
    .slice(0, 6)
    .map(([tag]) => `#${tag}`);
}

function buildSignalLines(executiveBrief: any): string[] {
  const signals = executiveBrief?.actII?.signals ?? [];
  // Dedupe by headline to avoid repetition
  const seen = new Set<string>();
  const uniqueSignals = signals.filter((signal: any) => {
    const headline = (signal.headline ?? "").toLowerCase().trim();
    if (seen.has(headline)) return false;
    seen.add(headline);
    return true;
  });
  return uniqueSignals.slice(0, 3).map((signal: any) => {
    const url = signal.evidence?.[0]?.url ?? "";
    const source = signal.evidence?.[0]?.source ?? "n/a";
    const headline = clipText(signal.headline ?? "Signal update", 100);
    return url ? `${headline} (${source})\n   ${url}` : `${headline} (${source})`;
  });
}

function buildActionLines(executiveBrief: any): string[] {
  const actions = executiveBrief?.actIII?.actions ?? [];
  return actions.slice(0, 3).map((action: any) => {
    const label = action.label || action.title || action.headline || "Action";
    const priority = action.priority || action.status;
    const deliverable = action.deliverable ? `deliverable ${action.deliverable}` : "";
    const suffix = [priority && `priority ${priority}`, deliverable].filter(Boolean).join(", ");
    return `${clipText(label, 120)}${suffix ? ` (${suffix})` : ""}`;
  });
}

type NormalizedFeedItem = FeedItemLite & { text: string };

function buildPersonaImplications(
  feedItems: FeedItemLite[],
  storySummaries: Record<string, string>,
  storyIntel: Record<string, StoryIntel>,
): string[] {
  // Dedupe feed items by URL first
  const urlMap = new Map<string, FeedItemLite>();
  for (const item of feedItems) {
    const url = (item.url ?? "").trim();
    const existing = url ? urlMap.get(url) : undefined;
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) {
      urlMap.set(url || `no-url-${urlMap.size}`, item);
    }
  }
  const dedupedItems = Array.from(urlMap.values());

  const configs = [
    {
      label: "VCs",
      keywords: ["funding", "raise", "series", "seed", "round", "valuation", "investment", "acquisition", "nvidia", "billion"],
      categories: ["startups", "finance", "business"],
      types: ["news", "product", "signal"],
      actionHint: "Re-rank diligence focus and pipeline thesis",
    },
    {
      label: "Bankers",
      keywords: ["ipo", "acquisition", "merger", "deal", "valuation", "earnings", "restructuring", "credit", "debt", "regulatory", "sec", "fda", "cfpb"],
      categories: ["finance", "business"],
      types: ["news", "signal"],
      actionHint: "Update comps and advisory posture",
    },
    {
      label: "Founders",
      keywords: ["launch", "product", "growth", "pricing", "users", "market", "go-to-market", "gtm", "startup", "yc", "ycombinator"],
      categories: ["products", "startups"],
      types: ["product", "news", "signal"],
      actionHint: "Recalibrate roadmap and GTM emphasis",
    },
    {
      label: "Tech Leaders",
      keywords: ["benchmark", "model", "agent", "architecture", "infrastructure", "latency", "performance", "gpu", "platform", "scale", "reliability"],
      categories: ["ai_ml", "research", "opensource"],
      types: ["repo", "news", "signal"],
      actionHint: "Pilot stack changes and performance guardrails",
    },
    {
      label: "Academics",
      keywords: ["paper", "arxiv", "study", "dataset", "experiment", "method", "benchmark", "preprint"],
      categories: ["research", "ai_ml"],
      types: ["news", "signal"],
      actionHint: "Flag for replication or follow-on study",
    },
    {
      label: "Executives",
      keywords: ["strategy", "restructuring", "layoff", "partnership", "enterprise", "customers", "revenue", "margin", "risk"],
      categories: ["business", "finance", "enterprise"],
      types: ["news", "signal"],
      actionHint: "Set decision memo and stakeholder briefing",
    },
    {
      label: "Partners",
      keywords: ["partnership", "integration", "alliance", "ecosystem", "platform", "channel", "distribution"],
      categories: ["business", "products"],
      types: ["news", "signal"],
      actionHint: "Assess channel implications and co-sell fits",
    },
  ];

  const normalized: NormalizedFeedItem[] = dedupedItems.map((item) => ({
    ...item,
    text: normalizeText(`${item.title} ${item.summary ?? ""} ${(item.tags ?? []).join(" ")}`).toLowerCase(),
  }));

  // Track used URLs to avoid showing same story for multiple personas
  const usedUrls = new Set<string>();

  const buildInsight = (item: FeedItemLite, config: typeof configs[number]): string => {
    const url = (item.url ?? "").trim();
    const intel = url ? storyIntel[url] : null;
    const summary = intel?.summary || (url ? storySummaries[url] : "") || item.summary || "";
    const thesisCore = clipText(
      intel?.lesson || intel?.pivot || extractWhyItMatters(summary) || "",
      150,
    );
    const thesis = thesisCore
      ? `Thesis shift: ${thesisCore}`
      : "Thesis shift: Monitor this signal for downstream impact.";
    const moveSeed = clipText(
      intel?.hard_numbers || intel?.conflict || intel?.pivot || "",
      110,
    );
    const move = config.actionHint
      ? `${config.actionHint}${moveSeed ? ` (${moveSeed})` : ""}`
      : moveSeed
        ? `Next move: ${moveSeed}`
        : "Next move: Validate with primary sources and adjust near-term priorities.";
    return `${thesis}. ${move}`;
  };

  return configs.map((config) => {
    const matches = normalized.filter((item) => {
      const url = (item.url ?? "").trim();
      if (url && usedUrls.has(url)) return false;
      const keywordHit = config.keywords.some((keyword) => item.text.includes(keyword));
      const categoryHit = item.category ? config.categories.includes(item.category) : false;
      const typeHit = item.type ? config.types.includes(item.type) : false;
      return keywordHit || categoryHit || typeHit;
    });
    const top = matches
      .slice()
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (!top) {
      return `What this means for ${config.label}: No direct signal in last 24h. ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`;
    }
    const url = (top.url ?? "").trim();
    if (url) usedUrls.add(url);
    const insight = buildInsight(top, config);
    const sourceLink = url
      ? formatMarkdownLink("Source", url)
      : formatMarkdownLink("Dashboard", DASHBOARD_URL);
    return `What this means for ${config.label}: ${insight}. ${sourceLink}`;
  });
}

function buildMetricsComparables(
  feedItems: FeedItemLite[],
  sourceSummary: any,
  topSourcesLine: string,
  topCategoriesLine: string,
): string[] {
  const urlMap = new Map<string, FeedItemLite>();
  for (const item of feedItems) {
    const url = (item.url ?? "").trim();
    const existing = url ? urlMap.get(url) : undefined;
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) {
      urlMap.set(url || `no-url-${urlMap.size}`, item);
    }
  }
  const deduped = Array.from(urlMap.values());
  const totalItems = sourceSummary?.totalItems ?? deduped.length;
  const sourceCount = Object.keys(sourceSummary?.bySource ?? {}).length;
  const scored = deduped.filter((item) => typeof item.score === "number");
  const avgScore = scored.length > 0
    ? (scored.reduce((sum, item) => sum + (item.score ?? 0), 0) / scored.length)
    : 0;

  const normalized = deduped.map((item) => ({
    ...item,
    text: normalizeText(`${item.title} ${item.summary ?? ""} ${(item.tags ?? []).join(" ")}`).toLowerCase(),
  }));

  const dealCount = normalized.filter((item) =>
    /funding|raise|series|seed|round|valuation|acqui|merger|ipo|deal|billion/.test(item.text),
  ).length;
  const paperCount = normalized.filter((item) =>
    (item.source ?? "").toLowerCase().includes("arxiv")
      || item.category === "research"
      || /paper|study|preprint/.test(item.text),
  ).length;
  const repoCount = normalized.filter((item) =>
    (item.source ?? "").toLowerCase().includes("github")
      || item.type === "repo"
      || item.category === "opensource",
  ).length;

  const lines: string[] = [];
  const avgScoreLabel = avgScore ? avgScore.toFixed(1) : "n/a";
  lines.push(`Coverage: ${totalItems} items | Sources: ${sourceCount || "n/a"} | Avg signal score: ${avgScoreLabel}`);
  lines.push(`Deal flow: ${dealCount} | Research papers: ${paperCount} | OSS repos: ${repoCount}`);
  if (topSourcesLine) lines.push(`Top sources: ${topSourcesLine}`);
  if (topCategoriesLine) lines.push(`Sector leaders: ${topCategoriesLine}`);
  return lines;
}

function buildNetworkEffectsLines(entityGraph: EntityGraph | null, limit: number = 4): string[] {
  if (!entityGraph || !Array.isArray(entityGraph.edges) || entityGraph.edges.length === 0) {
    return [];
  }
  const labelMap = new Map(
    (entityGraph.nodes ?? []).map((node) => [node.id, node.label || node.id]),
  );
  return entityGraph.edges.slice(0, limit).map((edge) => {
    const source = clipText(labelMap.get(edge.source) || edge.source, 28);
    const target = clipText(labelMap.get(edge.target) || edge.target, 28);
    const rel = clipText(edge.relationship || "Relates", 30);
    const context = edge.context ? clipText(edge.context, 90) : "";
    return `${source} -> ${target} (${rel}${context ? `: ${context}` : ""})`;
  });
}

function scoreLeadStory(item: FeedItemLite): number {
  let score = item.score ?? 0;
  const text = normalizeText(`${item.title ?? ""} ${item.summary ?? ""}`).toLowerCase();
  const source = normalizeText(item.source ?? "").toLowerCase();
  const category = normalizeText(item.category ?? "").toLowerCase();

  if (/acqui|merger|buyout|ipo|earnings|restructur|layoff|regret|antitrust|regulatory|sec|fda|clinical|trial|approval/.test(text)) {
    score += 18;
  }
  if (/billion|million|\\$\\d/.test(text)) {
    score += 10;
  }
  if (/breakthrough|first|reversal|cure|record|new model|novel/.test(text)) {
    score += 8;
  }
  if (/security|vulnerability|breach|cve|exploit/.test(text)) {
    score += 6;
  }
  if (/paper|study|preprint|arxiv|research/.test(text)) {
    score += 5;
  }
  if (category.includes("finance") || category.includes("business") || category.includes("enterprise") || category.includes("biotech")) {
    score += 8;
  }
  if (source.includes("github")) {
    score -= 10;
  }
  if (source.includes("arxiv")) {
    score += 3;
  }
  if (source.includes("ycombinator") || source.includes("hackernews")) {
    score += 2;
  }

  return score;
}

function getRankedLeadStories(feedItems: FeedItemLite[], limit: number = 5): TopStory[] {
  const urlMap = new Map<string, FeedItemLite>();
  for (const item of feedItems) {
    const url = (item.url ?? "").trim();
    if (!url) continue;
    const existing = urlMap.get(url);
    if (!existing || scoreLeadStory(item) > scoreLeadStory(existing)) {
      urlMap.set(url, item);
    }
  }
  return Array.from(urlMap.values())
    .sort((a, b) => scoreLeadStory(b) - scoreLeadStory(a))
    .slice(0, limit)
    .map((item) => ({
      title: item.title,
      url: item.url ?? "",
      source: item.source ?? "Unknown",
      score: scoreLeadStory(item),
      summary: item.summary,
      category: item.category,
    }));
}

type TopStory = {
  title: string;
  url: string;
  source: string;
  score: number;
  summary?: string;
  category?: string;
};

function getTopStories(feedItems: FeedItemLite[], limit: number = 5): TopStory[] {
  // Dedupe by URL, keep highest scored
  const urlMap = new Map<string, FeedItemLite>();
  for (const item of feedItems) {
    const url = (item.url ?? "").trim();
    if (!url) continue;
    const existing = urlMap.get(url);
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) {
      urlMap.set(url, item);
    }
  }
  return Array.from(urlMap.values())
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
    .map((item) => ({
      title: item.title,
      url: item.url ?? "",
      source: item.source ?? "Unknown",
      score: item.score ?? 0,
      summary: item.summary,
      category: item.category,
    }));
}

function extractStorySummary(markdown: string, maxLen: number = 240): string {
  const cleaned = normalizeText(stripMarkdown(markdown));
  if (!cleaned) return "";
  return clipText(cleaned, maxLen);
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function buildTaskId(prefix: string, url: string, existingIds: Set<string>): string {
  const base = `${prefix}-${hashString(url)}`;
  if (!existingIds.has(base)) return base;
  let counter = 1;
  let candidate = `${base}-${counter}`;
  while (existingIds.has(candidate)) {
    counter += 1;
    candidate = `${base}-${counter}`;
  }
  return candidate;
}

function buildStorySummaryFeature(item: FeedItemLite, id: string, now: number) {
  return {
    id,
    type: "story_summary",
    name: `Summarize top signal: ${item.title}`,
    status: "pending",
    priority: 1,
    testCriteria: "Summary is 3-4 sentences. Sentence 1 starts with What happened:, sentence 2 with Why it matters:, sentence 3 with Key number:. Sentence 4 uses Key quote: if present, otherwise Key detail:.",
    sourceRefs: { feedItem: item, summaryVersion: STORY_SUMMARY_VERSION },
    updatedAt: now,
  };
}

function buildStoryIntelFeature(item: FeedItemLite, id: string, now: number) {
  return {
    id,
    type: "story_intel",
    name: `Extract intelligence from: ${item.title}`,
    status: "pending",
    priority: 1,
    testCriteria: "Return JSON with: summary, hard_numbers, direct_quote, conflict, pivot, lesson. Leave missing fields as null.",
    sourceRefs: { feedItem: item },
    updatedAt: now,
  };
}

async function ensureStoryTasks(
  ctx: any,
  memory: any,
  feedItems: FeedItemLite[],
  targetUrls: string[],
  options: { maxSummaries?: number; maxIntel?: number } = {},
) {
  if (!memory?._id || targetUrls.length === 0) return;

  const features: any[] = Array.isArray(memory.features) ? memory.features : [];
  const summaryTasks = features.filter((feature) => feature?.type === "story_summary");
  const intelTasks = features.filter((feature) => feature?.type === "story_intel");

  const summaryTaskUrls = new Set(
    summaryTasks
      .filter((task) => (task?.sourceRefs?.summaryVersion ?? 1) === STORY_SUMMARY_VERSION)
      .map((task) => (task?.sourceRefs?.feedItem?.url ?? "").trim())
      .filter(Boolean),
  );
  const intelTaskUrls = new Set(
    intelTasks
      .map((task) => (task?.sourceRefs?.feedItem?.url ?? "").trim())
      .filter(Boolean),
  );

  const itemsByUrl = new Map<string, FeedItemLite>();
  feedItems.forEach((item) => {
    const url = (item.url ?? "").trim();
    if (!url) return;
    const existing = itemsByUrl.get(url);
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) {
      itemsByUrl.set(url, item);
    }
  });

  const existingIds = new Set(
    features.map((feature) => feature?.id).filter((id): id is string => typeof id === "string"),
  );
  const now = Date.now();

  const summaryFeatures: any[] = [];
  const intelFeatures: any[] = [];

  targetUrls.slice(0, options.maxSummaries ?? targetUrls.length).forEach((url) => {
    const trimmed = url.trim();
    if (!trimmed || summaryTaskUrls.has(trimmed)) return;
    const item = itemsByUrl.get(trimmed);
    if (!item) return;
    const id = buildTaskId("Sx", trimmed, existingIds);
    existingIds.add(id);
    summaryFeatures.push(buildStorySummaryFeature(item, id, now));
  });

  targetUrls.slice(0, options.maxIntel ?? 0).forEach((url) => {
    const trimmed = url.trim();
    if (!trimmed || intelTaskUrls.has(trimmed)) return;
    const item = itemsByUrl.get(trimmed);
    if (!item || item.type === "repo") return;
    const id = buildTaskId("Ix", trimmed, existingIds);
    existingIds.add(id);
    intelFeatures.push(buildStoryIntelFeature(item, id, now));
  });

  const newFeatures = [...summaryFeatures, ...intelFeatures];
  if (newFeatures.length === 0) return;

  await ctx.runMutation(
    internal.domains.research.dailyBriefMemoryMutations.appendFeatures,
    {
      memoryId: memory._id,
      features: newFeatures,
    },
  );
}

function extractJsonPayload(raw: string): unknown {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const unfenced = trimmed.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = unfenced.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeStoryIntel(raw: any): StoryIntel | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw;
  const summary = typeof value.summary === "string" ? value.summary : null;
  const hardNumbers =
    typeof value.hard_numbers === "string"
      ? value.hard_numbers
      : typeof value.hardNumbers === "string"
        ? value.hardNumbers
        : typeof value.number === "string"
          ? value.number
          : null;
  const directQuote =
    typeof value.direct_quote === "string"
      ? value.direct_quote
      : typeof value.directQuote === "string"
        ? value.directQuote
        : typeof value.quote === "string"
          ? value.quote
          : null;
  const conflict = typeof value.conflict === "string" ? value.conflict : null;
  const pivot = typeof value.pivot === "string" ? value.pivot : null;
  const lesson = typeof value.lesson === "string" ? value.lesson : null;

  if (!summary && !hardNumbers && !directQuote && !conflict && !pivot && !lesson) {
    return null;
  }

  return {
    summary,
    hard_numbers: hardNumbers,
    direct_quote: directQuote,
    conflict,
    pivot,
    lesson,
  };
}

function normalizeEntityGraph(raw: any): EntityGraph | null {
  if (!raw || typeof raw !== "object") return null;
  const nodes: GraphNode[] = Array.isArray(raw.nodes)
    ? raw.nodes
        .filter((node: any) => node && node.id && node.label)
        .map((node: any) => ({
          id: String(node.id),
          label: String(node.label),
          type: typeof node.type === "string" ? node.type : undefined,
          importance:
            typeof node.importance === "number" && Number.isFinite(node.importance)
              ? node.importance
              : undefined,
          tier:
            typeof node.tier === "number" && Number.isFinite(node.tier)
              ? node.tier
              : undefined,
        }))
    : [];
  const edges: GraphEdge[] = Array.isArray(raw.edges)
    ? raw.edges
        .filter((edge: any) => edge && edge.source && edge.target)
        .map((edge: any) => ({
          source: String(edge.source),
          target: String(edge.target),
          relationship:
            typeof edge.relationship === "string" ? edge.relationship : undefined,
          context: typeof edge.context === "string" ? edge.context : undefined,
          impact: typeof edge.impact === "string" ? edge.impact : undefined,
          order:
            edge.order === "primary" || edge.order === "secondary"
              ? edge.order
              : undefined,
        }))
    : [];
  if (nodes.length === 0) return null;
  const focusNodeId =
    typeof raw.focusNodeId === "string" ? raw.focusNodeId : nodes[0]?.id;
  return { focusNodeId, nodes, edges };
}

async function runTasksWithConcurrency(
  ctx: any,
  memoryId: string,
  tasks: any[],
  concurrency: number,
) {
  if (tasks.length === 0) return;
  let cursor = 0;
  const runNext = async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      if (!task?.id) continue;
      try {
        await ctx.runAction(
          internal.domains.research.dailyBriefWorker.runNextTaskInternal,
          { memoryId, taskId: task.id },
        );
      } catch (err: any) {
        console.warn("[dailyMorningBrief] task batch failed:", err?.message || err);
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => runNext(),
  );
  await Promise.all(workers);
}

async function collectStorySummaries(
  ctx: any,
  memory: any,
  feedItems: FeedItemLite[],
  targetUrls: string[] = [],
  maxItems: number = 3,
): Promise<Record<string, string>> {
  if (!memory?._id) return {};

  const features: any[] = Array.isArray(memory.features) ? memory.features : [];
  const storyTasks = features.filter(
    (feature) =>
      feature?.type === "story_summary" &&
      (feature?.sourceRefs?.summaryVersion ?? 1) === STORY_SUMMARY_VERSION &&
      typeof feature?.sourceRefs?.feedItem?.url === "string",
  );
  if (storyTasks.length === 0) return {};

  const tasksByUrl = new Map<string, any>();
  storyTasks.forEach((task) => {
    const url = (task?.sourceRefs?.feedItem?.url ?? "").trim();
    if (url && !tasksByUrl.has(url)) tasksByUrl.set(url, task);
  });

  let taskResults: any[] = await ctx.runQuery(
    api.domains.research.dailyBriefMemoryQueries.listTaskResultsByMemory,
    { memoryId: memory._id },
  );
  const resultsByTaskId = new Map<string, string>();
  taskResults.forEach((result) => {
    if (result?.taskId && typeof result?.resultMarkdown === "string") {
      resultsByTaskId.set(result.taskId, result.resultMarkdown);
    }
  });

  const storyUrls = (targetUrls.length > 0
    ? targetUrls
    : getTopStories(feedItems, maxItems).map((story) => story.url)
  )
    .filter((url) => typeof url === "string" && url.trim())
    .slice(0, maxItems);

  const tasksToRun = storyUrls
    .map((url) => tasksByUrl.get(url))
    .filter((task) => task && !resultsByTaskId.has(task.id))
    .slice(0, maxItems);

  for (const task of tasksToRun) {
    try {
      await ctx.runAction(
        internal.domains.research.dailyBriefWorker.runNextTaskInternal,
        { memoryId: memory._id, taskId: task.id },
      );
    } catch (err: any) {
      console.warn("[dailyMorningBrief] story summary task failed:", err?.message || err);
    }
  }

  if (tasksToRun.length > 0) {
    taskResults = await ctx.runQuery(
      api.domains.research.dailyBriefMemoryQueries.listTaskResultsByMemory,
      { memoryId: memory._id },
    );
  }

  const summaryByUrl: Record<string, string> = {};
  const taskUrlById = new Map<string, string>();
  storyTasks.forEach((task) => {
    const url = (task?.sourceRefs?.feedItem?.url ?? "").trim();
    if (url) taskUrlById.set(task.id, url);
  });

  taskResults.forEach((result) => {
    const url = result?.taskId ? taskUrlById.get(result.taskId) : undefined;
    if (!url || typeof result?.resultMarkdown !== "string") return;
    const summary = extractStorySummary(result.resultMarkdown, 240);
    if (summary && !summaryByUrl[url]) {
      summaryByUrl[url] = summary;
    }
  });

  return summaryByUrl;
}

async function collectCoverageSummaries(
  ctx: any,
  memory: any,
  feedItems: FeedItemLite[],
  targetUrls: string[] = [],
  options: { maxItems?: number; concurrency?: number } = {},
): Promise<{ items: CoverageSummaryItem[]; summaryByUrl: Record<string, string> }> {
  if (!memory?._id) return { items: [], summaryByUrl: {} };

  const features: any[] = Array.isArray(memory.features) ? memory.features : [];
  const storyTasks = features.filter(
    (feature) =>
      feature?.type === "story_summary" &&
      (feature?.sourceRefs?.summaryVersion ?? 1) === STORY_SUMMARY_VERSION &&
      typeof feature?.sourceRefs?.feedItem?.url === "string",
  );
  if (storyTasks.length === 0) return { items: [], summaryByUrl: {} };

  const tasksByUrl = new Map<string, any>();
  storyTasks.forEach((task) => {
    const url = (task?.sourceRefs?.feedItem?.url ?? "").trim();
    if (url && !tasksByUrl.has(url)) tasksByUrl.set(url, task);
  });

  const itemsByUrl = new Map<string, FeedItemLite>();
  feedItems.forEach((item) => {
    const url = (item.url ?? "").trim();
    if (!url) return;
    const existing = itemsByUrl.get(url);
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) {
      itemsByUrl.set(url, item);
    }
  });

  const allUrls = (targetUrls.length > 0 ? targetUrls : Array.from(itemsByUrl.keys()))
    .filter((url) => typeof url === "string" && url.trim());
  const maxItems = Math.min(allUrls.length, options.maxItems ?? allUrls.length);
  const storyUrls = allUrls.slice(0, maxItems);

  let taskResults: any[] = await ctx.runQuery(
    api.domains.research.dailyBriefMemoryQueries.listTaskResultsByMemory,
    { memoryId: memory._id },
  );
  const resultsByTaskId = new Map<string, string>();
  taskResults.forEach((result) => {
    if (result?.taskId && typeof result?.resultMarkdown === "string") {
      resultsByTaskId.set(result.taskId, result.resultMarkdown);
    }
  });

  const tasksToRun = storyUrls
    .map((url) => tasksByUrl.get(url))
    .filter((task) => task && !resultsByTaskId.has(task.id));

  if (tasksToRun.length > 0) {
    await runTasksWithConcurrency(
      ctx,
      memory._id,
      tasksToRun,
      Math.max(1, options.concurrency ?? 4),
    );
    taskResults = await ctx.runQuery(
      api.domains.research.dailyBriefMemoryQueries.listTaskResultsByMemory,
      { memoryId: memory._id },
    );
  }

  const summaryByUrl: Record<string, string> = {};
  const taskUrlById = new Map<string, string>();
  storyTasks.forEach((task) => {
    const url = (task?.sourceRefs?.feedItem?.url ?? "").trim();
    if (url) taskUrlById.set(task.id, url);
  });

  taskResults.forEach((result) => {
    const url = result?.taskId ? taskUrlById.get(result.taskId) : undefined;
    if (!url || typeof result?.resultMarkdown !== "string") return;
    const summary = extractStorySummary(result.resultMarkdown, 240);
    if (summary && !summaryByUrl[url]) {
      summaryByUrl[url] = summary;
    }
  });

  const items = storyUrls.reduce<CoverageSummaryItem[]>((acc, url) => {
    const item = itemsByUrl.get(url);
    if (!item) return acc;
    const fallbackSummary = item.summary ? extractStorySummary(item.summary, 200) : "";
    const summary = summaryByUrl[url] || fallbackSummary;
    if (!summary) return acc;
    acc.push({
      title: item.title,
      summary,
      url,
      source: item.source,
      category: item.category,
    });
    return acc;
  }, []);

  return { items, summaryByUrl };
}

async function collectStoryIntel(
  ctx: any,
  memory: any,
  feedItems: FeedItemLite[],
  targetUrls: string[] = [],
  maxItems: number = 5,
): Promise<Record<string, StoryIntel>> {
  if (!memory?._id) return {};

  const features: any[] = Array.isArray(memory.features) ? memory.features : [];
  const intelTasks = features.filter(
    (feature) =>
      feature?.type === "story_intel" &&
      typeof feature?.sourceRefs?.feedItem?.url === "string",
  );
  if (intelTasks.length === 0) return {};

  const tasksByUrl = new Map<string, any>();
  intelTasks.forEach((task) => {
    const url = (task?.sourceRefs?.feedItem?.url ?? "").trim();
    if (url && !tasksByUrl.has(url)) tasksByUrl.set(url, task);
  });

  let taskResults: any[] = await ctx.runQuery(
    api.domains.research.dailyBriefMemoryQueries.listTaskResultsByMemory,
    { memoryId: memory._id },
  );
  const resultsByTaskId = new Map<string, string>();
  taskResults.forEach((result) => {
    if (result?.taskId && typeof result?.resultMarkdown === "string") {
      resultsByTaskId.set(result.taskId, result.resultMarkdown);
    }
  });

  const storyUrls = (targetUrls.length > 0
    ? targetUrls
    : getTopStories(feedItems, maxItems).map((story) => story.url)
  )
    .filter((url) => typeof url === "string" && url.trim())
    .slice(0, maxItems);

  const tasksToRun = storyUrls
    .map((url) => tasksByUrl.get(url))
    .filter((task) => task && !resultsByTaskId.has(task.id))
    .slice(0, maxItems);

  for (const task of tasksToRun) {
    try {
      await ctx.runAction(
        internal.domains.research.dailyBriefWorker.runNextTaskInternal,
        { memoryId: memory._id, taskId: task.id },
      );
    } catch (err: any) {
      console.warn("[dailyMorningBrief] story intel task failed:", err?.message || err);
    }
  }

  if (tasksToRun.length > 0) {
    taskResults = await ctx.runQuery(
      api.domains.research.dailyBriefMemoryQueries.listTaskResultsByMemory,
      { memoryId: memory._id },
    );
  }

  const intelByUrl: Record<string, StoryIntel> = {};
  const taskUrlById = new Map<string, string>();
  intelTasks.forEach((task) => {
    const url = (task?.sourceRefs?.feedItem?.url ?? "").trim();
    if (url) taskUrlById.set(task.id, url);
  });

  taskResults.forEach((result) => {
    const url = result?.taskId ? taskUrlById.get(result.taskId) : undefined;
    if (!url || typeof result?.resultMarkdown !== "string") return;
    const parsed = extractJsonPayload(result.resultMarkdown);
    const parsedIntel = normalizeStoryIntel(parsed);
    const fallbackSummary = extractStorySummary(result.resultMarkdown, 200);
    const resolvedIntel =
      parsedIntel || (fallbackSummary ? { summary: fallbackSummary } : null);
    if (resolvedIntel && !intelByUrl[url]) {
      intelByUrl[url] = resolvedIntel;
    }
  });

  return intelByUrl;
}

async function collectGraphExtraction(
  ctx: any,
  memory: any,
): Promise<EntityGraph | null> {
  if (!memory?._id) return null;

  const features: any[] = Array.isArray(memory.features) ? memory.features : [];
  const graphTask = features.find((feature) => feature?.type === "graph_extraction");
  if (!graphTask) return null;

  let taskResults: any[] = await ctx.runQuery(
    api.domains.research.dailyBriefMemoryQueries.listTaskResultsByMemory,
    { memoryId: memory._id },
  );

  let result = taskResults.find((item) => item?.taskId === graphTask.id);

  if (!result) {
    try {
      await ctx.runAction(
        internal.domains.research.dailyBriefWorker.runNextTaskInternal,
        { memoryId: memory._id, taskId: graphTask.id },
      );
    } catch (err: any) {
      console.warn("[dailyMorningBrief] graph extraction task failed:", err?.message || err);
      return null;
    }

    taskResults = await ctx.runQuery(
      api.domains.research.dailyBriefMemoryQueries.listTaskResultsByMemory,
      { memoryId: memory._id },
    );
    result = taskResults.find((item) => item?.taskId === graphTask.id);
  }

  if (!result || typeof result?.resultMarkdown !== "string") return null;
  const parsed = extractJsonPayload(result.resultMarkdown);
  return normalizeEntityGraph(parsed);
}


// =============================================================================
// ENTITY ENRICHMENT (Banker-Grade Deep Insights for Morning Brief)
// =============================================================================

/**
 * Enrich top entities from the entity graph with banker-grade insights.
 * This calls getEntityInsights for company/person nodes to get structured
 * funding, people, product pipeline, and persona hooks data.
 */
type EnrichedEntity = {
  name: string;
  type: "company" | "person";
  summary?: string;
  funding?: {
    stage?: string;
    totalRaised?: { amount: number; currency: string; unit: string };
    lastRound?: { roundType?: string; announcedDate?: string };
  };
  people?: {
    founders?: Array<{ name: string; role?: string }>;
    headcount?: string;
  };
  productPipeline?: {
    platform?: string;
    modalities?: string[];
  };
  freshness?: {
    newsAgeDays?: number;
    withinBankerWindow?: boolean;
  };
  personaReadiness?: {
    ready: string[];
    notReady: string[];
  };
};

async function enrichTopEntitiesFromGraph(
  ctx: any,
  entityGraph: EntityGraph | null,
  limit: number = 3,
): Promise<EnrichedEntity[]> {
  if (!entityGraph || !Array.isArray(entityGraph.nodes)) return [];

  // Filter to company/person nodes with importance, sorted by importance
  const candidateNodes = entityGraph.nodes
    .filter((node) => {
      const t = (node.type ?? "").toLowerCase();
      return t.includes("company") || t.includes("org") || t.includes("person") || t.includes("startup");
    })
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, limit);

  if (candidateNodes.length === 0) return [];

  const enriched: EnrichedEntity[] = [];

  for (const node of candidateNodes) {
    const entityType = (node.type ?? "").toLowerCase().includes("person") ? "person" : "company";
    try {
      const result: any = await ctx.runAction(
        api.domains.knowledge.entityInsights.getEntityInsights,
        {
          entityName: node.label || node.id,
          entityType,
          forceRefresh: false, // Use cached if available
        },
      );

      // Extract persona readiness from personaHooks
      const personaHooks: Record<string, { failTriggers?: unknown[] } | undefined> = result.personaHooks ?? {};
      const ready: string[] = [];
      const notReady: string[] = [];
      for (const [persona, hooks] of Object.entries(personaHooks)) {
        const failCount = hooks?.failTriggers?.length || 0;
        if (failCount === 0) {
          ready.push(persona);
        } else {
          notReady.push(persona);
        }
      }

      enriched.push({
        name: result.entityName ?? node.label,
        type: entityType,
        summary: result.summary ? clipText(result.summary, 150) : undefined,
        funding: result.funding
          ? {
              stage: result.funding.stage,
              totalRaised: result.funding.totalRaised,
              lastRound: result.funding.lastRound
                ? {
                    roundType: result.funding.lastRound.roundType,
                    announcedDate: result.funding.lastRound.announcedDate,
                  }
                : undefined,
            }
          : undefined,
        people: result.people
          ? {
              founders: result.people.founders?.slice(0, 2),
              headcount: result.people.headcount,
            }
          : undefined,
        productPipeline: result.productPipeline
          ? {
              platform: result.productPipeline.platform,
              modalities: result.productPipeline.modalities?.slice(0, 3),
            }
          : undefined,
        freshness: result.freshness,
        personaReadiness: { ready, notReady },
      });
    } catch (err: any) {
      console.warn(
        `[dailyMorningBrief] entity enrichment failed for "${node.label}":`,
        err?.message || err,
      );
    }
  }

  return enriched;
}

/**
 * Format enriched entities for the ntfy digest body.
 */
function formatEnrichedEntitiesForDigest(
  enrichedEntities: EnrichedEntity[],
  maxLen: number = 350,
): string[] {
  if (enrichedEntities.length === 0) return [];

  const lines: string[] = ["**Entity Spotlight**"];

  for (const entity of enrichedEntities) {
    const parts: string[] = [];
    parts.push(`**${entity.name}**`);

    if (entity.funding?.stage) {
      const fundingLine = entity.funding.totalRaised
        ? `${entity.funding.stage} (${entity.funding.totalRaised.currency}${entity.funding.totalRaised.amount}${entity.funding.totalRaised.unit})`
        : entity.funding.stage;
      parts.push(fundingLine);
    }

    if (entity.productPipeline?.platform) {
      parts.push(entity.productPipeline.platform);
    }

    if (entity.freshness?.withinBankerWindow) {
      parts.push("✓ Fresh");
    }

    const readyCount = entity.personaReadiness?.ready?.length ?? 0;
    if (readyCount > 0) {
      parts.push(`${readyCount}/10 personas ready`);
    }

    const entityLine = `- ${parts.join(" | ")}`;
    if (entityLine.length <= maxLen) {
      lines.push(entityLine);
      if (entity.summary) {
        lines.push(`  ${clipText(entity.summary, 120)}`);
      }
    }
  }

  return lines;
}


/**
 * Format funding events for the ntfy digest body.
 * Adds "TODAY'S FUNDING TARGETS" section with Seed/Pre-Seed and Series A subsections.
 */
interface FundingEventForDigest {
  companyName: string;
  roundType: string;
  amountRaw: string;
  amountUsd?: number;
  leadInvestors: string[];
  sector?: string;
  confidence: number;
  verificationStatus: string;
  personaPassCount?: number;
  missingFields?: string[];
}

interface FundingDigestSections {
  seed: FundingEventForDigest[];
  seriesA: FundingEventForDigest[];
  other: FundingEventForDigest[];
  total: number;
}

function formatFundingEventsForDigest(
  fundingDigest: FundingDigestSections | null,
  maxItemsPerSection: number = 3,
): string[] {
  if (!fundingDigest || fundingDigest.total === 0) return [];

  const lines: string[] = ["**TODAY'S FUNDING TARGETS**"];

  // Format Seed & Pre-Seed section
  if (fundingDigest.seed.length > 0) {
    lines.push("");
    lines.push("**Seed & Pre-Seed Targets**");
    fundingDigest.seed.slice(0, maxItemsPerSection).forEach((event, idx) => {
      const amountStr = event.amountUsd
        ? `$${(event.amountUsd / 1_000_000).toFixed(1)}M`
        : event.amountRaw;
      const sectorStr = event.sector ? ` | ${event.sector}` : "";
      const investorStr = event.leadInvestors.length > 0
        ? `Led by: ${event.leadInvestors.slice(0, 2).join(", ")}`
        : "";
      const personaStr = event.personaPassCount !== undefined
        ? `[${event.personaPassCount}/10 personas]`
        : "";
      const missingStr = event.missingFields && event.missingFields.length > 0
        ? `_Missing: ${event.missingFields.slice(0, 2).join(", ")}_`
        : "";

      lines.push(`${idx + 1}. **${event.companyName}** - ${amountStr}${sectorStr}`);
      if (investorStr || personaStr) {
        lines.push(`   ${investorStr} ${personaStr}`.trim());
      }
      if (missingStr) {
        lines.push(`   ${missingStr}`);
      }
    });
  }

  // Format Series A section
  if (fundingDigest.seriesA.length > 0) {
    lines.push("");
    lines.push("**Series A Targets**");
    fundingDigest.seriesA.slice(0, maxItemsPerSection).forEach((event, idx) => {
      const amountStr = event.amountUsd
        ? `$${(event.amountUsd / 1_000_000).toFixed(1)}M`
        : event.amountRaw;
      const sectorStr = event.sector ? ` | ${event.sector}` : "";
      const investorStr = event.leadInvestors.length > 0
        ? `Led by: ${event.leadInvestors.slice(0, 2).join(", ")}`
        : "";
      const personaStr = event.personaPassCount !== undefined
        ? `[${event.personaPassCount}/10 personas]`
        : "";
      const missingStr = event.missingFields && event.missingFields.length > 0
        ? `_Missing: ${event.missingFields.slice(0, 2).join(", ")}_`
        : "";

      lines.push(`${idx + 1}. **${event.companyName}** - ${amountStr}${sectorStr}`);
      if (investorStr || personaStr) {
        lines.push(`   ${investorStr} ${personaStr}`.trim());
      }
      if (missingStr) {
        lines.push(`   ${missingStr}`);
      }
    });
  }

  return lines;
}

function extractShortName(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.split("/").filter(Boolean);
    if (u.hostname.includes("github.com") && path.length >= 2) {
      return `${path[0]}/${path[1]}`;
    }
    if (u.hostname.includes("arxiv.org")) {
      return path[path.length - 1] || "paper";
    }
    return u.hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    return "link";
  }
}

function generateNarrativeThesis(topStories: TopStory[], feedItems: FeedItemLite[]): string {
  if (topStories.length === 0) return "Light signal day. Check back tomorrow for fresh intelligence.";

  // Analyze all text for themes
  const allText = feedItems
    .slice(0, 25)
    .map((i) => `${i.title} ${i.summary ?? ""}`.toLowerCase())
    .join(" ");

  // Detect dominant themes with weights
  const themeSignals: Array<{ theme: string; weight: number; verb: string }> = [];

  if (allText.includes("acqui") || allText.includes("billion") || allText.includes("buy") || allText.includes("merger")) {
    const count = (allText.match(/acqui|billion|buy|merger/g) || []).length;
    themeSignals.push({ theme: "M&A", weight: count * 3, verb: "consolidates" });
  }
  if (allText.includes("nvidia") || allText.includes("gpu") || allText.includes("chip")) {
    const count = (allText.match(/nvidia|gpu|chip/g) || []).length;
    themeSignals.push({ theme: "Hardware/Chips", weight: count * 2, verb: "dominates" });
  }
  if (allText.includes("biotech") || allText.includes("clinical") || allText.includes("pharma")) {
    const count = (allText.match(/biotech|clinical|pharma/g) || []).length;
    themeSignals.push({ theme: "BioTech", weight: count * 2, verb: "advances" });
  }
  if (allText.includes("open source") || allText.includes("github")) {
    const count = (allText.match(/open.?source|github/g) || []).length;
    themeSignals.push({ theme: "Open Source", weight: count, verb: "gains momentum" });
  }
  if (allText.includes("ai") || allText.includes("llm") || allText.includes("model")) {
    const count = (allText.match(/\bai\b|llm|model/g) || []).length;
    themeSignals.push({ theme: "AI/ML", weight: count, verb: "evolves" });
  }
  if (allText.includes("security") || allText.includes("vulnerability") || allText.includes("cve")) {
    const count = (allText.match(/security|vulnerability|cve/g) || []).length;
    themeSignals.push({ theme: "Security", weight: count * 2, verb: "alerts" });
  }
  if (allText.includes("startup") || allText.includes("funding") || allText.includes("seed") || allText.includes("series")) {
    const count = (allText.match(/startup|funding|seed|series/g) || []).length;
    themeSignals.push({ theme: "Startups", weight: count, verb: "raises" });
  }

  // Sort by weight
  themeSignals.sort((a, b) => b.weight - a.weight);
  const topThemes = themeSignals.slice(0, 2);

  // Build thesis based on lead story + themes
  const lead = topStories[0];
  const leadLower = lead.title.toLowerCase();

  let thesis = "";

  // Smart lead based on content type
  if (leadLower.includes("nvidia") && (leadLower.includes("buy") || leadLower.includes("acqui"))) {
    thesis = `Capital moves big: ${clipText(lead.title, 55)}.`;
  } else if (leadLower.includes("billion")) {
    thesis = `Major deal alert: ${clipText(lead.title, 55)}.`;
  } else if (leadLower.includes("layoff") || leadLower.includes("restructur") || leadLower.includes("regret")) {
    thesis = `Enterprise reset: ${clipText(lead.title, 55)}.`;
  } else if (leadLower.includes("clinical") || leadLower.includes("trial") || leadLower.includes("alzheimer") || leadLower.includes("cancer")) {
    thesis = `Science signal: ${clipText(lead.title, 55)}.`;
  } else if (lead.source === "GitHub") {
    const repoName = extractShortName(lead.url);
    thesis = `Developer spotlight on **${repoName}** as it trends across the community.`;
  } else if (lead.source === "ArXiv") {
    thesis = `Research focus: ${clipText(lead.title, 50)}.`;
  } else if (lead.source === "YCombinator" || lead.source === "HackerNews") {
    thesis = `Community attention: ${clipText(lead.title, 50)}.`;
  } else {
    thesis = `Lead signal: ${clipText(lead.title, 50)}.`;
  }

  // Add theme context
  if (topThemes.length >= 2) {
    thesis += ` Today's cycle: **${topThemes[0].theme}** ${topThemes[0].verb}, **${topThemes[1].theme}** ${topThemes[1].verb}.`;
  } else if (topThemes.length === 1) {
    thesis += ` Primary theme: **${topThemes[0].theme}** ${topThemes[0].verb}.`;
  }

  return thesis;
}

function formatTrendIndicator(stat: any): string {
  const value = stat.value ?? "";
  const trend = stat.trend;
  const label = stat.label ?? "";
  const labelLower = label.toLowerCase();

  const invertedMetrics = ["fail", "latency", "error", "bug"];
  const isInverted = invertedMetrics.some((m) => labelLower.includes(m));

  let context = "Flat";
  if (labelLower.includes("fail") && String(value).includes("0")) {
    context = "Stable";
  } else if (trend === "up") {
    context = isInverted ? "Watch" : "Rising";
  } else if (trend === "down") {
    context = isInverted ? "Improving" : "Falling";
  }

  return `${label} ${value} (${context})`;
}

function buildNtfyDigestPayload(args: {
  dateString?: string;
  sourceSummary?: any;
  dashboardMetrics?: any;
  previousDashboardMetrics?: any;
  feedItems?: FeedItemLite[];
  executiveBrief?: any;
  storySummaries?: Record<string, string>;
  storyIntel?: Record<string, StoryIntel>;
  coverageSummaries?: CoverageSummaryItem[];
  coverageRollup?: CoverageRollup | null;
  entityGraph?: EntityGraph | null;
  enrichedEntities?: EnrichedEntity[];
  fundingDigest?: FundingDigestSections | null;
  briefRecordStatus?: string;
  evidence?: Array<{ source?: string }>;
}): { title: string; body: string } {
  const dateLabel = args.dateString ?? new Date().toISOString().slice(0, 10);
  const feedItems = args.feedItems ?? [];
  const storySummaries = args.storySummaries ?? {};
  const storyIntel = args.storyIntel ?? {};
  const coverageSummaries = Array.isArray(args.coverageSummaries) ? args.coverageSummaries : [];
  const coverageRollup = args.coverageRollup ?? null;
  const entityGraph = args.entityGraph ?? null;
  const enrichedEntities = args.enrichedEntities ?? [];
  const fundingDigest = args.fundingDigest ?? null;

  const keyStats = args.dashboardMetrics?.keyStats ?? [];
  const topStories = getTopStories(feedItems, 14);
  const leadCandidates = getRankedLeadStories(feedItems, 10);
  const leadWithSummaries = leadCandidates.filter(
    (story) => story.url && (storySummaries[story.url] || storyIntel[story.url]),
  );
  const leadStory = leadWithSummaries[0] ?? leadCandidates[0] ?? topStories[0];
  const storiesWithSummaries = topStories.filter(
    (story) => story.url && storySummaries[story.url],
  );
  const leadIntel = leadStory?.url ? storyIntel[leadStory.url] : null;
  const leadSummary =
    leadIntel?.summary ||
    (leadStory?.url ? storySummaries[leadStory.url] : "");
  const bySource = args.sourceSummary?.bySource ?? {};
  const byCategory = args.sourceSummary?.byCategory ?? {};
  const topSourcesLine = formatTopSourcesWithLinks(Object.entries(bySource), 4);
  const topCategoriesLine = formatTopList(Object.entries(byCategory), 4);
  const trendingTags = getTopTags(feedItems, args.sourceSummary?.topTrending ?? []);
  const leadLink = leadStory?.url || DASHBOARD_URL;
  const editorTake =
    leadIntel?.lesson ||
    (leadSummary ? extractWhyItMatters(leadSummary) : "");
  const deltaSummary = buildDeltaSummary(
    args.dashboardMetrics,
    args.previousDashboardMetrics,
    3,
  );

  // Generate narrative thesis from actual content (not metadata)
  const llmSynthesis = args.executiveBrief?.actII?.synthesis;
  const isBoilerplate = !llmSynthesis || llmSynthesis.includes("feed clusters around");
  const narrativeThesis = generateNarrativeThesis(
    leadCandidates.length ? leadCandidates : topStories,
    feedItems,
  );
  const synthesis = isBoilerplate ? narrativeThesis : llmSynthesis;

  // Build the 3-Act narrative
  const buildDigestLines = (options: {
    signalLimit: number;
    quickHitLimit: number;
    synthesisLen: number;
    leadSummaryLen: number;
    narrativeLen: number;
    signalSummaryLen: number;
    quickHitSummaryLen: number;
    editorTakeLen: number;
    signalDetailLen: number;
    signalQuoteLen: number;
  }): string[] => {
    const lines: string[] = [];
    const leadLinkLabel = leadStory?.url ? "Source" : "Dashboard";

    // === HEADER ===
    lines.push(`**Morning Dossier** ${dateLabel}`);
    lines.push(`Summary: ${clipText(synthesis, options.synthesisLen)} ${formatMarkdownLink(leadLinkLabel, leadLink)}`);
    if (leadStory?.url) {
      lines.push(`Lead: ${formatMarkdownLink(clipText(leadStory.title, 85), leadStory.url)}`);
      const leadSummaryLine = leadSummary
        ? clipText(leadSummary, options.leadSummaryLen)
        : leadStory.summary
          ? clipText(leadStory.summary, options.leadSummaryLen)
          : "";
      if (leadSummaryLine) lines.push(`Lead context: ${leadSummaryLine} ${formatMarkdownLink("Source", leadStory.url)}`);
      if (editorTake) {
        lines.push(`Editor's Take: ${clipText(editorTake, options.editorTakeLen)} ${formatMarkdownLink("Source", leadStory.url)}`);
      }
    }
    lines.push(formatMarkdownLink("Open Full Dashboard", DASHBOARD_URL)); 
    lines.push(formatMarkdownLink("Open Signals Log", `${DASHBOARD_URL}#signals`)); 
    lines.push(""); 

    // === ACT I: THE SETUP (Narrative thesis, not metadata) ===
    lines.push("**ACT I: The Setup**");
    lines.push(`${clipText(narrativeThesis, options.narrativeLen)} ${formatMarkdownLink(leadLinkLabel, leadLink)}`);
    if (topSourcesLine) {
      const sourcesLine = `Sources: ${topSourcesLine}`;
      lines.push(
        lineHasLink(sourcesLine)
          ? sourcesLine
          : `${sourcesLine} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`,
      );
    }
    if (topCategoriesLine) {
      lines.push(`Sector mix: ${topCategoriesLine} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`);
    }
    if (trendingTags.length > 0) {
      lines.push(`Trending: ${trendingTags.join(" ")} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`);
    }
    if (keyStats.length > 0) {
      const pulseFormatted = keyStats
        .slice(0, 3)
        .map(formatTrendIndicator)
        .join(" | ");
      lines.push(`**Pulse:** ${pulseFormatted} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`);
    }

    lines.push("");
    lines.push("**Numbers that matter**");
    if (deltaSummary) {
      lines.push(`Largest deltas: ${deltaSummary} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`);
    } else {
      lines.push(`Largest deltas: baseline building ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`);
    }
    if (topSourcesLine) {
      const sourcesLine = `Top sources: ${topSourcesLine}`;
      lines.push(
        lineHasLink(sourcesLine)
          ? sourcesLine
          : `${sourcesLine} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`,
      );
    }
    const fastestRisers = getTopStories(feedItems, 3).filter((story) => story.url);
    if (fastestRisers.length > 0) {
      const riserLine = fastestRisers
        .map((story) => formatMarkdownLink(clipText(story.title, 40), story.url))
        .join(", ");
      lines.push(`Fastest risers: ${riserLine}`);
    }

    if (coverageRollup?.overallSummary || coverageSummaries.length > 0) {
      lines.push("");
      lines.push("**Coverage Rollup**");
      const rollupLine = coverageRollup?.overallSummary
        ? clipText(coverageRollup.overallSummary, options.narrativeLen)
        : `Coverage includes ${coverageSummaries.length} summarized items.`;
      lines.push(`${rollupLine} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`);
      const sourceSummaries = Array.isArray(coverageRollup?.sourceSummaries)
        ? coverageRollup.sourceSummaries
        : [];
      sourceSummaries.slice(0, 4).forEach((entry) => {
        const count = typeof entry.count === "number" ? ` (${entry.count})` : "";
        lines.push(`- ${entry.source}${count}: ${clipText(entry.summary, 120)}`);
      });
      if (coverageSummaries.length > 0) {
        lines.push(`Full coverage: ${coverageSummaries.length} summaries ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`);
      }
    }

    // === ACT II: THE SIGNAL ===
    lines.push("");
    lines.push("**ACT II: The Signal**");

    const signals = args.executiveBrief?.actII?.signals ?? [];
    const seenHeadlines = new Set<string>();
    const usedUrls = new Set<string>();
    if (leadStory?.url) usedUrls.add(leadStory.url);

    const uniqueSignals = signals.filter((s: any) => {
      const h = (s.headline ?? "").toLowerCase().trim();
      if (seenHeadlines.has(h)) return false;
      seenHeadlines.add(h);
      return true;
    });

    const signalItems: Array<{
      title: string;
      url: string;
      summary?: string;
      intel?: StoryIntel;
    }> = [];
    uniqueSignals.forEach((signal: any) => {
      if (signalItems.length >= options.signalLimit) return;
      const url = (signal.evidence?.[0]?.url ?? "").trim();
      if (!url || usedUrls.has(url)) return;
      const summary = storySummaries[url];
      const intel = storyIntel[url];
      if (!summary && !intel) return;
      const headline = clipText(signal.headline ?? "Signal", 65);
      signalItems.push({ title: headline, url, summary, intel });
      usedUrls.add(url);
    });

    if (signalItems.length < options.signalLimit) {
      const fallbackStories = storiesWithSummaries
        .filter((story) => story.url && !usedUrls.has(story.url))
        .slice(0, options.signalLimit - signalItems.length);
      fallbackStories.forEach((story) => {
        const intel = storyIntel[story.url];
        signalItems.push({
          title: clipText(story.title, 65),
          url: story.url,
          summary: storySummaries[story.url],
          intel,
        });
        usedUrls.add(story.url);
      });
    }

    if (signalItems.length > 0) {
      signalItems.forEach((signal, idx) => {
        const intelLines = formatIntelLines({
          index: idx + 1,
          title: signal.title,
          url: signal.url,
          intel: signal.intel,
          fallbackSummary: signal.summary,
          summaryLen: options.signalSummaryLen,
          detailLen: options.signalDetailLen,
          quoteLen: options.signalQuoteLen,
        });
        lines.push(...intelLines);
      });
    } else if (topStories.length > 0) {
      const fallback = topStories
        .filter((story) => story.url && storySummaries[story.url])
        .slice(0, options.signalLimit);
      fallback.forEach((story, idx) => {
        const intel = storyIntel[story.url];
        const intelLines = formatIntelLines({
          index: idx + 1,
          title: clipText(story.title, 65),
          url: story.url,
          intel,
          fallbackSummary: storySummaries[story.url],
          summaryLen: options.signalSummaryLen,
          detailLen: options.signalDetailLen,
          quoteLen: options.signalQuoteLen,
        });
        lines.push(...intelLines);
        usedUrls.add(story.url);
      });
    }

    const quickHits = storiesWithSummaries
      .filter((story) => story.url && !usedUrls.has(story.url))
      .slice(0, options.quickHitLimit);
    if (quickHits.length > 0) {
      lines.push("");
      lines.push("**Quick Hits**");
      quickHits.forEach((story) => {
        const intel = storyIntel[story.url];
        const summary = storySummaries[story.url] || intel?.summary || intel?.lesson || "";
        const summaryLine = summary ? ` - ${clipText(summary, options.quickHitSummaryLen)}` : "";
        lines.push(`- ${formatMarkdownLink(clipText(story.title, 70), story.url)}${summaryLine}`);
      });
    }

    const metricsComparables = buildMetricsComparables(
      feedItems,
      args.sourceSummary,
      topSourcesLine,
      topCategoriesLine,
    );
    if (metricsComparables.length > 0) {
      lines.push("");
      lines.push("**Metrics & Comparables**");
      metricsComparables.forEach((line, idx) => {
        if (lineHasLink(line) || idx !== 0) {
          lines.push(line);
        } else {
          lines.push(`${line} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`);
        }
      });
    }

    const personaImplications = buildPersonaImplications(
      feedItems,
      storySummaries,
      storyIntel,
    );
    if (personaImplications.length > 0) {
      lines.push("");
      lines.push("**What this means for...**");
      personaImplications.forEach((line) => lines.push(`- ${line}`));
    }

    const networkEffects = buildNetworkEffectsLines(entityGraph, 4);
    if (networkEffects.length > 0) {
      lines.push("");
      lines.push("**Network Effects**");
      networkEffects.forEach((line) => {
        lines.push(`- ${line} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`);
      });
    }

    // Entity Spotlight (Banker-grade enriched entities)
    const entitySpotlightLines = formatEnrichedEntitiesForDigest(enrichedEntities, 350);
    if (entitySpotlightLines.length > 1) { // More than just header
      lines.push("");
      entitySpotlightLines.forEach((line) => lines.push(line));
    }

    // Today's Funding Targets (Seed/Pre-Seed and Series A)
    const fundingLines = formatFundingEventsForDigest(fundingDigest, 3);
    if (fundingLines.length > 1) { // More than just header
      lines.push("");
      fundingLines.forEach((line) => lines.push(line));
    }

    // === ACT III: THE MOVE ===
    lines.push("");
    lines.push("**ACT III: The Move**");

    const personaActions = buildPersonaActions(feedItems);
    personaActions.forEach((action) => lines.push(`- ${action}`));

    // === FOOTER ===
    lines.push("");
    lines.push("---");
    lines.push(formatMarkdownLink("Open Full Dashboard", DASHBOARD_URL));

    return lines;
  };

  const maxBodyLength = 3800;
  let lines = buildDigestLines({
    signalLimit: 8,
    quickHitLimit: 8,
    synthesisLen: 170,
    leadSummaryLen: 190,
    narrativeLen: 200,
    signalSummaryLen: 120,
    quickHitSummaryLen: 110,
    editorTakeLen: 140,
    signalDetailLen: 120,
    signalQuoteLen: 90,
  });

  let body = sanitizeText(lines.join("\n"));
  if (body.length > maxBodyLength) {
    lines = buildDigestLines({
      signalLimit: 7,
      quickHitLimit: 7,
      synthesisLen: 140,
    leadSummaryLen: 160,
    narrativeLen: 170,
    signalSummaryLen: 90,
    quickHitSummaryLen: 90,
    editorTakeLen: 110,
    signalDetailLen: 100,
    signalQuoteLen: 70,
  });
    body = sanitizeText(lines.join("\n"));
  }
  if (body.length > maxBodyLength) {
    lines = buildDigestLines({
      signalLimit: 6,
      quickHitLimit: 6,
      synthesisLen: 120,
    leadSummaryLen: 130,
    narrativeLen: 140,
    signalSummaryLen: 70,
    quickHitSummaryLen: 70,
    editorTakeLen: 90,
    signalDetailLen: 90,
    signalQuoteLen: 60,
  });
    body = sanitizeText(lines.join("\n"));
  }
  if (body.length > maxBodyLength) {
    const suffix = `\n\n${formatMarkdownLink("Open Full Dashboard", DASHBOARD_URL)}`;
    const limit = Math.max(0, maxBodyLength - suffix.length);
    body = `${body.slice(0, limit).trim()}\n${suffix}`;
  }

  const titleSuffix = leadStory?.title ? ` | ${clipText(leadStory.title, 55)}` : "";
  return {
    title: `Morning Dossier ${dateLabel}${titleSuffix}`,
    body,
  };
}

function buildPersonaActions(feedItems: FeedItemLite[]): string[] {
  // Dedupe feed items by URL first
  const urlMap = new Map<string, FeedItemLite>();
  for (const item of feedItems) {
    const url = (item.url ?? "").trim();
    const existing = url ? urlMap.get(url) : undefined;
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) {
      urlMap.set(url || `no-url-${urlMap.size}`, item);
    }
  }
  const dedupedItems = Array.from(urlMap.values());

  const configs = [
    {
      label: "Investors",
      keywords: ["funding", "raise", "series", "acquisition", "nvidia", "billion", "ipo", "valuation", "deal"],
      action: (item: FeedItemLite) => {
        const shortName = extractShortName(item.url ?? "");
        const url = (item.url ?? "").trim();
        const linkedName = url ? formatMarkdownLink(shortName, url) : shortName;
        // Avoid name:name echo - use summary or a smart fallback
        const context = item.summary && !item.summary.includes("Trending")
          ? clipText(item.summary, 45)
          : clipText(item.title, 45);
        // Don't repeat shortName if it's already in context
        if (context.toLowerCase().includes(shortName.toLowerCase())) {
          return url
            ? `Track: ${context} ${formatMarkdownLink("Source", url)}`
            : `Track: ${context} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`;
        }
        return url
          ? `Track ${linkedName}: ${context}`
          : `Track ${linkedName}: ${context} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`;
      },
    },
    {
      label: "Engineers",
      keywords: ["github", "repo", "release", "library", "sdk", "runtime", "benchmark", "tool"],
      action: (item: FeedItemLite) => {
        const shortName = extractShortName(item.url ?? "");
        const url = (item.url ?? "").trim();
        const linkedName = url ? formatMarkdownLink(shortName, url) : shortName;
        // Provide actionable context
        const desc = item.summary && !item.summary.includes("Trending")
          ? clipText(item.summary, 40)
          : null;
        if (desc) {
          return url
            ? `Evaluate ${linkedName} - ${desc}`
            : `Evaluate ${linkedName} - ${desc} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`;
        }
        return url
          ? `Evaluate ${linkedName} for your stack`
          : `Evaluate ${linkedName} for your stack ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`;
      },
    },
    {
      label: "Researchers",
      keywords: ["paper", "arxiv", "study", "model", "architecture", "benchmark", "research"],
      action: (item: FeedItemLite) => {
        const url = (item.url ?? "").trim();
        const title = clipText(item.title, 55);
        return url
          ? `Review: ${formatMarkdownLink(title, url)}`
          : `Review: ${title} ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`;
      },
    },
  ];

  const normalized = dedupedItems.map((item) => ({
    ...item,
    text: normalizeText(`${item.title} ${item.summary ?? ""} ${(item.tags ?? []).join(" ")}`).toLowerCase(),
  }));

  const usedUrls = new Set<string>();
  const actions: string[] = [];

  for (const config of configs) {
    const matches = normalized.filter((item) => {
      const url = (item.url ?? "").trim();
      if (url && usedUrls.has(url)) return false;
      return config.keywords.some((kw) => item.text.includes(kw));
    });

    const top = matches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (top) {
      const url = (top.url ?? "").trim();
      if (url) usedUrls.add(url);
      actions.push(`${config.label}: ${config.action(top)}`);
    }
  }

  // Always include a default action
  if (actions.length === 0) {
    actions.push(`Review the dashboard for today's highlights ${formatMarkdownLink("Dashboard", DASHBOARD_URL)}`);
  }

  return actions;
}


// ═══════════════════════════════════════════════════════════════════════════
// AGENT-POWERED DIGEST GENERATION (Phase 2)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the daily morning brief with agent-powered digest generation.
 * 
 * This is an alternative to the rule-based buildNtfyDigestPayload that uses
 * the coordinator agent for narrative synthesis and story analysis.
 * 
 * Benefits:
 * - Dynamic narrative that adapts to content themes
 * - Persona-aware prioritization of stories
 * - Can use tools for deeper analysis if needed
 * - Same quality as Fast Agent Panel responses
 */
export const runAgentPoweredDigest = (internalAction as any)({
  args: {
    useTools: v.optional(v.boolean()), // Enable deep analysis (slower, more thorough)
    persona: v.optional(v.string()),   // Target persona for digest
    model: v.optional(v.string()),     // Override default model
    sendNtfy: v.optional(v.boolean()), // Actually send the notification (default: true)
    maxFeedItems: v.optional(v.number()), // Reduce prompt size for faster runs
    maxDigestChars: v.optional(v.number()), // Hint for digest size (passed to digest agent)
    detectBreakingAlerts: v.optional(v.boolean()),
    breakingMinUrgency: v.optional(v.string()),
    breakingTopic: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const startTime = Date.now();
    const useTools = args.useTools ?? false;
    const persona = args.persona ?? "GENERAL";
    const model = args.model ?? "claude-haiku-4.5";
    const sendNtfy = args.sendNtfy ?? true;
    const maxFeedItems = typeof args.maxFeedItems === "number" ? args.maxFeedItems : 50;
    const maxDigestChars = typeof args.maxDigestChars === "number" ? args.maxDigestChars : 3500;
    const detectBreakingAlerts = args.detectBreakingAlerts ?? true;
    const breakingMinUrgency = args.breakingMinUrgency ?? "high";
    const breakingTopic = args.breakingTopic;

    console.log(`[agentPoweredDigest] Starting agent digest generation, persona=${persona}, useTools=${useTools}, model=${model}`);

    try {
      // Step 1: Get feed items
      const feedItems = await ctx.runQuery(
        internal.domains.research.dashboardQueries.getFeedItemsForMetrics,
        {}
      ) as FeedItemLite[];

      console.log(`[agentPoweredDigest] Retrieved ${feedItems.length} feed items`);

      // Step 2: Generate agent-powered digest
      const digestResult = await ctx.runAction(
        internal.domains.agents.digestAgent.generateAgentDigest,
        {
          feedItems: feedItems.slice(0, Math.max(1, maxFeedItems)).map((item: FeedItemLite) => ({
            title: item.title,
            summary: item.summary,
            source: item.source,
            tags: item.tags,
            category: item.category,
            score: item.score,
            publishedAt: item.publishedAt,
            type: item.type,
            url: item.url,
          })),
          persona,
          model,
          useTools,
          maxLength: maxDigestChars,
          outputMode: "structured",
          useCache: true,
        }
      );

      if (digestResult.error || !digestResult.digest) {
        console.error(`[agentPoweredDigest] Agent digest failed:`, digestResult.error);
        return {
          success: false,
          error: digestResult.error || "No digest generated",
          usage: digestResult.usage,
        };
      }

      console.log(`[agentPoweredDigest] Agent digest generated in ${digestResult.digest.processingTimeMs}ms`);

      // Optional: breaking alert detection on the lead story (digest flow integration)
      if (detectBreakingAlerts && digestResult.digest.leadStory) {
        const leadUrl = digestResult.digest.leadStory.url;
        const leadTitle = digestResult.digest.leadStory.title;

        const leadItem =
          feedItems.find((i) => leadUrl && i.url && i.url === leadUrl) ??
          feedItems.find((i) => i.title && i.title === leadTitle) ??
          null;

        if (leadItem) {
          try {
            await ctx.runAction(internal.domains.agents.digestAgent.sendBreakingAlertIfWarranted, {
              story: {
                title: leadItem.title,
                summary: leadItem.summary,
                source: leadItem.source,
                url: leadItem.url,
                publishedAt: leadItem.publishedAt,
                category: leadItem.category,
                tags: leadItem.tags,
              },
              topic: breakingTopic,
              minUrgency: breakingMinUrgency,
            });
          } catch (err: any) {
            console.warn(`[agentPoweredDigest] Breaking alert detection failed (non-blocking):`, err?.message);
          }
        }
      }

      // Step 3: Format for ntfy
      const { formatDigestForNtfy } = await import("../domains/agents/digestAgent");
      const ntfyPayload = formatDigestForNtfy(digestResult.digest, {
        maxLength: 3800,
        dashboardUrl: DASHBOARD_URL,
      });

      console.log(`[agentPoweredDigest] Formatted for ntfy: ${ntfyPayload.body.length} chars`);

      // Cache the ntfy payload so other channels can reuse the digest without regeneration.
      let cacheId: any = null;
      try {
        cacheId = await ctx.runMutation(internal.domains.agents.digestAgent.cacheDigest, {
          dateString: digestResult.digest.dateString,
          persona,
          model,
          rawText: digestResult.rawText,
          digest: digestResult.digest,
          ntfyPayload,
          usage: {
            inputTokens: digestResult.usage.inputTokens ?? 0,
            outputTokens: digestResult.usage.outputTokens ?? 0,
          },
          feedItemCount: digestResult.digest.storyCount,
          ttlHours: 24,
        });
      } catch (cacheErr: any) {
        console.warn("[agentPoweredDigest] Failed to cache digest payload (non-blocking):", cacheErr?.message);
      }

      // Step 4: Send notification
      let ntfySent = false;
      if (sendNtfy) {
        await ctx.runAction(api.domains.integrations.ntfy.sendNotification, {
          title: ntfyPayload.title,
          body: ntfyPayload.body,
          priority: 3,
          tags: ["newspaper", "robot", "briefcase"],
          click: DASHBOARD_URL,
          eventType: "agent_morning_digest",
        });
        ntfySent = true;
        console.log(`[agentPoweredDigest] ntfy notification sent`);

        if (cacheId) {
          try {
            await ctx.runMutation(internal.domains.agents.digestAgent.markDigestSent, {
              digestId: cacheId,
              channel: "ntfy",
            });
          } catch (markErr: any) {
            console.warn("[agentPoweredDigest] Failed to mark digest as sent (non-blocking):", markErr?.message);
          }
        }
      }

      const totalTime = Date.now() - startTime;

      return {
        success: true,
        ntfySent,
        digest: digestResult.digest,
        ntfyPayload,
        usage: digestResult.usage,
        totalTimeMs: totalTime,
        storyCount: feedItems.length,
      };
    } catch (error: any) {
      console.error(`[agentPoweredDigest] Error:`, error);
      return {
        success: false,
        error: error.message || String(error),
        totalTimeMs: Date.now() - startTime,
      };
    }
  },
});

/**
 * Run breaking alert detection on recent feed items.
 * 
 * This scans recent stories and sends push notifications for
 * genuinely important breaking news.
 */
export const runBreakingAlertScan = (internalAction as any)({
  args: {
    hoursBack: v.optional(v.number()),   // How far back to scan (default: 2)
    limit: v.optional(v.number()),       // Max stories to check (default: 20)
    minUrgency: v.optional(v.string()),  // Minimum urgency to alert (default: "high")
    topic: v.optional(v.string()),       // ntfy topic override
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const hoursBack = args.hoursBack ?? 2;
    const limit = args.limit ?? 20;
    const minUrgency = args.minUrgency ?? "high";
    const topic = args.topic;

    console.log(`[breakingAlertScan] Scanning last ${hoursBack}h, limit=${limit}, minUrgency=${minUrgency}`);

    // Get recent feed items
    const feedItems = await ctx.runAction(
      internal.domains.agents.digestAgent.getFeedItemsForDigest,
      { hoursBack, limit }
    );

    console.log(`[breakingAlertScan] Found ${feedItems.length} recent items to analyze`);

    const results: Array<{
      title: string;
      alertSent: boolean;
      urgency: string;
    }> = [];

    let alertsSent = 0;

    // Analyze each story (with rate limiting to avoid spam)
    for (const item of feedItems) {
      if (alertsSent >= 3) {
        console.log(`[breakingAlertScan] Max alerts (3) reached, stopping scan`);
        break;
      }

      try {
        const result = await ctx.runAction(
          internal.domains.agents.digestAgent.sendBreakingAlertIfWarranted,
          {
            story: {
              title: item.title,
              summary: item.summary,
              source: item.source,
              url: item.url,
              publishedAt: item.publishedAt,
              category: item.category,
              tags: item.tags,
            },
            topic,
            minUrgency,
          }
        );

        results.push({
          title: item.title,
          alertSent: result.alertSent,
          urgency: result.analysis.urgency,
        });

        if (result.alertSent) {
          alertsSent++;
        }
      } catch (err: any) {
        console.warn(`[breakingAlertScan] Error analyzing "${item.title}":`, err?.message);
      }
    }

    console.log(`[breakingAlertScan] Complete: ${alertsSent} alerts sent from ${feedItems.length} stories`);

    return {
      storiesAnalyzed: feedItems.length,
      alertsSent,
      results,
    };
  },
});
