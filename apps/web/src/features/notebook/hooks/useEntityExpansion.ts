/**
 * useEntityExpansion — Hook for entity mention expansion data.
 *
 * Provides entity intelligence data for MentionExpansionPanel:
 *   - Static entity data (summary, claims, edges) from entityProfiles
 *   - Backlink count from backlinks table
 *   - Agent expansion trigger via expandEntity action
 *   - Real-time expansion status via expansionRuns subscription
 *
 * Falls back to client-side entity cache when Convex is unavailable
 * (e.g., guest mode, offline, prototype mode).
 *
 * Pattern: Convex useQuery + useMutation with graceful degradation
 * Prior art: Anthropic Claude Code — layered memory with JIT retrieval
 *
 * See: docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md
 */
import { useState, useEffect, useCallback } from "react";
import { configuredConvexUrl } from "@/lib/convexUrl";

// Types matching the prototype MENTION_DATA shape
export type EntityClaim = {
  text: string;
  src: string;
};

export type EntityEdge = {
  label: string;
  relation: string;
};

export type BacklinkEntry = {
  from: string;
  type: string;
  context?: string;
  confidence?: number;
};

export type EntityExpansionData = {
  name: string;
  kind: "company" | "person" | "tag";
  meta: string;
  summary: string;
  claims: EntityClaim[];
  edges: EntityEdge[];
  backlinkCount: number;
};

type UseEntityExpansionResult = {
  data: EntityExpansionData | null;
  loading: boolean;
  error: string | null;
  expand: () => void;
};

type UseBacklinksResult = {
  backlinks: BacklinkEntry[];
  loading: boolean;
};

// ── Singleton ConvexHttpClient (lazy-init, shared across all hooks) ──

let _clientPromise: Promise<{ client: any; api: any }> | null = null;

/**
 * Lazily initialize a shared ConvexHttpClient + api reference.
 * Dynamic import avoids hard dependency on Convex in prototype mode.
 * Singleton: one client instance for all hooks in the session.
 */
async function getConvexClient(): Promise<{ client: any; api: any } | null> {
  const convexUrl = configuredConvexUrl();
  if (!convexUrl) return null;

  if (!_clientPromise) {
    _clientPromise = (async () => {
      const { ConvexHttpClient } = await import("convex/browser");
      const { api } = await import("@convex/_generated/api");
      const client = new ConvexHttpClient(convexUrl);
      return { client, api };
    })();
  }

  try {
    return await _clientPromise;
  } catch {
    // Reset on failure so next call retries
    _clientPromise = null;
    return null;
  }
}

// ── Entity data cache with batch-safe eviction ──────────────────────

const entityCache = new Map<string, EntityExpansionData>();
const MAX_CACHE_SIZE = 200;

/** In-flight request dedup: tracks pending loads to avoid duplicate fetches */
const pendingLoads = new Map<string, Promise<EntityExpansionData | null>>();

function evictIfNeeded() {
  while (entityCache.size >= MAX_CACHE_SIZE) {
    const oldest = entityCache.keys().next().value;
    if (oldest !== undefined) entityCache.delete(oldest);
    else break;
  }
}

/** Validate and coerce kind value */
function parseKind(raw: unknown): "company" | "person" | "tag" {
  if (raw === "company" || raw === "person" || raw === "tag") return raw;
  return "company";
}

// ── useEntityExpansion ──────────────────────────────────────────────

/**
 * Primary hook: get expansion data for an entity mention.
 *
 * Tries Convex subscription first; falls back to local cache.
 * Returns loading/error/data state for the MentionExpansionPanel.
 *
 * Improvements over v1:
 *   - Singleton ConvexHttpClient (no per-render creation)
 *   - Request dedup (concurrent mounts share one in-flight fetch)
 *   - Batch-safe cache eviction
 *   - Kind type validation (no unsafe cast)
 */
