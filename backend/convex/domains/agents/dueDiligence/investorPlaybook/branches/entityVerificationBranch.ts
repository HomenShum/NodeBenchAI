/**
 * Entity Verification Branch
 *
 * Verifies corporate existence and status via state registries:
 * - Entity exists and matches claimed name
 * - Formation date consistent with claims
 * - Good standing status
 * - Registered agent validation
 * - Multi-state presence
 *
 * Common state registry resources:
 * - Delaware: https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx
 * - California: https://businesssearch.sos.ca.gov/
 * - New York: https://apps.dos.ny.gov/publicInquiry/
 * - Texas: https://mycpa.cpa.state.tx.us/coa/
 */

"use node";

import { api } from "../../../../../_generated/api";
import { DDSource } from "../../types";
import {
  EntityVerificationFindings,
  StateRegistryRecord,
} from "../types";

interface EntityVerificationBranchResult {
  findings: EntityVerificationFindings;
  sources: DDSource[];
  confidence: number;
}

// State registry URLs
const STATE_REGISTRY_URLS: Record<string, string> = {
  "DE": "https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx",
  "CA": "https://businesssearch.sos.ca.gov/",
  "NY": "https://apps.dos.ny.gov/publicInquiry/",
  "TX": "https://mycpa.cpa.state.tx.us/coa/",
  "FL": "https://search.sunbiz.org/",
  "WA": "https://ccfs.sos.wa.gov/",
  "MA": "https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx",
  "NV": "https://esos.nv.gov/EntitySearch/",
  "WY": "https://wyobiz.wyo.gov/Business/FilingSearch.aspx",
};

export async function executeEntityVerificationBranch(
  ctx: any,
  entityName: string,
  entityType: string,
  claimedState?: string,
  claimedFormationYear?: number
): Promise<EntityVerificationBranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // Step 1: Search for entity in state registries
    const stateRegistrations: StateRegistryRecord[] = [];

    // If claimed state provided, search there first
    const statesToSearch = claimedState
      ? [claimedState, ...getPopularIncorporationStates().filter(s => s !== claimedState)]
      : getPopularIncorporationStates();

    // Search primary states
    for (const state of statesToSearch.slice(0, 5)) {
      const record = await searchStateRegistry(ctx, entityName, state);
      if (record) {
        stateRegistrations.push(record);

        sources.push({
          sourceType: "company_website", // closest match
          url: STATE_REGISTRY_URLS[state] || `https://www.sos.${state.toLowerCase()}.gov/`,
          title: `${state} Secretary of State Business Search`,
          accessedAt: now,
          reliability: "authoritative",
          section: "entity_verification",
        });

        confidence += 0.15;
      }
    }

    // Step 2: Search for DBAs and alternative names
    const alternativeNames = await searchAlternativeNames(ctx, entityName);
    const dbaRegistrations = await searchDBARegistrations(ctx, entityName);

    // Step 3: Determine primary entity
    const primaryEntity = determinePrimaryEntity(
      stateRegistrations,
      claimedState
    );

    // Step 4: Verify claims
    const verification = verifyEntityClaims(
      primaryEntity,
      entityName,
      claimedState,
      claimedFormationYear
    );

    // Step 5: Build findings
    const findings: EntityVerificationFindings = {
      primaryEntity,
      alternativeNames,
      dbaRegistrations,
      stateRegistrations,
      verification,
      redFlags: generateEntityRedFlags(
        primaryEntity,
        entityName,
        claimedState,
        claimedFormationYear,
        stateRegistrations,
        verification
      ),
      overallConfidence: calculateEntityConfidence(
        primaryEntity,
        stateRegistrations,
        verification,
        confidence
      ),
    };

    return {
      findings,
      sources,
      confidence: findings.overallConfidence,
    };

  } catch (error) {
    console.error(`[Entity-Verification] Error for ${entityName}:`, error);
    return {
      findings: createEmptyEntityFindings(entityName, claimedState),
      sources,
      confidence: 0.1,
    };
  }
}

// ============================================================================
// STATE REGISTRY SEARCHES
// ============================================================================

