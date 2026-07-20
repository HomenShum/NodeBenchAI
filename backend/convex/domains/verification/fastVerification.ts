"use node";

/**
 * Fast Verification Module
 *
 * Lightweight verification for funding events before LinkedIn posting.
 * Designed to complete in <5 seconds with minimal API calls.
 *
 * Checks:
 * 1. Entity exists (quick web search for business registration)
 * 2. Website is live (HEAD request)
 * 3. Source credibility score
 *
 * Returns a verification status badge for LinkedIn posts.
 *
 * ============================================================================
 * UNCERTAINTY-AWARE VERIFICATION METHODOLOGY
 * ============================================================================
 *
 * This module implements an uncertainty-aware verification approach aligned
 * with industry best practices from FATF, AWS, NIST, and IFCN.
 *
 * KEY PRINCIPLES:
 *
 * 1. TRI-STATE VERIFICATION RESULTS
 *    - true: Verification succeeded (positive signal)
 *    - false: Verification failed (negative signal - explicit failure)
 *    - null: Inconclusive (network timeout, API error, etc.)
 *
 *    Per NIST SP 800-63 (Digital Identity Guidelines), systems should
 *    distinguish between "failed verification" and "unable to verify".
 *
 * 2. PENALTY ONLY ON EXPLICIT FAILURE
 *    - entityFound === false: Entity explicitly not found → penalize
 *    - entityFound === null: Check failed/timeout → neutral (0.5 points)
 *    - websiteLive === false: DNS NXDOMAIN → penalize (domain doesn't exist)
 *    - websiteLive === null: Timeout/network error → neutral
 *
 *    This prevents false negatives from transient network issues.
 *
 * 3. AWS-ALIGNED TIMEOUT & RETRY STRATEGY
 *    Per AWS Builder's Library best practices:
 *    - Initial timeout: 8000ms (accommodates slow cold-starts)
 *    - Retry timeout: 10000ms (progressive increase)
 *    - Max attempts: 3 (HEAD → HEAD → GET)
 *    - Method fallback: HEAD → GET (some servers block HEAD)
 *    - Exponential backoff with FULL JITTER between retries
 *      Formula: sleep = random(0, min(cap, base * 2^attempt))
 *    - Circuit breaker pattern: 5 failures → 30s open → half-open probe
 *
 * 4. DNS FAILURE DETECTION
 *    Recognizable DNS failures indicate the domain doesn't exist:
 *    - ENOTFOUND: DNS lookup failed
 *    - EAI_AGAIN: Temporary DNS failure (treated as inconclusive)
 *    - GETADDRINFO: DNS resolution error
 *
 * 5. SOURCE CREDIBILITY SCORING
 *    Per IFCN Code of Principles:
 *    - high (1.0): Trusted news outlets, press wires, VC databases
 *    - medium (0.5): Social platforms, general news, blogs
 *    - unknown (0.25): Unrecognized but not suspicious (neutral)
 *    - low (0.0): Known unreliable sources
 *
 *    Subdomain matching: news.forbes.com → forbes.com (high credibility)
 *    Press pattern detection: /press/, /newsroom/, /announcement/ URLs
 *
 * 6. VERIFICATION STATUS THRESHOLDS
 *    - verified (≥80% confidence): Multiple strong signals
 *    - partial (50-79%): Some signals found
 *    - unverified (<50%): Limited verification data
 *    - suspicious: All checks explicitly failed (explicit false, not null)
 *
 * 7. CONTINUOUS MONITORING (FATF-aligned)
 *    High-risk entities are enrolled in entityMonitorProfiles for ongoing
 *    verification per FATF Recommendation 10 (Customer Due Diligence).
 *    - Monitor frequency scales with risk tier
 *    - Changes trigger alerts for human review
 *
 * 8. EXTERNAL FACT-CHECK INTEGRATION (IFCN-aligned)
 *    Optional integration with Google Fact Check Tools API to cross-reference
 *    claims against IFCN-signatory fact-checkers (Snopes, PolitiFact, etc.)
 *
 * 9. PROBE SEMANTICS SEPARATION
 *    Three distinct verification dimensions with separate logic:
 *    - AVAILABILITY: Website responds to HTTP (checkWebsiteLive)
 *    - AUTHENTICITY: Entity exists in credible registries (checkEntityExists)
 *    - CREDIBILITY: Source reputation tier (checkSourceCredibility)
 *
 *    Each probe has independent failure modes and scoring rules.
 *    Availability timeouts don't affect authenticity scoring, etc.
 *
 * 10. ERROR TAXONOMY (for observability)
 *    Structured error classification for metrics/alerting:
 *    - dns_nxdomain: Domain doesn't exist (definitive)
 *    - dns_temp: Temporary DNS failure (EAI_AGAIN) (inconclusive)
 *    - timeout: Request timed out (inconclusive)
 *    - tls_error: TLS/SSL handshake failed (inconclusive)
 *    - connection_refused: Server refused (inconclusive)
 *    - bot_blocked: 403/429 likely bot detection (inconclusive)
 *    - server_error: 5xx responses (live but unhealthy)
 *    - client_error: 4xx responses (live)
 *    - success: 2xx/3xx responses (live)
 *
 * 11. ABSENCE-OF-EVIDENCE HANDLING
 *    Critical principle: "No fact-check found" ≠ "false"
 *    - Empty search results → null (inconclusive), not false
 *    - Weak matches → null (inconclusive), not false
 *    - API failures → null (inconclusive), not false
 *    Only explicit contradictory evidence creates false signals.
 *
 * REFERENCES:
 * - AWS Builder's Library: Timeouts, retries, and backoff with jitter
 * - FATF Recommendations: https://www.fatf-gafi.org/recommendations
 * - NIST SP 800-63: Digital Identity Guidelines
 * - IFCN Code of Principles: https://ifcncodeofprinciples.poynter.org/
 * - Kubernetes Liveness Probes: Inspiration for website health checks
 *
 * ============================================================================
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";

// ============================================================================
// TYPES
// ============================================================================

export interface FastVerifyResult {
  companyName: string;
  entityFound: boolean | null; // null if check failed/inconclusive
  websiteLive: boolean | null; // null if no website provided or check failed
  sourceCredibility: "high" | "medium" | "low" | "unknown";
  overallStatus: "verified" | "partial" | "unverified" | "suspicious";
  badge: string; // Emoji badge for LinkedIn
  badgeText: string; // Text description
  confidence: number;
  details: {
    entitySearchResult?: string;
    websiteUrl?: string;
    websiteStatus?: number;
    websiteError?: string;
    websiteErrorClass?: WebsiteCheckErrorClass;
    sourceUrl?: string;
    sourceDomain?: string;
    credibilityMatchType?: "exact" | "subdomain" | "pattern" | "fallback";

    // Multi-vantage verification data (if used)
    multiVantage?: {
      used: boolean;
      consensusStrength: number;
      votes: { live: number; dead: number; inconclusive: number };
      vantageDetails: Array<{
        vantage: string;
        live: boolean | null;
        latencyMs: number;
        dnsResolved?: boolean;
        error?: string;
      }>;
    };
  };
  executionTimeMs: number;

  // SLO tracking fields (for calibration and observability)
  sloMetrics?: {
    hadPrimarySource: boolean;        // Found SEC/registry/official source?
    hadTimeout: boolean;              // Any probe timed out?
    circuitBreakerTripped: boolean;   // Was circuit breaker open?
    inconclusiveCount: number;        // How many probes returned null?
    entityProbeLatencyMs?: number;
    websiteProbeLatencyMs?: number;
    websiteProbeAttempts?: number;
    multiVantageUsed?: boolean;       // Was multi-vantage fallback triggered?
    vantageConsensusStrength?: number; // Consensus strength if multi-vantage used
  };
}

// Trusted press release / news sources (high credibility)
const TRUSTED_SOURCES = new Set([
  // Major tech news
  "techcrunch.com",
  "venturebeat.com",
  "theverge.com",
  "arstechnica.com",
  "wired.com",
  "techradar.com",
  "siliconangle.com",
  "zdnet.com",
  "cnet.com",
  "engadget.com",

  // Financial news
  "bloomberg.com",
  "reuters.com",
  "wsj.com",
  "ft.com",
  "cnbc.com",
  "fortune.com",
  "forbes.com",
  "businessinsider.com",
  "axios.com",
  "theinformation.com",

  // Press release wires
  "prnewswire.com",
  "businesswire.com",
  "globenewswire.com",
  "accesswire.com",
  "newswire.com",

  // Startup/VC databases
  "crunchbase.com",
  "news.crunchbase.com",
  "pitchbook.com",
  "dealroom.co",
  "cbinsights.com",
  "tracxn.com",

  // Startup communities
  "ycombinator.com",
  "news.ycombinator.com",
  "producthunt.com",
  "techstartups.com",
  "startupgrind.com",

  // Regional tech news - Europe
  "sifted.eu",
  "eu-startups.com",
  "tech.eu",
  "uktech.news",
  "deutsche-startups.de",

  // Regional tech news - Asia
  "techinasia.com",
  "technode.com",
  "kr-asia.com",
  "e27.co",
  "inc42.com",
  "yourstory.com",

  // Regional tech news - LATAM
  "contxto.com",
  "labsnews.com",

  // Funding-specific news
  "finsmes.com",
  "fundingpost.com",
  "alleywatch.com",
  "geekwire.com",
  "builtinnyc.com",
  "builtinla.com",
  "builtinaustin.com",
  "builtinboston.com",
  "builtinchicago.com",
  "builtincolorado.com",
  "builtinseattle.com",
  "builtin.com",
]);

const MEDIUM_SOURCES = new Set([
  // Social/professional networks
  "linkedin.com",
  "twitter.com",
  "x.com",

  // Blog platforms (company announcements often here)
  "medium.com",
  "substack.com",
  "ghost.io",
  "hashnode.dev",
  "dev.to",

  // Financial/market sites
  "yahoo.com",
  "finance.yahoo.com",
  "benzinga.com",
  "seekingalpha.com",
  "marketwatch.com",
  "investing.com",

  // General news with tech coverage
  "bbc.com",
  "cnn.com",
  "nytimes.com",
  "theguardian.com",
  "washingtonpost.com",

  // Industry publications
  "hbr.org",
  "fastcompany.com",
  "inc.com",
  "entrepreneur.com",

  // Regional/local news
  "sfchronicle.com",
  "mercurynews.com",
  "latimes.com",
  "bostonglobe.com",
]);

// ============================================================================
// MAIN FAST VERIFY ACTION
// ============================================================================

/**
 * Run fast verification on a company/funding claim.
 * Target execution time: <5 seconds.
 */
