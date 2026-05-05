/**
 * Live backend QA for the "multiple me with audit rails" workflow.
 *
 * This intentionally sends only synthetic task data to external LLMs. It does
 * not send repository source, product screenshots, or user private artifacts.
 *
 * Covered planes:
 * - pi-ai runtime wrapper + AI SDK fallback
 * - LLM judge over synthetic agent output
 * - deterministic diligence gate judge
 * - model-router call shape for batch/autopilot callers
 * - prompt builders used by personalized batch briefs
 */

import { config as loadEnv } from "dotenv";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { judgeAgentRun } from "../../convex/domains/evaluation/agentRunJudge";
import { runPiOrAiSdkCompletion } from "../../convex/domains/pipelines/piRuntime";
import { buildBriefPrompt, buildDeltaSummaryPrompt } from "../../convex/domains/operations/batchAutopilot/promptBuilder";
import { judgeDiligenceRun } from "../../server/pipeline/diligenceJudge";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type CheckStatus = "pass" | "fail" | "skip";

interface QaCheck {
  name: string;
  status: CheckStatus;
  summary: string;
  details?: unknown;
}

const checks: QaCheck[] = [];

function record(check: QaCheck) {
  checks.push(check);
  const icon = check.status === "pass" ? "PASS" : check.status === "skip" ? "SKIP" : "FAIL";
  console.log(`${icon} ${check.name}: ${check.summary}`);
}

