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

// ── Transaction Safety Audit ────────────────────────────────────────

interface TransactionIssue {
  severity: "critical" | "warning" | "info";
  location: string;
  functionName: string;
  message: string;
  fix: string;
}

function auditTransactionSafety(convexDir: string): {
  issues: TransactionIssue[];
  stats: {
    totalMutations: number;
    readModifyWrite: number;
    multipleRunMutation: number;
    checkThenAct: number;
  };
} {
  const files = collectTsFiles(convexDir);
  const issues: TransactionIssue[] = [];
  let totalMutations = 0;
  let readModifyWrite = 0;
  let multipleRunMutation = 0;
  let checkThenAct = 0;

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");
    const lines = content.split("\n");

    // Find action/mutation bodies
    const funcPattern = /export\s+(?:const\s+(\w+)\s*=|default)\s+(action|internalAction|mutation|internalMutation)\s*\(/g;
    let m;
    while ((m = funcPattern.exec(content)) !== null) {
      const funcName = m[1] || "default";
      const funcType = m[2];
      if (funcType === "mutation" || funcType === "internalMutation") totalMutations++;

      const startLine = content.slice(0, m.index).split("\n").length - 1;

      // Extract body
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

      // Check 1: Multiple ctx.runMutation calls in an action (separate transactions)
      if (funcType === "action" || funcType === "internalAction") {
        const runMutationMatches = body.match(/ctx\.runMutation\s*\(/g);
        if (runMutationMatches && runMutationMatches.length >= 2) {
          multipleRunMutation++;
          issues.push({
            severity: "warning",
            location: `${relativePath}:${startLine + 1}`,
            functionName: funcName,
            message: `${funcType} "${funcName}" calls ctx.runMutation ${runMutationMatches.length} times. Each is a separate transaction — if the second fails, the first is NOT rolled back.`,
            fix: "Combine into a single mutation that does both operations atomically, or add idempotency handling",
          });
        }
      }

      // Check 2: Read-modify-write in action (TOCTOU race)
      if (funcType === "action" || funcType === "internalAction") {
        const hasRunQuery = /ctx\.runQuery\s*\(/.test(body);
        const hasRunMutation = /ctx\.runMutation\s*\(/.test(body);
        if (hasRunQuery && hasRunMutation) {
          // Potential read-then-write pattern — check if they reference similar data
          readModifyWrite++;
          issues.push({
            severity: "warning",
            location: `${relativePath}:${startLine + 1}`,
            functionName: funcName,
            message: `${funcType} "${funcName}" reads via runQuery then writes via runMutation. Between these calls, another client may have changed the data (TOCTOU race).`,
            fix: "Move the read-modify-write into a single mutation for atomicity, or add optimistic concurrency checks",
          });
        }
      }

      // Check 3: Check-then-act in mutations (get → check → modify)
      if (funcType === "mutation" || funcType === "internalMutation") {
        // Pattern: const x = await ctx.db.get(...); if (!x) throw; ctx.db.patch(x._id, ...)
        const hasGet = /ctx\.db\.get\s*\(/.test(body);
        const hasPatch = /ctx\.db\.(patch|replace|delete)\s*\(/.test(body);
        const hasConditional = /if\s*\(\s*!?\w+/.test(body);
        if (hasGet && hasPatch && hasConditional) {
          // This is actually safe in Convex mutations (they're serializable), but flag for review
          // Only flag if there are multiple get/patch patterns suggesting complexity
          const getCount = (body.match(/ctx\.db\.get\s*\(/g) || []).length;
          const patchCount = (body.match(/ctx\.db\.(patch|replace|delete)\s*\(/g) || []).length;
          if (getCount >= 2 && patchCount >= 2) {
            checkThenAct++;
            issues.push({
              severity: "info",
              location: `${relativePath}:${startLine + 1}`,
              functionName: funcName,
              message: `${funcType} "${funcName}" has complex read-check-modify pattern (${getCount} reads, ${patchCount} writes). Convex mutations are serializable so this is safe, but consider simplifying.`,
              fix: "Consider breaking into smaller, focused mutations if the logic is complex",
            });
          }
        }
      }
    }
  }

  return {
    issues,
    stats: { totalMutations, readModifyWrite, multipleRunMutation, checkThenAct },
  };
}

// ── Tool Definition ─────────────────────────────────────────────────

export const transactionSafetyTools: McpTool[] = [
  {
    name: "convex_audit_transaction_safety",
    description:
      "Audit Convex functions for transaction safety: multiple ctx.runMutation calls in actions (separate transactions — partial failure risk), read-then-write patterns across query/mutation boundaries (TOCTOU races), and complex check-then-act mutations.",
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

      const { issues, stats } = auditTransactionSafety(convexDir);

      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "transaction_safety", JSON.stringify(issues), issues.length);

      return {
        summary: {
          ...stats,
          totalIssues: issues.length,
          critical: issues.filter((i) => i.severity === "critical").length,
          warnings: issues.filter((i) => i.severity === "warning").length,
        },
        issues: issues.slice(0, 30),
        quickRef: getQuickRef("convex_audit_transaction_safety"),
      };
    },
  },
];
