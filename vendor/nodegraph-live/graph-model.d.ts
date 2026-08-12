/**
 * The graph model: a Graphology multigraph with TYPED edges, plus an in-place
 * diff (`patchGraph`) so a growing graph never rebuilds its renderer.
 *
 * Three edge types, and the distinction is the point of this library:
 *
 *   - `evidence`   — a MEASURED relationship. The weight came from an external
 *                    system of record (an API count, a database aggregate) and
 *                    may therefore be encoded as a magnitude: evidence edges
 *                    own the width channel.
 *   - `traversal`  — interaction history. The weight is how many times the
 *                    agent (or user) walked this pair together. That is
 *                    telemetry about us, not evidence about the world, so it
 *                    gets a constant width and lighter ink.
 *   - `assertion`  — a curated claim carrying a complete source receipt. Its
 *                    release is rendered as a badge. Curated is not measured:
 *                    constant width.
 *
 * Two invariants enforced here rather than left to the renderer:
 *
 *   1. THE EDGE KEY CARRIES THE TYPE, with endpoints canonically ordered.
 *      Keying on (a, b) alone lets a traversal count silently overwrite a
 *      measured evidence weight (a real bug in the source repo, recorded in
 *      its MEASUREMENTS.md #52); an unsorted key lets one relationship become
 *      two stacked edges carrying different numbers. So: multigraph, key
 *      JSON tuple `[min, max, type]` (so delimiters inside ids cannot collide).
 *
 *   2. MEASURED MAGNITUDES AND TELEMETRY DO NOT SHARE A VISUAL CHANNEL.
 *      Only `evidence` weights are scaled into edge width; the width scale is
 *      computed over evidence edges only, so a 900-visit traversal edge cannot
 *      stretch the scale measured weights are read against. Node `visits` is
 *      carried as an attribute and surfaced as text, never mapped to size,
 *      colour or opacity.
 */
import Graph from "graphology";
export declare const EDGE_TYPES: readonly ["evidence", "traversal", "assertion"];
export type EdgeTypeName = (typeof EDGE_TYPES)[number];
/** Edge kinds whose `weight` is a measured value and may therefore be encoded
 *  as a magnitude. Everything not in this set is telemetry or curation. */
export declare const EVIDENCE_EDGE_TYPES: ReadonlySet<string>;
export declare const isEdgeType: (value: unknown) => value is EdgeTypeName;
/** Runtime payloads do not get to invent a fourth epistemic category. */
export declare const requireEdgeType: (value: unknown) => EdgeTypeName;
export declare const isEvidenceEdgeType: (t: EdgeTypeName) => boolean;
export type GraphNode = {
    id: string;
    label: string;
    /** Entity kind — any string; drives the ring hue (categorical only). */
    type: string;
    /** Measured magnitude for this entity. Never summed or estimated here.
     *  Absent means unknown. A measured zero is the number 0. */
    count?: number;
};
export type AssertionReceipt = {
    /** Curating system of record, for example `Reactome`. */
    source: string;
    /** Versioned release containing the assertion. */
    release: string;
    /** Stable source identifiers for both endpoints. */
    subjectId: string;
    objectId: string;
    /** Literal HTTP(S) URL that re-opens or replays the assertion. */
    url: string;
};
type EdgeBase = {
    source: string;
    target: string;
    weight: number;
};
export type GraphEdge = (EdgeBase & {
    type: "evidence" | "traversal";
    receipt?: never;
}) | (EdgeBase & {
    type: "assertion";
    receipt: AssertionReceipt;
});
export declare const requireAssertionReceipt: (value: unknown) => AssertionReceipt;
export type BuildOptions = {
    dark?: boolean;
    /**
     * Optional per-node interaction frequency (revisits, clicks). Carried as an
     * attribute and surfaced as TEXT only. Deliberately not mapped to size,
     * colour or opacity: a node visited fifty times is not more true than one
     * visited twice, and sharing a channel with `count` would say it is.
     */
    visits?: Record<string, number>;
    /** Override the ring hue per node kind; unknown kinds fall back to a
     *  deterministic hash of the kind name into the default palette. */
    kindColors?: Record<string, {
        light: string;
        dark: string;
    }>;
};
/**
 * The attribute the semantic edge kind is stored under.
 *
 * NOT `type`. Sigma reserves `type` on both node and edge display data to name
 * the RENDERING PROGRAM, so an edge carrying `type: "evidence"` makes the
 * renderer look for a program by that name and throw before anything paints.
 * The payload field stays `type` because that is what callers emit; only the
 * in-graph attribute is renamed, at the one place that reads the payload.
 */
export declare const EDGE_TYPE_ATTR = "edgeType";
export type EdgeKey = string;
/** `(a, b, type)` with the endpoints CANONICALLY ORDERED — without the sort,
 *  `a|b|evidence` and `b|a|evidence` are different keys and one measured
 *  relationship becomes two edges drawn on top of each other. */
export declare const edgeKey: (source: string, target: string, type: unknown) => EdgeKey;
export declare function buildGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[], opts?: BuildOptions): Graph;
/** Edge types actually present, in declared order. Drives the filter UI:
 *  a toggle for a type with no edges is a control that does nothing. */
export declare function edgeTypesPresent(g: Graph): EdgeTypeName[];
/** Per-type edge counts, for labelling the toggles honestly. */
export declare function edgeTypeCounts(g: Graph): Record<string, number>;
/**
 * Diff `nodes`/`edges` into an EXISTING graph, in place: the no-remount
 * contract. Rebuilding the graph on every ingestion rebuilds the Sigma
 * instance (five canvases and the layout), so each update flashes the whole
 * panel. Sigma reflects Graphology mutations automatically, so patching the
 * live graph means new elements simply appear.
 *
 * New nodes are seeded at their first existing neighbour (plus deterministic
 * jitter) or the current centroid — never at (0,0): coincident seeds wreck a
 * force layout, and a fresh node leaping in from the origin reads as exactly
 * the flicker this function exists to remove.
 *
 * Returns WHAT was born, not just how much: a streaming animation layer can
 * flare exactly the elements that just arrived.
 */
export type PatchResult = {
    added: number;
    removed: number;
    addedNodeIds: string[];
    addedEdges: {
        key: string;
        source: string;
        target: string;
    }[];
    removedNodeIds: string[];
    removedEdgeKeys: string[];
};
export declare function patchGraph(g: Graph, nodes: readonly GraphNode[], edges: readonly GraphEdge[], opts?: BuildOptions): PatchResult;
export {};
//# sourceMappingURL=graph-model.d.ts.map