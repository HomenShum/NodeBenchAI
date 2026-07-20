// convex/tools/media/entityExtractionTools.ts
// Entity extraction from articles - NO facial recognition
// Uses LLM-based NER to identify people and companies from text
"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { getLlmModel } from "../../../shared/llm/modelCatalog";

// Helper to get the appropriate language model
function getLanguageModel(modelName: string) {
  if (modelName.startsWith("claude-")) return anthropic(modelName);
  if (modelName.startsWith("gemini-")) return google(modelName);
  return openai.chat(modelName);
}

// Helper to extract domain from URL
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return 'unknown';
  }
}

// ============================================================================
// HELPER: Fetch article content
// ============================================================================

async function fetchArticleContent(url: string): Promise<string> {
  const LINKUP_API_KEY = process.env.LINKUP_API_KEY;

  if (!LINKUP_API_KEY) {
    // Fallback: try simple fetch
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NodeBenchBot/1.0)',
        },
      });
      const html = await response.text();
      // Basic HTML to text conversion
      return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 10000);
    } catch (error) {
      throw new Error(`Failed to fetch URL: ${error}`);
    }
  }

  // Use Linkup API for better content extraction
  try {
    const response = await fetch('https://api.linkup.so/v1/fetch', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LINKUP_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        outputType: 'content',
      }),
    });

    if (!response.ok) {
      throw new Error(`Linkup API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content || data.summary || '';
  } catch (error) {
    console.warn('[fetchArticleContent] Linkup failed, using fallback:', error);
    // Fallback to simple fetch
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NodeBenchBot/1.0)',
      },
    });
    const html = await response.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10000);
  }
}

// ============================================================================
// HELPER: Web search for enrichment
// ============================================================================

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function webSearch(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  const LINKUP_API_KEY = process.env.LINKUP_API_KEY;

  if (!LINKUP_API_KEY) {
    console.warn('[webSearch] No LINKUP_API_KEY, returning empty results');
    return [];
  }

  try {
    const response = await fetch('https://api.linkup.so/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LINKUP_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        depth: 'standard',
        outputType: 'sourcedAnswer',
      }),
    });

    if (!response.ok) {
      console.warn(`[webSearch] Linkup API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const sources = data.sources || data.results || [];

    return sources.slice(0, maxResults).map((s: any) => ({
      title: s.name || s.title || '',
      url: s.url || '',
      snippet: s.snippet || s.content || '',
    }));
  } catch (error) {
    console.warn('[webSearch] Error:', error);
    return [];
  }
}

// ============================================================================
// HELPER: Entity linking to Wikidata using LLM
// ============================================================================

interface WikidataLinkResult {
  found: boolean;
  wikidataId?: string;
  canonicalName?: string;
  description?: string;
  confidence: number;
  method: string;
}

/**
 * Link entity to Wikidata using LLM-assessed confidence
 * Uses calibrated LLM confidence without heuristic adjustments
 */
async function linkEntityToWikidata(
  name: string,
  context?: string,
  expectedType?: "person" | "company"
): Promise<WikidataLinkResult> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {
    return { found: false, confidence: 0, method: "skipped_no_api_key" };
  }

  try {
    // Step 1: Normalize query using LLM (fix typos, resolve aliases)
    const normalizePrompt = `You are an entity name normalization expert. Given a query, determine if it needs correction.

QUERY: "${name}"
${context ? `CONTEXT: "${context}"` : ""}

Tasks:
1. Fix obvious typos (e.g., "Elon Muk" -> "Elon Musk")
2. Expand aliases/nicknames to canonical names (e.g., "Diddy" -> "Sean Combs")
3. If the query is already correct, keep it unchanged

Respond with JSON only:
{
  "normalizedQuery": "corrected name or original",
  "wasModified": true/false,
  "confidence": 0.0-1.0
}`;

    const normalizeResult = await generateText({
      model: openai.chat("gpt-5.4-nano"),
      prompt: normalizePrompt,
      temperature: 0.1,
    });

    let searchQuery = name;
    const normalizeMatch = normalizeResult.text.match(/\{[\s\S]*\}/);
    if (normalizeMatch) {
      const normalized = JSON.parse(normalizeMatch[0]);
      if (normalized.wasModified && normalized.confidence > 0.6) {
        searchQuery = normalized.normalizedQuery;
      }
    }

    // Step 2: Search Wikidata
    const wikidataUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(searchQuery)}&language=en&format=json&origin=*&limit=5`;
    const wikidataResponse = await fetch(wikidataUrl);
    const wikidataData = await wikidataResponse.json();
    const candidates = wikidataData.search || [];

    if (candidates.length === 0) {
      return { found: false, confidence: 0.1, method: "no_wikidata_results" };
    }

    // Step 3: Always use LLM to assess match quality (even for single candidate)
    const candidateList = candidates
      .map((c: any, i: number) => `${i + 1}. ${c.label} (${c.id}): ${c.description || "No description"}`)
      .join("\n");

    const disambiguatePrompt = `You are an entity disambiguation expert. Select the BEST matching entity.

