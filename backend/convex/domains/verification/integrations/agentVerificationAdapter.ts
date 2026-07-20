/**
 * Agent Pipeline Verification Adapter
 *
 * Integrates the verification system into the agent pipeline:
 * 1. Provides verification tools for agents (Scout, Historian, Analyst, Publisher)
 * 2. Automatic claim verification during research
 * 3. Source credibility checking before citation
 * 4. Ground truth cross-referencing
 *
 * @module domains/verification/integrations/agentVerificationAdapter
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface AgentVerificationContext {
  agentId: string;
  agentRole: "scout" | "historian" | "analyst" | "publisher";
  workflowId?: string;
  timestamp: number;
}

export interface VerificationToolResult {
  success: boolean;
  verified: boolean;
  confidence: number;
  sourceTier: string;
  evidence: string;
  suggestedActions: string[];
}

export interface ClaimForVerification {
  claim: string;
  sourceUrl?: string;
  sourceName?: string;
  entityName?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS FOR AGENT USE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tool schema for agent verification
 * Compatible with ai-sdk tool format
 */
export const verifyClaimToolDefinition = {
  name: "verifyClaim",
  description: `Verify a factual claim against authoritative sources and ground truth.

Use this tool BEFORE including any factual claim in your output.
Provides source credibility tier and verification status.

Returns:
- verified: true if claim matches authoritative source
- confidence: 0-1 score
- sourceTier: tier1_authoritative | tier2_reliable | tier3_unverified
- suggestedActions: steps to improve verification`,
  parameters: {
    type: "object" as const,
    properties: {
      claim: {
        type: "string",
        description: "The factual claim to verify",
      },
      sourceUrl: {
        type: "string",
        description: "URL of the source making the claim (optional)",
      },
      entityName: {
        type: "string",
        description: "Name of the company/entity the claim is about (optional)",
      },
    },
    required: ["claim"],
  },
};

export const checkSourceCredibilityToolDefinition = {
  name: "checkSourceCredibility",
  description: `Check the credibility tier of a source URL.

Use this tool to determine if a source is authoritative enough to cite.
Returns credibility tier and whether it can support fact claims.`,
  parameters: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "The URL to check credibility for",
      },
    },
    required: ["url"],
  },
};

export const lookupGroundTruthToolDefinition = {
  name: "lookupGroundTruth",
  description: `Look up verified facts about an entity from the ground truth registry.

Use this tool to get authoritative facts about companies, people, or events.
Returns verified facts with their sources and effective dates.`,
  parameters: {
    type: "object" as const,
    properties: {
      entityName: {
        type: "string",
        description: "Name of the entity to look up",
      },
      category: {
        type: "string",
        description:
          "Optional category filter: funding_round, valuation, acquisition, executive_change, regulatory_approval",
      },
    },
    required: ["entityName"],
  },
};

