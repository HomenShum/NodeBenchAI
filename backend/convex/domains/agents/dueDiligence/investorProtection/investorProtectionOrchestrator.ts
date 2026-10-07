/**
 * Investor Protection Due Diligence Orchestrator
 *
 * Main workflow for verifying claims made by startups raising money.
 * Executes 5 sequential verification phases and generates a fraud risk report.
 */

import { v } from "convex/values";
import { internalAction } from "../../../../_generated/server";
import { api, internal } from "../../../../_generated/api";

import type {
  InvestorProtectionJobConfig,
  ExtractedClaims,
  EntityVerificationResult,
  SecuritiesVerificationResult,
  ClaimsValidationResult,
  MoneyFlowVerificationResult,
  Discrepancy,
  InvestorProtectionVerdict,
  VerificationSummary,
  SEVERITY_WEIGHTS,
  FRAUD_INDICATOR_WEIGHTS,
  FDAVerificationItem,
  PatentVerificationItem,
} from "./types";

import { extractClaims, extractClaimsWithRegex } from "./phases/claimsExtraction";
import { secAdapter } from "../../../search/fusion/adapters/secAdapter";
import { fdaAdapter } from "../../../search/fusion/adapters/fdaAdapter";
import { usptoAdapter } from "../../../search/fusion/adapters/usptoAdapter";
import { finraAdapter } from "../../../search/fusion/adapters/finraAdapter";
import { stateRegistryAdapter } from "../../../search/fusion/adapters/stateRegistryAdapter";

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start an investor protection verification job
 */
