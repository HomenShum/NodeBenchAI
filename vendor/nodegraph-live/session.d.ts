/**
 * Bounded session memory for a live relationship graph.
 *
 * Human rule first: an analyst who leaves this panel open all day must not
 * slowly exhaust the browser, and replaying the same tool event must not make
 * a relationship look stronger. Nodes, edges and deduplication receipts are
 * therefore bounded, FIFO-evicted and deterministic.
 */
import { type AssertionReceipt, type GraphEdge, type GraphNode } from "./graph-model.js";
export type EntityRef = {
    /** Entity kind — any string ("person", "condition", "repo", ...). */
    kind: string;
    label: string;
    /** A measured magnitude for this entity alone. Absent means unknown. */
    count?: number;
};
export type SessionNode = GraphNode & {
    visits: number;
};
export type SessionSnapshot = {
    nodes: SessionNode[];
    edges: GraphEdge[];
    turns: number;
};
export type SessionLimits = {
    maxNodes: number;
    maxEdges: number;
    maxSeen: number;
};
export type SessionStats = SessionLimits & {
    nodes: number;
    edges: number;
    seen: number;
};
export type EventOptions = {
    eventId?: string;
};
export declare class GraphSession {
    private nodes;
    private edges;
    private turns;
    private listeners;
    private snapshot;
    /** key -> full canonical payload. A reused explicit id with new content is
     * a conflict, not a duplicate to silently ignore. */
    private seen;
    private readonly limits;
    constructor(limits?: Partial<SessionLimits>);
    private emit;
    private remember;
    private nodeId;
    private evictOldestNode;
    private trimNodes;
    private trimEdges;
    private upsertNode;
    private edgeMapKey;
    private upsertEdge;
    /**
     * Exactly two participants plus a measured conjunction produce evidence.
     * Three or more participants, or a pair with no measurement, produce only
     * traversal telemetry. A measured zero still produces evidence weight 0.
     */
    observe(entities: readonly EntityRef[], measuredCount?: number, options?: EventOptions): void;
    /** A curated assertion is accepted only with the complete replay receipt. */
    assertEdge(a: EntityRef, b: EntityRef, receipt: AssertionReceipt, options?: EventOptions & {
        weight?: number;
    }): void;
    /**
     * Ingest a subgraph atomically with respect to trust validation. Unknown edge
     * types and incomplete assertion receipts reject the complete batch before
     * any node or edge is stored.
     */
    ingest(data: {
        entities: readonly GraphNode[];
        relationships: readonly GraphEdge[];
    }, options?: EventOptions): void;
    getSnapshot: () => SessionSnapshot;
    subscribe: (listener: () => void) => (() => void);
    visitsById(): Record<string, number>;
    stats(): SessionStats;
}
//# sourceMappingURL=session.d.ts.map