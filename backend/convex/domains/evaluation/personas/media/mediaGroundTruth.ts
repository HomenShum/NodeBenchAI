/**
 * Media Persona Ground Truth
 *
 * Ground truth definitions for Media persona evaluations using REAL, VERIFIABLE data:
 * - JOURNALIST: Meta Layoffs 2023 (verified across multiple sources)
 *
 * All data is verifiable via:
 * - SEC EDGAR: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=meta
 * - Reuters, Bloomberg, WSJ archives
 * - Company press releases
 */

import type {
  BaseGroundTruth,
  ClaimVerificationScenario,
} from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// JOURNALIST GROUND TRUTH
// ═══════════════════════════════════════════════════════════════════════════

export interface NewsStoryGroundTruth extends BaseGroundTruth {
  entityType: "event";

  story: {
    headline: string;
    subject: string;
    eventDate: string;
    category: "corporate" | "market" | "regulatory" | "technology" | "people";
  };

  facts: {
    primaryClaims: string[];
    verifiableFacts: Array<{
      fact: string;
      source: string;
      verified: boolean;
    }>;
    unverifiedClaims: string[];
  };

  sources: {
    primarySources: string[];
    tier1Sources: string[];
    tier2Sources: string[];
    conflictingSources?: string[];
  };

  context: {
    background: string;
    relatedEvents: string[];
    stakeholders: string[];
  };
}

/**
 * Meta Layoffs March 2023 - Ground truth for Journalist evaluation
 *
 * REAL news event with VERIFIABLE facts:
 * - SEC 8-K filing: March 14, 2023
 * - Official Meta blog post by Mark Zuckerberg
 * - Verified by Reuters, Bloomberg, WSJ, CNBC
 * - 10,000 employees laid off (second round after Nov 2022's 11,000)
 */
export const META_LAYOFFS_2023_GROUND_TRUTH: NewsStoryGroundTruth = {
  entityName: "Meta Layoffs March 2023",
  entityType: "event",
  description: "Meta announces 10,000 layoffs in 'Year of Efficiency' - second major round",
  expectedOutcome: "pass",

  story: {
    headline: "Meta Announces 10,000 Additional Layoffs in 'Year of Efficiency'",
    subject: "Meta Platforms Inc. (META)",
    eventDate: "2023-03-14", // REAL date
    category: "corporate",
  },

  facts: {
    primaryClaims: [
      "Meta laying off 10,000 employees",
      "This is second round after November 2022 (11,000 laid off)",
      "Mark Zuckerberg called 2023 'Year of Efficiency'",
      "Cuts affect recruiting, business teams, and tech groups",
    ],
    verifiableFacts: [
      {
        fact: "10,000 employees to be laid off announced March 14, 2023",
        source: "Meta official blog post / SEC 8-K filing",
        verified: true,
      },
      {
        fact: "Previous layoff of 11,000 in November 2022",
        source: "SEC 8-K filing November 2022",
        verified: true,
      },
      {
        fact: "Meta stock price increased after announcement",
        source: "NASDAQ: META historical data",
        verified: true,
      },
      {
        fact: "5,000 open positions to also be eliminated",
        source: "Mark Zuckerberg blog post",
        verified: true,
      },
    ],
    unverifiedClaims: [],
  },

  sources: {
    primarySources: [
      "Meta official blog post (about.fb.com)",
      "SEC 8-K filing (sec.gov)",
    ],
    tier1Sources: ["Reuters", "Bloomberg", "Wall Street Journal", "CNBC"],
    tier2Sources: ["TechCrunch", "The Verge", "Business Insider"],
    conflictingSources: [], // No conflicting sources - well-documented event
  },

  context: {
    background: "Meta faced pressure from investors to cut costs after metaverse spending concerns",
    relatedEvents: [
      "November 2022 layoffs (11,000 employees)",
      "Tech sector layoffs 2022-2023 (Google, Amazon, Microsoft)",
      "Meta stock dropped 65% in 2022",
    ],
    stakeholders: ["21,000+ affected employees", "Meta shareholders", "Advertisers"],
  },
};

/**
 * Alternative case: Twitter/X Acquisition Chaos 2022
 *
 * REAL controversial event with conflicting reports and evolving narrative.
 * Useful for testing source triangulation and fact-checking.
 */
