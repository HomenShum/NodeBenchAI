/**
 * Toolset Registry — Lazy-loading TOOLSET_MAP
 *
 * Uses dynamic imports so only the domains actually requested by a preset
 * are loaded at startup. For example, the `default` preset (28 domains, ~81
 * tools) no longer forces Node to parse all 65 tool files (~62 000 lines).
 *
 * Backward-compatible: TOOLSET_MAP and TOOL_TO_TOOLSET are still exported
 * as mutable objects that get populated after `loadToolsets()` resolves.
 */

import {
  ALL_REGISTRY_ENTRIES,
  TOOL_REGISTRY,
  type ToolRegistryEntry,
} from "./tools/toolRegistry.js";
import type { McpTool } from "./types.js";

// ── Lazy loaders — one per domain key ──────────────────────────────────────

/**
 * Each loader is an async factory that dynamic-imports its tool file(s) and
 * returns the flat McpTool[] array for that domain.
 */
export const TOOLSET_LOADERS: Record<string, () => Promise<McpTool[]>> = {
  core_workflow: async () => {
    const { coreWorkflowTools, coreSyncTools } = await import("./tools/coreWorkflowTools.js");
    return [...coreWorkflowTools, ...coreSyncTools];
  },
  nodebench_research: async () => {
    const { nodebenchResearchTools } = await import("./tools/nodebenchResearchTools.js");
    return nodebenchResearchTools;
  },
  verification: async () => {
    const { verificationTools } = await import("./tools/verificationTools.js");
    return verificationTools;
  },
  eval: async () => {
    const { evalTools } = await import("./tools/evalTools.js");
    return evalTools;
  },
  quality_gate: async () => {
    const { qualityGateTools } = await import("./tools/qualityGateTools.js");
    return qualityGateTools;
  },
  learning: async () => {
    const { learningTools } = await import("./tools/learningTools.js");
    return learningTools;
  },
  flywheel: async () => {
    const { flywheelTools } = await import("./tools/flywheelTools.js");
    return flywheelTools;
  },
  autonomous_delivery: async () => {
    const { autonomousDeliveryTools } = await import("./tools/autonomousDeliveryTools.js");
    return autonomousDeliveryTools;
  },
  sync_bridge: async () => {
    const { syncBridgeTools } = await import("./tools/syncBridgeTools.js");
    return syncBridgeTools;
  },
  shared_context: async () => {
    const { sharedContextTools } = await import("./tools/sharedContextTools.js");
    return sharedContextTools;
  },
  recon: async () => {
    const { reconTools } = await import("./tools/reconTools.js");
    return reconTools;
  },
  ui_capture: async () => {
    const { uiCaptureTools } = await import("./tools/uiCaptureTools.js");
    return uiCaptureTools;
  },
  vision: async () => {
    const { visionTools } = await import("./tools/visionTools.js");
    return visionTools;
  },
  local_file: async () => {
    const { localFileTools } = await import("./tools/localFileTools.js");
    return localFileTools;
  },
  web: async () => {
    const { webTools } = await import("./tools/webTools.js");
    return webTools;
  },
  github: async () => {
    const { githubTools } = await import("./tools/githubTools.js");
    return githubTools;
  },
  docs: async () => {
    const { documentationTools } = await import("./tools/documentationTools.js");
    return documentationTools;
  },
  bootstrap: async () => {
    const { agentBootstrapTools } = await import("./tools/agentBootstrapTools.js");
    return agentBootstrapTools;
  },
  self_eval: async () => {
    const { selfEvalTools } = await import("./tools/selfEvalTools.js");
    return selfEvalTools;
  },
  parallel: async () => {
    const { parallelAgentTools } = await import("./tools/parallelAgentTools.js");
    return parallelAgentTools;
  },
  llm: async () => {
    const { llmTools } = await import("./tools/llmTools.js");
    return llmTools;
  },
  security: async () => {
    const { securityTools } = await import("./tools/securityTools.js");
    return securityTools;
  },
  platform: async () => {
    const { platformTools } = await import("./tools/platformTools.js");
    return platformTools;
  },
  research_writing: async () => {
    const { researchWritingTools } = await import("./tools/researchWritingTools.js");
    return researchWritingTools;
  },
  flicker_detection: async () => {
    const { flickerDetectionTools } = await import("./tools/flickerDetectionTools.js");
    return flickerDetectionTools;
  },
  figma_flow: async () => {
    const { figmaFlowTools } = await import("./tools/figmaFlowTools.js");
    return figmaFlowTools;
  },
  boilerplate: async () => {
    const { boilerplateTools } = await import("./tools/boilerplateTools.js");
    return boilerplateTools;
  },
  benchmark: async () => {
    const { cCompilerBenchmarkTools } = await import("./tools/cCompilerBenchmarkTools.js");
    return cCompilerBenchmarkTools;
  },
  longitudinal_benchmark: async () => {
    const { benchmarkTools } = await import("./benchmarks/benchmarkTools.js");
    return benchmarkTools;
  },
  session_memory: async () => {
    const { sessionMemoryTools } = await import("./tools/sessionMemoryTools.js");
    return sessionMemoryTools;
  },
  workspace: async () => {
    const { workspaceTools } = await import("./tools/workspaceTools.js");
    return workspaceTools;
  },
  gaia_solvers: async () => {
    const { gaiaMediaSolvers } = await import("./tools/localFileTools.js");
    return gaiaMediaSolvers;
  },
  toon: async () => {
    const { toonTools } = await import("./tools/toonTools.js");
    return toonTools;
  },
  pattern: async () => {
    const { patternTools } = await import("./tools/patternTools.js");
    return patternTools;
  },
  git_workflow: async () => {
    const { gitWorkflowTools } = await import("./tools/gitWorkflowTools.js");
    return gitWorkflowTools;
  },
  seo: async () => {
    const { seoTools } = await import("./tools/seoTools.js");
    return seoTools;
  },
  voice_bridge: async () => {
    const { voiceBridgeTools } = await import("./tools/voiceBridgeTools.js");
    return voiceBridgeTools;
  },
  critter: async () => {
    const { critterTools } = await import("./tools/critterTools.js");
    return critterTools;
  },
  email: async () => {
    const { emailTools } = await import("./tools/emailTools.js");
    return emailTools;
  },
  rss: async () => {
    const { rssTools } = await import("./tools/rssTools.js");
    return rssTools;
  },
  architect: async () => {
    const { architectTools } = await import("./tools/architectTools.js");
    return architectTools;
  },
  ui_ux_dive: async () => {
    const { uiUxDiveTools } = await import("./tools/uiUxDiveTools.js");
    return uiUxDiveTools;
  },
  mcp_bridge: async () => {
    const { mcpBridgeTools } = await import("./tools/mcpBridgeTools.js");
    return mcpBridgeTools;
  },
  ui_ux_dive_v2: async () => {
    const { uiUxDiveAdvancedTools } = await import("./tools/uiUxDiveAdvancedTools.js");
    return uiUxDiveAdvancedTools;
  },
  skill_update: async () => {
    const { skillUpdateTools } = await import("./tools/skillUpdateTools.js");
    return skillUpdateTools;
  },
  qa_orchestration: async () => {
    const { overstoryTools } = await import("./tools/overstoryTools.js");
    return overstoryTools;
  },
  visual_qa: async () => {
    const { visualQaTools } = await import("./tools/visualQaTools.js");
    return visualQaTools;
  },
  local_dashboard: async () => {
    const { localDashboardTools } = await import("./tools/localDashboardTools.js");
    return localDashboardTools;
  },
  design_governance: async () => {
    const { designGovernanceTools } = await import("./tools/designGovernanceTools.js");
    return designGovernanceTools;
  },
  agent_traverse: async () => {
    const { agentTraverseTools } = await import("./tools/openclawTools.js");
    return agentTraverseTools;
  },
  engine_context: async () => {
    const { contextTools } = await import("./tools/contextTools.js");
    return contextTools;
  },
  context_sandbox: async () => {
    const { contextSandboxTools } = await import("./tools/contextSandboxTools.js");
    return contextSandboxTools;
  },
  research_optimizer: async () => {
    const { researchOptimizerTools } = await import("./tools/researchOptimizerTools.js");
    return researchOptimizerTools;
  },
  web_scraping: async () => {
    const { scraplingTools } = await import("./tools/scraplingTools.js");
    return scraplingTools;
  },
  thompson_protocol: async () => {
    const { createThompsonProtocolTools } = await import("./tools/thompsonProtocolTools.js");
    return createThompsonProtocolTools();
  },
  observability: async () => {
    const { observabilityTools } = await import("./tools/observabilityTools.js");
    return observabilityTools;
  },
  profiler: async () => {
    const { profilerTools } = await import("./tools/profilerTools.js");
    return profilerTools;
  },
  sweep: async () => {
    const { sweepTools } = await import("./tools/sweepTools.js");
    return sweepTools;
  },
  monte_carlo: async () => {
    const { monteCarloTools } = await import("./tools/monteCarloTools.js");
    return monteCarloTools;
  },
  temporal_intelligence: async () => {
    const { temporalIntelligenceTools } = await import("./tools/temporalIntelligenceTools.js");
    return temporalIntelligenceTools;
  },
  execution_trace: async () => {
    const { executionTraceTools } = await import("./tools/executionTraceTools.js");
    return executionTraceTools;
  },
  mission_harness: async () => {
    const [mh, dim] = await Promise.all([
      import("./tools/missionHarnessTools.js"),
      import("./tools/dimensionTools.js"),
    ]);
    return [...mh.missionHarnessTools, ...dim.dimensionTools];
  },
  deep_sim: async () => {
    const { deepSimTools } = await import("./tools/deepSimTools.js");
    return deepSimTools;
  },
  federated_search: async () => {
    const { federatedSearchTools } = await import("./tools/federatedSearchTools.js");
    return federatedSearchTools;
  },
  dogfood_judge: async () => {
    const [dj, lj] = await Promise.all([
      import("./tools/dogfoodJudgeTools.js"),
      import("./tools/llmJudgeLoop.js"),
    ]);
    return [...dj.dogfoodJudgeTools, ...lj.llmJudgeLoopTools];
  },
  founder: async () => {
    const [f, ft, cm, lp, ci, so, om] = await Promise.all([
      import("./tools/founderTools.js"),
      import("./tools/founderTrackingTools.js"),
      import("./tools/causalMemoryTools.js"),
      import("./tools/founderLocalPipeline.js"),
      import("./tools/contextInjection.js"),
      import("./tools/founderStrategicOpsTools.js"),
      import("./tools/founderOperatingModelTools.js"),
    ]);
    const combined = [
      ...f.founderTools,
      ...ft.founderTrackingTools,
      ...cm.causalMemoryTools,
      ...lp.founderLocalPipelineTools,
      ...so.founderStrategicOpsTools,
      ...om.founderOperatingModelTools,
      ...ci.contextInjectionTools,
    ];
    const seen = new Set<string>();
    return combined.filter((tool) => {
      if (seen.has(tool.name)) return false;
      seen.add(tool.name);
      return true;
    });
  },
  entity_enrichment: async () => {
    const { entityEnrichmentTools } = await import("./tools/entityEnrichmentTools.js");
    return entityEnrichmentTools;
  },
  scenario_compiler: async () => {
    const { scenarioCompilerTools } = await import("./tools/scenarioCompilerTools.js");
    return scenarioCompilerTools;
  },
  packet_compiler: async () => {
    const { packetCompilerTools } = await import("./tools/packetCompilerTools.js");
    return packetCompilerTools;
  },
  plan_synthesis: async () => {
    const { planSynthesisTools } = await import("./tools/planSynthesisTools.js");
    return planSynthesisTools;
  },
  entity_temporal: async () => {
    const { entityTemporalTools } = await import("./tools/entityTemporalTools.js");
    return entityTemporalTools;
  },
  entity_lookup: async () => {
    const { entityLookupTools } = await import("./tools/entityLookupTools.js");
    return entityLookupTools;
  },
  site_map: async () => {
    const { sitemapTools } = await import("./tools/sitemapTools.js");
    return sitemapTools;
  },
  savings: async () => {
    const { savingsTools } = await import("./tools/savingsTools.js");
    return savingsTools;
  },
  delta: async () => {
    const { createDeltaTools } = await import("./tools/deltaTools.js");
    return createDeltaTools();
  },
  subconscious: async () => {
    const { subconsciousTools } = await import("./subconscious/index.js");
    return subconsciousTools;
  },
  claude_code_ingest: async () => {
    const { createClaudeCodeIngestTools } = await import("./tools/claudeCodeIngestTools.js");
    return createClaudeCodeIngestTools();
  },
  graphify: async () => {
    const { graphifyTools } = await import("./tools/graphifyTools.js");
    return graphifyTools;
  },
};