QUERY: "${searchQuery}"
${context ? `CONTEXT: "${context}"` : ""}
${expectedType ? `EXPECTED TYPE: ${expectedType}` : ""}

CANDIDATES:
${candidateList}

CONFIDENCE CALIBRATION (be accurate, not overconfident):
- 0.95-1.0: Exact match, unambiguous
- 0.85-0.94: Strong match with clear context support
- 0.70-0.84: Good match but some ambiguity possible
- 0.50-0.69: Moderate match, significant uncertainty
- Below 0.50: Weak match, likely incorrect

Respond with JSON only:
{
  "selectedIndex": <1-${candidates.length} or 0 for none>,
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

    const disambiguateResult = await generateText({
      model: openai.chat("gpt-5.4-nano"),
      prompt: disambiguatePrompt,
      temperature: 0.1,
    });

    const disambiguateMatch = disambiguateResult.text.match(/\{[\s\S]*\}/);
    if (disambiguateMatch) {
      const parsed = JSON.parse(disambiguateMatch[0]);
      const selectedIdx = (parsed.selectedIndex || 0) - 1;

      if (selectedIdx >= 0 && selectedIdx < candidates.length) {
        return {
          found: true,
          wikidataId: candidates[selectedIdx].id,
          canonicalName: candidates[selectedIdx].label,
          description: candidates[selectedIdx].description,
          confidence: parsed.confidence || 0.5,
          method: candidates.length === 1 ? "single_match" : "llm_disambiguation",
        };
      }
    }

    // Fallback - LLM failed, use low confidence
    return {
      found: true,
      wikidataId: candidates[0].id,
      canonicalName: candidates[0].label,
      description: candidates[0].description,
      confidence: 0.35, // Low confidence for fallback
      method: "fallback_first",
    };
  } catch (error) {
    console.error("[linkEntityToWikidata] Error:", error);
    return { found: false, confidence: 0, method: "error" };
  }
}

/**
 * Link multiple entities to Wikidata in batch
 */
async function linkEntitiesToWikidata(
  people: ExtractedPerson[],
  companies: ExtractedCompany[]
): Promise<{
  people: ExtractedPerson[];
  companies: ExtractedCompany[];
}> {
  // Link people
  const linkedPeople = await Promise.all(
    people.map(async (person) => {
      const context = [person.role, person.company].filter(Boolean).join(" at ");
      const linkResult = await linkEntityToWikidata(person.name, context, "person");

      return {
        ...person,
        wikidataId: linkResult.wikidataId,
        canonicalName: linkResult.canonicalName,
        wikidataDescription: linkResult.description,
        linkingConfidence: linkResult.confidence,
        linkingMethod: linkResult.method,
      };
    })
  );

  // Link companies
  const linkedCompanies = await Promise.all(
    companies.map(async (company) => {
      const context = [company.type, company.industry].filter(Boolean).join(" ");
      const linkResult = await linkEntityToWikidata(company.name, context, "company");

      return {
        ...company,
        wikidataId: linkResult.wikidataId,
        canonicalName: linkResult.canonicalName,
        wikidataDescription: linkResult.description,
        linkingConfidence: linkResult.confidence,
        linkingMethod: linkResult.method,
      };
    })
  );

  return { people: linkedPeople, companies: linkedCompanies };
}

// ============================================================================
// CORE LOGIC: Entity extraction
// ============================================================================

interface ExtractedPerson {
  name: string;
  role?: string;
  company?: string;
  confidence: string;
  context?: string;
  // Wikidata linking (from LLM entity linker)
  wikidataId?: string;
  canonicalName?: string;
  wikidataDescription?: string;
  linkingConfidence?: number;
  linkingMethod?: string;
}

interface ExtractedCompany {
  name: string;
  type?: string;
  industry?: string;
  fundingStage?: string;
  confidence: string;
  // Wikidata linking (from LLM entity linker)
  wikidataId?: string;
  canonicalName?: string;
  wikidataDescription?: string;
  linkingConfidence?: number;
  linkingMethod?: string;
}

