#!/usr/bin/env node
/**
 * Self-Improvement Loop — Opportunity Scanner (OBSERVE phase)
 *
 * Pattern: continuous improvement flywheel (find → score → act → verify → ship → record → loop).
 * Prior art:
 *   - NodeBench .claude/rules/flywheel_continuous.md, self_building_loop.md, eval_flywheel.md
 *   - Existing loops it UNIFIES rather than replaces: `dogfood:loop:auto` (Gemini QA),
 *     `dogfood:proto-live-backend` (live-backend ScratchNode dogfood), scripts/eval-harness.
 *
 * Emits a SCORED, EVIDENCED backlog of concrete, checkable opportunities. Every detector is
 * deterministic and cites file:line — no LLM "vibes" scoring (HONEST_SCORES). The agent brain
 * (see .claude/rules/self_improvement_loop.md) reads this backlog, picks the top auto-safe item,
 * implements, verifies, ships, and records the cycle.
 *
 * Scoring:  score = impact(1..5) * confidence(0..1) / effort(1..5)
 *           safety='human' opportunities are QUEUED (score forced to 0) — never auto-shipped.
 *
 * Usage:    node scripts/improvement-loop/scan.mjs [--surface <glob>] [--json]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'backlog.latest.json');

// The surfaces the loop currently owns. Start narrow (ScratchNode), widen as the loop matures.
const SURFACES = [
  { id: 'scratchnode-room', file: 'public/proto/home-v5.html', kind: 'static-html' },
];

const readLines = (rel) => {
  const abs = resolve(REPO, rel);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8').split('\n');
};

let _seq = 0;
const opp = (o) => {
  const impact = o.impact, confidence = o.confidence, effort = o.effort;
  const queued = o.safety === 'human';
  const score = queued ? 0 : +(impact * confidence / effort).toFixed(3);
  return { id: `OPP-${String(++_seq).padStart(3, '0')}`, score, queued, ...o };
};

/** Detector: leftover engineering markers — only the ACTIONABLE annotation form.
 *  Precision hardening (loop cycle 1): dropped `XXX` (false-positives on `?token=XXX`
 *  URL-param placeholders in docs) and require an annotation shape (`TODO:` / `FIXME(`
 *  / `HACK -`) inside a comment, so documentation that merely mentions the word is ignored. */
function detectMarkers(surface, lines) {
  const out = [];
  const isComment = (s) => /(^|\s)(\/\/|\/\*|\*|<!--|#)/.test(s);
  const rx = /\b(TODO|FIXME|HACK)\b\s*[:(\-]/;
  lines.forEach((ln, i) => {
    if (!isComment(ln)) return;
    const m = ln.match(rx);
    if (m) out.push(opp({
      title: `Resolve leftover ${m[1]} marker`,
      surface: surface.id, source: 'code-scan', file: `${surface.file}:${i + 1}`,
      evidence: ln.trim().slice(0, 160),
      impact: 2, confidence: 0.9, effort: 2, safety: 'auto',
    }));
  });
  return out;
}

/** Detector: icon-only <button> with an <svg> child but no aria-label (a11y P1). */
function detectIconButtonsWithoutLabel(surface, lines) {
  const out = [];
  const text = lines.join('\n');
  // crude tag matcher: <button ...> ... </button> on a manageable window
  const buttonRx = /<button\b[^>]*>[\s\S]*?<\/button>/g;
  let m;
  while ((m = buttonRx.exec(text))) {
    const tag = m[0];
    const openTag = tag.slice(0, tag.indexOf('>') + 1);
    const hasSvg = /<svg\b/.test(tag);
    const hasText = /<\/svg>\s*[^<\s][^<]*</.test(tag) || />\s*[A-Za-z0-9]/.test(tag.replace(/<svg[\s\S]*?<\/svg>/, ''));
    const hasLabel = /aria-label\s*=/.test(openTag) || /aria-labelledby\s*=/.test(openTag);
    if (hasSvg && !hasLabel && !hasText) {
      const line = text.slice(0, m.index).split('\n').length;
      out.push(opp({
        title: 'Icon-only button missing aria-label',
        surface: surface.id, source: 'a11y-scan', file: `${surface.file}:${line}`,
        evidence: openTag.slice(0, 140),
        impact: 3, confidence: 0.7, effort: 1, safety: 'auto',
      }));
    }
  }
  return out;
}

/** Detector: @keyframes without a paired prefers-reduced-motion guard mentioning its selector.
 *  Honest heuristic — flags animations that may not be motion-safe; the agent confirms before fixing. */
function detectUnguardedKeyframes(surface, lines) {
  const out = [];
  const text = lines.join('\n');
  const names = [...text.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  // Collect classes/selectors that reference each animation by name, then check a reduced-motion
  // block disables animation for at least one of those selectors.
  const reducedBlocks = [...text.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}\s*\}?/g)]
    .map((m) => m[1]).join('\n');
  for (const name of new Set(names)) {
    const usedBy = [...text.matchAll(new RegExp(`animation[^;{]*\\b${name}\\b`, 'g'))].length;
    if (usedBy === 0) continue; // defined but unused — separate concern
    // Is there ANY reduced-motion rule that sets animation:none AND is plausibly for this animation?
    const guarded = new RegExp(`${name}`).test(reducedBlocks) ||
      /animation\s*:\s*none/.test(reducedBlocks); // lenient: a blanket guard counts
    if (!guarded) {
      const line = text.slice(0, text.indexOf(`@keyframes ${name}`)).split('\n').length;
      out.push(opp({
        title: `Animation "${name}" may lack a prefers-reduced-motion guard`,
        surface: surface.id, source: 'a11y-motion-scan', file: `${surface.file}:${line}`,
        evidence: `@keyframes ${name} used ${usedBy}x; no reduced-motion rule disables it`,
        impact: 3, confidence: 0.5, effort: 2, safety: 'auto',
      }));
    }
  }
  return out;
}

