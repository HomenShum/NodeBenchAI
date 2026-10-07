/* eslint-disable no-var */
// Browser globals used inside page.evaluate() callbacks
declare var localStorage: { clear(): void };
declare var sessionStorage: { clear(): void };

/**
 * Visual QA tools — burst capture + SSIM stability scoring + grid collage
 * for detecting animation jank, flicker, and visual regressions in web apps.
 *
 * Uses Playwright for sequential screenshot capture and sharp for
 * frame-to-frame SSIM computation. No Python server dependency.
 *
 * Reuses patterns from:
 * - uiCaptureTools.ts: Playwright launch, viewport presets, base64 content blocks
 * - visionTools.ts: sharp raw buffer pixel operations
 * - db.ts: SQLite persistence via getDb()/genId()
 */

import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync, readFileSync } from "fs";
import type { McpTool, ContentBlock, RawToolResult } from "../types.js";
import { getDb, genId } from "../db.js";

// ═══ Constants ═══

const BURST_DIR = join(homedir(), ".nodebench", "burst-captures");

const VIEWPORT_PRESETS: Record<string, { width: number; height: number }> = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
  wide: { width: 1920, height: 1080 },
};

// SSIM constants (Wang et al. 2004)
const C1 = (0.01 * 255) ** 2; // 6.5025
const C2 = (0.03 * 255) ** 2; // 58.5225
const BLOCK_SIZE = 8;

// ═══ Helpers ═══

async function getPlaywright(): Promise<typeof import("playwright") | null> {
  try {
    return await import("playwright");
  } catch {
    return null;
  }
}

async function getSharp(): Promise<any> {
  try {
    return (await import("sharp")).default;
  } catch {
    return null;
  }
}

function ensureBurstDir(label: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = label
    ? label.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()
    : "burst";
  const dir = join(BURST_DIR, `${slug}_${timestamp}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Convert RGBA buffer to luminance (grayscale) for SSIM computation.
 * Y = 0.299*R + 0.587*G + 0.114*B
 */
function toLuminance(rgba: Buffer, width: number, height: number): Float64Array {
  const pixels = width * height;
  const lum = new Float64Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4;
    lum[i] = 0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2];
  }
  return lum;
}

/**
 * Compute SSIM between two luminance arrays using 8x8 block windows.
 * Returns average SSIM across all blocks (0.0 to 1.0).
 */
function computeSSIM(
  lumA: Float64Array,
  lumB: Float64Array,
  width: number,
  height: number
): number {
  const blocksX = Math.floor(width / BLOCK_SIZE);
  const blocksY = Math.floor(height / BLOCK_SIZE);
  if (blocksX === 0 || blocksY === 0) return 1.0; // too small to compare

  let totalSSIM = 0;
  let blockCount = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      let sumA = 0, sumB = 0;
      let sumA2 = 0, sumB2 = 0;
      let sumAB = 0;
      const n = BLOCK_SIZE * BLOCK_SIZE;

      for (let dy = 0; dy < BLOCK_SIZE; dy++) {
        for (let dx = 0; dx < BLOCK_SIZE; dx++) {
          const idx = (by * BLOCK_SIZE + dy) * width + (bx * BLOCK_SIZE + dx);
          const a = lumA[idx];
          const b = lumB[idx];
          sumA += a;
          sumB += b;
          sumA2 += a * a;
          sumB2 += b * b;
          sumAB += a * b;
        }
      }

      const muA = sumA / n;
      const muB = sumB / n;
      const varA = sumA2 / n - muA * muA;
      const varB = sumB2 / n - muB * muB;
      const covAB = sumAB / n - muA * muB;

      const ssim =
        ((2 * muA * muB + C1) * (2 * covAB + C2)) /
        ((muA * muA + muB * muB + C1) * (varA + varB + C2));

      totalSSIM += ssim;
      blockCount++;
    }
  }

  return blockCount > 0 ? totalSSIM / blockCount : 1.0;
}

function stabilityGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// ═══ DB Schema (added on first getDb() call via ensureVisualQaTable) ═══

let _tableCreated = false;

function ensureVisualQaTable(): void {
  if (_tableCreated) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS visual_qa_runs (
      id              TEXT PRIMARY KEY,
      url             TEXT NOT NULL,
      label           TEXT,
      viewport        TEXT NOT NULL DEFAULT 'desktop',
      frame_count     INTEGER NOT NULL,
      interval_ms     INTEGER NOT NULL,
      stability_score INTEGER,
      stability_grade TEXT,
      mean_ssim       REAL,
      jank_count      INTEGER DEFAULT 0,
      effective_fps   REAL,
      collage_path    TEXT,
      metadata        TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_visual_qa_url ON visual_qa_runs(url);
    CREATE INDEX IF NOT EXISTS idx_visual_qa_label ON visual_qa_runs(label);
  `);
  _tableCreated = true;
}

