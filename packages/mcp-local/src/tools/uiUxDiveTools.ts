/**
 * UI/UX Full Dive Tools — Parallel subagent swarm for comprehensive UI traversal.
 *
 * Architecture:
 * - Main agent starts a dive session and registers top-level page components.
 * - Subagents claim individual components via start_component_flow (isolated context).
 * - Each subagent logs interactions and tags bugs within its component scope.
 * - The component tree builds up hierarchically (page → section → element).
 * - get_dive_tree produces an XML-like overview of the entire app structure.
 * - get_dive_report generates a final report with Mermaid diagram, bug summary,
 *   and per-component interaction traces.
 *
 * Designed for use with Claude Code subagents, Windsurf, or any MCP client that
 * supports parallel tool invocation. Each subagent only needs the session_id and
 * its assigned component_id to operate independently.
 */

import { getDb, genId } from "../db.js";
import type { McpTool, ContentBlock, RawToolResult } from "../types.js";

// ── Browser Session Management (Built-in Playwright) ────────────────────
// Singleton browser/page per dive session. Auto-detects Playwright.
// Falls back gracefully to manual/logging-only mode if not installed.

let _browser: any = null;
let _page: any = null;
let _activeSessionId: string | null = null;

async function getPlaywright(): Promise<any> {
  try {
    return await import("playwright");
  } catch {
    return null;
  }
}

async function ensureBrowser(
  url: string,
  sessionId: string,
  headless = true,
): Promise<{ page: any; launched: boolean; error?: string }> {
  if (_page && _activeSessionId === sessionId) {
    return { page: _page, launched: false };
  }
  await closeBrowser();
  const pw = await getPlaywright();
  if (!pw) {
    return {
      page: null,
      launched: false,
      error:
        "Playwright not installed. Install for zero-friction browser automation:\n  npm install playwright && npx playwright install chromium\nFalling back to manual logging mode.",
    };
  }
  try {
    _browser = await pw.chromium.launch({ headless });
    _page = await _browser.newPage({ viewport: { width: 1280, height: 720 } });
    await _page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    _activeSessionId = sessionId;
    return { page: _page, launched: true };
  } catch (e: any) {
    await closeBrowser();
    return {
      page: null,
      launched: false,
      error: `Browser launch failed: ${e.message}. Try: npx playwright install chromium`,
    };
  }
}

async function closeBrowser(): Promise<void> {
  try {
    if (_browser) await _browser.close();
  } catch {
    /* ignore close errors */
  }
  _browser = null;
  _page = null;
  _activeSessionId = null;
}

async function executeAction(
  page: any,
  action: string,
  target?: string,
  inputValue?: string,
): Promise<{ success: boolean; observation: string; durationMs: number }> {
  const start = Date.now();
  try {
    switch (action) {
      case "click":
        if (!target) return { success: false, observation: "No target selector for click", durationMs: Date.now() - start };
        await page.click(target, { timeout: 10000 });
        break;
      case "type":
        if (!target || !inputValue) return { success: false, observation: "Need target and inputValue for type", durationMs: Date.now() - start };
        await page.fill(target, inputValue, { timeout: 10000 });
        break;
      case "hover":
        if (!target) return { success: false, observation: "No target selector for hover", durationMs: Date.now() - start };
        await page.hover(target, { timeout: 10000 });
        break;
      case "navigate":
        if (!inputValue) return { success: false, observation: "No URL for navigate (use inputValue)", durationMs: Date.now() - start };
        await page.goto(inputValue, { waitUntil: "domcontentloaded", timeout: 30000 });
        break;
      case "scroll":
        await page.evaluate(`window.scrollBy(0, ${parseInt(inputValue ?? "500", 10)})`);
        break;
      case "submit":
        if (target) await page.press(target, "Enter", { timeout: 10000 });
        else await page.keyboard.press("Enter");
        break;
      case "keypress":
        await page.keyboard.press(inputValue ?? "Enter");
        break;
      case "focus":
        if (target) await page.focus(target, { timeout: 10000 });
        break;
      case "wait":
        await page.waitForTimeout(parseInt(inputValue ?? "1000", 10));
        break;
      case "assert": {
        if (!target) return { success: true, observation: "No target for assert — skipped", durationMs: Date.now() - start };
        const visible = await page.isVisible(target);
        if (!visible) return { success: false, observation: `Element not visible: ${target}`, durationMs: Date.now() - start };
        break;
      }
      default:
        return { success: true, observation: `Action '${action}' not auto-executable — logged only`, durationMs: Date.now() - start };
    }
    await page.waitForTimeout(300);
    const title = await page.title();
    const url = page.url();
    return { success: true, observation: `Executed. Page: "${title}" (${url})`, durationMs: Date.now() - start };
  } catch (e: any) {
    return { success: false, observation: `Action failed: ${e.message}`, durationMs: Date.now() - start };
  }
}

