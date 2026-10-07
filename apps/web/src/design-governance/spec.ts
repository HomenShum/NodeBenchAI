/**
 * Design Governance Spec — Machine-readable design system contract.
 *
 * Every Layer 0 lint rule, MCP tool, and QA criterion derives from this spec.
 * Change the spec → enforcement updates everywhere.
 */

// ── Color Budget ──────────────────────────────────────────────

export interface ColorBudget {
  /** Max distinct Tailwind color families allowed per route file */
  maxDistinctPerRoute: number;
  /** Approved semantic Tailwind aliases (the ONLY colors new code should use) */
  approvedSemanticColors: string[];
  /** The accent color family (for approved raw Tailwind shades) */
  accentFamily: string;
  /** Approved raw accent shades (e.g. 500, 600, 700) */
  approvedAccentShades: number[];
  /** Semantic status colors — allowed for genuine status indication only */
  statusColors: Record<string, string[]>;
  /** Regex patterns for banned color usage in source files */
  bannedColorPatterns: BannedPattern[];
}

// ── Typography ────────────────────────────────────────────────

export interface TypographyRules {
  /** Map of context → approved CSS class(es) */
  contextClasses: Record<string, string[]>;
  /** Font families */
  fontFamilies: { ui: string; code: string };
  /** Base font size */
  baseFontSize: string;
  /** Uppercase policy */
  uppercasePolicy: UppercasePolicy;
}

export interface UppercasePolicy {
  /** CSS classes where uppercase is allowed */
  allowedClasses: string[];
  /** Element contexts where uppercase is allowed (e.g. sidebar section labels, table headers) */
  allowedContexts: string[];
  /** Description for humans */
  description: string;
}

// ── Spacing ───────────────────────────────────────────────────

export interface SpacingRules {
  /** Approved Tailwind spacing values (the rem scale) */
  approvedScale: number[];
  /** Standard section gap between major content blocks */
  sectionGap: string;
  /** Standard card internal padding */
  cardPadding: string;
  /** Page inner padding */
  pageInnerPadding: string;
}

// ── Component Primitives ──────────────────────────────────────

export interface ComponentRules {
  /** Required layout primitives — every view file must use the page shell */
  layoutPrimitives: {
    pageShell: string;
    pageInner: string;
    pageFrame: string;
    pageFrameNarrow: string;
    surfaceCard: string;
  };
  /** Approved button class patterns */
  buttonClasses: string[];
  /** Semantic focus ring (must be used instead of hardcoded indigo) */
  focusRing: string;
  /** Banned inline button patterns (should use primitives instead) */
  bannedButtonPatterns: BannedPattern[];
}

// ── State Requirements ────────────────────────────────────────

export interface StateRules {
  /** Every view must handle these states */
  requiredStates: ("loading" | "empty" | "error")[];
  /** Approved loading components */
  loadingComponents: string[];
  /** Approved empty state components */
  emptyStateComponents: string[];
}

// ── Motion ────────────────────────────────────────────────────

export interface MotionRules {
  /** Max concurrent animations on one screen */
  maxConcurrentAnimations: number;
  /** Max transition duration for UI interactions */
  maxTransitionDuration: string;
  /** prefers-reduced-motion must be respected */
  reducedMotionRequired: boolean;
}

// ── Border Radius ─────────────────────────────────────────────

export interface BorderRadiusRules {
  /** Card border radius */
  card: string;
  /** Button border radius */
  button: string;
  /** Input border radius */
  input: string;
  /** Container border radius */
  container: string;
}

// ── Banned Pattern ────────────────────────────────────────────

export interface BannedPattern {
  /** Regex source string (compiled at runtime) */
  pattern: string;
  /** Regex flags */
  flags: string;
  /** Human-readable label */
  label: string;
  /** Severity level */
  severity: "high" | "medium" | "low";
  /** Category for filtering */
  category: "color" | "typography" | "layout" | "states" | "focus" | "button" | "spacing";
  /** Optional: fix suggestion */
  fixSuggestion?: string;
  /** Optional: file patterns to exclude from this check */
  excludeFiles?: string[];
}

// ── Root Spec ─────────────────────────────────────────────────

export interface DesignGovernanceSpec {
  version: string;
  lastUpdated: string;
  colorBudget: ColorBudget;
  typography: TypographyRules;
  spacing: SpacingRules;
  components: ComponentRules;
  states: StateRules;
  motion: MotionRules;
  borderRadius: BorderRadiusRules;
}