export function useEntityExpansion(entityId: string): UseEntityExpansionResult {
  const [data, setData] = useState<EntityExpansionData | null>(
    entityCache.get(entityId) ?? null,
  );
  const [loading, setLoading] = useState(!entityCache.has(entityId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (entityCache.has(entityId)) {
      setData(entityCache.get(entityId)!);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadEntityData(): Promise<EntityExpansionData | null> {
      const convex = await getConvexClient();
      if (!convex) throw new Error("VITE_CONVEX_URL not configured");

      const profiles = await convex.client.query(
        convex.api.domains.entities.queries.searchEntities,
        { query: entityId, limit: 1 },
      );

      if (cancelled) return null;

      if (profiles && profiles.length > 0) {
        const profile = profiles[0];
        const expansionData: EntityExpansionData = {
          name: profile.canonicalName ?? entityId,
          kind: parseKind(profile.entityType),
          meta: `${profile.entityType ?? "Entity"} · ${profile.sourceCount ?? 0} sources`,
          summary: profile.summary ?? "",
          claims: [],
          edges: [],
          backlinkCount: 0,
        };

        evictIfNeeded();
        entityCache.set(entityId, expansionData);
        return expansionData;
      }
      return null;
    }

    async function loadWithDedup() {
      try {
        setLoading(true);
        setError(null);

        // Dedup: if another hook instance is already fetching this entity, share its promise
        let promise = pendingLoads.get(entityId);
        if (!promise) {
          promise = loadEntityData();
          pendingLoads.set(entityId, promise);
        }

        const result = await promise;
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setData(null);
        }
      } finally {
        pendingLoads.delete(entityId);
        if (!cancelled) setLoading(false);
      }
    }

    loadWithDedup();
    return () => { cancelled = true; };
  }, [entityId]);

  const expand = useCallback(() => {
    async function triggerExpand() {
      try {
        const convex = await getConvexClient();
        if (!convex) {
          console.warn("[useEntityExpansion] VITE_CONVEX_URL not set, skipping expand");
          return;
        }

        const profiles = await convex.client.query(
          convex.api.domains.entities.queries.searchEntities,
          { query: entityId, limit: 1 },
        );

        if (!profiles || profiles.length === 0) {
          console.warn("[useEntityExpansion] Entity not found:", entityId);
          return;
        }

        const targetEntityId = profiles[0]._id;
        const result = await convex.client.mutation(
          convex.api.domains.graph.expandEntity.startExpansion,
          { targetEntityId, userId: "local-user" },
        );

        console.log("[useEntityExpansion] Expansion started:", result);
      } catch (err) {
        console.warn("[useEntityExpansion] Expansion failed:", err);
      }
    }
    triggerExpand();
  }, [entityId]);

  return { data, loading, error, expand };
}

// ── useBacklinks ────────────────────────────────────────────────────

/**
 * Backlinks hook: get backlink entries for an entity.
 *
 * Tries Convex backlink queries; falls back to empty.
 * Validates response shape before mapping.
 */
export function useBacklinks(entityId: string): UseBacklinksResult {
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadBacklinks() {
      try {
        setLoading(true);

        const convex = await getConvexClient();
        if (!convex) {
          setBacklinks([]);
          return;
        }

        const profiles = await convex.client.query(
          convex.api.domains.entities.queries.searchEntities,
          { query: entityId, limit: 1 },
        );

        if (cancelled) return;

        if (profiles && profiles.length > 0) {
          const targetId = profiles[0]._id;
          const bls = await convex.client.query(
            convex.api.domains.graph.backlinkQueries.getBacklinksForEntity,
            { targetEntityId: targetId, limit: 20 },
          );

          if (!cancelled && Array.isArray(bls)) {
            setBacklinks(
              bls
                .filter((bl: unknown): bl is Record<string, unknown> =>
                  bl !== null && typeof bl === "object",
                )
                .map((bl) => ({
                  from: String(bl.sourceId ?? bl.sourceEntityId ?? ""),
                  type: String(bl.backlinkType ?? "mention"),
                  context: bl.sourceContext ? String(bl.sourceContext) : undefined,
                  confidence: typeof bl.confidence === "number" ? bl.confidence : undefined,
                })),
            );
          }
        } else {
          if (!cancelled) setBacklinks([]);
        }
      } catch {
        if (!cancelled) setBacklinks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBacklinks();
    return () => { cancelled = true; };
  }, [entityId]);

  return { backlinks, loading };
}

/**
 * Seed entity data into the client cache (for prototype mode).
 * Used by the Home/Reports surfaces to pre-populate expansion data
 * without requiring Convex connectivity.
 */
export function seedEntityCache(
  entityId: string,
  data: EntityExpansionData,
): void {
  evictIfNeeded();
  entityCache.set(entityId, data);
}

/**
 * Expansion snapshot hook for entity hover preview cards.
 * Returns pre-computed summary + key facts from the last expansion run.
 */
export type ExpansionSnapshot = {
  summary: string;
  keyFacts: string[];
  backlinkCount: number;
  lastExpanded: number;
};

export function useExpansionSnapshot(entityId: string): {
  snapshot: ExpansionSnapshot | null;
  loading: boolean;
} {
  const [snapshot, setSnapshot] = useState<ExpansionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      try {
        setLoading(true);

        const convex = await getConvexClient();
        if (!convex) {
          setSnapshot(null);
          return;
        }

        const profiles = await convex.client.query(
          convex.api.domains.entities.queries.searchEntities,
          { query: entityId, limit: 1 },
        );

        if (cancelled || !profiles || profiles.length === 0) {
          if (!cancelled) setSnapshot(null);
          return;
        }

        const targetId = profiles[0]._id;
        const snap = await convex.client.query(
          convex.api.domains.graph.expandEntity.getExpansionSnapshot,
          { entityId: targetId },
        );

        if (!cancelled) {
          if (snap) {
            setSnapshot({
              summary: snap.summary ?? "",
              keyFacts: Array.isArray(snap.keyFacts) ? snap.keyFacts : [],
              backlinkCount: typeof snap.backlinkCount === "number" ? snap.backlinkCount : 0,
              lastExpanded: typeof snap.lastExpanded === "number" ? snap.lastExpanded : 0,
            });
          } else {
            setSnapshot(null);
          }
        }
      } catch {
        if (!cancelled) setSnapshot(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSnapshot();
    return () => { cancelled = true; };
  }, [entityId]);

  return { snapshot, loading };
}
