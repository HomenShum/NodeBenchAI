"use node";

/**
 * Adaptive Entity Enrichment System
 *
 * Unlike hardcoded CRM fields, this system uses LLM reasoning to:
 * 1. Discover what's important about an entity dynamically
 * 2. Build a timeline of key events (career moves, funding, exits, education)
 * 3. Map relationships and circles of influence
 * 4. Track entities across time with structured milestones
 *
 * The schema is flexible - the LLM decides what sections matter for each entity type.
 */

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { generateText } from "ai";
import { getLanguageModelSafe, DEFAULT_MODEL } from "../agents/mcp_tools/models/modelResolver";

// ═══════════════════════════════════════════════════════════════════
// FLEXIBLE SCHEMA TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * A timeline event - the atomic unit of entity history
 * The LLM discovers and categorizes these dynamically
 */
export interface TimelineEvent {
  id: string;
  date: string; // ISO date or "YYYY" or "YYYY-MM" for partial dates
  dateGranularity: "day" | "month" | "year" | "decade" | "approximate";
  category: string; // LLM-discovered: "education", "career", "funding", "exit", "award", etc.
  title: string;
  description: string;
  significance: "high" | "medium" | "low";
  relatedEntities: Array<{
    name: string;
    type: string;
    role: string; // "employer", "investor", "co-founder", "advisor", etc.
  }>;
  sources: Array<{
    url?: string;
    name: string;
    reliability: "primary" | "secondary" | "inferred";
  }>;
  metadata?: Record<string, any>; // Flexible additional data
}

/**
 * A relationship in the entity's network
 */
export interface EntityRelationship {
  entityName: string;
  entityType: string;
  relationshipType: string; // "invested_in", "founded", "worked_at", "advised", "mentored", etc.
  strength: "strong" | "moderate" | "weak";
  timeRange?: {
    start?: string;
    end?: string;
    ongoing?: boolean;
  };
  context: string;
  mutualConnections?: string[];
}

/**
 * A dynamic section of the entity profile
 * The LLM decides what sections are relevant
 */
export interface AdaptiveSection {
  id: string;
  title: string;
  icon?: string; // Lucide icon name
  priority: number; // 1 = most important
  content: {
    type: "narrative" | "list" | "stats" | "timeline" | "network" | "comparison";
    data: any; // Flexible based on type
  };
  reasoning: string; // Why this section was included
  lastUpdated: string;
}

/**
 * The complete adaptive entity profile
 */
export interface AdaptiveEntityProfile {
  // Core identity
  name: string;
  entityType: string; // LLM-inferred: "founder", "investor", "company", "technology", etc.
  subTypes: string[]; // More specific: ["serial_entrepreneur", "ai_researcher"]
  headline: string; // One-line summary

  // LLM-generated executive summary
  executiveSummary: {
    whatTheyreKnownFor: string;
    currentFocus: string;
    whyTheyMatter: string;
    keyInsight: string; // The "so what" for a banker/investor
  };

  // Timeline of their journey
  timeline: TimelineEvent[];

  // Network and influence
  relationships: EntityRelationship[];
  circleOfInfluence: {
    tier1: string[]; // Closest collaborators
    tier2: string[]; // Extended network
    tier3: string[]; // Broader ecosystem
  };

  // Dynamic sections decided by LLM
  sections: AdaptiveSection[];

  // Meta
  enrichmentQuality: {
    completeness: number; // 0-100
    confidence: number; // 0-100
    dataFreshness: number; // days since last significant update
    gaps: string[]; // What we couldn't find
  };

