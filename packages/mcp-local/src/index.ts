#!/usr/bin/env node
/**
 * NodeBench MCP — Development Methodology Edition
 *
 * Zero-config, fully local MCP server. Uses native SQLite when available and
 * falls back to a lightweight local mode when the native addon is absent.
 * Packages the 6-Phase Verification, Eval-Driven Development, AI Flywheel,
 * Quality Gates, and Learnings methodologies as MCP tools that guide agents
 * to work more rigorously.
 *
 * Local runtime data lives under ~/.nodebench/
 *
 * Uses the low-level Server class to register tools with raw JSON Schema
 * (the high-level McpServer.tool() requires Zod schemas in SDK >=1.17).
 *
 * Usage:
 *   npx @nodebench/mcp          (stdio transport)
 *   npx tsx src/index.ts         (dev mode)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb, genId, openOptionalSqliteDatabase } from "./db.js";
import { redactSecrets, auditLog, SecurityError, flushAuditLog } from "./security/index.js";
import { startDashboardServer, getDashboardUrl, stopDashboardServer } from "./dashboard/server.js";
import { startOperatingDashboardServer, getOperatingDashboardUrl, stopOperatingDashboardServer } from "./dashboard/operatingServer.js";
import { startEngineServer, getEngineUrl } from "./engine/server.js";
import { getAnalyticsDb, closeAnalyticsDb, clearOldRecords } from "./analytics/index.js";
import { AnalyticsTracker } from "./analytics/toolTracker.js";
import { generateSmartPreset, formatPresetRecommendation } from "./analytics/index.js";
import { getProjectUsageSummary, exportUsageStats, formatStatsDisplay } from "./analytics/index.js";
import { TOOLSET_MAP, TOOL_TO_TOOLSET, loadToolsets, ALL_DOMAIN_KEYS, TOOLSET_LOADERS } from "./toolsetRegistry.js";
import { initObservability, startWatchdog, stopWatchdog } from "./tools/observabilityTools.js";
import { createMetaTools } from "./tools/metaTools.js";
import { createProgressiveDiscoveryTools } from "./tools/progressiveDiscoveryTools.js";
import { getQuickRef, ALL_REGISTRY_ENTRIES, TOOL_REGISTRY, getToolComplexity, getToolAnnotations, toolNameToTitle, _setDbAccessor, hybridSearch, WORKFLOW_CHAINS } from "./tools/toolRegistry.js";
import { getRequestedPreset, resolveRuntimeFlags } from "./runtimeConfig.js";
import {
  NODEBENCH_CLI_COMMAND,
  NODEBENCH_DISPLAY_NAME,
  NODEBENCH_NPX_PACKAGE,
  NODEBENCH_PACKAGE_NAME,
  NODEBENCH_SERVER_KEY,
  NODEBENCH_VERSION,
  comparePackageVersions,
} from "./packageInfo.js";
import type { McpTool } from "./types.js";

// TOON format — ~40% token savings on tool responses when the optional package is installed.
import { encodeToon } from "./tools/toonCodec.js";
// Embedding provider — neural semantic search
import { initEmbeddingIndex } from "./tools/embeddingProvider.js";

 // ── CLI argument parsing ──────────────────────────────────────────────
 const cliArgs = process.argv.slice(2);
 const useToon = !cliArgs.includes("--no-toon");
 const useSmartPreset = cliArgs.includes("--smart-preset");
 const showStats = cliArgs.includes("--stats");
 const exportStats = cliArgs.includes("--export-stats");
 const resetStats = cliArgs.includes("--reset-stats");
 const listPresetsFlag = cliArgs.includes("--list-presets");
 const healthFlag = cliArgs.includes("--health");
 const statusFlag = cliArgs.includes("--status");
 const diagnoseFlag = cliArgs.includes("--diagnose");
 const autoPresetFlag = cliArgs.includes("--auto-preset");
 const syncConfigsFlag = cliArgs.includes("--sync-configs");
 const requestedPreset = getRequestedPreset(cliArgs);
 const runtimeFlags = resolveRuntimeFlags(cliArgs, requestedPreset);
 const useEmbedding = runtimeFlags.enableEmbedding;
 const useEngine = runtimeFlags.enableEngine;
 const useProfile = runtimeFlags.enableProfiling;
 const DISPLAY_NAME = NODEBENCH_DISPLAY_NAME;
 const CLI_COMMAND = NODEBENCH_CLI_COMMAND;
 const NPX_COMMAND = `npx ${NODEBENCH_NPX_PACKAGE}`;
 const NPX_Y_COMMAND = `npx -y ${NODEBENCH_NPX_PACKAGE}`;
 const SERVER_KEY = NODEBENCH_SERVER_KEY;
const engineSecret = (() => {
  const idx = cliArgs.indexOf("--engine-secret");
  return idx >= 0 && idx + 1 < cliArgs.length ? cliArgs[idx + 1] : process.env.ENGINE_SECRET;
})();

async function openOptionalSqlite(dbPath: string, options?: Record<string, unknown>): Promise<any | null> {
  return openOptionalSqliteDatabase(dbPath, options);
}

export { TOOLSET_MAP };

// Starter/default: v3 workflow facade plus the canonical NodeBench API bridge.
// Discovery/meta/dynamic tools are added separately.
const STARTER_TOOLSETS = ["core_workflow", "nodebench_research"];

// Core: the original default. ~81 tools across 15 domains.
const CORE_TOOLSETS = ["core_workflow", "nodebench_research", "verification", "eval", "quality_gate", "learning", "flywheel", "autonomous_delivery", "sync_bridge", "shared_context", "recon", "security", "boilerplate", "skill_update", "context_sandbox", "observability", "execution_trace", "mission_harness", "deep_sim", "founder", "scenario_compiler", "packet_compiler", "entity_temporal"];

// Power: extended research + founder intelligence without admin/debug-only runtime surfaces.
const POWER_TOOLSETS = ["core_workflow", "nodebench_research", "deep_sim", "founder", "recon", "web", "shared_context", "sync_bridge", "session_memory", "entity_lookup", "delta", "site_map"];

// Admin: profiling, debugging, observability, dashboards, and eval harness domains.
const ADMIN_TOOLSETS = ["core_workflow", "nodebench_research", "observability", "profiler", "local_dashboard", "benchmark", "longitudinal_benchmark", "dogfood_judge", "execution_trace", "qa_orchestration", "mission_harness", "quality_gate", "eval", "verification"];

const PRESETS: Record<string, string[]> = {
  // DEFAULT: v3 core workflow facade. Progressive discovery expands into power/admin domains only when needed.
  default: STARTER_TOOLSETS,
  starter: STARTER_TOOLSETS,
  power:        POWER_TOOLSETS,
  admin:        ADMIN_TOOLSETS,
  // Core AI Flywheel — everything from the old default
  core:         CORE_TOOLSETS,
  // Themed presets — bridge between the core workflow surface and full-domain coverage
  web_dev:      [...CORE_TOOLSETS, "ui_capture", "vision", "web", "seo", "git_workflow", "architect", "ui_ux_dive", "ui_ux_dive_v2", "mcp_bridge", "qa_orchestration", "visual_qa", "design_governance", "web_scraping", "site_map", "savings"],
  research:     [...CORE_TOOLSETS, "web", "llm", "rss", "email", "docs", "research_optimizer", "web_scraping", "temporal_intelligence", "deep_sim"],
  data:         [...CORE_TOOLSETS, "local_file", "llm", "web", "research_optimizer", "web_scraping", "temporal_intelligence"],
  devops:       [...CORE_TOOLSETS, "git_workflow", "session_memory", "benchmark", "pattern"],
  mobile:       [...CORE_TOOLSETS, "ui_capture", "vision", "flicker_detection", "ui_ux_dive", "ui_ux_dive_v2", "mcp_bridge", "visual_qa"],
  academic:     [...CORE_TOOLSETS, "research_writing", "llm", "web", "local_file"],
  multi_agent:  [...CORE_TOOLSETS, "parallel", "self_eval", "session_memory", "pattern", "toon", "qa_orchestration", "agent_traverse", "engine_context", "research_optimizer", "web_scraping", "deep_sim"],
  content:      [...CORE_TOOLSETS, "llm", "critter", "email", "rss", "platform", "architect", "local_dashboard", "engine_context", "thompson_protocol"],
  // ── Persona presets (kept for compatibility, but no longer the default entry point) ──
  // Founder: decision intelligence + company tracking + session memory + local dashboard
  founder:      ["deep_sim", "founder", "learning", "local_dashboard", "autonomous_delivery", "sync_bridge", "shared_context", "site_map", "savings", "profiler", "sweep", "monte_carlo"],
  // Banker/analyst: decision intelligence + company profiling + web research + recon (~39 tools)
  banker:       ["deep_sim", "founder", "web", "recon", "autonomous_delivery", "sync_bridge", "shared_context", "profiler"],
  // Operator: decision intelligence + company tracking + causal memory + action tracing
  operator:     ["deep_sim", "founder", "causal_memory", "autonomous_delivery", "sync_bridge", "shared_context", "profiler"],
  // Researcher: decision intelligence + web + recon + session memory (~32 tools)
  researcher:   ["deep_sim", "web", "recon", "learning", "autonomous_delivery", "sync_bridge", "shared_context", "profiler"],
  // Cursor IDE has a hard 40-tool limit across ALL MCP servers.
  cursor:       ["deep_sim", "quality_gate", "learning", "session_memory", "web", "toon"],
  // Hackathon: founder + web intelligence + entity enrichment + shared context
  // Pairs with retention.sh for QA. Install: claude mcp add nodebench -- npx -y nodebench-mcp --preset=hackathon
  hackathon:    ["deep_sim", "founder", "learning", "web", "entity_enrichment", "autonomous_delivery", "sync_bridge", "shared_context", "recon", "local_dashboard", "delta", "profiler", "sweep", "monte_carlo"],
  // Delta: full operating-intelligence preset — all delta.* packet tools + watchlist + entity intel
  delta:        ["deep_sim", "founder", "learning", "web", "entity_enrichment", "autonomous_delivery", "sync_bridge", "shared_context", "recon", "local_dashboard", "quality_gate", "execution_trace", "delta"],
  full: ALL_DOMAIN_KEYS,
};

const PRESET_DESCRIPTIONS: Record<string, string> = {
  default:     "Default v3 surface — workflow/sync tools plus the canonical NodeBench research bridge and discovery helpers.",
  starter:     "Default v3 surface — workflow/sync tools plus the canonical NodeBench research bridge and discovery helpers.",
  power:       "Extended workflow preset — founder + recon + web + packets without admin-only runtime surfaces.",
  admin:       "Admin/runtime preset — profiling, observability, dashboards, eval, and debug lanes.",
  core:        "Core AI Flywheel (~81 tools) — verification, eval, quality gates, learning, recon, mission harness",
  web_dev:     "Web projects — adds visual QA, SEO audit, git workflow, code architecture",
  research:    "Research workflows — adds web search, LLM calls, RSS feeds, email, docs",
  data:        "Data analysis — adds CSV/XLSX/PDF/JSON parsing, LLM extraction, web fetch",
  devops:      "CI/CD & ops — adds git compliance, session memory, benchmarks, pattern mining",
  mobile:      "Mobile apps — adds screenshot capture, vision analysis, flicker detection",
  academic:    "Academic papers — adds polish, review, translate, logic check, data analysis",
  multi_agent: "Multi-agent teams — adds task locking, messaging, roles, oracle testing, frontend traversal",
  content:     "Content & publishing — adds LLM, accountability, email, RSS, platform queue",
  founder:     "Founder decision preset — company tracking, decision intelligence, shared context, local dashboard",
  banker:      "Banker/Analyst (~39 tools) — decision intelligence, company profiling, web research, recon",
  operator:    "Operator — decision intelligence, company tracking, causal memory, action tracing",
  researcher:  "Researcher (~32 tools) — decision intelligence, web search, recon, session memory",
  cursor:      "Cursor IDE (28 tools) — decision intelligence, quality gates, session memory, web, TOON encoding. Leaves 12 slots for other MCP servers.",
  hackathon:   "Hackathon — decision intelligence + entity intel + web research + team coordination. Pairs with retention.sh for QA.",
  delta:       "Delta (~65 tools) — full operating-intelligence preset. Entity intel, decision memos, watchlists, agent handoff, execution traces.",
  full:        "Everything — all domains for maximum coverage",
};

function listRuntimePresets(): Array<{ name: string; toolsets: string[]; toolCount: number; description: string }> {
  return Object.entries(PRESETS).map(([name, toolsets]) => {
    const toolNames = new Set<string>();
    for (const toolset of new Set(toolsets)) {
      for (const tool of TOOLSET_MAP[toolset] ?? []) {
        toolNames.add(tool.name);
      }
    }

    return {
      name,
      toolsets,
      toolCount: toolNames.size,
      description: PRESET_DESCRIPTIONS[name] ?? "",
    };
  });
}

function isWorkflowFacadePreset(presetName: string): boolean {
  return presetName === "default" || presetName === "starter" || presetName === "v3";
}

   async function parseToolsets(): Promise<McpTool[]> {
    if (cliArgs.includes("--help")) {
      const lines = [
        `nodebench-mcp v${NODEBENCH_VERSION} — Development Methodology MCP Server`,
        "",
        "Usage: nodebench-mcp [options]",
        "",
        "Options:",
        "  --toolsets <list>   Comma-separated toolsets to enable (default: default)",
        "  --exclude <list>    Comma-separated toolsets to exclude",
        "  --preset <name>     Use a preset: default, power, admin, or full",
        "  --smart-preset      Generate smart preset recommendation based on project type and usage history",
        "  --auto-preset       Detect project type from package.json/pyproject.toml and recommend a preset",
        "  --stats             Show usage statistics for current project",
        "  --export-stats      Export usage statistics to JSON",
        "  --reset-stats       Clear all usage analytics data",
        "  --list-presets      List all available presets with descriptions",
        "  --dynamic           Enable dynamic toolset loading (Search+Load pattern from arxiv 2509.20386)",
        "  --embedding         Enable semantic embedding index on the default preset",
        "  --no-toon           Disable TOON encoding (TOON is on by default for ~40% token savings)",
        "  --no-embedding      Disable neural embedding search",
        "  --profile           Enable profiling proxy — logs every tool call with cost/latency",
        "  --admin            Enable admin runtime surfaces (dashboards + watchdog)",
        "  --dashboards       Start local dashboards explicitly",
        "  --watchdog         Start observability watchdog explicitly",
        "  --engine            Start headless API engine server on port 6276",
        "  --engine-secret <s> Require Bearer token for engine API (or set ENGINE_SECRET env var)",
        "  --explain <tool>    Show plain-English explanation of a tool and exit",
        "  --health            Run diagnostic health check and exit",
        "  --status            Show live system pulse (uptime, errors, call rates) and exit",
        "  --diagnose          Run drift detection + auto-heal and exit",
        "  --sync-configs      Write MCP config to Claude Code, Cursor, and Windsurf IDE locations",
        "  --help              Show this help and exit",
        "",
        "Available toolsets:",
        ...ALL_DOMAIN_KEYS.map((k) => `  ${k.padEnd(16)} (lazy-loaded)`),
        "",
        "Presets:",
        ...Object.entries(PRESETS).map(([k, v]) => {
          return `  ${k.padEnd(14)} ${String(v.length).padStart(3)} domains  ${PRESET_DESCRIPTIONS[k] ?? ''}`;
        }),
        "",
        "Examples:",
        "  npx nodebench-mcp                    # Default v3 core workflow surface",
        "  npx nodebench-mcp --preset power     # Extended founder/research surface",
        "  npx nodebench-mcp --preset admin     # Profiling, observability, dashboards",
        "  npx nodebench-mcp --preset web_dev   # Web development (+ vision, SEO, git)",
        "  npx nodebench-mcp --preset research  # Research workflows (+ web, LLM, RSS, email)",
        "  npx nodebench-mcp --preset data      # Data analysis (+ local file parsing, LLM)",
        "  npx nodebench-mcp --preset academic  # Academic writing (+ paper tools, LLM)",
        "  npx nodebench-mcp --preset full      # All available domains",
        "  npx nodebench-mcp --smart-preset     # Get AI-powered preset recommendation",
        "  npx nodebench-mcp --stats            # Show usage statistics",
        "  npx nodebench-mcp --toolsets verification,eval,recon",
        "  npx nodebench-mcp --exclude vision,ui_capture,parallel",
        "",
        "Pro tip: Use findTools and getMethodology at runtime for dynamic tool discovery.",
        "See: https://www.anthropic.com/engineering/code-execution-with-mcp",
      ];
      console.error(lines.join("\n"));
      process.exit(0);
    }

  const presetIdx = cliArgs.indexOf("--preset");
  if (presetIdx !== -1 && cliArgs[presetIdx + 1]) {
    const presetName = cliArgs[presetIdx + 1];
    const presetKeys = PRESETS[presetName];
    if (!presetKeys) {
      console.error(`Unknown preset: ${presetName}. Available: ${Object.keys(PRESETS).join(", ")}`);
      process.exit(1);
    }
    return loadToolsets(presetKeys);
  }

  const tsIdx = cliArgs.indexOf("--toolsets");
  if (tsIdx !== -1 && cliArgs[tsIdx + 1]) {
    const requested = cliArgs[tsIdx + 1].split(",").map((s) => s.trim());
    const invalid = requested.filter((k) => !TOOLSET_LOADERS[k]);
    if (invalid.length) {
      console.error(`Unknown toolsets: ${invalid.join(", ")}. Available: ${ALL_DOMAIN_KEYS.join(", ")}`);
      process.exit(1);
    }
    return loadToolsets(requested);
  }

  const exIdx = cliArgs.indexOf("--exclude");
  if (exIdx !== -1 && cliArgs[exIdx + 1]) {
    const excluded = new Set(cliArgs[exIdx + 1].split(",").map((s) => s.trim()));
    const invalid = [...excluded].filter((k) => !TOOLSET_LOADERS[k]);
    if (invalid.length) {
      console.error(`Unknown toolsets: ${invalid.join(", ")}. Available: ${ALL_DOMAIN_KEYS.join(", ")}`);
      process.exit(1);
    }
    const domainsToLoad = ALL_DOMAIN_KEYS.filter((k) => !excluded.has(k));
    return loadToolsets(domainsToLoad);
  }

   // Default to the v3 core workflow facade
   return loadToolsets(PRESETS.default);
}

// ── Analytics CLI flag handling ─────────────────────────────────────────
// Handle --list-presets
if (listPresetsFlag) {
  await loadToolsets(ALL_DOMAIN_KEYS);
  console.log(JSON.stringify(listRuntimePresets(), null, 2));
  process.exit(0);
}

// ── Analytics CLI handlers (run-and-exit) ───────────────────────────────
if (resetStats || useSmartPreset || showStats || exportStats) {
  const aDb = getAnalyticsDb();
  try {
    if (resetStats) {
      clearOldRecords(aDb, 0);
      console.error("Usage analytics data cleared (tool_usage + cache). Project context and preset history preserved.");
    } else if (useSmartPreset) {
      await loadToolsets(ALL_DOMAIN_KEYS);
      const recommendation = generateSmartPreset(aDb, TOOLSET_MAP);
      console.error(formatPresetRecommendation(recommendation, TOOLSET_MAP));
    } else if (showStats) {
      const summary = getProjectUsageSummary(aDb, process.cwd(), 30);
      if (summary) {
        console.error(formatStatsDisplay(summary, process.cwd()));
      } else {
        console.error("No usage data available for this project in the last 30 days.");
      }
    } else if (exportStats) {
      console.log(exportUsageStats(aDb, process.cwd(), 30));
    }
  } finally {
    closeAnalyticsDb(aDb);
  }
  process.exit(0);
}

// ── Explain CLI handler (run-and-exit) ────────────────────────────────
const explainIdx = cliArgs.indexOf("--explain");
if (explainIdx !== -1) {
  const toolName = cliArgs[explainIdx + 1];
  const USE_COLOR = process.stdout.isTTY;
  const B = USE_COLOR ? "\x1b[1m" : "";
  const C = USE_COLOR ? "\x1b[36m" : "";
  const G = USE_COLOR ? "\x1b[32m" : "";
  const Y = USE_COLOR ? "\x1b[33m" : "";
  const D = USE_COLOR ? "\x1b[2m" : "";
  const X = USE_COLOR ? "\x1b[0m" : "";

  if (!toolName || toolName.startsWith("--")) {
    console.error("Usage: nodebench-mcp --explain <tool_name>");
    console.error("Example: nodebench-mcp --explain start_verification_cycle");
    process.exit(1);
  }

  const entry = TOOL_REGISTRY.get(toolName);
  if (!entry) {
    // Fuzzy match: find closest tool names
    const candidates = ALL_REGISTRY_ENTRIES
      .filter(e => e.name.includes(toolName) || toolName.split("_").some(w => e.name.includes(w)))
      .slice(0, 5);
    console.error(`Tool "${toolName}" not found in registry.`);
    if (candidates.length > 0) {
      console.error(`\nDid you mean:`);
      for (const c of candidates) console.error(`  --explain ${c.name}`);
    }
    process.exit(1);
  }

  // Find the actual McpTool for description + inputSchema
  await loadToolsets(ALL_DOMAIN_KEYS);
  const allDomainTools = Object.values(TOOLSET_MAP).flat();
  const mcpTool = allDomainTools.find(t => t.name === toolName);

  const complexity = getToolComplexity(toolName);
  const complexityLabel: Record<string, string> = { low: "Haiku (fast, cheap)", medium: "Sonnet (balanced)", high: "Opus (deep reasoning)" };
  const toolset = TOOL_TO_TOOLSET.get(toolName) ?? "unknown";

  const lines: string[] = [];
  lines.push(`${B}${entry.name}${X}`);
  lines.push("");

  // Thompson-style "what problem does this solve" section
  if (mcpTool?.description) {
    lines.push(`${C}What it does${X}`);
    lines.push(`  ${mcpTool.description}`);
    lines.push("");
  }

  // Category + phase + complexity
  lines.push(`${C}At a glance${X}`);
  lines.push(`  Category:   ${entry.category}`);
  lines.push(`  Phase:      ${entry.phase}`);
  lines.push(`  Toolset:    ${toolset}`);
  lines.push(`  Complexity: ${complexity} — ${complexityLabel[complexity] ?? complexity}`);
  lines.push(`  Tags:       ${entry.tags.join(", ")}`);
  lines.push("");

  // QuickRef — what to do next (the actionable guidance)
  lines.push(`${C}What to do next${X}  ${D}(Thompson: intuition before mechanics)${X}`);
  lines.push(`  ${entry.quickRef.nextAction}`);
  if (entry.quickRef.tip) {
    lines.push(`  ${Y}Tip:${X} ${entry.quickRef.tip}`);
  }
  if (entry.quickRef.methodology) {
    lines.push(`  ${D}Methodology: ${entry.quickRef.methodology}${X}`);
  }
  lines.push("");

  // Next tools — the chain
  if (entry.quickRef.nextTools.length > 0) {
    lines.push(`${C}Commonly used after this${X}`);
    for (const nt of entry.quickRef.nextTools) {
      const ntEntry = TOOL_REGISTRY.get(nt);
      lines.push(`  ${G}→${X} ${nt}${ntEntry ? `  ${D}(${ntEntry.category}, ${ntEntry.phase})${X}` : ""}`);
    }
    lines.push("");
  }

  // Input schema (if available)
  if (mcpTool?.inputSchema?.properties) {
    lines.push(`${C}Parameters${X}`);
    const props = mcpTool.inputSchema.properties as Record<string, any>;
    const required = new Set((mcpTool.inputSchema.required as string[]) ?? []);
    for (const [key, schema] of Object.entries(props)) {
      const req = required.has(key) ? `${Y}*${X}` : " ";
      const type = schema.type ?? "any";
      const desc = schema.description ? `  ${D}${schema.description.slice(0, 80)}${X}` : "";
      lines.push(`  ${req} ${key.padEnd(24)} ${type.padEnd(10)}${desc}`);
    }
    lines.push(`  ${D}(* = required)${X}`);
    lines.push("");
  }

  // Analogy — Thompson protocol
  lines.push(`${C}Think of it like...${X}`);
  const analogies: Record<string, string> = {
    verification: "A pre-flight checklist — you wouldn't fly without checking every system first.",
    eval: "A lab experiment — you set up controlled conditions, run the test, and measure what actually happened.",
    quality_gate: "A bouncer at a club — it checks if your code meets the standards before letting it through.",
    learning: "A journal — you write down what worked and what didn't so you don't repeat mistakes.",
    flywheel: "A spinning wheel that gains momentum — each iteration makes the next one faster and better.",
    recon: "A detective gathering clues — you survey the scene before making any moves.",
    security: "A locksmith checking every door and window — systematic, thorough, nothing left unlocked.",
    boilerplate: "A cookie cutter — it stamps out a proven shape so you can focus on the filling.",
    research_writing: "A research assistant — it helps you find, cite, and structure knowledge.",
    web: "A web browser for your AI — it can fetch pages, search the internet, and extract information.",
    github: "Your Git assistant — it handles PRs, issues, and repo operations without you leaving the terminal.",
    email: "A mailroom worker — it can send, receive, and organize emails programmatically.",
    llm: "A phone that can call other AI models — sometimes you need a specialist for a specific question.",
    vision: "Eyes for your AI — it can look at screenshots, images, and visual content.",
    ui_capture: "A camera pointed at your app — it takes screenshots so you can see what users see.",
    parallel: "A team of workers — instead of one person doing everything, you split the work and do it simultaneously.",
    documentation: "A technical writer — it reads code and produces human-friendly explanations.",
    agent_bootstrap: "A setup wizard — it configures a new agent with everything it needs to start working.",
    self_eval: "A mirror — the agent looks at its own work and grades it honestly.",
    platform: "A Swiss Army knife for your OS — file operations, system info, environment checks.",
    skill_update: "A teacher's gradebook — it tracks which skills are fresh and which need a refresher.",
    local_file: "A file parser — it can read PDFs, spreadsheets, images, and documents without external services.",
    seo: "A search engine consultant — it checks how visible and crawlable your site is.",
    rss: "A news aggregator — it monitors feeds and brings you the latest updates.",
    thompson_protocol: "A writing coach — it makes sure your content is clear, uses analogies, and never talks down to the reader.",
  };
  const analogy = analogies[entry.category] ?? `A specialized tool in the ${entry.category} category — it does one thing well so you can focus on the bigger picture.`;
  lines.push(`  ${analogy}`);

  console.log(lines.join("\n"));
  process.exit(0);
}

// ── Auto-preset detection (run-and-exit) ──────────────────────────────
if (autoPresetFlag) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const cwd = process.cwd();
  const USE_COLOR = process.stderr.isTTY;
  const B = USE_COLOR ? "\x1b[1m" : "";
  const C = USE_COLOR ? "\x1b[36m" : "";
  const X = USE_COLOR ? "\x1b[0m" : "";

  const signals: string[] = [];
  let recommended = "default";

  // Check package.json
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const depNames = Object.keys(allDeps);

      // Web frameworks
      const webSignals = ["react", "vue", "svelte", "next", "nuxt", "angular", "@angular/core", "vite", "webpack", "gatsby", "remix", "astro"];
      const webHits = depNames.filter(d => webSignals.includes(d));
      if (webHits.length > 0) { signals.push(`web: ${webHits.join(", ")}`); recommended = "web_dev"; }

      // Mobile
      const mobileSignals = ["react-native", "expo", "@capacitor/core", "ionic", "@ionic/react", "@ionic/vue", "nativescript"];
      const mobileHits = depNames.filter(d => mobileSignals.includes(d));
      if (mobileHits.length > 0) { signals.push(`mobile: ${mobileHits.join(", ")}`); recommended = "mobile"; }

      // Data/ML
      const dataSignals = ["@tensorflow/tfjs", "onnxruntime-node", "ml5", "brain.js", "d3", "chart.js", "recharts", "plotly.js"];
      const dataHits = depNames.filter(d => dataSignals.includes(d));
      if (dataHits.length > 0) { signals.push(`data: ${dataHits.join(", ")}`); recommended = "data"; }

      // DevOps
      const devopsSignals = ["aws-sdk", "@aws-sdk/client-s3", "docker-compose", "pulumi", "@pulumi/aws", "serverless"];
      const devopsHits = depNames.filter(d => devopsSignals.includes(d));
      if (devopsHits.length > 0) { signals.push(`devops: ${devopsHits.join(", ")}`); recommended = "devops"; }

      // Research / content
      const researchSignals = ["@anthropic-ai/sdk", "openai", "langchain", "@langchain/core", "llamaindex"];
      const researchHits = depNames.filter(d => researchSignals.includes(d));
      if (researchHits.length > 0) { signals.push(`research/AI: ${researchHits.join(", ")}`); recommended = "research"; }

      // Multi-agent
      const agentSignals = ["@modelcontextprotocol/sdk", "autogen", "crewai"];
      const agentHits = depNames.filter(d => agentSignals.includes(d));
      if (agentHits.length > 0) { signals.push(`multi-agent: ${agentHits.join(", ")}`); recommended = "multi_agent"; }

      // Content
      const contentSignals = ["marked", "remark", "rehype", "contentful", "sanity", "@sanity/client", "strapi"];
      const contentHits = depNames.filter(d => contentSignals.includes(d));
      if (contentHits.length > 0 && !webHits.length) { signals.push(`content: ${contentHits.join(", ")}`); recommended = "content"; }

    } catch { /* malformed package.json */ }
  }

  // Check pyproject.toml
  const pyPath = path.join(cwd, "pyproject.toml");
  if (fs.existsSync(pyPath)) {
    try {
      const content = fs.readFileSync(pyPath, "utf-8");
      if (/torch|tensorflow|scikit|pandas|numpy|scipy/i.test(content)) {
        signals.push("python: ML/data libraries detected");
        recommended = "data";
      } else if (/fastapi|flask|django/i.test(content)) {
        signals.push("python: web framework detected");
        recommended = "web_dev";
      } else if (/langchain|openai|anthropic/i.test(content)) {
        signals.push("python: AI/research libraries detected");
        recommended = "research";
      }
    } catch { /* malformed */ }
  }

  // Check for academic markers
  const hasLatex = fs.existsSync(path.join(cwd, "main.tex")) || fs.existsSync(path.join(cwd, "paper.tex"));
  if (hasLatex) { signals.push("academic: LaTeX files found"); recommended = "academic"; }

  // Output — only load the recommended preset to keep auto-preset fast
  const presetToolsets = (PRESETS as Record<string, string[]>)[recommended];
  if (presetToolsets) {
    await loadToolsets(presetToolsets);
  }
  const toolCount = presetToolsets
    ? presetToolsets.reduce((s: number, k: string) => s + (TOOLSET_MAP[k]?.length ?? 0), 0) + 12
    : 0;

  console.error(`${B}Auto-Preset Detection${X}  (${cwd})`);
  console.error("");
  if (signals.length > 0) {
    console.error(`${C}Signals${X}`);
    for (const s of signals) console.error(`  - ${s}`);
    console.error("");
  }
  console.error(`${B}Recommended:${X}  --preset ${recommended}  (${toolCount} tools)`);
  if (signals.length === 0) {
    console.error("  No project markers found — using default preset.");
  }
  console.error("");
  console.error(`Run: npx nodebench-mcp --preset ${recommended}`);

  // Also output just the preset name to stdout (composable)
  console.log(recommended);
  process.exit(0);
}

