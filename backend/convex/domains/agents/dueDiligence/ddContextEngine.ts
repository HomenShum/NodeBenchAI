/**
 * ddContextEngine.ts
 *
 * Context Engineering for DD Agent - Industry Best Practices Implementation
 *
 * Implements patterns from:
 * - Manus: File system as memory + todo recitation + error preservation
 * - Anthropic: Subagent context isolation + summarization
 * - OpenAI: Handoff patterns + guardrails
 * - Google ADK: Dynamic planning + memory layer
 *
 * Key Features:
 * 1. DDScratchpad: Persistent working memory across branches
 * 2. Goal Recitation: Push objectives into recent attention span
 * 3. Error Preservation: Failed attempts inform future decisions
 * 4. Context Summarization: Protect orchestrator context window
 * 5. Entity Memory: Cross-job learning and fact accumulation
 */

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../../../_generated/server";
import { internal
 } from "../../../_generated/api";
import { Id, Doc } from "../../../_generated/dataModel";
import { BranchType, DDJobStatus, Contradiction, DDSource } from "./types";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Branch execution context - what each branch needs to know
 */
export interface BranchExecutionContext {
  entityName: string;
  entityType: string;
  jobId: string;
  branchType: BranchType;

  // Goal recitation - pushed to end of context for attention
  currentObjective: string;
  globalGoals: string[];

  // What we know so far (from other branches)
  priorFindings: Map<BranchType, BranchFindingSummary>;

  // Error context - what didn't work
  failedApproaches: FailedApproach[];

  // Allowed tools for this branch (action space masking)
  allowedTools: string[];

  // Token budget for this branch
  tokenBudget: number;
}

/**
 * Summarized findings from a branch (for context protection)
 */
export interface BranchFindingSummary {
  branchType: BranchType;
  status: "pending" | "running" | "completed" | "failed";
  summaryText: string;           // 2-3 sentence summary
  keyFacts: string[];            // Bullet points
  confidence: number;
  sourceCount: number;
  completedAt?: number;
}

/**
 * Preserved error for learning
 */
export interface FailedApproach {
  branchType: BranchType;
  attemptNumber: number;
  approach: string;              // What was tried
  error: string;                 // What went wrong
  timestamp: number;
  shouldAvoid: string[];         // Patterns to avoid
}

/**
 * DD Scratchpad - persistent working memory
 */
export interface DDScratchpad {
  jobId: string;
  entityName: string;
  entityType: string;

  // Current state
  phase: DDJobStatus;
  currentBranch?: BranchType;

  // Goal recitation (Manus pattern)
  globalGoals: string[];
  todoList: TodoItem[];

  // Branch progress
  branchProgress: Record<BranchType, BranchProgress>;

  // Accumulated findings (summarized)
  findingSummaries: Record<BranchType, BranchFindingSummary>;

  // Error preservation (Manus pattern)
  failedApproaches: FailedApproach[];

  // Cross-check notes
  contradictions: Contradiction[];
  workingNotes: string[];

  // Timestamps
  createdAt: number;
  updatedAt: number;
}

export interface TodoItem {
  id: string;
  task: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  branchType?: BranchType;
  blockedReason?: string;
  completedAt?: number;
}

export interface BranchProgress {
  branchType: BranchType;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: number;
  completedAt?: number;
  attemptCount: number;
  lastError?: string;
  toolCallCount: number;
  tokenUsage: number;
}

/**
 * Entity Memory - cross-job persistent facts
 */
export interface EntityMemoryEntry {
  entityName: string;
  entityType: string;

  // Accumulated verified facts
  verifiedFacts: VerifiedFact[];

  // Past DD job references
  previousJobs: PreviousDDJob[];

  // Unresolved questions from past jobs
  unresolvedQuestions: string[];

  // Known data sources that work for this entity
  reliableSources: string[];

  // Timestamps
  firstSeenAt: number;
  lastUpdatedAt: number;
}

export interface VerifiedFact {
  fact: string;
  category: string;
  verifiedAt: number;
  source: string;
  confidence: number;
  jobId: string;
}

export interface PreviousDDJob {
  jobId: string;
  completedAt: number;
  verdict: string;
  overallConfidence: number;
  keyFindings: string[];
}

// ============================================================================
// GOAL RECITATION (Manus Pattern)
// ============================================================================

/**
 * Generate goal recitation block for branch context
 * This gets appended to the END of the prompt to push into recent attention
 */
