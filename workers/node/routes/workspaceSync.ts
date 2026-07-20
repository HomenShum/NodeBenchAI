/**
 * workspaceSync.ts — REST API for MCP workspace ↔ Platform sync.
 *
 * Endpoints:
 *   POST /sync   — Sync a workspace file from MCP local → Convex cloud
 *   GET  /list    — List workspace files (serves WorkspaceExplorer UI)
 *   GET  /file    — Read a single workspace file
 *
 * Local-first: reads from ~/.nodebench/workspace/ on the server.
 * Convex sync: best-effort background write via ConvexHttpClient.
 */

import { Router, type Request, type Response } from "express";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const WORKSPACE_ROOT = path.join(os.homedir(), ".nodebench", "workspace");
const VALID_FOLDERS = new Set(["skills", "rules", "tasks", "research", "notes", "media"]);
const MAX_CONTENT_SIZE = 50_000; // 50KB max for sync payload

// ── Helpers ──────────────────────────────────────────────────────────────

function ensureWorkspace(): void {
  for (const folder of VALID_FOLDERS) {
    const dir = path.join(WORKSPACE_ROOT, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function getFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const types: Record<string, string> = {
    ".md": "markdown", ".txt": "text", ".json": "json", ".jsonl": "jsonl",
    ".yaml": "yaml", ".yml": "yaml", ".csv": "csv",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image",
    ".mp4": "video", ".webm": "video", ".mp3": "audio", ".wav": "audio",
    ".pdf": "document", ".docx": "document", ".xlsx": "spreadsheet",
    ".ts": "code", ".tsx": "code", ".js": "code", ".py": "code",
  };
  return types[ext] ?? "file";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface FileEntry {
  name: string;
  relativePath: string;
  type: string;
  size: string;
  sizeBytes: number;
  modified: string;
  isDirectory: boolean;
}

function listFilesRecursive(dir: string, baseDir?: string): FileEntry[] {
  const base = baseDir ?? dir;
  const entries: FileEntry[] = [];
  if (!fs.existsSync(dir)) return entries;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(base, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, relativePath, type: "folder", size: "", sizeBytes: 0, modified: "", isDirectory: true });
      entries.push(...listFilesRecursive(fullPath, base));
    } else {
      try {
        const stat = fs.statSync(fullPath);
        entries.push({
          name: entry.name, relativePath, type: getFileType(entry.name),
          size: formatSize(stat.size), sizeBytes: stat.size,
          modified: stat.mtime.toISOString(), isDirectory: false,
        });
      } catch { /* skip unreadable */ }
    }
  }
  return entries;
}

// ── Router ───────────────────────────────────────────────────────────────

export function createWorkspaceSyncRouter(): Router {
  const router = Router();

  // POST /sync — receive file from MCP tool, write locally + sync to Convex
  router.post("/sync", async (req: Request, res: Response) => {
    try {
      const { folder, filename, content, subfolder } = req.body ?? {};
      if (!folder || !filename) {
        return res.status(400).json({ ok: false, error: "folder and filename required" });
      }
      if (!VALID_FOLDERS.has(folder)) {
        return res.status(400).json({ ok: false, error: `Invalid folder. Valid: ${[...VALID_FOLDERS].join(", ")}` });
      }

      ensureWorkspace();
      const relPath = subfolder ? path.join(folder, subfolder, filename) : path.join(folder, filename);
      const fullPath = path.join(WORKSPACE_ROOT, relPath);

      // Security: ensure path stays within workspace
      if (!fullPath.startsWith(WORKSPACE_ROOT)) {
        return res.status(400).json({ ok: false, error: "Path escapes workspace" });
      }

      // Ensure parent dir exists
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Write locally
      if (content != null) {
        const truncated = typeof content === "string" ? content.slice(0, MAX_CONTENT_SIZE) : "";
        await fsp.writeFile(fullPath, truncated, "utf-8");
      }

      const stat = fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;

      // Convex sync (best-effort, non-blocking)
      let convexSynced = false;
      // TODO: Wire ConvexHttpClient to create/update document

      res.json({
        ok: true,
        path: relPath,
        size: stat ? formatSize(stat.size) : "0B",
        type: getFileType(filename),
        convexSynced,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? "sync failed" });
    }
  });

  // GET /list — list workspace files for the WorkspaceExplorer UI
  router.get("/list", async (req: Request, res: Response) => {
    try {
      ensureWorkspace();
      const folder = typeof req.query.folder === "string" ? req.query.folder : undefined;

      if (!folder) {
        // Overview: all folders with file counts
        const folders = [...VALID_FOLDERS].map(f => {
          const dir = path.join(WORKSPACE_ROOT, f);
          const files = fs.existsSync(dir) ? listFilesRecursive(dir).filter(e => !e.isDirectory) : [];
          const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
          return { folder: f, fileCount: files.length, totalSize: formatSize(totalBytes) };
        });
        return res.json({ ok: true, workspace: WORKSPACE_ROOT, folders });
      }

      if (!VALID_FOLDERS.has(folder)) {
        return res.status(400).json({ ok: false, error: `Invalid folder: ${folder}` });
      }

      const dir = path.join(WORKSPACE_ROOT, folder);
      const files = fs.existsSync(dir) ? listFilesRecursive(dir) : [];
      res.json({
        ok: true, folder,
        fileCount: files.filter(f => !f.isDirectory).length,
        files: files.slice(0, 100),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? "list failed" });
    }
  });

  // GET /file — read a single workspace file
  router.get("/file", async (req: Request, res: Response) => {
    try {
      const folder = typeof req.query.folder === "string" ? req.query.folder : "";
      const filename = typeof req.query.filename === "string" ? req.query.filename : "";
      if (!folder || !filename) {
        return res.status(400).json({ ok: false, error: "folder and filename required" });
      }

      const fullPath = path.join(WORKSPACE_ROOT, folder, filename);
      if (!fullPath.startsWith(WORKSPACE_ROOT) || !fs.existsSync(fullPath)) {
        return res.status(404).json({ ok: false, error: "File not found" });
      }

      const stat = fs.statSync(fullPath);
      const type = getFileType(filename);

      // Binary files: return metadata only
      if (["image", "video", "audio", "document", "spreadsheet"].includes(type)) {
        return res.json({ ok: true, type, size: formatSize(stat.size), modified: stat.mtime.toISOString(), binary: true });
      }

      const content = await fsp.readFile(fullPath, "utf-8");
      res.json({ ok: true, type, size: formatSize(stat.size), modified: stat.mtime.toISOString(), content, lineCount: content.split("\n").length });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? "read failed" });
    }
  });

  return router;
}
