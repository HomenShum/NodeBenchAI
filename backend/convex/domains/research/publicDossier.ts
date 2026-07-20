"use node";

/**
 * Public Dossier Actions (Node.js runtime)
 * 
 * Queries and mutations are in publicDossierQueries.ts (Convex runtime)
 * This file contains only actions that need Node.js (fetch, process.env)
 */

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { getLlmModel } from "../../../shared/llm/modelCatalog";

// NOTE: Queries and mutations are in publicDossierQueries.ts
// Import them via api.domains.research.publicDossierQueries instead

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA: ScrollySection type for the daily public dossier
// ═══════════════════════════════════════════════════════════════════════════

const tooltipPayload = v.object({
  title: v.string(),
  body: v.string(),
  kicker: v.optional(v.string()),
});

const chartPoint = v.object({
  value: v.number(),
  tooltip: v.optional(tooltipPayload),
});

const chartSeries = v.object({
  id: v.string(),
  label: v.string(),
  type: v.union(v.literal("solid"), v.literal("ghost")),
  color: v.optional(v.string()),
  data: v.array(chartPoint),
});

const trendLineConfig = v.object({
  title: v.string(),
  xAxisLabels: v.array(v.string()),
  series: v.array(chartSeries),
  visibleEndIndex: v.number(),
  focusIndex: v.optional(v.number()),
});

const annotation = v.object({
  id: v.string(),
  title: v.string(),
  description: v.string(),
  position: v.object({ x: v.number(), y: v.number() }),
  associatedDataIndex: v.optional(v.number()),
});

const dashboardState = v.object({
  meta: v.object({
    currentDate: v.string(),
    timelineProgress: v.number(),
  }),
  charts: v.object({
    trendLine: trendLineConfig,
    marketShare: v.array(v.object({
      label: v.string(),
      value: v.number(),
      color: v.string(),
    })),
  }),
  techReadiness: v.object({
    existing: v.number(),
    emerging: v.number(),
    sciFi: v.number(),
  }),
  keyStats: v.array(v.object({
    label: v.string(),
    value: v.string(),
    sub: v.optional(v.string()),
    trend: v.optional(v.union(v.literal("up"), v.literal("down"), v.literal("flat"))),
    context: v.optional(v.string()),
  })),
  capabilities: v.array(v.object({
    label: v.string(),
    score: v.number(),
    icon: v.string(),
  })),
  annotations: v.optional(v.array(annotation)),
});

export const scrollySectionValidator = v.object({
  id: v.string(),
  meta: v.object({
    date: v.string(),
    title: v.string(),
  }),
  content: v.object({
    body: v.array(v.string()),
    deepDives: v.array(v.object({
      title: v.string(),
      content: v.string(),
    })),
  }),
  // Legacy dashboard still accepted; frontend will normalize to TrendLineConfig
  dashboard: v.optional(v.object({
    phaseLabel: v.string(),
    kpis: v.array(v.object({
      label: v.string(),
      value: v.number(),
      unit: v.string(),
      color: v.string(),
    })),
    marketSentiment: v.number(),
    activeRegion: v.string(),
  })),
  // New timeline-aware dashboard state powering progressive charts
  timelineState: v.optional(v.object({
    sectionId: v.string(),
    narrative: v.object({
      title: v.string(),
      date_display: v.string(),
      summary: v.string(),
      body: v.string(),
    }),
    dashboard_state: dashboardState,
  })),
  smartLinks: v.optional(v.record(v.string(), v.object({
    summary: v.string(),
    source: v.optional(v.string()),
  }))),
});

// ═══════════════════════════════════════════════════════════════════════════
// DEEP AGENT ACTION: Generate daily dossier content
// ═══════════════════════════════════════════════════════════════════════════

