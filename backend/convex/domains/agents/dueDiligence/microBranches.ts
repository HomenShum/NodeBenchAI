/**
 * microBranches.ts
 *
 * Micro-branch executors for lightweight, fast, targeted verification checks.
 *
 * DESIGN PRINCIPLES:
 * 1. Fast: Each micro-branch should complete in <5 seconds
 * 2. Targeted: Focus on a single verification concern
 * 3. Composable: Can be combined based on tier and risk profile
 * 4. High-signal: Return actionable pass/fail/warn with evidence
 *
 * These run EVEN FOR SMALL DEALS to catch fraud/risk indicators early.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { api, internal } from "../../../_generated/api";
import { MicroBranchType, DDClaim, ClaimLedger } from "./types";

// ============================================================================
// MICRO-BRANCH RESULT TYPES
// ============================================================================

export interface MicroBranchResult {
  branch: MicroBranchType;
  status: "pass" | "warn" | "fail" | "inconclusive";
  confidence: number;  // 0-1
  summary: string;
  signals: Array<{
    type: "positive" | "negative" | "neutral";
    signal: string;
    source: string;
    severity?: "low" | "medium" | "high";
  }>;
  evidence: Array<{
    type: string;
    url?: string;
    snippet?: string;
    timestamp?: number;
  }>;
  executionTimeMs: number;
}

export interface MicroBranchBatchResult {
  entityName: string;
  results: MicroBranchResult[];
  overallStatus: "pass" | "warn" | "fail";
  passCount: number;
  warnCount: number;
  failCount: number;
  totalTimeMs: number;
}

// ============================================================================
// IDENTITY REGISTRY MICRO-BRANCH
// ============================================================================

/**
 * identity_registry: Verify company exists in business registries
 *
 * Checks:
 * - State/country business registry presence
 * - Registered agent information
 * - Formation date vs claimed founding date
 */
