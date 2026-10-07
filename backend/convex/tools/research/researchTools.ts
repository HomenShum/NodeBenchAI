/**
 * Research Tools for Agent Runtime
 *
 * Universal research capability exposed as agent-callable tools.
 * The agent decides when to research based on user goals.
 */

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../../_generated/api";

/**
 * researchAnything - Universal multi-angle research tool
 *
 * Called by the agent when the user needs deep intelligence on:
 * - Companies (interview prep, diligence, competitive analysis)
 * - People (founders, hiring managers, speakers)
 * - Events (conferences, demo days, meetings)
 * - Topics (market trends, technologies, regulations)
 *
 * Automatically selects relevant angles based on the goal.
 */
export const researchAnything = createTool({
  description: `Run universal multi-angle research on any subject.

USE THIS WHEN:
- User asks to "research X" or "prep me for Y"
- Need intelligence before a meeting, interview, or call
- Evaluating a company, person, event, or topic
- User provides an email and wants context

INPUT EXAMPLES:
- goal: "prepare for Stripe interview", subjects: [{type: "company", name: "Stripe"}]
- goal: "who is Sarah Chen", subjects: [{type: "person", name: "Sarah Chen"}]
- goal: "research demo day speakers", subjects: [{type: "event", name: "YC Demo Day"}]

OUTPUT INCLUDES:
- briefing: 3-act executive summary (Act I, II, III)
- prep: talking points, questions to ask, risks, next actions
- evidence: source-backed claims with confidence scores
- angles: which research angles were used (entity_profile, funding_intelligence, etc.)

DEPTH LEVELS:
- quick: 3-5s, good for alerts
- standard: 8-15s, most use cases (DEFAULT)
- comprehensive: 15-30s, high-stakes decisions`,

  args: z.object({
    goal: z.string().describe("What the user wants to achieve (e.g., 'prepare for Stripe interview')"),
    subjects: z.array(z.object({
      type: z.enum(["email", "person", "company", "event", "topic", "repo", "document", "url", "text"]),
      name: z.string().optional().describe("Name of the subject"),
      id: z.string().optional().describe("Optional ID if known"),
      url: z.string().optional().describe("URL if applicable"),
      raw: z.record(z.any()).optional().describe("Raw data (e.g., email content)"),
    })).describe("What to research"),
    depth: z.enum(["quick", "standard", "comprehensive"]).optional().default("standard")
      .describe("Research depth: quick (3-5s), standard (8-15s), comprehensive (15-30s)"),
    preset: z.enum([
      "job_inbound_v1",
      "event_prep_v1",
      "founder_diligence_v1",
      "sales_account_prep_v1",
      "vendor_eval_v1",
      "market_map_v1",
      "daily_monitor_v1",
      "topic_deep_dive_v1"
    ]).optional().describe("Optional preset to bias angle selection"),
  }),

  handler: async (ctx, args) => {
    try {
      // Call the research.run action
      const result: any = await ctx.runAction(api.domains.research.researchRunAction.runResearch, {
        preset: args.preset,
        goal: {
          objective: args.goal,
          mode: "auto",
        },
        subjects: args.subjects,
        depth: args.depth,
        deliverables: ["json_full"],
        constraints: {
          freshness_days: 30,
          latency_budget_ms: args.depth === "comprehensive" ? 25000 : 15000,
          prefer_cache: true,
        },
      });

      // Format for agent consumption
      return {
        success: true,
        runId: result.run_id,
        inferredFacets: result.inferred_facets,
        briefing: result.outputs?.briefing,
        prep: result.outputs?.prep,
        evidence: result.evidence?.slice(0, 10), // Top 10 claims
        anglesUsed: result.selected_angles?.map((a: any) => ({
          angle: a.angle_id,
          mode: a.mode,
          score: a.score,
        })),
        latencyMs: result.trace?.latency_ms,
        cacheHitRatio: result.trace?.cache_hit_ratio,
        compactSummary: result.outputs?.rendered?.compact_alert || null,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Research failed",
        runId: null,
      };
    }
  },
});

/**
 * expandSubject - Single subject entity resolution
 *
 * Lightweight alternative to full research for quick lookups.
 */
export const expandSubject = createTool({
  description: `Resolve and expand a single subject (company, person, event, etc.).

USE THIS FOR:
- Quick entity resolution before deeper research
- Getting canonical identifiers
- Understanding related entities

LIGHTER than researchAnything - just resolution, no deep angles.`,

  args: z.object({
    type: z.enum(["company", "person", "event", "topic", "repo", "document", "url", "text"]),
    name: z.string().describe("Name or identifier"),
    depth: z.enum(["quick", "standard"]).optional().default("quick"),
  }),

  handler: async (ctx, args) => {
    try {
      const result: any = await ctx.runAction(api.domains.research.researchRunAction.runResearch, {
        goal: {
          objective: `Expand and resolve ${args.name}`,
          mode: "analyze",
        },
        subjects: [{ type: args.type, name: args.name }],
        depth: args.depth,
        deliverables: ["json_full"],
        constraints: {
          freshness_days: 30,
          latency_budget_ms: 8000,
          prefer_cache: true,
        },
      });

      return {
        success: true,
        subject: args.name,
        type: args.type,
        resolved: result.outputs?.briefing?.act_1 || "No resolution found",
        facets: result.inferred_facets,
        relatedEntities: result.evidence
          ?.filter((e: any) => e.claim.includes(args.name))
          .map((e: any) => e.claim)
          .slice(0, 5),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Expansion failed",
      };
    }
  },
});

/**
 * renderResearchOutput - Format research into deliverable
 *
 * Convert existing research into compact alert, email digest, etc.
 */
export const renderResearchOutput = createTool({
  description: `Render existing research into a specific format.

USE THIS TO:
- Create compact alerts for notifications
- Generate email digests
- Format for Slack/Teams
- Create Notion-ready markdown`,

  args: z.object({
    runId: z.string().describe("Research run ID from researchAnything"),
    format: z.enum(["compact_alert", "email_digest", "slack", "notion_markdown"])
      .describe("Target format"),
    maxChars: z.number().optional().default(1200),
  }),

  handler: async (ctx, args) => {
    // In production, fetch cached result and re-render
    // For now, return placeholder
    return {
      success: true,
      format: args.format,
      runId: args.runId,
      rendered: `[${args.format}] Rendering would fetch run ${args.runId} and format to ${args.maxChars} chars`,
    };
  },
});