export function generateGoalRecitation(
  scratchpad: DDScratchpad,
  branchType: BranchType
): string {
  const pendingTodos = scratchpad.todoList.filter(t => t.status !== "completed");
  const currentTodo = pendingTodos.find(t => t.branchType === branchType);

  return `
<!-- [GOAL RECITATION - DO NOT IGNORE] -->
## Current Objectives

**Entity:** ${scratchpad.entityName} (${scratchpad.entityType})
**Phase:** ${scratchpad.phase}
**Current Branch:** ${branchType}

### Global Goals:
${scratchpad.globalGoals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

### Current Task:
${currentTodo ? `→ ${currentTodo.task}` : "Complete branch research"}

### Pending Tasks:
${pendingTodos.slice(0, 5).map(t => `- [${t.status}] ${t.task}`).join("\n")}

### What We Know So Far:
${Object.entries(scratchpad.findingSummaries)
  .filter(([_, s]) => s.status === "completed")
  .map(([branch, summary]) => `- ${branch}: ${summary.summaryText}`)
  .join("\n") || "No completed branches yet"}

### Avoid These Approaches (Failed Previously):
${scratchpad.failedApproaches
  .filter(f => f.branchType === branchType)
  .map(f => `- ${f.approach}: ${f.error}`)
  .join("\n") || "None"}

**Remember:** Complete your assigned task thoroughly. Cite sources. Flag uncertainties.
<!-- [END GOAL RECITATION] -->
`;
}

// ============================================================================
// CONTEXT SUMMARIZATION (Anthropic Pattern)
// ============================================================================

/**
 * Summarize branch findings for orchestrator context protection
 * Reduces full findings to compact summary that preserves key info
 */
export function summarizeBranchFindings(
  branchType: BranchType,
  findings: any,
  sources: DDSource[],
  confidence: number
): BranchFindingSummary {
  let summaryText = "";
  const keyFacts: string[] = [];

  switch (branchType) {
    case "company_profile":
      summaryText = `${findings.description?.slice(0, 150) || "Company profile gathered"}. ` +
        `Sectors: ${findings.sectors?.join(", ") || "Unknown"}. ` +
        `Stage: ${findings.stage || "Unknown"}.`;
      if (findings.foundedYear) keyFacts.push(`Founded: ${findings.foundedYear}`);
      if (findings.employeeCount) keyFacts.push(`Employees: ${findings.employeeCount}`);
      if (findings.hqLocation) keyFacts.push(`HQ: ${findings.hqLocation}`);
      if (findings.keyProducts?.length) keyFacts.push(`Products: ${findings.keyProducts.slice(0, 3).join(", ")}`);
      break;

    case "team_founders":
      const founderCount = findings.founders?.length || 0;
      const execCount = findings.executives?.length || 0;
      summaryText = `Team of ${findings.teamSize || founderCount + execCount} identified. ` +
        `${founderCount} founders, ${execCount} executives. ` +
        `${findings.hasSerialFounders ? "Has serial founders. " : ""}` +
        `${findings.trackRecordSummary || ""}`;
      if (findings.teamStrengths?.length) keyFacts.push(`Strengths: ${findings.teamStrengths.slice(0, 2).join(", ")}`);
      if (findings.teamGaps?.length) keyFacts.push(`Gaps: ${findings.teamGaps.slice(0, 2).join(", ")}`);
      findings.founders?.slice(0, 3).forEach((f: any) => keyFacts.push(`Founder: ${f.name} - ${f.currentRole}`));
      break;

    case "market_competitive":
      const competitorCount = findings.competitors?.length || 0;
      summaryText = `Market TAM: ${findings.marketSize?.tam || "Unknown"}. ` +
        `${competitorCount} competitors identified. ` +
        `Growth: ${findings.marketGrowth || "Unknown"}. ` +
        `${findings.whyNow || ""}`;
      if (findings.differentiators?.length) keyFacts.push(`Differentiators: ${findings.differentiators.slice(0, 2).join(", ")}`);
      if (findings.tailwinds?.length) keyFacts.push(`Tailwinds: ${findings.tailwinds.slice(0, 2).join(", ")}`);
      findings.competitors?.slice(0, 3).forEach((c: any) => keyFacts.push(`Competitor: ${c.name} (${c.threat} threat)`));
      break;

    case "technical_dd":
      summaryText = `Tech stack: ${findings.techStack?.slice(0, 5).join(", ") || "Unknown"}. ` +
        `Architecture: ${findings.architecture || "Unknown"}. ` +
        `Scalability: ${findings.scalability || "Unknown"}.`;
      if (findings.repoStats) keyFacts.push(`GitHub: ${findings.repoStats.stars} stars, ${findings.repoStats.contributors} contributors`);
      if (findings.securityPosture?.certifications?.length) keyFacts.push(`Security: ${findings.securityPosture.certifications.join(", ")}`);
      break;

    case "ip_patents":
      const patentCount = findings.patents?.length || 0;
      summaryText = `${patentCount} patents identified. ` +
        `${findings.pendingApplications || 0} pending applications. ` +
        `Defensibility: ${findings.defensibility || "Unknown"}.`;
      if (findings.trademarks?.length) keyFacts.push(`Trademarks: ${findings.trademarks.slice(0, 3).join(", ")}`);
      if (findings.ipRisks?.length) keyFacts.push(`IP Risks: ${findings.ipRisks.slice(0, 2).join(", ")}`);
      break;

    case "regulatory":
      summaryText = `Regulatory body: ${findings.regulatoryBody || "N/A"}. ` +
        `Status: ${findings.currentStatus || "Unknown"}. ` +
        `${findings.approvals?.length || 0} approvals, ${findings.pendingApprovals?.length || 0} pending.`;
      if (findings.complianceRisks?.length) keyFacts.push(`Compliance risks: ${findings.complianceRisks.slice(0, 2).join(", ")}`);
      if (findings.timeToApproval) keyFacts.push(`Time to approval: ${findings.timeToApproval}`);
      break;

    case "financial_deep":
      const roundCount = findings.fundingHistory?.length || 0;
      const totalRaised = findings.totalRaised
        ? `${findings.totalRaised.amount}${findings.totalRaised.unit}`
        : "Unknown";
      summaryText = `Total raised: ${totalRaised} across ${roundCount} rounds. ` +
        `Burn rate: ${findings.burnRate || "Unknown"}. ` +
        `Runway: ${findings.runway || "Unknown"}.`;
      findings.fundingHistory?.slice(0, 3).forEach((r: any) =>
        keyFacts.push(`${r.roundType}: ${r.amount || "Undisclosed"} (${r.date || "Unknown date"})`)
      );
      break;

    case "network_mapping":
      const connectionCount = findings.keyConnections?.length || 0;
      summaryText = `${connectionCount} key connections mapped. ` +
        `Investor network: ${findings.investorNetwork?.length || 0} investors. ` +
        `Referenceability: ${Math.round((findings.referenceability || 0) * 100)}%.`;
      if (findings.potentialConflicts?.length) keyFacts.push(`Conflicts: ${findings.potentialConflicts.slice(0, 2).join(", ")}`);
      break;

    default:
      summaryText = `${branchType} branch completed with ${sources.length} sources.`;
  }

  return {
    branchType,
    status: "completed",
    summaryText,
    keyFacts: keyFacts.slice(0, 8),
    confidence,
    sourceCount: sources.length,
    completedAt: Date.now(),
  };
}

