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

// ── Authorization Audit Engine ──────────────────────────────────────

interface AuthIssue {
  severity: "critical" | "warning" | "info";
  location: string;
  functionName: string;
  message: string;
  fix: string;
}

function auditAuthorization(convexDir: string): {
  issues: AuthIssue[];
  stats: {
    totalPublicFunctions: number;
    publicWithAuth: number;
    publicWithoutAuth: number;
    uncheckedIdentity: number;
  };
} {
  const files = collectTsFiles(convexDir);
  const issues: AuthIssue[] = [];
  let totalPublic = 0;
  let withAuth = 0;
  let withoutAuth = 0;
  let uncheckedIdentity = 0;

  const funcTypes = ["query", "mutation", "action"];
  const writeSensitive = /admin|delete|purge|remove|destroy|drop|reset|wipe|erase|revoke/i;
  const dbWriteOps = /ctx\.db\.(insert|patch|replace|delete)\s*\(/;

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const ft of funcTypes) {
        const exportPattern = new RegExp(
          `export\\s+(?:const\\s+(\\w+)\\s*=|default)\\s+${ft}\\s*\\(`
        );
        const match = line.match(exportPattern);
        if (!match) continue;

        const funcName = match[1] || "default";
        totalPublic++;

        // Extract function body using brace tracking
        let depth = 0;
        let foundOpen = false;
        let endLine = Math.min(i + 100, lines.length);
        for (let j = i; j < lines.length; j++) {
          for (const ch of lines[j]) {
            if (ch === "{") { depth++; foundOpen = true; }
            if (ch === "}") depth--;
          }
          if (foundOpen && depth <= 0) {
            endLine = j + 1;
            break;
          }
        }
        const body = lines.slice(i, endLine).join("\n");

        const hasAuthCheck = /ctx\.auth\.getUserIdentity\s*\(\s*\)/.test(body) ||
          /getUserIdentity/.test(body) ||
          /getAuthUserId/.test(body) ||
          /getAuthSessionId/.test(body);
        const hasDbWrite = dbWriteOps.test(body);
        const isSensitiveName = writeSensitive.test(funcName);

        if (hasAuthCheck) {
          withAuth++;

          // Check: getUserIdentity called but return not null-checked
          const identityAssign = body.match(/(?:const|let)\s+(\w+)\s*=\s*await\s+ctx\.auth\.getUserIdentity\s*\(\s*\)/);
          if (identityAssign) {
            const varName = identityAssign[1];
            const hasNullCheck = new RegExp(
              `if\\s*\\(\\s*!${varName}\\b|if\\s*\\(\\s*${varName}\\s*===?\\s*null|if\\s*\\(\\s*!${varName}\\s*\\)`
            ).test(body);
            if (!hasNullCheck) {
              uncheckedIdentity++;
              issues.push({
                severity: "critical",
                location: `${relativePath}:${i + 1}`,
                functionName: funcName,
                message: `${ft} "${funcName}" calls getUserIdentity() but doesn't check for null. Unauthenticated users will get undefined identity.`,
                fix: `Add: if (!${varName}) { throw new Error("Not authenticated"); }`,
              });
            }
          }

          // Check: getAuthUserId called but return not null-checked
          const authUserAssign = body.match(/(?:const|let)\s+(\w+)\s*=\s*await\s+getAuthUserId\s*\(/);
          if (authUserAssign) {
            const varName = authUserAssign[1];
            const hasNullCheck = new RegExp(
              `if\\s*\\(\\s*!${varName}\\b|if\\s*\\(\\s*${varName}\\s*===?\\s*null|throw.*!${varName}`
            ).test(body);
            if (!hasNullCheck) {
              uncheckedIdentity++;
              issues.push({
                severity: "critical",
                location: `${relativePath}:${i + 1}`,
                functionName: funcName,
                message: `${ft} "${funcName}" calls getAuthUserId() but doesn't check for null. Unauthenticated users will get null userId.`,
                fix: `Add: if (!${varName}) { throw new Error("Not authenticated"); }`,
              });
            }
          }
        } else {
          withoutAuth++;

          // Critical: public mutation/action with DB writes but no auth
          if ((ft === "mutation" || ft === "action") && hasDbWrite) {
            const sensitiveHint = isSensitiveName ? ` Name "${funcName}" suggests a destructive operation.` : "";
            issues.push({
              severity: "critical",
              location: `${relativePath}:${i + 1}`,
              functionName: funcName,
              message: `Public ${ft} "${funcName}" writes to DB without auth check. Any client can call this.${sensitiveHint}`,
              fix: `Add: const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new Error("Not authenticated");`,
            });
          } else if (isSensitiveName) {
            // Only flag sensitive name separately if not already caught by DB-write check
            issues.push({
              severity: "critical",
              location: `${relativePath}:${i + 1}`,
              functionName: funcName,
              message: `Public ${ft} "${funcName}" has a sensitive name but no auth check. Consider making it internal or adding auth.`,
              fix: `Either change to internal${ft.charAt(0).toUpperCase() + ft.slice(1)} or add auth check`,
            });
          }

          // Warning: public query reading user-specific data without auth
          if (ft === "query" && /ctx\.db\.get|ctx\.db\.query/.test(body) && /user|profile|account|email/i.test(body)) {
            issues.push({
              severity: "warning",
              location: `${relativePath}:${i + 1}`,
              functionName: funcName,
              message: `Public query "${funcName}" accesses user-related data without auth. Consider if unauthenticated access is intended.`,
              fix: "Add auth check if this data should be protected",
            });
          }
        }
      }
    }
  }

  return {
    issues,
    stats: {
      totalPublicFunctions: totalPublic,
      publicWithAuth: withAuth,
      publicWithoutAuth: withoutAuth,
      uncheckedIdentity,
    },
  };
}

// ── Tool Definition ─────────────────────────────────────────────────

export const authorizationTools: McpTool[] = [
  {
    name: "convex_audit_authorization",
    description:
      "Audit Convex functions for authorization issues: public mutations/actions writing to DB without auth checks, getUserIdentity() without null checks, sensitive-named functions without auth, and unprotected user data queries.",
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

      const { issues, stats } = auditAuthorization(convexDir);

      // Store audit result
      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "authorization", JSON.stringify(issues), issues.length);

      const critical = issues.filter((i) => i.severity === "critical");
      const warnings = issues.filter((i) => i.severity === "warning");

      // Group by issue type
      const byType: Record<string, { count: number; examples: AuthIssue[] }> = {};
      for (const issue of issues) {
        const type = issue.message.includes("without auth check") ? "no_auth_on_write" :
          issue.message.includes("null") ? "unchecked_identity" :
          issue.message.includes("sensitive name") ? "sensitive_no_auth" :
          issue.message.includes("user-related") ? "unprotected_user_data" :
          "other";
        if (!byType[type]) byType[type] = { count: 0, examples: [] };
        byType[type].count++;
        if (byType[type].examples.length < 3) byType[type].examples.push(issue);
      }

      return {
        summary: {
          ...stats,
          totalIssues: issues.length,
          critical: critical.length,
          warnings: warnings.length,
          authCoverage: stats.totalPublicFunctions > 0
            ? `${stats.publicWithAuth}/${stats.totalPublicFunctions} (${Math.round(100 * stats.publicWithAuth / stats.totalPublicFunctions)}%)`
            : "0/0",
        },
        issuesByType: Object.entries(byType)
          .sort(([, a], [, b]) => b.count - a.count)
          .map(([type, data]) => ({ type, count: data.count, examples: data.examples })),
        quickRef: getQuickRef("convex_audit_authorization"),
      };
    },
  },
];
