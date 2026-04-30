import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  ThemePreferences,
  ThemeContextValue,
  ThemeMode,
  ThemeDensity,
  BackgroundPattern,
  LayoutMode,
  DEFAULT_THEME,
  ACCENT_COLORS,
  FONT_FAMILIES,
  STYLE_PRESETS,
} from '../types/theme';

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_STORAGE_VERSION = 'web-kit-light-v1';

function hexToHslTriplet(hex: string): string {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized;

  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return `0 0% ${Math.round(lightness * 100)}%`;
  }

  const delta = max - min;
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue = 0;
  switch (max) {
    case r:
      hue = (g - b) / delta + (g < b ? 6 : 0);
      break;
    case g:
      hue = (b - r) / delta + 2;
      break;
    default:
      hue = (r - g) / delta + 4;
      break;
  }

  hue /= 6;

  return `${Math.round(hue * 360)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// Safe hook that returns defaults when outside provider
export function useThemeSafe(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      theme: DEFAULT_THEME,
      resolvedMode: 'light',
      setMode: () => {},
      setAccentColor: () => {},
      setDensity: () => {},
      setFontFamily: () => {},
      setBackgroundPattern: () => {},
      setReducedMotion: () => {},
      setLayout: () => {},
      applyStylePreset: () => {},
      resetToDefaults: () => {},
    };
  }
  return context;
}

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // Load from localStorage first for instant hydration
  const [theme, setTheme] = useState<ThemePreferences>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME;
    try {
      const saved = localStorage.getItem('nodebench-theme');
      if (saved) {
        const parsed = JSON.parse(saved);
        const next = { ...DEFAULT_THEME, ...parsed };
        const savedVersion = localStorage.getItem('nodebench-theme-version');
        if (savedVersion !== THEME_STORAGE_VERSION && next.mode === 'system') {
          return { ...next, mode: 'system' };
        }
        return next;
      }

      // NOTE(coworker): Legacy support — some tests/older builds persisted a plain
      // `theme=dark|light` key without the full ThemePreferences payload.
      const legacyMode = localStorage.getItem('theme');

      const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
      if (legacyMode === 'dark' || legacyMode === 'light') {
        return { ...DEFAULT_THEME, mode: legacyMode, reducedMotion: prefersReducedMotion };
      }

      return { ...DEFAULT_THEME, mode: 'system', reducedMotion: prefersReducedMotion };
    } catch {
      return DEFAULT_THEME;
    }
  });

  // Resolve system preference
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Follow OS reduced-motion changes at runtime.
  // Only applies when the user has not persisted an explicit preference — once
  // they toggle it manually in Settings, their choice takes precedence.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('nodebench-theme')) {
        setTheme(prev => ({ ...prev, reducedMotion: e.matches }));
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolvedMode = useMemo(() => {
    if (theme.mode === 'system') {
      return systemPrefersDark ? 'dark' : 'light';
    }
    return theme.mode;
  }, [theme.mode, systemPrefersDark]);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    
    // Dark mode class
    if (resolvedMode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Accent color CSS variables
    const accent = ACCENT_COLORS.find(c => c.name === theme.accentColor) || ACCENT_COLORS[0];
    const accentHsl = hexToHslTriplet(accent.value);
    root.style.setProperty('--accent-color', accent.value);
    root.style.setProperty('--accent-color-hover', accent.hoverValue);
    root.style.setProperty('--accent-color-light', accent.lightValue);
    root.style.setProperty('--accent-primary', accent.value);
    root.style.setProperty('--accent-primary-hover', accent.hoverValue);
    root.style.setProperty('--accent-primary-bg', accent.lightValue);
    root.style.setProperty('--primary', accentHsl);
    root.style.setProperty('--ring', accentHsl);

    // Font pairing CSS variables
    const fontPair = FONT_FAMILIES.find(font => font.name === theme.fontFamily) || FONT_FAMILIES[0];
    root.style.setProperty('--font-ui', fontPair.body);
    root.style.setProperty('--font-display', fontPair.display);

    // Density + background + preset marker
    root.dataset.density = theme.density;
    root.dataset.backgroundPattern = theme.backgroundPattern;

    // Derive active preset from current theme state for CSS selectors
    const matchedPreset = STYLE_PRESETS.find(
      (p) =>
        p.mode === theme.mode &&
        p.accentColor === theme.accentColor &&
        p.fontFamily === theme.fontFamily &&
        p.backgroundPattern === theme.backgroundPattern,
    );
    if (matchedPreset) {
      root.dataset.preset = matchedPreset.id;
    } else {
      delete root.dataset.preset;
    }

    // Reduced motion
    if (theme.reducedMotion) {
      root.classList.add('reduce-motion');
    } else {
      root.classList.remove('reduce-motion');
    }

    // Persist to localStorage
    localStorage.setItem('nodebench-theme', JSON.stringify(theme));
    localStorage.setItem('nodebench-theme-version', THEME_STORAGE_VERSION);
    localStorage.setItem('theme', resolvedMode); // Legacy support
  }, [theme, resolvedMode]);

  // Setters
  const setMode = useCallback((mode: ThemeMode) => {
    setTheme(prev => ({ ...prev, mode }));
  }, []);

  const setAccentColor = useCallback((accentColor: string) => {
    setTheme(prev => ({ ...prev, accentColor }));
  }, []);

  const setDensity = useCallback((density: ThemeDensity) => {
    setTheme(prev => ({ ...prev, density }));
  }, []);

  const setFontFamily = useCallback((fontFamily: string) => {
    setTheme(prev => ({ ...prev, fontFamily }));
  }, []);

  const setBackgroundPattern = useCallback((backgroundPattern: BackgroundPattern) => {
    setTheme(prev => ({ ...prev, backgroundPattern }));
  }, []);

  const setReducedMotion = useCallback((reducedMotion: boolean) => {
    setTheme(prev => ({ ...prev, reducedMotion }));
  }, []);

  const setLayout = useCallback((layout: LayoutMode) => {
    setTheme(prev => ({ ...prev, layout }));
  }, []);

  const applyStylePreset = useCallback((presetId: string) => {
    const preset = STYLE_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    // Set data-preset on <html> so CSS selectors like html[data-preset="dark-botanical"] activate
    document.documentElement.dataset.preset = presetId;
    setTheme((prev) => ({
      ...prev,
      mode: preset.mode,
      accentColor: preset.accentColor,
      fontFamily: preset.fontFamily,
      backgroundPattern: preset.backgroundPattern,
      density: preset.density ?? prev.density,
    }));
  }, []);

  const resetToDefaults = useCallback(() => {
    setTheme(DEFAULT_THEME);
  }, []);

  const value: ThemeContextValue = useMemo(() => ({
    theme,
    resolvedMode,
    setMode,
    setAccentColor,
    setDensity,
    setFontFamily,
    setBackgroundPattern,
    setReducedMotion,
    setLayout,
    applyStylePreset,
    resetToDefaults,
  }), [theme, resolvedMode, setMode, setAccentColor, setDensity, setFontFamily, setBackgroundPattern, setReducedMotion, setLayout, applyStylePreset, resetToDefaults]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
