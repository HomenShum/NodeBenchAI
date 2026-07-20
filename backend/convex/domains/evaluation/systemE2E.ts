"use node";

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { api, internal } from "../../_generated/api";

// Type definitions for parsed JSON responses and snapshot data
interface ParsedLocalContextResponse {
  nowIso?: string;
  timezone?: string;
  utcDay?: string;
  latestSnapshotDate?: string | null;
  trendingTopics?: string[];
  recentDiscoveries?: string[];
  clientLocale?: string | null;
  clientUtcOffsetMinutes?: number | null;
  location?: string | null;
}

interface DashboardSnapshot {
  dateString?: string;
  sourceSummary?: {
    topTrending?: string[];
  };
}

function toErrString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function utcDayString(ms = Date.now()): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function extractJsonObject(text: string): unknown {
  const raw = (text ?? "").trim();
  if (!raw) return null;

  const fenced =
    raw.match(/```json\s*([\s\S]*?)```/i)?.[1] ??
    raw.match(/```\s*([\s\S]*?)```/i)?.[1] ??
    null;

  const candidate = (fenced ?? raw).trim();
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function isIsoString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}

function withinMinutes(iso: string, baselineMs: number, windowMinutes: number): boolean {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return false;
  const diff = Math.abs(parsed - baselineMs);
  return diff <= windowMinutes * 60 * 1000;
}

function pickBestAssistantText(messages: Array<{ role: string; content: string }>): string {
  let best = "";
  for (const m of messages) {
    if (m?.role !== "assistant") continue;
    const t = String(m?.content ?? "").trim();
    if (t.length > best.length) best = t;
  }
  return best;
}

export const validateDailyBriefing = action({
  args: {
    runWorkflow: v.optional(v.boolean()),
    day: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const day = args.day ?? utcDayString(startedAt);

    let workflowOk = true;
    let workflowError: string | null = null;
    let workflowResult: unknown = null;

    if (args.runWorkflow !== false) {
      try {
        workflowResult = await ctx.runAction((internal as any).workflows.dailyMorningBrief.runDailyMorningBrief, {});
      } catch (e) {
        workflowOk = false;
        workflowError = toErrString(e);
      }
    }

    const entries = await ctx.runQuery(api.domains.landing.landingPageLog.listPublic, {
      day,
      limit: 250,
    });

    const briefEntries = entries.filter((e: any) => e?.kind === "brief");
    const latestBrief = briefEntries.length ? briefEntries[0] : null;

    return {
      ok: workflowOk && briefEntries.length > 0,
      day,
      elapsedMs: Date.now() - startedAt,
      workflow: {
        ok: workflowOk,
        error: workflowError,
        hasResult: !!workflowResult,
      },
      landingLog: {
        totalEntries: entries.length,
        briefEntries: briefEntries.length,
        latestBriefTitle: latestBrief?.title ?? null,
        latestBriefCreatedAt: latestBrief?.createdAt ?? null,
      },
    };
  },
});