// ============================================================================
// ERROR PRESERVATION (Manus Pattern)
// ============================================================================

/**
 * Record a failed approach for future reference
 * Manus: "Leaves wrong turns in context" for implicit belief updates
 */
export function createFailedApproach(
  branchType: BranchType,
  attemptNumber: number,
  approach: string,
  error: string
): FailedApproach {
  // Extract patterns to avoid from error
  const shouldAvoid: string[] = [];

  if (error.includes("rate limit")) {
    shouldAvoid.push("rapid successive API calls");
  }
  if (error.includes("timeout")) {
    shouldAvoid.push("long-running queries without pagination");
  }
  if (error.includes("not found") || error.includes("404")) {
    shouldAvoid.push(`querying ${approach.split(" ")[0]} directly`);
  }
  if (error.includes("invalid") || error.includes("malformed")) {
    shouldAvoid.push("unvalidated data extraction");
  }
  if (error.includes("authentication") || error.includes("unauthorized")) {
    shouldAvoid.push("accessing protected resources without credentials");
  }

  return {
    branchType,
    attemptNumber,
    approach,
    error: error.slice(0, 500), // Truncate long errors
    timestamp: Date.now(),
    shouldAvoid,
  };
}

/**
 * Generate error context for branch prompt
 * Helps model avoid repeating mistakes
 */
export function generateErrorContext(
  failedApproaches: FailedApproach[],
  branchType: BranchType
): string {
  const relevantErrors = failedApproaches.filter(f => f.branchType === branchType);

  if (relevantErrors.length === 0) {
    return "";
  }

  return `
## Previous Attempts (Learn From Failures)

${relevantErrors.map((err, i) => `
### Attempt ${err.attemptNumber}
- **Approach:** ${err.approach}
- **Error:** ${err.error}
- **Avoid:** ${err.shouldAvoid.join(", ") || "N/A"}
`).join("\n")}

**Important:** Do not repeat these approaches. Try alternative methods.
`;
}

