#!/usr/bin/env node
/**
 * bootstrapFigmaDesignSystem.mjs — Create the NodeBench Design System file in Figma
 *
 * This script extracts all design tokens from apps/web/src/index.css and creates a
 * structured Figma design system file via the Figma REST API.
 *
 * Prerequisites:
 *   FIGMA_ACCESS_TOKEN in .env.local (get one at https://www.figma.com/developers/api#access-tokens)
 *
 * Usage:
 *   node scripts/design/bootstrapFigmaDesignSystem.mjs
 *   node scripts/design/bootstrapFigmaDesignSystem.mjs --dry-run    # Preview without Figma API calls
 *   node scripts/design/bootstrapFigmaDesignSystem.mjs --json       # Output token manifest as JSON
 *
 * What it does:
 * 1. Parses apps/web/src/index.css to extract all CSS custom properties (light + dark)
 * 2. Parses type scale classes (.type-*) and component classes (.nb-*, .btn-*)
 * 3. Generates a structured manifest of all design tokens
 * 4. Creates Figma variables via the Variables API (POST /v1/files/:key/variables)
 * 5. Updates figmaSync.ts with the file key
 *
 * The manifest follows the 4-page structure defined in figmaSync.ts:
 *   Page 1: Color Palette (all CSS custom properties, light + dark modes)
 *   Page 2: Typography (6 .type-* styles)
 *   Page 3: Components (page-shell, surface-card, buttons, SignatureOrb, EmptyState)
 *   Page 4: Page Templates (hub 3-col, detail 2-col, fullscreen)
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  DESIGN_TOKEN_SOURCE,
  resolveDesignTokenPath,
} from "../lib/standardTreePaths.mjs";

// ── CLI Args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const jsonOutput = args.includes("--json");
const figmaFileIdx = args.indexOf("--figma-file");
const figmaFileKey = figmaFileIdx >= 0 ? args[figmaFileIdx + 1] : null;

// ── Load env from .env.local ──────────────────────────────────────────
async function loadEnv() {
  try {
    const envPath = path.join(process.cwd(), ".env.local");
    const content = await fs.readFile(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env.local is optional
  }
}

// ── Parse CSS tokens ──────────────────────────────────────────────────

/**
 * Extract all CSS custom properties from :root and .dark blocks
 */
async function extractColorTokens() {
  const cssPath = resolveDesignTokenPath(process.cwd());
  const css = await fs.readFile(cssPath, "utf8");

  const tokens = { light: {}, dark: {} };
  const varRegex = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+)/g;

  // :root tokens
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/s);
  if (rootMatch) {
    let m;
    while ((m = varRegex.exec(rootMatch[1])) !== null) {
      tokens.light[m[1]] = m[2].trim();
    }
  }

  // .dark tokens
  const darkMatch = css.match(/\.dark\s*\{([^}]+)\}/s);
  if (darkMatch) {
    varRegex.lastIndex = 0;
    let m;
    while ((m = varRegex.exec(darkMatch[1])) !== null) {
      tokens.dark[m[1]] = m[2].trim();
    }
  }

  return tokens;
}

/**
 * Extract typography classes (.type-*) with their Tailwind definitions
 */
async function extractTypographyTokens() {
  const cssPath = resolveDesignTokenPath(process.cwd());
  const css = await fs.readFile(cssPath, "utf8");

  const typeStyles = [];
  const typeRegex = /\.type-([a-z-]+)\s*\{([^}]+)\}/g;
  let m;
  while ((m = typeRegex.exec(css)) !== null) {
    const name = m[1];
    const body = m[2].trim();
    // Extract @apply directives
    const applyMatch = body.match(/@apply\s+([^;]+)/);
    const classes = applyMatch ? applyMatch[1].trim().split(/\s+/) : [];
    typeStyles.push({ name: `type-${name}`, classes, raw: body });
  }

  return typeStyles;
}

/**
 * Extract component classes (.nb-*, .btn-*)
 */
async function extractComponentTokens() {
  const cssPath = resolveDesignTokenPath(process.cwd());
  const css = await fs.readFile(cssPath, "utf8");

  const components = [];
  const compRegex = /\.(nb-[a-z-]+|btn-[a-z-]+)\s*\{([^}]+)\}/g;
  let m;
  while ((m = compRegex.exec(css)) !== null) {
    const name = m[1];
    const body = m[2].trim();
    const applyMatch = body.match(/@apply\s+([^;]+)/);
    const classes = applyMatch ? applyMatch[1].trim().split(/\s+/) : [];
    components.push({ name, classes, raw: body });
  }

  return components;
}

