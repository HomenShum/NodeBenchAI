/**
 * marketCompetitive.ts
 *
 * Core branch handler for market and competitive analysis.
 * Researches market size, competitors, differentiators, and market timing.
 */

"use node";

import { api, internal } from "../../../../_generated/api";
import {
  MarketCompetitiveFindings,
  DDSource,
  SourceReliability,
  SourceType,
} from "../types";

// ============================================================================
// Types
// ============================================================================

interface BranchResult {
  findings: MarketCompetitiveFindings;
  sources: DDSource[];
  confidence: number;
}

interface Competitor {
  name: string;
  description?: string;
  fundingStage?: string;
  fundingTotal?: string;
  differentiator?: string;
  threat: "low" | "medium" | "high";
}

// ============================================================================
// Main Execution
// ============================================================================

/**
 * Execute market/competitive analysis branch
 */
export async function executeMarketCompetitiveBranch(
  ctx: any,
  entityName: string,
  entityType: string
): Promise<BranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // 1. Get entity context for sector information
    const entityContext = await tryGetEntityContext(ctx, entityName);
    const sectors = extractSectors(entityContext);

    // 2. Search for market information
    const marketResults = await searchMarketInfo(ctx, entityName, sectors);

    if (marketResults?.sources) {
      for (const source of marketResults.sources.slice(0, 5)) {
        sources.push({
          sourceType: inferSourceType(source.url),
          url: source.url,
          title: source.title,
          accessedAt: now,
          reliability: inferReliability(source.url),
          section: "market_analysis",
        });
      }
    }

    // 3. Search for competitors
    const competitorResults = await searchCompetitors(ctx, entityName, sectors);

    if (competitorResults?.sources) {
      for (const source of competitorResults.sources.slice(0, 5)) {
        sources.push({
          sourceType: inferSourceType(source.url),
          url: source.url,
          title: source.title,
          accessedAt: now,
          reliability: inferReliability(source.url),
          section: "competitive_analysis",
        });
      }
    }

    // 4. Build findings with LLM-enhanced competitor extraction
    const findings = await buildFindingsWithLLM(
      ctx,
      entityContext,
      marketResults,
      competitorResults,
      entityName,
      sectors
    );

    // 5. Calculate confidence
    confidence = calculateConfidence(findings, sources);

    return { findings, sources, confidence };

  } catch (error) {
    console.error(`[DD-MarketCompetitive] Error for ${entityName}:`, error);

    return {
      findings: {
        marketSize: {},
        competitors: [],
        differentiators: [],
        tailwinds: [],
        headwinds: [],
        marketRisks: [],
      },
      sources,
      confidence: 0.2,
    };
  }
}

// ============================================================================
// Data Fetching
// ============================================================================

async function tryGetEntityContext(ctx: any, entityName: string): Promise<any> {
  try {
    const result = await ctx.runQuery(
      api.domains.knowledge.entityContexts.getByName,
      { entityName }
    );
    return result;
  } catch {
    return null;
  }
}

function extractSectors(entityContext: any): string[] {
  if (!entityContext) return [];

  const sectors: string[] = [];

  // Extract from summary
  if (entityContext.summary) {
    const text = entityContext.summary.toLowerCase();
    const sectorMap: Record<string, string> = {
      "biotech": "Biotech",
      "pharma": "Pharma",
      "fintech": "Fintech",
      "ai": "AI/ML",
      "machine learning": "AI/ML",
      "healthtech": "HealthTech",
      "cybersecurity": "Cybersecurity",
      "saas": "SaaS",
      "enterprise": "Enterprise",
      "consumer": "Consumer",
    };

    for (const [keyword, sector] of Object.entries(sectorMap)) {
      if (text.includes(keyword) && !sectors.includes(sector)) {
        sectors.push(sector);
      }
    }
  }

  return sectors;
}