// ============================================================================
// ACTION SPACE MASKING (Manus Pattern)
// ============================================================================

/**
 * Define allowed tools per branch type
 * Constrains what each branch can do (cleaner tool usage)
 */
export const BRANCH_ALLOWED_TOOLS: Record<BranchType, string[]> = {
  company_profile: [
    "fusionSearch",
    "entityContexts.getByName",
    "crunchbase_lookup",
    "linkedin_company",
    "web_scrape",
  ],
  team_founders: [
    "fusionSearch",
    "entityContexts.getByName",
    "linkedin_person",
    "sec_insider_search",
    "patent_inventor_search",
    "generateText", // For extraction
  ],
  market_competitive: [
    "fusionSearch",
    "entityContexts.getByName",
    "crunchbase_search",
    "market_research",
    "generateText", // For competitor extraction
  ],
  technical_dd: [
    "fusionSearch",
    "github_repo",
    "github_org",
    "stackoverflow_search",
    "cve_search",
  ],
  ip_patents: [
    "fusionSearch",
    "uspto_search",
    "patent_search",
    "trademark_search",
    "google_patents",
  ],
  regulatory: [
    "fusionSearch",
    "sec_edgar_search",
    "fda_search",
    "finra_search",
    "state_registry_search",
  ],
  financial_deep: [
    "fusionSearch",
    "entityContexts.getByName",
    "sec_filings",
    "crunchbase_funding",
    "pitchbook_lookup",
  ],
  network_mapping: [
    "fusionSearch",
    "entityContexts.getByName",
    "linkedin_connections",
    "board_overlap_search",
    "investor_portfolio_search",
  ],
};

/**
 * Check if a tool call is allowed for a branch
 */
export function isToolAllowed(branchType: BranchType, toolName: string): boolean {
  const allowed = BRANCH_ALLOWED_TOOLS[branchType];
  return allowed.some(t => toolName.includes(t) || t.includes(toolName));
}

// ============================================================================
// ENTITY MEMORY (mem0 / Google ADK Pattern)
// ============================================================================

/**
 * Build entity memory key
 */
function getEntityMemoryKey(entityName: string): string {
  return `dd:entity:${entityName.toLowerCase().replace(/\s+/g, "_")}`;
}

/**
 * Accumulate verified facts from a completed DD job
 */
export function extractVerifiedFacts(
  jobId: string,
  branchResults: Array<{ branchType: BranchType; findings: any; confidence?: number; sources: DDSource[] }>
): VerifiedFact[] {
  const facts: VerifiedFact[] = [];
  const now = Date.now();

  for (const result of branchResults) {
    if (!result.findings || (result.confidence ?? 0) < 0.6) continue;

    const { branchType, findings, confidence = 0.5, sources } = result;
    const source = sources[0]?.url || sources[0]?.title || branchType;

    // Extract high-confidence facts based on branch type
    switch (branchType) {
      case "company_profile":
        if (findings.foundedYear) {
          facts.push({
            fact: `Founded in ${findings.foundedYear}`,
            category: "founding",
            verifiedAt: now,
            source,
            confidence,
            jobId,
          });
        }
        if (findings.hqLocation) {
          facts.push({
            fact: `Headquartered in ${findings.hqLocation}`,
            category: "location",
            verifiedAt: now,
            source,
            confidence,
            jobId,
          });
        }
        findings.sectors?.forEach((sector: string) => {
          facts.push({
            fact: `Operates in ${sector} sector`,
            category: "sector",
            verifiedAt: now,
            source,
            confidence,
            jobId,
          });
        });
        break;

      case "team_founders":
        findings.founders?.forEach((founder: any) => {
          if (founder.name && founder.currentRole) {
            facts.push({
              fact: `${founder.name} is ${founder.currentRole}`,
              category: "team",
              verifiedAt: now,
              source: founder.linkedinUrl || source,
              confidence,
              jobId,
            });
          }
        });
        break;

      case "financial_deep":
        if (findings.totalRaised) {
          facts.push({
            fact: `Total funding raised: ${findings.totalRaised.amount}${findings.totalRaised.unit}`,
            category: "funding",
            verifiedAt: now,
            source,
            confidence,
            jobId,
          });
        }
        findings.fundingHistory?.forEach((round: any) => {
          if (round.roundType && round.amount) {
            facts.push({
              fact: `${round.roundType}: ${round.amount} (${round.date || "date unknown"})`,
              category: "funding_round",
              verifiedAt: now,
              source: round.source || source,
              confidence: round.verified ? confidence : confidence * 0.8,
              jobId,
            });
          }
        });
        break;

      case "ip_patents":
        findings.patents?.forEach((patent: any) => {
          facts.push({
            fact: `Patent: ${patent.patentId} - ${patent.title}`,
            category: "ip",
            verifiedAt: now,
            source: patent.usptoUrl || source,
            confidence: patent.verified ? 0.95 : confidence,
            jobId,
          });
        });
        break;
    }
  }

  return facts;
}

