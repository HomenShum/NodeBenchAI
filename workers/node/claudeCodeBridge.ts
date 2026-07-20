/**
 * claudeCodeBridge.ts — Routes implementation packets to Claude Code for execution.
 *
 * NodeBench (intelligence layer) → creates implementation packet
 * Claude Code (execution layer) → receives packet as structured prompt, executes
 * NodeBench (validation layer) → checks results, updates packet status
 *
 * Uses the standard @anthropic-ai/sdk Messages API with tool use.
 * Serverless-compatible (no separate process needed).
 */

import Anthropic from "@anthropic-ai/sdk";

// ── Types ────────────────────────────────────────────────────────────────

export interface ImplementationPacket {
  id: string;
  objective: string;
  whyNow: string;
  scope: string[];
  constraints: string[];
  successCriteria: string[];
  validation: string[];
  context: string;
  status: string;
  agentType: string;
  priority: string;
}

export interface ExecutionResult {
  success: boolean;
  filesChanged: string[];
  testsPassed: boolean;
  diffSummary: string;
  costUsd: number;
  durationMs: number;
  rawOutput: string;
  errorMessage?: string;
}

// ── Prompt Builder ───────────────────────────────────────────────────────

function buildImplementationPrompt(packet: ImplementationPacket): string {
  const sections = [
    `# Implementation Packet: ${packet.objective}`,
    "",
    `## Why Now`,
    packet.whyNow || "Priority task from NodeBench intelligence layer.",
    "",
    `## Scope`,
    packet.scope.length > 0
      ? packet.scope.map(s => `- ${s}`).join("\n")
      : "- Determine scope from the objective",
    "",
    `## Constraints`,
    packet.constraints.length > 0
      ? packet.constraints.map(c => `- ${c}`).join("\n")
      : "- Follow existing code patterns\n- Don't break existing tests",
    "",
    `## Success Criteria`,
    packet.successCriteria.length > 0
      ? packet.successCriteria.map(c => `- ${c}`).join("\n")
      : "- Implementation works as described\n- No regressions",
    "",
    `## Validation Checks (run after implementation)`,
    packet.validation.length > 0
      ? packet.validation.map(v => `- ${v}`).join("\n")
      : "- npx tsc --noEmit\n- npx vite build",
    "",
    `## Context`,
    packet.context || "No additional context provided.",
    "",
    `## Instructions`,
    `1. Read the relevant files in scope`,
    `2. Implement the objective while respecting all constraints`,
    `3. Run the validation checks`,
    `4. Report: files changed, tests passed/failed, summary of what was done`,
  ];
  return sections.join("\n");
}

// ── Execution ────────────────────────────────────────────────────────────

export async function executeViaClaudeCode(packet: ImplementationPacket): Promise<ExecutionResult> {
  const startMs = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      filesChanged: [],
      testsPassed: false,
      diffSummary: "",
      costUsd: 0,
      durationMs: Date.now() - startMs,
      rawOutput: "",
      errorMessage: "ANTHROPIC_API_KEY not set. Cannot execute via Claude Code.",
    };
  }

  try {
    const client = new Anthropic({ apiKey });
    const systemPrompt = buildImplementationPrompt(packet);

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      system: [
        {
          type: "text",
          text: `You are a senior software engineer executing an implementation packet from NodeBench.
Your job: implement the objective, respect constraints, verify success criteria, run validation.
Report results as structured JSON at the end.

${systemPrompt}`,
        },
      ],
      messages: [
        {
          role: "user",
          content: `Execute this implementation packet. After completing, return a JSON summary:
{
  "filesChanged": ["path1.ts", "path2.tsx"],
  "testsPassed": true,
  "diffSummary": "Added X, modified Y, removed Z",
  "notes": "any observations or warnings"
}

Begin implementation of: ${packet.objective}`,
        },
      ],
    });

    // Extract text from response
    const rawOutput = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map(block => block.text)
      .join("\n");

    // Try to parse JSON result from the output
    const jsonMatch = rawOutput.match(/\{[\s\S]*"filesChanged"[\s\S]*\}/);
    let result: Partial<ExecutionResult> = {};
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        result = {
          filesChanged: Array.isArray(parsed.filesChanged) ? parsed.filesChanged : [],
          testsPassed: parsed.testsPassed === true,
          diffSummary: parsed.diffSummary ?? "",
        };
      } catch { /* JSON parse failed — use raw output */ }
    }

    // Estimate cost (Claude Sonnet 4.6: $3/1M input, $15/1M output)
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;

    return {
      success: true,
      filesChanged: result.filesChanged ?? [],
      testsPassed: result.testsPassed ?? false,
      diffSummary: result.diffSummary ?? rawOutput.slice(0, 500),
      costUsd: Math.round(costUsd * 10000) / 10000,
      durationMs: Date.now() - startMs,
      rawOutput: rawOutput.slice(0, 5000),
    };
  } catch (err: any) {
    return {
      success: false,
      filesChanged: [],
      testsPassed: false,
      diffSummary: "",
      costUsd: 0,
      durationMs: Date.now() - startMs,
      rawOutput: "",
      errorMessage: err?.message ?? "Claude Code execution failed",
    };
  }
}
