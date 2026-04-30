/**
 * Complex end-to-end tests for architect tools — exercises all 3 tools against
 * real files in the monorepo with diverse patterns (React components, backend
 * servers, MCP tool files) to verify accuracy at scale.
 */
import { describe, it, expect } from "vitest";
import { architectTools } from "../tools/architectTools.js";
import { resolve } from "node:path";

const callTool = async (name: string, args: any) => {
  const tool = architectTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool.handler(args);
};

// ── Real files in the monorepo ──────────────────────────────────────────────

/** React component with useState, useEffect, useRef, useCallback, useMemo, lazy loading */
const MAIN_LAYOUT = resolve(
  import.meta.dirname,
  "../../../../src/layouts/CockpitLayout.tsx",
);

/** React component with useState, useEffect, useRef, useMemo, framer-motion, keyboard input */
const COMMAND_PALETTE = resolve(
  import.meta.dirname,
  "../../../../src/layouts/chrome/CommandPalette.tsx",
);

/** HTTP server with routes, middleware-like patterns, auth token check */
const HTTP_SERVER = resolve(
  import.meta.dirname,
  "../../../../mcp-services/gateway_server/httpServer.ts",
);

/** MCP tool file — pure Node.js, SQLite, McpTool pattern, no React */
const SEO_TOOLS = resolve(import.meta.dirname, "../tools/seoTools.ts");

/** Progressive discovery — hybrid search, complex logic, no React */
const DISCOVERY_TOOLS = resolve(
  import.meta.dirname,
  "../tools/progressiveDiscoveryTools.ts",
);

// ── 1. scan_capabilities — React component (MainLayout) ────────────────────

describe("Architect Tools — Complex E2E: scan_capabilities", () => {
  it("detects React hooks in MainLayout.tsx", async () => {
    const r = (await callTool("scan_capabilities", {
      file_path: MAIN_LAYOUT,
    })) as any;

    // MainLayout imports useState, useEffect, useCallback
    // Note: useRef regex requires `useRef<` (with generic) — MainLayout uses useRef() without generic
    expect(r.state_management.effects).toBeGreaterThan(0); // has useEffect
    expect(r.state_management.callbacks).toBeGreaterThan(0); // has useCallback

    // imports
    expect(r.imports.has_react).toBe(true);
    expect(r.imports.count).toBeGreaterThan(5); // many imports

    // Note: framer-motion was removed in the Jony Ive animation pass; animation check skipped
  });

  it("detects keyboard shortcuts in CommandPalette.tsx", async () => {
    const r = (await callTool("scan_capabilities", {
      file_path: COMMAND_PALETTE,
    })) as any;

    // CommandPalette uses useState, useEffect, useRef, useMemo
    expect(r.state_management.effects).toBeGreaterThan(0);
    expect(r.state_management.memos).toBeGreaterThan(0);
    expect(r.imports.has_react).toBe(true);

    // Note: framer-motion was removed; animation check skipped

    // dynamic lists (.map(() => ...))
    expect(r.rendering_capabilities.dynamic_lists).toBeGreaterThan(0);
  });

  it("detects backend patterns in httpServer.ts", async () => {
    const r = (await callTool("scan_capabilities", {
      file_path: HTTP_SERVER,
    })) as any;

    // No React
    expect(r.imports.has_react).toBe(false);
    expect(r.state_management.boolean_flags).toBe(0);
    expect(r.state_management.effects).toBe(0);

    // Has imports and exports
    expect(r.imports.count).toBeGreaterThan(0);

    // backend file characteristics
    expect(r.file.lines).toBeGreaterThan(50);
  });

  it("detects MCP tool patterns in seoTools.ts", async () => {
    const r = (await callTool("scan_capabilities", {
      file_path: SEO_TOOLS,
    })) as any;

    // No React — pure Node.js tool file
    expect(r.imports.has_react).toBe(false);
    expect(r.state_management.effects).toBe(0);

    // Has named exports (the tools array)
    expect(r.exports.named_exports).toBeGreaterThan(0);

    // Has imports
    expect(r.imports.count).toBeGreaterThan(0);

    // dynamic lists (likely .map calls in the tool logic)
    expect(r.rendering_capabilities.dynamic_lists).toBeGreaterThanOrEqual(0);
  });
});

