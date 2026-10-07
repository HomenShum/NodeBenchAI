/**
 * Shared ID generation for server-side code.
 * Single source of truth — replaces 3+ divergent copies.
 */

let _counter = 0;

export function genId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  _counter = (_counter + 1) % 10000;
  return `${prefix}_${ts}_${rand}_${_counter.toString(36)}`;
}