// ═══ Tools ═══

export const visualQaTools: McpTool[] = [
  // ─── Tool 1: burst_capture ───
  {
    name: "burst_capture",
    description:
      "Capture N sequential screenshots at fixed intervals using Playwright. " +
      "Navigate to a URL, optionally perform an action (click/scroll), then capture " +
      "a burst of frames for animation stability analysis. Returns frame paths, " +
      "timestamps, and first+last frames as inline images. Designed for detecting " +
      "jank, flicker, and loading smoothness issues.",
    rawContent: true,
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to capture (e.g. http://localhost:5173)",
        },
        frameCount: {
          type: "number",
          description: "Number of frames to capture (default: 10, max: 30)",
        },
        intervalMs: {
          type: "number",
          description: "Interval between frames in ms (default: 50, min: 16)",
        },
        viewport: {
          type: "string",
          enum: ["mobile", "tablet", "desktop", "wide"],
          description: "Viewport preset (default: desktop)",
        },
        preAction: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["click", "scroll", "navigate", "wait"],
            },
            target: {
              type: "string",
              description: "CSS selector (for click) or URL (for navigate)",
            },
            value: {
              type: "string",
              description: "Scroll amount (for scroll) or wait ms (for wait)",
            },
          },
          description:
            "Action to perform before burst starts (e.g. click a tab, scroll down)",
        },
        settleMs: {
          type: "number",
          description:
            "Wait time after page load before burst (default: 500). Use 2000-3000 for pages with heavy initial animations.",
        },
        label: {
          type: "string",
          description: "Label for the burst session (used in directory name)",
        },
        reducedMotion: {
          type: "boolean",
          description:
            "Set prefers-reduced-motion:reduce before capture (default: false). Useful for comparing with/without animations.",
        },
        clearCache: {
          type: "boolean",
          description:
            "Clear browser cache, cookies, and localStorage before navigating (default: false). " +
            "Simulates a cold first-load experience to detect loading jank.",
        },
        waitUntil: {
          type: "string",
          enum: ["networkidle", "commit", "domcontentloaded", "load"],
          description:
            "Navigation wait strategy (default: networkidle). Use 'commit' to start capturing " +
            "as soon as the page begins rendering — essential for detecting loading jank. " +
            "'networkidle' waits until the page is fully loaded (hides loading issues).",
        },
      },
      required: ["url"],
    },
    handler: async (args): Promise<RawToolResult> => {
      const pw = await getPlaywright();
      if (!pw) {
        return {
          error: true,
          message:
            "Playwright is not installed. Run: npm install playwright && npx playwright install chromium",
        };
      }

      const frameCount = Math.min(Math.max(args.frameCount ?? 10, 2), 30);
      const intervalMs = Math.max(args.intervalMs ?? 50, 16);
      const settleMs = args.settleMs ?? 500;
      const viewportName = args.viewport ?? "desktop";
      const viewportSize = VIEWPORT_PRESETS[viewportName];
      const waitUntil = args.waitUntil ?? "networkidle";

      if (!viewportSize) {
        return {
          error: true,
          message: `Unknown viewport: ${viewportName}. Use: mobile, tablet, desktop, wide`,
        };
      }

      const burstDir = ensureBurstDir(args.label ?? "burst");
      const framePaths: string[] = [];
      const timestamps: number[] = [];

      let browser;
      try {
        browser = await pw.chromium.launch({ headless: true });
        const contextOptions: any = { viewport: viewportSize };

        if (args.reducedMotion) {
          contextOptions.reducedMotion = "reduce";
        }

        const context = await browser.newContext(contextOptions);

        // Clear cache if requested (simulate cold first-load)
        if (args.clearCache) {
          await context.clearCookies();
          // Service workers and cache storage cleared via CDP
          const page0 = await context.newPage();
          try {
            const cdp = await page0.context().newCDPSession(page0);
            await cdp.send("Network.clearBrowserCache");
            await cdp.send("Network.clearBrowserCookies");
            await page0.evaluate(() => {
              try { localStorage.clear(); } catch {}
              try { sessionStorage.clear(); } catch {}
              try {
                const w = globalThis as any;
                if (w.caches) w.caches.keys().then((keys: string[]) => keys.forEach((k: string) => w.caches.delete(k)));
              } catch {}
            });
          } catch { /* CDP best-effort */ }
          await page0.close();
        }

        const page = await context.newPage();

        await page.goto(args.url, {
          waitUntil: waitUntil as any,
          timeout: 30000,
        });

        // Settle time — let animations start/finish
        if (settleMs > 0) {
          await page.waitForTimeout(settleMs);
        }

        // Pre-action
        if (args.preAction) {
          const pa = args.preAction;
          switch (pa.type) {
            case "click":
              if (pa.target) await page.click(pa.target, { timeout: 5000 });
              break;
            case "scroll":
              await page.evaluate(
                (amount: number) => (globalThis as any).scrollBy(0, amount),
                parseInt(pa.value ?? "500", 10)
              );
              break;
            case "navigate":
              if (pa.target)
                await page.goto(pa.target, {
                  waitUntil: "networkidle",
                  timeout: 15000,
                });
              break;
            case "wait":
              await page.waitForTimeout(parseInt(pa.value ?? "1000", 10));
              break;
          }
          // Small settle after pre-action
          await page.waitForTimeout(100);
        }

        // Burst capture loop
        for (let i = 0; i < frameCount; i++) {
          const framePath = join(
            burstDir,
            `frame_${String(i).padStart(3, "0")}.png`
          );
          timestamps.push(Date.now());
          await page.screenshot({ path: framePath, fullPage: false });
          framePaths.push(framePath);

          if (i < frameCount - 1) {
            await page.waitForTimeout(intervalMs);
          }
        }

        await browser.close();
        browser = null;

        // Read first and last frames for inline preview
        const firstFrame = readFileSync(framePaths[0]).toString("base64");
        const lastFrame = readFileSync(
          framePaths[framePaths.length - 1]
        ).toString("base64");

        const totalDuration = timestamps[timestamps.length - 1] - timestamps[0];

        const content: ContentBlock[] = [
          {
            type: "text",
            text: JSON.stringify({
              burstDir,
              framePaths,
              timestamps,
              frameCount,
              intervalMs,
              settleMs,
              totalDurationMs: totalDuration,
              viewport: { preset: viewportName, ...viewportSize },
              url: args.url,
              label: args.label ?? null,
              reducedMotion: args.reducedMotion ?? false,
              instruction:
                "Burst captured. Run compute_web_stability to analyze frame-to-frame SSIM " +
                "and detect jank. Or run generate_grid_collage to visually inspect all frames. " +
                "First and last frames shown below.",
            }),
          },
          { type: "text", text: "[FIRST FRAME]" },
          { type: "image", data: firstFrame, mimeType: "image/png" },
          { type: "text", text: "[LAST FRAME]" },
          { type: "image", data: lastFrame, mimeType: "image/png" },
        ];

        return content;
      } catch (err: any) {
        if (browser) {
          try {
            await browser.close();
          } catch {
            /* ignore cleanup */
          }
        }
        return {
          error: true,
          message: `Burst capture failed: ${err.message}`,
          url: args.url,
        };
      }
    },
  },

  // ─── Tool 2: generate_grid_collage ───
  {
    name: "generate_grid_collage",
    description:
      "Tile N screenshot images into a single grid collage PNG for visual inspection. " +
      "Accepts frame paths from burst_capture or any PNG files. Labels each cell with " +
      "its index and optional timestamp delta. Optionally highlights specific frames " +
      "with a red border (e.g. jank frames from compute_web_stability).",
    rawContent: true,
    inputSchema: {
      type: "object",
      properties: {
        framePaths: {
          type: "array",
          items: { type: "string" },
          description: "Array of PNG file paths to tile into the grid",
        },
        columns: {
          type: "number",
          description: "Grid columns (default: 5)",
        },
        cellWidth: {
          type: "number",
          description: "Width of each cell in pixels (default: 384)",
        },
        timestamps: {
          type: "array",
          items: { type: "number" },
          description:
            "Timestamps for delta labels (from burst_capture). If provided, each cell shows +Nms",
        },
        label: {
          type: "string",
          description: "Label for the collage (used in filename)",
        },
        highlightIndices: {
          type: "array",
          items: { type: "number" },
          description:
            "Frame indices to highlight with red border (e.g. jank frames)",
        },
        outputPath: {
          type: "string",
          description: "Custom output path for the collage PNG. Default: auto-generated in ~/.nodebench/captures/",
        },
      },
      required: ["framePaths"],
    },
    handler: async (args): Promise<RawToolResult> => {
      const sharp = await getSharp();
      if (!sharp) {
        return {
          error: true,
          message: "sharp is not installed. Run: npm install sharp",
        };
      }

      const paths: string[] = args.framePaths;
      if (!paths || paths.length === 0) {
        return {
          error: true,
          message: "framePaths is required and must be non-empty",
        };
      }

      const cols = args.columns ?? 5;
      const cellWidth = args.cellWidth ?? 384;
      const highlights = new Set<number>(args.highlightIndices ?? []);
      const timestamps: number[] | null = args.timestamps ?? null;
      const t0 = timestamps ? timestamps[0] : 0;

      try {
        // Get dimensions from first frame
        const firstMeta = await sharp(paths[0]).metadata();
        const aspectRatio = (firstMeta.height ?? 600) / (firstMeta.width ?? 800);
        const cellHeight = Math.round(cellWidth * aspectRatio);

        const rows = Math.ceil(paths.length / cols);
        const canvasWidth = cols * cellWidth;
        const canvasHeight = rows * cellHeight;

        // Resize all frames
        const resizedBuffers: Buffer[] = [];
        for (const p of paths) {
          const buf = await sharp(p)
            .resize(cellWidth, cellHeight, { fit: "fill" })
            .png()
            .toBuffer();
          resizedBuffers.push(buf);
        }

        // Build SVG overlay for labels and highlight borders
        let svgParts: string[] = [];
        for (let i = 0; i < paths.length; i++) {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = col * cellWidth;
          const y = row * cellHeight;

          // Frame index label
          const deltaText =
            timestamps && i < timestamps.length
              ? ` +${timestamps[i] - t0}ms`
              : "";
          svgParts.push(
            `<rect x="${x}" y="${y}" width="${Math.min(90, cellWidth)}" height="22" fill="rgba(0,0,0,0.7)" rx="3"/>`,
            `<text x="${x + 4}" y="${y + 16}" font-family="monospace" font-size="13" fill="white">#${i}${deltaText}</text>`
          );

          // Highlight border for jank frames
          if (highlights.has(i)) {
            svgParts.push(
              `<rect x="${x + 1}" y="${y + 1}" width="${cellWidth - 2}" height="${cellHeight - 2}" fill="none" stroke="red" stroke-width="4" rx="2"/>`
            );
          }
        }

        const overlaySvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">${svgParts.join("")}</svg>`;

        // Composite: create blank canvas, overlay each frame, then SVG labels
        const compositeInputs = resizedBuffers.map((buf, i) => ({
          input: buf,
          left: (i % cols) * cellWidth,
          top: Math.floor(i / cols) * cellHeight,
        }));

        // Add SVG overlay
        compositeInputs.push({
          input: Buffer.from(overlaySvg),
          left: 0,
          top: 0,
        });

        const collage = await sharp({
          create: {
            width: canvasWidth,
            height: canvasHeight,
            channels: 4,
            background: { r: 30, g: 30, b: 30, alpha: 1 },
          },
        })
          .composite(compositeInputs)
          .png()
          .toBuffer();

        // Save collage
        const captureDir = join(homedir(), ".nodebench", "captures");
        mkdirSync(captureDir, { recursive: true });
        const slug = args.label
          ? args.label.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()
          : "collage";
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const outputPath =
          args.outputPath ?? join(captureDir, `${slug}_grid_${ts}.png`);

        const { dirname } = await import("node:path");
        mkdirSync(dirname(outputPath), { recursive: true });
        await sharp(collage).toFile(outputPath);

        const base64 = collage.toString("base64");

        return [
          {
            type: "text",
            text: JSON.stringify({
              collagePath: outputPath,
              frames: paths.length,
              grid: `${cols}x${rows}`,
              cellSize: `${cellWidth}x${cellHeight}`,
              highlightedFrames: args.highlightIndices ?? [],
              instruction:
                "Grid collage generated. Red-bordered frames are jank frames. " +
                "Send this image to analyze_screenshot for AI-powered visual analysis, " +
                "or use diff_screenshots to compare against a baseline collage.",
            }),
          },
          { type: "image", data: base64, mimeType: "image/png" },
        ];
      } catch (err: any) {
        return {
          error: true,
          message: `Grid collage generation failed: ${err.message}`,
        };
      }
    },
  },

  // ─── Tool 3: compute_web_stability ───
  {
    name: "compute_web_stability",
    description:
      "Compute frame-to-frame stability metrics for a burst capture. Calculates " +
      "SSIM (Structural Similarity Index) between consecutive frames, detects jank " +
      "(frames where SSIM drops below threshold), estimates effective FPS from frame " +
      "deltas, and produces a stability score (0-100) with letter grade (A-F). All " +
      "computation in Node using sharp — no Python server required. " +
      "Score >= 90 = A (smooth), 80-89 = B, 70-79 = C (noticeable jank), < 70 = D/F.",
    inputSchema: {
      type: "object",
      properties: {
        framePaths: {
          type: "array",
          items: { type: "string" },
          description: "Array of PNG frame paths (from burst_capture)",
        },
        timestamps: {
          type: "array",
          items: { type: "number" },
          description:
            "Timestamps in ms for each frame (from burst_capture). Used for FPS and delta calculations.",
        },
        ssimThreshold: {
          type: "number",
          description:
            "SSIM threshold for jank detection (default: 0.95). Lower = more tolerant of change. " +
            "Use 0.90 for pages with intentional animations, 0.98 for static pages.",
        },
        label: {
          type: "string",
          description: "Label for this analysis (persisted to DB)",
        },
        url: {
          type: "string",
          description: "Source URL (for DB persistence)",
        },
      },
      required: ["framePaths"],
    },
    handler: async (args) => {
      const sharp = await getSharp();
      if (!sharp) {
        return {
          error: true,
          message: "sharp is not installed. Run: npm install sharp",
        };
      }

      const paths: string[] = args.framePaths;
      if (!paths || paths.length < 2) {
        return {
          error: true,
          message: "framePaths must contain at least 2 frames",
        };
      }

      const threshold = args.ssimThreshold ?? 0.95;
      const timestamps: number[] | null = args.timestamps ?? null;

      try {
        // Load all frames as raw RGBA buffers at a common resolution
        const firstMeta = await sharp(paths[0]).metadata();
        const width = firstMeta.width!;
        const height = firstMeta.height!;

        const luminances: Float64Array[] = [];
        for (const p of paths) {
          const raw = await sharp(p)
            .resize(width, height, { fit: "fill" })
            .raw()
            .ensureAlpha()
            .toBuffer();
          luminances.push(toLuminance(raw, width, height));
        }

        // Compute pairwise SSIM
        const ssimScores: number[] = [];
        for (let i = 0; i < luminances.length - 1; i++) {
          const ssim = computeSSIM(luminances[i], luminances[i + 1], width, height);
          ssimScores.push(Math.round(ssim * 10000) / 10000);
        }

        // Jank detection
        const jankFrames: number[] = [];
        for (let i = 0; i < ssimScores.length; i++) {
          if (ssimScores[i] < threshold) {
            jankFrames.push(i);
          }
        }

        const meanSsim =
          ssimScores.reduce((a, b) => a + b, 0) / ssimScores.length;
        const minSsim = Math.min(...ssimScores);

        // Frame timing metrics
        let frameDeltasMs: number[] = [];
        let effectiveFps = 0;
        let deltaVariance = 0;

        if (timestamps && timestamps.length === paths.length) {
          for (let i = 0; i < timestamps.length - 1; i++) {
            frameDeltasMs.push(timestamps[i + 1] - timestamps[i]);
          }
          const meanDelta =
            frameDeltasMs.reduce((a, b) => a + b, 0) / frameDeltasMs.length;
          effectiveFps = meanDelta > 0 ? Math.round((1000 / meanDelta) * 10) / 10 : 0;
          deltaVariance =
            Math.round(
              (frameDeltasMs.reduce(
                (sum, d) => sum + (d - meanDelta) ** 2,
                0
              ) /
                frameDeltasMs.length) *
                100
            ) / 100;
        }

        // Stability score: weight SSIM and jank ratio
        const jankRatio = jankFrames.length / ssimScores.length;
        const score = Math.round(100 * (1 - jankRatio) * meanSsim);
        const grade = stabilityGrade(score);

        // Persist to DB
        try {
          ensureVisualQaTable();
          const db = getDb();
          const id = genId("vqa");
          db.prepare(
            `INSERT INTO visual_qa_runs (id, url, label, viewport, frame_count, interval_ms,
             stability_score, stability_grade, mean_ssim, jank_count, effective_fps, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            id,
            args.url ?? "unknown",
            args.label ?? null,
            "desktop",
            paths.length,
            timestamps
              ? Math.round(
                  (timestamps[timestamps.length - 1] - timestamps[0]) /
                    (paths.length - 1)
                )
              : 50,
            score,
            grade,
            Math.round(meanSsim * 10000) / 10000,
            jankFrames.length,
            effectiveFps,
            JSON.stringify({ ssimScores, jankFrames, frameDeltasMs })
          );
        } catch {
          /* DB persistence is best-effort */
        }

        const summary =
          jankFrames.length === 0
            ? `Stability: ${grade} (${score}/100). All ${ssimScores.length} frame transitions are smooth (mean SSIM ${meanSsim.toFixed(4)}).`
            : `Stability: ${grade} (${score}/100). Detected ${jankFrames.length} jank frame(s) at indices [${jankFrames.join(", ")}] ` +
              `(SSIM < ${threshold}). Min SSIM: ${minSsim.toFixed(4)}, Mean: ${meanSsim.toFixed(4)}.` +
              (effectiveFps > 0 ? ` Effective capture rate: ${effectiveFps} fps.` : "");

        return {
          ssimScores,
          meanSsim: Math.round(meanSsim * 10000) / 10000,
          minSsim: Math.round(minSsim * 10000) / 10000,
          jankFrames,
          jankCount: jankFrames.length,
          effectiveFps,
          frameDeltasMs,
          deltaVariance,
          stabilityScore: score,
          stabilityGrade: grade,
          threshold,
          frameCount: paths.length,
          resolution: `${width}x${height}`,
          summary,
        };
      } catch (err: any) {
        return {
          error: true,
          message: `Stability analysis failed: ${err.message}`,
        };
      }
    },
  },

  // ─── Tool 4: run_visual_qa_suite ───
  {
    name: "run_visual_qa_suite",
    description:
      "End-to-end visual QA pipeline: burst capture → SSIM stability analysis → " +
      "grid collage with jank frames highlighted. Runs against a single URL. Returns " +
      "stability score/grade, grid collage image, and jank details. Combine with " +
      "diff_screenshots for regression detection against baselines. This is the " +
      "recommended entry point for visual QA — it chains burst_capture, " +
      "compute_web_stability, and generate_grid_collage in one call.",
    rawContent: true,
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to run visual QA against",
        },
        label: {
          type: "string",
          description: "Label for this QA run (e.g. 'cinematic-home', 'dashboard')",
        },
        frameCount: {
          type: "number",
          description: "Number of frames (default: 10)",
        },
        intervalMs: {
          type: "number",
          description: "Interval between frames in ms (default: 50)",
        },
        viewport: {
          type: "string",
          enum: ["mobile", "tablet", "desktop", "wide"],
          description: "Viewport preset (default: desktop)",
        },
        preAction: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["click", "scroll", "navigate", "wait"] },
            target: { type: "string" },
            value: { type: "string" },
          },
          description: "Action to perform before burst starts",
        },
        settleMs: {
          type: "number",
          description: "Wait time after page load (default: 500)",
        },
        ssimThreshold: {
          type: "number",
          description: "SSIM threshold for jank detection (default: 0.95)",
        },
        reducedMotion: {
          type: "boolean",
          description: "Set prefers-reduced-motion:reduce (default: false)",
        },
        clearCache: {
          type: "boolean",
          description:
            "Clear browser cache/cookies/localStorage before navigating (default: false). " +
            "Simulates cold first-load for detecting loading jank.",
        },
        waitUntil: {
          type: "string",
          enum: ["networkidle", "commit", "domcontentloaded", "load"],
          description:
            "Navigation wait strategy (default: networkidle). Use 'commit' for cold-load analysis.",
        },
        collageColumns: {
          type: "number",
          description: "Grid columns for collage (default: 5)",
        },
      },
      required: ["url"],
    },
    handler: async (args): Promise<RawToolResult> => {
      const pw = await getPlaywright();
      if (!pw) {
        return {
          error: true,
          message:
            "Playwright is not installed. Run: npm install playwright && npx playwright install chromium",
        };
      }

      const sharpMod = await getSharp();
      if (!sharpMod) {
        return {
          error: true,
          message: "sharp is not installed. Run: npm install sharp",
        };
      }

      // Step 1: Burst capture (inline — reuse logic from burst_capture)
      const frameCount = Math.min(Math.max(args.frameCount ?? 10, 2), 30);
      const intervalMs = Math.max(args.intervalMs ?? 50, 16);
      const settleMs = args.settleMs ?? 500;
      const viewportName = args.viewport ?? "desktop";
      const viewportSize = VIEWPORT_PRESETS[viewportName];
      const threshold = args.ssimThreshold ?? 0.95;
      const waitUntil = args.waitUntil ?? "networkidle";

      if (!viewportSize) {
        return {
          error: true,
          message: `Unknown viewport: ${viewportName}`,
        };
      }

      const burstDir = ensureBurstDir(args.label ?? "suite");
      const framePaths: string[] = [];
      const timestamps: number[] = [];

      let browser;
      try {
        browser = await pw.chromium.launch({ headless: true });
        const contextOptions: any = { viewport: viewportSize };
        if (args.reducedMotion) {
          contextOptions.reducedMotion = "reduce";
        }

        const context = await browser.newContext(contextOptions);

        // Clear cache if requested (simulate cold first-load)
        if (args.clearCache) {
          await context.clearCookies();
          const page0 = await context.newPage();
          try {
            const cdp = await page0.context().newCDPSession(page0);
            await cdp.send("Network.clearBrowserCache");
            await cdp.send("Network.clearBrowserCookies");
            await page0.evaluate(() => {
              try { localStorage.clear(); } catch {}
              try { sessionStorage.clear(); } catch {}
              try {
                const w = globalThis as any;
                if (w.caches) w.caches.keys().then((keys: string[]) => keys.forEach((k: string) => w.caches.delete(k)));
              } catch {}
            });
          } catch { /* CDP best-effort */ }
          await page0.close();
        }

        const page = await context.newPage();

        await page.goto(args.url, {
          waitUntil: waitUntil as any,
          timeout: 30000,
        });

        if (settleMs > 0) await page.waitForTimeout(settleMs);

        if (args.preAction) {
          const pa = args.preAction;
          switch (pa.type) {
            case "click":
              if (pa.target) await page.click(pa.target, { timeout: 5000 });
              break;
            case "scroll":
              await page.evaluate(
                (amount: number) => (globalThis as any).scrollBy(0, amount),
                parseInt(pa.value ?? "500", 10)
              );
              break;
            case "navigate":
              if (pa.target)
                await page.goto(pa.target, {
                  waitUntil: "networkidle",
                  timeout: 15000,
                });
              break;
            case "wait":
              await page.waitForTimeout(parseInt(pa.value ?? "1000", 10));
              break;
          }
          await page.waitForTimeout(100);
        }

        for (let i = 0; i < frameCount; i++) {
          const framePath = join(
            burstDir,
            `frame_${String(i).padStart(3, "0")}.png`
          );
          timestamps.push(Date.now());
          await page.screenshot({ path: framePath, fullPage: false });
          framePaths.push(framePath);
          if (i < frameCount - 1) {
            await page.waitForTimeout(intervalMs);
          }
        }

        await browser.close();
        browser = null;

        // Step 2: SSIM stability analysis
        const firstMeta = await sharpMod(framePaths[0]).metadata();
        const width = firstMeta.width!;
        const height = firstMeta.height!;

        const luminances: Float64Array[] = [];
        for (const p of framePaths) {
          const raw = await sharpMod(p)
            .resize(width, height, { fit: "fill" })
            .raw()
            .ensureAlpha()
            .toBuffer();
          luminances.push(toLuminance(raw, width, height));
        }

        const ssimScores: number[] = [];
        for (let i = 0; i < luminances.length - 1; i++) {
          ssimScores.push(
            Math.round(
              computeSSIM(luminances[i], luminances[i + 1], width, height) *
                10000
            ) / 10000
          );
        }

        const jankFrames: number[] = [];
        for (let i = 0; i < ssimScores.length; i++) {
          if (ssimScores[i] < threshold) jankFrames.push(i);
        }

        const meanSsim =
          ssimScores.reduce((a, b) => a + b, 0) / ssimScores.length;
        const minSsim = Math.min(...ssimScores);
        const jankRatio = jankFrames.length / ssimScores.length;
        const score = Math.round(100 * (1 - jankRatio) * meanSsim);
        const grade = stabilityGrade(score);

        // Frame timing
        const frameDeltasMs: number[] = [];
        for (let i = 0; i < timestamps.length - 1; i++) {
          frameDeltasMs.push(timestamps[i + 1] - timestamps[i]);
        }
        const meanDelta =
          frameDeltasMs.length > 0
            ? frameDeltasMs.reduce((a, b) => a + b, 0) / frameDeltasMs.length
            : 50;
        const effectiveFps =
          meanDelta > 0 ? Math.round((1000 / meanDelta) * 10) / 10 : 0;

        // Persist to DB
        try {
          ensureVisualQaTable();
          const db = getDb();
          const id = genId("vqa");
          db.prepare(
            `INSERT INTO visual_qa_runs (id, url, label, viewport, frame_count, interval_ms,
             stability_score, stability_grade, mean_ssim, jank_count, effective_fps, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            id,
            args.url,
            args.label ?? null,
            viewportName,
            frameCount,
            Math.round(meanDelta),
            score,
            grade,
            Math.round(meanSsim * 10000) / 10000,
            jankFrames.length,
            effectiveFps,
            JSON.stringify({ ssimScores, jankFrames, frameDeltasMs })
          );
        } catch {
          /* best-effort */
        }

        // Step 3: Grid collage
        const cols = args.collageColumns ?? 5;
        const cellWidth = 384;
        const aspectRatio = height / width;
        const cellHeight = Math.round(cellWidth * aspectRatio);
        const gridRows = Math.ceil(framePaths.length / cols);
        const canvasWidth = cols * cellWidth;
        const canvasHeight = gridRows * cellHeight;
        const highlights = new Set(jankFrames);

        const resizedBuffers: Buffer[] = [];
        for (const p of framePaths) {
          resizedBuffers.push(
            await sharpMod(p)
              .resize(cellWidth, cellHeight, { fit: "fill" })
              .png()
              .toBuffer()
          );
        }

        let svgParts: string[] = [];
        const t0 = timestamps[0];
        for (let i = 0; i < framePaths.length; i++) {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = col * cellWidth;
          const y = row * cellHeight;
          const delta = timestamps[i] - t0;

          svgParts.push(
            `<rect x="${x}" y="${y}" width="90" height="22" fill="rgba(0,0,0,0.7)" rx="3"/>`,
            `<text x="${x + 4}" y="${y + 16}" font-family="monospace" font-size="13" fill="white">#${i} +${delta}ms</text>`
          );

          if (highlights.has(i)) {
            svgParts.push(
              `<rect x="${x + 1}" y="${y + 1}" width="${cellWidth - 2}" height="${cellHeight - 2}" fill="none" stroke="red" stroke-width="4" rx="2"/>`
            );
          }

          // Show SSIM score on frames that have one (all except last)
          if (i < ssimScores.length) {
            const ssimColor = ssimScores[i] < threshold ? "#ff4444" : "#44ff44";
            svgParts.push(
              `<rect x="${x}" y="${y + 22}" width="80" height="18" fill="rgba(0,0,0,0.7)" rx="3"/>`,
              `<text x="${x + 4}" y="${y + 36}" font-family="monospace" font-size="11" fill="${ssimColor}">SSIM:${ssimScores[i].toFixed(3)}</text>`
            );
          }
        }

        const overlaySvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">${svgParts.join("")}</svg>`;

        const compositeInputs: any[] = resizedBuffers.map((buf, i) => ({
          input: buf,
          left: (i % cols) * cellWidth,
          top: Math.floor(i / cols) * cellHeight,
        }));
        compositeInputs.push({
          input: Buffer.from(overlaySvg),
          left: 0,
          top: 0,
        });

        const collage = await sharpMod({
          create: {
            width: canvasWidth,
            height: canvasHeight,
            channels: 4,
            background: { r: 30, g: 30, b: 30, alpha: 1 },
          },
        })
          .composite(compositeInputs)
          .png()
          .toBuffer();

        // Save collage
        const captureDir = join(homedir(), ".nodebench", "captures");
        mkdirSync(captureDir, { recursive: true });
        const slug = (args.label ?? "suite")
          .replace(/[^a-zA-Z0-9-_]/g, "-")
          .toLowerCase();
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const collagePath = join(captureDir, `${slug}_qa_${ts}.png`);
        await sharpMod(collage).toFile(collagePath);

        const base64 = collage.toString("base64");

        const summary =
          jankFrames.length === 0
            ? `Visual QA: ${grade} (${score}/100). All ${ssimScores.length} transitions smooth (mean SSIM ${meanSsim.toFixed(4)}). No jank detected.`
            : `Visual QA: ${grade} (${score}/100). ${jankFrames.length} jank frame(s) at [${jankFrames.join(", ")}]. ` +
              `Min SSIM: ${minSsim.toFixed(4)}, Mean: ${meanSsim.toFixed(4)}. ` +
              `Red-bordered frames in collage below show where instability occurred.`;

        const content: ContentBlock[] = [
          {
            type: "text",
            text: JSON.stringify({
              stabilityScore: score,
              stabilityGrade: grade,
              meanSsim: Math.round(meanSsim * 10000) / 10000,
              minSsim: Math.round(minSsim * 10000) / 10000,
              jankFrames,
              jankCount: jankFrames.length,
              effectiveFps,
              ssimScores,
              frameDeltasMs,
              threshold,
              frameCount,
              burstDir,
              collagePath,
              url: args.url,
              viewport: viewportName,
              summary,
              instruction:
                jankFrames.length > 0
                  ? "Jank detected. Inspect the red-bordered frames in the collage below. " +
                    "Consider running with reducedMotion:true to compare, or use " +
                    "analyze_screenshot on the collage for AI analysis of the visual issues."
                  : "No jank detected. Save the collage as a baseline for future regression detection " +
                    "using diff_screenshots.",
            }),
          },
          { type: "image", data: base64, mimeType: "image/png" },
        ];

        return content;
      } catch (err: any) {
        if (browser) {
          try {
            await browser.close();
          } catch {
            /* ignore */
          }
        }
        return {
          error: true,
          message: `Visual QA suite failed: ${err.message}`,
          url: args.url,
        };
      }
    },
  },
];
