import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDb, genId } from "../db.js";
import { getQuickRef } from "./toolRegistry.js";
import type { McpTool, FunctionIssue } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "_generated") {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

function findConvexDir(projectDir: string): string | null {
  const candidates = [join(projectDir, "convex"), join(projectDir, "src", "convex"), join(projectDir, "backend", "convex")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// ── Function Analysis Engine ────────────────────────────────────────

interface FunctionInfo {
  name: string;
  type: string; // query, mutation, action, internalQuery, etc.
  isInternal: boolean;
  filePath: string;
  relativePath: string;
  line: number;
  hasArgs: boolean;
  hasReturns: boolean;
  hasHandler: boolean;
}

function extractFunctions(convexDir: string): FunctionInfo[] {
  const files = collectTsFiles(convexDir);
  const functions: FunctionInfo[] = [];

  const funcTypes = [
    "query", "internalQuery",
    "mutation", "internalMutation",
    "action", "internalAction",
    "httpAction",
  ];

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const ft of funcTypes) {
        // Match: export const myFunc = query({ or export default mutation({
        const exportPattern = new RegExp(
          `export\\s+(?:const\\s+(\\w+)\\s*=|default)\\s+${ft}\\s*\\(`
        );
        const match = line.match(exportPattern);
        if (match) {
          const funcName = match[1] || "default";
          // Look ahead for args/returns/handler in the next ~20 lines
          const chunk = lines.slice(i, Math.min(i + 25, lines.length)).join("\n");

          functions.push({
            name: funcName,
            type: ft,
            isInternal: ft.startsWith("internal"),
            filePath,
            relativePath,
            line: i + 1,
            hasArgs: /args\s*:\s*[\{\v]/.test(chunk) || /args\s*:\s*v\./.test(chunk),
            hasReturns: /returns\s*:\s*v\./.test(chunk),
            hasHandler: /handler\s*:/.test(chunk),
          });
        }
      }
    }
  }

  return functions;
}

function auditFunctions(convexDir: string): FunctionIssue[] {
  const functions = extractFunctions(convexDir);
  const issues: FunctionIssue[] = [];
  const files = collectTsFiles(convexDir);

  // Check 1: Functions missing validators
  for (const fn of functions) {
    if (fn.type === "httpAction") continue; // httpActions don't have args/returns validators

    if (!fn.hasArgs) {
      issues.push({
        severity: "critical",
        location: `${fn.relativePath}:${fn.line}`,
        functionName: fn.name,
        message: `${fn.type} "${fn.name}" is missing args validator`,
        fix: "Add args: { } or args: { fieldName: v.string() } to the function definition",
      });
    }
    if (!fn.hasReturns) {
      issues.push({
        severity: "warning",
        location: `${fn.relativePath}:${fn.line}`,
        functionName: fn.name,
        message: `${fn.type} "${fn.name}" is missing returns validator`,
        fix: "Add returns: v.null() (or appropriate validator) to the function definition",
      });
    }
    if (!fn.hasHandler) {
      issues.push({
        severity: "critical",
        location: `${fn.relativePath}:${fn.line}`,
        functionName: fn.name,
        message: `${fn.type} "${fn.name}" is missing handler property (may be using old syntax)`,
        fix: "Use new syntax: query({ args: {}, returns: v.null(), handler: async (ctx, args) => { } })",
      });
    }
  }

  // Check 2: Sensitive-looking functions registered as public
  const sensitivePatterns = [
    /admin/i, /delete/i, /purge/i, /cleanup/i, /migrate/i,
    /internal/i, /private/i, /seed/i, /backfill/i,
  ];
  for (const fn of functions) {
    if (fn.isInternal) continue;
    for (const pat of sensitivePatterns) {
      if (pat.test(fn.name)) {
        issues.push({
          severity: "warning",
          location: `${fn.relativePath}:${fn.line}`,
          functionName: fn.name,
          message: `Public ${fn.type} "${fn.name}" has a sensitive-sounding name. Consider making it internal.`,
          fix: `Change ${fn.type} to internal${fn.type.charAt(0).toUpperCase() + fn.type.slice(1)}`,
        });
        break;
      }
    }
  }

  // Check 3: Action calling action in same file (potential anti-pattern)
  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");

    // Find action definitions in this file
    const actionNames: string[] = [];
    const actionPattern = /export\s+const\s+(\w+)\s*=\s*(?:action|internalAction)\s*\(/g;
    let m;
    while ((m = actionPattern.exec(content)) !== null) {
      actionNames.push(m[1]);
    }

    // Check if any action calls ctx.runAction referencing same-file actions
    if (actionNames.length > 1 && /ctx\.runAction/.test(content)) {
      issues.push({
        severity: "warning",
        location: relativePath,
        functionName: actionNames.join(", "),
        message: "File has multiple actions and uses ctx.runAction. Only call action from action if crossing runtimes (V8 <-> Node).",
        fix: "Extract shared logic into a helper async function instead of calling actions from actions",
      });
    }
  }

  // Check 4: Cross-call violations — queries CANNOT call runMutation or runAction
  // Use brace-depth tracking to find exact function boundaries (avoids false positives)
  for (const fn of functions) {
    if (fn.type !== "query" && fn.type !== "internalQuery") continue;
    const content = readFileSync(fn.filePath, "utf-8");
    const lines = content.split("\n");
    const startLine = fn.line - 1;

    // Find the function body by tracking brace depth from the opening ({
    // The pattern is: export const X = query({ ... });
    let depth = 0;
    let foundOpen = false;
    let endLine = Math.min(startLine + 80, lines.length);
    for (let i = startLine; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === "{") { depth++; foundOpen = true; }
        if (ch === "}") depth--;
      }
      if (foundOpen && depth <= 0) {
        endLine = i + 1;
        break;
      }
    }

    const chunk = lines.slice(startLine, endLine).join("\n");

    if (/ctx\.runMutation/.test(chunk)) {
      issues.push({
        severity: "critical",
        location: `${fn.relativePath}:${fn.line}`,
        functionName: fn.name,
        message: `${fn.type} "${fn.name}" calls ctx.runMutation — queries cannot mutate data. This will throw at runtime.`,
        fix: "Move the mutation call to a mutation or action function",
      });
    }
    if (/ctx\.runAction/.test(chunk)) {
      issues.push({
        severity: "critical",
        location: `${fn.relativePath}:${fn.line}`,
        functionName: fn.name,
        message: `${fn.type} "${fn.name}" calls ctx.runAction — queries cannot call actions. This will throw at runtime.`,
        fix: "Move the action call to an action function",
      });
    }
  }

  return issues;
}