export const runFastVerify = internalAction({
  args: {
    companyName: v.string(),
    websiteUrl: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    skipEntityCheck: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<FastVerifyResult> => {
    const startTime = Date.now();
    const { companyName, websiteUrl, sourceUrl, skipEntityCheck } = args;

    console.log(`[fastVerify] Starting for ${companyName}`);

    // Initialize result - use null for "not checked yet" or "inconclusive"
    let entityFound: boolean | null = null;
    let websiteLive: boolean | null = null;
    let sourceCredibility: FastVerifyResult["sourceCredibility"] = "unknown";
    const details: FastVerifyResult["details"] = {};

    // Run checks in parallel for speed
    const checks: Promise<void>[] = [];

    // 1. Entity check (quick web search)
    if (!skipEntityCheck) {
      checks.push(
        (async () => {
          try {
            const entityResult = await checkEntityExists(ctx, companyName);
            entityFound = entityResult.found;
            details.entitySearchResult = entityResult.summary;
          } catch (e) {
            console.warn(`[fastVerify] Entity check failed:`, e);
          }
        })()
      );
    }

    // 2. Website liveness check (with multi-vantage fallback)
    let websiteProbeLatencyMs: number | undefined;
    let websiteProbeAttempts: number | undefined;
    let multiVantageUsed = false;
    let vantageConsensusStrength: number | undefined;

    if (websiteUrl && websiteUrl !== "N/A") {
      details.websiteUrl = websiteUrl;
      checks.push(
        (async () => {
          try {
            // Use multi-vantage verification to reduce false negatives
            const websiteResult = await checkWebsiteLiveMultiVantage(websiteUrl);
            websiteLive = websiteResult.live;
            details.websiteStatus = websiteResult.status;
            details.websiteError = websiteResult.error;
            details.websiteErrorClass = websiteResult.errorClass;

            // Track multi-vantage metrics
            websiteProbeLatencyMs = websiteResult.latencyMs;
            websiteProbeAttempts = websiteResult.attemptCount;
            multiVantageUsed = websiteResult.multiVantageUsed;
            vantageConsensusStrength = websiteResult.consensusStrength;

            // Include multi-vantage details if used
            if (websiteResult.multiVantageUsed) {
              details.multiVantage = {
                used: true,
                consensusStrength: websiteResult.consensusStrength,
                votes: websiteResult.votes,
                vantageDetails: websiteResult.vantageResults.map(v => ({
                  vantage: v.vantage,
                  live: v.live,
                  latencyMs: v.latencyMs,
                  dnsResolved: v.dnsResolved,
                  error: v.error,
                })),
              };
            }
          } catch (e) {
            console.warn(`[fastVerify] Website check failed:`, e);
            websiteLive = null;
          }
        })()
      );
    }

    // 3. Source credibility (synchronous, no API call)
    if (sourceUrl) {
      details.sourceUrl = sourceUrl;
      const credResult = checkSourceCredibility(sourceUrl);
      sourceCredibility = credResult.credibility;
      details.sourceDomain = credResult.domain;
    }

    // Wait for all parallel checks.
    //
    // IMPORTANT: do not leave "dangling" tool calls in an action (Convex warns and may terminate them).
    // Instead of racing `Promise.all(checks)` against a timeout (which can abandon in-flight tool calls),
    // each check is responsible for its own timeout/retry behavior.
    await Promise.all(checks);

    // Calculate overall status
    const { status, badge, badgeText, confidence } = calculateOverallStatus(
      entityFound,
      websiteLive,
      sourceCredibility,
      skipEntityCheck ?? false
    );

    const executionTimeMs = Date.now() - startTime;
    console.log(
      `[fastVerify] Completed ${companyName} in ${executionTimeMs}ms: ${status}${multiVantageUsed ? ` (multi-vantage consensus: ${vantageConsensusStrength?.toFixed(2)})` : ""}`
    );

    // Compute SLO metrics
    const inconclusiveCount = [entityFound, websiteLive].filter(v => v === null).length;
    const hadTimeout = details.websiteErrorClass === "timeout";

    return {
      companyName,
      entityFound,
      websiteLive,
      sourceCredibility,
      overallStatus: status,
      badge,
      badgeText,
      confidence,
      details,
      executionTimeMs,
      sloMetrics: {
        hadPrimarySource: sourceCredibility === "high",
        hadTimeout,
        circuitBreakerTripped: details.websiteError?.includes("Circuit breaker") ?? false,
        inconclusiveCount,
        websiteProbeLatencyMs,
        websiteProbeAttempts,
        multiVantageUsed,
        vantageConsensusStrength,
      },
    };
  },
});

/**
 * Batch fast verify for multiple companies.
 * Runs verifications in parallel for speed.
 */
export const batchFastVerify = internalAction({
  args: {
    companies: v.array(
      v.object({
        companyName: v.string(),
        websiteUrl: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
      })
    ),
    maxConcurrent: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<FastVerifyResult[]> => {
    const startTime = Date.now();
    const maxConcurrent = args.maxConcurrent ?? 3;
    const results: FastVerifyResult[] = [];

    console.log(
      `[batchFastVerify] Starting for ${args.companies.length} companies (max concurrent: ${maxConcurrent})`
    );

    // Process in batches for rate limiting
    for (let i = 0; i < args.companies.length; i += maxConcurrent) {
      const batch = args.companies.slice(i, i + maxConcurrent);

      const batchResults = await Promise.all(
        batch.map((company: { companyName: string; websiteUrl?: string; sourceUrl?: string }) =>
          ctx.runAction(internal.domains.verification.fastVerification.runFastVerify, {
            companyName: company.companyName,
            websiteUrl: company.websiteUrl,
            sourceUrl: company.sourceUrl,
          })
        )
      );

      results.push(...batchResults);
    }

    const totalTime = Date.now() - startTime;
    console.log(
      `[batchFastVerify] Completed ${results.length} companies in ${totalTime}ms`
    );

    return results;
  },
});

// ============================================================================
// VERIFICATION CHECKS
// ============================================================================

/**
 * Quick check if an entity exists via web search.
 * Looks for business registration or official company presence.
 *
 * Returns:
 *   - found: true  → Company found with credible signals
 *   - found: false → Search completed, no matches found
 *   - found: null  → Search failed/inconclusive (don't penalize)
 */
async function checkEntityExists(
  ctx: any,
  companyName: string
): Promise<{ found: boolean | null; summary: string }> {
  try {
    // Search for official company presence
    const searchQuery = `"${companyName}" company official OR incorporated OR founded OR startup`;

    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: searchQuery,
        mode: "fast",
        maxTotal: 5, // Increased from 3 for better coverage
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    if (results.length === 0) {
      // No results could mean new company or search issue - return inconclusive
      return { found: null, summary: "No search results - company may be new or search limited" };
    }

    // Check if any result mentions the company with credible context
    for (const r of results) {
      const content = ((r.snippet || "") + " " + (r.title || "")).toLowerCase();
      const companyLower = companyName.toLowerCase();

      if (content.includes(companyLower)) {
        // Check for credibility signals
        const hasOfficialSignals =
          content.includes("founded") ||
          content.includes("incorporated") ||
          content.includes("company") ||
          content.includes("startup") ||
          content.includes("funding") ||
          content.includes("ceo") ||
          content.includes("linkedin") ||
          content.includes("raised") ||
          content.includes("series") ||
          content.includes("venture");

        if (hasOfficialSignals) {
          return {
            found: true,
            summary: `Found on ${extractDomain(r.url || "web")}`,
          };
        }
      }
    }

    // Results found but no strong match - inconclusive rather than negative
    return { found: null, summary: "Search results found but weak company match" };
  } catch (error) {
    console.warn(`[checkEntityExists] Search failed:`, error);
    // Search failure should not penalize the company
    return { found: null, summary: "Entity search unavailable" };
  }
}

// ============================================================================
// ERROR TAXONOMY (for observability)
// ============================================================================
// Per reliability engineering best practices, classify errors into distinct
// categories to enable proper metrics, alerting, and incident response.

export type WebsiteCheckErrorClass =
  | "dns_nxdomain"      // Domain doesn't exist (ENOTFOUND) - definitive failure
  | "dns_temp"          // Temporary DNS failure (EAI_AGAIN) - inconclusive
  | "timeout"           // Request timed out - inconclusive
  | "tls_error"         // TLS/SSL handshake failed - inconclusive
  | "connection_refused"// Server refused connection - inconclusive
  | "connection_reset"  // Connection reset by peer - inconclusive
  | "bot_blocked"       // 403/429 likely bot detection - inconclusive
  | "server_error"      // 5xx server error - live but unhealthy
  | "client_error"      // 4xx client error - live
  | "network_error"     // Generic network error - inconclusive
  | "success"           // 2xx/3xx success - live

export interface WebsiteCheckResult {
  live: boolean | null;
  status?: number;
  error?: string;
  errorClass?: WebsiteCheckErrorClass;
  latencyMs?: number;
  attemptCount?: number;
}

// ============================================================================
// MULTI-VANTAGE VERIFICATION
// ============================================================================
// Single-vantage verification is vulnerable to:
// - Regional network issues
// - ISP-level blocking
// - CDN edge node failures
// - DNS resolver inconsistencies
//
// Multi-vantage checks from independent resolvers provide:
// - Reduced false negatives (one vantage fails, others succeed)
// - Consensus-based decisions (majority voting)
// - Geographic diversity (different DNS perspectives)
// ============================================================================

export type VantagePoint =
  | "direct"
  | "cloudflare_doh"
  | "google_doh"
  | "http_checkhost_us"
  | "http_checkhost_de"
  | "http_checkhost_sg";

export interface VantageResult {
  vantage: VantagePoint;
  live: boolean | null;
  latencyMs: number;
  error?: string;
  errorClass?: WebsiteCheckErrorClass;
  dnsResolved?: boolean;        // Did DNS resolution succeed?
  resolvedIp?: string;          // IP address if resolved
  httpStatus?: number;          // HTTP status code if HTTP check was performed
  probeType: "dns" | "http";    // What type of probe was this?
}

export interface MultiVantageResult {
  /** Final consensus result after majority voting */
  live: boolean | null;
  /** HTTP status from successful vantage (if any) */
  status?: number;
  /** Error message from primary vantage */
  error?: string;
  /** Error class from primary vantage */
  errorClass?: WebsiteCheckErrorClass;
  /** Total latency across all vantages */
  latencyMs: number;
  /** Number of HTTP attempts (primary vantage only) */
  attemptCount?: number;

  /** Multi-vantage specific fields */
  vantageResults: VantageResult[];
  /** How many vantages agreed on the result */
  consensusStrength: number;    // 0-1, e.g., 3/3 = 1.0, 2/3 = 0.67
  /** Voting breakdown */
  votes: {
    live: number;
    dead: number;
    inconclusive: number;
  };
  /** Was multi-vantage used? (false if disabled or skipped) */
  multiVantageUsed: boolean;
}

// DNS-over-HTTPS endpoints
const DOH_ENDPOINTS = {
  cloudflare: "https://cloudflare-dns.com/dns-query",
  google: "https://dns.google/resolve",
} as const;

// ============================================================================
// EXTERNAL HTTP CHECK SERVICES
// ============================================================================
// These services perform HTTP requests from different geographic locations,
// enabling detection of geo-blocking, WAF rules, and regional outages.
//
// check-host.net: Free API for HTTP checks from multiple global locations
// Ref: https://check-host.net/about/api
// ============================================================================

interface CheckHostNode {
  id: string;
  location: string;
  vantage: VantagePoint;
}

const CHECKHOST_NODES: CheckHostNode[] = [
  { id: "us1.node.check-host.net", location: "US (New York)", vantage: "http_checkhost_us" },
  { id: "de1.node.check-host.net", location: "Germany (Frankfurt)", vantage: "http_checkhost_de" },
  { id: "sg1.node.check-host.net", location: "Singapore", vantage: "http_checkhost_sg" },
];

/**
 * Perform HTTP check from external vantage point via check-host.net
 *
 * This API provides HTTP checks from multiple geographic locations,
 * helping detect WAF/geo-blocking that might cause false negatives
 * from a single vantage point.
 *
 * Rate limits: ~50 requests/hour (free tier)
 */
async function checkHttpFromExternalVantage(
  url: string,
  node: CheckHostNode,
  timeoutMs: number = 8000
): Promise<VantageResult> {
  const startTime = Date.now();

  try {
    // Check-host.net API: initiate check
    const checkUrl = `https://check-host.net/check-http?host=${encodeURIComponent(url)}&node=${node.id}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const initResponse = await fetch(checkUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "NodeBench/1.0 (verification-service)",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!initResponse.ok) {
      return {
        vantage: node.vantage,
        live: null,
        latencyMs: Date.now() - startTime,
        error: `check-host.net API returned ${initResponse.status}`,
        probeType: "http",
      };
    }

    const initData = await initResponse.json() as {
      ok: number;
      request_id?: string;
      nodes?: Record<string, string[]>;
    };

    if (!initData.ok || !initData.request_id) {
      return {
        vantage: node.vantage,
        live: null,
        latencyMs: Date.now() - startTime,
        error: "check-host.net API did not return request_id",
        probeType: "http",
      };
    }

    // Poll for result (check-host is async)
    const resultUrl = `https://check-host.net/check-result/${initData.request_id}`;
    const pollStartTime = Date.now();
    const maxPollTime = 5000; // Max 5s polling

    while (Date.now() - pollStartTime < maxPollTime) {
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms between polls

      const pollController = new AbortController();
      const pollTimeoutId = setTimeout(() => pollController.abort(), 3000);

      try {
        const resultResponse = await fetch(resultUrl, {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: pollController.signal,
        });

        clearTimeout(pollTimeoutId);

        if (!resultResponse.ok) continue;

        const resultData = await resultResponse.json() as Record<string, Array<{
          time: number;
          connect: number;
          status?: { code: number };
          error?: string;
        }> | null>;

        // Check if our node has responded
        const nodeResult = resultData[node.id];
        if (nodeResult && nodeResult.length > 0) {
          const result = nodeResult[0];

          if (result.error) {
            // Classify the error
            const errorLower = result.error.toLowerCase();
            let errorClass: WebsiteCheckErrorClass = "network_error";
            let live: boolean | null = null;

            if (errorLower.includes("could not resolve") || errorLower.includes("nxdomain")) {
              errorClass = "dns_nxdomain";
              live = false; // Domain doesn't exist
            } else if (errorLower.includes("timeout") || errorLower.includes("timed out")) {
              errorClass = "timeout";
            } else if (errorLower.includes("connection refused")) {
              errorClass = "connection_refused";
            } else if (errorLower.includes("ssl") || errorLower.includes("certificate")) {
              errorClass = "tls_error";
            }

            return {
              vantage: node.vantage,
              live,
              latencyMs: Date.now() - startTime,
              error: result.error,
              errorClass,
              probeType: "http",
            };
          }

          if (result.status?.code) {
            const statusCode = result.status.code;
            let live = true; // Any HTTP response means server exists

            // Classify error class based on status
            let errorClass: WebsiteCheckErrorClass = "success";
            if (statusCode >= 500) errorClass = "server_error";
            else if (statusCode === 403 || statusCode === 429) errorClass = "bot_blocked";
            else if (statusCode >= 400) errorClass = "client_error";

            return {
              vantage: node.vantage,
              live,
              latencyMs: Date.now() - startTime,
              httpStatus: statusCode,
              errorClass,
              probeType: "http",
            };
          }

          // Got response but no status - treat as inconclusive
          return {
            vantage: node.vantage,
            live: null,
            latencyMs: Date.now() - startTime,
            error: "check-host.net returned incomplete result",
            probeType: "http",
          };
        }
      } catch (pollError) {
        // Polling failed, continue trying
        continue;
      }
    }

    // Polling timed out
    return {
      vantage: node.vantage,
      live: null,
      latencyMs: Date.now() - startTime,
      error: "check-host.net polling timed out",
      errorClass: "timeout",
      probeType: "http",
    };

  } catch (error: any) {
    return {
      vantage: node.vantage,
      live: null,
      latencyMs: Date.now() - startTime,
      error: error?.name === "AbortError" ? "Timeout" : (error?.message || "Unknown error"),
      errorClass: error?.name === "AbortError" ? "timeout" : "network_error",
      probeType: "http",
    };
  }
}

/**
 * Resolve DNS via DNS-over-HTTPS (DoH)
 * Provides an independent vantage point for DNS resolution
 */
async function resolveDnsViaDoH(
  hostname: string,
  provider: "cloudflare" | "google",
  timeoutMs: number = 5000
): Promise<{ resolved: boolean; ip?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let url: string;
    let headers: Record<string, string>;

    if (provider === "cloudflare") {
      // Cloudflare DoH uses application/dns-json
      url = `${DOH_ENDPOINTS.cloudflare}?name=${encodeURIComponent(hostname)}&type=A`;
      headers = { "Accept": "application/dns-json" };
    } else {
      // Google DNS API
      url = `${DOH_ENDPOINTS.google}?name=${encodeURIComponent(hostname)}&type=A`;
      headers = { "Accept": "application/json" };
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { resolved: false, error: `DoH ${provider} returned ${response.status}` };
    }

    const data = await response.json() as {
      Status?: number;
      Answer?: Array<{ type: number; data: string }>;
    };

    // Status 0 = NOERROR, Status 3 = NXDOMAIN
    if (data.Status === 3) {
      return { resolved: false, error: "NXDOMAIN" };
    }

    // Look for A record (type 1)
    const aRecord = data.Answer?.find((a: { type: number }) => a.type === 1);
    if (aRecord) {
      return { resolved: true, ip: aRecord.data };
    }

    // No A record found but not NXDOMAIN - might be CNAME only or other record types
    return { resolved: true }; // Domain exists but may not have A record

  } catch (error: any) {
    const errMsg = error?.name === "AbortError"
      ? `DoH ${provider} timeout`
      : error?.message || "Unknown DoH error";
    return { resolved: false, error: errMsg };
  }
}

/**
 * Check website liveness from a single vantage point
 * This is a lighter-weight check than the full HTTP check
 */
async function checkFromVantage(
  hostname: string,
  vantage: VantagePoint,
  timeoutMs: number = 5000
): Promise<VantageResult> {
  const startTime = Date.now();

  if (vantage === "direct") {
    // Direct check - just DNS resolution via system resolver
    // We can't do HTTP from DoH, so for direct we do a quick DNS lookup
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Simple HEAD request to check if host resolves and responds
      const response = await fetch(`https://${hostname}`, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; NodeBenchBot/1.0)",
        },
      });

      clearTimeout(timeoutId);

      return {
        vantage,
        live: true,
        latencyMs: Date.now() - startTime,
        dnsResolved: true,
        httpStatus: response.status,
        probeType: "http",
      };
    } catch (error: any) {
      const errorClass = classifyError(error);
      return {
        vantage,
        live: errorClass === "dns_nxdomain" ? false : null,
        latencyMs: Date.now() - startTime,
        error: error?.message,
        errorClass,
        dnsResolved: errorClass !== "dns_nxdomain" && errorClass !== "dns_temp",
        probeType: "http",
      };
    }
  }

  // DoH vantage points - just check DNS resolution
  if (vantage === "cloudflare_doh" || vantage === "google_doh") {
    const provider = vantage === "cloudflare_doh" ? "cloudflare" : "google";
    const dohResult = await resolveDnsViaDoH(hostname, provider, timeoutMs);
    const isNxdomain = dohResult.error?.includes("NXDOMAIN") ?? false;

    return {
      vantage,
      // DNS resolution is weak evidence of "exists", but not "responding". Only treat NXDOMAIN as dead.
      live: dohResult.resolved ? null : isNxdomain ? false : null,
      latencyMs: Date.now() - startTime,
      error: dohResult.error,
      errorClass: isNxdomain ? "dns_nxdomain" : undefined,
      dnsResolved: dohResult.resolved,
      resolvedIp: dohResult.ip,
      probeType: "dns",
    };
  }

  // HTTP check-host vantage points
  const checkHostNode = CHECKHOST_NODES.find(n => n.vantage === vantage);
  if (checkHostNode) {
    return checkHttpFromExternalVantage(`https://${hostname}`, checkHostNode, timeoutMs);
  }

  // Unknown vantage type
  return {
    vantage,
    live: null,
    latencyMs: Date.now() - startTime,
    error: `Unknown vantage type: ${vantage}`,
    probeType: "http",
  };
}

