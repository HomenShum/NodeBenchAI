/**
 * Agent Invoker — Bridges the eval harness to real LLM agent execution.
 *
 * Supports multiple invocation backends:
 * - "stub": Returns empty scorecard (for CI gate / smoke tests)
 * - "anthropic": Uses Anthropic Messages API with tool_use for MCP modes
 * - "openai": Uses OpenAI Chat Completions with function calling
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY — required for anthropic backend
 *   OPENAI_API_KEY   — required for openai backend
 *   EVAL_BACKEND     — "stub" | "anthropic" | "openai" (default: "stub")
 *   EVAL_MODEL       — model override (default: per-backend)
 */

import { createHash } from "node:crypto";
import type { RunConfig, RunTelemetry, Scorecard, ToolCallRecord, ToolRequestRecord, EvalTask } from "./types.js";

export type InvokerBackend = "stub" | "anthropic" | "openai";

interface InvokerOptions {
  backend: InvokerBackend;
  apiKey?: string;
  model?: string;
  verbose?: boolean;
  /** Transport for the Anthropic backend; tests pass a fake, runs use global fetch. */
  fetchImpl?: typeof fetch;
}

/** BOUND_READ: a Messages response larger than this is treated as a failed run. */
const MAX_RESPONSE_CHARS = 4_000_000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function getDefaultModel(backend: InvokerBackend): string {
  switch (backend) {
    case "anthropic": return "claude-sonnet-4-6";
    case "openai": return "gpt-4o";
    case "stub": return "stub-model";
  }
}

function detectBackend(): InvokerOptions {
  const backend = (process.env.EVAL_BACKEND || "stub") as InvokerBackend;
  const apiKey = backend === "anthropic"
    ? process.env.ANTHROPIC_API_KEY
    : backend === "openai"
    ? process.env.OPENAI_API_KEY
    : undefined;

  return {
    backend,
    apiKey,
    model: process.env.EVAL_MODEL || getDefaultModel(backend),
    verbose: process.env.EVAL_VERBOSE === "true",
  };
}

// ── Stub Backend ────────────────────────────────────────────────────

function createStubScorecard(): Scorecard {
  return {
    correctness: { taskSuccessRate: 0, regressionRate: 0 },
    safety: { highRiskActionsGated: 1, issuesCaughtPreMerge: 0 },
    efficiency: { wallClockMs: 0, toolCallCount: 0, tokenCount: 0, retryThrashRate: 0 },
    compounding: { knowledgeReuseRate: 0, evalCasesBanked: 0 },
  };
}

async function invokeStub(config: RunConfig, _task: EvalTask): Promise<RunTelemetry> {
  const now = new Date().toISOString();
  return {
    runId: `stub_${config.taskId}_${config.agentMode}_s${config.seed}_${Date.now()}`,
    config,
    startedAt: now,
    completedAt: now,
    scorecard: createStubScorecard(),
    toolCalls: [],
    verificationCycles: [],
    outputHash: "stub",
    error: "STUB: No real agent invocation — set EVAL_BACKEND=anthropic|openai",
  };
}

// ── Anthropic Backend ───────────────────────────────────────────────

interface AnthropicBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

/**
 * The Messages API body for one run. The model is whatever the caller names
 * (EVAL_MODEL) so a receipt can name its candidate; no sampling parameters
 * (Claude 4.7+/5.x answer 400 to them); no prefill; `tool_choice` is `auto`
 * (Sonnet/Opus 5.5 reject forced tool choice).
 */
export function buildAnthropicRequest(
  config: RunConfig,
  task: EvalTask,
  model: string,
): Record<string, unknown> {
  const tools = config.agentMode !== "bare" ? buildMcpToolDefs(config) : [];
  return {
    model,
    max_tokens: 8192,
    system: buildSystemPrompt(config, task),
    messages: [{ role: "user", content: task.description }],
    ...(tools.length > 0
      ? {
          tools: tools.map((t) => ({ ...t, input_schema: { type: "object", properties: {} } })),
          tool_choice: { type: "auto" },
        }
      : {}),
  };
}

