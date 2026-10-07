/**
 * teamDeepResearch.ts
 *
 * Core branch handler for team and founders deep research.
 * Extracts founder profiles, career timelines, track records, and team dynamics.
 */

"use node";

import { api, internal } from "../../../../_generated/api";
import {
  TeamFoundersFindings,
  TeamMemberProfile,
  DDSource,
  SourceReliability,
  SourceType,
  CareerTimelineEntry,
  TrackRecord,
  NetworkConnections,
  ConflictFlag,
} from "../types";

// ============================================================================
// Types
// ============================================================================

interface BranchResult {
  findings: TeamFoundersFindings;
  sources: DDSource[];
  confidence: number;
}

interface ExtractedPerson {
  name: string;
  role?: string;
  title?: string;
  isFounder?: boolean;
  isExecutive?: boolean;
  isBoardMember?: boolean;
  linkedinUrl?: string;
}

// ============================================================================
// Main Execution
// ============================================================================

/**
 * Execute team/founders deep research branch
 */
export async function executeTeamFoundersBranch(
  ctx: any,
  entityName: string,
  entityType: string
): Promise<BranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  console.log(`[DD-TeamResearch] Starting team research for ${entityName}`);

  try {
    // 1. Get existing entity context for team data
    const entityContext = await tryGetEntityContext(ctx, entityName);

    if (entityContext) {
      sources.push({
        sourceType: "llm_inference",
        title: "Cached Entity Context",
        accessedAt: now,
        reliability: "secondary",
        section: "team_discovery",
      });
      confidence += 0.15;
    }

    // 2. Search for founder/leadership information via Fusion search
    const teamSearchResults = await searchTeamInfo(ctx, entityName);

    if (teamSearchResults?.sources?.length > 0) {
      for (const source of teamSearchResults.sources.slice(0, 5)) {
        sources.push({
          sourceType: inferSourceType(source.url),
          url: source.url,
          title: source.title,
          accessedAt: now,
          reliability: inferReliability(source.url),
          section: "team_discovery",
        });
      }
      confidence += 0.2;
    }

    // 3. Search for founder track records
    const trackRecordResults = await searchFounderTrackRecords(ctx, entityName, entityContext);

    if (trackRecordResults?.sources?.length > 0) {
      for (const source of trackRecordResults.sources.slice(0, 3)) {
        sources.push({
          sourceType: inferSourceType(source.url),
          url: source.url,
          title: source.title,
          accessedAt: now,
          reliability: inferReliability(source.url),
          section: "track_record",
        });
      }
      confidence += 0.1;
    }

    // 4. Build findings with LLM-enhanced extraction
    const findings = await buildFindingsWithLLM(
      ctx,
      entityContext,
      teamSearchResults,
      trackRecordResults,
      entityName
    );

    // 5. Calculate final confidence
    confidence = calculateConfidence(findings, sources);

    console.log(`[DD-TeamResearch] Completed for ${entityName}: ${findings.founders.length} founders, ${findings.executives.length} executives`);

    return { findings, sources, confidence };

  } catch (error) {
    console.error(`[DD-TeamResearch] Error for ${entityName}:`, error);

    // Return minimal findings with low confidence
    return {
      findings: {
        founders: [],
        executives: [],
        boardMembers: [],
        teamSize: 0,
        averageExperience: 0,
        hasSerialFounders: false,
        hasVCBackedFounders: false,
        teamStrengths: [],
        teamGaps: ["Research incomplete due to data access issues"],
        keyPersonRisk: [],
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

async function searchTeamInfo(ctx: any, entityName: string): Promise<any> {
  try {
    // Use Fusion search (free-first, with Linkup fallback)
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `${entityName} founders CEO leadership team executives management`,
        mode: "balanced",
        maxTotal: 10,
        skipRateLimit: true, // DD jobs run system-side
      }
    );

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
    console.error("[DD-TeamResearch] Team search failed:", e);
    return null;
  }
}

async function searchFounderTrackRecords(
  ctx: any,
  entityName: string,
  entityContext: any
): Promise<any> {
  try {
    // Try to extract founder names for targeted search
    let founderNames: string[] = [];

    if (entityContext?.keyPeople) {
      founderNames = entityContext.keyPeople
        .filter((p: any) => p.role?.toLowerCase().includes("founder") || p.role?.toLowerCase().includes("ceo"))
        .map((p: any) => p.name)
        .slice(0, 3);
    }

    const searchQuery = founderNames.length > 0
      ? `${founderNames.join(" OR ")} founder track record previous companies exits`
      : `${entityName} founder CEO background previous startups exits`;

    // Use Fusion search (free-first, with Linkup fallback)
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: searchQuery,
        mode: "balanced",
        maxTotal: 8,
        skipRateLimit: true,
      }
    );

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
    console.error("[DD-TeamResearch] Track record search failed:", e);
    return null;
  }
}