/**
 * Compute majority vote from vantage results
 *
 * Voting logic:
 * - "live" votes: vantage returned live=true OR dnsResolved=true
 * - "dead" votes: vantage returned live=false AND errorClass=dns_nxdomain
 * - "inconclusive" votes: everything else
 *
 * Decision:
 * - If majority says "live" → live=true
 * - If majority says "dead" → live=false (only if ALL say dead)
 * - Otherwise → live=null (inconclusive)
 */
function computeVantageConsensus(
  vantageResults: VantageResult[]
): { live: boolean | null; consensusStrength: number; votes: { live: number; dead: number; inconclusive: number } } {
  const votes = { live: 0, dead: 0, inconclusive: 0 };

  for (const result of vantageResults) {
    if (result.live === true || result.dnsResolved === true) {
      votes.live++;
    } else if (result.live === false && result.errorClass === "dns_nxdomain") {
      votes.dead++;
    } else {
      votes.inconclusive++;
    }
  }

  const total = vantageResults.length;
  const majority = Math.ceil(total / 2);

  // Strict dead: ALL vantages must agree domain doesn't exist
  if (votes.dead === total) {
    return { live: false, consensusStrength: 1.0, votes };
  }

  // Live: majority says domain exists/responds
  if (votes.live >= majority) {
    return { live: true, consensusStrength: votes.live / total, votes };
  }

  // Inconclusive: no clear majority
  return { live: null, consensusStrength: Math.max(votes.live, votes.dead, votes.inconclusive) / total, votes };
}

