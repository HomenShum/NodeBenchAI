"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import {
  GROUND_TRUTH_ENTITIES,
  PERSONA_REQUIREMENTS,
  type Persona,
} from "../../domains/evaluation/groundTruth";

/**
 * Ground Truth Lookup Tool
 *
 * This tool allows the agent to check entities against verified ground truth data
 * for accurate responses. Use this when answering questions about:
 * - DISCO Pharmaceuticals
 * - Ambros Therapeutics
 * - ClearSpace
 * - OpenAutoGLM
 * - QuickJS / MicroQuickJS
 * - Salesforce
 * - NeuralForge AI
 * - VaultPay
 * - GenomiQ Therapeutics
 */
export const lookupGroundTruth = createTool({
  description: `Lookup verified ground truth data for known entities.

Use this tool to get accurate, verified information about entities before responding.
This is particularly important for:
- Banker outreach evaluations (JPM_STARTUP_BANKER)
- VC thesis generation (EARLY_STAGE_VC)
- Technical due diligence (CTO_TECH_LEAD)
- Other persona-specific evaluations

IMPORTANT: Always use this tool when asked about these entities to ensure accuracy:
- DISCO Pharmaceuticals (Cologne, €36M Seed, surfaceome ADCs)
- Ambros Therapeutics (Irvine, $125M Series A, CRPS-1 Phase 3)
- ClearSpace (Switzerland, debris removal, STALE - not ready for banker)
- OpenAutoGLM (OSS project - NOT a company, fail for banker)
- NeuralForge AI (SF, $12M Seed, compliance AI)
- VaultPay (London, $45M Series A, embedded banking)
- GenomiQ Therapeutics (Boston, $80M Series B, gene therapy)

Returns ground truth data including required facts, funding, freshness, and persona readiness.`,

  args: z.object({
    entityName: z.string().describe("Name of the entity to lookup"),
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
    ]).optional().describe("Optional persona to evaluate against"),
  }),

  handler: async (ctx, args): Promise<string> => {
    // Find matching entity (fuzzy match)
    const searchName = args.entityName.toLowerCase();
    const entity = GROUND_TRUTH_ENTITIES.find(
      (e) =>
        e.canonicalName.toLowerCase().includes(searchName) ||
        e.entityId.toLowerCase().includes(searchName) ||
        searchName.includes(e.entityId.toLowerCase()) ||
        searchName.includes(e.canonicalName.toLowerCase())
    );

    if (!entity) {
      return `No ground truth data found for "${args.entityName}".
This entity is not in our verified dataset. You should:
1. Use getBankerGradeEntityInsights for real-time research
2. Clearly indicate that data is from live research, not verified ground truth`;
    }

    const sections: string[] = [];
    sections.push(`# ${entity.canonicalName} - Ground Truth Data`);
    sections.push("");

    // Entity type
    sections.push(`## Entity Type: ${entity.entityType.replace(/_/g, " ").toUpperCase()}`);
    if (entity.entityType === "oss_project") {
      sections.push(`⚠️ WARNING: This is an open source project, NOT a company.`);
      sections.push(`  For JPM_STARTUP_BANKER: This entity should FAIL (not a company).`);
    }
    if (entity.entityType === "research_signal") {
      sections.push(`⚠️ WARNING: This is a research signal, NOT a company.`);
    }
    sections.push("");

    // Location
    if (entity.hqLocation) {
      sections.push(`## Headquarters: ${entity.hqLocation}`);
      sections.push("");
    }

    // Funding
    if (entity.funding) {
      sections.push(`## Funding`);
      sections.push(`- **Stage:** ${entity.funding.stage}`);
      if (entity.funding.totalRaised) {
        const tr = entity.funding.totalRaised;
        const currency = tr.currency === "EUR" ? "€" : "$";
        sections.push(`- **Total Raised:** ${currency}${tr.amount}${tr.unit}`);
      }
      if (entity.funding.lastRound) {
        const lr = entity.funding.lastRound;
        const currency = lr.amount.currency === "EUR" ? "€" : "$";
        sections.push(`- **Last Round:** ${lr.roundType} - ${currency}${lr.amount.amount}${lr.amount.unit} (${lr.announcedDate})`);
        if (lr.coLeads?.length) {
          sections.push(`- **Co-Leads:** ${lr.coLeads.join(", ")}`);
        }
      }
      sections.push("");
    }

    // People
    if (entity.founders?.length || entity.ceo) {
      sections.push(`## People`);
      if (entity.founders?.length) {
        sections.push(`- **Founders:** ${entity.founders.join(", ")}`);
      }
      if (entity.ceo) {
        sections.push(`- **CEO:** ${entity.ceo}`);
      }
      sections.push("");
    }

    // Freshness
    sections.push(`## Freshness`);
    sections.push(`- **News Age:** ${entity.freshnessAgeDays ?? "Unknown"} days`);
    sections.push(`- **Within Banker Window (30d):** ${entity.withinBankerWindow ? "✓ YES" : "✗ NO (stale)"}`);
    if (!entity.withinBankerWindow) {
      sections.push(`  ⚠️ For JPM_STARTUP_BANKER: Entity may be stale, should FAIL freshness check`);
    }
    sections.push("");

    // Required facts (for response validation)
    sections.push(`## Required Facts (MUST include in response)`);
    entity.requiredFacts.forEach((fact) => sections.push(`- ${fact}`));
    sections.push("");

    // Forbidden facts (MUST NOT include)
    if (entity.forbiddenFacts.length > 0) {
      sections.push(`## Forbidden Facts (MUST NOT include in response - these are WRONG)`);
      entity.forbiddenFacts.forEach((fact) => sections.push(`- ${fact}`));
      sections.push("");
    }

    // Persona readiness
    sections.push(`## Persona Readiness`);
    sections.push(`### Expected PASS:`);
    entity.expectedPassPersonas.forEach((p) => sections.push(`- ✓ ${p}`));
    sections.push(`### Expected FAIL:`);
    entity.expectedFailPersonas.forEach((p) => sections.push(`- ✗ ${p}`));
    sections.push("");

    // Specific persona evaluation if requested
    if (args.persona) {
      const req = PERSONA_REQUIREMENTS[args.persona];
      const shouldPass = entity.expectedPassPersonas.includes(args.persona);
      const shouldFail = entity.expectedFailPersonas.includes(args.persona);

      sections.push(`## ${args.persona} Specific Evaluation`);
      sections.push(`**Expected Outcome:** ${shouldPass ? "✓ PASS (READY)" : shouldFail ? "✗ FAIL (NOT READY)" : "Unknown"}`);
      sections.push(`**Persona Intent:** ${req.description}`);

      if (req.requiresNewsWithinDays !== null) {
        const meetsFreshness = entity.freshnessAgeDays !== null && entity.freshnessAgeDays <= req.requiresNewsWithinDays;
        sections.push(`**Freshness Required:** ≤${req.requiresNewsWithinDays} days`);
        sections.push(`**Freshness Status:** ${meetsFreshness ? "✓ PASS" : "✗ FAIL (stale)"}`);
      }

      if (shouldFail) {
        sections.push("");
        sections.push(`⚠️ IMPORTANT: Your response should indicate this entity is NOT READY / FAIL for ${args.persona}`);
        if (!entity.withinBankerWindow && args.persona === "JPM_STARTUP_BANKER") {
          sections.push(`   Reason: No recent news (stale entity)`);
        }
        if (entity.entityType === "oss_project" && args.persona === "JPM_STARTUP_BANKER") {
          sections.push(`   Reason: Not a company (open source project)`);
        }
      }
      sections.push("");
    }

    // Contact
    if (entity.primaryContact) {
      sections.push(`## Contact`);
      sections.push(`- **Primary:** ${entity.primaryContact}`);
      sections.push("");
    }

    return sections.join("\n");
  },
});