// ============================================================================
// LLM-Enhanced Findings Builder
// ============================================================================

async function buildFindingsWithLLM(
  ctx: any,
  entityContext: any,
  teamSearchResults: any,
  trackRecordResults: any,
  entityName: string
): Promise<TeamFoundersFindings> {
  const findings: TeamFoundersFindings = {
    founders: [],
    executives: [],
    boardMembers: [],
    teamSize: 0,
    averageExperience: 0,
    hasSerialFounders: false,
    hasVCBackedFounders: false,
    teamStrengths: [],
    teamGaps: [],
    keyPersonRisk: [],
  };

  // Extract team from entity context first
  if (entityContext?.keyPeople) {
    for (const person of entityContext.keyPeople) {
      const profile = buildTeamMemberProfile(person, entityName);

      const roleLower = (person.role || "").toLowerCase();
      if (roleLower.includes("founder") || roleLower.includes("co-founder")) {
        findings.founders.push(profile);
      } else if (roleLower.includes("ceo") || roleLower.includes("cto") ||
                 roleLower.includes("cfo") || roleLower.includes("coo") ||
                 roleLower.includes("president") || roleLower.includes("vp") ||
                 roleLower.includes("chief")) {
        findings.executives.push(profile);
      } else if (roleLower.includes("board") || roleLower.includes("director")) {
        findings.boardMembers.push(profile);
      }
    }
  }

  // Use LLM to extract additional team members from search results
  if (teamSearchResults?.content) {
    const llmExtracted = await extractTeamWithLLM(ctx, teamSearchResults.content, entityName);

    // Merge with existing, avoiding duplicates
    for (const person of llmExtracted.founders) {
      if (!findings.founders.some(f => f.name.toLowerCase() === person.name.toLowerCase())) {
        findings.founders.push(person);
      }
    }
    for (const person of llmExtracted.executives) {
      if (!findings.executives.some(e => e.name.toLowerCase() === person.name.toLowerCase())) {
        findings.executives.push(person);
      }
    }
    for (const person of llmExtracted.boardMembers) {
      if (!findings.boardMembers.some(b => b.name.toLowerCase() === person.name.toLowerCase())) {
        findings.boardMembers.push(person);
      }
    }
  }

  // Analyze track records from search results
  if (trackRecordResults?.content) {
    analyzeTrackRecords(findings, trackRecordResults.content);
  }

  // Calculate team metrics
  const allMembers = [...findings.founders, ...findings.executives];
  findings.teamSize = allMembers.length;

  if (allMembers.length > 0) {
    const totalExperience = allMembers.reduce((sum, m) =>
      sum + (m.trackRecord?.yearsExperience || 5), 0);
    findings.averageExperience = Math.round(totalExperience / allMembers.length);
  }

  // Detect serial founders and VC-backed founders
  findings.hasSerialFounders = findings.founders.some(f =>
    (f.trackRecord?.successfulExits || 0) > 0 ||
    f.highlights.some(h => h.toLowerCase().includes("serial") || h.toLowerCase().includes("previous"))
  );

  findings.hasVCBackedFounders = findings.founders.some(f =>
    f.highlights.some(h =>
      h.toLowerCase().includes("vc") ||
      h.toLowerCase().includes("backed") ||
      h.toLowerCase().includes("series")
    )
  );

  // Generate team strengths and gaps
  findings.teamStrengths = generateTeamStrengths(findings);
  findings.teamGaps = generateTeamGaps(findings);
  findings.keyPersonRisk = generateKeyPersonRisk(findings);

  // Generate founder-market fit assessment
  findings.founderMarketFit = generateFounderMarketFit(findings, entityContext);

  // Generate track record summary
  findings.trackRecordSummary = generateTrackRecordSummary(findings);

  return findings;
}

