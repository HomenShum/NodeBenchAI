// convex/domains/financial/taxonomyManagement.ts
// XBRL Taxonomy Version Management
//
// Tracks taxonomy versions (US-GAAP, IFRS, SEC) used in financial data extraction.
// Critical for reproducibility: tag meanings and availability evolve across versions.
//
// ============================================================================
// WHY TAXONOMY VERSION PINNING MATTERS
// ============================================================================
//
// 1. TAG DEPRECATION: Tags are deprecated/replaced across versions
//    - e.g., "RevenueFromContractWithCustomerExcludingAssessedTax" (ASC 606, 2018+)
//      replaced older revenue recognition tags
//
// 2. NEW TAGS: New accounting standards introduce new concepts
//    - e.g., Lease accounting changes (ASC 842) added new tags in 2019
//
// 3. SEMANTIC CHANGES: Same tag may have subtly different meaning
//    - e.g., Definition refinements in subsequent taxonomy releases
//
// 4. REPRODUCIBILITY: To replay extraction, must know which taxonomy was used
//    - Repro packs must include taxonomy version alongside assumptions
//
// 5. CROSS-FILER COMPARABILITY: Different filers may use different taxonomy years
//    - Need normalization layer for apples-to-apples comparison
//
// ============================================================================

import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

/* ------------------------------------------------------------------ */
/* TAXONOMY VERSION TYPES                                              */
/* ------------------------------------------------------------------ */

export interface TaxonomyVersion {
  /** Taxonomy family (us-gaap, ifrs-full, dei, srt) */
  family: "us-gaap" | "ifrs-full" | "dei" | "srt" | "country" | "currency";

  /** Release year (e.g., 2023, 2024) */
  releaseYear: number;

  /** Full version identifier (e.g., "us-gaap-2023") */
  versionId: string;

  /** Effective date (when this taxonomy version became active) */
  effectiveDate: string;

  /** URL to taxonomy documentation */
  taxonomyUrl?: string;

  /** Notable changes from previous version */
  changeNotes?: string[];
}

export interface TagEvolution {
  /** Tag name */
  tag: string;

  /** Taxonomy family */
  family: string;

  /** First version where tag appeared */
  introducedIn: string;

  /** Version where tag was deprecated (if any) */
  deprecatedIn?: string;

  /** Replacement tag (if deprecated) */
  replacedBy?: string;

  /** Semantic changes across versions */
  semanticChanges?: Array<{
    version: string;
    description: string;
  }>;
}

export interface FilingTaxonomyInfo {
  /** CIK of the filer */
  cik: string;

  /** Fiscal year of filing */
  fiscalYear: number;

  /** Fiscal quarter (optional) */
  fiscalQuarter?: number;

  /** Accession number */
  accessionNumber: string;

  /** Taxonomy versions used in this filing */
  taxonomyVersions: TaxonomyVersion[];

  /** Filing date */
  filedDate: string;
}

/* ------------------------------------------------------------------ */
/* KNOWN TAXONOMY VERSIONS                                             */
/* ------------------------------------------------------------------ */

/**
 * US-GAAP taxonomy version history
 * Updated annually by FASB
 */
