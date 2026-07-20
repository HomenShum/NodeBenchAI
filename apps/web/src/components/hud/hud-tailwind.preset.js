/**
 * @nodebench/hud Tailwind CSS preset
 *
 * Consumers add to their tailwind.config:
 *   presets: [require('@nodebench/hud/tailwind')]
 *
 * Provides HUD-specific colors, animations, and keyframes.
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        'hud-cyan': 'var(--hud-cyan, #00e5ff)',
        'hud-amber': 'var(--hud-amber, #ffc107)',
        'hud-green': 'var(--hud-green, #00e676)',
        'hud-red': 'var(--hud-red, #ff1744)',
        'hud-purple': 'var(--hud-purple, #d1c4e9)',
      },
      keyframes: {
        'hud-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'hud-acquire': {
          '0%': { opacity: '0.5', transform: 'scale(0.92)' },
          '50%': { opacity: '1', transform: 'scale(1.06)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'hud-beam': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(250%)' },
        },
        'hud-glow-breathe': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.7' },
        },
        'hud-materialize': {
          from: { opacity: '0', filter: 'blur(3px)', transform: 'scale(0.985)' },
          to: { opacity: '1', filter: 'blur(0)', transform: 'scale(1)' },
        },
      },
      animation: {
        'hud-pulse': 'hud-pulse 2s ease-in-out infinite',
        'hud-acquire': 'hud-acquire 0.35s ease-out',
        'hud-beam': 'hud-beam 6s linear infinite',
        'hud-glow-breathe': 'hud-glow-breathe 3s ease-in-out infinite',
        'hud-materialize': 'hud-materialize 0.25s ease-out both',
      },
    },
  },
};