const DOSSIER_SYSTEM_PROMPT = `You are an AI research analyst generating a daily intelligence briefing in a specific JSON format.

Your output MUST be a valid JSON array of sections following this structure (no markdown fences):
[
  {
    "id": "unique-section-id",
    "meta": { "date": "Section Label", "title": "Section Title" },
    "content": {
      "body": ["Paragraph 1 with <SmartLink id='term-id'>linked terms</SmartLink>.", "Paragraph 2..."],
      "deepDives": [{ "title": "Deep Dive Title", "content": "Expanded explanation..." }]
    },
    "timelineState": {
      "sectionId": "phase-1",
      "narrative": {
        "title": "Narrative Title",
        "date_display": "Q1 2024 - Q2 2024",
        "summary": "One-line summary",
        "body": "A short paragraph for this beat"
      },
      "dashboard_state": {
        "meta": { "currentDate": "Apr 2024", "timelineProgress": 0.2 },
        "charts": {
          "trendLine": {
            "title": "Capability vs Reliability",
            "xAxisLabels": ["Q1 '24","Q2 '24","Q3 '24","Q4 '24","Q1 '25","Q2 '25"],
            "visibleEndIndex": 2,
            "focusIndex": 2,
            "series": [
              {
                "id": "model-cap",
                "label": "Model Capability",
                "type": "ghost",
                "color": "gray",
                "data": [
                  { "value": 20, "tooltip": { "title": "GPT-4", "body": "High capability, low steerability." } },
                  { "value": 45, "tooltip": { "title": "Context Expansion", "body": "128k windows strain infra." } },
                  { "value": 70, "tooltip": { "title": "Multimodal", "body": "Vision/audio saturates bandwidth." } },
                  { "value": 85, "tooltip": { "title": "Reasoning Models", "body": "Latency/throughput challenges." } },
                  { "value": 95, "tooltip": { "title": "Agent Swarms", "body": "Parallel tool calls." } },
                  { "value": 98, "tooltip": { "title": "AGI Threshold", "body": "Diminishing returns." } }
                ]
              },
              {
                "id": "infra-rel",
                "label": "Infra Reliability",
                "type": "solid",
                "color": "accent",
                "data": [
                  { "value": 18, "tooltip": { "title": "Status Quo", "body": "Basic MLOps." } },
                  { "value": 22, "tooltip": { "title": "Bottleneck", "body": "RAG pipelines failing." } },
                  { "value": 25, "tooltip": { "title": "Stagnation", "body": "DB contention." } },
                  { "value": 40, "tooltip": { "title": "Recovery", "body": "New orchestration layers." } },
                  { "value": 75, "tooltip": { "title": "Catch Up", "body": "Capital deployment impact." } },
                  { "value": 92, "tooltip": { "title": "Parity", "body": "Reliability matches capability." } }
                ]
              }
            ]
          },
          "marketShare": [
            { "label": "Compute", "value": 60, "color": "black" },
            { "label": "Storage", "value": 30, "color": "gray" },
            { "label": "Orchestration", "value": 10, "color": "accent" }
          ]
        },
        "techReadiness": { "existing": 8, "emerging": 2, "sciFi": 0 },
        "keyStats": [
          { "label": "Gap Width", "value": "45 pts", "trend": "up", "context": "Risk" },
          { "label": "Fail Rate", "value": "12%", "trend": "up" },
          { "label": "Latency", "value": "2.4s", "trend": "up" }
        ],
        "capabilities": [
          { "label": "Scale", "score": 85, "icon": "trending-up" },
          { "label": "Reliability", "score": 60, "icon": "shield-check" },
          { "label": "Cost", "score": 40, "icon": "dollar-sign" }
        ],
        "annotations": [
          {
            "id": "gap-1",
            "title": "Reliability Gap",
            "description": "Where enterprise POCs fail.",
            "position": { "x": 50, "y": 45 },
            "associatedDataIndex": 2
          }
        ]
      }
    },
    "smartLinks": {
      "term-id": { "summary": "Explanation of the term", "source": "Source Name" }
    }
  }
]

Guidelines:
1. Generate 5 sections: Executive Summary, Funding Highlights, Emerging Trends, Technical Deep Dive, Week Ahead.
2. Use <SmartLink id='x'>text</SmartLink> for key terms that deserve tooltips.
3. Use a single master timeline (same xAxisLabels and series length) and adjust visibleEndIndex/focusIndex per section to create a progressive reveal.
4. Include rich per-point tooltips; mark future/projection series as "ghost".
5. Include real companies, funding rounds, and technical concepts when possible.
6. Keep content actionable and specific (no generic filler).
7. Output ONLY the JSON array, no markdown or prose.`;

export const generateDailyDossier = internalAction({
  args: {
    topic: v.optional(v.string()),
    forceRefresh: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<{ success: boolean; cached: boolean; dossier?: any; dossierId?: any; sectionsCount?: number }> => {
    const topic = args.topic || "AI Infrastructure & Venture Capital";
    const today = new Date().toISOString().split("T")[0];
    
    // Check if we already have today's dossier (unless force refresh)
    if (!args.forceRefresh) {
      const existing: any = await ctx.runQuery(api.domains.research.publicDossierQueries.getDossierByDate, { date: today });
      if (existing) {
        console.log(`[generateDailyDossier] Using cached dossier from ${today}`);
        return { success: true, cached: true, dossier: existing };
      }
    }

    console.log(`[generateDailyDossier] Generating fresh dossier for topic: ${topic}`);
    
    // Call LLM to generate dossier content
    // Use model catalog for consistent model selection across the app
    const model = getLlmModel("analysis", "openai");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    console.log(`[generateDailyDossier] Using model: ${model}`);

    const userPrompt = `Generate a comprehensive daily intelligence briefing for: "${topic}"

Today's date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}

Focus on:
- Recent funding rounds and M&A activity (last 7 days)
- Emerging technical trends and breakthroughs
- Key players and their movements
- Forward-looking analysis for the week ahead
- Actionable insights for investors and founders

Output ONLY the JSON array, no markdown code blocks or extra text.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: DOSSIER_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 8000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    
    // Parse the JSON response
    let sections;
    try {
      // Handle potential markdown code blocks
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("No JSON array found in response");
      }
      sections = JSON.parse(jsonMatch[0]);
    } catch (parseError: any) {
      console.error("[generateDailyDossier] Failed to parse LLM response:", content.slice(0, 500));
      throw new Error(`Failed to parse dossier JSON: ${parseError.message}`);
    }

    // Validate sections structure
    if (!Array.isArray(sections) || sections.length === 0) {
      throw new Error("Invalid dossier structure: expected non-empty array");
    }

    // Store the generated dossier
    const dossierId: any = await ctx.runMutation(api.domains.research.publicDossierQueries.storePublicDossier, {
      sections,
      topic,
    });

    console.log(`[generateDailyDossier] Stored dossier ${dossierId} with ${sections.length} sections`);

    return {
      success: true,
      cached: false,
      dossierId,
      sectionsCount: sections.length,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MANUAL TRIGGER: For testing
// ═══════════════════════════════════════════════════════════════════════════

export const triggerDossierGeneration = action({
  args: {
    topic: v.optional(v.string()),
    forceRefresh: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<any> => {
    return await ctx.runAction(internal.domains.research.publicDossier.generateDailyDossier, {
      topic: args.topic,
      forceRefresh: args.forceRefresh,
    });
  },
});
