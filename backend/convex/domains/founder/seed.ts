/**
 * Founder Platform Seed — populates tables with real NodeBench company data.
 *
 * Run via: npx convex run domains/founder/seedTrigger:seed
 */

import { internalMutation } from "../../_generated/server";

export const seedFounderData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // -----------------------------------------------------------------------
    // 1. Workspace
    // -----------------------------------------------------------------------
    const workspaceId = await ctx.db.insert("founderWorkspaces", {
      name: "NodeBench HQ",
      ownerUserId: "seed_founder",
      createdAt: now,
      updatedAt: now,
    });

    // -----------------------------------------------------------------------
    // 2. Company
    // -----------------------------------------------------------------------
    const companyId = await ctx.db.insert("founderCompanies", {
      workspaceId,
      name: "NodeBench AI",
      canonicalMission:
        "Local-first operating-memory and entity-context layer for agent-native businesses",
      wedge: "Founder operating memory + artifact restructuring layer",
      companyState: "operating",
      foundingMode: "start_new",
      status: "active",
      identityConfidence: 0.78,
      createdAt: now,
      updatedAt: now,
    });

    // -----------------------------------------------------------------------
    // 3. Initiatives (5)
    // -----------------------------------------------------------------------
    const initiatives = [
      {
        title: "Founder Dashboard Integration",
        objective:
          "Wire all 18 founder surfaces to Convex persistence with live data",
        ownerType: "shared" as const,
        status: "active" as const,
        riskLevel: "medium" as const,
        priorityScore: 0.95,
      },
      {
        title: "MCP Distribution — Registry + npm + Cursor",
        objective:
          "Publish to MCP Registry, mcpservers.org, cursor.directory, and npm 2.68+",
        ownerType: "founder" as const,
        status: "active" as const,
        riskLevel: "low" as const,
        priorityScore: 0.85,
      },
      {
        title: "Live Data Wiring — Convex persistence",
        objective:
          "Replace all fixture/demo data with real Convex reads across founder views",
        ownerType: "shared" as const,
        status: "active" as const,
        riskLevel: "high" as const,
        priorityScore: 0.9,
      },
      {
        title: "Mobile UX — SitFlow patterns",
        objective:
          "Bottom-sheet agent panel, swipe navigation, haptic feedback for mobile-first cockpit",
        ownerType: "founder" as const,
        status: "active" as const,
        riskLevel: "medium" as const,
        priorityScore: 0.8,
      },
      {
        title: "Eval Flywheel — Search quality",
        objective:
          "Reach 100% on 103-query eval corpus with 4-layer grounding pipeline",
        ownerType: "agent" as const,
        status: "active" as const,
        riskLevel: "low" as const,
        priorityScore: 0.75,
      },
    ] as const;

    const initiativeIds: string[] = [];
    for (const init of initiatives) {
      const id = await ctx.db.insert("founderInitiatives", {
        companyId,
        title: init.title,
        objective: init.objective,
        ownerType: init.ownerType,
        status: init.status,
        riskLevel: init.riskLevel,
        priorityScore: init.priorityScore,
        createdAt: now,
        updatedAt: now,
      });
      initiativeIds.push(id);
    }

    // -----------------------------------------------------------------------
    // 4. Agents (3)
    // -----------------------------------------------------------------------
    const agents = [
      {
        name: "Claude Code",
        agentType: "claude_code" as const,
        runtimeSurface: "local" as const,
        mode: "bounded_proactive" as const,
        status: "healthy" as const,
        currentGoal: "Ship founder dashboard with live Convex data",
      },
      {
        name: "OpenClaw",
        agentType: "openclaw" as const,
        runtimeSurface: "remote" as const,
        mode: "passive" as const,
        status: "waiting" as const,
        currentGoal: "Awaiting packet dispatch for background research",
      },
      {
        name: "Background Sync",
        agentType: "nodebench_background" as const,
        runtimeSurface: "hybrid" as const,
        mode: "passive" as const,
        status: "healthy" as const,
        currentGoal: "Daily brief sync + signal ingestion",
      },
    ] as const;

    const agentIds: string[] = [];
    for (const agent of agents) {
      const id = await ctx.db.insert("founderAgents", {
        workspaceId,
        companyId,
        name: agent.name,
        agentType: agent.agentType,
        runtimeSurface: agent.runtimeSurface,
        mode: agent.mode,
        status: agent.status,
        currentGoal: agent.currentGoal,
        lastHeartbeatAt: now,
        createdAt: now,
        updatedAt: now,
      });
      agentIds.push(id);
    }

    // -----------------------------------------------------------------------
    // 5. Signals (5)
    // -----------------------------------------------------------------------
    const signals = [
      {
        sourceType: "market" as const,
        title: "OpenAI Codex app positions as agent command center",
        content:
          "OpenAI launched Codex as a standalone agent app with background task execution, file editing, and PR creation — directly competing with Claude Code and Cursor for the agentic dev workflow.",
        importanceScore: 0.85,
      },
      {
        sourceType: "market" as const,
        title: "Cursor ships background agents + web/mobile access",
        content:
          "Cursor now supports persistent background agents that run across sessions and can be accessed via web and mobile interfaces, expanding beyond the desktop IDE paradigm.",
        importanceScore: 0.9,
      },
      {
        sourceType: "market" as const,
        title: "Shopify launches Agentic Storefronts via UCP",
        content:
          "Shopify introduced the Universal Commerce Protocol enabling AI agents to browse, compare, and purchase on behalf of users — validating the agent-readable business thesis.",
        importanceScore: 0.8,
      },
      {
        sourceType: "execution" as const,
        title: "Shopify tightens partner API terms for AI/data",
        content:
          "Shopify updated partner terms restricting how AI tools can access and use store data, signaling tighter platform control over agent access — a risk for agent-native integrations.",
        importanceScore: 0.75,
      },
      {
        sourceType: "product" as const,
        title: "Stripe publishes MCP integration benchmark",
        content:
          "Stripe released an open benchmark for MCP server integrations measuring tool accuracy, latency, and reliability — sets a quality bar for all MCP tool providers.",
        importanceScore: 0.85,
      },
    ] as const;

    for (const signal of signals) {
      await ctx.db.insert("founderSignals", {
        companyId,
        sourceType: signal.sourceType,
        title: signal.title,
        content: signal.content,
        importanceScore: signal.importanceScore,
        createdAt: now,
      });
    }

    // -----------------------------------------------------------------------
    // 6. Interventions (3)
    // -----------------------------------------------------------------------
    const interventions = [
      {
        title: "Submit to MCP Registry and mcpservers.org",
        description:
          "Publish nodebench-mcp to the official MCP Registry, mcpservers.org, and cursor.directory for maximum discoverability by AI coding agents.",
        priorityScore: 0.9,
        confidence: 0.85,
        expectedImpact:
          "10x install surface — every Claude Code, Cursor, and Windsurf user can discover NodeBench via registry search",
        initiativeIdx: 1,
      },
      {
        title: "Wire useFounderPersistence into all 18 views",
        description:
          "Replace hardcoded fixture data in all founder dashboard views with real Convex reads/writes using the useFounderPersistence hook.",
        priorityScore: 0.85,
        confidence: 0.9,
        expectedImpact:
          "Founder dashboard becomes a real operating tool instead of a demo — data persists across sessions",
        initiativeIdx: 0,
      },
      {
        title: "Ship live company search for banker/CEO flow",
        description:
          "Connect the entity intelligence search to live web data so the banker and CEO role lenses return real company signals, not demo fixtures.",
        priorityScore: 0.8,
        confidence: 0.75,
        expectedImpact:
          "First truly useful search experience — validates the 'right context, right judgment' thesis with real data",
        initiativeIdx: 4,
      },
    ] as const;

    for (const intervention of interventions) {
      await ctx.db.insert("founderInterventions", {
        companyId,
        initiativeId: initiativeIds[intervention.initiativeIdx] as any,
        title: intervention.title,
        description: intervention.description,
        priorityScore: intervention.priorityScore,
        confidence: intervention.confidence,
        expectedImpact: intervention.expectedImpact,
        status: "suggested",
        createdAt: now,
        updatedAt: now,
      });
    }

    // -----------------------------------------------------------------------
    // 7. Related Entities (5)
    // -----------------------------------------------------------------------
    const relatedEntities = [
      {
        entityType: "competitor" as const,
        name: "Cursor",
        relationship: "AI-first code editor with background agents",
        whyItMatters:
          "Ships background agents and web/mobile access — directly competes for the agentic developer workflow NodeBench serves via MCP",
      },
      {
        entityType: "partner" as const,
        name: "OpenClaw",
        relationship: "Agent runtime that reads NodeBench packets",
        whyItMatters:
          "Validates the artifact packet model — OpenClaw agents consume NodeBench decision memos and context snapshots as operating memory",
      },
      {
        entityType: "comparable" as const,
        name: "Anthropic",
        relationship: "Foundation model provider, MCP protocol creator",
        whyItMatters:
          "Created the MCP protocol NodeBench builds on — their tool ecosystem decisions directly shape distribution and discoverability",
      },
      {
        entityType: "market_signal" as const,
        name: "Shopify",
        relationship:
          "Agentic commerce validates agent-readable business thesis",
        whyItMatters:
          "UCP launch proves that businesses need agent-readable interfaces — NodeBench provides the operating memory layer agents need to act on business context",
      },
      {
        entityType: "comparable" as const,
        name: "Linear",
        relationship: "Speed-first product management, similar design DNA",
        whyItMatters:
          "Proves that sub-50ms interaction speed and opinionated defaults create tribal adoption — NodeBench follows the same design philosophy",
      },
    ] as const;

    for (const entity of relatedEntities) {
      await ctx.db.insert("founderRelatedEntities", {
        companyId,
        entityType: entity.entityType,
        name: entity.name,
        relationship: entity.relationship,
        whyItMatters: entity.whyItMatters,
        createdAt: now,
        updatedAt: now,
      });
    }

    // -----------------------------------------------------------------------
    // 8. Context Snapshot (weekly)
    // -----------------------------------------------------------------------
    await ctx.db.insert("founderContextSnapshots", {
      companyId,
      snapshotType: "weekly",
      summary:
        "Week of 2026-03-24: Founder dashboard 9-phase build complete. All 18 Convex tables live. MCP server at v2.68 with 350 tools. Eval corpus at 103 queries across 18 categories. Mobile UX patterns designed but not yet wired. Distribution pending — MCP Registry and npm publish are the highest-leverage next actions.",
      topPriorities: [
        "Submit nodebench-mcp to MCP Registry for discoverability",
        "Wire all founder views to live Convex persistence",
        "Ship live entity intelligence search for banker flow",
        "Mobile UX bottom-sheet agent panel",
        "Reach 100% on eval flywheel corpus",
      ],
      topRisks: [
        "All founder views still show fixture data — no live persistence yet",
        "Cursor background agents may commoditize the agentic dev workflow",
        "Shopify API term changes could limit agent-native integrations",
      ],
      openQuestions: [
        "Should we prioritize MCP Registry distribution or live data wiring first?",
        "Is the 350-tool count a moat or a liability for new users?",
        "How do we differentiate from Cursor's background agents?",
      ],
      generatedByAgentId: agentIds[0] as any,
      createdAt: now,
    });

    return {
      workspaceId,
      companyId,
      initiativeCount: initiativeIds.length,
      agentCount: agentIds.length,
      signalCount: signals.length,
      interventionCount: interventions.length,
      relatedEntityCount: relatedEntities.length,
      contextSnapshotCount: 1,
    };
  },
});
