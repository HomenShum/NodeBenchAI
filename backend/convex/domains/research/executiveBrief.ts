"use node";

/**
 * Executive Brief Generator (Structured Outputs)
 *
 * Produces a strict DailyBriefPayload (3-Act story with evidence + viz artifact)
 * and stores it inside dailyBriefMemories.context.executiveBrief.
 *
 * Key guarantees:
 * - Uses OpenAI Structured Outputs (json_schema, strict: true)
 * - Runs anti-log lint (validateBriefPayload)
 * - Retries once with "rewrite synthesis only" instruction
 * - Falls back deterministically if generation fails
 */

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

import OpenAI from "openai";
import { getLlmModel } from "../../../shared/llm/modelCatalog";
import { createHash, randomUUID } from "crypto";

import {
  DailyBriefJSONSchema,
  type DailyBriefPayload,
  type Evidence,
  type Signal,
  type Action as BriefAction,
  type VizArtifact,
} from "../../../src/features/research/types/dailyBriefSchema";
import {
  BRIEF_SYSTEM_PROMPT,
  BRIEF_OUTPUT_CONSTRAINTS,
  BRIEF_EXAMPLE_PROMPT,
} from "../../../src/features/research/prompts/briefConstraints";
import {
  parseAndValidateBrief,
  buildRetryPrompt,
} from "../../../src/features/research/utils/briefGenerator";

type FeedItem = {
  sourceId?: string;
  title?: string;
  summary?: string;
  url?: string;
  source?: string;
  type?: string;
  category?: string;
  tags?: string[];
  score?: number;
  publishedAt?: string;
  metrics?: Array<{ label: string; value: string; trend?: "up" | "down" }>;
};

type RetrievalRun = {
  runId: string;
  tool: string;
  query: string;
  executedAt: string;
  topK: number;
  datasetHash: string;
};

type ExecutiveBriefRecord = {
  status: "valid" | "invalid";
  brief: DailyBriefPayload;
  evidence: Evidence[];
  provenance: { retrievalRuns: RetrievalRun[] };
  errors?: string[];
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function evidenceIdForUrl(url: string): string {
  const canonical = url.trim();
  return `ev-${sha256Hex(canonical).slice(0, 12)}`;
}

function safeSourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function safeDateString(dateString: string): string {
  // Expect YYYY-MM-DD; fall back to today in UTC if invalid.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return dateString;
  return new Date().toISOString().split("T")[0];
}

function safeIso(dateString: string, fallbackHour = 12): string {
  const day = safeDateString(dateString);
  return `${day}T${String(fallbackHour).padStart(2, "0")}:00:00.000Z`;
}

function stripReservedKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripReservedKeys);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const next: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      if (key.startsWith("$")) continue;
      next[key] = stripReservedKeys(val);
    }
    return next;
  }
  return value;
}

function toEvidence(item: FeedItem, idx: number, dateString: string): Evidence {
  const source = (item.source ?? "Other");
  const title = (item.title ?? `Evidence ${idx + 1}`).slice(0, 240);
  const url = (item.url ?? "").trim();
  const publishedAt =
    typeof item.publishedAt === "string" && item.publishedAt
      ? item.publishedAt
      : safeIso(dateString, 9);
  const score = typeof item.score === "number" ? item.score : undefined;

  return {
    id: evidenceIdForUrl(url || `https://example.com/unknown/${slugify(title)}`),
    source,
    title,
    url: url || `https://example.com/unknown/${slugify(title)}`,
    publishedAt,
    relevance:
      (typeof item.summary === "string" && item.summary.trim().slice(0, 220)) ||
      "Primary source supporting this signal.",
    score,
    sourceDomain: safeSourceDomain(url || `https://example.com/unknown/${slugify(title)}`),
  };
}