// ── Health CLI handler (run-and-exit) ─────────────────────────────────
if (healthFlag) {
  const USE_COLOR = process.stdout.isTTY;
  const G = USE_COLOR ? "\x1b[32m" : "";
  const R = USE_COLOR ? "\x1b[31m" : "";
  const Y = USE_COLOR ? "\x1b[33m" : "";
  const C = USE_COLOR ? "\x1b[36m" : "";
  const B = USE_COLOR ? "\x1b[1m" : "";
  const X = USE_COLOR ? "\x1b[0m" : "";
  const ok = `${G}OK${X}`;
  const warn = `${Y}WARN${X}`;
  const fail = `${R}FAIL${X}`;

  const lines: string[] = [];
  lines.push(`${B}${DISPLAY_NAME} v${NODEBENCH_VERSION} - Health Check${X}`);
  lines.push("");

  // 1. Tool count + preset - load only the active preset for a fast health path
  const activePreset = requestedPreset;
  const presetToolsets = (PRESETS as Record<string, string[]>)[activePreset];
  const activeDomainSet = new Set(presetToolsets ?? []);
  if (presetToolsets) {
    await loadToolsets(presetToolsets);
  }
  const presetToolCount = presetToolsets
    ? presetToolsets.reduce((s: number, k: string) => s + (TOOLSET_MAP[k]?.length ?? 0), 0)
      + (isWorkflowFacadePreset(activePreset) ? 2 : 12)
    : 12;
  lines.push(`${C}Tools${X}       ${presetToolCount} visible (preset: ${activePreset}) | ${ALL_DOMAIN_KEYS.length} domains available`);

  // 2. TOON + Embedding
  lines.push(`${C}TOON${X}        ${useToon ? ok : `${warn} disabled (--no-toon)`}`);
  lines.push(`${C}Embedding${X}   ${useEmbedding ? ok : `${warn} disabled on default hot path`}`);
  lines.push(
    `${C}Runtime${X}     ${
      runtimeFlags.enableDashboards || runtimeFlags.enableWatchdog
        ? `${ok} admin surfaces enabled`
        : `${warn} core-only (pass --admin, --dashboards, or --watchdog to enable admin runtime)`
    }`,
  );

  // 3. Database
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const dbDir = path.join(os.homedir(), ".nodebench");
  const dbPath = path.join(dbDir, "nodebench.db");
  const { createRequire } = await import("node:module");
  const _require = createRequire(import.meta.url);
  const _isInstalled = (pkg: string) => { try { _require.resolve(pkg); return true; } catch { return false; } };
  const sqliteInstalled = _isInstalled("better-sqlite3");
  const dbExists = fs.existsSync(dbPath);
  let dbSize = "";
  if (dbExists) {
    const stat = fs.statSync(dbPath);
    dbSize = ` (${(stat.size / 1024).toFixed(0)} KB)`;
  }
  lines.push(
    `${C}Database${X}    ${
      sqliteInstalled
        ? (dbExists ? `${ok}${dbSize}` : `${warn} not initialized (will create on first run)`)
        : `${warn} lightweight mode (native SQLite addon not installed)`
    }`,
  );

  // 4. Analytics DB
  const analyticsPath = path.join(dbDir, "analytics.db");
  const analyticsExists = fs.existsSync(analyticsPath);
  lines.push(
    `${C}Analytics${X}   ${
      sqliteInstalled
        ? (analyticsExists ? ok : `${warn} no usage data yet`)
        : `${warn} ephemeral analytics mode`
    }`,
  );

  // 5. Embedding cache
  const cachePath = path.join(dbDir, "embedding_cache.json");
  const cacheExists = fs.existsSync(cachePath);
  let cacheInfo = "";
  if (cacheExists) {
    const stat = fs.statSync(cachePath);
    cacheInfo = ` (${(stat.size / 1024).toFixed(0)} KB)`;
  }
  lines.push(`${C}Emb Cache${X}  ${cacheExists ? `${ok}${cacheInfo}` : `${warn} not built yet`}`);

  // 6. Environment variables
  lines.push("");
  lines.push(`${B}Environment${X}`);
  const envChecks: [string, string, string][] = [
    ["ANTHROPIC_API_KEY", "Claude LLM tools", "llm"],
    ["OPENAI_API_KEY", "OpenAI + embeddings", "llm"],
    ["GEMINI_API_KEY", "Gemini + embeddings", "llm"],
    ["GITHUB_TOKEN", "GitHub tools", "github"],
    ["BROWSERBASE_API_KEY", "Web scraping", "web"],
    ["FIRECRAWL_API_KEY", "Web crawling", "web"],
    ["SMTP_HOST", "Email sending", "email"],
    ["IMAP_HOST", "Email reading", "email"],
  ];
  for (const [key, desc, _domain] of envChecks) {
    const set = !!process.env[key];
    const val = set ? process.env[key]!.slice(0, 4) + "..." : "";
    lines.push(`  ${set ? ok : `${Y}--${X}`}  ${key.padEnd(22)} ${desc}${set ? ` ${C}${val}${X}` : ""}`);
  }

  // 7. Optional npm packages
  const packageCheckSpecs: Array<{ pkg: string; desc: string; show: boolean }> = [
    {
      pkg: "playwright",
      desc: "UI capture + screenshots",
      show:
        activeDomainSet.has("ui_capture")
        || activeDomainSet.has("qa_orchestration")
        || activeDomainSet.has("dogfood_judge"),
    },
    {
      pkg: "sharp",
      desc: "Image processing",
      show:
        activeDomainSet.has("ui_capture")
        || activeDomainSet.has("vision")
        || activeDomainSet.has("qa_orchestration")
        || activeDomainSet.has("dogfood_judge"),
    },
    {
      pkg: "@huggingface/transformers",
      desc: "Local embeddings (384-dim)",
      show: useEmbedding,
    },
    {
      pkg: "tesseract.js",
      desc: "OCR text extraction",
      show: activeDomainSet.has("local_file") || activeDomainSet.has("vision"),
    },
    {
      pkg: "pdf-parse",
      desc: "PDF parsing",
      show: activeDomainSet.has("local_file"),
    },
    {
      pkg: "mammoth",
      desc: "DOCX parsing",
      show: activeDomainSet.has("local_file"),
    },
    {
      pkg: "read-excel-file",
      desc: "Spreadsheet parsing",
      show: activeDomainSet.has("local_file"),
    },
  ];
  const pkgChecks = packageCheckSpecs
    .filter((spec) => spec.show)
    .map((spec) => [spec.pkg, spec.desc] as [string, string]);
  if (pkgChecks.length > 0) {
    lines.push("");
    lines.push(`${B}Optional Packages${X}`);
    for (const [pkg, desc] of pkgChecks) {
      const installed = _isInstalled(pkg);
      lines.push(`  ${installed ? ok : `${Y}--${X}`}  ${pkg.padEnd(30)} ${desc}`);
    }
  }

  // 8. Python servers
  const serverChecks: Array<[string, number]> = [
    ...(activeDomainSet.has("flicker_detection") ? [["Flicker Detection", 8006] as [string, number]] : []),
    ...(activeDomainSet.has("figma_flow") ? [["Figma Flow", 8007] as [string, number]] : []),
  ];
  if (serverChecks.length > 0) {
    lines.push("");
    lines.push(`${B}Python Servers${X}`);
    for (const [name, port] of serverChecks) {
      let reachable = false;
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
        reachable = resp.ok;
      } catch { /* not running */ }
      lines.push(`  ${reachable ? ok : `${Y}--${X}`}  ${name.padEnd(22)} :${port}${reachable ? "" : " (not running)"}`);
    }
  }

  // 9. Version check (npm registry)
  lines.push("");
  lines.push(`${B}Version${X}`);
  const currentVersion = NODEBENCH_VERSION;

  let latestVersion = "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://registry.npmjs.org/${NODEBENCH_PACKAGE_NAME}/latest`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      latestVersion = (data.version as string) || "";
    }
  } catch { /* offline or timeout */ }

  const versionDelta = latestVersion ? comparePackageVersions(latestVersion, currentVersion) : 0;
  if (latestVersion && versionDelta > 0) {
    lines.push(`  ${Y}UPDATE${X}  ${currentVersion} → ${G}${latestVersion}${X}`);
    lines.push(`          Run: ${C}npm install -g ${NODEBENCH_PACKAGE_NAME}@latest${X}`);
  } else if (latestVersion && versionDelta === 0) {
    lines.push(`  ${ok}  v${currentVersion} (up to date)`);
  } else if (latestVersion) {
    lines.push(`  ${ok}  v${currentVersion} (ahead of npm latest v${latestVersion})`);
  } else {
    lines.push(`  ${ok}  v${currentVersion} (registry check skipped — offline?)`);
  }

  // Summary
  lines.push("");
  const allEnvSet = envChecks.filter(([k]) => !!process.env[k]).length;
  const allPkgSet = pkgChecks.filter(([p]) => _isInstalled(p)).length;
  const packageSummary = pkgChecks.length > 0
    ? `${allPkgSet}/${pkgChecks.length} packages`
    : "no preset-specific package deps";
  const dbSummary = sqliteInstalled ? (dbExists ? "DB ready" : "DB pending") : "lightweight DB mode";
  lines.push(`${B}Summary${X}  ${allEnvSet}/${envChecks.length} env vars | ${packageSummary} | ${dbSummary}`);

  console.log(lines.join("\n"));
  process.exit(0);
}

