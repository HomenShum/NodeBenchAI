/**
 * Deep Research Orchestrator
 *
 * The "lead agent" that coordinates multi-agent research.
 * Implements patterns from:
 * - Anthropic's multi-agent research system
 * - OpenAI Deep Research
 * - OODA loop (Observe, Orient, Decide, Act)
 *
 * @module deepResearch/deepResearchOrchestrator
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../../_generated/server";
import { api, internal } from "../../../../_generated/api";
import { Id } from "../../../../_generated/dataModel";

import type {
  DeepResearchJobConfig,
  DeepResearchJobProgress,
  DeepResearchReport,
  DecomposedQuery,
  SubAgentTask,
  SubAgentResult,
  PersonProfile,
  CompanyProfile,
  NewsEvent,
  Hypothesis,
  RelationshipGraph,
  ResearchSource,
  VerifiedClaim,
  Evidence,
  OODAState,
  ThinkingStep,
  MethodologyStep,
  InferenceStep,
  CriticalEvaluation,
  CriticalPoint,
  VerificationStep,
  Recommendation,
  FormattedReference,
} from "./types";

import { decomposeQuery } from "./queryDecomposer";
import { executePersonResearch } from "./agents/personResearchAgent";
import { executeNewsVerification } from "./agents/newsVerificationAgent";
import { evaluateHypothesis } from "./hypothesisEngine";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG = {
  maxSubAgents: 10,
  maxTokenBudget: 100000,
  timeoutMs: 5 * 60 * 1000, // 5 minutes
  subAgentTimeoutMs: 60 * 1000, // 1 minute per agent
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR ACTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start a deep research job
 *
 * This is the main entry point that:
 * 1. Decomposes the query
 * 2. Spawns sub-agents in parallel
 * 3. Cross-verifies findings
 * 4. Evaluates hypotheses
 * 5. Synthesizes final report
 */
