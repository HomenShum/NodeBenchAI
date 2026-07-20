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

// ── Query Efficiency Audit ──────────────────────────────────────────

interface EfficiencyIssue {
  severity: "critical" | "warning" | "info";
  location: string;
  message: string;
  fix: string;
}

function auditQueryEfficiency(convexDir: string): {
  issues: EfficiencyIssue[];
  stats: {
    totalQueries: number;
    collectWithoutLimit: number;
    filterWithoutIndex: number;
    mutationAsRead: number;
  };
} {
  const files = collectTsFiles(convexDir);
  const issues: EfficiencyIssue[] = [];
  let totalQueries = 0;
  let collectWithoutLimit = 0;
  let filterWithoutIndex = 0;
  let mutationAsRead = 0;

  // Build set of existing index names from schema
  const schemaPath = join(convexDir, "schema.ts");
  const existingIndexes = new Set<string>();
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, "utf-8");
    const idxPattern = /\.withIndex\s*\(\s*["']([^"']+)["']/g;
    let m;
    while ((m = idxPattern.exec(schema)) !== null) {
      existingIndexes.add(m[1]);
    }
    // Also get index definitions
    const defPattern = /\.index\s*\(\s*["']([^"']+)["']/g;
    while ((m = defPattern.exec(schema)) !== null) {
      existingIndexes.add(m[1]);
    }
  }

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");
    const lines = content.split("\n");

    // Check 1: .collect() without .take() or pagination
    for (let i = 0; i < lines.length; i++) {
      if (/\.collect\s*\(\s*\)/.test(lines[i])) {
        totalQueries++;
        // Look backwards for .take() or .paginate() in the chain
        const chainStart = Math.max(0, i - 5);
        const chain = lines.slice(chainStart, i + 1).join("\n");
        if (!/\.take\s*\(/.test(chain) && !/\.paginate\s*\(/.test(chain)) {
          collectWithoutLimit++;
          // Check if it's a bounded table or could be large
          const tableMatch = chain.match(/\.query\s*\(\s*["'](\w+)["']\s*\)/);
          issues.push({
            severity: "warning",
            location: `${relativePath}:${i + 1}`,
            message: `.collect() without .take() limit${tableMatch ? ` on table "${tableMatch[1]}"` : ""}. Could return entire table.`,
            fix: "Add .take(N) before .collect(), or use .paginate() for large result sets",
          });
        }
      }
    }

    // Check 2: .filter() without .withIndex()
    for (let i = 0; i < lines.length; i++) {
      if (/\.filter\s*\(/.test(lines[i])) {
        const chainStart = Math.max(0, i - 5);
        const chain = lines.slice(chainStart, i + 1).join("\n");
        if (/\.query\s*\(/.test(chain) && !/\.withIndex\s*\(/.test(chain)) {
          filterWithoutIndex++;
          const tableMatch = chain.match(/\.query\s*\(\s*["'](\w+)["']\s*\)/);
          issues.push({
            severity: "warning",
            location: `${relativePath}:${i + 1}`,
            message: `.filter() without .withIndex()${tableMatch ? ` on table "${tableMatch[1]}"` : ""}. Full table scan — use an index for better performance.`,
            fix: "Add .withIndex('by_field', q => q.eq('field', value)) before .filter()",
          });
        }
      }
    }

    // Check 3: Mutations used as pure reads (no writes)
    const mutationPattern = /export\s+(?:const\s+(\w+)\s*=|default)\s+mutation\s*\(/g;
    let mm;
    while ((mm = mutationPattern.exec(content)) !== null) {
      const funcName = mm[1] || "default";
      const startLine = content.slice(0, mm.index).split("\n").length - 1;

      // Extract body
      let depth = 0;
      let foundOpen = false;
      let endIdx = Math.min(startLine + 80, lines.length);
      for (let j = startLine; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === "{") { depth++; foundOpen = true; }
          if (ch === "}") depth--;
        }
        if (foundOpen && depth <= 0) { endIdx = j + 1; break; }
      }
      const body = lines.slice(startLine, endIdx).join("\n");

      const hasWrite = /ctx\.db\.(insert|patch|replace|delete)\s*\(/.test(body);
      const hasSchedule = /ctx\.scheduler\.(runAfter|runAt)\s*\(/.test(body);
      if (!hasWrite && !hasSchedule) {
        mutationAsRead++;
        issues.push({
          severity: "info",
          location: `${relativePath}:${startLine + 1}`,
          message: `Public mutation "${funcName}" has no DB writes or scheduler calls. Consider using a query instead — queries are reactive and cached.`,
          fix: `Change from mutation to query if this function only reads data`,
        });
      }
    }

    // Check 4: .first() on unique constraints (should use .unique())
    for (let i = 0; i < lines.length; i++) {
      if (/\.first\s*\(\s*\)/.test(lines[i])) {
        const chainStart = Math.max(0, i - 5);
        const chain = lines.slice(chainStart, i + 1).join("\n");
        // If filtering by email, userId, or other typically-unique fields
        if (/\.eq\s*\(\s*["'](email|userId|externalId|slug|token|key)["']/.test(chain)) {
          issues.push({
            severity: "info",
            location: `${relativePath}:${i + 1}`,
            message: `.first() used after filtering on a likely-unique field. Consider .unique() for stricter guarantees.`,
            fix: "Replace .first() with .unique() if the field is expected to be unique — it throws if multiple results exist",
          });
        }
      }
    }
  }

  return {
    issues,
    stats: { totalQueries, collectWithoutLimit, filterWithoutIndex, mutationAsRead },
  };
}

// ── Tool Definition ─────────────────────────────────────────────────

export const queryEfficiencyTools: McpTool[] = [
  {
    name: "convex_audit_query_efficiency",
    description:
      "Audit Convex queries for efficiency issues: .collect() without limits (unbounded reads), .filter() without indexes (full table scans), mutations used for pure reads (losing reactivity), and .first() vs .unique() misuse.",
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

      const { issues, stats } = auditQueryEfficiency(convexDir);

      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "query_efficiency", JSON.stringify(issues), issues.length);

      return {
        summary: {
          totalIssues: issues.length,
          ...stats,
          critical: issues.filter((i) => i.severity === "critical").length,
          warnings: issues.filter((i) => i.severity === "warning").length,
          info: issues.filter((i) => i.severity === "info").length,
        },
        issues: issues.slice(0, 30), // Cap output
        quickRef: getQuickRef("convex_audit_query_efficiency"),
      };
    },
  },
];