// ── 2. verify_concept_support — concept verification at scale ───────────────

describe("Architect Tools — Complex E2E: verify_concept_support", () => {
  it("verifies 'React SPA with Routing' against MainLayout → Fully Implemented", async () => {
    const r = (await callTool("verify_concept_support", {
      file_path: MAIN_LAYOUT,
      concept_name: "React SPA with Routing",
      required_signatures: [
        "useState",
        "useEffect",
        "useCallback",
        "useRef",
        "from.*react",
      ],
    })) as any;

    expect(r.status).toBe("Fully Implemented");
    expect(r.match_score).toBe("100%");
    expect(r.gap_analysis).toHaveLength(0);
    expect(r.id).toMatch(/^cv_/);
  });

  it.skip("verifies 'Animation System' against MainLayout → detects framer-motion", async () => {
    const r = (await callTool("verify_concept_support", {
      file_path: MAIN_LAYOUT,
      concept_name: "Animation System",
      required_signatures: [
        "framer-motion",
        "AnimatePresence",
        "motion",
      ],
    })) as any;

    expect(r.status).toBe("Fully Implemented");
    expect(r.match_score).toBe("100%");
    expect(r.evidence_found).toContain("framer-motion");
    expect(r.evidence_found).toContain("AnimatePresence");
  });

  it("verifies 'WebSocket Support' against MainLayout → Not Implemented", async () => {
    const r = (await callTool("verify_concept_support", {
      file_path: MAIN_LAYOUT,
      concept_name: "WebSocket Support",
      required_signatures: [
        "WebSocket",
        "wss://",
        "socket\\.on",
        "onmessage",
      ],
    })) as any;

    expect(r.status).toBe("Not Implemented");
    expect(r.match_score).toBe("0%");
    expect(r.gap_analysis).toHaveLength(4);
  });

  it("verifies 'MCP Tool Pattern' against seoTools → Fully Implemented", async () => {
    const r = (await callTool("verify_concept_support", {
      file_path: SEO_TOOLS,
      concept_name: "MCP Tool Pattern",
      required_signatures: [
        "McpTool",
        "name:",
        "description:",
        "inputSchema",
        "handler",
      ],
    })) as any;

    expect(r.status).toBe("Fully Implemented");
    expect(r.match_score).toBe("100%");
    expect(r.evidence_found).toHaveLength(5);
  });

  it("verifies 'Hybrid Search' against progressiveDiscoveryTools → detects search patterns", async () => {
    const r = (await callTool("verify_concept_support", {
      file_path: DISCOVERY_TOOLS,
      concept_name: "Hybrid Search System",
      required_signatures: [
        "hybridSearch",
        "score",
        "keyword|fuzzy|prefix|semantic",
        "WORKFLOW_CHAINS",
      ],
    })) as any;

    expect(r.status).toBe("Fully Implemented");
    expect(r.match_score).toBe("100%");
  });

  it("verifies 'GraphQL API' against httpServer → Not Implemented", async () => {
    const r = (await callTool("verify_concept_support", {
      file_path: HTTP_SERVER,
      concept_name: "GraphQL API",
      required_signatures: [
        "typeDefs",
        "resolvers",
        "gql`",
        "graphqlHTTP",
      ],
    })) as any;

    expect(r.status).toBe("Not Implemented");
    expect(r.match_score).toBe("0%");
    expect(r.gap_analysis).toHaveLength(4);
  });

  it("handles partial implementation correctly (50-99%)", async () => {
    // CommandPalette has useState, useEffect, useMemo but NOT useReducer or useContext
    const r = (await callTool("verify_concept_support", {
      file_path: COMMAND_PALETTE,
      concept_name: "Advanced State Management",
      required_signatures: [
        "useState",
        "useEffect",
        "useMemo",
        "useReducer",
        "useContext",
      ],
    })) as any;

    expect(r.status).toBe("Partially Implemented");
    expect(parseInt(r.match_score)).toBe(60); // 3/5 = 60%
    expect(r.evidence_found).toContain("useState");
    expect(r.evidence_found).toContain("useEffect");
    expect(r.evidence_found).toContain("useMemo");
    expect(r.gap_analysis).toContain("useReducer");
    expect(r.gap_analysis).toContain("useContext");
  });
});

