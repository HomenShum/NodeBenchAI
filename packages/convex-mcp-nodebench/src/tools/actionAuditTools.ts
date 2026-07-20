import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDb, genId } from "../db.js";
import { getQuickRef } from "./toolRegistry.js";
import type { McpTool } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function findConvexDir(projectDir: string): string | null {
  const candidates = [join(projectDir, "convex"), join(projectDir, "src", "convex"), join(projectDir, "backend", "convex")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

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

// ── Action Audit Engine ─────────────────────────────────────────────

interface ActionIssue {
  severity: "critical" | "warning" | "info";
  location: string;
  functionName: string;
  message: string;
  fix: string;
}

function auditActions(convexDir: string): {
  issues: ActionIssue[];
  stats: {
    totalActions: number;
    actionsWithDbAccess: number;
    actionsWithoutNodeDirective: number;
    actionsWithoutErrorHandling: number;
    actionCallingAction: number;
  };
} {
  const files = collectTsFiles(convexDir);
  const issues: ActionIssue[] = [];
  let totalActions = 0;
  let actionsWithDbAccess = 0;
  let actionsWithoutNodeDirective = 0;
  let actionsWithoutErrorHandling = 0;
  let actionCallingAction = 0;

  // Node APIs that require "use node" directive
  // NOTE: process.env is polyfilled by Convex in both runtimes — NOT a Node-only API
  // NOTE: crypto.subtle / crypto.getRandomValues are Web Crypto API — available without "use node"
  const nodeApis = /\b(require\s*\(|__dirname|__filename|Buffer\.|fs\.|path\.|child_process|net\.|http\.|https\.)\b/;
  const nodeCryptoApis = /\bcrypto\.(create|randomBytes|pbkdf2|scrypt|sign|verify|getCiphers|getDiffieHellman|getHashes|Hash|Hmac|Cipher|Decipher)\b/;

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");
    const lines = content.split("\n");
    const hasUseNode = /["']use node["']/.test(content);

    const actionPattern = /export\s+(?:const\s+(\w+)\s*=|default)\s+(action|internalAction)\s*\(/g;
    let m;
    while ((m = actionPattern.exec(content)) !== null) {
      const funcName = m[1] || "default";
      const funcType = m[2];
      totalActions++;

      const startLine = content.slice(0, m.index).split("\n").length - 1;

      // Extract body using brace tracking
      let depth = 0;
      let foundOpen = false;
      let endLine = Math.min(startLine + 100, lines.length);
      for (let j = startLine; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === "{") { depth++; foundOpen = true; }
          if (ch === "}") depth--;
        }
        if (foundOpen && depth <= 0) { endLine = j + 1; break; }
      }
      const body = lines.slice(startLine, endLine).join("\n");

      // Check 1: ctx.db access in action (FATAL — not allowed)
      if (/ctx\.db\.(get|query|insert|patch|replace|delete)\s*\(/.test(body)) {
        actionsWithDbAccess++;
        issues.push({
          severity: "critical",
          location: `${relativePath}:${startLine + 1}`,
          functionName: funcName,
          message: `${funcType} "${funcName}" accesses ctx.db directly. Actions cannot access the database — use ctx.runQuery/ctx.runMutation instead.`,
          fix: "Move DB operations into a query or mutation, then call via ctx.runQuery(internal.file.func, args) or ctx.runMutation(...)",
        });
      }

      // Check 2: Node API usage without "use node"
      if (!hasUseNode && (nodeApis.test(body) || nodeCryptoApis.test(body))) {
        actionsWithoutNodeDirective++;
        issues.push({
          severity: "critical",
          location: `${relativePath}:${startLine + 1}`,
          functionName: funcName,
          message: `${funcType} "${funcName}" uses Node.js APIs but file lacks "use node" directive. Will fail in Convex runtime.`,
          fix: `Add "use node"; at the top of ${relativePath}`,
        });
      }

      // Check 3: External API calls without try/catch
      const hasFetch = /\bfetch\s*\(/.test(body);
      const hasAxios = /\baxios\b/.test(body);
      const hasExternalCall = hasFetch || hasAxios;
      const hasTryCatch = /try\s*\{/.test(body);

      if (hasExternalCall && !hasTryCatch) {
        actionsWithoutErrorHandling++;
        issues.push({
          severity: "warning",
          location: `${relativePath}:${startLine + 1}`,
          functionName: funcName,
          message: `${funcType} "${funcName}" makes external API calls without try/catch. Network failures will crash the action.`,
          fix: "Wrap fetch/axios calls in try/catch and handle errors gracefully",
        });
      }

      // Check 4: Action calling another action
      if (/ctx\.runAction\s*\(/.test(body)) {
        actionCallingAction++;
        issues.push({
          severity: "warning",
          location: `${relativePath}:${startLine + 1}`,
          functionName: funcName,
          message: `${funcType} "${funcName}" calls ctx.runAction(). Only call action from action when crossing runtimes (V8 ↔ Node). Otherwise extract shared logic into a helper function.`,
          fix: "Extract shared logic into an async helper, or use ctx.runMutation/ctx.runQuery as intermediary",
        });
      }

      // Check 5: Very long action body (likely doing too much)
      const bodyLines = endLine - startLine;
      if (bodyLines > 80) {
        issues.push({
          severity: "info",
          location: `${relativePath}:${startLine + 1}`,
          functionName: funcName,
          message: `${funcType} "${funcName}" is ${bodyLines} lines long. Consider splitting into smaller actions or extracting helpers.`,
          fix: "Break large actions into smaller, focused functions",
        });
      }
    }
  }

  return {
    issues,
    stats: {
      totalActions,
      actionsWithDbAccess,
      actionsWithoutNodeDirective,
      actionsWithoutErrorHandling,
      actionCallingAction,
    },
  };
}

// ── Tool Definition ─────────────────────────────────────────────────

export const actionAuditTools: McpTool[] = [
  {
    name: "convex_audit_actions",
    description:
      'Audit Convex actions for: ctx.db access (fatal — actions cannot access DB directly), missing "use node" directive for Node APIs, external API calls without error handling, and action-calling-action anti-patterns.',
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

      const { issues, stats } = auditActions(convexDir);

      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "action_audit", JSON.stringify(issues), issues.length);

      return {
        summary: {
          ...stats,
          totalIssues: issues.length,
          critical: issues.filter((i) => i.severity === "critical").length,
          warnings: issues.filter((i) => i.severity === "warning").length,
        },
        issues: issues.slice(0, 30),
        quickRef: getQuickRef("convex_audit_actions"),
      };
    },
  },
];
