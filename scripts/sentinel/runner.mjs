#!/usr/bin/env node
/**
 * Sentinel Runner (Layer 1) — Self-Testing
 *
 * Runs every verification probe against the app and collects results.
 * Does NOT fix anything — that's Layer 3's job.
 *
 * Usage:
 *   node scripts/sentinel/runner.mjs                    # run all probes
 *   node scripts/sentinel/runner.mjs --probes e2e,build # run specific probes
 *   node scripts/sentinel/runner.mjs --json             # JSON output
 *   node scripts/sentinel/runner.mjs --skip-server      # assume dev server running
 *
 * Exit codes: 0 = all pass, 1 = failures found, 2 = runner error
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative, resolve } from 'path';
import { pathToFileURL } from 'url';
import { createReport, computeSummary, formatReportSummary } from './schema.mjs';
import { APP_SOURCE_RELATIVE, appSourcePath } from './paths.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const REPORT_DIR = join(ROOT, '.sentinel');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const skipServer = args.includes('--skip-server');
const probeFilter = (() => {
  const idx = args.indexOf('--probes');
  return idx >= 0 && args[idx + 1] ? args[idx + 1].split(',') : null;
})();

// ── Helpers ──────────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  try {
    const result = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: opts.timeout || 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });
    return { ok: true, stdout: result, stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      code: err.status,
    };
  }
}

function shouldRun(category) {
  if (!probeFilter) return true;
  return probeFilter.includes(category);
}

function log(msg) {
  if (!jsonOutput) process.stderr.write(msg + '\n');
}

// ── Probe: Build (TypeScript + Vite) ─────────────────────────────────────────
async function probeBuild() {
  log('  [build] TypeScript compilation...');
  const start = Date.now();
  const tsc = run('npx tsc --noEmit --pretty false', { timeout: 60_000 });
  const failures = [];

  if (!tsc.ok) {
    const lines = (tsc.stdout + tsc.stderr).split('\n').filter(l => l.includes('error TS'));
    failures.push(...lines.slice(0, 20));
  }

  // Vite build check (dry run via esbuild resolve)
  const vite = run('npx vite build --mode production 2>&1 | head -30', { timeout: 180_000 });
  if (!vite.ok) {
    failures.push(`Vite build failed: ${vite.stderr.slice(0, 200)}`);
  }

  return {
    probe: 'build:tsc+vite',
    category: 'build',
    status: failures.length === 0 ? 'pass' : 'fail',
    duration: Date.now() - start,
    summary: failures.length === 0 ? 'Clean build' : `${failures.length} build errors`,
    failures,
  };
}

// ── Probe: E2E Tests (Playwright) ────────────────────────────────────────────
async function probeE2E() {
  log('  [e2e] Playwright tests...');
  const start = Date.now();

  const result = run(
    'npx playwright test --reporter=json --project=chromium 2>&1',
    { timeout: 300_000 }
  );

  const failures = [];
  let testResults = null;

  // Try to parse JSON reporter output
  const jsonPath = join(ROOT, 'test-results.json');
  if (existsSync(jsonPath)) {
    try {
      testResults = JSON.parse(readFileSync(jsonPath, 'utf8'));
    } catch { /* ignore parse errors */ }
  }

  if (testResults?.suites) {
    const collectFailures = (suites) => {
      for (const suite of suites) {
        for (const spec of suite.specs || []) {
          for (const test of spec.tests || []) {
            for (const result of test.results || []) {
              if (result.status === 'failed' || result.status === 'timedOut') {
                failures.push(`${spec.title}: ${result.error?.message?.slice(0, 150) || 'failed'}`);
              }
            }
          }
        }
        if (suite.suites) collectFailures(suite.suites);
      }
    };
    collectFailures(testResults.suites);
  } else if (!result.ok) {
    // Fallback: parse stdout for failures
    const failLines = result.stdout.split('\n').filter(l => /\d+\s+failed/.test(l));
    failures.push(...failLines.slice(0, 10));
    if (failures.length === 0) failures.push('E2E run failed (no JSON report)');
  }

  return {
    probe: 'e2e:playwright',
    category: 'e2e',
    status: failures.length === 0 ? (result.ok ? 'pass' : 'warn') : 'fail',
    duration: Date.now() - start,
    summary: failures.length === 0 ? 'All E2E tests passed' : `${failures.length} E2E failures`,
    failures,
    meta: testResults ? {
      total: testResults.stats?.expected || 0,
      passed: testResults.stats?.expected || 0,
    } : undefined,
  };
}

