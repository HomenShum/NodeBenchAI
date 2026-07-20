import { readFileSync, existsSync } from "node:fs";
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

// ── Data Modeling Audit ─────────────────────────────────────────────

interface ModelingIssue {
  severity: "critical" | "warning" | "info";
  location: string;
  table?: string;
  message: string;
  fix: string;
}

function auditDataModeling(convexDir: string): {
  issues: ModelingIssue[];
  stats: {
    totalTables: number;
    tablesWithArrays: number;
    tablesWithDeepNesting: number;
    danglingIdRefs: number;
    vAnyCount: number;
  };
} {
  const schemaPath = join(convexDir, "schema.ts");
  const issues: ModelingIssue[] = [];
  let totalTables = 0;
  let tablesWithArrays = 0;
  let tablesWithDeepNesting = 0;
  let danglingIdRefs = 0;
  let vAnyCount = 0;

  if (!existsSync(schemaPath)) {
    return {
      issues: [{ severity: "critical", location: "schema.ts", message: "No schema.ts found", fix: "Create convex/schema.ts" }],
      stats: { totalTables: 0, tablesWithArrays: 0, tablesWithDeepNesting: 0, danglingIdRefs: 0, vAnyCount: 0 },
    };
  }

  const content = readFileSync(schemaPath, "utf-8");
  const lines = content.split("\n");

  // Parse all table names
  const tableNames = new Set<string>();
  const tableDefPattern = /(\w+)\s*[:=]\s*defineTable\s*\(/g;
  let m;
  while ((m = tableDefPattern.exec(content)) !== null) {
    tableNames.add(m[1]);
    totalTables++;
  }

  // Detect spread-imported table providers (e.g. ...authTables adds "users", "sessions")
  // Strategy 1: Known spreads from popular Convex packages
  const knownSpreads: Record<string, string[]> = {
    authTables: ["users", "authSessions", "authAccounts", "authRefreshTokens", "authVerificationCodes", "authRateLimits", "authVerifiers"],
  };
  // Strategy 2: Parse inline comments next to spreads for table name hints
  // e.g. ...authTables, // `users`, `sessions`
  const spreadCommentPattern = /\.\.\.(\w+)\s*,?\s*\/\/\s*(.+)/g;
  let sm;
  while ((sm = spreadCommentPattern.exec(content)) !== null) {
    const spreadName = sm[1];
    const comment = sm[2];
    // Extract backtick-quoted or quoted table names from comment
    const commentTables = [...comment.matchAll(/[`"'](\w+)[`"']/g)].map(m => m[1]);
    // Merge known + comment-discovered tables
    const tables = new Set([
      ...(knownSpreads[spreadName] ?? []),
      ...commentTables,
    ]);
    for (const t of tables) {
      if (!tableNames.has(t)) {
        tableNames.add(t);
        totalTables++;
      }
    }
  }
  // Strategy 3: If no comment matched, still apply known spreads
  const simpleSpreadPattern = /\.\.\.(\w+)/g;
  let sm2;
  while ((sm2 = simpleSpreadPattern.exec(content)) !== null) {
    const tables = knownSpreads[sm2[1]];
    if (tables) {
      for (const t of tables) {
        if (!tableNames.has(t)) {
          tableNames.add(t);
          totalTables++;
        }
      }
    }
  }

  // Per-table analysis
  let currentTable = "";
  let tableStartLine = 0;
  let tableNestDepth = 0;
  let maxNestInTable = 0;
  let tableHasArray = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track current table
    const tableDef = line.match(/(\w+)\s*[:=]\s*defineTable\s*\(/);
    if (tableDef) {
      // Check previous table
      if (currentTable && maxNestInTable > 3) {
        tablesWithDeepNesting++;
        issues.push({
          severity: "warning",
          location: `schema.ts:${tableStartLine + 1}`,
          table: currentTable,
          message: `Table "${currentTable}" has ${maxNestInTable} levels of nesting. Deep nesting increases document size and query complexity.`,
          fix: "Consider normalizing deeply nested data into separate tables with Id references",
        });
      }
      if (currentTable && tableHasArray) tablesWithArrays++;

      currentTable = tableDef[1];
      tableStartLine = i;
      maxNestInTable = 0;
      tableHasArray = false;
    }

    if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;

    // Track nesting depth within a table
    if (currentTable) {
      const opens = (line.match(/v\.object\s*\(/g) || []).length;
      tableNestDepth += opens;
      if (tableNestDepth > maxNestInTable) maxNestInTable = tableNestDepth;
      const closes = (line.match(/\)/g) || []).length;
      tableNestDepth = Math.max(0, tableNestDepth - closes);
    }

    // Check: v.array() usage (potential size limit issue)
    if (/v\.array\s*\(/.test(line) && currentTable) {
      tableHasArray = true;
    }

    // Check: v.any() usage
    if (/v\.any\s*\(\s*\)/.test(line)) {
      vAnyCount++;
    }

    // Check: v.id("tableName") references — verify the table exists
    const idRefPattern = /v\.id\s*\(\s*["'](\w+)["']\s*\)/g;
    let idMatch;
    while ((idMatch = idRefPattern.exec(line)) !== null) {
      const refTable = idMatch[1];
      if (refTable !== "_storage" && !tableNames.has(refTable)) {
        danglingIdRefs++;
        issues.push({
          severity: "critical",
          location: `schema.ts:${i + 1}`,
          table: currentTable,
          message: `v.id("${refTable}") references table "${refTable}" which is not defined in the schema. This will cause type errors.`,
          fix: `Either add the "${refTable}" table to the schema or fix the reference`,
        });
      }
    }
  }

  // Check last table
  if (currentTable && maxNestInTable > 3) {
    tablesWithDeepNesting++;
    issues.push({
      severity: "warning",
      location: `schema.ts:${tableStartLine + 1}`,
      table: currentTable,
      message: `Table "${currentTable}" has ${maxNestInTable} levels of nesting.`,
      fix: "Consider normalizing deeply nested data into separate tables",
    });
  }
  if (currentTable && tableHasArray) tablesWithArrays++;

  // Check: tables with many fields (approaching limits)
  const fieldCountPattern = /defineTable\s*\(\s*v\.object\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  let fcm;
  while ((fcm = fieldCountPattern.exec(content)) !== null) {
    const fieldBlock = fcm[1];
    const fieldCount = (fieldBlock.match(/\w+\s*:/g) || []).length;
    if (fieldCount > 50) {
      issues.push({
        severity: "warning",
        location: "schema.ts",
        message: `A table has ${fieldCount} fields. Consider splitting into related tables if this grows further (Convex max: 1024 fields).`,
        fix: "Split large tables into related tables with Id references",
      });
    }
  }

  return {
    issues,
    stats: { totalTables, tablesWithArrays, tablesWithDeepNesting, danglingIdRefs, vAnyCount },
  };
}

// ── Tool Definition ─────────────────────────────────────────────────

export const dataModelingTools: McpTool[] = [
  {
    name: "convex_audit_data_modeling",
    description:
      "Audit Convex schema for data modeling issues: deeply nested objects (flatten into tables), dangling v.id() references to non-existent tables, tables approaching field count limits, v.any() overuse, and array fields that may hit size limits.",
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

      const { issues, stats } = auditDataModeling(convexDir);

      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "data_modeling", JSON.stringify(issues), issues.length);

      return {
        summary: { ...stats, totalIssues: issues.length },
        issues,
        quickRef: getQuickRef("convex_audit_data_modeling"),
      };
    },
  },
];
