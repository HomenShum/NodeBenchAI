/* Utility functions for proposal diffs: list-aware and intraline code highlighting */

export type DiffOp = { type: 'eq' | 'add' | 'del'; line: string };
export type AnnotatedOp = DiffOp & { moved?: boolean; pairIndex?: number; role?: 'from' | 'to' };
export type MovePair = { from: number; to: number; text: string };

// Basic line diff (LCS). Optimized enough for short blocks.
export function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = 1 + dp[i + 1][j + 1];
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', line: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', line: a[i++] });
    } else {
      ops.push({ type: 'add', line: b[j++] });
    }
  }
  while (i < n) ops.push({ type: 'del', line: a[i++] });
  while (j < m) ops.push({ type: 'add', line: b[j++] });
  return ops;
}

// List helpers
const listRe = /^(\s*)([-*+]|(\d+)\.)\s+(.*)$/;
export type ListItem = { indent: string; marker: string; text: string };
export function parseListLine(line: string): ListItem | null {
  const m = line.match(listRe);
  if (!m) return null;
  const indent = m[1] ?? '';
  const marker = m[2] ?? '-';
  const text = m[4] ?? '';
  return { indent, marker, text };
}
export function isMostlyList(lines: string[]): boolean {
  if (lines.length === 0) return false;
  let cnt = 0;
  for (const ln of lines) if (parseListLine(ln)) cnt++;
  return cnt / lines.length >= 0.5;
}
export function diffListItems(current: string, proposed: string): DiffOp[] {
  const aLines = current.split('\n');
  const bLines = proposed.split('\n');
  const aItems = aLines.map(parseListLine);
  const bItems = bLines.map(parseListLine);
  if (!isMostlyList(aLines) || !isMostlyList(bLines)) {
    return diffLines(aLines, bLines);
  }
  const aTexts = aItems.map((it) => (it ? it.text : ''));
  const bTexts = bItems.map((it) => (it ? it.text : ''));
  const base = diffLines(aTexts, bTexts);
  // Rebuild with markers when possible
  const rebuild = (type: 'eq'|'add'|'del', text: string): string => {
    // Try to find corresponding line in original arrays by text match (first occurrence)
    const src = type === 'add' ? bItems : aItems;
    for (let i = 0; i < src.length; i++) {
      const it = src[i];
      if (it && it.text === text) return `${it.indent}${it.marker} ${it.text}`;
    }
    // fallback without markers
    return text;
  };
  return base.map((op) => ({ type: op.type, line: rebuild(op.type, op.line) }));
}

// Code helpers with Prism intraline highlighting
let PrismRef: any = null;
export function prismHighlight(code: string, lang?: string): string {
  try {
    if (!PrismRef) PrismRef = require('prismjs');
    const Prism = PrismRef;
    // Common fallback languages
    const key = (lang || '').toLowerCase();
    const grammar = (Prism.languages)[key] || Prism.languages.javascript || Prism.languages.clike || Prism.languages.markup;
    return Prism.highlight(code, grammar, key || 'javascript');
  } catch {
    // Fallback: escape HTML
    return escapeHtml(code);
  }
}
export function detectFenceLang(text: string): string | undefined {
  const m = text.split('\n')[0]?.match(/^```\s*([\w-]+)?/);
  return (m && m[1]) ? m[1] : undefined;
}
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"] /g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c] || c);
}

export function diffWords(oldLine: string, newLine: string): { oldHtml: string; newHtml: string } {
  const a = oldLine.split(/(\s+)/).filter(Boolean);
  const b = newLine.split(/(\s+)/).filter(Boolean);
  const ops = diffLines(a, b);
  const oldParts: string[] = [];
  const newParts: string[] = [];
  for (const op of ops) {
    if (op.type === 'eq') {
      oldParts.push(escapeHtml(op.line));
      newParts.push(escapeHtml(op.line));
    } else if (op.type === 'del') {
      oldParts.push(`<mark class="nb-del">${escapeHtml(op.line)}</mark>`);
    } else if (op.type === 'add') {
      newParts.push(`<mark class="nb-add">${escapeHtml(op.line)}</mark>`);
    }
  }
  return { oldHtml: oldParts.join(''), newHtml: newParts.join('') };
}

export function computeStructuredOps(current: string, proposed: string): { kind: 'list' | 'plain'; ops: DiffOp[] } {
  const a = current.split('\n');
  const b = proposed.split('\n');
  if (isMostlyList(a) && isMostlyList(b)) {
    return { kind: 'list', ops: diffListItems(current, proposed) };
  }
  return { kind: 'plain', ops: diffLines(a, b) };
}

// Heuristic move pairing for list-aware diffs (and can be used for plain too)
export function annotateMoves(ops: DiffOp[]): { ops: AnnotatedOp[]; pairs: MovePair[] } {
  const norm = (s: string) => s.replace(/^(\s*)([-*+]|(\d+)\.)\s+/, '').trim();
  const adds: Map<string, number[]> = new Map();
  const dels: Map<string, number[]> = new Map();
  ops.forEach((op, idx) => {
    if (op.type === 'add') {
      const key = norm(op.line);
      const arr = adds.get(key) || [];
      arr.push(idx);
      adds.set(key, arr);
    } else if (op.type === 'del') {
      const key = norm(op.line);
      const arr = dels.get(key) || [];
      arr.push(idx);
      dels.set(key, arr);
    }
  });
  const annotated: AnnotatedOp[] = ops.map((o) => ({ ...o }));
  const pairs: MovePair[] = [];
  let pairCounter = 0;
  for (const [text, delIdxs] of dels.entries()) {
    const addIdxs = adds.get(text);
    if (!addIdxs || addIdxs.length === 0) continue;
    const count = Math.min(delIdxs.length, addIdxs.length);
    for (let i = 0; i < count; i++) {
      const from = delIdxs[i];
      const to = addIdxs[i];
      annotated[from].moved = true;
      annotated[to].moved = true;
      annotated[from].pairIndex = pairCounter;
      annotated[to].pairIndex = pairCounter;
      annotated[from].role = 'from';
      annotated[to].role = 'to';
      pairs.push({ from, to, text });
      pairCounter++;
    }
  }
  return { ops: annotated, pairs };
}

