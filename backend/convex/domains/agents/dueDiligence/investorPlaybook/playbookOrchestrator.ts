/**
 * Investor Playbook Orchestrator
 *
 * Main orchestration layer for running the investor due diligence playbook.
 * Executes verification branches in parallel and synthesizes findings.
 *
 * Stop Rules:
 * - Direct wire/crypto + missing filings = STOP
 * - FDA status misrepresentation = STOP
 * - Unregistered funding portal = STOP
 * - Entity not found + large funding request = STOP
 */

"use node";

import { api } from "../../../../_generated/api";
import { DDSource } from "../types";
import {
  InvestorPlaybookBranchType,
  InvestorPlaybookSynthesis,
  PlaybookDiscrepancy,
  PlaybookVerificationScore,
  PlaybookStopRule,
  PlaybookComplexitySignals,
  PLAYBOOK_BRANCH_TRIGGERS,
  EntityVerificationFindings,
  SecEdgarFindings,
  FinraValidationFindings,
  FdaVerificationFindings,
  UsptoDeepdiveFindings,
  MoneyFlowIntegrityFindings,
  SecuritiesRegime,
  ClaimVerificationFindings,
  PersonVerificationFindings,
  NewsVerificationFindings,
  ScientificClaimVerificationFindings,
} from "./types";

import {
  executeEntityVerificationBranch,
  executeSecEdgarBranch,
  executeFinraValidationBranch,
  executeFdaVerificationBranch,
  executeUsptoDeepdiveBranch,
  executeMoneyFlowBranch,
  executeClaimVerificationBranch,
  executePersonVerificationBranch,
  executeNewsVerificationBranch,
  extractClaimsFromQuery,
  executeScientificClaimVerificationBranch,
  detectScientificClaims,
  // Persona-specific branches
  executeDealMemoSynthesisBranch,
  executeFundPerformanceVerificationBranch,
  executeClinicalTrialVerificationBranch,
  executeLiteratureTriangulationBranch,
  executeMAActivityVerificationBranch,
  executeEconomicIndicatorVerificationBranch,
} from "./branches";
import { executeEnhancedClaimVerification } from "./branches/enhancedClaimVerification";
import { executeEnhancedNewsVerification } from "./branches/enhancedNewsVerification";

// ============================================================================
// TIMEOUT AND ERROR HANDLING UTILITIES
// ============================================================================

/**
 * Wrap a promise with a timeout to prevent indefinite hangs.
 * Critical for Promise.all() orchestration.
 */
