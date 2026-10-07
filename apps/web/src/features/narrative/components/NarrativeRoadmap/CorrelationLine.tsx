"use client";

/**
 * CorrelationLine - Visualizes cross-thread event relationships
 *
 * Renders SVG lines between correlated events in the NarrativeRoadmap.
 * Shows how events across different threads relate to each other.
 *
 * @module features/narrative/components/NarrativeRoadmap
 */

import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { useMotionConfig } from "@/lib/motion";

export interface CorrelationData {
  correlationId: string;
  primaryEventId: string;
  relatedEventIds: string[];
  correlationType: "causal" | "temporal" | "entity_overlap" | "topic_similarity";
  strength: number;
  description: string;
}

export interface EventPosition {
  eventId: string;
  x: number;
  y: number;
  threadIndex: number;
}

export interface CorrelationLineProps {
  correlations: CorrelationData[];
  eventPositions: Map<string, EventPosition>;
  width: number;
  height: number;
  selectedCorrelationId?: string;
  onCorrelationClick?: (correlation: CorrelationData) => void;
  onCorrelationHover?: (correlation: CorrelationData | null) => void;
}

/**
 * Get color for correlation type
 */
function getCorrelationColor(type: CorrelationData["correlationType"]): string {
  switch (type) {
    case "causal":
      return "#ef4444"; // Red - strongest relationship
    case "temporal":
      return "#f59e0b"; // Amber - time proximity
    case "entity_overlap":
      return "#3b82f6"; // Blue - shared entities
    case "topic_similarity":
      return "#8b5cf6"; // Purple - topic similarity
    default:
      return "#6b7280"; // Gray - default
  }
}

/**
 * Get stroke width based on correlation strength
 */
function getStrokeWidth(strength: number): number {
  // Map 0-1 strength to 1-4 stroke width
  return 1 + strength * 3;
}

/**
 * Calculate bezier curve control points for smooth lines
 */