function buildEvidenceLibrary(args: {
  dateString: string;
  runId: string;
  feedItems: FeedItem[];
  topK: number;
}): Evidence[] {
  const dateString = safeDateString(args.dateString);
  const items = args.feedItems
    .filter((i) => i && typeof i.url === "string" && i.url.trim())
    .slice(0, clamp(args.topK, 1, 80));

  return items.map((item, idx) => {
    const url = (item.url ?? "").trim();
    const publishedAt =
      typeof item.publishedAt === "string" && item.publishedAt
        ? item.publishedAt
        : safeIso(dateString, 9);

    return {
      id: evidenceIdForUrl(url),
      source: (item.source ?? "Other"),
      title: (item.title ?? `Evidence ${idx + 1}`).slice(0, 240),
      url,
      publishedAt,
      relevance:
        (typeof item.summary === "string" && item.summary.trim().slice(0, 220)) ||
        "Primary source supporting this signal.",
      score: typeof item.score === "number" ? item.score : undefined,
      runId: args.runId,
      rank: idx + 1,
      sourceDomain: safeSourceDomain(url),
    } as any;
  });
}

function buildDeterministicBrief(args: {
  dateString: string;
  version?: number;
  sourceSummary?: any;
  feedItems: FeedItem[];
  features?: any[];
}): DailyBriefPayload {
  const dateString = safeDateString(args.dateString);

  const bySource: Record<string, number> =
    args.sourceSummary?.bySource && typeof args.sourceSummary.bySource === "object"
      ? args.sourceSummary.bySource
      : {};
  const topSources = Object.entries(bySource)
    .filter(([, c]) => typeof c === "number" && c > 0)
    .sort(([, a], [, b]) => (b) - (a))
    .slice(0, 6)
    .map(([source, count]) => ({ source, count: count }));

  const totalItems =
    typeof args.sourceSummary?.totalItems === "number"
      ? args.sourceSummary.totalItems
      : args.feedItems.length;

  // Dedupe by URL first, keeping highest-scored item for each URL
  const urlMap = new Map<string, FeedItem>();
  for (const item of args.feedItems) {
    if (!item || typeof item.title !== "string") continue;
    const url = (item.url ?? "").trim();
    const existing = url ? urlMap.get(url) : undefined;
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) {
      urlMap.set(url || `no-url-${urlMap.size}`, item);
    }
  }
  const dedupedItems = Array.from(urlMap.values());

  const signalsSource = dedupedItems
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 3);

  const signals: Signal[] = signalsSource.map((item, idx) => {
    const headline = (item.title ?? `Signal ${idx + 1}`).slice(0, 120);
    return {
      id: `sig-${slugify(headline)}-${idx + 1}`,
      headline,
      synthesis:
        (item.summary && item.summary.trim().replace(/https?:\/\/\S+/g, "")) ||
        "This signal appears repeatedly across sources and warrants follow-up to understand second-order effects.",
      evidence: [toEvidence(item, idx, dateString)],
    };
  });

  const actionSeed = Array.isArray(args.features) ? args.features : [];
  const proposedActions: BriefAction[] = actionSeed.slice(0, 4).map((f: any, idx: number) => {
    const label = (f?.name ?? f?.id ?? `Action ${idx + 1}`).toString().slice(0, 80);
    const status =
      f?.status === "passing"
        ? "completed"
        : f?.status === "failing"
          ? "insufficient_data"
          : "proposed";
    const linked = signals[0]?.id ? [signals[0].id] : [];
    const content =
      status === "insufficient_data"
        ? "Not enough validated output is available yet. Rerun this deep dive with additional context."
        : "Investigate this item and summarize implications, risks, and suggested next actions in plain prose.";
    return {
      id: `act-${slugify(label)}-${idx + 1}`,
      label,
      status,
      content,
      linkedSignalIds: linked,
      priority: idx + 1,
    };
  });

  const vizData = topSources.length
    ? topSources.map((s) => ({ source: s.source, count: s.count }))
    : Object.entries(bySource).map(([source, count]) => ({ source, count }));

  const vizArtifact: VizArtifact = {
    intent: "category_compare",
    rationale: "Source volume provides a quick read on where attention is concentrated today.",
    data: vizData as Array<Record<string, unknown>>,
    spec: {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      width: "container",
      height: 160,
      mark: "bar",
      encoding: {
        y: { field: "source", type: "nominal", sort: "-x", axis: { title: null } },
        x: { field: "count", type: "quantitative", axis: { title: "Items" } },
        color: { field: "source", legend: null },
        tooltip: [
          { field: "source", type: "nominal" },
          { field: "count", type: "quantitative" },
        ],
      },
    },
  };

  const trendingTags: string[] = Array.isArray(args.sourceSummary?.topTrending)
    ? (args.sourceSummary.topTrending as string[])
    : [];

  return {
    meta: {
      date: dateString,
      headline: "The Morning Dossier — Executive Brief",
      summary:
        "Today’s intelligence brief distills the most salient signals into evidence-backed narratives and actionable follow-ups.",
      confidence: 55,
      version: args.version,
    },
    actI: {
      title: "Act I: Setup — Coverage & Freshness",
      synthesis: `Coverage spans ${totalItems} items across ${topSources.length || Object.keys(bySource).length || 0} sources. The mix indicates where attention and publishing velocity are concentrated right now.`,
      topSources,
      totalItems,
      sourcesCount: topSources.length || Object.keys(bySource).length || 0,
      latestItemAt: args.feedItems[0]?.publishedAt,
    },
    actII: {
      title: "Act II: Rising Action — Signals",
      synthesis:
        "The feed clusters around a handful of high-signal stories. The signals below are selected for breadth of impact and evidence strength, not just raw engagement.",
      signals,
    },
    actIII: {
      title: "Act III: Deep Dives — Actions",
      synthesis:
        "The follow-ups below convert today’s signals into concrete investigations. Prioritize the items with highest leverage on near-term decisions.",
      actions: proposedActions.length
        ? proposedActions
        : [
            {
              id: "act-generate-followups",
              label: "Generate follow-ups",
              status: "proposed",
              content:
                "Create a short list of deep dives tied to the strongest signals, then execute the top one to produce an executive-ready artifact.",
              linkedSignalIds: signals[0]?.id ? [signals[0].id] : [],
              priority: 1,
            },
          ],
    },
    dashboard: {
      vizArtifact,
      sourceBreakdown: bySource,
      trendingTags,
    },
  };
}

