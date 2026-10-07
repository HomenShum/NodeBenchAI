/**
 * Signal Collector Agent - Quantitative Signal Extraction (Phase 7)
 *
 * Runs after the Publisher Agent to extract quantitative signal metrics
 * from news items and narrative events. Populates narrativeSignalMetrics
 * for hypothesis scoring.
 *
 * Domains:
 *   - attention: News volume, social mentions, search interest
 *   - policy: EO/memo/procurement activity, regulatory mentions
 *   - labor: Job postings, layoffs, hiring mentions
 *   - market: Funding, M&A, insider trading mentions
 *   - sentiment: Positive/negative framing ratios
 *
 * @module domains/narrative/newsroom/agents/signalCollectorAgent
 */

import { generateText } from "ai";
import type { ActionCtx } from "../../../../../_generated/server";
import { internal } from "../../../../../_generated/api";
import { getLanguageModelSafe } from "../../../../agents/mcp_tools/models";
import type { NewsroomState, NewsItem } from "../state";
import type { SignalDomain, SourceTier } from "../../validators";

/**
 * Configuration for Signal Collector Agent
 */
export interface SignalCollectorConfig {
  /** Model to use for signal extraction */
  model?: string;
  /** Minimum confidence to record a metric */
  minConfidence?: number;
  /** Maximum metrics per domain per run */
  maxMetricsPerDomain?: number;
}

const DEFAULT_CONFIG: Required<SignalCollectorConfig> = {
  model: "qwen3-coder-free",
  minConfidence: 0.5,
  maxMetricsPerDomain: 5,
};

/**
 * Raw signal extracted from news items
 */
interface ExtractedSignal {
  domain: SignalDomain;
  metricName: string;
  topic: string;
  value: number;
  unit: string;
  confidence: number;
  sourceDescription: string;
  sourceUrls: string[];
  sourceTier: SourceTier;
  baselineValue?: number;
  deltaFromBaseline?: number;
}

/**
 * Build prompt for LLM-based signal extraction
 */
function buildSignalExtractionPrompt(
  newsItems: NewsItem[],
  threadName?: string,
  thesis?: string
): string {
  const newsBlock = newsItems
    .slice(0, 15)
    .map((n, i) => `[${i + 1}] "${n.headline}" (${n.source}, ${n.publishedAt})\n    ${n.snippet?.slice(0, 200) ?? ""}`)
    .join("\n");

  return `You are a quantitative signal analyst. Extract measurable data points from this week's news.

${threadName ? `Thread: "${threadName}"` : ""}
${thesis ? `Thesis: "${thesis}"` : ""}

NEWS THIS WEEK:
${newsBlock}

Extract up to 10 quantitative signals across these 5 domains:
- attention: News volume shifts, social mention spikes, search interest changes
- policy: Executive orders, regulatory actions, procurement, legislation mentions
- labor: Layoff counts, hiring freezes, job posting changes, workforce shifts
- market: Funding rounds, M&A activity, stock movements, insider trading
- sentiment: Positive vs negative framing ratios, public opinion shifts

For each signal, provide a numeric value representing magnitude or count.
Source tier rules:
- tier1: Government filings, SEC, court docs, official statistics
- tier2: Major wire services (Reuters, AP, Bloomberg), peer-reviewed research
- tier3: Major newspapers, trade publications with editorial review
- tier4: Blogs, social media, unverified sources

Respond ONLY with valid JSON:
{
  "signals": [
    {
      "domain": "attention|policy|labor|market|sentiment",
      "metricName": "short_metric_name",
      "topic": "what this measures",
      "value": 0.0,
      "unit": "count|percent|ratio|index",
      "confidence": 0.0,
      "sourceDescription": "where this came from",
      "sourceTier": "tier1|tier2|tier3|tier4",
      "baselineValue": null,
      "deltaFromBaseline": null
    }
  ]
}

Only include signals you can justify from the news. Do not fabricate data.
If no quantitative signals are extractable, return {"signals": []}.`;
}

/**
 * Parse LLM response to extract signals
 */
function parseSignalResponse(response: string, newsItems: NewsItem[]): ExtractedSignal[] {
  try {
    let jsonStr = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    if (!parsed.signals || !Array.isArray(parsed.signals)) return [];

    const validDomains = new Set(["attention", "policy", "labor", "market", "sentiment"]);
    const validTiers = new Set(["tier1", "tier2", "tier3", "tier4"]);

    const sourceUrls = newsItems
      .filter((n) => !!n.url)
      .map((n) => n.url)
      .slice(0, 5);

    return parsed.signals
      .filter((s: any) =>
        s.domain && validDomains.has(s.domain) &&
        s.metricName && typeof s.metricName === "string" &&
        typeof s.value === "number" &&
        typeof s.confidence === "number" &&
        s.confidence >= 0.3
      )
      .map((s: any) => ({
        domain: s.domain as SignalDomain,
        metricName: String(s.metricName).slice(0, 100),
        topic: String(s.topic || s.metricName).slice(0, 200),
        value: s.value,
        unit: String(s.unit || "index").slice(0, 20),
        confidence: Math.min(1, Math.max(0, s.confidence)),
        sourceDescription: String(s.sourceDescription || "Extracted from weekly news").slice(0, 300),
        sourceUrls,
        sourceTier: (validTiers.has(s.sourceTier) ? s.sourceTier : "tier4") as SourceTier,
        baselineValue: typeof s.baselineValue === "number" ? s.baselineValue : undefined,
        deltaFromBaseline: typeof s.deltaFromBaseline === "number" ? s.deltaFromBaseline : undefined,
      }));
  } catch (e) {
    console.error("[SignalCollector] Failed to parse signal response:", e);
    return [];
  }
}

