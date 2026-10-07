/**
 * traceabilityDogfood.test.ts — End-to-end dogfood for completion traceability
 *
 * Exercises all traceability integration points added to the agentic infrastructure:
 * 1. save_session_note with citedFrom field (schema + handler)
 * 2. refresh_task_context with originalRequest field (schema + handler)
 * 3. critter_check with original_request field (schema + handler)
 * 4. Workflow chains include traceability save_session_note step
 * 5. selfEval ship_gates checks for save_session_note (traceability)
 * 6. Documentation: AI_FLYWHEEL.md + AGENTS.md
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { McpTool } from "../types.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const MCP_LOCAL_ROOT = path.resolve(TEST_DIR, "..", "..");
const REPO_ROOT = path.resolve(TEST_DIR, "..", "..", "..", "..");

// ═══════════════════════════════════════════════════════════════════════════
// 1. save_session_note: citedFrom field
// ═══════════════════════════════════════════════════════════════════════════

describe("Traceability: save_session_note citedFrom", () => {
  let tool: McpTool;

  it("sessionMemoryTools exports save_session_note", async () => {
    const { sessionMemoryTools } = await import("../tools/sessionMemoryTools.js");
    tool = sessionMemoryTools.find((t) => t.name === "save_session_note")!;
    expect(tool).toBeDefined();
  });

  it("schema includes citedFrom field", () => {
    expect(tool.inputSchema.properties.citedFrom).toBeDefined();
    expect(tool.inputSchema.properties.citedFrom.type).toBe("string");
  });

  it("handler accepts citedFrom and writes file", async () => {
    const result = (await tool.handler({
      title: "Dogfood traceability test",
      content: "Testing traceability fields end-to-end",
      category: "finding",
      citedFrom: "User asked: 'add completion traceability to every part of our agentic infrastructure'",
    })) as any;

    // Handler returns { saved, filePath, filename, title, category, tip }
    expect(result.saved).toBe(true);
    expect(result.filePath).toBeDefined();
    expect(result.title).toBe("Dogfood traceability test");

    // Verify the written file contains the citedFrom text
    const fs = await import("fs");
    const fileContent = fs.readFileSync(result.filePath, "utf-8");
    expect(fileContent).toContain("Cited From");
    expect(fileContent).toContain("add completion traceability");

    // Cleanup
    fs.unlinkSync(result.filePath);
  });

  it("handler works without citedFrom (backwards compat)", async () => {
    const result = (await tool.handler({
      title: "No citation note",
      content: "Old-style note without traceability",
    })) as any;

    expect(result.saved).toBe(true);

    // Cleanup
    const fs = await import("fs");
    fs.unlinkSync(result.filePath);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. refresh_task_context: originalRequest field
// ═══════════════════════════════════════════════════════════════════════════

describe("Traceability: refresh_task_context originalRequest", () => {
  let tool: McpTool;

  it("sessionMemoryTools exports refresh_task_context", async () => {
    const { sessionMemoryTools } = await import("../tools/sessionMemoryTools.js");
    tool = sessionMemoryTools.find((t) => t.name === "refresh_task_context")!;
    expect(tool).toBeDefined();
  });

  it("schema includes originalRequest field", () => {
    expect(tool.inputSchema.properties.originalRequest).toBeDefined();
    expect(tool.inputSchema.properties.originalRequest.type).toBe("string");
  });

  it("handler includes originalRequest in context when provided", async () => {
    const result = (await tool.handler({
      originalRequest: "Build batch autopilot with operator profiles",
    })) as any;

    // Handler returns { context: { ... }, tip }
    expect(result.context).toBeDefined();
    expect(result.context.originalRequest).toBe(
      "Build batch autopilot with operator profiles"
    );
  });

  it("handler works without originalRequest", async () => {
    const result = (await tool.handler({})) as any;
    expect(result.context).toBeDefined();
    expect(result.context.originalRequest).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. critter_check: original_request field
// ═══════════════════════════════════════════════════════════════════════════

describe("Traceability: critter_check original_request", () => {
  let tool: McpTool;

  it("critterTools exports critter_check", async () => {
    const { critterTools } = await import("../tools/critterTools.js");
    tool = critterTools.find((t) => t.name === "critter_check")!;
    expect(tool).toBeDefined();
  });

  it("schema includes original_request field", () => {
    expect(tool.inputSchema.properties.original_request).toBeDefined();
    expect(tool.inputSchema.properties.original_request.type).toBe("string");
  });

  it("handler accepts original_request", async () => {
    const result = (await tool.handler({
      task: "Add traceability fields to TRACE audit log",
      why: "Users need to trace finalize entries back to their original request",
      who: "Agent developers running multi-step orchestrations",
      original_request: "dogfood the completion traceability changes",
    })) as any;

    expect(result.score).toBeGreaterThan(0);
    expect(result.verdict).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Workflow chains include traceability step
// ═══════════════════════════════════════════════════════════════════════════

describe("Traceability: workflow chains", () => {
  it("new_feature chain includes save_session_note traceability step", async () => {
    const { WORKFLOW_CHAINS } = await import("../tools/toolRegistry.js");
    const chain = WORKFLOW_CHAINS.new_feature;
    expect(chain).toBeDefined();

    const traceStep = chain.steps.find(
      (s) =>
        s.tool === "save_session_note" &&
        s.action.toLowerCase().includes("traceability")
    );
    expect(traceStep).toBeDefined();
  });

  it("fix_bug chain includes save_session_note traceability step", async () => {
    const { WORKFLOW_CHAINS } = await import("../tools/toolRegistry.js");
    const chain = WORKFLOW_CHAINS.fix_bug;
    const traceStep = chain.steps.find(
      (s) =>
        s.tool === "save_session_note" &&
        s.action.toLowerCase().includes("traceability")
    );
    expect(traceStep).toBeDefined();
  });

  it("ui_change chain includes save_session_note traceability step", async () => {
    const { WORKFLOW_CHAINS } = await import("../tools/toolRegistry.js");
    const chain = WORKFLOW_CHAINS.ui_change;
    const traceStep = chain.steps.find(
      (s) =>
        s.tool === "save_session_note" &&
        s.action.toLowerCase().includes("traceability")
    );
    expect(traceStep).toBeDefined();
  });

  it("autonomous_qa_bug chain includes save_session_note traceability step", async () => {
    const { WORKFLOW_CHAINS } = await import("../tools/toolRegistry.js");
    const chain = WORKFLOW_CHAINS.autonomous_qa_bug;
    const traceStep = chain.steps.find(
      (s) =>
        s.tool === "save_session_note" &&
        s.action.toLowerCase().includes("traceability")
    );
    expect(traceStep).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. selfEval ship_gates — traceability violation logic
// ═══════════════════════════════════════════════════════════════════════════

describe("Traceability: selfEval ship_gates", () => {
  it("check_contract_compliance source code includes save_session_note traceability check", async () => {
    // Read the source to verify the traceability check exists in the ship_gates dimension
    const fs = await import("fs");
    const src = fs.readFileSync(
      path.resolve(MCP_LOCAL_ROOT, "src", "tools", "selfEvalTools.ts"),
      "utf-8"
    );

    // The ship_gates dimension should check for save_session_note
    expect(src).toContain('save_session_note');
    expect(src).toContain('completion traceability');
    expect(src).toContain('citedFrom');
  });

  it("ship_gates description mentions traceability", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      path.resolve(MCP_LOCAL_ROOT, "src", "tools", "selfEvalTools.ts"),
      "utf-8"
    );

    // The ship_gates dimension description should include "traceability"
    expect(src).toContain(
      "Tests + eval + quality gate + flywheel + learning + traceability"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Documentation: AI_FLYWHEEL.md + AGENTS.md
// ═══════════════════════════════════════════════════════════════════════════

describe("Traceability: documentation", () => {
  it("AI_FLYWHEEL.md includes Step 8 completion traceability", async () => {
    const fs = await import("fs");
    const flywheel = fs.readFileSync(
      path.resolve(REPO_ROOT, "AI_FLYWHEEL.md"),
      "utf-8"
    );
    expect(flywheel).toContain("Completion traceability");
    expect(flywheel).toContain("cite the original request");
  });

  it("AGENTS.md includes traceability in post-implementation audit", async () => {
    const fs = await import("fs");
    const agents = fs.readFileSync(
      path.resolve(REPO_ROOT, "AGENTS.md"),
      "utf-8"
    );
    expect(agents).toContain("Completion traceability");
  });

  it("completion_traceability rule exists in .claude/rules/", async () => {
    const fs = await import("fs");
    const rulePath = path.resolve(
      REPO_ROOT, ".claude", "rules", "completion_traceability.md"
    );
    expect(fs.existsSync(rulePath)).toBe(true);
    const content = fs.readFileSync(rulePath, "utf-8");
    expect(content).toContain("Quote or paraphrase");
    expect(content).toContain("Summarize");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. TRACE audit metadata — schema fields exist
// ═══════════════════════════════════════════════════════════════════════════

describe("Traceability: TRACE audit metadata fields", () => {
  it("convex schema includes originalRequest and deliverySummary in traceAuditEntries", async () => {
    const fs = await import("fs");
    const schema = fs.readFileSync(
      path.resolve(REPO_ROOT, "backend", "convex", "schema.ts"),
      "utf-8"
    );

    expect(schema).toContain("originalRequest: v.optional(v.string())");
    expect(schema).toContain("deliverySummary: v.optional(v.string())");
  });

  it("traceAuditLog.ts includes the new fields in all validators", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      path.resolve(
        REPO_ROOT, "backend", "convex", "domains", "agents", "traceAuditLog.ts"
      ),
      "utf-8"
    );

    // Should appear in multiple validators (appendAuditEntry, appendAuditEntryPublic, getAuditLog, getAuditLogInternal)
    const matches = src.match(/originalRequest: v\.optional\(v\.string\(\)\)/g);
    expect(matches).toBeDefined();
    expect(matches!.length).toBeGreaterThanOrEqual(4);
  });

  it("traceOrchestrator finalize step includes originalRequest", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      path.resolve(
        REPO_ROOT, "backend", "convex", "domains", "agents", "traceOrchestrator.ts"
      ),
      "utf-8"
    );

    expect(src).toContain("originalRequest: query.length > 500");
    expect(src).toContain("deliverySummary:");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Frontend: TraceAuditPanel shows traceability on finalize entries
// ═══════════════════════════════════════════════════════════════════════════

describe("Traceability: frontend components", () => {
  it("TraceAuditPanel renders originalRequest for finalize entries", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      path.resolve(
        REPO_ROOT, "apps", "web", "src", "features", "agents", "components",
        "FastAgentPanel", "FastAgentPanel.TraceAuditPanel.tsx"
      ),
      "utf-8"
    );

    expect(src).toContain("originalRequest");
    expect(src).toContain("deliverySummary");
    expect(src).toContain("Original Request");
  });

  it("ExportMenu includes originalRequest in exports", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      path.resolve(
        REPO_ROOT, "apps", "web", "src", "features", "agents", "components",
        "FastAgentPanel", "FastAgentPanel.ExportMenu.tsx"
      ),
      "utf-8"
    );

    expect(src).toContain("originalRequest");
    expect(src).toContain("Original Request");
  });

  it("MessageStream shows completion traceability citation", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(
      path.resolve(
        REPO_ROOT, "apps", "web", "src", "features", "agents", "components",
        "FastAgentPanel", "FastAgentPanel.MessageStream.tsx"
      ),
      "utf-8"
    );

    expect(src).toContain("originalRequest");
    expect(src).toContain("Completion traceability");
  });
});