export const startVerificationJob = internalAction({
  args: {
    offeringName: v.string(),
    offeringUrl: v.optional(v.string()),
    fundingPortal: v.optional(v.string()),
    pitchText: v.optional(v.string()),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const jobId = crypto.randomUUID();
    const startTime = Date.now();

    console.log(`[InvestorProtection] Starting verification job ${jobId} for ${args.offeringName}`);

    // Create job record
    await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalCreateJob, {
      jobId,
      userId: args.userId,
      offeringName: args.offeringName,
      offeringUrl: args.offeringUrl,
      fundingPortal: args.fundingPortal,
      pitchText: args.pitchText,
    });

    try {
      // Phase 0: Extract claims
      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalUpdateJobStatus, {
        jobId,
        userId: args.userId,
        status: "extracting_claims",
        startedAt: Date.now(),
      });

      const extractedClaims = await executeClaimsExtraction(ctx, args.pitchText || args.offeringName);

      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalSaveExtractedClaims, {
        jobId,
        userId: args.userId,
        extractedClaims: {
          companyName: extractedClaims.companyName,
          companyNameVariants: extractedClaims.companyNameVariants || [],
          incorporationState: extractedClaims.incorporationState,
          incorporationDate: extractedClaims.incorporationDate,
          secFilingType: extractedClaims.secFilingType,
          fundingPortal: extractedClaims.fundingPortal,
          fdaClaims: extractedClaims.fdaClaims,
          patentClaims: extractedClaims.patentClaims,
          fundingClaims: extractedClaims.fundingClaims,
          otherClaims: extractedClaims.otherClaims,
          extractedAt: extractedClaims.extractedAt,
          confidence: extractedClaims.confidence,
        },
      });

      // Phase 1: Entity Verification
      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalUpdateJobStatus, {
        jobId,
        userId: args.userId,
        status: "verifying_entity",
      });

      const entityResult = await executeEntityVerification(
        extractedClaims.companyName,
        extractedClaims.incorporationState
      );

      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalSaveEntityVerification, {
        jobId,
        userId: args.userId,
        entityVerification: {
          verified: entityResult.verified,
          stateRegistry: entityResult.stateRegistry,
          record: entityResult.record ? {
            state: entityResult.record.state,
            entityName: entityResult.record.entityName,
            fileNumber: entityResult.record.fileNumber,
            formationDate: entityResult.record.formationDate,
            registeredAgent: entityResult.record.registeredAgent,
            registeredAgentAddress: entityResult.record.registeredAgentAddress,
            status: entityResult.record.status,
            entityType: entityResult.record.entityType,
          } : undefined,
          discrepancies: entityResult.discrepancies,
          redFlags: entityResult.redFlags,
          verifiedAt: entityResult.verifiedAt,
        },
      });

      // Phase 2: Securities Verification
      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalUpdateJobStatus, {
        jobId,
        userId: args.userId,
        status: "verifying_securities",
      });

      const securitiesResult = await executeSecuritiesVerification(
        extractedClaims.companyName,
        extractedClaims.secFilingType,
        extractedClaims.fundingPortal || args.fundingPortal
      );

      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalSaveSecuritiesVerification, {
        jobId,
        userId: args.userId,
        securitiesVerification: {
          verified: securitiesResult.verified,
          filingType: securitiesResult.filingType,
          filing: securitiesResult.filing ? {
            formType: securitiesResult.filing.formType,
            filingDate: securitiesResult.filing.filingDate,
            cik: securitiesResult.filing.cik,
            accessionNumber: securitiesResult.filing.accessionNumber,
            issuerName: securitiesResult.filing.issuerName,
            offeringAmount: securitiesResult.filing.offeringAmount,
            url: securitiesResult.filing.url,
          } : undefined,
          filingFound: securitiesResult.filingFound,
          fundingPortal: securitiesResult.fundingPortal ? {
            portalName: securitiesResult.fundingPortal.portalName,
            finraId: securitiesResult.fundingPortal.finraId,
            registrationDate: securitiesResult.fundingPortal.registrationDate,
            isRegistered: securitiesResult.fundingPortal.isRegistered,
          } : undefined,
          portalVerified: securitiesResult.portalVerified,
          discrepancies: securitiesResult.discrepancies,
          redFlags: securitiesResult.redFlags,
          verifiedAt: securitiesResult.verifiedAt,
        },
      });

      // Phase 3: Claims Validation (FDA + Patents)
      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalUpdateJobStatus, {
        jobId,
        userId: args.userId,
        status: "validating_claims",
      });

      const claimsResult = await executeClaimsValidation(
        extractedClaims.companyName,
        extractedClaims.fdaClaims,
        extractedClaims.patentClaims
      );

      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalSaveClaimsValidation, {
        jobId,
        userId: args.userId,
        claimsValidation: {
          fdaVerifications: claimsResult.fdaVerifications.map((v) => ({
            claimDescription: v.claim.description,
            verified: v.verified,
            kNumber: (v.record as any)?.kNumber,
            deviceName: (v.record as any)?.deviceName,
            applicant: (v.record as any)?.applicant,
            discrepancy: v.discrepancy,
          })),
          patentVerifications: claimsResult.patentVerifications.map((v) => ({
            claimDescription: v.claim.description,
            verified: v.verified,
            patentNumber: v.record?.patentNumber,
            assignee: v.record?.assignee,
            assigneeMatches: v.assigneeMatches,
            discrepancy: v.discrepancy,
          })),
          allFDAClaimed: claimsResult.allFDAClaimed,
          allFDAVerified: claimsResult.allFDAVerified,
          allPatentsClaimed: claimsResult.allPatentsClaimed,
          allPatentsVerified: claimsResult.allPatentsVerified,
          verifiedAt: claimsResult.verifiedAt,
        },
      });

      // Phase 4: Money Flow Verification
      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalUpdateJobStatus, {
        jobId,
        userId: args.userId,
        status: "checking_money_flow",
      });

      const moneyFlowResult = await executeMoneyFlowVerification(
        extractedClaims.secFilingType,
        securitiesResult.portalVerified,
        args.pitchText
      );

      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalSaveMoneyFlowVerification, {
        jobId,
        userId: args.userId,
        moneyFlowVerification: {
          verified: moneyFlowResult.verified,
          expectedFlow: moneyFlowResult.expectedFlow,
          escrowAgent: moneyFlowResult.escrowAgent,
          escrowVerified: moneyFlowResult.escrowVerified,
          redFlags: moneyFlowResult.redFlags.map((r) => r.flag),
          verifiedAt: moneyFlowResult.verifiedAt,
        },
      });

      // Phase 5: Synthesis
      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalUpdateJobStatus, {
        jobId,
        userId: args.userId,
        status: "synthesizing",
      });

      const synthesis = synthesizeResults(
        entityResult,
        securitiesResult,
        claimsResult,
        moneyFlowResult
      );

      // Save final result
      const resultId = await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalSaveResult, {
        jobId,
        userId: args.userId,
        entityName: extractedClaims.companyName,
        entityType: "company",
        overallRisk: mapVerdictToRisk(synthesis.verdict),
        recommendation: mapVerdictToRecommendation(synthesis.verdict),
        shouldDisengage: synthesis.verdict === "FRAUD_RISK",
        verificationScores: {
          entity: entityResult.verified ? 1.0 : 0.0,
          securities: securitiesResult.verified ? 1.0 : 0.0,
          finra: securitiesResult.portalVerified ? 1.0 : 0.0,
          fda: claimsResult.allFDAClaimed > 0 ? claimsResult.allFDAVerified / claimsResult.allFDAClaimed : 1.0,
          patents: claimsResult.allPatentsClaimed > 0 ? claimsResult.allPatentsVerified / claimsResult.allPatentsClaimed : 1.0,
          moneyFlow: moneyFlowResult.verified ? 1.0 : 0.0,
          overall: 1.0 - (synthesis.fraudRiskScore / 100),
        },
        discrepancyCount: synthesis.discrepancies.length,
        criticalDiscrepancies: synthesis.discrepancies.filter((d) => d.severity === "critical").length,
        stopRulesTriggered: synthesis.fraudIndicators,
        branchesExecuted: ["entity", "securities", "claims", "money_flow", "synthesis"],
        executionTimeMs: Date.now() - startTime,
      });

      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalUpdateJobStatus, {
        jobId,
        userId: args.userId,
        status: "completed",
        completedAt: Date.now(),
        elapsedMs: Date.now() - startTime,
      });

      return {
        jobId,
        resultId,
        verdict: synthesis.verdict,
        fraudRiskScore: synthesis.fraudRiskScore,
        discrepancyCount: synthesis.discrepancies.length,
        elapsedMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error(`[InvestorProtection] Job ${jobId} failed:`, error);

      await ctx.runMutation(internal.domains.agents.dueDiligence.investorProtection.investorProtectionMutations.internalUpdateJobStatus, {
        jobId,
        userId: args.userId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE EXECUTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function executeClaimsExtraction(ctx: any, pitchText: string): Promise<ExtractedClaims> {
  console.log("[InvestorProtection] Phase 0: Extracting claims");

  // Use regex fallback for now (LLM integration can be added later)
  return extractClaimsWithRegex(pitchText);
}

async function executeEntityVerification(
  companyName: string,
  claimedState?: string
): Promise<EntityVerificationResult> {
  console.log(`[InvestorProtection] Phase 1: Verifying entity ${companyName}`);

  const result = await stateRegistryAdapter.verifyEntity(companyName, claimedState);

  return {
    verified: result.verified,
    stateRegistry: result.record?.state,
    record: result.record || undefined,
    discrepancies: result.discrepancies,
    redFlags: result.redFlags,
    sources: result.record ? [{
      type: "state_registry",
      url: result.record.sourceUrl,
      accessedAt: Date.now(),
      verified: result.verified,
    }] : [],
    verifiedAt: Date.now(),
  };
}

async function executeSecuritiesVerification(
  companyName: string,
  claimedFilingType: string,
  fundingPortal?: string
): Promise<SecuritiesVerificationResult> {
  console.log(`[InvestorProtection] Phase 2: Verifying securities for ${companyName}`);

  const discrepancies: string[] = [];
  const redFlags: string[] = [];

  // Search for SEC filings
  const filingResult = await secAdapter.verifyCompanyHasFilings(companyName, ["C", "D"]);

  let filing: any | undefined = undefined;
  let filingType = claimedFilingType;

  if (filingResult.hasFilings && filingResult.filings.length > 0) {
    const firstFiling = filingResult.filings[0];
    filing = {
      formType: firstFiling.formType,
      filingDate: firstFiling.filingDate,
      cik: firstFiling.cik,
      accessionNumber: firstFiling.accessionNumber,
      issuerName: firstFiling.companyName,
      url: firstFiling.url,
    };

    // Check if filing type matches claimed type
    if (claimedFilingType === "Reg CF" && !firstFiling.formType.startsWith("C")) {
      discrepancies.push(`Claimed Reg CF but found Form ${firstFiling.formType}`);
    }
    if (claimedFilingType.includes("Reg D") && !firstFiling.formType.startsWith("D")) {
      discrepancies.push(`Claimed Reg D but found Form ${firstFiling.formType}`);
    }
  } else {
    redFlags.push("no_sec_filing");
    discrepancies.push(`No SEC filings found for ${companyName}`);
  }

  // Verify funding portal if provided
  let portalRecord: any | undefined = undefined;
  let portalVerified = false;

  if (fundingPortal) {
    const portalResult = await finraAdapter.verifyFundingPortal(fundingPortal);
    portalVerified = portalResult.isRegistered;

    if (portalResult.record) {
      portalRecord = {
        portalName: portalResult.record.portalName,
        finraId: portalResult.record.crd,
        registrationDate: portalResult.record.registrationDate,
        isRegistered: portalResult.isRegistered,
      };
    }

    if (!portalVerified) {
      redFlags.push("unregistered_portal");
      discrepancies.push(portalResult.discrepancy || `Funding portal ${fundingPortal} not FINRA registered`);
    }
  }

  return {
    verified: filingResult.hasFilings && (!fundingPortal || portalVerified),
    filingType: filingType as any,
    filing,
    filingFound: filingResult.hasFilings,
    fundingPortal: portalRecord,
    portalVerified,
    discrepancies,
    redFlags,
    sources: [],
    verifiedAt: Date.now(),
  };
}

async function executeClaimsValidation(
  companyName: string,
  fdaClaims: Array<{ description: string; claimedType: string; clearanceNumber?: string; productName?: string }>,
  patentClaims: Array<{ description: string; patentNumber?: string; status: string; inventorNames?: string[] }>
): Promise<ClaimsValidationResult> {
  console.log(`[InvestorProtection] Phase 3: Validating claims for ${companyName}`);

  // Verify FDA claims
  const fdaVerifications: any[] = [];
  for (const claim of fdaClaims) {
    if (claim.clearanceNumber) {
      const result = await fdaAdapter.verify510kClaim(claim.clearanceNumber, companyName);
      fdaVerifications.push({
        claim,
        verified: result.verified,
        record: result.record || undefined,
        discrepancy: result.discrepancy || undefined,
        explanation: result.explanation,
      });
    } else {
      // No specific K-number, check if company has any clearances
      const companyResult = await fdaAdapter.verifyCompanyHas510k(companyName);
      fdaVerifications.push({
        claim,
        verified: companyResult.hasClearances,
        record: companyResult.clearances[0] || undefined,
        discrepancy: companyResult.hasClearances ? undefined : `No 510(k) clearances found for ${companyName}`,
      });
    }
  }

  // Verify patent claims
  const patentVerifications: any[] = [];
  for (const claim of patentClaims) {
    if (claim.patentNumber) {
      const result = await usptoAdapter.verifyPatentClaim(claim.patentNumber, companyName);
      patentVerifications.push({
        claim,
        verified: result.verified,
        record: result.record || undefined,
        assigneeMatches: result.assigneeMatches,
        discrepancy: result.discrepancy || undefined,
        explanation: result.explanation,
      });
    } else {
      // No specific patent number, check if company has any patents
      const companyResult = await usptoAdapter.verifyCompanyOwnPatents(companyName);
      patentVerifications.push({
        claim,
        verified: companyResult.hasPatents,
        record: companyResult.patents[0] || undefined,
        assigneeMatches: companyResult.hasPatents,
        discrepancy: companyResult.hasPatents ? undefined : `No patents found for ${companyName}`,
      });
    }
  }

  return {
    fdaVerifications: fdaVerifications as FDAVerificationItem[],
    patentVerifications: patentVerifications as PatentVerificationItem[],
    otherVerifications: [],
    allFDAClaimed: fdaClaims.length,
    allFDAVerified: fdaVerifications.filter((v) => v.verified).length,
    allPatentsClaimed: patentClaims.length,
    allPatentsVerified: patentVerifications.filter((v) => v.verified).length,
    verifiedAt: Date.now(),
  };
}

async function executeMoneyFlowVerification(
  secFilingType: string,
  portalVerified: boolean,
  pitchText?: string
): Promise<MoneyFlowVerificationResult> {
  console.log(`[InvestorProtection] Phase 4: Verifying money flow`);

  const redFlags: Array<{ flag: string; description: string; severity: "minor" | "moderate" | "severe" | "critical" }> = [];

  // Determine expected flow based on filing type
  let expectedFlow = "Unknown";
  if (secFilingType === "Reg CF") {
    expectedFlow = "Funds should flow through FINRA-registered funding portal escrow";
    if (!portalVerified) {
      redFlags.push({
        flag: "unregistered_portal",
        description: "Reg CF offering using unregistered funding portal",
        severity: "critical",
      });
    }
  } else if (secFilingType.includes("Reg D")) {
    expectedFlow = "Private placement - verify escrow arrangements with issuer";
  }

  // Scan for red flags in pitch text
  if (pitchText) {
    const text = pitchText.toLowerCase();

    if (/wire\s+(?:transfer|money|funds)/i.test(text) && /direct/i.test(text)) {
      redFlags.push({
        flag: "direct_wire_request",
        description: "Pitch materials mention direct wire transfers",
        severity: "severe",
      });
    }

    if (/crypto|bitcoin|ethereum|usdt|usdc/i.test(text)) {
      redFlags.push({
        flag: "crypto_payment_request",
        description: "Pitch materials mention cryptocurrency payments",
        severity: "severe",
      });
    }

    if (/personal\s+(?:account|venmo|zelle|paypal)/i.test(text)) {
      redFlags.push({
        flag: "personal_account",
        description: "Pitch materials mention personal payment accounts",
        severity: "critical",
      });
    }

    if (/urgent|limited\s+time|act\s+now|hurry/i.test(text)) {
      redFlags.push({
        flag: "urgency_pressure",
        description: "Pitch materials use high-pressure urgency tactics",
        severity: "moderate",
      });
    }
  }

  return {
    verified: redFlags.filter((r) => r.severity === "critical" || r.severity === "severe").length === 0,
    expectedFlow,
    escrowVerified: portalVerified,
    redFlags,
    redFlagDetails: redFlags,
    sources: [],
    verifiedAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNTHESIS FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function synthesizeResults(
  entityResult: EntityVerificationResult,
  securitiesResult: SecuritiesVerificationResult,
  claimsResult: ClaimsValidationResult,
  moneyFlowResult: MoneyFlowVerificationResult
): {
  verdict: InvestorProtectionVerdict;
  fraudRiskScore: number;
  fraudIndicators: string[];
  discrepancies: Discrepancy[];
} {
  const discrepancies: Discrepancy[] = [];
  const fraudIndicators: string[] = [];
  let fraudRiskScore = 0;

  // Collect entity discrepancies
  for (const d of entityResult.discrepancies) {
    discrepancies.push({
      id: crypto.randomUUID(),
      category: "entity",
      pitchClaim: "Company exists",
      verifiedFact: d,
      severity: entityResult.verified ? "minor" : "severe",
      explanation: d,
    });
  }

  if (!entityResult.verified) {
    fraudIndicators.push("entity_not_found");
    fraudRiskScore += 20;
  }

  // Collect securities discrepancies
  for (const d of securitiesResult.discrepancies) {
    discrepancies.push({
      id: crypto.randomUUID(),
      category: "securities",
      pitchClaim: "SEC filing exists",
      verifiedFact: d,
      severity: securitiesResult.filingFound ? "moderate" : "severe",
      explanation: d,
    });
  }

  if (!securitiesResult.filingFound) {
    fraudIndicators.push("no_sec_filing");
    fraudRiskScore += 25;
  }

  if (!securitiesResult.portalVerified && securitiesResult.fundingPortal) {
    fraudIndicators.push("unregistered_portal");
    fraudRiskScore += 20;
  }

  // Collect claims discrepancies
  for (const v of claimsResult.fdaVerifications) {
    if (!v.verified && v.discrepancy) {
      discrepancies.push({
        id: crypto.randomUUID(),
        category: "fda",
        pitchClaim: v.claim.description,
        verifiedFact: v.discrepancy,
        severity: "severe",
        explanation: v.explanation || v.discrepancy,
      });
      fraudIndicators.push("fda_claim_false");
      fraudRiskScore += 25;
    }
  }

  for (const v of claimsResult.patentVerifications) {
    if (!v.verified && v.discrepancy) {
      discrepancies.push({
        id: crypto.randomUUID(),
        category: "patent",
        pitchClaim: v.claim.description,
        verifiedFact: v.discrepancy,
        severity: "moderate",
        explanation: v.explanation || v.discrepancy,
      });
      fraudIndicators.push("patent_claim_false");
      fraudRiskScore += 20;
    }
  }

  // Collect money flow discrepancies
  for (const r of moneyFlowResult.redFlagDetails) {
    discrepancies.push({
      id: crypto.randomUUID(),
      category: "money_flow",
      pitchClaim: "Proper fund flow",
      verifiedFact: r.description,
      severity: r.severity,
      explanation: r.description,
    });

    if (r.severity === "critical") {
      fraudRiskScore += 30;
    } else if (r.severity === "severe") {
      fraudRiskScore += 20;
    } else if (r.severity === "moderate") {
      fraudRiskScore += 10;
    }
  }

  // Cap score at 100
  fraudRiskScore = Math.min(100, fraudRiskScore);

  // Determine verdict
  let verdict: InvestorProtectionVerdict;
  const criticalCount = discrepancies.filter((d) => d.severity === "critical").length;
  const severeCount = discrepancies.filter((d) => d.severity === "severe").length;

  if (fraudRiskScore >= 75 || criticalCount >= 2) {
    verdict = "FRAUD_RISK";
  } else if (fraudRiskScore >= 50 || severeCount >= 2 || criticalCount >= 1) {
    verdict = "RED_FLAGS";
  } else if (fraudRiskScore >= 25 || severeCount >= 1) {
    verdict = "SIGNIFICANT_CONCERNS";
  } else if (discrepancies.length > 0) {
    verdict = "MINOR_CONCERNS";
  } else {
    verdict = "VERIFIED";
  }

  return {
    verdict,
    fraudRiskScore,
    fraudIndicators: [...new Set(fraudIndicators)],
    discrepancies,
  };
}

function mapVerdictToRisk(verdict: InvestorProtectionVerdict): "low" | "moderate" | "elevated" | "high" | "critical" {
  switch (verdict) {
    case "VERIFIED":
      return "low";
    case "MINOR_CONCERNS":
      return "moderate";
    case "SIGNIFICANT_CONCERNS":
      return "elevated";
    case "RED_FLAGS":
      return "high";
    case "FRAUD_RISK":
      return "critical";
  }
}

function mapVerdictToRecommendation(verdict: InvestorProtectionVerdict): "proceed" | "proceed_with_conditions" | "require_resolution" | "pass" {
  switch (verdict) {
    case "VERIFIED":
      return "proceed";
    case "MINOR_CONCERNS":
      return "proceed_with_conditions";
    case "SIGNIFICANT_CONCERNS":
      return "require_resolution";
    case "RED_FLAGS":
    case "FRAUD_RISK":
      return "pass";
  }
}