async function extractEntitiesCore(
  articleUrl: string | undefined,
  articleText: string | undefined,
  focusOn: "people" | "companies" | "both",
  linkToWikidata: boolean = false
): Promise<{
  success: boolean;
  error?: string;
  articleUrl?: string;
  people: ExtractedPerson[];
  companies: ExtractedCompany[];
  totalPeople?: number;
  totalCompanies?: number;
  note?: string;
}> {
  if (!articleUrl && !articleText) {
    return {
      success: false,
      error: "Must provide either articleUrl or articleText",
      people: [],
      companies: [],
    };
  }

  let textToAnalyze = articleText || "";

  // If URL provided, fetch the article content
  if (articleUrl && !articleText) {
    try {
      textToAnalyze = await fetchArticleContent(articleUrl);
    } catch (error) {
      console.error("[extractEntities] Failed to fetch URL:", error);
      return {
        success: false,
        error: `Failed to fetch article: ${error}`,
        people: [],
        companies: [],
      };
    }
  }

  if (!textToAnalyze || textToAnalyze.length < 50) {
    return {
      success: false,
      error: "Article text too short or empty",
      people: [],
      companies: [],
    };
  }

  // Use LLM for entity extraction
  const extractionPrompt = `Analyze this article and extract all mentioned entities.

ARTICLE TEXT:
${textToAnalyze.slice(0, 8000)}

Extract the following:
${focusOn === "people" || focusOn === "both" ? `
PEOPLE:
- Name (full name if available)
- Role/Title (CEO, Founder, CTO, etc.)
- Company they work for
- Confidence level (high/medium/low)
- A brief context where they're mentioned
` : ""}

${focusOn === "companies" || focusOn === "both" ? `
COMPANIES:
- Company name
- Type (startup, corporation, venture fund, etc.)
- Industry
- Funding stage if mentioned
- Confidence level (high/medium/low)
` : ""}

Return as JSON:
{
  "people": [
    {
      "name": "John Doe",
      "role": "CEO",
      "company": "TechCorp",
      "confidence": "high",
      "context": "said John Doe, CEO of TechCorp"
    }
  ],
  "companies": [
    {
      "name": "TechCorp",
      "type": "startup",
      "industry": "AI/ML",
      "fundingStage": "Series B",
      "confidence": "high"
    }
  ]
}

IMPORTANT: Only extract entities CLEARLY mentioned. Do not guess.
Return ONLY valid JSON.`;

  try {
    const result = await generateText({
      model: getLanguageModel(getLlmModel("router", "openai")),
      prompt: extractionPrompt,
      temperature: 0.1,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to extract JSON from response");
    }

    const extracted = JSON.parse(jsonMatch[0]);

    let people = extracted.people || [];
    let companies = extracted.companies || [];

    // Optionally link entities to Wikidata
    if (linkToWikidata && (people.length > 0 || companies.length > 0)) {
      const linked = await linkEntitiesToWikidata(people, companies);
      people = linked.people;
      companies = linked.companies;
    }

    return {
      success: true,
      articleUrl,
      people,
      companies,
      totalPeople: people.length,
      totalCompanies: companies.length,
      note: linkToWikidata
        ? "Entities extracted and linked to Wikidata using AI. No facial recognition used."
        : "Entities extracted using AI text analysis. No facial recognition used.",
    };
  } catch (error) {
    console.error("[extractEntities] Extraction error:", error);
    return {
      success: false,
      error: `Entity extraction failed: ${error}`,
      people: [],
      companies: [],
    };
  }
}

// ============================================================================
// CORE LOGIC: Person enrichment
// ============================================================================

interface EnrichedPerson {
  name: string;
  linkedInUrl?: string;
  twitterHandle?: string;
  crunchbaseUrl?: string;
  companies: string[];
  roles: string[];
  recentNews: Array<{ title: string; source: string; url: string }>;
}

async function enrichPersonCore(
  personName: string,
  knownCompany?: string,
  knownRole?: string
): Promise<{
  success: boolean;
  person: EnrichedPerson;
  dataSources: string[];
  note: string;
}> {
  const enrichedData: EnrichedPerson = {
    name: personName,
    companies: knownCompany ? [knownCompany] : [],
    roles: knownRole ? [knownRole] : [],
    recentNews: [],
  };

  // Search for LinkedIn profile
  const linkedInResults = await webSearch(
    `site:linkedin.com/in "${personName}" ${knownCompany || ""} ${knownRole || ""}`,
    3
  );
  const linkedInResult = linkedInResults.find(s => s.url.includes("linkedin.com/in/"));
  if (linkedInResult) {
    enrichedData.linkedInUrl = linkedInResult.url;
  }

  // Search for Twitter/X profile
  const twitterResults = await webSearch(
    `site:twitter.com OR site:x.com "${personName}" ${knownCompany || ""}`,
    3
  );
  const twitterResult = twitterResults.find(s =>
    s.url.includes("twitter.com/") || s.url.includes("x.com/")
  );
  if (twitterResult) {
    const handleMatch = twitterResult.url.match(/(?:twitter\.com|x\.com)\/([^\/\?]+)/);
    if (handleMatch && !['search', 'explore', 'home', 'i'].includes(handleMatch[1])) {
      enrichedData.twitterHandle = `@${handleMatch[1]}`;
    }
  }

  // Search for Crunchbase profile
  const crunchbaseResults = await webSearch(
    `site:crunchbase.com/person "${personName}"`,
    2
  );
  const crunchbaseResult = crunchbaseResults.find(s => s.url.includes("crunchbase.com/person"));
  if (crunchbaseResult) {
    enrichedData.crunchbaseUrl = crunchbaseResult.url;
  }

  // Search for recent news
  const newsResults = await webSearch(
    `"${personName}" ${knownCompany || ""} news`,
    5
  );
  enrichedData.recentNews = newsResults
    .filter(s => !s.url.includes("linkedin.com") && !s.url.includes("twitter.com"))
    .slice(0, 5)
    .map(s => ({
      title: s.title,
      source: extractDomain(s.url),
      url: s.url,
    }));

  return {
    success: true,
    person: enrichedData,
    dataSources: [
      enrichedData.linkedInUrl ? "LinkedIn" : null,
      enrichedData.twitterHandle ? "Twitter/X" : null,
      enrichedData.crunchbaseUrl ? "Crunchbase" : null,
      enrichedData.recentNews.length > 0 ? "News" : null,
    ].filter((s): s is string => s !== null),
    note: "All data from public web searches. No facial recognition used.",
  };
}

// ============================================================================
// AGENT TOOL: Extract entities from article
// ============================================================================

export const extractEntitiesFromArticle = createTool({
  description: `Extract people and companies mentioned in a news article.

Use this tool when you need to:
- Identify founders, executives, or key people mentioned in an article
- Find companies discussed in news stories
- Build a list of people and their roles from press coverage

This tool uses AI-based Named Entity Recognition - NO facial recognition.
Returns structured data about people (name, role, company) and companies.
Optionally links entities to Wikidata for canonical identification.`,
  args: z.object({
    articleUrl: z.string().optional().describe("URL of the article to analyze"),
    articleText: z.string().optional().describe("Raw text of the article if URL not available"),
    focusOn: z.enum(["people", "companies", "both"]).default("both").describe("What entities to extract"),
    linkToWikidata: z.boolean().default(false).describe("Whether to link entities to Wikidata for canonical IDs"),
  }),
  handler: async (ctx, args) => {
    return extractEntitiesCore(args.articleUrl, args.articleText, args.focusOn, args.linkToWikidata);
  },
});

// ============================================================================
// AGENT TOOL: Enrich person profile
// ============================================================================

export const enrichPersonProfile = createTool({
  description: `Enrich a person's profile with public information from the web.

After extracting a person from an article, use this to find:
- Their LinkedIn profile URL
- Twitter/X handle
- Other companies they're associated with
- Recent news about them

This uses web search only - NO facial recognition or biometric data.`,
  args: z.object({
    personName: z.string().describe("Full name of the person"),
    knownCompany: z.string().optional().describe("Company they're known to work at"),
    knownRole: z.string().optional().describe("Their role/title if known"),
  }),
  handler: async (ctx, args) => {
    return enrichPersonCore(args.personName, args.knownCompany, args.knownRole);
  },
});

// ============================================================================
// AGENT TOOL: Research founders from article (combined workflow)
// ============================================================================

export const researchFoundersFromArticle = createTool({
  description: `Research founders and executives mentioned in a news article.

This is a complete workflow that:
1. Extracts all people and companies from the article
2. Links entities to Wikidata for canonical identification
3. Identifies likely founders/executives by role
4. Enriches their profiles with LinkedIn, Twitter, Crunchbase
5. Returns a comprehensive research package

Use for: founder research, competitive intelligence, investor research.
All data from public sources - NO facial recognition or biometric data.`,
  args: z.object({
    articleUrl: z.string().describe("URL of the news article to analyze"),
    focusRoles: z.array(z.string()).default(["founder", "ceo", "cto", "president", "partner", "managing director"]).describe("Roles to focus on"),
    maxPeople: z.number().default(5).describe("Maximum number of people to enrich"),
    linkToWikidata: z.boolean().default(true).describe("Whether to link entities to Wikidata"),
  }),
  handler: async (ctx, args) => {
    const { articleUrl, focusRoles, maxPeople, linkToWikidata } = args;

    // Step 1: Extract entities from article (with Wikidata linking)
    const extractionResult = await extractEntitiesCore(articleUrl, undefined, "both", linkToWikidata);

    if (!extractionResult.success) {
      return {
        success: false,
        error: extractionResult.error,
        founders: [] as any[],
        companies: [] as ExtractedCompany[],
      };
    }

    // Step 2: Filter to focus roles
    const relevantPeople = extractionResult.people.filter(p => {
      const role = (p.role || "").toLowerCase();
      return focusRoles.some(fr => role.includes(fr.toLowerCase()));
    }).slice(0, maxPeople);

    // Step 3: Enrich each person's profile
    const enrichedFounders: any[] = [];
    for (const person of relevantPeople) {
      try {
        const enriched = await enrichPersonCore(
          person.name,
          person.company,
          person.role
        );

        if (enriched.success) {
          enrichedFounders.push({
            ...person,
            enrichment: enriched.person,
            dataSources: enriched.dataSources,
          });
        } else {
          enrichedFounders.push(person);
        }
      } catch (error) {
        console.warn(`[researchFoundersFromArticle] Failed to enrich ${person.name}:`, error);
        enrichedFounders.push(person);
      }
    }

    return {
      success: true,
      articleUrl,
      method: "article_text_analysis_and_web_enrichment",
      note: "All data from public sources (article text, LinkedIn, Twitter, Crunchbase). No facial recognition or biometric analysis used.",
      founders: enrichedFounders,
      companies: extractionResult.companies,
      stats: {
        totalPeopleFound: extractionResult.people.length,
        foundersIdentified: enrichedFounders.length,
        companiesFound: extractionResult.companies.length,
      },
    };
  },
});

// ============================================================================
// INTERNAL ACTIONS: For use by other Convex functions
// ============================================================================

export const extractEntitiesInternal = internalAction({
  args: {
    articleUrl: v.optional(v.string()),
    articleText: v.optional(v.string()),
    focusOn: v.optional(v.union(v.literal("people"), v.literal("companies"), v.literal("both"))),
    linkToWikidata: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    people: v.array(v.object({
      name: v.string(),
      role: v.optional(v.string()),
      company: v.optional(v.string()),
      confidence: v.string(),
      context: v.optional(v.string()),
      wikidataId: v.optional(v.string()),
      canonicalName: v.optional(v.string()),
      wikidataDescription: v.optional(v.string()),
      linkingConfidence: v.optional(v.number()),
      linkingMethod: v.optional(v.string()),
    })),
    companies: v.array(v.object({
      name: v.string(),
      type: v.optional(v.string()),
      industry: v.optional(v.string()),
      fundingStage: v.optional(v.string()),
      confidence: v.string(),
      wikidataId: v.optional(v.string()),
      canonicalName: v.optional(v.string()),
      wikidataDescription: v.optional(v.string()),
      linkingConfidence: v.optional(v.number()),
      linkingMethod: v.optional(v.string()),
    })),
  }),
  handler: async (ctx, args) => {
    const result = await extractEntitiesCore(
      args.articleUrl,
      args.articleText,
      args.focusOn || "both",
      args.linkToWikidata || false
    );

    // Sanitize null values to undefined for Convex validation
    const sanitizePerson = (p: any) => ({
      name: p.name,
      role: p.role ?? undefined,
      company: p.company ?? undefined,
      confidence: p.confidence,
      context: p.context ?? undefined,
      wikidataId: p.wikidataId ?? undefined,
      canonicalName: p.canonicalName ?? undefined,
      wikidataDescription: p.wikidataDescription ?? undefined,
      linkingConfidence: p.linkingConfidence ?? undefined,
      linkingMethod: p.linkingMethod ?? undefined,
    });

    const sanitizeCompany = (c: any) => ({
      name: c.name,
      type: c.type ?? undefined,
      industry: c.industry ?? undefined,
      fundingStage: c.fundingStage ?? undefined,
      confidence: c.confidence,
      wikidataId: c.wikidataId ?? undefined,
      canonicalName: c.canonicalName ?? undefined,
      wikidataDescription: c.wikidataDescription ?? undefined,
      linkingConfidence: c.linkingConfidence ?? undefined,
      linkingMethod: c.linkingMethod ?? undefined,
    });

    return {
      success: result.success,
      error: result.error,
      people: result.people.map(sanitizePerson),
      companies: result.companies.map(sanitizeCompany),
    };
  },
});