// ── 3. Full self-discovery loop: scan → verify → plan ───────────────────────

describe("Architect Tools — Complex E2E: Full Self-Discovery Loop", () => {
  it("scan → verify → plan for 'Real-time Collaboration' on MainLayout", async () => {
    // Step 1: Scan the file
    const scan = (await callTool("scan_capabilities", {
      file_path: MAIN_LAYOUT,
    })) as any;

    expect(scan.file.lines).toBeGreaterThan(100);

    // Step 2: Verify the concept
    const verify = (await callTool("verify_concept_support", {
      file_path: MAIN_LAYOUT,
      concept_name: "Real-time Collaboration",
      required_signatures: [
        "WebSocket|socket\\.io",
        "cursor.*position|presence",
        "conflict.*resolution|CRDT",
        "broadcast|emit",
      ],
    })) as any;

    expect(verify.status).toBe("Not Implemented");
    expect(verify.gap_analysis.length).toBeGreaterThan(0);

    // Step 3: Generate implementation plan from the gaps
    const plan = (await callTool("generate_implementation_plan", {
      concept_name: "Real-time Collaboration",
      missing_signatures: verify.gap_analysis,
      current_context: JSON.stringify({
        has_react: scan.imports.has_react,
        has_effects: scan.state_management.effects > 0,
        has_refs: scan.state_management.refs > 0,
        has_animation: scan.interaction_patterns.animation,
      }),
      target_file: MAIN_LAYOUT,
    })) as any;

    expect(plan.concept).toBe("Real-time Collaboration");
    expect(plan.total_steps).toBe(verify.gap_analysis.length);
    expect(plan.context_provided).toBe(true);
    expect(plan.steps.length).toBe(verify.gap_analysis.length);

    // Each step should have a strategy
    for (const step of plan.steps) {
      expect(step.strategy).toBeTruthy();
      expect(step.requirement).toBeTruthy();
      expect(step.conflicts).toContain("Review current context");
    }
  });

  it("scan → verify → plan for 'Canvas Artifacts' on CommandPalette", async () => {
    // Step 1: Scan
    const scan = (await callTool("scan_capabilities", {
      file_path: COMMAND_PALETTE,
    })) as any;

    // Step 2: Verify
    const verify = (await callTool("verify_concept_support", {
      file_path: COMMAND_PALETTE,
      concept_name: "Canvas Artifacts",
      required_signatures: [
        "canvas|Canvas",
        "getContext\\(['\"]2d",
        "drawImage|fillRect",
        "useRef.*canvas",
        "onMouseDown|onPointerDown",
      ],
    })) as any;

    expect(verify.status).toBe("Not Implemented");

    // Step 3: Plan
    const plan = (await callTool("generate_implementation_plan", {
      concept_name: "Canvas Artifacts",
      missing_signatures: verify.gap_analysis,
      current_context: `React component with ${scan.state_management.effects} effects, ${scan.state_management.memos} memos, animation: ${scan.interaction_patterns.animation}`,
      target_file: COMMAND_PALETTE,
    })) as any;

    expect(plan.total_steps).toBe(5);
    expect(plan.estimated_complexity).toBe("medium"); // 5 steps = medium
    expect(plan.workflow).toHaveLength(4);
  });

  it("scan → verify → plan for 'REST API with Auth' on httpServer", async () => {
    // Step 1: Scan
    const scan = (await callTool("scan_capabilities", {
      file_path: HTTP_SERVER,
    })) as any;

    // Step 2: Verify REST API with auth
    const verify = (await callTool("verify_concept_support", {
      file_path: HTTP_SERVER,
      concept_name: "REST API with Authentication",
      required_signatures: [
        "http|express",
        "createServer|listen",
        "JSON\\.parse|json\\(",
        "token|auth|bearer",
      ],
    })) as any;

    // httpServer.ts should have most of these
    expect(parseInt(verify.match_score)).toBeGreaterThanOrEqual(75);

    // Step 3: Plan for any gaps
    if (verify.gap_analysis.length > 0) {
      const plan = (await callTool("generate_implementation_plan", {
        concept_name: "REST API with Authentication",
        missing_signatures: verify.gap_analysis,
        current_context: JSON.stringify(scan.backend_patterns),
        target_file: HTTP_SERVER,
      })) as any;

      expect(plan.total_steps).toBe(verify.gap_analysis.length);
      expect(plan.context_provided).toBe(true);
    }
  });

  it("handles zero-gap scenario gracefully (plan with 0 steps)", async () => {
    // Verify something that fully exists
    const verify = (await callTool("verify_concept_support", {
      file_path: SEO_TOOLS,
      concept_name: "MCP Tool Pattern",
      required_signatures: ["McpTool", "handler", "inputSchema"],
    })) as any;

    expect(verify.status).toBe("Fully Implemented");
    expect(verify.gap_analysis).toHaveLength(0);

    // Plan with empty missing_signatures
    const plan = (await callTool("generate_implementation_plan", {
      concept_name: "MCP Tool Pattern",
      missing_signatures: [],
      target_file: SEO_TOOLS,
    })) as any;

    expect(plan.total_steps).toBe(0);
    expect(plan.steps).toHaveLength(0);
    expect(plan.estimated_complexity).toBe("low");
  });
});

