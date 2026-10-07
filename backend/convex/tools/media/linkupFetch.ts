/**
 * Linkup /fetch Tool
 *
 * Fetches full article content from a URL using Linkup's /fetch endpoint.
 * Supports JavaScript rendering for dynamic pages.
 *
 * API Reference: https://api.linkup.so/v1/fetch
 */
"use node";

import { v } from "convex/values";
import { internalAction, action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { generateCacheKey, getTTL } from "../../globalResearch/cacheSimple";
import { createHash } from "crypto";

export interface LinkupFetchResult {
  url: string;
  content: string;
  title?: string;
  description?: string;
  author?: string;
  publishedDate?: string;
  siteName?: string;
  language?: string;
  images?: string[];
  rawHtml?: string;
}

/**
 * Content thinness indicators that suggest JS rendering is needed.
 */
const THIN_CONTENT_INDICATORS = [
  /sign.?in|log.?in|login/i,
  /subscribe.*to.*continue/i,
  /paywall|premium.*content/i,
  /loading|please.*wait/i,
  /enable.*javascript/i,
  /access.*denied/i,
  /captcha|verify.*human/i,
];

const MIN_CONTENT_WORD_COUNT = 200;

const STORE_TO_STORAGE_CHARS = 250_000;
const MAX_INLINE_RAW_CONTENT_CHARS = 120_000;

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function truncateForDb(input: string): string {
  if (input.length <= MAX_INLINE_RAW_CONTENT_CHARS) return input;
  return input.slice(0, MAX_INLINE_RAW_CONTENT_CHARS) + `\n\n<!-- TRUNCATED: ${input.length} chars -->\n`;
}

function isContentThin(content: string): boolean {
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_CONTENT_WORD_COUNT) return true;

  for (const pattern of THIN_CONTENT_INDICATORS) {
    if (pattern.test(content)) return true;
  }

  return false;
}

/**
 * Fetch full article content via Linkup /fetch API.
 * Exported as an agent tool.
 */