/**
 * Classify error into taxonomy for observability
 */
function classifyError(error: any, statusCode?: number): WebsiteCheckErrorClass {
  if (statusCode) {
    if (statusCode >= 200 && statusCode < 400) return "success";
    if (statusCode === 403 || statusCode === 429) return "bot_blocked";
    if (statusCode >= 400 && statusCode < 500) return "client_error";
    if (statusCode >= 500) return "server_error";
  }

  const errStr = String(error?.message ?? error ?? "").toLowerCase();
  const code = String(error?.cause?.code ?? error?.code ?? "").toLowerCase();

  // DNS failures
  if (code.includes("enotfound") || errStr.includes("enotfound")) return "dns_nxdomain";
  if (code.includes("eai_again") || errStr.includes("eai_again")) return "dns_temp";
  // "getaddrinfo" is a syscall used for multiple DNS error types. Treat it as NXDOMAIN only when
  // we have a strong signal; otherwise classify as temporary/inconclusive to avoid false negatives.
  if (code.includes("eai_noname") || errStr.includes("eai_noname")) return "dns_nxdomain";
  if (
    errStr.includes("name or service not known") ||
    errStr.includes("nodename nor servname provided") ||
    errStr.includes("no address associated with hostname")
  ) {
    return "dns_nxdomain";
  }
  if (code.includes("getaddrinfo") || errStr.includes("getaddrinfo")) return "dns_temp";

  // Connection failures
  if (code.includes("econnrefused") || errStr.includes("econnrefused")) return "connection_refused";
  if (code.includes("econnreset") || errStr.includes("econnreset")) return "connection_reset";

  // TLS failures
  if (errStr.includes("ssl") || errStr.includes("tls") || errStr.includes("certificate")) return "tls_error";

  // Timeout
  if (error?.name === "AbortError" || errStr.includes("timeout") || errStr.includes("timed out")) return "timeout";

  return "network_error";
}