function assertIncludes(haystack: string, needle: string, label: string) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label} missing ${JSON.stringify(needle)}`);
  }
}

async function checkModelRouterCallShape() {
  const files = [
    "convex/domains/operations/batchAutopilot/runner.ts",
    "convex/domains/research/forecasting/actions/refreshForecast.ts",
  ];

  const details: Record<string, unknown> = {};
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    const badPatterns = [
      "taskTier:",
      "summaryResult.content",
      "briefResult.content",
      "usage?.totalTokens",
    ].filter((p) => text.includes(p));
    const hasSystemPrompt = text.includes("systemPrompt:");
    const hasMessages = text.includes("messages:");
    details[file] = { badPatterns, hasSystemPrompt, hasMessages };
    if (badPatterns.length > 0) {
      throw new Error(`${file} still uses stale modelRouter shape: ${badPatterns.join(", ")}`);
    }
    if (!hasSystemPrompt || !hasMessages) {
      throw new Error(`${file} does not pass systemPrompt/messages to modelRouter.route`);
    }
  }

  record({
    name: "model_router_call_shape",
    status: "pass",
    summary: "batch autopilot and forecasting callers use the current router contract",
    details,
  });
}

async function checkPromptBuilders() {
  const deltaPrompt = buildDeltaSummaryPrompt(
    {
      feedItems: [
        {
          title: "Orbital Labs signs healthcare design partner",
          summary: "Synthetic signal",
          category: "company",
          score: 91,
          url: "https://example.test/orbital",
          source: "Synthetic source",
        },
      ],
      signals: [
        {
          content: "voice-agent eval infra moved from demo to pilot",
          source: "Synthetic capture",
          kind: "traction",
        },
      ],
      narrativeEvents: [
        {
          headline: "Healthcare AI buying cycle changed",
          summary: "Synthetic narrative event",
          significance: "high",
        },
      ],
      researchTasks: [{ entityType: "company", status: "completed", qualityScore: 92 }],
    },
    "24 hours",
  );

  const briefPrompt = buildBriefPrompt("Synthetic delta summary with cited claims.", {
    displayName: "Homen",
    role: "founder / banker",
    domains: ["AI infra", "startup banking"],
    writingStyle: "concise, evidence-led, banker-memo cadence",
    goals: [
      { rank: 1, description: "Prioritize entities worth follow-up" },
      { rank: 2, description: "Scale memo quality across a universe" },
    ],
    briefFormat: "structured",
    citationStyle: "claim-level",
    includeCostEstimate: true,
  });

  assertIncludes(deltaPrompt, "Orbital Labs", "deltaPrompt");
  assertIncludes(deltaPrompt, "voice-agent eval infra", "deltaPrompt");
  assertIncludes(briefPrompt, "Homen", "briefPrompt");
  assertIncludes(briefPrompt, "banker-memo cadence", "briefPrompt");
  assertIncludes(briefPrompt, "claim-level", "briefPrompt");

  record({
    name: "personalized_prompt_builders",
    status: "pass",
    summary: "batch brief prompts preserve operator profile, goals, style, and source context",
    details: {
      deltaPromptChars: deltaPrompt.length,
      briefPromptChars: briefPrompt.length,
    },
  });
}

async function checkDeterministicDiligenceJudge() {
  const startedAt = Date.now();
  const verdict = judgeDiligenceRun({
    args: {
      entitySlug: "orbital-labs",
      blockType: "projection",
      scratchpadRunId: "qa_run_orbital_001",
      version: 2,
      overallTier: "verified",
      headerText: "Orbital Labs coverage memo",
      bodyProse:
        "Orbital Labs has enough corroborated synthetic evidence for a follow-up screen. The key diligence question is whether healthcare design partners convert from demo interest into a paid pilot.",
    },
    result: {
      status: "created",
      entitySlug: "orbital-labs",
      blockType: "projection",
      version: 2,
    },
    telemetry: {
      startedAt,
      endedAt: startedAt + 620,
      toolCalls: 4,
      tokensIn: 1100,
      tokensOut: 380,
      sourceCount: 3,
    },
    priorVersion: 1,
  });

  if (verdict.verdict !== "verified") {
    throw new Error(`expected verified diligence verdict, got ${verdict.verdict}`);
  }

  record({
    name: "deterministic_diligence_judge",
    status: "pass",
    summary: `${verdict.passCount} gates passed, verdict=${verdict.verdict}`,
    details: verdict,
  });
}

async function checkPiRuntime() {
  const result = await runPiOrAiSdkCompletion({
    model: "gemini-3.1-flash-lite-preview",
    system: "Return only compact JSON. No markdown.",
    prompt:
      'Return exactly a JSON object with fields {"ok": true, "workflow": "multiple_me_backend_qa", "nextAction": "review_report"}.',
    temperature: 0,
    maxOutputTokens: 128,
    timeoutMs: 60_000,
  });

  const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`pi runtime returned non-JSON: ${result.text.slice(0, 200)}`);
  }

  if (!(parsed && typeof parsed === "object" && (parsed as any).ok === true)) {
    throw new Error(`pi runtime JSON did not contain ok=true: ${result.text.slice(0, 200)}`);
  }

  record({
    name: "pi_ai_runtime_completion",
    status: "pass",
    summary: `model=${result.modelId}, provider=${result.providerId}, stop=${result.stopReason}`,
    details: {
      usage: result.usage,
      modelId: result.modelId,
      providerId: result.providerId,
      stopReason: result.stopReason,
      scratchpadPreview: result.scratchpad.slice(0, 300),
      parsed,
    },
  });
}

async function checkAgentLlmJudge() {
  const result = await judgeAgentRun({
    taskDescription:
      "Evaluate whether a synthetic company coverage answer is ready for batch review.",
    expectedOutcome:
      "A source-backed answer with clear recommendation, evidence, risks, next action, no unsafe external action, and bounded tool usage.",
    actualOutput: [
      "Short answer: worth a 30-minute follow-up.",
      "Why it matters: Orbital Labs is a synthetic voice-agent evaluation infrastructure company with a plausible healthcare workflow wedge.",
      "Evidence: Synthetic source A says the demo covered HIPAA-aware evals. Synthetic source B says the team is seeking healthcare design partners.",
      "Risks: procurement timing and missing paid pilot evidence remain open.",
      "Next action: create a needs-review memo section and ask for stronger source coverage before marking verified.",
      "Contract followed: front-door request, memory/recon pass, bounded synthesis, review handoff.",
    ].join("\n"),
    toolsUsed: ["memory_search", "entity_resolve", "source_fetch", "diligence_judge"],
    tokenCount: 1450,
    durationMs: 8200,
    sourceRefs: [
      { label: "Synthetic source A", href: "https://example.test/source-a" },
      { label: "Synthetic source B", href: "https://example.test/source-b" },
    ],
  });

  if (result.verdict === "FAIL") {
    throw new Error(`agent LLM judge failed: ${result.reasoning}`);
  }

  record({
    name: "llm_agent_judge",
    status: "pass",
    summary: `${result.verdict} ${result.passingCount}/${result.totalCount} via ${result.model}`,
    details: result,
  });
}

async function main() {
  const outDir = path.resolve(
    ".tmp/multiple-me-backend-qa",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await fs.mkdir(outDir, { recursive: true });

  const runners: Array<[string, () => Promise<void>]> = [
    ["model_router_call_shape", checkModelRouterCallShape],
    ["personalized_prompt_builders", checkPromptBuilders],
    ["deterministic_diligence_judge", checkDeterministicDiligenceJudge],
    ["pi_ai_runtime_completion", checkPiRuntime],
    ["llm_agent_judge", checkAgentLlmJudge],
  ];

  for (const [name, fn] of runners) {
    try {
      await fn();
    } catch (err) {
      record({
        name,
        status: "fail",
        summary: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const passCount = checks.filter((c) => c.status === "pass").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const skipCount = checks.filter((c) => c.status === "skip").length;
  const report = {
    generatedAt: new Date().toISOString(),
    passCount,
    failCount,
    skipCount,
    ok: failCount === 0,
    envPresence: {
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
      GOOGLE_AI_API_KEY: Boolean(process.env.GOOGLE_AI_API_KEY),
      GOOGLE_GENERATIVE_AI_API_KEY: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
      OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
      OPENROUTER_API_KEY: Boolean(process.env.OPENROUTER_API_KEY),
      ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    checks,
  };

  const jsonPath = path.join(outDir, "results.json");
  const mdPath = path.join(outDir, "findings.md");
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(
    mdPath,
    [
      "# Multiple Me Backend QA",
      "",
      `Generated: ${report.generatedAt}`,
      `Result: ${report.ok ? "PASS" : "FAIL"} (${passCount} pass, ${failCount} fail, ${skipCount} skip)`,
      "",
      ...checks.map((c) => `- ${c.status.toUpperCase()} ${c.name}: ${c.summary}`),
      "",
      `JSON: ${jsonPath}`,
    ].join("\n"),
    "utf8",
  );

  console.log("");
  console.log(`Report: ${mdPath}`);
  console.log(`JSON:   ${jsonPath}`);

  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
