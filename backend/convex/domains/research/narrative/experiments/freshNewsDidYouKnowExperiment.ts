"use node";

import { v } from "convex/values";
import { internalAction } from "../../../../_generated/server";
import type { ActionCtx } from "../../../../_generated/server";
import { api, internal } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";
import { makeWebSourceCitationId } from "../../../../../shared/citations/webSourceCitations";
import { getCurrentWeekNumber } from "../newsroom/state";

type FetchedSource = {
  url: string;
  title: string;
  description: string;
  publishedAtIso?: string;
  excerpt: string;
  artifactId?: Id<"sourceArtifacts">;
  citationId: string;
};

function stripTagsToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMeta(html: string, attr: "name" | "property", key: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+${attr}=[\"']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>`,
    "i"
  );
  const m = re.exec(html);
  return m?.[1]?.trim() || undefined;
}

function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return m?.[1]?.trim() || undefined;
}

function tryParsePublishedIso(html: string): string | undefined {
  const candidates: Array<string | undefined> = [
    extractMeta(html, "property", "article:published_time"),
    extractMeta(html, "property", "og:published_time"),
    extractMeta(html, "name", "pubdate"),
    extractMeta(html, "name", "publish-date"),
    extractMeta(html, "name", "date"),
    extractMeta(html, "name", "DC.date.issued"),
  ];

  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }

  const timeTag = /<time[^>]+datetime=[\"']([^\"']+)[\"'][^>]*>/i.exec(html)?.[1];
  if (timeTag) {
    const t = Date.parse(timeTag);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }

  return undefined;
}

async function fetchSource(
  ctx: ActionCtx,
  url: string,
  opts: { workflowId?: string; forceLinkup?: boolean }
): Promise<FetchedSource> {
  const citationId = makeWebSourceCitationId(url);

  const useLinkup = !!process.env.LINKUP_API_KEY && opts.forceLinkup;
  let htmlOrMarkdown = "";
  let contentType = "text/html; charset=utf-8";
  let fetchedAt = Date.now();

  if (useLinkup) {
    const markdown = await ctx.runAction(api.tools.media.linkupFetch.linkupFetch, {
      url,
      renderJs: true,
      includeRawHtml: false,
      extractImages: false,
      forceRefresh: true,
    });
    htmlOrMarkdown = String(markdown || "");
    contentType = "text/markdown; charset=utf-8";
    fetchedAt = Date.now();
  } else {
    const resp = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "nodebench-ai/1.0 (freshNewsDidYouKnowExperiment; +https://nodebench.ai)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    fetchedAt = Date.now();
    if (!resp.ok) {
      throw new Error(`Fetch failed: ${resp.status} ${resp.statusText}`);
    }
    contentType = resp.headers.get("content-type") || contentType;
    htmlOrMarkdown = await resp.text();
  }

  const raw = htmlOrMarkdown.slice(0, 120_000);
  const isHtml = contentType.includes("html");

  const title =
    (isHtml ? extractMeta(raw, "property", "og:title") : undefined) ||
    (isHtml ? extractTitle(raw) : undefined) ||
    url;

  const description =
    (isHtml ? extractMeta(raw, "name", "description") : undefined) ||
    (isHtml ? extractMeta(raw, "property", "og:description") : undefined) ||
    "";

  const publishedAtIso = isHtml ? tryParsePublishedIso(raw) : undefined;

  const visibleText = isHtml ? stripTagsToText(raw) : raw;
  const excerpt = [
    description,
    visibleText.slice(0, 2500),
  ]
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .join("\n\n")
    .trim()
    .slice(0, 3000);

  const artifact = await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
    sourceType: "url_fetch",
    sourceUrl: url,
    title,
    rawContent: excerpt,
    mimeType: "text/plain; charset=utf-8",
    sizeBytes: excerpt.length,
    extractedData: {
      kind: "fresh_news_experiment_fetch",
      workflowId: opts.workflowId,
      citationId,
      contentType,
      publishedAtIso,
    },
    fetchedAt,
  });

  return {
    url,
    title,
    description,
    publishedAtIso,
    excerpt,
    artifactId: artifact.id,
    citationId,
  };
}

async function getAnyUserId(ctx: ActionCtx): Promise<Id<"users">> {
  const users = await ctx.runQuery(api.domains.auth.users.list, { limit: 1 });
  const first = Array.isArray(users) ? users[0] : null;
  if (!first?._id) {
    throw new Error("No users found in DB. Create at least one user to run experiments.");
  }
  return first._id as Id<"users">;
}

