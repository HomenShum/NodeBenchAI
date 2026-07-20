/**
 * formatNumber — Centralized number formatting utilities.
 *
 * PURPOSE (for other coding agents):
 * Provides consistent number formatting across the app.
 * All numeric displays (counts, tokens, costs, percentages) should use
 * these formatters to ensure thousands separators and proper precision.
 *
 * USAGE:
 *   import { fmtInt, fmtDecimal, fmtCompact, fmtPercent, fmtCost } from '@/lib/formatNumber';
 *   <span>{fmtInt(1234567)}</span>       // → "1,234,567"
 *   <span>{fmtCompact(1234567)}</span>   // → "1.2M"
 *   <span>{fmtPercent(0.856)}</span>     // → "85.6%"
 *   <span>{fmtCost(12.5)}</span>         // → "$12.50"
 */

// Pre-instantiate formatters for performance — avoid creating new Intl objects per render.
const INT_FMT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const DEC1_FMT = new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const DEC2_FMT = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COMPACT_FMT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const PCT_FMT = new Intl.NumberFormat(undefined, { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** Format integer with thousands separators: 1234567 → "1,234,567" */
export function fmtInt(value: number): string {
  return INT_FMT.format(Math.round(value));
}

/** Format with 1 decimal: 1234.56 → "1,234.6" */
export function fmtDecimal(value: number): string {
  return DEC1_FMT.format(value);
}

/** Format compact: 1234567 → "1.2M", 1234 → "1.2K" */
export function fmtCompact(value: number): string {
  return COMPACT_FMT.format(value);
}

/** Format percentage from 0–1 ratio: 0.856 → "85.6%" */
export function fmtPercent(value: number): string {
  return PCT_FMT.format(value);
}

/** Format percentage from 0–100 value: 85.6 → "85.6%" */
export function fmtPct100(value: number): string {
  return `${DEC1_FMT.format(value)}%`;
}

/** Format cost: 12.5 → "$12.50" */
export function fmtCost(value: number): string {
  return `$${DEC2_FMT.format(value)}`;
}

/** Format tokens (abbreviated): 1234567 → "1.2M", 1234 → "1.2K", 123 → "123" */
export function fmtTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${DEC1_FMT.format(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${DEC1_FMT.format(tokens / 1_000)}K`;
  return INT_FMT.format(tokens);
}

/** Format milliseconds to human-readable: 150 → "150ms", 1500 → "1.5s" */
export function fmtMs(ms: number): string {
  if (typeof ms !== 'number' || isNaN(ms)) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${DEC1_FMT.format(ms / 1000)}s`;
}