export const TWITTER_ACQUISITION_GROUND_TRUTH: NewsStoryGroundTruth = {
  entityName: "Twitter/X Acquisition and Layoffs 2022",
  entityType: "event",
  description: "Elon Musk acquires Twitter for $44B, fires 50% of staff - chaotic reporting",
  expectedOutcome: "flag", // Flag because of conflicting reports and chaos

  story: {
    headline: "Musk Completes Twitter Takeover, Fires Half of Staff Within Days",
    subject: "Twitter Inc. (now X Corp)",
    eventDate: "2022-10-27", // Acquisition closed
    category: "corporate",
  },

  facts: {
    primaryClaims: [
      "Elon Musk acquired Twitter for $44 billion",
      "Approximately 50% of staff laid off within first week",
      "Top executives including CEO fired immediately",
      "Company went private, delisted from NYSE",
    ],
    verifiableFacts: [
      {
        fact: "$44B acquisition closed October 27, 2022",
        source: "SEC filings / Delaware court records",
        verified: true,
      },
      {
        fact: "CEO Parag Agrawal, CFO Ned Segal fired day of acquisition",
        source: "Multiple verified reports",
        verified: true,
      },
      {
        fact: "Twitter delisted from NYSE October 28, 2022",
        source: "NYSE records",
        verified: true,
      },
    ],
    unverifiedClaims: [
      "Exact layoff numbers varied in reports (3,700? 4,000? 50%?)",
      "Some employees fired then rehired",
      "H1B visa employee status unclear",
    ],
  },

  sources: {
    primarySources: [
      "SEC filings (merger documents)",
      "Delaware Chancery Court records",
    ],
    tier1Sources: ["Reuters", "Bloomberg", "WSJ"],
    tier2Sources: ["The Verge", "Platformer", "Internal Slack leaks"],
    conflictingSources: [
      "Layoff numbers varied across sources",
      "Musk tweets contradicted reports",
      "Some 'fired' employees later rehired",
    ],
  },

  context: {
    background: "Musk initially tried to back out of deal, forced by court to complete",
    relatedEvents: [
      "Musk's lawsuit to terminate deal (July 2022)",
      "Delaware court intervention",
      "Subsequent advertiser exodus",
    ],
    stakeholders: ["Twitter employees", "Advertisers", "Content moderators", "Users"],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM VERIFICATION SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Journalist claim verification scenarios - Using REAL Meta layoffs data
 */
export const JOURNALIST_CLAIM_SCENARIOS: ClaimVerificationScenario[] = [
  {
    id: "journalist_meta_layoffs_2023",
    personaId: "JOURNALIST",
    name: "Meta March 2023 Layoffs Verification",
    query: "Verify Meta laid off 10,000 employees in March 2023 as part of 'Year of Efficiency'",
    claims: [
      {
        claim: "Meta announced 10,000 layoffs on March 14, 2023",
        category: "corporate",
        expectedVerdict: "verified",
        verificationSource: "SEC 8-K filing / Meta blog post",
      },
      {
        claim: "This was second round after 11,000 in November 2022",
        category: "corporate",
        expectedVerdict: "verified",
      },
      {
        claim: "Zuckerberg called 2023 'Year of Efficiency'",
        category: "event",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["sec.gov", "about.fb.com", "reuters.com", "bloomberg.com"],
    passingThreshold: 90,
  },
  {
    id: "journalist_meta_sources",
    personaId: "JOURNALIST",
    name: "Meta Layoffs Source Triangulation",
    query: "Verify sources for Meta layoffs - primary sources and tier-1 coverage",
    claims: [
      {
        claim: "SEC 8-K filing confirms layoff announcement",
        category: "event",
        expectedVerdict: "verified",
        verificationSource: "sec.gov",
      },
      {
        claim: "Reuters and Bloomberg covered the story",
        category: "verification",
        expectedVerdict: "verified",
      },
      {
        claim: "No conflicting official statements",
        category: "verification",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["sec.gov", "reuters.com", "bloomberg.com"],
    passingThreshold: 85,
  },
  {
    id: "journalist_twitter_chaos",
    personaId: "JOURNALIST",
    name: "Twitter Acquisition Fact-Check",
    query: "Verify Musk acquired Twitter for $44B in October 2022",
    claims: [
      {
        claim: "Musk acquired Twitter for $44 billion",
        category: "corporate",
        expectedVerdict: "verified",
        verificationSource: "SEC filings",
      },
      {
        claim: "Acquisition closed October 27, 2022",
        category: "event",
        expectedVerdict: "verified",
      },
      {
        claim: "Twitter delisted from NYSE",
        category: "corporate",
        expectedVerdict: "verified",
      },
    ],
    expectedSources: ["sec.gov", "nyse.com", "reuters.com"],
    passingThreshold: 85,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT ALL
// ═══════════════════════════════════════════════════════════════════════════

export const MEDIA_GROUND_TRUTHS = {
  journalist: {
    metaLayoffs2023: META_LAYOFFS_2023_GROUND_TRUTH, // REAL: SEC 8-K verified, March 2023
    twitterAcquisition: TWITTER_ACQUISITION_GROUND_TRUTH, // REAL: SEC filings, Oct 2022
  },
};

export const MEDIA_CLAIM_SCENARIOS = {
  journalist: JOURNALIST_CLAIM_SCENARIOS,
};

// Legacy exports for backwards compatibility
export const VIRALTECH_LAYOFFS_GROUND_TRUTH = META_LAYOFFS_2023_GROUND_TRUTH;
export const UNVERIFIED_MERGER_GROUND_TRUTH = TWITTER_ACQUISITION_GROUND_TRUTH;
