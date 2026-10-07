/**
 * claimLifecycle.ts
 *
 * Claim Lifecycle Management with Versioning
 *
 * Manages the full lifecycle of due diligence claims:
 * 1. Version tracking (claim changes over time)
 * 2. Deduplication (merge equivalent claims)
 * 3. Verdict deltas (track verification status changes)
 * 4. Staleness detection (flag outdated claims)
 *
 * Reference: FATF Recommendation 25 (record-keeping requirements)
 * Source: https://www.fatf-gafi.org/recommendations.html (accessed 2025-01)
 */

import { DDClaim, ClaimLedger } from "../../agents/dueDiligence/types";

// ============================================================================
// VERSIONED CLAIM TYPES
// ============================================================================

/**
 * A versioned claim with full history
 */
export interface VersionedClaim extends DDClaim {
  version: number;
  previousVersionId?: string;
  createdAt: number;
  updatedAt: number;
  verdictHistory: VerdictDelta[];
  sourceHistory: SourceCitation[];
  mergedFromIds?: string[]; // IDs of claims merged into this one
}

/**
 * Track changes in verdict over time
 */
export interface VerdictDelta {
  fromVerdict: DDClaim["verdict"];
  toVerdict: DDClaim["verdict"];
  timestamp: number;
  reason: string;
  triggeredBy: "new_evidence" | "source_expiry" | "contradiction" | "manual_review" | "llm_evaluation";
  evidenceId?: string;
}

/**
 * Source citation with access date (critical for legal/compliance)
 */
export interface SourceCitation {
  sourceId: string;
  sourceType: "sec_filing" | "press_release" | "company_website" | "linkedin" |
              "registry" | "api_response" | "court_record" | "news_article" | "other";
  url: string;
  title?: string;
  accessedAt: number;  // When we accessed this source
  publishedAt?: number; // When the source was published (if known)
  archivedUrl?: string; // Wayback Machine or archive.org link
  reliability: "authoritative" | "reliable" | "secondary" | "unverified";
  extractedSnippet?: string;
}

/**
 * Claim deduplication result
 */
export interface DeduplicationResult {
  mergedClaims: VersionedClaim[];
  duplicateGroups: Array<{
    canonicalId: string;
    mergedIds: string[];
    mergeReason: string;
  }>;
  totalBefore: number;
  totalAfter: number;
  duplicatesRemoved: number;
}

/**
 * Staleness check result
 */
export interface StalenessResult {
  claimId: string;
  isStale: boolean;
  staleSince?: number;
  stalenessReason?: string;
  recommendedAction: "refresh" | "archive" | "keep";
  lastVerifiedAt: number;
  sourceExpirations: Array<{
    sourceId: string;
    expiredAt: number;
  }>;
}

// ============================================================================
// CLAIM LIFECYCLE MANAGER
// ============================================================================

/**
 * Claim Lifecycle Manager
 *
 * Handles versioning, deduplication, and staleness tracking
 */
export class ClaimLifecycleManager {
  private claims: Map<string, VersionedClaim> = new Map();
  private entityName: string;

  constructor(entityName: string, existingClaims?: VersionedClaim[]) {
    this.entityName = entityName;
    if (existingClaims) {
      for (const claim of existingClaims) {
        this.claims.set(claim.id, claim);
      }
    }
  }

  /**
   * Add a new claim with version tracking
   */
  addClaim(claim: DDClaim, source: SourceCitation): VersionedClaim {
    const now = Date.now();

    // Check for existing similar claim
    const existingClaim = this.findSimilarClaim(claim);

    if (existingClaim) {
      // Update existing claim with new version
      return this.updateClaim(existingClaim.id, claim, source, "new_evidence");
    }

    const versionedClaim: VersionedClaim = {
      ...claim,
      version: 1,
      createdAt: now,
      updatedAt: now,
      verdictHistory: [],
      sourceHistory: [source],
    };

    this.claims.set(claim.id, versionedClaim);
    return versionedClaim;
  }

  /**
   * Update an existing claim with a new version
   */
  updateClaim(
    claimId: string,
    updates: Partial<DDClaim>,
    source?: SourceCitation,
    triggeredBy: VerdictDelta["triggeredBy"] = "new_evidence"
  ): VersionedClaim {
    const existing = this.claims.get(claimId);
    if (!existing) {
      throw new Error(`Claim ${claimId} not found`);
    }

    const now = Date.now();

    // Track verdict change if applicable
    if (updates.verdict && updates.verdict !== existing.verdict) {
      existing.verdictHistory.push({
        fromVerdict: existing.verdict,
        toVerdict: updates.verdict,
        timestamp: now,
        reason: `Verdict updated via ${triggeredBy}`,
        triggeredBy,
      });
    }

    // Add new source if provided
    if (source) {
      existing.sourceHistory.push(source);
    }

    // Create updated claim
    const updatedClaim: VersionedClaim = {
      ...existing,
      ...updates,
      version: existing.version + 1,
      previousVersionId: existing.id,
      updatedAt: now,
    };

    this.claims.set(claimId, updatedClaim);
    return updatedClaim;
  }

