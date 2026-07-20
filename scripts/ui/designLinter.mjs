#!/usr/bin/env node
/**
 * Design Linter — Standalone static analysis for design governance compliance.
 *
 * Usage:
 *   node scripts/ui/designLinter.mjs                   # scan src/, print summary
 *   node scripts/ui/designLinter.mjs --json             # structured JSON output
 *   node scripts/ui/designLinter.mjs --fix-suggestions   # include fix suggestions
 *   node scripts/ui/designLinter.mjs --category color    # filter by category
 *   node scripts/ui/designLinter.mjs --severity high     # filter by severity
 *
 * Exit codes: 0 = pass, 1 = high-severity violations found
 *
 * Also importable: import { scanForDesignViolations } from './designLinter.mjs'
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SRC_DIR = path.join(ROOT, "apps", "web", "src");

// ── Design Governance Spec (inlined from src/design-governance/defaultSpec.ts)
// We inline the patterns here because this is an .mjs script that runs outside
// the TypeScript build pipeline. The canonical source is defaultSpec.ts.
// When updating patterns, update BOTH files.

const CONFIG_EXCLUDES = [
  "index.css", "tailwind.config", ".stories.", ".test.", ".spec.",
  "__tests__", "design-governance", "node_modules",
];

const BANNED_PATTERNS = [
  // ── Color: saturated backgrounds ──
  { pattern: /\bbg-(red|orange|amber|yellow|green|blue|indigo|violet|purple|pink|emerald|teal|cyan|lime|rose|fuchsia|sky)-(50|100|200|300|400|500|600|700|800|900|950)\b/g,
    label: "Saturated bg color (use bg-surface variants)", severity: "medium", category: "color",
    fix: "Replace with bg-surface, bg-surface-secondary, or bg-surface-hover" },
  // ── Color: saturated text ──
  { pattern: /\btext-(red|orange|amber|yellow|green|blue|indigo|violet|purple|pink|emerald|teal|cyan|lime|rose|fuchsia|sky)-(50|100|200|300|400|500|600|700|800|900|950)\b/g,
    label: "Saturated text color (use text-content variants)", severity: "medium", category: "color",
    fix: "Replace with text-content, text-content-secondary, or text-content-muted" },
  // ── Color: raw gray palette ──
  { pattern: /\bbg-gray-(50|100|200|300|400|500|600|700|800|900|950)\b/g,
    label: "bg-gray-* (use bg-surface variants)", severity: "medium", category: "color",
    fix: "bg-gray-50/100 → bg-surface-secondary, bg-gray-200 → bg-surface-hover" },
  { pattern: /\btext-gray-(50|100|200|300|400|500|600|700|800|900|950)\b/g,
    label: "text-gray-* (use text-content variants)", severity: "medium", category: "color",
    fix: "text-gray-500/600 → text-content-muted, text-gray-700/800 → text-content-secondary" },
  { pattern: /\bborder-gray-(50|100|200|300|400|500|600|700|800|900|950)\b/g,
    label: "border-gray-* (use border-edge)", severity: "medium", category: "color",
    fix: "Replace with border-edge" },
  // ── Color: decorative gradients ──
  { pattern: /\bfrom-(amber|orange|purple|pink|indigo|red|green|blue)-(50|100|200)\b/g,
    label: "Decorative gradient (use flat surface)", severity: "medium", category: "color",
    fix: "Remove gradient, use bg-surface or bg-surface-secondary" },
  // ── Color: non-semantic bg-white ──
  { pattern: /\bbg-white\b(?!\/)/g,
    label: "bg-white (use bg-surface)", severity: "low", category: "color",
    fix: "Replace with bg-surface" },
  // ── Color: hardcoded hex #f2f1ed ──
  { pattern: /#f2f1ed/gi,
    label: "Hardcoded hex #f2f1ed", severity: "high", category: "color",
    fix: "Use CSS variable or semantic token" },

  // ── Focus: hardcoded indigo rings ──
  { pattern: /\bring-indigo-[0-9]+\b/g,
    label: "Hardcoded indigo focus ring (use ring-ring)", severity: "medium", category: "focus",
    fix: "Replace ring-indigo-500 with ring-ring (maps to --ring CSS var)" },
  { pattern: /focus-visible:ring-indigo/g,
    label: "Focus ring using hardcoded indigo", severity: "medium", category: "focus",
    fix: "Use focus-visible:ring-ring" },

  // ── Typography: ALL CAPS ──
  { pattern: /uppercase\s+tracking-widest/g,
    label: "ALL CAPS tracking-widest (use .type-label)", severity: "high", category: "typography",
    fix: "Replace with className='type-label'" },
  { pattern: /tracking-\[0\.\d+em\]/g,
    label: "Custom tracking value (use type scale)", severity: "medium", category: "typography",
    fix: "Use .type-label (includes tracking-wider) or remove" },
  { pattern: /\bfont-black\b/g,
    label: "font-black weight (max: font-bold)", severity: "low", category: "typography",
    fix: "Replace with font-bold or font-semibold" },

  // ── Button: inline styling ──
  { pattern: /bg-indigo-600\s+text-white\s+.*rounded/g,
    label: "Inline button styling (use .btn-primary-sm)", severity: "low", category: "button",
    fix: "Replace inline styles with btn-primary-sm class" },
];

const FILE_IGNORE = [
  /node_modules/, /\.test\.(ts|tsx)$/, /\.spec\.(ts|tsx)$/, /\.config\./,
  /tailwind\./, /__tests__/, /\.stories\./, /\.d\.ts$/, /design-governance/,
  /index\.css$/,
];

// ── File-level structural checks (applied to view files) ──

function getStructuralViolations(content, relPath) {
  const violations = [];
  const isRouteView =
    /views\/.*(View|Page)\.tsx$/i.test(relPath) &&
    !/components\/.*\/views\//i.test(relPath);

  if (isRouteView) {
    // Check for nb-page-shell usage
    if (!content.includes("nb-page-shell") && !content.includes("PageShell")) {
      violations.push({
        file: relPath, line: 1, match: "(file-level)",
        label: "Route view missing nb-page-shell layout primitive",
        severity: "medium", category: "layout",
        fix: "Wrap view content in <div className='nb-page-shell'>",
      });
    }

    // Check for empty state handling
    const hasEmptyState = /EmptyState|empty.?state|SignatureOrb.*empty|no.?data|no.?items|no.?results|\.length\s*===?\s*0/i.test(content);
    if (!hasEmptyState) {
      violations.push({
        file: relPath, line: 1, match: "(file-level)",
        label: "View possibly missing empty state handling",
        severity: "medium", category: "states",
        fix: "Add EmptyState or SignatureOrb variant='empty' for when data is empty",
      });
    }

    // Check for loading state
    const hasLoading = /Skeleton|loading|isLoading|SignatureOrb.*loading|Suspense/i.test(content);
    if (!hasLoading) {
      violations.push({
        file: relPath, line: 1, match: "(file-level)",
        label: "View possibly missing loading state",
        severity: "medium", category: "states",
        fix: "Add ViewSkeleton or SignatureOrb variant='loading' for loading state",
      });
    }
  }

  return violations;
}

// ── Scanner ───────────────────────────────────────────────────

export async function scanForDesignViolations(srcDir, options = {}) {
  const { category, severity, fixSuggestions = false } = options;
  const allViolations = [];

  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (["node_modules", ".git", "dist", "__tests__"].includes(entry.name)) continue;
        await walk(full);
        continue;
      }

      if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;

      const relPath = path.relative(ROOT, full).replace(/\\/g, "/");
      if (FILE_IGNORE.some((p) => p.test(relPath))) continue;

      let content;
      try { content = await fs.readFile(full, "utf8"); } catch { continue; }

      const lines = content.split("\n");

      // Pattern-based violations
      for (const bp of BANNED_PATTERNS) {
        // Check config excludes
        if (CONFIG_EXCLUDES.some((exc) => relPath.includes(exc))) continue;

        bp.pattern.lastIndex = 0;
        for (let i = 0; i < lines.length; i++) {
          bp.pattern.lastIndex = 0;
          let match;
          while ((match = bp.pattern.exec(lines[i])) !== null) {
            const v = {
              file: relPath,
              line: i + 1,
              match: match[0],
              label: bp.label,
              severity: bp.severity,
              category: bp.category,
            };
            if (fixSuggestions && bp.fix) v.fix = bp.fix;
            allViolations.push(v);
          }
        }
      }

      // Structural violations (view-level)
      const structural = getStructuralViolations(content, relPath);
      for (const v of structural) {
        if (!fixSuggestions) delete v.fix;
        allViolations.push(v);
      }
    }
  }

  await walk(srcDir);

  // Filter
  let filtered = allViolations;
  if (category) filtered = filtered.filter((v) => v.category === category);
  if (severity) filtered = filtered.filter((v) => v.severity === severity);

  // Sort: high → medium → low, then by file
  const order = { high: 0, medium: 1, low: 2 };
  filtered.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file));

  // Stats
  const high = filtered.filter((v) => v.severity === "high").length;
  const medium = filtered.filter((v) => v.severity === "medium").length;
  const low = filtered.filter((v) => v.severity === "low").length;
  const byCategory = {};
  for (const v of filtered) byCategory[v.category] = (byCategory[v.category] || 0) + 1;
  const deductions = high * 10 + medium * 3 + low * 1;
  const score = Math.max(0, 100 - deductions);

  return {
    violations: filtered,
    total: filtered.length,
    high, medium, low,
    byCategory,
    score,
    specVersion: "1.0.0",
  };
}

// ── CLI ───────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY;
const c = {
  red: (s) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  yellow: (s) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  green: (s) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  dim: (s) => USE_COLOR ? `\x1b[2m${s}\x1b[0m` : s,
  bold: (s) => USE_COLOR ? `\x1b[1m${s}\x1b[0m` : s,
  cyan: (s) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
};

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const fixSuggestions = args.includes("--fix-suggestions");
  const categoryIdx = args.indexOf("--category");
  const category = categoryIdx >= 0 ? args[categoryIdx + 1] : undefined;
  const severityIdx = args.indexOf("--severity");
  const severity = severityIdx >= 0 ? args[severityIdx + 1] : undefined;

  const result = await scanForDesignViolations(SRC_DIR, { category, severity, fixSuggestions });

  if (jsonMode) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(result.high > 0 ? 1 : 0);
    return;
  }

  // Pretty print
  console.log(c.bold("\n  Design Governance Linter v1.0.0\n"));
  console.log(`  Spec version: ${result.specVersion}`);
  console.log(`  Scanned: ${c.cyan("src/")}\n`);

  // Top violations by file (first 30)
  const byFile = {};
  for (const v of result.violations) {
    if (!byFile[v.file]) byFile[v.file] = [];
    byFile[v.file].push(v);
  }

  const topFiles = Object.entries(byFile)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 30);

  for (const [file, violations] of topFiles) {
    const highCount = violations.filter((v) => v.severity === "high").length;
    const medCount = violations.filter((v) => v.severity === "medium").length;
    const lowCount = violations.filter((v) => v.severity === "low").length;

    const counts = [
      highCount ? c.red(`${highCount} high`) : "",
      medCount ? c.yellow(`${medCount} med`) : "",
      lowCount ? c.dim(`${lowCount} low`) : "",
    ].filter(Boolean).join(", ");

    console.log(`  ${c.dim(file)} ${counts}`);

    // Show first 3 violations per file
    for (const v of violations.slice(0, 3)) {
      const sev = v.severity === "high" ? c.red("HIGH") : v.severity === "medium" ? c.yellow("MED ") : c.dim("LOW ");
      console.log(`    ${sev} L${v.line}: ${v.label} ${c.dim(`[${v.match}]`)}`);
      if (fixSuggestions && v.fix) console.log(`         ${c.green("fix:")} ${v.fix}`);
    }
    if (violations.length > 3) console.log(c.dim(`    ... +${violations.length - 3} more`));
    console.log();
  }

  // Summary
  console.log(c.bold("  Summary"));
  console.log(`  Total violations: ${result.total}`);
  console.log(`  ${c.red(`High: ${result.high}`)} | ${c.yellow(`Medium: ${result.medium}`)} | ${c.dim(`Low: ${result.low}`)}`);
  console.log(`  By category: ${Object.entries(result.byCategory).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  Score: ${result.score}/100\n`);

  process.exit(result.high > 0 ? 1 : 0);
}

// Run CLI if invoked directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
