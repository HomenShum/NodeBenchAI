/**
 * AgentFlowRail — living agent-workflow visualization, extracted
 * directly from the `nodebench_v4_notionLike_reactFlow` prototype.
 *
 * The critique on the old Companion rail was that it felt like a
 * debug/ops sidecar — static text about orchestrator state. This
 * rail replaces that with a REAL answer to "what are the agents
 * doing right now?": a draggable node graph with live edges.
 *
 * Design notes:
 *   - Dark canvas (#0d0d0d) with a radial-dot grid, preserves the
 *     Notion dark aesthetic without competing with the notebook.
 *   - Nodes are positioned via initial (x,y) props; drag positions
 *     persist in component state only (NOT written back to the
 *     data source — this is a view, not a mutation surface).
 *   - Edges are SVG cubic Bézier paths drawn between node centers.
 *   - Node status drives color + pulse animation: waiting (gray),
 *     running (blue pulsing), completed (green), failed (rose).
 *
 * Intentionally NOT in this primitive:
 *   - Wiring to actual agent run data (callers pass nodes/edges).
 *   - Persistence of user-dragged positions.
 *   - Zoom / pan (future).
 * Keeping it a pure presentational primitive lets multiple
 * consumers (entity page, chat drawer, dedicated observability
 * view) reuse it with different data sources.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/utils";

export type AgentNodeStatus = "waiting" | "running" | "completed" | "failed";

export interface AgentFlowNode {
  id: string;
  label: string;
  /** Single-letter or short icon string shown in the node badge. */
  icon: string;
  /** Initial canvas coords (pixels). */
  x: number;
  y: number;
  /** Color variant for the icon badge; defaults by id-hash. */
  color?: "blue" | "purple" | "green" | "orange";
  status?: AgentNodeStatus;
  /** Optional status line shown under the label. */
  statusText?: string;
}

export interface AgentFlowEdge {
  from: string;
  to: string;
  /** When true, edge draws as solid + animated (agent data flowing). */
  active?: boolean;
}

export interface AgentFlowRailProps {
  nodes: AgentFlowNode[];
  edges: AgentFlowEdge[];
  className?: string;
  /** Canvas height. Defaults to 360px (enough for 2x2 layout). */
  height?: number;
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 68;

const COLOR_BADGE: Record<NonNullable<AgentFlowNode["color"]>, string> = {
  blue: "#529cca",
  purple: "#9065b0",
  green: "#4dab9a",
  orange: "#d9730d",
};

function hashColor(id: string): NonNullable<AgentFlowNode["color"]> {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const palette: NonNullable<AgentFlowNode["color"]>[] = [
    "blue",
    "purple",
    "green",
    "orange",
  ];
  return palette[Math.abs(h) % palette.length];
}

/**
 * Build a cubic Bézier path between two node rectangles. The curve
 * bows outward vertically so edges don't overlap the node body.
 */
function bezierPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): string {
  const midY = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
}