async function extractTeamWithLLM(
  ctx: any,
  content: string,
  entityName: string
): Promise<{
  founders: TeamMemberProfile[];
  executives: TeamMemberProfile[];
  boardMembers: TeamMemberProfile[];
}> {
  const result = {
    founders: [] as TeamMemberProfile[],
    executives: [] as TeamMemberProfile[],
    boardMembers: [] as TeamMemberProfile[],
  };

  try {
    const { generateText } = await import("ai");
    const { getLanguageModelSafe } = await import("../../mcp_tools/models/modelResolver");

    const model = await getLanguageModelSafe("qwen3-coder-free");
    if (!model) {
      console.log("[DD-TeamResearch] LLM not available, falling back to regex");
      return extractTeamWithRegex(content, entityName);
    }

    const prompt = `Extract the leadership team of ${entityName} from this text.

Text:
${content.slice(0, 4000)}

Return ONLY valid JSON with this exact format:
{
  "team": [
    {
      "name": "Full Name",
      "role": "Their exact title",
      "type": "founder|executive|board",
      "background": "Brief background if mentioned"
    }
  ]
}

Rules:
- Only include people who work at ${entityName}
- "founder" = founders, co-founders
- "executive" = CEO, CTO, CFO, COO, President, VP, Chief officers
- "board" = board members, directors (excluding executives)
- Use real names, not placeholders
- If no team members found, return empty array`;

    const { text } = await generateText({
      model,
      prompt,
      maxOutputTokens: 800,
      temperature: 0.1,
    });

    if (text) {
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.team)) {
            for (const person of parsed.team) {
              if (!person.name || typeof person.name !== "string") continue;

              const profile = buildTeamMemberProfile({
                name: person.name,
                role: person.role,
                background: person.background,
              }, entityName);

              if (person.type === "founder") {
                result.founders.push(profile);
              } else if (person.type === "executive") {
                result.executives.push(profile);
              } else if (person.type === "board") {
                result.boardMembers.push(profile);
              }
            }
          }
        }
      } catch (parseError) {
        console.error("[DD-TeamResearch] Failed to parse LLM response:", parseError);
      }
    }
  } catch (error) {
    console.error("[DD-TeamResearch] LLM team extraction failed:", error);
  }

  return result;
}

function extractTeamWithRegex(
  content: string,
  entityName: string
): {
  founders: TeamMemberProfile[];
  executives: TeamMemberProfile[];
  boardMembers: TeamMemberProfile[];
} {
  const result = {
    founders: [] as TeamMemberProfile[],
    executives: [] as TeamMemberProfile[],
    boardMembers: [] as TeamMemberProfile[],
  };

  // Common patterns for extracting names with roles
  const patterns = [
    // "John Smith, CEO of Company"
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+),?\s+(?:the\s+)?(CEO|CTO|CFO|COO|Founder|Co-Founder|President|Chief\s+\w+\s+Officer)/gi,
    // "CEO John Smith"
    /(CEO|CTO|CFO|COO|Founder|Co-Founder|President)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi,
    // "founded by John Smith"
    /founded\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi,
  ];

  const seen = new Set<string>();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      let name: string;
      let role: string;

      // Determine which capture group has the name
      if (match[1]?.match(/^[A-Z][a-z]/)) {
        name = match[1].trim();
        role = match[2] || "Unknown";
      } else {
        name = match[2]?.trim() || match[1]?.trim() || "";
        role = match[1] || "Unknown";
      }

      // Validate name
      if (!name || name.length < 3 || name.length > 40) continue;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());

      const profile = buildTeamMemberProfile({ name, role }, entityName);
      const roleLower = role.toLowerCase();

      if (roleLower.includes("founder")) {
        result.founders.push(profile);
      } else if (roleLower.includes("ceo") || roleLower.includes("cto") ||
                 roleLower.includes("cfo") || roleLower.includes("president") ||
                 roleLower.includes("chief")) {
        result.executives.push(profile);
      }
    }
  }

  return result;
}

// ============================================================================
// Profile Builder
// ============================================================================