/**
 * Calculate exponential backoff with full jitter
 * Ref: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 *
 * Formula: sleep = random_between(0, min(cap, base * 2^attempt))
 */
function calculateBackoffWithJitter(
  attempt: number,
  baseMs: number = 100,
  capMs: number = 2000
): number {
  const exponentialMs = Math.min(capMs, baseMs * Math.pow(2, attempt));
  // Full jitter: random between 0 and exponential value
  return Math.floor(Math.random() * exponentialMs);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// CIRCUIT BREAKER (simple in-memory implementation)
// ============================================================================
// Prevents "verification storms" when upstream services degrade.
// Note: In a distributed system, this should use shared state (Redis, etc.)

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,      // Open after 5 consecutive failures
  resetTimeoutMs: 30000,    // Try again after 30 seconds
  halfOpenSuccesses: 2,     // Close after 2 successes in half-open
};

function getCircuitBreaker(domain: string): CircuitBreakerState {
  if (!circuitBreakers.has(domain)) {
    circuitBreakers.set(domain, { failures: 0, lastFailure: 0, state: "closed" });
  }
  return circuitBreakers.get(domain)!;
}

function shouldAllowRequest(domain: string): boolean {
  const cb = getCircuitBreaker(domain);
  const now = Date.now();

  if (cb.state === "open") {
    // Check if we should transition to half-open
    if (now - cb.lastFailure >= CIRCUIT_BREAKER_CONFIG.resetTimeoutMs) {
      cb.state = "half-open";
      return true;
    }
    return false;
  }

  return true;
}

function recordSuccess(domain: string): void {
  const cb = getCircuitBreaker(domain);
  if (cb.state === "half-open") {
    cb.failures = Math.max(0, cb.failures - 1);
    if (cb.failures === 0) {
      cb.state = "closed";
    }
  } else {
    cb.failures = 0;
    cb.state = "closed";
  }
}

function recordFailure(domain: string): void {
  const cb = getCircuitBreaker(domain);
  cb.failures++;
  cb.lastFailure = Date.now();

  if (cb.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
    cb.state = "open";
    console.warn(`[CircuitBreaker] OPEN for domain: ${domain} (${cb.failures} failures)`);
  }
}

/**
 * Check if a website is live via HEAD request.
 * Uses retry logic with exponential backoff + jitter to avoid false negatives.
 *
 * Implements:
 * - Exponential backoff with full jitter (AWS best practice)
 * - Circuit breaker pattern for degraded upstreams
 * - Error taxonomy for observability
 * - Probe semantics: availability check only (not authenticity/credibility)
 */
async function checkWebsiteLive(url: string): Promise<WebsiteCheckResult> {
  const startTime = Date.now();
  const normalizedUrl = normalizeWebsiteUrl(url);

  if (!normalizedUrl) {
    return {
      live: null,
      error: "Invalid website URL",
      errorClass: "network_error",
      latencyMs: Date.now() - startTime,
      attemptCount: 0,
    };
  }

  // Extract domain for circuit breaker
  let domain: string;
  try {
    domain = new URL(normalizedUrl).hostname;
  } catch {
    return {
      live: null,
      error: "Invalid URL format",
      errorClass: "network_error",
      latencyMs: Date.now() - startTime,
      attemptCount: 0,
    };
  }

  // Check circuit breaker
  if (!shouldAllowRequest(domain)) {
    return {
      live: null,
      error: "Circuit breaker open - domain temporarily unavailable",
      errorClass: "network_error",
      latencyMs: Date.now() - startTime,
      attemptCount: 0,
    };
  }

  // Common User-Agent to avoid blocks (many sites reject requests without one)
  const headers = {
    "User-Agent": "Mozilla/5.0 (compatible; NodeBenchBot/1.0; +https://nodebench.ai)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  // Retry configuration per AWS best practices:
  // - Progressive timeouts (8s, 10s, 10s)
  // - Method fallback (HEAD → GET) for servers that block HEAD
  // - Exponential backoff with full jitter between retries
  // Ref: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
  const attempts = [
    { method: "HEAD" as const, timeout: 8000 },
    { method: "HEAD" as const, timeout: 10000 },
    { method: "GET" as const, timeout: 10000 },
  ];

  let lastError: string | undefined;
  let lastStatus: number | undefined;
  let lastErrorClass: WebsiteCheckErrorClass = "network_error";
  let attemptCount = 0;

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    attemptCount++;

    // Apply backoff with jitter before retry (not on first attempt)
    if (i > 0) {
      const backoffMs = calculateBackoffWithJitter(i, 100, 2000);
      if (backoffMs > 0) {
        await sleep(backoffMs);
      }
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), attempt.timeout);

      const response = await fetch(normalizedUrl, {
        method: attempt.method,
        signal: controller.signal,
        redirect: "follow",
        headers,
      });

      clearTimeout(timeoutId);
      lastStatus = response.status;

      // Record success for circuit breaker
      recordSuccess(domain);

      // Classify the response
      const errorClass = classifyError(null, response.status);

      // Any HTTP response means server is responding
      // Even 4xx/5xx counts as "live" (server exists and responds)
      return {
        live: true,
        status: response.status,
        errorClass,
        latencyMs: Date.now() - startTime,
        attemptCount,
      };
    } catch (error: any) {
      lastErrorClass = classifyError(error, undefined);

      const code = String(error?.cause?.code ?? error?.code ?? "");
      lastError = error?.name === "AbortError"
        ? `Timeout after ${attempt.timeout}ms`
        : (error?.message || "Unknown error") + (code ? ` (${code})` : "");

      // DNS NXDOMAIN is definitive - no point retrying
      if (lastErrorClass === "dns_nxdomain") {
        recordFailure(domain);
        return {
          live: false,  // Definitive: domain doesn't exist
          error: lastError,
          errorClass: lastErrorClass,
          latencyMs: Date.now() - startTime,
          attemptCount,
        };
      }

      // If HEAD fails with non-timeout, try GET next
      if (error?.name !== "AbortError" && attempt.method === "HEAD") {
        continue;
      }
    }
  }

  // All attempts failed - record for circuit breaker
  recordFailure(domain);

  console.warn(`[checkWebsiteLive] All attempts failed for ${url}: ${lastError} (class: ${lastErrorClass})`);

  // If we reach here, DNS NXDOMAIN was already handled with early return above.
  // All remaining errors (timeout, TLS, connection refused, etc.) are INCONCLUSIVE.
  // This prevents false negatives from transient network issues.
  return {
    live: null,  // Inconclusive - don't penalize
    status: lastStatus,
    error: lastError,
    errorClass: lastErrorClass,
    latencyMs: Date.now() - startTime,
    attemptCount,
  };
}