// ── Status CLI handler (run-and-exit) ─────────────────────────────────
if (statusFlag) {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const USE_COLOR = process.stdout.isTTY;
  const B = USE_COLOR ? "\x1b[1m" : "";
  const C = USE_COLOR ? "\x1b[36m" : "";
  const G = USE_COLOR ? "\x1b[32m" : "";
  const Y = USE_COLOR ? "\x1b[33m" : "";
  const R = USE_COLOR ? "\x1b[31m" : "";
  const X = USE_COLOR ? "\x1b[0m" : "";

  const dir = path.join(os.homedir(), ".nodebench");
  const dbPath = path.join(dir, "nodebench.db");

  if (!fs.existsSync(dbPath)) {
    console.error("No database found. Run the MCP server first to initialize.");
    process.exit(1);
  }

  // Open DB directly for status query
  const db = await openOptionalSqlite(dbPath, { readonly: true });
  if (!db) {
    console.error("SQLite inspection backend is unavailable in this lightweight install.");
    process.exit(1);
  }

  const lines: string[] = [];
  lines.push(`${B}${DISPLAY_NAME} - System Status${X}`);
  lines.push("");

  // Uptime info from DB (last tool call as proxy for when server was active)
  try {
    const recent = db.prepare(`SELECT COUNT(*) as cnt FROM tool_call_log WHERE created_at > datetime('now', '-1 hour')`).get() as any;
    const today = db.prepare(`SELECT COUNT(*) as cnt FROM tool_call_log WHERE created_at > datetime('now', '-24 hours')`).get() as any;
    const week = db.prepare(`SELECT COUNT(*) as cnt FROM tool_call_log WHERE created_at > datetime('now', '-7 days')`).get() as any;
    const errors1h = db.prepare(`SELECT COUNT(*) as cnt FROM tool_call_log WHERE result_status = 'error' AND created_at > datetime('now', '-1 hour')`).get() as any;
    const errors24h = db.prepare(`SELECT COUNT(*) as cnt FROM tool_call_log WHERE result_status = 'error' AND created_at > datetime('now', '-24 hours')`).get() as any;

    lines.push(`${C}Call Volume${X}`);
    lines.push(`  Last 1h:   ${recent.cnt} calls  (${errors1h.cnt} errors)`);
    lines.push(`  Last 24h:  ${today.cnt} calls  (${errors24h.cnt} errors)`);
    lines.push(`  Last 7d:   ${week.cnt} calls`);

    const rate1h = recent.cnt > 0 ? ((recent.cnt - errors1h.cnt) / recent.cnt * 100).toFixed(1) : "N/A";
    const rate24h = today.cnt > 0 ? ((today.cnt - errors24h.cnt) / today.cnt * 100).toFixed(1) : "N/A";
    lines.push(`  Success:   ${rate1h}% (1h) / ${rate24h}% (24h)`);
    lines.push("");

    // Top 5 tools
    const topTools = db.prepare(
      `SELECT tool_name, COUNT(*) as calls, SUM(CASE WHEN result_status='error' THEN 1 ELSE 0 END) as errs, ROUND(AVG(duration_ms)) as avg_ms
       FROM tool_call_log WHERE created_at > datetime('now', '-24 hours')
       GROUP BY tool_name ORDER BY calls DESC LIMIT 5`
    ).all() as any[];

    if (topTools.length > 0) {
      lines.push(`${C}Top Tools (24h)${X}`);
      for (const t of topTools) {
        const errTag = t.errs > 0 ? `  ${R}${t.errs} err${X}` : "";
        lines.push(`  ${t.calls.toString().padStart(4)} ${t.tool_name.padEnd(30)} ${t.avg_ms}ms avg${errTag}`);
      }
      lines.push("");
    }

    // Error trend
    const errPrevHour = db.prepare(
      `SELECT COUNT(*) as cnt FROM tool_call_log WHERE result_status='error' AND created_at > datetime('now', '-2 hours') AND created_at <= datetime('now', '-1 hour')`
    ).get() as any;
    const direction = errors1h.cnt > errPrevHour.cnt ? `${R}increasing${X}` : errors1h.cnt < errPrevHour.cnt ? `${G}decreasing${X}` : `${G}stable${X}`;
    lines.push(`${C}Error Trend${X}  ${direction} (${errPrevHour.cnt} prev hour -> ${errors1h.cnt} this hour)`);

    // Active verification cycles
    const activeCycles = db.prepare(`SELECT COUNT(*) as cnt FROM verification_cycles WHERE status IN ('active', 'in_progress')`).get() as any;
    if (activeCycles.cnt > 0) {
      lines.push(`${C}Active Cycles${X}  ${Y}${activeCycles.cnt} verification cycle(s) in progress${X}`);
    }
  } catch (e: any) {
    lines.push(`${R}Error querying DB: ${e.message}${X}`);
  }

  db.close();
  console.log(lines.join("\n"));
  process.exit(0);
}

// ── Diagnose CLI handler (run-and-exit) ───────────────────────────────
if (diagnoseFlag) {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const USE_COLOR = process.stdout.isTTY;
  const B = USE_COLOR ? "\x1b[1m" : "";
  const C = USE_COLOR ? "\x1b[36m" : "";
  const G = USE_COLOR ? "\x1b[32m" : "";
  const Y = USE_COLOR ? "\x1b[33m" : "";
  const R = USE_COLOR ? "\x1b[31m" : "";
  const X = USE_COLOR ? "\x1b[0m" : "";

  const dir = path.join(os.homedir(), ".nodebench");
  const dbPath = path.join(dir, "nodebench.db");

  if (!fs.existsSync(dbPath)) {
    console.error("No database found. Run the MCP server first to initialize.");
    process.exit(1);
  }

  const db = await openOptionalSqlite(dbPath);
  if (!db) {
    console.error("SQLite repair backend is unavailable in this lightweight install.");
    process.exit(1);
  }

  const lines: string[] = [];
  lines.push(`${B}${DISPLAY_NAME} - Diagnose & Heal${X}`);
  lines.push("");

  let issueCount = 0;
  let healedCount = 0;

  // 1. Orphaned verification cycles
  try {
    const orphanedCount = (db.prepare(
      `SELECT COUNT(*) as cnt FROM verification_cycles WHERE status IN ('active', 'in_progress') AND created_at < datetime('now', '-48 hours')`
    ).get() as any).cnt;
    if (orphanedCount > 0) {
      lines.push(`${Y}DRIFT${X}  ${orphanedCount} orphaned verification cycle(s) (>48h old)`);
      const result = db.prepare(
        `UPDATE verification_cycles SET status = 'abandoned', updated_at = datetime('now') WHERE status IN ('active', 'in_progress') AND created_at < datetime('now', '-48 hours')`
      ).run();
      lines.push(`  ${G}HEALED${X}  Abandoned ${result.changes} cycles in batch`);
      healedCount += result.changes;
      issueCount += orphanedCount;
    } else {
      lines.push(`${G}OK${X}     No orphaned verification cycles`);
    }
  } catch { lines.push(`${Y}SKIP${X}   Could not check verification cycles`); }

  // 2. Stale eval runs
  try {
    const staleCount = (db.prepare(
      `SELECT COUNT(*) as cnt FROM eval_runs WHERE status IN ('running', 'pending') AND created_at < datetime('now', '-24 hours')`
    ).get() as any).cnt;
    if (staleCount > 0) {
      lines.push(`${Y}DRIFT${X}  ${staleCount} stale eval run(s) (>24h old)`);
      const result = db.prepare(
        `UPDATE eval_runs SET status = 'failed', completed_at = datetime('now') WHERE status IN ('running', 'pending') AND created_at < datetime('now', '-24 hours')`
      ).run();
      lines.push(`  ${G}HEALED${X}  Marked ${result.changes} eval runs as failed`);
      healedCount += result.changes;
      issueCount += staleCount;
    } else {
      lines.push(`${G}OK${X}     No stale eval runs`);
    }
  } catch { lines.push(`${Y}SKIP${X}   Could not check eval runs`); }

  // 3. DB size
  const dbInfo = fs.statSync(dbPath);
  const dbSizeMb = dbInfo.size / (1024 * 1024);
  if (dbSizeMb > 500) {
    lines.push(`${Y}DRIFT${X}  Database is ${dbSizeMb.toFixed(1)} MB`);
    try {
      const cutoff = new Date(Date.now() - 90 * 24 * 3_600_000).toISOString();
      const deleted = db.prepare(`DELETE FROM tool_call_log WHERE created_at < ?`).run(cutoff);
      if (deleted.changes > 0) {
        lines.push(`  ${G}HEALED${X}  Pruned ${deleted.changes} tool_call_log entries older than 90 days`);
        healedCount++;
      }
      db.pragma("wal_checkpoint(TRUNCATE)");
      lines.push(`  ${G}HEALED${X}  Ran WAL checkpoint`);
      healedCount++;
    } catch { /* skip */ }
    issueCount++;
  } else {
    lines.push(`${G}OK${X}     Database size: ${dbSizeMb.toFixed(1)} MB`);
  }

  // 4. Error rate
  try {
    const calls1h = (db.prepare(`SELECT COUNT(*) as cnt FROM tool_call_log WHERE created_at > datetime('now', '-1 hour')`).get() as any).cnt;
    const errors1h = (db.prepare(`SELECT COUNT(*) as cnt FROM tool_call_log WHERE result_status='error' AND created_at > datetime('now', '-1 hour')`).get() as any).cnt;
    const rate = calls1h > 0 ? (errors1h / calls1h * 100) : 0;
    if (rate > 20 && calls1h > 5) {
      lines.push(`${R}ALERT${X}  Error rate ${rate.toFixed(1)}% in last hour (${errors1h}/${calls1h})`);
      issueCount++;
    } else {
      lines.push(`${G}OK${X}     Error rate: ${rate.toFixed(1)}% (${errors1h}/${calls1h} in last hour)`);
    }
  } catch { lines.push(`${Y}SKIP${X}   Could not check error rates`); }

  // 5. Embedding cache
  const cachePath = path.join(dir, "embedding_cache.json");
  if (fs.existsSync(cachePath)) {
    const cacheAge = Math.round((Date.now() - fs.statSync(cachePath).mtimeMs) / 3_600_000);
    if (cacheAge > 168) {
      lines.push(`${Y}DRIFT${X}  Embedding cache is ${cacheAge}h old (>7 days) — will refresh on next server start`);
      issueCount++;
    } else {
      lines.push(`${G}OK${X}     Embedding cache: ${cacheAge}h old`);
    }
  } else {
    lines.push(`${Y}INFO${X}   No embedding cache found (will build on first server start)`);
  }

  // Summary
  lines.push("");
  if (issueCount === 0) {
    lines.push(`${G}${B}All clear${X} — no drift detected`);
  } else {
    lines.push(`${B}Found ${issueCount} issue(s), healed ${healedCount}${X}`);
    const remaining = issueCount - healedCount;
    if (remaining > 0) lines.push(`${Y}${remaining} issue(s) require manual attention${X}`);
  }

  db.close();
  console.log(lines.join("\n"));
  process.exit(0);
}

// ── Sync Configs CLI handler (run-and-exit) ─────────────────────────────
if (syncConfigsFlag) {
  const os = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const USE_COLOR = process.stdout.isTTY;
  const B = USE_COLOR ? "\x1b[1m" : "";
  const C = USE_COLOR ? "\x1b[36m" : "";
  const G = USE_COLOR ? "\x1b[32m" : "";
  const Y = USE_COLOR ? "\x1b[33m" : "";
  const X = USE_COLOR ? "\x1b[0m" : "";

  // Detect the nodebench-mcp entry point path
  const entryPath = path.resolve(
    new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1") // fix Windows drive letter
  );

  // Build args array from current CLI flags (exclude --sync-configs and other run-and-exit flags)
  const forwardArgs: string[] = [];
  const skipNext = new Set(["--preset", "--toolsets", "--exclude", "--engine-secret"]);
  const runAndExitFlags = new Set([
    "--sync-configs", "--health", "--status", "--diagnose", "--stats",
    "--export-stats", "--reset-stats", "--list-presets", "--smart-preset",
    "--auto-preset", "--help",
  ]);
  for (let i = 0; i < cliArgs.length; i++) {
    if (runAndExitFlags.has(cliArgs[i])) continue;
    if (cliArgs[i].startsWith("--explain")) continue;
    if (skipNext.has(cliArgs[i])) {
      forwardArgs.push(cliArgs[i], cliArgs[i + 1] ?? "");
      i++; // skip the value
      continue;
    }
    forwardArgs.push(cliArgs[i]);
  }

  // Collect env vars that are currently set
  const ENV_KEYS = [
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY",
    "GITHUB_TOKEN", "BROWSERBASE_API_KEY", "FIRECRAWL_API_KEY",
    "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS",
    "IMAP_HOST", "IMAP_PORT", "IMAP_USER", "IMAP_PASS",
    "ENGINE_SECRET",
  ];
  const envObj: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    if (process.env[key]) envObj[key] = process.env[key]!;
  }

  // Build the MCP server config entry. Wrapper packages can override this so
  // sync-configs writes the public lane command instead of an internal entry path.
  const nodePath = process.execPath; // path to node binary
  const configCommandOverride = process.env.NODEBENCH_CONFIG_COMMAND_OVERRIDE?.trim();
  let configArgsOverride: string[] | undefined;
  const rawConfigArgsOverride = process.env.NODEBENCH_CONFIG_ARGS_OVERRIDE;
  if (rawConfigArgsOverride) {
    try {
      const parsed = JSON.parse(rawConfigArgsOverride);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        configArgsOverride = parsed;
      }
    } catch {
      // Ignore invalid override payloads and fall back to the local entry path.
    }
  }

  const serverEntry: Record<string, unknown> = {
    command: configCommandOverride || nodePath,
    args: configArgsOverride ?? [entryPath, ...forwardArgs],
    ...(Object.keys(envObj).length > 0 ? { env: envObj } : {}),
  };

  // Helper: merge into existing config file (preserves other servers)
  function mergeConfig(filePath: string, serverKey: string): { action: string; path: string } {
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(filePath)) {
      try {
        existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch {
        // If file exists but is invalid JSON, back it up and start fresh
        const backupPath = filePath + ".bak";
        fs.copyFileSync(filePath, backupPath);
        existing = {};
      }
    }

    // Ensure mcpServers key exists
    if (!existing.mcpServers || typeof existing.mcpServers !== "object") {
      existing.mcpServers = {};
    }

    const servers = existing.mcpServers as Record<string, unknown>;
    const hadExisting = !!servers[serverKey];
    servers[serverKey] = serverEntry;

    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
    return { action: hadExisting ? "updated" : "created", path: filePath };
  }

  const lines: string[] = [];
  lines.push(`${B}${DISPLAY_NAME} - Sync IDE Configs${X}`);
  lines.push("");

  const results: { name: string; action: string; path: string; error?: string }[] = [];

  // 1. Claude Code: ~/.claude/claude_desktop_config.json
  try {
    const claudeConfigPath = path.join(os.homedir(), ".claude", "claude_desktop_config.json");
    const r = mergeConfig(claudeConfigPath, SERVER_KEY);
    results.push({ name: "Claude Code", ...r });
  } catch (e: any) {
    results.push({ name: "Claude Code", action: "failed", path: "", error: e.message });
  }

  // 2. Cursor: <project>/.cursor/mcp.json
  try {
    const cursorConfigPath = path.join(process.cwd(), ".cursor", "mcp.json");
    const r = mergeConfig(cursorConfigPath, SERVER_KEY);
    results.push({ name: "Cursor", ...r });
  } catch (e: any) {
    results.push({ name: "Cursor", action: "failed", path: "", error: e.message });
  }

  // 3. Windsurf: <project>/.windsurf/mcp.json
  try {
    const windsurfConfigPath = path.join(process.cwd(), ".windsurf", "mcp.json");
    const r = mergeConfig(windsurfConfigPath, SERVER_KEY);
    results.push({ name: "Windsurf", ...r });
  } catch (e: any) {
    results.push({ name: "Windsurf", action: "failed", path: "", error: e.message });
  }

  // Print results
  for (const r of results) {
    if (r.action === "failed") {
      lines.push(`${Y}FAIL${X}  ${r.name}: ${r.error}`);
    } else {
      const icon = r.action === "created" ? `${G}NEW${X} ` : `${G}UPD${X} `;
      lines.push(`${icon} ${r.name}: ${r.path}`);
    }
  }

  // Print config summary
  lines.push("");
  lines.push(`${C}Config entry:${X}`);
  lines.push(`  command: ${String(serverEntry.command)}`);
  lines.push(`  args:    [${((serverEntry.args as string[]) ?? []).map(a => `"${a}"`).join(", ")}]`);
  if (Object.keys(envObj).length > 0) {
    lines.push(`  env:     ${Object.keys(envObj).join(", ")}`);
  } else {
    lines.push(`  env:     ${Y}(none set)${X}`);
  }

  // ── Copy rules to ~/.claude/rules/ ──────────────────────────────────
  lines.push("");
  lines.push(`${B}Rules${X}`);
  const claudeRulesDir = path.join(os.homedir(), ".claude", "rules");
  if (!fs.existsSync(claudeRulesDir)) {
    fs.mkdirSync(claudeRulesDir, { recursive: true });
  }

  // Find rules directory relative to this file
  const thisDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
  const rulesSearchPaths = [
    path.resolve(thisDir, "..", "rules"),         // dist/../rules (installed package)
    path.resolve(thisDir, "..", "..", "rules"),    // src/../../rules (dev mode)
  ];

  let rulesDir = "";
  for (const p of rulesSearchPaths) {
    if (fs.existsSync(p)) { rulesDir = p; break; }
  }

  let rulesInstalled = 0;
  if (rulesDir) {
    const ruleFiles = fs.readdirSync(rulesDir).filter((f: string) => f.startsWith("nodebench-") && f.endsWith(".md"));
    for (const file of ruleFiles) {
      const src = path.join(rulesDir, file);
      const dest = path.join(claudeRulesDir, file);
      // Don't overwrite if user's version is newer
      if (fs.existsSync(dest)) {
        const srcStat = fs.statSync(src);
        const destStat = fs.statSync(dest);
        if (destStat.mtimeMs > srcStat.mtimeMs) {
          lines.push(`  ${Y}SKIP${X} ${file} (user version is newer)`);
          continue;
        }
      }
      fs.copyFileSync(src, dest);
      rulesInstalled++;
    }
    lines.push(`  ${G}OK${X}   Installed ${rulesInstalled} rules to ${claudeRulesDir}`);
  } else {
    lines.push(`  ${Y}WARN${X} Rules directory not found — rules not copied`);
  }

  lines.push("");
  const successCount = results.filter(r => r.action !== "failed").length;
  lines.push(`${B}Written to ${successCount}/${results.length} IDE configs | ${rulesInstalled} rules installed${X}`);

  console.log(lines.join("\n"));
  process.exit(0);
}

// ── CLI subcommand detection ──────────────────────────────────────────
// First positional arg (not starting with --) is a subcommand
const subCmd = cliArgs.find(a => !a.startsWith("--") && !cliArgs.some((f, i) => f.startsWith("--") && cliArgs[i + 1] === a));