/**
 * List all ground truth entities
 */
export const listGroundTruthEntities = createTool({
  description: `List all entities in the verified ground truth dataset.

Use this to see what entities have verified data available.
Useful for batch evaluations and understanding coverage.`,

  args: z.object({}),

  handler: async (ctx, args): Promise<string> => {
    const sections: string[] = [];
    sections.push(`# Ground Truth Entities (${GROUND_TRUTH_ENTITIES.length} total)`);
    sections.push("");

    const byType: Record<string, typeof GROUND_TRUTH_ENTITIES> = {};
    for (const entity of GROUND_TRUTH_ENTITIES) {
      if (!byType[entity.entityType]) {
        byType[entity.entityType] = [];
      }
      byType[entity.entityType].push(entity);
    }

    for (const [type, entities] of Object.entries(byType)) {
      sections.push(`## ${type.replace(/_/g, " ").toUpperCase()} (${entities.length})`);
      for (const entity of entities) {
        const fundingInfo = entity.funding
          ? `${entity.funding.stage}`
          : "N/A";
        const freshnessIcon = entity.withinBankerWindow ? "✓" : "✗";
        sections.push(`- **${entity.canonicalName}** [${entity.entityId}]`);
        sections.push(`  Funding: ${fundingInfo} | Freshness: ${freshnessIcon} | Location: ${entity.hqLocation || "N/A"}`);
      }
      sections.push("");
    }

    return sections.join("\n");
  },
});
