/**
 * News Verification Branch
 * 
 * Verifies acquisition news, corporate events, and other news-worthy claims
 * by searching authoritative news sources.
 */

import { api } from "../../../../../_generated/api";
import { DDSource, SourceReliability } from "../../types";
import { NewsVerificationFindings, AcquisitionDetails } from "../types";

type InternalReliability = "authoritative" | "reputable" | "unknown";

function mapToSourceReliability(internal: InternalReliability): SourceReliability {
  switch (internal) {
    case "authoritative": return "authoritative";
    case "reputable": return "reliable";
    case "unknown": return "secondary";
  }
}

interface NewsVerificationResult {
  findings: NewsVerificationFindings;
  sources: DDSource[];
  confidence: number;
}

/**
 * Execute news verification branch
 */
export async function executeNewsVerificationBranch(
  ctx: any,
  acquirer?: string,
  target?: string,
  eventDescription?: string
): Promise<NewsVerificationResult> {
  const sources: DDSource[] = [];
  const keyFacts: NewsVerificationFindings["keyFacts"] = [];
  const relatedNews: NewsVerificationFindings["relatedNews"] = [];
  let acquisitionDetails: AcquisitionDetails | undefined;
  let eventVerified = false;
  let overallConfidence = 0.3;

  try {
    // Search for acquisition news
    if (acquirer && target) {
      const acquisitionResult = await searchAcquisitionNews(ctx, acquirer, target);
      if (acquisitionResult.found) {
        eventVerified = true;
        acquisitionDetails = acquisitionResult.details;
        overallConfidence = acquisitionResult.confidence;
        sources.push(...acquisitionResult.sources);
        relatedNews.push(...acquisitionResult.news);
        
        keyFacts.push({
          fact: `${acquirer} acquired ${target}`,
          verified: true,
          source: acquisitionResult.primarySource,
          confidence: acquisitionResult.confidence > 0.7 ? "high" : "medium",
        });
      }
    }

    // Search for general event
    if (eventDescription) {
      const eventResult = await searchNewsEvent(ctx, eventDescription);
      sources.push(...eventResult.sources);
      relatedNews.push(...eventResult.news);
      
      for (const fact of eventResult.facts) {
        keyFacts.push(fact);
      }
      
      if (eventResult.verified) {
        eventVerified = true;
        overallConfidence = Math.max(overallConfidence, eventResult.confidence);
      }
    }

    return {
      findings: {
        eventVerified,
        eventType: acquisitionDetails ? "acquisition" : "other",
        acquisitionDetails,
        keyFacts,
        relatedNews,
        overallConfidence,
      },
      sources,
      confidence: overallConfidence,
    };
  } catch (error) {
    console.error("[NewsVerification] Error:", error);
    return {
      findings: {
        eventVerified: false,
        eventType: "other",
        keyFacts: [],
        relatedNews: [],
        overallConfidence: 0,
      },
      sources,
      confidence: 0,
    };
  }
}

