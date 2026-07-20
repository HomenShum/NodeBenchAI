// convex/tools/orchestrationTools.ts
// Meta-tools for Coordinator self-awareness and planning
// These are TOOLS the agent calls, not a separate routing layer

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { GoogleGenAI, createUserContent, Type } from "@google/genai";
import { getLlmModel } from "../../../shared/llm/modelCatalog";

// ═══════════════════════════════════════════════════════════════════════════
// VERSIONING & CACHING
// Capabilities version - bump when tools change
// ═══════════════════════════════════════════════════════════════════════════

const CAPABILITIES_VERSION = "v1.3"; // Added universal research tools (researchAnything, expandSubject, renderResearchOutput)
const CAPABILITIES_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #1: discoverCapabilities
// Returns a catalog of what the Coordinator can do (static, no LLM call)
// Includes version + timestamp for caching
// ═══════════════════════════════════════════════════════════════════════════

export const discoverCapabilities = createTool({
  description: `Return a catalog of what the Coordinator can do:
- directTools: Tools that can be called directly
- delegationAgents: Subagents that can be delegated to
- metaTools: Self-inspection and planning tools

Call this AT MOST ONCE per conversation when uncertain about capabilities.
Result includes version + timestamp for caching validation.`,

  args: z.object({
    cachedVersion: z.string().optional().describe("If you have cached capabilities, pass the version to check freshness"),
    cachedTimestamp: z.number().optional().describe("Timestamp of cached capabilities"),
  }),

  handler: async (_ctx, args) => {
    // Check if cached version is still valid
    if (args.cachedVersion && args.cachedTimestamp) {
      const isVersionValid = args.cachedVersion === CAPABILITIES_VERSION;
      const isFresh = (Date.now() - args.cachedTimestamp) < CAPABILITIES_TTL_MS;
      
      if (isVersionValid && isFresh) {
        return {
          cacheHit: true,
          message: "Cached capabilities are still valid. Use your cached version.",
          version: CAPABILITIES_VERSION,
          timestamp: args.cachedTimestamp,
        };
      }
    }

    return {
      cacheHit: false,
      version: CAPABILITIES_VERSION,
      timestamp: Date.now(),
      directTools: [
        // GAM / Memory
        { name: "queryMemory", purpose: "Look up existing entity/theme memory (CALL FIRST)", category: "gam", writesMemory: false },
        { name: "getOrBuildMemory", purpose: "Schedule deeper research jobs for important entities", category: "gam", writesMemory: true, writes: "entityContexts" },
        { name: "updateMemoryFromReview", purpose: "Merge extracted facts from analysis into long-term memory", category: "gam", writesMemory: true, writes: "entityContexts" },
        
        // Research / Data - enrichCompanyDossier can write to entityContexts
        { name: "enrichCompanyDossier", purpose: "Deep company research (funding + web + internal data)", category: "research", writesMemory: true, writes: "entityContexts" },
        { name: "enrichFounderInfo", purpose: "Research founders' backgrounds, exits, education", category: "research", writesMemory: false },
        { name: "enrichInvestmentThesis", purpose: "Analyze why a company was funded", category: "research", writesMemory: false },
        { name: "enrichPatentsAndResearch", purpose: "Look for IP/Patents (Life Sciences focus)", category: "research", writesMemory: false },
        { name: "smartFundingSearch", purpose: "Find recent funding rounds with auto-fallback", category: "research", writesMemory: false },
        { name: "researchAnything", purpose: "Multi-angle research on any subject (companies, people, events, topics). Returns 3-act briefing + prep pack.", category: "research", writesMemory: false },
        { name: "expandSubject", purpose: "Quick entity resolution for a single subject", category: "research", writesMemory: false },
        { name: "renderResearchOutput", purpose: "Format research into compact alert, email digest, or markdown", category: "research", writesMemory: false },
        
        // SEC
        { name: "searchSecFilings", purpose: "Search SEC filings (10-K, 10-Q, 8-K) by ticker", category: "sec", writesMemory: false },
        { name: "downloadSecFiling", purpose: "Download and analyze a specific SEC filing", category: "sec", writesMemory: false },
        
        // Web / Media
        { name: "linkupSearch", purpose: "General web search", category: "web", writesMemory: false },
        { name: "youtubeSearch", purpose: "Search YouTube videos", category: "media", writesMemory: false },
        
        // Documents
        { name: "findDocument", purpose: "Search for documents by title or content", category: "document", writesMemory: false },
        { name: "getDocumentContent", purpose: "Read the content of a specific document", category: "document", writesMemory: false },
        { name: "analyzeDocument", purpose: "Analyze a single document", category: "document", writesMemory: false },
        
        // Hashtags / Themes
        { name: "searchHashtag", purpose: "Find documents about a topic/hashtag", category: "theme", writesMemory: false },
        { name: "createHashtagDossier", purpose: "Create a dossier for a topic", category: "theme", writesMemory: true, writes: "hashtagDossiers" },
        
        // Context Tools
        { name: "initScratchpad", purpose: "Initialize fresh scratchpad (call at start of each message)", category: "context", writesMemory: false },
        { name: "updateScratchpad", purpose: "Update scratchpad state after tool calls", category: "context", writesMemory: false },
        { name: "compactContext", purpose: "Compress tool output into structured format", category: "context", writesMemory: false },
        { name: "markMemoryUpdated", purpose: "Track that entity was updated (for dedupe)", category: "context", writesMemory: false },
        { name: "isMemoryUpdated", purpose: "Check if entity was already updated", category: "context", writesMemory: false },
        
        // Knowledge Graph Tools (NEW)
        { name: "buildKnowledgeGraph", purpose: "Build a claim graph from entity/theme/artifact with SPO triples + provenance", category: "kg", writesMemory: true, writes: "knowledgeGraphs" },
        { name: "fingerprintKnowledgeGraph", purpose: "Generate semantic + structural fingerprints for a graph (required for clustering)", category: "kg", writesMemory: true, writes: "knowledgeGraphs" },
        { name: "getGraphSummary", purpose: "Get overview of a knowledge graph (claims, edges, clustering status)", category: "kg", writesMemory: false },
        
        // Clustering Tools (NEW)
        { name: "groupAndDetectOutliers", purpose: "Run HDBSCAN clustering on graphs. Returns clusterId + isOddOneOut (boolean)", category: "clustering", writesMemory: true, writes: "graphClusters" },
        { name: "checkNovelty", purpose: "Check if graph is inlier/outlier vs clusters (One-Class SVM soft hull)", category: "clustering", writesMemory: true, writes: "knowledgeGraphs" },
        { name: "explainSimilarity", purpose: "Compare two graphs and explain shared/different claims + structure", category: "clustering", writesMemory: false },
      ],

      delegationAgents: [
        {
          name: "EntityResearchAgent",
          specialty: "Deep company/person research with multi-hop tools",
          delegateTool: "delegateToEntityResearchAgent",
          tools: ["enrichCompanyDossier", "enrichFounderInfo", "queryMemory", "updateMemoryFromReview"],
          writesMemory: true, // Subagent can update memory
        },
        {
          name: "DocumentAgent",
          specialty: "Document search, reading, creation, editing, multi-document analysis",
          delegateTool: "delegateToDocumentAgent",
          tools: ["findDocument", "getDocumentContent", "analyzeDocument"],
          writesMemory: false,
        },
        {
          name: "MediaAgent",
          specialty: "YouTube videos, web search, images, media discovery",
          delegateTool: "delegateToMediaAgent",
          tools: ["youtubeSearch", "linkupSearch", "searchMedia"],
          writesMemory: false,
        },
        {
          name: "SECAgent",
          specialty: "SEC filings analysis (10-K, 10-Q, 8-K, S-1)",
          delegateTool: "delegateToSECAgent",
          tools: ["searchSecFilings", "downloadSecFiling"],
          writesMemory: false,
        },
        {
          name: "OpenBBAgent",
          specialty: "Financial data, stock prices, crypto, economic indicators",
          delegateTool: "delegateToOpenBBAgent",
          tools: ["getStockPrice", "getCryptoPrice", "getEconomicData"],
          writesMemory: false,
        },
      ],

      metaTools: [
        { name: "discoverCapabilities", purpose: "Self-inspect available tools and agents (call once)", writesMemory: false },
        { name: "sequentialThinking", purpose: "Plan multi-step tasks over tools/agents (for complex tasks)", writesMemory: false },
        { name: "decomposeQuery", purpose: "Split multi-entity queries into atomic research units", writesMemory: false },
      ],
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #2: sequentialThinking
// On-demand planner for multi-step tasks (uses LLM)
// ═══════════════════════════════════════════════════════════════════════════

const capabilitiesSchema = z.object({
  directTools: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    category: z.string(),
  })),
  delegationAgents: z.array(z.object({
    name: z.string(),
    specialty: z.string(),
    delegateTool: z.string(),
    tools: z.array(z.string()),
  })),
  metaTools: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
  })),
});