  // Research trail
  researchLog: Array<{
    timestamp: string;
    action: string;
    findings: string;
    sourcesUsed: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════════
// LLM PROMPTS FOR ADAPTIVE DISCOVERY
// ═══════════════════════════════════════════════════════════════════

const ENTITY_DISCOVERY_PROMPT = `You are an expert researcher building a comprehensive profile of an entity.

Your task is to analyze the provided information and determine:
1. What TYPE of entity this is (be specific - not just "person" but "serial entrepreneur", "VC partner", "AI researcher", etc.)
2. What SECTIONS would be most valuable for understanding this entity
3. What TIMELINE events are most significant
4. What RELATIONSHIPS define their influence

IMPORTANT GUIDELINES:
- Be adaptive: A founder needs different sections than a technology or a company
- For PEOPLE: Focus on career trajectory, exits, education, investments, board seats, publications
- For COMPANIES: Focus on funding rounds, key hires, pivots, products, acquisitions
- For TECHNOLOGIES: Focus on adoption timeline, key papers, companies using it, evolution
- Think like a banker/investor: What would they need to know to make a decision?

OUTPUT FORMAT (JSON):
{
  "entityType": "specific type",
  "subTypes": ["additional categorizations"],
  "headline": "one-line summary",
  "executiveSummary": {
    "whatTheyreKnownFor": "...",
    "currentFocus": "...",
    "whyTheyMatter": "...",
    "keyInsight": "the 'so what' for decision makers"
  },
  "suggestedSections": [
    {
      "id": "unique_id",
      "title": "Section Title",
      "icon": "lucide-icon-name",
      "priority": 1,
      "reasoning": "why this section matters for this entity",
      "researchQuestions": ["questions to answer for this section"]
    }
  ],
  "timelineCategories": ["categories of events to track"],
  "relationshipTypes": ["types of relationships to map"],
  "researchPriorities": ["what to research first"]
}`;

const TIMELINE_EXTRACTION_PROMPT = `Extract a timeline of significant events from the provided research about this entity.

For each event:
1. Determine the date (be as precise as possible, note uncertainty)
2. Categorize it (education, career, funding, exit, award, publication, etc.)
3. Assess its significance (high/medium/low)
4. Identify related entities and their roles
5. Note your sources

OUTPUT FORMAT (JSON array):
[
  {
    "id": "unique_event_id",
    "date": "YYYY-MM-DD or YYYY-MM or YYYY",
    "dateGranularity": "day|month|year|approximate",
    "category": "category_name",
    "title": "Brief event title",
    "description": "Detailed description with context",
    "significance": "high|medium|low",
    "relatedEntities": [
      {"name": "Entity Name", "type": "company|person|etc", "role": "their role in this event"}
    ],
    "sources": [
      {"name": "Source name", "url": "if available", "reliability": "primary|secondary|inferred"}
    ],
    "metadata": {} // any additional structured data
  }
]

GUIDELINES:
- Prioritize events that show trajectory and decision patterns
- For founders: track company founding dates, funding rounds, exits, board appointments
- For investors: track fund launches, notable investments, exits, returns
- Include education milestones, especially from elite institutions
- Note career moves between companies
- Flag any controversies or setbacks (these are valuable for due diligence)`;

const RELATIONSHIP_MAPPING_PROMPT = `Map the relationships and network of this entity based on the research provided.

Identify:
1. Direct collaborators (co-founders, co-investors, business partners)
2. Mentors and advisors
3. Frequent co-investors or deal partners
4. Board relationships
5. Institutional affiliations (YC, Stanford, specific VC firms)

OUTPUT FORMAT (JSON):
{
  "relationships": [
    {
      "entityName": "Name",
      "entityType": "person|company|institution",
      "relationshipType": "co-founded|invested_in|advised|worked_at|etc",
      "strength": "strong|moderate|weak",
      "timeRange": {"start": "YYYY", "end": "YYYY or null if ongoing", "ongoing": true/false},
      "context": "Brief description of the relationship",
      "mutualConnections": ["names of shared connections if known"]
    }
  ],
  "circleOfInfluence": {
    "tier1": ["Closest 5-10 collaborators"],
    "tier2": ["Extended network of 10-20"],
    "tier3": ["Broader ecosystem connections"]
  },
  "networkInsights": "What does this network tell us about the entity?"
}`;

const SECTION_CONTENT_PROMPT = `Generate content for this section of the entity profile.

Section: {sectionTitle}
Purpose: {sectionReasoning}
Research Questions: {researchQuestions}

Based on the research provided, create structured content for this section.

The content type should be: {contentType}
- "narrative": Flowing prose with key insights
- "list": Bullet points of key items
- "stats": Key metrics and numbers
- "timeline": Chronological events
- "network": Relationship mapping
- "comparison": Benchmarking against peers

OUTPUT FORMAT (JSON):
{
  "type": "{contentType}",
  "data": {
    // Structure depends on type:
    // narrative: {"text": "...", "highlights": ["key points"]}
    // list: {"items": [{"title": "...", "description": "..."}]}
    // stats: {"metrics": [{"label": "...", "value": "...", "context": "..."}]}
    // timeline: {"events": [...]}
    // network: {"nodes": [...], "edges": [...]}
    // comparison: {"subject": "...", "comparisons": [...]}
  },
  "keyTakeaway": "The most important insight from this section"
}`;

// ═══════════════════════════════════════════════════════════════════
// LLM HELPER FUNCTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate text using the LLM with JSON response format
 * Uses centralized model resolver for consistent model selection
 */
async function generateLLMText(prompt: string, maxOutputTokens: number = 2000): Promise<string> {
  const model = getLanguageModelSafe(DEFAULT_MODEL);

  const result = await generateText({
    model,
    prompt,
    maxTokens: maxOutputTokens,
  } as Parameters<typeof generateText>[0]);

  return result.text;
}

// ═══════════════════════════════════════════════════════════════════
// CORE ENRICHMENT ACTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Main entry point: Adaptively enrich an entity
 */
export const enrichEntityAdaptively = action({
  args: {
    entityName: v.string(),
    knownEntityType: v.optional(v.string()), // Hint if known
    depth: v.optional(v.union(v.literal("quick"), v.literal("standard"), v.literal("deep"))),
    focusAreas: v.optional(v.array(v.string())), // Specific areas to prioritize
  },
  handler: async (ctx, args): Promise<AdaptiveEntityProfile> => {
    const depth = args.depth || "standard";
    const startTime = Date.now();

    console.log(`[AdaptiveEnrich] Starting ${depth} enrichment for: ${args.entityName}`);

    // Step 1: Initial research to understand the entity
    const initialResearch = await ctx.runAction(
      internal.domains.knowledge.adaptiveEntityEnrichment.performInitialResearch,
      { entityName: args.entityName, knownType: args.knownEntityType }
    );

    // Step 2: LLM discovery - what type of entity and what sections matter
    const discovery = await ctx.runAction(
      internal.domains.knowledge.adaptiveEntityEnrichment.discoverEntityStructure,
      { entityName: args.entityName, initialResearch }
    );

    // Step 3: Build timeline from research
    const timeline = await ctx.runAction(
      internal.domains.knowledge.adaptiveEntityEnrichment.extractTimeline,
      { entityName: args.entityName, research: initialResearch, categories: discovery.timelineCategories }
    );

    // Step 4: Map relationships
    const relationships = await ctx.runAction(
      internal.domains.knowledge.adaptiveEntityEnrichment.mapRelationships,
      { entityName: args.entityName, research: initialResearch, timeline }
    );

    // Step 5: Deep research on priority sections (if not quick mode)
    const sections: AdaptiveSection[] = [];
    if (depth !== "quick") {
      const sectionLimit = depth === "deep" ? discovery.suggestedSections.length : 3;
      const prioritySections = discovery.suggestedSections
        .sort((a: any, b: any) => a.priority - b.priority)
        .slice(0, sectionLimit);

      for (const section of prioritySections) {
        const sectionContent = await ctx.runAction(
          internal.domains.knowledge.adaptiveEntityEnrichment.enrichSection,
          {
            entityName: args.entityName,
            section,
            existingResearch: initialResearch,
          }
        );
        sections.push(sectionContent);
      }
    }

    // Step 6: Assess quality and identify gaps
    const quality = assessEnrichmentQuality(
      initialResearch,
      timeline,
      relationships,
      sections
    );

    const profile: AdaptiveEntityProfile = {
      name: args.entityName,
      entityType: discovery.entityType,
      subTypes: discovery.subTypes,
      headline: discovery.headline,
      executiveSummary: discovery.executiveSummary,
      timeline,
      relationships: relationships.relationships,
      circleOfInfluence: relationships.circleOfInfluence,
      sections,
      enrichmentQuality: quality,
      researchLog: [
        {
          timestamp: new Date().toISOString(),
          action: `${depth} enrichment completed`,
          findings: `Found ${timeline.length} timeline events, ${relationships.relationships.length} relationships, ${sections.length} sections`,
          sourcesUsed: initialResearch.sources?.length || 0,
        },
      ],
    };

    // Step 7: Store the enriched profile
    await ctx.runMutation(
      internal.domains.knowledge.adaptiveEntityQueries.storeAdaptiveProfile,
      { entityName: args.entityName, profile }
    );

    console.log(`[AdaptiveEnrich] Completed in ${Date.now() - startTime}ms`);
    return profile;
  },
});

/**
 * Perform initial web research on the entity using direct Linkup API call
 */
export const performInitialResearch = internalAction({
  args: {
    entityName: v.string(),
    knownType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let combinedResearch = "";
    const sources: Array<{ name: string; url?: string }> = [];

    const apiKey = process.env.LINKUP_API_KEY;

    if (apiKey) {
      try {
        // Direct Linkup API call for comprehensive entity research
        const response = await fetch("https://api.linkup.so/v1/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q: `${args.entityName} comprehensive profile biography career history ${args.knownType || ""}`,
            depth: "deep",
            outputType: "sourcedAnswer",
            includeInlineCitations: true,
            includeSources: true,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.answer) {
            combinedResearch = data.answer;
          }
          if (data.sources) {
            sources.push(
              ...data.sources.map((s: any) => ({ name: s.name, url: s.url }))
            );
          }
          console.log(`[InitialResearch] Linkup returned ${sources.length} sources`);
        } else {
          console.log(`[InitialResearch] Linkup API returned ${response.status}`);
        }
      } catch (e) {
        console.log("[InitialResearch] Linkup search failed:", e);
      }
    } else {
      console.log("[InitialResearch] No LINKUP_API_KEY, using LLM knowledge only");
    }

    // If no external research, use LLM to generate based on general knowledge
    if (!combinedResearch) {
      try {
        combinedResearch = await generateLLMText(
          `Provide a comprehensive profile of ${args.entityName}${args.knownType ? ` (${args.knownType})` : ""}.

Include:
- Background and history
- Key career milestones
- Education and credentials
- Companies/organizations associated with
- Notable achievements
- Current role/status

Provide factual, detailed information.`,
          2000
        );
        sources.push({ name: "LLM Knowledge Base" });
      } catch (e) {
        console.log("[InitialResearch] LLM fallback also failed:", e);
      }
    }

    return {
      entityName: args.entityName,
      rawResearch: combinedResearch,
      sources,
      timestamp: new Date().toISOString(),
    };
  },
});

/**
 * Use LLM to discover entity structure
 */
export const discoverEntityStructure = internalAction({
  args: {
    entityName: v.string(),
    initialResearch: v.any(),
  },
  handler: async (ctx, args) => {
    // Call LLM with discovery prompt
    const prompt = `${ENTITY_DISCOVERY_PROMPT}

ENTITY: ${args.entityName}

RESEARCH DATA:
${args.initialResearch.rawResearch || "Limited initial data available. Make reasonable inferences based on the entity name."}

Analyze this entity and provide the discovery output. Return valid JSON only:`;

    try {
      const result = await generateLLMText(prompt, 2000);
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, result];
      const jsonStr = jsonMatch[1]?.trim() || result.trim();
      return JSON.parse(jsonStr);
    } catch (e) {
      console.log("[discoverEntityStructure] Parse error, using defaults:", e);
      // Return a default structure if parsing fails
      return {
        entityType: "unknown",
        subTypes: [],
        headline: args.entityName,
        executiveSummary: {
          whatTheyreKnownFor: "Research in progress",
          currentFocus: "Unknown",
          whyTheyMatter: "To be determined",
          keyInsight: "Insufficient data",
        },
        suggestedSections: [
          {
            id: "overview",
            title: "Overview",
            icon: "info",
            priority: 1,
            reasoning: "Basic information about the entity",
            researchQuestions: ["What is their background?"],
          },
        ],
        timelineCategories: ["career", "education"],
        relationshipTypes: ["professional"],
        researchPriorities: ["basic background"],
      };
    }
  },
});