  /**
   * Find a similar claim that might be a duplicate
   */
  findSimilarClaim(newClaim: DDClaim): VersionedClaim | null {
    for (const existing of this.claims.values()) {
      const similarity = this.calculateClaimSimilarity(existing, newClaim);
      if (similarity > 0.8) { // 80% similarity threshold
        return existing;
      }
    }
    return null;
  }

  /**
   * Calculate similarity between two claims (0-1)
   */
  calculateClaimSimilarity(a: DDClaim, b: DDClaim): number {
    let score = 0;
    let weights = 0;

    // Claim type match (high weight)
    if (a.claimType === b.claimType) {
      score += 0.3;
    }
    weights += 0.3;

    // Text similarity (Jaccard on words)
    const wordsA = new Set(a.claimText.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.claimText.toLowerCase().split(/\s+/));
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    const textSimilarity = intersection.size / union.size;
    score += textSimilarity * 0.5;
    weights += 0.5;

    // Source overlap
    const sourcesA = new Set(a.citations);
    const sourcesB = new Set(b.citations);
    const sourceOverlap = [...sourcesA].filter(s => sourcesB.has(s)).length;
    if (sourceOverlap > 0) {
      score += 0.2;
    }
    weights += 0.2;

    return score / weights;
  }

  /**
   * Deduplicate claims in the ledger
   */
  deduplicate(): DeduplicationResult {
    const totalBefore = this.claims.size;
    const duplicateGroups: DeduplicationResult["duplicateGroups"] = [];
    const processedIds = new Set<string>();

    for (const claim of this.claims.values()) {
      if (processedIds.has(claim.id)) continue;

      const duplicates: VersionedClaim[] = [];

      for (const other of this.claims.values()) {
        if (other.id !== claim.id && !processedIds.has(other.id)) {
          const similarity = this.calculateClaimSimilarity(claim, other);
          if (similarity > 0.8) {
            duplicates.push(other);
            processedIds.add(other.id);
          }
        }
      }

      if (duplicates.length > 0) {
        // Merge duplicates into the claim with highest confidence
        const allClaims = [claim, ...duplicates];
        const canonical = allClaims.reduce((best, c) =>
          c.confidence > best.confidence ? c : best
        );

        // Merge source histories
        const mergedSources: SourceCitation[] = [];
        for (const c of allClaims) {
          if ('sourceHistory' in c) {
            mergedSources.push(...(c as VersionedClaim).sourceHistory);
          }
        }

        // Update canonical with merged data
        const mergedIds = duplicates.map(d => d.id);
        (canonical as VersionedClaim).mergedFromIds = mergedIds;
        (canonical as VersionedClaim).sourceHistory = this.deduplicateSources(mergedSources);

        // Remove duplicates
        for (const dup of duplicates) {
          this.claims.delete(dup.id);
        }

        duplicateGroups.push({
          canonicalId: canonical.id,
          mergedIds,
          mergeReason: `Merged ${duplicates.length} duplicate claims based on similarity`,
        });
      }

      processedIds.add(claim.id);
    }

    return {
      mergedClaims: Array.from(this.claims.values()),
      duplicateGroups,
      totalBefore,
      totalAfter: this.claims.size,
      duplicatesRemoved: totalBefore - this.claims.size,
    };
  }