export const enrichPersonInternal = internalAction({
  args: {
    personName: v.string(),
    knownCompany: v.optional(v.string()),
    knownRole: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    person: v.object({
      name: v.string(),
      linkedInUrl: v.optional(v.string()),
      twitterHandle: v.optional(v.string()),
      crunchbaseUrl: v.optional(v.string()),
      companies: v.array(v.string()),
      roles: v.array(v.string()),
      recentNews: v.array(v.object({
        title: v.string(),
        source: v.string(),
        url: v.string(),
      })),
    }),
    dataSources: v.array(v.string()),
    note: v.string(),
  }),
  handler: async (ctx, args) => {
    return enrichPersonCore(args.personName, args.knownCompany, args.knownRole);
  },
});

// ============================================================================
// IMAGE ANALYSIS: Reverse Image Search using Serper
// ============================================================================

interface ReverseImageResult {
  title: string;
  link: string;
  source: string;
  thumbnail?: string;
  position: number;
}

async function reverseImageSearchCore(
  imageUrl: string,
  maxResults: number = 10
): Promise<{
  success: boolean;
  error?: string;
  imageUrl: string;
  results: ReverseImageResult[];
  relatedPages: Array<{ title: string; url: string; snippet?: string }>;
  note: string;
}> {
  const SERPER_API_KEY = process.env.SERPER_API_KEY;

  if (!SERPER_API_KEY) {
    return {
      success: false,
      error: "SERPER_API_KEY not configured. Reverse image search requires Serper API.",
      imageUrl,
      results: [],
      relatedPages: [],
      note: "API key missing",
    };
  }

  try {
    // Serper reverse image search endpoint
    const response = await fetch("https://google.serper.dev/images", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": SERPER_API_KEY,
      },
      body: JSON.stringify({
        q: imageUrl,
        num: maxResults,
        type: "reverse",
      }),
    });

    if (!response.ok) {
      // If reverse image search isn't available, try regular image search with URL
      console.warn(`[reverseImageSearch] Reverse search failed (${response.status}), trying image search`);

      const imageSearchResponse = await fetch("https://google.serper.dev/images", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": SERPER_API_KEY,
        },
        body: JSON.stringify({
          q: `image: ${imageUrl}`,
          num: maxResults,
        }),
      });

      if (!imageSearchResponse.ok) {
        const errorBody = await imageSearchResponse.text();
        return {
          success: false,
          error: `Serper API error: ${imageSearchResponse.status} - ${errorBody}`,
          imageUrl,
          results: [],
          relatedPages: [],
          note: "API request failed",
        };
      }

      const imageData = await imageSearchResponse.json();
      const images = imageData.images || [];

      return {
        success: true,
        imageUrl,
        results: images.slice(0, maxResults).map((img: any, idx: number) => ({
          title: img.title || "Untitled",
          link: img.link || img.imageUrl || "",
          source: img.source || extractDomain(img.link || ""),
          thumbnail: img.thumbnailUrl || img.imageUrl,
          position: idx + 1,
        })),
        relatedPages: images.slice(0, 5).map((img: any) => ({
          title: img.title || "Untitled",
          url: img.link || "",
          snippet: img.snippet,
        })),
        note: "Results from image search (reverse search not available)",
      };
    }

    const data = await response.json();
    const images = data.images || [];
    const organic = data.organic || [];

    return {
      success: true,
      imageUrl,
      results: images.slice(0, maxResults).map((img: any, idx: number) => ({
        title: img.title || "Untitled",
        link: img.link || img.imageUrl || "",
        source: img.source || extractDomain(img.link || ""),
        thumbnail: img.thumbnailUrl || img.imageUrl,
        position: idx + 1,
      })),
      relatedPages: organic.slice(0, 10).map((page: any) => ({
        title: page.title || "Untitled",
        url: page.link || "",
        snippet: page.snippet,
      })),
      note: "Found pages where this image appears. No facial recognition used.",
    };
  } catch (error) {
    console.error("[reverseImageSearch] Error:", error);
    return {
      success: false,
      error: `Reverse image search failed: ${error}`,
      imageUrl,
      results: [],
      relatedPages: [],
      note: "Search error",
    };
  }
}

