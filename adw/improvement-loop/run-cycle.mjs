#!/usr/bin/env node
/**
 * Self-Improvement Loop — Cycle Orchestrator.
 *
 * Runs ONE cycle of OBSERVE → SCORE → SELECT → RECORD and prints the selected work item
 * for the agent brain to IMPLEMENT → VERIFY → SHIP (see .claude/rules/self_improvement_loop.md).
 *
 * This script is the deterministic substrate; the agent is the brain. The script never edits
 * product code and never ships — it observes, scores, and records. That division keeps autonomy
 * safe: code changes only ever happen through a human-or-agent authored branch + CI-gated PR.
 *
 * Records the cycle to a durable git-tracked ledger ALWAYS, and to the live Convex backend
 * (table `improvementLoopCycles`) when `--push-convex` is passed and the deployment is reachable.
 * Convex failures degrade gracefully and are recorded honestly (HONEST_STATUS) — never faked.
 *
 * Usage:  node scripts/improvement-loop/run-cycle.mjs [--effort-budget 3] [--push-convex] [--note "..."]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const LEDGER = resolve(HERE, 'ledger.json');
const BACKLOG = resolve(HERE, 'backlog.latest.json');

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? true) : def;
};
const EFFORT_BUDGET = Number(arg('--effort-budget', 3));
const PUSH_CONVEX = process.argv.includes('--push-convex');
const NOTE = arg('--note', '');

function loadLedger() {
  if (!existsSync(LEDGER)) {
    return {
      loop: 'scratchnode-self-improvement',
      createdNote: 'Continuous self-improvement loop ledger. Append-only. See docs/architecture/SELF_IMPROVEMENT_LOOP.md',
      killCriteria: { consecutiveNoShipLimit: 3, requireGreenVerification: true },
      consecutiveNoShip: 0,
      cycles: [],
    };
  }
  return JSON.parse(readFileSync(LEDGER, 'utf8'));
}

function runScan() {
  const r = spawnSync(process.execPath, [resolve(HERE, 'scan.mjs')], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || 'scan failed').slice(0, 400) };
  }
  const backlog = JSON.parse(readFileSync(BACKLOG, 'utf8'));
  return { ok: true, backlog };
}

function pushConvex(record) {
  // Honest, bounded attempt: write to the live backend ledger if the function is deployed.
  // Never fakes success — a failure is recorded as { ok:false, error } on the cycle.
  const payload = JSON.stringify({
    cycleId: record.cycleId,
    at: record.at,
    selected: record.selected ? record.selected.title : null,
    selectedScore: record.selected ? record.selected.score : 0,
    totalOpportunities: record.scan.total,
    autoSafe: record.scan.autoSafe,
    humanGated: record.scan.humanGated,
    outcome: record.outcome,
    note: record.note || '',
  });
  const r = spawnSync('npx', ['convex', 'run', 'improvementLoop:recordCycle', payload], {
    cwd: REPO, encoding: 'utf8', timeout: 60000, shell: process.platform === 'win32',
  });
  if (r.status === 0) return { ok: true };
  const errText = (r.stderr || r.stdout || 'convex run failed').trim();
  if (/could not find|not a function|no such|404/i.test(errText)) return { ok: false, reason: 'endpoint-not-deployed' };
  return { ok: false, error: errText.slice(0, 300) };
}

function main() {
  const ledger = loadLedger();
  const scan = runScan();
  const at = new Date().toISOString();
  const cycleId = `C${String(ledger.cycles.length + 1).padStart(3, '0')}`;

  if (!scan.ok) {
    const rec = { cycleId, at, scan: { error: scan.error }, selected: null, outcome: 'scan_error', note: NOTE };
    ledger.cycles.push(rec);
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
    console.error(`[cycle ${cycleId}] SCAN ERROR: ${scan.error}`);
    process.exit(1);
  }

  const b = scan.backlog;
  const candidates = b.opportunities.filter((o) => !o.queued && o.effort <= EFFORT_BUDGET);
  const selected = candidates[0] || null;

  const outcome = selected ? 'selected_for_implementation' : 'clean_no_auto_opportunities';
  const record = {
    cycleId, at,
    scan: { total: b.counts.total, autoSafe: b.counts.autoSafe, humanGated: b.counts.humanGated },
    safetyZones: b.safetyZones,
    selected: selected && { id: selected.id, title: selected.title, score: selected.score, file: selected.file, evidence: selected.evidence },
    backlogTop: b.opportunities.filter((o) => !o.queued).slice(0, 5).map((o) => ({ id: o.id, score: o.score, title: o.title, file: o.file })),
    outcome,
    liveSignal: null, // HONEST_STATUS: set by the agent ONLY after live-DOM verify; null = not verified
    note: NOTE,
  };

  // Kill-criteria bookkeeping (no-ship streak). A "selected" cycle is expected to ship downstream.
  ledger.consecutiveNoShip = selected ? 0 : (ledger.consecutiveNoShip || 0) + 1;
  if (!selected && ledger.consecutiveNoShip >= ledger.killCriteria.consecutiveNoShipLimit) {
    record.strategySignal = `STRATEGY-SHIFT: ${ledger.consecutiveNoShip} consecutive clean cycles — expand detectors/surfaces (see roadmap).`;
  }

  if (PUSH_CONVEX) record.convex = pushConvex(record);

  ledger.cycles.push(record);
  ledger.updatedAt = at;
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');

  console.log(`[cycle ${cycleId}] @ ${at}`);
  console.log(`[cycle ${cycleId}] scan: ${record.scan.total} total / ${record.scan.autoSafe} auto-safe / ${record.scan.humanGated} human-gated`);
  if (selected) {
    console.log(`[cycle ${cycleId}] SELECTED → [${selected.score}] ${selected.title} (${selected.file})`);
    console.log(`[cycle ${cycleId}] AGENT: implement on a branch, verify (tsc+e2e+dogfood), ship via PR --auto, then record outcome.`);
  } else {
    console.log(`[cycle ${cycleId}] CLEAN — no auto-safe opportunities within effort budget ${EFFORT_BUDGET}.`);
    if (record.strategySignal) console.log(`[cycle ${cycleId}] ${record.strategySignal}`);
  }
  if (record.convex) console.log(`[cycle ${cycleId}] convex ledger: ${record.convex.ok ? 'recorded' : 'degraded (' + (record.convex.reason || record.convex.error) + ')'}`);
  console.log(`[cycle ${cycleId}] ledger → ${LEDGER}`);
}

main();
