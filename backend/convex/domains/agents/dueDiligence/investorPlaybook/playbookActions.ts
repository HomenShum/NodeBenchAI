/**
 * Investor Playbook Actions
 *
 * Convex actions for running the investor due diligence playbook.
 * Can be triggered standalone or as part of the main DD flow.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../../_generated/server";
import { internal, api } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";

import {
  runInvestorPlaybook,
  generatePlaybookReport,
  PlaybookConfig,
} from "./playbookOrchestrator";

import { SecuritiesRegime } from "./types";

// ============================================================================
// PUBLIC ACTIONS
// ============================================================================

/**
 * Run investor playbook standalone
 * Use this for quick verification of a company requesting funding
 */
export const runPlaybook = internalAction({
  args: {
    entityName: v.string(),
    entityType: v.union(v.literal("company"), v.literal("fund"), v.literal("person")),

    // Claims to verify (optional)
    claimedState: v.optional(v.string()),
    claimedFormationYear: v.optional(v.number()),
    claimedSecuritiesRegime: v.optional(v.string()),
    claimedFundingPortal: v.optional(v.string()),
    claimedFDAStatus: v.optional(v.string()),
    claimedPatents: v.optional(v.array(v.string())),
    claimedInvestors: v.optional(v.array(v.string())),

    // Wire/payment context
    wireInstructions: v.optional(v.string()),

    // Additional context
    userId: v.id("users"),
    ddJobId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log(`[InvestorPlaybook] Starting verification for ${args.entityName}`);

    const config: PlaybookConfig = {
      entityName: args.entityName,
      entityType: args.entityType,
      claimedState: args.claimedState,
      claimedFormationYear: args.claimedFormationYear,
      claimedSecuritiesRegime: args.claimedSecuritiesRegime as SecuritiesRegime | undefined,
      claimedFundingPortal: args.claimedFundingPortal,
      claimedFDAStatus: args.claimedFDAStatus,
      claimedPatents: args.claimedPatents,
      claimedInvestors: args.claimedInvestors,
      wireInstructions: args.wireInstructions,
    };

    const result = await runInvestorPlaybook(ctx, config);

    // Store the result
    const resultId = await ctx.runMutation(
      internal.domains.agents.dueDiligence.investorPlaybook.playbookMutations.storePlaybookResult,
      {
        entityName: args.entityName,
        entityType: args.entityType,
        synthesis: result.synthesis,
        userId: args.userId,
        ddJobId: args.ddJobId,
      }
    );

    // Generate report
    const report = generatePlaybookReport(result.synthesis);

    console.log(`[InvestorPlaybook] Completed for ${args.entityName} - Risk: ${result.synthesis.overallRisk}`);

    return {
      resultId,
      overallRisk: result.synthesis.overallRisk,
      recommendation: result.synthesis.recommendation,
      shouldDisengage: result.synthesis.shouldDisengage,
      verificationScores: result.synthesis.verificationScores,
      discrepancyCount: result.synthesis.discrepancies.length,
      stopRulesTriggered: result.synthesis.stopRules.filter(r => r.triggered).map(r => r.rule),
      executionTimeMs: result.executionTimeMs,
      report,
    };
  },
});

/**
 * Run quick investor check
 * Minimal version that just checks critical stop rules
 */
export const runQuickCheck = internalAction({
  args: {
    entityName: v.string(),
    claimedSecuritiesRegime: v.optional(v.string()),
    claimedFundingPortal: v.optional(v.string()),
    wireInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log(`[InvestorPlaybook] Quick check for ${args.entityName}`);

    const config: PlaybookConfig = {
      entityName: args.entityName,
      entityType: "company",
      claimedSecuritiesRegime: args.claimedSecuritiesRegime as SecuritiesRegime | undefined,
      claimedFundingPortal: args.claimedFundingPortal,
      wireInstructions: args.wireInstructions,
      signals: {
        isRequestingFunding: true,
      },
    };

    const result = await runInvestorPlaybook(ctx, config);

    return {
      pass: !result.synthesis.shouldDisengage && result.synthesis.overallRisk !== "critical",
      overallRisk: result.synthesis.overallRisk,
      recommendation: result.synthesis.recommendation,
      criticalIssues: result.synthesis.stopRules
        .filter(r => r.triggered && r.recommendation === "disengage")
        .map(r => r.description),
      executionTimeMs: result.executionTimeMs,
    };
  },
});

