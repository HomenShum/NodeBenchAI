#!/usr/bin/env node
/**
 * validateFigmaSync.mjs — Compare Figma design tokens against apps/web/src/index.css
 *
 * Usage:
 *   node scripts/design/validateFigmaSync.mjs [--figma-file <fileKey>] [--json]
 *
 * Requirements:
 *   FIGMA_ACCESS_TOKEN env var (or .env.local)
 *
 * What it does:
 * 1. Extracts CSS custom properties from apps/web/src/index.css (:root + .dark)
 * 2. Calls Figma Variables API to get published variables
 * 3. Compares the two and reports drift:
 *    - Tokens in code but not in Figma (code-only)
 *    - Tokens in Figma but not in code (figma-only)
 *    - Tokens in both but with different values (value drift)
 * 4. Outputs report (text or JSON)
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  DESIGN_TOKEN_SOURCE,
  resolveDesignTokenPath,
} from "../lib/standardTreePaths.mjs";

// ── CLI Args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const figmaFileIdx = args.indexOf("--figma-file");
const figmaFileKey = figmaFileIdx >= 0 ? args[figmaFileIdx + 1] : null;

// ── Load env from .env.local if present ───────────────────────────────
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

// ── Extract CSS custom properties from index.css ──────────────────────
async function extractCssTokens() {
  const cssPath = resolveDesignTokenPath(process.cwd());
  const css = await fs.readFile(cssPath, "utf8");

  const tokens = { light: {}, dark: {} };
  const varRegex = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+)/g;

  // Extract :root tokens
  const rootMatch = css.match(/:root\s*\{([^}]+)\}/s);
  if (rootMatch) {
    let m;
    while ((m = varRegex.exec(rootMatch[1])) !== null) {
      tokens.light[m[1]] = m[2].trim();
    }
  }

  // Extract .dark tokens
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

// ── Fetch Figma variables via REST API ────────────────────────────────
async function fetchFigmaVariables(fileKey) {
  const token = process.env.FIGMA_ACCESS_TOKEN;
  if (!token) {
    return { error: "FIGMA_ACCESS_TOKEN not set. Add it to .env.local or set as env var." };
  }
  if (!fileKey) {
    return { error: "No Figma file key. Use --figma-file <key> or set FIGMA_DESIGN_SYSTEM_FILE in .env.local." };
  }

  try {
    const url = `https://api.figma.com/v1/files/${fileKey}/variables/local`;
    const res = await fetch(url, {
      headers: { "X-Figma-Token": token },
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `Figma API ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = await res.json();

    // Parse Figma variables into flat token map
    const variables = json.meta?.variables ?? {};
    const collections = json.meta?.variableCollections ?? {};

    const figmaTokens = { light: {}, dark: {} };
    for (const [, v] of Object.entries(variables)) {
      const name = v.name?.replace(/\//g, "-").toLowerCase() ?? "";
      if (!name) continue;

      // Get mode IDs for light/dark
      const collectionId = v.variableCollectionId;
      const collection = collections[collectionId];
      const modes = collection?.modes ?? [];

      for (const mode of modes) {
        const modeName = mode.name?.toLowerCase() ?? "";
        const modeId = mode.modeId;
        const value = v.valuesByMode?.[modeId];
        if (value == null) continue;

        const resolved = resolveValue(value);
        if (modeName.includes("dark")) {
          figmaTokens.dark[name] = resolved;
        } else {
          figmaTokens.light[name] = resolved;
        }
      }
    }

    return { tokens: figmaTokens };
  } catch (err) {
    return { error: `Figma API error: ${err.message}` };
  }
}

function resolveValue(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value?.r != null) {
    // RGBA color
    const r = Math.round(value.r * 255);
    const g = Math.round(value.g * 255);
    const b = Math.round(value.b * 255);
    const a = value.a ?? 1;
    if (a < 1) return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }
  return JSON.stringify(value);
}

// ── Compare tokens ────────────────────────────────────────────────────
function compareTokens(codeTokens, figmaTokens) {
  const report = { codeOnly: [], figmaOnly: [], drift: [], matched: 0 };

  const allCodeKeys = new Set([...Object.keys(codeTokens.light), ...Object.keys(codeTokens.dark)]);
  const allFigmaKeys = new Set([...Object.keys(figmaTokens.light), ...Object.keys(figmaTokens.dark)]);

  for (const key of allCodeKeys) {
    if (!allFigmaKeys.has(key)) {
      report.codeOnly.push(key);
    }
  }

  for (const key of allFigmaKeys) {
    if (!allCodeKeys.has(key)) {
      report.figmaOnly.push(key);
    }
  }

  // Check value drift for tokens in both
  for (const key of allCodeKeys) {
    if (!allFigmaKeys.has(key)) continue;
    const codeLight = codeTokens.light[key];
    const figmaLight = figmaTokens.light[key];
    if (codeLight && figmaLight && codeLight !== figmaLight) {
      report.drift.push({ token: key, mode: "light", code: codeLight, figma: figmaLight });
    }
    const codeDark = codeTokens.dark[key];
    const figmaDark = figmaTokens.dark[key];
    if (codeDark && figmaDark && codeDark !== figmaDark) {
      report.drift.push({ token: key, mode: "dark", code: codeDark, figma: figmaDark });
    }
    report.matched++;
  }

  return report;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  await loadEnv();

  const codeTokens = await extractCssTokens();
  const codeCount = Object.keys(codeTokens.light).length + Object.keys(codeTokens.dark).length;

  const fileKey = figmaFileKey || process.env.FIGMA_DESIGN_SYSTEM_FILE || null;
  const figmaResult = await fetchFigmaVariables(fileKey);

  if (figmaResult.error) {
    // Still output code tokens summary even without Figma
    const result = {
      status: "code-only",
      source: DESIGN_TOKEN_SOURCE,
      message: figmaResult.error,
      codeTokens: {
        lightCount: Object.keys(codeTokens.light).length,
        darkCount: Object.keys(codeTokens.dark).length,
        total: codeCount,
        light: codeTokens.light,
        dark: codeTokens.dark,
      },
    };

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("\n  Figma Sync Validation");
      console.log("  " + "=".repeat(40));
      console.log(`\n  ${figmaResult.error}`);
      console.log(`\n  Code source: ${DESIGN_TOKEN_SOURCE}`);
      console.log(`\n  Code tokens extracted: ${codeCount}`);
      console.log(`    Light: ${Object.keys(codeTokens.light).length}`);
      console.log(`    Dark:  ${Object.keys(codeTokens.dark).length}`);
      console.log("\n  Run with --figma-file <key> once you have a Figma design system file.");
    }
    return;
  }

  // Compare
  const report = compareTokens(codeTokens, figmaResult.tokens);

  if (jsonOutput) {
    console.log(JSON.stringify({
      status: "compared",
      source: DESIGN_TOKEN_SOURCE,
      codeTokenCount: codeCount,
      figmaTokenCount: Object.keys(figmaResult.tokens.light).length + Object.keys(figmaResult.tokens.dark).length,
      matched: report.matched,
      codeOnly: report.codeOnly,
      figmaOnly: report.figmaOnly,
      drift: report.drift,
    }, null, 2));
  } else {
    console.log("\n  Figma Sync Validation");
    console.log("  " + "=".repeat(40));
    console.log(`  Code source:  ${DESIGN_TOKEN_SOURCE}`);
    console.log(`  Code tokens:  ${codeCount}`);
    console.log(`  Figma tokens: ${Object.keys(figmaResult.tokens.light).length + Object.keys(figmaResult.tokens.dark).length}`);
    console.log(`  Matched:      ${report.matched}`);
    console.log(`  Code-only:    ${report.codeOnly.length}`);
    console.log(`  Figma-only:   ${report.figmaOnly.length}`);
    console.log(`  Value drift:  ${report.drift.length}`);

    if (report.drift.length > 0) {
      console.log("\n  Drifted tokens:");
      for (const d of report.drift.slice(0, 20)) {
        console.log(`    ${d.token} (${d.mode}): code="${d.code}" vs figma="${d.figma}"`);
      }
    }

    if (report.codeOnly.length > 0) {
      console.log(`\n  Code-only tokens (first 20):`);
      for (const t of report.codeOnly.slice(0, 20)) {
        console.log(`    --${t}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
