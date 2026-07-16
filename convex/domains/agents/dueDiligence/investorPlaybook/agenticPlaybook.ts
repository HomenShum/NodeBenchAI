/**
 * Agentic Investor Playbook
 *
 * Deep agent implementation following industry best practices:
 *
 * 1. PLAN PHASE (Anthropic pattern): Analyze query, extract claims, create verification plan
 * 2. EXECUTE PHASE (OpenAI pattern): Run parallel verification branches with handoffs
 * 3. VERIFY PHASE (Manus pattern): Cross-check findings, detect contradictions
 * 4. SYNTHESIZE PHASE (Google pattern): Iterative refinement, produce final report
 *
 * Handles natural language queries like:
 * "Full due diligence on mydentalwig company for me and see if it is a scam, they are requesting vc funding"
 *
 * Key patterns implemented:
 * - Claims extraction from natural language (Google Deep Research)
 * - Multi-agent parallel execution (OpenAI Agents SDK)
 * - Todo.md checkpoint pattern (Manus)
 * - Plan-before-execute (Anthropic best practice)
 * - End-to-end verification (Anthropic)
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../../_generated/server";
import { internal, api } from "../../../../_generated/api";
import type { Id } from "../../../../_generated/dataModel";

import {
  runInvestorPlaybook,
  generatePlaybookReport,
  PlaybookConfig,
} from "./playbookOrchestrator";

import { SecuritiesRegime, PlaybookComplexitySignals } from "./types";

// Import LLM for claims extraction
import { generateText } from "ai";
import { getLanguageModelSafe } from "../../mcp_tools/models/modelResolver";

// ============================================================================
// CLAIMS EXTRACTION (Google Deep Research Pattern)
// ============================================================================

interface ExtractedIntent {
  entityName: string;
  entityType: "company" | "fund" | "person";
  isScamCheck: boolean;
  isFundingRelated: boolean;

  // Extracted claims to verify
  claims: {
    state?: string;
    formationYear?: number;
    securitiesRegime?: SecuritiesRegime;
    fundingPortal?: string;
    fdaStatus?: string;
    patents?: string[];
    investors?: string[];
    revenue?: string;
    valuation?: string;
  };

  // Context signals
  signals: {
    urgencyDetected: boolean;
    wireInstructionsMentioned: boolean;
    cryptoMentioned: boolean;
    regulatoryMentioned: boolean;
    patentsMentioned: boolean;
  };

  // Raw context for reference
  rawQuery: string;
  additionalContext?: string;
}

const CLAIMS_EXTRACTION_PROMPT = `You are an expert at analyzing investment due diligence requests.

Given a user's natural language query about a company, extract structured information for verification.

IMPORTANT: Focus on identifying:
1. The company/entity name to investigate
2. Whether this is a scam check / fraud investigation
3. Whether funding/investment is involved
4. Any specific claims made about the company (FDA status, patents, revenue, etc.)
5. Any red flag signals (urgency, crypto payments, wire requests)

Return a JSON object with this structure:
{
  "entityName": "the company name to investigate",
  "entityType": "company" | "fund" | "person",
  "isScamCheck": true/false,
  "isFundingRelated": true/false,
  "claims": {
    "state": "incorporation state if mentioned",
    "formationYear": year if mentioned,
    "securitiesRegime": "Reg CF" | "Reg D 506(b)" | "Reg D 506(c)" | null,
    "fundingPortal": "portal name if mentioned",
    "fdaStatus": "FDA status claim if mentioned",
    "patents": ["patent numbers if mentioned"],
    "investors": ["investor names if mentioned"],
    "revenue": "revenue claim if mentioned",
    "valuation": "valuation claim if mentioned"
  },
  "signals": {
    "urgencyDetected": true/false,
    "wireInstructionsMentioned": true/false,
    "cryptoMentioned": true/false,
    "regulatoryMentioned": true/false,
    "patentsMentioned": true/false
  }
}

User query: {QUERY}

Additional context (if any): {CONTEXT}

Return ONLY the JSON object, no other text.`;

async function extractClaimsFromQuery(
  query: string,
  additionalContext?: string
): Promise<ExtractedIntent> {
  try {
    const prompt = CLAIMS_EXTRACTION_PROMPT
      .replace("{QUERY}", query)
      .replace("{CONTEXT}", additionalContext || "None provided");

    const model = await getLanguageModelSafe("qwen3-coder-free");

    const result = await generateText({
      model,
      prompt,
      maxTokens: 2000,
    } as Parameters<typeof generateText>[0]);

    // Parse JSON from response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      entityName: parsed.entityName || extractEntityNameFallback(query),
      entityType: parsed.entityType || "company",
      isScamCheck: parsed.isScamCheck ?? query.toLowerCase().includes("scam"),
      isFundingRelated: parsed.isFundingRelated ?? query.toLowerCase().includes("funding"),
      claims: {
        state: parsed.claims?.state,
        formationYear: parsed.claims?.formationYear,
        securitiesRegime: parsed.claims?.securitiesRegime,
        fundingPortal: parsed.claims?.fundingPortal,
        fdaStatus: parsed.claims?.fdaStatus,
        patents: parsed.claims?.patents,
        investors: parsed.claims?.investors,
        revenue: parsed.claims?.revenue,
        valuation: parsed.claims?.valuation,
      },
      signals: {
        urgencyDetected: parsed.signals?.urgencyDetected ?? false,
        wireInstructionsMentioned: parsed.signals?.wireInstructionsMentioned ?? false,
        cryptoMentioned: parsed.signals?.cryptoMentioned ?? false,
        regulatoryMentioned: parsed.signals?.regulatoryMentioned ?? false,
        patentsMentioned: parsed.signals?.patentsMentioned ?? false,
      },
      rawQuery: query,
      additionalContext,
    };

  } catch (error) {
    console.error("[AgenticPlaybook] Claims extraction error:", error);
    // Fallback to regex-based extraction
    return extractClaimsFallback(query, additionalContext);
  }
}

function extractEntityNameFallback(query: string): string {
  // Try to extract company name from common patterns
  const patterns = [
    /(?:on|about|for|check|investigate|diligence on)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)/i,
    /([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)\s+(?:company|inc|corp|llc)/i,
    /"([^"]+)"/,
    /'([^']+)'/,
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  // Last resort: find capitalized words
  const words = query.split(/\s+/);
  const capitalized = words.filter(w => /^[A-Z]/.test(w) && w.length > 2);
  if (capitalized.length > 0) {
    return capitalized.join(" ");
  }

  return "Unknown Entity";
}

function extractClaimsFallback(query: string, context?: string): ExtractedIntent {
  const queryLower = (query + " " + (context || "")).toLowerCase();

  // Extract entity name
  const entityName = extractEntityNameFallback(query);

  // Detect signals
  const signals = {
    urgencyDetected: /urgent|immediately|deadline|today|now|asap/i.test(queryLower),
    wireInstructionsMentioned: /wire|transfer|bank account|routing/i.test(queryLower),
    cryptoMentioned: /crypto|bitcoin|btc|ethereum|eth|usdt|wallet/i.test(queryLower),
    regulatoryMentioned: /fda|sec|finra|regulatory|approved|cleared/i.test(queryLower),
    patentsMentioned: /patent|us\s*\d{7,}|intellectual property/i.test(queryLower),
  };

  // Extract FDA status if mentioned
  let fdaStatus: string | undefined;
  if (/fda\s*cleared/i.test(queryLower)) fdaStatus = "FDA Cleared";
  else if (/fda\s*approved/i.test(queryLower)) fdaStatus = "FDA Approved";
  else if (/fda\s*registered/i.test(queryLower)) fdaStatus = "FDA Registered";

  // Extract patent numbers
  const patentMatches = queryLower.match(/us\s*(\d{7,10})/gi);
  const patents = patentMatches?.map(p => p.replace(/\s/g, "").toUpperCase());

  // Extract securities regime
  let securitiesRegime: SecuritiesRegime | undefined;
  if (/reg\s*cf|crowdfund/i.test(queryLower)) securitiesRegime = "Reg CF";
  else if (/reg\s*d|506\s*\(b\)/i.test(queryLower)) securitiesRegime = "Reg D 506(b)";
  else if (/506\s*\(c\)/i.test(queryLower)) securitiesRegime = "Reg D 506(c)";

  // Extract portal - comprehensive list of FINRA registered funding portals
  let fundingPortal: string | undefined;
  const portalPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /wefunder/i, name: "Wefunder" },
    { pattern: /republic/i, name: "Republic" },
    { pattern: /startengine/i, name: "StartEngine" },
    { pattern: /netcapital/i, name: "Netcapital" },
    { pattern: /picmii/i, name: "PicMii" },
    { pattern: /pic\s*mii/i, name: "PicMii" },
    { pattern: /fundable/i, name: "Fundable" },
    { pattern: /seedinvest/i, name: "SeedInvest" },
    { pattern: /mainvest/i, name: "MainVest" },
    { pattern: /honeycomb\s*credit/i, name: "Honeycomb Credit" },
    { pattern: /dealmaker/i, name: "DealMaker" },
    { pattern: /crowdfunder/i, name: "Crowdfunder" },
    { pattern: /microventures/i, name: "MicroVentures" },
    { pattern: /equifund/i, name: "Equifund" },
    { pattern: /trucrowd/i, name: "TruCrowd" },
    { pattern: /dalmore/i, name: "Dalmore" },
  ];
  for (const { pattern, name } of portalPatterns) {
    if (pattern.test(queryLower)) {
      fundingPortal = name;
      break;
    }
  }

  // Extract state
  let state: string | undefined;
  const stateMatch = queryLower.match(/\b(delaware|de|california|ca|new york|ny|texas|tx)\b/i);
  if (stateMatch) {
    const stateMap: Record<string, string> = {
      "delaware": "DE", "de": "DE",
      "california": "CA", "ca": "CA",
      "new york": "NY", "ny": "NY",
      "texas": "TX", "tx": "TX",
    };
    state = stateMap[stateMatch[1].toLowerCase()] || stateMatch[1].toUpperCase();
  }

  return {
    entityName,
    entityType: "company",
    isScamCheck: /scam|fraud|legit|legitimate|real|fake/i.test(queryLower),
    isFundingRelated: /funding|invest|vc|venture|raise|capital/i.test(queryLower),
    claims: {
      state,
      fdaStatus,
      patents,
      securitiesRegime,
      fundingPortal,
    },
    signals,
    rawQuery: query,
    additionalContext: context,
  };
}

// ============================================================================
// CONTEXT ENRICHMENT (Google Deep Research Pattern)
// ============================================================================

interface EnrichedContext {
  companyInfo?: {
    description?: string;
    website?: string;
    founded?: number;
    location?: string;
    employees?: string;
    industry?: string;
  };
  fundingInfo?: {
    lastRound?: string;
    totalRaised?: string;
    investors?: string[];
    valuation?: string;
  };
  claimsFromWeb?: {
    fdaStatus?: string;
    patents?: string[];
    products?: string[];
  };
  redFlagsFromWeb?: string[];
  fundingPortal?: string; // Detected from web search (e.g., "PicMii", "Wefunder")
}

async function enrichContextFromWeb(
  ctx: any,
  entityName: string
): Promise<EnrichedContext> {
  const enriched: EnrichedContext = {};

  try {
    // Search 1: General company info
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `"${entityName}" company funding investment SEC FDA patent`,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];
    const combinedContent = results.map((r: any) => r.snippet || "").join("\n");

    // Search 2: Targeted search for crowdfunding portal
    // This helps detect portals like PicMii that might not appear in general search
    const portalResult = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `"${entityName}" crowdfunding portal invest regulation crowdfunding`,
        mode: "fast",
        maxTotal: 5,
        skipRateLimit: true,
      }
    );

    const portalResults = portalResult?.payload?.results ?? [];
    const portalContent = portalResults.map((r: any) => `${r.url || ""} ${r.snippet || ""}`).join("\n");
    console.log(`[AgenticPlaybook] Portal search found ${portalResults.length} results`);

    // Extract company info
    enriched.companyInfo = {
      description: extractFirstSentence(combinedContent),
      industry: extractIndustry(combinedContent),
    };

    // Look for FDA claims in web content
    if (/fda\s*(cleared|approved|registered)/i.test(combinedContent)) {
      enriched.claimsFromWeb = enriched.claimsFromWeb || {};
      if (/fda\s*cleared/i.test(combinedContent)) {
        enriched.claimsFromWeb.fdaStatus = "FDA Cleared";
      } else if (/fda\s*approved/i.test(combinedContent)) {
        enriched.claimsFromWeb.fdaStatus = "FDA Approved";
      }
    }

    // Look for patent numbers
    const patentMatches = combinedContent.match(/US\s*\d{7,10}/gi);
    if (patentMatches) {
      enriched.claimsFromWeb = enriched.claimsFromWeb || {};
      enriched.claimsFromWeb.patents = [...new Set(patentMatches.map((p: string) => p.replace(/\s/g, "")))] as string[];
    }

    // Look for funding portal mentions in web content (both general and portal-specific search)
    const allContent = `${combinedContent}\n${portalContent}`;
    const allResults = [...results, ...portalResults];

    const portalPatterns: Array<{ pattern: RegExp; name: string }> = [
      { pattern: /picmii/i, name: "PicMii" },
      { pattern: /picmiicrowdfunding/i, name: "PicMii" },
      { pattern: /wefunder/i, name: "Wefunder" },
      { pattern: /republic\.com|republic crowdfund|opendeal/i, name: "Republic" },
      { pattern: /startengine/i, name: "StartEngine" },
      { pattern: /netcapital/i, name: "Netcapital" },
      { pattern: /fundable/i, name: "Fundable" },
      { pattern: /seedinvest/i, name: "SeedInvest" },
      { pattern: /mainvest/i, name: "MainVest" },
      { pattern: /honeycomb\s*credit/i, name: "Honeycomb Credit" },
      { pattern: /dealmaker/i, name: "DealMaker" },
      { pattern: /microventures/i, name: "MicroVentures" },
      { pattern: /equifund/i, name: "Equifund" },
      { pattern: /trucrowd/i, name: "TruCrowd" },
      { pattern: /dalmore/i, name: "Dalmore" },
    ];

    // Check content first
    for (const { pattern, name } of portalPatterns) {
      if (pattern.test(allContent)) {
        enriched.fundingPortal = name;
        console.log(`[AgenticPlaybook] Detected portal from content: ${name}`);
        break;
      }
    }

    // Also check URLs for portal domains (higher priority)
    const portalDomains: Array<{ domain: string; name: string }> = [
      { domain: "picmiicrowdfunding.com", name: "PicMii" },
      { domain: "picmii.com", name: "PicMii" },
      { domain: "wefunder.com", name: "Wefunder" },
      { domain: "startengine.com", name: "StartEngine" },
      { domain: "republic.com", name: "Republic" },
      { domain: "republic.co", name: "Republic" },
      { domain: "netcapital.com", name: "Netcapital" },
      { domain: "fundable.com", name: "Fundable" },
      { domain: "seedinvest.com", name: "SeedInvest" },
      { domain: "mainvest.com", name: "MainVest" },
      { domain: "honeycombcredit.com", name: "Honeycomb Credit" },
      { domain: "dealmaker.tech", name: "DealMaker" },
      { domain: "microventures.com", name: "MicroVentures" },
    ];

    for (const r of allResults) {
      const url = (r.url || "").toLowerCase();
      for (const { domain, name } of portalDomains) {
        if (url.includes(domain)) {
          enriched.fundingPortal = name;
          console.log(`[AgenticPlaybook] Detected portal from URL: ${name} (${url})`);
          break;
        }
      }
      if (enriched.fundingPortal) break;
    }

    // Look for red flags (use allContent which includes portal search results)
    const redFlags: string[] = [];

    // Context-aware scam detection to distinguish:
    // 1. Company is being accused of being a scam (REAL FLAG)
    // 2. Scammers are impersonating the company (FALSE POSITIVE for legitimate companies)
    const scamResult = detectScamMentions(allContent, entityName);
    if (scamResult.isDirectAccusation) {
      redFlags.push(`Scam/fraud accusations against entity: ${scamResult.context}`);
    } else if (scamResult.hasImpersonationWarnings) {
      // Don't flag - this is actually a sign of a legitimate company being impersonated
      console.log(`[AgenticPlaybook] Scam mentions found but appear to be impersonation warnings, not accusations against ${entityName}`);
    }

    if (/lawsuit|litigation|sued/i.test(allContent)) {
      redFlags.push("Legal issues mentioned");
    }

    // Ground truth pattern: Check for outsized promotional claims vs actual financials
    // Look for billion-dollar claims
    const billionClaims = allContent.match(/\$?\d+(?:\.\d+)?\s*(?:billion|B)/gi);
    const valuationClaim = allContent.match(/\$?\d+(?:\.\d+)?\s*(?:billion|B)\s*valuation/i);
    const revenueClaim = allContent.match(/revenue[:\s]+\$?([\d,.]+)/i);

    if (billionClaims && billionClaims.length > 0) {
      // Check for promotional red flags
      if (/\$200\s*billion|\$1\s*billion\s*valuation|smart\s*city|giga\s*factory/i.test(allContent)) {
        redFlags.push("Outsized promotional claims detected (billion-dollar projects/valuations)");
      }
      if (valuationClaim && revenueClaim) {
        const revValue = parseFloat(revenueClaim[1].replace(/,/g, ""));
        if (revValue < 100000) {
          redFlags.push(`Valuation vs revenue mismatch: Claims ${valuationClaim[0]} but revenue appears to be under $100k`);
        }
      }
    }

    // Check for press quality issues
    if (/los\s*angeles\s*tribune|press\s*release|prweb|pr\s*newswire/i.test(allContent)) {
      redFlags.push("Press coverage from potentially low-verification outlets (may be pay-to-publish)");
    }

    enriched.redFlagsFromWeb = redFlags;

    return enriched;

  } catch (error) {
    console.error("[AgenticPlaybook] Context enrichment error:", error);
    return {};
  }
}

function extractFirstSentence(text: string): string {
  const sentence = text.split(/[.!?]/)[0];
  return sentence.length > 200 ? sentence.slice(0, 200) + "..." : sentence;
}

function extractIndustry(text: string): string | undefined {
  const industries = [
    "healthcare", "biotech", "fintech", "medtech", "dental", "medical device",
    "software", "saas", "ai", "artificial intelligence", "crypto", "blockchain",
  ];
  for (const industry of industries) {
    if (text.toLowerCase().includes(industry)) {
      return industry.charAt(0).toUpperCase() + industry.slice(1);
    }
  }
  return undefined;
}

/**
 * Context-aware scam/fraud detection
 *
 * CRITICAL DISTINCTION:
 * 1. Scams ABOUT a company: "Scammers impersonating OpenAI" - FALSE POSITIVE for legitimate company
 * 2. Scams BY a company: "OpenAI is a scam" - REAL FLAG
 *
 * For well-known companies like OpenAI, Twitter, Meta, there are many articles warning about
 * scammers impersonating them. This should NOT flag the legitimate company.
 *
 * Detection patterns:
 * - IMPERSONATION (benign): "beware of scams using [company] name", "fake [company]", "scammers posing as [company]"
 * - DIRECT ACCUSATION (flag): "[company] is a scam", "SEC charges [company] with fraud"
 * - VICTIM CONTEXT (benign): "[company] warns users about scams", "[company] fighting fraud"
 */
