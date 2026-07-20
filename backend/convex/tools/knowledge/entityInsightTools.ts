"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY INSIGHT TOOLS FOR DEEP AGENTS 2.0
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Banker-grade entity enrichment tool.
 *
 * This tool calls the enhanced entityInsights pipeline which includes:
 * - Stage 1: Basic entity extraction (summary, keyFacts, crmFields)
 * - Stage 2: Funding deep-dive (structured funding rounds, investors)
 * - Stage 2.5: Banker-grade enrichment (productPipeline, contacts, news classification)
 * - Stage 3: Build enriched payload with source credibility and persona hooks
 */
export const getBankerGradeEntityInsights = createTool({
  description: `Get banker-grade enriched entity insights for a company or person.

This tool performs deep multi-stage enrichment including:
- Funding data with structured rounds, co-leads, participants, use of proceeds
- Product pipeline with lead assets, programs, regulatory designations
- People data with founder/executive credentials and backgrounds
- Contact points with primary/media channels and outreach angles
- News classification with type (press release vs trade) and key claims
- Source credibility classification (primary/secondary, high/medium/low)
- 10-persona quality gate evaluation (JPM Banker, VC, CTO, etc.)

Use this when you need comprehensive, banker-quality entity research.
The result includes personaHooks with explicit PASS/FAIL criteria for each persona.`,

  args: z.object({
    entityName: z.string().describe("Name of the company or person to research"),
    entityType: z.enum(["company", "person"]).default("company").describe("Type of entity"),
    forceRefresh: z.boolean().default(false).describe("Force refresh even if cached data exists"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(api.domains.knowledge.entityInsights.getEntityInsights, {
        entityName: args.entityName,
        entityType: args.entityType,
        forceRefresh: args.forceRefresh,
      });

      // Format the result for agent consumption
      const sections: string[] = [];

      sections.push(`# ${result.entityName} - Entity Insights`);
      sections.push(`**Cached:** ${result.cached ? "Yes" : "No (fresh research)"}`);
      sections.push(`**Researched:** ${new Date(result.researchedAt).toISOString()}`);
      sections.push("");

      // Summary
      sections.push("## Summary");
      sections.push(result.summary || "No summary available.");
      sections.push("");

      // Key Facts
      if (result.keyFacts?.length) {
        sections.push("## Key Facts");
        result.keyFacts.forEach((fact: string) => sections.push(`- ${fact}`));
        sections.push("");
      }

      // Funding
      if (result.funding) {
        sections.push("## Funding");
        if (result.funding.stage) sections.push(`- **Stage:** ${result.funding.stage}`);
        if (result.funding.totalRaised) {
          const tr = result.funding.totalRaised;
          sections.push(`- **Total Raised:** ${tr.currency}${tr.amount}${tr.unit}`);
        }
        if (result.funding.lastRound) {
          const lr = result.funding.lastRound;
          sections.push(`- **Last Round:** ${lr.roundType}${lr.announcedDate ? ` (${lr.announcedDate})` : ""}`);
          if (lr.coLeads?.length) sections.push(`  - Co-leads: ${lr.coLeads.join(", ")}`);
          if (lr.participants?.length) sections.push(`  - Participants: ${lr.participants.join(", ")}`);
          if (lr.useOfProceeds) sections.push(`  - Use of proceeds: ${lr.useOfProceeds}`);
        }
        if (result.funding.bankerTakeaway) {
          sections.push(`- **Banker Takeaway:** ${result.funding.bankerTakeaway}`);
        }
        sections.push("");
      }

      // People
      if (result.people) {
        sections.push("## People");
        if (result.people.founders?.length) {
          sections.push("### Founders");
          result.people.founders.forEach((f: any) => {
            sections.push(`- **${f.name}** (${f.role || "Founder"})`);
            if (f.background) sections.push(`  - ${f.background}`);
            if (f.credentials?.length) {
              sections.push(`  - Credentials: ${f.credentials.map((c: any) => c.type).join(", ")}`);
            }
          });
        }
        if (result.people.executives?.length) {
          sections.push("### Executives");
          result.people.executives.forEach((e: any) => {
            sections.push(`- **${e.name}** (${e.role})`);
            if (e.backgroundHighlights?.length) {
              e.backgroundHighlights.forEach((h: string) => sections.push(`  - ${h}`));
            }
          });
        }
        if (result.people.board?.length) {
          sections.push(`### Board: ${result.people.board.join(", ")}`);
        }
        sections.push("");
      }

      // Product Pipeline
      if (result.productPipeline) {
        sections.push("## Product Pipeline");
        if (result.productPipeline.platform) sections.push(`- **Platform:** ${result.productPipeline.platform}`);
        if (result.productPipeline.modalities?.length) {
          sections.push(`- **Modalities:** ${result.productPipeline.modalities.join(", ")}`);
        }
        if (result.productPipeline.leadAsset) {
          const la = result.productPipeline.leadAsset;
          sections.push("### Lead Asset");
          if (la.name) sections.push(`- Name: ${la.name}`);
          if (la.class) sections.push(`- Class: ${la.class}`);
          if (la.regulatory?.length) sections.push(`- Regulatory: ${la.regulatory.join(", ")}`);
          if (la.indicationFocus?.length) sections.push(`- Indications: ${la.indicationFocus.join(", ")}`);
        }
        if (result.productPipeline.leadPrograms?.length) {
          sections.push("### Lead Programs");
          result.productPipeline.leadPrograms.forEach((p: any) => {
            sections.push(`- **${p.program}** - ${p.stage || "Unknown stage"}`);
            if (p.notes) sections.push(`  - ${p.notes}`);
          });
        }
        if (result.productPipeline.differentiation?.length) {
          sections.push("### Differentiation");
          result.productPipeline.differentiation.forEach((d: string) => sections.push(`- ${d}`));
        }
        sections.push("");
      }

      // Contact Points
      if (result.contactPoints) {
        sections.push("## Contact Points");
        if (result.contactPoints.primary) {
          const p = result.contactPoints.primary;
          sections.push(`- **Primary:** ${p.value} (${p.channel}) - ${p.purpose || "Contact"}`);
        }
        if (result.contactPoints.media) {
          const m = result.contactPoints.media;
          sections.push(`- **Media:** ${m.value} (${m.channel}) - ${m.purpose || "PR"}`);
        }
        if (result.contactPoints.outreachAngles?.length) {
          sections.push("### Outreach Angles");
          result.contactPoints.outreachAngles.forEach((a: string) => sections.push(`- ${a}`));
        }
        sections.push("");
      }

      // Freshness
      if (result.freshness) {
        sections.push("## Freshness");
        sections.push(`- **News Age:** ${result.freshness.newsAgeDays ?? "Unknown"} days`);
        sections.push(`- **Within Banker Window (30d):** ${result.freshness.withinBankerWindow ? "Yes ✓" : "No ✗"}`);
        sections.push("");
      }

      // Sources
      if (result.sources?.length) {
        sections.push("## Sources");
        result.sources.forEach((s: any) => {
          const credBadge = s.credibility === "high" ? "🟢" : s.credibility === "medium-high" ? "🟡" : "⚪";
          const typeBadge = s.sourceType === "primary" ? "[P]" : "[S]";
          sections.push(`- ${credBadge} ${typeBadge} [${s.name}](${s.url})`);
        });
        sections.push("");
      }

      // Persona Hooks Summary
      if (result.personaHooks) {
        sections.push("## Persona Quality Gates");
        const personas = Object.entries(result.personaHooks) as Array<[string, { passCriteria?: string[]; failTriggers?: string[] }]>;
        for (const [persona, hooks] of personas) {
          const passCount = hooks.passCriteria?.length || 0;
          const failCount = hooks.failTriggers?.length || 0;
          const status = failCount === 0 ? "✓ PASS" : `⚠ ${failCount} issue(s)`;
          sections.push(`- **${persona}:** ${status} (${passCount} criteria met)`);
        }
        sections.push("");
      }

      return sections.join("\n");
    } catch (error: any) {
      return `Error enriching entity "${args.entityName}": ${error.message || error}`;
    }
  },
});

/**
 * Evaluate entity readiness for a specific persona.
 *
 * Use this to check if an entity meets the quality gates for a particular use case.
 */
export const evaluateEntityForPersona = createTool({
  description: `Evaluate if an entity is ready for a specific persona/use case.

Personas available:
- JPM_STARTUP_BANKER: Weekly outbound target validation (requires news within 30 days)
- EARLY_STAGE_VC: Thesis generation & competitive mapping
- CTO_TECH_LEAD: Technical due diligence
- FOUNDER_STRATEGY: Strategic pivot analysis
- ACADEMIC_RD: Literature anchor verification
- ENTERPRISE_EXEC: P&L risk management
- ECOSYSTEM_PARTNER: Second-order market effects
- QUANT_ANALYST: Quantitative signal extraction
- PRODUCT_DESIGNER: Schema density for UI/UX
- SALES_ENGINEER: Share-ready summary validation

Returns detailed PASS/FAIL analysis with specific criteria.`,

  args: z.object({
    entityName: z.string().describe("Name of the entity to evaluate"),
    persona: z.enum([
      "JPM_STARTUP_BANKER",
      "EARLY_STAGE_VC",
      "CTO_TECH_LEAD",
      "FOUNDER_STRATEGY",
      "ACADEMIC_RD",
      "ENTERPRISE_EXEC",
      "ECOSYSTEM_PARTNER",
      "QUANT_ANALYST",
      "PRODUCT_DESIGNER",
      "SALES_ENGINEER",
    ]).describe("Persona to evaluate against"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(api.domains.knowledge.entityInsights.getEntityInsights, {
        entityName: args.entityName,
        entityType: "company",
        forceRefresh: false, // Use cached if available
      });

      const hooks = result.personaHooks?.[args.persona];
      if (!hooks) {
        return `No persona hooks found for ${args.persona} on entity "${args.entityName}".`;
      }

      const sections: string[] = [];
      sections.push(`# ${args.entityName} - ${args.persona} Evaluation`);
      sections.push("");

      // Overall status
      const failCount = hooks.failTriggers?.length || 0;
      const passCount = hooks.passCriteria?.length || 0;
      const overallStatus = failCount === 0 ? "✓ READY" : "✗ NOT READY";
      sections.push(`## Status: ${overallStatus}`);
      sections.push("");

      // Intent
      if (hooks.intent) {
        sections.push(`**Intent:** ${hooks.intent}`);
        sections.push("");
      }

      // Freshness requirement
      if (hooks.requiresNewsWithinDays) {
        const currentAge = result.freshness?.newsAgeDays;
        const meetsReq = currentAge != null && currentAge <= hooks.requiresNewsWithinDays;
        sections.push(`**Freshness Requirement:** News within ${hooks.requiresNewsWithinDays} days`);
        sections.push(`**Current:** ${currentAge ?? "Unknown"} days ${meetsReq ? "✓" : "✗"}`);
        sections.push("");
      }

      // Pass criteria
      if (hooks.passCriteria?.length) {
        sections.push("## ✓ Pass Criteria Met");
        hooks.passCriteria.forEach((c: string) => sections.push(`- ${c}`));
        sections.push("");
      }

      // Fail triggers
      if (hooks.failTriggers?.length) {
        sections.push("## ✗ Fail Triggers");
        hooks.failTriggers.forEach((f: string) => sections.push(`- ${f}`));
        sections.push("");
      }

      // Recommendations
      if (failCount > 0) {
        sections.push("## Recommendations");
        sections.push("To resolve these issues, consider:");
        sections.push("1. Force refresh with `forceRefresh: true` to get latest data");
        sections.push("2. Check if the entity has recent public announcements");
        sections.push("3. Verify entity name spelling and use canonical name");
        sections.push("");
      }

      return sections.join("\n");
    } catch (error: any) {
      return `Error evaluating entity "${args.entityName}": ${error.message || error}`;
    }
  },
});

// All 10 personas with their intents for reference
const PERSONA_INTENTS: Record<string, string> = {
  JPM_STARTUP_BANKER: "Weekly outbound target validation",
  EARLY_STAGE_VC: "Thesis generation & competitive mapping",
  CTO_TECH_LEAD: "Technical due diligence",
  FOUNDER_STRATEGY: "Strategic pivot analysis",
  ACADEMIC_RD: "Literature anchor verification",
  ENTERPRISE_EXEC: "P&L risk management",
  ECOSYSTEM_PARTNER: "Second-order market effects",
  QUANT_ANALYST: "Quantitative signal extraction",
  PRODUCT_DESIGNER: "Schema density for UI/UX",
  SALES_ENGINEER: "Share-ready summary validation",
};

/**
 * Batch evaluate multiple entities for any persona readiness.
 */
export const batchEvaluateEntities = createTool({
  description: `Evaluate multiple entities for any persona readiness.

Use this when you have a list of entities and need to quickly filter
which ones meet the quality gates for a specific use case.

Personas available:
- JPM_STARTUP_BANKER: Weekly outbound target validation (requires news within 30 days)
- EARLY_STAGE_VC: Thesis generation & competitive mapping
- CTO_TECH_LEAD: Technical due diligence
- FOUNDER_STRATEGY: Strategic pivot analysis
- ACADEMIC_RD: Literature anchor verification
- ENTERPRISE_EXEC: P&L risk management
- ECOSYSTEM_PARTNER: Second-order market effects
- QUANT_ANALYST: Quantitative signal extraction
- PRODUCT_DESIGNER: Schema density for UI/UX
- SALES_ENGINEER: Share-ready summary validation

Returns a ranked list with READY/NOT READY status per persona.`,

  args: z.object({
    entityNames: z.array(z.string()).describe("List of entity names to evaluate"),
    persona: z.enum([
      "JPM_STARTUP_BANKER",
      "EARLY_STAGE_VC",
      "CTO_TECH_LEAD",
      "FOUNDER_STRATEGY",
      "ACADEMIC_RD",
      "ENTERPRISE_EXEC",
      "ECOSYSTEM_PARTNER",
      "QUANT_ANALYST",
      "PRODUCT_DESIGNER",
      "SALES_ENGINEER",
    ]).default("JPM_STARTUP_BANKER").describe("Persona to evaluate against"),
  }),

  handler: async (ctx, args): Promise<string> => {
    const results: Array<{
      name: string;
      ready: boolean;
      passCount: number;
      failCount: number;
      newsAge: number | null;
      fundingStage: string | null;
      intent: string | null;
    }> = [];

    for (const entityName of args.entityNames.slice(0, 10)) { // Limit to 10
      try {
        const result = await ctx.runAction(api.domains.knowledge.entityInsights.getEntityInsights, {
          entityName,
          entityType: "company",
          forceRefresh: false,
        });

        const hooks = result.personaHooks?.[args.persona];
        results.push({
          name: entityName,
          ready: (hooks?.failTriggers?.length || 0) === 0,
          passCount: hooks?.passCriteria?.length || 0,
          failCount: hooks?.failTriggers?.length || 0,
          newsAge: result.freshness?.newsAgeDays ?? null,
          fundingStage: result.funding?.stage || null,
          intent: hooks?.intent || null,
        });
      } catch {
        results.push({
          name: entityName,
          ready: false,
          passCount: 0,
          failCount: 1,
          newsAge: null,
          fundingStage: null,
          intent: null,
        });
      }
    }

    // Sort: ready first, then by passCount
    results.sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      return b.passCount - a.passCount;
    });

    const sections: string[] = [];
    sections.push(`# ${args.persona} Entity Evaluation`);
    sections.push(`**Intent:** ${PERSONA_INTENTS[args.persona]}`);
    sections.push(`Evaluated ${results.length} entities.`);
    sections.push("");

    const ready = results.filter(r => r.ready);
    const notReady = results.filter(r => !r.ready);

    if (ready.length) {
      sections.push("## ✓ Ready");
      ready.forEach(r => {
        sections.push(`- **${r.name}** - ${r.fundingStage || "Unknown stage"} (${r.newsAge ?? "?"} days old, ${r.passCount} criteria met)`);
      });
      sections.push("");
    }

    if (notReady.length) {
      sections.push("## ⚠ Not Ready");
      notReady.forEach(r => {
        sections.push(`- **${r.name}** - ${r.failCount} issue(s)`);
      });
      sections.push("");
    }

    return sections.join("\n");
  },
});