// ============================================================================
// IMAGE ANALYSIS: OCR + Context using Gemini Vision
// ============================================================================

interface ImageAnalysisResult {
  visibleText: string[];
  identifiedLogos: string[];
  eventContext: string;
  settingDescription: string;
  potentialIdentifiers: Array<{
    type: string;
    value: string;
    confidence: string;
  }>;
}

async function analyzeImageContextCore(
  imageUrl: string
): Promise<{
  success: boolean;
  error?: string;
  imageUrl: string;
  analysis: ImageAnalysisResult;
  suggestedSearchQueries: string[];
  note: string;
}> {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;

  if (!GEMINI_API_KEY) {
    return {
      success: false,
      error: "GEMINI_API_KEY not configured. Image analysis requires Google Gemini.",
      imageUrl,
      analysis: {
        visibleText: [],
        identifiedLogos: [],
        eventContext: "",
        settingDescription: "",
        potentialIdentifiers: [],
      },
      suggestedSearchQueries: [],
      note: "API key missing",
    };
  }

  try {
    // Fetch the image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return {
        success: false,
        error: `Failed to fetch image: ${imageResponse.status}`,
        imageUrl,
        analysis: {
          visibleText: [],
          identifiedLogos: [],
          eventContext: "",
          settingDescription: "",
          potentialIdentifiers: [],
        },
        suggestedSearchQueries: [],
        note: "Could not fetch image",
      };
    }

    const imageBlob = await imageResponse.blob();
    const imageBase64 = Buffer.from(await imageBlob.arrayBuffer()).toString("base64");
    const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

    // Use Gemini Vision API
    const { GoogleGenAI, createUserContent } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const analysisPrompt = `Analyze this image and extract ALL useful information for identifying who or what is shown.

DO NOT attempt facial recognition. Instead, look for:

1. VISIBLE TEXT (OCR):
   - Name tags, badges, lanyards
   - Business cards
   - Presentation slides with names
   - Signage, banners
   - Clothing text (company shirts, etc.)

2. COMPANY/ORGANIZATION LOGOS:
   - Logos on clothing, podiums, backdrops
   - Company branding visible anywhere
   - Event sponsor logos

3. EVENT CONTEXT:
   - Type of event (conference, panel, interview, etc.)
   - Event name if visible
   - Award ceremonies, product launches

4. SETTING DESCRIPTION:
   - Office environment
   - Conference stage
   - Interview setup
   - Location clues

5. OTHER IDENTIFIERS:
   - Company names mentioned
   - Award names
   - Product names visible

Return as JSON:
{
  "visibleText": ["Any text found via OCR"],
  "identifiedLogos": ["Company/org logos visible"],
  "eventContext": "Description of what type of event/setting this appears to be",
  "settingDescription": "Physical setting description",
  "potentialIdentifiers": [
    {
      "type": "name_tag|badge|slide|logo|signage|clothing",
      "value": "What was found",
      "confidence": "high|medium|low"
    }
  ]
}

IMPORTANT: Be thorough with OCR - read ALL visible text.
Return ONLY valid JSON.`;

    const contents = createUserContent([
      {
        inlineData: {
          data: imageBase64,
          mimeType,
        },
      },
      { text: analysisPrompt },
    ]);

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
    });

    const responseText = response.text || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("Failed to parse Gemini response as JSON");
    }

    const analysis: ImageAnalysisResult = JSON.parse(jsonMatch[0]);

    // Generate search queries based on analysis
    const suggestedQueries: string[] = [];

    // Add queries based on visible text
    for (const text of analysis.visibleText) {
      if (text.length > 3 && text.length < 50) {
        suggestedQueries.push(`"${text}"`);
      }
    }

    // Add queries based on logos
    for (const logo of analysis.identifiedLogos) {
      suggestedQueries.push(`${logo} executive`);
      suggestedQueries.push(`${logo} founder`);
    }

    // Add event-based queries
    if (analysis.eventContext && analysis.eventContext.length > 5) {
      suggestedQueries.push(analysis.eventContext);
    }

    // Add identifier-based queries
    for (const identifier of analysis.potentialIdentifiers) {
      if (identifier.confidence === "high" && identifier.value.length > 3) {
        suggestedQueries.push(`"${identifier.value}"`);
      }
    }

    return {
      success: true,
      imageUrl,
      analysis,
      suggestedSearchQueries: [...new Set(suggestedQueries)].slice(0, 10),
      note: "Image analyzed for visible text, logos, and context. NO facial recognition used.",
    };
  } catch (error) {
    console.error("[analyzeImageContext] Error:", error);
    return {
      success: false,
      error: `Image analysis failed: ${error}`,
      imageUrl,
      analysis: {
        visibleText: [],
        identifiedLogos: [],
        eventContext: "",
        settingDescription: "",
        potentialIdentifiers: [],
      },
      suggestedSearchQueries: [],
      note: "Analysis error",
    };
  }
}