// ── Probe: Design Linter ─────────────────────────────────────────────────────
async function probeDesignLint() {
  log('  [design] Design linter...');
  const start = Date.now();

  const result = run('node scripts/ui/designLinter.mjs --json', { timeout: 30_000 });
  const failures = [];
  let meta = {};

  if (result.ok || result.stdout) {
    try {
      const data = JSON.parse(result.stdout);
      meta = {
        totalViolations: data.totalViolations || 0,
        highSeverity: data.violations?.filter(v => v.severity === 'high').length || 0,
        categories: [...new Set((data.violations || []).map(v => v.category))],
      };
      if (meta.highSeverity > 0) {
        const highViolations = data.violations.filter(v => v.severity === 'high');
        for (const v of highViolations.slice(0, 10)) {
          failures.push(`[${v.category}] ${v.file}:${v.line} — ${v.label}`);
        }
      }
    } catch {
      // Non-JSON output — parse text
      const lines = result.stdout.split('\n').filter(l => l.includes('FAIL'));
      failures.push(...lines.slice(0, 10));
    }
  } else {
    failures.push('Design linter failed to run');
  }

  return {
    probe: 'design:linter',
    category: 'design',
    status: failures.length === 0 ? 'pass' : (meta.highSeverity > 0 ? 'fail' : 'warn'),
    duration: Date.now() - start,
    summary: `${meta.totalViolations || 0} violations (${meta.highSeverity || 0} high)`,
    failures,
    meta,
  };
}

// ── Probe: Dogfood QA Gate ───────────────────────────────────────────────────
async function probeDogfoodGate() {
  log('  [dogfood] CI QA gate...');
  const start = Date.now();

  const result = run('node scripts/overstory/ci-qa-check.mjs', { timeout: 15_000 });
  const failures = [];

  const lines = (result.stdout || '').split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('FAIL:')) {
      failures.push(line.trim());
    }
  }

  // Extract pass/fail counts
  const summaryLine = lines.find(l => l.includes('Passed:'));
  const meta = {};
  if (summaryLine) {
    const match = summaryLine.match(/Passed:\s*(\d+)\/(\d+)/);
    if (match) {
      meta.passed = parseInt(match[1]);
      meta.total = parseInt(match[2]);
    }
  }

  return {
    probe: 'dogfood:qa-gate',
    category: 'dogfood',
    status: result.ok ? 'pass' : 'fail',
    duration: Date.now() - start,
    summary: summaryLine?.trim() || 'Dogfood QA gate check',
    failures,
    meta,
  };
}

// ── Probe: Voice Intent Router Coverage ──────────────────────────────────────
export async function probeVoiceCoverage(options = {}) {
  log('  [voice] Voice intent router coverage...');
  const start = Date.now();
  const failures = [];
  const root = options.root ?? ROOT;

  // Check that the router file exists and has all expected patterns
  const routerPath = join(root, appSourcePath('hooks/useVoiceIntentRouter.ts'));
  if (!existsSync(routerPath)) {
    return {
      probe: 'voice:router-coverage',
      category: 'voice',
      status: 'fail',
      duration: Date.now() - start,
      summary: 'useVoiceIntentRouter.ts not found',
      failures: ['Router file missing'],
    };
  }

  const routerCode = readFileSync(routerPath, 'utf8');

  // Check VIEW_ALIASES covers the spoken phrases users rely on. Object keys may
  // be quoted or unquoted, so match the key declaration instead of a string literal.
  const criticalAliases = [
    'research', 'documents', 'calendar', 'benchmarks', 'funding',
    'cost dashboard', 'marketplace', 'showcase', 'signals',
  ];
  for (const alias of criticalAliases) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const aliasPattern = new RegExp(`(?:^|\\n)\\s*(?:["']${escapedAlias}["']|${escapedAlias})\\s*:`, 'm');
    if (!aliasPattern.test(routerCode)) {
      failures.push(`VIEW_ALIASES missing spoken alias: ${alias}`);
    }
  }

  // Check all action types are wired
  const requiredActions = [
    'navigateToView', 'setCockpitMode', 'openSettings', 'openCommandPalette',
    'setThemeMode', 'toggleTheme', 'selectThread', 'triggerSearch', 'scrollTo',
    'goBack', 'refresh',
  ];
  for (const action of requiredActions) {
    if (!routerCode.includes(action)) {
      failures.push(`Missing action callback: ${action}`);
    }
  }

  // Check CockpitLayout wiring
  const cockpitPath = join(root, appSourcePath('layouts/CockpitLayout.tsx'));
  if (existsSync(cockpitPath)) {
    const cockpitCode = readFileSync(cockpitPath, 'utf8');
    if (!cockpitCode.includes('useVoiceIntentRouter')) {
      failures.push('CockpitLayout does not import useVoiceIntentRouter');
    }
    if (!cockpitCode.includes('onVoiceIntent')) {
      failures.push('CockpitLayout does not pass onVoiceIntent prop');
    }
  } else {
    failures.push('CockpitLayout.tsx missing');
  }

  // Check E2E test coverage
  const testPath = join(root, 'evals/e2e/voice-input.spec.ts');
  if (existsSync(testPath)) {
    const testCode = readFileSync(testPath, 'utf8');
    const scenarioCount = (testCode.match(/test\(/g) || []).length;
    if (scenarioCount < 25) {
      failures.push(`Voice E2E tests: only ${scenarioCount} tests (expected 25+)`);
    }
  } else {
    failures.push('Voice E2E test file missing');
  }

  return {
    probe: 'voice:router-coverage',
    category: 'voice',
    status: failures.length === 0 ? 'pass' : 'warn',
    duration: Date.now() - start,
    summary: `${failures.length} voice coverage gaps`,
    failures,
  };
}

