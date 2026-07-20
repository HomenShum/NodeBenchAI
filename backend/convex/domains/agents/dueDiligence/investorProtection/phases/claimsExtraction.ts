/**
 * Claims Extraction Phase
 *
 * Extracts structured claims from pitch materials using LLM.
 * Phase 0 of the investor protection verification workflow.
 */

import type { ExtractedClaims, FDAClaim, PatentClaim, SecFilingType } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTION PROMPT
// ═══════════════════════════════════════════════════════════════════════════

const CLAIMS_EXTRACTION_PROMPT = `
You are an investor protection analyst extracting claims from startup pitch materials.

Analyze the provided text and extract all verifiable claims into a structured format.
Focus on claims that can be verified against authoritative sources:
- Corporate entity claims (incorporation state, date)
- Securities/fundraising claims (Reg CF, Reg D, funding portal)
- FDA claims (510(k) clearance, registration, approval)
- Patent claims (patent numbers, pending applications)
- Revenue/traction claims (if specific numbers mentioned)

For each claim type, extract:
1. The exact claim made
2. Any specific identifiers (K-numbers, patent numbers, etc.)
3. The confidence level of your extraction

Return JSON in this exact format:
{
  "companyName": "string - primary company name",
  "companyNameVariants": ["array of alternative names/DBAs"],
  "incorporationState": "two-letter state code or null",
  "incorporationDate": "YYYY or YYYY-MM-DD or null",
  "secFilingType": "Reg CF | Reg D 506(b) | Reg D 506(c) | Other | Unknown",
  "fundingPortal": "portal name if Reg CF, or null",
  "fdaClaims": [
    {
      "description": "what they claim about FDA status",
      "claimedType": "510(k) Cleared | PMA Approved | De Novo | Registered/Listed | Unknown",
      "clearanceNumber": "K-number if mentioned, or null",
      "productName": "device/product name if mentioned"
    }
  ],
  "patentClaims": [
    {
      "description": "what they claim about patents",
      "patentNumber": "US patent number if mentioned, or null",
      "status": "Granted | Pending | Licensed | Unknown",
      "inventorNames": ["inventor names if mentioned"]
    }
  ],
  "fundingClaims": {
    "targetRaise": "amount they're trying to raise",
    "previousRaises": ["prior funding rounds mentioned"],
    "valuation": "if mentioned"
  },
  "otherClaims": [
    {
      "category": "category of claim",
      "claim": "the specific claim",
      "evidence": "any supporting evidence mentioned"
    }
  ],
  "confidence": 0.0 - 1.0
}
`;

// ═══════════════════════════════════════════════════════════════════════════
// CLAIMS EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract claims from pitch text using LLM
 */
export async function extractClaims(
  pitchText: string,
  llmFn: (prompt: string) => Promise<string>
): Promise<ExtractedClaims> {
  console.log(`[ClaimsExtraction] Extracting claims from ${pitchText.length} chars of text`);

  const prompt = `${CLAIMS_EXTRACTION_PROMPT}

--- PITCH MATERIALS ---
${pitchText.slice(0, 15000)}
--- END ---

Extract all verifiable claims as JSON:`;

  try {
    const response = await llmFn(prompt);

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[ClaimsExtraction] No JSON found in LLM response");
      return createEmptyClaims(pitchText);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize the response
    return normalizeClaims(parsed);
  } catch (error) {
    console.error("[ClaimsExtraction] Failed to extract claims:", error);
    return createEmptyClaims(pitchText);
  }
}

/**
 * Extract claims using regex patterns (fallback when LLM unavailable)
 */
