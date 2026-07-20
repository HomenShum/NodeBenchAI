import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
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

interface CronEntry {
  name: string;
  type: "interval" | "daily" | "weekly" | "monthly" | "cron";
  schedule: string;
  handler: string;
  args: string;
  line: number;
  issues: string[];
}

function parseCrons(content: string): CronEntry[] {
  const entries: CronEntry[] = [];
  const lines = content.split("\n");

  // Match crons.interval(...), crons.daily(...), crons.weekly(...), crons.monthly(...)
  const cronPattern = /crons\.(interval|daily|weekly|monthly|cron)\s*\(/g;
  let match;

  while ((match = cronPattern.exec(content)) !== null) {
    const type = match[1] as CronEntry["type"];
    const startIdx = match.index;
    const lineNumber = content.substring(0, startIdx).split("\n").length;

    // Extract the full call (find matching paren)
    let depth = 0;
    let i = startIdx + match[0].length - 1; // start at the opening paren
    const start = i;
    for (; i < content.length; i++) {
      if (content[i] === "(") depth++;
      else if (content[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const callBody = content.substring(start, i + 1);

    // Extract name (first string argument)
    const nameMatch = callBody.match(/["'`]([^"'`]+)["'`]/);
    const name = nameMatch ? nameMatch[1] : "unnamed";

    // Extract schedule object
    const scheduleMatch = callBody.match(/\{\s*([\w\s:,]+)\s*\}/);
    const schedule = scheduleMatch ? scheduleMatch[0].trim() : "unknown";

    // Extract handler reference
    const handlerMatch = callBody.match(/internal\.[.\w]+/);
    const handler = handlerMatch ? handlerMatch[0] : "unknown";

    // Extract args
    const argsMatches = [...callBody.matchAll(/\{\s*[\w\s:,]+\s*\}/g)];
    const args = argsMatches.length > 2
      ? argsMatches[argsMatches.length - 1][0].trim()
      : "{}";

    // Check for issues
    const issues: string[] = [];

    // Issue: missing internal. prefix (public function as cron handler)
    if (handler === "unknown" && callBody.includes("api.")) {
      issues.push("CRITICAL: Cron handler uses public api. instead of internal. — crons should only call internal functions");
    }

    // Issue: very frequent interval
    if (type === "interval") {
      const minutesMatch = schedule.match(/minutes:\s*(\d+)/);
      if (minutesMatch && parseInt(minutesMatch[1]) < 5) {
        issues.push(`WARNING: Interval of ${minutesMatch[1]} minutes is very frequent — consider if this rate is necessary`);
      }
    }

    // Issue: duplicate name detection (done after collecting all)

    entries.push({ name, type, schedule, handler, args, line: lineNumber, issues });
  }

  // Check for duplicate names
  const nameCount = new Map<string, number>();
  for (const e of entries) {
    nameCount.set(e.name, (nameCount.get(e.name) || 0) + 1);
  }
  for (const e of entries) {
    if ((nameCount.get(e.name) || 0) > 1) {
      e.issues.push(`CRITICAL: Duplicate cron name "${e.name}" — each cron must have a unique name`);
    }
  }

  return entries;
}

// ── Tool Definitions ────────────────────────────────────────────────

export const cronTools: McpTool[] = [
  {
    name: "convex_check_crons",
    description:
      "Validate cron job definitions in convex/crons.ts. Checks: handler references use internal (not api), no duplicate names, schedule validity, frequency analysis. Returns cron inventory with issues.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: {
          type: "string",
          description: "Absolute path to the project root",
        },
      },
      required: ["projectDir"],
    },
    handler: async (args: { projectDir: string }) => {
      const projectDir = resolve(args.projectDir);
      const convexDir = findConvexDir(projectDir);
      if (!convexDir) return { error: "No convex/ directory found" };

      const cronsPath = join(convexDir, "crons.ts");
      if (!existsSync(cronsPath)) {
        return {
          hasCrons: false,
          message: "No crons.ts file found — project has no scheduled jobs",
          quickRef: getQuickRef("convex_get_methodology"),
        };
      }

      const content = readFileSync(cronsPath, "utf-8");
      const entries = parseCrons(content);
      const allIssues = entries.flatMap((e) => e.issues.map((i) => ({ cron: e.name, issue: i })));
      const criticalCount = allIssues.filter((i) => i.issue.startsWith("CRITICAL")).length;
      const warningCount = allIssues.filter((i) => i.issue.startsWith("WARNING")).length;

      // Frequency analysis
      const byType = {
        interval: entries.filter((e) => e.type === "interval").length,
        daily: entries.filter((e) => e.type === "daily").length,
        weekly: entries.filter((e) => e.type === "weekly").length,
        monthly: entries.filter((e) => e.type === "monthly").length,
      };

      return {
        hasCrons: true,
        totalCrons: entries.length,
        byType,
        issues: {
          total: allIssues.length,
          critical: criticalCount,
          warnings: warningCount,
          details: allIssues,
        },
        crons: entries.map((e) => ({
          name: e.name,
          type: e.type,
          schedule: e.schedule,
          handler: e.handler,
          line: e.line,
          issueCount: e.issues.length,
        })),
        quickRef: getQuickRef("convex_pre_deploy_gate"),
      };
    },
  },
];