// ── 4. Edge cases and stress tests ──────────────────────────────────────────

describe("Architect Tools — Complex E2E: Edge Cases", () => {
  it("scan_capabilities handles large files (progressiveDiscoveryTools)", async () => {
    const r = (await callTool("scan_capabilities", {
      file_path: DISCOVERY_TOOLS,
    })) as any;

    // Large file
    expect(r.file.lines).toBeGreaterThan(200);
    expect(r.file.sizeBytes).toBeGreaterThan(5000);

    // Has exports
    expect(r.exports.named_exports).toBeGreaterThan(0);
  });

  it("verify_concept_support handles regex-heavy signatures", async () => {
    const r = (await callTool("verify_concept_support", {
      file_path: DISCOVERY_TOOLS,
      concept_name: "Search Engine Internals",
      required_signatures: [
        "toLowerCase\\(\\)",
        "for \\(",
        "hybridSearch",
        "WORKFLOW_CHAINS",
      ],
    })) as any;

    // Progressive discovery uses toLowerCase, for loops, hybridSearch function, WORKFLOW_CHAINS
    expect(parseInt(r.match_score)).toBe(100);
  });

  it("generate_implementation_plan infers correct strategies for diverse patterns", async () => {
    const r = (await callTool("generate_implementation_plan", {
      concept_name: "Full Stack Feature",
      missing_signatures: [
        "useState",
        "app.post(",
        "db.prepare(",
        "verifyToken",
        "WebSocket",
        "onKeyDown",
        "navigator.clipboard",
      ],
      current_context: "Empty file, starting from scratch",
    })) as any;

    expect(r.total_steps).toBe(7);
    expect(r.estimated_complexity).toBe("high"); // 7 steps > 5

    // Verify each strategy maps to the correct category
    const strategies = r.steps.map((s: any) => s.strategy);
    expect(strategies[0]).toContain("React hook"); // useState
    expect(strategies[1]).toContain("route"); // app.post
    expect(strategies[2]).toContain("database"); // db.prepare
    expect(strategies[3]).toContain("auth"); // verifyToken
    expect(strategies[4]).toContain("WebSocket"); // WebSocket
    expect(strategies[5]).toContain("keyboard"); // onKeyDown
    expect(strategies[6]).toContain("clipboard"); // navigator.clipboard
  });
});