// ── Probe: Accessibility Static Check ────────────────────────────────────────
function listTypeScriptSources(sourceRoot) {
  if (!existsSync(sourceRoot)) {
    return { files: [], errors: [`source directory missing: ${sourceRoot}`] };
  }

  const files = [];
  const errors = [];
  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      errors.push(`could not read ${directory}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(absolutePath);
    }
  };

  visit(sourceRoot);
  files.sort();
  return { files, errors };
}

export function inspectA11ySources(sourceRoot, options = {}) {
  const repoRoot = options.repoRoot ?? ROOT;
  const inventory = listTypeScriptSources(sourceRoot);
  const failures = [];
  const inspectionErrors = [...inventory.errors];
  let inspectedSourceFileCount = 0;
  let interactiveFileCount = 0;
  let missingAriaButtonCount = 0;

  const displayPath = (absolutePath) => relative(repoRoot, absolutePath).replaceAll('\\', '/');

  for (const filePath of inventory.files) {
    let source;
    try {
      source = readFileSync(filePath, 'utf8');
      inspectedSourceFileCount += 1;
    } catch (error) {
      inspectionErrors.push(
        `could not inspect ${displayPath(filePath)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    if (/onClick|onKeyDown/.test(source)) interactiveFileCount += 1;

    const lines = source.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const location = `${displayPath(filePath)}:${lineIndex + 1}`;
      const hasSmallTarget = /\b(?:w-[4-7]\s+h-[4-7]|w-8\s+h-8|h-6\s+w-6|h-7\s+w-7)\b/.test(line);
      if (
        failures.filter((failure) => failure.startsWith('Touch target < 44px:')).length < 10 &&
        hasSmallTarget &&
        /button|btn|click|tap|interactive/i.test(line)
      ) {
        failures.push(`Touch target < 44px: ${location}: ${line.trim().slice(0, 120)}`);
      }

      if (
        missingAriaButtonCount < 10 &&
        /<button\b/.test(line) &&
        !/aria-label|aria-labelledby|title|children|>.*</.test(line)
      ) {
        missingAriaButtonCount += 1;
      }
    }
  }

  if (missingAriaButtonCount > 0) {
    failures.push(`${missingAriaButtonCount} button(s) potentially missing aria-label`);
  }

  if (inventory.files.length === 0 && inspectionErrors.length === 0) {
    inspectionErrors.push(`no TypeScript source files found under ${sourceRoot}`);
  }
  if (inspectedSourceFileCount === 0 && inspectionErrors.length === 0) {
    inspectionErrors.push(`zero source files inspected under ${sourceRoot}`);
  }

  const meta = {
    sourceRoot: displayPath(sourceRoot),
    sourceFileCount: inventory.files.length,
    inspectedSourceFileCount,
    interactiveFileCount,
  };

  if (inspectionErrors.length > 0) {
    return {
      status: 'fail',
      summary: `A11y source inspection failed: ${inspectionErrors[0]}`,
      failures: inspectionErrors.map((error) => `A11y source inspection failed: ${error}`),
      meta,
    };
  }

  return {
    status: failures.length === 0 ? 'pass' : 'warn',
    summary: `${failures.length} a11y concerns across ${inspectedSourceFileCount} source files`,
    failures,
    meta,
  };
}

