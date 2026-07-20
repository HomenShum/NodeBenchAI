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
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "_generated" && !entry.name.startsWith("_type")) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      results.push(full);
    }
  }
  return results;
}

// ── Type Safety Audit ───────────────────────────────────────────────

interface TypeIssue {
  severity: "critical" | "warning" | "info";
  location: string;
  message: string;
  fix: string;
}

function auditTypeSafety(convexDir: string): {
  issues: TypeIssue[];
  stats: {
    totalFiles: number;
    filesWithAsAny: number;
    asAnyCastCount: number;
    undefinedReturns: number;
    looseIdTypes: number;
  };
} {
  const files = collectTsFiles(convexDir);
  const issues: TypeIssue[] = [];
  let filesWithAsAny = 0;
  let asAnyCastCount = 0;
  let undefinedReturns = 0;
  let looseIdTypes = 0;

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");
    const lines = content.split("\n");
    let fileHasAsAny = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;

      // Check 1: `as any` casts
      const asAnyMatches = line.match(/as\s+any\b/g);
      if (asAnyMatches) {
        asAnyCastCount += asAnyMatches.length;
        if (!fileHasAsAny) {
          fileHasAsAny = true;
          filesWithAsAny++;
        }
      }

      // Check 2: return undefined (should be null in Convex)
      if (/return\s+undefined\b/.test(line)) {
        undefinedReturns++;
        issues.push({
          severity: "warning",
          location: `${relativePath}:${i + 1}`,
          message: "Returning undefined — Convex serializes undefined differently from null. Use null explicitly.",
          fix: "Replace `return undefined` with `return null`",
        });
      }

      // Check 3: Using string type where Id<'table'> should be
      // Heuristic: args with names like *Id that use v.string() instead of v.id("table")
      const idArgMatch = line.match(/(\w+Id)\s*:\s*v\.string\s*\(\s*\)/);
      if (idArgMatch) {
        looseIdTypes++;
        issues.push({
          severity: "warning",
          location: `${relativePath}:${i + 1}`,
          message: `Arg "${idArgMatch[1]}" uses v.string() but looks like an ID field. Use v.id("tableName") for type-safe ID references.`,
          fix: `Change ${idArgMatch[1]}: v.string() to ${idArgMatch[1]}: v.id("tableName")`,
        });
      }

      // Check 4: Manual interface/type definitions that shadow generated types
      if (/(?:interface|type)\s+(Doc|Id|DataModel|FunctionReference)\b/.test(line)) {
        issues.push({
          severity: "critical",
          location: `${relativePath}:${i + 1}`,
          message: "Manual type definition shadows Convex generated type. Import from _generated/dataModel instead.",
          fix: 'Import from "_generated/dataModel" or "_generated/server" instead of defining manually',
        });
      }
    }

    // Aggregate `as any` per file
    if (fileHasAsAny) {
      const count = (content.match(/as\s+any\b/g) || []).length;
      issues.push({
        severity: "warning",
        location: relativePath,
        message: `${count} \`as any\` cast(s) in this file. Each cast bypasses Convex's automatic type safety.`,
        fix: "Replace `as any` with proper typing or use Convex generated types",
      });
    }
  }

  return {
    issues,
    stats: {
      totalFiles: files.length,
      filesWithAsAny,
      asAnyCastCount,
      undefinedReturns,
      looseIdTypes,
    },
  };
}

// ── Tool Definition ─────────────────────────────────────────────────

export const typeSafetyTools: McpTool[] = [
  {
    name: "convex_check_type_safety",
    description:
      "Check Convex code for type safety issues: `as any` casts (bypass generated types), returning undefined instead of null, v.string() where v.id() should be used, and manual type definitions shadowing Convex generated types.",
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

      const { issues, stats } = auditTypeSafety(convexDir);

      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "type_safety", JSON.stringify(issues), issues.length);

      return {
        summary: {
          ...stats,
          totalIssues: issues.length,
          critical: issues.filter((i) => i.severity === "critical").length,
          warnings: issues.filter((i) => i.severity === "warning").length,
        },
        issues: issues.slice(0, 30),
        quickRef: getQuickRef("convex_check_type_safety"),
      };
    },
  },
];