// CLI subcommands and the welcome screen need TOOLSET_MAP populated for tool counts / listing.
// Load all domains eagerly — these paths exit after running anyway.
const isCliMode = subCmd !== undefined || cliArgs.length === 0 || (!cliArgs.includes("--stdio") && !cliArgs.some(a => a.startsWith("--")));
if (isCliMode) {
  await loadToolsets(ALL_DOMAIN_KEYS);
}

// ── Welcome screen (no arguments at all) ─────────────────────────────
if (cliArgs.length === 0 || (subCmd === undefined && !cliArgs.includes("--stdio") && !cliArgs.some(a => a.startsWith("--")))) {
  const USE_COLOR = process.stdout.isTTY;
  const B = USE_COLOR ? "\x1b[1m" : "";
  const C = USE_COLOR ? "\x1b[36m" : "";
  const G = USE_COLOR ? "\x1b[32m" : "";
  const D = USE_COLOR ? "\x1b[2m" : "";
  const Y = USE_COLOR ? "\x1b[33m" : "";
  const X = USE_COLOR ? "\x1b[0m" : "";

  const totalTools = Object.values(TOOLSET_MAP).reduce((s, v) => s + v.length, 0) + 12;
  const domainCount = Object.keys(TOOLSET_MAP).length;

  const welcome = [
    "",
    `  ${B}NodeBench AI${X} ${D}— The trust layer for agents${X}`,
    "",
    `  ${C}Quick start${X}`,
    `    ${G}$${X} npx nodebench-mcp discover              ${D}Show available tools${X}`,
    `    ${G}$${X} npx nodebench-mcp demo                   ${D}Run a live demo (no keys needed)${X}`,
    `    ${G}$${X} npx nodebench-mcp quickref research       ${D}Get research workflow guide${X}`,
    `    ${G}$${X} npx nodebench-mcp --explain run_recon     ${D}Deep-dive on any tool${X}`,
    "",
    `  ${C}Connect to your IDE${X}`,
    `    ${G}$${X} claude mcp add nodebench -- npx nodebench-mcp --stdio`,
    `    ${G}$${X} npx nodebench-mcp --sync-configs          ${D}Auto-write to Claude/Cursor/Windsurf${X}`,
    "",
    `  ${C}Start the MCP server${X}`,
    `    ${G}$${X} npx nodebench-mcp --stdio                 ${D}Default preset${X}`,
    `    ${G}$${X} npx nodebench-mcp --preset research       ${D}Research workflows${X}`,
    `    ${G}$${X} npx nodebench-mcp --auto-preset           ${D}Detect from your project${X}`,
    "",
    `  ${Y}${totalTools} tools${X} ${D}·${X} ${Y}${domainCount} domains${X} ${D}· Progressive discovery · Agent-as-a-Graph${X}`,
    "",
  ];
  console.log(welcome.join("\n"));
  process.exit(0);
}

// ── Delta subcommands (run-and-exit, banking-convention verbs) ────────
const DELTA_VERBS = ["brief", "diligence", "handoff", "watch", "memo", "scan", "compare", "review", "retain", "packets", "dogfood"] as const;
if (subCmd && (DELTA_VERBS as readonly string[]).includes(subCmd)) {
  const { createDeltaTools } = await import("./tools/deltaTools.js");
  const deltaTools = createDeltaTools();
  const toolName = subCmd === "packets" ? "delta_packets"
    : subCmd === "watch" ? "delta_watch"
    : subCmd === "dogfood" ? "delta_self_dogfood"
    : `delta_${subCmd}`;
  const tool = deltaTools.find((t) => t.name === toolName);
  if (!tool) {
    console.error(`Unknown delta command: ${subCmd}`);
    process.exit(1);
  }

  // Parse remaining args as JSON or key=value pairs
  const rawToolArgs = cliArgs.filter((a) => a !== subCmd && !a.startsWith("--"));
  const argStr = rawToolArgs.join(" ");
  const parseCliScalar = (value: string): unknown => {
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    if ((value.startsWith("{") && value.endsWith("}")) || (value.startsWith("[") && value.endsWith("]"))) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  };
  let toolArgs: Record<string, unknown> = {};
  if (argStr) {
    try {
      toolArgs = JSON.parse(argStr);
    } catch {
      if (rawToolArgs.length === 1) {
        try {
          toolArgs = JSON.parse(rawToolArgs[0]!);
        } catch {
          toolArgs = {};
        }
      }
      // Check for key=value pairs first, collect remaining as positional
      const kvParts: string[] = [];
      const positionalParts: string[] = [];
      for (const part of rawToolArgs) {
        const eqIdx = part.indexOf("=");
        if (eqIdx > 0) {
          toolArgs[part.slice(0, eqIdx)] = parseCliScalar(part.slice(eqIdx + 1));
          kvParts.push(part);
        } else {
          positionalParts.push(part);
        }
      }
      // Join ALL positional words as the primary arg (handles multi-word strings)
      if (positionalParts.length > 0) {
        const fullPositional = positionalParts.join(" ");
        if (subCmd === "diligence" || subCmd === "compare") toolArgs.entity = toolArgs.entity || fullPositional;
        else if (subCmd === "watch") toolArgs.entity = toolArgs.entity || fullPositional;
        else if (subCmd === "memo") toolArgs.decision = toolArgs.decision || fullPositional;
        else if (subCmd === "handoff") toolArgs.task = toolArgs.task || fullPositional;
        else if (subCmd === "retain") toolArgs.content = toolArgs.content || fullPositional;
        else if (subCmd === "review") toolArgs.forecast = toolArgs.forecast || fullPositional;
      }
      // Default action for watch
      if (subCmd === "watch" && !toolArgs.action) toolArgs.action = toolArgs.entity ? "add" : "list";
    }
  } else if (subCmd === "watch") {
    toolArgs.action = "list";
  }

  try {
    const result = await tool.handler(toolArgs);
    const structuredResult = result as { content?: Array<{ text?: string }> };
    const text = structuredResult.content?.[0]?.text || JSON.stringify(result);
    try {
      const parsed = JSON.parse(text);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(text);
    }
  } catch (err) {
    console.error(`Error running delta_${subCmd}:`, err);
    process.exit(1);
  }
  process.exit(0);
}

// ── Demo subcommand (run-and-exit) ───────────────────────────────────
if (subCmd === "demo") {
  const USE_COLOR = process.stdout.isTTY;
  const B = USE_COLOR ? "\x1b[1m" : "";
  const C = USE_COLOR ? "\x1b[36m" : "";
  const G = USE_COLOR ? "\x1b[32m" : "";
  const D = USE_COLOR ? "\x1b[2m" : "";
  const Y = USE_COLOR ? "\x1b[33m" : "";
  const X = USE_COLOR ? "\x1b[0m" : "";

  const demoLines: string[] = [];
  demoLines.push("");
  demoLines.push(`  ${B}NodeBench AI — Live Demo${X}`);
  demoLines.push(`  ${D}No API keys needed. Everything runs locally.${X}`);
  demoLines.push("");

  // 1. Show research tools via hybridSearch
  demoLines.push(`  ${C}1. Discovering research tools...${X}`);
  demoLines.push("");
  const stubTools = ALL_REGISTRY_ENTRIES.map(e => ({ name: e.name, description: e.category }));
  const researchResults = hybridSearch("research", stubTools, { limit: 5, mode: "hybrid" });
  for (const r of researchResults.slice(0, 5)) {
    const entry = TOOL_REGISTRY.get(r.name);
    const phase = entry?.phase ?? "";
    demoLines.push(`     ${G}>${X} ${B}${r.name}${X}  ${D}(${phase})${X}`);
    if (entry?.quickRef?.nextAction) {
      demoLines.push(`       ${entry.quickRef.nextAction.slice(0, 80)}`);
    }
  }
  demoLines.push("");

  // 2. Show a workflow chain
  demoLines.push(`  ${C}2. Workflow chain: "Build a New Feature"${X}`);
  demoLines.push("");
  const chain = WORKFLOW_CHAINS["new_feature"];
  if (chain) {
    demoLines.push(`     ${B}${chain.name}${X}  ${D}— ${chain.description}${X}`);
    demoLines.push("");
    for (let i = 0; i < Math.min(chain.steps.length, 8); i++) {
      const step = chain.steps[i];
      const num = String(i + 1).padStart(2, " ");
      demoLines.push(`     ${Y}${num}.${X} ${step.tool}  ${D}→ ${step.action}${X}`);
    }
    if (chain.steps.length > 8) {
      demoLines.push(`     ${D}    ... +${chain.steps.length - 8} more steps${X}`);
    }
  }
  demoLines.push("");

  // 3. Summary stats
  const totalTools = Object.values(TOOLSET_MAP).reduce((s, v) => s + v.length, 0) + 12;
  const domainCount = Object.keys(TOOLSET_MAP).length;
  const chainCount = Object.keys(WORKFLOW_CHAINS).length;
  demoLines.push(`  ${C}3. What's available${X}`);
  demoLines.push("");
  demoLines.push(`     ${Y}${totalTools}${X} tools across ${Y}${domainCount}${X} domains`);
  demoLines.push(`     ${Y}${chainCount}${X} pre-built workflow chains`);
  demoLines.push(`     ${Y}${ALL_REGISTRY_ENTRIES.length}${X} entries in the tool registry`);
  demoLines.push("");

  // 4. Next steps
  demoLines.push(`  ${C}Next steps${X}`);
  demoLines.push(`    ${G}$${X} npx nodebench-mcp --explain run_recon     ${D}Deep-dive on any tool${X}`);
  demoLines.push(`    ${G}$${X} npx nodebench-mcp --health                ${D}Check your environment${X}`);
  demoLines.push(`    ${G}$${X} npx nodebench-mcp --sync-configs          ${D}Wire into your IDE${X}`);
  demoLines.push("");

  console.log(demoLines.join("\n"));
  process.exit(0);
}

// ── Discover subcommand (run-and-exit) ───────────────────────────────
if (subCmd === "discover") {
  const USE_COLOR = process.stdout.isTTY;
  const B = USE_COLOR ? "\x1b[1m" : "";
  const C = USE_COLOR ? "\x1b[36m" : "";
  const G = USE_COLOR ? "\x1b[32m" : "";
  const D = USE_COLOR ? "\x1b[2m" : "";
  const Y = USE_COLOR ? "\x1b[33m" : "";
  const X = USE_COLOR ? "\x1b[0m" : "";

  const query = cliArgs.find(a => a !== "discover" && !a.startsWith("--")) ?? "";
  const limit = 10;

  const lines: string[] = [];
  lines.push("");
  if (query) {
    lines.push(`  ${B}Discovering tools for:${X} ${C}${query}${X}`);
    const stubTools = ALL_REGISTRY_ENTRIES.map(e => ({ name: e.name, description: e.category }));
    const results = hybridSearch(query, stubTools, { limit, mode: "hybrid" });
    lines.push("");
    for (const r of results) {
      const entry = TOOL_REGISTRY.get(r.name);
      lines.push(`  ${G}>${X} ${B}${r.name}${X}  ${D}score: ${r.score.toFixed(2)}${X}`);
      if (entry) {
        lines.push(`    ${D}${entry.category} · ${entry.phase}${X}`);
        if (entry.quickRef?.nextAction) lines.push(`    ${entry.quickRef.nextAction.slice(0, 90)}`);
      }
      lines.push("");
    }
    if (results.length === 0) lines.push(`  ${Y}No results.${X} Try a broader query.\n`);
  } else {
    lines.push(`  ${B}Tool domains${X}  ${D}(${Object.keys(TOOLSET_MAP).length} domains)${X}`);
    lines.push("");
    for (const [domain, tools] of Object.entries(TOOLSET_MAP)) {
      lines.push(`  ${G}>${X} ${domain.padEnd(24)} ${Y}${String(tools.length).padStart(3)}${X} tools`);
    }
    lines.push("");
    lines.push(`  ${D}Search: npx nodebench-mcp discover <query>${X}`);
  }
  lines.push("");
  console.log(lines.join("\n"));
  process.exit(0);
}

// ── Quickref subcommand (run-and-exit) ───────────────────────────────
if (subCmd === "quickref") {
  const USE_COLOR = process.stdout.isTTY;
  const B = USE_COLOR ? "\x1b[1m" : "";
  const C = USE_COLOR ? "\x1b[36m" : "";
  const G = USE_COLOR ? "\x1b[32m" : "";
  const D = USE_COLOR ? "\x1b[2m" : "";
  const Y = USE_COLOR ? "\x1b[33m" : "";
  const X = USE_COLOR ? "\x1b[0m" : "";

  const toolName = cliArgs.find(a => a !== "quickref" && !a.startsWith("--")) ?? "";
  const lines: string[] = [];
  lines.push("");

  if (!toolName) {
    lines.push(`  ${B}Usage:${X} npx nodebench-mcp quickref <tool_or_workflow>`);
    lines.push("");
    lines.push(`  ${C}Workflows${X}`);
    for (const [key, chain] of Object.entries(WORKFLOW_CHAINS).slice(0, 10)) {
      lines.push(`  ${G}>${X} ${key.padEnd(28)} ${D}${chain.name}${X}`);
    }
    lines.push(`  ${D}  ... +${Object.keys(WORKFLOW_CHAINS).length - 10} more${X}`);
    lines.push("");
  } else {
    // Try workflow first
    const chain = WORKFLOW_CHAINS[toolName];
    if (chain) {
      lines.push(`  ${B}${chain.name}${X}  ${D}(${toolName})${X}`);
      lines.push(`  ${chain.description}`);
      lines.push("");
      for (let i = 0; i < chain.steps.length; i++) {
        const step = chain.steps[i];
        lines.push(`  ${Y}${String(i + 1).padStart(2)}.${X} ${step.tool}  ${D}→ ${step.action}${X}`);
      }
      lines.push("");
    } else {
      // Try tool registry
      const entry = TOOL_REGISTRY.get(toolName);
      if (entry) {
        lines.push(`  ${B}${entry.name}${X}  ${D}(${entry.category}, ${entry.phase})${X}`);
        lines.push(`  ${entry.quickRef.nextAction}`);
        if (entry.quickRef.tip) lines.push(`  ${Y}Tip:${X} ${entry.quickRef.tip}`);
        if (entry.quickRef.nextTools.length > 0) {
          lines.push("");
          lines.push(`  ${C}Next tools${X}`);
          for (const nt of entry.quickRef.nextTools) lines.push(`    ${G}>${X} ${nt}`);
        }
        lines.push("");
      } else {
        lines.push(`  ${Y}Not found:${X} ${toolName}`);
        lines.push(`  ${D}Try: npx nodebench-mcp quickref new_feature${X}`);
        lines.push("");
      }
    }
  }
  console.log(lines.join("\n"));
  process.exit(0);
}

// ── Call subcommand (run-and-exit) ───────────────────────────────────
if (subCmd === "call") {
  const toolName = cliArgs.find(a => a !== "call" && !a.startsWith("--") && !a.startsWith("{"));
  const argsJson = cliArgs.find(a => a.startsWith("{")) ?? "{}";
  const USE_COLOR = process.stdout.isTTY;
  const B = USE_COLOR ? "\x1b[1m" : "";
  const G = USE_COLOR ? "\x1b[32m" : "";
  const R = USE_COLOR ? "\x1b[31m" : "";
  const D = USE_COLOR ? "\x1b[2m" : "";
  const X = USE_COLOR ? "\x1b[0m" : "";

  if (!toolName) {
    console.log(`\n  ${B}Usage:${X} ${NPX_COMMAND} call <tool_name> [json_args]\n`);
    console.log(`  ${D}Example:${X} ${NPX_COMMAND} call founder_deep_context_gather '{"packetType":"weekly_reset"}'`);
    console.log(`  ${D}Example:${X} ${NPX_COMMAND} call discover_tools '{"query":"founder"}'`);
    console.log(`  ${D}Example:${X} ${NPX_COMMAND} call save_session_note '{"note":"test"}'\n`);
    process.exit(0);
  }

  // Find tool in all toolsets — meta/discovery tools are created later,
  // so for CLI call we build them inline
  const cliDomainTools = Object.values(TOOLSET_MAP).flat();
  const cliMetaTools = createMetaTools(cliDomainTools);
  const cliDiscoveryTools = createProgressiveDiscoveryTools(cliDomainTools);
  const allCallable = [...cliDomainTools, ...cliMetaTools, ...cliDiscoveryTools];
  const tool = allCallable.find(t => t.name === toolName);
  if (!tool) {
    console.log(`\n  ${R}Tool not found:${X} ${toolName}`);
    console.log(`  ${D}Run: ${NPX_COMMAND} discover ${toolName}${X}\n`);
    process.exit(1);
  }

  let parsedArgs: Record<string, unknown>;
  try {
    parsedArgs = JSON.parse(argsJson);
  } catch {
    console.log(`\n  ${R}Invalid JSON args:${X} ${argsJson}\n`);
    process.exit(1);
  }

  console.log(`\n  ${D}Calling${X} ${B}${toolName}${X} ${D}...${X}`);
  try {
    const result = await tool.handler(parsedArgs);
    const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    console.log(`\n  ${G}Result:${X}\n`);
    // Pretty-print, indent 4 spaces
    for (const line of output.split("\n")) {
      console.log(`    ${line}`);
    }
    console.log("");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`\n  ${R}Error:${X} ${msg}\n`);
    process.exit(1);
  }
  process.exit(0);
}

// ── Setup subcommand (run-and-exit) ──────────────────────────────────
if (subCmd === "setup") {
  const USE_COLOR = process.stdout.isTTY;
  const B = USE_COLOR ? "\x1b[1m" : "";
  const C = USE_COLOR ? "\x1b[36m" : "";
  const G = USE_COLOR ? "\x1b[32m" : "";
  const D = USE_COLOR ? "\x1b[2m" : "";
  const Y = USE_COLOR ? "\x1b[33m" : "";
  const X = USE_COLOR ? "\x1b[0m" : "";

  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${B}${DISPLAY_NAME} - Quick Setup${X}`);
  lines.push("");
  lines.push(`  ${G}1.${X} ${B}Claude Code${X}`);
  lines.push(`     claude mcp add ${SERVER_KEY} -- ${NPX_Y_COMMAND}`);
  lines.push("");
  lines.push(`  ${G}2.${X} ${B}Cursor${X}  ${D}(.cursor/mcp.json)${X}`);
  lines.push(`     { "mcpServers": { "${SERVER_KEY}": { "command": "npx", "args": ["-y", "${NODEBENCH_NPX_PACKAGE}"] } } }`);
  lines.push("");
  lines.push(`  ${G}3.${X} ${B}Windsurf${X}  ${D}(.windsurf/mcp.json)${X}`);
  lines.push(`     { "mcpServers": { "${SERVER_KEY}": { "command": "npx", "args": ["-y", "${NODEBENCH_NPX_PACKAGE}"] } } }`);
  lines.push("");
  lines.push(`  ${C}Verify:${X}  ${NPX_COMMAND} call discover_tools '{"query":"founder"}'`);
  lines.push(`  ${C}Dashboard:${X}  https://www.nodebenchai.com/founder`);
  lines.push(`  ${C}Agent setup:${X}  https://www.nodebenchai.com/agent-setup.txt`);
  lines.push("");
  lines.push(`  ${Y}Compatibility presets on core package:${X}  --preset default | --preset power | --preset admin`);
  lines.push(`  ${Y}Founder tools:${X}  founder_deep_context_gather, founder_packet_validate, founder_packet_diff`);
  lines.push("");
  console.log(lines.join("\n"));
  process.exit(0);
}

// Initialize DB (creates ~/.nodebench/ and schema on first run)
getDb();

// Wire up DB accessor for execution trace edges (avoids circular import)
_setDbAccessor(getDb);

// Assemble tools (filtered by --toolsets / --exclude / --preset if provided)
let domainTools: McpTool[] = await parseToolsets();

// Determine current preset name for analytics/runtime gating
let currentPreset: string = requestedPreset;
if (cliArgs.includes("--toolsets") || cliArgs.includes("--exclude")) {
  currentPreset = 'custom';
}

