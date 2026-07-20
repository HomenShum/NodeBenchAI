/**
 * Source Health Check Tool
 * 
 * Monitors URL availability and content changes.
 * Based on ARBITRAGE_AGENT_IMPLEMENTATION_PLAN.md
 */

import { z } from "zod";
import type { ActionCtx } from "../../../../_generated/server";

// Output types
export interface SourceHealthStatus {
  url: string;
  status: "ok" | "404" | "content_changed" | "error";
  lastChecked: number;
  contentHash?: string;
  previousHash?: string;
  hashChanged: boolean;
  errorMessage?: string;
}

export interface SourceHealthResult {
  results: SourceHealthStatus[];
  healthy: number;
  issues: number;
  alerts: string[];
  summary: string;
}

/**
 * Simple hash function for content comparison
 * Uses first 1000 chars to avoid large content issues
 */
function simpleHash(content: string): string {
  const sample = content.slice(0, 1000);
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    const char = sample.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Check health of a single URL
 */
async function checkUrl(
  url: string,
  previousHash?: string
): Promise<SourceHealthStatus> {
  const now = Date.now();
  
  try {
    // First try HEAD request for quick status check
    const headResponse = await fetch(url, { 
      method: "HEAD",
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!headResponse.ok) {
      if (headResponse.status === 404) {
        return {
          url,
          status: "404",
          lastChecked: now,
          hashChanged: false,
          errorMessage: "Source not found (404)",
        };
      }
      return {
        url,
        status: "error",
        lastChecked: now,
        hashChanged: false,
        errorMessage: `HTTP ${headResponse.status}`,
      };
    }

    // If we have a previous hash, fetch content and compare
    if (previousHash) {
      const getResponse = await fetch(url, {
        signal: AbortSignal.timeout(15000),
      });
      const content = await getResponse.text();
      const currentHash = simpleHash(content);

      if (currentHash !== previousHash) {
        return {
          url,
          status: "content_changed",
          lastChecked: now,
          contentHash: currentHash,
          previousHash,
          hashChanged: true,
        };
      }

      return {
        url,
        status: "ok",
        lastChecked: now,
        contentHash: currentHash,
        previousHash,
        hashChanged: false,
      };
    }

    // No previous hash - just fetch and store current
    const getResponse = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });
    const content = await getResponse.text();
    const currentHash = simpleHash(content);

    return {
      url,
      status: "ok",
      lastChecked: now,
      contentHash: currentHash,
      hashChanged: false,
    };
  } catch (error: any) {
    return {
      url,
      status: "error",
      lastChecked: now,
      hashChanged: false,
      errorMessage: error.message || "Unknown error",
    };
  }
}

/**
 * Check health of multiple sources
 */
export async function executeSourceHealthCheck(
  ctx: ActionCtx,
  args: {
    urls: string[];
    previousHashes?: Record<string, string>;
  }
): Promise<SourceHealthResult> {
  console.log(`[sourceHealthCheck] Checking ${args.urls.length} URLs`);

  if (args.urls.length === 0) {
    return {
      results: [],
      healthy: 0,
      issues: 0,
      alerts: [],
      summary: "No URLs to check.",
    };
  }

  const results: SourceHealthStatus[] = [];
  const alerts: string[] = [];

  // Check URLs in parallel (with concurrency limit)
  const CONCURRENCY = 5;
  for (let i = 0; i < args.urls.length; i += CONCURRENCY) {
    const batch = args.urls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(url => checkUrl(url, args.previousHashes?.[url]))
    );
    results.push(...batchResults);
  }

  // Generate alerts for issues
  for (const result of results) {
    if (result.status === "404") {
      alerts.push(`🚨 SOURCE UNAVAILABLE: ${result.url}`);
    } else if (result.status === "content_changed") {
      alerts.push(`⚠️ CONTENT CHANGED: ${result.url}`);
    } else if (result.status === "error") {
      alerts.push(`❌ ERROR checking: ${result.url} - ${result.errorMessage}`);
    }
  }

  const healthy = results.filter(r => r.status === "ok").length;
  const issues = results.length - healthy;

  const summary = issues === 0
    ? `All ${healthy} sources healthy.`
    : `${issues} issue(s) detected out of ${results.length} sources. ${alerts.length} alert(s) generated.`;

  console.log(`[sourceHealthCheck] ${summary}`);

  return {
    results,
    healthy,
    issues,
    alerts,
    summary,
  };
}

// Tool definition for AI SDK
export const sourceHealthCheckToolDefinition = {
  description: `Check health and content integrity of source URLs.
Detects:
- 404 errors (source no longer available)
- Content changes (hash mismatch from original)
- Connection errors

Use for maintaining citation integrity. Run periodically (e.g., weekly) to detect stale sources.
Returns alerts for any issues found.`,
  inputSchema: z.object({
    urls: z.array(z.string()).describe("URLs to check"),
    previousHashes: z.record(z.string()).optional().describe("Previous content hashes by URL"),
  }),
};
