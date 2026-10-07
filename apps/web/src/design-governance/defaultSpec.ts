/**
 * Default Design Governance Spec — concrete values derived from:
 *   - src/index.css (CSS custom properties, component classes)
 *   - tailwind.config.js (semantic aliases, spacing, shadows)
 *
 * This is the single source of truth for design enforcement.
 */

import type { DesignGovernanceSpec, BannedPattern } from "./spec";

// ── Shared exclude list for config/style definition files ─────
const CONFIG_EXCLUDES = [
  "index.css",
  "tailwind.config",
  ".stories.",
  ".test.",
  ".spec.",
  "__tests__",
  "design-governance",
  "node_modules",
];

// ── Banned Color Patterns ─────────────────────────────────────

const BANNED_COLOR_PATTERNS: BannedPattern[] = [
  // Saturated background colors (raw Tailwind palettes)
  {
    pattern: "\\bbg-(red|orange|amber|yellow|green|blue|indigo|violet|purple|pink|emerald|teal|cyan|lime|rose|fuchsia|sky)-(50|100|200|300|400|500|600|700|800|900|950)\\b",
    flags: "g",
    label: "Saturated bg color (use bg-surface variants)",
    severity: "medium",
    category: "color",
    fixSuggestion: "Replace with bg-surface, bg-surface-secondary, or bg-surface-hover",
    excludeFiles: CONFIG_EXCLUDES,
  },
  // Saturated text colors
  {
    pattern: "\\btext-(red|orange|amber|yellow|green|blue|indigo|violet|purple|pink|emerald|teal|cyan|lime|rose|fuchsia|sky)-(50|100|200|300|400|500|600|700|800|900|950)\\b",
    flags: "g",
    label: "Saturated text color (use text-content variants)",
    severity: "medium",
    category: "color",
    fixSuggestion: "Replace with text-content, text-content-secondary, or text-content-muted",
    excludeFiles: CONFIG_EXCLUDES,
  },
  // Raw gray palette (should use semantic aliases)
  {
    pattern: "\\bbg-gray-(50|100|200|300|400|500|600|700|800|900|950)\\b",
    flags: "g",
    label: "bg-gray-* (use bg-surface variants)",
    severity: "medium",
    category: "color",
    fixSuggestion: "bg-gray-50/100 → bg-surface-secondary, bg-gray-200 → bg-surface-hover",
    excludeFiles: CONFIG_EXCLUDES,
  },
  {
    pattern: "\\btext-gray-(50|100|200|300|400|500|600|700|800|900|950)\\b",
    flags: "g",
    label: "text-gray-* (use text-content variants)",
    severity: "medium",
    category: "color",
    fixSuggestion: "text-gray-500/600 → text-content-muted, text-gray-700/800 → text-content-secondary",
    excludeFiles: CONFIG_EXCLUDES,
  },
  {
    pattern: "\\bborder-gray-(50|100|200|300|400|500|600|700|800|900|950)\\b",
    flags: "g",
    label: "border-gray-* (use border-edge)",
    severity: "medium",
    category: "color",
    fixSuggestion: "Replace with border-edge",
    excludeFiles: CONFIG_EXCLUDES,
  },
  // Hardcoded hex colors in JSX/TSX (not in CSS/config files)
  {
    pattern: '["\']#[0-9a-fA-F]{3,8}["\']',
    flags: "g",
    label: "Hardcoded hex color string (use CSS var or semantic token)",
    severity: "low",
    category: "color",
    fixSuggestion: "Use var(--text-primary), var(--accent-primary), etc.",
    excludeFiles: [...CONFIG_EXCLUDES, ".css", "svg", "chart", "Chart"],
  },
  // Decorative gradients
  {
    pattern: "\\bfrom-(amber|orange|purple|pink|indigo|red|green|blue)-(50|100|200)\\b",
    flags: "g",
    label: "Decorative gradient (use flat surface colors)",
    severity: "medium",
    category: "color",
    fixSuggestion: "Remove gradient, use bg-surface or bg-surface-secondary",
    excludeFiles: CONFIG_EXCLUDES,
  },
  // bg-white / bg-black (non-semantic)
  {
    pattern: "\\bbg-white\\b(?!/)",
    flags: "g",
    label: "bg-white (use bg-surface)",
    severity: "low",
    category: "color",
    fixSuggestion: "Replace with bg-surface",
    excludeFiles: CONFIG_EXCLUDES,
  },
];

// ── Banned Focus Patterns ─────────────────────────────────────

const BANNED_FOCUS_PATTERNS: BannedPattern[] = [
  {
    pattern: "\\bring-indigo-[0-9]+\\b",
    flags: "g",
    label: "Hardcoded indigo focus ring (use ring-ring or ring-primary)",
    severity: "medium",
    category: "focus",
    fixSuggestion: "Replace ring-indigo-500 with ring-ring (semantic)",
    excludeFiles: CONFIG_EXCLUDES,
  },
  {
    pattern: "focus-visible:ring-indigo",
    flags: "g",
    label: "Focus ring using hardcoded indigo",
    severity: "medium",
    category: "focus",
    fixSuggestion: "Use focus-visible:ring-ring (maps to --ring CSS var)",
    excludeFiles: CONFIG_EXCLUDES,
  },
];