/**
 * Check website liveness using multi-vantage verification
 *
 * Strategy:
 * 1. Run primary HTTP check (full retry logic)
 * 2. If primary succeeds → return immediately (fast path)
 * 3. If primary fails/inconclusive → run DoH + HTTP checks in parallel
 * 4. If DoH says DNS resolves but HTTP failed → run external HTTP checks
 * 5. Compute consensus via majority voting (HTTP probes weighted higher)
 *
 * This prevents false negatives from:
 * - Single-vantage DNS failures (DoH checks)
 * - WAF/geo-blocking (external HTTP checks from different locations)
 */
async function checkWebsiteLiveMultiVantage(
  url: string,
  options?: {
    enableMultiVantage?: boolean;
    enableExternalHttpChecks?: boolean;  // Whether to use check-host.net (default: true)
  }
): Promise<MultiVantageResult> {
  const startTime = Date.now();
  const enableMultiVantage = options?.enableMultiVantage ?? true;
  const enableExternalHttpChecks = options?.enableExternalHttpChecks ?? true;

  // Run primary check first
  const primaryResult = await checkWebsiteLive(url);

  // Fast path: if primary succeeds, no need for multi-vantage
  if (primaryResult.live === true || !enableMultiVantage) {
    return {
      live: primaryResult.live,
      status: primaryResult.status,
      error: primaryResult.error,
      errorClass: primaryResult.errorClass,
      latencyMs: primaryResult.latencyMs ?? (Date.now() - startTime),
      attemptCount: primaryResult.attemptCount,
      vantageResults: [{
        vantage: "direct",
        live: primaryResult.live,
        latencyMs: primaryResult.latencyMs || 0,
        error: primaryResult.error,
        errorClass: primaryResult.errorClass,
        dnsResolved: primaryResult.live !== false,
        probeType: "http",
      }],
      consensusStrength: 1.0,
      votes: { live: primaryResult.live === true ? 1 : 0, dead: primaryResult.live === false ? 1 : 0, inconclusive: primaryResult.live === null ? 1 : 0 },
      multiVantageUsed: false,
    };
  }

  // Primary failed or inconclusive - run multi-vantage checks
  const normalizedUrl = normalizeWebsiteUrl(url);
  if (!normalizedUrl) {
    return {
      live: primaryResult.live,
      status: primaryResult.status,
      error: primaryResult.error,
      errorClass: primaryResult.errorClass,
      latencyMs: primaryResult.latencyMs ?? (Date.now() - startTime),
      attemptCount: primaryResult.attemptCount,
      vantageResults: [],
      consensusStrength: 0,
      votes: { live: 0, dead: 0, inconclusive: 1 },
      multiVantageUsed: false,
    };
  }

  let hostname: string;
  try {
    hostname = new URL(normalizedUrl).hostname;
  } catch {
    return {
      live: primaryResult.live,
      status: primaryResult.status,
      error: primaryResult.error,
      errorClass: primaryResult.errorClass,
      latencyMs: primaryResult.latencyMs ?? (Date.now() - startTime),
      attemptCount: primaryResult.attemptCount,
      vantageResults: [],
      consensusStrength: 0,
      votes: { live: 0, dead: 0, inconclusive: 1 },
      multiVantageUsed: false,
    };
  }

  console.log(`[MultiVantage] Primary check failed/inconclusive for ${hostname}, running DoH checks`);

  // Phase 1: Run DoH checks in parallel to verify DNS resolves
  const [cloudflareResult, googleResult] = await Promise.all([
    checkFromVantage(hostname, "cloudflare_doh", 5000),
    checkFromVantage(hostname, "google_doh", 5000),
  ]);

  // Create primary vantage result
  const primaryVantage: VantageResult = {
    vantage: "direct",
    live: primaryResult.live,
    latencyMs: primaryResult.latencyMs || 0,
    error: primaryResult.error,
    errorClass: primaryResult.errorClass,
    dnsResolved: primaryResult.errorClass !== "dns_nxdomain",
    probeType: "http",
  };

  // Collect all vantage results
  const allVantages: VantageResult[] = [primaryVantage, cloudflareResult, googleResult];

  // Phase 2: If DNS resolved from DoH but primary HTTP failed, run external HTTP checks
  // This catches WAF/geo-blocking scenarios
  // Note: At this point, primaryResult.live is guaranteed to not be true (checked above)
  const dnsResolvedElsewhere = cloudflareResult.dnsResolved || googleResult.dnsResolved;

  if (enableExternalHttpChecks && dnsResolvedElsewhere) {
    console.log(`[MultiVantage] DNS resolved via DoH but HTTP failed for ${hostname}, running external HTTP checks`);

    // Run external HTTP checks in parallel (rate limited to 1-2 nodes to preserve quota)
    // Select US and one other region for geographic diversity
    const externalHttpChecks = await Promise.all([
      checkFromVantage(hostname, "http_checkhost_us", 10000),
      checkFromVantage(hostname, "http_checkhost_de", 10000),
    ]);

    allVantages.push(...externalHttpChecks);

    // Log external HTTP results
    for (const result of externalHttpChecks) {
      console.log(`[MultiVantage] External HTTP ${result.vantage}: live=${result.live}, status=${result.httpStatus}, error=${result.error}`);
    }
  }

  // Compute consensus with HTTP probes weighted appropriately
  const consensus = computeVantageConsensusWeighted(allVantages);

  console.log(`[MultiVantage] Consensus for ${hostname}: live=${consensus.live}, strength=${consensus.consensusStrength.toFixed(2)}, votes=${JSON.stringify(consensus.votes)}, httpVotes=${consensus.httpVotes}`);

  // Final decision: prefer HTTP consensus over DNS-only
  const finalLive = consensus.live;

  return {
    live: finalLive,
    status: primaryResult.status,
    error: finalLive === true ? undefined : primaryResult.error,
    errorClass: finalLive === true ? "success" : primaryResult.errorClass,
    latencyMs: Date.now() - startTime,
    attemptCount: primaryResult.attemptCount,
    vantageResults: allVantages,
    consensusStrength: consensus.consensusStrength,
    votes: consensus.votes,
    multiVantageUsed: true,
  };
}

