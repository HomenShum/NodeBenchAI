/**
 * Digest Agent - Agent-powered digest generation for ntfy and daily brief
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 1: Agent-generated narrative synthesis
 * Phase 2: Integration with daily morning brief
 * Phase 3: Real-time breaking alerts
 *
 * Uses the same coordinator agent capabilities as FastAgentPanel but optimized
 * for digest generation with cost-efficient models.
 */

import { v } from "convex/values";
import { internalAction, action, internalMutation, internalQuery, query } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import type { Id, Doc } from "../../_generated/dataModel";
import { Agent, stepCountIs } from "@convex-dev/agent";
import { components } from "../../_generated/api";
import { z } from "zod";

// Import the language model resolver
import {
  DEFAULT_MODEL,
  getLanguageModelSafe,
  normalizeModelInput,
  FALLBACK_MODEL,
  getFreeModels,
  type ApprovedModel
} from "./mcp_tools/models";
// Quality gate: decides whether a cheap/free model's digest is good enough to
// publish, or whether to fall through to a more expensive trusted model.
import { assessDigestQuality } from "../../workflows/ainewsBriefFormat";

// Import coordinator agent for full tool access
import { createCoordinatorAgent } from "./core/coordinatorAgent";

// Import disclosure logger for progressive disclosure tracking
import { DisclosureLogger, type DisclosureSummary } from "../telemetry/disclosureEvents";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lightweight feed item for digest generation
 */
export type DigestFeedItem = {
  title: string;
  summary?: string;
  source?: string;
  tags?: string[];
  category?: string;
  score?: number;
  publishedAt?: string;
  type?: string;
  url?: string;
};

/**
 * Structured digest output from agent
 */
export type AgentDigestOutput = {
  // Header
  dateString: string;

  // Act I: The Setup
  narrativeThesis: string;
  leadStory?: {
    title: string;
    url?: string;
    whyItMatters: string;
    reflection?: {
      what: string;
      soWhat: string;
      nowWhat: string;
    };
  };

  // Act II: The Signal
  signals: Array<{
    title: string;
    url?: string;
    summary: string;
    hardNumbers?: string;
    directQuote?: string;
    reflection?: {
      what: string;
      soWhat: string;
      nowWhat: string;
    };
  }>;

  // Act III: The Move
  actionItems: Array<{
    persona: string;
    action: string;
  }>;

  // Entity Spotlight (if any significant entities)
  entitySpotlight?: Array<{
    name: string;
    type: "company" | "person" | "product" | "technology" | "topic" | "region" | "event" | "metric" | "document" | "fda_approval" | "funding_event" | "research_paper";
    keyInsight: string;
    fundingStage?: string;
    // Enhanced fields for hover preview
    keyFacts?: string[];
    sources?: Array<{ name: string; url?: string }>;
  }>;

  // Fact-Check Findings (from Instagram/social media verification)
  factCheckFindings?: Array<{
    claim: string;
    status: "verified" | "partially_verified" | "unverified" | "false";
    explanation: string;
    source?: string;
    sourceUrl?: string;
    confidence: number;
  }>;

  // Funding Rounds (startups that fundraised today)
  fundingRounds?: Array<{
    rank: number;
    companyName: string;
    roundType: string;
    amountRaw: string;
    amountUsd?: number;
    leadInvestors: string[];
    sector?: string;
    productDescription?: string;
    founderBackground?: string;
    sourceUrl?: string;
    announcedAt: number;
    confidence: number;
  }>;

  // DRANE Phase 7: Competing Explanations (optional, injected when narrative threads exist)
  competingExplanations?: Array<{
    title: string;
    explanation: string;
    evidenceLevel: "grounded" | "mixed" | "speculative";
    evidenceChecklist?: {
      hasPrimarySource: boolean;
      hasCorroboration: boolean;
      hasFalsifiableClaim: boolean;
      hasQuantitativeData: boolean;
      hasNamedAttribution: boolean;
      isReproducible: boolean;
    };
    checksPassing?: number;
    checksTotal?: number;
    measurementApproach: string;
    falsificationCriteria: string;
  }>;

  // DRANE Phase 7: Narrative context framing (optional)
  narrativeFraming?: {
    dominantStory: string;
    attentionShare: string;
    underReportedAngle: string;
  };

  // Metadata
  storyCount: number;
  topSources: string[];
  topCategories: string[];
  processingTimeMs: number;
};

const ReflectionSchema = z.object({
  what: z.string().min(1),
  soWhat: z.string().min(1),
  nowWhat: z.string().min(1),
});

const DigestSignalSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().optional(),
  summary: z.string().min(1),
  hardNumbers: z.string().optional(),
  directQuote: z.string().optional(),
  reflection: ReflectionSchema,
});

const AgentDigestObjectSchema = z.object({
  narrativeThesis: z.string().min(1),
  leadStory: z
    .object({
      title: z.string().min(1),
      url: z.string().url().optional(),
      whyItMatters: z.string().min(1),
      reflection: ReflectionSchema,
    })
    .nullable(),
  signals: z.array(DigestSignalSchema).min(1).max(8),
  actionItems: z
    .array(
      z.object({
        persona: z.string().min(1),
        action: z.string().min(1),
      }),
    )
    .min(1)
    .max(8),
  entitySpotlight: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.enum([
          "company",
          "person",
          "product",
          "technology",
          "topic",
          "region",
          "event",
          "metric",
          "document",
          // Extended types for digest
          "fda_approval",
          "funding_event",
          "research_paper",
        ]),
        keyInsight: z.string().min(1),
        fundingStage: z.string().optional(),
        // Enhanced fields for hover preview
        keyFacts: z.array(z.string()).max(3).optional(),
        sources: z
          .array(
            z.object({
              name: z.string(),
              url: z.string().url().optional(),
            }),
          )
          .max(2)
          .optional(),
      }),
    )
    .max(5)
    .optional(),
});

/**
 * Breaking alert output
 */
export type BreakingAlertOutput = {
  shouldAlert: boolean;
  urgency: "critical" | "high" | "medium" | "low";
  title: string;
  body: string;
  tags: string[];
  relatedEntities: string[];
  reasoning: string;
};

// ═══════════════════════════════════════════════════════════════════════════
// PERSONA CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Persona-specific digest configurations
 * Maps to the 10 personas in the benchmark suite
 */
export const PERSONA_CONFIGS = {
  JPM_STARTUP_BANKER: {
    focus: "funding rounds, M&A activity, deal flow opportunities, investor movements",
    priorityCategories: ["funding", "acquisition", "ipo", "fintech"],
    actionPrompt: "Generate outreach targets, secondary opportunities, and deal flow insights",
    tags: ["money_with_wings", "chart_with_upwards_trend", "briefcase"],
  },
  EARLY_STAGE_VC: {
    focus: "seed/Series A rounds, emerging market signals, thesis validation, competitive landscape",
    priorityCategories: ["funding", "startup", "ai_ml", "enterprise"],
    actionPrompt: "Generate thesis validation points, investment opportunities, and market signals",
    tags: ["rocket", "seedling", "mag"],
  },
  CTO_TECH_LEAD: {
    focus: "technical architecture, security vulnerabilities, adoption patterns, engineering trends",
    priorityCategories: ["security", "opensource", "infrastructure", "devtools"],
    actionPrompt: "Generate technical risks to review, adoption opportunities, and architecture decisions",
    tags: ["gear", "shield", "wrench"],
  },
  FOUNDER_STRATEGY: {
    focus: "market positioning, competitive moves, strategic pivots, fundraising signals",
    priorityCategories: ["strategy", "competition", "funding", "market"],
    actionPrompt: "Generate strategic pivots, market positioning insights, and competitive responses",
    tags: ["chess_pawn", "dart", "bulb"],
  },
  ACADEMIC_RD: {
    focus: "research papers, methodology, replication signals, scientific rigor, and limitations",
    priorityCategories: ["research", "paper", "method", "study"],
    actionPrompt: "Generate papers to read, methods to verify, and next experiments/replications",
    tags: ["microscope", "books", "test_tube"],
  },
  ENTERPRISE_EXEC: {
    focus: "vendor risk, procurement readiness, unit economics, governance, and P&L impact",
    priorityCategories: ["pricing", "vendor", "enterprise", "security"],
    actionPrompt: "Generate procurement next steps, cost model checkpoints, and risk mitigations",
    tags: ["office", "moneybag", "clipboard"],
  },
  ECOSYSTEM_PARTNER: {
    focus: "partnership plays, second-order effects, beneficiaries, and ecosystem shifts",
    priorityCategories: ["partnership", "platform", "ecosystem", "market"],
    actionPrompt: "Generate partner outreach, co-sell ideas, and ecosystem bets to validate",
    tags: ["handshake", "link", "globe_with_meridians"],
  },
  QUANT_ANALYST: {
    focus: "signals, time-series hooks, measurable KPIs, and what to track over time",
    priorityCategories: ["metrics", "signal", "timeline", "data"],
    actionPrompt: "Generate trackable KPIs, data sources, and monitoring follow-ups",
    tags: ["chart_with_upwards_trend", "bar_chart", "mag_right"],
  },
  PRODUCT_DESIGNER: {
    focus: "UI-ready schemas, information architecture, confidence/freshness UX, and rendering needs",
    priorityCategories: ["product", "ui", "design", "schema"],
    actionPrompt: "Generate UI-ready sections, missing-field UX, and validation tasks for rendering",
    tags: ["art", "pencil", "card_index_dividers"],
  },
  SALES_ENGINEER: {
    focus: "shareable one-screen summaries, objections/answers, talk tracks, and outbound packaging",
    priorityCategories: ["sales", "outbound", "market", "enterprise"],
    actionPrompt: "Generate one-pagers, talk tracks, and objection handling for sharing",
    tags: ["megaphone", "handshake", "page_facing_up"],
  },
  PM_PRODUCT_MANAGER: {
    focus: "product launches, user behavior trends, feature adoption, market needs",
    priorityCategories: ["product", "user_research", "saas", "consumer"],
    actionPrompt: "Generate product roadmap insights, user need signals, and feature prioritization",
    tags: ["package", "bar_chart", "clipboard"],
  },
  ML_ENGINEER: {
    focus: "model releases, training techniques, MLOps, benchmarks, research papers",
    priorityCategories: ["ai_ml", "research", "opensource", "infrastructure"],
    actionPrompt: "Generate model evaluation tasks, technique adoption opportunities, and research to review",
    tags: ["robot", "brain", "microscope"],
  },
  SECURITY_ANALYST: {
    focus: "CVEs, breaches, compliance, threat intelligence, security tools",
    priorityCategories: ["security", "compliance", "privacy", "infrastructure"],
    actionPrompt: "Generate vulnerability assessments, compliance reviews, and threat mitigations",
    tags: ["warning", "lock", "shield"],
  },
  GROWTH_MARKETER: {
    focus: "viral trends, channel opportunities, competitive marketing, brand moves",
    priorityCategories: ["marketing", "social", "growth", "consumer"],
    actionPrompt: "Generate channel experiments, content opportunities, and competitive positioning",
    tags: ["chart_with_upwards_trend", "loudspeaker", "fire"],
  },
  DATA_ANALYST: {
    focus: "data tools, analytics platforms, visualization, data infrastructure",
    priorityCategories: ["data", "analytics", "infrastructure", "enterprise"],
    actionPrompt: "Generate data pipeline improvements, tool evaluations, and metric frameworks",
    tags: ["bar_chart", "floppy_disk", "mag_right"],
  },
  GENERAL: {
    focus: "broad tech and business news, major announcements, industry trends",
    priorityCategories: ["ai_ml", "funding", "security", "opensource"],
    actionPrompt: "Generate actionable insights for each persona type",
    tags: ["newspaper", "robot", "briefcase"],
  },
} as const;