  /**
   * Deduplicate sources by URL
   */
  private deduplicateSources(sources: SourceCitation[]): SourceCitation[] {
    const seen = new Map<string, SourceCitation>();
    for (const source of sources) {
      const key = source.url;
      const existing = seen.get(key);
      // Keep the most recent access
      if (!existing || source.accessedAt > existing.accessedAt) {
        seen.set(key, source);
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Check claim staleness
   */
  checkStaleness(
    claimId: string,
    maxAgeMs: number = 30 * 24 * 60 * 60 * 1000 // 30 days default
  ): StalenessResult {
    const claim = this.claims.get(claimId);
    if (!claim) {
      throw new Error(`Claim ${claimId} not found`);
    }

    const now = Date.now();
    const age = now - claim.updatedAt;
    const isStale = age > maxAgeMs;

    // Check for expired sources
    const sourceExpirations: StalenessResult["sourceExpirations"] = [];
    for (const source of claim.sourceHistory) {
      const sourceAge = now - source.accessedAt;
      if (sourceAge > maxAgeMs) {
        sourceExpirations.push({
          sourceId: source.sourceId,
          expiredAt: source.accessedAt + maxAgeMs,
        });
      }
    }

    let recommendedAction: StalenessResult["recommendedAction"] = "keep";
    let stalenessReason: string | undefined;

    if (isStale) {
      if (claim.verdict === "verified") {
        recommendedAction = "refresh";
        stalenessReason = `Claim not updated in ${Math.floor(age / (24 * 60 * 60 * 1000))} days`;
      } else if (claim.verdict === "unverifiable") {
        recommendedAction = "archive";
        stalenessReason = "Stale unverifiable claim - consider archiving";
      } else {
        recommendedAction = "refresh";
        stalenessReason = "Claim requires re-verification";
      }
    } else if (sourceExpirations.length > claim.sourceHistory.length / 2) {
      recommendedAction = "refresh";
      stalenessReason = `${sourceExpirations.length} of ${claim.sourceHistory.length} sources expired`;
    }

    return {
      claimId,
      isStale,
      staleSince: isStale ? claim.updatedAt + maxAgeMs : undefined,
      stalenessReason,
      recommendedAction,
      lastVerifiedAt: claim.updatedAt,
      sourceExpirations,
    };
  }

  /**
   * Get all claims with staleness info
   */
  getClaimsWithStaleness(): Array<VersionedClaim & { staleness: StalenessResult }> {
    return Array.from(this.claims.values()).map(claim => ({
      ...claim,
      staleness: this.checkStaleness(claim.id),
    }));
  }

  /**
   * Export as ClaimLedger
   */
  toLedger(): ClaimLedger {
    const claims = Array.from(this.claims.values());
    const contradictionCount = claims.filter(c =>
      c.contradictions && c.contradictions.length > 0
    ).length;
    const unverifiableCount = claims.filter(c =>
      c.verdict === "unverifiable"
    ).length;

    let overallIntegrity: ClaimLedger["overallIntegrity"] = "high";
    if (unverifiableCount > claims.length * 0.5) {
      overallIntegrity = "low";
    } else if (unverifiableCount > claims.length * 0.3 || contradictionCount > 0) {
      overallIntegrity = "medium";
    }

    return {
      entityName: this.entityName,
      entityType: "company",
      claims: claims.map(c => ({
        id: c.id,
        claimText: c.claimText,
        claimType: c.claimType,
        extractedFrom: c.extractedFrom,
        verdict: c.verdict,
        confidence: c.confidence,
        freshness: this.calculateFreshness(c.updatedAt),
        citations: c.citations,
        contradictions: c.contradictions,
        verificationMethod: c.verificationMethod,
      })),
      overallIntegrity,
      contradictionCount,
      unverifiableCount,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Calculate freshness based on age
   */
  private calculateFreshness(timestamp: number): DDClaim["freshness"] {
    const ageMs = Date.now() - timestamp;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);

    if (ageDays < 30) return "current";
    if (ageDays < 180) return "stale";
    return "historical";
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a source citation with proper dating
 */
export function createSourceCitation(
  url: string,
  sourceType: SourceCitation["sourceType"],
  options: {
    title?: string;
    publishedAt?: number;
    archivedUrl?: string;
    reliability?: SourceCitation["reliability"];
    extractedSnippet?: string;
  } = {}
): SourceCitation {
  return {
    sourceId: `src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sourceType,
    url,
    title: options.title,
    accessedAt: Date.now(),
    publishedAt: options.publishedAt,
    archivedUrl: options.archivedUrl,
    reliability: options.reliability ?? "unverified",
    extractedSnippet: options.extractedSnippet,
  };
}

/**
 * Format source citation for display
 */
export function formatSourceCitation(source: SourceCitation): string {
  const accessDate = new Date(source.accessedAt).toISOString().split("T")[0];
  const publishDate = source.publishedAt
    ? new Date(source.publishedAt).toISOString().split("T")[0]
    : undefined;

  let citation = source.title ? `"${source.title}"` : source.url;

  if (publishDate) {
    citation += ` (published ${publishDate})`;
  }

  citation += ` [accessed ${accessDate}]`;

  if (source.archivedUrl) {
    citation += ` [archived: ${source.archivedUrl}]`;
  }

  return citation;
}

/**
 * Generate claim version diff
 */
export function generateClaimDiff(
  oldClaim: VersionedClaim,
  newClaim: VersionedClaim
): string[] {
  const diffs: string[] = [];

  if (oldClaim.claimText !== newClaim.claimText) {
    diffs.push(`Text: "${oldClaim.claimText}" → "${newClaim.claimText}"`);
  }

  if (oldClaim.verdict !== newClaim.verdict) {
    diffs.push(`Verdict: ${oldClaim.verdict} → ${newClaim.verdict}`);
  }

  if (oldClaim.confidence !== newClaim.confidence) {
    diffs.push(`Confidence: ${(oldClaim.confidence * 100).toFixed(0)}% → ${(newClaim.confidence * 100).toFixed(0)}%`);
  }

  const newSources = newClaim.sourceHistory.length - oldClaim.sourceHistory.length;
  if (newSources > 0) {
    diffs.push(`+${newSources} new source(s)`);
  }

  return diffs;
}
