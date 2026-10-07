import { findConvexDir } from "../project.js";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDb, genId } from "../db.js";
import { getQuickRef } from "./toolRegistry.js";
import type { McpTool } from "../types.js";

// ── Dev Setup Audit ─────────────────────────────────────────────────

interface SetupIssue {
  severity: "critical" | "warning" | "info";
  area: string;
  message: string;
  fix: string;
}

function auditDevSetup(projectDir: string): {
  issues: SetupIssue[];
  checks: Array<{ area: string; status: "pass" | "warn" | "fail"; detail: string }>;
} {
  const issues: SetupIssue[] = [];
  const checks: Array<{ area: string; status: "pass" | "warn" | "fail"; detail: string }> = [];

  // Check 1: .gitignore includes _generated/
  const gitignorePath = join(projectDir, ".gitignore");
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, "utf-8");
    if (gitignore.includes("_generated") || gitignore.includes("convex/_generated")) {
      checks.push({ area: "gitignore", status: "pass", detail: "_generated/ is in .gitignore" });
    } else {
      checks.push({ area: "gitignore", status: "warn", detail: "_generated/ not in .gitignore — generated files may be committed" });
      issues.push({
        severity: "warning",
        area: "gitignore",
        message: "_generated/ directory is not in .gitignore. These files are auto-generated and should not be committed.",
        fix: "Add `convex/_generated/` to .gitignore",
      });
    }
  } else {
    checks.push({ area: "gitignore", status: "fail", detail: "No .gitignore file found" });
    issues.push({
      severity: "warning",
      area: "gitignore",
      message: "No .gitignore file found. Generated and environment files may be committed.",
      fix: "Create a .gitignore with at least: node_modules/, convex/_generated/, .env.local",
    });
  }

  // Check 2: .env.example exists
  const envExamplePath = join(projectDir, ".env.example");
  if (existsSync(envExamplePath)) {
    checks.push({ area: "env_example", status: "pass", detail: ".env.example exists for onboarding" });
  } else {
    // Check if there are env vars in use
    const envLocalPath = join(projectDir, ".env.local");
    const envPath = join(projectDir, ".env");
    if (existsSync(envLocalPath) || existsSync(envPath)) {
      checks.push({ area: "env_example", status: "warn", detail: ".env files exist but no .env.example for new developers" });
      issues.push({
        severity: "info",
        area: "env_example",
        message: "No .env.example file. New developers won't know which env vars to set.",
        fix: "Create .env.example with placeholder values for all required environment variables",
      });
    }
  }

  // Check 3: configuration resolves to the backend actually being audited.
  const convexDir = findConvexDir(projectDir);
  if (existsSync(join(projectDir, "convex.json"))) {
    if (convexDir) {
      checks.push({ area: "convex_json", status: "pass", detail: "Convex functions directory resolved from project configuration" });
    } else {
      checks.push({ area: "convex_json", status: "fail", detail: "Convex configuration does not resolve to a functions directory" });
      issues.push({ severity: "critical", area: "convex_json", message: "Convex configuration or functions directory is unavailable.", fix: "Check convex.json and its functions path; do not audit a stale directory." });
    }
  }

  // Check 4: package.json has convex as dependency
  const pkgJsonPath = join(projectDir, "package.json");
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.convex) {
        checks.push({ area: "convex_dep", status: "pass", detail: `convex@${deps.convex} installed` });
      } else {
        checks.push({ area: "convex_dep", status: "fail", detail: "convex not in dependencies" });
        issues.push({
          severity: "critical",
          area: "convex_dep",
          message: "convex package is not in dependencies. Install it first.",
          fix: "Run: npm install convex",
        });
      }
    } catch { /* ignore parse errors */ }
  }

  // Check 5: tsconfig.json configured for Convex
  const tsconfigPath = join(projectDir, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    const tsconfig = readFileSync(tsconfigPath, "utf-8");
    if (/\"strict\"\s*:\s*true/.test(tsconfig)) {
      checks.push({ area: "tsconfig", status: "pass", detail: "TypeScript strict mode enabled" });
    } else {
      checks.push({ area: "tsconfig", status: "info" as any, detail: "TypeScript strict mode not enabled — recommended for Convex" });
    }
  }

  // Check 6: _generated/ directory exists (project initialized)
  const generatedDir = convexDir ? join(convexDir, "_generated") : null;
  if (generatedDir && existsSync(generatedDir)) {
    checks.push({ area: "initialization", status: "pass", detail: "_generated/ exists — project is initialized" });
  } else if (convexDir) {
    checks.push({ area: "initialization", status: "warn", detail: "_generated/ not found — run `npx convex dev` to initialize" });
    issues.push({
      severity: "warning",
      area: "initialization",
      message: "Convex project not initialized — _generated/ directory is missing.",
      fix: "Run `npx convex dev` to generate types and initialize the project",
    });
  }

  // Check 7: Node modules installed
  const nodeModulesPath = join(projectDir, "node_modules", "convex");
  if (existsSync(nodeModulesPath)) {
    checks.push({ area: "node_modules", status: "pass", detail: "convex package installed in node_modules" });
  } else if (existsSync(pkgJsonPath)) {
    checks.push({ area: "node_modules", status: "warn", detail: "convex not in node_modules — run npm install" });
  }

  return { issues, checks };
}

// ── Tool Definition ─────────────────────────────────────────────────

export const devSetupTools: McpTool[] = [
  {
    name: "convex_audit_dev_setup",
    description:
      "Audit Convex project development setup: .gitignore includes _generated/, .env.example exists, convex.json is valid, convex is in dependencies, TypeScript strict mode, project initialization status.",
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
      const { issues, checks } = auditDevSetup(projectDir);

      const db = getDb();
      db.prepare(
        "INSERT INTO audit_results (id, project_dir, audit_type, issues_json, issue_count) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("audit"), projectDir, "dev_setup", JSON.stringify(issues), issues.length);

      const passed = checks.filter((c) => c.status === "pass").length;
      const warned = checks.filter((c) => c.status === "warn").length;
      const failed = checks.filter((c) => c.status === "fail").length;

      return {
        summary: {
          totalChecks: checks.length,
          passed,
          warned,
          failed,
          totalIssues: issues.length,
        },
        checks,
        issues,
        quickRef: getQuickRef("convex_audit_dev_setup"),
      };
    },
  },
];