function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout (${timeoutMs}ms): ${timeoutMessage}`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
 * Maximum execution time for all branches combined.
 * Individual branches have their own timeouts (5-10s), but we need
 * a global guard to prevent indefinite hangs.
 * Convex action timeout is 10 minutes, so we use 8 minutes to leave
 * buffer for synthesis and return.
 */
const MAX_ORCHESTRATION_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes

/**
 * Track branch execution results for validation.
 */
interface BranchExecutionTracker {
  succeeded: string[];
  failed: Array<{ branch: string; error: string }>;
  totalBranches: number;
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

export interface PlaybookConfig {
  entityName: string;
  entityType: "company" | "fund" | "person";

  // Claims to verify
  claimedState?: string;
  claimedFormationYear?: number;
  claimedSecuritiesRegime?: SecuritiesRegime;
  claimedFundingPortal?: string;
  claimedFDAStatus?: string;
  claimedPatents?: string[];
  claimedInvestors?: string[];

  // Wire/payment context
  wireInstructions?: string;

  // Signals
  signals?: PlaybookComplexitySignals;

  // Web enrichment data (from agentic context gathering)
  webEnrichment?: {
    redFlagsFromWeb?: string[];
    fundingPortal?: string;
    fdaClaim?: string;
  };

  // Claim verification mode
  claimVerificationMode?: {
    enabled: boolean;
    rawQuery?: string;                    // Original complex query
    personToVerify?: string;              // Person name to verify
    personLinkedIn?: string;              // LinkedIn URL
    personClaimedRole?: string;           // Claimed role
    personClaimedCompany?: string;        // Claimed company
    acquisitionAcquirer?: string;         // Acquirer in acquisition
    acquisitionTarget?: string;           // Target in acquisition
    newsEvent?: string;                   // News event to verify
  };

  // Persona-specific evaluation context
  personaContext?: {
    persona?: string;                       // Current persona for branch routing
    // Financial persona context (Banker, VC, LP)
    dealMemoRequested?: boolean;            // Generate deal memo
    fundPerformanceRequested?: boolean;     // Verify fund performance
    claimedFundMetrics?: {
      tvpi?: number;
      dpi?: number;
      irr?: number;
      fundName?: string;
    };
    // Industry persona context (Pharma BD, Academic R&D)
    clinicalTrialContext?: {
      drugName?: string;
      companyName?: string;
      claimedPhase?: string;
      nctId?: string;
    };
    literatureContext?: {
      topic?: string;
      additionalContext?: string;
      authors?: string[];
      methodology?: string;
      claimedFindings?: string;
      targetJournals?: string[];
    };
    // Strategic persona context (Corp Dev, Macro Strategist)
    maContext?: {
      acquirer?: string;
      target?: string;
      claimedDealValue?: string;
    };
    macroContext?: {
      thesisName?: string;
      region?: string;
      claimedIndicators?: Array<{ name: string; value: number; unit?: string }>;
      claimedPolicy?: {
        expectedChange?: string;
        confidence?: number;
      };
    };
  };
}

export interface PlaybookResult {
  synthesis: InvestorPlaybookSynthesis;
  branchResults: {
    entityVerification?: EntityVerificationFindings;
    secEdgar?: SecEdgarFindings;
    finraValidation?: FinraValidationFindings;
    fdaVerification?: FdaVerificationFindings;
    usptoDeepdive?: UsptoDeepdiveFindings;
    moneyFlowIntegrity?: MoneyFlowIntegrityFindings;
    // New verification branches
    claimVerification?: ClaimVerificationFindings;
    personVerification?: PersonVerificationFindings;
    newsVerification?: NewsVerificationFindings;
    scientificClaimVerification?: ScientificClaimVerificationFindings;
  };
  sources: DDSource[];
  executionTimeMs: number;
}

export async function runInvestorPlaybook(
  ctx: any,
  config: PlaybookConfig
): Promise<PlaybookResult> {
  const startTime = Date.now();
  const allSources: DDSource[] = [];
  const branchResults: PlaybookResult["branchResults"] = {};
  const executedBranches: InvestorPlaybookBranchType[] = [];

  // Track branch execution for validation
  const branchTracker: BranchExecutionTracker = {
    succeeded: [],
    failed: [],
    totalBranches: 0,
  };

  // Determine which branches to run based on signals
  const signals: PlaybookComplexitySignals = {
    isRequestingFunding: true,
    ...config.signals,
    claimedFDAStatus: config.claimedFDAStatus,
    claimedPatents: config.claimedPatents,
    claimedSecuritiesRegime: config.claimedSecuritiesRegime,
    fundingPortalMentioned: config.claimedFundingPortal,
    wireInstructionsProvided: Boolean(config.wireInstructions),
    cryptoPaymentRequested: config.wireInstructions?.toLowerCase().includes("crypto") ||
      config.wireInstructions?.toLowerCase().includes("bitcoin"),
    // Claim verification signals
    isClaimVerification: config.claimVerificationMode?.enabled,
    hasSpecificClaims: Boolean(config.claimVerificationMode?.rawQuery),
    personMentioned: config.claimVerificationMode?.personToVerify,
    linkedInUrl: config.claimVerificationMode?.personLinkedIn,
    acquisitionMentioned: Boolean(config.claimVerificationMode?.acquisitionAcquirer),
    newsEventMentioned: Boolean(config.claimVerificationMode?.newsEvent),
    companiesInvolved: [
      config.claimVerificationMode?.acquisitionAcquirer,
      config.claimVerificationMode?.acquisitionTarget,
    ].filter(Boolean) as string[],
    // Persona-specific signals
    persona: config.personaContext?.persona,
    entityType: config.entityType,
    dealMemoRequested: config.personaContext?.dealMemoRequested,
    fundPerformanceRequested: config.personaContext?.fundPerformanceRequested,
    claimedTVPI: config.personaContext?.claimedFundMetrics?.tvpi,
    claimedDPI: config.personaContext?.claimedFundMetrics?.dpi,
    claimedIRR: config.personaContext?.claimedFundMetrics?.irr,
    clinicalTrialMentioned: Boolean(config.personaContext?.clinicalTrialContext),
    nctIdMentioned: config.personaContext?.clinicalTrialContext?.nctId,
    academicResearchMentioned: Boolean(config.personaContext?.literatureContext),
    literatureReviewRequested: Boolean(config.personaContext?.literatureContext?.topic),
    maActivityRequested: Boolean(config.personaContext?.maContext),
    economicThesisRequested: Boolean(config.personaContext?.macroContext),
    macroIndicatorsMentioned: Boolean(config.personaContext?.macroContext?.claimedIndicators),
  };

  // Build branch execution promises
  const branchPromises: Promise<void>[] = [];

  // Entity Verification (always run)
  if (PLAYBOOK_BRANCH_TRIGGERS.entity_verification(signals)) {
    executedBranches.push("entity_verification");
    branchTracker.totalBranches++;
    branchPromises.push(
      executeEntityVerificationBranch(
        ctx,
        config.entityName,
        config.entityType,
        config.claimedState,
        config.claimedFormationYear
      ).then(result => {
        branchResults.entityVerification = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("entity_verification");
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] Entity verification failed:", errorMsg);
        branchTracker.failed.push({ branch: "entity_verification", error: errorMsg });
      })
    );
  }

  // SEC EDGAR
  if (PLAYBOOK_BRANCH_TRIGGERS.sec_edgar(signals)) {
    executedBranches.push("sec_edgar");
    branchTracker.totalBranches++;
    branchPromises.push(
      executeSecEdgarBranch(
        ctx,
        config.entityName,
        config.entityType,
        config.claimedSecuritiesRegime
      ).then(result => {
        branchResults.secEdgar = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("sec_edgar");
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] SEC EDGAR failed:", errorMsg);
        branchTracker.failed.push({ branch: "sec_edgar", error: errorMsg });
      })
    );
  }

  // FINRA Validation
  if (PLAYBOOK_BRANCH_TRIGGERS.finra_validation(signals)) {
    executedBranches.push("finra_validation");
    branchTracker.totalBranches++;
    branchPromises.push(
      executeFinraValidationBranch(
        ctx,
        config.entityName,
        config.entityType,
        config.claimedFundingPortal
      ).then(result => {
        branchResults.finraValidation = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("finra_validation");
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] FINRA validation failed:", errorMsg);
        branchTracker.failed.push({ branch: "finra_validation", error: errorMsg });
      })
    );
  }

  // FDA Verification
  if (PLAYBOOK_BRANCH_TRIGGERS.fda_verification(signals)) {
    executedBranches.push("fda_verification");
    branchTracker.totalBranches++;
    branchPromises.push(
      executeFdaVerificationBranch(
        ctx,
        config.entityName,
        config.entityType,
        config.claimedFDAStatus
      ).then(result => {
        branchResults.fdaVerification = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("fda_verification");
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] FDA verification failed:", errorMsg);
        branchTracker.failed.push({ branch: "fda_verification", error: errorMsg });
      })
    );
  }

  // USPTO Deep Dive
  if (PLAYBOOK_BRANCH_TRIGGERS.uspto_deepdive(signals)) {
    executedBranches.push("uspto_deepdive");
    branchTracker.totalBranches++;
    branchPromises.push(
      executeUsptoDeepdiveBranch(
        ctx,
        config.entityName,
        config.entityType,
        config.claimedPatents
      ).then(result => {
        branchResults.usptoDeepdive = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("uspto_deepdive");
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] USPTO failed:", errorMsg);
        branchTracker.failed.push({ branch: "uspto_deepdive", error: errorMsg });
      })
    );
  }

  // Money Flow Integrity (always run for funding)
  if (PLAYBOOK_BRANCH_TRIGGERS.money_flow_integrity(signals)) {
    executedBranches.push("money_flow_integrity");
    branchTracker.totalBranches++;
    branchPromises.push(
      executeMoneyFlowBranch(
        ctx,
        config.entityName,
        config.entityType,
        config.claimedSecuritiesRegime,
        config.wireInstructions,
        config.claimedInvestors
      ).then(result => {
        branchResults.moneyFlowIntegrity = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("money_flow_integrity");
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] Money flow failed:", errorMsg);
        branchTracker.failed.push({ branch: "money_flow_integrity", error: errorMsg });
      })
    );
  }

  // ============================================================================
  // SCIENTIFIC CLAIM VERIFICATION (Critical for detecting debunked science)
  // ============================================================================

  // Scientific Claim Verification - detect debunked claims like LK-99, cold fusion, etc.
  // Searches arXiv, PubMed, Retraction Watch for peer review status, replication failures, debunkings
  const rawQueryForScientific = config.claimVerificationMode?.rawQuery || config.entityName;
  console.log(`[Playbook] Scientific claim detection input: "${rawQueryForScientific}"`);

  const scientificDetection = detectScientificClaims(rawQueryForScientific);
  console.log(`[Playbook] Scientific claim detection result:`, JSON.stringify(scientificDetection));

  // Check if we should run scientific claim verification
  const shouldRunScientificVerification =
    scientificDetection.hasScientificClaims ||
    config.personaContext?.literatureContext ||
    PLAYBOOK_BRANCH_TRIGGERS.scientific_claim_verification({
      ...signals,
      hasScientificClaims: scientificDetection.hasScientificClaims,
      claimedScientificDiscovery: scientificDetection.claimedDiscovery,
      researchArea: scientificDetection.researchArea,
    });

  if (shouldRunScientificVerification) {
    executedBranches.push("scientific_claim_verification");
    branchTracker.totalBranches++;
    branchPromises.push(
      executeScientificClaimVerificationBranch(
        ctx,
        config.entityName,
        scientificDetection.claimedDiscovery,
        scientificDetection.researchArea
      ).then(result => {
        branchResults.scientificClaimVerification = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("scientific_claim_verification");
        console.log(`[Playbook] Scientific claim verification: Status=${result.findings.overallStatus}, RedFlags=${result.findings.redFlags.length}`);
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] Scientific claim verification failed:", errorMsg);
        branchTracker.failed.push({ branch: "scientific_claim_verification", error: errorMsg });
      })
    );
  }

  // ============================================================================
  // NEW VERIFICATION BRANCHES (Claim, Person, News)
  // ============================================================================

  // Claim Verification - extract and verify claims from complex queries
  // Uses enhanced verification with OODA loop, triangulation, and reflection (Anthropic/OpenAI/Manus patterns)
  if (config.claimVerificationMode?.enabled && config.claimVerificationMode.rawQuery) {
    if (PLAYBOOK_BRANCH_TRIGGERS.claim_verification(signals)) {
      executedBranches.push("claim_verification");
      branchTracker.totalBranches++;
      const claims = extractClaimsFromQuery(config.claimVerificationMode.rawQuery);
      if (claims.length > 0) {
        branchPromises.push(
          executeEnhancedClaimVerification(ctx, claims, {
            enableReflection: true,
            enableTriangulation: true,
            maxIterations: 2,
            requireMultipleSources: true,
          }).then(result => {
            branchResults.claimVerification = result.findings;
            allSources.push(...result.sources);
            branchTracker.succeeded.push("claim_verification");
            console.log(`[Playbook] Enhanced claim verification: ${result.methodology.join(" -> ")}`);
          }).catch(err => {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error("[Playbook] Enhanced claim verification failed, falling back:", errorMsg);
            // Fallback to basic claim verification - chain the error handler
            return executeClaimVerificationBranch(ctx, claims).then(fallbackResult => {
              branchResults.claimVerification = fallbackResult.findings;
              allSources.push(...fallbackResult.sources);
              branchTracker.succeeded.push("claim_verification"); // Fallback succeeded
              console.log("[Playbook] Claim verification fallback succeeded");
            }).catch(fallbackErr => {
              const fallbackErrorMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
              console.error("[Playbook] Claim verification fallback also failed:", fallbackErrorMsg);
              branchTracker.failed.push({ branch: "claim_verification", error: `Primary: ${errorMsg}; Fallback: ${fallbackErrorMsg}` });
            });
          })
        );
      }
    }
  }

  // Person Verification - verify professional identity
  if (config.claimVerificationMode?.personToVerify) {
    if (PLAYBOOK_BRANCH_TRIGGERS.person_verification(signals)) {
      executedBranches.push("person_verification");
      branchTracker.totalBranches++;
      branchPromises.push(
        executePersonVerificationBranch(
          ctx,
          config.claimVerificationMode.personToVerify,
          config.claimVerificationMode.personLinkedIn,
          config.claimVerificationMode.personClaimedRole,
          config.claimVerificationMode.personClaimedCompany
        ).then(result => {
          branchResults.personVerification = result.findings;
          allSources.push(...result.sources);
          branchTracker.succeeded.push("person_verification");
        }).catch(err => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error("[Playbook] Person verification failed:", errorMsg);
          branchTracker.failed.push({ branch: "person_verification", error: errorMsg });
        })
      );
    }
  }

  // News/Acquisition Verification
  // Uses enhanced verification with multi-source triangulation and contradiction detection
  if (config.claimVerificationMode?.acquisitionAcquirer || config.claimVerificationMode?.newsEvent) {
    if (PLAYBOOK_BRANCH_TRIGGERS.news_verification(signals)) {
      executedBranches.push("news_verification");
      branchTracker.totalBranches++;
      branchPromises.push(
        executeEnhancedNewsVerification(
          ctx,
          config.claimVerificationMode.acquisitionAcquirer,
          config.claimVerificationMode.acquisitionTarget,
          config.claimVerificationMode.newsEvent,
          {
            requireMultipleSources: true,
            requireTier1Source: false, // Don't require Tier 1, but prefer it
            checkContradictions: true,
          }
        ).then(result => {
          branchResults.newsVerification = result.findings;
          allSources.push(...result.sources);
          branchTracker.succeeded.push("news_verification");
          console.log(`[Playbook] Enhanced news verification: ${result.methodology.join(" -> ")}`);
          console.log(`[Playbook] News triangulation: ${result.triangulation.tier1SourceCount} T1, ${result.triangulation.tier2SourceCount} T2 sources`);
        }).catch(err => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error("[Playbook] Enhanced news verification failed, falling back:", errorMsg);
          // Fallback to basic news verification - chain the error handler
          return executeNewsVerificationBranch(
            ctx,
            config.claimVerificationMode?.acquisitionAcquirer,
            config.claimVerificationMode?.acquisitionTarget,
            config.claimVerificationMode?.newsEvent
          ).then(fallbackResult => {
            branchResults.newsVerification = fallbackResult.findings;
            allSources.push(...fallbackResult.sources);
            branchTracker.succeeded.push("news_verification"); // Fallback succeeded
            console.log("[Playbook] News verification fallback succeeded");
          }).catch(fallbackErr => {
            const fallbackErrorMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            console.error("[Playbook] News verification fallback also failed:", fallbackErrorMsg);
            branchTracker.failed.push({ branch: "news_verification", error: `Primary: ${errorMsg}; Fallback: ${fallbackErrorMsg}` });
          });
        })
      );
    }
  }

  // ============================================================================
  // PERSONA-SPECIFIC BRANCHES
  // ============================================================================

  // Deal Memo Synthesis (Financial personas: Banker, VC)
  if (PLAYBOOK_BRANCH_TRIGGERS.deal_memo_synthesis(signals)) {
    executedBranches.push("deal_memo_synthesis");
    branchTracker.totalBranches++;
    branchPromises.push(
      executeDealMemoSynthesisBranch(
        ctx,
        config.entityName,
        config.entityType === "person" ? "company" : config.entityType // Map "person" to "company" for deal memo
      ).then(result => {
        // Store in branchResults - synthesis will be extracted during report generation
        (branchResults as any).dealMemoSynthesis = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("deal_memo_synthesis");
        console.log(`[Playbook] Deal memo synthesis completed for ${config.entityName}`);
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] Deal memo synthesis failed:", errorMsg);
        branchTracker.failed.push({ branch: "deal_memo_synthesis", error: errorMsg });
      })
    );
  }

  // Fund Performance Verification (LP Allocator persona)
  if (PLAYBOOK_BRANCH_TRIGGERS.fund_performance_verification(signals)) {
    executedBranches.push("fund_performance_verification");
    branchTracker.totalBranches++;
    const fundMetrics = config.personaContext?.claimedFundMetrics;
    branchPromises.push(
      executeFundPerformanceVerificationBranch(
        ctx,
        config.entityName,
        undefined, // gpName is optional
        fundMetrics ? {
          tvpi: fundMetrics.tvpi,
          dpi: fundMetrics.dpi,
          irr: fundMetrics.irr,
        } : undefined
      ).then(result => {
        (branchResults as any).fundPerformanceVerification = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("fund_performance_verification");
        console.log(`[Playbook] Fund performance verification completed`);
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] Fund performance verification failed:", errorMsg);
        branchTracker.failed.push({ branch: "fund_performance_verification", error: errorMsg });
      })
    );
  }

  // Clinical Trial Verification (Pharma BD persona)
  if (PLAYBOOK_BRANCH_TRIGGERS.clinical_trial_verification(signals)) {
    executedBranches.push("clinical_trial_verification");
    branchTracker.totalBranches++;
    const clinicalContext = config.personaContext?.clinicalTrialContext;
    branchPromises.push(
      executeClinicalTrialVerificationBranch(
        ctx,
        clinicalContext?.drugName || config.entityName,
        clinicalContext?.companyName || config.entityName, // Default to entity name if no company specified
        clinicalContext?.claimedPhase ? {
          phase: clinicalContext.claimedPhase,
          nctId: clinicalContext.nctId,
        } : undefined
      ).then(result => {
        (branchResults as any).clinicalTrialVerification = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("clinical_trial_verification");
        console.log(`[Playbook] Clinical trial verification completed`);
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] Clinical trial verification failed:", errorMsg);
        branchTracker.failed.push({ branch: "clinical_trial_verification", error: errorMsg });
      })
    );
  }

  // Literature Triangulation (Academic R&D persona)
  if (PLAYBOOK_BRANCH_TRIGGERS.literature_triangulation(signals)) {
    executedBranches.push("literature_triangulation");
    branchTracker.totalBranches++;
    const litContext = config.personaContext?.literatureContext;
    branchPromises.push(
      executeLiteratureTriangulationBranch(
        ctx,
        litContext?.topic || config.entityName,
        litContext ? {
          authors: litContext.authors,
          methodology: litContext.methodology,
          claimedFindings: litContext.claimedFindings,
          targetJournals: litContext.targetJournals,
        } : undefined
      ).then(result => {
        (branchResults as any).literatureTriangulation = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("literature_triangulation");
        console.log(`[Playbook] Literature triangulation completed`);
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] Literature triangulation failed:", errorMsg);
        branchTracker.failed.push({ branch: "literature_triangulation", error: errorMsg });
      })
    );
  }

  // M&A Activity Verification (Corp Dev persona)
  if (PLAYBOOK_BRANCH_TRIGGERS.ma_activity_verification(signals)) {
    executedBranches.push("ma_activity_verification");
    branchTracker.totalBranches++;
    const maContext = config.personaContext?.maContext;
    branchPromises.push(
      executeMAActivityVerificationBranch(
        ctx,
        maContext?.acquirer || config.claimVerificationMode?.acquisitionAcquirer || "",
        maContext?.target || config.claimVerificationMode?.acquisitionTarget || "",
        maContext?.claimedDealValue ? {
          dealValue: maContext.claimedDealValue,
        } : undefined
      ).then(result => {
        (branchResults as any).maActivityVerification = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("ma_activity_verification");
        console.log(`[Playbook] M&A activity verification completed`);
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] M&A activity verification failed:", errorMsg);
        branchTracker.failed.push({ branch: "ma_activity_verification", error: errorMsg });
      })
    );
  }

  // Economic Indicator Verification (Macro Strategist persona)
  if (PLAYBOOK_BRANCH_TRIGGERS.economic_indicator_verification(signals)) {
    executedBranches.push("economic_indicator_verification");
    branchTracker.totalBranches++;
    const macroContext = config.personaContext?.macroContext;
    branchPromises.push(
      executeEconomicIndicatorVerificationBranch(
        ctx,
        macroContext?.thesisName || config.entityName,
        macroContext?.region || "US",
        macroContext?.claimedIndicators?.map(ind => ({
          name: ind.name,
          value: ind.value,
          unit: ind.unit || "%", // Default to percentage if no unit specified
        })),
        macroContext?.claimedPolicy
      ).then(result => {
        (branchResults as any).economicIndicatorVerification = result.findings;
        allSources.push(...result.sources);
        branchTracker.succeeded.push("economic_indicator_verification");
        console.log(`[Playbook] Economic indicator verification completed`);
      }).catch(err => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[Playbook] Economic indicator verification failed:", errorMsg);
        branchTracker.failed.push({ branch: "economic_indicator_verification", error: errorMsg });
      })
    );
  }

  // ============================================================================
  // EXECUTE ALL BRANCHES WITH TIMEOUT
  // ============================================================================

  // Execute all branches in parallel with global timeout guard
  // This prevents indefinite hangs even if individual branches timeout
  try {
    await promiseWithTimeout(
      Promise.all(branchPromises),
      MAX_ORCHESTRATION_TIMEOUT_MS,
      `Orchestration timeout after ${MAX_ORCHESTRATION_TIMEOUT_MS / 1000}s`
    );
  } catch (timeoutError) {
    const errorMsg = timeoutError instanceof Error ? timeoutError.message : String(timeoutError);
    console.error(`[Playbook] CRITICAL: Branch execution timed out: ${errorMsg}`);
    // Record the timeout but continue with whatever results we have
    branchTracker.failed.push({ branch: "_orchestration", error: errorMsg });
  }

  // ============================================================================
  // RESULT VALIDATION
  // ============================================================================

  // Log branch execution summary
  console.log(`[Playbook] Branch execution summary: ${branchTracker.succeeded.length}/${branchTracker.totalBranches} succeeded`);
  if (branchTracker.failed.length > 0) {
    console.warn(`[Playbook] Failed branches: ${branchTracker.failed.map(f => `${f.branch}(${f.error})`).join(", ")}`);
  }

  // Validate we have minimum required sources for reliable DD
  const MIN_SOURCES_FOR_RELIABLE_DD = 2;
  const authoritativeSources = allSources.filter(s => s.reliability === "authoritative");
  if (allSources.length === 0) {
    console.error("[Playbook] CRITICAL: No sources collected - DD results may be unreliable");
  } else if (authoritativeSources.length < MIN_SOURCES_FOR_RELIABLE_DD) {
    console.warn(`[Playbook] Warning: Only ${authoritativeSources.length} authoritative sources (min: ${MIN_SOURCES_FOR_RELIABLE_DD})`);
  }

  // Validate branch results are not all empty (sanity check)
  const hasAnyResults = Object.keys(branchResults).length > 0;
  if (!hasAnyResults && branchTracker.totalBranches > 0) {
    console.error("[Playbook] CRITICAL: No branch results despite executing branches - possible silent failures");
  }

  // Synthesize findings (include web enrichment for risk assessment)
  const synthesis = synthesizeFindings(
    config.entityName,
    branchResults,
    executedBranches,
    Date.now() - startTime,
    allSources,
    config.webEnrichment
  );

  // Add execution metadata to synthesis for transparency
  (synthesis as any).executionMetadata = {
    branchesAttempted: branchTracker.totalBranches,
    branchesSucceeded: branchTracker.succeeded.length,
    branchesFailed: branchTracker.failed.length,
    failedBranches: branchTracker.failed,
    totalSources: allSources.length,
    authoritativeSources: authoritativeSources.length,
  };

  return {
    synthesis,
    branchResults,
    sources: allSources,
    executionTimeMs: Date.now() - startTime,
  };
}

// ============================================================================
// SYNTHESIS
// ============================================================================

function synthesizeFindings(
  entityName: string,
  branchResults: PlaybookResult["branchResults"],
  executedBranches: InvestorPlaybookBranchType[],
  executionTimeMs: number,
  sources: DDSource[],
  webEnrichment?: PlaybookConfig["webEnrichment"]
): InvestorPlaybookSynthesis {
  // Calculate verification scores
  const verificationScores = calculateVerificationScores(branchResults);

  // Identify discrepancies (include web enrichment red flags)
  const discrepancies = identifyDiscrepancies(branchResults, webEnrichment);

  // Evaluate stop rules (include web enrichment)
  const stopRules = evaluateStopRules(branchResults, webEnrichment);

  // Determine overall risk and recommendation
  const { overallRisk, recommendation, conditions, requiredResolutions } =
    determineRiskAndRecommendation(branchResults, stopRules, discrepancies, webEnrichment);

  return {
    entityName,
    evaluationDate: Date.now(),
    entityVerification: branchResults.entityVerification,
    secEdgar: branchResults.secEdgar,
    finraValidation: branchResults.finraValidation,
    fdaVerification: branchResults.fdaVerification,
    usptoDeepdive: branchResults.usptoDeepdive,
    moneyFlowIntegrity: branchResults.moneyFlowIntegrity,
    discrepancies,
    verificationScores,
    stopRules,
    shouldDisengage: stopRules.some(r => r.triggered && r.recommendation === "disengage"),
    overallRisk,
    recommendation,
    conditions,
    requiredResolutions,
    sources,
    branchesExecuted: executedBranches,
    executionTimeMs,
  };
}

function calculateVerificationScores(
  branchResults: PlaybookResult["branchResults"]
): PlaybookVerificationScore {
  const entity = branchResults.entityVerification?.overallConfidence ?? 0;
  const securities = branchResults.secEdgar?.overallConfidence ?? 0;
  const finra = branchResults.finraValidation?.overallConfidence ?? 0;
  const fda = branchResults.fdaVerification?.overallConfidence ?? 0;
  const patents = branchResults.usptoDeepdive?.overallConfidence ?? 0;
  const moneyFlow = branchResults.moneyFlowIntegrity?.overallConfidence ?? 0;

  // Weight the scores
  const weights = {
    entity: 0.2,
    securities: 0.2,
    finra: 0.15,
    fda: 0.15,
    patents: 0.1,
    moneyFlow: 0.2,
  };

  const overall =
    entity * weights.entity +
    securities * weights.securities +
    finra * weights.finra +
    fda * weights.fda +
    patents * weights.patents +
    moneyFlow * weights.moneyFlow;

  return {
    entity,
    securities,
    finra,
    fda,
    patents,
    moneyFlow,
    overall: Math.min(1, overall),
  };
}

function identifyDiscrepancies(
  branchResults: PlaybookResult["branchResults"],
  webEnrichment?: PlaybookConfig["webEnrichment"]
): PlaybookDiscrepancy[] {
  const discrepancies: PlaybookDiscrepancy[] = [];

  // Web enrichment red flags (from agentic context gathering)
  if (webEnrichment?.redFlagsFromWeb && webEnrichment.redFlagsFromWeb.length > 0) {
    for (const flag of webEnrichment.redFlagsFromWeb) {
      if (flag.includes("Scam/fraud")) {
        discrepancies.push({
          field: "Web Reputation",
          claimedValue: "Legitimate business",
          verifiedValue: "Scam/fraud mentions found in web search",
          source: "Web Search",
          severity: "major",
          category: "entity",  // Entity category covers reputation issues
        });
      }
      if (flag.includes("Outsized promotional claims")) {
        discrepancies.push({
          field: "Promotional Claims",
          claimedValue: "Reasonable business claims",
          verifiedValue: "Billion-dollar claims detected (potential exaggeration)",
          source: "Web Search",
          severity: "major",
          category: "financial",
        });
      }
      if (flag.includes("Valuation vs revenue mismatch")) {
        discrepancies.push({
          field: "Valuation vs Revenue",
          claimedValue: "Valuation supported by revenue",
          verifiedValue: flag,
          source: "Web Search",
          severity: "critical",
          category: "financial",
        });
      }
    }
  }

  // Entity discrepancies
  if (branchResults.entityVerification) {
    for (const flag of branchResults.entityVerification.redFlags) {
      if (flag.type === "name_mismatch" || flag.type === "recent_formation") {
        discrepancies.push({
          field: flag.type === "name_mismatch" ? "Entity Name" : "Formation Date",
          claimedValue: "As stated",
          verifiedValue: "See registry",
          source: "State Registry",
          severity: flag.severity === "critical" ? "critical" : flag.severity === "high" ? "major" : "moderate",
          category: "entity",
        });
      }
    }
  }

  // SEC discrepancies
  if (branchResults.secEdgar) {
    for (const flag of branchResults.secEdgar.redFlags) {
      if (flag.type === "terms_mismatch" || flag.type === "no_filing") {
        discrepancies.push({
          field: "Securities Regime",
          claimedValue: branchResults.secEdgar.securitiesRegime,
          verifiedValue: flag.type === "no_filing" ? "No filing found" : "Mismatch detected",
          source: "SEC EDGAR",
          severity: flag.severity === "critical" ? "critical" : flag.severity === "high" ? "major" : "moderate",
          category: "securities",
        });
      }
    }
  }

  // FDA discrepancies
  if (branchResults.fdaVerification) {
    for (const flag of branchResults.fdaVerification.redFlags) {
      if (flag.type === "status_misrepresentation" || flag.type === "clearance_not_found") {
        discrepancies.push({
          field: "FDA Status",
          claimedValue: branchResults.fdaVerification.claimedStatus || "FDA Cleared",
          verifiedValue: branchResults.fdaVerification.actualStatus,
          source: "FDA Database",
          severity: "critical",
          category: "regulatory",
        });
      }
    }
  }

  // Patent discrepancies
  if (branchResults.usptoDeepdive) {
    for (const flag of branchResults.usptoDeepdive.redFlags) {
      if (flag.type === "patent_not_found" || flag.type === "not_assigned_to_company") {
        discrepancies.push({
          field: flag.type === "patent_not_found" ? "Patent Existence" : "Patent Ownership",
          claimedValue: "As stated",
          verifiedValue: "Not verified",
          source: "USPTO",
          severity: flag.severity === "high" ? "major" : "moderate",
          category: "ip",
        });
      }
    }
  }

  // Scientific claim discrepancies
  // CRITICAL: Detect debunked claims, retractions, replication failures
  if (branchResults.scientificClaimVerification) {
    const sci = branchResults.scientificClaimVerification;

    // Debunked scientific claim
    if (sci.overallStatus === "debunked") {
      discrepancies.push({
        field: "Scientific Claim",
        claimedValue: sci.claims[0]?.claim || "Scientific breakthrough",
        verifiedValue: "DEBUNKED by scientific community",
        source: "Scientific Literature Search",
        severity: "critical",
        category: "entity",
      });
    }

    // Retracted papers
    if (sci.overallStatus === "retracted" || sci.retractions.length > 0) {
      discrepancies.push({
        field: "Scientific Papers",
        claimedValue: "Valid peer-reviewed research",
        verifiedValue: `${sci.retractions.length} paper(s) RETRACTED`,
        source: "Retraction Watch / Scientific Journals",
        severity: "critical",
        category: "entity",
      });
    }

    // Replication failures
    if (sci.overallStatus === "replication_failed") {
      const failedCount = sci.replicationStudies.filter(r => r.result === "failure").length;
      discrepancies.push({
        field: "Scientific Replication",
        claimedValue: "Reproducible scientific results",
        verifiedValue: `${failedCount} replication attempt(s) FAILED`,
        source: "Independent Replication Studies",
        severity: "critical",
        category: "entity",
      });
    }

    // Preprint only (no peer review)
    if (sci.overallStatus === "preprint_only") {
      discrepancies.push({
        field: "Peer Review Status",
        claimedValue: "Peer-reviewed research",
        verifiedValue: "PREPRINT ONLY - not peer reviewed",
        source: "arXiv / Scientific Databases",
        severity: "major",
        category: "entity",
      });
    }

    // Critical red flags
    for (const flag of sci.redFlags.filter(f => f.severity === "critical")) {
      discrepancies.push({
        field: "Scientific Verification",
        claimedValue: "Valid scientific claim",
        verifiedValue: flag.description,
        source: "Scientific Claim Verification",
        severity: "critical",
        category: "entity",
      });
    }
  }

  // Financial discrepancies from SEC Form C data
  // Ground truth pattern: Check for zero/minimal revenue with large project claims
  if (branchResults.secEdgar?.formCFilings) {
    for (const filing of branchResults.secEdgar.formCFilings) {
      if (filing.financials) {
        const { totalRevenue, totalAssets, netIncome } = filing.financials;

        // Check for zero revenue - major red flag for companies claiming billion-dollar projects
        if (totalRevenue !== undefined && totalRevenue === 0) {
          discrepancies.push({
            field: "Total Revenue",
            claimedValue: "Active business with projects",
            verifiedValue: "$0 (per SEC Form C)",
            source: "SEC EDGAR Form C",
            severity: "critical",
            category: "financial",
          });
        }

        // Check for zero/minimal assets
        if (totalAssets !== undefined && totalAssets === 0) {
          discrepancies.push({
            field: "Total Assets",
            claimedValue: "Operating company",
            verifiedValue: "$0 (per SEC Form C)",
            source: "SEC EDGAR Form C",
            severity: "major",
            category: "financial",
          });
        }

        // Check for negative net income (losses)
        if (netIncome !== undefined && netIncome < 0) {
          discrepancies.push({
            field: "Net Income",
            claimedValue: "Profitable operation",
            verifiedValue: `$${netIncome.toLocaleString()} loss (per SEC Form C)`,
            source: "SEC EDGAR Form C",
            severity: "moderate",
            category: "financial",
          });
        }
      }
    }
  }

  return discrepancies;
}

function evaluateStopRules(
  branchResults: PlaybookResult["branchResults"],
  webEnrichment?: PlaybookConfig["webEnrichment"]
): PlaybookStopRule[] {
  const stopRules: PlaybookStopRule[] = [];

  // Rule 0: Web search found scam/fraud mentions
  const hasScamMentions = webEnrichment?.redFlagsFromWeb?.some(f => f.includes("Scam/fraud"));
  const hasOutsizedClaims = webEnrichment?.redFlagsFromWeb?.some(f => f.includes("Outsized promotional claims"));

  stopRules.push({
    triggered: hasScamMentions === true,
    rule: "Scam/Fraud Mentions in Web Search",
    description: "Web search found mentions of scam or fraud associated with this entity. Requires careful investigation.",
    recommendation: "proceed_with_caution",
  });

  stopRules.push({
    triggered: hasOutsizedClaims === true,
    rule: "Outsized Promotional Claims",
    description: "Entity makes billion-dollar claims that may not be supported by actual financials. High risk of promotional exaggeration.",
    recommendation: "proceed_with_caution",
  });

  // Rule 1: Direct wire + missing SEC filings
  const hasDirectWire = branchResults.moneyFlowIntegrity?.requestedMethod === "personal_account" ||
    branchResults.moneyFlowIntegrity?.requestedMethod === "crypto_wallet";
  const noSecFilings = branchResults.secEdgar && !branchResults.secEdgar.verification.filingFound;

  stopRules.push({
    triggered: hasDirectWire && noSecFilings === true,
    rule: "Direct Wire + No SEC Filings",
    description: "Funds requested via personal/crypto channel with no SEC filings found. High fraud risk.",
    recommendation: "disengage",
  });

  // Rule 2: FDA status misrepresentation
  // Check for explicit misrepresentation red flag (critical severity)
  const fdaMisrep = branchResults.fdaVerification?.redFlags.some(
    f => f.type === "status_misrepresentation" && f.severity === "critical"
  );

  // Also check if FDA claim was made but statusMatchesClaims is false
  const fdaClaimMismatch = branchResults.fdaVerification?.claimedStatus &&
    branchResults.fdaVerification?.statusMatchesClaims === false;

  stopRules.push({
    triggered: fdaMisrep === true || fdaClaimMismatch === true,
    rule: "FDA Status Misrepresentation",
    description: "FDA clearance/approval claim could not be verified in FDA databases. Request 510(k) K-number.",
    recommendation: "require_resolution",  // Changed from disengage to require_resolution
  });

  // Rule 3: Unregistered funding portal for Reg CF
  // Check both claimed portal AND intermediary from SEC filings
  const claimsRegCF = branchResults.secEdgar?.securitiesRegime === "Reg CF";
  const portalFromClaim = branchResults.finraValidation?.claimedPortal?.name;
  // Also check if SEC filings mention an intermediary
  const portalFromSEC = branchResults.secEdgar?.formCFilings?.find(f => f.intermediaryName)?.intermediaryName;
  const portalWasClaimed = Boolean(portalFromClaim || portalFromSEC);
  const portalNotRegistered = portalWasClaimed && !branchResults.finraValidation?.portalIsRegistered;

  // If we found a portal from SEC filings, note it
  if (portalFromSEC && !portalFromClaim) {
    console.log(`[StopRules] Found intermediary from SEC filings: ${portalFromSEC}`);
  }

  stopRules.push({
    triggered: claimsRegCF === true && portalNotRegistered === true,
    rule: "Unregistered Portal for Reg CF",
    description: `Company claims Reg CF but the funding portal (${portalFromClaim || portalFromSEC || "unknown"}) is not FINRA-registered. Illegal offering structure.`,
    recommendation: "disengage",
  });

  // Rule 3b: Reg CF without portal (warning, not stop)
  const regCFWithoutPortal = claimsRegCF === true && !portalWasClaimed;
  stopRules.push({
    triggered: regCFWithoutPortal,
    rule: "Reg CF Without Identified Portal",
    description: "SEC filings indicate Reg CF but no funding portal was identified. Verify the offering is conducted through a registered portal.",
    recommendation: "require_resolution",
  });

  // Rule 4: Entity not found + large funding request
  const entityNotFound = branchResults.entityVerification &&
    !branchResults.entityVerification.verification.entityExists;
  // Assume large if we're running playbook

  stopRules.push({
    triggered: entityNotFound === true,
    rule: "Entity Not Found",
    description: "Cannot verify entity exists in any state registry. Cannot confirm you're dealing with a real company.",
    recommendation: "require_resolution",
  });

  // Rule 5: Critical wire fraud indicators
  const criticalFraudIndicators = branchResults.moneyFlowIntegrity?.wireFraudIndicators.some(
    i => i.severity === "critical"
  );

  stopRules.push({
    triggered: criticalFraudIndicators === true,
    rule: "Wire Fraud Indicators",
    description: "Critical wire fraud indicators detected in payment instructions.",
    recommendation: "disengage",
  });

  // Rule 6: Contradicted Scientific/Technical Claims (from claimVerification)
  // Detects pseudoscience, debunked claims, and failed replications (e.g., LK-99, cold fusion)
  const hasContradictedClaims = (branchResults.claimVerification?.contradictedClaims?.length ?? 0) > 0;
  const contradictedClaimCount = branchResults.claimVerification?.contradictedClaims?.length ?? 0;
  const contradictedClaimContext = branchResults.claimVerification?.contradictedClaims
    ?.map(c => c.claim).slice(0, 3).join("; ") || "";

  stopRules.push({
    triggered: hasContradictedClaims,
    rule: "Contradicted Scientific/Technical Claims",
    description: `${contradictedClaimCount} claim(s) contradicted by evidence. ` +
      `Scientific claims may be debunked, not replicated, or contradict established knowledge. ` +
      (contradictedClaimContext ? `Claims: ${contradictedClaimContext}` : ""),
    recommendation: "require_resolution",
  });

  // Rule 7: Scientific Claim Verification Red Flags (from scientificClaimVerification)
  // CRITICAL: Detects debunked science, retractions, replication failures
  const scientificFindings = branchResults.scientificClaimVerification;
  const hasScientificRedFlags = scientificFindings && scientificFindings.redFlags.length > 0;
  const criticalScientificFlags = scientificFindings?.redFlags.filter(f => f.severity === "critical") ?? [];
  const highScientificFlags = scientificFindings?.redFlags.filter(f => f.severity === "high") ?? [];

  // Determine severity level
  const isDebunked = scientificFindings?.overallStatus === "debunked";
  const isRetracted = scientificFindings?.overallStatus === "retracted";
  const hasReplicationFailure = scientificFindings?.overallStatus === "replication_failed";

  if (isDebunked || isRetracted) {
    stopRules.push({
      triggered: true,
      rule: "Debunked/Retracted Scientific Claim",
      description: `CRITICAL: Scientific claim has been ${isDebunked ? "DEBUNKED by the research community" : "RETRACTED"}. ` +
        `${scientificFindings?.scientificConsensus || "Multiple independent sources confirm the claim is invalid."}`,
      recommendation: "disengage",
    });
  } else if (hasReplicationFailure) {
    stopRules.push({
      triggered: true,
      rule: "Failed Scientific Replication",
      description: `HIGH RISK: Independent replication attempts have FAILED. ` +
        `${scientificFindings?.replicationStudies.filter(r => r.result === "failure").length || 0} failed replications found. ` +
        `This is a major red flag for any investment based on this scientific claim.`,
      recommendation: "require_resolution",
    });
  } else if (criticalScientificFlags.length > 0) {
    stopRules.push({
      triggered: true,
      rule: "Critical Scientific Claim Issues",
      description: criticalScientificFlags.map(f => f.description).join(" "),
      recommendation: "require_resolution",
    });
  } else if (highScientificFlags.length > 0) {
    stopRules.push({
      triggered: true,
      rule: "Scientific Claim Verification Concerns",
      description: `Scientific claim verification found concerns: ${highScientificFlags.map(f => f.description).join("; ")}`,
      recommendation: "proceed_with_caution",
    });
  }

  return stopRules;
}

function determineRiskAndRecommendation(
  branchResults: PlaybookResult["branchResults"],
  stopRules: PlaybookStopRule[],
  discrepancies: PlaybookDiscrepancy[],
  webEnrichment?: PlaybookConfig["webEnrichment"]
): {
  overallRisk: InvestorPlaybookSynthesis["overallRisk"];
  recommendation: InvestorPlaybookSynthesis["recommendation"];
  conditions?: string[];
  requiredResolutions?: string[];
} {
  // Check for triggered stop rules
  const disengageRules = stopRules.filter(r => r.triggered && r.recommendation === "disengage");
  const requireResolutionRules = stopRules.filter(r => r.triggered && r.recommendation === "require_resolution");
  const cautionRules = stopRules.filter(r => r.triggered && r.recommendation === "proceed_with_caution");

  if (disengageRules.length > 0) {
    return {
      overallRisk: "critical",
      recommendation: "pass",
      requiredResolutions: disengageRules.map(r => r.description),
    };
  }

  // Count critical/major discrepancies
  const criticalDiscrepancies = discrepancies.filter(d => d.severity === "critical");
  const majorDiscrepancies = discrepancies.filter(d => d.severity === "major");

  // Web enrichment red flags count as major issues
  const webRedFlagCount = webEnrichment?.redFlagsFromWeb?.length || 0;

  if (criticalDiscrepancies.length >= 2 || requireResolutionRules.length > 0) {
    return {
      overallRisk: "high",
      recommendation: "require_resolution",
      requiredResolutions: [
        ...criticalDiscrepancies.map(d => `Resolve ${d.field} discrepancy`),
        ...requireResolutionRules.map(r => r.description),
      ],
    };
  }

  // If we have investigate rules (scam mentions, outsized claims), elevate risk
  if (cautionRules.length >= 2 || (cautionRules.length >= 1 && majorDiscrepancies.length >= 1)) {
    return {
      overallRisk: "high",
      recommendation: "require_resolution",
      requiredResolutions: [
        ...cautionRules.map(r => r.description),
        "Verify all promotional claims against SEC filings",
        "Request audited financial statements",
      ],
    };
  }

  if (criticalDiscrepancies.length === 1 || majorDiscrepancies.length >= 2 || cautionRules.length >= 1) {
    return {
      overallRisk: "elevated",
      recommendation: "proceed_with_conditions",
      conditions: [
        "Obtain written clarification on all flagged discrepancies",
        "Request supporting documentation for claims",
        "Consider reduced investment amount",
        ...(cautionRules.length > 0 ? ["Review web search red flags before proceeding"] : []),
      ],
    };
  }

  if (majorDiscrepancies.length === 1 || discrepancies.length >= 3) {
    return {
      overallRisk: "moderate",
      recommendation: "proceed_with_conditions",
      conditions: [
        "Request clarification on flagged items before proceeding",
      ],
    };
  }

  return {
    overallRisk: "low",
    recommendation: "proceed",
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function generatePlaybookReport(synthesis: InvestorPlaybookSynthesis): string {
  const lines: string[] = [];

  lines.push(`# Investor Due Diligence Report: ${synthesis.entityName}`);
  lines.push(`Generated: ${new Date(synthesis.evaluationDate).toISOString()}`);
  lines.push("");

  // Overall Assessment
  lines.push("## Overall Assessment");
  lines.push(`- **Risk Level:** ${synthesis.overallRisk.toUpperCase()}`);
  lines.push(`- **Recommendation:** ${synthesis.recommendation.replace(/_/g, " ").toUpperCase()}`);

  if (synthesis.shouldDisengage) {
    lines.push("");
    lines.push("**STOP - DO NOT PROCEED**");
    lines.push("Critical issues detected that warrant immediate disengagement.");
  }

  // Verification Scores
  lines.push("");
  lines.push("## Verification Scores");
  lines.push(`- Entity: ${(synthesis.verificationScores.entity * 100).toFixed(0)}%`);
  lines.push(`- Securities: ${(synthesis.verificationScores.securities * 100).toFixed(0)}%`);
  lines.push(`- FINRA: ${(synthesis.verificationScores.finra * 100).toFixed(0)}%`);
  lines.push(`- FDA: ${(synthesis.verificationScores.fda * 100).toFixed(0)}%`);
  lines.push(`- Patents: ${(synthesis.verificationScores.patents * 100).toFixed(0)}%`);
  lines.push(`- Money Flow: ${(synthesis.verificationScores.moneyFlow * 100).toFixed(0)}%`);
  lines.push(`- **Overall:** ${(synthesis.verificationScores.overall * 100).toFixed(0)}%`);

  // Financial Data from SEC Filings (Ground Truth style)
  if (synthesis.secEdgar?.formCFilings) {
    const filingWithFinancials = synthesis.secEdgar.formCFilings.find(f => f.financials);
    if (filingWithFinancials?.financials) {
      const fin = filingWithFinancials.financials;
      lines.push("");
      lines.push("## Financial Data (from SEC Form C)");
      if (fin.totalRevenue !== undefined) {
        lines.push(`- **Total Revenue:** $${fin.totalRevenue.toLocaleString()}`);
      }
      if (fin.totalAssets !== undefined) {
        lines.push(`- **Total Assets:** $${fin.totalAssets.toLocaleString()}`);
      }
      if (fin.totalLiabilities !== undefined) {
        lines.push(`- **Total Liabilities:** $${fin.totalLiabilities.toLocaleString()}`);
      }
      if (fin.netIncome !== undefined) {
        lines.push(`- **Net Income:** $${fin.netIncome.toLocaleString()}`);
      }
      if (fin.employeeCount !== undefined) {
        lines.push(`- **Employees:** ${fin.employeeCount}`);
      }
    }

    // Show intermediary if found
    const filingWithIntermediary = synthesis.secEdgar.formCFilings.find(f => f.intermediaryName);
    if (filingWithIntermediary?.intermediaryName) {
      lines.push(`- **Funding Portal (Intermediary):** ${filingWithIntermediary.intermediaryName}`);
    }
  }

  // Discrepancies
  if (synthesis.discrepancies.length > 0) {
    lines.push("");
    lines.push("## Discrepancies Found");
    for (const d of synthesis.discrepancies) {
      lines.push(`- **${d.field}** (${d.severity}): Claimed "${d.claimedValue}" vs Verified "${d.verifiedValue}" [Source: ${d.source}]`);
    }
  }

  // Stop Rules
  const triggeredStopRules = synthesis.stopRules.filter(r => r.triggered);
  if (triggeredStopRules.length > 0) {
    lines.push("");
    lines.push("## Stop Rules Triggered");
    for (const r of triggeredStopRules) {
      lines.push(`- **${r.rule}**: ${r.description}`);
    }
  }

  // Required Resolutions
  if (synthesis.requiredResolutions && synthesis.requiredResolutions.length > 0) {
    lines.push("");
    lines.push("## Required Resolutions");
    for (const r of synthesis.requiredResolutions) {
      lines.push(`- ${r}`);
    }
  }

  // Conditions
  if (synthesis.conditions && synthesis.conditions.length > 0) {
    lines.push("");
    lines.push("## Conditions for Proceeding");
    for (const c of synthesis.conditions) {
      lines.push(`- ${c}`);
    }
  }

  // Sources
  lines.push("");
  lines.push("## Sources Consulted");
  const authSources = synthesis.sources.filter(s => s.reliability === "authoritative");
  for (const s of authSources.slice(0, 10)) {
    lines.push(`- ${s.title}${s.url ? ` (${s.url})` : ""}`);
  }

  lines.push("");
  lines.push(`---`);
  lines.push(`Execution time: ${synthesis.executionTimeMs}ms | Branches executed: ${synthesis.branchesExecuted.join(", ")}`);

  return lines.join("\n");
}
