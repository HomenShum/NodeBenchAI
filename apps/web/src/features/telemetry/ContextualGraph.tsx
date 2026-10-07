/**
 * ContextualGraph — SVG force-directed tool relationship graph.
 *
 * Pure SVG, no D3. Shows tools as nodes colored by domain, connected by
 * relatedTools + nextTools + co-occurrence edges. Node size = usage frequency.
 * Edges thicken with co-occurrence strength. Hover highlights connections.
 * Click shows tool details. Session growth indicator.
 *
 * Uses a simplified spring-layout simulation run on mount.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Types ────────────────────────────────────────────────────────────────── */

interface GraphNode {
  id: string;
  domain: string;
  usage: number; // 0-1 normalized
  description: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: "related" | "next" | "cooccurrence";
  strength: number; // 0-1
}

interface SessionGrowth {
  session: number;
  nodes: number;
  edges: number;
}

/* ─── Domain colors ────────────────────────────────────────────────────────── */

const DOMAIN_COLORS: Record<string, string> = {
  deep_sim: "#8b5cf6",      // violet
  trajectory: "#06b6d4",     // cyan
  missions: "#f97316",       // orange
  research: "#3b82f6",       // blue
  verification: "#10b981",   // emerald
  agents: "#ec4899",         // pink
  session: "#64748b",        // slate
  mcp: "#6366f1",           // indigo
  git: "#14b8a6",           // teal
  proof: "#f59e0b",         // amber
  founder: "#f97316",       // orange
  web: "#3b82f6",           // blue
  recon: "#06b6d4",         // cyan
  learning: "#10b981",      // emerald
  entity_intel: "#3b82f6",  // blue
  quality_gates: "#10b981", // emerald
};

function getDomainColor(domain: string): string {
  return DOMAIN_COLORS[domain] ?? "#64748b";
}

/* ─── Demo data ────────────────────────────────────────────────────────────── */