// ============================================================================
// SCRATCHPAD MUTATIONS (Convex)
// ============================================================================

export const createDDScratchpad = internalMutation({
  args: {
    jobId: v.string(),
    entityName: v.string(),
    entityType: v.string(),
    branches: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Initialize branch progress
    const branchProgress: Record<string, any> = {};
    for (const branch of args.branches) {
      branchProgress[branch] = {
        branchType: branch,
        status: "pending",
        attemptCount: 0,
        toolCallCount: 0,
        tokenUsage: 0,
      };
    }

    // Generate global goals
    const globalGoals = [
      `Complete thorough due diligence on ${args.entityName}`,
      `Verify all findings with authoritative sources`,
      `Identify risks, contradictions, and data gaps`,
      `Synthesize findings into actionable investment memo`,
    ];

    // Generate todo list
    const todoList: TodoItem[] = args.branches.map((branch: string, i: number) => ({
      id: `todo-${i}`,
      task: `Complete ${branch.replace(/_/g, " ")} research`,
      status: "pending" as const,
      branchType: branch as BranchType,
    }));

    todoList.push({
      id: `todo-${args.branches.length}`,
      task: "Cross-check findings for contradictions",
      status: "pending",
    });

    todoList.push({
      id: `todo-${args.branches.length + 1}`,
      task: "Synthesize investment memo",
      status: "pending",
    });

    const scratchpad: DDScratchpad = {
      jobId: args.jobId,
      entityName: args.entityName,
      entityType: args.entityType,
      phase: "pending",
      globalGoals,
      todoList,
      branchProgress,
      findingSummaries: {} as Record<BranchType, BranchFindingSummary>,
      failedApproaches: [],
      contradictions: [],
      workingNotes: [],
      createdAt: now,
      updatedAt: now,
    };

    // Store in agentScratchpads table
    await ctx.db.insert("agentScratchpads", {
      userId: "system" as any, // DD jobs run system-side
      agentThreadId: `dd-${args.jobId}`,
      scratchpad: scratchpad as any,
      createdAt: now,
      updatedAt: now,
    });

    return scratchpad;
  },
});

export const updateDDScratchpad = internalMutation({
  args: {
    jobId: v.string(),
    updates: v.any(),
  },
  handler: async (ctx, { jobId, updates }) => {
    const existing = await ctx.db
      .query("agentScratchpads")
      .withIndex("by_agent_thread", (q) => q.eq("agentThreadId", `dd-${jobId}`))
      .first() as Doc<"agentScratchpads"> | null;

    if (!existing) {
      throw new Error(`Scratchpad not found for job ${jobId}`);
    }

    const currentScratchpad = existing.scratchpad as DDScratchpad;
    const updatedScratchpad = {
      ...currentScratchpad,
      ...updates,
      updatedAt: Date.now(),
    };

    await ctx.db.patch(existing._id, {
      scratchpad: updatedScratchpad as any,
      updatedAt: Date.now(),
    });

    return updatedScratchpad;
  },
});

export const getDDScratchpad = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const existing = await ctx.db
      .query("agentScratchpads")
      .withIndex("by_agent_thread", (q) => q.eq("agentThreadId", `dd-${jobId}`))
      .first() as Doc<"agentScratchpads"> | null;

    return existing?.scratchpad as DDScratchpad | null;
  },
});

export const recordFailedApproach = internalMutation({
  args: {
    jobId: v.string(),
    branchType: v.string(),
    attemptNumber: v.number(),
    approach: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentScratchpads")
      .withIndex("by_agent_thread", (q) => q.eq("agentThreadId", `dd-${args.jobId}`))
      .first() as Doc<"agentScratchpads"> | null;

    if (!existing) return;

    const scratchpad = existing.scratchpad as DDScratchpad;
    const failedApproach = createFailedApproach(
      args.branchType as BranchType,
      args.attemptNumber,
      args.approach,
      args.error
    );

    scratchpad.failedApproaches.push(failedApproach);
    scratchpad.updatedAt = Date.now();

    await ctx.db.patch(existing._id, {
      scratchpad: scratchpad as any,
      updatedAt: Date.now(),
    });
  },
});

