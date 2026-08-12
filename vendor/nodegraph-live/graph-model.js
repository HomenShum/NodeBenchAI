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
export const EDGE_TYPES = ["evidence", "traversal", "assertion"];
/** Edge kinds whose `weight` is a measured value and may therefore be encoded
 *  as a magnitude. Everything not in this set is telemetry or curation. */
export const EVIDENCE_EDGE_TYPES = new Set(["evidence"]);
export const isEdgeType = (value) => typeof value === "string" && EDGE_TYPES.includes(value);
/** Runtime payloads do not get to invent a fourth epistemic category. */
export const requireEdgeType = (value) => {
    if (!isEdgeType(value)) {
        throw new TypeError(`Unknown edge type ${JSON.stringify(value)}; expected ${EDGE_TYPES.join(", ")}`);
    }
    return value;
};
export const isEvidenceEdgeType = (t) => EVIDENCE_EDGE_TYPES.has(t);
/** Default node-ring palette. Hue encodes node KIND (a categorical channel),
 *  never magnitude. A kind outside the caller's `kindColors` map gets a hue
 *  picked deterministically by hashing the kind name, so the same kind gets
 *  the same hue in every session without any registration step. */
const PALETTE = [
    { light: "#2a78d6", dark: "#3987e5" },
    { light: "#eb6834", dark: "#d95926" },
    { light: "#1baf7a", dark: "#199e70" },
    { light: "#8a63d2", dark: "#9a77e0" },
    { light: "#c4416e", dark: "#d45c84" },
    { light: "#b08b1e", dark: "#c29c2e" },
];
const kindHue = (kind) => {
    let h = 0;
    for (let i = 0; i < kind.length; i++)
        h = (Math.imul(h, 31) + kind.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
};
/**
 * Edge ink. Sigma's default edge program draws solid lines only — no dash
 * patterns — so edge type rides a NEUTRAL lightness ramp and the per-type
 * filter toggles do the discriminating work. Neutral on purpose: hue stays
 * spent on node kind, and a second categorical hue scale on one canvas is
 * unreadable. Evidence carries the weight channel, so it gets the darkest ink.
 */
const EDGE_COLOR = {
    evidence: { light: "#3f464d", dark: "#a8b1b9" },
    traversal: { light: "#9aa1a8", dark: "#616a72" },
    assertion: { light: "#7d858c", dark: "#727b83" },
};
const requireText = (value, field) => {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new TypeError(`${field} must be a non-empty string`);
    }
    return value;
};
export const requireAssertionReceipt = (value) => {
    if (!value || typeof value !== "object") {
        throw new TypeError("assertion receipt is required");
    }
    const receipt = value;
    const parsed = {
        source: requireText(receipt.source, "receipt.source"),
        release: requireText(receipt.release, "receipt.release"),
        subjectId: requireText(receipt.subjectId, "receipt.subjectId"),
        objectId: requireText(receipt.objectId, "receipt.objectId"),
        url: requireText(receipt.url, "receipt.url"),
    };
    let url;
    try {
        url = new URL(parsed.url);
    }
    catch {
        throw new TypeError("receipt.url must be an absolute HTTP(S) URL");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new TypeError("receipt.url must be an absolute HTTP(S) URL");
    }
    return parsed;
};
const validateNodes = (nodes) => {
    for (const node of nodes) {
        requireText(node.id, "node.id");
        requireText(node.label, "node.label");
        requireText(node.type, "node.type");
        if (node.count !== undefined &&
            (!Number.isFinite(node.count) || node.count < 0)) {
            throw new TypeError("node.count must be a finite non-negative number or absent");
        }
    }
};
const validateEdges = (edges) => {
    for (const edge of edges) {
        const type = requireEdgeType(edge.type);
        requireText(edge.source, "edge.source");
        requireText(edge.target, "edge.target");
        if (!Number.isFinite(edge.weight) || edge.weight < 0) {
            throw new TypeError("edge.weight must be a finite non-negative number");
        }
        if (type === "assertion") {
            requireAssertionReceipt(edge.receipt);
        }
    }
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
export const EDGE_TYPE_ATTR = "edgeType";
/** `(a, b, type)` with the endpoints CANONICALLY ORDERED — without the sort,
 *  `a|b|evidence` and `b|a|evidence` are different keys and one measured
 *  relationship becomes two edges drawn on top of each other. */
export const edgeKey = (source, target, type) => {
    const safeType = requireEdgeType(type);
    const [a, b] = source < target ? [source, target] : [target, source];
    return JSON.stringify([a, b, safeType]);
};
/** Node radius in Sigma units. sqrt so AREA tracks count, not radius. */
const sizeFor = (count, max) => 6 + 18 * Math.sqrt(Math.max(count ?? 0, 0) / Math.max(max, 1));
/**
 * Deterministic seed positions on a circle. A force layout moves every node on
 * its first tick, so the seed costs nothing — but an unseeded (random) start
 * makes two runs incomparable. Positions are layout, never meaning.
 */
const seed = (i, n) => ({
    x: Math.cos((2 * Math.PI * i) / Math.max(n, 1)),
    y: Math.sin((2 * Math.PI * i) / Math.max(n, 1)),
});
const nodeHue = (type, opts) => opts.kindColors?.[type] ?? kindHue(type);
const edgeDisplayAttrs = (e, type, evidenceMax, dark) => {
    const ink = EDGE_COLOR[type];
    const evidence = isEvidenceEdgeType(type);
    return {
        weight: e.weight,
        [EDGE_TYPE_ATTR]: type,
        // Measured weights get the width channel. Everything else gets a constant.
        size: evidence ? 0.6 + 4.4 * (e.weight / evidenceMax) : 1,
        color: dark ? ink.dark : ink.light,
        // The assertion badge: Sigma renders the `label` attribute along the edge.
        ...(e.type === "assertion"
            ? {
                label: e.receipt.release,
                releaseTag: e.receipt.release,
                receipt: e.receipt,
            }
            : {}),
    };
};
const evidenceMaxOf = (edges) => edges.reduce((m, e) => (isEvidenceEdgeType(e.type) ? Math.max(m, e.weight) : m), 1);
export function buildGraph(nodes, edges, opts = {}) {
    // Validate the complete payload before mutating anything. A renderer that
    // paints half a batch before discovering an unknown edge type has already
    // made a false claim.
    validateNodes(nodes);
    validateEdges(edges);
    const dark = opts.dark ?? false;
    const visits = opts.visits ?? {};
    // Multi + undirected: two relationship kinds on one pair are two rows, and
    // (a,b) and (b,a) are one row within a kind.
    const g = new Graph({ multi: true, type: "undirected" });
    const maxCount = nodes.reduce((m, n) => Math.max(m, n.count ?? 0), 1);
    nodes.forEach((n, i) => {
        if (g.hasNode(n.id))
            return;
        const hue = nodeHue(n.type, opts);
        g.addNode(n.id, {
            ...seed(i, nodes.length),
            label: n.label,
            kind: n.type,
            count: n.count ?? null,
            countState: n.count === undefined ? "unknown" : "measured",
            // Interaction frequency. An attribute, never a channel.
            visits: visits[n.id] ?? 0,
            size: sizeFor(n.count, maxCount),
            // Ringed nodes: a near-card disc with the kind colour on the RING.
            // Read by @sigma/node-border in the renderer.
            color: dark ? "#1c1f22" : "#ffffff",
            borderColor: dark ? hue.dark : hue.light,
            borderSize: 0.22,
        });
    });
    const evidenceMax = evidenceMaxOf(edges);
    for (const e of edges) {
        const type = requireEdgeType(e.type);
        // An edge to a node the payload did not describe would have to invent that
        // node — and an invented node has no measured count, so it would draw a
        // magnitude nobody measured. Drop the edge instead.
        if (!g.hasNode(e.source) || !g.hasNode(e.target))
            continue;
        const key = edgeKey(e.source, e.target, type);
        // First occurrence wins. Two rows for one (a, b, type) is contradictory
        // input; picking deterministically is honest, averaging would invent a
        // number, and last-wins is the overwrite bug this key exists to prevent.
        if (g.hasEdge(key))
            continue;
        g.addEdgeWithKey(key, e.source, e.target, edgeDisplayAttrs(e, type, evidenceMax, dark));
    }
    return g;
}
/** Edge types actually present, in declared order. Drives the filter UI:
 *  a toggle for a type with no edges is a control that does nothing. */
export function edgeTypesPresent(g) {
    const seen = new Set();
    g.forEachEdge((_k, a) => seen.add(requireEdgeType(a[EDGE_TYPE_ATTR])));
    return EDGE_TYPES.filter((t) => seen.has(t));
}
/** Per-type edge counts, for labelling the toggles honestly. */
export function edgeTypeCounts(g) {
    const out = {};
    g.forEachEdge((_k, a) => {
        const t = requireEdgeType(a[EDGE_TYPE_ATTR]);
        out[t] = (out[t] ?? 0) + 1;
    });
    return out;
}
export function patchGraph(g, nodes, edges, opts = {}) {
    validateNodes(nodes);
    validateEdges(edges);
    const dark = opts.dark ?? false;
    const visits = opts.visits ?? {};
    const addedNodeIds = [];
    const addedEdges = [];
    const removedNodeIds = [];
    const removedEdgeKeys = [];
    // Props are the complete snapshot. Reconcile removals in place so bounded
    // session eviction actually reaches the Graphology/Sigma surface instead
    // of leaving invisible stale state to grow forever.
    const desiredNodeIds = new Set(nodes.map((node) => node.id));
    const desiredEdgeKeys = new Set(edges.map((edge) => edgeKey(edge.source, edge.target, edge.type)));
    g.forEachEdge((key) => {
        if (!desiredEdgeKeys.has(key))
            removedEdgeKeys.push(key);
    });
    for (const key of removedEdgeKeys)
        g.dropEdge(key);
    g.forEachNode((id) => {
        if (!desiredNodeIds.has(id))
            removedNodeIds.push(id);
    });
    for (const id of removedNodeIds)
        g.dropNode(id);
    const maxCount = nodes.reduce((m, n) => Math.max(m, n.count ?? 0), 1);
    // Seed offsets walk the GOLDEN ANGLE around the anchor, so consecutive
    // births can never be collinear. The first dense capture (142 nodes,
    // 2026-08-12) measured what the previous "+0.15 + jitter()" on both axes
    // produced: dx === dy for every birth (same sin(order) in both calls), a
    // perfectly diagonal seed walk — and force layout preserves collinearity
    // it is handed, so the whole constellation rendered as a line.
    const GOLDEN = 2.399963229728653;
    let births = 0;
    const offset = (spread) => {
        const i = g.order + births++;
        const angle = i * GOLDEN;
        const radius = spread * (0.7 + 0.3 * ((Math.sin(i * 12.9898) + 1) / 2));
        return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
    };
    for (const n of nodes) {
        const hue = nodeHue(n.type, opts);
        if (g.hasNode(n.id)) {
            g.mergeNodeAttributes(n.id, {
                count: n.count ?? null,
                countState: n.count === undefined ? "unknown" : "measured",
                visits: visits[n.id] ?? g.getNodeAttribute(n.id, "visits") ?? 0,
                size: sizeFor(n.count, maxCount),
            });
        }
        else {
            // Seed near a neighbour named by the incoming edges, else the centroid.
            const partner = edges
                .filter((e) => e.source === n.id || e.target === n.id)
                .map((e) => (e.source === n.id ? e.target : e.source))
                .find((id) => g.hasNode(id));
            let x = 0, y = 0;
            if (partner) {
                const { dx, dy } = offset(0.22);
                x = g.getNodeAttribute(partner, "x") + dx;
                y = g.getNodeAttribute(partner, "y") + dy;
            }
            else if (g.order > 0) {
                g.forEachNode((_, a) => {
                    x += a.x;
                    y += a.y;
                });
                const { dx, dy } = offset(0.35);
                x = x / g.order + dx;
                y = y / g.order + dy;
            }
            else {
                const s = seed(g.order, Math.max(nodes.length, 1));
                x = s.x;
                y = s.y;
            }
            g.addNode(n.id, {
                x,
                y,
                label: n.label,
                kind: n.type,
                count: n.count ?? null,
                countState: n.count === undefined ? "unknown" : "measured",
                visits: visits[n.id] ?? 0,
                size: sizeFor(n.count, maxCount),
                color: dark ? "#1c1f22" : "#ffffff",
                borderColor: dark ? hue.dark : hue.light,
                borderSize: 0.22,
            });
            addedNodeIds.push(n.id);
        }
    }
    // Sizes scale against maxCount, which a new hub can move: refresh all.
    g.forEachNode((id, a) => {
        g.setNodeAttribute(id, "size", sizeFor(typeof a.count === "number" ? a.count : undefined, maxCount));
    });
    const evidenceMax = evidenceMaxOf(edges);
    for (const e of edges) {
        const type = requireEdgeType(e.type);
        const key = edgeKey(e.source, e.target, type);
        if (!g.hasNode(e.source) || !g.hasNode(e.target))
            continue;
        const attrs = edgeDisplayAttrs(e, type, evidenceMax, dark);
        if (g.hasEdge(key))
            g.mergeEdgeAttributes(key, attrs);
        else {
            g.addEdgeWithKey(key, e.source, e.target, attrs);
            addedEdges.push({ key, source: e.source, target: e.target });
        }
    }
    return {
        added: addedNodeIds.length + addedEdges.length,
        removed: removedNodeIds.length + removedEdgeKeys.length,
        addedNodeIds,
        addedEdges,
        removedNodeIds,
        removedEdgeKeys,
    };
}
//# sourceMappingURL=graph-model.js.map