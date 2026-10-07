import fs from "node:fs/promises";
import path from "node:path";

export const WEB_SOURCE_RELATIVE_PATH = "apps/web/src";
export const DESIGN_TOKEN_SOURCE = `${WEB_SOURCE_RELATIVE_PATH}/index.css`;
export const NODE_WORKER_ENTRY_RELATIVE_PATH = "workers/node/index.ts";

export const ROUTING_SOURCE_RELATIVE_PATHS = Object.freeze([
  `${WEB_SOURCE_RELATIVE_PATH}/lib/registry/viewRegistry.ts`,
  `${WEB_SOURCE_RELATIVE_PATH}/App.tsx`,
  `${WEB_SOURCE_RELATIVE_PATH}/features/redesign/lib/oneSurfaceRouting.ts`,
]);

export function resolveWebSourceRoot(repoRoot) {
  return path.join(repoRoot, "apps", "web", "src");
}

export function resolveWebSourcePath(repoRoot, ...segments) {
  return path.join(resolveWebSourceRoot(repoRoot), ...segments);
}

export function resolveDesignTokenPath(repoRoot) {
  return resolveWebSourcePath(repoRoot, "index.css");
}

export function buildNodeWorkerDevCommand(npxCommand = "npx") {
  return `${npxCommand} tsx ${NODE_WORKER_ENTRY_RELATIVE_PATH}`;
}

function addStaticRoute(routes, candidate) {
  const route = String(candidate ?? "").trim();
  if (!route.startsWith("/")) return;
  if (route.includes(":") || route.includes("${")) return;
  if (/^\/(?:api|auth|oauth|callback|entity)(?:\/|$)/i.test(route)) return;

  const normalized = route.length > 1 ? route.replace(/\/+$/, "") : route;
  if (normalized) routes.add(normalized);
}

/**
 * Read the standard-tree routing sources without importing the React app.
 * The QA crawler uses these deterministic seeds when icon-only navigation
 * leaves too few discoverable links in the rendered DOM.
 */
export async function discoverRouteSeedsFromSource(repoRoot) {
  const routes = new Set();
  const sources = [];
  const propertyPattern = /\bpath\s*:\s*(["'])(\/[^"'`]*?)\1/g;
  const startsWithPattern = /pathname\.startsWith\(\s*(["'])(\/[^"'`]*?)\1\s*\)/g;
  const equalityPattern = /pathname\s*===\s*(["'])(\/[^"'`]*?)\1/g;

  for (const relativePath of ROUTING_SOURCE_RELATIVE_PATHS) {
    const absolutePath = path.join(repoRoot, ...relativePath.split("/"));
    let source;
    try {
      source = await fs.readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    sources.push(relativePath);
    for (const pattern of [propertyPattern, startsWithPattern, equalityPattern]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) addStaticRoute(routes, match[2]);
    }
  }

  return { paths: Array.from(routes), sources };
}

export function resolveRepairContextBaseFiles(repoRoot) {
  return [
    resolveWebSourcePath(repoRoot, "index.css"),
    resolveWebSourcePath(repoRoot, "main.tsx"),
    resolveWebSourcePath(repoRoot, "App.tsx"),
    resolveWebSourcePath(repoRoot, "layouts", "CockpitLayout.tsx"),
  ];
}

export function resolveDesignContextBaseFiles(repoRoot) {
  return [
    resolveWebSourcePath(repoRoot, "index.css"),
    path.join(repoRoot, "tailwind.config.js"),
    resolveWebSourcePath(repoRoot, "features", "redesign", "RedesignShell.tsx"),
    resolveWebSourcePath(repoRoot, "features", "redesign", "primitives.css"),
    resolveWebSourcePath(repoRoot, "layouts", "CockpitLayout.tsx"),
  ];
}
