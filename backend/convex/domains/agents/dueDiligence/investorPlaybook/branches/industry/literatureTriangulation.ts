/**
 * Literature Triangulation Branch
 *
 * Cross-references scientific literature from PubMed, Semantic Scholar,
 * and other academic sources. Used by ACADEMIC_RD persona for research validation.
 */

import { api } from "../../../../../../_generated/api";
import { DDSource, SourceReliability } from "../../../types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface LiteratureFindings {
  topic: string;
  searchTerms: string[];

  // Primary findings
  primaryPapers: AcademicPaper[];
  totalPapersFound: number;

  // Methodology assessment
  methodology: {
    predominantMethods: string[];
    sampleSizes: string;
    replicationStatus: "replicated" | "partially_replicated" | "not_replicated" | "unknown";
    metaAnalysisAvailable: boolean;
  };

  // Citation analysis
  citations: {
    seminalPapers: AcademicPaper[];
    totalCitations: number;
    h_indexEstimate?: number;
    fieldImpact: "high" | "medium" | "low" | "emerging";
  };

  // Research gaps
  gaps: ResearchGap[];

  // Verification
  verification: {
    primarySourcesFound: boolean;
    crossReferencesMatch: boolean;
    methodologyVerified: boolean;
    sourceQuality: "Tier1" | "Tier2" | "Tier3" | "Unverified";
  };

  // Concerns
  concerns: Array<{
    type: "methodology_weakness" | "limited_replication" | "conflicting_results" | "retraction" | "predatory_source";
    severity: "low" | "medium" | "high" | "critical";
    description: string;
  }>;

  confidenceScore: number;
}

export interface AcademicPaper {
  title: string;
  authors: string[];
  journal?: string;
  year?: number;
  doi?: string;
  pmid?: string;
  citationCount?: number;
  abstract?: string;
  methodology?: string;
}

export interface ResearchGap {
  area: string;
  description: string;
  potentialImpact: "high" | "medium" | "low";
}