export const US_GAAP_VERSIONS: TaxonomyVersion[] = [
  {
    family: "us-gaap",
    releaseYear: 2024,
    versionId: "us-gaap-2024",
    effectiveDate: "2024-01-01",
    taxonomyUrl: "https://xbrl.fasb.org/us-gaap/2024/",
    changeNotes: [
      "Updated for ASU 2023-01 (Leases - Common Control)",
      "Crypto asset disclosures (ASU 2023-08)",
    ],
  },
  {
    family: "us-gaap",
    releaseYear: 2023,
    versionId: "us-gaap-2023",
    effectiveDate: "2023-01-01",
    taxonomyUrl: "https://xbrl.fasb.org/us-gaap/2023/",
    changeNotes: [
      "Reference rate reform (ASU 2020-04) amendments",
      "Supplier finance programs (ASU 2022-04)",
    ],
  },
  {
    family: "us-gaap",
    releaseYear: 2022,
    versionId: "us-gaap-2022",
    effectiveDate: "2022-01-01",
    taxonomyUrl: "https://xbrl.fasb.org/us-gaap/2022/",
    changeNotes: [
      "Business combinations - contract assets/liabilities (ASU 2021-08)",
      "Government assistance disclosures (ASU 2021-10)",
    ],
  },
  {
    family: "us-gaap",
    releaseYear: 2021,
    versionId: "us-gaap-2021",
    effectiveDate: "2021-01-01",
    taxonomyUrl: "https://xbrl.fasb.org/us-gaap/2021/",
    changeNotes: [
      "Income tax disclosures improvements",
      "Convertible instruments (ASU 2020-06)",
    ],
  },
  {
    family: "us-gaap",
    releaseYear: 2020,
    versionId: "us-gaap-2020",
    effectiveDate: "2020-01-01",
    taxonomyUrl: "https://xbrl.fasb.org/us-gaap/2020/",
    changeNotes: [
      "Credit losses (CECL - ASU 2016-13) implementation",
      "Reference rate reform elements",
    ],
  },
  {
    family: "us-gaap",
    releaseYear: 2019,
    versionId: "us-gaap-2019",
    effectiveDate: "2019-01-01",
    taxonomyUrl: "https://xbrl.fasb.org/us-gaap/2019/",
    changeNotes: [
      "Lease accounting (ASC 842) full adoption",
      "Hedging (ASU 2017-12) elements",
    ],
  },
  {
    family: "us-gaap",
    releaseYear: 2018,
    versionId: "us-gaap-2018",
    effectiveDate: "2018-01-01",
    taxonomyUrl: "https://xbrl.fasb.org/us-gaap/2018/",
    changeNotes: [
      "Revenue recognition (ASC 606) elements",
      "Lease accounting (ASC 842) early adoption",
    ],
  },
];

/**
 * IFRS taxonomy version history
 * Updated annually by IFRS Foundation
 */
export const IFRS_VERSIONS: TaxonomyVersion[] = [
  {
    family: "ifrs-full",
    releaseYear: 2024,
    versionId: "ifrs-2024",
    effectiveDate: "2024-01-01",
    taxonomyUrl: "https://www.ifrs.org/issued-standards/ifrs-taxonomy/",
    changeNotes: ["IFRS 18 Presentation and Disclosure in Financial Statements"],
  },
  {
    family: "ifrs-full",
    releaseYear: 2023,
    versionId: "ifrs-2023",
    effectiveDate: "2023-01-01",
    taxonomyUrl: "https://www.ifrs.org/issued-standards/ifrs-taxonomy/",
    changeNotes: ["Pillar Two model rules disclosures"],
  },
  {
    family: "ifrs-full",
    releaseYear: 2022,
    versionId: "ifrs-2022",
    effectiveDate: "2022-01-01",
    taxonomyUrl: "https://www.ifrs.org/issued-standards/ifrs-taxonomy/",
    changeNotes: ["Insurance contracts (IFRS 17) elements"],
  },
];

/**
 * SEC DEI (Document and Entity Information) taxonomy versions
 */
export const DEI_VERSIONS: TaxonomyVersion[] = [
  {
    family: "dei",
    releaseYear: 2024,
    versionId: "dei-2024",
    effectiveDate: "2024-01-01",
    taxonomyUrl: "https://xbrl.sec.gov/dei/",
  },
  {
    family: "dei",
    releaseYear: 2023,
    versionId: "dei-2023",
    effectiveDate: "2023-01-01",
    taxonomyUrl: "https://xbrl.sec.gov/dei/",
  },
];

/* ------------------------------------------------------------------ */
/* TAG EVOLUTION TRACKING                                              */
/* ------------------------------------------------------------------ */

/**
 * Known tag deprecations and replacements
 * Critical for mapping older filings to current concepts
 */
