/**
 * EntityGraphRail — a compact live NodeGraph rail inside the entity profile.
 *
 * Human rule first: an analyst reading a research profile should see WHO the
 * research touches — the entity, its cited sources, its stored relationship
 * edges — as a map that updates the moment the backend writes, without the
 * map pretending any of it is measured. Research prose measures nothing, so
 * every node lands with an undefined count and every edge is traversal
 * (session.observe only — no assertEdge, no receipts, no evidence weights).
 * The caption under the graph states this so a reader never mistakes edge
 * presence for magnitude.
 *
 * Data in, by eventId (idempotent against Convex re-deliveries):
 *   - the entityContexts doc          → entity node        (ctx:<docId>)
 *   - each of its cited sources       → source node + edge (src:<docId>:<i>)
 *   - each relationshipGraph edge     → related node + edge (rel:<edgeKey>)
 *   - each adaptiveProfile relation   → related node + edge (adaptive:<name>)
 *
 * The queries feeding this are the SAME reactive queries EntityProfilePage
 * already holds (entityContexts.getEntityContext, relationshipGraph
 * .getEntityGraph, adaptiveEntityQueries.getAdaptiveProfile) — the rail adds
 * zero new subscriptions.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { GitBranch } from "lucide-react";
import { GraphSession } from "@vendor/nodegraph-live/index.js";
import { NodeGraph } from "@vendor/nodegraph-live/react.js";
import { useThemeSafe } from "@/contexts/ThemeContext";

type SourceRef = { name?: string; url?: string };
type RelationshipEdge = {
  edgeKey: string;
  relatedEntityName: string;
  relatedEntityType?: string;
};
type AdaptiveRelationship = { entityName: string; entityType?: string };

export interface EntityGraphRailProps {
  entityName: string;
  entityType: string;
  /** _id of the entityContexts doc, or undefined while loading / null-miss. */
  contextId?: string;
  sources?: SourceRef[];
  relationshipEdges?: RelationshipEdge[];
  adaptiveRelationships?: AdaptiveRelationship[];
}

export function EntityGraphRail({
  entityName,
  entityType,
  contextId,
  sources,
  relationshipEdges,
  adaptiveRelationships,
}: EntityGraphRailProps) {
  // Bounded session: a profile left open all day must not grow unbounded,
  // and a re-delivered subscription update must not double an edge.
  const session = useMemo(
    () => new GraphSession({ maxNodes: 200, maxEdges: 400, maxSeen: 1000 }),
    // A different entity is a different map; rebuild rather than merge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entityName],
  );

  useEffect(() => {
    if (!contextId) return;
    const entity = { kind: entityType, label: entityName };
    // Research prose is not a measurement: count stays undefined everywhere.
    session.observe([entity], undefined, { eventId: `ctx:${contextId}` });
    (sources ?? []).forEach((src, i) => {
      session.observe(
        [entity, { kind: "source", label: src.name ?? src.url ?? `source ${i + 1}` }],
        undefined,
        { eventId: `src:${contextId}:${i}` },
      );
    });
    (relationshipEdges ?? []).forEach((edge) => {
      if (!edge.relatedEntityName) return;
      session.observe(
        [entity, { kind: edge.relatedEntityType ?? "entity", label: edge.relatedEntityName }],
        undefined,
        { eventId: `rel:${edge.edgeKey}` },
      );
    });
    (adaptiveRelationships ?? []).forEach((rel) => {
      if (!rel.entityName) return;
      session.observe(
        [entity, { kind: rel.entityType ?? "entity", label: rel.entityName }],
        undefined,
        { eventId: `adaptive:${entityName}:${rel.entityName}` },
      );
    });
  }, [session, contextId, sources, relationshipEdges, adaptiveRelationships, entityName, entityType]);

  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const { resolvedMode } = useThemeSafe();

  return (
    <div
      className="bg-surface rounded-lg border border-edge overflow-hidden"
      data-testid="entity-graph-rail"
      data-rail-nodes={snap.nodes.length}
      data-rail-edges={snap.edges.length}
    >
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-content-muted">
            <GitBranch className="w-4 h-4" />
          </span>
          <h3 className="text-xs font-bold text-content-secondary">Live Graph</h3>
          <span className="px-2 py-0.5 bg-surface-secondary text-content-secondary text-xs font-bold rounded">
            {snap.nodes.length} nodes · {snap.edges.length} edges
          </span>
        </div>
      </div>
      <div className="px-6 pb-2">
        <NodeGraph
          nodes={snap.nodes}
          edges={snap.edges}
          visits={session.visitsById()}
          height={280}
          dark={resolvedMode === "dark"}
        />
      </div>
      <p className="px-6 pb-4 text-xs text-content-muted">
        Live from this profile's own reactive queries (entity context, cited
        sources, stored relationship edges). Research prose measures nothing:
        every count is undefined and every edge is traversal — nothing here is
        measured or receipted.
      </p>
    </div>
  );
}

export default EntityGraphRail;
