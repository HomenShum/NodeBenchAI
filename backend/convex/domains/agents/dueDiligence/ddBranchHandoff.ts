/**
 * ddBranchHandoff.ts
 *
 * Branch Handoff System - OpenAI Agents SDK Pattern Implementation
 *
 * Enables dynamic routing between branches based on findings:
 * - team_founders discovers serial founder → handoff to network_mapping
 * - company_profile detects biotech → handoff to regulatory
 * - financial_deep finds SEC filings → handoff to regulatory
 *
 * Key Features:
 * 1. Trigger-based handoffs (pattern matching on findings)
 * 2. Context passing between branches
 * 3. Priority queue for spawned branches
 * 4. Circular dependency prevention
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { BranchType, CONDITIONAL_BRANCHES, ComplexitySignals } from "./types";

// ============================================================================
// HANDOFF TYPES
// ============================================================================

export interface BranchHandoff {
  id: string;
  from: BranchType;
  to: BranchType;
  reason: string;
  priority: "high" | "normal" | "low";
  context: HandoffContext;
  status: "pending" | "accepted" | "rejected" | "completed";
  createdAt: number;
  processedAt?: number;
}

export interface HandoffContext {
  // What triggered this handoff
  trigger: string;
  triggerValue: any;

  // Relevant data to pass
  relevantFindings: Record<string, any>;

  // Specific focus areas for target branch
  focusAreas: string[];

  // Questions to answer
  questionsToAnswer: string[];
}

export interface HandoffTrigger {
  from: BranchType;
  to: BranchType;
  condition: (findings: any) => boolean;
  reason: (findings: any) => string;
  contextBuilder: (findings: any) => HandoffContext;
  priority: "high" | "normal" | "low";
}

// ============================================================================
// HANDOFF TRIGGER DEFINITIONS
// ============================================================================

export const HANDOFF_TRIGGERS: HandoffTrigger[] = [
  // Team → Network Mapping (serial founders need network analysis)
  {
    from: "team_founders",
    to: "network_mapping",
    condition: (findings) =>
      findings.hasSerialFounders === true ||
      findings.hasVCBackedFounders === true ||
      (findings.founders?.length > 0 &&
        findings.founders.some((f: any) =>
          f.trackRecord?.successfulExits > 0
        )),
    reason: (findings) =>
      findings.hasSerialFounders
        ? "Serial founder detected - need network analysis for investor connections"
        : "VC-backed founders detected - map investor relationships",
    contextBuilder: (findings) => ({
      trigger: "serial_or_vc_founders",
      triggerValue: {
        hasSerialFounders: findings.hasSerialFounders,
        hasVCBackedFounders: findings.hasVCBackedFounders,
      },
      relevantFindings: {
        founders: findings.founders?.map((f: any) => ({
          name: f.name,
          role: f.currentRole,
          trackRecord: f.trackRecord,
          boardSeats: f.boardSeats,
        })),
        executives: findings.executives?.map((e: any) => ({
          name: e.name,
          role: e.currentRole,
        })),
      },
      focusAreas: [
        "Map investor relationships for each founder",
        "Identify board network overlaps",
        "Find reference paths through known connections",
        "Detect potential conflicts of interest",
      ],
      questionsToAnswer: [
        "Who are the common investors across founder companies?",
        "Are there concerning board overlaps?",
        "How referenceable is this team?",
      ],
    }),
    priority: "normal",
  },

  // Company Profile → Regulatory (sector-based)
  {
    from: "company_profile",
    to: "regulatory",
    condition: (findings) => {
      const regulatedSectors = [
        "Biotech",
        "Pharma",
        "HealthTech",
        "Fintech",
        "Insurance",
        "Banking",
        "Crypto",
        "MedTech",
        "FoodTech",
      ];
      return findings.sectors?.some((s: string) =>
        regulatedSectors.some((rs) =>
          s.toLowerCase().includes(rs.toLowerCase())
        )
      );
    },
    reason: (findings) =>
      `Regulated sector detected (${findings.sectors?.join(", ")}) - need regulatory analysis`,
    contextBuilder: (findings) => ({
      trigger: "regulated_sector",
      triggerValue: findings.sectors,
      relevantFindings: {
        sectors: findings.sectors,
        description: findings.description,
        keyProducts: findings.keyProducts,
        stage: findings.stage,
      },
      focusAreas: [
        "Identify applicable regulatory bodies (FDA, SEC, etc.)",
        "Check for existing approvals or filings",
        "Assess compliance requirements",
        "Estimate timeline to regulatory clearance",
      ],
      questionsToAnswer: [
        "What regulatory approvals are needed?",
        "What is the current regulatory status?",
        "What are the key compliance risks?",
      ],
    }),
    priority: "high",
  },

  // Company Profile → IP/Patents (tech/biotech indicators)
  {
    from: "company_profile",
    to: "ip_patents",
    condition: (findings) => {
      const ipHeavySectors = [
        "Biotech",
        "Pharma",
        "DeepTech",
        "Hardware",
        "Semiconductors",
        "AI/ML",
      ];
      const hasIPSector = findings.sectors?.some((s: string) =>
        ipHeavySectors.some((is) => s.toLowerCase().includes(is.toLowerCase()))
      );
      const mentionsPatents =
        findings.description?.toLowerCase().includes("patent") ||
        findings.description?.toLowerCase().includes("proprietary") ||
        findings.description?.toLowerCase().includes("ip ");
      return hasIPSector || mentionsPatents;
    },
    reason: (findings) =>
      findings.description?.toLowerCase().includes("patent")
        ? "Patent mentions in description - need IP analysis"
        : `IP-heavy sector (${findings.sectors?.join(", ")}) - assess patent portfolio`,
    contextBuilder: (findings) => ({
      trigger: "ip_indicators",
      triggerValue: {
        sectors: findings.sectors,
        hasPatentMention:
          findings.description?.toLowerCase().includes("patent"),
      },
      relevantFindings: {
        description: findings.description,
        keyProducts: findings.keyProducts,
        sectors: findings.sectors,
      },
      focusAreas: [
        "Search USPTO for company patents",
        "Identify key inventors (cross-ref with team)",
        "Assess patent portfolio strength",
        "Check for IP risks or litigation",
      ],
      questionsToAnswer: [
        "How defensible is the IP?",
        "Are there freedom-to-operate concerns?",
        "What is the patent trajectory?",
      ],
    }),
    priority: "normal",
  },

  // Company Profile → Technical DD (tech indicators)
  {
    from: "company_profile",
    to: "technical_dd",
    condition: (findings) => {
      const techSectors = [
        "AI/ML",
        "DevTools",
        "Infrastructure",
        "Cybersecurity",
        "Cloud",
        "SaaS",
        "Developer",
      ];
      const hasTechSector = findings.sectors?.some((s: string) =>
        techSectors.some((ts) => s.toLowerCase().includes(ts.toLowerCase()))
      );
      const hasGitHub = findings.socialPresence?.github;
      const isOpenSource =
        findings.description?.toLowerCase().includes("open source") ||
        findings.description?.toLowerCase().includes("open-source");
      return hasTechSector || hasGitHub || isOpenSource;
    },
    reason: (findings) =>
      findings.socialPresence?.github
        ? "GitHub presence detected - need technical analysis"
        : `Tech-focused company (${findings.sectors?.join(", ")}) - assess technical depth`,
    contextBuilder: (findings) => ({
      trigger: "tech_indicators",
      triggerValue: {
        sectors: findings.sectors,
        github: findings.socialPresence?.github,
      },
      relevantFindings: {
        description: findings.description,
        keyProducts: findings.keyProducts,
        socialPresence: findings.socialPresence,
      },
      focusAreas: [
        "Analyze GitHub repositories if available",
        "Identify technology stack",
        "Assess engineering quality signals",
        "Check for security vulnerabilities",
      ],
      questionsToAnswer: [
        "What is the tech stack?",
        "How scalable is the architecture?",
        "What is the security posture?",
      ],
    }),
    priority: "normal",
  },

  // Financial Deep → Regulatory (SEC filings detected)
  {
    from: "financial_deep",
    to: "regulatory",
    condition: (findings) => {
      const hasSECFilings = findings.fundingHistory?.some(
        (r: any) => r.source?.includes("sec") || r.verified === true
      );
      const hasPublicSecurities =
        findings.totalRaised?.amount > 100 || // $100M+ usually triggers SEC
        findings.fundingHistory?.some((r: any) =>
          ["Series D", "Series E", "Pre-IPO", "IPO"].includes(r.roundType)
        );
      return hasSECFilings || hasPublicSecurities;
    },
    reason: (findings) =>
      "Late-stage funding or SEC filings detected - need regulatory deep dive",
    contextBuilder: (findings) => ({
      trigger: "sec_filings_detected",
      triggerValue: {
        totalRaised: findings.totalRaised,
        latestRound: findings.fundingHistory?.[0]?.roundType,
      },
      relevantFindings: {
        fundingHistory: findings.fundingHistory,
        totalRaised: findings.totalRaised,
      },
      focusAreas: [
        "Search SEC EDGAR for filings",
        "Check for Form D filings",
        "Identify any regulatory disclosures",
        "Assess compliance posture",
      ],
      questionsToAnswer: [
        "What SEC filings exist?",
        "Are there any concerning disclosures?",
        "What is the securities law compliance status?",
      ],
    }),
    priority: "high",
  },

  // Market Competitive → Financial Deep (major competitor funding)
  {
    from: "market_competitive",
    to: "financial_deep",
    condition: (findings) => {
      const hasWellFundedCompetitors = findings.competitors?.some(
        (c: any) =>
          c.fundingTotal?.includes("B") || // Billion
          (c.fundingTotal?.includes("M") &&
            parseFloat(c.fundingTotal) > 100) ||
          c.threat === "high"
      );
      return hasWellFundedCompetitors && findings.competitors?.length >= 3;
    },
    reason: (findings) =>
      "Well-funded competitors detected - need detailed funding comparison",
    contextBuilder: (findings) => ({
      trigger: "competitor_funding_analysis",
      triggerValue: {
        competitorCount: findings.competitors?.length,
        highThreatCount: findings.competitors?.filter(
          (c: any) => c.threat === "high"
        ).length,
      },
      relevantFindings: {
        competitors: findings.competitors,
        marketSize: findings.marketSize,
      },
      focusAreas: [
        "Deep dive on funding history",
        "Compare valuation multiples with competitors",
        "Assess competitive capital position",
        "Evaluate burn rate sustainability",
      ],
      questionsToAnswer: [
        "How does funding compare to competitors?",
        "What is the relative valuation?",
        "Is there enough runway to compete?",
      ],
    }),
    priority: "normal",
  },

  // IP Patents → Technical DD (patent analysis reveals tech)
  {
    from: "ip_patents",
    to: "technical_dd",
    condition: (findings) => {
      const hasTechPatents = findings.patents?.some((p: any) =>
        ["software", "algorithm", "machine learning", "neural", "computing"].some(
          (term) => p.title?.toLowerCase().includes(term)
        )
      );
      return hasTechPatents && findings.patents?.length >= 2;
    },
    reason: (findings) =>
      `Technology patents detected (${findings.patents?.length} patents) - need technical validation`,
    contextBuilder: (findings) => ({
      trigger: "tech_patents_found",
      triggerValue: {
        patentCount: findings.patents?.length,
        patentTypes: findings.patents?.map((p: any) => p.title).slice(0, 3),
      },
      relevantFindings: {
        patents: findings.patents,
        techStack: findings.patents
          ?.map((p: any) => p.title)
          .join(" ")
          .match(/\b(AI|ML|neural|blockchain|cloud|API)\b/gi),
      },
      focusAreas: [
        "Validate technical claims in patents",
        "Assess implementation feasibility",
        "Check for related open source",
        "Evaluate technical moat",
      ],
      questionsToAnswer: [
        "Are the patented technologies implemented?",
        "What is the technical differentiation?",
        "How defensible is the technical moat?",
      ],
    }),
    priority: "low",
  },
];

// ============================================================================
// HANDOFF DETECTION
// ============================================================================

/**
 * Detect potential handoffs based on branch findings
 */
