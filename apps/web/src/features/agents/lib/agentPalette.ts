/**
 * agentPalette — persistent color + icon per diligence agent role.
 *
 * Motivation: v3 / v4 prototypes all assign persistent colors
 * to each agent role so users build pattern recognition ("purple is Spencer,
 * green is Maya"). NodeBench's blockType IS the agent role — founder,
 * product, funding, etc. — so we derive the palette client-side from the
 * existing projection metadata. No schema change needed; the runtime
 * already routes blockType through the decoration payload.
 *
 * Prior art:
 *   - Notion AI per-author color badges
 *   - Linear's per-assignee status dots
 *   - v4 prototype lines 24-32 (--agent-joaquin, --agent-spencer, etc.)
 *
 * Palette values are 2026 Tailwind-ish — readable on both flat dark
 * (#151413 bg) and light surfaces. Tested against WCAG AA on the
 * notebook's body ink.
 */

import type { DiligenceBlockType } from "@/features/entities/components/notebook/DiligenceDecorationPlugin";

export type AgentPaletteEntry = {
  /** Display label for the role. */
  label: string;
  /** Hex color — anchors left accent, tag chip, pulse ring. */
  color: string;
  /** Single-char glyph for compact badges; null = no glyph. */
  glyph: string | null;
};

const PALETTE: Record<DiligenceBlockType, AgentPaletteEntry> = {
  projection:    { label: "Reference",     color: "#94a3b8", glyph: "⌘" }, // slate-400
  founder:       { label: "Founder",       color: "#d97757", glyph: "F" }, // terracotta
  product:       { label: "Product",       color: "#529cca", glyph: "P" }, // sky
  funding:       { label: "Funding",       color: "#4dab9a", glyph: "$" }, // teal
  news:          { label: "News",          color: "#9065b0", glyph: "N" }, // purple
  hiring:        { label: "Hiring",        color: "#e8a33d", glyph: "H" }, // amber
  patent:        { label: "Patents",       color: "#6b7fd7", glyph: "⚙" }, // indigo
  publicOpinion: { label: "Sentiment",     color: "#d1568f", glyph: "◎" }, // rose
  competitor:    { label: "Competitors",   color: "#d9730d", glyph: "C" }, // orange
  regulatory:    { label: "Regulatory",    color: "#9ca3af", glyph: "§" }, // gray
  financial:     { label: "Financials",    color: "#10b981", glyph: "%" }, // emerald
};

export function getAgentPaletteEntry(blockType: string): AgentPaletteEntry {
  return (
    PALETTE[blockType as DiligenceBlockType] ?? {
      label: blockType,
      color: "#94a3b8",
      glyph: null,
    }
  );
}

/** Convenience accessors — avoid spreading across renderers. */
export function getAgentColor(blockType: string): string {
  return getAgentPaletteEntry(blockType).color;
}

export function getAgentLabel(blockType: string): string {
  return getAgentPaletteEntry(blockType).label;
}

export function getAgentGlyph(blockType: string): string | null {
  return getAgentPaletteEntry(blockType).glyph;
}
