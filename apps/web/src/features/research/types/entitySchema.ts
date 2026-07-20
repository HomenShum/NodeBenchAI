/**
 * Entity Schema for Enhanced Entity Linking
 *
 * Defines entity types and their visual styling for AI-2027.com-inspired
 * entity linking with visual distinction and internal dossier connections.
 */

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type EntityType =
  | "company"      // Companies, organizations
  | "person"       // People, founders, executives
  | "product"      // Products, services, platforms
  | "technology"   // Technologies, frameworks, protocols
  | "topic"        // Topics, themes, concepts
  | "region"       // Countries, regions, markets
  | "event"        // Events, conferences, milestones
  | "metric"       // Metrics, KPIs, statistics
  | "document";    // Internal documents, dossiers

export interface Entity {
  /** Unique entity ID */
  id: string;
  /** Display name */
  name: string;
  /** Entity type for styling */
  type: EntityType;
  /** Optional description/summary */
  description?: string;
  /** Optional internal dossier document ID */
  dossierId?: string;
  /** Optional external URL */
  url?: string;
  /** Optional ticker symbol (for companies) */
  ticker?: string;
  /** Optional logo/avatar URL */
  avatarUrl?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY LIBRARY - Collection of known entities
// ═══════════════════════════════════════════════════════════════════════════

export interface EntityLibrary {
  /** All entities indexed by ID */
  entities: Record<string, Entity>;
  /** Name-to-ID mapping for quick lookup */
  nameIndex: Record<string, string>;
  /** Last updated timestamp */
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY SYNTAX HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Entity syntax in narrative text:
 * - `@@entity:id@@` - Simple entity reference
 * - `@@entity:id|Display Name@@` - Entity with custom display name
 * - `@@entity:id|Display Name|type:company@@` - Entity with type override
 *
 * Examples:
 * - "@@entity:openai@@" → renders as styled "OpenAI" link
 * - "@@entity:sam-altman|Sam Altman|type:person@@" → person-styled link
 */
export const ENTITY_REGEX = /@@entity:([^|@]+)(?:\|([^|@]+))?(?:\|type:([^@]+))?@@/g;

/**
 * Parse entity tokens from text
 */
export interface ParsedEntity {
  id: string;
  displayName?: string;
  type?: EntityType;
  fullMatch: string;
  startIndex: number;
  endIndex: number;
}

export function parseEntities(text: string): ParsedEntity[] {
  const entities: ParsedEntity[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(ENTITY_REGEX.source, "g");

  while ((match = regex.exec(text)) !== null) {
    entities.push({
      id: match[1],
      displayName: match[2],
      type: match[3] as EntityType | undefined,
      fullMatch: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return entities;
}

/**
 * Create a new entity library
 */
export function createEntityLibrary(): EntityLibrary {
  return {
    entities: {},
    nameIndex: {},
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Add an entity to the library
 */
export function addEntity(
  library: EntityLibrary,
  entity: Entity,
): EntityLibrary {
  const normalizedName = entity.name.toLowerCase();
  return {
    entities: { ...library.entities, [entity.id]: entity },
    nameIndex: { ...library.nameIndex, [normalizedName]: entity.id },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Get entity by ID
 */
export function getEntity(library: EntityLibrary, id: string): Entity | undefined {
  return library.entities[id];
}

/**
 * Get entity by name (case-insensitive)
 */
export function getEntityByName(library: EntityLibrary, name: string): Entity | undefined {
  const id = library.nameIndex[name.toLowerCase()];
  return id ? library.entities[id] : undefined;
}

/**
 * Get all entities
 */
export function getAllEntities(library: EntityLibrary): Entity[] {
  return Object.values(library.entities);
}

/**
 * Get entities by type
 */
export function getEntitiesByType(library: EntityLibrary, type: EntityType): Entity[] {
  return Object.values(library.entities).filter((e) => e.type === type);
}

