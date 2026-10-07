/**
 * Money Flow Integrity Branch
 *
 * Validates the integrity of investment fund flows:
 * - Funds destination verification (escrow vs direct)
 * - Payment method appropriateness for regime
 * - Investor verification
 * - Wire fraud indicators
 *
 * CRITICAL RULE:
 * If claiming Reg CF/portal but requesting direct wire/crypto = MAJOR RED FLAG
 */

"use node";

import { api } from "../../../../../_generated/api";
import { DDSource } from "../../types";
import {
  MoneyFlowIntegrityFindings,
  FundsDestination,
  InvestorVerification,
  FundFlowStep,
  SecuritiesRegime,
} from "../types";

interface MoneyFlowBranchResult {
  findings: MoneyFlowIntegrityFindings;
  sources: DDSource[];
  confidence: number;
}

// Wire fraud indicators to check
const WIRE_FRAUD_INDICATORS = [
  { pattern: /personal\s*account/i, indicator: "Funds requested to personal account", severity: "critical" as const },
  { pattern: /crypto|bitcoin|ethereum|usdt|usdc/i, indicator: "Cryptocurrency payment requested", severity: "high" as const },
  { pattern: /zelle|venmo|paypal|cash\s*app/i, indicator: "P2P payment method requested", severity: "high" as const },
  { pattern: /wire\s*directly/i, indicator: "Direct wire bypassing escrow", severity: "high" as const },
  { pattern: /urgent|immediately|deadline/i, indicator: "Urgency pressure tactics", severity: "medium" as const },
  { pattern: /don't\s*tell|keep\s*secret/i, indicator: "Secrecy requests", severity: "critical" as const },
  { pattern: /changed?\s*bank|new\s*account/i, indicator: "Bank account change notification", severity: "high" as const },
];

export async function executeMoneyFlowBranch(
  ctx: any,
  entityName: string,
  entityType: string,
  claimedRegime?: SecuritiesRegime,
  wireInstructions?: string,
  claimedInvestors?: string[]
): Promise<MoneyFlowBranchResult> {
  const now = Date.now();
  const sources: DDSource[] = [];
  let confidence = 0.3;

  try {
    // Step 1: Analyze wire instructions for method
    const requestedMethod = analyzePaymentMethod(wireInstructions);

    // Step 2: Check if method is appropriate for claimed regime
    const appropriateForRegime = checkMethodAppropriateness(requestedMethod, claimedRegime);

    // Step 3: Verify escrow agent if mentioned
    const escrowAgent = wireInstructions
      ? await verifyEscrowAgent(ctx, wireInstructions)
      : undefined;

    // Step 4: Analyze fund flow
    const fundFlow = buildFundFlowAnalysis(
      requestedMethod,
      claimedRegime,
      escrowAgent
    );

    // Step 5: Verify claimed investors
    const verifiedInvestors = claimedInvestors
      ? await verifyInvestors(ctx, claimedInvestors)
      : [];

    if (verifiedInvestors.length > 0) {
      sources.push({
        sourceType: "crunchbase",
        url: "https://www.crunchbase.com/",
        title: "Crunchbase Investor Verification",
        accessedAt: now,
        reliability: "reliable",
        section: "investor_verification",
      });
      confidence += 0.15;
    }

    // Step 6: Check for wire fraud indicators
    const wireFraudIndicators = checkWireFraudIndicators(wireInstructions);

    // Step 7: Build findings
    const findings: MoneyFlowIntegrityFindings = {
      requestedMethod,
      appropriateForRegime,
      escrowAgent,
      fundFlow,
      flowMatchesRegime: appropriateForRegime,
      claimedInvestors: claimedInvestors || [],
      verifiedInvestors,
      investorVerificationRate: calculateVerificationRate(claimedInvestors, verifiedInvestors),
      wireFraudIndicators,
      verification: {
        fundsMethodAppropriate: appropriateForRegime,
        escrowVerified: Boolean(escrowAgent?.verified),
        investorsVerified: verifiedInvestors.filter(v => v.verified).length > 0,
        noWireFraudIndicators: wireFraudIndicators.filter(i => i.severity === "critical" || i.severity === "high").length === 0,
        flowMatchesDocuments: appropriateForRegime,
      },
      redFlags: generateMoneyFlowRedFlags(
        requestedMethod,
        claimedRegime,
        appropriateForRegime,
        escrowAgent,
        wireFraudIndicators,
        verifiedInvestors,
        claimedInvestors
      ),
      overallConfidence: calculateMoneyFlowConfidence(
        appropriateForRegime,
        escrowAgent,
        verifiedInvestors,
        wireFraudIndicators,
        confidence
      ),
    };

    return {
      findings,
      sources,
      confidence: findings.overallConfidence,
    };

  } catch (error) {
    console.error(`[MoneyFlow] Error for ${entityName}:`, error);
    return {
      findings: createEmptyMoneyFlowFindings(claimedRegime, claimedInvestors),
      sources,
      confidence: 0.1,
    };
  }
}

// ============================================================================
// PAYMENT METHOD ANALYSIS
// ============================================================================

function analyzePaymentMethod(wireInstructions?: string): FundsDestination {
  if (!wireInstructions) return "unknown";

  const instructionsLower = wireInstructions.toLowerCase();

  // Check for crypto
  if (/crypto|bitcoin|btc|ethereum|eth|usdt|usdc|wallet/i.test(instructionsLower)) {
    return "crypto_wallet";
  }

  // Check for P2P methods (highly suspicious for investments)
  if (/zelle|venmo|paypal|cash\s*app/i.test(instructionsLower)) {
    return "personal_account";
  }

  // Check for personal account indicators
  if (/personal|individual|my\s*account/i.test(instructionsLower)) {
    return "personal_account";
  }

  // Check for escrow
  if (/escrow/i.test(instructionsLower)) {
    // Could be portal escrow or standalone escrow agent
    if (/portal|wefunder|republic|startengine/i.test(instructionsLower)) {
      return "escrow_via_portal";
    }
    return "escrow_agent";
  }

  // Check for portal investment
  if (/portal|wefunder|republic|startengine|netcapital/i.test(instructionsLower)) {
    return "escrow_via_portal";
  }

  // Check for wire transfer
  if (/wire|ach|bank\s*transfer|routing|account\s*number/i.test(instructionsLower)) {
    return "wire_transfer";
  }

  // Check for company account
  if (/company|corporate|business\s*account/i.test(instructionsLower)) {
    return "company_bank_account";
  }

  return "unknown";
}

function checkMethodAppropriateness(
  method: FundsDestination,
  claimedRegime?: SecuritiesRegime
): boolean {
  // Crypto and personal accounts are NEVER appropriate
  if (method === "crypto_wallet" || method === "personal_account") {
    return false;
  }

  // For Reg CF, funds MUST flow through portal escrow
  if (claimedRegime === "Reg CF") {
    return method === "escrow_via_portal";
  }

  // For Reg D, wire to company or escrow is acceptable
  if (claimedRegime === "Reg D 506(b)" || claimedRegime === "Reg D 506(c)") {
    return method === "escrow_agent" ||
      method === "company_bank_account" ||
      method === "wire_transfer";
  }

  // Unknown regime - escrow or company account is safest
  return method === "escrow_via_portal" ||
    method === "escrow_agent" ||
    method === "company_bank_account";
}

// ============================================================================
// ESCROW VERIFICATION
// ============================================================================

async function verifyEscrowAgent(
  ctx: any,
  wireInstructions: string
): Promise<MoneyFlowIntegrityFindings["escrowAgent"]> {
  // Extract escrow agent name if present
  const escrowMatch = wireInstructions.match(/(?:escrow|held\s*by)[:\s]+([A-Z][A-Za-z\s,\.]+?)(?:\n|$|bank|account)/i);

  if (!escrowMatch) return undefined;

  const agentName = escrowMatch[1].trim();

  try {
    // Search for escrow agent legitimacy
    const result = await ctx.runAction(
      api.domains.search.fusion.actions.fusionSearch,
      {
        query: `"${agentName}" escrow agent licensed OR registered`,
        mode: "fast",
        maxTotal: 3,
        skipRateLimit: true,
      }
    );

    const results = result?.payload?.results ?? [];
    const verified = results.length > 0 &&
      results.some((r: any) =>
        (r.snippet || "").toLowerCase().includes("licensed") ||
        (r.snippet || "").toLowerCase().includes("registered")
      );

    return {
      name: agentName,
      verified,
      regulatedEntity: verified,
    };

  } catch (error) {
    return {
      name: agentName,
      verified: false,
      regulatedEntity: false,
    };
  }
}

// ============================================================================
// FUND FLOW ANALYSIS
// ============================================================================

function buildFundFlowAnalysis(
  requestedMethod: FundsDestination,
  claimedRegime?: SecuritiesRegime,
  escrowAgent?: MoneyFlowIntegrityFindings["escrowAgent"]
): FundFlowStep[] {
  const steps: FundFlowStep[] = [];

  // Build expected fund flow based on method
  switch (requestedMethod) {
    case "escrow_via_portal":
      steps.push({
        step: 1,
        from: "Investor",
        to: "Funding Portal",
        method: "escrow_via_portal",
        verified: true,
        redFlags: [],
      });
      steps.push({
        step: 2,
        from: "Funding Portal",
        to: "Escrow Account",
        method: "escrow_agent",
        verified: true,
        redFlags: [],
      });
      steps.push({
        step: 3,
        from: "Escrow Account",
        to: "Company (upon funding goal)",
        method: "wire_transfer",
        verified: false,
        redFlags: [],
      });
      break;

    case "escrow_agent":
      steps.push({
        step: 1,
        from: "Investor",
        to: escrowAgent?.name || "Escrow Agent",
        method: "escrow_agent",
        verified: escrowAgent?.verified ?? false,
        redFlags: escrowAgent?.verified ? [] : ["Escrow agent not verified"],
      });
      steps.push({
        step: 2,
        from: escrowAgent?.name || "Escrow Agent",
        to: "Company",
        method: "wire_transfer",
        verified: false,
        redFlags: [],
      });
      break;

    case "company_bank_account":
    case "wire_transfer":
      steps.push({
        step: 1,
        from: "Investor",
        to: "Company Bank Account",
        method: "wire_transfer",
        verified: false,
        redFlags: claimedRegime === "Reg CF" ?
          ["Direct wire bypasses portal escrow (Reg CF violation)"] : [],
      });
      break;

    case "personal_account":
      steps.push({
        step: 1,
        from: "Investor",
        to: "Personal Account",
        method: "personal_account",
        verified: false,
        redFlags: ["CRITICAL: Funds to personal account is a major red flag"],
      });
      break;

    case "crypto_wallet":
      steps.push({
        step: 1,
        from: "Investor",
        to: "Crypto Wallet",
        method: "crypto_wallet",
        verified: false,
        redFlags: ["CRITICAL: Crypto for equity investment is highly unusual and risky"],
      });
      break;

    default:
      steps.push({
        step: 1,
        from: "Investor",
        to: "Unknown Destination",
        method: "unknown",
        verified: false,
        redFlags: ["Funds destination unclear"],
      });
  }

  return steps;
}

// ============================================================================
// INVESTOR VERIFICATION
// ============================================================================

async function verifyInvestors(
  ctx: any,
  claimedInvestors: string[]
): Promise<InvestorVerification[]> {
  const verifications: InvestorVerification[] = [];

  // Known VC/PE firms for quick verification
  const knownInvestors: Record<string, InvestorVerification> = {
    "sequoia": { investorName: "Sequoia Capital", investorType: "VC Fund", verified: true },
    "a16z": { investorName: "Andreessen Horowitz", investorType: "VC Fund", verified: true },
    "andreessen": { investorName: "Andreessen Horowitz", investorType: "VC Fund", verified: true },
    "kleiner": { investorName: "Kleiner Perkins", investorType: "VC Fund", verified: true },
    "accel": { investorName: "Accel", investorType: "VC Fund", verified: true },
    "benchmark": { investorName: "Benchmark", investorType: "VC Fund", verified: true },
    "greylock": { investorName: "Greylock Partners", investorType: "VC Fund", verified: true },
    "lightspeed": { investorName: "Lightspeed Venture Partners", investorType: "VC Fund", verified: true },
    "tiger global": { investorName: "Tiger Global", investorType: "VC Fund", verified: true },
    "softbank": { investorName: "SoftBank Vision Fund", investorType: "VC Fund", verified: true },
    "y combinator": { investorName: "Y Combinator", investorType: "VC Fund", verified: true },
  };

  for (const investor of claimedInvestors) {
    const investorLower = investor.toLowerCase();

    // Check against known investors
    for (const [key, verified] of Object.entries(knownInvestors)) {
      if (investorLower.includes(key)) {
        verifications.push({
          ...verified,
          verificationSource: "Known VC Directory",
        });
        break;
      }
    }

    // If not in known list, search
    if (!verifications.some(v => v.investorName.toLowerCase().includes(investorLower.split(" ")[0]))) {
      try {
        const result = await ctx.runAction(
          api.domains.search.fusion.actions.fusionSearch,
          {
            query: `"${investor}" venture capital OR investor OR fund portfolio`,
            mode: "fast",
            maxTotal: 3,
            skipRateLimit: true,
          }
        );

        const results = result?.payload?.results ?? [];
        const found = results.length > 0;

        verifications.push({
          investorName: investor,
          investorType: found ? determineInvestorType(results) : "Unknown",
          verified: found,
          verificationSource: found ? "Web Search" : undefined,
          knownInvestments: found ? extractKnownInvestments(results) : undefined,
        });

      } catch (error) {
        verifications.push({
          investorName: investor,
          investorType: "Unknown",
          verified: false,
        });
      }
    }
  }

  return verifications;
}

function determineInvestorType(results: any[]): InvestorVerification["investorType"] {
  const content = results.map(r => r.snippet || "").join(" ").toLowerCase();

  if (content.includes("venture capital") || content.includes("vc fund")) return "VC Fund";
  if (content.includes("angel")) return "Angel";
  if (content.includes("family office")) return "Family Office";
  if (content.includes("corporate venture") || content.includes("strategic")) return "Corporate";

  return "Unknown";
}

function extractKnownInvestments(results: any[]): string[] {
  const investments: string[] = [];
  const content = results.map(r => r.snippet || "").join(" ");

  // Look for company names in investment context
  const matches = content.match(/invested\s+in\s+([A-Z][A-Za-z]+)/gi);
  if (matches) {
    for (const match of matches.slice(0, 3)) {
      const company = match.replace(/invested\s+in\s+/i, "").trim();
      if (company && !investments.includes(company)) {
        investments.push(company);
      }
    }
  }

  return investments;
}

// ============================================================================
// WIRE FRAUD CHECK
// ============================================================================

function checkWireFraudIndicators(
  wireInstructions?: string
): MoneyFlowIntegrityFindings["wireFraudIndicators"] {
  if (!wireInstructions) return [];

  const indicators: MoneyFlowIntegrityFindings["wireFraudIndicators"] = [];

  for (const { pattern, indicator, severity } of WIRE_FRAUD_INDICATORS) {
    if (pattern.test(wireInstructions)) {
      indicators.push({
        indicator,
        severity,
        description: `Detected: ${indicator}`,
      });
    }
  }

  return indicators;
}

// ============================================================================
// RED FLAG GENERATION
// ============================================================================

function generateMoneyFlowRedFlags(
  requestedMethod: FundsDestination,
  claimedRegime: SecuritiesRegime | undefined,
  appropriateForRegime: boolean,
  escrowAgent: MoneyFlowIntegrityFindings["escrowAgent"] | undefined,
  wireFraudIndicators: MoneyFlowIntegrityFindings["wireFraudIndicators"],
  verifiedInvestors: InvestorVerification[],
  claimedInvestors?: string[]
): MoneyFlowIntegrityFindings["redFlags"] {
  const redFlags: MoneyFlowIntegrityFindings["redFlags"] = [];

  // Personal account - CRITICAL
  if (requestedMethod === "personal_account") {
    redFlags.push({
      type: "personal_account",
      severity: "critical",
      description: "Funds requested to personal account. Legitimate investments should go to corporate accounts or escrow.",
    });
  }

  // Crypto payment - CRITICAL for equity
  if (requestedMethod === "crypto_wallet") {
    redFlags.push({
      type: "crypto_request",
      severity: "critical",
      description: "Cryptocurrency requested for equity investment. This is highly unusual and risky. No investor protections exist.",
    });
  }

  // Method inappropriate for regime
  if (!appropriateForRegime && claimedRegime) {
    redFlags.push({
      type: "flow_mismatch",
      severity: "high",
      description: `Payment method "${requestedMethod}" is inappropriate for ${claimedRegime}. ${claimedRegime === "Reg CF" ? "Reg CF requires funds to flow through the registered funding portal." : ""}`,
    });
  }

  // No escrow when expected
  if (claimedRegime === "Reg CF" && !escrowAgent && requestedMethod !== "escrow_via_portal") {
    redFlags.push({
      type: "no_escrow",
      severity: "high",
      description: "Reg CF offerings must use escrow through the funding portal. Direct payment bypasses investor protections.",
    });
  }

  // Unverified escrow agent
  if (escrowAgent && !escrowAgent.verified) {
    redFlags.push({
      type: "no_escrow",
      severity: "medium",
      description: `Escrow agent "${escrowAgent.name}" could not be verified as a licensed escrow company.`,
    });
  }

  // Wire fraud indicators
  const criticalIndicators = wireFraudIndicators.filter(i => i.severity === "critical");
  const highIndicators = wireFraudIndicators.filter(i => i.severity === "high");

  if (criticalIndicators.length > 0) {
    redFlags.push({
      type: "wire_fraud_risk",
      severity: "critical",
      description: `${criticalIndicators.length} critical wire fraud indicator(s) detected: ${criticalIndicators.map(i => i.indicator).join(", ")}`,
    });
  }

  if (highIndicators.length > 0) {
    redFlags.push({
      type: "wire_fraud_risk",
      severity: "high",
      description: `${highIndicators.length} high-risk indicator(s) detected: ${highIndicators.map(i => i.indicator).join(", ")}`,
    });
  }

  // Unverified investors
  if (claimedInvestors && claimedInvestors.length > 0) {
    const unverifiedCount = verifiedInvestors.filter(v => !v.verified).length;
    if (unverifiedCount > claimedInvestors.length * 0.5) {
      redFlags.push({
        type: "unverified_investors",
        severity: "medium",
        description: `${unverifiedCount} of ${claimedInvestors.length} claimed investors could not be verified.`,
      });
    }
  }

  return redFlags;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function calculateVerificationRate(
  claimed: string[] | undefined,
  verified: InvestorVerification[]
): number {
  if (!claimed || claimed.length === 0) return 0;
  const verifiedCount = verified.filter(v => v.verified).length;
  return verifiedCount / claimed.length;
}

function calculateMoneyFlowConfidence(
  appropriateForRegime: boolean,
  escrowAgent: MoneyFlowIntegrityFindings["escrowAgent"] | undefined,
  verifiedInvestors: InvestorVerification[],
  wireFraudIndicators: MoneyFlowIntegrityFindings["wireFraudIndicators"],
  baseConfidence: number
): number {
  let confidence = baseConfidence;

  if (appropriateForRegime) confidence += 0.2;
  if (escrowAgent?.verified) confidence += 0.2;
  if (verifiedInvestors.filter(v => v.verified).length > 0) confidence += 0.15;

  // Reduce confidence for fraud indicators
  const criticalCount = wireFraudIndicators.filter(i => i.severity === "critical").length;
  const highCount = wireFraudIndicators.filter(i => i.severity === "high").length;

  confidence -= criticalCount * 0.3;
  confidence -= highCount * 0.15;

  return Math.max(0.1, Math.min(0.95, confidence));
}

function createEmptyMoneyFlowFindings(
  claimedRegime?: SecuritiesRegime,
  claimedInvestors?: string[]
): MoneyFlowIntegrityFindings {
  return {
    requestedMethod: "unknown",
    appropriateForRegime: false,
    escrowAgent: undefined,
    fundFlow: [],
    flowMatchesRegime: false,
    claimedInvestors: claimedInvestors || [],
    verifiedInvestors: [],
    investorVerificationRate: 0,
    wireFraudIndicators: [],
    verification: {
      fundsMethodAppropriate: false,
      escrowVerified: false,
      investorsVerified: false,
      noWireFraudIndicators: true,
      flowMatchesDocuments: false,
    },
    redFlags: [],
    overallConfidence: 0.1,
  };
}