async function searchStateRegistry(
  ctx: any,
  entityName: string,
  state: string
): Promise<StateRegistryRecord | null> {
  const now = Date.now();

  try {
    // Search for entity in state registry via web search
    const stateName = getStateName(state);
    const searchQuery = `site:${getStateRegistryDomain(state)} OR "${stateName} secretary of state" "${entityName}" corporation OR LLC`;

    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: searchQuery,
        mode: "balanced",
        maxTotal: 5,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = (r.snippet || "") + " " + (r.title || "");
      const contentLower = content.toLowerCase();
      const entityLower = entityName.toLowerCase();

      // Check if entity name appears in result
      if (contentLower.includes(entityLower) || fuzzyMatch(contentLower, entityLower)) {
        // Extract entity information
        const fileNumMatch = content.match(/(?:file|entity|document)\s*(?:number|#|no\.?)[:\s]*(\d+)/i);
        const dateMatch = content.match(/(?:formed?|incorporated?|registered?)[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i);

        // Determine status
        const status = determineEntityStatus(content);

        // Determine entity type
        const entityTypeFound = determineEntityType(content);

        // Try to extract registered agent
        const agentMatch = content.match(/(?:registered\s*agent|agent)[:\s]+([A-Z][A-Za-z\s,\.]+?)(?:\n|$|address)/i);

        return {
          entityName: extractExactEntityName(content, entityName),
          fileNumber: fileNumMatch?.[1] || "See registry",
          state,
          formationDate: dateMatch?.[1] || "See registry",
          entityType: entityTypeFound,
          status,
          registeredAgent: {
            name: agentMatch?.[1]?.trim() || "See registry",
            address: "See registry",
          },
          jurisdiction: state,
          goodStanding: status === "Active",
          verifiedAt: now,
          sourceUrl: r.url,
        };
      }
    }

    return null;

  } catch (error) {
    console.error(`[Entity-${state}] Search error:`, error);
    return null;
  }
}

async function searchAlternativeNames(
  ctx: any,
  entityName: string
): Promise<string[]> {
  const alternatives: string[] = [];

  try {
    // Search for alternative names, DBAs, trade names
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `"${entityName}" "also known as" OR "formerly known as" OR "DBA" OR "doing business as"`,
        mode: "fast",
        maxTotal: 5,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = r.snippet || "";

      // Extract alternative names
      const akaMatch = content.match(/(?:also known as|formerly known as|d\/b\/a|dba)[:\s]+([A-Z][A-Za-z0-9\s]+)/gi);
      if (akaMatch) {
        for (const match of akaMatch) {
          const name = match.replace(/(?:also known as|formerly known as|d\/b\/a|dba)[:\s]+/i, "").trim();
          if (name && !alternatives.includes(name) && name.toLowerCase() !== entityName.toLowerCase()) {
            alternatives.push(name);
          }
        }
      }
    }

    return alternatives.slice(0, 5);

  } catch (error) {
    return [];
  }
}

async function searchDBARegistrations(
  ctx: any,
  entityName: string
): Promise<EntityVerificationFindings["dbaRegistrations"]> {
  const dbas: EntityVerificationFindings["dbaRegistrations"] = [];

  try {
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `"${entityName}" "fictitious name" OR "DBA registration" OR "trade name"`,
        mode: "fast",
        maxTotal: 3,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];

    for (const r of results) {
      const content = r.snippet || "";

      // Extract DBA info
      const dbaMatch = content.match(/(?:dba|d\/b\/a|fictitious)[:\s]+([A-Z][A-Za-z0-9\s]+)/i);
      const stateMatch = content.match(/(?:CA|NY|TX|FL|DE|WA|MA|NV)/);

      if (dbaMatch) {
        dbas.push({
          name: dbaMatch[1].trim(),
          state: stateMatch?.[0] || "Unknown",
          status: "Active",
        });
      }
    }

    return dbas;

  } catch (error) {
    return [];
  }
}

// ============================================================================
// VERIFICATION LOGIC
// ============================================================================

function determinePrimaryEntity(
  registrations: StateRegistryRecord[],
  claimedState?: string
): StateRegistryRecord | undefined {
  if (registrations.length === 0) return undefined;

  // Prefer claimed state if found
  if (claimedState) {
    const inClaimedState = registrations.find(r => r.state === claimedState);
    if (inClaimedState) return inClaimedState;
  }

  // Otherwise prefer Delaware (common for startups)
  const deRecord = registrations.find(r => r.state === "DE");
  if (deRecord) return deRecord;

  // Otherwise return first found
  return registrations[0];
}

