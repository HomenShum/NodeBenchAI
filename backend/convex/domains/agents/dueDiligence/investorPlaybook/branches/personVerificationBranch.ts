/**
 * Person Verification Branch
 * 
 * Verifies professional identity and background of individuals
 * using LinkedIn and other professional sources.
 */

import { api } from "../../../../../_generated/api";
import { DDSource, SourceReliability } from "../../types";
import { PersonVerificationFindings } from "../types";

type InternalReliability = "authoritative" | "reputable" | "unknown";

function mapToSourceReliability(internal: InternalReliability): SourceReliability {
  switch (internal) {
    case "authoritative": return "authoritative";
    case "reputable": return "reliable";
    case "unknown": return "secondary";
  }
}

function normalizeForComparison(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatchesPersonName(title: string, personName: string): boolean {
  const t = normalizeForComparison(title);
  const p = normalizeForComparison(personName);
  if (!t || !p) return false;
  const tokens = p.split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every(tok => t.includes(tok));
}

function normalizeLinkedInUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
}

function parseLinkedInRoleCompanyFromTitle(
  title: string,
  personName: string
): { role?: string; company?: string } {
  const cleaned = (title || "")
    .replace(/\s*\|\s*LinkedIn\s*$/i, "")
    .replace(/\s*\|\s*LinkedIn\s*$/i, "")
    .trim();

  if (!cleaned) return {};

  // Common patterns:
  // - "Name - Role - Company"
  // - "Name - Role at Company"
  // - "Name – Role – Company"
  const parts = cleaned.split(/\s[-–—]\s/).map(p => p.trim()).filter(Boolean);

  if (parts.length >= 3 && titleMatchesPersonName(parts[0], personName)) {
    return { role: parts[1], company: parts[2] };
  }

  if (parts.length >= 2 && titleMatchesPersonName(parts[0], personName)) {
    const rhs = parts.slice(1).join(" - ");
    const atMatch = rhs.match(/(.+?)\s+at\s+(.+)/i);
    if (atMatch) {
      return { role: atMatch[1].trim(), company: atMatch[2].trim() };
    }
    return { role: rhs.trim() };
  }

  // Fallback: try to find "Role at Company" anywhere
  const atMatch = cleaned.match(/(?:^|[-–—]\s*)(.+?)\s+at\s+(.+)$/i);
  if (atMatch) {
    return { role: atMatch[1].trim(), company: atMatch[2].trim() };
  }

  return {};
}

function parseRoleCompanyFromSnippet(snippet: string): { role?: string; company?: string } {
  const s = (snippet || "").replace(/\s+/g, " ").trim();
  if (!s) return {};

  // Look for "... VP of X at Meta ..." / "... at Meta ..." patterns
  const atMatch = s.match(/\b(?:at|@)\s+([A-Z][A-Za-z0-9&.\- ]{1,80})\b/);
  const company = atMatch?.[1]?.trim();

  const roleMatch = s.match(/\b(VP|Vice President|SVP|EVP|Director|Head|Chief|CTO|CFO|CEO|President)\b[^.]{0,80}\b/i);
  const role = roleMatch?.[0]?.trim();

  return {
    role,
    company,
  };
}

function cleanRoleCompanyPair(input: {
  role?: string;
  company?: string;
  claimedCompany?: string;
}): { role?: string; company?: string } {
  let role = (input.role || "").replace(/\s+/g, " ").trim();
  let company = (input.company || "").replace(/\s+/g, " ").trim();

  if (company.toLowerCase().includes(" at ")) {
    // Avoid capturing "at X at Y" fragments; keep the first segment.
    company = company.split(/\s+at\s+/i)[0].trim();
  }

  const roleKeywords = /(vp|vice president|svp|evp|director|head|chief|cto|cfo|ceo|president|founder|engineer|manager|officer)/i;
  const looksLikeRole = (text: string) => Boolean(text) && roleKeywords.test(text);
  const looksLikeCompany = (text: string) =>
    Boolean(text) && !roleKeywords.test(text) && !/\bat\s+/.test(text.toLowerCase());

  // If we likely swapped role/company, swap back.
  if (role && company && !looksLikeRole(role) && looksLikeRole(company)) {
    const tmp = role;
    role = company;
    company = tmp;
  }

  // If claimed company is provided and appears anywhere, prefer it.
  if (input.claimedCompany) {
    const claimed = input.claimedCompany.trim();
    const claimedLower = claimed.toLowerCase();
    if (company.toLowerCase().includes(claimedLower) || role.toLowerCase().includes(claimedLower)) {
      company = claimed;
      if (!looksLikeRole(role) && looksLikeCompany(role)) {
        role = "";
      }
    }
  }

  return {
    role: role || undefined,
    company: company || undefined,
  };
}

interface PersonVerificationResult {
  findings: PersonVerificationFindings;
  sources: DDSource[];
  confidence: number;
}

/**
 * Execute person verification branch
 */