async function searchMarketInfo(
  ctx: any,
  entityName: string,
  sectors: string[]
): Promise<any> {
  try {
    const sectorQuery = sectors.length > 0 ? sectors.slice(0, 2).join(" ") : "technology";
    // Use Fusion search (free-first, with Linkup fallback)
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `${sectorQuery} market size TAM SAM growth rate 2024 2025 industry analysis`,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true, // DD jobs run system-side
      }
    );
    // Transform fusion search results to expected format
    if (result?.payload?.results) {
      return {
        content: result.payload.results.map((r: any) => r.snippet).join("\n\n"),
        sources: result.payload.results.map((r: any) => ({
          url: r.url,
          title: r.title,
        })),
      };
    }
    return null;
  } catch (e) {
    console.error("[DD-MarketCompetitive] Market search failed:", e);
    return null;
  }
}

async function searchCompetitors(
  ctx: any,
  entityName: string,
  sectors: string[]
): Promise<any> {
  try {
    // Use Fusion search (free-first, with Linkup fallback)
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `${entityName} competitors alternatives comparison ${sectors.slice(0, 2).join(" ")}`,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true, // DD jobs run system-side
      }
    );
    // Transform fusion search results to expected format
    if (result?.payload?.results) {
      return {
        content: result.payload.results.map((r: any) => r.snippet).join("\n\n"),
        sources: result.payload.results.map((r: any) => ({
          url: r.url,
          title: r.title,
        })),
      };
    }
    return null;
  } catch (e) {
    console.error("[DD-MarketCompetitive] Competitor search failed:", e);
    return null;
  }
}

// ============================================================================
// LLM-Enhanced Findings Builder
// ============================================================================

/**
 * Build findings with LLM-enhanced competitor extraction
 */
async function buildFindingsWithLLM(
  ctx: any,
  entityContext: any,
  marketResults: any,
  competitorResults: any,
  entityName: string,
  sectors: string[]
): Promise<MarketCompetitiveFindings> {
  const findings: MarketCompetitiveFindings = {
    marketSize: {},
    competitors: [],
    differentiators: [],
    tailwinds: [],
    headwinds: [],
    marketRisks: [],
  };

  // Extract market size from results
  if (marketResults?.content) {
    findings.marketSize = extractMarketSize(marketResults.content);
    findings.marketGrowth = extractMarketGrowth(marketResults.content);
    findings.tailwinds = extractTailwinds(marketResults.content, sectors);
    findings.headwinds = extractHeadwinds(marketResults.content, sectors);
  }

  // Extract competitors using LLM for better accuracy
  if (competitorResults?.content) {
    findings.competitors = await extractCompetitorsWithLLM(ctx, competitorResults.content, entityName, sectors);
  }

  // Extract differentiators from entity context
  if (entityContext?.productPipeline?.differentiation) {
    findings.differentiators = entityContext.productPipeline.differentiation;
  }

  // Generate "Why Now" thesis
  findings.whyNow = generateWhyNow(findings.tailwinds, sectors);

  // Identify market risks
  findings.marketRisks = generateMarketRisks(
    findings.competitors,
    findings.headwinds,
    sectors
  );

  return findings;
}

/**
 * Extract competitors using LLM for accurate identification
 */
async function extractCompetitorsWithLLM(
  ctx: any,
  content: string,
  entityName: string,
  sectors: string[]
): Promise<Competitor[]> {
  try {
    const { generateText } = await import("ai");
    const { getLanguageModelSafe } = await import("../../mcp_tools/models/modelResolver");

    const model = await getLanguageModelSafe("qwen3-coder-free");
    if (!model) {
      console.log("[DD-MarketCompetitive] LLM not available, falling back to regex");
      return extractCompetitors(content, entityName);
    }

    const prompt = `Identify the direct competitors of ${entityName} from this text.
${entityName} operates in these sectors: ${sectors.join(", ") || "technology"}.

Text:
${content.slice(0, 4000)}

Return ONLY valid JSON with this exact format:
{
  "competitors": [
    {"name": "Company Name", "threat": "high/medium/low", "reason": "Brief reason why they compete"}
  ]
}

Rules:
- Only include companies that DIRECTLY compete with ${entityName} in the same market
- Do NOT include ${entityName} itself
- Use official company names (e.g., "PayPal" not "Paypal", "OpenAI" not "Open AI")
- Threat levels: high = major incumbent, medium = significant player, low = emerging/niche
- Maximum 8 competitors
- If no clear competitors found, return empty array`;

    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: 500,
      temperature: 0.1,
    });

    if (text) {
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.competitors)) {
            const competitors: Competitor[] = [];
            const entityLower = entityName.toLowerCase();

            for (const c of parsed.competitors) {
              if (c.name && typeof c.name === "string") {
                const nameLower = c.name.toLowerCase();
                // Skip if it's the entity itself
                if (nameLower === entityLower || nameLower.includes(entityLower) || entityLower.includes(nameLower)) {
                  continue;
                }
                competitors.push({
                  name: c.name,
                  threat: c.threat === "high" || c.threat === "medium" || c.threat === "low" ? c.threat : "medium",
                  description: c.reason,
                });
              }
            }

            console.log(`[DD-MarketCompetitive] LLM extracted ${competitors.length} competitors`);
            return competitors.slice(0, 8);
          }
        }
      } catch (parseError) {
        console.error("[DD-MarketCompetitive] Failed to parse LLM response:", parseError);
      }
    }
  } catch (error) {
    console.error("[DD-MarketCompetitive] LLM competitor extraction failed:", error);
  }

  // Fall back to regex-based extraction
  return extractCompetitors(content, entityName);
}

