import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const DEFAULT_CONVEX_PROJECT = "convex";

/**
 * Resolve the TypeScript project that owns Convex functions from convex.json.
 * This keeps deploy preflight aligned with Convex's own functions-directory
 * contract when a brownfield repository moves from convex/ to a standard tree.
 */
export function resolveConvexTypecheckProject(root) {
  const configPath = join(root, "convex.json");
  if (!existsSync(configPath)) return DEFAULT_CONVEX_PROJECT;

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Cannot read ${configPath}: ${detail}`);
  }

  if (config.functions === undefined) return DEFAULT_CONVEX_PROJECT;
  if (typeof config.functions !== "string" || !config.functions.trim()) {
    throw new Error("convex.json functions must be a non-empty relative path");
  }

  const absoluteProject = resolve(root, config.functions);
  const relativeProject = relative(root, absoluteProject);
  if (
    !relativeProject ||
    isAbsolute(relativeProject) ||
    relativeProject === ".." ||
    relativeProject.startsWith(`..${sep}`)
  ) {
    throw new Error("convex.json functions must stay inside the repository root");
  }

  return relativeProject.split(sep).join("/");
}