export type DigestPersona = keyof typeof PERSONA_CONFIGS;

// ═══════════════════════════════════════════════════════════════════════════
// SKILL RETRIEVAL HELPERS (Progressive Disclosure Integration)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert a persona key to its corresponding skill name.
 * E.g., "JPM_STARTUP_BANKER" -> "digest-jpm-startup-banker"
 */
function personaToSkillName(persona: string): string {
  return `digest-${persona.toLowerCase().replace(/_/g, "-")}`;
}

/**
 * Try to load a persona-specific skill from the registry.
 * Falls back to PERSONA_CONFIGS if skill not found.
 *
 * @returns Object with personaInstructions, tags, and disclosure metadata
 */
async function loadPersonaSkill(
  ctx: any,
  persona: string,
  logger: DisclosureLogger
): Promise<{
  personaInstructions: string;
  priorityCategories: readonly string[];
  tags: readonly string[];
  fromSkill: boolean;
  skillName: string | null;
}> {
  const skillName = personaToSkillName(persona);
  const fallbackConfig = PERSONA_CONFIGS[persona as DigestPersona] || PERSONA_CONFIGS.GENERAL;

  try {
    // Search for the skill
    logger.logSkillSearch(`digest ${persona}`, [], 1);

    const searchResult = await ctx.runQuery(
      internal.tools.meta.skillDiscoveryQueries.getSkillByName,
      { name: skillName }
    );

    if (searchResult && searchResult.fullInstructions) {
      // Log skill describe (L2 expansion)
      const tokensAdded = Math.ceil(searchResult.fullInstructions.length / 4);
      logger.logSkillDescribe(skillName, tokensAdded);

      console.log(`[digestAgent] Loaded skill "${skillName}" (${tokensAdded} tokens)`);

      return {
        personaInstructions: searchResult.fullInstructions,
        priorityCategories: searchResult.keywords || fallbackConfig.priorityCategories,
        tags: fallbackConfig.tags, // Keep original tags for ntfy formatting
        fromSkill: true,
        skillName,
      };
    }

    // Skill not found - log fallback and use PERSONA_CONFIGS
    logger.logSkillFallback(`digest ${persona}`, `Skill "${skillName}" not found`);
    console.log(`[digestAgent] Skill "${skillName}" not found, using PERSONA_CONFIGS fallback`);

    return {
      personaInstructions: `Focus: ${fallbackConfig.focus}\n\nAction: ${fallbackConfig.actionPrompt}`,
      priorityCategories: fallbackConfig.priorityCategories,
      tags: fallbackConfig.tags,
      fromSkill: false,
      skillName: null,
    };
  } catch (error) {
    // Query failed - log fallback
    logger.logSkillFallback(`digest ${persona}`, `Error: ${error instanceof Error ? error.message : String(error)}`);
    console.warn(`[digestAgent] Skill lookup failed for "${skillName}":`, error);

    return {
      personaInstructions: `Focus: ${fallbackConfig.focus}\n\nAction: ${fallbackConfig.actionPrompt}`,
      priorityCategories: fallbackConfig.priorityCategories,
      tags: fallbackConfig.tags,
      fromSkill: false,
      skillName: null,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const DIGEST_GENERATION_PROMPT = `You are a senior intelligence analyst generating a morning digest for NodeBench AI.

Your task is to analyze the provided feed items and generate a structured digest following the "3-Act" format:

## ACT I: THE SETUP (Narrative Thesis)
- Identify the ONE dominant theme across today's news
- Write a compelling 2-3 sentence thesis that captures "what's happening and why it matters"
- Pick the lead story that best exemplifies this theme

## ACT II: THE SIGNAL (Top Stories)
For each of the top 5-7 stories:
- Extract the core signal (not just summary - the actionable insight)
- Include hard numbers if available (funding amounts, growth rates, user counts)
- Include a direct quote if impactful
- Explain why this matters to the target persona (or across personas if persona=GENERAL)

## ACT III: THE MOVE (Action Items)
Generate 3-5 specific action items, tagged by persona:
- JPM_STARTUP_BANKER: Outreach targets, deal flow opportunities
- EARLY_STAGE_VC: Thesis validation, competitive intelligence
- CTO_TECH_LEAD: Technical risks, adoption opportunities
- FOUNDER_STRATEGY: Strategic pivots, market positioning
- ACADEMIC_RD: Papers to read, methods to verify, next experiments
- ENTERPRISE_EXEC: Procurement next steps, unit economics, vendor risk
- ECOSYSTEM_PARTNER: Partnership plays, second-order effects
- QUANT_ANALYST: Trackable KPIs, time-series hooks
- PRODUCT_DESIGNER: UI schema, missing-fields UX, rendering checks
- SALES_ENGINEER: One-screen shareable, objections, talk track

## ENTITY SPOTLIGHT
If any companies/entities are mentioned multiple times or have significant news:
- Highlight the top 2-3 entities
- Provide banker-grade insight (funding stage, key people, why they matter)

## QUALITY RULES
1. NO fabricated URLs - only reference URLs from the feed items
2. NO invented numbers - only use data from the source
3. Keep total output under 3500 characters for ntfy compatibility
4. Prioritize signal over noise - skip fluff, focus on actionable insights
5. Be specific - names, numbers, dates over vague statements

Output your analysis as a structured response that can be parsed.`;

const BREAKING_ALERT_PROMPT = `You are a breaking news detector for NodeBench AI.

Analyze the provided story/event and determine if it warrants an immediate push notification.

## ALERT CRITERIA (at least one must be true for shouldAlert=true)

**CRITICAL** (immediate notification):
- Major funding round ($50M+) announced
- Significant acquisition or merger
- Major security vulnerability (CVE with high severity)
- Regulatory action against major company
- Major product launch from tracked entity

**HIGH** (notify within 1 hour):
- Notable funding round ($10M-$50M)
- Key executive change at tracked company
- Significant partnership announcement
- Breaking tech industry news

**MEDIUM** (include in next digest):
- Standard funding rounds
- Product updates
- Industry trend shifts

**LOW** (log only):
- Routine updates
- Opinion pieces
- Speculation

## OUTPUT REQUIREMENTS
- Be conservative - only alert for genuinely important news
- Consider the user's likely sleep/work schedule
- Avoid alert fatigue - max 3-5 alerts per day
- Include enough context that the notification is self-contained`;

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1: AGENT DIGEST GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a morning digest using the coordinator agent
 *
 * This replaces the deterministic buildNtfyDigestPayload with agent reasoning.
 * Uses a cost-efficient model (haiku) but has full tool access if needed.
 */
export const generateAgentDigest = internalAction({
  args: {
    feedItems: v.array(v.object({
      title: v.string(),
      summary: v.optional(v.string()),
      source: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      category: v.optional(v.string()),
      score: v.optional(v.number()),
      publishedAt: v.optional(v.string()),
      type: v.optional(v.string()),
      url: v.optional(v.string()),
    })),
    persona: v.optional(v.string()),
    maxLength: v.optional(v.number()),
    model: v.optional(v.string()),
    useTools: v.optional(v.boolean()), // Enable tool use for deeper analysis
    outputMode: v.optional(v.union(v.literal("structured"), v.literal("text"))),
    useCache: v.optional(v.boolean()),
    cacheTtlHours: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    digest: AgentDigestOutput | null;
    rawText: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      model: string;
    };
    cache?: { hit: boolean; id: Id<"digestCache"> | null };
    error?: string;
  }> => {
    const startTime = Date.now();
    const model = normalizeModelInput(args.model || "claude-haiku-4.5");
    const maxLength = args.maxLength || 3500;
    const persona = args.persona || "GENERAL";
    const useTools = args.useTools ?? false;
    const outputMode = (args.outputMode ?? "structured") as "structured" | "text";
    const useCache = args.useCache ?? true;
    const cacheTtlHours = args.cacheTtlHours ?? 24;

    console.log(`[digestAgent] Generating digest for ${args.feedItems.length} items, persona=${persona}, model=${model}, useTools=${useTools}`);

    // Initialize disclosure logger for progressive disclosure tracking
    const sessionId = `digest-${persona}-${Date.now()}`;
    const disclosureLogger = new DisclosureLogger(sessionId, "digest");

    // Load persona skill (with fallback to PERSONA_CONFIGS)
    const personaSkill = await loadPersonaSkill(ctx, persona, disclosureLogger);
    console.log(`[digestAgent] Persona skill loaded: fromSkill=${personaSkill.fromSkill}, skillName=${personaSkill.skillName}`);

    // Filter and prioritize feed items based on persona
    const prioritizedItems = [...args.feedItems].sort((a, b) => {
      // Boost items matching persona's priority categories
      const aBoost = personaSkill.priorityCategories.some((cat: string) =>
        a.category?.toLowerCase().includes(cat) || a.tags?.some((t: string) => t.toLowerCase().includes(cat))
      ) ? 10 : 0;
      const bBoost = personaSkill.priorityCategories.some((cat: string) =>
        b.category?.toLowerCase().includes(cat) || b.tags?.some((t: string) => t.toLowerCase().includes(cat))
      ) ? 10 : 0;

      return (bBoost + (b.score || 0)) - (aBoost + (a.score || 0));
    });

    // Build the prompt with feed items
    const feedItemsSummary = prioritizedItems
      .slice(0, 30) // Limit to top 30 for context window
      .map((item: typeof args.feedItems[0], idx: number) => {
        const parts = [`${idx + 1}. "${item.title}"`];
        if (item.source) parts.push(`[${item.source}]`);
        if (item.url) parts.push(`(${item.url})`);
        if (item.summary) parts.push(`- ${item.summary.slice(0, 150)}...`);
        if (item.score) parts.push(`Score: ${item.score}`);
        if (item.tags?.length) parts.push(`Tags: ${item.tags.slice(0, 5).join(", ")}`);
        return parts.join(" ");
      })
      .join("\n");

    const dateString = new Date().toISOString().slice(0, 10);

    // Cache lookup (skip regeneration if we already computed today's digest for this persona/model)
    if (useCache) {
      try {
        const cached = await ctx.runQuery(internal.domains.agents.digestAgent.getCachedDigest, {
          dateString,
          persona,
        });

        if (cached && cached.model === model && cached.feedItemCount === args.feedItems.length) {
          return {
            digest: cached.digest as AgentDigestOutput,
            rawText: cached.rawText,
            usage: {
              inputTokens: cached.usage?.inputTokens ?? 0,
              outputTokens: cached.usage?.outputTokens ?? 0,
              model,
            },
            cache: { hit: true, id: cached._id as Id<"digestCache"> },
          };
        }
      } catch (e) {
        console.warn("[digestAgent] Cache lookup failed (continuing):", e instanceof Error ? e.message : String(e));
      }
    }

    // Build persona-specific prompt section using skill instructions (or fallback)
    const personaPromptSection = persona !== "GENERAL" ? `
## PERSONA-SPECIFIC FOCUS
You are generating this digest for a ${persona.replace(/_/g, " ")} persona.
${personaSkill.fromSkill ? `
### Loaded from Skill Registry: ${personaSkill.skillName}
${personaSkill.personaInstructions}
` : `
${personaSkill.personaInstructions}
`}
Priority categories: ${personaSkill.priorityCategories.join(", ")}
In **ACTION_ITEMS**, tag every action with persona="${persona}".
` : "";

    const reflectionPrompt = `
## REFLECTION FRAMEWORK (What? / So What? / Now What?)
For the lead story and each signal, include a short reflection:
- What: what concretely happened (facts)
- So What: why it matters (impact)
- Now What: the next step/action implied
`;

    const structuredPrompt = `${DIGEST_GENERATION_PROMPT}

## TODAY'S DATE
${dateString}

## TARGET PERSONA
${persona}
${personaPromptSection}
${reflectionPrompt}
## MAX OUTPUT LENGTH
${maxLength} characters

## FEED ITEMS TO ANALYZE (${args.feedItems.length} total, showing top 30)

${feedItemsSummary}

---

Return ONLY a JSON object with exactly these keys:
- narrativeThesis: string
- leadStory: { title: string, url?: string, whyItMatters: string, reflection: { what: string, soWhat: string, nowWhat: string } } | null
- signals: Array<{ title: string, url?: string, summary: string, hardNumbers?: string, directQuote?: string, reflection: { what: string, soWhat: string, nowWhat: string } }>
- actionItems: Array<{ persona: string, action: string }>
- entitySpotlight?: Array<{ name: string, type: string, keyInsight: string, fundingStage?: string }>

Rules:
- No markdown, no prose, no comments: JSON only.
- Keep signals between 3 and 7 items.
- Keep actionItems between 3 and 6 items.
- For actionItems[].persona: ${persona === "GENERAL"
    ? `Use DIVERSE persona names from this list based on which persona would benefit most from each action: JPM_STARTUP_BANKER, EARLY_STAGE_VC, CTO_TECH_LEAD, FOUNDER_STRATEGY, ML_ENGINEER, SECURITY_ANALYST, PM_PRODUCT_MANAGER, QUANT_ANALYST. Each action item should target the most relevant persona.`
    : `Every actionItems[].persona MUST be exactly "${persona}".`}
- For entitySpotlight[].fundingStage: Use simple values like "N/A", "Seed", "Series A", "Series B", "IPO", "Acquired" without additional commentary.
`;

    const prompt = `${DIGEST_GENERATION_PROMPT}

## TODAY'S DATE
${dateString}

## TARGET PERSONA
${persona}
${personaPromptSection}
${reflectionPrompt}
## MAX OUTPUT LENGTH
${maxLength} characters

## FEED ITEMS TO ANALYZE (${args.feedItems.length} total, showing top 30)

${feedItemsSummary}

---

Now generate the digest following the 3-Act structure. Be concise and actionable.

Output your response in this exact format:

**NARRATIVE_THESIS**
[Your 2-3 sentence thesis here]

**LEAD_STORY**
Title: [title]
URL: [url or "none"]
Why It Matters: [explanation]

**SIGNALS**
1. Title: [title]
   URL: [url or "none"]
   Summary: [signal summary]
   Hard Numbers: [numbers or "none"]
   Quote: [quote or "none"]

[Continue for 5-7 signals]

**ACTION_ITEMS**
${persona === "GENERAL"
    ? `Use DIVERSE persona names from: JPM_STARTUP_BANKER, EARLY_STAGE_VC, CTO_TECH_LEAD, FOUNDER_STRATEGY, ML_ENGINEER, SECURITY_ANALYST, PM_PRODUCT_MANAGER, QUANT_ANALYST. Match each action to the most relevant persona.`
    : `All actions must use persona="${persona}".`}
- [PERSONA_NAME]: [action]
[Continue for 3-5 actions]

**ENTITY_SPOTLIGHT**
- Name: [entity name]
  Type: [company/person/topic]
  Key Insight: [insight]
  Funding: [N/A or Seed/Series A/B/C/IPO/Acquired - simple label only]

[Continue for top 2-3 entities]`;

    try {
      let result: { text: string; usage?: { promptTokens?: number; completionTokens?: number } };

      if (useTools) {
        // Full coordinator agent with tool access
        const agent = createCoordinatorAgent(model);
        const threadId = `digest-${dateString}-${Date.now()}`;

        // Create a temporary thread for the digest
        const thread = await ctx.runMutation(internal.domains.agents.fastAgentPanelStreaming.createThreadInternal, {
          title: `Digest Generation ${dateString}`,
          initialMessage: prompt,
        });

        const agentResult = await agent.generateText(
          ctx as any,
          { threadId: thread.agentThreadId },
          { prompt }
        );

        result = {
          text: agentResult.text,
          usage: {
            promptTokens: (agentResult as any).usage?.promptTokens || 0,
            completionTokens: (agentResult as any).usage?.completionTokens || 0,
          }
        };
      } else {
        // Simple generation without tools (faster, cheaper)
        // Prefer structured output to avoid brittle regex parsing.
        const { generateObject, generateText } = await import("ai");
        const languageModel = getLanguageModelSafe(model);

        if (outputMode === "structured") {
          try {
            const aiResult = await generateObject({
              model: languageModel,
              schema: AgentDigestObjectSchema,
              prompt: structuredPrompt,
            });

            const obj = aiResult.object;
            const digest: AgentDigestOutput = {
              dateString,
              narrativeThesis: obj.narrativeThesis,
              leadStory: obj.leadStory
                ? {
                  title: obj.leadStory.title,
                  url: obj.leadStory.url,
                  whyItMatters: obj.leadStory.whyItMatters,
                  reflection: obj.leadStory.reflection,
                }
                : undefined, // Convex schema requires undefined, not null
              signals: obj.signals,
              actionItems: obj.actionItems,
              entitySpotlight: obj.entitySpotlight,
              storyCount: args.feedItems.length,
              topSources: [],
              topCategories: [],
              processingTimeMs: Date.now() - startTime,
            };

            // Compute top sources/categories deterministically from feed items.
            const sourceCounts = new Map<string, number>();
            const categoryCounts = new Map<string, number>();
            for (const item of args.feedItems) {
              if (item.source) sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1);
              if (item.category) categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
            }
            digest.topSources = Array.from(sourceCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([s]) => s);
            digest.topCategories = Array.from(categoryCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([c]) => c);

            const promptTokens = (aiResult.usage as any)?.inputTokens || (aiResult.usage as any)?.promptTokens || 0;
            const completionTokens = (aiResult.usage as any)?.outputTokens || (aiResult.usage as any)?.completionTokens || 0;

            const cacheId = await ctx.runMutation(internal.domains.agents.digestAgent.cacheDigest, {
              dateString,
              persona,
              model,
              rawText: JSON.stringify(obj),
              digest,
              usage: { inputTokens: promptTokens, outputTokens: completionTokens },
              feedItemCount: args.feedItems.length,
              ttlHours: cacheTtlHours,
            });

            return {
              digest,
              rawText: JSON.stringify(obj),
              usage: { inputTokens: promptTokens, outputTokens: completionTokens, model },
              cache: { hit: false, id: cacheId as Id<"digestCache"> },
            };
          } catch (e: any) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`[digestAgent] Structured output failed; falling back to text mode: ${msg}`);
          }
        }

        const aiResult = await generateText({ model: languageModel, prompt });
        result = {
          text: aiResult.text,
          usage: {
            promptTokens: (aiResult.usage as any)?.inputTokens || (aiResult.usage as any)?.promptTokens || 0,
            completionTokens: (aiResult.usage as any)?.outputTokens || (aiResult.usage as any)?.completionTokens || 0,
          },
        };
      }

      // Parse the structured output (now placed after the if/else block)
      const digest = parseDigestOutput(result.text, dateString, args.feedItems, startTime);

      console.log(`[digestAgent] Digest generated in ${Date.now() - startTime}ms, ${result.text.length} chars`);

      let cacheId: Id<"digestCache"> | null = null;
      try {
        if (digest) {
          cacheId = await ctx.runMutation(internal.domains.agents.digestAgent.cacheDigest, {
            dateString,
            persona,
            model,
            rawText: result.text,
            digest,
            usage: { inputTokens: result.usage?.promptTokens || 0, outputTokens: result.usage?.completionTokens || 0 },
            feedItemCount: args.feedItems.length,
            ttlHours: cacheTtlHours,
          });
        }
      } catch (e) {
        console.warn("[digestAgent] Cache write failed (continuing):", e instanceof Error ? e.message : String(e));
      }

      return {
        digest,
        rawText: result.text,
        usage: {
          inputTokens: result.usage?.promptTokens || 0,
          outputTokens: result.usage?.completionTokens || 0,
          model,
        },
        cache: { hit: false, id: cacheId },
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[digestAgent] Error generating digest:`, errorMessage);
      return {
        digest: null,
        rawText: "",
        usage: { inputTokens: 0, outputTokens: 0, model },
        cache: { hit: false, id: null },
        error: errorMessage,
      };
    }
  },
});

/**
 * Parse the agent's text output into structured digest format
 */
function parseDigestOutput(
  text: string,
  dateString: string,
  feedItems: DigestFeedItem[],
  startTime: number
): AgentDigestOutput | null {
  try {
    // Extract sections using markers
    const narrativeMatch = text.match(/\*\*NARRATIVE_THESIS\*\*\s*([\s\S]*?)(?=\*\*LEAD_STORY\*\*|$)/i);
    const leadMatch = text.match(/\*\*LEAD_STORY\*\*\s*([\s\S]*?)(?=\*\*SIGNALS\*\*|$)/i);
    const signalsMatch = text.match(/\*\*SIGNALS\*\*\s*([\s\S]*?)(?=\*\*ACTION_ITEMS\*\*|$)/i);
    const actionsMatch = text.match(/\*\*ACTION_ITEMS\*\*\s*([\s\S]*?)(?=\*\*ENTITY_SPOTLIGHT\*\*|$)/i);
    const entitiesMatch = text.match(/\*\*ENTITY_SPOTLIGHT\*\*\s*([\s\S]*?)$/i);

    const narrativeThesis = narrativeMatch?.[1]?.trim() || "Today's news highlights emerging trends across tech and finance.";

    // Parse lead story
    let leadStory: AgentDigestOutput["leadStory"] = undefined;
    if (leadMatch) {
      const leadText = leadMatch[1];
      const titleMatch = leadText.match(/Title:\s*(.+?)(?:\n|$)/i);
      const urlMatch = leadText.match(/URL:\s*(.+?)(?:\n|$)/i);
      const whyMatch = leadText.match(/Why It Matters:\s*([\s\S]*?)(?=\n\n|$)/i);

      if (titleMatch) {
        leadStory = {
          title: titleMatch[1].trim(),
          url: urlMatch?.[1]?.trim() !== "none" ? urlMatch?.[1]?.trim() : undefined,
          whyItMatters: whyMatch?.[1]?.trim() || "",
        };
      }
    }

    // Parse signals
    const signals: AgentDigestOutput["signals"] = [];
    if (signalsMatch) {
      const signalBlocks = signalsMatch[1].split(/\d+\.\s+Title:/i).filter(Boolean);
      for (const block of signalBlocks.slice(0, 7)) {
        const titleMatch = block.match(/^(.+?)(?:\n|$)/);
        const urlMatch = block.match(/URL:\s*(.+?)(?:\n|$)/i);
        const summaryMatch = block.match(/Summary:\s*(.+?)(?:\n|$)/i);
        const numbersMatch = block.match(/Hard Numbers:\s*(.+?)(?:\n|$)/i);
        const quoteMatch = block.match(/Quote:\s*(.+?)(?:\n|$)/i);

        if (titleMatch && summaryMatch) {
          signals.push({
            title: titleMatch[1].trim(),
            url: urlMatch?.[1]?.trim() !== "none" ? urlMatch?.[1]?.trim() : undefined,
            summary: summaryMatch[1].trim(),
            hardNumbers: numbersMatch?.[1]?.trim() !== "none" ? numbersMatch?.[1]?.trim() : undefined,
            directQuote: quoteMatch?.[1]?.trim() !== "none" ? quoteMatch?.[1]?.trim() : undefined,
          });
        }
      }
    }

    // Persona name normalization map: common LLM outputs -> valid PERSONA_CONFIGS keys
    const PERSONA_NORMALIZATION: Record<string, string> = {
      // Direct matches
      "JPM_STARTUP_BANKER": "JPM_STARTUP_BANKER",
      "EARLY_STAGE_VC": "EARLY_STAGE_VC",
      "CTO_TECH_LEAD": "CTO_TECH_LEAD",
      "FOUNDER_STRATEGY": "FOUNDER_STRATEGY",
      "ACADEMIC_RD": "ACADEMIC_RD",
      "ENTERPRISE_EXEC": "ENTERPRISE_EXEC",
      "ECOSYSTEM_PARTNER": "ECOSYSTEM_PARTNER",
      "QUANT_ANALYST": "QUANT_ANALYST",
      "PRODUCT_DESIGNER": "PRODUCT_DESIGNER",
      "SALES_ENGINEER": "SALES_ENGINEER",
      "PM_PRODUCT_MANAGER": "PM_PRODUCT_MANAGER",
      "ML_ENGINEER": "ML_ENGINEER",
      "SECURITY_ANALYST": "SECURITY_ANALYST",
      "GROWTH_MARKETER": "GROWTH_MARKETER",
      "DATA_ANALYST": "DATA_ANALYST",
      "GENERAL": "GENERAL",
      // Common LLM variations
      "CTO_PERSONA": "CTO_TECH_LEAD",
      "CTO": "CTO_TECH_LEAD",
      "VC_PERSONA": "EARLY_STAGE_VC",
      "VC": "EARLY_STAGE_VC",
      "FOUNDER_PERSONA": "FOUNDER_STRATEGY",
      "FOUNDER": "FOUNDER_STRATEGY",
      "BANKER_PERSONA": "JPM_STARTUP_BANKER",
      "BANKER": "JPM_STARTUP_BANKER",
      "JPM_BANKER": "JPM_STARTUP_BANKER",
      "JPM": "JPM_STARTUP_BANKER",
      "ANALYST_PERSONA": "QUANT_ANALYST",
      "ANALYST": "QUANT_ANALYST",
      "PM_PERSONA": "PM_PRODUCT_MANAGER",
      "PM": "PM_PRODUCT_MANAGER",
      "PRODUCT_MANAGER": "PM_PRODUCT_MANAGER",
      "ENGINEER_PERSONA": "ML_ENGINEER",
      "ENGINEER": "ML_ENGINEER",
      "SECURITY_PERSONA": "SECURITY_ANALYST",
      "SECURITY": "SECURITY_ANALYST",
      "MARKETING_PERSONA": "GROWTH_MARKETER",
      "MARKETER": "GROWTH_MARKETER",
      "EXEC_PERSONA": "ENTERPRISE_EXEC",
      "EXEC": "ENTERPRISE_EXEC",
      "DATA_PERSONA": "DATA_ANALYST",
      "DATA": "DATA_ANALYST",
      "RESEARCHER": "ACADEMIC_RD",
      "ACADEMIC": "ACADEMIC_RD",
      "PARTNER": "ECOSYSTEM_PARTNER",
      "DESIGNER": "PRODUCT_DESIGNER",
      "SALES": "SALES_ENGINEER",
    };

    // Normalize a persona name to a valid PERSONA_CONFIGS key
    const normalizePersona = (raw: string): string => {
      const upper = raw.trim().toUpperCase().replace(/\s+/g, "_");
      return PERSONA_NORMALIZATION[upper] || "GENERAL";
    };

    // Parse action items with fuzzy matching for various LLM output formats
    const actionItems: AgentDigestOutput["actionItems"] = [];
    if (actionsMatch) {
      const actionText = actionsMatch[1];
      const actionLines = actionText.split("\n").filter(line => line.trim().length > 0);

      // Multiple regex patterns to handle various LLM output formats
      const actionPatterns = [
        /-\s*\[(\w+(?:_\w+)*)\]:\s*(.+)/i,           // - [PERSONA]: action
        /-\s*\[(\w+(?:_\w+)*)\]\s+(.+)/i,            // - [PERSONA] action
        /-\s*(\w+(?:_\w+)*):\s*(.+)/i,              // - PERSONA: action
        /\*\*(\w+(?:_\w+)*)\*\*:\s*(.+)/i,          // **PERSONA**: action
        /(\w+(?:_\w+)*):\s*(.+)/i,                  // PERSONA: action (no dash)
        /-\s*\((\w+(?:_\w+)*)\)\s*(.+)/i,           // - (PERSONA) action
      ];

      for (const line of actionLines.slice(0, 8)) { // Check more lines, filter to 5 later
        let matched = false;
        for (const pattern of actionPatterns) {
          const match = line.match(pattern);
          if (match && match[1] && match[2]) {
            // Normalize persona name to valid PERSONA_CONFIGS key
            const rawPersona = match[1].trim().toUpperCase().replace(/\s+/g, "_");
            const action = match[2].trim();

            // Skip if action is too short, looks like a header, or persona is a partial word like "SERIES"
            if (action.length > 10 && !action.startsWith("**") && rawPersona.length > 2) {
              const persona = normalizePersona(rawPersona);
              // Skip if normalization returned GENERAL but the raw didn't look like GENERAL
              if (persona !== "GENERAL" || rawPersona === "GENERAL") {
                actionItems.push({ persona, action });
                matched = true;
                break;
              }
            }
          }
        }

        // Fallback: if line contains known persona keywords
        if (!matched) {
          const knownPersonas = ["JPM", "BANKER", "VC", "CTO", "FOUNDER", "ANALYST", "PM", "ENGINEER", "SECURITY", "EXEC", "DATA"];
          for (const keyword of knownPersonas) {
            if (line.toUpperCase().includes(keyword)) {
              const colonIdx = line.indexOf(":");
              if (colonIdx > 0) {
                const action = line.slice(colonIdx + 1).trim();
                if (action.length > 10) {
                  actionItems.push({
                    persona: normalizePersona(keyword),
                    action
                  });
                  break;
                }
              }
            }
          }
        }
      }
    }

    // Deduplicate and limit to 5
    const seenActions = new Set<string>();
    const uniqueActionItems = actionItems.filter(item => {
      const key = `${item.persona}:${item.action.slice(0, 50)}`;
      if (seenActions.has(key)) return false;
      seenActions.add(key);
      return true;
    }).slice(0, 5);

    // Parse entity spotlight with improved markdown cleanup
    const entitySpotlight: AgentDigestOutput["entitySpotlight"] = [];
    if (entitiesMatch) {
      const entityText = entitiesMatch[1];

      // Multiple split patterns for different LLM output formats
      // Split on "- Name:" or "- **Name:**" or numbered lists "1. Name:"
      const entityBlocks = entityText.split(/(?:^|\n)(?:-\s*(?:\*\*)?Name(?:\*\*)?:|\d+\.\s*(?:\*\*)?Name(?:\*\*)?:)/i).filter(Boolean);

      for (const block of entityBlocks.slice(0, 3)) {
        // Clean up the name - extract first line and remove markdown
        let name = block.split("\n")[0].trim();
        // Remove leading markdown artifacts like "**Name:**", "- **", etc.
        name = name.replace(/^[\s\-*]+/, "").replace(/\*\*/g, "").replace(/^Name:\s*/i, "").trim();

        // Parse other fields
        const typeMatch = block.match(/(?:\*\*)?Type(?:\*\*)?:\s*(.+?)(?:\n|$)/i);
        const insightMatch = block.match(/(?:\*\*)?Key Insight(?:\*\*)?:\s*(.+?)(?:\n|$)/i);
        const fundingMatch = block.match(/(?:\*\*)?Funding(?:Stage)?(?:\*\*)?:\s*(.+?)(?:\n|$)/i);

        // Clean up extracted values (remove markdown artifacts)
        const cleanValue = (val: string | undefined): string | undefined => {
          if (!val) return undefined;
          return val.replace(/\*\*/g, "").trim();
        };

        // Clean funding stage to just the stage label (remove extra commentary)
        const cleanFundingStage = (val: string | undefined): string | undefined => {
          if (!val) return undefined;
          const cleaned = val.replace(/\*\*/g, "").trim();
          // Extract just the funding stage label
          const stageMatch = cleaned.match(/^(N\/A|Seed|Series\s*[A-F]|IPO|Pre-Seed|Growth|Acquired|Public|Private)/i);
          if (stageMatch) return stageMatch[1];
          // If it starts with N/A, just return N/A
          if (cleaned.toLowerCase().startsWith("n/a")) return "N/A";
          // Return cleaned value if short enough, otherwise truncate
          return cleaned.length <= 20 ? cleaned : cleaned.slice(0, 20);
        };

        if (name && name.length > 1 && insightMatch) {
          const fundingStage = cleanFundingStage(fundingMatch?.[1]);
          const rawType = cleanValue(typeMatch?.[1]) || "company";
          const validTypes = ["company", "person", "product", "technology", "topic", "region", "event", "metric", "document", "fda_approval", "funding_event", "research_paper"] as const;
          type EntitySpotlightType = typeof validTypes[number];
          const entityType: EntitySpotlightType = validTypes.includes(rawType as any) ? rawType as EntitySpotlightType : "company";
          entitySpotlight.push({
            name: name,
            type: entityType,
            keyInsight: cleanValue(insightMatch[1]) || "",
            fundingStage: fundingStage && fundingStage !== "N/A" ? fundingStage : undefined,
          });
        }
      }
    }

    // Extract top sources and categories from feed items
    const sourceCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();
    for (const item of feedItems) {
      if (item.source) {
        sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1);
      }
      if (item.category) {
        categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
      }
    }

    const topSources = Array.from(sourceCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([source]) => source);

    const topCategories = Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([category]) => category);

    return {
      dateString,
      narrativeThesis,
      leadStory: leadStory ?? undefined, // Convert null to undefined for Convex schema
      signals,
      actionItems: uniqueActionItems,
      entitySpotlight: entitySpotlight.length > 0 ? entitySpotlight : undefined,
      storyCount: feedItems.length,
      topSources,
      topCategories,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error("[digestAgent] Error parsing digest output:", error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2: FORMAT FOR NTFY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format agent digest output into ntfy-compatible body
 */
export function formatDigestForNtfy(
  digest: AgentDigestOutput,
  options: {
    maxLength?: number;
    dashboardUrl?: string;
    entityBaseUrl?: string;
  } = {}
): { title: string; body: string } {
  const maxLength = options.maxLength || 3800;
  const dashboardUrl = options.dashboardUrl || "https://nodebench.ai";
  // Use hash routing format for entity links (matches MainLayout routing)
  const entityBaseUrl = options.entityBaseUrl || `${dashboardUrl}/#entity`;

  // Build sections separately so we can guarantee ACT III is always included
  // Priority order: Header + Act I + Act III + Footer > Act II > Entity Spotlight

  // --- Fixed sections (always included) ---
  const headerLines: string[] = [];
  headerLines.push(`**Morning Dossier** ${digest.dateString}`);
  headerLines.push("");

  // Act I: The Setup
  const actILines: string[] = [];
  actILines.push("**ACT I: The Setup**");
  actILines.push(digest.narrativeThesis.slice(0, 300));

  if (digest.leadStory) {
    const leadLink = digest.leadStory.url
      ? `[${digest.leadStory.title.slice(0, 60)}](${digest.leadStory.url})`
      : digest.leadStory.title.slice(0, 60);
    actILines.push(`Lead: ${leadLink}`);
    if (digest.leadStory.whyItMatters) {
      actILines.push(`Why: ${digest.leadStory.whyItMatters.slice(0, 120)}`);
    }
    if (digest.leadStory.reflection?.nowWhat) {
      actILines.push(`Now: ${digest.leadStory.reflection.nowWhat.slice(0, 120)}`);
    }
  }

  actILines.push(`Sources: ${digest.topSources.slice(0, 3).join(", ") || "various"}`);
  actILines.push("");

  // Act III: The Move (ALWAYS included - this is actionable)
  const actIIILines: string[] = [];
  actIIILines.push("**ACT III: The Move**");
  for (const action of digest.actionItems.slice(0, 5)) {
    actIIILines.push(`- [${action.persona}] ${action.action.slice(0, 100)}`);
  }
  if (digest.actionItems.length === 0) {
    actIIILines.push("- Review today's signals for opportunities");
  }
  actIIILines.push("");

  // Footer
  const footerLines: string[] = [];
  footerLines.push("---");
  footerLines.push(`[Open Dashboard](${dashboardUrl})`);

  // Calculate fixed section lengths
  const fixedSections = [
    ...headerLines,
    ...actILines,
    ...actIIILines,
    ...footerLines,
  ].join("\n");
  const fixedLength = fixedSections.length;

  // Calculate remaining budget for Act II and Entity Spotlight
  const remainingBudget = maxLength - fixedLength - 50; // 50 char buffer

  // --- Variable sections (included if space permits) ---

  // Entity Spotlight (lower priority than Act II)
  // Now with hyperlinks to entity profile pages for deep dives
  const entityLines: string[] = [];
  if (digest.entitySpotlight && digest.entitySpotlight.length > 0 && remainingBudget > 400) {
    entityLines.push("**Entity Spotlight**");
    for (const entity of digest.entitySpotlight.slice(0, 2)) {
      const funding = entity.fundingStage ? ` (${entity.fundingStage.slice(0, 20)})` : "";
      // URL-encode entity name for the hyperlink
      const entityUrl = `${entityBaseUrl}/${encodeURIComponent(entity.name)}`;
      entityLines.push(`- [**${entity.name.slice(0, 40)}**](${entityUrl})${funding}`);
      entityLines.push(`  ${entity.keyInsight.slice(0, 80)}`);
    }
    entityLines.push("");
  }
  const entityLength = entityLines.join("\n").length;

  // Fact-Check Findings (if any verified claims)
  const factCheckLines: string[] = [];
  if (digest.factCheckFindings && digest.factCheckFindings.length > 0 && remainingBudget > 300) {
    factCheckLines.push("**Fact Checks**");
    for (const finding of digest.factCheckFindings.slice(0, 3)) {
      const icon = finding.status === "verified" ? "✅" :
                   finding.status === "false" ? "❌" :
                   finding.status === "partially_verified" ? "⚠️" : "❓";
      const sourceText = finding.source ? ` - Source: ${finding.source.slice(0, 30)}` : "";
      factCheckLines.push(`${icon} ${finding.claim.slice(0, 80)}${sourceText}`);
    }
    factCheckLines.push("");
  }
  const factCheckLength = factCheckLines.join("\n").length;

  // Act II: The Signal (highest priority variable section)
  const actIILines: string[] = [];
  actIILines.push("**ACT II: The Signal**");

  // Calculate how much space we have for signals
  const actIIBudget = remainingBudget - entityLength - factCheckLength;
  let signalBudgetUsed = actIILines.join("\n").length;
  const avgSignalSize = 250; // Approximate chars per signal entry
  const maxSignals = Math.max(1, Math.min(5, Math.floor(actIIBudget / avgSignalSize)));

  for (const signal of digest.signals.slice(0, maxSignals)) {
    const signalLines: string[] = [];
    const link = signal.url
      ? `[${signal.title.slice(0, 60)}](${signal.url})`
      : signal.title.slice(0, 60);
    signalLines.push(`- ${link}`);
    signalLines.push(`  ${signal.summary.slice(0, 120)}`);
    if (signal.reflection?.nowWhat) {
      signalLines.push(`  Now: ${signal.reflection.nowWhat.slice(0, 100)}`);
    }
    if (signal.hardNumbers) {
      signalLines.push(`  📊 ${signal.hardNumbers.slice(0, 60)}`);
    }

    const signalBlock = signalLines.join("\n");
    if (signalBudgetUsed + signalBlock.length < actIIBudget) {
      actIILines.push(...signalLines);
      signalBudgetUsed += signalBlock.length;
    }
  }
  actIILines.push("");

  // Assemble final body in correct order
  const contentLength = fixedLength + actIILines.join("\n").length;
  const finalLines = [
    ...headerLines,
    ...actILines,
    ...actIILines,
    // Include fact-checks if space permits (higher priority than entity spotlight)
    ...(factCheckLength > 0 && contentLength + factCheckLength < maxLength - 150 ? factCheckLines : []),
    ...(entityLength > 0 && contentLength + factCheckLength + entityLength < maxLength - 100 ? entityLines : []),
    ...actIIILines,
    ...footerLines,
  ];

  let body = finalLines.join("\n");

  // Final safety truncation (should rarely trigger now)
  if (body.length > maxLength) {
    const suffix = `\n\n[Open Dashboard](${dashboardUrl})`;
    const truncateAt = maxLength - suffix.length - 20;
    body = body.slice(0, truncateAt).trim() + "...\n" + suffix;
  }

  const titleSuffix = digest.leadStory?.title
    ? ` | ${digest.leadStory.title.slice(0, 50)}`
    : "";

  return {
    title: `Morning Dossier ${digest.dateString}${titleSuffix}`,
    body,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3: BREAKING ALERT DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Analyze a story/event and determine if it warrants a breaking alert
 */
export const detectBreakingAlert = internalAction({
  args: {
    story: v.object({
      title: v.string(),
      summary: v.optional(v.string()),
      source: v.optional(v.string()),
      url: v.optional(v.string()),
      publishedAt: v.optional(v.string()),
      category: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
    }),
    userPreferences: v.optional(v.object({
      trackedEntities: v.optional(v.array(v.string())),
      minUrgency: v.optional(v.string()),
      quietHoursStart: v.optional(v.number()),
      quietHoursEnd: v.optional(v.number()),
    })),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<BreakingAlertOutput> => {
    const model = normalizeModelInput(args.model || "claude-haiku-4.5");
    const story = args.story;
    const prefs = args.userPreferences;

    console.log(`[digestAgent] Analyzing story for breaking alert: ${story.title.slice(0, 50)}...`);

    // Quick heuristic checks before LLM
    const quickChecks = {
      hasFundingKeyword: /(\$\d+[MB]|raised|funding|series [ABC]|seed round)/i.test(story.title + (story.summary || "")),
      hasAcquisitionKeyword: /acqui(red|sition)|merger|bought by/i.test(story.title + (story.summary || "")),
      hasSecurityKeyword: /CVE|vulnerability|breach|hack|exploit/i.test(story.title + (story.summary || "")),
      matchesTrackedEntity: prefs?.trackedEntities?.some((e: string) =>
        (story.title + (story.summary || "")).toLowerCase().includes(e.toLowerCase())
      ) || false,
    };

    // If no quick triggers, skip LLM analysis
    if (!Object.values(quickChecks).some(Boolean)) {
      return {
        shouldAlert: false,
        urgency: "low",
        title: story.title,
        body: story.summary || "",
        tags: [],
        relatedEntities: [],
        reasoning: "No quick triggers matched - routine story",
      };
    }

    // Build prompt for LLM analysis
    const prompt = `${BREAKING_ALERT_PROMPT}

## STORY TO ANALYZE
Title: ${story.title}
Source: ${story.source || "unknown"}
Published: ${story.publishedAt || "unknown"}
Category: ${story.category || "unknown"}
Tags: ${story.tags?.join(", ") || "none"}
Summary: ${story.summary || "No summary available"}
URL: ${story.url || "none"}

${prefs?.trackedEntities?.length ? `## USER'S TRACKED ENTITIES\n${prefs.trackedEntities.join(", ")}` : ""}

## QUICK ANALYSIS TRIGGERS MATCHED
${Object.entries(quickChecks).filter(([_, v]) => v).map(([k]) => `- ${k}`).join("\n")}

---

Analyze this story and output your decision in this format:

**SHOULD_ALERT**: [true/false]
**URGENCY**: [critical/high/medium/low]
**TITLE**: [notification title - max 50 chars]
**BODY**: [notification body - max 200 chars, self-contained context]
**TAGS**: [comma-separated emoji tags, e.g., money, fire, warning]
**ENTITIES**: [comma-separated entity names mentioned]
**REASONING**: [1-2 sentence explanation]`;

    try {
      const languageModel = getLanguageModelSafe(model);
      const agent = new Agent(components.agent, {
        name: "BreakingAlertDetector",
        languageModel,
        instructions: "You are a breaking news detector. Be conservative - only alert for genuinely important news.",
        stopWhen: stepCountIs(1),
      });

      const threadId = `alert-${Date.now()}`;
      const result = await agent.generateText(
        ctx as any,
        { threadId },
        { prompt }
      );

      // Parse the response
      const text = result.text;
      const shouldAlert = /\*\*SHOULD_ALERT\*\*:\s*true/i.test(text);
      const urgencyMatch = text.match(/\*\*URGENCY\*\*:\s*(\w+)/i);
      const titleMatch = text.match(/\*\*TITLE\*\*:\s*(.+?)(?:\n|$)/i);
      const bodyMatch = text.match(/\*\*BODY\*\*:\s*(.+?)(?:\n|$)/i);
      const tagsMatch = text.match(/\*\*TAGS\*\*:\s*(.+?)(?:\n|$)/i);
      const entitiesMatch = text.match(/\*\*ENTITIES\*\*:\s*(.+?)(?:\n|$)/i);
      const reasoningMatch = text.match(/\*\*REASONING\*\*:\s*([\s\S]*?)$/i);

      const urgency = (urgencyMatch?.[1]?.toLowerCase() || "low") as BreakingAlertOutput["urgency"];

      return {
        shouldAlert,
        urgency,
        title: titleMatch?.[1]?.trim() || story.title.slice(0, 50),
        body: bodyMatch?.[1]?.trim() || story.summary?.slice(0, 200) || "",
        tags: tagsMatch?.[1]?.split(",").map(t => t.trim()).filter(Boolean) || [],
        relatedEntities: entitiesMatch?.[1]?.split(",").map(e => e.trim()).filter(Boolean) || [],
        reasoning: reasoningMatch?.[1]?.trim() || "Analysis complete",
      };
    } catch (error: any) {
      console.error(`[digestAgent] Error analyzing breaking alert:`, error);
      return {
        shouldAlert: false,
        urgency: "low",
        title: story.title,
        body: story.summary || "",
        tags: [],
        relatedEntities: [],
        reasoning: `Error during analysis: ${error.message}`,
      };
    }
  },
});

/**
 * Send a breaking alert via ntfy if warranted
 */
export const sendBreakingAlertIfWarranted = internalAction({
  args: {
    story: v.object({
      title: v.string(),
      summary: v.optional(v.string()),
      source: v.optional(v.string()),
      url: v.optional(v.string()),
      publishedAt: v.optional(v.string()),
      category: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
    }),
    topic: v.optional(v.string()),
    minUrgency: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    alertSent: boolean;
    analysis: BreakingAlertOutput;
  }> => {
    const minUrgency = args.minUrgency || "high";
    const topic = args.topic;

    // Analyze the story
    const analysis = await ctx.runAction(internal.domains.agents.digestAgent.detectBreakingAlert, {
      story: args.story,
    });

    // Check if urgency meets threshold
    const urgencyLevels = ["critical", "high", "medium", "low"];
    const analysisLevel = urgencyLevels.indexOf(analysis.urgency);
    const thresholdLevel = urgencyLevels.indexOf(minUrgency);

    if (!analysis.shouldAlert || analysisLevel > thresholdLevel) {
      console.log(`[digestAgent] Alert not warranted: shouldAlert=${analysis.shouldAlert}, urgency=${analysis.urgency}, threshold=${minUrgency}`);
      return { alertSent: false, analysis };
    }

    // Send the notification
    const priority = analysis.urgency === "critical" ? 5 : analysis.urgency === "high" ? 4 : 3;
    const ntfyTags = ["warning", ...analysis.tags.slice(0, 3)];

    await ctx.runAction(api.domains.integrations.ntfy.sendNotification, {
      topic,
      title: `🚨 ${analysis.title}`,
      body: analysis.body,
      priority: priority as 1 | 2 | 3 | 4 | 5,
      tags: ntfyTags,
      click: args.story.url,
      eventType: "breaking_alert",
    });

    console.log(`[digestAgent] Breaking alert sent: ${analysis.title} (urgency=${analysis.urgency})`);

    return { alertSent: true, analysis };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// COORDINATOR TOOL: Send Notification
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tool definition for coordinator agent to send notifications
 * This enables the agent to trigger alerts during conversation
 */
export const sendNotificationTool = {
  description: `Send a push notification via ntfy to alert the user about important information.

Use this tool when:
- You discover breaking news that warrants immediate attention
- A research result reveals something critical (major funding, security issue, etc.)
- The user explicitly asks to be notified about something
- You complete a long-running task and want to alert the user

DO NOT use for:
- Routine information that can wait for the daily digest
- Low-importance updates
- Information the user is actively viewing in the conversation`,

  parameters: {
    title: {
      type: "string" as const,
      description: "Notification title (max 50 chars)",
    },
    body: {
      type: "string" as const,
      description: "Notification body with key details (max 500 chars)",
    },
    urgency: {
      type: "string" as const,
      enum: ["critical", "high", "medium", "low"],
      description: "Urgency level - critical/high sends immediately, medium/low may be batched",
    },
    tags: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Emoji tags for the notification (e.g., 'money', 'warning', 'fire')",
    },
    clickUrl: {
      type: "string" as const,
      description: "Optional URL to open when notification is clicked",
    },
    relatedEntity: {
      type: "string" as const,
      description: "Optional entity name this notification is about (for tracking)",
    },
  },

  required: ["title", "body", "urgency"],

  execute: async (args: {
    title: string;
    body: string;
    urgency: "critical" | "high" | "medium" | "low";
    tags?: string[];
    clickUrl?: string;
    relatedEntity?: string;
  }, ctx: any): Promise<{ sent: boolean; message: string }> => {
    const priority = args.urgency === "critical" ? 5 : args.urgency === "high" ? 4 : args.urgency === "medium" ? 3 : 2;

    try {
      await ctx.runAction(api.domains.integrations.ntfy.sendNotification, {
        title: args.title.slice(0, 50),
        body: args.body.slice(0, 500),
        priority: priority as 1 | 2 | 3 | 4 | 5,
        tags: args.tags || ["bell"],
        click: args.clickUrl,
        eventType: "agent_alert",
      });

      return {
        sent: true,
        message: `Notification sent with ${args.urgency} priority`,
      };
    } catch (error: any) {
      return {
        sent: false,
        message: `Failed to send notification: ${error.message}`,
      };
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Get Live Feed for Digest
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Helper to get feed items formatted for digest generation
 */
export const getFeedItemsForDigest = internalAction({
  args: {
    hoursBack: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DigestFeedItem[]> => {
    const hoursBack = args.hoursBack || 24;
    const limit = args.limit || 100;

    const feedItems = await ctx.runQuery(
      internal.domains.research.dashboardQueries.getFeedItemsForMetrics,
      {}
    ) as any[];

    // Filter to recent items and transform to DigestFeedItem format
    const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;

    return feedItems
      .filter((item: any) => {
        const publishedAt = item.publishedAt ? new Date(item.publishedAt).getTime() : Date.now();
        return publishedAt >= cutoff;
      })
      .slice(0, limit)
      .map((item: any) => ({
        title: item.title || "",
        summary: item.summary,
        source: item.source,
        tags: item.tags,
        category: item.category,
        score: item.score,
        publishedAt: item.publishedAt,
        type: item.type,
        url: item.url,
      }));
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CACHING: Store and retrieve digest results
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cache a generated digest for later retrieval
 * Enables re-formatting for different channels without regenerating
 */
export const cacheDigest = internalMutation({
  args: {
    dateString: v.string(),
    persona: v.string(),
    model: v.string(),
    rawText: v.string(),
    digest: v.object({
      dateString: v.string(),
      narrativeThesis: v.string(),
      leadStory: v.optional(v.object({
        title: v.string(),
        url: v.optional(v.string()),
        whyItMatters: v.string(),
        reflection: v.optional(v.object({
          what: v.string(),
          soWhat: v.string(),
          nowWhat: v.string(),
        })),
      })),
      signals: v.array(v.object({
        title: v.string(),
        url: v.optional(v.string()),
        summary: v.string(),
        hardNumbers: v.optional(v.string()),
        directQuote: v.optional(v.string()),
        reflection: v.optional(v.object({
          what: v.string(),
          soWhat: v.string(),
          nowWhat: v.string(),
        })),
      })),
      actionItems: v.array(v.object({
        persona: v.string(),
        action: v.string(),
      })),
      entitySpotlight: v.optional(v.array(v.object({
        name: v.string(),
        type: v.string(),
        keyInsight: v.string(),
        fundingStage: v.optional(v.string()),
      }))),
      factCheckFindings: v.optional(v.array(v.object({
        claim: v.string(),
        status: v.string(),
        explanation: v.string(),
        source: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        confidence: v.number(),
      }))),
      fundingRounds: v.optional(v.array(v.object({
        rank: v.number(),
        companyName: v.string(),
        roundType: v.string(),
        amountRaw: v.string(),
        amountUsd: v.optional(v.number()),
        leadInvestors: v.array(v.string()),
        sector: v.optional(v.string()),
        productDescription: v.optional(v.string()),
        founderBackground: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        announcedAt: v.number(),
        confidence: v.number(),
      }))),
      storyCount: v.number(),
      topSources: v.array(v.string()),
      topCategories: v.array(v.string()),
      processingTimeMs: v.number(),
    }),
    ntfyPayload: v.optional(v.object({
      title: v.string(),
      body: v.string(),
    })),
    usage: v.object({
      inputTokens: v.number(),
      outputTokens: v.number(),
      model: v.optional(v.string()),
    }),
    feedItemCount: v.number(),
    ttlHours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ttlHours = args.ttlHours || 24;
    const expiresAt = Date.now() + ttlHours * 60 * 60 * 1000;

    // Check for existing cache entry
    const existing = await ctx.db
      .query("digestCache")
      .withIndex("by_date_persona", (q) =>
        q.eq("dateString", args.dateString).eq("persona", args.persona)
      )
      .first() as Doc<"digestCache"> | null;

    if (existing) {
      // Update existing entry
      await ctx.db.patch(existing._id, {
        model: args.model,
        rawText: args.rawText,
        digest: args.digest,
        ntfyPayload: args.ntfyPayload,
        usage: args.usage,
        feedItemCount: args.feedItemCount,
        expiresAt,
      });
      return existing._id;
    }

    // Create new entry
    return await ctx.db.insert("digestCache", {
      dateString: args.dateString,
      persona: args.persona,
      model: args.model,
      rawText: args.rawText,
      digest: args.digest,
      ntfyPayload: args.ntfyPayload,
      usage: args.usage,
      feedItemCount: args.feedItemCount,
      createdAt: Date.now(),
      expiresAt,
    });
  },
});

/**
 * Retrieve a cached digest by date and persona
 */
export const getCachedDigest = internalQuery({
  args: {
    dateString: v.string(),
    persona: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const persona = args.persona || "GENERAL";

    const cached = await ctx.db
      .query("digestCache")
      .withIndex("by_date_persona", (q) =>
        q.eq("dateString", args.dateString).eq("persona", persona)
      )
      .first() as Doc<"digestCache"> | null;

    if (!cached) return null;

    // Check if expired
    if (cached.expiresAt < Date.now()) {
      return null; // Let caller regenerate
    }

    return cached;
  },
});

/**
 * Mark a cached digest as sent to a channel
 */
export const markDigestSent = internalMutation({
  args: {
    digestId: v.id("digestCache"),
    channel: v.union(v.literal("ntfy"), v.literal("slack"), v.literal("email")),
  },
  handler: async (ctx, args) => {
    const field = `sentTo${args.channel.charAt(0).toUpperCase() + args.channel.slice(1)}` as
      "sentToNtfy" | "sentToSlack" | "sentToEmail";
    await ctx.db.patch(args.digestId, { [field]: true });
  },
});

/**
 * Get all digests for a date (all personas)
 */
export const getDigestsForDate = internalQuery({
  args: {
    dateString: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("digestCache")
      .withIndex("by_date", (q) => q.eq("dateString", args.dateString))
      .collect();
  },
});

/**
 * Get the latest cached digest with entity enrichment for frontend consumption.
 * Returns entity spotlight data formatted for EntityHoverPreview components.
 * Now also fetches adaptive profiles for richer hover previews.
 */
export const getLatestDigestWithEntities = query({
  args: {
    persona: v.optional(v.string()), // Default: "GENERAL"
  },
  handler: async (ctx, args) => {
    const dateString = new Date().toISOString().split("T")[0];
    const persona = args.persona ?? "GENERAL";

    // Find the latest cached digest for today
    const cached = await ctx.db
      .query("digestCache")
      .withIndex("by_date_persona", (q) =>
        q.eq("dateString", dateString).eq("persona", persona)
      )
      .order("desc")
      .first() as Doc<"digestCache"> | null;

    if (!cached) {
      return null;
    }

    // Get entity names from spotlight for adaptive profile lookup
    const entitySpotlight = cached.digest.entitySpotlight ?? [];
    const entityNames = entitySpotlight.map((e: any) => e.name);

    // Fetch adaptive profiles for all entities in parallel
    const adaptiveProfiles: Record<string, any> = {};
    await Promise.all(
      entityNames.map(async (name: string) => {
        const profile = await ctx.db
          .query("adaptiveEntityProfiles")
          .withIndex("by_name", (q) => q.eq("entityName", name))
          .first() as Doc<"adaptiveEntityProfiles"> | null;
        if (profile?.profile) {
          adaptiveProfiles[name] = profile.profile;
        }
      })
    );

    // Transform entitySpotlight into EntityHoverData format for frontend
    // Now with adaptive enrichment fields for medium-detail hover previews
    const entityEnrichment: Record<string, {
      entityId: string;
      name: string;
      type: string;
      summary: string;
      keyFacts: string[];
      funding?: { stage: string; totalRaised?: string };
      sources?: { name: string; credibility: string }[];
      // Adaptive enrichment fields
      relationships?: Array<{
        entityName: string;
        relationshipType: string;
        strength: "strong" | "moderate" | "weak";
      }>;
      circleOfInfluence?: {
        tier1: string[];
        tier2: string[];
      };
      timelineHighlight?: {
        date: string;
        title: string;
        category: string;
      };
      executiveSummary?: {
        whatTheyreKnownFor?: string;
        currentFocus?: string;
      };
    }> = {};

    for (const entity of entitySpotlight) {
      const id = entity.name.toLowerCase().replace(/\s+/g, "-");
      const adaptiveProfile = adaptiveProfiles[entity.name];

      // Extract adaptive enrichment data
      const relationships = adaptiveProfile?.relationships?.slice(0, 3).map((r: any) => ({
        entityName: r.entityName,
        relationshipType: r.relationshipType,
        strength: r.strength || "moderate",
      }));

      const circleOfInfluence = adaptiveProfile?.circleOfInfluence
        ? {
            tier1: adaptiveProfile.circleOfInfluence.tier1?.slice(0, 3) || [],
            tier2: adaptiveProfile.circleOfInfluence.tier2?.slice(0, 2) || [],
          }
        : undefined;

      const timelineHighlight = adaptiveProfile?.timeline?.[0]
        ? {
            date: adaptiveProfile.timeline[0].date,
            title: adaptiveProfile.timeline[0].title,
            category: adaptiveProfile.timeline[0].category,
          }
        : undefined;

      const executiveSummary = adaptiveProfile?.executiveSummary
        ? {
            whatTheyreKnownFor: adaptiveProfile.executiveSummary.whatTheyreKnownFor,
            currentFocus: adaptiveProfile.executiveSummary.currentFocus,
          }
        : undefined;

      entityEnrichment[id] = {
        entityId: id,
        name: entity.name,
        type: entity.type,
        summary: adaptiveProfile?.headline || entity.keyInsight,
        keyFacts: entity.keyFacts || adaptiveProfile?.sections?.[0]?.keyPoints?.slice(0, 3) || [],
        ...(entity.fundingStage && {
          funding: { stage: entity.fundingStage }
        }),
        ...(entity.sources && {
          sources: entity.sources.map((s: any) => ({
            name: s.name,
            credibility: "medium",
          }))
        }),
        // Add adaptive enrichment fields
        relationships,
        circleOfInfluence,
        timelineHighlight,
        executiveSummary,
      };
      // Also index by name for easy lookup
      entityEnrichment[entity.name] = entityEnrichment[id];
    }

    return {
      dateString: cached.dateString,
      persona: cached.persona,
      narrativeThesis: cached.digest.narrativeThesis,
      entityEnrichment,
      entityCount: entitySpotlight.length,
      storyCount: cached.digest.storyCount,
      createdAt: cached.createdAt,
      // Include count of entities with adaptive profiles for debugging
      adaptiveProfileCount: Object.keys(adaptiveProfiles).length,
    };
  },
});

/**
 * Clean up expired cache entries
 */
export const cleanupExpiredDigests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("digestCache")
      .withIndex("by_expires")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();

    let deleted = 0;
    for (const entry of expired) {
      await ctx.db.delete(entry._id);
      deleted++;
    }

    return { deleted };
  },
});

/**
 * Export ONLY the dailyBrief ntfy payload(s) for a date to support offline inspection.
 *
 * This reads from `digestCache` and returns the cached `ntfyPayload` objects.
 */
export const exportDailyBriefNtfyPayloads = action({
  args: {
    secret: v.string(),
    dateString: v.optional(v.string()), // YYYY-MM-DD, default today
    sentOnly: v.optional(v.boolean()), // default false
  },
  returns: v.object({
    dateString: v.string(),
    total: v.number(),
    payloads: v.array(v.object({
      persona: v.string(),
      model: v.string(),
      title: v.string(),
      body: v.string(),
      sentToNtfy: v.optional(v.boolean()),
      createdAt: v.number(),
      usage: v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
      }),
    })),
  }),
  handler: async (ctx, args) => {
    const expectedSecret = process.env.MCP_SECRET;
    if (!expectedSecret || args.secret !== expectedSecret) {
      throw new Error("Unauthorized (bad secret)");
    }

    const dateString = args.dateString ?? new Date().toISOString().split("T")[0];
    const sentOnly = args.sentOnly === true;

    const rows = await ctx.runQuery(internal.domains.agents.digestAgent.getDigestsForDate, { dateString }) as any[];

    const payloads = rows
      .filter((r: any) => !!r?.ntfyPayload && (!sentOnly || r?.sentToNtfy === true))
      .map((r: any) => ({
        persona: String(r.persona ?? ""),
        model: String(r.model ?? ""),
        title: String(r.ntfyPayload?.title ?? ""),
        body: String(r.ntfyPayload?.body ?? ""),
        sentToNtfy: r.sentToNtfy,
        createdAt: Number(r.createdAt ?? 0),
        usage: {
          inputTokens: Number(r.usage?.inputTokens ?? 0),
          outputTokens: Number(r.usage?.outputTokens ?? 0),
        },
      }));

    return { dateString, total: payloads.length, payloads };
  },
});

/**
 * Public action to trigger digest generation with entity extraction.
 * This fetches feed items automatically and generates a fresh digest.
 * Used by the EntityProfilePage and MorningDigest components.
 */
export const triggerDigestGeneration = action({
  args: {
    persona: v.optional(v.string()),
    model: v.optional(v.string()),
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const persona = args.persona || "GENERAL";
    const model = normalizeModelInput(args.model || DEFAULT_MODEL);
    const forceRefresh = args.forceRefresh ?? false;

    // Check for cached digest first (unless force refresh)
    if (!forceRefresh) {
      const dateString = new Date().toISOString().split("T")[0];
      const cached = await ctx.runQuery(internal.domains.agents.digestAgent.getCachedDigest, {
        dateString,
        persona,
      });
      if (cached) {
        return {
          success: true,
          cached: true,
          digest: cached.digest,
          entityCount: cached.digest.entitySpotlight?.length || 0,
        };
      }
    }

    // Fetch feed items
    const feedItems = await ctx.runAction(internal.domains.agents.digestAgent.getFeedItemsForDigest, {
      limit: 15,
    });

    if (!feedItems || feedItems.length === 0) {
      return {
        success: false,
        error: "No feed items available",
      };
    }

    // Generate the digest
    const result = await ctx.runAction(internal.domains.agents.digestAgent.generateAgentDigest, {
      feedItems,
      persona,
      model,
      outputMode: "structured",
      useCache: true,
    });

    return {
      success: !result.error,
      cached: result.cache?.hit || false,
      digest: result.digest,
      entityCount: result.digest?.entitySpotlight?.length || 0,
      error: result.error,
    };
  },
});

/**
 * Generate a digest with fact-check findings included.
 * This action fetches verified claims from Instagram verification and injects them into the digest.
 */
export const generateDigestWithFactChecks = internalAction({
  args: {
    persona: v.optional(v.string()),
    model: v.optional(v.string()),
    hoursBack: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const persona = args.persona || "GENERAL";
    const model = normalizeModelInput(args.model || DEFAULT_MODEL);
    const hoursBack = args.hoursBack || 24;

    console.log(`[digestAgent] Generating digest with fact-checks for persona=${persona}, model=${model}`);

    // 1. Fetch feed items
    const feedItems = await ctx.runAction(internal.domains.agents.digestAgent.getFeedItemsForDigest, {
      hoursBack,
      limit: 50,
    });

    if (!feedItems || feedItems.length === 0) {
      return {
        success: false,
        error: "No feed items available",
        digest: null,
        factCheckCount: 0,
      };
    }

    // 2. Fetch today's verified claims
    let factCheckFindings: NonNullable<AgentDigestOutput["factCheckFindings"]> = [];
    try {
      const verifiedClaims = await ctx.runAction(
        internal.domains.verification.instagramClaimVerification.getTodaysVerifiedClaims,
        {}
      );
      factCheckFindings = verifiedClaims.map((claim: any) => ({
        claim: claim.claim,
        status: claim.status as "verified" | "partially_verified" | "unverified" | "false",
        explanation: claim.explanation,
        source: claim.source,
        sourceUrl: claim.sourceUrl,
        confidence: claim.confidence,
      }));
      console.log(`[digestAgent] Found ${factCheckFindings.length} verified claims`);
    } catch (e) {
      console.warn("[digestAgent] Failed to fetch verified claims:", e instanceof Error ? e.message : String(e));
    }

    // 2b. Fetch today's funding rounds
    let fundingRounds: AgentDigestOutput["fundingRounds"] = [];
    try {
      const fundingData = await ctx.runQuery(
        internal.domains.enrichment.fundingQueries.getFundingDigestSections,
        { lookbackHours: hoursBack }
      );

      // Combine all funding events and rank by amount
      const allFunding = [
        ...fundingData.seed,
        ...fundingData.seriesA,
        ...fundingData.other,
      ];

      // Sort by amount (largest first) and assign ranks
      const sortedFunding = allFunding
        .filter((f: any) => f.amountUsd && f.amountUsd > 0)
        .sort((a: any, b: any) => (b.amountUsd || 0) - (a.amountUsd || 0));

      fundingRounds = sortedFunding.slice(0, 10).map((f: any, index: number) => ({
        rank: index + 1,
        companyName: f.companyName,
        roundType: f.roundType,
        amountRaw: f.amountRaw,
        amountUsd: f.amountUsd,
        leadInvestors: f.leadInvestors || [],
        sector: f.sector,
        // Pull description through as productDescription; founderBackground
        // is optional and best-effort enriched downstream. Never fabricate
        // placeholder strings — formatter omits missing fields entirely.
        productDescription: typeof f.description === "string" && f.description.trim()
          ? f.description
          : undefined,
        founderBackground: undefined,
        sourceUrl: Array.isArray(f.sourceUrls) && f.sourceUrls.length > 0 ? f.sourceUrls[0] : undefined,
        announcedAt: typeof f.announcedAt === "number" ? f.announcedAt : Date.now(),
        confidence: f.confidence || 0.5,
      }));

      console.log(`[digestAgent] Found ${fundingRounds.length} funding rounds`);
    } catch (e) {
      console.warn("[digestAgent] Failed to fetch funding rounds:", e instanceof Error ? e.message : String(e));
    }

    // 3. Generate digest (free-first, with a quality gate + paid safety net)
    // Strategy: try the TOP FREE models FIRST (cost = $0), but only publish a
    // free model's output if it clears the AINews quality bar (assessDigestQuality).
    // Otherwise fall through to the trusted PAID models. An explicitly requested
    // model is honored first; the paid tail is the guaranteed safety net.
    const explicitlyRequested = typeof args.model === "string" && args.model.trim().length > 0;
    const MAX_FREE_CANDIDATES = 3; // top N free models — avoid trying all ~16
    const freeCandidates = getFreeModels().slice(0, MAX_FREE_CANDIDATES);
    const paidTail: string[] = [model, FALLBACK_MODEL, "gemini-3.1-flash-lite-preview", "claude-haiku-4.5"];

    const modelsToTry: string[] = [];
    const pushUnique = (m: string) => { if (m && !modelsToTry.includes(m)) modelsToTry.push(m); };
    if (explicitlyRequested) pushUnique(model);      // honor an explicit request first
    for (const fm of freeCandidates) pushUnique(fm);  // then the top free models (quality-gated)
    for (const pm of paidTail) pushUnique(pm);        // then the paid trusted tail
    console.log(`[digestAgent] Fallback chain (${modelsToTry.length} models): ${modelsToTry.join(" -> ")}`);

    type DigestResult = { digest: AgentDigestOutput | null; rawText: string; usage: { inputTokens: number; outputTokens: number; model: string }; error?: string; cache?: { hit: boolean; id: any } };
    let result: DigestResult | null = null;
    let firstParsed: DigestResult | null = null; // best-effort: a parsed-but-below-bar digest
    let lastError = "";
    const MAX_RETRIES_PER_MODEL = 2;
    const BASE_DELAY_MS = 2000; // 2s, 4s exponential backoff

    for (const tryModel of modelsToTry) {
      let succeeded = false;
      // Only the free models WE selected for cost savings must clear the quality bar.
      // Membership test (not isFreeModel) so an unknown model name can never throw here.
      const gated = (freeCandidates as readonly string[]).includes(tryModel);

      for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
        if (attempt > 0) {
          const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(`[digestAgent] Retry ${attempt}/${MAX_RETRIES_PER_MODEL} for ${tryModel} after ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          console.log(`[digestAgent] Trying model=${tryModel}${gated ? " (free, quality-gated)" : " (paid)"} for digest generation...`);
        }

        try {
          const candidate: DigestResult = await ctx.runAction(internal.domains.agents.digestAgent.generateAgentDigest, {
            feedItems,
            persona,
            model: tryModel,
            outputMode: "structured",
            useCache: false,
          });

          if (candidate && candidate.digest && !candidate.error) {
            if (!firstParsed) firstParsed = candidate; // remember the first thing that parsed
            // Free models must clear the publishable quality bar; paid models are trusted.
            if (gated) {
              const quality = assessDigestQuality(candidate.digest);
              if (!quality.publishable) {
                lastError = `free model ${tryModel} below quality bar: ${quality.reason}`;
                console.warn(`[digestAgent] ${lastError} -- falling through`);
                result = null;
                break; // quality won't improve on retry; move to next model
              }
              console.log(`[digestAgent] Free model ${tryModel} cleared quality bar (${quality.signalCount} signals, ${quality.denseSignalCount} with number/source)`);
            }
            if (tryModel !== model) {
              console.log(`[digestAgent] Succeeded with ${tryModel} (attempt ${attempt + 1})`);
            }
            result = candidate;
            succeeded = true;
            break;
          } else {
            lastError = candidate?.error || "No digest returned";
            console.warn(`[digestAgent] Model ${tryModel} attempt ${attempt + 1} returned error: ${lastError}`);
            result = null;
          }
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          console.warn(`[digestAgent] Model ${tryModel} attempt ${attempt + 1} threw: ${lastError}`);
          result = null;
        }
      }

      if (succeeded) break;
      console.warn(`[digestAgent] Model ${tryModel} did not yield a publishable digest, moving to next model`);
    }

    // Best-effort: if nothing cleared the bar but something parsed, publish the
    // best parsed digest rather than nothing (HONEST: post real output; the
    // quality shortfall is logged, not hidden).
    if ((!result || !result.digest) && firstParsed?.digest) {
      console.warn(`[digestAgent] No model met the quality bar; publishing best-effort digest from ${firstParsed.usage.model}`);
      result = firstParsed;
    }

    if (!result || !result.digest) {
      return {
        success: false,
        error: `All models failed. Last error: ${lastError}`,
        digest: null,
        factCheckCount: 0,
      };
    }

    // 4. Inject fact-checks and funding rounds into digest
    const digestWithFactChecks: AgentDigestOutput = {
      ...result.digest,
      factCheckFindings: factCheckFindings.length > 0 ? factCheckFindings : undefined,
      fundingRounds: fundingRounds.length > 0 ? fundingRounds : undefined,
    };

    // 5. Format for ntfy
    const ntfyPayload = formatDigestForNtfy(digestWithFactChecks);

    // 6. Cache the result with fact-checks
    const dateString = new Date().toISOString().split("T")[0];
    await ctx.runMutation(internal.domains.agents.digestAgent.cacheDigest, {
      dateString,
      persona,
      model,
      rawText: result.rawText,
      digest: digestWithFactChecks,
      ntfyPayload,
      usage: result.usage,
      feedItemCount: feedItems.length,
      ttlHours: 24,
    });

    console.log(`[digestAgent] Digest with ${factCheckFindings.length} fact-checks generated successfully`);

    return {
      success: true,
      digest: digestWithFactChecks,
      ntfyPayload,
      factCheckCount: factCheckFindings.length,
      usage: result.usage,
    };
  },
});