// ============================================================================
// Regex-based Findings Builder (Fallback)
// ============================================================================

function buildFindings(
  entityContext: any,
  marketResults: any,
  competitorResults: any,
  entityName: string,
  sectors: string[]
): MarketCompetitiveFindings {
  const findings: MarketCompetitiveFindings = {
    marketSize: {},
    competitors: [],
    differentiators: [],
    tailwinds: [],
    headwinds: [],
    marketRisks: [],
  };

  // Extract market size from results
  if (marketResults?.content) {
    findings.marketSize = extractMarketSize(marketResults.content);
    findings.marketGrowth = extractMarketGrowth(marketResults.content);
    findings.tailwinds = extractTailwinds(marketResults.content, sectors);
    findings.headwinds = extractHeadwinds(marketResults.content, sectors);
  }

  // Extract competitors
  if (competitorResults?.content) {
    findings.competitors = extractCompetitors(competitorResults.content, entityName);
  }

  // Extract differentiators from entity context
  if (entityContext?.productPipeline?.differentiation) {
    findings.differentiators = entityContext.productPipeline.differentiation;
  }

  // Generate "Why Now" thesis
  findings.whyNow = generateWhyNow(findings.tailwinds, sectors);

  // Identify market risks
  findings.marketRisks = generateMarketRisks(
    findings.competitors,
    findings.headwinds,
    sectors
  );

  return findings;
}

function extractMarketSize(content: string): {
  tam?: string;
  sam?: string;
  som?: string;
} {
  const marketSize: { tam?: string; sam?: string; som?: string } = {};

  // TAM extraction
  const tamMatch = content.match(/(?:TAM|total addressable market)[:\s]+\$?([\d.]+)\s*(billion|million|B|M)/i);
  if (tamMatch) {
    marketSize.tam = `$${tamMatch[1]}${tamMatch[2].charAt(0).toUpperCase()}`;
  }

  // SAM extraction
  const samMatch = content.match(/(?:SAM|serviceable addressable market)[:\s]+\$?([\d.]+)\s*(billion|million|B|M)/i);
  if (samMatch) {
    marketSize.sam = `$${samMatch[1]}${samMatch[2].charAt(0).toUpperCase()}`;
  }

  // General market size if specific not found
  if (!marketSize.tam) {
    const generalMatch = content.match(/market\s+(?:size|worth|valued)[:\s]+\$?([\d.]+)\s*(billion|million|trillion)/i);
    if (generalMatch) {
      marketSize.tam = `$${generalMatch[1]}${generalMatch[2].charAt(0).toUpperCase()}`;
    }
  }

  return marketSize;
}

function extractMarketGrowth(content: string): string | undefined {
  // CAGR extraction
  const cagrMatch = content.match(/CAGR[:\s]+(?:of\s+)?([\d.]+)%/i);
  if (cagrMatch) {
    return `${cagrMatch[1]}% CAGR`;
  }

  // Growth rate extraction
  const growthMatch = content.match(/(?:growth\s+rate|growing\s+at)[:\s]+([\d.]+)%/i);
  if (growthMatch) {
    return `${growthMatch[1]}% growth`;
  }

  return undefined;
}