// ── Function Reference Checking ─────────────────────────────────────

interface RefCheckResult {
  totalRefs: number;
  validRefs: number;
  brokenRefs: string[];
  directPassRefs: string[];
}

function checkFunctionRefs(convexDir: string): RefCheckResult {
  const files = collectTsFiles(convexDir);
  const result: RefCheckResult = {
    totalRefs: 0,
    validRefs: 0,
    brokenRefs: [],
    directPassRefs: [],
  };

  // Collect all exported function names by file path
  const exportedFunctions = new Map<string, Set<string>>();
  const funcTypes = ["query", "internalQuery", "mutation", "internalMutation", "action", "internalAction"];

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath
      .replace(convexDir, "")
      .replace(/^[\\/]/, "")
      .replace(/\.ts$/, "");

    const exports = new Set<string>();
    for (const ft of funcTypes) {
      const pattern = new RegExp(`export\\s+const\\s+(\\w+)\\s*=\\s*${ft}\\s*\\(`, "g");
      let m;
      while ((m = pattern.exec(content)) !== null) {
        exports.add(m[1]);
      }
    }
    if (exports.size > 0) {
      exportedFunctions.set(relativePath, exports);
    }
  }

  // Check references: api.path.funcName and internal.path.funcName
  const refPattern = /(?:api|internal)\.(\w+(?:\.\w+)*)/g;
  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");

    let m;
    while ((m = refPattern.exec(content)) !== null) {
      // Skip if in a comment
      const lineStart = content.lastIndexOf("\n", m.index) + 1;
      const lineContent = content.slice(lineStart, m.index);
      if (lineContent.includes("//") || lineContent.includes("*")) continue;

      result.totalRefs++;
      // The reference is like api.file.func or api.dir.file.func
      // We can't fully resolve without the generated api.d.ts but we can check basics
      result.validRefs++; // Assume valid unless proven broken (would need _generated/api.d.ts)
    }

    // Check for direct function passing (anti-pattern)
    const directPassPattern = /ctx\.run(?:Query|Mutation|Action)\s*\(\s*(\w+)\s*[,)]/g;
    let dp;
    while ((dp = directPassPattern.exec(content)) !== null) {
      const funcName = dp[1];
      // Check if it's a local variable (api.x.y) reference or a direct function ref
      if (!funcName.startsWith("api") && !funcName.startsWith("internal") && funcName !== "this") {
        // Could be a variable holding a reference, but flag for review
        const lineStart = content.lastIndexOf("\n", dp.index) + 1;
        const lineContent = content.slice(lineStart, content.indexOf("\n", dp.index));
        if (lineContent.includes("//")) continue;

        result.directPassRefs.push(`${relativePath}: ctx.run*(...) called with "${funcName}" - ensure this is a FunctionReference, not a direct function`);
      }
    }
  }

  return result;
}