// ============================================================================
// INTERNAL ACTIONS (for integration with DD orchestrator)
// ============================================================================

/**
 * Run playbook as part of DD job
 * Called by the main DD orchestrator when funding-related signals are detected
 */
export const runPlaybookForDDJob = internalAction({
  args: {
    jobId: v.string(),
    userId: v.id("users"),
    entityName: v.string(),
    entityType: v.union(v.literal("company"), v.literal("fund"), v.literal("person")),
    complexitySignals: v.optional(v.any()),
    claims: v.optional(v.object({
      state: v.optional(v.string()),
      formationYear: v.optional(v.number()),
      securitiesRegime: v.optional(v.string()),
      fundingPortal: v.optional(v.string()),
      fdaStatus: v.optional(v.string()),
      patents: v.optional(v.array(v.string())),
      investors: v.optional(v.array(v.string())),
    })),
  },
  handler: async (ctx, args) => {
    console.log(`[InvestorPlaybook] Running for DD job ${args.jobId}`);

    const config: PlaybookConfig = {
      entityName: args.entityName,
      entityType: args.entityType,
      claimedState: args.claims?.state,
      claimedFormationYear: args.claims?.formationYear,
      claimedSecuritiesRegime: args.claims?.securitiesRegime as SecuritiesRegime | undefined,
      claimedFundingPortal: args.claims?.fundingPortal,
      claimedFDAStatus: args.claims?.fdaStatus,
      claimedPatents: args.claims?.patents,
      claimedInvestors: args.claims?.investors,
      signals: args.complexitySignals,
    };

    const result = await runInvestorPlaybook(ctx, config);

    // Store result linked to DD job
    await ctx.runMutation(
      internal.domains.agents.dueDiligence.investorPlaybook.playbookMutations.storePlaybookResult,
      {
        entityName: args.entityName,
        entityType: args.entityType,
        synthesis: result.synthesis,
        userId: args.userId,
        ddJobId: args.jobId,
      }
    );

    return {
      overallRisk: result.synthesis.overallRisk,
      recommendation: result.synthesis.recommendation,
      shouldDisengage: result.synthesis.shouldDisengage,
      verificationScores: result.synthesis.verificationScores,
      stopRulesTriggered: result.synthesis.stopRules.filter(r => r.triggered),
      branchFindings: {
        entityVerification: result.branchResults.entityVerification,
        secEdgar: result.branchResults.secEdgar,
        finraValidation: result.branchResults.finraValidation,
        fdaVerification: result.branchResults.fdaVerification,
        usptoDeepdive: result.branchResults.usptoDeepdive,
        moneyFlowIntegrity: result.branchResults.moneyFlowIntegrity,
      },
      executionTimeMs: result.executionTimeMs,
    };
  },
});

/**
 * Check if entity triggers playbook (based on signals)
 */
export const shouldRunPlaybook = internalAction({
  args: {
    entityName: v.string(),
    complexitySignals: v.any(),
  },
  handler: async (ctx, args) => {
    const signals = args.complexitySignals || {};

    // Playbook should run if:
    // 1. Funding is being requested
    // 2. Company is in regulated sector (HealthTech, Fintech, Biotech)
    // 3. Wire instructions are provided
    // 4. SEC/FDA/patent claims are made

    const shouldRun =
      signals.isRequestingFunding ||
      signals.wireInstructionsProvided ||
      signals.cryptoPaymentRequested ||
      signals.claimedFDAStatus ||
      signals.claimedPatents?.length > 0 ||
      signals.fundingPortalMentioned ||
      signals.sectors?.some((s: string) =>
        ["HealthTech", "Biotech", "Fintech", "MedTech", "Pharma"].includes(s)
      );

    return { shouldRun, reason: shouldRun ? "Funding/regulatory signals detected" : "No playbook triggers" };
  },
});