async function autoDiscoverComponents(
  page: any,
): Promise<Array<{ name: string; type: string; selector: string; children: number }>> {
  // Runs in the browser context via page.evaluate — passed as a string
  // to avoid TypeScript DOM type errors in the Node compilation target.
  const script = `(() => {
    const found = [];
    const landmarks = {
      nav: "menu", header: "header", footer: "footer", main: "section",
      aside: "sidebar", form: "form", dialog: "modal", table: "table",
    };
    for (const [tag, type] of Object.entries(landmarks)) {
      document.querySelectorAll(tag).forEach((el, i) => {
        const label = el.getAttribute("aria-label") || el.getAttribute("id") || tag + "_" + i;
        const selector = el.id ? "#" + el.id : tag + ":nth-of-type(" + (i + 1) + ")";
        found.push({
          name: label, type, selector,
          children: el.querySelectorAll("a, button, input, select, textarea, [role='button'], [role='link']").length,
        });
      });
    }
    const interSel = "button, [role='button'], a[href], input, select, textarea";
    const insideLandmark = new Set();
    for (const tag of Object.keys(landmarks)) {
      document.querySelectorAll(tag).forEach(parent => {
        parent.querySelectorAll(interSel).forEach(child => insideLandmark.add(child));
      });
    }
    const orphans = [...document.querySelectorAll(interSel)].filter(el => !insideLandmark.has(el));
    if (orphans.length > 0) {
      found.push({ name: "Ungrouped Interactive Elements", type: "section", selector: "body", children: orphans.length });
    }
    return found;
  })()`;
  return page.evaluate(script);
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface ComponentRow {
  id: string;
  session_id: string;
  parent_id: string | null;
  name: string;
  component_type: string;
  selector: string | null;
  agent_id: string | null;
  status: string;
  interaction_count: number;
  bug_count: number;
  summary: string | null;
  metadata: string | null;
  created_at: string;
  completed_at: string | null;
}

interface BugRow {
  id: string;
  session_id: string;
  component_id: string;
  interaction_id: string | null;
  severity: string;
  category: string;
  title: string;
  description: string | null;
  expected: string | null;
  actual: string | null;
  screenshot_ref: string | null;
  status: string;
  created_at: string;
}

interface InteractionRow {
  id: string;
  session_id: string;
  component_id: string;
  action: string;
  target: string | null;
  input_value: string | null;
  result: string;
  observation: string | null;
  screenshot_ref: string | null;
  duration_ms: number | null;
  sequence_num: number;
  created_at: string;
}

function buildTreeXml(
  components: ComponentRow[],
  bugs: BugRow[],
  parentId: string | null = null,
  indent: number = 0,
): string {
  const children = components.filter(c => c.parent_id === parentId);
  if (children.length === 0) return "";

  const pad = "  ".repeat(indent);
  let xml = "";

  for (const c of children) {
    const cBugs = bugs.filter(b => b.component_id === c.id);
    const bugAttr = cBugs.length > 0 ? ` bugs="${cBugs.length}"` : "";
    const statusAttr = ` status="${c.status}"`;
    const agentAttr = c.agent_id ? ` agent="${c.agent_id}"` : "";
    const interactionAttr = c.interaction_count > 0 ? ` interactions="${c.interaction_count}"` : "";

    const childXml = buildTreeXml(components, bugs, c.id, indent + 1);
    const bugXml = cBugs.map(b =>
      `${pad}  <bug severity="${b.severity}" category="${b.category}" status="${b.status}">${b.title}</bug>`
    ).join("\n");

    const hasChildren = childXml || bugXml;
    if (hasChildren) {
      xml += `${pad}<${c.component_type} name="${c.name}" id="${c.id}"${statusAttr}${agentAttr}${interactionAttr}${bugAttr}>\n`;
      if (bugXml) xml += bugXml + "\n";
      if (childXml) xml += childXml;
      xml += `${pad}</${c.component_type}>\n`;
    } else {
      xml += `${pad}<${c.component_type} name="${c.name}" id="${c.id}"${statusAttr}${agentAttr}${interactionAttr}${bugAttr} />\n`;
    }
  }

  return xml;
}

function buildMermaidDiagram(components: ComponentRow[], bugs: BugRow[]): string {
  if (components.length === 0) return "graph TD\n  empty[No components registered]";

  let mermaid = "graph TD\n";
  const sanitize = (s: string) => s.replace(/["\[\](){}]/g, "").replace(/\s+/g, "_");

  for (const c of components) {
    const cBugs = bugs.filter(b => b.component_id === c.id);
    const label = cBugs.length > 0
      ? `${c.name} [${c.status}] 🐛${cBugs.length}`
      : `${c.name} [${c.status}]`;
    const style = c.status === "completed"
      ? ":::completed"
      : cBugs.some(b => b.severity === "critical")
        ? ":::critical"
        : cBugs.length > 0
          ? ":::hasBugs"
          : "";

    mermaid += `  ${sanitize(c.id)}["${label}"]${style}\n`;

    if (c.parent_id) {
      mermaid += `  ${sanitize(c.parent_id)} --> ${sanitize(c.id)}\n`;
    }
  }

  mermaid += "\n  classDef completed fill:#d4edda,stroke:#28a745\n";
  mermaid += "  classDef critical fill:#f8d7da,stroke:#dc3545\n";
  mermaid += "  classDef hasBugs fill:#fff3cd,stroke:#ffc107\n";

  return mermaid;
}

// ── Tools ────────────────────────────────────────────────────────────────

export const uiUxDiveTools: McpTool[] = [
  // 1. Start a dive session
  {
    name: "start_ui_dive",
    description:
      "Initialize a UI/UX Full Dive session. Auto-launches a headless Playwright browser if installed (zero setup). Navigates to the app URL and optionally auto-discovers page components from the DOM. If Playwright is not installed, falls back to manual logging mode where you drive the browser yourself (via playwright-mcp, mobile-mcp, or manual browsing) and just use the dive tools for structured logging. Returns the session_id needed by all subsequent tools.",
    inputSchema: {
      type: "object",
      properties: {
        appUrl: {
          type: "string",
          description: "URL of the application to dive into (e.g. http://localhost:3000, https://app.example.com)",
        },
        appName: {
          type: "string",
          description: "Human-readable name (e.g. 'NodeBench AI Dashboard')",
        },
        agentCount: {
          type: "number",
          description: "Number of parallel subagents planned (default: 1, set higher for parallel swarm)",
        },
        headless: {
          type: "boolean",
          description: "Run browser in headless mode (default: true). Set false to see the browser window.",
        },
        autoDiscover: {
          type: "boolean",
          description: "Auto-discover and register page components from the DOM (default: true). Scans for nav, header, footer, forms, modals, tables, sidebars, and interactive elements.",
        },
        metadata: {
          type: "object",
          description: "Optional JSON metadata (e.g. { viewport: '1280x720', auth: 'guest' })",
        },
      },
      required: ["appUrl"],
    },
    handler: async (args) => {
      const { appUrl, appName, agentCount, metadata, headless, autoDiscover } = args as {
        appUrl: string;
        appName?: string;
        agentCount?: number;
        headless?: boolean;
        autoDiscover?: boolean;
        metadata?: Record<string, unknown>;
      };

      const db = getDb();
      const id = genId("dive");

      db.prepare(
        "INSERT INTO ui_dive_sessions (id, app_url, app_name, agent_count, metadata) VALUES (?, ?, ?, ?, ?)"
      ).run(id, appUrl, appName ?? null, agentCount ?? 1, metadata ? JSON.stringify(metadata) : null);

      // Try to launch browser
      const browserResult = await ensureBrowser(appUrl, id, headless !== false);

      // Auto-discover components if browser is active
      let discoveredComponents: Array<{ name: string; type: string; selector: string; children: number }> = [];
      const registeredIds: string[] = [];

      if (browserResult.page && autoDiscover !== false) {
        try {
          discoveredComponents = await autoDiscoverComponents(browserResult.page);

          // Auto-register discovered components
          for (const comp of discoveredComponents) {
            const compId = genId("comp");
            db.prepare(
              "INSERT INTO ui_dive_components (id, session_id, parent_id, name, component_type, selector, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).run(compId, id, null, comp.name, comp.type, comp.selector, JSON.stringify({ autoDiscovered: true, interactiveChildren: comp.children }));
            registeredIds.push(compId);
          }

          // Set first as root
          if (registeredIds.length > 0) {
            db.prepare("UPDATE ui_dive_sessions SET root_component_id = ? WHERE id = ?").run(registeredIds[0], id);
          }
        } catch {
          /* auto-discover is best-effort */
        }
      }

      return {
        sessionId: id,
        appUrl,
        appName: appName ?? null,
        agentCount: agentCount ?? 1,
        status: "active",
        browser: {
          active: !!browserResult.page,
          launched: browserResult.launched,
          mode: browserResult.page ? "auto" : "manual",
          ...(browserResult.error ? { setupHint: browserResult.error } : {}),
        },
        autoDiscovery: {
          componentsFound: discoveredComponents.length,
          components: discoveredComponents.map((c, i) => ({
            componentId: registeredIds[i],
            ...c,
          })),
        },
        _hint: browserResult.page
          ? `Browser launched and ${discoveredComponents.length} components auto-discovered. Use log_interaction with CSS selectors in 'target' — actions will auto-execute in the browser. Call dive_snapshot for screenshots.`
          : `Manual mode: drive the browser yourself and use log_interaction to record what you observe. Install Playwright for auto-execution: npm install playwright && npx playwright install chromium`,
        _workflow: [
          "1. Components auto-discovered (or register manually with register_component)",
          "2. Assign subagents: start_component_flow({ componentId, agentId })",
          "3. Each subagent: log_interaction (auto-executes clicks/types if browser active)",
          "4. Tag bugs: tag_ui_bug for any issues found",
          "5. dive_snapshot for visual evidence at any point",
          "6. end_component_flow when each component is done",
          "7. get_dive_report for final comprehensive report",
        ],
      };
    },
  },

  // 2. Register a component in the tree
  {
    name: "register_component",
    description:
      "Register a UI component in the dive tree. Components form a hierarchy: page → section → form/modal/list → button/input/link. Set parentId to nest under an existing component (null for top-level). The main agent registers the initial tree, then subagents can add child components they discover during traversal. Returns the component_id for use in start_component_flow and log_interaction.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Dive session ID from start_ui_dive" },
        name: { type: "string", description: "Component name (e.g. 'Login Form', 'Navigation Bar', 'Settings Modal')" },
        componentType: {
          type: "string",
          description: "Type: page, section, form, modal, menu, list, card, button, input, link, table, tab, drawer, dialog, toast, tooltip, dropdown, sidebar, header, footer, hero, chart, media",
        },
        parentId: { type: "string", description: "Parent component ID (null/omit for top-level page)" },
        selector: { type: "string", description: "CSS selector or data-testid for identification (e.g. '[data-testid=login-form]', '#nav-bar')" },
        metadata: { type: "object", description: "Optional JSON (e.g. { route: '/settings', requiresAuth: true })" },
      },
      required: ["sessionId", "name", "componentType"],
    },
    handler: async (args) => {
      const { sessionId, name, componentType, parentId, selector, metadata } = args as {
        sessionId: string;
        name: string;
        componentType: string;
        parentId?: string;
        selector?: string;
        metadata?: Record<string, unknown>;
      };

      const db = getDb();

      // Validate session exists
      const session = db.prepare("SELECT id, status FROM ui_dive_sessions WHERE id = ?").get(sessionId) as any;
      if (!session) return { error: true, message: `Session not found: ${sessionId}` };
      if (session.status !== "active") return { error: true, message: `Session is ${session.status}, not active` };

      // Validate parent if provided
      if (parentId) {
        const parent = db.prepare("SELECT id FROM ui_dive_components WHERE id = ? AND session_id = ?").get(parentId, sessionId);
        if (!parent) return { error: true, message: `Parent component not found: ${parentId}` };
      }

      const id = genId("comp");
      db.prepare(
        "INSERT INTO ui_dive_components (id, session_id, parent_id, name, component_type, selector, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(id, sessionId, parentId ?? null, name, componentType, selector ?? null, metadata ? JSON.stringify(metadata) : null);

      // Set as root if first top-level component
      if (!parentId) {
        const rootCheck = db.prepare("SELECT root_component_id FROM ui_dive_sessions WHERE id = ?").get(sessionId) as any;
        if (!rootCheck.root_component_id) {
          db.prepare("UPDATE ui_dive_sessions SET root_component_id = ? WHERE id = ?").run(id, sessionId);
        }
      }

      const siblingCount = db.prepare(
        "SELECT COUNT(*) as c FROM ui_dive_components WHERE session_id = ? AND parent_id IS ?"
      ).get(sessionId, parentId ?? null) as any;

      return {
        componentId: id,
        name,
        componentType,
        parentId: parentId ?? null,
        selector: selector ?? null,
        siblingCount: siblingCount.c,
        status: "pending",
        _hint: `Component registered. Claim it for traversal: start_component_flow({ componentId: "${id}", agentId: "agent_1" }). Or register child components under it.`,
      };
    },
  },

  // 3. Start a component flow (claim for subagent)
  {
    name: "start_component_flow",
    description:
      "Claim a component for traversal by a specific subagent. Marks it as 'in_progress' and assigns the agent_id. This provides context isolation — each subagent works on its own component independently. The subagent should then log_interaction for each step and tag_ui_bug for any issues found. Call end_component_flow when done.",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string", description: "Component ID from register_component" },
        agentId: { type: "string", description: "Unique agent identifier (e.g. 'agent_1', 'nav_agent', 'form_tester')" },
      },
      required: ["componentId"],
    },
    handler: async (args) => {
      const { componentId, agentId } = args as { componentId: string; agentId?: string };
      const db = getDb();

      const comp = db.prepare(
        "SELECT c.*, s.app_url, s.app_name FROM ui_dive_components c JOIN ui_dive_sessions s ON c.session_id = s.id WHERE c.id = ?"
      ).get(componentId) as any;
      if (!comp) return { error: true, message: `Component not found: ${componentId}` };
      if (comp.status === "in_progress") {
        return { error: true, message: `Component already claimed by agent '${comp.agent_id}'. Use a different component or wait.` };
      }
      if (comp.status === "completed") {
        return { error: true, message: `Component already completed. Register a new component for additional testing.` };
      }

      const aid = agentId ?? `agent_${Date.now()}`;
      db.prepare(
        "UPDATE ui_dive_components SET status = 'in_progress', agent_id = ? WHERE id = ?"
      ).run(aid, componentId);

      // Get children for context
      const children = db.prepare(
        "SELECT id, name, component_type, status FROM ui_dive_components WHERE parent_id = ?"
      ).all(componentId) as any[];

      return {
        claimed: true,
        componentId,
        agentId: aid,
        component: {
          name: comp.name,
          type: comp.component_type,
          selector: comp.selector,
          parentId: comp.parent_id,
        },
        app: { url: comp.app_url, name: comp.app_name },
        children: children.map(ch => ({ id: ch.id, name: ch.name, type: ch.component_type, status: ch.status })),
        _hint: `Component claimed. Now interact with it: log_interaction({ componentId: "${componentId}", action: "click", target: "...", result: "success", observation: "..." }). Tag bugs with tag_ui_bug. Call end_component_flow when done.`,
      };
    },
  },

  // 4. Log an interaction (auto-executes when browser is active)
  {
    name: "log_interaction",
    description:
      "Log and optionally auto-execute an interaction step. If the built-in Playwright browser is active (launched by start_ui_dive), the action is automatically executed in the browser — just provide a CSS selector in 'target' and the result/observation are filled in for you. If no browser is active (manual mode), this logs your observation as-is. Actions: click, type, hover, scroll, navigate, submit, keypress, focus, wait, assert.",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string", description: "Component ID being tested" },
        action: {
          type: "string",
          description: "Interaction type: click, type, hover, scroll, navigate, submit, keypress, focus, wait, assert",
        },
        target: { type: "string", description: "CSS selector for auto-execution (e.g. '#submit-btn', '[data-testid=email]', 'button:has-text(\"Login\")'), or human-readable description in manual mode" },
        inputValue: { type: "string", description: "Value to type/enter (for type, submit actions), URL (for navigate), pixels (for scroll), key name (for keypress)" },
        result: {
          type: "string",
          description: "Outcome (auto-filled if browser active): success, error, unexpected, timeout, crash, no_response, partial",
        },
        observation: {
          type: "string",
          description: "What happened (auto-filled if browser active). Manual mode: describe what you observed.",
        },
        autoExecute: {
          type: "boolean",
          description: "Auto-execute the action in the browser (default: true). Set false to log-only even when browser is active.",
        },
        durationMs: { type: "number", description: "How long the interaction took in ms (auto-filled if browser active)" },
        screenshotRef: { type: "string", description: "Reference to a screenshot capture (optional)" },
      },
      required: ["componentId", "action"],
    },
    handler: async (args) => {
      const { componentId, action, target, inputValue, result, observation, autoExecute, durationMs, screenshotRef } = args as {
        componentId: string;
        action: string;
        target?: string;
        inputValue?: string;
        result?: string;
        observation?: string;
        autoExecute?: boolean;
        durationMs?: number;
        screenshotRef?: string;
      };

      const db = getDb();

      const comp = db.prepare(
        "SELECT id, session_id, status, interaction_count FROM ui_dive_components WHERE id = ?"
      ).get(componentId) as any;
      if (!comp) return { error: true, message: `Component not found: ${componentId}` };

      // Auto-execute if browser is active
      let finalResult = result ?? "success";
      let finalObservation = observation ?? "";
      let finalDuration = durationMs ?? null;
      let autoExecuted = false;

      if (_page && _activeSessionId === comp.session_id && autoExecute !== false) {
        const execResult = await executeAction(_page, action, target, inputValue);
        finalResult = execResult.success ? "success" : "error";
        finalObservation = execResult.observation + (observation ? ` | ${observation}` : "");
        finalDuration = execResult.durationMs;
        autoExecuted = true;
      }

      const seqNum = comp.interaction_count + 1;
      const id = genId("int");

      db.prepare(
        `INSERT INTO ui_dive_interactions (id, session_id, component_id, action, target, input_value, result, observation, screenshot_ref, duration_ms, sequence_num)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, comp.session_id, componentId, action, target ?? null, inputValue ?? null, finalResult, finalObservation || null, screenshotRef ?? null, finalDuration, seqNum);

      db.prepare("UPDATE ui_dive_components SET interaction_count = ? WHERE id = ?").run(seqNum, componentId);

      return {
        interactionId: id,
        sequenceNum: seqNum,
        action,
        target: target ?? null,
        result: finalResult,
        observation: finalObservation || null,
        autoExecuted,
        durationMs: finalDuration,
        _hint: finalResult !== "success"
          ? `Non-success result (${finalResult}). Consider tagging a bug: tag_ui_bug({ componentId: "${componentId}", interactionId: "${id}", severity: "...", category: "functional", title: "..." })`
          : `Interaction #${seqNum} logged. Continue testing or call end_component_flow when done.`,
      };
    },
  },

  // 5. End a component flow
  {
    name: "end_component_flow",
    description:
      "Complete a component's traversal flow. Marks it as 'completed' with a summary. Call this after all interactions and bug tagging for a component are done. The summary should capture key findings, overall health, and any patterns observed.",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string", description: "Component ID to complete" },
        summary: {
          type: "string",
          description: "Summary of findings (e.g. 'Login form works correctly. Found 1 accessibility issue with missing aria-label on password field.')",
        },
      },
      required: ["componentId", "summary"],
    },
    handler: async (args) => {
      const { componentId, summary } = args as { componentId: string; summary: string };
      const db = getDb();

      const comp = db.prepare(
        "SELECT id, session_id, name, interaction_count, bug_count FROM ui_dive_components WHERE id = ?"
      ).get(componentId) as any;
      if (!comp) return { error: true, message: `Component not found: ${componentId}` };

      db.prepare(
        "UPDATE ui_dive_components SET status = 'completed', summary = ?, completed_at = datetime('now') WHERE id = ?"
      ).run(summary, componentId);

      // Check session progress
      const total = db.prepare("SELECT COUNT(*) as c FROM ui_dive_components WHERE session_id = ?").get(comp.session_id) as any;
      const completed = db.prepare("SELECT COUNT(*) as c FROM ui_dive_components WHERE session_id = ? AND status = 'completed'").get(comp.session_id) as any;
      const totalBugs = db.prepare("SELECT COUNT(*) as c FROM ui_dive_bugs WHERE session_id = ?").get(comp.session_id) as any;

      return {
        completed: true,
        componentId,
        name: comp.name,
        interactionCount: comp.interaction_count,
        bugCount: comp.bug_count,
        summary,
        sessionProgress: {
          completedComponents: completed.c,
          totalComponents: total.c,
          remainingComponents: total.c - completed.c,
          totalBugsFound: totalBugs.c,
        },
        _hint: completed.c === total.c
          ? `All components completed! Generate the final report: get_dive_report({ sessionId: "${comp.session_id}" })`
          : `${total.c - completed.c} components remaining. Continue with the next component or get_dive_tree for current state.`,
      };
    },
  },

  // 6. Tag a bug
  {
    name: "tag_ui_bug",
    description:
      "Tag a bug to a specific component (and optionally a specific interaction). Bugs are categorized by severity (critical/high/medium/low) and category (visual, functional, accessibility, performance, responsive, ux, content, security). Each bug is linked to its component in the tree for precise debugging.",
    inputSchema: {
      type: "object",
      properties: {
        componentId: { type: "string", description: "Component where the bug was found" },
        interactionId: { type: "string", description: "Specific interaction that triggered the bug (optional)" },
        severity: { type: "string", description: "Bug severity: critical, high, medium, low" },
        category: {
          type: "string",
          description: "Bug category: visual (layout/styling), functional (broken behavior), accessibility (a11y), performance (slow/laggy), responsive (breakpoint issues), ux (confusing/poor UX), content (text/copy issues), security (auth/data exposure)",
        },
        title: { type: "string", description: "Short bug title (e.g. 'Submit button unresponsive on mobile')" },
        description: { type: "string", description: "Detailed description of the bug" },
        expected: { type: "string", description: "What should happen" },
        actual: { type: "string", description: "What actually happens" },
        screenshotRef: { type: "string", description: "Reference to a screenshot showing the bug (optional)" },
      },
      required: ["componentId", "severity", "category", "title"],
    },
    handler: async (args) => {
      const { componentId, interactionId, severity, category, title, description, expected, actual, screenshotRef } = args as {
        componentId: string;
        interactionId?: string;
        severity: string;
        category: string;
        title: string;
        description?: string;
        expected?: string;
        actual?: string;
        screenshotRef?: string;
      };

      const db = getDb();

      const comp = db.prepare("SELECT id, session_id, bug_count FROM ui_dive_components WHERE id = ?").get(componentId) as any;
      if (!comp) return { error: true, message: `Component not found: ${componentId}` };

      const id = genId("bug");
      db.prepare(
        `INSERT INTO ui_dive_bugs (id, session_id, component_id, interaction_id, severity, category, title, description, expected, actual, screenshot_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, comp.session_id, componentId, interactionId ?? null, severity, category, title, description ?? null, expected ?? null, actual ?? null, screenshotRef ?? null);

      const newBugCount = comp.bug_count + 1;
      db.prepare("UPDATE ui_dive_components SET bug_count = ? WHERE id = ?").run(newBugCount, componentId);

      const sessionBugs = db.prepare(
        "SELECT severity, COUNT(*) as c FROM ui_dive_bugs WHERE session_id = ? GROUP BY severity"
      ).all(comp.session_id) as any[];

      return {
        bugId: id,
        severity,
        category,
        title,
        componentBugCount: newBugCount,
        sessionBugSummary: Object.fromEntries(sessionBugs.map(b => [b.severity, b.c])),
        _hint: `Bug tagged. Continue testing this component or call end_component_flow when done.`,
      };
    },
  },

  // 7. Get the component tree
  {
    name: "get_dive_tree",
    description:
      "Get the full XML-like component tree for a dive session. Shows all registered components in their hierarchy with status, agent assignments, interaction counts, and bug counts. Also returns a Mermaid diagram for visual rendering. Use this for a quick overview of app structure and dive progress.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Dive session ID" },
        format: {
          type: "string",
          description: "Output format: 'xml' (default — XML-like tree), 'mermaid' (Mermaid flowchart), 'both' (both formats)",
        },
      },
      required: ["sessionId"],
    },
    handler: async (args) => {
      const { sessionId, format } = args as { sessionId: string; format?: string };
      const db = getDb();

      const session = db.prepare("SELECT * FROM ui_dive_sessions WHERE id = ?").get(sessionId) as any;
      if (!session) return { error: true, message: `Session not found: ${sessionId}` };

      const components = db.prepare(
        "SELECT * FROM ui_dive_components WHERE session_id = ? ORDER BY created_at"
      ).all(sessionId) as ComponentRow[];

      const bugs = db.prepare(
        "SELECT * FROM ui_dive_bugs WHERE session_id = ? ORDER BY created_at"
      ).all(sessionId) as BugRow[];

      const fmt = format ?? "both";

      const completed = components.filter(c => c.status === "completed").length;
      const inProgress = components.filter(c => c.status === "in_progress").length;
      const pending = components.filter(c => c.status === "pending").length;

      const result: Record<string, unknown> = {
        session: {
          id: session.id,
          appUrl: session.app_url,
          appName: session.app_name,
          status: session.status,
        },
        stats: {
          totalComponents: components.length,
          completed,
          inProgress,
          pending,
          totalBugs: bugs.length,
          bugsBySeverity: Object.fromEntries(
            ["critical", "high", "medium", "low"]
              .map(s => [s, bugs.filter(b => b.severity === s).length])
              .filter(([, c]) => (c as number) > 0)
          ),
        },
      };

      if (fmt === "xml" || fmt === "both") {
        const xml = `<app name="${session.app_name ?? session.app_url}" url="${session.app_url}">\n${buildTreeXml(components, bugs, null, 1)}</app>`;
        result.xmlTree = xml;
      }

      if (fmt === "mermaid" || fmt === "both") {
        result.mermaidDiagram = buildMermaidDiagram(components, bugs);
      }

      return result;
    },
  },

  // 8. Generate final report
  {
    name: "get_dive_report",
    description:
      "Generate a comprehensive UI/UX Full Dive report for a session. Includes: executive summary, component tree, all bugs grouped by severity, per-component interaction traces, Mermaid diagram, and actionable recommendations. Optionally marks the session as completed. This is the final deliverable after all subagents have finished their traversals.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Dive session ID" },
        completeSession: { type: "boolean", description: "Mark the session as completed (default: true)" },
      },
      required: ["sessionId"],
    },
    handler: async (args) => {
      const { sessionId, completeSession } = args as { sessionId: string; completeSession?: boolean };
      const db = getDb();

      const session = db.prepare("SELECT * FROM ui_dive_sessions WHERE id = ?").get(sessionId) as any;
      if (!session) return { error: true, message: `Session not found: ${sessionId}` };

      const components = db.prepare(
        "SELECT * FROM ui_dive_components WHERE session_id = ? ORDER BY created_at"
      ).all(sessionId) as ComponentRow[];

      const bugs = db.prepare(
        "SELECT b.*, c.name as component_name, c.component_type FROM ui_dive_bugs b JOIN ui_dive_components c ON b.component_id = c.id WHERE b.session_id = ? ORDER BY CASE b.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END, b.created_at"
      ).all(sessionId) as any[];

      const interactions = db.prepare(
        "SELECT i.*, c.name as component_name FROM ui_dive_interactions i JOIN ui_dive_components c ON i.component_id = c.id WHERE i.session_id = ? ORDER BY c.id, i.sequence_num"
      ).all(sessionId) as any[];

      // Mark session complete and close browser
      if (completeSession !== false) {
        db.prepare("UPDATE ui_dive_sessions SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(sessionId);
        if (_activeSessionId === sessionId) {
          await closeBrowser();
        }
      }

      // Build per-component summaries
      const componentDetails = components.map(c => {
        const cBugs = bugs.filter((b: any) => b.component_id === c.id);
        const cInteractions = interactions.filter((i: any) => i.component_id === c.id);
        return {
          id: c.id,
          name: c.name,
          type: c.component_type,
          status: c.status,
          agent: c.agent_id,
          summary: c.summary,
          interactionCount: cInteractions.length,
          bugs: cBugs.map((b: any) => ({
            id: b.id,
            severity: b.severity,
            category: b.category,
            title: b.title,
            description: b.description,
            expected: b.expected,
            actual: b.actual,
          })),
          interactions: cInteractions.map((i: any) => ({
            seq: i.sequence_num,
            action: i.action,
            target: i.target,
            result: i.result,
            observation: i.observation,
          })),
        };
      });

      const completed = components.filter(c => c.status === "completed").length;
      const criticalBugs = bugs.filter((b: any) => b.severity === "critical").length;
      const highBugs = bugs.filter((b: any) => b.severity === "high").length;

      const healthScore = components.length > 0
        ? Math.max(0, Math.round(100 - (criticalBugs * 25) - (highBugs * 10) - (bugs.length * 2)))
        : 0;

      const xmlTree = `<app name="${session.app_name ?? session.app_url}" url="${session.app_url}">\n${buildTreeXml(components, bugs as BugRow[], null, 1)}</app>`;
      const mermaid = buildMermaidDiagram(components, bugs as BugRow[]);

      return {
        report: {
          title: `UI/UX Full Dive Report: ${session.app_name ?? session.app_url}`,
          appUrl: session.app_url,
          sessionId,
          createdAt: session.created_at,
          completedAt: new Date().toISOString(),
          healthScore,
          healthGrade: healthScore >= 90 ? "A" : healthScore >= 75 ? "B" : healthScore >= 60 ? "C" : healthScore >= 40 ? "D" : "F",
        },
        summary: {
          totalComponents: components.length,
          completedComponents: completed,
          totalInteractions: interactions.length,
          totalBugs: bugs.length,
          bugsBySeverity: {
            critical: criticalBugs,
            high: highBugs,
            medium: bugs.filter((b: any) => b.severity === "medium").length,
            low: bugs.filter((b: any) => b.severity === "low").length,
          },
          bugsByCategory: Object.fromEntries(
            [...new Set(bugs.map((b: any) => b.category))].map(cat => [
              cat,
              bugs.filter((b: any) => b.category === cat).length,
            ])
          ),
          agentsUsed: [...new Set(components.filter(c => c.agent_id).map(c => c.agent_id))],
        },
        xmlTree,
        mermaidDiagram: mermaid,
        components: componentDetails,
        recommendations: [
          ...(criticalBugs > 0 ? [`FIX IMMEDIATELY: ${criticalBugs} critical bug(s) found — these block usability.`] : []),
          ...(highBugs > 0 ? [`HIGH PRIORITY: ${highBugs} high-severity bug(s) should be fixed before next release.`] : []),
          ...(completed < components.length ? [`${components.length - completed} component(s) not fully tested — consider re-running the dive.`] : []),
          ...(interactions.length === 0 ? ["No interactions logged — ensure subagents are calling log_interaction during traversal."] : []),
          ...(bugs.some((b: any) => b.category === "accessibility") ? ["Accessibility issues found — run an a11y audit with axe-core or lighthouse."] : []),
          ...(bugs.some((b: any) => b.category === "responsive") ? ["Responsive issues found — test with capture_responsive_suite across breakpoints."] : []),
        ],
      };
    },
  },

  // 9. Take a screenshot / accessibility snapshot
  {
    name: "dive_snapshot",
    description:
      "Capture a screenshot or accessibility snapshot of the current page during a dive session. Requires the built-in Playwright browser to be active (launched by start_ui_dive). Returns the screenshot as an inline image for multimodal agents, or an accessibility tree as text. Use this to capture visual evidence of bugs or document the current state of a component.",
    rawContent: true,
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Dive session ID (verifies browser belongs to this session)" },
        mode: {
          type: "string",
          description: "Capture mode: 'screenshot' (default — full page PNG), 'viewport' (visible area only), 'accessibility' (a11y tree as text)",
        },
        selector: { type: "string", description: "CSS selector to screenshot a specific element (optional — screenshots the element only)" },
        label: { type: "string", description: "Label for this snapshot (e.g. 'after-login', 'error-state', 'mobile-nav-open')" },
      },
      required: ["sessionId"],
    },
    handler: async (args): Promise<RawToolResult> => {
      const { sessionId, mode, selector, label } = args as {
        sessionId: string;
        mode?: string;
        selector?: string;
        label?: string;
      };

      if (!_page || _activeSessionId !== sessionId) {
        return {
          error: true,
          message: "No active browser for this session. Start a dive with start_ui_dive first, or install Playwright: npm install playwright && npx playwright install chromium",
        };
      }

      const captureMode = mode ?? "screenshot";

      if (captureMode === "accessibility") {
        try {
          const snapshot = await _page.accessibility.snapshot();
          return [{
            type: "text",
            text: JSON.stringify({
              label: label ?? "accessibility-snapshot",
              pageTitle: await _page.title(),
              pageUrl: _page.url(),
              accessibilityTree: snapshot,
            }, null, 2),
          }];
        } catch (e: any) {
          return { error: true, message: `Accessibility snapshot failed: ${e.message}` };
        }
      }

      // Screenshot mode
      try {
        const screenshotOpts: Record<string, unknown> = {
          type: "png" as const,
          fullPage: captureMode !== "viewport",
        };

        let screenshotBuf: Buffer;
        if (selector) {
          const el = await _page.$(selector);
          if (!el) {
            return { error: true, message: `Element not found: ${selector}` };
          }
          screenshotBuf = await el.screenshot({ type: "png" });
        } else {
          screenshotBuf = await _page.screenshot(screenshotOpts);
        }

        const base64 = screenshotBuf.toString("base64");
        const title = await _page.title();
        const url = _page.url();
        const snapLabel = label ?? `dive-snapshot-${Date.now()}`;

        // Persist screenshot to DB so dashboard can display it
        try {
          const db = getDb();
          const ssId = genId("ss");
          // Extract route from URL
          let route: string | null = null;
          try { route = new URL(url).pathname; } catch {}
          db.prepare(
            "INSERT INTO ui_dive_screenshots (id, session_id, label, route, base64_thumbnail, width, height, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).run(ssId, sessionId, snapLabel, route, base64, null, null, JSON.stringify({ captureMode, selector: selector ?? "full page", pageTitle: title, pageUrl: url, sizeBytes: screenshotBuf.length }));
        } catch { /* best-effort DB persist */ }

        return [
          {
            type: "text",
            text: JSON.stringify({
              label: snapLabel,
              pageTitle: title,
              pageUrl: url,
              captureMode,
              selector: selector ?? "full page",
              sizeBytes: screenshotBuf.length,
            }),
          },
          {
            type: "image",
            data: base64,
            mimeType: "image/png",
          },
        ];
      } catch (e: any) {
        return { error: true, message: `Screenshot failed: ${e.message}` };
      }
    },
  },

  // 10. Auto-discover components from the current page DOM
  {
    name: "dive_auto_discover",
    description:
      "Scan the current page DOM and auto-register components in the dive tree. Discovers semantic landmarks (nav, header, footer, forms, modals, tables, sidebars) and counts interactive elements within each. Useful after navigating to a new page during a dive session. Requires the built-in Playwright browser to be active.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Dive session ID" },
        parentId: { type: "string", description: "Parent component ID to nest discovered components under (optional — null for top-level)" },
        navigateUrl: { type: "string", description: "Navigate to this URL before discovering (optional — discovers current page if omitted)" },
      },
      required: ["sessionId"],
    },
    handler: async (args) => {
      const { sessionId, parentId, navigateUrl } = args as {
        sessionId: string;
        parentId?: string;
        navigateUrl?: string;
      };

      if (!_page || _activeSessionId !== sessionId) {
        return {
          error: true,
          message: "No active browser for this session. Start a dive with start_ui_dive first.",
          setupHint: "npm install playwright && npx playwright install chromium",
        };
      }

      const db = getDb();
      const session = db.prepare("SELECT id, status FROM ui_dive_sessions WHERE id = ?").get(sessionId) as any;
      if (!session) return { error: true, message: `Session not found: ${sessionId}` };
      if (session.status !== "active") return { error: true, message: `Session is ${session.status}, not active` };

      // Navigate if URL provided
      if (navigateUrl) {
        try {
          await _page.goto(navigateUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        } catch (e: any) {
          return { error: true, message: `Navigation failed: ${e.message}` };
        }
      }

      const pageTitle = await _page.title();
      const pageUrl = _page.url();

      try {
        const discovered = await autoDiscoverComponents(_page);
        const registeredIds: string[] = [];

        for (const comp of discovered) {
          const compId = genId("comp");
          db.prepare(
            "INSERT INTO ui_dive_components (id, session_id, parent_id, name, component_type, selector, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).run(compId, sessionId, parentId ?? null, comp.name, comp.type, comp.selector, JSON.stringify({ autoDiscovered: true, interactiveChildren: comp.children, pageUrl, pageTitle }));
          registeredIds.push(compId);
        }

        return {
          pageTitle,
          pageUrl,
          componentsDiscovered: discovered.length,
          components: discovered.map((c, i) => ({
            componentId: registeredIds[i],
            ...c,
          })),
          parentId: parentId ?? null,
          _hint: discovered.length > 0
            ? `${discovered.length} components auto-registered. Claim them for testing with start_component_flow.`
            : "No semantic landmarks found. Register components manually with register_component.",
        };
      } catch (e: any) {
        return { error: true, message: `Auto-discover failed: ${e.message}` };
      }
    },
  },

  // 11. Ingest screenshots from disk into the dive DB
  {
    name: "ingest_dive_screenshots",
    description:
      "Scan a directory for PNG/JPG screenshot files and bulk-import them into the dive session's screenshot gallery. Use this after a deep dive that captured screenshots via external Playwright MCP (which saves to disk but not the DB). Files are read, base64-encoded, and inserted so the dashboard can display them. Supports recursive scan.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Dive session ID to associate screenshots with. Use 'latest' for the most recent session.",
        },
        directory: {
          type: "string",
          description: "Absolute path to directory containing screenshot files (PNG/JPG).",
        },
        recursive: {
          type: "boolean",
          description: "Scan subdirectories too (default: false)",
        },
        maxFiles: {
          type: "number",
          description: "Maximum number of files to ingest (default: 100)",
        },
        maxFileSizeKb: {
          type: "number",
          description: "Skip files larger than this (KB). Default: 2048 (2MB). Keeps DB size manageable.",
        },
      },
      required: ["directory"],
    },
    handler: async (args) => {
      const {
        sessionId: rawSessionId,
        directory,
        recursive = false,
        maxFiles = 100,
        maxFileSizeKb = 2048,
      } = args as {
        sessionId?: string;
        directory: string;
        recursive?: boolean;
        maxFiles?: number;
        maxFileSizeKb?: number;
      };

      const fs = await import("fs");
      const pathMod = await import("path");
      const db = getDb();

      // Resolve session
      let sessionId = rawSessionId;
      if (!sessionId || sessionId === "latest") {
        const latest = db
          .prepare("SELECT id FROM ui_dive_sessions ORDER BY created_at DESC LIMIT 1")
          .get() as any;
        if (!latest) return { error: true, message: "No dive sessions found." };
        sessionId = latest.id;
      }

      const session = db
        .prepare("SELECT id, app_name FROM ui_dive_sessions WHERE id = ?")
        .get(sessionId) as any;
      if (!session) return { error: true, message: `Session not found: ${sessionId}` };

      // Collect files
      const exts = new Set([".png", ".jpg", ".jpeg", ".webp"]);
      const files: string[] = [];

      function scan(dir: string) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory() && recursive) {
            scan(pathMod.join(dir, entry.name));
          } else if (entry.isFile() && exts.has(pathMod.extname(entry.name).toLowerCase())) {
            files.push(pathMod.join(dir, entry.name));
          }
        }
      }
      scan(directory);

      if (files.length === 0)
        return { error: false, message: "No screenshot files found in " + directory, ingested: 0 };

      // Sort by mtime (newest first)
      files.sort((a, b) => {
        try {
          return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
        } catch {
          return 0;
        }
      });

      const toIngest = files.slice(0, maxFiles);
      const maxBytes = maxFileSizeKb * 1024;
      const ins = db.prepare(
        "INSERT INTO ui_dive_screenshots (id, session_id, label, route, file_path, base64_thumbnail, width, height, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );

      // Check for existing file_paths to avoid duplicates
      const existingPaths = new Set(
        (
          db
            .prepare("SELECT file_path FROM ui_dive_screenshots WHERE session_id = ? AND file_path IS NOT NULL")
            .all(sessionId) as any[]
        ).map((r: any) => r.file_path)
      );

      let ingested = 0;
      let skippedSize = 0;
      let skippedDupe = 0;
      const results: Array<{ file: string; label: string; sizeKb: number }> = [];

      for (const filePath of toIngest) {
        if (existingPaths.has(filePath)) {
          skippedDupe++;
          continue;
        }

        let stat;
        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }
        if (stat.size > maxBytes) {
          skippedSize++;
          continue;
        }

        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString("base64");
        const basename = pathMod.basename(filePath, pathMod.extname(filePath));
        // Derive label from filename: 01-landing -> "Landing", audit-panel-overview -> "Audit Panel Overview"
        const label = basename
          .replace(/^\d+-/, "")
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c: string) => c.toUpperCase())
          .trim() || basename;

        // Try to extract route from filename patterns like "page-index-03-pdf-uploaded"
        let route: string | null = null;
        const routeMatch = basename.match(/^(?:page-index-)?\d+-(.+)/);
        if (routeMatch) route = "/" + routeMatch[1].replace(/[-_]/g, "-");

        const ssId = genId("ss");
        const mtime = stat.mtime.toISOString().replace("T", " ").slice(0, 19);
        ins.run(
          ssId,
          sessionId,
          label,
          route,
          filePath,
          b64,
          null,
          null,
          JSON.stringify({ ingestedFrom: filePath, sizeBytes: stat.size }),
          mtime
        );
        ingested++;
        results.push({ file: pathMod.basename(filePath), label, sizeKb: Math.round(stat.size / 1024) });
      }

      return {
        sessionId,
        sessionName: session.app_name,
        directory,
        filesFound: files.length,
        ingested,
        skippedDupe,
        skippedSize,
        results,
        _hint: ingested > 0
          ? `${ingested} screenshots ingested. Open the dashboard to see them in the Screenshots gallery.`
          : "No new screenshots to ingest.",
      };
    },
  },
];