async function callOpenAIStructured(
  args: {
    model: string;
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.CONVEX_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const openai = new OpenAI({ apiKey });

  const messages = [
    { role: "system" as const, content: args.system },
    { role: "user" as const, content: args.user },
  ];

  const temperature = args.temperature ?? 0.2;
  const maxTokens = args.maxTokens ?? 2200;

  const create = async (response_format: any, tokenParam: "max_completion_tokens" | "max_tokens") => {
    const payload: any = {
      model: args.model,
      messages,
      response_format,
      temperature,
    };
    payload[tokenParam] = maxTokens;
    return await openai.chat.completions.create(payload);
  };

  // Primary attempt: json_schema (best when supported and non-flaky).
  const runWithTokenFallback = async (response_format: any) => {
    try {
      // Some OpenAI models (e.g., GPT-5.x) require max_completion_tokens.
      return await create(response_format, "max_completion_tokens");
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/Unsupported parameter: 'max_completion_tokens'/.test(msg)) {
        return await create(response_format, "max_tokens");
      }
      if (/Unsupported parameter: 'max_tokens'/.test(msg)) {
        return await create(response_format, "max_completion_tokens");
      }
      throw e;
    }
  };

  const completion = await runWithTokenFallback({ type: "json_schema", json_schema: DailyBriefJSONSchema as any });

  const content = completion.choices[0]?.message?.content ?? "";
  if (typeof content === "string" && content.trim().length > 0) return content;

  // Fallback: json_object is more broadly supported and avoids empty payloads on some models.
  const fallback = await runWithTokenFallback({ type: "json_object" });

  return fallback.choices[0]?.message?.content ?? "";
}