function buildTeamMemberProfile(
  person: { name: string; role?: string; linkedinUrl?: string; background?: string },
  companyName: string
): TeamMemberProfile {
  const profile: TeamMemberProfile = {
    id: `team-${person.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    name: person.name,
    currentRole: person.role || "Leadership",
    currentCompany: companyName,
    linkedinUrl: person.linkedinUrl,
    careerTimeline: [],
    boardSeats: [],
    advisoryRoles: [],
    patents: [],
    education: [],
    conflictFlags: [],
    networkConnections: {
      coFounders: [],
      investorRelationships: [],
      boardNetworkOverlap: [],
      references: [],
    },
    trackRecord: {
      successfulExits: 0,
      failedVentures: 0,
      pivots: 0,
      yearsExperience: 5, // Default estimate
      domainExpertise: [],
    },
    redFlags: [],
    highlights: [],
    sources: [],
    verificationStatus: "unverified",
  };

  // Extract highlights from background if available
  if (person.background) {
    profile.highlights.push(person.background);

    // Try to infer experience
    const yearMatch = person.background.match(/(\d+)\+?\s*years?/i);
    if (yearMatch) {
      profile.trackRecord.yearsExperience = parseInt(yearMatch[1], 10);
    }

    // Infer serial founder
    if (person.background.toLowerCase().includes("serial") ||
        person.background.toLowerCase().includes("previous startup")) {
      profile.highlights.push("Serial entrepreneur");
      profile.trackRecord.successfulExits = 1;
    }
  }

  return profile;
}

// ============================================================================
// Analysis Functions
// ============================================================================

function analyzeTrackRecords(
  findings: TeamFoundersFindings,
  trackRecordContent: string
): void {
  const contentLower = trackRecordContent.toLowerCase();

  // Look for exit mentions
  if (contentLower.includes("exit") || contentLower.includes("acquired") ||
      contentLower.includes("ipo") || contentLower.includes("sold")) {
    findings.hasSerialFounders = true;

    // Try to find exit values
    const exitMatch = trackRecordContent.match(/\$(\d+(?:\.\d+)?)\s*(million|billion|M|B)/i);
    if (exitMatch && findings.founders.length > 0) {
      const exitValue = `$${exitMatch[1]}${exitMatch[2].charAt(0).toUpperCase()}`;
      findings.founders[0].trackRecord.largestExitValue = exitValue;
      findings.founders[0].trackRecord.successfulExits = 1;
      findings.founders[0].highlights.push(`Previous exit: ${exitValue}`);
    }
  }

  // Look for VC backing mentions
  if (contentLower.includes("venture") || contentLower.includes("series a") ||
      contentLower.includes("series b") || contentLower.includes("raised")) {
    findings.hasVCBackedFounders = true;
  }
}

function generateTeamStrengths(findings: TeamFoundersFindings): string[] {
  const strengths: string[] = [];

  if (findings.hasSerialFounders) {
    strengths.push("Serial founder with proven exit track record");
  }

  if (findings.hasVCBackedFounders) {
    strengths.push("Experience scaling VC-backed companies");
  }

  if (findings.founders.length >= 2) {
    strengths.push("Multiple co-founders for risk distribution");
  }

  if (findings.averageExperience >= 10) {
    strengths.push("Highly experienced leadership team");
  } else if (findings.averageExperience >= 5) {
    strengths.push("Experienced leadership team");
  }

  // Check for technical co-founders
  const hasTechnicalCofounder = findings.founders.some(f =>
    f.currentRole.toLowerCase().includes("cto") ||
    f.currentRole.toLowerCase().includes("technical") ||
    f.currentRole.toLowerCase().includes("engineer")
  );
  if (hasTechnicalCofounder) {
    strengths.push("Technical co-founder for product development");
  }

  // Check for diverse roles
  const hasBusinessFounder = findings.founders.some(f =>
    f.currentRole.toLowerCase().includes("ceo") ||
    f.currentRole.toLowerCase().includes("business") ||
    f.currentRole.toLowerCase().includes("operations")
  );
  if (hasBusinessFounder && hasTechnicalCofounder) {
    strengths.push("Balanced technical and business leadership");
  }

  return strengths.slice(0, 5);
}

function generateTeamGaps(findings: TeamFoundersFindings): string[] {
  const gaps: string[] = [];

  if (findings.founders.length === 0) {
    gaps.push("Founder information not publicly available");
  } else if (findings.founders.length === 1) {
    gaps.push("Single founder risk - no co-founder identified");
  }

  // Check for missing C-suite roles
  const allMembers = [...findings.founders, ...findings.executives];
  const roles = allMembers.map(m => m.currentRole.toLowerCase());

  if (!roles.some(r => r.includes("cfo") || r.includes("finance"))) {
    gaps.push("No identified CFO/Finance leadership");
  }

  if (!roles.some(r => r.includes("cto") || r.includes("technical") || r.includes("engineering"))) {
    gaps.push("No identified technical leadership");
  }

  if (!findings.hasSerialFounders) {
    gaps.push("No prior successful exits identified");
  }

  if (findings.boardMembers.length === 0) {
    gaps.push("No board members identified - governance structure unclear");
  }

  return gaps.slice(0, 4);
}

function generateKeyPersonRisk(findings: TeamFoundersFindings): string[] {
  const risks: string[] = [];

  if (findings.founders.length === 1) {
    risks.push(`Single founder dependency on ${findings.founders[0].name}`);
  }

  // CEO risk
  const ceo = [...findings.founders, ...findings.executives].find(m =>
    m.currentRole.toLowerCase().includes("ceo")
  );
  if (ceo) {
    risks.push(`CEO key person risk: ${ceo.name}`);
  }

  // Check for verified red flags
  for (const member of [...findings.founders, ...findings.executives]) {
    for (const flag of member.redFlags) {
      risks.push(`${member.name}: ${flag}`);
    }
  }

  return risks.slice(0, 3);
}

function generateFounderMarketFit(
  findings: TeamFoundersFindings,
  entityContext: any
): string {
  const positives: string[] = [];
  const negatives: string[] = [];

  if (findings.hasSerialFounders) {
    positives.push("serial entrepreneur background");
  }

  if (findings.hasVCBackedFounders) {
    positives.push("VC scaling experience");
  }

  if (findings.averageExperience >= 10) {
    positives.push("deep industry experience");
  }

  // Check for domain expertise match
  if (entityContext?.sectors) {
    const sectors = entityContext.sectors.join(", ").toLowerCase();
    const domainMatch = findings.founders.some(f =>
      f.trackRecord.domainExpertise.some(d =>
        sectors.includes(d.toLowerCase())
      )
    );
    if (domainMatch) {
      positives.push("domain expertise alignment");
    }
  }

  if (findings.founders.length === 0) {
    return "Founder-market fit assessment pending - founder data needed";
  }

  if (positives.length === 0) {
    return "Limited data available for founder-market fit assessment";
  }

  return `Strong founder-market fit: ${positives.join(", ")}`;
}

function generateTrackRecordSummary(findings: TeamFoundersFindings): string {
  if (findings.founders.length === 0) {
    return "Track record data pending founder identification";
  }

  const summaryParts: string[] = [];

  const totalExits = findings.founders.reduce((sum, f) =>
    sum + (f.trackRecord?.successfulExits || 0), 0);

  if (totalExits > 0) {
    summaryParts.push(`${totalExits} successful exit${totalExits > 1 ? "s" : ""}`);
  }

  if (findings.hasSerialFounders) {
    summaryParts.push("serial entrepreneur(s)");
  }

  if (findings.averageExperience > 0) {
    summaryParts.push(`avg ${findings.averageExperience}+ years experience`);
  }

  if (summaryParts.length === 0) {
    return "First-time founders - track record building";
  }

  return `Leadership team: ${summaryParts.join(", ")}`;
}

// ============================================================================
// Source Inference
// ============================================================================

function inferSourceType(url?: string): SourceType {
  if (!url) return "llm_inference";

  const urlLower = url.toLowerCase();

  if (urlLower.includes("linkedin.com")) return "linkedin";
  if (urlLower.includes("crunchbase.com")) return "crunchbase";
  if (urlLower.includes("pitchbook.com")) return "pitchbook";
  if (urlLower.includes("sec.gov")) return "sec_filing";

  return "news_article";
}

function inferReliability(url?: string): SourceReliability {
  if (!url) return "inferred";

  const urlLower = url.toLowerCase();

  if (urlLower.includes("linkedin.com")) return "reliable";
  if (urlLower.includes("crunchbase.com")) return "reliable";
  if (urlLower.includes("pitchbook.com")) return "reliable";
  if (urlLower.includes("sec.gov")) return "authoritative";
  if (urlLower.includes("forbes.com") ||
      urlLower.includes("bloomberg.com") ||
      urlLower.includes("techcrunch.com")) {
    return "reliable";
  }

  return "secondary";
}

// ============================================================================
// Confidence Calculation
// ============================================================================

function calculateConfidence(
  findings: TeamFoundersFindings,
  sources: DDSource[]
): number {
  let confidence = 0.3;

  // Founders identified
  if (findings.founders.length > 0) confidence += 0.2;
  if (findings.founders.length >= 2) confidence += 0.1;

  // Executives identified
  if (findings.executives.length > 0) confidence += 0.1;

  // Track record data
  if (findings.hasSerialFounders) confidence += 0.1;

  // Team strengths identified
  if (findings.teamStrengths.length >= 2) confidence += 0.1;

  // Source quality
  const linkedinSources = sources.filter(s => s.sourceType === "linkedin").length;
  const reliableSources = sources.filter(s => s.reliability === "reliable" || s.reliability === "authoritative").length;

  confidence += Math.min(0.1, linkedinSources * 0.05);
  confidence += Math.min(0.1, reliableSources * 0.02);

  return Math.min(0.95, confidence);
}
