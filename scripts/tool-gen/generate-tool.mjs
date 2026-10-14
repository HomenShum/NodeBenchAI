/**
 * generate-tool.mjs — Use Claude to generate MCP tool TypeScript code.
 *
 * Env:
 *   ANTHROPIC_API_KEY — Claude API key
 *   GAP_SPEC          — Path to gap-spec.json (or defaults to /tmp/gap-spec.json)
 *   GITHUB_OUTPUT     — (set by Actions) Path to write step outputs
 *
 * Outputs:
 *   tool_generated — "true" if code was generated and written
 *   tool_name      — The tool name
 *   tool_domain    — The domain key
 *   manifest_path  — Path to the manifest JSON
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { claudeText } from "./analyze-gap.mjs";

const MANIFEST_PATH = "/tmp/tool-manifest.json";
const MCP_ROOT = join(process.cwd(), "packages/mcp-local");
const TOOLS_DIR = join(MCP_ROOT, "src/tools");
const TYPES_PATH = join(MCP_ROOT, "src/types.ts");

/** Map domain keys to their existing tool file names. */
const DOMAIN_FILE_MAP = {
  verification: "verificationTools.ts",
  eval: "evalTools.ts",
  quality_gate: "qualityGateTools.ts",
  learning: "learningTools.ts",
  flywheel: "flywheelTools.ts",
  recon: "reconTools.ts",
  ui_capture: "uiCaptureTools.ts",
  vision: "visionTools.ts",
  local_file: "localFileTools.ts",
  web: "webTools.ts",
  github: "githubTools.ts",
  docs: "documentationTools.ts",
  bootstrap: "agentBootstrapTools.ts",
  self_eval: "selfEvalTools.ts",
  parallel: "parallelAgentTools.ts",
  llm: "llmTools.ts",
  security: "securityTools.ts",
  platform: "platformTools.ts",
  research_writing: "researchWritingTools.ts",
};

function setOutput(key, value) {
  const ghOutput = process.env.GITHUB_OUTPUT;
  if (ghOutput) appendFileSync(ghOutput, `${key}=${value}\n`);
  console.log(`::set-output name=${key}::${value}`);
}

/**
 * The Messages API body. No sampling parameters: Claude 4.7+/5.x answer 400 to them.
 * PR 1 moves no ids; PR 2 changes the model literal with its own request-shape update.
 */
export function buildClaudeRequest(systemPrompt, userPrompt) {
  return {
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };
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

  // Read blocks by type: content[0] is a thinking block when adaptive thinking is on.
  return claudeText(await res.json());
}

async function main() {
  const specPath = process.env.GAP_SPEC || "/tmp/gap-spec.json";
  const spec = JSON.parse(readFileSync(specPath, "utf-8"));

  // Determine target file
  const targetFileName = DOMAIN_FILE_MAP[spec.domain];
  const isNewFile = !targetFileName;
  const actualFile = targetFileName || `${spec.domain}Tools.ts`;
  const targetPath = join(TOOLS_DIR, actualFile);

  // Read exemplar file (the target file itself, or platformTools.ts as fallback)
  let exemplarContent;
  if (existsSync(targetPath)) {
    exemplarContent = readFileSync(targetPath, "utf-8");
  } else {
    exemplarContent = readFileSync(join(TOOLS_DIR, "platformTools.ts"), "utf-8");
  }

  // Read types
  const typesContent = readFileSync(TYPES_PATH, "utf-8");

  // Detect the export name from the exemplar
  const exportMatch = exemplarContent.match(/export const (\w+):\s*McpTool\[\]/);
  const exportName = exportMatch ? exportMatch[1] : `${spec.domain}Tools`;

  const systemPrompt = `You are a TypeScript code generator for NodeBench MCP tools. Generate production-quality tool code that follows EXACTLY the patterns in the exemplar file.

RULES:
1. Import only from "../types.js" and existing node modules already in the exemplar
2. Use JSON Schema v7 for inputSchema (type: "object", properties, required)
3. Handler must be async and return a plain object (never throw — return { error: true, message } instead)
4. For DB operations: import { getDb, genId } from "../db.js"
5. NEVER use eval(), Function(), or dynamic code execution
6. NEVER hardcode API keys or secrets
7. NEVER import modules not already used in the exemplar or in package.json
8. Match the exact code style of the exemplar (spacing, quotes, comments)
9. The tool must be a single object that fits inside the existing McpTool[] array

Return ONLY valid JSON (no markdown fences):
{
  "toolObjectCode": "// Just the { name: ..., handler: ... } object (NO trailing comma)",
  "needsNewImports": "// Any new import lines needed at the top of the file, or empty string",
  "testCode": "// vitest describe block for this tool"
}`;

  const userPrompt = `MCPTOOL TYPE:
${typesContent}

EXEMPLAR FILE (${actualFile}):
${exemplarContent}

TOOL SPECIFICATION:
${JSON.stringify(spec, null, 2)}

Generate the tool following the exemplar's exact patterns. The toolObjectCode should be a single McpTool object (with { name, description, inputSchema, handler }) that can be inserted into the existing array.

For testCode, generate a vitest describe block. IMPORTANT: Use non-null assertion (tool!) when accessing tool properties after the find(), because TypeScript's strict mode requires it. Example pattern:
describe("Static: ${spec.toolName} tool", () => {
  const tool = domainTools.find((t) => t.name === "${spec.toolName}");
  it("should exist", () => { expect(tool).toBeDefined(); });
  it("should have correct schema", () => { expect(tool!.inputSchema.required).toContain("someField"); });
});`;

  console.log(`Generating tool code for: ${spec.toolName} → ${actualFile}`);

  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await callClaude(
        systemPrompt,
        attempt === 0 ? userPrompt : userPrompt + "\n\nCRITICAL: Return ONLY valid JSON. No markdown fences."
      );
      response = response.replace(/^```json?\n?/m, "").replace(/\n?```$/m, "").trim();
      JSON.parse(response); // validate
      break;
    } catch (err) {
      if (attempt === 1) {
        console.error(`Failed to get valid JSON after 2 attempts: ${err.message}`);
        setOutput("tool_generated", "false");
        return;
      }
      console.warn(`Attempt ${attempt + 1} failed, retrying: ${err.message}`);
    }
  }

  const generated = JSON.parse(response);

  if (!generated.toolObjectCode) {
    console.error("Missing toolObjectCode in response");
    setOutput("tool_generated", "false");
    return;
  }

  // Write the generated tool code to a temp file for debugging
  writeFileSync("/tmp/generated-tool.ts", generated.toolObjectCode);

  // Build manifest for patch-files.mjs
  const manifest = {
    toolName: spec.toolName,
    domain: spec.domain,
    targetFile: actualFile,
    targetPath,
    isNewFile,
    exportName,
    toolObjectCode: generated.toolObjectCode,
    needsNewImports: generated.needsNewImports || "",
    testCode: generated.testCode || "",
    categoryMapEntry: { [spec.domain]: [spec.toolName] },
    toolNames: [spec.toolName],
  };

  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`Tool code generated (${generated.toolObjectCode.length} chars)`);
  console.log(`Target: ${actualFile} (${isNewFile ? "NEW" : "APPEND"})`);

  setOutput("tool_generated", "true");
  setOutput("tool_name", spec.toolName);
  setOutput("tool_domain", spec.domain);
  setOutput("manifest_path", MANIFEST_PATH);
}

// Run only as a script, so the request builder can be imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