// ── All known domain keys (available before any load) ──────────────────────

/** Every domain key in the registry, usable for validation / enumeration. */
export const ALL_DOMAIN_KEYS: string[] = Object.keys(TOOLSET_LOADERS);

// ── Mutable singletons populated by loadToolsets() ─────────────────────────

/**
 * Backward-compatible TOOLSET_MAP. Starts empty and is populated
 * incrementally by `loadToolsets()`.  Code that enumerates keys before
 * loading will see an empty object — call `loadToolsets()` first.
 */
export const TOOLSET_MAP: Record<string, McpTool[]> = {};

/** Reverse index: tool name → domain key. Populated by `loadToolsets()`. */
export const TOOL_TO_TOOLSET = new Map<string, string>();

const QUIET_CROSS_DOMAIN_DUPLICATES: Record<string, string> = {
  detect_contradictions: "entity_enrichment",
  log_tool_call: "self_eval",
};

const SYNTHETIC_PHASE_BY_DOMAIN: Partial<Record<string, ToolRegistryEntry["phase"]>> = {
  core_workflow: "research",
  nodebench_research: "research",
  shared_context: "utility",
  workspace: "implement",
  profiler: "utility",
  sweep: "research",
  monte_carlo: "research",
  entity_lookup: "research",
  site_map: "research",
  savings: "research",
  delta: "research",
  subconscious: "research",
  graphify: "research",
};