export const linkupFetch = action({
  args: {
    url: v.string(),
    renderJs: v.optional(v.boolean()),
    includeRawHtml: v.optional(v.boolean()),
    extractImages: v.optional(v.boolean()),
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<string> => {
    const apiKey = process.env.LINKUP_API_KEY;
    const startTime = Date.now();

    if (!apiKey) {
      throw new Error("LINKUP_API_KEY environment variable is not set.");
    }

    const fetchedAt = Date.now();

    // Check cache unless force refresh
    if (!args.forceRefresh) {
      const cacheKey = generateCacheKey("linkupFetch", args.url, {
        renderJs: args.renderJs,
      });

      try {
        const cached = await ctx.runQuery(internal.globalResearch.cacheSimple.getCache, {
          queryKey: cacheKey,
        });

        if (cached.hit) {
          console.log(`[linkupFetch] 🎯 Cache HIT for: "${args.url}" (age: ${Math.round(cached.ageMs / 1000)}s)`);
          try {
            const contentHash = sha256Hex(cached.response);

            let storageId: string | undefined;
            if (cached.response.length >= STORE_TO_STORAGE_CHARS) {
              const blob = new Blob([cached.response], { type: "text/markdown; charset=utf-8" });
              storageId = await ctx.storage.store(blob);
            }

            const artifactResult = await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
              sourceType: "url_fetch",
              sourceUrl: args.url,
              contentHash,
              rawContent: storageId ? truncateForDb(cached.response) : cached.response,
              rawStorageId: storageId as any,
              mimeType: "text/markdown; charset=utf-8",
              sizeBytes: cached.response.length,
              extractedData: {
                tool: "linkupFetch",
                cacheHit: true,
                cacheAgeMs: cached.ageMs,
                storageId,
                contentLength: cached.response.length,
              },
              fetchedAt,
            });

            const hasAnyChunk = await ctx.runQuery(internal.domains.artifacts.evidenceSearch.countChunksForArtifact, {
              artifactId: artifactResult.id,
            });
            if (hasAnyChunk === 0) {
              await ctx.scheduler.runAfter(0, internal.domains.artifacts.evidenceIndexActions.indexArtifact, {
                artifactId: artifactResult.id,
              });
            }
          } catch (artifactErr) {
            console.warn("[linkupFetch] Failed to persist sourceArtifact from cache hit", artifactErr);
          }
          return cached.response;
        }
      } catch (cacheError) {
        console.warn(`[linkupFetch] Cache check failed:`, cacheError);
      }
    }

    // Build request body
    const requestBody: Record<string, unknown> = {
      url: args.url,
      outputType: "markdown",
    };

    // First attempt without JS rendering unless explicitly requested
    let renderJs = args.renderJs ?? false;
    requestBody.renderJs = renderJs;

    console.log(`[linkupFetch] Fetching: "${args.url}"`, {
      renderJs,
      includeRawHtml: args.includeRawHtml,
    });

    try {
      let response = await fetch("https://api.linkup.so/v1/fetch", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[linkupFetch] API error (${response.status}):`, errorText);
        throw new Error(`Linkup API error: ${response.status} ${response.statusText}`);
      }

      let data: LinkupFetchResult = await response.json();

      // Auto-escalate to JS rendering if content is thin and we haven't already tried
      if (!renderJs && isContentThin(data.content || "")) {
        console.log(`[linkupFetch] 🔄 Content thin, escalating to JS rendering...`);

        requestBody.renderJs = true;
        renderJs = true;

        response = await fetch("https://api.linkup.so/v1/fetch", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (response.ok) {
          data = await response.json();
        }
      }

      // Format output
      let result = "";

      if (data.title) {
        result += `# ${data.title}\n\n`;
      }

      if (data.author || data.publishedDate || data.siteName) {
        const meta = [
          data.author && `By: ${data.author}`,
          data.publishedDate && `Published: ${data.publishedDate}`,
          data.siteName && `Source: ${data.siteName}`,
        ]
          .filter(Boolean)
          .join(" | ");

        result += `*${meta}*\n\n`;
      }

      if (data.description) {
        result += `> ${data.description}\n\n`;
      }

      result += data.content || "";

      // Add image data if requested and available
      if (args.extractImages && data.images && data.images.length > 0) {
        result += `\n\n<!-- IMAGE_DATA\n${JSON.stringify(data.images, null, 2)}\n-->\n`;
      }

      console.log(`[linkupFetch] ✅ Fetched successfully:`, {
        url: args.url,
        titleFound: !!data.title,
        contentLength: data.content?.length || 0,
        wordCount: (data.content || "").split(/\s+/).filter(Boolean).length,
        imagesFound: data.images?.length || 0,
        jsRendered: renderJs,
      });

      // Persist durable snapshot for citations / replayability.
      try {
        const contentHash = sha256Hex(result);

        let storageId: string | undefined;
        if (result.length >= STORE_TO_STORAGE_CHARS) {
          const blob = new Blob([result], { type: "text/markdown; charset=utf-8" });
          storageId = await ctx.storage.store(blob);
        }

        const artifactResult = await ctx.runMutation(internal.domains.artifacts.sourceArtifacts.upsertSourceArtifact, {
          sourceType: "url_fetch",
          sourceUrl: args.url,
          contentHash,
          rawContent: storageId ? truncateForDb(result) : result,
          rawStorageId: storageId as any,
          mimeType: "text/markdown; charset=utf-8",
          sizeBytes: result.length,
          title: data.title,
          extractedData: {
            tool: "linkupFetch",
            cacheHit: false,
            jsRendered: renderJs,
            title: data.title,
            description: data.description,
            author: data.author,
            publishedDate: data.publishedDate,
            siteName: data.siteName,
            language: data.language,
            images: data.images,
            includeRawHtml: args.includeRawHtml ?? false,
            storageId,
            contentLength: result.length,
          },
          fetchedAt,
        });

        const hasAnyChunk = await ctx.runQuery(internal.domains.artifacts.evidenceSearch.countChunksForArtifact, {
          artifactId: artifactResult.id,
        });
        if (hasAnyChunk === 0) {
          await ctx.scheduler.runAfter(0, internal.domains.artifacts.evidenceIndexActions.indexArtifact, {
            artifactId: artifactResult.id,
          });
        }
      } catch (artifactErr) {
        console.warn("[linkupFetch] Failed to persist sourceArtifact", artifactErr);
      }

      // Cache the result
      const cacheKey = generateCacheKey("linkupFetch", args.url, {
        renderJs,
      });
      const ttlMs = 4 * 60 * 60 * 1000; // 4 hours for dynamic content

      try {
        await ctx.runMutation(internal.globalResearch.cacheSimple.setCache, {
          queryKey: cacheKey,
          toolName: "linkupFetch",
          response: result,
          ttlMs,
        });
        console.log(`[linkupFetch] 💾 Cached result (TTL: ${Math.round(ttlMs / 1000 / 60)}min)`);
      } catch (cacheStoreError) {
        console.warn(`[linkupFetch] Failed to cache result:`, cacheStoreError);
      }

      // Track API usage
      const responseTime = Date.now() - startTime;
      ctx.scheduler.runAfter(0, "domains/billing/apiUsageTracking:trackApiUsage" as any, {
        apiName: "linkup",
        operation: "fetch",
        unitsUsed: 1,
        estimatedCost: renderJs ? 5 : 1, // JS rendering costs more
        requestMetadata: { url: args.url, renderJs },
        success: true,
        responseTime,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[linkupFetch] Error:", error);

      // Track failed API call
      const responseTime = Date.now() - startTime;
      try {
        ctx.scheduler.runAfter(0, "domains/billing/apiUsageTracking:trackApiUsage" as any, {
          apiName: "linkup",
          operation: "fetch",
          unitsUsed: 0,
          estimatedCost: 0,
          requestMetadata: { url: args.url },
          success: false,
          errorMessage: errorMsg,
          responseTime,
        });
      } catch (trackError) {
        console.error("[linkupFetch] Failed to track error:", trackError);
      }

      throw error;
    }
  },
});

/**
 * Fetch via Linkup but return a compact handle (artifactId + preview), not the full content.
 * Useful for progressive disclosure + evidence-based workflows.
 */
export const linkupFetchEvidence = action({
  args: {
    url: v.string(),
    renderJs: v.optional(v.boolean()),
    includeRawHtml: v.optional(v.boolean()),
    extractImages: v.optional(v.boolean()),
    forceRefresh: v.optional(v.boolean()),
    maxPreviewChars: v.optional(v.number()),
  },
  returns: v.object({
    url: v.string(),
    artifactId: v.optional(v.id("sourceArtifacts")),
    fetchedAt: v.optional(v.number()),
    contentHash: v.string(),
    contentLength: v.number(),
    title: v.optional(v.string()),
    preview: v.string(),
  }),
  handler: async (ctx, args) => {
    const content = await ctx.runAction(internal.tools.media.linkupFetch.linkupFetch, {
      url: args.url,
      renderJs: args.renderJs,
      includeRawHtml: args.includeRawHtml,
      extractImages: args.extractImages,
      forceRefresh: args.forceRefresh,
    });

    const contentHash = sha256Hex(content);
    const artifact = await ctx.runQuery(internal.domains.artifacts.sourceArtifacts.findByUrlAndHash, {
      sourceUrl: args.url,
      contentHash,
    });

    const maxPreviewChars = Math.max(200, Math.min(args.maxPreviewChars ?? 1500, 5000));
    const titleMatch = content.match(/^#\\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : undefined;

    return {
      url: args.url,
      artifactId: artifact?._id,
      fetchedAt: artifact?.fetchedAt,
      contentHash,
      contentLength: content.length,
      title,
      preview: content.slice(0, maxPreviewChars),
    };
  },
});

/**
 * Internal action for workpool-based batch fetching.
 */
export const linkupFetchInternal = internalAction({
  args: {
    url: v.string(),
    renderJs: v.optional(v.boolean()),
    feedItemId: v.optional(v.id("feedItems")),
    fundingEventId: v.optional(v.id("fundingEvents")),
  },
  handler: async (ctx, args) => {
    // Delegate to the public action to keep caching/telemetry/artifact persistence consistent.
    const result = await ctx.runAction(internal.tools.media.linkupFetch.linkupFetch, {
      url: args.url,
      renderJs: args.renderJs,
    });

    return {
      url: args.url,
      content: result,
      feedItemId: args.feedItemId,
      fundingEventId: args.fundingEventId,
    };
  },
});

/**
 * Batch fetch multiple URLs via workpool.
 */
export const batchFetch = internalAction({
  args: {
    urls: v.array(
      v.object({
        url: v.string(),
        feedItemId: v.optional(v.id("feedItems")),
        fundingEventId: v.optional(v.id("fundingEvents")),
        priority: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const results: Array<{
      url: string;
      success: boolean;
      error?: string;
      feedItemId?: string;
    }> = [];

    for (const item of args.urls) {
      try {
        await ctx.runAction(internal.tools.media.linkupFetch.linkupFetchInternal, {
          url: item.url,
          feedItemId: item.feedItemId,
          fundingEventId: item.fundingEventId,
        });
        results.push({ url: item.url, success: true, feedItemId: item.feedItemId?.toString() });
      } catch (error) {
        results.push({
          url: item.url,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          feedItemId: item.feedItemId?.toString(),
        });
      }
    }

    return {
      total: args.urls.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  },
});
