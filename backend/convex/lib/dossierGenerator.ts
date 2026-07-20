import type { EmailIntelligence } from "../tools/email/emailIntelligenceParser";
import type { ActionItems } from "./actionItemsGenerator";

export type FundingRound = {
  round: string;
  amount: string;
  date?: string;
  leadInvestor?: string;
  participants?: string[];
  valuation?: string;
};

export type EmailIntelligenceDossier = {
  company: {
    name: string;
    domain: string;
    description: string;
    headquarters?: string;
    founded?: string;
    industry?: string;
    employeeCount?: string;
    website?: string;
    productDescription?: string;
    stage?: string;
  };
  team: Array<{
    name: string;
    role: string;
    education: string[];
    previousCompanies: string[];
    achievements: string[];
    linkedin?: string;
    twitter?: string;
    bio?: string;
  }>;
  funding: {
    totalRaised?: string;
    latestRound?: FundingRound;
    rounds: FundingRound[];
    investorProfiles: Array<{
      name: string;
      type: string;
      thesis?: string;
      portfolioFit?: string[];
    }>;
  };
  market: {
    industry?: string;
    marketSize?: string;
    competitors: string[];
    differentiators: string[];
    technicalMoat?: string;
  };
  sources: Array<{
    title: string;
    url: string;
    type?: string;
    date?: string;
    snippet?: string;
    credibility?: "verified" | "secondary";
  }>;
  actionItems: ActionItems;
  metadata: {
    generatedAt: number;
    emailSource?: string;
    researchDurationMs?: number;
    confidenceScore: number;
    freshnessDate?: string;
  };
};

type DossierArgs = {
  intelligence: EmailIntelligence;
  companyResearch?: any;
  founderResearch?: any;
  investorResearch?: any;
  actionItems: ActionItems;
  researchDurationMs?: number;
};

/**
 * Map heterogeneous research outputs (structured or plain text) into the
 * EmailIntelligenceDossier contract expected by the UI and email templates.
 */
export function generateDossier({
  intelligence,
  companyResearch,
  founderResearch,
  investorResearch,
  actionItems,
  researchDurationMs,
}: DossierArgs): EmailIntelligenceDossier {
  const parsedCompany = parseMaybeJson(companyResearch) ?? {};
  const parsedFounders = parseMaybeJson(founderResearch) ?? {};
  const parsedInvestors = parseMaybeJson(investorResearch) ?? {};

  const companyName = intelligence.entities.companies[0] || getString(parsedCompany, "companyName") || "Unknown Company";
  const domain = extractDomain(intelligence.from) || getString(parsedCompany, "domain") || "unknown";

  const fundingRounds: FundingRound[] = normalizeFundingRounds(parsedInvestors);
  const investorProfiles = normalizeInvestorProfiles(parsedInvestors);
  const team = normalizeTeam(parsedFounders);
  const sources = normalizeSources(parsedInvestors, parsedCompany);

  const confidenceScore = scoreConfidence({
    citations: sources.length,
    rounds: fundingRounds.length,
    teamCount: team.length,
  });

  return {
    company: {
      name: companyName,
      domain,
      description: getString(parsedCompany, "description", "summary") || intelligence.subject || "AI-generated dossier",
      headquarters: getString(parsedCompany, "headquarters"),
      founded: getString(parsedCompany, "founded"),
      industry: getString(parsedCompany, "industry", "sector"),
      employeeCount: getString(parsedCompany, "employeeCount"),
      website: getString(parsedCompany, "website") || (domain !== "unknown" ? `https://${domain}` : undefined),
      productDescription: getString(parsedCompany, "productDescription", "product"),
      stage: getString(parsedCompany, "stage", "fundingStage") || "Seed",
    },
    team,
    funding: {
      totalRaised: getString(parsedInvestors, "totalRaised") ?? fundingRounds[fundingRounds.length - 1]?.amount,
      latestRound: fundingRounds[fundingRounds.length - 1],
      rounds: fundingRounds,
      investorProfiles,
    },
    market: {
      industry: getString(parsedCompany, "industry", "sector"),
      marketSize: getString(parsedCompany, "marketSize"),
      competitors: getStringArray(parsedCompany, "competitors"),
      differentiators: getStringArray(parsedCompany, "differentiators"),
      technicalMoat: getString(parsedCompany, "technicalMoat"),
    },
    sources,
    actionItems,
    metadata: {
      generatedAt: Date.now(),
      emailSource: intelligence.from,
      researchDurationMs,
      confidenceScore,
      freshnessDate: getString(parsedCompany, "freshnessDate"),
    },
  };
}