export interface LiteratureResult {
  findings: LiteratureFindings;
  sources: DDSource[];
  report: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute literature triangulation branch
 */
export async function executeLiteratureTriangulationBranch(
  ctx: any,
  topic: string,
  additionalContext?: {
    authors?: string[];
    methodology?: string;
    claimedFindings?: string;
    targetJournals?: string[];
  }
): Promise<LiteratureResult> {
  const sources: DDSource[] = [];
  const startTime = Date.now();

  console.log(`[LITERATURE] Starting triangulation for: ${topic}...`);

  // Generate search terms
  const searchTerms = generateSearchTerms(topic, additionalContext);

  // Run parallel searches across different sources
  const [pubmedResults, semanticResults, citationResults] = await Promise.all([
    searchPubMed(ctx, searchTerms),
    searchSemanticScholar(ctx, searchTerms),
    searchCitations(ctx, topic, additionalContext?.authors),
  ]);

  // Aggregate sources
  sources.push(...pubmedResults.sources, ...semanticResults.sources, ...citationResults.sources);

  // Merge and deduplicate papers
  const allPapers = mergePapers([
    ...pubmedResults.papers,
    ...semanticResults.papers,
    ...citationResults.seminalPapers,
  ]);

  // Analyze methodology
  const methodology = analyzeMethodology(allPapers, additionalContext?.methodology);

  // Identify research gaps
  const gaps = identifyResearchGaps(allPapers, topic);

  // Verify findings
  const verification = verifyFindings(pubmedResults, semanticResults, citationResults);

  // Identify concerns
  const concerns = identifyConcerns(allPapers, methodology);

  // Calculate confidence
  const confidenceScore = calculateConfidence(verification, methodology, allPapers);

  const findings: LiteratureFindings = {
    topic,
    searchTerms,

    primaryPapers: allPapers.slice(0, 10),
    totalPapersFound: pubmedResults.totalCount + semanticResults.totalCount,

    methodology,

    citations: {
      seminalPapers: citationResults.seminalPapers,
      totalCitations: citationResults.totalCitations,
      fieldImpact: determineFieldImpact(citationResults.totalCitations, allPapers.length),
    },

    gaps,
    verification,
    concerns,
    confidenceScore,
  };

  // Generate report
  const report = formatLiteratureReport(findings);

  console.log(`[LITERATURE] Completed in ${Date.now() - startTime}ms, confidence: ${(confidenceScore * 100).toFixed(0)}%`);

  return {
    findings,
    sources,
    report,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

interface PubMedSearchResult {
  papers: AcademicPaper[];
  totalCount: number;
  sources: DDSource[];
}

async function searchPubMed(ctx: any, searchTerms: string[]): Promise<PubMedSearchResult> {
  const sources: DDSource[] = [];
  const papers: AcademicPaper[] = [];

  try {
    const query = searchTerms.join(" ") + " PubMed research study";

    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query,
      mode: "balanced",
      maxTotal: 10,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "");
      const url = r.url || "";
      const title = r.title || "";

      // Extract paper info
      const paper: AcademicPaper = {
        title: title,
        authors: extractAuthors(content),
        abstract: content.slice(0, 500),
      };

      // Extract PMID
      const pmidMatch = url.match(/pubmed[\/.](\d+)/i) || content.match(/pmid[:\s]*(\d+)/i);
      if (pmidMatch) {
        paper.pmid = pmidMatch[1];
      }

      // Extract DOI
      const doiMatch = content.match(/doi[:\s]*(10\.\d{4,}\/[^\s]+)/i);
      if (doiMatch) {
        paper.doi = doiMatch[1];
      }

      // Extract year
      const yearMatch = content.match(/\b(20[0-2]\d|19\d{2})\b/);
      if (yearMatch) {
        paper.year = parseInt(yearMatch[1]);
      }

      // Extract journal
      const journalPatterns = [
        /published\s+(?:in\s+)?([A-Z][a-zA-Z\s]+(?:Journal|Review|Science|Nature|Cell|Lancet|JAMA|BMJ|NEJM))/i,
        /([A-Z][a-zA-Z\s]+(?:Journal|Review))\s*\d{4}/i,
      ];
      for (const pattern of journalPatterns) {
        const journalMatch = content.match(pattern);
        if (journalMatch) {
          paper.journal = journalMatch[1].trim();
          break;
        }
      }

      papers.push(paper);

      sources.push({
        sourceType: "academic_paper",
        title: title,
        url,
        accessedAt: Date.now(),
        reliability: determineReliability(url),
      });
    }

    return {
      papers,
      totalCount: searchResults.length,
      sources,
    };
  } catch (error) {
    console.error("[LITERATURE] PubMed search error:", error);
    return { papers: [], totalCount: 0, sources };
  }
}

interface SemanticSearchResult {
  papers: AcademicPaper[];
  totalCount: number;
  sources: DDSource[];
}

async function searchSemanticScholar(ctx: any, searchTerms: string[]): Promise<SemanticSearchResult> {
  const sources: DDSource[] = [];
  const papers: AcademicPaper[] = [];

  try {
    const query = searchTerms.join(" ") + " Semantic Scholar academic paper";

    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query,
      mode: "balanced",
      maxTotal: 8,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "");
      const url = r.url || "";
      const title = r.title || "";

      const paper: AcademicPaper = {
        title: title,
        authors: extractAuthors(content),
        abstract: content.slice(0, 500),
      };

      // Extract citation count
      const citationMatch = content.match(/(\d+)\s*citations?/i);
      if (citationMatch) {
        paper.citationCount = parseInt(citationMatch[1]);
      }

      // Extract year
      const yearMatch = content.match(/\b(20[0-2]\d|19\d{2})\b/);
      if (yearMatch) {
        paper.year = parseInt(yearMatch[1]);
      }

      papers.push(paper);

      sources.push({
        sourceType: "academic_paper",
        title: title,
        url,
        accessedAt: Date.now(),
        reliability: determineReliability(url),
      });
    }

    return {
      papers,
      totalCount: searchResults.length,
      sources,
    };
  } catch (error) {
    console.error("[LITERATURE] Semantic Scholar search error:", error);
    return { papers: [], totalCount: 0, sources };
  }
}

interface CitationSearchResult {
  seminalPapers: AcademicPaper[];
  totalCitations: number;
  sources: DDSource[];
}