export const recordBranchSummary = internalMutation({
  args: {
    jobId: v.string(),
    branchType: v.string(),
    findings: v.any(),
    sources: v.array(v.any()),
    confidence: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentScratchpads")
      .withIndex("by_agent_thread", (q) => q.eq("agentThreadId", `dd-${args.jobId}`))
      .first() as Doc<"agentScratchpads"> | null;

    if (!existing) return;

    const scratchpad = existing.scratchpad as DDScratchpad;
    const branchType = args.branchType as BranchType;
    const summary = summarizeBranchFindings(
      branchType,
      args.findings,
      args.sources as DDSource[],
      args.confidence
    );

    scratchpad.findingSummaries[branchType] = summary;

    // Update branch progress
    if (scratchpad.branchProgress[branchType]) {
      scratchpad.branchProgress[branchType].status = "completed";
      scratchpad.branchProgress[branchType].completedAt = Date.now();
    }

    // Update todo list
    const todo = scratchpad.todoList.find(t => t.branchType === args.branchType);
    if (todo) {
      todo.status = "completed";
      todo.completedAt = Date.now();
    }

    scratchpad.updatedAt = Date.now();

    await ctx.db.patch(existing._id, {
      scratchpad: scratchpad as any,
      updatedAt: Date.now(),
    });
  },
});

// ============================================================================
// ENTITY MEMORY MUTATIONS (Convex)
// ============================================================================

export const getEntityMemory = internalQuery({
  args: { entityName: v.string() },
  handler: async (ctx, { entityName }) => {
    const key = getEntityMemoryKey(entityName);

    const entry = await ctx.db
      .query("mcpMemoryEntries")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first() as Doc<"mcpMemoryEntries"> | null;

    if (!entry) return null;

    try {
      return JSON.parse(entry.content) as EntityMemoryEntry;
    } catch {
      return null;
    }
  },
});