export const getSuggestedAuthoritativeSourcesToolDefinition = {
  name: "getSuggestedAuthoritativeSources",
  description: `Get suggested authoritative sources to verify a claim about an entity.

Use this tool when you need to find authoritative sources for verification.
Returns URLs for SEC filings, FDA databases, official IR pages, etc.`,
  parameters: {
    type: "object" as const,
    properties: {
      entityName: {
        type: "string",
        description: "Name of the entity",
      },
      claimType: {
        type: "string",
        description: "Type of claim: funding, regulatory, financial, executive, acquisition",
      },
    },
    required: ["entityName", "claimType"],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// TOOL EXECUTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute claim verification tool
 */
export const executeVerifyClaim = internalAction({
  args: {
    claim: v.string(),
    sourceUrl: v.optional(v.string()),
    entityName: v.optional(v.string()),
    agentContext: v.optional(
      v.object({
        agentId: v.string(),
        agentRole: v.string(),
        workflowId: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<VerificationToolResult> => {
    try {
      // Use the verification workflow to verify the claim
      const result = await ctx.runAction(
        internal.domains.verification.verificationWorkflow.verifyClaim,
        {
          claim: args.claim,
          sourceUrls: args.sourceUrl ? [args.sourceUrl] : [],
          context: {
            domain: args.entityName || "unknown",
            timestamp: Date.now(),
          },
        }
      );

      // Log verification action
      await ctx.runMutation(
        internal.domains.verification.verificationAuditTrail.logVerificationAction,
        {
          action: result.verdict === "verified" ? "claim_verified" : "source_checked",
          targetType: "claim",
          targetId: `agent_${args.agentContext?.agentId || "unknown"}_${Date.now()}`,
          claim: args.claim,
          sourceUrls: args.sourceUrl ? [args.sourceUrl] : [],
          verdict: result.verdict,
          confidence: result.confidence,
          reasoning: result.reasoning,
          performedBy: `Agent:${args.agentContext?.agentRole || "unknown"}`,
          metadata: {
            agentContext: args.agentContext,
            entityName: args.entityName,
          },
        }
      );

      return {
        success: true,
        verified: result.verdict === "verified" || result.verdict === "corroborated",
        confidence: result.confidence,
        sourceTier: result.sourceCredibility?.tier || "tier3_unverified",
        evidence: result.reasoning,
        suggestedActions: result.authoritativeSourceUrls?.length > 0
          ? [`Cross-reference with: ${result.authoritativeSourceUrls[0]}`]
          : ["Find authoritative source to verify"],
      };
    } catch (error) {
      console.error("[agentVerificationAdapter] executeVerifyClaim error:", error);
      return {
        success: false,
        verified: false,
        confidence: 0,
        sourceTier: "tier3_unverified",
        evidence: `Verification failed: ${error}`,
        suggestedActions: ["Manual verification required"],
      };
    }
  },
});

/**
 * Execute source credibility check tool
 */
export const executeCheckSourceCredibility = internalAction({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const credibility = await ctx.runQuery(
      internal.domains.verification.publicSourceRegistry.getSourceCredibility,
      { url: args.url }
    );

    return {
      url: args.url,
      tier: credibility.tier,
      category: credibility.category,
      canSupportFactClaims: credibility.canSupportFactClaims,
      isAuthoritative: credibility.tier === "tier1_authoritative",
      isReliable: credibility.tier !== "tier3_unverified",
      recommendation:
        credibility.tier === "tier1_authoritative"
          ? "Safe to cite as authoritative source"
          : credibility.tier === "tier2_reliable"
            ? "Can cite with attribution, consider cross-referencing"
            : "Requires verification from authoritative source before citing",
    };
  },
});

/**
 * Execute ground truth lookup tool
 */
export const executeLookupGroundTruth = internalAction({
  args: {
    entityName: v.string(),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get known entity info
    const entityInfo = await ctx.runQuery(
      internal.domains.verification.groundTruthRegistry.getKnownEntity,
      { entityKey: args.entityName }
    );

    // Get active facts
    const facts = await ctx.runQuery(
      internal.domains.verification.groundTruthRegistry.getActiveFactsForSubject,
      {
        subject: args.entityName,
        category: args.category,
      }
    );

    return {
      entityName: args.entityName,
      found: entityInfo.found,
      entityType: entityInfo.found ? entityInfo.type : undefined,
      identifiers: entityInfo.found ? entityInfo.identifiers : undefined,
      verificationUrls: entityInfo.found ? entityInfo.verificationUrls : undefined,
      facts: facts.facts.map((f: { factId: string; claim: string; effectiveDate: number; sourceUrl: string; verificationMethod: string }) => ({
        factId: f.factId,
        claim: f.claim,
        effectiveDate: new Date(f.effectiveDate).toISOString(),
        sourceUrl: f.sourceUrl,
        verificationMethod: f.verificationMethod,
      })),
      factCount: facts.count,
    };
  },
});

/**
 * Execute suggested authoritative sources tool
 */
export const executeGetSuggestedAuthoritativeSources = internalAction({
  args: {
    entityName: v.string(),
    claimType: v.string(),
  },
  handler: async (ctx, args) => {
    // Get known entity info for SEC lookup
    const entityInfo = await ctx.runQuery(
      internal.domains.verification.groundTruthRegistry.getKnownEntity,
      { entityKey: args.entityName }
    );

    const sources: Array<{
      url: string;
      type: string;
      description: string;
    }> = [];

    // Add entity-specific sources
    if (entityInfo.found && entityInfo.verificationUrls) {
      if (entityInfo.verificationUrls.secFilings) {
        sources.push({
          url: entityInfo.verificationUrls.secFilings,
          type: "SEC EDGAR",
          description: "Official SEC filings (10-K, 10-Q, 8-K)",
        });
      }
      if (entityInfo.verificationUrls.investorRelations) {
        sources.push({
          url: entityInfo.verificationUrls.investorRelations,
          type: "Investor Relations",
          description: "Official company announcements and press releases",
        });
      }
    }

    // Add claim-type-specific sources
    switch (args.claimType.toLowerCase()) {
      case "funding":
        sources.push({
          url: `https://www.crunchbase.com/textsearch?q=${encodeURIComponent(args.entityName)}`,
          type: "Crunchbase",
          description: "Funding round database (tier2_reliable)",
        });
        break;
      case "regulatory":
        sources.push({
          url: "https://www.accessdata.fda.gov/scripts/cder/daf/",
          type: "FDA Drug Approvals",
          description: "FDA approval database",
        });
        sources.push({
          url: "https://clinicaltrials.gov/",
          type: "ClinicalTrials.gov",
          description: "Clinical trial registry",
        });
        break;
      case "financial":
        if (entityInfo.found && entityInfo.identifiers?.ticker) {
          sources.push({
            url: `https://finance.yahoo.com/quote/${entityInfo.identifiers.ticker}`,
            type: "Yahoo Finance",
            description: "Stock data and financials",
          });
        }
        break;
      case "acquisition":
        sources.push({
          url: `https://www.sec.gov/cgi-bin/srch-ia?text=${encodeURIComponent(args.entityName)}+8-K&first=1&last=40`,
          type: "SEC 8-K Search",
          description: "Material event filings for M&A",
        });
        break;
    }

    return {
      entityName: args.entityName,
      claimType: args.claimType,
      suggestedSources: sources,
      hasAuthoritativeSource: sources.some((s) => s.type.includes("SEC") || s.type.includes("FDA")),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// AGENT WORKFLOW HOOKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pre-publish verification hook
 * Called before an agent publishes content to verify all claims
 */
export const prePubilshVerification = internalAction({
  args: {
    content: v.string(),
    citations: v.array(
      v.object({
        url: v.string(),
        quote: v.optional(v.string()),
      })
    ),
    agentId: v.string(),
    agentRole: v.string(),
    workflowId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const results: Array<{
      claim: string;
      verified: boolean;
      confidence: number;
      issue?: string;
    }> = [];

    // Extract claims from content
    const claimExtraction = await ctx.runAction(
      internal.domains.verification.entailmentChecker.extractVerifiableFacts,
      {
        content: args.content,
        sourceUrl: args.citations[0]?.url || "",
      }
    );

    // Verify each claim
    for (const fact of claimExtraction.facts.slice(0, 5)) {
      const verificationResult = await ctx.runAction(
        internal.domains.verification.integrations.agentVerificationAdapter.executeVerifyClaim,
        {
          claim: fact.factText,
          sourceUrl: args.citations[0]?.url,
          agentContext: {
            agentId: args.agentId,
            agentRole: args.agentRole,
            workflowId: args.workflowId,
          },
        }
      );

      results.push({
        claim: fact.factText,
        verified: verificationResult.verified,
        confidence: verificationResult.confidence,
        issue: !verificationResult.verified ? verificationResult.evidence : undefined,
      });
    }

    // Check citation source credibility
    const citationChecks: Array<{
      url: string;
      tier: string;
      canCite: boolean;
    }> = [];

    for (const citation of args.citations) {
      const credibility = await ctx.runAction(
        internal.domains.verification.integrations.agentVerificationAdapter.executeCheckSourceCredibility,
        { url: citation.url }
      );

      citationChecks.push({
        url: citation.url,
        tier: credibility.tier,
        canCite: credibility.isReliable,
      });
    }

    // Compute overall status
    const verifiedCount = results.filter((r) => r.verified).length;
    const totalClaims = results.length;
    const verificationRate = totalClaims > 0 ? verifiedCount / totalClaims : 0;
    const hasUnreliableCitations = citationChecks.some((c) => !c.canCite);

    const readyToPublish =
      verificationRate >= 0.8 && !hasUnreliableCitations;

    return {
      readyToPublish,
      verificationRate,
      claimResults: results,
      citationChecks,
      blockers: [
        ...(verificationRate < 0.8
          ? [`${Math.round((1 - verificationRate) * 100)}% of claims unverified`]
          : []),
        ...(hasUnreliableCitations
          ? ["Contains citations from unverified sources"]
          : []),
      ],
      recommendations:
        !readyToPublish
          ? [
              "Add authoritative sources for unverified claims",
              "Replace tier3 citations with tier1/tier2 sources",
            ]
          : [],
    };
  },
});

/**
 * Get verification tools for agent use
 * Returns tool definitions compatible with ai-sdk
 */
export const getVerificationTools = internalAction({
  args: {},
  handler: async () => {
    return {
      verifyClaim: verifyClaimToolDefinition,
      checkSourceCredibility: checkSourceCredibilityToolDefinition,
      lookupGroundTruth: lookupGroundTruthToolDefinition,
      getSuggestedAuthoritativeSources: getSuggestedAuthoritativeSourcesToolDefinition,
    };
  },
});