// ============================================================================
// NATURAL LANGUAGE QUERY ACTIONS
// ============================================================================

/**
 * Run playbook from natural language query
 * Extracts entity name and claims from user's question
 */
export const runFromNaturalLanguage = internalAction({
  args: {
    query: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    console.log(`[InvestorPlaybook] Natural language query: "${args.query}"`);

    // Extract entity name and signals from query
    const extracted = extractFromQuery(args.query);
    console.log(`[InvestorPlaybook] Extracted:`, extracted);

    const config: PlaybookConfig = {
      entityName: extracted.entityName,
      entityType: "company",
      claimedSecuritiesRegime: extracted.securitiesRegime as SecuritiesRegime | undefined,
      claimedFundingPortal: extracted.fundingPortal,
      claimedFDAStatus: extracted.fdaStatus,
      claimedPatents: extracted.patents,
      signals: {
        isRequestingFunding: extracted.isFundingRelated,
      },
    };

    const result = await runInvestorPlaybook(ctx, config);

    const resultId = await ctx.runMutation(
      internal.domains.agents.dueDiligence.investorPlaybook.playbookMutations.storePlaybookResult,
      {
        entityName: extracted.entityName,
        entityType: "company",
        synthesis: result.synthesis,
        userId: args.userId,
      }
    );

    const report = generatePlaybookReport(result.synthesis);

    // Build scam assessment
    const isLikelyScam = result.synthesis.shouldDisengage ||
      result.synthesis.overallRisk === "critical" ||
      result.synthesis.overallRisk === "high";

    const reasons: string[] = [];
    const triggeredRules = result.synthesis.stopRules.filter((r: any) => r.triggered);
    if (triggeredRules.length > 0) {
      reasons.push(...triggeredRules.map((r: any) => r.description));
    }
    if (result.synthesis.discrepancies.length > 0) {
      reasons.push(`${result.synthesis.discrepancies.length} discrepancy(ies) found`);
    }

    return {
      entityName: extracted.entityName,
      isLikelyScam,
      riskLevel: result.synthesis.overallRisk,
      recommendation: result.synthesis.recommendation,
      shouldDisengage: result.synthesis.shouldDisengage,
      reasons,
      verificationScores: result.synthesis.verificationScores,
      whatToDoNext: isLikelyScam
        ? [
          "Do NOT send money directly",
          "Request specific SEC filing numbers (Form C/D)",
          "Ask for FDA clearance number (K-number) if they claim FDA cleared",
          "Verify the funding portal is FINRA registered",
        ]
        : result.synthesis.conditions || ["Proceed with standard due diligence"],
      report,
      resultId,
      executionTimeMs: result.executionTimeMs,
    };
  },
});

/**
 * Simplified scam check from natural language
 */
export const isThisAScam = internalAction({
  args: {
    question: v.string(),
  },
  handler: async (ctx, args) => {
    console.log(`[InvestorPlaybook] Scam check: "${args.question}"`);

    const extracted = extractFromQuery(args.question);

    const config: PlaybookConfig = {
      entityName: extracted.entityName,
      entityType: "company",
      claimedSecuritiesRegime: extracted.securitiesRegime as SecuritiesRegime | undefined,
      claimedFundingPortal: extracted.fundingPortal,
      claimedFDAStatus: extracted.fdaStatus,
      claimedPatents: extracted.patents,
      signals: {
        isRequestingFunding: extracted.isFundingRelated,
      },
    };

    const result = await runInvestorPlaybook(ctx, config);
    const report = generatePlaybookReport(result.synthesis);

    const isLikelyScam = result.synthesis.shouldDisengage ||
      result.synthesis.overallRisk === "critical" ||
      result.synthesis.overallRisk === "high";

    const reasons: string[] = [];
    const triggeredRules = result.synthesis.stopRules.filter((r: any) => r.triggered);
    if (triggeredRules.length > 0) {
      reasons.push(...triggeredRules.map((r: any) => r.description));
    }

    return {
      entityName: extracted.entityName,
      isLikelyScam,
      riskLevel: result.synthesis.overallRisk,
      recommendation: result.synthesis.recommendation,
      reasons,
      whatToDoNext: isLikelyScam
        ? [
          "Do NOT send money directly",
          "Request specific SEC filing numbers",
          "Ask for FDA clearance K-number",
          "Verify FINRA registration",
        ]
        : ["Proceed with standard due diligence"],
      report,
      executionTimeMs: result.executionTimeMs,
    };
  },
});