/**
 * Extract timeline events from research
 */
export const extractTimeline = internalAction({
  args: {
    entityName: v.string(),
    research: v.any(),
    categories: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<TimelineEvent[]> => {
    const prompt = `${TIMELINE_EXTRACTION_PROMPT}

ENTITY: ${args.entityName}

CATEGORIES TO FOCUS ON: ${args.categories.join(", ")}

RESEARCH DATA:
${args.research.rawResearch || "Limited data available"}

Extract the timeline. Return valid JSON array only:`;

    try {
      const result = await generateLLMText(prompt, 3000);
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, result];
      const jsonStr = jsonMatch[1]?.trim() || result.trim();
      const events = JSON.parse(jsonStr);
      return Array.isArray(events) ? events : [];
    } catch (e) {
      console.log("[extractTimeline] Parse error:", e);
      return [];
    }
  },
});

/**
 * Map entity relationships
 */
export const mapRelationships = internalAction({
  args: {
    entityName: v.string(),
    research: v.any(),
    timeline: v.any(),
  },
  handler: async (ctx, args) => {
    const prompt = `${RELATIONSHIP_MAPPING_PROMPT}

ENTITY: ${args.entityName}

RESEARCH DATA:
${args.research.rawResearch || "Limited data"}

TIMELINE EVENTS:
${JSON.stringify(args.timeline, null, 2)}

Map the relationships. Return valid JSON only:`;

    try {
      const result = await generateLLMText(prompt, 2000);
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, result];
      const jsonStr = jsonMatch[1]?.trim() || result.trim();
      return JSON.parse(jsonStr);
    } catch (e) {
      console.log("[mapRelationships] Parse error:", e);
      return {
        relationships: [],
        circleOfInfluence: { tier1: [], tier2: [], tier3: [] },
        networkInsights: "Unable to map relationships",
      };
    }
  },
});