// Legacy alias for backward compatibility
export const batchEvaluateBankerTargets = batchEvaluateEntities;

/**
 * Get comprehensive entity quality assessment across all 10 personas.
 *
 * This tool returns a full quality matrix showing which personas the entity
 * is ready for and which need more data.
 */
export const getEntityQualityMatrix = createTool({
  description: `Get a comprehensive quality assessment of an entity across all 10 personas.

This returns a matrix showing PASS/FAIL status for each persona use case,
helping you understand the completeness and readiness of entity data
for different purposes (banker outreach, VC thesis, technical DD, etc.).

Use this after getBankerGradeEntityInsights to get a quick overview of
which use cases the entity data supports.`,

  args: z.object({
    entityName: z.string().describe("Name of the entity to assess"),
    forceRefresh: z.boolean().default(false).describe("Force refresh entity data"),
  }),

  handler: async (ctx, args): Promise<string> => {
    try {
      const result = await ctx.runAction(api.domains.knowledge.entityInsights.getEntityInsights, {
        entityName: args.entityName,
        entityType: "company",
        forceRefresh: args.forceRefresh,
      });

      const sections: string[] = [];
      sections.push(`# ${args.entityName} - Quality Matrix`);
      sections.push(`**As Of:** ${result.researchedAt ? new Date(result.researchedAt).toISOString().slice(0, 10) : "Unknown"}`);
      sections.push(`**Freshness:** ${result.freshness?.newsAgeDays ?? "Unknown"} days old`);
      sections.push("");

      // Overall data completeness
      const dataPoints = [
        { name: "Summary", present: !!result.summary },
        { name: "Funding Stage", present: !!result.funding?.stage },
        { name: "Last Round", present: !!result.funding?.lastRound },
        { name: "Founders", present: (result.people?.founders?.length ?? 0) > 0 },
        { name: "Executives", present: (result.people?.executives?.length ?? 0) > 0 },
        { name: "Product Pipeline", present: !!result.productPipeline?.platform },
        { name: "Lead Programs", present: (result.productPipeline?.leadPrograms?.length ?? 0) > 0 },
        { name: "Primary Contact", present: !!result.contactPoints?.primary },
        { name: "Outreach Angles", present: (result.contactPoints?.outreachAngles?.length ?? 0) > 0 },
        { name: "Primary Sources", present: result.sources?.some((s: any) => s.sourceType === "primary") ?? false },
      ];

      const presentCount = dataPoints.filter(d => d.present).length;
      const completeness = Math.round((presentCount / dataPoints.length) * 100);

      sections.push("## Data Completeness");
      sections.push(`**Score:** ${completeness}% (${presentCount}/${dataPoints.length} fields)`);
      dataPoints.forEach(dp => {
        sections.push(`- ${dp.present ? "✓" : "✗"} ${dp.name}`);
      });
      sections.push("");

      // Persona readiness matrix
      sections.push("## Persona Readiness Matrix");
      sections.push("");

      if (result.personaHooks) {
        const allPersonas = Object.keys(PERSONA_INTENTS);
        let readyCount = 0;

        for (const persona of allPersonas) {
          const hooks = result.personaHooks[persona];
          const failCount = hooks?.failTriggers?.length || 0;
          const passCount = hooks?.passCriteria?.length || 0;
          const isReady = failCount === 0;
          if (isReady) readyCount++;

          const statusIcon = isReady ? "✓" : "✗";
          const freshReq = hooks?.requiresNewsWithinDays;
          const freshNote = freshReq ? ` (needs ≤${freshReq}d news)` : "";

          sections.push(`| ${statusIcon} | **${persona}** | ${PERSONA_INTENTS[persona]}${freshNote} |`);
          if (!isReady && hooks?.failTriggers) {
            hooks.failTriggers.slice(0, 2).forEach((f: string) => {
              sections.push(`|   |   | ↳ ${f} |`);
            });
          }
        }

        sections.push("");
        sections.push(`**Summary:** Ready for ${readyCount}/${allPersonas.length} personas`);
      }

      sections.push("");
      return sections.join("\n");
    } catch (error: any) {
      return `Error assessing entity "${args.entityName}": ${error.message || error}`;
    }
  },
});