// Dynamic loading: --dynamic flag enables Search+Load architecture
// (arxiv 2509.20386 "Dynamic ReAct" winning pattern)
const useDynamicLoading = cliArgs.includes("--dynamic");

// Track which toolsets are currently active (mutable for dynamic loading)
const initialToolsetNames = new Set(
  PRESETS[currentPreset] ?? PRESETS.default
);
const activeToolsets = new Set(initialToolsetNames);

// Tools to skip auto-logging (avoid infinite recursion and noise)
const SKIP_AUTO_LOG = new Set(["log_tool_call", "get_trajectory_analysis", "get_self_eval_report", "get_improvement_recommendations", "cleanup_stale_runs", "synthesize_recon_to_learnings", "load_toolset", "unload_toolset", "list_available_toolsets"]);

// Initialize analytics tracker singleton (handles DB, project context, retention cleanup)
const tracker = AnalyticsTracker.init({
  projectPath: process.cwd(),
  preset: currentPreset,
  toolCount: domainTools.length + 6,
  toolToToolset: TOOL_TO_TOOLSET,
  skipTools: SKIP_AUTO_LOG,
});
const metaTools = createMetaTools(domainTools);
let allToolsWithoutDiscovery = [...domainTools, ...metaTools];
// Progressive discovery tools need the full tool list for hybrid search
// Pass dynamic loading callbacks so discover_tools can suggest load_toolset for unloaded toolsets
const discoveryTools = createProgressiveDiscoveryTools(
  allToolsWithoutDiscovery.map((t) => ({ name: t.name, description: t.description })),
  {
    getLoadedToolNames: () => new Set(allTools.map(t => t.name)),
    getToolToToolset: () => TOOL_TO_TOOLSET,
  },
);

// ── Dynamic Loading Tools (Search+Load pattern) ────────────────────────
// Based on Dynamic ReAct (arxiv 2509.20386) — the winning architecture.
// Agent starts with default preset, discovers tools via discover_tools,
// then calls load_toolset to activate them. Server sends
// notifications/tools/list_changed so the client re-fetches the tool list.
const dynamicLoadingTools: McpTool[] = [
  {
    name: "load_toolset",
    description:
      'Dynamically load a toolset into the current session. After loading, the tools become immediately available for use. Based on the "Search+Load" architecture from Dynamic ReAct (arxiv 2509.20386) — the winning pattern for scalable MCP tool selection. Use discover_tools first to find which toolset you need, then call this to activate it.',
    inputSchema: {
      type: "object",
      properties: {
        toolset: {
          type: "string",
          description: `Toolset name to load. Available: ${ALL_DOMAIN_KEYS.filter(k => !activeToolsets.has(k)).join(", ") || "(all loaded)"}`,
        },
      },
      required: ["toolset"],
    },
    handler: async (args) => {
      const { toolset } = args as { toolset: string };
      if (!TOOLSET_LOADERS[toolset]) {
        return { error: true, message: `Unknown toolset: ${toolset}`, available: ALL_DOMAIN_KEYS };
      }
      if (activeToolsets.has(toolset)) {
        return { alreadyLoaded: true, toolset, message: `Toolset '${toolset}' is already active.`, activeToolCount: allTools.length };
      }

      const startMs = Date.now();
      const toolsBefore = allTools.length;

      // Dynamically load the toolset (populates TOOLSET_MAP[toolset])
      await loadToolsets([toolset]);

      // Add toolset to active set
      activeToolsets.add(toolset);
      const newTools = TOOLSET_MAP[toolset];

      // Rebuild domain tools from active toolsets
      domainTools = [...activeToolsets].flatMap(k => TOOLSET_MAP[k] ?? []);
      const newMetaTools = createMetaTools(domainTools);
      allToolsWithoutDiscovery = [...domainTools, ...newMetaTools];

      // Rebuild allTools (keep discovery + dynamic loading tools stable)
      rebuildAllTools();

      // Track A/B event
      try {
        const db = getDb();
        db.prepare(
          "INSERT INTO ab_tool_events (id, session_id, event_type, toolset_name, tools_before, tools_after, latency_ms, created_at) VALUES (?, ?, 'load', ?, ?, ?, ?, datetime('now'))"
        ).run(genId("abe"), SESSION_ID, toolset, toolsBefore, allTools.length, Date.now() - startMs);
      } catch { /* instrumentation must not break tool dispatch */ }

      // Notify client that tool list changed (MCP spec)
      try {
        await server.notification({ method: "notifications/tools/list_changed" });
      } catch { /* client may not support notifications */ }

      return {
        loaded: true,
        toolset,
        toolsAdded: newTools.length,
        toolNames: newTools.map(t => t.name),
        activeToolCount: allTools.length,
        activeToolsets: [...activeToolsets],
        _hint: `${newTools.length} tools from '${toolset}' are now available. You can use them directly.`,
      };
    },
  },
  {
    name: "unload_toolset",
    description:
      "Remove a dynamically loaded toolset from the current session to free up context. Cannot unload toolsets from the initial preset.",
    inputSchema: {
      type: "object",
      properties: {
        toolset: {
          type: "string",
          description: "Toolset name to unload.",
        },
      },
      required: ["toolset"],
    },
    handler: async (args) => {
      const { toolset } = args as { toolset: string };
      if (!activeToolsets.has(toolset)) {
        return { error: true, message: `Toolset '${toolset}' is not currently loaded.` };
      }
      if (initialToolsetNames.has(toolset)) {
        return { error: true, message: `Cannot unload '${toolset}' — it's part of the initial preset (${currentPreset}).` };
      }

      const toolsBefore = allTools.length;
      activeToolsets.delete(toolset);

      // Rebuild
      domainTools = [...activeToolsets].flatMap(k => TOOLSET_MAP[k] ?? []);
      const newMetaTools = createMetaTools(domainTools);
      allToolsWithoutDiscovery = [...domainTools, ...newMetaTools];
      rebuildAllTools();

      try {
        const db = getDb();
        db.prepare(
          "INSERT INTO ab_tool_events (id, session_id, event_type, toolset_name, tools_before, tools_after, created_at) VALUES (?, ?, 'unload', ?, ?, ?, datetime('now'))"
        ).run(genId("abe"), SESSION_ID, toolset, toolsBefore, allTools.length);
      } catch { /* instrumentation */ }

      try {
        await server.notification({ method: "notifications/tools/list_changed" });
      } catch { /* client may not support notifications */ }

      return {
        unloaded: true,
        toolset,
        activeToolCount: allTools.length,
        activeToolsets: [...activeToolsets],
      };
    },
  },
  {
    name: "list_available_toolsets",
    description:
      "List all available toolsets showing which are currently loaded and which can be dynamically added. Includes tool counts and descriptions for each toolset.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const toolsets = ALL_DOMAIN_KEYS.map((name) => {
        const tools = TOOLSET_MAP[name];
        return {
          name,
          toolCount: tools ? tools.length : null,
          loaded: activeToolsets.has(name),
          isInitialPreset: initialToolsetNames.has(name),
          description: PRESET_DESCRIPTIONS[name] ?? null,
          tools: tools ? tools.map(t => t.name) : [],
        };
      });

      const loaded = toolsets.filter(t => t.loaded);
      const available = toolsets.filter(t => !t.loaded);

      return {
        mode: useDynamicLoading ? "dynamic" : "static",
        currentPreset,
        activeToolCount: allTools.length,
        loaded: { count: loaded.length, toolsets: loaded },
        available: { count: available.length, toolsets: available },
        _hint: available.length > 0
          ? `${available.length} toolsets available to load. Call load_toolset("<name>") to activate.`
          : "All toolsets are loaded.",
      };
    },
  },
  {
    name: "call_loaded_tool",
    description:
      'Call a dynamically loaded tool by name. Use this after load_toolset when your client does not automatically refresh the tool list. Pass the tool name and its arguments. Example: call_loaded_tool({ tool: "analyze_screenshot", args: { imagePath: "screenshot.png" } }). This is a fallback — if the loaded tool appears in your tool list directly, call it directly instead.',
    inputSchema: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          description: "Name of the dynamically loaded tool to call.",
        },
        args: {
          type: "object",
          description: "Arguments to pass to the tool (same as its inputSchema).",
          additionalProperties: true,
        },
      },
      required: ["tool"],
    },
    handler: async (callArgs) => {
      const { tool: toolName, args: toolArgs } = callArgs as { tool: string; args?: Record<string, unknown> };
      const target = allTools.find(t => t.name === toolName);
      if (!target) {
        return {
          error: true,
          message: `Tool '${toolName}' not found. It may not be loaded yet.`,
          _hint: "Call list_available_toolsets to see what's available, then load_toolset to activate it.",
          loadedTools: allTools.map(t => t.name),
        };
      }
      // Dispatch to the target tool's handler
      return target.handler(toolArgs ?? {});
    },
  },
  {
    name: "smart_select_tools",
    description:
      'LLM-powered tool selection: sends your task description + a compact tool catalog to a fast model (Gemini 3 Flash, GPT-5-mini, or Claude Haiku 4.5) to pick the best 5-10 tools. Much more accurate than keyword search for ambiguous queries like "call an AI model" or "analyze my data". Requires GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY. Falls back to heuristic discover_tools if no API key is set.',
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Describe what you want to accomplish. Be specific. Example: 'I need to parse a PDF, extract tables, and email a summary'",
        },
        maxTools: {
          type: "number",
          description: "Maximum tools to return (default: 8)",
        },
        provider: {
          type: "string",
          enum: ["auto", "gemini", "openai", "anthropic"],
          description: "Which LLM provider to use. 'auto' (default) picks the first available API key.",
        },
      },
      required: ["task"],
    },
    handler: async (args) => {
      const task = args.task as string;
      const maxTools = (args.maxTools as number) ?? 8;
      const provider = (args.provider as string) ?? "auto";

      // Build compact tool catalog: name + category + tags (no descriptions — saves tokens)
      const catalog = ALL_REGISTRY_ENTRIES.map(e =>
        `${e.name} [${e.category}] ${e.tags.slice(0, 5).join(",")}`
      ).join("\n");

      const systemPrompt = `You are a tool selection assistant. Given a task description and a catalog of ${ALL_REGISTRY_ENTRIES.length} tools, pick the ${maxTools} most relevant tools. Return ONLY a JSON array of tool names, nothing else. Example: ["tool_a","tool_b"]`;
      const userPrompt = `Task: ${task}\n\nTool catalog (name [category] tags):\n${catalog}`;

      // Try LLM providers in order
      const geminiKey = process.env.GEMINI_API_KEY;
      const openaiKey = process.env.OPENAI_API_KEY;
      const anthropicKey = process.env.ANTHROPIC_API_KEY;

      let selectedProvider = provider;
      if (selectedProvider === "auto") {
        if (geminiKey) selectedProvider = "gemini";
        else if (openaiKey) selectedProvider = "openai";
        else if (anthropicKey) selectedProvider = "anthropic";
        else selectedProvider = "none";
      }

      if (selectedProvider === "none") {
        // Fallback: run heuristic discover_tools (search full registry for dynamic mode)
        const heuristicResults = hybridSearch(task, allTools.map(t => ({ name: t.name, description: t.description })), {
          limit: maxTools,
          mode: "hybrid",
          searchFullRegistry: useDynamicLoading,
        });
        return {
          method: "heuristic_fallback",
          reason: "No API key found. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY for LLM-powered selection.",
          tools: heuristicResults.map((r: { name: string; category: string; score: number; quickRef: any }) => ({
            name: r.name,
            category: r.category,
            score: r.score,
            quickRef: r.quickRef,
          })),
          _hint: "For better accuracy on ambiguous queries, set an API key to enable LLM-powered selection.",
        };
      }

      try {
        let responseText = "";

        if (selectedProvider === "gemini" && geminiKey) {
          const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
                generationConfig: { temperature: 0, maxOutputTokens: 512 },
              }),
            }
          );
          const data = await resp.json() as any;
          responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        } else if (selectedProvider === "openai" && openaiKey) {
          const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
            body: JSON.stringify({
              model: "gpt-5-mini",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              temperature: 0,
              max_tokens: 512,
            }),
          });
          const data = await resp.json() as any;
          responseText = data?.choices?.[0]?.message?.content ?? "";
        } else if (selectedProvider === "anthropic" && anthropicKey) {
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": anthropicKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-3-5-haiku-latest",
              max_tokens: 512,
              system: systemPrompt,
              messages: [{ role: "user", content: userPrompt }],
            }),
          });
          const data = await resp.json() as any;
          responseText = data?.content?.[0]?.text ?? "";
        }

        // Parse the JSON array from the response
        const jsonMatch = responseText.match(/\[[\s\S]*?\]/);
        if (!jsonMatch) {
          return { error: true, message: "LLM did not return a valid JSON array", raw: responseText.slice(0, 200) };
        }
        const selectedNames: string[] = JSON.parse(jsonMatch[0]);

        // Enrich with registry metadata
        const enriched = selectedNames
          .map(name => {
            const entry = TOOL_REGISTRY.get(name);
            if (!entry) return null;
            return {
              name: entry.name,
              category: entry.category,
              phase: entry.phase,
              tags: entry.tags,
              quickRef: entry.quickRef,
              loaded: allTools.some(t => t.name === name),
            };
          })
          .filter(Boolean);

        // Identify toolsets to load
        const unloadedToolsets = new Map<string, string[]>();
        for (const tool of enriched) {
          if (tool && !tool.loaded) {
            const ts = TOOL_TO_TOOLSET.get(tool.name);
            if (ts) {
              const list = unloadedToolsets.get(ts) ?? [];
              list.push(tool.name);
              unloadedToolsets.set(ts, list);
            }
          }
        }

        return {
          method: `llm_${selectedProvider}`,
          task,
          selectedTools: enriched,
          toolCount: enriched.length,
          ...(unloadedToolsets.size > 0 ? {
            _loadSuggestions: [...unloadedToolsets.entries()].map(([ts, tools]) => ({
              toolset: ts,
              matchingTools: tools,
              action: `Call load_toolset("${ts}") to activate ${tools.length} tool(s).`,
            })),
          } : {}),
          _hint: enriched.length > 0
            ? `Top pick: ${enriched[0]!.name}. ${enriched[0]!.quickRef.nextAction}`
            : "No tools selected. Try rephrasing your task.",
        };
      } catch (err: any) {
        return {
          error: true,
          method: `llm_${selectedProvider}`,
          message: `LLM call failed: ${err.message}`,
          _hint: "Falling back to heuristic search. Check your API key.",
        };
      }
    },
  },
  {
    name: "get_ab_test_report",
    description:
      "Generate an A/B test comparison report for static vs dynamic toolset loading. Shows session counts, tool counts, load events, error rates, and per-toolset load frequency. Use after running sessions in both modes to evaluate the impact of dynamic loading.",
    inputSchema: {
      type: "object",
      properties: {
        detailed: {
          type: "boolean",
          description: "Include per-session breakdown (default: false, summary only)",
        },
      },
    },
    handler: async (args) => {
      const db = getDb();
      const detailed = args.detailed === true;

      // Session-level aggregates by mode
      const sessionSummary = db.prepare(`
        SELECT
          mode,
          COUNT(*) as sessions,
          ROUND(AVG(initial_tool_count), 1) as avg_initial_tools,
          ROUND(AVG(COALESCE(final_tool_count, initial_tool_count)), 1) as avg_final_tools,
          ROUND(AVG(COALESCE(total_tool_calls, 0)), 1) as avg_tool_calls,
          ROUND(AVG(COALESCE(total_load_events, 0)), 1) as avg_load_events,
          ROUND(AVG(COALESCE(session_duration_ms, 0)) / 1000.0, 1) as avg_duration_sec,
          SUM(COALESCE(total_tool_calls, 0)) as total_calls,
          SUM(COALESCE(total_load_events, 0)) as total_loads
        FROM ab_test_sessions
        GROUP BY mode
      `).all() as any[];

      // Error rate by mode (join with tool_call_log)
      const errorRates = db.prepare(`
        SELECT
          s.mode,
          COUNT(CASE WHEN t.result_status = 'error' THEN 1 END) as errors,
          COUNT(*) as total_calls,
          ROUND(100.0 * COUNT(CASE WHEN t.result_status = 'error' THEN 1 END) / MAX(COUNT(*), 1), 2) as error_pct
        FROM tool_call_log t
        JOIN ab_test_sessions s ON t.session_id = s.id
        GROUP BY s.mode
      `).all() as any[];

      // Top loaded toolsets (dynamic mode)
      const topToolsets = db.prepare(`
        SELECT
          toolset_name,
          COUNT(*) as load_count,
          ROUND(AVG(latency_ms), 1) as avg_latency_ms
        FROM ab_tool_events
        WHERE event_type = 'load'
        GROUP BY toolset_name
        ORDER BY load_count DESC
        LIMIT 10
      `).all() as any[];

      // Current session info
      const currentSession = {
        sessionId: SESSION_ID,
        mode: useDynamicLoading ? "dynamic" : "static",
        preset: currentPreset,
        toolCalls: _abToolCallCount,
        loadEvents: _abLoadEventCount,
        activeTools: allTools.length,
        durationSec: Math.round((Date.now() - _abStartMs) / 1000),
        dynamicallyLoaded: [...activeToolsets].filter(ts => !initialToolsetNames.has(ts)),
      };

      // Optional per-session detail
      let sessions: any[] = [];
      if (detailed) {
        sessions = db.prepare(`
          SELECT id, mode, initial_preset, initial_tool_count, final_tool_count,
                 toolsets_loaded, total_tool_calls, total_load_events,
                 session_duration_ms, created_at, ended_at
          FROM ab_test_sessions
          ORDER BY created_at DESC
          LIMIT 50
        `).all() as any[];
      }

      // Build verdict
      const staticSummary = sessionSummary.find((s: any) => s.mode === "static");
      const dynamicSummary = sessionSummary.find((s: any) => s.mode === "dynamic");
      let verdict = "Insufficient data. Run sessions in both modes to compare.";
      if (staticSummary && dynamicSummary) {
        const toolDiff = (staticSummary.avg_final_tools ?? 0) - (dynamicSummary.avg_final_tools ?? 0);
        const staticErr = errorRates.find((e: any) => e.mode === "static");
        const dynamicErr = errorRates.find((e: any) => e.mode === "dynamic");
        const errDiff = (staticErr?.error_pct ?? 0) - (dynamicErr?.error_pct ?? 0);
        verdict = [
          `Static: ${staticSummary.sessions} sessions, avg ${staticSummary.avg_final_tools} tools, ${staticErr?.error_pct ?? "?"}% error rate.`,
          `Dynamic: ${dynamicSummary.sessions} sessions, avg ${dynamicSummary.avg_final_tools} tools, ${dynamicErr?.error_pct ?? "?"}% error rate.`,
          toolDiff > 0 ? `Dynamic uses ${toolDiff.toFixed(1)} fewer tools on average.` : "",
          errDiff > 0 ? `Dynamic has ${errDiff.toFixed(2)}pp lower error rate.` : errDiff < 0 ? `Static has ${(-errDiff).toFixed(2)}pp lower error rate.` : "",
          dynamicSummary.avg_load_events > 0 ? `Agents loaded ${dynamicSummary.avg_load_events} toolsets per session on average.` : "",
        ].filter(Boolean).join(" ");
      }

      return {
        verdict,
        sessionSummary,
        errorRates,
        topLoadedToolsets: topToolsets,
        currentSession,
        ...(detailed ? { sessions } : {}),
        _hint: sessionSummary.length < 2
          ? "Run sessions with both `npx nodebench-mcp` (static) and `npx nodebench-mcp --dynamic` (dynamic) to compare."
          : "Compare avg_final_tools and error_pct between modes to evaluate dynamic loading impact.",
      };
    },
  },
];

// v3 preset gate: expose only facade tools + discover_tools + load_toolset
const isV3Surface = isWorkflowFacadePreset(currentPreset);

// Combine all tools (mutable for dynamic loading)
let allTools: McpTool[];
if (isV3Surface) {
  allTools = [
    ...domainTools,
    ...discoveryTools.filter(t => t.name === "discover_tools"),
    ...dynamicLoadingTools.filter(t => t.name === "load_toolset"),
  ];
} else {
  allTools = [...allToolsWithoutDiscovery, ...discoveryTools, ...dynamicLoadingTools];
}