function extractCompetitors(content: string, entityName: string): Competitor[] {
  const competitors: Competitor[] = [];
  const contentLower = content.toLowerCase();
  const seen = new Set<string>();

  // Validate company name - MUCH stricter validation
  const isValidCompanyName = (name: string): boolean => {
    // Must be 2-30 chars
    if (name.length < 2 || name.length > 30) return false;

    // Must start with capital letter
    if (!/^[A-Z]/.test(name)) return false;

    // Must NOT contain these substrings (indicative of garbage extraction)
    const garbageSubstrings = [
      "receiving", "influx", "looking for", "interest from",
      "providers", "model providers", "for ai", "such as",
      "include", "alternative", "competitor", "company",
      "platform", "solution", "provider", "service", "tool",
      "software", "market", "industry", "customers", "users",
      "and v", "v7 for", "v1 for", "v2 for",
    ];
    const nameLower = name.toLowerCase();
    for (const garbage of garbageSubstrings) {
      if (nameLower.includes(garbage)) return false;
    }

    // Must be composed of valid name words (capitalized or common suffixes)
    const words = name.split(/\s+/);
    if (words.length > 3) return false; // Max 3 words for company name

    // Each word must look like a proper noun or acceptable suffix
    const acceptableSuffixes = ["AI", "Labs", "Inc", "Co", "Tech", "Data", "Cloud", "Box"];
    for (const word of words) {
      // Allow "AI" and other all-caps abbreviations
      if (/^[A-Z]{2,4}$/.test(word)) continue;
      // Allow capitalized words
      if (/^[A-Z][a-z]+$/.test(word)) continue;
      // Allow camelCase company names like "SuperAnnotate"
      if (/^[A-Z][a-z]+[A-Z][a-z]+$/.test(word)) continue;
      // Reject anything else
      return false;
    }

    // Must not be just common words
    const commonWords = new Set([
      "the", "and", "for", "with", "from", "this", "that", "their",
      "data", "cloud", "enterprise", "business", "digital", "technology",
      "tech", "your", "label", "all", "best", "top", "new", "more",
    ]);
    if (words.length === 1 && commonWords.has(nameLower)) return false;

    return true;
  };

  // Only use very specific competitor patterns to avoid garbage
  // Look for explicit competitor mentions in article titles or lists
  const knownCompanyNames = [
    // Data labeling / Scale AI competitors
    "Labelbox", "SuperAnnotate", "Appen", "Hive", "Encord", "Superb AI",
    "Label Your Data", "V7", "Snorkel", "Dataloop", "Roboflow",
    // AI companies
    "OpenAI", "Anthropic", "Google AI", "Microsoft", "Meta AI", "Cohere", "Mistral",
    "Hugging Face", "Stability AI", "Inflection", "xAI", "Midjourney",
    // Fintech
    "Stripe", "Square", "PayPal", "Plaid", "Brex", "Ramp", "Mercury",
    // Cloud/Enterprise
    "AWS", "Google Cloud", "Azure", "Cloudflare", "Vercel", "Netlify",
    "Salesforce", "HubSpot", "Zendesk", "ServiceNow", "Snowflake",
    // Cybersecurity
    "CrowdStrike", "Palo Alto Networks", "Zscaler", "SentinelOne", "Fortinet",
  ];

  // Add entityName variations to skip
  const entityLower = entityName.toLowerCase().trim();
  const entityWords = entityLower.split(/\s+/);
  const skipNames = new Set([
    entityLower,
    ...entityWords.filter(w => w.length > 3), // Skip any significant word from entity name
  ]);

  // First pass: find known companies mentioned in the content
  for (const company of knownCompanyNames) {
    const companyLower = company.toLowerCase();
    // Skip if it's the entity we're researching or contains entity name
    if (skipNames.has(companyLower) ||
        companyLower.includes(entityLower) ||
        entityLower.includes(companyLower)) {
      continue;
    }

    // Check if company is mentioned in content
    if (contentLower.includes(companyLower) && !seen.has(companyLower)) {
      seen.add(companyLower);
      competitors.push({
        name: company,
        threat: "medium",
      });
    }
  }

  // Second pass: try to extract from competitor lists, but be very strict
  const listPatterns = [
    // "Top X alternatives: Company1, Company2, Company3"
    /(?:top|best)\s+\d+\s+(?:alternatives|competitors)[:\s]+([^.]+)/gi,
  ];

  for (const pattern of listPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      // Split by common separators
      const candidates = match[1].split(/[,;]/).map(s => s.trim());
      for (const candidate of candidates) {
        // Clean up the name - remove "and " prefix and common garbage
        let cleanName = candidate
          .replace(/^\d+\.\s*/, "")  // Remove numbering
          .replace(/^\s*and\s+/i, "")  // Remove "and " prefix
          .replace(/\s*\([^)]*\)\s*/g, "")  // Remove parentheticals
          .replace(/\s*-.*$/, "")  // Remove dashes and after
          .trim();

        // Skip if starts with lowercase or common words
        if (!cleanName || /^[a-z]/.test(cleanName) || /^(the|and|or|a|an)\s/i.test(cleanName)) {
          continue;
        }

        const cleanNameLower = cleanName.toLowerCase();
        if (isValidCompanyName(cleanName) &&
            !skipNames.has(cleanNameLower) &&
            !cleanNameLower.includes(entityLower) &&
            !seen.has(cleanNameLower)) {
          seen.add(cleanNameLower);
          competitors.push({
            name: cleanName,
            threat: "medium",
          });
        }
      }
    }
  }

  // Sort: known companies first (they're more reliable), then limit
  const knownSet = new Set(knownCompanyNames.map(n => n.toLowerCase()));
  competitors.sort((a, b) => {
    const aKnown = knownSet.has(a.name.toLowerCase()) ? 0 : 1;
    const bKnown = knownSet.has(b.name.toLowerCase()) ? 0 : 1;
    return aKnown - bKnown;
  });

  return competitors.slice(0, 8); // Limit to top 8
}

