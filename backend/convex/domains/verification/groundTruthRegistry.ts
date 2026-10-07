/**
 * Ground Truth Registry
 *
 * Stores verified facts from authoritative sources for audit purposes.
 * Each fact is:
 * - Timestamped with source publication date
 * - Linked to authoritative source URL
 * - Tagged with verification method
 * - Versioned for temporal accuracy
 *
 * Use cases:
 * 1. Cross-reference claims against known facts
 * 2. Detect outdated claims (fact superseded)
 * 3. Audit trail for verification decisions
 * 4. Golden set generation for QA
 *
 * @module domains/verification/groundTruthRegistry
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type FactCategory =
  | "funding_round"
  | "valuation"
  | "acquisition"
  | "executive_change"
  | "product_launch"
  | "regulatory_approval"
  | "financial_metric"
  | "research_publication"
  | "patent"
  | "partnership"
  | "legal_action"
  | "other";

export type VerificationMethod =
  | "sec_filing"           // Direct SEC EDGAR
  | "official_announcement" // Company IR/press release
  | "regulatory_db"        // FDA, USPTO, etc.
  | "academic_db"          // arXiv, PubMed DOI
  | "wire_service"         // Reuters, AP
  | "manual_verification"; // Human verified

export interface GroundTruthFact {
  factId: string;
  subject: string;              // Entity name
  subjectIdentifiers: {         // Authoritative IDs
    cik?: string;               // SEC CIK
    ticker?: string;            // Stock ticker
    lei?: string;               // Legal Entity Identifier
    doi?: string;               // Digital Object Identifier
    nctId?: string;             // ClinicalTrials.gov ID
    patentNumber?: string;      // USPTO patent number
  };
  category: FactCategory;
  claim: string;                // The factual assertion
  quantitativeValue?: number;
  quantitativeUnit?: string;
  effectiveDate: number;        // When fact became true (unix ms)
  expirationDate?: number;      // When fact was superseded (unix ms)
  sourceUrl: string;
  sourceTier: string;
  verificationMethod: VerificationMethod;
  verifiedAt: number;
  verifiedBy: string;
  supersededBy?: string;        // factId of superseding fact
  auditNotes?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA ADDITION (add to schema.ts)
// ═══════════════════════════════════════════════════════════════════════════

/*
Add to convex/schema.ts:

groundTruthFacts: defineTable({
  factId: v.string(),
  subject: v.string(),
  subjectIdentifiers: v.object({
    cik: v.optional(v.string()),
    ticker: v.optional(v.string()),
    lei: v.optional(v.string()),
    doi: v.optional(v.string()),
    nctId: v.optional(v.string()),
    patentNumber: v.optional(v.string()),
  }),
  category: v.string(),
  claim: v.string(),
  quantitativeValue: v.optional(v.number()),
  quantitativeUnit: v.optional(v.string()),
  effectiveDate: v.number(),
  expirationDate: v.optional(v.number()),
  sourceUrl: v.string(),
  sourceTier: v.string(),
  verificationMethod: v.string(),
  verifiedAt: v.number(),
  verifiedBy: v.string(),
  supersededBy: v.optional(v.string()),
  auditNotes: v.optional(v.string()),
})
  .index("by_subject", ["subject", "effectiveDate"])
  .index("by_category", ["category", "effectiveDate"])
  .index("by_source", ["sourceUrl"])
  .index("by_active", ["subject", "expirationDate"]),

verificationAuditLog: defineTable({
  auditId: v.string(),
  action: v.string(),
  targetType: v.string(),
  targetId: v.string(),
  claim: v.string(),
  sourceUrls: v.array(v.string()),
  verdict: v.string(),
  confidence: v.number(),
  reasoning: v.string(),
  performedBy: v.string(),
  performedAt: v.number(),
  metadata: v.optional(v.any()),
})
  .index("by_target", ["targetType", "targetId"])
  .index("by_action", ["action", "performedAt"])
  .index("by_performer", ["performedBy", "performedAt"]),
*/

// ═══════════════════════════════════════════════════════════════════════════
// KNOWN ENTITY REFERENCE DATA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pre-populated reference data for common entities.
 * This data is sourced from public authoritative sources and can be audited.
 */
