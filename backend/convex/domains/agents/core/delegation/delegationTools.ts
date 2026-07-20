/**
 * Delegation Tools
 *
 * Tools that enable the coordinator agent to delegate tasks to specialized subagents.
 */

import { Agent, createTool, stepCountIs } from "@convex-dev/agent";
import type { Tool } from "ai";
import { z } from "zod";

import type { DelegationCtx } from "./delegationHelpers";
import {
  ensureThread as ensureThreadHelper,
  pickUserId as pickUserIdHelper,
  formatDelegationResult as formatResult,
} from "./delegationHelpers";
import { buildPromptWithTemporalContext } from "./temporalContext";

// Import subagent creators
import { createDocumentAgent } from "../subagents/document_subagent/documentAgent";
import { createMediaAgent } from "../subagents/media_subagent/mediaAgent";
import { createSECAgent } from "../subagents/sec_subagent/secAgent";
import { createOpenBBAgent } from "../subagents/openbb_subagent/openbbAgent";
import { createEntityResearchAgent } from "../subagents/entity_subagent/entityResearchAgent";
import { createDossierAgent } from "../subagents/dossier_subagent/dossierAgent";
import { getLlmModel } from "../../../../../shared/llm/modelCatalog";

type DelegationTool = Tool<any, any>;

/**
 * Build delegation tools for a specific language model.
 */