interface ScamDetectionResult {
  hasAnyMention: boolean;
  isDirectAccusation: boolean;
  hasImpersonationWarnings: boolean;
  isCompanyFightingScams: boolean;
  context: string;
  confidence: "high" | "medium" | "low";
}

function detectScamMentions(content: string, entityName: string): ScamDetectionResult {
  const contentLower = content.toLowerCase();
  const entityLower = entityName.toLowerCase();

  // Check if there are any scam/fraud mentions at all
  const hasScamWord = /scam|fraud|ponzi|pyramid\s*scheme/i.test(content);
  if (!hasScamWord) {
    return {
      hasAnyMention: false,
      isDirectAccusation: false,
      hasImpersonationWarnings: false,
      isCompanyFightingScams: false,
      context: "",
      confidence: "high",
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KNOWN LEGITIMATE COMPANIES - Extra scrutiny for false positive prevention
  // ═══════════════════════════════════════════════════════════════════════════
  const knownLegitimateCompanies = [
    "openai", "microsoft", "google", "meta", "facebook", "twitter", "x",
    "apple", "amazon", "tesla", "nvidia", "vercel", "stripe", "coinbase",
    "robinhood", "netflix", "uber", "airbnb", "spotify", "slack",
  ];
  const isKnownLegitimate = knownLegitimateCompanies.some(c =>
    entityLower.includes(c) || c.includes(entityLower)
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPERSONATION WARNING PATTERNS (benign for the real company)
  // ═══════════════════════════════════════════════════════════════════════════
  const impersonationPatterns = [
    // Scammers using/impersonating company name
    /scam(?:s|mers?)?\s+(?:impersonat|pretend|pos|claim|using)\w*\s+/i,
    /(?:fake|phony|fraudulent)\s+(?:version|account|website|app|email)\s+(?:of\s+)?/i,
    /impersonat\w+\s+[^.]*(?:company|brand|account)/i,
    /(?:posing|pretending)\s+(?:as|to be)\s+/i,

    // Warning/alert articles
    /beware\s+(?:of\s+)?(?:fake|phishing|scam)/i,
    /scam\s+alert|warning.*scam|alert.*scam/i,
    /protect\s+yourself\s+from\s+scam/i,
    /how\s+to\s+(?:spot|avoid|identify|recognize)\s+[^.]*?scam/i,

    // Government warnings about impersonation scams
    /fcc|ftc|fbi|sec\s+warn(?:s|ing)?.*(?:scam|fraud)/i,
    /consumer\s+(?:alert|warning)/i,

    // Phishing scams
    /phishing\s+(?:scam|attack|email)/i,
    /scam\s+(?:email|text|message|call)/i,

    // Third-party scam reports
    /(?:report|reporting)\s+(?:a\s+)?scam/i,
    /scam(?:s)?\s+(?:that\s+)?(?:use|using)\s+[^.]*?name/i,
    /fake\s+[^.]*?\s+scam/i,
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPANY FIGHTING SCAMS PATTERNS (company is victim/defender)
  // ═══════════════════════════════════════════════════════════════════════════
  const companyFightingScamsPatterns = [
    new RegExp(`${entityLower}\\s+(?:warns?|alert|caution|advise)\\s+(?:users?|customers?|about)`, "i"),
    new RegExp(`${entityLower}\\s+(?:fighting|combating|cracking down|battling)\\s+(?:scam|fraud)`, "i"),
    new RegExp(`${entityLower}\\s+(?:report|announce).*(?:anti-fraud|security)`, "i"),
    new RegExp(`${entityLower}\\s+(?:takes? action|sues?)\\s+.*scam`, "i"),
    new RegExp(`${entityLower}\\s+(?:help|protect)\\s+(?:users?|customers?)\\s+(?:from|against)\\s+scam`, "i"),
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // DIRECT ACCUSATION PATTERNS (real flag)
  // ═══════════════════════════════════════════════════════════════════════════
  const directAccusationPatterns = [
    // "[Company] is a scam"
    new RegExp(`${entityLower}\\s+(?:is|was|are)\\s+(?:a\\s+)?(?:scam|fraud|ponzi|pyramid)`, "i"),
    // "[Company] scam" as accusation
    new RegExp(`${entityLower}\\s+(?:scam|fraud)(?:ulent)?(?:ly)?(?:\\s+scheme)?(?!.*(?:alert|warning|beware|impersonat|fake))`, "i"),
    // "Fraud by/from [Company]"
    new RegExp(`(?:scam|fraud|ponzi)\\s+(?:by|from|at|run by)\\s+${entityLower}`, "i"),
    // Legal actions
    new RegExp(`${entityLower}.*(?:sued|charged|indicted|accused).*(?:fraud|scam)`, "i"),
    new RegExp(`sec\\s+(?:charges|sues|accuses)\\s+${entityLower}`, "i"),
    new RegExp(`${entityLower}.*(?:settlement|fine|penalty).*(?:fraud|scam)`, "i"),
    // Direct labels
    new RegExp(`(?:fake|fraudulent)\\s+(?:company|business|startup)\\s+${entityLower}`, "i"),
    new RegExp(`${entityLower}\\s+(?:founders?|ceo|executives?).*(?:fraud|scam)`, "i"),
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════

  // Count matches for each category
  const impersonationMatchCount = impersonationPatterns.filter(p => p.test(contentLower)).length;
  const fightingScamsMatchCount = companyFightingScamsPatterns.filter(p => p.test(contentLower)).length;
  const directAccusationMatchCount = directAccusationPatterns.filter(p => p.test(contentLower)).length;

  const isImpersonationWarning = impersonationMatchCount > 0;
  const isCompanyFightingScams = fightingScamsMatchCount > 0;
  const isDirectAccusation = directAccusationMatchCount > 0;

  // Extract context around scam mentions for reporting
  let context = "";
  const scamMatch = content.match(/.{0,50}(?:scam|fraud).{0,50}/i);
  if (scamMatch) {
    context = scamMatch[0].replace(/\s+/g, " ").trim();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DECISION LOGIC
  // ═══════════════════════════════════════════════════════════════════════════

  // For known legitimate companies, require STRONG evidence of direct accusation
  if (isKnownLegitimate) {
    // If ANY impersonation or fighting patterns found, assume benign
    if (isImpersonationWarning || isCompanyFightingScams) {
      console.log(`[ScamDetection] Known company ${entityName}: Impersonation/defense context detected, NOT flagging`);
      return {
        hasAnyMention: true,
        isDirectAccusation: false,
        hasImpersonationWarnings: isImpersonationWarning,
        isCompanyFightingScams,
        context,
        confidence: "high",
      };
    }
    // Only flag if MULTIPLE direct accusation patterns match with NO impersonation context
    if (directAccusationMatchCount >= 2 && !isImpersonationWarning) {
      return {
        hasAnyMention: true,
        isDirectAccusation: true,
        hasImpersonationWarnings: false,
        isCompanyFightingScams: false,
        context,
        confidence: "medium", // Still medium because known companies rarely are scams
      };
    }
    // Default: don't flag known legitimate companies without strong evidence
    return {
      hasAnyMention: true,
      isDirectAccusation: false,
      hasImpersonationWarnings: isImpersonationWarning,
      isCompanyFightingScams,
      context,
      confidence: "high",
    };
  }

  // For unknown companies, use balanced logic
  // Priority: impersonation/defense > direct accusation
  if ((isImpersonationWarning || isCompanyFightingScams) && !isDirectAccusation) {
    // Impersonation warning without direct accusation = benign
    return {
      hasAnyMention: true,
      isDirectAccusation: false,
      hasImpersonationWarnings: isImpersonationWarning,
      isCompanyFightingScams,
      context,
      confidence: "high",
    };
  }

  if (isDirectAccusation && !(isImpersonationWarning || isCompanyFightingScams)) {
    // Direct accusation without impersonation context = real flag
    return {
      hasAnyMention: true,
      isDirectAccusation: true,
      hasImpersonationWarnings: false,
      isCompanyFightingScams: false,
      context,
      confidence: directAccusationMatchCount >= 2 ? "high" : "medium",
    };
  }

  if (isDirectAccusation && isImpersonationWarning) {
    // Both patterns found = ambiguous, be conservative
    // Weight by match counts
    if (impersonationMatchCount > directAccusationMatchCount) {
      return {
        hasAnyMention: true,
        isDirectAccusation: false,
        hasImpersonationWarnings: true,
        isCompanyFightingScams,
        context,
        confidence: "low",
      };
    }
    // Default to flagging with low confidence if direct > impersonation
    return {
      hasAnyMention: true,
      isDirectAccusation: true,
      hasImpersonationWarnings: true,
      isCompanyFightingScams,
      context,
      confidence: "low",
    };
  }

  // Default: scam word found but no clear patterns
  return {
    hasAnyMention: true,
    isDirectAccusation: false,
    hasImpersonationWarnings: false,
    isCompanyFightingScams: false,
    context,
    confidence: "low",
  };
}

// ============================================================================
// VERIFICATION PLAN (Manus Pattern - Todo.md)
// ============================================================================

interface VerificationPlan {
  entityName: string;
  createdAt: number;
  steps: Array<{
    id: string;
    phase: string;
    description: string;
    status: "pending" | "running" | "completed" | "failed";
    result?: string;
  }>;
}

function createVerificationPlan(
  intent: ExtractedIntent,
  enrichedContext: EnrichedContext
): VerificationPlan {
  const steps: VerificationPlan["steps"] = [];

  // Phase 1: Entity Verification
  steps.push({
    id: "entity-1",
    phase: "Entity Verification",
    description: `Verify ${intent.entityName} exists in state registry (${intent.claims.state || "all states"})`,
    status: "pending",
  });

  // Phase 2: Securities Verification
  if (intent.isFundingRelated || intent.claims.securitiesRegime) {
    steps.push({
      id: "sec-1",
      phase: "SEC Verification",
      description: `Search SEC EDGAR for Form C/D filings for ${intent.entityName}`,
      status: "pending",
    });

    if (intent.claims.fundingPortal || enrichedContext.claimsFromWeb?.fdaStatus) {
      steps.push({
        id: "finra-1",
        phase: "FINRA Verification",
        description: `Verify funding portal ${intent.claims.fundingPortal || "mentioned"} is FINRA registered`,
        status: "pending",
      });
    }
  }

  // Phase 3: FDA Verification (if relevant)
  if (
    intent.claims.fdaStatus ||
    enrichedContext.claimsFromWeb?.fdaStatus ||
    intent.signals.regulatoryMentioned
  ) {
    steps.push({
      id: "fda-1",
      phase: "FDA Verification",
      description: `Verify FDA status claim: "${intent.claims.fdaStatus || enrichedContext.claimsFromWeb?.fdaStatus}"`,
      status: "pending",
    });
    steps.push({
      id: "fda-2",
      phase: "FDA Verification",
      description: "Check 510(k) clearance database vs registration/listing",
      status: "pending",
    });
  }

  // Phase 4: Patent Verification
  if (
    (intent.claims.patents && intent.claims.patents.length > 0) ||
    (enrichedContext.claimsFromWeb?.patents && enrichedContext.claimsFromWeb.patents.length > 0) ||
    intent.signals.patentsMentioned
  ) {
    const patents = intent.claims.patents || enrichedContext.claimsFromWeb?.patents || [];
    steps.push({
      id: "patent-1",
      phase: "Patent Verification",
      description: `Verify patent ownership: ${patents.join(", ") || "search USPTO"}`,
      status: "pending",
    });
  }

  // Phase 5: Money Flow (always for funding)
  if (intent.isFundingRelated) {
    steps.push({
      id: "money-1",
      phase: "Money Flow Verification",
      description: "Verify funds flow matches claimed securities regime",
      status: "pending",
    });

    if (intent.signals.wireInstructionsMentioned || intent.signals.cryptoMentioned) {
      steps.push({
        id: "money-2",
        phase: "Wire Fraud Check",
        description: "Check for wire fraud indicators in payment instructions",
        status: "pending",
      });
    }
  }

  // Phase 6: Synthesis
  steps.push({
    id: "synth-1",
    phase: "Synthesis",
    description: "Cross-check all findings, identify discrepancies, generate report",
    status: "pending",
  });

  return {
    entityName: intent.entityName,
    createdAt: Date.now(),
    steps,
  };
}

// ============================================================================
// CORE AGENTIC DD LOGIC
// ============================================================================

interface AgenticDDResult {
  entityName: string;
  overallRisk: string;
  recommendation: string;
  shouldDisengage: boolean;
  verificationScores: any;
  discrepancies: any[];
  stopRulesTriggered: Array<{ rule: string; description: string }>;
  conditions: string[];
  requiredResolutions: string[];
  extractedIntent: {
    isScamCheck: boolean;
    isFundingRelated: boolean;
    claims: any;
    signals: any;
  };
  webEnrichment: {
    fdaClaimFromWeb: string | undefined;
    patentsFromWeb: string[] | undefined;
    fundingPortalFromWeb: string | undefined;
    redFlagsFromWeb: string[] | undefined;
  };
  verificationPlan: Array<{ phase: string; description: string }>;
  report: string;
  resultId: string;
  executionTimeMs: number;
  branchesExecuted: string[];
}

async function runAgenticDDCore(
  ctx: any,
  query: string,
  additionalContext: string | undefined,
  userId: Id<"users">,
): Promise<AgenticDDResult> {
  const startTime = Date.now();

  console.log("[AgenticPlaybook] ════════════════════════════════════════");
  console.log("[AgenticPlaybook] PHASE 1: INTENT EXTRACTION");
  console.log("[AgenticPlaybook] ════════════════════════════════════════");
  console.log(`[AgenticPlaybook] Query: "${query}"`);

  // PHASE 1: Extract intent and claims from natural language
  const intent = await extractClaimsFromQuery(query, additionalContext);
  console.log(`[AgenticPlaybook] Extracted entity: ${intent.entityName}`);
  console.log(`[AgenticPlaybook] Is scam check: ${intent.isScamCheck}`);
  console.log(`[AgenticPlaybook] Is funding related: ${intent.isFundingRelated}`);
  console.log(`[AgenticPlaybook] Signals:`, intent.signals);

  console.log("[AgenticPlaybook] ════════════════════════════════════════");
  console.log("[AgenticPlaybook] PHASE 2: CONTEXT ENRICHMENT");
  console.log("[AgenticPlaybook] ════════════════════════════════════════");

  // PHASE 2: Enrich context from web search
  const enrichedContext = await enrichContextFromWeb(ctx, intent.entityName);
  console.log(`[AgenticPlaybook] Web context gathered`);
  if (enrichedContext.claimsFromWeb?.fdaStatus) {
    console.log(`[AgenticPlaybook] FDA claim from web: ${enrichedContext.claimsFromWeb.fdaStatus}`);
  }
  if (enrichedContext.redFlagsFromWeb?.length) {
    console.log(`[AgenticPlaybook] Red flags from web: ${enrichedContext.redFlagsFromWeb.join(", ")}`);
  }

  console.log("[AgenticPlaybook] ════════════════════════════════════════");
  console.log("[AgenticPlaybook] PHASE 3: VERIFICATION PLAN");
  console.log("[AgenticPlaybook] ════════════════════════════════════════");

  // PHASE 3: Create verification plan (Manus todo.md pattern)
  const plan = createVerificationPlan(intent, enrichedContext);
  console.log(`[AgenticPlaybook] Plan created with ${plan.steps.length} steps:`);
  for (const step of plan.steps) {
    console.log(`[AgenticPlaybook]   - [${step.phase}] ${step.description}`);
  }

  console.log("[AgenticPlaybook] ════════════════════════════════════════");
  console.log("[AgenticPlaybook] PHASE 4: PARALLEL EXECUTION");
  console.log("[AgenticPlaybook] ════════════════════════════════════════");

  // PHASE 4: Build playbook config from extracted intent + enriched context
  // Use web-enriched funding portal if not provided directly in the query
  const detectedPortal = intent.claims.fundingPortal || enrichedContext.fundingPortal;
  if (detectedPortal) {
    console.log(`[AgenticPlaybook] Using funding portal: ${detectedPortal}`);
  }

  const playbookConfig: PlaybookConfig = {
    entityName: intent.entityName,
    entityType: intent.entityType,
    claimedState: intent.claims.state,
    claimedFormationYear: intent.claims.formationYear,
    claimedSecuritiesRegime: intent.claims.securitiesRegime,
    claimedFundingPortal: detectedPortal, // Use detected portal from query OR web search
    // Use web-enriched claims if not provided directly
    claimedFDAStatus: intent.claims.fdaStatus || enrichedContext.claimsFromWeb?.fdaStatus,
    claimedPatents: intent.claims.patents || enrichedContext.claimsFromWeb?.patents,
    claimedInvestors: intent.claims.investors,
    signals: {
      isRequestingFunding: intent.isFundingRelated,
      wireInstructionsProvided: intent.signals.wireInstructionsMentioned,
      cryptoPaymentRequested: intent.signals.cryptoMentioned,
      hasPatentMentions: intent.signals.patentsMentioned,
      hasRegulatoryMentions: intent.signals.regulatoryMentioned,
    },
    // Pass web enrichment for risk assessment
    webEnrichment: {
      redFlagsFromWeb: enrichedContext.redFlagsFromWeb,
      fundingPortal: enrichedContext.fundingPortal,
      fdaClaim: enrichedContext.claimsFromWeb?.fdaStatus,
    },
    // CRITICAL: Pass raw query for scientific claim detection
    // This enables detection of debunked claims like LK-99, cold fusion, etc.
    claimVerificationMode: {
      enabled: true,
      rawQuery: query,  // Full original query for scientific claim pattern matching
    },
  };

  // Run the playbook with all verification branches in parallel
  const playbookResult = await runInvestorPlaybook(ctx, playbookConfig);

  console.log("[AgenticPlaybook] ════════════════════════════════════════");
  console.log("[AgenticPlaybook] PHASE 5: SYNTHESIS & REPORT");
  console.log("[AgenticPlaybook] ════════════════════════════════════════");

  // PHASE 5: Generate comprehensive report
  const report = generatePlaybookReport(playbookResult.synthesis);

  // Store result
  const resultId = await ctx.runMutation(
    internal.domains.agents.dueDiligence.investorPlaybook.playbookMutations.storePlaybookResult,
    {
      entityName: intent.entityName,
      entityType: intent.entityType,
      synthesis: playbookResult.synthesis,
      userId,
    }
  );

  const executionTimeMs = Date.now() - startTime;

  console.log(`[AgenticPlaybook] ════════════════════════════════════════`);
  console.log(`[AgenticPlaybook] COMPLETE - Risk: ${playbookResult.synthesis.overallRisk}`);
  console.log(`[AgenticPlaybook] Execution time: ${executionTimeMs}ms`);
  console.log(`[AgenticPlaybook] ════════════════════════════════════════`);

  // Build response matching ground truth format
  return {
    entityName: intent.entityName,
    overallRisk: playbookResult.synthesis.overallRisk,
    recommendation: playbookResult.synthesis.recommendation,
    shouldDisengage: playbookResult.synthesis.shouldDisengage,
    verificationScores: playbookResult.synthesis.verificationScores,
    discrepancies: playbookResult.synthesis.discrepancies,
    stopRulesTriggered: playbookResult.synthesis.stopRules
      .filter((r: any) => r.triggered)
      .map((r: any) => ({ rule: r.rule, description: r.description })),
    conditions: playbookResult.synthesis.conditions || [],
    requiredResolutions: playbookResult.synthesis.requiredResolutions || [],
    extractedIntent: {
      isScamCheck: intent.isScamCheck,
      isFundingRelated: intent.isFundingRelated,
      claims: intent.claims,
      signals: intent.signals,
    },
    webEnrichment: {
      fdaClaimFromWeb: enrichedContext.claimsFromWeb?.fdaStatus,
      patentsFromWeb: enrichedContext.claimsFromWeb?.patents,
      fundingPortalFromWeb: enrichedContext.fundingPortal,
      redFlagsFromWeb: enrichedContext.redFlagsFromWeb,
    },
    verificationPlan: plan.steps.map(s => ({
      phase: s.phase,
      description: s.description,
    })),
    report,
    resultId,
    executionTimeMs,
    branchesExecuted: playbookResult.synthesis.branchesExecuted,
  };
}

// ============================================================================
// MAIN AGENTIC ACTION
// ============================================================================

export const runAgenticDueDiligence = internalAction({
  args: {
    query: v.string(),
    additionalContext: v.optional(v.string()),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return runAgenticDDCore(ctx, args.query, args.additionalContext, args.userId);
  },
});

/**
 * Simplified natural language entry point
 * Just takes a question and returns a scam assessment
 */
export const isThisAScam = internalAction({
  args: {
    question: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Run full agentic DD using shared helper
    const result = await runAgenticDDCore(ctx, args.question, undefined, args.userId);

    // Return simplified scam assessment
    const isLikelyScam = result.shouldDisengage ||
      result.overallRisk === "critical" ||
      result.overallRisk === "high";

    const reasons: string[] = [];

    if (result.stopRulesTriggered.length > 0) {
      reasons.push(...result.stopRulesTriggered.map(r => r.description));
    }

    if (result.discrepancies.length > 0) {
      reasons.push(`${result.discrepancies.length} discrepancy(ies) found between claims and verified facts`);
    }

    if (result.webEnrichment.redFlagsFromWeb?.length) {
      reasons.push(...result.webEnrichment.redFlagsFromWeb);
    }

    return {
      entityName: result.entityName,
      isLikelyScam,
      riskLevel: result.overallRisk,
      recommendation: result.recommendation,
      reasons,
      whatToDoNext: isLikelyScam
        ? [
          "Do NOT send money directly",
          "Request specific SEC filing numbers (Form C/D)",
          "Ask for FDA clearance number (K-number) if they claim FDA cleared",
          "Verify the funding portal is FINRA registered",
          "If using escrow, verify the escrow agent is licensed",
        ]
        : result.conditions || ["Proceed with standard due diligence"],
      fullReport: result.report,
      executionTimeMs: result.executionTimeMs,
    };
  },
});