// ── Build manifest ────────────────────────────────────────────────────

async function buildManifest() {
  const colorTokens = await extractColorTokens();
  const typographyTokens = await extractTypographyTokens();
  const componentTokens = await extractComponentTokens();

  // Categorize color tokens
  const categorized = {
    core: {},     // background, foreground, card, popover, primary, secondary, etc.
    semantic: {}, // text-primary, text-secondary, bg-primary, etc.
    accent: {},   // accent-primary, accent-secondary, etc.
    other: {},    // border-color, radius, etc.
  };

  const coreKeys = ["background", "foreground", "card", "card-foreground", "popover",
    "popover-foreground", "primary", "primary-foreground", "secondary",
    "secondary-foreground", "muted", "muted-foreground", "accent",
    "accent-foreground", "destructive", "destructive-foreground", "border",
    "input", "ring", "radius"];

  const semanticPrefixes = ["text-", "bg-"];
  const accentPrefixes = ["accent-primary", "accent-secondary"];

  for (const [key, value] of Object.entries(colorTokens.light)) {
    if (coreKeys.includes(key)) {
      categorized.core[key] = { light: value, dark: colorTokens.dark[key] ?? null };
    } else if (semanticPrefixes.some(p => key.startsWith(p))) {
      categorized.semantic[key] = { light: value, dark: colorTokens.dark[key] ?? null };
    } else if (accentPrefixes.some(p => key.startsWith(p))) {
      categorized.accent[key] = { light: value, dark: colorTokens.dark[key] ?? null };
    } else {
      categorized.other[key] = { light: value, dark: colorTokens.dark[key] ?? null };
    }
  }

  // Add dark-only tokens
  for (const [key, value] of Object.entries(colorTokens.dark)) {
    if (!colorTokens.light[key]) {
      categorized.other[key] = { light: null, dark: value };
    }
  }

  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    source: DESIGN_TOKEN_SOURCE,
    pages: {
      colorPalette: {
        name: "Color Palette",
        description: `All CSS custom properties from ${DESIGN_TOKEN_SOURCE} (light + dark modes)`,
        sections: {
          core: {
            label: "Core (shadcn/ui primitives)",
            tokens: categorized.core,
          },
          semantic: {
            label: "Semantic (component access vars)",
            tokens: categorized.semantic,
          },
          accent: {
            label: "Accent",
            tokens: categorized.accent,
          },
          other: {
            label: "Other",
            tokens: categorized.other,
          },
        },
        stats: {
          lightCount: Object.keys(colorTokens.light).length,
          darkCount: Object.keys(colorTokens.dark).length,
          totalUnique: new Set([...Object.keys(colorTokens.light), ...Object.keys(colorTokens.dark)]).size,
        },
      },
      typography: {
        name: "Typography",
        description: "6 .type-* styles with specimen text (Inter for UI, JetBrains Mono for code)",
        fonts: {
          ui: { family: "Inter", weights: [300, 400, 500, 600, 700] },
          code: { family: "JetBrains Mono", weights: [400, 500, 600] },
        },
        styles: typographyTokens,
      },
      components: {
        name: "Components",
        description: "Standard primitives for layout, cards, buttons, and patterns",
        items: [
          ...componentTokens,
          // Conceptual components not defined as CSS classes
          { name: "SignatureOrb", classes: [], raw: "React component — 5 variants: idle, loading, success, error, thinking" },
          { name: "EmptyState", classes: [], raw: "React component — icon + title + description + optional CTA" },
          { name: "ViewSkeleton", classes: [], raw: "React component — loading skeleton for view shells" },
        ],
      },
      pageTemplates: {
        name: "Page Templates",
        description: "Layout patterns for route-level page shells",
        templates: [
          {
            name: "Hub Layout",
            description: "3-column grid: sidebar + content + right panel",
            example: "ResearchHub, AgentsHub",
            structure: "sidebar (w-64) | content (flex-1) | panel (w-80)",
          },
          {
            name: "Detail Layout",
            description: "2-column: sidebar + scrollable content",
            example: "EntityProfilePage, FundingBriefView",
            structure: "sidebar (w-64) | content (flex-1)",
          },
          {
            name: "Fullscreen Layout",
            description: "No sidebar, full-viewport immersive content",
            example: "CinematicHome, landing pages",
            structure: "content (w-full h-screen)",
          },
        ],
      },
    },
  };
}