/**
 * Enrich a specific section
 */
export const enrichSection = internalAction({
  args: {
    entityName: v.string(),
    section: v.any(),
    existingResearch: v.any(),
  },
  handler: async (ctx, args): Promise<AdaptiveSection> => {
    // Determine best content type for this section
    const contentType = inferContentType(args.section.title);

    const prompt = SECTION_CONTENT_PROMPT
      .replace("{sectionTitle}", args.section.title)
      .replace("{sectionReasoning}", args.section.reasoning)
      .replace("{researchQuestions}", JSON.stringify(args.section.researchQuestions))
      .replace(/{contentType}/g, contentType);

    const fullPrompt = `${prompt}

ENTITY: ${args.entityName}

EXISTING RESEARCH:
${args.existingResearch.rawResearch || "Limited data"}

Generate the section content. Return valid JSON only:`;

    try {
      const result = await generateLLMText(fullPrompt, 1500);
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, result];
      const jsonStr = jsonMatch[1]?.trim() || result.trim();
      const content = JSON.parse(jsonStr);
      return {
        id: args.section.id,
        title: args.section.title,
        icon: args.section.icon,
        priority: args.section.priority,
        content,
        reasoning: args.section.reasoning,
        lastUpdated: new Date().toISOString(),
      };
    } catch (e) {
      console.log("[enrichSection] Parse error:", e);
      return {
        id: args.section.id,
        title: args.section.title,
        icon: args.section.icon,
        priority: args.section.priority,
        content: {
          type: "narrative",
          data: { text: "Research in progress", highlights: [] },
        },
        reasoning: args.section.reasoning,
        lastUpdated: new Date().toISOString(),
      };
    }
  },
});

