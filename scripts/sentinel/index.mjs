#!/usr/bin/env node
/**
 * Sentinel — Main entry point for the self-testing pipeline
 *
 * Usage:
 *   node scripts/sentinel/index.mjs              # full: test → diagnose → report
 *   node scripts/sentinel/index.mjs --fix        # full + spawn fixer agent prompt
 *   node scripts/sentinel/index.mjs --swarm      # generate swarm prompts
 *   node scripts/sentinel/index.mjs --json       # JSON output
 *   node scripts/sentinel/index.mjs --probes e2e # filter probes
 *
 * npm scripts:
 *   npm run sentinel
 *   npm run sentinel:test
 *   npm run sentinel:diagnose
 *   npm run sentinel:swarm
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { formatReportSummary } from './schema.mjs';
import { SENTINEL_FIX_PROMPT_RELATIVE } from './paths.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const SENTINEL_DIR = join(ROOT, '.sentinel');
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const wantSwarm = args.includes('--swarm');
const wantFix = args.includes('--fix');

function log(msg) {
  if (!jsonOutput) process.stderr.write(msg + '\n');
}

function run(cmd) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  log('');
  log('================================================================');
  log('  SENTINEL — Self-Testing, Self-Diagnosing, Self-Correcting');
  log('================================================================');
  log('');

  // ── Layer 1: Test ──
  log('[Layer 1] Running probes...\n');
  const probeArgs = args.filter(a => a.startsWith('--probes')).join(' ');
  const runnerArgs = jsonOutput ? '--json' : '';
  run(`node scripts/sentinel/runner.mjs ${probeArgs} ${runnerArgs}`.trim());

  // ── Layer 2: Diagnose ──
  log('\n[Layer 2] Diagnosing failures...\n');
  run(`node scripts/sentinel/diagnose.mjs ${runnerArgs}`.trim());

  // ── Layer 3: Report or Fix ──
  const reportPath = join(SENTINEL_DIR, 'latest.json');
  if (existsSync(reportPath)) {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));

    if (jsonOutput) {
      process.stdout.write(JSON.stringify(report, null, 2));
    } else {
      log('\n' + formatReportSummary(report));

      if (report.diagnoses?.length > 0) {
        log('\n── Next Steps ──');
        if (wantFix) {
          log('  Use the sentinel agent prompt to fix issues:');
          log(`  Feed ${SENTINEL_FIX_PROMPT_RELATIVE} to Claude Code`);
        } else if (wantSwarm) {
          log('  Generating swarm prompts...');
          run('node scripts/sentinel/swarm.mjs');
        } else {
          log('  To fix automatically:  node scripts/sentinel/index.mjs --fix');
          log('  To use swarm agents:   node scripts/sentinel/index.mjs --swarm');
          log('  To re-run probes only: node scripts/sentinel/runner.mjs');
        }
      } else {
        log('\nAll systems green. Nothing to fix.');
      }
    }

    process.exit(report.summary?.failed > 0 ? 1 : 0);
  } else {
    log('\nNo report generated — check for errors above.');
    process.exit(2);
  }
}

main().catch(err => {
  console.error('Sentinel crashed:', err);
  process.exit(2);
});