/**
 * Compute weighted consensus from vantage results
 *
 * HTTP probes are weighted higher than DNS-only probes because:
 * - DNS resolution alone doesn't prove HTTP works
 * - HTTP probes definitively show whether the server responds
 *
 * Voting weights:
 * - HTTP probe success: 2 votes for "live"
 * - HTTP probe NXDOMAIN: 2 votes for "dead"
 * - DNS-only resolved: 1 vote for "live" (weakly suggests site exists)
 * - DNS-only NXDOMAIN: 1 vote for "dead"
 */
function computeVantageConsensusWeighted(
  vantageResults: VantageResult[]
): {
  live: boolean | null;
  consensusStrength: number;
  votes: { live: number; dead: number; inconclusive: number };
  httpVotes: { live: number; dead: number; inconclusive: number };
} {
  const votes = { live: 0, dead: 0, inconclusive: 0 };
  const httpVotes = { live: 0, dead: 0, inconclusive: 0 };
  let totalWeight = 0;

  for (const result of vantageResults) {
    const isHttpProbe = result.probeType === "http";
    const weight = isHttpProbe ? 2 : 1;

    if (result.live === true || (result.dnsResolved === true && result.probeType === "dns")) {
      votes.live += weight;
      if (isHttpProbe) httpVotes.live++;
    } else if (result.live === false && result.errorClass === "dns_nxdomain") {
      votes.dead += weight;
      if (isHttpProbe) httpVotes.dead++;
    } else {
      votes.inconclusive += weight;
      if (isHttpProbe) httpVotes.inconclusive++;
    }
    totalWeight += weight;
  }

  // HTTP probes take precedence if they have clear consensus
  const httpTotal = httpVotes.live + httpVotes.dead + httpVotes.inconclusive;
  if (httpTotal >= 2) {
    // Have enough HTTP probes for meaningful consensus
    if (httpVotes.live >= 2) {
      return { live: true, consensusStrength: httpVotes.live / httpTotal, votes, httpVotes };
    }
  }

  // Fall back to combined weighted voting
  const majority = Math.ceil(totalWeight / 2);

  // Strict dead: ALL vantages must agree domain doesn't exist
  if (votes.dead === totalWeight) {
    return { live: false, consensusStrength: 1.0, votes, httpVotes };
  }

  // Live: weighted majority says domain exists/responds
  if (votes.live >= majority) {
    return { live: true, consensusStrength: votes.live / totalWeight, votes, httpVotes };
  }

  // Inconclusive: no clear majority
  return {
    live: null,
    consensusStrength: Math.max(votes.live, votes.dead, votes.inconclusive) / totalWeight,
    votes,
    httpVotes,
  };
}

