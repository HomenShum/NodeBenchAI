import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
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

// ── HTTP Endpoint Analysis ──────────────────────────────────────────

interface HttpRoute {
  path: string;
  method: string;
  line: number;
  sourceFile: string;
  handlerType: "inline" | "imported";
  isWildcard: boolean;
}

interface CompositeRouteSource {
  callee: string;
  sourceFile: string;
  line: number;
}

interface HttpIssue {
  severity: "critical" | "warning" | "info";
  message: string;
  location?: string;
}

/** Resolve a relative import to a .ts file path */
function resolveImport(fromFile: string, importPath: string): string | null {
  const dir = dirname(fromFile);
  const candidates = [
    join(dir, importPath + ".ts"),
    join(dir, importPath, "index.ts"),
    join(dir, importPath + ".tsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Extract http.route() calls from a file's content, supporting both path and pathPrefix */
function extractRoutesFromContent(content: string, sourceFile: string): HttpRoute[] {
  const routes: HttpRoute[] = [];
  // Match any variable name followed by .route({ ... })
  const routeBlockPattern = /\w+\.route\s*\(\s*\{/g;
  let routeMatch;
  while ((routeMatch = routeBlockPattern.exec(content)) !== null) {
    const startIdx = routeMatch.index;
    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === "{") depth++;
      if (content[i] === "}") {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }
    const block = content.slice(startIdx, endIdx + 1);

    // Support both path: and pathPrefix:
    const pathMatch = block.match(/(?:path|pathPrefix)\s*:\s*["']([^"']+)["']/);
    const methodMatch = block.match(/method\s*:\s*["']([^"']+)["']/);
    const isWildcard = /pathPrefix\s*:/.test(block) || /\/\*/.test(block) || /:\w+/.test(pathMatch?.[1] || "");
    const line = content.slice(0, startIdx).split("\n").length;

    if (pathMatch && methodMatch) {
      routes.push({
        path: pathMatch[1],
        method: methodMatch[1].toUpperCase(),
        line,
        sourceFile,
        handlerType: /handler\s*:\s*httpAction/.test(block) ? "inline" : "imported",
        isWildcard,
      });
    }
  }
  return routes;
}

/** Follow imports from http.ts to find all router files */
function findRouterFiles(convexDir: string, httpPath: string): string[] {
  const files = [httpPath];
  const visited = new Set<string>([httpPath]);
  const content = readFileSync(httpPath, "utf-8");

  // Find relative imports that look like router sources
  const importPattern = /import\s+(?:[\w{},\s]+\s+from\s+)?["'](\.[^"']+)["']/g;
  let m;
  while ((m = importPattern.exec(content)) !== null) {
    const resolved = resolveImport(httpPath, m[1]);
    if (resolved && !visited.has(resolved)) {
      visited.add(resolved);
      // Only include files that contain .route( or httpRouter or httpAction
      try {
        const fc = readFileSync(resolved, "utf-8");
        if (/\.route\s*\(/.test(fc) || /httpRouter/.test(fc) || /httpAction/.test(fc)) {
          files.push(resolved);
        }
      } catch { /* skip unreadable */ }
    }
  }

  return files;
}

/** Detect .registerRoutes(http), .addHttpRoutes(http) and similar composite calls */
function detectCompositeRouteSources(content: string, sourceFile: string): CompositeRouteSource[] {
  const composites: CompositeRouteSource[] = [];
  const pattern = /(\w+)\.(registerRoutes|addHttpRoutes)\s*\(\s*\w+\s*\)/g;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    const line = content.slice(0, m.index).split("\n").length;
    composites.push({
      callee: `${m[1]}.${m[2]}()`,
      sourceFile,
      line,
    });
  }
  return composites;
}

function analyzeHttpEndpoints(convexDir: string): {
  hasHttp: boolean;
  routes: HttpRoute[];
  compositeRouteSources: CompositeRouteSource[];
  issues: HttpIssue[];
  hasCors: boolean;
  hasOptionsHandler: boolean;
  filesScanned: string[];
} {
  const httpPath = join(convexDir, "http.ts");
  if (!existsSync(httpPath)) {
    return { hasHttp: false, routes: [], compositeRouteSources: [], issues: [], hasCors: false, hasOptionsHandler: false, filesScanned: [] };
  }

  const routerFiles = findRouterFiles(convexDir, httpPath);
  const allRoutes: HttpRoute[] = [];
  const allComposites: CompositeRouteSource[] = [];
  const issues: HttpIssue[] = [];
  let hasCorsInAny = false;

  for (const filePath of routerFiles) {
    const content = readFileSync(filePath, "utf-8");
    const relPath = filePath.replace(convexDir, "").replace(/^[\\/]/, "");

    // Extract routes
    const routes = extractRoutesFromContent(content, relPath);
    allRoutes.push(...routes);

    // Detect composite route sources
    const composites = detectCompositeRouteSources(content, relPath);
    allComposites.push(...composites);

    // Check for CORS in any file
    if (/Access-Control-Allow-Origin/i.test(content) || /cors/i.test(content)) {
      hasCorsInAny = true;
    }
  }

  const hasOptionsHandler = allRoutes.some((r) => r.method === "OPTIONS");

  // Check for duplicate routes (same path + method)
  const routeKeys = new Map<string, number>();
  for (const route of allRoutes) {
    const key = `${route.method} ${route.path}`;
    const count = (routeKeys.get(key) || 0) + 1;
    routeKeys.set(key, count);
    if (count === 2) {
      issues.push({
        severity: "critical",
        message: `Duplicate route: ${key} — only the last registration will be used`,
        location: `${route.sourceFile}:${route.line}`,
      });
    }
  }

  if (!hasCorsInAny && allRoutes.length > 0) {
    issues.push({
      severity: "warning",
      message: "No CORS headers detected in any HTTP router file. Browser requests from different origins will fail.",
    });
  }

  if (hasCorsInAny && !hasOptionsHandler) {
    issues.push({
      severity: "warning",
      message: "CORS headers found but no OPTIONS handler registered. Preflight requests will fail.",
    });
  }

  // Check http.ts specifically for required exports
  const httpContent = readFileSync(httpPath, "utf-8");
  if (!/export\s+default/.test(httpContent)) {
    issues.push({
      severity: "critical",
      message: "Missing 'export default' in http.ts. The httpRouter must be exported as default.",
    });
  }

  // Info about composite routes that can't be statically analyzed
  if (allComposites.length > 0) {
    issues.push({
      severity: "info",
      message: `${allComposites.length} composite route source(s) detected (${allComposites.map(c => c.callee).join(", ")}). These add routes dynamically — actual route count may be higher than statically detected.`,
    });
  }

  return {
    hasHttp: true,
    routes: allRoutes,
    compositeRouteSources: allComposites,
    issues,
    hasCors: hasCorsInAny,
    hasOptionsHandler,
    filesScanned: routerFiles.map(f => f.replace(convexDir, "").replace(/^[\\/]/, "")),
  };
}

// ── Tool Definitions ────────────────────────────────────────────────

export const httpTools: McpTool[] = [
  {
    name: "convex_analyze_http",
    description:
      "Analyze convex/http.ts for HTTP endpoint issues: duplicate routes, missing CORS headers, missing OPTIONS preflight handlers, missing httpRouter/httpAction imports, and missing default export. Returns route inventory with methods and paths.",
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

      const result = analyzeHttpEndpoints(convexDir);
      if (!result.hasHttp) {
        return {
          hasHttp: false,
          message: "No convex/http.ts found — project has no HTTP endpoints",
          quickRef: getQuickRef("convex_analyze_http"),
        };
      }

      // Group routes by method
      const byMethod: Record<string, number> = {};
      for (const r of result.routes) {
        byMethod[r.method] = (byMethod[r.method] || 0) + 1;
      }

      // Group routes by source file
      const byFile: Record<string, number> = {};
      for (const r of result.routes) {
        byFile[r.sourceFile] = (byFile[r.sourceFile] || 0) + 1;
      }

      return {
        hasHttp: true,
        totalStaticRoutes: result.routes.length,
        compositeRouteSources: result.compositeRouteSources.length,
        estimatedTotalRoutes: result.compositeRouteSources.length > 0
          ? `${result.routes.length}+ (${result.compositeRouteSources.length} dynamic source(s) add additional routes)`
          : result.routes.length,
        filesScanned: result.filesScanned,
        byMethod,
        byFile,
        hasCors: result.hasCors,
        hasOptionsHandler: result.hasOptionsHandler,
        routes: result.routes,
        composites: result.compositeRouteSources.length > 0
          ? result.compositeRouteSources
          : undefined,
        issues: {
          total: result.issues.length,
          critical: result.issues.filter((i) => i.severity === "critical").length,
          warnings: result.issues.filter((i) => i.severity === "warning").length,
          details: result.issues,
        },
        quickRef: getQuickRef("convex_analyze_http"),
      };
    },
  },
];