export async function probeA11y(options = {}) {
  log('  [a11y] Accessibility static checks...');
  const start = Date.now();
  const root = options.root ?? ROOT;
  const sourceRoot = options.sourceRoot ?? join(root, APP_SOURCE_RELATIVE);
  const inspection = inspectA11ySources(sourceRoot, { repoRoot: root });

  return {
    probe: 'a11y:static',
    category: 'a11y',
    status: inspection.status,
    duration: Date.now() - start,
    summary: inspection.summary,
    failures: inspection.failures,
    meta: inspection.meta,
  };
}

// ── Probe: Gemini Vision QA ──────────────────────────────────────────────────
async function probeGeminiQA() {
  log('  [visual] Gemini QA scoring...');
  const start = Date.now();

  // Check if qa-results.json exists and is recent
  const qaPath = join(ROOT, 'public/dogfood/qa-results.json');
  if (!existsSync(qaPath)) {
    return {
      probe: 'visual:gemini-qa',
      category: 'visual',
      status: 'skip',
      duration: Date.now() - start,
      summary: 'No qa-results.json found (run dogfood:qa:gemini first)',
      failures: [],
    };
  }

  const failures = [];
  try {
    const data = JSON.parse(readFileSync(qaPath, 'utf8'));
    const score = data.compositeScore ?? data.overallScore ?? null;
    const aspiration = data.aspirationScore ?? null;

    if (score !== null && score < 85) {
      failures.push(`Composite score ${score}/100 (threshold: 85)`);
    }
    if (aspiration !== null && aspiration < 80) {
      failures.push(`Aspiration score ${aspiration}/100 (threshold: 80)`);
    }

    // Check individual criteria
    if (data.criteria) {
      for (const [key, val] of Object.entries(data.criteria)) {
        if (typeof val === 'number' && val < 70) {
          failures.push(`Low score: ${key} = ${val}/100`);
        }
      }
    }

    return {
      probe: 'visual:gemini-qa',
      category: 'visual',
      status: failures.length === 0 ? 'pass' : 'warn',
      duration: Date.now() - start,
      summary: `Composite: ${score ?? 'N/A'}, Aspiration: ${aspiration ?? 'N/A'}`,
      failures,
      meta: { score, aspiration, criteria: data.criteria },
    };
  } catch {
    return {
      probe: 'visual:gemini-qa',
      category: 'visual',
      status: 'skip',
      duration: Date.now() - start,
      summary: 'Failed to parse qa-results.json',
      failures: ['Parse error'],
    };
  }
}

// ── Probe: Performance (bundle size) ─────────────────────────────────────────
async function probePerformance() {
  log('  [performance] Bundle analysis...');
  const start = Date.now();
  const failures = [];

  // Check if dist exists and get total size
  const distPath = join(ROOT, 'dist');
  if (!existsSync(distPath)) {
    return {
      probe: 'performance:bundle',
      category: 'performance',
      status: 'skip',
      duration: Date.now() - start,
      summary: 'No dist/ found (run build first)',
      failures: [],
    };
  }

  const sizeResult = run('du -sh dist/ 2>/dev/null || echo "unknown"', { timeout: 5_000 });
  const totalSize = sizeResult.stdout.trim().split('\t')[0] || 'unknown';

  // Check for oversized chunks
  const chunkResult = run(
    'find dist/ -name "*.js" -size +500k 2>/dev/null | head -10',
    { timeout: 5_000 }
  );
  if (chunkResult.ok && chunkResult.stdout.trim()) {
    const bigChunks = chunkResult.stdout.trim().split('\n');
    for (const chunk of bigChunks) {
      failures.push(`Large chunk (>500KB): ${chunk.trim()}`);
    }
  }

  return {
    probe: 'performance:bundle',
    category: 'performance',
    status: failures.length === 0 ? 'pass' : 'warn',
    duration: Date.now() - start,
    summary: `Bundle size: ${totalSize}`,
    failures,
    meta: { totalSize },
  };
}