export function extractClaimsWithRegex(pitchText: string): ExtractedClaims {
  console.log("[ClaimsExtraction] Using regex fallback extraction");

  const text = pitchText.toLowerCase();
  const originalText = pitchText;

  // Extract company name (look for common patterns)
  const companyName = extractCompanyName(originalText) || "Unknown Company";

  // Extract FDA claims
  const fdaClaims = extractFDAClaims(originalText);

  // Extract patent claims
  const patentClaims = extractPatentClaims(originalText);

  // Extract SEC filing type
  const secFilingType = extractSecFilingType(text);

  // Extract funding portal
  const fundingPortal = extractFundingPortal(originalText);

  // Extract incorporation state
  const incorporationState = extractIncorporationState(text);

  return {
    companyName,
    companyNameVariants: [],
    incorporationState,
    secFilingType,
    fundingPortal,
    fdaClaims,
    patentClaims,
    otherClaims: [],
    extractedAt: Date.now(),
    confidence: 0.4, // Lower confidence for regex extraction
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// REGEX EXTRACTION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function extractCompanyName(text: string): string | null {
  // Look for common patterns
  const patterns = [
    /(?:company|corporation|inc|llc|corp)\s*[:\-]?\s*["']?([A-Z][A-Za-z\s&]+?)["']?\s*(?:,|\.|is|was)/i,
    /^([A-Z][A-Za-z\s&]+?)\s+(?:Inc|LLC|Corp|Corporation)/im,
    /(?:welcome to|introducing)\s+["']?([A-Z][A-Za-z\s&]+?)["']?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function extractFDAClaims(text: string): FDAClaim[] {
  const claims: FDAClaim[] = [];

  // Look for 510(k) clearance mentions
  const k510Pattern = /(?:510\s*\(?\s*k\s*\)?|K-?\d{6,})/gi;
  const matches = text.matchAll(k510Pattern);

  for (const match of matches) {
    const kNumberMatch = match[0].match(/K-?(\d{6,})/i);
    claims.push({
      description: `510(k) clearance mentioned: ${match[0]}`,
      claimedType: "510(k) Cleared",
      clearanceNumber: kNumberMatch ? `K${kNumberMatch[1]}` : undefined,
    });
  }

  // Look for "FDA cleared" or "FDA approved" claims
  const fdaClaimPattern = /fda\s+(?:cleared?|approved?|registered|listed)/gi;
  const fdaMatches = text.matchAll(fdaClaimPattern);

  for (const match of fdaMatches) {
    const claimType = match[0].toLowerCase();
    if (!claims.some((c) => c.claimedType === "510(k) Cleared")) {
      claims.push({
        description: match[0],
        claimedType: claimType.includes("clear")
          ? "510(k) Cleared"
          : claimType.includes("approv")
          ? "PMA Approved"
          : "Registered/Listed",
      });
    }
  }

  return claims;
}

function extractPatentClaims(text: string): PatentClaim[] {
  const claims: PatentClaim[] = [];

  // Look for US patent numbers
  const patentPattern = /(?:US\s*)?(?:Patent\s*(?:No\.?\s*)?)?(\d{7,})/gi;
  const matches = text.matchAll(patentPattern);

  for (const match of matches) {
    claims.push({
      description: `Patent number mentioned: ${match[0]}`,
      patentNumber: match[1],
      status: "Granted",
    });
  }

  // Look for "patent pending" claims
  if (/patent\s+pending/i.test(text)) {
    claims.push({
      description: "Patent pending",
      status: "Pending",
    });
  }

  return claims;
}

function extractSecFilingType(text: string): SecFilingType {
  if (/reg(?:ulation)?\s*cf|crowdfund/i.test(text)) {
    return "Reg CF";
  }
  if (/reg(?:ulation)?\s*d.*506\s*\(?\s*c\s*\)?/i.test(text)) {
    return "Reg D 506(c)";
  }
  if (/reg(?:ulation)?\s*d|506\s*\(?\s*b\s*\)?/i.test(text)) {
    return "Reg D 506(b)";
  }
  return "Unknown";
}

function extractFundingPortal(text: string): string | undefined {
  const portals = [
    "Wefunder",
    "Republic",
    "StartEngine",
    "NetCapital",
    "Mainvest",
    "Honeycomb",
    "truCrowd",
    "MicroVentures",
    "SeedInvest",
    "Fundable",
  ];

  for (const portal of portals) {
    if (text.toLowerCase().includes(portal.toLowerCase())) {
      return portal;
    }
  }

  return undefined;
}

function extractIncorporationState(text: string): string | undefined {
  const statePatterns = [
    /(?:incorporated|formed|organized)\s+(?:in|under)\s+(?:the\s+(?:state|laws)\s+of\s+)?([A-Z]{2}|Delaware|California|New York|Nevada|Wyoming|Texas|Florida)/i,
    /([A-Z]{2}|Delaware|California)\s+(?:corporation|LLC|company)/i,
  ];

  const stateAbbreviations: Record<string, string> = {
    delaware: "DE",
    california: "CA",
    "new york": "NY",
    nevada: "NV",
    wyoming: "WY",
    texas: "TX",
    florida: "FL",
  };

  for (const pattern of statePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const state = match[1].toLowerCase();
      return stateAbbreviations[state] || match[1].toUpperCase();
    }
  }

  return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// NORMALIZATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function normalizeClaims(parsed: any): ExtractedClaims {
  return {
    companyName: parsed.companyName || "Unknown Company",
    companyNameVariants: parsed.companyNameVariants || [],
    incorporationState: parsed.incorporationState || undefined,
    incorporationDate: parsed.incorporationDate || undefined,
    secFilingType: normalizeSecFilingType(parsed.secFilingType),
    fundingPortal: parsed.fundingPortal || undefined,
    fdaClaims: (parsed.fdaClaims || []).map(normalizeFDAClaim),
    patentClaims: (parsed.patentClaims || []).map(normalizePatentClaim),
    fundingClaims: parsed.fundingClaims,
    otherClaims: parsed.otherClaims || [],
    extractedAt: Date.now(),
    confidence: parsed.confidence || 0.7,
  };
}

function normalizeSecFilingType(type: string | undefined): SecFilingType {
  if (!type) return "Unknown";

  const lower = type.toLowerCase();
  if (lower.includes("reg cf") || lower.includes("crowdfund")) return "Reg CF";
  if (lower.includes("506(c)") || lower.includes("506c")) return "Reg D 506(c)";
  if (lower.includes("506(b)") || lower.includes("506b") || lower.includes("reg d")) return "Reg D 506(b)";
  if (lower.includes("other")) return "Other";

  return "Unknown";
}

function normalizeFDAClaim(claim: any): FDAClaim {
  return {
    description: claim.description || "",
    claimedType: claim.claimedType || "Unknown",
    clearanceNumber: claim.clearanceNumber || undefined,
    productName: claim.productName || undefined,
  };
}

function normalizePatentClaim(claim: any): PatentClaim {
  return {
    description: claim.description || "",
    patentNumber: claim.patentNumber || undefined,
    status: claim.status || "Unknown",
    inventorNames: claim.inventorNames || undefined,
  };
}

function createEmptyClaims(pitchText: string): ExtractedClaims {
  // Try regex extraction as fallback
  return extractClaimsWithRegex(pitchText);
}