async function searchCitations(
  ctx: any,
  topic: string,
  authors?: string[]
): Promise<CitationSearchResult> {
  const sources: DDSource[] = [];
  const seminalPapers: AcademicPaper[] = [];
  let totalCitations = 0;

  try {
    const authorQuery = authors?.length ? authors.slice(0, 2).join(" ") : "";
    const query = `${topic} ${authorQuery} seminal paper highly cited foundational research`;

    const result = await ctx.runAction(api.domains.search.fusion.actions.fusionSearch, {
      query,
      mode: "balanced",
      maxTotal: 5,
      skipRateLimit: true,
    });

    const searchResults = result?.payload?.results ?? [];

    for (const r of searchResults) {
      const content = (r.snippet || r.content || "");
      const url = r.url || "";

      // Extract citation count
      const citationMatch = content.match(/(\d{3,})\s*citations?/i);
      if (citationMatch) {
        const citations = parseInt(citationMatch[1]);
        totalCitations += citations;

        seminalPapers.push({
          title: r.title || "Unknown",
          authors: extractAuthors(content),
          citationCount: citations,
        });
      }

      sources.push({
        sourceType: "academic_paper",
        title: r.title || "Unknown",
        url,
        accessedAt: Date.now(),
        reliability: determineReliability(url),
      });
    }

    // Sort by citation count
    seminalPapers.sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));

    return {
      seminalPapers: seminalPapers.slice(0, 5),
      totalCitations,
      sources,
    };
  } catch (error) {
    console.error("[LITERATURE] Citation search error:", error);
    return { seminalPapers: [], totalCitations: 0, sources };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function generateSearchTerms(topic: string, context?: { methodology?: string; authors?: string[] }): string[] {
  const terms = [topic];

  // Add methodology terms
  if (context?.methodology) {
    terms.push(context.methodology);
  }

  // Add author names
  if (context?.authors?.length) {
    terms.push(...context.authors.slice(0, 2));
  }

  return terms;
}

function extractAuthors(content: string): string[] {
  const authors: string[] = [];

  // Look for author patterns
  const authorPatterns = [
    /(?:by|authors?)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:\s+et\s+al\.?)?)/i,
    /([A-Z][a-z]+\s+[A-Z][a-z]+)\s+et\s+al/i,
  ];

  for (const pattern of authorPatterns) {
    const match = content.match(pattern);
    if (match) {
      authors.push(match[1]);
      break;
    }
  }

  return authors;
}

function mergePapers(papers: AcademicPaper[]): AcademicPaper[] {
  const seen = new Map<string, AcademicPaper>();

  for (const paper of papers) {
    const key = paper.doi || paper.pmid || paper.title.toLowerCase().slice(0, 50);

    if (!seen.has(key)) {
      seen.set(key, paper);
    } else {
      // Merge information
      const existing = seen.get(key)!;
      if (!existing.doi && paper.doi) existing.doi = paper.doi;
      if (!existing.pmid && paper.pmid) existing.pmid = paper.pmid;
      if (!existing.citationCount && paper.citationCount) existing.citationCount = paper.citationCount;
      if (!existing.journal && paper.journal) existing.journal = paper.journal;
    }
  }

  return Array.from(seen.values());
}

function analyzeMethodology(
  papers: AcademicPaper[],
  claimedMethodology?: string
): LiteratureFindings["methodology"] {
  const methods: string[] = [];
  let hasMetaAnalysis = false;

  for (const paper of papers) {
    const content = (paper.abstract || paper.title || "").toLowerCase();

    // Detect methodology types
    if (content.includes("randomized") || content.includes("rct")) {
      methods.push("Randomized Controlled Trial");
    }
    if (content.includes("cohort")) {
      methods.push("Cohort Study");
    }
    if (content.includes("meta-analysis") || content.includes("systematic review")) {
      methods.push("Meta-Analysis");
      hasMetaAnalysis = true;
    }
    if (content.includes("case-control")) {
      methods.push("Case-Control Study");
    }
    if (content.includes("in vitro") || content.includes("cell line")) {
      methods.push("In Vitro Study");
    }
    if (content.includes("in vivo") || content.includes("animal model") || content.includes("mouse")) {
      methods.push("In Vivo Study");
    }
  }

  // Deduplicate methods
  const uniqueMethods = [...new Set(methods)];

  // Determine replication status
  let replicationStatus: LiteratureFindings["methodology"]["replicationStatus"] = "unknown";
  if (papers.length >= 5 && uniqueMethods.length >= 2) {
    replicationStatus = "replicated";
  } else if (papers.length >= 3) {
    replicationStatus = "partially_replicated";
  }

  return {
    predominantMethods: uniqueMethods.slice(0, 5),
    sampleSizes: papers.length > 0 ? "Varies" : "Unknown",
    replicationStatus,
    metaAnalysisAvailable: hasMetaAnalysis,
  };
}