// NOTE: storeAdaptiveProfile mutation and getAdaptiveProfile query are in adaptiveEntityQueries.ts
// (Queries and mutations cannot use "use node")

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function inferContentType(sectionTitle: string): string {
  const title = sectionTitle.toLowerCase();
  if (title.includes("timeline") || title.includes("history") || title.includes("journey")) {
    return "timeline";
  }
  if (title.includes("network") || title.includes("relationship") || title.includes("connection")) {
    return "network";
  }
  if (title.includes("metric") || title.includes("stat") || title.includes("number")) {
    return "stats";
  }
  if (title.includes("compare") || title.includes("vs") || title.includes("benchmark")) {
    return "comparison";
  }
  if (title.includes("portfolio") || title.includes("investment") || title.includes("company")) {
    return "list";
  }
  return "narrative";
}

function assessEnrichmentQuality(
  research: any,
  timeline: TimelineEvent[],
  relationships: any,
  sections: AdaptiveSection[]
): AdaptiveEntityProfile["enrichmentQuality"] {
  const gaps: string[] = [];

  // Check timeline completeness
  if (timeline.length === 0) gaps.push("No timeline events found");
  if (timeline.length < 5) gaps.push("Limited timeline data");

  // Check relationships
  if (!relationships.relationships || relationships.relationships.length === 0) {
    gaps.push("No relationships mapped");
  }

  // Check sections
  if (sections.length === 0) gaps.push("No detailed sections generated");

  // Calculate scores
  const completeness = Math.min(100, (
    (timeline.length > 0 ? 25 : 0) +
    (timeline.length >= 5 ? 25 : timeline.length * 5) +
    (relationships.relationships?.length > 0 ? 25 : 0) +
    (sections.length > 0 ? 25 : 0)
  ));

  const confidence = Math.min(100, (
    (research.sources?.length || 0) * 10 +
    (timeline.filter((e: TimelineEvent) => e.dateGranularity === "day").length * 5) +
    (relationships.relationships?.filter((r: EntityRelationship) => r.strength === "strong").length || 0) * 10
  ));

  return {
    completeness,
    confidence,
    dataFreshness: 0, // Just created
    gaps,
  };
}