// ── Figma Variables API ───────────────────────────────────────────────

/**
 * Parse an HSL string like "234 56% 58%" into RGB 0-1 values for Figma
 */
function hslToRgb(hslStr) {
  const parts = hslStr.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const h = parseFloat(parts[0]) / 360;
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;

  if (s === 0) return { r: l, g: l, b: l };

  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1/3),
    g: hue2rgb(p, q, h),
    b: hue2rgb(p, q, h - 1/3),
  };
}

/**
 * Parse a hex color like "#5E6AD2" into RGB 0-1 values
 */
function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    return { r, g, b };
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    const a = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  return null;
}

/**
 * Parse rgba() string
 */
function rgbaToRgb(rgbaStr) {
  const m = rgbaStr.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (!m) return null;
  return {
    r: parseFloat(m[1]) / 255,
    g: parseFloat(m[2]) / 255,
    b: parseFloat(m[3]) / 255,
    a: m[4] ? parseFloat(m[4]) : 1,
  };
}

/**
 * Convert any CSS color value to Figma RGBA
 */
function cssColorToFigma(value) {
  if (!value) return null;
  const trimmed = value.trim();

  // Hex color
  if (trimmed.startsWith("#")) return hexToRgb(trimmed);

  // rgba/rgb
  if (trimmed.startsWith("rgb")) return rgbaToRgb(trimmed);

  // HSL values (like "234 56% 58%")
  if (/^\d+\s+\d+%?\s+\d+%?$/.test(trimmed)) return hslToRgb(trimmed);

  return null;
}

/**
 * Create Figma variable collection and variables via REST API
 */