function extractTailwinds(content: string, sectors: string[]): string[] {
  const tailwinds: string[] = [];
  const contentLower = content.toLowerCase();

  // General tailwinds
  const tailwindKeywords = [
    { keyword: "growing demand", tailwind: "Growing market demand" },
    { keyword: "digital transformation", tailwind: "Digital transformation acceleration" },
    { keyword: "regulatory support", tailwind: "Favorable regulatory environment" },
    { keyword: "increased adoption", tailwind: "Increasing market adoption" },
    { keyword: "investment surge", tailwind: "Strong investor interest" },
    { keyword: "ai adoption", tailwind: "AI/ML adoption wave" },
    { keyword: "remote work", tailwind: "Remote work trends" },
    { keyword: "sustainability", tailwind: "Sustainability focus driving demand" },
  ];

  for (const { keyword, tailwind } of tailwindKeywords) {
    if (contentLower.includes(keyword) && !tailwinds.includes(tailwind)) {
      tailwinds.push(tailwind);
    }
  }

  // Sector-specific tailwinds
  const sectorTailwinds: Record<string, string[]> = {
    "Biotech": ["FDA fast-track designations", "Aging population demographics"],
    "Fintech": ["Embedded finance growth", "Open banking regulations"],
    "AI/ML": ["Enterprise AI adoption", "Generative AI investment"],
    "HealthTech": ["Value-based care shift", "Telehealth normalization"],
    "Cybersecurity": ["Rising cyber threats", "Compliance requirements"],
  };

  for (const sector of sectors) {
    if (sectorTailwinds[sector]) {
      tailwinds.push(...sectorTailwinds[sector]);
    }
  }

  return [...new Set(tailwinds)].slice(0, 5);
}

