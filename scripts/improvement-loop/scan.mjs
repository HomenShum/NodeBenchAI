#!/usr/bin/env node
/**
 * Self-Improvement Loop — Opportunity Scanner (OBSERVE phase)
 *
 * Pattern: continuous improvement flywheel (find -> score -> act -> verify -> ship -> record -> loop).
 * Prior art:
 *   - NodeBench .claude/rules/flywheel_continuous.md, self_building_loop.md, eval_flywheel.md
 *   - Existing loops it UNIFIES rather than replaces: dogfood:loop:auto (Gemini QA),
 *     dogfood:proto-live-backend (live-backend ScratchNode dogfood), scripts/eval-harness.
 *
 * Emits a SCORED, EVIDENCED backlog of concrete, checkable opportunities. Every detector is
 * deterministic and cites file:line — no LLM "vibes" scoring (HONEST_SCORES). The agent brain
 * (see .claude/rules/self_improvement_loop.md) reads this backlog, picks the top auto-safe item,
 * VALIDATES it (rejecting false positives), implements, verifies, ships, and records the cycle.
 *
 * Scoring:  score = impact(1..5) * confidence(0..1) / effort(1..5)
 *           safety='human' opportunities are QUEUED (score forced to 0) — never auto-shipped.
 *
 * Usage:    node scripts/improvement-loop/scan.mjs [--json]
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
  const queued = o.safety === 'human';
  const score = queued ? 0 : +(o.impact * o.confidence / o.effort).toFixed(3);
  return { id: `OPP-${String(++_seq).padStart(3, '0')}`, score, queued, ...o };
};

// Blank out CSS and HTML comments (preserving newlines + length so file:line stays accurate),
// so tag detectors never match example markup that lives inside a comment. Learned in cycles
// C001/C002, where `<button>` in a CSS comment and `XXX` in doc comments were false positives.
function maskComments(text) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)   // CSS / JS block comments
    .replace(/<!--[\s\S]*?-->/g, blank);   // HTML comments
}

// Index ranges of every <form>...</form> so we can tell whether a button is inside a real form
// (where a missing type means implicit SUBMIT — behavior-sensitive, must be human-gated).
function formRanges(text) {
  const ranges = [];
  const re = /<form\b[\s\S]*?<\/form>/g;
  let m;
  while ((m = re.exec(text))) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}
const inAnyRange = (idx, ranges) => ranges.some(([a, b]) => idx >= a && idx < b);
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

/** Leftover engineering markers — only the ACTIONABLE annotation form, inside a comment.
 *  Hardened C001: dropped XXX (false-positives on ?token=XXX URL-param placeholders) and require
 *  an annotation shape (TODO: / FIXME( / HACK -) so prose mentioning the word is ignored. */
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

/** Icon-only <button> with an <svg> child but no aria-label (a11y). */
function detectIconButtonsWithoutLabel(surface, lines) {
  const out = [];
  const text = maskComments(lines.join('\n'));
  const buttonRx = /<button\b[^>]*>[\s\S]*?<\/button>/g;
  let m;
  while ((m = buttonRx.exec(text))) {
    const tag = m[0];
    const openTag = tag.slice(0, tag.indexOf('>') + 1);
    const hasSvg = /<svg\b/.test(tag);
    const hasText = />\s*[A-Za-z0-9]/.test(tag.replace(/<svg[\s\S]*?<\/svg>/, ''));
    const hasLabel = /aria-label\s*=/.test(openTag) || /aria-labelledby\s*=/.test(openTag);
    if (hasSvg && !hasLabel && !hasText) {
      out.push(opp({
        title: 'Icon-only button missing aria-label',
        surface: surface.id, source: 'a11y-scan', file: `${surface.file}:${lineOf(text, m.index)}`,
        evidence: openTag.slice(0, 140),
        impact: 3, confidence: 0.7, effort: 1, safety: 'auto',
      }));
    }
  }
  return out;
}

/** @keyframes used by an animation with no prefers-reduced-motion guard (motion a11y).
 *  Lenient heuristic — a blanket reduced-motion guard counts; the agent confirms before fixing. */
function detectUnguardedKeyframes(surface, lines) {
  const out = [];
  const text = lines.join('\n');
  const names = [...text.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  const reducedBlocks = [...text.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}\s*\}?/g)]
    .map((m) => m[1]).join('\n');
  for (const name of new Set(names)) {
    const usedBy = [...text.matchAll(new RegExp(`animation[^;{]*\\b${name}\\b`, 'g'))].length;
    if (usedBy === 0) continue;
    const guarded = new RegExp(name).test(reducedBlocks) || /animation\s*:\s*none/.test(reducedBlocks);
    if (!guarded) {
      out.push(opp({
        title: `Animation "${name}" may lack a prefers-reduced-motion guard`,
        surface: surface.id, source: 'a11y-motion-scan', file: `${surface.file}:${lineOf(text, text.indexOf(`@keyframes ${name}`))}`,
        evidence: `@keyframes ${name} used ${usedBy}x; no reduced-motion rule disables it`,
        impact: 3, confidence: 0.5, effort: 2, safety: 'auto',
      }));
    }
  }
  return out;
}