function inferSyntheticPhase(domain: string, tool: McpTool): ToolRegistryEntry["phase"] {
  const explicit = SYNTHETIC_PHASE_BY_DOMAIN[domain];
  if (explicit) return explicit;
  if (tool.annotations?.readOnlyHint) return "research";
  if (/^(create_|write_|save_|record_|upsert_|manage_)/.test(tool.name)) return "implement";
  if (/^(run_|simulate_|benchmark_)/.test(tool.name)) return "test";
  if (/^(get_|list_|read_|query_)/.test(tool.name)) return "utility";
  return "utility";
}

function buildSyntheticTags(domain: string, tool: McpTool): string[] {
  const descriptionTokens = tool.description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .slice(0, 6);
  const nameTokens = tool.name.split("_").filter((token) => token.length >= 3);
  return [...new Set([domain, ...nameTokens, ...descriptionTokens])];
}

function registerSyntheticRegistryEntries(domain: string, tools: McpTool[]): void {
  for (const tool of tools) {
    if (TOOL_REGISTRY.has(tool.name)) continue;
    const entry: ToolRegistryEntry = {
      name: tool.name,
      category: domain,
      tags: buildSyntheticTags(domain, tool),
      quickRef: {
        nextAction: `Use ${tool.name} when you need ${tool.description.toLowerCase()}`,
        nextTools: ["discover_tools"],
        methodology: domain,
        tip: "This is a synthetic registry entry generated from the toolset loader so discovery and coverage stay truthful.",
      },
      phase: inferSyntheticPhase(domain, tool),
      complexity: "medium",
    };
    ALL_REGISTRY_ENTRIES.push(entry);
    TOOL_REGISTRY.set(tool.name, entry);
  }
}