export function buildDelegationTools(model: string): Record<string, DelegationTool> {
  const documentAgent = createDocumentAgent(model);
  const mediaAgent = createMediaAgent(model);
  const secAgent: Agent = createSECAgent(model);
  const openbbAgent = createOpenBBAgent(model);
  const dossierAgent = createDossierAgent(model);
  const entityResearchAgent = createEntityResearchAgent(model);

  const enforceSafety = (ctx: DelegationCtx): number => {
    const currentDepth = ctx.depth ?? 0;
    if (currentDepth >= 3) {
      throw new Error("Maximum delegation depth (3) exceeded. Cannot delegate further.");
    }
    return currentDepth + 1;
  };

  const runWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number = 60000): Promise<T> => {
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("Delegation timed out after 60s")), timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutHandle!);
      return result;
    } catch (error) {
      clearTimeout(timeoutHandle!);
      throw error;
    }
  };

  const premiumEvidenceRequirements = `\n\nQuality bar (premium output):\n- State an explicit date (YYYY-MM-DD) and timezone for every finding.\n- Put the primary source URL right next to the finding (EDGAR link, article URL, etc.).\n- Add a short verification note per finding: which tool/source you used and the UTC retrieval time.\n- Drop or clearly flag anything outside the requested timeframe.`;

  const requiredToolUse = `\n\nTool-use requirement:\n- You MUST call at least one of your domain tools before answering.\n- Do not answer from prior knowledge or guess URLs/IDs.\n- If a required input (e.g., ticker/documentId) is missing, use a lookup/search tool to obtain it, then proceed.\n- When you retrieve data (documents, filings, web pages), include 1-3 short verbatim quotes/excerpts from the tool output as evidence.\n- If a tool returns an HTML comment marker block (e.g., <!-- YOUTUBE_GALLERY_DATA ... -->, <!-- SEC_GALLERY_DATA ... -->, <!-- SOURCE_GALLERY_DATA ... -->, <!-- IMAGE_DATA ... -->), include that block verbatim in your final response so the UI can render galleries.`;

  const runSubagentStream = async (
    agent: Agent,
    ctx: DelegationCtx,
    threadId: string,
    prompt: string,
    maxSteps: number
  ) => {
    const userId = pickUserIdHelper(ctx);
    const stream = await runWithTimeout(agent.streamText(
      ctx as any,
      { threadId, userId },
      {
        prompt,
        stopWhen: stepCountIs(maxSteps),
        onError: ({ error }) => {
          console.error("[delegationTools] Subagent stream error:", (error as any)?.message ?? error);
        },
      }
    ));

    await stream.consumeStream();

    let text = (await stream.text) ?? "";
    const toolsUsed = new Set<string>();
    const stepToolResults: any[] = [];

    const steps = await stream.steps;
    if (Array.isArray(steps)) {
      for (const step of steps as any[]) {
        const calls = step?.toolCalls;
        if (!Array.isArray(calls)) continue;
        for (const call of calls) {
          const name = call?.toolName;
          if (typeof name === "string") toolsUsed.add(name);
        }

        const candidateToolResults =
          (step as any).toolResults ??
          (step as any).toolResult ??
          (step as any).tool_outputs ??
          (step as any).toolOutput ??
          null;
        if (Array.isArray(candidateToolResults)) {
          stepToolResults.push(...candidateToolResults);
        } else if (candidateToolResults && typeof candidateToolResults === "object") {
          stepToolResults.push(candidateToolResults);
        }
      }
    }

    const topLevelToolCalls = await stream.toolCalls;
    if (Array.isArray(topLevelToolCalls)) {
      for (const call of topLevelToolCalls as any[]) {
        const name = call?.toolName;
        if (typeof name === "string") toolsUsed.add(name);
      }
    }

    // Preserve UI gallery markers from tool outputs even if the model rewrites the response.
    // This ensures the frontend can render galleries (YouTube/SEC/sources/images/etc).
    try {
      const directToolResults = (await stream.toolResults) ?? [];
      const allToolResults = directToolResults.length > 0
        ? (stepToolResults.length > 0 ? [...directToolResults, ...stepToolResults] : directToolResults)
        : stepToolResults;

      const markerRegex = /<!--\\s*(YOUTUBE_GALLERY_DATA|SEC_GALLERY_DATA|SOURCE_GALLERY_DATA|PROFILE_GALLERY_DATA|IMAGE_DATA|VIDEO_DATA|AUDIO_DATA)\\s*[\\s\\S]*?-->/g;
      const extracted = new Set<string>();

      for (const tr of allToolResults as any[]) {
        const output = tr?.result ?? tr?.output ?? tr;
        const raw = typeof output === "string" ? output : "";
        if (!raw) continue;
        const matches = raw.match(markerRegex) ?? [];
        for (const m of matches) extracted.add(m);
      }

      const markerBlocks = Array.from(extracted);
      if (markerBlocks.length > 0) {
        const missing = markerBlocks.filter(m => !text.includes(m));
        if (missing.length > 0) {
          text = `${text}\n\n${missing.join("\n\n")}\n`;
        }
      }
    } catch (err) {
      console.warn("[delegationTools] Failed to preserve UI marker blocks from tool results", err);
    }

    return {
      messageId: (stream as any)?.messageId ?? "",
      text,
      toolsUsed: Array.from(toolsUsed),
    };
  };

  const buildDelegationPrompt = (query: string, inheritedContext?: DelegationCtx["temporalContext"]) => {
    const promptWithContext = buildPromptWithTemporalContext(query);

    if (!promptWithContext.temporalContext && inheritedContext) {
      const prompt = `${query}\n\nTimeframe: ${inheritedContext.label} (from ${inheritedContext.startDate} to ${inheritedContext.endDate}).` +
        " Apply date filters in your tools to stay within this range and prioritize the most recent results.";

      return { prompt: `${prompt}${premiumEvidenceRequirements}${requiredToolUse}`, temporalContext: inheritedContext };
    }

    return { ...promptWithContext, prompt: `${promptWithContext.prompt}${premiumEvidenceRequirements}${requiredToolUse}` };
  };

  const delegateToDocumentAgent: DelegationTool = createTool({
    description: `Delegate document-related tasks to the DocumentAgent specialist.

Use this tool when the user asks to:
- Find, search, or look up documents
- Read or view document content
- Create or edit documents
- Analyze or compare multiple documents
- Search by hashtag
- Search uploaded files

The DocumentAgent has specialized tools for document management and will return a comprehensive answer.`,

    args: z.object({
      query: z.string().describe("The user's question or task for the DocumentAgent"),
      analysisType: z.enum(["search", "read", "create", "edit", "analyze", "compare", "hashtag"]).optional()
        .describe("Type of document operation"),
      threadId: z.string().optional().describe("Optional thread ID to continue previous conversation"),
    }),

    handler: async (ctx: DelegationCtx, args) => {
      const nextDepth = enforceSafety(ctx);
      const threadId = await ensureThreadHelper(documentAgent, ctx, args.threadId);
      const { prompt, temporalContext } = buildDelegationPrompt(args.query, ctx.temporalContext);

      const isRead =
        args.analysisType === "read" ||
        /(?:\bshow\b|\bread\b|\bopen\b|\bdisplay\b|\bview\b|content)/i.test(args.query);

      const effectivePrompt = isRead
        ? [
          "READ MODE: You must retrieve the document content.",
          "Step 1: Call findDocument to locate the best matching document.",
          "Step 2: Call getDocumentContent on the selected documentId.",
          "Then respond with an evidence-backed excerpt copied verbatim from the retrieved content.",
          "",
          prompt,
        ].join("\n")
        : prompt;

      const result = await runSubagentStream(
        documentAgent,
        { ...ctx, depth: nextDepth, temporalContext } as any,
        threadId,
        effectivePrompt,
        8
      );

      return formatResult(
        "DocumentAgent",
        threadId,
        result.messageId || "",
        result.text,
        result.toolsUsed
      );
    },
  });

  const delegateToMediaAgent: DelegationTool = createTool({
    description: `Delegate media discovery tasks to the MediaAgent specialist.

Use this tool when the user asks to:
- Find YouTube videos
- Search for images
- Search the web for content
- Discover media files
- Analyze uploaded media

The MediaAgent has specialized tools for media discovery and will return relevant results with URLs.`,

    args: z.object({
      query: z.string().describe("The user's question or task for the MediaAgent"),
      mediaType: z.enum(["video", "image", "web", "media"]).optional()
        .describe("Type of media to search for"),
      threadId: z.string().optional().describe("Optional thread ID to continue previous conversation"),
    }),

    handler: async (ctx: DelegationCtx, args) => {
      const nextDepth = enforceSafety(ctx);
      const threadId = await ensureThreadHelper(mediaAgent, ctx, args.threadId);
      const { prompt, temporalContext } = buildDelegationPrompt(args.query, ctx.temporalContext);

      const isImageSearch = args.mediaType === "image" || /\bimage(s)?\b/i.test(args.query);
      const isVideoSearch = args.mediaType === "video" || /\bvideo(s)?\b|\byoutube\b/i.test(args.query);

      const effectivePrompt = isVideoSearch
        ? [
          "VIDEO SEARCH MODE:",
          "- Use youtubeSearch first.",
          "- Preserve any <!-- YOUTUBE_GALLERY_DATA ... --> block from tool output verbatim in your final response.",
          "- In your response, include a short 'Evidence' section quoting 1-2 lines from the youtubeSearch output (titles/urls).",
          "",
          prompt,
        ].join("\n")
        : isImageSearch
          ? [
            "IMAGE SEARCH MODE:",
            "- Explicitly state the search query you used in the response (e.g., 'Search query: architecture').",
            "- Step 1: Call searchMedia with mediaType='image'.",
            "- Step 2 (optional): If results are empty/insufficient, call linkupSearch with includeImages=true.",
            "- Preserve any <!-- SOURCE_GALLERY_DATA ... --> or <!-- IMAGE_DATA ... --> blocks from tool output verbatim.",
            "- Include at least 3 concrete image URLs (either as links or via the gallery blocks).",
            "",
            prompt,
          ].join("\n")
          : prompt;

      const result = await runSubagentStream(
        mediaAgent,
        { ...ctx, depth: nextDepth, temporalContext } as any,
        threadId,
        effectivePrompt,
        6
      );

      return formatResult(
        "MediaAgent",
        threadId,
        result.messageId || "",
        result.text,
        result.toolsUsed
      );
    },
  });

  const delegateToSECAgent: DelegationTool = createTool({
    description: `Delegate SEC filing and company research tasks to the SECAgent specialist.

Use this tool when the user asks to:
- Find SEC filings (10-K, 10-Q, 8-K, S-1, etc.)
- Look up company information
- Research regulatory filings
- Analyze financial documents
- Find company CIK or ticker

The SECAgent has specialized tools for SEC EDGAR database access and will return filing details with URLs.`,

    args: z.object({
      query: z.string().describe("The user's question or task for the SECAgent"),
      filingType: z.string().optional().describe("Specific filing type if known (e.g., '10-K', '10-Q')"),
      threadId: z.string().optional().describe("Optional thread ID to continue previous conversation"),
    }),

    handler: async (ctx: DelegationCtx, args) => {
      const nextDepth = enforceSafety(ctx);
      const threadId = await ensureThreadHelper(secAgent, ctx, args.threadId);
      const { prompt, temporalContext } = buildDelegationPrompt(args.query, ctx.temporalContext);

      const isSecQuery = /\bsec\b|\bedgar\b|\bfiling\b|\b10-k\b|\b10-q\b|\b8-k\b|\bproxy\b|\bdef 14a\b/i.test(args.query);
      const effectivePrompt = isSecQuery
        ? [
          "SEC MODE:",
          "- Step 1: If the ticker is not explicitly provided, call searchSecCompanies to find the best match and ticker.",
          "- Step 2: Call searchSecFilings with the correct ticker.",
          "- Explicitly state the exact ticker you passed to searchSecFilings in your response (e.g., 'searchSecFilings ticker: AAPL').",
          "- Preserve any <!-- SEC_GALLERY_DATA ... --> block from tool output verbatim in your final response.",
          "",
          prompt,
        ].join("\n")
        : prompt;

      const result = await runSubagentStream(
        secAgent,
        { ...ctx, depth: nextDepth, temporalContext } as any,
        threadId,
        effectivePrompt,
        6
      );

      return formatResult(
        "SECAgent",
        threadId,
        result.messageId || "",
        result.text,
        result.toolsUsed
      );
    },
  });

  const delegateToOpenBBAgent: DelegationTool = createTool({
    description: `Delegate financial data and market research tasks to the OpenBBAgent specialist.

Use this tool when the user asks to:
- Get stock prices or fundamentals
- Research cryptocurrency data
- Find economic indicators (GDP, employment, inflation)
- Get financial news
- Compare stocks or analyze markets

The OpenBBAgent has specialized tools for financial data via OpenBB Platform and will return market data with analysis.`,

    args: z.object({
      query: z.string().describe("The user's question or task for the OpenBBAgent"),
      dataCategory: z.enum(["equity", "crypto", "economy", "news", "general"]).optional()
        .describe("Category of financial data"),
      threadId: z.string().optional().describe("Optional thread ID to continue previous conversation"),
    }),

    handler: async (ctx: DelegationCtx, args) => {
      const nextDepth = enforceSafety(ctx);
      const threadId = await ensureThreadHelper(openbbAgent, ctx, args.threadId);
      const { prompt, temporalContext } = buildDelegationPrompt(args.query, ctx.temporalContext);

      const result = await runSubagentStream(
        openbbAgent,
        { ...ctx, depth: nextDepth, temporalContext } as any,
        threadId,
        prompt,
        8
      );

      return formatResult(
        "OpenBBAgent",
        threadId,
        result.messageId || "",
        result.text,
        result.toolsUsed
      );
    },
  });

  const delegateToEntityResearchAgent: DelegationTool = createTool({
    description: `Delegate deep research tasks to the EntityResearchAgent specialist.

Use this tool when the user asks to:
- Research a specific company (funding, founders, thesis)
- Research a specific person (background, education)
- Research a topic or hashtag deeply
- Get "banker-quality" analysis

The EntityResearchAgent has specialized tools for deep enrichment and will return a comprehensive dossier.`,

    args: z.object({
      query: z.string().describe("The user's question or task for the EntityResearchAgent"),
      entityType: z.enum(["company", "person", "topic", "general"]).optional()
        .describe("Type of entity to research"),
      threadId: z.string().optional().describe("Optional thread ID to continue previous conversation"),
    }),

    handler: async (ctx: DelegationCtx, args) => {
      const nextDepth = enforceSafety(ctx);
      const threadId = await ensureThreadHelper(entityResearchAgent, ctx, args.threadId);
      const { prompt, temporalContext } = buildDelegationPrompt(args.query, ctx.temporalContext);

      const result = await runSubagentStream(
        entityResearchAgent,
        { ...ctx, depth: nextDepth, temporalContext } as any,
        threadId,
        prompt,
        10
      );

      return formatResult(
        "EntityResearchAgent",
        threadId,
        result.messageId || "",
        result.text,
        result.toolsUsed
      );
    },
  });

  const delegateToDossierAgent: DelegationTool = createTool({
    description: `Delegate dossier interaction tasks to the DossierAgent specialist.

Use this tool when the user is viewing a Morning Dossier and asks to:
- Highlight or focus on a specific data point
- Annotate a chart point with a label
- Get more context about "this point" or "this spike"
- Explain what happened at a specific data point
- Update or expand a narrative section

The DossierAgent has specialized tools for bidirectional focus sync between the chat panel and the dossier view.`,

    args: z.object({
      query: z.string().describe("The user's question or task for the DossierAgent"),
      briefId: z.string().describe("The brief/memory ID being viewed"),
      dataIndex: z.number().optional().describe("Specific data point index if known"),
      currentAct: z.enum(["actI", "actII", "actIII"]).optional().describe("Current act being viewed"),
      threadId: z.string().optional().describe("Optional thread ID to continue previous conversation"),
    }),

    handler: async (ctx: DelegationCtx, args) => {
      const nextDepth = enforceSafety(ctx);
      const threadId = await ensureThreadHelper(dossierAgent, ctx, args.threadId);

      let prompt = args.query;
      if (args.briefId) {
        prompt = `[Dossier Context: briefId=${args.briefId}`;
        if (args.dataIndex !== undefined) prompt += `, dataIndex=${args.dataIndex}`;
        if (args.currentAct) prompt += `, act=${args.currentAct}`;
        prompt += `]\n\n${args.query}`;
      }

      const result = await runSubagentStream(
        dossierAgent,
        { ...ctx, depth: nextDepth, userId: pickUserIdHelper(ctx) } as any,
        threadId,
        `${prompt}${premiumEvidenceRequirements}${requiredToolUse}`,
        6
      );

      return formatResult(
        "DossierAgent",
        threadId,
        result.messageId || "",
        result.text,
        result.toolsUsed
      );
    },
  });

  const parallelDelegate: DelegationTool = createTool({
    description: `Delegate to multiple agents simultaneously using scheduler-based execution.

Use this when:
- You need to compare two different things (e.g. "Compare Tesla and Rivian")
- You need information from different domains at once (e.g. "Get Apple stock price and recent news")
- The tasks are independent of each other

Returns immediately with delegation tracking info. Results stream via agentWriteEvents.`,

    args: z.object({
      tasks: z.array(z.object({
        agentName: z.enum(["DocumentAgent", "MediaAgent", "SECAgent", "OpenBBAgent", "EntityResearchAgent", "DossierAgent"]),
        query: z.string(),
      })).describe("List of tasks to delegate (max 5 for cost control)"),
    }),

    handler: async (ctx: DelegationCtx, args) => {
      const MAX_PARALLEL = 5;
      if (args.tasks.length > MAX_PARALLEL) {
        return JSON.stringify({
          status: "error",
          error: `Too many parallel tasks. Maximum is ${MAX_PARALLEL}, got ${args.tasks.length}.`,
        });
      }

      enforceSafety(ctx);

      const userId = pickUserIdHelper(ctx);
      const runId = ctx.threadId ?? crypto.randomUUID();

      const tasks = args.tasks.map(task => ({
        delegationId: crypto.randomUUID(),
        agentName: task.agentName,
        query: task.query,
      }));

      const { internal } = await import("../../../../_generated/api");

      await (ctx as any).scheduler.runAfter(0, internal.actions.parallelDelegation.scheduleDelegations, {
        runId,
        userId,
        model: getLlmModel("agent", "openai"),
        tasks,
      });

      return JSON.stringify({
        status: "delegations_scheduled",
        runId,
        delegationIds: tasks.map(t => t.delegationId),
        agentCount: tasks.length,
        agents: tasks.map(t => t.agentName),
        message: `Scheduled ${tasks.length} parallel agents. Track via agentDelegations.listByRun({ runId: "${runId}" })`,
        uiHint: "Subscribe to agentWriteEvents for live streaming text from each agent.",
      }, null, 2);
    }
  });

  return {
    delegateToDocumentAgent,
    delegateToMediaAgent,
    delegateToSECAgent,
    delegateToOpenBBAgent,
    delegateToEntityResearchAgent,
    delegateToDossierAgent,
    parallelDelegate,
  };
}
