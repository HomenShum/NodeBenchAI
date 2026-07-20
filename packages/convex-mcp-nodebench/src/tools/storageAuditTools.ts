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

// ── Storage Audit ───────────────────────────────────────────────────

interface StorageIssue {
  severity: "critical" | "warning" | "info";
  location: string;
  message: string;
  fix: string;
}

function auditStorageUsage(convexDir: string): {
  issues: StorageIssue[];
  stats: {
    filesUsingStorage: number;
    storageGetCalls: number;
    storageGetUrlCalls: number;
    storageStoreCalls: number;
    storageDeleteCalls: number;
    missingNullChecks: number;
  };
} {
  const files = collectTsFiles(convexDir);
  const issues: StorageIssue[] = [];
  let filesUsingStorage = 0;
  let storageGetCalls = 0;
  let storageGetUrlCalls = 0;
  let storageStoreCalls = 0;
  let storageDeleteCalls = 0;
  let missingNullChecks = 0;

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");
    const lines = content.split("\n");

    const usesStorage = /ctx\.storage\./.test(content);
    if (!usesStorage) continue;
    filesUsingStorage++;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Count storage operations
      if (/ctx\.storage\.get\s*\(/.test(line)) storageGetCalls++;
      if (/ctx\.storage\.getUrl\s*\(/.test(line)) storageGetUrlCalls++;
      if (/ctx\.storage\.store\s*\(/.test(line)) storageStoreCalls++;
      if (/ctx\.storage\.delete\s*\(/.test(line)) storageDeleteCalls++;

      // Check 1: ctx.storage.get() or getUrl() without null check
      const getMatch = line.match(/(?:const|let)\s+(\w+)\s*=\s*await\s+ctx\.storage\.(get|getUrl)\s*\(/);
      if (getMatch) {
        const varName = getMatch[1];
        const method = getMatch[2];
        // Look ahead 5 lines for null check
        const lookahead = lines.slice(i, Math.min(i + 6, lines.length)).join("\n");
        const hasNullCheck = new RegExp(
          `if\\s*\\(\\s*!${varName}\\b|if\\s*\\(\\s*${varName}\\s*===?\\s*null|${varName}\\s*\\?\\.|${varName}\\s*!\\s*\\.`
        ).test(lookahead);
        if (!hasNullCheck) {
          missingNullChecks++;
          issues.push({
            severity: "warning",
            location: `${relativePath}:${i + 1}`,
            message: `ctx.storage.${method}() result "${varName}" not null-checked. Returns null if file doesn't exist.`,
            fix: `Add: if (!${varName}) { throw new Error("File not found"); }`,
          });
        }
      }
    }

    // Check 2: Storage ID stored as string instead of Id<'_storage'>
    // Look for v.string() in schema fields that likely hold storage IDs
    const storageIdFields = content.match(/(\w*(?:storage|file|image|avatar|thumbnail|attachment|media|upload|blob|asset)\w*)\s*:\s*v\.string\s*\(\s*\)/gi);
    if (storageIdFields) {
      for (const fieldMatch of storageIdFields) {
        const fieldName = fieldMatch.split(":")[0].trim();
        issues.push({
          severity: "info",
          location: relativePath,
          message: `Field "${fieldName}" uses v.string() but appears to be a storage ID. Use v.id("_storage") for type safety.`,
          fix: `Change ${fieldName}: v.string() to ${fieldName}: v.id("_storage")`,
        });
      }
    }
  }

  // Check 3: Orphan risk — stores without corresponding deletes
  if (storageStoreCalls > 0 && storageDeleteCalls === 0) {
    issues.push({
      severity: "info",
      location: "project-wide",
      message: `${storageStoreCalls} storage.store() calls but 0 storage.delete() calls. Stored files may become orphaned when records are deleted.`,
      fix: "Add ctx.storage.delete(storageId) when deleting records that reference stored files",
    });
  }

  return {
    issues,
    stats: {
      filesUsingStorage,
      storageGetCalls,
      storageGetUrlCalls,
      storageStoreCalls,
      storageDeleteCalls,
      missingNullChecks,
    },
  };
}

// ── Tool Definition ─────────────────────────────────────────────────

export const storageAuditTools: McpTool[] = [
  {
    name: "convex_audit_storage_usage",
    description:
      "Audit Convex file storage usage: missing null checks on ctx.storage.get()/getUrl(), storage IDs stored as v.string() instead of v.id('_storage'), and orphaned file risk (store calls without corresponding deletes).",
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

      const { issues, stats } = auditStorageUsage(convexDir);

      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "storage_usage", JSON.stringify(issues), issues.length);

      return {
        summary: {
          ...stats,
          totalIssues: issues.length,
        },
        issues: issues.slice(0, 30),
        quickRef: getQuickRef("convex_audit_storage_usage"),
      };
    },
  },
];