// Helper to extract claims from natural language query
function extractFromQuery(query: string): {
  entityName: string;
  isFundingRelated: boolean;
  isScamCheck: boolean;
  securitiesRegime?: string;
  fundingPortal?: string;
  fdaStatus?: string;
  patents?: string[];
} {
  const queryLower = query.toLowerCase();

  // Extract entity name from patterns (order matters - more specific patterns first)
  let entityName = "Unknown Company";
  const skipWords = ["the", "this", "that", "full", "complete", "quick", "a", "an"];

  const patterns = [
    // Quoted names - highest priority
    /"([^"]+)"/i,
    /'([^']+)'/i,
    // CamelCase names (e.g., MyDentalWig, TechStartup) - HIGH PRIORITY
    /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/,
    // "on [entity] company" - capture word before "company"
    /(?:on|about|for|check|investigate|diligence on)\s+(\w+)\s+company/i,
    // "[entity] company for" - capture word before "company for"
    /(\w+)\s+company\s+for/i,
    // "is [entity] a scam" pattern
    /is\s+(\w+)\s+(?:a\s+)?(?:scam|legit|fraud)/i,
    // Single word followed by "company"
    /(\w+)\s+company(?:\s|$)/i,
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match && match[1] && match[1].length > 2) {
      // Skip common words that aren't entity names
      if (skipWords.includes(match[1].toLowerCase())) continue;

      // Clean up and capitalize
      entityName = match[1].trim();
      // Capitalize first letter if not already CamelCase
      if (!/[A-Z]/.test(entityName)) {
        entityName = entityName.charAt(0).toUpperCase() + entityName.slice(1);
      }
      console.log(`[Extract] Found entity: "${entityName}" using pattern: ${pattern.source}`);
      break;
    }
  }

  // Detect signals
  const isFundingRelated = /funding|invest|vc|venture|raise|capital/i.test(queryLower);
  const isScamCheck = /scam|fraud|legit|legitimate|real|fake/i.test(queryLower);

  // Extract FDA status
  let fdaStatus: string | undefined;
  if (/fda\s*cleared/i.test(queryLower)) fdaStatus = "FDA Cleared";
  else if (/fda\s*approved/i.test(queryLower)) fdaStatus = "FDA Approved";

  // Extract securities regime
  let securitiesRegime: string | undefined;
  if (/reg\s*cf|crowdfund/i.test(queryLower)) securitiesRegime = "Reg CF";
  else if (/reg\s*d|506\s*\(b\)/i.test(queryLower)) securitiesRegime = "Reg D 506(b)";

  // Extract portal
  let fundingPortal: string | undefined;
  const portalPatterns = [/wefunder/i, /republic/i, /startengine/i, /picmii/i];
  for (const pattern of portalPatterns) {
    if (pattern.test(queryLower)) {
      const match = queryLower.match(pattern);
      if (match) fundingPortal = match[0];
      break;
    }
  }

  // Extract patent numbers
  const patentMatches = queryLower.match(/us\s*(\d{7,10})/gi);
  const patents = patentMatches?.map(p => p.replace(/\s/g, "").toUpperCase());

  return {
    entityName,
    isFundingRelated,
    isScamCheck,
    securitiesRegime,
    fundingPortal,
    fdaStatus,
    patents,
  };
}