async function searchAcquisitionNews(
  ctx: any,
  acquirer: string,
  target: string
): Promise<{
  found: boolean;
  details?: AcquisitionDetails;
  confidence: number;
  sources: DDSource[];
  news: NewsVerificationFindings["relatedNews"];
  primarySource?: string;
}> {
  const sources: DDSource[] = [];
  const news: NewsVerificationFindings["relatedNews"] = [];
  
  // Search multiple authoritative sources
  const searchQueries = [
    `"${acquirer}" acquire "${target}" site:reuters.com OR site:bloomberg.com`,
    `"${acquirer}" "${target}" acquisition deal`,
    `"${acquirer}" buys "${target}" OR "${acquirer}" acquires "${target}"`,
  ];

  let found = false;
  let confidence = 0;
  let primarySource: string | undefined;
  let dealValue: string | undefined;
  let announcementDate: string | undefined;

  for (const query of searchQueries) {
    try {
      const result = await ctx.runAction(
        api.domains.search.fusion.actions.fusionSearch,
        {
          query,
          mode: "balanced",
          maxTotal: 5,
          skipRateLimit: true,
        }
      );

      const searchResults = result?.payload?.results ?? [];
      
      for (const r of searchResults) {
        const url = r.url || "";
        const title = r.title || "";
        const snippet = r.snippet || r.content || "";
        const internalReliability = getNewsReliability(url);

        sources.push({
          sourceType: "news_article",
          title,
          url,
          accessedAt: Date.now(),
          reliability: mapToSourceReliability(internalReliability),
        });

        news.push({
          title,
          outlet: extractOutlet(url),
          url,
          relevance: "direct",
        });

        // Check if this confirms the acquisition
        const combinedText = `${title} ${snippet}`.toLowerCase();
        if (combinedText.includes(acquirer.toLowerCase()) &&
            combinedText.includes(target.toLowerCase()) &&
            /acqui|buy|purchase|deal/i.test(combinedText)) {
          found = true;
          if (internalReliability === "authoritative") {
            confidence = Math.max(confidence, 0.9);
            primarySource = url;
          } else if (internalReliability === "reputable") {
            confidence = Math.max(confidence, 0.7);
          }
        }
      }
    } catch (error) {
      console.error("[NewsVerification] Search error:", error);
    }
  }

  return { found, confidence, sources, news, primarySource };
}
async function searchNewsEvent(
  ctx: any,
  eventDescription: string
): Promise<{
  verified: boolean;
  confidence: number;
  sources: DDSource[];
  news: NewsVerificationFindings["relatedNews"];
  facts: NewsVerificationFindings["keyFacts"];
}> {
  const sources: DDSource[] = [];
  const news: NewsVerificationFindings["relatedNews"] = [];
  const facts: NewsVerificationFindings["keyFacts"] = [];

  try {
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: eventDescription,
        mode: "balanced",
        maxTotal: 8,
        skipRateLimit: true,
      }
    );

    const searchResults = result?.payload?.results ?? [];
    let verified = false;
    let confidence = 0;

    for (const r of searchResults) {
      const url = r.url || "";
      const title = r.title || "";
      const snippet = r.snippet || r.content || "";
      const internalReliability = getNewsReliability(url);

      sources.push({
        sourceType: "news_article",
        title,
        url,
        accessedAt: Date.now(),
        reliability: mapToSourceReliability(internalReliability),
      });

      news.push({
        title,
        outlet: extractOutlet(url),
        url,
        relevance: "related",
      });

      // Extract facts from snippet
      if (internalReliability === "authoritative") {
        verified = true;
        confidence = Math.max(confidence, 0.8);
        facts.push({
          fact: snippet.slice(0, 200),
          verified: true,
          source: url,
          confidence: "high",
        });
      }
    }

    return { verified, confidence, sources, news, facts };
  } catch (error) {
    return { verified: false, confidence: 0, sources, news, facts };
  }
}

function getNewsReliability(url: string): InternalReliability {
  const authoritative = [
    "reuters.com", "bloomberg.com", "wsj.com", "nytimes.com",
    "businessinsider.com", "cnbc.com", "ft.com", "theverge.com",
    "techcrunch.com", "venturebeat.com", "wired.com",
  ];
  const reputable = [
    "forbes.com", "fortune.com", "cnn.com", "bbc.com",
    "arstechnica.com", "engadget.com", "zdnet.com",
  ];

  const urlLower = url.toLowerCase();
  if (authoritative.some(d => urlLower.includes(d))) return "authoritative";
  if (reputable.some(d => urlLower.includes(d))) return "reputable";
  return "unknown";
}

function extractOutlet(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    return hostname.split(".")[0].charAt(0).toUpperCase() + hostname.split(".")[0].slice(1);
  } catch {
    return "Unknown";
  }
}