export const validateFastAgentLocalContext = action({
  args: {
    timeoutMs: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const timeoutMs = Math.max(15_000, Math.min(args.timeoutMs ?? 120_000, 240_000));

    const sessionId = `local_ctx_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const injectedClientContext = {
      timezone: "America/Los_Angeles",
      locale: "en-US",
      // Jan 4 is typically PST (UTC-8) => JS getTimezoneOffset() = 480.
      utcOffsetMinutes: 480,
      location: "San Francisco, CA, US",
    };
    const latestSnapshot = await (async (): Promise<DashboardSnapshot | null> => {
      try {
        return await ctx.runQuery(api.domains.research.dashboardQueries.getLatestDashboardSnapshot, {}) as DashboardSnapshot | null;
      } catch {
        return null;
      }
    })();

    const threadId = await ctx.runAction(api.domains.agents.fastAgentPanelStreaming.createThread, {
      title: "E2E Local Context Smoke",
      anonymousSessionId: sessionId,
      model: "claude-haiku-4.5",
    });

    const prompt = [
      "Return ONLY valid JSON (no markdown fences).",
      "Use ONLY the values present in the provided LOCAL CONTEXT header (do not call tools).",
      "",
      "JSON schema:",
      "{",
      '  "nowIso": string,',
      '  "timezone": string,',
      '  "utcDay": string,',
      '  "latestSnapshotDate": string | null,',
      '  "trendingTopics": string[],',
      '  "recentDiscoveries": string[],',
      '  "clientLocale": string | null,',
      '  "clientUtcOffsetMinutes": number | null,',
      '  "location": string | null',
      "}",
      "",
      "Rules:",
      "- nowIso must equal the LOCAL CONTEXT Now (ISO) value exactly.",
      "- trendingTopics must match the LOCAL CONTEXT Trending topics list (or empty if none).",
      "- recentDiscoveries must include the LOCAL CONTEXT Recent discoveries items split into an array (or empty if none).",
      "- clientLocale must equal the LOCAL CONTEXT Client locale value exactly (or null if missing).",
      "- clientUtcOffsetMinutes must equal the LOCAL CONTEXT Client UTC offset minutes value exactly (or null if missing).",
      "- location must equal the LOCAL CONTEXT Location value exactly (or null if unknown).",
    ].join("\n");

    await ctx.runAction(api.domains.agents.fastAgentPanelStreaming.sendMessageStreaming, {
      threadId,
      content: prompt,
      model: "claude-haiku-4.5",
      anonymousSessionId: sessionId,
      useCoordinator: true,
      clientContext: injectedClientContext,
    });

    let bestText = "";
    let stablePolls = 0;
    const minChars = 40;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const messages = await ctx.runQuery(api.domains.agents.fastAgentPanelStreaming.getThreadMessagesForEval, {
        threadId,
        anonymousSessionId: sessionId,
      });
      const assistant = pickBestAssistantText(messages);
      if (assistant && assistant !== bestText) {
        bestText = assistant;
        stablePolls = 0;
      } else if (assistant) {
        stablePolls++;
      }
      if (bestText.length >= minChars && stablePolls >= 2) break;
    }

    const parsed = extractJsonObject(bestText) as ParsedLocalContextResponse | null;
    const nowIso = parsed?.nowIso;
    const okNow =
      typeof nowIso === "string" && isIsoString(nowIso) && withinMinutes(nowIso, startedAt, 10);

    const okTimezone = typeof parsed?.timezone === "string" && parsed.timezone.length > 0;
    const okUtcDay =
      typeof parsed?.utcDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.utcDay);

    const expectedSnapshotDate = latestSnapshot?.dateString ?? null;
    const okSnapshot =
      expectedSnapshotDate === null
        ? parsed?.latestSnapshotDate === null || typeof parsed?.latestSnapshotDate === "string"
        : parsed?.latestSnapshotDate === expectedSnapshotDate;

    const expectedTrending = Array.isArray(latestSnapshot?.sourceSummary?.topTrending)
      ? latestSnapshot.sourceSummary.topTrending.slice(0, 8)
      : [];
    const okTrending =
      Array.isArray(parsed?.trendingTopics) &&
      (expectedTrending.length === 0 ||
        expectedTrending.some((t: string) => parsed.trendingTopics!.includes(t)));

    const okDiscoveries = Array.isArray(parsed?.recentDiscoveries);

    const okClientLocale =
      parsed?.clientLocale === injectedClientContext.locale ||
      (parsed?.clientLocale == null && injectedClientContext.locale == null);
    const okClientOffset =
      parsed?.clientUtcOffsetMinutes === injectedClientContext.utcOffsetMinutes ||
      (parsed?.clientUtcOffsetMinutes == null && injectedClientContext.utcOffsetMinutes == null);
    const okLocation =
      parsed?.location === injectedClientContext.location ||
      (parsed?.location == null && injectedClientContext.location == null);

    const ok =
      !!parsed &&
      okNow &&
      okTimezone &&
      okUtcDay &&
      okSnapshot &&
      okTrending &&
      okDiscoveries &&
      okClientLocale &&
      okClientOffset &&
      okLocation;

    return {
      ok,
      elapsedMs: Date.now() - startedAt,
      sessionId,
      threadId,
      expected: {
        latestSnapshotDate: expectedSnapshotDate,
        trendingTopicsSample: expectedTrending.slice(0, 3),
        clientContext: injectedClientContext,
      },
      got: parsed,
      rawAssistantTextPreview: bestText.slice(0, 600),
      checks: {
        parsedJson: !!parsed,
        nowIso: okNow,
        timezone: okTimezone,
        utcDay: okUtcDay,
        latestSnapshotDate: okSnapshot,
        trendingTopics: okTrending,
        recentDiscoveries: okDiscoveries,
        clientLocale: okClientLocale,
        clientUtcOffsetMinutes: okClientOffset,
        location: okLocation,
      },
    };
  },
});

export const runAnonymousEvalSuite = action({
  args: {
    queryIds: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const sessionId = `eval_suite_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const queryIds = (args.queryIds ?? ["banker-disco-1", "cto-quickjs-1", "exec-gemini-1"]).slice(0, 5);

    const settled = await Promise.allSettled(
      queryIds.map(async (queryId: string) => {
        const res = await ctx.runAction(api.domains.evaluation.liveEval.runSingleEvalAnonymous, {
          queryId,
          sessionId,
        });
        return { queryId, ...res };
      }),
    );

    const results: any[] = settled.map((r, idx) => {
      if (r.status === "fulfilled") return r.value;
      return { queryId: queryIds[idx], result: null, error: toErrString(r.reason), remainingQueries: 0 };
    });

    const passed = results.filter((r) => r?.result?.overallPass === true).length;
    const total = results.length;
    return {
      ok: passed === total && total > 0,
      elapsedMs: Date.now() - startedAt,
      sessionId,
      summary: { total, passed, failed: total - passed },
      results: results.map((r) => ({
        queryId: r.queryId,
        passed: r?.result?.overallPass === true,
        score:
          r?.result && typeof r.result.passedFactors === "number" && typeof r.result.totalFactors === "number" && r.result.totalFactors > 0
            ? Math.round((r.result.passedFactors / r.result.totalFactors) * 100) / 100
            : 0,
        remainingQueries: r?.remainingQueries,
        failureReasons: r?.result?.failureReasons ?? [],
        responsePreview: r?.result?.response ?? null,
      })),
    };
  },
});
