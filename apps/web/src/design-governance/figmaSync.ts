/**
 * Figma Sync Configuration
 *
 * Stores the Figma design system file reference and sync metadata.
 * The actual Figma file is created via the Figma MCP server tools
 * (generate_figma_design, create_design_system_rules).
 *
 * Token authentication:
 *   - FIGMA_ACCESS_TOKEN in .env.local (gitignored)
 *   - Figma MCP server in .mcp.json uses OAuth bearer token
 *
 * Validation:
 *   - node scripts/design/validateFigmaSync.mjs --figma-file <key>
 *   - MCP: sync_figma_tokens({ fileKey: "<key>" })
 */

export interface FigmaSyncConfig {
  /** Figma file key (from URL: figma.com/design/<fileKey>/...) */
  fileKey: string | null;
  /** Human-readable file name */
  fileName: string;
  /** Last sync timestamp (ISO 8601) */
  lastSyncAt: string | null;
  /** Figma MCP server URL */
  mcpServerUrl: string;
  /** Pages expected in the design system file */
  expectedPages: string[];
}

export const FIGMA_SYNC_CONFIG: FigmaSyncConfig = {
  fileKey: process.env.FIGMA_DESIGN_SYSTEM_FILE ?? null,
  fileName: "NodeBench Design System",
  lastSyncAt: null,
  mcpServerUrl: "https://mcp.figma.com/mcp",
  expectedPages: [
    "Color Palette",
    "Typography",
    "Components",
    "Page Templates",
  ],
};

/**
 * Pages to create in the Figma design system file:
 *
 * 1. Color Palette — All CSS custom properties from src/index.css (light + dark)
 *    - Background, foreground, card, popover, primary, secondary, muted, accent, destructive
 *    - Component vars: text-primary, text-secondary, text-muted, bg-primary, bg-secondary, etc.
 *
 * 2. Typography — 6 .type-* styles with specimen text
 *    - .type-page-title, .type-section-title, .type-body, .type-caption, .type-label, .type-mono
 *    - Font: Inter for UI, JetBrains Mono for code
 *
 * 3. Components — Standard primitives
 *    - nb-page-shell (layout container)
 *    - nb-surface-card (card container)
 *    - btn-primary, btn-secondary, btn-ghost, btn-outline (4 button variants)
 *    - SignatureOrb variants (idle, loading, success, error, thinking)
 *    - EmptyState pattern
 *
 * 4. Page Templates — Layout patterns
 *    - Hub layout (3-column grid: sidebar + content + right panel)
 *    - Detail layout (sidebar + content)
 *    - Fullscreen (landing pages)
 */