export const runFreshNewsDidYouKnowExperiment = internalAction({
  args: {
    urls: v.array(v.string()),
    weekNumber: v.optional(v.string()),
    entityKeys: v.optional(v.array(v.string())),
    focusTopics: v.optional(v.array(v.string())),
    workflowId: v.optional(v.string()),
    tonePreset: v.optional(
      v.union(
        v.literal("homer_bot_clone"),
        v.literal("casual_concise"),
        v.literal("professional")
      )
    ),
    useLinkup: v.optional(v.boolean()),
    validate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const weekNumber = args.weekNumber ?? getCurrentWeekNumber();

    const workflowId =
      args.workflowId ||
      `fresh_dyk_${weekNumber}_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const userId = await getAnyUserId(ctx);

    const inputUrls: string[] = Array.isArray(args.urls)
      ? (args.urls as unknown[]).filter((u): u is string => typeof u === "string")
      : [];

    const urls: string[] = [...new Set(inputUrls.map((u) => u.trim()).filter((u) => u.length > 0))].slice(0, 10);
    if (urls.length === 0) throw new Error("No URLs provided.");

    const fetched: FetchedSource[] = [];
    for (const url of urls) {
      fetched.push(
        await fetchSource(ctx, url, { workflowId, forceLinkup: !!args.useLinkup })
      );
    }

    const injectedNewsItems = fetched.map((s) => ({
      headline: s.title,
      url: s.url,
      publishedAt: (s.publishedAtIso ?? new Date().toISOString()),
      snippet: s.excerpt,
      source: new URL(s.url).hostname.replace(/^www\./, ""),
      relevanceScore: 0.95,
    }));

    const entityKeys =
      args.entityKeys && args.entityKeys.length > 0
        ? args.entityKeys
        : ["topic:ai_models", "company:google", "company:kimi"];

    const pipelineResult = await ctx.runAction(
      internal.domains.narrative.newsroom.workflow.runPipeline,
      {
        entityKeys,
        weekNumber,
        focusTopics: args.focusTopics ?? ["frontier_models", "agentic_tools", "model_releases"],
        userId,
        workflowId,
        config: {
          verbose: true,
          toolReplayMode: "live",
          scout: {
            injectedNewsItems,
            enableWebSources: false,
            enablePipelineIntegration: false,
          },
          analyst: {
            useHeuristicOnly: false,
          },
          publisher: {
            generateSummaries: true,
            deterministicMode: false,
          },
        },
      }
    );

    const didYouKnow = await ctx.runAction(internal.domains.narrative.didYouKnow.generateDidYouKnow, {
      workflowId,
      sources: fetched.map((s) => ({
        url: s.url,
        title: s.title,
        publishedAtIso: s.publishedAtIso,
        excerpt: s.excerpt,
      })),
      tonePreset: args.tonePreset ?? "homer_bot_clone",
      temperature: 0.85,
      maxTokens: 900,
    });

    const didYouKnowJudge = await ctx.runAction(internal.domains.narrative.didYouKnow.judgeDidYouKnow, {
      workflowId,
      didYouKnowArtifactId: didYouKnow.artifactId as any,
      output: didYouKnow.output as any,
    });

    const validation = args.validate
      ? await ctx.runAction(internal.domains.narrative.tests.qaFramework.validateWorkflowRun, {
          workflowId,
          includeLlmExplanation: true,
        } as any)
      : null;

    return {
      workflowId,
      weekNumber,
      entityKeys,
      sources: fetched.map((s) => ({
        url: s.url,
        title: s.title,
        publishedAtIso: s.publishedAtIso,
        citationId: s.citationId,
        artifactId: s.artifactId,
      })),
      pipeline: {
        success: pipelineResult.success,
        stats: pipelineResult.stats,
        errors: pipelineResult.errors,
        published: pipelineResult.published,
      },
      didYouKnow: {
        messageText: didYouKnow.output.messageText,
        facts: didYouKnow.output.facts,
        interpretations: didYouKnow.output.interpretations,
        predictions: didYouKnow.output.predictions,
        sourcesUsed: didYouKnow.output.sourcesUsed,
        modelUsed: didYouKnow.modelUsed,
        artifactId: didYouKnow.artifactId,
        parseError: (didYouKnow as any).parseError,
      },
      didYouKnowValidation: {
        passed: didYouKnowJudge.passed,
        checks: didYouKnowJudge.checks,
        llmJudge: didYouKnowJudge.llmJudge,
      },
      validation,
      validationBoolean: validation
        ? {
            passed: (validation as any).passed === true,
            checks: (validation as any).checks ?? null,
            snapshotOk: (validation as any)?.snapshot?.hasSnapshot === true,
          }
        : null,
      share: {
        plainText: didYouKnow.output.messageText,
        sources: fetched.map((s) => `${s.title} (${s.url}) [${s.citationId}]`),
      },
    };
  },
});