function verifyEntityClaims(
  primaryEntity: StateRegistryRecord | undefined,
  entityName: string,
  claimedState?: string,
  claimedFormationYear?: number
): EntityVerificationFindings["verification"] {
  const verification: EntityVerificationFindings["verification"] = {
    nameMatchesOffering: false,
    entityExists: false,
    isGoodStanding: false,
    registeredAgentValid: false,
    formationDateConsistent: true,
  };

  if (!primaryEntity) return verification;

  // Entity exists
  verification.entityExists = true;

  // Name matches
  verification.nameMatchesOffering = fuzzyMatch(
    primaryEntity.entityName.toLowerCase(),
    entityName.toLowerCase()
  );

  // Good standing
  verification.isGoodStanding = primaryEntity.status === "Active" && primaryEntity.goodStanding !== false;

  // Registered agent valid
  verification.registeredAgentValid =
    Boolean(primaryEntity.registeredAgent.name) &&
    primaryEntity.registeredAgent.name !== "See registry";

  // Formation date consistent
  if (claimedFormationYear && primaryEntity.formationDate !== "See registry") {
    const formationYear = extractYear(primaryEntity.formationDate);
    if (formationYear) {
      // Allow 1 year difference for incorporation vs operation dates
      verification.formationDateConsistent = Math.abs(formationYear - claimedFormationYear) <= 1;
    }
  }

  return verification;
}

// ============================================================================
// RED FLAG GENERATION
// ============================================================================