function validateEvidenceUrlsAgainstFeed(
  brief: DailyBriefPayload,
  allowedUrls: Set<string>,
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  brief.actII?.signals?.forEach((signal, sIdx) => {
    signal?.evidence?.forEach((ev, eIdx) => {
      const url = typeof ev?.url === "string" ? ev.url.trim() : "";
      if (!url) {
        errors.push(`actII.signals[${sIdx}].evidence[${eIdx}].url: Missing`);
        return;
      }
      if (!allowedUrls.has(url)) {
        errors.push(
          `actII.signals[${sIdx}].evidence[${eIdx}].url: Not present in feed context (must reference provided feed items)`,
        );
      }
      if (seen.has(url)) {
        errors.push(
          `actII.signals[${sIdx}].evidence[${eIdx}].url: Duplicate evidence URL (dedupe across signals)`,
        );
      }
      seen.add(url);
    });
  });

  return errors;
}

function canonicalizeEvidenceFromLibrary(
  brief: DailyBriefPayload,
  evidenceLibrary: Evidence[],
): DailyBriefPayload {
  const byUrl = new Map<string, Evidence>();
  for (const ev of evidenceLibrary) {
    const url = typeof ev.url === "string" ? ev.url.trim() : "";
    if (!url) continue;
    byUrl.set(url, ev);
  }

  const signals = Array.isArray(brief.actII?.signals) ? brief.actII.signals : [];
  const nextSignals = signals.map((signal) => {
    const evs = Array.isArray(signal.evidence) ? signal.evidence : [];
    const canonicalEvidence = evs
      .map((ev) => {
        const url = typeof ev?.url === "string" ? ev.url.trim() : "";
        const lib = url ? byUrl.get(url) : undefined;
        const canonicalId = lib?.id ?? (url ? evidenceIdForUrl(url) : ev?.id);
        return {
          ...ev,
          id: canonicalId,
          source: lib?.source ?? ev.source,
          title: lib?.title ?? ev.title,
          publishedAt: lib?.publishedAt ?? ev.publishedAt,
          score: lib?.score ?? ev.score,
          sourceDomain: (lib as any)?.sourceDomain ?? (ev as any)?.sourceDomain ?? safeSourceDomain(url),
          rank: (lib as any)?.rank ?? (ev as any)?.rank,
          runId: (lib as any)?.runId ?? (ev as any)?.runId,
        } as any;
      })
      .filter((ev) => typeof ev.url === "string" && ev.url.trim());

    // De-dupe within the signal by evidence ID.
    const seen = new Set<string>();
    const deduped = canonicalEvidence.filter((ev) => {
      const id = typeof ev.id === "string" ? ev.id : "";
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    return { ...signal, evidence: deduped };
  });

  return {
    ...brief,
    meta: {
      ...(brief.meta as any),
      hasEvidence: evidenceLibrary.length > 0,
    },
    actII: { ...brief.actII, signals: nextSignals },
  };
}

export const generateExecutiveBriefForMemoryInternal = internalAction({
  args: {
    memoryId: v.id("dailyBriefMemories"),
    forceRefresh: v.optional(v.boolean()),
    model: v.optional(v.string()),
    didYouKnowUrls: v.optional(v.array(v.string())),
    didYouKnowTonePreset: v.optional(
      v.union(v.literal("homer_bot_clone"), v.literal("casual_concise"), v.literal("professional"))
    ),
  },
  handler: async (ctx, args): Promise<any> => {
    const memory: any = await ctx.runQuery(
      internal.domains.research.dailyBriefMemoryQueries.getMemoryByIdInternal,
      { memoryId: args.memoryId },
    );
    if (!memory) throw new Error("Daily brief memory not found");

    const existing = (memory.context)?.executiveBrief as DailyBriefPayload | undefined;
    if (!args.forceRefresh && existing?.meta?.date === memory.dateString) {
      const sanitizedExisting = stripReservedKeys(existing) as DailyBriefPayload;
      return { ok: true, cached: true, brief: sanitizedExisting };
    }

    const dayStart = `${memory.dateString}T00:00:00.000Z`;
    const dayEnd = `${memory.dateString}T23:59:59.999Z`;

    let feedItems: FeedItem[] = await ctx.runQuery(api.feed.getRecent, {
      limit: 80,
      from: dayStart,
      to: dayEnd,
    });

    if (feedItems.length < 12) {
      const fromMs = new Date(dayStart).getTime() - 3 * 24 * 60 * 60 * 1000;
      const from = new Date(fromMs).toISOString();
      feedItems = await ctx.runQuery(api.feed.getRecent, {
        limit: 120,
        from,
        to: dayEnd,
      });
    }

    const retrievalRunId = `feed-${safeDateString(memory.dateString)}-${randomUUID().slice(0, 8)}`;
    const evidenceLibrary = buildEvidenceLibrary({
      dateString: memory.dateString,
      runId: retrievalRunId,
      feedItems,
      topK: 40,
    });
    const datasetHash = sha256Hex(evidenceLibrary.map((e) => e.url).join("\n")).slice(0, 16);

    const retrievalRun: RetrievalRun = {
      runId: retrievalRunId,
      tool: "feed.getRecent",
      query: JSON.stringify({ from: dayStart, to: dayEnd, limit: 80 }),
      executedAt: new Date().toISOString(),
      topK: evidenceLibrary.length,
      datasetHash,
    };

    const taskResults: any[] = await ctx.runQuery(
      api.domains.research.dailyBriefMemoryQueries.listTaskResultsByMemory,
      { memoryId: memory._id },
    );
    const resultsByTaskId = new Map<string, any>();
    taskResults.forEach((r) => {
      if (r?.taskId && !resultsByTaskId.has(r.taskId)) resultsByTaskId.set(r.taskId, r);
    });

    const features: any[] = Array.isArray(memory.features) ? memory.features : [];
    const featuresWithResults = features.map((f) => {
      const result = f?.id ? resultsByTaskId.get(f.id) : null;
      const resultMarkdown =
        typeof result?.resultMarkdown === "string" ? result.resultMarkdown.trim() : "";
      return {
        id: f?.id,
        type: f?.type,
        name: f?.name,
        status: f?.status,
        priority: f?.priority,
        testCriteria: f?.testCriteria,
        notes: f?.notes,
        sourceRefs: f?.sourceRefs,
        resultMarkdown,
      };
    });

    const sourceSummary = (memory.context)?.snapshotSummary ?? null;
    const dashboardMetrics = (memory.context)?.dashboardMetrics ?? null;

    const context = {
      date: memory.dateString,
      version: memory.version,
      sourceSummary,
      dashboardMetrics,
      feedItems: feedItems
        .slice(0, 30)
        .map((i) => ({
          sourceId: i.sourceId,
          source: i.source,
          type: i.type,
          category: i.category,
          title: i.title,
          summary: i.summary,
          url: i.url,
          score: i.score,
          publishedAt: i.publishedAt,
          tags: i.tags,
          metrics: i.metrics,
        })),
      tasks: featuresWithResults.slice(0, 20),
      evidenceLibrary: evidenceLibrary.slice(0, 30).map((e: any) => ({
        evidenceId: e.id,
        title: e.title,
        url: e.url,
        source: e.source,
        publishedAt: e.publishedAt,
        score: e.score,
      })),
    };

    const allowedEvidenceUrls = new Set<string>(evidenceLibrary.map((e) => e.url.trim()).filter(Boolean));

    const system = [BRIEF_SYSTEM_PROMPT, BRIEF_OUTPUT_CONSTRAINTS, BRIEF_EXAMPLE_PROMPT].join("\n\n");
    const model = args.model ?? getLlmModel("analysis", "openai");

    const baseUser = [
      `Generate an executive Daily Brief for ${memory.dateString}.`,
      "",
      "Use ONLY the provided feed items as evidence. Do not invent URLs or sources.",
      "Prefer using the provided evidenceLibrary evidenceId values as evidence.id when possible.",
      "All synthesis fields must be editorial prose (no bullets, no log lines, no timestamps, no URLs).",
      "Act II signals must each include 1-5 evidence objects from the feed items (evidence.url must match).",
      "Act III actions must NEVER include failure strings; use status=\"insufficient_data\" with an explanation instead.",
      "",
      "HARD OUTPUT LIMITS (do not exceed):",
      "- actI.topSources: max 6",
      "- actII.signals: max 6",
      "- actII.signals[].evidence: max 5",
      "- actIII.actions: max 6",
      "",
      "CONTEXT JSON:",
      JSON.stringify(context, null, 2),
    ].join("\n");

    let json = "";
    let parsed: DailyBriefPayload | null = null;
    let validation: any = null;

    try {
      json = await callOpenAIStructured({
        model,
        system,
        user: baseUser,
        maxTokens: 4200,
        temperature: 0.2,
      });
      const first = parseAndValidateBrief(json);
      parsed = first.payload;
      validation = first.validation;

      if (parsed) {
        parsed = canonicalizeEvidenceFromLibrary(parsed, evidenceLibrary);
        const evidenceUrlErrors = validateEvidenceUrlsAgainstFeed(parsed, allowedEvidenceUrls);
        if (evidenceUrlErrors.length > 0) {
          parsed = null;
          validation = {
            valid: false,
            errors: [...(first.validation?.errors ?? []), ...evidenceUrlErrors],
            warnings: first.validation?.warnings ?? [],
          };
        }
      }

      if (!parsed) {
        const retryPrompt = [
          buildRetryPrompt(validation ?? first.validation),
          "",
          "Rewrite ONLY the synthesis fields and action contents. Keep evidence objects and IDs unchanged unless required by schema.",
          "If your previous output was truncated, output a complete JSON object within the HARD OUTPUT LIMITS.",
          "",
          "PREVIOUS JSON:",
          json,
          "",
          "CONTEXT JSON:",
          JSON.stringify(context, null, 2),
        ].join("\n");

        json = await callOpenAIStructured({
          model,
          system,
          user: retryPrompt,
          maxTokens: 4200,
          temperature: 0.15,
        });
        const second = parseAndValidateBrief(json);
      parsed = second.payload;
      validation = second.validation;

      if (parsed) {
        parsed = canonicalizeEvidenceFromLibrary(parsed, evidenceLibrary);
        const evidenceUrlErrors = validateEvidenceUrlsAgainstFeed(parsed, allowedEvidenceUrls);
        if (evidenceUrlErrors.length > 0) {
          parsed = null;
          validation = {
            valid: false,
              errors: [...(second.validation?.errors ?? []), ...evidenceUrlErrors],
              warnings: second.validation?.warnings ?? [],
            };
          }
        }
      }

      // Final fallback: if OpenAI output is empty/truncated/non-JSON, regenerate via OpenRouter fallback chain.
      // This prevents persistent "Unexpected end of JSON input" failures from blocking production briefs.
      if (!parsed && typeof validation?.errors?.[0] === "string" && /JSON parse error:/i.test(validation.errors[0])) {
        const fallbackResponse = await ctx.runAction(
          internal.domains.models.autonomousModelResolver.executeWithFallback,
          {
            taskType: "analysis",
            messages: [
              {
                role: "system",
                content:
                  system +
                  "\n\nYou MUST output valid JSON only. Do not use markdown fences. Follow the HARD OUTPUT LIMITS.",
              },
              { role: "user", content: baseUser },
            ],
            maxTokens: 4200,
            temperature: 0.15,
          }
        );

        json = fallbackResponse.content ?? "";
        const third = parseAndValidateBrief(json);
        parsed = third.payload;
        validation = third.validation;

        if (parsed) {
          parsed = canonicalizeEvidenceFromLibrary(parsed, evidenceLibrary);
          const evidenceUrlErrors = validateEvidenceUrlsAgainstFeed(parsed, allowedEvidenceUrls);
          if (evidenceUrlErrors.length > 0) {
            parsed = null;
            validation = {
              valid: false,
              errors: [...(third.validation?.errors ?? []), ...evidenceUrlErrors],
              warnings: third.validation?.warnings ?? [],
            };
          }
        }
      }
    } catch (err: any) {
      console.warn("[executiveBrief] generation failed", err?.message || err);
      validation = { valid: false, errors: [String(err?.message || err)], warnings: [] };
    }

    if (!parsed) {
      parsed = buildDeterministicBrief({
        dateString: memory.dateString,
        version: memory.version,
        sourceSummary: sourceSummary ?? (memory.context)?.snapshotSummary,
        feedItems,
        features,
      });
      parsed = canonicalizeEvidenceFromLibrary(parsed, evidenceLibrary);
    }

    // Optional: generate a "Did you know" update from the freshest evidence URLs.
    // This is post-processing and does not affect the core Structured Output validity.
    try {
      const overrideUrls = Array.isArray(args.didYouKnowUrls)
        ? args.didYouKnowUrls.filter((u) => typeof u === "string").map((u) => u.trim()).filter(Boolean)
        : [];

      const pickedUrls = (overrideUrls.length > 0
        ? [...new Set(overrideUrls)]
        : [...new Set(
            (evidenceLibrary as any[])
              .map((e) => (e && typeof e.url === "string" ? e.url.trim() : ""))
              .filter((u: string) => u.length > 0)
          )]
      ).slice(0, 2);

      if (pickedUrls.length > 0) {
        const dykWorkflowId = `dailybrief_dyk_${memory.dateString}_${String(memory._id)}_${overrideUrls.length > 0 ? "override" : "auto"}`;
        const didYouKnowRun = await ctx.runAction(
          internal.domains.narrative.didYouKnow.generateAndJudgeDidYouKnowFromUrls,
          {
            workflowId: dykWorkflowId,
            urls: pickedUrls,
            tonePreset: args.didYouKnowTonePreset ?? "homer_bot_clone",
            preferLinkup: true,
          }
        );

        if (didYouKnowRun.judge?.passed) {
          (parsed as any).didYouKnow = {
            messageText: didYouKnowRun.output.messageText,
            artifactId: String(didYouKnowRun.didYouKnowArtifactId),
            passed: true,
            sourcesUsed: didYouKnowRun.output.sourcesUsed,
            checks: didYouKnowRun.judge.checks,
            llmJudge: didYouKnowRun.judge.llmJudge,
            judgeExplanation: didYouKnowRun.judge.explanation,
            judgeReasons: didYouKnowRun.judge.reasons,
          };
        }
      }
    } catch (e) {
      console.warn("[executiveBrief] didYouKnow generation failed (non-fatal)", e);
    }

    const generatedAt = Date.now();
    const status: ExecutiveBriefRecord["status"] =
      validation?.valid && evidenceLibrary.length > 0 ? "valid" : "invalid";

    const record: ExecutiveBriefRecord = {
      status,
      brief: parsed,
      evidence: evidenceLibrary,
      provenance: { retrievalRuns: [retrievalRun] },
      errors: status === "valid" ? [] : (validation?.errors ?? ["Missing evidence/provenance"]),
    };

    const sanitizedBrief = stripReservedKeys(parsed) as DailyBriefPayload;
    const sanitizedRecord = stripReservedKeys(record) as ExecutiveBriefRecord;
    const sanitizedValidation = stripReservedKeys(validation) as typeof validation;

    await ctx.runMutation(
      internal.domains.research.dailyBriefMemoryMutations.setExecutiveBrief,
      {
        memoryId: memory._id,
        payload: sanitizedBrief,
        generatedAt,
        validation: sanitizedValidation,
        record: sanitizedRecord,
      },
    );

    await ctx.runAction(internal.domains.product.home.refreshDailyPulsePreview, {});

    return {
      ok: true,
      cached: false,
      brief: sanitizedBrief,
      validation: sanitizedValidation,
      record: sanitizedRecord,
    };
  },
});

// Optional public wrapper: requires auth to avoid anonymous LLM spend.
export const generateExecutiveBriefForMemory = action({
  args: {
    memoryId: v.id("dailyBriefMemories"),
    forceRefresh: v.optional(v.boolean()),
    model: v.optional(v.string()),
    didYouKnowUrls: v.optional(v.array(v.string())),
    didYouKnowTonePreset: v.optional(
      v.union(v.literal("homer_bot_clone"), v.literal("casual_concise"), v.literal("professional"))
    ),
  },
  handler: async (ctx, args): Promise<any> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return await ctx.runAction(
      internal.domains.research.executiveBrief.generateExecutiveBriefForMemoryInternal,
      args,
    );
  },
});