// ============================================================================
// AGENT TOOL: Reverse Image Search
// ============================================================================

export const reverseImageSearch = createTool({
  description: `Find where an image appears on the web using reverse image search.

Use this to:
- Find articles/pages where a photo appears
- Discover the original source of an image
- Find related coverage about someone in a photo
- Identify press releases, news articles featuring the image

This does NOT use facial recognition - it finds exact/similar image matches.
Returns URLs of pages where the image appears.`,
  args: z.object({
    imageUrl: z.string().describe("Public URL of the image to search for"),
    maxResults: z.number().default(10).describe("Maximum number of results to return"),
  }),
  handler: async (ctx, args) => {
    return reverseImageSearchCore(args.imageUrl, args.maxResults);
  },
});

// ============================================================================
// AGENT TOOL: Image Context Analysis (OCR + Visual Analysis)
// ============================================================================

export const analyzeImageContext = createTool({
  description: `Analyze an image for visible text, logos, and contextual clues.

Use this to extract:
- Visible text (OCR): name tags, badges, slides, signage
- Company logos on clothing, backdrops, etc.
- Event context (conference, interview, etc.)
- Setting details

This is NOT facial recognition. It reads visible text and identifies logos.
Perfect for finding clues about who's in a photo without biometric analysis.`,
  args: z.object({
    imageUrl: z.string().describe("Public URL of the image to analyze"),
  }),
  handler: async (ctx, args) => {
    return analyzeImageContextCore(args.imageUrl);
  },
});