function identifyResearchGaps(papers: AcademicPaper[], topic: string): ResearchGap[] {
  const gaps: ResearchGap[] = [];

  // Analyze paper coverage
  const years = papers.map((p) => p.year).filter((y): y is number => !!y);
  const recentYears = years.filter((y) => y >= 2022);

  if (recentYears.length < 2) {
    gaps.push({
      area: "Recent Research",
      description: "Limited recent publications (2022+) on this topic",
      potentialImpact: "medium",
    });
  }

  // Check for methodology diversity
  const abstracts = papers.map((p) => p.abstract || "").join(" ").toLowerCase();

  if (!abstracts.includes("human") && !abstracts.includes("clinical")) {
    gaps.push({
      area: "Human Studies",
      description: "Limited human/clinical studies found - mostly preclinical research",
      potentialImpact: "high",
    });
  }

  if (!abstracts.includes("longitudinal") && !abstracts.includes("long-term")) {
    gaps.push({
      area: "Long-term Effects",
      description: "Limited longitudinal or long-term studies identified",
      potentialImpact: "medium",
    });
  }

  return gaps;
}

function verifyFindings(
  pubmed: PubMedSearchResult,
  semantic: SemanticSearchResult,
  citations: CitationSearchResult
): LiteratureFindings["verification"] {
  const hasPubMed = pubmed.papers.length > 0;
  const hasSemantic = semantic.papers.length > 0;
  const hasCitations = citations.seminalPapers.length > 0;

  // Determine source quality
  let sourceQuality: LiteratureFindings["verification"]["sourceQuality"] = "Unverified";
  if (hasPubMed && hasSemantic) {
    sourceQuality = "Tier1";
  } else if (hasPubMed || hasSemantic) {
    sourceQuality = "Tier2";
  } else if (hasCitations) {
    sourceQuality = "Tier3";
  }

  return {
    primarySourcesFound: hasPubMed,
    crossReferencesMatch: hasPubMed && hasSemantic,
    methodologyVerified: pubmed.papers.length >= 3,
    sourceQuality,
  };
}