function extractHeadwinds(content: string, sectors: string[]): string[] {
  const headwinds: string[] = [];
  const contentLower = content.toLowerCase();

  // General headwinds
  const headwindKeywords = [
    { keyword: "competition", headwind: "Intensifying competition" },
    { keyword: "regulatory risk", headwind: "Regulatory uncertainty" },
    { keyword: "economic downturn", headwind: "Economic headwinds" },
    { keyword: "funding drought", headwind: "Tightening funding environment" },
    { keyword: "talent shortage", headwind: "Talent acquisition challenges" },
    { keyword: "pricing pressure", headwind: "Pricing pressure from competitors" },
  ];

  for (const { keyword, headwind } of headwindKeywords) {
    if (contentLower.includes(keyword) && !headwinds.includes(headwind)) {
      headwinds.push(headwind);
    }
  }

  // Sector-specific headwinds
  const sectorHeadwinds: Record<string, string[]> = {
    "Biotech": ["Long development timelines", "High failure rates"],
    "Fintech": ["Banking regulation complexity", "Trust establishment"],
    "AI/ML": ["Compute cost scaling", "AI regulation uncertainty"],
    "Crypto": ["Regulatory crackdowns", "Market volatility"],
  };

  for (const sector of sectors) {
    if (sectorHeadwinds[sector]) {
      headwinds.push(...sectorHeadwinds[sector]);
    }
  }

  return [...new Set(headwinds)].slice(0, 4);
}

function generateWhyNow(tailwinds: string[], sectors: string[]): string {
  if (tailwinds.length === 0) {
    return "Market timing thesis requires further research";
  }

  const primaryTailwind = tailwinds[0];
  const secondaryTailwind = tailwinds[1];

  if (secondaryTailwind) {
    return `${primaryTailwind} combined with ${secondaryTailwind.toLowerCase()} creates compelling market timing`;
  }

  return `${primaryTailwind} creates favorable market conditions`;
}

function generateMarketRisks(
  competitors: Competitor[],
  headwinds: string[],
  sectors: string[]
): string[] {
  const risks: string[] = [];

  // Competition risk
  const highThreatCount = competitors.filter(c => c.threat === "high").length;
  if (highThreatCount >= 2) {
    risks.push(`Competing against ${highThreatCount} well-funded incumbents`);
  }

  // Add headwinds as risks
  for (const headwind of headwinds.slice(0, 2)) {
    risks.push(headwind);
  }

  // Sector-specific risks
  if (sectors.includes("Biotech") || sectors.includes("HealthTech")) {
    risks.push("Regulatory approval timeline risk");
  }
  if (sectors.includes("Fintech") || sectors.includes("Crypto")) {
    risks.push("Financial regulation compliance risk");
  }

  return risks.slice(0, 5);
}

// ============================================================================
// Source Inference
// ============================================================================

function inferSourceType(url?: string): SourceType {
  if (!url) return "llm_inference";

  const urlLower = url.toLowerCase();

  if (urlLower.includes("crunchbase.com")) return "crunchbase";
  if (urlLower.includes("pitchbook.com")) return "pitchbook";
  if (urlLower.includes("sec.gov")) return "sec_filing";

  return "news_article";
}

function inferReliability(url?: string): SourceReliability {
  if (!url) return "inferred";

  const urlLower = url.toLowerCase();

  if (urlLower.includes("gartner.com") ||
      urlLower.includes("mckinsey.com") ||
      urlLower.includes("forrester.com") ||
      urlLower.includes("idc.com")) {
    return "authoritative";
  }

  if (urlLower.includes("crunchbase.com") ||
      urlLower.includes("pitchbook.com") ||
      urlLower.includes("bloomberg.com") ||
      urlLower.includes("reuters.com")) {
    return "reliable";
  }

  return "secondary";
}

// ============================================================================
// Confidence Calculation
// ============================================================================

function calculateConfidence(
  findings: MarketCompetitiveFindings,
  sources: DDSource[]
): number {
  let confidence = 0.3;

  // Market size data
  if (findings.marketSize?.tam) confidence += 0.2;
  if (findings.marketGrowth) confidence += 0.1;

  // Competitors identified
  if (findings.competitors.length > 0) confidence += 0.15;
  if (findings.competitors.length >= 3) confidence += 0.1;

  // Differentiators
  if (findings.differentiators.length > 0) confidence += 0.1;

  // Source quality
  const authoritativeSources = sources.filter(s => s.reliability === "authoritative").length;
  confidence += Math.min(0.15, authoritativeSources * 0.05);

  return Math.min(0.95, confidence);
}