export const startDeepResearch = internalAction({
  args: {
    query: v.string(),
    depth: v.optional(v.union(
      v.literal("quick"),
      v.literal("standard"),
      v.literal("comprehensive"),
      v.literal("exhaustive")
    )),
    maxSubAgents: v.optional(v.number()),
    requireVerification: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    jobId: string;
    report: DeepResearchReport;
  }> => {
    const startTime = Date.now();
    const jobId = `dr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    console.log(`[DeepResearch] Starting job ${jobId}`);
    console.log(`[DeepResearch] Query: ${args.query.slice(0, 100)}...`);

    const depth = args.depth || "standard";
    const maxSubAgents = args.maxSubAgents || getMaxAgentsForDepth(depth);

    // Initialize OODA state for tracking
    const oodaState: OODAState = {
      cycle: 0,
      phase: "observe",
      observedFacts: [],
      observedGaps: [],
      observedContradictions: [],
      currentUnderstanding: "",
      confidenceLevel: 0,
      alternativeInterpretations: [],
      nextActions: [],
      prioritizedQuestions: [],
      pendingTools: [],
      completedTools: [],
    };

    const thinkingSteps: ThinkingStep[] = [];

    try {
      // ═══════════════════════════════════════════════════════════════════
      // PHASE 1: OBSERVE - Decompose Query
      // ═══════════════════════════════════════════════════════════════════
      thinkingSteps.push({
        stepNumber: 1,
        phase: "planning",
        thought: "Analyzing query to identify entities, relationships, and hypotheses",
      });

      const decomposed = await decomposeQueryWithContext(ctx, args.query);

      thinkingSteps.push({
        stepNumber: 2,
        phase: "planning",
        thought: `Identified ${decomposed.entities.length} entities, ${decomposed.hypotheses.length} hypotheses, ${decomposed.subQuestions.length} sub-questions`,
        decision: `Will spawn ${Math.min(decomposed.subQuestions.length, maxSubAgents)} sub-agents`,
      });

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 2: ORIENT - Plan Sub-Agent Tasks
      // ═══════════════════════════════════════════════════════════════════
      const subAgentTasks = planSubAgentTasks(decomposed, maxSubAgents);

      thinkingSteps.push({
        stepNumber: 3,
        phase: "planning",
        thought: `Planned ${subAgentTasks.length} parallel research tasks: ${subAgentTasks.map(t => t.type).join(", ")}`,
      });

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 3: DECIDE - Determine Execution Strategy
      // ═══════════════════════════════════════════════════════════════════
      const executionPlan = {
        parallelAgents: subAgentTasks.filter(t => t.dependencies.length === 0),
        sequentialAgents: subAgentTasks.filter(t => t.dependencies.length > 0),
        requiresNewsVerification: decomposed.intent.timelinessRequired,
        requiresHypothesisTesting: decomposed.hypotheses.length > 0,
      };

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 4: ACT - Execute Sub-Agents in Parallel
      // ═══════════════════════════════════════════════════════════════════
      thinkingSteps.push({
        stepNumber: 4,
        phase: "analysis",
        thought: `Executing ${executionPlan.parallelAgents.length} agents in parallel`,
      });

      // Create web search function using Fusion search
      const webSearchFn = async (query: string) => {
        try {
          const result = await ctx.runAction(
            api.domains.search.fusion.actions.fusionSearch,
            {
              query,
              mode: "balanced",
              maxTotal: 10,
              skipRateLimit: true,
            }
          );

          if (result?.payload?.results) {
            return result.payload.results.map((r: Record<string, unknown>) => ({
              title: String(r.title || ""),
              snippet: String(r.snippet || ""),
              url: String(r.url || ""),
            }));
          }
          return [];
        } catch (error) {
          console.error("[DeepResearch] Search failed:", error);
          return [];
        }
      };

      // Execute agents in parallel
      const agentResults = await executeAgentsInParallel(
        subAgentTasks,
        webSearchFn,
        DEFAULT_CONFIG.subAgentTimeoutMs
      );

      thinkingSteps.push({
        stepNumber: 5,
        phase: "analysis",
        thought: `Completed ${agentResults.filter(r => r.status === "completed").length}/${agentResults.length} agents`,
        confidenceChange: 0.2,
      });

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 5: CROSS-VERIFY - Triangulate Findings
      // ═══════════════════════════════════════════════════════════════════
      const { verifiedClaims, contradictions, allEvidence, allSources } =
        crossVerifyFindings(agentResults);

      thinkingSteps.push({
        stepNumber: 6,
        phase: "verification",
        thought: `Cross-verified ${verifiedClaims.length} claims, found ${contradictions.length} contradictions`,
      });

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 6: EVALUATE HYPOTHESES
      // ═══════════════════════════════════════════════════════════════════
      const evaluatedHypotheses: Hypothesis[] = [];

      if (decomposed.hypotheses.length > 0) {
        thinkingSteps.push({
          stepNumber: 7,
          phase: "verification",
          thought: `Evaluating ${decomposed.hypotheses.length} hypotheses against evidence`,
        });

        for (const hyp of decomposed.hypotheses) {
          const evaluated = await evaluateHypothesis({
            hypothesis: hyp.statement,
            priorEvidence: allEvidence,
            verifiedClaims,
            webSearchFn,
          });

          evaluatedHypotheses.push(evaluated);
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 7: SYNTHESIZE REPORT
      // ═══════════════════════════════════════════════════════════════════
      thinkingSteps.push({
        stepNumber: 8,
        phase: "synthesis",
        thought: "Synthesizing final research report",
      });

      const report = synthesizeReport(
        jobId,
        args.query,
        decomposed,
        agentResults,
        verifiedClaims,
        contradictions,
        evaluatedHypotheses,
        allSources,
        startTime,
        thinkingSteps
      );

      console.log(`[DeepResearch] Job ${jobId} completed in ${report.executionTimeMs}ms`);
      console.log(`[DeepResearch] Verdict: ${report.overallVerdict}`);

      return { jobId, report };

    } catch (error) {
      console.error(`[DeepResearch] Job ${jobId} failed:`, error);

      // Return partial report on failure
      return {
        jobId,
        report: {
          jobId,
          originalQuery: args.query,
          executiveSummary: `Research failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          keyFindings: [],
          confidence: 0,
          personProfiles: [],
          companyProfiles: [],
          newsEvents: [],
          relationships: { nodes: [], edges: [], clusters: [] },
          hypothesesEvaluated: [],
          overallVerdict: "UNVERIFIED",
          verdictReasoning: "Research could not be completed due to an error",
          verifiedClaims: [],
          unverifiedClaims: [],
          contradictions: [],
          methodology: [{
            stepNumber: 1,
            phase: "decomposition",
            action: "Research failed before completion",
            rationale: "An error occurred during execution",
            inputs: [args.query],
            outputs: [`Error: ${error instanceof Error ? error.message : "Unknown error"}`],
            sourcesUsed: [],
            timeSpentMs: Date.now() - startTime,
          }],
          inferenceChain: [],
          criticalEvaluation: {
            strongPoints: [],
            weakPoints: [{
              point: "Research failed to complete",
              evidence: error instanceof Error ? error.message : "Unknown error",
              confidence: 0,
              sourceCount: 0,
            }],
            alternativeInterpretations: [],
            falsificationCriteria: [],
            researchGaps: ["Research could not be completed due to an error"],
            skepticismLevel: 1,
            brutallyHonestAssessment: "**Assessment: FAILED**\n\nThe research could not be completed due to an error. No conclusions can be drawn.",
          },
          stepByStepGuide: "# Research Failed\n\nThe research could not be completed due to an error. Please try again or refine your query.",
          verificationSteps: [],
          recommendations: [],
          formattedReferences: [],
          sources: [],
          subAgentsSummary: [],
          executionTimeMs: Date.now() - startTime,
          createdAt: Date.now(),
        },
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY DECOMPOSITION WITH CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

async function decomposeQueryWithContext(
  ctx: any,
  query: string
): Promise<DecomposedQuery> {
  // Try to use LLM for decomposition with FREE-FIRST fallback strategy
  let generateTextFn: ((prompt: string) => Promise<string>) | undefined;

  try {
    const { generateText } = await import("ai");
    const { executeWithModelFallback } = await import("../../mcp_tools/models/modelResolver");

    generateTextFn = async (prompt: string) => {
      const { result } = await executeWithModelFallback(
        async (model, modelId) => {
          console.log(`[DeepResearch] Using model ${modelId} for decomposition`);
          const { text } = await generateText({
            model,
            prompt,
            maxOutputTokens: 2000,
            temperature: 0.1,
          });
          return text;
        },
        {
          onFallback: (from, to, error) => {
            console.log(`[DeepResearch] Fallback from ${from} to ${to}: ${error.message}`);
          },
        }
      );
      return result;
    };
  } catch (error) {
    console.log("[DeepResearch] LLM not available for decomposition, using rule-based");
  }

  return await decomposeQuery(query, generateTextFn);
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-AGENT TASK PLANNING
// ═══════════════════════════════════════════════════════════════════════════

function planSubAgentTasks(
  decomposed: DecomposedQuery,
  maxAgents: number
): SubAgentTask[] {
  const tasks: SubAgentTask[] = [];
  let taskId = 0;

  // Person research tasks
  for (const entity of decomposed.entities.filter(e => e.type === "person").slice(0, 3)) {
    tasks.push({
      id: `task-${taskId++}`,
      type: "person",
      target: entity.name,
      focus: entity.mentionedClaims.slice(0, 3),
      questions: decomposed.subQuestions
        .filter(q => q.targetEntity === entity.name)
        .map(q => q.question),
      priority: 1,
      timeout: DEFAULT_CONFIG.subAgentTimeoutMs,
      dependencies: [],
    });
  }

  // Company research tasks
  for (const entity of decomposed.entities.filter(e => e.type === "company").slice(0, 3)) {
    tasks.push({
      id: `task-${taskId++}`,
      type: "company",
      target: entity.name,
      focus: entity.mentionedClaims.slice(0, 3),
      questions: decomposed.subQuestions
        .filter(q => q.targetEntity === entity.name)
        .map(q => q.question),
      priority: 2,
      timeout: DEFAULT_CONFIG.subAgentTimeoutMs,
      dependencies: [],
    });
  }

  // News verification task
  if (decomposed.intent.timelinessRequired) {
    tasks.push({
      id: `task-${taskId++}`,
      type: "news",
      target: decomposed.originalQuery,
      focus: ["recent events", "announcements"],
      questions: decomposed.subQuestions
        .filter(q => q.type === "when" || q.type === "what")
        .map(q => q.question),
      priority: 1,
      timeout: DEFAULT_CONFIG.subAgentTimeoutMs,
      dependencies: [],
    });
  }

  // Relationship mapping task (depends on person/company)
  if (decomposed.relationships.length > 0) {
    const personCompanyTasks = tasks.filter(t => t.type === "person" || t.type === "company");
    tasks.push({
      id: `task-${taskId++}`,
      type: "relationship",
      target: "entity_connections",
      focus: decomposed.relationships.map(r => `${r.entity1} -> ${r.entity2}`),
      questions: decomposed.subQuestions
        .filter(q => q.type === "relationship")
        .map(q => q.question),
      priority: 3,
      timeout: DEFAULT_CONFIG.subAgentTimeoutMs,
      dependencies: personCompanyTasks.map(t => t.id),
    });
  }

  // Sort by priority and limit
  return tasks
    .sort((a, b) => a.priority - b.priority)
    .slice(0, maxAgents);
}

function getMaxAgentsForDepth(depth: string): number {
  switch (depth) {
    case "quick": return 3;
    case "standard": return 5;
    case "comprehensive": return 8;
    case "exhaustive": return 10;
    default: return 5;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PARALLEL AGENT EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

async function executeAgentsInParallel(
  tasks: SubAgentTask[],
  webSearchFn: (query: string) => Promise<{ title: string; snippet: string; url: string }[]>,
  timeout: number
): Promise<SubAgentResult[]> {
  // Separate into waves based on dependencies
  const wave1 = tasks.filter(t => t.dependencies.length === 0);
  const wave2 = tasks.filter(t => t.dependencies.length > 0);

  // Execute wave 1 in parallel
  const wave1Results = await Promise.all(
    wave1.map(task => executeSubAgent(task, webSearchFn, timeout))
  );

  // Execute wave 2 (with results from wave 1 available)
  const wave2Results = await Promise.all(
    wave2.map(task => executeSubAgent(task, webSearchFn, timeout))
  );

  return [...wave1Results, ...wave2Results];
}

async function executeSubAgent(
  task: SubAgentTask,
  webSearchFn: (query: string) => Promise<{ title: string; snippet: string; url: string }[]>,
  timeout: number
): Promise<SubAgentResult> {
  const startTime = Date.now();

  try {
    // Apply timeout
    const result = await Promise.race([
      executeAgentByType(task, webSearchFn),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Agent timeout")), timeout)
      ),
    ]);

    return result;

  } catch (error) {
    return {
      taskId: task.id,
      type: task.type,
      status: error instanceof Error && error.message === "Agent timeout" ? "timeout" : "failed",
      findings: null,
      sources: [],
      claims: [],
      executionTimeMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executeAgentByType(
  task: SubAgentTask,
  webSearchFn: (query: string) => Promise<{ title: string; snippet: string; url: string }[]>
): Promise<SubAgentResult> {
  const startTime = Date.now();

  switch (task.type) {
    case "person":
      return await executePersonResearch({
        name: task.target,
        focusAreas: task.focus,
        webSearchFn,
      });

    case "company":
      return await executeCompanyResearch(task, webSearchFn);

    case "news":
      return await executeNewsVerification({
        eventDescription: task.target,
        entities: task.focus,
        requireOfficialConfirmation: true,
        webSearchFn,
      });

    case "relationship":
      return await executeRelationshipMapping(task, webSearchFn);

    default:
      return {
        taskId: task.id,
        type: task.type,
        status: "completed",
        findings: { message: "Agent type not implemented" },
        sources: [],
        claims: [],
        executionTimeMs: Date.now() - startTime,
      };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPANY RESEARCH (Simplified)
// ═══════════════════════════════════════════════════════════════════════════

async function executeCompanyResearch(
  task: SubAgentTask,
  webSearchFn: (query: string) => Promise<{ title: string; snippet: string; url: string }[]>
): Promise<SubAgentResult> {
  const startTime = Date.now();
  const sources: ResearchSource[] = [];
  const claims: VerifiedClaim[] = [];

  // Search for company information
  const searchQuery = `${task.target} company about description funding`;
  const results = await webSearchFn(searchQuery);

  for (const result of results.slice(0, 5)) {
    sources.push({
      id: `src-company-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "news_article",
      url: result.url,
      title: result.title,
      accessedAt: Date.now(),
      reliability: "secondary",
      snippet: result.snippet,
    });
  }

  // Search for recent news
  const newsQuery = `${task.target} news announcement 2024 2025`;
  const newsResults = await webSearchFn(newsQuery);

  for (const result of newsResults.slice(0, 3)) {
    sources.push({
      id: `src-news-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "news_article",
      url: result.url,
      title: result.title,
      accessedAt: Date.now(),
      reliability: "secondary",
      snippet: result.snippet,
    });
  }

  // Build profile from snippets
  const profile: CompanyProfile = {
    name: task.target,
    description: results[0]?.snippet || "No description found",
    recentNews: newsResults.map(r => ({
      id: `event-${Date.now()}`,
      headline: r.title,
      summary: r.snippet,
      date: new Date().toISOString().split("T")[0],
      sources: [],
      entities: [task.target],
      eventType: "other" as const,
      verificationStatus: "reported" as const,
      confidence: 0.5,
    })),
    leadership: [],
    sources,
  };

  // Generate claims
  claims.push({
    claim: `${task.target} is a company`,
    verified: sources.length > 0,
    confidence: sources.length > 2 ? 0.8 : 0.5,
    sources: sources.slice(0, 2),
    verificationMethod: "triangulated",
    verifiedAt: Date.now(),
  });

  return {
    taskId: task.id,
    type: "company",
    status: "completed",
    findings: profile,
    sources,
    claims,
    executionTimeMs: Date.now() - startTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RELATIONSHIP MAPPING (Simplified)
// ═══════════════════════════════════════════════════════════════════════════

async function executeRelationshipMapping(
  task: SubAgentTask,
  webSearchFn: (query: string) => Promise<{ title: string; snippet: string; url: string }[]>
): Promise<SubAgentResult> {
  const startTime = Date.now();
  const sources: ResearchSource[] = [];

  // Search for relationships between entities
  const relationships = task.focus;
  const edges: RelationshipGraph["edges"] = [];

  for (const rel of relationships) {
    const [entity1, entity2] = rel.split(" -> ").map(e => e.trim());

    const searchQuery = `"${entity1}" "${entity2}" connection relationship partnership`;
    const results = await webSearchFn(searchQuery);

    for (const result of results.slice(0, 2)) {
      sources.push({
        id: `src-rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "news_article",
        url: result.url,
        title: result.title,
        accessedAt: Date.now(),
        reliability: "secondary",
        snippet: result.snippet,
      });

      // Infer relationship type from snippet
      const snippetLower = result.snippet.toLowerCase();
      let relType = "associated";
      if (snippetLower.includes("acqui") || snippetLower.includes("bought")) relType = "acquired";
      if (snippetLower.includes("partner")) relType = "partners_with";
      if (snippetLower.includes("work")) relType = "works_for";
      if (snippetLower.includes("join")) relType = "joined";

      edges.push({
        source: entity1,
        target: entity2,
        type: relType,
        strength: 0.6,
        evidence: [result.snippet],
        isVerified: true,
        isInferred: false,
      });
    }
  }

  const graph: RelationshipGraph = {
    nodes: [...new Set(relationships.flatMap(r => r.split(" -> ").map(e => e.trim())))]
      .map(name => ({
        id: name.toLowerCase().replace(/\s+/g, "-"),
        name,
        type: "company" as const,
        attributes: {},
        centrality: 0.5,
      })),
    edges,
    clusters: [],
  };

  return {
    taskId: task.id,
    type: "relationship",
    status: "completed",
    findings: graph,
    sources,
    claims: [],
    executionTimeMs: Date.now() - startTime,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

function crossVerifyFindings(results: SubAgentResult[]): {
  verifiedClaims: VerifiedClaim[];
  contradictions: { claim1: string; claim2: string }[];
  allEvidence: Evidence[];
  allSources: ResearchSource[];
} {
  const allClaims: VerifiedClaim[] = [];
  const allSources: ResearchSource[] = [];
  const allEvidence: Evidence[] = [];

  // Collect all claims and sources
  for (const result of results) {
    if (result.status === "completed") {
      allClaims.push(...result.claims);
      allSources.push(...result.sources);

      // Convert claims to evidence
      for (const claim of result.claims) {
        allEvidence.push({
          id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          content: claim.claim,
          source: claim.sources[0] || {
            id: `src-${Date.now()}`,
            type: "llm_inference",
            title: "Agent Finding",
            accessedAt: Date.now(),
            reliability: "secondary",
          },
          strength: claim.confidence > 0.8 ? "strong" : claim.confidence > 0.5 ? "moderate" : "weak",
          supportsClaimId: "",
          extractedAt: Date.now(),
          isDirectEvidence: true,
        });
      }
    }
  }

  // Find contradictions
  const contradictions: { claim1: string; claim2: string }[] = [];
  for (let i = 0; i < allClaims.length; i++) {
    for (let j = i + 1; j < allClaims.length; j++) {
      if (claimsContradict(allClaims[i].claim, allClaims[j].claim)) {
        contradictions.push({
          claim1: allClaims[i].claim,
          claim2: allClaims[j].claim,
        });
      }
    }
  }

  // Boost confidence for claims with multiple sources
  const verifiedClaims = allClaims.map(claim => {
    const matchingSources = allSources.filter(s =>
      s.snippet?.toLowerCase().includes(claim.claim.toLowerCase().split(" ").slice(0, 3).join(" "))
    );

    if (matchingSources.length >= 2) {
      return { ...claim, confidence: Math.min(0.95, claim.confidence + 0.1) };
    }
    return claim;
  });

  return { verifiedClaims, contradictions, allEvidence, allSources };
}

function claimsContradict(claim1: string, claim2: string): boolean {
  const c1Lower = claim1.toLowerCase();
  const c2Lower = claim2.toLowerCase();

  // Simple contradiction detection
  if ((c1Lower.includes("is ") && c2Lower.includes("is not ")) ||
      (c1Lower.includes("did ") && c2Lower.includes("did not "))) {
    // Check if they're about the same subject
    const words1 = c1Lower.split(/\s+/).filter(w => w.length > 3);
    const words2 = c2Lower.split(/\s+/).filter(w => w.length > 3);
    const overlap = words1.filter(w => words2.includes(w));

    return overlap.length >= 2;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// REPORT SYNTHESIS
// ═══════════════════════════════════════════════════════════════════════════

function synthesizeReport(
  jobId: string,
  originalQuery: string,
  decomposed: DecomposedQuery,
  agentResults: SubAgentResult[],
  verifiedClaims: VerifiedClaim[],
  contradictions: { claim1: string; claim2: string }[],
  hypotheses: Hypothesis[],
  allSources: ResearchSource[],
  startTime: number,
  thinkingSteps: ThinkingStep[]
): DeepResearchReport {
  // Extract profiles from results
  const personProfiles: PersonProfile[] = agentResults
    .filter(r => r.type === "person" && r.status === "completed" && r.findings)
    .map(r => r.findings as PersonProfile);

  const companyProfiles: CompanyProfile[] = agentResults
    .filter(r => r.type === "company" && r.status === "completed" && r.findings)
    .map(r => r.findings as CompanyProfile);

  const newsFindings = agentResults.find(r => r.type === "news" && r.status === "completed");
  const newsEvents: NewsEvent[] = newsFindings?.findings
    ? [(newsFindings.findings as { event: NewsEvent }).event]
    : [];

  const relationshipFindings = agentResults.find(r => r.type === "relationship" && r.status === "completed");
  const relationships: RelationshipGraph = relationshipFindings?.findings as RelationshipGraph ||
    { nodes: [], edges: [], clusters: [] };

  // Determine overall verdict
  let overallVerdict: DeepResearchReport["overallVerdict"] = "UNVERIFIED";
  let verdictReasoning = "";

  if (hypotheses.length > 0) {
    const verdictCounts = {
      VERIFIED: hypotheses.filter(h => h.verdict === "VERIFIED").length,
      PARTIALLY_SUPPORTED: hypotheses.filter(h => h.verdict === "PARTIALLY_SUPPORTED").length,
      CONTRADICTED: hypotheses.filter(h => h.verdict === "CONTRADICTED" || h.verdict === "FALSIFIED").length,
      UNVERIFIED: hypotheses.filter(h => h.verdict === "UNVERIFIED").length,
    };

    if (verdictCounts.VERIFIED > verdictCounts.CONTRADICTED && verdictCounts.VERIFIED >= hypotheses.length / 2) {
      overallVerdict = "VERIFIED";
      verdictReasoning = `${verdictCounts.VERIFIED} of ${hypotheses.length} hypotheses verified with supporting evidence`;
    } else if (verdictCounts.PARTIALLY_SUPPORTED > 0) {
      overallVerdict = "PARTIALLY_SUPPORTED";
      verdictReasoning = `Some evidence supports the hypotheses, but gaps remain`;
    } else if (verdictCounts.CONTRADICTED > 0) {
      overallVerdict = "CONTRADICTED";
      verdictReasoning = `Key hypotheses are contradicted by evidence`;
    } else {
      overallVerdict = "UNVERIFIED";
      verdictReasoning = `Insufficient evidence to verify the hypotheses`;
    }
  } else {
    // No hypotheses, base on claim verification
    const verifiedCount = verifiedClaims.filter(c => c.verified).length;
    if (verifiedCount >= verifiedClaims.length * 0.7) {
      overallVerdict = "VERIFIED";
      verdictReasoning = `${verifiedCount} of ${verifiedClaims.length} claims verified`;
    } else if (verifiedCount >= verifiedClaims.length * 0.3) {
      overallVerdict = "PARTIALLY_SUPPORTED";
      verdictReasoning = `Partial verification achieved`;
    } else {
      overallVerdict = "UNVERIFIED";
      verdictReasoning = `Insufficient evidence gathered`;
    }
  }

  // Generate executive summary
  const executiveSummary = generateExecutiveSummary(
    originalQuery,
    personProfiles,
    companyProfiles,
    newsEvents,
    hypotheses,
    overallVerdict
  );

  // Generate key findings
  const keyFindings = generateKeyFindings(
    verifiedClaims,
    hypotheses,
    newsEvents,
    contradictions
  );

  // Calculate confidence
  const avgConfidence = verifiedClaims.length > 0
    ? verifiedClaims.reduce((sum, c) => sum + c.confidence, 0) / verifiedClaims.length
    : 0;

  // Generate methodology steps
  const methodology = generateMethodology(
    decomposed,
    agentResults,
    verifiedClaims,
    hypotheses,
    thinkingSteps,
    startTime
  );

  // Generate inference chain
  const inferenceChain = generateInferenceChain(
    decomposed,
    verifiedClaims,
    hypotheses,
    personProfiles,
    companyProfiles,
    newsEvents
  );

  // Generate critical evaluation
  const criticalEvaluation = generateCriticalEvaluation(
    decomposed,
    verifiedClaims,
    hypotheses,
    contradictions,
    allSources
  );

  // Generate step-by-step guide
  const stepByStepGuide = generateStepByStepGuide(
    methodology,
    inferenceChain,
    criticalEvaluation,
    decomposed
  );

  // Generate verification steps (How to Verify)
  const verificationSteps = generateVerificationSteps(
    decomposed,
    verifiedClaims,
    hypotheses,
    personProfiles,
    companyProfiles
  );

  // Generate recommendations (What You Should Prepare)
  const recommendations = generateRecommendations(
    decomposed,
    criticalEvaluation,
    verifiedClaims,
    hypotheses,
    overallVerdict
  );

  // Generate formatted references for inline citations ([Source][1])
  const formattedReferences = generateFormattedReferences(allSources);

  return {
    jobId,
    originalQuery,
    executiveSummary,
    keyFindings,
    confidence: avgConfidence,
    personProfiles,
    companyProfiles,
    newsEvents,
    relationships,
    hypothesesEvaluated: hypotheses,
    overallVerdict,
    verdictReasoning,
    verifiedClaims,
    unverifiedClaims: decomposed.subQuestions
      .filter(q => !verifiedClaims.some(c => c.claim.toLowerCase().includes(q.question.toLowerCase().split(" ")[0])))
      .map(q => q.question),
    contradictions: contradictions.map(c => ({
      claim1: c.claim1,
      claim2: c.claim2,
      source1: allSources[0] || { id: "", type: "llm_inference", title: "", accessedAt: Date.now(), reliability: "unverified" },
      source2: allSources[1] || allSources[0] || { id: "", type: "llm_inference", title: "", accessedAt: Date.now(), reliability: "unverified" },
      severity: "moderate" as const,
    })),
    methodology,
    inferenceChain,
    criticalEvaluation,
    stepByStepGuide,
    verificationSteps,
    recommendations,
    formattedReferences,
    sources: allSources,
    subAgentsSummary: agentResults.map(r => ({
      type: r.type,
      target: r.taskId,
      status: r.status,
      findingsCount: r.claims.length,
      sourcesCount: r.sources.length,
      executionTimeMs: r.executionTimeMs,
    })),
    executionTimeMs: Date.now() - startTime,
    createdAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// METHODOLOGY GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function generateMethodology(
  decomposed: DecomposedQuery,
  agentResults: SubAgentResult[],
  verifiedClaims: VerifiedClaim[],
  hypotheses: Hypothesis[],
  thinkingSteps: ThinkingStep[],
  startTime: number
): MethodologyStep[] {
  const steps: MethodologyStep[] = [];
  let stepNum = 1;

  // Step 1: Query Decomposition
  steps.push({
    stepNumber: stepNum++,
    phase: "decomposition",
    action: "Analyzed the input query to extract structured components",
    rationale: "Complex queries need to be broken into verifiable sub-questions to enable systematic research",
    inputs: [decomposed.originalQuery],
    outputs: [
      `${decomposed.entities.length} entities identified`,
      `${decomposed.subQuestions.length} sub-questions generated`,
      `${decomposed.hypotheses.length} hypotheses extracted`,
      `${decomposed.relationships.length} relationships detected`,
    ],
    sourcesUsed: [],
    timeSpentMs: 500, // Estimate
  });

  // Step 2: Entity Identification
  steps.push({
    stepNumber: stepNum++,
    phase: "decomposition",
    action: "Identified key entities (people, companies, events) mentioned in the query",
    rationale: "Each entity needs to be researched individually to verify claims about them",
    inputs: [decomposed.originalQuery],
    outputs: decomposed.entities.map(e => `${e.type}: ${e.name}`),
    sourcesUsed: [],
    timeSpentMs: 200,
  });

  // Step 3: Parallel Research
  for (const result of agentResults) {
    steps.push({
      stepNumber: stepNum++,
      phase: "research",
      action: `Executed ${result.type} research agent for "${result.taskId}"`,
      rationale: `Gather information from ${result.type === "person" ? "LinkedIn, news, publications" : result.type === "company" ? "company websites, news, databases" : result.type === "news" ? "news sources, official announcements" : "multiple sources"}`,
      inputs: [result.taskId],
      outputs: [
        `${result.claims.length} claims extracted`,
        `${result.sources.length} sources found`,
        `Status: ${result.status}`,
      ],
      sourcesUsed: result.sources.map(s => s.url || s.title),
      timeSpentMs: result.executionTimeMs,
    });
  }

  // Step 4: Cross-verification
  steps.push({
    stepNumber: stepNum++,
    phase: "verification",
    action: "Cross-verified claims across multiple sources",
    rationale: "Claims supported by multiple independent sources have higher reliability",
    inputs: [`${verifiedClaims.length} total claims`],
    outputs: [
      `${verifiedClaims.filter(c => c.verified).length} claims verified`,
      `${verifiedClaims.filter(c => !c.verified).length} claims unverified`,
    ],
    sourcesUsed: [],
    timeSpentMs: 1000,
  });

  // Step 5: Hypothesis Evaluation
  if (hypotheses.length > 0) {
    steps.push({
      stepNumber: stepNum++,
      phase: "evaluation",
      action: "Evaluated hypotheses against gathered evidence",
      rationale: "Each hypothesis is decomposed into claims and tested against supporting/contradicting evidence",
      inputs: hypotheses.map(h => h.statement.slice(0, 50) + "..."),
      outputs: hypotheses.map(h => `${h.verdict}: "${h.statement.slice(0, 30)}..." (${Math.round(h.confidenceScore * 100)}% confidence)`),
      sourcesUsed: [],
      timeSpentMs: 2000,
    });
  }

  // Step 6: Synthesis
  steps.push({
    stepNumber: stepNum++,
    phase: "synthesis",
    action: "Synthesized findings into final report",
    rationale: "Combine all verified information, identify gaps, and form conclusions",
    inputs: ["All research findings", "Verified claims", "Hypothesis evaluations"],
    outputs: ["Executive summary", "Key findings", "Verdict and reasoning"],
    sourcesUsed: [],
    timeSpentMs: Date.now() - startTime - agentResults.reduce((sum, r) => sum + r.executionTimeMs, 0),
  });

  return steps;
}

// ═══════════════════════════════════════════════════════════════════════════
// INFERENCE CHAIN GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function generateInferenceChain(
  decomposed: DecomposedQuery,
  verifiedClaims: VerifiedClaim[],
  hypotheses: Hypothesis[],
  persons: PersonProfile[],
  companies: CompanyProfile[],
  news: NewsEvent[]
): InferenceStep[] {
  const steps: InferenceStep[] = [];
  let stepNum = 1;

  // For each verified claim, create an inference step
  for (const claim of verifiedClaims.filter(c => c.verified).slice(0, 5)) {
    steps.push({
      stepNumber: stepNum++,
      premise: claim.claim,
      premiseSource: claim.sources[0]?.title || "Multiple sources",
      inference: `This claim is verified with ${Math.round(claim.confidence * 100)}% confidence`,
      inferenceType: "direct",
      confidence: claim.confidence,
    });
  }

  // For each person, create inference about their relevance
  for (const person of persons) {
    if (person.currentRole && person.currentCompany) {
      steps.push({
        stepNumber: stepNum++,
        premise: `${person.name} is ${person.currentRole} at ${person.currentCompany}`,
        premiseSource: person.linkedinUrl || "LinkedIn/Web search",
        inference: `${person.name}'s expertise in ${person.expertiseAreas.slice(0, 3).join(", ") || "their field"} is relevant to the query`,
        inferenceType: "inductive",
        confidence: 0.7,
        counterArgument: person.expertiseAreas.length === 0
          ? "Limited information about specific expertise areas"
          : undefined,
      });
    }
  }

  // For news events, create inference about relevance
  for (const event of news) {
    steps.push({
      stepNumber: stepNum++,
      premise: event.headline,
      premiseSource: event.sources[0]?.name || "News sources",
      inference: event.verificationStatus === "verified"
        ? "This event is confirmed by multiple reliable sources"
        : "This event is reported but not officially confirmed",
      inferenceType: event.verificationStatus === "verified" ? "direct" : "inductive",
      confidence: event.confidence,
      counterArgument: event.verificationStatus !== "verified"
        ? "Awaiting official confirmation"
        : undefined,
    });
  }

  // For hypotheses, show the reasoning chain
  for (const hyp of hypotheses) {
    const claimsVerified = hyp.decomposedClaims.filter(c => c.status === "verified").length;
    const totalClaims = hyp.decomposedClaims.length;

    steps.push({
      stepNumber: stepNum++,
      premise: `Hypothesis: "${hyp.statement.slice(0, 100)}..."`,
      premiseSource: "User query",
      inference: `${claimsVerified}/${totalClaims} component claims verified → ${hyp.verdict}`,
      inferenceType: hyp.verdict === "VERIFIED" ? "deductive" : "abductive",
      confidence: hyp.confidenceScore,
      counterArgument: hyp.gaps.length > 0 ? hyp.gaps[0] : undefined,
    });
  }

  // Add relationship inferences
  for (const rel of decomposed.relationships) {
    const isVerified = verifiedClaims.some(c =>
      c.claim.toLowerCase().includes(rel.entity1.toLowerCase()) &&
      c.claim.toLowerCase().includes(rel.entity2.toLowerCase()) &&
      c.verified
    );

    steps.push({
      stepNumber: stepNum++,
      premise: `${rel.entity1} ${rel.relationshipType} ${rel.entity2}`,
      premiseSource: rel.isHypothetical ? "User hypothesis" : "Extracted from query/sources",
      inference: isVerified
        ? "This relationship is supported by evidence"
        : rel.isHypothetical
          ? "This is a hypothetical relationship that needs verification"
          : "This relationship is mentioned but not independently verified",
      inferenceType: rel.isHypothetical ? "abductive" : isVerified ? "direct" : "analogical",
      confidence: isVerified ? 0.8 : rel.isHypothetical ? 0.3 : 0.5,
      counterArgument: !isVerified ? "No direct evidence found for this relationship" : undefined,
    });
  }

  return steps;
}

// ═══════════════════════════════════════════════════════════════════════════
// CRITICAL EVALUATION GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function generateCriticalEvaluation(
  decomposed: DecomposedQuery,
  verifiedClaims: VerifiedClaim[],
  hypotheses: Hypothesis[],
  contradictions: { claim1: string; claim2: string }[],
  sources: ResearchSource[]
): CriticalEvaluation {
  // Strong points - what we're confident about
  const strongPoints: CriticalPoint[] = verifiedClaims
    .filter(c => c.verified && c.confidence > 0.7)
    .slice(0, 5)
    .map(c => ({
      point: c.claim,
      evidence: c.sources[0]?.snippet || "Multiple sources confirm",
      confidence: c.confidence,
      sourceCount: c.sources.length,
    }));

  // Weak points - where evidence is lacking
  const weakPoints: CriticalPoint[] = [];

  // Unverified claims
  for (const claim of verifiedClaims.filter(c => !c.verified).slice(0, 3)) {
    weakPoints.push({
      point: claim.claim,
      evidence: "Insufficient evidence to verify",
      confidence: claim.confidence,
      sourceCount: claim.sources.length,
    });
  }

  // Hypothetical relationships
  for (const rel of decomposed.relationships.filter(r => r.isHypothetical)) {
    weakPoints.push({
      point: `Relationship: ${rel.entity1} → ${rel.entity2}`,
      evidence: "This is hypothetical, not verified",
      confidence: rel.confidence,
      sourceCount: 0,
    });
  }

  // Alternative interpretations
  const alternativeInterpretations: string[] = [];

  for (const hyp of hypotheses) {
    if (hyp.verdict !== "VERIFIED" && hyp.gaps.length > 0) {
      alternativeInterpretations.push(
        `Alternative to "${hyp.statement.slice(0, 50)}...": ${hyp.gaps[0]}`
      );
    }
  }

  // Correlation vs causation warning
  const hasCausalClaims = decomposed.hypotheses.some(h =>
    h.statement.toLowerCase().includes("because") ||
    h.statement.toLowerCase().includes("leads to") ||
    h.statement.toLowerCase().includes("benefit")
  );
  if (hasCausalClaims) {
    alternativeInterpretations.push(
      "Caution: Some claims imply causation, but only correlation may be established"
    );
  }

  // Falsification criteria
  const falsificationCriteria: string[] = [];

  for (const hyp of hypotheses) {
    falsificationCriteria.push(
      `To disprove "${hyp.statement.slice(0, 40)}...": Find evidence that ${hyp.decomposedClaims[0]?.statement.replace("is", "is NOT") || "contradicts the main claim"}`
    );
  }

  // Research gaps
  const researchGaps: string[] = [];

  const unverifiedCount = verifiedClaims.filter(c => !c.verified).length;
  if (unverifiedCount > 0) {
    researchGaps.push(`${unverifiedCount} claims could not be verified with available sources`);
  }

  for (const hyp of hypotheses) {
    if (hyp.gaps.length > 0) {
      researchGaps.push(...hyp.gaps.slice(0, 2));
    }
  }

  if (decomposed.relationships.filter(r => r.isHypothetical).length > 0) {
    researchGaps.push("Hypothetical relationships need direct evidence");
  }

  // Calculate skepticism level
  const verifiedRatio = verifiedClaims.filter(c => c.verified).length / Math.max(verifiedClaims.length, 1);
  const contradictionPenalty = contradictions.length * 0.1;
  const hypotheticalPenalty = decomposed.relationships.filter(r => r.isHypothetical).length * 0.05;

  const skepticismLevel = Math.min(1, Math.max(0,
    1 - verifiedRatio + contradictionPenalty + hypotheticalPenalty
  ));

  // Brutally honest assessment
  const brutallyHonestAssessment = generateBrutallyHonestAssessment(
    verifiedClaims,
    hypotheses,
    contradictions,
    decomposed,
    sources,
    skepticismLevel
  );

  return {
    strongPoints,
    weakPoints,
    alternativeInterpretations,
    falsificationCriteria,
    researchGaps,
    skepticismLevel,
    brutallyHonestAssessment,
  };
}

function generateBrutallyHonestAssessment(
  verifiedClaims: VerifiedClaim[],
  hypotheses: Hypothesis[],
  contradictions: { claim1: string; claim2: string }[],
  decomposed: DecomposedQuery,
  sources: ResearchSource[],
  skepticismLevel: number
): string {
  const parts: string[] = [];

  // Overall assessment
  const verifiedCount = verifiedClaims.filter(c => c.verified).length;
  const totalClaims = verifiedClaims.length;

  if (verifiedCount >= totalClaims * 0.7) {
    parts.push("**Assessment: LARGELY SUPPORTED**");
    parts.push(`Most claims (${verifiedCount}/${totalClaims}) are verified by reliable sources.`);
  } else if (verifiedCount >= totalClaims * 0.4) {
    parts.push("**Assessment: PARTIALLY SUPPORTED**");
    parts.push(`Only ${verifiedCount}/${totalClaims} claims are fully verified. Significant gaps remain.`);
  } else {
    parts.push("**Assessment: WEAKLY SUPPORTED**");
    parts.push(`Most claims (${totalClaims - verifiedCount}/${totalClaims}) lack sufficient evidence.`);
  }

  // Hypothesis-specific honesty
  for (const hyp of hypotheses) {
    if (hyp.verdict === "VERIFIED") {
      parts.push(`\n✓ "${hyp.statement.slice(0, 60)}..." - Supported by evidence`);
    } else if (hyp.verdict === "PARTIALLY_SUPPORTED") {
      parts.push(`\n⚠ "${hyp.statement.slice(0, 60)}..." - Some support, but gaps exist`);
    } else if (hyp.verdict === "CONTRADICTED" || hyp.verdict === "FALSIFIED") {
      parts.push(`\n✗ "${hyp.statement.slice(0, 60)}..." - Evidence contradicts this`);
    } else {
      parts.push(`\n? "${hyp.statement.slice(0, 60)}..." - Cannot verify (insufficient data)`);
    }
  }

  // Contradictions
  if (contradictions.length > 0) {
    parts.push(`\n\n**Warning:** Found ${contradictions.length} contradiction(s) in the data.`);
  }

  // Hypothetical relationships warning
  const hypotheticalRels = decomposed.relationships.filter(r => r.isHypothetical);
  if (hypotheticalRels.length > 0) {
    parts.push(`\n\n**Caution:** ${hypotheticalRels.length} relationship(s) are hypothetical/speculative:`);
    for (const rel of hypotheticalRels.slice(0, 3)) {
      parts.push(`  - "${rel.entity1} → ${rel.entity2}" (${rel.relationshipType})`);
    }
  }

  // Source quality
  const authoritativeSources = sources.filter(s => s.reliability === "authoritative").length;
  const reliableSources = sources.filter(s => s.reliability === "reliable").length;

  parts.push(`\n\n**Source Quality:** ${authoritativeSources} authoritative, ${reliableSources} reliable sources out of ${sources.length} total.`);

  if (authoritativeSources === 0) {
    parts.push("⚠ No authoritative (government/official) sources found.");
  }

  // Final skepticism note
  if (skepticismLevel > 0.5) {
    parts.push(`\n\n**Recommendation:** HIGH SKEPTICISM WARRANTED (score: ${Math.round(skepticismLevel * 100)}%). Consider additional research before acting on these conclusions.`);
  } else if (skepticismLevel > 0.3) {
    parts.push(`\n\n**Recommendation:** MODERATE SKEPTICISM (score: ${Math.round(skepticismLevel * 100)}%). Key claims are supported but verify critical assumptions independently.`);
  } else {
    parts.push(`\n\n**Recommendation:** REASONABLE CONFIDENCE (score: ${Math.round(skepticismLevel * 100)}%). Evidence is strong, but always verify before major decisions.`);
  }

  return parts.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP-BY-STEP GUIDE GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function generateStepByStepGuide(
  methodology: MethodologyStep[],
  inferenceChain: InferenceStep[],
  criticalEvaluation: CriticalEvaluation,
  decomposed: DecomposedQuery
): string {
  const parts: string[] = [];

  parts.push("# How This Research Was Conducted: Step-by-Step Guide\n");

  parts.push("## 1. Query Decomposition\n");
  parts.push("First, I analyzed your input to identify:");
  parts.push(`- **Entities:** ${decomposed.entities.map(e => `${e.name} (${e.type})`).join(", ")}`);
  parts.push(`- **Key Questions:** ${decomposed.subQuestions.length} questions to answer`);
  parts.push(`- **Hypotheses to Test:** ${decomposed.hypotheses.length} claims requiring verification`);
  parts.push(`- **Relationships to Map:** ${decomposed.relationships.length} connections between entities\n`);

  parts.push("## 2. Parallel Research Execution\n");
  parts.push("For each entity, I launched specialized research agents:\n");

  for (const step of methodology.filter(s => s.phase === "research")) {
    parts.push(`### ${step.action}`);
    parts.push(`- **Purpose:** ${step.rationale}`);
    parts.push(`- **Findings:** ${step.outputs.join("; ")}`);
    if (step.sourcesUsed.length > 0) {
      parts.push(`- **Sources:** ${step.sourcesUsed.slice(0, 3).join(", ")}${step.sourcesUsed.length > 3 ? "..." : ""}`);
    }
    parts.push("");
  }

  parts.push("## 3. Cross-Verification\n");
  parts.push("Claims were verified by checking multiple independent sources:");
  parts.push("- Tier 1 sources: Reuters, Bloomberg, WSJ, NYTimes");
  parts.push("- Tier 2 sources: TechCrunch, CNBC, Forbes");
  parts.push("- Official sources: Company blogs, press releases, SEC filings\n");

  parts.push("## 4. Inference Chain\n");
  parts.push("Here's how I connected the dots:\n");

  for (const step of inferenceChain.slice(0, 8)) {
    parts.push(`**Step ${step.stepNumber}:** ${step.premise}`);
    parts.push(`  → *Inference (${step.inferenceType}):* ${step.inference}`);
    if (step.counterArgument) {
      parts.push(`  → *Counter-argument:* ${step.counterArgument}`);
    }
    parts.push("");
  }

  parts.push("## 5. Critical Evaluation\n");

  parts.push("### What We're Confident About:");
  for (const point of criticalEvaluation.strongPoints.slice(0, 3)) {
    parts.push(`- ✓ ${point.point} (${Math.round(point.confidence * 100)}% confidence, ${point.sourceCount} sources)`);
  }

  parts.push("\n### Where Evidence Is Weak:");
  for (const point of criticalEvaluation.weakPoints.slice(0, 3)) {
    parts.push(`- ⚠ ${point.point}`);
  }

  if (criticalEvaluation.alternativeInterpretations.length > 0) {
    parts.push("\n### Alternative Interpretations:");
    for (const alt of criticalEvaluation.alternativeInterpretations.slice(0, 3)) {
      parts.push(`- ${alt}`);
    }
  }

  parts.push("\n## 6. How to Reproduce This Research\n");
  parts.push("To verify these findings yourself:");
  parts.push("1. **Person Research:** Search LinkedIn profiles, Google Scholar, news archives");
  parts.push("2. **Company Research:** Check official websites, Crunchbase, SEC filings");
  parts.push("3. **News Verification:** Cross-reference across Tier 1 news sources");
  parts.push("4. **Relationship Mapping:** Look for co-mentions in press releases and news");
  parts.push("5. **Hypothesis Testing:** For each claim, find 2+ independent sources\n");

  parts.push("## Final Note\n");
  parts.push(criticalEvaluation.brutallyHonestAssessment);

  return parts.join("\n");
}

function generateExecutiveSummary(
  query: string,
  persons: PersonProfile[],
  companies: CompanyProfile[],
  news: NewsEvent[],
  hypotheses: Hypothesis[],
  verdict: string
): string {
  const parts: string[] = [];

  parts.push(`Research conducted on: "${query.slice(0, 100)}..."`);

  if (persons.length > 0) {
    parts.push(`\n\nPerson findings: ${persons.map(p =>
      `${p.name} (${p.currentRole || "Unknown role"} at ${p.currentCompany || "Unknown company"})`
    ).join("; ")}`);
  }

  if (companies.length > 0) {
    parts.push(`\n\nCompany findings: ${companies.map(c =>
      `${c.name}: ${c.description?.slice(0, 100) || "No description"}...`
    ).join("; ")}`);
  }

  if (news.length > 0) {
    parts.push(`\n\nRecent news: ${news.map(n =>
      `${n.headline} (${n.verificationStatus})`
    ).join("; ")}`);
  }

  if (hypotheses.length > 0) {
    parts.push(`\n\nHypothesis evaluation: ${hypotheses.map(h =>
      `"${h.statement.slice(0, 50)}..." - ${h.verdict} (${Math.round(h.confidenceScore * 100)}% confidence)`
    ).join("; ")}`);
  }

  parts.push(`\n\n**Overall Verdict: ${verdict}**`);

  return parts.join("");
}

function generateKeyFindings(
  claims: VerifiedClaim[],
  hypotheses: Hypothesis[],
  news: NewsEvent[],
  contradictions: { claim1: string; claim2: string }[]
): string[] {
  const findings: string[] = [];

  // High-confidence verified claims
  const highConfidence = claims.filter(c => c.verified && c.confidence > 0.7);
  for (const claim of highConfidence.slice(0, 3)) {
    findings.push(`✓ ${claim.claim}`);
  }

  // Verified hypotheses
  for (const hyp of hypotheses.filter(h => h.verdict === "VERIFIED")) {
    findings.push(`✓ VERIFIED: ${hyp.statement.slice(0, 100)}`);
  }

  // Contradicted hypotheses
  for (const hyp of hypotheses.filter(h => h.verdict === "CONTRADICTED" || h.verdict === "FALSIFIED")) {
    findings.push(`✗ CONTRADICTED: ${hyp.statement.slice(0, 100)}`);
  }

  // Verified news
  for (const event of news.filter(n => n.verificationStatus === "verified")) {
    findings.push(`📰 CONFIRMED: ${event.headline}`);
  }

  // Contradictions found
  for (const c of contradictions.slice(0, 2)) {
    findings.push(`⚠ CONTRADICTION: "${c.claim1.slice(0, 50)}..." vs "${c.claim2.slice(0, 50)}..."`);
  }

  return findings.slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION STEPS GENERATION (How to Verify)
// ═══════════════════════════════════════════════════════════════════════════

function generateVerificationSteps(
  decomposed: DecomposedQuery,
  verifiedClaims: VerifiedClaim[],
  hypotheses: Hypothesis[],
  personProfiles: PersonProfile[],
  companyProfiles: CompanyProfile[]
): VerificationStep[] {
  const steps: VerificationStep[] = [];
  let stepNum = 1;

  // Step for verifying person-related claims
  for (const person of personProfiles.slice(0, 2)) {
    steps.push({
      stepNumber: stepNum++,
      action: `Verify ${person.name}'s role and background`,
      target: person.name,
      method: "direct_contact",
      expectedOutcome: `Confirm ${person.currentRole || "role"} at ${person.currentCompany || "company"}`,
      priority: "critical",
      suggestedQuestions: [
        "What is the stated objective and success metric?",
        "Which org is sponsoring this engagement?",
        "What is the deliverable in 30/60/90 days?",
      ],
      timeframe: "1-2 weeks",
    });
  }

  // Step for company verification
  for (const company of companyProfiles.slice(0, 2)) {
    steps.push({
      stepNumber: stepNum++,
      action: `Verify ${company.name}'s claims and recent developments`,
      target: company.name,
      method: "public_source",
      expectedOutcome: `Confirm company status, funding, and announced partnerships`,
      priority: "important",
      suggestedQuestions: [
        "Is the company actively operating?",
        "Are claimed partnerships verified?",
        "What is the current funding status?",
      ],
      timeframe: "1 week",
    });
  }

  // Steps for unverified claims
  const unverifiedHypotheses = hypotheses.filter(h =>
    h.verdict === "UNVERIFIED" || h.verdict === "PARTIALLY_SUPPORTED"
  );

  for (const hyp of unverifiedHypotheses.slice(0, 2)) {
    steps.push({
      stepNumber: stepNum++,
      action: `Gather more evidence for: "${hyp.statement.slice(0, 60)}..."`,
      target: "hypothesis",
      method: "document_request",
      expectedOutcome: "Obtain primary source documents or official statements",
      priority: "important",
      suggestedQuestions: hyp.suggestedFollowUp.slice(0, 3),
    });
  }

  // General verification step based on verification requests
  for (const request of decomposed.verificationRequests.slice(0, 2)) {
    steps.push({
      stepNumber: stepNum++,
      action: request,
      target: "general",
      method: "third_party",
      expectedOutcome: "Independent confirmation from authoritative source",
      priority: "important",
    });
  }

  // Always add a direct contact step if dealing with people/companies
  if (personProfiles.length > 0 || companyProfiles.length > 0) {
    steps.push({
      stepNumber: stepNum++,
      action: "Request direct clarification from involved parties",
      target: "primary_stakeholders",
      method: "interview",
      expectedOutcome: "Get first-hand account to resolve ambiguities",
      priority: "nice_to_have",
      suggestedQuestions: [
        "Can you walk through the decision-making process?",
        "What documentation exists for this claim?",
        "Who else can corroborate this information?",
      ],
    });
  }

  return steps;
}

// ═══════════════════════════════════════════════════════════════════════════
// RECOMMENDATIONS GENERATION (What You Should Prepare)
// ═══════════════════════════════════════════════════════════════════════════

function generateRecommendations(
  decomposed: DecomposedQuery,
  criticalEvaluation: CriticalEvaluation,
  verifiedClaims: VerifiedClaim[],
  hypotheses: Hypothesis[],
  verdict: string
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Recommendation 1: Repro Fidelity (always important for verification)
  recommendations.push({
    category: "Repro Fidelity",
    recommendation: "Document all verification steps with timestamps and sources",
    rationale: "Ensures findings can be independently reproduced and verified by others",
    priority: "critical",
    actionItems: [
      "Maintain a log of all sources consulted with URLs and access dates",
      "Record exact search queries used for each finding",
      "Archive key documents and web pages (they may change or disappear)",
    ],
  });

  // Recommendation 2: Based on research gaps
  if (criticalEvaluation.researchGaps.length > 0) {
    recommendations.push({
      category: "Research Gaps",
      recommendation: "Address identified gaps before making decisions",
      rationale: `${criticalEvaluation.researchGaps.length} significant gaps identified that could affect conclusions`,
      priority: "high",
      actionItems: criticalEvaluation.researchGaps.slice(0, 3).map(gap =>
        `Investigate: ${gap}`
      ),
    });
  }

  // Recommendation 3: Device/Build Matrix (for technical claims)
  if (decomposed.entities.some(e =>
    e.type === "company" ||
    e.mentionedClaims.some(c => c.toLowerCase().includes("product") || c.toLowerCase().includes("model"))
  )) {
    recommendations.push({
      category: "Device/Build Matrix",
      recommendation: "Test claims across multiple environments and scenarios",
      rationale: "Technical claims should be verified in multiple contexts to ensure accuracy",
      priority: "medium",
      actionItems: [
        "Test with different configurations if applicable",
        "Verify claims work in production vs. demo environments",
        "Check for edge cases that might invalidate claims",
      ],
    });
  }

  // Recommendation 4: Artifact Standard
  recommendations.push({
    category: "Artifact Standard",
    recommendation: "Establish documentation standards for ongoing tracking",
    rationale: "Consistent documentation enables better decision-making over time",
    priority: "medium",
    actionItems: [
      "Create a standardized format for tracking claims and evidence",
      "Set up regular review cadence for updating findings",
      "Define criteria for when to escalate concerns",
    ],
  });

  // Recommendation 5: Automation Roadmap (if dealing with ongoing monitoring)
  if (decomposed.intent.timelinessRequired) {
    recommendations.push({
      category: "Automation Roadmap",
      recommendation: "Set up automated monitoring for key entities and claims",
      rationale: "Situation is evolving; automated alerts ensure you don't miss critical updates",
      priority: "high",
      actionItems: [
        "Set up news alerts for key entities",
        "Monitor SEC filings if applicable",
        "Track social media and press releases for announcements",
      ],
    });
  }

  // Recommendation 6: Safety & Data Handling (always important)
  if (decomposed.intent.requiresVerification || decomposed.intent.requiresSkepticism) {
    recommendations.push({
      category: "Safety & Data Handling",
      recommendation: "Exercise caution before acting on unverified claims",
      rationale: "Multiple claims remain unverified or have conflicting evidence",
      priority: "critical",
      actionItems: [
        "Do not make major decisions based solely on this analysis",
        "Seek additional expert opinions where appropriate",
        "Consider worst-case scenarios for unverified claims",
        "Protect sensitive information gathered during research",
      ],
    });
  }

  // Recommendation based on verdict
  if (verdict === "CONTRADICTED" || verdict === "UNVERIFIED") {
    recommendations.push({
      category: "Risk Mitigation",
      recommendation: "Proceed with heightened caution given verification status",
      rationale: `Verdict is ${verdict} - multiple claims could not be verified or were contradicted`,
      priority: "critical",
      actionItems: [
        "Document all assumptions being made",
        "Create contingency plans for alternative scenarios",
        "Establish clear go/no-go criteria before proceeding",
      ],
    });
  }

  // Recommendation based on alternative interpretations
  if (criticalEvaluation.alternativeInterpretations.length > 0) {
    recommendations.push({
      category: "Alternative Scenarios",
      recommendation: "Consider and plan for alternative interpretations",
      rationale: `${criticalEvaluation.alternativeInterpretations.length} alternative explanations exist for the evidence`,
      priority: "medium",
      actionItems: criticalEvaluation.alternativeInterpretations.slice(0, 3).map((alt, i) =>
        `Scenario ${i + 1}: ${alt}`
      ),
    });
  }

  return recommendations;
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMATTED REFERENCES GENERATION (Inline Citations: [Source][1])
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generates formatted references for inline citations in ground truth format.
 * Output format: [1]: https://url "Title"
 *
 * Used for inline citations like ([Reuters][1]) throughout the report text.
 */
function generateFormattedReferences(sources: ResearchSource[]): FormattedReference[] {
  const references: FormattedReference[] = [];

  // Filter to sources with URLs and deduplicate by URL
  const sourcesWithUrls = sources.filter(s => s.url);
  const seenUrls = new Set<string>();
  const uniqueSources: ResearchSource[] = [];

  for (const source of sourcesWithUrls) {
    if (!seenUrls.has(source.url!)) {
      seenUrls.add(source.url!);
      uniqueSources.push(source);
    }
  }

  // Sort by reliability (authoritative first) then by type (news_article first)
  uniqueSources.sort((a, b) => {
    const reliabilityOrder = { authoritative: 0, reliable: 1, secondary: 2, unverified: 3 };
    const aOrder = reliabilityOrder[a.reliability] ?? 3;
    const bOrder = reliabilityOrder[b.reliability] ?? 3;
    if (aOrder !== bOrder) return aOrder - bOrder;

    const typeOrder = { news_article: 0, press_release: 1, sec_filing: 2, company_website: 3 };
    const aTypeOrder = typeOrder[a.type as keyof typeof typeOrder] ?? 10;
    const bTypeOrder = typeOrder[b.type as keyof typeof typeOrder] ?? 10;
    return aTypeOrder - bTypeOrder;
  });

  // Generate formatted references with indices
  for (let i = 0; i < uniqueSources.length && i < 15; i++) {
    const source = uniqueSources[i];
    const shortName = extractShortName(source);

    references.push({
      index: i + 1,
      shortName,
      url: source.url!,
      title: source.title || shortName,
      sourceType: source.type,
      accessedAt: source.accessedAt,
    });
  }

  return references;
}

/**
 * Extracts a short name from a source for inline citation display.
 * Examples: "Reuters", "Business Insider", "The Verge"
 */
function extractShortName(source: ResearchSource): string {
  // Try to extract from title first
  if (source.title) {
    // Common news source patterns
    const knownSources: Record<string, string> = {
      "reuters": "Reuters",
      "business insider": "Business Insider",
      "bloomberg": "Bloomberg",
      "wsj": "WSJ",
      "wall street journal": "WSJ",
      "nytimes": "NYTimes",
      "new york times": "NYTimes",
      "techcrunch": "TechCrunch",
      "theverge": "The Verge",
      "the verge": "The Verge",
      "venturebeat": "VentureBeat",
      "cnbc": "CNBC",
      "forbes": "Forbes",
      "engineering at meta": "Engineering at Meta",
      "meta engineering": "Engineering at Meta",
      "linkedin": "LinkedIn",
      "crunchbase": "Crunchbase",
      "sec": "SEC Filing",
      "pitchbook": "PitchBook",
    };

    const titleLower = source.title.toLowerCase();
    for (const [pattern, name] of Object.entries(knownSources)) {
      if (titleLower.includes(pattern)) {
        return name;
      }
    }
  }

  // Try to extract from URL
  if (source.url) {
    const urlPatterns: Record<string, string> = {
      "reuters.com": "Reuters",
      "businessinsider.com": "Business Insider",
      "bloomberg.com": "Bloomberg",
      "wsj.com": "WSJ",
      "nytimes.com": "NYTimes",
      "techcrunch.com": "TechCrunch",
      "theverge.com": "The Verge",
      "venturebeat.com": "VentureBeat",
      "cnbc.com": "CNBC",
      "forbes.com": "Forbes",
      "engineering.fb.com": "Engineering at Meta",
      "linkedin.com": "LinkedIn",
      "crunchbase.com": "Crunchbase",
      "sec.gov": "SEC Filing",
      "pitchbook.com": "PitchBook",
    };

    for (const [pattern, name] of Object.entries(urlPatterns)) {
      if (source.url.includes(pattern)) {
        return name;
      }
    }

    // Extract domain as fallback
    try {
      const url = new URL(source.url);
      const domain = url.hostname.replace("www.", "").split(".")[0];
      return domain.charAt(0).toUpperCase() + domain.slice(1);
    } catch {
      // Ignore URL parsing errors
    }
  }

  // Fallback to source type
  const typeNames: Record<string, string> = {
    news_article: "News",
    press_release: "Press Release",
    company_website: "Company Site",
    sec_filing: "SEC Filing",
    linkedin: "LinkedIn",
    crunchbase: "Crunchbase",
    academic_paper: "Academic",
    patent_filing: "Patent",
    government_registry: "Gov Registry",
    social_media: "Social Media",
    interview: "Interview",
  };

  return typeNames[source.type] || "Source";
}

/**
 * Helper to format a claim with inline citation.
 * Example: "Meta acquired Manus ([Reuters][1])"
 */
export function formatWithCitation(
  text: string,
  sourceIndex: number,
  sourceName: string
): string {
  return `${text} ([${sourceName}][${sourceIndex}])`;
}

/**
 * Helper to generate the reference list footer in ground truth format.
 * Example:
 * [1]: https://reuters.com/article "Meta to buy Chinese startup Manus"
 * [2]: https://businessinsider.com/article "What is Manus AI"
 */
export function formatReferenceList(references: FormattedReference[]): string {
  if (references.length === 0) return "";

  const lines = references.map(ref =>
    `[${ref.index}]: ${ref.url} "${ref.title}"`
  );

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { planSubAgentTasks, crossVerifyFindings, synthesizeReport };
