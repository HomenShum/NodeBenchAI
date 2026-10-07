import { test, expect } from '@playwright/test';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

// ============================================================
// Visual Stability Audit — Burst capture + SSIM scoring
// Captures sequential frames at each critical route to detect
// animation jank, flicker, and loading smoothness issues.
// ============================================================

const STABILITY_DIR = join(process.cwd(), 'tests', 'fixtures', 'screenshots', 'stability');

// Critical routes to audit (heaviest animation/loading routes).
// Kept in sync with dogfood-visual-qa.mts ROUTES.
const STABILITY_ROUTES = [
  { path: '/', name: 'cinematic-home', settleMs: 3000 },
  { path: '/research', name: 'research-hub', settleMs: 2000 },
  { path: '/documents', name: 'documents', settleMs: 1500 },
  { path: '/agents', name: 'agents', settleMs: 2000 },
  { path: '/developers', name: 'developers', settleMs: 2000 },
  // Added: views modified in Feb 2026 dark mode / analytics sweep
  { path: '/funding', name: 'funding-brief', settleMs: 2000 },
  { path: '/analytics-recommendations', name: 'analytics-recommendations', settleMs: 2000 },
  { path: '/analytics-components', name: 'analytics-components', settleMs: 2000 },
  { path: '/mcp-ledger', name: 'mcp-ledger', settleMs: 1500 },
  { path: '/dogfood', name: 'dogfood', settleMs: 2000 },
];

const FRAME_COUNT = 10;
const INTERVAL_MS = 50; // 50ms × 10 = 500ms burst
const SSIM_THRESHOLD = 0.92; // Pages with animations settle above this
const MAX_DELTA_SPIKE = 3; // No frame delta > 3× median

/**
 * Compute luminance from RGBA pixel buffer.
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
 * Compute SSIM between two luminance arrays using 8×8 block windows.
 */
function computeSSIM(lumA: Float64Array, lumB: Float64Array, width: number, height: number): number {
  const BLOCK = 8;
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const blocksX = Math.floor(width / BLOCK);
  const blocksY = Math.floor(height / BLOCK);
  if (blocksX === 0 || blocksY === 0) return 1.0;

  let total = 0;
  let count = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      let sA = 0, sB = 0, sA2 = 0, sB2 = 0, sAB = 0;
      const n = BLOCK * BLOCK;
      for (let dy = 0; dy < BLOCK; dy++) {
        for (let dx = 0; dx < BLOCK; dx++) {
          const idx = (by * BLOCK + dy) * width + (bx * BLOCK + dx);
          const a = lumA[idx], b = lumB[idx];
          sA += a; sB += b; sA2 += a * a; sB2 += b * b; sAB += a * b;
        }
      }
      const muA = sA / n, muB = sB / n;
      const varA = sA2 / n - muA * muA;
      const varB = sB2 / n - muB * muB;
      const cov = sAB / n - muA * muB;
      total += ((2 * muA * muB + C1) * (2 * cov + C2)) / ((muA * muA + muB * muB + C1) * (varA + varB + C2));
      count++;
    }
  }
  return count > 0 ? total / count : 1.0;
}

test.describe('Visual Stability Audit', () => {
  test.beforeAll(() => {
    mkdirSync(STABILITY_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    // Sign in anonymously for authenticated routes
    await page.addInitScript(() => {
      localStorage.setItem('nodebench-theme', JSON.stringify({
        mode: 'dark',
        accentColor: 'indigo',
        density: 'comfortable',
        fontFamily: 'Inter',
        backgroundPattern: 'none',
        reducedMotion: false,
      }));
    });
  });

  for (const route of STABILITY_ROUTES) {
    test(`stability: ${route.name} (SSIM >= ${SSIM_THRESHOLD})`, async ({ page }) => {
      let sharp: any;
      try {
        sharp = (await import('sharp')).default;
      } catch {
        test.skip(true, 'sharp not installed — required for SSIM computation');
        return;
      }

      // Navigate and settle
      await page.goto(route.path, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(route.settleMs);

      // Burst capture: N frames at fixed intervals
      const frameBuffers: Buffer[] = [];
      const timestamps: number[] = [];

      for (let i = 0; i < FRAME_COUNT; i++) {
        timestamps.push(Date.now());
        const buf = await page.screenshot({ type: 'png', fullPage: false });
        frameBuffers.push(buf);
        if (i < FRAME_COUNT - 1) {
          await page.waitForTimeout(INTERVAL_MS);
        }
      }

      // Get dimensions from first frame
      const meta = await sharp(frameBuffers[0]).metadata();
      const width = meta.width!;
      const height = meta.height!;

      // Convert all frames to luminance
      const luminances: Float64Array[] = [];
      for (const buf of frameBuffers) {
        const raw = await sharp(buf).resize(width, height, { fit: 'fill' }).raw().ensureAlpha().toBuffer();
        luminances.push(toLuminance(raw, width, height));
      }

      // Compute pairwise SSIM
      const ssimScores: number[] = [];
      for (let i = 0; i < luminances.length - 1; i++) {
        ssimScores.push(computeSSIM(luminances[i], luminances[i + 1], width, height));
      }

      const meanSSIM = ssimScores.reduce((a, b) => a + b, 0) / ssimScores.length;
      const minSSIM = Math.min(...ssimScores);

      // Frame timing analysis
      const deltas: number[] = [];
      for (let i = 0; i < timestamps.length - 1; i++) {
        deltas.push(timestamps[i + 1] - timestamps[i]);
      }
      const medianDelta = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
      const maxDelta = Math.max(...deltas);

      // Save first+last frames for visual reference
      const firstPath = join(STABILITY_DIR, `${route.name}_first.png`);
      const lastPath = join(STABILITY_DIR, `${route.name}_last.png`);
      await sharp(frameBuffers[0]).toFile(firstPath);
      await sharp(frameBuffers[frameBuffers.length - 1]).toFile(lastPath);

      // Log results
      console.log(`[${route.name}] Mean SSIM: ${meanSSIM.toFixed(4)}, Min: ${minSSIM.toFixed(4)}, ` +
        `Median delta: ${medianDelta}ms, Max delta: ${maxDelta}ms`);

      // Assertions
      expect(
        meanSSIM,
        `${route.name}: Mean SSIM ${meanSSIM.toFixed(4)} below threshold ${SSIM_THRESHOLD}. ` +
        `SSIM scores: [${ssimScores.map(s => s.toFixed(3)).join(', ')}]`
      ).toBeGreaterThanOrEqual(SSIM_THRESHOLD);

      expect(
        maxDelta,
        `${route.name}: Frame delta spike ${maxDelta}ms exceeds ${MAX_DELTA_SPIKE}× median (${medianDelta}ms). ` +
        `Possible jank or stall during capture.`
      ).toBeLessThanOrEqual(medianDelta * MAX_DELTA_SPIKE);
    });
  }
});