// ═══════════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH POPULATION FROM ADAPTIVE PROFILES
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert adaptive profile to knowledge graph claims and edges
 * Creates subject-predicate-object triples from timeline, relationships, and sections
 */
export const populateKnowledgeGraphFromProfile = internalAction({
  args: {
    entityName: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Fetch the adaptive profile (public query accessible via api)
    const profile = await ctx.runQuery(
      api.domains.knowledge.adaptiveEntityQueries.getAdaptiveProfile,
      { entityName: args.entityName }
    );

    if (!profile) {
      console.log(`[KnowledgeGraph] No adaptive profile found for ${args.entityName}`);
      return { success: false, error: "No adaptive profile found" };
    }

    // Convert profile to claims
    const claims: Array<{
      subject: string;
      predicate: string;
      object: string;
      claimText: string;
      isHighConfidence: boolean;
      sourceDocIds: string[];
      sourceSnippets?: string[];
    }> = [];

    const edges: Array<{
      fromIndex: number;
      toIndex: number;
      edgeType: "supports" | "contradicts" | "mentions" | "causes" | "relatedTo" | "partOf" | "precedes";
      isStrong: boolean;
    }> = [];

    // 1. Extract claims from timeline events
    const timeline = profile.timeline || [];
    const timelineClaimIndices: Map<string, number> = new Map();

    for (const event of timeline) {
      const claimIndex = claims.length;
      timelineClaimIndices.set(event.id, claimIndex);

      claims.push({
        subject: args.entityName,
        predicate: event.category,
        object: event.title,
        claimText: `${args.entityName} - ${event.category}: ${event.title} (${event.date}). ${event.description}`,
        isHighConfidence: event.significance === "high",
        sourceDocIds: event.sources?.map((s: { url?: string; name: string }) => s.url || s.name) || [],
        sourceSnippets: [event.description],
      });

      // Add related entity claims
      for (const related of event.relatedEntities || []) {
        const relatedClaimIndex = claims.length;
        claims.push({
          subject: related.name,
          predicate: related.role,
          object: args.entityName,
          claimText: `${related.name} (${related.type}) is ${related.role} of ${args.entityName}`,
          isHighConfidence: true,
          sourceDocIds: [],
        });

        // Link the related entity claim to the timeline event
        edges.push({
          fromIndex: relatedClaimIndex,
          toIndex: claimIndex,
          edgeType: "relatedTo",
          isStrong: true,
        });
      }
    }

    // 2. Extract claims from relationships
    const relationships = profile.relationships || [];
    for (const rel of relationships) {
      const claimIndex = claims.length;
      claims.push({
        subject: args.entityName,
        predicate: rel.relationshipType,
        object: rel.entityName,
        claimText: `${args.entityName} has ${rel.relationshipType} relationship with ${rel.entityName}. ${rel.context || ""}`,
        isHighConfidence: rel.strength === "strong",
        sourceDocIds: [],
        sourceSnippets: rel.context ? [rel.context] : undefined,
      });

      // If bidirectional, add reverse claim
      if (rel.isBidirectional) {
        const reverseIndex = claims.length;
        claims.push({
          subject: rel.entityName,
          predicate: rel.relationshipType,
          object: args.entityName,
          claimText: `${rel.entityName} has ${rel.relationshipType} relationship with ${args.entityName}`,
          isHighConfidence: rel.strength === "strong",
          sourceDocIds: [],
        });

        // Link bidirectional claims
        edges.push({
          fromIndex: claimIndex,
          toIndex: reverseIndex,
          edgeType: "supports",
          isStrong: true,
        });
      }
    }

    // 3. Extract claims from circle of influence
    const circleOfInfluence = profile.circleOfInfluence;
    if (circleOfInfluence) {
      // Tier 1 - inner circle
      for (const innerName of circleOfInfluence.tier1 || []) {
        claims.push({
          subject: args.entityName,
          predicate: "innerCircle",
          object: innerName,
          claimText: `${innerName} is in ${args.entityName}'s inner circle (tier 1 influence)`,
          isHighConfidence: true,
          sourceDocIds: [],
        });
      }

      // Tier 2 - extended network
      for (const extendedName of circleOfInfluence.tier2 || []) {
        claims.push({
          subject: args.entityName,
          predicate: "extendedNetwork",
          object: extendedName,
          claimText: `${extendedName} is in ${args.entityName}'s extended network (tier 2 influence)`,
          isHighConfidence: false,
          sourceDocIds: [],
        });
      }
    }

    // 4. Extract claims from sections (key points)
    const sections = profile.sections || [];
    for (const section of sections) {
      for (const point of section.keyPoints || []) {
        claims.push({
          subject: args.entityName,
          predicate: section.title.toLowerCase().replace(/\s+/g, "_"),
          object: point,
          claimText: `${args.entityName} - ${section.title}: ${point}`,
          isHighConfidence: section.importance === "high",
          sourceDocIds: [],
        });
      }
    }

    // 5. Add precedes edges for chronological timeline events
    const sortedEvents = [...timeline].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    for (let i = 0; i < sortedEvents.length - 1; i++) {
      const currentIndex = timelineClaimIndices.get(sortedEvents[i].id);
      const nextIndex = timelineClaimIndices.get(sortedEvents[i + 1].id);
      if (currentIndex !== undefined && nextIndex !== undefined) {
        edges.push({
          fromIndex: currentIndex,
          toIndex: nextIndex,
          edgeType: "precedes",
          isStrong: true,
        });
      }
    }

    // Create the knowledge graph if we have claims
    if (claims.length === 0) {
      console.log(`[KnowledgeGraph] No claims extracted from profile for ${args.entityName}`);
      return { success: false, error: "No claims extracted from profile" };
    }

    // Call the internal mutation to create the graph
    const graphId = await ctx.runMutation(
      internal.domains.knowledge.knowledgeGraph.createGraph,
      {
        name: `${args.entityName} Knowledge Graph`,
        sourceType: "entity",
        sourceId: args.entityName.toLowerCase().replace(/\s+/g, "-"),
        userId: args.userId,
        claims,
        edges,
      }
    );

    console.log(`[KnowledgeGraph] Created graph ${graphId} with ${claims.length} claims and ${edges.length} edges for ${args.entityName}`);

    return {
      success: true,
      graphId,
      claimCount: claims.length,
      edgeCount: edges.length,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════
// AUTO-ENRICHMENT TRIGGER SYSTEM
// ═══════════════════════════════════════════════════════════════════

/**
 * Check if an entity needs enrichment and trigger it if necessary
 * Can be called from frontend hover events, agent responses, or feed processing
 */
export const triggerAutoEnrichment = action({
  args: {
    entityName: v.string(),
    entityType: v.optional(v.string()),
    source: v.optional(v.string()), // "hover", "agent", "feed", "digest"
    priority: v.optional(v.union(v.literal("high"), v.literal("normal"), v.literal("low"))),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // Check if entity already has an adaptive profile
    const existingProfile = await ctx.runQuery(
      api.domains.knowledge.adaptiveEntityQueries.getAdaptiveProfile,
      { entityName: args.entityName }
    );

    if (existingProfile) {
      // Check if profile is stale (older than 7 days)
      const profileAge = Date.now() - (existingProfile.enrichmentQuality?.dataFreshness || Date.now());
      const isStale = profileAge > 7 * 24 * 60 * 60 * 1000; // 7 days

      if (!isStale) {
        console.log(`[AutoEnrich] Profile exists for ${args.entityName} and is fresh`);
        return {
          triggered: false,
          reason: "Profile exists and is fresh",
          profileExists: true,
          completeness: existingProfile.enrichmentQuality?.completeness || 0,
        };
      }

      console.log(`[AutoEnrich] Profile exists but is stale for ${args.entityName}, triggering refresh`);
    }

    // Determine depth based on priority
    let depth: "surface" | "standard" | "deep" = "standard";
    if (args.priority === "high") {
      depth = "deep";
    } else if (args.priority === "low") {
      depth = "surface";
    }

    // Trigger enrichment asynchronously
    // For high priority, wait for result; otherwise fire and forget
    try {
      if (args.priority === "high") {
        const profile = await ctx.runAction(
          internal.domains.knowledge.adaptiveEntityEnrichment.enrichEntity,
          {
            entityName: args.entityName,
            knownType: args.entityType,
            depth,
          }
        );

        console.log(`[AutoEnrich] High-priority enrichment completed for ${args.entityName} in ${Date.now() - startTime}ms`);

        return {
          triggered: true,
          reason: args.source === "hover" ? "Hover triggered enrichment" :
                  args.source === "agent" ? "Agent response triggered enrichment" :
                  args.source === "feed" ? "Feed item triggered enrichment" :
                  "Manual enrichment triggered",
          profileExists: true,
          completeness: profile.enrichmentQuality?.completeness || 0,
          timelineCount: profile.timeline?.length || 0,
          relationshipCount: profile.relationships?.length || 0,
        };
      } else {
        // Fire and forget for normal/low priority
        ctx.runAction(
          internal.domains.knowledge.adaptiveEntityEnrichment.enrichEntity,
          {
            entityName: args.entityName,
            knownType: args.entityType,
            depth,
          }
        ).catch((err: Error) => {
          console.error(`[AutoEnrich] Background enrichment failed for ${args.entityName}:`, err);
        });

        console.log(`[AutoEnrich] Background enrichment triggered for ${args.entityName}`);

        return {
          triggered: true,
          reason: `${args.priority || "normal"}-priority enrichment queued`,
          profileExists: false,
          completeness: 0,
        };
      }
    } catch (err) {
      console.error(`[AutoEnrich] Failed to enrich ${args.entityName}:`, err);
      return {
        triggered: false,
        reason: `Enrichment failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        profileExists: !!existingProfile,
        completeness: existingProfile?.enrichmentQuality?.completeness || 0,
      };
    }
  },
});

/**
 * Batch trigger enrichment for multiple entities (useful for digest processing)
 */
export const batchTriggerEnrichment = action({
  args: {
    entities: v.array(v.object({
      name: v.string(),
      type: v.optional(v.string()),
    })),
    source: v.optional(v.string()),
    maxConcurrent: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxConcurrent = args.maxConcurrent || 3;
    const results: Array<{ name: string; triggered: boolean; reason: string }> = [];

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < args.entities.length; i += maxConcurrent) {
      const batch = args.entities.slice(i, i + maxConcurrent);

      const batchResults = await Promise.allSettled(
        batch.map(async (entity: { name: string; type?: string }) => {
          // Check if already enriched
          const existing = await ctx.runQuery(
            api.domains.knowledge.adaptiveEntityQueries.getAdaptiveProfile,
            { entityName: entity.name }
          );

          if (existing && existing.enrichmentQuality?.completeness > 50) {
            return { name: entity.name, triggered: false, reason: "Already enriched" };
          }

          // Trigger background enrichment
          ctx.runAction(
            internal.domains.knowledge.adaptiveEntityEnrichment.enrichEntity,
            {
              entityName: entity.name,
              knownType: entity.type,
              depth: "surface",
            }
          ).catch((err: Error) => {
            console.error(`[BatchEnrich] Failed for ${entity.name}:`, err);
          });

          return { name: entity.name, triggered: true, reason: "Enrichment queued" };
        })
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          results.push({ name: "unknown", triggered: false, reason: "Promise rejected" });
        }
      }
    }

    const triggered = results.filter(r => r.triggered).length;
    console.log(`[BatchEnrich] Triggered enrichment for ${triggered}/${args.entities.length} entities`);

    return { results, triggeredCount: triggered };
  },
});
