// convex/lib/artifactModels.ts
// Boundary types: ArtifactRow (Convex DB) ↔ ArtifactCard (shared/UI)
// This prevents schema drift from creeping into shared types

import { Doc } from "../_generated/dataModel";
import type { ArtifactCard } from "../../shared/artifacts";

// ═══════════════════════════════════════════════════════════════════════════
// TYPE: ArtifactRow (exactly what schema allows)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ArtifactRow = Convex DB row type
 * This is exactly what the schema defines - no more, no less
 */
export type ArtifactRow = Doc<"artifacts">;

/**
 * Schema-compatible kind values
 */
export type SchemaKind = "url" | "file" | "video" | "image" | "document";

/**
 * Schema-compatible provider values
 */
export type SchemaProvider = "youtube" | "sec" | "arxiv" | "news" | "web" | "local";

// ═══════════════════════════════════════════════════════════════════════════
// MAPPER: ArtifactRow → ArtifactCard
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert a DB row to UI-friendly ArtifactCard
 * Called at the query edge before returning to client
 * 
 * Note: ArtifactCard has a simpler flags structure than ArtifactRow
 * We map only the fields that exist in the shared type
 */
export function toArtifactCard(row: ArtifactRow): ArtifactCard {
  return {
    id: row.artifactId,
    runId: row.runId,
    canonicalUrl: row.canonicalUrl,
    originalUrl: row.canonicalUrl, // DB only stores canonical
    title: row.title,
    snippet: row.snippet,
    thumbnail: row.thumbnail,
    host: row.host || "",
    kind: row.kind,
    provider: row.provider || "web",
    rev: row.rev,
    discoveredAt: row.discoveredAt,
    // ArtifactCard only has these 3 flags (UI-focused)
    flags: {
      isPinned: row.flags.isPinned,
      isCited: row.flags.isCited,
      isHidden: false, // UI-only flag, not stored in DB
    },
  };
}

/**
 * Convert multiple rows
 */
export function toArtifactCards(rows: ArtifactRow[]): ArtifactCard[] {
  return rows.map(toArtifactCard);
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATOR TYPE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if a kind string is schema-compatible
 */
export function isValidSchemaKind(kind: string): kind is SchemaKind {
  return ["url", "file", "video", "image", "document"].includes(kind);
}

/**
 * Check if a provider string is schema-compatible
 */
export function isValidSchemaProvider(provider: string): provider is SchemaProvider {
  return ["youtube", "sec", "arxiv", "news", "web", "local"].includes(provider);
}