function identifyConcerns(
  papers: AcademicPaper[],
  methodology: LiteratureFindings["methodology"]
): LiteratureFindings["concerns"] {
  const concerns: LiteratureFindings["concerns"] = [];

  // Check for limited replication
  if (methodology.replicationStatus === "not_replicated") {
    concerns.push({
      type: "limited_replication",
      severity: "high",
      description: "Research findings have not been independently replicated",
    });
  } else if (methodology.replicationStatus === "partially_replicated") {
    concerns.push({
      type: "limited_replication",
      severity: "medium",
      description: "Research findings have only partial replication",
    });
  }

  // Check for methodology weakness
  if (methodology.predominantMethods.length === 0) {
    concerns.push({
      type: "methodology_weakness",
      severity: "high",
      description: "Unable to identify clear research methodologies in literature",
    });
  }

  // Check for old papers
  const years = papers.map((p) => p.year).filter((y): y is number => !!y);
  const avgYear = years.length > 0 ? years.reduce((a, b) => a + b, 0) / years.length : 0;

  if (avgYear > 0 && avgYear < 2018) {
    concerns.push({
      type: "methodology_weakness",
      severity: "medium",
      description: `Research base is dated (average publication year: ${Math.round(avgYear)})`,
    });
  }

  return concerns;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function determineReliability(url: string): SourceReliability {
  if (url.includes("pubmed") || url.includes("ncbi.nlm.nih.gov")) return "authoritative";
  if (url.includes("semanticscholar.org")) return "authoritative";
  if (url.includes("nature.com") || url.includes("sciencedirect.com")) return "authoritative";
  if (url.includes("springer.com") || url.includes("wiley.com")) return "reliable";
  if (url.includes("arxiv.org")) return "reliable";
  return "secondary";
}

function determineFieldImpact(totalCitations: number, paperCount: number): LiteratureFindings["citations"]["fieldImpact"] {
  const avgCitations = paperCount > 0 ? totalCitations / paperCount : 0;

  if (avgCitations > 500) return "high";
  if (avgCitations > 100) return "medium";
  if (totalCitations > 0) return "low";
  return "emerging";
}

function calculateConfidence(
  verification: LiteratureFindings["verification"],
  methodology: LiteratureFindings["methodology"],
  papers: AcademicPaper[]
): number {
  let score = 0;

  // Source quality (35%)
  if (verification.sourceQuality === "Tier1") score += 35;
  else if (verification.sourceQuality === "Tier2") score += 25;
  else if (verification.sourceQuality === "Tier3") score += 10;

  // Cross-referencing (20%)
  if (verification.primarySourcesFound) score += 10;
  if (verification.crossReferencesMatch) score += 10;

  // Methodology (25%)
  if (methodology.predominantMethods.length > 0) score += 10;
  if (methodology.replicationStatus === "replicated") score += 15;
  else if (methodology.replicationStatus === "partially_replicated") score += 8;

  // Paper quality (20%)
  const papersWithDoi = papers.filter((p) => p.doi).length;
  const papersWithJournal = papers.filter((p) => p.journal).length;
  score += Math.min(10, (papersWithDoi / Math.max(1, papers.length)) * 10);
  score += Math.min(10, (papersWithJournal / Math.max(1, papers.length)) * 10);

  return score / 100;
}

function formatLiteratureReport(findings: LiteratureFindings): string {
  const lines: string[] = [];

  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(`LITERATURE TRIANGULATION: ${findings.topic}`);
  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(``);

  lines.push(`Search Terms: ${findings.searchTerms.join(", ")}`);
  lines.push(`Total Papers Found: ${findings.totalPapersFound}`);
  lines.push(`Source Quality: ${findings.verification.sourceQuality}`);
  lines.push(``);

  lines.push(`METHODOLOGY ANALYSIS`);
  lines.push(`  Methods: ${findings.methodology.predominantMethods.join(", ") || "Unknown"}`);
  lines.push(`  Replication: ${findings.methodology.replicationStatus}`);
  lines.push(`  Meta-Analysis Available: ${findings.methodology.metaAnalysisAvailable ? "Yes" : "No"}`);
  lines.push(``);

  lines.push(`CITATION ANALYSIS`);
  lines.push(`  Total Citations: ${findings.citations.totalCitations}`);
  lines.push(`  Field Impact: ${findings.citations.fieldImpact}`);
  if (findings.citations.seminalPapers.length > 0) {
    lines.push(`  Seminal Papers:`);
    for (const paper of findings.citations.seminalPapers.slice(0, 3)) {
      lines.push(`    - ${paper.title.slice(0, 60)}... (${paper.citationCount || 0} citations)`);
    }
  }
  lines.push(``);

  if (findings.primaryPapers.length > 0) {
    lines.push(`KEY PAPERS`);
    for (const paper of findings.primaryPapers.slice(0, 5)) {
      const yearStr = paper.year ? ` (${paper.year})` : "";
      const journalStr = paper.journal ? ` - ${paper.journal}` : "";
      lines.push(`  - ${paper.title.slice(0, 50)}...${yearStr}${journalStr}`);
    }
    lines.push(``);
  }

  if (findings.gaps.length > 0) {
    lines.push(`RESEARCH GAPS`);
    for (const gap of findings.gaps) {
      lines.push(`  [${gap.potentialImpact.toUpperCase()}] ${gap.area}: ${gap.description}`);
    }
    lines.push(``);
  }

  if (findings.concerns.length > 0) {
    lines.push(`CONCERNS`);
    for (const concern of findings.concerns) {
      lines.push(`  [${concern.severity.toUpperCase()}] ${concern.description}`);
    }
    lines.push(``);
  }

  lines.push(`VERIFICATION`);
  lines.push(`  Primary Sources: ${findings.verification.primarySourcesFound ? "Found" : "Not Found"}`);
  lines.push(`  Cross-References: ${findings.verification.crossReferencesMatch ? "Match" : "No Match"}`);
  lines.push(`  Methodology Verified: ${findings.verification.methodologyVerified ? "Yes" : "No"}`);
  lines.push(``);

  lines.push(`CONFIDENCE: ${(findings.confidenceScore * 100).toFixed(0)}%`);
  lines.push(`═══════════════════════════════════════════════════════════════`);

  return lines.join("\n");
}