// ============================================================================
// AGENT TOOL: Research Person from Image (Combined Workflow)
// ============================================================================

export const researchPersonFromImage = createTool({
  description: `Complete workflow to research a person from their photo.

This combines:
1. Reverse image search - find where the image appears online
2. Image context analysis - extract visible text, logos, event details
3. Entity extraction - identify people mentioned on pages where image appears
4. Wikidata linking - link entities to canonical knowledge base IDs
5. Profile enrichment - find LinkedIn, Twitter, news about identified people

Use for: identifying speakers at events, researching executives from photos,
finding background on people in news images.

ETHICAL: Uses image matching + text analysis only. NO facial recognition.`,
  args: z.object({
    imageUrl: z.string().describe("Public URL of the image to research"),
    maxPagesToAnalyze: z.number().default(3).describe("Max pages to analyze for entities"),
    linkToWikidata: z.boolean().default(true).describe("Whether to link entities to Wikidata"),
  }),
  handler: async (ctx, args) => {
    const { imageUrl, maxPagesToAnalyze, linkToWikidata } = args;
    const allPeople: ExtractedPerson[] = [];
    const allCompanies: ExtractedCompany[] = [];
    const pagesSources: string[] = [];

    // Step 1: Reverse image search
    const reverseSearchResult = await reverseImageSearchCore(imageUrl, 10);

    // Step 2: Image context analysis
    const imageAnalysis = await analyzeImageContextCore(imageUrl);

    // Step 3: Extract entities from pages where image was found
    const pagesToAnalyze = reverseSearchResult.relatedPages.slice(0, maxPagesToAnalyze);

    for (const page of pagesToAnalyze) {
      if (!page.url) continue;

      try {
        const entityResult = await extractEntitiesCore(page.url, undefined, "both", linkToWikidata);
        if (entityResult.success) {
          allPeople.push(...entityResult.people);
          allCompanies.push(...entityResult.companies);
          pagesSources.push(page.url);
        }
      } catch (error) {
        console.warn(`[researchPersonFromImage] Failed to extract from ${page.url}:`, error);
      }
    }

    // Step 4: Also search based on image analysis clues
    if (imageAnalysis.success) {
      for (const query of imageAnalysis.suggestedSearchQueries.slice(0, 3)) {
        const searchResults = await webSearch(query, 3);
        for (const result of searchResults) {
          if (result.url && !pagesSources.includes(result.url)) {
            try {
              const entityResult = await extractEntitiesCore(result.url, undefined, "people", linkToWikidata);
              if (entityResult.success && entityResult.people.length > 0) {
                allPeople.push(...entityResult.people);
                pagesSources.push(result.url);
              }
            } catch (error) {
              // Skip failed extractions
            }
          }
        }
      }
    }

    // Deduplicate people by name
    const uniquePeopleMap = new Map<string, ExtractedPerson>();
    for (const person of allPeople) {
      const key = person.name.toLowerCase();
      if (!uniquePeopleMap.has(key) ||
          (person.confidence === "high" && uniquePeopleMap.get(key)?.confidence !== "high")) {
        uniquePeopleMap.set(key, person);
      }
    }
    const uniquePeople = Array.from(uniquePeopleMap.values());

    // Step 5: Enrich top candidates
    const enrichedPeople: any[] = [];
    const founderRoles = ["founder", "ceo", "cto", "president", "partner", "director"];

    // Prioritize people with founder/exec roles
    const prioritizedPeople = uniquePeople.sort((a, b) => {
      const aIsFounder = founderRoles.some(r => (a.role || "").toLowerCase().includes(r)) ? 1 : 0;
      const bIsFounder = founderRoles.some(r => (b.role || "").toLowerCase().includes(r)) ? 1 : 0;
      return bIsFounder - aIsFounder;
    }).slice(0, 5);

    for (const person of prioritizedPeople) {
      try {
        const enriched = await enrichPersonCore(person.name, person.company, person.role);
        if (enriched.success) {
          enrichedPeople.push({
            ...person,
            enrichment: enriched.person,
            dataSources: enriched.dataSources,
          });
        } else {
          enrichedPeople.push(person);
        }
      } catch (error) {
        enrichedPeople.push(person);
      }
    }

    // Deduplicate companies
    const uniqueCompaniesMap = new Map<string, ExtractedCompany>();
    for (const company of allCompanies) {
      const key = company.name.toLowerCase();
      if (!uniqueCompaniesMap.has(key)) {
        uniqueCompaniesMap.set(key, company);
      }
    }
    const uniqueCompanies = Array.from(uniqueCompaniesMap.values());

    return {
      success: true,
      imageUrl,
      method: "reverse_image_search_plus_context_analysis_plus_entity_extraction",
      note: "Research conducted using image matching, OCR, and text analysis. NO facial recognition or biometric analysis.",

      imageAnalysis: imageAnalysis.success ? {
        visibleText: imageAnalysis.analysis.visibleText,
        logos: imageAnalysis.analysis.identifiedLogos,
        eventContext: imageAnalysis.analysis.eventContext,
        setting: imageAnalysis.analysis.settingDescription,
      } : null,

      reverseSearchResults: reverseSearchResult.results.slice(0, 5),

      identifiedPeople: enrichedPeople,
      relatedCompanies: uniqueCompanies,

      sourcePages: pagesSources,

      stats: {
        pagesAnalyzed: pagesSources.length,
        peopleFound: uniquePeople.length,
        companiesFound: uniqueCompanies.length,
        enrichedProfiles: enrichedPeople.length,
      },
    };
  },
});