/**
 * Run the Signal Collector Agent.
 *
 * Extracts quantitative signal metrics from news items and persists them
 * to narrativeSignalMetrics for hypothesis scoring.
 */
export async function runSignalCollectorAgent(
  ctx: ActionCtx,
  state: NewsroomState,
  config: SignalCollectorConfig = {}
): Promise<NewsroomState> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!state.weeklyNews || state.weeklyNews.length === 0) {
    console.log("[SignalCollector] No news items to extract signals from");
    return state;
  }

  console.log(`[SignalCollector] Extracting signals from ${state.weeklyNews.length} news items`);

  // Get thread context if available
  const threadId = state.publishedThreadIds?.[0];
  let threadName: string | undefined;
  let thesis: string | undefined;

  if (threadId) {
    try {
      const thread = await ctx.runQuery(
        internal.domains.narrative.queries.hypotheses.getByThreadInternal,
        { threadId: threadId as any }
      );
      // Just use the thread name from existing threads
      if (state.existingThreads.length > 0) {
        threadName = state.existingThreads[0].name;
        thesis = state.existingThreads[0].thesis;
      }
    } catch {
      // Non-fatal
    }
  } else if (state.existingThreads.length > 0) {
    threadName = state.existingThreads[0].name;
    thesis = state.existingThreads[0].thesis;
  }

  // Extract signals via LLM
  const prompt = buildSignalExtractionPrompt(state.weeklyNews, threadName, thesis);
  let signals: ExtractedSignal[] = [];

  try {
    const model = await getLanguageModelSafe(cfg.model);
    const result = await generateText({
      model,
      prompt,
      temperature: 0.2,
    });

    signals = parseSignalResponse(result.text, state.weeklyNews);
    console.log(`[SignalCollector] Extracted ${signals.length} signals`);
  } catch (e) {
    console.error("[SignalCollector] LLM extraction failed:", e);
    return state;
  }

  // Filter by confidence threshold
  const qualified = signals.filter((s) => s.confidence >= cfg.minConfidence);
  if (qualified.length === 0) {
    console.log("[SignalCollector] No signals met confidence threshold");
    return state;
  }

  // Cap per domain
  const domainCounts: Record<string, number> = {};
  const capped = qualified.filter((s) => {
    const count = domainCounts[s.domain] ?? 0;
    if (count >= cfg.maxMetricsPerDomain) return false;
    domainCounts[s.domain] = count + 1;
    return true;
  });

  // Persist signals
  const now = Date.now();
  const windowStartAt = now - 7 * 24 * 60 * 60 * 1000; // 1 week window
  const windowEndAt = now;

  const metricsToRecord = capped.map((s) => ({
    threadId: threadId as any,
    hypothesisId: undefined,
    domain: s.domain,
    metricName: s.metricName,
    topic: s.topic,
    value: s.value,
    unit: s.unit,
    measuredAt: now,
    windowStartAt,
    windowEndAt,
    sourceDescription: s.sourceDescription,
    sourceUrls: s.sourceUrls,
    sourceTier: s.sourceTier,
    confidence: s.confidence,
    baselineValue: s.baselineValue,
    deltaFromBaseline: s.deltaFromBaseline,
    collectedByAgent: "signal_collector",
  }));

  try {
    if (threadId) {
      await ctx.runMutation(
        internal.domains.narrative.mutations.signalMetrics.batchRecordMetricsInternal,
        { metrics: metricsToRecord }
      );
      console.log(`[SignalCollector] Persisted ${metricsToRecord.length} metrics for thread ${threadId}`);
    } else {
      // Record without thread binding
      const unbound = metricsToRecord.map((m) => ({ ...m, threadId: undefined }));
      await ctx.runMutation(
        internal.domains.narrative.mutations.signalMetrics.batchRecordMetricsInternal,
        { metrics: unbound }
      );
      console.log(`[SignalCollector] Persisted ${unbound.length} unbound metrics`);
    }
  } catch (e) {
    console.error("[SignalCollector] Failed to persist metrics:", e);
  }

  return {
    ...state,
    searchLogs: [
      ...state.searchLogs,
      {
        query: "signal_collection",
        searchType: "verification" as const,
        resultCount: capped.length,
        resultUrls: [],
      },
    ],
  };
}

/**
 * Tool definition for agent pipeline orchestration
 */
export const signalCollectorAgentTool = {
  name: "signal_collector",
  description: "Extracts quantitative signal metrics from news items for hypothesis scoring",
  run: runSignalCollectorAgent,
};