/** Detector: user-facing placeholder/stale copy.
 *  Precision hardening (loop cycle 1): dropped "Coming soon" — it is intentional, honest
 *  product messaging here (e.g. `data-coming-soon="true"` for the in-development L2 capture
 *  level), NOT stale copy. Only genuine placeholders remain. */
function detectStaleCopy(surface, lines) {
  const out = [];
  const rx = /(Lorem ipsum|\bTBD\b|placeholder text|REPLACE ME|dummy text)/i;
  lines.forEach((ln, i) => {
    if (rx.test(ln) && !/\/\//.test(ln.split(rx)[0] || '')) {
      out.push(opp({
        title: 'Stale / placeholder user-facing copy',
        surface: surface.id, source: 'content-scan', file: `${surface.file}:${i + 1}`,
        evidence: ln.trim().slice(0, 160),
        impact: 2, confidence: 0.6, effort: 1, safety: 'auto',
      }));
    }
  });
  return out;
}

/** Detector: honesty-contract-adjacent edits are SAFETY-gated (queued for human sign-off). */
function detectSafetyGatedZones(surface, lines) {
  // We don't fabricate opportunities here; we record that these zones exist so the agent
  // knows any change touching them is human-gated, not auto-shippable.
  const text = lines.join('\n');
  const zones = [];
  if (/data-sn-live-error|sendComposerMessage|seenIds|seenAnswerIds/.test(text)) {
    zones.push('honesty contract (live send/render, no-mock-on-fail)');
  }
  return zones;
}

function main() {
  const opportunities = [];
  const safetyZones = {};
  for (const surface of SURFACES) {
    const lines = readLines(surface.file);
    if (!lines) continue;
    opportunities.push(
      ...detectMarkers(surface, lines),
      ...detectIconButtonsWithoutLabel(surface, lines),
      ...detectUnguardedKeyframes(surface, lines),
      ...detectStaleCopy(surface, lines),
    );
    safetyZones[surface.id] = detectSafetyGatedZones(surface, lines);
  }
  // Rank: auto-safe by score desc, then queued (human) items after.
  opportunities.sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));

  const backlog = {
    generatedAtNote: 'timestamp stamped by run-cycle.mjs (scanner stays deterministic for reproducibility)',
    repoSurfaces: SURFACES.map((s) => s.file),
    safetyZones,
    counts: {
      total: opportunities.length,
      autoSafe: opportunities.filter((o) => !o.queued).length,
      humanGated: opportunities.filter((o) => o.queued).length,
    },
    opportunities,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(backlog, null, 2));
  const top = opportunities.filter((o) => !o.queued).slice(0, 5);
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(backlog, null, 2) + '\n');
  } else {
    console.log(`[scan] ${backlog.counts.total} opportunities (${backlog.counts.autoSafe} auto-safe, ${backlog.counts.humanGated} human-gated)`);
    console.log(`[scan] backlog → ${OUT}`);
    console.log('[scan] top auto-safe:');
    top.forEach((o, i) => console.log(`  ${i + 1}. [${o.score}] ${o.title}  (${o.file})`));
  }
  return backlog;
}

main();