export const updateEntityMemory = internalMutation({
  args: {
    entityName: v.string(),
    entityType: v.string(),
    jobId: v.string(),
    verdict: v.string(),
    overallConfidence: v.number(),
    keyFindings: v.array(v.string()),
    verifiedFacts: v.array(v.any()),
    unresolvedQuestions: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const key = getEntityMemoryKey(args.entityName);
    const now = Date.now();

    // Get existing memory
    const existing = await ctx.db
      .query("mcpMemoryEntries")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first() as Doc<"mcpMemoryEntries"> | null;

    let memory: EntityMemoryEntry;

    if (existing) {
      try {
        memory = JSON.parse(existing.content);
      } catch {
        memory = {
          entityName: args.entityName,
          entityType: args.entityType,
          verifiedFacts: [],
          previousJobs: [],
          unresolvedQuestions: [],
          reliableSources: [],
          firstSeenAt: now,
          lastUpdatedAt: now,
        };
      }
    } else {
      memory = {
        entityName: args.entityName,
        entityType: args.entityType,
        verifiedFacts: [],
        previousJobs: [],
        unresolvedQuestions: [],
        reliableSources: [],
        firstSeenAt: now,
        lastUpdatedAt: now,
      };
    }

    // Add job reference
    memory.previousJobs.push({
      jobId: args.jobId,
      completedAt: now,
      verdict: args.verdict,
      overallConfidence: args.overallConfidence,
      keyFindings: args.keyFindings,
    });

    // Merge verified facts (deduplicate)
    const existingFactTexts = new Set(memory.verifiedFacts.map(f => f.fact.toLowerCase()));
    for (const fact of args.verifiedFacts as VerifiedFact[]) {
      if (!existingFactTexts.has(fact.fact.toLowerCase())) {
        memory.verifiedFacts.push(fact);
        existingFactTexts.add(fact.fact.toLowerCase());
      }
    }

    // Keep only last 100 facts
    if (memory.verifiedFacts.length > 100) {
      memory.verifiedFacts = memory.verifiedFacts
        .sort((a, b) => b.verifiedAt - a.verifiedAt)
        .slice(0, 100);
    }

    // Keep only last 10 jobs
    if (memory.previousJobs.length > 10) {
      memory.previousJobs = memory.previousJobs
        .sort((a, b) => b.completedAt - a.completedAt)
        .slice(0, 10);
    }

    // Update unresolved questions
    if (args.unresolvedQuestions) {
      memory.unresolvedQuestions = args.unresolvedQuestions;
    }

    memory.lastUpdatedAt = now;

    // Upsert
    if (existing) {
      await ctx.db.patch(existing._id, {
        content: JSON.stringify(memory),
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("mcpMemoryEntries", {
        key,
        content: JSON.stringify(memory),
        createdAt: now,
        updatedAt: now,
      });
    }

    return memory;
  },
});

// ============================================================================
// CACHE-OPTIMIZED PROMPT BUILDER
// ============================================================================

/**
 * Build cache-optimized system prompt for DD branches
 * Uses stable prefix for KV-cache hits (Manus pattern)
 */
export function buildDDBranchSystemPrompt(
  branchType: BranchType,
  entityName: string,
  entityType: string
): string {
  // STATIC PREFIX (cached across all requests)
  const staticPrefix = `You are a Due Diligence Research Agent specialized in investment analysis.

Your role is to gather, verify, and synthesize information for investment decisions.

## Core Principles
1. ALWAYS cite sources with URLs when available
2. Flag confidence levels explicitly (high/medium/low)
3. Note data gaps and uncertainties
4. Cross-reference multiple sources when possible
5. Prefer authoritative sources (SEC, USPTO, FDA) over secondary sources

## Source Reliability Hierarchy
- Authoritative: SEC filings, USPTO patents, FDA databases, court records
- Reliable: LinkedIn, Crunchbase, Bloomberg, Reuters, WSJ, TechCrunch
- Secondary: News articles, press releases, company websites
- Inferred: LLM analysis (flag as inference)

## Output Format
Always structure findings with:
- Key facts (bullet points)
- Sources (URLs or citations)
- Confidence assessment
- Data gaps identified
`;

  // SEMI-STATIC (cached per branch type)
  const branchInstructions = getBranchInstructions(branchType);

  // DYNAMIC (per-request, not cached)
  const dynamicContext = `
## Current Assignment
- Entity: ${entityName}
- Type: ${entityType}
- Branch: ${branchType}
`;

  return staticPrefix + "\n" + branchInstructions + "\n" + dynamicContext;
}

function getBranchInstructions(branchType: BranchType): string {
  const instructions: Record<BranchType, string> = {
    company_profile: `
## Company Profile Branch Instructions
Focus on extracting:
- Company description and value proposition
- Founding date, headquarters location
- Employee count and growth
- Key products/services
- Business model
- Recent milestones and news
- Social media presence`,

    team_founders: `
## Team & Founders Branch Instructions
Focus on extracting:
- Founder names, roles, and backgrounds
- Executive team composition
- Board members and advisors
- Career history and track records
- Previous exits or notable achievements
- Education and domain expertise
- Team strengths and gaps
- Key person dependencies`,

    market_competitive: `
## Market & Competitive Branch Instructions
Focus on extracting:
- Total Addressable Market (TAM/SAM/SOM)
- Market growth rate and trends
- Key competitors and their positioning
- Competitive differentiators
- Market timing ("Why Now?")
- Tailwinds and headwinds
- Barriers to entry`,

    technical_dd: `
## Technical Due Diligence Branch Instructions
Focus on extracting:
- Technology stack and architecture
- Scalability assessment
- Security posture and certifications
- Open source contributions
- Technical debt indicators
- Engineering team quality signals`,

    ip_patents: `
## IP & Patents Branch Instructions
Focus on extracting:
- Patent portfolio (numbers, titles, status)
- Pending applications
- Trademark registrations
- IP defensibility assessment
- Freedom to operate concerns
- Competitor IP overlap`,

    regulatory: `
## Regulatory Branch Instructions
Focus on extracting:
- Applicable regulatory bodies
- Current regulatory status
- Filed applications and approvals
- Compliance requirements
- Regulatory risks
- Timeline to approvals`,

    financial_deep: `
## Financial Deep Dive Branch Instructions
Focus on extracting:
- Complete funding history (rounds, amounts, dates)
- Lead investors per round
- Valuation trajectory
- Burn rate and runway
- Revenue and growth metrics
- Unit economics if available
- Comparable valuations`,

    network_mapping: `
## Network Mapping Branch Instructions
Focus on extracting:
- Investor relationships and portfolios
- Board network overlaps
- Advisor connections
- Co-founder history
- Reference paths
- Potential conflicts of interest`,
  };

  return instructions[branchType] || "";
}

// ============================================================================
// GUARDRAILS (OpenAI Pattern)
// ============================================================================

export interface GuardrailResult {
  passed: boolean;
  issues: string[];
  warnings: string[];
}

/**
 * Input validation guardrail
 */
export function validateDDInput(
  entityName: string,
  entityType: string
): GuardrailResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Check entity name
  if (!entityName || entityName.trim().length < 2) {
    issues.push("Entity name is too short or empty");
  }
  if (entityName.length > 200) {
    issues.push("Entity name is too long (max 200 chars)");
  }

  // Check for potential prompt injection
  const injectionPatterns = [
    /ignore\s+(previous|above|all)/i,
    /system\s*prompt/i,
    /\[INST\]/i,
    /<\/?(?:system|user|assistant)>/i,
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(entityName)) {
      issues.push("Entity name contains suspicious patterns");
      break;
    }
  }

  // Check entity type
  const validTypes = ["company", "fund", "person"];
  if (!validTypes.includes(entityType)) {
    issues.push(`Invalid entity type: ${entityType}`);
  }

  // Warnings
  if (entityName.includes("test") || entityName.includes("example")) {
    warnings.push("Entity name appears to be a test entry");
  }

  return {
    passed: issues.length === 0,
    issues,
    warnings,
  };
}

