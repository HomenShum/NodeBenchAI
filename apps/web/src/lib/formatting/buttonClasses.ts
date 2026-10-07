/**
 * Lightweight button class presets for consistent Daily Brief UX.
 */

export const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export const buttonSecondary =
  `${buttonBase} bg-surface-secondary hover:bg-surface-hover text-content border-edge`;

export const buttonDanger =
  `${buttonBase} bg-surface hover:bg-red-50 text-red-700 border-red-200`;

export const buttonIcon =
  "p-1 rounded transition-colors hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed";