function parseMaybeJson(input: unknown): Record<string, unknown> | null {
  if (!input) return null;
  if (typeof input === "object" && input !== null) return input as Record<string, unknown>;
  if (typeof input === "string") {
    try {
      return JSON.parse(input) as Record<string, unknown>;
    } catch {
      return { summary: input };
    }
  }
  return null;
}

/** Safely extract a string value from a parsed object */
function getString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val) return val;
  }
  return undefined;
}

/** Safely extract a string array from a parsed object */
function getStringArray(obj: Record<string, unknown>, key: string): string[] {
  const val = obj[key];
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === "string");
  return [];
}

function extractDomain(from?: string): string | undefined {
  if (!from) return undefined;
  const match = from.match(/@([A-Za-z0-9.-]+)/);
  if (!match) return undefined;
  const domain = match[1];
  const parts = domain.split(".");
  if (parts.length < 2) return domain;
  return parts.slice(parts.length - 2).join(".");
}

function normalizeFundingRounds(parsedInvestors: any): FundingRound[] {
  const rounds: FundingRound[] = [];
  if (Array.isArray(parsedInvestors.rounds)) {
    parsedInvestors.rounds.forEach((r: any) => {
      if (!r) return;
      rounds.push({
        round: r.round || r.stage || "Round",
        amount: r.amount || r.amountRaised || r.size || "",
        date: r.date,
        leadInvestor: r.leadInvestor,
        participants: r.participants,
        valuation: r.valuation,
      });
    });
  }
  if (parsedInvestors.latestRound && !rounds.find((r) => r.round === parsedInvestors.latestRound.round)) {
    rounds.push(parsedInvestors.latestRound);
  }
  return rounds.slice(-5);
}

function normalizeInvestorProfiles(parsedInvestors: any) {
  if (Array.isArray(parsedInvestors.investorProfiles)) return parsedInvestors.investorProfiles;
  const list: Array<{ name: string; type: string; thesis?: string; portfolioFit?: string[] }> = [];
  if (Array.isArray(parsedInvestors.leadInvestors)) {
    parsedInvestors.leadInvestors.forEach((name: string) => list.push({ name, type: "VC" }));
  }
  return list;
}

function normalizeTeam(parsedFounders: any) {
  if (Array.isArray(parsedFounders.founders)) {
    return parsedFounders.founders.map((f: any) => ({
      name: f.name || "Founder",
      role: f.role || "Founder",
      education: f.education ?? [],
      previousCompanies: f.priorCompanies ?? f.previousCompanies ?? [],
      achievements: f.notableAchievements ?? [],
      linkedin: f.linkedIn || f.linkedin,
      twitter: f.twitter,
      bio: f.summary || f.bio,
    }));
  }
  return [];
}

function normalizeSources(parsedInvestors: any, parsedCompany: any) {
  const sources: EmailIntelligenceDossier["sources"] = [];
  if (Array.isArray(parsedInvestors.announcements)) {
    parsedInvestors.announcements.forEach((a: any) => {
      if (!a?.newsUrl) return;
      sources.push({
        title: a.title || a.companyName || "News",
        url: a.newsUrl,
        type: "news",
        date: a.announcementDate,
        snippet: a.description,
        credibility: "verified",
      });
    });
  }
  if (Array.isArray(parsedCompany.sources)) {
    parsedCompany.sources.forEach((s: any) => {
      if (!s?.url || !s?.title) return;
      sources.push({
        title: s.title,
        url: s.url,
        type: s.type,
        snippet: s.snippet,
        date: s.date,
      });
    });
  }
  return sources.slice(0, 20);
}

function scoreConfidence(params: { citations: number; rounds: number; teamCount: number }): number {
  const citationScore = Math.min(40, params.citations * 4);
  const roundsScore = Math.min(30, params.rounds * 10);
  const teamScore = Math.min(30, params.teamCount * 6);
  return Math.max(55, Math.min(100, citationScore + roundsScore + teamScore));
}