export const KNOWN_ENTITIES: Record<string, {
  name: string;
  identifiers: {
    cik?: string;
    ticker?: string;
    lei?: string;
  };
  type: "public_company" | "private_company" | "research_org" | "government" | "other";
  domain?: string;
  irUrl?: string;
  secFilingsUrl?: string;
  lastVerified: string;
}> = {
  // Major Tech Companies (verifiable via SEC EDGAR)
  "openai": {
    name: "OpenAI",
    identifiers: {},
    type: "private_company",
    domain: "openai.com",
    irUrl: "https://openai.com/blog",
    lastVerified: "2025-01-01",
  },
  "anthropic": {
    name: "Anthropic",
    identifiers: {},
    type: "private_company",
    domain: "anthropic.com",
    irUrl: "https://www.anthropic.com/news",
    lastVerified: "2025-01-01",
  },
  "nvidia": {
    name: "NVIDIA Corporation",
    identifiers: {
      cik: "0001045810",
      ticker: "NVDA",
      lei: "549300S4KLFTLO7GSQ80",
    },
    type: "public_company",
    domain: "nvidia.com",
    irUrl: "https://investor.nvidia.com",
    secFilingsUrl: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810&type=&dateb=&owner=include&count=40",
    lastVerified: "2025-01-01",
  },
  "microsoft": {
    name: "Microsoft Corporation",
    identifiers: {
      cik: "0000789019",
      ticker: "MSFT",
      lei: "INR2EJN1ERAN0W5ZP974",
    },
    type: "public_company",
    domain: "microsoft.com",
    irUrl: "https://www.microsoft.com/en-us/investor",
    secFilingsUrl: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000789019&type=&dateb=&owner=include&count=40",
    lastVerified: "2025-01-01",
  },
  "google": {
    name: "Alphabet Inc.",
    identifiers: {
      cik: "0001652044",
      ticker: "GOOGL",
      lei: "5493006MHB84DD0ZWV18",
    },
    type: "public_company",
    domain: "google.com",
    irUrl: "https://abc.xyz/investor/",
    secFilingsUrl: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001652044&type=&dateb=&owner=include&count=40",
    lastVerified: "2025-01-01",
  },
  "meta": {
    name: "Meta Platforms, Inc.",
    identifiers: {
      cik: "0001326801",
      ticker: "META",
      lei: "BQ4BKCS1HXDV9HN80Z93",
    },
    type: "public_company",
    domain: "meta.com",
    irUrl: "https://investor.fb.com",
    secFilingsUrl: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001326801&type=&dateb=&owner=include&count=40",
    lastVerified: "2025-01-01",
  },
  "apple": {
    name: "Apple Inc.",
    identifiers: {
      cik: "0000320193",
      ticker: "AAPL",
      lei: "HWUPKR0MPOU8FGXBT394",
    },
    type: "public_company",
    domain: "apple.com",
    irUrl: "https://investor.apple.com",
    secFilingsUrl: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=&dateb=&owner=include&count=40",
    lastVerified: "2025-01-01",
  },
  "amazon": {
    name: "Amazon.com, Inc.",
    identifiers: {
      cik: "0001018724",
      ticker: "AMZN",
      lei: "ZBER5JX2HKHUC4AID1",
    },
    type: "public_company",
    domain: "amazon.com",
    irUrl: "https://ir.aboutamazon.com",
    secFilingsUrl: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001018724&type=&dateb=&owner=include&count=40",
    lastVerified: "2025-01-01",
  },
  "tesla": {
    name: "Tesla, Inc.",
    identifiers: {
      cik: "0001318605",
      ticker: "TSLA",
      lei: "54930043XZGB27CTOV49",
    },
    type: "public_company",
    domain: "tesla.com",
    irUrl: "https://ir.tesla.com",
    secFilingsUrl: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001318605&type=&dateb=&owner=include&count=40",
    lastVerified: "2025-01-01",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get known entity info
 */
export const getKnownEntity = internalQuery({
  args: {
    entityKey: v.string(),
  },
  handler: async (_ctx, args) => {
    const normalized = args.entityKey.toLowerCase().replace(/[^a-z0-9]/g, "");
    const entity = KNOWN_ENTITIES[normalized];

    if (!entity) {
      return { found: false, entityKey: args.entityKey };
    }

    return {
      found: true,
      ...entity,
      verificationUrls: {
        secFilings: entity.secFilingsUrl,
        investorRelations: entity.irUrl,
        officialDomain: entity.domain ? `https://${entity.domain}` : undefined,
      },
    };
  },
});

/**
 * Get SEC filing URL for an entity
 */
export const getSecFilingUrl = internalQuery({
  args: {
    entityKey: v.string(),
  },
  handler: async (_ctx, args) => {
    const normalized = args.entityKey.toLowerCase().replace(/[^a-z0-9]/g, "");
    const entity = KNOWN_ENTITIES[normalized];

    if (!entity?.identifiers?.cik) {
      return { found: false, reason: "No CIK available for this entity" };
    }

    return {
      found: true,
      cik: entity.identifiers.cik,
      edgarUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${entity.identifiers.cik}&type=&dateb=&owner=include&count=40`,
      allFilingsUrl: entity.secFilingsUrl,
      ticker: entity.identifiers.ticker,
    };
  },
});

/**
 * Search for entities by name
 */
export const searchKnownEntities = internalQuery({
  args: {
    query: v.string(),
  },
  handler: async (_ctx, args) => {
    const queryLower = args.query.toLowerCase();
    const matches: Array<{ key: string; name: string; ticker?: string; type: string }> = [];

    for (const [key, entity] of Object.entries(KNOWN_ENTITIES)) {
      if (
        key.includes(queryLower) ||
        entity.name.toLowerCase().includes(queryLower) ||
        entity.identifiers.ticker?.toLowerCase() === queryLower
      ) {
        matches.push({
          key,
          name: entity.name,
          ticker: entity.identifiers.ticker,
          type: entity.type,
        });
      }
    }

    return {
      query: args.query,
      matches,
      count: matches.length,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// FACT STORAGE (requires schema tables)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Store a verified ground truth fact
 */
export const storeGroundTruthFact = internalMutation({
  args: {
    subject: v.string(),
    subjectIdentifiers: v.object({
      cik: v.optional(v.string()),
      ticker: v.optional(v.string()),
      lei: v.optional(v.string()),
      doi: v.optional(v.string()),
      nctId: v.optional(v.string()),
      patentNumber: v.optional(v.string()),
    }),
    category: v.string(),
    claim: v.string(),
    quantitativeValue: v.optional(v.number()),
    quantitativeUnit: v.optional(v.string()),
    effectiveDate: v.number(),
    sourceUrl: v.string(),
    sourceTier: v.string(),
    verificationMethod: v.string(),
    verifiedBy: v.string(),
    auditNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const factId = `gtf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Check for existing fact that might be superseded
    const existingFacts = await ctx.db
      .query("groundTruthFacts")
      .withIndex("by_subject", (q) => q.eq("subject", args.subject))
      .filter((q) =>
        q.and(
          q.eq(q.field("category"), args.category),
          q.eq(q.field("expirationDate"), undefined)
        )
      )
      .collect();

    // Mark existing facts as superseded if this is newer
    for (const existing of existingFacts) {
      if (existing.effectiveDate < args.effectiveDate) {
        await ctx.db.patch(existing._id, {
          expirationDate: args.effectiveDate,
          supersededBy: factId,
        });
      }
    }

    const id = await ctx.db.insert("groundTruthFacts", {
      factId,
      subject: args.subject,
      subjectIdentifiers: args.subjectIdentifiers,
      category: args.category,
      claim: args.claim,
      quantitativeValue: args.quantitativeValue,
      quantitativeUnit: args.quantitativeUnit,
      effectiveDate: args.effectiveDate,
      sourceUrl: args.sourceUrl,
      sourceTier: args.sourceTier,
      verificationMethod: args.verificationMethod,
      verifiedAt: Date.now(),
      verifiedBy: args.verifiedBy,
      auditNotes: args.auditNotes,
    });

    return { factId, id };
  },
});

/**
 * Get active ground truth facts for a subject
 */
export const getActiveFactsForSubject = internalQuery({
  args: {
    subject: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("groundTruthFacts")
      .withIndex("by_subject", (q) => q.eq("subject", args.subject));

    if (args.category) {
      query = query.filter((q) => q.eq(q.field("category"), args.category));
    }

    const facts = await query
      .filter((q) => q.eq(q.field("expirationDate"), undefined))
      .collect();

    return {
      subject: args.subject,
      facts,
      count: facts.length,
    };
  },
});

/**
 * Get fact history for a subject (including superseded)
 */
export const getFactHistoryForSubject = internalQuery({
  args: {
    subject: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("groundTruthFacts")
      .withIndex("by_subject", (q) => q.eq("subject", args.subject));

    if (args.category) {
      query = query.filter((q) => q.eq(q.field("category"), args.category));
    }

    const facts = await query.collect();

    // Sort by effective date descending
    facts.sort((a, b) => b.effectiveDate - a.effectiveDate);

    return {
      subject: args.subject,
      facts,
      activeCount: facts.filter((f) => !f.expirationDate).length,
      supersededCount: facts.filter((f) => f.expirationDate).length,
    };
  },
});