/**
 * Output validation guardrail
 */
export function validateDDOutput(
  findings: any,
  sources: DDSource[],
  branchType: BranchType
): GuardrailResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Check for empty findings
  if (!findings || Object.keys(findings).length === 0) {
    issues.push("Findings are empty");
  }

  // Check for source citations
  if (sources.length === 0) {
    issues.push("No sources provided");
  }

  // Check for authoritative sources in critical branches
  const criticalBranches: BranchType[] = ["financial_deep", "ip_patents", "regulatory"];
  if (criticalBranches.includes(branchType)) {
    const hasAuthoritative = sources.some(s => s.reliability === "authoritative");
    if (!hasAuthoritative) {
      warnings.push(`No authoritative sources for ${branchType} branch`);
    }
  }

  // Check for hallucination indicators
  if (findings.description?.includes("I don't have") ||
      findings.description?.includes("As an AI") ||
      findings.description?.includes("I cannot")) {
    issues.push("Findings contain LLM refusal patterns");
  }

  // Check confidence bounds
  const confidence = findings.confidence;
  if (confidence !== undefined && (confidence < 0 || confidence > 1)) {
    issues.push("Confidence score out of bounds");
  }

  return {
    passed: issues.length === 0,
    issues,
    warnings,
  };
}

/**
 * Rate limiting guardrail
 */
export interface RateLimitState {
  toolCalls: number;
  tokensUsed: number;
  apiCalls: number;
  lastReset: number;
}

export const RATE_LIMITS = {
  maxToolCallsPerBranch: 20,
  maxTokensPerBranch: 50000,
  maxApiCallsPerBranch: 10,
  resetIntervalMs: 60000, // 1 minute
};

export function checkRateLimit(
  state: RateLimitState,
  increment: { tools?: number; tokens?: number; api?: number }
): GuardrailResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Reset if interval passed
  if (Date.now() - state.lastReset > RATE_LIMITS.resetIntervalMs) {
    state.toolCalls = 0;
    state.tokensUsed = 0;
    state.apiCalls = 0;
    state.lastReset = Date.now();
  }

  // Check limits
  const newToolCalls = state.toolCalls + (increment.tools || 0);
  const newTokens = state.tokensUsed + (increment.tokens || 0);
  const newApiCalls = state.apiCalls + (increment.api || 0);

  if (newToolCalls > RATE_LIMITS.maxToolCallsPerBranch) {
    issues.push(`Tool call limit exceeded (${newToolCalls}/${RATE_LIMITS.maxToolCallsPerBranch})`);
  } else if (newToolCalls > RATE_LIMITS.maxToolCallsPerBranch * 0.8) {
    warnings.push(`Approaching tool call limit (${newToolCalls}/${RATE_LIMITS.maxToolCallsPerBranch})`);
  }

  if (newTokens > RATE_LIMITS.maxTokensPerBranch) {
    issues.push(`Token limit exceeded (${newTokens}/${RATE_LIMITS.maxTokensPerBranch})`);
  }

  if (newApiCalls > RATE_LIMITS.maxApiCallsPerBranch) {
    issues.push(`API call limit exceeded (${newApiCalls}/${RATE_LIMITS.maxApiCallsPerBranch})`);
  }

  // Update state
  state.toolCalls = newToolCalls;
  state.tokensUsed = newTokens;
  state.apiCalls = newApiCalls;

  return {
    passed: issues.length === 0,
    issues,
    warnings,
  };
}