// ═══════════════════════════════════════════════════════════════════════════
// SAFETY: Cycle detection for task graphs
// ═══════════════════════════════════════════════════════════════════════════

function hasCycle(nodes: Array<{ id: string }>, edges: Array<{ from: string; to: string }>): boolean {
  const graph = new Map<string, string[]>();
  for (const node of nodes) {
    graph.set(node.id, []);
  }
  for (const edge of edges) {
    const neighbors = graph.get(edge.from) || [];
    neighbors.push(edge.to);
    graph.set(edge.from, neighbors);
  }
  
  const visited = new Set<string>();
  const recStack = new Set<string>();
  
  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    recStack.add(nodeId);
    
    for (const neighbor of graph.get(nodeId) || []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        return true;
      }
    }
    
    recStack.delete(nodeId);
    return false;
  }
  
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return true;
    }
  }
  
  return false;
}

export const sequentialThinking = createTool({
  description: `Given a research goal and capabilities catalog, propose a multi-step plan.

CRITICAL: This tool DOES NOT EXECUTE tools. It ONLY produces a plan.
The Coordinator is responsible for executing the plan.

This is ADVISORY ONLY - you may merge, skip, or reorder steps.

Call ONCE at the start of a clearly complex task.
NEVER call in a loop. MAX 2 retries if needed.`,

  args: z.object({
    goal: z.string().describe("The user's goal or task"),
    capabilities: capabilitiesSchema.describe("Output from discoverCapabilities"),
    maxSteps: z.number().optional().default(8).describe("Max steps in plan (hard limit: 8)"),
  }),

  handler: async (_ctx, args) => {
    // Enforce hard limit
    const maxSteps = Math.min(args.maxSteps || 8, 8);
    
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!geminiKey) {
      return {
        success: false,
        error: "Gemini API key not configured",
        nodes: [],
        edges: [],
        linearPlan: [{
          id: "fallback",
          description: "Proceed with best judgment",
          suggestedTool: "queryMemory",
          reason: "Start with memory lookup",
          preconditions: [],
        }],
      };
    }

    const ai = new GoogleGenAI({ apiKey: geminiKey });

    const prompt = `You are a PLANNING HELPER for a research agent.

CRITICAL RULES:
1. You DO NOT execute any tools. You ONLY produce a plan.
2. Maximum ${maxSteps} nodes in your plan.
3. Maximum 10 edges between nodes.
4. NO CYCLES allowed (A→B→C→A is forbidden).
5. Each node MUST have preconditions (what must be true before this step).

USER GOAL:
${args.goal}

AVAILABLE CAPABILITIES:
${JSON.stringify(args.capabilities, null, 2)}

Return a JSON object with:
- nodes: array of {id, description, suggestedTool, reason, preconditions}
- edges: array of {from, to, condition} for dependencies
- linearPlan: same as nodes but in execution order

Each node needs:
- id: unique string (e.g., "step1", "step2")
- description: clear action
- suggestedTool: tool name or "none"
- reason: why this step matters
- preconditions: array of conditions that must be true (e.g., "memory lookup complete")

PLAN STRUCTURE RULES:
- ALWAYS start with queryMemory to check existing knowledge
- Only call research tools if memory doesn't have what you need
- End with updateMemoryFromReview if you did deep research
- Prefer FEWER tools over more`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        nodes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              description: { type: Type.STRING },
              suggestedTool: { type: Type.STRING },
              reason: { type: Type.STRING },
              preconditions: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["id", "description", "suggestedTool", "reason", "preconditions"],
          },
        },
        edges: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              from: { type: Type.STRING },
              to: { type: Type.STRING },
              condition: { type: Type.STRING },
            },
            required: ["from", "to"],
          },
        },
        linearPlan: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              description: { type: Type.STRING },
              suggestedTool: { type: Type.STRING },
              reason: { type: Type.STRING },
              preconditions: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["id", "description", "suggestedTool", "reason"],
          },
        },
      },
      required: ["nodes", "edges", "linearPlan"],
    } as const;

    try {
      const response = await ai.models.generateContent({
        model: getLlmModel("router", "gemini"),
        contents: createUserContent([{ text: prompt }]),
        config: {
          responseMimeType: "application/json",
          responseSchema,
        },
      });

      const json = JSON.parse(response.text ?? "{}");
      
      // Safety check: Enforce max nodes
      if (json.nodes && json.nodes.length > maxSteps) {
        json.nodes = json.nodes.slice(0, maxSteps);
        json.linearPlan = json.linearPlan?.slice(0, maxSteps);
        console.warn(`[sequentialThinking] Truncated plan to ${maxSteps} nodes`);
      }
      
      // Safety check: Enforce max edges
      if (json.edges && json.edges.length > 10) {
        json.edges = json.edges.slice(0, 10);
        console.warn("[sequentialThinking] Truncated edges to 10");
      }
      
      // Safety check: Detect cycles
      if (json.nodes && json.edges && hasCycle(json.nodes, json.edges)) {
        console.error("[sequentialThinking] CYCLE DETECTED - returning linear plan only");
        return {
          success: false,
          error: "Plan contained cycles - using linear fallback",
          nodes: json.nodes,
          edges: [], // Remove edges that caused cycle
          linearPlan: json.linearPlan || json.nodes,
          hasCycle: true,
        };
      }
      
      return {
        success: true,
        ...json,
        hasCycle: false,
      };
    } catch (err) {
      console.error("[sequentialThinking] Error:", err);
      return {
        success: false,
        error: String(err),
        nodes: [],
        edges: [],
        linearPlan: [{
          id: "fallback",
          description: "Planning failed - use best judgment",
          suggestedTool: "queryMemory",
          reason: "Start with memory lookup, then proceed based on results",
          preconditions: [],
        }],
      };
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL #3: decomposeQuery
// Split multi-entity queries into atomic research units (uses LLM)
// ═══════════════════════════════════════════════════════════════════════════

export const decomposeQuery = createTool({
  description: `Split a complex question into per-entity/theme sub-queries.

Call this when the user asks about MULTIPLE entities (e.g., "Compare Tesla, Nvidia, and AMD").
Returns atomic research units that can be processed independently.`,

  args: z.object({
    query: z.string().describe("The user's multi-entity query"),
  }),

  handler: async (_ctx, args) => {
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!geminiKey) {
      return {
        units: [{
          label: "Full query",
          entityOrTheme: "unknown",
          question: args.query,
        }],
      };
    }

    const ai = new GoogleGenAI({ apiKey: geminiKey });

    const prompt = `Decompose the user's question into atomic research units.

QUESTION:
${args.query}

Return a list of units. Each unit should have:
- label: short name (e.g., "Tesla Analysis")
- entityOrTheme: main company/person/topic for this unit
- question: specific sub-question for that entity

RULES:
- Each unit should be independently researchable
- If comparing entities, create one unit per entity
- Keep the original intent for each sub-question

Return valid JSON only.`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        units: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              entityOrTheme: { type: Type.STRING },
              question: { type: Type.STRING },
            },
            required: ["label", "entityOrTheme", "question"],
          },
        },
      },
      required: ["units"],
    } as const;

    try {
      const response = await ai.models.generateContent({
        model: getLlmModel("router", "gemini"),
        contents: createUserContent([{ text: prompt }]),
        config: {
          responseMimeType: "application/json",
          responseSchema,
        },
      });

      const json = JSON.parse(response.text ?? "{}");
      return json;
    } catch (err) {
      console.error("[decomposeQuery] Error:", err);
      return {
        units: [{
          label: "Full query",
          entityOrTheme: "unknown",
          question: args.query,
        }],
      };
    }
  },
});
