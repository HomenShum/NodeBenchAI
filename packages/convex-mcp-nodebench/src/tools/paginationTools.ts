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

// ── Pagination Audit ────────────────────────────────────────────────

interface PaginationIssue {
  severity: "critical" | "warning" | "info";
  location: string;
  message: string;
  fix: string;
}

function auditPagination(convexDir: string): {
  issues: PaginationIssue[];
  stats: {
    paginateCalls: number;
    missingPaginationOptsValidator: number;
    unboundedNumItems: number;
    functionsUsingPagination: number;
  };
} {
  const files = collectTsFiles(convexDir);
  const issues: PaginationIssue[] = [];
  let paginateCalls = 0;
  let missingPaginationOptsValidator = 0;
  let unboundedNumItems = 0;
  const functionsUsingPagination = new Set<string>();

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");
    const lines = content.split("\n");

    // Check: .paginate() calls
    for (let i = 0; i < lines.length; i++) {
      if (/\.paginate\s*\(/.test(lines[i])) {
        paginateCalls++;
        functionsUsingPagination.add(relativePath);
      }
    }

    // Check: public queries using paginate but missing paginationOptsValidator in args
    // NOTE: internalQuery doesn't need paginationOptsValidator — it's not client-callable
    const funcPattern = /export\s+(?:const\s+(\w+)\s*=|default)\s+(query|internalQuery)\s*\(/g;
    let m;
    while ((m = funcPattern.exec(content)) !== null) {
      const funcName = m[1] || "default";
      const funcType = m[2];
      const startLine = content.slice(0, m.index).split("\n").length - 1;
      const chunk = lines.slice(startLine, Math.min(startLine + 30, lines.length)).join("\n");

      if (/\.paginate\s*\(/.test(chunk)) {
        // Only flag public queries — internalQuery can use paginate with hardcoded opts
        if (funcType === "query" && !/paginationOptsValidator/.test(chunk) && !/paginationOpts/.test(chunk)) {
          missingPaginationOptsValidator++;
          issues.push({
            severity: "critical",
            location: `${relativePath}:${startLine + 1}`,
            message: `Query "${funcName}" uses .paginate() but args don't include paginationOptsValidator. Clients can't pass pagination options.`,
            fix: 'Add `paginationOpts: paginationOptsValidator` to the args validator, and import from "convex/server"',
          });
        }

        // Check for numItems bounds
        if (/numItems/.test(chunk)) {
          // Look for validation on numItems
          const hasNumItemsCheck = /numItems\s*>\s*\d+|Math\.min\s*\(.*numItems/.test(chunk);
          if (!hasNumItemsCheck) {
            unboundedNumItems++;
            issues.push({
              severity: "warning",
              location: `${relativePath}:${startLine + 1}`,
              message: `Query "${funcName}" accepts numItems without upper bound. A malicious client could request the entire table.`,
              fix: "Add validation: `const safeLimit = Math.min(args.paginationOpts.numItems, 100)`",
            });
          }
        }
      }
    }
  }

  return {
    issues,
    stats: {
      paginateCalls,
      missingPaginationOptsValidator,
      unboundedNumItems,
      functionsUsingPagination: functionsUsingPagination.size,
    },
  };
}

// ── Tool Definition ─────────────────────────────────────────────────

export const paginationTools: McpTool[] = [
  {
    name: "convex_audit_pagination",
    description:
      "Audit Convex pagination patterns: missing paginationOptsValidator in query args, unbounded numItems (DoS risk), and .paginate() usage inventory.",
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

      const { issues, stats } = auditPagination(convexDir);

      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "pagination", JSON.stringify(issues), issues.length);

      return {
        summary: { ...stats, totalIssues: issues.length },
        issues,
        quickRef: getQuickRef("convex_audit_pagination"),
      };
    },
  },
];