function generateGraphData(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeData: Array<{ id: string; domain: string; usage: number; description: string }> = [
    // deep_sim cluster
    { id: "build_claim_graph", domain: "deep_sim", usage: 0.6, description: "Builds a structured claim graph from entity data for scenario analysis" },
    { id: "extract_variables", domain: "deep_sim", usage: 0.5, description: "Extracts key decision variables from unstructured context" },
    { id: "run_deep_sim", domain: "deep_sim", usage: 0.4, description: "Runs a full deep simulation with scenario branching" },
    { id: "score_interventions", domain: "deep_sim", usage: 0.3, description: "Scores potential interventions by impact and feasibility" },
    { id: "generate_scenarios", domain: "deep_sim", usage: 0.45, description: "Generates branching scenario trees for decision analysis" },
    { id: "build_decision_memo", domain: "deep_sim", usage: 0.35, description: "Produces a structured decision memo with recommendations" },
    { id: "compare_counter_models", domain: "deep_sim", usage: 0.3, description: "Compares competing causal models for the same entity" },

    // trajectory cluster
    { id: "compute_trajectory_score", domain: "trajectory", usage: 0.8, description: "Computes momentum and trajectory score for an entity" },
    { id: "update_trust_graph", domain: "trajectory", usage: 0.7, description: "Updates trust relationships between entities" },
    { id: "get_trajectory_sparkline", domain: "trajectory", usage: 0.9, description: "Returns sparkline data for entity trajectory over time" },
    { id: "log_trajectory_event", domain: "trajectory", usage: 1.0, description: "Logs a significant event affecting entity trajectory" },

    // missions cluster
    { id: "create_mission", domain: "missions", usage: 0.15, description: "Creates a new agent mission with goals and constraints" },
    { id: "execute_mission_task", domain: "missions", usage: 0.75, description: "Executes a single task within an active mission" },
    { id: "judge_task_output", domain: "missions", usage: 0.7, description: "Judges task output quality using LLM evaluation" },
    { id: "sniff_check", domain: "missions", usage: 0.85, description: "Quick hallucination detection on agent output" },

    // research cluster
    { id: "web_search", domain: "research", usage: 0.95, description: "Performs web search with result extraction and ranking" },
    { id: "fetch_url", domain: "research", usage: 0.8, description: "Fetches and parses content from a URL" },
    { id: "extract_structured_data", domain: "research", usage: 0.6, description: "Extracts structured data from unstructured web content" },
    { id: "build_research_brief", domain: "research", usage: 0.25, description: "Builds a comprehensive research brief from multiple sources" },

    // verification cluster
    { id: "start_verification_cycle", domain: "verification", usage: 0.3, description: "Initiates a verification cycle for agent outputs" },
    { id: "log_test_result", domain: "verification", usage: 0.95, description: "Logs a test result to the verification ledger" },

    // mcp cluster
    { id: "discover_tools", domain: "mcp", usage: 0.4, description: "Searches the tool registry by query with hybrid matching" },
    { id: "get_tool_quick_ref", domain: "mcp", usage: 0.3, description: "Gets tool details with multi-hop BFS traversal" },
    { id: "get_workflow_chain", domain: "mcp", usage: 0.2, description: "Returns recommended tool chains for a workflow" },

    // entity_intel
    { id: "fetch_company_profile", domain: "entity_intel", usage: 0.55, description: "Fetches comprehensive company profile data" },
    { id: "detect_regime_shift", domain: "entity_intel", usage: 0.2, description: "Detects significant regime changes in entity signals" },

    // founder
    { id: "save_session_note", domain: "founder", usage: 0.4, description: "Saves a structured note to the session memory" },
    { id: "refresh_task_context", domain: "founder", usage: 0.25, description: "Refreshes the current task context from memory" },
  ];

  const width = 700;
  const height = 500;

  // Cluster centers by domain
  const domainCenters: Record<string, { x: number; y: number }> = {
    deep_sim:      { x: 150, y: 120 },
    trajectory:    { x: 350, y: 80 },
    missions:      { x: 550, y: 130 },
    research:      { x: 180, y: 320 },
    verification:  { x: 500, y: 300 },
    mcp:           { x: 350, y: 250 },
    entity_intel:  { x: 100, y: 220 },
    founder:       { x: 580, y: 400 },
  };

  const nodes: GraphNode[] = nodeData.map((nd) => {
    const center = domainCenters[nd.domain] ?? { x: width / 2, y: height / 2 };
    return {
      ...nd,
      x: center.x + (Math.random() - 0.5) * 100,
      y: center.y + (Math.random() - 0.5) * 80,
      vx: 0,
      vy: 0,
    };
  });

  const edges: GraphEdge[] = [
    // relatedTools (within domain)
    { source: "build_claim_graph", target: "extract_variables", type: "related", strength: 0.8 },
    { source: "extract_variables", target: "run_deep_sim", type: "next", strength: 0.9 },
    { source: "run_deep_sim", target: "generate_scenarios", type: "next", strength: 0.85 },
    { source: "generate_scenarios", target: "score_interventions", type: "next", strength: 0.7 },
    { source: "score_interventions", target: "build_decision_memo", type: "next", strength: 0.8 },
    { source: "build_claim_graph", target: "compare_counter_models", type: "related", strength: 0.6 },

    // trajectory internal
    { source: "log_trajectory_event", target: "compute_trajectory_score", type: "next", strength: 0.9 },
    { source: "compute_trajectory_score", target: "get_trajectory_sparkline", type: "next", strength: 0.85 },
    { source: "compute_trajectory_score", target: "update_trust_graph", type: "related", strength: 0.7 },

    // missions internal
    { source: "create_mission", target: "execute_mission_task", type: "next", strength: 0.95 },
    { source: "execute_mission_task", target: "judge_task_output", type: "next", strength: 0.9 },
    { source: "execute_mission_task", target: "sniff_check", type: "related", strength: 0.7 },

    // research internal
    { source: "web_search", target: "fetch_url", type: "next", strength: 0.85 },
    { source: "fetch_url", target: "extract_structured_data", type: "next", strength: 0.8 },
    { source: "extract_structured_data", target: "build_research_brief", type: "next", strength: 0.75 },

    // cross-domain co-occurrences
    { source: "web_search", target: "build_claim_graph", type: "cooccurrence", strength: 0.6 },
    { source: "fetch_company_profile", target: "compute_trajectory_score", type: "cooccurrence", strength: 0.55 },
    { source: "build_research_brief", target: "build_decision_memo", type: "cooccurrence", strength: 0.7 },
    { source: "judge_task_output", target: "log_test_result", type: "cooccurrence", strength: 0.65 },
    { source: "discover_tools", target: "get_tool_quick_ref", type: "next", strength: 0.8 },
    { source: "get_tool_quick_ref", target: "get_workflow_chain", type: "related", strength: 0.6 },
    { source: "sniff_check", target: "log_test_result", type: "cooccurrence", strength: 0.5 },
    { source: "extract_variables", target: "extract_structured_data", type: "cooccurrence", strength: 0.45 },
    { source: "detect_regime_shift", target: "log_trajectory_event", type: "cooccurrence", strength: 0.4 },
    { source: "save_session_note", target: "refresh_task_context", type: "next", strength: 0.7 },
    { source: "run_deep_sim", target: "execute_mission_task", type: "cooccurrence", strength: 0.35 },
    { source: "fetch_url", target: "fetch_company_profile", type: "related", strength: 0.5 },
    { source: "start_verification_cycle", target: "log_test_result", type: "next", strength: 0.9 },
    { source: "update_trust_graph", target: "detect_regime_shift", type: "cooccurrence", strength: 0.4 },
  ];

  return { nodes, edges };
}

