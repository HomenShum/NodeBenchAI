/**
 * analyze-gap.mjs — Use Claude to analyze daily brief signals and identify a tool gap.
 *
 * Env:
 *   ANTHROPIC_API_KEY — Claude API key
 *   BRIEF_JSON        — Path to daily-brief.json (or defaults to /tmp/daily-brief.json)
 *   GITHUB_OUTPUT     — (set by Actions) Path to write step outputs
 *
 * Outputs:
 *   should_generate — "true" if a tool gap was identified
 *   gap_spec_path   — Path to the gap spec JSON
 */

import { readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const GAP_SPEC_PATH = "/tmp/gap-spec.json";
const SUMMARY_PATH = "/tmp/gap-analysis-summary.txt";
const TOOLS_DIR = join(process.cwd(), "packages/mcp-local/src/tools");

function setOutput(key, value) {
  const ghOutput = process.env.GITHUB_OUTPUT;
  if (ghOutput) appendFileSync(ghOutput, `${key}=${value}\n`);
  console.log(`::set-output name=${key}::${value}`);
}

/** Scan tool files and extract tool names + descriptions via regex. */
function buildToolCatalog() {
  const catalog = [];
  const files = readdirSync(TOOLS_DIR).filter((f) => f.endsWith("Tools.ts"));
  for (const file of files) {
    const content = readFileSync(join(TOOLS_DIR, file), "utf-8");
    // Match name: "xxx" followed by description: "xxx"
    const nameRe = /name:\s*["']([^"']+)["']/g;
    const descRe = /description:\s*\n?\s*["']([^"']+)["']/g;
    const names = [...content.matchAll(nameRe)].map((m) => m[1]);
    const descs = [...content.matchAll(descRe)].map((m) => m[1].slice(0, 120));
    for (let i = 0; i < names.length; i++) {
      catalog.push({ name: names[i], description: descs[i] ?? "", file });
    }
  }
  return catalog;
}

/** The Messages API body. No sampling parameters: Claude 4.7+/5.x answer 400 to them. */
export function buildClaudeRequest(systemPrompt, userPrompt) {
  return {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };
}

/** Concatenated text blocks. content[0] is a thinking block when adaptive thinking is on. */
export function claudeText(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

export async function callClaude(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(buildClaudeRequest(systemPrompt, userPrompt)),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }

  return claudeText(await res.json());
}

async function main() {
  const briefPath = process.env.BRIEF_JSON || "/tmp/daily-brief.json";
  const brief = JSON.parse(readFileSync(briefPath, "utf-8"));
  const catalog = buildToolCatalog();

  console.log(`Tool catalog: ${catalog.length} tools from ${new Set(catalog.map((t) => t.file)).size} files`);

  const catalogText = catalog
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");

  const systemPrompt = `You are a tool capability analyst for NodeBench MCP, an MCP server with ${catalog.length} tools for AI agent development methodology.

You analyze daily intelligence signals and identify ONE concrete new tool that would fill a gap in the existing toolkit.

RULES:
- The tool MUST use ONLY existing dependencies: better-sqlite3, @modelcontextprotocol/sdk, and optionals: @anthropic-ai/sdk, @google/genai, openai, cheerio, papaparse, pdf-parse, playwright, sharp, xlsx
- The tool MUST follow the McpTool pattern: { name, description, inputSchema (JSON Schema v7), handler }
- The tool should be useful for AI agent development workflows
- It should store data in existing SQLite tables (no new tables): verification_cycles, verification_phases, gaps, test_results, eval_runs, eval_cases, quality_gate_runs, learnings, recon_sessions, recon_findings, project_context, tool_call_log, agent_tasks, agent_roles, context_budget_log, oracle_comparisons
- OR it can be a pure-compute tool that doesn't need the database
- If no clear tool gap exists, return { "shouldGenerate": false, "reason": "..." }

Return ONLY valid JSON, no markdown fences.`;

  const userPrompt = `DAILY BRIEF SIGNALS:
${JSON.stringify({ narrativeThesis: brief.narrativeThesis, signals: brief.signals, actionItems: brief.actionItems, entitySpotlight: brief.entitySpotlight, fundingRounds: brief.fundingRounds }, null, 2)}

EXISTING TOOL CATALOG (${catalog.length} tools):
${catalogText}

Identify ONE tool gap. Return JSON:
{
  "shouldGenerate": boolean,
  "toolName": "snake_case_name",
  "domain": "verification|eval|quality_gate|learning|flywheel|recon|web|github|docs|bootstrap|self_eval|parallel|llm|security|platform|vision|ui_capture|local_file",
  "description": "Tool description (1-2 sentences)",
  "rationale": "Why based on today's signals",
  "inputSchema": { "type": "object", "properties": {...}, "required": [...] },
  "handlerSketch": "Brief pseudocode of what the handler does",
  "testCases": [{ "name": "test description", "type": "static|unit" }]
}`;

  console.log("Calling Claude for gap analysis...");

  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = callClaude(systemPrompt, attempt === 0 ? userPrompt : userPrompt + "\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no explanation.");
      response = await response;
      // Strip markdown fences if present
      response = response.replace(/^```json?\n?/m, "").replace(/\n?```$/m, "").trim();
      JSON.parse(response); // validate
      break;
    } catch (err) {
      if (attempt === 1) {
        console.error(`Failed to get valid JSON after 2 attempts: ${err.message}`);
        setOutput("should_generate", "false");
        return;
      }
      console.warn(`Attempt ${attempt + 1} failed, retrying: ${err.message}`);
    }
  }

  const spec = JSON.parse(response);

  if (!spec.shouldGenerate) {
    console.log(`No tool gap identified: ${spec.reason ?? "LLM decided not to generate"}`);
    writeFileSync(SUMMARY_PATH, `No tool generated. Reason: ${spec.reason ?? "none"}`);
    setOutput("should_generate", "false");
    return;
  }

  // Validate basic fields
  if (!spec.toolName || !spec.domain || !spec.description || !spec.inputSchema) {
    console.error("Invalid spec: missing required fields");
    setOutput("should_generate", "false");
    return;
  }

  // Check for duplicate names
  if (catalog.some((t) => t.name === spec.toolName)) {
    console.error(`Tool name "${spec.toolName}" already exists. Skipping.`);
    setOutput("should_generate", "false");
    return;
  }

  writeFileSync(GAP_SPEC_PATH, JSON.stringify(spec, null, 2));
  writeFileSync(
    SUMMARY_PATH,
    `Tool: ${spec.toolName}\nDomain: ${spec.domain}\nDescription: ${spec.description}\nRationale: ${spec.rationale}`
  );

  console.log(`Gap identified: ${spec.toolName} (${spec.domain})`);
  console.log(`Rationale: ${spec.rationale}`);

  setOutput("should_generate", "true");
  setOutput("gap_spec_path", GAP_SPEC_PATH);
}

// Run only as a script, so the request builder can be imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