async function invokeAnthropic(
  config: RunConfig,
  task: EvalTask,
  options: InvokerOptions
): Promise<RunTelemetry> {
  if (!options.apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for anthropic backend");
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  // No tool runs in this harness and no result is sent back, so tool_use blocks are
  // only requests: they are recorded apart from `toolCalls` and earn no score.
  const toolCalls: ToolCallRecord[] = [];
  const requestedTools: ToolRequestRecord[] = [];
  let error: string | undefined;
  let outputHash = "";
  let tokenCount = 0;
  let echoedModel: string | undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeout);
  try {
    const response = await (options.fetchImpl ?? fetch)("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": options.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(buildAnthropicRequest(config, task, options.model ?? config.model)),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      error = `Anthropic HTTP ${response.status}: ${raw.slice(0, 240)}`;
    } else if (raw.length > MAX_RESPONSE_CHARS) {
      error = `Anthropic response exceeded ${MAX_RESPONSE_CHARS} chars`;
    } else {
      const data = JSON.parse(raw) as {
        model?: string;
        stop_reason?: string;
        content?: AnthropicBlock[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      // Read blocks by type: content[0] is a thinking block when adaptive thinking is on.
      const blocks = Array.isArray(data.content) ? data.content : [];
      const text = blocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
      for (const block of blocks) {
        if (block.type !== "tool_use" || !block.name) continue;
        requestedTools.push({
          toolName: block.name,
          inputHash: sha256(JSON.stringify(block.input ?? null)),
        });
      }
      outputHash = sha256(text);
      tokenCount = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
      // The model string the provider returned, not the one requested (SPEC-v9 A.0.3).
      echoedModel = data.model;
      const problems: string[] = [];
      if (data.stop_reason === "refusal") problems.push("Anthropic stop_reason: refusal");
      if (data.stop_reason === "tool_use") {
        problems.push(`Anthropic stop_reason: tool_use; ${requestedTools.length} tool(s) requested, none executed (unfinished turn)`);
      }
      if (!echoedModel) problems.push("Anthropic response carries no model string, so the run has no identity evidence");
      if (problems.length > 0) error = problems.join("; ");
    }
  } catch (err) {
    error = err instanceof Error ? (err.name === "AbortError" ? "request timeout" : err.message) : String(err);
  } finally {
    clearTimeout(timer);
  }

  const wallClockMs = Date.now() - startMs;
  const completedAt = new Date().toISOString();

  // Score based on acceptance criteria
  const scorecard: Scorecard = {
    correctness: { taskSuccessRate: 0, regressionRate: 0 },
    safety: {
      highRiskActionsGated: task.riskTier === "low" ? 1 : 0,
      issuesCaughtPreMerge: 0,
    },
    efficiency: {
      wallClockMs,
      toolCallCount: toolCalls.length,
      tokenCount,
      retryThrashRate: 0,
    },
    compounding: {
      knowledgeReuseRate: toolCalls.some(t => t.toolName.includes("search_gotchas")) ? 1 : 0,
      evalCasesBanked: 0,
    },
  };

  return {
    runId: `anthropic_${config.taskId}_${config.agentMode}_s${config.seed}_${Date.now()}`,
    config,
    startedAt,
    completedAt,
    scorecard,
    toolCalls,
    requestedTools,
    verificationCycles: [],
    outputHash,
    echoedModel,
    // taskSuccessRate stays 0: acceptance criteria are not graded here, so a
    // completed call is recorded without claiming the task passed.
    ...(error ? { error } : {}),
  };
}

// ── OpenAI Backend (scaffold) ───────────────────────────────────────

async function invokeOpenAI(
  config: RunConfig,
  task: EvalTask,
  options: InvokerOptions
): Promise<RunTelemetry> {
  if (!options.apiKey) {
    throw new Error("OPENAI_API_KEY is required for openai backend");
  }

  // Similar scaffold as Anthropic
  const startedAt = new Date().toISOString();
  const wallClockMs = 0;

  return {
    runId: `openai_${config.taskId}_${config.agentMode}_s${config.seed}_${Date.now()}`,
    config,
    startedAt,
    completedAt: new Date().toISOString(),
    scorecard: createStubScorecard(),
    toolCalls: [],
    verificationCycles: [],
    outputHash: "",
    error: "SCAFFOLD: OpenAI API call not yet wired — implement real invocation",
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildSystemPrompt(config: RunConfig, task: EvalTask): string {
  const base = `You are a Convex development agent. Your task: ${task.description}`;

  if (config.agentMode === "bare") {
    return `${base}\n\nYou have no MCP tools available. Use your knowledge of Convex to complete the task.`;
  }

  const toolsetDesc = config.agentMode === "mcp_lite"
    ? "You have basic Convex MCP tools: schema audit, function audit."
    : config.agentMode === "mcp_core"
    ? "You have core Convex MCP tools: schema, function, deployment, and learning tools."
    : "You have the full Convex MCP toolset: schema, function, deployment, learning, methodology, integration, cron, and component tools.";

  return `${base}\n\n${toolsetDesc}\n\nMethodology: Search gotchas before implementing. Record new gotchas after discovering edge cases.`;
}

function buildMcpToolDefs(config: RunConfig): Array<{ name: string; description: string }> {
  const lite = [
    { name: "convex_audit_schema", description: "Audit schema.ts for anti-patterns" },
    { name: "convex_audit_functions", description: "Audit function registration" },
  ];

  const core = [
    ...lite,
    { name: "convex_suggest_indexes", description: "Suggest missing indexes" },
    { name: "convex_check_validator_coverage", description: "Check validator coverage" },
    { name: "convex_check_function_refs", description: "Check function references" },
    { name: "convex_pre_deploy_gate", description: "Pre-deploy quality gate" },
    { name: "convex_check_env_vars", description: "Check environment variables" },
    { name: "convex_record_gotcha", description: "Record a gotcha" },
    { name: "convex_search_gotchas", description: "Search gotchas" },
  ];

  const full = [
    ...core,
    { name: "convex_get_methodology", description: "Get methodology guide" },
    { name: "convex_discover_tools", description: "Discover available tools" },
    { name: "convex_generate_rules_md", description: "Generate rules markdown" },
    { name: "convex_snapshot_schema", description: "Snapshot schema for diffing" },
    { name: "convex_bootstrap_project", description: "Bootstrap project health check" },
    { name: "convex_check_crons", description: "Validate cron definitions" },
    { name: "convex_analyze_components", description: "Analyze Convex components" },
  ];

  switch (config.agentMode) {
    case "mcp_lite": return lite;
    case "mcp_core": return core;
    case "mcp_full": return full;
    default: return [];
  }
}

// ── Public API ──────────────────────────────────────────────────────

export async function invokeAgent(
  config: RunConfig,
  task: EvalTask,
  options?: Partial<InvokerOptions>
): Promise<RunTelemetry> {
  const opts = { ...detectBackend(), ...options };

  switch (opts.backend) {
    case "anthropic":
      return invokeAnthropic(config, task, opts);
    case "openai":
      return invokeOpenAI(config, task, opts);
    case "stub":
    default:
      return invokeStub(config, task);
  }
}

export { detectBackend, buildSystemPrompt, buildMcpToolDefs };