// Always initialize profiler tables (lightweight, non-blocking)
try {
  const { initEventCollectorTables } = require("./profiler/eventCollector.js");
  const { initWorkflowTemplateTables } = require("./profiler/workflowTemplates.js");
  const { initProofEngineTables } = require("./profiler/proofEngine.js");
  const { initModelRoutingTables } = require("./profiler/modelRouter.js");
  initEventCollectorTables();
  initWorkflowTemplateTables();
  initProofEngineTables();
  initModelRoutingTables();
} catch { /* profiler tables optional */ }

// Wrap all tools with profiling proxy when --profile is set
// This adds ~1ms per tool call but logs everything to SQLite
if (useProfile) {
  try {
    const { wrapToolsWithProxy } = require("./profiler/mcpProxy.js");
    allTools = wrapToolsWithProxy(allTools, { sessionId: `mcp_${Date.now().toString(36)}` });
    console.error("[profiler] All tools wrapped with profiling proxy (--profile)");
  } catch (e: any) {
    console.error("[profiler] Failed to enable profiling:", e?.message);
  }
}

// Background: initialize embedding index for semantic search (non-blocking)
// Uses Agent-as-a-Graph bipartite corpus: tool nodes + domain nodes for graph-aware retrieval
if (useEmbedding) {
  const descMap = new Map(allTools.map((t) => [t.name, t.description]));

  // Tool nodes: individual tools with full metadata text
  const toolCorpus = ALL_REGISTRY_ENTRIES.map((entry) => ({
    name: entry.name,
    text: `${entry.name} ${entry.tags.join(" ")} ${entry.category} ${entry.phase} ${descMap.get(entry.name) ?? ""}`,
    nodeType: "tool" as const,
  }));

  // Domain nodes: aggregate category descriptions for upward traversal
  // When a domain matches, all tools in that domain get a sibling boost
  const categoryTools = new Map<string, string[]>();
  for (const entry of ALL_REGISTRY_ENTRIES) {
    const list = categoryTools.get(entry.category) ?? [];
    list.push(entry.name);
    categoryTools.set(entry.category, list);
  }
  const domainCorpus = [...categoryTools.entries()].map(([category, toolNames]) => {
    const allTags = new Set<string>();
    const descs: string[] = [];
    for (const tn of toolNames) {
      const e = ALL_REGISTRY_ENTRIES.find((r) => r.name === tn);
      if (e) e.tags.forEach((t) => allTags.add(t));
      const d = descMap.get(tn);
      if (d) descs.push(d);
    }
    // Domain text includes tool descriptions for richer semantic signal
    return {
      name: `domain:${category}`,
      text: `${category} domain: ${toolNames.join(" ")} ${[...allTags].join(" ")} ${descs.map(d => d.slice(0, 80)).join(" ")}`,
      nodeType: "domain" as const,
    };
  });

  const embeddingCorpus = [...toolCorpus, ...domainCorpus];
  initEmbeddingIndex(embeddingCorpus).catch(() => {
    /* Embedding init failed — semantic search stays disabled, no impact on other features */
  });
}

// Build a lookup map for fast tool dispatch (mutable for dynamic loading)
let toolMap = new Map<string, McpTool>();
for (const tool of allTools) {
  toolMap.set(tool.name, tool);
}

// Rebuild function for dynamic loading — reconstructs allTools + toolMap
function rebuildAllTools() {
  if (isV3Surface) {
    allTools = [
      ...domainTools,
      ...discoveryTools.filter(t => t.name === "discover_tools"),
      ...dynamicLoadingTools.filter(t => t.name === "load_toolset"),
    ];
  } else {
    allTools = [...allToolsWithoutDiscovery, ...discoveryTools, ...dynamicLoadingTools];
  }
  toolMap = new Map<string, McpTool>();
  for (const tool of allTools) {
    toolMap.set(tool.name, tool);
  }
}

// Auto-instrumentation: generate a session ID per MCP connection
const SESSION_ID = genId("mcp");

// A/B test session-level counters (mutable, finalized on exit)
let _abToolCallCount = 0;
let _abLoadEventCount = 0;
const _abStartMs = Date.now();

// ── Lightweight hooks: auto-save + attention refresh reminders ─────────
const _hookState = {
  totalCalls: 0,
  consecutiveWebCalls: 0, // web_search, fetch_url without save_session_note
  lastRefreshReminder: 0, // totalCalls at last reminder
};
const WEB_TOOL_NAMES = new Set(["web_search", "fetch_url"]);

// ── Intent-based auto-expansion ─────────────────────────────────────────
// On the first tool call, classify intent from tool name + args keywords
// and auto-load relevant toolsets if running on the default preset.
// Zero-latency: pure keyword matching, no LLM calls. Runs once per session.
let _intentClassified = false;

const INTENT_PATTERNS: Array<{ pattern: RegExp; toolsets: string[] }> = [
  { pattern: /web|css|html|dom|seo|browser|page|viewport|screenshot|ui_capture|ui_ux/i, toolsets: ["ui_capture", "vision", "web", "seo", "git_workflow", "architect"] },
  { pattern: /research|paper|arxiv|scholar|literature|digest|brief|rss|feed/i,          toolsets: ["web", "llm", "rss", "email", "docs"] },
  { pattern: /data|csv|sql|pandas|xlsx|json_parse|spreadsheet|parquet|parse/i,           toolsets: ["local_file", "llm", "web"] },
  { pattern: /deploy|docker|k8s|kubernetes|ci|cd|pipeline|terraform|helm|infra/i,        toolsets: ["git_workflow", "session_memory", "benchmark", "pattern"] },
  { pattern: /agent|swarm|orchestr|parallel|multi.?agent|spawn|coordinat/i,              toolsets: ["parallel", "self_eval", "session_memory", "pattern", "toon"] },
  { pattern: /mobile|ios|android|react.?native|flutter|swift|kotlin/i,                   toolsets: ["ui_capture", "vision", "flicker_detection"] },
  { pattern: /academic|thesis|review|cite|biblio|latex|peer/i,                           toolsets: ["research_writing", "llm", "web", "local_file"] },
  { pattern: /content|publish|post|newsletter|email|campaign|linkedin/i,                 toolsets: ["llm", "critter", "email", "rss", "platform", "architect"] },
];

async function classifyAndExpand(toolName: string, args: Record<string, unknown> | undefined): Promise<string[] | null> {
  // Only expand if on default preset — user explicitly chose a preset, respect it
  if (currentPreset !== "default") return null;

  // Build a single haystack from tool name + stringified arg keys/values
  const argStr = args ? Object.entries(args).map(([k, v]) => `${k} ${typeof v === "string" ? v : ""}`).join(" ") : "";
  const haystack = `${toolName} ${argStr}`;

  // Collect all matching toolsets (deduplicated)
  const toLoad = new Set<string>();
  for (const { pattern, toolsets } of INTENT_PATTERNS) {
    if (pattern.test(haystack)) {
      for (const ts of toolsets) {
        if (TOOLSET_LOADERS[ts] && !activeToolsets.has(ts)) {
          toLoad.add(ts);
        }
      }
    }
  }

  if (toLoad.size === 0) return null;

  // Dynamically load matched toolsets
  await loadToolsets([...toLoad]);
  for (const ts of toLoad) {
    activeToolsets.add(ts);
  }

  // Rebuild tool arrays
  domainTools = [...activeToolsets].flatMap(k => TOOLSET_MAP[k] ?? []);
  const newMetaTools = createMetaTools(domainTools);
  allToolsWithoutDiscovery = [...domainTools, ...newMetaTools];
  rebuildAllTools();

  // Notify client of tool list change
  server.notification({ method: "notifications/tools/list_changed" }).catch(() => {});

  return [...toLoad];
}
const SAVE_TOOL_NAMES = new Set(["save_session_note", "record_learning"]);
const REFRESH_INTERVAL = 30; // remind after every 30 calls

function getHookHint(toolName: string): string | null {
  _hookState.totalCalls++;

  // Track consecutive web calls
  if (WEB_TOOL_NAMES.has(toolName)) {
    _hookState.consecutiveWebCalls++;
  } else if (SAVE_TOOL_NAMES.has(toolName)) {
    _hookState.consecutiveWebCalls = 0;
  }

  const hints: string[] = [];

  // Auto-save reminder after 2+ consecutive web calls
  if (_hookState.consecutiveWebCalls >= 2) {
    hints.push("_hint: You've made " + _hookState.consecutiveWebCalls + " web calls without saving. Consider calling save_session_note to persist findings before context compaction.");
  }

  // Attention refresh reminder every 30 calls
  if (_hookState.totalCalls - _hookState.lastRefreshReminder >= REFRESH_INTERVAL) {
    hints.push("_hint: " + _hookState.totalCalls + " tool calls this session. Consider calling refresh_task_context to reload your bearings and prevent attention drift.");
    _hookState.lastRefreshReminder = _hookState.totalCalls;
  }

  return hints.length > 0 ? hints.join(" | ") : null;
}