export const TAG_EVOLUTION: TagEvolution[] = [
  // Revenue recognition evolution (ASC 606)
  {
    tag: "SalesRevenueNet",
    family: "us-gaap",
    introducedIn: "us-gaap-2009",
    deprecatedIn: "us-gaap-2018",
    replacedBy: "RevenueFromContractWithCustomerExcludingAssessedTax",
    semanticChanges: [
      {
        version: "us-gaap-2018",
        description: "Deprecated in favor of ASC 606 revenue recognition tags",
      },
    ],
  },
  {
    tag: "SalesRevenueGoodsNet",
    family: "us-gaap",
    introducedIn: "us-gaap-2009",
    deprecatedIn: "us-gaap-2018",
    replacedBy: "RevenueFromContractWithCustomerExcludingAssessedTax",
  },
  {
    tag: "RevenueFromContractWithCustomerExcludingAssessedTax",
    family: "us-gaap",
    introducedIn: "us-gaap-2018",
    semanticChanges: [
      {
        version: "us-gaap-2018",
        description: "Introduced for ASC 606 revenue recognition",
      },
    ],
  },

  // Lease accounting evolution (ASC 842)
  {
    tag: "OperatingLeasesRentExpenseNet",
    family: "us-gaap",
    introducedIn: "us-gaap-2009",
    deprecatedIn: "us-gaap-2019",
    replacedBy: "OperatingLeaseExpense",
  },
  {
    tag: "OperatingLeaseRightOfUseAsset",
    family: "us-gaap",
    introducedIn: "us-gaap-2019",
    semanticChanges: [
      {
        version: "us-gaap-2019",
        description: "Introduced for ASC 842 lease accounting",
      },
    ],
  },
  {
    tag: "OperatingLeaseLiability",
    family: "us-gaap",
    introducedIn: "us-gaap-2019",
  },

  // Credit losses (CECL)
  {
    tag: "AllowanceForDoubtfulAccountsReceivable",
    family: "us-gaap",
    introducedIn: "us-gaap-2009",
    deprecatedIn: "us-gaap-2020",
    replacedBy: "FinancingReceivableAllowanceForCreditLoss",
    semanticChanges: [
      {
        version: "us-gaap-2020",
        description: "Deprecated in favor of CECL-compliant credit loss tags",
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* TAXONOMY DETECTION                                                  */
/* ------------------------------------------------------------------ */

/**
 * Detect taxonomy version from filing metadata
 *
 * SEC filings include namespace declarations that indicate taxonomy version:
 * xmlns:us-gaap="http://fasb.org/us-gaap/2023"
 */
export function detectTaxonomyVersion(
  namespace: string
): TaxonomyVersion | null {
  // Parse namespace URL to extract year
  // Format: http://fasb.org/us-gaap/YYYY or https://xbrl.ifrs.org/taxonomy/YYYY

  const usGaapMatch = namespace.match(/fasb\.org\/us-gaap\/(\d{4})/);
  if (usGaapMatch) {
    const year = parseInt(usGaapMatch[1], 10);
    return US_GAAP_VERSIONS.find((v) => v.releaseYear === year) ?? {
      family: "us-gaap",
      releaseYear: year,
      versionId: `us-gaap-${year}`,
      effectiveDate: `${year}-01-01`,
    };
  }

  const ifrsMatch = namespace.match(/ifrs\.org.*\/(\d{4})/);
  if (ifrsMatch) {
    const year = parseInt(ifrsMatch[1], 10);
    return IFRS_VERSIONS.find((v) => v.releaseYear === year) ?? {
      family: "ifrs-full",
      releaseYear: year,
      versionId: `ifrs-${year}`,
      effectiveDate: `${year}-01-01`,
    };
  }

  const deiMatch = namespace.match(/xbrl\.sec\.gov\/dei\/(\d{4})/);
  if (deiMatch) {
    const year = parseInt(deiMatch[1], 10);
    return DEI_VERSIONS.find((v) => v.releaseYear === year) ?? {
      family: "dei",
      releaseYear: year,
      versionId: `dei-${year}`,
      effectiveDate: `${year}-01-01`,
    };
  }

  return null;
}

/**
 * Get recommended taxonomy version for a given fiscal year
 * Generally, filers use taxonomy version matching or preceding their fiscal year end
 */
export function getRecommendedTaxonomyVersion(
  family: "us-gaap" | "ifrs-full",
  fiscalYearEnd: number
): TaxonomyVersion | null {
  const versions = family === "us-gaap" ? US_GAAP_VERSIONS : IFRS_VERSIONS;

  // Find the latest version that was effective before fiscal year end
  return versions
    .filter((v) => v.releaseYear <= fiscalYearEnd)
    .sort((a, b) => b.releaseYear - a.releaseYear)[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* TAG NORMALIZATION                                                   */
/* ------------------------------------------------------------------ */

/**
 * Normalize a tag to its current equivalent
 * Handles deprecated tags by returning the replacement
 */
export function normalizeTag(tag: string, family: string): {
  normalizedTag: string;
  wasDeprecated: boolean;
  deprecationInfo?: TagEvolution;
} {
  const evolution = TAG_EVOLUTION.find(
    (e) => e.tag === tag && e.family === family && e.deprecatedIn
  );

  if (evolution && evolution.replacedBy) {
    return {
      normalizedTag: evolution.replacedBy,
      wasDeprecated: true,
      deprecationInfo: evolution,
    };
  }

  return {
    normalizedTag: tag,
    wasDeprecated: false,
  };
}

/**
 * Check if a tag is valid for a given taxonomy version
 */
export function isTagValidForVersion(
  tag: string,
  family: string,
  version: string
): { valid: boolean; reason?: string } {
  const evolution = TAG_EVOLUTION.find(
    (e) => e.tag === tag && e.family === family
  );

  if (!evolution) {
    // Unknown tag - assume valid (custom extension or not in our tracking)
    return { valid: true };
  }

  // Parse version year
  const versionMatch = version.match(/(\d{4})/);
  if (!versionMatch) {
    return { valid: true };
  }
  const versionYear = parseInt(versionMatch[1], 10);

  // Check if introduced after this version
  const introducedMatch = evolution.introducedIn.match(/(\d{4})/);
  if (introducedMatch) {
    const introducedYear = parseInt(introducedMatch[1], 10);
    if (versionYear < introducedYear) {
      return {
        valid: false,
        reason: `Tag ${tag} was introduced in ${evolution.introducedIn}, not available in ${version}`,
      };
    }
  }

  // Check if deprecated before this version
  if (evolution.deprecatedIn) {
    const deprecatedMatch = evolution.deprecatedIn.match(/(\d{4})/);
    if (deprecatedMatch) {
      const deprecatedYear = parseInt(deprecatedMatch[1], 10);
      if (versionYear >= deprecatedYear) {
        return {
          valid: false,
          reason: `Tag ${tag} was deprecated in ${evolution.deprecatedIn}. Use ${evolution.replacedBy ?? "alternative tag"} instead.`,
        };
      }
    }
  }

  return { valid: true };
}

/* ------------------------------------------------------------------ */
/* TAXONOMY PROVENANCE FOR REPRO PACKS                                 */
/* ------------------------------------------------------------------ */

/**
 * Taxonomy metadata to include in repro packs
 * Enables exact reproduction of extraction logic
 */
export interface TaxonomyProvenance {
  /** Primary taxonomy version used */
  primaryTaxonomy: TaxonomyVersion;

  /** All taxonomy namespaces detected in filing */
  detectedNamespaces: string[];

  /** Taxonomy versions resolved from namespaces */
  resolvedVersions: TaxonomyVersion[];

  /** Tag normalization applied */
  tagNormalizations: Array<{
    originalTag: string;
    normalizedTag: string;
    reason: string;
  }>;

  /** Extraction engine version */
  extractionEngineVersion: string;

  /** Tag mapping revision (our internal mapping version) */
  tagMappingRevision: string;

  /** Timestamp of extraction */
  extractedAt: number;
}

/**
 * Current tag mapping revision
 * Increment when TAG_MAPPINGS in xbrlParser.ts changes
 */
export const TAG_MAPPING_REVISION = "2024.01.19.1";

/**
 * Build taxonomy provenance for a filing
 */
export function buildTaxonomyProvenance(
  namespaces: string[],
  tagNormalizations: Array<{ original: string; normalized: string; reason: string }>
): TaxonomyProvenance {
  const resolvedVersions: TaxonomyVersion[] = [];

  for (const ns of namespaces) {
    const version = detectTaxonomyVersion(ns);
    if (version) {
      resolvedVersions.push(version);
    }
  }

  // Determine primary taxonomy (prefer us-gaap, then ifrs)
  const primary = resolvedVersions.find((v) => v.family === "us-gaap") ??
    resolvedVersions.find((v) => v.family === "ifrs-full") ??
    resolvedVersions[0];

  return {
    primaryTaxonomy: primary ?? {
      family: "us-gaap",
      releaseYear: new Date().getFullYear(),
      versionId: "unknown",
      effectiveDate: new Date().toISOString().split("T")[0],
    },
    detectedNamespaces: namespaces,
    resolvedVersions,
    tagNormalizations: tagNormalizations.map((n) => ({
      originalTag: n.original,
      normalizedTag: n.normalized,
      reason: n.reason,
    })),
    extractionEngineVersion: "1.0.0",
    tagMappingRevision: TAG_MAPPING_REVISION,
    extractedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* CONVEX QUERIES                                                      */
/* ------------------------------------------------------------------ */

/**
 * Get known taxonomy versions
 */
export const getTaxonomyVersions = query({
  args: {
    family: v.optional(v.union(
      v.literal("us-gaap"),
      v.literal("ifrs-full"),
      v.literal("dei")
    )),
  },
  returns: v.array(v.object({
    family: v.string(),
    releaseYear: v.number(),
    versionId: v.string(),
    effectiveDate: v.string(),
    taxonomyUrl: v.optional(v.string()),
    changeNotes: v.optional(v.array(v.string())),
  })),
  handler: async (ctx, args) => {
    let versions: TaxonomyVersion[] = [];

    if (!args.family || args.family === "us-gaap") {
      versions = [...versions, ...US_GAAP_VERSIONS];
    }
    if (!args.family || args.family === "ifrs-full") {
      versions = [...versions, ...IFRS_VERSIONS];
    }
    if (!args.family || args.family === "dei") {
      versions = [...versions, ...DEI_VERSIONS];
    }

    return versions.map((v) => ({
      family: v.family,
      releaseYear: v.releaseYear,
      versionId: v.versionId,
      effectiveDate: v.effectiveDate,
      taxonomyUrl: v.taxonomyUrl,
      changeNotes: v.changeNotes,
    }));
  },
});

/**
 * Get tag evolution history
 */
export const getTagEvolution = query({
  args: {
    tag: v.optional(v.string()),
    family: v.optional(v.string()),
    includeDeprecated: v.optional(v.boolean()),
  },
  returns: v.array(v.object({
    tag: v.string(),
    family: v.string(),
    introducedIn: v.string(),
    deprecatedIn: v.optional(v.string()),
    replacedBy: v.optional(v.string()),
    isDeprecated: v.boolean(),
  })),
  handler: async (ctx, args) => {
    let evolution = TAG_EVOLUTION;

    if (args.tag) {
      evolution = evolution.filter((e) => e.tag === args.tag);
    }
    if (args.family) {
      evolution = evolution.filter((e) => e.family === args.family);
    }
    if (!args.includeDeprecated) {
      evolution = evolution.filter((e) => !e.deprecatedIn);
    }

    return evolution.map((e) => ({
      tag: e.tag,
      family: e.family,
      introducedIn: e.introducedIn,
      deprecatedIn: e.deprecatedIn,
      replacedBy: e.replacedBy,
      isDeprecated: !!e.deprecatedIn,
    }));
  },
});

/**
 * Validate tag for taxonomy version
 */
export const validateTagForVersion = query({
  args: {
    tag: v.string(),
    family: v.string(),
    version: v.string(),
  },
  returns: v.object({
    valid: v.boolean(),
    reason: v.optional(v.string()),
    normalizedTag: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const validity = isTagValidForVersion(args.tag, args.family, args.version);
    const normalization = normalizeTag(args.tag, args.family);

    return {
      valid: validity.valid,
      reason: validity.reason,
      normalizedTag: normalization.wasDeprecated ? normalization.normalizedTag : undefined,
    };
  },
});