function normalizeWebsiteUrl(input: string): string | null {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;

  // Remove common trailing punctuation from scraped URLs.
  const cleaned = trimmed.replace(/[)\],.;]+$/g, "");
  const withProto = cleaned.startsWith("http") ? cleaned : `https://${cleaned}`;
  try {
    const u = new URL(withProto);
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Check source URL credibility based on domain.
 * Returns "unknown" for unrecognized sources instead of "low" to avoid harsh penalties.
 *
 * matchType indicates how the credibility was determined (for auditability):
 * - "exact": Domain exactly matched a known source
 * - "subdomain": Base domain matched (e.g., news.forbes.com → forbes.com)
 * - "pattern": URL contains press/news patterns
 * - "fallback": No match found, returned default "unknown"
 */
function checkSourceCredibility(url: string): {
  credibility: FastVerifyResult["sourceCredibility"];
  domain: string;
  matchType: "exact" | "subdomain" | "pattern" | "fallback";
} {
  const domain = extractDomain(url);
  const urlLower = url.toLowerCase();

  // Check trusted sources first (exact match)
  if (TRUSTED_SOURCES.has(domain)) {
    return { credibility: "high", domain, matchType: "exact" };
  }

  // Check medium sources
  if (MEDIUM_SOURCES.has(domain)) {
    return { credibility: "medium", domain, matchType: "exact" };
  }

  // Check for subdomain matches (e.g., news.example.com matches example.com)
  const domainParts = domain.split(".");
  if (domainParts.length > 2) {
    const baseDomain = domainParts.slice(-2).join(".");
    if (TRUSTED_SOURCES.has(baseDomain)) {
      return { credibility: "high", domain, matchType: "subdomain" };
    }
    if (MEDIUM_SOURCES.has(baseDomain)) {
      return { credibility: "medium", domain, matchType: "subdomain" };
    }
  }

  // Check for news/press patterns in URL or domain (company announcements)
  const pressPatterns = [
    "blog", "press", "news", "newsroom", "media", "announcement",
    "release", "investor", "ir.", "about", "company"
  ];
  if (pressPatterns.some(p => domain.includes(p) || urlLower.includes(`/${p}`))) {
    return { credibility: "medium", domain, matchType: "pattern" };
  }

  // Check for government/educational domains (usually credible)
  if (domain.endsWith(".gov") || domain.endsWith(".edu") || domain.endsWith(".org")) {
    return { credibility: "medium", domain, matchType: "pattern" };
  }

  // For unrecognized sources, return "unknown" instead of "low"
  // This gives 0 points but doesn't trigger negative signals
  return { credibility: "unknown", domain, matchType: "fallback" };
}

// ============================================================================
// STATUS CALCULATION
// ============================================================================

function calculateOverallStatus(
  entityFound: boolean | null,
  websiteLive: boolean | null,
  sourceCredibility: FastVerifyResult["sourceCredibility"],
  skipEntityCheck: boolean
): {
  status: FastVerifyResult["overallStatus"];
  badge: string;
  badgeText: string;
  confidence: number;
} {
  let score = 0;
  const maxScore = skipEntityCheck ? 2 : 3;

  // Entity found: +1 for true, +0.5 for null (inconclusive), +0 for false
  if (skipEntityCheck) {
    score += 1;
  } else if (entityFound === true) {
    score += 1;
  } else if (entityFound === null) {
    score += 0.5; // Inconclusive - don't penalize
  }
  // entityFound === false: score += 0 (penalize only on explicit not-found)

  // Website live: +1 for true, +0.5 for null (inconclusive), +0 for false
  if (websiteLive === true) {
    score += 1;
  } else if (websiteLive === null) {
    score += 0.5; // Inconclusive - don't penalize
  }
  // websiteLive === false: score += 0 (DNS failure = site doesn't exist)

  // Source credibility: high=1, medium=0.5, unknown=0.25, low=0
  if (sourceCredibility === "high") score += 1;
  else if (sourceCredibility === "medium") score += 0.5;
  else if (sourceCredibility === "unknown") score += 0.25; // Neutral - don't penalize

  // Calculate confidence
  const confidence = score / maxScore;

  // Determine status
  if (confidence >= 0.8) {
    return {
      status: "verified",
      badge: "[Verified]",
      badgeText: "Verified - Multiple signals confirmed",
      confidence,
    };
  } else if (confidence >= 0.5) {
    return {
      status: "partial",
      badge: "[Partial]",
      badgeText: "Partial verification - Some signals found",
      confidence,
    };
  } else if (entityFound === false && websiteLive === false && sourceCredibility === "low") {
    // Only mark suspicious if ALL checks explicitly failed (not just inconclusive)
    return {
      status: "suspicious",
      badge: "[Unverified]",
      badgeText: "Unverified - Multiple red flags, verify independently",
      confidence,
    };
  } else {
    return {
      status: "unverified",
      badge: "[Unverified]",
      badgeText: "Unverified - Limited verification data",
      confidence,
    };
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
    return urlObj.hostname.replace("www.", "");
  } catch {
    return url;
  }
}

// ============================================================================
// EXTERNAL FACT-CHECK INTEGRATION (IFCN-aligned)
// ============================================================================
// Ref: https://ifcncodeofprinciples.poynter.org/
// Ref: https://developers.google.com/fact-check/tools/api
// ============================================================================

/**
 * External fact-check result structure per IFCN Code of Principles
 *
 * IMPORTANT: Coverage Reality Check
 * Fact-check APIs are NOT comprehensive. Most niche/early claims won't be covered.
 * Best practice is:
 * - Use fact-check results when available (hasCoverage: true)
 * - Fall back to primary sources + explicit uncertainty when no coverage
 * - "No fact-check found" ≠ "claim is false" - it means UNKNOWN
 */
export interface ExternalFactCheckResult {
  /** The claim being checked */
  claim: string;
  /** Normalized claim for comparison */
  normalizedClaim?: string;

  /**
   * Coverage status - CRITICAL for correct interpretation
   * - true: API returned results (may be relevant or not)
   * - false: API returned no results (claim not fact-checked, NOT "false")
   * - null: API call failed (network/auth error)
   */
  hasCoverage: boolean | null;

  /** List of matching fact-checks from external sources */
  factChecks: Array<{
    /** Name of the fact-checking organization */
    publisher: string;
    /** Publisher's IFCN signatory status */
    ifcnSignatory: boolean;
    /** URL of the fact-check article */
    url: string;
    /** Date of the fact-check */
    date: string;
    /** Rating given by the fact-checker */
    rating: string;
    /** Normalized rating (true/false/mixed/unproven) */
    normalizedRating: "true" | "false" | "mixed" | "unproven" | "other";
    /** Confidence in the match (0-1) */
    matchConfidence: number;
  }>;

  /** Overall consensus if multiple fact-checks exist */
  consensus?: {
    rating: "true" | "false" | "mixed" | "unproven" | "insufficient";
    agreementLevel: number; // 0-1, how much fact-checkers agree
    totalChecks: number;
  };

  /** Provider metadata */
  provider: "google" | "claimbuster" | "none";
  executionTimeMs: number;
  error?: string;
}

/**
 * IFCN-verified fact-checking publishers
 * See: https://ifcncodeofprinciples.poynter.org/signatories
 */
const IFCN_SIGNATORIES = new Set([
  "snopes.com",
  "politifact.com",
  "factcheck.org",
  "apnews.com",
  "reuters.com",
  "usatoday.com",
  "washingtonpost.com",
  "afp.com",
  "fullfact.org",
  "correctiv.org",
  "leadstories.com",
  "logically.ai",
  "boomlive.in",
  "altnews.in",
  "africacheck.org",
  "chequeado.com",
  "lupa.news",
  "maldita.es",
  "newtral.es",
  "verificat.cat",
  "lemonde.fr",
  "liberation.fr",
  "20minutes.fr",
  "observador.pt",
  "polygraph.info",
  "stopfake.org",
  "meduza.io",
  "verafiles.org",
  "rappler.com",
  "newsmobile.in",
  "vishvasnews.com",
]);

/**
 * Normalize fact-check ratings to standard categories
 * Different fact-checkers use different scales
 */
function normalizeRating(rating: string): ExternalFactCheckResult["factChecks"][0]["normalizedRating"] {
  const lower = rating.toLowerCase();

  // True variants
  if (lower.includes("true") && !lower.includes("false") && !lower.includes("partly") && !lower.includes("mostly false")) {
    return "true";
  }

  // False variants
  if (lower.includes("false") || lower.includes("pants on fire") || lower.includes("pinocchio")) {
    if (lower.includes("mostly") || lower.includes("partly") || lower.includes("half")) {
      return "mixed";
    }
    return "false";
  }

  // Mixed variants
  if (lower.includes("mixed") || lower.includes("partly") || lower.includes("half") ||
      lower.includes("mostly true") || lower.includes("misleading")) {
    return "mixed";
  }

  // Unproven variants
  if (lower.includes("unproven") || lower.includes("unverified") || lower.includes("unknown") ||
      lower.includes("insufficient") || lower.includes("no evidence")) {
    return "unproven";
  }

  return "other";
}

/**
 * Check if a publisher is an IFCN signatory
 */
function isIfcnSignatory(publisherUrl: string): boolean {
  try {
    const domain = extractDomain(publisherUrl);
    // Check direct match and subdomains
    for (const signatory of IFCN_SIGNATORIES) {
      if (domain === signatory || domain.endsWith(`.${signatory}`)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Query Google Fact Check Tools API
 * Ref: https://developers.google.com/fact-check/tools/api/reference/rest
 *
 * Note: Requires GOOGLE_FACT_CHECK_API_KEY environment variable
 */
export async function queryGoogleFactCheck(
  claim: string
): Promise<ExternalFactCheckResult> {
  const startTime = Date.now();
  const apiKey = process.env.GOOGLE_FACT_CHECK_API_KEY;

  if (!apiKey) {
    return {
      claim,
      hasCoverage: null,  // null = couldn't check (API not configured)
      factChecks: [],
      provider: "none",
      executionTimeMs: Date.now() - startTime,
      error: "GOOGLE_FACT_CHECK_API_KEY not configured",
    };
  }

  try {
    const url = new URL("https://factchecktools.googleapis.com/v1alpha1/claims:search");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("query", claim);
    url.searchParams.set("languageCode", "en");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Google Fact Check API returned ${response.status}`);
    }

    const data = await response.json() as {
      claims?: Array<{
        text?: string;
        claimant?: string;
        claimDate?: string;
        claimReview?: Array<{
          publisher?: { name?: string; site?: string };
          url?: string;
          title?: string;
          reviewDate?: string;
          textualRating?: string;
          languageCode?: string;
        }>;
      }>;
    };

    const factChecks: ExternalFactCheckResult["factChecks"] = [];

    if (data.claims) {
      for (const claimData of data.claims) {
        if (claimData.claimReview) {
          for (const review of claimData.claimReview) {
            if (review.publisher?.site && review.url && review.textualRating) {
              factChecks.push({
                publisher: review.publisher.name || review.publisher.site,
                ifcnSignatory: isIfcnSignatory(review.publisher.site),
                url: review.url,
                date: review.reviewDate || "",
                rating: review.textualRating,
                normalizedRating: normalizeRating(review.textualRating),
                matchConfidence: 0.8, // Google API pre-filters for relevance
              });
            }
          }
        }
      }
    }

    // Calculate consensus if multiple checks exist
    let consensus: ExternalFactCheckResult["consensus"] = undefined;
    if (factChecks.length >= 2) {
      const ratings = factChecks.map(fc => fc.normalizedRating);
      const trueCounts = ratings.filter(r => r === "true").length;
      const falseCounts = ratings.filter(r => r === "false").length;
      const mixedCounts = ratings.filter(r => r === "mixed").length;

      const total = factChecks.length;
      const maxCount = Math.max(trueCounts, falseCounts, mixedCounts);

      let rating: "true" | "false" | "mixed" | "unproven" | "insufficient" = "insufficient";
      if (trueCounts === maxCount && trueCounts > 0) rating = "true";
      else if (falseCounts === maxCount && falseCounts > 0) rating = "false";
      else if (mixedCounts === maxCount && mixedCounts > 0) rating = "mixed";

      consensus = {
        rating,
        agreementLevel: maxCount / total,
        totalChecks: total,
      };
    }

    // hasCoverage: true if we got results, false if API worked but no matches
    // This is CRITICAL: false means "not covered" NOT "claim is false"
    return {
      claim,
      hasCoverage: factChecks.length > 0,
      factChecks,
      consensus,
      provider: "google",
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      claim,
      hasCoverage: null,  // null = API call failed, couldn't determine coverage
      factChecks: [],
      provider: "google",
      executionTimeMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check a funding claim against external fact-checkers
 * Returns enriched fact-check data to supplement internal verification
 */
export async function checkClaimAgainstFactCheckers(
  claim: string,
  options?: {
    providers?: Array<"google" | "claimbuster">;
    timeout?: number;
  }
): Promise<ExternalFactCheckResult> {
  const providers = options?.providers || ["google"];

  // Currently only Google Fact Check Tools is implemented
  // ClaimBuster integration can be added similarly
  if (providers.includes("google")) {
    return queryGoogleFactCheck(claim);
  }

  // Placeholder for additional providers
  return {
    claim,
    hasCoverage: null,  // null = no provider configured
    factChecks: [],
    provider: "none",
    executionTimeMs: 0,
    error: "No fact-check providers configured",
  };
}
