#!/usr/bin/env node
/**
 * Sentinel Diagnose (Layer 2) — Self-Diagnosing
 *
 * Reads the latest sentinel report, analyzes failures, performs 5-whys
 * root-cause analysis, and produces a prioritized list of diagnoses
 * with suggested fixes and affected files.
 *
 * Usage:
 *   node scripts/sentinel/diagnose.mjs                    # diagnose latest report
 *   node scripts/sentinel/diagnose.mjs --report <path>    # diagnose specific report
 *   node scripts/sentinel/diagnose.mjs --json             # JSON output
 *
 * This is deterministic (no LLM) — uses pattern matching on failure messages.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { triageDiagnoses, SEVERITY } from './schema.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const REPORT_DIR = join(ROOT, '.sentinel');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const reportPathArg = (() => {
  const idx = args.indexOf('--report');
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
})();

function log(msg) {
  if (!jsonOutput) process.stderr.write(msg + '\n');
}

// ── Diagnosis Pattern Engine ─────────────────────────────────────────────────
// Each pattern: { match: (probe) => bool, diagnose: (probe) => DiagnosisItem[] }

let diagId = 0;
function nextId() { return `diag-${String(++diagId).padStart(3, '0')}`; }

const DIAGNOSTIC_PATTERNS = [
  // ── Build: TypeScript errors ──
  {
    match: (p) => p.category === 'build' && p.status === 'fail',
    diagnose: (p) => {
      const items = [];
      for (const f of p.failures || []) {
        // Parse TS error: src/foo.ts(10,5): error TS2345: ...
        const m = f.match(/^(.+?)\((\d+),\d+\):\s*error\s+(TS\d+):\s*(.+)/);
        if (m) {
          items.push({
            id: nextId(),
            probe: p.probe,
            symptom: `TypeScript ${m[3]}: ${m[4].slice(0, 100)}`,
            rootCause: classifyTsError(m[3], m[4]),
            affectedFiles: [m[1]],
            severity: SEVERITY.critical,
            blastRadius: 10, // build blocks everything
            suggestedFix: suggestTsFix(m[3], m[4]),
            status: 'pending',
          });
        }
      }
      // Dedup by file
      const seen = new Set();
      return items.filter(i => {
        const key = i.affectedFiles[0] + ':' + i.symptom.slice(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  },

  // ── Build: Vite build failure ──
  {
    match: (p) => p.category === 'build' && p.failures?.some(f => f.includes('Vite build failed')),
    diagnose: (p) => [{
      id: nextId(),
      probe: p.probe,
      symptom: 'Vite production build fails',
      rootCause: 'Build pipeline broken — likely import resolution or chunk splitting issue',
      affectedFiles: ['vite.config.ts'],
      severity: SEVERITY.critical,
      blastRadius: 29, // all views
      suggestedFix: 'Check vite.config.ts for broken aliases, circular imports, or missing externals',
      status: 'pending',
    }],
  },

  // ── E2E: Test failures ──
  {
    match: (p) => p.category === 'e2e' && p.status === 'fail',
    diagnose: (p) => {
      const items = [];
      for (const f of (p.failures || []).slice(0, 10)) {
        // Parse: "test title: error message"
        const [title, ...errParts] = f.split(':');
        const err = errParts.join(':').trim();
        items.push({
          id: nextId(),
          probe: p.probe,
          symptom: `E2E failure: ${title.trim().slice(0, 80)}`,
          rootCause: classifyE2EError(err),
          affectedFiles: guessFilesFromTestTitle(title),
          severity: SEVERITY.high,
          blastRadius: 1,
          suggestedFix: `Fix the ${title.trim()} test or the component it tests`,
          status: 'pending',
        });
      }
      return items;
    },
  },

  // ── Design: High-severity violations ──
  {
    match: (p) => p.category === 'design' && p.status === 'fail',
    diagnose: (p) => {
      const items = [];
      for (const f of (p.failures || []).slice(0, 10)) {
        // Parse: [category] file:line — label
        const m = f.match(/\[(.+?)\]\s+(.+?):(\d+)\s*—\s*(.+)/);
        if (m) {
          items.push({
            id: nextId(),
            probe: p.probe,
            symptom: `Design violation: ${m[4].trim()}`,
            rootCause: `File uses hardcoded values instead of design tokens (${m[1]} category)`,
            affectedFiles: [m[2]],
            severity: SEVERITY.medium,
            blastRadius: 1,
            suggestedFix: `Replace hardcoded ${m[1]} value at line ${m[3]} with semantic token`,
            status: 'pending',
          });
        }
      }
      return items;
    },
  },

  // ── Dogfood: Missing artifacts ──
  {
    match: (p) => p.category === 'dogfood' && p.status === 'fail',
    diagnose: (p) => {
      const items = [];
      for (const f of p.failures || []) {
        if (f.includes('manifest')) {
          items.push({
            id: nextId(),
            probe: p.probe,
            symptom: 'Dogfood screenshots stale or missing',
            rootCause: 'Dogfood capture pipeline not run recently',
            affectedFiles: ['public/dogfood/manifest.json'],
            severity: SEVERITY.medium,
            blastRadius: 1,
            suggestedFix: 'Run: npm run dogfood:full:local',
            status: 'pending',
          });
        } else if (f.includes('scribe')) {
          items.push({
            id: nextId(),
            probe: p.probe,
            symptom: 'Scribe walkthrough stale or missing',
            rootCause: 'Scribe capture not run after recent UI changes',
            affectedFiles: ['public/dogfood/scribe.json'],
            severity: SEVERITY.low,
            blastRadius: 1,
            suggestedFix: 'Run: npm run dogfood:scribe',
            status: 'pending',
          });
        }
      }
      if (items.length === 0 && p.failures?.length) {
        items.push({
          id: nextId(),
          probe: p.probe,
          symptom: `Dogfood gate failures: ${p.failures.length}`,
          rootCause: 'Dogfood artifacts need refresh',
          affectedFiles: ['public/dogfood/'],
          severity: SEVERITY.medium,
          blastRadius: 1,
          suggestedFix: 'Run: npm run dogfood:verify',
          status: 'pending',
        });
      }
      return items;
    },
  },

  // ── Voice: Coverage gaps ──
  {
    match: (p) => p.category === 'voice' && p.failures?.length > 0,
    diagnose: (p) => {
      const items = [];
      for (const f of p.failures || []) {
        if (f.includes('Missing action callback')) {
          const action = f.match(/callback:\s*(\w+)/)?.[1] || 'unknown';
          items.push({
            id: nextId(),
            probe: p.probe,
            symptom: f,
            rootCause: `Voice intent router has no handler for ${action}`,
            affectedFiles: ['src/hooks/useVoiceIntentRouter.ts', 'src/layouts/CockpitLayout.tsx'],
            severity: SEVERITY.medium,
            blastRadius: 1,
            suggestedFix: `Add ${action} to VoiceIntentActions interface and wire in CockpitLayout`,
            status: 'pending',
          });
        } else if (f.includes('VIEW_ALIASES missing')) {
          const view = f.match(/target:\s*(\S+)/)?.[1] || 'unknown';
          items.push({
            id: nextId(),
            probe: p.probe,
            symptom: f,
            rootCause: `VIEW_ALIASES in useVoiceIntentRouter.ts doesn't map any alias to "${view}"`,
            affectedFiles: ['src/hooks/useVoiceIntentRouter.ts'],
            severity: SEVERITY.low,
            blastRadius: 1,
            suggestedFix: `Add alias entry for "${view}" in VIEW_ALIASES map`,
            status: 'pending',
          });
        }
      }
      return items;
    },
  },

  // ── A11y: Touch target violations ──
  {
    match: (p) => p.category === 'a11y' && p.failures?.length > 0,
    diagnose: (p) => {
      const items = [];
      for (const f of (p.failures || []).slice(0, 5)) {
        if (f.includes('Touch target')) {
          const fileMatch = f.match(/:\s*(.+?\.tsx?):\d+/);
          items.push({
            id: nextId(),
            probe: p.probe,
            symptom: 'WCAG 2.5.8: Interactive element below 44px touch target',
            rootCause: 'Button/clickable element uses w-8/h-8 or smaller instead of min-w-11/min-h-11',
            affectedFiles: fileMatch ? [fileMatch[1]] : ['src/'],
            severity: SEVERITY.medium,
            blastRadius: 1,
            suggestedFix: 'Add min-w-11 min-h-11 (44px) to interactive element',
            status: 'pending',
          });
        }
      }
      return items;
    },
  },

  // ── Visual: Low Gemini QA scores ──
  {
    match: (p) => p.category === 'visual' && p.failures?.length > 0,
    diagnose: (p) => (p.failures || []).map(f => ({
      id: nextId(),
      probe: p.probe,
      symptom: f,
      rootCause: 'UI visual quality below threshold — check recent design changes',
      affectedFiles: ['src/'],
      severity: SEVERITY.medium,
      blastRadius: 5,
      suggestedFix: 'Run dogfood:loop:auto to iteratively fix visual issues',
      status: 'pending',
    })),
  },

  // ── Contract: MCP infrastructure issues ──
  {
    match: (p) => p.category === 'contract' && p.failures?.length > 0,
    diagnose: (p) => {
      const items = [];
      for (const f of p.failures || []) {
        if (f.includes('MCP build')) {
          items.push({
            id: nextId(),
            probe: p.probe,
            symptom: f,
            rootCause: 'MCP local package has TypeScript compilation errors',
            affectedFiles: ['packages/mcp-local/src/'],
            severity: SEVERITY.critical,
            blastRadius: 239, // all MCP tools affected
            suggestedFix: 'Fix TypeScript errors in packages/mcp-local/src/',
            status: 'pending',
          });
        } else if (f.includes('vitest')) {
          items.push({
            id: nextId(),
            probe: p.probe,
            symptom: 'MCP test suite has failures',
            rootCause: 'Tool handlers or schemas changed without updating tests',
            affectedFiles: ['packages/mcp-local/src/__tests__/'],
            severity: SEVERITY.high,
            blastRadius: 10,
            suggestedFix: 'Run: cd packages/mcp-local && npx vitest run — fix failing tests',
            status: 'pending',
          });
        } else if (f.includes('registry')) {
          items.push({
            id: nextId(),
            probe: p.probe,
            symptom: f,
            rootCause: 'Tool registry entries were removed or file corrupted',
            affectedFiles: ['packages/mcp-local/src/tools/toolRegistry.ts'],
            severity: SEVERITY.high,
            blastRadius: 50,
            suggestedFix: 'Check toolRegistry.ts for accidental deletions or syntax errors',
            status: 'pending',
          });
        } else if (f.includes('Missing self-eval')) {
          items.push({
            id: nextId(),
            probe: p.probe,
            symptom: f,
            rootCause: 'Self-eval infrastructure file was deleted or moved',
            affectedFiles: [f.match(/:\s*(.+)/)?.[1] || 'packages/mcp-local/src/tools/'],
            severity: SEVERITY.high,
            blastRadius: 5,
            suggestedFix: 'Restore the missing file from git: git checkout -- <file>',
            status: 'pending',
          });
        } else if (f.includes('agent contract')) {
          items.push({
            id: nextId(),
            probe: p.probe,
            symptom: 'Agent contract prompt missing from metaTools',
            rootCause: 'The agent-contract methodology was removed from metaTools.ts',
            affectedFiles: ['packages/mcp-local/src/tools/metaTools.ts'],
            severity: SEVERITY.medium,
            blastRadius: 3,
            suggestedFix: 'Restore agent-contract section in getMethodology()',
            status: 'pending',
          });
        }
      }
      return items;
    },
  },
];

// ── Classifiers ──────────────────────────────────────────────────────────────
function classifyTsError(code, msg) {
  if (code === 'TS2345' || code === 'TS2322') return 'Type mismatch — likely a prop interface changed without updating callers';
  if (code === 'TS2304') return 'Cannot find name — missing import or undeclared variable';
  if (code === 'TS2307') return 'Cannot find module — missing dependency or broken path alias';
  if (code === 'TS7006') return 'Implicit any — parameter needs type annotation';
  if (code === 'TS2339') return 'Property does not exist — object shape changed';
  return `TypeScript error ${code}: ${msg.slice(0, 60)}`;
}

function suggestTsFix(code, msg) {
  if (code === 'TS2345' || code === 'TS2322') return 'Update the type or add the missing prop to the interface';
  if (code === 'TS2304') return 'Add the missing import statement';
  if (code === 'TS2307') return 'Install the missing package or fix the import path';
  if (code === 'TS7006') return 'Add explicit type annotation to the parameter';
  if (code === 'TS2339') return 'Update the type definition or use optional chaining';
  return `Fix TypeScript ${code} error`;
}

function classifyE2EError(err) {
  if (!err) return 'E2E test failed (no error details)';
  if (err.includes('timeout') || err.includes('Timeout')) return 'Element not found within timeout — component may not render or selector changed';
  if (err.includes('expect(')) return 'Assertion failed — expected behavior does not match actual';
  if (err.includes('navigation')) return 'Navigation failed — route may be broken or loading too slow';
  return `E2E error: ${err.slice(0, 80)}`;
}

function guessFilesFromTestTitle(title) {
  const clean = title.trim().toLowerCase();
  // Map test names to likely source files
  if (clean.includes('voice')) return ['src/hooks/useVoiceIntentRouter.ts', 'src/components/hud/JarvisHUDLayout.tsx'];
  if (clean.includes('agent')) return ['src/features/agents/components/FastAgentPanel/FastAgentPanel.tsx'];
  if (clean.includes('calendar')) return ['src/features/calendar/views/CalendarView.tsx'];
  if (clean.includes('document')) return ['src/features/documents/views/'];
  if (clean.includes('research')) return ['src/features/research/views/ResearchHub.tsx'];
  if (clean.includes('sidebar')) return ['src/features/redesign/components/Rail.tsx', 'src/layouts/WorkspaceRail.tsx'];
  if (clean.includes('setting')) return ['src/layouts/settings/SettingsModal.tsx'];
  if (clean.includes('funding')) return ['src/features/research/views/FundingBriefView.tsx'];
  if (clean.includes('benchmark')) return ['src/features/benchmarks/views/WorkbenchView.tsx'];
  return ['src/'];
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  log('=== Sentinel Diagnose (Layer 2: Self-Diagnosing) ===\n');

  // Load report
  const reportPath = reportPathArg || join(REPORT_DIR, 'latest.json');
  if (!existsSync(reportPath)) {
    log('No sentinel report found. Run: node scripts/sentinel/runner.mjs first');
    process.exit(2);
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  log(`Analyzing report: ${report.id}`);
  log(`Probes: ${report.probes.length} | Failed: ${report.summary.failed}\n`);

  // Run diagnosis patterns against each failed/warned probe
  const diagnoses = [];
  for (const probe of report.probes) {
    if (probe.status === 'pass' || probe.status === 'skip') continue;

    for (const pattern of DIAGNOSTIC_PATTERNS) {
      if (pattern.match(probe)) {
        try {
          const items = pattern.diagnose(probe);
          diagnoses.push(...items);
        } catch (err) {
          log(`  Warning: pattern failed on ${probe.probe}: ${err.message}`);
        }
      }
    }
  }

  // Triage
  const triaged = triageDiagnoses(diagnoses);

  // Update report
  report.diagnoses = triaged;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Also write standalone diagnosis file
  const diagPath = join(REPORT_DIR, 'diagnoses.json');
  writeFileSync(diagPath, JSON.stringify({
    reportId: report.id,
    analyzedAt: new Date().toISOString(),
    total: triaged.length,
    bySeverity: {
      critical: triaged.filter(d => d.severity === SEVERITY.critical).length,
      high: triaged.filter(d => d.severity === SEVERITY.high).length,
      medium: triaged.filter(d => d.severity === SEVERITY.medium).length,
      low: triaged.filter(d => d.severity === SEVERITY.low).length,
    },
    diagnoses: triaged,
  }, null, 2));

  if (jsonOutput) {
    process.stdout.write(JSON.stringify({ diagnoses: triaged }, null, 2));
  } else {
    log(`\n── ${triaged.length} Diagnoses (triaged by severity + blast radius) ──\n`);
    for (const d of triaged) {
      const sev = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'][d.severity];
      log(`  [${sev}] ${d.id}: ${d.symptom}`);
      log(`    Root cause: ${d.rootCause}`);
      log(`    Fix: ${d.suggestedFix}`);
      log(`    Files: ${d.affectedFiles.join(', ')}`);
      log('');
    }

    if (triaged.length === 0) {
      log('  All probes passed — nothing to diagnose.\n');
    }

    log(`Diagnosis saved: ${diagPath}`);
  }

  process.exit(triaged.filter(d => d.severity <= SEVERITY.high).length > 0 ? 1 : 0);
}

main();