export function detectHandoffs(
  fromBranch: BranchType,
  findings: any,
  alreadySpawnedBranches: BranchType[]
): BranchHandoff[] {
  const handoffs: BranchHandoff[] = [];

  for (const trigger of HANDOFF_TRIGGERS) {
    // Only check triggers from this branch
    if (trigger.from !== fromBranch) continue;

    // Skip if target branch already spawned
    if (alreadySpawnedBranches.includes(trigger.to)) continue;

    // Check condition
    try {
      if (trigger.condition(findings)) {
        const handoff: BranchHandoff = {
          id: `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          from: trigger.from,
          to: trigger.to,
          reason: trigger.reason(findings),
          priority: trigger.priority,
          context: trigger.contextBuilder(findings),
          status: "pending",
          createdAt: Date.now(),
        };
        handoffs.push(handoff);
      }
    } catch (error) {
      // Condition evaluation failed, skip this trigger
      console.warn(`[DD-Handoff] Trigger evaluation failed:`, error);
    }
  }

  // Sort by priority
  return handoffs.sort((a, b) => {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * Build updated complexity signals from handoff
 */
export function buildSignalsFromHandoff(
  handoff: BranchHandoff,
  existingSignals: ComplexitySignals
): ComplexitySignals {
  const signals = { ...existingSignals };

  switch (handoff.to) {
    case "technical_dd":
      signals.hasRepoMentions = true;
      break;
    case "ip_patents":
      signals.hasPatentMentions = true;
      break;
    case "regulatory":
      signals.hasRegulatoryMentions = true;
      break;
    case "network_mapping":
      signals.hasSerialFounders =
        signals.hasSerialFounders ||
        handoff.context.triggerValue?.hasSerialFounders;
      signals.hasVCBackedFounders =
        signals.hasVCBackedFounders ||
        handoff.context.triggerValue?.hasVCBackedFounders;
      break;
    case "financial_deep":
      // Mark for deep financial analysis
      signals.fundingStage = signals.fundingStage || "Growth";
      break;
  }

  return signals;
}

// ============================================================================
// HANDOFF QUEUE MANAGEMENT
// ============================================================================

export interface HandoffQueue {
  jobId: string;
  pending: BranchHandoff[];
  accepted: BranchHandoff[];
  rejected: BranchHandoff[];
  completed: BranchHandoff[];
}

/**
 * Process handoff queue - decide which handoffs to accept
 */
export function processHandoffQueue(
  queue: HandoffQueue,
  maxAdditionalBranches: number = 2,
  currentBranchCount: number = 3
): {
  toSpawn: BranchHandoff[];
  toReject: BranchHandoff[];
} {
  const toSpawn: BranchHandoff[] = [];
  const toReject: BranchHandoff[] = [];

  // Maximum total branches (core + conditional)
  const MAX_TOTAL_BRANCHES = 8;
  const availableSlots = Math.min(
    maxAdditionalBranches,
    MAX_TOTAL_BRANCHES - currentBranchCount
  );

  // Already accepted targets (prevent duplicates)
  const acceptedTargets = new Set(queue.accepted.map((h) => h.to));

  // Sort pending by priority
  const sortedPending = [...queue.pending].sort((a, b) => {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  for (const handoff of sortedPending) {
    // Skip if already accepting this branch
    if (acceptedTargets.has(handoff.to)) {
      toReject.push({ ...handoff, status: "rejected" });
      continue;
    }

    // Accept if slots available and priority warrants
    if (toSpawn.length < availableSlots) {
      toSpawn.push({ ...handoff, status: "accepted", processedAt: Date.now() });
      acceptedTargets.add(handoff.to);
    } else if (handoff.priority === "high" && toSpawn.length > 0) {
      // High priority can bump low priority
      const bumpableIndex = toSpawn.findIndex((h) => h.priority === "low");
      if (bumpableIndex >= 0) {
        toReject.push({ ...toSpawn[bumpableIndex], status: "rejected" });
        toSpawn[bumpableIndex] = {
          ...handoff,
          status: "accepted",
          processedAt: Date.now(),
        };
        acceptedTargets.add(handoff.to);
      } else {
        toReject.push({ ...handoff, status: "rejected" });
      }
    } else {
      toReject.push({ ...handoff, status: "rejected" });
    }
  }

  return { toSpawn, toReject };
}

// ============================================================================
// HANDOFF CONTEXT FORMATTING
// ============================================================================

/**
 * Format handoff context for the target branch prompt
 */
export function formatHandoffContextForPrompt(handoff: BranchHandoff): string {
  return `
## Handoff Context

**Triggered By:** ${handoff.from} branch
**Reason:** ${handoff.reason}
**Priority:** ${handoff.priority}

### Trigger Information
${JSON.stringify(handoff.context.triggerValue, null, 2)}

### Relevant Findings from ${handoff.from}
${Object.entries(handoff.context.relevantFindings)
  .map(([key, value]) => `- **${key}:** ${JSON.stringify(value).slice(0, 200)}`)
  .join("\n")}

### Focus Areas (from handoff)
${handoff.context.focusAreas.map((f) => `- ${f}`).join("\n")}

### Questions to Answer
${handoff.context.questionsToAnswer.map((q) => `- ${q}`).join("\n")}

---
`;
}

// ============================================================================
// CONVEX MUTATIONS/QUERIES FOR HANDOFF STATE
// ============================================================================

export const createHandoffQueue = internalMutation({
  args: {
    jobId: v.string(),
  },
  handler: async (ctx, { jobId }) => {
    const queue: HandoffQueue = {
      jobId,
      pending: [],
      accepted: [],
      rejected: [],
      completed: [],
    };

    // Store in MCP memory
    await ctx.runMutation(internal.domains.mcp.mcpMemory.writeMemory, {
      entry: {
        key: `dd:handoff:${jobId}`,
        content: JSON.stringify(queue),
        metadata: { type: "handoff_queue", jobId },
      },
    });

    return queue;
  },
});

export const getHandoffQueue = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const entry = await ctx.runQuery(
      internal.domains.mcp.mcpMemory.readMemory,
      { key: `dd:handoff:${jobId}` }
    );

    if (!entry?.content) return null;

    try {
      return JSON.parse(entry.content) as HandoffQueue;
    } catch {
      return null;
    }
  },
});

export const addHandoffsToQueue = internalMutation({
  args: {
    jobId: v.string(),
    handoffs: v.array(v.any()),
  },
  handler: async (ctx, { jobId, handoffs }) => {
    const entry = await ctx.runQuery(
      internal.domains.mcp.mcpMemory.readMemory,
      { key: `dd:handoff:${jobId}` }
    );

    let queue: HandoffQueue;
    if (entry?.content) {
      queue = JSON.parse(entry.content);
    } else {
      queue = {
        jobId,
        pending: [],
        accepted: [],
        rejected: [],
        completed: [],
      };
    }

    // Add new handoffs to pending
    for (const handoff of handoffs as BranchHandoff[]) {
      // Avoid duplicates
      const exists = queue.pending.some(
        (h) => h.from === handoff.from && h.to === handoff.to
      );
      if (!exists) {
        queue.pending.push(handoff);
      }
    }

    await ctx.runMutation(internal.domains.mcp.mcpMemory.writeMemory, {
      entry: {
        key: `dd:handoff:${jobId}`,
        content: JSON.stringify(queue),
        metadata: { type: "handoff_queue", jobId, updatedAt: Date.now() },
      },
    });

    return queue;
  },
});

export const processHandoffs = internalMutation({
  args: {
    jobId: v.string(),
    maxAdditionalBranches: v.optional(v.number()),
    currentBranchCount: v.number(),
  },
  handler: async (ctx, { jobId, maxAdditionalBranches = 2, currentBranchCount }) => {
    const entry = await ctx.runQuery(
      internal.domains.mcp.mcpMemory.readMemory,
      { key: `dd:handoff:${jobId}` }
    );

    if (!entry?.content) return { toSpawn: [], toReject: [] };

    const queue: HandoffQueue = JSON.parse(entry.content);
    const { toSpawn, toReject } = processHandoffQueue(
      queue,
      maxAdditionalBranches,
      currentBranchCount
    );

    // Update queue
    queue.pending = queue.pending.filter(
      (h) =>
        !toSpawn.some((s) => s.id === h.id) &&
        !toReject.some((r) => r.id === h.id)
    );
    queue.accepted.push(...toSpawn);
    queue.rejected.push(...toReject);

    await ctx.runMutation(internal.domains.mcp.mcpMemory.writeMemory, {
      entry: {
        key: `dd:handoff:${jobId}`,
        content: JSON.stringify(queue),
        metadata: { type: "handoff_queue", jobId, updatedAt: Date.now() },
      },
    });

    return { toSpawn, toReject };
  },
});

export const markHandoffCompleted = internalMutation({
  args: {
    jobId: v.string(),
    handoffId: v.string(),
  },
  handler: async (ctx, { jobId, handoffId }) => {
    const entry = await ctx.runQuery(
      internal.domains.mcp.mcpMemory.readMemory,
      { key: `dd:handoff:${jobId}` }
    );

    if (!entry?.content) return;

    const queue: HandoffQueue = JSON.parse(entry.content);

    // Find in accepted and move to completed
    const index = queue.accepted.findIndex((h) => h.id === handoffId);
    if (index >= 0) {
      const handoff = queue.accepted.splice(index, 1)[0];
      handoff.status = "completed";
      queue.completed.push(handoff);
    }

    await ctx.runMutation(internal.domains.mcp.mcpMemory.writeMemory, {
      entry: {
        key: `dd:handoff:${jobId}`,
        content: JSON.stringify(queue),
        metadata: { type: "handoff_queue", jobId, updatedAt: Date.now() },
      },
    });
  },
});