// MCP Prompts — protocol-native agent instructions for onboarding
const PROMPTS = [
  {
    name: "onboarding",
    description:
      "Get started with NodeBench Development Methodology MCP. Shows first-time setup steps and key tools.",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are connected to NodeBench MCP — tools that make you catch the bugs you'd normally ship.

WHAT THIS DOES:
In benchmarks across 9 real production prompts, agents with NodeBench MCP caught 13 issues (4 HIGH severity)
that bare agents shipped to production. 26 blind spots prevented. Knowledge compounds — by task 9,
the agent finds 2+ prior findings before writing a single line of code.

HOW IT WORKS:
Every task follows a pipeline: Research → Risk → Implement → Test (3 layers) → Eval → Gate → Learn → Ship.
Each step produces a concrete artifact (an issue found, a regression guarded, a pattern banked) that
compounds into future tasks.

FIRST TIME? Run these 3 steps:
1. Call bootstrap_project to register your project (tech stack, architecture, conventions)
2. Call getMethodology("overview") to see all available methodologies
3. Call search_all_knowledge("your current task") before starting any work

RETURNING? Your project context and all past learnings are persisted. Start with:
1. Call search_all_knowledge with your current task
2. Follow the methodology tools as you work — they'll guide you step by step

KEY TOOLS:
- search_all_knowledge — Search prior findings before starting (avoid repeating past mistakes)
- run_mandatory_flywheel — 6-step minimum verification before declaring work done
- getMethodology — Step-by-step guides for verification, eval, flywheel, recon
- findTools — Discover tools by keyword or category
- assess_risk — Assess risk before acting (HIGH = needs confirmation)

PARALLEL AGENTS? If using Claude Code subagents or multiple terminals:
- claim_agent_task / release_agent_task — Lock tasks to prevent duplicate work
- get_parallel_status — See what all agents are doing
- Use the "claude-code-parallel" prompt for step-by-step guidance`,
        },
      },
    ],
  },
  {
    name: "execution-trace-workflow",
    description:
      "Start and maintain a traceable execution run. Use this for any workflow that needs receipts, evidence, decisions, verification, approvals, and a durable audit trail.",
    arguments: [
      {
        name: "workflowTitle",
        description: "Human-readable title for the run",
        required: true,
      },
      {
        name: "workflowGoal",
        description: "What the workflow must accomplish",
        required: true,
      },
      {
        name: "workflowType",
        description: "Optional workflow label such as spreadsheet_enrichment or company_direction_analysis",
        required: false,
      },
    ],
    messages: (args: Record<string, string>) => [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Run this task as a fully traceable execution workflow.

Title: ${args.workflowTitle}
Goal: ${args.workflowGoal}
Workflow type: ${args.workflowType || "execution_trace"}

Required operating loop:
1. Call start_execution_run first. Create one durable run before doing substantive work.
2. Record every meaningful action with record_execution_step. Do this for inspect, research, edit, verify, export, and issue-fix steps.
3. Attach evidence as you go with attach_execution_evidence. Store URLs, uploaded files, renders, screenshots, logs, and notes.
4. Record explicit choices with record_execution_decision. Capture alternatives considered, evidence basis, confidence, and limitations. Do not expose raw chain-of-thought.
5. Record QA checks with record_execution_verification. Use this for render checks, formula checks, diff checks, replay checks, or artifact integrity checks.
6. If a risky action needs human sign-off, call request_execution_approval before proceeding.
7. Finish with complete_execution_run and set the final status plus any drift summary if applicable.

Trace standard:
- Facts and outputs must be evidence-grounded.
- Decisions must separate verified evidence from inference.
- Verification must explain what was checked and what passed or failed.
- Limitations must be explicit instead of implied.

Do not treat the trace as optional. The run should be inspectable after completion by an operator who was not present during execution.`,
        },
      },
    ],
  },
  {
    name: "project-setup",
    description:
      "Guided project bootstrapping. Walks you through registering project context so the MCP has full project awareness.",
    arguments: [
      {
        name: "projectName",
        description: "Name of the project to set up",
        required: true,
      },
    ],
    messages: (args: Record<string, string>) => [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Help me set up NodeBench methodology tracking for project: ${args.projectName}

Please gather and record the following using the bootstrap_project tool:
1. Tech stack (languages, frameworks, runtimes)
2. Key dependency versions
3. Architecture overview
4. Build/test commands
5. Known conventions or patterns
6. Repository structure highlights

After bootstrapping, run a reconnaissance session with run_recon to check for latest updates on the project's key frameworks and SDKs.`,
        },
      },
    ],
  },
  {
    name: "spreadsheet-enrichment-trace",
    description:
      "Traceable workflow for spreadsheet enrichment: inspect workbook, research supporting evidence, edit cells, verify render/calculation quality, and export with receipts.",
    arguments: [
      {
        name: "fileUri",
        description: "Input spreadsheet path or URI",
        required: true,
      },
      {
        name: "goal",
        description: "What the spreadsheet workflow should achieve",
        required: true,
      },
    ],
    messages: (args: Record<string, string>) => [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Run a traceable spreadsheet-enrichment workflow.

Input spreadsheet: ${args.fileUri}
Goal: ${args.goal}

Workflow:
1. Start a run with start_execution_run using workflowName="spreadsheet_enrichment".
2. Inspect workbook structure, layout, formulas, and formatting. Record this with record_execution_step.
3. Attach the workbook and any rendered images as evidence with attach_execution_evidence.
4. If public research is needed, attach source URLs and record the evidence boundary.
5. Record major ranking or editing choices with record_execution_decision. Include alternatives considered and any unsupported claims.
6. Perform edits. Record the edit step and attach output artifacts or before/after references.
7. Verify the workbook. Record calculation checks, render checks, formatting checks, link cleanup, and export checks with record_execution_verification.
8. Complete the run only after the workbook is exported and the final verification state is known.

Required output discipline:
- Make changed cells traceable.
- Distinguish verified facts from inferred recommendations.
- Record any formatting or hyperlink cleanup as explicit fix steps.
- Leave behind enough evidence for another operator to replay what happened.`,
        },
      },
    ],
  },
  {
    name: "company-direction-analysis-trace",
    description:
      "Traceable workflow for capability-to-product-direction analysis grounded in public evidence, credibility filters, and phased recommendations.",
    arguments: [
      {
        name: "subjectCompany",
        description: "Company being evaluated",
        required: true,
      },
      {
        name: "strategicQuestion",
        description: "The product-direction or capability question being answered",
        required: true,
      },
    ],
    messages: (args: Record<string, string>) => [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Run a traceable company-direction analysis.

Subject company: ${args.subjectCompany}
Strategic question: ${args.strategicQuestion}

Required method:
1. Start a run with start_execution_run using workflowName="company_direction_analysis".
2. Gather public evidence first. Attach company pages, press, resumes, hiring signals, papers, and adjacent market references as evidence.
3. Call compute_dimension_profile as soon as you have enough evidence to ground the company state. Then use export_dimension_bundle to inspect the regime label, policy context, evidence rows, and interaction effects.
4. Record a decision boundary between:
   - publicly supported facts
   - supported but incomplete claims
   - not established by public evidence
5. Build a credibility filter and a dimension-aware regime summary. Record explicit decisions for high-credibility, medium-credibility, and low-credibility directions, and tie them to capital, capability, network, market, operations, and narrative dimensions where relevant.
6. Record the final recommendation as a structured decision with alternatives considered, evidence basis, confidence, limitations, and the regime you believe the company is operating under.
7. Record at least one verification step that checks the final memo still reflects the truth boundary, the exported dimension bundle, and does not overclaim pedigree.
8. Complete the run after the recommendation, limitations, evidence links, and dimension bundle references are all attached.

Output rules:
- Recommendations must stay adjacent to reputation and public proof.
- Unsupported claims must be clearly labeled as unsupported.
- Distinguish verified, estimated, inferred, and unavailable dimension signals.
- The trace should let another operator audit why a direction was recommended or rejected.`,
        },
      },
    ],
  },
  {
    name: "agent-delegation-with-approval-trace",
    description:
      "Traceable workflow for delegated agent work with approval gates. Use this when a capable agent can operate, but risky actions still need scoped human sign-off.",
    arguments: [
      {
        name: "task",
        description: "Delegated task description",
        required: true,
      },
      {
        name: "riskLevel",
        description: "Expected risk level: low, medium, or high",
        required: true,
      },
    ],
    messages: (args: Record<string, string>) => [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Run a delegated agent workflow with explicit approval boundaries.

Task: ${args.task}
Risk level: ${args.riskLevel}

Required process:
1. Start a run with start_execution_run using workflowName="agent_delegation".
2. Record the initial scope, intended tools, and expected outputs with record_execution_step.
3. Attach inputs, policies, and constraints as evidence.
4. Record any material choice or plan update with record_execution_decision.
5. Before any externally visible, destructive, or high-risk action, call request_execution_approval.
6. Only continue after the approval state is known, and record the resulting step explicitly.
7. Record verification that the final output stayed inside scope and honored the approval boundary.
8. Complete the run with the final status and limitations.

Trust requirements:
- The operator must be able to see what was attempted, what required approval, and what evidence justified the action.
- Do not hide uncertainty or skipped approvals inside prose summaries.`,
        },
      },
    ],
  },
  {
    name: "ui-qa-checklist",
    description:
      "UI/UX QA checklist for frontend implementations. Run after any change that touches React components, layouts, or interactions. Guides the agent through component tests, accessibility, responsive checks, and E2E validation.",
    arguments: [
      {
        name: "componentName",
        description:
          "The component or feature that changed (e.g. 'AgentStatusCard', 'Settings page dark mode')",
        required: true,
      },
    ],
    messages: (args: Record<string, string>) => [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You just implemented UI changes to: ${args.componentName}

Before declaring this work done, run the UI/UX QA checklist:

1. COMPONENT TESTS: Run \`npm run test:run\` — all component tests must pass
2. STORYBOOK: Run \`npm run storybook\` — verify the component renders in isolation
3. RESPONSIVE: Check at 375px, 768px, 1280px — layout must not break
4. ACCESSIBILITY: Tab through the UI, check aria-labels, run Storybook a11y panel
5. STATES: Verify loading, error, and empty states are handled
6. CONSOLE: Check browser devtools for errors/warnings
7. CAPTURE: Call capture_responsive_suite(url, label) to screenshot at 3 breakpoints
8. E2E: Run \`npm run test:e2e\` if relevant tests exist
9. LIGHTHOUSE: Run \`npm run perf:lighthouse\` for performance + accessibility scores

After checking each item, record results:
  call get_gate_preset("ui_ux_qa") to see the 8 evaluation rules
  evaluate each rule against ${args.componentName}
  call run_quality_gate(gateName: "ui_ux_qa", rules: [{name, passed}, ...]) with your boolean results
  call record_learning for any UI gotchas discovered

For the full step-by-step methodology, call getMethodology("ui_ux_qa").

Commands available:
  npm run test:run        — Vitest component tests
  npm run test:e2e        — Playwright E2E tests
  npm run storybook       — Storybook dev server (port 6006)
  npm run perf:lighthouse — Lighthouse audit
  npm run perf:bundle     — Bundle size analysis`,
        },
      },
    ],
  },
  {
    name: "parallel-agent-team",
    description:
      "Set up and coordinate a parallel agent team. Based on Anthropic's 'Building a C Compiler with Parallel Claudes' (Feb 2026). Guides multi-agent orchestration with task locking, role assignment, and progress tracking.",
    arguments: [
      {
        name: "projectGoal",
        description:
          "The overall project goal the team is working toward (e.g. 'Build REST API', 'Migrate auth system')",
        required: true,
      },
      {
        name: "agentCount",
        description:
          "Number of parallel agents (default: 4)",
        required: false,
      },
    ],
    messages: (args: Record<string, string>) => {
      const agentCount = parseInt(args.agentCount || "4", 10);
      return [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are coordinating a parallel agent team for: ${args.projectGoal}

This follows the pattern from Anthropic's "Building a C Compiler with Parallel Claudes" (Feb 2026).
Reference: https://www.anthropic.com/engineering/building-c-compiler

SETUP (run these in order):

1. ORIENT — Check what's already happening:
   call get_parallel_status({ includeHistory: true })
   call list_agent_tasks({ status: "all" })

2. PLAN ROLES — Assign ${agentCount} specialized agents:
   Recommended role split for ${agentCount} agents:
   ${agentCount >= 4 ? `- Agent 1: assign_agent_role({ role: "implementer", focusArea: "core features" })
   - Agent 2: assign_agent_role({ role: "test_writer", focusArea: "test coverage" })
   - Agent 3: assign_agent_role({ role: "code_quality_critic", focusArea: "refactoring" })
   - Agent 4: assign_agent_role({ role: "documentation_maintainer", focusArea: "docs and progress" })` :
   `- Agent 1: assign_agent_role({ role: "implementer" })
   - Agent 2: assign_agent_role({ role: "test_writer" })`}

3. BREAK DOWN WORK — Create task claims:
   For each independent piece of work:
   call claim_agent_task({ taskKey: "descriptive_snake_case", description: "What to do" })

4. WORK LOOP (each agent independently):
   a. claim_agent_task — Lock your task
   b. Do the work (implement, test, review)
   c. log_context_budget — Track context usage, avoid pollution
   d. run_oracle_comparison — Validate output against known-good reference
   e. release_agent_task — Release with progress note
   f. Pick next task (repeat)

5. ANTI-PATTERNS TO AVOID:
   - Two agents working on the same task (always claim first)
   - Dumping thousands of lines of test output (log to file, print summary)
   - Spending hours on one stuck problem (mark as blocked, move on)
   - Overwriting each other's changes (commit frequently, pull before push)

KEY INSIGHT from Anthropic: When all agents get stuck on the same bug (like compiling the Linux kernel),
use oracle-based testing to split the problem into independent sub-problems that each agent can solve in parallel.

For the full methodology: call getMethodology("parallel_agent_teams")`,
          },
        },
      ];
    },
  },
  {
    name: "oracle-test-harness",
    description:
      "Set up oracle-based testing for a component. Compares your implementation's output against a known-good reference to identify exactly which parts are broken. Enables parallel debugging by splitting failures into independent work items.",
    arguments: [
      {
        name: "componentName",
        description:
          "The component to validate (e.g. 'API response formatter', 'auth middleware', 'data pipeline')",
        required: true,
      },
      {
        name: "oracleSource",
        description:
          "Where the known-good reference comes from (e.g. 'production_v2', 'reference_impl', 'golden_files')",
        required: true,
      },
    ],
    messages: (args: Record<string, string>) => [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Set up oracle-based testing for: ${args.componentName}
Oracle source: ${args.oracleSource}

This follows the pattern from Anthropic's C Compiler project where GCC served as a
"known-good compiler oracle" to identify which specific files were broken.

SETUP:

1. DEFINE ORACLE — Capture known-good reference outputs:
   Run the reference implementation (${args.oracleSource}) on each test input.
   Save outputs as golden files or capture them in the oracle comparison tool.

2. RUN COMPARISONS — For each test case:
   call run_oracle_comparison({
     testLabel: "${args.componentName}_test_1",
     actualOutput: "<your implementation's output>",
     expectedOutput: "<oracle's output>",
     oracleSource: "${args.oracleSource}"
   })

3. TRIAGE FAILURES — Review diff summaries:
   Each failing comparison is an independent work item.
   Assign each to a different parallel agent via claim_agent_task.

4. BINARY SEARCH (for complex failures):
   If a test passes individually but fails when combined with others,
   use delta debugging: split the test set in half, test each half,
   narrow down to the minimal failing combination.
   (This is how Anthropic found pairs of files that failed together but worked independently.)

5. TRACK PROGRESS — Monitor convergence:
   call get_parallel_status to see how many oracle tests are still failing.
   As agents fix failures, the match percentage should trend toward 100%.

CONTEXT BUDGET TIP: Large test outputs pollute context. Instead of printing full output,
call log_context_budget to track usage and only show diff summaries (first 20 differing lines).

After all oracle tests pass:
  call record_learning with patterns discovered
  call run_mandatory_flywheel to verify the full change`,
        },
      },
    ],
  },
  {
    name: "claude-code-parallel",
    description:
      "Guide for using NodeBench MCP with Claude Code's native Task tool to run parallel subagents. Each subagent gets its own context window and can coordinate via shared NodeBench MCP tools (claim_agent_task, assign_agent_role, run_oracle_comparison). Use this when you want multiple Claude Code subagents working on independent tasks without duplicate effort.",
    arguments: [
      {
        name: "taskDescription",
        description:
          "The overall task to split across parallel subagents (e.g. 'Fix auth, add tests, update docs')",
        required: true,
      },
      {
        name: "subagentCount",
        description:
          "Number of parallel subagents to coordinate (default: 3)",
        required: false,
      },
    ],
    messages: (args: Record<string, string>) => {
      const count = parseInt(args.subagentCount || "3", 10);
      return [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are coordinating ${count} parallel Claude Code subagents for: ${args.taskDescription}

## How This Works

Claude Code's Task tool spawns subagents — each is an independent Claude instance with its own
context window. NodeBench MCP tools coordinate them via a shared SQLite database.

**Your role: COORDINATOR.** You break work into independent tasks and spawn subagents.
**Subagent role: WORKER.** Each claims a task, does work, releases with a progress note.

## Step-by-Step

### 1. PLAN — Break work into ${count} independent tasks
Identify ${count} pieces of work that can run in parallel without dependencies.
Each task should be independently completable and testable.

### 2. SPAWN — Launch subagents with coordination instructions
For each task, use the Task tool:

\`\`\`
Task tool call:
  prompt: "You have access to NodeBench MCP. Do the following:
    1. Call claim_agent_task({ taskKey: '<task_key>', description: '<what to do>' })
    2. Call assign_agent_role({ role: 'implementer', focusArea: '<area>' })
    3. Do the work
    4. Call log_context_budget({ eventType: 'checkpoint', tokensUsed: <estimate> })
    5. Call release_agent_task({ taskKey: '<task_key>', status: 'completed', progressNote: '<summary>' })
    6. Call record_learning({ key: '<key>', content: '<what you learned>', category: 'pattern' })"
\`\`\`

### 3. MONITOR — Check progress
After spawning all subagents:
  call get_parallel_status({ includeHistory: true })
  call list_agent_tasks({ status: "all" })

### 4. VALIDATE — Run oracle comparisons if applicable
If subagents produced outputs that should match a reference:
  call run_oracle_comparison for each output

### 5. GATE — Quality check the aggregate result
  call run_quality_gate with rules covering all ${count} tasks
  call run_mandatory_flywheel to verify the combined change

## Concrete IMPACT of This Workflow

| What NodeBench Adds             | Without It (bare subagents)           |
|---------------------------------|---------------------------------------|
| Task locks prevent duplicate work | Two subagents might fix the same bug |
| Role specialization             | All subagents do everything           |
| Context budget tracking         | Subagent runs out of context silently |
| Oracle comparisons              | No reference-based validation         |
| Progress notes for handoff      | Next session starts from scratch      |
| Learnings persisted             | Knowledge lost when subagent exits    |
| Quality gate on aggregate       | No validation that pieces fit together |

## Anti-Patterns
- DO NOT spawn subagents for work that has dependencies (sequential steps)
- DO NOT skip claim_agent_task — without it, two subagents may duplicate effort
- DO NOT dump large outputs into subagent context — use log_context_budget to track
- DO NOT forget release_agent_task — orphaned claims block future sessions

For the full parallel agent methodology: call getMethodology("parallel_agent_teams")`,
          },
        },
      ];
    },
  },
  {
    name: "bootstrap-parallel-agents",
    description:
      "Detect and scaffold parallel agent infrastructure for any project. Scans a target repo for 7 categories of parallel agent capabilities (task locking, roles, oracle testing, context budget, progress files, AGENTS.md, worktrees) and bootstraps what's missing. Uses the AI Flywheel closed loop: detect → scaffold → verify → fix → document.",
    arguments: [
      {
        name: "projectPath",
        description:
          "Absolute path to the target project root (e.g. '/home/user/their-project')",
        required: true,
      },
      {
        name: "techStack",
        description:
          "Target project's tech stack (e.g. 'TypeScript/React', 'Python/Django', 'Rust')",
        required: false,
      },
    ],
    messages: (args: Record<string, string>) => [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Bootstrap parallel agent infrastructure for: ${args.projectPath}
${args.techStack ? `Tech stack: ${args.techStack}` : ""}

This follows the AI Flywheel closed loop: detect → scaffold → verify → fix → document.

STEP 1 — DETECT (dry run first):
  call bootstrap_parallel_agents({
    projectRoot: "${args.projectPath}",
    dryRun: true,
    ${args.techStack ? `techStack: "${args.techStack}",` : ""}
    includeAgentsMd: true
  })

  Review the gap report. It scans 7 categories:
  - Task coordination (lock files, claim directories)
  - Role specialization (role configs, AGENTS.md mentions)
  - Oracle testing (golden files, reference outputs, snapshots)
  - Context budget tracking (budget configs, AGENTS.md mentions)
  - Progress files (PROGRESS.md, STATUS.md, claude-progress.txt)
  - AGENTS.md parallel section (parallel agent coordination protocol)
  - Git worktrees (for true parallel work)

STEP 2 — SCAFFOLD (create files):
  If gaps found, run with dryRun=false:
  call bootstrap_parallel_agents({
    projectRoot: "${args.projectPath}",
    dryRun: false,
    ${args.techStack ? `techStack: "${args.techStack}",` : ""}
    includeAgentsMd: true
  })

  This creates:
  - .parallel-agents/ directory with README, current_tasks/, oracle/, roles.json
  - progress.md template for agent orientation
  - AGENTS.md parallel section (or .parallel-append file for existing AGENTS.md)

STEP 3 — GENERATE AGENTS.MD (if needed):
  call generate_parallel_agents_md({
    ${args.techStack ? `techStack: "${args.techStack}",` : ""}
    projectName: "${args.projectPath.split("/").pop() || "project"}",
    maxAgents: 4,
    includeNodebenchSetup: true
  })

  Copy the output into the target repo's AGENTS.md.

STEP 4 — VERIFY (6-step flywheel):
  The bootstrap tool returns a flywheelPlan. Execute each step:
  1. Static analysis — verify scaffold files don't conflict
  2. Happy path — claim task → work → release → progress.md updated
  3. Conflict test — two claims on same task → second gets conflict
  4. Oracle test — create golden file → diff catches changes
  5. Gap re-scan — re-run bootstrap with dryRun=true → all gaps filled
  6. Document — record_learning with patterns discovered

STEP 5 — FIX (if anything fails):
  Fix the issue, then re-run from Step 4.

STEP 6 — DOCUMENT:
  call record_learning({
    key: "bootstrap_parallel_${args.projectPath.split("/").pop() || "project"}",
    content: "Bootstrapped parallel agent infrastructure for ${args.projectPath}. <summary of what was created and any issues found>",
    category: "pattern",
    tags: ["parallel-agents", "bootstrap", "external-repo"]
  })

For the full methodology: call getMethodology("parallel_agent_teams")`,
        },
      },
    ],
  },
  {
    name: "agent-contract",
    description:
      "The NodeBench Agent Contract — mandatory behavioral rules for any agent using NodeBench MCP. Embeds the 'front-door' pattern (4 meta-tools first), self-setup escalation, and the coordinator/subagent spawn template. Use this prompt to instruct an agent (or subagent) on HOW to use NodeBench tools correctly.",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `## NodeBench MCP Agent Contract

You are connected to NodeBench MCP. Follow these rules EXACTLY.

### FRONT DOOR — Always start here (before writing any code)
1. search_all_knowledge("<your current task>") — Check if this was solved before
2. getMethodology("mandatory_flywheel") — Load the verification pipeline
3. discover_tools("<your task>", { explain: true }) — Find the right tools for this job
4. get_workflow_chain("<workflow>") — Get step-by-step sequence (fix_bug, new_feature, etc.)

### SELF-SETUP — If a capability is missing
When discover_tools returns nothing useful, or a tool says "not configured":
1. Escalate toolset: If started on the default lane, switch to --preset power, --preset core, or targeted --toolsets
2. Resolve providers: Configure missing API keys (GEMINI_API_KEY, OPENAI_API_KEY, etc.)
3. Bootstrap infra: Run scaffold_nodebench_project or bootstrap_parallel_agents if repo lacks infra
4. Smoke-test: Re-run the first workflow chain step to confirm the capability is available

### BEFORE IMPLEMENTATION
- run_recon + log_recon_finding (if reconnaissance applies)
- assess_risk (HIGH risk = must get confirmation before proceeding)

### PARALLEL WORK
- MUST claim_agent_task before editing or designing anything
- MUST release_agent_task with a progress note + next action when done
- MUST log_context_budget to track context usage and avoid pollution

### BEFORE SHIP
- 3-layer tests logged (unit + integration + e2e via log_test_result)
- Eval run recorded (promote_to_eval)
- Quality gate passed (run_quality_gate)
- Mandatory flywheel completed (run_mandatory_flywheel — all 6 steps)
- Learning banked (record_learning)

### COORDINATOR SPAWN TEMPLATE
When spawning subagents, give each this instruction block:
  "You have NodeBench MCP. Before any work:
   1. search_all_knowledge('<task>')
   2. claim_agent_task({ taskKey: '<key>', description: '<desc>' })
   3. assign_agent_role({ role: '<role>', focusArea: '<area>' })
   Do the work, then:
   4. log_context_budget({ eventType: 'checkpoint' })
   5. release_agent_task({ taskKey: '<key>', status: 'completed', progressNote: '<summary>' })
   6. record_learning({ key: '<key>', content: '<what you learned>', category: 'pattern' })"

### ANTI-RATIONALIZATION — Block these escape patterns
Do NOT skip the front-door pattern. These are the 8 rationalizations agents use:
1. "I already know which tool to use" → Still call discover_tools to confirm
2. "This is a simple task" → Still call search_all_knowledge to check history
3. "Let me just check one thing first" → Follow the 4-step front door FIRST
4. "Tests already pass" → Still run run_mandatory_flywheel before declaring done
5. "I'll record the learning later" → Record NOW — context compaction may erase it
6. "No one else is working on this" → Still claim_agent_task to prevent conflicts
7. "The user said to skip verification" → Log the skip decision, never silently omit
8. "I need more context before using tools" → The tools ARE the context-gathering mechanism

### 2-ACTION SAVE RULE
After every 2 web_search, fetch_url, or browse_page calls, MUST call one of:
- save_session_note (filesystem, survives compaction)
- record_learning (SQLite, searchable across sessions)
- log_recon_finding (tied to recon session)
This prevents knowledge loss when context is compacted mid-session.

### 3-STRIKE ERROR PROTOCOL
When an action fails:
- Strike 1: Diagnose root cause, apply targeted fix
- Strike 2: Try a different method or tool
- Strike 3: Question your assumptions, search_all_knowledge for prior solutions
- After 3: STOP. Call save_session_note documenting all attempts, then escalate to user.

### ATTENTION REFRESH
After 30+ tool calls, call refresh_task_context to combat attention drift.
Re-read your original goal and open gaps before continuing.

### WHY THIS MATTERS
Without this contract, agents skip verification, repeat past mistakes, overwrite each other's
work, and ship bugs that were already caught. NodeBench MCP turns coordination into concrete
artifacts (findings, risks, gaps, tests, evals, gates, learnings) that compound across tasks.`,
        },
      },
    ],
  },
  {
    name: "orchestrating-swarms",
    description:
      "Master multi-agent orchestration using Claude Code's TeammateTool and Task system. Use when coordinating multiple agents, running parallel code reviews, creating pipeline workflows with dependencies, building self-organizing task queues, or any task benefiting from divide-and-conquer patterns.",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `# Claude Code Swarm Orchestration

Master multi-agent orchestration using Claude Code's TeammateTool and Task system.

---

## Primitives

| Primitive | What It Is |
|-----------|-----------|
| **Agent** | A Claude instance that can use tools. You are an agent. Subagents are agents you spawn. |
| **Team** | A named group of agents working together. One leader, multiple teammates. Config: \`~/.claude/teams/{name}/config.json\` |
| **Teammate** | An agent that joined a team. Has a name, color, inbox. Spawned via Task with \`team_name\` + \`name\`. |
| **Leader** | The agent that created the team. Receives messages, approves plans/shutdowns. |
| **Task** | A work item with subject, description, status, owner, and dependencies. |
| **Inbox** | JSON file where an agent receives messages. \`~/.claude/teams/{name}/inboxes/{agent}.json\` |
| **Backend** | How teammates run. Auto-detected: \`in-process\` (invisible), \`tmux\` (visible panes), \`iterm2\` (split panes). |

---

## Two Ways to Spawn Agents

### Method 1: Task Tool (Subagents) — short-lived, returns result directly
\`\`\`javascript
Task({ subagent_type: "Explore", description: "Find auth files", prompt: "...", model: "haiku" })
\`\`\`

### Method 2: Task + team_name + name (Teammates) — persistent, communicates via inbox
\`\`\`javascript
Teammate({ operation: "spawnTeam", team_name: "my-project" })
Task({ team_name: "my-project", name: "security-reviewer", subagent_type: "general-purpose", prompt: "...", run_in_background: true })
\`\`\`

| Aspect | Task (subagent) | Task + team_name + name (teammate) |
|--------|-----------------|-----------------------------------|
| Lifespan | Until task complete | Until shutdown requested |
| Communication | Return value | Inbox messages |
| Task access | None | Shared task list |
| Team membership | No | Yes |

---

## Built-in Agent Types

- **Bash** — command execution, git ops (tools: Bash only)
- **Explore** — read-only codebase search, file finding (use \`model: "haiku"\`)
- **Plan** — architecture + implementation plans (read-only tools)
- **general-purpose** — all tools, multi-step research + action
- **claude-code-guide** — questions about Claude Code, Agent SDK, Anthropic API
- **statusline-setup** — configure Claude Code status line

---

## TeammateTool Operations

| Operation | Who | What |
|-----------|-----|------|
| \`spawnTeam\` | Leader | Create team + task directory |
| \`discoverTeams\` | Anyone | List joinable teams |
| \`requestJoin\` | Teammate | Request to join existing team |
| \`approveJoin\` | Leader | Accept join request |
| \`write\` | Anyone | Message ONE teammate |
| \`broadcast\` | Anyone | Message ALL teammates (N messages — expensive, avoid) |
| \`requestShutdown\` | Leader | Ask teammate to exit |
| \`approveShutdown\` | Teammate | **MUST call** — sends confirmation, exits process |
| \`rejectShutdown\` | Teammate | Decline shutdown with reason |
| \`approvePlan\` | Leader | Approve plan_approval_request |
| \`rejectPlan\` | Leader | Reject plan with feedback |
| \`cleanup\` | Leader | Remove team + task files (all teammates must be shut down first) |

---

## Task System

\`\`\`javascript
TaskCreate({ subject: "Step 1", description: "...", activeForm: "Working on step 1..." })
TaskList()                                              // See all tasks + statuses
TaskGet({ taskId: "2" })                               // Get full task details
TaskUpdate({ taskId: "2", addBlockedBy: ["1"] })       // Dependency — auto-unblocks when #1 completes
TaskUpdate({ taskId: "2", owner: "worker-1", status: "in_progress" })
TaskUpdate({ taskId: "2", status: "completed" })
\`\`\`

---

## Orchestration Patterns

### Pattern 1: Parallel Specialists
\`\`\`javascript
Teammate({ operation: "spawnTeam", team_name: "pr-review" })
// Spawn reviewers in ONE message (parallel execution)
Task({ team_name: "pr-review", name: "security", subagent_type: "general-purpose", prompt: "Review for security issues. Send findings to team-lead via Teammate write.", run_in_background: true })
Task({ team_name: "pr-review", name: "perf",     subagent_type: "general-purpose", prompt: "Review for perf issues. Send findings to team-lead via Teammate write.", run_in_background: true })
// Collect from: cat ~/.claude/teams/pr-review/inboxes/team-lead.json
\`\`\`

### Pattern 2: Pipeline (Sequential Dependencies)
\`\`\`javascript
TaskCreate({ subject: "Research" })     // #1
TaskCreate({ subject: "Plan" })         // #2
TaskCreate({ subject: "Implement" })    // #3
TaskUpdate({ taskId: "2", addBlockedBy: ["1"] })   // #2 waits for #1
TaskUpdate({ taskId: "3", addBlockedBy: ["2"] })   // #3 waits for #2
// Spawn workers that poll TaskList and claim unblocked tasks
\`\`\`

### Pattern 3: Self-Organizing Swarm
\`\`\`javascript
// 1. Create N independent tasks (no dependencies)
// 2. Spawn M workers with this prompt loop:
//    a. TaskList → find pending+unclaimed task
//    b. TaskUpdate(claim) → TaskUpdate(in_progress) → do work
//    c. TaskUpdate(completed) → Teammate write findings to team-lead → repeat
//    d. If no tasks: notify team-lead idle, retry 3x, then exit
\`\`\`

### Pattern 4: Research → Implement (synchronous)
\`\`\`javascript
const research = await Task({ subagent_type: "general-purpose", prompt: "Research best practices for X..." })
Task({ subagent_type: "general-purpose", prompt: \`Implement based on research: \${research.content}\` })
\`\`\`

---

## Shutdown Sequence (always follow this order)

\`\`\`javascript
// 1. Request shutdown for all teammates
Teammate({ operation: "requestShutdown", target_agent_id: "worker-1", reason: "All tasks complete" })
// 2. Wait for {"type": "shutdown_approved"} in inbox
// 3. Only then cleanup
Teammate({ operation: "cleanup" })
\`\`\`

---

## Spawn Backends

| Backend | When auto-selected | Visibility |
|---------|-------------------|------------|
| \`in-process\` | Not in tmux/iTerm2 (default) | Hidden — no real-time output |
| \`tmux\` | Inside tmux session (\$TMUX set) | Visible — switch panes |
| \`iterm2\` | In iTerm2 + \`it2\` CLI installed | Visible — split panes |

Force: \`export CLAUDE_CODE_SPAWN_BACKEND=tmux\`

---

## Best Practices

1. **Meaningful names**: \`security-reviewer\` not \`worker-1\`
2. **Explicit prompts**: Numbered steps + "send findings to team-lead via Teammate write"
3. **Use dependencies**: \`addBlockedBy\` — never poll manually
4. **Prefer write over broadcast**: broadcast = N messages for N teammates
5. **Always cleanup**: Don't leave orphaned teams
6. **Worker failures**: 5-min heartbeat timeout; crashed worker tasks can be reclaimed by others

---

## Quick Reference

\`\`\`javascript
// Subagent (returns result)
Task({ subagent_type: "Explore", description: "Find files", prompt: "..." })

// Teammate (persistent, background)
Teammate({ operation: "spawnTeam", team_name: "my-team" })
Task({ team_name: "my-team", name: "worker", subagent_type: "general-purpose", prompt: "...", run_in_background: true })

// Message teammate
Teammate({ operation: "write", target_agent_id: "worker-1", value: "..." })

// Pipeline
TaskCreate({ subject: "Step 1" })   // → #1
TaskCreate({ subject: "Step 2" })   // → #2
TaskUpdate({ taskId: "2", addBlockedBy: ["1"] })

// Shutdown
Teammate({ operation: "requestShutdown", target_agent_id: "worker-1" })
// wait for {"type": "shutdown_approved"} in inbox...
Teammate({ operation: "cleanup" })
\`\`\`

---

*Source: kieranklaassen/orchestrating-swarms gist — Claude Code v2.1.19*`,
        },
      },
    ],
  },
  {
    name: "thompson-protocol",
    description:
      "The Thompson Protocol — 'Calculus Made Easy' approach to content creation. 4-agent pipeline that transforms complex topics into accessible, jargon-free content with analogies, visual metaphors, and anti-elitism safeguards. Use this prompt to instruct an agent on how to run the full Thompson content pipeline.",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `# The Thompson Protocol — "Calculus Made Easy" for AI Content

You are running the Thompson Protocol content pipeline. This is a multi-agent system
that transforms complex topics into content that makes the reader feel smart.

Named after Silvanus P. Thompson, who wrote "Calculus Made Easy" (1910) by attacking
the "preliminary terrors" — the intimidating jargon and elitist gatekeeping — before
teaching any mechanics.

## Pipeline (execute in order)

### Step 1: Initialize
\`\`\`
thompson_pipeline({ topic: "<your topic>", target_audience: "<audience>", output_format: "script|article|thread|explainer" })
\`\`\`
This returns the full execution plan with system prompts for each agent.

### Step 2: Write (Thompson Writer)
\`\`\`
thompson_write({ topic: "<topic>", target_audience: "<audience>" })
\`\`\`
Then use \`call_llm\` with the returned system_prompt to generate plain-English content.
Every technical term MUST have an "in other words..." analogy.

### Step 3: Edit (Feynman Editor — max 3 cycles)
\`\`\`
thompson_feynman_edit({ sections: "<writer output>", rewrite_cycle: 1 })
\`\`\`
The Skeptical Beginner reviews against 8 rejection criteria.
If any section gets REWRITE → send back to thompson_write with fix instructions.
Loop max 3 times. After 3, escalate stuck sections.

### Step 4: Visual Map
\`\`\`
thompson_visual_map({ sections: "<approved sections>", visual_style: "line_art" })
\`\`\`
Generates image prompts that map 1:1 with text analogies. No generic b-roll.

### Step 5: Anti-Elitism Lint
\`\`\`
thompson_anti_elitism_lint({ content: "<full text>" })
\`\`\`
Deterministic scan: 22 banned phrases, readability metrics, jargon density.
Zero LLM cost — pure regex + math.

### Step 6: Quality Gate
\`\`\`
thompson_quality_gate({ writer_output: "...", feynman_verdict: "...", lint_result: "..." })
\`\`\`
10-point boolean checklist → grade (exemplary/passing/needs_work/failing).
Only distribute if passing or exemplary.

## Core Principles (non-negotiable)
1. **Plain English Mandate**: Every jargon term gets an "in other words..." with a household analogy
2. **Intuition Before Mechanics**: Explain WHY before HOW
3. **Acknowledge Difficulty**: Validate reader confusion ("This sounds terrifying, but...")
4. **No Elitism**: Ban "it is obvious", "as we all know", "simply put", "just do X"
5. **Progressive Complexity**: Start with simplest true statement, layer up
6. **Visual = Analogy**: Every visual reinforces a specific text metaphor, 1:1
7. **12-Year-Old Bar**: If a 12-year-old can't understand it, rewrite it

## After Pipeline
- \`save_session_note\` — persist Thompson-processed content
- \`record_learning\` — log which analogies and styles worked best
- Use \`content_publish\` workflow chain for distribution`,
        },
      },
    ],
  },
];

