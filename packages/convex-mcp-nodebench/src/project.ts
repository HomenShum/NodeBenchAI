import { closeSync, openSync, readSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const MAX_CONFIG_BYTES = 64 * 1024;

function directory(path: string): string | null {
  try { return statSync(path).isDirectory() ? path : null; }
  catch { return null; }
}

/** Resolve the project being audited; an invalid explicit config never selects a stale tree. */
export function findConvexDir(projectDir: string): string | null {
  let config: unknown;
  try {
    const fd = openSync(join(projectDir, "convex.json"), "r");
    try {
      const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
      const bytes = readSync(fd, buffer, 0, buffer.length, 0);
      if (bytes > MAX_CONFIG_BYTES) return null;
      config = JSON.parse(buffer.toString("utf8", 0, bytes));
    } finally { closeSync(fd); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
  }

  if (config !== undefined) {
    if (typeof config !== "object" || config === null || Array.isArray(config)) return null;
    if (Object.hasOwn(config, "functions")) {
      const functions = (config as Record<string, unknown>).functions;
      if (typeof functions !== "string" || !functions.trim() || isAbsolute(functions)) return null;
      return directory(resolve(projectDir, functions));
    }
  }

  for (const relative of ["convex", "src/convex", "backend/convex"]) {
    const found = directory(resolve(projectDir, relative));
    if (found) return found;
  }
  return null;
}
