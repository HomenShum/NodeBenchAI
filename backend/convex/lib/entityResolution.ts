// convex/lib/entityResolution.ts
// Canonical entity key resolution for GAM

/**
 * Canonical entity key format:
 * - company:TICKER   (e.g., "company:TSLA", "company:AAPL")
 * - company:CIK:123  (e.g., "company:CIK:0001318605" for Tesla)
 * - person:SLUG      (e.g., "person:elon-musk")
 * - theme:SLUG       (e.g., "theme:agent-memory", "theme:autonomous-vehicles")
 */
export type CanonicalEntityKey = string;

export type EntityType = "company" | "person" | "theme";

export type ResolutionSource = "confirmed" | "entityContexts" | "new";

export interface ResolvedEntity {
  /** Canonical key like "company:TSLA" or "person:elon-musk" */
  canonicalKey: CanonicalEntityKey;
  
  /** Human-readable display name */
  displayName: string;
  
  /** Entity type */
  type: EntityType;
  
  /** Where the resolution came from */
  source: ResolutionSource;
  
  /** Whether this is a confident resolution (from confirmed tables) */
  isConfirmed: boolean;
}

/**
 * Convert a string to a URL-safe slug.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build a canonical key for an entity.
 */
export function buildCanonicalKey(
  type: EntityType,
  identifier: string
): CanonicalEntityKey {
  return `${type}:${slugify(identifier)}`;
}

/**
 * Build a canonical key for a company with ticker.
 */
export function buildCompanyKeyFromTicker(ticker: string): CanonicalEntityKey {
  return `company:${ticker.toUpperCase()}`;
}

/**
 * Build a canonical key for a company with CIK.
 */
export function buildCompanyKeyFromCik(cik: string): CanonicalEntityKey {
  // Pad CIK to 10 digits
  const paddedCik = cik.padStart(10, "0");
  return `company:CIK:${paddedCik}`;
}

/**
 * Parse a canonical key back into its components.
 */
export function parseCanonicalKey(key: CanonicalEntityKey): {
  type: EntityType;
  identifier: string;
  isCik: boolean;
} | null {
  const parts = key.split(":");
  
  if (parts.length < 2) return null;
  
  const type = parts[0] as EntityType;
  if (!["company", "person", "theme"].includes(type)) return null;
  
  // Check if it's a CIK-based company key
  if (parts.length === 3 && parts[1] === "CIK") {
    return {
      type,
      identifier: parts[2],
      isCik: true,
    };
  }
  
  return {
    type,
    identifier: parts[1],
    isCik: false,
  };
}

/**
 * Resolve entity info from a confirmed company record.
 */
export function resolveFromConfirmedCompany(confirmed: {
  confirmedName: string;
  confirmedTicker?: string;
  confirmedCik: string;
}): ResolvedEntity {
  const canonicalKey = confirmed.confirmedTicker
    ? buildCompanyKeyFromTicker(confirmed.confirmedTicker)
    : buildCompanyKeyFromCik(confirmed.confirmedCik);

  return {
    canonicalKey,
    displayName: confirmed.confirmedName,
    type: "company",
    source: "confirmed",
    isConfirmed: true,
  };
}

/**
 * Resolve entity info from a confirmed person record.
 */
export function resolveFromConfirmedPerson(confirmed: {
  confirmedName: string;
  confirmedId: string;
}): ResolvedEntity {
  return {
    canonicalKey: buildCanonicalKey("person", confirmed.confirmedName),
    displayName: confirmed.confirmedName,
    type: "person",
    source: "confirmed",
    isConfirmed: true,
  };
}

/**
 * Resolve entity info from an existing entityContexts record.
 */
export function resolveFromEntityContext(entity: {
  entityName: string;
  entityType: "company" | "person";
  canonicalKey?: string;
}): ResolvedEntity {
  const canonicalKey = entity.canonicalKey || buildCanonicalKey(
    entity.entityType,
    entity.entityName
  );

  return {
    canonicalKey,
    displayName: entity.entityName,
    type: entity.entityType,
    source: "entityContexts",
    isConfirmed: false,
  };
}

/**
 * Create a new resolution for an unknown entity.
 */
export function resolveNewEntity(
  name: string,
  type: EntityType
): ResolvedEntity {
  return {
    canonicalKey: buildCanonicalKey(type, name),
    displayName: name,
    type,
    source: "new",
    isConfirmed: false,
  };
}

/**
 * Check if two canonical keys refer to the same entity.
 */
export function keysMatch(key1: CanonicalEntityKey, key2: CanonicalEntityKey): boolean {
  return key1.toLowerCase() === key2.toLowerCase();
}