const SESSION_GROWTH: SessionGrowth[] = [
  { session: 1, nodes: 19, edges: 45 },
  { session: 2, nodes: 28, edges: 78 },
  { session: 3, nodes: 35, edges: 112 },
  { session: 4, nodes: 42, edges: 138 },
  { session: 5, nodes: 48, edges: 156 },
];

/* ─── Simple spring simulation ─────────────────────────────────────────────── */

function runSpringLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  iterations = 60,
): GraphNode[] {
  const result = nodes.map((n) => ({ ...n }));
  const width = 700;
  const height = 500;
  const padding = 40;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;
    const repulsion = 3000 * alpha;
    const attraction = 0.005 * alpha;

    // Repulsion between all nodes
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const dx = result[j].x - result[i].x;
        const dy = result[j].y - result[i].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = repulsion / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        result[i].vx -= fx;
        result[i].vy -= fy;
        result[j].vx += fx;
        result[j].vy += fy;
      }
    }

    // Attraction along edges
    const nodeMap = new Map(result.map((n) => [n.id, n]));
    for (const edge of edges) {
      const s = nodeMap.get(edge.source);
      const t = nodeMap.get(edge.target);
      if (!s || !t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = dist * attraction * edge.strength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    // Apply velocity with damping
    for (const node of result) {
      node.x += node.vx * 0.5;
      node.y += node.vy * 0.5;
      node.vx *= 0.6;
      node.vy *= 0.6;
      // Clamp to bounds
      node.x = Math.max(padding, Math.min(width - padding, node.x));
      node.y = Math.max(padding, Math.min(height - padding, node.y));
    }
  }

  return result;
}

/* ─── Main component ───────────────────────────────────────────────────────── */

export interface ContextualGraphProps {
  className?: string;
}

