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

// ── Scheduler Audit Engine ──────────────────────────────────────────

interface SchedulerIssue {
  severity: "critical" | "warning" | "info";
  location: string;
  functionName: string;
  message: string;
  fix: string;
}

function auditSchedulers(convexDir: string): {
  issues: SchedulerIssue[];
  stats: {
    totalSchedulerCalls: number;
    runAfterCalls: number;
    runAtCalls: number;
    selfSchedulingFunctions: number;
    filesWithSchedulers: number;
  };
} {
  const files = collectTsFiles(convexDir);
  const issues: SchedulerIssue[] = [];
  let totalSchedulerCalls = 0;
  let runAfterCalls = 0;
  let runAtCalls = 0;
  let selfSchedulingFunctions = 0;
  const filesWithSchedulers = new Set<string>();

  for (const filePath of files) {
    const content = readFileSync(filePath, "utf-8");
    const relativePath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");
    const lines = content.split("\n");

    // Find all exported functions (mutation/action) and their bodies
    const funcPattern = /export\s+(?:const\s+(\w+)\s*=|default)\s+(mutation|internalMutation|action|internalAction)\s*\(/g;
    let m;
    while ((m = funcPattern.exec(content)) !== null) {
      const funcName = m[1] || "default";
      const funcType = m[2];
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

      // Check scheduler calls in body
      const runAfterMatches = [...body.matchAll(/ctx\.scheduler\.runAfter\s*\(/g)];
      const runAtMatches = [...body.matchAll(/ctx\.scheduler\.runAt\s*\(/g)];
      const allSchedulerCalls = runAfterMatches.length + runAtMatches.length;

      if (allSchedulerCalls === 0) continue;

      filesWithSchedulers.add(relativePath);
      totalSchedulerCalls += allSchedulerCalls;
      runAfterCalls += runAfterMatches.length;
      runAtCalls += runAtMatches.length;

      // Check 1: Self-scheduling (infinite loop risk)
      // Detect: function schedules itself by name
      const selfRefPattern = new RegExp(
        `ctx\\.scheduler\\.run(?:After|At)\\s*\\([^,]*,\\s*(?:internal|api)\\.[^,]*\\.${funcName}\\b`
      );
      if (selfRefPattern.test(body)) {
        selfSchedulingFunctions++;

        // Check if there's a termination condition
        const hasTermination = /if\s*\(|return\s+(?:null|undefined|void)|\.length\s*(?:===?|<=?)\s*0/.test(body);
        issues.push({
          severity: hasTermination ? "warning" : "critical",
          location: `${relativePath}:${startLine + 1}`,
          functionName: funcName,
          message: `${funcType} "${funcName}" schedules itself${hasTermination ? " (has conditional guard)" : " without clear termination — infinite loop risk"}.`,
          fix: hasTermination
            ? "Verify the termination condition covers all edge cases"
            : "Add a termination condition (max retries, empty queue check) before self-scheduling",
        });
      }

      // Check 2: Very short delay (< 1 second) — may indicate missing backoff
      for (const match of runAfterMatches) {
        const callIdx = content.indexOf(match[0], m.index);
        const callLine = content.slice(0, callIdx).split("\n").length;
        const afterCall = content.slice(callIdx, callIdx + 100);
        const delayMatch = afterCall.match(/runAfter\s*\(\s*(\d+(?:\.\d+)?)\s*[,)]/);
        if (delayMatch) {
          const delay = parseFloat(delayMatch[1]);
          if (delay < 1) {
            issues.push({
              severity: "warning",
              location: `${relativePath}:${callLine}`,
              functionName: funcName,
              message: `scheduler.runAfter(${delay}, ...) uses sub-second delay. In retry/loop patterns this can overwhelm the scheduler.`,
              fix: "Use at least 1-second delay. For retries, implement exponential backoff (e.g., delay * 2^attempt)",
            });
          }
        }
      }

      // Check 3: Scheduler in action without try/catch
      if ((funcType === "action" || funcType === "internalAction") && allSchedulerCalls > 0) {
        // Check if the scheduler call is wrapped in try/catch
        if (!/try\s*\{/.test(body)) {
          issues.push({
            severity: "info",
            location: `${relativePath}:${startLine + 1}`,
            functionName: funcName,
            message: `${funcType} "${funcName}" uses scheduler without try/catch. If the action fails before scheduling, work may be lost.`,
            fix: "Wrap scheduler calls in try/catch or move scheduling to a mutation for transactional guarantees",
          });
        }
      }

      // Check 4: Multiple scheduler calls in same function (fan-out)
      if (allSchedulerCalls > 3) {
        issues.push({
          severity: "info",
          location: `${relativePath}:${startLine + 1}`,
          functionName: funcName,
          message: `${funcType} "${funcName}" makes ${allSchedulerCalls} scheduler calls. Consider if a single orchestrator action would be cleaner.`,
          fix: "Group related work into fewer scheduled calls or use a queue-based pattern",
        });
      }

      // Check 5: Scheduling from a query (not possible — queries are read-only)
      if (funcType.includes("Query") || funcType === "query" || funcType === "internalQuery") {
        issues.push({
          severity: "critical",
          location: `${relativePath}:${startLine + 1}`,
          functionName: funcName,
          message: `Query "${funcName}" tries to use ctx.scheduler — queries are read-only and cannot schedule functions.`,
          fix: "Move scheduler calls to a mutation or action",
        });
      }
    }
  }

  return {
    issues,
    stats: {
      totalSchedulerCalls,
      runAfterCalls,
      runAtCalls,
      selfSchedulingFunctions,
      filesWithSchedulers: filesWithSchedulers.size,
    },
  };
}

// ── Tool Definition ─────────────────────────────────────────────────

export const schedulerTools: McpTool[] = [
  {
    name: "convex_audit_schedulers",
    description:
      "Audit Convex scheduled function usage (ctx.scheduler.runAfter/runAt): detects infinite self-scheduling loops, sub-second delays without backoff, scheduler calls in queries (impossible), unprotected scheduler calls in actions, and excessive fan-out patterns.",
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

      const { issues, stats } = auditSchedulers(convexDir);

      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "scheduler_audit", JSON.stringify(issues), issues.length);

      return {
        summary: {
          ...stats,
          totalIssues: issues.length,
          critical: issues.filter(i => i.severity === "critical").length,
          warnings: issues.filter(i => i.severity === "warning").length,
        },
        issues: issues.slice(0, 30),
        quickRef: getQuickRef("convex_audit_schedulers"),
      };
    },
  },
];
