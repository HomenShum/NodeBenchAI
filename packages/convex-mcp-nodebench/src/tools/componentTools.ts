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

interface ComponentInfo {
  importName: string;
  packageName: string;
  configPath: string;
  isUsed: boolean;
  isConditional: boolean;
  line: number;
}

function parseConvexConfig(content: string): {
  components: ComponentInfo[];
  issues: string[];
} {
  const components: ComponentInfo[] = [];
  const issues: string[] = [];
  const lines = content.split("\n");

  // Find all import lines for convex.config
  const importPattern = /import\s+(\w+)\s+from\s+["'](@[\w/-]+)\/convex\.config["']/g;
  let match;

  while ((match = importPattern.exec(content)) !== null) {
    const importName = match[1];
    const packageName = match[2];
    const lineNumber = content.substring(0, match.index).split("\n").length;

    // Check if this component is used (app.use(...))
    const usePattern = new RegExp(`app\\.use\\(${importName}\\)`, "g");
    const isUsed = usePattern.test(content);

    // Check if conditional
    const conditionalPattern = new RegExp(`if\\s*\\([^)]*\\)\\s*\\{[^}]*app\\.use\\(${importName}\\)`, "s");
    const isConditional = conditionalPattern.test(content);

    components.push({
      importName,
      packageName,
      configPath: `${packageName}/convex.config`,
      isUsed,
      isConditional,
      line: lineNumber,
    });
  }

  // Check for unused imports
  for (const comp of components) {
    if (!comp.isUsed) {
      issues.push(`WARNING: Component "${comp.importName}" (${comp.packageName}) is imported but never used with app.use()`);
    }
  }

  // Check for defineApp
  if (!content.includes("defineApp")) {
    issues.push("CRITICAL: Missing defineApp() — convex.config.ts must call defineApp()");
  }

  // Check for default export
  if (!content.includes("export default")) {
    issues.push("CRITICAL: Missing default export — convex.config.ts must export the app");
  }

  // Check for process.env usage (allowed but noteworthy)
  const envUsages = content.match(/process\.env\.\w+/g) || [];
  if (envUsages.length > 0) {
    issues.push(`INFO: ${envUsages.length} environment variable(s) used for conditional component loading: ${envUsages.join(", ")}`);
  }

  return { components, issues };
}

// ── Tool Definitions ────────────────────────────────────────────────

export const componentTools: McpTool[] = [
  {
    name: "convex_analyze_components",
    description:
      "Analyze Convex component imports in convex.config.ts. Lists all installed Convex components (agent, workflow, rag, etc.), checks for unused imports, conditional loading, and configuration issues. Essential before adding new components to avoid conflicts.",
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

      const configPath = join(convexDir, "convex.config.ts");
      if (!existsSync(configPath)) {
        return {
          hasConfig: false,
          message: "No convex.config.ts found — project uses no Convex components",
          quickRef: getQuickRef("convex_get_methodology"),
        };
      }

      const content = readFileSync(configPath, "utf-8");
      const { components, issues } = parseConvexConfig(content);

      // Check package.json for component versions
      const pkgPath = join(projectDir, "package.json");
      let componentVersions: Record<string, string> = {};
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
          const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
          for (const comp of components) {
            if (allDeps[comp.packageName]) {
              componentVersions[comp.packageName] = allDeps[comp.packageName];
            }
          }
        } catch { /* ignore */ }
      }

      const criticalCount = issues.filter((i) => i.startsWith("CRITICAL")).length;
      const warningCount = issues.filter((i) => i.startsWith("WARNING")).length;

      return {
        hasConfig: true,
        totalComponents: components.length,
        activeComponents: components.filter((c) => c.isUsed).length,
        conditionalComponents: components.filter((c) => c.isConditional).length,
        components: components.map((c) => ({
          name: c.importName,
          package: c.packageName,
          version: componentVersions[c.packageName] || "unknown",
          isUsed: c.isUsed,
          isConditional: c.isConditional,
          line: c.line,
        })),
        issues: {
          total: issues.length,
          critical: criticalCount,
          warnings: warningCount,
          details: issues,
        },
        quickRef: getQuickRef("convex_pre_deploy_gate"),
      };
    },
  },
];
