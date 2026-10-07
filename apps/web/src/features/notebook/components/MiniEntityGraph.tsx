/**
 * MiniEntityGraph — Compact force-directed-style graph visualization
 * for entity mention expansion panels.
 *
 * Renders a small SVG showing the central entity node surrounded by
 * connected entities (edges) and backlinks in a radial layout.
 * Pure SVG — no external graph library dependencies.
 *
 * Pattern: Radial layout with spring-like positioning
 * Prior art:
 *   - Obsidian: local graph view (mini neighborhood graph)
 *   - Roam Research: graph overview with radial layout
 *   - Neo4j Bloom: entity-centric neighborhood visualization
 *
 * See: docs/architecture/EXPANDABLE_GRAPH_NOTEBOOK.md Phase 4
 */
import { useMemo } from "react";
import type { EntityEdge, BacklinkEntry } from "../hooks/useEntityExpansion";

/** BOUND: max nodes to render in the mini graph */
const MAX_GRAPH_NODES = 12;
/** Graph dimensions */
const WIDTH = 240;
const HEIGHT = 160;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
/** Node radii */
const CENTER_RADIUS = 14;
const NEIGHBOR_RADIUS = 8;
/** Orbit radius for neighbor nodes */
const ORBIT_RADIUS = 55;

type GraphNode = {
  id: string;
  label: string;
  kind: "center" | "edge" | "backlink";
  x: number;
  y: number;
  color: string;
};

type GraphEdge = {
  sourceId: string;
  targetId: string;
  type: string;
  color: string;
};

const EDGE_TYPE_COLORS: Record<string, string> = {
  mention: "#d97757",
  citation: "#60a5fa",
  relatedTo: "#a78bfa",
  causes: "#f472b6",
  supports: "#4ade80",
  contradicts: "#f87171",
  derived: "#94a3b8",
};

const KIND_COLORS: Record<string, string> = {
  company: "#d97757",
  person: "#60a5fa",
  tag: "#a78bfa",
};

type MiniEntityGraphProps = {
  entityId: string;
  label: string;
  kind: "company" | "person" | "tag";
  edges: EntityEdge[];
  backlinks: BacklinkEntry[];
};

/**
 * Position nodes radially around the center.
 * Uses golden-angle distribution for even spacing.
 */
function layoutNodes(
  centerLabel: string,
  centerKind: "company" | "person" | "tag",
  edges: EntityEdge[],
  backlinks: BacklinkEntry[],
): { nodes: GraphNode[]; graphEdges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const graphEdges: GraphEdge[] = [];
  const seenLabels = new Set<string>();

  // Center node
  const centerId = "center";
  nodes.push({
    id: centerId,
    label: centerLabel,
    kind: "center",
    x: CENTER_X,
    y: CENTER_Y,
    color: KIND_COLORS[centerKind] ?? "#d97757",
  });
  seenLabels.add(centerLabel.toLowerCase());

  // Collect neighbor nodes from edges + backlinks
  const neighbors: Array<{
    label: string;
    kind: "edge" | "backlink";
    type: string;
  }> = [];

  for (const edge of edges) {
    const key = edge.label.toLowerCase();
    if (!seenLabels.has(key)) {
      seenLabels.add(key);
      neighbors.push({ label: edge.label, kind: "edge", type: edge.relation });
    }
  }

  for (const bl of backlinks) {
    const blLabel = bl.from || `backlink-${bl.type}`;
    const key = blLabel.toLowerCase();
    if (!seenLabels.has(key)) {
      seenLabels.add(key);
      neighbors.push({ label: blLabel, kind: "backlink", type: bl.type });
    }
  }

  // Limit to MAX_GRAPH_NODES
  const bounded = neighbors.slice(0, MAX_GRAPH_NODES);
  const count = bounded.length;

  // Position nodes in a radial layout
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    // Add slight jitter for organic feel
    const jitterX = ((i % 3) - 1) * 4;
    const jitterY = ((i % 2) - 0.5) * 6;
    const x = CENTER_X + ORBIT_RADIUS * Math.cos(angle) + jitterX;
    const y = CENTER_Y + ORBIT_RADIUS * Math.sin(angle) + jitterY;

    const neighbor = bounded[i];
    const nodeId = `node-${i}`;
    const edgeColor =
      EDGE_TYPE_COLORS[neighbor.type] ?? (neighbor.kind === "backlink" ? "#94a3b8" : "#d97757");

    nodes.push({
      id: nodeId,
      label: neighbor.label,
      kind: neighbor.kind,
      x,
      y,
      color: edgeColor,
    });

    graphEdges.push({
      sourceId: neighbor.kind === "backlink" ? nodeId : centerId,
      targetId: neighbor.kind === "backlink" ? centerId : nodeId,
      type: neighbor.type,
      color: edgeColor,
    });
  }

  return { nodes, graphEdges };
}

/** Truncate label to fit node */
function truncateLabel(label: string, maxLen: number): string {
  if (label.length <= maxLen) return label;
  return label.slice(0, maxLen - 1) + "…";
}

export function MiniEntityGraph({
  label,
  kind,
  edges,
  backlinks,
}: MiniEntityGraphProps) {
  const { nodes, graphEdges } = useMemo(
    () => layoutNodes(label, kind, edges, backlinks),
    [label, kind, edges, backlinks],
  );

  // O(1) node lookup map, rebuilt only when layout changes
  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes],
  );

  // Don't render if no connections
  if (graphEdges.length === 0) return null;

  return (
    <div
      className="nb-mini-graph"
      role="img"
      aria-label={`Entity relationship graph for ${label} with ${graphEdges.length} connections`}
    >
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="nb-mini-graph-svg"
      >
        {/* Edges — O(1) lookup via pre-built node map */}
        {graphEdges.map((edge, i) => {
          const source = nodeMap.get(edge.sourceId);
          const target = nodeMap.get(edge.targetId);
          if (!source || !target) return null;

          return (
            <line
              key={`edge-${i}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={edge.color}
              strokeWidth={1.2}
              strokeOpacity={0.5}
              className="nb-mini-graph-edge"
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const isCenter = node.kind === "center";
          const r = isCenter ? CENTER_RADIUS : NEIGHBOR_RADIUS;
          const displayLabel = isCenter
            ? truncateLabel(node.label, 10)
            : truncateLabel(node.label, 6);

          return (
            <g key={node.id} className="nb-mini-graph-node">
              {/* Node circle */}
              <circle
                cx={node.x}
                cy={node.y}
                r={r}
                fill={node.color}
                fillOpacity={isCenter ? 0.25 : 0.15}
                stroke={node.color}
                strokeWidth={isCenter ? 1.5 : 1}
                strokeOpacity={isCenter ? 0.8 : 0.5}
              />
              {/* Node label */}
              <text
                x={node.x}
                y={isCenter ? node.y + CENTER_RADIUS + 10 : node.y + NEIGHBOR_RADIUS + 9}
                textAnchor="middle"
                className="nb-mini-graph-label"
                fill="currentColor"
                fillOpacity={isCenter ? 0.9 : 0.6}
                fontSize={isCenter ? 9 : 7}
              >
                {displayLabel}
              </text>

              {/* Backlink direction indicator (small arrow) */}
              {node.kind === "backlink" && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={2.5}
                  fill={node.color}
                  fillOpacity={0.7}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