// ── Banned Typography Patterns ────────────────────────────────

const BANNED_TYPOGRAPHY_PATTERNS: BannedPattern[] = [
  {
    pattern: "uppercase\\s+tracking-widest",
    flags: "g",
    label: "ALL CAPS tracking-widest (use .type-label class)",
    severity: "high",
    category: "typography",
    fixSuggestion: "Replace with className='type-label'",
    excludeFiles: CONFIG_EXCLUDES,
  },
  {
    pattern: "tracking-\\[0\\.\\d+em\\]",
    flags: "g",
    label: "Custom tracking value (use type scale classes)",
    severity: "medium",
    category: "typography",
    fixSuggestion: "Use .type-label (includes tracking-wider) or remove custom tracking",
    excludeFiles: CONFIG_EXCLUDES,
  },
  {
    pattern: "\\bfont-black\\b",
    flags: "g",
    label: "font-black weight (max allowed is font-bold/700)",
    severity: "low",
    category: "typography",
    fixSuggestion: "Replace with font-bold or font-semibold",
    excludeFiles: CONFIG_EXCLUDES,
  },
];

// ── Banned Button Patterns ────────────────────────────────────

const BANNED_BUTTON_PATTERNS: BannedPattern[] = [
  {
    pattern: "bg-indigo-600\\s+text-white\\s+.*rounded",
    flags: "g",
    label: "Inline button styling (use .btn-primary-sm or .btn-primary-xs)",
    severity: "low",
    category: "button",
    fixSuggestion: "Replace inline styles with btn-primary-sm class",
    excludeFiles: CONFIG_EXCLUDES,
  },
];

// ── The Default Spec ──────────────────────────────────────────

export const DEFAULT_SPEC: DesignGovernanceSpec = {
  version: "1.0.0",
  lastUpdated: "2026-02-24",

  colorBudget: {
    maxDistinctPerRoute: 6,
    approvedSemanticColors: [
      "surface",
      "surface-secondary",
      "surface-hover",
      "content",
      "content-secondary",
      "content-muted",
      "edge",
      "primary",
      "primary-foreground",
      "secondary",
      "destructive",
      "muted",
      "muted-foreground",
      "accent",
      "background",
      "foreground",
      "card",
      "popover",
      "ring",
      "input",
      "border",
    ],
    accentFamily: "indigo",
    approvedAccentShades: [500, 600, 700],
    statusColors: {
      success: ["text-green-600", "dark:text-green-400"],
      warning: ["text-amber-600", "dark:text-amber-400"],
      error: ["text-red-600", "dark:text-red-400"],
      info: ["text-blue-600", "dark:text-blue-400"],
    },
    bannedColorPatterns: BANNED_COLOR_PATTERNS,
  },

  typography: {
    contextClasses: {
      "page-title": ["type-page-title"],
      "section-heading": ["type-section-title"],
      "card-title": ["type-card-title"],
      body: ["type-body"],
      caption: ["type-caption"],
      label: ["type-label"],
    },
    fontFamilies: {
      ui: "Inter",
      code: "JetBrains Mono",
    },
    baseFontSize: "14px",
    uppercasePolicy: {
      allowedClasses: ["type-label"],
      allowedContexts: [
        "sidebar section labels (MENU, MORE, FILES)",
        "table column headers (<th>)",
      ],
      description:
        "Uppercase is only allowed in .type-label class (sidebar section labels) and table column headers. All section headings, card titles, stat labels, and badge text must be sentence case.",
    },
  },

  spacing: {
    approvedScale: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24],
    sectionGap: "space-y-8",
    cardPadding: "p-4 sm:p-6",
    pageInnerPadding: "px-6 sm:px-8 lg:px-10 py-8",
  },

  components: {
    layoutPrimitives: {
      pageShell: "nb-page-shell",
      pageInner: "nb-page-inner",
      pageFrame: "nb-page-frame",
      pageFrameNarrow: "nb-page-frame-narrow",
      surfaceCard: "nb-surface-card",
    },
    buttonClasses: [
      "btn-primary-xs",
      "btn-primary-sm",
      "btn-ghost-sm",
      "btn-outline-sm",
    ],
    focusRing: "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
    bannedButtonPatterns: BANNED_BUTTON_PATTERNS,
  },

  states: {
    requiredStates: ["loading", "empty", "error"],
    loadingComponents: ["ViewSkeleton", "SignatureOrb", "Skeleton"],
    emptyStateComponents: ["EmptyState", "SignatureOrb"],
  },

  motion: {
    maxConcurrentAnimations: 3,
    maxTransitionDuration: "500ms",
    reducedMotionRequired: true,
  },

  borderRadius: {
    card: "rounded-lg",
    button: "rounded-md",
    input: "rounded-md",
    container: "rounded-xl",
  },
};

/**
 * Collect all banned patterns from every section into one flat array.
 */
export function getAllBannedPatterns(): BannedPattern[] {
  return [
    ...DEFAULT_SPEC.colorBudget.bannedColorPatterns,
    ...BANNED_FOCUS_PATTERNS,
    ...BANNED_TYPOGRAPHY_PATTERNS,
    ...DEFAULT_SPEC.components.bannedButtonPatterns,
  ];
}