async function createFigmaVariables(fileKey, manifest) {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) {
    return { error: "FIGMA_ACCESS_TOKEN not set. Add it to .env.local." };
  }

  // Build variable creation payload
  const variableChanges = [];
  const colorPage = manifest.pages.colorPalette;

  for (const [sectionKey, section] of Object.entries(colorPage.sections)) {
    for (const [tokenName, modes] of Object.entries(section.tokens)) {
      const lightColor = cssColorToFigma(modes.light);
      const darkColor = cssColorToFigma(modes.dark);

      if (lightColor || darkColor) {
        variableChanges.push({
          action: "CREATE",
          name: `${sectionKey}/${tokenName}`,
          resolvedType: "COLOR",
          valuesByMode: {
            ...(lightColor ? { light: lightColor } : {}),
            ...(darkColor ? { dark: darkColor } : {}),
          },
        });
      }
    }
  }

  console.log(`  Prepared ${variableChanges.length} color variables for Figma`);

  if (dryRun) {
    return {
      status: "dry-run",
      variableCount: variableChanges.length,
      variables: variableChanges.slice(0, 5).map(v => v.name),
    };
  }

  // Step 1: Create a variable collection with light/dark modes
  try {
    const createCollectionUrl = `https://api.figma.com/v1/files/${fileKey}/variables`;
    const payload = {
      variableCollections: [
        {
          action: "CREATE",
          id: "nodebench-ds",
          name: "NodeBench Design Tokens",
          modes: [
            { action: "CREATE", id: "light-mode", name: "Light" },
            { action: "CREATE", id: "dark-mode", name: "Dark" },
          ],
        },
      ],
      variables: variableChanges.map((v, i) => ({
        action: "CREATE",
        id: `var-${i}`,
        name: v.name,
        variableCollectionId: "nodebench-ds",
        resolvedType: "COLOR",
        valuesByMode: {
          "light-mode": v.valuesByMode.light ?? { r: 0, g: 0, b: 0 },
          "dark-mode": v.valuesByMode.dark ?? v.valuesByMode.light ?? { r: 0, g: 0, b: 0 },
        },
      })),
    };

    const res = await fetch(createCollectionUrl, {
      method: "POST",
      headers: {
        "X-Figma-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      return { error: `Figma API ${res.status}: ${text.slice(0, 300)}` };
    }

    const result = await res.json();
    return {
      status: "created",
      variableCount: variableChanges.length,
      response: result,
    };
  } catch (err) {
    return { error: `Figma API error: ${err.message}` };
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  await loadEnv();

  console.log("\n  NodeBench Design System Bootstrap");
  console.log("  " + "=".repeat(40));

  // Build manifest from CSS
  const manifest = await buildManifest();

  const colorStats = manifest.pages.colorPalette.stats;
  const typeCount = manifest.pages.typography.styles.length;
  const compCount = manifest.pages.components.items.length;
  const templateCount = manifest.pages.pageTemplates.templates.length;

  console.log(`\n  Extracted from ${manifest.source}:`);
  console.log(`    Color tokens: ${colorStats.totalUnique} (${colorStats.lightCount} light, ${colorStats.darkCount} dark)`);
  console.log(`    Typography styles: ${typeCount}`);
  console.log(`    Components: ${compCount}`);
  console.log(`    Page templates: ${templateCount}`);

  if (jsonOutput) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  // List all color sections
  console.log("\n  Color sections:");
  for (const [key, section] of Object.entries(manifest.pages.colorPalette.sections)) {
    const count = Object.keys(section.tokens).length;
    console.log(`    ${section.label}: ${count} tokens`);
  }

  console.log("\n  Typography:");
  for (const style of manifest.pages.typography.styles) {
    console.log(`    .${style.name} → ${style.classes.join(" ")}`);
  }

  console.log("\n  Components:");
  for (const comp of manifest.pages.components.items) {
    const detail = comp.classes.length > 0
      ? comp.classes.slice(0, 4).join(" ") + (comp.classes.length > 4 ? " ..." : "")
      : comp.raw.slice(0, 60);
    console.log(`    .${comp.name} → ${detail}`);
  }

  // Try to push to Figma
  const fileKey = figmaFileKey || process.env.FIGMA_DESIGN_SYSTEM_FILE || null;
  const token = process.env.FIGMA_ACCESS_TOKEN || null;

  if (!token) {
    console.log("\n  ┌─────────────────────────────────────────────────┐");
    console.log("  │  FIGMA_ACCESS_TOKEN not set                     │");
    console.log("  │                                                 │");
    console.log("  │  To create the Figma design system file:        │");
    console.log("  │  1. Go to figma.com/developers/api#access-tokens│");
    console.log("  │  2. Create a personal access token              │");
    console.log("  │  3. Add to .env.local:                          │");
    console.log("  │     FIGMA_ACCESS_TOKEN=figd_xxx                 │");
    console.log("  │  4. Create a new Figma file and get its key     │");
    console.log("  │     from the URL: figma.com/design/<KEY>/...    │");
    console.log("  │  5. Add to .env.local:                          │");
    console.log("  │     FIGMA_DESIGN_SYSTEM_FILE=<KEY>              │");
    console.log("  │  6. Re-run this script                          │");
    console.log("  └─────────────────────────────────────────────────┘");
    console.log("\n  Manifest generated successfully (dry-run mode).");

    // Write manifest to .tmp for reference
    const tmpDir = path.join(process.cwd(), ".tmp");
    await fs.mkdir(tmpDir, { recursive: true });
    const manifestPath = path.join(tmpDir, "design-system-manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`  Manifest saved to: ${manifestPath}`);
    return;
  }

  if (!fileKey) {
    console.log("\n  Token found but no Figma file key.");
    console.log("  Create a new file in Figma, then run:");
    console.log("    node scripts/design/bootstrapFigmaDesignSystem.mjs --figma-file <KEY>");
    console.log("  Or add FIGMA_DESIGN_SYSTEM_FILE=<KEY> to .env.local");
    return;
  }

  console.log(`\n  Pushing ${colorStats.totalUnique} variables to Figma file ${fileKey}...`);

  if (dryRun) {
    console.log("  (dry-run mode — no API calls made)");
    const result = await createFigmaVariables(fileKey, manifest);
    console.log(`  Would create ${result.variableCount} variables`);
    return;
  }

  const result = await createFigmaVariables(fileKey, manifest);

  if (result.error) {
    console.error(`\n  Error: ${result.error}`);
    process.exit(1);
  }

  console.log(`  Created ${result.variableCount} variables in Figma`);
  console.log(`\n  Next: validate sync with:`);
  console.log(`    node scripts/design/validateFigmaSync.mjs --figma-file ${fileKey}`);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
