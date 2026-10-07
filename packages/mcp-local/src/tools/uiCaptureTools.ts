/**
 * UI Capture tools — headless browser screenshot capture for visual verification.
 * Uses Playwright (optional dependency) to open a URL, capture screenshots at
 * specified viewports, and collect console errors. Returns screenshots as base64
 * image content blocks so multimodal agents can visually inspect the UI directly.
 */

import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync, readFileSync } from "fs";
import type { McpTool, ContentBlock, RawToolResult } from "../types.js";

// Screenshot storage directory
const CAPTURE_DIR = join(homedir(), ".nodebench", "captures");

function ensureCaptureDir(): string {
  if (!existsSync(CAPTURE_DIR)) {
    mkdirSync(CAPTURE_DIR, { recursive: true });
  }
  return CAPTURE_DIR;
}

/**
 * Dynamically import playwright. Returns null if not installed.
 */
async function getPlaywright(): Promise<typeof import("playwright") | null> {
  try {
    return await import("playwright");
  } catch {
    return null;
  }
}

const VIEWPORT_PRESETS: Record<string, { width: number; height: number }> = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
  wide: { width: 1920, height: 1080 },
};

export const uiCaptureTools: McpTool[] = [
  {
    name: "capture_ui_screenshot",
    description:
      "Capture a screenshot of a URL using headless Playwright. Returns the screenshot as an inline image that multimodal agents can see and evaluate directly. Also captures browser console errors. Supports viewport presets (mobile/tablet/desktop/wide) or custom dimensions. Requires Playwright to be installed in the project.",
    rawContent: true,
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "URL to capture (e.g. http://localhost:3000, http://localhost:6006 for Storybook)",
        },
        viewport: {
          type: "string",
          enum: ["mobile", "tablet", "desktop", "wide", "custom"],
          description:
            "Viewport preset: mobile (375×812), tablet (768×1024), desktop (1280×800), wide (1920×1080), or custom",
        },
        width: {
          type: "number",
          description: "Custom viewport width (only used when viewport is 'custom')",
        },
        height: {
          type: "number",
          description: "Custom viewport height (only used when viewport is 'custom')",
        },
        fullPage: {
          type: "boolean",
          description: "Capture full scrollable page (default: true)",
        },
        waitForSelector: {
          type: "string",
          description:
            "Optional CSS selector to wait for before capturing (e.g. '[data-testid=\"main-content\"]')",
        },
        waitMs: {
          type: "number",
          description:
            "Additional wait time in ms after page load (default: 1000). Useful for animations or lazy-loaded content.",
        },
        label: {
          type: "string",
          description:
            "Human-readable label for the capture (used in filename, e.g. 'agent-status-card-mobile')",
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
            "Playwright is not installed. Install it with: npm install playwright && npx playwright install chromium",
          suggestion:
            "The capture_ui_screenshot tool requires Playwright for headless browser automation. " +
            "Run `npm install playwright` in your project, then `npx playwright install chromium` to download the browser binary.",
        };
      }

      const viewportName = args.viewport ?? "desktop";
      let viewportSize: { width: number; height: number };

      if (viewportName === "custom") {
        if (!args.width || !args.height) {
          throw new Error(
            "Custom viewport requires both 'width' and 'height' parameters"
          );
        }
        viewportSize = { width: args.width, height: args.height };
      } else {
        viewportSize = VIEWPORT_PRESETS[viewportName];
        if (!viewportSize) {
          throw new Error(
            `Unknown viewport: ${viewportName}. Use: mobile, tablet, desktop, wide, or custom`
          );
        }
      }

      const fullPage = args.fullPage !== false;
      const waitMs = args.waitMs ?? 1000;
      const captureDir = ensureCaptureDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const labelSlug = args.label
        ? args.label.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()
        : "capture";
      const filename = `${labelSlug}_${viewportName}_${timestamp}.png`;
      const filepath = join(captureDir, filename);

      const consoleErrors: string[] = [];

      let browser;
      try {
        browser = await pw.chromium.launch({ headless: true });
        const context = await browser.newContext({ viewport: viewportSize });
        const page = await context.newPage();

        page.on("console", (msg) => {
          if (msg.type() === "error" || msg.type() === "warning") {
            consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
          }
        });
        page.on("pageerror", (err) => {
          consoleErrors.push(`[pageerror] ${err.message}`);
        });

        await page.goto(args.url, { waitUntil: "networkidle", timeout: 30000 });

        if (args.waitForSelector) {
          await page.waitForSelector(args.waitForSelector, { timeout: 10000 });
        }

        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }

        await page.screenshot({ path: filepath, fullPage });
        await browser.close();
        browser = null;

        // Read screenshot as base64
        const imageBuffer = readFileSync(filepath);
        const base64 = imageBuffer.toString("base64");

        // Build content blocks: metadata text + inline image
        const content: ContentBlock[] = [
          {
            type: "text",
            text: JSON.stringify({
              url: args.url,
              viewport: { preset: viewportName, ...viewportSize },
              filepath,
              fullPage,
              consoleErrorCount: consoleErrors.length,
              consoleErrors: consoleErrors.slice(0, 20),
              instruction:
                consoleErrors.length > 0
                  ? `Screenshot captured. Found ${consoleErrors.length} console error(s) — review them and fix before passing the no_console_errors gate.`
                  : "Screenshot captured with zero console errors. Visually inspect the image below to verify layout, spacing, and component rendering.",
            }),
          },
          {
            type: "image",
            data: base64,
            mimeType: "image/png",
          },
        ];

        return content;
      } catch (err: any) {
        if (browser) {
          try {
            await browser.close();
          } catch {
            // ignore cleanup error
          }
        }
        return {
          error: true,
          message: `Screenshot capture failed: ${err.message}`,
          url: args.url,
          viewport: viewportName,
          suggestion:
            "Ensure the URL is accessible. If capturing localhost, make sure the dev server is running.",
        };
      }
    },
  },
  {
    name: "capture_responsive_suite",
    description:
      "Capture screenshots at all 3 standard responsive breakpoints (mobile 375px, tablet 768px, desktop 1280px) in one call. Returns all 3 screenshots as inline images that multimodal agents can see and compare side-by-side. Also captures console errors per viewport. Use this after UI implementations to quickly verify responsive behavior.",
    rawContent: true,
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to capture at all breakpoints",
        },
        label: {
          type: "string",
          description:
            "Component/feature label (e.g. 'agent-status-card'). Used in filenames.",
        },
        waitForSelector: {
          type: "string",
          description: "Optional CSS selector to wait for before each capture",
        },
        waitMs: {
          type: "number",
          description: "Additional wait time in ms after load (default: 1000)",
        },
      },
      required: ["url", "label"],
    },
    handler: async (args): Promise<RawToolResult> => {
      const pw = await getPlaywright();
      if (!pw) {
        return {
          error: true,
          message:
            "Playwright is not installed. Install it with: npm install playwright && npx playwright install chromium",
        };
      }

      const waitMs = args.waitMs ?? 1000;
      const captureDir = ensureCaptureDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const labelSlug = args.label
        .replace(/[^a-zA-Z0-9-_]/g, "-")
        .toLowerCase();

      const breakpoints = [
        { name: "mobile", ...VIEWPORT_PRESETS.mobile },
        { name: "tablet", ...VIEWPORT_PRESETS.tablet },
        { name: "desktop", ...VIEWPORT_PRESETS.desktop },
      ];

      const content: ContentBlock[] = [];
      const captureResults: Array<{
        breakpoint: string;
        viewport: string;
        filepath: string;
        consoleErrorCount: number;
        consoleErrors: string[];
      }> = [];

      let browser;
      try {
        browser = await pw.chromium.launch({ headless: true });

        for (const bp of breakpoints) {
          const consoleErrors: string[] = [];
          const context = await browser.newContext({
            viewport: { width: bp.width, height: bp.height },
          });
          const page = await context.newPage();

          page.on("console", (msg) => {
            if (msg.type() === "error" || msg.type() === "warning") {
              consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
            }
          });
          page.on("pageerror", (err) => {
            consoleErrors.push(`[pageerror] ${err.message}`);
          });

          await page.goto(args.url, { waitUntil: "networkidle", timeout: 30000 });

          if (args.waitForSelector) {
            await page.waitForSelector(args.waitForSelector, { timeout: 10000 });
          }

          if (waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }

          const filename = `${labelSlug}_${bp.name}_${timestamp}.png`;
          const filepath = join(captureDir, filename);

          await page.screenshot({ path: filepath, fullPage: true });
          await context.close();

          // Read screenshot as base64
          const imageBuffer = readFileSync(filepath);
          const base64 = imageBuffer.toString("base64");

          captureResults.push({
            breakpoint: bp.name,
            viewport: `${bp.width}×${bp.height}`,
            filepath,
            consoleErrorCount: consoleErrors.length,
            consoleErrors: consoleErrors.slice(0, 10),
          });

          // Add label text + image for this breakpoint
          content.push({
            type: "text",
            text: `[${bp.name.toUpperCase()} ${bp.width}×${bp.height}] ${consoleErrors.length === 0 ? "0 console errors" : `${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).join("; ")}`}`,
          });
          content.push({
            type: "image",
            data: base64,
            mimeType: "image/png",
          });
        }

        await browser.close();
        browser = null;

        const totalErrors = captureResults.reduce(
          (sum, r) => sum + r.consoleErrorCount,
          0
        );

        // Add summary as the first content block
        content.unshift({
          type: "text",
          text: JSON.stringify({
            url: args.url,
            label: args.label,
            captures: captureResults,
            summary: {
              totalCaptures: captureResults.length,
              totalConsoleErrors: totalErrors,
              allClean: totalErrors === 0,
            },
            instruction:
              totalErrors > 0
                ? `Captured ${captureResults.length} breakpoints. Found ${totalErrors} console error(s) — fix before gating. Inspect the images below to verify responsive layout.`
                : `Captured ${captureResults.length} breakpoints with zero console errors. Inspect the images below to verify responsive layout at each breakpoint.`,
          }),
        });

        return content;
      } catch (err: any) {
        if (browser) {
          try {
            await browser.close();
          } catch {
            // ignore cleanup error
          }
        }
        return {
          error: true,
          message: `Responsive capture failed: ${err.message}`,
          url: args.url,
          suggestion:
            "Ensure the URL is accessible and the dev server is running.",
        };
      }
    },
  },
];