// ── Probe: MCP Contract & Self-Eval ──────────────────────────────────────────
async function probeContract() {
  log('  [contract] MCP tool infrastructure health...');
  const start = Date.now();
  const failures = [];
  const meta = {};

  // Check MCP tools compile
  const mcpBuild = run(
    'cd packages/mcp-local && npx tsc --noEmit --pretty false 2>&1 | head -20',
    { timeout: 60_000 }
  );
  if (!mcpBuild.ok) {
    const errors = (mcpBuild.stdout + mcpBuild.stderr).split('\n').filter(l => l.includes('error TS'));
    failures.push(...errors.slice(0, 5).map(e => `MCP build: ${e.trim().slice(0, 120)}`));
  }

  // Check MCP tests pass
  const mcpTest = run(
    'cd packages/mcp-local && npx vitest run --reporter=json 2>&1 | tail -5',
    { timeout: 120_000 }
  );
  if (!mcpTest.ok) {
    failures.push('MCP vitest suite has failures');
  }

  // Check tool count hasn't regressed
  const registryPath = join(ROOT, 'packages/mcp-local/src/tools/toolRegistry.ts');
  if (existsSync(registryPath)) {
    const registryCode = readFileSync(registryPath, 'utf8');
    const entryCount = (registryCode.match(/^\s+\{/gm) || []).length;
    meta.toolRegistryEntries = entryCount;
    if (entryCount < 170) {
      failures.push(`Tool registry has only ${entryCount} entries (expected 170+)`);
    }
  }

  // Check key self-eval tool files exist
  const selfEvalFiles = [
    'packages/mcp-local/src/tools/selfEvalTools.ts',
    'packages/mcp-local/src/tools/critterTools.ts',
    'packages/mcp-local/src/tools/verificationTools.ts',
    'packages/mcp-local/src/tools/flywheelTools.ts',
    'packages/mcp-local/src/tools/qualityGateTools.ts',
  ];
  for (const f of selfEvalFiles) {
    if (!existsSync(join(ROOT, f))) {
      failures.push(`Missing self-eval file: ${f}`);
    }
  }

  // Check agent contract prompt exists in metaTools
  const metaPath = join(ROOT, 'packages/mcp-local/src/tools/metaTools.ts');
  if (existsSync(metaPath)) {
    const metaCode = readFileSync(metaPath, 'utf8');
    if (!metaCode.includes('agent-contract') && !metaCode.includes('agentContract')) {
      failures.push('Agent contract not found in metaTools.ts');
    }
  }

  return {
    probe: 'contract:mcp-health',
    category: 'contract',
    status: failures.length === 0 ? 'pass' : (failures.some(f => f.includes('build')) ? 'fail' : 'warn'),
    duration: Date.now() - start,
    summary: failures.length === 0 ? 'MCP infrastructure healthy' : `${failures.length} contract issues`,
    failures,
    meta,
  };
}

// ── Probe Registry ───────────────────────────────────────────────────────────
const PROBES = [
  { category: 'build', fn: probeBuild },
  { category: 'e2e', fn: probeE2E },
  { category: 'design', fn: probeDesignLint },
  { category: 'dogfood', fn: probeDogfoodGate },
  { category: 'voice', fn: probeVoiceCoverage },
  { category: 'a11y', fn: probeA11y },
  { category: 'visual', fn: probeGeminiQA },
  { category: 'performance', fn: probePerformance },
  { category: 'contract', fn: probeContract },
];

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log('=== Sentinel Runner (Layer 1: Self-Testing) ===\n');

  // Ensure report directory exists
  mkdirSync(REPORT_DIR, { recursive: true });

  const report = createReport();
  const activeProbes = PROBES.filter(p => shouldRun(p.category));

  log(`Running ${activeProbes.length} probes...\n`);

  for (const { category, fn } of activeProbes) {
    try {
      const result = await fn();
      report.probes.push(result);
      const icon = result.status === 'pass' ? 'OK' : result.status === 'fail' ? 'FAIL' : result.status === 'warn' ? 'WARN' : 'SKIP';
      log(`  ${icon} ${result.probe}: ${result.summary}`);
    } catch (err) {
      report.probes.push({
        probe: `${category}:error`,
        category,
        status: 'fail',
        duration: 0,
        summary: `Probe crashed: ${err.message}`,
        failures: [err.stack?.slice(0, 300) || err.message],
      });
      log(`  ERR ${category}: ${err.message}`);
    }
  }

  report.summary = computeSummary(report.probes);
  report.completedAt = new Date().toISOString();
  report.status = report.summary.failed > 0 ? 'failed' : 'completed';

  // Write report
  const reportPath = join(REPORT_DIR, `${report.id}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Also write latest symlink
  const latestPath = join(REPORT_DIR, 'latest.json');
  writeFileSync(latestPath, JSON.stringify(report, null, 2));

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(report, null, 2));
  } else {
    log('\n' + formatReportSummary(report));
    log(`\nReport saved: ${reportPath}`);
  }

  process.exit(report.summary.failed > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error('Sentinel runner crashed:', err);
    process.exit(2);
  });
}
