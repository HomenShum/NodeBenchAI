"use client";

/**
 * ChartAnnotationLayer - SVG annotation layer for EnhancedLineChart
 * 
 * Renders agent-generated annotations as labels near data points.
 * Annotations fade in/out based on the current act for progressive disclosure.
 */

import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMotionConfig } from '@/lib/motion';
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useCurrentAct, type Act } from "../contexts/FocusSyncContext";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Annotation {
  _id: string;
  dataIndex: number;
  text: string;
  position: "above" | "below" | "left" | "right";
  icon?: string;
  visibleInActs: Act[];
}

export interface ChartAnnotationLayerProps {
  /** Brief ID to fetch annotations for */
  briefId: string;
  /** Function to get x,y coordinates for a data point index */
  getCoord: (index: number) => { x: number; y: number };
  /** Chart dimensions for positioning */
  chartWidth: number;
  chartHeight: number;
  /** Optional series ID filter */
  seriesId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ANNOTATION_OFFSET = {
  above: { dx: 0, dy: -12 },
  below: { dx: 0, dy: 18 },
  left: { dx: -8, dy: 0 },
  right: { dx: 8, dy: 0 },
} as const;

const TEXT_ANCHOR = {
  above: "middle",
  below: "middle",
  left: "end",
  right: "start",
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export const ChartAnnotationLayer: React.FC<ChartAnnotationLayerProps> = ({
  briefId,
  getCoord,
  chartWidth,
  chartHeight,
  seriesId,
}) => {
  const { instant, transition } = useMotionConfig();
  // Get current act from focus context
  const currentAct = useCurrentAct();

  // Fetch annotations from Convex
  const annotations = useQuery(api.domains.dossier.annotations.getAnnotations, {
    briefId,
    seriesId,
  });

  // Filter annotations visible in current act
  const visibleAnnotations = useMemo(() => {
    if (!annotations) return [];
    return annotations.filter((a: any) => a.visibleInActs.includes(currentAct));
  }, [annotations, currentAct]);

  if (!visibleAnnotations.length) return null;

  return (
    <g className="annotation-layer" aria-label="Chart annotations">
      <AnimatePresence mode="popLayout">
        {visibleAnnotations.map((annotation: any) => {
          const coord = getCoord(annotation.dataIndex);
          const offset = ANNOTATION_OFFSET[annotation.position as keyof typeof ANNOTATION_OFFSET];
          const textAnchor = TEXT_ANCHOR[annotation.position as keyof typeof TEXT_ANCHOR];

          // Clamp position to stay within chart bounds
          const x = Math.max(20, Math.min(chartWidth - 20, coord.x + offset.dx));
          const y = Math.max(15, Math.min(chartHeight - 10, coord.y + offset.dy));

          return (
            <motion.g
              key={annotation._id}
              initial={{ opacity: 0, scale: instant ? 1 : 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: instant ? 1 : 0.8 }}
              transition={transition({ duration: 0.3, ease: "easeOut" })}
            >
              {/* Connector line from annotation to point */}
              <motion.line
                x1={coord.x}
                y1={coord.y}
                x2={x}
                y2={y}
                stroke="#94a3b8"
                strokeWidth={0.5}
                strokeDasharray="2 2"
                initial={{ pathLength: instant ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={transition({ duration: 0.2 })}
              />

              {/* Background pill for text */}
              <rect
                x={x - (annotation.text.length * 3)}
                y={y - 8}
                width={annotation.text.length * 6 + 16}
                height={16}
                rx={8}
                fill="white"
                stroke="#e2e8f0"
                strokeWidth={1}
                className="drop-shadow-sm"
              />

              {/* Icon (if present) */}
              {annotation.icon && (
                <text
                  x={x - (annotation.text.length * 3) + 6}
                  y={y + 3}
                  className="text-xs"
                  textAnchor="start"
                >
                  {annotation.icon}
                </text>
              )}

              {/* Annotation text */}
              <text
                x={annotation.icon ? x + 4 : x}
                y={y + 3}
                textAnchor={annotation.icon ? "start" : textAnchor}
                className="text-xs fill-slate-700 font-medium"
              >
                {annotation.text}
              </text>
            </motion.g>
          );
        })}
      </AnimatePresence>
    </g>
  );
};

export default ChartAnnotationLayer;