export const AgentFlowRail = memo(function AgentFlowRail({
  nodes,
  edges,
  className,
  height = 360,
}: AgentFlowRailProps) {
  // Positions live in local state so drag feels instant. We seed
  // from prop `x`/`y` on first render; prop changes after that are
  // ignored (the user expects their dragged positions to stick).
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(
    () => Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y }])),
  );
  // Re-seed when the set of node ids changes (new nodes added).
  const nodeIdsRef = useRef(nodes.map((n) => n.id).join(","));
  useEffect(() => {
    const nextIds = nodes.map((n) => n.id).join(",");
    if (nextIds === nodeIdsRef.current) return;
    nodeIdsRef.current = nextIds;
    setPositions((prev) => {
      const next: Record<string, { x: number; y: number }> = {};
      for (const n of nodes) {
        next[n.id] = prev[n.id] ?? { x: n.x, y: n.y };
      }
      return next;
    });
  }, [nodes]);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const nodeEl = e.currentTarget;
      const nodeRect = nodeEl.getBoundingClientRect();
      dragRef.current = {
        id,
        offsetX: e.clientX - nodeRect.left,
        offsetY: e.clientY - nodeRect.top,
      };
      nodeEl.setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      const nextX = Math.max(
        0,
        Math.min(canvasRect.width - NODE_WIDTH, e.clientX - canvasRect.left - drag.offsetX),
      );
      const nextY = Math.max(
        0,
        Math.min(canvasRect.height - NODE_HEIGHT, e.clientY - canvasRect.top - drag.offsetY),
      );
      setPositions((prev) => ({ ...prev, [drag.id]: { x: nextX, y: nextY } }));
    },
    [],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released — fine */
      }
      dragRef.current = null;
    },
    [],
  );

  // Derive edge endpoints from the live positions. Memo so we don't
  // rebuild the path strings on every unrelated re-render.
  const edgePaths = useMemo(() => {
    return edges.map((edge) => {
      const from = positions[edge.from];
      const to = positions[edge.to];
      if (!from || !to) return null;
      const fromCX = from.x + NODE_WIDTH / 2;
      const fromCY = from.y + NODE_HEIGHT;
      const toCX = to.x + NODE_WIDTH / 2;
      const toCY = to.y;
      return {
        key: `${edge.from}→${edge.to}`,
        d: bezierPath(fromCX, fromCY, toCX, toCY),
        active: Boolean(edge.active),
      };
    });
  }, [edges, positions]);

  const canvasStyle: CSSProperties = {
    height,
    backgroundColor: "#0d0d0d",
    backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
    backgroundSize: "20px 20px",
    backgroundPosition: "0 0",
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-white/[0.06]",
        className,
      )}
      ref={canvasRef}
      style={canvasStyle}
      role="img"
      aria-label="Agent workflow graph"
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {edgePaths.map((p) =>
          p ? (
            <path
              key={p.key}
              d={p.d}
              fill="none"
              strokeWidth={2}
              strokeDasharray={p.active ? undefined : "5 5"}
              className={cn(
                "transition-all",
                p.active
                  ? "stroke-[#529cca] opacity-100"
                  : "stroke-white/20 opacity-60",
              )}
            />
          ) : null,
        )}
      </svg>
      {nodes.map((node) => {
        const pos = positions[node.id] ?? { x: node.x, y: node.y };
        const color = node.color ?? hashColor(node.id);
        const badgeBg = COLOR_BADGE[color];
        const status = node.status ?? "waiting";
        return (
          <div
            key={node.id}
            onPointerDown={(e) => handlePointerDown(e, node.id)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              left: pos.x,
              top: pos.y,
              width: NODE_WIDTH,
              // minHeight rather than fixed so statusText doesn't clip
              minHeight: NODE_HEIGHT,
            }}
            className={cn(
              "absolute cursor-grab select-none rounded-lg border px-3 py-2 shadow-md transition-colors touch-none active:cursor-grabbing",
              "bg-[#1a1a1a] border-[#2a2a2a] hover:bg-[#252525] hover:border-[#373737]",
              status === "running" &&
                "border-[#529cca] shadow-[0_0_0_2px_rgba(82,156,202,0.3),0_4px_12px_rgba(0,0,0,0.4)] animate-pulse",
              status === "completed" && "border-[#4dab9a]/60",
              status === "failed" && "border-rose-500/60",
            )}
            role="group"
            aria-label={`${node.label} — ${status}`}
            data-node-id={node.id}
            data-status={status}
          >
            <div className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-md text-[13px] font-semibold text-white"
                style={{ backgroundColor: badgeBg }}
                aria-hidden="true"
              >
                {node.icon}
              </span>
              <span className="text-[13px] font-semibold text-white/90">{node.label}</span>
            </div>
            {node.statusText ? (
              <div className="mt-1 text-[11px] text-white/45">{node.statusText}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
});

AgentFlowRail.displayName = "AgentFlowRail";
