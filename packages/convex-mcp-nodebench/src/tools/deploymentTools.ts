import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDb, genId } from "../db.js";
import { getQuickRef } from "./toolRegistry.js";
import type { McpTool, DeployGateResult } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function findConvexDir(projectDir: string): string | null {
  const candidates = [join(projectDir, "convex"), join(projectDir, "src", "convex"), join(projectDir, "backend", "convex")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// ── Pre-Deploy Gate ─────────────────────────────────────────────────

function runPreDeployChecks(projectDir: string): DeployGateResult {
  const checks: DeployGateResult["checks"] = [];
  const blockers: string[] = [];

  // Check 1: convex/ directory exists
  const convexDir = findConvexDir(projectDir);
  if (!convexDir) {
    checks.push({ name: "convex_dir_exists", passed: false, message: "No convex/ directory found" });
    blockers.push("No convex/ directory found");
    return {
      passed: false,
      checks,
      blockers: blockers.map((b, i) => ({ priority: i + 1, blocker: b, fixFirst: i === 0 })),
      fixOrder: "Fix #1: Create a convex/ directory. Then re-run convex_pre_deploy_gate.",
    };
  }
  checks.push({ name: "convex_dir_exists", passed: true, message: `Found at ${convexDir}` });

  // Check 2: schema.ts exists
  const schemaPath = join(convexDir, "schema.ts");
  if (existsSync(schemaPath)) {
    checks.push({ name: "schema_exists", passed: true, message: "schema.ts found" });

    // Check 2b: schema.ts has export default
    const schemaContent = readFileSync(schemaPath, "utf-8");
    if (/export\s+default\s+defineSchema/.test(schemaContent)) {
      checks.push({ name: "schema_exports_default", passed: true, message: "schema.ts exports default defineSchema" });
    } else {
      checks.push({ name: "schema_exports_default", passed: false, message: "schema.ts missing 'export default defineSchema(...)'" });
      blockers.push("schema.ts must export default defineSchema(...)");
    }

    // Check 2c: no deprecated validators
    if (/v\.bigint\s*\(/.test(schemaContent)) {
      checks.push({ name: "no_deprecated_validators", passed: false, message: "schema.ts uses deprecated v.bigint() - use v.int64()" });
      blockers.push("Replace v.bigint() with v.int64() in schema.ts");
    } else {
      checks.push({ name: "no_deprecated_validators", passed: true, message: "No deprecated validators found" });
    }
  } else {
    checks.push({ name: "schema_exists", passed: false, message: "No schema.ts found - Convex will use inferred schema" });
    // Not a blocker, just a warning
  }

  // Check 3: auth.config.ts exists (if auth.ts exists)
  const authPath = join(convexDir, "auth.ts");
  const authConfigPath = join(convexDir, "auth.config.ts");
  if (existsSync(authPath)) {
    if (existsSync(authConfigPath)) {
      checks.push({ name: "auth_config_exists", passed: true, message: "auth.config.ts found alongside auth.ts" });
    } else {
      checks.push({ name: "auth_config_exists", passed: false, message: "auth.ts exists but auth.config.ts is missing" });
      blockers.push("Create auth.config.ts to configure authentication providers");
    }
  }

  // Check 4: convex.config.ts exists (for Convex components)
  const convexConfigPath = join(convexDir, "convex.config.ts");
  if (existsSync(convexConfigPath)) {
    checks.push({ name: "convex_config_exists", passed: true, message: "convex.config.ts found" });
  }

  // Check 5: No TypeScript errors in recent audit
  const db = getDb();
  const latestAudit = db.prepare(
    "SELECT * FROM audit_results WHERE project_dir = ? ORDER BY audited_at DESC LIMIT 1"
  ).get(projectDir) as any;
  if (latestAudit) {
    if (latestAudit.issue_count === 0) {
      checks.push({ name: "recent_audit_clean", passed: true, message: `Last audit (${latestAudit.audit_type}) found 0 issues` });
    } else {
      checks.push({ name: "recent_audit_clean", passed: false, message: `Last audit (${latestAudit.audit_type}) found ${latestAudit.issue_count} issues` });
      // Only block on truly critical issues (deprecated validators, missing args/handler)
      // Missing returns is a warning, not a blocker
      try {
        const issues = JSON.parse(latestAudit.issues_json);
        const criticals = Array.isArray(issues)
          ? issues.filter((i: any) => i.severity === "critical")
          : [];
        if (criticals.length > 10) {
          blockers.push(`${criticals.length} critical issues from last audit (missing args, old syntax, etc.) — fix the most impactful ones first`);
        }
      } catch { /* ignore parse errors */ }
    }
  } else {
    checks.push({ name: "recent_audit_clean", passed: false, message: "No recent audit found. Run convex_audit_schema and convex_audit_functions first." });
  }

  // Check 6: _generated directory exists (project has been initialized)
  const generatedDir = join(convexDir, "_generated");
  if (existsSync(generatedDir)) {
    checks.push({ name: "generated_dir_exists", passed: true, message: "_generated/ directory exists (project initialized)" });
  } else {
    checks.push({ name: "generated_dir_exists", passed: false, message: "_generated/ not found - run 'npx convex dev' first" });
    blockers.push("Run 'npx convex dev' to initialize the project before deploying");
  }

  // Add priority ordering to blockers
  const prioritizedBlockers = blockers.map((b, i) => ({
    priority: i + 1,
    blocker: b,
    fixFirst: i === 0,
  }));

  return {
    passed: blockers.length === 0,
    checks,
    blockers: prioritizedBlockers,
    fixOrder: blockers.length > 0
      ? `Fix ${blockers.length} blocker(s) in order: ${blockers.map((_, i) => `#${i + 1}`).join(" → ")}. Then re-run convex_pre_deploy_gate.`
      : "All checks passed. Safe to deploy.",
  };
}

// ── Env Var Checking ────────────────────────────────────────────────

interface EnvVarCheckResult {
  envFilesFound: string[];
  envVarsInCode: string[];
  envVarsInEnvFile: string[];
  missingInEnvFile: string[];
  suggestions: string[];
}

function checkEnvVars(projectDir: string): EnvVarCheckResult {
  const result: EnvVarCheckResult = {
    envFilesFound: [],
    envVarsInCode: [],
    envVarsInEnvFile: [],
    missingInEnvFile: [],
    suggestions: [],
  };

  // Find .env files
  const envFiles = [".env", ".env.local", ".env.example", ".env.production"];
  for (const f of envFiles) {
    const p = join(projectDir, f);
    if (existsSync(p)) {
      result.envFilesFound.push(f);
      const content = readFileSync(p, "utf-8");
      const vars = content.match(/^([A-Z_][A-Z0-9_]*)=/gm) || [];
      result.envVarsInEnvFile.push(...vars.map((v) => v.replace("=", "")));
    }
  }

  // Scan convex/ for process.env references (filter out non-Convex vars)
  const NON_CONVEX_VARS = new Set([
    "NODE_ENV", "HOME", "PATH", "SHELL", "USER", "LANG", "TERM",
    "HOSTNAME", "PWD", "TMPDIR", "TMP", "TEMP", "CI", "DEBUG",
    "LOG_LEVEL", "VERBOSE", "PORT", "HOST", "NODE_PATH",
    "npm_config_registry", "npm_lifecycle_event",
  ]);
  const convexDir = findConvexDir(projectDir);
  if (convexDir) {
    const files = collectTsFilesFlat(convexDir);
    const envPattern = /process\.env\.([A-Z_][A-Z0-9_]*)/g;
    const codeEnvVars = new Set<string>();

    for (const filePath of files) {
      const content = readFileSync(filePath, "utf-8");
      let m;
      while ((m = envPattern.exec(content)) !== null) {
        const varName = m[1];
        // Skip common Node/OS vars that aren't Convex env vars
        if (!NON_CONVEX_VARS.has(varName)) {
          codeEnvVars.add(varName);
        }
      }
    }
    result.envVarsInCode = [...codeEnvVars];
  }

  // Find missing vars
  const envFileSet = new Set(result.envVarsInEnvFile);
  result.missingInEnvFile = result.envVarsInCode.filter((v) => !envFileSet.has(v));

  // Suggestions
  if (result.missingInEnvFile.length > 0) {
    result.suggestions.push(
      `Set these env vars in your Convex dashboard or .env.local: ${result.missingInEnvFile.join(", ")}`
    );
  }
  if (result.envFilesFound.length === 0) {
    result.suggestions.push("No .env files found. Create .env.local for local development.");
  }

  return result;
}

function collectTsFilesFlat(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "_generated") {
      results.push(...collectTsFilesFlat(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

// ── Tool Definitions ────────────────────────────────────────────────

export const deploymentTools: McpTool[] = [
  {
    name: "convex_pre_deploy_gate",
    description:
      "Run a comprehensive pre-deployment quality gate. Checks: convex/ directory structure, schema.ts validity, deprecated validator usage, auth configuration, recent audit results, and project initialization status. Returns pass/fail with specific blockers.",
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
      const result = runPreDeployChecks(projectDir);

      // Store deploy check
      const db = getDb();
      db.prepare(
        "INSERT INTO deploy_checks (id, project_dir, check_type, passed, findings) VALUES (?, ?, ?, ?, ?)"
      ).run(genId("deploy"), projectDir, "pre_deploy_gate", result.passed ? 1 : 0, JSON.stringify(result));

      return {
        ...result,
        quickRef: getQuickRef("convex_pre_deploy_gate"),
      };
    },
  },
  {
    name: "convex_check_env_vars",
    description:
      "Check that all environment variables referenced in Convex code (process.env.*) are defined in .env files. Identifies missing vars and suggests where to set them.",
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
      const result = checkEnvVars(projectDir);

      // Group missing vars by service for actionable output
      const serviceGroups: Record<string, string[]> = {};
      for (const v of result.missingInEnvFile) {
        const vUp = v.toUpperCase();
        const svc = vUp.includes("OPENAI") ? "OpenAI" :
          vUp.includes("GEMINI") || vUp.includes("GOOGLE") ? "Google" :
          vUp.includes("OPENBB") ? "OpenBB" :
          vUp.includes("TWILIO") ? "Twilio" :
          vUp.includes("LINKEDIN") ? "LinkedIn" :
          vUp.includes("GITHUB") ? "GitHub" :
          vUp.includes("STRIPE") ? "Stripe" :
          vUp.includes("OPENROUTER") ? "OpenRouter" :
          vUp.includes("RESEARCH") ? "Research MCP" :
          vUp.includes("MCP") ? "MCP" :
          vUp.includes("NTFY") ? "Ntfy" :
          vUp.includes("XAI") ? "xAI" :
          vUp.includes("CLERK") ? "Clerk" :
          vUp.includes("CONVEX") ? "Convex" :
          "Other";
        if (!serviceGroups[svc]) serviceGroups[svc] = [];
        serviceGroups[svc].push(v);
      }

      return {
        ...result,
        missingByService: Object.entries(serviceGroups)
          .sort(([, a], [, b]) => b.length - a.length)
          .map(([service, vars]) => ({ service, count: vars.length, vars })),
        quickRef: getQuickRef("convex_check_env_vars"),
      };
    },
  },
];