// ── Loader ─────────────────────────────────────────────────────────────────

/** Track which domains have already been loaded to avoid redundant imports. */
const _loaded = new Set<string>();

/**
 * Dynamically load one or more tool domains into TOOLSET_MAP.
 *
 * - Only imports files for the requested domains (skips already-loaded ones).
 * - Populates TOOLSET_MAP and TOOL_TO_TOOLSET as a side-effect.
 * - Returns the flat array of all tools across the requested domains.
 *
 * @param selectedDomains  Array of domain keys (must exist in TOOLSET_LOADERS)
 * @returns Flat McpTool[] of all loaded tools
 */
export async function loadToolsets(selectedDomains: string[]): Promise<McpTool[]> {
  const toLoad = selectedDomains.filter((d) => !_loaded.has(d) && TOOLSET_LOADERS[d]);
  const unknown = selectedDomains.filter((d) => !TOOLSET_LOADERS[d]);
  if (unknown.length > 0) {
    console.error(`[toolsetRegistry] Unknown domains skipped: ${unknown.join(", ")}`);
  }

  if (toLoad.length > 0) {
    const results = await Promise.all(
      toLoad.map(async (domain) => {
        const tools = await TOOLSET_LOADERS[domain]();
        return { domain, tools };
      })
    );

    for (const { domain, tools } of results) {
      const uniqueTools: McpTool[] = [];
      const domainSeen = new Set<string>();

      for (const tool of tools) {
        if (domainSeen.has(tool.name)) {
          console.error(`[toolsetRegistry] Duplicate tool skipped in ${domain}: ${tool.name}`);
          continue;
        }
        if (TOOL_TO_TOOLSET.has(tool.name)) {
          const firstOwner = TOOL_TO_TOOLSET.get(tool.name);
          if (firstOwner && QUIET_CROSS_DOMAIN_DUPLICATES[tool.name] === firstOwner) {
            continue;
          }
          console.error(
            `[toolsetRegistry] Duplicate tool skipped across domains: ${tool.name} (${firstOwner} keeps ownership, ${domain} skipped)`
          );
          continue;
        }
        domainSeen.add(tool.name);
        uniqueTools.push(tool);
        TOOL_TO_TOOLSET.set(tool.name, domain);
      }
      TOOLSET_MAP[domain] = uniqueTools;
      registerSyntheticRegistryEntries(domain, uniqueTools);
      _loaded.add(domain);
    }

    const totalNew = results.reduce((s, r) => s + (TOOLSET_MAP[r.domain]?.length ?? 0), 0);
    console.error(
      `[toolsetRegistry] Loaded ${toLoad.length} domain(s) (${totalNew} tools): ${toLoad.join(", ")}`
    );
  }

  // Return flat array of ALL tools across the requested domains (including previously loaded)
  return selectedDomains.flatMap((d) => TOOLSET_MAP[d] ?? []);
}

/**
 * Load ALL domains. Convenience for `--preset full` or analysis scripts.
 */
export async function loadAllToolsets(): Promise<McpTool[]> {
  return loadToolsets(ALL_DOMAIN_KEYS);
}