/** User-facing placeholder/stale copy. Hardened C001: dropped "Coming soon" — it is intentional,
 *  honest product messaging here (e.g. the in-development L2 capture level), not stale copy. */
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

/** <button> without an explicit type. Outside a form -> auto-safe (add type="button").
 *  Inside a form -> HUMAN-GATED: removing the implicit submit could change behavior (SAFETY).
 *  Comment-masked (C002) so example <button> markup in comments is not flagged. */
function detectButtonsWithoutType(surface, lines) {
  const out = [];
  const text = maskComments(lines.join('\n'));
  const ranges = formRanges(text);
  const re = /<button\b([^>]*)>/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[1];
    if (/\btype\s*=/.test(attrs)) continue;
    const within = inAnyRange(m.index, ranges);
    out.push(opp({
      title: within
        ? 'Button without explicit type inside a <form> — verify submit intent'
        : 'Button missing type="button" (implicit-submit footgun)',
      surface: surface.id, source: 'a11y-form-scan', file: `${surface.file}:${lineOf(text, m.index)}`,
      evidence: ('<button' + attrs + '>').slice(0, 140),
      impact: 2, confidence: within ? 0.5 : 0.85, effort: 1,
      safety: within ? 'human' : 'auto',
    }));
  }
  return out;
}

/** target="_blank" anchors missing rel="noopener" (reverse-tabnabbing). */
function detectUnsafeBlankLinks(surface, lines) {
  const out = [];
  const text = maskComments(lines.join('\n'));
  const re = /<a\b([^>]*\btarget\s*=\s*"_blank"[^>]*)>/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[1];
    if (/\brel\s*=\s*"[^"]*noopener/.test(attrs)) continue;
    out.push(opp({
      title: 'target="_blank" link missing rel="noopener" (reverse-tabnabbing)',
      surface: surface.id, source: 'security-scan', file: `${surface.file}:${lineOf(text, m.index)}`,
      evidence: ('<a' + attrs + '>').slice(0, 140),
      impact: 3, confidence: 0.9, effort: 1, safety: 'auto',
    }));
  }
  return out;
}

/** <img> without an alt attribute (a11y). Decorative images should use alt="". */
function detectImagesWithoutAlt(surface, lines) {
  const out = [];
  const text = maskComments(lines.join('\n'));
  const re = /<img\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[1];
    if (/\balt\s*=/.test(attrs)) continue;
    out.push(opp({
      title: 'Image missing alt attribute (a11y)',
      surface: surface.id, source: 'a11y-scan', file: `${surface.file}:${lineOf(text, m.index)}`,
      evidence: ('<img' + attrs + '>').slice(0, 140),
      impact: 3, confidence: 0.8, effort: 1, safety: 'auto',
    }));
  }
  return out;
}

// Anchor used as a button: <a onclick=...> with no href and no role. Not keyboard-
// focusable and announced as a link by screen readers. Auto-safe fix: role/tabindex/keydown.
function detectAnchorButtons(surface, lines) {
  const out = [];
  const text = maskComments(lines.join('\n'));
  const re = /<a\b([^>]*)>/g;
  let m;
  while ((m = re.exec(text))) {
    const a = m[1];
    if (!/\bonclick\s*=/.test(a)) continue;
    if (/\bhref\s*=/.test(a)) continue;
    if (/\brole\s*=/.test(a)) continue;
    out.push(opp({
      title: 'Anchor used as a button (onclick, no href/role) — not keyboard/SR accessible',
      surface: surface.id, source: 'a11y-scan', file: surface.file + ':' + lineOf(text, m.index),
      evidence: ('<a' + a + '>').slice(0, 140),
      impact: 3, confidence: 0.85, effort: 2, safety: 'auto',
    }));
  }
  return out;
}

/** Honesty-contract-adjacent zones — recorded so the agent knows changes there are human-gated. */
function detectSafetyGatedZones(surface, lines) {
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
      ...detectButtonsWithoutType(surface, lines),
      ...detectUnsafeBlankLinks(surface, lines),
      ...detectImagesWithoutAlt(surface, lines),
      ...detectAnchorButtons(surface, lines),
    );
    safetyZones[surface.id] = detectSafetyGatedZones(surface, lines);
  }
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
    console.log(`[scan] backlog -> ${OUT}`);
    console.log('[scan] top auto-safe:');
    top.forEach((o, i) => console.log(`  ${i + 1}. [${o.score}] ${o.title}  (${o.file})`));
  }
  return backlog;
}

main();
