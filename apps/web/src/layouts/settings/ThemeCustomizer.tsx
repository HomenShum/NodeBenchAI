import React from 'react';
import { Check, Monitor, Moon, RotateCcw, Sparkles, Sun } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import {
  ACCENT_COLORS,
  BackgroundPattern,
  FONT_FAMILIES,
  STYLE_PRESETS,
  ThemeDensity,
  ThemeMode,
} from '../../types/theme';

const PRESET_SWATCHES: Record<string, string> = {
  'electric-studio': 'linear-gradient(135deg, #0a0a0a 0%, #111827 45%, #4361EE 100%)',
  'bold-signal': 'linear-gradient(135deg, #191919 0%, #2b2b2b 42%, #FF5722 100%)',
  'dark-botanical': 'linear-gradient(135deg, #0f0f0f 0%, #211a19 45%, #D4A574 100%)',
  'notebook-tabs': 'linear-gradient(135deg, #f8f6f1 0%, #f3ede3 54%, #98d4bb 100%)',
  'terminal-green': 'linear-gradient(135deg, #0d1117 0%, #08110b 50%, #39D353 100%)',
};

export function ThemeCustomizer() {
  const {
    theme,
    resolvedMode,
    setMode,
    setAccentColor,
    setDensity,
    setFontFamily,
    setBackgroundPattern,
    setReducedMotion,
    applyStylePreset,
    resetToDefaults,
  } = useTheme();

  const modeOptions: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
    { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" /> },
  ];

  const densityOptions: { value: ThemeDensity; label: string }[] = [
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'compact', label: 'Compact' },
    { value: 'spacious', label: 'Spacious' },
  ];

  const patternOptions: { value: BackgroundPattern; label: string }[] = [
    { value: 'spotlight', label: 'Spotlight' },
    { value: 'grid', label: 'Grid' },
    { value: 'paper', label: 'Paper' },
    { value: 'lines', label: 'Lines' },
    { value: 'dots', label: 'Dots' },
    { value: 'noise', label: 'Noise' },
    { value: 'none', label: 'None' },
  ];

  return (
    <div className="space-y-7">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-content-secondary">
          <Sparkles className="h-4 w-4 text-[var(--accent-primary)]" />
          Frontend Slides presets
        </div>
        <p className="mb-3 text-xs leading-relaxed text-content-secondary">
          Curated styling directions adapted from the `frontend-slides` reference. Each preset changes
          typography, accent, and atmosphere together so the UI feels intentional instead of generic.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {STYLE_PRESETS.map((preset) => {
            const isActive =
              theme.mode === preset.mode &&
              theme.accentColor === preset.accentColor &&
              theme.fontFamily === preset.fontFamily &&
              theme.backgroundPattern === preset.backgroundPattern;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyStylePreset(preset.id)}
                className={`group rounded-2xl border p-3 text-left transition-all ${
                  isActive
                    ? 'border-[var(--accent-primary)] bg-surface shadow-md shadow-black/5'
                    : 'border-edge bg-surface hover:border-[var(--accent-primary)]/35 hover:bg-surface-hover'
                }`}
              >
                <div
                  className="mb-3 h-20 rounded-xl border border-white/10"
                  style={{ background: PRESET_SWATCHES[preset.id] ?? PRESET_SWATCHES['electric-studio'] }}
                />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-content">{preset.name}</div>
                    <div className="mt-1 text-xs leading-relaxed text-content-secondary">
                      {preset.vibe}
                    </div>
                  </div>
                  {isActive && (
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-primary)] text-white">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-content-secondary">
          Appearance
        </label>
        <div className="flex flex-wrap gap-2">
          {modeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setMode(option.value)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 transition-colors ${
                theme.mode === option.value
                  ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-content'
                  : 'border-edge text-content-secondary hover:border-[var(--accent-primary)]/25 hover:bg-surface-hover'
              }`}
            >
              {option.icon}
              <span className="text-sm">{option.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-content-secondary">
          Currently using: {resolvedMode} mode
        </p>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-content-secondary">
          Accent Color
        </label>
        <div className="flex flex-wrap gap-2">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color.name}
              type="button"
              onClick={() => setAccentColor(color.name)}
              className={`flex h-9 w-9 items-center justify-center rounded-full border transition-transform hover:scale-[1.04] ${
                theme.accentColor === color.name ? 'ring-2 ring-edge ring-offset-2 ring-offset-background' : 'border-white/10'
              }`}
              style={{ backgroundColor: color.value }}
              title={color.name}
            >
              {theme.accentColor === color.name && <Check className="h-4 w-4 text-white" />}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-content-secondary">
          Typography Pairing
        </label>
        <div className="space-y-2">
          {FONT_FAMILIES.map((font) => (
            <button
              key={font.name}
              type="button"
              onClick={() => setFontFamily(font.name)}
              className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                theme.fontFamily === font.name
                  ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/8'
                  : 'border-edge bg-surface hover:border-[var(--accent-primary)]/25 hover:bg-surface-hover'
              }`}
            >
              <div className="text-sm font-semibold text-content">{font.name}</div>
              <div className="mt-1 text-xs leading-relaxed text-content-secondary">{font.note}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-content-secondary">
          Background Treatment
        </label>
        <div className="flex flex-wrap gap-2">
          {patternOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setBackgroundPattern(option.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                theme.backgroundPattern === option.value
                  ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-content'
                  : 'border-edge bg-surface text-content-secondary hover:border-[var(--accent-primary)]/25 hover:text-content'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-content-secondary">
          Density
        </label>
        <div className="flex flex-wrap gap-2">
          {densityOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setDensity(option.value)}
              className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
                theme.density === option.value
                  ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-content'
                  : 'border-edge text-content-secondary hover:border-[var(--accent-primary)]/25 hover:bg-surface-hover'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <label className="block text-sm font-medium text-content-secondary">
            Reduce Motion
          </label>
          <p className="text-xs text-content-secondary">
            Minimize animations and keep transitions subtle.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReducedMotion(!theme.reducedMotion)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            theme.reducedMotion ? 'bg-[var(--accent-primary)]' : 'bg-surface-secondary'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              theme.reducedMotion ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-edge pt-4">
        <button
          type="button"
          onClick={resetToDefaults}
          className="flex items-center gap-2 text-sm text-content-secondary transition-colors hover:text-content"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