function generateEntityRedFlags(
  primaryEntity: StateRegistryRecord | undefined,
  entityName: string,
  claimedState: string | undefined,
  claimedFormationYear: number | undefined,
  allRegistrations: StateRegistryRecord[],
  verification: EntityVerificationFindings["verification"]
): EntityVerificationFindings["redFlags"] {
  const redFlags: EntityVerificationFindings["redFlags"] = [];

  // Entity not found
  if (!primaryEntity) {
    redFlags.push({
      type: "entity_not_found",
      severity: claimedState ? "critical" : "high",
      description: `No state registry record found for "${entityName}"${claimedState ? ` in ${claimedState}` : ""}. Verify the exact legal entity name.`,
    });
    return redFlags;
  }

  // Name mismatch
  if (!verification.nameMatchesOffering) {
    redFlags.push({
      type: "name_mismatch",
      severity: "high",
      description: `Registry name "${primaryEntity.entityName}" doesn't match claimed name "${entityName}". Verify you're dealing with the correct entity.`,
    });
  }

  // Not in good standing
  if (!verification.isGoodStanding) {
    redFlags.push({
      type: "bad_standing",
      severity: "high",
      description: `Entity is not in good standing (Status: ${primaryEntity.status}). Company may have failed to file required documents or pay fees.`,
    });
  }

  // Very recent formation
  if (primaryEntity.formationDate !== "See registry") {
    const formationYear = extractYear(primaryEntity.formationDate);
    const currentYear = new Date().getFullYear();
    if (formationYear && currentYear - formationYear < 1) {
      redFlags.push({
        type: "recent_formation",
        severity: "medium",
        description: `Entity was formed less than 1 year ago (${primaryEntity.formationDate}). Exercise additional caution with very new entities.`,
      });
    }
  }

  // Formation date inconsistent with claims
  if (claimedFormationYear && !verification.formationDateConsistent) {
    redFlags.push({
      type: "recent_formation",
      severity: "high",
      description: `Claimed formation year (${claimedFormationYear}) doesn't match registry record (${primaryEntity.formationDate}).`,
    });
  }

  // Registered agent issues
  if (!verification.registeredAgentValid) {
    redFlags.push({
      type: "agent_issue",
      severity: "low",
      description: `Could not verify registered agent information. This is common but should be confirmed for legal service of process.`,
    });
  }

  return redFlags;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getPopularIncorporationStates(): string[] {
  return ["DE", "CA", "NY", "TX", "FL", "WA", "NV", "WY"];
}

function getStateName(stateCode: string): string {
  const stateNames: Record<string, string> = {
    "DE": "Delaware",
    "CA": "California",
    "NY": "New York",
    "TX": "Texas",
    "FL": "Florida",
    "WA": "Washington",
    "MA": "Massachusetts",
    "NV": "Nevada",
    "WY": "Wyoming",
  };
  return stateNames[stateCode] || stateCode;
}

function getStateRegistryDomain(state: string): string {
  const domains: Record<string, string> = {
    "DE": "corp.delaware.gov",
    "CA": "businesssearch.sos.ca.gov",
    "NY": "dos.ny.gov",
    "TX": "cpa.state.tx.us",
    "FL": "sunbiz.org",
    "WA": "sos.wa.gov",
    "MA": "sec.state.ma.us",
    "NV": "esos.nv.gov",
    "WY": "wyobiz.wyo.gov",
  };
  return domains[state] || `sos.${state.toLowerCase()}.gov`;
}

function fuzzyMatch(str1: string, str2: string): boolean {
  // Simple fuzzy match: check if core words match
  const words1 = str1.split(/\s+/).filter(w => w.length > 2);
  const words2 = str2.split(/\s+/).filter(w => w.length > 2);

  // Check if at least 50% of words match
  const matches = words1.filter(w1 =>
    words2.some(w2 => w1.includes(w2) || w2.includes(w1))
  );

  return matches.length >= Math.min(words1.length, words2.length) * 0.5;
}

function determineEntityStatus(content: string): StateRegistryRecord["status"] {
  const contentLower = content.toLowerCase();
  if (contentLower.includes("dissolved")) return "Dissolved";
  if (contentLower.includes("merged")) return "Merged";
  if (contentLower.includes("suspended")) return "Suspended";
  if (contentLower.includes("inactive")) return "Inactive";
  if (contentLower.includes("active") || contentLower.includes("good standing")) return "Active";
  return "Unknown";
}

function determineEntityType(content: string): StateRegistryRecord["entityType"] {
  const contentLower = content.toLowerCase();
  if (contentLower.includes("llc") || contentLower.includes("limited liability company")) return "LLC";
  if (contentLower.includes("lp") || contentLower.includes("limited partnership")) return "LP";
  if (contentLower.includes("llp") || contentLower.includes("limited liability partnership")) return "LLP";
  if (contentLower.includes("corp") || contentLower.includes("inc")) return "Corporation";
  return "Other";
}

function extractExactEntityName(content: string, searchedName: string): string {
  // Try to extract the exact entity name from the content
  const patterns = [
    /entity\s*name[:\s]+([A-Z][A-Za-z0-9\s,\.]+?)(?:\n|file|type)/i,
    /company\s*name[:\s]+([A-Z][A-Za-z0-9\s,\.]+?)(?:\n|file|type)/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return match[1].trim();
  }

  return searchedName;
}

function extractYear(dateStr: string): number | null {
  const match = dateStr.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function calculateEntityConfidence(
  primaryEntity: StateRegistryRecord | undefined,
  registrations: StateRegistryRecord[],
  verification: EntityVerificationFindings["verification"],
  baseConfidence: number
): number {
  let confidence = baseConfidence;

  if (primaryEntity) confidence += 0.25;
  if (registrations.length > 1) confidence += 0.1;
  if (verification.nameMatchesOffering) confidence += 0.15;
  if (verification.isGoodStanding) confidence += 0.15;

  return Math.min(0.95, confidence);
}

function createEmptyEntityFindings(
  entityName: string,
  claimedState?: string
): EntityVerificationFindings {
  return {
    primaryEntity: undefined,
    alternativeNames: [],
    dbaRegistrations: [],
    stateRegistrations: [],
    verification: {
      nameMatchesOffering: false,
      entityExists: false,
      isGoodStanding: false,
      registeredAgentValid: false,
      formationDateConsistent: true,
    },
    redFlags: [{
      type: "entity_not_found",
      severity: "high",
      description: `Could not verify "${entityName}" in any state registry${claimedState ? ` (claimed: ${claimedState})` : ""}.`,
    }],
    overallConfidence: 0.1,
  };
}
