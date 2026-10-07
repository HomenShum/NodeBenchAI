"use client";

import React from "react";
import { motion } from "framer-motion";
import { Building2, User, Zap, Box } from "lucide-react";
import { useMotionConfig } from '@/lib/motion';
import type { EntityGraph, GraphNode } from "@/features/research/types";

const IconMap: Record<string, typeof Building2> = {
  company: Building2,
  person: User,
  concept: Zap,
  product: Box,
};

function getNodeIcon(node: GraphNode) {
  const type = node.type ?? "concept";
  return IconMap[type] ?? Box;
}

export const EntityRadar: React.FC<{ graph: EntityGraph | null }> = ({ graph }) => {
  const { instant, transition } = useMotionConfig();
  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="rounded-lg border border-gray-900/10 bg-surface p-6 text-xs text-content-muted">
        No entity relationships detected yet.
      </div>
    );
  }

  const width = 400;
  const height = 260;
  const center = { x: width / 2, y: height / 2 };
  const radius = 90;
  const secondaryRadius = 130;

  const focusId = graph.focusNodeId || graph.nodes[0]?.id;
  const centerNode = graph.nodes.find((node) => node.id === focusId) ?? graph.nodes[0];
  const otherNodes = graph.nodes.filter((node) => node.id !== centerNode.id);
  const primaryNodes = otherNodes.filter((node) => (node.tier ?? 1) <= 1);
  const secondaryNodes = otherNodes.filter((node) => (node.tier ?? 1) > 1);

  const positionedNodes = [
    ...primaryNodes.map((node, idx) => {
      const angle = (idx / Math.max(primaryNodes.length, 1)) * 2 * Math.PI;
      const x = center.x + radius * Math.cos(angle);
      const y = center.y + radius * Math.sin(angle);
      return { node, x, y, ring: "primary" as const };
    }),
    ...secondaryNodes.map((node, idx) => {
      const angle = (idx / Math.max(secondaryNodes.length, 1)) * 2 * Math.PI;
      const x = center.x + secondaryRadius * Math.cos(angle);
      const y = center.y + secondaryRadius * Math.sin(angle);
      return { node, x, y, ring: "secondary" as const };
    }),
  ];

  const edges = graph.edges ?? [];

  return (
    <div className="relative rounded-lg border border-gray-900/10 bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-bold text-gray-900/60">
          Entity Influence Map
        </div>
        <div className="text-xs font-mono text-content-muted">GraphRAG</div>
      </div>

      <div className="relative h-[260px]">
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {positionedNodes.map(({ node, x, y, ring }, idx) => {
            const edge = edges.find(
              (edge) =>
                (edge.source === centerNode.id && edge.target === node.id) ||
                (edge.target === centerNode.id && edge.source === node.id),
            );
            const isSecondary = edge?.order === "secondary" || ring === "secondary";
            const labelText = edge?.relationship ?? edge?.impact;
            return (
              <g key={`edge-${node.id}-${idx}`}>
                <motion.line
                  x1={center.x}
                  y1={center.y}
                  x2={x}
                  y2={y}
                  stroke={isSecondary ? "#e2e8f0" : "#cbd5e1"}
                  strokeWidth={isSecondary ? "0.8" : "1"}
                  strokeDasharray={isSecondary ? "2 4" : "4 4"}
                  initial={{ pathLength: instant ? 1 : 0 }}
                  animate={{ pathLength: 1 }}
                  transition={transition({ duration: 0.8 })}
                />
                {labelText && (
                  <text
                    x={(center.x + x) / 2}
                    y={(center.y + y) / 2 - 4}
                    textAnchor="middle"
                    fill={isSecondary ? "#94a3b8" : "#64748b"}
                    fontSize="9"
                  >
                    {labelText}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {positionedNodes.map(({ node, x, y, ring }, idx) => {
          const Icon = getNodeIcon(node);
          const left = (x / width) * 100;
          const top = (y / height) * 100;
          const isSecondary = ring === "secondary";
          return (
            <motion.div
              key={`node-${node.id}`}
              className="absolute flex flex-col items-center gap-1"
              style={{ left: `${left}%`, top: `${top}%`, transform: "translate(-50%, -50%)" }}
              initial={{ opacity: 0, scale: instant ? 1 : 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={transition({ delay: idx * 0.05 })}
            >
              <div className={`w-8 h-8 rounded-full bg-surface border flex items-center justify-center shadow-sm ${
                isSecondary ? "border-slate-200/60" : "border-slate-200"
              }`}>
                <Icon className={`w-4 h-4 ${isSecondary ? "text-slate-500" : "text-content"}`} />
              </div>
              <span className="text-xs text-content-secondary font-semibold text-center max-w-[80px]">
                {node.label}
              </span>
            </motion.div>
          );
        })}

        <motion.div
          className="absolute left-1/2 top-1/2 flex flex-col items-center"
          style={{ transform: "translate(-50%, -50%)" }}
          initial={{ scale: instant ? 1 : 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={transition({ duration: 0.4 })}
        >
          <div className="w-12 h-12 rounded-full bg-gray-900 flex items-center justify-center shadow-lg border-4 border-indigo-50">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <span className="mt-2 text-xs font-bold text-content">
            {centerNode.label}
          </span>
        </motion.div>
      </div>
    </div>
  );
};

export default EntityRadar;
