// Grid layout configurations and color schemes for DocumentGrid

export interface GridLayout {
  cols: number;
  rows: number;
  gridClass: string;
  name: string;
}

export interface DocumentTab {
  id: string;
  title: string;
  color: string;
  position: number;
}

// Predefined color palette for document tabs
export const TAB_COLORS = [
  { bg: "bg-[var(--accent-primary)]", ring: "ring-ring", shadow: "shadow-[var(--accent-primary)]/20", accent: "accent-[var(--accent-primary)]" },
  { bg: "bg-[var(--accent-secondary)]", ring: "ring-[var(--accent-secondary)]/60", shadow: "shadow-[var(--accent-secondary)]/20", accent: "accent-[var(--accent-secondary)]" },
  { bg: "bg-[var(--accent-primary)]", ring: "ring-ring", shadow: "shadow-[var(--accent-primary)]/20", accent: "accent-[var(--accent-primary)]" },
  { bg: "bg-[var(--accent-secondary)]", ring: "ring-[var(--accent-secondary)]/60", shadow: "shadow-[var(--accent-secondary)]/20", accent: "accent-[var(--accent-secondary)]" },
  { bg: "bg-[var(--accent-primary)]", ring: "ring-ring", shadow: "shadow-[var(--accent-primary)]/20", accent: "accent-[var(--accent-primary)]" },
  { bg: "bg-[var(--accent-secondary)]", ring: "ring-[var(--accent-secondary)]/60", shadow: "shadow-[var(--accent-secondary)]/20", accent: "accent-[var(--accent-secondary)]" },
  { bg: "bg-[var(--accent-primary)]", ring: "ring-ring", shadow: "shadow-[var(--accent-primary)]/20", accent: "accent-[var(--accent-primary)]" },
  { bg: "bg-[var(--accent-secondary)]", ring: "ring-[var(--accent-secondary)]/60", shadow: "shadow-[var(--accent-secondary)]/20", accent: "accent-[var(--accent-secondary)]" },
  { bg: "bg-[var(--accent-primary)]", ring: "ring-ring", shadow: "shadow-[var(--accent-primary)]/20", accent: "accent-[var(--accent-primary)]" },
  { bg: "bg-[var(--accent-secondary)]", ring: "ring-[var(--accent-secondary)]/60", shadow: "shadow-[var(--accent-secondary)]/20", accent: "accent-[var(--accent-secondary)]" },
  { bg: "bg-[var(--accent-primary)]", ring: "ring-ring", shadow: "shadow-[var(--accent-primary)]/20", accent: "accent-[var(--accent-primary)]" },
  { bg: "bg-[var(--accent-secondary)]", ring: "ring-[var(--accent-secondary)]/60", shadow: "shadow-[var(--accent-secondary)]/20", accent: "accent-[var(--accent-secondary)]" },
];

// Available grid layouts
export const GRID_LAYOUTS: GridLayout[] = [
  { cols: 1, rows: 1, gridClass: 'grid-cols-1 grid-rows-1', name: '1x1' },
  { cols: 2, rows: 1, gridClass: 'grid-cols-2 grid-rows-1', name: '2x1' },
  { cols: 2, rows: 2, gridClass: 'grid-cols-2 grid-rows-2', name: '2x2' },
  { cols: 3, rows: 1, gridClass: 'grid-cols-3 grid-rows-1', name: '3x1' },
  { cols: 3, rows: 2, gridClass: 'grid-cols-3 grid-rows-2', name: '3x2' },
  { cols: 3, rows: 3, gridClass: 'grid-cols-3 grid-rows-3', name: '3x3' },
  { cols: 4, rows: 1, gridClass: 'grid-cols-4 grid-rows-1', name: '4x1' },
  { cols: 4, rows: 2, gridClass: 'grid-cols-4 grid-rows-2', name: '4x2' },
  { cols: 4, rows: 3, gridClass: 'grid-cols-4 grid-rows-3', name: '4x3' },
  { cols: 4, rows: 4, gridClass: 'grid-cols-4 grid-rows-4', name: '4x4' },
];

// Utility function to generate color assignments
export function assignDocumentColor(index: number): string {
  return TAB_COLORS[index % TAB_COLORS.length].bg;
}