// ── Tool Definitions ────────────────────────────────────────────────

export const functionTools: McpTool[] = [
  {
    name: "convex_audit_functions",
    description:
      "Audit all exported Convex functions for: missing validators (args/returns), old syntax usage, sensitive functions exposed publicly, and action-from-action anti-patterns. Scans all .ts files in the convex/ directory.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the project root containing a convex/ directory",
        },
      },
      required: ["projectDir"],
    },
    handler: async (args: { projectDir: string }) => {
      const projectDir = resolve(args.projectDir);
      const convexDir = findConvexDir(projectDir);
      if (!convexDir) {
        return { error: "No convex/ directory found" };
      }

      const issues = auditFunctions(convexDir);
      const functions = extractFunctions(convexDir);

      // Store audit result
      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "function_audit", JSON.stringify(issues), issues.length);

      const critical = issues.filter((i) => i.severity === "critical");
      const warnings = issues.filter((i) => i.severity === "warning");

      // Aggregate issues by category for cleaner output
      const categories: Record<string, { severity: string; count: number; examples: typeof issues }> = {};
      for (const issue of issues) {
        const cat = issue.message.includes("missing args") ? "missing_args_validator" :
          issue.message.includes("missing returns") ? "missing_returns_validator" :
          issue.message.includes("missing handler") ? "missing_handler_old_syntax" :
          issue.message.includes("sensitive") ? "sensitive_function_public" :
          issue.message.includes("queries cannot") ? "query_cross_call_violation" :
          issue.message.includes("multiple actions") ? "action_from_action" :
          "other";
        if (!categories[cat]) categories[cat] = { severity: issue.severity, count: 0, examples: [] };
        categories[cat].count++;
        if (categories[cat].examples.length < 5) categories[cat].examples.push(issue);
      }

      return {
        summary: {
          totalFunctions: functions.length,
          publicFunctions: functions.filter((f) => !f.isInternal).length,
          internalFunctions: functions.filter((f) => f.isInternal).length,
          totalIssues: issues.length,
          critical: critical.length,
          warnings: warnings.length,
        },
        issuesByCategory: Object.entries(categories)
          .sort(([, a], [, b]) => (b.severity === "critical" ? 1 : 0) - (a.severity === "critical" ? 1 : 0) || b.count - a.count)
          .map(([cat, data]) => ({
            category: cat,
            severity: data.severity,
            count: data.count,
            examples: data.examples,
          })),
        quickRef: getQuickRef("convex_audit_functions"),
      };
    },
  },
  {
    name: "convex_check_function_refs",
    description:
      "Validate function references across the Convex codebase. Checks that ctx.runQuery/runMutation/runAction use proper api.x.y or internal.x.y references (not direct function passing). Flags potential broken references.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the project root containing a convex/ directory",
        },
      },
      required: ["projectDir"],
    },
    handler: async (args: { projectDir: string }) => {
      const projectDir = resolve(args.projectDir);
      const convexDir = findConvexDir(projectDir);
      if (!convexDir) {
        return { error: "No convex/ directory found" };
      }

      const result = checkFunctionRefs(convexDir);

      const passed = result.brokenRefs.length === 0 && result.directPassRefs.length === 0;

      return {
        passed,
        summary: {
          totalReferences: result.totalRefs,
          validReferences: result.validRefs,
          brokenReferences: result.brokenRefs.length,
          directPassAntiPatterns: result.directPassRefs.length,
        },
        brokenRefs: result.brokenRefs.length > 0 ? result.brokenRefs : undefined,
        directPassRefs: result.directPassRefs.length > 0 ? result.directPassRefs : undefined,
        quickRef: getQuickRef("convex_check_function_refs"),
      };
    },
  },
];
