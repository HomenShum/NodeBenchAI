const { fontFamily } = require("tailwindcss/defaultTheme");

module.exports = {
  darkMode: 'class',
  content: ["./apps/web/index.html", "./apps/web/src/**/*.{js,jsx,ts,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        /* Resolved at runtime by ThemeContext via --font-ui / --font-display */
        sans: ["var(--font-ui)", ...fontFamily.sans],
        display: ["var(--font-display)", ...fontFamily.sans],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      /* Transition durations backed by the CSS design tokens defined in
         src/index.css (--duration-fast/normal/slow). Consuming these via
         Tailwind (e.g. `duration-normal`) keeps timing consistent across
         the codebase and allows one edit at the token level to propagate
         everywhere. Preserves Tailwind defaults (duration-150, etc.)
         for ad-hoc usage. */
      transitionDuration: {
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        "out-expo": "var(--ease-out-expo)",
        spring: "var(--ease-spring)",
      },
      borderRadius: {
        DEFAULT: "8px",
        sm: "6px",
        md: "8px",
        lg: "10px",
        xl: "12px",
        "2xl": "16px",
        secondary: "4px",
        container: "12px",
      },
      boxShadow: {
        DEFAULT: "0 0 0 1px rgba(0, 0, 0, 0.03), 0 1px 2px rgba(0, 0, 0, 0.04)",
        sm: "0 0 0 1px rgba(0, 0, 0, 0.02), 0 1px 2px rgba(0, 0, 0, 0.04)",
        md: "0 0 0 1px rgba(0, 0, 0, 0.03), 0 2px 4px rgba(0, 0, 0, 0.05), 0 12px 24px rgba(0, 0, 0, 0.05)",
        lg: "0 0 0 1px rgba(0, 0, 0, 0.03), 0 4px 8px rgba(0, 0, 0, 0.06), 0 24px 48px rgba(0, 0, 0, 0.08)",
        xl: "0 0 0 1px rgba(0, 0, 0, 0.03), 0 8px 16px rgba(0, 0, 0, 0.08), 0 32px 64px rgba(0, 0, 0, 0.10)",
        hover: "0 0 0 1px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.08)",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "var(--accent-primary-hover)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
          hover: "#4B5563",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          hover: "var(--accent-primary-hover)",
          primary: "var(--accent-primary)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        brand: {
          dark: "#111827",
          indigo: "#5E6AD2",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /* Semantic aliases — use these for new code */
        surface: {
          DEFAULT: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          hover: "var(--bg-hover)",
        },
        content: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        edge: {
          DEFAULT: "var(--border-color)",
        },
      },
      zIndex: {
        raised: '10',
        sidebar: '20',
        sticky: '30',
        overlay: '40',
        modal: '50',
        toast: '60',
      },
      spacing: {
        "form-field": "16px",
        section: "32px",
      },
      letterSpacing: {
        'panel': '-0.02em',
        'label': '-0.01em',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'gradient-flow': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'fade-slide-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-slide-out': {
          '0%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(-8px)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.8)', opacity: '1' },
          '50%': { transform: 'scale(1)', opacity: '0.5' },
          '100%': { transform: 'scale(0.8)', opacity: '1' },
        },
        'progress-fill': {
          '0%': { strokeDashoffset: '100' },
          '100%': { strokeDashoffset: '0' },
        },
        'typewriter-blink': {
          '0%, 50%': { opacity: '1' },
          '51%, 100%': { opacity: '0' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'border-flow': {
          '0%': { backgroundPosition: '0% 0%' },
          '100%': { backgroundPosition: '200% 0%' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'pulse-subtle': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.02)' },
        },
        'skeleton-shimmer': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'spring-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'slide-up-spring': {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        /* frontend-slides entrance patterns */
        'reveal-up': {
          '0%': { opacity: '0', transform: 'translateY(30px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'reveal-scale': {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'reveal-left': {
          '0%': { opacity: '0', transform: 'translateX(-40px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'reveal-blur': {
          '0%': { opacity: '0', filter: 'blur(10px)' },
          '100%': { opacity: '1', filter: 'blur(0)' },
        },
        'reveal-right': {
          '0%': { opacity: '0', transform: 'translateX(40px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        'expo-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'spring': 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      animation: {
        shimmer: 'shimmer 2s ease-in-out infinite',
        'gradient-flow': 'gradient-flow 3s ease infinite',
        'fade-slide-in': 'fade-slide-in 0.3s ease-out forwards',
        'fade-slide-out': 'fade-slide-out 0.2s ease-in forwards',
        'pulse-ring': 'pulse-ring 2s ease-in-out infinite',
        'progress-fill': 'progress-fill 1s ease-out forwards',
        'typewriter-blink': 'typewriter-blink 1s step-end infinite',
        'scale-in': 'scale-in 0.2s ease-out forwards',
        'border-flow': 'border-flow 3s linear infinite',
        'spin-slow': 'spin-slow 20s linear infinite',
        'pulse-subtle': 'pulse-subtle 4s ease-in-out infinite',
        'skeleton-shimmer': 'skeleton-shimmer 1.5s ease-in-out infinite',
        'spring-in': 'spring-in 0.2s cubic-bezier(0.32, 0.72, 0, 1) forwards',
        'slide-up-spring': 'slide-up-spring 0.2s cubic-bezier(0.32, 0.72, 0, 1) forwards',
        /* frontend-slides entrance animations */
        'reveal-up': 'reveal-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'reveal-scale': 'reveal-scale 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'reveal-left': 'reveal-left 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'reveal-blur': 'reveal-blur 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'reveal-right': 'reveal-right 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
  variants: {
    extend: {
      boxShadow: ["hover", "active"],
    },
  },
};