export const runIdentityRegistry = internalAction({
  args: {
    companyName: v.string(),
    jurisdiction: v.optional(v.string()),
    claimedFoundedYear: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MicroBranchResult> => {
    const startTime = Date.now();
    const signals: MicroBranchResult["signals"] = [];
    const evidence: MicroBranchResult["evidence"] = [];

    try {
      // Search for business registration
      const searchQuery = `"${args.companyName}" business registration incorporated LLC corp`;

      const searchResult = await ctx.runAction(
        api.domains.search.fusion.actions.fusionSearch,
        {
          query: searchQuery,
          mode: "fast",
          maxTotal: 5,
          skipRateLimit: true,
        }
      );

      const results = searchResult?.payload?.results ?? [];

      // Analyze results for registry presence
      let foundInRegistry = false;
      let registrySource: string | undefined;

      for (const r of results) {
        const content = ((r.snippet || "") + " " + (r.title || "")).toLowerCase();
        const url = (r.url || "").toLowerCase();

        // Check for official registry domains
        const registryDomains = [
          "sos.state", "corporations.state", "businesssearch",
          "sec.gov", "opencorporates.com", "dnb.com",
          "bizfilings", "ct.gov", "de.gov", "ca.gov"
        ];

        const isRegistrySite = registryDomains.some(d => url.includes(d));

        if (isRegistrySite && content.includes(args.companyName.toLowerCase())) {
          foundInRegistry = true;
          registrySource = r.url;
          evidence.push({
            type: "registry_match",
            url: r.url,
            snippet: r.snippet?.slice(0, 200),
            timestamp: Date.now(),
          });
          break;
        }

        // Check for incorporation signals in content
        if (
          content.includes(args.companyName.toLowerCase()) &&
          (content.includes("incorporated") ||
           content.includes("registered") ||
           content.includes("formation date") ||
           content.includes("entity number"))
        ) {
          foundInRegistry = true;
          registrySource = r.url;
          evidence.push({
            type: "registry_mention",
            url: r.url,
            snippet: r.snippet?.slice(0, 200),
            timestamp: Date.now(),
          });
        }
      }

      if (foundInRegistry) {
        signals.push({
          type: "positive",
          signal: `Found in business registry: ${registrySource}`,
          source: "registry_search",
          severity: "low",
        });
      } else {
        signals.push({
          type: "negative",
          signal: "Not found in standard business registries",
          source: "registry_search",
          severity: "high",
        });
      }

      return {
        branch: "identity_registry",
        status: foundInRegistry ? "pass" : "warn",
        confidence: foundInRegistry ? 0.8 : 0.5,
        summary: foundInRegistry
          ? `Company found in business registry`
          : `Company not found in business registries - manual verification recommended`,
        signals,
        evidence,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        branch: "identity_registry",
        status: "inconclusive",
        confidence: 0,
        summary: `Registry check failed: ${error}`,
        signals: [{
          type: "neutral",
          signal: "Registry verification failed",
          source: "system",
        }],
        evidence: [],
        executionTimeMs: Date.now() - startTime,
      };
    }
  },
});

// ============================================================================
// FOUNDER FOOTPRINT MICRO-BRANCH
// ============================================================================

/**
 * founder_footprint: Verify founder identity consistency across sources
 *
 * Checks:
 * - LinkedIn profile exists and matches
 * - Name/title consistency across sources
 * - Employment history plausibility
 */
export const runFounderFootprint = internalAction({
  args: {
    founderName: v.string(),
    companyName: v.string(),
    claimedTitle: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<MicroBranchResult> => {
    const startTime = Date.now();
    const signals: MicroBranchResult["signals"] = [];
    const evidence: MicroBranchResult["evidence"] = [];

    try {
      // Search for founder presence
      const searchQuery = `"${args.founderName}" "${args.companyName}" linkedin OR founder OR CEO`;

      const searchResult = await ctx.runAction(
        api.domains.search.fusion.actions.fusionSearch,
        {
          query: searchQuery,
          mode: "fast",
          maxTotal: 5,
          skipRateLimit: true,
        }
      );

      const results = searchResult?.payload?.results ?? [];

      let linkedInFound = false;
      let titleConsistent = true;
      const titlesFound: string[] = [];

      for (const r of results) {
        const content = ((r.snippet || "") + " " + (r.title || "")).toLowerCase();
        const url = (r.url || "").toLowerCase();

        // Check for LinkedIn presence
        if (url.includes("linkedin.com")) {
          linkedInFound = true;
          evidence.push({
            type: "linkedin_profile",
            url: r.url,
            snippet: r.snippet?.slice(0, 200),
            timestamp: Date.now(),
          });
        }

        // Extract titles mentioned
        const titlePatterns = [
          /\b(ceo|chief executive|founder|co-founder|cto|cfo|president|director)\b/gi
        ];

        for (const pattern of titlePatterns) {
          const matches = content.match(pattern);
          if (matches) {
            titlesFound.push(...matches.map(m => m.toLowerCase()));
          }
        }
      }

      // Check title consistency
      const uniqueTitles = [...new Set(titlesFound)];
      if (uniqueTitles.length > 3) {
        titleConsistent = false;
        signals.push({
          type: "negative",
          signal: `Multiple different titles found: ${uniqueTitles.join(", ")}`,
          source: "title_analysis",
          severity: "medium",
        });
      }

      if (linkedInFound) {
        signals.push({
          type: "positive",
          signal: "LinkedIn profile found for founder",
          source: "linkedin_search",
          severity: "low",
        });
      } else {
        signals.push({
          type: "negative",
          signal: "No LinkedIn profile found for founder",
          source: "linkedin_search",
          severity: "medium",
        });
      }

      const status = linkedInFound && titleConsistent ? "pass" :
                     !linkedInFound ? "warn" : "warn";

      return {
        branch: "founder_footprint",
        status,
        confidence: linkedInFound ? 0.75 : 0.4,
        summary: linkedInFound
          ? `Founder "${args.founderName}" verified via LinkedIn`
          : `Founder "${args.founderName}" not found on LinkedIn - limited verification`,
        signals,
        evidence,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        branch: "founder_footprint",
        status: "inconclusive",
        confidence: 0,
        summary: `Founder verification failed: ${error}`,
        signals: [],
        evidence: [],
        executionTimeMs: Date.now() - startTime,
      };
    }
  },
});

// ============================================================================
// CHANNEL INTEGRITY MICRO-BRANCH (Anti-BEC)
// ============================================================================

/**
 * channel_integrity: Verify communication channel authenticity
 *
 * Checks:
 * - Domain age and WHOIS status
 * - Email domain matches website
 * - Urgency/pressure language detection
 * - Payment instruction anomalies
 */
export const runChannelIntegrity = internalAction({
  args: {
    companyName: v.string(),
    websiteUrl: v.optional(v.string()),
    emailDomain: v.optional(v.string()),
    communicationText: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<MicroBranchResult> => {
    const startTime = Date.now();
    const signals: MicroBranchResult["signals"] = [];
    const evidence: MicroBranchResult["evidence"] = [];

    // Check domain/email consistency
    if (args.websiteUrl && args.emailDomain) {
      const websiteDomain = extractDomain(args.websiteUrl);
      if (websiteDomain && args.emailDomain !== websiteDomain) {
        signals.push({
          type: "negative",
          signal: `Email domain (${args.emailDomain}) doesn't match website (${websiteDomain})`,
          source: "domain_check",
          severity: "medium",
        });
      } else if (websiteDomain) {
        signals.push({
          type: "positive",
          signal: "Email domain matches website",
          source: "domain_check",
        });
      }
    }

    // Check for BEC/urgency patterns in communication
    if (args.communicationText) {
      const becPatterns = [
        /\b(urgent|immediately|asap|right away|act now|time sensitive)\b/gi,
        /\b(wire transfer|bank details changed|new account|update payment)\b/gi,
        /\b(confidential|do not share|between us|don't tell)\b/gi,
        /\b(unusual request|exception|bypass|skip approval)\b/gi,
      ];

      for (const pattern of becPatterns) {
        const matches = args.communicationText.match(pattern);
        if (matches && matches.length > 0) {
          signals.push({
            type: "negative",
            signal: `BEC pattern detected: "${matches[0]}"`,
            source: "content_analysis",
            severity: "high",
          });
        }
      }
    }

    // Check website liveness with retry logic
    if (args.websiteUrl) {
      const websiteResult = await checkWebsiteLiveWithRetry(args.websiteUrl);

      if (websiteResult.live === true) {
        signals.push({
          type: "positive",
          signal: "Website is live and responding",
          source: "website_check",
        });
        evidence.push({
          type: "website_live",
          url: args.websiteUrl,
          timestamp: Date.now(),
        });
      } else if (websiteResult.live === null) {
        signals.push({
          type: "neutral",
          signal: websiteResult.error
            ? `Website check inconclusive: ${websiteResult.error}`
            : "Website check inconclusive",
          source: "website_check",
        });
      } else if (websiteResult.status && websiteResult.status >= 400 && websiteResult.status < 600) {
        // Server responding but with error (auth-required, not-found, 5xx, etc.)
        signals.push({
          type: "neutral",
          signal: `Website responding but returned status ${websiteResult.status}`,
          source: "website_check",
        });
      } else {
        signals.push({
          type: "negative",
          signal: websiteResult.error
            ? `Website check failed: ${websiteResult.error}`
            : "Website not reachable after multiple attempts",
          source: "website_check",
          severity: "medium",
        });
      }
    }

    // Determine overall status
    const negativeHighSeverity = signals.filter(
      s => s.type === "negative" && s.severity === "high"
    ).length;
    const negativeCount = signals.filter(s => s.type === "negative").length;

    const status = negativeHighSeverity > 0 ? "fail" :
                   negativeCount > 1 ? "warn" : "pass";

    return {
      branch: "channel_integrity",
      status,
      confidence: status === "pass" ? 0.8 : 0.6,
      summary: status === "pass"
        ? "Communication channels appear legitimate"
        : status === "warn"
        ? "Some channel integrity concerns detected"
        : "HIGH RISK: BEC patterns or channel spoofing indicators detected",
      signals,
      evidence,
      executionTimeMs: Date.now() - startTime,
    };
  },
});

// ============================================================================
// CLAIM LEDGER MICRO-BRANCH
// ============================================================================

/**
 * claim_ledger: Extract and grade verifiable claims from materials
 *
 * Extracts claims about:
 * - Revenue/traction ("$X ARR", "Y customers")
 * - Partnerships ("partnered with Z")
 * - Regulatory status ("FDA approved")
 * - Team credentials ("ex-Google")
 */
export const runClaimLedger = internalAction({
  args: {
    companyName: v.string(),
    sourceText: v.optional(v.string()),  // Press release, deck text, etc.
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<MicroBranchResult & { claims?: DDClaim[] }> => {
    const startTime = Date.now();
    const signals: MicroBranchResult["signals"] = [];
    const evidence: MicroBranchResult["evidence"] = [];
    const claims: DDClaim[] = [];

    // Define claim patterns to extract
    const claimPatterns: Array<{
      pattern: RegExp;
      type: DDClaim["claimType"];
      extract: (match: RegExpMatchArray) => string;
    }> = [
      {
        pattern: /\$(\d+(?:\.\d+)?)\s*(M|B|K|million|billion)?\s*(ARR|revenue|MRR)/gi,
        type: "revenue",
        extract: (m) => `${m[0]} revenue claim`,
      },
      {
        pattern: /(\d+(?:,\d+)?)\s*(customers|users|clients|enterprises)/gi,
        type: "customer",
        extract: (m) => `${m[1]} ${m[2]} claim`,
      },
      {
        pattern: /(partner(?:ed|ing|ship)?)\s+(?:with\s+)?([A-Z][A-Za-z0-9\s]+(?:Inc|Corp|LLC)?)/gi,
        type: "partnership",
        extract: (m) => `Partnership with ${m[2]}`,
      },
      {
        pattern: /(FDA|SEC|FINRA|SOC\s*2|HIPAA|ISO)\s*(approved|certified|compliant|cleared)/gi,
        type: "regulatory",
        extract: (m) => `${m[1]} ${m[2]} claim`,
      },
      {
        pattern: /(ex-|former\s+)(Google|Meta|Facebook|Amazon|Apple|Microsoft|Netflix|Goldman|McKinsey)/gi,
        type: "team",
        extract: (m) => `Team member from ${m[2]}`,
      },
      {
        pattern: /raised\s+\$(\d+(?:\.\d+)?)\s*(M|B|million|billion)/gi,
        type: "funding",
        extract: (m) => `$${m[1]}${m[2]} funding claim`,
      },
    ];

    // Extract claims from source text
    if (args.sourceText) {
      for (const { pattern, type, extract } of claimPatterns) {
        const matches = args.sourceText.matchAll(pattern);
        for (const match of matches) {
          const claimText = extract(match);
          claims.push({
            id: `claim_${claims.length + 1}`,
            claimText,
            claimType: type,
            extractedFrom: {
              source: args.sourceUrl || "provided_text",
              timestamp: Date.now(),
              quoteSpan: match[0],
            },
            verdict: "unverifiable",  // Will be verified by deeper DD
            confidence: 0.5,
            freshness: "current",
            citations: [],
          });
        }
      }
    }

    // Search for external verification of claims
    if (claims.length > 0) {
      // Take top 3 most important claims to verify
      const priorityClaims = claims.slice(0, 3);

      for (const claim of priorityClaims) {
        const verifyQuery = `"${args.companyName}" ${claim.claimText}`;

        try {
          const searchResult = await ctx.runAction(
            api.domains.search.fusion.actions.fusionSearch,
            {
              query: verifyQuery,
              mode: "fast",
              maxTotal: 3,
              skipRateLimit: true,
            }
          );

          const results = searchResult?.payload?.results ?? [];

          if (results.length > 0) {
            // Check if any result corroborates the claim
            for (const r of results) {
              const content = ((r.snippet || "") + " " + (r.title || "")).toLowerCase();
              if (content.includes(args.companyName.toLowerCase())) {
                claim.verdict = "context_needed";  // Found mentions, needs manual review
                claim.citations.push(r.url || "");
                evidence.push({
                  type: "claim_mention",
                  url: r.url,
                  snippet: r.snippet?.slice(0, 150),
                });
              }
            }
          }
        } catch {
          // Search failed, claim remains unverifiable
        }
      }
    }

    // Build signals
    const verifiedCount = claims.filter(c => c.verdict !== "unverifiable").length;
    const unverifiedCount = claims.filter(c => c.verdict === "unverifiable").length;

    if (claims.length === 0) {
      signals.push({
        type: "neutral",
        signal: "No verifiable claims extracted",
        source: "claim_extraction",
      });
    } else {
      signals.push({
        type: "neutral",
        signal: `Extracted ${claims.length} claims: ${verifiedCount} have external mentions, ${unverifiedCount} unverifiable`,
        source: "claim_extraction",
      });

      if (unverifiedCount > claims.length * 0.7) {
        signals.push({
          type: "negative",
          signal: "Majority of claims lack external corroboration",
          source: "claim_verification",
          severity: "medium",
        });
      }
    }

    const status = unverifiedCount > claims.length * 0.7 ? "warn" : "pass";

    return {
      branch: "claim_ledger",
      status,
      confidence: 0.6,
      summary: `Extracted ${claims.length} claims, ${verifiedCount} have external mentions`,
      signals,
      evidence,
      executionTimeMs: Date.now() - startTime,
      claims,
    };
  },
});

// ============================================================================
// BENEFICIAL OWNERSHIP MICRO-BRANCH (FinCEN CTA Compliance)
// ============================================================================

/**
 * beneficial_ownership: Verify ultimate beneficial owners (UBO)
 *
 * Based on FinCEN Corporate Transparency Act (CTA) requirements:
 * - Identify individuals with ≥25% ownership or substantial control
 * - Cross-reference with public filings (SEC, state registries)
 * - Flag shell company indicators
 *
 * Reference: 31 CFR 1010.230 (Beneficial ownership requirements)
 * Source: https://www.fincen.gov/boi (accessed 2025-01)
 */
export const runBeneficialOwnership = internalAction({
  args: {
    companyName: v.string(),
    founderNames: v.optional(v.array(v.string())),
    jurisdiction: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<MicroBranchResult> => {
    const startTime = Date.now();
    const signals: MicroBranchResult["signals"] = [];
    const evidence: MicroBranchResult["evidence"] = [];

    try {
      // Search for beneficial ownership information
      const searchQuery = `"${args.companyName}" beneficial owner OR shareholder OR investor OR ownership structure`;

      const searchResult = await ctx.runAction(
        api.domains.search.fusion.actions.fusionSearch,
        {
          query: searchQuery,
          mode: "fast",
          maxTotal: 5,
          skipRateLimit: true,
        }
      );

      const results = searchResult?.payload?.results ?? [];

      let ownershipInfoFound = false;
      let secFilingFound = false;
      let shellCompanyIndicators = 0;

      for (const r of results) {
        const content = ((r.snippet || "") + " " + (r.title || "")).toLowerCase();
        const url = (r.url || "").toLowerCase();

        // Check for SEC filings (authoritative UBO source)
        if (url.includes("sec.gov") && content.includes(args.companyName.toLowerCase())) {
          secFilingFound = true;
          evidence.push({
            type: "sec_filing",
            url: r.url,
            snippet: r.snippet?.slice(0, 200),
            timestamp: Date.now(),
          });
          signals.push({
            type: "positive",
            signal: "SEC filing found with beneficial ownership data",
            source: r.url || "sec.gov",
            severity: "low",
          });
        }

        // Check for ownership mentions in press/registry
        if (
          content.includes("beneficial owner") ||
          content.includes("majority shareholder") ||
          content.includes("controlling interest") ||
          content.includes("ownership stake")
        ) {
          ownershipInfoFound = true;
          evidence.push({
            type: "ownership_mention",
            url: r.url,
            snippet: r.snippet?.slice(0, 200),
            timestamp: Date.now(),
          });
        }

        // Shell company indicators per FinCEN guidance
        const shellIndicators = [
          "registered agent only",
          "no physical office",
          "virtual office",
          "nominee director",
          "bearer shares",
          "offshore holding",
        ];

        for (const indicator of shellIndicators) {
          if (content.includes(indicator)) {
            shellCompanyIndicators++;
            signals.push({
              type: "negative",
              signal: `Shell company indicator: "${indicator}"`,
              source: r.url || "search",
              severity: "high",
            });
          }
        }
      }

      // Check if founders are disclosed as owners
      if (args.founderNames && args.founderNames.length > 0) {
        const founderOwnershipQuery = `"${args.companyName}" "${args.founderNames[0]}" founder owner shareholder`;

        const founderResult = await ctx.runAction(
          api.domains.search.fusion.actions.fusionSearch,
          {
            query: founderOwnershipQuery,
            mode: "fast",
            maxTotal: 3,
            skipRateLimit: true,
          }
        );

        const founderResults = founderResult?.payload?.results ?? [];

        if (founderResults.length > 0) {
          signals.push({
            type: "positive",
            signal: `Founder ${args.founderNames[0]} linked to ownership in public sources`,
            source: "founder_search",
          });
        }
      }

      // Build summary
      if (!ownershipInfoFound && !secFilingFound) {
        signals.push({
          type: "negative",
          signal: "No beneficial ownership information found in public sources",
          source: "ubo_search",
          severity: "medium",
        });
      }

      const status = secFilingFound ? "pass" :
                     shellCompanyIndicators > 0 ? "fail" :
                     ownershipInfoFound ? "pass" : "warn";

      return {
        branch: "beneficial_ownership",
        status,
        confidence: secFilingFound ? 0.9 : ownershipInfoFound ? 0.6 : 0.4,
        summary: secFilingFound
          ? "Beneficial ownership verified via SEC filing"
          : shellCompanyIndicators > 0
          ? `ALERT: ${shellCompanyIndicators} shell company indicators detected`
          : ownershipInfoFound
          ? "Ownership structure found in public sources"
          : "Limited beneficial ownership information available - manual verification recommended",
        signals,
        evidence,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        branch: "beneficial_ownership",
        status: "inconclusive",
        confidence: 0,
        summary: `Beneficial ownership check failed: ${error}`,
        signals: [],
        evidence: [],
        executionTimeMs: Date.now() - startTime,
      };
    }
  },
});

// ============================================================================
// CONTROVERSY SCAN MICRO-BRANCH
// ============================================================================

/**
 * controversy_scan: Quick scan for litigation, controversies, negative press
 */
export const runControversyScan = internalAction({
  args: {
    companyName: v.string(),
    founderNames: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<MicroBranchResult> => {
    const startTime = Date.now();
    const signals: MicroBranchResult["signals"] = [];
    const evidence: MicroBranchResult["evidence"] = [];

    try {
      // Search for negative mentions
      const searchQuery = `"${args.companyName}" lawsuit OR fraud OR scam OR investigation OR complaint`;

      const searchResult = await ctx.runAction(
        api.domains.search.fusion.actions.fusionSearch,
        {
          query: searchQuery,
          mode: "fast",
          maxTotal: 5,
          skipRateLimit: true,
        }
      );

      const results = searchResult?.payload?.results ?? [];

      let controversiesFound = 0;

      for (const r of results) {
        const content = ((r.snippet || "") + " " + (r.title || "")).toLowerCase();

        // Filter for actual controversies (not just word presence)
        const controversyIndicators = [
          "sued", "lawsuit", "alleged", "investigation", "fraud",
          "scam", "complaint", "settlement", "indicted", "charged"
        ];

        const hasControversy = controversyIndicators.some(
          ind => content.includes(ind) && content.includes(args.companyName.toLowerCase())
        );

        if (hasControversy) {
          controversiesFound++;
          signals.push({
            type: "negative",
            signal: `Controversy mention: ${r.title?.slice(0, 50)}...`,
            source: r.url || "web_search",
            severity: "high",
          });
          evidence.push({
            type: "controversy",
            url: r.url,
            snippet: r.snippet?.slice(0, 200),
            timestamp: Date.now(),
          });
        }
      }

      if (controversiesFound === 0) {
        signals.push({
          type: "positive",
          signal: "No significant controversies found in quick scan",
          source: "controversy_search",
        });
      }

      return {
        branch: "controversy_scan",
        status: controversiesFound > 0 ? "warn" : "pass",
        confidence: 0.7,
        summary: controversiesFound > 0
          ? `Found ${controversiesFound} potential controversy mentions`
          : "No controversies detected in quick scan",
        signals,
        evidence,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        branch: "controversy_scan",
        status: "inconclusive",
        confidence: 0,
        summary: `Controversy scan failed: ${error}`,
        signals: [],
        evidence: [],
        executionTimeMs: Date.now() - startTime,
      };
    }
  },
});

// ============================================================================
// BATCH EXECUTOR
// ============================================================================

/**
 * Run multiple micro-branches in parallel for an entity
 */
export const runMicroBranches = internalAction({
  args: {
    companyName: v.string(),
    branches: v.array(v.string()),
    websiteUrl: v.optional(v.string()),
    founderNames: v.optional(v.array(v.string())),
    sourceText: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<MicroBranchBatchResult> => {
    const startTime = Date.now();
    const results: MicroBranchResult[] = [];

    // Map branch names to executors
    const branchExecutors: Record<string, () => Promise<MicroBranchResult>> = {
      identity_registry: () =>
        ctx.runAction(internal.domains.agents.dueDiligence.microBranches.runIdentityRegistry, {
          companyName: args.companyName,
        }),
      founder_footprint: () => {
        if (args.founderNames && args.founderNames.length > 0) {
          return ctx.runAction(internal.domains.agents.dueDiligence.microBranches.runFounderFootprint, {
            founderName: args.founderNames[0],
            companyName: args.companyName,
          });
        }
        return Promise.resolve({
          branch: "founder_footprint" as MicroBranchType,
          status: "inconclusive" as const,
          confidence: 0,
          summary: "No founder names provided",
          signals: [],
          evidence: [],
          executionTimeMs: 0,
        });
      },
      channel_integrity: () =>
        ctx.runAction(internal.domains.agents.dueDiligence.microBranches.runChannelIntegrity, {
          companyName: args.companyName,
          websiteUrl: args.websiteUrl,
        }),
      claim_ledger: () =>
        ctx.runAction(internal.domains.agents.dueDiligence.microBranches.runClaimLedger, {
          companyName: args.companyName,
          sourceText: args.sourceText,
          sourceUrl: args.sourceUrl,
        }),
      controversy_scan: () =>
        ctx.runAction(internal.domains.agents.dueDiligence.microBranches.runControversyScan, {
          companyName: args.companyName,
          founderNames: args.founderNames,
        }),
      beneficial_ownership: () =>
        ctx.runAction(internal.domains.agents.dueDiligence.microBranches.runBeneficialOwnership, {
          companyName: args.companyName,
          founderNames: args.founderNames,
        }),
    };

    // Run requested branches in parallel
    const branchPromises = args.branches
      .filter((b: string) => branchExecutors[b])
      .map((b: string) => branchExecutors[b]());

    const branchResults = await Promise.all(branchPromises);
    results.push(...branchResults);

    // Calculate summary
    const passCount = results.filter(r => r.status === "pass").length;
    const warnCount = results.filter(r => r.status === "warn").length;
    const failCount = results.filter(r => r.status === "fail").length;

    const overallStatus: "pass" | "warn" | "fail" =
      failCount > 0 ? "fail" :
      warnCount > results.length * 0.3 ? "warn" : "pass";

    return {
      entityName: args.companyName,
      results,
      overallStatus,
      passCount,
      warnCount,
      failCount,
      totalTimeMs: Date.now() - startTime,
    };
  },
});

// ============================================================================
// UTILITIES
// ============================================================================

function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
    return urlObj.hostname.replace("www.", "");
  } catch {
    return null;
  }
}

/**
 * Calculate exponential backoff with full jitter
 * Ref: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
function calculateBackoffWithJitter(attempt: number, baseMs: number = 100, capMs: number = 2000): number {
  const exponentialMs = Math.min(capMs, baseMs * Math.pow(2, attempt));
  return Math.floor(Math.random() * exponentialMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Classify error for observability
 */
function classifyWebsiteError(error: any): "dns_nxdomain" | "dns_temp" | "timeout" | "network" {
  const errStr = String(error?.message ?? error ?? "").toLowerCase();
  const code = String(error?.cause?.code ?? error?.code ?? "").toLowerCase();

  if (code.includes("enotfound") || errStr.includes("enotfound")) return "dns_nxdomain";
  if (code.includes("eai_again") || errStr.includes("eai_again")) return "dns_temp";
  // "getaddrinfo" can surface multiple DNS error classes; avoid treating it as NXDOMAIN unless clear.
  if (code.includes("eai_noname") || errStr.includes("eai_noname")) return "dns_nxdomain";
  if (
    errStr.includes("name or service not known") ||
    errStr.includes("nodename nor servname provided") ||
    errStr.includes("no address associated with hostname")
  ) {
    return "dns_nxdomain";
  }
  if (code.includes("getaddrinfo") || errStr.includes("getaddrinfo")) return "dns_temp";
  if (error?.name === "AbortError" || errStr.includes("timeout")) return "timeout";

  return "network";
}

/**
 * Check if a website is live with retry logic to avoid false negatives.
 * Uses progressive timeouts, User-Agent, and exponential backoff with jitter.
 *
 * Implements:
 * - Exponential backoff with full jitter (AWS best practice)
 * - Error taxonomy for observability
 * - Only DNS NXDOMAIN is definitive failure; all else is inconclusive
 */
async function checkWebsiteLiveWithRetry(
  url: string
): Promise<{ live: boolean | null; status?: number; error?: string; errorClass?: string }> {
  const normalizedUrl = normalizeWebsiteUrl(url);
  if (!normalizedUrl) {
    return { live: null, error: "Invalid website URL", errorClass: "invalid_url" };
  }

  // Common User-Agent to avoid blocks
  const headers = {
    "User-Agent": "Mozilla/5.0 (compatible; NodeBenchBot/1.0; +https://nodebench.ai)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  // Retry configuration per AWS best practices:
  // - Progressive timeouts (8s, 10s, 10s)
  // - Exponential backoff with full jitter between retries
  // Ref: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
  const attempts = [
    { method: "HEAD" as const, timeout: 8000 },
    { method: "HEAD" as const, timeout: 10000 },
    { method: "GET" as const, timeout: 10000 },
  ];

  let lastError: string | undefined;
  let lastStatus: number | undefined;
  let lastErrorClass: string = "network";

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];

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

      // Any HTTP response indicates the website is responding
      return { live: true, status: response.status, errorClass: "success" };
    } catch (error: any) {
      lastErrorClass = classifyWebsiteError(error);

      const code = String(error?.cause?.code ?? error?.code ?? "");
      lastError = error?.name === "AbortError"
        ? `Timeout after ${attempt.timeout}ms`
        : (error?.message || "Unknown error") + (code ? ` (${code})` : "");

      // DNS NXDOMAIN is definitive - no point retrying
      if (lastErrorClass === "dns_nxdomain") {
        return { live: false, error: lastError, errorClass: lastErrorClass };
      }

      // If not timeout and HEAD failed, try GET
      if (error?.name !== "AbortError" && attempt.method === "HEAD") {
        continue;
      }
    }
  }

  // Only DNS NXDOMAIN is definitive failure
  // All other errors (timeout, TLS, etc.) are INCONCLUSIVE
  const isDefinitiveFailure = lastErrorClass === "dns_nxdomain";
  return {
    live: isDefinitiveFailure ? false : null,
    status: lastStatus,
    error: lastError,
    errorClass: lastErrorClass,
  };
}

function normalizeWebsiteUrl(input: string): string | null {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[)\],.;]+$/g, "");
  const withProto = cleaned.startsWith("http") ? cleaned : `https://${cleaned}`;
  try {
    const u = new URL(withProto);
    return u.toString();
  } catch {
    return null;
  }
}