// ============================================================================
// INTERNAL ACTIONS: Image Analysis for other Convex functions
// ============================================================================

export const reverseImageSearchInternal = internalAction({
  args: {
    imageUrl: v.string(),
    maxResults: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    imageUrl: v.string(),
    results: v.array(v.object({
      title: v.string(),
      link: v.string(),
      source: v.string(),
      thumbnail: v.optional(v.string()),
      position: v.number(),
    })),
    relatedPages: v.array(v.object({
      title: v.string(),
      url: v.string(),
      snippet: v.optional(v.string()),
    })),
    note: v.string(),
  }),
  handler: async (ctx, args) => {
    return reverseImageSearchCore(args.imageUrl, args.maxResults || 10);
  },
});

export const analyzeImageContextInternal = internalAction({
  args: {
    imageUrl: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
    imageUrl: v.string(),
    analysis: v.object({
      visibleText: v.array(v.string()),
      identifiedLogos: v.array(v.string()),
      eventContext: v.string(),
      settingDescription: v.string(),
      potentialIdentifiers: v.array(v.object({
        type: v.string(),
        value: v.string(),
        confidence: v.string(),
      })),
    }),
    suggestedSearchQueries: v.array(v.string()),
    note: v.string(),
  }),
  handler: async (ctx, args) => {
    return analyzeImageContextCore(args.imageUrl);
  },
});
