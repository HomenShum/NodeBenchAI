/**
 * useRunGraph — derive an AgentFlowRail-shaped graph from the live
 * `extendedThinkingRuns` + `extendedThinkingCheckpoints` state.
 *
 * The v4 prototype's flow panel shows agents as nodes with pulsing
 * active state and dash-animated edges. In NodeBench, the real
 * runtime data for that visualization already exists: each run is
 * a chain of checkpoints, and adjacent checkpoints form a DAG edge.
 * This hook maps Convex rows → AgentFlowNode/AgentFlowEdge arrays.
 *
 * Layout strategy: auto-arranges checkpoints in a 2-column flow
 * that reads top-to-bottom then wraps. Keeps the initial positions
 * inside the 400px × 360px canvas of the right rail. Users can drag
 * nodes freely after first render (see AgentFlowRail).
 *
 * Status mapping (runtime → UI):
 *   checkpoint.status === "scored"        → completed (green border)
 *   latest checkpoint while run.status === "running" → running (pulse)
 *   checkpoint.status === "parse_error"|"request_failed" → failed (rose)
 *   all others                            → waiting (default gray)
 *
 * Invariants:
 *   - Pure mapping — no side effects; safe to call at any React phase
 *   - Returns stable empty arrays on loading so consumers never see
 *     `undefined` during the first paint (no loading flash)
 *   - Caps displayed checkpoints at 36 (matches MAX_CHECKPOINTS in
 *     the runner) so a runaway run can't blow up the canvas
 */

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { useConvexApi } from "@/lib/convexApi";
import type { AgentFlowNode, AgentFlowEdge } from "@/features/agents/primitives/AgentFlowRail";

/** Column layout for the flow canvas (fits the default 400×360 rail). */
const NODE_COL_X = [32, 216];
const NODE_ROW_Y = 36;
const NODE_ROW_GAP = 88;
const MAX_DISPLAY_NODES = 36;

/** Collapse long checkpoint text into a two-line node label. */
function nodeIconForIndex(index: number): string {
  // Single-letter badge keeps the node small but readable. We use the
  // 1-based index so viewers see the same numbering as the run log.
  return String(index + 1);
}

function nodeLabelFor(headline: string | undefined, index: number): string {
  if (!headline) return `Checkpoint ${index + 1}`;
  return headline.length > 28 ? `${headline.slice(0, 25)}…` : headline;
}

/** Short status text shown under the node label. */
function nodeStatusText(status: string, focus?: string): string {
  if (status === "scored" && focus) return focus.slice(0, 32);
  if (status === "parse_error") return "parse error";
  if (status === "request_failed") return "request failed";
  return status;
}

export interface UseRunGraphResult {
  /** True once we know there's no run to show (vs. still loading). */
  hasRun: boolean;
  /** True iff run.status === "running" — callers use this to auto-expand UI. */
  isActive: boolean;
  /** Last activity timestamp; used for the "last run 9h ago" affordance. */
  lastRunAt: number | null;
  /** Run title / headline, if known. */
  runHeadline: string | null;
  /** Nodes + edges in AgentFlowRail shape. */
  nodes: AgentFlowNode[];
  edges: AgentFlowEdge[];
}

const EMPTY_RESULT: UseRunGraphResult = {
  hasRun: false,
  isActive: false,
  lastRunAt: null,
  runHeadline: null,
  nodes: [],
  edges: [],
};

/**
 * Subscribes to the most recent `extendedThinkingRuns` for this
 * entity + its checkpoints, and derives a flow-graph shape.
 */
export function useRunGraph(entitySlug: string): UseRunGraphResult {
  const api = useConvexApi();
  const runs = useQuery(
    api?.domains?.product?.extendedThinking?.listRunsForEntity ?? ("skip" as any),
    api?.domains?.product?.extendedThinking?.listRunsForEntity
      ? { entitySlug, limit: 1 }
      : "skip",
  ) as Array<{
    _id: string;
    status: string;
    goal?: string;
    lastActivityAt: number;
    currentCheckpoint: number;
  }> | undefined;

  const latestRun = Array.isArray(runs) && runs.length > 0 ? runs[0] : null;

  const checkpoints = useQuery(
    latestRun && api?.domains?.product?.extendedThinking?.listCheckpointsForRun
      ? api.domains.product.extendedThinking.listCheckpointsForRun
      : ("skip" as any),
    latestRun && api?.domains?.product?.extendedThinking?.listCheckpointsForRun
      ? { runId: latestRun._id as any }
      : "skip",
  ) as Array<{
    _id: string;
    index: number;
    status: string;
    headline?: string;
    focus?: string;
    judgedAt: number;
  }> | undefined;

  return useMemo<UseRunGraphResult>(() => {
    if (!latestRun) return EMPTY_RESULT;
    const isActive = latestRun.status === "running";
    const lastRunAt = latestRun.lastActivityAt ?? null;
    const runHeadline = latestRun.goal ?? null;

    if (!checkpoints || checkpoints.length === 0) {
      // Run exists but no checkpoints yet — show a single seed node
      // so the rail isn't empty while the first checkpoint lands.
      return {
        hasRun: true,
        isActive,
        lastRunAt,
        runHeadline,
        nodes: [
          {
            id: "seed",
            label: runHeadline ? nodeLabelFor(runHeadline, 0) : "Starting run",
            icon: "·",
            x: NODE_COL_X[0],
            y: NODE_ROW_Y,
            status: isActive ? "running" : "waiting",
            statusText: isActive ? "planning…" : "queued",
          },
        ],
        edges: [],
      };
    }

    // Sort by index so "later" really means later, even if Convex
    // returned the rows in a different order.
    const sortedCheckpoints = [...checkpoints]
      .sort((a, b) => a.index - b.index)
      .slice(-MAX_DISPLAY_NODES);

    // Map checkpoints → nodes with column-wrap layout.
    const nodes: AgentFlowNode[] = sortedCheckpoints.map((cp, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const isLatest = i === sortedCheckpoints.length - 1;
      const runningHere = isActive && isLatest;
      const failed =
        cp.status === "parse_error" || cp.status === "request_failed";
      return {
        id: cp._id,
        label: nodeLabelFor(cp.headline, cp.index),
        icon: nodeIconForIndex(cp.index),
        x: NODE_COL_X[col],
        y: NODE_ROW_Y + row * NODE_ROW_GAP,
        status: runningHere
          ? "running"
          : failed
            ? "failed"
            : cp.status === "scored"
              ? "completed"
              : "waiting",
        statusText: runningHere ? "thinking…" : nodeStatusText(cp.status, cp.focus),
      };
    });

    // Build linear edges between adjacent checkpoints; mark the last
    // edge as `active` when the run is still running (data is flowing
    // into the next checkpoint right now).
    const edges: AgentFlowEdge[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        from: nodes[i].id,
        to: nodes[i + 1].id,
        active: isActive && i === nodes.length - 2,
      });
    }

    return {
      hasRun: true,
      isActive,
      lastRunAt,
      runHeadline,
      nodes,
      edges,
    };
  }, [latestRun, checkpoints]);
}