function calculateCurvePath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  curveIntensity: number = 0.5
): string {
  const midX = (startX + endX) / 2;
  const yDiff = endY - startY;

  // Control points for smooth curve
  const cp1x = startX + (endX - startX) * 0.3;
  const cp1y = startY + yDiff * curveIntensity;
  const cp2x = startX + (endX - startX) * 0.7;
  const cp2y = endY - yDiff * curveIntensity;

  return `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
}

/**
 * CorrelationLine Component
 */
export function CorrelationLine({
  correlations,
  eventPositions,
  width,
  height,
  selectedCorrelationId,
  onCorrelationClick,
  onCorrelationHover,
}: CorrelationLineProps) {
  const { instant, transition } = useMotionConfig();

  // Calculate line paths for all correlations
  const linePaths = useMemo(() => {
    const paths: Array<{
      correlation: CorrelationData;
      path: string;
      color: string;
      strokeWidth: number;
      startPos: EventPosition;
      endPos: EventPosition;
    }> = [];

    for (const correlation of correlations) {
      const startPos = eventPositions.get(correlation.primaryEventId);
      if (!startPos) continue;

      for (const relatedEventId of correlation.relatedEventIds) {
        const endPos = eventPositions.get(relatedEventId);
        if (!endPos) continue;

        // Skip if same position (shouldn't happen but be safe)
        if (startPos.x === endPos.x && startPos.y === endPos.y) continue;

        // Calculate curve intensity based on distance
        const distance = Math.abs(startPos.y - endPos.y);
        const curveIntensity = Math.min(0.8, 0.3 + distance / 400);

        const path = calculateCurvePath(
          startPos.x,
          startPos.y,
          endPos.x,
          endPos.y,
          curveIntensity
        );

        paths.push({
          correlation,
          path,
          color: getCorrelationColor(correlation.correlationType),
          strokeWidth: getStrokeWidth(correlation.strength),
          startPos,
          endPos,
        });
      }
    }

    return paths;
  }, [correlations, eventPositions]);

  if (linePaths.length === 0) {
    return null;
  }

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={width}
      height={height}
      style={{ overflow: "visible" }}
    >
      <defs>
        {/* Arrow marker for causal correlations */}
        <marker
          id="correlation-arrow"
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill="currentColor" />
        </marker>
      </defs>

      {/* Render lines */}
      {linePaths.map(({ correlation, path, color, strokeWidth }, index) => {
        const isSelected = selectedCorrelationId === correlation.correlationId;
        const opacity = selectedCorrelationId
          ? isSelected
            ? 1
            : 0.2
          : correlation.strength * 0.8 + 0.2;

        return (
          <g key={`${correlation.correlationId}-${index}`}>
            {/* Glow effect for selected */}
            {isSelected && (
              <motion.path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth + 4}
                strokeOpacity={0.3}
                initial={{ opacity: instant ? 1 : 0 }}
                animate={{ opacity: 1 }}
                transition={transition(0.2)}
              />
            )}

            {/* Main line */}
            <motion.path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeOpacity={opacity}
              strokeLinecap="round"
              strokeDasharray={correlation.correlationType === "temporal" ? "4 4" : "none"}
              markerEnd={correlation.correlationType === "causal" ? "url(#correlation-arrow)" : "none"}
              className="pointer-events-auto cursor-pointer transition-all duration-200"
              style={{ color }}
              initial={{ pathLength: instant ? 1 : 0, opacity: instant ? opacity : 0 }}
              animate={{ pathLength: 1, opacity }}
              transition={transition({ duration: 0.5, delay: index * 0.05 })}
              onClick={() => onCorrelationClick?.(correlation)}
              onMouseEnter={() => onCorrelationHover?.(correlation)}
              onMouseLeave={() => onCorrelationHover?.(null)}
            />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * CorrelationLegend - Shows what different line styles mean
 */
export function CorrelationLegend() {
  const types: Array<{ type: CorrelationData["correlationType"]; label: string }> = [
    { type: "causal", label: "Causal" },
    { type: "temporal", label: "Temporal" },
    { type: "entity_overlap", label: "Entity Overlap" },
    { type: "topic_similarity", label: "Topic Similarity" },
  ];

  return (
    <div className="flex items-center gap-4 text-xs text-content-secondary">
      {types.map(({ type, label }) => (
        <div key={type} className="flex items-center gap-1.5">
          <svg width="24" height="8" className="flex-shrink-0">
            <line
              x1="0"
              y1="4"
              x2="24"
              y2="4"
              stroke={getCorrelationColor(type)}
              strokeWidth="2"
              strokeDasharray={type === "temporal" ? "4 2" : "none"}
            />
            {type === "causal" && (
              <polygon
                points="24,4 20,2 20,6"
                fill={getCorrelationColor(type)}
              />
            )}
          </svg>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * CorrelationTooltip - Shows correlation details on hover
 */
export interface CorrelationTooltipProps {
  correlation: CorrelationData;
  position: { x: number; y: number };
}

export function CorrelationTooltip({ correlation, position }: CorrelationTooltipProps) {
  const { instant, transition: motionTransition } = useMotionConfig();
  const typeLabels: Record<CorrelationData["correlationType"], string> = {
    causal: "Causal Relationship",
    temporal: "Temporal Proximity",
    entity_overlap: "Shared Entities",
    topic_similarity: "Topic Similarity",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: instant ? 0 : 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: instant ? 0 : 5 }}
      transition={motionTransition(0.2)}
      className="absolute z-50 bg-surface rounded-lg shadow-lg border border-edge p-3 max-w-xs"
      style={{
        left: position.x,
        top: position.y + 10,
        transform: "translateX(-50%)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: getCorrelationColor(correlation.correlationType) }}
        />
        <span className="text-sm font-medium text-content">
          {typeLabels[correlation.correlationType]}
        </span>
      </div>
      <p className="text-sm text-content-secondary mb-2">{correlation.description}</p>
      <div className="flex items-center justify-between text-xs text-content-muted">
        <span>Strength: {Math.round(correlation.strength * 100)}%</span>
        <span>{correlation.relatedEventIds.length} event(s)</span>
      </div>
    </motion.div>
  );
}

export default CorrelationLine;