export async function executePersonVerificationBranch(
  ctx: any,
  personName: string,
  linkedInUrl?: string,
  claimedRole?: string,
  claimedCompany?: string
): Promise<PersonVerificationResult> {
  const sources: DDSource[] = [];
  const professionalBackground: PersonVerificationFindings["professionalBackground"] = [];
  const publicStatements: PersonVerificationFindings["publicStatements"] = [];
  const redFlags: PersonVerificationFindings["redFlags"] = [];
  
  let verified = false;
  let currentRole: string | undefined;
  let currentCompany: string | undefined;
  let confidenceScore = 0.3;

  try {
    // Search for person's professional information
    const searchQueries = [
      `"${personName}" ${claimedCompany || ""} ${claimedRole || ""} LinkedIn`,
      `"${personName}" ${claimedCompany || ""} executive profile`,
    ];

    const normalizedExpectedLinkedIn = normalizeLinkedInUrl(linkedInUrl);
    let foundCredibleLinkedIn = false;

    for (const query of searchQueries) {
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

        const isLinkedIn = url.toLowerCase().includes("linkedin.com");
        sources.push({
          sourceType: isLinkedIn ? "linkedin" : "news_article",
          title,
          url,
          accessedAt: Date.now(),
          reliability: mapToSourceReliability(getSourceReliability(url)),
        });

        // Check LinkedIn
        if (isLinkedIn) {
          const normalizedResultUrl = normalizeLinkedInUrl(url);
          const urlMatchesExpected =
            Boolean(normalizedExpectedLinkedIn) &&
            Boolean(normalizedResultUrl) &&
            normalizedResultUrl === normalizedExpectedLinkedIn;
          const titleMatches = titleMatchesPersonName(title, personName);

          // Only treat LinkedIn as identity verification if it matches the expected profile or the name.
          if (urlMatchesExpected || titleMatches) {
            foundCredibleLinkedIn = true;
            verified = true;
            confidenceScore = Math.max(confidenceScore, urlMatchesExpected ? 0.9 : 0.85);

            const fromTitle = parseLinkedInRoleCompanyFromTitle(title, personName);
            const fromSnippet = parseRoleCompanyFromSnippet(snippet);
            const cleaned = cleanRoleCompanyPair({
              role: fromTitle.role || fromSnippet.role,
              company: fromTitle.company || fromSnippet.company,
              claimedCompany,
            });
            currentRole = cleaned.role || currentRole;
            currentCompany = cleaned.company || currentCompany;
          }
        }

        // Extract professional background mentions
        const combinedText = `${title} ${snippet}`.toLowerCase();
        if (claimedCompany && combinedText.includes(claimedCompany.toLowerCase())) {
          professionalBackground.push({
            role: claimedRole || "Unknown role",
            company: claimedCompany,
            verified: true,
            source: url,
          });
        }

        // Look for public statements/interviews
        if (/interview|podcast|talk|keynote|statement/i.test(combinedText)) {
          publicStatements.push({
            topic: title.slice(0, 100),
            source: extractDomain(url),
            url,
          });
        }
      }
    }

    // If no credible LinkedIn match was found, downgrade "verified" to avoid false positives.
    if (verified && !foundCredibleLinkedIn && linkedInUrl) {
      verified = false;
      confidenceScore = Math.min(confidenceScore, 0.55);
      redFlags.push({
        type: "identity_mismatch",
        severity: "medium",
        description: "LinkedIn results found but none matched the expected profile/name with high confidence",
      });
    }

    // Verify claimed role matches
    if (claimedRole && currentRole) {
      const rolesMatch = currentRole.toLowerCase().includes(claimedRole.toLowerCase()) ||
                        claimedRole.toLowerCase().includes(currentRole.toLowerCase());
      if (!rolesMatch) {
        redFlags.push({
          type: "role_mismatch",
          severity: "medium",
          description: `Claimed role "${claimedRole}" doesn't match found role "${currentRole}"`,
        });
        confidenceScore *= 0.8;
      }
    }

    // Verify claimed company matches
    if (claimedCompany && currentCompany) {
      const companiesMatch = currentCompany.toLowerCase().includes(claimedCompany.toLowerCase()) ||
                            claimedCompany.toLowerCase().includes(currentCompany.toLowerCase());
      if (!companiesMatch) {
        redFlags.push({
          type: "company_mismatch",
          severity: "medium",
          description: `Claimed company "${claimedCompany}" doesn't match found company "${currentCompany}"`,
        });
        confidenceScore *= 0.8;
      }
    }

    return {
      findings: {
        name: personName,
        linkedInUrl,
        currentRole,
        currentCompany,
        verified,
        professionalBackground,
        publicStatements,
        redFlags,
        confidenceScore,
      },
      sources,
      confidence: confidenceScore,
    };
  } catch (error) {
    console.error("[PersonVerification] Error:", error);
    return {
      findings: {
        name: personName,
        verified: false,
        professionalBackground: [],
        redFlags: [],
        confidenceScore: 0,
      },
      sources,
      confidence: 0,
    };
  }
}

function getSourceReliability(url: string): InternalReliability {
  if (url.includes("linkedin.com")) return "authoritative";
  if (url.includes("crunchbase.com")) return "reputable";
  if (url.includes("bloomberg.com") || url.includes("reuters.com")) return "authoritative";
  return "unknown";
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "Unknown";
  }
}
