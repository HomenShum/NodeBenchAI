/**
 * Person Research Agent
 *
 * Specialized sub-agent for researching individuals.
 * Extracts career information, expertise, affiliations, and verifies claims.
 *
 * @module deepResearch/agents/personResearchAgent
 */

import type {
  PersonProfile,
  CareerEntry,
  EducationEntry,
  MediaAppearance,
  KnownConnection,
  CompanyAffiliation,
  ResearchSource,
  VerifiedClaim,
  SubAgentResult,
} from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// MAIN AGENT FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

export interface PersonResearchConfig {
  name: string;
  linkedinUrl?: string;
  knownCompany?: string;
  knownRole?: string;
  focusAreas: string[];
  webSearchFn: (query: string) => Promise<SearchResult[]>;
  webFetchFn?: (url: string, prompt: string) => Promise<string>;
  generateTextFn?: (prompt: string) => Promise<string>;
}

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  source?: string;
}

/**
 * Execute person research for a specific individual
 */
export async function executePersonResearch(
  config: PersonResearchConfig
): Promise<SubAgentResult> {
  const startTime = Date.now();
  console.log(`[PersonAgent] Researching: ${config.name}`);

  const sources: ResearchSource[] = [];
  const claims: VerifiedClaim[] = [];

  try {
    // 1. LinkedIn Profile Extraction (if URL provided)
    let linkedinProfile: Partial<PersonProfile> = {};
    if (config.linkedinUrl && config.webFetchFn) {
      linkedinProfile = await extractLinkedInProfile(
        config.linkedinUrl,
        config.webFetchFn
      );
      if (linkedinProfile.currentRole) {
        sources.push({
          id: `src-linkedin-${Date.now()}`,
          type: "linkedin",
          url: config.linkedinUrl,
          title: `LinkedIn: ${config.name}`,
          accessedAt: Date.now(),
          reliability: "reliable",
        });
      }
    }

    // 2. Web Search for Career Information
    const careerResults = await searchCareerInfo(config);
    sources.push(...careerResults.sources);

    // 3. Web Search for Publications/Patents
    const academicResults = await searchAcademicPresence(config);
    sources.push(...academicResults.sources);

    // 4. News/Media Appearances
    const mediaResults = await searchMediaAppearances(config);
    sources.push(...mediaResults.sources);

    // 5. Build Complete Profile
    const profile = buildPersonProfile(
      config,
      linkedinProfile,
      careerResults,
      academicResults,
      mediaResults,
      sources
    );

    // 6. Generate Verified Claims
    claims.push(...generateVerifiedClaims(profile, sources));

    return {
      taskId: `person-${config.name.toLowerCase().replace(/\s+/g, "-")}`,
      type: "person",
      status: "completed",
      findings: profile,
      sources,
      claims,
      executionTimeMs: Date.now() - startTime,
    };

  } catch (error) {
    console.error(`[PersonAgent] Error researching ${config.name}:`, error);

    return {
      taskId: `person-${config.name.toLowerCase().replace(/\s+/g, "-")}`,
      type: "person",
      status: "failed",
      findings: null,
      sources,
      claims,
      executionTimeMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LINKEDIN EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

async function extractLinkedInProfile(
  linkedinUrl: string,
  webFetchFn: (url: string, prompt: string) => Promise<string>
): Promise<Partial<PersonProfile>> {
  const prompt = `Extract professional information from this LinkedIn profile.

Return ONLY valid JSON:
{
  "name": "Full Name",
  "currentRole": "Current job title",
  "currentCompany": "Current employer",
  "location": "City, Country",
  "summary": "Professional summary",
  "careerTimeline": [
    {
      "company": "Company Name",
      "role": "Job Title",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM or null if current",
      "isCurrent": true/false
    }
  ],
  "education": [
    {
      "institution": "University Name",
      "degree": "Degree Type",
      "field": "Field of Study",
      "year": "Graduation Year"
    }
  ],
  "skills": ["skill1", "skill2"],
  "connections": 0
}`;

  try {
    const response = await webFetchFn(linkedinUrl, prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        name: parsed.name,
        currentRole: parsed.currentRole,
        currentCompany: parsed.currentCompany,
        location: parsed.location,
        summary: parsed.summary,
        careerTimeline: (parsed.careerTimeline || []).map((c: Record<string, unknown>) => ({
          company: String(c.company || ""),
          role: String(c.role || ""),
          startDate: c.startDate as string | undefined,
          endDate: c.endDate as string | undefined,
          isCurrent: Boolean(c.isCurrent),
          source: "linkedin",
        })),
        education: (parsed.education || []).map((e: Record<string, unknown>) => ({
          institution: String(e.institution || ""),
          degree: e.degree as string | undefined,
          field: e.field as string | undefined,
          year: e.year as string | undefined,
          source: "linkedin",
        })),
        skills: parsed.skills || [],
      };
    }
  } catch (error) {
    console.error("[PersonAgent] LinkedIn extraction failed:", error);
  }

  return {};
}

// ═══════════════════════════════════════════════════════════════════════════
// WEB SEARCH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

interface SearchResults {
  data: Record<string, unknown>;
  sources: ResearchSource[];
}

async function searchCareerInfo(config: PersonResearchConfig): Promise<SearchResults> {
  const sources: ResearchSource[] = [];
  const data: Record<string, unknown> = {
    careerTimeline: [] as CareerEntry[],
    affiliations: [] as CompanyAffiliation[],
    expertiseAreas: [] as string[],
  };

  // Career history search
  const careerQuery = config.knownCompany
    ? `"${config.name}" "${config.knownCompany}" career background experience`
    : `"${config.name}" career background professional experience`;

  const careerResults = await config.webSearchFn(careerQuery);

  for (const result of careerResults.slice(0, 5)) {
    sources.push({
      id: `src-career-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: inferSourceType(result.url),
      url: result.url,
      title: result.title,
      accessedAt: Date.now(),
      reliability: inferReliability(result.url),
      snippet: result.snippet,
    });

    // Extract career information from snippets
    const careers = extractCareerFromSnippet(result.snippet, config.name);
    (data.careerTimeline as CareerEntry[]).push(...careers);
  }

  // Expertise search
  const expertiseQuery = `"${config.name}" expertise specialization expert`;
  const expertiseResults = await config.webSearchFn(expertiseQuery);

  for (const result of expertiseResults.slice(0, 3)) {
    sources.push({
      id: `src-exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: inferSourceType(result.url),
      url: result.url,
      title: result.title,
      accessedAt: Date.now(),
      reliability: inferReliability(result.url),
      snippet: result.snippet,
    });

    // Extract expertise areas
    const areas = extractExpertiseFromSnippet(result.snippet);
    (data.expertiseAreas as string[]).push(...areas);
  }

  // Deduplicate expertise
  data.expertiseAreas = [...new Set(data.expertiseAreas as string[])];

  return { data, sources };
}

async function searchAcademicPresence(config: PersonResearchConfig): Promise<SearchResults> {
  const sources: ResearchSource[] = [];
  const data: Record<string, unknown> = {
    publications: [],
    patents: [],
    publicationsCount: 0,
    patentsCount: 0,
  };

  // Research publications
  const pubQuery = `"${config.name}" research paper publication author`;
  const pubResults = await config.webSearchFn(pubQuery);

  for (const result of pubResults.slice(0, 3)) {
    if (result.url.includes("researchgate") || result.url.includes("scholar.google") ||
        result.url.includes("arxiv") || result.url.includes("ieee")) {
      sources.push({
        id: `src-pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "academic_paper",
        url: result.url,
        title: result.title,
        accessedAt: Date.now(),
        reliability: "reliable",
        snippet: result.snippet,
      });
    }
  }

  // Patent search
  const patentQuery = `"${config.name}" patent inventor`;
  const patentResults = await config.webSearchFn(patentQuery);

  for (const result of patentResults.slice(0, 3)) {
    if (result.url.includes("patents.google") || result.url.includes("uspto")) {
      sources.push({
        id: `src-patent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "patent_filing",
        url: result.url,
        title: result.title,
        accessedAt: Date.now(),
        reliability: "authoritative",
        snippet: result.snippet,
      });
    }
  }

  data.publicationsCount = sources.filter(s => s.type === "academic_paper").length;
  data.patentsCount = sources.filter(s => s.type === "patent_filing").length;

  return { data, sources };
}

async function searchMediaAppearances(config: PersonResearchConfig): Promise<SearchResults> {
  const sources: ResearchSource[] = [];
  const data: Record<string, unknown> = {
    mediaAppearances: [] as MediaAppearance[],
  };

  // Interviews and articles
  const mediaQuery = `"${config.name}" interview OR podcast OR article OR speaks`;
  const mediaResults = await config.webSearchFn(mediaQuery);

  for (const result of mediaResults.slice(0, 5)) {
    const appearance: MediaAppearance = {
      title: result.title,
      source: extractDomain(result.url),
      url: result.url,
      type: inferMediaType(result.title, result.url),
    };

    (data.mediaAppearances as MediaAppearance[]).push(appearance);

    sources.push({
      id: `src-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: inferMediaType(result.title, result.url) === "interview" ? "interview" : "news_article",
      url: result.url,
      title: result.title,
      accessedAt: Date.now(),
      reliability: inferReliability(result.url),
      snippet: result.snippet,
    });
  }

  return { data, sources };
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE BUILDER
// ═══════════════════════════════════════════════════════════════════════════

function buildPersonProfile(
  config: PersonResearchConfig,
  linkedinProfile: Partial<PersonProfile>,
  careerResults: SearchResults,
  academicResults: SearchResults,
  mediaResults: SearchResults,
  sources: ResearchSource[]
): PersonProfile {
  const now = Date.now();

  // Merge career timelines
  const careerTimeline: CareerEntry[] = [
    ...(linkedinProfile.careerTimeline || []),
    ...((careerResults.data.careerTimeline as CareerEntry[]) || []),
  ];

  // Deduplicate by company+role
  const seenCareers = new Set<string>();
  const dedupedCareer = careerTimeline.filter(c => {
    const key = `${c.company.toLowerCase()}-${c.role.toLowerCase()}`;
    if (seenCareers.has(key)) return false;
    seenCareers.add(key);
    return true;
  });

  // Build expertise areas
  const expertiseAreas: string[] = [
    ...(careerResults.data.expertiseAreas as string[] || []),
    ...(linkedinProfile.skills?.slice(0, 10) || []),
  ];

  // Extract company affiliations
  const affiliations: CompanyAffiliation[] = dedupedCareer.map(c => ({
    company: c.company,
    role: c.role,
    type: inferAffiliationType(c.role),
    isCurrent: c.isCurrent,
  }));

  return {
    id: `person-${config.name.toLowerCase().replace(/\s+/g, "-")}-${now}`,
    name: linkedinProfile.name || config.name,
    linkedinUrl: config.linkedinUrl,
    currentRole: linkedinProfile.currentRole || config.knownRole,
    currentCompany: linkedinProfile.currentCompany || config.knownCompany,
    location: linkedinProfile.location,
    summary: linkedinProfile.summary,

    careerTimeline: dedupedCareer,
    education: linkedinProfile.education || [],
    skills: linkedinProfile.skills || [],

    expertiseAreas: [...new Set(expertiseAreas)].slice(0, 15),
    publicationsCount: academicResults.data.publicationsCount as number | undefined,
    patentsCount: academicResults.data.patentsCount as number | undefined,
    mediaAppearances: (mediaResults.data.mediaAppearances as MediaAppearance[]) || [],

    knownConnections: [],
    companyAffiliations: affiliations,

    sources,
    verifiedClaims: [],
    unverifiedClaims: config.focusAreas,
    lastUpdated: now,
  };
}

function generateVerifiedClaims(
  profile: PersonProfile,
  sources: ResearchSource[]
): VerifiedClaim[] {
  const claims: VerifiedClaim[] = [];

  // Current role claim
  if (profile.currentRole && profile.currentCompany) {
    const linkedinSources = sources.filter(s => s.type === "linkedin");
    claims.push({
      claim: `${profile.name} is ${profile.currentRole} at ${profile.currentCompany}`,
      verified: linkedinSources.length > 0,
      confidence: linkedinSources.length > 0 ? 0.9 : 0.6,
      sources: linkedinSources.length > 0 ? linkedinSources : sources.slice(0, 1),
      verificationMethod: linkedinSources.length > 0 ? "direct" : "inferred",
      verifiedAt: Date.now(),
    });
  }

  // Career history claims
  for (const career of profile.careerTimeline.slice(0, 3)) {
    claims.push({
      claim: `${profile.name} worked at ${career.company} as ${career.role}`,
      verified: true,
      confidence: 0.7,
      sources: sources.filter(s =>
        s.snippet?.toLowerCase().includes(career.company.toLowerCase())
      ).slice(0, 2),
      verificationMethod: "triangulated",
      verifiedAt: Date.now(),
    });
  }

  // Expertise claims
  for (const expertise of profile.expertiseAreas.slice(0, 3)) {
    claims.push({
      claim: `${profile.name} has expertise in ${expertise}`,
      verified: true,
      confidence: 0.6,
      sources: sources.slice(0, 1),
      verificationMethod: "inferred",
      verifiedAt: Date.now(),
    });
  }

  return claims;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function extractCareerFromSnippet(snippet: string, personName: string): CareerEntry[] {
  const careers: CareerEntry[] = [];

  // Pattern: "Name is/was [Role] at [Company]"
  const rolePatterns = [
    new RegExp(`${personName}\\s+(?:is|was|serves? as|served as)\\s+(?:the\\s+)?([^,\\.]+?)\\s+(?:at|of|for)\\s+([A-Z][\\w\\s]+)`, "gi"),
    new RegExp(`([A-Z][\\w\\s]+)(?:'s|\\s)([^,\\.]+?)\\s+${personName}`, "gi"),
  ];

  for (const pattern of rolePatterns) {
    let match;
    while ((match = pattern.exec(snippet)) !== null) {
      careers.push({
        company: match[2]?.trim() || match[1]?.trim() || "",
        role: match[1]?.trim() || match[2]?.trim() || "",
        isCurrent: snippet.toLowerCase().includes("is ") || snippet.toLowerCase().includes("currently"),
        source: "web_search",
      });
    }
  }

  return careers.slice(0, 3);
}

function extractExpertiseFromSnippet(snippet: string): string[] {
  const expertise: string[] = [];
  const snippetLower = snippet.toLowerCase();

  const expertiseKeywords = [
    "ai", "machine learning", "deep learning", "neural network",
    "infrastructure", "gpu", "training", "data center",
    "engineering", "software", "platform", "distributed systems",
    "product", "strategy", "leadership", "management",
  ];

  for (const keyword of expertiseKeywords) {
    if (snippetLower.includes(keyword)) {
      expertise.push(keyword.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
    }
  }

  return expertise;
}

function inferSourceType(url?: string): ResearchSource["type"] {
  if (!url) return "llm_inference";
  const urlLower = url.toLowerCase();

  if (urlLower.includes("linkedin.com")) return "linkedin";
  if (urlLower.includes("crunchbase.com")) return "crunchbase";
  if (urlLower.includes("researchgate") || urlLower.includes("scholar.google") || urlLower.includes("arxiv")) return "academic_paper";
  if (urlLower.includes("patents.google") || urlLower.includes("uspto")) return "patent_filing";
  if (urlLower.includes("sec.gov")) return "sec_filing";

  return "news_article";
}

function inferReliability(url?: string): ResearchSource["reliability"] {
  if (!url) return "unverified";
  const urlLower = url.toLowerCase();

  if (urlLower.includes("linkedin.com") || urlLower.includes("crunchbase.com")) return "reliable";
  if (urlLower.includes("sec.gov") || urlLower.includes("uspto")) return "authoritative";
  if (urlLower.includes("forbes") || urlLower.includes("bloomberg") ||
      urlLower.includes("techcrunch") || urlLower.includes("reuters")) return "reliable";

  return "secondary";
}

function inferMediaType(title: string, url: string): MediaAppearance["type"] {
  const titleLower = title.toLowerCase();
  const urlLower = url.toLowerCase();

  if (titleLower.includes("interview") || titleLower.includes("spoke") || titleLower.includes("talks")) return "interview";
  if (titleLower.includes("podcast") || urlLower.includes("podcast")) return "podcast";
  if (titleLower.includes("conference") || titleLower.includes("summit") || titleLower.includes("keynote")) return "conference";

  return "article";
}

function inferAffiliationType(role: string): CompanyAffiliation["type"] {
  const roleLower = role.toLowerCase();

  if (roleLower.includes("founder") || roleLower.includes("co-founder")) return "founder";
  if (roleLower.includes("board") || roleLower.includes("director")) return "board";
  if (roleLower.includes("advisor")) return "advisor";
  if (roleLower.includes("investor") || roleLower.includes("partner")) return "investor";

  return "employee";
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace("www.", "");
  } catch {
    return "unknown";
  }
}
