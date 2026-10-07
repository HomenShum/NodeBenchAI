/**
 * Theme System Types
 * Defines all theme-related types for the application.
 *
 * This layer now carries a small set of curated visual presets inspired by
 * `frontend-slides`, so the app can adopt stronger typography + atmosphere
 * combinations instead of drifting toward generic defaults.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

export type ThemeDensity = 'comfortable' | 'compact' | 'spacious';

export type BackgroundPattern =
  | 'none'
  | 'dots'
  | 'grid'
  | 'lines'
  | 'noise'
  | 'spotlight'
  | 'paper';

export type LayoutMode = 'classic' | 'cockpit';

export interface ThemeAccentColor {
  name: string;
  value: string;
  hoverValue: string;
  lightValue: string;
}

export interface ThemeFontFamily {
  name: string;
  body: string;
  display: string;
  note: string;
}

export interface ThemeStylePreset {
  id: string;
  name: string;
  source: string;
  vibe: string;
  mode: ThemeMode;
  accentColor: string;
  fontFamily: string;
  backgroundPattern: BackgroundPattern;
  density?: ThemeDensity;
}

export const ACCENT_COLORS: ThemeAccentColor[] = [
  { name: 'terracotta', value: '#d97757', hoverValue: '#c96a4d', lightValue: '#fbe8df' },
  { name: 'electric-blue', value: '#4361EE', hoverValue: '#3651D4', lightValue: '#DBE4FF' },
  { name: 'signal-coral', value: '#FF5722', hoverValue: '#E64A19', lightValue: '#FFE1D6' },
  { name: 'botanical-gold', value: '#D4A574', hoverValue: '#BC8D5D', lightValue: '#F4E7D7' },
  { name: 'terminal-green', value: '#39D353', hoverValue: '#2FB344', lightValue: '#D7F8DF' },
  { name: 'orchid', value: '#8B5CF6', hoverValue: '#7C3AED', lightValue: '#EDE9FE' },
  { name: 'sage', value: '#5A7C6A', hoverValue: '#496556', lightValue: '#DDE8E1' },
  { name: 'crimson', value: '#C41E3A', hoverValue: '#A8172F', lightValue: '#F8D8DF' },
  { name: 'indigo', value: '#6366F1', hoverValue: '#4F46E5', lightValue: '#E0E7FF' },
];

export const FONT_FAMILIES: ThemeFontFamily[] = [
  {
    name: 'Manrope Studio',
    body: '"Manrope", system-ui, sans-serif',
    display: '"Manrope", system-ui, sans-serif',
    note: 'Clean control-plane default inspired by Electric Studio.',
  },
  {
    name: 'Signal Grotesk',
    body: '"Space Grotesk", system-ui, sans-serif',
    display: '"Archivo Black", "Arial Black", system-ui, sans-serif',
    note: 'High-contrast display pairing inspired by Bold Signal.',
  },
  {
    name: 'Botanical Serif',
    body: '"IBM Plex Sans", system-ui, sans-serif',
    display: '"Cormorant Garamond", Georgia, serif',
    note: 'Premium editorial serif pairing inspired by Dark Botanical.',
  },
  {
    name: 'Editorial Fraunces',
    body: '"Work Sans", system-ui, sans-serif',
    display: '"Fraunces", Georgia, serif',
    note: 'Distinct light-theme editorial tone inspired by Vintage Editorial.',
  },
  {
    name: 'Terminal Mono',
    body: '"JetBrains Mono", "Fira Code", monospace',
    display: '"JetBrains Mono", "Fira Code", monospace',
    note: 'Monospace-only presentation inspired by Terminal Green.',
  },
  {
    name: 'System',
    body: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    display: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    note: 'Fallback neutral system stack.',
  },
];

export const STYLE_PRESETS: ThemeStylePreset[] = [
  {
    id: 'electric-studio',
    name: 'Electric Studio',
    source: 'frontend-slides',
    vibe: 'Bold, clean, professional, high contrast',
    mode: 'dark',
    accentColor: 'electric-blue',
    fontFamily: 'Manrope Studio',
    backgroundPattern: 'grid',
    density: 'comfortable',
  },
  {
    id: 'bold-signal',
    name: 'Bold Signal',
    source: 'frontend-slides',
    vibe: 'Confident, modern, card-first control plane',
    mode: 'dark',
    accentColor: 'signal-coral',
    fontFamily: 'Signal Grotesk',
    backgroundPattern: 'spotlight',
    density: 'comfortable',
  },
  {
    id: 'dark-botanical',
    name: 'Dark Botanical',
    source: 'frontend-slides',
    vibe: 'Premium, warm, editorial dark mode',
    mode: 'dark',
    accentColor: 'botanical-gold',
    fontFamily: 'Botanical Serif',
    backgroundPattern: 'noise',
    density: 'spacious',
  },
  {
    id: 'notebook-tabs',
    name: 'Notebook Tabs',
    source: 'frontend-slides',
    vibe: 'Paper-like, organized, tactile light mode',
    mode: 'light',
    accentColor: 'sage',
    fontFamily: 'Editorial Fraunces',
    backgroundPattern: 'paper',
    density: 'comfortable',
  },
  {
    id: 'terminal-green',
    name: 'Terminal Green',
    source: 'frontend-slides',
    vibe: 'Operator-console mono aesthetic',
    mode: 'dark',
    accentColor: 'terminal-green',
    fontFamily: 'Terminal Mono',
    backgroundPattern: 'lines',
    density: 'compact',
  },
];

export interface ThemePreferences {
  mode: ThemeMode;
  accentColor: string;
  density: ThemeDensity;
  fontFamily: string;
  backgroundPattern: BackgroundPattern;
  reducedMotion: boolean;
  layout: LayoutMode;
}

export const DEFAULT_THEME: ThemePreferences = {
  mode: 'light',
  accentColor: 'terracotta',
  density: 'comfortable',
  fontFamily: 'Manrope Studio',
  backgroundPattern: 'spotlight',
  reducedMotion: false,
  layout: 'cockpit',
};

export interface ThemeContextValue {
  theme: ThemePreferences;
  resolvedMode: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: string) => void;
  setDensity: (density: ThemeDensity) => void;
  setFontFamily: (font: string) => void;
  setBackgroundPattern: (pattern: BackgroundPattern) => void;
  setReducedMotion: (reduced: boolean) => void;
  setLayout: (layout: LayoutMode) => void;
  applyStylePreset: (presetId: string) => void;
  resetToDefaults: () => void;
}