/** Fetch real graph data from /tool-graph API, fall back to demo */
async function fetchRealGraphData(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] } | null> {
  try {
    const res = await fetch("/tool-graph");
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.graphNodes?.length) return null;

    const nodes: GraphNode[] = data.graphNodes.map((n: any) => ({
      id: n.id,
      domain: n.domain || "unknown",
      usage: Math.min(1, (n.edgeCount || 0) / 10), // normalize edge count to 0-1
      description: `${n.domain} tool — ${n.tags?.slice(0, 3).join(", ") || "no tags"}`,
      x: 0, y: 0, vx: 0, vy: 0,
    }));

    const nodeIds = new Set(nodes.map(n => n.id));
    const edges: GraphEdge[] = (data.graphEdges || [])
      .filter((e: any) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e: any) => ({
        source: e.source,
        target: e.target,
        type: (e.type || "next") as GraphEdge["type"],
        strength: 0.7,
      }));

    return { nodes, edges };
  } catch {
    return null;
  }
}

export const ContextualGraph = memo(function ContextualGraph({
  className = "",
}: ContextualGraphProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [dataSource, setDataSource] = useState<"loading" | "live" | "demo">("loading");
  const svgRef = useRef<SVGSVGElement>(null);

  // Try to fetch real data on mount
  useEffect(() => {
    fetchRealGraphData().then(data => {
      if (data && data.nodes.length > 5) {
        setLiveData(data);
        setDataSource("live");
      } else {
        setDataSource("demo");
      }
    });
  }, []);

  const { rawNodes, edges } = useMemo(() => {
    if (liveData) return { rawNodes: liveData.nodes, edges: liveData.edges };
    const data = generateGraphData();
    return { rawNodes: data.nodes, edges: data.edges };
  }, [liveData]);

  const nodes = useMemo(
    () => runSpringLayout(rawNodes, edges, 80),
    [rawNodes, edges],
  );

  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes],
  );

  // Connected edges for a node
  const getConnectedEdges = useCallback(
    (nodeId: string) =>
      edges.filter((e) => e.source === nodeId || e.target === nodeId),
    [edges],
  );

  const getConnectedNodeIds = useCallback(
    (nodeId: string) => {
      const connected = new Set<string>();
      connected.add(nodeId);
      for (const e of getConnectedEdges(nodeId)) {
        connected.add(e.source);
        connected.add(e.target);
      }
      return connected;
    },
    [getConnectedEdges],
  );

  const activeNodeIds = useMemo(() => {
    if (hoveredNode) return getConnectedNodeIds(hoveredNode);
    if (selectedNode) return getConnectedNodeIds(selectedNode);
    return null;
  }, [hoveredNode, selectedNode, getConnectedNodeIds]);

  const selectedNodeData = useMemo(
    () => (selectedNode ? nodeMap.get(selectedNode) : null),
    [selectedNode, nodeMap],
  );

  const selectedRelated = useMemo(() => {
    if (!selectedNode) return [];
    return getConnectedEdges(selectedNode).map((e) => ({
      tool: e.source === selectedNode ? e.target : e.source,
      type: e.type,
    }));
  }, [selectedNode, getConnectedEdges]);

  // Latest session growth
  const latestGrowth = SESSION_GROWTH[SESSION_GROWTH.length - 1];
  const prevGrowth = SESSION_GROWTH[SESSION_GROWTH.length - 2];
  const newEdges = latestGrowth.edges - prevGrowth.edges;

  // SVG dimensions
  const svgWidth = 700;
  const svgHeight = 500;

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04]">
        <div className="flex items-center gap-2.5">
          <GitBranch className="h-4 w-4 text-[#d97757]" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">
            Tool Graph
          </span>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-white/30">
          <span className={cn(
            "px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider",
            dataSource === "live" ? "bg-emerald-500/20 text-emerald-400" :
            dataSource === "demo" ? "bg-amber-500/20 text-amber-400" :
            "bg-white/10 text-white/30"
          )}>
            {dataSource === "live" ? `live · ${nodes.length} nodes · ${edges.length} edges` :
             dataSource === "demo" ? "demo data" : "loading..."}
          </span>
          <span>
            <span className="font-mono text-white/50">{latestGrowth.nodes}</span> nodes
          </span>
          <span>
            <span className="font-mono text-white/50">{latestGrowth.edges}</span> edges
          </span>
          <span className="text-emerald-400/70 font-medium">
            +{newEdges} this session
          </span>
        </div>
      </div>

      {/* Session growth sparkline */}
      <div className="px-5 py-2.5 border-b border-white/[0.04] flex items-center gap-4">
        <span className="text-[10px] uppercase tracking-[0.15em] text-white/25 shrink-0">
          Growth
        </span>
        <div className="flex items-end gap-1 h-5 flex-1">
          {SESSION_GROWTH.map((sg, i) => {
            const maxEdges = Math.max(...SESSION_GROWTH.map((s) => s.edges));
            const pct = Math.max(15, (sg.edges / maxEdges) * 100);
            return (
              <div
                key={sg.session}
                className="flex-1 rounded-t-sm bg-[#d97757]/40 transition-all hover:bg-[#d97757]/60"
                style={{ height: `${pct}%` }}
                title={`Session ${sg.session}: ${sg.nodes} nodes, ${sg.edges} edges`}
              />
            );
          })}
        </div>
        <div className="text-[10px] text-white/30 font-mono shrink-0">
          {SESSION_GROWTH[0].nodes}n/{SESSION_GROWTH[0].edges}e
          {" \u2192 "}
          {latestGrowth.nodes}n/{latestGrowth.edges}e
        </div>
      </div>

      {/* Graph + detail panel */}
      <div className="relative">
        {/* SVG graph */}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto"
          style={{ minHeight: 320, maxHeight: 500 }}
          role="img"
          aria-label="Tool relationship graph showing connections between tools across domains"
        >
          {/* Background */}
          <rect width={svgWidth} height={svgHeight} fill="transparent" />

          {/* Edges */}
          {edges.map((edge, i) => {
            const source = nodeMap.get(edge.source);
            const target = nodeMap.get(edge.target);
            if (!source || !target) return null;

            const isHighlighted =
              activeNodeIds?.has(edge.source) && activeNodeIds?.has(edge.target);
            const isActive = activeNodeIds
              ? (edge.source === hoveredNode || edge.source === selectedNode ||
                 edge.target === hoveredNode || edge.target === selectedNode)
              : false;

            const strokeWidth = edge.strength * 2 + 0.5;

            let stroke = "rgba(255,255,255,0.06)";
            if (isActive && isHighlighted) {
              stroke =
                edge.type === "cooccurrence"
                  ? "rgba(217,119,87,0.5)"
                  : edge.type === "next"
                    ? "rgba(255,255,255,0.3)"
                    : "rgba(255,255,255,0.2)";
            } else if (activeNodeIds && !isHighlighted) {
              stroke = "rgba(255,255,255,0.02)";
            }

            return (
              <line
                key={`edge-${i}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={stroke}
                strokeWidth={isActive && isHighlighted ? strokeWidth + 0.5 : strokeWidth}
                strokeLinecap="round"
                style={{ transition: "stroke 0.2s, stroke-width 0.2s" }}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const radius = 4 + node.usage * 10;
            const color = getDomainColor(node.domain);
            const isHighlighted = activeNodeIds ? activeNodeIds.has(node.id) : true;
            const isActive =
              node.id === hoveredNode || node.id === selectedNode;

            return (
              <g
                key={node.id}
                style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                opacity={isHighlighted ? 1 : 0.15}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() =>
                  setSelectedNode((prev) =>
                    prev === node.id ? null : node.id,
                  )
                }
              >
                {/* Glow for active */}
                {isActive && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={radius + 6}
                    fill={color}
                    opacity={0.15}
                  />
                )}
                {/* Main circle */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  fill={isActive ? "#d97757" : color}
                  stroke={isActive ? "#d97757" : "rgba(255,255,255,0.1)"}
                  strokeWidth={isActive ? 2 : 1}
                  opacity={isHighlighted ? 0.9 : 0.3}
                />
                {/* Label on hover */}
                {isActive && (
                  <text
                    x={node.x}
                    y={node.y - radius - 6}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.8)"
                    fontSize={9}
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {node.id}
                  </text>
                )}
              </g>
            );
          })}

          {/* Domain labels */}
          {(() => {
            const domainGroups = new Map<string, { sumX: number; sumY: number; count: number }>();
            for (const n of nodes) {
              const g = domainGroups.get(n.domain) ?? { sumX: 0, sumY: 0, count: 0 };
              g.sumX += n.x;
              g.sumY += n.y;
              g.count += 1;
              domainGroups.set(n.domain, g);
            }
            return Array.from(domainGroups.entries()).map(([domain, g]) => (
              <text
                key={`label-${domain}`}
                x={g.sumX / g.count}
                y={Math.max(16, g.sumY / g.count - 28)}
                textAnchor="middle"
                fill="rgba(255,255,255,0.15)"
                fontSize={9}
                fontFamily="Manrope, sans-serif"
                fontWeight={600}
                letterSpacing="0.1em"
                style={{ textTransform: "uppercase" } as React.CSSProperties}
              >
                {domain.replace(/_/g, " ")}
              </text>
            ));
          })()}
        </svg>

        {/* Detail panel */}
        {selectedNodeData && (
          <div
            className={cn(
              "absolute top-4 right-4 w-64 rounded-xl border border-white/[0.08] bg-black/80 backdrop-blur-xl",
              "p-4 space-y-3 animate-in fade-in slide-in-from-right-2 duration-200",
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: getDomainColor(selectedNodeData.domain) }}
                />
                <span className="text-xs font-mono font-semibold text-white/90">
                  {selectedNodeData.id}
                </span>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-white/30 hover:text-white/60 transition-colors"
                aria-label="Close detail panel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-2 text-[10px]">
              <span className="uppercase tracking-wider text-white/30">
                {selectedNodeData.domain}
              </span>
              <span className="text-white/20">&middot;</span>
              <span className="text-white/40">
                Usage: {Math.round(selectedNodeData.usage * 100)}%
              </span>
            </div>

            <p className="text-[11px] text-white/50 leading-relaxed">
              {selectedNodeData.description}
            </p>

            {selectedRelated.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-[0.15em] text-white/25">
                  Connected Tools
                </span>
                <div className="flex flex-wrap gap-1">
                  {selectedRelated.map((r) => (
                    <button
                      key={r.tool}
                      onClick={() => setSelectedNode(r.tool)}
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono",
                        "border transition-colors",
                        r.type === "cooccurrence"
                          ? "bg-[#d97757]/10 text-[#d97757]/80 border-[#d97757]/20 hover:bg-[#d97757]/20"
                          : r.type === "next"
                            ? "bg-white/[0.04] text-white/50 border-white/[0.08] hover:bg-white/[0.08]"
                            : "bg-white/[0.02] text-white/40 border-white/[0.06] hover:bg-white/[0.06]",
                      )}
                    >
                      {r.type === "next" && <span className="text-[8px]">&rarr;</span>}
                      {r.type === "cooccurrence" && <span className="text-[8px]">&harr;</span>}
                      {r.tool}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-5 py-3 border-t border-white/[0.04] flex items-center gap-5 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.15em] text-white/25 shrink-0">
          Legend
        </span>
        <div className="flex items-center gap-1.5">
          <div className="h-px w-5 bg-white/20" />
          <span className="text-[10px] text-white/30">related / next</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-px w-5 bg-[#d97757]/50" style={{ strokeDasharray: "4 2" }} />
          <span className="text-[10px] text-white/30">co-occurrence</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-[#d97757]" />
          <span className="text-[10px] text-white/30">active / selected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Info className="h-3 w-3 text-white/20" />
          <span className="text-[10px] text-white/30">click node for details</span>
        </div>
      </div>
    </div>
  );
});

export default ContextualGraph;