// Server instructions — tells Claude Code Tool Search (and other clients) when to search
// for NodeBench tools. This is the key integration point for lazy loading compatibility.
// See: https://www.anthropic.com/engineering/advanced-tool-use
const SERVER_INSTRUCTIONS = `NodeBench MCP provides structured AI development methodology tools.
Use NodeBench tools when you need to:
- Verify implementations (verification cycles, gap tracking, 6-phase flywheel)
- Run evaluations and quality gates before shipping code
- Search prior knowledge and record learnings across sessions
- Assess risk before taking actions
- Coordinate parallel agents (task locks, roles, context budget)
- Research with structured recon (web search, GitHub, RSS feeds)
- Analyze files (CSV, PDF, XLSX, images, audio, ZIP)
- Run security audits (dependency scanning, code analysis, secrets detection)
- Write and polish academic papers
- Audit SEO, analyze Figma flows, detect Android flicker
- Call LLMs (GPT, Claude, Gemini) for analysis and extraction
Start with discover_tools("<your task>") to find the right tool.`;

const server = new Server(
  { name: "nodebench-mcp-methodology", version: NODEBENCH_VERSION },
  {
    capabilities: { tools: { listChanged: true }, prompts: {} },
    instructions: SERVER_INSTRUCTIONS,
  } as any, // SDK v1 may not type `instructions` but MCP spec supports it
);

// ── A/B Test Session Tracking ─────────────────────────────────────────
// Record session start for A/B comparison (static vs dynamic loading)
try {
  const db = getDb();
  db.prepare(
    "INSERT INTO ab_test_sessions (id, mode, initial_preset, initial_tool_count, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
  ).run(SESSION_ID, useDynamicLoading ? 'dynamic' : 'static', currentPreset, allTools.length);
} catch { /* instrumentation must not block server start */ }

// Handle tools/list — return all tools with their JSON Schema inputSchemas
// Includes MCP 2025-11-25 spec annotations: category, phase, complexity (model tier hint)
// + MCP security annotations: readOnlyHint, destructiveHint, openWorldHint
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools.map((t) => {
      const entry = TOOL_REGISTRY.get(t.name);
      const securityAnnotations = getToolAnnotations(t.name);
      return {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(entry ? {
          annotations: {
            title: toolNameToTitle(t.name),
            category: entry.category,
            phase: entry.phase,
            complexity: getToolComplexity(t.name),
            ...securityAnnotations,
          },
        } : {
          annotations: {
            title: toolNameToTitle(t.name),
            ...securityAnnotations,
          },
        }),
      };
    }),
  };
});

// Handle tools/call — dispatch to the matching tool handler (auto-instrumented)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  _abToolCallCount++;
  if (name === "load_toolset" || name === "unload_toolset") _abLoadEventCount++;

  // Intent-based auto-expansion: on first call, classify and load relevant toolsets
  if (!_intentClassified) {
    _intentClassified = true;
    const expanded = await classifyAndExpand(name, args as Record<string, unknown> | undefined);
    if (expanded) {
      console.error(`[intent-classify] Auto-loaded toolsets: ${expanded.join(", ")} (from tool: ${name})`);
    }
  }

  const tool = toolMap.get(name);
  if (!tool) {
    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  const startMs = Date.now();
  let resultStatus = "success";
  let errorMsg: string | null = null;

  try {
    const result = await tool.handler(args ?? {});

    // Detect soft errors (tools that return { error: true } without throwing)
    if (result && typeof result === "object" && !Array.isArray(result) && (result as any).error) {
      resultStatus = "error";
      errorMsg = (result as any).message ?? "soft error";
    }

    // Auto-log to main DB (skip self-eval tools to avoid recursion/noise)
    if (!SKIP_AUTO_LOG.has(name)) {
      try {
        const db = getDb();
        db.prepare(
          "INSERT INTO tool_call_log (id, session_id, tool_name, result_status, duration_ms, error, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
        ).run(genId("tcl"), SESSION_ID, name, resultStatus, Date.now() - startMs, errorMsg);
      } catch { /* never let instrumentation break tool dispatch */ }
    }

    // Auto-log to analytics tracker
    tracker.record(name, startMs, resultStatus === "success", errorMsg, args as Record<string, unknown>);

    // Inline A/B session counter update (every 5 calls — amortized cost)
    if (_abToolCallCount % 5 === 0) {
      try {
        const db2 = getDb();
        const dynamicallyLoaded = [...activeToolsets].filter(ts => !initialToolsetNames.has(ts));
        db2.prepare(
          "UPDATE ab_test_sessions SET total_tool_calls = ?, total_load_events = ?, final_tool_count = ?, toolsets_loaded = ? WHERE id = ?"
        ).run(_abToolCallCount, _abLoadEventCount, allTools.length, JSON.stringify(dynamicallyLoaded), SESSION_ID);
      } catch { /* instrumentation */ }
    }

    // Tools with rawContent return ContentBlock[] directly (e.g. image captures)
    if (tool.rawContent && Array.isArray(result)) {
      return { content: result, isError: false };
    }

    // Auto-append quickRef from registry (progressive disclosure)
    let enrichedResult = result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const quickRef = getQuickRef(name);
      if (quickRef && !(result as any)._quickRef) {
        enrichedResult = { ...(result as Record<string, unknown>), _quickRef: quickRef };
      }
    }

    // Lightweight hook: append save/refresh hints when thresholds are met
    const hookHint = getHookHint(name);

    // Serialize: TOON (~40% fewer tokens) or JSON
    let serialized: string;
    if (useToon) {
      try {
        serialized = await encodeToon(enrichedResult);
      } catch {
        serialized = JSON.stringify(enrichedResult, null, 2);
      }
    } else {
      serialized = JSON.stringify(enrichedResult, null, 2);
    }

    // Security: redact credentials from all tool outputs (single enforcement point)
    const sanitized = redactSecrets(serialized);

    const contentBlocks: Array<{ type: "text"; text: string }> = [
      { type: "text" as const, text: sanitized },
    ];
    if (hookHint) {
      contentBlocks.push({ type: "text" as const, text: hookHint });
    }

    // Audit log: successful tool call
    auditLog("tool_call", name, JSON.stringify(args ?? {}).substring(0, 200), true);

    return {
      content: contentBlocks,
      isError: false,
    };
  } catch (err: any) {
    // Security errors get a clean response (not a stack trace)
    if (err instanceof SecurityError) {
      auditLog("tool_call", name, JSON.stringify(args ?? {}).substring(0, 200), false, err.message);
      return {
        content: [{ type: "text" as const, text: `[SECURITY] ${err.message}` }],
        isError: true,
      };
    }

    resultStatus = "error";
    errorMsg = err?.message || "Internal error";

    // Auto-log errors to main DB
    if (!SKIP_AUTO_LOG.has(name)) {
      try {
        const db = getDb();
        db.prepare(
          "INSERT INTO tool_call_log (id, session_id, tool_name, result_status, duration_ms, error, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
        ).run(genId("tcl"), SESSION_ID, name, resultStatus, Date.now() - startMs, errorMsg);
      } catch { /* never let instrumentation break tool dispatch */ }
    }

    // Auto-log error to analytics tracker
    tracker.record(name, startMs, false, errorMsg, args as Record<string, unknown>);

    return {
      content: [{ type: "text" as const, text: errorMsg }],
      isError: true,
    };
  }
});

// Handle prompts/list — return available prompts for agent discovery
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
      ...(("arguments" in p && p.arguments) ? { arguments: p.arguments } : {}),
    })),
  };
});

// Handle prompts/get — return prompt messages
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const prompt = PROMPTS.find((p) => p.name === name);
  if (!prompt) {
    throw new Error(
      `Unknown prompt: ${name}. Available: ${PROMPTS.map((p) => p.name).join(", ")}`
    );
  }

  const messages =
    typeof prompt.messages === "function"
      ? prompt.messages(args ?? {})
      : prompt.messages;

  return {
    description: prompt.description,
    messages,
  };
});

// Graceful shutdown: close analytics tracker + finalize A/B session on exit
process.on('exit', () => {
  tracker.close();

  // Finalize A/B test session with aggregate metrics
  try {
    const db = getDb();
    const dynamicallyLoaded = [...activeToolsets].filter(ts => !initialToolsetNames.has(ts));
    db.prepare(
      `UPDATE ab_test_sessions SET
        final_tool_count = ?,
        toolsets_loaded = ?,
        total_tool_calls = ?,
        total_load_events = ?,
        session_duration_ms = ?,
        ended_at = datetime('now')
      WHERE id = ?`
    ).run(
      allTools.length,
      JSON.stringify(dynamicallyLoaded),
      _abToolCallCount,
      _abLoadEventCount,
      Date.now() - _abStartMs,
      SESSION_ID,
    );
  } catch { /* instrumentation must not block shutdown */ }
});

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);

// Start local dashboard servers only when explicitly requested.
let operatingDashboardPort = 0;
if (runtimeFlags.enableDashboards) {
  try {
    operatingDashboardPort = await startOperatingDashboardServer(getDb(), 6274);
  } catch { /* operating dashboard is optional — don't block MCP */ }
}

// UI Dive dashboard is secondary — also admin-only
let dashboardPort = 0;
if (runtimeFlags.enableDashboards) {
  try {
    dashboardPort = await startDashboardServer(getDb(), 6278);
  } catch { /* dashboard is optional — don't block MCP */ }
}

// Start engine API server (non-blocking, best-effort)
let enginePort = 0;
if (useEngine) {
  try {
    enginePort = await startEngineServer({
      toolMap,
      allTools,
      workflowChains: WORKFLOW_CHAINS,
      presets: PRESETS,
      toolsetMap: TOOLSET_MAP,
      toolToToolset: TOOL_TO_TOOLSET,
      secret: engineSecret,
    }, 6276);
  } catch { /* engine is optional — don't block MCP */ }
}

// Start observability watchdog only when explicitly requested.
if (runtimeFlags.enableWatchdog) {
  try {
    initObservability(getDb);
    startWatchdog(getDb());
  } catch { /* observability is optional — don't block MCP */ }
}

// Graceful shutdown
process.on("SIGINT", () => { stopWatchdog(); process.exit(0); });
process.on("SIGTERM", () => { stopWatchdog(); process.exit(0); });

const toolsetInfo = cliArgs.includes("--toolsets") || cliArgs.includes("--exclude") || cliArgs.includes("--preset")
  ? ` [gated: ${domainTools.length} domain + 2 meta]`
  : "";
const dashInfo = operatingDashboardPort ? ` dashboard at http://127.0.0.1:${operatingDashboardPort}` : "";
const uiDiveInfo = dashboardPort ? ` ui-dive at http://127.0.0.1:${dashboardPort}` : "";
const engineInfo = enginePort ? ` engine at http://127.0.0.1:${enginePort}` : "";
const runtimeInfo = runtimeFlags.enableDashboards || runtimeFlags.enableWatchdog
  ? " admin-runtime"
  : " core-runtime";
console.error(`${CLI_COMMAND} ready (${allTools.length} tools, ${PROMPTS.length} prompts${toolsetInfo}, SQLite at ~/.nodebench/${dashInfo}${uiDiveInfo}${engineInfo}${runtimeInfo})`);

// ── Auto-brief on first start (delta/hackathon presets) ──────────────
// When using delta or hackathon preset, auto-run delta_brief on first session
// to give users immediate value before they even ask.
const presetIdx2 = cliArgs.indexOf("--preset");
const activePreset = presetIdx2 >= 0 ? cliArgs[presetIdx2 + 1] : "";
if (activePreset === "hackathon" || activePreset === "delta" || cliArgs.includes("--auto-brief")) {
  (async () => {
    try {
      const { createDeltaTools } = await import("./tools/deltaTools.js");
      const dTools = createDeltaTools();
      const briefTool = dTools.find((t) => t.name === "delta_brief");
      if (briefTool) {
        const result = await briefTool.handler({ persona: "founder" });
        const text = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          const comp = parsed.compounding;
          console.error(`[delta] Auto-brief: ${comp?.totalPackets ?? 0} packets, ${comp?.watchedCount ?? 0} watched, ${comp?.daysSinceFirst ?? 0} days active`);
        }
      }
    } catch { /* auto-brief is best-effort */ }
  })();
}
