"use node";

/**
 * Agent Project Idea Post Generator
 *
 * Daily cron that reads the morning brief digest, picks the most "buildable"
 * signal, and generates a founder-voice LinkedIn post recommending a concrete
 * AI agent project idea — with specific nodebench-mcp tools/presets woven in.
 *
 * Serves as:
 *   - Onboarding content for newcomers ("I could build that")
 *   - Tool discovery for existing users ("oh, those tools work together")
 *
 * Runs daily at 7:15 AM UTC (after digest generation at 6:00 AM).
 * Posts route through existing content queue → judge → schedule → post pipeline.
 */

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateText } from "ai";
import { getLanguageModelSafe } from "../domains/agents/mcp_tools/models/modelResolver";
import type { AgentDigestOutput } from "../domains/agents/digestAgent";

// ═══════════════════════════════════════════════════════════════════════════
// TOOL RECIPE CATALOG
// ═══════════════════════════════════════════════════════════════════════════

interface ToolRecipe {
  name: string;
  preset: "lite" | "core" | "full";
  presetToolCount: number;
  tools: string[];
  workflow: string;
  bestFor: string[];
}

const TOOL_RECIPE_CATALOG: ToolRecipe[] = [
  {
    name: "Research-First Agent",
    preset: "core",
    presetToolCount: 50,
    tools: ["run_recon", "search_all_knowledge", "log_recon_finding", "record_learning"],
    workflow:
      "run_recon to map the space, search_all_knowledge for prior art, log findings, then record learnings as your agent's memory",
    bestFor: ["research", "arxiv", "paper", "academic", "breakthrough", "study", "survey"],
  },
  {
    name: "Build-and-Verify Agent",
    preset: "core",
    presetToolCount: 50,
    tools: ["start_verification_cycle", "log_test_result", "run_quality_gate", "promote_to_eval"],
    workflow:
      "start a verification cycle for the feature, log each test layer, gate quality, then promote passing tests to eval for regression tracking",
    bestFor: ["tool", "library", "framework", "release", "sdk", "api", "package", "open source"],
  },
  {
    name: "Multi-Agent Team",
    preset: "full",
    presetToolCount: 75,
    tools: ["claim_agent_task", "assign_agent_role", "get_parallel_status", "run_oracle_comparison"],
    workflow:
      "split the project into parallel tasks, assign agent roles (researcher/builder/tester), track status, run oracle comparison to verify quality",
    bestFor: ["complex", "multi", "parallel", "team", "large", "enterprise", "orchestrat"],
  },
  {
    name: "Vision QA Agent",
    preset: "full",
    presetToolCount: 75,
    tools: ["capture_responsive_suite", "analyze_screenshot", "run_quality_gate"],
    workflow:
      "capture UI at all breakpoints, analyze with vision AI, then gate the visual quality before shipping",
    bestFor: ["ui", "visual", "frontend", "design", "interface", "app", "screenshot", "image"],
  },
  {
    name: "Web Intelligence Agent",
    preset: "full",
    presetToolCount: 75,
    tools: ["web_search", "search_github", "run_recon", "record_learning"],
    workflow:
      "web_search to discover current state of the art, search_github for reference implementations, recon to structure findings, record learnings",
    bestFor: ["trend", "market", "industry", "startup", "funding", "competition", "landscape"],
  },
  {
    name: "Eval-Driven Agent",
    preset: "core",
    presetToolCount: 50,
    tools: ["start_eval_run", "record_eval_result", "compare_eval_runs"],
    workflow:
      "define test cases from the problem statement, run eval batch, record results, compare against baseline to know if your solution actually works",
    bestFor: ["benchmark", "performance", "accuracy", "model", "llm", "prompt", "eval", "test"],
  },
  {
    name: "Bootstrap-and-Ship Agent",
    preset: "core",
    presetToolCount: 50,
    tools: ["bootstrap_project", "discover_infrastructure", "triple_verify", "self_implement"],
    workflow:
      "bootstrap the project structure, discover existing infra, triple verify the integration points, then self_implement the core logic",
    bestFor: ["new", "greenfield", "prototype", "mvp", "quick", "demo", "starter", "boilerplate"],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL SELECTION
// ═══════════════════════════════════════════════════════════════════════════

interface SelectedSignal {
  signalText: string;
  matchedRecipe: ToolRecipe;
  signalSource: string;
}

function scoreRecipeMatch(text: string, recipe: ToolRecipe): number {
  const lower = text.toLowerCase();
  return recipe.bestFor.filter((tag) => lower.includes(tag)).length;
}

function selectBuildableSignal(digest: AgentDigestOutput): SelectedSignal {
  // Build candidates with scores
  const candidates: Array<{
    text: string;
    source: string;
    score: number;
    recipe: ToolRecipe;
  }> = [];

  // Priority 1: Technology/product entities (most buildable)
  for (const entity of (digest.entitySpotlight ?? []).filter(
    (e) => e.type === "technology" || e.type === "product",
  )) {
    const text = [
      `Technology: ${entity.name}`,
      `Key insight: ${entity.keyInsight}`,
      entity.keyFacts ? `Facts: ${entity.keyFacts.join("; ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    for (const recipe of TOOL_RECIPE_CATALOG) {
      const tagScore = scoreRecipeMatch(text, recipe);
      // Entities get +2 bonus for being concrete and buildable
      candidates.push({ text, source: `entity:${entity.name}`, score: tagScore + 2, recipe });
    }
  }

  // Priority 2: Signals with hard numbers (concrete, measurable)
  for (const signal of digest.signals.filter((s) => s.hardNumbers)) {
    const text = [
      `Signal: ${signal.title}`,
      `Summary: ${signal.summary}`,
      `Numbers: ${signal.hardNumbers}`,
      signal.reflection ? `So what: ${signal.reflection.soWhat}` : null,
      signal.reflection ? `Now what: ${signal.reflection.nowWhat}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    for (const recipe of TOOL_RECIPE_CATALOG) {
      const tagScore = scoreRecipeMatch(text, recipe);
      // Hard numbers get +1 bonus
      candidates.push({ text, source: `signal:${signal.title}`, score: tagScore + 1, recipe });
    }
  }

  // Priority 3: Lead story with actionable reflection
  if (digest.leadStory?.reflection?.nowWhat) {
    const text = [
      `Lead story: ${digest.leadStory.title}`,
      `Why it matters: ${digest.leadStory.whyItMatters}`,
      `What: ${digest.leadStory.reflection.what}`,
      `So what: ${digest.leadStory.reflection.soWhat}`,
      `Now what: ${digest.leadStory.reflection.nowWhat}`,
    ].join("\n");

    for (const recipe of TOOL_RECIPE_CATALOG) {
      const tagScore = scoreRecipeMatch(text, recipe);
      candidates.push({ text, source: `lead:${digest.leadStory.title}`, score: tagScore, recipe });
    }
  }

  // Priority 4: Any remaining signals
  for (const signal of digest.signals.filter((s) => !s.hardNumbers)) {
    const text = [
      `Signal: ${signal.title}`,
      `Summary: ${signal.summary}`,
      signal.reflection ? `So what: ${signal.reflection.soWhat}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    for (const recipe of TOOL_RECIPE_CATALOG) {
      const tagScore = scoreRecipeMatch(text, recipe);
      candidates.push({ text, source: `signal:${signal.title}`, score: tagScore, recipe });
    }
  }

  // Sort by score descending, pick best
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 0 && candidates[0].score > 0) {
    return {
      signalText: candidates[0].text,
      matchedRecipe: candidates[0].recipe,
      signalSource: candidates[0].source,
    };
  }

  // Fallback: narrative thesis + first signal → Research-First recipe
  const fallbackText = [
    `Thesis: ${digest.narrativeThesis}`,
    digest.signals.length > 0 ? `Top signal: ${digest.signals[0].title}` : null,
    digest.signals.length > 0 ? `Summary: ${digest.signals[0].summary}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    signalText: fallbackText,
    matchedRecipe: TOOL_RECIPE_CATALOG[0], // Research-First Agent
    signalSource: "fallback:thesis",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════

const AGENT_PROJECT_IDEA_SYSTEM = `You are writing a LinkedIn post for a technical founder's professional profile. The post recommends a concrete AI agent project idea that someone could start building this weekend.

TONE:
- Professional but approachable. Proper capitalization and grammar.
- Write as a founder sharing a practical idea with peers, not lecturing.
- First person: "We noticed...", "I'd start by...", "Here's what I'd build..."
- Confident and direct. No hedging or corporate jargon.

STRUCTURE (follow this order):
1. Open with the real-world signal or trend (1-2 sentences with a specific number or fact)
2. State the project idea clearly in one sentence: "Here's a weekend project idea: [concrete thing]"
3. Walk through the execution steps — what you'd build, in what order, and why each step matters
4. Mention 2-3 specific tool names as part of the steps (e.g. "Start by running structured recon with run_recon to map the space, then use start_verification_cycle to track each integration point")
5. Close with a genuine question inviting others to share what they'd build

FORMAT RULES:
- 800-1200 characters max
- No hashtags, no emoji
- No arrow bullets or numbered lists with bold headers
- Tool names should appear naturally inside the execution steps, not as a separate list
- Do NOT emphasize preset names or tool counts — focus entirely on the project and what it produces
- Do NOT open with a dramatic one-liner followed by a line break
- NEVER use: "leverage", "paradigm", "synergy", "at scale", "game-changer", "disrupt"

GOAL:
- A newcomer reads this and thinks "I know exactly what to build and how to start"
- An existing user reads this and thinks "That's a clever way to combine those tools"
- The project idea should be achievable in a weekend, not a 6-month enterprise effort`;

// ═══════════════════════════════════════════════════════════════════════════
// POST VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateAndCleanPost(text: string): string {
  let cleaned = text.trim();

  // Strip any hashtags the LLM might have added
  cleaned = cleaned.replace(/#\w+/g, "").trim();

  // Strip emoji (broad Unicode ranges)
  cleaned = cleaned
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .trim();

  // Collapse multiple spaces/newlines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ");

  // Enforce max length: truncate at last sentence before 1200
  if (cleaned.length > 1200) {
    const sentences = cleaned.split(/(?<=[.!?])\s+/);
    let result = "";
    for (const s of sentences) {
      if ((result + " " + s).trim().length <= 1200) {
        result = (result + " " + s).trim();
      } else break;
    }
    cleaned = result;
  }

  return cleaned;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a daily "AI Agent Project Idea" post from today's intelligence.
 * Picks the most buildable signal, matches a nodebench-mcp tool recipe,
 * and generates a founder-voice post recommending a weekend project.
 */
export const generateAgentProjectIdeaPost = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    hoursBack: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const hoursBack = args.hoursBack ?? 24;
    const dateString = new Date().toISOString().split("T")[0];

    console.log(
      `[agentProjectIdea] Generating for ${dateString} (dryRun=${dryRun}, hoursBack=${hoursBack})`,
    );

    // 1. Idempotency check — skip if already generated for today
    const alreadyGenerated = await ctx.runQuery(
      internal.domains.social.linkedinContentQueue.hasPostTypeForDate,
      { postType: "agent_project_idea", dateString },
    );

    if (alreadyGenerated) {
      console.log(`[agentProjectIdea] Already generated for ${dateString}, skipping`);
      return {
        success: true,
        skipped: true,
        reason: "already_generated_today",
        content: null,
      };
    }

    // 2. Pull today's digest (uses cache internally)
    const digestResult = await ctx.runAction(
      internal.domains.agents.digestAgent.generateDigestWithFactChecks,
      { persona: "GENERAL", model: "qwen3-coder-free", hoursBack },
    );

    if (!digestResult.success || !digestResult.digest) {
      console.log(`[agentProjectIdea] No digest available: ${digestResult.error}`);
      return {
        success: false,
        error: digestResult.error || "No digest available",
        content: null,
      };
    }

    const digest = digestResult.digest as AgentDigestOutput;

    // 3. Select the most buildable signal + matching recipe
    const { signalText, matchedRecipe, signalSource } = selectBuildableSignal(digest);

    console.log(
      `[agentProjectIdea] Selected signal: ${signalSource} → recipe: ${matchedRecipe.name} (${matchedRecipe.preset})`,
    );

    // 4. Build user prompt
    const userPrompt = `Write a professional LinkedIn post recommending a concrete AI agent project idea inspired by today's intelligence.

TODAY'S SIGNAL:
${signalText}

TOOL WORKFLOW FOR THIS PROJECT:
Tools to weave into the steps: ${matchedRecipe.tools.join(", ")}
How they fit together: ${matchedRecipe.workflow}

REQUIREMENTS:
- Open with the signal (include at least one specific number from the data)
- State the project idea in one clear sentence
- Walk through 3-4 execution steps explaining what to build and in what order
- Mention 2-3 tool names naturally as part of the execution steps
- Do NOT list presets, tool counts, or installation commands
- The idea should be specific enough that a newcomer could start building today
- End with a genuine question about what others would build
- Keep it under 1200 characters`;

    // 5. Generate with free model
    const modelId = "qwen3-coder-free";
    const model = getLanguageModelSafe(modelId);

    const { text } = await generateText({
      model,
      system: AGENT_PROJECT_IDEA_SYSTEM,
      prompt: userPrompt,
      maxOutputTokens: 500,
      temperature: 0.8,
    });

    const content = validateAndCleanPost(text);
    console.log(`[agentProjectIdea] Generated ${content.length} chars`);

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        content,
        signalSource,
        matchedRecipe: matchedRecipe.name,
        preset: matchedRecipe.preset,
        charCount: content.length,
      };
    }

    // 6. Enqueue to content pipeline
    const result = await ctx.runMutation(
      internal.domains.social.linkedinContentQueue.enqueueContent,
      {
        content,
        postType: "agent_project_idea",
        persona: "FOUNDER",
        target: "personal" as const,
        source: "fresh" as const,
        metadata: {
          generatedBy: "agentProjectIdeaPost",
          digestDate: dateString,
          matchedRecipe: matchedRecipe.name,
          signalSource,
        },
      },
    );

    if ("queued" in result && result.queued) {
      console.log(`[agentProjectIdea] Enqueued: ${result.queueId}`);
      return {
        success: true,
        content,
        queueId: result.queueId,
        signalSource,
        matchedRecipe: matchedRecipe.name,
        charCount: content.length,
      };
    }

    console.log(
      `[agentProjectIdea] Dedup blocked: ${"reason" in result ? result.reason : "unknown"}`,
    );
    return {
      success: false,
      error: "reason" in result ? result.reason : "duplicate_content",
      content,
    };
  },
});
